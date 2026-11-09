'use strict';

/**
 * Build the agent-facing index for HTML-derived LayerStudio projects.
 *
 * The HTML pipeline writes one composition per stage. That is enough for the
 * editor, but not enough for an agent: it cannot tell which layers belong to a
 * menu item, which photo/shape set forms a group, or which animation clips can
 * be safely combined. This module reads the generated projects and derives:
 *
 *   business → collection → composition → scene → group → layer/asset
 *                                      └→ animation clips
 *
 * Everything is derived from the composition files, so re-running the HTML
 * importer and rebuilding the index keeps the library current.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const SCHEMA = 'agent-studio/library/1';
const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'of', 'for', 'cafe', 'café', 'restaurant', 'collection', 'posts', 'post', 'reels', 'reel', 'story', 'stories', 'concepts', 'concept', 'brand', 'project', '01', '02', '03']);
const CONTACT_RE = /(?:@|https?:|www\.|\.co\.uk|\.com|\+\d[\d\s()-]{6,}|\b(?:street|st|road|rd|avenue|ave|lane|ln|boulevard|blvd)\b)/i;
const PRICE_RE = /(?:[£$€]\s?\d[\d.,]*|\b\d+[.,]\d{2}\b)/;
const CTA_RE = /\b(book|order|reserve|shop|buy|call|visit|subscribe|download|get|join|sign up|explore|discover)\b/i;

function slug(value, max = 90) {
    const text = String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
    return (text || 'item').slice(0, max).replace(/-+$/g, '');
}

function norm(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .trim();
}

function words(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function boundsOf(layers) {
    const boxes = layers
        .filter((layer) => layer && layer.visible !== false && ['x', 'y', 'w', 'h'].every((key) => Number.isFinite(Number(layer[key]))))
        .map((layer) => ({
            x: number(layer.x), y: number(layer.y),
            w: Math.max(0, number(layer.w)), h: Math.max(0, number(layer.h)),
        }));
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.w));
    const bottom = Math.max(...boxes.map((box) => box.y + box.h));
    return {
        x: +x.toFixed(3), y: +y.toFixed(3),
        w: +(right - x).toFixed(3), h: +(bottom - y).toFixed(3),
        cx: +((x + right) / 2).toFixed(3), cy: +((y + bottom) / 2).toFixed(3),
    };
}

function classifyText(layer) {
    const text = cleanText(layer && layer.text);
    const size = number(layer && layer.font && layer.font.sizePct, 0);
    const upper = text.replace(/[^A-Za-z]/g, '');
    const upperRatio = upper ? (text.replace(/[^A-Z]/g, '').length / upper.length) : 0;
    if (!text) return 'text';
    if (PRICE_RE.test(text)) return 'price';
    if (CONTACT_RE.test(text) || text.length > 90) return 'contact';
    if (CTA_RE.test(text)) return 'cta';
    if (size >= 12 || text.length <= 32 && size >= 9 && upperRatio > .7) return 'headline';
    if (text.length > 60) return 'body';
    if (size > 0 && size < 4.8 && text.length < 44) return 'badge';
    if (text.length <= 48) return 'menu-item';
    return 'text';
}

function groupKindForLayer(layer) {
    const meta = layer.meta || {};
    if (layer.role === 'background' || layer.id === 'html-bg') return 'background';
    if (meta.rasterized) return 'artwork';
    if (meta.isShape || meta.isBackground) return 'shape';
    if (layer.type === 'text') {
        const kind = classifyText(layer);
        if (kind === 'menu-item') return 'menu';
        if (kind === 'price') return 'prices';
        if (kind === 'contact') return 'contact';
        if (kind === 'headline') return 'headline';
        if (kind === 'badge') return 'badges';
        if (kind === 'body') return 'body';
        if (kind === 'cta') return 'cta';
        return 'text';
    }
    if (['image', 'video'].includes(layer.type)) return 'photos';
    return 'other';
}

const GROUP_LABELS = {
    background: 'Background',
    artwork: 'Artwork',
    photos: 'Photography',
    shape: 'Shapes',
    headline: 'Headlines',
    menu: 'Menu items',
    prices: 'Prices',
    body: 'Body copy',
    badges: 'Badges & labels',
    contact: 'Contact & footer',
    cta: 'Calls to action',
    text: 'Text',
    other: 'Other',
};

function animationSummary(layer, groupId) {
    const keys = Array.isArray(layer.keyframes) ? layer.keyframes.filter((key) => key && Number.isFinite(Number(key.time))) : [];
    if (keys.length < 2) return null;
    const sorted = [...keys].sort((a, b) => Number(a.time) - Number(b.time));
    const start = Math.max(0, number(sorted[0].time));
    const end = Math.max(start + 1, number(sorted[sorted.length - 1].time));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const channels = [];
    if (sorted.some((key) => number(key.x, first.x) !== number(first.x) || number(key.y, first.y) !== number(first.y))) channels.push('position');
    if (sorted.some((key) => number(key.w, first.w) !== number(first.w) || number(key.h, first.h) !== number(first.h))) channels.push('size');
    if (sorted.some((key) => number(key.opacity, first.opacity ?? 1) !== number(first.opacity ?? 1))) channels.push('opacity');
    if (sorted.some((key) => number(key.rotation, 0) !== number(first.rotation, 0))) channels.push('rotation');
    if (sorted.some((key) => key.clip != null)) channels.push('clip');
    const frameAt = (key) => ({
        t: Math.round(number(key.time)),
        x: +number(key.x, layer.x).toFixed(3),
        y: +number(key.y, layer.y).toFixed(3),
        w: +number(key.w, layer.w).toFixed(3),
        h: +number(key.h, layer.h).toFixed(3),
        opacity: +number(key.opacity, 1).toFixed(3),
        ...(key.rotation != null ? { rotation: +number(key.rotation).toFixed(3) } : {}),
        ...(key.clip ? { clip: key.clip } : {}),
    });
    const step = Math.max(1, Math.ceil(sorted.length / 24));
    const frames = sorted.filter((_, index) => index % step === 0 || index === sorted.length - 1).map(frameAt);
    return {
        id: `${layer.id}::animation`,
        layerId: layer.id,
        groupId,
        name: `${layer.name || layer.id} animation`,
        start, end, duration: end - start,
        keyCount: sorted.length,
        channels,
        frames,
        moving: channels.length > 0,
        first: frameAt(first),
        last: frameAt(last),
        window: {
            start: +number(layer.meta && layer.meta.start),
            end: layer.meta && layer.meta.end != null ? number(layer.meta.end) : null,
        },
    };
}

function buildScenes(layerAnimations, layers, groups, duration) {
    if (!layerAnimations.length) {
        return [{
            id: 'scene-01', label: 'Scene 1', start: 0, end: duration,
            layerIds: layers.map((layer) => layer.id), groupIds: groups.map((group) => group.id),
        }];
    }
    const cuts = new Set([0, duration]);
    layerAnimations.forEach((animation) => { cuts.add(animation.start); cuts.add(animation.end); });
    const times = [...cuts].filter((time) => time >= 0 && time <= duration).sort((a, b) => a - b);
    const intervals = [];
    for (let index = 0; index < times.length - 1; index += 1) {
        const start = times[index], end = times[index + 1];
        if (end - start >= 80) intervals.push({ start, end });
    }
    if (!intervals.length) intervals.push({ start: 0, end: duration });
    return intervals.slice(0, 12).map((interval, index) => {
        const active = layerAnimations.filter((animation) => animation.start < interval.end && animation.end > interval.start);
        const ids = new Set(active.map((animation) => animation.layerId));
        return {
            id: `scene-${String(index + 1).padStart(2, '0')}`,
            label: `Scene ${index + 1}`,
            start: interval.start, end: interval.end,
            layerIds: layers.filter((layer) => ids.has(layer.id)).map((layer) => layer.id),
            groupIds: groups.filter((group) => group.layerIds.some((id) => ids.has(id))).map((group) => group.id),
            animationIds: active.map((animation) => animation.id),
        };
    });
}

function brandBusiness(brand, pack) {
    const guidelines = brand.guidelines || (pack && pack.portfolio && pack.portfolio.guidelines) || {};
    const palette = Array.isArray(brand.palette)
        ? brand.palette.slice(0, 24).map((entry) => ({
            name: entry.name || entry.role || entry.hex,
            hex: entry.hex, role: entry.role || '', share: entry.share,
        })).filter((entry) => entry.hex)
        : [];
    return {
        id: brand.id || slug(brand.name),
        name: cleanText(brand.name || brand.wordmark || brand.id),
        aliases: unique([brand.name, brand.wordmark, brand.id, ...(brand.aliases || [])]).filter(Boolean),
        tagline: cleanText(brand.tagline),
        url: brand.url || brand.website || '',
        palette,
        guidelines: {
            positioning: cleanText(guidelines.positioning),
            contact: guidelines.contact || [],
            applications: guidelines.applications || [],
            printSpec: guidelines.printSpec || [],
            facts: guidelines.facts || [],
            typeHierarchy: guidelines.typeHierarchy || [],
        },
        packId: pack && pack.pack ? pack.pack.id : '',
        packName: pack && pack.pack ? pack.pack.name : '',
    };
}

async function readBrands(brandPacksDir) {
    const out = [];
    let entries = [];
    try { entries = await fsp.readdir(brandPacksDir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return out; throw error; }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const file = path.join(brandPacksDir, entry.name, 'pack.json');
        try {
            const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
            const pack = raw.pack ? raw : { pack: raw };
            (pack.brands || pack.pack.brands || []).forEach((brand) => out.push({ brand, pack }));
        } catch { /* incomplete pack */ }
    }
    return out;
}

function matchBusiness(sourceName, projectId, brands) {
    const source = norm(sourceName);
    const project = norm(projectId);
    let best = null;
    for (const entry of brands) {
        const brand = entry.brand;
        const name = norm(brand.name || brand.wordmark || '');
        const tokens = words(brand.name || brand.wordmark);
        let score = 0;
        if (name && (source.includes(name) || project.includes(name))) score += 100;
        const matched = tokens.filter((token) => source.includes(token) || project.includes(token));
        if (tokens.length) score += Math.round(50 * matched.length / tokens.length);
        if (matched.length >= Math.min(2, tokens.length)) score += 20;
        if (!best || score > best.score) best = { ...entry, score };
    }
    return best && best.score >= 20 ? best : null;
}

function parseSource(raw, projectId) {
    const source = cleanText(raw) || projectId;
    const cleaned = source.replace(/^\d+[-_\s]+/, '').trim();
    const parts = cleaned.split(/\s*[·•|]\s*/);
    const business = (parts[0] || cleaned).replace(/\s+[—–-]\s+\d+\s*$/, '').trim();
    const collection = (parts[1] || '').replace(/\s+[—–-]\s+\d+\s*$/, '').trim();
    return { source, business, collection };
}

function formatLabel(width, height) {
    const ratio = width / Math.max(1, height);
    if (Math.abs(ratio - 1) < .04) return 'square';
    if (ratio < .72) return 'story';
    if (ratio < .92) return 'portrait';
    if (ratio > 1.45) return 'wide';
    return 'landscape';
}

async function buildComposition(file, projectId, brands) {
    const composition = JSON.parse(await fsp.readFile(file, 'utf8'));
    const layers = Array.isArray(composition.layers) ? composition.layers : [];
    const sourceFacts = composition.sourceFacts || {};
    const parsed = parseSource(sourceFacts.htmlSource || composition.name, projectId);
    const matched = matchBusiness(parsed.business || parsed.source, projectId, brands);
    const business = matched ? brandBusiness(matched.brand, matched.pack) : {
        id: `business-${slug(parsed.business || projectId)}`,
        name: parsed.business || projectId,
        aliases: unique([parsed.business, parsed.source]), tagline: '', url: '', palette: [], guidelines: {},
    };
    if (!business.name) business.name = parsed.business || projectId;
    const compositionId = path.basename(file, '.composition.json');
    const width = Math.max(1, number(composition.width, 1080));
    const height = Math.max(1, number(composition.height, 1920));
    const duration = Math.max(1, number(composition.duration, 10000));
    const groupsById = new Map();
    const layerGroup = new Map();
    const addGroup = (kind, label, layer) => {
        const id = `${compositionId}::${kind}`;
        if (!groupsById.has(id)) groupsById.set(id, { id, kind, label, layerIds: [], layerTypes: {}, assetIds: [] });
        const group = groupsById.get(id);
        group.layerIds.push(layer.id);
        group.layerTypes[layer.type || 'other'] = (group.layerTypes[layer.type || 'other'] || 0) + 1;
        layerGroup.set(layer.id, id);
    };
    layers.forEach((layer) => addGroup(groupKindForLayer(layer), GROUP_LABELS[groupKindForLayer(layer)] || 'Group', layer));
    // Repeated CSS class signatures are useful "sets of grouped assets" too:
    // e.g. every .dish photo, every .badge, every .price.
    const classGroups = new Map();
    layers.forEach((layer) => {
        const classes = (layer.meta && layer.meta.cssClasses || []).filter((name) => name && !['abs', 'rel', 'fixed', 'on', 'stage', 'post'].includes(name));
        if (!classes.length) return;
        const signature = classes.slice().sort().join('.');
        if (!classGroups.has(signature)) classGroups.set(signature, []);
        classGroups.get(signature).push(layer.id);
    });
    [...classGroups.entries()].filter(([, ids]) => ids.length >= 2).slice(0, 16).forEach(([signature, ids]) => {
        const id = `${compositionId}::class-${slug(signature, 40)}`;
        groupsById.set(id, {
            id, kind: `class:${signature}`, label: `.${signature.replace(/\./g, '.')}`,
            layerIds: ids, layerTypes: {}, assetIds: [], classSignature: signature,
        });
    });
    const groups = [...groupsById.values()].map((group) => {
        const groupLayers = layers.filter((layer) => group.layerIds.includes(layer.id));
        const groupAnimations = groupLayers.map((layer) => animationSummary(layer, group.id)).filter(Boolean);
        return {
            ...group,
            layerIds: groupLayers.map((layer) => layer.id),
            bounds: boundsOf(groupLayers),
            zRange: groupLayers.length ? [Math.min(...groupLayers.map((layer) => number(layer.z))), Math.max(...groupLayers.map((layer) => number(layer.z)))] : null,
            timeRange: groupAnimations.length ? {
                start: Math.min(...groupAnimations.map((animation) => animation.start)),
                end: Math.max(...groupAnimations.map((animation) => animation.end)),
            } : null,
            animationIds: groupAnimations.map((animation) => animation.id),
            assetIds: [],
        };
    });
    const assets = [];
    layers.forEach((layer) => {
        const url = layer.url || layer.src || layer.videoUrl || '';
        if (!url || layer.type === 'text') return;
        const asset = {
            id: `${compositionId}::asset-${slug(layer.id, 60)}`,
            compositionId, layerId: layer.id, groupId: layerGroup.get(layer.id) || '',
            name: layer.name || layer.id, type: layer.type || 'image',
            role: layer.role || 'foreground', url,
            path: typeof url === 'string' && url.startsWith('/') ? url : '',
            isShape: Boolean(layer.meta && layer.meta.isShape),
            rasterized: Boolean(layer.meta && layer.meta.rasterized),
            bounds: ['x', 'y', 'w', 'h'].every((key) => Number.isFinite(Number(layer[key])))
                ? { x: +number(layer.x).toFixed(3), y: +number(layer.y).toFixed(3), w: +number(layer.w).toFixed(3), h: +number(layer.h).toFixed(3) }
                : null,
        };
        assets.push(asset);
        const group = groups.find((item) => item.id === asset.groupId);
        if (group) group.assetIds.push(asset.id);
    });
    const layerAnimations = layers.map((layer) => animationSummary(layer, layerGroup.get(layer.id) || '')).filter(Boolean);
    const groupAnimations = groups.map((group) => {
        const clips = layerAnimations.filter((animation) => group.layerIds.includes(animation.layerId));
        if (!clips.length) return null;
        return {
            id: group.id.replace(/::(?!.*::)/, '::anim::'),
            groupId: group.id, label: `${group.label} motion`,
            start: Math.min(...clips.map((animation) => animation.start)),
            end: Math.max(...clips.map((animation) => animation.end)),
            duration: Math.max(...clips.map((animation) => animation.end)) - Math.min(...clips.map((animation) => animation.start)),
            layerIds: clips.map((animation) => animation.layerId),
            channels: unique(clips.flatMap((animation) => animation.channels)),
            clipIds: clips.map((animation) => animation.id),
        };
    }).filter(Boolean);
    const textLayers = layers.filter((layer) => layer.type === 'text' && cleanText(layer.text));
    const menuItems = [];
    textLayers.forEach((layer) => {
        const kind = classifyText(layer);
        if (kind !== 'menu-item' && kind !== 'price') return;
        const priceMatch = cleanText(layer.text).match(PRICE_RE);
        const row = {
            id: `${compositionId}::menu-${slug(layer.id, 60)}`,
            compositionId, businessId: business.id, layerId: layer.id,
            groupId: layerGroup.get(layer.id) || '',
            text: cleanText(layer.text), kind,
            price: priceMatch ? priceMatch[0] : '',
            name: kind === 'menu-item' ? cleanText(layer.text) : '',
            priceText: kind === 'price' ? cleanText(layer.text) : '',
            box: { x: +number(layer.x).toFixed(3), y: +number(layer.y).toFixed(3), w: +number(layer.w).toFixed(3), h: +number(layer.h).toFixed(3) },
        };
        if (kind === 'menu-item') {
            const price = textLayers
                .filter((other) => other !== layer && PRICE_RE.test(cleanText(other.text)))
                .map((other) => ({ other, dy: Math.abs(number(other.y) - number(layer.y)), dx: Math.abs(number(other.x) - number(layer.x)) }))
                .filter((entry) => entry.dy < 12 && entry.dx < 70)
                .sort((a, b) => a.dy - b.dy || a.dx - b.dx)[0];
            if (price) {
                row.price = cleanText(price.other.text).match(PRICE_RE)?.[0] || '';
                row.priceLayerId = price.other.id;
                row.priceText = cleanText(price.other.text);
            }
        }
        menuItems.push(row);
    });
    const scenes = buildScenes(layerAnimations, layers, groups, duration);
    const original = layerAnimations.length ? {
        id: `${compositionId}::original`,
        label: 'Original animation',
        kind: 'original',
        start: Math.min(...layerAnimations.map((animation) => animation.start)),
        end: Math.max(...layerAnimations.map((animation) => animation.end)),
        layerIds: layerAnimations.map((animation) => animation.layerId),
        animationIds: layerAnimations.map((animation) => animation.id),
        channels: unique(layerAnimations.flatMap((animation) => animation.channels)),
    } : null;
    const tags = unique([
        parsed.collection, formatLabel(width, height), sourceFacts.kind,
        ...words(parsed.collection), ...words(composition.name),
    ]).slice(0, 20);
    return {
        business, composition: {
            id: compositionId,
            projectId,
            name: cleanText(composition.name) || compositionId,
            source: parsed.source,
            collection: parsed.collection,
            businessId: business.id,
            width, height, duration,
            format: formatLabel(width, height),
            layerCount: layers.length,
            textLayerCount: textLayers.length,
            imageLayerCount: layers.filter((layer) => layer.type === 'image').length,
            tags,
            warnings: Array.isArray(sourceFacts.warnings) ? sourceFacts.warnings.slice(0, 12) : [],
            sourceFacts: {
                htmlSource: sourceFacts.htmlSource || '',
                stageMetadata: sourceFacts.stageMetadata || {},
                kind: sourceFacts.kind || '',
            },
            layers: layers.map((layer) => ({
                id: layer.id, name: layer.name || layer.id, type: layer.type || 'other',
                role: layer.role || 'foreground', z: number(layer.z),
                text: cleanText(layer.text).slice(0, 500),
                box: ['x', 'y', 'w', 'h'].every((key) => Number.isFinite(Number(layer[key])))
                    ? { x: +number(layer.x).toFixed(3), y: +number(layer.y).toFixed(3), w: +number(layer.w).toFixed(3), h: +number(layer.h).toFixed(3) }
                    : null,
                groupId: layerGroup.get(layer.id) || '',
                textKind: layer.type === 'text' ? classifyText(layer) : '',
                visible: layer.visible !== false,
                meta: {
                    tag: layer.meta && layer.meta.tag || '',
                    cssClasses: layer.meta && layer.meta.cssClasses || [],
                    start: layer.meta && layer.meta.start,
                    end: layer.meta && layer.meta.end,
                    isShape: Boolean(layer.meta && layer.meta.isShape),
                    rasterized: Boolean(layer.meta && layer.meta.rasterized),
                    path: layer.meta && layer.meta.path || '',
                },
            })),
            groups, scenes, assets, menuItems,
            animations: {
                layer: layerAnimations,
                groups: groupAnimations,
                original,
            },
        },
    };
}

async function buildAgentLibrary({ projectsDir, brandPacksDir } = {}) {
    if (!projectsDir) throw new Error('projectsDir is required.');
    const brands = brandPacksDir ? await readBrands(brandPacksDir) : [];
    const businesses = new Map();
    const compositions = [];
    let entries = [];
    try { entries = await fsp.readdir(projectsDir, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const compDir = path.join(projectsDir, entry.name, 'compositions');
        let files = [];
        try { files = await fsp.readdir(compDir, { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        for (const file of files) {
            if (!file.isFile() || !file.name.endsWith('.composition.json')) continue;
            try {
                const result = await buildComposition(path.join(compDir, file.name), entry.name, brands);
                if (!businesses.has(result.business.id)) {
                    businesses.set(result.business.id, { ...result.business, compositions: [], menuItems: [] });
                }
                const business = businesses.get(result.business.id);
                business.compositions.push(result.composition.id);
                result.composition.menuItems.forEach((item) => business.menuItems.push(item.id));
                compositions.push(result.composition);
            } catch (error) {
                // Keep one damaged project from hiding the rest of the library.
                compositions.push({
                    id: path.basename(file.name, '.composition.json'),
                    projectId: entry.name,
                    name: path.basename(file.name, '.composition.json'),
                    projectError: error.message,
                    layers: [], groups: [], scenes: [], assets: [], menuItems: [],
                    animations: { layer: [], groups: [], original: null },
                    businessId: '',
                    width: 0, height: 0, duration: 0,
                });
            }
        }
    }
    compositions.sort((a, b) => a.name.localeCompare(b.name));
    const groups = compositions.flatMap((composition) => composition.groups.map((group) => ({ ...group, compositionId: composition.id, businessId: composition.businessId })));
    const animations = compositions.flatMap((composition) => [
        ...composition.animations.layer.map((animation) => ({ ...animation, kind: 'layer', compositionId: composition.id, businessId: composition.businessId })),
        ...composition.animations.groups.map((animation) => ({ ...animation, kind: 'group', compositionId: composition.id, businessId: composition.businessId })),
        ...(composition.animations.original ? [{ ...composition.animations.original, kind: 'composition', compositionId: composition.id, businessId: composition.businessId }] : []),
    ]);
    const scenes = compositions.flatMap((composition) => composition.scenes.map((scene) => ({ ...scene, compositionId: composition.id, businessId: composition.businessId })));
    const assets = compositions.flatMap((composition) => composition.assets.map((asset) => ({ ...asset, businessId: composition.businessId })));
    const menuItems = compositions.flatMap((composition) => composition.menuItems.map((item) => ({ ...item, businessId: composition.businessId })));
    const mappings = {
        businessCompositions: {},
        compositionGroups: {},
        compositionAnimations: {},
        compositionScenes: {},
        compositionAssets: {},
        businessMenuItems: {},
        groupLayers: {},
        groupAnimations: {},
    };
    businesses.forEach((business) => {
        mappings.businessCompositions[business.id] = business.compositions;
        mappings.businessMenuItems[business.id] = business.menuItems;
    });
    compositions.forEach((composition) => {
        mappings.compositionGroups[composition.id] = composition.groups.map((group) => group.id);
        mappings.compositionAnimations[composition.id] = [
            ...composition.animations.layer.map((animation) => animation.id),
            ...composition.animations.groups.map((animation) => animation.id),
            ...(composition.animations.original ? [composition.animations.original.id] : []),
        ];
        mappings.compositionScenes[composition.id] = composition.scenes.map((scene) => scene.id);
        mappings.compositionAssets[composition.id] = composition.assets.map((asset) => asset.id);
    });
    groups.forEach((group) => {
        mappings.groupLayers[group.id] = group.layerIds;
        mappings.groupAnimations[group.id] = group.animationIds || [];
    });
    const counts = {
        businesses: businesses.size,
        compositions: compositions.length,
        groups: groups.length,
        assets: assets.length,
        animations: animations.length,
        scenes: scenes.length,
        menuItems: menuItems.length,
    };
    return {
        schema: SCHEMA,
        generatedAt: new Date().toISOString(),
        counts,
        businesses: [...businesses.values()],
        compositions,
        groups,
        assets,
        animations,
        scenes,
        menuItems,
        mappings,
    };
}

function summaryOf(library) {
    if (!library || library.schema !== SCHEMA) return null;
    return {
        schema: library.schema,
        generatedAt: library.generatedAt,
        counts: library.counts,
        businesses: (library.businesses || []).map((business) => ({
            id: business.id, name: business.name, tagline: business.tagline,
            url: business.url, palette: business.palette,
            compositionCount: (library.mappings.businessCompositions[business.id] || []).length,
            menuItemCount: (library.mappings.businessMenuItems[business.id] || []).length,
        })),
        compositions: (library.compositions || []).map((composition) => ({
            id: composition.id, projectId: composition.projectId, name: composition.name,
            source: composition.source, collection: composition.collection, businessId: composition.businessId,
            width: composition.width, height: composition.height, duration: composition.duration,
            format: composition.format, layerCount: composition.layerCount,
            tags: composition.tags,
            groupCount: (composition.groups || []).length,
            animationCount: (composition.animations?.layer || []).length,
            menuItemCount: (composition.menuItems || []).length,
            originalAnimationId: composition.animations?.original?.id || null,
        })),
        collections: unique((library.compositions || []).map((composition) => composition.collection)),
    };
}

module.exports = {
    SCHEMA,
    buildAgentLibrary,
    summaryOf,
    classifyText,
    groupKindForLayer,
    slug,
    norm,
};
