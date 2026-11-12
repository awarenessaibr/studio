'use strict';
/**
 * animation-normalize.js — one animation payload shape for every surface.
 *
 * The library contains two kinds of motion files:
 *
 *   1. "track" animations (`agent-studio/animation/2`, a `tracks` array), and
 *   2. whole compositions whose layers carry `keyframes` (the Studio /
 *      Project Canvas format).
 *
 * Studio, Project Canvas and Studio Agent can play the second kind; AFS only
 * understood the first and dropped the rest. This normaliser derives track
 * segments from a composition's own layer keyframes so every surface can play,
 * validate and list the same motion.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StudioAnimationNormalize = api;
}(typeof globalThis !== 'undefined' ? globalThis : null, function () {
    const number = (value, fallback = 0) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    function framesOf(layer) {
        const direct = Array.isArray(layer && layer.keyframes) ? layer.keyframes : null;
        const nested = layer && layer.animation && Array.isArray(layer.animation.keyframes)
            ? layer.animation.keyframes
            : null;
        return direct && direct.length ? direct : (nested || []);
    }

    function trackFromLayer(layer, duration) {
        const frames = framesOf(layer);
        if (frames.length < 2) return null;
        const baseX = number(layer.x);
        const baseY = number(layer.y);
        const baseW = number(layer.w);
        const baseH = number(layer.h);
        const baseRotation = number(layer.rotation);
        if (!(baseW > 0) || !(baseH > 0)) return null;
        const points = frames
            .map((frame) => {
                const time = number(frame && (frame.time != null ? frame.time : frame.t), NaN);
                if (!Number.isFinite(time)) return null;
                const x = number(frame.x, baseX);
                const y = number(frame.y, baseY);
                const w = number(frame.w, baseW);
                const h = number(frame.h, baseH);
                return {
                    t: Math.max(0, Math.round(time)),
                    dx: (x - baseX) / 100,
                    dy: (y - baseY) / 100,
                    sx: w / baseW,
                    sy: h / baseH,
                    a: Math.min(1, Math.max(0, number(frame.opacity, 1))),
                    r: number(frame.rotation, baseRotation) - baseRotation,
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.t - b.t);
        if (points.length < 2) return null;
        const last = points[points.length - 1].t;
        const segmentDuration = Math.max(1, Math.round(
            number(layer.animation && layer.animation.duration, 0)
            || number(duration, 0)
            || last,
        ));
        return {
            layerId: String(layer.id || ''),
            layerName: String(layer.name || layer.id || 'Layer'),
            layerType: String(layer.type || ''),
            role: String(layer.role || ''),
            text: typeof layer.text === 'string' ? layer.text : '',
            box: { x: baseX / 100, y: baseY / 100, w: baseW / 100, h: baseH / 100 },
            segments: [{
                preset: 'keyframes',
                label: 'Keyframes',
                start: 0,
                duration: segmentDuration,
                loop: false,
                frames: points,
            }],
        };
    }

    /** Derive an `agent-studio/animation/2` track list from composition layers. */
    function tracksFromComposition(composition) {
        const layers = composition && Array.isArray(composition.layers) ? composition.layers : [];
        const duration = number(composition && composition.duration, 0) || 10000;
        const tracks = layers.map((layer) => trackFromLayer(layer, duration)).filter(Boolean);
        return {
            tracks,
            duration,
            animatedLayers: tracks.length,
        };
    }

    /**
     * Normalise a loaded motion file. Returns
     *   { kind: 'tracks'|'composition'|'empty', tracks, duration, animation, composition? }
     * `animation` always has a `tracks` array so the existing players can use it.
     * `composition` is set when the payload was a whole composition document;
     * callers that render a composition (AFS) should switch to it so the track
     * layer ids line up.
     */
    function normalize(payload, entry = {}) {
        if (!payload || typeof payload !== 'object') {
            return { kind: 'empty', tracks: [], duration: number(entry.duration, 10000), animation: null };
        }
        const entryId = typeof entry.id === 'string' ? entry.id : '';
        const base = {
            ...payload,
            id: payload.id || entryId || '',
            name: payload.name || entry.name || 'Motion',
        };
        if (Array.isArray(payload.tracks) && payload.tracks.length) {
            return {
                kind: 'tracks',
                tracks: payload.tracks,
                duration: number(payload.duration, number(entry.duration, 10000)),
                animation: base,
            };
        }
        if (Array.isArray(payload.layers) && payload.layers.length) {
            const derived = tracksFromComposition(payload);
            if (derived.tracks.length) {
                const animation = {
                    ...base,
                    schema: base.schema || 'agent-studio/animation/2',
                    kind: base.kind || 'studio-animation',
                    duration: number(payload.duration, derived.duration),
                    tracks: derived.tracks,
                };
                return {
                    kind: 'composition',
                    tracks: derived.tracks,
                    duration: number(animation.duration, derived.duration),
                    animation,
                    composition: payload,
                };
            }
        }
        return {
            kind: 'empty',
            tracks: [],
            duration: number(payload.duration, number(entry.duration, 10000)),
            animation: { ...base, tracks: [] },
        };
    }

    function isPlayable(payload, entry = {}) {
        const normal = normalize(payload, entry);
        return normal.tracks.length > 0 || Boolean(entry.sourceVideo || payload && payload.sourceVideo);
    }

    return {
        normalize,
        tracksFromComposition,
        isPlayable,
        framesOf,
    };
}));
