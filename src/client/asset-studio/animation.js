'use strict';

(function (root, factory) {
    const animation = factory();
    if (typeof module === 'object' && module.exports) module.exports = animation;
    if (root) root.AssetStudioAnimation = animation;
}(typeof globalThis === 'object' ? globalThis : this, function () {
    const DURATION = 8000;
    const TAU = Math.PI * 2;

    /* Groups drive the dropdown sections and the timeline bar colours.
       in   – entrances: hold their hidden/offset pose until they start, then settle
       out  – exits: identity until they start, then hold the hidden pose
       emph – emphasis: one-shot attention beats (pulse and heartbeat repeat)
       loop – ambient: continuous motion that runs until the end of the timeline */
    const GROUPS = [
        ['in', 'Entrance'],
        ['out', 'Exit'],
        ['emph', 'Emphasis'],
        ['loop', 'Ambient'],
    ];

    // [id, label, default duration (ms), group]
    const PRESETS = [
        // Entrance
        ['fadeIn', 'Fade in', 900, 'in'],
        ['slideUp', 'Slide up', 900, 'in'],
        ['slideDown', 'Slide down', 900, 'in'],
        ['slideLeft', 'Slide in from right', 900, 'in'],
        ['slideRight', 'Slide in from left', 900, 'in'],
        ['zoomIn', 'Zoom in', 900, 'in'],
        ['zoomOut', 'Zoom out', 900, 'in'],
        ['bounce', 'Bounce in', 1200, 'in'],
        ['popIn', 'Pop in', 700, 'in'],
        ['elasticIn', 'Elastic in', 1300, 'in'],
        ['dropIn', 'Drop in', 1100, 'in'],
        ['riseSettle', 'Rise & settle', 1000, 'in'],
        ['spinIn', 'Spin in', 1000, 'in'],
        ['tiltIn', 'Tilt in', 900, 'in'],
        ['flipIn', 'Flip in', 800, 'in'],
        ['stretchIn', 'Stretch in', 800, 'in'],
        ['swingIn', 'Swing in', 1300, 'in'],
        ['slam', 'Slam in', 500, 'in'],
        ['wipeRight', 'Wipe left to right', 800, 'in'],
        ['wipeLeft', 'Wipe right to left', 800, 'in'],
        ['wipeDown', 'Wipe top to bottom', 800, 'in'],
        ['wipeUp', 'Wipe bottom to top', 800, 'in'],
        // Exit
        ['fadeOut', 'Fade out', 900, 'out'],
        ['exitUp', 'Slide out up', 800, 'out'],
        ['exitDown', 'Slide out down', 800, 'out'],
        ['exitLeft', 'Slide out left', 800, 'out'],
        ['exitRight', 'Slide out right', 800, 'out'],
        ['shrinkOut', 'Shrink out', 800, 'out'],
        ['growOut', 'Grow out', 800, 'out'],
        ['popOut', 'Pop out', 600, 'out'],
        ['spinOut', 'Spin out', 900, 'out'],
        ['wipeOut', 'Wipe out', 800, 'out'],
        // Emphasis
        ['pulse', 'Pulse', 2400, 'emph'],
        ['heartbeat', 'Heartbeat', 1400, 'emph'],
        ['shake', 'Shake', 600, 'emph'],
        ['wobble', 'Wobble', 900, 'emph'],
        ['tada', 'Tada', 1000, 'emph'],
        ['flash', 'Flash', 800, 'emph'],
        ['flicker', 'Flicker', 900, 'emph'],
        ['rubber', 'Rubber band', 900, 'emph'],
        ['hop', 'Hop', 900, 'emph'],
        ['spin', 'Spin', 1000, 'emph'],
        ['pop', 'Pop', 500, 'emph'],
        // Ambient
        ['float', 'Float', 2400, 'loop'],
        ['breathe', 'Breathe', 3600, 'loop'],
        ['sway', 'Sway', 3200, 'loop'],
        ['orbit', 'Orbit', 4000, 'loop'],
        ['zoom', 'Slow zoom', DURATION, 'loop'],
        ['drift', 'Drift', DURATION, 'loop'],
        ['panLeft', 'Pan left', DURATION, 'loop'],
        ['panRight', 'Pan right', DURATION, 'loop'],
        ['pullBack', 'Pull back', DURATION, 'loop'],
    ];
    const info = new Map(PRESETS.map(([id, label, duration, group]) => [id, { label, duration, group }]));

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    /* Baked tracks carry sampled motion frames exported by LayerStudio. They are
       replayed directly instead of being mapped onto a preset, because preset
       names mean different things in the two engines. A frame is
       { t, a, dx, dy, s, sx, sy, clip } with t in ms from the event start. */
    const BAKED = 'baked';
    const isBaked = event => !!event && event.preset === BAKED && Array.isArray(event.frames) && event.frames.length > 0;
    const valid = event => !!event
        && Number.isFinite(event.start)
        && Number.isFinite(event.duration)
        && event.duration > 0
        && (info.has(event.preset) || isBaked(event));

    function bakedFrame(frame) {
        const source = frame || {};
        return {
            a: Number.isFinite(source.a) ? source.a : 1,
            dx: Number.isFinite(source.dx) ? source.dx : 0,
            dy: Number.isFinite(source.dy) ? source.dy : 0,
            s: Number.isFinite(source.s) ? source.s : 1,
            sx: Number.isFinite(source.sx) ? source.sx : 1,
            sy: Number.isFinite(source.sy) ? source.sy : 1,
            r: Number.isFinite(source.r) ? source.r : 0,
            clip: source.clip && typeof source.clip === 'object' ? source.clip : null,
            filter: typeof source.filter === 'string' ? source.filter : '',
        };
    }
    const lerp = (from, to, p) => from + (to - from) * p;
    function lerpClip(from, to, p) {
        if (!from) return to || null;
        if (!to) return from;
        if (from.shape === 'circle' && to.shape === 'circle') {
            return { shape: 'circle', cx: lerp(from.cx, to.cx, p), cy: lerp(from.cy, to.cy, p), r: lerp(from.r, to.r, p) };
        }
        if (from.shape === 'rect' && to.shape === 'rect') {
            return {
                shape: 'rect',
                x: lerp(from.x == null ? 0 : from.x, to.x == null ? 0 : to.x, p),
                y: lerp(from.y == null ? 0 : from.y, to.y == null ? 0 : to.y, p),
                w: lerp(from.w == null ? 100 : from.w, to.w == null ? 100 : to.w, p),
                h: lerp(from.h == null ? 100 : from.h, to.h == null ? 100 : to.h, p),
            };
        }
        if (from.shape === 'poly' && to.shape === 'poly'
            && Array.isArray(from.points) && Array.isArray(to.points)
            && from.points.length === to.points.length) {
            return {
                shape: 'poly',
                points: from.points.map((point, index) => [
                    lerp(point[0], to.points[index][0], p),
                    lerp(point[1], to.points[index][1], p),
                ]),
            };
        }
        return p < .5 ? from : to;
    }
    function bakedAt(event, time) {
        const frames = event.frames;
        const relative = clamp(time - event.start, 0, event.duration);
        const first = frames[0], last = frames[frames.length - 1];
        if (relative <= (Number.isFinite(first.t) ? first.t : 0)) return bakedFrame(first);
        if (relative >= (Number.isFinite(last.t) ? last.t : event.duration)) return bakedFrame(last);
        let lo = 0, hi = frames.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if ((Number.isFinite(frames[mid].t) ? frames[mid].t : 0) <= relative) lo = mid;
            else hi = mid;
        }
        const a = frames[lo], b = frames[hi];
        const aTime = Number.isFinite(a.t) ? a.t : 0;
        const bTime = Number.isFinite(b.t) ? b.t : aTime;
        const span = bTime - aTime;
        const p = span > 0 ? clamp((relative - aTime) / span, 0, 1) : 0;
        const from = bakedFrame(a), to = bakedFrame(b);
        return {
            a: lerp(from.a, to.a, p),
            dx: lerp(from.dx, to.dx, p),
            dy: lerp(from.dy, to.dy, p),
            s: lerp(from.s, to.s, p),
            sx: lerp(from.sx, to.sx, p),
            sy: lerp(from.sy, to.sy, p),
            r: lerp(from.r, to.r, p),
            clip: lerpClip(from.clip, to.clip, p),
            filter: p < .5 ? from.filter : to.filter,
        };
    }
    function bakedDuration(event) {
        const frames = event.frames || [];
        const last = frames[frames.length - 1];
        return Math.max(1, Number.isFinite(last && last.t) ? last.t : event.duration);
    }

    function events(value) {
        const list = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
        return list
            .filter(event => event && valid(event))
            .map((event, index) => ({
                ...event,
                id: typeof event.id === 'string' && event.id ? event.id : `legacy-${index}-${event.preset}-${event.start}`,
            }))
            .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    }
    function canPlace(list, candidate, ignoreId) {
        const start = candidate.start, end = start + candidate.duration;
        if (!Number.isFinite(start) || !Number.isFinite(candidate.duration) || candidate.duration <= 0) return false;
        return events(list).every(event => event.id === ignoreId
            || end <= event.start
            || start >= event.start + event.duration);
    }
    function withoutEvent(list, id) {
        return events(list).filter(event => event.id !== id);
    }
    function findSlot(list, start, duration, total = DURATION, direction = 'forward') {
        if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0 || duration > total) return null;
        const sorted = events(list);
        const fits = candidate => candidate >= 0 && candidate + duration <= total
            && canPlace(sorted, { start: candidate, duration });
        if (fits(start)) return start;
        if (direction === 'backward') {
            let candidate = start;
            while (candidate >= 0) {
                const hits = sorted.filter(event => candidate < event.start + event.duration && candidate + duration > event.start);
                if (!hits.length) return fits(candidate) ? candidate : null;
                candidate = Math.min(...hits.map(event => event.start)) - duration;
            }
            for (let i = sorted.length - 1; i >= 0; i--) {
                const candidateBefore = (i === sorted.length - 1 ? total : sorted[i + 1].start) - duration;
                const gapStart = sorted[i].start + sorted[i].duration;
                if (candidateBefore >= gapStart) return candidateBefore;
            }
            const beforeFirst = (sorted[0] ? sorted[0].start : total) - duration;
            return beforeFirst >= 0 ? beforeFirst : null;
        }
        let candidate = start;
        while (candidate + duration <= total) {
            const hits = sorted.filter(event => candidate < event.start + event.duration && candidate + duration > event.start);
            if (!hits.length) return candidate;
            candidate = Math.max(...hits.map(event => event.start + event.duration));
        }
        let gapStart = 0;
        for (const event of sorted) {
            if (event.start - gapStart >= duration) return gapStart;
            gapStart = Math.max(gapStart, event.start + event.duration);
        }
        return total - gapStart >= duration ? gapStart : null;
    }
    const ease = t => 1 - Math.pow(1 - t, 3);
    const inOut = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const outQuart = t => 1 - Math.pow(1 - t, 4);
    const back = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
    const inBack = t => { const c1 = 1.70158, c3 = c1 + 1; return c3 * t * t * t - c1 * t * t; };
    const elastic = t => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * (TAU / 3)) + 1);
    const quick = t => clamp(t * 3, 0, 1);
    const gauss = (x, c, w) => Math.exp(-Math.pow((x - c) / w, 2));
    const bounceOut = t => {
        const n = 7.5625, d = 2.75;
        if (t < 1 / d) return n * t * t;
        if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75;
        if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375;
        return n * (t -= 2.625 / d) * t + .984375;
    };

    /* A frame is { a, dx, dy, s } plus optional extras:
         r     rotation in radians (clockwise)
         sx/sy extra horizontal / vertical scale multipliers (1 is neutral)
         wipe  { d: 'r'|'l'|'d'|'u', p }  reveal p (0–1) travelling in direction d */
    const frame = o => Object.assign({ a: 1, dx: 0, dy: 0, s: 1 }, o);
    const identity = () => frame();

    function at(animation, time) {
        if (isBaked(animation)) return bakedAt(animation, time);
        const meta = animation && info.get(animation.preset);
        if (!meta) return identity();
        // Entrances hold their starting pose until they begin so staggered elements stay hidden;
        // every other group is unchanged before its start.
        if (time < animation.start && meta.group !== 'in') return identity();
        const dur = Math.max(1, animation.duration);
        const elapsed = Math.max(0, time - animation.start);
        const p = clamp(elapsed / dur, 0, 1);
        const e = ease(p);
        const x = inOut(p);
        const phase = (elapsed / dur) * TAU;
        const cyc = (elapsed / dur) % 1;
        switch (animation.preset) {
            /* ---- entrances ---- */
            case 'fadeIn': return frame({ a: e });
            case 'slideUp': return frame({ a: e, dy: (1 - e) * .04 });
            case 'slideDown': return frame({ a: e, dy: -(1 - e) * .04 });
            case 'slideLeft': return frame({ a: e, dx: (1 - e) * .06 });
            case 'slideRight': return frame({ a: e, dx: -(1 - e) * .06 });
            case 'zoomIn': return frame({ a: e, s: .85 + .15 * e });
            case 'zoomOut': return frame({ a: e, s: 1 + .15 * (1 - e) });
            case 'bounce': return frame({ a: e, dy: (1 - bounceOut(p)) * .06 });
            case 'popIn': return frame({ a: quick(p), s: .6 + .4 * back(p) });
            case 'elasticIn': return frame({ a: quick(p), s: .3 + .7 * elastic(p) });
            case 'dropIn': return frame({ a: quick(p), dy: -(1 - bounceOut(p)) * .18 });
            case 'riseSettle': return frame({ a: quick(p), dy: (1 - back(p)) * .08 });
            case 'spinIn': return frame({ a: e, s: .5 + .5 * e, r: -(1 - e) * Math.PI * .75 });
            case 'tiltIn': return frame({ a: e, dy: (1 - e) * .04, r: -(1 - e) * .14 });
            case 'flipIn': return frame({ a: quick(p), sx: Math.max(.001, e) });
            case 'stretchIn': return frame({ a: e, sx: 1 + .4 * (1 - e), sy: 1 - .15 * (1 - e) });
            case 'swingIn': return frame({ a: quick(p), r: (1 - p) * Math.cos(p * Math.PI * 3.5) * .32 });
            case 'slam': return frame({ a: clamp(p * 5, 0, 1), s: 1 + .7 * (1 - outQuart(p)) });
            case 'wipeRight': return frame({ wipe: { d: 'r', p: x } });
            case 'wipeLeft': return frame({ wipe: { d: 'l', p: x } });
            case 'wipeDown': return frame({ wipe: { d: 'd', p: x } });
            case 'wipeUp': return frame({ wipe: { d: 'u', p: x } });
            /* ---- exits (hold the hidden pose afterwards) ---- */
            case 'fadeOut': return frame({ a: 1 - e });
            case 'exitUp': return frame({ a: 1 - x, dy: -x * .04 });
            case 'exitDown': return frame({ a: 1 - x, dy: x * .04 });
            case 'exitLeft': return frame({ a: 1 - x, dx: -x * .06 });
            case 'exitRight': return frame({ a: 1 - x, dx: x * .06 });
            case 'shrinkOut': return frame({ a: 1 - x, s: 1 - .2 * x });
            case 'growOut': return frame({ a: 1 - x, s: 1 + .2 * x });
            case 'popOut': return frame({ a: 1 - clamp((p - .6) / .4, 0, 1), s: Math.max(0, 1 - inBack(p)) });
            case 'spinOut': return frame({ a: 1 - x, s: 1 - .5 * x, r: x * Math.PI * .75 });
            case 'wipeOut': return frame({ wipe: { d: 'l', p: 1 - x } });
            /* ---- emphasis ---- */
            case 'pulse': return frame({ s: 1 + .06 * (.5 - .5 * Math.cos(phase)) });
            case 'heartbeat': return frame({ s: 1 + .09 * gauss(cyc, .14, .05) + .06 * gauss(cyc, .32, .06) });
            case 'shake': return frame({ dx: Math.sin(p * Math.PI * 10) * (1 - p) * .012 });
            case 'wobble': {
                const w = Math.sin(p * Math.PI * 6) * (1 - p);
                return frame({ r: w * .07, dx: w * .012 });
            }
            case 'tada': {
                const env = Math.sin(p * Math.PI);
                return frame({ s: 1 + .1 * env, r: Math.sin(p * Math.PI * 8) * .05 * env });
            }
            case 'flash': return frame({ a: .15 + .85 * (.5 + .5 * Math.cos(p * Math.PI * 4)) });
            case 'flicker': {
                const pulse = Math.sin(elapsed / dur * TAU * 5) * .16
                    + Math.sin(elapsed / dur * TAU * 11) * .08;
                return frame({ a: clamp(.86 + pulse, .55, 1) });
            }
            case 'rubber': {
                const k = Math.sin(p * Math.PI * 5) * (1 - p);
                return frame({ sx: 1 + .25 * k, sy: 1 - .25 * k });
            }
            case 'hop': return frame({ dy: -Math.abs(Math.sin(p * Math.PI * 3)) * (1 - p) * .04 });
            case 'spin': return frame({ r: x * TAU });
            case 'pop': return frame({ s: 1 + .12 * Math.sin(p * Math.PI) });
            /* ---- ambient ---- */
            case 'float': return frame({ dy: Math.sin(phase) * .008, s: 1 + .004 * (1 - Math.cos(phase)) });
            case 'breathe': return frame({ s: 1 + .025 * (.5 - .5 * Math.cos(phase)) });
            case 'sway': return frame({ r: Math.sin(phase) * .03, dx: Math.sin(phase) * .004 });
            case 'orbit': return frame({ dx: (Math.cos(phase) - 1) * .012, dy: Math.sin(phase) * .012 });
            case 'zoom': return frame({ s: 1 + .08 * p });
            case 'drift': return frame({ dx: -.02 * p, dy: -.012 * p, s: 1 + .06 * e });
            // Pans start already zoomed in so the edges never show; add them to the background at 0 s.
            case 'panLeft': return frame({ s: 1.1, dx: .04 - .08 * x });
            case 'panRight': return frame({ s: 1.1, dx: -.04 + .08 * x });
            case 'pullBack': return frame({ s: 1.1 - .1 * x });
            default: return identity();
        }
    }

    function atTrack(value, time) {
        const track = events(value);
        if (!track.length) return identity();
        let previous = null;
        for (const event of track) {
            const end = event.start + event.duration;
            if (time < event.start) {
                if (previous) return previous;
                return (info.has(event.preset) ? info.get(event.preset).group : 'in') === 'in' ? at(event, time) : identity();
            }
            if (time < end || time === event.start) return at(event, time);
            previous = at(event, end);
        }
        return previous || identity();
    }

    return {
        DURATION,
        GROUPS,
        PRESETS,
        BAKED,
        isBaked,
        bakedDuration,
        events,
        canPlace,
        withoutEvent,
        findSlot,
        durationFor: preset => (preset === BAKED ? DURATION : (info.get(preset) || {}).duration || 900),
        groupOf: preset => (info.get(preset) || {}).group || 'in',
        at,
        atTrack,
    };
}));