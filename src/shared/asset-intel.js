'use strict';
/**
 * asset-intel.js — shared Business Asset Intelligence contract.
 *
 * Pure logic only: no DOM, no fs, no fetch. Loaded as a plain <script> after
 * studio-core.js in the browser and require()-able from Node, so the same
 * normaliser, taxonomy, fit score and usage rules drive the library, the
 * server and Asset Studio.
 *
 * Schema: layer-studio/asset/v1
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.AssetIntel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const SCHEMA = 'layer-studio/asset/v1';
    const ID_PATTERN = /^ast_[A-Za-z0-9_-]{1,72}$/;
    const HASH_PATTERN = /^[a-f0-9]{64}$/i;
    const PHASH_PATTERN = /^[a-f0-9]{16}$/i;
    const MAX_NAME = 120;
    const MAX_TAGS = 12;
    const MAX_TAG = 32;
    const MAX_NOTES = 280;
    const MAX_VARIANTS = 8;
    const MAX_ROWS = 200;
    const MAX_EXTRACT_TEXT = 20000;

    const CLASSES = [
        'brand-identity',
        'food-product',
        'premises',
        'people',
        'marketing-collateral',
        'content',
        'business-document',
        'compliance',
        'unclassified',
    ];

    const OPERATIONS = {
        resize: { executable: 'sidecar', phase: 3, label: 'Resize' },
        crop: { executable: 'sidecar', phase: 3, label: 'Crop' },
        recolour: { executable: 'sidecar', phase: 3, label: 'Recolour' },
        compose: { executable: 'declaration', phase: 1, label: 'Use in a design' },
        'extract-rows': { executable: 'sidecar', phase: 4, label: 'Extract rows' },
        'extract-text': { executable: 'sidecar', phase: 4, label: 'Extract text' },
        preflight: { executable: 'declaration', phase: 3, label: 'Print check' },
        qr: { executable: 'browser', phase: 3, label: 'QR code' },
        transcribe: { executable: 'none', phase: null, label: 'Transcribe' },
    };

    const OPERATION_NAMES = Object.keys(OPERATIONS);

    const CLASS_DEFAULTS = {
        'brand-identity': ['resize', 'recolour', 'compose', 'preflight'],
        'food-product': ['crop', 'resize', 'compose'],
        premises: ['crop', 'resize', 'compose'],
        people: ['crop', 'resize', 'compose'],
        'marketing-collateral': ['crop', 'resize', 'extract-text', 'compose'],
        content: ['extract-text'],
        'business-document': ['extract-rows', 'extract-text', 'resize'],
        compliance: ['extract-rows', 'preflight', 'resize'],
        unclassified: ['resize'],
    };

    const USAGE_PROFILES = ['print-and-screen', 'screen-only', 'print-only', 'reference-only'];
    const CONSENT = ['not-applicable', 'granted', 'missing'];
    const RIGHTS = ['brand-owned', 'licensed', 'staff-supplied', 'unknown'];
    // Two independent questions, deliberately not collapsed into one list:
    //   provenance.kind  — where the file came from (supplied / public / …)
    //   review.state     — what we are allowed to do with it (cleared / not)
    // "It is on the public web" answers the first and says nothing about the
    // second.
    const PROVENANCE_KINDS = ['supplied', 'public', 'extracted', 'inferred', 'unknown'];
    const PROVENANCE_CONFIDENCE = ['high', 'medium', 'low'];
    const REVIEW_STATES = ['proposed', 'verified', 'approved', 'rejected'];
    const STATUSES = ['active', 'archived', 'orphaned'];

    const RULES = [
        { code: 'ASSET_ORPHANED', severity: 'block', label: 'Source pack deleted' },
        { code: 'ASSET_REJECTED', severity: 'block', label: 'Asset rejected in review' },
        { code: 'USAGE_PROFILE_BLOCK', severity: 'block', label: 'Usage profile excludes this export' },
        { code: 'FORMAT_DENIED', severity: 'block', label: 'Format not allowed for this asset' },
        { code: 'CONSENT_MISSING', severity: 'block', label: 'Consent missing' },
        { code: 'MIN_WIDTH', severity: 'block', label: 'Too small for the page' },
        { code: 'RIGHTS_UNKNOWN', severity: 'warn', label: 'Rights unknown' },
        { code: 'RIGHTS_UNRESOLVED', severity: 'block', label: 'Rights unknown and not approved' },
        { code: 'PROVENANCE_UNKNOWN', severity: 'warn', label: 'Provenance not classified' },
        { code: 'PALETTE_DRIFT', severity: 'warn', label: 'Palette drift' },
        { code: 'ASSET_UNVERIFIED', severity: 'warn', label: 'Not verified' },
        { code: 'PRINT_DPI', severity: 'warn', label: 'Below page resolution' },
        { code: 'DUPLICATE', severity: 'warn', label: 'Duplicate of another asset' },
    ];

    const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
    const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
    const round2 = (value) => Math.round(Number(value) * 100) / 100;

    function text(value, limit) {
        if (typeof value !== 'string') return '';
        return value.replace(/\s+/g, ' ').trim().slice(0, limit || 400);
    }

    function slug(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48) || 'asset';
    }

    function assetId(name, sha) {
        const prefix = String(sha || '').replace(/[^a-f0-9]/gi, '').slice(0, 10)
            || Math.random().toString(16).slice(2, 12);
        return `ast_${slug(name).slice(0, 42)}-${prefix}`.slice(0, 78);
    }

    function isId(value) {
        return ID_PATTERN.test(String(value || ''));
    }

    function normalizeHex(value) {
        if (typeof value !== 'string') return '';
        const trimmed = value.trim().toLowerCase();
        if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
        const short = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
        if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
        return '';
    }

    function hexToRgb(hex) {
        const value = normalizeHex(hex) || '#000000';
        return {
            r: parseInt(value.slice(1, 3), 16),
            g: parseInt(value.slice(3, 5), 16),
            b: parseInt(value.slice(5, 7), 16),
        };
    }

    function rgbToLab(rgb) {
        const channel = (value) => {
            const v = value / 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        const r = channel(rgb.r);
        const g = channel(rgb.g);
        const b = channel(rgb.b);
        let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
        let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0;
        let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
        const pivot = (value) => (value > 0.008856 ? Math.cbrt(value) : (7.787 * value) + 16 / 116);
        x = pivot(x);
        y = pivot(y);
        z = pivot(z);
        return { l: (116 * y) - 16, a: 500 * (x - y), b: 200 * (y - z) };
    }

    function deltaE(hexA, hexB) {
        const a = rgbToLab(hexToRgb(hexA));
        const b = rgbToLab(hexToRgb(hexB));
        return Math.sqrt(((a.l - b.l) ** 2) + ((a.a - b.a) ** 2) + ((a.b - b.b) ** 2));
    }

    function normalizeIdentity(value) {
        const source = value && typeof value === 'object' ? value : {};
        const width = Math.max(0, Math.round(finite(source.width, 0)));
        const height = Math.max(0, Math.round(finite(source.height, 0)));
        return {
            sha256: HASH_PATTERN.test(String(source.sha256 || '')) ? String(source.sha256).toLowerCase() : '',
            pHash: PHASH_PATTERN.test(String(source.pHash || '')) ? String(source.pHash).toLowerCase() : '',
            bytes: Math.max(0, Math.round(finite(source.bytes, 0))),
            format: text(source.format, 16).toLowerCase().replace(/^\./, ''),
            width: width || null,
            height: height || null,
            aspect: width && height ? round2(width / height) : null,
            alpha: typeof source.alpha === 'boolean' ? source.alpha : null,
            capturedAt: text(source.capturedAt, 40) || null,
            palette: (Array.isArray(source.palette) ? source.palette : [])
                .map(normalizeHex).filter(Boolean).slice(0, 8),
        };
    }

    function normalizeSource(value) {
        const source = value && typeof value === 'object' ? value : {};
        const kind = source.kind === 'pack' ? 'pack' : 'upload';
        const path = text(source.path, 240).replace(/\\/g, '/').replace(/^\/+/, '');
        return {
            kind,
            channel: text(source.channel, 40) || (kind === 'pack' ? 'brand-pack' : 'upload'),
            packId: text(source.packId, 80) || null,
            brandId: text(source.brandId, 80) || null,
            path: path && !path.includes('..') ? path : '',
            originName: text(source.originName, 180) || '',
            capturedAt: text(source.capturedAt, 40) || null,
            uploadedBy: text(source.uploadedBy, 80) || null,
        };
    }

    function normalizeBinding(value) {
        const binding = value && typeof value === 'object' ? value : {};
        return {
            packId: text(binding.packId, 80) || null,
            brandId: text(binding.brandId, 80) || null,
            match: ['declared', 'manual', 'inferred'].includes(binding.match) ? binding.match : 'inferred',
            confidence: clamp(finite(binding.confidence, 0), 0, 1),
        };
    }

    function operationsFor(cls, overrides) {
        const defaults = CLASS_DEFAULTS[cls] || CLASS_DEFAULTS.unclassified;
        const selected = Array.isArray(overrides) && overrides.length ? overrides : defaults;
        return [...new Set(selected)]
            .filter((op) => OPERATION_NAMES.includes(op))
            .filter((op) => OPERATIONS[op].executable !== 'none')
            .slice(0, 12);
    }

    function normalizeUsage(value) {
        const usage = value && typeof value === 'object' ? value : {};
        const formats = usage.formats && typeof usage.formats === 'object' ? usage.formats : {};
        const unique = (list) => [...new Set((Array.isArray(list) ? list : [])
            .map((item) => text(item, 60)).filter(Boolean))].slice(0, 16);
        return {
            profile: USAGE_PROFILES.includes(usage.profile) ? usage.profile : 'print-and-screen',
            printMinDpi: Math.round(clamp(finite(usage.printMinDpi, 300), 72, 600)),
            formats: { allow: unique(formats.allow), deny: unique(formats.deny) },
            consent: CONSENT.includes(usage.consent) ? usage.consent : 'not-applicable',
            rights: RIGHTS.includes(usage.rights) ? usage.rights : 'unknown',
            notes: text(usage.notes, MAX_NOTES),
        };
    }

    function normalizeFit(value) {
        const fit = value && typeof value === 'object' ? value : {};
        return {
            score: round2(clamp(finite(fit.score, 0), 0, 1)),
            paletteDelta: fit.paletteDelta == null ? null : round2(clamp(finite(fit.paletteDelta, 0), 0, 100)),
            logoMatch: ['exact', 'near', 'none'].includes(fit.logoMatch) ? fit.logoMatch : 'none',
            warnings: (Array.isArray(fit.warnings) ? fit.warnings : []).map((item) => text(item, 60)).filter(Boolean).slice(0, 8),
        };
    }

    function normalizeVariant(value) {
        const variant = value && typeof value === 'object' ? value : {};
        const id = text(variant.id, 40);
        if (!id || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) return null;
        return {
            id,
            op: OPERATION_NAMES.includes(variant.op) ? variant.op : 'resize',
            params: variant.params && typeof variant.params === 'object' ? variant.params : {},
            url: text(variant.url, 300),
            width: Math.max(0, Math.round(finite(variant.width, 0))) || null,
            height: Math.max(0, Math.round(finite(variant.height, 0))) || null,
            format: text(variant.format, 16).toLowerCase(),
            bytes: Math.max(0, Math.round(finite(variant.bytes, 0))),
        };
    }

    function normalizeExtracted(value) {
        if (!value || typeof value !== 'object') return null;
        const rows = (Array.isArray(value.rows) ? value.rows : [])
            .map((row) => text(row, 300)).filter(Boolean).slice(0, MAX_ROWS);
        const plain = text(value.text, MAX_EXTRACT_TEXT);
        if (!rows.length && !plain) return null;
        return {
            kind: text(value.kind, 40) || 'text',
            method: text(value.method, 40) || 'node',
            confidence: round2(clamp(finite(value.confidence, 0), 0, 1)),
            rows,
            text: plain,
        };
    }

    function normalizeReview(value) {
        const review = value && typeof value === 'object' ? value : {};
        return {
            state: REVIEW_STATES.includes(review.state) ? review.state : 'proposed',
            by: text(review.by, 80) || 'classifier',
            at: text(review.at, 40) || null,
            note: text(review.note, 280),
        };
    }

    /**
     * Where the file came from. Deliberately defaults to `unknown`, not to
     * `supplied`: most pack photography travels in a ZIP that was assembled
     * from a public website, and guessing "supplied" here would quietly assert
     * a right nobody confirmed. Classifying it is the operator's job.
     */
    function normalizeProvenance(value) {
        const provenance = value && typeof value === 'object' ? value : {};
        return {
            kind: PROVENANCE_KINDS.includes(provenance.kind) ? provenance.kind : 'unknown',
            confidence: PROVENANCE_CONFIDENCE.includes(provenance.confidence)
                ? provenance.confidence
                : 'low',
            note: text(provenance.note, 280),
        };
    }

    /** The single answer to "may this asset be used for real output?" */
    function approvalOf(value) {
        const asset = normalizeAsset(value);
        const state = asset.review.state;
        const rightsKnown = asset.usage.rights !== 'unknown';
        const cleared = state === 'approved';
        return {
            state,
            provenance: asset.provenance.kind,
            rights: asset.usage.rights,
            // `approved` is the only clearance that survives unknown rights.
            usable: state !== 'rejected' && (rightsKnown || cleared),
            reason: state === 'rejected' ? 'rejected in review'
                : cleared ? 'approved'
                    : rightsKnown ? `rights: ${asset.usage.rights}`
                        : 'rights unknown — approve to clear',
        };
    }

    function normalizeMaster(value) {
        const master = value && typeof value === 'object' ? value : {};
        const of = isId(master.of) ? master.of : null;
        return {
            isMaster: typeof master.isMaster === 'boolean' ? master.isMaster : !of,
            of,
        };
    }

    function normalizeUsageLog(value) {
        const log = value && typeof value === 'object' ? value : {};
        return {
            designs: Math.max(0, Math.round(finite(log.designs, 0))),
            downloads: Math.max(0, Math.round(finite(log.downloads, 0))),
            lastUsedAt: text(log.lastUsedAt, 40) || null,
        };
    }

    function normalizeAsset(value, options = {}) {
        const source = value && typeof value === 'object' ? value : {};
        const identity = normalizeIdentity(source.identity);
        const name = text(source.name, MAX_NAME) || 'Untitled asset';
        const id = isId(source.id) ? source.id : (isId(options.id) ? options.id : assetId(name, identity.sha256));
        const cls = CLASSES.includes(source.class) ? source.class : 'unclassified';
        const operations = operationsFor(cls, source.operations);
        const extracted = normalizeExtracted(source.extracted);
        return {
            schema: SCHEMA,
            id,
            name,
            class: cls,
            role: text(source.role, 40) || 'photo',
            tags: [...new Set((Array.isArray(source.tags) ? source.tags : [])
                .map((tag) => text(tag, MAX_TAG).toLowerCase()).filter(Boolean))].slice(0, MAX_TAGS),
            identity,
            source: normalizeSource(source.source),
            binding: normalizeBinding(source.binding || source.source),
            operations,
            usage: normalizeUsage(source.usage),
            fit: normalizeFit(source.fit),
            variants: (Array.isArray(source.variants) ? source.variants : [])
                .map(normalizeVariant).filter(Boolean).slice(0, MAX_VARIANTS),
            extracted: extracted && operations.some((op) => op.startsWith('extract-')) ? extracted : null,
            master: normalizeMaster(source.master),
            provenance: normalizeProvenance(source.provenance),
            review: normalizeReview(source.review),
            status: STATUSES.includes(source.status) ? source.status : 'active',
            usageLog: normalizeUsageLog(source.usageLog),
            createdAt: text(source.createdAt, 40) || null,
            updatedAt: text(source.updatedAt, 40) || null,
        };
    }

    function taxonomy() {
        return {
            schema: SCHEMA,
            classes: CLASSES.map((id) => ({
                id,
                operations: CLASS_DEFAULTS[id].slice(),
            })),
            operations: Object.entries(OPERATIONS).map(([id, meta]) => ({
                id, ...meta,
            })),
            rules: RULES.map((rule) => ({ ...rule })),
        };
    }

    function uniqueCodes(items) {
        const seen = new Set();
        return items.filter((item) => {
            const key = `${item.code}|${item.assetId || ''}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function evaluateUsage(assets, context = {}) {
        const list = (Array.isArray(assets) ? assets : [assets]).filter(Boolean);
        const spec = context.spec || {};
        const size = context.size || {};
        const surface = context.surface || 'export';
        const profile = context.profile || 'print';
        const isPrint = surface === 'print' || profile === 'print';
        const sizeName = text(size.n, 80);
        const blockers = [];
        const warnings = [];
        const add = (target, kind, asset, detail) => {
            target.push({
                code: kind.code,
                severity: kind.severity,
                assetId: asset.id,
                assetName: asset.name,
                label: kind.label,
                message: `${asset.name}: ${detail}`,
            });
        };

        list.forEach((raw) => {
            const asset = normalizeAsset(raw);
            const usage = asset.usage;
            const rule = (code) => RULES.find((item) => item.code === code);
            const block = (code, detail) => add(blockers, rule(code), asset, detail);
            const warn = (code, detail) => add(warnings, rule(code), asset, detail);

            if (asset.status === 'orphaned') block('ASSET_ORPHANED', 'its source brand pack was deleted.');
            if (asset.review.state === 'rejected') block('ASSET_REJECTED', 'it was rejected in review.');
            if (surface !== 'library') {
                if (usage.profile === 'reference-only') {
                    block('USAGE_PROFILE_BLOCK', 'the asset is reference-only.');
                } else if (usage.profile === 'screen-only' && isPrint) {
                    block('USAGE_PROFILE_BLOCK', 'this photo is marked screen-only.');
                } else if (usage.profile === 'print-only' && !isPrint) {
                    block('USAGE_PROFILE_BLOCK', 'this asset is print-only.');
                }
                if (usage.formats.deny.includes(sizeName)) {
                    block('FORMAT_DENIED', `${sizeName || 'this format'} is denied.`);
                } else if (usage.formats.allow.length && !usage.formats.allow.includes(sizeName)) {
                    block('FORMAT_DENIED', `${sizeName || 'this format'} is not in the allowlist.`);
                }
                if (asset.class === 'people' && usage.consent === 'missing') {
                    block('CONSENT_MISSING', 'consent is marked as missing.');
                }
                // Rights are the one thing a public URL never settles. An asset
                // with unknown rights may not leave the library until somebody
                // approves it by name.
                if (usage.rights === 'unknown' && asset.review.state !== 'approved') {
                    block('RIGHTS_UNRESOLVED',
                        'rights are unknown and it has not been approved for use.');
                } else if (isPrint && usage.rights === 'unknown') {
                    warn('RIGHTS_UNKNOWN', 'rights are unknown — confirmed in review.');
                }
                if (asset.provenance.kind === 'unknown') {
                    warn('PROVENANCE_UNKNOWN', 'provenance is unclassified — say where it came from.');
                }
                if (asset.review.state === 'proposed') {
                    warn('ASSET_UNVERIFIED', 'it has not been verified in the library.');
                }
                if (asset.master.of) {
                    warn('DUPLICATE', `it is a duplicate of ${asset.master.of}.`);
                }
                if (asset.fit.score && asset.fit.score < 0.55) {
                    warn('PALETTE_DRIFT', 'its palette is distant from the brand palette.');
                }

                if (isPrint && spec && Number(spec.w) > 0 && Number(spec.h) > 0) {
                    const pageDpi = Number(size.dpi || spec.dpi) || 150;
                    const dir = Math.max(pageDpi, usage.printMinDpi || 0);
                    const short = Math.min(asset.identity.width || 0, asset.identity.height || 0);
                    const need = Math.ceil((Math.min(Number(spec.w), Number(spec.h)) / 25.4) * dir);
                    const allowed = usage.formats.allow.includes(sizeName);
                    if (short && need) {
                        const ratio = short / need;
                        if (ratio < 0.5) {
                            (allowed ? warn : block)('MIN_WIDTH',
                                `${short} px for a ${need} px short edge at ${dir} dpi.`);
                        } else if (ratio < 1) {
                            warn('PRINT_DPI',
                                `${short} px is below the ${need} px short edge at ${dir} dpi.`);
                        }
                    }
                }
            }
        });

        return {
            ok: blockers.length === 0,
            blockers: uniqueCodes(blockers),
            warnings: uniqueCodes(warnings),
        };
    }

    function brandFit(asset, brand) {
        const record = normalizeAsset(asset);
        const paletteEntries = Array.isArray(brand?.palette)
            ? brand.palette
            : (Array.isArray(brand?.color) ? brand.color : []);
        const palette = paletteEntries
            .map((entry) => normalizeHex(entry?.hex || entry?.value || entry))
            .filter(Boolean).slice(0, 24);
        const dominant = record.identity.palette.slice(0, 5);
        let paletteDelta = null;
        if (palette.length && dominant.length) {
            paletteDelta = Math.min(...dominant.map((color) => Math.min(
                ...palette.map((entry) => deltaE(color, entry)),
            )));
        }
        const paletteScore = paletteDelta == null ? 0.7 : 1 - clamp(paletteDelta / 80, 0, 1);
        const logoScore = record.role === 'logo' ? 1 : 0;
        const shortEdge = Math.min(record.identity.width || 0, record.identity.height || 0);
        const resolutionScore = clamp(shortEdge / 1600, 0, 1);
        const score = round2((0.55 * paletteScore) + (0.25 * logoScore) + (0.20 * resolutionScore));
        return {
            score,
            paletteDelta: paletteDelta == null ? null : round2(paletteDelta),
            logoMatch: logoScore ? 'exact' : 'none',
            warnings: paletteDelta != null && paletteDelta > 40 ? ['PALETTE_DRIFT'] : [],
        };
    }

    function phashDistance(a, b) {
        if (!PHASH_PATTERN.test(String(a || '')) || !PHASH_PATTERN.test(String(b || ''))) return null;
        let distance = 0;
        for (let index = 0; index < 16; index += 1) {
            let xor = parseInt(a[index], 16) ^ parseInt(b[index], 16);
            while (xor) {
                distance += xor & 1;
                xor >>= 1;
            }
        }
        return distance;
    }

    function extractRowsFromText(source) {
        const price = /[£$€]\s*\d{1,4}(?:[.,]\d{1,2})?/;
        const rows = [];
        let section = '';
        String(source || '').split(/\r?\n/).forEach((raw) => {
            const line = raw.replace(/\s+/g, ' ').trim();
            if (!line || line.length > 140) return;
            if (/^[A-Z][A-Z &]+$/.test(line) && line.length <= 40) {
                section = line;
                rows.push(`# ${line}`);
                return;
            }
            const match = price.exec(line);
            if (match) {
                const name = line.slice(0, match.index).trim().replace(/[.|—-]+$/, '');
                if (!name) return;
                rows.push(`${name} | | ${match[0].replace(/\s+/g, '')}`);
                return;
            }
            if (section && line.length <= 80) {
                rows.push(`${line} | | `);
            }
        });
        return rows.slice(0, MAX_ROWS);
    }

    return {
        SCHEMA,
        ID_PATTERN,
        CLASSES,
        OPERATIONS,
        OPERATION_NAMES,
        CLASS_DEFAULTS,
        USAGE_PROFILES,
        CONSENT,
        RIGHTS,
        REVIEW_STATES,
        PROVENANCE_KINDS,
        PROVENANCE_CONFIDENCE,
        STATUSES,
        RULES,
        clamp,
        text,
        slug,
        assetId,
        isId,
        normalizeHex,
        hexToRgb,
        deltaE,
        normalizeIdentity,
        normalizeSource,
        normalizeBinding,
        operationsFor,
        normalizeUsage,
        normalizeFit,
        normalizeVariant,
        normalizeExtracted,
        normalizeReview,
        normalizeProvenance,
        approvalOf,
        normalizeMaster,
        normalizeUsageLog,
        normalizeAsset,
        taxonomy,
        evaluateUsage,
        brandFit,
        phashDistance,
        extractRowsFromText,
    };
}));
