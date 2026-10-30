'use strict';
(function () {
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const HEX_COLOR = /^#[0-9a-f]{6}$/i;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);/i;
    const LAYER_ID = /^[A-Za-z0-9_-]{1,80}$/;
    const MAX_LAYERS = 500;
    const MAX_MATCH_EDGE = 640;
    const MAX_MATCH_SEEDS_PER_SCALE = 6;
    const MATCH_GRADIENT_WEIGHT = 0.25;
    const MATCH_SCALES = [0.25, 0.35, 0.4, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 2];
    const DEFAULT_ANIMATION_DURATION = 3000;
    const MAX_ANIMATION_DURATION = 30000;
    const MAX_KEYFRAMES_PER_LAYER = 400;
    const ANIMATED_PROPERTIES = ['x', 'y', 'w', 'h', 'rotation', 'opacity'];
    const EASING_NAMES = [
        'linear', 'easeIn', 'easeOut', 'easeInOut',
        'easeInSine', 'easeOutSine', 'easeInOutSine',
        'easeInQuad', 'easeOutQuad', 'easeInOutQuad',
        'easeOutCubic', 'easeInOutCubic',
        'easeOutBack', 'easeInBack',
        'stepStart', 'stepEnd',
    ];
    const PRESET_NAMES = [
        'breathe', 'idle', 'sway', 'walk', 'float', 'flicker',
        'drift', 'pulse', 'fadeIn', 'parallax',
        'fadeOut', 'zoom', 'spin', 'shake', 'hop', 'swing', 'orbit', 'nod', 'blinkIn',
    ];
    function easeValue(kind, t) {
        switch (kind || 'linear') {
            case 'easeIn':          return t * t;
            case 'easeOut':         return 1 - (1 - t) * (1 - t);
            case 'easeInOut':       return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            case 'easeInSine':      return 1 - Math.cos(t * Math.PI / 2);
            case 'easeOutSine':     return Math.sin(t * Math.PI / 2);
            case 'easeInOutSine':   return -(Math.cos(Math.PI * t) - 1) / 2;
            case 'easeInQuad':      return t * t;
            case 'easeOutQuad':     return 1 - (1 - t) * (1 - t);
            case 'easeInOutQuad':   return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            case 'easeOutCubic':    return 1 - Math.pow(1 - t, 3);
            case 'easeInOutCubic':  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            case 'easeOutBack': {
                const c1 = 1.70158, c3 = c1 + 1;
                return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
            }
            case 'easeInBack': {
                const c1 = 1.70158, c3 = c1 + 1;
                return c3 * t * t * t - c1 * t * t;
            }
            case 'stepStart':       return t < 1 ? 0 : 1;
            case 'stepEnd':         return t > 0 ? 1 : 0;
            default:                return t;
        }
    }
    const CHARACTER_PART_KEYS = [
        'face', 'eyes', 'pupils', 'highlights', 'eyelids', 'brows', 'mouth', 'jaw',
        'teeth', 'tongue', 'mustache', 'beard', 'head', 'body', 'hands', 'ears',
        'neck', 'fx',
    ];
    const CHARACTER_PART_LABELS = {
        face: 'Face',
        eyes: 'Eyes',
        pupils: 'Pupils',
        highlights: 'Highlights',
        eyelids: 'Eyelids',
        brows: 'Brows',
        mouth: 'Mouth',
        jaw: 'Jaw',
        teeth: 'Teeth',
        tongue: 'Tongue',
        mustache: 'Mustache',
        beard: 'Beard',
        head: 'Head',
        body: 'Body',
        hands: 'Hands',
        ears: 'Ears',
        neck: 'Neck',
        fx: 'FX',
    };
    const CHARACTER_EXPRESSIONS = ['neutral', 'happy', 'sad', 'surprised', 'angry'];
    const CHARACTER_VISEME_KEYS = ['rest', 'a', 'e', 'i', 'o', 'u', 'mbp', 'fv', 'l', 'wq', 'smile', 'frown', 'open'];
    const CHARACTER_VISEME_OPENING = {
        rest: 0.06,
        a: 1,
        e: 0.58,
        i: 0.36,
        o: 0.82,
        u: 0.52,
        mbp: 0.02,
        fv: 0.22,
        l: 0.6,
        wq: 0.3,
        smile: 0.4,
        frown: 0.12,
        open: 1,
    };
    const CHARACTER_EXPRESSION_MOUTH = {
        neutral: 'rest',
        happy: 'smile',
        sad: 'frown',
        surprised: 'open',
        angry: 'frown',
    };
    const CHARACTER_EXPRESSION_BROW = {
        neutral: 'neutral',
        happy: 'raised',
        sad: 'sad',
        surprised: 'raised',
        angry: 'furrowed',
    };
    const CHARACTER_EXPRESSION_EYE = {
        neutral: 1,
        happy: 0.92,
        sad: 0.97,
        surprised: 1.06,
        angry: 0.9,
    };
    const CHARACTER_HEAD_PARTS = new Set([
        'face', 'eyes', 'pupils', 'highlights', 'eyelids', 'brows', 'mouth', 'jaw',
        'teeth', 'tongue', 'mustache', 'beard', 'head', 'ears', 'neck',
    ]);
    const VISEME_BY_LETTER = {
        a: 'a', á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a',
        e: 'e', é: 'e', è: 'e', ê: 'e', ë: 'e',
        i: 'i', í: 'i', ì: 'i', î: 'i', ï: 'i', y: 'i',
        o: 'o', ó: 'o', ò: 'o', ô: 'o', õ: 'o', ö: 'o',
        u: 'u', ú: 'u', ù: 'u', û: 'u', ü: 'u',
        m: 'mbp', b: 'mbp', p: 'mbp',
        f: 'fv', v: 'fv',
        w: 'wq', q: 'wq',
        l: 'l',
        r: 'rest', s: 'rest', z: 'rest', t: 'rest', d: 'rest', n: 'rest',
        k: 'rest', g: 'rest', h: 'rest', c: 'rest', j: 'rest', x: 'rest',
    };
    const CHARACTER_DEFAULTS = {
        expression: 'neutral',
        blink: true,
        blinkRate: 12,
        blinkAmount: 0.9,
        talk: false,
        talkIntensity: 0.55,
        talkSpeed: 1,
        mouthOpen: 1,
        gazeX: 0,
        gazeY: 0,
        eyeWander: true,
        breathe: true,
        breatheAmount: 0.4,
        headSway: 0.6,
        pulseAmount: 0,
        saccade: true,
        speechText: '',
        speechRate: 1,
        speechStart: 0,
        mouthPose: '',
    };

    function characterAnimationPreset(id, name, description, settings, duration = 10000) {
        return {
            id,
            name,
            description,
            duration,
            settings: normalizeCharacterSettings(settings),
        };
    }

    const CHARACTER_ANIMATION_PRESETS = [
        characterAnimationPreset('talk-well-met', 'Talk — Well met', 'Lip-sync take · the beards-talk.gif performance', {
            expression: 'neutral',
            blinkRate: 13,
            blinkAmount: 0.95,
            talkIntensity: 0.6,
            mouthOpen: 1,
            breatheAmount: 0.45,
            headSway: 0.7,
            saccade: true,
            speechText: 'Oh! Well met, traveler. I have been waiting for you. Come, sit by the fire. There is much to tell.',
            speechRate: 0.95,
        }),
        characterAnimationPreset('talk-entao-ta-neh', 'Talk — Então tá né', 'Sad lip-sync take · matches beards-gif-export-check.gif', {
            expression: 'sad',
            blinkRate: 20,
            talkIntensity: 0.55,
            gazeX: -0.05,
            gazeY: -0.4,
            speechText: 'entao ta neh',
        }),
        characterAnimationPreset('idle', 'Idle — waiting', 'Neutral breathing, blinks, gaze wander and saccades', {}),
        characterAnimationPreset('happy', 'Happy', 'Smile, raised brows and a lighter head sway', {
            expression: 'happy', blinkRate: 14, breatheAmount: 0.5, headSway: 0.8, gazeX: 0.05,
        }),
        characterAnimationPreset('sad', 'Sad', 'Inner brows up, half-lidded eyes, slow gaze', {
            expression: 'sad', blinkRate: 9, gazeY: 0.25, breatheAmount: 0.3, headSway: 0.4,
        }),
        characterAnimationPreset('surprised', 'Surprised', 'Wide eyes, raised brows, open mouth', {
            expression: 'surprised', blink: false, mouthOpen: 1.2, eyeWander: false, saccade: false,
            headSway: 0.3, breatheAmount: 0.35,
        }),
        characterAnimationPreset('angry', 'Angry', 'Furrowed brows, narrowed eyes, tense jaw', {
            expression: 'angry', blinkRate: 16, blinkAmount: 0.85, gazeX: -0.1,
            breatheAmount: 0.55, headSway: 0.5,
        }),
        characterAnimationPreset('blink-test', 'Blink test', 'Fast, full blinks with a still head', {
            blinkRate: 30, blinkAmount: 1, eyeWander: false, saccade: false, headSway: 0.15, breatheAmount: 0.2,
        }),
        characterAnimationPreset('talk-loop', 'Talk loop — mumbling', 'Endless viseme loop, no text needed', {
            talk: true, talkIntensity: 0.65, talkSpeed: 1.05, mouthOpen: 1.2, blinkRate: 15,
            gazeX: 0.1, headSway: 0.55,
        }),
        characterAnimationPreset('mouth-a-qa', 'Mouth A — QA', 'Forced A viseme at Mouth open 2 for shape review', {
            blink: false, mouthOpen: 2, eyeWander: false, saccade: false, headSway: 0,
            breathe: false, mouthPose: 'a',
        }),
    ];

    function mulberry32(seed) {
        let value = seed >>> 0;
        return function random() {
            value = (value + 0x6D2B79F5) >>> 0;
            let result = value;
            result = Math.imul(result ^ (result >>> 15), result | 1);
            result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
            return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
        };
    }

    function hashString(value) {
        let hash = 2166136261;
        const text = String(value || '');
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    function smoothstep(edge0, edge1, value) {
        const span = edge1 - edge0;
        if (span === 0) return value < edge0 ? 0 : 1;
        const amount = clamp((value - edge0) / span, 0, 1);
        return amount * amount * (3 - 2 * amount);
    }

    function deriveLayerVariant(layer, part) {
        const id = String(layer.id || '').toLowerCase();
        const name = String(layer.name || '').toLowerCase();
        const source = `${id} ${name}`;
        let variant = String(layer.variant || '').toLowerCase();
        let group = String(layer.group || '').toLowerCase();
        if (!variant) {
            if (part === 'mouth') {
                const match = id.match(/mouth[-_ ]([a-z]+)$/) || name.match(/mouth\s+([a-z]+)$/);
                if (match && CHARACTER_VISEME_KEYS.includes(match[1])) variant = match[1];
            } else if (part === 'brows') {
                const match = id.match(/brow[-_ ]?(left|right)[-_ ]([a-z]+)$/)
                    || name.match(/brow\s+(left|right)\s+([a-z]+)$/);
                if (match) variant = match[2];
            } else if (part === 'eyelids') {
                const match = id.match(/eyelid[-_ ](half|closed)/) || name.match(/eyelid\s+(half|closed)/);
                if (match) variant = match[1];
            }
        }
        if (!group) {
            if (part === 'mouth') group = 'mouth';
            else if (part === 'brows') group = /right/.test(source) ? 'brow-right' : 'brow-left';
            else if (part === 'eyelids') group = /right/.test(source) ? 'eyelid-right' : 'eyelid-left';
        }
        return { variant, group };
    }

    function visemeForCharacter(character) {
        return VISEME_BY_LETTER[String(character || '').toLowerCase()] || null;
    }

    function textToVisemes(text, rate, duration, start) {
        const source = String(text || '').slice(0, 400);
        if (!source.trim()) return [];
        const base = 78 / clamp(rate, 0.5, 2);
        const random = mulberry32(hashString(source) || 1);
        const track = [];
        let time = clamp(start, 0, duration);
        for (const raw of source) {
            const character = raw.toLowerCase();
            if (/\s/.test(character)) {
                time += base * 0.85;
                continue;
            }
            if (/[.,;:!?]/.test(character)) {
                time += base * (character === ',' || character === ';' ? 2.6 : 3.8);
                continue;
            }
            if (/['"’‘“”\-–—()]/.test(character)) {
                time += base * 0.3;
                continue;
            }
            const viseme = visemeForCharacter(character);
            if (!viseme) {
                time += base * 0.45;
                continue;
            }
            const hold = base
                * (viseme === 'a' || viseme === 'o' || viseme === 'e' ? 1.25 : 0.9)
                * (0.9 + random() * 0.22);
            if (time >= duration) break;
            track.push({
                start: Math.round(time),
                end: Math.round(Math.min(duration, time + hold)),
                viseme,
            });
            time += hold * 0.92;
        }
        const merged = [];
        track.forEach((segment) => {
            if (segment.end <= segment.start) return;
            const last = merged[merged.length - 1];
            if (last && last.viseme === segment.viseme && segment.start - last.end <= 45) {
                last.end = Math.max(last.end, segment.end);
            } else {
                merged.push({ ...segment });
            }
        });
        const end = merged.length ? merged[merged.length - 1].end : 0;
        if (end > duration) {
            const scale = duration / end;
            merged.forEach((segment) => {
                segment.start = Math.round(segment.start * scale);
                segment.end = Math.round(segment.end * scale);
            });
        }
        return merged;
    }

    function buildTalkTrack(duration, speed, intensity) {
        const sequence = ['a', 'o', 'e', 'mbp', 'i', 'rest', 'u', 'l', 'a', 'rest', 'e', 'wq'];
        const random = mulberry32(0x51ed);
        const step = 150 / clamp(speed, 0.5, 2);
        const track = [];
        let time = 80;
        let index = 0;
        while (time < duration) {
            const viseme = sequence[index % sequence.length];
            const hold = step * (0.72 + random() * 0.55) * (0.65 + clamp(intensity, 0, 1) * 0.7);
            track.push({
                start: Math.round(time),
                end: Math.round(Math.min(duration, time + hold)),
                viseme,
            });
            time += hold;
            index += 1;
        }
        return track;
    }
    const CHAT_IDS = ['chatHeader', 'welcomeState', 'chatLog', 'chatCompose', 'chatToolbar'];
    const SIBLING_HIDE = [
        'bookHideView', 'imagineHideView', 'violationsHideView', 'lawLibHideView',
        'masterIndexHideView', 'legalRouterHideView', 'spacesHideView', 'listeningHideView',
        'studioHideView', 'descobertaHideView', 'memoryHideView', 'shadersHideView',
        'architectureHideView', 'craudioHideView', 'socialMediaHideView', 'sheetsHideView',
        'driveHideView', 'healthHideView', 'procurementHideView', 'ocrHideView',
        'outreachHideView', 'comfyuiHideView', 'eventMapHideView', 'writerHideView',
        'mermaidHideView',
    ];
    const SIBLING_SHOW = [
        'bookShowView', 'imagineShowView', 'violationsShowView', 'lawLibShowView',
        'masterIndexShowView', 'legalRouterShowView', 'spacesShowView', 'listeningShowView',
        'studioShowView', 'discShowView', 'memoryShowView', 'shadersShowView',
        'architectureShowView', 'craudioShowView', 'socialMediaShowView', 'sheetsShowView',
        'driveShowView', 'healthShowView', 'procurementShowView', 'ocrShowView',
        'outreachShowView', 'comfyuiShowView', 'eventMapShowView', 'writerShowView',
        'imagineShowView', 'mermaidShowView', 'resetToWelcome', 'aexToggleMain',
    ];
    const GRIPS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

    function makeLayer(values, index) {
        const id = typeof values.id === 'string' && LAYER_ID.test(values.id)
            ? values.id
            : `layer-${Date.now().toString(36)}-${index.toString(36)}`;

        const rawUrl = typeof values.url === 'string' ? values.url : '';
        const validFrames = Array.isArray(values.frames)
            ? values.frames.filter((u) => typeof u === 'string' && safeImageUrl(u)).slice(0, 60)
            : [];
        const frames = validFrames.length ? validFrames : (rawUrl ? [rawUrl] : []);
        const url = frames[0] || rawUrl;

        const layer = {
            id,
            url,
            frames,
            spriteFps: clamp(finite(values.spriteFps, 8), 1, 30),
            spriteMode: ['loop', 'pingpong', 'once'].includes(values.spriteMode) ? values.spriteMode : 'loop',
            role: typeof values.role === 'string'
                && /^(background|midground|ground|foreground|character|character-part|prop|effect)$/.test(values.role)
                ? values.role : 'prop',
            name: (typeof values.name === 'string' ? values.name.trim().slice(0, 160) : '') || `Layer ${index + 1}`,
            x: clamp(finite(values.x, 20), -100, 200),
            y: clamp(finite(values.y, 20), -100, 200),
            w: clamp(finite(values.w, 60), 1, 300),
            h: clamp(finite(values.h, 60), 1, 300),
            opacity: clamp(finite(values.opacity, 1), 0, 1),
            recolorEnabled: values.recolorEnabled === true,
            recolorColor: HEX_COLOR.test(values.recolorColor) ? values.recolorColor.toLowerCase() : '#ffffff',
            outlineEnabled: values.outlineEnabled === true,
            outlineColor: HEX_COLOR.test(values.outlineColor) ? values.outlineColor.toLowerCase() : '#000000',
            outlineWidth: Math.round(clamp(finite(values.outlineWidth, 3), 1, 16)),
            z: clamp(finite(values.z, index), -1000, 1000),
            rotation: clamp(finite(values.rotation, 0), -3600, 3600),
            fit: values.fit === 'cover' ? 'cover' : 'contain',
            visible: values.visible !== false,
            locked: values.locked === true,
            positionConfirmed: values.positionConfirmed === true,
            rig: values.rig === true,
            part: typeof values.part === 'string' ? values.part.slice(0, 32) : '',
            group: typeof values.group === 'string' ? values.group.slice(0, 64) : '',
            segmentGroup: typeof values.segmentGroup === 'string' ? values.segmentGroup.trim().slice(0, 80) : '',
            variant: typeof values.variant === 'string' ? values.variant.slice(0, 48) : '',
        };
        layer.keyframes = normalizeKeyframes(values.keyframes);
        return layer;
    }

    function normalizeKeyframes(value) {
        if (!Array.isArray(value)) return [];
        const frames = value.slice(0, MAX_KEYFRAMES_PER_LAYER).map((frame) => {
            if (!frame || typeof frame !== 'object') return null;
            if (!Number.isFinite(Number(frame.time))
                || Number(frame.time) < 0
                || !ANIMATED_PROPERTIES.every((property) => Number.isFinite(Number(frame[property])))) return null;
            const time = Math.round(clamp(Number(frame.time), 0, MAX_ANIMATION_DURATION));
            const result = {
                time,
                x: clamp(Number(frame.x), -100, 200),
                y: clamp(Number(frame.y), -100, 200),
                w: clamp(Number(frame.w), 1, 300),
                h: clamp(Number(frame.h), 1, 300),
                rotation: clamp(Number(frame.rotation), -3600, 3600),
                opacity: clamp(Number(frame.opacity), 0, 1),
            };
            if (typeof frame.easing === 'string' && EASING_NAMES.includes(frame.easing)) {
                result.easing = frame.easing;
            }
            return result;
        }).filter(Boolean);
        const unique = new Map();
        frames.forEach((frame) => unique.set(frame.time, frame));
        return [...unique.values()].sort((a, b) => a.time - b.time);
    }

    function normalizeCharacterSettings(value) {
        const source = value && typeof value === 'object' ? value : {};
        return {
            expression: CHARACTER_EXPRESSIONS.includes(source.expression) ? source.expression : CHARACTER_DEFAULTS.expression,
            blink: source.blink !== false,
            blinkRate: Math.round(clamp(finite(source.blinkRate, CHARACTER_DEFAULTS.blinkRate), 2, 30)),
            blinkAmount: clamp(finite(source.blinkAmount, CHARACTER_DEFAULTS.blinkAmount), 0, 1),
            talk: source.talk === true,
            talkIntensity: clamp(finite(source.talkIntensity, CHARACTER_DEFAULTS.talkIntensity), 0, 1),
            talkSpeed: clamp(finite(source.talkSpeed, CHARACTER_DEFAULTS.talkSpeed), 0.5, 2),
            mouthOpen: clamp(finite(source.mouthOpen, CHARACTER_DEFAULTS.mouthOpen), 0, 2),
            gazeX: clamp(finite(source.gazeX, CHARACTER_DEFAULTS.gazeX), -1, 1),
            gazeY: clamp(finite(source.gazeY, CHARACTER_DEFAULTS.gazeY), -1, 1),
            eyeWander: source.eyeWander !== false,
            breathe: source.breathe !== false,
            breatheAmount: clamp(finite(source.breatheAmount, CHARACTER_DEFAULTS.breatheAmount), 0, 1),
            headSway: clamp(finite(source.headSway, CHARACTER_DEFAULTS.headSway), 0, 1),
            pulseAmount: clamp(finite(source.pulseAmount, CHARACTER_DEFAULTS.pulseAmount), 0, 1),
            saccade: source.saccade !== false,
            speechText: typeof source.speechText === 'string' ? source.speechText.slice(0, 300) : '',
            speechRate: clamp(finite(source.speechRate, CHARACTER_DEFAULTS.speechRate), 0.5, 2),
            speechStart: clamp(finite(source.speechStart, CHARACTER_DEFAULTS.speechStart), 0, MAX_ANIMATION_DURATION),
            mouthPose: CHARACTER_VISEME_KEYS.includes(source.mouthPose) ? source.mouthPose : '',
        };
    }

    function normalizeCharacters(value, layers) {
        if (!Array.isArray(value)) return [];
        const layerIds = new Set(layers.map((layer) => layer.id));
        const usedIds = new Set();
        return value.slice(0, 12).map((item, index) => {
            if (!item || typeof item !== 'object') return null;
            let id = typeof item.id === 'string' && LAYER_ID.test(item.id)
                ? item.id
                : `character-${index + 1}`;
            while (usedIds.has(id)) id = `character-${index + 1}-${usedIds.size + 1}`;
            usedIds.add(id);
            const parts = {};
            let hasPart = false;
            CHARACTER_PART_KEYS.forEach((key) => {
                const ids = Array.isArray(item.parts?.[key]) ? item.parts[key] : [];
                parts[key] = [...new Set(ids.filter((layerId) => layerIds.has(layerId)))];
                if (parts[key].length) hasPart = true;
            });
            if (!hasPart) return null;
            const hidden = Array.isArray(item.hidden)
                ? [...new Set(item.hidden.filter((layerId) => layerIds.has(layerId)))]
                : [];
            const coverLayerId = typeof item.coverLayerId === 'string' && layerIds.has(item.coverLayerId)
                ? item.coverLayerId
                : null;
            return {
                id,
                name: (typeof item.name === 'string' ? item.name.trim().slice(0, 80) : '') || `Character ${index + 1}`,
                parts,
                hidden,
                coverLayerId,
                settings: normalizeCharacterSettings(item.settings),
                applied: item.applied === true,
                detected: item.detected === true,
                rigVersion: Number(item.rigVersion) || 0,
                variants: item.variants && typeof item.variants === 'object' ? item.variants : null,
            };
        }).filter(Boolean);
    }

    function safeImageUrl(value) {
        if (typeof value !== 'string') return false;
        if (IMAGE_DATA_URL.test(value)) return true;
        try {
            const url = new URL(value, window.location.href);
            return url.protocol === 'https:' || url.protocol === 'http:';
        } catch {
            return false;
        }
    }

    function hasLayerEffects(layer) {
        return layer.recolorEnabled || layer.outlineEnabled;
    }

    function layerFilterId(layer) {
        return `layer-effect-${layer.id}`;
    }

    function layerEffectFilterMarkup(layer) {
        if (!hasLayerEffects(layer)) return '';
        const id = layerFilterId(layer);
        const base = layer.recolorEnabled
            ? `<feFlood flood-color="${layer.recolorColor}" result="recolor"/><feComposite in="recolor" in2="SourceAlpha" operator="in" result="base"/>`
            : '';
        const outline = layer.outlineEnabled
            ? `<feMorphology in="SourceAlpha" operator="dilate" radius="${layer.outlineWidth}" result="expanded-alpha"/><feFlood flood-color="${layer.outlineColor}" result="outline-color"/><feComposite in="outline-color" in2="expanded-alpha" operator="in" result="outline"/><feMerge><feMergeNode in="outline"/><feMergeNode in="${layer.recolorEnabled ? 'base' : 'SourceGraphic'}"/></feMerge>`
            : '';
        return `<filter id="${id}" x="-100%" y="-100%" width="300%" height="300%" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${base}${outline}</filter>`;
    }

    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('The image could not be loaded for alignment.'));
            if (!url.startsWith('data:') && new URL(url, window.location.href).origin !== window.location.origin) {
                image.crossOrigin = 'anonymous';
            }
            image.src = url;
        });
    }

    function imagePixels(image, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas pixel analysis is unavailable in this browser.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
    }

    function alphaBounds(data, width, height) {
        let left = width;
        let top = height;
        let right = -1;
        let bottom = -1;
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                if (data[(y * width + x) * 4 + 3] <= 32) continue;
                left = Math.min(left, x);
                top = Math.min(top, y);
                right = Math.max(right, x);
                bottom = Math.max(bottom, y);
            }
        }
        return right < left ? null : { left, top, right, bottom };
    }

    function templateSamples(data, width, height, bounds) {
        const samples = [];
        const area = (bounds.right - bounds.left + 1) * (bounds.bottom - bounds.top + 1);
        const step = Math.max(1, Math.ceil(Math.sqrt(area / 512)));
        for (let y = bounds.top; y <= bounds.bottom; y += step) {
            for (let x = bounds.left; x <= bounds.right; x += step) {
                const index = (y * width + x) * 4;
                const alpha = data[index + 3];
                if (alpha <= 32) continue;
                const rightIndex = (y * width + Math.min(width - 1, x + 1)) * 4;
                const belowIndex = (Math.min(height - 1, y + 1) * width + x) * 4;
                const leftIndex = (y * width + Math.max(0, x - 1)) * 4;
                const aboveIndex = (Math.max(0, y - 1) * width + x) * 4;
                const contrast = (
                    Math.abs(data[index] - data[rightIndex]) +
                    Math.abs(data[index + 1] - data[rightIndex + 1]) +
                    Math.abs(data[index + 2] - data[rightIndex + 2]) +
                    Math.abs(data[index] - data[belowIndex]) +
                    Math.abs(data[index + 1] - data[belowIndex + 1]) +
                    Math.abs(data[index + 2] - data[belowIndex + 2]) +
                    Math.abs(data[index] - data[leftIndex]) +
                    Math.abs(data[index + 1] - data[leftIndex + 1]) +
                    Math.abs(data[index + 2] - data[leftIndex + 2]) +
                    Math.abs(data[index] - data[aboveIndex]) +
                    Math.abs(data[index + 1] - data[aboveIndex + 1]) +
                    Math.abs(data[index + 2] - data[aboveIndex + 2])
                ) / 3060;
                samples.push({
                    x, y, index, rightIndex, belowIndex, leftIndex, aboveIndex,
                    weight: (alpha / 255) * (1 + Math.min(1, contrast * 4) * 2),
                });
            }
        }
        if (samples.length >= 24) return samples;

        let opaqueCount = 0;
        for (let y = bounds.top; y <= bounds.bottom; y += 1) {
            for (let x = bounds.left; x <= bounds.right; x += 1) {
                if (data[(y * width + x) * 4 + 3] > 32) opaqueCount += 1;
            }
        }
        const interval = Math.max(1, Math.ceil(opaqueCount / 512));
        let opaqueIndex = 0;
        for (let y = bounds.top; y <= bounds.bottom; y += 1) {
            for (let x = bounds.left; x <= bounds.right; x += 1) {
                const index = (y * width + x) * 4;
                const alpha = data[index + 3];
                if (alpha <= 32) continue;
                if (opaqueIndex++ % interval === 0) {
                    samples.push({
                        x, y, index,
                        rightIndex: (y * width + Math.min(width - 1, x + 1)) * 4,
                        belowIndex: (Math.min(height - 1, y + 1) * width + x) * 4,
                        leftIndex: (y * width + Math.max(0, x - 1)) * 4,
                        aboveIndex: (Math.max(0, y - 1) * width + x) * 4,
                        weight: alpha / 255,
                    });
                }
            }
        }
        return samples;
    }

    function estimateReferenceBackground(reference) {
        const bins = new Map();
        let transparent = 0;
        const step = Math.max(1, Math.floor(Math.max(reference.width, reference.height) / 100));
        const add = (x, y) => {
            const index = (y * reference.width + x) * 4;
            if (reference.data[index + 3] <= 32) {
                transparent += 1;
                return;
            }
            const rgb = [reference.data[index], reference.data[index + 1], reference.data[index + 2]];
            const key = rgb.map((value) => value >> 4).join(':');
            const entry = bins.get(key) || { count: 0, rgb: [0, 0, 0] };
            entry.count += 1;
            rgb.forEach((value, channel) => { entry.rgb[channel] += value; });
            bins.set(key, entry);
        };
        for (let x = 0; x < reference.width; x += step) {
            add(x, 0);
            add(x, reference.height - 1);
        }
        for (let y = step; y < reference.height - 1; y += step) {
            add(0, y);
            add(reference.width - 1, y);
        }
        const opaque = Array.from(bins.values()).reduce((count, entry) => count + entry.count, 0);
        if (!opaque || transparent / (transparent + opaque) > 0.05) return null;
        const dominant = Array.from(bins.values()).sort((a, b) => b.count - a.count)[0];
        if (!dominant || dominant.count / opaque < 0.9) return null;
        return dominant.rgb.map((value) => value / dominant.count);
    }

    function scoreTemplateAt(template, reference, background, x, y) {
        let error = 0;
        let totalWeight = 0;
        for (const sample of template.samples) {
            const targetIndex = ((y + sample.y) * reference.width + x + sample.x) * 4;
            const source = template.data;
            const target = reference.data;
            const weight = sample.weight;
            const sourceAlpha = source[sample.index + 3] / 255;
            const targetAlpha = target[targetIndex + 3] / 255;
            const currentSource = [0, 1, 2].map((channel) => background
                ? source[sample.index + channel] * sourceAlpha + background[channel] * (1 - sourceAlpha)
                : source[sample.index + channel]);
            const currentTarget = [0, 1, 2].map((channel) => target[targetIndex + channel]);
            let colorError = 0;
            for (let channel = 0; channel < 3; channel += 1) {
                colorError += Math.abs(currentSource[channel] - currentTarget[channel]) / 765;
            }
            const alphaPenalty = background
                ? (targetAlpha <= 0.12 ? 0.2 : 0)
                : Math.abs(sourceAlpha - targetAlpha) * 0.2;
            const rightOffset = x + sample.x + 1 < reference.width ? 4 : 0;
            const belowOffset = y + sample.y + 1 < reference.height ? reference.width * 4 : 0;
            const leftOffset = x + sample.x > 0 ? -4 : 0;
            const aboveOffset = y + sample.y > 0 ? -reference.width * 4 : 0;
            let gradientError = 0;
            for (let channel = 0; channel < 3; channel += 1) {
                const composite = (index) => background
                    ? source[index + channel] * (source[index + 3] / 255) +
                    background[channel] * (1 - source[index + 3] / 255)
                    : source[index + channel];
                const compareGradient = (neighborIndex, targetOffset) => {
                    if (!background && source[neighborIndex + 3] <= 32) return 0;
                    return Math.abs(
                        composite(neighborIndex) - currentSource[channel] -
                        target[targetIndex + targetOffset + channel] + currentTarget[channel],
                    ) / 3060;
                };
                gradientError += compareGradient(sample.rightIndex, rightOffset);
                gradientError += compareGradient(sample.belowIndex, belowOffset);
                gradientError += compareGradient(sample.leftIndex, leftOffset);
                gradientError += compareGradient(sample.aboveIndex, aboveOffset);
            }
            error += weight * (colorError + gradientError * MATCH_GRADIENT_WEIGHT + alphaPenalty);
            totalWeight += weight;
        }
        return totalWeight ? error / totalWeight : 1;
    }

    function matchImageToReference(image, reference, analysisScale) {
        const stride = Math.max(1, Math.round(Math.max(reference.width, reference.height) / 60));
        const candidates = [];
        const background = estimateReferenceBackground(reference);
        const prepare = (factor) => {
            const pixels = imagePixels(
                image,
                image.naturalWidth * analysisScale * factor,
                image.naturalHeight * analysisScale * factor,
            );
            const bounds = alphaBounds(pixels.data, pixels.width, pixels.height);
            if (!bounds) return null;
            const samples = templateSamples(pixels.data, pixels.width, pixels.height, bounds);
            if (!samples.length || samples.length < 8) return null;
            return { ...pixels, bounds, samples, factor };
        };
        const scan = (template, factor, xFrom, xTo, yFrom, yTo, step) => {
            const { bounds } = template;
            const minX = Math.max(xFrom, -bounds.left);
            const maxX = Math.min(xTo, reference.width - bounds.right - 1);
            const minY = Math.max(yFrom, -bounds.top);
            const maxY = Math.min(yTo, reference.height - bounds.bottom - 1);
            for (let y = minY; y <= maxY; y += step) {
                for (let x = minX; x <= maxX; x += step) {
                    candidates.push({
                        x, y, factor, template, scanStride: step,
                        score: scoreTemplateAt(template, reference, background, x, y),
                    });
                }
            }
        };

        MATCH_SCALES.forEach((factor) => {
            const template = prepare(factor);
            if (!template) return;
            const featureSize = Math.min(
                template.bounds.right - template.bounds.left + 1,
                template.bounds.bottom - template.bounds.top + 1,
            );
            const coarseStride = factor === 1
                ? Math.max(1, Math.min(stride, Math.floor(featureSize / 8)))
                : stride;
            scan(template, factor, -template.bounds.left, reference.width - template.bounds.right - 1,
                -template.bounds.top, reference.height - template.bounds.bottom - 1, coarseStride);
        });
        if (!candidates.length) return { status: 'unmatched' };
        const candidatesByScale = new Map();
        candidates.forEach((candidate) => {
            const scaleCandidates = candidatesByScale.get(candidate.factor) || [];
            scaleCandidates.push(candidate);
            candidatesByScale.set(candidate.factor, scaleCandidates);
        });
        const seeds = [];
        candidatesByScale.forEach((scaleCandidates) => {
            scaleCandidates.sort((a, b) => a.score - b.score);
            const scaleSeeds = [];
            for (const candidate of scaleCandidates) {
                const centerX = candidate.x + (candidate.template.bounds.left + candidate.template.bounds.right) / 2;
                const centerY = candidate.y + (candidate.template.bounds.top + candidate.template.bounds.bottom) / 2;
                const distinct = scaleSeeds.every((seed) => {
                    const seedX = seed.x + (seed.template.bounds.left + seed.template.bounds.right) / 2;
                    const seedY = seed.y + (seed.template.bounds.top + seed.template.bounds.bottom) / 2;
                    return Math.hypot(centerX - seedX, centerY - seedY) >
                        Math.max(candidate.scanStride, seed.scanStride) * 1.5;
                });
                if (!distinct) continue;
                scaleSeeds.push(candidate);
                if (scaleSeeds.length === MAX_MATCH_SEEDS_PER_SCALE) break;
            }
            seeds.push(...scaleSeeds);
        });
        seeds.sort((a, b) => a.score - b.score).forEach((seed) => {
            [0.92, 0.96, 1, 1.04, 1.08].forEach((ratio) => {
                const factor = seed.factor * ratio;
                const template = prepare(factor);
                if (!template) return;
                scan(template, factor, seed.x - seed.scanStride, seed.x + seed.scanStride,
                    seed.y - seed.scanStride, seed.y + seed.scanStride, 1);
            });
        });
        candidates.sort((a, b) => a.score - b.score);
        const best = candidates[0];
        const bestCenter = {
            x: best.x + (best.template.bounds.left + best.template.bounds.right) / 2,
            y: best.y + (best.template.bounds.top + best.template.bounds.bottom) / 2,
        };
        const alternative = candidates.find((candidate) => {
            const centerX = candidate.x + (candidate.template.bounds.left + candidate.template.bounds.right) / 2;
            const centerY = candidate.y + (candidate.template.bounds.top + candidate.template.bounds.bottom) / 2;
            const separatePosition = Math.hypot(centerX - bestCenter.x, centerY - bestCenter.y) > stride * 1.5;
            const separateScale = Math.abs(candidate.factor / best.factor - 1) > 0.15;
            return separatePosition || separateScale;
        });
        if (best.score > 0.18 || (alternative && alternative.score - best.score < 0.01)) {
            return {
                status: best.score > 0.18 ? 'unmatched' : 'ambiguous',
                score: best.score,
                alternativeScore: alternative?.score,
                best: { x: best.x, y: best.y, factor: best.factor },
                alternative: alternative && {
                    x: alternative.x,
                    y: alternative.y,
                    factor: alternative.factor,
                },
            };
        }
        return {
            status: 'matched',
            x: best.x,
            y: best.y,
            factor: best.factor,
            score: best.score,
            alternativeScore: alternative?.score,
            alternative: alternative && {
                x: alternative.x,
                y: alternative.y,
                factor: alternative.factor,
            },
        };
    }

    function normalizeComposition(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('The project file must contain a composition object.');
        }
        if (!Array.isArray(value.layers) || value.layers.length > MAX_LAYERS) {
            throw new Error(`A project must contain no more than ${MAX_LAYERS} layers.`);
        }
        const width = Math.round(clamp(finite(value.width, 1080), 1, 10000));
        const height = Math.round(clamp(finite(value.height, 1080), 1, 10000));
        const duration = Math.round(clamp(finite(value.duration, DEFAULT_ANIMATION_DURATION), 500, MAX_ANIMATION_DURATION));
        const ids = new Set();
        const layers = value.layers.map((item, index) => {
            if (!item || !safeImageUrl(item.url)) {
                throw new Error(`Layer ${index + 1} has an unsupported or missing image URL.`);
            }
            const layer = makeLayer(item, index);
            if (ids.has(layer.id)) layer.id = `layer-${Date.now().toString(36)}-${index.toString(36)}`;
            ids.add(layer.id);
            return layer;
        });
        return {
            version: 1,
            id: typeof value.id === 'string' ? value.id.slice(0, 80) : 'composition',
            name: (typeof value.name === 'string' ? value.name.trim().slice(0, 120) : '') || 'Untitled Composition',
            width,
            height,
            duration,
            referenceLayerId: typeof value.referenceLayerId === 'string' && layers.some((layer) => layer.id === value.referenceLayerId)
                ? value.referenceLayerId
                : null,
            characters: normalizeCharacters(value.characters, layers),
            layers,
        };
    }

    function escapeXml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
        })[char]);
    }

    function downloadFile(name, type, content) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function safeFilename(value, extension) {
        const stem = value.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80);
        return `${stem || 'composition'}.${extension}`;
    }

    const CRC_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n += 1) {
            let c = n;
            for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    // Minimal "stored" (uncompressed) ZIP writer. Images are already compressed.
    function buildStoredZip(files) {
        const encoder = new TextEncoder();
        const chunks = [];
        const central = [];
        let offset = 0;
        files.forEach((file) => {
            const name = encoder.encode(file.name);
            const data = file.data;
            const crc = crc32(data);
            const local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true);
            local.setUint16(4, 20, true);
            local.setUint16(6, 0x0800, true);
            local.setUint32(14, crc, true);
            local.setUint32(18, data.length, true);
            local.setUint32(22, data.length, true);
            local.setUint16(26, name.length, true);
            chunks.push(new Uint8Array(local.buffer), name, data);
            const entry = new DataView(new ArrayBuffer(46));
            entry.setUint32(0, 0x02014b50, true);
            entry.setUint16(4, 20, true);
            entry.setUint16(6, 20, true);
            entry.setUint16(8, 0x0800, true);
            entry.setUint32(16, crc, true);
            entry.setUint32(20, data.length, true);
            entry.setUint32(24, data.length, true);
            entry.setUint16(28, name.length, true);
            entry.setUint32(42, offset, true);
            central.push(new Uint8Array(entry.buffer), name);
            offset += 30 + name.length + data.length;
        });
        let centralSize = 0;
        central.forEach((chunk) => { centralSize += chunk.length; });
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, files.length, true);
        end.setUint16(10, files.length, true);
        end.setUint32(12, centralSize, true);
        end.setUint32(16, offset, true);
        return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
    }

    function formatBytes(value) {
        const bytes = Number(value);
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function downloadBlob(name, blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function dilateAlpha(alpha, width, height, radius) {
        const filter = (input, horizontal) => {
            const output = new Uint8Array(input.length);
            const lineLength = horizontal ? width : height;
            const lineCount = horizontal ? height : width;
            const at = (line, position) => horizontal
                ? line * width + position
                : position * width + line;
            for (let line = 0; line < lineCount; line += 1) {
                const deque = new Int32Array(lineLength);
                let head = 0;
                let tail = 0;
                let next = 0;
                for (let position = 0; position < lineLength; position += 1) {
                    const right = Math.min(lineLength - 1, position + radius);
                    while (next <= right) {
                        const nextValue = input[at(line, next)];
                        while (tail > head && input[at(line, deque[tail - 1])] <= nextValue) tail -= 1;
                        deque[tail++] = next++;
                    }
                    const left = Math.max(0, position - radius);
                    while (head < tail && deque[head] < left) head += 1;
                    output[at(line, position)] = input[at(line, deque[head])];
                }
            }
            return output;
        };
        return filter(filter(alpha, true), false);
    }

    function gifLzw(indices) {
        const clearCode = 256;
        const endCode = 257;
        let dictionary = new Map();
        let nextCode = 258;
        const bytes = new Uint8Array(indices.length * 2 + 16);
        let byteLength = 0;
        let buffer = 0;
        let bitCount = 0;
        let codeSize = 9;
        const writeCode = (code) => {
            buffer |= code << bitCount;
            bitCount += codeSize;
            while (bitCount >= 8) {
                bytes[byteLength++] = buffer & 255;
                buffer >>>= 8;
                bitCount -= 8;
            }
        };
        writeCode(clearCode);
        if (!indices.length) {
            writeCode(endCode);
        } else {
            let prefix = indices[0];
            for (let index = 1; index < indices.length; index += 1) {
                const value = indices[index];
                const key = (prefix << 8) | value;
                const existing = dictionary.get(key);
                if (existing !== undefined) {
                    prefix = existing;
                    continue;
                }
                writeCode(prefix);
                if (nextCode < 4096) {
                    dictionary.set(key, nextCode);
                    nextCode += 1;
                    // The decoder adds each entry one code later than the encoder.
                    if (nextCode === (1 << codeSize) + 1 && codeSize < 12) codeSize += 1;
                } else {
                    writeCode(clearCode);
                    dictionary = new Map();
                    nextCode = 258;
                    codeSize = 9;
                }
                prefix = value;
            }
            writeCode(prefix);
            writeCode(endCode);
        }
        if (bitCount) bytes[byteLength++] = buffer & 255;
        return bytes.subarray(0, byteLength);
    }

    function buildGifPalette() {
        const palette = [];
        // 6x6x6 colour cube: good coverage for skin, hair and the black shirt
        for (let r = 0; r < 6; r += 1) {
            for (let g = 0; g < 6; g += 1) {
                for (let b = 0; b < 6; b += 1) {
                    palette.push([r * 51, g * 51, b * 51]);
                }
            }
        }
        // neutral ramp for the grey hair / beard / shirt edges
        for (let index = 0; index < 16; index += 1) {
            const value = Math.round(index * 255 / 15);
            palette.push([value, value, value]);
        }
        const ramp = (from, to, steps) => {
            for (let index = 0; index < steps; index += 1) {
                const amount = steps === 1 ? 0 : index / (steps - 1);
                palette.push([
                    Math.round(from[0] + (to[0] - from[0]) * amount),
                    Math.round(from[1] + (to[1] - from[1]) * amount),
                    Math.round(from[2] + (to[2] - from[2]) * amount),
                ]);
            }
        };
        ramp([243, 200, 158], [232, 180, 138], 8);   // skin
        ramp([119, 111, 100], [86, 80, 71], 8);      // beard / hair
        [
            [237, 237, 237], // eye white
            [20, 20, 20],    // pupil
            [29, 29, 31],    // shirt
            [43, 27, 22],    // mouth cavity
            [186, 104, 97],  // tongue
            [246, 240, 229], // teeth
        ].forEach((colour) => palette.push(colour));
        while (palette.length < 256) palette.push([0, 0, 0]);
        return palette.slice(0, 256);
    }

    function buildGifLookup(palette) {
        const lookup = new Uint8Array(32768);
        for (let key = 0; key < 32768; key += 1) {
            const red = ((key >> 10) & 31) << 3;
            const green = ((key >> 5) & 31) << 3;
            const blue = (key & 31) << 3;
            let best = 0;
            let bestDistance = Infinity;
            for (let index = 0; index < palette.length; index += 1) {
                const colour = palette[index];
                const dr = red - colour[0];
                const dg = green - colour[1];
                const db = blue - colour[2];
                const distance = dr * dr + dg * dg + db * db;
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = index;
                }
            }
            lookup[key] = best;
        }
        return lookup;
    }

    const GIF_PALETTE = buildGifPalette();
    const GIF_LOOKUP = buildGifLookup(GIF_PALETTE);

    class GifEncoder {
        constructor(width, height) {
            if (width > 65535 || height > 65535) throw new Error('GIF dimensions cannot exceed 65535 pixels.');
            this.width = width;
            this.height = height;
            this.parts = [];
            this.writeString('GIF89a');
            this.writeWord(width);
            this.writeWord(height);
            this.writeBytes([0xf7, 0, 0]);
            this.palette = GIF_PALETTE;
            this.lookup = GIF_LOOKUP;
            for (let index = 0; index < 256; index += 1) {
                const colour = this.palette[index] || [0, 0, 0];
                this.writeBytes(colour);
            }
            this.writeBytes([0x21, 0xff, 0x0b]);
            this.writeString('NETSCAPE2.0');
            this.writeBytes([3, 1, 0, 0, 0]);
        }

        writeBytes(bytes) {
            this.parts.push(Uint8Array.from(bytes));
        }

        writeString(value) {
            this.writeBytes(Array.from(value, (char) => char.charCodeAt(0)));
        }

        writeWord(value) {
            this.writeBytes([value & 255, (value >> 8) & 255]);
        }

        addFrame(imageData, delayMs) {
            const indices = new Uint8Array(this.width * this.height);
            const pixels = imageData.data;
            for (let pixel = 0; pixel < indices.length; pixel += 1) {
                const offset = pixel * 4;
                const key = ((pixels[offset] >> 3) << 10)
                    | ((pixels[offset + 1] >> 3) << 5)
                    | (pixels[offset + 2] >> 3);
                indices[pixel] = this.lookup[key];
            }
            const compressed = gifLzw(indices);
            this.writeBytes([0x21, 0xf9, 4, 0x04]);
            this.writeWord(Math.max(2, Math.round(delayMs / 10)));
            this.writeBytes([0, 0, 0x2c]);
            this.writeWord(0);
            this.writeWord(0);
            this.writeWord(this.width);
            this.writeWord(this.height);
            this.writeBytes([0, 8]);
            const dataBlocks = new Uint8Array(compressed.length + Math.ceil(compressed.length / 255) + 1);
            let blockOffset = 0;
            for (let offset = 0; offset < compressed.length; offset += 255) {
                const block = compressed.subarray(offset, offset + 255);
                dataBlocks[blockOffset++] = block.length;
                dataBlocks.set(block, blockOffset);
                blockOffset += block.length;
            }
            dataBlocks[blockOffset] = 0;
            this.parts.push(dataBlocks.subarray(0, blockOffset + 1));
        }

        finish() {
            this.writeBytes([0x3b]);
            return new Blob(this.parts, { type: 'image/gif' });
        }
    }

    class LayerStudio {
        constructor(root) {
            this.root = root;
            this.composition = {
                version: 1,
                id: 'composition',
                name: 'Untitled Composition',
                width: 1080,
                height: 1080,
                duration: DEFAULT_ANIMATION_DURATION,
                referenceLayerId: null,
                characters: [],
                layers: [],
            };
            this.selectedLayerId = null;
            this._ctrl = null;
            this.projectId = null;
            this.projectMeta = null;
            this.repositorySource = null;
            this.projectCatalog = [];
            this._saveTimer = null;
            this._savePromise = null;
            this._saveQueued = false;
            this.proposals = [];
            this.proposalMeta = null;
            this.characterAnimations = CHARACTER_ANIMATION_PRESETS;
            this.activeProposalId = null;
            this._proposalError = null;
            this.llm = null;
            this._llmPromise = null;
            this._llmLoadedAt = 0;
            this.directorBusy = false;
            this._proposalTimer = null;
            this._proposalStartedAt = 0;
            this._contextTimer = null;
            this.animation = { isPlaying: false, rafId: null, startedAt: 0, currentTime: 0 };
            const narrow = window.matchMedia('(max-width: 650px)').matches;
            const compact = window.matchMedia('(max-width: 900px)').matches;
            const initialPanelSize = narrow ? 200 : (compact ? 220 : 260);
            this.panelSizes = { sidebar: initialPanelSize, inspector: initialPanelSize };
            this.el = {
                canvas: root.querySelector('#layerCanvas'),
                list: root.querySelector('#layerList'),
                inspector: root.querySelector('#layerInspector'),
                name: root.querySelector('#layerCompositionName'),
                projectSelect: root.querySelector('#layerProjectSelect'),
                compositionSelect: root.querySelector('#layerCompositionSelect'),
                size: root.querySelector('#layerCanvasSize'),
                canvasCustom: root.querySelector('#layerCanvasCustomControls'),
                canvasWidth: root.querySelector('#layerCanvasWidth'),
                canvasHeight: root.querySelector('#layerCanvasHeight'),
                artworkScale: root.querySelector('#layerCharacterScale'),
                artworkOffsetX: root.querySelector('#layerCharacterOffsetX'),
                artworkOffsetY: root.querySelector('#layerCharacterOffsetY'),
                status: root.querySelector('#layerStudioStatus'),
                files: root.querySelector('#layerFilesInput'),
                folder: root.querySelector('#layerFolderInput'),
                characterInput: root.querySelector('#layerCharacterInput'),
                project: root.querySelector('#layerProjectInput'),
                play: root.querySelector('#layerPlayBtn'),
                duration: root.querySelector('#layerDuration'),
                playhead: root.querySelector('#layerPlayhead'),
                playheadTime: root.querySelector('#layerPlayheadTime'),
                keyframeCount: root.querySelector('#layerKeyframeCount'),
                exportProgress: root.querySelector('#layerExportProgress'),
                saveProject: root.querySelector('#layerSaveProject'),
                sidebar: root.querySelector('.layer-sidebar'),
                inspectorPanel: root.querySelector('.layer-inspector-panel'),
                archiveDialog: root.querySelector('#layerArchiveDialog'),
                archiveZip: root.querySelector('#layerArchiveZip'),
                archiveRef: root.querySelector('#layerArchiveRef'),
                archiveName: root.querySelector('#layerArchiveName'),
                archiveStatus: root.querySelector('#layerArchiveStatus'),
                archiveSubmit: root.querySelector('#layerArchiveSubmit'),
                savedList: root.querySelector('#layerSavedList'),
                proposalMeta: root.querySelector('#layerProposalMeta'),
                proposalContext: root.querySelector('#layerProposalContext'),
                proposalList: root.querySelector('#layerProposalList'),
                proposeButton: root.querySelector('#layerProposeButton'),
                resetAnimations: root.querySelector('#layerResetAnimations'),
                directorDialog: root.querySelector('#layerDirectorDialog'),
                projectContext: root.querySelector('#layerProjectContext'),
                visionModel: root.querySelector('#layerVisionModel'),
                textModel: root.querySelector('#layerTextModel'),
                directorStatus: root.querySelector('#layerDirectorStatus'),
            };
            this.bind();
            this.render();
            this.renderProposals();
            this.updateProposalContext();
            this.loadProjectCatalog();
        }

        bind() {
            this.root.addEventListener('click', (event) => this.onClick(event));
            this.root.addEventListener('pointerdown', (event) => this.onPointerDown(event));
            this.root.addEventListener('input', (event) => this.onInput(event));
            this.root.addEventListener('change', (event) => this.onChange(event));
            this.root.addEventListener('keydown', (event) => this.onKeyDown(event));
            this.el.canvas.addEventListener('dragover', (event) => event.preventDefault());
            this.el.canvas.addEventListener('drop', (event) => {
                event.preventDefault();
                this.importFiles(Array.from(event.dataTransfer?.files || []));
            });
            document.addEventListener('paste', (event) => this.onPaste(event));
        }

        onPaste(event) {
            if (!this.root.classList.contains('active')) return;
            const target = event.target;
            if (target?.isContentEditable || target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
            const clipboard = event.clipboardData;
            if (!clipboard) return;
            const itemFiles = Array.from(clipboard.items || [])
                .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                .map((item) => item.getAsFile())
                .filter(Boolean);
            const clipboardFiles = Array.from(clipboard.files || []).filter((file) => file.type.startsWith('image/'));
            const image = [...itemFiles, ...clipboardFiles].find((file) => file.type === 'image/png')
                || itemFiles[0]
                || clipboardFiles[0];
            if (!image) return;
            event.preventDefault();
            const typeExtension = image.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
            const file = image.name
                ? image
                : new File([image], `Pasted image.${typeExtension}`, { type: image.type });
            this.importFiles([file], { center: true, pasted: true });
        }

        setStatus(message, error = false, review = false) {
            if (!this.el.status) return;
            this.el.status.textContent = message;
            this.el.status.dataset.error = String(error);
            this.el.status.dataset.review = String(review && !error);
        }

        _spriteState(layer, time) {
            const frames = Array.isArray(layer.frames) && layer.frames.length ? layer.frames : [layer.url];
            if (frames.length <= 1) return { frameIndex: 0, frameUrl: frames[0] || layer.url };
            const fps = layer.spriteFps || 8;
            const tick = Math.floor((time / 1000) * fps);
            let frameIndex;
            if (layer.spriteMode === 'once') {
                frameIndex = Math.min(frames.length - 1, Math.max(0, tick));
            } else if (layer.spriteMode === 'pingpong') {
                const period = frames.length * 2 - 2;
                const p = ((tick % period) + period) % period;
                frameIndex = p < frames.length ? p : period - p;
            } else {
                frameIndex = ((tick % frames.length) + frames.length) % frames.length;
            }
            return { frameIndex, frameUrl: frames[frameIndex] };
        }

        getLayerStateAtTime(layer, time) {
            const frames = layer.keyframes || [];
            const sprite = this._spriteState(layer, time);
            if (!frames.length) return { ...layer, ...sprite };
            if (time <= frames[0].time) return { ...layer, ...frames[0], ...sprite };
            if (time >= frames[frames.length - 1].time) {
                return { ...layer, ...frames[frames.length - 1], ...sprite };
            }
            const nextIndex = frames.findIndex((frame) => frame.time >= time);
            const previous = frames[nextIndex - 1];
            const next = frames[nextIndex];
            const raw = (time - previous.time) / Math.max(1, next.time - previous.time);
            const amount = easeValue(next.easing, raw);
            const state = { ...layer };
            ANIMATED_PROPERTIES.forEach((property) => {
                state[property] = previous[property] + (next[property] - previous[property]) * amount;
            });
            return { ...state, ...sprite };
        }

        applyAnimationTime(time) {
            const position = clamp(Number(time) || 0, 0, this.composition.duration);
            this.animation.currentTime = position;
            const nodes = new Map(Array.from(this.el.canvas.querySelectorAll('.layer-item'))
                .map((node) => [node.dataset.id, node]));
            this.composition.layers.forEach((layer) => {
                const node = nodes.get(layer.id);
                if (!node) return;
                const state = this.getLayerStateAtTime(layer, position);
                Object.assign(node.style, {
                    left: `${state.x}%`,
                    top: `${state.y}%`,
                    width: `${state.w}%`,
                    height: `${state.h}%`,
                    opacity: String(state.opacity),
                    transform: `rotate(${state.rotation}deg)`,
                });
                const img = node.querySelector('img');
                if (img && state.frameUrl && img.dataset.frame !== state.frameUrl) {
                    img.src = state.frameUrl;
                    img.dataset.frame = state.frameUrl;
                }
            });
            this.renderAnimationControls();
            this.syncAnimationInspector();
        }

        renderAnimationControls() {
            if (!this.el.playhead) return;
            const duration = this.composition.duration || DEFAULT_ANIMATION_DURATION;
            this.el.duration.value = String(duration);
            this.el.playhead.max = String(duration);
            this.el.playhead.value = String(Math.round(this.animation.currentTime));
            this.el.playhead.disabled = this.animation.isPlaying || this.animation.isExporting;
            this.el.playheadTime.value = `${Math.round(this.animation.currentTime)} ms`;
            const selected = this.getLayer(this.selectedLayerId);
            const frames = selected?.keyframes || [];
            this.el.keyframeCount.textContent = `${frames.length} keyframe${frames.length === 1 ? '' : 's'}`;
            const exactFrame = frames.some((frame) => frame.time === Math.round(this.animation.currentTime));
            const setButton = this.root.querySelector('[data-action="set-keyframe"]');
            const deleteButton = this.root.querySelector('[data-action="delete-keyframe"]');
            if (setButton) setButton.disabled = !selected
                || this.animation.isPlaying
                || this.animation.isExporting
                || (frames.length >= MAX_KEYFRAMES_PER_LAYER && !exactFrame);
            if (deleteButton) deleteButton.disabled = !selected || !exactFrame || this.animation.isPlaying || this.animation.isExporting;
            if (this.el.duration) this.el.duration.disabled = this.animation.isPlaying || this.animation.isExporting;
            if (this.el.play) this.el.play.textContent = this.animation.isPlaying ? 'Pause' : 'Play';
            ['export-image', 'export-webm', 'export-gif'].forEach((action) => {
                const button = this.root.querySelector(`[data-action="${action}"]`);
                if (button) button.disabled = this.animation.isPlaying || this.animation.isExporting;
            });
        }

        syncAnimationInspector() {
            const layer = this.getLayer(this.selectedLayerId);
            if (!layer) return;
            const state = this.getLayerStateAtTime(layer, this.animation.currentTime);
            ['x', 'y', 'w', 'h', 'rotation'].forEach((property) => {
                const input = this.el.inspector.querySelector(`[data-prop="${property}"]`);
                if (input && document.activeElement !== input) input.value = String(Number(state[property].toFixed(2)));
            });
            const opacity = this.el.inspector.querySelector('[data-prop="opacity"]');
            if (opacity && document.activeElement !== opacity) opacity.value = String(Math.round(state.opacity * 100));
        }

        upsertKeyframe(layer, time, state) {
            const frame = { time: Math.round(clamp(time, 0, this.composition.duration)) };
            ANIMATED_PROPERTIES.forEach((property) => { frame[property] = state[property]; });
            if (state.easing && EASING_NAMES.includes(state.easing)) frame.easing = state.easing;
            layer.keyframes = normalizeKeyframes([
                ...(layer.keyframes || []).filter((item) => item.time !== frame.time),
                frame,
            ]);
        }

        setKeyframe() {
            const layer = this.getLayer(this.selectedLayerId);
            if (!layer) {
                this.setStatus('Select a layer before setting a keyframe.', true);
                return;
            }
            const time = Math.round(this.animation.currentTime);
            this.upsertKeyframe(layer, time, this.getLayerStateAtTime(layer, time));
            this.applyAnimationTime(time);
            this.setStatus(`Keyframe set for ${layer.name} at ${time} ms.`);
            this.scheduleSave();
        }

        deleteKeyframe() {
            const layer = this.getLayer(this.selectedLayerId);
            if (!layer) return;
            const time = Math.round(this.animation.currentTime);
            const before = layer.keyframes.length;
            layer.keyframes = layer.keyframes.filter((frame) => frame.time !== time);
            if (layer.keyframes.length === before) return;
            this.applyAnimationTime(time);
            this.setStatus(`Keyframe removed from ${layer.name} at ${time} ms.`);
            this.scheduleSave();
        }

        togglePlay() {
            if (this.animation.isPlaying) {
                this.stopPlayback();
                return;
            }
            if (this.animation.isExporting) return;
            if (!this.composition.layers.some((layer) => layer.visible)) {
                this.setStatus('Show at least one layer before playing the animation.', true);
                return;
            }
            this.animation.isPlaying = true;
            this.animation.startedAt = performance.now() - this.animation.currentTime;
            this.renderAnimationControls();
            const tick = (now) => {
                if (!this.animation.isPlaying) return;
                const duration = this.composition.duration;
                const time = (now - this.animation.startedAt) % duration;
                this.applyAnimationTime(time);
                this.animation.rafId = requestAnimationFrame(tick);
            };
            this.animation.rafId = requestAnimationFrame(tick);
        }

        stopPlayback() {
            this.animation.isPlaying = false;
            if (this.animation.rafId !== null) cancelAnimationFrame(this.animation.rafId);
            this.animation.rafId = null;
            this.renderAnimationControls();
        }

        render() {
            this.el.name.value = this.composition.name;
            const size = `${this.composition.width}x${this.composition.height}`;
            if (Array.from(this.el.size.options).some((option) => option.value === size)) {
                this.el.size.value = size;
            } else {
                this.el.size.value = 'custom';
            }
            if (this.el.canvasCustom && this.el.canvasWidth && this.el.canvasHeight) {
                this.el.canvasCustom.hidden = this.el.size.value !== 'custom';
                this.el.canvasWidth.value = String(this.composition.width);
                this.el.canvasHeight.value = String(this.composition.height);
            }
            this.el.canvas.style.aspectRatio = `${this.composition.width} / ${this.composition.height}`;
            this.el.canvas.style.setProperty('--ls-canvas-ratio', String(this.composition.width / this.composition.height));
            this.renderCanvas();
            this.renderList();
            this.renderInspector();
            this.renderAnimationControls();
            this.applyAnimationTime(this.animation.currentTime);
            this.syncProjectControls();
        }

        isReferenceLayer(layer) {
            return layer.id === this.composition.referenceLayerId || layer.reference === true;
        }

        transformLayerGeometry(layer, scaleX, scaleY, pivotX = 0, pivotY = 0) {
            const transform = (state) => {
                state.x = pivotX + (finite(state.x, 0) - pivotX) * scaleX;
                state.y = pivotY + (finite(state.y, 0) - pivotY) * scaleY;
                state.w = finite(state.w, 0) * scaleX;
                state.h = finite(state.h, 0) * scaleY;
            };
            transform(layer);
            (layer.keyframes || []).forEach(transform);
        }

        applyCanvasDimensions(width, height) {
            if (width === this.composition.width && height === this.composition.height) {
                this.setStatus('Canvas dimensions are unchanged.');
                return;
            }
            this.stopPlayback();
            const scaleX = this.composition.width / width;
            const scaleY = this.composition.height / height;
            this.composition.layers
                .filter((layer) => !this.isReferenceLayer(layer))
                .forEach((layer) => this.transformLayerGeometry(layer, scaleX, scaleY));
            this.composition.width = width;
            this.composition.height = height;
            this.render();
            this.setStatus(
                `Canvas resized to ${width} × ${height}. Layer positions, sizes, and confirmations were preserved.`,
            );
            this.scheduleSave();
        }

        scaleArtwork(percent) {
            const factor = percent / 100;
            if (factor === 1) {
                this.setStatus('Artwork scale is unchanged.');
                return;
            }
            const layers = this.composition.layers.filter((layer) => !this.isReferenceLayer(layer));
            if (!layers.length) {
                this.setStatus('Add artwork layers before scaling.', true);
                return;
            }
            this.stopPlayback();
            layers.forEach((layer) => this.transformLayerGeometry(layer, factor, factor, 50, 50));
            this.render();
            this.setStatus(
                `Scaled ${layers.length} non-reference layers to ${percent}% around the canvas center. Position confirmations were preserved.`,
            );
            this.scheduleSave();
        }

        moveArtwork(offsetX, offsetY) {
            if (offsetX === 0 && offsetY === 0) {
                this.setStatus('Character position is unchanged.');
                return;
            }
            const layers = this.composition.layers.filter((layer) => !this.isReferenceLayer(layer));
            if (!layers.length) {
                this.setStatus('Add artwork layers before moving the character.', true);
                return;
            }
            const deltaX = offsetX / this.composition.width * 100;
            const deltaY = offsetY / this.composition.height * 100;
            const translate = (state) => {
                state.x = finite(state.x, 0) + deltaX;
                state.y = finite(state.y, 0) + deltaY;
            };
            this.stopPlayback();
            layers.forEach((layer) => {
                translate(layer);
                (layer.keyframes || []).forEach(translate);
            });
            this.render();
            this.setStatus(
                `Moved ${layers.length} non-reference layers by ${offsetX} px horizontally and ${offsetY} px vertically. Position confirmations were preserved.`,
            );
            this.scheduleSave();
        }

        renderCanvas() {
            this.el.canvas.replaceChildren();
            const referenceId = this.composition.referenceLayerId;
            const effected = this.composition.layers.filter(hasLayerEffects);
            if (effected.length) {
                const defsSvg = document.createElementNS(SVG_NS, 'svg');
                defsSvg.classList.add('layer-filter-defs');
                defsSvg.setAttribute('aria-hidden', 'true');
                const defs = document.createElementNS(SVG_NS, 'defs');
                effected.forEach((layer) => {
                    const parsed = new DOMParser().parseFromString(
                        `<svg xmlns="${SVG_NS}">${layerEffectFilterMarkup(layer)}</svg>`,
                        'image/svg+xml',
                    );
                    const filter = parsed.documentElement.querySelector('filter');
                    if (filter) defs.appendChild(document.importNode(filter, true));
                });
                defsSvg.appendChild(defs);
                this.el.canvas.appendChild(defsSvg);
            }
            const layers = [...this.composition.layers].sort((a, b) => {
                if (a.id === referenceId) return -1;
                if (b.id === referenceId) return 1;
                return a.z - b.z;
            });
            layers.forEach((layer) => {
                if (!layer.visible) return;
                const node = document.createElement('div');
                node.className = 'layer-item';
                node.dataset.id = layer.id;
                node.dataset.selected = String(layer.id === this.selectedLayerId);
                node.dataset.locked = String(layer.locked);
                node.dataset.fit = layer.fit;
                node.dataset.reference = String(layer.id === referenceId);
                Object.assign(node.style, {
                    left: `${layer.x}%`,
                    top: `${layer.y}%`,
                    width: `${layer.w}%`,
                    height: `${layer.h}%`,
                    opacity: String(layer.opacity),
                    zIndex: String(layer.z),
                    transform: `rotate(${layer.rotation}deg)`,
                });
                const image = document.createElement('img');
                const initialState = this.getLayerStateAtTime(layer, this.animation.currentTime);
                image.src = initialState.frameUrl || layer.url;
                image.dataset.frame = image.src;
                image.alt = layer.name;
                image.draggable = false;
                if (hasLayerEffects(layer)) image.style.filter = `url(#${layerFilterId(layer)})`;
                node.appendChild(image);
                if (layer.id === this.selectedLayerId) {
                    GRIPS.forEach((grip) => {
                        const handle = document.createElement('span');
                        handle.className = 'layer-handle';
                        handle.dataset.grip = grip;
                        handle.setAttribute('aria-hidden', 'true');
                        node.appendChild(handle);
                    });
                }
                this.el.canvas.appendChild(node);
            });
        }

        renderList() {
            this.el.list.replaceChildren();
            const sorted = [...this.composition.layers]
                .filter((layer) => layer.rig !== true)
                .sort((a, b) => b.z - a.z);
            sorted.forEach((layer) => {
                const row = document.createElement('div');
                row.className = 'layer-node';
                row.setAttribute('role', 'listitem');
                row.dataset.id = layer.id;
                row.setAttribute('aria-current', String(layer.id === this.selectedLayerId));
                row.dataset.reference = String(layer.id === this.composition.referenceLayerId);

                const select = document.createElement('button');
                select.type = 'button';
                select.className = 'layer-select';
                select.dataset.action = 'select';
                select.dataset.id = layer.id;
                select.setAttribute('aria-label', `Select ${layer.name}`);
                const thumb = document.createElement('img');
                thumb.src = layer.url;
                thumb.alt = '';
                const label = document.createElement('span');
                label.className = 'layer-label';
                label.textContent = layer.name;
                const badge = document.createElement('span');
                badge.className = 'layer-badge';
                badge.textContent = layer.id === this.composition.referenceLayerId ? `REF · ${layer.z}` : String(layer.z);
                const validation = document.createElement('span');
                validation.className = 'layer-validation-badge';
                validation.dataset.confirmed = String(layer.positionConfirmed);
                validation.setAttribute('aria-label', layer.positionConfirmed ? 'Position confirmed' : 'Position needs review');
                validation.title = layer.positionConfirmed ? 'Position confirmed' : 'Position needs review';
                validation.textContent = layer.positionConfirmed ? '✓' : '!';
                select.append(thumb, label, badge, validation);

                const visibility = document.createElement('button');
                visibility.type = 'button';
                visibility.className = 'layer-visibility';
                visibility.dataset.action = 'visibility';
                visibility.dataset.id = layer.id;
                visibility.setAttribute('aria-pressed', String(layer.visible));
                visibility.setAttribute('aria-label', `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`);
                visibility.innerHTML = `<i class="fas ${layer.visible ? 'fa-eye' : 'fa-eye-slash'}" aria-hidden="true"></i>`;
                row.append(select, visibility);
                this.el.list.appendChild(row);
            });
            const toggleVisibility = this.root.querySelector('[data-action="toggle-all-visibility"]');
            if (toggleVisibility) {
                const allVisible = sorted.length > 0 && sorted.every((layer) => layer.visible);
                toggleVisibility.textContent = allVisible ? 'Hide all' : 'Show all';
                toggleVisibility.setAttribute('aria-label', allVisible ? 'Hide all layers' : 'Show all layers');
                toggleVisibility.setAttribute('aria-pressed', String(allVisible));
                toggleVisibility.disabled = sorted.length === 0;
            }
            if (!sorted.length) {
                const empty = document.createElement('p');
                empty.className = 'layer-empty';
                empty.textContent = 'Add images or drop them onto the canvas.';
                this.el.list.appendChild(empty);
            }
            this.syncValidationControls();
        }

        renderInspector() {
            const layer = this.composition.layers.find((item) => item.id === this.selectedLayerId);
            this.el.inspector.replaceChildren();
            this.renderCharactersInto(this.el.inspector);
            if (!layer) {
                const hint = document.createElement('p');
                hint.className = 'layer-empty';
                hint.textContent = 'Select a layer to edit its position and appearance.';
                this.el.inspector.appendChild(hint);
                return;
            }

            const nameField = this.makeField('Name', 'name', layer.name, 'text');
            nameField.querySelector('input').maxLength = 160;
            this.el.inspector.appendChild(nameField);

            // --- Role ---
            const roleField = document.createElement('label');
            roleField.className = 'layer-field';
            roleField.append(document.createTextNode('Role'));
            const role = document.createElement('select');
            role.dataset.prop = 'role';
            [['background','Background'],['midground','Midground'],['ground','Ground'],
             ['foreground','Foreground'],['character','Character'],
             ['character-part','Character part'],['prop','Prop'],['effect','Effect']]
                .forEach(([v, t]) => {
                    const o = document.createElement('option');
                    o.value = v; o.textContent = t;
                    role.appendChild(o);
                });
            role.value = layer.role || 'prop';
            roleField.appendChild(role);
            this.el.inspector.appendChild(roleField);

            // --- Sprite controls (only if multiple frames) ---
            if (Array.isArray(layer.frames) && layer.frames.length > 1) {
                const info = document.createElement('p');
                info.className = 'layer-sprite-info';
                info.textContent = `Sprite · ${layer.frames.length} frame${layer.frames.length === 1 ? '' : 's'}`;
                this.el.inspector.appendChild(info);

                const fpsField = this.makeField('Sprite FPS', 'spriteFps', layer.spriteFps, 'number');
                fpsField.querySelector('input').min = '1';
                fpsField.querySelector('input').max = '30';
                fpsField.querySelector('input').step = '1';
                this.el.inspector.appendChild(fpsField);

                const modeField = document.createElement('label');
                modeField.className = 'layer-field';
                modeField.append(document.createTextNode('Sprite mode'));
                const mode = document.createElement('select');
                mode.dataset.prop = 'spriteMode';
                [['loop','Loop'],['pingpong','Ping-pong'],['once','Once']].forEach(([v, t]) => {
                    const o = document.createElement('option');
                    o.value = v; o.textContent = t;
                    mode.appendChild(o);
                });
                mode.value = layer.spriteMode;
                modeField.appendChild(mode);
                this.el.inspector.appendChild(modeField);
            }

            // --- Preset grid ---
            const presetsGroup = document.createElement('fieldset');
            presetsGroup.className = 'layer-effect-group';
            const presetsLegend = document.createElement('legend');
            presetsLegend.textContent = 'Animation presets';
            presetsGroup.appendChild(presetsLegend);
            const presetsGrid = document.createElement('div');
            presetsGrid.className = 'layer-preset-grid';
            PRESET_NAMES.forEach((name) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = name;
                btn.addEventListener('click', () => this.applyPreset(name));
                presetsGrid.appendChild(btn);
            });
            presetsGroup.appendChild(presetsGrid);
            this.el.inspector.appendChild(presetsGroup);

            [
                ['X (%)', 'x', layer.x, '0.1'],
                ['Y (%)', 'y', layer.y, '0.1'],
                ['Width (%)', 'w', layer.w, '0.1'],
                ['Height (%)', 'h', layer.h, '0.1'],
                ['Rotation (°)', 'rotation', layer.rotation, '1'],
                ['Opacity (%)', 'opacity', Math.round(layer.opacity * 100), '1'],
                ['Z-index', 'z', layer.z, '1'],
            ].forEach(([label, property, value, step]) => {
                const field = this.makeField(label, property, value, 'number');
                const input = field.querySelector('input');
                input.step = step;
                if (property === 'opacity') {
                    input.min = '0';
                    input.max = '100';
                }
                this.el.inspector.appendChild(field);
            });

            const fitField = document.createElement('label');
            fitField.className = 'layer-field';
            fitField.append(document.createTextNode('Image fit'));
            const fit = document.createElement('select');
            fit.dataset.prop = 'fit';
            [['contain', 'Contain'], ['cover', 'Cover']].forEach(([value, text]) => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = text;
                fit.appendChild(option);
            });
            fit.value = layer.fit;
            fitField.appendChild(fit);
            this.el.inspector.appendChild(fitField);

            const colorGroup = document.createElement('fieldset');
            colorGroup.className = 'layer-effect-group';
            const colorLegend = document.createElement('legend');
            colorLegend.textContent = 'Image color';
            colorGroup.appendChild(colorLegend);
            colorGroup.appendChild(this.makeToggle('Replace visible pixels', 'recolorEnabled', layer.recolorEnabled));
            colorGroup.appendChild(this.makeField('Replacement color', 'recolorColor', layer.recolorColor, 'color'));
            this.el.inspector.appendChild(colorGroup);

            const outlineGroup = document.createElement('fieldset');
            outlineGroup.className = 'layer-effect-group';
            const outlineLegend = document.createElement('legend');
            outlineLegend.textContent = 'Contour';
            outlineGroup.appendChild(outlineLegend);
            outlineGroup.appendChild(this.makeToggle('Add contour', 'outlineEnabled', layer.outlineEnabled));
            outlineGroup.appendChild(this.makeField('Contour color', 'outlineColor', layer.outlineColor, 'color'));
            const outlineWidth = this.makeField('Thickness (px)', 'outlineWidth', layer.outlineWidth, 'range');
            outlineWidth.querySelector('input').min = '1';
            outlineWidth.querySelector('input').max = '16';
            outlineWidth.querySelector('input').step = '1';
            outlineGroup.appendChild(outlineWidth);
            this.el.inspector.appendChild(outlineGroup);

            const lock = document.createElement('label');
            lock.className = 'layer-lock-field';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.prop = 'locked';
            checkbox.checked = layer.locked;
            lock.append(checkbox, document.createTextNode(' Lock layer position'));
            this.el.inspector.appendChild(lock);

            const confirmation = document.createElement('button');
            confirmation.type = 'button';
            confirmation.className = 'layer-validation-action';
            confirmation.dataset.action = 'confirm-layer';
            confirmation.setAttribute('aria-pressed', String(layer.positionConfirmed));
            confirmation.textContent = layer.positionConfirmed
                ? 'Position confirmed · reopen review'
                : 'Confirm this position';
            this.el.inspector.appendChild(confirmation);

            const align = document.createElement('button');
            align.type = 'button';
            align.className = 'layer-reference-action';
            align.dataset.action = 'align-reference';
            align.textContent = layer.id === this.composition.referenceLayerId
                ? 'Re-align layers to this reference'
                : 'Use as final image and align layers';
            this.el.inspector.appendChild(align);

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'layer-remove';
            remove.dataset.action = 'remove';
            remove.textContent = 'Remove layer';
            this.el.inspector.appendChild(remove);
        }

        makeField(label, property, value, type) {
            const field = document.createElement('label');
            field.className = 'layer-field';
            field.append(document.createTextNode(label));
            const input = document.createElement('input');
            input.type = type;
            input.dataset.prop = property;
            input.value = String(value);
            field.appendChild(input);
            return field;
        }

        makeToggle(label, property, checked) {
            const field = document.createElement('label');
            field.className = 'layer-effect-toggle';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.dataset.prop = property;
            input.checked = checked;
            field.append(input, document.createTextNode(label));
            return field;
        }

        renderCharactersInto(parent) {
            const characters = this.composition.characters || [];
            if (!characters.length) return;
            if (characters.length === 1) {
                parent.appendChild(this.makeCharacterFieldset(characters[0]));
                return;
            }
            if (!characters.some((c) => c.id === this.selectedCharacterId)) {
                this.selectedCharacterId = characters[0].id;
            }
            const nav = document.createElement('div');
            nav.className = 'layer-character-nav';
            const label = document.createElement('label');
            label.className = 'layer-field';
            label.append(document.createTextNode('Editing character'));
            const select = document.createElement('select');
            characters.forEach((c) => {
                const badge = c.applied ? ' (animated)' : '';
                const opt = new Option(`${c.name}${badge}`, c.id, false, c.id === this.selectedCharacterId);
                select.appendChild(opt);
            });
            select.addEventListener('change', (e) => {
                this.selectedCharacterId = e.target.value;
                this.renderInspector();
            });
            label.appendChild(select);
            nav.appendChild(label);
            parent.appendChild(nav);

            const active = characters.find((c) => c.id === this.selectedCharacterId) || characters[0];
            parent.appendChild(this.makeCharacterFieldset(active));
        }

        makeCharacterFieldset(character) {
            const fieldset = document.createElement('fieldset');
            fieldset.className = 'layer-character-group';
            fieldset.dataset.characterPanel = character.id;

            const legend = document.createElement('legend');
            legend.textContent = `Character · ${character.name}`;
            fieldset.appendChild(legend);

            const parts = CHARACTER_PART_KEYS
                .filter((key) => (character.parts[key] || []).length)
                .map((key) => `${CHARACTER_PART_LABELS[key]} ${character.parts[key].length}`);
            const partsLine = document.createElement('p');
            partsLine.className = 'layer-character-parts';
            partsLine.textContent = parts.length ? parts.join(' · ') : 'No face or body parts detected.';
            fieldset.appendChild(partsLine);

            const partCount = (key) => (character.parts[key] || []).length;
            const hasEyes = partCount('eyes') + partCount('pupils') > 0;
            const hasMouth = partCount('mouth') + partCount('beard') + partCount('mustache') + partCount('jaw') > 0;
            const hasBreathe = partCount('head') + partCount('body') + partCount('face') > 0;
            const hasFace = hasEyes
                || hasMouth
                || partCount('brows') > 0
                || partCount('beard') > 0;

            const expressions = document.createElement('div');
            expressions.className = 'layer-character-expressions';
            CHARACTER_EXPRESSIONS.forEach((expression) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = expression;
                button.disabled = !hasFace;
                button.dataset.action = 'character-expression';
                button.dataset.characterId = character.id;
                button.dataset.expression = expression;
                button.setAttribute('aria-pressed', String(character.settings.expression === expression));
                expressions.appendChild(button);
            });
            fieldset.appendChild(expressions);

            const toggles = document.createElement('div');
            toggles.className = 'layer-character-toggles';
            toggles.appendChild(this.makeCharacterToggle(character, 'blink', 'Blink', !hasEyes));
            toggles.appendChild(this.makeCharacterToggle(character, 'talk', 'Talk', !hasMouth));
            toggles.appendChild(this.makeCharacterToggle(character, 'eyeWander', 'Wander', !hasEyes));
            toggles.appendChild(this.makeCharacterToggle(character, 'breathe', 'Breathe', !hasBreathe));
            fieldset.appendChild(toggles);

            const gaze = document.createElement('div');
            gaze.className = 'layer-character-range-grid';
            gaze.appendChild(this.makeCharacterField(character, 'gazeX', 'Eyes X', { type: 'range', min: -1, max: 1, step: 0.05, disabled: !hasEyes }));
            gaze.appendChild(this.makeCharacterField(character, 'gazeY', 'Eyes Y', { type: 'range', min: -1, max: 1, step: 0.05, disabled: !hasEyes }));
            fieldset.appendChild(gaze);

            const speech = document.createElement('div');
            speech.className = 'layer-character-speech';
            const speechField = document.createElement('label');
            speechField.className = 'layer-field';
            speechField.append(document.createTextNode('Speak'));
            const speechInput = document.createElement('textarea');
            speechInput.rows = 2;
            speechInput.maxLength = 220;
            speechInput.placeholder = 'Type a line for lip-sync…';
            speechInput.value = character.settings.speechText || '';
            speechInput.disabled = !hasMouth;
            speechInput.dataset.characterId = character.id;
            speechInput.dataset.characterProp = 'speechText';
            speechField.appendChild(speechInput);
            const speakButton = document.createElement('button');
            speakButton.type = 'button';
            speakButton.dataset.action = 'character-speak';
            speakButton.dataset.characterId = character.id;
            speakButton.textContent = 'Play line';
            speakButton.disabled = !hasMouth;
            speech.append(speechField, speakButton);
            const mouthOpenField = this.makeCharacterField(character, 'mouthOpen', 'Mouth open', {
                type: 'range', min: 0, max: 2, step: 0.05, disabled: !hasMouth,
            });
            mouthOpenField.classList.add('layer-character-mouth-open');
            speech.appendChild(mouthOpenField);
            fieldset.appendChild(speech);

            const animationList = this.characterAnimationList();
            if (animationList.length) {
                const library = document.createElement('div');
                library.className = 'layer-character-animations';
                const head = document.createElement('div');
                head.className = 'layer-character-animations-head';
                const title = document.createElement('span');
                title.textContent = 'Animations';
                head.appendChild(title);
                if (this.projectId) {
                    const save = document.createElement('button');
                    save.type = 'button';
                    save.dataset.action = 'character-save-animation';
                    save.dataset.characterId = character.id;
                    save.textContent = 'Save current';
                    head.appendChild(save);
                }
                library.appendChild(head);
                const list = document.createElement('div');
                list.className = 'layer-character-animation-list';
                animationList.forEach((animation) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.dataset.action = 'character-play-animation';
                    button.dataset.characterId = character.id;
                    button.dataset.animationId = animation.id;
                    button.title = animation.description || '';
                    const name = document.createElement('span');
                    name.textContent = animation.name;
                    const meta = document.createElement('small');
                    const seconds = Math.round((Number(animation.duration) || this.composition.duration) / 1000);
                    meta.textContent = `${seconds}s${animation.settings && animation.settings.speechText ? ' · speech' : ' · idle'}`;
                    button.append(name, meta);
                    list.appendChild(button);
                });
                library.appendChild(list);
                fieldset.appendChild(library);
            }

            const advanced = document.createElement('details');
            advanced.className = 'layer-character-advanced';
            const summary = document.createElement('summary');
            summary.textContent = 'Fine controls';
            advanced.appendChild(summary);
            advanced.appendChild(this.makeCharacterField(character, 'blinkRate', 'Blink rate / min', { type: 'number', min: 2, max: 30, step: 1, disabled: !hasEyes }));
            advanced.appendChild(this.makeCharacterField(character, 'blinkAmount', 'Blink amount', { type: 'range', min: 0, max: 1, step: 0.05, disabled: !hasEyes }));
            advanced.appendChild(this.makeCharacterField(character, 'talkIntensity', 'Talk intensity', { type: 'range', min: 0, max: 1, step: 0.05, disabled: !hasMouth }));
            advanced.appendChild(this.makeCharacterField(character, 'talkSpeed', 'Talk speed', { type: 'range', min: 0.5, max: 2, step: 0.05, disabled: !hasMouth }));
            advanced.appendChild(this.makeCharacterField(character, 'breatheAmount', 'Breathe amount', { type: 'range', min: 0, max: 1, step: 0.05, disabled: !hasBreathe }));
            advanced.appendChild(this.makeCharacterField(character, 'headSway', 'Head sway', { type: 'range', min: 0, max: 1, step: 0.05, disabled: !hasBreathe }));
            advanced.appendChild(this.makeCharacterField(character, 'pulseAmount', 'Eye and beard pulse', { type: 'range', min: 0, max: 1, step: 0.05, disabled: !hasFace }));
            advanced.appendChild(this.makeCharacterField(character, 'speechRate', 'Speech rate', { type: 'range', min: 0.5, max: 2, step: 0.05, disabled: !hasMouth }));
            const saccadeToggle = this.makeCharacterToggle(character, 'saccade', 'Micro eye moves', !hasEyes);
            saccadeToggle.classList.add('layer-character-advanced-toggle');
            advanced.appendChild(saccadeToggle);
            const mouthPoseField = document.createElement('label');
            mouthPoseField.className = 'layer-field';
            mouthPoseField.append(document.createTextNode('Mouth shape'));
            const mouthPoseSelect = document.createElement('select');
            mouthPoseSelect.disabled = !hasMouth;
            mouthPoseSelect.dataset.characterId = character.id;
            mouthPoseSelect.dataset.characterProp = 'mouthPose';
            [['', 'Auto (speech)'], ...CHARACTER_VISEME_KEYS.map((viseme) => [viseme, viseme])].forEach(([value, label]) => {
                mouthPoseSelect.appendChild(new Option(label, value));
            });
            mouthPoseSelect.value = character.settings.mouthPose || '';
            mouthPoseField.appendChild(mouthPoseSelect);
            advanced.appendChild(mouthPoseField);
            fieldset.appendChild(advanced);

            const status = document.createElement('p');
            status.className = 'layer-character-status';
            status.dataset.characterStatus = character.id;
            status.textContent = this.characterStatusText(character);
            fieldset.appendChild(status);

            const actions = document.createElement('div');
            actions.className = 'layer-character-actions';
            const apply = document.createElement('button');
            apply.type = 'button';
            apply.dataset.action = 'character-apply';
            apply.dataset.characterId = character.id;
            apply.textContent = 'Animate character';
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.dataset.action = 'character-clear';
            clear.dataset.characterId = character.id;
            clear.textContent = 'Clear animation';
            const exportBundle = document.createElement('button');
            exportBundle.type = 'button';
            exportBundle.dataset.action = 'character-export';
            exportBundle.dataset.characterId = character.id;
            exportBundle.textContent = 'Export character';
            exportBundle.title = 'Download a rigged character bundle (.zip) that imports with the rig ready';
            actions.append(apply, clear, exportBundle);
            fieldset.appendChild(actions);

            if (!hasEyes && !hasMouth) {
                const hint = document.createElement('p');
                hint.className = 'layer-character-hint';
                hint.textContent = 'Only body/head motion is available for this character.';
                fieldset.appendChild(hint);
            }
            return fieldset;
        }

        makeCharacterToggle(character, property, label, disabled = false) {
            const field = document.createElement('label');
            field.className = 'layer-effect-toggle';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = Boolean(character.settings[property]);
            input.disabled = disabled;
            input.dataset.characterId = character.id;
            input.dataset.characterProp = property;
            field.append(input, document.createTextNode(label));
            return field;
        }

        makeCharacterField(character, property, label, {
            type = 'number',
            min = undefined,
            max = undefined,
            step = undefined,
            disabled = false,
        } = {}) {
            const field = document.createElement('label');
            field.className = 'layer-field';
            field.append(document.createTextNode(label));
            const input = document.createElement('input');
            input.type = type;
            if (min !== undefined) input.min = String(min);
            if (max !== undefined) input.max = String(max);
            if (step !== undefined) input.step = String(step);
            input.disabled = disabled;
            input.value = String(character.settings[property]);
            input.dataset.characterId = character.id;
            input.dataset.characterProp = property;
            field.appendChild(input);
            if (type === 'range') {
                const output = document.createElement('output');
                output.textContent = this.formatCharacterValue(property, character.settings[property]);
                field.appendChild(output);
            }
            return field;
        }

        formatCharacterValue(property, value) {
            if (['blinkAmount', 'talkIntensity', 'breatheAmount', 'gazeX', 'gazeY', 'headSway', 'pulseAmount', 'speechRate', 'mouthOpen'].includes(property)) {
                return Number(value).toFixed(2);
            }
            return String(value);
        }

        characterStatusText(character) {
            const animated = this.characterAnimatedLayerCount(character);
            if (character.applied && animated) {
                return `Animation applied to ${animated} layer${animated === 1 ? '' : 's'}.`;
            }
            return 'Not applied yet. Adjust a control or press Animate character.';
        }

        characterAnimatedLayerCount(character) {
            const ids = new Set();
            CHARACTER_PART_KEYS.forEach((part) => {
                (character.parts[part] || []).forEach((id) => {
                    const layer = this.getLayer(id);
                    if (layer && layer.keyframes.length) ids.add(id);
                });
            });
            return ids.size;
        }

        syncCharacterPanel(character) {
            const panel = this.el.inspector.querySelector(`[data-character-panel="${character.id}"]`);
            if (!panel) return;
            panel.querySelectorAll('[data-action="character-expression"]').forEach((button) => {
                button.setAttribute('aria-pressed', String(button.dataset.expression === character.settings.expression));
            });
            panel.querySelectorAll('[data-character-prop]').forEach((input) => {
                if (document.activeElement === input) return;
                const property = input.dataset.characterProp;
                const value = character.settings[property];
                if (input.type === 'checkbox') input.checked = Boolean(value);
                else input.value = String(value === undefined ? '' : value);
                const output = input.parentElement?.querySelector('output');
                if (output) output.textContent = this.formatCharacterValue(property, value);
            });
            const status = panel.querySelector(`[data-character-status="${character.id}"]`);
            if (status) status.textContent = this.characterStatusText(character);
        }

        getCharacter(id) {
            return (this.composition.characters || []).find((character) => character.id === id);
        }

        characterFeatureLayers(character) {
            const ids = new Set();
            ['eyes', 'pupils', 'brows', 'mouth'].forEach((part) => {
                (character.parts[part] || []).forEach((id) => ids.add(id));
            });
            return [...ids].map((id) => this.getLayer(id)).filter(Boolean);
        }

        async prepareCharacterCovers() {
            if (this._coverPromise) return this._coverPromise;
            const characters = this.composition.characters || [];
            if (!characters.length) return null;
            if (characters.every((character) => Number(character.rigVersion) >= 3)) return false;
            this._coverPromise = (async () => {
                let changed = false;
                for (const character of characters) {
                    let cover = character.coverLayerId ? this.getLayer(character.coverLayerId) : null;
                    if (!cover) {
                        cover = await this.createCharacterCover(character).catch((error) => {
                            console.warn('[layer-studio] face base generation failed:', error);
                            return null;
                        });
                        if (cover) changed = true;
                    }
                    if (cover) {
                        const visible = character.applied === true;
                        if (cover.visible !== visible) {
                            cover.visible = visible;
                            changed = true;
                        }
                    }
                }
                if (changed) {
                    this.render();
                    this.scheduleSave();
                }
                return changed;
            })().finally(() => {
                this._coverPromise = null;
            });
            return this._coverPromise;
        }

        async sampleCharacterSkin(character, referenceImage) {
            const fallback = '#f0c8a4';
            try {
                const eyes = (character.parts.eyes || [])
                    .map((id) => this.getLayer(id))
                    .filter(Boolean)
                    .sort((a, b) => a.x - b.x);
                let px = 50;
                let py = 30;
                if (eyes.length === 1) {
                    px = eyes[0].x + eyes[0].w + 3;
                    py = eyes[0].y + eyes[0].h / 2;
                } else if (eyes.length > 1) {
                    const left = eyes[0];
                    const right = eyes[eyes.length - 1];
                    px = ((left.x + left.w) + right.x) / 2;
                    py = (left.y + left.h / 2) - 4;
                } else {
                    const feature = this.characterFeatureLayers(character)[0];
                    if (feature) {
                        px = feature.x + feature.w / 2;
                        py = feature.y - 2;
                    }
                }
                const sampleWidth = Math.max(1, Math.min(512, referenceImage.naturalWidth || 512));
                const sampleHeight = Math.max(
                    1,
                    Math.round(sampleWidth * (referenceImage.naturalHeight || sampleWidth) / (referenceImage.naturalWidth || sampleWidth)),
                );
                const canvas = document.createElement('canvas');
                canvas.width = sampleWidth;
                canvas.height = sampleHeight;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                if (!context) return fallback;
                context.drawImage(referenceImage, 0, 0, sampleWidth, sampleHeight);
                const x = Math.max(2, Math.min(sampleWidth - 3, Math.round(px / 100 * sampleWidth)));
                const y = Math.max(2, Math.min(sampleHeight - 3, Math.round(py / 100 * sampleHeight)));
                const data = context.getImageData(x - 2, y - 2, 5, 5).data;
                const warm = [];
                for (let index = 0; index < data.length; index += 4) {
                    const [r, g, b, a] = [data[index], data[index + 1], data[index + 2], data[index + 3]];
                    if (a < 200) continue;
                    if (r < 175 || r < g || g < b) continue;
                    if (Math.max(r, g, b) > 252) continue;
                    warm.push([r, g, b]);
                }
                if (!warm.length) return fallback;
                warm.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
                const [r, g, b] = warm[Math.floor(warm.length / 2)];
                return `rgb(${r}, ${g}, ${b})`;
            } catch {
                return fallback;
            }
        }

        async createCharacterCover(character) {
            if (character.coverLayerId) {
                const existing = this.getLayer(character.coverLayerId);
                if (existing) return existing;
            }
            const features = this.characterFeatureLayers(character);
            if (!features.length) return null;
            const reference = this.composition.layers.find(
                (layer) => layer.id === this.composition.referenceLayerId,
            ) || this.composition.layers.find((layer) => !layer.rig);
            if (!reference?.url) return null;
            const referenceImage = await loadImage(reference.url);
            const scale = Math.min(
                1,
                2000 / Math.max(this.composition.width, this.composition.height),
            );
            const width = Math.max(1, Math.round(this.composition.width * scale));
            const height = Math.max(1, Math.round(this.composition.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) return null;
            const skin = await this.sampleCharacterSkin(character, referenceImage);
            for (const layer of features) {
                try {
                    const image = await loadImage(layer.url);
                    const temp = document.createElement('canvas');
                    temp.width = Math.max(1, image.naturalWidth);
                    temp.height = Math.max(1, image.naturalHeight);
                    const tempContext = temp.getContext('2d');
                    if (!tempContext) continue;
                    tempContext.drawImage(image, 0, 0);
                    tempContext.globalCompositeOperation = 'source-in';
                    tempContext.fillStyle = skin;
                    tempContext.fillRect(0, 0, temp.width, temp.height);
                    const featureWidth = layer.w / 100 * width;
                    const featureHeight = layer.h / 100 * height;
                    const padding = 0.04;
                    context.drawImage(
                        temp,
                        layer.x / 100 * width - featureWidth * padding / 2,
                        layer.y / 100 * height - featureHeight * padding / 2,
                        Math.max(1, featureWidth * (1 + padding)),
                        Math.max(1, featureHeight * (1 + padding)),
                    );
                } catch (error) {
                    console.warn('[layer-studio] could not include a feature in the face base:', layer.name, error);
                }
            }
            const url = canvas.toDataURL('image/png');
            const cover = makeLayer({
                id: `rig-cover-${character.id}`,
                url,
                name: `${character.name} face base`,
                role: 'character-part',
                x: 0,
                y: 0,
                w: 100,
                h: 100,
                z: 1,
                fit: 'contain',
                locked: true,
                visible: character.applied === true,
                rig: true,
                positionConfirmed: true,
            }, this.composition.layers.length);
            this.composition.layers.push(cover);
            character.coverLayerId = cover.id;
            return cover;
        }

        onCharacterInput(input, { immediate = false } = {}) {
            const character = this.getCharacter(input.dataset.characterId);
            if (!character) return;
            const property = input.dataset.characterProp;
            if (!property || !(property in CHARACTER_DEFAULTS)) return;
            let value;
            if (input.type === 'checkbox') value = input.checked;
            else if (input.type === 'range' || input.type === 'number') value = Number(input.value);
            else value = input.value;
            if (input.type === 'number' && !Number.isFinite(value)) return;
            if (property === 'speechText') {
                character.settings.speechText = String(value).slice(0, 300);
                if (this._speechTimer) {
                    window.clearTimeout(this._speechTimer);
                    this._speechTimer = null;
                }
                const commit = () => {
                    this.updateCharacterSettings(character.id, {}, { apply: true, silent: true });
                };
                if (immediate) commit();
                else {
                    this._speechTimer = window.setTimeout(() => {
                        this._speechTimer = null;
                        commit();
                    }, 420);
                }
                this.scheduleSave();
                return;
            }
            this.updateCharacterSettings(character.id, { [property]: value }, { apply: true });
            const output = input.parentElement.querySelector('output');
            if (output) output.textContent = this.formatCharacterValue(property, value);
            this.syncCharacterPanel(character);
        }

        updateCharacterSettings(characterId, patch, { apply = true, render = false, silent = false } = {}) {
            const character = this.getCharacter(characterId);
            if (!character) return false;
            const next = { ...character.settings };
            Object.entries(patch || {}).forEach(([key, value]) => {
                if (key === 'name') {
                    const name = String(value || '').trim().slice(0, 80);
                    if (name) character.name = name;
                } else if (key in CHARACTER_DEFAULTS) {
                    next[key] = value;
                }
            });
            character.settings = normalizeCharacterSettings(next);
            if (apply) this.applyCharacterAnimation(character);
            if (apply && Number(character.rigVersion) < 3
                && (!character.coverLayerId || !this.getLayer(character.coverLayerId))) {
                this.prepareCharacterCovers().then(() => {
                    if (character.applied) {
                        this.applyCharacterAnimation(character);
                        this.render();
                        this.scheduleSave();
                    }
                }).catch((error) => console.warn('[layer-studio] face base generation failed:', error));
            }
            this.renderCanvas();
            this.renderList();
            this.renderAnimationControls();
            this.applyAnimationTime(this.animation.currentTime);
            if (render) this.renderInspector();
            if (!silent) this.setStatus(`Character "${character.name}" settings updated.`);
            this.scheduleSave();
            return true;
        }

        applyCharacterAnimation(character) {
            if (this.characterUsesRigV3(character)) return this.applyCharacterAnimationV3(character);
            return this.applyCharacterAnimationV2(character);
        }

        characterUsesRigV3(character) {
            if (!character) return false;
            if (Number(character.rigVersion) >= 3) return true;
            const parts = character.parts || {};
            return CHARACTER_PART_KEYS.some((part) => (parts[part] || []).some((id) => {
                const layer = this.getLayer(id);
                return Boolean(layer && (layer.variant || layer.group || layer.part));
            }));
        }

        applyCharacterAnimationV2(character) {
            const partSets = {};
            const uniqueLayers = new Map();
            const hiddenSet = new Set(character.hidden || []);
            CHARACTER_PART_KEYS.forEach((part) => {
                partSets[part] = new Set(character.parts[part] || []);
                (character.parts[part] || []).forEach((id) => {
                    const layer = this.getLayer(id);
                    if (layer) uniqueLayers.set(id, layer);
                });
            });
            hiddenSet.forEach((id) => {
                const layer = this.getLayer(id);
                if (layer) uniqueLayers.set(id, layer);
            });
            const layers = [...uniqueLayers.values()];
            if (!layers.length) {
                character.applied = false;
                return 0;
            }
            const cover = character.coverLayerId ? this.getLayer(character.coverLayerId) : null;
            if (cover) cover.visible = true;
            const settings = character.settings;
            const duration = this.composition.duration;
            const expression = settings.expression;
            const eyeScaleBase = { neutral: 1, happy: 0.86, sad: 0.94, surprised: 1.12, angry: 0.78 }[expression] || 1;
            const pupilOffsetY = { neutral: 0, happy: -0.4, sad: 0.4, surprised: 0, angry: 0.2 }[expression] || 0;
            const mouthOffsetY = { neutral: 0, happy: -0.18, sad: 0.2, surprised: 0.12, angry: 0.15 }[expression] || 0;
            const mouthScale = { neutral: 1, happy: 1, sad: 0.95, surprised: 1.15, angry: 0.95 }[expression] || 1;
            const beardOffsetY = { neutral: 0, happy: -0.12, sad: 0.16, surprised: -0.06, angry: 0.1 }[expression] || 0;
            const browOffsetY = { neutral: 0, happy: -0.22, sad: 0.24, surprised: -0.3, angry: 0.28 }[expression] || 0;
            const hasEyes = partSets.eyes.size + partSets.pupils.size > 0;
            const hasMouth = partSets.mouth.size + partSets.beard.size > 0;
            const hasBreathe = partSets.head.size + partSets.body.size > 0;
            const hasFace = hasEyes
                || hasMouth
                || partSets.brows.size > 0
                || partSets.beard.size > 0;
            const hasMotion = (settings.blink && hasEyes)
                || (settings.talk && hasMouth)
                || (settings.breathe && hasBreathe)
                || (settings.eyeWander && hasEyes)
                || ((settings.gazeX !== 0 || settings.gazeY !== 0) && hasEyes)
                || (expression !== 'neutral' && hasFace);
            if (!hasMotion) {
                layers.forEach((layer) => { layer.keyframes = []; });
                if (cover) cover.visible = false;
                character.applied = false;
                return 0;
            }

            const times = new Set([0, duration]);
            const step = Math.max(150, Math.ceil(duration / 60 / 50) * 50);
            for (let time = 0; time <= duration; time += step) times.add(Math.round(time));
            const blinkCenters = [];
            if (settings.blink && hasEyes) {
                const interval = 60000 / clamp(settings.blinkRate, 2, 30);
                for (let time = interval * 0.75; time < duration; time += interval) {
                    const center = Math.round(time);
                    blinkCenters.push(center);
                    [center - 160, center - 80, center, center + 80, center + 160]
                        .forEach((value) => {
                            if (value >= 0 && value <= duration) times.add(value);
                        });
                }
            }
            const blinkAt = (time) => {
                let amount = 0;
                blinkCenters.forEach((center) => {
                    const distance = Math.abs(time - center);
                    if (distance < 160) amount = Math.max(amount, 1 - distance / 160);
                });
                return amount;
            };
            const sortedTimes = [...times].sort((a, b) => a - b).slice(0, MAX_KEYFRAMES_PER_LAYER);
            let animated = 0;
            layers.forEach((layer) => {
                const isHidden = hiddenSet.has(layer.id);
                const isEye = partSets.eyes.has(layer.id);
                const isPupil = partSets.pupils.has(layer.id);
                const isBrow = partSets.brows.has(layer.id);
                const isMouth = partSets.mouth.has(layer.id);
                const isBeard = partSets.beard.has(layer.id);
                const isHead = partSets.head.has(layer.id);
                const isBody = partSets.body.has(layer.id);
                const base = {
                    x: layer.x,
                    y: layer.y,
                    w: layer.w,
                    h: layer.h,
                    rotation: layer.rotation,
                    opacity: layer.opacity,
                };
                if (isHidden) {
                    const frame = {
                        x: base.x,
                        y: base.y,
                        w: base.w,
                        h: base.h,
                        rotation: base.rotation,
                        opacity: 0,
                    };
                    layer.keyframes = normalizeKeyframes([
                        { time: 0, ...frame },
                        { time: duration, ...frame },
                    ]);
                    animated += 1;
                    return;
                }
                const frames = sortedTimes.map((time) => {
                    let scaleX = 1;
                    let scaleY = 1;
                    let offsetX = 0;
                    let offsetY = 0;
                    let opacity = base.opacity;
                    const blink = blinkAt(time);
                    const seconds = time / 1000;
                    const talkWave = Math.sin(2 * Math.PI * seconds * 2.2 * settings.talkSpeed);
                    const talkAmount = settings.talk ? settings.talkIntensity : 0;
                    const wanderX = settings.eyeWander ? Math.sin(2 * Math.PI * seconds / 5) * 0.55 : 0;
                    const wanderY = settings.eyeWander ? Math.cos(2 * Math.PI * seconds / 6.5) * 0.3 : 0;
                    const gazeX = clamp(settings.gazeX + wanderX, -1, 1);
                    const gazeY = clamp(settings.gazeY + wanderY, -1, 1);
                    if (isEye) {
                        scaleY *= eyeScaleBase * (1 - blink * 0.9 * settings.blinkAmount);
                        offsetX += gazeX * 0.12;
                        offsetY += blink * 0.08;
                    }
                    if (isPupil) {
                        offsetX += gazeX * 0.9;
                        offsetY += pupilOffsetY + gazeY * 0.8;
                        opacity *= 1 - blink * 0.95;
                        scaleY *= 1 - blink * 0.4;
                    }
                    if (isBrow) {
                        offsetY += browOffsetY + blink * 0.06;
                    }
                    if (isMouth) {
                        offsetY += mouthOffsetY + talkWave * 0.16 * talkAmount;
                        scaleY *= mouthScale * (1 + talkWave * 0.12 * talkAmount);
                    }
                    if (isBeard) {
                        offsetY += beardOffsetY + talkWave * 0.05 * talkAmount;
                        scaleY *= 1 + talkWave * 0.02 * talkAmount;
                    }
                    if (isHead || isBody) {
                        const breathe = settings.breathe
                            ? 1 + Math.sin(2 * Math.PI * seconds / 4.2) * 0.012 * settings.breatheAmount
                            : 1;
                        scaleX *= breathe;
                        scaleY *= breathe;
                    }
                    const width = base.w * scaleX;
                    const height = base.h * scaleY;
                    return {
                        time,
                        x: clamp(base.x + (base.w - width) / 2 + offsetX, -100, 200),
                        y: clamp(base.y + (base.h - height) / 2 + offsetY, -100, 200),
                        w: clamp(width, 1, 300),
                        h: clamp(height, 1, 300),
                        rotation: base.rotation,
                        opacity: clamp(opacity, 0, 1),
                    };
                });
                layer.keyframes = normalizeKeyframes(frames);
                if (layer.keyframes.length) animated += 1;
            });
            character.applied = animated > 0;
            return animated;
        }

        syncRigReferenceVisibility() {
            const reference = this.getLayer(this.composition.referenceLayerId);
            if (!reference) return false;
            const characters = this.composition.characters || [];
            const allApplied = characters.length > 0 && characters.every((character) => (
                character.applied && Number(character.rigVersion) >= 3
            ));
            const target = !allApplied;
            if (reference.visible === target) return false;
            reference.visible = target;
            this.renderCanvas();
            return true;
        }

        applyCharacterAnimationV3(character) {
            const settings = character.settings;
            const duration = Math.max(1, this.composition.duration);
            const compW = Math.max(1, this.composition.width);
            const compH = Math.max(1, this.composition.height);
            const hiddenSet = new Set(character.hidden || []);
            const partSets = {};
            const partOf = new Map();
            CHARACTER_PART_KEYS.forEach((part) => {
                partSets[part] = new Set(character.parts[part] || []);
                partSets[part].forEach((id) => {
                    if (!partOf.has(id)) partOf.set(id, part);
                });
            });
            const layers = [];
            const seen = new Set();
            CHARACTER_PART_KEYS.forEach((part) => {
                partSets[part].forEach((id) => {
                    if (seen.has(id)) return;
                    const layer = this.getLayer(id);
                    if (!layer) return;
                    seen.add(id);
                    layers.push(layer);
                });
            });
            if (!layers.length) {
                character.applied = false;
                this.syncRigReferenceVisibility();
                return 0;
            }

            const layerPart = (layer) => layer.part || partOf.get(layer.id) || '';
            const layersOfPart = (part) => layers.filter((layer) => layerPart(layer) === part);
            const eyeLayers = layersOfPart('eyes');
            const pupilLayers = layersOfPart('pupils');
            const highlightLayers = layersOfPart('highlights');
            const eyelidLayers = layersOfPart('eyelids');
            const browLayers = layersOfPart('brows');
            const mouthLayers = layersOfPart('mouth');
            const layerVariant = new Map();
            layers.forEach((layer) => {
                layerVariant.set(layer.id, deriveLayerVariant(layer, layerPart(layer)));
            });
            const variantOf = (layer) => (layerVariant.get(layer.id)?.variant || '');
            const groupOf = (layer) => (layerVariant.get(layer.id)?.group || '');
            const hasEyelids = eyelidLayers.length > 0;
            const hasMouthVariants = mouthLayers.some((layer) => variantOf(layer));
            const hasBrowVariants = browLayers.some((layer) => variantOf(layer));
            const browPoses = new Set(browLayers.map((layer) => variantOf(layer)).filter(Boolean));
            const expression = CHARACTER_EXPRESSIONS.includes(settings.expression)
                ? settings.expression
                : 'neutral';
            const expressionBrow = CHARACTER_EXPRESSION_BROW[expression] || 'neutral';
            const targetBrow = browPoses.has(expressionBrow)
                ? expressionBrow
                : (browPoses.has('neutral') ? 'neutral' : ([...browPoses][0] || ''));
            const eyeScaleY = CHARACTER_EXPRESSION_EYE[expression] || 1;
            const talkIntensity = clamp(finite(settings.talkIntensity, 0.55), 0, 1);
            const mouthOpen = clamp(finite(settings.mouthOpen, 1), 0, 2);

            const findVariant = (part, variant, side = null) => {
                const list = layers.filter((layer) => layerPart(layer) === part);
                const pool = side
                    ? (list.filter((layer) => `${groupOf(layer)} ${layer.name || ''}`.toLowerCase().includes(side)) || [])
                    : list;
                const active = pool.length ? pool : list;
                return active.find((layer) => variantOf(layer) === variant)
                    || active.find((layer) => String(layer.name || '').toLowerCase().includes(variant))
                    || null;
            };

            const mouthByViseme = new Map();
            CHARACTER_VISEME_KEYS.forEach((viseme) => {
                const layer = findVariant('mouth', viseme);
                if (layer) mouthByViseme.set(viseme, layer);
            });
            const fallbackMouth = findVariant('mouth', 'rest') || mouthLayers[0] || null;
            const resolveMouth = (viseme) => mouthByViseme.get(viseme) || fallbackMouth;

            const pupilEyeMap = new Map();
            pupilLayers.forEach((pupil) => {
                let best = null;
                let bestDistance = Infinity;
                eyeLayers.forEach((eye) => {
                    const distance = Math.abs((pupil.x + pupil.w / 2) - (eye.x + eye.w / 2));
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        best = eye;
                    }
                });
                if (best) pupilEyeMap.set(pupil.id, best);
            });
            const highlightPupilMap = new Map();
            highlightLayers.forEach((highlight) => {
                let best = null;
                let bestDistance = Infinity;
                pupilLayers.forEach((pupil) => {
                    const distance = Math.abs((highlight.x + highlight.w / 2) - (pupil.x + pupil.w / 2))
                        + Math.abs((highlight.y + highlight.h / 2) - (pupil.y + pupil.h / 2));
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        best = pupil;
                    }
                });
                if (best) highlightPupilMap.set(highlight.id, best);
            });

            const random = mulberry32(hashString(character.id || 'beards') ^ 0x9e3779b9);
            const blinkEvents = [];
            if (settings.blink) {
                const rate = clamp(finite(settings.blinkRate, 12), 2, 30);
                const mean = 60000 / rate;
                let time = 450 + random() * mean * 0.35;
                while (time < duration - 120) {
                    const length = 185 + random() * 75;
                    blinkEvents.push({ start: time, duration: length });
                    if (random() < 0.15 && time + length + 320 < duration) {
                        blinkEvents.push({ start: time + length + 170, duration: length * 0.9 });
                    }
                    time += mean * (0.62 + random() * 0.75);
                }
            }
            const blinkAt = (time) => {
                let amount = 0;
                blinkEvents.forEach((event) => {
                    const local = time - event.start;
                    if (local < -30 || local > event.duration + 30) return;
                    let value = 0;
                    if (local <= 0) value = 0;
                    else if (local < 62) value = smoothstep(0, 1, local / 62);
                    else if (local < event.duration - 95) value = 1;
                    else value = 1 - smoothstep(0, 1, (local - (event.duration - 95)) / 95);
                    amount = Math.max(amount, value);
                });
                return clamp(amount * clamp(finite(settings.blinkAmount, 0.9), 0, 1), 0, 1);
            };

            const saccades = [];
            if (settings.saccade) {
                const range = settings.eyeWander ? 0.34 : 0.1;
                let time = 0;
                let previousX = clamp(settings.gazeX, -1, 1);
                let previousY = clamp(settings.gazeY, -1, 1);
                while (time < duration) {
                    const hold = 850 + random() * 1750;
                    const nextX = clamp(settings.gazeX + (random() * 2 - 1) * range, -1, 1);
                    const nextY = clamp(settings.gazeY + (random() * 2 - 1) * range * 0.6, -1, 1);
                    saccades.push({ start: time, end: time + hold, x: nextX, y: nextY, fromX: previousX, fromY: previousY });
                    previousX = nextX;
                    previousY = nextY;
                    time += hold;
                }
            }
            const gazeAt = (time) => {
                let x = clamp(finite(settings.gazeX, 0), -1, 1);
                let y = clamp(finite(settings.gazeY, 0), -1, 1);
                if (saccades.length) {
                    let segment = saccades[0];
                    saccades.forEach((item) => {
                        if (time >= item.start) segment = item;
                    });
                    const blend = smoothstep(0, 1, clamp((time - segment.start) / 95, 0, 1));
                    x = segment.fromX + (segment.x - segment.fromX) * blend;
                    y = segment.fromY + (segment.y - segment.fromY) * blend;
                    x += 0.012 * Math.sin(time / 2900);
                    y += 0.008 * Math.cos(time / 3400);
                }
                return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
            };

            const speechText = String(settings.speechText || '').trim();
            const forcedViseme = CHARACTER_VISEME_KEYS.includes(settings.mouthPose) ? settings.mouthPose : '';
            const activeTrack = forcedViseme
                ? [{ start: 0, end: duration, viseme: forcedViseme }]
                : (speechText
                    ? textToVisemes(speechText, settings.speechRate, duration, settings.speechStart)
                    : (settings.talk ? buildTalkTrack(duration, settings.talkSpeed, talkIntensity) : []));
            const defaultViseme = CHARACTER_EXPRESSION_MOUTH[expression] || 'rest';

            const visemeWeightsAt = (time) => {
                const weights = new Map();
                if (!activeTrack.length) {
                    weights.set(defaultViseme, 1);
                    return weights;
                }
                let index = -1;
                for (let cursor = 0; cursor < activeTrack.length; cursor += 1) {
                    if (time >= activeTrack[cursor].start && time < activeTrack[cursor].end) {
                        index = cursor;
                        break;
                    }
                }
                if (index < 0) {
                    let previous = null;
                    for (let cursor = 0; cursor < activeTrack.length; cursor += 1) {
                        if (activeTrack[cursor].start <= time) previous = activeTrack[cursor];
                        else break;
                    }
                    weights.set(previous ? previous.viseme : defaultViseme, 1);
                    return weights;
                }
                const segment = activeTrack[index];
                const previous = activeTrack[index - 1];
                const next = activeTrack[index + 1];
                const fade = 55;
                let activeWeight = 1;
                if (previous && previous.viseme !== segment.viseme && time - segment.start < fade) {
                    const amount = clamp((time - segment.start) / fade, 0, 1);
                    weights.set(previous.viseme, (weights.get(previous.viseme) || 0) + (1 - amount));
                    activeWeight = Math.min(activeWeight, amount);
                }
                if (next && next.viseme !== segment.viseme && segment.end - time < fade) {
                    const amount = clamp((segment.end - time) / fade, 0, 1);
                    weights.set(next.viseme, (weights.get(next.viseme) || 0) + (1 - amount));
                    activeWeight = Math.min(activeWeight, amount);
                }
                weights.set(segment.viseme, (weights.get(segment.viseme) || 0) + activeWeight);
                return weights;
            };

            const mouthWeightsAt = (time) => {
                const target = new Map();
                visemeWeightsAt(time).forEach((weight, viseme) => {
                    const layer = resolveMouth(viseme);
                    if (!layer) return;
                    target.set(layer.id, clamp((target.get(layer.id) || 0) + weight, 0, 1));
                });
                return target;
            };

            const openingAt = (time) => {
                let opening = 0;
                const weights = visemeWeightsAt(time);
                weights.forEach((weight, viseme) => {
                    const value = Object.prototype.hasOwnProperty.call(CHARACTER_VISEME_OPENING, viseme)
                        ? CHARACTER_VISEME_OPENING[viseme]
                        : 0.2;
                    opening = Math.max(opening, value * weight);
                });
                const speaking = activeTrack.length > 0;
                const energy = speaking ? (0.55 + talkIntensity * 0.45) : 0.55;
                return clamp(opening * energy, 0, 1);
            };

            const eyelidAt = (time) => {
                const blink = blinkAt(time);
                const closed = smoothstep(0.35, 0.85, blink);
                const half = blink > 0.01 ? Math.max(0, 1 - closed) * smoothstep(0.02, 0.3, blink) : 0;
                let extraHalf = 0;
                if (expression === 'happy') extraHalf = 0.25;
                else if (expression === 'angry') extraHalf = 0.2;
                else if (expression === 'sad') extraHalf = 0.12;
                return { half: clamp(half + extraHalf, 0, 1), closed, blink };
            };

            const headSway = clamp(finite(settings.headSway, 0.6), 0, 1);
            const breatheAmount = settings.breathe ? clamp(finite(settings.breatheAmount, 0.4), 0, 1) : 0;
            const pulseAmount = clamp(finite(settings.pulseAmount, 0), 0, 1);
            const headAt = (time) => {
                const angle = headSway * (1.15 * Math.sin(time / 6900 + 0.7) + 0.45 * Math.sin(time / 2900 + 1.9));
                const dx = headSway * 0.22 * Math.sin(time / 9100 + 0.3);
                const dy = breatheAmount * 0.22 * Math.sin(time / 4300);
                return { angle, dx, dy };
            };
            const secondaryTilt = (part, time) => {
                if (part === 'beard') return 0.5 * headSway * Math.sin((time - 180) / 3400);
                if (part === 'mustache') return 0.3 * headSway * Math.sin((time - 120) / 3100);
                if (part === 'head') return 0.2 * headSway * Math.sin((time - 90) / 4100);
                return 0;
            };
            const breatheAt = (time) => (settings.breathe ? Math.sin(time / 4300) * breatheAmount : 0);

            const times = new Set([0, duration]);
            const step = Math.max(60, Math.min(120, Math.ceil(duration / 260 / 20) * 20));
            for (let time = 0; time <= duration; time += step) times.add(Math.round(time));
            blinkEvents.forEach((event) => {
                [-30, 0, 30, 62, event.duration - 95, event.duration - 40, event.duration]
                    .forEach((offset) => {
                        const value = event.start + offset;
                        if (value >= 0 && value <= duration) times.add(Math.round(value));
                    });
            });
            activeTrack.forEach((segment) => {
                [segment.start - 25, segment.start, segment.start + 55, segment.end - 55, segment.end, segment.end + 25]
                    .forEach((value) => {
                        if (value >= 0 && value <= duration) times.add(Math.round(value));
                    });
            });
            saccades.forEach((segment) => {
                [segment.start, segment.start + 95].forEach((value) => {
                    if (value >= 0 && value <= duration) times.add(Math.round(value));
                });
            });
            let sortedTimes = [...times].sort((a, b) => a - b);
            if (sortedTimes.length > 380) {
                const stride = Math.ceil(sortedTimes.length / 380);
                sortedTimes = sortedTimes.filter((_, index) => index % stride === 0 || index === sortedTimes.length - 1);
            }

            const pivot = { x: 50, y: 57 };
            const poses = sortedTimes.map((time) => {
                const head = headAt(time);
                const eyelid = eyelidAt(time);
                const opening = openingAt(time);
                const weights = visemeWeightsAt(time);
                let browLift = 0.3 * Math.sin(time / 1700) + 0.18 * Math.sin(time / 730);
                browLift += opening * 0.9 + eyelid.blink * 0.5;
                return {
                    time,
                    blink: eyelid.blink,
                    eyelids: eyelid,
                    gaze: gazeAt(time),
                    opening,
                    pulse: pulseAmount * Math.sin(time / 720),
                    mouthWeights: mouthWeightsAt(time),
                    browLift,
                    head,
                    breathe: breatheAt(time),
                    viseme: weights.size === 1 ? [...weights.keys()][0] : '',
                };
            });

            const baseMap = new Map();
            layers.forEach((layer) => {
                baseMap.set(layer.id, {
                    x: layer.x,
                    y: layer.y,
                    w: layer.w,
                    h: layer.h,
                    rotation: layer.rotation,
                    opacity: layer.opacity,
                });
            });

            let animated = 0;
            layers.forEach((layer) => {
                const part = layerPart(layer);
                const variant = variantOf(layer);
                const base = baseMap.get(layer.id) || {
                    x: layer.x, y: layer.y, w: layer.w, h: layer.h, rotation: layer.rotation, opacity: layer.opacity,
                };
                const isHidden = hiddenSet.has(layer.id);
                const isHead = CHARACTER_HEAD_PARTS.has(part);
                const isEye = part === 'eyes';
                const isPupil = part === 'pupils';
                const isHighlight = part === 'highlights';
                const isEyelid = part === 'eyelids';
                const isBrow = part === 'brows';
                const isMouth = part === 'mouth';
                const isJaw = part === 'jaw';
                const isMustache = part === 'mustache';
                const isBeard = part === 'beard';
                const isBody = part === 'body';
                const isHand = part === 'hands';
                const eye = pupilEyeMap.get(layer.id) || (isHighlight
                    ? pupilEyeMap.get(highlightPupilMap.get(layer.id)?.id)
                    : null);
                let maxOpacity = 0;
                const frames = poses.map((pose) => {
                    const openAmount = clamp(pose.opening * mouthOpen, 0, 2);
                    let x = base.x;
                    let y = base.y;
                    let w = base.w;
                    let h = base.h;
                    let rotation = base.rotation;
                    let opacity = base.opacity;

                    if (isHead) {
                        const tilt = pose.head.angle + secondaryTilt(part, pose.time);
                        const scale = 1 + (part === 'face' ? 0.004 : 0.002) * pose.breathe;
                        const centerX = (base.x + base.w / 2) / 100 * compW;
                        const centerY = (base.y + base.h / 2) / 100 * compH;
                        const pivotX = pivot.x / 100 * compW;
                        const pivotY = pivot.y / 100 * compH;
                        const angle = tilt * Math.PI / 180;
                        const rotatedX = pivotX + (centerX - pivotX) * Math.cos(angle) - (centerY - pivotY) * Math.sin(angle);
                        const rotatedY = pivotY + (centerX - pivotX) * Math.sin(angle) + (centerY - pivotY) * Math.cos(angle);
                        const nextWidth = base.w * scale;
                        const nextHeight = base.h * scale;
                        x = rotatedX / compW * 100 + pose.head.dx - nextWidth / 2;
                        y = rotatedY / compH * 100 + pose.head.dy - nextHeight / 2;
                        w = nextWidth;
                        h = nextHeight;
                        rotation += tilt;
                    } else if (isBody) {
                        const scale = 1 + 0.014 * pose.breathe;
                        const nextWidth = base.w * scale;
                        const nextHeight = base.h * scale;
                        x = base.x + base.w / 2 - nextWidth / 2;
                        y = base.y + base.h - nextHeight;
                        w = nextWidth;
                        h = nextHeight;
                        rotation += pose.head.angle * -0.22;
                    } else if (isHand) {
                        x += 0.1 * Math.sin(pose.time / 3900);
                        y += 0.08 * Math.sin(pose.time / 4700) + pose.breathe * 0.1;
                    }

                    if (isEye) {
                        const pulseScale = 1 + pose.pulse * 0.026;
                        const nextWidth = base.w * pulseScale;
                        let nextHeight = base.h * eyeScaleY * pulseScale;
                        if (!hasEyelids) {
                            nextHeight *= 1 - pose.blink * 0.9;
                            y += pose.blink * 0.08;
                        }
                        x += (base.w - nextWidth) / 2;
                        y += (base.h - nextHeight) / 2;
                        w = nextWidth;
                        h = nextHeight;
                        x += pose.gaze.x * base.w * 0.03;
                        y += pose.gaze.y * base.h * 0.02;
                    }

                    if (isPupil) {
                        const eyeWidth = eye ? eye.w : base.w * 4;
                        const eyeHeight = eye ? eye.h : base.h * 4;
                        const limitX = Math.max(1, (eyeWidth - base.w) * 0.35);
                        const limitY = Math.max(1, (eyeHeight - base.h) * 0.35);
                        const pulseScale = 1 + pose.pulse * 0.026;
                        const nextWidth = base.w * pulseScale;
                        const nextHeight = base.h * pulseScale;
                        x += (base.w - nextWidth) / 2;
                        y += (base.h - nextHeight) / 2;
                        x += clamp(pose.gaze.x * eyeWidth * 0.18, -limitX, limitX);
                        y += clamp(pose.gaze.y * eyeHeight * 0.16, -limitY, limitY);
                        w = nextWidth;
                        h = nextHeight;
                        if (!hasEyelids) opacity *= 1 - pose.blink * 0.95;
                    }

                    if (isHighlight) {
                        const eyeWidth = eye ? eye.w : base.w * 4;
                        const eyeHeight = eye ? eye.h : base.h * 4;
                        const pulseScale = 1 + pose.pulse * 0.026;
                        const nextWidth = base.w * pulseScale;
                        const nextHeight = base.h * pulseScale;
                        x += (base.w - nextWidth) / 2;
                        y += (base.h - nextHeight) / 2;
                        x += pose.gaze.x * eyeWidth * 0.15;
                        y += pose.gaze.y * eyeHeight * 0.13;
                        w = nextWidth;
                        h = nextHeight;
                        opacity *= 1 - pose.blink * 0.3;
                    }

                    if (isEyelid) {
                        const weight = variant === 'closed' ? pose.eyelids.closed : pose.eyelids.half;
                        opacity = weight;
                        const pulseScale = 1 + pose.pulse * 0.026;
                        const nextWidth = base.w * pulseScale;
                        const nextHeight = base.h * eyeScaleY * pulseScale;
                        x += (base.w - nextWidth) / 2;
                        y += (base.h - nextHeight) / 2;
                        w = nextWidth;
                        h = nextHeight;
                    }

                    if (isBrow) {
                        opacity = variant === targetBrow ? 1 : 0;
                        y += pose.browLift * 0.35 + pose.blink * 0.05;
                        if (!hasBrowVariants) {
                            const offset = { neutral: 0, raised: -0.6, sad: 0.5, furrowed: 0.35, surprised: -0.9 }[expression] || 0;
                            y += offset;
                        }
                    }

                    if (isMouth) {
                        if (hasMouthVariants) {
                            opacity = pose.mouthWeights.get(layer.id) || 0;
                        } else if (activeTrack.length) {
                            opacity = 1;
                        } else {
                            opacity = 0.7;
                        }
                        const scale = 1 + openAmount * 0.25 * (0.65 + talkIntensity * 0.35);
                        const nextWidth = base.w * scale;
                        const nextHeight = base.h * scale;
                        x += (base.w - nextWidth) / 2;
                        y += (base.h - nextHeight) / 2 + openAmount * 0.55;
                        w = nextWidth;
                        h = nextHeight;
                    }

                    if (isJaw) {
                        const nextHeight = base.h * (1 + openAmount * 0.18);
                        y += openAmount * 1.2 + (base.h - nextHeight) / 2;
                        h = nextHeight;
                        opacity = clamp(openAmount * 1.4, 0, 1);
                    }

                    if (isMustache) {
                        y += openAmount * 0.35;
                        const nextHeight = base.h * (1 + openAmount * 0.02);
                        y += (base.h - nextHeight) / 2;
                        h = nextHeight;
                    }

                    if (isBeard) {
                        const pulseScale = 1 + pose.pulse * 0.04;
                        const nextWidth = base.w * pulseScale;
                        const nextHeight = base.h * (pulseScale + openAmount * 0.012);
                        x += (base.w - nextWidth) / 2;
                        y += openAmount * 0.2 + (base.h - nextHeight) / 2;
                        w = nextWidth;
                        h = nextHeight;
                    }

                    if (isHidden) opacity = 0;
                    maxOpacity = Math.max(maxOpacity, opacity);
                    return {
                        time: pose.time,
                        x: clamp(x, -100, 200),
                        y: clamp(y, -100, 200),
                        w: clamp(w, 1, 300),
                        h: clamp(h, 1, 300),
                        rotation: clamp(rotation, -3600, 3600),
                        opacity: clamp(opacity, 0, 1),
                    };
                });
                if (isHidden || maxOpacity <= 0.001) {
                    layer.keyframes = normalizeKeyframes([
                        {
                            time: 0, x: base.x, y: base.y, w: base.w, h: base.h, rotation: base.rotation, opacity: 0,
                        },
                        {
                            time: duration, x: base.x, y: base.y, w: base.w, h: base.h, rotation: base.rotation, opacity: 0,
                        },
                    ]);
                } else {
                    layer.keyframes = normalizeKeyframes(frames);
                    animated += 1;
                }
            });

            character.applied = animated > 0;
            this.syncRigReferenceVisibility();
            return animated;
        }

        clearCharacterAnimation(character) {
            let cleared = 0;
            const partIds = new Set();
            CHARACTER_PART_KEYS.forEach((part) => {
                (character.parts[part] || []).forEach((id) => partIds.add(id));
            });
            (character.hidden || []).forEach((id) => partIds.add(id));
            partIds.forEach((id) => {
                const layer = this.getLayer(id);
                if (!layer || !layer.keyframes.length) return;
                layer.keyframes = [];
                cleared += 1;
            });
            const cover = character.coverLayerId ? this.getLayer(character.coverLayerId) : null;
            if (cover) cover.visible = false;
            character.applied = false;
            this.syncRigReferenceVisibility();
            this.renderCanvas();
            this.renderList();
            this.renderAnimationControls();
            this.applyAnimationTime(this.animation.currentTime);
            this.setStatus(
                cleared
                    ? `Cleared the animation for ${character.name}.`
                    : `${character.name} has no applied animation.`,
            );
            this.scheduleSave();
            return cleared;
        }

        characterPresetPatch(preset, params = {}) {
            switch (String(preset || '').toLowerCase()) {
                case 'neutral':
                    return { expression: 'neutral', talk: false, gazeX: 0, gazeY: 0 };
                case 'happy':
                    return { expression: 'happy' };
                case 'sad':
                    return { expression: 'sad' };
                case 'surprised':
                    return { expression: 'surprised' };
                case 'angry':
                    return { expression: 'angry' };
                case 'blink':
                    return { blink: true, blinkRate: finite(params.rate, 12) };
                case 'talk':
                    if (typeof params.text === 'string' && params.text.trim()) {
                        return {
                            talk: false,
                            speechText: params.text.slice(0, 300),
                            speechRate: finite(params.rate, 1),
                            talkIntensity: finite(params.intensity, 0.55),
                        };
                    }
                    return {
                        talk: true,
                        speechText: '',
                        talkIntensity: finite(params.intensity, 0.55),
                        talkSpeed: finite(params.speed, 1),
                    };
                case 'speak':
                    return {
                        talk: false,
                        speechText: String(params.text || '').slice(0, 300),
                        speechRate: finite(params.rate, 1),
                        speechStart: clamp(finite(params.start, 0), 0, MAX_ANIMATION_DURATION),
                    };
                case 'gaze':
                    return {
                        gazeX: finite(params.x, 0),
                        gazeY: finite(params.y, 0),
                        eyeWander: false,
                        saccade: false,
                    };
                case 'pulse':
                    return { pulseAmount: clamp(finite(params.amount, 0.35), 0, 1) };
                case 'idle':
                    return {
                        expression: 'neutral',
                        blink: true,
                        talk: false,
                        speechText: '',
                        gazeX: 0,
                        gazeY: 0,
                        headSway: 0.6,
                        saccade: true,
                        eyeWander: false,
                        breathe: true,
                    };
                case 'none':
                    return {
                        expression: 'neutral',
                        blink: false,
                        talk: false,
                        gazeX: 0,
                        gazeY: 0,
                        eyeWander: false,
                        breathe: false,
                    };
                default:
                    return null;
            }
        }

        characterAnimationList() {
            return (Array.isArray(this.characterAnimations) && this.characterAnimations.length)
                ? this.characterAnimations
                : CHARACTER_ANIMATION_PRESETS;
        }

        async loadCharacterAnimations() {
            this.characterAnimations = CHARACTER_ANIMATION_PRESETS;
            if (!this.projectId) return this.characterAnimations;
            try {
                const data = await this.requestBackend(`api/imports/${encodeURIComponent(this.projectId)}/animations`);
                if (Array.isArray(data?.animations) && data.animations.length) {
                    this.characterAnimations = data.animations;
                }
            } catch (error) {
                console.warn('[layer-studio] could not load the animation library:', error);
            }
            if (this.el.inspector?.querySelector('[data-character-panel]')) this.renderInspector();
            return this.characterAnimations;
        }

        playCharacterAnimation(character, animation) {
            if (!character || !animation) return false;
            this.updateCharacterSettings(character.id, { ...animation.settings }, { apply: true, silent: true });
            this.stopPlayback();
            this.animation.currentTime = 0;
            this.applyAnimationTime(0);
            this.togglePlay();
            this.syncCharacterPanel(character);
            this.setStatus(`Playing “${animation.name}” — ${character.name}.`);
            return true;
        }

        async saveCharacterAnimation(character) {
            if (!character) return false;
            if (!this.projectId) {
                this.setStatus('Open a saved import project to keep an animation library.', true);
                return false;
            }
            const fallbackName = `${character.name} ${character.settings.speechText ? 'talk' : character.settings.expression}`;
            const typed = window.prompt('Name this animation', fallbackName);
            const name = String(typed || '').trim().slice(0, 80);
            if (!name) return false;
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'animation';
            const entry = {
                id: `${slug}-${Date.now().toString(36)}`,
                name,
                description: `${Math.round(this.composition.duration / 1000)} s · ${character.settings.expression}${character.settings.speechText ? ' · speech' : ' · idle'}`,
                duration: this.composition.duration,
                settings: { ...character.settings },
            };
            const next = [entry, ...this.characterAnimationList().filter((item) => item.id !== entry.id)].slice(0, 40);
            try {
                const data = await this.requestBackend(`api/imports/${encodeURIComponent(this.projectId)}/animations`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ animations: next }),
                });
                this.characterAnimations = Array.isArray(data?.animations) ? data.animations : next;
                this.renderInspector();
                this.setStatus(`Saved animation “${entry.name}”.`);
                return true;
            } catch (error) {
                this.setStatus(error.message || 'Could not save the animation.', true);
                return false;
            }
        }

        onClick(event) {
            const action = event.target.closest('[data-action]');
            if (!action || !this.root.contains(action)) return;
            switch (action.dataset.action) {
                case 'import-files':
                    this.el.files.click();
                    break;
                case 'import-folder':
                    this.el.folder.click();
                    break;
                case 'open-project':
                    this.el.project.click();
                    break;
                case 'import-character':
                    this.el.characterInput?.click();
                    break;
                case 'import-archive':
                    this.openArchiveDialog();
                    break;
                case 'open-saved':
                    this.openArchiveDialog({ focusSaved: true });
                    break;
                case 'close-archive':
                    this.closeArchiveDialog();
                    break;
                case 'submit-archive':
                    this.submitArchive();
                    break;
                case 'refresh-saved':
                    this.loadSavedProjects();
                    break;
                case 'open-saved-project':
                    this.openSavedProject(action.dataset.id);
                    break;
                case 'save-project':
                    this.saveProject();
                    break;
                case 'apply-canvas-size': {
                    const width = Number(this.el.canvasWidth.value);
                    const height = Number(this.el.canvasHeight.value);
                    if (!Number.isInteger(width) || !Number.isInteger(height)
                        || width < 1 || width > 10000 || height < 1 || height > 10000) {
                        this.setStatus('Enter whole-number canvas dimensions between 1 and 10000 pixels.', true);
                        return;
                    }
                    this.applyCanvasDimensions(width, height);
                    break;
                }
                case 'scale-artwork': {
                    const percent = Number(this.el.artworkScale.value);
                    if (!Number.isFinite(percent) || percent < 10 || percent > 500) {
                        this.setStatus('Enter an artwork scale between 10% and 500%.', true);
                        return;
                    }
                    this.scaleArtwork(percent);
                    break;
                }
                case 'move-artwork': {
                    const offsetX = Number(this.el.artworkOffsetX?.value);
                    const offsetY = Number(this.el.artworkOffsetY?.value);
                    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)
                        || Math.abs(offsetX) > 10000 || Math.abs(offsetY) > 10000) {
                        this.setStatus('Enter character offsets between -10000 and 10000 pixels.', true);
                        return;
                    }
                    this.moveArtwork(offsetX, offsetY);
                    if (offsetX !== 0 || offsetY !== 0) {
                        this.el.artworkOffsetX.value = '0';
                        this.el.artworkOffsetY.value = '0';
                    }
                    break;
                }
                case 'propose-animations':
                    this.generateIdeas();
                    break;
                case 'open-director':
                    this.openDirectorDialog();
                    break;
                case 'close-director':
                    this.closeDirectorDialog();
                    break;
                case 'generate-ideas':
                    this.generateIdeas({ fromDialog: true });
                    break;
                case 'save-context':
                    this.saveDirectorContext();
                    break;
                case 'apply-proposal':
                    this.applyProposal(action.dataset.id);
                    break;
                case 'reset-animations':
                    this.resetAnimations();
                    break;
                case 'character-expression': {
                    const character = this.getCharacter(action.dataset.characterId);
                    if (!character) break;
                    this.updateCharacterSettings(
                        character.id,
                        { expression: action.dataset.expression },
                        { apply: true },
                    );
                    this.syncCharacterPanel(character);
                    this.setStatus(`${character.name} expression: ${action.dataset.expression}.`);
                    break;
                }
                case 'character-export': {
                    this.exportCharacter(action.dataset.characterId);
                    break;
                }
                case 'character-apply': {
                    const character = this.getCharacter(action.dataset.characterId);
                    if (!character) break;
                    this.updateCharacterSettings(character.id, {}, { apply: true });
                    this.renderInspector();
                    this.setStatus(`${character.name} animation applied.`);
                    break;
                }
                case 'character-clear': {
                    const character = this.getCharacter(action.dataset.characterId);
                    if (!character) break;
                    this.clearCharacterAnimation(character);
                    this.renderInspector();
                    break;
                }
                case 'character-play-animation': {
                    const character = this.getCharacter(action.dataset.characterId);
                    if (!character) break;
                    const animation = this.characterAnimationList()
                        .find((item) => item.id === action.dataset.animationId);
                    if (!animation) break;
                    this.playCharacterAnimation(character, animation);
                    break;
                }
                case 'character-save-animation': {
                    const character = this.getCharacter(action.dataset.characterId);
                    if (!character) break;
                    this.saveCharacterAnimation(character);
                    break;
                }
                case 'character-speak': {
                    const character = this.getCharacter(action.dataset.characterId);
                    if (!character) break;
                    if (!String(character.settings.speechText || '').trim()) {
                        this.setStatus('Type a line first, then press Play line.', true);
                        break;
                    }
                    this.updateCharacterSettings(character.id, {}, { apply: true });
                    this.stopPlayback();
                    this.animation.currentTime = 0;
                    this.applyAnimationTime(0);
                    this.togglePlay();
                    this.setStatus(`${character.name} speaks: “${character.settings.speechText}”`);
                    break;
                }
                case 'export-json':
                    this.exportJson();
                    break;
                case 'export-agent-spec':
                    this.exportAgentSpec();
                    break;
                case 'export-svg':
                    this.exportSvg();
                    break;
                case 'export-image':
                    this.exportImage().catch((error) => {
                        console.error('[layer-studio] image export failed:', error);
                        this.setExportProgress(`Export failed: ${error.message || 'image export error'}`);
                        this.setStatus(error.message || 'Could not export the composition image.', true);
                    });
                    break;
                case 'toggle-play':
                    this.togglePlay();
                    break;
                case 'set-keyframe':
                    this.setKeyframe();
                    break;
                case 'delete-keyframe':
                    this.deleteKeyframe();
                    break;
                case 'export-webm':
                    this.exportVideo().catch((error) => {
                        console.error('[layer-studio] video export failed:', error);
                        this.setExportProgress(`Export failed: ${error.message || 'video export error'}`);
                        this.setStatus(error.message || 'Could not export the animation video.', true);
                    });
                    break;
                case 'export-gif':
                    this.exportGif().catch((error) => {
                        console.error('[layer-studio] GIF export failed:', error);
                        this.setExportProgress(`Export failed: ${error.message || 'GIF export error'}`);
                        this.setStatus(error.message || 'Could not export the animation GIF.', true);
                    });
                    break;
                case 'align-reference':
                    this.alignToReference().catch((error) => {
                        console.error('[layer-studio] reference alignment failed:', error);
                        this.setStatus(error.message || 'Could not align layers to the reference image.', true);
                    });
                    break;
                case 'confirm-layer': {
                    const layer = this.getLayer(this.selectedLayerId);
                    if (!layer) break;
                    layer.positionConfirmed = !layer.positionConfirmed;
                    this.render();
                    const confirmed = this.composition.layers.filter((item) => item.positionConfirmed).length;
                    this.setStatus(
                        `${layer.name} position ${layer.positionConfirmed ? 'confirmed' : 'reopened for review'} (${confirmed}/${this.composition.layers.length} confirmed).`,
                        false,
                        confirmed < this.composition.layers.length,
                    );
                    this.scheduleSave();
                    break;
                }
                case 'confirm-all': {
                    this.composition.layers.forEach((layer) => { layer.positionConfirmed = true; });
                    this.render();
                    this.setStatus(`All ${this.composition.layers.length} layer positions confirmed.`);
                    this.scheduleSave();
                    break;
                }
                case 'toggle-panel':
                    this.togglePanel(action.dataset.side);
                    break;
                case 'toggle-section': {
                    const content = this.root.querySelector(`[data-section-content="${action.dataset.section}"]`);
                    if (!content) break;
                    content.hidden = !content.hidden;
                    action.setAttribute('aria-expanded', String(!content.hidden));
                    break;
                }
                case 'toggle-all-visibility': {
                    const managedLayers = this.composition.layers.filter((layer) => layer.rig !== true);
                    const show = managedLayers.some((layer) => !layer.visible);
                    managedLayers.forEach((layer) => { layer.visible = show; });
                    this.render();
                    this.setStatus(show ? 'All layers shown.' : 'All layers hidden.');
                    this.scheduleSave();
                    break;
                }
                case 'clear':
                    if (this.composition.layers.length && window.confirm('Remove all layers from this composition?')) {
                        this.stopPlayback();
                        if (this._saveTimer) window.clearTimeout(this._saveTimer);
                        this._saveTimer = null;
                        this.composition.layers = [];
                        this.composition.referenceLayerId = null;
                        this.selectedLayerId = null;
                        this.projectId = null;
                        this.projectMeta = null;
                        this.proposals = [];
                        this.proposalMeta = null;
                        this.activeProposalId = null;
                        this._proposalError = null;
                        this.render();
                        this.renderProposals();
                        this.updateProposalContext();
                        this.setStatus('All layers removed. The saved backend project was left unchanged.');
                    }
                    break;
                case 'select':
                    this.selectedLayerId = action.dataset.id;
                    this.render();
                    break;
                case 'visibility': {
                    const layer = this.getLayer(action.dataset.id);
                    if (layer) {
                        layer.visible = !layer.visible;
                        this.render();
                        this.scheduleSave();
                    }
                    break;
                }
                case 'remove':
                    this.removeSelected();
                    break;
            }
        }

        onChange(event) {
            if (event.target.dataset?.characterId && event.target.dataset?.characterProp) {
                this.onCharacterInput(event.target, { immediate: true });
                return;
            }
            if (event.target === this.el.projectSelect) {
                this.selectProject(event.target.value);
                return;
            }
            if (event.target === this.el.compositionSelect) {
                this.openSelectedComposition(event.target.value);
                return;
            }
            if (event.target === this.el.archiveZip || event.target === this.el.archiveRef) {
                this.describeArchiveSelection();
                return;
            }
            if (event.target === this.el.visionModel || event.target === this.el.textModel) {
                this.saveDirectorContext({ silent: true });
                return;
            }
            if (event.target === this.el.size) {
                if (event.target.value === 'custom') {
                    if (!this.el.canvasCustom || !this.el.canvasWidth || !this.el.canvasHeight) return;
                    this.el.canvasCustom.hidden = false;
                    this.el.canvasWidth.value = String(this.composition.width);
                    this.el.canvasHeight.value = String(this.composition.height);
                    this.el.canvasWidth.focus();
                    return;
                }
                const dimensions = event.target.value.split('x').map(Number);
                if (dimensions.length === 2 && dimensions.every((dimension) => Number.isInteger(dimension))) {
                    this.applyCanvasDimensions(dimensions[0], dimensions[1]);
                }
                return;
            }
            if (event.target === this.el.duration) {
                const duration = Number(event.target.value);
                if (!Number.isFinite(duration)) {
                    event.target.value = String(this.composition.duration);
                    return;
                }
                this.composition.duration = Math.round(clamp(duration, 500, MAX_ANIMATION_DURATION));
                this.animation.currentTime = Math.min(this.animation.currentTime, this.composition.duration);
                this.applyAnimationTime(this.animation.currentTime);
                this.scheduleSave();
                return;
            }
            if (event.target === this.el.playhead) {
                this.applyAnimationTime(Number(event.target.value));
                return;
            }
            if (event.target === this.el.characterInput) {
                const bundle = event.target.files?.[0];
                event.target.value = '';
                this.importCharacterBundle(bundle);
                return;
            }
            if (event.target === this.el.files || event.target === this.el.folder) {
                this.importFiles(Array.from(event.target.files || []));
                event.target.value = '';
                return;
            }
            if (event.target === this.el.project) {
                this.importProject(event.target.files?.[0]);
                event.target.value = '';
                return;
            }
            this.applyInspectorValue(event.target);
        }

        onInput(event) {
            if (event.target.dataset.characterId && event.target.dataset.characterProp) {
                this.onCharacterInput(event.target);
                return;
            }
            if (event.target === this.el.projectContext) {
                if (!this.projectId) return;
                this.projectMeta = {
                    ...(this.projectMeta || {}),
                    context: event.target.value.slice(0, 8000),
                };
                this.updateProposalContext();
                if (this._contextTimer) window.clearTimeout(this._contextTimer);
                this._contextTimer = window.setTimeout(() => {
                    this._contextTimer = null;
                    this.saveDirectorContext({ silent: true });
                }, 800);
                return;
            }
            if (event.target === this.el.name) {
                this.composition.name = event.target.value.slice(0, 120) || 'Untitled Composition';
                this.scheduleSave();
                return;
            }
            if (event.target === this.el.playhead) {
                if (!this.animation.isPlaying) this.applyAnimationTime(Number(event.target.value));
                return;
            }
            if (event.target === this.el.duration) {
                const duration = Number(event.target.value);
                if (!Number.isFinite(duration) || duration <= 0) return;
                if (duration < 500 || duration > MAX_ANIMATION_DURATION) return;
                this.composition.duration = Math.round(duration);
                this.animation.currentTime = Math.min(this.animation.currentTime, this.composition.duration);
                this.el.playhead.max = String(this.composition.duration);
                if (this.animation.currentTime < Number(this.el.playhead.value)) {
                    this.el.playhead.value = String(this.animation.currentTime);
                    this.el.playheadTime.value = `${Math.round(this.animation.currentTime)} ms`;
                    this.applyAnimationTime(this.animation.currentTime);
                }
                this.scheduleSave();
                return;
            }
            this.applyInspectorValue(event.target);
        }

        applyInspectorValue(input) {
            const property = input.dataset.prop;
            if (!property) return;
            const layer = this.getLayer(this.selectedLayerId);
            if (!layer) return;
            if (this.animation.isPlaying) this.stopPlayback();
            let positionChanged = false;
            if (property === 'name') {
                layer.name = input.value.slice(0, 160) || 'Layer';
            } else if (property === 'fit') {
                const fit = input.value === 'cover' ? 'cover' : 'contain';
                positionChanged = layer.fit !== fit;
                layer.fit = fit;
            } else if (property === 'locked') {
                layer.locked = input.checked;
            } else if (property === 'role') {
                if (/^(background|midground|ground|foreground|character|character-part|prop|effect)$/.test(input.value)) {
                    layer.role = input.value;
                }
            } else if (property === 'spriteFps') {
                const value = Number(input.value);
                if (Number.isFinite(value)) layer.spriteFps = clamp(value, 1, 30);
            } else if (property === 'spriteMode') {
                if (['loop', 'pingpong', 'once'].includes(input.value)) layer.spriteMode = input.value;
            } else if (['recolorEnabled', 'outlineEnabled'].includes(property)) {
                layer[property] = input.checked;
            } else if (['recolorColor', 'outlineColor'].includes(property)) {
                if (!HEX_COLOR.test(input.value)) return;
                layer[property] = input.value.toLowerCase();
            } else {
                const value = Number(input.value);
                if (!Number.isFinite(value)) return;
                const ranges = {
                    x: [-100, 200], y: [-100, 200], w: [1, 300], h: [1, 300],
                    rotation: [-3600, 3600], opacity: [0, 100], outlineWidth: [1, 16], z: [-1000, 1000],
                };
                if (!ranges[property]) return;
                let next = clamp(value, ...ranges[property]);
                if (property === 'opacity') next /= 100;
                const isAnimatedEdit = ANIMATED_PROPERTIES.includes(property) && layer.keyframes.length > 0;
                const currentState = isAnimatedEdit
                    ? this.getLayerStateAtTime(layer, this.animation.currentTime)
                    : layer;
                positionChanged = !isAnimatedEdit
                    && ['x', 'y', 'w', 'h', 'rotation'].includes(property)
                    && layer[property] !== next;
                if (isAnimatedEdit) {
                    this.upsertKeyframe(layer, this.animation.currentTime, { ...currentState, [property]: next });
                } else {
                    layer[property] = next;
                }
            }
            if (positionChanged) {
                layer.positionConfirmed = false;
                this.setStatus(`${layer.name} was adjusted. Confirm its position after review.`, false, true);
            }
            this.renderCanvas();
            this.renderList();
            this.applyAnimationTime(this.animation.currentTime);
            if (['name','fit','locked','role','spriteFps','spriteMode'].includes(property)) this.renderInspector();
            this.scheduleSave();
        }

        applyPreset(presetName, params = {}) {
            const layer = this.getLayer(this.selectedLayerId);
            if (!layer) {
                this.setStatus('Select a layer before applying a preset.', true);
                return;
            }
            const dur = this.composition.duration;
            const base = this.getLayerStateAtTime(layer, 0);
            const kf = (time, over = {}) => ({
                time: Math.round(clamp(time, 0, dur)),
                x: clamp(over.x ?? base.x, -100, 200),
                y: clamp(over.y ?? base.y, -100, 200),
                w: clamp(over.w ?? base.w, 1, 300),
                h: clamp(over.h ?? base.h, 1, 300),
                rotation: clamp(over.rotation ?? base.rotation, -3600, 3600),
                opacity: clamp(over.opacity ?? base.opacity, 0, 1),
            });
            const amp  = finite(params.amplitude, 2);
            const tilt = finite(params.tilt, 3);

            const e = (easing) => (frame) => { if (easing) frame.easing = easing; return frame; };
            const easingParam = EASING_NAMES.includes(params.easing) ? params.easing : null;
            const presets = {
                breathe: () => [
                    kf(0),
                    e(easingParam || 'easeInOutSine')(kf(dur * 0.5, { w: base.w * 1.02, h: base.h * 1.02 })),
                    e(easingParam || 'easeInOutSine')(kf(dur)),
                ],
                idle: () => [
                    kf(0),
                    e(easingParam || 'easeInOutSine')(kf(dur * 0.33, { y: base.y - 0.5, rotation: base.rotation + 0.4 })),
                    e(easingParam || 'easeInOutSine')(kf(dur * 0.66, { y: base.y + 0.5, rotation: base.rotation - 0.4 })),
                    e(easingParam || 'easeInOutSine')(kf(dur)),
                ],
                sway: () => Array.from({ length: 9 }, (_, i) => {
                    const t = (i / 8) * dur;
                    const phase = (i / 8) * Math.PI * 2;
                    const frame = kf(t, {
                        x: base.x + Math.sin(phase) * amp,
                        rotation: base.rotation + Math.sin(phase) * tilt,
                    });
                    if (easingParam) frame.easing = easingParam;
                    return frame;
                }),
                walk: () => {
                    const startX = finite(params.startX, base.x);
                    const endX   = finite(params.endX, 100 - base.w);
                    const we = easingParam || 'easeInOutQuad';
                    return [
                        kf(0,          { x: startX }),
                        e(we)(kf(dur * 0.25, { x: startX + (endX - startX) * 0.25, rotation: base.rotation - 1.5 })),
                        e(we)(kf(dur * 0.5,  { x: startX + (endX - startX) * 0.5 })),
                        e(we)(kf(dur * 0.75, { x: startX + (endX - startX) * 0.75, rotation: base.rotation + 1.5 })),
                        e(we)(kf(dur,        { x: endX })),
                    ];
                },
                float: () => {
                    const d = finite(params.distance, 2);
                    return [
                        kf(0),
                        e(easingParam || 'easeInOutSine')(kf(dur * 0.25, { y: base.y - d })),
                        e(easingParam || 'easeInOutSine')(kf(dur * 0.5,  { y: base.y })),
                        e(easingParam || 'easeInOutSine')(kf(dur * 0.75, { y: base.y + d })),
                        e(easingParam || 'easeInOutSine')(kf(dur,        { y: base.y })),
                    ];
                },
                flicker: () => Array.from({ length: 12 }, (_, i) =>
                    kf((i / 11) * dur, { opacity: 0.55 + Math.random() * 0.45 })),
                drift: () => [
                    kf(0,   { x: base.x }),
                    e(easingParam || 'easeInOut')(kf(dur, { x: base.x + finite(params.distance, 15) })),
                ],
                pulse: () => {
                    const s = finite(params.scale, 1.06);
                    return [
                        kf(0),
                        e(easingParam || 'easeInOutSine')(kf(dur * 0.5, { w: base.w * s, h: base.h * s })),
                        e(easingParam || 'easeInOutSine')(kf(dur)),
                    ];
                },
                fadeIn: () => [
                    kf(0, { opacity: 0 }),
                    e(easingParam || 'easeOutCubic')(kf(Math.min(dur, 800), { opacity: base.opacity })),
                    kf(dur, { opacity: base.opacity }),
                ],
                parallax: () => [
                    kf(0,         { x: base.x - finite(params.distance, 4) }),
                    e(easingParam || 'easeInOutSine')(kf(dur * 0.5, { x: base.x })),
                    e(easingParam || 'easeInOutSine')(kf(dur,       { x: base.x + finite(params.distance, 4) })),
                ],
                fadeOut: () => [
                    kf(0, { opacity: base.opacity }),
                    e(easingParam || 'easeInQuad')(kf(Math.max(dur - 800, dur * 0.7), { opacity: base.opacity })),
                    e(easingParam || 'easeInQuad')(kf(dur, { opacity: 0 })),
                ],
                zoom: () => {
                    const from = finite(params.from, 0.5);
                    const to   = finite(params.to, 1.2);
                    return [
                        kf(0,   { w: base.w * from, h: base.h * from }),
                        e(easingParam || 'easeInOutQuad')(kf(dur, { w: base.w * to, h: base.h * to })),
                    ];
                },
                spin: () => {
                    const turns = finite(params.turns, 1);
                    const steps = Math.max(2, Math.min(12, Math.ceil(Math.abs(turns) * 4)));
                    return Array.from({ length: steps + 1 }, (_, i) => {
                        const frame = kf((i / steps) * dur, {
                            rotation: base.rotation + (i / steps) * turns * 360,
                        });
                        if (i > 0) frame.easing = easingParam || 'linear';
                        return frame;
                    });
                },
                shake: () => {
                    const a = finite(params.amplitude, 1.5);
                    const decay = finite(params.decay, 0.85);
                    const steps = 8;
                    return Array.from({ length: steps + 1 }, (_, i) => {
                        const t = (i / steps) * dur;
                        const power = a * Math.pow(decay, i);
                        const dx = (i % 2 === 0 ? 1 : -1) * power * (i === 0 || i === steps ? 0 : 1);
                        const dy = (i % 2 === 0 ? -0.5 : 0.5) * power * (i === 0 || i === steps ? 0 : 1);
                        return kf(t, { x: base.x + dx, y: base.y + dy });
                    });
                },
                hop: () => {
                    const height = finite(params.height, 4);
                    const count  = Math.round(finite(params.count, 2));
                    const frames = [kf(0)];
                    for (let c = 0; c < count; c++) {
                        const segStart = (c / count) * dur;
                        const segEnd   = ((c + 1) / count) * dur;
                        const peak     = (segStart + segEnd) / 2;
                        frames.push(e('easeOutQuad')(kf(peak, { y: base.y - height, h: base.h * 1.02 })));
                        frames.push(e('easeInQuad')(kf(segEnd, { y: base.y, h: base.h * 0.96 })));
                    }
                    frames.push(kf(dur));
                    return frames;
                },
                swing: () => {
                    const a = finite(params.amplitude, 8);
                    const steps = 8;
                    return Array.from({ length: steps + 1 }, (_, i) => {
                        const phase = (i / steps) * Math.PI * 2;
                        const frame = kf((i / steps) * dur, {
                            rotation: base.rotation + Math.sin(phase) * a,
                        });
                        if (i > 0) frame.easing = easingParam || 'easeInOutSine';
                        return frame;
                    });
                },
                orbit: () => {
                    const r = finite(params.radius, 3);
                    const steps = 12;
                    return Array.from({ length: steps + 1 }, (_, i) => {
                        const angle = (i / steps) * Math.PI * 2;
                        const frame = kf((i / steps) * dur, {
                            x: base.x + Math.sin(angle) * r,
                            y: base.y - Math.cos(angle) * r + r,
                        });
                        if (i > 0) frame.easing = easingParam || 'linear';
                        return frame;
                    });
                },
                nod: () => {
                    const a = finite(params.amplitude, 3);
                    const cycles = Math.round(finite(params.cycles, 2));
                    const steps = cycles * 4;
                    return Array.from({ length: steps + 1 }, (_, i) => {
                        const phase = (i / steps) * cycles * Math.PI * 2;
                        const frame = kf((i / steps) * dur, {
                            rotation: base.rotation + Math.sin(phase) * a,
                        });
                        if (i > 0) frame.easing = easingParam || 'easeInOutSine';
                        return frame;
                    });
                },
                blinkIn: () => [
                    kf(0,            { opacity: 0 }),
                    e('stepEnd')(kf(dur * 0.15, { opacity: base.opacity })),
                    e('stepEnd')(kf(dur * 0.3,  { opacity: 0 })),
                    e('stepEnd')(kf(dur * 0.45, { opacity: base.opacity })),
                    kf(dur,          { opacity: base.opacity }),
                ],
            };
            if (!presets[presetName]) {
                this.setStatus(`Unknown preset: ${presetName}`, true);
                return;
            }
            layer.keyframes = normalizeKeyframes(presets[presetName]());
            this.applyAnimationTime(0);
            this.setStatus(`Preset "${presetName}" applied to ${layer.name} (${layer.keyframes.length} keyframes).`);
            this.scheduleSave();
        }

        applyAgentCommands(commands) {
            const list = Array.isArray(commands) ? commands : (commands?.commands || []);
            const characterLayerIds = new Set();
            (this.composition.characters || []).forEach((character) => {
                CHARACTER_PART_KEYS.forEach((part) => {
                    (character.parts[part] || []).forEach((id) => characterLayerIds.add(id));
                });
                (character.hidden || []).forEach((id) => characterLayerIds.add(id));
            });
            let applied = 0, skipped = 0;
            list.forEach((cmd) => {
                if (!cmd || typeof cmd !== 'object') { skipped++; return; }
                if (cmd.characterId || cmd.character) {
                    const character = this.getCharacter(cmd.characterId || cmd.character);
                    if (!character) { skipped++; return; }
                    const patch = {};
                    if (cmd.settings && typeof cmd.settings === 'object') Object.assign(patch, cmd.settings);
                    if (typeof cmd.expression === 'string') patch.expression = cmd.expression;
                    if (cmd.gaze && typeof cmd.gaze === 'object') {
                        patch.gazeX = cmd.gaze.x;
                        patch.gazeY = cmd.gaze.y;
                    }
                    if (typeof cmd.speak === 'string') {
                        patch.talk = false;
                        patch.speechText = cmd.speak;
                    } else if (cmd.speak && typeof cmd.speak === 'object') {
                        if (typeof cmd.speak.text === 'string') patch.speechText = cmd.speak.text;
                        if (Number.isFinite(Number(cmd.speak.rate))) patch.speechRate = Number(cmd.speak.rate);
                        if (Number.isFinite(Number(cmd.speak.start))) patch.speechStart = Number(cmd.speak.start);
                        patch.talk = false;
                    }
                    if (cmd.blink !== undefined) patch.blink = cmd.blink !== false;
                    if (cmd.headSway !== undefined && Number.isFinite(Number(cmd.headSway))) {
                        patch.headSway = Number(cmd.headSway);
                    }
                    if (typeof cmd.preset === 'string') {
                        const characterPatch = this.characterPresetPatch(cmd.preset, cmd.params || {});
                        if (characterPatch) Object.assign(patch, characterPatch);
                    }
                    this.updateCharacterSettings(character.id, patch, { apply: true, silent: true });
                    applied += 1;
                    return;
                }
                if (!cmd.layerId) { skipped++; return; }
                if (characterLayerIds.has(cmd.layerId)) { skipped++; return; }
                const layer = this.getLayer(cmd.layerId);
                if (!layer) { skipped++; return; }
                this.selectedLayerId = cmd.layerId;
                if (Array.isArray(cmd.keyframes) && cmd.keyframes.length) {
                    layer.keyframes = normalizeKeyframes(cmd.keyframes);
                    applied += 1;
                    return;
                }
                const preset = typeof cmd.preset === 'string' ? cmd.preset : 'none';
                if (preset === 'none') {
                    layer.keyframes = [];
                    applied += 1;
                    return;
                }
                this.applyPreset(preset, cmd.params || {});
                applied += 1;
            });
            this.render();
            this.setStatus(`Applied ${applied} agent command(s)${skipped ? `; ${skipped} skipped` : ''}.`);
            this.scheduleSave();
        }

        exportAgentSpec() {
            const characterLayerIds = new Set();
            (this.composition.characters || []).forEach((character) => {
                CHARACTER_PART_KEYS.forEach((part) => {
                    (character.parts[part] || []).forEach((id) => characterLayerIds.add(id));
                });
                (character.hidden || []).forEach((id) => characterLayerIds.add(id));
            });
            const doc = {
                schema: 'layer-studio/agent/v1',
                scene: {
                    id: this.composition.id,
                    name: this.composition.name,
                    width: this.composition.width,
                    height: this.composition.height,
                    duration: this.composition.duration,
                },
                reference: this.composition.referenceLayerId,
                presetVocabulary: [
                    ...PRESET_NAMES, 'none',
                ],
                characterPresetVocabulary: [
                    'neutral','happy','sad','surprised','angry','blink','talk','speak',
                    'gaze','pulse','idle','none',
                ],
                characterPartVocabulary: [
                    'face','eyes','pupils','highlights','eyelids','brows','mouth','jaw',
                    'teeth','tongue','mustache','beard','head','body','hands','ears',
                    'neck','fx',
                ],
                visemeVocabulary: CHARACTER_VISEME_KEYS,
                browPoseVocabulary: ['neutral','raised','furrowed','sad'],
                expressionVocabulary: CHARACTER_EXPRESSIONS,
                characters: (this.composition.characters || []).map((character) => ({
                    id: character.id,
                    name: character.name,
                    parts: character.parts,
                    hidden: character.hidden || [],
                    coverLayerId: character.coverLayerId || null,
                    settings: character.settings,
                    applied: character.applied,
                    rigVersion: character.rigVersion || 0,
                })),
                layers: this.composition.layers.filter((layer) => (
                    layer.rig !== true
                    && layer.id !== this.composition.referenceLayerId
                    && !characterLayerIds.has(layer.id)
                )).map((layer) => ({
                    id: layer.id,
                    name: layer.name,
                    role: layer.role || 'prop',
                    z: layer.z,
                    box: {
                        x: +(layer.x ?? 0).toFixed(2),
                        y: +(layer.y ?? 0).toFixed(2),
                        w: +(layer.w ?? 0).toFixed(2),
                        h: +(layer.h ?? 0).toFixed(2),
                    },
                    rotation: +(layer.rotation || 0).toFixed(2),
                    opacity: +(layer.opacity ?? 1).toFixed(2),
                    sprite: Array.isArray(layer.frames) && layer.frames.length > 1
                        ? { frames: layer.frames.length, fps: layer.spriteFps, mode: layer.spriteMode }
                        : null,
                    keyframes: (layer.keyframes || []).length,
                })),
                rigLayers: this.composition.layers
                    .filter((layer) => layer.rig === true || characterLayerIds.has(layer.id))
                    .map((layer) => layer.id),
            };
            downloadFile(
                safeFilename(`${this.composition.name}-agent`, 'json'),
                'application/json',
                JSON.stringify(doc, null, 2),
            );
            this.setStatus(`Agent spec exported (${doc.layers.length} layers).`);
            return doc;
        }

        syncValidationControls() {
            this.composition.layers.forEach((layer) => {
                const row = this.el.list.querySelector(`[data-id="${layer.id}"]`);
                const badge = row?.querySelector('.layer-validation-badge');
                if (badge) {
                    badge.dataset.confirmed = String(layer.positionConfirmed);
                    badge.setAttribute('aria-label', layer.positionConfirmed ? 'Position confirmed' : 'Position needs review');
                    badge.title = layer.positionConfirmed ? 'Position confirmed' : 'Position needs review';
                    badge.textContent = layer.positionConfirmed ? '✓' : '!';
                }
            });
            const pending = this.composition.layers.filter((layer) => !layer.positionConfirmed).length;
            const confirmAll = this.root.querySelector('[data-action="confirm-all"]');
            if (confirmAll) {
                confirmAll.textContent = pending ? `Confirm all positions (${pending})` : 'All positions confirmed';
                confirmAll.setAttribute('aria-label', pending ? `Confirm all ${pending} unconfirmed layer positions` : 'All layer positions confirmed');
                confirmAll.setAttribute('aria-pressed', String(pending === 0));
                confirmAll.disabled = !this.composition.layers.length || pending === 0;
            }
            const layer = this.getLayer(this.selectedLayerId);
            const confirmation = this.el.inspector.querySelector('[data-action="confirm-layer"]');
            if (layer && confirmation) {
                confirmation.setAttribute('aria-pressed', String(layer.positionConfirmed));
                confirmation.textContent = layer.positionConfirmed
                    ? 'Position confirmed · reopen review'
                    : 'Confirm this position';
            }
        }

        onKeyDown(event) {
            const resizer = event.target.closest('[data-resize]');
            if (resizer && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault();
                const vertical = window.matchMedia('(max-width: 650px)').matches;
                const positive = vertical
                    ? event.key === 'ArrowDown'
                    : event.key === 'ArrowRight';
                const direction = positive ? 1 : -1;
                const side = resizer.dataset.resize;
                const current = this.panelSizes[side];
                this.setPanelSize(side, current + direction * 16, resizer, vertical);
                return;
            }
            if (event.key !== 'Delete' && event.key !== 'Backspace') return;
            if (event.target.matches('input, select, textarea, button')) return;
            if (!this.selectedLayerId) return;
            event.preventDefault();
            this.removeSelected();
        }

        onPointerDown(event) {
            const resizer = event.target.closest('[data-resize]');
            if (resizer && event.button === 0) {
                this.beginPanelResize(event, resizer);
                return;
            }
            if (event.button !== 0 || event.target.closest('[data-locked="true"]')) return;
            const node = event.target.closest('.layer-item');
            if (!node || !this.el.canvas.contains(node)) return;
            if (this.animation.isExporting) return;
            const grip = event.target.closest('.layer-handle')?.dataset.grip;
            if (grip) {
                this.beginResize(event, node, grip);
                return;
            }
            const layer = this.getLayer(node.dataset.id);
            if (!layer || layer.locked) return;
            if (layer.id !== this.selectedLayerId) {
                this.selectedLayerId = layer.id;
                this.render();
            }
            const activeNode = this.el.canvas.querySelector(`[data-id="${layer.id}"]`);
            if (activeNode) this.beginDrag(event, activeNode);
        }

        togglePanel(side) {
            const panel = side === 'sidebar' ? this.el.sidebar : this.el.inspectorPanel;
            if (!panel) return;
            const button = panel.querySelector('[data-action="toggle-panel"]');
            const collapsed = panel.classList.toggle('is-collapsed');
            if (button) {
                const label = `${collapsed ? 'Expand' : 'Collapse'} ${side === 'sidebar' ? 'layer list' : 'inspector'}`;
                button.setAttribute('aria-expanded', String(!collapsed));
                button.setAttribute('aria-label', label);
                button.title = label;
                const icon = button.querySelector('i');
                if (icon) {
                    icon.className = `fas fa-chevron-${side === 'sidebar'
                        ? (collapsed ? 'right' : 'left')
                        : (collapsed ? 'left' : 'right')}`;
                }
            }
            if (!collapsed) panel.style.flexBasis = `${this.panelSizes[side]}px`;
            this._ctrl?.cancel();
        }

        beginPanelResize(event, handle) {
            const side = handle.dataset.resize;
            const panel = side === 'sidebar' ? this.el.sidebar : this.el.inspectorPanel;
            if (!panel || panel.classList.contains('is-collapsed')) return;
            const vertical = window.matchMedia('(max-width: 650px)').matches;
            const rect = panel.getBoundingClientRect();
            const measured = vertical ? rect.height : rect.width;
            const origin = measured || this.panelSizes[side];
            this.panelSizes[side] = origin;
            event.preventDefault();
            this.startPointerOperation((pointer) => {
                const delta = vertical ? pointer.dy : pointer.dx;
                const direction = side === 'inspector' ? -1 : 1;
                this.setPanelSize(side, origin + delta * direction, handle, vertical);
            }, event);
        }

        setPanelSize(side, value, handle, vertical) {
            const panel = side === 'sidebar' ? this.el.sidebar : this.el.inspectorPanel;
            if (!panel) return;
            const rect = this.root.getBoundingClientRect();
            const available = vertical ? rect.height : rect.width;
            const min = vertical ? 110 : 180;
            const max = Math.max(min, Math.min(480, available * 0.45));
            const size = Math.round(clamp(value, min, max));
            this.panelSizes[side] = size;
            panel.style.flexBasis = `${size}px`;
            handle.setAttribute('aria-valuemin', String(min));
            handle.setAttribute('aria-valuemax', String(Math.round(max)));
            handle.setAttribute('aria-valuenow', String(size));
            handle.setAttribute('aria-orientation', vertical ? 'horizontal' : 'vertical');
        }

        beginDrag(event, node) {
            if (this.animation.isPlaying) this.stopPlayback();
            const layer = this.getLayer(node.dataset.id);
            const rect = this.el.canvas.getBoundingClientRect();
            const zoom = Number.parseFloat(getComputedStyle(this.el.canvas).getPropertyValue('--ls-canvas-zoom')) || 1;
            const canvasWidth = rect.width / zoom;
            const canvasHeight = rect.height / zoom;
            if (!layer || !canvasWidth || !canvasHeight) return;
            event.preventDefault();
            const animated = layer.keyframes.length > 0;
            const origin = this.getLayerStateAtTime(layer, this.animation.currentTime);
            let changed = false;
            this.startPointerOperation((pointer) => {
                const x = Math.round(clamp(origin.x + pointer.dx / canvasWidth * 100, -100, 200) * 10) / 10;
                const y = Math.round(clamp(origin.y + pointer.dy / canvasHeight * 100, -100, 200) * 10) / 10;
                if (x !== Number(node.style.left.replace('%', '')) || y !== Number(node.style.top.replace('%', ''))) {
                    changed = true;
                    if (!animated) layer.positionConfirmed = false;
                }
                if (animated) {
                    this.upsertKeyframe(layer, this.animation.currentTime, { ...origin, x, y });
                } else {
                    layer.x = x;
                    layer.y = y;
                }
                node.style.left = `${x}%`;
                node.style.top = `${y}%`;
                this.syncInspectorFields();
            }, event, () => {
                if (!changed) return;
                this.renderList();
                this.renderInspector();
                if (animated) {
                    this.applyAnimationTime(this.animation.currentTime);
                    this.setStatus(`${layer.name} animation pose updated at ${Math.round(this.animation.currentTime)} ms.`);
                } else {
                    this.setStatus(`${layer.name} was moved. Confirm its position after review.`, false, true);
                }
                this.scheduleSave();
            });
        }

        beginResize(event, node, grip) {
            if (this.animation.isPlaying) this.stopPlayback();
            const layer = this.getLayer(node.dataset.id);
            const rect = this.el.canvas.getBoundingClientRect();
            const zoom = Number.parseFloat(getComputedStyle(this.el.canvas).getPropertyValue('--ls-canvas-zoom')) || 1;
            const canvasWidth = rect.width / zoom;
            const canvasHeight = rect.height / zoom;
            if (!layer || layer.locked || !canvasWidth || !canvasHeight) return;
            event.preventDefault();
            const animated = layer.keyframes.length > 0;
            const origin = this.getLayerStateAtTime(layer, this.animation.currentTime);
            let changed = false;
            this.startPointerOperation((pointer) => {
                const dx = pointer.dx / canvasWidth * 100;
                const dy = pointer.dy / canvasHeight * 100;
                const w = Math.round(clamp(origin.w + (grip.includes('e') ? dx : 0) - (grip.includes('w') ? dx : 0), 1, 300) * 10) / 10;
                const h = Math.round(clamp(origin.h + (grip.includes('s') ? dy : 0) - (grip.includes('n') ? dy : 0), 1, 300) * 10) / 10;
                const x = grip.includes('w') ? Math.round((origin.x + origin.w - w) * 10) / 10 : origin.x;
                const y = grip.includes('n') ? Math.round((origin.y + origin.h - h) * 10) / 10 : origin.y;
                if (x !== Number(node.style.left.replace('%', ''))
                    || y !== Number(node.style.top.replace('%', ''))
                    || w !== Number(node.style.width.replace('%', ''))
                    || h !== Number(node.style.height.replace('%', ''))) {
                    changed = true;
                    if (!animated) layer.positionConfirmed = false;
                }
                if (animated) {
                    this.upsertKeyframe(layer, this.animation.currentTime, { ...origin, x, y, w, h });
                } else {
                    Object.assign(layer, { x, y, w, h });
                }
                Object.assign(node.style, {
                    width: `${w}%`, height: `${h}%`,
                    left: `${x}%`, top: `${y}%`,
                });
                this.syncInspectorFields();
            }, event, () => {
                if (!changed) return;
                this.renderList();
                this.renderInspector();
                if (animated) {
                    this.applyAnimationTime(this.animation.currentTime);
                    this.setStatus(`${layer.name} animation size updated at ${Math.round(this.animation.currentTime)} ms.`);
                } else {
                    this.setStatus(`${layer.name} was resized. Confirm its position after review.`, false, true);
                }
                this.scheduleSave();
            });
        }

        startPointerOperation(update, event, onFinish) {
            const startX = event.clientX;
            const startY = event.clientY;
            const move = (pointer) => update({ dx: pointer.clientX - startX, dy: pointer.clientY - startY });
            const finish = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', finish);
                window.removeEventListener('pointercancel', finish);
                this._ctrl = null;
                if (onFinish) onFinish();
            };
            this._ctrl?.cancel();
            this._ctrl = { cancel: finish };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', finish);
            window.addEventListener('pointercancel', finish);
        }

        syncInspectorFields() {
            const layer = this.getLayer(this.selectedLayerId);
            if (!layer) return;
            const state = this.getLayerStateAtTime(layer, this.animation.currentTime);
            ['x', 'y', 'w', 'h', 'rotation', 'z'].forEach((property) => {
                const input = this.el.inspector.querySelector(`[data-prop="${property}"]`);
                if (input) input.value = String(property === 'z' ? layer.z : state[property]);
            });
        }

        getLayer(id) {
            return this.composition.layers.find((layer) => layer.id === id);
        }

        removeSelected() {
            if (!this.selectedLayerId) return;
            this.stopPlayback();
            if (this.selectedLayerId === this.composition.referenceLayerId) {
                this.composition.referenceLayerId = null;
            }
            this.composition.layers = this.composition.layers.filter((layer) => layer.id !== this.selectedLayerId);
            this.selectedLayerId = null;
            this.render();
            this.setStatus('Layer removed.');
            this.scheduleSave();
        }

        async alignToReference({ applyAmbiguous = false, confirmExact = false } = {}) {
            const referenceLayer = this.getLayer(this.selectedLayerId);
            if (!referenceLayer) throw new Error('Select the assembled image layer to use as the reference.');
            const image = await loadImage(referenceLayer.url);
            if (image.naturalWidth > 10000 || image.naturalHeight > 10000) {
                throw new Error('The reference image cannot exceed 10000 pixels in either dimension.');
            }
            const analysisScale = Math.min(
                1,
                MAX_MATCH_EDGE / image.naturalWidth,
                MAX_MATCH_EDGE / image.naturalHeight,
            );
            const reference = imagePixels(
                image,
                image.naturalWidth * analysisScale,
                image.naturalHeight * analysisScale,
            );
            if (!alphaBounds(reference.data, reference.width, reference.height)) {
                throw new Error('The reference image has no visible pixels to match.');
            }

            this.composition.referenceLayerId = referenceLayer.id;
            this.composition.width = image.naturalWidth;
            this.composition.height = image.naturalHeight;
            referenceLayer.x = 0;
            referenceLayer.y = 0;
            referenceLayer.w = 100;
            referenceLayer.h = 100;
            referenceLayer.rotation = 0;
            referenceLayer.fit = 'contain';
            referenceLayer.visible = true;
            referenceLayer.locked = true;
            referenceLayer.positionConfirmed = true;
            this.composition.layers.forEach((layer) => {
                if (layer.id !== referenceLayer.id) layer.positionConfirmed = false;
            });
            this.render();

            const layers = this.composition.layers.filter((layer) => layer.id !== referenceLayer.id);
            let aligned = 0;
            let exact = 0;
            let guessed = 0;
            const unresolved = [];
            const matches = [];
            for (let index = 0; index < layers.length; index += 1) {
                const layer = layers[index];
                this.setStatus(`Matching ${layer.name} (${index + 1}/${layers.length})…`);
                if (layer.rotation !== 0) {
                    unresolved.push(`${layer.name} (rotation is not supported)`);
                    matches.push({ layerId: layer.id, status: 'unsupported-rotation' });
                    continue;
                }
                try {
                    const source = await loadImage(layer.url);
                    const match = matchImageToReference(source, reference, analysisScale);
                    matches.push({ layerId: layer.id, ...match });
                    const placement = match.status === 'matched'
                        ? { x: match.x, y: match.y, factor: match.factor }
                        : (applyAmbiguous && match.status === 'ambiguous' && match.best
                            ? match.best
                            : null);
                    if (match.status !== 'matched') {
                        const margin = match.status === 'ambiguous' && Number.isFinite(match.alternativeScore)
                            ? `; score margin ${((match.alternativeScore - match.score) * 100).toFixed(1)}%`
                            : '';
                        unresolved.push(`${layer.name} (${match.status}${margin}${placement ? '; best guess used' : ''})`);
                    }
                    if (!placement) continue;
                    layer.x = clamp(placement.x / reference.width * 100, -100, 200);
                    layer.y = clamp(placement.y / reference.height * 100, -100, 200);
                    layer.w = clamp(source.naturalWidth * placement.factor / image.naturalWidth * 100, 1, 300);
                    layer.h = clamp(source.naturalHeight * placement.factor / image.naturalHeight * 100, 1, 300);
                    layer.fit = 'contain';
                    if (match.status === 'matched') {
                        exact += 1;
                        if (confirmExact) layer.positionConfirmed = true;
                    } else {
                        guessed += 1;
                    }
                    aligned += 1;
                } catch (error) {
                    console.error(`[layer-studio] could not match ${layer.name}:`, error);
                    unresolved.push(`${layer.name} (image analysis failed)`);
                    matches.push({ layerId: layer.id, status: 'analysis-failed' });
                }
                await new Promise((resolve) => window.requestAnimationFrame(resolve));
            }
            this.render();
            let saved = false;
            if (this.projectId) saved = await this.saveProject({ silent: true });
            const placement = guessed
                ? `placed ${aligned}/${layers.length} layers (${exact} exact, ${guessed} best guess${guessed === 1 ? '' : 'es'})`
                : `aligned ${aligned}/${layers.length} layers`;
            const summary = `Reference set to ${referenceLayer.name}; ${placement}.`;
            const details = unresolved.length
                ? ` ${unresolved.length} layer${unresolved.length === 1 ? '' : 's'} need manual review. Review placements, then confirm them individually or together.`
                : (confirmExact
                    ? ' All matched placements are confirmed.'
                    : ' Review placements, then confirm them individually or together.');
            const saveNote = this.projectId
                ? (saved
                    ? ' Project saved to the studio backend.'
                    : ' The aligned project could not be saved to the backend.')
                : '';
            this.setStatus(summary + details + saveNote, false, true);
            return { aligned, exact, guessed, unresolved, matches, saved };
        }

        async importFiles(files, { center = false, pasted = false } = {}) {
            const images = files.filter((file) => file.type.startsWith('image/'));
            if (!images.length) {
                this.setStatus('No image files were selected.', true);
                return;
            }
            if (this.composition.layers.length + images.length > MAX_LAYERS) {
                this.setStatus(`You can add up to ${MAX_LAYERS} layers to one composition.`, true);
                return;
            }
            try {
                for (const file of images.sort((a, b) => a.name.localeCompare(b.name))) {
                    const url = await this.readFileAsDataURL(file);
                    if (!safeImageUrl(url)) throw new Error(`Unsupported image type: ${file.name}`);
                    const index = this.composition.layers.length;
                    const image = center ? await loadImage(url) : null;
                    const scale = image
                        ? Math.min(1, this.composition.width / image.naturalWidth, this.composition.height / image.naturalHeight)
                        : 1;
                    const width = image ? image.naturalWidth * scale : null;
                    const height = image ? image.naturalHeight * scale : null;
                    const layer = makeLayer({
                        url,
                        name: file.name.replace(/\.[^.]+$/, ''),
                        x: image ? (this.composition.width - width) / 2 / this.composition.width * 100 : 20 + index * 2,
                        y: image ? (this.composition.height - height) / 2 / this.composition.height * 100 : 20 + index * 2,
                        w: image ? width / this.composition.width * 100 : 60,
                        h: image ? height / this.composition.height * 100 : 60,
                        z: index,
                    }, index);
                    this.composition.layers.push(layer);
                    this.selectedLayerId = layer.id;
                }
                this.render();
                this.setStatus(pasted
                    ? `${images.length} pasted image${images.length === 1 ? '' : 's'} added as centered layer${images.length === 1 ? '' : 's'}.`
                    : `${images.length} image${images.length === 1 ? '' : 's'} added.`);
                this.scheduleSave();
            } catch (error) {
                console.error('[layer-studio] image import failed:', error);
                this.setStatus(error.message || 'Could not read the selected image files.', true);
            }
        }

        readFileAsDataURL(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => typeof reader.result === 'string'
                    ? resolve(reader.result)
                    : reject(new Error(`Could not read ${file.name}.`));
                reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}.`));
                reader.readAsDataURL(file);
            });
        }

        openComposition(value, { projectId = null, projectMeta = null, repositorySource = null } = {}) {
            const parsed = value?.composition || value;
            this.stopPlayback();
            if (this._saveTimer) {
                window.clearTimeout(this._saveTimer);
                this._saveTimer = null;
            }
            this.composition = normalizeComposition(parsed);
            this.projectId = projectId || null;
            this.projectMeta = projectMeta || parsed?.meta || null;
            this.repositorySource = repositorySource;
            this.selectedLayerId = this.composition.referenceLayerId || this.composition.layers.at(-1)?.id || null;
            this.animation.currentTime = 0;
            this.proposals = [];
            this.proposalMeta = null;
            this.activeProposalId = null;
            this._proposalError = null;
            if (this._contextTimer) {
                window.clearTimeout(this._contextTimer);
                this._contextTimer = null;
            }
            this.render();
            this.renderProposals();
            this.updateProposalContext();
            this.characterAnimations = CHARACTER_ANIMATION_PRESETS;
            this.loadCharacterAnimations().catch((error) => {
                console.warn('[layer-studio] could not load the animation library:', error);
            });
            this.loadDirectorState().catch((error) => {
                console.warn('[layer-studio] could not load animation ideas:', error);
            });
            this.prepareCharacterCovers().catch((error) => {
                console.warn('[layer-studio] could not prepare character face bases:', error);
            });
        }

        async importProject(file) {
            if (!file) return;
            try {
                const parsed = JSON.parse(await file.text());
                this.openComposition(parsed.composition || parsed);
                this.setStatus(`Opened ${file.name}.`);
            } catch (error) {
                console.error('[layer-studio] project import failed:', error);
                this.setStatus(error.message || 'Could not open the composition file.', true);
            }
        }

        async requestBackend(path, options = {}) {
            let response;
            try {
                response = await fetch(path, { ...options, cache: 'no-store' });
            } catch (error) {
                throw new Error('Could not reach the studio backend. Start it with "node server.js" and open http://localhost:8008/studio.html.');
            }
            let data = null;
            try {
                data = await response.json();
            } catch (error) {
                data = null;
            }
            if (!response.ok) {
                throw new Error(data?.error || `The studio backend returned ${response.status}.`);
            }
            return data;
        }

        async loadProjectCatalog({ selectProjectId = null } = {}) {
            if (!this.el.projectSelect) return;
            try {
                const data = await this.requestBackend('api/projects');
                this.projectCatalog = Array.isArray(data?.projects) ? data.projects : [];
                const options = [new Option('Choose a project…', '')];
                this.projectCatalog.forEach((project) => {
                    options.push(new Option(project.name || project.id, project.id));
                });
                this.el.projectSelect.replaceChildren(...options);
                if (selectProjectId && this.projectCatalog.some((project) => project.id === selectProjectId)) {
                    this.el.projectSelect.value = selectProjectId;
                    this.populateCompositions(selectProjectId, 'main');
                } else if (selectProjectId) {
                    this.populateCompositions('', '');
                }
            } catch (error) {
                console.error('[layer-studio] project catalog load failed:', error);
                this.el.projectSelect.replaceChildren(new Option('Projects unavailable', ''));
                this.populateCompositions('', '');
                this.setStatus(error.message || 'Could not load repository projects.', true);
            }
        }

        populateCompositions(projectId, selectedCompositionId = '') {
            const project = this.projectCatalog.find((item) => item.id === projectId);
            const compositions = project?.compositions || [];
            const placeholder = !projectId
                ? 'Choose a project first'
                : (compositions.length ? 'Choose a composition…' : 'No compositions available');
            const options = [new Option(placeholder, '')];
            compositions.forEach((composition) => {
                options.push(new Option(composition.name || composition.id, composition.id));
            });
            this.el.compositionSelect.replaceChildren(...options);
            this.el.compositionSelect.disabled = compositions.length === 0;
            if (compositions.some((composition) => composition.id === selectedCompositionId)) {
                this.el.compositionSelect.value = selectedCompositionId;
            }
        }

        selectProject(projectId) {
            this.populateCompositions(projectId);
            if (!projectId) return;
            const project = this.projectCatalog.find((item) => item.id === projectId);
            const composition = project?.compositions?.[0];
            if (!composition) {
                this.setStatus('This project has no available compositions.', true);
                return;
            }
            this.el.compositionSelect.value = composition.id;
            this.openSelectedComposition(composition.id);
        }

        async openSelectedComposition(compositionId) {
            const projectId = this.el.projectSelect?.value;
            const project = this.projectCatalog.find((item) => item.id === projectId);
            const composition = project?.compositions?.find((item) => item.id === compositionId);
            if (!project || !compositionId || !composition) return;
            this.el.projectSelect.disabled = true;
            this.el.compositionSelect.disabled = true;
            try {
                const value = await this.requestBackend(
                    `api/projects/${encodeURIComponent(project.id)}/compositions/${encodeURIComponent(composition.id)}`,
                );
                const importId = project.id.startsWith('import-') ? project.id.slice('import-'.length) : null;
                this.openComposition(value, importId
                    ? { projectId: importId, projectMeta: value.meta || null }
                    : { repositorySource: { projectId: project.id, compositionId: composition.id } });
                this.setStatus(`Opened "${this.composition.name}".`);
            } catch (error) {
                console.error('[layer-studio] repository composition open failed:', error);
                this.setStatus(error.message || 'Could not open the selected composition.', true);
            } finally {
                this.el.projectSelect.disabled = false;
                this.el.compositionSelect.disabled = project.compositions.length === 0;
            }
        }

        async syncProjectPicker(projectId) {
            if (!projectId) return;
            const pickerId = `import-${projectId}`;
            if (!this.projectCatalog.some((project) => project.id === pickerId)) {
                await this.loadProjectCatalog({ selectProjectId: pickerId });
                return;
            }
            this.el.projectSelect.value = pickerId;
            this.populateCompositions(pickerId, 'main');
        }

        async saveProject({ silent = false } = {}) {
            if (!this.projectId && !this.repositorySource) {
                if (!silent) this.setStatus('Open or import a backend project before saving.', true);
                return false;
            }
            this._saveQueued = true;
            if (this._savePromise) return this._savePromise;
            this._savePromise = (async () => {
                let saved = false;
                while (this._saveQueued) {
                    this._saveQueued = false;
                    if (!this.projectId && this.repositorySource) {
                        const source = this.repositorySource;
                        const result = await this.requestBackend('api/imports/copy', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                sourceProjectId: source.projectId,
                                sourceCompositionId: source.compositionId,
                                composition: this.createExportSnapshot(),
                            }),
                        });
                        this.projectId = result.project.id;
                        this.projectMeta = result.composition.meta || null;
                        this.repositorySource = null;
                        await this.syncProjectPicker(this.projectId);
                        this.composition.name = result.composition.name;
                        this.render();
                        this.loadCharacterAnimations().catch((error) => {
                            console.warn('[layer-studio] could not load the animation library:', error);
                        });
                        this.loadDirectorState();
                        saved = true;
                        this._saveQueued = true;
                        continue;
                    }
                    const projectId = this.projectId;
                    const result = await this.requestBackend(
                        `api/imports/${encodeURIComponent(projectId)}/composition.json`,
                        {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                composition: this.createExportSnapshot(),
                                meta: this.projectMeta || {},
                            }),
                        },
                    );
                    this.projectMeta = {
                        ...(this.projectMeta || {}),
                        updatedAt: result?.updatedAt || new Date().toISOString(),
                    };
                    saved = true;
                }
                return saved;
            })();
            try {
                const saved = await this._savePromise;
                if (!silent) this.setStatus(`Saved "${this.composition.name}" to the studio backend.`);
                return saved;
            } catch (error) {
                console.error('[layer-studio] project save failed:', error);
                this.setStatus(
                    silent ? `Autosave failed: ${error.message}` : (error.message || 'Could not save the project.'),
                    true,
                );
                return false;
            } finally {
                this._savePromise = null;
            }
        }

        scheduleSave() {
            if (!this.projectId) return;
            if (this._saveTimer) window.clearTimeout(this._saveTimer);
            this._saveTimer = window.setTimeout(() => {
                this._saveTimer = null;
                this.saveProject({ silent: true });
            }, 900);
        }

        syncProjectControls() {
            const enabled = Boolean(this.projectId);
            const canSave = enabled || Boolean(this.repositorySource);
            if (this.el.saveProject) {
                this.el.saveProject.disabled = !canSave;
                this.el.saveProject.title = enabled
                    ? `Save this composition to data/imports/${this.projectId}`
                    : (this.repositorySource
                        ? 'Save an editable copy of this repository composition to data/imports'
                        : 'Open or import a backend project to enable saving');
            }
            if (this.el.proposeButton) {
                this.el.proposeButton.disabled = !enabled || this.directorBusy;
                this.el.proposeButton.textContent = this.directorBusy ? 'Thinking…' : 'Suggest animations';
            }
            if (this.el.resetAnimations) this.el.resetAnimations.disabled = !enabled || this.directorBusy;
            const directorButton = this.root.querySelector('[data-action="open-director"]');
            if (directorButton) directorButton.disabled = !enabled;
            const generateButton = this.root.querySelector('[data-action="generate-ideas"]');
            if (generateButton) {
                generateButton.disabled = !enabled || this.directorBusy;
                generateButton.textContent = this.directorBusy ? 'Thinking…' : 'Generate ideas';
            }
            const saveContextButton = this.root.querySelector('[data-action="save-context"]');
            if (saveContextButton) saveContextButton.disabled = !enabled || this.directorBusy;
        }

        setArchiveStatus(message, { error = false, busy = false } = {}) {
            if (!this.el.archiveStatus) return;
            this.el.archiveStatus.textContent = message || '';
            this.el.archiveStatus.dataset.error = String(error);
            this.el.archiveStatus.dataset.busy = String(busy);
        }

        openArchiveDialog({ focusSaved = false } = {}) {
            const dialog = this.el.archiveDialog;
            if (!dialog) return;
            if (!dialog.open) {
                if (this.el.archiveZip) this.el.archiveZip.value = '';
                if (this.el.archiveRef) this.el.archiveRef.value = '';
                if (this.el.archiveName) this.el.archiveName.value = '';
                this.setArchiveStatus('');
                if (typeof dialog.showModal === 'function') dialog.showModal();
                else dialog.setAttribute('open', '');
            }
            this.loadSavedProjects();
            if (focusSaved) {
                window.setTimeout(() => this.el.savedList?.scrollIntoView({ block: 'nearest' }), 0);
            }
        }

        closeArchiveDialog() {
            if (this.el.archiveDialog?.open) this.el.archiveDialog.close();
        }

        describeArchiveSelection() {
            const zip = this.el.archiveZip?.files?.[0];
            const reference = this.el.archiveRef?.files?.[0];
            if (!zip && !reference) {
                this.setArchiveStatus('');
                return;
            }
            const parts = [];
            if (zip) parts.push(`${zip.name} (${formatBytes(zip.size)})`);
            if (reference) parts.push(`${reference.name} (${formatBytes(reference.size)})`);
            this.setArchiveStatus(parts.join(' · '));
        }

        readFileAsBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    if (typeof reader.result !== 'string') {
                        reject(new Error(`Could not read ${file.name}.`));
                        return;
                    }
                    const comma = reader.result.indexOf(',');
                    resolve(comma >= 0 ? reader.result.slice(comma + 1) : reader.result);
                };
                reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}.`));
                reader.readAsDataURL(file);
            });
        }

        async loadSavedProjects() {
            if (!this.el.savedList) return;
            const loading = document.createElement('p');
            loading.className = 'layer-saved-empty';
            loading.textContent = 'Loading saved projects…';
            this.el.savedList.replaceChildren(loading);
            try {
                const data = await this.requestBackend('api/imports');
                this.renderSavedProjects(Array.isArray(data?.projects) ? data.projects : []);
            } catch (error) {
                const failure = document.createElement('p');
                failure.className = 'layer-saved-empty';
                failure.textContent = error.message || 'Could not load saved projects.';
                this.el.savedList.replaceChildren(failure);
            }
        }

        renderSavedProjects(projects) {
            if (!this.el.savedList) return;
            this.el.savedList.replaceChildren();
            if (!projects.length) {
                const empty = document.createElement('p');
                empty.className = 'layer-saved-empty';
                empty.textContent = 'No saved projects yet. Import a ZIP and final image above.';
                this.el.savedList.appendChild(empty);
                return;
            }
            projects.forEach((project) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'layer-saved-item';
                item.dataset.action = 'open-saved-project';
                item.dataset.id = project.id;
                const thumb = document.createElement('img');
                thumb.alt = '';
                if (project.referenceUrl) thumb.src = project.referenceUrl;
                const info = document.createElement('span');
                const title = document.createElement('strong');
                title.textContent = project.name || project.id;
                const detail = document.createElement('small');
                const date = project.updatedAt ? new Date(project.updatedAt) : null;
                const stamp = date && !Number.isNaN(date.getTime()) ? ` · ${date.toLocaleString()}` : '';
                detail.textContent = `${project.layerCount || 0} layers · ${project.width || '?'}×${project.height || '?'}${stamp}`;
                info.append(title, detail);
                item.append(thumb, info);
                this.el.savedList.appendChild(item);
            });
        }

        async exportCharacter(characterId) {
            const character = this.getCharacter(characterId);
            if (!character) return;
            if (Number(character.rigVersion) < 3) {
                this.setStatus('Re-open this project so its rig upgrades to v3, then export the character.', true);
                return;
            }
            const partOf = new Map();
            const ids = [];
            CHARACTER_PART_KEYS.forEach((key) => {
                (character.parts[key] || []).forEach((id) => {
                    if (!partOf.has(id)) partOf.set(id, key);
                    if (!ids.includes(id)) ids.push(id);
                });
            });
            (character.hidden || []).forEach((id) => { if (!ids.includes(id)) ids.push(id); });
            const layers = ids.map((id) => this.getLayer(id)).filter(Boolean);
            if (!layers.length) {
                this.setStatus('This character has no layers to export.', true);
                return;
            }
            this.setStatus(`Packing "${character.name}" into a character bundle…`);
            try {
                const compW = Math.max(1, this.composition.width);
                const compH = Math.max(1, this.composition.height);
                let minX = Infinity;
                let minY = Infinity;
                let maxX = -Infinity;
                let maxY = -Infinity;
                layers.forEach((layer) => {
                    minX = Math.min(minX, layer.x / 100 * compW);
                    minY = Math.min(minY, layer.y / 100 * compH);
                    maxX = Math.max(maxX, (layer.x + layer.w) / 100 * compW);
                    maxY = Math.max(maxY, (layer.y + layer.h) / 100 * compH);
                });
                const pad = Math.round(Math.max(compW, compH) * 0.03);
                const left = Math.max(0, Math.floor(minX - pad));
                const top = Math.max(0, Math.floor(minY - pad));
                const width = Math.max(16, Math.min(compW, Math.ceil(maxX + pad)) - left);
                const height = Math.max(16, Math.min(compH, Math.ceil(maxY + pad)) - top);

                const files = [];
                const encoder = new TextEncoder();
                const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
                const manifestLayers = [];
                for (let index = 0; index < layers.length; index += 1) {
                    const layer = layers[index];
                    const url = (layer.frames && layer.frames[0]) || layer.url;
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`Could not read the image for "${layer.name}".`);
                    const blob = await response.blob();
                    const extension = extensions[blob.type] || 'png';
                    const slug = String(layer.name || 'layer').toLowerCase()
                        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'layer';
                    const file = `parts/${String(index + 1).padStart(2, '0')}-${slug}.${extension}`;
                    files.push({ name: file, data: new Uint8Array(await blob.arrayBuffer()) });
                    manifestLayers.push({
                        id: layer.id,
                        file,
                        name: layer.name,
                        role: layer.role,
                        part: layer.part || partOf.get(layer.id) || '',
                        group: layer.group || '',
                        segmentGroup: layer.segmentGroup || '',
                        variant: layer.variant || '',
                        x: Number((((layer.x / 100 * compW) - left) / width * 100).toFixed(4)),
                        y: Number((((layer.y / 100 * compH) - top) / height * 100).toFixed(4)),
                        w: Number((layer.w / 100 * compW / width * 100).toFixed(4)),
                        h: Number((layer.h / 100 * compH / height * 100).toFixed(4)),
                        z: layer.z,
                        rotation: layer.rotation,
                        opacity: layer.opacity,
                        visible: layer.visible !== false,
                        fit: layer.fit,
                    });
                }

                // Optional preview: the assembled character cropped from the final image.
                let preview = null;
                const reference = this.getLayer(this.composition.referenceLayerId);
                if (reference && Math.abs(reference.x) < 0.5 && Math.abs(reference.y) < 0.5
                    && Math.abs(reference.w - 100) < 0.5 && Math.abs(reference.h - 100) < 0.5) {
                    try {
                        const image = await new Promise((resolve, reject) => {
                            const element = new Image();
                            element.onload = () => resolve(element);
                            element.onerror = () => reject(new Error('preview load failed'));
                            element.src = (reference.frames && reference.frames[0]) || reference.url;
                        });
                        const scale = image.naturalWidth / compW;
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.max(1, Math.round(width * scale));
                        canvas.height = Math.max(1, Math.round(height * scale));
                        canvas.getContext('2d').drawImage(
                            image, left * scale, top * scale, width * scale, height * scale,
                            0, 0, canvas.width, canvas.height,
                        );
                        const previewBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
                        if (previewBlob) {
                            preview = 'preview.png';
                            files.push({ name: preview, data: new Uint8Array(await previewBlob.arrayBuffer()) });
                        }
                    } catch (error) {
                        console.warn('[layer-studio] character preview skipped:', error);
                    }
                }

                const manifest = {
                    schema: 'layer-studio/character/v1',
                    name: character.name,
                    width,
                    height,
                    duration: this.composition.duration,
                    preview,
                    context: String(this.projectMeta?.context || ''),
                    layers: manifestLayers,
                    character: {
                        name: character.name,
                        parts: character.parts,
                        hidden: character.hidden || [],
                        settings: character.settings,
                        variants: character.variants || null,
                        rigVersion: 3,
                    },
                };
                files.unshift({ name: 'character.json', data: encoder.encode(JSON.stringify(manifest, null, 2)) });
                downloadFile(safeFilename(`${character.name}-character`, 'zip'), 'application/zip', buildStoredZip(files));
                this.setStatus(`Exported "${character.name}" (${layers.length} layers) as a rigged character bundle.`);
            } catch (error) {
                console.error('[layer-studio] character export failed:', error);
                this.setStatus(error.message || 'Could not export the character bundle.', true);
            }
        }

        async importCharacterBundle(file) {
            if (!file) return;
            if (!/\.zip$/i.test(file.name)) {
                this.setStatus('The character bundle must be a .zip file.', true);
                return;
            }
            this.setStatus(`Importing character bundle ${file.name}…`);
            try {
                const bundle = await this.readFileAsBase64(file);
                const result = await this.requestBackend('api/imports/character', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bundle, bundleName: file.name }),
                });
                this.openComposition(result.composition, {
                    projectId: result.project.id,
                    projectMeta: result.composition.meta,
                });
                await this.syncProjectPicker(result.project.id);
                const character = (this.composition.characters || [])[0];
                if (!character) {
                    this.setStatus('Imported the bundle, but no character rig was found.', true);
                    return;
                }
                this.updateCharacterSettings(character.id, {}, { apply: true, silent: true, render: true });
                this.setStatus(
                    `Imported rigged character "${character.name}". Blink, gaze, talk and expressions are ready in the Inspector.`,
                );
            } catch (error) {
                console.error('[layer-studio] character import failed:', error);
                this.setStatus(error.message || 'Could not import the character bundle.', true);
            }
        }

        async submitArchive() {
            const zipFile = this.el.archiveZip?.files?.[0];
            const referenceFile = this.el.archiveRef?.files?.[0];
            if (!zipFile || !referenceFile) {
                this.setArchiveStatus('Choose both the segments ZIP and the final image.', { error: true });
                return;
            }
            if (!/\.zip$/i.test(zipFile.name)
                && !['application/zip', 'application/x-zip-compressed'].includes(zipFile.type)) {
                this.setArchiveStatus('The segments file must be a .zip archive.', { error: true });
                return;
            }
            if (referenceFile.type && !referenceFile.type.startsWith('image/')) {
                this.setArchiveStatus('The final file must be an image.', { error: true });
                return;
            }
            const button = this.el.archiveSubmit;
            const label = button?.textContent;
            if (button) {
                button.disabled = true;
                button.textContent = 'Uploading…';
            }
            this.setArchiveStatus('Uploading and unpacking the archive on the backend…', { busy: true });
            try {
                const [zip, reference] = await Promise.all([
                    this.readFileAsBase64(zipFile),
                    this.readFileAsBase64(referenceFile),
                ]);
                const name = this.el.archiveName?.value.trim() || 'Imported scene';
                const result = await this.requestBackend('api/imports', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name,
                        zip,
                        zipName: zipFile.name,
                        reference,
                        referenceName: referenceFile.name,
                    }),
                });
                this.closeArchiveDialog();
                this.openComposition(result.composition, {
                    projectId: result.project.id,
                    projectMeta: result.composition.meta,
                });
                await this.syncProjectPicker(result.project.id);
                this.selectedLayerId = this.composition.referenceLayerId;
                this.render();
                const total = Math.max(0, this.composition.layers.length - 1);
                this.setStatus(
                    `Imported ${total} segment${total === 1 ? '' : 's'} into "${this.composition.name}". Aligning to the final image…`,
                );
                const alignment = await this.alignToReference({ applyAmbiguous: true, confirmExact: true });
                if (!alignment.aligned) {
                    this.setStatus(
                        `Imported ${total} segments, but no layers were auto-aligned. Adjust positions manually and press Save project.`,
                        true,
                        true,
                    );
                }
            } catch (error) {
                console.error('[layer-studio] ZIP import failed:', error);
                this.setArchiveStatus(error.message || 'Could not import the ZIP project.', { error: true });
                this.setStatus(error.message || 'Could not import the ZIP project.', true);
            } finally {
                if (button) {
                    button.disabled = false;
                    button.textContent = label || 'Import & align';
                }
            }
        }

        async openSavedProject(id) {
            if (!id) return;
            this.setArchiveStatus('Opening the saved project…', { busy: true });
            try {
                const composition = await this.requestBackend(
                    `api/imports/${encodeURIComponent(id)}/composition.json`,
                );
                this.closeArchiveDialog();
                this.openComposition(composition, {
                    projectId: id,
                    projectMeta: composition.meta || null,
                });
                await this.syncProjectPicker(id);
                this.setStatus(
                    `Opened "${this.composition.name}" (${this.composition.layers.filter((layer) => layer.rig !== true).length} layers) from the studio backend.`,
                );
            } catch (error) {
                console.error('[layer-studio] saved project open failed:', error);
                this.setArchiveStatus(error.message || 'Could not open the saved project.', { error: true });
                this.setStatus(error.message || 'Could not open the saved project.', true);
            }
        }

        setDirectorStatus(message, { error = false, busy = false } = {}) {
            if (!this.el.directorStatus) return;
            this.el.directorStatus.textContent = message || '';
            this.el.directorStatus.dataset.error = String(error);
            this.el.directorStatus.dataset.busy = String(busy);
        }

        updateProposalContext() {
            if (!this.el.proposalContext) return;
            const context = String(this.projectMeta?.context || '').trim();
            this.el.proposalContext.textContent = context
                || (this.projectId
                    ? 'No story context yet. Open the director to add tone, story, or audience.'
                    : 'Import a project to generate animation ideas.');
            this.el.proposalContext.title = context;
        }

        async loadDirectorState() {
            const projectId = this.projectId;
            if (!projectId) {
                this.proposals = [];
                this.proposalMeta = null;
                this.activeProposalId = null;
                this._proposalError = null;
                this.renderProposals();
                this.updateProposalContext();
                if (this.el.projectContext) this.el.projectContext.value = '';
                return;
            }
            try {
                const data = await this.requestBackend(
                    `api/imports/${encodeURIComponent(projectId)}/proposals`,
                );
                if (this.projectId !== projectId) return;
                if (typeof data.context === 'string') {
                    this.projectMeta = { ...(this.projectMeta || {}), context: data.context };
                    if (this.el.projectContext && document.activeElement !== this.el.projectContext) {
                        this.el.projectContext.value = data.context;
                    }
                }
                if (data.models) {
                    this.projectMeta = {
                        ...(this.projectMeta || {}),
                        director: { ...(this.projectMeta?.director || {}), ...data.models },
                    };
                }
                this.proposalMeta = data;
                this.proposals = Array.isArray(data.proposals) ? data.proposals : [];
                this._proposalError = null;
                this.renderProposals();
                this.updateProposalContext();
                if (this.el.directorDialog?.open) this.populateModelSelects();
            } catch (error) {
                if (this.projectId !== projectId) return;
                this.proposalMeta = { error: error.message };
                this.proposals = [];
                this._proposalError = error.message;
                this.renderProposals();
            }
            this.loadLlmModels().catch(() => {});
        }

        async loadLlmModels(force = false) {
            if (!force && this.llm && Date.now() - this._llmLoadedAt < 15000) {
                this.populateModelSelects();
                return this.llm;
            }
            if (this._llmPromise) return this._llmPromise;
            this._llmPromise = (async () => {
                try {
                    this.llm = await this.requestBackend('api/llm/models');
                } catch (error) {
                    this.llm = { available: false, error: error.message, models: [], defaults: {} };
                }
                this._llmLoadedAt = Date.now();
                this.populateModelSelects();
                this.renderProposals();
                return this.llm;
            })().finally(() => {
                this._llmPromise = null;
            });
            return this._llmPromise;
        }

        populateModelSelects() {
            const visionSelect = this.el.visionModel;
            const textSelect = this.el.textModel;
            if (!visionSelect || !textSelect) return;
            const models = this.llm?.models || [];
            const saved = this.projectMeta?.director || {};
            const fill = (select, list, emptyLabel, preferred) => {
                select.replaceChildren();
                if (!list.length) {
                    const option = document.createElement('option');
                    option.value = '';
                    option.textContent = emptyLabel;
                    select.appendChild(option);
                    select.disabled = true;
                    return;
                }
                select.disabled = false;
                list.forEach((model) => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = `${model.id}${model.vision ? ' · vision' : ''}${model.parameterSize ? ` · ${model.parameterSize}` : ''}`;
                    select.appendChild(option);
                });
                const desired = preferred && list.some((model) => model.id === preferred)
                    ? preferred
                    : list[0].id;
                select.value = desired;
            };
            fill(
                visionSelect,
                models.filter((model) => model.vision),
                'No vision model found',
                saved.vision || this.llm?.defaults?.vision,
            );
            fill(
                textSelect,
                [...models].sort((a, b) => Number(a.vision) - Number(b.vision) || a.id.localeCompare(b.id)),
                'No local model found',
                saved.text || this.llm?.defaults?.text,
            );
        }

        async openDirectorDialog() {
            const dialog = this.el.directorDialog;
            if (!dialog) return;
            if (!dialog.open) {
                if (typeof dialog.showModal === 'function') dialog.showModal();
                else dialog.setAttribute('open', '');
            }
            if (this.el.projectContext) this.el.projectContext.value = this.projectMeta?.context || '';
            this.setDirectorStatus('Checking local models…', { busy: true });
            await this.loadLlmModels(true);
            this.populateModelSelects();
            if (!this.projectId) {
                this.setDirectorStatus('Import or open a saved project first.', { error: true });
                return;
            }
            if (!this.llm?.available) {
                this.setDirectorStatus(
                    this.llm?.error || 'Local LLM unavailable. Start Ollama with "ollama serve".',
                    { error: true },
                );
                return;
            }
            if (!(this.llm.models || []).some((model) => model.vision)) {
                this.setDirectorStatus(
                    'No vision model installed. Run: ollama pull granite3.2-vision:2b',
                    { error: true },
                );
                return;
            }
            this.setDirectorStatus('Ready. Add story context or generate ideas.');
        }

        closeDirectorDialog() {
            if (this.el.directorDialog?.open) this.el.directorDialog.close();
        }

        async saveDirectorContext({ silent = false } = {}) {
            if (!this.projectId) {
                if (!silent) this.setDirectorStatus('Import or open a saved project first.', { error: true });
                return false;
            }
            const projectId = this.projectId;
            const context = String(
                (this.el.directorDialog?.open ? this.el.projectContext?.value : null)
                ?? this.projectMeta?.context
                ?? '',
            ).slice(0, 8000);
            const director = {
                vision: this.el.visionModel?.value || this.projectMeta?.director?.vision || '',
                text: this.el.textModel?.value || this.projectMeta?.director?.text || '',
            };
            try {
                const result = await this.requestBackend(
                    `api/imports/${encodeURIComponent(projectId)}/context`,
                    {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ context, director }),
                    },
                );
                if (this.projectId !== projectId) return false;
                this.projectMeta = {
                    ...(this.projectMeta || {}),
                    context: result?.context ?? context,
                    director: result?.director || director,
                };
                this.updateProposalContext();
                if (!silent) {
                    this.setDirectorStatus('Project context saved.');
                    this.setStatus('Project context saved.');
                }
                return true;
            } catch (error) {
                console.error('[layer-studio] context save failed:', error);
                if (!silent) {
                    this.setDirectorStatus(error.message || 'Could not save context.', { error: true });
                    this.setStatus(error.message || 'Could not save context.', true);
                }
                return false;
            }
        }

        async createVisionImage() {
            const reference = this.composition.layers.find(
                (layer) => layer.id === this.composition.referenceLayerId,
            ) || this.composition.layers[0];
            if (!reference?.url) return null;
            const image = await loadImage(reference.url);
            if (!image.naturalWidth || !image.naturalHeight) return null;
            const scale = Math.min(1, 768 / Math.max(image.naturalWidth, image.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            const context = canvas.getContext('2d');
            if (!context) return null;
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
            const comma = dataUrl.indexOf(',');
            return comma >= 0 ? dataUrl.slice(comma + 1) : null;
        }

        async generateIdeas({ fromDialog = false } = {}) {
            if (this.directorBusy) return;
            if (!this.projectId) {
                const message = 'Import or open a saved project before asking the director for ideas.';
                this.setStatus(message, true);
                this.setDirectorStatus(message, { error: true });
                return;
            }
            const projectId = this.projectId;
            this.directorBusy = true;
            this._proposalError = null;
            this.syncProjectControls();
            this.renderProposals();
            const startedAt = Date.now();
            const progress = () => {
                const seconds = Math.round((Date.now() - startedAt) / 1000);
                const message = `Analyzing the final image and writing animation ideas… ${seconds}s elapsed.`;
                this.setStatus(message);
                this.setDirectorStatus(message, { busy: true });
            };
            progress();
            this._proposalTimer = window.setInterval(progress, 15000);
            try {
                if (!this.llm?.available) await this.loadLlmModels(true);
                if (!this.llm?.available) {
                    throw new Error(this.llm?.error || 'Local LLM unavailable. Start Ollama with "ollama serve".');
                }
                const models = this.llm.models || [];
                const dialogOpen = Boolean(this.el.directorDialog?.open);
                const visionModel = (dialogOpen ? this.el.visionModel?.value : null)
                    || this.projectMeta?.director?.vision
                    || this.llm.defaults?.vision;
                const textModel = (dialogOpen ? this.el.textModel?.value : null)
                    || this.projectMeta?.director?.text
                    || this.llm.defaults?.text;
                if (!visionModel || !models.some((model) => model.id === visionModel && model.vision)) {
                    throw new Error('Choose an installed vision model. Example: ollama pull granite3.2-vision:2b');
                }
                if (!textModel || !models.some((model) => model.id === textModel)) {
                    throw new Error('Choose an installed writing model. Example: ollama pull qwen3.5:9b');
                }
                const context = String(
                    (dialogOpen ? this.el.projectContext?.value : null)
                    ?? this.projectMeta?.context
                    ?? '',
                ).trim().slice(0, 8000);
                const image = await this.createVisionImage().catch(() => null);
                this.setDirectorStatus('Analyzing the image, then writing ideas…', { busy: true });
                const body = { context, visionModel, textModel, count: 4 };
                if (image) body.image = image;
                const data = await this.requestBackend(
                    `api/imports/${encodeURIComponent(projectId)}/proposals`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    },
                );
                if (this.projectId !== projectId) return;
                this.proposals = Array.isArray(data.proposals) ? data.proposals : [];
                this.proposalMeta = data;
                this.activeProposalId = null;
                this.projectMeta = {
                    ...(this.projectMeta || {}),
                    context: data.context ?? context,
                    director: { ...(this.projectMeta?.director || {}), ...(data.models || {}) },
                };
                this.updateProposalContext();
                this.renderProposals();
                const ideaCount = this.proposals.length;
                this.setStatus(
                    `Generated ${ideaCount} animation idea${ideaCount === 1 ? '' : 's'} from the final image${this.projectMeta.context ? ' and project context' : ''}.`,
                );
                this.setDirectorStatus(`Generated ${ideaCount} ideas.`);
                if (fromDialog) {
                    window.setTimeout(() => {
                        if (this.projectId === projectId) this.closeDirectorDialog();
                    }, 250);
                }
            } catch (error) {
                console.error('[layer-studio] animation idea generation failed:', error);
                this._proposalError = error.message || 'Could not generate animation ideas.';
                this.setStatus(this._proposalError, true);
                this.setDirectorStatus(this._proposalError, { error: true });
            } finally {
                this.directorBusy = false;
                if (this._proposalTimer) {
                    window.clearInterval(this._proposalTimer);
                    this._proposalTimer = null;
                }
                this.syncProjectControls();
                this.renderProposals();
            }
        }

        renderProposals() {
            if (!this.el.proposalList || !this.el.proposalMeta) return;
            this.updateProposalContext();
            this.el.proposalList.replaceChildren();
            const hasProject = Boolean(this.projectId);
            const models = this.proposalMeta?.models || this.projectMeta?.director || null;
            let meta = 'No ideas yet';
            if (!hasProject) {
                meta = 'Open a project';
            } else if (this.directorBusy) {
                meta = 'Analyzing image…';
            } else if (this.proposals.length) {
                const modelLabel = models?.vision ? String(models.vision).split(':')[0] : '';
                meta = `${this.proposals.length} idea${this.proposals.length === 1 ? '' : 's'}${modelLabel ? ` · ${modelLabel}` : ''}`;
            } else if (this.llm && !this.llm.available) {
                meta = 'LLM offline';
            } else if (this.llm?.available) {
                meta = 'Ready';
            }
            this.el.proposalMeta.textContent = meta;

            if (!hasProject) {
                const empty = document.createElement('p');
                empty.className = 'layer-proposal-empty';
                empty.textContent = 'Import or open a project to generate animation ideas.';
                this.el.proposalList.appendChild(empty);
                return;
            }
            if (!this.proposals.length) {
                const empty = document.createElement('p');
                empty.className = 'layer-proposal-empty';
                empty.textContent = this.directorBusy
                    ? 'Analyzing the final image and writing ideas…'
                    : (this._proposalError
                        || (this.llm && !this.llm.available
                            ? (this.llm.error || 'Local LLM offline. Start Ollama with "ollama serve".')
                            : 'No ideas yet. Press Suggest animations to analyze the final image.'));
                this.el.proposalList.appendChild(empty);
                return;
            }
            this.proposals.forEach((proposal) => {
                const commands = Array.isArray(proposal.commands) ? proposal.commands : [];
                const characterSettings = Array.isArray(proposal.characters) ? proposal.characters : [];
                const card = document.createElement('article');
                card.className = 'layer-proposal-card';
                card.dataset.active = String(proposal.id === this.activeProposalId);
                card.title = proposal.description || '';

                const header = document.createElement('header');
                const title = document.createElement('h4');
                title.textContent = proposal.title || 'Animation idea';
                const badge = document.createElement('span');
                const badgeParts = [];
                if (commands.length) badgeParts.push(`${commands.length} layer${commands.length === 1 ? '' : 's'}`);
                if (characterSettings.length) badgeParts.push(`${characterSettings.length} character${characterSettings.length === 1 ? '' : 's'}`);
                badge.textContent = badgeParts.length ? badgeParts.join(' · ') : 'settings';
                header.append(title, badge);

                const description = document.createElement('p');
                description.textContent = proposal.description || '';

                const details = document.createElement('details');
                const summary = document.createElement('summary');
                const previewParts = commands.slice(0, 3)
                    .map((command) => `${command.layerName || command.layerId} · ${command.preset}`);
                characterSettings.forEach((entry) => {
                    previewParts.push(`${entry.characterName || entry.characterId} · ${entry.settings.expression}`);
                });
                summary.textContent = `${previewParts.slice(0, 3).join(', ')}${previewParts.length > 3 ? ` +${previewParts.length - 3}` : ''}`;
                details.appendChild(summary);
                const commandList = document.createElement('ul');
                commandList.className = 'layer-proposal-commands';
                commands.forEach((command) => {
                    const item = document.createElement('li');
                    const params = Object.entries(command.params || {})
                        .map(([key, value]) => `${key} ${value}`)
                        .join(' · ');
                    item.textContent = `${command.layerName || command.layerId} · ${command.preset}${params ? ` · ${params}` : ''}`;
                    commandList.appendChild(item);
                });
                characterSettings.forEach((entry) => {
                    const item = document.createElement('li');
                    const settings = entry.settings || {};
                    const extras = [
                        settings.blink ? 'blink' : '',
                        settings.talk ? 'talk' : '',
                        settings.gazeX || settings.gazeY ? 'gaze' : '',
                    ].filter(Boolean).join(' · ');
                    item.textContent = `${entry.characterName || entry.characterId} · ${settings.expression}${extras ? ` · ${extras}` : ''}`;
                    commandList.appendChild(item);
                });
                details.appendChild(commandList);

                const apply = document.createElement('button');
                apply.type = 'button';
                apply.className = 'layer-proposal-apply';
                apply.dataset.action = 'apply-proposal';
                apply.dataset.id = proposal.id;
                apply.textContent = proposal.id === this.activeProposalId ? 'Applied' : 'Apply';
                apply.disabled = this.directorBusy;

                card.append(header, description, details, apply);
                this.el.proposalList.appendChild(card);
            });
        }

        applyProposal(id) {
            const proposal = this.proposals.find((item) => item.id === id);
            if (!proposal) return;
            this.activeProposalId = id;
            const commands = Array.isArray(proposal.commands) ? [...proposal.commands] : [];
            const characterCommands = (Array.isArray(proposal.characters) ? proposal.characters : [])
                .map((entry) => ({ characterId: entry.characterId, settings: entry.settings }));
            this.applyAgentCommands([...commands, ...characterCommands]);
            this.renderProposals();
            const layers = commands.length;
            const characters = characterCommands.length;
            const appliedParts = [];
            if (layers) appliedParts.push(`${layers} layer${layers === 1 ? '' : 's'}`);
            if (characters) appliedParts.push(`${characters} character${characters === 1 ? '' : 's'}`);
            this.setStatus(`Applied "${proposal.title}"${appliedParts.length ? ` to ${appliedParts.join(' and ')}` : ''}.`);
            this.scheduleSave();
        }

        resetAnimations() {
            if (!this.projectId) return;
            const hasKeyframes = this.composition.layers.some((layer) => layer.keyframes.length > 0);
            if (hasKeyframes && !window.confirm('Clear all animation keyframes from this composition?')) return;
            this.composition.layers.forEach((layer) => { layer.keyframes = []; });
            this.activeProposalId = null;
            this.render();
            this.scheduleSave();
            this.setStatus('All animation keyframes cleared.');
        }

        exportJson() {
            const data = JSON.stringify({ ...this.composition, version: 1 }, null, 2);
            downloadFile(safeFilename(this.composition.name, 'json'), 'application/json', data);
            this.setStatus('Composition JSON downloaded.');
        }

        setExportProgress(message, percent = null) {
            if (!this.el.exportProgress) return;
            this.el.exportProgress.hidden = false;
            this.el.exportProgress.textContent = percent === null
                ? message
                : `${message} ${Math.round(percent)}%`;
        }

        createExportSnapshot() {
            return {
                ...this.composition,
                layers: this.composition.layers.map((layer) => ({
                    ...layer,
                    keyframes: (layer.keyframes || []).map((frame) => ({ ...frame })),
                })),
            };
        }

        async loadExportAssets(composition, maxAssetEdge, outputEdge, totalPixelBudget) {
            const visible = composition.layers.filter((layer) => layer.visible);
            if (!visible.length) throw new Error('Show at least one layer before exporting.');
            const perLayerPixelBudget = Math.max(1, Math.floor(totalPixelBudget / visible.length));
            const assets = new Map();
            for (let index = 0; index < visible.length; index += 1) {
                const layer = visible[index];
                const frameUrls = Array.isArray(layer.frames) && layer.frames.length ? layer.frames : [layer.url];
                const loadedFrames = [];
                for (const frameUrl of frameUrls) {
                    const image = await loadImage(frameUrl);
                    if (!image.naturalWidth || !image.naturalHeight) {
                        throw new Error(`Layer "${layer.name}" has no usable image dimensions.`);
                    }
                    if (!hasLayerEffects(layer)) {
                        loadedFrames.push(image);
                        continue;
                    }
                    const sourceWidth = image.naturalWidth;
                    const sourceHeight = image.naturalHeight;
                    const scale = Math.min(
                        1,
                        maxAssetEdge / Math.max(sourceWidth, sourceHeight),
                        Math.sqrt(perLayerPixelBudget / (sourceWidth * sourceHeight)),
                    );
                    const width = Math.max(1, Math.round(sourceWidth * scale));
                    const height = Math.max(1, Math.round(sourceHeight * scale));
                    const sourceCanvas = document.createElement('canvas');
                    sourceCanvas.width = width;
                    sourceCanvas.height = height;
                    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
                    if (!sourceContext) throw new Error('This browser could not create an image-processing canvas.');
                    sourceContext.drawImage(image, 0, 0, width, height);
                    let sourceData;
                    try {
                        sourceData = sourceContext.getImageData(0, 0, width, height);
                    } catch (error) {
                        throw new Error(`Layer "${layer.name}" cannot be processed because its image blocks canvas access: ${error.message}`);
                    }
                    if (layer.recolorEnabled) {
                        const color = layer.recolorColor.match(/[0-9a-f]{2}/gi).map((channel) => parseInt(channel, 16));
                        for (let offset = 0; offset < sourceData.data.length; offset += 4) {
                            if (sourceData.data[offset + 3] === 0) continue;
                            sourceData.data[offset] = color[0];
                            sourceData.data[offset + 1] = color[1];
                            sourceData.data[offset + 2] = color[2];
                        }
                        sourceContext.putImageData(sourceData, 0, 0);
                    }
                    if (!layer.outlineEnabled) {
                        loadedFrames.push(sourceCanvas);
                        continue;
                    }
                    const alpha = new Uint8Array(width * height);
                    for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = sourceData.data[pixel * 4 + 3];
                    const outputScale = outputEdge / Math.max(composition.width, composition.height);
                    const displayedWidth = layer.w * composition.width / 100;
                    const radius = clamp(Math.round(layer.outlineWidth * outputScale * width / displayedWidth), 1, 32);
                    const expanded = dilateAlpha(alpha, width, height, radius);
                    const outputCanvas = document.createElement('canvas');
                    outputCanvas.width = width;
                    outputCanvas.height = height;
                    const outputContext = outputCanvas.getContext('2d');
                    if (!outputContext) throw new Error('This browser could not create the outline canvas.');
                    const outlineData = outputContext.createImageData(width, height);
                    const outlineColor = layer.outlineColor.match(/[0-9a-f]{2}/gi).map((channel) => parseInt(channel, 16));
                    for (let pixel = 0; pixel < expanded.length; pixel += 1) {
                        const offset = pixel * 4;
                        outlineData.data[offset] = outlineColor[0];
                        outlineData.data[offset + 1] = outlineColor[1];
                        outlineData.data[offset + 2] = outlineColor[2];
                        outlineData.data[offset + 3] = expanded[pixel];
                    }
                    outputContext.putImageData(outlineData, 0, 0);
                    outputContext.drawImage(sourceCanvas, 0, 0);
                    loadedFrames.push(outputCanvas);
                }
                assets.set(layer.id, loadedFrames.length === 1 ? loadedFrames[0] : loadedFrames);
                this.setExportProgress(`Preparing layer assets (${index + 1}/${visible.length})…`);
            }
            return assets;
        }

        renderExportFrame(context, composition, assets, time, outputWidth, outputHeight) {
            context.save();
            context.globalAlpha = 1;
            if (composition.exportBackground !== null) {
                context.fillStyle = composition.exportBackground || '#ffffff';
                context.fillRect(0, 0, outputWidth, outputHeight);
            }
            const layers = composition.layers.filter((layer) => layer.visible).sort((a, b) => {
                if (a.id === composition.referenceLayerId) return -1;
                if (b.id === composition.referenceLayerId) return 1;
                return a.z - b.z;
            });
            layers.forEach((layer) => {
                const asset = assets.get(layer.id);
                if (!asset) return;
                const state = this.getLayerStateAtTime(layer, time);
                const image = Array.isArray(asset) ? (asset[state.frameIndex] || asset[0]) : asset;
                if (!image) return;
                const x = state.x * composition.width / 100 * outputWidth / composition.width;
                const y = state.y * composition.height / 100 * outputHeight / composition.height;
                const width = state.w * composition.width / 100 * outputWidth / composition.width;
                const height = state.h * composition.height / 100 * outputHeight / composition.height;
                const centerX = x + width / 2;
                const centerY = y + height / 2;
                context.save();
                context.globalAlpha = state.opacity;
                context.translate(centerX, centerY);
                context.rotate(state.rotation * Math.PI / 180);
                const sourceWidth = image.naturalWidth || image.width;
                const sourceHeight = image.naturalHeight || image.height;
                if (layer.fit === 'cover') {
                    const targetRatio = width / height;
                    const sourceRatio = sourceWidth / sourceHeight;
                    let sourceX = 0;
                    let sourceY = 0;
                    let cropWidth = sourceWidth;
                    let cropHeight = sourceHeight;
                    if (sourceRatio > targetRatio) {
                        cropWidth = sourceHeight * targetRatio;
                        sourceX = (sourceWidth - cropWidth) / 2;
                    } else {
                        cropHeight = sourceWidth / targetRatio;
                        sourceY = (sourceHeight - cropHeight) / 2;
                    }
                    context.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, -width / 2, -height / 2, width, height);
                } else {
                    const scale = Math.min(width / sourceWidth, height / sourceHeight);
                    const drawWidth = sourceWidth * scale;
                    const drawHeight = sourceHeight * scale;
                    context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
                }
                context.restore();
            });
            context.restore();
        }

        async exportAllSegments(groups) {
            const entries = (Array.isArray(groups) ? groups : []).flatMap((group) => (
                (Array.isArray(group.items) ? group.items : []).map((layer, index) => ({
                    group: group.label,
                    layer,
                }))
            ));
            try {
                if (!entries.length) throw new Error('There are no segments to download.');
                this.setStatus(`Packing ${entries.length} segments into a ZIP archive…`);
                const extensions = {
                    'image/png': 'png',
                    'image/jpeg': 'jpg',
                    'image/webp': 'webp',
                    'image/gif': 'gif',
                };
                const files = [];
                for (let index = 0; index < entries.length; index += 1) {
                    const { group, layer } = entries[index];
                    const url = (layer.frames && layer.frames[0]) || layer.url;
                    const response = await fetch(url);
                    if (!response.ok) {
                        throw new Error(`Could not read the image for "${layer.name}" (${response.status}).`);
                    }
                    const blob = await response.blob();
                    const extension = extensions[blob.type] || 'png';
                    const groupFolder = safeFilename(group || 'segments', 'zip').replace(/\.zip$/, '');
                    const layerName = safeFilename(layer.name || `segment-${index + 1}`, extension);
                    files.push({
                        name: `${groupFolder}/${String(index + 1).padStart(3, '0')}-${layerName}`,
                        data: new Uint8Array(await blob.arrayBuffer()),
                    });
                    this.setStatus(`Packing segment images (${index + 1}/${entries.length})…`);
                }
                const archive = buildStoredZip(files);
                const archiveName = safeFilename(`${this.composition.name}-segments`, 'zip');
                downloadFile(archiveName, 'application/zip', archive);
                this.setStatus(`Downloaded ${entries.length} segment images in ${new Set(entries.map((entry) => entry.group)).size} folders.`);
            } catch (error) {
                console.error('[layer-studio] all-segment ZIP export failed:', error);
                this.setStatus(error.message || 'Could not package the segment images.', true);
                return false;
            }
            return true;
        }

        async exportSegmentGroup(groupKey) {
            const layers = this.composition.layers.filter((layer) => (
                layer.rig !== true
                && layer.id !== this.composition.referenceLayerId
                && layer.visible
                && String(layer.name).replace(/[\s_-]*\d+$/, '').trim().toLowerCase() === groupKey
            ));
            if (!layers.length) throw new Error('Show at least one segment in this group before downloading it.');
            const reference = this.getLayer(this.composition.referenceLayerId);
            const outputScale = Math.min(
                1,
                4096 / Math.max(this.composition.width, this.composition.height),
                Math.sqrt(24_000_000 / (this.composition.width * this.composition.height)),
            );
            const outputWidth = Math.max(1, Math.round(this.composition.width * outputScale));
            const outputHeight = Math.max(1, Math.round(this.composition.height * outputScale));
            const groupSnapshot = {
                ...this.createExportSnapshot(),
                exportBackground: null,
                layers: [
                    ...layers,
                    ...(reference ? [{ ...reference, visible: false }] : []),
                ],
            };
            const withReferenceSnapshot = {
                ...groupSnapshot,
                exportBackground: null,
                layers: [
                    ...layers,
                    ...(reference ? [{ ...reference, visible: true }] : []),
                ],
            };
            const assets = await this.loadExportAssets(
                withReferenceSnapshot,
                4096,
                Math.max(outputWidth, outputHeight),
                24_000_000,
            );
            const exportPng = (snapshot, background) => {
                const canvas = document.createElement('canvas');
                canvas.width = outputWidth;
                canvas.height = outputHeight;
                const context = canvas.getContext('2d', { alpha: background === null });
                if (!context) throw new Error('This browser could not create an image export canvas.');
                this.renderExportFrame(context, { ...snapshot, exportBackground: background }, assets,
                    this.animation.currentTime, outputWidth, outputHeight);
                return new Promise((resolve, reject) => {
                    canvas.toBlob((blob) => {
                        if (blob) resolve(blob);
                        else reject(new Error('Could not encode the segment group as PNG.'));
                    }, 'image/png');
                });
            };
            const label = groupKey.replace(/(^|-)\w/g, (match) => match.toUpperCase());
            const base = `${this.composition.name}-${label}`;
            const [transparent, withFinal] = await Promise.all([
                exportPng(groupSnapshot, null),
                exportPng(withReferenceSnapshot, '#ffffff'),
            ]);
            downloadFile(safeFilename(`${base}-transparent`, 'png'), 'image/png', transparent);
            window.setTimeout(() => {
                downloadFile(safeFilename(`${base}-with-final`, 'png'), 'image/png', withFinal);
            }, 180);
            this.setStatus(`Downloaded "${label}" as transparent and with-final PNG images.`);
        }

        beginExport() {
            if (this.animation.isExporting) throw new Error('An animation export is already running.');
            this.stopPlayback();
            this.animation.isExporting = true;
            this.renderAnimationControls();
            this.setExportProgress('Preparing export…');
        }

        finishExport() {
            this.animation.isExporting = false;
            this.renderAnimationControls();
        }

        ensureExportAnimation() {
            const hasMotion = (this.composition.layers || [])
                .some((layer) => (layer.keyframes || []).length > 1);
            if (hasMotion) return true;
            const character = (this.composition.characters || []).find((item) => (
                Number(item.rigVersion) >= 3
                && ((item.parts?.face || []).length || (item.parts?.eyes || []).length)
            ));
            if (!character) return false;
            this.updateCharacterSettings(character.id, {}, { apply: true, silent: true });
            this.setStatus(`No keyframes found — animated ${character.name} for export.`);
            return true;
        }

        async exportVideo() {
            if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
                throw new Error('Video export is not supported by this browser.');
            }
            const animated = this.ensureExportAnimation();
            const snapshot = this.createExportSnapshot();
            const mimeTypes = [
                'video/mp4',
                'video/webm;codecs=vp9',
                'video/webm;codecs=vp8',
                'video/webm',
            ];
            const mimeType = typeof MediaRecorder.isTypeSupported === 'function'
                ? mimeTypes.find((type) => MediaRecorder.isTypeSupported(type))
                : 'video/webm';
            if (!mimeType) throw new Error('This browser has no supported MP4 or WebM video encoder.');
            this.beginExport();
            const fps = 30;
            const duration = snapshot.duration;
            const totalFrames = Math.ceil(duration * fps / 1000);
            const scale = Math.min(1, 1920 / Math.max(snapshot.width, snapshot.height));
            const outputWidth = Math.max(2, Math.round(snapshot.width * scale));
            const outputHeight = Math.max(2, Math.round(snapshot.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = outputWidth;
            canvas.height = outputHeight;
            const context = canvas.getContext('2d', { alpha: false });
            if (!context) {
                this.finishExport();
                throw new Error('This browser could not create a video export canvas.');
            }
            let stream = null;
            let recorder = null;
            try {
                const assets = await this.loadExportAssets(snapshot, 2048, Math.max(outputWidth, outputHeight), 12_000_000);
                stream = canvas.captureStream(fps);
                recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
                const chunks = [];
                const recorded = new Promise((resolve, reject) => {
                    recorder.addEventListener('dataavailable', (event) => {
                        if (event.data.size) chunks.push(event.data);
                    });
                    recorder.addEventListener('error', (event) => reject(event.error || new Error('The browser video encoder failed.')));
                    recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: mimeType })), { once: true });
                });
                recorder.start();
                for (let frame = 0; frame < totalFrames; frame += 1) {
                    const time = frame * 1000 / fps;
                    this.renderExportFrame(context, snapshot, assets, time, outputWidth, outputHeight);
                    this.setExportProgress('Rendering video…', (frame + 1) / totalFrames * 100);
                    await new Promise((resolve) => window.setTimeout(resolve, 1000 / fps));
                }
                recorder.stop();
                const blob = await recorded;
                if (!blob.size) throw new Error('The browser video encoder produced an empty file.');
                const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
                downloadBlob(safeFilename(snapshot.name, extension), blob);
                this.setExportProgress(`${extension.toUpperCase()} export complete.`);
                this.setStatus(
                    animated
                        ? `${extension.toUpperCase()} animation downloaded.`
                        : `${extension.toUpperCase()} exported as a still image — animate a character or add keyframes for motion.`,
                    !animated,
                );
            } catch (error) {
                if (recorder && recorder.state !== 'inactive') recorder.stop();
                throw error;
            } finally {
                if (stream) stream.getTracks().forEach((track) => track.stop());
                this.finishExport();
            }
        }

        async exportGif() {
            const animated = this.ensureExportAnimation();
            const snapshot = this.createExportSnapshot();
            this.beginExport();
            const scale = Math.min(1, 480 / Math.max(snapshot.width, snapshot.height));
            const outputWidth = Math.max(2, Math.round(snapshot.width * scale));
            const outputHeight = Math.max(2, Math.round(snapshot.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = outputWidth;
            canvas.height = outputHeight;
            const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
            if (!context) {
                this.finishExport();
                throw new Error('This browser could not create a GIF export canvas.');
            }
            try {
                const assets = await this.loadExportAssets(snapshot, 1024, Math.max(outputWidth, outputHeight), 12_000_000);
                const frameDelay = 100;
                const totalFrames = Math.ceil(snapshot.duration / frameDelay);
                const encoder = new GifEncoder(outputWidth, outputHeight);
                for (let frame = 0; frame < totalFrames; frame += 1) {
                    this.renderExportFrame(context, snapshot, assets, frame * frameDelay, outputWidth, outputHeight);
                    let imageData;
                    try {
                        imageData = context.getImageData(0, 0, outputWidth, outputHeight);
                    } catch (error) {
                        throw new Error(`GIF export cannot read the rendered pixels, likely because an image blocks canvas access: ${error.message}`);
                    }
                    encoder.addFrame(imageData, frameDelay);
                    this.setExportProgress('Rendering GIF…', (frame + 1) / totalFrames * 100);
                    await new Promise((resolve) => window.setTimeout(resolve, 0));
                }
                const blob = encoder.finish();
                const validationUrl = URL.createObjectURL(blob);
                try {
                    await new Promise((resolve, reject) => {
                        const image = new Image();
                        image.onload = resolve;
                        image.onerror = () => reject(new Error('The generated GIF could not be decoded by this browser.'));
                        image.src = validationUrl;
                    });
                } finally {
                    URL.revokeObjectURL(validationUrl);
                }
                downloadBlob(safeFilename(snapshot.name, 'gif'), blob);
                this.setExportProgress('GIF export complete.');
                this.setStatus(
                    animated
                        ? 'GIF animation downloaded.'
                        : 'GIF exported as a still image — animate a character or add keyframes for motion.',
                    !animated,
                );
            } finally {
                this.finishExport();
            }
        }

        async exportImage() {
            const snapshot = this.createExportSnapshot();
            snapshot.layers = snapshot.layers
                .filter((layer) => !this.isReferenceLayer(layer))
                .map((layer) => ({ ...layer, visible: true }));
            if (!snapshot.layers.length) {
                throw new Error('Add at least one composition layer before exporting an image.');
            }
            const outputScale = Math.min(
                1,
                4096 / Math.max(snapshot.width, snapshot.height),
                Math.sqrt(24_000_000 / (snapshot.width * snapshot.height)),
            );
            const outputWidth = Math.max(1, Math.round(snapshot.width * outputScale));
            const outputHeight = Math.max(1, Math.round(snapshot.height * outputScale));
            const canvas = document.createElement('canvas');
            canvas.width = outputWidth;
            canvas.height = outputHeight;
            const context = canvas.getContext('2d', { alpha: snapshot.exportBackground === null });
            if (!context) throw new Error('This browser could not create an image export canvas.');
            this.beginExport();
            try {
                const assets = await this.loadExportAssets(
                    snapshot,
                    4096,
                    Math.max(outputWidth, outputHeight),
                    24_000_000,
                );
                this.renderExportFrame(context, snapshot, assets, this.animation.currentTime, outputWidth, outputHeight);
                this.setExportProgress('Encoding PNG…');
                const blob = await new Promise((resolve, reject) => {
                    canvas.toBlob((result) => {
                        if (result) resolve(result);
                        else reject(new Error('Could not encode the composition image as PNG.'));
                    }, 'image/png');
                });
                downloadBlob(safeFilename(snapshot.name, 'png'), blob);
                this.setExportProgress('PNG export complete.');
                this.setStatus('Composition image downloaded with all layers visible and the final image excluded.');
            } finally {
                this.finishExport();
            }
        }

        exportSvg() {
            const { width, height, layers } = this.composition;
            const visibleLayers = [...layers]
                .filter((layer) => layer.visible)
                .sort((a, b) => {
                    if (a.id === this.composition.referenceLayerId) return -1;
                    if (b.id === this.composition.referenceLayerId) return 1;
                    return a.z - b.z;
                });
            const filters = visibleLayers.map(layerEffectFilterMarkup).filter(Boolean).join('\n  ');
            const images = visibleLayers.map((layer) => {
                const x = layer.x * width / 100;
                const y = layer.y * height / 100;
                const w = layer.w * width / 100;
                const h = layer.h * height / 100;
                const cx = x + w / 2;
                const cy = y + h / 2;
                const fit = layer.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
                const filter = hasLayerEffects(layer) ? ` filter="url(#${layerFilterId(layer)})"` : '';
                return `<image href="${escapeXml(layer.url)}" x="${x}" y="${y}" width="${w}" height="${h}" opacity="${layer.opacity}" preserveAspectRatio="${fit}"${filter} transform="rotate(${layer.rotation} ${cx} ${cy})"/>`;
            }).join('\n  ');
            const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${filters ? `  <defs>\n  ${filters}\n  </defs>\n` : ''}  ${images}\n</svg>\n`;
            downloadFile(safeFilename(this.composition.name, 'svg'), 'image/svg+xml', svg);
            this.setStatus('SVG composition downloaded.');
        }
    }

    let studio = null;
    let mainDisplay = '';
    const chatDisplay = new Map();

    function layerStudioShowView() {
        const root = document.getElementById('layerStudioView');
        if (!root || root.classList.contains('active')) return;
        SIBLING_HIDE.forEach((name) => {
            if (typeof window[name] === 'function') window[name]();
        });
        const main = document.querySelector('.main-content');
        if (main) {
            mainDisplay = main.style.display;
            main.style.display = 'none';
        }
        CHAT_IDS.forEach((id) => {
            const element = document.getElementById(id);
            if (!element) return;
            chatDisplay.set(id, element.style.display);
            element.style.display = 'none';
        });
        if (!studio || studio.root !== root) {
            studio = new LayerStudio(root);
            window.layerStudio = studio;
        }
        root.classList.add('active');
        studio.render();
    }

    function layerStudioHideView() {
        const root = document.getElementById('layerStudioView');
        if (!root || !root.classList.contains('active')) return;
        studio?.stopPlayback();
        if (studio?.el.archiveDialog?.open) studio.el.archiveDialog.close();
        if (studio?.el.directorDialog?.open) studio.el.directorDialog.close();
        root.classList.remove('active');
        studio?._ctrl?.cancel();
        const main = document.querySelector('.main-content');
        if (main) main.style.display = mainDisplay;
        CHAT_IDS.forEach((id) => {
            const element = document.getElementById(id);
            if (element && chatDisplay.has(id)) element.style.display = chatDisplay.get(id);
        });
        chatDisplay.clear();
    }

    window.LayerStudio = LayerStudio;
    window.layerStudioShowView = layerStudioShowView;
    window.layerStudioHideView = layerStudioHideView;

    SIBLING_SHOW.forEach((name) => {
        const original = window[name];
        if (typeof original !== 'function' || original._layerStudioWrapped) return;
        const wrapped = function (...args) {
            layerStudioHideView();
            return original.apply(this, args);
        };
        wrapped._layerStudioWrapped = true;
        window[name] = wrapped;
    });
})();