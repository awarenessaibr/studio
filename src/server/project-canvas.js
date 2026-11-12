'use strict';
/**
 * project-canvas.js — server side of the project canvas.
 *
 * A project canvas opens one real composition and lets an agent work on a *variant*
 * of it. The server owns three things the page must not:
 *
 *   listProjects()      the projects that can be opened (a composition + images)
 *   readProject()       the master composition, the segmentation index and its manifest
 *   agentTurn()         the model contract: a project context, one optional query round,
 *                       and a validated reply of timeline edits + generated layers
 *
 * Nothing here is specific to one project: labels, ids, times and geometry all come
 * from the composition and the segmentation index on disk.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const ProjectManifest = require('../shared/project-manifest.js');
const ProjectTimeline = require('../shared/project-timeline.js');

const ROOT = path.resolve(__dirname, '..', '..');
const PROJECTS_DIR = path.join(ROOT, 'data', 'projects');
const PROJECT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const COMPOSITION_FILE = /^([A-Za-z0-9_-]{1,80})\.(composition|editable)\.json$/;
const COMPOSITION_KEY = /^[A-Za-z0-9_-]{1,80}(?:\.editable)?$/;

const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 6000;
const MAX_SELECTION = 20;
const MAX_EDITS = 12;
const MAX_KEYFRAMES = 200;
const MAX_LAYERS = 6;
const MAX_QUERIES = 6;
const MAX_SVG_CHARS = 24000;
const MAX_CONTEXT_CHARS = 90000;
const MAX_VARIANT_LAYERS = 20;
const MAX_STROKES = 12;
const MAX_STROKE_POINTS = 400;
const PATH_SAMPLES = 20;


function fail(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const seconds = (ms) => `${round(ms / 1000, 2)}s`;

/* ------------------------------------------------------------------------- */
/* Projects on disk                                                           */
/* ------------------------------------------------------------------------- */

function projectDir(projectId) {
    const id = String(projectId || '').trim();
    if (!PROJECT_ID.test(id)) throw fail(400, 'The project id is invalid.');
    return { id, dir: path.join(PROJECTS_DIR, id) };
}

async function compositionFiles(id, dir) {
    let entries;
    try {
        entries = await fsp.readdir(path.join(dir, 'compositions'), { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') throw fail(404, `Project "${id}" has no compositions folder.`);
        throw error;
    }
    return entries
        .filter((entry) => entry.isFile() && COMPOSITION_FILE.test(entry.name))
        .map((entry) => {
            const match = entry.name.match(COMPOSITION_FILE);
            const baseId = match[1];
            const editable = match[2] === 'editable';
            return {
                filename: entry.name,
                baseId,
                editable,
                compositionId: editable ? `${baseId}.editable` : baseId,
            };
        })
        .sort((a, b) => a.baseId.localeCompare(b.baseId) || Number(b.editable) - Number(a.editable));
}

/**
 * Read one project's master composition plus its segmentation index and build the
 * manifest. The master file is never written: callers work on ProjectManifest.start().
 */
const ANIMATION_FILE = /^([A-Za-z0-9_-]{1,120})(?:\.animation)?\.json$/;

function displayName(id) {
    return String(id || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Motion files live next to the compositions, in data/projects/<id>/animations.
 * Project Canvas used to ignore them completely, which is why a project could
 * have three working motions in Studio Agent and zero in the canvas. A motion
 * is either a complete composition (layers with keyframes) or a track file
 * (`tracks`) that is composed onto the project's base layers.
 */
async function animationEntries(id, dir) {
    let entries;
    try {
        entries = await fsp.readdir(path.join(dir, 'animations'), { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    const motions = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        if (!entry.isFile() || !ANIMATION_FILE.test(entry.name)) continue;
        const motionId = entry.name.match(ANIMATION_FILE)[1];
        let data;
        try { data = JSON.parse(await fsp.readFile(path.join(dir, 'animations', entry.name), 'utf8')); }
        catch { continue; }
        const hasTracks = Array.isArray(data.tracks) && data.tracks.length > 0;
        const hasLayers = Array.isArray(data.layers) && data.layers.length > 0;
        if (!hasTracks && !hasLayers) continue; // cue/type-only legacy files
        motions.push({
            id: motionId,
            filename: entry.name,
            folder: 'animations',
            name: String(data.name || displayName(motionId)),
            duration: finite(data.duration, 0),
            kind: hasTracks ? 'tracks' : 'composition',
            data,
        });
    }
    return motions;
}

/** Compose a track-style animation onto the project's base layers. */
function compositionFromTracks(base, animation) {
    if (!base || !Array.isArray(base.layers)) return null;
    const layers = JSON.parse(JSON.stringify(base.layers));
    const byId = new Map(layers.map((layer) => [String(layer.id), layer]));
    let applied = 0;
    for (const track of animation.tracks || []) {
        const layer = byId.get(String(track && track.layerId || ''));
        if (!layer) continue;
        const frames = [];
        for (const segment of track.segments || []) {
            const start = finite(segment && segment.start, 0);
            for (const frame of (segment && segment.frames) || []) {
                const time = Math.round(start + finite(frame.t, 0));
                frames.push({
                    time,
                    x: round(finite(layer.x, 0) + finite(frame.dx, 0) * 100),
                    y: round(finite(layer.y, 0) + finite(frame.dy, 0) * 100),
                    w: round(finite(layer.w, 100) * (finite(frame.sx, 1) || 1)),
                    h: round(finite(layer.h, 100) * (finite(frame.sy, 1) || 1)),
                    rotation: round(finite(layer.rotation, 0) + finite(frame.r, 0)),
                    opacity: clamp(finite(layer.opacity, 1) * finite(frame.a, 1), 0, 1),
                    easing: 'linear',
                });
            }
        }
        if (!frames.length) continue;
        frames.sort((a, b) => a.time - b.time);
        layer.keyframes = frames;
        applied += 1;
    }
    if (!applied) return null;
    const latest = layers.reduce((max, layer) => Math.max(max, ...(layer.keyframes || []).map((frame) => finite(frame.time, 0))), 0);
    return {
        ...base,
        id: animation.id || base.id,
        name: animation.name || base.name,
        duration: Math.max(finite(animation.duration, 0), latest, finite(base.duration, 0)),
        layers,
        meta: { ...(base.meta || {}), sourceAnimation: animation.filename },
    };
}

/**
 * Read one project's master composition plus its segmentation index and build the
 * manifest. The master file is never written: callers work on ProjectManifest.start().
 *
 * `compositionId` may name a compositions/*.json file or an animations/*.json
 * motion. Motion compositions are returned as-is; track motions are composed
 * onto the base layers so the canvas can play and inspect them.
 */
async function readProject(projectId, compositionId) {
    const { id, dir } = projectDir(projectId);
    const files = await compositionFiles(id, dir);
    if (!files.length) throw fail(404, `Project "${id}" has no composition JSON.`);
    const animations = await animationEntries(id, dir);
    const baseFile = files
        .filter((entry) => entry.baseId === id)
        .sort((a, b) => Number(b.editable) - Number(a.editable))[0] || files[0];

    const readCompositionFile = async (entry) => {
        try {
            return JSON.parse(await fsp.readFile(path.join(dir, 'compositions', entry.filename), 'utf8'));
        } catch (error) {
            if (error.code === 'ENOENT') throw fail(404, `Project "${id}" has no composition "${entry.compositionId}".`);
            throw fail(500, `The composition could not be read: ${error.message}`);
        }
    };

    const baseComposition = await readCompositionFile(baseFile);
    let selected = baseFile;
    let composition = baseComposition;
    let motion = null;

    if (compositionId) {
        const wanted = String(compositionId).trim().replace(/\.json$/, '');
        const nameKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        // Motions can be addressed by id, filename, or their display name. The
        // name form is what the review matrix uses: a library motion and the
        // project's own animation file share a name even when their ids differ.
        motion = animations.find((entry) => entry.id === wanted
            || entry.filename === `${wanted}.json`
            || entry.filename === `${wanted}.animation.json`
            || entry.id === wanted.replace(/\.(?:animation|composition)$/, '')
            || nameKey(entry.name) === nameKey(wanted)) || null;
        if (!motion && !COMPOSITION_KEY.test(wanted) && !/^[A-Za-z0-9_-]{1,120}$/.test(wanted)) {
            throw fail(400, 'The composition id is invalid.');
        }
        if (motion) {
            selected = {
                compositionId: motion.id,
                filename: motion.filename,
                baseId: motion.id,
                editable: false,
                animation: true,
            };
            composition = motion.kind === 'tracks'
                ? compositionFromTracks(baseComposition, motion)
                : motion.data;
            if (!composition) throw fail(422, `The motion "${motion.name}" has no tracks that fit this project.`);
        } else {
            let file = files.find((entry) => entry.compositionId === wanted || entry.filename === wanted) || null;
            if (!file) {
                const base = wanted.replace(/\.editable$/, '');
                file = files
                    .filter((entry) => entry.baseId === base)
                    .sort((a, b) => Number(b.editable) - Number(a.editable))[0] || null;
            }
            if (!file) throw fail(404, `Project "${id}" has no composition "${compositionId}".`);
            selected = file;
            composition = await readCompositionFile(file);
        }
    }

    if (!composition || !Array.isArray(composition.layers) || !(Number(composition.width) > 0) || !(Number(composition.height) > 0)) {
        throw fail(500, `Composition "${selected.compositionId}" is missing its canvas or layers.`);
    }

    let index = null;
    try {
        index = JSON.parse(await fsp.readFile(path.join(dir, 'images', 'segmentation', 'index.json'), 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') console.warn(`[studio] could not read the segmentation index for ${id}:`, error.message);
    }
    const hasFlatGroups = (composition.layers || []).some((layer) => layer.segmentGroup
        || (layer.meta && layer.meta.segmentation && layer.meta.segmentation.parentLayerId));
    const hasLayerIndex = await fsp.access(path.join(dir, 'layers.json')).then(() => true, () => false);

    const manifest = ProjectManifest.build(composition, index);
    const latest = (composition.layers || []).reduce((max, layer) => Math.max(max, ...(layer.keyframes || []).map((frame) => finite(frame.time, 0))), 0);
    const compositionLabels = {};
    files.forEach((entry) => {
        compositionLabels[entry.compositionId] = entry.editable
            ? `${entry.baseId} — Editable layers`
            : (entry.compositionId === id ? 'Original composition' : `${entry.compositionId} — Exact poster`);
    });
    animations.forEach((entry) => {
        compositionLabels[entry.id] = entry.name;
    });
    return {
        project: {
            id,
            compositionId: selected.compositionId,
            baseCompositionId: baseFile.compositionId,
            name: String(baseComposition.name || id),
            compositionName: String(composition.name || selected.compositionId),
            width: Number(composition.width),
            height: Number(composition.height),
            duration: Math.max(finite(composition.duration, 0), latest),
            layerCount: composition.layers.length,
            compositions: [...files.map((entry) => entry.compositionId), ...animations.map((entry) => entry.id)],
            compositionLabels,
            animations: animations.map((entry) => ({
                id: entry.id,
                name: entry.name,
                duration: Math.max(finite(entry.duration, 0), 0),
                kind: entry.kind,
            })),
            motion: motion ? { id: motion.id, name: motion.name, kind: motion.kind } : null,
            segmented: Boolean(index) || hasFlatGroups || hasLayerIndex,
        },
        composition,
        index,
        manifest,
    };
}


const COVER_IMAGE = /\.(?:png|jpe?g|webp)$/i;

function localImagePath(value) {
    let text = String(value || '').trim();
    if (!text) return null;
    if (/^https?:\/\//i.test(text)) {
        try {
            text = new URL(text).pathname;
        } catch {
            return null;
        }
    }
    text = text.split('#')[0].split('?')[0];
    if (!text.startsWith('/data/') && !text.startsWith('/api/')) return null;
    return COVER_IMAGE.test(text) ? text : null;
}

/**
 * The two URLs a project row can use as a cover: the composition's reference
 * layer (the assembled final image) and its largest raster artwork layer.
 * The browser asks /api/thumbnail to resize whichever one wins.
 */
function compositionCovers(composition) {
    const layers = Array.isArray(composition.layers) ? composition.layers : [];
    const images = layers
        .map((layer) => {
            const box = layer && (layer.box || layer.rect);
            return {
                layer,
                url: layer ? localImagePath(layer.url) : null,
                area: box ? (Number(box.w) || 0) * (Number(box.h) || 0) : 0,
            };
        })
        .filter((item) => item.url)
        .sort((a, b) => b.area - a.area);
    const reference = composition.referenceLayerId
        ? images.find((item) => item.layer.id === composition.referenceLayerId)
        : null;
    return {
        reference: reference ? reference.url : null,
        artwork: images.length ? images[0].url : null,
    };
}

/** A rendered frame saved next to a project's images, when one exists. */
async function projectPoster(dir, id) {
    for (const name of ['poster.png', 'poster.jpg', 'poster.jpeg', 'poster.webp']) {
        const exists = await fsp.access(path.join(dir, 'images', name)).then(() => true, () => false);
        if (exists) return `/data/projects/${id}/images/${name}`;
    }
    return null;
}

/**
 * Every project the canvas can open. Only projects with at least one
 * compositions/*.composition.json are listed; the first composition is parsed for
 * the display name and canvas, the rest are offered by id, plus a cover URL.
 */
async function listProjects() {
    let entries;
    try {
        entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return { projects: [] };
        throw error;
    }
    const projects = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !PROJECT_ID.test(entry.name)) continue;
        const dir = path.join(PROJECTS_DIR, entry.name);
        let files;
        try {
            files = await compositionFiles(entry.name, dir);
        } catch {
            continue;
        }
        if (!files.length) continue;
        const first = files
            .filter((file) => file.baseId === entry.name)
            .sort((a, b) => Number(b.editable) - Number(a.editable))[0] || files[0];
        try {
            const composition = JSON.parse(await fsp.readFile(path.join(dir, 'compositions', first.filename), 'utf8'));
            if (!composition || !Array.isArray(composition.layers)) continue;
            const animations = await animationEntries(entry.name, dir);
            const segmentedIndex = await fsp.access(path.join(dir, 'images', 'segmentation', 'index.json')).then(() => true, () => false);
            const hasLayerIndex = await fsp.access(path.join(dir, 'layers.json')).then(() => true, () => false);
            const flatGroups = (composition.layers || []).some((layer) => layer.segmentGroup
                || (layer.meta && layer.meta.segmentation && layer.meta.segmentation.parentLayerId));
            const covers = compositionCovers(composition);
            projects.push({
                segmented: segmentedIndex || flatGroups || hasLayerIndex,
                id: entry.name,
                name: String(composition.name || entry.name),
                compositionId: first.compositionId,
                compositions: [...files.map((file) => file.compositionId), ...animations.map((motion) => motion.id)],
                animationCount: animations.length,
                width: Number(composition.width) || 0,
                height: Number(composition.height) || 0,
                duration: finite(composition.duration, 0),
                layerCount: composition.layers.length,
                thumbnail: covers.reference || await projectPoster(dir, entry.name) || covers.artwork,
            });
        } catch (error) {
            console.warn(`[studio] could not read project ${entry.name}:`, error.message);
        }
    }
    projects.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    return { projects };
}

/* ------------------------------------------------------------------------- */
/* Agent contract                                                             */
/* ------------------------------------------------------------------------- */

const PROMPT = `You are the scene agent inside a project canvas. The canvas shows one real animation project, and the context below is the complete, authoritative list of everything it contains. Use only those ids, labels and assets. Nothing else exists.

Coordinates are percent of the canvas with a top-left origin. Times are milliseconds.

Reply with exactly one JSON object and no prose around it:
{"reply":"one short sentence to the user","beats":["beat one","beat two"],"ask":null,"edits":[],"layers":[]}
When the context is not enough, ask for data first with:
{"queries":[{"tool":"find_elements","query":"the words the user used"}]}
The only query tools are find_elements(query), get_keyframes(id) and visible_at(ms). Use at most one round of at most three queries, and only when labels or exact keyframes are genuinely needed.

edits = [{ids, relative, pivot, keyframes}]
- ids: part, semantic group or image-source ids from the context. Groups and image sources expand to all of their member layers on the server.
- relative true (default): keyframes are offsets composed on top of the existing animation: {time, dx, dy, scale, rotation, opacity}. dx/dy are canvas %, scale is a multiplier, rotation is degrees, opacity is a multiplier. scale and rotation orbit "pivot" (canvas % {x,y}); default is the group centre.
- relative false: absolute poses {time, x, y, w, h, rotation, opacity}; omitted fields keep the current value.
- Build a story in order: move a whole group first, then animate single parts (a limb swing) around a pivot. Never move a segmented part away from the rest of its image unless the user explicitly asks for an exploded view.
- Keep text, price and brand layers at their existing timing unless asked.

layers = [{name, svg, x, y, w, h, z, keyframes}]
- Only for elements the project does not have (a ghost, a flame, a prop). The project's own layers and labels are preferable whenever they can stand in.
- svg must be one complete inline <svg ...> element with no scripts, event handlers or external references. Simple flat shapes read best at the size it will be drawn.

The user can also draw on the stage and add images:
- A CLIENT VARIANT section may list layers added in the browser (an uploaded image or an element generated earlier in this conversation). They have real ids and boxes; animate them exactly like project layers.
- A USER ANNOTATIONS section may describe strokes drawn on the stage: ordered paths from a green start dot to a purple end dot, over an annotation window. Treat the route as the motion the user wants for the selected subject. When SUGGESTED PATH KEYFRAMES is present, use those relative dx/dy keyframes for the selection (you may smooth or retime them); otherwise derive the offsets from the strokes. If the user's words say the drawing means something else, their words win.
- Several strokes are consecutive legs of one route, in the order drawn.

How to answer:
- If USER SELECTION is present, "he", "it", "this" and "the character" mean the selection.
- For a multi-beat idea, write the beats with timings, then the edits that realise them.
- Respect the start mode: "original" keeps the animation underneath, "blank" starts from static assets.
- Be honest about what the project cannot do (no walk frames, no assets for a new character, no video) and say what you did instead.
- End the reply with one concrete, proactive next step the user may want. Keep it to two or three sentences.
- Return an empty edits array for a question, a review or an explanation.`;

/* ------------------------------------------------------------------------- */
/* Client variant: added layers + drawn annotations                          */
/* ------------------------------------------------------------------------- */

function pathLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
        total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    return total;
}

/** Resample a polyline to at most `max` points, evenly spaced by arc length. */
function resamplePath(points, max = 8) {
    if (!Array.isArray(points) || points.length < 2) return Array.isArray(points) ? points.slice() : [];
    if (points.length <= max) return points.map((point) => [point[0], point[1]]);
    const lengths = [0];
    for (let i = 1; i < points.length; i += 1) {
        lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    const total = lengths[lengths.length - 1];
    if (!(total > 0)) return [points[0].slice(), points[points.length - 1].slice()];
    const out = [points[0].slice()];
    let cursor = 1;
    for (let step = 1; step < max - 1; step += 1) {
        const target = total * step / (max - 1);
        while (cursor < points.length - 1 && lengths[cursor] < target) cursor += 1;
        const span = lengths[cursor] - lengths[cursor - 1] || 1;
        const ratio = clamp((target - lengths[cursor - 1]) / span, 0, 1);
        out.push([
            round(points[cursor - 1][0] + (points[cursor][0] - points[cursor - 1][0]) * ratio, 2),
            round(points[cursor - 1][1] + (points[cursor][1] - points[cursor - 1][1]) * ratio, 2),
        ]);
    }
    out.push(points[points.length - 1].slice());
    return out;
}

/**
 * Validate the browser-side variant: layers the page added and the strokes the
 * user drew. Coordinates are canvas percent, times are ms.
 */
function sanitiseVariant(value, composition) {
    const source = value && typeof value === 'object' ? value : {};
    const layers = [];
    const seen = new Set();
    for (const raw of (Array.isArray(source.layers) ? source.layers.slice(0, MAX_VARIANT_LAYERS) : [])) {
        const id = String((raw && raw.id) || '').trim();
        if (!PROJECT_ID.test(id) || seen.has(id)) continue;
        const box = ['x', 'y', 'w', 'h'].map((key) => finite(raw[key], NaN));
        if (box.some((number) => !Number.isFinite(number))) continue;
        seen.add(id);
        layers.push({
            id,
            name: String((raw && raw.name) || id).replace(/\s+/g, ' ').trim().slice(0, 80) || id,
            kind: raw.kind === 'uploaded' ? 'uploaded' : 'generated',
            x: round(clamp(box[0], -200, 300)),
            y: round(clamp(box[1], -200, 300)),
            w: round(clamp(box[2], 0.01, 400)),
            h: round(clamp(box[3], 0.01, 400)),
            z: round(clamp(finite(raw.z, 50), 0, 1000)),
        });
    }

    const annotations = source.annotations && typeof source.annotations === 'object' ? source.annotations : {};
    const strokes = [];
    for (const raw of (Array.isArray(annotations.strokes) ? annotations.strokes.slice(0, MAX_STROKES) : [])) {
        const points = [];
        for (const point of (Array.isArray(raw && raw.points) ? raw.points.slice(0, MAX_STROKE_POINTS) : [])) {
            if (!Array.isArray(point) || point.length < 2) continue;
            const x = finite(point[0], NaN);
            const y = finite(point[1], NaN);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            points.push([round(clamp(x, 0, 100), 2), round(clamp(y, 0, 100), 2)]);
        }
        if (points.length >= 2) strokes.push({ points });
    }

    const duration = Math.max(0, finite(composition.duration, 0));
    let from = clamp(finite(annotations.from, 0), 0, duration);
    let to = clamp(finite(annotations.to, duration), 0, duration);
    if (!(to > from)) { from = 0; to = duration; }
    return { layers, strokes, window: { from: Math.round(from), to: Math.round(to) } };
}

/**
 * The union centre of the selected subject at a time, from the master
 * composition (or from the browser's box for a variant layer).
 */
function selectionTargets(manifest, composition, variant, selection, mode) {
    const variantById = new Map(variant.layers.map((layer) => [layer.id, layer]));
    const master = mode === 'blank' ? ProjectManifest.start(composition, 'blank') : composition;
    const masterLayers = new Map(master.layers.map((layer) => [layer.id, layer]));
    const targets = [];
    for (const id of selection) {
        const resolved = ProjectManifest.resolve(manifest, [id]);
        if (resolved.length) {
            for (const layerId of resolved.flatMap((entry) => entry.ids)) {
                const layer = masterLayers.get(layerId);
                if (layer) targets.push({ layer });
            }
        } else if (variantById.has(id)) {
            const meta = variantById.get(id);
            targets.push({ box: { x: meta.x, y: meta.y, w: meta.w, h: meta.h } });
        }
    }
    return targets;
}

function unionCentre(targets, ms) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const target of targets) {
        const pose = target.layer ? ProjectTimeline.pose(target.layer, ms) : target.box;
        x0 = Math.min(x0, pose.x);
        y0 = Math.min(y0, pose.y);
        x1 = Math.max(x1, pose.x + pose.w);
        y1 = Math.max(y1, pose.y + pose.h);
    }
    if (!Number.isFinite(x0)) return null;
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** All strokes in order, as one route (consecutive legs). */
function routeFromStrokes(strokes) {
    const route = [];
    for (const stroke of strokes) {
        for (const point of stroke.points) {
            const last = route[route.length - 1];
            if (last && Math.abs(last[0] - point[0]) < .01 && Math.abs(last[1] - point[1]) < .01) continue;
            route.push([point[0], point[1]]);
        }
    }
    return route;
}

/**
 * Turn the drawn route into relative dx/dy keyframes for the selection.
 *
 * The route is interpreted as the subject's *displacement*: it starts where the
 * subject already is (offset 0 at the window start) and follows the drawn path,
 * while the project's own animation stays underneath. That is exactly what
 * apply_timeline relative edits compose onto.
 */
function annotationPlan(manifest, composition, variant, selection, mode) {
    if (!variant.strokes.length || !selection.length) return null;
    const targets = selectionTargets(manifest, composition, variant, selection, mode);
    if (!targets.length) return null;
    const route = routeFromStrokes(variant.strokes);
    if (route.length < 2) return null;
    const samples = resamplePath(route, PATH_SAMPLES);
    const from = variant.window.from;
    const to = variant.window.to;
    const start = samples[0];
    const centreAtStart = unionCentre(targets, from);
    if (!centreAtStart) return null;
    const keyframes = [];
    for (let index = 0; index < samples.length; index += 1) {
        const time = Math.round(from + (to - from) * (index / (samples.length - 1)));
        const centre = unionCentre(targets, time);
        if (!centre) continue;
        keyframes.push({
            time,
            dx: round(samples[index][0] - start[0] + centreAtStart.x - centre.x, 3),
            dy: round(samples[index][1] - start[1] + centreAtStart.y - centre.y, 3),
        });
    }
    if (keyframes.length < 2) return null;
    return {
        keyframes,
        length: round(pathLength(route), 1),
        sampled: samples.length,
        window: { from, to },
    };
}

/** The CLIENT VARIANT + USER ANNOTATIONS section appended to the agent context. */
function describeVariant(variant, manifest, composition, selection, mode) {
    const lines = [];
    const variantIds = new Set(variant.layers.map((layer) => layer.id));
    if (variant.layers.length) {
        lines.push('CLIENT VARIANT — layers added in this browser (real, animatable layers; not in the master file):');
        for (const layer of variant.layers) {
            lines.push(`- ${layer.id} "${layer.name}" (${layer.kind}) box ${JSON.stringify({ x: layer.x, y: layer.y, w: layer.w, h: layer.h })} z ${layer.z}`);
        }
    }
    if (variant.strokes.length) {
        lines.push(`USER ANNOTATIONS — ${variant.strokes.length} stroke${variant.strokes.length === 1 ? '' : 's'} drawn on the stage from a green start dot to a purple end dot (arrowhead); several strokes are consecutive legs of one route in the order drawn. Annotation window: ${seconds(variant.window.from)}→${seconds(variant.window.to)}.`);
        variant.strokes.forEach((stroke, index) => {
            const points = resamplePath(stroke.points, 8);
            const start = points[0];
            const end = points[points.length - 1];
            lines.push(`- stroke ${index + 1}: ${stroke.points.length} points, ${round(pathLength(stroke.points), 1)}% of the canvas long · ${points.map((point) => `(${point[0]},${point[1]})`).join(' → ')} · start (${start[0]},${start[1]}) → end (${end[0]},${end[1]})`);
        });
        const plan = annotationPlan(manifest, composition, variant, selection, mode);
        if (plan) {
            lines.push('SUGGESTED PATH KEYFRAMES for the selection (relative dx/dy in canvas %, composed on its current animation). The first offset is 0 so the subject starts where it is; each later offset moves it along the stroke while subtracting the subject\'s own motion, so the drawn route is tracked. They are computed from the master composition: if the working variant already moved this subject, treat them as a starting point. Use them as your plan for apply_timeline.');
            lines.push(JSON.stringify(plan.keyframes));
        } else if (!selection.length) {
            lines.push('(No selection, so no path keyframes were computed. Ask which subject should follow the route, or use the ids above.)');
        }
    }
    const selectedVariant = selection.filter((id) => variantIds.has(id));
    if (selectedVariant.length) {
        const labels = selectedVariant.map((id) => {
            const layer = variant.layers.find((entry) => entry.id === id);
            return `${id} "${layer ? layer.name : id}"`;
        });
        lines.push(`USER SELECTION (client variant): ${labels.join(', ')}`);
    }
    return lines.length ? `\n\n${lines.join('\n')}` : '';
}

function parseModelJson(text) {
    if (typeof text !== 'string') return null;
    let cleaned = text.trim();
    if (!cleaned) return null;
    cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
    const tryParse = (value) => {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    };
    const direct = tryParse(cleaned);
    if (direct) return direct;
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return tryParse(cleaned.slice(start, end + 1));
    return null;
}

function sanitiseMessages(value) {
    const out = [];
    for (const message of (Array.isArray(value) ? value.slice(-MAX_MESSAGES) : [])) {
        if (!message || message.role === 'system') continue; // the server owns the system prompt
        const content = typeof message.content === 'string' ? message.content.trim().slice(0, MAX_MESSAGE_CHARS) : '';
        if (!content) continue;
        out.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content });
    }
    if (!out.length) throw fail(400, 'Ask the agent for something first.');
    return out;
}

function sanitiseSelection(value, manifest, variantIds = new Set()) {
    const out = [];
    for (const id of (Array.isArray(value) ? value : [])) {
        if (typeof id !== 'string' || out.includes(id)) continue;
        if (!ProjectManifest.resolve(manifest, [id]).length && !variantIds.has(id)) continue;
        out.push(id);
        if (out.length >= MAX_SELECTION) break;
    }
    return out;
}

/** Run the read-only query tools an agent may ask for before it writes edits. */
function runQueries(manifest, composition, value) {
    const requests = Array.isArray(value) ? value.slice(0, MAX_QUERIES) : [];
    const results = [];
    const log = [];
    for (const request of requests) {
        const tool = String((request && (request.tool || request.name)) || '').trim();
        if (tool === 'find_elements') {
            const query = String((request && request.query) || '').trim().slice(0, 300);
            const hits = query ? ProjectManifest.find(manifest, query, 8) : [];
            results.push({ tool, query, results: hits });
            log.push({ tool, query, count: hits.length });
            continue;
        }
        if (tool === 'get_keyframes') {
            const id = String((request && request.id) || '').trim();
            const resolved = ProjectManifest.resolve(manifest, [id]);
            if (!resolved.length) {
                results.push({ tool, id, error: 'Unknown id' });
                log.push({ tool, id, error: 'unknown id' });
                continue;
            }
            const layers = resolved.flatMap((entry) => entry.ids).slice(0, 4).map((layerId) => ({
                id: layerId,
                label: (manifest._by.get(layerId) || {}).label || layerId,
                keyframes: ProjectManifest.keyframes(composition, layerId).slice(0, 80),
            }));
            results.push({ tool, id, layers });
            log.push({ tool, id, count: layers.length });
            continue;
        }
        if (tool === 'visible_at') {
            const ms = clamp(finite(request && request.ms, 0), 0, finite(composition.duration, 0));
            const layers = ProjectManifest.at(manifest, ms).slice(0, 80);
            results.push({ tool, ms, layers });
            log.push({ tool, ms, count: layers.length });
            continue;
        }
        results.push({ tool: tool || '(missing)', error: 'Unknown query tool' });
        log.push({ tool: tool || '(missing)', error: 'unknown tool' });
    }
    return { results, log };
}

function normaliseEdits(value, manifest, composition, warnings, variant) {
    const duration = Math.max(0, finite(composition.duration, 0));
    const variantById = new Map(((variant && variant.layers) || []).map((layer) => [layer.id, layer]));
    const out = [];
    let dropped = 0;
    for (const raw of (Array.isArray(value) ? value.slice(0, MAX_EDITS) : [])) {
        if (!raw || typeof raw !== 'object') { dropped += 1; continue; }
        const wanted = (Array.isArray(raw.ids) ? raw.ids : []).filter((id) => typeof id === 'string');
        const targets = new Set(ProjectTimeline.resolveLayers(manifest, wanted, composition));
        for (const id of wanted) if (variantById.has(id)) targets.add(id);
        const ids = [
            ...composition.layers.filter((layer) => targets.has(layer.id)).map((layer) => layer.id),
            ...[...targets].filter((id) => variantById.has(id)),
        ];
        if (!ids.length) { dropped += 1; continue; }

        const relative = raw.relative !== false;
        const frames = [];
        for (const frame of (Array.isArray(raw.keyframes) ? raw.keyframes.slice(0, MAX_KEYFRAMES) : [])) {
            if (!frame || typeof frame !== 'object') continue;
            const time = finite(frame.time, NaN);
            if (!Number.isFinite(time)) continue;
            const next = { time: Math.round(clamp(time, 0, duration)) };
            let meaningful = false;
            if (relative) {
                for (const [key, min, max] of [
                    ['dx', -400, 400], ['dy', -400, 400], ['scale', 0, 20],
                    ['rotation', -1440, 1440], ['opacity', 0, 1],
                ]) {
                    if (frame[key] === undefined || !Number.isFinite(Number(frame[key]))) continue;
                    next[key] = round(clamp(Number(frame[key]), min, max));
                    meaningful = true;
                }
            } else {
                for (const [key, min, max] of [
                    ['x', -200, 300], ['y', -200, 300], ['w', 0.01, 400], ['h', 0.01, 400],
                    ['rotation', -1440, 1440], ['opacity', 0, 1],
                ]) {
                    if (frame[key] === undefined || !Number.isFinite(Number(frame[key]))) continue;
                    next[key] = round(clamp(Number(frame[key]), min, max));
                    meaningful = true;
                }
            }
            if (meaningful) frames.push(next);
        }
        if (!frames.length) { dropped += 1; continue; }
        frames.sort((a, b) => a.time - b.time);
        const edit = { ids, relative, keyframes: frames };
        if (relative && raw.pivot && Number.isFinite(Number(raw.pivot.x)) && Number.isFinite(Number(raw.pivot.y))) {
            edit.pivot = { x: round(clamp(Number(raw.pivot.x), 0, 100)), y: round(clamp(Number(raw.pivot.y), 0, 100)) };
        }
        edit.labels = [...new Set(ids.map((id) => (manifest._by.get(id) || {}).label || (variantById.get(id) || {}).name || id))].slice(0, 40);
        out.push(edit);
    }
    if (dropped) warnings.push(`${dropped} edit${dropped === 1 ? ' was' : 's were'} ignored: no matching layers or no usable keyframes.`);
    return out;
}

function normaliseLayers(value, composition, warnings) {
    const duration = Math.max(0, finite(composition.duration, 0));
    const out = [];
    let dropped = 0;
    for (const raw of (Array.isArray(value) ? value.slice(0, MAX_LAYERS) : [])) {
        if (!raw || typeof raw !== 'object') { dropped += 1; continue; }
        let svg;
        try {
            svg = ProjectTimeline.safeSvg(raw.svg);
        } catch {
            dropped += 1;
            continue;
        }
        if (svg.length > MAX_SVG_CHARS) { dropped += 1; continue; }
        const box = ['x', 'y', 'w', 'h'].map((key) => finite(raw[key], NaN));
        if (box.some((number) => !Number.isFinite(number))) { dropped += 1; continue; }
        const [x, y, w, h] = [
            clamp(box[0], -200, 300), clamp(box[1], -200, 300),
            clamp(box[2], 0.2, 400), clamp(box[3], 0.2, 400),
        ];
        const frames = [];
        for (const frame of (Array.isArray(raw.keyframes) ? raw.keyframes.slice(0, MAX_KEYFRAMES) : [])) {
            if (!frame || typeof frame !== 'object') continue;
            const time = finite(frame.time, NaN);
            if (!Number.isFinite(time)) continue;
            const next = { time: Math.round(clamp(time, 0, duration)) };
            let meaningful = false;
            for (const [key, min, max] of [
                ['x', -200, 300], ['y', -200, 300], ['w', 0.2, 400], ['h', 0.2, 400],
                ['rotation', -1440, 1440], ['opacity', 0, 1],
            ]) {
                if (frame[key] === undefined || !Number.isFinite(Number(frame[key]))) continue;
                next[key] = round(clamp(Number(frame[key]), min, max));
                meaningful = true;
            }
            if (meaningful) frames.push(next);
        }
        frames.sort((a, b) => a.time - b.time);
        out.push({
            name: String(raw.name || 'Generated element').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Generated element',
            svg,
            x: round(x), y: round(y), w: round(w), h: round(h),
            z: round(clamp(finite(raw.z, 50), 0, 100)),
            keyframes: frames,
        });
    }
    if (dropped) warnings.push(`${dropped} generated element${dropped === 1 ? ' was' : 's were'} ignored: invalid SVG or box.`);
    return out;
}

/** Validate and bound one model reply into the document the page applies. */
function normaliseTurn(parsed, { manifest, composition, variant }) {
    const warnings = [];
    const source = parsed && typeof parsed === 'object' ? parsed : {};
    const reply = typeof source.reply === 'string' ? source.reply.trim().slice(0, 1600) : '';
    const ask = typeof source.ask === 'string' ? source.ask.trim().slice(0, 400) : '';
    const beats = (Array.isArray(source.beats) ? source.beats : [])
        .map((beat) => String(beat).trim().slice(0, 240))
        .filter(Boolean)
        .slice(0, 8);
    const edits = normaliseEdits(source.edits, manifest, composition, warnings, variant);
    const layers = normaliseLayers(source.layers, composition, warnings);
    if (source.queries && !edits.length && !layers.length && !reply) {
        warnings.push('The agent asked for more project data instead of answering; send the request again.');
    }
    return {
        reply: reply || (edits.length || layers.length ? 'Updated the working variant.' : 'Nothing to change in this variant.'),
        ask,
        beats,
        edits,
        layers,
        warnings,
        duration: finite(composition.duration, 0),
    };
}

/**
 * One agent turn against a project.
 *
 * deps.resolveModel(payload) -> {provider, model}
 * deps.generate({provider, model, messages}) -> the model's text
 *
 * The server rebuilds the context from disk on every turn, so the agent always
 * sees the current project rather than whatever the page cached at load time.
 */
async function agentTurn(payload = {}, deps = {}) {
    if (typeof deps.generate !== 'function') throw fail(500, 'The project canvas has no model transport.');
    const { provider, model } = deps.resolveModel
        ? await deps.resolveModel(payload)
        : { provider: payload.provider || 'deepseek', model: payload.model || 'deepseek-flash' };
    const { composition, manifest, project } = await readProject(payload.projectId, payload.compositionId);
    const mode = payload.mode === 'blank' ? 'blank' : 'original';
    const variant = sanitiseVariant(payload.variant, composition);
    const variantIds = new Set(variant.layers.map((layer) => layer.id));
    const selection = sanitiseSelection(payload.selection, manifest, variantIds);
    const manifestSelection = selection.filter((id) => ProjectManifest.resolve(manifest, [id]).length);
    const messages = sanitiseMessages(payload.messages);
    const context = ProjectManifest.context(manifest, { selection: manifestSelection, mode })
        + describeVariant(variant, manifest, composition, selection, mode);
    const system = `${PROMPT}\n\n===== PROJECT CONTEXT =====\n${context.length > MAX_CONTEXT_CHARS ? context.slice(0, MAX_CONTEXT_CHARS) + '\n… (context truncated)' : context}`;
    const requestMessages = [{ role: 'system', content: system }, ...messages];

    const firstText = await deps.generate({ provider, model, messages: requestMessages, phase: 'plan' });
    let parsed = parseModelJson(firstText);
    let queries = [];
    if (parsed && Array.isArray(parsed.queries) && parsed.queries.length) {
        const { results, log } = runQueries(manifest, composition, parsed.queries);
        queries = log;
        const followUp = [
            { role: 'system', content: system },
            ...messages,
            { role: 'assistant', content: JSON.stringify({ queries: parsed.queries }) },
            {
                role: 'user',
                content: `QUERY RESULTS (JSON)\n${JSON.stringify(results)}\n\nNow answer with the final JSON object: reply, beats, ask, edits, layers.`,
            },
        ];
        const secondText = await deps.generate({ provider, model, messages: followUp, phase: 'answer' });
        parsed = parseModelJson(secondText) || parsed;
        if (!parseModelJson(secondText)) {
            // Keep the plan's queries out of the final document; report the unusable reply instead.
            parsed = { reply: String(secondText || '').trim().slice(0, 1200) };
        }
    }

    if (!parsed) {
        const reply = String(firstText || '').trim().slice(0, 1200);
        if (!reply) throw fail(502, 'The agent returned an empty response.');
        return {
            ok: true, provider, model, project: project.name, mode, selection,
            reply, ask: '', beats: [], edits: [], layers: [],
            warnings: ['The model reply was not valid JSON, so no edits were applied.'],
            queries, duration: finite(composition.duration, 0),
        };
    }

    const turn = normaliseTurn(parsed, { manifest, composition, variant });
    return {
        ok: true, provider, model, project: project.name, mode, selection,
        ...turn, queries,
    };
}

module.exports = {
    PROMPT,
    ROOT,
    PROJECTS_DIR,
    MAX_EDITS,
    MAX_KEYFRAMES,
    MAX_LAYERS,
    MAX_MESSAGES,
    MAX_QUERIES,
    MAX_VARIANT_LAYERS,
    MAX_STROKES,
    listProjects,
    readProject,
    sanitiseMessages,
    sanitiseSelection,
    normaliseTurn,
    sanitiseVariant,
    describeVariant,
    annotationPlan,
    resamplePath,
    pathLength,
    parseModelJson,
    runQueries,
    agentTurn,
};
