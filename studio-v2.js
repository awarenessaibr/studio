'use strict';
/**
 * studio-v2.js — the studio page's own behaviour: zoom/fit, the segment tree,
 * group export, the AI organizer dialog, saved projects and the project picker.
 *
 * Loaded from studio-v2.html after _.js and brand-identity.js. The engine
 * (composition, rendering, exports, agent protocol) stays in _.js.
 */
window.addEventListener('DOMContentLoaded', () => {
    if (window.layerStudioShowView) window.layerStudioShowView();
    const studio = window.layerStudio;
    if (!studio) return;

    const $ = (id) => document.getElementById(id);
    const tree = $('segTree');
    const canvas = $('layerCanvas');
    const viewport = $('layerCanvasViewport');
    const stage = canvas.closest('.layer-stage');
    const PRESETS = (window.LayerStudio && window.LayerStudio.PRESET_NAMES)
                || ['breathe', 'idle', 'sway', 'walk', 'float', 'flicker', 'drift', 'pulse', 'fadeIn', 'parallax'];
    const open = new Set();
    let organizerModels = [];
    let organizerSuggestions = [];
    let organizerThumbnails = new Map();
    let organizerTargetComposition = null;
    let filter = '';
    let allOpen = false;
    let zoom = 1;
    let fitSize = null;
    const minZoom = 0.1;
    const maxZoom = 4;
    const zoomStep = 0.1;

    function renderZoom() {
        canvas.style.setProperty('--ls-canvas-zoom', String(zoom));
        if (fitSize) {
            viewport.style.width = `${fitSize.width * zoom}px`;
            viewport.style.height = `${fitSize.height * zoom}px`;
        }
        $('layerZoomValue').value = `${Math.round(zoom * 100)}%`;
        $('layerZoomValue').textContent = `${Math.round(zoom * 100)}%`;
        $('layerZoomOut').disabled = zoom <= minZoom;
        $('layerZoomIn').disabled = zoom >= maxZoom;
    }

    function fitCanvas() {
        const stageStyle = getComputedStyle(stage);
        const availableWidth = stage.clientWidth
            - Number.parseFloat(stageStyle.paddingLeft)
            - Number.parseFloat(stageStyle.paddingRight);
        const availableHeight = stage.clientHeight
            - Number.parseFloat(stageStyle.paddingTop)
            - Number.parseFloat(stageStyle.paddingBottom);
        const format = studio.activeFormat() || studio.composition;
        const ratio = format.width / format.height;
        if (!(availableWidth > 0 && availableHeight > 0 && ratio > 0)) return;
        const width = Math.max(1, Math.floor(Math.min(availableWidth, availableHeight * ratio)));
        fitSize = { width, height: Math.max(1, Math.floor(width / ratio)) };
        canvas.style.width = `${fitSize.width}px`;
        canvas.style.height = `${fitSize.height}px`;
        renderZoom();
    }

    function setZoom(value) {
        zoom = Math.min(maxZoom, Math.max(minZoom, Math.round(value * 100) / 100));
        renderZoom();
    }

    $('layerZoomOut').addEventListener('click', () => setZoom(zoom - zoomStep));
    $('layerZoomIn').addEventListener('click', () => setZoom(zoom + zoomStep));
    $('layerZoomFit').addEventListener('click', () => setZoom(1));
    stage.addEventListener('wheel', (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        setZoom(zoom + (event.deltaY < 0 ? zoomStep : -zoomStep));
    }, { passive: false });
    fitCanvas();
    new ResizeObserver(fitCanvas).observe(stage);

    const stem = (name) => String(name).replace(/[\s_-]*\d+$/, '').trim() || String(name);
    const el = (tag, props = {}, ...kids) => {
        const node = Object.assign(document.createElement(tag), props);
        kids.forEach((kid) => node.append(kid));
        return node;
    };

    function model() {
        const comp = studio.composition;
        const real = comp.layers.filter((layer) => layer.rig !== true);
        const reference = real.find((layer) => layer.id === comp.referenceLayerId) || null;
        const map = new Map();
        real.forEach((layer) => {
            if (layer === reference) return;
            const label = layer.segmentGroup || stem(layer.name);
            const key = label.toLowerCase();
            if (!map.has(key)) map.set(key, { key, label, items: [] });
            map.get(key).items.push(layer);
        });
        const groups = [...map.values()].map((group) => {
            group.items.sort((a, b) => b.z - a.z);
            group.z = group.items[0].z;
            return group;
        }).sort((a, b) => b.z - a.z);
        return { reference, groups, total: real.length - (reference ? 1 : 0) };
    }

    function thumb(layer) {
        if (layer.type === 'text') {
            const tile = el('span', { className: 'seg-thumb seg-thumb-text' });
            tile.textContent = 'T';
            tile.setAttribute('aria-hidden', 'true');
            return tile;
        }
        return el('img', { className: 'seg-thumb', src: layer.url, alt: '', loading: 'lazy' });
    }

    function button(icon, label, act, data = {}) {
        const b = el('button', { type: 'button', title: label });
        b.setAttribute('aria-label', label);
        b.dataset.act = act;
        Object.assign(b.dataset, data);
        b.append(el('i', { className: `fas ${icon}` }));
        return b;
    }

    function leafRow(layer, child) {
        const row = el('div', { className: 'seg-row', role: 'treeitem', tabIndex: 0 });
        row.dataset.child = String(child);
        row.dataset.act = 'select';
        row.dataset.id = layer.id;
        row.dataset.ids = layer.id;
        row.dataset.selected = String(layer.id === studio.selectedLayerId);
        row.dataset.hidden = String(!layer.visible);
        row.setAttribute('aria-selected', row.dataset.selected);
        const name = el('span', { className: 'seg-name', textContent: layer.name });
        if (layer.type === 'text') name.append(el('small', { className: 'seg-sub', textContent: 'Text' }));
        if (!layer.positionConfirmed) name.append(el('small', { className: 'seg-sub', textContent: 'Needs review' }));
        const activeFormat = studio.activeFormat();
        if (activeFormat && !activeFormat.isMaster
            && activeFormat.layerOverrides
            && activeFormat.layerOverrides[layer.id]) {
            const pin = el('span', { className: 'seg-pin', textContent: 'M' });
            pin.title = `Pinned to ${activeFormat.label}`;
            pin.setAttribute('aria-label', `Pinned to ${activeFormat.label}`);
            name.append(pin);
        }
        const acts = el('span', { className: 'seg-acts' },
            button(layer.visible ? 'fa-eye' : 'fa-eye-slash', `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`, 'eye', { ids: layer.id }),
            button('fa-download', `Download ${layer.name}`, 'download', { id: layer.id }),
            button('fa-trash', `Delete ${layer.name}`, 'delete', { id: layer.id }));
        row.append(el('span', { className: 'seg-dot' }), thumb(layer), name, acts);
        return row;
    }

    function groupRows(group) {
        const frag = document.createDocumentFragment();
        const isOpen = open.has(group.key) || Boolean(filter);
        const ids = group.items.map((layer) => layer.id);
        const selected = group.items.some((layer) => layer.id === studio.selectedLayerId);
        const row = el('div', { className: 'seg-row', role: 'treeitem', tabIndex: 0 });
        row.dataset.child = 'false';
        row.dataset.act = 'group';
        row.dataset.key = group.key;
        row.dataset.ids = ids.join(' ');
        row.dataset.open = String(isOpen);
        row.dataset.partial = String(selected);
        row.dataset.hidden = String(group.items.every((layer) => !layer.visible));
        row.setAttribute('aria-expanded', String(isOpen));
        const name = el('span', { className: 'seg-name', textContent: group.label });
        name.append(el('small', { className: 'seg-sub', textContent: `${group.items.length} segments` }));
        const activeFormat = studio.activeFormat();
        const pinnedCount = activeFormat && !activeFormat.isMaster && activeFormat.layerOverrides
            ? group.items.filter((layer) => activeFormat.layerOverrides[layer.id]).length
            : 0;
        if (pinnedCount) {
            const pin = el('span', { className: 'seg-pin', textContent: 'M' });
            pin.title = `${pinnedCount} layer${pinnedCount === 1 ? '' : 's'} pinned to ${activeFormat.label}`;
            pin.setAttribute('aria-label', pin.title);
            name.append(pin);
        }
        const select = el('select', { title: `Animate all ${group.label}` });
        select.dataset.key = group.key;
        select.setAttribute('aria-label', `Animate all ${group.label}`);
        select.append(new Option('Animate…', ''), ...PRESETS.map((p) => new Option(p, p)));
        const acts = el('span', { className: 'seg-acts' },
            select,
            button(group.items.every((layer) => layer.visible) ? 'fa-eye' : 'fa-eye-slash', `Toggle ${group.label}`, 'eye', { ids: ids.join(' ') }),
            button('fa-download', `Download ${group.label} as transparent and with-final images`, 'download-group', { key: group.key }),
            button('fa-chevron-down seg-caret', `${isOpen ? 'Collapse' : 'Expand'} ${group.label}`, 'group', { key: group.key }));
        row.append(el('span', { className: 'seg-dot' }), thumb(group.items[0]), name, acts);
        frag.append(row);
        if (isOpen) group.items.forEach((layer) => frag.append(leafRow(layer, true)));
        return frag;
    }

    function render() {
        const { reference, groups, total } = model();
        $('segCount').textContent = `${total} segment${total === 1 ? '' : 's'} · ${groups.length} group${groups.length === 1 ? '' : 's'}`;
        const keepScroll = tree.scrollTop;
        tree.replaceChildren();
        if (reference) {
            const ref = el('button', { type: 'button', className: 'seg-ref' }, thumb(reference), el('span', { className: 'seg-name', textContent: 'Final image' }));
            ref.dataset.act = 'select';
            ref.dataset.id = reference.id;
            ref.dataset.selected = String(reference.id === studio.selectedLayerId);
            ref.querySelector('img').style.cssText = 'width:36px;height:26px';
            const visibility = el('button', { type: 'button', className: 'seg-reference-visibility' });
            visibility.dataset.act = 'eye';
            visibility.dataset.ids = reference.id;
            visibility.setAttribute('aria-pressed', String(reference.visible));
            visibility.setAttribute('aria-label', `${reference.visible ? 'Hide' : 'Show'} final image`);
            visibility.title = `${reference.visible ? 'Hide' : 'Show'} final image`;
            visibility.append(el('i', {
                className: `fas ${reference.visible ? 'fa-eye' : 'fa-eye-slash'}`,
                ariaHidden: 'true',
            }));
            const referenceRow = el('div', { className: 'seg-reference-row' }, ref, visibility);
            referenceRow.dataset.hidden = String(!reference.visible);
            tree.append(referenceRow);
        }
        const needle = filter.toLowerCase();
        const shown = groups.filter((group) => !needle
            || group.label.toLowerCase().includes(needle)
            || group.items.some((layer) => layer.name.toLowerCase().includes(needle)));
        shown.forEach((group) => {
            const view = needle ? { ...group, items: group.items.filter((layer) => layer.name.toLowerCase().includes(needle) || group.label.toLowerCase().includes(needle)) } : group;
            tree.append(groupRows(view));
        });
        if (!shown.length) {
            tree.append(el('p', {
                className: 'seg-empty',
                textContent: total ? 'No segment matches that search.' : 'No segments yet. Pick a project above, or import a ZIP with its final image.',
            }));
        }
        tree.scrollTop = keepScroll;
    }

    function highlight(ids) {
        canvas.querySelectorAll('.ls-hover').forEach((node) => node.classList.remove('ls-hover'));
        ids.forEach((id) => {
            const node = canvas.querySelector(`.layer-item[data-id="${CSS.escape(id)}"]`);
            const layer = studio.getLayer(id);
            if (!node || !layer) return;
            node.dataset.label = layer.name;
            node.classList.add('ls-hover');
        });
    }

    function select(id) {
        studio.selectedLayerId = id;
        studio.render();
    }

    function download(layer) {
        const link = el('a', { href: layer.url, download: `${layer.name.replace(/[^\w.-]+/g, '-')}.png` });
        document.body.append(link);
        link.click();
        link.remove();
    }

    function animateGroup(key, preset) {
        const group = model().groups.find((item) => item.key === key);
        if (!group || !preset) return;
        const keep = studio.selectedLayerId;
        group.items.forEach((layer, i) => {
            const v = 0.7 + ((i * 37) % 7) / 10;
            studio.selectedLayerId = layer.id;
            studio.applyPreset(preset, { amplitude: 2 * v, tilt: 3 * v, distance: preset === 'drift' ? 12 * v : (preset === 'parallax' ? 4 * v : 2 * v) });
        });
        studio.selectedLayerId = keep;
        studio.render();
        studio.setStatus(`"${preset}" applied to ${group.items.length} ${group.label} segments.`);
    }

    tree.addEventListener('click', (event) => {
        if (event.target.closest('select')) return;
        const target = event.target.closest('[data-act]');
        if (!target) return;
        const { act } = target.dataset;
        if (act === 'select') return select(target.dataset.id);
        if (act === 'download-group') {
            studio.exportSegmentGroup(target.dataset.key).catch((error) => {
                console.error('[layer-studio] segment group export failed:', error);
                studio.setStatus(error.message || 'Could not export the segment group.', true);
            });
            return;
        }
        if (act === 'group') {
            const key = target.dataset.key;
            const toggling = event.target.closest('.seg-caret') || event.target.closest('button');
            if (open.has(key)) open.delete(key); else open.add(key);
            if (!toggling) {
                const group = model().groups.find((item) => item.key === key);
                if (group && open.has(key)) return select(group.items[0].id);
            }
            return render();
        }
        if (act === 'eye') {
            const layers = target.dataset.ids.split(' ').map((id) => studio.getLayer(id)).filter(Boolean);
            const show = layers.some((layer) => !layer.visible);
            layers.forEach((layer) => { layer.visible = show; });
            studio.render();
            return studio.scheduleSave();
        }
        if (act === 'download') return download(studio.getLayer(target.dataset.id));
        if (act === 'delete') {
            select(target.dataset.id);
            studio.removeSelected();
        }
    });

    tree.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.seg-row')) {
            event.preventDefault();
            event.target.click();
        }
    });
    tree.addEventListener('change', (event) => {
        if (!event.target.matches('select')) return;
        animateGroup(event.target.dataset.key, event.target.value);
        event.target.value = '';
    });
    tree.addEventListener('mouseover', (event) => {
        const row = event.target.closest('[data-ids]');
        highlight(row ? row.dataset.ids.split(' ') : []);
    });
    tree.addEventListener('mouseleave', () => highlight([]));

    canvas.addEventListener('pointerover', (event) => {
        tree.querySelectorAll('[data-hot="true"]').forEach((row) => { row.dataset.hot = 'false'; });
        const node = event.target.closest('.layer-item');
        if (!node) return;
        const rows = tree.querySelectorAll(`[data-ids~="${CSS.escape(node.dataset.id)}"]`);
        rows.forEach((row) => { row.dataset.hot = 'true'; });
        if (rows.length) rows[rows.length - 1].scrollIntoView({ block: 'nearest' });
    });

    $('segSearch').addEventListener('input', (event) => { filter = event.target.value.trim(); render(); });
    $('segExpand').addEventListener('click', (event) => {
        allOpen = !allOpen;
        open.clear();
        if (allOpen) model().groups.forEach((group) => open.add(group.key));
        event.target.textContent = allOpen ? 'Collapse' : 'Expand';
        render();
    });
    $('segDownloadAll').addEventListener('click', () => {
        studio.exportAllSegments(model().groups);
    });

    const organizerDialog = $('segmentOrganizerDialog');
    const organizerStatus = $('segmentOrganizerStatus');
    const organizerModelSelect = $('segmentOrganizerModel');
    const organizerResults = $('segmentOrganizerResults');
    const organizerApply = $('segmentOrganizerApply');

    function setOrganizerStatus(message, { error = false, busy = false } = {}) {
        organizerStatus.textContent = message;
        organizerStatus.dataset.error = String(error);
        organizerStatus.dataset.busy = String(busy);
    }

    function loadThumbnail(layer) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const thumbnail = document.createElement('canvas');
                const edge = 160;
                const scale = Math.min(edge / image.naturalWidth, edge / image.naturalHeight, 1);
                thumbnail.width = Math.max(1, Math.round(image.naturalWidth * scale));
                thumbnail.height = Math.max(1, Math.round(image.naturalHeight * scale));
                const context = thumbnail.getContext('2d');
                if (!context) {
                    reject(new Error(`Could not prepare a thumbnail for "${layer.name}".`));
                    return;
                }
                context.fillStyle = '#e8e8e8';
                context.fillRect(0, 0, thumbnail.width, thumbnail.height);
                context.drawImage(image, 0, 0, thumbnail.width, thumbnail.height);
                resolve(thumbnail.toDataURL('image/jpeg', 0.75));
            };
            image.onerror = () => reject(new Error(`Could not load the image for "${layer.name}".`));
            if (!layer.url.startsWith('data:')) image.crossOrigin = 'anonymous';
            image.src = layer.url;
        });
    }

    function renderOrganizerSuggestions() {
        organizerResults.replaceChildren();
        organizerSuggestions.forEach((suggestion) => {
            const row = el('div', { className: 'segment-organizer-row' });
            row.dataset.id = suggestion.id;
            const image = el('img', {
                src: organizerThumbnails.get(suggestion.id) || '',
                alt: '',
                loading: 'lazy',
            });
            const nameLabel = el('label', {}, document.createTextNode('Layer name'));
            const nameInput = el('input', { type: 'text', value: suggestion.name, maxLength: 100 });
            nameInput.dataset.field = 'name';
            nameLabel.append(nameInput);
            const groupLabel = el('label', {}, document.createTextNode('Group'));
            const groupInput = el('input', { type: 'text', value: suggestion.group, maxLength: 80 });
            groupInput.dataset.field = 'group';
            groupLabel.append(groupInput);
            row.append(image, nameLabel, groupLabel);
            organizerResults.append(row);
        });
        organizerResults.hidden = organizerSuggestions.length === 0;
        organizerApply.disabled = organizerSuggestions.length === 0;
    }

    $('segOrganize').addEventListener('click', async () => {
        const segments = model().groups.flatMap((group) => group.items);
        if (!segments.length) {
            studio.setStatus('Add or import segments before organizing them.', true);
            return;
        }
        if (segments.length > 120) {
            studio.setStatus('AI organization supports up to 120 segments per request.', true);
            return;
        }
        organizerSuggestions = [];
        organizerThumbnails = new Map();
        organizerTargetComposition = studio.composition;
        organizerResults.replaceChildren();
        organizerResults.hidden = true;
        organizerApply.disabled = true;
        organizerModelSelect.replaceChildren(new Option('Loading available models…', ''));
        $('segmentOrganizerAnalyze').disabled = true;
        setOrganizerStatus('Loading available vision models…', { busy: true });
        organizerDialog.showModal();
        try {
            const catalog = await studio.requestBackend('api/llm/organizer-models');
            organizerModels = Array.isArray(catalog.models) ? catalog.models : [];
            organizerModelSelect.replaceChildren(...organizerModels.map((entry) => new Option(
                `${entry.id} · ${entry.provider === 'ollama' ? 'local' : 'remote'}`,
                `${entry.provider}|${entry.id}`,
            )));
            $('segmentOrganizerAnalyze').disabled = organizerModels.length === 0;
            if (!organizerModels.length) {
                setOrganizerStatus(
                    catalog.error || 'No vision model is available. Start Ollama or configure a remote model on the server.',
                    { error: true },
                );
                return;
            }
            setOrganizerStatus(`${segments.length} segments ready. Choose a model and analyze.`);
        } catch (error) {
            setOrganizerStatus(error.message || 'Could not load vision models.', { error: true });
        }
    });

    $('segmentOrganizerAnalyze').addEventListener('click', async () => {
        if (studio.composition !== organizerTargetComposition) {
            setOrganizerStatus('The open project changed. Close and reopen the organizer for the current project.', { error: true });
            return;
        }
        const [provider, ...modelParts] = (organizerModelSelect.selectedOptions[0]?.value || '').split('|');
        const selectedModel = modelParts.join('|');
        if (!selectedModel) {
            setOrganizerStatus('Choose an available vision model.', { error: true });
            return;
        }
        // The organizer reads imagery; text layers have no pixels to send.
        const layers = model().groups.flatMap((group) => group.items)
            .filter((layer) => layer.type !== 'text');
        const reference = model().reference;
        $('segmentOrganizerAnalyze').disabled = true;
        organizerApply.disabled = true;
        setOrganizerStatus('Preparing thumbnails and asking the model to review the segments…', { busy: true });
        try {
            const layerImages = await Promise.all(layers.map(async (layer) => ({
                id: layer.id,
                name: layer.name,
                image: await loadThumbnail(layer),
            })));
            organizerThumbnails = new Map(layerImages.map((item) => [item.id, item.image]));
            const referenceImage = reference ? await loadThumbnail(reference) : null;
            if (studio.composition !== organizerTargetComposition) {
                throw new Error('The open project changed while preparing the segment thumbnails.');
            }
            setOrganizerStatus('Analyzing segment contents and proposing meaningful groups…', { busy: true });
            const result = await studio.requestBackend('api/segments/organize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider,
                    model: selectedModel,
                    layers: layerImages,
                    reference: referenceImage,
                }),
            });
            if (studio.composition !== organizerTargetComposition) {
                throw new Error('The open project changed before the suggestions returned. Nothing was applied.');
            }
            organizerSuggestions = Array.isArray(result.layers) ? result.layers : [];
            renderOrganizerSuggestions();
            setOrganizerStatus(
                `Review and edit ${organizerSuggestions.length} of ${layers.length} suggestions from ${result.model?.id || selectedModel} before applying.`,
            );
        } catch (error) {
            setOrganizerStatus(error.message || 'Could not organize the segments.', { error: true });
        } finally {
            $('segmentOrganizerAnalyze').disabled = organizerModels.length === 0;
        }
    });

    organizerResults.addEventListener('input', (event) => {
        const row = event.target.closest('.segment-organizer-row');
        const suggestion = organizerSuggestions.find((entry) => entry.id === row?.dataset.id);
        if (suggestion && event.target.dataset.field) suggestion[event.target.dataset.field] = event.target.value;
    });

    organizerApply.addEventListener('click', () => {
        if (studio.composition !== organizerTargetComposition) {
            setOrganizerStatus('The open project changed. Close and reopen the organizer before applying.', { error: true });
            return;
        }
        let applied = 0;
        organizerSuggestions.forEach((suggestion) => {
            const layer = studio.getLayer(suggestion.id);
            if (!layer) return;
            const name = suggestion.name.trim();
            const group = suggestion.group.trim();
            if (name) layer.name = name;
            if (group) layer.segmentGroup = group;
            layer.role = suggestion.role;
            applied += 1;
        });
        studio.render();
        render();
        studio.scheduleSave();
        organizerDialog.close();
        studio.setStatus(
            `Applied names and groups to ${applied} layers. Save the project or export JSON to keep the organization.`,
        );
    });

    $('segmentOrganizerClose').addEventListener('click', () => organizerDialog.close());
    $('segmentOrganizerCancel').addEventListener('click', () => organizerDialog.close());
    organizerDialog.addEventListener('click', (event) => {
        if (event.target === organizerDialog) organizerDialog.close();
    });

    // _.js re-renders its hidden list on every change; use that as the redraw signal.
    let queued = false;
    new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; fitCanvas(); render(); });
    }).observe($('layerList'), { childList: true });
    render();
});
