'use strict';

/* Segment library UI: groups, design library, animations.
   No build step, no dependencies. Data comes from the generated
   /data/library/segment-groups index and the existing library index. */

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const state = {
    index: null,
    library: null,
    clips: null,
    motionRecipes: new Map(),
    view: 'groups',
    groupPage: 90,
    animPage: 120,
    animMode: 'library',
    filters: {
        q: '',
        category: '',
        origin: '',
        motion: '',
        project: '',
        hasPreview: false,
        sort: 'category',
    },
    libFilters: { q: '', brand: '', status: '' },
    animFilters: { q: '', origin: '', status: '' },
    detail: null,
    preview: {
        nodes: [],
        motionId: '',
        playing: true,
        speed: 1,
        hidden: new Set(),
        raf: 0,
        elapsed: 0,
        innerW: 0,
        innerH: 0,
        aspect: 1,
        bbox: null,
        lastTime: 0,
        observer: null,
    },
    viewer: {
        mode: '',
        design: null,
        animation: null,
        group: null,
        clip: null,
        document: null,
        nodes: [],
        tracks: [],
        width: 100,
        height: 100,
        bbox: null,
        aspect: 1,
        duration: 3000,
        playing: true,
        loop: true,
        speed: 1,
        elapsed: 0,
        raf: 0,
        lastTime: 0,
        innerW: 0,
        innerH: 0,
        hidden: new Set(),
        observer: null,
        video: false,
    },
};

/* ── helpers ───────────────────────────────────────────────────────── */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

function formatMs(ms) {
    const value = Number(ms) || 0;
    if (value >= 10000) return `${(value / 1000).toFixed(1)}s`;
    if (value >= 1000) return `${(value / 1000).toFixed(2).replace(/0$/, '')}s`;
    return `${value}ms`;
}

function prettyProject(id) {
    return String(id || '')
        .replace(/^(?:0-)+/, '')
        .replace(/-copy-\d+.*$/, '')
        .replace(/[-_]{2,}/g, ' · ')
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Source';
}

function prettyBrand(id) {
    return String(id || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
        const error = new Error(`${url} → HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return response.json();
}

function setText(selector, value) {
    const node = $(selector);
    if (node) node.textContent = value;
}

function debounce(fn, delay = 120) {
    let timer = 0;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

/* ── boot ──────────────────────────────────────────────────────────── */

async function boot() {
    renderTabs();
    wireTabs();
    wireFilters();
    wireDetail();
    wireViewer();
    wireHelp();

    const [segmentResult, libraryResult, clipsResult, motionsResult] = await Promise.allSettled([
        fetchJson('/data/library/segment-groups/index.json'),
        fetchJson('/data/library/index.json'),
        fetchJson('/data/library/clips.json'),
        fetchJson('/data/library/segment-groups/motions.json'),
    ]);

    if (motionsResult.status === 'fulfilled') {
        for (const motion of motionsResult.value.motions || []) state.motionRecipes.set(motion.id, motion);
    }

    if (segmentResult.status === 'fulfilled') {
        state.index = segmentResult.value;
        buildGroupFilters();
        buildTargetGroupOptions();
        renderStats();
        renderGroups();
        renderTabs();
    } else {
        showSegmentError(segmentResult.reason);
    }

    if (libraryResult.status === 'fulfilled') {
        state.library = libraryResult.value;
        buildLibraryFilters();
        renderLibrary();
        renderStats();
    } else {
        setText('#libCount', 'The design library index could not be loaded.');
    }

    if (clipsResult.status === 'fulfilled') {
        state.clips = clipsResult.value;
        renderAnimations();
        renderStats();
    }

    applyHash();
}

function showSegmentError(error) {
    setText('#groupCount', 'The segment library has not been built.');
    setText('#statGroups', '—');
    const empty = $('#groupEmpty');
    empty.hidden = false;
    empty.innerHTML = `
        <strong>The segment library index is missing${error && error.status ? ` (HTTP ${esc(error.status)})` : ''}.</strong>
        <p>Build it once from the repository root:</p>
        <p><code>npm run build:segments</code></p>
        <p>Then reload this page. The generated files land in <code>data/library/segment-groups/</code>.</p>`;
}

function renderStats() {
    const index = state.index;
    if (index) {
        const counts = index.counts || {};
        setText('#statGroups', counts.groups ?? '—');
        setText('#statGroupsNote', `${counts.declaredGroups ?? 0} declared · ${counts.inferredGroups ?? 0} inferred`);
        setText('#statLayers', counts.layers ?? '—');
        setText('#statLayersNote', `${counts.availableLayers ?? 0} with art · ${counts.missingLayers ?? 0} missing`);
        setText('#statCategories', counts.categories ?? '—');
        setText('#statMotions', counts.motions ?? '—');
        const projects = new Set((index.groups || []).map((group) => group.source.projectId));
        setText('#statSources', projects.size);
    }
    if (state.library) {
        const designs = state.library.designs || [];
        const animations = designs.reduce((sum, design) => sum + (design.animations || []).length, 0);
        setText('#statAnimations', animations);
        setText('#statClipsNote', `${state.clips?.clips?.length || 0} motion clips`);
    }
    setText('#tabGroups', state.index ? state.index.counts.groups : '—');
    setText('#tabLibrary', state.library ? state.library.designs.length : '—');
    setText('#tabAnimations', state.library
        ? (state.library.designs || []).reduce((sum, design) => sum + (design.animations || []).length, 0)
        : '—');
}

function renderTabs() {
    $$('.seg-tab').forEach((tab) => {
        tab.classList.toggle('is-active', tab.dataset.view === state.view);
    });
    $$('.seg-view').forEach((view) => {
        view.hidden = view.id !== `view-${state.view}`;
    });
}

/* ── groups ─────────────────────────────────────────────────────────── */

function buildGroupFilters() {
    const index = state.index;
    const categorySelect = $('#groupCategory');
    for (const category of index.categories || []) {
        if (!category.groupCount) continue;
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = `${category.label} (${category.groupCount})`;
        categorySelect.append(option);
    }

    const motionSelect = $('#groupMotion');
    for (const motion of index.motions || []) {
        const option = document.createElement('option');
        option.value = motion.id;
        option.textContent = motion.label;
        motionSelect.append(option);
    }

    const projectSelect = $('#groupProject');
    const projects = new Map();
    for (const group of index.groups || []) {
        const id = group.source.projectId;
        projects.set(id, (projects.get(id) || 0) + 1);
    }
    for (const [id, count] of [...projects].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = `${prettyProject(id)} (${count})`;
        projectSelect.append(option);
    }
}

function filteredGroups() {
    const index = state.index;
    if (!index) return [];
    const filters = state.filters;
    const terms = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
    const categoryOrder = new Map((index.categories || []).map((category, order) => [category.id, order]));

    let groups = (index.groups || []).filter((group) => {
        if (filters.category && group.category !== filters.category) return false;
        if (filters.origin === 'declared' && group.origin !== 'declared') return false;
        if (filters.origin === 'inferred' && group.origin === 'declared') return false;
        if (filters.motion && !(group.motions || []).some((motion) => motion.id === filters.motion)) return false;
        if (filters.project && group.source.projectId !== filters.project) return false;
        if (filters.hasPreview && !(group.preview?.card || group.preview?.full)) return false;
        if (!terms.length) return true;
        const haystack = `${group.name} ${group.categoryLabel} ${group.keywords || ''} ${(group.tags || []).join(' ')} ${group.source.projectId} ${group.source.compositionId}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
    });

    if (filters.sort === 'name') groups = groups.sort((a, b) => a.name.localeCompare(b.name));
    else if (filters.sort === 'layers') groups = groups.sort((a, b) => b.layerCount - a.layerCount || a.name.localeCompare(b.name));
    else if (filters.sort === 'sources') groups = groups.sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.name.localeCompare(b.name));
    else groups = groups.sort((a, b) => (
        (categoryOrder.get(a.category) ?? 99) - (categoryOrder.get(b.category) ?? 99)
        || (a.origin === 'declared' ? 0 : 1) - (b.origin === 'declared' ? 0 : 1)
        || a.name.localeCompare(b.name)
        || a.source.projectId.localeCompare(b.source.projectId)
    ));
    return groups;
}

function renderGroups() {
    if (!state.index) return;
    const groups = filteredGroups();
    const visible = groups.slice(0, state.groupPage);
    const grid = $('#groupGrid');
    grid.innerHTML = visible.map(groupCard).join('');

    const layers = groups.reduce((sum, group) => sum + group.layerCount, 0);
    const sources = new Set(groups.map((group) => group.source.projectId)).size;
    setText('#groupCount', `${groups.length} group${groups.length === 1 ? '' : 's'} · ${layers} segments · ${sources} source${sources === 1 ? '' : 's'}`);
    $('#groupEmpty').hidden = groups.length > 0;
    $('#groupMore').hidden = groups.length <= visible.length;
    $('#groupMore').textContent = `Load more (${groups.length - visible.length} left)`;

    for (const card of $$('.seg-group-card', grid)) {
        card.addEventListener('click', () => openGroup(card.dataset.id));
        card.addEventListener('keydown', (event) => {
            if (event.target.closest('.seg-play, .seg-chip-play')) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openGroup(card.dataset.id);
            }
        });
    }
    for (const play of $$('.seg-play, .seg-chip-play', grid)) {
        const launch = (event) => {
            event.preventDefault();
            event.stopPropagation();
            openGroup(play.dataset.playGroup, play.dataset.playMotion);
        };
        play.addEventListener('click', launch);
        play.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') launch(event);
        });
    }
}

function groupCard(group) {
    const preview = group.preview?.card || group.preview?.full || '';
    const fallback = esc(group.name.slice(0, 1).toUpperCase());
    const missing = group.layerCount - group.availableCount;
    const badge = group.origin === 'declared'
        ? '<span class="seg-thumb-badge">Declared</span>'
        : '<span class="seg-thumb-badge inferred">Inferred</span>';
    const missingBadge = missing > 0
        ? `<span class="seg-thumb-badge warn" title="${missing} member image(s) missing">${missing} missing</span>`
        : '';
    const contextBadge = group.preview?.mode === 'reference'
        ? '<span class="seg-thumb-badge context" title="Preview cropped from the source frame">Context</span>'
        : '';
    const playMotion = (group.motions || []).find((motion) => motion.id !== 'hold');
    const playButton = `<button type="button" class="seg-play" data-play-group="${esc(group.id)}"
        data-play-motion="${esc(playMotion?.id || '')}" aria-label="Preview ${esc(group.name)} motion">▶</button>`;
    const primaryMotion = (group.motions || []).find((motion) => motion.id !== 'hold') || group.motions?.[0];
    const motionChip = primaryMotion
        ? `<button type="button" class="seg-chip motion seg-chip-play" data-play-group="${esc(group.id)}"
            data-play-motion="${esc(primaryMotion.id)}" title="Preview ${esc(primaryMotion.label)}">▶ ${esc(primaryMotion.label)}</button>`
        : '';
    const sourceLabel = prettyProject(group.source.projectId);
    return `
        <article class="seg-group-card" role="button" tabindex="0" data-id="${esc(group.id)}"
            aria-label="${esc(group.name)} — ${group.layerCount} layers">
            <div class="seg-thumb">
                ${preview
                    ? `<img src="${esc(preview)}" alt="${esc(group.name)} preview" loading="lazy" decoding="async">`
                    : `<span class="seg-fallback">${fallback}</span>`}
                ${badge}${missingBadge}${contextBadge}${playButton}
            </div>
            <div class="seg-group-body">
                <h3>${esc(group.name)}</h3>
                <p class="seg-card-meta">
                    <span>${group.layerCount} segment${group.layerCount === 1 ? '' : 's'}</span>
                    <span class="sep">·</span>
                    <span>${group.occurrenceCount} source${group.occurrenceCount === 1 ? '' : 's'}</span>
                    ${group.zRange ? `<span class="sep">·</span><span>z ${group.zRange[0]}–${group.zRange[1]}</span>` : ''}
                </p>
                <div class="seg-chips">
                    <span class="seg-chip cat" style="--cat:${esc(group.categoryColor)}">${esc(group.categoryLabel)}</span>
                    ${motionChip}
                    <span class="seg-chip source" title="${esc(group.source.projectId)}">${esc(sourceLabel)}</span>
                </div>
            </div>
        </article>`;
}

/* ── library ────────────────────────────────────────────────────────── */

function buildLibraryFilters() {
    const select = $('#libBrand');
    const brands = new Map();
    for (const design of state.library.designs || []) {
        brands.set(design.brandId || '', (brands.get(design.brandId || '') || 0) + 1);
    }
    for (const [id, count] of [...brands].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
        if (!id) continue;
        const option = document.createElement('option');
        option.value = id;
        option.textContent = `${prettyBrand(id)} (${count})`;
        select.append(option);
    }
}

function renderLibrary() {
    if (!state.library) return;
    const filters = state.libFilters;
    const terms = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
    const designs = (state.library.designs || []).filter((design) => {
        if (filters.brand && design.brandId !== filters.brand) return false;
        if (filters.status && design.status !== filters.status) return false;
        if (!terms.length) return true;
        const haystack = `${design.id} ${design.name} ${design.brandId} ${design.kind} ${(design.tags || []).join(' ')}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
    });

    const ready = designs.filter((design) => design.status === 'ready').length;
    const review = designs.filter((design) => design.status === 'review').length;
    const blocked = designs.filter((design) => design.status === 'blocked').length;
    setText('#libCount', `${designs.length} design${designs.length === 1 ? '' : 's'} · ${ready} ready · ${review} review${blocked ? ` · ${blocked} blocked` : ''}`);
    $('#libEmpty').hidden = designs.length > 0;
    $('#libGrid').innerHTML = designs.map((design) => {
        const animations = design.animations || [];
        return `
            <article class="seg-lib-card">
                <div class="seg-lib-thumb">
                    <img src="${esc(design.thumbnail || '')}" alt="${esc(design.name)}" loading="lazy" decoding="async">
                    <span class="seg-status ${esc(design.status)}">${esc(design.status)}</span>
                </div>
                <div class="seg-lib-body">
                    <h3>${esc(design.name)}</h3>
                    <p class="seg-card-meta">
                        <span>${esc(prettyBrand(design.brandId))}</span><span class="sep">·</span>
                        <span>${esc(design.kind)}</span><span class="sep">·</span>
                        <span>${esc(design.aspect)}</span>
                    </p>
                    <div class="seg-chips">
                        <span class="seg-chip">${design.layers} layers</span>
                        <button type="button" class="seg-chip motion" data-design-animations="${esc(design.id)}"
                            ${animations.length ? '' : 'disabled'}>${animations.length} animation${animations.length === 1 ? '' : 's'} →</button>
                    </div>
                    <a href="${esc(design.composition)}" target="_blank" rel="noreferrer">Open composition JSON →</a>
                </div>
            </article>`;
    }).join('');
}

/* ── animations ─────────────────────────────────────────────────────── */

function libraryAnimations() {
    if (!state.library) return [];
    return (state.library.designs || []).flatMap((design) => (
        (design.animations || []).map((animation) => ({
            ...animation,
            designId: design.id,
            designName: design.name,
            brandId: design.brandId,
            designStatus: design.status,
            sourceVideo: design.sourceVideo || '',
            sourcePoster: design.sourcePoster || design.thumbnail || '',
            thumbnail: design.thumbnail || '',
            designWidth: design.width,
            designHeight: design.height,
        }))
    ));
}

function categoryLabel(id) {
    const category = (state.index?.categories || []).find((item) => item.id === id);
    return category ? category.label : id;
}

function renderAnimations() {
    const mode = state.animMode;
    const isClips = mode === 'clips';
    const isRecipes = mode === 'recipes';
    $('#animOriginField').hidden = mode !== 'library';
    $('#animStatusField').hidden = mode !== 'library';
    $('#animLegend').textContent = isRecipes
        ? 'the 16 reusable motion recipes attached to segment groups'
        : isClips
            ? 'reusable motion clips extracted from the designs'
            : 'original and generated animations attached to library designs';

    if (isRecipes) {
        renderRecipes();
        return;
    }

    if (isClips) {
        if (!state.clips) return;
        const filters = state.animFilters;
        const terms = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
        let clips = (state.clips.clips || []).filter((clip) => {
            if (!terms.length) return true;
            const haystack = `${clip.id} ${clip.name} ${clip.effect} ${clip.direction} ${clip.mode} ${(clip.tags || []).join(' ')} ${(clip.appliesTo || []).join(' ')}`.toLowerCase();
            return terms.every((term) => haystack.includes(term));
        });
        clips = clips.slice(0, 250);
        setText('#animCount', `${clips.length} motion clips shown`);
        $('#animEmpty').hidden = clips.length > 0;
        $('#animMore').hidden = true;
        $('#animList').innerHTML = clips.map((clip) => `
            <div class="seg-clip-row">
                <div class="seg-anim-name"><strong>${esc(clip.name)}</strong><span class="seg-chip">${esc(clip.effect || clip.mode || 'clip')}</span></div>
                <span class="seg-anim-meta seg-clip-duration">${formatMs(clip.duration)}</span>
                <span class="seg-anim-meta seg-clip-frames">${(clip.frames || []).length} frames</span>
                <span class="seg-anim-meta seg-clip-uses">${clip.uses || 0} uses</span>
                <div class="seg-clip-tags">${(clip.tags || []).slice(0, 5).map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>
                <div class="seg-row-actions">
                    <button type="button" class="button small" data-view-clip="${esc(clip.id)}">View</button>
                </div>
            </div>`).join('');
        return;
    }

    if (!state.library) return;
    const filters = state.animFilters;
    const terms = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
    let animations = libraryAnimations().filter((animation) => {
        if (filters.origin && animation.origin !== filters.origin) return false;
        if (filters.status && animation.status !== filters.status) return false;
        if (!terms.length) return true;
        const haystack = `${animation.name} ${animation.id} ${animation.designName} ${animation.origin} ${animation.status}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
    });

    const total = animations.length;
    const visible = animations.slice(0, state.animPage);
    setText('#animCount', `${total} animation${total === 1 ? '' : 's'}`);
    $('#animEmpty').hidden = total > 0;
    $('#animMore').hidden = total <= visible.length;
    $('#animMore').textContent = `Load more (${total - visible.length} left)`;

    $('#animList').innerHTML = visible.map((animation) => `
        <div class="seg-anim-row">
            <div class="seg-anim-name">
                <strong title="${esc(animation.id)}">${esc(animation.name)}</strong>
                <span class="seg-chip">${esc(animation.origin)}</span>
            </div>
            <span class="seg-anim-design">${esc(animation.designName)}</span>
            <span class="seg-anim-meta">${formatMs(animation.duration)}</span>
            <span class="seg-anim-status ${esc(animation.status || '')}"><i></i>${esc(animation.status || 'unknown')}</span>
            <span class="seg-anim-meta seg-anim-brand">${esc(prettyBrand(animation.brandId))}</span>
            <div class="seg-row-actions">
                <button type="button" class="button small" data-view-animation="${esc(animation.id)}"
                    data-view-design="${esc(animation.designId)}">View</button>
                <a href="${esc(animation.file)}" target="_blank" rel="noreferrer">JSON</a>
            </div>
        </div>`).join('');
}

function renderRecipes() {
    if (!state.index) return;
    const filters = state.animFilters;
    const terms = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
    let recipes = [...state.motionRecipes.values()].filter((recipe) => {
        if (!terms.length) return true;
        const haystack = `${recipe.id} ${recipe.label} ${recipe.summary} ${(recipe.categories || []).join(' ')} ${(recipe.tags || []).join(' ')}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
    });
    recipes = recipes.sort((a, b) => a.label.localeCompare(b.label));

    setText('#animCount', `${recipes.length} group motion recipe${recipes.length === 1 ? '' : 's'}`);
    $('#animEmpty').hidden = recipes.length > 0;
    $('#animMore').hidden = true;

    $('#animList').innerHTML = recipes.map((recipe) => {
        const groups = (recipe.groupsUsing || [])
            .map((id) => (state.index.groups || []).find((group) => group.id === id))
            .filter((group) => group && group.availableCount > 0);
        const categoryList = (recipe.categories || []).map(categoryLabel).join(', ');
        return `
            <div class="seg-recipe-row">
                <div class="seg-recipe-copy">
                    <strong>${esc(recipe.label)}</strong>
                    <small>${esc(recipe.summary)}</small>
                </div>
                <span class="seg-anim-design">${esc(categoryList)} · ${groups.length} group${groups.length === 1 ? '' : 's'}</span>
                <span class="seg-anim-meta seg-recipe-meta">${formatMs(recipe.duration)}</span>
                <span class="seg-anim-meta seg-recipe-meta">${recipe.loop ? 'loop' : 'once'} · ${recipe.phase}</span>
                <div class="seg-row-actions">
                    <button type="button" class="button small" data-view-recipe="${esc(recipe.id)}"
                        ${groups.length ? '' : 'disabled title="No group with available art uses this recipe"'}>View</button>
                </div>
            </div>`;
    }).join('');
}

/* ── detail ─────────────────────────────────────────────────────────── */

async function openGroup(id, motionId = '') {
    if (!id) return;
    closeViewer();
    try {
        const detail = await fetchJson(`/data/library/segment-groups/groups/${encodeURIComponent(id)}.json`);
        showDetail(detail, motionId);
        history.replaceState(null, '', `#group=${encodeURIComponent(id)}`);
    } catch (error) {
        console.error(error);
    }
}

function showDetail(detail, motionId = '') {
    state.detail = detail;
    const preview = state.preview;
    preview.hidden = new Set();
    preview.speed = 1;
    preview.playing = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    preview.elapsed = 0;
    preview.nodes = [];
    preview.bbox = detail.bbox || { x: 0, y: 0, w: 100, h: 100 };
    const size = detail.size || { width: 1, height: 1 };
    preview.aspect = ((preview.bbox.w || 100) * (size.width || 1)) / ((preview.bbox.h || 100) * (size.height || 1)) || 1;

    const motionOptions = (detail.motions || []).filter((motion) => state.motionRecipes.has(motion.id) || motion.id === 'hold');
    const requestedMotion = motionId && motionOptions.some((motion) => motion.id === motionId) ? motionId : '';
    preview.motionId = requestedMotion
        || (motionOptions.find((motion) => motion.id !== 'hold') || motionOptions[0])?.id
        || 'hold';

    $('#detail').hidden = false;
    document.body.style.overflow = 'hidden';
    setText('#detailCategory', detail.categoryLabel || 'Group');
    setText('#detailTitle', detail.name);
    setText('#detailSub', `${detail.layerCount} segment${detail.layerCount === 1 ? '' : 's'} · ${detail.occurrenceCount} source${detail.occurrenceCount === 1 ? '' : 's'} · ${detail.source.compositionId}`);
    setText('#detailCategory', detail.categoryLabel || 'Group');
    $('#detailCategory').style.color = detail.categoryColor || '';
    setText('#detailMemberCount', `${detail.availableCount}/${detail.layerCount} with art`);
    setText('#detailOccurrenceCount', `${detail.occurrenceCount} source${detail.occurrenceCount === 1 ? '' : 's'}`);

    buildStage(detail, preview);
    buildMembers(detail);
    buildSources(detail);
    buildMotionSelect(motionOptions);
    $('#detailAgent').textContent = JSON.stringify(detail.agent, null, 2);
    const previewNote = $('#detailPreviewNote');
    if (detail.preview?.note) {
        previewNote.hidden = false;
        previewNote.textContent = detail.preview.note;
    } else {
        previewNote.hidden = true;
        previewNote.textContent = '';
    }

    $('#previewToggle').textContent = preview.playing ? 'Pause' : 'Play';
    $('#previewSpeed').value = '1';
    $('#previewBackdrop').checked = false;
    $('#detailRef').classList.remove('is-on');
    $('#previewMotion').value = preview.motionId;

    if (preview.playing) startPreview();
    else { stopPreview(); drawPreview(preview.elapsed); }
}

function buildStage(detail, preview) {
    const inner = $('#detailStageInner');
    const stage = $('#detailStage');
    const ref = $('#detailRef');
    inner.innerHTML = '';
    preview.nodes = [];

    const bbox = preview.bbox;
    const hasMembers = (detail.members || []).some((member) => member.available);
    $('#detailStageEmpty').hidden = hasMembers;
    stage.setAttribute('aria-label', `${detail.name} preview`);

    if (detail.reference?.available) {
        ref.src = detail.reference.url;
        ref.alt = `${detail.source.compositionId} reference`;
        ref.hidden = false;
        ref.style.left = `${-(bbox.x / bbox.w) * 100}%`;
        ref.style.top = `${-(bbox.y / bbox.h) * 100}%`;
        ref.style.width = `${(100 / bbox.w) * 100}%`;
        ref.style.height = `${(100 / bbox.h) * 100}%`;
        inner.append(ref);
        $('#previewBackdrop').disabled = false;
    } else {
        ref.hidden = true;
        ref.removeAttribute('src');
        $('#previewBackdrop').disabled = true;
    }

    for (const member of detail.members || []) {
        if (!member.available) continue;
        const wrapper = document.createElement('div');
        wrapper.className = 'seg-layer';
        wrapper.dataset.layerId = member.layerId;
        wrapper.style.left = `${((member.box.x - bbox.x) / bbox.w) * 100}%`;
        wrapper.style.top = `${((member.box.y - bbox.y) / bbox.h) * 100}%`;
        wrapper.style.width = `${(member.box.w / bbox.w) * 100}%`;
        wrapper.style.height = `${(member.box.h / bbox.h) * 100}%`;
        wrapper.style.zIndex = String(Math.round(Number(member.z) || 0));
        wrapper.style.opacity = String(member.opacity ?? 1);
        const image = document.createElement('img');
        image.src = member.url;
        image.alt = member.name;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.draggable = false;
        image.addEventListener('error', () => { wrapper.style.display = 'none'; });
        wrapper.append(image);
        inner.append(wrapper);
        preview.nodes.push({ el: wrapper, member });
    }

    if (preview.observer) preview.observer.disconnect();
    preview.observer = new ResizeObserver(() => layoutStage());
    preview.observer.observe(stage);
    requestAnimationFrame(() => layoutStage());
}

function layoutStage() {
    const stage = $('#detailStage');
    const inner = $('#detailStageInner');
    const preview = state.preview;
    if (!stage || !inner) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    let width = rect.width;
    let height = width / preview.aspect;
    if (height > rect.height) {
        height = rect.height;
        width = height * preview.aspect;
    }
    inner.style.width = `${width}px`;
    inner.style.height = `${height}px`;
    inner.style.left = `${(rect.width - width) / 2}px`;
    inner.style.top = `${(rect.height - height) / 2}px`;
    inner.style.right = 'auto';
    inner.style.bottom = 'auto';
    inner.style.margin = '0';
    preview.innerW = width;
    preview.innerH = height;
    drawPreview(preview.elapsed);
}

function buildMembers(detail) {
    const container = $('#detailMembers');
    const preview = state.preview;
    container.innerHTML = (detail.members || []).map((member) => `
        <label class="seg-member ${member.available ? '' : 'is-missing'}">
            <input type="checkbox" data-layer="${esc(member.layerId)}" ${member.available ? 'checked' : 'disabled'}>
            <span class="seg-member-name">
                <strong title="${esc(member.name)}">${esc(member.name)}</strong>
                <small>${esc(member.role || member.type || 'image')}</small>
            </span>
            <span class="seg-member-box">${member.box.x},${member.box.y} · ${member.box.w}×${member.box.h}</span>
        </label>`).join('');

    for (const input of $$('input[data-layer]', container)) {
        input.addEventListener('change', () => {
            const layerId = input.dataset.layer;
            if (input.checked) preview.hidden.delete(layerId);
            else preview.hidden.add(layerId);
            const node = preview.nodes.find((entry) => entry.member.layerId === layerId);
            if (node) node.el.classList.toggle('is-hidden', !input.checked);
        });
    }
}

function buildSources(detail) {
    const container = $('#detailSources');
    container.innerHTML = (detail.occurrences || []).map((occurrence) => {
        const label = occurrence.designName || occurrence.projectId || occurrence.compositionId;
        const canLink = occurrence.kind !== 'import';
        return `
            <div class="seg-source-row">
                <div>
                    <strong title="${esc(occurrence.compositionId)}">${esc(prettyProject(label))}</strong>
                    <div class="seg-muted">${esc(occurrence.kind)} · ${occurrence.availableCount}/${occurrence.memberCount} segments</div>
                </div>
                ${canLink ? `<a href="/${esc(occurrence.compositionPath)}" target="_blank" rel="noreferrer">JSON</a>` : `<span class="seg-muted">import</span>`}
            </div>`;
    }).join('') || '<p class="seg-muted">No source records.</p>';
}

function buildMotionSelect(options) {
    const select = $('#previewMotion');
    select.innerHTML = options.map((motion) => (
        `<option value="${esc(motion.id)}">${esc(motion.label)}${motion.origin === 'observed' ? ' · observed' : ''}</option>`
    )).join('');
}

function startPreview() {
    stopPreview();
    const preview = state.preview;
    if (!preview.nodes.length) return;
    state.preview.playing = true;
    $('#previewToggle').textContent = 'Pause';
    preview.lastTime = performance.now();
    const tick = (now) => {
        const delta = Math.max(0, now - preview.lastTime);
        preview.lastTime = now;
        preview.elapsed += delta * preview.speed;
        drawPreview(preview.elapsed);
        preview.raf = requestAnimationFrame(tick);
    };
    preview.raf = requestAnimationFrame(tick);
}

function stopPreview() {
    if (state.preview.raf) cancelAnimationFrame(state.preview.raf);
    state.preview.raf = 0;
}

function sampleKeys(keys, t) {
    if (!Array.isArray(keys) || !keys.length) return 0;
    const wrapped = ((t % 1) + 1) % 1;
    for (let index = 0; index < keys.length - 1; index += 1) {
        const [start, from] = keys[index];
        const [end, to] = keys[index + 1];
        if (wrapped >= start && wrapped <= end) {
            const span = end - start || 1;
            const unit = (wrapped - start) / span;
            const eased = 0.5 - 0.5 * Math.cos(Math.PI * unit);
            return from + (to - from) * eased;
        }
    }
    return keys[keys.length - 1][1];
}

function drawPreview(elapsed) {
    const preview = state.preview;
    const recipe = state.motionRecipes.get(preview.motionId) || state.motionRecipes.get('hold');
    if (!recipe || !preview.nodes.length) return;
    const bbox = preview.bbox || { x: 0, y: 0, w: 100, h: 100 };
    const duration = Math.max(1, recipe.duration || 3000);
    const looped = recipe.loop !== false;
    let base = looped ? (elapsed % duration) / duration : Math.min(1, elapsed / duration);
    const keys = recipe.keys || {};
    const phaseMode = recipe.phase || 'sync';
    const count = Math.max(1, preview.nodes.length);

    preview.nodes.forEach((node, index) => {
        const member = node.member;
        let phase = 0;
        let sign = 1;
        if (phaseMode === 'stagger') phase = (index / count) * 0.28;
        else if (phaseMode === 'alternate') {
            phase = (index % 2) * 0.5;
            sign = index % 2 ? -1 : 1;
        }
        const t = base + phase;
        const dx = sampleKeys(keys.dx, t) * sign;
        const dy = sampleKeys(keys.dy, t) * sign;
        const scale = sampleKeys(keys.s, t) || 1;
        const rotation = sampleKeys(keys.rot, t) * sign;
        const alpha = sampleKeys(keys.a, t);
        const translateX = dx * preview.innerW * (100 / (bbox.w || 100));
        const translateY = dy * preview.innerH * (100 / (bbox.h || 100));
        node.el.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale}) rotate(${rotation}deg)`;
        node.el.style.opacity = String(Math.max(0, Math.min(1, (member.opacity ?? 1) * alpha)));
        node.el.classList.toggle('is-hidden', preview.hidden.has(member.layerId));
    });
}

function closeDetail() {
    $('#detail').hidden = true;
    document.body.style.overflow = '';
    stopPreview();
    if (state.preview.observer) {
        state.preview.observer.disconnect();
        state.preview.observer = null;
    }
    state.detail = null;
    if (location.hash.startsWith('#group=')) {
        history.replaceState(null, '', state.view === 'groups' ? '#groups' : `#${state.view}`);
    }
}


/* ── animation viewer ──────────────────────────────────────────────── */

function closeViewer() {
    const viewer = state.viewer;
    stopViewer();
    const video = $('#animVideo');
    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }
    $('#animViewer').hidden = true;
    if ($('#detail').hidden) document.body.style.overflow = '';
    if (viewer.observer) {
        viewer.observer.disconnect();
        viewer.observer = null;
    }
    viewer.mode = '';
    viewer.video = false;
    viewer.animation = null;
    viewer.group = null;
    viewer.clip = null;
    viewer.nodes = [];
    viewer.hidden.clear();
}

function viewerShell({ eyebrow, title, sub }) {
    const viewer = state.viewer;
    viewer.nodes = [];
    viewer.hidden = new Set();
    viewer.elapsed = 0;
    viewer.playing = true;
    viewer.speed = 1;
    viewer.loop = true;
    $('#animViewer').hidden = false;
    document.body.style.overflow = 'hidden';
    setText('#animEyebrow', eyebrow);
    setText('#animTitle', title);
    setText('#animSub', sub);
    $('#animStage').setAttribute('aria-label', `${title} preview`);
    setText('#animOrigin', '—');
    setText('#animTrackCount', '—');
    setText('#animNote', '');
    setText('#animTrackHelp', 'Tracks that move layers in this animation. Toggle one to isolate it.');
    setText('#animTime', '0.0s / 0.0s');
    $('#animTrackList').innerHTML = '';
    $('#animMeta').innerHTML = '';
    $('#animSegments').innerHTML = '';
    $('#animStageInner').innerHTML = '';
    $('#animStageInner').hidden = false;
    $('#animStageInner').style.cssText = '';
    $('#animStageEmpty').hidden = true;
    $('#animPoster').hidden = true;
    $('#animPoster').removeAttribute('src');
    $('#animVideo').hidden = true;
    $('#animVideo').pause();
    $('#animVideo').removeAttribute('src');
    $('#animTargetField').hidden = true;
    $('#animTargetGroup').innerHTML = '';
    $('#animScrub').value = '0';
    $('#animScrub').disabled = true;
    $('#animPlay').disabled = true;
    $('#animRestart').disabled = true;
    $('#animSpeed').disabled = true;
    $('#animSpeed').value = '1';
    $('#animLoop').checked = true;
    $('#animLoop').disabled = true;
    $('#animPlay').textContent = 'Pause';
    if (viewer.observer) {
        viewer.observer.disconnect();
        viewer.observer = null;
    }
}

function viewerMeta(label, value, href = '') {
    return `
        <div class="seg-source-row">
            <div><strong>${esc(label)}</strong><div class="seg-muted">${esc(value || '—')}</div></div>
            ${href ? `<a href="${esc(href)}" target="_blank" rel="noreferrer">JSON</a>` : ''}
        </div>`;
}

function viewerChips(items) {
    const unique = [...new Set(items.filter(Boolean))];
    $('#animSegments').innerHTML = unique.slice(0, 10).map((item) => `<span class="seg-chip">${esc(item)}</span>`).join('');
}

function chooseClipGroup(clip) {
    if (!state.index) return '';
    const haystack = `${clip.name || ''} ${clip.effect || ''} ${clip.mode || ''} ${(clip.tags || []).join(' ')}`.toLowerCase();
    const guesses = [
        [/cloud|sky/, 'sky-clouds'],
        [/wave|sea|ocean|tide|shore|water/, 'sea-waves'],
        [/bird|gull|flock/, 'birds-wildlife'],
        [/character|person|pig|farmer|breathe|idle/, 'characters'],
        [/tree|leaf|grass|plant|veget|sway/, 'nature'],
        [/glow|light|sparkle|shine|pulse|smoke|candle/, 'effects'],
        [/letter|text|word/, 'text'],
    ];
    const preferred = guesses.find(([pattern]) => pattern.test(haystack))?.[1] || '';
    const groups = (state.index.groups || []).filter((group) => group.availableCount > 0 && (group.preview?.full || group.preview?.card));
    const score = (group) => (
        (preferred && group.category === preferred ? 100 : 0)
        + (group.layerCount >= 2 && group.layerCount <= 10 ? 20 : 0)
        + (group.preview?.mode === 'composite' ? 5 : 0)
        - group.layerCount * 0.1
    );
    const ranked = [...groups].sort((a, b) => score(b) - score(a));
    return (ranked[0] || groups[0] || {}).id || '';
}

function buildTargetGroupOptions() {
    if (!state.index) return;
    const select = $('#animTargetGroup');
    if (select.options.length) return;
    const order = new Map((state.index.categories || []).map((category, index) => [category.id, index]));
    const groups = (state.index.groups || [])
        .filter((group) => group.availableCount > 0)
        .sort((a, b) => (
            (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99)
            || a.name.localeCompare(b.name)
            || a.source.projectId.localeCompare(b.source.projectId)
        ));
    const byCategory = new Map();
    for (const group of groups) {
        if (!byCategory.has(group.category)) byCategory.set(group.category, []);
        byCategory.get(group.category).push(group);
    }
    for (const category of state.index.categories || []) {
        const items = byCategory.get(category.id);
        if (!items) continue;
        const optgroup = document.createElement('optgroup');
        optgroup.label = category.label;
        for (const group of items) {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = `${group.name} · ${prettyProject(group.source.projectId)} (${group.layerCount})`;
            optgroup.append(option);
        }
        select.append(optgroup);
    }
}

async function openAnimationViewer(animation) {
    closeDetail();
    viewerShell({
        eyebrow: 'Library animation',
        title: animation.name,
        sub: `${animation.designName} · ${animation.origin} · ${formatMs(animation.duration)}`,
    });
    const design = (state.library?.designs || []).find((item) => item.id === animation.designId);
    let documentJson = null;
    try {
        if (animation.file) documentJson = await fetchJson(animation.file);
    } catch (error) {
        console.warn('Animation JSON unavailable', animation.file, error);
    }
    if ($('#animViewer').hidden) return;
    const tracks = (documentJson?.tracks || []).filter((track) => track && Array.isArray(track.segments) && track.segments.length);

    if (animation.origin === 'original' && animation.sourceVideo) {
        setupVideoViewer(animation, design);
        return;
    }
    if (tracks.length) {
        try {
            const detail = await fetchJson(`/data/library/designs/${encodeURIComponent(animation.designId)}.json`);
            setupDesignViewer(animation, detail, documentJson, tracks);
            return;
        } catch (error) {
            console.warn('Design detail unavailable', animation.designId, error);
        }
    }
    // Only the original motion may fall back to the source recording. A
    // generated animation that lost its tracks must not masquerade as the
    // original recording.
    setupStaticViewer(animation, design);
}

function setupVideoViewer(animation, design) {
    const viewer = state.viewer;
    viewer.mode = 'video';
    viewer.video = true;
    viewer.animation = animation;
    viewer.playing = true;
    viewer.loop = true;
    viewer.elapsed = 0;
    const video = $('#animVideo');
    $('#animStageInner').hidden = true;
    $('#animPoster').hidden = true;
    video.hidden = false;
    video.src = animation.sourceVideo;
    video.loop = true;
    video.playbackRate = 1;
    video.currentTime = 0;
    video.load();
    video.play().catch(() => {});

    setText('#animOrigin', `original recording · ${formatMs(animation.duration)}`);
    setText('#animTrackCount', 'recording');
    setText('#animTrackHelp', 'Original motion is the source-exact recording; there are no editable tracks to isolate.');
    setText('#animNote', 'Playing the original motion recording. Switch to a generated animation to inspect its layer tracks.');
    $('#animTrackList').innerHTML = '<p class="seg-muted">No editable tracks — this is the source recording.</p>';
    $('#animMeta').innerHTML = [
        viewerMeta('Design', animation.designName),
        viewerMeta('Origin', animation.origin),
        viewerMeta('Status', animation.status),
        viewerMeta('File', animation.file, animation.file),
        viewerMeta('Source video', animation.sourceVideo, animation.sourceVideo),
    ].join('');
    viewerChips([animation.designName, animation.origin, ...(animation.id || '').split('-').slice(0, 2)]);
    $('#animPlay').disabled = false;
    $('#animRestart').disabled = false;
    $('#animSpeed').disabled = false;
    $('#animLoop').disabled = false;
    $('#animScrub').disabled = false;
    $('#animPlay').textContent = 'Pause';
    $('#animTime').textContent = `0.0s / ${((animation.duration || design?.sourceDuration || 0) / 1000).toFixed(1)}s`;
}

function setupStaticViewer(animation, design) {
    const viewer = state.viewer;
    viewer.mode = 'static';
    viewer.video = false;
    viewer.animation = animation;
    viewer.playing = false;
    viewer.duration = animation.duration || design?.duration || 0;
    const poster = animation.sourcePoster || design?.thumbnail || '';
    $('#animStageInner').hidden = true;
    $('#animVideo').hidden = true;
    const image = $('#animPoster');
    image.hidden = false;
    image.src = poster;
    setText('#animOrigin', `${animation.origin} · ${formatMs(animation.duration)}`);
    setText('#animTrackCount', 'none');
    setText('#animTrackHelp', 'No editable tracks or source recording are available for this animation.');
    setText('#animNote', 'Showing the design poster. The animation file may be missing or contain only a hold.');
    $('#animTrackList').innerHTML = '<p class="seg-muted">No tracks to show.</p>';
    $('#animMeta').innerHTML = [
        viewerMeta('Design', animation.designName),
        viewerMeta('Origin', animation.origin),
        viewerMeta('Status', animation.status),
        viewerMeta('File', animation.file, animation.file),
    ].join('');
    viewerChips([animation.designName, animation.origin]);
    $('#animPlay').disabled = true;
    $('#animPlay').textContent = 'Still';
    $('#animRestart').disabled = true;
    $('#animSpeed').disabled = true;
    $('#animLoop').disabled = true;
    $('#animScrub').disabled = true;
    $('#animTime').textContent = `0.0s / ${((viewer.duration || 0) / 1000).toFixed(1)}s`;
}

function setupDesignViewer(animation, design, documentJson, tracks) {
    const viewer = state.viewer;
    viewer.mode = 'design';
    viewer.video = false;
    viewer.animation = animation;
    viewer.design = design;
    viewer.document = documentJson;
    viewer.width = design.width || 100;
    viewer.height = design.height || 100;
    viewer.bbox = { x: 0, y: 0, w: 100, h: 100 };
    viewer.aspect = viewer.width / viewer.height || 1;
    viewer.duration = animation.duration || documentJson?.duration || design.duration || 3000;
    viewer.elapsed = 0;
    viewer.loop = true;
    viewer.playing = true;

    $('#animVideo').hidden = true;
    $('#animPoster').hidden = true;
    $('#animStageInner').hidden = false;

    const layers = (design.layers || []).filter((layer) => (
        (layer.type === 'image' && layer.url) || (layer.type === 'text' && layer.text)
    ));
    buildViewerNodes(layers, viewer.bbox);

    const byId = new Map();
    let matched = 0;
    for (const track of tracks) {
        const layer = layers.find((item) => item.id === track.layerId)
            || layers.find((item) => String(item.name || '').toLowerCase() === String(track.layerName || '').toLowerCase());
        if (!layer) continue;
        matched += 1;
        if (!byId.has(layer.id)) byId.set(layer.id, []);
        byId.get(layer.id).push(prepareTrack(track));
    }
    for (const node of viewer.nodes) {
        node.tracks = byId.get(node.layer.id) || [];
    }

    const animated = viewer.nodes.filter((node) => node.tracks.length);
    setText('#animOrigin', `${animation.origin} · ${formatMs(viewer.duration)}`);
    setText('#animTrackCount', `${matched} track${matched === 1 ? '' : 's'} · ${animated.length} layer${animated.length === 1 ? '' : 's'}`);
    setText('#animTrackHelp', animated.length
        ? 'Tracks matched to layers in this design. Toggle a layer to isolate it; layers without tracks hold their base pose.'
        : 'No track matched a renderable layer. The design is shown at its base pose.');
    renderViewerTracks(animated.map((node) => ({
        id: node.layer.id,
        name: node.layer.name || node.layer.id,
        meta: node.tracks.map((track) => {
            const segment = track.segments?.[0] || {};
            const labels = (track.segments || []).map((item) => item.label).filter(Boolean);
            return `${labels[0] || track.label || 'track'} · ${formatMs(segment.duration || 0)}`;
        }).join(', '),
    })));

    $('#animMeta').innerHTML = [
        viewerMeta('Design', design.name || animation.designName),
        viewerMeta('Origin', animation.origin),
        viewerMeta('Status', animation.status),
        viewerMeta('Duration', formatMs(viewer.duration)),
        viewerMeta('Animation file', animation.file, animation.file),
        viewerMeta('Composition', design.composition, design.composition),
    ].join('');
    setText('#animNote', matched
        ? `${matched} track${matched === 1 ? '' : 's'} matched ${animated.length} of ${layers.length} renderable layers. Text and image layers without tracks hold their base pose.`
        : 'No editable track matched this design. The poster or source recording is the better reference.');

    const relatedGroups = (state.index?.groups || [])
        .filter((group) => group.source.compositionId === design.id)
        .slice(0, 8)
        .map((group) => `${group.categoryLabel}: ${group.name}`);
    viewerChips([design.name, animation.origin, ...(design.tags || []), ...relatedGroups]);
    $('#animPlay').disabled = false;
    $('#animRestart').disabled = false;
    $('#animSpeed').disabled = false;
    $('#animLoop').disabled = false;
    $('#animScrub').disabled = false;
    $('#animPlay').textContent = 'Pause';

    layoutViewer();
    startViewer();
}

async function openClipViewer(clip, groupId = '') {
    closeDetail();
    viewerShell({
        eyebrow: 'Motion clip',
        title: clip.name,
        sub: `${clip.effect || clip.mode || 'clip'} · ${formatMs(clip.duration)} · ${clip.uses || 0} uses`,
    });
    const target = groupId || chooseClipGroup(clip);
    if (!target) {
        setText('#animStageEmpty', 'No segment group with available art can preview this clip.');
        $('#animStageEmpty').hidden = false;
        return;
    }
    let detail;
    try {
        detail = await fetchJson(`/data/library/segment-groups/groups/${encodeURIComponent(target)}.json`);
    } catch (error) {
        setText('#animStageEmpty', 'That segment group could not be loaded.');
        $('#animStageEmpty').hidden = false;
        return;
    }
    if ($('#animViewer').hidden) return;
    const viewer = state.viewer;
    viewer.mode = 'clip';
    viewer.video = false;
    // Some extracted clips store a:0 on every frame to mean "opacity is not
    // animated", not "the layer is invisible". Treat an all-zero opacity
    // channel as neutral so a drift/fade clip does not preview as a blank stage.
    const rawFrames = Array.isArray(clip.frames) ? clip.frames : [];
    const allTransparent = rawFrames.length > 0 && rawFrames.every((frame) => (frame.a ?? 1) === 0);
    viewer.clip = allTransparent
        ? { ...clip, frames: rawFrames.map((frame) => ({ ...frame, a: 1 })) }
        : clip;
    viewer.group = detail;
    viewer.width = detail.size?.width || 100;
    viewer.height = detail.size?.height || 100;
    viewer.bbox = detail.bbox || { x: 0, y: 0, w: 100, h: 100 };
    viewer.aspect = ((viewer.bbox.w || 100) * viewer.width) / ((viewer.bbox.h || 100) * viewer.height) || 1;
    const lastFrame = Math.max(0, ...(clip.frames || []).map((frame) => Number(frame.t) || 0));
    viewer.duration = Math.max(Number(clip.duration) || 0, lastFrame) || 1000;
    viewer.elapsed = 0;
    viewer.loop = true;
    viewer.playing = true;

    $('#animVideo').hidden = true;
    $('#animPoster').hidden = true;
    $('#animStageInner').hidden = false;

    const layers = (detail.members || [])
        .filter((member) => member.available)
        .map((member) => ({
            id: member.layerId,
            name: member.name,
            type: 'image',
            z: member.z,
            box: member.box,
            url: member.url,
            opacity: member.opacity,
        }));
    buildViewerNodes(layers, viewer.bbox);
    for (const node of viewer.nodes) node.tracks = [];

    setText('#animOrigin', `${clip.origin || 'clip'} · ${formatMs(viewer.duration)}`);
    setText('#animTrackCount', `${layers.length} member${layers.length === 1 ? '' : 's'}`);
    setText('#animTrackHelp', 'The clip is applied to every available member of the selected segment group. Toggle a member to isolate it.');
    renderViewerTracks(layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        meta: layer.layerId || layer.id,
    })));

    $('#animMeta').innerHTML = [
        viewerMeta('Clip', clip.id),
        viewerMeta('Effect', clip.effect || clip.mode || 'clip'),
        viewerMeta('Duration', formatMs(viewer.duration)),
        viewerMeta('Uses', String(clip.uses || 0)),
        viewerMeta('Origin', clip.origin || 'extracted'),
        viewerMeta('Applies to', (clip.appliesTo || []).slice(0, 6).join(', ')),
    ].join('');
    setText('#animNote', `Applied to ${layers.length} member${layers.length === 1 ? '' : 's'} of “${detail.name}”. Choose a different segment group with the target picker above.`);
    viewerChips([detail.categoryLabel, detail.name, prettyProject(detail.source.projectId), ...(clip.tags || [])]);

    buildTargetGroupOptions();
    $('#animTargetGroup').value = target;
    $('#animTargetField').hidden = false;
    $('#animPlay').disabled = false;
    $('#animRestart').disabled = false;
    $('#animSpeed').disabled = false;
    $('#animLoop').disabled = false;
    $('#animScrub').disabled = false;
    $('#animPlay').textContent = 'Pause';

    layoutViewer();
    startViewer();
}

function previewRecipe(id) {
    const recipe = state.motionRecipes.get(id);
    if (!recipe || !state.index) return;
    const groups = (recipe.groupsUsing || [])
        .map((groupId) => (state.index.groups || []).find((group) => group.id === groupId))
        .filter((group) => group && group.availableCount > 0);
    const chosen = groups.sort((a, b) => {
        const score = (group) => (
            (group.preview?.full ? 10 : 0)
            + (group.layerCount >= 2 && group.layerCount <= 12 ? 12 : 0)
            + Math.min(group.layerCount, 8) * 0.5
            - (group.layerCount > 20 ? 5 : 0)
        );
        return score(b) - score(a);
    })[0];
    if (!chosen) {
        setText('#animCount', 'No segment group with available art uses this recipe.');
        return;
    }
    openGroup(chosen.id, id);
}

function prepareTrack(track) {
    const copy = { ...track };
    copy.segments = [...(track.segments || [])]
        .filter((segment) => segment && Array.isArray(segment.frames) && segment.frames.length)
        .map((segment) => ({
            ...segment,
            frames: [...segment.frames].sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0)),
        }))
        .sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
    return copy;
}

function buildViewerNodes(layers, bbox) {
    const viewer = state.viewer;
    const inner = $('#animStageInner');
    inner.innerHTML = '';
    viewer.nodes = [];
    const ordered = [...layers].sort((a, b) => (Number(a.z) || 0) - (Number(b.z) || 0));
    for (const layer of ordered) {
        const element = document.createElement('div');
        const isText = layer.type === 'text' && layer.text;
        element.className = isText ? 'seg-text-layer' : 'seg-layer';
        element.dataset.layerId = layer.id;
        element.style.left = `${((layer.box.x - bbox.x) / bbox.w) * 100}%`;
        element.style.top = `${((layer.box.y - bbox.y) / bbox.h) * 100}%`;
        element.style.width = `${(layer.box.w / bbox.w) * 100}%`;
        element.style.height = `${(layer.box.h / bbox.h) * 100}%`;
        element.style.zIndex = String(Math.round(Number(layer.z) || 0));
        element.style.opacity = String(layer.opacity ?? 1);
        if (isText) {
            element.textContent = layer.text;
            const font = layer.font || {};
            element.style.fontFamily = `"${font.family || 'Helvetica Neue'}", Helvetica, Arial, sans-serif`;
            element.style.color = font.color || '#111';
            element.dataset.sizePct = String(font.sizePct || 4);
        } else {
            const image = document.createElement('img');
            image.src = layer.url;
            image.alt = layer.name || '';
            image.loading = 'lazy';
            image.decoding = 'async';
            image.draggable = false;
            image.addEventListener('error', () => { element.style.display = 'none'; });
            element.append(image);
        }
        inner.append(element);
        viewer.nodes.push({ el: element, layer, tracks: [] });
    }
    $('#animStageEmpty').hidden = viewer.nodes.length > 0;
    if (!viewer.nodes.length) {
        setText('#animStageEmpty', 'No renderable image or text layers were found.');
    }
    if (viewer.observer) viewer.observer.disconnect();
    viewer.observer = new ResizeObserver(() => layoutViewer());
    viewer.observer.observe($('#animStage'));
}

function layoutViewer() {
    const stage = $('#animStage');
    const inner = $('#animStageInner');
    const viewer = state.viewer;
    if (!stage || !inner || inner.hidden) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    let width = rect.width;
    let height = width / (viewer.aspect || 1);
    if (height > rect.height) {
        height = rect.height;
        width = height * (viewer.aspect || 1);
    }
    inner.style.width = `${width}px`;
    inner.style.height = `${height}px`;
    inner.style.left = `${(rect.width - width) / 2}px`;
    inner.style.top = `${(rect.height - height) / 2}px`;
    inner.style.right = 'auto';
    inner.style.bottom = 'auto';
    inner.style.margin = '0';
    viewer.innerW = width;
    viewer.innerH = height;
    for (const node of viewer.nodes) {
        if (node.el.classList.contains('seg-text-layer')) {
            const sizePct = Number(node.el.dataset.sizePct) || 4;
            node.el.style.fontSize = `${Math.max(6, (sizePct / 100) * width)}px`;
        }
    }
    drawViewer(viewer.elapsed);
}

function startViewer() {
    const viewer = state.viewer;
    stopViewer();
    if (viewer.video) {
        const video = $('#animVideo');
        video.play().catch(() => {});
        viewer.playing = true;
        $('#animPlay').textContent = 'Pause';
        return;
    }
    if (!viewer.nodes.length) return;
    viewer.playing = true;
    viewer.lastTime = performance.now();
    $('#animPlay').textContent = 'Pause';
    const tick = (now) => {
        const delta = Math.max(0, now - viewer.lastTime);
        viewer.lastTime = now;
        viewer.elapsed += delta * viewer.speed;
        if (!viewer.loop && viewer.elapsed >= viewer.duration) {
            viewer.elapsed = viewer.duration;
            drawViewer(viewer.elapsed);
            stopViewer();
            viewer.playing = false;
            $('#animPlay').textContent = 'Play';
            return;
        }
        drawViewer(viewer.elapsed);
        viewer.raf = requestAnimationFrame(tick);
    };
    viewer.raf = requestAnimationFrame(tick);
}

function stopViewer() {
    if (state.viewer.raf) cancelAnimationFrame(state.viewer.raf);
    state.viewer.raf = 0;
}

function drawViewer(elapsed) {
    const viewer = state.viewer;
    if (!['design', 'clip'].includes(viewer.mode)) return;
    const duration = Math.max(1, viewer.duration);
    const t = viewer.loop ? elapsed % duration : Math.min(elapsed, duration);
    for (const node of viewer.nodes) {
        if (viewer.hidden.has(node.layer.id)) {
            node.el.style.display = 'none';
            continue;
        }
        node.el.style.display = '';
        if (viewer.mode === 'design' && !windowVisible(node.layer.window, t)) {
            node.el.style.display = 'none';
            continue;
        }
        const values = viewer.mode === 'design'
            ? transformForTracks(node.tracks, t)
            : interpolateFrames(viewer.clip?.frames || [], t);
        applyViewerTransform(node, values);
    }
    setText('#animTime', `${(t / 1000).toFixed(1)}s / ${(duration / 1000).toFixed(1)}s`);
    $('#animScrub').value = String(Math.round((t / duration) * 1000));
}

function applyViewerTransform(node, values) {
    const viewer = state.viewer;
    const box = viewer.bbox || { x: 0, y: 0, w: 100, h: 100 };
    const tx = (values.dx || 0) * viewer.innerW * (100 / (box.w || 100));
    const ty = (values.dy || 0) * viewer.innerH * (100 / (box.h || 100));
    const scaleX = (values.sx ?? 1) * (values.s ?? 1);
    const scaleY = (values.sy ?? 1) * (values.s ?? 1);
    const rotation = values.rot || 0;
    const baseOpacity = node.layer.opacity ?? 1;
    node.el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scaleX}, ${scaleY}) rotate(${rotation}deg)`;
    node.el.style.opacity = String(Math.max(0, Math.min(1, baseOpacity * (values.a ?? 1))));
}

function windowVisible(windows, t) {
    if (!Array.isArray(windows) || !windows.length) return true;
    return windows.some((window) => {
        if (!Array.isArray(window)) return true;
        const start = Number(window[0]) || 0;
        const end = window[1] == null ? Infinity : Number(window[1]);
        return t >= start && t < end;
    });
}

function transformForTracks(tracks, t) {
    const base = { dx: 0, dy: 0, sx: 1, sy: 1, s: 1, rot: 0, a: 1 };
    let selected = null;
    let selectedStart = -Infinity;
    for (const track of tracks) {
        const active = activeSegment(track, t);
        if (!active) continue;
        const start = Number(active.segment.start) || 0;
        if (start >= selectedStart) {
            selected = active;
            selectedStart = start;
        }
    }
    if (!selected) return base;
    return interpolateFrames(selected.segment.frames, selected.local);
}

function activeSegment(track, t) {
    const segments = track.segments || [];
    if (!segments.length || t < (Number(segments[0].start) || 0)) return null;
    let active = null;
    for (const segment of segments) {
        if ((Number(segment.start) || 0) <= t) active = segment;
        else break;
    }
    if (!active) return null;
    let local = t - (Number(active.start) || 0);
    const duration = Number(active.duration) || 0;
    if (active.loop && duration > 0) local %= duration;
    if (duration > 0 && local > duration) local = duration;
    return { segment: active, local };
}

function interpolateFrames(frames, local) {
    const base = { dx: 0, dy: 0, sx: 1, sy: 1, s: 1, rot: 0, a: 1 };
    if (!Array.isArray(frames) || !frames.length) return base;
    if (local <= (Number(frames[0].t) || 0)) return frameNumbers(frames[0]);
    if (local >= (Number(frames[frames.length - 1].t) || 0)) return frameNumbers(frames[frames.length - 1]);
    for (let index = 0; index < frames.length - 1; index += 1) {
        const from = frames[index];
        const to = frames[index + 1];
        const start = Number(from.t) || 0;
        const end = Number(to.t) || 0;
        if (local <= end) {
            const span = end - start || 1;
            const unit = easeValue(to.e, Math.max(0, Math.min(1, (local - start) / span)));
            const a = frameNumbers(from);
            const b = frameNumbers(to);
            return {
                dx: a.dx + (b.dx - a.dx) * unit,
                dy: a.dy + (b.dy - a.dy) * unit,
                sx: a.sx + (b.sx - a.sx) * unit,
                sy: a.sy + (b.sy - a.sy) * unit,
                s: a.s + (b.s - a.s) * unit,
                rot: a.rot + (b.rot - a.rot) * unit,
                a: a.a + (b.a - a.a) * unit,
            };
        }
    }
    return frameNumbers(frames[frames.length - 1]);
}

function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function frameNumbers(frame) {
    return {
        dx: finite(frame.dx, 0),
        dy: finite(frame.dy, 0),
        sx: frame.sx == null ? 1 : finite(frame.sx, 1),
        sy: frame.sy == null ? 1 : finite(frame.sy, 1),
        s: frame.s == null ? 1 : finite(frame.s, 1),
        rot: finite(frame.r ?? frame.rot, 0),
        a: frame.a == null ? 1 : finite(frame.a, 1),
    };
}

function easeValue(name, unit) {
    if (name === 'in') return unit * unit;
    if (name === 'out') return 1 - (1 - unit) * (1 - unit);
    if (name === 'inOut') return unit * unit * (3 - 2 * unit);
    return unit;
}

function renderViewerTracks(rows) {
    const container = $('#animTrackList');
    if (!rows.length) {
        container.innerHTML = '<p class="seg-muted">No animated layers.</p>';
        return;
    }
    container.innerHTML = rows.map((row) => `
        <label class="seg-member">
            <input type="checkbox" data-viewer-layer="${esc(row.id)}" checked>
            <span class="seg-member-name">
                <strong title="${esc(row.name)}">${esc(row.name)}</strong>
                <small>${esc(row.meta || '')}</small>
            </span>
            <span class="seg-member-box">${esc(row.id)}</span>
        </label>`).join('');
    for (const input of $$('input[data-viewer-layer]', container)) {
        input.addEventListener('change', () => {
            const id = input.dataset.viewerLayer;
            if (input.checked) state.viewer.hidden.delete(id);
            else state.viewer.hidden.add(id);
            const node = state.viewer.nodes.find((entry) => entry.layer.id === id);
            if (node) node.el.style.display = input.checked ? '' : 'none';
        });
    }
}

function setViewerPlaying(playing) {
    const viewer = state.viewer;
    if (viewer.video) {
        const video = $('#animVideo');
        if (playing) video.play().catch(() => {});
        else video.pause();
        viewer.playing = playing;
        $('#animPlay').textContent = playing ? 'Pause' : 'Play';
        return;
    }
    if (playing) startViewer();
    else {
        stopViewer();
        viewer.playing = false;
        $('#animPlay').textContent = 'Play';
    }
}

/* ── wiring ─────────────────────────────────────────────────────────── */

function wireTabs() {
    $$('.seg-tab').forEach((tab) => {
        tab.addEventListener('click', () => setView(tab.dataset.view));
    });
}

function setView(view) {
    state.view = view;
    renderTabs();
    if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
    if (view === 'groups') renderGroups();
    if (view === 'library') renderLibrary();
    if (view === 'animations') renderAnimations();
}

function wireFilters() {
    const applyGroups = () => {
        state.filters.q = $('#groupSearch').value;
        state.filters.category = $('#groupCategory').value;
        state.filters.origin = $('#groupOrigin').value;
        state.filters.motion = $('#groupMotion').value;
        state.filters.project = $('#groupProject').value;
        state.filters.sort = $('#groupSort').value;
        state.filters.hasPreview = $('#groupPreviewOnly').checked;
        state.groupPage = 90;
        renderGroups();
    };
    $('#groupSearch').addEventListener('input', debounce(applyGroups));
    ['#groupCategory', '#groupOrigin', '#groupMotion', '#groupProject', '#groupSort', '#groupPreviewOnly']
        .forEach((selector) => $(selector).addEventListener('change', applyGroups));
    $('#groupClear').addEventListener('click', () => {
        $('#groupSearch').value = '';
        $('#groupCategory').value = '';
        $('#groupOrigin').value = '';
        $('#groupMotion').value = '';
        $('#groupProject').value = '';
        $('#groupSort').value = 'category';
        $('#groupPreviewOnly').checked = false;
        applyGroups();
    });
    $('#groupMore').addEventListener('click', () => {
        state.groupPage += 90;
        renderGroups();
    });

    const applyLibrary = () => {
        state.libFilters.q = $('#libSearch').value;
        state.libFilters.brand = $('#libBrand').value;
        state.libFilters.status = $('#libStatus').value;
        renderLibrary();
    };
    $('#libSearch').addEventListener('input', debounce(applyLibrary));
    $('#libBrand').addEventListener('change', applyLibrary);
    $('#libStatus').addEventListener('change', applyLibrary);
    $('#libClear').addEventListener('click', () => {
        $('#libSearch').value = '';
        $('#libBrand').value = '';
        $('#libStatus').value = '';
        applyLibrary();
    });
    $('#libGrid').addEventListener('click', (event) => {
        const button = event.target.closest('[data-design-animations]');
        if (!button) return;
        const design = (state.library?.designs || []).find((item) => item.id === button.dataset.designAnimations);
        if (!design) return;
        state.animMode = 'library';
        $$('.seg-subtab').forEach((item) => item.classList.toggle('is-active', item.dataset.anim === 'library'));
        state.animFilters = { q: design.name, origin: '', status: '' };
        $('#animSearch').value = design.name;
        $('#animOrigin').value = '';
        $('#animStatus').value = '';
        state.animPage = 120;
        setView('animations');
    });

    const applyAnimations = () => {
        state.animFilters.q = $('#animSearch').value;
        state.animFilters.origin = $('#animOrigin').value;
        state.animFilters.status = $('#animStatus').value;
        state.animPage = 120;
        renderAnimations();
    };
    $('#animSearch').addEventListener('input', debounce(applyAnimations));
    $('#animOrigin').addEventListener('change', applyAnimations);
    $('#animStatus').addEventListener('change', applyAnimations);
    $('#animClear').addEventListener('click', () => {
        $('#animSearch').value = '';
        $('#animOrigin').value = '';
        $('#animStatus').value = '';
        applyAnimations();
    });
    $$('.seg-subtab').forEach((tab) => {
        tab.addEventListener('click', () => {
            const next = tab.dataset.anim;
            if (state.animMode !== next) {
                // The three lists have different vocabularies (design names,
                // clip effects, recipe labels); a leftover query usually hides
                // everything and looks broken.
                state.animFilters = { q: '', origin: '', status: '' };
                $('#animSearch').value = '';
                $('#animOrigin').value = '';
                $('#animStatus').value = '';
                state.animPage = 120;
            }
            state.animMode = next;
            $$('.seg-subtab').forEach((item) => item.classList.toggle('is-active', item === tab));
            renderAnimations();
        });
    });
    $('#animMore').addEventListener('click', () => {
        state.animPage += 120;
        renderAnimations();
    });
}

function wireDetail() {
    $('#detail').addEventListener('click', (event) => {
        if (event.target.closest('[data-close]')) closeDetail();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !$('#detail').hidden) closeDetail();
    });
    $('#previewToggle').addEventListener('click', () => {
        if (state.preview.playing) {
            state.preview.playing = false;
            stopPreview();
            $('#previewToggle').textContent = 'Play';
        } else {
            startPreview();
        }
    });
    $('#previewMotion').addEventListener('change', () => {
        state.preview.motionId = $('#previewMotion').value;
        state.preview.elapsed = 0;
        drawPreview(0);
    });
    $('#previewSpeed').addEventListener('change', () => {
        state.preview.speed = Number($('#previewSpeed').value) || 1;
    });
    $('#previewBackdrop').addEventListener('change', () => {
        $('#detailRef').classList.toggle('is-on', $('#previewBackdrop').checked);
    });
    $('#previewReset').addEventListener('click', () => {
        state.preview.hidden.clear();
        for (const input of $$('#detailMembers input[data-layer]')) {
            input.checked = input.disabled ? false : true;
        }
        for (const node of state.preview.nodes) node.el.classList.remove('is-hidden');
        $('#previewBackdrop').checked = false;
        $('#detailRef').classList.remove('is-on');
        $('#previewSpeed').value = '1';
        state.preview.speed = 1;
        state.preview.elapsed = 0;
        if (state.detail) showDetail(state.detail);
    });
    $('#copyAgent').addEventListener('click', async () => {
        const text = $('#detailAgent').textContent || '';
        try {
            await navigator.clipboard.writeText(text);
            $('#copyAgent').textContent = 'Copied';
            setTimeout(() => { $('#copyAgent').textContent = 'Copy JSON'; }, 1400);
        } catch {
            const range = document.createRange();
            range.selectNodeContents($('#detailAgent'));
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            $('#copyAgent').textContent = 'Selected';
        }
    });
}


function wireViewer() {
    $('#animViewer').addEventListener('click', (event) => {
        if (event.target.closest('[data-anim-close]')) closeViewer();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !$('#animViewer').hidden) closeViewer();
    });
    $('#animList').addEventListener('click', (event) => {
        const animationButton = event.target.closest('[data-view-animation]');
        if (animationButton) {
            const animation = libraryAnimations().find((item) => item.id === animationButton.dataset.viewAnimation
                && item.designId === animationButton.dataset.viewDesign);
            if (animation) openAnimationViewer(animation);
            return;
        }
        const clipButton = event.target.closest('[data-view-clip]');
        if (clipButton) {
            const clip = (state.clips?.clips || []).find((item) => item.id === clipButton.dataset.viewClip);
            if (clip) openClipViewer(clip);
            return;
        }
        const recipeButton = event.target.closest('[data-view-recipe]');
        if (recipeButton) previewRecipe(recipeButton.dataset.viewRecipe);
    });
    $('#animPlay').addEventListener('click', () => setViewerPlaying(!state.viewer.playing));
    $('#animRestart').addEventListener('click', () => {
        const viewer = state.viewer;
        if (viewer.video) {
            const video = $('#animVideo');
            video.currentTime = 0;
            video.play().catch(() => {});
            viewer.playing = true;
            $('#animPlay').textContent = 'Pause';
            return;
        }
        viewer.elapsed = 0;
        drawViewer(0);
        if (!viewer.playing) startViewer();
    });
    $('#animScrub').addEventListener('input', () => {
        const viewer = state.viewer;
        const value = Number($('#animScrub').value) || 0;
        if (viewer.video) {
            const video = $('#animVideo');
            if (Number.isFinite(video.duration)) video.currentTime = (value / 1000) * video.duration;
            return;
        }
        if (!viewer.duration) return;
        viewer.elapsed = (value / 1000) * viewer.duration;
        drawViewer(viewer.elapsed);
        if (viewer.playing) viewer.lastTime = performance.now();
    });
    $('#animSpeed').addEventListener('change', () => {
        const viewer = state.viewer;
        viewer.speed = Number($('#animSpeed').value) || 1;
        if (viewer.video) $('#animVideo').playbackRate = viewer.speed;
    });
    $('#animLoop').addEventListener('change', () => {
        state.viewer.loop = $('#animLoop').checked;
        if (state.viewer.video) $('#animVideo').loop = state.viewer.loop;
    });
    $('#animTargetGroup').addEventListener('change', () => {
        if (state.viewer.clip) openClipViewer(state.viewer.clip, $('#animTargetGroup').value);
    });
    $('#animVideo').addEventListener('loadedmetadata', () => {
        if (!state.viewer.video) return;
        const video = $('#animVideo');
        if (Number.isFinite(video.duration)) state.viewer.duration = video.duration * 1000;
        setText('#animTime', `0.0s / ${(state.viewer.duration / 1000).toFixed(1)}s`);
    });
    $('#animVideo').addEventListener('timeupdate', () => {
        if (!state.viewer.video) return;
        const video = $('#animVideo');
        const duration = Number.isFinite(video.duration) ? video.duration : state.viewer.duration / 1000;
        if (!duration) return;
        setText('#animTime', `${video.currentTime.toFixed(1)}s / ${duration.toFixed(1)}s`);
        $('#animScrub').value = String(Math.round((video.currentTime / duration) * 1000));
    });
    $('#animVideo').addEventListener('ended', () => {
        if (!state.viewer.video) return;
        if (!state.viewer.loop) {
            state.viewer.playing = false;
            $('#animPlay').textContent = 'Play';
        }
    });
    $('#animVideo').addEventListener('error', () => {
        if (!state.viewer.video) return;
        const animation = state.viewer.animation || {};
        const poster = animation.sourcePoster || animation.thumbnail || '';
        if (poster) {
            const video = $('#animVideo');
            video.hidden = true;
            video.pause();
            const image = $('#animPoster');
            image.src = poster;
            image.hidden = false;
        }
        setText('#animNote', 'The source recording could not be played; showing its poster instead.');
    });
}

function wireHelp() {
    $('#helpBtn').addEventListener('click', () => $('#helpDialog').showModal());
}

function applyHash() {
    const hash = location.hash.replace(/^#/, '');
    if (hash.startsWith('group=')) {
        const id = decodeURIComponent(hash.slice('group='.length));
        if (state.index) {
            state.view = 'groups';
            renderTabs();
            openGroup(id);
        }
        return;
    }
    if (hash === 'library' || hash === 'animations') {
        state.view = hash;
        renderTabs();
    }
}

window.addEventListener('hashchange', applyHash);

boot().catch((error) => {
    console.error(error);
    showSegmentError(error);
});
