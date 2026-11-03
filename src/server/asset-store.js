'use strict';
/**
 * asset-store.js — reference-first Business Asset Intelligence store.
 *
 * Pack-sourced records point at the immutable bytes under
 * data/brand-packs/<id>/files/...; uploads own their bytes under
 * data/assets/<id>/original.*. Nothing is copied between the two.
 *
 * The store is Node-only and standard-library-only. Pillow is optional via
 * asset-service.js; every degradation is reported, never silently invented.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const Intel = require('../shared/asset-intel.js');
const AssetService = require('./asset-service.js');

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const ASSETS_DIR = path.join(DATA_DIR, 'assets');
const PACKS_DIR = path.join(DATA_DIR, 'brand-packs');
const USAGE_FILE = path.join(ASSETS_DIR, 'usage.json');
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_ASSETS = 2000;
const MAX_UPLOAD = 40 * 1024 * 1024;
const MAX_FILES = 60;
const MAX_BODY = 200 * 1024 * 1024;
const MAX_VARIANTS = 8;
const MAX_USAGE_EVENTS = 5000;
const MAX_ASSET_BYTES = 4 * 1024 * 1024 * 1024;
const THUMB = 'thumb.webp';

const MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    mp4: 'video/mp4', mov: 'video/quicktime', txt: 'text/plain',
    wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac',
    ogg: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm',
};

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function nowIso() {
    return new Date().toISOString();
}

function safeId(value) {
    const id = String(value || '');
    if (!Intel.isId(id) || !ID_PATTERN.test(id.slice(4))) throw httpError(400, 'Invalid asset id.');
    return id;
}

function assetDir(id) {
    return path.join(ASSETS_DIR, safeId(id));
}

function metadataFile(id) {
    return path.join(assetDir(id), 'metadata.json');
}

async function readJson(file, fallback = null) {
    try {
        return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return fallback;
        throw error;
    }
}

async function writeJson(file, value) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(value, null, 2));
    await fsp.rename(temp, file);
}

async function listRecords() {
    let entries = [];
    try {
        entries = await fsp.readdir(ASSETS_DIR, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    const out = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !Intel.isId(entry.name)) continue;
        try {
            const raw = await readJson(metadataFile(entry.name));
            if (raw) out.push(Intel.normalizeAsset(raw));
        } catch {
            /* skip a corrupt record, keep the rest */
        }
    }
    return out;
}

function summary(record) {
    return {
        id: record.id,
        name: record.name,
        class: record.class,
        role: record.role,
        tags: record.tags,
        state: record.review.state,
        provenance: record.provenance,
        approval: Intel.approvalOf(record),
        status: record.status,
        packId: record.binding.packId,
        brandId: record.binding.brandId,
        width: record.identity.width,
        height: record.identity.height,
        format: record.identity.format,
        bytes: record.identity.bytes,
        operations: record.operations,
        usage: record.usage,
        fit: record.fit,
        master: record.master,
        extracted: record.extracted ? {
            kind: record.extracted.kind,
            rows: record.extracted.rows.length,
        } : null,
        thumb: assetUrl(record.id, 'thumb'),
        sourceUrl: assetUrl(record.id, 'original'),
        updatedAt: record.updatedAt,
    };
}

function assetUrl(id, variant = 'original') {
    return `/api/assets/${encodeURIComponent(id)}/file/${encodeURIComponent(variant)}`;
}

async function readAsset(id) {
    const record = await readJson(metadataFile(safeId(id)));
    if (!record) throw httpError(404, 'Asset not found.');
    return Intel.normalizeAsset(record);
}

async function saveAsset(record) {
    const normalized = Intel.normalizeAsset(record);
    normalized.updatedAt = nowIso();
    if (!normalized.createdAt) normalized.createdAt = normalized.updatedAt;
    await writeJson(metadataFile(normalized.id), normalized);
    return normalized;
}

function defaultUsage(cls, role) {
    const base = {
        profile: 'print-and-screen',
        printMinDpi: 150,
        formats: { allow: [], deny: [] },
        consent: 'not-applicable',
        rights: 'unknown',
        notes: '',
    };
    if (cls === 'brand-identity') {
        return { ...base, printMinDpi: 300, rights: 'brand-owned', profile: role === 'specimen' ? 'screen-only' : 'print-and-screen' };
    }
    if (cls === 'business-document' || cls === 'content') {
        return { ...base, profile: 'reference-only', rights: 'staff-supplied' };
    }
    if (cls === 'compliance') {
        return { ...base, printMinDpi: 300, rights: 'brand-owned' };
    }
    if (cls === 'people') {
        return { ...base, consent: 'missing' };
    }
    return base;
}

function extension(file) {
    return String(file || '').split('.').pop().toLowerCase();
}

function mimeFor(ext) {
    return MIME[String(ext || '').toLowerCase()] || 'application/octet-stream';
}

function formatFor(ext) {
    const value = String(ext || '').toLowerCase();
    if (value === 'jpeg') return 'jpg';
    return value || '';
}

function sniffImage(buffer, name = '') {
    if (!buffer || !buffer.length) return null;
    if (buffer.length >= 24 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') {
        return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
        return { format: 'gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        let offset = 2;
        while (offset < buffer.length - 8) {
            if (buffer[offset] !== 0xFF) { offset += 1; continue; }
            const marker = buffer[offset + 1];
            if (marker === 0xD8 || marker === 0xD9 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
                offset += 2;
                continue;
            }
            const length = buffer.readUInt16BE(offset + 2);
            if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
                return { format: 'jpg', height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
            }
            offset += 2 + length;
        }
        return { format: 'jpg', width: null, height: null };
    }
    if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        const chunk = buffer.toString('ascii', 12, 16);
        if (chunk === 'VP8X') {
            return { format: 'webp', width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
        }
        if (chunk === 'VP8 ') {
            return { format: 'webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
        }
        return { format: 'webp', width: null, height: null };
    }
    if (/<svg[\s>]/i.test(buffer.toString('utf8', 0, Math.min(buffer.length, 512)))) {
        const source = buffer.toString('utf8', 0, Math.min(buffer.length, 4096));
        const width = source.match(/<svg\b[^>]*\bwidth=["']([\d.]+)/i);
        const height = source.match(/<svg\b[^>]*\bheight=["']([\d.]+)/i);
        const box = source.match(/viewBox=["']([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)/i);
        if (width && height) return { format: 'svg', width: Math.round(Number(width[1])), height: Math.round(Number(height[1])) };
        if (box) return { format: 'svg', width: Math.round(Number(box[3])), height: Math.round(Number(box[4])) };
        return { format: 'svg', width: null, height: null };
    }
    if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === '%PDF') return { format: 'pdf', width: null, height: null };
    if (buffer.length >= 4 && buffer.toString('ascii', 0, 2) === 'PK') return { format: extension(name), width: null, height: null };
    return null;
}

function cleanRelative(value) {
    const relative = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!relative || relative.includes('..')) return '';
    return relative;
}

function packFile(packId, brandId, relative) {
    if (!ID_PATTERN.test(String(packId || ''))) throw httpError(400, 'Invalid pack id.');
    if (!ID_PATTERN.test(String(brandId || ''))) throw httpError(400, 'Invalid brand id.');
    const safe = cleanRelative(relative);
    if (!safe) throw httpError(400, 'Invalid asset path.');
    const root = path.join(PACKS_DIR, packId, 'files', brandId) + path.sep;
    const target = path.join(root, ...safe.split('/'));
    if (!path.resolve(target).startsWith(root)) throw httpError(400, 'Invalid asset path.');
    return target;
}

function sourcePath(record) {
    if (record.source.kind === 'pack') {
        return packFile(record.source.packId || record.binding.packId,
            record.source.brandId || record.binding.brandId, record.source.path);
    }
    return path.join(assetDir(record.id), `original.${record.identity.format || 'bin'}`);
}

function resolveFile(record, variant = 'original') {
    const value = String(variant || 'original');
    if (value === 'thumb') {
        const thumb = path.join(assetDir(record.id), THUMB);
        return fs.existsSync(thumb) ? { path: thumb, format: 'webp' } : {
            path: sourcePath(record), format: record.identity.format || 'bin',
        };
    }
    if (value === 'original' || value === 'source') {
        return { path: sourcePath(record), format: record.identity.format || 'bin' };
    }
    const variantRecord = (record.variants || []).find((entry) => entry.id === value);
    if (!variantRecord) throw httpError(404, 'Asset variant not found.');
    const file = path.join(assetDir(record.id), 'variants', `${variantRecord.id}.${variantRecord.format || 'bin'}`);
    if (!fs.existsSync(file)) throw httpError(404, 'Asset variant file is missing.');
    return { path: file, format: variantRecord.format || 'bin' };
}

function packBrand(pack, brandId) {
    return (pack.brands || []).find((brand) => brand.id === brandId) || null;
}

async function readPack(packId) {
    if (!ID_PATTERN.test(String(packId || ''))) throw httpError(400, 'Invalid pack id.');
    const file = path.join(PACKS_DIR, packId, 'pack.json');
    const parsed = await readJson(file);
    if (!parsed) throw httpError(404, 'Brand pack not found.');
    return parsed.pack || parsed;
}

async function loadPackAssets(packId) {
    const pack = await readPack(packId);
    const items = [];
    const add = (brand, asset, cls, role, state) => {
        if (!asset) return;
        let relative = cleanRelative(asset.path);
        if (!relative && asset.url) {
            const match = String(asset.url).match(/\/api\/brand-packs\/[^/]+\/files\/[^/]+\/(.+)$/);
            if (match) relative = cleanRelative(decodeURIComponent(match[1]));
        }
        if (!relative) return;
        const full = packFile(packId, brand.id, relative);
        if (!fs.existsSync(full)) return;
        items.push({ brand, asset, relative, full, cls, role, state });
    };
    for (const brand of pack.brands || []) {
        (brand.logos || []).forEach((asset) => add(brand, asset, 'brand-identity', 'logo', 'verified'));
        (brand.typeSpecimens || []).forEach((asset) => add(brand, asset, 'brand-identity', 'specimen', 'verified'));
        (brand.paletteImages || []).forEach((asset) => add(brand, asset, 'brand-identity', 'specimen', 'verified'));
        (brand.photography || []).forEach((asset) => add(brand, asset, 'unclassified', 'photo', 'proposed'));
        if (brand.cover) add(brand, { path: null, url: brand.cover, name: `${brand.name} cover`, width: null, height: null }, 'marketing-collateral', 'cover', 'proposed');
    }
    return { pack, items };
}

async function brandPalette(packId, brandId) {
    try {
        const pack = await readPack(packId);
        const brand = packBrand(pack, brandId);
        return brand?.palette || [];
    } catch {
        return [];
    }
}

async function recordForPackItem({ brand, asset, relative, full, cls, role, state }, pack, packId) {
    const buffer = await fsp.readFile(full);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const sniff = sniffImage(buffer, relative) || { format: formatFor(extension(relative)), width: asset.width, height: asset.height };
    const width = Number(asset.width) || sniff.width || null;
    const height = Number(asset.height) || sniff.height || null;
    const name = String(asset.name || path.basename(relative).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')).slice(0, 120);
    const id = Intel.assetId(`${brand.id}-${role}-${path.basename(relative)}`, sha256);
    const existing = await readJson(metadataFile(id)).catch(() => null);
    if (existing) return { existing: true, record: Intel.normalizeAsset(existing) };
    const usage = defaultUsage(cls, role);
    const fit = Intel.brandFit({
        role, identity: { width, height, sha256, palette: [] },
    }, { palette: brand.palette || [] });
    return {
        existing: false,
        record: {
            schema: Intel.SCHEMA,
            id,
            name,
            class: cls,
            role,
            tags: [role, cls, ...(brand.name ? [brand.name] : [])].slice(0, 12),
            identity: {
                sha256,
                bytes: buffer.length,
                format: sniff.format || formatFor(extension(relative)),
                width, height,
                alpha: null,
                palette: [],
            },
            source: {
                kind: 'pack', channel: 'brand-pack', packId, brandId: brand.id,
                path: relative, originName: path.basename(relative),
                capturedAt: pack.createdAt || null,
            },
            binding: { packId, brandId: brand.id, match: 'declared', confidence: 1 },
            operations: Intel.operationsFor(cls),
            usage,
            fit,
            variants: [],
            extracted: null,
            master: { isMaster: true, of: null },
            review: { state, by: state === 'verified' ? 'pack-import' : 'classifier', at: nowIso(), note: '' },
            status: 'active',
            usageLog: { designs: 0, downloads: 0, lastUsedAt: null },
            createdAt: pack.createdAt || nowIso(),
            updatedAt: nowIso(),
        },
    };
}

async function indexPack(packId) {
    const { pack, items } = await loadPackAssets(packId);
    const records = await listRecords();
    if (records.length + items.length > MAX_ASSETS) {
        throw httpError(413, `The library is limited to ${MAX_ASSETS} assets.`);
    }
    let created = 0;
    let skipped = 0;
    const warnings = [];
    for (const item of items) {
        try {
            const result = await recordForPackItem(item, pack, packId);
            if (result.existing) { skipped += 1; continue; }
            await saveAsset(result.record);
            created += 1;
        } catch (error) {
            warnings.push(`${item.relative}: ${error.message}`);
        }
    }
    await dedupeAll();
    const health = await assetHealth();
    return { packId, created, skipped, warnings: warnings.slice(0, 20), health };
}

async function ingestAssets(payload = {}) {
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!files.length) throw httpError(400, 'Choose at least one file.');
    if (files.length > MAX_FILES) throw httpError(413, `Upload at most ${MAX_FILES} files at once.`);
    const records = await listRecords();
    if (records.length + files.length > MAX_ASSETS) throw httpError(413, `The library is limited to ${MAX_ASSETS} assets.`);
    let workspaceBytes = records.reduce((sum, record) => sum + (record.identity.bytes || 0), 0);
    const status = await AssetService.status();
    const created = [];
    const warnings = [];
    for (const file of files) {
        const name = String(file?.name || 'upload').slice(0, 180);
        const dataUrl = String(file?.dataUrl || '');
        const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/);
        if (!match) { warnings.push(`${name}: not a base64 data URL.`); continue; }
        const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
        if (!buffer.length) { warnings.push(`${name}: empty file.`); continue; }
        if (buffer.length > MAX_UPLOAD) { warnings.push(`${name}: over 40 MB.`); continue; }
        if (workspaceBytes + buffer.length > MAX_ASSET_BYTES) { warnings.push(`${name}: the 4 GB workspace cap would be exceeded.`); continue; }
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
        const sniff = sniffImage(buffer, name) || { format: formatFor(extension(name)), width: null, height: null };
        const cls = Intel.CLASSES.includes(file?.class) ? file.class : guessClass(name, sniff.format);
        const role = String(file?.role || (cls === 'brand-identity' ? 'logo' : cls === 'business-document' ? 'document' : 'photo')).slice(0, 40);
        const id = Intel.assetId(name, sha256);
        const existing = await readJson(metadataFile(id)).catch(() => null);
        if (existing) { created.push(Intel.normalizeAsset(existing)); warnings.push(`${name}: already in the library.`); continue; }
        const uploadId = id;
        const dir = assetDir(uploadId);
        const ext = (sniff.format || formatFor(extension(name)) || 'bin').replace('jpeg', 'jpg');
        const target = path.join(dir, `original.${ext}`);
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(target, buffer);
        let identity = {
            sha256, bytes: buffer.length, format: sniff.format || ext,
            width: sniff.width || null, height: sniff.height || null, alpha: null, palette: [],
        };
        let thumbnail = false;
        const imageFormat = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']
            .includes(String(identity.format || '').toLowerCase());
        if (status.available && imageFormat) {
            try {
                const info = await AssetService.inspect(target);
                identity = {
                    ...identity,
                    pHash: info.pHash,
                    palette: info.palette || [],
                    alpha: info.alpha,
                    width: info.width || identity.width,
                    height: info.height || identity.height,
                    format: info.format || identity.format,
                    capturedAt: info.exif?.capturedAt || null,
                };
                if (info.thumbnail) {
                    await fsp.writeFile(path.join(dir, THUMB), Buffer.from(info.thumbnail, 'base64'));
                    thumbnail = true;
                }
            } catch (error) {
                warnings.push(`${name}: ${error.message}`);
            }
        } else if (status.reason && imageFormat) {
            warnings.push(`${name}: image analysis unavailable (${status.reason}).`);
        }
        const packId = String(payload.packId || '').slice(0, 80);
        const brandId = String(payload.brandId || '').slice(0, 80);
        const usage = { ...defaultUsage(cls, role), ...(file?.usage || {}) };
        if (file?.rights) usage.rights = file.rights;
        if (file?.consent) usage.consent = file.consent;
        const fit = Intel.brandFit({ role, identity }, { palette: await brandPalette(packId, brandId) });
        const record = {
            schema: Intel.SCHEMA,
            id,
            name: String(file?.name ? file.name.replace(/\.[^.]+$/, '') : name).slice(0, 120),
            class: cls,
            role,
            tags: [role, cls].slice(0, 12),
            identity,
            source: {
                kind: 'upload', channel: 'upload', packId: packId || null, brandId: brandId || null,
                path: `original.${ext}`, originName: name, capturedAt: file?.capturedAt || null,
            },
            binding: { packId: packId || null, brandId: brandId || null, match: packId ? 'manual' : 'inferred', confidence: packId ? 1 : 0 },
            operations: Intel.operationsFor(cls),
            usage: Intel.normalizeUsage(usage),
            fit,
            variants: [],
            extracted: null,
            master: { isMaster: true, of: null },
            review: { state: 'proposed', by: 'classifier', at: nowIso(), note: '' },
            status: 'active',
            usageLog: { designs: 0, downloads: 0, lastUsedAt: null },
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };
        await saveAsset(record);
        workspaceBytes += buffer.length;
        if (thumbnail) {
            record.variants.push({
                id: 'thumb', op: 'resize', params: { width: 320 },
                url: assetUrl(id, 'thumb'), width: 320, height: 320, format: 'webp',
                bytes: fs.statSync(path.join(dir, THUMB)).size,
            });
            await saveAsset(record);
        }
        created.push(record);
    }
    await dedupeAll();
    return { created: created.map(summary), warnings };
}

function guessClass(name, format) {
    const low = String(name || '').toLowerCase();
    if (format === 'pdf' || format === 'docx' || /menu|invoice|contract|brief|allergen/.test(low)) return 'business-document';
    if (/logo|wordmark|mark|monogram/.test(low)) return 'brand-identity';
    if (/allergen|compliance|prep|label/.test(low)) return 'compliance';
    if (/staff|team|portrait|people/.test(low)) return 'people';
    return 'unclassified';
}

async function listAssets(filters = {}) {
    let records = await listRecords();
    const limit = Math.min(200, Math.max(1, Number(filters.limit) || 60));
    const offset = Math.max(0, Number(filters.offset) || 0);
    const query = String(filters.q || '').trim().toLowerCase();
    records = records.filter((record) => {
        if (filters.packId && record.binding.packId !== filters.packId) return false;
        if (filters.brandId && record.binding.brandId !== filters.brandId) return false;
        if (filters.class && record.class !== filters.class) return false;
        if (filters.state && record.review.state !== filters.state) return false;
        if (filters.status && record.status !== filters.status) return false;
        if (!filters.status && record.status === 'archived') return false;
        if (filters.operation && !record.operations.includes(filters.operation)) return false;
        if (filters.verified === '1'
            && !['verified', 'approved'].includes(record.review.state)) return false;
        if (query) {
            const haystack = `${record.name} ${record.tags.join(' ')} ${record.class} ${record.role}`.toLowerCase();
            if (!haystack.includes(query)) return false;
        }
        return true;
    });
    records.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return {
        total: records.length,
        assets: records.slice(offset, offset + limit).map(summary),
    };
}

async function patchAsset(id, changes = {}) {
    const record = await readAsset(id);
    for (const key of ['name', 'class', 'role', 'tags', 'usage', 'status', 'provenance']) {
        if (!(key in changes)) continue;
        if (key === 'class' && !Intel.CLASSES.includes(changes[key])) throw httpError(400, 'Unknown asset class.');
        if (key === 'status' && !Intel.STATUSES.includes(changes[key])) throw httpError(400, 'Unknown asset status.');
        record[key] = changes[key];
    }
    if (changes.class && !changes.operations) record.operations = Intel.operationsFor(changes.class);
    if (changes.binding && typeof changes.binding === 'object') {
        record.binding = { ...record.binding, ...changes.binding };
    }
    return saveAsset(record);
}

async function verifyAsset(id, state, note = '', by = 'operator') {
    if (!Intel.REVIEW_STATES.includes(state)) throw httpError(400, 'Unknown review state.');
    const record = await readAsset(id);
    record.review = {
        state,
        by: String(by || 'operator').slice(0, 80),
        at: nowIso(),
        note: String(note || '').slice(0, 280),
    };
    return saveAsset(record);
}

async function deleteAsset(id, purge = false) {
    const record = await readAsset(id);
    if (purge && record.source.kind !== 'upload') {
        throw httpError(409, 'Pack-sourced assets are metadata only; delete the pack instead.');
    }
    if (purge) {
        await fsp.rm(assetDir(id), { recursive: true, force: true });
        return { deleted: true, purged: true };
    }
    record.status = 'archived';
    await saveAsset(record);
    return { deleted: true, archived: true };
}

async function markPackOrphaned(packId) {
    const records = await listRecords();
    let changed = 0;
    for (const record of records) {
        if (record.binding.packId !== packId && record.source.packId !== packId) continue;
        record.status = 'orphaned';
        await saveAsset(record);
        changed += 1;
    }
    return changed;
}

function chooseMaster(group) {
    return [...group].sort((a, b) => {
        const area = (record) => (record.identity.width || 0) * (record.identity.height || 0);
        const score = (record) => [
            area(record),
            record.review.state === 'verified' ? 1 : 0,
            record.source.kind === 'pack' ? 1 : 0,
            record.createdAt || '',
        ];
        const left = score(a);
        const right = score(b);
        for (let index = 0; index < left.length; index += 1) {
            if (left[index] !== right[index]) return left[index] > right[index] ? -1 : 1;
        }
        return 0;
    })[0];
}

async function dedupeAll() {
    const records = await listRecords();
    const groups = new Map();
    records.forEach((record) => {
        const key = record.identity.sha256 || record.id;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(record);
    });
    let changed = 0;
    for (const group of groups.values()) {
        if (group.length < 2) continue;
        const master = chooseMaster(group);
        for (const record of group) {
            const next = record.id === master.id
                ? { isMaster: true, of: null }
                : { isMaster: false, of: master.id };
            if (record.master.isMaster !== next.isMaster || record.master.of !== next.of) {
                record.master = next;
                await saveAsset(record);
                changed += 1;
            }
        }
    }

    // Near duplicates: 64-bit pHash, Hamming <= 6, connected components.
    const hashed = records.filter((record) => record.identity.pHash);
    const parent = new Map(hashed.map((record) => [record.id, record.id]));
    const find = (id) => {
        let current = id;
        while (parent.get(current) !== current) current = parent.get(current);
        return current;
    };
    const union = (a, b) => {
        const left = find(a);
        const right = find(b);
        if (left !== right) parent.set(right, left);
    };
    for (let i = 0; i < hashed.length; i += 1) {
        for (let j = i + 1; j < hashed.length; j += 1) {
            const distance = Intel.phashDistance(hashed[i].identity.pHash, hashed[j].identity.pHash);
            if (distance != null && distance <= 6) union(hashed[i].id, hashed[j].id);
        }
    }
    const near = new Map();
    hashed.forEach((record) => {
        const root = find(record.id);
        if (!near.has(root)) near.set(root, []);
        near.get(root).push(record);
    });
    for (const group of near.values()) {
        if (group.length < 2) continue;
        const master = chooseMaster(group);
        for (const record of group) {
            const next = record.id === master.id
                ? { isMaster: true, of: null }
                : { isMaster: false, of: master.id };
            if (record.master.isMaster !== next.isMaster || record.master.of !== next.of) {
                record.master = next;
                await saveAsset(record);
                changed += 1;
            }
        }
    }
    return changed;
}

async function analyzeAsset(id) {
    const record = await readAsset(id);
    const format = String(record.identity.format || '').toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(format)) {
        return { asset: record, warning: `${format === 'svg' ? 'SVG' : format.toUpperCase()} analysis is not supported by Pillow; dimensions are already recorded.` };
    }
    const status = await AssetService.status();
    if (!status.available) {
        return { asset: record, warning: status.reason || 'The asset sidecar is unavailable.' };
    }
    const file = resolveFile(record, 'original');
    const info = await AssetService.inspect(file.path);
    record.identity = {
        ...record.identity,
        pHash: info.pHash || record.identity.pHash,
        palette: info.palette || record.identity.palette,
        alpha: info.alpha,
        width: info.width || record.identity.width,
        height: info.height || record.identity.height,
        format: info.format || record.identity.format,
        capturedAt: info.exif?.capturedAt || record.identity.capturedAt,
    };
    if (info.thumbnail) {
        await fsp.writeFile(path.join(assetDir(record.id), THUMB), Buffer.from(info.thumbnail, 'base64'));
        if (!record.variants.some((variant) => variant.id === 'thumb')) {
            record.variants.push({
                id: 'thumb', op: 'resize', params: { width: 320 },
                url: assetUrl(record.id, 'thumb'),
                width: info.width || null, height: info.height || null,
                format: 'webp', bytes: Buffer.from(info.thumbnail, 'base64').length,
            });
        }
    }
    record.fit = Intel.brandFit(record, { palette: await brandPalette(record.binding.packId, record.binding.brandId) });
    await saveAsset(record);
    return { asset: record, warning: '' };
}

async function runOperation(id, op, params = {}) {
    const record = await readAsset(id);
    if (!record.operations.includes(op)) throw httpError(409, 'This asset does not declare that operation.');
    const meta = Intel.OPERATIONS[op];
    if (!meta || !['sidecar', 'browser'].includes(meta.executable)) {
        throw httpError(409, `${op} is a declaration, not a file operation.`);
    }
    if (op === 'extract-rows' || op === 'extract-text') {
        const status = await AssetService.status();
        if (!status.available) throw httpError(503, status.reason || 'The asset sidecar is unavailable.');
        const input = resolveFile(record, 'original').path;
        const result = await AssetService.extract(input);
        record.extracted = {
            kind: op === 'extract-rows' ? 'menu' : 'text',
            method: result.method || 'sidecar',
            confidence: result.rows?.length ? 0.6 : 0.4,
            rows: result.rows || [],
            text: result.text || '',
        };
        record.review = { state: 'proposed', by: 'classifier', at: nowIso(), note: 'Confirm the extracted content.' };
        await saveAsset(record);
        return { asset: record, warnings: result.warnings || [] };
    }
    if (op === 'qr') throw httpError(409, 'QR codes are generated in the browser.');
    if (op === 'recolour' && String(record.identity.format).toLowerCase() === 'svg') {
        const colour = String(params.color || params.colour || '').trim();
        if (!/^#?[0-9a-f]{6}$/i.test(colour)) throw httpError(400, 'recolour needs a #rrggbb colour.');
        const hex = colour.startsWith('#') ? colour : `#${colour}`;
        const input = resolveFile(record, 'original').path;
        let source = await fsp.readFile(input, 'utf8');
        source = source
            .replace(/(fill|stroke)=["'](?!none|currentColor|url\()[^"']+["']/gi, `$1="${hex}"`)
            .replace(/<svg\b/i, `<svg data-recoloured="${hex}"`);
        if (record.variants.length >= MAX_VARIANTS) throw httpError(409, 'This asset already has eight variants.');
        const variantId = `recolour-${record.variants.length + 1}`;
        const output = path.join(assetDir(record.id), 'variants', `${variantId}.svg`);
        await fsp.mkdir(path.dirname(output), { recursive: true });
        await fsp.writeFile(output, source);
        const variant = {
            id: variantId, op, params,
            url: assetUrl(record.id, variantId),
            width: record.identity.width, height: record.identity.height,
            format: 'svg', bytes: Buffer.byteLength(source),
        };
        record.variants.push(variant);
        await saveAsset(record);
        return { asset: record, variant };
    }
    if (String(record.identity.format).toLowerCase() === 'svg') {
        throw httpError(409, 'SVG resize/crop is not supported; use the logo directly in a design.');
    }
    const status = await AssetService.status();
    if (!status.available) throw httpError(503, status.reason || 'The asset sidecar is unavailable.');
    if (record.variants.length >= MAX_VARIANTS) throw httpError(409, 'This asset already has the maximum of eight variants.');
    const input = resolveFile(record, 'original').path;
    const ext = record.identity.format === 'svg' ? 'png' : (record.identity.format || 'png');
    const variantId = `${op}-${record.variants.length + 1}`;
    const output = path.join(assetDir(record.id), 'variants', `${variantId}.${ext}`);
    const result = await AssetService.operate(op, input, output, params);
    const variant = {
        id: variantId, op, params,
        url: assetUrl(record.id, variantId),
        width: result.width, height: result.height,
        format: result.format || ext, bytes: result.bytes,
    };
    record.variants.push(variant);
    await saveAsset(record);
    return { asset: record, variant };
}

async function recordUsage(events = []) {
    const list = (Array.isArray(events) ? events : []).slice(0, 100);
    const valid = [];
    for (const event of list) {
        if (!event || !Intel.isId(event.assetId)) continue;
        try {
            const record = await readAsset(event.assetId);
            const action = ['design', 'download', 'print'].includes(event.action) ? event.action : 'design';
            record.usageLog[action === 'design' ? 'designs' : 'downloads'] += 1;
            record.usageLog.lastUsedAt = nowIso();
            await saveAsset(record);
            valid.push({
                assetId: record.id, action,
                designId: String(event.designId || '').slice(0, 80) || null,
                size: String(event.size || '').slice(0, 80) || null,
                profile: String(event.profile || '').slice(0, 40) || null,
                at: nowIso(),
            });
        } catch {
            /* unknown ids are ignored, not a batch failure */
        }
    }
    if (!valid.length) return { recorded: 0 };
    let existing = await readJson(USAGE_FILE, []);
    if (!Array.isArray(existing)) existing = [];
    const next = [...existing, ...valid].slice(-MAX_USAGE_EVENTS);
    await writeJson(USAGE_FILE, next);
    return { recorded: valid.length };
}

async function assetUsage(id) {
    const record = await readAsset(id);
    const events = await readJson(USAGE_FILE, []);
    const recent = (Array.isArray(events) ? events : []).filter((event) => event.assetId === id).slice(-30).reverse();
    return { assetId: id, counts: record.usageLog, recent };
}

async function assetHealth(filters = {}) {
    const records = (await listRecords()).filter((record) => {
        if (filters.packId && record.binding.packId !== filters.packId) return false;
        if (filters.brandId && record.binding.brandId !== filters.brandId) return false;
        return true;
    });
    const byClass = {};
    const byState = {};
    let duplicates = 0;
    let orphaned = 0;
    let paletteDrift = 0;
    let bytes = 0;
    records.forEach((record) => {
        byClass[record.class] = (byClass[record.class] || 0) + 1;
        byState[record.review.state] = (byState[record.review.state] || 0) + 1;
        if (record.master.of) duplicates += 1;
        if (record.status === 'orphaned') orphaned += 1;
        if ((record.fit.warnings || []).includes('PALETTE_DRIFT')) paletteDrift += 1;
        bytes += record.identity.bytes || 0;
    });
    return {
        total: records.length,
        verified: byState.verified || 0,
        proposed: byState.proposed || 0,
        rejected: byState.rejected || 0,
        duplicates,
        orphaned,
        paletteDrift,
        bytes,
        byClass,
        byState,
    };
}

module.exports = {
    ASSETS_DIR,
    mimeFor,
    MIME,
    MAX_ASSETS,
    listAssets,
    readAsset,
    saveAsset,
    patchAsset,
    verifyAsset,
    deleteAsset,
    markPackOrphaned,
    indexPack,
    ingestAssets,
    analyzeAsset,
    runOperation,
    recordUsage,
    assetUsage,
    assetHealth,
    resolveFile,
    assetUrl,
    loadPackAssets,
    dedupeAll,
};
