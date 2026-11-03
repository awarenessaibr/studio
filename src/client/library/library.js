'use strict';
/**
 * library.js — Business Asset Intelligence library, review and operations.
 */
(function () {
    const Intel = window.AssetIntel;
    const state = {
        packs: [],
        brands: [],
        assets: [],
        total: 0,
        selected: new Set(),
        detail: null,
        taxonomy: null,
        health: null,
        filters: {
            q: '', packId: '', brandId: '', class: '', state: '',
            operation: '', verified: false,
        },
    };
    let searchTimer = 0;

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
                else if (key === 'html') node.innerHTML = value;
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
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options,
            body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status}).`);
        return payload;
    }

    const fmtBytes = (bytes) => {
        if (!bytes) return '—';
        if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    };

    const classLabel = (id) => (state.taxonomy?.classes || []).find((entry) => entry.id === id)?.id || id;

    // ── status + taxonomy + packs ───────────────────────────────────

    async function loadStatus() {
        try {
            const [status, taxonomy] = await Promise.all([
                api('/api/assets/status'),
                api('/api/assets/taxonomy'),
            ]);
            state.taxonomy = taxonomy;
            state.health = status.health;
            state.sidecar = status;
            renderTaxonomyOptions();
            updateHealth(status.health);
            const side = $('sidecarStatus');
            side.dataset.state = status.available ? 'ok' : 'off';
            side.textContent = status.available
                ? `Image analysis ready · Pillow ${status.version || ''}${status.ocr ? ' · OCR' : ''}${status.pdftotext ? ' · PDF text' : ''}`
                : `Image analysis off · ${status.reason || 'Python/Pillow unavailable'} · metadata still works`;
        } catch (error) {
            $('sidecarStatus').dataset.state = 'off';
            $('sidecarStatus').textContent = error.message;
        }
    }

    function renderTaxonomyOptions() {
        const classSelect = $('filterClass');
        const uploadClass = $('uploadClass');
        const operation = $('filterOperation');
        (state.taxonomy?.classes || []).forEach((entry) => {
            classSelect.appendChild(h('option', { value: entry.id, text: entry.id.replace(/-/g, ' ') }));
            uploadClass.appendChild(h('option', { value: entry.id, text: entry.id.replace(/-/g, ' ') }));
        });
        (state.taxonomy?.operations || [])
            .filter((entry) => entry.executable !== 'none')
            .forEach((entry) => operation.appendChild(h('option', { value: entry.id, text: entry.label })));
    }

    async function loadPacks() {
        const data = await api('/api/brand-packs');
        state.packs = data.packs || [];
        const filter = $('filterPack');
        const upload = $('uploadPack');
        state.packs.forEach((pack) => {
            filter.appendChild(h('option', { value: pack.id, text: pack.name }));
            upload.appendChild(h('option', { value: pack.id, text: pack.name }));
        });
        const params = new URLSearchParams(location.search);
        if (params.get('packId')) {
            filter.value = params.get('packId');
            state.filters.packId = params.get('packId');
            upload.value = params.get('packId');
        }
        await populateBrands(state.filters.packId || $('filterPack').value);
        if (params.get('brandId')) {
            $('filterBrand').value = params.get('brandId');
            state.filters.brandId = params.get('brandId');
        }
        if (params.get('class')) {
            $('filterClass').value = params.get('class');
            state.filters.class = params.get('class');
        }
        if (params.get('state')) {
            $('filterState').value = params.get('state');
            state.filters.state = params.get('state');
        }
        renderIndexDialog();
    }

    function allBrands(packId = '') {
        const packs = packId ? state.packs.filter((pack) => pack.id === packId) : state.packs;
        const out = [];
        packs.forEach((pack) => {
            (pack.brands || []).forEach((brand) => out.push({ ...brand, packId: pack.id, packName: pack.name }));
        });
        return out;
    }

    async function populateBrands(packId, target = 'filterBrand') {
        const select = $(target);
        select.textContent = '';
        select.appendChild(h('option', { value: '', text: 'All brands' }));
        allBrands(packId).forEach((brand) => {
            select.appendChild(h('option', { value: brand.id, text: `${brand.name}${packId ? '' : ` · ${brand.packName}`}` }));
        });
        if (target === 'uploadBrand') select.firstChild.textContent = 'No brand';
    }

    function updateHealth(health) {
        if (!health) return;
        state.health = health;
        ['total', 'verified', 'proposed', 'duplicates', 'orphaned', 'drift'].forEach((key) => {
            const id = key === 'drift' ? 'healthDrift' : `health${key[0].toUpperCase()}${key.slice(1)}`;
            const value = key === 'drift' ? health.paletteDrift : health[key];
            if ($(id)) $(id).textContent = String(value ?? '—');
        });
    }

    // ── list ────────────────────────────────────────────────────────

    function queryString() {
        const params = new URLSearchParams();
        const f = state.filters;
        if (f.q) params.set('q', f.q);
        if (f.packId) params.set('packId', f.packId);
        if (f.brandId) params.set('brandId', f.brandId);
        if (f.class) params.set('class', f.class);
        if (f.state) params.set('state', f.state);
        if (f.operation) params.set('operation', f.operation);
        if (f.verified) params.set('verified', '1');
        params.set('limit', '96');
        return params.toString();
    }

    async function loadAssets() {
        $('assetCount').textContent = 'Loading…';
        try {
            const data = await api(`/api/assets?${queryString()}`);
            state.assets = data.assets || [];
            state.total = data.total || 0;
            if (state.filters.state === 'proposed') {
                const order = { 'marketing-collateral': 0, compliance: 1, 'business-document': 2, unclassified: 3 };
                state.assets.sort((a, b) => (order[a.class] ?? 9) - (order[b.class] ?? 9)
                    || (a.fit?.score || 0) - (b.fit?.score || 0));
            }
            state.selected.clear();
            renderGrid();
            $('assetCount').textContent = `${state.total} asset${state.total === 1 ? '' : 's'}`;
            $('emptyState').hidden = state.assets.length > 0;
            $('batchVerify').disabled = true;
            $('selectAll').checked = false;
            if (state.health) updateHealth(state.health);
        } catch (error) {
            $('assetCount').textContent = error.message;
            $('assetGrid').textContent = '';
            $('emptyState').hidden = false;
        }
    }

    function renderGrid() {
        const grid = $('assetGrid');
        grid.textContent = '';
        state.assets.forEach((asset) => {
            const selected = state.selected.has(asset.id);
            const thumb = h('div', { class: 'asset-thumb' });
            const isDoc = /pdf|docx|txt|mp4|mov|wav|mp3|m4a|aac|ogg|flac/.test(asset.format || '');
            if (isDoc) {
                thumb.appendChild(h('span', { class: 'doc-icon', text: asset.format?.toUpperCase() || 'DOC' }));
            } else {
                const image = h('img', { loading: 'lazy', alt: '' });
                image.src = asset.thumb || asset.sourceUrl;
                image.addEventListener('error', () => {
                    if (image.src !== location.origin + asset.sourceUrl) image.src = asset.sourceUrl;
                });
                thumb.appendChild(image);
            }
            if (asset.master?.of) thumb.appendChild(h('span', { class: 'asset-badge', text: 'dup' }));
            const checkbox = h('input', {
                type: 'checkbox', class: 'asset-select', 'aria-label': `Select ${asset.name}`,
            });
            checkbox.checked = selected;
            checkbox.addEventListener('click', (event) => event.stopPropagation());
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) state.selected.add(asset.id);
                else state.selected.delete(asset.id);
                card.classList.toggle('is-selected', checkbox.checked);
                $('batchVerify').disabled = state.selected.size === 0;
            });
            const card = h('article', { class: 'asset-card', dataset: { id: asset.id } }, [
                checkbox,
                thumb,
                h('h3', { text: asset.name, title: asset.name }),
                h('div', { class: 'asset-meta' }, [
                    h('span', { class: 'asset-chips' }, [
                        h('span', { class: 'chip', text: String(asset.class || '').replace(/-/g, ' ') }),
                        asset.fit?.score ? h('span', { class: 'chip', text: `fit ${Math.round(asset.fit.score * 100)}` }) : null,
                    ]),
                    h('span', { class: 'state-dot', dataset: { state: asset.state } }),
                ]),
            ]);
            card.appendChild(h('button', {
                type: 'button', class: 'asset-open', 'aria-label': `Open ${asset.name}`,
                onClick: () => openDetail(asset.id),
            }));
            grid.appendChild(card);
        });
    }

    // ── detail ──────────────────────────────────────────────────────

    async function openDetail(id) {
        $('drawer').hidden = false;
        $('drawerBody').textContent = 'Loading…';
        document.body.style.overflow = 'hidden';
        try {
            const [{ asset }, usage] = await Promise.all([
                api(`/api/assets/${encodeURIComponent(id)}`),
                api(`/api/assets/${encodeURIComponent(id)}/usage`).catch(() => ({ counts: {}, recent: [] })),
            ]);
            state.detail = asset;
            renderDetail(asset, usage);
        } catch (error) {
            $('drawerBody').textContent = error.message;
        }
    }

    function closeDetail() {
        $('drawer').hidden = true;
        state.detail = null;
        if ($('uploadDialog').hidden && $('indexDialog').hidden) document.body.style.overflow = '';
    }

    function section(title, children) {
        return h('section', { class: 'drawer-section' }, [
            h('h3', { text: title }),
            ...(Array.isArray(children) ? children : [children]),
        ]);
    }

    function renderDetail(asset, usage) {
        const body = $('drawerBody');
        body.textContent = '';
        $('drawerTitle').textContent = asset.name;
        $('drawerEyebrow').textContent = `${asset.class.replace(/-/g, ' ')} · ${asset.review.state}`;

        const preview = h('div', { class: 'drawer-preview' });
        if (/wav|mp3|m4a|aac|ogg|flac/.test(asset.identity.format || '')) {
            const audio = h('audio', { controls: true, src: assetUrl(asset, 'original') });
            audio.style.width = '100%';
            preview.appendChild(audio);
        } else if (/pdf|docx|txt|mp4|mov/.test(asset.identity.format || '')) {
            preview.appendChild(h('p', { class: 'hint', text: `${asset.identity.format.toUpperCase()} document` }));
        } else {
            const image = h('img', { alt: asset.name });
            image.src = assetUrl(asset, 'original');
            preview.appendChild(image);
        }
        body.appendChild(preview);

        const codes = Intel.evaluateUsage([asset], {
            profile: asset.usage.profile === 'screen-only' ? 'screen' : 'print',
            surface: 'export',
            size: { n: '' },
        });
        const codeList = h('ul', { class: 'code-list' });
        [...codes.blockers, ...codes.warnings].forEach((code) => {
            codeList.appendChild(h('li', { dataset: { severity: code.severity } }, [
                h('strong', { text: code.severity }), code.message,
            ]));
        });
        body.appendChild(section('Rules for this asset', codeList.children.length
            ? codeList
            : h('p', { class: 'hint', text: 'No rule issues at this level. Print checks use the selected page size.' })));

        const form = h('form', { class: 'drawer-form' });
        const name = h('input', { type: 'text', value: asset.name, maxlength: '120' });
        const role = h('input', { type: 'text', value: asset.role || '', maxlength: '40' });
        const tags = h('input', { type: 'text', value: (asset.tags || []).join(', '), maxlength: '400' });
        const cls = h('select');
        (state.taxonomy?.classes || []).forEach((entry) => {
            const option = h('option', { value: entry.id, text: entry.id.replace(/-/g, ' ') });
            if (entry.id === asset.class) option.selected = true;
            cls.appendChild(option);
        });
        form.append(
            h('div', { class: 'drawer-grid' }, [
                field('Name', name, 'span-2'),
                field('Class', cls),
                field('Role', role),
                field('Tags (comma separated)', tags, 'span-2'),
            ]),
        );

        const profile = h('select');
        ['print-and-screen', 'screen-only', 'print-only', 'reference-only'].forEach((value) => {
            const option = h('option', { value, text: value });
            if (value === asset.usage.profile) option.selected = true;
            profile.appendChild(option);
        });
        const dpi = h('input', { type: 'number', min: '72', max: '600', step: '1', value: asset.usage.printMinDpi });
        const rights = h('select');
        ['brand-owned', 'licensed', 'staff-supplied', 'unknown'].forEach((value) => {
            const option = h('option', { value, text: value });
            if (value === asset.usage.rights) option.selected = true;
            rights.appendChild(option);
        });
        const consent = h('select');
        ['not-applicable', 'granted', 'missing'].forEach((value) => {
            const option = h('option', { value, text: value });
            if (value === asset.usage.consent) option.selected = true;
            consent.appendChild(option);
        });
        const notes = h('textarea', { rows: '3', maxlength: '280' });
        notes.value = asset.usage.notes || '';
        const provenanceKind = h('select');
        ['unknown', 'supplied', 'public', 'extracted', 'inferred'].forEach((value) => {
            const option = h('option', { value, text: value === 'unknown' ? 'unknown — not classified' : value });
            if (value === asset.provenance.kind) option.selected = true;
            provenanceKind.appendChild(option);
        });
        const provenanceConfidence = h('select');
        ['low', 'medium', 'high'].forEach((value) => {
            const option = h('option', { value, text: value });
            if (value === asset.provenance.confidence) option.selected = true;
            provenanceConfidence.appendChild(option);
        });
        form.append(
            h('div', { class: 'drawer-grid' }, [
                field('Usage profile', profile),
                field('Minimum DPI', dpi),
                field('Rights', rights),
                field('Consent', consent),
                field('Provenance', provenanceKind),
                field('Confidence', provenanceConfidence),
                field('Notes', notes, 'span-2'),
            ]),
        );
        const save = h('button', { type: 'submit', class: 'button primary', text: 'Save changes' });
        const actions = h('div', { class: 'drawer-actions' }, [save]);
        form.appendChild(actions);
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                const payload = {
                    name: name.value, class: cls.value, role: role.value,
                    tags: tags.value.split(',').map((tag) => tag.trim()).filter(Boolean),
                    provenance: {
                        ...asset.provenance,
                        kind: provenanceKind.value,
                        confidence: provenanceConfidence.value,
                    },
                    usage: {
                        ...asset.usage, profile: profile.value,
                        printMinDpi: Number(dpi.value) || 300,
                        rights: rights.value, consent: consent.value, notes: notes.value,
                    },
                };
                const result = await api(`/api/assets/${encodeURIComponent(asset.id)}`, { method: 'PATCH', body: payload });
                state.detail = result.asset;
                toast('Asset saved.');
                await openDetail(asset.id);
                await loadAssets();
            } catch (error) {
                toast(error.message, true);
            }
        });
        body.appendChild(section('Record', form));

        const approval = Intel.approvalOf(asset);
        const verifyRow = h('div', { class: 'drawer-actions' }, [
            h('button', {
                type: 'button', class: 'button', text: 'Verify',
                onClick: () => review(asset.id, 'verified'),
            }),
            h('button', {
                type: 'button', class: 'button primary', text: 'Approve for use',
                onClick: () => review(asset.id, 'approved'),
            }),
            h('button', {
                type: 'button', class: 'button danger', text: 'Reject',
                onClick: () => review(asset.id, 'rejected'),
            }),
            h('button', {
                type: 'button', class: 'button', text: 'Analyze image',
                onClick: () => analyze(asset.id),
            }),
        ]);
        body.appendChild(section('Review', [
            h('p', { class: 'hint', text: `State: ${asset.review.state} · by ${asset.review.by || '—'}${asset.review.note ? ` · ${asset.review.note}` : ''}` }),
            h('p', { class: 'hint', text: `Provenance: ${asset.provenance.kind} (${asset.provenance.confidence} confidence)` }),
            h('p', {
                class: 'hint',
                text: approval.usable
                    ? `Usable: yes — ${approval.reason}.`
                    : `Usable: no — ${approval.reason}. Unknown rights block every export until an asset is approved.`,
            }),
            verifyRow,
        ]));

        const kv = h('dl', { class: 'kv' });
        [
            ['Dimensions', asset.identity.width ? `${asset.identity.width} × ${asset.identity.height}` : '—'],
            ['Format', asset.identity.format || '—'],
            ['Size', fmtBytes(asset.identity.bytes)],
            ['Source', asset.source.kind === 'pack' ? 'brand pack (referenced)' : 'upload'],
            ['Pack', asset.binding.packId || '—'],
            ['Brand', asset.binding.brandId || '—'],
            ['Path', asset.source.path || '—'],
            ['SHA-256', asset.identity.sha256 ? `${asset.identity.sha256.slice(0, 16)}…` : '—'],
            ['pHash', asset.identity.pHash || '—'],
            ['Fit', asset.fit?.score != null ? `${Math.round(asset.fit.score * 100)} / 100` : '—'],
            ['Master', asset.master?.of ? `duplicate of ${asset.master.of}` : 'master'],
            ['Usage', `${asset.usage.profile} · ${asset.usage.rights}`],
        ].forEach(([label, value]) => {
            kv.append(h('dt', { text: label }), h('dd', { text: value }));
        });
        body.appendChild(section('Identity', kv));

        const operationActions = h('div', { class: 'drawer-actions' });
        (asset.operations || []).forEach((op) => {
            const meta = state.taxonomy?.operations?.find((entry) => entry.id === op);
            if (!meta || !['sidecar', 'browser'].includes(meta.executable)) return;
            operationActions.appendChild(h('button', {
                type: 'button', class: 'button small', text: meta.label,
                onClick: () => runOperation(asset, op),
            }));
        });
        body.appendChild(section('Operations', [
            h('p', { class: 'hint', text: 'Only operations declared by the asset are executable. Compose means eligible for a design slot; the design does the work.' }),
            operationActions,
            asset.variants?.length ? h('div', { class: 'variant-list' }, asset.variants.map((variant) => h('div', { class: 'variant-row' }, [
                h('span', { text: `${variant.id} · ${variant.width || '?'}×${variant.height || '?'} · ${variant.format}` }),
                h('a', { href: assetUrl(asset, variant.id), target: '_blank', rel: 'noopener', text: 'Open' }),
            ]))) : null,
        ]));

        if (asset.extracted) {
            body.appendChild(section('Extracted content', [
                h('p', { class: 'hint', text: `${asset.extracted.method} · confidence ${Math.round(asset.extracted.confidence * 100)}%` }),
                asset.extracted.rows?.length ? h('pre', { class: 'rows-preview', text: asset.extracted.rows.join('\n') }) : null,
            ]));
        }

        const events = usage?.recent || [];
        body.appendChild(section('Usage', [
            h('p', { class: 'hint', text: `${asset.usageLog?.designs || 0} design saves · ${asset.usageLog?.downloads || 0} downloads${asset.usageLog?.lastUsedAt ? ` · last ${asset.usageLog.lastUsedAt}` : ''}` }),
            events.length ? h('div', { class: 'variant-list' }, events.slice(0, 8).map((event) => h('div', { class: 'variant-row' }, [
                h('span', { text: `${event.action} · ${event.size || 'size n/a'} · ${String(event.at || '').slice(0, 16)}` }),
            ]))) : h('p', { class: 'hint', text: 'No usage events yet.' }),
        ]));
    }

    function field(label, control, extra = '') {
        return h('label', { class: `field ${extra}` }, [h('span', { text: label }), control]);
    }

    const assetUrl = (asset, variant = 'original') => (
        `/api/assets/${encodeURIComponent(asset.id)}/file/${encodeURIComponent(variant)}`
    );

    async function review(id, stateName) {
        try {
            await api(`/api/assets/${encodeURIComponent(id)}/verify`, { method: 'POST', body: { state: stateName } });
            const message = {
                verified: 'Asset verified.',
                approved: 'Asset approved for use.',
                rejected: 'Asset rejected.',
                proposed: 'Asset returned to review.',
            }[stateName] || 'Review updated.';
            toast(message);
            await openDetail(id);
            await loadAssets();
            await loadStatus();
        } catch (error) {
            toast(error.message, true);
        }
    }

    async function analyze(id) {
        try {
            toast('Analyzing image…');
            const result = await api(`/api/assets/${encodeURIComponent(id)}/classify`, { method: 'POST' });
            toast(result.warning || 'Analysis complete.');
            await openDetail(id);
            await loadAssets();
        } catch (error) {
            toast(error.message, true);
        }
    }

    async function runOperation(asset, op) {
        let params = {};
        if (op === 'resize') {
            const width = window.prompt('Target width in pixels', '1200');
            if (!width) return;
            params = { width: Number(width) };
        } else if (op === 'crop') {
            const ratio = window.prompt('Crop ratio (W:H)', '1:1');
            if (!ratio) return;
            params = { ratio };
        } else if (op === 'recolour') {
            const colour = window.prompt('Hex colour for the recolour mask', '#1a1a2e');
            if (!colour) return;
            params = { color: colour };
        }
        try {
            toast(`${op} running…`);
            const result = await api(`/api/assets/${encodeURIComponent(asset.id)}/operations/${op}`, {
                method: 'POST', body: { params },
            });
            toast(result.warning || `${op} complete.`);
            await openDetail(asset.id);
            await loadAssets();
        } catch (error) {
            toast(error.message, true);
        }
    }

    function toast(message, bad = false) {
        let node = $('libToast');
        if (!node) {
            node = h('div', { id: 'libToast', class: 'lib-toast', role: 'status' });
            document.body.appendChild(node);
            const style = document.createElement('style');
            style.textContent = '.lib-toast{position:fixed;left:50%;bottom:22px;z-index:200;max-width:min(520px,calc(100vw - 30px));padding:9px 14px;border-radius:10px;background:#1a1a2e;color:#fffdf9;font-size:11.5px;box-shadow:0 12px 30px rgb(0 0 0 / 22%);transform:translateX(-50%);opacity:0;pointer-events:none;transition:opacity .15s}.lib-toast.is-on{opacity:1}.lib-toast.is-bad{background:#a3342b}';
            document.head.appendChild(style);
        }
        node.textContent = message;
        node.classList.toggle('is-bad', Boolean(bad));
        node.classList.add('is-on');
        clearTimeout(node._timer);
        node._timer = setTimeout(() => node.classList.remove('is-on'), bad ? 5000 : 2600);
    }

    // ── upload ──────────────────────────────────────────────────────

    function openUpload() {
        $('uploadDialog').hidden = false;
        document.body.style.overflow = 'hidden';
        $('uploadFiles').value = '';
        $('uploadPreview').textContent = '';
        $('uploadStatus').textContent = '';
        populateBrands($('uploadPack').value, 'uploadBrand');
        $('uploadFiles').focus();
    }

    function closeUpload() {
        $('uploadDialog').hidden = true;
        if ($('drawer').hidden && $('indexDialog').hidden) document.body.style.overflow = '';
    }

    function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
            reader.readAsDataURL(file);
        });
    }

    async function submitUpload(event) {
        event.preventDefault();
        const files = [...$('uploadFiles').files];
        if (!files.length) {
            $('uploadStatus').textContent = 'Choose at least one file.';
            return;
        }
        $('uploadSubmit').disabled = true;
        $('uploadStatus').textContent = `Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`;
        try {
            const payloadFiles = [];
            for (const file of files) {
                payloadFiles.push({
                    name: file.name,
                    dataUrl: await fileToDataUrl(file),
                    class: $('uploadClass').value || undefined,
                    rights: $('uploadRights').value,
                    consent: $('uploadConsent').value,
                });
            }
            const result = await api('/api/assets/ingest', {
                method: 'POST',
                body: {
                    packId: $('uploadPack').value || undefined,
                    brandId: $('uploadBrand').value || undefined,
                    files: payloadFiles,
                },
            });
            $('uploadStatus').textContent = `Added ${result.created?.length || 0} asset${(result.created?.length || 0) === 1 ? '' : 's'}.${result.warnings?.length ? ` ${result.warnings.join(' ')}` : ''}`;
            toast(`Added ${result.created?.length || 0} asset${(result.created?.length || 0) === 1 ? '' : 's'}.`);
            await loadAssets();
            await loadStatus();
            setTimeout(closeUpload, 900);
        } catch (error) {
            $('uploadStatus').textContent = error.message;
        } finally {
            $('uploadSubmit').disabled = false;
        }
    }

    // ── index ───────────────────────────────────────────────────────

    function renderIndexDialog() {
        const list = $('indexPacks');
        list.textContent = '';
        state.packs.forEach((pack) => {
            const button = h('button', { type: 'button', class: 'button small', text: 'Index' });
            button.addEventListener('click', () => indexPack(pack.id, button));
            list.appendChild(h('div', { class: 'index-pack' }, [
                h('div', {}, [h('strong', { text: pack.name }), h('small', { text: `${pack.brandCount || pack.brands?.length || 0} brands` })]),
                button,
            ]));
        });
    }

    async function indexPack(packId, button) {
        if (button) { button.disabled = true; button.textContent = 'Indexing…'; }
        $('indexStatus').textContent = `Indexing ${packId}…`;
        try {
            const result = await api('/api/assets/index-pack', { method: 'POST', body: { packId } });
            $('indexStatus').textContent = `${result.created} created · ${result.skipped} already indexed${result.warnings.length ? ` · ${result.warnings.length} warnings` : ''}.`;
            await loadAssets();
            await loadStatus();
        } catch (error) {
            $('indexStatus').textContent = error.message;
        } finally {
            if (button) { button.disabled = false; button.textContent = 'Index'; }
        }
    }

    async function indexAll() {
        $('indexAll').disabled = true;
        for (const pack of state.packs) {
            // eslint-disable-next-line no-await-in-loop
            await indexPack(pack.id, null);
        }
        $('indexAll').disabled = false;
        $('indexStatus').textContent = 'All packs indexed.';
    }

    // ── wiring ──────────────────────────────────────────────────────

    function bind() {
        $('filterQ').addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                state.filters.q = $('filterQ').value.trim();
                loadAssets();
            }, 220);
        });
        $('filterPack').addEventListener('change', async () => {
            state.filters.packId = $('filterPack').value;
            state.filters.brandId = '';
            await populateBrands(state.filters.packId);
            loadAssets();
        });
        ['filterBrand', 'filterClass', 'filterState', 'filterOperation'].forEach((id) => {
            $(id).addEventListener('change', () => {
                state.filters[id === 'filterBrand' ? 'brandId' : id === 'filterClass' ? 'class' : id === 'filterState' ? 'state' : 'operation'] = $(id).value;
                loadAssets();
            });
        });
        $('filterVerified').addEventListener('change', () => {
            state.filters.verified = $('filterVerified').checked;
            loadAssets();
        });
        $('clearFilters').addEventListener('click', () => {
            state.filters = { q: '', packId: '', brandId: '', class: '', state: '', operation: '', verified: false };
            $('filterQ').value = '';
            $('filterPack').value = '';
            $('filterBrand').value = '';
            $('filterClass').value = '';
            $('filterState').value = '';
            $('filterOperation').value = '';
            $('filterVerified').checked = false;
            populateBrands('');
            loadAssets();
        });
        $('selectAll').addEventListener('change', () => {
            state.selected.clear();
            if ($('selectAll').checked) state.assets.forEach((asset) => state.selected.add(asset.id));
            document.querySelectorAll('.asset-select').forEach((checkbox) => { checkbox.checked = $('selectAll').checked; });
            document.querySelectorAll('.asset-card').forEach((card) => card.classList.toggle('is-selected', $('selectAll').checked));
            $('batchVerify').disabled = state.selected.size === 0;
            $('batchApprove').disabled = state.selected.size === 0;
        });
        $('batchApprove').addEventListener('click', async () => {
            const ids = [...state.selected];
            if (!ids.length) return;
            $('batchApprove').disabled = true;
            for (const id of ids) {
                // eslint-disable-next-line no-await-in-loop
                await api(`/api/assets/${encodeURIComponent(id)}/verify`, { method: 'POST', body: { state: 'approved' } }).catch(() => {});
            }
            toast(`Approved ${ids.length} asset${ids.length === 1 ? '' : 's'} for use.`);
            await loadAssets();
            await loadStatus();
        });
        $('batchVerify').addEventListener('click', async () => {
            const ids = [...state.selected];
            if (!ids.length) return;
            $('batchVerify').disabled = true;
            for (const id of ids) {
                // eslint-disable-next-line no-await-in-loop
                await api(`/api/assets/${encodeURIComponent(id)}/verify`, { method: 'POST', body: { state: 'verified' } }).catch(() => {});
            }
            toast(`Verified ${ids.length} asset${ids.length === 1 ? '' : 's'}.`);
            await loadAssets();
            await loadStatus();
        });
        $('refreshBtn').addEventListener('click', () => { loadAssets(); loadStatus(); });
        $('drawerClose').addEventListener('click', closeDetail);
        $('drawerBackdrop').addEventListener('click', closeDetail);
        $('uploadBtn').addEventListener('click', openUpload);
        $('uploadClose').addEventListener('click', closeUpload);
        $('uploadCancel').addEventListener('click', closeUpload);
        $('uploadBackdrop').addEventListener('click', closeUpload);
        $('uploadForm').addEventListener('submit', submitUpload);
        $('uploadPack').addEventListener('change', () => populateBrands($('uploadPack').value, 'uploadBrand'));
        $('uploadFiles').addEventListener('change', () => {
            $('uploadPreview').textContent = '';
            [...$('uploadFiles').files].slice(0, 12).forEach((file) => {
                $('uploadPreview').appendChild(h('span', { text: `${file.name} · ${fmtBytes(file.size)}` }));
            });
        });
        $('reviewBtn').addEventListener('click', () => {
            state.filters.state = 'proposed';
            $('filterState').value = 'proposed';
            loadAssets();
        });
        $('indexBtn').addEventListener('click', () => {
            $('indexDialog').hidden = false;
            document.body.style.overflow = 'hidden';
            $('indexStatus').textContent = '';
        });
        $('indexClose').addEventListener('click', () => { $('indexDialog').hidden = true; document.body.style.overflow = ''; });
        $('indexCancel').addEventListener('click', () => { $('indexDialog').hidden = true; document.body.style.overflow = ''; });
        $('indexBackdrop').addEventListener('click', () => { $('indexDialog').hidden = true; document.body.style.overflow = ''; });
        $('indexAll').addEventListener('click', indexAll);
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (!$('uploadDialog').hidden) closeUpload();
            else if (!$('indexDialog').hidden) { $('indexDialog').hidden = true; document.body.style.overflow = ''; }
            else if (!$('drawer').hidden) closeDetail();
        });
        const drop = $('dropZone');
        ['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (event) => {
            event.preventDefault(); drop.classList.add('is-over');
        }));
        ['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, (event) => {
            event.preventDefault(); drop.classList.remove('is-over');
        }));
        drop.addEventListener('drop', (event) => {
            if (event.dataTransfer?.files?.length) {
                $('uploadFiles').files = event.dataTransfer.files;
                $('uploadFiles').dispatchEvent(new Event('change'));
            }
        });
    }

    async function init() {
        bind();
        try {
            await loadStatus();
            await loadPacks();
            await loadAssets();
        } catch (error) {
            $('assetCount').textContent = error.message;
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
