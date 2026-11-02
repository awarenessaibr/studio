'use strict';
/**
 * voice.js — Voice Studio: MLX-Audio status, speech, and the two-direction
 * voice-design agent. No framework, no dependencies.
 */
(function () {
    const state = {
        status: null,
        models: [],
        voices: [],
        packs: [],
        session: null,
        sessions: [],
        proposals: [],
        audioBlob: null,
        audioUrl: '',
        audioMime: 'audio/wav',
        statusTimer: 0,
        busy: false,
    };

    const $ = (id) => document.getElementById(id);

    function h(tag, props, children) {
        const node = document.createElement(tag);
        if (props) {
            Object.entries(props).forEach(([key, value]) => {
                if (value === undefined || value === null || value === false) return;
                if (key === 'class') node.className = value;
                else if (key === 'text') node.textContent = value;
                else if (key === 'dataset') Object.assign(node.dataset, value);
                else if (key === 'style') Object.assign(node.style, value);
                else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
                else if (value === true) node.setAttribute(key, '');
                else node.setAttribute(key, String(value));
            });
        }
        (Array.isArray(children) ? children : [children]).forEach((child) => {
            if (child === null || child === undefined || child === false) return;
            if (child instanceof Node) node.appendChild(child);
            else node.appendChild(document.createTextNode(String(child)));
        });
        return node;
    }

    async function api(path, options = {}) {
        const response = await fetch(path, {
            cache: 'no-store',
            headers: { Accept: 'application/json', ...(options.headers || {}) },
            ...options,
            body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
        });
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok) {
            let detail = `${response.status} ${response.statusText}`;
            try {
                const payload = await response.json();
                detail = payload?.error || payload?.detail || detail;
            } catch { /* binary or empty */ }
            throw new Error(String(detail));
        }
        if (contentType.includes('application/json')) return response.json();
        return response.blob();
    }

    function setInline(element, message, kind = '') {
        if (!element) return;
        element.hidden = !message;
        element.textContent = '';
        element.dataset.state = kind;
        if (!message) return;
        if (kind === 'loading') element.appendChild(h('span', { class: 'spinner' }));
        element.appendChild(h('span', { text: message }));
    }

    function toast(message, bad = false) {
        let node = $('voiceToast');
        if (!node) {
            node = h('div', { id: 'voiceToast', class: 'voice-toast', role: 'status' });
            document.body.appendChild(node);
            const style = document.createElement('style');
            style.textContent = '.voice-toast{position:fixed;left:50%;bottom:22px;z-index:200;max-width:min(540px,calc(100vw - 30px));padding:9px 14px;border-radius:10px;background:#1a1a2e;color:#fffdf9;font-size:11.5px;box-shadow:0 12px 30px rgb(0 0 0 / 22%);transform:translateX(-50%);opacity:0;transition:opacity .15s}.voice-toast.is-on{opacity:1}.voice-toast.is-bad{background:#a3342b}';
            document.head.appendChild(style);
        }
        node.textContent = message;
        node.classList.toggle('is-bad', Boolean(bad));
        node.classList.add('is-on');
        clearTimeout(node._timer);
        node._timer = setTimeout(() => node.classList.remove('is-on'), bad ? 5200 : 3200);
    }

    const shortModel = (model) => String(model || '').split('/').pop();

    // ── status / models ──────────────────────────────────────────────

    async function loadStatus({ quiet = false } = {}) {
        try {
            const status = await api('/api/tts/status');
            state.status = status;
            renderStatus(status);
            if (status.ready && !state.models.length) await loadModels({ quiet: true });
            if (['starting', 'registering'].includes(status.phase)) {
                clearTimeout(state.statusTimer);
                state.statusTimer = setTimeout(() => loadStatus({ quiet: true }), 3000);
            }
        } catch (error) {
            renderStatus({ phase: 'unreachable', ready: false, error: error.message, models: [] });
            if (!quiet) toast(error.message, true);
        }
    }

    function renderStatus(status) {
        const box = $('ttsStatus');
        const phase = status?.phase || 'unreachable';
        const ready = Boolean(status?.ready);
        box.dataset.state = ready ? 'ready' : (['starting', 'registering'].includes(phase) ? 'starting' : 'error');
        $('ttsStatusTitle').textContent = ready
            ? 'MLX-Audio is ready.'
            : (['starting', 'registering'].includes(phase) ? 'MLX-Audio is starting…' : 'MLX-Audio is not available.');
        const modelCount = Array.isArray(status?.models) ? status.models.length : 0;
        $('ttsStatusText').textContent = ready
            ? `${modelCount} model${modelCount === 1 ? '' : 's'} registered · ${status.managed ? 'managed by this studio' : 'external server'} · ${status.url || ''}`
            : (status?.error || 'Start the local server here; the model cache is reused, never copied.');
        $('ttsStartBtn').hidden = ready;
        $('ttsStartBtn').disabled = ['starting', 'registering'].includes(phase);
        $('ttsStopBtn').hidden = !status?.managed;
        $('modelPill').textContent = ready ? `${modelCount} model${modelCount === 1 ? '' : 's'}` : 'no model';
    }

    async function startServer() {
        $('ttsStartBtn').disabled = true;
        $('ttsStartBtn').textContent = 'Starting…';
        try {
            const status = await api('/api/tts/start', { method: 'POST' });
            state.status = status;
            renderStatus(status);
            await loadModels({ quiet: true });
            toast('MLX-Audio is ready.');
        } catch (error) {
            toast(error.message, true);
            await loadStatus({ quiet: true });
        } finally {
            $('ttsStartBtn').textContent = 'Start MLX-Audio';
            $('ttsStartBtn').disabled = false;
        }
    }

    async function stopServer() {
        if (!window.confirm('Stop the MLX-Audio server managed by this studio?')) return;
        try {
            await api('/api/tts/stop', { method: 'POST' });
            toast('MLX-Audio stopped.');
            await loadStatus({ quiet: true });
        } catch (error) {
            toast(error.message, true);
        }
    }

    async function loadModels({ quiet = false } = {}) {
        try {
            const payload = await api('/api/tts/models');
            const list = Array.isArray(payload?.data) ? payload.data : [];
            state.models = list.map((item) => (typeof item === 'string' ? item : item.id)).filter(Boolean);
            renderModels();
            if (!quiet) toast(`Found ${state.models.length} model${state.models.length === 1 ? '' : 's'}.`);
        } catch (error) {
            state.models = [];
            renderModels();
            if (!quiet) toast(error.message, true);
        }
    }

    function renderModels() {
        const select = $('speakModel');
        select.textContent = '';
        if (!state.models.length) {
            select.appendChild(h('option', { value: '', text: 'No model registered' }));
            return;
        }
        state.models.forEach((model) => select.appendChild(h('option', { value: model, text: model })));
        const preferred = state.models.find((model) => /voicedesign/i.test(model)) || state.models[0];
        select.value = preferred;
        renderLanguages(preferred);
        loadVoices();
    }

    async function loadVoices() {
        const model = $('speakModel').value;
        const select = $('speakVoice');
        select.textContent = '';
        select.appendChild(h('option', { value: '', text: 'Designed voice / model default' }));
        state.voices = [];
        if (!model || !state.status?.ready) return;
        try {
            const payload = await api(`/api/tts/voices?model=${encodeURIComponent(model)}`);
            const list = Array.isArray(payload?.voices) ? payload.voices
                : (Array.isArray(payload?.data) ? payload.data : []);
            state.voices = list.map((item) => (typeof item === 'string' ? item : (item.id || item.name || item.voice))).filter(Boolean);
            state.voices.forEach((voice) => select.appendChild(h('option', { value: voice, text: voice })));
        } catch {
            /* many voice-design models have no named voices; the instruct is the voice */
        }
    }

    function languagesFor(model) {
        const value = String(model || '').toLowerCase();
        if (value.includes('qwen3-tts')) {
            return ['auto', 'chinese', 'czech', 'english', 'german', 'greek', 'italian', 'japanese',
                'korean', 'polish', 'portuguese', 'slovak', 'spanish', 'french', 'russian'];
        }
        if (value.includes('kokoro')) return ['a', 'b', 'e', 'f', 'h', 'i', 'p', 'j', 'z'];
        return [''];
    }

    function renderLanguages(model = $('speakModel').value) {
        const select = $('speakLanguage');
        const current = select.value;
        const codes = languagesFor(model);
        select.textContent = '';
        codes.forEach((code) => select.appendChild(h('option', {
            value: code,
            text: code === 'auto' ? 'Automatic' : (code || 'Model default'),
        })));
        select.value = codes.includes(current) ? current : (codes.includes('auto') ? 'auto' : codes[0]);
    }

    // ── speech ──────────────────────────────────────────────────────

    async function speak() {
        if (state.busy) return;
        const input = $('speakText').value.trim();
        const model = $('speakModel').value;
        if (!input) { setInline($('speakStatus'), 'Enter the text to speak.', 'error'); return; }
        if (!model) { setInline($('speakStatus'), 'Start the server and choose a model.', 'error'); return; }
        state.busy = true;
        $('speakBtn').disabled = true;
        $('speakBtn').textContent = 'Synthesising…';
        setInline($('speakStatus'), 'Generating audio. The first model load can take a minute.', 'loading');
        try {
            const body = {
                model,
                input,
                instruct: $('speakInstruct').value.trim() || undefined,
                speed: Number($('speakRate').value) || 1,
                response_format: $('speakFormat').value,
                lang_code: $('speakLanguage').value || undefined,
            };
            const voice = $('speakVoice').value;
            if (voice) body.voice = voice;
            const response = await fetch('/api/tts/speech', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'audio/*' },
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                let detail = `${response.status} ${response.statusText}`;
                try { detail = (await response.json())?.error || detail; } catch { /* binary */ }
                throw new Error(detail);
            }
            const blob = await response.blob();
            if (!blob.size) throw new Error('The speech server returned empty audio.');
            if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
            state.audioBlob = blob;
            state.audioMime = blob.type || (body.response_format === 'mp3' ? 'audio/mpeg' : 'audio/wav');
            state.audioUrl = URL.createObjectURL(blob);
            $('audioPlayer').src = state.audioUrl;
            $('audioResult').hidden = false;
            $('audioDownload').href = state.audioUrl;
            $('audioDownload').download = `voice.${body.response_format === 'mp3' ? 'mp3' : 'wav'}`;
            $('audioMeta').textContent = `${(blob.size / 1024).toFixed(0)} KB · ${model.split('/').pop()}`;
            $('saveAudioStatus').textContent = '';
            setInline($('speakStatus'), 'Audio ready.', 'ok');
            $('audioPlayer').play().catch(() => {});
        } catch (error) {
            setInline($('speakStatus'), error.message, 'error');
        } finally {
            state.busy = false;
            $('speakBtn').disabled = false;
            $('speakBtn').textContent = 'Generate speech';
        }
    }

    // ── save audio to the asset library ─────────────────────────────

    async function loadPacks() {
        try {
            const payload = await api('/api/brand-packs');
            state.packs = Array.isArray(payload?.packs) ? payload.packs : [];
            const select = $('savePack');
            state.packs.forEach((pack) => select.appendChild(h('option', { value: pack.id, text: pack.name })));
        } catch { /* optional */ }
    }

    function renderSaveBrands() {
        const packId = $('savePack').value;
        const select = $('saveBrand');
        select.textContent = '';
        select.appendChild(h('option', { value: '', text: 'No brand' }));
        const pack = state.packs.find((item) => item.id === packId);
        (pack?.brands || []).forEach((brand) => select.appendChild(h('option', { value: brand.id, text: brand.name })));
    }

    const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the audio.'));
        reader.readAsDataURL(blob);
    });

    async function saveAudio() {
        if (!state.audioBlob) return;
        $('saveAudioBtn').disabled = true;
        $('saveAudioStatus').textContent = 'Saving…';
        try {
            const dataUrl = await blobToDataUrl(state.audioBlob);
            const ext = state.audioMime.includes('mpeg') ? 'mp3' : 'wav';
            const result = await api('/api/assets/ingest', {
                method: 'POST',
                body: {
                    packId: $('savePack').value || undefined,
                    brandId: $('saveBrand').value || undefined,
                    files: [{
                        name: `voice-${Date.now()}.${ext}`,
                        dataUrl,
                        class: 'content',
                        rights: 'brand-owned',
                    }],
                },
            });
            const asset = result?.created?.[0];
            $('saveAudioStatus').textContent = asset
                ? `Saved as ${asset.name}. Open the library to review it.`
                : 'Saved, but the library returned no record.';
            if (asset) toast('Audio saved to the asset library.');
        } catch (error) {
            $('saveAudioStatus').textContent = error.message;
        } finally {
            $('saveAudioBtn').disabled = false;
        }
    }

    // ── voice-design agent ──────────────────────────────────────────

    function renderAgent(proposals, meta = {}) {
        const transcript = $('agentTranscript');
        transcript.textContent = '';
        if (!state.session?.messages?.length && !proposals.length) {
            transcript.appendChild(h('div', { class: 'agent-empty', text: 'Describe a voice above. The director returns exactly two complete directions.' }));
            return;
        }
        const userMessages = (state.session?.messages || []).filter((message) => message.role === 'user');
        const lastUser = userMessages[userMessages.length - 1];
        if (lastUser) transcript.appendChild(h('div', { class: 'agent-user', text: lastUser.text }));
        if (meta.engine) transcript.appendChild(h('div', { class: 'agent-meta', text: meta.engine === 'curated-fallback'
            ? 'No local language model is available — two curated starting points, not model-generated.'
            : `Generated by ${meta.engine || 'the local model'}${meta.elapsed_ms ? ` · ${(meta.elapsed_ms / 1000).toFixed(1)}s` : ''}` }));
        if (!proposals.length) return;
        const grid = h('div', { class: 'proposal-grid' });
        proposals.forEach((proposal) => grid.appendChild(renderProposal(proposal)));
        transcript.appendChild(grid);
    }

    function renderProposal(proposal) {
        const refine = proposal.refine || {};
        const chips = [
            proposal.model?.split('/').pop(),
            proposal.language,
            proposal.presentation !== 'unspecified' ? proposal.presentation : '',
            proposal.age !== 'unspecified' ? proposal.age : '',
            proposal.delivery,
            `${refine.rate ?? 1}×`,
            refine.emotion && refine.emotion !== 'neutral' ? refine.emotion : '',
            refine.space && refine.space !== 'dry' ? refine.space : '',
        ].filter(Boolean);
        const card = h('article', { class: 'proposal', dataset: { id: proposal.id } }, [
            h('div', { class: 'proposal-head' }, [
                h('div', null, [
                    h('span', { class: 'direction', text: proposal.direction }),
                    h('h3', { text: proposal.name }),
                ]),
            ]),
            h('p', { text: proposal.description }),
            h('div', { class: 'sample', text: proposal.sample }),
            h('div', { class: 'chips' }, chips.map((chip) => h('span', { text: String(chip) }))),
            h('p', { class: 'rationale', text: proposal.rationale }),
            h('div', { class: 'proposal-actions' }, [
                h('button', { type: 'button', class: 'button small', text: 'Audition', onClick: () => audition(proposal) }),
                h('button', { type: 'button', class: 'button primary small', text: 'Apply to form', onClick: () => applyProposal(proposal) }),
            ]),
        ]);
        return card;
    }

    async function suggest(event) {
        event?.preventDefault();
        const message = $('agentMessage').value.trim();
        if (!message) return;
        $('agentBtn').disabled = true;
        $('agentBtn').textContent = 'Directing…';
        $('agentHint').textContent = 'Generating two complete directions…';
        try {
            const payload = await api('/api/tts/design/suggest', {
                method: 'POST',
                body: {
                    message,
                    session_id: state.session?.id || undefined,
                    context: {
                        models: state.models,
                        languages: languagesFor($('speakModel').value || state.models[0]),
                        current: {
                            model: $('speakModel').value,
                            language: $('speakLanguage').value,
                            locale: '',
                            accent: '',
                            presentation: 'unspecified',
                            age: 'unspecified',
                            delivery: 'natural',
                            description: $('speakInstruct').value,
                            sample: $('speakText').value,
                        },
                    },
                },
            });
            state.session = payload.session || state.session;
            state.proposals = payload.proposals || [];
            renderAgent(state.proposals, payload.meta || {});
            $('agentMessage').value = '';
            $('agentHint').textContent = payload.meta?.engine === 'curated-fallback'
                ? 'Local model unavailable · curated fallback used.'
                : 'Two directions saved in this session.';
            await loadSessions({ quiet: true });
        } catch (error) {
            $('agentHint').textContent = error.message;
            toast(error.message, true);
        } finally {
            $('agentBtn').disabled = false;
            $('agentBtn').textContent = 'Generate 2 directions';
        }
    }

    async function audition(proposal) {
        if (!state.session?.id) { toast('No session for this proposal.', true); return; }
        toast('Synthesising the audition…');
        try {
            const response = await fetch(`/api/tts/design/proposals/${encodeURIComponent(proposal.id)}/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'audio/*' },
                body: JSON.stringify({ session_id: state.session.id }),
            });
            if (!response.ok) {
                let detail = `${response.status} ${response.statusText}`;
                try { detail = (await response.json())?.error || detail; } catch { /* binary */ }
                throw new Error(detail);
            }
            const blob = await response.blob();
            if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
            state.audioBlob = blob;
            state.audioMime = blob.type || 'audio/wav';
            state.audioUrl = URL.createObjectURL(blob);
            $('audioPlayer').src = state.audioUrl;
            $('audioResult').hidden = false;
            $('audioDownload').href = state.audioUrl;
            $('audioMeta').textContent = `audition · ${(blob.size / 1024).toFixed(0)} KB`;
            $('audioPlayer').play().catch(() => {});
            toast(`Auditioning “${proposal.direction}”.`);
        } catch (error) {
            toast(error.message, true);
        }
    }

    async function applyProposal(proposal) {
        if (!state.models.includes(proposal.model)) {
            if (state.models.length) $('speakModel').appendChild(h('option', { value: proposal.model, text: proposal.model }));
        }
        $('speakModel').value = proposal.model;
        renderLanguages(proposal.model);
        if (proposal.language && ![...$('speakLanguage').options].some((option) => option.value === proposal.language)) {
            $('speakLanguage').appendChild(h('option', { value: proposal.language, text: proposal.language }));
        }
        if (proposal.language) $('speakLanguage').value = proposal.language;
        $('speakText').value = proposal.sample || $('speakText').value;
        $('speakInstruct').value = proposal.instruct || proposal.description || '';
        $('speakRate').value = String(proposal.refine?.rate || 1);
        $('rateOut').textContent = `${(Number($('speakRate').value) || 1).toFixed(2)}×`;
        $('speakVoice').value = '';
        document.querySelectorAll('.proposal').forEach((card) => card.classList.toggle('selected', card.dataset.id === proposal.id));
        if (state.session?.id) {
            fetch(`/api/tts/design/proposals/${encodeURIComponent(proposal.id)}/applied`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: state.session.id }),
            }).catch(() => {});
        }
        toast(`Applied “${proposal.direction}” to the form.`);
        $('speakText').focus();
        $('speakText').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function loadSessions({ quiet = false } = {}) {
        try {
            const payload = await api('/api/tts/design/sessions');
            state.sessions = payload?.sessions || [];
            renderHistory();
        } catch (error) {
            if (!quiet) toast(error.message, true);
        }
    }

    function renderHistory() {
        const list = $('historyList');
        list.textContent = '';
        if (!state.sessions.length) {
            list.appendChild(h('p', { class: 'hint', text: 'No saved sessions yet.' }));
            return;
        }
        state.sessions.slice(0, 10).forEach((session) => {
            const button = h('button', { type: 'button', class: 'history-item' }, [
                h('span', { text: session.title || 'Voice design' }),
                h('small', { text: `${session.proposal_count || 0} proposals · ${String(session.updated_at || '').slice(0, 16)}` }),
            ]);
            button.addEventListener('click', () => openSession(session.id));
            list.appendChild(button);
        });
    }

    async function openSession(id) {
        try {
            const payload = await api(`/api/tts/design/sessions/${encodeURIComponent(id)}`);
            state.session = payload.session;
            state.proposals = (payload.session?.proposals || []).slice(-2);
            renderAgent(state.proposals, { engine: 'saved session' });
            $('historyList').hidden = true;
            $('historyToggle').setAttribute('aria-expanded', 'false');
        } catch (error) {
            toast(error.message, true);
        }
    }

    function newSession() {
        state.session = null;
        state.proposals = [];
        renderAgent([], {});
        $('agentMessage').value = '';
        $('agentHint').textContent = 'The two proposals are saved for this local user.';
    }

    // ── wiring ──────────────────────────────────────────────────────

    function bind() {
        $('ttsStartBtn').addEventListener('click', startServer);
        $('ttsStopBtn').addEventListener('click', stopServer);
        $('ttsRefreshBtn').addEventListener('click', () => loadStatus());
        $('speakBtn').addEventListener('click', speak);
        $('speakModel').addEventListener('change', () => { renderLanguages(); loadVoices(); });
        $('speakRate').addEventListener('input', () => {
            $('rateOut').textContent = `${Number($('speakRate').value || 1).toFixed(2)}×`;
        });
        $('saveAudioBtn').addEventListener('click', saveAudio);
        $('savePack').addEventListener('change', renderSaveBrands);
        $('agentForm').addEventListener('submit', suggest);
        $('agentExamples').addEventListener('click', (event) => {
            const chip = event.target.closest('[data-example]');
            if (!chip) return;
            $('agentMessage').value = chip.getAttribute('data-example') || '';
            $('agentMessage').focus();
        });
        $('newSessionBtn').addEventListener('click', newSession);
        $('historyToggle').addEventListener('click', () => {
            const list = $('historyList');
            list.hidden = !list.hidden;
            $('historyToggle').setAttribute('aria-expanded', String(!list.hidden));
            if (!list.hidden) loadSessions();
        });
        $('agentMessage').addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                suggest();
            }
        });
    }

    async function init() {
        bind();
        renderLanguages();
        await loadStatus();
        await loadPacks();
        await loadSessions({ quiet: true });
        renderAgent([], {});
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
