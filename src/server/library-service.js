'use strict';

/**
 * Read/write service for the externally generated `data/library` catalogue.
 *
 * The library is built outside the Studio (tools/build-library.py). Studio only
 * needs to serve it and validate/save agent-created animations against a design.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const SCHEMA = 'agent-studio/library/1';
const ANIMATION_SCHEMA = 'agent-studio/animation/2';

function slug(value, max = 80) {
    return String(value || 'item')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, max) || 'item';
}

function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value) {
    return Math.round(number(value) * 1000) / 1000;
}

async function readJson(file, fallback = null) {
    try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
    catch (error) {
        if (error.code === 'ENOENT') return fallback;
        throw error;
    }
}

function libraryPaths(libraryDir, projectsDir) {
    return {
        libraryDir: path.resolve(libraryDir),
        projectsDir: path.resolve(projectsDir),
        index: path.join(path.resolve(libraryDir), 'index.json'),
        designs: path.join(path.resolve(libraryDir), 'designs'),
        animations: path.join(path.resolve(libraryDir), 'animations'),
        clips: path.join(path.resolve(libraryDir), 'clips.json'),
    };
}

function safeId(id, label = 'design') {
    if (!/^[A-Za-z0-9_-]{1,140}$/.test(String(id || ''))) throw new Error(`Invalid ${label} id.`);
    return String(id);
}

async function readIndex(libraryDir) {
    const index = await readJson(path.join(libraryDir, 'index.json'));
    if (!index || index.schema !== SCHEMA || !Array.isArray(index.designs)) throw new Error('The library index is missing or invalid.');
    return index;
}

async function readDesign(libraryDir, designId) {
    const id = safeId(designId);
    const detail = await readJson(path.join(libraryDir, 'designs', `${id}.json`));
    if (!detail) throw new Error(`Design “${id}” was not found in the library.`);
    return detail;
}

// Both the rasterised poster (`<id>.composition.json`) and the layered extraction
// (`<id>.editable.json`) live under compositions/, so the guard has to accept any
// .json there rather than pinning the `.composition.json` suffix.
const COMPOSITION_PATH = /^\/data\/projects\/([A-Za-z0-9_-]{1,130})\/(compositions\/[A-Za-z0-9_.-]{1,160}\.json)$/;

async function readCompositionFile(projectsDir, rawPath) {
    const match = String(rawPath || '').match(COMPOSITION_PATH);
    if (!match) return null;
    const target = path.resolve(projectsDir, match[1], match[2]);
    if (!target.startsWith(path.resolve(projectsDir) + path.sep)) return null;
    const composition = await readJson(target);
    if (!composition || !Array.isArray(composition.layers)) return null;
    return { path: `/data/projects/${match[1]}/${match[2]}`, composition };
}

/**
 * Every composition a design can legitimately be rendered from.
 *
 * A design has a canonical composition and, when the importer archived the layered
 * extraction, a second one. Animations are authored against whichever existed when
 * they were made, and the browser renders the layered one when it is published — so
 * "the design's composition" is not a single answer and both must be considered.
 *
 * Order is the browser's preference: layered first, canonical last.
 */
async function compositionCandidates(detail, projectsDir) {
    const canonical = await readCompositionFile(projectsDir, detail && detail.composition);
    if (!canonical) throw new Error('The design has no safe composition path.');
    const candidates = [];
    const add = (entry) => {
        if (entry && !candidates.some((item) => item.path === entry.path)) candidates.push(entry);
    };
    add(await readCompositionFile(projectsDir, detail.editableComposition));
    const archive = canonical.composition.meta && canonical.composition.meta.editableArchive;
    if (archive) {
        const match = String(detail.composition).match(COMPOSITION_PATH);
        const rel = String(archive).replace(/^\/?(?:data\/projects\/[^/]+\/)?/, '');
        add(await readCompositionFile(projectsDir, `/data/projects/${match[1]}/${rel}`));
    }
    add(canonical);
    return candidates;
}

/** The composition whose layers actually contain this animation's tracks. */
function resolveComposition(candidates, animation) {
    const wanted = new Set(((animation && animation.tracks) || [])
        .map((track) => String((track && track.layerId) || '')));
    if (!wanted.size) return candidates[0];
    for (const candidate of candidates) {
        const have = new Set((candidate.composition.layers || []).map((layer) => String(layer.id)));
        if ([...wanted].every((id) => have.has(id))) return candidate;
    }
    return candidates[0];
}

async function readComposition(detail, projectsDir) {
    const candidates = await compositionCandidates(detail, projectsDir);
    return candidates[0].composition;
}

function validateAnimation(detail, composition, animation) {
    const issues = [];
    let broken = false;
    if (!animation || typeof animation !== 'object' || !Array.isArray(animation.tracks)) {
        return { status: 'broken', issues: ['No animation tracks.'] };
    }
    const layerById = new Map((composition.layers || []).map((layer) => [String(layer.id), layer]));
    const knownTracks = [];
    for (const track of animation.tracks) {
        const layerId = String(track && track.layerId || '');
        if (!layerById.has(layerId)) {
            issues.push(`Track “${layerId || '(missing id)'}” is not in this design.`);
            broken = true;
            continue;
        }
        if (!Array.isArray(track.segments) || !track.segments.length) {
            issues.push(`Track “${layerId}” has no segments.`);
            broken = true;
            continue;
        }
        for (const segment of track.segments) {
            if (!segment || !Array.isArray(segment.frames) || segment.frames.length < 2) {
                issues.push(`Track “${layerId}” has a segment with no usable frames.`);
                broken = true;
                continue;
            }
            const duration = number(segment.duration);
            if (!(duration > 0)) {
                issues.push(`Track “${layerId}” has a segment with no duration.`);
                broken = true;
            }
            for (const frame of segment.frames) {
                if (!Number.isFinite(Number(frame.t))) {
                    issues.push(`Track “${layerId}” contains a frame without a numeric time.`);
                    broken = true;
                    continue;
                }
                if (frame.a != null && (number(frame.a) < 0 || number(frame.a) > 1)) issues.push(`Track “${layerId}” has opacity outside 0..1.`);
                if (frame.s != null && number(frame.s) <= 0) issues.push(`Track “${layerId}” has a non-positive scale.`);
                if (frame.sx != null && number(frame.sx) <= 0) issues.push(`Track “${layerId}” has a non-positive width scale.`);
                if (frame.sy != null && number(frame.sy) <= 0) issues.push(`Track “${layerId}” has a non-positive height scale.`);
            }
        }
        knownTracks.push(track);
    }
    if (!knownTracks.length && !broken) broken = true;
    const status = broken ? 'broken' : issues.length ? 'warn' : 'ok';
    return { status, issues: [...new Set(issues)].slice(0, 40) };
}

function normaliseAnimation(detail, animation) {
    const id = typeof animation.id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(animation.id)
        ? animation.id
        : `${detail.id}-${slug(animation.name || 'animation', 50)}`;
    return {
        ...animation,
        schema: ANIMATION_SCHEMA,
        kind: 'studio-animation',
        id,
        compositionId: detail.id,
        name: String(animation.name || 'Library animation').slice(0, 180),
        origin: String(animation.origin || 'studio').slice(0, 40),
        duration: Math.max(1, Math.round(number(animation.duration, detail.duration || 10000))),
        fps: Math.max(1, Math.min(60, Math.round(number(animation.fps, 25)))),
        tracks: (animation.tracks || []).map((track) => ({
            ...track,
            layerId: String(track.layerId || ''),
            segments: (track.segments || []).map((segment) => {
                const duration = Math.max(1, Math.round(number(segment.duration, 1)));
                let frames = (segment.frames || []).map((frame) => ({
                    t: Math.max(0, Math.min(duration, Math.round(number(frame.t)))),
                    ...(frame.dx != null ? { dx: round(frame.dx) } : {}),
                    ...(frame.dy != null ? { dy: round(frame.dy) } : {}),
                    ...(frame.s != null ? { s: round(frame.s) } : {}),
                    ...(frame.sx != null ? { sx: round(frame.sx) } : {}),
                    ...(frame.sy != null ? { sy: round(frame.sy) } : {}),
                    ...(frame.a != null ? { a: round(frame.a) } : {}),
                    ...(frame.r != null ? { r: round(frame.r) } : {}),
                    ...(frame.e ? { e: frame.e } : {}),
                    ...(frame.clip && typeof frame.clip === 'object' ? { clip: frame.clip } : {}),
                    ...(typeof frame.filter === 'string' && frame.filter ? { filter: frame.filter } : {}),
                }));
                // A one-frame clip is a hold, not a broken animation. Give it
                // an end frame so both validators and players can interpolate it.
                if (frames.length === 1) frames = [frames[0], { ...frames[0], t: duration }];
                return {
                    ...segment,
                    start: Math.max(0, Math.round(number(segment.start))),
                    duration,
                    frames,
                };
            }),
        })),
    };
}

/**
 * The entries an index item should publish after a write.
 *
 * The design detail is authoritative for what it lists, but the index can carry
 * entries the detail never did (the importer publishes the layered "editable" motion
 * only there). Rebuilding the list from the detail alone silently dropped them, which
 * is how a saved animation could make another one disappear from the UI.
 */
function publishedAnimations(detail, existing) {
    const described = (detail.animations || []).map((a) => ({
        id: a.id, name: a.name, origin: a.origin, file: a.file, duration: a.duration,
        status: a.status, composition: a.composition,
    }));
    const known = new Set(described.map((a) => a.id));
    return [...described, ...((existing || []).filter((a) => a && a.id && !known.has(a.id)))];
}

async function saveAnimation({ libraryDir, projectsDir, designId, animation }) {
    const detail = await readDesign(libraryDir, designId);
    const candidates = await compositionCandidates(detail, projectsDir);
    const normalised = normaliseAnimation(detail, animation);
    // Re-saving a generated file must not relabel it: the player shows the source video
    // for `original` motion and plays the tracks for anything else.
    const previousEntry = (detail.animations || []).find((item) => item.id === normalised.id);
    if (!(animation && typeof animation.origin === 'string' && animation.origin) && previousEntry && previousEntry.origin) {
        normalised.origin = previousEntry.origin;
    }
    // Validate against the composition this animation actually belongs to, which is
    // the one the browser will render it over — not blindly the rasterised poster.
    const target = resolveComposition(candidates, normalised);
    const validation = validateAnimation(detail, target.composition, normalised);
    if (validation.status === 'broken') {
        const error = new Error(validation.issues.slice(0, 4).join(' '));
        error.statusCode = 400;
        error.issues = validation.issues;
        throw error;
    }
    const targetDir = path.join(libraryDir, 'animations', detail.id);
    await fsp.mkdir(targetDir, { recursive: true });
    // Re-save over the file the entry already points at, so the id does not spawn a
    // second copy beside it (entries are named by slug, files by the importer).
    const previousFile = previousEntry && typeof previousEntry.file === 'string'
        && previousEntry.file.startsWith(`/data/library/animations/${detail.id}/`)
        ? path.basename(previousEntry.file) : '';
    const filename = previousFile || `${slug(normalised.id, 90)}.animation.json`;
    await fsp.writeFile(path.join(targetDir, filename), JSON.stringify(normalised, null, 2));
    const entry = {
        id: normalised.id,
        name: normalised.name,
        origin: normalised.origin,
        file: `/data/library/animations/${detail.id}/${filename}`,
        duration: normalised.duration,
        tracks: normalised.tracks.length,
        composition: target.path,
        ...validation,
    };
    detail.animations = [entry, ...(detail.animations || []).filter((item) => item.id !== entry.id)];
    await fsp.writeFile(path.join(libraryDir, 'designs', `${detail.id}.json`), JSON.stringify(detail, null, 2));
    const index = await readIndex(libraryDir);
    const item = index.designs.find((design) => design.id === detail.id);
    if (item) item.animations = publishedAnimations(detail, item.animations);
    await fsp.writeFile(path.join(libraryDir, 'index.json'), JSON.stringify(index, null, 2));
    return { ok: true, animation: normalised, composition: target.path, ...validation, file: entry.file };
}

async function deleteAnimation({ libraryDir, designId, animationId }) {
    const detail = await readDesign(libraryDir, designId);
    const id = String(animationId || '');
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) {
        const error = new Error('Invalid animation id.');
        error.statusCode = 400;
        throw error;
    }
    const entry = (detail.animations || []).find((item) => item.id === id);
    detail.animations = (detail.animations || []).filter((item) => item.id !== id);
    await fsp.writeFile(path.join(libraryDir, 'designs', `${detail.id}.json`), JSON.stringify(detail, null, 2));
    if (entry && typeof entry.file === 'string' && entry.file.startsWith(`/data/library/animations/${detail.id}/`)) {
        const file = path.join(libraryDir, 'animations', detail.id, path.basename(entry.file));
        await fsp.unlink(file).catch(() => {});
    }
    const index = await readIndex(libraryDir);
    const item = index.designs.find((design) => design.id === detail.id);
    if (item) item.animations = publishedAnimations(detail, item.animations).filter((a) => a.id !== id);
    await fsp.writeFile(path.join(libraryDir, 'index.json'), JSON.stringify(index, null, 2));
    return { ok: true, id };
}

async function composeAnimation({ libraryDir, projectsDir, designId, name, steps, save = false }) {
    const detail = await readDesign(libraryDir, designId);
    const candidates = await compositionCandidates(detail, projectsDir);
    // Compose against the layered composition: groups and clips address the layers
    // the design is edited as, not the rasterised poster frame.
    const composition = candidates[0].composition;
    const clipsFile = await readJson(path.join(libraryDir, 'clips.json'), { clips: [] });
    const clips = new Map((clipsFile.clips || []).map((clip) => [clip.id, clip]));
    const layers = new Map((composition.layers || []).map((layer) => [String(layer.id), layer]));
    const groups = new Map((detail.groups || []).map((group) => [group.id, group]));
    const byLayer = new Map();
    let total = 0;
    (steps || []).forEach((step) => {
        const clip = clips.get(String(step.clip || ''));
        if (!clip) return;
        const group = groups.get(String(step.target || ''));
        const targets = group ? group.layerIds : (layers.has(String(step.target || '')) ? [String(step.target)] : []);
        const start = Math.max(0, Math.round(number(step.start)));
        const duration = Math.max(1, Math.round(number(step.duration, clip.duration || 1000)));
        const stagger = Math.max(0, Math.round(number(step.stagger)));
        const frames = (clip.frames || []).map((frame) => ({
            t: Math.max(0, Math.round(number(frame.t))),
            dx: round(frame.dx), dy: round(frame.dy), sx: round(frame.sx || 1), sy: round(frame.sy || 1), a: round(frame.a ?? 1),
        }));
        targets.forEach((layerId, index) => {
            const layer = layers.get(String(layerId));
            if (!layer || frames.length < 2) return;
            if (!byLayer.has(layer.id)) {
                byLayer.set(layer.id, {
                    layerId: layer.id, layerName: layer.name || layer.id, layerType: layer.type || '',
                    role: layer.type || '', text: layer.text || '',
                    box: { x: number(layer.x) / 100, y: number(layer.y) / 100, w: number(layer.w) / 100, h: number(layer.h) / 100 },
                    segments: [],
                });
            }
            const segmentStart = start + index * stagger;
            byLayer.get(layer.id).segments.push({
                preset: 'keyframes', label: clip.name || 'Clip', start: segmentStart, duration, loop: false,
                frames: frames.map((frame) => ({ ...frame, t: Math.min(duration, frame.t) })),
            });
            total = Math.max(total, segmentStart + duration);
        });
    });
    if (!byLayer.size) {
        const error = new Error('None of those clips/targets could be resolved against this design.');
        error.statusCode = 400;
        throw error;
    }
    const animation = {
        schema: ANIMATION_SCHEMA, kind: 'studio-animation', id: `${detail.id}-${slug(name || 'composed-animation', 50)}`,
        compositionId: detail.id, origin: 'composed', name: String(name || 'Composed animation'),
        createdAt: new Date().toISOString(), duration: Math.max(1, Math.round(total)), fps: 25,
        source: { app: 'agent-library', design: detail.name, layerCount: byLayer.size },
        tracks: [...byLayer.values()],
    };
    const target = resolveComposition(candidates, animation);
    const validation = validateAnimation(detail, target.composition, animation);
    if (validation.status === 'broken') {
        const error = new Error(validation.issues.slice(0, 4).join(' '));
        error.statusCode = 400;
        error.issues = validation.issues;
        throw error;
    }
    if (save) {
        const saved = await saveAnimation({ libraryDir, projectsDir, designId, animation });
        return { ok: true, ...saved };
    }
    return { ok: true, animation, composition: target.path, ...validation };
}

module.exports = {
    SCHEMA,
    ANIMATION_SCHEMA,
    readJson,
    readIndex,
    readDesign,
    readComposition,
    compositionCandidates,
    resolveComposition,
    validateAnimation,
    normaliseAnimation,
    saveAnimation,
    deleteAnimation,
    composeAnimation,
    libraryPaths,
};
