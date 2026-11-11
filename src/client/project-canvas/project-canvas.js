'use strict';

/* Project canvas: open one real project composition, play its keyframes, select
   whole images / semantic groups / single parts, and let the scene agent write
   timeline edits to a working variant. No framework, no build step. */
(() => {
    const Manifest = window.ProjectManifest;
    const Timeline = window.ProjectTimeline;
    const $ = (selector, scope = document) => scope.querySelector(selector);
    const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
    const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
    const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
    const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
    const shortLabel = (label) => String(label || '').split(' / ').pop();
    const safeColor = (value, fallback = '#ffffff') => {
        const text = String(value || '').trim();
        if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) return text;
        if (/^rgba?\(\s*\d{1,3}(?:\s*,\s*\d{1,3}){2}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(text)) return text;
        return fallback;
    };

    const state = {
        projects: [],
        projectId: null,
        project: null,
        orig: null,
        index: null,
        comp: null,
        manifest: null,
        mode: 'original',
        selection: new Set(),
        time: 0,
        playing: false,
        speed: 1,
        loop: true,
        history: [],
        messages: [],
        busy: false,
        elements: new Map(),
        stageWidth: 0,
        stageHeight: 0,
        textBasis: 'height',
        providerId: '',
        providerAvailable: null,
        agentNote: '',
        strokes: [],
        annotating: false,
        drawing: null,
        windowFrom: 0,
        windowTo: 0,
        windowTouched: false,
        fonts: new Set(),
    };

    if (!Manifest || !Timeline) {
        const log = document.querySelector('#log');
        if (log) {
            log.textContent = 'The project manifest modules did not load. Reload the page; if it persists, check /src/shared/project-manifest.js and /src/shared/project-timeline.js.';
        }
        return;
    }

    /* ── small helpers ───────────────────────────────────────────── */

    async function api(url, options = {}) {
        const response = await fetch(url, {
            headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
            ...options,
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error((data && data.error) || `${response.status} ${response.statusText}`);
        return data;
    }

    function status(text, isError = false) {
        const node = $('#status');
        if (!node) return;
        node.textContent = text;
        node.classList.toggle('is-error', Boolean(isError));
    }

    function say(text, kind = '') {
        const log = $('#log');
        if (!log) return null;
        const node = document.createElement('div');
        node.className = `pcan-msg${kind ? ` ${kind}` : ''}`;
        node.textContent = String(text ?? '');
        log.append(node);
        log.scrollTop = log.scrollHeight;
        return node;
    }

    function isVariantLayer(layer) {
        return Boolean(layer && (layer.generated || layer.uploaded || (layer.meta && (layer.meta.generated || layer.meta.uploaded))));
    }

    function variantLayers() {
        return state.comp ? state.comp.layers.filter(isVariantLayer) : [];
    }

    function strokeLength(points) {
        let total = 0;
        for (let index = 1; index < points.length; index += 1) {
            total += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
        }
        return total;
    }

    function pointOnStage(event) {
        const rect = $('#stage').getBoundingClientRect();
        return [
            Math.round(clamp((event.clientX - rect.left) / rect.width * 100, 0, 100) * 100) / 100,
            Math.round(clamp((event.clientY - rect.top) / rect.height * 100, 0, 100) * 100) / 100,
        ];
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('The image could not be read.'));
            reader.readAsDataURL(file);
        });
    }

    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('That image format is not supported by the browser.'));
            image.src = url;
        });
    }

    async function imageSize(url) {
        const image = await loadImage(url);
        return { w: image.naturalWidth, h: image.naturalHeight };
    }

    async function shrinkImage(url, size, max = 1600) {
        if (Math.max(size.w, size.h) <= max) return url;
        const ratio = max / Math.max(size.w, size.h);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(size.w * ratio));
        canvas.height = Math.max(1, Math.round(size.h * ratio));
        const context = canvas.getContext('2d');
        if (!context) return url;
        const image = await loadImage(url);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const webp = canvas.toDataURL('image/webp', 0.9);
        return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
    }

    function selectionSpans() {
        if (!state.manifest) return [];
        return Manifest.resolve(state.manifest, [...state.selection])
            .flatMap((entry) => entry.ids)
            .map((id) => state.manifest._by.get(id))
            .filter(Boolean)
            .flatMap((entity) => entity.live || []);
    }

    function windowText(entities) {
        const spans = (entities || []).flatMap((entity) => (entity && entity.live) || []);
        if (!spans.length) return 'whole timeline';
        const from = Math.min(...spans.map((span) => span[0]));
        const to = Math.max(...spans.map((span) => span[1]));
        return `${(from / 1000).toFixed(2)}–${(to / 1000).toFixed(2)}s`;
    }

    /* ── boot ────────────────────────────────────────────────────── */

    async function boot() {
        wire();
        loadProvider();
        requestAnimationFrame(tick);
        $('#projectSelect').innerHTML = '<option>Loading projects…</option>';
        try {
            const data = await api('/api/project-canvas/projects');
            state.projects = Array.isArray(data.projects) ? data.projects : [];
            if (!state.projects.length) {
                status('No project with a composition was found under data/projects.', true);
                $('#projectSelect').innerHTML = '<option>No projects</option>';
                return;
            }
            renderProjectOptions();
            const query = new URLSearchParams(location.search);
            const wanted = query.get('project') || storedProject();
            const pick = data.projects.find((item) => item.id === wanted) || data.projects[0];
            await openProject(pick.id, query.get('composition') || undefined);
            if (wanted && pick.id !== wanted) say(`“${wanted}” is not an openable project, so “${pick.name}” was opened instead.`, 'is-warn');
        } catch (error) {
            status(`Could not list projects: ${error.message}`, true);
            say(`The project list is unavailable: ${error.message}`, 'is-warn');
        }
    }

    function storedProject() {
        try { return localStorage.getItem('projectCanvas.project') || ''; } catch { return ''; }
    }

    function rememberProject(id) {
        try { localStorage.setItem('projectCanvas.project', id); } catch { /* private mode */ }
    }

    function renderProjectOptions() {
        const select = $('#projectSelect');
        select.innerHTML = state.projects.map((project) => `<option value="${escape(project.id)}">${escape(project.name)} · ${project.width}×${project.height}</option>`).join('');
        if (state.projectId) select.value = state.projectId;
    }

    async function loadProvider() {
        const badge = $('#provider');
        try {
            const catalog = await api('/api/agent-canvas/providers');
            const provider = (catalog.providers || []).find((entry) => entry.id === catalog.defaultProvider);
            state.providerId = catalog.defaultProvider || '';
            badge.classList.remove('is-ready', 'is-offline');
            state.providerAvailable = Boolean(provider && provider.available);
            state.agentNote = '';
            if (provider && provider.available) {
                badge.textContent = `Agent · ${provider.label}${provider.model ? ` ${provider.model}` : ''}`;
                badge.classList.add('is-ready');
            } else {
                badge.textContent = 'Agent offline';
                badge.classList.add('is-offline');
                state.agentNote = `The scene agent is offline (${(provider && provider.error) || 'no provider is configured'}). The canvas, selection, playback and export all still work; start the ${catalog.defaultProvider === 'deepseek' ? 'DeepSeek configuration' : 'local Ollama model'} to chat.`;
                if (state.comp) say(state.agentNote, 'is-note');
            }
        } catch (error) {
            badge.textContent = 'Agent unavailable';
            badge.classList.add('is-offline');
            state.providerAvailable = false;
            state.agentNote = `Could not read the agent providers: ${error.message}. The canvas still works.`;
            if (state.comp) say(state.agentNote, 'is-note');
        }
    }

    async function openProject(projectId, compositionId) {
        if (!projectId) return;
        status('Loading the composition…');
        setPlaying(false);
        const query = compositionId ? `?composition=${encodeURIComponent(compositionId)}` : '';
        try {
            const data = await api(`/api/project-canvas/project/${encodeURIComponent(projectId)}${query}`);
            state.projectId = data.project.id;
            state.project = data.project;
            state.orig = data.composition;
            const sourceLink = $('#sourceVideo');
            const sourceVideo = data.composition && data.composition.meta && data.composition.meta.sourceVideo;
            if (sourceLink) {
                sourceLink.hidden = !sourceVideo;
                sourceLink.href = sourceVideo || '#';
            }
            const editLink = $('#editStudio');
            if (editLink) editLink.href = `/studio.html?project=${encodeURIComponent(projectId)}&composition=${encodeURIComponent(data.project.compositionId)}`;
            state.index = data.index || null;
            state.mode = 'original';
            state.comp = Manifest.start(state.orig, 'original');
            state.selection.clear();
            state.messages = [];
            state.history = [];
            state.strokes = [];
            state.annotating = false;
            state.drawing = null;
            state.windowTouched = false;
            state.windowFrom = 0;
            state.windowTo = Number(data.project.duration) || 0;
            state.time = 0;
            $('#log').innerHTML = '';
            rememberProject(state.project.id);
            $('#projectSelect').value = state.project.id;
            renderCompositionOptions();
            syncModeButtons();
            loadFonts(state.orig);
            rebuild();
            updateAnnotationUi();
            applyDefaultWindow();
            setPlaying(true);
            const counts = Manifest.summary(state.manifest);
            say(`Opened “${data.project.name}” — ${data.project.width}×${data.project.height}, ${(data.project.duration / 1000).toFixed(1)}s, ${counts.layers} layers: ${counts.sources} segmented image sources, ${counts.texts} text layers and ${counts.unsegmented} single images. The original animation plays underneath your edits; switch to Blank to keep every element as a static asset.`, 'is-agent');
            say('Select a group or part on the canvas or in the panel, then describe the change. Alt-click picks one part; Shift-click adds to the selection.', 'is-note');
            if (state.providerAvailable === false && state.agentNote) say(state.agentNote, 'is-note');
            updateSuggestions();
            status(`${data.project.name} · ${data.project.width}×${data.project.height} · ${(data.project.duration / 1000).toFixed(1)}s · ${counts.layers} layers loaded.`);
        } catch (error) {
            status(`Could not open the project: ${error.message}`, true);
            say(`Could not open that project: ${error.message}`, 'is-warn');
            if (state.comp) setPlaying(true);
        }
    }

    function renderCompositionOptions() {
        const field = $('#compositionField');
        const select = $('#compositionSelect');
        const list = (state.project && Array.isArray(state.project.compositions)) ? state.project.compositions : [];
        if (list.length > 1) {
            field.hidden = false;
            select.innerHTML = list.map((id) => {
                const label = id.endsWith('.editable')
                    ? `${id.replace(/\.editable$/, '')} — Editable layers`
                    : `${id} — Exact poster`;
                return `<option value="${escape(id)}">${escape(label)}</option>`;
            }).join('');
            select.value = state.project.compositionId;
        } else {
            field.hidden = true;
            select.innerHTML = '';
        }
    }

    function loadFonts(composition) {
        const families = new Set((composition.layers || [])
            .filter((layer) => layer.type === 'text' && layer.font && layer.font.family)
            .map((layer) => layer.font.family));
        for (const family of families) {
            const id = `pcan-font-${family.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
            if (state.fonts.has(family) || document.getElementById(id)) continue;
            state.fonts.add(family);
            const link = document.createElement('link');
            link.id = id;
            link.rel = 'stylesheet';
            link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`;
            document.head.append(link);
            if (document.fonts && document.fonts.load) document.fonts.load(`400 20px "${family}"`).catch(() => {});
        }
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fit()).catch(() => {});
    }

    /* ── render: stage, panel, notes ─────────────────────────────── */

    function rebuild() {
        if (!state.comp) return;
        state.manifest = Manifest.build(state.comp, state.index);
        state.textBasis = state.manifest.textBasis || 'height';
        renderStage();
        renderPanel();
        markSelection();
        const canvas = state.manifest.canvas;
        const texts = state.manifest.entities.filter((entity) => entity.text).length;
        $('#projectMeta').textContent = `${canvas.w}×${canvas.h} · ${(state.manifest.durationMs / 1000).toFixed(1)}s · ${state.manifest.entities.length} layers · ${state.manifest.groups.length} groups`;
        $('#stageInfo').textContent = `${state.manifest.parents.length} image sources · ${state.manifest.groups.length} semantic groups · ${texts} text layers · ${state.manifest.events.length} events`;
        $('#downloadBtn').disabled = false;
        fit();
        drawAnnotations();
        updateAnnotationUi();
    }

    function renderStage() {
        const stage = $('#stage');
        stage.innerHTML = '';
        state.elements.clear();
        const layers = state.comp.layers.filter((layer) => layer.id !== 'reference'
            && layer.visible !== false
            && (layer.type === 'text' ? Boolean(layer.text) : Boolean(layer.url)));
        for (const layer of layers) {
            const element = document.createElement('div');
            element.className = `pcan-layer${layer.type === 'text' ? ' is-text' : ''}`;
            element.dataset.id = layer.id;
            element.style.zIndex = String(Math.round((Number(layer.z) || 0) * 1000));
            if (layer.type === 'text') {
                element.textContent = layer.text;
                element.style.color = safeColor(layer.color);
                element.style.justifyContent = layer.align === 'center' ? 'center' : layer.align === 'right' ? 'flex-end' : 'flex-start';
                element.style.textAlign = layer.align || 'left';
                if (layer.font) {
                    element.style.fontWeight = String(layer.font.weight || 400);
                    element.style.fontFamily = `"${layer.font.family}", ui-monospace, monospace`;
                    if (layer.font.letterSpacingEm) element.style.letterSpacing = `${layer.font.letterSpacingEm}em`;
                    if (layer.font.lineHeight) element.style.lineHeight = String(layer.font.lineHeight);
                    if (layer.font.transform && layer.font.transform !== 'none') element.style.textTransform = layer.font.transform;
                }
            } else {
                const image = new Image();
                image.src = layer.url;
                image.alt = '';
                image.draggable = false;
                image.loading = 'lazy';
                image.addEventListener('error', () => element.classList.add('is-missing'));
                element.append(image);
            }
            stage.append(element);
            state.elements.set(layer.id, element);
        }
        $('#stageEmpty').hidden = layers.length > 0;
        $('#stage').hidden = layers.length === 0;
    }

    function renderVariantList() {
        const layers = variantLayers();
        $('#variantSection').hidden = layers.length === 0;
        $('#variantCount').textContent = String(layers.length);
        $('#variantList').innerHTML = layers.map((layer) => {
            const kind = layer.uploaded ? 'uploaded image' : 'generated';
            return `<button class="pcan-row" type="button" data-select="${escape(layer.id)}" data-hay="${escape(`${layer.name} ${kind} ${layer.id}`.toLowerCase())}">
                <span class="pcan-row-main"><b>${escape(layer.name)}</b><small>${kind} · ${escape(layer.id)}</small></span>
            </button>`;
        }).join('');
    }

    function renderPanel() {
        const manifest = state.manifest;
        if (!manifest) return;
        const sources = manifest.parents.map((parent) => {
            const children = parent.children.map((id) => manifest._by.get(id)).filter(Boolean);
            const hay = [parent.name, parent.id, parent.scene].join(' ').toLowerCase();
            return `<button class="pcan-row" type="button" data-select="${escape(parent.id)}" data-hay="${escape(hay)}">
                <span class="pcan-row-main"><b>${escape(parent.name)}</b><small>${parent.children.length} parts · ${escape(windowText(children))}</small></span>
            </button>`;
        }).join('');
        const groups = manifest.groups.map((group) => {
            const members = group.members.map((id) => manifest._by.get(id)).filter(Boolean);
            const hay = [group.label, group.id, ...members.map((entity) => `${entity.label} ${entity.desc}`)].join(' ').toLowerCase();
            const parts = members.map((entity) => `<button class="pcan-chip" type="button" data-select="${escape(entity.id)}" data-hay="${escape(`${entity.label} ${entity.name}`.toLowerCase())}" title="${escape(entity.desc || entity.name)}">${escape(entity.label)}</button>`).join('');
            return `<div class="pcan-group" data-hay="${escape(hay)}">
                <button class="pcan-row" type="button" data-select="${escape(group.id)}">
                    <span class="pcan-row-main"><b>${escape(group.label)}</b><small>${group.members.length} parts · ${escape(windowText(members))}</small></span>
                </button>
                <details class="pcan-parts"><summary>${group.members.length} parts</summary><div class="pcan-chips">${parts}</div></details>
            </div>`;
        }).join('');
        const texts = manifest.entities.filter((entity) => entity.text).map((entity) => {
            const hay = `${entity.text} ${entity.label} ${entity.name} ${entity.id}`.toLowerCase();
            return `<button class="pcan-row" type="button" data-select="${escape(entity.id)}" data-hay="${escape(hay)}">
                <span class="pcan-swatch" style="background:${escape(safeColor(entity.color, '#9a94a4'))}"></span>
                <span class="pcan-row-main"><b>${escape(entity.text)}</b><small>${escape(entity.id)} · ${escape(windowText([entity]))}</small></span>
            </button>`;
        }).join('');
        $('#sourceList').innerHTML = sources || '<p class="pcan-selection-hint">No segmented image sources in this project.</p>';
        $('#groupList').innerHTML = groups || '<p class="pcan-selection-hint">No semantic groups in this project.</p>';
        $('#textList').innerHTML = texts || '<p class="pcan-selection-hint">No text layers in this project.</p>';
        $('#sourceCount').textContent = String(manifest.parents.length);
        $('#groupCount').textContent = String(manifest.groups.length);
        $('#textCount').textContent = String(manifest.entities.filter((entity) => entity.text).length);
        $('#notes').innerHTML = manifest.notes.map((note) => `<li>${escape(note)}</li>`).join('') || '<li>No caveats found in the files.</li>';
        renderVariantList();
        filterPanel();
    }

    function filterPanel() {
        const needle = $('#search').value.trim().toLowerCase();
        for (const node of $$('#panelBody [data-hay]')) {
            node.hidden = Boolean(needle) && !node.dataset.hay.includes(needle);
        }
        for (const group of $$('#groupList .pcan-group')) {
            const details = group.querySelector('.pcan-parts');
            if (details && needle) details.open = !group.hidden && group.dataset.hay.includes(needle);
        }
    }

    /* ── geometry: fit, text sizing, frame ───────────────────────── */

    function fit() {
        const shell = $('#stageShell');
        if (!state.comp || !shell) return;
        const availableWidth = Math.max(80, shell.clientWidth - 24);
        const availableHeight = Math.max(120, shell.clientHeight - 24);
        const scale = Math.min(availableWidth / state.comp.width, availableHeight / state.comp.height);
        const width = Math.max(80, Math.floor(state.comp.width * scale));
        const height = Math.max(80, Math.floor(state.comp.height * scale));
        state.stageWidth = width;
        state.stageHeight = height;
        const wrap = $('#canvasWrap');
        wrap.style.width = `${width}px`;
        wrap.style.height = `${height}px`;
        const stage = $('#stage');
        stage.style.width = '100%';
        stage.style.height = '100%';
        for (const [id, element] of state.elements) {
            const layer = state.comp.layers.find((entry) => entry.id === id);
            if (layer && layer.type === 'text') sizeText(element, layer);
        }
        drawAnnotations();
        frame();
    }

    function sizeText(element, layer) {
        const percent = Number(layer.font && layer.font.sizePct) || 3;
        const basis = state.textBasis === 'width' ? state.stageWidth : state.stageHeight;
        element.style.fontSize = `${Math.max(1, (percent / 100) * basis).toFixed(2)}px`;
        // The measured box height already says how many lines the source text took.
        // Single-line copy must not wrap (the box is sized for exactly one line).
        const fontPx = (percent / 100) * (state.textBasis === 'width' ? state.comp.width : state.comp.height);
        const lineHeight = (Number(layer.font && layer.font.lineHeight) || 1.2) * fontPx;
        const boxPx = (Number(layer.h) / 100) * state.comp.height;
        const lines = lineHeight > 0 ? boxPx / lineHeight : 1;
        element.style.whiteSpace = lines >= 1.5 ? 'pre-wrap' : 'nowrap';
    }

    function frame() {
        if (!state.comp) return;
        for (const layer of state.comp.layers) {
            const element = state.elements.get(layer.id);
            if (!element) continue;
            const pose = Timeline.pose(layer, state.time);
            element.style.left = `${pose.x}%`;
            element.style.top = `${pose.y}%`;
            element.style.width = `${pose.w}%`;
            element.style.height = `${pose.h}%`;
            element.style.transform = `rotate(${round(pose.rotation, 3)}deg)`;
            element.style.opacity = String(clamp(pose.opacity, 0, 1));
            element.style.pointerEvents = pose.opacity > 0.01 ? 'auto' : 'none';
            element.classList.toggle('is-hidden', pose.opacity <= 0.001);
        }
        const scrub = $('#scrub');
        const duration = Number(state.comp.duration) || 0;
        if (Number(scrub.max) !== duration) scrub.max = String(duration);
        scrub.value = String(Math.round(clamp(state.time, 0, duration)));
        $('#timeOut').textContent = `${(clamp(state.time, 0, duration) / 1000).toFixed(2)} / ${(duration / 1000).toFixed(2)} s`;
    }

    let lastFrame = 0;
    function tick(now) {
        const delta = lastFrame ? Math.min(120, now - lastFrame) : 0;
        lastFrame = now;
        if (state.playing && state.comp) {
            const duration = Number(state.comp.duration) || 0;
            state.time += delta * state.speed;
            if (duration && state.time >= duration) {
                if (state.loop) state.time %= duration;
                else { state.time = duration; setPlaying(false); }
            }
            frame();
        }
        requestAnimationFrame(tick);
    }

    function setPlaying(playing) {
        state.playing = Boolean(playing);
        const button = $('#playBtn');
        button.textContent = state.playing ? 'Pause' : 'Play';
        button.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    }

    function seek(ms) {
        if (!state.comp) return;
        state.time = clamp(ms, 0, Number(state.comp.duration) || 0);
        frame();
    }

    /* ── selection ───────────────────────────────────────────────── */

    function markSelection() {
        if (!state.manifest) return;
        for (const id of [...state.selection]) {
            if (!Manifest.resolve(state.manifest, [id]).length && !state.comp.layers.some((layer) => layer.id === id)) {
                state.selection.delete(id);
            }
        }
        const resolved = Manifest.resolve(state.manifest, [...state.selection]);
        const ids = new Set(resolved.flatMap((entry) => entry.ids));
        for (const [id, element] of state.elements) element.classList.toggle('is-selected', ids.has(id));
        for (const node of $$('#panelBody [data-select]')) node.classList.toggle('is-selected', state.selection.has(node.dataset.select));
        const chips = [...state.selection].map((id) => {
            const entry = Manifest.resolve(state.manifest, [id])[0];
            return entry ? { id, ...entry } : null;
        }).filter(Boolean);
        const host = $('#chips');
        if (!chips.length) {
            host.innerHTML = '<span class="pcan-selection-hint">Click a group, part or text layer — or click the canvas. Alt-click picks one part, Shift-click adds.</span>';
        } else {
            host.innerHTML = chips.map((entry) => `<span class="pcan-selchip"><span>${escape(entry.label)}${entry.ids.length > 1 ? ` · ${entry.ids.length}` : ''}</span><button type="button" data-unselect="${escape(entry.id)}" aria-label="Remove ${escape(entry.label)} from the selection">×</button></span>`).join('')
                + (chips.length > 1 ? '<button class="pcan-chip" type="button" data-clear>Clear all</button>' : '');
        }
        $('#selectionInfo').textContent = chips.length
            ? `Selected: ${chips.map((entry) => `${entry.label} (${entry.ids.length} layer${entry.ids.length === 1 ? '' : 's'})`).join(' · ')}`
            : 'Nothing selected';
        $('#chatMeta').textContent = chips.length
            ? `Working on ${chips.map((entry) => entry.label).join(', ')}. “He”, “it” and “this” mean the selection.`
            : 'Click a group or part, or describe it.';
        $('#useSelectionWindow').disabled = chips.length === 0;
        updateContext();
        applyDefaultWindow();
        updateSuggestions();
    }

    function selectId(id, additive = false) {
        if (additive) {
            if (state.selection.has(id)) state.selection.delete(id);
            else state.selection.add(id);
        } else {
            if (state.selection.size === 1 && state.selection.has(id)) state.selection.clear();
            else { state.selection.clear(); state.selection.add(id); }
        }
        markSelection();
    }

    function onPanelClick(event) {
        const target = event.target.closest('[data-select]');
        if (!target || !state.manifest) return;
        selectId(target.dataset.select, event.shiftKey || event.metaKey || event.ctrlKey);
    }

    function onStageClick(event) {
        if (!state.manifest || !state.comp) return;
        const stack = document.elementsFromPoint(event.clientX, event.clientY)
            .map((node) => (node && node.closest ? node.closest('.pcan-layer') : null))
            .filter(Boolean)
            .filter((element, index, list) => list.indexOf(element) === index);
        const visible = stack.filter((element) => {
            const entity = state.manifest._by.get(element.dataset.id);
            return entity && !element.classList.contains('is-hidden');
        });
        const pick = visible.find((element) => {
            const entity = state.manifest._by.get(element.dataset.id);
            return !(entity.box.w > 90 && entity.box.h > 90);
        }) || visible[0];
        if (!pick) {
            if (!event.shiftKey) { state.selection.clear(); markSelection(); }
            return;
        }
        const entity = state.manifest._by.get(pick.dataset.id);
        const key = event.altKey ? entity.id : (entity.groupId || entity.id);
        selectId(key, event.shiftKey || event.metaKey || event.ctrlKey);
    }

    /* ── context + suggestions ───────────────────────────────────── */

    function clientVariantText() {
        const layers = variantLayers();
        const lines = [];
        if (layers.length) {
            lines.push('CLIENT VARIANT — added in this browser (also sent with each request):');
            for (const layer of layers) {
                lines.push(`- ${layer.id} "${layer.name}" (${layer.uploaded ? 'uploaded image' : 'generated'}) box ${JSON.stringify({ x: layer.x, y: layer.y, w: layer.w, h: layer.h })}`);
            }
        }
        if (state.strokes.length) {
            lines.push(`USER ANNOTATIONS — ${state.strokes.length} drawing${state.strokes.length === 1 ? '' : 's'} on the stage, window ${(state.windowFrom / 1000).toFixed(2)}s→${(state.windowTo / 1000).toFixed(2)}s:`);
            state.strokes.forEach((stroke, index) => {
                const points = stroke.points;
                const first = points[0];
                const last = points[points.length - 1];
                lines.push(`- stroke ${index + 1}: ${points.length} points, ${strokeLength(points).toFixed(1)}% of the canvas long · (${first[0]},${first[1]}) → (${last[0]},${last[1]})`);
            });
            lines.push('(The server turns this route into suggested relative keyframes for the selection.)');
        }
        return lines.length ? `\n\n${lines.join('\n')}` : '';
    }

    function updateContext() {
        if (!state.manifest) return;
        const text = Manifest.context(state.manifest, { selection: [...state.selection], mode: state.mode })
            + clientVariantText();
        $('#contextText').value = text;
        $('#contextSize').textContent = `· ${(text.length / 1024).toFixed(1)} KB`;
    }

    function updateSuggestions() {
        const host = $('#suggestions');
        if (!state.manifest) { host.innerHTML = ''; return; }
        const prompts = [];
        const selected = [...state.selection].map((id) => Manifest.resolve(state.manifest, [id])[0]).filter(Boolean);
        if (state.strokes.length) {
            const label = selected.length ? shortLabel(selected[0].label) : 'the subject';
            prompts.push(`Make ${label} follow the drawn path`);
        }
        if (selected.length) {
            const first = selected[0];
            const name = shortLabel(first.label);
            prompts.push(`Move ${name} left to right over 3 seconds`);
            if (first.ids.length >= 3) prompts.push(`Make ${name} walk in place`);
            prompts.push(`What does ${name} do in the original animation?`);
        } else {
            const main = [...state.manifest.groups].sort((a, b) => b.members.length - a.members.length)[0];
            if (main) prompts.push(`Move ${shortLabel(main.label)} across the canvas`);
            const text = state.manifest.entities.find((entity) => entity.text && entity.live.length);
            if (text) {
                const appears = state.manifest.events.find((entry) => entry.kind === 'appears' && entry.ids.includes(text.id));
                const at = appears ? appears.t : Math.max(500, state.manifest.durationMs * 0.25);
                prompts.push(`Make “${text.text}” pop in at ${(at / 1000).toFixed(1)}s`);
            }
            const event = state.manifest.events.find((entry) => entry.t2);
            if (event) prompts.push(`Rebuild the ${String(event.subject).split(' / ').pop()} action at ${(event.t / 1000).toFixed(1)}s`);
            prompts.push('Walk me through this project, beat by beat');
        }
        host.innerHTML = prompts.slice(0, 3).map((prompt) => `<button type="button" data-prompt="${escape(prompt)}">${escape(prompt)}</button>`).join('');
    }

    /* ── drawings on the stage ───────────────────────────────────── */

    function setAnnotating(on) {
        state.annotating = Boolean(on) && Boolean(state.comp);
        if (!state.annotating) state.drawing = null;
        if (state.annotating) setPlaying(false);
        updateAnnotationUi();
        status(state.annotating
            ? 'Drawing mode: drag on the stage to show the agent the motion you want. Escape exits.'
            : 'Drawing mode off. The drawings stay attached to your messages until you clear them.');
    }

    function startStroke(event) {
        if (!state.annotating || event.button !== 0 || !state.comp) return;
        if (state.strokes.length >= 12) {
            status('Up to 12 drawings. Clear one before adding another.', true);
            return;
        }
        event.preventDefault();
        const canvas = $('#annotations');
        canvas.setPointerCapture(event.pointerId);
        const stroke = { id: `stroke-${Date.now().toString(36)}`, points: [pointOnStage(event)] };
        state.strokes.push(stroke);
        state.drawing = stroke;
        updateAnnotationUi();
        drawAnnotations();
    }

    function moveStroke(event) {
        if (!state.drawing) return;
        event.preventDefault();
        const point = pointOnStage(event);
        const points = state.drawing.points;
        const last = points[points.length - 1];
        if (Math.hypot(point[0] - last[0], point[1] - last[1]) < .35 || points.length >= 400) return;
        points.push(point);
        drawAnnotations();
    }

    function endStroke(event) {
        if (!state.drawing) return;
        const stroke = state.drawing;
        state.drawing = null;
        try { $('#annotations').releasePointerCapture(event.pointerId); } catch { /* already released */ }
        if (stroke.points.length < 2 || strokeLength(stroke.points) < 1.5) {
            state.strokes.pop();
        } else {
            // Drawing fixes the window: a later selection change must not retime it.
            state.windowTouched = true;
        }
        updateAnnotationUi();
        drawAnnotations();
    }

    function drawAnnotations() {
        const canvas = $('#annotations');
        const stage = $('#stage');
        if (!canvas || !stage) return;
        const width = stage.clientWidth;
        const height = stage.clientHeight;
        if (!width || !height) return;
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
        }
        const context = canvas.getContext('2d');
        if (!context) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        if (!state.strokes.length) return;
        const lineWidth = Math.max(2.5, Math.min(6, width / 90));
        const marker = Math.max(4, Math.min(9, width / 45));
        const toPixels = ([x, y]) => [x / 100 * width, y / 100 * height];
        for (const stroke of state.strokes) {
            const points = stroke.points.map(toPixels);
            if (points.length < 2) continue;
            context.lineCap = 'round';
            context.lineJoin = 'round';
            // A dark backing keeps the line readable over bright artwork.
            context.strokeStyle = 'rgba(0,0,0,.38)';
            context.lineWidth = lineWidth + 2;
            context.beginPath();
            points.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
            context.stroke();
            context.strokeStyle = '#ff5a2a';
            context.lineWidth = lineWidth;
            context.beginPath();
            points.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
            context.stroke();
            const [startX, startY] = points[0];
            const [endX, endY] = points[points.length - 1];
            context.fillStyle = '#37e07a';
            context.beginPath();
            context.arc(startX, startY, marker, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = '#b55cff';
            context.beginPath();
            context.arc(endX, endY, marker, 0, Math.PI * 2);
            context.fill();
            const previous = points[points.length - 2];
            const angle = Math.atan2(endY - previous[1], endX - previous[0]);
            const head = marker * 2.4;
            context.strokeStyle = '#ff5a2a';
            context.lineWidth = lineWidth;
            context.beginPath();
            context.moveTo(endX, endY);
            context.lineTo(endX - Math.cos(angle - .45) * head, endY - Math.sin(angle - .45) * head);
            context.moveTo(endX, endY);
            context.lineTo(endX - Math.cos(angle + .45) * head, endY - Math.sin(angle + .45) * head);
            context.stroke();
        }
    }

    function updateAnnotationUi() {
        const count = state.strokes.length;
        const length = state.strokes.reduce((total, stroke) => total + strokeLength(stroke.points), 0);
        $('#annotateCount').textContent = count
            ? `${count} drawing${count === 1 ? '' : 's'} · ${length.toFixed(1)}% path`
            : 'No drawings';
        $('#undoStroke').disabled = !count;
        $('#clearStrokes').disabled = !count;
        $('#annotateBtn').setAttribute('aria-pressed', String(state.annotating));
        $('#annotateHint').hidden = !state.annotating;
        $('#stageShell').classList.toggle('is-annotating', state.annotating);
        updateContext();
        updateSuggestions();
    }

    function setWindow(fromMs, toMs, touched) {
        const duration = Math.max(0, Number(state.comp && state.comp.duration) || 0);
        let from = clamp(fromMs, 0, duration);
        let to = clamp(toMs, 0, duration);
        if (!(to > from)) {
            to = Math.min(duration, from + 1000);
            if (!(to > from)) from = 0;
        }
        state.windowFrom = Math.round(from);
        state.windowTo = Math.round(to);
        state.windowTouched = Boolean(touched);
        $('#windowFrom').value = (state.windowFrom / 1000).toFixed(1);
        $('#windowTo').value = (state.windowTo / 1000).toFixed(1);
        $('#windowFrom').max = (duration / 1000).toFixed(1);
        $('#windowTo').max = (duration / 1000).toFixed(1);
        updateContext();
    }

    function applyDefaultWindow() {
        if (state.windowTouched || !state.comp) return;
        const spans = selectionSpans();
        const duration = Math.max(0, Number(state.comp.duration) || 0);
        if (spans.length) {
            setWindow(Math.min(...spans.map((span) => span[0])), Math.max(...spans.map((span) => span[1])), false);
        } else {
            setWindow(0, duration, false);
        }
    }

    /* ── adding images ──────────────────────────────────────────── */

    async function addImageFile(file) {
        if (!state.comp || !file) return;
        if (!/^image\//.test(file.type)) {
            status(`“${file.name}” is not an image.`, true);
            return;
        }
        if (file.size > 12 * 1024 * 1024) {
            status(`“${file.name}” is larger than 12 MB.`, true);
            return;
        }
        if (variantLayers().length >= 12) {
            status('Up to 12 added layers in one session. Undo or start a new variant.', true);
            return;
        }
        try {
            let url = await readFileAsDataUrl(file);
            const size = await imageSize(url);
            if (!(size.w > 0) || !(size.h > 0)) throw new Error('The image has no readable size.');
            // Large photos are downscaled so the variant, its undo history and the
            // downloaded JSON stay light. SVG is left untouched.
            if (!/svg/i.test(file.type)) {
                url = await shrinkImage(url, size).catch(() => url);
            }
            const aspect = (size.h / size.w) * (state.comp.width / state.comp.height);
            let width = 40;
            let height = width * aspect;
            if (height > 55) { height = 55; width = height / aspect; }
            if (width > 60) { width = 60; height = width * aspect; }
            const x = (100 - width) / 2;
            const y = (100 - height) / 2;
            const topZ = Math.max(...state.comp.layers.map((layer) => Number(layer.z) || 0));
            beginEdit();
            const layer = Timeline.addImageLayer(state.comp, {
                name: file.name.replace(/\.[^.]+$/, ''),
                url,
                x,
                y,
                w: width,
                h: height,
                z: Math.round((topZ + 1) * 100) / 100,
            });
            state.manifest = Manifest.build(state.comp, state.index);
            state.textBasis = state.manifest.textBasis || state.textBasis;
            renderStage();
            renderPanel();
            fit();
            const hadSelection = state.selection.size > 0;
            if (!hadSelection) {
                state.selection.clear();
                state.selection.add(layer.id);
            }
            markSelection();
            say(`Added “${layer.name}” as an image layer at ${width.toFixed(1)}×${height.toFixed(1)}% of the canvas. Ask the agent to place, scale or animate it, or draw a path from where it sits now.${hadSelection ? ' It is listed under “Added in this session”.' : ''}`, 'is-note');
            status(`Added the image “${layer.name}”.`);
        } catch (error) {
            status(`Could not add “${file.name}”: ${error.message}`, true);
        }
    }

    async function addImageFiles(files) {
        for (const file of files) {
            // Sequential so each upload gets its own undo step and selection.
            await addImageFile(file);
        }
    }

    /* ── the working variant ─────────────────────────────────────── */

    function beginEdit() {
        state.history.push(JSON.stringify(state.comp));
        if (state.history.length > 30) state.history.shift();
        $('#undoBtn').disabled = false;
    }

    function restorePrevious() {
        const previous = state.history.pop();
        if (!previous) return false;
        state.comp = JSON.parse(previous);
        state.manifest = Manifest.build(state.comp, state.index);
        state.textBasis = state.manifest.textBasis || state.textBasis;
        renderStage();
        renderPanel();
        markSelection();
        fit();
        $('#undoBtn').disabled = state.history.length === 0;
        return true;
    }

    function undo() {
        if (!restorePrevious()) return;
        setPlaying(false);
        status('Undid the last edit.');
    }

    function setMode(mode) {
        if (!state.orig || mode === state.mode) return;
        if (state.history.length && !window.confirm('Switch the start mode? The current variant is discarded.')) return;
        state.mode = mode;
        state.comp = Manifest.start(state.orig, mode);
        state.history = [];
        state.time = 0;
        $('#undoBtn').disabled = true;
        syncModeButtons();
        rebuild();
        setPlaying(true);
        say(mode === 'original'
            ? 'Started from the original animation: every existing keyframe stays underneath your edits.'
            : 'Started blank: every element is kept as a static asset at its first visible pose, with no animation.', 'is-note');
    }

    function syncModeButtons() {
        $('#modeOriginal').setAttribute('aria-pressed', String(state.mode === 'original'));
        $('#modeBlank').setAttribute('aria-pressed', String(state.mode === 'blank'));
    }

    function download() {
        if (!state.comp) return;
        const name = `${state.comp.id}.composition.json`;
        const url = URL.createObjectURL(new Blob([JSON.stringify(state.comp, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        status(`Downloaded ${name} — the master composition was not touched.`);
    }

    /* ── agent ───────────────────────────────────────────────────── */

    async function ask(text) {
        const value = String(text || '').trim();
        if (!value || state.busy || !state.comp) return;
        state.busy = true;
        $('#sendBtn').disabled = true;
        say(value, 'is-user');
        state.messages.push({ role: 'user', content: value });
        const addedLayers = variantLayers().map((layer) => ({
            id: layer.id,
            name: layer.name,
            kind: layer.uploaded ? 'uploaded' : 'generated',
            x: layer.x, y: layer.y, w: layer.w, h: layer.h, z: layer.z,
        }));
        const drawings = state.strokes.map((stroke) => ({ points: stroke.points.slice(0, 400) }));
        const variant = {};
        if (addedLayers.length) variant.layers = addedLayers;
        if (drawings.length) {
            variant.annotations = {
                strokes: drawings,
                from: state.windowFrom,
                to: state.windowTo,
            };
        }
        const attached = [];
        if (drawings.length) attached.push(`${drawings.length} drawing${drawings.length === 1 ? '' : 's'} (${(state.windowFrom / 1000).toFixed(1)}–${(state.windowTo / 1000).toFixed(1)}s)`);
        if (addedLayers.length) attached.push(`${addedLayers.length} added layer${addedLayers.length === 1 ? '' : 's'}`);
        if (attached.length) say(`Attached: ${attached.join(' · ')}`, 'is-note');
        const thinking = say('Reading the project and planning the change…', 'is-thinking');
        try {
            const data = await api('/api/project-canvas/agent', {
                method: 'POST',
                body: JSON.stringify({
                    projectId: state.projectId,
                    compositionId: state.project && state.project.compositionId,
                    mode: state.mode,
                    selection: [...state.selection],
                    provider: state.providerId || undefined,
                    variant: (addedLayers.length || drawings.length) ? variant : undefined,
                    messages: state.messages.slice(-16),
                }),
            });
            if (thinking) thinking.remove();
            applyTurn(data);
        } catch (error) {
            if (thinking) thinking.remove();
            say(error.message, 'is-warn');
            state.messages.pop();
        } finally {
            state.busy = false;
            $('#sendBtn').disabled = false;
        }
    }

    function applyTurn(data) {
        if (!data) return;
        if (Array.isArray(data.queries) && data.queries.length) {
            const described = data.queries.map((query) => {
                if (query.error) return `${query.tool} failed`;
                const amount = typeof query.count === 'number' ? ` · ${query.count}` : '';
                return `${query.tool}${query.query ? ` “${query.query}”` : ''}${amount}`;
            }).join(' · ');
            say(`Project lookups: ${described}`, 'is-note');
        }
        let assistant = String(data.reply || '').trim();
        const beats = Array.isArray(data.beats) ? data.beats : [];
        if (beats.length) assistant += `${assistant ? '\n\n' : ''}${beats.map((beat, index) => `${index + 1}. ${beat}`).join('\n')}`;
        if (assistant) say(assistant, 'is-agent');
        if (data.ask) say(data.ask, 'is-note');
        for (const warning of (Array.isArray(data.warnings) ? data.warnings : [])) say(warning, 'is-warn');

        const edits = Array.isArray(data.edits) ? data.edits : [];
        const layers = Array.isArray(data.layers) ? data.layers : [];
        let applied = '';
        let applyError = '';
        if (edits.length || layers.length) {
            beginEdit();
            try {
                const result = edits.length
                    ? Timeline.applyEdits(state.comp, state.manifest, edits)
                    : { summary: [], earliest: 0 };
                let generated = 0;
                for (const spec of layers) {
                    Timeline.addGeneratedLayer(state.comp, spec);
                    generated += 1;
                }
                state.manifest = Manifest.build(state.comp, state.index);
                state.textBasis = state.manifest.textBasis || state.textBasis;
                renderStage();
                renderPanel();
                state.time = clamp(result.earliest, 0, Number(state.comp.duration) || 0);
                setPlaying(true);
                frame();
                markSelection();
                const done = [];
                if (result.summary.length) done.push(result.summary.join(' + '));
                if (generated) done.push(`${generated} new element${generated === 1 ? '' : 's'}`);
                applied = done.length ? `Applied ${done.join(' and ')}.` : '';
                if (applied) say(applied, 'is-note');
            } catch (error) {
                applyError = error.message;
                restorePrevious();
                say(`Could not apply the agent's edits: ${error.message}`, 'is-warn');
            }
        } else if (!assistant) {
            say('The agent returned no change.', 'is-note');
        }

        const record = [assistant, applied, applyError ? `The edits failed: ${applyError}` : ''].filter(Boolean).join('\n\n');
        state.messages.push({ role: 'assistant', content: record || 'No change.' });
        if (applied) state.messages.push({ role: 'user', content: `${applied} Those edits are already applied; do nothing else unless I ask for more.` });
        if (state.messages.length > 24) state.messages = state.messages.slice(-24);
    }

    /* ── wiring ──────────────────────────────────────────────────── */

    function wire() {
        $('#projectSelect').addEventListener('change', (event) => openProject(event.target.value));
        $('#compositionSelect').addEventListener('change', (event) => openProject(state.projectId, event.target.value));
        $('#modeOriginal').addEventListener('click', () => setMode('original'));
        $('#modeBlank').addEventListener('click', () => setMode('blank'));
        $('#undoBtn').addEventListener('click', undo);
        $('#downloadBtn').addEventListener('click', download);
        $('#playBtn').addEventListener('click', () => setPlaying(!state.playing));
        $('#loopBtn').addEventListener('click', () => {
            state.loop = !state.loop;
            $('#loopBtn').setAttribute('aria-pressed', String(state.loop));
        });
        $('#scrub').addEventListener('input', (event) => seek(Number(event.target.value)));
        $('#speed').addEventListener('change', (event) => { state.speed = Number(event.target.value) || 1; });
        $('#panelBody').addEventListener('click', onPanelClick);
        $('#stage').addEventListener('click', onStageClick);
        $('#annotateBtn').addEventListener('click', () => setAnnotating(!state.annotating));
        $('#undoStroke').addEventListener('click', () => {
            state.strokes.pop();
            if (!state.strokes.length) {
                state.windowTouched = false;
                applyDefaultWindow();
            }
            updateAnnotationUi();
            drawAnnotations();
        });
        $('#clearStrokes').addEventListener('click', () => {
            state.strokes = [];
            state.drawing = null;
            state.windowTouched = false;
            updateAnnotationUi();
            drawAnnotations();
            applyDefaultWindow();
        });
        $('#windowFrom').addEventListener('change', () => setWindow((Number($('#windowFrom').value) || 0) * 1000, state.windowTo, true));
        $('#windowTo').addEventListener('change', () => setWindow(state.windowFrom, (Number($('#windowTo').value) || 0) * 1000, true));
        $('#useSelectionWindow').addEventListener('click', () => {
            const spans = selectionSpans();
            if (!spans.length) return;
            setWindow(Math.min(...spans.map((span) => span[0])), Math.max(...spans.map((span) => span[1])), true);
        });
        $('#addImageBtn').addEventListener('click', () => $('#imageInput').click());
        $('#imageInput').addEventListener('change', async (event) => {
            const files = [...(event.target.files || [])];
            event.target.value = '';
            await addImageFiles(files);
        });
        const annotations = $('#annotations');
        annotations.addEventListener('pointerdown', startStroke);
        annotations.addEventListener('pointermove', moveStroke);
        annotations.addEventListener('pointerup', endStroke);
        annotations.addEventListener('pointercancel', endStroke);
        const shell = $('#stageShell');
        shell.addEventListener('dragover', (event) => {
            if (!state.comp) return;
            event.preventDefault();
            shell.classList.add('is-drop');
        });
        shell.addEventListener('dragleave', () => shell.classList.remove('is-drop'));
        shell.addEventListener('drop', async (event) => {
            shell.classList.remove('is-drop');
            if (!state.comp) return;
            const files = [...((event.dataTransfer && event.dataTransfer.files) || [])].filter((file) => /^image\//.test(file.type));
            if (!files.length) return;
            event.preventDefault();
            await addImageFiles(files);
        });
        $('#search').addEventListener('input', filterPanel);
        $('#chips').addEventListener('click', (event) => {
            const remove = event.target.closest('[data-unselect]');
            if (remove) { state.selection.delete(remove.dataset.unselect); markSelection(); return; }
            if (event.target.closest('[data-clear]')) { state.selection.clear(); markSelection(); }
        });
        $('#suggestions').addEventListener('click', (event) => {
            const button = event.target.closest('[data-prompt]');
            if (button && !state.busy) ask(button.dataset.prompt);
        });
        $('#chatForm').addEventListener('submit', (event) => {
            event.preventDefault();
            const input = $('#chatInput');
            const value = input.value.trim();
            input.value = '';
            if (value) ask(value);
        });
        $('#chatInput').addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                $('#chatForm').requestSubmit();
            }
        });
        $('#copyContext').addEventListener('click', async () => {
            const text = $('#contextText').value;
            try {
                await navigator.clipboard.writeText(text);
                status('Agent context copied to the clipboard.');
            } catch {
                $('#contextText').select();
                status('Selected the context — press ⌘C / Ctrl+C to copy.');
            }
        });
        document.addEventListener('keydown', (event) => {
            const tag = (event.target.tagName || '').toLowerCase();
            if (['input', 'textarea', 'select'].includes(tag)) return;
            if (event.key === ' ') { event.preventDefault(); setPlaying(!state.playing); }
            if (event.key === 'ArrowRight') seek(state.time + 100);
            if (event.key === 'ArrowLeft') seek(state.time - 100);
            if (event.key === 'Escape' && state.annotating) setAnnotating(false);
        });
        new ResizeObserver(() => fit()).observe($('#stageShell'));
    }

    boot();
})();
