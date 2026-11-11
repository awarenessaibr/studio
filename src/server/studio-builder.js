'use strict';

/**
 * Studio Builder — server-owned capability catalog, layout rules and the
 * action contract used by the optional model fallback.
 *
 * The page does not embed the capability map. It reads this catalog from
 * `/api/studio-builder/catalog`, caches the last good response, and computes
 * the same rules locally so drag/drop stays instant. The server repeats the
 * validation before it returns model actions, because an LLM must never be
 * able to add an unknown module or an unknown region.
 */

const fs = require('node:fs');
const path = require('node:path');

const CATALOG_FILE = path.join(__dirname, '..', 'shared', 'studio-builder-catalog.json');
const SCHEMA = 'studio-builder/catalog/1';
const MAX_ACTIONS = 16;
const MAX_MESSAGE = 4000;
const MAX_HISTORY = 12;
const MAX_REPLY = 1500;
const MAX_PLAN = 200;
const ACTION_TYPES = ['add', 'move', 'remove', 'preset', 'explain'];
const ACTION_ALIASES = {
    add: 'add', place: 'add', insert: 'add', put: 'add', show: 'add',
    move: 'move', relocate: 'move', swap: 'move',
    remove: 'remove', delete: 'remove', drop: 'remove', hide: 'remove', 'take-out': 'remove',
    preset: 'preset', load: 'preset', start: 'preset', reset: 'preset',
    explain: 'explain', describe: 'explain', details: 'explain', detail: 'explain',
};
const REGION_ALIASES = {
    top: 'top', header: 'top', toolbar: 'top', 'top bar': 'top', 'top-bar': 'top',
    left: 'left', sidebar: 'left', 'side panel': 'left', 'left panel': 'left',
    stage: 'stage', center: 'stage', centre: 'stage', middle: 'stage', canvas: 'stage',
    right: 'right', 'right panel': 'right', inspector: 'right',
    bottom: 'bottom', footer: 'bottom', dock: 'bottom', 'bottom dock': 'bottom', under: 'bottom',
    runtime: 'runtime', behind: 'runtime', background: 'runtime', 'behind the screen': 'runtime',
};

let cache = null;

function fail(message, status = 500) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function readCatalog() {
    let stat;
    try {
        stat = fs.statSync(CATALOG_FILE);
    } catch (error) {
        if (error.code === 'ENOENT') throw fail('The Studio Builder capability catalog is missing.', 500);
        throw error;
    }
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.catalog) return cache.catalog;
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    } catch (error) {
        throw fail(`The Studio Builder capability catalog is not valid JSON: ${error.message}`, 500);
    }
    validateCatalog(parsed);
    cache = { mtimeMs: stat.mtimeMs, catalog: parsed };
    return parsed;
}

function validateCatalog(catalog) {
    if (!catalog || catalog.schema !== SCHEMA) throw fail('The Studio Builder capability catalog has an unknown schema.', 500);
    if (!Array.isArray(catalog.modules) || !catalog.modules.length) throw fail('The catalog has no modules.', 500);
    if (!Array.isArray(catalog.regions) || !catalog.regions.length) throw fail('The catalog has no regions.', 500);
    const regionIds = new Set(catalog.regions.map((region) => region.id));
    const moduleIds = new Set();
    for (const module of catalog.modules) {
        if (!module || typeof module.id !== 'string' || !module.id) throw fail('A catalog module is missing its id.', 500);
        if (moduleIds.has(module.id)) throw fail(`The catalog repeats module ${module.id}.`, 500);
        moduleIds.add(module.id);
        if (!regionIds.has(module.region)) throw fail(`Module ${module.id} has an unknown default region.`, 500);
        if (!Array.isArray(module.requires)) throw fail(`Module ${module.id} has no requires list.`, 500);
    }
    for (const module of catalog.modules) {
        for (const dependency of module.requires) {
            if (!moduleIds.has(dependency)) throw fail(`Module ${module.id} requires unknown module ${dependency}.`, 500);
        }
    }
    for (const preset of Array.isArray(catalog.presets) ? catalog.presets : []) {
        if (!preset || !preset.id || !preset.regions) throw fail('A catalog preset is incomplete.', 500);
        for (const region of catalog.regions) {
            const list = preset.regions[region.id];
            if (list == null) continue;
            if (!Array.isArray(list)) throw fail(`Preset ${preset.id} has an invalid ${region.id} list.`, 500);
            for (const id of list) if (!moduleIds.has(id)) throw fail(`Preset ${preset.id} uses unknown module ${id}.`, 500);
        }
    }
    const pageSources = new Set();
    for (const page of Array.isArray(catalog.pages) ? catalog.pages : []) {
        if (!page || !page.source || !page.label || !page.url) throw fail('A catalog start page is incomplete.', 500);
        if (pageSources.has(page.source)) throw fail(`The catalog repeats start page ${page.source}.`, 500);
        pageSources.add(page.source);
        if (!/^\/[A-Za-z0-9._-]+\.html?$/i.test(page.url)) throw fail(`Start page ${page.source} has an invalid URL.`, 500);
        if (page.surface && !catalog.surfaces?.[page.surface]) throw fail(`Start page ${page.source} uses unknown surface ${page.surface}.`, 500);
        for (const id of page.modules || []) if (!moduleIds.has(id)) throw fail(`Start page ${page.source} uses unknown module ${id}.`, 500);
    }
    return catalog;
}

function moduleMap(catalog) {
    return new Map(catalog.modules.map((module) => [module.id, module]));
}

function regionIds(catalog) {
    return catalog.regions.map((region) => region.id);
}

function normaliseLayout(layout, catalog = readCatalog()) {
    const source = layout && typeof layout === 'object'
        ? (layout.regions && typeof layout.regions === 'object' ? layout.regions : layout)
        : {};
    const allowed = moduleMap(catalog);
    const out = {};
    for (const region of catalog.regions) {
        const list = Array.isArray(source[region.id]) ? source[region.id] : [];
        const seen = new Set();
        out[region.id] = list
            .map((id) => String(id || ''))
            .filter((id) => allowed.has(id) && !seen.has(id) && seen.add(id))
            .slice(0, 80);
    }
    return out;
}

function placedIds(layout) {
    return [...new Set(Object.values(layout || {}).flat())];
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function findIssues(layout, catalog = readCatalog()) {
    const clean = normaliseLayout(layout, catalog);
    const placed = placedIds(clean);
    const map = moduleMap(catalog);
    const name = (id) => map.get(id)?.name || id;
    const out = [];

    for (const rule of catalog.rules || []) {
        if (rule.type === 'at-most-one') {
            const active = (rule.modules || []).filter((id) => placed.includes(id));
            if (active.length > 1) {
                out.push({
                    ruleId: rule.id,
                    message: `${active.map(name).join(', ')} are all renderers on one screen. Their layer schemas differ, so keep one.`,
                    modules: active,
                    fix: { type: 'remove', moduleIds: active.slice(1), label: `Keep ${name(active[0])}` },
                });
            }
        } else if (rule.type === 'not-both') {
            const active = (rule.modules || []).filter((id) => placed.includes(id));
            if (active.length === 2) {
                out.push({
                    ruleId: rule.id,
                    message: `${name(active[0])} and ${name(active[1])} use different models. Pick one.`,
                    modules: active,
                    fix: { type: 'remove', moduleId: active[1], label: `Remove ${name(active[1])}` },
                });
            }
        } else if (rule.type === 'requires') {
            const missing = new Map();
            for (const id of placed) {
                for (const dependency of map.get(id)?.requires || []) {
                    if (placed.includes(dependency)) continue;
                    if (!missing.has(dependency)) missing.set(dependency, []);
                    missing.get(dependency).push(id);
                }
            }
            const core = new Set(catalog.core || []);
            for (const [dependency, causes] of missing) {
                const target = map.get(dependency);
                // Core modules always have their own rule below; do not repeat
                // the same missing module under two headings.
                if (!target || core.has(dependency)) continue;
                out.push({
                    ruleId: rule.id,
                    message: `${target.name} is required by ${causes.map(name).join(', ')}.`,
                    modules: [dependency, ...causes],
                    fix: { type: 'add', moduleId: dependency, region: target.region, label: `Add ${target.name}` },
                });
            }
        } else if (rule.type === 'required') {
            for (const id of rule.modules || []) {
                if (placed.includes(id)) continue;
                const target = map.get(id);
                if (!target) continue;
                out.push({
                    ruleId: rule.id,
                    message: `${target.name} is always loaded in the documented architecture.`,
                    modules: [id],
                    fix: { type: 'add', moduleId: id, region: 'runtime', label: 'Add' },
                });
            }
        }
    }
    return out;
}

function resolveModule(value, catalog) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    const map = moduleMap(catalog);
    if (map.has(raw)) return map.get(raw);
    const byId = catalog.modules.find((module) => module.id.toLowerCase() === lower);
    if (byId) return byId;
    const byName = catalog.modules.find((module) => module.name.toLowerCase() === lower);
    if (byName) return byName;
    return catalog.modules.find((module) => (module.aliases || []).some((alias) => alias.toLowerCase() === lower)) || null;
}

function resolveRegion(value, catalog) {
    const raw = String(value == null ? '' : value).trim().toLowerCase();
    if (!raw) return null;
    const direct = catalog.regions.find((region) => region.id === raw || region.label.toLowerCase() === raw);
    if (direct) return direct.id;
    return REGION_ALIASES[raw] || null;
}

function resolvePreset(value, catalog) {
    const raw = String(value == null ? '' : value).trim().toLowerCase();
    if (!raw) return null;
    return (catalog.presets || []).find((preset) => (
        preset.id.toLowerCase() === raw || String(preset.label || '').toLowerCase() === raw
    )) || null;
}

function normaliseAction(raw, catalog, layout) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const requested = String(raw.type || raw.action || raw.op || raw.operation || '').trim().toLowerCase();
    const type = ACTION_ALIASES[requested];
    if (!type) return null;

    if (type === 'preset') {
        const preset = resolvePreset(raw.presetId ?? raw.preset ?? raw.id ?? raw.value, catalog);
        return preset ? { type, presetId: preset.id } : null;
    }

    const module = resolveModule(raw.moduleId ?? raw.module ?? raw.id ?? raw.name ?? raw.value, catalog);
    if (!module) return null;
    if (type === 'explain') return { type, moduleId: module.id };

    const region = resolveRegion(raw.region ?? raw.to ?? raw.placement ?? raw.zone, catalog)
        || (type === 'add' ? module.region : null);
    if (type === 'move' && !region) return null;
    const index = Number.isInteger(raw.index) && raw.index >= 0 ? Math.min(raw.index, 79) : null;
    const action = { type, moduleId: module.id };
    if (region) action.region = region;
    if (index != null) action.index = index;
    return action;
}

function normaliseAgentResponse(parsed, catalog, layout) {
    if (typeof parsed === 'string') {
        return { reply: parsed.trim().slice(0, MAX_REPLY), actions: [] };
    }
    const source = parsed && typeof parsed === 'object' ? parsed : {};
    const list = Array.isArray(source.actions)
        ? source.actions
        : (Array.isArray(source.action) ? source.action : (source.action ? [source.action] : (Array.isArray(source.operations) ? source.operations : [])));
    const seen = new Set();
    const actions = [];
    for (const raw of list.slice(0, MAX_ACTIONS)) {
        const action = normaliseAction(raw, catalog, layout);
        if (!action) continue;
        const key = JSON.stringify(action);
        if (seen.has(key)) continue;
        seen.add(key);
        actions.push(action);
    }
    let reply = String(source.reply ?? source.message ?? source.text ?? '').trim();
    if (reply.length > MAX_REPLY) reply = `${reply.slice(0, MAX_REPLY - 1)}…`;
    if (!reply) {
        reply = actions.length
            ? `Applied ${actions.length} layout change${actions.length === 1 ? '' : 's'}.`
            : 'I could not map that to a capability. Name a module and a region.';
    }
    return { reply, actions };
}

function normaliseAgentRequest(payload, catalog = readCatalog()) {
    const source = payload && typeof payload === 'object' ? payload : {};
    if (source.mode && source.mode !== 'studio-builder') {
        throw fail('This endpoint only accepts mode=studio-builder.', 400);
    }
    const message = String(source.message ?? source.text ?? '').trim();
    if (!message) throw fail('The agent request has no message.', 400);
    if (message.length > MAX_MESSAGE) throw fail(`The agent message is longer than ${MAX_MESSAGE} characters.`, 413);
    const layout = normaliseLayout(source.layout, catalog);
    const history = (Array.isArray(source.history) ? source.history : [])
        .slice(-MAX_HISTORY)
        .filter((entry) => entry && typeof entry.text === 'string')
        .map((entry) => ({
            role: entry.role === 'assistant' ? 'assistant' : 'user',
            text: entry.text.trim().slice(0, 1200),
        }))
        .filter((entry) => entry.text);
    return { message, layout, history };
}

function applyActions(layout, actions, catalog = readCatalog()) {
    let next = normaliseLayout(layout, catalog);
    for (const action of actions || []) {
        if (!action || !ACTION_TYPES.includes(action.type)) continue;
        if (action.type === 'preset') {
            const preset = (catalog.presets || []).find((entry) => entry.id === action.presetId);
            if (preset) next = normaliseLayout(preset.regions, catalog);
            continue;
        }
        if (action.type === 'explain') continue;
        if (action.type === 'remove') {
            for (const region of regionIds(catalog)) {
                next[region] = next[region].filter((id) => id !== action.moduleId);
            }
            continue;
        }
        const region = action.region || resolveModule(action.moduleId, catalog)?.region;
        if (!region) continue;
        for (const key of regionIds(catalog)) {
            next[key] = next[key].filter((id) => id !== action.moduleId);
        }
        const list = next[region];
        const at = action.index == null ? list.length : Math.min(action.index, list.length);
        list.splice(at, 0, action.moduleId);
    }
    return next;
}

function buildAgentMessages(request, catalog = readCatalog()) {
    const map = moduleMap(catalog);
    const layout = normaliseLayout(request.layout, catalog);
    const issues = findIssues(layout, catalog);
    const capabilityLines = catalog.modules.map((module) => {
        const aliases = (module.aliases || []).slice(0, 6).join(', ');
        return `${module.id} | ${module.name} | ${module.domain} | ${module.region} | requires: ${module.requires.length ? module.requires.join(', ') : 'none'}${aliases ? ` | aliases: ${aliases}` : ''}`;
    });
    const regionLines = catalog.regions.map((region) => `${region.id} (${region.label})`);
    const presetLines = (catalog.presets || []).map((preset) => `${preset.id} (${preset.label})`);
    const ruleLines = (catalog.rules || []).map((rule) => {
        if (rule.type === 'at-most-one') return `At most one of ${rule.modules.join(', ')} may be on the stage.`;
        if (rule.type === 'not-both') return `${rule.modules.join(' and ')} cannot both be placed.`;
        if (rule.type === 'requires') return 'Every module requirement must also be placed.';
        if (rule.type === 'required') return `${rule.modules.join(', ')} are always loaded.`;
        return rule.message || rule.id;
    });
    const system = [
        'You are the Studio Builder agent. You arrange documented capabilities into a page layout.',
        'You cannot invent capabilities, module ids, regions or preset ids. Use only the catalog below.',
        'Return exactly one JSON object and nothing else. Do not use a markdown fence.',
        '',
        'CATALOG',
        ...capabilityLines,
        '',
        `REGIONS: ${regionLines.join(' · ')}`,
        `PRESETS: ${presetLines.join(' · ')}`,
        '',
        'RULES',
        ...ruleLines.map((line) => `- ${line}`),
        '',
        'RESPONSE SHAPE',
        '{"reply":"one or two short sentences","actions":[{"type":"add","moduleId":"I1","region":"right"}]}',
        'Allowed action types:',
        '- add {moduleId, region?} — place it; omit region for the module default.',
        '- move {moduleId, region, index?} — move or reorder it.',
        '- remove {moduleId}',
        '- preset {presetId}',
        '- explain {moduleId} — the page opens Details.',
        'Use an empty actions array for a question. Never remove a module the user did not ask to remove.',
        'If the request is ambiguous, ask one short question in reply and return no actions.',
        `Reply with at most ${MAX_REPLY} characters.`,
    ].join('\n');
    const history = (request.history || [])
        .map((entry) => `${entry.role === 'assistant' ? 'Assistant' : 'User'}: ${entry.text}`)
        .join('\n');
    const user = [
        `CURRENT LAYOUT\n${JSON.stringify(layout)}`,
        '',
        `CURRENT ISSUES\n${issues.length ? issues.map((issue) => `- ${issue.message}`).join('\n') : '- none'}`,
        history ? `\nRECENT CONVERSATION\n${history}` : '',
        '',
        `REQUEST\n${request.message}`,
    ].join('\n');
    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

function catalogSummary(catalog = readCatalog()) {
    const map = moduleMap(catalog);
    return {
        schema: catalog.schema,
        version: catalog.version,
        moduleCount: catalog.modules.length,
        domains: catalog.domains,
        regions: catalog.regions,
        core: catalog.core,
        presets: (catalog.presets || []).map((preset) => ({
            id: preset.id,
            label: preset.label,
            moduleCount: Object.values(preset.regions || {}).flat().length,
        })),
        rules: catalog.rules,
        surfaces: catalog.surfaces,
        rendererSurfaces: catalog.rendererSurfaces,
        agent: catalog.agent,
        addOns: catalog.addOns,
        limitations: catalog.limitations,
        modules: catalog.modules.map((module) => ({
            id: module.id,
            name: module.name,
            domain: module.domain,
            region: module.region,
            summary: module.summary,
            requires: module.requires,
            docs: module.docs || [],
        })),
        moduleNames: Object.fromEntries(catalog.modules.map((module) => [module.id, map.get(module.id).name])),
    };
}

/* ------------------------------------------------------------------------- */
/* Start pages and deployment                                                 */
/* ------------------------------------------------------------------------- */

const PAGE_SCHEMA = 'studio-builder/page/1';
const PAGE_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
const DEFAULT_SIZES = { left: 190, right: 190, top: 72, bottom: 96 };
const PAGE_LABELS = {
    'studio-v2.html': 'Studio',
    'studio-v2': 'Studio',
    'agent-first-studio.html': 'Agent-first',
    'studio-agent.html': 'Studio Agent',
    'studio.html': 'Classic',
    'studio-bkup.html': 'Studio backup',
    'studio-import.html': 'Import',
    'asset-studio.html': 'Asset Studio',
    'crawler.html': 'Brand intake',
    'library.html': 'Library',
    'segments.html': 'Segments',
    'voice.html': 'Voice',
    'social.html': 'Social',
    'afs.html': 'AFS',
};
const PAGE_ORDER = [
    'studio-v2.html', 'agent-first-studio.html', 'studio-agent.html', 'studio.html',
    'studio-bkup.html', 'studio-import.html', 'asset-studio.html', 'crawler.html',
    'library.html', 'segments.html', 'voice.html', 'social.html', 'afs.html',
];
const LIVE_KEYS = {
    'api/brand-packs': 'brandPacks',
    'api/fonts': 'fonts',
    'api/animation-library': 'animations',
    'api/segment-library': 'segments',
    'api/assets': 'assets',
    'api/library': 'library',
};

function pageLabel(page) {
    const key = String(page || '').replace(/^\/+/, '');
    if (PAGE_LABELS[key]) return PAGE_LABELS[key];
    return key.replace(/\.html?$/i, '').replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pageSlug(page) {
    return String(page || '')
        .replace(/^\/+/, '')
        .replace(/\.html?$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'page';
}

function surfaceForUrl(catalog, url) {
    const wanted = String(url || '').replace(/^\/+/, '');
    for (const [id, surface] of Object.entries(catalog.surfaces || {})) {
        if (String(surface.url || '').replace(/^\/+/, '') === wanted) return { id, ...surface };
    }
    return null;
}

/**
 * Start pages come from the canonical page list in the catalog, which mirrors
 * the admin navigation. A page can use:
 *   - source:  modules whose source list names that page
 *   - surface: modules mounted by that page's surface
 *   - modules: an explicit list for a page with no module mapping
 *   - classic: the classic preset for the backup page
 * Core and "all pages" modules are always included.
 */
function startPages(catalog = readCatalog()) {
    const map = moduleMap(catalog);
    const definitions = Array.isArray(catalog.pages) && catalog.pages.length ? catalog.pages : [];
    const byPage = new Map();
    const ensure = (page, definition = null) => {
        const source = String(page || '').replace(/^\/+/, '');
        if (!byPage.has(source)) {
            byPage.set(source, {
                source,
                id: definition?.id || `page-${pageSlug(source)}`,
                label: definition?.label || pageLabel(source),
                url: definition?.url || `/${source}`,
                surface: definition?.surface || null,
                layout: definition?.layout || 'source',
                definition,
                sourceIds: new Set(),
                surfaceIds: new Set(),
            });
        }
        return byPage.get(source);
    };
    for (const definition of definitions) {
        if (!definition || !definition.source) continue;
        ensure(definition.source, definition);
    }
    for (const module of catalog.modules) {
        for (const source of module.sources || []) {
            if (!/\.html?$/i.test(source)) continue;
            if (/^all pages?$/i.test(source)) continue;
            if (definitions.length && !byPage.has(String(source).replace(/^\/+/, ''))) continue;
            ensure(source).sourceIds.add(module.id);
        }
    }
    for (const [surfaceId, surface] of Object.entries(catalog.surfaces || {})) {
        const source = String(surface?.url || '').replace(/^\/+/, '');
        if (!source) continue;
        if (definitions.length && !byPage.has(source)) continue;
        const entry = ensure(source);
        if (!entry.surface) entry.surface = surfaceId;
        for (const id of surface.modules || []) if (map.has(id)) entry.surfaceIds.add(id);
    }
    const always = catalog.modules
        .filter((module) => (module.sources || []).some((source) => /^all pages?$/i.test(source)))
        .map((module) => module.id);
    const core = Array.isArray(catalog.core) ? catalog.core : [];
    const classic = (catalog.presets || []).find((preset) => preset.id === 'classic');
    const pages = [];
    for (const entry of byPage.values()) {
        const definition = entry.definition || {};
        let ids;
        if (definition.layout === 'classic' && classic?.regions) {
            ids = placedIds(normaliseLayout(classic.regions, catalog));
        } else if (definition.layout === 'modules' && Array.isArray(definition.modules)) {
            ids = definition.modules;
        } else if (definition.layout === 'surface' && entry.surface && catalog.surfaces[entry.surface]) {
            ids = [...new Set([...(catalog.surfaces[entry.surface].modules || []), ...entry.sourceIds])];
        } else {
            ids = [...entry.sourceIds];
        }
        if (!ids.length && entry.surfaceIds.size) ids = [...entry.surfaceIds];
        const finalSet = new Set([...core, ...always, ...ids].filter((id) => map.has(id)));
        // A start page should not open with a missing requirement (the Import
        // page, for example, has a timeline but no source-level Motion editor).
        let changed = true;
        while (changed) {
            changed = false;
            for (const id of [...finalSet]) {
                for (const dependency of map.get(id)?.requires || []) {
                    if (!finalSet.has(dependency) && map.has(dependency)) {
                        finalSet.add(dependency);
                        changed = true;
                    }
                }
            }
        }
        const finalIds = [...finalSet];
        const regions = Object.fromEntries(catalog.regions.map((region) => [region.id, []]));
        for (const id of finalIds) {
            const module = map.get(id);
            const region = regions[module.region] ? module.region : 'runtime';
            if (!regions[region].includes(id)) regions[region].push(id);
        }
        const surface = entry.surface || surfaceForUrl(catalog, entry.url)?.id || null;
        const surfaceDefinition = surface ? catalog.surfaces[surface] : null;
        pages.push({
            id: entry.id,
            source: entry.source,
            label: definition.label || surfaceDefinition?.label || entry.label,
            url: definition.url || entry.url,
            surface,
            layout: definition.layout || entry.layout,
            moduleCount: finalIds.length,
            modules: finalIds,
            regions,
        });
    }
    if (definitions.length) {
        const order = new Map(definitions.map((definition, index) => [definition.source, index]));
        return pages.sort((a, b) => (order.get(a.source) ?? 99) - (order.get(b.source) ?? 99));
    }
    const rank = (page) => {
        const index = PAGE_ORDER.indexOf(page.source);
        return index === -1 ? PAGE_ORDER.length + 1 : index;
    };
    return pages.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

function cleanLabel(value, fallback = 'Studio page') {
    const label = String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, 80);
    return label || fallback;
}

function normaliseSizes(value) {
    const source = value && typeof value === 'object' ? value : {};
    const read = (key) => {
        const number = Number(source[key]);
        return Number.isFinite(number) ? number : DEFAULT_SIZES[key];
    };
    return {
        left: Math.min(420, Math.max(110, Math.round(read('left')))),
        right: Math.min(420, Math.max(110, Math.round(read('right')))),
        top: Math.min(260, Math.max(52, Math.round(read('top')))),
        bottom: Math.min(280, Math.max(52, Math.round(read('bottom')))),
    };
}

function cleanText(value, max = 300) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * A project-plan entry is a picked screen element: where it is, which page it
 * came from and which capability the user assigned to it. The browser owns the
 * picking UI; this validation keeps the deployed plan safe and small.
 */
function normalisePlan(value, catalog, pages) {
    const map = moduleMap(catalog);
    const bySource = new Map((pages || []).map((page) => [page.source, page]));
    const out = [];
    for (const raw of Array.isArray(value) ? value.slice(0, MAX_PLAN) : []) {
        if (!raw || typeof raw !== 'object') continue;
        const capabilityId = String(raw.capabilityId || '');
        const module = map.get(capabilityId);
        const page = bySource.get(String(raw.pageSource || ''));
        if (!module || !page) continue;
        const rectSource = raw.rect && typeof raw.rect === 'object' ? raw.rect : {};
        const read = (key, max) => {
            const number = Number(rectSource[key]);
            return Number.isFinite(number) ? Math.max(0, Math.min(max, Math.round(number))) : 0;
        };
        const elementSource = raw.element && typeof raw.element === 'object' ? raw.element : {};
        out.push({
            id: (String(raw.id || '').match(/^[A-Za-z0-9_-]{1,80}$/) ? String(raw.id) : `pick-${out.length + 1}`),
            capabilityId,
            capabilityName: module.name,
            pageSource: page.source,
            pageLabel: page.label,
            pageUrl: page.url,
            rect: {
                x: read('x', 20000),
                y: read('y', 20000),
                width: read('width', 10000),
                height: read('height', 10000),
            },
            element: {
                tag: cleanText(elementSource.tag, 40),
                id: cleanText(elementSource.id, 120),
                classes: cleanText(elementSource.classes, 300),
                role: cleanText(elementSource.role, 80),
                label: cleanText(elementSource.label, 200),
                text: cleanText(elementSource.text, 400),
                selector: cleanText(elementSource.selector, 600),
            },
            pickedAt: cleanText(raw.pickedAt, 40) || null,
        });
    }
    return out;
}

function normaliseDeployRequest(payload, catalog = readCatalog()) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const layout = normaliseLayout(source.layout, catalog);
    const placed = placedIds(layout);
    const pages = startPages(catalog);
    const plan = normalisePlan(source.plan, catalog, pages);
    if (!placed.length && !plan.length) throw fail('Add at least one capability or pick at least one building block before deploying.', 400);
    const pageByUrl = new Map(pages.map((page) => [page.url, page]));
    const requested = String(source.basePage || '').trim();
    const requestedPage = pageByUrl.get(requested)
        || pages.find((page) => page.source === requested.replace(/^\/+/, ''))
        || null;
    const stageRenderer = (layout.stage || []).find((id) => catalog.rendererSurfaces[id])
        || placed.find((id) => catalog.rendererSurfaces[id])
        || null;
    const stageSurfaceId = stageRenderer ? catalog.rendererSurfaces[stageRenderer] : null;
    const stageSurface = stageSurfaceId ? catalog.surfaces[stageSurfaceId] : null;
    const allowedBase = /^\/[A-Za-z0-9._-]+\.html?$/i;
    let basePage = requestedPage?.url || (stageSurface?.url || '/studio-v2.html');
    if (!allowedBase.test(basePage)) basePage = '/studio-v2.html';
    const base = pageByUrl.get(basePage) || {
        source: basePage.replace(/^\/+/, ''),
        label: pageLabel(basePage.replace(/^\/+/, '')),
        url: basePage,
        surface: stageSurfaceId,
    };
    // The chosen base page owns the stage surface. Only when a page has no
    // surface metadata do we fall back to the renderer's surface.
    const surfaceId = base.surface || stageSurfaceId || null;
    const surface = surfaceId ? catalog.surfaces[surfaceId] : null;
    const surfaceUrl = surface?.url && allowedBase.test(String(surface.url)) ? surface.url : basePage;
    return {
        schema: PAGE_SCHEMA,
        name: cleanLabel(source.name),
        description: String(source.description || '').trim().slice(0, 300),
        layout,
        sizes: normaliseSizes(source.sizes),
        preview: source.preview !== false,
        basePage,
        baseLabel: base.label,
        baseSource: base.source,
        surfaceId: surfaceId || null,
        surfaceUrl,
        surfaceLabel: surface?.label || pageLabel(surfaceUrl.replace(/^\/+/, '')),
        surfaceQuery: surface?.query || '',
        plan,
    };
}

function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
}

function safeJson(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function liveKeyForModule(module) {
    for (const endpoint of module.endpoints || []) {
        for (const [prefix, key] of Object.entries(LIVE_KEYS)) {
            if (endpoint.startsWith(prefix)) return key;
        }
    }
    if (module.id === 'C4' || module.id === 'G2' || module.id === 'F4') return 'library';
    return null;
}

function moduleTile(module, basePage) {
    if (!module) return '';
    const live = liveKeyForModule(module);
    return `<a class="dp-tile" href="${escapeHtml(basePage)}" data-module="${escapeHtml(module.id)}">`
        + `<span class="dp-tile-id">${escapeHtml(module.id)}</span>`
        + `<b>${escapeHtml(module.name)}</b>`
        + `<small>${escapeHtml(module.summary)}</small>`
        + (live ? `<em class="dp-live" data-live-for="${escapeHtml(live)}">—</em>` : '')
        + '</a>';
}

/**
 * Generates the deployed page shell. It is a real server page: the stage is an
 * iframe of the selected studio surface, the surrounding regions are the layout
 * the user composed, and deployed.js hydrates the module tiles with live server
 * counts. The full original surface is always one link away.
 */
function renderPlanSection(record) {
    const plan = Array.isArray(record.plan) ? record.plan : [];
    if (!plan.length) return '';
    const groups = new Map();
    for (const entry of plan) {
        if (!groups.has(entry.pageSource)) groups.set(entry.pageSource, []);
        groups.get(entry.pageSource).push(entry);
    }
    const blocks = [...groups.entries()].map(([source, entries]) => {
        const page = entries[0];
        const items = entries.map((entry) => `<article class="dp-plan-item">
            <span class="dp-plan-id">${escapeHtml(entry.capabilityId)}</span>
            <div class="dp-plan-copy">
                <b>${escapeHtml(entry.capabilityName)}</b>
                <small>${escapeHtml(entry.element?.selector || 'element')}${entry.rect ? ` · ${entry.rect.width}×${entry.rect.height} at ${entry.rect.x},${entry.rect.y}` : ''}</small>
                ${entry.element?.text ? `<q>${escapeHtml(entry.element.text)}</q>` : ''}
            </div>
            <a href="${escapeHtml(page.pageUrl)}" target="_blank" rel="noopener">Open page</a>
        </article>`).join('');
        return `<section class="dp-plan-group">
            <h3>${escapeHtml(page.pageLabel)} <span>${escapeHtml(source)}</span></h3>
            <div class="dp-plan-items">${items}</div>
        </section>`;
    }).join('');
    return `<section class="dp-plan" aria-label="Project plan">
        <header><h2>Project plan</h2><span>${plan.length} picked building block${plan.length === 1 ? '' : 's'}</span></header>
        ${blocks}
    </section>`;
}

function renderDeployedPage(record, catalog = readCatalog()) {
    const map = moduleMap(catalog);
    const regionLabel = Object.fromEntries(catalog.regions.map((region) => [region.id, region.label]));
    const surface = record.surfaceId ? catalog.surfaces[record.surfaceId] : null;
    let stageSrc = record.surfaceUrl || record.basePage;
    try {
        const url = new URL(stageSrc, 'http://studio.local');
        if (surface?.query) {
            for (const [key, value] of new URLSearchParams(surface.query)) url.searchParams.set(key, value);
        }
        url.searchParams.set('deployed', record.id);
        stageSrc = `${url.pathname}${url.search}`;
    } catch {
        stageSrc = record.basePage;
    }
    const tiles = (region) => (record.layout[region] || [])
        .map((id) => moduleTile(map.get(id), record.basePage))
        .join('');
    const stageNames = (record.layout.stage || []).map((id) => map.get(id)?.name || id);
    const stage = surface
        ? `<div class="dp-stage-head">
                <span class="dp-stage-label">${escapeHtml(regionLabel.stage || 'Stage')} · ${escapeHtml(stageNames.join(', '))}</span>
                <span class="dp-stage-actions">
                    <button type="button" data-stage-reload>Reload</button>
                    <a href="${escapeHtml(stageSrc)}" target="_blank" rel="noopener">Open full stage</a>
                </span>
            </div>
            <iframe class="dp-stage-frame" src="${escapeHtml(stageSrc)}" title="${escapeHtml(record.name)} live stage" allow="clipboard-read; clipboard-write; fullscreen"></iframe>`
        : `<div class="dp-empty">
                <b>No live surface for this page</b>
                <span>Choose a base page in Studio Builder, then deploy again.</span>
                <a href="${escapeHtml(record.basePage)}" target="_blank" rel="noopener">Open ${escapeHtml(record.baseLabel)}</a>
            </div>`;
    const runtime = (record.layout.runtime || []).map((id) => {
        const module = map.get(id);
        if (!module) return '';
        const live = liveKeyForModule(module);
        return `<span class="dp-runtime-chip">${escapeHtml(module.name)}${live ? `<em class="dp-runtime-live" data-live-for="${escapeHtml(live)}">—</em>` : ''}</span>`;
    }).join('');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${escapeHtml(record.description || `Deployed from Studio Builder: ${record.name}`)}">
<title>${escapeHtml(record.name)} · Studio Builder</title>
<link rel="stylesheet" href="/src/client/studio-builder/deployed.css">
</head>
<body>
<header class="dp-bar">
    <div class="dp-title">
        <span class="dp-kicker">Studio Builder deployment</span>
        <h1>${escapeHtml(record.name)}</h1>
    </div>
    <nav class="dp-actions" aria-label="Deployment links">
        <a href="/studio-builder">Edit layout</a>
        <a href="${escapeHtml(record.basePage)}" target="_blank" rel="noopener">Base page · ${escapeHtml(record.baseLabel)}</a>
        <a href="/api/studio-builder/pages/${escapeHtml(record.id)}">Layout JSON</a>
        <a href="${escapeHtml(stageSrc)}" target="_blank" rel="noopener">Full stage</a>
    </nav>
</header>
<main class="dp-screen" aria-label="${escapeHtml(record.name)} layout">
    <section class="dp-region dp-top" data-region="top">
        <header><h2>${escapeHtml(regionLabel.top || 'Top bar')}</h2><span>${(record.layout.top || []).length}</span></header>
        <div class="dp-tiles">${tiles('top') || '<span class="dp-empty-region">No top-bar capabilities</span>'}</div>
    </section>
    <section class="dp-region dp-left" data-region="left">
        <header><h2>${escapeHtml(regionLabel.left || 'Left panel')}</h2><span>${(record.layout.left || []).length}</span></header>
        <div class="dp-tiles">${tiles('left') || '<span class="dp-empty-region">No left-panel capabilities</span>'}</div>
    </section>
    <section class="dp-region dp-stage" data-region="stage">
        <header><h2>${escapeHtml(regionLabel.stage || 'Stage')}</h2><span>${(record.layout.stage || []).length}</span></header>
        ${stage}
    </section>
    <section class="dp-region dp-right" data-region="right">
        <header><h2>${escapeHtml(regionLabel.right || 'Right panel')}</h2><span>${(record.layout.right || []).length}</span></header>
        <div class="dp-tiles">${tiles('right') || '<span class="dp-empty-region">No right-panel capabilities</span>'}</div>
    </section>
    <section class="dp-region dp-bottom" data-region="bottom">
        <header><h2>${escapeHtml(regionLabel.bottom || 'Bottom dock')}</h2><span>${(record.layout.bottom || []).length}</span></header>
        <div class="dp-tiles">${tiles('bottom') || '<span class="dp-empty-region">No bottom-dock capabilities</span>'}</div>
    </section>
    <section class="dp-runtime" aria-label="Runs behind the screen">
        <span class="dp-runtime-label">${escapeHtml(regionLabel.runtime || 'Runs behind the screen')}</span>
        ${runtime || '<span class="dp-empty-region">No runtime capabilities</span>'}
    </section>
</main>
${renderPlanSection(record)}
<footer class="dp-footer">
    <span data-deployed-at>Deployed ${escapeHtml(record.createdAt)} · ${escapeHtml(record.baseSource)} · ${escapeHtml(record.surfaceLabel || 'no surface')}</span>
    <a href="/studio-builder">Open Studio Builder</a>
</footer>
<script id="studio-page-record" type="application/json">${safeJson(record)}</script>
<script src="/src/client/studio-builder/deployed.js" defer></script>
</body>
</html>
`;
}

module.exports = {
    CATALOG_FILE,
    SCHEMA,
    PAGE_SCHEMA,
    PAGE_ID,
    MAX_ACTIONS,
    MAX_MESSAGE,
    MAX_PLAN,
    readCatalog,
    validateCatalog,
    moduleMap,
    normaliseLayout,
    placedIds,
    findIssues,
    normaliseAgentRequest,
    normaliseAgentResponse,
    normaliseAction,
    applyActions,
    buildAgentMessages,
    catalogSummary,
    resolveModule,
    resolveRegion,
    resolvePreset,
    startPages,
    pageLabel,
    pageSlug,
    normaliseSizes,
    normaliseDeployRequest,
    normalisePlan,
    renderDeployedPage,
    liveKeyForModule,
};
