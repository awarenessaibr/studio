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

    const assetTemplate = (() => {
        try {
            const raw = sessionStorage.getItem('assetStudio.openTemplate');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.layers)) return parsed;
            return null;
        } catch {
            return null;
        }
    })();
    if (assetTemplate) {
        try {
            sessionStorage.removeItem('assetStudio.openTemplate');
            studio.openComposition(assetTemplate, { projectMeta: assetTemplate.meta || null });
            studio.setStatus(`Opened “${assetTemplate.name}” from Asset Studio as an editable foundation template.`);
        } catch (error) {
            console.warn('[studio-v2] asset template failed to open:', error);
        }
    }

    const $ = (id) => document.getElementById(id);
    const tree = $('segTree');
    const canvas = $('layerCanvas');
    const viewport = $('layerCanvasViewport');
    const stage = canvas.closest('.layer-stage');
    const PRESETS = (window.LayerStudio && window.LayerStudio.PRESET_NAMES)
                || ['breathe', 'idle', 'sway', 'walk', 'float', 'flicker', 'drift', 'pulse', 'fadeIn', 'parallax'];
    const PRESET_LABELS = (window.LayerStudio && window.LayerStudio.PRESET_LABELS) || {};
    const open = new Set();
    let editingRename = null;
    let organizerModels = [];
    let organizerSuggestions = [];
    let organizerThumbnails = new Map();
    let organizerTargetComposition = null;
    let textureTargetLayer = null;
    let textureTargetComposition = null;
    let textureFile = null;
    let texturePreviewObjectUrl = null;
    let textureBusy = false;
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

    function beginRename(kind, id, label) {
        editingRename = { kind, id, value: label };
        render();
        const input = tree.querySelector('[data-rename-input]');
        input?.focus();
        input?.select();
    }

    function finishRename(save) {
        if (!editingRename) return;
        const edit = editingRename;
        const input = tree.querySelector('[data-rename-input]');
        const value = input?.value.trim() || '';
        if (!save) {
            editingRename = null;
            render();
            return;
        }
        const maxLength = edit.kind === 'group' ? 80 : 160;
        if (!value || value.length > maxLength) {
            studio.setStatus(`Enter a ${edit.kind === 'group' ? 'group' : 'segment'} name between 1 and ${maxLength} characters.`, true);
            input?.focus();
            return;
        }
        if (edit.kind === 'group') {
            const group = model().groups.find((item) => item.key === edit.id);
            if (!group) {
                editingRename = null;
                render();
                return;
            }
            if (model().groups.some((item) => item.key !== edit.id && item.label.toLowerCase() === value.toLowerCase())) {
                studio.setStatus('A group with that name already exists.', true);
                input?.focus();
                return;
            }
            group.items.forEach((layer) => { layer.segmentGroup = value; });
            open.add(value.toLowerCase());
            studio.setStatus(`Renamed group to "${value}".`);
        } else {
            const layer = studio.getLayer(edit.id);
            if (!layer) {
                editingRename = null;
                render();
                return;
            }
            layer.name = value;
            studio.setStatus(`Renamed segment to "${value}".`);
        }
        editingRename = null;
        studio.render();
        render();
        studio.scheduleSave();
    }

    function nameControl(label, subtitle, kind, id) {
        const name = el('span', { className: 'seg-name' });
        if (editingRename?.kind === kind && editingRename.id === id) {
            const input = el('input', { className: 'seg-rename-input', value: editingRename.value });
            input.dataset.renameInput = 'true';
            input.setAttribute('aria-label', `Rename ${kind === 'group' ? 'group' : 'segment'}`);
            name.append(input);
        } else {
            name.append(document.createTextNode(label));
        }
        if (subtitle) name.append(el('small', { className: 'seg-sub', textContent: subtitle }));
        return name;
    }

    function renameControls(kind, id, label) {
        if (editingRename?.kind === kind && editingRename.id === id) {
            return [
                button('fa-check', `Save ${kind} name`, 'save-rename'),
                button('fa-times', 'Cancel rename', 'cancel-rename'),
            ];
        }
        return [button('fa-pen', `Rename ${kind === 'group' ? 'group ' : ''}${label}`, `rename-${kind}`, {
            [kind === 'group' ? 'key' : 'id']: id,
        })];
    }

    function moveLayer(id, targetId, after, groupLabel) {
        const layer = studio.getLayer(id);
        const target = studio.getLayer(targetId);
        if (!layer || !target || layer === target || target.rig === true) return false;
        const comp = studio.composition;
        const ordered = comp.layers
            .filter((item) => item.rig !== true)
            .sort((a, b) => b.z - a.z);
        const from = ordered.indexOf(layer);
        ordered.splice(from, 1);
        const targetIndex = ordered.indexOf(target);
        ordered.splice(targetIndex + (after ? 1 : 0), 0, layer);
        if (groupLabel) layer.segmentGroup = groupLabel;
        ordered.forEach((item, index) => { item.z = ordered.length - index; });
        studio.render();
        render();
        studio.scheduleSave();
        studio.setStatus(`Moved "${layer.name}".`);
        return true;
    }

    function duplicateLayer(id) {
        const layer = studio.getLayer(id);
        if (!layer || layer.rig === true || layer.id === studio.composition.referenceLayerId) return;
        if (studio.composition.layers.length >= 500) {
            studio.setStatus('You can add up to 500 layers to one composition.', true);
            return;
        }
        const originalBase = layer.name.replace(/[\s_-]*\d+$/, '').trim() || layer.name;
        const baseName = originalBase.slice(0, 150).trimEnd() || 'Segment';
        const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sequence = new RegExp(`^${escapedBase}[\\s_-]+(\\d+)$`, 'i');
        let next = 1;
        studio.composition.layers.forEach((item) => {
            if (item.name.toLowerCase() === originalBase.toLowerCase()) {
                next = Math.max(next, 1);
                return;
            }
            const match = sequence.exec(item.name);
            if (match) next = Math.max(next, Number(match[1]) || 1);
        });
        const duplicate = structuredClone(layer);
        do {
            duplicate.id = `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        } while (studio.getLayer(duplicate.id));
        const suffix = ` ${next + 1}`;
        duplicate.name = `${baseName.slice(0, 160 - suffix.length).trimEnd()}${suffix}`;
        if (layer.z >= 1000) {
            studio.composition.layers
                .filter((item) => item.rig !== true && item.z >= 1000)
                .forEach((item) => { item.z = 999.99; });
            duplicate.z = 1000;
        } else {
            duplicate.z = layer.z + 1;
        }
        studio.composition.layers.push(duplicate);
        (studio.composition.formats || []).forEach((format) => {
            const override = format.layerOverrides?.[layer.id];
            if (override) format.layerOverrides[duplicate.id] = structuredClone(override);
        });
        studio.selectedLayerId = duplicate.id;
        studio.render();
        render();
        studio.scheduleSave();
        studio.setStatus(`Duplicated "${layer.name}" as "${duplicate.name}" in the same group.`);
    }

    async function createVideoPosterDataUrl(file) {
        if (!file || (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v|mkv|ogv)$/i.test(file.name || ''))) return null;
        const objectUrl = URL.createObjectURL(file);
        try {
            const video = document.createElement('video');
            video.preload = 'auto';
            video.muted = true;
            video.playsInline = true;
            video.src = objectUrl;
            await new Promise((resolve, reject) => {
                const onLoaded = () => {
                    video.removeEventListener('error', onError);
                    resolve();
                };
                const onError = () => {
                    video.removeEventListener('loadeddata', onLoaded);
                    reject(new Error(`Could not load the video preview for ${file.name}.`));
                };
                video.addEventListener('loadeddata', onLoaded, { once: true });
                video.addEventListener('error', onError, { once: true });
            });
            const width = video.videoWidth || 1;
            const height = video.videoHeight || 1;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) return null;
            if (Number.isFinite(video.duration) && video.duration > 0) {
                video.currentTime = Math.min(video.duration * 0.1, Math.max(0, video.duration - 0.05));
                await new Promise((resolve) => {
                    const onSeeked = () => {
                        video.removeEventListener('error', onError);
                        resolve();
                    };
                    const onError = () => {
                        video.removeEventListener('seeked', onSeeked);
                        resolve();
                    };
                    video.addEventListener('seeked', onSeeked, { once: true });
                    video.addEventListener('error', onError, { once: true });
                });
            }
            context.drawImage(video, 0, 0, width, height);
            return canvas.toDataURL('image/jpeg', 0.82);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    async function replaceLayerImage(id, file) {
        const layer = studio.getLayer(id);
        if (!layer || layer.type !== 'image') {
            studio.setStatus('Select an image segment to replace.', true);
            return;
        }
        const isVideo = file && (file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv|ogv)$/i.test(file.name || ''));
        if (!file || (!/^image\/(?:png|jpe?g|webp|gif|svg\+xml)$/i.test(file.type) && !isVideo)) {
            studio.setStatus('Choose a PNG, JPEG, WebP, GIF, SVG image, or MP4/WebM video.', true);
            return;
        }
        try {
            const dataUrl = await studio.readFileAsDataURL(file);
            const posterUrl = isVideo ? (await createVideoPosterDataUrl(file)) || dataUrl : dataUrl;
            if (!isVideo && !/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);/i.test(dataUrl)) {
                throw new Error('The selected file is not a supported image.');
            }
            if (isVideo && !/^data:video\//i.test(dataUrl)) {
                throw new Error('The selected file is not a supported video.');
            }
            layer.url = posterUrl;
            layer.videoUrl = isVideo ? dataUrl : '';
            layer.frames = [posterUrl];
            studio.render();
            render();
            studio.scheduleSave();
            studio.setStatus(`Replaced the media in "${layer.name}". Its size and position were preserved.`);
        } catch (error) {
            console.error('[layer-studio] segment media replacement failed:', error);
            studio.setStatus(error.message || 'Could not replace the segment media.', true);
        }
    }

    function setTextureStatus(message, { error = false, busy = false } = {}) {
        const status = $('segmentTextureStatus');
        status.textContent = message;
        status.dataset.error = String(error);
        status.dataset.busy = String(busy);
    }

    function openTextureDialog(id) {
        const layer = studio.getLayer(id);
        if (!layer || layer.type !== 'image' || layer.id === studio.composition.referenceLayerId) {
            studio.setStatus('Choose an image segment to generate a texture variant.', true);
            return;
        }
        textureTargetLayer = layer;
        textureTargetComposition = studio.composition;
        textureFile = null;
        $('segmentTextureFile').value = '';
        $('segmentTextureName').value = '';
        $('segmentTexturePrompt').value = '';
        $('segmentTexturePreview').hidden = true;
        $('segmentTexturePreviewImage').removeAttribute('src');
        $('segmentTextureFileName').textContent = '';
        $('segmentTextureGenerate').disabled = false;
        $('segmentTextureCancel').disabled = false;
        $('segmentTextureClose').disabled = false;
        setTextureStatus('');
        $('segmentTextureDialog').showModal();
    }

    function loadImageElement(url, label) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error(`Could not load "${label}".`));
            if (!String(url).startsWith('data:')) image.crossOrigin = 'anonymous';
            image.src = url;
        });
    }

    async function loadImageDataUrl(url, label, width, height, alphaMaskUrl = null) {
        const image = await loadImageElement(url, label);
        const outputWidth = width || image.naturalWidth;
        const outputHeight = height || image.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error(`Could not prepare "${label}" for ComfyUI.`);
        try {
            context.drawImage(image, 0, 0, outputWidth, outputHeight);
            if (alphaMaskUrl) {
                const mask = await loadImageElement(alphaMaskUrl, `${label} silhouette`);
                context.globalCompositeOperation = 'destination-in';
                context.drawImage(mask, 0, 0, outputWidth, outputHeight);
            }
            return {
                dataUrl: canvas.toDataURL('image/png'),
                width: outputWidth,
                height: outputHeight,
            };
        } catch (error) {
            throw new Error(`Could not read "${label}". Make sure the image is available and can be accessed by this studio.`);
        }
    }

    function textureVariantName(layer, textureName) {
        const base = `${layer.name} - ${textureName}`.slice(0, 160).trim();
        const names = new Set(studio.composition.layers.map((item) => item.name.toLowerCase()));
        if (!names.has(base.toLowerCase())) return base;
        for (let index = 2; index < 1000; index += 1) {
            const suffix = ` ${index}`;
            const candidate = `${base.slice(0, 160 - suffix.length).trimEnd()}${suffix}`;
            if (!names.has(candidate.toLowerCase())) return candidate;
        }
        throw new Error('Could not create a unique name for the generated texture layer.');
    }

    function addTextureVariant(layer, imageUrl, textureName) {
        const composition = studio.composition;
        if (composition.layers.length >= 500) {
            throw new Error('You can add up to 500 layers to one composition.');
        }
        const variant = structuredClone(layer);
        do {
            variant.id = `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        } while (studio.getLayer(variant.id));
        variant.name = textureVariantName(layer, textureName);
        variant.url = imageUrl;
        variant.frames = [imageUrl];
        delete variant.frameUrl;
        const group = model().groups.find((item) => item.items.some((entry) => entry.id === layer.id));
        if (group) variant.segmentGroup = group.label;
        if (layer.z >= 1000) {
            composition.layers
                .filter((item) => item.rig !== true && item.z >= 1000)
                .forEach((item) => { item.z = 999.99; });
            variant.z = 1000;
        } else {
            variant.z = layer.z + 1;
        }
        composition.layers.push(variant);
        (composition.formats || []).forEach((format) => {
            const override = format.layerOverrides?.[layer.id];
            if (override) format.layerOverrides[variant.id] = structuredClone(override);
        });
        studio.selectedLayerId = variant.id;
        studio.render();
        render();
        studio.scheduleSave();
        return variant;
    }

    async function generateTextureVariant() {
        if (textureBusy) return;
        if (!textureFile) {
            setTextureStatus('Choose a texture image first.', { error: true });
            return;
        }
        const layer = textureTargetLayer;
        const composition = textureTargetComposition;
        const textureName = $('segmentTextureName').value.trim();
        if (!textureName) {
            setTextureStatus('Enter a name for this texture.', { error: true });
            return;
        }
        if (studio.composition !== composition || studio.getLayer(layer?.id) !== layer) {
            setTextureStatus('The open project or segment changed. Close this dialog and try again.', { error: true });
            return;
        }
        if (composition.layers.length >= 500) {
            setTextureStatus('This project already has the maximum of 500 layers.', { error: true });
            return;
        }
        textureBusy = true;
        $('segmentTextureGenerate').disabled = true;
        $('segmentTextureCancel').disabled = true;
        $('segmentTextureClose').disabled = true;
        $('segmentTextureFile').disabled = true;
        $('segmentTextureName').disabled = true;
        $('segmentTexturePrompt').disabled = true;
        try {
            setTextureStatus('Preparing the segment and texture images…', { busy: true });
            const [segment, textureDataUrl] = await Promise.all([
                loadImageDataUrl(layer.url, layer.name),
                studio.readFileAsDataURL(textureFile),
            ]);
            const texture = await loadImageDataUrl(textureDataUrl, textureName);
            if (studio.composition !== composition || studio.getLayer(layer.id) !== layer) {
                throw new Error('The open project or segment changed while preparing the images.');
            }
            setTextureStatus('Sending the workflow to ComfyUI…', { busy: true });
            const result = await studio.requestBackend('api/segments/texture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    segmentImage: segment.dataUrl,
                    textureImage: texture.dataUrl,
                    textureName,
                    prompt: $('segmentTexturePrompt').value.trim(),
                }),
            });
            if (studio.composition !== composition || studio.getLayer(layer.id) !== layer) {
                throw new Error('The open project or segment changed while ComfyUI was generating. Nothing was added.');
            }
            if (typeof result.image !== 'string' || !result.image.startsWith('data:image/png;base64,')) {
                throw new Error('ComfyUI did not return a valid PNG image.');
            }
            setTextureStatus('Resizing the result to match the original segment…', { busy: true });
            const generated = await loadImageDataUrl(
                result.image,
                'generated texture',
                segment.width,
                segment.height,
                segment.dataUrl,
            );
            const variant = addTextureVariant(layer, generated.dataUrl, textureName);
            $('segmentTextureDialog').close();
            studio.setStatus(`Generated "${variant.name}" in the "${variant.segmentGroup || model().groups.find((item) => item.items.some((entry) => entry.id === variant.id))?.label || 'Segments'}" group.`);
        } catch (error) {
            console.error('[layer-studio] segment texture generation failed:', error);
            setTextureStatus(error.message || 'Could not generate the texture variant.', { error: true });
        } finally {
            textureBusy = false;
            $('segmentTextureGenerate').disabled = false;
            $('segmentTextureCancel').disabled = false;
            $('segmentTextureClose').disabled = false;
            $('segmentTextureFile').disabled = false;
            $('segmentTextureName').disabled = false;
            $('segmentTexturePrompt').disabled = false;
        }
    }

    function leafRow(layer, child) {
        const row = el('div', { className: 'seg-row', role: 'treeitem', tabIndex: 0 });
        row.draggable = true;
        row.title = 'Drag to reorder or move to another group';
        row.dataset.child = String(child);
        row.dataset.act = 'select';
        row.dataset.id = layer.id;
        row.dataset.ids = layer.id;
        row.dataset.selected = String(layer.id === studio.selectedLayerId);
        row.dataset.hidden = String(!layer.visible);
        row.setAttribute('aria-selected', row.dataset.selected);
        const name = nameControl(
            layer.name,
            layer.type === 'text' ? 'Text' : (!layer.positionConfirmed ? 'Needs review' : ''),
            'layer',
            layer.id,
        );
        if (layer.type === 'text' && !layer.positionConfirmed) {
            name.append(el('small', { className: 'seg-sub', textContent: 'Needs review' }));
        }
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
            ...renameControls('layer', layer.id, layer.name),
            button('fa-copy', `Duplicate ${layer.name}`, 'duplicate-layer', { id: layer.id }),
            ...(layer.type === 'image' ? [button('fa-image', `Replace image for ${layer.name}`, 'replace-image', { id: layer.id })] : []),
            ...(layer.type === 'image' ? [button('fa-wand-magic-sparkles', `Generate a new texture for ${layer.name}`, 'texture-image', { id: layer.id })] : []),
            ...(layer.type === 'image' ? [button('fa-fill-drip', `Fill the holes in ${layer.name} that the segments in front hide`, 'fill-holes', { id: layer.id })] : []),
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
        const name = nameControl(group.label, `${group.items.length} segments`, 'group', group.key);
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
        select.append(new Option('Animate…', ''), ...PRESETS.map((p) => new Option(PRESET_LABELS[p] || p, p)));
        const acts = el('span', { className: 'seg-acts' },
            ...(editingRename?.kind === 'group' && editingRename.id === group.key
                ? renameControls('group', group.key, group.label)
                : [
                    select,
                    ...renameControls('group', group.key, group.label),
                    button(group.items.every((layer) => layer.visible) ? 'fa-eye' : 'fa-eye-slash', `Toggle ${group.label}`, 'eye', { ids: ids.join(' ') }),
                    button('fa-download', `Download ${group.label} as transparent and with-final images`, 'download-group', { key: group.key }),
                    button('fa-chevron-down seg-caret', `${isOpen ? 'Collapse' : 'Expand'} ${group.label}`, 'group', { key: group.key }),
                ]));
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
        if (act === 'rename-layer') return beginRename('layer', target.dataset.id, studio.getLayer(target.dataset.id)?.name || '');
        if (act === 'rename-group') {
            const group = model().groups.find((item) => item.key === target.dataset.key);
            if (group) beginRename('group', group.key, group.label);
            return;
        }
        if (act === 'save-rename') return finishRename(true);
        if (act === 'cancel-rename') return finishRename(false);
        if (act === 'duplicate-layer') return duplicateLayer(target.dataset.id);
        if (act === 'replace-image') {
            const input = $('segmentReplaceInput');
            input.dataset.layerId = target.dataset.id;
            input.click();
            return;
        }
        if (act === 'texture-image') return openTextureDialog(target.dataset.id);
        if (act === 'fill-holes') return openFillDialog(target.dataset.id);
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
        if (!event.target.matches('[data-rename-input]')) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            finishRename(true);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            finishRename(false);
        }
    });

    $('segmentReplaceInput').addEventListener('change', (event) => {
        const input = event.currentTarget;
        const id = input.dataset.layerId;
        const file = input.files?.[0];
        delete input.dataset.layerId;
        input.value = '';
        if (file) replaceLayerImage(id, file);
    });

    $('segmentTextureFile').addEventListener('change', (event) => {
        const file = event.currentTarget.files?.[0] || null;
        if (texturePreviewObjectUrl) URL.revokeObjectURL(texturePreviewObjectUrl);
        texturePreviewObjectUrl = null;
        textureFile = null;
        if (!file) {
            $('segmentTexturePreview').hidden = true;
            setTextureStatus('');
            return;
        }
        if (!/^image\/(?:png|jpeg|webp)$/i.test(file.type)) {
            event.currentTarget.value = '';
            $('segmentTexturePreview').hidden = true;
            setTextureStatus('Choose a PNG, JPEG, or WebP texture image.', { error: true });
            return;
        }
        textureFile = file;
        texturePreviewObjectUrl = URL.createObjectURL(file);
        $('segmentTexturePreviewImage').src = texturePreviewObjectUrl;
        $('segmentTextureFileName').textContent = file.name;
        $('segmentTexturePreview').hidden = false;
        const suggestedName = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
        $('segmentTextureName').value = suggestedName;
        setTextureStatus('');
    });

    const textureDialog = $('segmentTextureDialog');
    $('segmentTextureGenerate').addEventListener('click', generateTextureVariant);
    $('segmentTextureClose').addEventListener('click', () => {
        if (!textureBusy) textureDialog.close();
    });
    $('segmentTextureCancel').addEventListener('click', () => {
        if (!textureBusy) textureDialog.close();
    });
    textureDialog.addEventListener('cancel', (event) => {
        if (textureBusy) event.preventDefault();
    });
    textureDialog.addEventListener('close', () => {
        if (texturePreviewObjectUrl) URL.revokeObjectURL(texturePreviewObjectUrl);
        texturePreviewObjectUrl = null;
        textureFile = null;
        textureTargetLayer = null;
        textureTargetComposition = null;
    });
    textureDialog.addEventListener('click', (event) => {
        if (event.target === textureDialog && !textureBusy) textureDialog.close();
    });

    // ------------------------------------------------------------------
    // Fill holes: rebuild what the segments in front hid
    // ------------------------------------------------------------------
    let fillTargetLayer = null;
    let fillTargetComposition = null;
    let fillResult = null;
    let fillBeforeUrl = '';
    let fillAfterUrl = '';
    let fillView = 'after';
    let fillBusy = false;
    let fillRun = 0;

    function setFillStatus(message, { error = false, busy = false } = {}) {
        const status = $('segmentFillStatus');
        status.textContent = message;
        status.dataset.error = String(error);
        status.dataset.busy = String(busy);
    }

    function showFillPreview(view) {
        fillView = view === 'before' ? 'before' : 'after';
        const ready = fillView === 'before' ? Boolean(fillBeforeUrl) : Boolean(fillAfterUrl);
        const image = $('segmentFillImage');
        image.hidden = !ready;
        if (ready) image.src = fillView === 'before' ? fillBeforeUrl : fillAfterUrl;
        $('segmentFillShowBefore').setAttribute('aria-pressed', String(fillView === 'before'));
        $('segmentFillShowAfter').setAttribute('aria-pressed', String(fillView === 'after'));
    }

    function loadPreviewImage(url) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('The fill preview could not be drawn.'));
            image.src = url;
        });
    }

    function fillNumber(value) {
        return Number(value || 0).toLocaleString();
    }

    function closeFillDialog() {
        fillRun += 1;
        fillBusy = false;
        fillResult = null;
        fillBeforeUrl = '';
        fillAfterUrl = '';
        fillTargetLayer = null;
        fillTargetComposition = null;
        const dialog = $('segmentFillDialog');
        if (dialog.open) dialog.close();
    }

    async function runFill(layerId) {
        const layer = studio.getLayer(layerId);
        const composition = studio.composition;
        if (!layer || !composition) return;
        const engine = window.LayerStudioSegmentFill;
        if (!engine) {
            setFillStatus('The fill engine did not load. Reload the studio and try again.', { error: true });
            return;
        }
        const run = ++fillRun;
        fillBusy = true;
        fillResult = null;
        fillBeforeUrl = '';
        fillAfterUrl = '';
        $('segmentFillApply').disabled = true;
        $('segmentFillClose').disabled = true;
        $('segmentFillCancel').disabled = true;
        $('segmentFillShowBefore').disabled = true;
        $('segmentFillShowAfter').disabled = true;
        $('segmentFillImage').hidden = true;
        $('segmentFillStats').textContent = '';
        try {
            setFillStatus('Finding the pixels the segments in front hide…', { busy: true });
            await new Promise((resolve) => window.setTimeout(resolve, 0));
            const prepared = await engine.analyse(studio, layer);
            if (run !== fillRun || studio.composition !== composition || studio.getLayer(layer.id) !== layer) return;
            fillBeforeUrl = engine.preview(prepared.image, prepared.width, prepared.height, 760);
            showFillPreview('before');
            setFillStatus('Rebuilding the hidden area from the surrounding artwork…', { busy: true });
            await new Promise((resolve) => window.setTimeout(resolve, 0));
            const result = await engine.fill(prepared);
            if (run !== fillRun || studio.composition !== composition || studio.getLayer(layer.id) !== layer) return;
            const afterImage = await loadPreviewImage(result.dataUrl);
            if (run !== fillRun) return;
            fillResult = result;
            fillAfterUrl = engine.preview(afterImage, prepared.width, prepared.height, 760);
            showFillPreview('after');
            const total = prepared.width * prepared.height;
            const share = total ? Math.round(prepared.hiddenPixels / total * 100) : 0;
            let detail = '';
            if (prepared.front.length === 1) {
                detail = `behind "${prepared.front[0]}"`;
            } else {
                detail = `behind ${prepared.front.length} segments in front`;
            }
            $('segmentFillStats').textContent =
                `${fillNumber(prepared.hiddenPixels)} hidden pixels rebuilt (${share}% of the segment), ${detail}.`;
            setFillStatus('Review the result, then apply it. Only the hidden pixels changed.');
            $('segmentFillApply').disabled = false;
        } catch (error) {
            if (run !== fillRun) return;
            console.error('[layer-studio] segment hole fill failed:', error);
            setFillStatus(error.message || 'The holes could not be filled.', { error: true });
        } finally {
            if (run === fillRun) {
                fillBusy = false;
                $('segmentFillClose').disabled = false;
                $('segmentFillCancel').disabled = false;
                $('segmentFillShowBefore').disabled = !fillBeforeUrl;
                $('segmentFillShowAfter').disabled = !fillAfterUrl;
            }
        }
    }

    function openFillDialog(id) {
        const layer = studio.getLayer(id);
        if (!layer || layer.type !== 'image' || layer.id === studio.composition.referenceLayerId) {
            studio.setStatus('Choose an image segment to fill.', true);
            return;
        }
        if (Array.isArray(layer.frames) && layer.frames.length > 1) {
            studio.setStatus('This segment is a sprite; fill each frame before importing it as a sprite.', true);
            return;
        }
        fillTargetLayer = layer;
        fillTargetComposition = studio.composition;
        fillRun += 1;
        fillBusy = false;
        fillResult = null;
        fillBeforeUrl = '';
        fillAfterUrl = '';
        $('segmentFillTitle').textContent = `Fill holes in "${layer.name}"`;
        $('segmentFillSubtitle').textContent = 'Rebuild the part of this segment that the segments in front hide';
        $('segmentFillStats').textContent = '';
        $('segmentFillStatus').textContent = '';
        $('segmentFillImage').hidden = true;
        $('segmentFillImage').removeAttribute('src');
        $('segmentFillApply').disabled = true;
        $('segmentFillShowBefore').disabled = true;
        $('segmentFillShowAfter').disabled = true;
        $('segmentFillShowBefore').setAttribute('aria-pressed', 'false');
        $('segmentFillShowAfter').setAttribute('aria-pressed', 'true');
        $('segmentFillDialog').showModal();
        runFill(layer.id);
    }

    function applyFill() {
        const layer = fillTargetLayer;
        const composition = fillTargetComposition;
        const result = fillResult;
        if (!layer || !result || fillBusy) return;
        if (studio.composition !== composition || studio.getLayer(layer.id) !== layer) {
            setFillStatus('The open project or segment changed. Close this dialog and try again.', { error: true });
            return;
        }
        layer.url = result.dataUrl;
        layer.frames = [result.dataUrl];
        delete layer.frameUrl;
        if (layer.videoUrl) layer.videoUrl = '';
        studio.render();
        render();
        studio.scheduleSave();
        const pixels = fillNumber(result.hiddenPixels);
        closeFillDialog();
        studio.setStatus(`Filled ${pixels} hidden pixels in "${layer.name}". Its size, position and animation were kept.`);
    }

    $('segmentFillShowBefore').addEventListener('click', () => showFillPreview('before'));
    $('segmentFillShowAfter').addEventListener('click', () => showFillPreview('after'));
    $('segmentFillApply').addEventListener('click', applyFill);
    $('segmentFillClose').addEventListener('click', closeFillDialog);
    $('segmentFillCancel').addEventListener('click', closeFillDialog);
    const fillDialog = $('segmentFillDialog');
    fillDialog.addEventListener('close', () => {
        fillRun += 1;
        fillBusy = false;
        fillResult = null;
        fillBeforeUrl = '';
        fillAfterUrl = '';
        fillTargetLayer = null;
        fillTargetComposition = null;
    });
    fillDialog.addEventListener('cancel', (event) => {
        if (fillBusy) event.preventDefault();
    });
    fillDialog.addEventListener('click', (event) => {
        if (event.target === fillDialog && !fillBusy) fillDialog.close();
    });

    tree.addEventListener('dragstart', (event) => {
        const row = event.target.closest('.seg-row[data-id]');
        if (!row || !event.dataTransfer) return;
        event.dataTransfer.setData('text/plain', row.dataset.id);
        event.dataTransfer.effectAllowed = 'move';
        row.dataset.dragging = 'true';
    });
    tree.addEventListener('dragend', (event) => {
        const row = event.target.closest('.seg-row[data-id]');
        if (row) delete row.dataset.dragging;
        tree.querySelectorAll('[data-drop-target="true"]').forEach((item) => {
            delete item.dataset.dropTarget;
        });
    });
    tree.addEventListener('dragover', (event) => {
        const target = event.target.closest('.seg-row[data-act="group"], .seg-row[data-id]');
        if (!target || target.dataset.id === event.dataTransfer?.getData('text/plain')) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        tree.querySelectorAll('[data-drop-target="true"]').forEach((item) => {
            if (item !== target) delete item.dataset.dropTarget;
        });
        target.dataset.dropTarget = 'true';
    });
    tree.addEventListener('dragleave', (event) => {
        const target = event.target.closest('[data-drop-target="true"]');
        if (target && !target.contains(event.relatedTarget)) delete target.dataset.dropTarget;
    });
    tree.addEventListener('drop', (event) => {
        const sourceId = event.dataTransfer?.getData('text/plain');
        const target = event.target.closest('.seg-row[data-act="group"], .seg-row[data-id]');
        if (!sourceId || !target) return;
        event.preventDefault();
        if (target.dataset.act === 'group') {
            const group = model().groups.find((item) => item.key === target.dataset.key);
            const last = group?.items.at(-1);
            if (group && last) moveLayer(sourceId, last.id, true, group.label);
        } else {
            const targetLayer = studio.getLayer(target.dataset.id);
            const group = model().groups.find((item) => item.items.some((item) => item.id === targetLayer?.id));
            const rect = target.getBoundingClientRect();
            moveLayer(sourceId, target.dataset.id, event.clientY >= rect.top + rect.height / 2, group?.label);
        }
        tree.querySelectorAll('[data-drop-target="true"]').forEach((item) => {
            delete item.dataset.dropTarget;
        });
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

    const addButterflyPigButton = $('layerAddButterflyPig');
    const layeredAnimationStatus = $('layeredAnimationStatus');
    addButterflyPigButton?.addEventListener('click', async () => {
        if (addButterflyPigButton.disabled) return;
        addButterflyPigButton.disabled = true;
        layeredAnimationStatus.textContent = 'Loading animation tracks…';
        try {
            if (!window.LayeredAnimation) throw new Error('The layered animation importer did not load.');
            const response = await fetch('/src/client/studio/animations/butterfly-pig/motion-tracks.json');
            if (!response.ok) throw new Error(`Could not load the animation tracks (${response.status}).`);
            const tracks = await response.json();
            const composition = studio.composition;
            const highestZ = composition.layers.reduce((highest, layer) => {
                const z = Number(layer.z);
                return Number.isFinite(z) ? Math.max(highest, z) : highest;
            }, -1);
            const suffix = window.crypto?.randomUUID
                ? window.crypto.randomUUID().replace(/-/g, '').slice(0, 10)
                : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            const imported = window.LayeredAnimation.createLayeredAnimation(
                tracks,
                { width: composition.width, height: composition.height },
                { zStart: Math.min(1000, highestZ + 1), idPrefix: `butterfly-pig-${suffix}` },
            );
            if (composition.layers.length + imported.layers.length > 500) {
                throw new Error('There is not enough room in this composition for all 15 animation subjects.');
            }

            studio.stopPlayback();
            composition.layers.push(...imported.layers);
            composition.duration = Math.max(Number(composition.duration) || 0, imported.duration);
            studio.selectedLayerId = imported.layers.find(
                (layer) => layer.segmentGroup === 'Pig' && layer.opacity > 0,
            )?.id || null;
            studio.animation.currentTime = 0;
            studio.render();
            studio.scheduleSave();
            const message = `Added the pig and ${tracks.butterflies.length} butterflies as ${imported.layers.length} editable layers (${(imported.duration / 1000).toFixed(1)} seconds).`;
            layeredAnimationStatus.textContent = message;
            studio.setStatus(message);
        } catch (error) {
            console.error('[layer-studio] layered animation import failed:', error);
            layeredAnimationStatus.textContent = error.message || 'Could not add the layered animation.';
            studio.setStatus(layeredAnimationStatus.textContent, true);
        } finally {
            addButterflyPigButton.disabled = false;
        }
    });

    const addCyclistRideButton = $('layerAddCyclistRide');
    addCyclistRideButton?.addEventListener('click', async () => {
        if (addCyclistRideButton.disabled) return;
        addCyclistRideButton.disabled = true;
        layeredAnimationStatus.textContent = 'Loading cyclist motion…';
        try {
            if (!window.LayeredAnimation) throw new Error('The layered animation importer did not load.');
            const response = await fetch('/src/client/studio/animations/cyclist/motion-tracks.json');
            if (!response.ok) throw new Error(`Could not load the cyclist animation (${response.status}).`);
            const source = await response.json();
            const composition = studio.composition;
            const existing = source.layers.map((sourceLayer) => composition.layers.find(
                (layer) => layer.name === sourceLayer.name && layer.segmentGroup === sourceLayer.segmentGroup,
            ));
            if (existing.every((layer) => layer?.keyframes?.length)) {
                const message = 'This scene already has the cyclist ride animation.';
                layeredAnimationStatus.textContent = message;
                studio.setStatus(message);
                return;
            }
            if (existing.some((layer) => layer?.keyframes?.length)) {
                throw new Error('Some cyclist layers already have animation. Remove those layers before adding the complete ride.');
            }

            const highestZ = composition.layers.reduce((highest, layer) => {
                const z = Number(layer.z);
                return Number.isFinite(z) ? Math.max(highest, z) : highest;
            }, -1);
            const suffix = window.crypto?.randomUUID
                ? window.crypto.randomUUID().replace(/-/g, '').slice(0, 10)
                : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            const imported = window.LayeredAnimation.createCyclistAnimation(
                source,
                { width: composition.width, height: composition.height },
                { zStart: highestZ + 1, idPrefix: `cyclist-ride-${suffix}` },
            );
            const additions = [];
            imported.layers.forEach((layer) => {
                const match = composition.layers.find(
                    (item) => item.name === layer.name && item.segmentGroup === layer.segmentGroup,
                );
                if (match) {
                    Object.assign(match, layer, { id: match.id, z: match.z });
                } else {
                    additions.push(layer);
                }
            });
            if (composition.layers.length + additions.length > 500) {
                throw new Error('There is not enough room in this composition for the cyclist animation.');
            }
            studio.stopPlayback();
            composition.layers.push(...additions);
            composition.duration = Math.max(Number(composition.duration) || 0, imported.duration);
            studio.selectedLayerId = composition.layers.find(
                (layer) => layer.name === 'cyclist-torso' && layer.segmentGroup === 'Cyclist',
            )?.id || imported.layers[0]?.id || null;
            studio.animation.currentTime = 0;
            studio.render();
            studio.scheduleSave();
            const message = `Added the sidewalk-aligned cyclist ride as ${imported.layers.length} editable layers (${(imported.duration / 1000).toFixed(1)} seconds).`;
            layeredAnimationStatus.textContent = message;
            studio.setStatus(message);
        } catch (error) {
            console.error('[layer-studio] cyclist animation import failed:', error);
            layeredAnimationStatus.textContent = error.message || 'Could not add the cyclist animation.';
            studio.setStatus(layeredAnimationStatus.textContent, true);
        } finally {
            addCyclistRideButton.disabled = false;
        }
    });

    /* ---------- hidden text lines ----------
       A clipping text box silently drops whole lines on export. When a project
       or composition loads with any, offer one accepted repair: grow the box,
       then reduce the type size. The engine does the measuring and the edit. */
    const overflowBanner = $('layerTextOverflowBanner');
    const overflowTitle = $('layerTextOverflowTitle');
    const overflowDetail = $('layerTextOverflowDetail');
    const overflowFix = $('layerTextOverflowFix');
    const overflowReview = $('layerTextOverflowReview');
    const overflowUndo = $('layerTextOverflowUndo');
    let overflowDismissed = '';
    let overflowCompositionId = null;

    const overflowSignature = (report) => (report || [])
        .map((entry) => `${entry.layerId}:${entry.clippedLines}`)
        .join('|');

    function setTextOverflowBanner(report) {
        if (!overflowBanner) return;
        const layers = Array.isArray(report) ? report : [];
        const signature = overflowSignature(layers);
        const undoable = Array.isArray(studio.lastTextRepair) ? studio.lastTextRepair : [];
        if (!layers.length) {
            // After a fit, keep one step of undo visible until it is used or dismissed.
            if (!undoable.length) {
                overflowBanner.hidden = true;
                return;
            }
            overflowBanner.dataset.mode = 'fixed';
            overflowBanner.dataset.signature = '';
            overflowTitle.textContent = `Fitted ${undoable.length} text layer${undoable.length === 1 ? '' : 's'}`;
            overflowDetail.textContent = 'Every line is visible now. Undo restores the previous type sizes and box heights.';
            if (overflowFix) overflowFix.hidden = true;
            if (overflowReview) overflowReview.hidden = true;
            if (overflowUndo) overflowUndo.hidden = false;
            overflowBanner.hidden = false;
            return;
        }
        if (overflowDismissed && signature === overflowDismissed) {
            overflowBanner.hidden = true;
            return;
        }
        const hidden = layers.reduce((total, entry) => total + entry.clippedLines, 0);
        const plural = layers.length === 1 ? '' : 's';
        const lineWord = hidden === 1 ? 'line' : 'lines';
        overflowBanner.dataset.mode = 'fix';
        overflowBanner.dataset.signature = signature;
        overflowTitle.textContent = `${layers.length} text layer${plural} ${layers.length === 1 ? 'has' : 'have'} ${hidden} hidden ${lineWord}`;
        overflowDetail.textContent = `${hidden === 1 ? 'That line is' : 'Those lines are'} dropped when this composition is exported. Fit ${layers.length === 1 ? 'it' : 'them'} automatically, or review ${layers.length === 1 ? 'the layer' : 'each layer'}.`;
        if (overflowFix) overflowFix.hidden = false;
        if (overflowReview) overflowReview.hidden = false;
        // A partial repair can still be undone while the rest is unfixed.
        if (overflowUndo) overflowUndo.hidden = undoable.length === 0;
        overflowBanner.hidden = false;
    }

    function reviewNextHiddenLayer() {
        const report = studio.textOverflowLayers();
        const first = report[0];
        if (!first) {
            setTextOverflowBanner([]);
            return;
        }
        studio.selectedLayerId = first.layerId;
        studio.render();
        studio.setStatus(`Reviewing ${first.name}: ${first.clippedLines} hidden line${first.clippedLines === 1 ? '' : 's'}. Use “Fit hidden lines” in the Text panel.`);
        $('layerInspector')?.scrollIntoView({ block: 'nearest' });
    }

    overflowFix?.addEventListener('click', () => {
        studio.repairTextOverflow();
        setTextOverflowBanner(studio.textOverflowLayers());
    });
    overflowReview?.addEventListener('click', reviewNextHiddenLayer);
    overflowUndo?.addEventListener('click', () => {
        studio.undoTextRepair();
        setTextOverflowBanner(studio.textOverflowLayers());
    });
    $('layerTextOverflowDismiss')?.addEventListener('click', () => {
        if (overflowBanner?.dataset.mode === 'fixed') {
            studio.lastTextRepair = null;
        } else {
            overflowDismissed = overflowBanner?.dataset.signature || overflowSignature(studio.textOverflowLayers());
        }
        if (overflowBanner) overflowBanner.hidden = true;
    });
    document.addEventListener('layerstudio:text-overflow', (event) => {
        // A dismissal only applies to the composition it was made on.
        const compositionId = studio.composition?.id || '';
        if (compositionId !== overflowCompositionId) {
            overflowCompositionId = compositionId;
            overflowDismissed = '';
        }
        setTextOverflowBanner(event.detail?.report || []);
    });
    overflowCompositionId = studio.composition?.id || '';
    setTextOverflowBanner(studio.textOverflowLayers());

    // _.js re-renders its hidden list on every change; use that as the redraw signal.
    let queued = false;
    new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; fitCanvas(); render(); });
    }).observe($('layerList'), { childList: true });
    render();
});
