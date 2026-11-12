'use strict';
/**
 * reviews.js — shared manual review marks for the four studio surfaces.
 *
 * One registry, four surfaces:
 *   afs · studio-agent · project-canvas · studio
 *
 * Each item is matched by any of its ids (designId, compositionId,
 * animationId, projectId, templateId), so the same composition opened in
 * Project Canvas and Studio shows the same mark as its AFS library design.
 *
 * API: GET /api/reviews; POST /api/reviews {ids, name, kind, surface, status, note}.
 * The module falls back to localStorage when the API is unavailable.
 */
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StudioReviews = api;
}(typeof globalThis !== 'undefined' ? globalThis : null, function (root) {
    const SURFACES = ['afs', 'studio-agent', 'project-canvas', 'studio'];
    const STATUSES = ['works', 'broken', 'review'];
    const STATUS_LABEL = {
        works: 'Works',
        broken: "Doesn't work",
        review: 'Needs review',
        unmarked: 'Unmarked',
    };
    const SURFACE_LABEL = {
        afs: 'AFS',
        'studio-agent': 'Studio Agent',
        'project-canvas': 'Project canvas',
        studio: 'Studio',
    };
    const ID_KEYS = ['designId', 'compositionId', 'animationId', 'projectId', 'templateId'];
    const LS_KEY = 'studio.reviews.v1';
    const listeners = new Set();
    let state = { schema: 'studio/reviews/1', items: [] };
    let loaded = false;
    let loading = null;

    const text = (value, max = 200) => String(value == null ? '' : value).trim().slice(0, max);
    const norm = (value) => String(value || '').toLowerCase();

    function cleanIds(ids) {
        if (!ids || typeof ids !== 'object') return {};
        const out = {};
        ID_KEYS.forEach((key) => {
            const value = text(ids[key], 160);
            if (value) out[key] = value;
        });
        return out;
    }

    function matches(item, ids) {
        if (!item || !item.ids) return false;
        return ID_KEYS.some((key) => ids[key] && norm(item.ids[key]) === norm(ids[key]));
    }

    function findItem(ids) {
        const wanted = cleanIds(ids);
        if (!Object.keys(wanted).length) return null;
        return (state.items || []).find((item) => matches(item, wanted)) || null;
    }

    function markFor(ids, surface) {
        const item = findItem(ids);
        return item && item.surfaces && item.surfaces[surface] ? item.surfaces[surface] : null;
    }

    function statusFor(ids, surface) {
        const mark = markFor(ids, surface);
        return mark && mark.status ? mark.status : null;
    }

    function noteFor(ids, surface) {
        const item = findItem(ids);
        if (!item) return '';
        return item.note || (surface && item.surfaces && item.surfaces[surface] && item.surfaces[surface].note) || '';
    }

    function surfaceSummary(ids) {
        const item = findItem(ids);
        const out = {};
        SURFACES.forEach((surface) => {
            out[surface] = item && item.surfaces && item.surfaces[surface]
                ? item.surfaces[surface].status
                : null;
        });
        return out;
    }

    function readLocal() {
        try {
            const raw = JSON.parse(root.localStorage.getItem(LS_KEY) || 'null');
            return raw && Array.isArray(raw.items) ? raw : null;
        } catch {
            return null;
        }
    }

    function writeLocal() {
        try { root.localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* private mode */ }
    }

    function merge(incoming) {
        const items = new Map();
        (state.items || []).forEach((item) => items.set(item.key || JSON.stringify(item.ids), item));
        (incoming.items || []).forEach((item) => {
            if (!item || !item.ids) return;
            const key = item.key || JSON.stringify(item.ids);
            const existing = items.get(key) || (state.items || []).find((candidate) => matches(candidate, item.ids));
            if (!existing) {
                items.set(key, item);
                return;
            }
            existing.ids = { ...existing.ids, ...item.ids };
            existing.surfaces = { ...existing.surfaces, ...item.surfaces };
            existing.name = item.name || existing.name;
            existing.kind = item.kind || existing.kind;
            existing.auto = item.auto || existing.auto;
            if (typeof item.note === 'string') existing.note = item.note;
            existing.updatedAt = item.updatedAt || existing.updatedAt;
            items.set(existing.key || key, existing);
        });
        state = { ...state, items: [...items.values()] };
    }

    async function load(force = false) {
        if (loaded && !force) return state;
        if (loading && !force) return loading;
        loading = (async () => {
            const local = readLocal();
            if (local) merge(local);
            try {
                const response = await fetch('/api/reviews', { cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const remote = await response.json();
                if (remote && Array.isArray(remote.items)) {
                    state = { schema: remote.schema || 'studio/reviews/1', items: remote.items };
                    merge(local || { items: [] });
                }
            } catch {
                // Offline or file://: keep the local marks.
            }
            loaded = true;
            writeLocal();
            emit({ type: 'load', state });
            return state;
        })();
        return loading;
    }

    function emit(detail) {
        listeners.forEach((listener) => {
            try { listener(detail); } catch { /* a listener must not break the UI */ }
        });
        if (root && typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
            root.dispatchEvent(new root.CustomEvent('studio-reviews:change', { detail }));
        }
    }

    function applyLocalMark(ids, surface, status, meta = {}) {
        const wanted = cleanIds(ids);
        let item = findItem(wanted);
        if (!item) {
            const primary = ID_KEYS.map((key) => wanted[key]).find(Boolean) || 'item';
            item = {
                key: `${meta.kind || 'design'}:${primary}`,
                name: text(meta.name, 200) || primary,
                kind: text(meta.kind, 40) || 'design',
                ids: wanted,
                auto: text(meta.auto, 40),
                note: '',
                surfaces: {},
                updatedAt: new Date().toISOString(),
            };
            state.items = [...state.items, item];
        }
        item.ids = { ...item.ids, ...wanted };
        if (meta.name) item.name = text(meta.name, 200);
        if (meta.kind) item.kind = text(meta.kind, 40);
        if (meta.auto) item.auto = text(meta.auto, 40);
        item.updatedAt = new Date().toISOString();
        if (status) item.surfaces[surface] = { status, note: text(meta.note, 500), updatedAt: item.updatedAt };
        else delete item.surfaces[surface];
        writeLocal();
        return item;
    }

    function applyLocalNote(ids, note, meta = {}) {
        const wanted = cleanIds(ids);
        let item = findItem(wanted);
        if (!item) {
            const primary = ID_KEYS.map((key) => wanted[key]).find(Boolean) || 'item';
            item = {
                key: `${meta.kind || 'design'}:${primary}`,
                name: text(meta.name, 200) || primary,
                kind: text(meta.kind, 40) || 'design',
                ids: wanted,
                auto: text(meta.auto, 40),
                note: '',
                surfaces: {},
                updatedAt: new Date().toISOString(),
            };
            state.items = [...state.items, item];
        }
        item.ids = { ...item.ids, ...wanted };
        if (meta.name) item.name = text(meta.name, 200);
        item.note = text(note, 500);
        item.updatedAt = new Date().toISOString();
        writeLocal();
        return item;
    }

    async function setNote(ids, note, meta = {}) {
        const wanted = cleanIds(ids);
        if (!Object.keys(wanted).length) throw new Error('A note needs an id.');
        applyLocalNote(wanted, note, meta);
        emit({ type: 'update', ids: wanted, source: 'local' });
        try {
            const response = await fetch('/api/reviews', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'note',
                    ids: wanted,
                    name: text(meta.name, 200),
                    kind: text(meta.kind, 40) || 'design',
                    note: text(note, 500),
                    auto: text(meta.auto, 40),
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
            if (payload.state && Array.isArray(payload.state.items)) {
                state = { schema: payload.state.schema || 'studio/reviews/1', items: payload.state.items };
                writeLocal();
                emit({ type: 'update', ids: wanted, source: 'server' });
            }
        } catch (error) {
            emit({ type: 'error', error: error.message, ids: wanted });
        }
        return noteFor(wanted);
    }

    async function setMark(ids, surface, status, meta = {}) {
        if (!SURFACES.includes(surface)) throw new Error(`Unknown surface: ${surface}`);
        const wanted = cleanIds(ids);
        if (!Object.keys(wanted).length) throw new Error('A review mark needs an id.');
        const value = STATUSES.includes(status) ? status : null;
        applyLocalMark(wanted, surface, value, meta);
        emit({ type: 'update', ids: wanted, surface, status: value, source: 'local' });
        try {
            const response = await fetch('/api/reviews', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ids: wanted,
                    name: text(meta.name, 200),
                    kind: text(meta.kind, 40) || 'design',
                    surface,
                    status: value || 'unmarked',
                    note: text(meta.note, 500),
                    auto: text(meta.auto, 40),
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
            if (payload.state && Array.isArray(payload.state.items)) {
                state = { schema: payload.state.schema || 'studio/reviews/1', items: payload.state.items };
                writeLocal();
                emit({ type: 'update', ids: wanted, surface, status: value, source: 'server', item: payload.item });
            }
        } catch (error) {
            emit({ type: 'error', error: error.message, ids: wanted, surface, status: value });
        }
        return statusFor(wanted, surface);
    }

    function labelFor(status, auto) {
        if (status) return STATUS_LABEL[status] || status;
        if (auto) return `Auto: ${auto}`;
        return 'Unmarked';
    }

    function statusClass(status, auto) {
        if (status) return status;
        if (!auto) return 'unmarked';
        const lower = String(auto).toLowerCase();
        if (lower === 'ready' || lower === 'playable' || lower === 'ok') return 'auto-ok';
        if (lower === 'review' || lower === 'warn') return 'auto-review';
        if (lower === 'blocked' || lower === 'broken') return 'auto-broken';
        return 'auto';
    }

    function ensureStyles() {
        if (!root || !root.document || root.document.getElementById('studio-reviews-css')) return;
        const style = root.document.createElement('style');
        style.id = 'studio-reviews-css';
        style.textContent = `
.srv{--srv-ok:#2f9e6f;--srv-bad:#d64545;--srv-warn:#c98a1b;--srv-line:currentColor;display:inline-flex;align-items:center;gap:5px;font:inherit;line-height:1.2}
.srv *{box-sizing:border-box}
.srv-badge{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:20px;border:1px solid currentColor;font-size:10px;font-weight:600;letter-spacing:.02em;opacity:.9;white-space:nowrap}
.srv-badge.works{color:var(--srv-ok);background:color-mix(in srgb,var(--srv-ok) 14%,transparent)}
.srv-badge.broken{color:var(--srv-bad);background:color-mix(in srgb,var(--srv-bad) 14%,transparent)}
.srv-badge.review,.srv-badge.auto-review{color:var(--srv-warn);background:color-mix(in srgb,var(--srv-warn) 14%,transparent)}
.srv-badge.auto-ok{color:var(--srv-ok)}
.srv-badge.auto-broken{color:var(--srv-bad)}
.srv-badge.auto,.srv-badge.unmarked{opacity:.55;font-weight:500}
.srv-control{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:5px 6px;border:1px solid rgba(128,128,128,.28);border-radius:7px}
.srv-label{font-size:10px;font-weight:600;letter-spacing:.03em;opacity:.65;text-transform:uppercase}
.srv-btns{display:inline-flex;gap:3px}
.srv-btn{font:inherit;font-size:10px;padding:2px 6px;border-radius:5px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;cursor:pointer;opacity:.8}
.srv-btn:hover{opacity:1;border-color:currentColor}
.srv-btn.is-on{font-weight:700;opacity:1}
.srv-btn[data-status=works].is-on{color:var(--srv-ok);border-color:var(--srv-ok);background:color-mix(in srgb,var(--srv-ok) 14%,transparent)}
.srv-btn[data-status=broken].is-on{color:var(--srv-bad);border-color:var(--srv-bad);background:color-mix(in srgb,var(--srv-bad) 14%,transparent)}
.srv-btn[data-status=review].is-on{color:var(--srv-warn);border-color:var(--srv-warn);background:color-mix(in srgb,var(--srv-warn) 14%,transparent)}
.srv-clear{padding:2px 5px}
.srv-note{flex:1 1 100%;display:none;gap:4px;align-items:center}
.srv.is-noting .srv-note{display:flex}
.srv-note input{flex:1;min-width:60px;font:inherit;font-size:10px;padding:2px 5px;border-radius:5px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit}
.srv-hint{font-size:9px;opacity:.55}
.srv-all{flex:1 1 100%;display:flex;flex-wrap:wrap;gap:6px;font-size:9px;opacity:.7}
.srv-all span{display:inline-flex;gap:3px;align-items:center}
.srv-all b{font-weight:700}
@media (max-width:700px){.srv-label{display:none}}
`;
        root.document.head.appendChild(style);
    }

    function control(options = {}) {
        ensureStyles();
        const surface = options.surface;
        const ids = cleanIds(options.ids);
        const host = root.document.createElement('div');
        host.className = 'srv srv-control';
        host.addEventListener('click', (event) => event.stopPropagation());
        host.addEventListener('pointerdown', (event) => event.stopPropagation());

        const render = () => {
            const mark = markFor(ids, surface);
            const status = mark && mark.status;
            host.replaceChildren();
            const label = root.document.createElement('span');
            label.className = 'srv-label';
            label.textContent = options.label || `Review · ${SURFACE_LABEL[surface] || surface}`;
            label.title = options.auto ? `Automatic status: ${options.auto}` : 'Manual review mark for this surface';
            const buttons = root.document.createElement('span');
            buttons.className = 'srv-btns';
            [
                ['works', '✓ Works', 'Works in this surface'],
                ['broken', "✕ Doesn't", "Doesn't work in this surface"],
                ['review', '? Review', 'Needs review in this surface'],
            ].forEach(([value, caption, title]) => {
                const button = root.document.createElement('button');
                button.type = 'button';
                button.className = `srv-btn${status === value ? ' is-on' : ''}`;
                button.dataset.status = value;
                button.textContent = caption;
                button.title = title;
                button.setAttribute('aria-pressed', String(status === value));
                button.addEventListener('click', async () => {
                    await setMark(ids, surface, status === value ? null : value, options);
                    render();
                });
                buttons.appendChild(button);
            });
            const clear = root.document.createElement('button');
            clear.type = 'button';
            clear.className = 'srv-btn srv-clear';
            clear.textContent = '×';
            clear.title = 'Clear this surface mark';
            clear.disabled = !status;
            clear.addEventListener('click', async () => {
                await setMark(ids, surface, null, options);
                render();
            });
            buttons.appendChild(clear);
            const note = root.document.createElement('button');
            note.type = 'button';
            note.className = 'srv-btn srv-clear';
            note.textContent = '✎';
            const existingNote = noteFor(ids, surface);
            note.title = existingNote ? `Note: ${existingNote}` : 'Add a note';
            note.addEventListener('click', () => host.classList.toggle('is-noting'));
            host.append(label, buttons, note);
            const noteRow = root.document.createElement('div');
            noteRow.className = 'srv-note';
            const input = root.document.createElement('input');
            input.type = 'text';
            input.value = existingNote;
            input.placeholder = 'Why? (optional)';
            input.setAttribute('aria-label', 'Review note');
            const save = root.document.createElement('button');
            save.type = 'button';
            save.className = 'srv-btn';
            save.textContent = 'Save';
            const commit = async () => {
                await setNote(ids, input.value, { ...options, surface });
                render();
            };
            save.addEventListener('click', commit);
            input.addEventListener('keydown', (event) => { if (event.key === 'Enter') commit(); });
            noteRow.append(input, save);
            host.appendChild(noteRow);
            if (options.summary !== false) {
                const all = surfaceSummary(ids);
                const row = root.document.createElement('div');
                row.className = 'srv-all';
                SURFACES.filter((item) => item !== surface).forEach((item) => {
                    const line = root.document.createElement('span');
                    const status = all[item];
                    line.textContent = `${SURFACE_LABEL[item]}: ${status ? STATUS_LABEL[status] : '—'}`;
                    line.className = `srv-all-${item}${status ? ` is-${status}` : ''}`;
                    row.appendChild(line);
                });
                host.appendChild(row);
            }
        };

        render();
        const unsubscribe = subscribe((event) => {
            if (event && (event.type === 'update' || event.type === 'load')) render();
        });
        host.addEventListener('DOMNodeRemovedFromDocument', unsubscribe);
        return host;
    }

    function badge(options = {}) {
        ensureStyles();
        const ids = cleanIds(options.ids);
        const status = statusFor(ids, options.surface);
        const element = root.document.createElement('span');
        element.className = `srv-badge ${statusClass(status, options.auto)}`;
        element.textContent = labelFor(status, options.auto);
        element.dataset.status = status || (options.auto ? `auto:${options.auto}` : 'unmarked');
        if (options.title) element.title = options.title;
        return element;
    }

    function filterMatch(ids, surface, filter = 'all') {
        if (!filter || filter === 'all') return true;
        const status = statusFor(ids, surface);
        if (filter === 'marked') return Boolean(status);
        if (filter === 'unmarked') return !status;
        return status === filter;
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function snapshot() {
        return state;
    }

    return {
        SURFACES,
        SURFACE_LABEL,
        STATUSES,
        STATUS_LABEL,
        load,
        setMark,
        markFor,
        statusFor,
        noteFor,
        setNote,
        surfaceSummary,
        findItem,
        control,
        badge,
        filterMatch,
        subscribe,
        snapshot,
    };
}));
