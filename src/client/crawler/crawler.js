'use strict';
/**
 * crawler.js — brand intake UI.
 *
 * Search (Python + headless Google Maps) → confirm profiles → run the combined
 * crawler as a background job → import the finished ZIP into Asset Studio.
 */
(function () {
    const PLATFORMS = [
        { key: 'instagram', label: 'Instagram', short: 'IG' },
        { key: 'facebook', label: 'Facebook', short: 'FB' },
        { key: 'tiktok', label: 'TikTok', short: 'TT' },
        { key: 'tripadvisor', label: 'Tripadvisor', short: 'TA' },
        { key: 'google', label: 'Google', short: 'G' },
        { key: 'youtube', label: 'YouTube', short: 'YT' },
    ];
    const PHASES = ['website', 'social', 'packaging', 'done'];
    const GROUP_KEY = 'studio.crawler.group.v1';
    const MAX_GROUP = 12;
    const state = {
        status: null,
        candidates: [],
        candidate: null,
        discovery: null,
        run: null,
        poll: null,
        busy: false,
        searchBusy: false,
        runBusy: false,
        source: '',
        groupTargets: [],
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
                else if (key === 'html') node.innerHTML = value;
                else if (key.startsWith('on') && typeof value === 'function') {
                    node.addEventListener(key.slice(2).toLowerCase(), value);
                } else if (value === true) node.setAttribute(key, '');
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
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options,
            body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
        });
        let payload = null;
        try { payload = await response.json(); } catch { /* empty body */ }
        if (!response.ok) {
            const message = payload?.error || `Request failed (${response.status}).`;
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function showStep(name) {
        document.querySelectorAll('.intake-step').forEach((step) => {
            step.hidden = step.dataset.step !== name;
        });
        const step = document.querySelector(`.intake-step[data-step="${name}"]`);
        if (step) step.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

    function setBusy(button, busy, label) {
        if (!button) return;
        if (!button.dataset.label) button.dataset.label = button.textContent.trim();
        button.disabled = busy;
        if (busy && label) button.textContent = label;
        else if (!busy) button.textContent = button.dataset.label || button.textContent;
    }

    function shortUrl(url) {
        if (!url) return '';
        try {
            const parsed = new URL(url);
            return parsed.hostname.replace(/^www\./, '') + (parsed.pathname === '/' ? '' : parsed.pathname);
        } catch {
            return url;
        }
    }

    function sourceLabel(source) {
        return {
            'google-maps': 'Google Maps',
            'google-places': 'Google Places',
            nominatim: 'OpenStreetMap',
            'web-search': 'Web search',
        }[source] || source || 'Search';
    }

    function timeAgo(iso) {
        if (!iso) return '';
        const then = new Date(iso).getTime();
        if (!Number.isFinite(then)) return '';
        const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }

    // ── restaurant group ──────────────────────────────────────────

    function targetKey(target) {
        return String(target?.website || '').replace(/\/+$/, '').toLowerCase();
    }

    function saveGroup() {
        try {
            localStorage.setItem(GROUP_KEY, JSON.stringify(state.groupTargets));
        } catch { /* quota/private mode: the in-memory queue still works */ }
    }

    function loadGroup() {
        try {
            const raw = JSON.parse(localStorage.getItem(GROUP_KEY) || '[]');
            if (!Array.isArray(raw)) return;
            state.groupTargets = raw
                .filter((target) => target && target.name && target.website)
                .slice(0, MAX_GROUP);
        } catch { state.groupTargets = []; }
    }

    function renderGroup() {
        const card = $('groupCard');
        const list = $('groupList');
        if (!card || !list) return;
        const count = state.groupTargets.length;
        card.hidden = count === 0;
        list.textContent = '';
        if (!count) return;
        $('groupHint').textContent = `${count} restaurant${count === 1 ? '' : 's'} queued. The crawler runs them in order and builds one group pack.`;
        $('runGroupBtn').textContent = `Run group (${count})`;
        state.groupTargets.forEach((target, index) => {
            const remove = h('button', {
                type: 'button', class: 'group-remove', title: `Remove ${target.name}`,
                'aria-label': `Remove ${target.name}`, text: '×',
                onClick: () => removeGroupTarget(index),
            });
            list.appendChild(h('div', { class: 'group-item' }, [
                h('span', { class: 'group-index', text: String(index + 1) }),
                h('div', { class: 'group-item-copy' }, [
                    h('strong', { text: target.name }),
                    h('small', { text: [target.city, shortUrl(target.website)].filter(Boolean).join(' · ') }),
                ]),
                remove,
            ]));
        });
    }

    function addGroupTarget(target, { silent = false } = {}) {
        const key = targetKey(target);
        if (!key) throw new Error('A website is required.');
        const index = state.groupTargets.findIndex((item) => targetKey(item) === key);
        if (index >= 0) {
            state.groupTargets[index] = target;
            saveGroup();
            renderGroup();
            if (!silent) setInline($('searchStatus'), `${target.name} updated in the group.`, 'ok');
            return { replaced: true };
        }
        if (state.groupTargets.length >= MAX_GROUP) {
            throw new Error(`A group can contain at most ${MAX_GROUP} restaurants.`);
        }
        state.groupTargets.push(target);
        if (!$('runGroup').value || state.groupTargets.length === 1) {
            $('runGroup').value = target.name;
        }
        saveGroup();
        renderGroup();
        if (!silent) setInline($('searchStatus'), `${target.name} added to the group. Search the next restaurant, or run the group.`, 'ok');
        return { replaced: false };
    }

    function removeGroupTarget(index) {
        const [removed] = state.groupTargets.splice(index, 1);
        if (!removed) return;
        if (!state.groupTargets.length && $('runGroup').value === removed.name) $('runGroup').value = '';
        saveGroup();
        renderGroup();
    }

    function clearGroup() {
        if (!state.groupTargets.length) return;
        if (!window.confirm('Clear the restaurant group?')) return;
        state.groupTargets = [];
        $('runGroup').value = '';
        saveGroup();
        renderGroup();
    }

    function toggleRunGroup() {
        if (!state.groupTargets.length) return;
        state.run = null;
        $('runGroup').value = $('runGroup').value.trim() || state.groupTargets[0].name;
        state.target = null;
        renderRunSummary();
        resetRunPanel();
        showStep('run');
    }

    // ── readiness ──────────────────────────────────────────────────

    async function loadStatus() {
        const box = $('readiness');
        box.dataset.state = '';
        box.textContent = '';
        box.appendChild(h('span', { class: 'readiness-dot' }));
        box.appendChild(h('p', { text: 'Checking the crawler…' }));
        try {
            const status = await api('/api/crawler/status');
            state.status = status;
            box.textContent = '';
            box.appendChild(h('span', { class: 'readiness-dot' }));
            if (!status.available) {
                box.dataset.state = 'error';
                box.appendChild(h('p', {
                    text: 'The crawler is not ready. ' + (status.error || 'Python or the virtualenv is missing.'),
                }));
                return;
            }
            box.dataset.state = 'ready';
            const bits = [
                `Python ${status.pythonVersion || ''}`.trim(),
                status.playwright ? 'Chromium ready' : 'No browser (Maps search unavailable)',
                status.pdftotext ? 'PDF text ready' : 'No pdftotext (PDF menus skipped)',
                status.venv ? 'venv' : 'system Python',
            ].filter(Boolean);
            box.appendChild(h('p', { text: `Crawler ready · ${bits.join(' · ')}` }));
        } catch (error) {
            box.dataset.state = 'error';
            box.textContent = '';
            box.appendChild(h('span', { class: 'readiness-dot' }));
            box.appendChild(h('p', { text: error.message }));
        }
    }

    // ── search ─────────────────────────────────────────────────────

    async function runSearch(event) {
        event?.preventDefault();
        if (state.searchBusy) return;
        const query = $('businessQuery').value.trim();
        const city = $('businessCity').value.trim();
        if (query.length < 2) return;
        state.searchBusy = true;
        $('candidateList').textContent = '';
        setInline($('searchStatus'), 'Searching Google Maps… this can take 10–20 seconds.', 'loading');
        setBusy($('searchBtn'), true, 'Searching…');
        try {
            const result = await api('/api/crawler/search', {
                method: 'POST',
                body: { query, city },
            });
            state.candidates = result.candidates || [];
            state.source = result.provider || '';
            renderCandidates(result);
            setInline($('searchStatus'),
                `${state.candidates.length} ${state.candidates.length === 1 ? 'match' : 'matches'} from ${sourceLabel(result.provider)}.`,
                'ok');
            $('searchHint').textContent = (result.warnings || []).join(' ') || $('searchHint').textContent;
        } catch (error) {
            setInline($('searchStatus'), error.message, 'error');
        } finally {
            state.searchBusy = false;
            setBusy($('searchBtn'), false);
        }
    }

    function renderCandidates(result) {
        const list = $('candidateList');
        list.textContent = '';
        if (!state.candidates.length) {
            list.appendChild(h('div', { class: 'empty-search', text: 'No business found. Add the town, or use the website directly.' }));
            return;
        }
        state.candidates.forEach((candidate) => {
            const meta = h('div', { class: 'candidate-meta' });
            if (candidate.category) meta.appendChild(h('span', { text: candidate.category }));
            if (candidate.rating != null) {
                meta.appendChild(h('span', { text: `${candidate.rating}★${candidate.reviews ? ` · ${candidate.reviews} reviews` : ''}` }));
            }
            if (candidate.address) meta.appendChild(h('span', { text: candidate.address }));
            const card = h('article', { class: 'candidate' }, [
                h('div', {}, [
                    h('h3', { text: candidate.name || 'Unnamed business' }),
                    h('p', { class: 'candidate-website', text: candidate.website || 'No website found — add it manually.' }),
                    meta,
                ]),
                h('button', {
                    type: 'button',
                    class: 'button small',
                    text: 'Use this business',
                    onClick: () => useCandidate(candidate),
                }),
            ]);
            list.appendChild(card);
        });
    }

    function useCandidate(candidate) {
        state.candidate = candidate;
        state.discovery = null;
        $('confirmName').value = candidate.name || '';
        $('confirmWebsite').value = candidate.website || '';
        $('confirmCity').value = candidate.city || $('businessCity').value.trim() || '';
        $('confirmCategory').value = candidate.category || '';
        $('confirmAddress').value = candidate.address || '';
        $('confirmPhone').value = candidate.phone || '';
        if (!state.groupTargets.length) $('runGroup').value = candidate.name || '';
        $('businessCard').textContent = '';
        setInline($('confirmHint'), candidate.website
            ? 'Checking the website for social profiles and contact details…'
            : 'Add the website URL to continue.', candidate.website ? 'loading' : 'error');
        showStep('confirm');
        if (candidate.website) runDiscover();
        else $('confirmWebsite').focus();
    }

    // ── discovery ──────────────────────────────────────────────────

    function skeletonPlatforms() {
        const box = $('platformList');
        box.textContent = '';
        PLATFORMS.forEach((platform) => {
            box.appendChild(h('div', { class: 'platform-row', dataset: { status: 'checking' } }, [
                h('div', { class: 'platform-name' }, [
                    h('strong', { text: platform.label }),
                    h('small', { text: platform.short }),
                ]),
                h('span', { class: 'status-pill', dataset: { status: 'checking' }, text: '…' }),
                h('div', { class: 'platform-detail' }, [
                    h('input', {
                        id: `profile-${platform.key}`,
                        name: `profiles[${platform.key}]`,
                        type: 'url',
                        placeholder: `Paste a ${platform.label} URL`,
                        'aria-label': `${platform.label} URL`,
                        'data-platform': platform.key,
                        disabled: true,
                    }),
                    h('small', { text: 'Checking…' }),
                ]),
            ]));
        });
    }

    async function runDiscover() {
        if (state.busy) return;
        const website = $('confirmWebsite').value.trim();
        if (!website) {
            setInline($('confirmHint'), 'A website is required before the crawler can run.', 'error');
            $('confirmWebsite').focus();
            return;
        }
        state.busy = true;
        setBusy($('rediscoverBtn'), true, 'Checking…');
        setInline($('confirmHint'), 'Reading the website, then checking the social profiles…', 'loading');
        skeletonPlatforms();
        try {
            const candidate = state.candidate || {};
            const discovery = await api('/api/crawler/discover', {
                method: 'POST',
                body: {
                    website,
                    name: $('confirmName').value.trim() || candidate.name || '',
                    city: $('confirmCity').value.trim() || candidate.city || '',
                    category: $('confirmCategory').value.trim() || '',
                    maps: {
                        rating: candidate.rating,
                        reviews: candidate.reviews,
                        address: $('confirmAddress').value.trim() || candidate.address,
                        phone: $('confirmPhone').value.trim() || candidate.phone,
                        placeUrl: candidate.placeUrl,
                    },
                    pages: 6,
                    guessProfiles: $('guessProfiles').checked,
                },
            });
            state.discovery = discovery;
            applyDiscovery(discovery);
            setInline($('confirmHint'), 'Check the details and add any missing profiles, then continue.', '');
        } catch (error) {
            setInline($('confirmHint'), error.message, 'error');
            renderPlatforms([]);
        } finally {
            state.busy = false;
            setBusy($('rediscoverBtn'), false);
        }
    }

    function applyDiscovery(discovery) {
        const business = discovery.business || {};
        if (!$('confirmName').value) $('confirmName').value = business.name || '';
        if (!$('confirmCity').value) $('confirmCity').value = business.city || '';
        if (!$('confirmCategory').value) $('confirmCategory').value = business.category || '';
        if (!$('confirmAddress').value) $('confirmAddress').value = business.address || '';
        if (!$('confirmPhone').value) $('confirmPhone').value = business.phone || '';
        if (!state.groupTargets.length && !$('runGroup').value) $('runGroup').value = business.name || '';
        renderBusinessCard(discovery);
        renderPlatforms(discovery.platforms || []);
    }

    function renderBusinessCard(discovery) {
        const business = discovery.business || {};
        const card = $('businessCard');
        card.textContent = '';
        const stats = h('div', { class: 'business-stats' });
        if (business.rating != null) stats.appendChild(h('span', { text: `${business.rating}★${business.reviews ? ` · ${business.reviews} reviews` : ''}` }));
        if (business.city) stats.appendChild(h('span', { text: business.city }));
        const found = (discovery.platforms || []).filter((row) => row.status === 'found').length;
        stats.appendChild(h('span', { text: `${found} profile${found === 1 ? '' : 's'} found` }));
        card.appendChild(h('div', { class: 'business-mark', text: (business.name || '?').slice(0, 1).toUpperCase() }));
        card.appendChild(h('div', {}, [
            h('h3', { text: business.name || 'Business' }),
            h('p', { text: [business.address, business.website].filter(Boolean).join(' · ') || 'No address found' }),
        ]));
        card.appendChild(stats);
    }

    function renderPlatforms(rows) {
        const byKey = {};
        rows.forEach((row) => { byKey[row.key] = row; });
        const box = $('platformList');
        box.textContent = '';
        const previous = currentProfiles();
        PLATFORMS.forEach((platform) => {
            const row = byKey[platform.key] || { status: 'missing', reason: 'Not checked yet.', url: '', evidence: '' };
            const url = previous[platform.key] || row.url || '';
            const status = url ? 'found' : row.status;
            const detail = h('div', { class: 'platform-detail' }, [
                h('input', {
                    id: `profile-${platform.key}`,
                    name: `profiles[${platform.key}]`,
                    type: 'url',
                    value: url,
                    placeholder: `Paste a ${platform.label} URL`,
                    'data-platform': platform.key,
                    'aria-label': `${platform.label} URL`,
                }),
                h('small', { text: url && row.reason ? row.reason : (row.reason || 'No link found on the website.') }),
            ]);
            const pill = h('span', {
                class: 'status-pill',
                dataset: { status },
                text: status === 'found' ? 'OK' : (status === 'not_checked' ? '—' : 'NO'),
            });
            const wrapper = h('div', { class: 'platform-row', dataset: { status } }, [
                h('div', { class: 'platform-name' }, [
                    h('strong', { text: platform.label }),
                    h('small', { text: row.evidence === 'website' ? 'Linked on site' : (row.evidence === 'google-maps' ? 'Google Maps' : platform.short) }),
                ]),
                pill,
                detail,
            ]);
            const input = detail.querySelector('input');
            input.addEventListener('input', () => {
                const value = input.value.trim();
                const next = value ? 'found' : (row.status === 'not_checked' ? 'not_checked' : 'missing');
                wrapper.dataset.status = next;
                pill.dataset.status = next;
                pill.textContent = next === 'found' ? 'OK' : (next === 'not_checked' ? '—' : 'NO');
                detail.querySelector('small').textContent = value
                    ? 'Added manually.'
                    : (row.reason || 'No link found on the website.');
            });
            box.appendChild(wrapper);
        });
        $('profilesHint').textContent = `${rows.filter((row) => row.status === 'found').length} of ${PLATFORMS.length} profiles found. A missing profile is recorded, not fatal.`;
    }

    function currentProfiles() {
        const out = {};
        document.querySelectorAll('#platformList input[data-platform]').forEach((input) => {
            const value = input.value.trim();
            if (value) out[input.dataset.platform] = value;
        });
        return out;
    }

    function syncTarget() {
        const name = $('confirmName').value.trim();
        const website = $('confirmWebsite').value.trim();
        if (!name) throw new Error('Business name is required.');
        if (!website) throw new Error('Website is required.');
        const address = $('confirmAddress').value.trim();
        const phone = $('confirmPhone').value.trim();
        const emails = (state.discovery?.business?.emails || []).slice(0, 5);
        state.target = {
            name,
            website,
            city: $('confirmCity').value.trim(),
            category: $('confirmCategory').value.trim(),
            region: state.discovery?.business?.region || '',
            country: state.discovery?.business?.country || '',
            profiles: currentProfiles(),
            hints: {
                address,
                phones: phone ? [phone] : [],
                emails,
            },
        };
        return state.target;
    }

    function addCurrentToGroup() {
        try {
            const target = syncTarget();
            addGroupTarget(target);
            const message = `${target.name} added to the group. Search the next restaurant, or run the group.`;
            resetSearchOnly(message);
        } catch (error) {
            setInline($('confirmHint'), error.message, 'error');
        }
    }

    function toRun() {
        try {
            const target = syncTarget();
            state.run = null;
            if (state.groupTargets.length) {
                addGroupTarget(target, { silent: true });
                $('runGroup').value = $('runGroup').value.trim() || state.groupTargets[0].name;
            }
            renderRunSummary();
            resetRunPanel();
            showStep('run');
        } catch (error) {
            setInline($('confirmHint'), error.message, 'error');
        }
    }

    function renderRunSummary() {
        const targets = state.run?.targets?.length ? state.run.targets : state.groupTargets;
        const box = $('runSummary');
        box.textContent = '';
        if (targets.length > 1) {
            box.appendChild(h('strong', { text: `${targets.length} restaurants · one group pack` }));
            targets.forEach((target) => box.appendChild(h('span', {
                text: `${target.name}${target.city ? ` · ${target.city}` : ''}`,
            })));
            return;
        }
        const target = targets[0] || state.target || {};
        const profiles = Object.keys(target.profiles || {});
        [
            target.name,
            target.city,
            shortUrl(target.website),
            `${profiles.length} profile${profiles.length === 1 ? '' : 's'}`,
        ].filter(Boolean).forEach((text) => box.appendChild(h('span', { text })));
    }

    // ── run ────────────────────────────────────────────────────────

    function resetRunPanel() {
        $('runProgress').hidden = true;
        $('runResult').hidden = true;
        $('runLog').textContent = '';
        $('cancelRunBtn').hidden = true;
        $('startRunBtn').disabled = false;
        $('startRunBtn').textContent = 'Start full crawl';
    }

    async function startRun() {
        if (state.runBusy) return;
        state.runBusy = true;
        let target;
        try {
            target = state.groupTargets.length ? state.groupTargets[0] : syncTarget();
        } catch (error) {
            setInline($('confirmHint'), error.message, 'error');
            state.runBusy = false;
            return;
        }
        $('startRunBtn').disabled = true;
        $('startRunBtn').textContent = 'Starting…';
        $('runProgress').hidden = false;
        $('runResult').hidden = true;
        $('runLog').textContent = 'Starting the crawler…';
        $('cancelRunBtn').hidden = false;
        const queued = state.groupTargets.length ? state.groupTargets : [target];
        $('progressTitle').textContent = queued.length > 1
            ? `Crawling ${queued.length} restaurants`
            : `Crawling ${target.name}`;
        $('progressState').dataset.state = 'running';
        $('progressState').textContent = 'running';
        setPhase('website');
        try {
            const run = await api('/api/crawler/runs', {
                method: 'POST',
                body: {
                    ...(state.groupTargets.length ? { targets: state.groupTargets } : { target }),
                    group: $('runGroup').value.trim() || queued[0].name,
                    maxPages: Number($('runPages').value),
                    maxReviews: Number($('runReviews').value),
                    maxPosts: Number($('runPosts').value),
                    social: $('runSocial').checked,
                    browser: $('runBrowser').checked,
                    deep: $('runDeep').checked,
                },
            });
            state.run = run;
            history.replaceState(null, '', `?run=${encodeURIComponent(run.id)}`);
            renderRun(run);
            startPolling();
            loadHistory();
        } catch (error) {
            $('runLog').textContent = error.message;
            $('progressState').dataset.state = 'failed';
            $('progressState').textContent = 'failed';
            $('startRunBtn').disabled = false;
            $('startRunBtn').textContent = 'Start full crawl';
            $('cancelRunBtn').hidden = true;
        } finally {
            state.runBusy = false;
        }
    }

    function setPhase(phase) {
        const current = PHASES.indexOf(phase);
        document.querySelectorAll('#phaseTrack span').forEach((span) => {
            const index = PHASES.indexOf(span.dataset.phase);
            span.classList.toggle('is-active', index === current);
            span.classList.toggle('is-done', index < current || phase === 'done');
        });
    }

    function renderRunQueue(run) {
        const box = $('runQueue');
        const targets = run.targets?.length ? run.targets : state.groupTargets;
        if (!box) return;
        box.hidden = targets.length <= 1;
        box.textContent = '';
        if (targets.length <= 1) return;
        const current = run.currentIndex || (run.state === 'running' ? 1 : 0);
        targets.forEach((target, index) => {
            const position = index + 1;
            let status = 'pending';
            if (run.state === 'done' || position < current) status = 'done';
            else if (run.state === 'failed' && position === current) status = 'failed';
            else if (position === current && run.state === 'running') status = 'current';
            else if (position === current && ['packaging', 'done'].includes(run.phase)) status = 'done';
            box.appendChild(h('div', { class: `run-queue-item${status === 'current' ? ' is-current' : status === 'done' ? ' is-done' : ''}` }, [
                h('span', { class: 'queue-dot' }),
                h('span', { text: `${position}. ${target.name}` }),
                h('span', { class: 'queue-state', text: status }),
            ]));
        });
    }

    function renderRun(run) {
        state.run = run;
        const phase = run.phase || 'website';
        setPhase(phase);
        const labels = {
            starting: 'Starting…',
            website: 'Reading the website…',
            social: 'Collecting reviews and social profiles…',
            packaging: 'Building the brand pack…',
            done: 'Brand pack ready.',
            failed: 'The crawl failed.',
            cancelled: 'The crawl was cancelled.',
        };
        const targets = run.targets?.length ? run.targets : state.groupTargets;
        const currentTarget = run.currentIndex ? targets[run.currentIndex - 1] : null;
        $('progressTitle').textContent = `${labels[phase] || 'Crawling…'}${targets.length > 1 && currentTarget ? ` · ${currentTarget.name}` : ''}`;
        $('progressState').dataset.state = run.state;
        $('progressState').textContent = run.state;
        renderRunQueue(run);
        $('runLog').textContent = (run.log || []).join('\n') || 'Waiting for output…';
        const log = $('runLog');
        log.scrollTop = log.scrollHeight;
        $('cancelRunBtn').hidden = run.state !== 'running';
        $('startRunBtn').disabled = run.state === 'running';
        $('startRunBtn').textContent = run.state === 'running' ? 'Crawling…' : 'Start full crawl';

        if (run.state === 'done') {
            stopPolling();
            showResult(run);
            loadHistory();
        } else if (run.state === 'failed' || run.state === 'cancelled' || run.state === 'interrupted') {
            stopPolling();
            loadHistory();
            $('runResult').hidden = false;
            $('resultTitle').textContent = run.state === 'cancelled' ? 'Run cancelled.' : 'The crawl stopped.';
            $('resultText').textContent = run.error || 'Open the log for the failing step.';
            const actions = $('resultActions');
            actions.textContent = '';
            actions.appendChild(h('button', {
                type: 'button',
                class: 'button',
                text: 'Try again',
                onClick: () => { resetRunPanel(); startRun(); },
            }));
        }
    }

    function showResult(run) {
        const count = (run.targets || []).length || 1;
        $('runResult').hidden = false;
        $('resultTitle').textContent = count > 1
            ? `${run.group || 'The group'} — ${count} restaurants ready.`
            : `${(run.target || {}).name || 'Brand'} — pack ready.`;
        $('resultText').textContent = [
            run.zip ? `ZIP: ${run.zip}` : '',
            run.outputDir ? `Output: ${run.outputDir}` : '',
        ].filter(Boolean).join(' · ');
        const imported = state.importedPack && state.importedPack.id === run.importedPackId
            ? state.importedPack
            : null;
        if (imported) {
            $('resultText').textContent = [
                run.zip ? `ZIP: ${run.zip}` : '',
                `Imported as “${imported.name}” with ${(imported.brands || []).length} brand${(imported.brands || []).length === 1 ? '' : 's'}.`,
            ].filter(Boolean).join(' · ');
        } else if (run.importedPackId) {
            $('resultText').textContent = [
                run.zip ? `ZIP: ${run.zip}` : '',
                'Imported into Asset Studio.',
            ].filter(Boolean).join(' · ');
        }
        const actions = $('resultActions');
        actions.textContent = '';
        if (run.importedPackId) {
            actions.appendChild(h('a', {
                class: 'button primary',
                href: `asset-studio.html?pack=${encodeURIComponent(run.importedPackId)}`,
                text: 'Open in Asset Studio',
            }));
        } else {
            const importBtn = h('button', {
                type: 'button',
                class: 'button primary',
                text: 'Import into Asset Studio',
            });
            importBtn.addEventListener('click', () => importRun(run, importBtn));
            actions.appendChild(importBtn);
        }
        actions.appendChild(h('a', {
            class: 'button',
            href: `/api/crawler/runs/${encodeURIComponent(run.id)}/zip`,
            text: 'Download ZIP',
        }));
        actions.appendChild(h('button', {
            type: 'button',
            class: 'button',
            text: 'Start another',
            onClick: resetIntake,
        }));
    }

    async function importRun(run, button) {
        button.disabled = true;
        button.textContent = 'Importing…';
        try {
            const result = await api(`/api/crawler/runs/${encodeURIComponent(run.id)}/import`, { method: 'POST' });
            const pack = result.pack || {};
            state.importedPack = pack;
            state.run = { ...run, importedPackId: pack.id || run.importedPackId };
            showResult(state.run);
            loadHistory();
        } catch (error) {
            button.disabled = false;
            button.textContent = 'Import into Asset Studio';
            $('resultText').textContent = error.message;
        }
    }

    function startPolling() {
        stopPolling();
        state.poll = setInterval(async () => {
            if (!state.run) return;
            try {
                const run = await api(`/api/crawler/runs/${encodeURIComponent(state.run.id)}`);
                renderRun(run);
            } catch (error) {
                $('runLog').textContent = (($('runLog').textContent || '') + `\n${error.message}`).trim();
            }
        }, 2000);
    }

    function stopPolling() {
        if (state.poll) clearInterval(state.poll);
        state.poll = null;
    }

    async function cancelRun() {
        if (!state.run) return;
        $('cancelRunBtn').disabled = true;
        try {
            const run = await api(`/api/crawler/runs/${encodeURIComponent(state.run.id)}/cancel`, { method: 'POST' });
            renderRun(run);
        } finally {
            $('cancelRunBtn').disabled = false;
        }
    }

    // ── history ────────────────────────────────────────────────────

    async function loadHistory() {
        const box = $('runHistory');
        try {
            const data = await api('/api/crawler/runs');
            const runs = data.runs || [];
            box.textContent = '';
            if (!runs.length) {
                box.appendChild(h('p', { class: 'hint', text: 'No runs yet.' }));
                return;
            }
            runs.slice(0, 8).forEach((run) => {
                const item = h('button', { type: 'button', class: 'run-history-item' }, [
                    h('strong', { text: run.name || run.group || run.id }),
                    h('span', { class: 'history-state', dataset: { state: run.state }, text: run.state }),
                    h('small', { text: `${timeAgo(run.startedAt)}${run.error ? ` · ${run.error}` : ''}` }),
                ]);
                item.addEventListener('click', () => openRun(run.id));
                box.appendChild(item);
            });
        } catch (error) {
            box.textContent = '';
            box.appendChild(h('p', { class: 'hint', text: error.message }));
        }
    }

    async function openRun(id) {
        try {
            const run = await api(`/api/crawler/runs/${encodeURIComponent(id)}`);
            state.run = run;
            showStep('run');
            $('runProgress').hidden = false;
            $('runResult').hidden = true;
            renderRunSummary();
            renderRun(run);
            if (run.state === 'running') startPolling();
            else if (run.state === 'done') showResult(run);
            history.replaceState(null, '', `?run=${encodeURIComponent(id)}`);
        } catch (error) {
            $('runLog').textContent = error.message;
        }
    }

    function resetSearchOnly(message = '') {
        state.candidate = null;
        state.discovery = null;
        state.target = null;
        state.candidates = [];
        $('candidateList').textContent = '';
        $('businessCard').textContent = '';
        $('platformList').textContent = '';
        $('confirmName').value = '';
        $('confirmWebsite').value = '';
        $('confirmCity').value = '';
        $('confirmCategory').value = '';
        $('confirmAddress').value = '';
        $('confirmPhone').value = '';
        $('businessQuery').value = '';
        $('businessCity').value = '';
        $('manualForm').hidden = true;
        $('manualWebsite').value = '';
        $('manualName').value = '';
        resetRunPanel();
        showStep('search');
        history.replaceState(null, '', location.pathname);
        setInline($('searchStatus'), message, message ? 'ok' : '');
        $('businessQuery').focus();
    }

    function resetIntake() {
        stopPolling();
        state.run = null;
        state.groupTargets = [];
        saveGroup();
        renderGroup();
        resetSearchOnly();
        $('runGroup').value = '';
        setInline($('searchStatus'), '');
        history.replaceState(null, '', location.pathname);
    }

    // ── wiring ─────────────────────────────────────────────────────

    function wire() {
        $('searchForm').addEventListener('submit', runSearch);
        $('manualToggle').addEventListener('click', () => {
            const form = $('manualForm');
            form.hidden = !form.hidden;
            if (!form.hidden) $('manualWebsite').focus();
        });
        $('manualForm').addEventListener('submit', (event) => {
            event.preventDefault();
            const website = $('manualWebsite').value.trim();
            const name = $('manualName').value.trim() || $('businessQuery').value.trim();
            if (!website) return;
            // Leave the name empty when the user did not supply one; discovery
            // fills it from the site's own metadata.
            useCandidate({ name, website, source: 'manual' });
        });
        $('backToSearch').addEventListener('click', resetIntake);
        $('backToConfirm').addEventListener('click', () => showStep('confirm'));
        $('toRunBtn').addEventListener('click', toRun);
        $('addToGroupBtn').addEventListener('click', addCurrentToGroup);
        $('runGroupBtn').addEventListener('click', toggleRunGroup);
        $('clearGroup').addEventListener('click', clearGroup);
        $('rediscoverBtn').addEventListener('click', runDiscover);
        $('guessProfiles').addEventListener('change', () => {
            if (state.candidate?.website) runDiscover();
        });
        $('startRunBtn').addEventListener('click', startRun);
        $('cancelRunBtn').addEventListener('click', cancelRun);
        $('refreshRuns').addEventListener('click', loadHistory);
        window.addEventListener('beforeunload', stopPolling);
    }

    async function init() {
        wire();
        loadGroup();
        renderGroup();
        loadStatus();
        loadHistory();
        const params = new URLSearchParams(location.search);
        if (params.get('run')) openRun(params.get('run'));
        $('businessQuery').focus();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
