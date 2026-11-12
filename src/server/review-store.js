'use strict';
/**
 * review-store.js — per-surface manual review marks for the four studio UIs.
 *
 * A mark answers "does this item work in this surface?" for AFS, Studio Agent,
 * Project Canvas and Studio. Keys are stable across surfaces: an item carries
 * every id it is known by (design, composition, animation, project, template),
 * and a mark is matched when any of those ids match.
 *
 * File: data/settings/reviews.json
 */
const fsp = require('node:fs/promises');
const path = require('node:path');

const SCHEMA = 'studio/reviews/1';
const SURFACES = ['afs', 'studio-agent', 'project-canvas', 'studio'];
const STATUSES = ['works', 'broken', 'review', 'unmarked'];
const ID_KEYS = ['designId', 'compositionId', 'animationId', 'projectId', 'templateId'];

const cleanText = (value, max = 160) => String(value == null ? '' : value).trim().slice(0, max);

function cleanIds(value) {
    if (!value || typeof value !== 'object') return {};
    const ids = {};
    ID_KEYS.forEach((key) => {
        const text = cleanText(value[key], 160);
        if (/^[A-Za-z0-9_:./-]{1,160}$/.test(text)) ids[key] = text;
    });
    return ids;
}

function primaryId(kind, ids) {
    for (const key of ID_KEYS) {
        if (ids[key]) return ids[key];
    }
    return '';
}

function idKey(value) {
    return String(value || '').toLowerCase();
}

function matches(item, ids) {
    if (!item || !item.ids) return false;
    return ID_KEYS.some((key) => ids[key] && idKey(item.ids[key]) === idKey(ids[key]));
}

function emptyState() {
    return { schema: SCHEMA, updatedAt: new Date().toISOString(), items: [] };
}

async function readState(file) {
    try {
        const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
        if (!raw || raw.schema !== SCHEMA || !Array.isArray(raw.items)) return emptyState();
        return {
            schema: SCHEMA,
            updatedAt: raw.updatedAt || new Date().toISOString(),
            items: raw.items
                .filter((item) => item && item.ids && item.surfaces)
                .map((item) => ({ ...item, note: typeof item.note === 'string' ? item.note : '' })),
        };
    } catch (error) {
        if (error.code === 'ENOENT') return emptyState();
        throw error;
    }
}

async function writeState(file, state) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
    await fsp.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`);
    await fsp.rename(temp, file);
}

function validatePayload(payload) {
    const mode = payload && payload.mode === 'note' ? 'note' : 'mark';
    let surface = cleanText(payload && payload.surface, 40);
    let status = cleanText(payload && payload.status, 20) || 'unmarked';
    if (mode === 'mark') {
        if (!SURFACES.includes(surface)) {
            const error = new Error(`Unknown surface. Use one of: ${SURFACES.join(', ')}.`);
            error.statusCode = 400;
            throw error;
        }
        if (!STATUSES.includes(status)) {
            const error = new Error(`Unknown review status. Use one of: ${STATUSES.join(', ')}.`);
            error.statusCode = 400;
            throw error;
        }
    } else {
        if (!SURFACES.includes(surface)) surface = '';
        status = 'unmarked';
    }
    const ids = cleanIds(payload && payload.ids);
    if (!primaryId('', ids)) {
        const error = new Error('An item needs at least one id (designId, compositionId, animationId, projectId or templateId).');
        error.statusCode = 400;
        throw error;
    }
    const kind = cleanText(payload && payload.kind, 40) || 'design';
    const name = cleanText(payload && payload.name, 200);
    const note = cleanText(payload && payload.note, 500);
    const auto = cleanText(payload && payload.auto, 40);
    return { surface, status, ids, kind, name, note, auto, mode };
}

/**
 * Create or update one surface mark. Returns the stored item plus the state.
 * `status: 'unmarked'` removes the mark for that surface.
 */
async function setMark(file, payload) {
    const { surface, status, ids, kind, name, note, auto, mode } = validatePayload(payload);
    const state = await readState(file);
    let item = state.items.find((candidate) => matches(candidate, ids)) || null;
    if (!item) {
        if (state.items.length >= 2000) {
            const error = new Error('The review registry is full (2000 items).');
            error.statusCode = 409;
            throw error;
        }
        item = {
            key: `${kind}:${primaryId(kind, ids)}`,
            name: name || primaryId(kind, ids),
            kind,
            ids: {},
            auto: auto || '',
            note: '',
            surfaces: {},
            updatedAt: new Date().toISOString(),
        };
        state.items.push(item);
    }
    item.ids = { ...item.ids, ...ids };
    if (name) item.name = name;
    if (kind) item.kind = kind;
    if (auto) item.auto = auto;
    item.updatedAt = new Date().toISOString();
    if (mode === 'note') {
        item.note = note;
    } else if (status === 'unmarked') {
        delete item.surfaces[surface];
    } else {
        item.surfaces[surface] = {
            status,
            note,
            updatedAt: new Date().toISOString(),
        };
    }
    state.updatedAt = item.updatedAt;
    await writeState(file, state);
    return { item, state };
}

module.exports = {
    SCHEMA,
    SURFACES,
    STATUSES,
    ID_KEYS,
    emptyState,
    readState,
    setMark,
    matches,
};
