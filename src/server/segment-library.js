'use strict';

/**
 * Read and search the generated segment-group library.
 *
 * The library itself is built by `scripts/build-segment-library.py`; this
 * module only validates it, exposes search for agents and reads one group at
 * a time for the UI. No writes: rebuilding is a deliberate CLI step.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const SCHEMA = 'studio/segment-groups/1';
const MOTION_SCHEMA = 'studio/segment-group-motions/1';
const GROUP_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;

function paths(libraryDir) {
    const root = path.resolve(libraryDir);
    return {
        root,
        dir: path.join(root, 'segment-groups'),
        index: path.join(root, 'segment-groups', 'index.json'),
        motions: path.join(root, 'segment-groups', 'motions.json'),
        groups: path.join(root, 'segment-groups', 'groups'),
    };
}

async function readJson(file) {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
}

function fail(message, statusCode) {
    const error = new Error(message);
    error.status = statusCode;
    error.statusCode = statusCode;
    return error;
}

const cache = new Map();

async function readIndex(libraryDir) {
    const file = paths(libraryDir).index;
    let stat;
    try {
        stat = await fsp.stat(file);
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw fail('The segment library has not been built yet. Run: npm run build:segments', 503);
        }
        throw error;
    }
    const key = file;
    const cached = cache.get(key);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.index;

    const index = await readJson(file);
    if (!index || index.schema !== SCHEMA || !Array.isArray(index.groups) || !Array.isArray(index.categories)) {
        throw fail('The segment library index is missing or invalid.', 500);
    }
    cache.set(key, { mtimeMs: stat.mtimeMs, index });
    return index;
}

async function readMotions(libraryDir) {
    const file = paths(libraryDir).motions;
    let document;
    try {
        document = await readJson(file);
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw fail('The segment library motion recipes have not been built yet.', 503);
        }
        throw error;
    }
    if (!document || document.schema !== MOTION_SCHEMA || !Array.isArray(document.motions)) {
        throw fail('The segment library motions file is invalid.', 500);
    }
    return document;
}

function safeGroupId(value) {
    const id = String(value || '');
    if (!GROUP_ID.test(id)) {
        throw fail('Invalid segment group id.', 400);
    }
    return id;
}

async function readGroup(libraryDir, groupId) {
    const id = safeGroupId(groupId);
    const file = path.join(paths(libraryDir).groups, `${id}.json`);
    let group;
    try {
        group = await readJson(file);
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw fail(`Segment group “${id}” was not found.`, 404);
        }
        throw error;
    }
    if (!group || group.schema !== SCHEMA || !Array.isArray(group.members)) {
        throw fail(`Segment group “${id}” is invalid.`, 500);
    }
    return group;
}

function asInt(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function normaliseOptions(options = {}) {
    return {
        q: String(options.q || '').trim().toLowerCase(),
        category: String(options.category || '').trim(),
        origin: String(options.origin || '').trim(),
        motion: String(options.motion || '').trim(),
        project: String(options.project || '').trim(),
        hasPreview: ['1', 'true', 'yes'].includes(String(options.hasPreview || '').toLowerCase()),
        sort: String(options.sort || 'category'),
        limit: asInt(options.limit, 60, 1, 200),
        offset: asInt(options.offset, 0, 0, 100000),
    };
}

function compareGroups(sort) {
    if (sort === 'name') return (a, b) => a.name.localeCompare(b.name);
    if (sort === 'layers') return (a, b) => b.layerCount - a.layerCount || a.name.localeCompare(b.name);
    if (sort === 'sources') return (a, b) => b.occurrenceCount - a.occurrenceCount || a.name.localeCompare(b.name);
    return null;
}

function search(index, options = {}) {
    const query = normaliseOptions(options);
    const terms = query.q ? query.q.split(/\s+/).filter(Boolean) : [];
    let groups = index.groups.filter((group) => {
        if (query.category && group.category !== query.category) return false;
        if (query.origin === 'declared' && group.origin !== 'declared') return false;
        if (query.origin === 'inferred' && group.origin === 'declared') return false;
        if (query.project && group.source.projectId !== query.project) return false;
        if (query.hasPreview && !(group.preview && (group.preview.card || group.preview.full))) return false;
        if (query.motion && !(group.motions || []).some((motion) => motion.id === query.motion)) return false;
        if (!terms.length) return true;
        const haystack = [
            group.name,
            group.category,
            group.categoryLabel,
            group.keywords || '',
            (group.tags || []).join(' '),
            group.source.projectId,
            group.source.compositionId,
            group.id,
        ].join(' ').toLowerCase();
        return terms.every((term) => haystack.includes(term));
    });

    const comparator = compareGroups(query.sort);
    if (comparator) groups = [...groups].sort(comparator);

    const total = groups.length;
    const page = groups.slice(query.offset, query.offset + query.limit);
    return {
        total,
        limit: query.limit,
        offset: query.offset,
        query: { ...query, q: options.q || '' },
        groups: page,
    };
}

function summary(index) {
    return {
        schema: index.schema,
        generatedAt: index.generatedAt,
        counts: index.counts,
        categories: index.categories,
        motions: index.motions,
        roots: index.roots,
    };
}

function projectList(index) {
    const map = new Map();
    for (const group of index.groups) {
        const id = group.source.projectId;
        if (!map.has(id)) {
            map.set(id, {
                id,
                kind: group.source.kind,
                groups: 0,
                layers: 0,
            });
        }
        const entry = map.get(id);
        entry.groups += 1;
        entry.layers += group.layerCount;
    }
    return [...map.values()].sort((a, b) => b.groups - a.groups || a.id.localeCompare(b.id));
}

module.exports = {
    SCHEMA,
    MOTION_SCHEMA,
    paths,
    readIndex,
    readMotions,
    readGroup,
    search,
    summary,
    projectList,
};
