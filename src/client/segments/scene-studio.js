'use strict';

/* Scene studio: describe a scene, let the documented scene library interpret
   it, and preview the proposed composition on a clean canvas. No framework. */
(() => {
    const $ = (selector, scope = document) => scope.querySelector(selector);
    const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));

    const state = {
        summary: null,
        build: null,
        tracks: new Map(),
        nodes: [],
        playing: false,
        speed: 1,
        elapsed: 0,
        duration: 8000,
        last: 0,
        raf: 0,
        loading: false,
        active: false,
        defaultPrompt: 'A cyclist passing a brick café at night, with warm lights and bollards.',
    };

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    async function fetchJson(url, options = {}) {
        const response = await fetch(url, {
            headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
            ...options,
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error((data && data.error) || `${response.status} ${response.statusText}`);
        return data;
    }

    function titleCase(value) {
        return String(value || '').replace(/\b\w/g, (letter) => letter.toUpperCase());
    }

    function setStatus(text, isError = false) {
        const node = $('#sceneStatus');
        if (!node) return;
        node.textContent = text;
        node.style.borderColor = isError ? '#e58b7f' : '';
        node.style.color = isError ? '#e58b7f' : '';
    }

    function formatTime(ms) {
        return `${(Number(ms || 0) / 1000).toFixed(2)} / ${(state.duration / 1000).toFixed(2)} s`;
    }

    async function boot() {
        wire();
        try {
            state.summary = await fetchJson('/api/scene-library/summary');
            const scene = (state.summary.scenes || [])[0];
            if (scene) {
                setStatus(`${scene.title} · ${scene.width}×${scene.height} · ${(scene.duration / 1000).toFixed(1)}s · ${scene.counts.buildableParts} buildable parts`);
                const tab = $('#tabScene');
                if (tab) tab.textContent = String(scene.counts.parts);
                state.defaultPrompt = (state.summary.examples || [])[0] || state.defaultPrompt;
                renderExamples(state.summary.examples || []);
            }
            if (location.hash === '#scene') show();
        } catch (error) {
            setStatus(`Scene library unavailable: ${error.message}`, true);
        }
    }

    function show() {
        state.active = true;
        if (state.build || state.loading) return;
        const prompt = $('#scenePrompt');
        if (prompt && !prompt.value.trim()) prompt.value = state.defaultPrompt;
        build(state.defaultPrompt);
    }

    function wire() {
        $('#sceneForm')?.addEventListener('submit', (event) => {
            event.preventDefault();
            const idea = $('#scenePrompt')?.value.trim() || state.defaultPrompt;
            build(idea);
        });
        $('#scenePlay')?.addEventListener('click', () => {
            if (state.playing) stop(); else start();
        });
        $('#sceneRestart')?.addEventListener('click', () => {
            state.elapsed = 0;
            applyFrame(0);
            state.playing = true;
            start();
        });
        $('#sceneScrub')?.addEventListener('input', (event) => {
            state.elapsed = clamp(Number(event.target.value) || 0, 0, state.duration);
            applyFrame(state.elapsed);
            if (state.playing) start();
        });
        $('#sceneSpeed')?.addEventListener('change', (event) => {
            state.speed = Number(event.target.value) || 1;
            if (state.playing) start();
        });
        $('#sceneCopyBuild')?.addEventListener('click', copyBuild);
        $('#sceneDownload')?.addEventListener('click', downloadComposition);
        window.addEventListener('hashchange', () => {
            if (location.hash === '#scene') show();
        });
    }

    function renderExamples(examples) {
        const host = $('#sceneExamples');
        if (!host) return;
        host.innerHTML = '';
        for (const example of examples) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'scene-example';
            if (/cars?|vehicles?/i.test(example)) button.classList.add('is-missing');
            button.textContent = example;
            button.title = /cars?|vehicles?/i.test(example)
                ? 'This example deliberately asks for cars, which the library does not have yet.'
                : example;
            button.addEventListener('click', () => {
                const prompt = $('#scenePrompt');
                if (prompt) prompt.value = example;
                build(example);
            });
            host.appendChild(button);
        }
    }

    async function build(idea) {
        if (state.loading) return;
        state.loading = true;
        const button = $('#sceneBuild');
        if (button) { button.disabled = true; button.textContent = 'Building…'; }
        setStatus('Reading the scene library and interpreting your idea…');
        try {
            const payload = await fetchJson('/api/scene-library/build', {
                method: 'POST',
                body: JSON.stringify({ idea }),
            });
            state.build = payload;
            state.duration = Number(payload.scene?.duration || 8000);
            state.tracks = new Map((payload.animation?.tracks || []).map((track) => [track.layerId, track]));
            state.elapsed = Math.min(state.duration, Math.max(0, state.duration * 0.75));
            render(payload);
            applyFrame(state.elapsed);
            state.playing = false;
            stop();
            setStatus(`${payload.scene.title} · ${payload.layers.length} parts · ${payload.groups.length} groups`);
        } catch (error) {
            setStatus(`Could not build that scene: ${error.message}`, true);
        } finally {
            state.loading = false;
            if (button) { button.disabled = false; button.textContent = 'Build scene'; }
        }
    }

    function render(payload) {
        const stage = $('#sceneStageInner');
        if (!stage) return;
        stage.innerHTML = '';
        state.nodes = [];
        const background = payload.scene?.background || '#15130f';
        const canvas = $('#sceneCanvas');
        if (canvas) canvas.style.backgroundColor = background;

        for (const layer of payload.layers || []) {
            const node = document.createElement('div');
            node.className = 'scene-layer';
            node.dataset.partId = layer.partId || layer.id;
            node.style.zIndex = String(layer.z || 0);
            node.title = `${layer.name}${layer.segmentGroup ? ` · ${layer.segmentGroup}` : ''}`;
            const image = document.createElement('img');
            image.src = layer.url;
            image.alt = layer.name || layer.id;
            image.loading = 'eager';
            image.draggable = false;
            node.appendChild(image);
            stage.appendChild(node);
            state.nodes.push({ layer, node });
        }

        const empty = $('#sceneEmpty');
        if (empty) empty.hidden = Boolean(payload.layers?.length);
        const badge = $('#sceneCanvasBadge');
        if (badge) badge.textContent = `${payload.layers?.length || 0} parts · ${payload.groups?.length || 0} groups`;
        const prompt = $('#scenePrompt');
        if (prompt) prompt.value = payload.idea || prompt.value;
        const caption = $('#sceneCaption');
        if (caption) caption.textContent = `${payload.idea || 'Default scene'} — ${payload.parts?.length || 0} documented parts, ${payload.animation?.tracks?.length || 0} observed motion tracks, ${(state.duration / 1000).toFixed(1)}s.`;
        const scrub = $('#sceneScrub');
        if (scrub) { scrub.max = String(state.duration); scrub.value = '0'; }
        renderInterpretation(payload);
        renderParts(payload);
        renderNotes(payload);
        renderQuality(payload);
        applyFrame(state.elapsed || 0);
    }

    function renderInterpretation(payload) {
        const host = $('#sceneConcepts');
        const count = $('#sceneMatchCount');
        if (!host) return;
        host.innerHTML = '';
        const matched = payload.interpretation?.concepts || [];
        const missing = payload.interpretation?.missing || [];
        for (const concept of matched) {
            const chip = document.createElement('span');
            chip.className = 'scene-chip';
            chip.title = concept.description || concept.label;
            chip.innerHTML = `${escape(concept.label)} <small>${concept.count || 0}</small>`;
            host.appendChild(chip);
        }
        for (const concept of missing) {
            const chip = document.createElement('span');
            chip.className = 'scene-chip is-missing';
            chip.title = concept.description || concept.label;
            chip.textContent = `${concept.label} · not in library`;
            host.appendChild(chip);
        }
        if (!matched.length && !missing.length) {
            const chip = document.createElement('span');
            chip.className = 'scene-chip';
            chip.textContent = 'Default documented build';
            host.appendChild(chip);
        }
        if (count) count.textContent = `${matched.length} matched · ${missing.length} missing`;
        const note = $('#sceneInterpretation');
        if (note) note.textContent = payload.interpretation?.note || '';
    }

    function renderParts(payload) {
        const host = $('#scenePartList');
        const count = $('#scenePartCount');
        if (!host) return;
        host.innerHTML = '';
        const parts = payload.parts || [];
        if (count) count.textContent = `${parts.length}`;
        const partById = new Map(parts.map((part) => [part.id, part]));
        const groups = payload.groups || [];
        const seen = new Set();
        for (const group of groups) {
            const members = (group.partIds || []).map((id) => partById.get(id)).filter(Boolean);
            if (!members.length) continue;
            const section = document.createElement('div');
            section.className = 'scene-part-group';
            const label = document.createElement('strong');
            label.textContent = group.label;
            section.appendChild(label);
            for (const part of members) {
                const row = document.createElement('div');
                row.className = 'scene-part';
                row.innerHTML = `<span>${escape(part.label)}</span><small>${escape(part.zone || part.category || '')}</small>`;
                section.appendChild(row);
                seen.add(part.id);
            }
            host.appendChild(section);
        }
        const rest = parts.filter((part) => !seen.has(part.id));
        if (rest.length) {
            const section = document.createElement('div');
            section.className = 'scene-part-group';
            const label = document.createElement('strong');
            label.textContent = 'Other';
            section.appendChild(label);
            for (const part of rest) {
                const row = document.createElement('div');
                row.className = 'scene-part';
                row.innerHTML = `<span>${escape(part.label)}</span><small>${escape(part.zone || part.category || '')}</small>`;
                section.appendChild(row);
            }
            host.appendChild(section);
        }
    }

    function renderNotes(payload) {
        const host = $('#sceneNotes');
        if (!host) return;
        host.innerHTML = '';
        for (const note of payload.notes || []) {
            const item = document.createElement('li');
            item.textContent = note;
            host.appendChild(item);
        }
    }

    function renderQuality(payload) {
        const host = $('#sceneQuality');
        if (!host) return;
        host.innerHTML = '';
        const items = payload.agent?.dataQuality || [];
        for (const note of items) {
            const item = document.createElement('li');
            item.textContent = note;
            host.appendChild(item);
        }
        const card = host.closest('.scene-card');
        if (card) card.hidden = items.length === 0;
    }

    function trackState(track, time) {
        const segments = Array.isArray(track?.segments) ? track.segments : [];
        if (!segments.length) return null;
        let segment = segments.find((entry) => time >= Number(entry.start || 0)
            && time <= Number(entry.start || 0) + Number(entry.duration || 0));
        if (!segment) segment = segments[segments.length - 1];
        const frames = (segment.frames || []).slice().sort((a, b) => Number(a.t || 0) - Number(b.t || 0));
        if (!frames.length) return null;
        const local = clamp(time - Number(segment.start || 0), 0, Number(segment.duration || 0));
        let index = 0;
        while (index < frames.length - 1 && Number(frames[index + 1].t || 0) <= local) index += 1;
        const a = frames[index];
        const b = frames[index + 1];
        if (!b) return { ...a, t: a.t };
        const span = Math.max(1, Number(b.t || 0) - Number(a.t || 0));
        const p = clamp((local - Number(a.t || 0)) / span, 0, 1);
        const mix = (key, fallback) => {
            const av = Number.isFinite(Number(a[key])) ? Number(a[key]) : fallback;
            const bv = Number.isFinite(Number(b[key])) ? Number(b[key]) : av;
            return av + (bv - av) * p;
        };
        return {
            dx: mix('dx', 0),
            dy: mix('dy', 0),
            sx: mix('sx', 1),
            sy: mix('sy', 1),
            a: mix('a', 1),
            t: local,
        };
    }

    function applyFrame(time) {
        const duration = state.duration || 8000;
        const t = duration > 0 ? ((time % duration) + duration) % duration : 0;
        for (const { layer, node } of state.nodes) {
            const track = state.tracks.get(layer.sourceLayerId || layer.id);
            const value = track ? trackState(track, t) : null;
            const dx = value?.dx || 0;
            const dy = value?.dy || 0;
            const sx = Number.isFinite(value?.sx) ? value.sx : 1;
            const sy = Number.isFinite(value?.sy) ? value.sy : 1;
            const alpha = Number.isFinite(value?.a) ? value.a : 1;
            node.style.left = `${Number(layer.x || 0) + dx * 100}%`;
            node.style.top = `${Number(layer.y || 0) + dy * 100}%`;
            node.style.width = `${Number(layer.w || 100) * sx}%`;
            node.style.height = `${Number(layer.h || 100) * sy}%`;
            node.style.opacity = String(clamp(Number(layer.opacity ?? 1) * alpha, 0, 1));
            node.style.transform = `rotate(${Number(layer.rotation || 0)}deg)`;
        }
        const timeNode = $('#sceneTime');
        if (timeNode) timeNode.textContent = formatTime(t);
        const scrub = $('#sceneScrub');
        if (scrub && document.activeElement !== scrub) scrub.value = String(Math.round(t));
    }

    function start() {
        if (!state.build || !state.nodes.length) {
            state.playing = false;
            return;
        }
        cancelAnimationFrame(state.raf);
        state.playing = true;
        state.last = performance.now();
        const button = $('#scenePlay');
        if (button) button.textContent = 'Pause';
        const tick = (now) => {
            if (!state.playing) return;
            const delta = Math.max(0, now - state.last);
            state.last = now;
            state.elapsed += delta * state.speed;
            applyFrame(state.elapsed);
            state.raf = requestAnimationFrame(tick);
        };
        state.raf = requestAnimationFrame(tick);
    }

    function stop() {
        state.playing = false;
        cancelAnimationFrame(state.raf);
        const button = $('#scenePlay');
        if (button) button.textContent = 'Play';
    }

    async function copyBuild() {
        if (!state.build) return;
        const text = JSON.stringify(state.build.composition, null, 2);
        try {
            await navigator.clipboard.writeText(text);
            setStatus('Build composition copied as JSON.');
        } catch {
            const area = document.createElement('textarea');
            area.value = text;
            area.style.position = 'fixed';
            area.style.left = '-9999px';
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            area.remove();
            setStatus('Build composition copied as JSON.');
        }
    }

    function downloadComposition() {
        if (!state.build) return;
        const blob = new Blob([JSON.stringify(state.build.composition, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${state.build.id || 'scene-build'}.composition.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus('Scene composition downloaded.');
    }

    window.SceneStudio = { show, build, stop };
    boot().catch((error) => setStatus(`Scene studio could not start: ${error.message}`, true));
})();
