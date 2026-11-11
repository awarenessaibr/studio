'use strict';
/**
 * project-timeline.js — the working-variant timeline editor for a project canvas.
 *
 * Pure, dependency-free helpers shared by the page and the tests:
 *
 *   pose(layer, ms)                    the pose at a time, from the layer keyframes
 *   applyEdits(comp, manifest, edits)  relative offsets / absolute poses written to layers
 *   addGeneratedLayer(comp, spec)      a new inline-SVG layer for something the project lacks
 *
 * Relative edits compose on top of the existing animation, so "move the character"
 * does not erase the exit jump that is already in the project. Groups and image
 * sources are expanded to their member layers. Nothing project-specific lives here.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ProjectTimeline = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const r3 = (n) => Math.round(Number(n) * 1000) / 1000;
    const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n)));
    const finite = (n, fallback) => (Number.isFinite(Number(n)) ? Number(n) : fallback);
    const POSE_FIELDS = ['x', 'y', 'w', 'h', 'rotation', 'opacity'];
    const DEFAULT_OFFSET = { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 };

    function basePose(layer) {
        return {
            x: finite(layer.x, 0), y: finite(layer.y, 0),
            w: finite(layer.w, 0), h: finite(layer.h, 0),
            rotation: finite(layer.rotation, 0),
            opacity: layer.opacity === undefined ? 1 : finite(layer.opacity, 1),
        };
    }

    function sorted(layer) {
        return (Array.isArray(layer.keyframes) ? layer.keyframes : [])
            .slice()
            .sort((a, b) => finite(a.time, 0) - finite(b.time, 0));
    }

    /** The pose of one layer at `ms`. Keyframes are merged over the layer's static fields. */
    function pose(layer, ms) {
        const base = basePose(layer);
        const frames = sorted(layer);
        const t = finite(ms, 0);
        if (!frames.length) return base;
        const merge = (frame) => {
            const out = { ...base };
            for (const key of POSE_FIELDS) if (frame[key] !== undefined && Number.isFinite(Number(frame[key]))) out[key] = Number(frame[key]);
            return out;
        };
        if (t <= finite(frames[0].time, 0)) return merge(frames[0]);
        for (let i = 0; i < frames.length - 1; i += 1) {
            const a = frames[i];
            const b = frames[i + 1];
            const at = finite(a.time, 0);
            const to = finite(b.time, at);
            if (t >= at && t < to) {
                const f = (t - at) / ((to - at) || 1);
                const out = {};
                for (const key of POSE_FIELDS) {
                    const start = finite(a[key], base[key]);
                    const end = finite(b[key], start);
                    out[key] = start + (end - start) * f;
                }
                return out;
            }
        }
        return merge(frames[frames.length - 1]);
    }

    /** The value of one offset field at `ms`, interpolated linearly over the edit keyframes. */
    function valueAt(editKeyframes, ms, key, fallback) {
        const frames = (editKeyframes || [])
            .filter((frame) => frame && frame[key] !== undefined && Number.isFinite(Number(frame[key])))
            .slice()
            .sort((a, b) => finite(a.time, 0) - finite(b.time, 0));
        if (!frames.length) return fallback;
        const t = finite(ms, 0);
        if (t <= finite(frames[0].time, 0)) return Number(frames[0][key]);
        for (let i = 0; i < frames.length - 1; i += 1) {
            const a = frames[i];
            const b = frames[i + 1];
            const at = finite(a.time, 0);
            const to = finite(b.time, at);
            if (t < to) {
                const f = (t - at) / ((to - at) || 1);
                return Number(a[key]) + (Number(b[key]) - Number(a[key])) * f;
            }
        }
        return Number(frames[frames.length - 1][key]);
    }

    /**
     * Expand layer ids, group ids and image-source ids to concrete layer ids.
     * Ids that exist only in the working composition (an uploaded image, a
     * generated element) are kept as they are.
     */
    function resolveLayers(manifest, ids, composition) {
        const out = new Set();
        const list = Array.isArray(ids) ? ids : [];
        const groups = (manifest && manifest.groups) || [];
        const parents = (manifest && manifest.parents) || [];
        const entities = (manifest && manifest.entities) || [];
        const known = new Set(((composition && composition.layers) || []).map((layer) => layer.id));
        for (const id of list) {
            const group = groups.find((entry) => entry.id === id);
            if (group) { for (const member of group.members) out.add(member); continue; }
            const parent = parents.find((entry) => entry.id === id);
            if (parent) { for (const child of parent.children) out.add(child); continue; }
            const entity = entities.find((entry) => entry.id === id);
            if (entity) out.add(entity.id);
            else if (known.has(id)) out.add(id);
        }
        return [...out];
    }

    function keyframeFor(time, poseValue, fallback) {
        return {
            time,
            x: r3(finite(poseValue.x, fallback.x)),
            y: r3(finite(poseValue.y, fallback.y)),
            w: r3(finite(poseValue.w, fallback.w)),
            h: r3(finite(poseValue.h, fallback.h)),
            rotation: r3(finite(poseValue.rotation, fallback.rotation)),
            opacity: r3(clamp(finite(poseValue.opacity, fallback.opacity), 0, 1)),
            easing: 'linear',
        };
    }

    /**
     * Write edits into a working composition.
     *
     * edit = {
     *   ids: string[],                  layer, group or image-source ids
     *   relative: boolean,              true = offsets composed on the current animation
     *   pivot: {x, y},                  canvas % around which scale/rotation orbit
     *   keyframes: [{time, dx, dy, scale, rotation, opacity}]        (relative)
     *            | [{time, x, y, w, h, rotation, opacity}]           (absolute)
     * }
     */
    function applyEdits(composition, manifest, edits) {
        if (!composition || !Array.isArray(composition.layers)) throw new Error('The working composition is missing.');
        if (!Array.isArray(edits) || !edits.length) throw new Error('No edits were given.');
        const width = finite(composition.width, 100);
        const height = finite(composition.height, 100);
        const summary = [];
        let earliest = null;

        for (const edit of edits) {
            if (!edit || typeof edit !== 'object') continue;
            const ids = resolveLayers(manifest, edit.ids, composition);
            const layers = ids.map((id) => composition.layers.find((layer) => layer.id === id)).filter(Boolean);
            if (!layers.length) continue;
            const frames = (Array.isArray(edit.keyframes) ? edit.keyframes : [])
                .filter((frame) => frame && Number.isFinite(Number(frame.time)))
                .map((frame) => ({ ...frame, time: Math.max(0, finite(frame.time, 0)) }))
                .sort((a, b) => a.time - b.time);
            if (!frames.length) continue;

            const relative = edit.relative !== false;
            const existingTimes = relative ? layers.flatMap((layer) => sorted(layer).map((frame) => finite(frame.time, 0))) : [];
            const times = [...new Set([...frames.map((frame) => frame.time), ...existingTimes])].sort((a, b) => a - b);
            const next = new Map(layers.map((layer) => [layer, []]));
            const absoluteByTime = new Map(frames.map((frame) => [frame.time, frame]));

            for (const time of times) {
                const poses = layers.map((layer) => pose(layer, time));
                if (!relative) {
                    layers.forEach((layer, index) => {
                        const frame = absoluteByTime.get(time) || {};
                        const current = poses[index];
                        next.get(layer).push(keyframeFor(time, {
                            x: frame.x ?? current.x, y: frame.y ?? current.y,
                            w: frame.w ?? current.w, h: frame.h ?? current.h,
                            rotation: frame.rotation ?? current.rotation,
                            opacity: frame.opacity ?? current.opacity,
                        }, basePose(layer)));
                    });
                    continue;
                }
                const dx = valueAt(frames, time, 'dx', DEFAULT_OFFSET.dx);
                const dy = valueAt(frames, time, 'dy', DEFAULT_OFFSET.dy);
                const scale = Math.max(0.01, valueAt(frames, time, 'scale', DEFAULT_OFFSET.scale));
                const degrees = valueAt(frames, time, 'rotation', DEFAULT_OFFSET.rotation);
                const alpha = clamp(valueAt(frames, time, 'opacity', DEFAULT_OFFSET.opacity), 0, 1);
                const radians = degrees * Math.PI / 180;
                const single = layers.length === 1;
                const x0 = Math.min(...poses.map((p) => p.x));
                const x1 = Math.max(...poses.map((p) => p.x + p.w));
                const y0 = Math.min(...poses.map((p) => p.y));
                const y1 = Math.max(...poses.map((p) => p.y + p.h));
                const pivotX = (edit.pivot && Number.isFinite(Number(edit.pivot.x)) ? Number(edit.pivot.x)
                    : single ? poses[0].x + poses[0].w / 2 : (x0 + x1) / 2) / 100 * width;
                const pivotY = (edit.pivot && Number.isFinite(Number(edit.pivot.y)) ? Number(edit.pivot.y)
                    : single ? poses[0].y + poses[0].h / 2 : (y0 + y1) / 2) / 100 * height;
                layers.forEach((layer, index) => {
                    const current = poses[index];
                    const cx = (current.x + current.w / 2) / 100 * width;
                    const cy = (current.y + current.h / 2) / 100 * height;
                    const vx = cx - pivotX;
                    const vy = cy - pivotY;
                    const cos = Math.cos(radians);
                    const sin = Math.sin(radians);
                    const movedX = pivotX + dx / 100 * width + (vx * cos - vy * sin) * scale;
                    const movedY = pivotY + dy / 100 * height + (vx * sin + vy * cos) * scale;
                    const w = current.w * scale;
                    const h = current.h * scale;
                    next.get(layer).push(keyframeFor(time, {
                        x: movedX / width * 100 - w / 2,
                        y: movedY / height * 100 - h / 2,
                        w,
                        h,
                        rotation: current.rotation + degrees,
                        opacity: current.opacity * alpha,
                    }, basePose(layer)));
                });
            }

            for (const [layer, framesOut] of next) layer.keyframes = framesOut;
            const labels = [...new Set(layers.map((layer) => layer.id))];
            summary.push(`${labels.length} layer${labels.length === 1 ? '' : 's'}`);
            const first = Math.min(...times);
            if (earliest === null || first < earliest) earliest = first;
        }

        if (!summary.length) throw new Error('None of the edits matched a layer.');
        return { summary, earliest: earliest === null ? 0 : earliest, edits: summary.length };
    }

    function safeSvg(value) {
        const svg = String(value || '').trim();
        if (!/^<svg[\s>]/i.test(svg) || !/>$/.test(svg)) throw new Error('The generated element must be a complete inline <svg> element.');
        if (/<script|<\s*foreignObject|javascript:|<iframe|on[a-z]+\s*=/i.test(svg)) throw new Error('The generated SVG must not contain scripts or event handlers.');
        return /xmlns=/.test(svg) ? svg : svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    function layerId(composition) {
        let id;
        do id = `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        while (composition.layers.some((layer) => layer.id === id));
        return id;
    }

    /**
     * Add a local image (an upload) as a real layer in the working composition.
     * spec = {name, url, x, y, w, h, z?, keyframes?}; coordinates are canvas %.
     * The url is a data URL or an app path, never a remote image.
     */
    function addImageLayer(composition, spec) {
        if (!composition || !Array.isArray(composition.layers)) throw new Error('The working composition is missing.');
        const source = spec && typeof spec === 'object' ? spec : {};
        const url = String(source.url || '').trim();
        if (!/^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(url)
            && !/^\/(?!\/)/.test(url)) {
            throw new Error('The image must be a local file or an app path.');
        }
        const name = String(source.name || '').trim().slice(0, 80) || 'Added image';
        const x = finite(source.x, 30);
        const y = finite(source.y, 30);
        const w = Math.max(0.2, finite(source.w, 40));
        const h = Math.max(0.2, finite(source.h, 40));
        const z = finite(source.z, 50);
        const frames = (Array.isArray(source.keyframes) ? source.keyframes : [])
            .filter((frame) => frame && Number.isFinite(Number(frame.time)))
            .map((frame) => ({ ...frame, time: Math.max(0, Number(frame.time)) }))
            .sort((a, b) => a.time - b.time);
        const layer = {
            id: layerId(composition),
            type: 'image',
            name,
            role: 'foreground',
            z,
            x: r3(x),
            y: r3(y),
            w: r3(w),
            h: r3(h),
            rotation: 0,
            opacity: 1,
            url,
            fit: 'fill',
            visible: true,
            uploaded: true,
            keyframes: frames.length
                ? frames.map((frame) => keyframeFor(frame.time, frame, { x, y, w, h, rotation: 0, opacity: 1 }))
                : [{ time: 0, x: r3(x), y: r3(y), w: r3(w), h: r3(h), rotation: 0, opacity: 1, easing: 'linear' }],
            meta: { uploaded: true, objectLabel: name },
        };
        composition.layers.push(layer);
        return layer;
    }

    /**
     * Add a generated element (a ghost, a flame, a prop) as an inline-SVG layer.
     * spec = {name, svg, x, y, w, h, z?, keyframes?}; coordinates are canvas %.
     */
    function addGeneratedLayer(composition, spec) {
        if (!composition || !Array.isArray(composition.layers)) throw new Error('The working composition is missing.');
        const source = spec && typeof spec === 'object' ? spec : {};
        const name = String(source.name || '').trim().slice(0, 80) || 'Generated element';
        const svg = safeSvg(source.svg);
        const x = finite(source.x, 50);
        const y = finite(source.y, 50);
        const w = Math.max(0.2, finite(source.w, 20));
        const h = Math.max(0.2, finite(source.h, 20));
        const z = finite(source.z, 50);
        const frames = (Array.isArray(source.keyframes) ? source.keyframes : [])
            .filter((frame) => frame && Number.isFinite(Number(frame.time)))
            .map((frame) => ({ ...frame, time: Math.max(0, Number(frame.time)) }))
            .sort((a, b) => a.time - b.time);
        const layer = {
            id: layerId(composition),
            type: 'image',
            name,
            role: 'foreground',
            z,
            x: r3(x),
            y: r3(y),
            w: r3(w),
            h: r3(h),
            rotation: 0,
            opacity: 1,
            url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
            fit: 'fill',
            visible: true,
            generated: true,
            keyframes: frames.length
                ? frames.map((frame) => keyframeFor(frame.time, frame, { x, y, w, h, rotation: 0, opacity: 1 }))
                : [{ time: 0, x: r3(x), y: r3(y), w: r3(w), h: r3(h), rotation: 0, opacity: 1, easing: 'linear' }],
            meta: { generated: true },
        };
        composition.layers.push(layer);
        return layer;
    }

    return { pose, valueAt, resolveLayers, applyEdits, addGeneratedLayer, addImageLayer, safeSvg };
}));
