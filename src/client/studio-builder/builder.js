'use strict';
/**
 * Studio Builder — capability composer for the documented Studio Suite.
 *
 * The capability map is server-owned (`/api/studio-builder/catalog`). The page
 * caches the last good response, composes the layout locally, and embeds the
 * real studio surface selected by the stage renderer for the live preview.
 * Unknown agent requests go through the Agent First proxy with
 * `mode: "studio-builder"`; local module/region rules stay first.
 */
(() => {
    const LS = {
        layout: 'sb.layout.v1',
        theme: 'sb.theme',
        sizes: 'sb.sizes.v1',
        drawers: 'sb.drawers.v1',
        preview: 'sb.preview.v1',
        catalog: 'sb.catalog.v1',
        basePage: 'sb.basePage.v1',
        plan: 'sb.plan.v1',
    };
    const SCHEMA = 'studio-builder/catalog/1';
    const LAYOUT_SCHEMA = 'studio-builder/layout/1';
    const DEFAULT_SIZES = { left: 190, right: 190, top: 72, bottom: 96 };
    const DEFAULT_DRAWERS = { left: 272, right: 340 };
    const PREVIEW_TIMEOUT = 15000;
    const PLAN_SCHEMA = 'studio-builder/plan/1';
    const MAX_PLAN_ENTRIES = 200;
    const QUICK_PROMPTS = [
        'Put the timeline at the bottom',
        'Add guardrails',
        'Swap to the template renderer',
        'Explain narration',
        'What’s missing?',
        'Use the classic studio',
        'Inspect the stage',
        'Deploy this page',
    ];
    const SCRIPT_GLOBALS = {
        'studio-core.js': 'StudioCore',
        'brand-pack.js': 'StudioBrand',
        '_.js': 'LayerStudio',
        'engine.js': 'AssetEngine',
        'categories.js': 'AssetCategories',
        'animation.js': 'AssetStudioAnimation',
        'print.js': 'AssetPrint',
        'studio-v2.js': 'layerStudio',
        'brand-identity.js': 'StudioBrand',
    };
    const REGION_ALIASES = {
        top: ['top', 'header', 'toolbar', 'top bar'],
        left: ['left', 'sidebar', 'side', 'left panel'],
        stage: ['stage', 'center', 'centre', 'middle', 'canvas', 'canvas area'],
        right: ['right', 'right panel', 'inspector'],
        bottom: ['bottom', 'footer', 'dock', 'under', 'bottom dock'],
        runtime: ['behind', 'runtime', 'background', 'behind the screen'],
    };
    const INTENT = {
        add: /\b(add|put|place|move|show|include|use|want|need|swap|replace|bring|set)\b/,
        remove: /\b(remove|delete|drop|take out|hide)\b/,
        explain: /\b(explain|what is|what does|tell me about|details|detail|about|describe)\b/,
        check: /\b(missing|issue|issues|check|valid|validate|problem|wrong|audit|rules?)\b/,
        brief: /\b(brief|handoff|hand off)\b/,
        deploy: /\b(deploy|publish|ship)\b/,
        preview: /\b(preview|live)\b/,
        inspect: /\b(inspect|pick|point|draw|select element|select a region)\b/,
        undo: /\b(undo|revert)\b/,
        redo: /\b(redo)\b/,
        help: /\b(help|what can you do|commands|how do i)\b/,
    };

    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => [...document.querySelectorAll(selector)];
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const unique = (values) => [...new Set(values)];

    function h(tag, props = {}, ...children) {
        const element = document.createElement(tag);
        for (const [key, value] of Object.entries(props || {})) {
            if (value == null || value === false) continue;
            if (key === 'class') element.className = value;
            else if (key === 'dataset' && value && typeof value === 'object') Object.assign(element.dataset, value);
            else if (key.startsWith('on') && typeof value === 'function') element[key] = value;
            else if (key === 'hidden') element.hidden = Boolean(value);
            else if (key === 'value' && 'value' in element) element.value = value;
            else if (value === true) element.setAttribute(key, '');
            else element.setAttribute(key, String(value));
        }
        for (const child of children.flat(Infinity)) {
            if (child == null || child === false) continue;
            element.append(child instanceof Node ? child : document.createTextNode(String(child)));
        }
        return element;
    }

    function readLocal(key) {
        try { return localStorage.getItem(key); } catch { return null; }
    }
    function writeLocal(key, value) {
        try { localStorage.setItem(key, value); } catch { /* private mode */ }
    }
    function readJsonLocal(key) {
        try {
            const raw = readLocal(key);
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    }

    const state = {
        catalog: null,
        source: 'none',
        layout: null,
        sel: null,
        tab: 'agent',
        hist: [],
        future: [],
        chat: [],
        busy: false,
        loading: false,
        fatal: '',
        query: '',
        sizes: { ...DEFAULT_SIZES },
        basePage: '',
        startPage: '',
        plan: { version: 1, updatedAt: null, entries: [] },
        inspect: { active: false, dragging: false, startX: 0, startY: 0, box: null, overlay: null },
        stageMaximized: false,
        pick: null,
        highlight: null,
        deploy: {
            name: '',
            basePage: '',
            busy: false,
            loading: false,
            loaded: false,
            result: null,
            pages: [],
            error: '',
        },
        preview: {
            enabled: true,
            iframe: null,
            observer: null,
            surfaceId: null,
            surface: null,
            status: 'idle',
            detail: '',
            globals: [],
            fit: null,
            timer: 0,
            nonce: Date.now(),
        },
    };
    const drawerPanels = {
        left: { width: DEFAULT_DRAWERS.left, collapsed: false },
        right: { width: DEFAULT_DRAWERS.right, collapsed: false },
    };

    let BY = new Map();
    let MODULES = [];
    let DOMAINS = [];
    let REGIONS = [];
    let REGION_LABEL = {};
    let CORE = [];
    let PRESETS = {};
    let RULES = [];
    let SURFACES = {};
    let RENDERER_SURFACES = {};
    let START_PAGES = [];
    let ADDONS = [];
    let LIMITATIONS = [];

    /* ------------------------------------------------------------------ */
    /* Boot                                                                */
    /* ------------------------------------------------------------------ */

    document.addEventListener('DOMContentLoaded', boot);

    function boot() {
        restoreTheme();
        restoreSizes();
        restoreDrawers();
        restorePreviewPreference();
        restoreBasePage();
        restorePlan();
        state.chat = [{
            role: 'assistant',
            text: 'Drag capabilities from the left onto the screen, or tell me what you want. I flag anything that breaks the documented rules. Unknown requests use the server model when it is configured.',
        }];
        bindChrome();
        const cached = readCatalogCache();
        if (cached) {
            try {
                applyCatalog(cached.data, 'cache');
            } catch (error) {
                console.warn('[studio-builder] cached catalog ignored:', error.message);
            }
        }
        renderAll();
        loadCatalog({ quiet: true });
    }

    function restoreTheme() {
        const saved = readLocal(LS.theme);
        if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
    }

    function restoreSizes() {
        const saved = readJsonLocal(LS.sizes);
        state.sizes = parseSizes(saved);
    }

    function restoreDrawers() {
        const saved = readJsonLocal(LS.drawers);
        const defaults = window.innerWidth <= 1180
            ? { left: 236, right: 310 }
            : DEFAULT_DRAWERS;
        for (const side of ['left', 'right']) {
            const value = saved?.[side];
            drawerPanels[side] = {
                width: clamp(Number(value?.width) || defaults[side], 190, 480),
                collapsed: value?.collapsed === true,
            };
        }
        applyDrawers();
    }

    function saveDrawers() {
        writeLocal(LS.drawers, JSON.stringify(drawerPanels));
    }

    function maxDrawerWidth(side) {
        const app = $('.app');
        if (!app) return 480;
        const other = side === 'left' ? 'right' : 'left';
        const otherWidth = drawerPanels[other].collapsed ? 38 : drawerPanels[other].width;
        const available = app.clientWidth - 24 - 8 - 20 - 320 - otherWidth;
        return Math.max(190, Math.min(480, available));
    }

    function applyDrawers() {
        const root = document.documentElement;
        for (const side of ['left', 'right']) {
            const panel = drawerPanels[side];
            const drawer = $(`.drawer[data-drawer="${side}"]`);
            const toggle = $(`[data-drawer-toggle="${side}"]`);
            const resizer = $(`#drawer${side === 'left' ? 'Left' : 'Right'}Resizer`);
            const label = side === 'left' ? 'capability library' : 'agent and details panel';
            root.style.setProperty(
                `--sb-drawer-${side}`,
                `${panel.collapsed ? 38 : panel.width}px`,
            );
            drawer?.classList.toggle('is-collapsed', panel.collapsed);
            if (toggle) {
                toggle.textContent = side === 'left'
                    ? (panel.collapsed ? '›' : '‹')
                    : (panel.collapsed ? '‹' : '›');
                toggle.setAttribute('aria-expanded', String(!panel.collapsed));
                toggle.setAttribute('aria-label', `${panel.collapsed ? 'Reopen' : 'Collapse'} ${label}`);
                toggle.title = `${panel.collapsed ? 'Reopen' : 'Collapse'} ${label}`;
            }
            if (resizer) {
                resizer.hidden = panel.collapsed;
                resizer.setAttribute('aria-valuemin', '190');
                resizer.setAttribute('aria-valuemax', String(maxDrawerWidth(side)));
                resizer.setAttribute('aria-valuenow', String(Math.round(panel.width)));
            }
        }
    }

    function toggleDrawer(side) {
        drawerPanels[side].collapsed = !drawerPanels[side].collapsed;
        applyDrawers();
        saveDrawers();
    }

    function startDrawerResize(side, event) {
        if (window.innerWidth <= 1000 || drawerPanels[side].collapsed || event.button !== 0) return;
        event.preventDefault();
        const startX = event.clientX;
        const initialWidth = drawerPanels[side].width;
        const direction = side === 'left' ? 1 : -1;
        document.body.classList.add('sb-resizing');
        const onMove = (moveEvent) => {
            drawerPanels[side].width = clamp(
                initialWidth + (moveEvent.clientX - startX) * direction,
                190,
                maxDrawerWidth(side),
            );
            applyDrawers();
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            document.body.classList.remove('sb-resizing');
            saveDrawers();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    }

    function resizeDrawerWithKeyboard(side, event) {
        if (window.innerWidth <= 1000 || drawerPanels[side].collapsed) return;
        const grows = side === 'left' ? event.key === 'ArrowRight' : event.key === 'ArrowLeft';
        const shrinks = side === 'left' ? event.key === 'ArrowLeft' : event.key === 'ArrowRight';
        if (!grows && !shrinks) return;
        const step = event.shiftKey ? 24 : 8;
        drawerPanels[side].width = clamp(
            drawerPanels[side].width + (grows ? step : -step),
            190,
            maxDrawerWidth(side),
        );
        event.preventDefault();
        applyDrawers();
        saveDrawers();
    }

    function restorePreviewPreference() {
        const saved = readLocal(LS.preview);
        if (saved === '0') state.preview.enabled = false;
        if (saved === '1') state.preview.enabled = true;
    }

    function restoreBasePage() {
        const saved = readLocal(LS.basePage);
        if (saved && /^\/[A-Za-z0-9._-]+\.html?$/i.test(saved)) state.basePage = saved;
    }

    function saveBasePage() {
        if (state.basePage) writeLocal(LS.basePage, state.basePage);
        else {
            try { localStorage.removeItem(LS.basePage); } catch { /* private mode */ }
        }
    }

    function restorePlan() {
        const parsed = readJsonLocal(LS.plan);
        if (!parsed || !Array.isArray(parsed.entries)) return;
        state.plan = {
            version: 1,
            updatedAt: parsed.updatedAt || null,
            entries: parsed.entries.slice(0, MAX_PLAN_ENTRIES),
        };
    }

    function savePlan() {
        state.plan.version = 1;
        state.plan.updatedAt = new Date().toISOString();
        try { writeLocal(LS.plan, JSON.stringify(state.plan)); } catch { /* best effort */ }
    }

    function planPage(entry) {
        return START_PAGES.find((page) => page.source === entry.pageSource) || null;
    }

    function currentPage() {
        return START_PAGES.find((page) => page.source === state.startPage) || null;
    }

    function setBasePage(url, { source = '', preview = true } = {}) {
        if (!url || !/^\/[A-Za-z0-9._-]+\.html?$/i.test(url)) return;
        state.basePage = url;
        if (preview) state.startPage = source || url.replace(/^\/+/, '');
        state.deploy.basePage = url;
        saveBasePage();
    }

    function basePageForLayout(layout) {
        const stageRenderer = (layout?.stage || []).find((id) => RENDERER_SURFACES[id])
            || Object.keys(layout || {}).flatMap((region) => layout[region] || []).find((id) => RENDERER_SURFACES[id])
            || null;
        const surface = stageRenderer ? SURFACES[RENDERER_SURFACES[stageRenderer]] : null;
        return surface?.url || '';
    }

    function parseSizes(value) {
        const source = value && typeof value === 'object' ? value : {};
        return {
            left: clamp(Number(source.left) || DEFAULT_SIZES.left, 110, 420),
            right: clamp(Number(source.right) || DEFAULT_SIZES.right, 110, 420),
            top: clamp(Number(source.top) || DEFAULT_SIZES.top, 52, 260),
            bottom: clamp(Number(source.bottom) || DEFAULT_SIZES.bottom, 52, 280),
        };
    }

    function saveSizes() {
        writeLocal(LS.sizes, JSON.stringify(state.sizes));
    }

    function savePreviewPreference() {
        writeLocal(LS.preview, state.preview.enabled ? '1' : '0');
    }

    /* ------------------------------------------------------------------ */
    /* Catalog                                                             */
    /* ------------------------------------------------------------------ */

    async function loadCatalog({ quiet = false } = {}) {
        if (state.loading) return;
        state.loading = true;
        renderStatus();
        try {
            const response = await fetch('/api/studio-builder/catalog', { cache: 'no-store' });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.error || `The catalog endpoint returned ${response.status}.`);
            }
            const data = await response.json();
            applyCatalog(data, 'server');
            writeCatalogCache(data);
            state.fatal = '';
            ensureScreen();
            renderAll();
            if (!quiet) toast('Capability catalog synced from the server');
        } catch (error) {
            state.fatal = error.message || 'The capability catalog could not be loaded.';
            if (!state.catalog) {
                renderAll();
            } else {
                renderAll();
                toast('Using the cached catalog — server sync failed');
            }
        } finally {
            state.loading = false;
            renderStatus();
        }
    }

    function applyCatalog(data, source) {
        if (!data || data.schema !== SCHEMA || !Array.isArray(data.modules) || !data.modules.length) {
            throw new Error('The Studio Builder catalog is not valid.');
        }
        state.catalog = data;
        state.source = source;
        MODULES = data.modules;
        BY = new Map(MODULES.map((module) => [module.id, module]));
        DOMAINS = Array.isArray(data.domains) && data.domains.length
            ? data.domains
            : unique(MODULES.map((module) => module.domain));
        REGIONS = Array.isArray(data.regions) && data.regions.length
            ? data.regions
            : [
                { id: 'top', label: 'Top bar', kind: 'strip' },
                { id: 'left', label: 'Left panel', kind: 'panel' },
                { id: 'stage', label: 'Stage', kind: 'stage' },
                { id: 'right', label: 'Right panel', kind: 'panel' },
                { id: 'bottom', label: 'Bottom dock', kind: 'strip' },
                { id: 'runtime', label: 'Runs behind the screen', kind: 'runtime' },
            ];
        REGION_LABEL = Object.fromEntries(REGIONS.map((region) => [region.id, region.label]));
        CORE = Array.isArray(data.core) ? data.core : [];
        PRESETS = Object.fromEntries((Array.isArray(data.presets) ? data.presets : []).map((preset) => [preset.id, preset]));
        RULES = Array.isArray(data.rules) ? data.rules : [];
        SURFACES = Object.fromEntries(Object.entries(data.surfaces || {}).map(([id, surface]) => [id, { ...surface, id }]));
        RENDERER_SURFACES = data.rendererSurfaces || {};
        START_PAGES = Array.isArray(data.startPages) ? data.startPages : [];
        ADDONS = Array.isArray(data.addOns) ? data.addOns : [];
        LIMITATIONS = Array.isArray(data.limitations) ? data.limitations : [];
        const saved = readSavedLayout();
        const fallback = presetRegions('afs');
        const initial = state.layout || saved || fallback || blankLayout();
        state.layout = normaliseLayout(initial);
        if (state.sel && !placed().includes(state.sel)) state.sel = null;
        state.plan.entries = (Array.isArray(state.plan.entries) ? state.plan.entries : []).filter((entry) => entry && BY.has(entry.capabilityId));
        if (!state.basePage) {
            const fromLayout = basePageForLayout(state.layout);
            const fromPage = START_PAGES.find((page) => page.url === fromLayout);
            if (fromLayout) setBasePage(fromLayout, { source: fromPage?.source || '' });
        } else if (!state.startPage) {
            const restored = START_PAGES.find((page) => page.url === state.basePage);
            if (restored) state.startPage = restored.source;
        }
        renderStartOptions();
        document.title = 'Studio Builder';
    }

    function renderStartOptions() {
        const select = $('#preset');
        if (!select) return;
        const current = select.value;
        const presets = Object.values(PRESETS).map((preset) => h('option', { value: preset.id }, preset.label || preset.id));
        const pages = START_PAGES.map((page) => h('option', {
            value: `page:${page.id}`,
            title: `Start from ${page.source} · ${page.label}`,
        }, `${page.source} — ${page.label}`));
        const groups = [h('option', { value: '' }, 'Start from…')];
        if (presets.length) groups.push(h('optgroup', { label: 'Presets' }, ...presets));
        if (pages.length) groups.push(h('optgroup', { label: 'Pages' }, ...pages));
        select.replaceChildren(...groups);
        if (current && [...select.options].some((option) => option.value === current)) select.value = current;
    }

    function basePageOptions() {
        const options = new Map();
        for (const page of START_PAGES) {
            options.set(page.url, {
                url: page.url,
                source: page.source,
                label: page.label,
                surface: page.surface || null,
            });
        }
        for (const [id, surface] of Object.entries(SURFACES)) {
            if (!surface.url || options.has(surface.url)) continue;
            options.set(surface.url, {
                url: surface.url,
                source: String(surface.url).replace(/^\/+/, ''),
                label: surface.label || id,
                surface: id,
            });
        }
        if (!options.has('/studio-v2.html')) {
            options.set('/studio-v2.html', { url: '/studio-v2.html', source: 'studio-v2.html', label: 'Layer Studio v2', surface: 'layer-studio' });
        }
        return [...options.values()];
    }

    function defaultDeployName() {
        if (state.startPage) {
            const page = START_PAGES.find((entry) => entry.source === state.startPage);
            if (page) return `${page.label} page`;
        }
        const surface = currentSurface();
        return surface ? `${surface.label} page` : 'Studio page';
    }

    function writeCatalogCache(data) {
        try {
            writeLocal(LS.catalog, JSON.stringify({ savedAt: new Date().toISOString(), data }));
        } catch { /* cache is best effort */ }
    }

    function readCatalogCache() {
        const parsed = readJsonLocal(LS.catalog);
        if (!parsed || !parsed.data || parsed.data.schema !== SCHEMA) return null;
        return parsed;
    }

    function normaliseLayout(layout) {
        const source = layout && typeof layout === 'object'
            ? (layout.regions && typeof layout.regions === 'object' ? layout.regions : layout)
            : {};
        const out = {};
        for (const region of REGIONS) {
            const seen = new Set();
            const list = Array.isArray(source[region.id]) ? source[region.id] : [];
            out[region.id] = list
                .map((id) => String(id || ''))
                .filter((id) => {
                    if (!BY.has(id) || seen.has(id)) return false;
                    seen.add(id);
                    return true;
                })
                .slice(0, 80);
        }
        return out;
    }

    function blankLayout() {
        return Object.fromEntries(REGIONS.map((region) => [region.id, region.id === 'runtime' ? [...CORE] : []]));
    }

    function presetRegions(id) {
        const preset = PRESETS[id];
        if (!preset || !preset.regions) return null;
        return normaliseLayout(preset.regions);
    }

    function readSavedLayout() {
        const parsed = readJsonLocal(LS.layout);
        if (!parsed) return null;
        if (parsed.regions && typeof parsed.regions === 'object') return parsed.regions;
        return parsed;
    }

    function saveLayout() {
        try { writeLocal(LS.layout, JSON.stringify(state.layout)); } catch { /* best effort */ }
    }

    function placed() {
        return REGIONS.flatMap((region) => state.layout?.[region.id] || []);
    }

    function where(id) {
        return REGIONS.find((region) => (state.layout?.[region.id] || []).includes(id))?.id || null;
    }

    function moduleName(id) {
        return BY.get(id)?.name || id;
    }

    function place(id, region, index = null, base = null) {
        const next = clone(base || state.layout);
        for (const entry of REGIONS) next[entry.id] = (next[entry.id] || []).filter((value) => value !== id);
        const list = next[region] || (next[region] = []);
        const at = index == null ? list.length : clamp(index, 0, list.length);
        list.splice(at, 0, id);
        return normaliseLayout(next);
    }

    function rm(id, base = null) {
        const next = clone(base || state.layout);
        for (const region of REGIONS) next[region.id] = (next[region.id] || []).filter((value) => value !== id);
        return normaliseLayout(next);
    }

    /**
     * An editor that requires a different renderer cannot survive a renderer
     * swap. Remove only those dependants; unrelated missing models stay visible
     * through the requirements rule.
     */
    function pruneRendererDependents(layout, rendererId) {
        const rendererIds = new Set(Object.keys(RENDERER_SURFACES));
        const placedNow = new Set(REGIONS.flatMap((region) => layout[region.id] || []));
        let next = clone(layout);
        for (const id of placedNow) {
            if (id === rendererId) continue;
            const requiresRenderer = (BY.get(id)?.requires || []).some((dependency) => (
                rendererIds.has(dependency) && dependency !== rendererId && !placedNow.has(dependency)
            ));
            if (requiresRenderer) next = rm(id, next);
        }
        return next;
    }

    function drop(id, region, index) {
        const old = where(id);
        let at = index;
        if (old === region && at != null && (state.layout[region] || []).indexOf(id) < at) at -= 1;
        commit(place(id, region, at), { sel: id });
    }

    /* ------------------------------------------------------------------ */
    /* Rules                                                               */
    /* ------------------------------------------------------------------ */

    function currentIssues() {
        const list = placed();
        const issues = [];
        const seen = new Set();
        const push = (issue) => {
            if (seen.has(issue.key)) return;
            seen.add(issue.key);
            issues.push(issue);
        };
        for (const rule of RULES) {
            if (rule.type === 'at-most-one') {
                const active = (rule.modules || []).filter((id) => list.includes(id));
                if (active.length > 1) {
                    push({
                        key: rule.id + active.join(','),
                        tone: 'danger',
                        text: `${active.map(moduleName).join(', ')} are all renderers on one screen. Their layer schemas differ, so keep one.`,
                        label: `Keep ${moduleName(active[0])}`,
                        apply: () => commit(active.slice(1).reduce((next, id) => rm(id, next), clone(state.layout))),
                    });
                }
            } else if (rule.type === 'not-both') {
                const active = (rule.modules || []).filter((id) => list.includes(id));
                if (active.length === 2) {
                    push({
                        key: rule.id + active.join(','),
                        tone: 'danger',
                        text: `${moduleName(active[0])} and ${moduleName(active[1])} use different models. Pick one.`,
                        label: `Remove ${moduleName(active[1])}`,
                        apply: () => commit(rm(active[1])),
                    });
                }
            } else if (rule.type === 'requires') {
                const core = new Set(CORE);
                const missing = new Map();
                for (const id of list) {
                    for (const dependency of BY.get(id)?.requires || []) {
                        if (list.includes(dependency)) continue;
                        if (!missing.has(dependency)) missing.set(dependency, []);
                        missing.get(dependency).push(id);
                    }
                }
                for (const [dependency, causes] of missing) {
                    const target = BY.get(dependency);
                    if (!target || core.has(dependency)) continue;
                    push({
                        key: rule.id + dependency,
                        tone: 'warn',
                        text: `${target.name} is required by ${causes.map(moduleName).join(', ')}.`,
                        label: `Add ${target.name}`,
                        apply: () => commit(place(dependency, target.region)),
                    });
                }
            } else if (rule.type === 'required') {
                for (const id of rule.modules || []) {
                    if (list.includes(id)) continue;
                    const target = BY.get(id);
                    if (!target) continue;
                    push({
                        key: rule.id + id,
                        tone: 'warn',
                        text: `${target.name} is always loaded in the documented architecture.`,
                        label: 'Add',
                        apply: () => commit(place(id, 'runtime')),
                    });
                }
            }
        }
        return issues;
    }

    function missingRequirements(id) {
        return (BY.get(id)?.requires || []).filter((dependency) => !placed().includes(dependency));
    }

    /* ------------------------------------------------------------------ */
    /* Rendering                                                           */
    /* ------------------------------------------------------------------ */

    function renderAll() {
        if (!state.catalog) {
            renderEmpty();
            return;
        }
        ensureScreen();
        applyStageMode();
        renderStatus();
        renderUndo();
        renderIssues();
        renderRegions();
        renderRuntime();
        renderLibrary();
        renderPane();
    }

    function renderEmpty() {
        const status = $('#catalogStatus');
        if (status) {
            status.dataset.tone = state.fatal ? 'bad' : 'warn';
            status.replaceChildren(
                h('span', { class: 'dot' }),
                document.createTextNode(state.fatal ? 'Catalog unavailable' : 'Loading catalog…'),
            );
            status.title = state.fatal || '';
        }
        const screen = $('#screen');
        if (screen) {
            screen.replaceChildren(h('div', { class: 'empty-state', style: 'grid-column:1/-1;grid-row:1/-1;margin:auto' },
                h('b', {}, state.fatal ? 'The Studio Builder catalog could not be loaded' : 'Loading the capability catalog…'),
                h('p', { class: 'hint' }, state.fatal || 'The page reads the map from the Studio server. Start it with npm start and retry.'),
                state.fatal ? h('button', { class: 'btn', onclick: () => loadCatalog() }, 'Retry') : null,
            ));
        }
        const runtime = $('#runtime');
        if (runtime) runtime.replaceChildren(h('label', {}, 'Runs behind the screen'));
        const lib = $('#lib');
        if (lib) lib.replaceChildren(h('p', { class: 'mu' }, state.fatal || 'Loading capabilities…'));
        const pane = $('#pane');
        if (pane) pane.replaceChildren(h('p', { class: 'mu' }, state.fatal
            ? 'The live catalog is served from /api/studio-builder/catalog. The page can reopen from its local cache when the server is unreachable.'
            : 'Waiting for the capability catalog.'));
        const chips = $('#chips');
        if (chips) chips.replaceChildren();
        const count = $('#count');
        if (count) count.textContent = '';
        renderUndo();
    }

    function renderStatus() {
        const status = $('#catalogStatus');
        if (!status) return;
        const refresh = $('#refresh');
        if (refresh) refresh.disabled = state.loading;
        if (!state.catalog) {
            status.dataset.tone = state.fatal ? 'bad' : 'warn';
            status.replaceChildren(
                h('span', { class: 'dot' }),
                document.createTextNode(state.loading ? 'Syncing catalog…' : (state.fatal ? 'Catalog unavailable' : 'Waiting for catalog')),
            );
            status.title = state.fatal || '';
            return;
        }
        const live = state.catalog.live || {};
        const bits = [`${MODULES.length} modules`];
        if (live.brandPacks?.count != null) bits.push(`${live.brandPacks.count} brand pack${live.brandPacks.count === 1 ? '' : 's'}`);
        if (live.fonts?.count != null) bits.push(`${live.fonts.count} fonts`);
        if (live.animations?.count != null) bits.push(`${live.animations.count} animations`);
        const prefix = state.source === 'server' ? 'Server catalog' : 'Cached catalog';
        status.dataset.tone = state.source === 'server' ? 'good' : 'warn';
        status.replaceChildren(h('span', { class: 'dot' }), document.createTextNode(`${prefix} · ${bits.join(' · ')}`));
        status.title = state.source === 'server'
            ? `Served by /api/studio-builder/catalog${live.generatedAt ? ` at ${prettyTime(live.generatedAt)}` : ''}`
            : 'Showing the last catalog cached in this browser. Press Sync to fetch the server copy.';
    }

    function renderUndo() {
        const undo = $('#undo');
        if (undo) undo.disabled = !state.hist.length;
        const redo = $('#redo');
        if (redo) redo.disabled = !state.future.length;
    }

    function renderIssues() {
        const host = $('#issues');
        if (!host) return;
        host.replaceChildren();
        for (const issue of currentIssues()) {
            host.append(h('div', { class: 'issue', 'data-tone': issue.tone },
                h('span', {}, issue.text),
                h('button', { type: 'button', onclick: issue.apply }, issue.label),
            ));
        }
    }

    function ensureScreen() {
        const screen = $('#screen');
        if (!screen) return;
        const signature = REGIONS.map((region) => region.id).join(',');
        if (screen.dataset.signature === signature && screen.querySelector('.reg')) {
            applySizes();
            return;
        }
        buildScreenSkeleton(screen, signature);
    }

    function buildScreenSkeleton(screen, signature) {
        screen.dataset.signature = signature;
        screen.replaceChildren();
        for (const region of REGIONS) {
            if (region.id === 'runtime') continue;
            const reg = h('div', {
                class: `reg ${region.id}${region.kind === 'strip' ? ' row' : ''}`,
                'data-reg': region.id,
                style: `grid-area:${region.id}`,
                role: 'region',
                'aria-label': region.label,
            }, h('label', { title: region.hint || region.label }, region.label));
            if (region.id === 'stage') {
                reg.append(h('div', { class: 'stage-preview', hidden: true }), h('div', { class: 'reg-body stage-body' }));
            } else {
                reg.append(h('div', { class: 'reg-body' }));
            }
            wireRegion(reg, region.id);
            screen.append(reg);
        }
        for (const edge of ['left', 'right', 'top', 'bottom']) {
            const handle = h('div', {
                class: 'resizer',
                'data-edge': edge,
                role: 'separator',
                tabindex: '0',
                'aria-orientation': edge === 'left' || edge === 'right' ? 'vertical' : 'horizontal',
                'aria-label': `Resize ${edge === 'top' || edge === 'bottom' ? 'the ' + edge + ' region' : 'the ' + edge + ' panel'}`,
            });
            handle.addEventListener('pointerdown', (event) => startResize(edge, event));
            handle.addEventListener('keydown', (event) => resizeWithKeyboard(edge, event));
            screen.append(handle);
        }
        applySizes();
    }

    function applySizes() {
        const screen = $('#screen');
        if (!screen) return;
        screen.style.setProperty('--sb-left', `${state.sizes.left}px`);
        screen.style.setProperty('--sb-right', `${state.sizes.right}px`);
        screen.style.setProperty('--sb-top', `${state.sizes.top}px`);
        screen.style.setProperty('--sb-bottom', `${state.sizes.bottom}px`);
    }

    function renderRegions() {
        for (const region of REGIONS) {
            if (region.id === 'runtime') continue;
            const el = $(`#screen .reg[data-reg="${region.id}"]`);
            if (!el) continue;
            if (region.id === 'stage') {
                renderStage(el);
                continue;
            }
            const body = el.querySelector('.reg-body');
            if (!body) continue;
            body.replaceChildren();
            const list = state.layout?.[region.id] || [];
            if (!list.length) {
                body.append(h('div', { class: 'empty' }, region.kind === 'strip' ? 'Drop a capability here' : 'Drop a capability here'));
            } else {
                list.forEach((id) => body.append(block(id)));
            }
            wireRegion(el, region.id);
        }
    }

    function renderStage(el) {
        const previewHost = el.querySelector('.stage-preview');
        const body = el.querySelector('.reg-body');
        const surface = currentSurface();
        const active = Boolean(state.preview.enabled && surface && previewHost && body);
        el.classList.toggle('previewing', active);
        body.className = 'reg-body stage-body';
        body.replaceChildren();
        if (active) {
            previewHost.hidden = false;
            syncPreview(previewHost, surface);
            body.classList.add('chips-row');
            const list = state.layout?.stage || [];
            if (!list.length) body.append(h('div', { class: 'empty' }, 'Drag a stage capability here'));
            list.forEach((id) => body.append(block(id, true)));
        } else {
            if (previewHost) {
                previewHost.hidden = true;
                teardownPreview();
            }
            const list = state.layout?.stage || [];
            if (!list.length) {
                body.append(h('div', { class: 'empty' }, state.preview.enabled
                    ? 'Add a renderer (Scene, Brand template or Agent-first) to load a real surface in the stage.'
                    : 'Drop a capability here'));
            } else {
                list.forEach((id) => body.append(block(id)));
            }
        }
        wireRegion(el, 'stage');
    }

    function renderRuntime() {
        const runtime = $('#runtime');
        if (!runtime) return;
        runtime.replaceChildren(h('label', {}, REGION_LABEL.runtime || 'Runs behind the screen'));
        const list = state.layout?.runtime || [];
        if (!list.length) runtime.append(h('span', { class: 'mu' }, 'Core modules stay loaded here.'));
        list.forEach((id) => runtime.append(block(id, true)));
        wireRegion(runtime, 'runtime');
    }

    function block(id, chip = false) {
        const module = BY.get(id);
        if (!module) return h('span');
        const isRenderer = Boolean(RENDERER_SURFACES[id]);
        const element = h('div', {
            class: `blk${chip ? ' chip' : ''}`,
            draggable: 'true',
            'data-id': id,
            role: 'option',
            tabindex: '0',
            'aria-selected': String(state.sel === id),
            title: module.summary,
        },
            h('div', {},
                h('b', {}, module.name),
                h('small', {}, module.summary, isRenderer ? h('span', { class: 'module-live' }, ' · live surface') : null),
            ),
            h('button', {
                class: 'x',
                type: 'button',
                'aria-label': `Remove ${module.name}`,
                onclick: (event) => {
                    event.stopPropagation();
                    if (state.sel === id) state.sel = null;
                    commit(rm(id));
                },
            }, '×'),
        );
        element.onclick = () => selectModule(id);
        element.onkeydown = (event) => {
            if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                if (state.sel === id) state.sel = null;
                commit(rm(id));
            } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectModule(id);
            }
        };
        element.ondragstart = (event) => {
            event.dataTransfer.setData('text/plain', id);
            event.dataTransfer.effectAllowed = 'move';
            element.classList.add('ghost');
        };
        element.ondragend = () => element.classList.remove('ghost');
        return element;
    }

    function wireRegion(el, region) {
        el.ondragover = (event) => {
            if (!event.dataTransfer || ![...event.dataTransfer.types].includes('text/plain')) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            el.classList.add('over');
        };
        el.ondragleave = (event) => {
            if (!event.relatedTarget || !el.contains(event.relatedTarget)) el.classList.remove('over');
        };
        el.ondrop = (event) => {
            event.preventDefault();
            el.classList.remove('over');
            const id = event.dataTransfer.getData('text/plain');
            if (!BY.has(id)) return;
            const horizontal = region === 'top' || region === 'bottom' || region === 'runtime';
            const blocks = [...el.querySelectorAll('.blk')];
            let index = state.layout?.[region]?.length || 0;
            for (let i = 0; i < blocks.length; i += 1) {
                const rect = blocks[i].getBoundingClientRect();
                const middle = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
                if ((horizontal ? event.clientX : event.clientY) < middle) {
                    index = i;
                    break;
                }
            }
            drop(id, region, index);
        };
    }

    function renderLibrary() {
        const lib = $('#lib');
        if (!lib) return;
        if (!state.catalog) return;
        lib.replaceChildren();
        const query = state.query.trim().toLowerCase();
        let shown = 0;
        for (const domain of DOMAINS) {
            const modules = MODULES.filter((module) => module.domain === domain && (
                !query || `${module.name} ${module.summary} ${module.keywords || ''} ${(module.aliases || []).join(' ')}`.toLowerCase().includes(query)
            ));
            if (!modules.length) continue;
            shown += modules.length;
            lib.append(h('div', { class: 'dom' }, domain));
            for (const module of modules) {
                const used = placed().includes(module.id);
                const item = h('div', {
                    class: `item${used ? ' used' : ''}`,
                    draggable: 'true',
                    title: `${module.name} → ${REGION_LABEL[module.region] || module.region}`,
                },
                    h('div', {},
                        h('b', {}, module.name),
                        h('small', {}, module.summary),
                    ),
                    h('button', {
                        class: 'go',
                        type: 'button',
                        'aria-label': `Add ${module.name} to ${REGION_LABEL[module.region] || module.region}`,
                        title: used ? `Already placed in ${REGION_LABEL[where(module.id)] || 'the screen'}` : `Add to ${REGION_LABEL[module.region] || module.region}`,
                        onclick: (event) => {
                            event.stopPropagation();
                            if (used) selectModule(module.id);
                            else addModule(module.id);
                        },
                    }, used ? '✓' : '+'),
                );
                item.ondragstart = (event) => {
                    event.dataTransfer.setData('text/plain', module.id);
                    event.dataTransfer.effectAllowed = 'move';
                };
                item.onclick = () => selectModule(module.id);
                lib.append(item);
            }
        }
        if (!shown) lib.append(h('p', { class: 'mu' }, 'No capability matches that search.'));
        const count = $('#count');
        if (count) count.textContent = `${shown} of ${MODULES.length}`;
    }

    function selectModule(id) {
        if (!BY.has(id)) return;
        state.sel = id;
        state.tab = 'detail';
        renderAll();
    }

    function addModule(id, region = null) {
        const module = BY.get(id);
        if (!module) return;
        if (placed().includes(id)) {
            state.sel = id;
            state.tab = 'detail';
            renderAll();
            return;
        }
        commit(place(id, region || module.region), { sel: id });
        const missing = missingRequirements(id);
        toast(`${module.name} → ${REGION_LABEL[region || module.region] || region || module.region}${missing.length ? ` · needs ${missing.map(moduleName).join(', ')}` : ''}`);
    }

    function moveModule(id, region) {
        if (!BY.has(id) || !REGION_LABEL[region]) return;
        commit(place(id, region), { sel: id });
        toast(`${moduleName(id)} moved to ${REGION_LABEL[region]}`);
    }

    function removeModule(id) {
        if (!BY.has(id)) return;
        if (state.sel === id) state.sel = null;
        commit(rm(id));
        toast(`${moduleName(id)} removed`);
    }

    function applyPreset(id) {
        const regions = presetRegions(id);
        if (!regions) return;
        resetPicking();
        const base = basePageForLayout(regions);
        if (base) {
            setBasePage(base);
        } else {
            state.startPage = '';
            state.basePage = '';
            state.deploy.basePage = '';
            saveBasePage();
        }
        state.sel = null;
        commit(regions);
        toast(`Loaded the ${PRESETS[id]?.label || id} preset`);
    }

    function startFromPage(pageId) {
        const page = START_PAGES.find((entry) => entry.id === pageId || entry.url === pageId || entry.source === pageId);
        if (!page || !page.regions) {
            toast('That start page is not in the catalog yet');
            return;
        }
        resetPicking();
        setBasePage(page.url, { source: page.source });
        setStageMaximized(true);
        state.sel = null;
        commit(normaliseLayout(page.regions));
        toast(`Started from ${page.source}${page.surface ? ` · ${page.label}` : ''}`);
    }

    function commit(next, options = {}) {
        const normalized = normaliseLayout(next);
        const before = JSON.stringify(state.layout);
        const after = JSON.stringify(normalized);
        if (before !== after) {
            state.hist.push(before);
            if (state.hist.length > 60) state.hist.shift();
            state.future.length = 0;
            state.layout = normalized;
            if (options.sel !== undefined) state.sel = options.sel;
            else if (state.sel && !placed().includes(state.sel)) state.sel = null;
            if (options.tab) state.tab = options.tab;
            saveLayout();
            renderAll();
            return;
        }
        if (options.sel !== undefined) state.sel = options.sel;
        if (options.tab) state.tab = options.tab;
        renderAll();
    }

    function undo() {
        if (!state.hist.length) return;
        state.future.push(JSON.stringify(state.layout));
        state.layout = normaliseLayout(JSON.parse(state.hist.pop()));
        if (state.sel && !placed().includes(state.sel)) state.sel = null;
        saveLayout();
        renderAll();
    }

    function redo() {
        if (!state.future.length) return;
        state.hist.push(JSON.stringify(state.layout));
        state.layout = normaliseLayout(JSON.parse(state.future.pop()));
        if (state.sel && !placed().includes(state.sel)) state.sel = null;
        saveLayout();
        renderAll();
    }

    /* ------------------------------------------------------------------ */
    /* Live preview                                                        */
    /* ------------------------------------------------------------------ */

    function currentSurface() {
        // A page start is authoritative: it shows that page's real surface even
        // when the composed layout has no renderer (Asset Studio, Library, …).
        const page = START_PAGES.find((entry) => entry.source === state.startPage);
        if (page?.surface && SURFACES[page.surface]) {
            return { ...SURFACES[page.surface], page: page.source, renderer: null };
        }
        const stageRenderer = (state.layout?.stage || []).find((id) => RENDERER_SURFACES[id]);
        const anyRenderer = placed().find((id) => RENDERER_SURFACES[id]);
        const renderer = stageRenderer || anyRenderer;
        if (!renderer) return null;
        const surface = SURFACES[RENDERER_SURFACES[renderer]];
        return surface ? { ...surface, renderer } : null;
    }

    function surfaceForModule(id) {
        const page = START_PAGES.find((entry) => entry.source === state.startPage);
        if (page?.surface && (SURFACES[page.surface]?.modules || []).includes(id)) return SURFACES[page.surface];
        return Object.values(SURFACES).find((surface) => (surface.modules || []).includes(id)) || null;
    }

    function previewUrl(surface) {
        const url = new URL(surface.url, location.origin);
        const params = new URLSearchParams(surface.query || '');
        params.set('builderPreview', '1');
        if (surface.id === 'asset-agent') {
            const brand = state.catalog?.live?.brandPacks?.firstBrand;
            if (brand) {
                params.set('pack', brand.packId);
                params.set('brand', brand.brandId);
            }
        }
        params.set('_sb', String(state.preview.nonce));
        url.search = params.toString();
        return url.href;
    }

    function syncPreview(host, surface) {
        let head = host.querySelector('.preview-head');
        let frame = host.querySelector('.preview-frame');
        let scripts = host.querySelector('.preview-scripts');
        if (!head || !frame || !scripts) {
            head = h('div', { class: 'preview-head' });
            frame = h('div', { class: 'preview-frame' });
            scripts = h('div', { class: 'preview-scripts' });
            host.replaceChildren(head, frame, scripts);
        }
        if (state.preview.surfaceId !== surface.id || !state.preview.iframe) setupPreview(surface, frame);
        renderPreviewHead(head, scripts, surface);
        ensureInspectOverlay(frame);
        requestAnimationFrame(fitPreviewFrame);
    }

    function setupPreview(surface, frame) {
        clearPreviewTimer();
        if (state.preview.observer) {
            state.preview.observer.disconnect();
            state.preview.observer = null;
        }
        state.preview.surfaceId = surface.id;
        state.preview.surface = surface;
        state.preview.status = 'loading';
        state.preview.detail = `Loading ${surface.label}…`;
        state.preview.globals = [];
        state.preview.fit = null;
        removeHighlight();
        const iframe = h('iframe', {
            title: `Live preview: ${surface.label}`,
            src: previewUrl(surface),
            loading: 'eager',
            allow: 'clipboard-read; clipboard-write; fullscreen',
        });
        iframe.addEventListener('load', () => {
            setTimeout(inspectPreview, 250);
        });
        iframe.addEventListener('error', () => previewFailure(`${surface.label} could not be loaded.`));
        frame.replaceChildren(iframe);
        state.preview.iframe = iframe;
        if (typeof ResizeObserver === 'function') {
            state.preview.observer = new ResizeObserver(() => fitPreviewFrame());
            state.preview.observer.observe(frame);
        }
        state.preview.timer = window.setTimeout(() => {
            if (state.preview.status === 'loading') {
                previewFailure(`${surface.label} is taking longer than ${Math.round(PREVIEW_TIMEOUT / 1000)}s. Open it in a new tab to inspect it.`);
            }
        }, PREVIEW_TIMEOUT);
    }

    function clearPreviewTimer() {
        if (state.preview.timer) window.clearTimeout(state.preview.timer);
        state.preview.timer = 0;
    }

    function teardownPreview() {
        clearPreviewTimer();
        if (state.preview.observer) {
            state.preview.observer.disconnect();
            state.preview.observer = null;
        }
        if (state.preview.iframe) {
            state.preview.iframe.remove();
            state.preview.iframe = null;
        }
        state.preview.surfaceId = null;
        state.preview.surface = null;
        state.preview.status = 'idle';
        state.preview.detail = '';
        state.preview.globals = [];
        state.preview.fit = null;
        state.inspect.active = false;
        state.inspect.dragging = false;
        removeInspectOverlay();
        removeHighlight();
    }

    function inspectPreview() {
        const iframe = state.preview.iframe;
        if (!iframe || !iframe.isConnected) return;
        let win;
        let doc;
        try {
            win = iframe.contentWindow;
            doc = win?.document;
        } catch (error) {
            previewFailure('The preview is cross-origin and cannot be inspected.');
            return;
        }
        if (!win || !doc) {
            previewFailure('The preview did not expose a document.');
            return;
        }
        const bodyText = String(doc.body?.textContent || '').slice(0, 400);
        if (!doc.body || /File not found\.?/i.test(bodyText)) {
            previewFailure('The surface returned “File not found”. Check the server route.');
            return;
        }
        // Agent First opens on an empty canvas. Its diagnostic seam lets the
        // builder select a real ready design so the preview shows actual work.
        let selectedDesign = '';
        if ((state.preview.surface?.id === 'agent-first-canvas' || state.preview.surface?.id === 'agent-first-studio') && win.__agentFirstQA?.select) {
            const design = state.catalog?.live?.library?.firstDesign;
            if (design?.id) {
                try {
                    if (win.__agentFirstQA.select(design.id)) selectedDesign = design.name || design.id;
                } catch { /* the seam is optional */ }
            }
        }
        const globals = [];
        const checks = ['StudioCore', 'StudioBrand', 'LayerStudio', 'layerStudio', 'AssetEngine', 'AssetCategories', 'AssetPrint', 'AssetStudioAnimation'];
        for (const name of checks) {
            try {
                if (win[name]) globals.push(name);
            } catch { /* ignore individual access failures */ }
        }
        const canvases = doc.querySelectorAll('canvas').length;
        state.preview.globals = globals;
        state.preview.status = 'ready';
        state.preview.detail = `${globals.length
            ? `Real modules loaded: ${globals.join(', ')}`
            : 'Real page loaded'}${canvases ? ` · ${canvases} canvas${canvases === 1 ? '' : 'es'}` : ''}${selectedDesign ? ` · ${selectedDesign}` : ''}`;
        clearPreviewTimer();
        renderRegions();
        renderHighlight();
    }

    function previewFailure(message) {
        state.preview.status = 'error';
        state.preview.detail = message;
        clearPreviewTimer();
        renderRegions();
    }

    function renderPreviewHead(head, scripts, surface) {
        head.replaceChildren(
            h('b', {}, surface.label),
            h('span', { class: 'preview-badge', 'data-tone': previewTone() }, previewStatusLabel()),
            h('span', { class: 'grow' }),
            h('button', { class: 'mini', type: 'button', title: 'Return to layout blocks', onclick: () => setPreview(false) }, 'Layout'),
            h('button', { class: 'mini', type: 'button', title: 'Reload the real surface', onclick: () => reloadPreview() }, 'Reload'),
            h('button', {
                class: 'mini',
                type: 'button',
                'aria-pressed': String(state.inspect.active),
                title: 'Click or drag on the stage to pick an element',
                onclick: () => toggleInspect(),
            }, state.inspect.active ? 'Inspecting…' : 'Inspect'),
            h('button', { class: 'mini', type: 'button', title: 'Open the real page in a new tab', onclick: () => window.open(previewUrl(surface), '_blank', 'noopener') }, 'Open'),
            h('button', {
                class: 'mini',
                type: 'button',
                'data-stage-expand': '',
                'aria-pressed': String(state.stageMaximized),
                title: state.stageMaximized ? 'Restore the Builder layout' : 'Maximize the stage and keep the Agent panel open',
                onclick: () => setStageMaximized(!state.stageMaximized),
            }, state.stageMaximized ? 'Restore' : 'Expand'),
        );
        scripts.replaceChildren();
        const scriptNames = Array.isArray(surface.scripts) ? surface.scripts : [];
        if (!scriptNames.length) {
            scripts.append(h('span', { class: state.preview.status === 'ready' ? 'ok' : 'wait' }, state.preview.status === 'ready'
                ? 'Self-contained page · real designs and animations loaded from the server'
                : 'Loading the real page…'));
            if (state.preview.detail) {
                scripts.append(h('span', { class: state.preview.status === 'error' ? 'missing' : 'wait' }, state.preview.detail));
            }
            return;
        }
        for (const script of scriptNames) {
            const base = script.split('/').pop();
            const global = SCRIPT_GLOBALS[base];
            const loaded = state.preview.status === 'ready' && (!global || state.preview.globals.includes(global));
            const tone = state.preview.status === 'loading' ? 'wait' : (loaded ? 'ok' : 'missing');
            scripts.append(h('span', { class: tone }, `${loaded ? '✓' : (state.preview.status === 'loading' ? '…' : '✗')} ${base}`));
        }
        if (state.preview.detail) scripts.append(h('span', { class: state.preview.status === 'error' ? 'missing' : 'wait' }, state.preview.detail));
    }

    function previewTone() {
        if (state.preview.status === 'ready') return 'good';
        if (state.preview.status === 'error') return 'bad';
        return 'warn';
    }

    function previewStatusLabel() {
        if (state.preview.status === 'ready') return 'real modules';
        if (state.preview.status === 'error') return 'preview error';
        if (state.preview.status === 'loading') return 'loading';
        return 'not loaded';
    }

    function fitPreviewFrame() {
        const iframe = state.preview.iframe;
        const frame = iframe?.parentElement;
        if (!iframe || !frame) return;
        const rect = frame.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const scale = Math.max(0.08, Math.min(rect.width / 1440, rect.height / 900));
        const left = Math.max(0, (rect.width - 1440 * scale) / 2);
        const top = Math.max(0, (rect.height - 900 * scale) / 2);
        iframe.style.transform = `scale(${scale})`;
        iframe.style.left = `${left}px`;
        iframe.style.top = `${top}px`;
        state.preview.fit = { scale, left, top };
        positionInspectOverlay();
        renderHighlight();
    }

    function reloadPreview() {
        state.preview.nonce = Date.now();
        teardownPreview();
        renderRegions();
    }

    function setPreview(enabled) {
        state.preview.enabled = Boolean(enabled);
        if (!state.preview.enabled) {
            state.inspect.active = false;
            teardownPreview();
        }
        savePreviewPreference();
        const toggle = $('#liveToggle');
        if (toggle) toggle.setAttribute('aria-pressed', String(state.preview.enabled));
        renderAll();
        if (state.preview.enabled && !currentSurface()) toast('Add a renderer to the stage to load a live surface');
    }

    /* ------------------------------------------------------------------ */
    /* Stage picking and the project plan                                  */
    /* ------------------------------------------------------------------ */

    const DOM_HINTS = [
        { re: /timeline|playhead|keyframe|scrub|\.tl\b/i, ids: ['D4', 'D3'] },
        { re: /agent|assistant|chat|context/i, ids: ['E1'] },
        { re: /guardrail|validation|safe.?zone|overflow|contrast/i, ids: ['I1'] },
        { re: /export|download|print|pdf|video/i, ids: ['G1'] },
        { re: /asset|library|photo|logo|image|upload/i, ids: ['F1', 'F2'] },
        { re: /menu|dish|catalog/i, ids: ['F2'] },
        { re: /segment|clip|motion.?library/i, ids: ['F3'] },
        { re: /design|template|variation|look/i, ids: ['F4', 'D2', 'C2'] },
        { re: /narrat|audio|voice|music|speech|tts/i, ids: ['H1', 'H2'] },
        { re: /motion|animation|preset|bake/i, ids: ['D3', 'B3'] },
        { re: /canvas|stage|preview|render/i, ids: ['C1', 'C2', 'C4'] },
        { re: /layer|composition|inspector/i, ids: ['D1', 'D3', 'B1'] },
        { re: /model|provider|ollama|deepseek/i, ids: ['E3'] },
        { re: /brand|palette|colour|color|font/i, ids: ['A2'] },
    ];
    const SCORE_STOP = new Set(['agent', 'model', 'page', 'pages', 'the', 'and', 'for', 'with', 'all', 'core', 'chat']);

    function cssPath(element) {
        if (!element || element.nodeType !== 1) return '';
        const parts = [];
        let cursor = element;
        while (cursor && cursor.nodeType === 1 && parts.length < 6) {
            let part = cursor.tagName.toLowerCase();
            if (cursor.id) {
                part += `#${CSS.escape(cursor.id)}`;
                parts.unshift(part);
                break;
            }
            const classes = [...cursor.classList].slice(0, 2).map((name) => `.${CSS.escape(name)}`).join('');
            if (classes) part += classes;
            const parent = cursor.parentElement;
            if (parent) {
                const siblings = [...parent.children].filter((child) => child.tagName === cursor.tagName);
                if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(cursor) + 1})`;
            }
            parts.unshift(part);
            cursor = parent;
        }
        return parts.join(' > ');
    }

    function describeElement(element) {
        if (!element || element.nodeType !== 1) return null;
        const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220);
        return {
            tag: element.tagName.toLowerCase(),
            id: element.id || '',
            classes: [...element.classList].slice(0, 8).join(' '),
            role: element.getAttribute('role') || '',
            label: element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('alt') || element.getAttribute('name') || '',
            text,
            selector: cssPath(element),
        };
    }

    function defaultPageCapability(page) {
        const ids = page?.modules || [];
        const renderer = ids.find((id) => RENDERER_SURFACES[id]);
        if (renderer && BY.get(renderer)) return BY.get(renderer);
        const left = ids.find((id) => BY.get(id)?.region === 'left');
        if (left && BY.get(left)) return BY.get(left);
        const first = ids.find((id) => !CORE.includes(id));
        return BY.get(first || ids[0]) || BY.get('F1');
    }

    function capabilityCandidates(element, page, rect = null) {
        const chain = [];
        let cursor = element;
        for (let depth = 0; cursor && depth < 5; depth += 1) {
            chain.push([
                cursor.tagName,
                cursor.id,
                typeof cursor.className === 'string' ? cursor.className : '',
                cursor.getAttribute?.('aria-label') || '',
                String(cursor.textContent || '').slice(0, 140),
            ].join(' '));
            if (cursor === cursor.ownerDocument?.body) break;
            cursor = cursor.parentElement;
        }
        const haystack = chain.join(' ').toLowerCase();
        const baseIds = page?.modules || [];
        const baseSet = new Set(baseIds);
        const viewportWidth = element.ownerDocument?.documentElement?.clientWidth || 1440;
        const viewportHeight = element.ownerDocument?.documentElement?.clientHeight || 900;
        const box = element.getBoundingClientRect?.();
        const regionRatio = rect
            ? Math.min(1, (rect.width * rect.height) / (viewportWidth * viewportHeight))
            : 0;
        const areaRatio = Math.max(regionRatio, box ? Math.min(1, (box.width * box.height) / (viewportWidth * viewportHeight)) : 0);
        const inStage = element.tagName === 'CANVAS'
            || Boolean(element.closest?.('#stage, .preview-panel, .layer-stage, [class*="canvas"]'));
        const defaultModule = defaultPageCapability(page);
        const scored = MODULES.map((module) => {
            let score = 0;
            if (haystack.includes(module.name.toLowerCase())) score += 8;
            for (const alias of module.aliases || []) {
                if (alias && haystack.includes(alias.toLowerCase())) score += 5;
            }
            for (const word of `${module.name} ${module.keywords || ''}`.toLowerCase().split(/\s+/)) {
                if (word.length <= 2 || SCORE_STOP.has(word)) continue;
                if (new RegExp(`\\b${escapeRegex(word)}s?\\b`).test(haystack)) score += 1;
            }
            for (const hint of DOM_HINTS) {
                if (hint.ids.includes(module.id) && hint.re.test(haystack)) score += 7;
            }
            if (baseSet.has(module.id)) score += 3;
            if (RENDERER_SURFACES[module.id] && inStage) {
                score += areaRatio > 0.24 ? 30 : 12;
            }
            return { module, score };
        }).filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score || baseIds.indexOf(a.module.id) - baseIds.indexOf(b.module.id));
        const suggestions = scored.slice(0, 4).map((entry) => entry.module);
        if (defaultModule && (!suggestions.length || scored[0]?.score <= 3)) {
            const without = suggestions.filter((module) => module.id !== defaultModule.id);
            suggestions.splice(0, suggestions.length, defaultModule, ...without);
        }
        if (!suggestions.length) {
            for (const id of baseIds.slice(0, 3)) {
                const module = BY.get(id);
                if (module) suggestions.push(module);
            }
        }
        if (!suggestions.length && BY.get('F1')) suggestions.push(BY.get('F1'));
        return suggestions.slice(0, 4);
    }

    function removeInspectOverlay() {
        const overlay = state.inspect.overlay || state.preview.iframe?.parentElement?.querySelector('.stage-inspect');
        if (overlay) overlay.remove();
        state.inspect.overlay = null;
        state.inspect.box = null;
    }

    function ensureInspectOverlay(frame) {
        if (!frame) return;
        if (!state.inspect.active) {
            removeInspectOverlay();
            return;
        }
        let overlay = frame.querySelector('.stage-inspect');
        if (!overlay) {
            overlay = h('div', { class: 'stage-inspect', role: 'application', 'aria-label': 'Stage picker' },
                h('div', { class: 'inspect-hint' }, 'Click an element, or drag a region'));
            overlay.addEventListener('pointerdown', startInspect);
            frame.append(overlay);
        }
        state.inspect.overlay = overlay;
        positionInspectOverlay();
    }

    function positionInspectOverlay() {
        const overlay = state.inspect.overlay;
        const fit = state.preview.fit;
        if (!overlay || !fit) return;
        overlay.style.left = `${fit.left}px`;
        overlay.style.top = `${fit.top}px`;
        overlay.style.width = `${1440 * fit.scale}px`;
        overlay.style.height = `${900 * fit.scale}px`;
    }

    function toggleInspect(force) {
        const next = typeof force === 'boolean' ? force : !state.inspect.active;
        if (next && (!state.preview.iframe || !state.preview.fit || state.preview.status !== 'ready')) {
            toast('Load the live preview before inspecting it');
            return;
        }
        state.inspect.active = next;
        state.inspect.dragging = false;
        if (next) {
            state.pick = null;
            state.highlight = null;
            removeHighlight();
        } else {
            removeInspectOverlay();
        }
        renderAll();
        if (next) toast('Inspect: click an element or drag a region');
    }

    function startInspect(event) {
        if (!state.inspect.active) return;
        event.preventDefault();
        event.stopPropagation();
        const overlay = state.inspect.overlay;
        if (!overlay) return;
        const rect = overlay.getBoundingClientRect();
        const x = clamp(event.clientX - rect.left, 0, rect.width);
        const y = clamp(event.clientY - rect.top, 0, rect.height);
        state.inspect.dragging = true;
        state.inspect.startX = x;
        state.inspect.startY = y;
        let box = overlay.querySelector('.inspect-box');
        if (!box) {
            box = h('div', { class: 'inspect-box' });
            overlay.append(box);
        }
        state.inspect.box = box;
        box.hidden = false;
        box.style.left = `${x}px`;
        box.style.top = `${y}px`;
        box.style.width = '0px';
        box.style.height = '0px';
        try { overlay.setPointerCapture(event.pointerId); } catch { /* optional */ }
        window.addEventListener('pointermove', moveInspect);
        window.addEventListener('pointerup', endInspect, { once: true });
        window.addEventListener('pointercancel', endInspect, { once: true });
    }

    function moveInspect(event) {
        if (!state.inspect.dragging) return;
        const overlay = state.inspect.overlay;
        const box = state.inspect.box;
        if (!overlay || !box) return;
        const rect = overlay.getBoundingClientRect();
        const x = clamp(event.clientX - rect.left, 0, rect.width);
        const y = clamp(event.clientY - rect.top, 0, rect.height);
        box.style.left = `${Math.min(state.inspect.startX, x)}px`;
        box.style.top = `${Math.min(state.inspect.startY, y)}px`;
        box.style.width = `${Math.abs(x - state.inspect.startX)}px`;
        box.style.height = `${Math.abs(y - state.inspect.startY)}px`;
    }

    function endInspect(event) {
        if (!state.inspect.dragging) return;
        state.inspect.dragging = false;
        window.removeEventListener('pointermove', moveInspect);
        window.removeEventListener('pointerup', endInspect);
        window.removeEventListener('pointercancel', endInspect);
        const overlay = state.inspect.overlay;
        if (!overlay) return;
        const rect = overlay.getBoundingClientRect();
        const endX = clamp(event.clientX - rect.left, 0, rect.width);
        const endY = clamp(event.clientY - rect.top, 0, rect.height);
        const fit = state.preview.fit;
        if (!fit) return;
        let width = Math.abs(endX - state.inspect.startX);
        let height = Math.abs(endY - state.inspect.startY);
        let x = Math.min(state.inspect.startX, endX);
        let y = Math.min(state.inspect.startY, endY);
        if (width < 6 && height < 6) {
            width = 1;
            height = 1;
            x = state.inspect.startX;
            y = state.inspect.startY;
        }
        if (state.inspect.box) {
            state.inspect.box.hidden = true;
            state.inspect.box.remove();
            state.inspect.box = null;
        }
        pickAt({
            x: x / fit.scale,
            y: y / fit.scale,
            width: width / fit.scale,
            height: height / fit.scale,
        });
    }

    function pickAt(rect) {
        const iframe = state.preview.iframe;
        if (!iframe) return;
        let doc;
        try { doc = iframe.contentWindow?.document; } catch { return; }
        if (!doc) return;
        const viewportWidth = doc.documentElement?.clientWidth || 1440;
        const viewportHeight = doc.documentElement?.clientHeight || 900;
        const x = clamp(rect.x, 0, viewportWidth - 1);
        const y = clamp(rect.y, 0, viewportHeight - 1);
        const width = clamp(rect.width, 1, viewportWidth - x);
        const height = clamp(rect.height, 1, viewportHeight - y);
        const element = doc.elementFromPoint(x + width / 2, y + height / 2) || doc.body;
        if (!element) return;
        const page = currentPage();
        const candidates = capabilityCandidates(element, page, { x, y, width, height });
        state.pick = {
            id: `pick-${Date.now()}`,
            pageSource: page?.source || '',
            pageLabel: page?.label || 'Current surface',
            pageUrl: page?.url || state.basePage || '',
            pageViewport: { width: viewportWidth, height: viewportHeight },
            rect: {
                x: Math.round(x),
                y: Math.round(y),
                width: Math.round(width),
                height: Math.round(height),
            },
            element: describeElement(element),
            candidates: candidates.map((module) => ({ id: module.id, name: module.name, summary: module.summary })),
            capabilityId: candidates[0]?.id || null,
            pickedAt: new Date().toISOString(),
        };
        state.inspect.active = false;
        state.tab = 'plan';
        state.highlight = null;
        removeInspectOverlay();
        renderAll();
        toast(`Picked ${state.pick.element?.selector || 'an element'} — choose a capability`);
    }

    function removeHighlight() {
        const frame = state.preview.iframe?.parentElement;
        if (frame) frame.querySelector('.preview-highlight')?.remove();
    }

    function renderHighlight() {
        const frame = state.preview.iframe?.parentElement;
        const fit = state.preview.fit;
        const highlight = state.highlight || (state.pick ? {
            id: state.pick.id,
            rect: state.pick.rect,
            capabilityId: state.pick.capabilityId || '',
            capabilityName: BY.get(state.pick.capabilityId)?.name || '',
        } : null);
        if (!frame || !fit || !highlight || !state.preview.iframe) {
            removeHighlight();
            return;
        }
        let element = frame.querySelector('.preview-highlight');
        if (!element) {
            element = h('div', { class: 'preview-highlight' });
            frame.append(element);
        }
        const rect = highlight.rect || { x: 0, y: 0, width: 0, height: 0 };
        element.style.left = `${fit.left + rect.x * fit.scale}px`;
        element.style.top = `${fit.top + rect.y * fit.scale}px`;
        element.style.width = `${Math.max(2, rect.width * fit.scale)}px`;
        element.style.height = `${Math.max(2, rect.height * fit.scale)}px`;
        element.replaceChildren(h('span', {}, `${highlight.capabilityId} · ${highlight.capabilityName || ''}`));
    }

    function resetPicking() {
        state.pick = null;
        state.highlight = null;
        state.inspect.active = false;
        state.inspect.dragging = false;
        removeInspectOverlay();
        removeHighlight();
    }

    function applyStageMode() {
        $('.app')?.classList.toggle('is-stage-maximized', state.stageMaximized);
        const button = $('[data-stage-expand]');
        if (button) {
            button.textContent = state.stageMaximized ? 'Restore' : 'Expand';
            button.setAttribute('aria-pressed', String(state.stageMaximized));
            button.title = state.stageMaximized
                ? 'Restore the Builder layout'
                : 'Maximize the stage and keep the Agent panel open';
        }
    }

    function setStageMaximized(maximized) {
        state.stageMaximized = Boolean(maximized);
        if (state.stageMaximized) {
            drawerPanels.right.collapsed = false;
            state.tab = 'agent';
        }
        applyDrawers();
        applyStageMode();
        if (state.stageMaximized) renderPane();
        requestAnimationFrame(fitPreviewFrame);
    }

    /* ------------------------------------------------------------------ */
    /* Panels                                                              */
    /* ------------------------------------------------------------------ */

    function startResize(edge, event) {
        event.preventDefault();
        event.stopPropagation();
        const screen = $('#screen');
        if (!screen) return;
        const rect = screen.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const initial = { ...state.sizes };
        const minStage = 170;
        document.body.classList.add('sb-resizing');
        const onMove = (moveEvent) => {
            if (edge === 'left') {
                const max = Math.max(110, rect.width - state.sizes.right - minStage - 36);
                state.sizes.left = clamp(initial.left + moveEvent.clientX - startX, 110, max);
            } else if (edge === 'right') {
                const max = Math.max(110, rect.width - state.sizes.left - minStage - 36);
                state.sizes.right = clamp(initial.right - (moveEvent.clientX - startX), 110, max);
            } else if (edge === 'top') {
                const max = Math.max(52, rect.height - state.sizes.bottom - minStage - 36);
                state.sizes.top = clamp(initial.top + moveEvent.clientY - startY, 52, max);
            } else if (edge === 'bottom') {
                const max = Math.max(52, rect.height - state.sizes.top - minStage - 36);
                state.sizes.bottom = clamp(initial.bottom - (moveEvent.clientY - startY), 52, max);
            }
            applySizes();
            requestAnimationFrame(fitPreviewFrame);
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            document.body.classList.remove('sb-resizing');
            saveSizes();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    }

    function resizeWithKeyboard(edge, event) {
        const step = event.shiftKey ? 24 : 8;
        let changed = false;
        if (edge === 'left' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            state.sizes.left = clamp(state.sizes.left + (event.key === 'ArrowRight' ? step : -step), 110, 420);
            changed = true;
        } else if (edge === 'right' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            state.sizes.right = clamp(state.sizes.right + (event.key === 'ArrowLeft' ? step : -step), 110, 420);
            changed = true;
        } else if (edge === 'top' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            state.sizes.top = clamp(state.sizes.top + (event.key === 'ArrowDown' ? step : -step), 52, 260);
            changed = true;
        } else if (edge === 'bottom' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            state.sizes.bottom = clamp(state.sizes.bottom + (event.key === 'ArrowUp' ? step : -step), 52, 280);
            changed = true;
        }
        if (!changed) return;
        event.preventDefault();
        applySizes();
        saveSizes();
        requestAnimationFrame(fitPreviewFrame);
    }

    function resetPanels() {
        state.sizes = { ...DEFAULT_SIZES };
        saveSizes();
        applySizes();
        requestAnimationFrame(fitPreviewFrame);
        toast('Panel sizes reset');
    }

    /* ------------------------------------------------------------------ */
    /* Agent                                                               */
    /* ------------------------------------------------------------------ */

    function renderPane() {
        const pane = $('#pane');
        if (!pane) return;
        pane.replaceChildren();
        const tools = $('#agentTools');
        if (tools) tools.hidden = state.tab !== 'agent';
        $$('.tab').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.t === state.tab)));
        if (state.tab === 'agent') renderAgent(pane);
        else if (state.tab === 'plan') renderPlan(pane);
        else if (state.tab === 'detail') renderDetails(pane);
        else if (state.tab === 'brief') renderBrief(pane);
        else if (state.tab === 'addons') renderAddOns(pane);
        else if (state.tab === 'deploy') renderDeploy(pane);
    }

    function renderAgent(pane) {
        const log = h('div', { id: 'log' });
        for (const message of state.chat) {
            log.append(h('div', { class: `m${message.role === 'user' ? ' u' : ''}` },
                message.text,
                message.meta ? h('small', {}, message.meta) : null,
            ));
        }
        if (state.busy) log.append(h('div', { class: 'm typing' }, 'Asking the server model…'));
        pane.append(log, h('p', { class: 'hint', style: 'margin:10px 2px 0' },
            'Local rules understand module names, regions and presets. Free-form requests use the Agent First proxy when the server has DeepSeek or Ollama configured.'));
        const chips = $('#chips');
        if (chips) {
            chips.replaceChildren(...QUICK_PROMPTS.map((prompt) => h('button', {
                type: 'button',
                onclick: () => say(prompt),
            }, prompt)));
        }
        pane.scrollTop = pane.scrollHeight;
    }

    function say(raw) {
        const text = String(raw || '').trim();
        if (!text || state.busy) return;
        state.chat.push({ role: 'user', text });
        if (state.chat.length > 40) state.chat.shift();
        state.busy = true;
        state.tab = 'agent';
        renderAll();
        const local = localReply(text);
        if (local != null) {
            state.chat.push({ role: 'assistant', text: local });
            state.busy = false;
            state.tab = 'agent';
            renderAll();
            return;
        }
        askServerModel(text);
    }

    function localReply(text) {
        const lower = text.toLowerCase();
        const preset = presetIntent(lower);
        if (preset) {
            applyPreset(preset);
            return `Switched to the ${PRESETS[preset]?.label || preset} layout.`;
        }
        const module = findModule(lower);
        const region = findRegion(lower);
        if (module && INTENT.remove.test(lower)) {
            removeModule(module.id);
            return `Removed ${module.name}.`;
        }
        if (module && INTENT.explain.test(lower)) {
            selectModule(module.id);
            const target = BY.get(module.id);
            return `${target.name}: ${target.summary}\nSources: ${(target.sources || []).join(', ') || 'none'}${target.endpoints?.length ? `\nEndpoints: ${target.endpoints.join(', ')}` : ''}`;
        }
        if (module && INTENT.add.test(lower)) {
            if (/swap|replace/.test(lower) && (module.domain === 'Renderers' || RENDERER_SURFACES[module.id])) {
                let next = clone(state.layout);
                for (const renderer of Object.keys(RENDERER_SURFACES)) next = rm(renderer, next);
                next = place(module.id, 'stage', null, next);
                next = pruneRendererDependents(next, module.id);
                state.preview.enabled = true;
                savePreviewPreference();
                const swapSurface = SURFACES[RENDERER_SURFACES[module.id]];
                if (swapSurface?.url) setBasePage(swapSurface.url, { source: swapSurface.url.replace(/^\/+/, '') });
                commit(next, { sel: module.id });
                const missing = missingRequirements(module.id);
                return `Swapped to ${module.name} in the stage.${missing.length ? `\nIt also needs ${missing.map(moduleName).join(', ')}. Use the fix button above the screen.` : ''}`;
            }
            const target = region || where(module.id) || module.region;
            const existing = where(module.id);
            if (existing === target && !/move|put|place|swap|replace/.test(lower)) {
                selectModule(module.id);
                return `${module.name} is already in the ${REGION_LABEL[target]}.`;
            }
            commit(place(module.id, target), { sel: module.id });
            const missing = missingRequirements(module.id);
            const verb = existing ? 'Moved' : 'Placed';
            return `${verb} ${module.name} in the ${REGION_LABEL[target]}.${missing.length ? `\nIt also needs ${missing.map(moduleName).join(', ')}. Use the fix button above the screen.` : ''}`;
        }
        if (INTENT.check.test(lower)) {
            const issues = currentIssues();
            return issues.length
                ? `Open issues:\n${issues.map((issue) => `• ${issue.text}`).join('\n')}\nUse the buttons above the screen to fix them.`
                : 'No issues. Renderers, editors and requirements line up.';
        }
        if (INTENT.brief.test(lower)) {
            state.tab = 'brief';
            renderAll();
            return 'The build brief is in the Brief tab. Copy it into your coding agent or download the layout JSON.';
        }
        if (INTENT.deploy.test(lower)) {
            state.tab = 'deploy';
            renderAll();
            return 'The Deploy tab is ready. Check the page name and base page, then press Deploy page. It writes a real /built/<id> page and opens it.';
        }
        if (INTENT.inspect.test(lower)) {
            state.tab = 'plan';
            renderAll();
            toggleInspect(true);
            return 'Inspect mode is on. Click an element in the stage or drag a region, then choose the capability and add it to the project plan.';
        }
        if (INTENT.preview.test(lower) && !module) {
            state.preview.enabled = true;
            savePreviewPreference();
            renderAll();
            return 'Live preview is on. The stage loads the real surface selected by its renderer.';
        }
        if (INTENT.undo.test(lower)) {
            undo();
            return 'Undone.';
        }
        if (INTENT.redo.test(lower)) {
            redo();
            return 'Redone.';
        }
        if (/\b(catalog|capabilit(y|ies)|module list)\b/.test(lower) && /\b(where|from|server|sync|source|update)\b/.test(lower)) {
            const live = state.catalog?.live;
            return `The catalog is served by /api/studio-builder/catalog (${state.source === 'server' ? 'currently synced' : 'last cached copy'}). It contains ${MODULES.length} modules, ${Object.keys(PRESETS).length} presets and live counts for ${live?.brandPacks?.count ?? '?'} brand packs and ${live?.fonts?.count ?? '?'} fonts.`;
        }
        if (INTENT.help.test(lower) || /^what can i (say|do)/.test(lower)) {
            return 'Try: “put the timeline at the bottom”, “add guardrails”, “swap to the template renderer”, “explain narration”, “what’s missing?”, “show the live preview”, “use the classic studio” or “undo”. I can add, move, remove or explain any capability.';
        }
        return null;
    }

    function presetIntent(lower) {
        if (!/\b(use|start|switch|load|open|try|pick)\b/.test(lower)) return null;
        if (/\bclassic\b/.test(lower)) return 'classic';
        if (/\btemplate production\b/.test(lower)) return 'template';
        if (/\bblank\b/.test(lower)) return 'blank';
        if (/\bagent[- ]first\b/.test(lower) || /\bafs\b/.test(lower)) return 'afs';
        return null;
    }

    function findModule(text) {
        let best = null;
        let score = 0;
        const stop = new Set(['agent', 'model', 'page', 'pages', 'the', 'and', 'for', 'with', 'all', 'core', 'chat']);
        for (const module of MODULES) {
            let current = 0;
            const id = module.id.toLowerCase();
            if (new RegExp(`\\b${id}\\b`).test(text)) current += 30;
            if (text.includes(module.name.toLowerCase())) current += 20;
            for (const alias of module.aliases || []) {
                if (!alias || !text.includes(alias.toLowerCase())) continue;
                // A specific phrase ("template renderer") must beat the generic
                // substring inside it ("renderer") when two modules both match.
                current += 10 + Math.min(6, alias.trim().split(/\s+/).length * 2);
            }
            const words = `${module.name} ${module.keywords || ''}`.toLowerCase().split(/\s+/);
            for (const word of words) {
                if (word.length <= 2 || stop.has(word)) continue;
                if (new RegExp(`\\b${escapeRegex(word)}s?\\b`).test(text)) current += 1;
            }
            if (current > score) {
                score = current;
                best = module;
            }
        }
        return score >= 3 ? best : null;
    }

    function findRegion(text) {
        for (const region of REGIONS) {
            if (region.id === 'runtime' && REGION_LABEL[region.id] && text.includes(String(REGION_LABEL[region.id]).toLowerCase())) return region.id;
            for (const alias of REGION_ALIASES[region.id] || [region.id]) {
                if (new RegExp(`\\b${escapeRegex(alias)}\\b`).test(text)) return region.id;
            }
            if (REGION_LABEL[region.id] && text.includes(String(REGION_LABEL[region.id]).toLowerCase())) return region.id;
        }
        return null;
    }

    function escapeRegex(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    async function askServerModel(text) {
        const endpoint = state.catalog?.agent?.endpoint || '/api/agent-first/chat';
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 45000);
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    mode: 'studio-builder',
                    message: text,
                    layout: state.layout,
                    history: state.chat
                        .slice(-9, -1)
                        .filter((message) => message.role === 'user' || message.role === 'assistant')
                        .map((message) => ({ role: message.role, text: message.text })),
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error(payload?.error || `The agent proxy returned ${response.status}.`);
            const actions = Array.isArray(payload?.actions) ? payload.actions : [];
            const applied = applyAgentActions(actions);
            const meta = [payload?.provider, payload?.model].filter(Boolean).join(' · ') || 'server model';
            state.chat.push({
                role: 'assistant',
                text: `${payload?.reply || (applied ? `Applied ${applied} layout change${applied === 1 ? '' : 's'}.` : 'No change.')}`,
                meta: `via ${meta}`,
            });
        } catch (error) {
            const reason = error.name === 'AbortError' ? 'the server did not answer in 45 seconds' : error.message;
            state.chat.push({
                role: 'assistant',
                text: `I could not reach the server model: ${reason}\n\nLocal rules still work. Try “add guardrails”, “put the timeline at the bottom”, “move chat to the left” or “what’s missing?”.`,
            });
        } finally {
            window.clearTimeout(timer);
            state.busy = false;
            state.tab = 'agent';
            renderAll();
        }
    }

    function applyAgentActions(actions) {
        if (!Array.isArray(actions) || !actions.length) return 0;
        let next = clone(state.layout);
        let changed = 0;
        let select = null;
        let tab = null;
        for (const action of actions) {
            if (!action || typeof action !== 'object') continue;
            if (action.type === 'preset' && PRESETS[action.presetId]?.regions) {
                next = normaliseLayout(PRESETS[action.presetId].regions);
                changed += 1;
                continue;
            }
            if (action.type === 'explain' && BY.has(action.moduleId)) {
                select = action.moduleId;
                tab = 'detail';
                continue;
            }
            if (!BY.has(action.moduleId)) continue;
            if (action.type === 'remove') {
                next = rm(action.moduleId, next);
                changed += 1;
            } else if (action.type === 'add' || action.type === 'move') {
                const region = REGION_LABEL[action.region] ? action.region : BY.get(action.moduleId).region;
                next = place(action.moduleId, region, action.index ?? null, next);
                select = action.moduleId;
                changed += 1;
            }
        }
        const stageRenderers = (next.stage || []).filter((id) => RENDERER_SURFACES[id]);
        if (stageRenderers.length === 1) {
            next = pruneRendererDependents(next, stageRenderers[0]);
            const actionSurface = SURFACES[RENDERER_SURFACES[stageRenderers[0]]];
            if (actionSurface?.url && actions.some((action) => action?.type === 'add' || action?.type === 'move')) {
                setBasePage(actionSurface.url, { source: actionSurface.url.replace(/^\/+/, '') });
            }
        }
        if (changed) commit(next, { sel: select ?? state.sel, tab: tab || state.tab });
        else if (select) {
            state.sel = select;
            state.tab = tab || 'detail';
            renderAll();
        }
        return changed;
    }

    /* ------------------------------------------------------------------ */
    /* Details, brief and add-ons                                          */
    /* ------------------------------------------------------------------ */

    function renderDetails(pane) {
        if (!state.sel || !BY.has(state.sel)) {
            pane.append(h('p', { class: 'mu' }, 'Select a block on the screen to see its sources, endpoints and requirements.'));
            const renderers = MODULES.filter((module) => RENDERER_SURFACES[module.id]);
            if (renderers.length) {
                pane.append(h('p', { class: 'hint', style: 'margin-top:14px' }, 'Renderers with a live surface:'));
                pane.append(h('div', { class: 'row-actions' }, ...renderers.map((module) => h('button', {
                    class: 'btn small',
                    type: 'button',
                    onclick: () => selectModule(module.id),
                }, module.name))));
            }
            return;
        }
        const module = BY.get(state.sel);
        const regionSelect = h('select', {
            class: 'in',
            'aria-label': 'Region',
            onchange: (event) => moveModule(module.id, event.target.value),
        }, ...REGIONS.map((region) => {
            const option = h('option', { value: region.id }, region.label);
            if (where(module.id) === region.id) option.selected = true;
            return option;
        }));
        const surface = surfaceForModule(module.id);
        const live = liveForModule(module);
        const requirements = (module.requires || []).map((id) => {
            const target = BY.get(id);
            if (!target) return h('span', { class: 'tag' }, id);
            const missing = !placed().includes(id);
            return h('button', {
                class: 'tag button',
                type: 'button',
                title: missing ? `Add ${target.name}` : `${target.name} is already placed`,
                onclick: () => {
                    if (missing) addModule(id);
                    else selectModule(id);
                },
            }, `${target.name}${missing ? ' +' : ''}`);
        });
        const parts = [
            h('h3', { style: 'margin:2px 0 4px' }, module.name),
            h('p', { class: 'mu', style: 'margin:0' }, module.summary),
            h('dl', {},
                h('dt', {}, 'Placed in'),
                h('dd', {}, regionSelect),
                h('dt', {}, 'Domain / module'),
                h('dd', {}, `${module.domain} · ${module.id}`),
                h('dt', {}, 'Source files'),
                h('dd', {}, ...(module.sources || []).map((source) => h('div', {}, sourceLink(source)))),
                h('dt', {}, 'Endpoints'),
                h('dd', {}, ...(module.endpoints?.length
                    ? module.endpoints.map((endpoint) => h('div', {}, endpointLink(endpoint)))
                    : ['None'])),
                h('dt', {}, 'Requires'),
                h('dd', {}, ...(requirements.length ? requirements : ['Nothing'])),
                h('dt', {}, 'Docs'),
                h('dd', {}, ...((module.docs || []).length
                    ? module.docs.map((doc) => h('div', {}, h('a', { href: `/${doc}`, target: '_blank', rel: 'noopener' }, doc)))
                    : ['None'])),
            ),
            live ? h('div', {},
                h('dt', { style: 'color:var(--mu);margin-top:14px;font-size:12px' }, 'Live server data'),
                h('div', { class: 'stats' }, ...live.map((entry) => h('div', { class: 'stat' },
                    h('b', {}, entry.value),
                    h('span', {}, entry.label),
                ))),
            ) : null,
            h('div', { class: 'row-actions' },
                surface ? h('button', {
                    class: 'btn',
                    type: 'button',
                    onclick: () => {
                        const resolved = typeof surface === 'string' ? SURFACES[surface] : surface;
                        if (resolved) window.open(new URL(resolved.url, location.origin).href, '_blank', 'noopener');
                    },
                }, `Open ${surface.label || 'live surface'}`) : null,
                RENDERER_SURFACES[module.id] ? h('button', {
                    class: 'btn',
                    type: 'button',
                    onclick: () => {
                        state.preview.enabled = true;
                        savePreviewPreference();
                        commit(place(module.id, 'stage'), { sel: module.id });
                    },
                }, 'Preview in stage') : null,
                h('button', {
                    class: 'btn',
                    type: 'button',
                    onclick: () => removeModule(module.id),
                }, 'Remove from screen'),
            ),
        ];
        parts.filter(Boolean).forEach((part) => pane.append(part));
    }

    function sourceLink(source) {
        const value = String(source || '');
        if (!value || /^all pages?$/i.test(value) || !/\.html?$/i.test(value)) return h('code', {}, value);
        if (/^(data|api)\//.test(value)) return h('code', {}, value);
        return h('a', { href: `/${value}`, target: '_blank', rel: 'noopener' }, value);
    }

    function endpointLink(endpoint) {
        const value = String(endpoint || '');
        if (!value) return h('code', {}, 'None');
        if (value.includes(':') || value.startsWith('data/')) return h('code', {}, value);
        return h('a', { href: `/${value.replace(/^\/+/, '')}`, target: '_blank', rel: 'noopener' }, value);
    }

    function liveForModule(module) {
        const live = state.catalog?.live;
        if (!live) return null;
        const endpoints = module.endpoints || [];
        const entries = [];
        if (endpoints.some((endpoint) => endpoint.includes('brand-packs'))) {
            entries.push({ label: `brand pack${live.brandPacks?.count === 1 ? '' : 's'}`, value: live.brandPacks?.count ?? '—' });
        }
        if (endpoints.some((endpoint) => endpoint.includes('fonts'))) {
            entries.push({ label: `font${live.fonts?.count === 1 ? '' : 's'}`, value: live.fonts?.count ?? '—' });
        }
        if (endpoints.some((endpoint) => endpoint.includes('animation'))) {
            entries.push({ label: 'saved animations', value: live.animations?.count ?? '—' });
        }
        if (endpoints.some((endpoint) => endpoint.includes('segment'))) {
            entries.push({ label: 'segment groups', value: live.segments?.counts?.groups ?? '—' });
        }
        if (endpoints.some((endpoint) => endpoint.includes('assets'))) {
            entries.push({ label: 'library assets', value: live.assets?.total ?? '—' });
        }
        if (module.id === 'A2' || module.id === 'F2') {
            entries.push({ label: 'brand packs', value: live.brandPacks?.count ?? '—' });
        }
        if (module.id === 'C4' || module.id === 'G2' || module.id === 'F4') {
            entries.push({ label: 'library designs', value: live.library?.count ?? '—' });
            entries.push({ label: 'ready designs', value: live.library?.ready ?? '—' });
        }
        return entries.length ? entries : null;
    }

    function planModuleOptions(pick) {
        const page = START_PAGES.find((entry) => entry.source === pick.pageSource);
        const pageIds = new Set(page?.modules || []);
        return {
            pageModules: [...pageIds].map((id) => BY.get(id)).filter(Boolean),
            otherModules: MODULES.filter((module) => !pageIds.has(module.id)),
        };
    }

    function renderPickCard() {
        const pick = state.pick;
        const page = START_PAGES.find((entry) => entry.source === pick.pageSource);
        const { pageModules, otherModules } = planModuleOptions(pick);
        const select = h('select', {
            class: 'in',
            id: 'pickCapability',
            'aria-label': 'Capability for this element',
            onchange: (event) => {
                pick.capabilityId = event.target.value;
                renderAll();
            },
        },
            h('optgroup', { label: page ? `On ${page.label}` : 'On this page' }, ...pageModules.map((module) => {
                const option = h('option', { value: module.id }, `${module.id} · ${module.name}`);
                if (pick.capabilityId === module.id) option.selected = true;
                return option;
            })),
            h('optgroup', { label: 'All capabilities' }, ...otherModules.map((module) => {
                const option = h('option', { value: module.id }, `${module.id} · ${module.name}`);
                if (pick.capabilityId === module.id) option.selected = true;
                return option;
            })),
        );
        const selected = BY.get(pick.capabilityId);
        const candidates = pick.candidates.map((candidate) => h('button', {
            class: 'tag button',
            type: 'button',
            'aria-pressed': String(pick.capabilityId === candidate.id),
            title: candidate.summary,
            onclick: () => {
                pick.capabilityId = candidate.id;
                renderAll();
            },
        }, `${candidate.id} ${candidate.name}`));
        return h('div', { class: 'pick-card' },
            h('div', { class: 'pick-head' },
                h('div', {},
                    h('b', {}, 'Picked element'),
                    h('small', {}, `${page?.label || 'Current surface'} · ${pick.rect.width}×${pick.rect.height} at ${pick.rect.x},${pick.rect.y}`),
                ),
                h('button', {
                    class: 'mini',
                    type: 'button',
                    title: 'Discard this pick',
                    onclick: () => { state.pick = null; renderAll(); },
                }, '×'),
            ),
            h('code', { class: 'pick-selector' }, pick.element?.selector || 'element'),
            pick.element?.text ? h('q', { class: 'pick-text' }, pick.element.text) : null,
            h('dl', { class: 'pick-details' },
                h('dt', {}, 'Element'),
                h('dd', {}, `${pick.element?.tag || 'element'}${pick.element?.id ? `#${pick.element.id}` : ''}${pick.element?.classes ? `.${pick.element.classes.split(/\s+/).join('.')}` : ''}`),
                h('dt', {}, 'Capability'),
                h('dd', {}, select),
                h('dt', {}, 'Suggested'),
                h('dd', {}, ...(candidates.length ? candidates : [h('span', { class: 'mu' }, 'No matching suggestion — choose one above')])),
            ),
            h('div', { class: 'row-actions' },
                h('button', {
                    class: 'btn p',
                    type: 'button',
                    disabled: !pick.pageSource || !selected || undefined,
                    onclick: addPickToPlan,
                }, `+ Add ${selected?.name || 'capability'} to project plan`),
                h('button', {
                    class: 'btn small',
                    type: 'button',
                    onclick: () => { state.pick = null; renderAll(); },
                }, 'Cancel'),
            ),
        );
    }

    function planEntryCard(entry) {
        const module = BY.get(entry.capabilityId);
        const page = planPage(entry);
        return h('div', { class: 'plan-item' },
            h('div', { class: 'plan-item-main' },
                h('div', { class: 'plan-item-head' },
                    h('span', { class: 'plan-id' }, entry.capabilityId),
                    h('b', {}, module?.name || entry.capabilityName || entry.capabilityId),
                    h('small', {}, entry.pageLabel || entry.pageSource),
                ),
                h('code', { class: 'plan-selector' }, entry.element?.selector || 'element'),
                h('small', { class: 'plan-location' },
                    `${entry.rect?.width || 0}×${entry.rect?.height || 0} at ${entry.rect?.x || 0},${entry.rect?.y || 0}`,
                    entry.element?.text ? ` · “${entry.element.text}”` : '',
                ),
            ),
            h('div', { class: 'plan-actions' },
                h('button', {
                    class: 'btn small',
                    type: 'button',
                    disabled: !page || undefined,
                    title: page ? `Load ${page.label} and highlight this element` : 'The source page is missing',
                    onclick: () => locatePlanEntry(entry.id),
                }, 'Locate'),
                h('button', {
                    class: 'btn small',
                    type: 'button',
                    title: 'Add this capability to the screen layout',
                    onclick: () => addPlanCapability(entry.capabilityId),
                }, '+ Layout'),
                h('button', {
                    class: 'btn small',
                    type: 'button',
                    title: 'Remove from the project plan',
                    onclick: () => removePlanEntry(entry.id),
                }, 'Remove'),
            ),
        );
    }

    function renderPlan(pane) {
        const entries = state.plan.entries || [];
        const groups = new Map();
        for (const entry of entries) {
            if (!groups.has(entry.pageSource)) {
                groups.set(entry.pageSource, {
                    label: entry.pageLabel || entry.pageSource,
                    url: entry.pageUrl || (entry.pageSource ? `/${entry.pageSource}` : ''),
                    entries: [],
                });
            }
            groups.get(entry.pageSource).entries.push(entry);
        }
        const fileInput = h('input', {
            type: 'file',
            accept: 'application/json,.json',
            hidden: true,
            onchange: (event) => {
                const file = event.target.files?.[0];
                if (file) importPlanFile(file);
                event.target.value = '';
            },
        });
        const parts = [
            h('p', { class: 'mu', style: 'margin:0' }, 'Pick building blocks directly from any start page. The plan keeps the capability, the page, the element selector and the location so the draft survives page changes and can be deployed.'),
            state.pick ? renderPickCard() : null,
            h('div', { class: 'plan-head' },
                h('div', {},
                    h('h3', {}, `Project plan · ${entries.length}`),
                    h('small', { class: 'mu' }, state.plan.updatedAt ? `Updated ${prettyTime(state.plan.updatedAt)}` : 'Nothing picked yet'),
                ),
                h('div', { class: 'plan-toolbar' },
                    h('button', { class: 'btn small', type: 'button', onclick: () => toggleInspect(true) }, 'Inspect stage'),
                    h('button', { class: 'btn small', type: 'button', disabled: !entries.length || undefined, onclick: applyPlanToLayout }, 'Apply to layout'),
                    h('button', { class: 'btn small', type: 'button', disabled: !entries.length || undefined, onclick: deployWithPlan }, 'Deploy plan'),
                    h('button', { class: 'btn small', type: 'button', disabled: !entries.length || undefined, onclick: downloadPlan }, 'Download plan'),
                    h('button', { class: 'btn small', type: 'button', onclick: () => fileInput.click() }, 'Import plan'),
                    h('button', { class: 'btn small', type: 'button', disabled: !entries.length || undefined, onclick: clearPlan }, 'Clear'),
                    fileInput,
                ),
            ),
            h('div', { class: 'plan-list' },
                ...(entries.length
                    ? [...groups.values()].map((group) => h('div', { class: 'plan-group' },
                        h('h3', {},
                            group.label,
                            group.url ? h('a', { href: group.url, target: '_blank', rel: 'noopener' }, 'open') : null,
                        ),
                        ...group.entries.map(planEntryCard),
                    ))
                    : [h('div', { class: 'plan-empty' },
                        h('b', {}, 'No building blocks picked yet'),
                        h('span', {}, 'Choose a start page, press Inspect above the stage, then click an element or drag a region.'),
                        h('button', { class: 'btn small', type: 'button', onclick: () => toggleInspect(true) }, 'Inspect the stage'),
                    )]),
            ),
        ];
        parts.filter(Boolean).forEach((part) => pane.append(part));
    }

    function addPickToPlan() {
        const pick = state.pick;
        const module = pick ? BY.get(pick.capabilityId) : null;
        if (!pick || !module || !pick.pageSource) {
            toast('Pick a page element and a capability first');
            return;
        }
        const entry = {
            id: pick.id,
            capabilityId: module.id,
            capabilityName: module.name,
            pageSource: pick.pageSource,
            pageLabel: pick.pageLabel,
            pageUrl: pick.pageUrl,
            rect: pick.rect,
            element: pick.element,
            pageViewport: pick.pageViewport,
            pickedAt: pick.pickedAt,
        };
        const duplicate = state.plan.entries.findIndex((existing) => (
            existing.capabilityId === entry.capabilityId
            && existing.pageSource === entry.pageSource
            && existing.element?.selector === entry.element?.selector
            && existing.rect?.x === entry.rect?.x
            && existing.rect?.y === entry.rect?.y
        ));
        if (duplicate >= 0) state.plan.entries.splice(duplicate, 1);
        state.plan.entries.unshift(entry);
        state.plan.entries = state.plan.entries.slice(0, MAX_PLAN_ENTRIES);
        savePlan();
        state.pick = null;
        state.highlight = entry;
        state.tab = 'plan';
        renderAll();
        renderHighlight();
        toast(`${module.name} added to the project plan`);
    }

    function addPlanCapability(id) {
        const module = BY.get(id);
        if (!module) return;
        if (placed().includes(id)) {
            state.sel = id;
            state.tab = 'detail';
            renderAll();
            toast(`${module.name} is already on the screen`);
            return;
        }
        commit(place(id, module.region), { sel: id });
        const missing = missingRequirements(id);
        toast(`${module.name} added to the layout${missing.length ? ` · needs ${missing.map(moduleName).join(', ')}` : ''}`);
    }

    function applyPlanToLayout() {
        if (!state.plan.entries.length) {
            toast('The project plan is empty');
            return;
        }
        let next = clone(state.layout);
        const added = [];
        for (const entry of state.plan.entries) {
            const module = BY.get(entry.capabilityId);
            if (!module) continue;
            if (Object.values(next).flat().includes(module.id)) continue;
            next = place(module.id, module.region, null, next);
            added.push(module.id);
        }
        if (!added.length) {
            toast('Every planned capability is already on the screen');
            return;
        }
        commit(next, { sel: added[added.length - 1] });
        const missing = unique(added.flatMap((id) => missingRequirements(id)));
        toast(`${added.length} planned capabilit${added.length === 1 ? 'y' : 'ies'} added${missing.length ? ` · needs ${missing.map(moduleName).join(', ')}` : ''}`);
    }

    function locatePlanEntry(id) {
        const entry = state.plan.entries.find((item) => item.id === id);
        if (!entry) return;
        const page = planPage(entry);
        if (!page) {
            toast('The start page for this pick is no longer in the catalog');
            return;
        }
        if (state.startPage !== page.source) startFromPage(page.id);
        state.pick = null;
        state.highlight = entry;
        state.tab = 'plan';
        renderAll();
        renderHighlight();
        toast(`Located ${entry.capabilityName} on ${entry.pageLabel}`);
    }

    function removePlanEntry(id) {
        const entry = state.plan.entries.find((item) => item.id === id);
        state.plan.entries = state.plan.entries.filter((item) => item.id !== id);
        if (state.highlight?.id === id) {
            state.highlight = null;
            removeHighlight();
        }
        savePlan();
        renderAll();
        toast(entry ? `${entry.capabilityName} removed from the plan` : 'Plan entry removed');
    }

    function clearPlan() {
        if (!state.plan.entries.length) return;
        if (!window.confirm('Clear every picked building block from the project plan?')) return;
        state.plan.entries = [];
        state.highlight = null;
        removeHighlight();
        savePlan();
        renderAll();
        toast('Project plan cleared');
    }

    function downloadPlan() {
        const payload = {
            schema: PLAN_SCHEMA,
            version: 1,
            updatedAt: state.plan.updatedAt,
            entries: state.plan.entries,
        };
        downloadFile('studio-project-plan.json', JSON.stringify(payload, null, 2), 'application/json');
        toast('Project plan downloaded');
    }

    async function importPlanFile(file) {
        try {
            const parsed = JSON.parse(await file.text());
            const entries = Array.isArray(parsed.entries) ? parsed.entries : (Array.isArray(parsed) ? parsed : []);
            const valid = entries
                .filter((entry) => entry && BY.has(entry.capabilityId))
                .slice(0, MAX_PLAN_ENTRIES)
                .map((entry) => ({
                    ...entry,
                    capabilityName: BY.get(entry.capabilityId).name,
                    capabilityId: entry.capabilityId,
                    pageSource: String(entry.pageSource || ''),
                    pageLabel: String(entry.pageLabel || entry.pageSource || ''),
                    pageUrl: String(entry.pageUrl || ''),
                    rect: entry.rect || { x: 0, y: 0, width: 0, height: 0 },
                    element: entry.element || null,
                }));
            if (!valid.length) throw new Error('No known capabilities in that plan.');
            state.plan.entries = valid;
            state.pick = null;
            state.highlight = null;
            removeHighlight();
            savePlan();
            renderAll();
            toast(`Imported ${valid.length} planned capabilit${valid.length === 1 ? 'y' : 'ies'}`);
        } catch (error) {
            toast(`Plan import failed: ${error.message}`);
        }
    }

    function renderBrief(pane) {
        const briefText = buildBrief();
        const fileInput = h('input', {
            type: 'file',
            accept: 'application/json,.json',
            hidden: true,
            onchange: (event) => {
                const file = event.target.files?.[0];
                if (file) importLayoutFile(file);
                event.target.value = '';
            },
        });
        pane.append(
            h('p', { class: 'mu', style: 'margin:0' }, 'Paste this into your coding agent to build the page. The layout JSON and the brief describe the same screen.'),
            h('div', { class: 'row-actions' },
                h('button', { class: 'btn small', type: 'button', onclick: () => copyBrief(briefText) }, 'Copy brief'),
                h('button', { class: 'btn small', type: 'button', onclick: downloadLayout }, 'Download layout'),
                h('button', { class: 'btn small', type: 'button', onclick: () => fileInput.click() }, 'Import layout'),
                fileInput,
            ),
            h('pre', {}, briefText),
        );
    }

    function renderAddOns(pane) {
        const live = state.catalog?.live || {};
        pane.append(
            h('p', { class: 'mu', style: 'margin:0' }, 'What was wired, what is live now, and what still needs a deliberate next step.'),
            h('div', { class: 'stats' },
                stat('Capabilities', MODULES.length),
                stat('Brand packs', live.brandPacks?.count ?? '—'),
                stat('Fonts', live.fonts?.count ?? '—'),
                stat('Animations', live.animations?.count ?? '—'),
                stat('Library assets', live.assets?.total ?? '—'),
                stat('Segment groups', live.segments?.counts?.groups ?? '—'),
                stat('Agent First designs', live.library?.count ?? '—'),
                stat('Ready designs', live.library?.ready ?? '—'),
            ),
            h('p', { class: 'hint', style: 'margin:10px 0 8px' },
                `Catalog: ${state.source === 'server' ? 'server' : 'browser cache'} · preview: ${state.preview.enabled ? (state.preview.status || 'on') : 'off'} · agent: ${state.catalog?.agent?.endpoint || '/api/agent-first/chat'} · deploy: /api/studio-builder/deploy`),
            h('div', { class: 'row-actions', style: 'margin:0 0 12px' },
                h('button', { class: 'btn small', type: 'button', onclick: () => loadCatalog() }, 'Sync catalog'),
                h('button', { class: 'btn small', type: 'button', onclick: () => setPreview(!state.preview.enabled) }, state.preview.enabled ? 'Turn preview off' : 'Turn preview on'),
            ),
        );
        for (const addon of ADDONS) {
            pane.append(h('div', { class: 'addon' },
                h('div', { class: 'top' },
                    h('b', {}, addon.name || addon.id),
                    h('span', { class: `pill${addon.status === 'implemented' ? '' : ' plan'}` }, addon.status || 'planned'),
                ),
                h('p', {}, addon.description || ''),
                addon.usage ? h('p', { class: 'usage' }, addon.usage) : null,
            ));
        }
        if (LIMITATIONS.length) {
            pane.append(h('h3', { style: 'margin:16px 0 6px;font-size:13px' }, 'Still deliberate limits'));
            pane.append(h('ul', { class: 'hint', style: 'margin:0;padding-left:18px' },
                ...LIMITATIONS.map((line) => h('li', { style: 'margin-bottom:4px' }, line)),
            ));
        }
    }

    function renderDeploy(pane) {
        if (!state.deploy.loaded && !state.deploy.loading) loadDeployments();
        if (!state.deploy.basePage) state.deploy.basePage = state.basePage || basePageOptions()[0]?.url || '/studio-v2.html';
        const options = basePageOptions();
        if (!options.some((option) => option.url === state.deploy.basePage)) {
            options.push({ url: state.deploy.basePage, source: state.deploy.basePage.replace(/^\/+/, ''), label: state.deploy.basePage, surface: null });
        }
        const nameInput = h('input', {
            class: 'in',
            id: 'deployName',
            type: 'text',
            value: state.deploy.name,
            placeholder: defaultDeployName(),
            maxlength: '80',
            autocomplete: 'off',
            oninput: (event) => { state.deploy.name = event.target.value; },
        });
        const baseSelect = h('select', {
            class: 'in',
            id: 'deployBase',
            'aria-label': 'Base page',
            onchange: (event) => {
                state.deploy.basePage = event.target.value;
                setBasePage(event.target.value, { preview: false });
                renderPane();
            },
        }, ...options.map((option) => {
            const element = h('option', { value: option.url }, `${option.source} — ${option.label}`);
            if (option.url === state.deploy.basePage) element.selected = true;
            return element;
        }));
        const surface = currentSurface();
        const moduleCount = placed().length;
        const canDeploy = (moduleCount > 0 || state.plan.entries.length > 0) && !state.deploy.busy;
        const parts = [
            h('p', { class: 'mu', style: 'margin:0' }, 'Deploy writes a real page on this server. The stage is the same live surface as the preview; the surrounding regions are the layout you composed, with live counts on each capability tile.'),
            h('div', { class: 'deploy-form' },
                h('div', { class: 'field' }, h('label', { for: 'deployName' }, 'Page name'), nameInput),
                h('div', { class: 'field' },
                    h('label', { for: 'deployBase' }, 'Base page / full surface'),
                    baseSelect,
                    h('span', { class: 'hint' }, 'The page and the “Full stage” link open this documented surface. The composed layout stays in the deploy.'),
                ),
                h('div', { class: 'deploy-summary' },
                    h('div', {}, h('b', {}, String(moduleCount)), h('span', {}, 'capabilities')),
                    h('div', {}, h('b', {}, surface ? surface.label : 'No renderer'), h('span', {}, 'stage surface')),
                    h('div', {}, h('b', {}, state.basePage || '—'), h('span', {}, 'base page')),
                ),
                h('div', { class: 'row-actions' },
                    h('button', {
                        class: 'btn p',
                        type: 'button',
                        disabled: !canDeploy || undefined,
                        onclick: deployCurrentPage,
                    }, state.deploy.busy ? 'Deploying…' : 'Deploy page'),
                    h('button', {
                        class: 'btn small',
                        type: 'button',
                        onclick: () => { state.tab = 'brief'; renderAll(); },
                    }, 'Review brief first'),
                ),
                state.deploy.error ? h('p', { class: 'deploy-error' }, state.deploy.error) : null,
                h('p', { class: 'hint' }, `${state.plan.entries.length} picked building block${state.plan.entries.length === 1 ? '' : 's'} from the project plan will be included in the deployed page.`),
            ),
            state.deploy.result ? h('div', { class: 'deploy-result' },
                h('b', {}, `Deployed: ${state.deploy.result.name}`),
                h('p', { class: 'hint' }, `${state.deploy.result.url} · ${state.deploy.result.moduleCount} capabilities${state.deploy.result.planCount ? ` · ${state.deploy.result.planCount} planned blocks` : ''} · ${state.deploy.result.baseSource}`),
                h('div', { class: 'row-actions' },
                    h('a', { class: 'btn small', href: state.deploy.result.url, target: '_blank', rel: 'noopener' }, 'Open deployed page'),
                    h('a', { class: 'btn small', href: state.deploy.result.surfaceUrl, target: '_blank', rel: 'noopener' }, 'Open full surface'),
                    h('a', { class: 'btn small', href: `/api/studio-builder/pages/${encodeURIComponent(state.deploy.result.id)}`, target: '_blank', rel: 'noopener' }, 'Layout JSON'),
                    h('button', { class: 'btn small', type: 'button', onclick: () => window.open(state.deploy.result.url, '_blank', 'noopener') }, 'Open now'),
                ),
            ) : null,
            h('div', { class: 'deploy-list-head' },
                h('h3', { style: 'margin:16px 0 6px;font-size:13px' }, 'Deployed pages'),
                h('button', { class: 'btn small', type: 'button', onclick: loadDeployments }, state.deploy.loading ? 'Loading…' : 'Refresh'),
            ),
            state.deploy.pages.length
                ? h('div', { class: 'deploy-list' }, ...state.deploy.pages.map(deployedPageRow))
                : h('p', { class: 'hint' }, state.deploy.loading ? 'Reading deployments…' : 'No pages deployed yet.'),
        ];
        parts.filter(Boolean).forEach((part) => pane.append(part));
    }

    function deployedPageRow(page) {
        return h('div', { class: 'deploy-item' },
            h('div', {},
                h('b', {}, page.name),
                h('small', {}, `${page.baseSource} · ${page.moduleCount} capabilities${page.planCount ? ` · ${page.planCount} planned` : ''} · ${prettyTime(page.updatedAt || page.createdAt)}`),
                h('div', { class: 'deploy-links' },
                    h('a', { href: page.url, target: '_blank', rel: 'noopener' }, 'Open'),
                    h('a', { href: page.surfaceUrl, target: '_blank', rel: 'noopener' }, 'Full surface'),
                    h('a', { href: `/api/studio-builder/pages/${encodeURIComponent(page.id)}`, target: '_blank', rel: 'noopener' }, 'JSON'),
                ),
            ),
            h('button', {
                class: 'btn small',
                type: 'button',
                title: 'Delete this deployment',
                onclick: () => deleteDeployment(page.id),
            }, 'Delete'),
        );
    }

    async function loadDeployments() {
        if (state.deploy.loading) return;
        state.deploy.loading = true;
        if (state.tab === 'deploy') renderPane();
        try {
            const response = await fetch('/api/studio-builder/pages', { cache: 'no-store' });
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error(payload?.error || `The deployments endpoint returned ${response.status}.`);
            state.deploy.pages = Array.isArray(payload?.pages) ? payload.pages : [];
            state.deploy.loaded = true;
            state.deploy.error = '';
        } catch (error) {
            state.deploy.error = `Could not list deployed pages: ${error.message}`;
            state.deploy.loaded = true;
        } finally {
            state.deploy.loading = false;
            if (state.tab === 'deploy') renderPane();
        }
    }

    async function deployWithPlan() {
        state.tab = 'deploy';
        renderAll();
        await deployCurrentPage();
    }

    async function deployCurrentPage() {
        if (state.deploy.busy) return;
        if (!placed().length && !state.plan.entries.length) {
            toast('Add a capability or pick a building block before deploying');
            return;
        }
        const name = (state.deploy.name || '').trim() || defaultDeployName();
        const basePage = state.deploy.basePage || state.basePage || basePageOptions()[0]?.url || '/studio-v2.html';
        state.deploy.busy = true;
        state.deploy.error = '';
        renderPane();
        // Open the tab from the click gesture so the deployed page appears as
        // soon as the write finishes instead of being caught by a popup blocker.
        const pendingTab = window.open('about:blank', '_blank');
        if (pendingTab) {
            try {
                pendingTab.document.title = 'Deploying…';
                pendingTab.document.body.innerHTML = '<p style="font-family:system-ui;padding:24px">Deploying the Studio page…</p>';
            } catch { /* cross-origin or closed */ }
        }
        try {
            const response = await fetch('/api/studio-builder/deploy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    basePage,
                    layout: state.layout,
                    sizes: state.sizes,
                    preview: state.preview.enabled,
                    plan: state.plan.entries,
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.page) {
                throw new Error(payload?.error || `The deploy endpoint returned ${response.status}.`);
            }
            state.deploy.result = payload.page;
            state.deploy.name = payload.page.name;
            state.deploy.basePage = payload.page.basePage;
            setBasePage(payload.page.basePage, { source: payload.page.baseSource, preview: false });
            state.deploy.pages = [payload.page, ...state.deploy.pages.filter((page) => page.id !== payload.page.id)];
            state.deploy.loaded = true;
            state.deploy.busy = false;
            renderAll();
            toast(`Deployed to ${payload.page.url}`);
            if (pendingTab && !pendingTab.closed) pendingTab.location.href = payload.page.url;
            else {
                const opened = window.open(payload.page.url, '_blank', 'noopener');
                if (!opened) toast(`Deployed — open ${payload.page.url} from the result card`);
            }
        } catch (error) {
            if (pendingTab && !pendingTab.closed) pendingTab.close();
            state.deploy.error = `Deploy failed: ${error.message}`;
            state.deploy.busy = false;
            renderPane();
        }
    }

    async function deleteDeployment(id) {
        try {
            const response = await fetch(`/api/studio-builder/pages/${encodeURIComponent(id)}`, { method: 'DELETE' });
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error(payload?.error || `The delete endpoint returned ${response.status}.`);
            state.deploy.pages = state.deploy.pages.filter((page) => page.id !== id);
            if (state.deploy.result?.id === id) state.deploy.result = null;
            renderPane();
            toast('Deployment deleted');
        } catch (error) {
            state.deploy.error = `Could not delete: ${error.message}`;
            renderPane();
        }
    }

    function stat(label, value) {
        return h('div', { class: 'stat' }, h('b', {}, value), h('span', {}, label));
    }

    function buildBrief() {
        const lines = [];
        const live = state.catalog?.live;
        lines.push('# Page build brief');
        lines.push('');
        lines.push(`Generated by Studio Builder. Catalog: ${state.source === 'server' ? 'server' : 'browser cache'} · schema ${state.catalog.schema} · v${state.catalog.version}.`);
        if (live?.generatedAt) lines.push(`Live data read at ${prettyTime(live.generatedAt)}: ${live.brandPacks?.count ?? 0} brand packs · ${live.fonts?.count ?? 0} fonts · ${live.animations?.count ?? 0} animations · ${live.assets?.total ?? 0} assets.`);
        lines.push('');
        lines.push('Build one page from the documented Studio Suite modules below. Reuse the named source files; do not rebuild them. The live preview in Studio Builder embeds the real surface, so the same module scripts are available on this server.');
        lines.push('');
        lines.push('## Screen regions');
        for (const region of REGIONS) {
            if (region.id === 'runtime') continue;
            const list = state.layout?.[region.id] || [];
            lines.push(`- ${region.label} (${region.id}, ${state.sizes[region.id] || 'auto'}px): ${list.length ? list.map((id) => `${moduleName(id)} (${id})`).join(', ') : 'empty'}`);
        }
        lines.push('');
        lines.push('## Runs behind the screen');
        lines.push(`- ${(state.layout?.runtime || []).map((id) => `${moduleName(id)} (${id})`).join(', ') || 'none'}`);
        lines.push('');
        lines.push('## Load order');
        let order = 0;
        for (const domain of DOMAINS) {
            const list = placed().filter((id) => BY.get(id)?.domain === domain);
            if (!list.length) continue;
            order += 1;
            lines.push(`${order}. ${list.map(moduleName).join(', ')} (${domain})`);
        }
        lines.push('');
        lines.push('## Sources and endpoints');
        for (const id of placed()) {
            const module = BY.get(id);
            lines.push(`- ${module.name}: ${(module.sources || []).join(', ') || 'none'}${module.endpoints?.length ? ` | ${module.endpoints.join(', ')}` : ''}`);
        }
        lines.push('');
        const surface = currentSurface();
        lines.push('## Live preview');
        lines.push(surface
            ? `${surface.renderer ? `- Stage renderer: ${moduleName(surface.renderer)}` : `- Page surface: ${surface.page || surface.label}`}\n- Surface: ${surface.label} (${surface.url}${surface.query ? `?${surface.query}` : ''})\n- Loads: ${(surface.scripts || []).join(', ') || 'a self-contained page'}`
            : '- No live surface. Pick a start page or add a renderer in the stage.');
        lines.push(`- Base page: ${state.basePage || 'not chosen'} (used by Deploy and the full-surface link)`);
        lines.push('');
        lines.push('## Deployment');
        lines.push('- POST /api/studio-builder/deploy writes a real page and returns its /built/<id> URL.');
        lines.push('- GET /api/studio-builder/pages lists deployments; GET /api/studio-builder/pages/<id> returns the layout and metadata.');
        lines.push('- The deployed page keeps the composed regions, hydrates live counts, and runs the stage surface in an iframe with a full-surface link.');
        lines.push('');
        lines.push('## Rules');
        lines.push('- One renderer only: C1, C2 or C4.');
        lines.push('- Scene editor (D1) and Template editor (D2) are exclusive.');
        lines.push('- Every requirement must be placed (for example Timeline needs Motion editor).');
        lines.push(`- Core modules are always loaded: ${CORE.map(moduleName).join(', ')}.`);
        const issues = currentIssues();
        if (issues.length) {
            lines.push('');
            lines.push('## Open issues');
            for (const issue of issues) lines.push(`- ${issue.text}`);
        }
        lines.push('');
        lines.push('## Project plan');
        if (state.plan.entries.length) {
            for (const entry of state.plan.entries) {
                lines.push(`- ${entry.capabilityId} ${entry.capabilityName || moduleName(entry.capabilityId)} · ${entry.pageLabel || entry.pageSource} · ${entry.element?.selector || 'element'} · ${entry.rect?.width || 0}×${entry.rect?.height || 0} at ${entry.rect?.x || 0},${entry.rect?.y || 0}`);
            }
        } else {
            lines.push('- No picked building blocks yet.');
        }
        lines.push('');
        lines.push('## Agent wiring');
        lines.push(`- Local: module names, region words and presets in the browser.`);
        lines.push(`- Free-form: POST ${state.catalog?.agent?.endpoint || '/api/agent-first/chat'} with { mode: "studio-builder", message, layout, history }. The server validates every action against this catalog.`);
        lines.push('');
        if (ADDONS.length) {
            lines.push('## Add-ons');
            for (const addon of ADDONS) lines.push(`- ${addon.name} (${addon.status || 'planned'}): ${addon.description || ''}`);
        }
        if (LIMITATIONS.length) {
            lines.push('');
            lines.push('## Remaining limits');
            for (const line of LIMITATIONS) lines.push(`- ${line}`);
        }
        return `${lines.join('\n')}\n`;
    }

    async function copyBrief(text = buildBrief()) {
        try {
            await navigator.clipboard.writeText(text);
            toast('Build brief copied');
        } catch {
            state.tab = 'brief';
            renderAll();
            toast('Clipboard blocked — copy from the Brief tab');
        }
    }

    async function importLayoutFile(file) {
        try {
            const parsed = JSON.parse(await file.text());
            const regions = parsed.regions || parsed;
            const normalised = normaliseLayout(regions);
            const count = Object.values(normalised).flat().length;
            if (!count) throw new Error('The file does not contain any known capabilities.');
            if (parsed.sizes) {
                state.sizes = parseSizes(parsed.sizes);
                saveSizes();
                applySizes();
            }
            if (parsed.preview && typeof parsed.preview.enabled === 'boolean') {
                state.preview.enabled = parsed.preview.enabled;
                savePreviewPreference();
            }
            if (typeof parsed.basePage === 'string') setBasePage(parsed.basePage);
            if (Array.isArray(parsed.plan)) {
                state.plan.entries = parsed.plan.filter((entry) => entry && BY.has(entry.capabilityId)).slice(0, MAX_PLAN_ENTRIES);
                savePlan();
            }
            state.sel = null;
            commit(normalised, { sel: null });
            renderAll();
            toast(`Imported ${count} capabilities`);
        } catch (error) {
            toast(`Layout import failed: ${error.message}`);
        }
    }

    function downloadLayout() {
        if (!state.catalog) {
            toast('The catalog is still loading');
            return;
        }
        const surface = currentSurface();
        const payload = {
            schema: LAYOUT_SCHEMA,
            version: 1,
            catalog: {
                schema: state.catalog?.schema,
                version: state.catalog?.version,
                source: state.source,
            },
            savedAt: new Date().toISOString(),
            basePage: state.basePage || null,
            regions: state.layout,
            sizes: state.sizes,
            plan: state.plan.entries,
            preview: { enabled: state.preview.enabled, surface: surface?.id || null },
        };
        downloadFile('studio-layout.json', JSON.stringify(payload, null, 2), 'application/json');
        toast('Layout downloaded');
    }

    function downloadFile(name, text, type) {
        const blob = new Blob([text], { type });
        const url = URL.createObjectURL(blob);
        const anchor = h('a', { href: url, download: name });
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    /* ------------------------------------------------------------------ */
    /* Chrome                                                              */
    /* ------------------------------------------------------------------ */

    function bindChrome() {
        $$('[data-drawer-toggle]').forEach((toggle) => {
            toggle.onclick = () => toggleDrawer(toggle.dataset.drawerToggle);
        });
        for (const side of ['left', 'right']) {
            const resizer = $(`#drawer${side === 'left' ? 'Left' : 'Right'}Resizer`);
            if (!resizer) continue;
            resizer.addEventListener('pointerdown', (event) => startDrawerResize(side, event));
            resizer.addEventListener('keydown', (event) => resizeDrawerWithKeyboard(side, event));
        }
        const query = $('#q');
        if (query) query.oninput = () => {
            state.query = query.value;
            renderLibrary();
        };
        $$('.tab').forEach((tab) => {
            tab.onclick = () => {
                state.tab = tab.dataset.t;
                renderPane();
            };
        });
        const ask = $('#ask');
        if (ask) ask.onsubmit = (event) => {
            event.preventDefault();
            const input = $('#in');
            const value = input?.value.trim();
            if (!value) return;
            if (input) input.value = '';
            say(value);
        };
        const undoButton = $('#undo');
        if (undoButton) undoButton.onclick = undo;
        const redoButton = $('#redo');
        if (redoButton) redoButton.onclick = redo;
        const reset = $('#resetPanels');
        if (reset) reset.onclick = resetPanels;
        const preset = $('#preset');
        if (preset) preset.onchange = () => {
            const value = preset.value;
            if (value.startsWith('page:')) startFromPage(value.slice('page:'.length));
            else if (value) applyPreset(value);
            preset.value = '';
        };
        const copy = $('#copy');
        if (copy) copy.onclick = () => copyBrief();
        const download = $('#dl');
        if (download) download.onclick = downloadLayout;
        const deploy = $('#deploy');
        if (deploy) deploy.onclick = () => {
            state.tab = 'deploy';
            renderAll();
        };
        const theme = $('#theme');
        if (theme) theme.onclick = toggleTheme;
        const live = $('#liveToggle');
        if (live) {
            live.setAttribute('aria-pressed', String(state.preview.enabled));
            live.onclick = () => setPreview(!state.preview.enabled);
        }
        const refresh = $('#refresh');
        if (refresh) refresh.onclick = () => loadCatalog();
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Delete' && event.key !== 'Backspace') return;
            const tag = String(event.target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable) return;
            if (!state.sel) return;
            event.preventDefault();
            removeModule(state.sel);
        });
    }

    function toggleTheme() {
        const root = document.documentElement;
        const current = root.dataset.theme
            || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        const next = current === 'dark' ? 'light' : 'dark';
        root.dataset.theme = next;
        writeLocal(LS.theme, next);
    }

    function toast(message) {
        const element = $('#toast');
        if (!element) return;
        element.textContent = message;
        element.hidden = false;
        window.clearTimeout(toast.timer);
        toast.timer = window.setTimeout(() => { element.hidden = true; }, 2600);
    }

    function prettyTime(value) {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return String(value || '');
        return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    }
})();
