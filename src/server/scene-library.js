'use strict';

/**
 * Read, search and compose the curated scene/parts library.
 *
 * The data is produced by `scripts/build-scene-library.py`; this module is
 * read-only. `buildScene()` is a deterministic interpreter that turns a scene
 * idea into a composition using documented parts, groups and observed tracks.
 */

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const SCHEMA = 'studio/scene-library/1';
const PART_SCHEMA = 'studio/scene-library/part/1';
const GROUP_SCHEMA = 'studio/scene-library/group/1';
const BUILD_SCHEMA = 'studio/scene-build/1';
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;

function paths(libraryDir) {
    const root = path.resolve(libraryDir);
    return {
        root,
        dir: path.join(root, 'scene-library'),
        index: path.join(root, 'scene-library', 'index.json'),
        scenes: path.join(root, 'scene-library', 'scenes'),
        parts: path.join(root, 'scene-library', 'parts'),
        groups: path.join(root, 'scene-library', 'groups'),
        animations: path.join(root, 'scene-library', 'animations'),
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
            throw fail('The scene library has not been built yet. Run: python3 scripts/build-scene-library.py', 503);
        }
        throw error;
    }
    const cached = cache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.index;
    const index = await readJson(file);
    if (!index || index.schema !== SCHEMA || !Array.isArray(index.parts) || !Array.isArray(index.concepts)) {
        throw fail('The scene library index is missing or invalid.', 500);
    }
    cache.set(file, { mtimeMs: stat.mtimeMs, index });
    return index;
}

async function readScene(libraryDir, sceneId) {
    const id = String(sceneId || '');
    if (!SAFE_ID.test(id)) throw fail('Invalid scene id.', 400);
    const file = path.join(paths(libraryDir).scenes, `${id}.json`);
    try {
        const scene = await readJson(file);
        if (!scene || scene.schema !== SCHEMA || !Array.isArray(scene.parts)) {
            throw fail(`Scene “${id}” is invalid.`, 500);
        }
        return scene;
    } catch (error) {
        if (error.code === 'ENOENT') throw fail(`Scene “${id}” was not found.`, 404);
        throw error;
    }
}

async function readPart(libraryDir, partId) {
    const id = String(partId || '');
    if (!SAFE_ID.test(id)) throw fail('Invalid part id.', 400);
    const file = path.join(paths(libraryDir).parts, `${id}.json`);
    try {
        return await readJson(file);
    } catch (error) {
        if (error.code === 'ENOENT') throw fail(`Scene part “${id}” was not found.`, 404);
        throw error;
    }
}

async function readGroup(libraryDir, groupId) {
    const id = String(groupId || '');
    if (!SAFE_ID.test(id)) throw fail('Invalid group id.', 400);
    const file = path.join(paths(libraryDir).groups, `${id}.json`);
    try {
        return await readJson(file);
    } catch (error) {
        if (error.code === 'ENOENT') throw fail(`Scene group “${id}” was not found.`, 404);
        throw error;
    }
}

function asInt(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function normalise(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseHit(text, phrase) {
    const words = normalise(phrase);
    if (!words) return false;
    const parts = words.split(' ').map((part) => part.replace(/s$/, ''));
    // Match the phrase with an optional plural on the final word. This makes
    // "bricks" match "brick", "cars" match "car", and "buildings" match
    // "building" without treating substrings such as "car" in "scattered".
    const expression = parts.map(escapeRegex).map((part) => `${part}(?:s|es)?`).join('\\s+');
    return new RegExp(`(^|[^a-z0-9])${expression}([^a-z0-9]|$)`, 'i').test(text);
}

function partHaystack(part) {
    return [
        part.id,
        part.name,
        part.label,
        part.description,
        part.category,
        part.zone,
        (part.groupIds || []).join(' '),
        (part.tags || []).join(' '),
        (part.concepts || []).join(' '),
    ].join(' ').toLowerCase();
}

function partByConcept(index, conceptId) {
    const concept = (index.concepts || []).find((entry) => entry.id === conceptId);
    return concept ? concept.partIds : [];
}

function searchParts(index, options = {}) {
    const q = normalise(options.q);
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];
    const group = String(options.group || '').trim();
    const concept = String(options.concept || '').trim();
    const scene = String(options.scene || '').trim();
    const limit = asInt(options.limit, 80, 1, 200);
    const conceptParts = concept ? new Set(partByConcept(index, concept)) : null;
    const parts = (index.parts || []).filter((part) => {
        if (scene && part.sceneId !== scene) return false;
        if (group && !(part.groupIds || []).includes(group)) return false;
        if (conceptParts && !conceptParts.has(part.id)) return false;
        if (!terms.length) return true;
        const haystack = partHaystack(part);
        return terms.every((term) => haystack.includes(term));
    });
    return { total: parts.length, limit, parts: parts.slice(0, limit) };
}

function searchGroups(index, options = {}) {
    const q = normalise(options.q);
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];
    const limit = asInt(options.limit, 80, 1, 200);
    const groups = (index.groups || []).filter((group) => {
        if (!terms.length) return true;
        const haystack = [group.id, group.label, group.description, (group.tags || []).join(' ')].join(' ').toLowerCase();
        return terms.every((term) => haystack.includes(term));
    });
    return { total: groups.length, limit, groups: groups.slice(0, limit) };
}

function sceneList(index) {
    return (index.scenes || []).map((scene) => ({
        ...scene,
        groupCount: (index.groups || []).length,
    }));
}

function summary(index) {
    return {
        schema: index.schema,
        generatedAt: index.generatedAt,
        sceneId: index.sceneId,
        counts: index.counts,
        palette: index.palette,
        scenes: sceneList(index),
        examples: index.examples || [],
        missingVocabulary: index.missingVocabulary || [],
    };
}

function selectConcepts(index, idea) {
    const text = normalise(idea);
    const matched = [];
    const missing = [];
    for (const concept of index.concepts || []) {
        const hit = (concept.aliases || []).some((alias) => phraseHit(text, alias));
        if (!hit) continue;
        const entry = {
            id: concept.id,
            label: concept.label,
            description: concept.description,
            count: concept.count || (concept.partIds || []).length,
            partIds: concept.partIds || [],
            groupIds: concept.groupIds || [],
        };
        if (concept.missing) missing.push(entry);
        else matched.push(entry);
    }
    const matchedIds = new Set(matched.map((entry) => entry.id));
    if (matchedIds.has('lighting')) {
        for (let i = matched.length - 1; i >= 0; i -= 1) {
            if (matched[i].id === 'night') matched.splice(i, 1);
        }
    }
    if (matchedIds.has('cyclist') || matchedIds.has('bicycle')) {
        for (let i = matched.length - 1; i >= 0; i -= 1) {
            if (matched[i].id === 'people') matched.splice(i, 1);
        }
    }
    return { text, matched, missing };
}

function addUnique(target, ids) {
    const set = target instanceof Set ? target : new Set(target);
    for (const id of ids || []) set.add(id);
    return set;
}

function buildLayers(parts, scene) {
    return parts
        .filter((part) => part.buildable)
        .sort((a, b) => (a.buildZ || 0) - (b.buildZ || 0))
        .map((part) => ({
            id: part.id,
            partId: part.id,
            sourceLayerId: part.sourceLayerId || part.id,
            name: part.label || part.name,
            type: 'image',
            role: part.role,
            z: part.buildZ,
            x: part.box.x,
            y: part.box.y,
            w: part.box.w,
            h: part.box.h,
            opacity: part.opacity ?? 1,
            rotation: part.rotation || 0,
            visible: true,
            fit: 'contain',
            url: part.url,
            segmentGroup: (part.groupIds || [])[0] || '',
        }));
}

function hash(value) {
    return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 8);
}

function buildScene(scene, index, idea) {
    const query = String(idea || '').trim();
    const { text, matched, missing } = selectConcepts(index, query);
    const partsById = new Map((scene.parts || index.parts).map((part) => [part.id, part]));
    const selected = new Set();
    const direct = normalise(query)
        ? (index.parts || []).filter((part) => part.buildable && partHaystack(part).includes(normalise(query)))
        : [];
    for (const part of direct) selected.add(part.id);
    for (const concept of matched) addUnique(selected, concept.partIds);

    const defaultBuild = !selected.size && !missing.length;
    if (defaultBuild) addUnique(selected, scene.build.defaultPartIds);

    // A coherent scene still needs a ground and a backdrop. Add the documented
    // street base unless the caller is only inspecting a group concept.
    const base = scene.build.basePartIds || [];
    const context = scene.build.contextPartIds || [];
    const foreground = scene.build.foregroundPartIds || [];
    const cyclist = scene.build.cyclistPartIds || [];
    const lighting = scene.build.lightingPartIds || [];
    const matchedIds = new Set(matched.map((entry) => entry.id));
    if (selected.size) {
        addUnique(selected, base);
        addUnique(selected, context);
        if (matchedIds.has('cyclist') || matchedIds.has('bicycle') || matchedIds.has('people')) addUnique(selected, cyclist);
        if (matchedIds.has('lighting') || matchedIds.has('night')) addUnique(selected, lighting);
        if (matchedIds.has('tools') || matchedIds.has('plants') || matchedIds.has('props') || matchedIds.has('foreground')) addUnique(selected, foreground);
        if (!matchedIds.size) addUnique(selected, foreground);
    }
    // Never let a reference plate or an unknown id into a build.
    for (const id of [...selected]) {
        const part = partsById.get(id);
        if (!part || !part.buildable) selected.delete(id);
    }
    if (!selected.size) addUnique(selected, scene.build.defaultPartIds);

    // Some clean parts are already baked into another part (the café wordmark
    // is painted into the brick wall). Keep the baked surface and drop the
    // duplicate overlay so a scene does not double the sign.
    const byName = new Map((scene.parts || index.parts).map((part) => [part.name, part]));
    const deduped = [];
    for (const id of [...selected]) {
        const part = partsById.get(id);
        if (!part || !part.bakedInto) continue;
        const baked = byName.get(part.bakedInto);
        if (baked && selected.has(baked.id)) {
            selected.delete(id);
            deduped.push(part);
        }
    }

    const selectedParts = [...selected].map((id) => partsById.get(id)).filter(Boolean);
    const includedIds = new Set(selectedParts.map((part) => part.id));
    const includedSourceIds = new Set(selectedParts.map((part) => part.sourceLayerId || part.id));
    const groups = (scene.groups || []).filter((group) => (group.partIds || []).some((id) => includedIds.has(id)));
    const tracks = (scene.animation?.tracks || [])
        .filter((track) => includedSourceIds.has(track.layerId))
        .map((track) => ({ ...track }));
    const layers = buildLayers(selectedParts, scene);
    const duration = scene.build?.canvas?.duration || scene.duration;
    const id = `scene-build-${hash(`${scene.id}:${query || 'default'}`)}`;
    const composition = {
        version: 3,
        id,
        name: `Scene build — ${query || scene.name}`,
        width: scene.width,
        height: scene.height,
        duration,
        layers,
        meta: {
            source: 'scene-library',
            sceneId: scene.id,
            idea: query,
            concepts: matched.map((entry) => entry.id),
            missing: missing.map((entry) => entry.id),
            groups: groups.map((group) => group.id),
            animation: scene.animation?.url || null,
        },
    };

    const notes = [];
    if (query && selected.size) notes.push('Added the documented street base so the selected parts sit on a grounded set.');
    if (missing.length) {
        for (const entry of missing) {
            notes.push(entry.description);
        }
        notes.push('The build uses the available street, architecture, cyclist and lighting parts instead.');
    }
    if (selectedParts.some((part) => !part.staticVisible)) {
        notes.push('Some lighting parts are transparent overlays; they become visible through their observed opacity tracks.');
    }
    if (tracks.length) {
        notes.push(`${tracks.length} included parts carry observed animation (${matchedIds.has('cyclist') || matchedIds.has('bicycle') ? 'cyclist ride' : 'lighting/night'}${matchedIds.size > 1 ? ' and more' : ''}).`);
    }
    if (deduped.length) {
        notes.push(`${deduped.map((part) => part.label).join(', ')} already baked into another selected part; the duplicate overlay was left out.`);
    }
    notes.push('Flattened reference plates and duplicate wall plates are deliberately excluded; only reusable cut-outs are in this build.');

    return {
        schema: BUILD_SCHEMA,
        id,
        idea: query,
        scene: {
            id: scene.id,
            name: scene.name,
            title: scene.title,
            description: scene.description,
            setting: scene.setting,
            width: scene.width,
            height: scene.height,
            duration,
            preview: scene.preview,
            background: scene.build?.canvas?.background || '#15130f',
        },
        interpretation: {
            query,
            concepts: matched,
            missing,
            note: matched.length
                ? `Matched ${matched.length} concept${matched.length === 1 ? '' : 's'} from the scene vocabulary.`
                : 'No known scene concept matched; showing the documented default build.',
        },
        parts: selectedParts,
        groups,
        layers,
        composition,
        animation: {
            url: scene.animation?.url || '',
            duration,
            tracks,
            recipes: (scene.animation?.recipes || []).filter((recipe) => (recipe.layerIds || []).some((idValue) => includedSourceIds.has(idValue))),
        },
        notes,
        agent: {
            canBuild: scene.agent?.canBuild || [],
            buildHints: scene.agent?.buildHints || [],
            examples: scene.agent?.examples || [],
            dataQuality: scene.agent?.dataQuality || [],
            missingVocabulary: missing.map((entry) => entry.id),
            next: [
                'Use the layers as the starting composition; keep their source boxes and build order.',
                'Apply the included animation tracks to matching sourceLayerId values.',
                'Add a missing vocabulary entry to the scene library only after a real cut-out has been reviewable.',
            ],
        },
    };
}

module.exports = {
    SCHEMA,
    PART_SCHEMA,
    GROUP_SCHEMA,
    BUILD_SCHEMA,
    paths,
    readIndex,
    readScene,
    readPart,
    readGroup,
    searchParts,
    searchGroups,
    sceneList,
    summary,
    buildScene,
    normalise,
    phraseHit,
};
