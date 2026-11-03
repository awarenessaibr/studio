'use strict';
/**
 * agent-commands.js — the v2 agent command contract (`layer-studio/agent-commands/v2`).
 *
 * This is the editor half of the contract described in
 * improvements/layer-studio-agent-commands.schema.json:
 *
 *   validateBatch()        schema checks, no side effects
 *   applyBatch()           sequential apply to a *copy* of the composition
 *   finalizeBatch()        post-apply guardrails (needs measured bounds)
 *   createSnapshot()       what the editor sends the agent before it plans
 *   measureBounds()        rendered rectangles, overflow and optional contrast
 *   proposeLayoutVariants() five deterministic concepts for the current scene
 *   presetKeyframes()      the single animation-preset implementation
 *
 * Percent values are relative to the format canvas (x/w to width, y/h to
 * height). Font sizePct is relative to canvas HEIGHT. Commands are applied
 * sequentially, so a later command sees the result of an earlier one.
 *
 * Loaded as a plain <script> after studio-core.js, and require()-able in Node.
 */
(function (root, factory) {
    const Core = (typeof module === 'object' && module.exports)
        ? require('./studio-core.js')
        : root.StudioCore;
    const api = factory(Core);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.AgentCommands = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
    // ---------------------------------------------------------------------
    // Vocabulary
    // ---------------------------------------------------------------------
    const SCHEMA_ID = 'layer-studio/agent-commands/v2';
    const MAX_COMMANDS = 100;
    const MAX_LAYERS = 400;
    const LAYER_ID = /^[a-z0-9][a-z0-9-_]{0,63}$/;
    const FORMAT_ID = /^[a-z0-9-]{1,32}$/;
    const HEX = /^#[0-9a-f]{6}$/i;
    const RGBA = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
    const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
    const COMMAND_TYPES = [
        'set-variable', 'set-layer', 'add-layer', 'remove-layer', 'duplicate-layer',
        'reorder-layer', 'swap-asset', 'set-animation', 'set-keyframes',
        'clear-animation', 'set-format', 'set-scene-duration',
    ];
    const PRESETS = [
        'breathe', 'idle', 'sway', 'walk', 'float', 'flicker', 'drift', 'pulse',
        'fadeIn', 'parallax', 'fadeOut', 'zoom', 'spin', 'shake', 'hop', 'swing',
        'orbit', 'nod', 'blinkIn', 'none',
    ];
    const EASING = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step'];
    const KEYFRAME_VALUES = ['x', 'y', 'w', 'h', 'rotation', 'opacity', 'scale'];
    const LOOPING_PRESETS = new Set(['breathe', 'idle', 'sway', 'float', 'pulse', 'parallax', 'spin', 'swing', 'orbit', 'nod']);
    // The renderer only knows image and text layers. Shapes and gradients are
    // desugared into self-contained SVG images so every exporter already works.
    const ROLE_MAP = { background: 'background', foreground: 'foreground' };

    const DEFAULT_RULES = {
        SAFE_ZONE: 'block',
        TEXT_OVERFLOW: 'block',
        BRAND_COLOR: 'warn',
        BRAND_FONT: 'block',
        CONTRAST: 'warn',
        MIN_TEXT_SIZE: 'warn',
        LOGO_INTEGRITY: 'block',
        LOCKED_LAYER: 'block',
        NO_INVENTED_FACTS: 'block',
    };

    const PATCH_RULES = {
        name: { kind: 'string', max: 80 },
        x: { kind: 'number', min: -100, max: 200 },
        y: { kind: 'number', min: -100, max: 200 },
        w: { kind: 'number', min: 0, max: 200, exclusiveMin: 0 },
        h: { kind: 'number', min: 0, max: 200, exclusiveMin: 0 },
        z: { kind: 'integer', min: 0, max: 999 },
        rotation: { kind: 'number', min: -360, max: 360 },
        opacity: { kind: 'number', min: 0, max: 1 },
        visible: { kind: 'boolean' },
        fit: { kind: 'enum', values: ['cover', 'contain', 'fill'] },
        recolorEnabled: { kind: 'boolean' },
        recolorColor: { kind: 'color' },
        outlineEnabled: { kind: 'boolean' },
        outlineColor: { kind: 'color' },
        outlineWidth: { kind: 'number', min: 0, max: 40 },
        text: { kind: 'string', max: 2000 },
        color: { kind: 'color' },
        align: { kind: 'enum', values: ['left', 'center', 'right'] },
        verticalAlign: { kind: 'enum', values: ['top', 'middle', 'bottom'] },
        overflow: { kind: 'enum', values: ['clip', 'visible'] },
        font: { kind: 'font' },
    };
    const TEXT_ONLY_FIELDS = ['text', 'color', 'align', 'verticalAlign', 'overflow', 'font'];
    const IMAGE_ONLY_FIELDS = ['fit', 'recolorEnabled', 'recolorColor', 'outlineEnabled', 'outlineColor', 'outlineWidth'];

    const FONT_RULES = {
        family: { kind: 'string', max: 80 },
        weight: { kind: 'integer', min: 100, max: 900 },
        style: { kind: 'enum', values: ['normal', 'italic'] },
        sizePct: { kind: 'number', min: 0.4, max: 20 },
        lineHeight: { kind: 'number', min: 0.8, max: 2.5 },
        letterSpacingEm: { kind: 'number', min: -0.1, max: 1 },
        transform: { kind: 'enum', values: ['none', 'uppercase', 'lowercase', 'capitalize'] },
    };

    // ---------------------------------------------------------------------
    // Small helpers
    // ---------------------------------------------------------------------
    const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const round = (value, places = 2) => {
        const factor = 10 ** places;
        return Math.round(Number(value) * factor) / factor;
    };
    const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

    // Presets that scatter frames (flicker) must stay reproducible, so they draw
    // from a PRNG seeded by the layer's geometry instead of Math.random().
    function seededRandom(seed) {
        const text = String(seed);
        let state = 0;
        for (let i = 0; i < text.length; i += 1) state = (Math.imul(state, 31) + text.charCodeAt(i)) >>> 0;
        return () => {
            state = (state + 0x6d2b79f5) >>> 0;
            let t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function clone(value) {
        return typeof structuredClone === 'function'
            ? structuredClone(value)
            : JSON.parse(JSON.stringify(value));
    }

    function issue(code, message, extra) {
        const result = { code, message };
        if (extra && extra.commandIndex !== undefined) result.commandIndex = extra.commandIndex;
        if (extra && extra.layerId) result.layerId = extra.layerId;
        if (extra && extra.suggestion) result.suggestion = extra.suggestion;
        return result;
    }

    function revisionOf(composition) {
        return Math.max(0, Math.round(finite(composition && composition.revision, 0)));
    }

    function formatOf(composition, formatId) {
        const formats = Array.isArray(composition.formats) ? composition.formats : [];
        const wanted = formatId || 'master';
        return formats.find((format) => format.id === wanted)
            || formats.find((format) => format.isMaster)
            || { id: 'master', width: composition.width, height: composition.height, layerOverrides: {} };
    }

    function isMasterFormat(format) {
        return !format || format.isMaster === true || format.id === 'master';
    }

    function getLayerById(composition, id) {
        return (composition.layers || []).find((layer) => layer.id === id) || null;
    }

    function normalizeColor(value, composition) {
        if (typeof value !== 'string') return null;
        const text = value.trim();
        if (HEX.test(text)) return text.toLowerCase();
        if (RGBA.test(text)) return text.replace(/\s+/g, '');
        const palette = (composition && composition.brandKit && composition.brandKit.palette) || [];
        const key = text.toLowerCase();
        const exact = palette.find((entry) => String(entry.name).trim().toLowerCase() === key);
        if (exact && HEX.test(exact.hex)) return String(exact.hex).toLowerCase();
        const loose = key.replace(/[^a-z0-9]/g, '');
        const fuzzy = palette.find((entry) => String(entry.name).toLowerCase().replace(/[^a-z0-9]/g, '') === loose);
        return fuzzy && HEX.test(fuzzy.hex) ? String(fuzzy.hex).toLowerCase() : null;
    }

    function parseColor(value) {
        if (typeof value !== 'string') return null;
        const text = value.trim();
        if (HEX.test(text)) {
            return [1, 3, 5].map((index) => parseInt(text.slice(index, index + 2), 16)).concat(1);
        }
        const match = text.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+)\s*)?\)$/i);
        if (!match) return null;
        return [
            clamp(Number(match[1]), 0, 255),
            clamp(Number(match[2]), 0, 255),
            clamp(Number(match[3]), 0, 255),
            match[4] === undefined ? 1 : clamp(Number(match[4]), 0, 1),
        ];
    }

    function colorToCss(value) {
        const rgba = parseColor(value);
        if (!rgba) return '#000000';
        const [r, g, b, a] = rgba.map((channel, index) => (index < 3 ? Math.round(channel) : channel));
        return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${round(a, 3)})`;
    }

    function relativeLuminance(rgb) {
        const channel = (value) => {
            const v = value / 255;
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    }

    function contrastRatio(foreground, background) {
        const fg = parseColor(foreground);
        const bg = parseColor(background);
        if (!fg || !bg) return null;
        const a = relativeLuminance(fg);
        const b = relativeLuminance(bg);
        const light = Math.max(a, b);
        const dark = Math.min(a, b);
        return round((light + 0.05) / (dark + 0.05));
    }

    // ---------------------------------------------------------------------
    // Schema validation
    // ---------------------------------------------------------------------
    function validateBatch(batch) {
        const issues = [];
        const add = (message, extra) => issues.push(issue('SCHEMA', message, extra));
        if (!isObject(batch)) {
            add('A command batch must be an object.');
            return issues;
        }
        const topLevel = [
            'schema', 'sceneId', 'baseRevision', 'formatId', 'label', 'rationale', 'atomic', 'commands',
        ];
        Object.keys(batch).forEach((key) => {
            if (!topLevel.includes(key)) add(`Unknown batch field "${key}".`);
        });
        if (batch.schema !== SCHEMA_ID) add(`"schema" must be "${SCHEMA_ID}".`);
        if (typeof batch.sceneId !== 'string') add('"sceneId" must be a string.');
        if (!Number.isInteger(batch.baseRevision) || batch.baseRevision < 0) {
            add('"baseRevision" must be a non-negative integer.');
        }
        if (batch.formatId !== undefined && typeof batch.formatId !== 'string') {
            add('"formatId" must be a string.');
        }
        if (batch.label !== undefined && (typeof batch.label !== 'string' || batch.label.length > 80)) {
            add('"label" must be a string of at most 80 characters.');
        }
        if (batch.rationale !== undefined && (typeof batch.rationale !== 'string' || batch.rationale.length > 600)) {
            add('"rationale" must be a string of at most 600 characters.');
        }
        if (batch.atomic !== undefined && typeof batch.atomic !== 'boolean') {
            add('"atomic" must be a boolean.');
        }
        if (!Array.isArray(batch.commands) || !batch.commands.length) {
            add('"commands" must be a non-empty array.');
        } else if (batch.commands.length > MAX_COMMANDS) {
            issues.push(issue('LIMIT_EXCEEDED', `A batch carries at most ${MAX_COMMANDS} commands.`));
        } else {
            batch.commands.forEach((command, index) => validateCommand(command, index, issues));
        }
        return issues;
    }

    function validateCommand(command, index, issues) {
        const add = (message, extra) => issues.push(issue('SCHEMA', message, { commandIndex: index, ...extra }));
        if (!isObject(command)) {
            add(`Command ${index} must be an object.`);
            return;
        }
        if (!COMMAND_TYPES.includes(command.type)) {
            add(`Command ${index} has an unknown type "${command.type}".`);
            return;
        }
        switch (command.type) {
            case 'set-variable': {
                onlyKeys(command, ['type', 'variableId', 'value', 'locale'], index, add);
                stringField(command, 'variableId', index, add, 1, 80);
                stringField(command, 'value', index, add, 0, 2000);
                if (command.locale !== undefined && !LOCALE.test(String(command.locale))) {
                    add('"locale" must be a locale tag such as "en" or "pt-BR".', { commandIndex: index });
                }
                break;
            }
            case 'set-layer': {
                onlyKeys(command, ['type', 'layerId', 'patch'], index, add);
                layerIdField(command.layerId, index, add);
                if (!isObject(command.patch)) add('"patch" must be an object.', { commandIndex: index });
                else validatePatch(command.patch, index, issues);
                break;
            }
            case 'add-layer': {
                onlyKeys(command, ['type', 'layer', 'above'], index, add);
                validateNewLayer(command.layer, index, issues);
                if (command.above !== undefined) layerIdField(command.above, index, add);
                break;
            }
            case 'remove-layer':
            case 'clear-animation': {
                onlyKeys(command, ['type', 'layerId'], index, add);
                layerIdField(command.layerId, index, add);
                break;
            }
            case 'duplicate-layer': {
                onlyKeys(command, ['type', 'layerId', 'newId', 'patch'], index, add);
                layerIdField(command.layerId, index, add);
                layerIdField(command.newId, index, add);
                if (command.patch !== undefined) {
                    if (!isObject(command.patch)) add('"patch" must be an object.', { commandIndex: index });
                    else validatePatch(command.patch, index, issues);
                }
                break;
            }
            case 'reorder-layer': {
                onlyKeys(command, ['type', 'layerId', 'z', 'above', 'below'], index, add);
                layerIdField(command.layerId, index, add);
                const anchors = ['z', 'above', 'below'].filter((key) => command[key] !== undefined);
                if (anchors.length !== 1) add('"reorder-layer" needs exactly one of z, above or below.', { commandIndex: index });
                if (command.z !== undefined) integerField(command.z, 'z', index, add, 0, 999);
                if (command.above !== undefined) layerIdField(command.above, index, add);
                if (command.below !== undefined) layerIdField(command.below, index, add);
                break;
            }
            case 'swap-asset': {
                onlyKeys(command, ['type', 'layerId', 'asset', 'focus'], index, add);
                layerIdField(command.layerId, index, add);
                validateAssetRef(command.asset, index, issues);
                if (command.focus !== undefined) {
                    if (!isObject(command.focus)) add('"focus" must be an object.', { commandIndex: index });
                    else {
                        onlyKeys(command.focus, ['x', 'y'], index, add, 'focus.');
                        numberField(command.focus.x, 'focus.x', index, add, 0, 100, false);
                        numberField(command.focus.y, 'focus.y', index, add, 0, 100, false);
                    }
                }
                break;
            }
            case 'set-animation': {
                onlyKeys(command, ['type', 'layerId', 'preset', 'startMs', 'durationMs', 'easing', 'loop', 'intensity'], index, add);
                layerIdField(command.layerId, index, add);
                if (!PRESETS.includes(command.preset)) add(`"preset" must be one of ${PRESETS.join(', ')}.`, { commandIndex: index });
                if (command.startMs !== undefined) integerField(command.startMs, 'startMs', index, add, 0, 120000);
                if (command.durationMs !== undefined) integerField(command.durationMs, 'durationMs', index, add, 100, 120000);
                if (command.easing !== undefined && !EASING.includes(command.easing)) {
                    add(`"easing" must be one of ${EASING.join(', ')}.`, { commandIndex: index });
                }
                if (command.loop !== undefined && typeof command.loop !== 'boolean') add('"loop" must be a boolean.', { commandIndex: index });
                if (command.intensity !== undefined) numberField(command.intensity, 'intensity', index, add, 0, 2, false);
                break;
            }
            case 'set-keyframes': {
                onlyKeys(command, ['type', 'layerId', 'keyframes'], index, add);
                layerIdField(command.layerId, index, add);
                validateKeyframes(command.keyframes, index, issues);
                break;
            }
            case 'set-format': {
                onlyKeys(command, ['type', 'formatId', 'label', 'channel', 'width', 'height', 'layerOverrides', 'pinnedLayerIds', 'safeZone'], index, add);
                if (typeof command.formatId !== 'string' || !FORMAT_ID.test(command.formatId)) {
                    add('"formatId" must match ^[a-z0-9-]{1,32}$.', { commandIndex: index });
                }
                if (command.channel !== undefined && !Core.FORMAT_CHANNELS.includes(command.channel)) {
                    add(`"channel" must be one of ${Core.FORMAT_CHANNELS.join(', ')}.`, { commandIndex: index });
                }
                if (command.width !== undefined) integerField(command.width, 'width', index, add, 64, 8192);
                if (command.height !== undefined) integerField(command.height, 'height', index, add, 64, 8192);
                if (command.label !== undefined && typeof command.label !== 'string') add('"label" must be a string.', { commandIndex: index });
                if (command.layerOverrides !== undefined) {
                    if (!isObject(command.layerOverrides)) add('"layerOverrides" must be an object.', { commandIndex: index });
                    else {
                        Object.keys(command.layerOverrides).forEach((id) => {
                            if (!LAYER_ID.test(id)) add(`"${id}" is not a valid layer id.`, { commandIndex: index });
                            else if (!isObject(command.layerOverrides[id])) add(`"layerOverrides.${id}" must be an object.`, { commandIndex: index });
                            else validatePatch(command.layerOverrides[id], index, issues);
                        });
                    }
                }
                if (command.pinnedLayerIds !== undefined) {
                    if (!Array.isArray(command.pinnedLayerIds)) add('"pinnedLayerIds" must be an array.', { commandIndex: index });
                    else command.pinnedLayerIds.forEach((id) => layerIdField(id, index, add));
                }
                if (command.safeZone !== undefined) {
                    if (!isObject(command.safeZone)) add('"safeZone" must be an object.', { commandIndex: index });
                    else {
                        onlyKeys(command.safeZone, ['top', 'right', 'bottom', 'left'], index, add, 'safeZone.');
                        ['top', 'right', 'bottom', 'left'].forEach((edge) => {
                            if (command.safeZone[edge] !== undefined) {
                                numberField(command.safeZone[edge], `safeZone.${edge}`, index, add, 0, 0.4, false);
                            }
                        });
                    }
                }
                break;
            }
            case 'set-scene-duration': {
                onlyKeys(command, ['type', 'durationMs'], index, add);
                integerField(command.durationMs, 'durationMs', index, add, 1000, 120000);
                break;
            }
            default:
                break;
        }
    }

    function onlyKeys(value, allowed, index, add, prefix = '') {
        Object.keys(value).forEach((key) => {
            if (!allowed.includes(key)) add(`Unknown field "${prefix}${key}".`, { commandIndex: index });
        });
    }

    function stringField(command, key, index, add, min, max) {
        if (typeof command[key] !== 'string' || command[key].length < min || command[key].length > max) {
            add(`"${key}" must be a string of ${min}-${max} characters.`, { commandIndex: index });
        }
    }

    function numberField(value, key, index, add, min, max, exclusiveMin) {
        if (!Number.isFinite(value) || value < min || value > max || (exclusiveMin && value === min)) {
            add(`"${key}" must be a number ${exclusiveMin ? '>' : '>='} ${min} and <= ${max}.`, { commandIndex: index });
        }
    }

    function integerField(value, key, index, add, min, max) {
        if (!Number.isInteger(value) || value < min || value > max) {
            add(`"${key}" must be an integer between ${min} and ${max}.`, { commandIndex: index });
        }
    }

    function layerIdField(value, index, add) {
        if (typeof value !== 'string' || !LAYER_ID.test(value)) {
            add('A layer id must match ^[a-z0-9][a-z0-9-_]{0,63}$.', { commandIndex: index });
        }
    }

    function validatePatch(patch, index, issues) {
        const add = (message) => issues.push(issue('SCHEMA', message, { commandIndex: index }));
        const keys = Object.keys(patch);
        if (!keys.length) add('A layer patch must change at least one field.');
        keys.forEach((key) => {
            const rule = PATCH_RULES[key];
            if (!rule) {
                add(`Unknown patch field "${key}".`);
                return;
            }
            const value = patch[key];
            if (rule.kind === 'string') {
                if (typeof value !== 'string' || (rule.max && value.length > rule.max)) add(`"${key}" must be a string.`);
            } else if (rule.kind === 'number') {
                numberField(value, key, index, add, rule.min, rule.max, rule.exclusiveMin);
            } else if (rule.kind === 'integer') {
                integerField(value, key, index, add, rule.min, rule.max);
            } else if (rule.kind === 'boolean') {
                if (typeof value !== 'boolean') add(`"${key}" must be a boolean.`);
            } else if (rule.kind === 'enum') {
                if (!rule.values.includes(value)) add(`"${key}" must be one of ${rule.values.join(', ')}.`);
            } else if (rule.kind === 'color') {
                if (typeof value !== 'string' || value.length > 64) add(`"${key}" must be a colour string.`);
            } else if (rule.kind === 'font') {
                if (!isObject(value)) add('"font" must be an object.');
                else validateFontPatch(value, index, issues);
            }
        });
    }

    function validateFontPatch(font, index, issues) {
        const add = (message) => issues.push(issue('SCHEMA', message, { commandIndex: index }));
        const keys = Object.keys(font);
        if (!keys.length) add('A font patch must change at least one field.');
        keys.forEach((key) => {
            const rule = FONT_RULES[key];
            if (!rule) {
                add(`Unknown font field "${key}".`);
                return;
            }
            const value = font[key];
            if (rule.kind === 'string') {
                if (typeof value !== 'string' || (rule.max && value.length > rule.max)) add(`"font.${key}" must be a string.`);
            } else if (rule.kind === 'number') {
                numberField(value, `font.${key}`, index, add, rule.min, rule.max, false);
            } else if (rule.kind === 'integer') {
                integerField(value, `font.${key}`, index, add, rule.min, rule.max);
            } else if (rule.kind === 'enum') {
                if (!rule.values.includes(value)) add(`"font.${key}" must be one of ${rule.values.join(', ')}.`);
            }
        });
    }

    function validateNewLayer(layer, index, issues) {
        const add = (message) => issues.push(issue('SCHEMA', message, { commandIndex: index }));
        if (!isObject(layer)) {
            add('"layer" must be an object.');
            return;
        }
        const allowed = [
            'id', 'type', 'role', 'box', 'z', 'opacity', 'shape', 'fill', 'gradient',
            'assetRef', 'text', 'font', 'color', 'align', 'verticalAlign', 'bindText',
        ];
        Object.keys(layer).forEach((key) => {
            if (!allowed.includes(key)) add(`Unknown layer field "${key}".`);
        });
        layerIdField(layer.id, index, add);
        if (!['shape', 'gradient', 'image', 'text'].includes(layer.type)) {
            add('"layer.type" must be shape, gradient, image or text.');
        }
        if (layer.role !== undefined && !['background', 'foreground'].includes(layer.role)) {
            add('"layer.role" must be background or foreground.');
        }
        if (isObject(layer.box)) {
            onlyKeys(layer.box, ['x', 'y', 'w', 'h'], index, add, 'box.');
            ['x', 'y'].forEach((key) => {
                if (layer.box[key] !== undefined) numberField(layer.box[key], `box.${key}`, index, add, -100, 200, false);
            });
            ['w', 'h'].forEach((key) => {
                if (layer.box[key] !== undefined) numberField(layer.box[key], `box.${key}`, index, add, 0, 200, true);
            });
        }
        if (layer.z !== undefined) integerField(layer.z, 'z', index, add, 0, 999);
        if (layer.opacity !== undefined) numberField(layer.opacity, 'opacity', index, add, 0, 1, false);
        if (layer.type === 'shape') {
            if (layer.shape !== undefined && !['rect', 'ellipse', 'line'].includes(layer.shape)) {
                add('"shape" must be rect, ellipse or line.');
            }
            if (layer.fill !== undefined && (typeof layer.fill !== 'string' || layer.fill.length > 64)) add('"fill" must be a colour string.');
        }
        if (layer.type === 'gradient') {
            if (!isObject(layer.gradient)) add('type=gradient requires a "gradient" object.');
            else {
                onlyKeys(layer.gradient, ['angleDeg', 'stops'], index, add, 'gradient.');
                if (!Number.isFinite(layer.gradient.angleDeg) || layer.gradient.angleDeg < 0 || layer.gradient.angleDeg > 360) {
                    add('"gradient.angleDeg" must be 0-360.');
                }
                if (!Array.isArray(layer.gradient.stops) || layer.gradient.stops.length < 2 || layer.gradient.stops.length > 6) {
                    add('"gradient.stops" must hold 2-6 stops.');
                } else {
                    layer.gradient.stops.forEach((stop, stopIndex) => {
                        if (!isObject(stop)) {
                            add(`"gradient.stops[${stopIndex}]" must be an object.`);
                            return;
                        }
                        onlyKeys(stop, ['at', 'color'], index, add, `gradient.stops[${stopIndex}].`);
                        if (!Number.isFinite(stop.at) || stop.at < 0 || stop.at > 1) add(`"gradient.stops[${stopIndex}].at" must be 0-1.`);
                        if (typeof stop.color !== 'string' || stop.color.length > 64) add(`"gradient.stops[${stopIndex}].color" must be a colour string.`);
                    });
                }
            }
        }
        if (layer.type === 'image') validateAssetRef(layer.assetRef, index, issues, true);
        if (layer.type === 'text') {
            if (typeof layer.text !== 'string') add('type=text requires "text".');
            if (layer.color !== undefined && (typeof layer.color !== 'string' || layer.color.length > 64)) add('"color" must be a colour string.');
            if (layer.font !== undefined) {
                if (!isObject(layer.font)) add('"font" must be an object.');
                else validateFontPatch(layer.font, index, issues);
            }
            if (layer.align !== undefined && !['left', 'center', 'right'].includes(layer.align)) add('"align" must be left, center or right.');
            if (layer.verticalAlign !== undefined && !['top', 'middle', 'bottom'].includes(layer.verticalAlign)) add('"verticalAlign" must be top, middle or bottom.');
            if (layer.bindText !== undefined && (typeof layer.bindText !== 'string' || layer.bindText.length > 80)) add('"bindText" must be a variable id.');
        }
    }

    function validateAssetRef(assetRef, index, issues, required) {
        const add = (message) => issues.push(issue('SCHEMA', message, { commandIndex: index }));
        if (assetRef === undefined) {
            if (required) add('type=image requires an "assetRef".');
            return;
        }
        if (!isObject(assetRef)) {
            add('"assetRef" must be an object.');
            return;
        }
        onlyKeys(assetRef, ['catalog', 'name', 'variant'], index, add, 'assetRef.');
        if (!['logos', 'photography', 'uploads'].includes(assetRef.catalog)) {
            add('"assetRef.catalog" must be logos, photography or uploads.');
        }
        if (typeof assetRef.name !== 'string' || !assetRef.name.trim()) add('"assetRef.name" must be a catalogue entry name.');
        if (assetRef.variant !== undefined && !['svg', 'png', 'jpg'].includes(assetRef.variant)) {
            add('"assetRef.variant" must be svg, png or jpg.');
        }
    }

    function validateKeyframes(frames, index, issues) {
        const add = (message) => issues.push(issue('SCHEMA', message, { commandIndex: index }));
        if (!Array.isArray(frames) || frames.length < 2 || frames.length > 40) {
            add('"keyframes" must hold 2-40 frames.');
            return;
        }
        frames.forEach((frame, frameIndex) => {
            if (!isObject(frame)) {
                add(`"keyframes[${frameIndex}]" must be an object.`);
                return;
            }
            onlyKeys(frame, ['t', 'easing', 'values'], index, add, `keyframes[${frameIndex}].`);
            if (!Number.isInteger(frame.t) || frame.t < 0) add(`"keyframes[${frameIndex}].t" must be a non-negative integer.`);
            if (frame.easing !== undefined && !EASING.includes(frame.easing)) add(`"keyframes[${frameIndex}].easing" is not a known easing.`);
            if (!isObject(frame.values) || !Object.keys(frame.values).length) {
                add(`"keyframes[${frameIndex}].values" must change at least one property.`);
                return;
            }
            Object.keys(frame.values).forEach((key) => {
                if (!KEYFRAME_VALUES.includes(key)) add(`"keyframes[${frameIndex}].values.${key}" is not animatable.`);
                else if (!Number.isFinite(frame.values[key])) add(`"keyframes[${frameIndex}].values.${key}" must be a number.`);
            });
            if (frame.values.opacity !== undefined && (frame.values.opacity < 0 || frame.values.opacity > 1)) {
                add(`"keyframes[${frameIndex}].values.opacity" must be 0-1.`);
            }
            if (frame.values.scale !== undefined && frame.values.scale <= 0) {
                add(`"keyframes[${frameIndex}].values.scale" must be positive.`);
            }
        });
        for (let i = 1; i < frames.length; i += 1) {
            if (isObject(frames[i]) && isObject(frames[i - 1]) && Number(frames[i].t) < Number(frames[i - 1].t)) {
                add('"keyframes" must be sorted by t.');
                break;
            }
        }
    }

    // ---------------------------------------------------------------------
    // Guardrail configuration
    // ---------------------------------------------------------------------
    /**
     * The composition stores a legacy `{enabled, block}` guardrail object. v2
     * adds per-rule modes. A disabled or non-blocking composition still reports
     * violations, but as warnings, so a preview never silently hides a problem.
     */
    function normalizeGuardrailConfig(value) {
        const source = isObject(value) ? value : {};
        const rules = {};
        Object.keys(DEFAULT_RULES).forEach((name) => {
            const mode = isObject(source.rules) ? source.rules[name] : undefined;
            const allowed = name === 'LOCKED_LAYER' ? ['off', 'block'] : ['off', 'warn', 'block'];
            rules[name] = allowed.includes(mode) ? mode : DEFAULT_RULES[name];
        });
        const config = {
            enabled: source.enabled !== false,
            block: source.block !== false,
            rules,
            minContrast: Number.isFinite(source.minContrast) ? Number(source.minContrast) : 4.5,
            minTextSizePct: Number.isFinite(source.minTextSizePct) ? Number(source.minTextSizePct) : 0.9,
            protectedLayerIds: Array.isArray(source.protectedLayerIds)
                ? source.protectedLayerIds.filter((id) => typeof id === 'string')
                : [],
        };
        if (!config.enabled) {
            Object.keys(config.rules).forEach((name) => { config.rules[name] = 'off'; });
        } else if (!config.block) {
            Object.keys(config.rules).forEach((name) => {
                if (config.rules[name] === 'block') config.rules[name] = 'warn';
            });
        }
        return config;
    }

    function mergeConfig(base, override) {
        if (!isObject(override)) return base;
        const enabling = override.enabled === true && base.enabled === false;
        const next = { ...base, rules: enabling ? { ...DEFAULT_RULES } : { ...base.rules } };
        ['enabled', 'block'].forEach((key) => {
            if (override[key] !== undefined) next[key] = override[key] !== false;
        });
        if (isObject(override.rules)) {
            Object.keys(base.rules).forEach((name) => {
                const mode = override.rules[name];
                const allowed = name === 'LOCKED_LAYER' ? ['off', 'block'] : ['off', 'warn', 'block'];
                if (allowed.includes(mode)) next.rules[name] = mode;
            });
        }
        ['minContrast', 'minTextSizePct'].forEach((key) => {
            if (Number.isFinite(override[key])) next[key] = Number(override[key]);
        });
        if (Array.isArray(override.protectedLayerIds)) next.protectedLayerIds = override.protectedLayerIds.slice();
        if (!next.enabled) {
            Object.keys(next.rules).forEach((name) => { next.rules[name] = 'off'; });
        } else if (!next.block) {
            Object.keys(next.rules).forEach((name) => {
                if (next.rules[name] === 'block') next.rules[name] = 'warn';
            });
        }
        return next;
    }

    // ---------------------------------------------------------------------
    // Animation presets
    // ---------------------------------------------------------------------
    const INTERNAL_EASING = {
        linear: 'linear',
        'ease-in': 'easeIn',
        'ease-out': 'easeOut',
        'ease-in-out': 'easeInOut',
        step: 'stepEnd',
    };

    /** intensity (0-2) maps onto the preset's own parameter vocabulary. */
    function presetParams(preset, intensity) {
        const amount = finite(intensity, 1);
        switch (preset) {
            case 'pulse': return { scale: 1 + 0.06 * amount };
            case 'breathe': return { amplitude: 2 * amount };
            case 'zoom': return { from: 1 - 0.2 * amount, to: 1 + 0.1 * amount };
            case 'parallax':
            case 'drift': return { distance: 4 * amount };
            case 'float': return { distance: 2 * amount };
            case 'sway': return { amplitude: 2 * amount, tilt: 3 * amount };
            case 'orbit': return { radius: 3 * amount };
            case 'swing': return { amplitude: 8 * amount };
            case 'nod': return { amplitude: 3 * amount };
            case 'hop': return { height: 4 * amount };
            case 'shake': return { amplitude: 1.5 * amount };
            case 'spin': return { turns: amount };
            default: return {};
        }
    }

    /**
     * One implementation of every preset, shared by the inspector and the agent
     * command path. `base` is the layer state at time 0; `duration` is the span
     * the preset should occupy.
     */
    function presetKeyframes(presetName, base, duration, params, easing) {
        if (!PRESETS.includes(presetName) || presetName === 'none') return [];
        const dur = Math.max(100, finite(duration, 3000));
        const source = base || {};
        const kf = (time, over = {}) => ({
            time: Math.round(clamp(time, 0, dur)),
            x: clamp(over.x ?? finite(source.x, 0), -100, 200),
            y: clamp(over.y ?? finite(source.y, 0), -100, 200),
            w: clamp(over.w ?? finite(source.w, 1), 1, 300),
            h: clamp(over.h ?? finite(source.h, 1), 1, 300),
            rotation: clamp(over.rotation ?? finite(source.rotation, 0), -3600, 3600),
            opacity: clamp(over.opacity ?? finite(source.opacity, 1), 0, 1),
        });
        const options = params || {};
        const amp = finite(options.amplitude, 2);
        const tilt = finite(options.tilt, 3);
        const easingName = INTERNAL_EASING[easing] || null;
        const e = (name) => (frame) => {
            if (easingName || name) frame.easing = easingName || name;
            return frame;
        };
        const loop = LOOPING_PRESETS.has(presetName);
        const step = (fraction) => (loop ? fraction : fraction * 0.6);
        const random = seededRandom(`${source.x},${source.y},${source.w},${source.h}`);

        const presets = {
            breathe: () => [
                kf(0),
                e('easeInOutSine')(kf(dur * 0.5, { w: finite(source.w, 1) * 1.02, h: finite(source.h, 1) * 1.02 })),
                e('easeInOutSine')(kf(dur)),
            ],
            idle: () => [
                kf(0),
                e('easeInOutSine')(kf(dur * 0.33, { y: finite(source.y, 0) - 0.5, rotation: finite(source.rotation, 0) + 0.4 })),
                e('easeInOutSine')(kf(dur * 0.66, { y: finite(source.y, 0) + 0.5, rotation: finite(source.rotation, 0) - 0.4 })),
                e('easeInOutSine')(kf(dur)),
            ],
            sway: () => Array.from({ length: 9 }, (_, i) => {
                const t = (i / 8) * dur;
                const phase = (i / 8) * Math.PI * 2;
                const frame = kf(t, {
                    x: finite(source.x, 0) + Math.sin(phase) * amp,
                    rotation: finite(source.rotation, 0) + Math.sin(phase) * tilt,
                });
                if (easingName) frame.easing = easingName;
                return frame;
            }),
            walk: () => {
                const startX = finite(options.startX, finite(source.x, 0));
                const endX = finite(options.endX, 100 - finite(source.w, 10));
                return [
                    kf(0, { x: startX }),
                    e('easeInOutQuad')(kf(dur * 0.25, { x: startX + (endX - startX) * 0.25, rotation: finite(source.rotation, 0) - 1.5 })),
                    e('easeInOutQuad')(kf(dur * 0.5, { x: startX + (endX - startX) * 0.5 })),
                    e('easeInOutQuad')(kf(dur * 0.75, { x: startX + (endX - startX) * 0.75, rotation: finite(source.rotation, 0) + 1.5 })),
                    e('easeInOutQuad')(kf(dur, { x: endX })),
                ];
            },
            float: () => {
                const d = finite(options.distance, 2);
                return [
                    kf(0),
                    e('easeInOutSine')(kf(dur * 0.25, { y: finite(source.y, 0) - d })),
                    e('easeInOutSine')(kf(dur * 0.5, { y: finite(source.y, 0) })),
                    e('easeInOutSine')(kf(dur * 0.75, { y: finite(source.y, 0) + d })),
                    e('easeInOutSine')(kf(dur, { y: finite(source.y, 0) })),
                ];
            },
            flicker: () => Array.from({ length: 12 }, (_, i) => {
                const frame = kf((i / 11) * dur, { opacity: 0.55 + random() * 0.45 });
                if (easingName) frame.easing = easingName;
                return frame;
            }),
            drift: () => [
                kf(0, { x: finite(source.x, 0) }),
                e('easeInOut')(kf(dur, { x: finite(source.x, 0) + finite(options.distance, 15) })),
            ],
            pulse: () => {
                const s = finite(options.scale, 1.06);
                return [
                    kf(0),
                    e('easeInOutSine')(kf(dur * 0.5, { w: finite(source.w, 1) * s, h: finite(source.h, 1) * s })),
                    e('easeInOutSine')(kf(dur)),
                ];
            },
            fadeIn: () => [
                kf(0, { opacity: 0 }),
                e('easeOutCubic')(kf(step(0.35), { opacity: finite(source.opacity, 1) })),
                kf(dur, { opacity: finite(source.opacity, 1) }),
            ],
            parallax: () => [
                kf(0, { x: finite(source.x, 0) - finite(options.distance, 4) }),
                e('easeInOutSine')(kf(dur * 0.5, { x: finite(source.x, 0) })),
                e('easeInOutSine')(kf(dur, { x: finite(source.x, 0) + finite(options.distance, 4) })),
            ],
            fadeOut: () => [
                kf(0, { opacity: finite(source.opacity, 1) }),
                e('easeInQuad')(kf(step(0.7), { opacity: finite(source.opacity, 1) })),
                e('easeInQuad')(kf(dur, { opacity: 0 })),
            ],
            zoom: () => {
                const from = finite(options.from, 0.5);
                const to = finite(options.to, 1.2);
                return [
                    kf(0, { w: finite(source.w, 1) * from, h: finite(source.h, 1) * from }),
                    e('easeInOutQuad')(kf(dur, { w: finite(source.w, 1) * to, h: finite(source.h, 1) * to })),
                ];
            },
            spin: () => {
                const turns = finite(options.turns, 1);
                const steps = Math.max(2, Math.min(12, Math.ceil(Math.abs(turns) * 4)));
                return Array.from({ length: steps + 1 }, (_, i) => {
                    const frame = kf((i / steps) * dur, { rotation: finite(source.rotation, 0) + (i / steps) * turns * 360 });
                    if (i > 0) frame.easing = easingName || 'linear';
                    return frame;
                });
            },
            shake: () => {
                const a = finite(options.amplitude, 1.5);
                const decay = finite(options.decay, 0.85);
                const steps = 8;
                return Array.from({ length: steps + 1 }, (_, i) => {
                    const power = a * Math.pow(decay, i);
                    const dx = (i % 2 === 0 ? 1 : -1) * power * (i === 0 || i === steps ? 0 : 1);
                    const dy = (i % 2 === 0 ? -0.5 : 0.5) * power * (i === 0 || i === steps ? 0 : 1);
                    const frame = kf((i / steps) * dur, { x: finite(source.x, 0) + dx, y: finite(source.y, 0) + dy });
                    if (easingName) frame.easing = easingName;
                    return frame;
                });
            },
            hop: () => {
                const height = finite(options.height, 4);
                const count = Math.max(1, Math.round(finite(options.count, 2)));
                const frames = [kf(0)];
                for (let c = 0; c < count; c += 1) {
                    const segStart = (c / count) * dur;
                    const segEnd = ((c + 1) / count) * dur;
                    const peak = (segStart + segEnd) / 2;
                    frames.push(e('easeOutQuad')(kf(peak, { y: finite(source.y, 0) - height, h: finite(source.h, 1) * 1.02 })));
                    frames.push(e('easeInQuad')(kf(segEnd, { y: finite(source.y, 0), h: finite(source.h, 1) * 0.96 })));
                }
                frames.push(kf(dur));
                return frames;
            },
            swing: () => Array.from({ length: 9 }, (_, i) => {
                const phase = (i / 8) * Math.PI * 2;
                const frame = kf((i / 8) * dur, { rotation: finite(source.rotation, 0) + Math.sin(phase) * finite(options.amplitude, 8) });
                if (i > 0) frame.easing = easingName || 'easeInOutSine';
                return frame;
            }),
            orbit: () => Array.from({ length: 13 }, (_, i) => {
                const r = finite(options.radius, 3);
                const angle = (i / 12) * Math.PI * 2;
                const frame = kf((i / 12) * dur, {
                    x: finite(source.x, 0) + Math.sin(angle) * r,
                    y: finite(source.y, 0) - Math.cos(angle) * r + r,
                });
                if (i > 0) frame.easing = easingName || 'linear';
                return frame;
            }),
            nod: () => {
                const cycles = Math.max(1, Math.round(finite(options.cycles, 2)));
                const steps = cycles * 4;
                return Array.from({ length: steps + 1 }, (_, i) => {
                    const phase = (i / steps) * cycles * Math.PI * 2;
                    const frame = kf((i / steps) * dur, { rotation: finite(source.rotation, 0) + Math.sin(phase) * finite(options.amplitude, 3) });
                    if (i > 0) frame.easing = easingName || 'easeInOutSine';
                    return frame;
                });
            },
            blinkIn: () => [
                kf(0, { opacity: 0 }),
                e('stepEnd')(kf(dur * 0.15, { opacity: finite(source.opacity, 1) })),
                e('stepEnd')(kf(dur * 0.3, { opacity: 0 })),
                e('stepEnd')(kf(dur * 0.45, { opacity: finite(source.opacity, 1) })),
                kf(dur, { opacity: finite(source.opacity, 1) }),
            ],
        };
        return (presets[presetName] || (() => []))();
    }

    // ---------------------------------------------------------------------
    // Asset catalogue
    // ---------------------------------------------------------------------
    function baseAssetName(url, stripVariant) {
        const file = String(url || '').split('?')[0].split('/').pop() || '';
        let name = file.replace(/\.[a-z0-9]+$/i, '');
        if (stripVariant) name = name.replace(/-(white|ink|vermilion|black|color|colour)$/i, '');
        return name.replace(/[-_]+/g, ' ').trim().toLowerCase();
    }

    function extensionOf(url) {
        const match = String(url || '').split('?')[0].match(/\.([a-z0-9]+)$/i);
        const ext = match ? match[1].toLowerCase() : '';
        if (ext === 'jpeg') return 'jpg';
        return ['svg', 'png', 'jpg'].includes(ext) ? ext : '';
    }

    /**
     * Builds the catalogue an agent may reference. Logos come from the brand
     * kit; photography and uploads are inferred from the image layers already
     * in the scene (the editor never invents a URL for the agent).
     */
    function buildAssetCatalogue(composition) {
        const logos = new Map();
        const photography = new Map();
        const uploads = new Map();
        const brandLogos = (composition && composition.brandKit && composition.brandKit.logos) || [];
        brandLogos.forEach((entry) => {
            if (!entry || !entry.url) return;
            const key = baseAssetName(entry.url, true);
            const variant = extensionOf(entry.url);
            if (!key) return;
            const group = logos.get(key) || { name: key, variants: [], urls: {}, tone: /white/.test(entry.url) ? 'light' : (/ink|black/.test(entry.url) ? 'dark' : 'colour') };
            if (variant && !group.variants.includes(variant)) group.variants.push(variant);
            if (variant && !group.urls[variant]) group.urls[variant] = entry.url;
            if (entry.name) group.label = entry.name;
            logos.set(key, group);
        });
        ((composition && composition.layers) || []).forEach((layer) => {
            if (!layer || layer.type === 'text' || !layer.url) return;
            const url = layer.url;
            const name = baseAssetName(url, false);
            if (/photography\//i.test(url)) {
                if (!photography.has(name)) {
                    photography.set(name, {
                        name,
                        url,
                        tags: name.split(/[ -]+/).filter((word) => word.length > 2),
                    });
                }
                return;
            }
            if (/logos?\//i.test(url)) {
                const key = baseAssetName(url, true);
                if (!logos.has(key)) logos.set(key, { name: key, variants: [], urls: {}, tone: 'colour' });
                const group = logos.get(key);
                const variant = extensionOf(url);
                if (variant && !group.variants.includes(variant)) group.variants.push(variant);
                if (variant && !group.urls[variant]) group.urls[variant] = url;
                return;
            }
            if (!uploads.has(name)) uploads.set(name, { name, url });
        });
        return {
            logos: [...logos.values()].map((group) => ({ ...group, variants: group.variants.sort() })),
            photography: [...photography.values()],
            uploads: [...uploads.values()],
        };
    }

    function resolveAssetRef(assetRef, catalogue) {
        if (!isObject(assetRef) || !catalogue) return null;
        const bucket = catalogue[assetRef.catalog];
        if (!Array.isArray(bucket)) return null;
        const wanted = String(assetRef.name || '').trim().toLowerCase();
        const loose = wanted.replace(/[^a-z0-9]/g, '');
        const entry = bucket.find((item) => String(item.name).toLowerCase() === wanted)
            || bucket.find((item) => String(item.name).toLowerCase().replace(/[^a-z0-9]/g, '') === loose)
            || bucket.find((item) => String(item.name).toLowerCase().includes(wanted) || wanted.includes(String(item.name).toLowerCase()));
        if (!entry) return null;
        if (entry.urls) {
            const variant = assetRef.variant || (entry.urls.svg ? 'svg' : Object.keys(entry.urls)[0]);
            return entry.urls[variant] ? { ...entry, url: entry.urls[variant], variant } : null;
        }
        return { ...entry, url: entry.url, variant: extensionOf(entry.url) };
    }

    // ---------------------------------------------------------------------
    // Desugaring new layers
    // ---------------------------------------------------------------------
    function svgDataUrl(svg) {
        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    function gradientSvg(gradient) {
        const angle = ((finite(gradient.angleDeg, 180) % 360) * Math.PI) / 180;
        // CSS convention: 0deg points to the top, 180deg to the bottom.
        const dx = Math.sin(angle);
        const dy = -Math.cos(angle);
        const x1 = 0.5 - dx / 2;
        const y1 = 0.5 - dy / 2;
        const x2 = 0.5 + dx / 2;
        const y2 = 0.5 + dy / 2;
        const stops = gradient.stops.map((stop) => {
            const rgba = parseColor(stop.color) || [0, 0, 0, 1];
            return `<stop offset="${round(stop.at, 4)}" stop-color="rgb(${Math.round(rgba[0])},${Math.round(rgba[1])},${Math.round(rgba[2])})" stop-opacity="${round(rgba[3], 3)}"/>`;
        }).join('');
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><linearGradient id="g" x1="${round(x1 * 100, 2)}%" y1="${round(y1 * 100, 2)}%" x2="${round(x2 * 100, 2)}%" y2="${round(y2 * 100, 2)}%">${stops}</linearGradient></defs><rect width="100" height="100" fill="url(#g)"/></svg>`;
    }

    function shapeSvg(shape, fill) {
        const color = colorToCss(fill);
        if (shape === 'ellipse') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><ellipse cx="50" cy="50" rx="50" ry="50" fill="${color}"/></svg>`;
        if (shape === 'line') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="0" y="46" width="100" height="8" fill="${color}"/></svg>`;
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><rect width="100" height="100" fill="${color}"/></svg>`;
    }

    function newLayerFromCommand(spec, composition) {
        const box = isObject(spec.box) ? spec.box : {};
        const layer = {
            id: spec.id,
            type: 'image',
            role: ROLE_MAP[spec.role] || 'foreground',
            name: spec.id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()),
            x: finite(box.x, 0),
            y: finite(box.y, 0),
            w: finite(box.w, 100),
            h: finite(box.h, 100),
            z: finite(spec.z, (composition.layers || []).length),
            opacity: finite(spec.opacity, 1),
            rotation: 0,
            visible: true,
            fit: 'fill',
            url: '',
            frames: [],
            keyframes: [],
            bindings: {},
        };
        if (spec.type === 'gradient') {
            layer.url = svgDataUrl(gradientSvg(spec.gradient));
            layer.frames = [layer.url];
        } else if (spec.type === 'shape') {
            layer.url = svgDataUrl(shapeSvg(spec.shape || 'rect', spec.fill));
            layer.frames = [layer.url];
        } else if (spec.type === 'image') {
            const asset = resolveAssetRef(spec.assetRef, buildAssetCatalogue(composition));
            if (!asset) return null;
            layer.url = asset.url;
            layer.frames = [asset.url];
            layer.fit = spec.assetRef.catalog === 'logos' ? 'contain' : 'cover';
        } else {
            const font = Core.normalizeTextFont(spec.font || {});
            layer.type = 'text';
            layer.fit = 'contain';
            layer.text = spec.text;
            layer.font = font;
            layer.color = normalizeColor(spec.color, composition) || Core.TEXT_LAYER_DEFAULTS.color;
            layer.align = spec.align || 'left';
            layer.verticalAlign = spec.verticalAlign || 'top';
            layer.overflow = 'clip';
            layer.bindings = spec.bindText ? { text: spec.bindText } : {};
        }
        return layer;
    }

    // ---------------------------------------------------------------------
    // Apply
    // ---------------------------------------------------------------------
    class CommandFailure extends Error {
        constructor(issues) {
            super(issues.map((entry) => entry.message).join(' '));
            this.issues = issues;
        }
    }

    function failure(code, message, extra) {
        throw new CommandFailure([issue(code, message, extra)]);
    }

    function writePatch(composition, format, layer, patch, commandIndex) {
        const isMaster = isMasterFormat(format);
        if (!isMaster) {
            const override = { ...(format.layerOverrides?.[layer.id] || {}) };
            Object.keys(patch).forEach((key) => {
                const value = patch[key];
                if (key === 'font') {
                    if (value.sizePct === undefined) {
                        failure('FIELD_NOT_APPLICABLE', `Format "${format.id}" can only override font.sizePct; change "${key}" on the master format.`, { commandIndex, layerId: layer.id });
                    }
                    override.fontSizePct = value.sizePct;
                    return;
                }
                if (['x', 'y', 'w', 'h', 'rotation', 'opacity', 'visible', 'z'].includes(key)) {
                    override[key] = value;
                    return;
                }
                failure('FIELD_NOT_APPLICABLE', `Format "${format.id}" can only override geometry and size; change "${key}" on the master format.`, { commandIndex, layerId: layer.id });
            });
            format.layerOverrides = { ...(format.layerOverrides || {}), [layer.id]: override };
            return;
        }
        Object.keys(patch).forEach((key) => {
            const value = patch[key];
            if (key === 'font') {
                layer.font = { ...(layer.font || {}), ...fontPatchValue(composition, value, commandIndex, layer.id) };
                return;
            }
            if (key === 'color' || key === 'recolorColor' || key === 'outlineColor') {
                const color = normalizeColor(value, composition);
                if (!color) failure('BRAND_COLOR', `"${value}" is not a hex colour, rgba() value or brand palette name.`, { commandIndex, layerId: layer.id });
                layer[key] = color;
                return;
            }
            layer[key] = value;
        });
    }

    function fontPatchValue(composition, font, commandIndex, layerId) {
        const next = { ...font };
        if (next.family !== undefined) {
            const families = ((composition.brandKit && composition.brandKit.fonts) || []).map((entry) => entry.family);
            if (families.length && !families.includes(next.family)) {
                failure('BRAND_FONT', `Font "${next.family}" is not in the brand kit.`, { commandIndex, layerId });
            }
        }
        return next;
    }

    function checkPatchApplicability(layer, patch, commandIndex) {
        if (layer.type === 'text') {
            IMAGE_ONLY_FIELDS.forEach((key) => {
                if (patch[key] !== undefined) failure('FIELD_NOT_APPLICABLE', `"${key}" does not apply to a text layer.`, { commandIndex, layerId: layer.id });
            });
            if (patch.text !== undefined && layer.bindings && layer.bindings.text) {
                failure('BOUND_TEXT', 'The layer text is bound to a variable; use set-variable instead.', { commandIndex, layerId: layer.id });
            }
        } else {
            TEXT_ONLY_FIELDS.forEach((key) => {
                if (patch[key] !== undefined) failure('FIELD_NOT_APPLICABLE', `"${key}" does not apply to an image layer.`, { commandIndex, layerId: layer.id });
            });
        }
    }

    function guardLayer(composition, config, layer, commandIndex, { removing = false } = {}) {
        if (layer.locked) {
            failure('LOCKED_LAYER', `Layer "${layer.name}" is locked.`, { commandIndex, layerId: layer.id });
        }
        if (config.protectedLayerIds.includes(layer.id)) {
            failure('PROTECTED_LAYER', `Layer "${layer.name}" is protected by the guardrail configuration.`, { commandIndex, layerId: layer.id });
        }
        if (removing && composition.referenceLayerId === layer.id) {
            failure('PROTECTED_LAYER', 'The reference layer cannot be removed.', { commandIndex, layerId: layer.id });
        }
    }

    function nextZ(composition, aboveId) {
        const layers = composition.layers || [];
        if (aboveId) {
            const anchor = getLayerById(composition, aboveId);
            if (anchor) {
                const z = finite(anchor.z, 0) + 1;
                layers.forEach((layer) => {
                    if (layer.id !== anchor.id && finite(layer.z, 0) >= z) layer.z = finite(layer.z, 0) + 1;
                });
                return z;
            }
        }
        return layers.reduce((max, layer) => Math.max(max, finite(layer.z, 0)), -1) + 1;
    }

    function applyCommand(composition, format, config, command, commandIndex) {
        const layers = composition.layers || [];
        switch (command.type) {
            case 'set-variable': {
                const variable = (composition.variables || []).find((entry) => entry.id === command.variableId);
                if (!variable) failure('UNKNOWN_VARIABLE', `No variable "${command.variableId}".`, { commandIndex });
                if (variable.locked) failure('FIELD_NOT_APPLICABLE', `Variable "${variable.id}" is locked.`, { commandIndex });
                const locale = command.locale || composition.defaultLocale || 'en';
                if (locale === (composition.defaultLocale || 'en')) {
                    variable.defaultValue = command.value;
                } else {
                    variable.values = { ...(variable.values || {}), [locale]: command.value };
                }
                return { touchedLayers: [], touchedVariables: [variable.id] };
            }
            case 'set-layer': {
                const layer = getLayerById(composition, command.layerId);
                if (!layer) failure('UNKNOWN_LAYER', `No layer "${command.layerId}".`, { commandIndex });
                guardLayer(composition, config, layer, commandIndex);
                checkPatchApplicability(layer, command.patch, commandIndex);
                writePatch(composition, format, layer, command.patch, commandIndex);
                return { touchedLayers: [layer.id] };
            }
            case 'add-layer': {
                if (layers.length >= MAX_LAYERS) failure('LIMIT_EXCEEDED', `A scene carries at most ${MAX_LAYERS} layers.`, { commandIndex });
                if (getLayerById(composition, command.layer.id)) {
                    failure('DUPLICATE_ID', `Layer "${command.layer.id}" already exists.`, { commandIndex, layerId: command.layer.id });
                }
                if (command.layer.bindText && !(composition.variables || []).some((entry) => entry.id === command.layer.bindText)) {
                    failure('UNKNOWN_VARIABLE', `No variable "${command.layer.bindText}".`, { commandIndex });
                }
                const layer = newLayerFromCommand(command.layer, composition);
                if (!layer) failure('UNKNOWN_ASSET', `Asset "${command.layer.assetRef?.name}" is not in the catalogue.`, { commandIndex });
                if (isMasterFormat(format)) {
                    if (command.above !== undefined && !getLayerById(composition, command.above)) {
                        failure('UNKNOWN_LAYER', `No layer "${command.above}".`, { commandIndex });
                    }
                    layer.z = nextZ(composition, command.above);
                } else {
                    layer.z = nextZ(composition, command.above);
                }
                layers.push(layer);
                return { touchedLayers: [layer.id] };
            }
            case 'remove-layer': {
                const layer = getLayerById(composition, command.layerId);
                if (!layer) failure('UNKNOWN_LAYER', `No layer "${command.layerId}".`, { commandIndex });
                guardLayer(composition, config, layer, commandIndex, { removing: true });
                composition.layers = layers.filter((entry) => entry.id !== layer.id);
                (composition.formats || []).forEach((entry) => {
                    if (entry.layerOverrides) delete entry.layerOverrides[layer.id];
                });
                return { touchedLayers: [layer.id] };
            }
            case 'duplicate-layer': {
                const layer = getLayerById(composition, command.layerId);
                if (!layer) failure('UNKNOWN_LAYER', `No layer "${command.layerId}".`, { commandIndex });
                if (getLayerById(composition, command.newId)) failure('DUPLICATE_ID', `Layer "${command.newId}" already exists.`, { commandIndex });
                if (layers.length >= MAX_LAYERS) failure('LIMIT_EXCEEDED', `A scene carries at most ${MAX_LAYERS} layers.`, { commandIndex });
                const copy = clone(layer);
                copy.id = command.newId;
                copy.name = `${layer.name} copy`.slice(0, 80);
                copy.z = nextZ(composition, layer.id);
                copy.keyframes = (copy.keyframes || []).map((frame) => ({ ...frame }));
                copy.bindings = { ...(copy.bindings || {}) };
                if (command.patch) {
                    checkPatchApplicability(copy, command.patch, commandIndex);
                    writePatch(composition, format, copy, command.patch, commandIndex);
                }
                layers.push(copy);
                return { touchedLayers: [copy.id] };
            }
            case 'reorder-layer': {
                const layer = getLayerById(composition, command.layerId);
                if (!layer) failure('UNKNOWN_LAYER', `No layer "${command.layerId}".`, { commandIndex });
                guardLayer(composition, config, layer, commandIndex);
                if (command.z !== undefined) {
                    layer.z = command.z;
                } else if (command.above !== undefined || command.below !== undefined) {
                    const anchorId = command.above || command.below;
                    const anchor = getLayerById(composition, anchorId);
                    if (!anchor || anchor.id === layer.id) failure('UNKNOWN_LAYER', `No usable anchor layer "${anchorId}".`, { commandIndex });
                    const ordered = layers.slice().sort((a, b) => finite(a.z, 0) - finite(b.z, 0)).filter((entry) => entry.id !== layer.id);
                    const index = ordered.findIndex((entry) => entry.id === anchor.id);
                    ordered.splice(command.above !== undefined ? index + 1 : index, 0, layer);
                    ordered.forEach((entry, order) => { entry.z = order; });
                }
                return { touchedLayers: [layer.id] };
            }
            case 'swap-asset': {
                const layer = getLayerById(composition, command.layerId);
                if (!layer) failure('UNKNOWN_LAYER', `No layer "${command.layerId}".`, { commandIndex });
                if (layer.type === 'text') failure('FIELD_NOT_APPLICABLE', 'swap-asset targets an image layer.', { commandIndex, layerId: layer.id });
                guardLayer(composition, config, layer, commandIndex);
                const asset = resolveAssetRef(command.asset, buildAssetCatalogue(composition));
                if (!asset) failure('UNKNOWN_ASSET', `Asset "${command.asset.name}" is not in the "${command.asset.catalog}" catalogue.`, { commandIndex });
                layer.url = asset.url;
                layer.frames = [asset.url];
                if (command.asset.catalog === 'logos') layer.fit = 'contain';
                if (command.focus) {
                    layer.focusX = clamp(finite(command.focus.x, 50), 0, 100);
                    layer.focusY = clamp(finite(command.focus.y, 50), 0, 100);
                }
                return { touchedLayers: [layer.id] };
            }
            case 'set-animation': {
                const layer = getLayerById(composition, command.layerId);
                if (!layer) failure('UNKNOWN_LAYER', `No layer "${command.layerId}".`, { commandIndex });
                guardLayer(composition, config, layer, commandIndex);
                if (command.preset === 'none') {
                    layer.keyframes = [];
                    return { touchedLayers: [layer.id] };
                }
                const start = command.startMs || 0;
                const span = command.durationMs || Math.max(100, composition.duration - start);
                const base = {
                    x: finite(layer.x, 0),
                    y: finite(layer.y, 0),
                    w: finite(layer.w, 1),
                    h: finite(layer.h, 1),
                    rotation: finite(layer.rotation, 0),
                    opacity: finite(layer.opacity, 1),
                };
                const frames = presetKeyframes(command.preset, base, span, presetParams(command.preset, command.intensity), command.easing);
                const loop = command.loop !== undefined ? command.loop : LOOPING_PRESETS.has(command.preset);
                layer.keyframes = frames.map((frame) => ({ ...frame, time: Math.round(clamp(frame.time + start, 0, composition.duration)) }))
                    .filter((frame, index, list) => index === 0 || frame.time !== list[index - 1].time);
                layer.animationLoop = loop;
                return { touchedLayers: [layer.id] };
            }
            case 'set-keyframes': {
                const layer = getLayerById(composition, command.layerId);
                if (!layer) failure('UNKNOWN_LAYER', `No layer "${command.layerId}".`, { commandIndex });
                guardLayer(composition, config, layer, commandIndex);
                const base = {
                    x: finite(layer.x, 0),
                    y: finite(layer.y, 0),
                    w: finite(layer.w, 1),
                    h: finite(layer.h, 1),
                    rotation: finite(layer.rotation, 0),
                    opacity: finite(layer.opacity, 1),
                };
                const frames = command.keyframes.map((frame) => {
                    if (frame.t > composition.duration) {
                        failure('TIMELINE_RANGE', `Keyframe at ${frame.t}ms is outside the ${composition.duration}ms scene.`, { commandIndex, layerId: layer.id, suggestion: `t<=${composition.duration}` });
                    }
                    const values = frame.values;
                    const scale = values.scale;
                    const width = scale !== undefined ? base.w * scale : (values.w ?? base.w);
                    const height = scale !== undefined ? base.h * scale : (values.h ?? base.h);
                    const centreX = base.x + (values.w !== undefined ? values.w : base.w) / 2;
                    const centreY = base.y + (values.h !== undefined ? values.h : base.h) / 2;
                    return {
                        time: frame.t,
                        x: values.x ?? (scale !== undefined ? centreX - width / 2 : base.x),
                        y: values.y ?? (scale !== undefined ? centreY - height / 2 : base.y),
                        w: width,
                        h: height,
                        rotation: values.rotation ?? base.rotation,
                        opacity: values.opacity ?? base.opacity,
                        ...(frame.easing ? { easing: INTERNAL_EASING[frame.easing] } : {}),
                    };
                });
                layer.keyframes = frames;
                return { touchedLayers: [layer.id] };
            }
            case 'clear-animation': {
                const layer = getLayerById(composition, command.layerId);
                if (!layer) failure('UNKNOWN_LAYER', `No layer "${command.layerId}".`, { commandIndex });
                guardLayer(composition, config, layer, commandIndex);
                layer.keyframes = [];
                return { touchedLayers: [layer.id] };
            }
            case 'set-format': {
                const formats = composition.formats || (composition.formats = []);
                let target = formats.find((entry) => entry.id === command.formatId);
                const master = formatOf(composition, 'master');
                if (!target) {
                    if (formats.length >= Core.MAX_FORMATS) failure('LIMIT_EXCEEDED', `A composition carries at most ${Core.MAX_FORMATS} formats.`, { commandIndex });
                    target = {
                        id: command.formatId,
                        label: command.label || command.formatId,
                        channel: command.channel || 'social',
                        width: command.width || master.width,
                        height: command.height || master.height,
                        layerOverrides: {},
                        variableValues: {},
                        safeZone: null,
                        pinnedLayerIds: [],
                    };
                    formats.push(target);
                    composition.activeFormatId = target.id;
                } else {
                    if (command.label !== undefined) target.label = command.label;
                    if (command.channel !== undefined) target.channel = command.channel;
                    if (command.width !== undefined) target.width = command.width;
                    if (command.height !== undefined) target.height = command.height;
                    if (command.safeZone !== undefined) target.safeZone = command.safeZone;
                }
                if (command.pinnedLayerIds) target.pinnedLayerIds = command.pinnedLayerIds.slice();
                if (command.layerOverrides) {
                    const overrides = { ...(target.layerOverrides || {}) };
                    Object.keys(command.layerOverrides).forEach((id) => {
                        const layer = getLayerById(composition, id);
                        if (!layer) failure('UNKNOWN_LAYER', `No layer "${id}".`, { commandIndex, layerId: id });
                        checkPatchApplicability(layer, command.layerOverrides[id], commandIndex);
                        const patch = command.layerOverrides[id];
                        const entry = { ...(overrides[id] || {}) };
                        Object.keys(patch).forEach((key) => {
                            if (key === 'font') {
                                if (patch.font.sizePct === undefined) failure('FIELD_NOT_APPLICABLE', 'A format override can only set font.sizePct.', { commandIndex, layerId: id });
                                entry.fontSizePct = patch.font.sizePct;
                            } else if (['x', 'y', 'w', 'h', 'rotation', 'opacity', 'visible', 'z'].includes(key)) {
                                entry[key] = patch[key];
                            } else {
                                failure('FIELD_NOT_APPLICABLE', `A format override cannot set "${key}".`, { commandIndex, layerId: id });
                            }
                        });
                        overrides[id] = entry;
                    });
                    target.layerOverrides = overrides;
                }
                return { touchedLayers: [] };
            }
            case 'set-scene-duration': {
                composition.duration = command.durationMs;
                const overflow = (composition.layers || []).filter((layer) => (layer.keyframes || []).some((frame) => frame.time > composition.duration));
                if (overflow.length) {
                    failure('TIMELINE_RANGE', `${overflow.length} layer(s) have keyframes after ${command.durationMs}ms.`, { commandIndex });
                }
                return { touchedLayers: [] };
            }
            default:
                failure('SCHEMA', `Unknown command "${command.type}".`, { commandIndex });
        }
        return { touchedLayers: [] };
    }

    function resultBase(status, revision, extras) {
        return {
            status,
            sceneRevision: revision,
            errors: [],
            warnings: [],
            ...extras,
        };
    }

    function rejected(issues, revision, sandboxId) {
        const result = resultBase('rejected', revision);
        result.errors = issues;
        if (sandboxId) result.sandboxId = sandboxId;
        return result;
    }

    /**
     * Applies a batch to a copy of the composition. Nothing is mutated in place.
     * Returns `{ result, composition }`; `composition` is null when rejected.
     */
    function applyBatch(composition, batch, options) {
        const settings = options || {};
        const sandboxId = settings.sandboxId || `sandbox-${Date.now().toString(36)}`;
        const baseRevision = revisionOf(composition);
        const schemaIssues = validateBatch(batch);
        if (schemaIssues.length) return { result: rejected(schemaIssues, baseRevision, sandboxId), composition: null };
        if (!settings.ignoreRevision && batch.baseRevision !== baseRevision) {
            return {
                result: rejected([issue('STALE_REVISION', `The scene is at revision ${baseRevision}, but the batch was planned against ${batch.baseRevision}.`, { suggestion: `baseRevision=${baseRevision}` })], baseRevision, sandboxId),
                composition: null,
            };
        }
        const wantedFormat = batch.formatId || 'master';
        const format = (Array.isArray(composition.formats) ? composition.formats : [])
            .find((entry) => entry.id === wantedFormat);
        if (!format) {
            return { result: rejected([issue('SCHEMA', `Format "${batch.formatId}" does not exist.`)], baseRevision, sandboxId), composition: null };
        }
        const config = mergeConfig(normalizeGuardrailConfig(composition.guardrails), settings.guardrails);
        const next = clone(composition);
        const nextFormat = formatOf(next, batch.formatId || 'master');
        const errors = [];
        const warnings = [];
        const touched = new Set();
        const touchedVariables = new Set();
        next.revision = baseRevision + 1;
        const atomic = batch.atomic !== false;

        for (let index = 0; index < batch.commands.length; index += 1) {
            try {
                const outcome = applyCommand(next, nextFormat, config, batch.commands[index], index);
                (outcome.touchedLayers || []).forEach((id) => touched.add(id));
                (outcome.touchedVariables || []).forEach((id) => touchedVariables.add(id));
            } catch (error) {
                if (!(error instanceof CommandFailure)) throw error;
                errors.push(...error.issues);
                if (atomic) break;
            }
        }

        if (errors.length && atomic) return { result: rejected(errors, baseRevision, sandboxId), composition: null };

        if (!settings.skipGuardrails) {
            const guard = runGuardrails(next, composition, {
                formatId: batch.formatId || 'master',
                touched,
                touchedVariables,
                batch,
                facts: settings.facts || composition.sourceFacts,
                bounds: settings.bounds,
                baselineBounds: settings.baselineBounds,
                assetSizes: settings.assetSizes,
                config,
            });
            errors.push(...guard.errors);
            warnings.push(...guard.warnings);
            if (guard.errors.length) return { result: rejected([...errors, ...warnings], baseRevision, sandboxId), composition: null };
        }

        const result = resultBase(settings.status || 'applied-to-sandbox', next.revision, { sandboxId });
        result.errors = errors;
        result.warnings = warnings;
        return { result, composition: next, touched, touchedVariables };
    }

    /** Completes a deferred apply once the caller has measured the render. */
    function finalizeBatch(original, batch, applied, options) {
        const settings = options || {};
        const config = mergeConfig(normalizeGuardrailConfig(original.guardrails), settings.guardrails);
        const bounds = settings.bounds || (typeof settings.measureFactory === 'function'
            ? measureBounds(applied, {
                formatId: batch.formatId,
                locale: settings.locale,
                measureFactory: settings.measureFactory,
                contrastByLayer: settings.contrastByLayer,
            })
            : undefined);
        const baselineBounds = settings.baselineBounds || (typeof settings.measureFactory === 'function'
            ? measureBounds(original, {
                formatId: batch.formatId,
                locale: settings.locale,
                measureFactory: settings.measureFactory,
            })
            : undefined);
        const guard = runGuardrails(applied, original, {
            formatId: batch.formatId || 'master',
            touched: new Set(settings.touched || []),
            touchedVariables: new Set(settings.touchedVariables || []),
            batch,
            facts: settings.facts || original.sourceFacts,
            bounds,
            baselineBounds,
            assetSizes: settings.assetSizes,
            config,
        });
        const result = resultBase(settings.status || 'applied-to-sandbox', revisionOf(applied), { sandboxId: settings.sandboxId });
        result.errors = guard.errors;
        result.warnings = guard.warnings;
        if (guard.errors.length) result.status = 'rejected';
        return { result, composition: guard.errors.length ? null : applied };
    }

    // ---------------------------------------------------------------------
    // Measurement + guardrails
    // ---------------------------------------------------------------------
    function resolveForFormat(composition, formatId, locale) {
        return {
            format: formatOf(composition, formatId),
            locale: locale || composition.defaultLocale || 'en',
        };
    }

    function measureBounds(composition, options) {
        const settings = options || {};
        const { format, locale } = resolveForFormat(composition, settings.formatId, settings.locale);
        const measureFactory = typeof settings.measureFactory === 'function'
            ? settings.measureFactory
            : null;
        return (composition.layers || []).filter((layer) => layer.visible !== false).map((raw) => {
            const layer = Core.resolveLayer(raw, { composition, format, locale });
            const bound = { layerId: layer.id, rect: { x: round(layer.x), y: round(layer.y), w: round(layer.w), h: round(layer.h) }, clipped: false };
            if (layer.type === 'text') {
                const layout = Core.layoutText({
                    font: layer.font,
                    text: layer.text,
                    boxWidthPx: Math.max(1, (layer.w / 100) * format.width),
                    boxHeightPx: Math.max(1, (layer.h / 100) * format.height),
                    formatHeightPx: format.height,
                    align: layer.align,
                    verticalAlign: layer.verticalAlign,
                    overflow: layer.overflow,
                    locale,
                    defaultLocale: composition.defaultLocale,
                    measureFactory,
                });
                const lineCount = layout.lines.length + layout.clippedLines;
                const naturalHeight = lineCount * layout.lineHeightPx;
                const boxHeightPx = Math.max(1, (layer.h / 100) * format.height);
                bound.textLines = lineCount;
                bound.clipped = layout.clipped === true
                    || (layer.overflow !== 'clip' && naturalHeight > boxHeightPx + 0.5);
                bound.naturalHeightPct = round((naturalHeight / format.height) * 100);
                if (layer.overflow !== 'clip' && naturalHeight > boxHeightPx + 0.5) bound.clipped = true;
            }
            if (settings.contrastByLayer && settings.contrastByLayer[layer.id] !== undefined) {
                bound.contrastRatio = settings.contrastByLayer[layer.id];
            }
            return bound;
        });
    }

    function runGuardrails(next, original, context) {
        const config = context.config;
        const errors = [];
        const warnings = [];
        const formatId = context.formatId || 'master';
        const { format, locale } = resolveForFormat(next, formatId);
        const touched = context.touched || new Set();
        const push = (rule, code, message, extra) => {
            const mode = config.rules[rule] || 'off';
            if (mode === 'off') return;
            const entry = issue(code, message, extra);
            (mode === 'block' ? errors : warnings).push(entry);
        };
        const boundsById = new Map((context.bounds || []).map((bound) => [bound.layerId, bound]));
        const baselineById = new Map((context.baselineBounds || []).map((bound) => [bound.layerId, bound]));
        const touchedLayers = (next.layers || []).filter((layer) => touched.has(layer.id)
            || (layer.bindings && layer.bindings.text && context.touchedVariables && context.touchedVariables.has(layer.bindings.text)));
        const palette = ((next.brandKit && next.brandKit.palette) || []).map((entry) => String(entry.hex).toLowerCase());
        const families = ((next.brandKit && next.brandKit.fonts) || []).map((entry) => entry.family);

        // Measured rules
        touchedLayers.forEach((layer) => {
            const bound = boundsById.get(layer.id);
            if (layer.type === 'text' && bound && bound.clipped) {
                const baseline = baselineById.get(layer.id);
                // A layer that already clipped before the batch is a pre-existing
                // layout problem, not a regression introduced by this command.
                if (!baseline || baseline.clipped !== true) {
                    const suggestion = bound.naturalHeightPct ? `h>=${round(bound.naturalHeightPct + 0.2, 1)}` : undefined;
                    push('TEXT_OVERFLOW', 'TEXT_OVERFLOW', `Text layer "${layer.name}" clips its box.`, { layerId: layer.id, suggestion });
                }
            }
            if (layer.type === 'text' && bound && Number.isFinite(bound.contrastRatio) && bound.contrastRatio < config.minContrast) {
                push('CONTRAST', 'CONTRAST', `Contrast ${bound.contrastRatio}:1 is below ${config.minContrast}:1 for "${layer.name}".`, { layerId: layer.id, suggestion: `contrast>=${config.minContrast}` });
            }
            if (layer.type === 'text' && config.rules.MIN_TEXT_SIZE !== 'off') {
                const size = finite(layer.font && layer.font.sizePct, 0);
                if (size > 0 && size < config.minTextSizePct) {
                    push('MIN_TEXT_SIZE', 'MIN_TEXT_SIZE', `Font size ${size}% is below the ${config.minTextSizePct}% floor.`, { layerId: layer.id, suggestion: `font.sizePct>=${config.minTextSizePct}` });
                }
            }
            if (config.rules.BRAND_FONT !== 'off' && layer.type === 'text' && families.length) {
                const family = layer.font && layer.font.family;
                if (family && !families.includes(family)) {
                    push('BRAND_FONT', 'BRAND_FONT', `Font "${family}" is not in the brand kit.`, { layerId: layer.id });
                }
            }
            if (config.rules.BRAND_COLOR !== 'off' && palette.length) {
                const colors = [layer.color, layer.recolorColor, layer.outlineColor].filter((value) => typeof value === 'string' && parseColor(value));
                colors.forEach((color) => {
                    const hex = String(color).toLowerCase();
                    if (!hex.startsWith('#') || palette.includes(hex)) return;
                    push('BRAND_COLOR', 'BRAND_COLOR', `Colour ${color} is not in the brand palette.`, { layerId: layer.id });
                });
            }
            if (config.rules.LOGO_INTEGRITY !== 'off' && /logo|wordmark|lockup|symbol/i.test(`${layer.name} ${layer.url}`)) {
                if (layer.recolorEnabled) {
                    push('LOGO_INTEGRITY', 'LOGO_INTEGRITY', `Logo "${layer.name}" is recoloured; use a brand logo variant.`, { layerId: layer.id });
                }
                if (layer.fit !== 'contain') {
                    push('LOGO_INTEGRITY', 'LOGO_INTEGRITY', `Logo "${layer.name}" must use fit "contain".`, { layerId: layer.id, suggestion: 'fit=contain' });
                }
                const size = context.assetSizes && (context.assetSizes[layer.url] || context.assetSizes[layer.id]);
                if (size && size.width && size.height) {
                    const expected = size.width / size.height;
                    const actual = (layer.w / 100 * format.width) / Math.max(1, layer.h / 100 * format.height);
                    if (Math.abs(actual - expected) / expected > 0.02) {
                        push('LOGO_INTEGRITY', 'LOGO_INTEGRITY', `Logo "${layer.name}" is stretched.`, { layerId: layer.id, suggestion: `h=${round(layer.w / expected * (format.width / format.height), 2)}` });
                    }
                }
            }
        });

        // Safe zone uses geometry, so it works without a render.
        if (config.rules.SAFE_ZONE !== 'off') {
            const touchedIds = new Set(touchedLayers.map((layer) => layer.id));
            Core.safeZoneViolations(next, { format, locale })
                .filter((violation) => touchedIds.has(violation.layerId))
                .forEach((violation) => {
                    push('SAFE_ZONE', 'SAFE_ZONE', `"${violation.name}" crosses the safe zone (${violation.edges.join(', ')}).`, { layerId: violation.layerId, suggestion: 'move inside the 8% margin' });
                });
        }

        // Invented facts: only text that actually changed is compared.
        if (config.rules.NO_INVENTED_FACTS !== 'off') {
            const before = new Map((original.layers || []).map((layer) => [layer.id, layer]));
            next.layers.forEach((layer) => {
                if (layer.type !== 'text') return;
                const previous = before.get(layer.id);
                const beforeText = previous ? String(previous.text || '') : '';
                const afterText = String(layer.text || '');
                if (beforeText === afterText) return;
                const facts = collectFacts(afterText);
                const allowed = `${beforeText} ${factsText(context.facts)} ${factsText(context.batch && context.batch.sourceFacts)} ${factsText(original.sourceFacts)}`.toLowerCase();
                facts.forEach((fact) => {
                    if (!allowed.includes(fact.toLowerCase())) {
                        push('NO_INVENTED_FACTS', 'NO_INVENTED_FACTS', `Text adds "${fact}", which is not in sourceFacts.`, { layerId: layer.id });
                    }
                });
            });
        }
        return { errors, warnings };
    }

    const FACT_PATTERNS = [
        /https?:\/\/[^\s)]+/gi,
        /\bwww\.[^\s)]+/gi,
        /[£$€]\s?\d[\d.,]*/g,
        /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi,
        /\b\d{1,2}:\d{2}\b/g,
        /\b\d[\d\s()-]{7,}\d\b/g,
    ];

    function collectFacts(text) {
        const found = [];
        FACT_PATTERNS.forEach((pattern) => {
            const matches = String(text).match(pattern);
            if (matches) matches.forEach((match) => found.push(match.trim()));
        });
        return [...new Set(found)];
    }

    function factsText(value) {
        if (!value) return '';
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) return value.join(' ');
        if (typeof value === 'object') return Object.values(value).map(factsText).join(' ');
        return String(value);
    }

    // ---------------------------------------------------------------------
    // Snapshot
    // ---------------------------------------------------------------------
    function createSnapshot(composition, options) {
        const settings = options || {};
        const format = formatOf(composition, settings.formatId || composition.activeFormatId || 'master');
        const bounds = settings.bounds || measureBounds(composition, {
            formatId: format.id,
            measureFactory: settings.measureFactory,
            contrastByLayer: settings.contrastByLayer,
        });
        const config = mergeConfig(normalizeGuardrailConfig(composition.guardrails), settings.guardrails);
        const snapshot = {
            revision: revisionOf(composition),
            scene: clone(composition),
            render: {
                formatId: format.id,
                pngBase64: settings.pngBase64 || '',
                layerBounds: bounds,
            },
            assets: buildAssetCatalogue(composition),
            brandKit: composition.brandKit ? clone(composition.brandKit) : null,
            guardrails: config,
            sourceFacts: settings.sourceFacts || composition.sourceFacts || {},
        };
        return snapshot;
    }

    // ---------------------------------------------------------------------
    // Five layout concepts (deterministic stand-in for an agent planner)
    // ---------------------------------------------------------------------
    function paletteRoles(composition) {
        const palette = ((composition.brandKit && composition.brandKit.palette) || []).map((entry) => ({
            name: String(entry.name).toLowerCase(),
            hex: String(entry.hex).toLowerCase(),
        }));
        const find = (...needles) => palette.find((entry) => needles.some((needle) => entry.name.includes(needle)));
        const withLuminance = palette.map((entry) => ({ ...entry, luminance: relativeLuminance(parseColor(entry.hex) || [0, 0, 0]) }));
        const sorted = withLuminance.slice().sort((a, b) => a.luminance - b.luminance);
        return {
            ink: find('ink') || sorted[0],
            bone: find('bone') || sorted.find((entry) => entry.name !== 'chalk') || sorted[sorted.length - 1],
            chalk: find('chalk', 'white') || sorted[sorted.length - 1],
            accent: find('vermilion', 'orange', 'signal') || palette.find((entry) => !['bone', 'chalk', 'ink'].includes(entry.name)) || sorted[sorted.length - 1],
            sand: find('sand') || sorted[sorted.length - 2],
            umber: find('umber') || sorted[0],
        };
    }

    function detectRoles(composition) {
        const layers = (composition.layers || []).filter((layer) => layer.visible !== false);
        const images = layers.filter((layer) => layer.type !== 'text');
        const texts = layers.filter((layer) => layer.type === 'text');
        const byName = (pattern) => layers.find((layer) => pattern.test(`${layer.name} ${layer.url || ''}`));
        const ground = byName(/ground|background/i) || images.slice().sort((a, b) => a.z - b.z)[0];
        const logo = byName(/logo|wordmark|lockup|symbol/i);
        const photo = images.filter((layer) => layer !== ground && layer !== logo)
            .sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
        const headline = texts.slice().sort((a, b) => finite(b.font && b.font.sizePct, 0) - finite(a.font && a.font.sizePct, 0))[0];
        const byText = (pattern) => texts.find((layer) => pattern.test(layer.name) || pattern.test(String(layer.text || '')));
        const footer = byText(/footer|legal|address/i);
        const cta = byText(/cta|call to action|button|book/i);
        const body = byText(/body|copy|description/i);
        const subhead = byText(/sub|tag|kicker/i);
        return { ground, photo, logo, headline, cta, body, subhead, footer, layers, texts, images };
    }

    function setLayer(id, patch) {
        return { type: 'set-layer', layerId: id, patch };
    }

    function animation(id, preset, startMs, durationMs) {
        return { type: 'set-animation', layerId: id, preset, startMs, durationMs };
    }

    /**
     * `set-animation` only carries `intensity`, so full-bleed motion that must
     * never expose the ground is written as explicit keyframes instead.
     */
    function keyframes(id, frames) {
        return { type: 'set-keyframes', layerId: id, keyframes: frames };
    }

    /**
     * Five distinct concepts for the current scene. Each batch is schema-shaped,
     * references real layer ids only, and depends on palette roles rather than
     * hard-coded brand names, so the same recipes work for another template.
     */
    function proposeLayoutVariants(composition, options) {
        const settings = options || {};
        const roles = paletteRoles(composition);
        const found = detectRoles(composition);
        const revision = revisionOf(composition);
        const sceneId = composition.id || 'composition';
        const formatId = settings.formatId || composition.activeFormatId || 'master';
        const base = { schema: SCHEMA_ID, sceneId, baseRevision: revision, formatId };
        const color = (role) => (role && role.hex) || '#000000';
        const batches = [];

        const push = (label, rationale, commands) => {
            const valid = commands.filter(Boolean);
            if (!valid.length) return;
            batches.push({ ...base, label, rationale, atomic: true, commands: valid });
        };

        if (found.ground && found.photo && found.headline) {
            const { ground, photo, headline, subhead, body, cta, footer, logo } = found;
            push('A · Photo-led', 'Photo grows to two thirds and melts into warm Umber. Text sits on the scrim.', [
                setLayer(ground.id, { recolorEnabled: true, recolorColor: color(roles.umber) }),
                setLayer(photo.id, { x: -2, y: 0, w: 104, h: 67 }),
                { type: 'add-layer', above: photo.id, layer: { id: 'layout-a-scrim', type: 'gradient', role: 'background', box: { x: 0, y: 36, w: 100, h: 30.2 }, gradient: { angleDeg: 180, stops: [{ at: 0, color: 'rgba(0, 0, 0, 0)' }, { at: 1, color: color(roles.umber) }] } } },
                setLayer(headline.id, { y: 57, h: 13, color: color(roles.bone), font: { sizePct: 5.8 } }),
                subhead && setLayer(subhead.id, { y: 70.5, h: 5, color: color(roles.sand) }),
                body && setLayer(body.id, { y: 76.5, h: 7.5, color: color(roles.bone) }),
                footer && setLayer(footer.id, { y: 85.2, color: color(roles.bone) }),
                cta && setLayer(cta.id, { y: 88, h: 3, color: color(roles.sand) }),
                keyframes(photo.id, [
                    { t: 0, values: { scale: 1.1 } },
                    { t: 10000, easing: 'ease-in-out', values: { scale: 1.02 } },
                ]),
                animation(headline.id, 'fadeIn', 300, 900),
            ].filter(Boolean));

            push('B · Ink night', 'Brand ink ground, Bone type, Vermilion accents. CTA pulses.', [
                setLayer(ground.id, { recolorEnabled: true, recolorColor: color(roles.ink) }),
                setLayer(photo.id, { h: 52 }),
                setLayer(headline.id, { y: 54, color: color(roles.bone) }),
                subhead && setLayer(subhead.id, { color: color(roles.accent) }),
                body && setLayer(body.id, { color: color(roles.bone) }),
                footer && setLayer(footer.id, { color: color(roles.bone) }),
                cta && setLayer(cta.id, { color: color(roles.accent) }),
                cta && animation(cta.id, 'pulse', 3000, 2400),
            ].filter(Boolean));

            push('C · Framed editorial', 'Photo inset inside the margins like a print; ink wordmark below; CTA closes the stack.', [
                setLayer(photo.id, { x: 8, y: 8, w: 84, h: 42 }),
                logo && { type: 'swap-asset', layerId: logo.id, asset: { catalog: 'logos', name: 'physician wordmark ink', variant: 'svg' } },
                logo && setLayer(logo.id, { x: 8, y: 51.5, w: 22, h: 5 }),
                setLayer(headline.id, { y: 59, h: 14, font: { sizePct: 5.4 } }),
                subhead && setLayer(subhead.id, { y: 73.5, h: 4.5 }),
                body && setLayer(body.id, { y: 79, h: 7.2 }),
                footer && setLayer(footer.id, { y: 86.8 }),
                cta && setLayer(cta.id, { y: 88.8 }),
            ].filter(Boolean));

            push('D · Type poster', 'Vermilion ground, oversized headline on top, photo as a band, wordmark over the photo.', [
                setLayer(ground.id, { recolorEnabled: true, recolorColor: color(roles.accent) }),
                setLayer(headline.id, { y: 8, h: 28, color: color(roles.chalk), font: { sizePct: 7.8 } }),
                subhead && setLayer(subhead.id, { y: 36.5, h: 4.5, color: color(roles.ink) }),
                setLayer(photo.id, { x: 8, y: 42, w: 84, h: 38 }),
                logo && setLayer(logo.id, { x: 10, y: 74, w: 22, h: 5 }),
                body && setLayer(body.id, { y: 80.3, h: 6.5, color: color(roles.ink), opacity: 0.9, font: { sizePct: 1.4 } }),
                cta && setLayer(cta.id, { y: 87.2, h: 2.6, color: color(roles.chalk) }),
                footer && setLayer(footer.id, { y: 89.9, h: 2.1, color: color(roles.ink), opacity: 0.8 }),
            ].filter(Boolean));
        }

        push('E · Motion', 'Master layout, built for digital: parallax photo, staggered text entrance, pulsing CTA.', [
            found.photo && setLayer(found.photo.id, { x: -2, w: 104 }),
            found.photo && keyframes(found.photo.id, [
                { t: 0, values: { x: -4 } },
                { t: 5000, easing: 'ease-in-out', values: { x: -2 } },
                { t: 10000, easing: 'ease-in-out', values: { x: 0 } },
            ]),
            found.headline && animation(found.headline.id, 'fadeIn', 400, 900),
            found.subhead && animation(found.subhead.id, 'fadeIn', 900, 900),
            found.body && animation(found.body.id, 'fadeIn', 1300, 900),
            found.cta && animation(found.cta.id, 'pulse', 3000, 2400),
        ].filter(Boolean));

        if (found.logo && found.headline) {
            push('F · Wordmark first', 'The wordmark leads and the headline becomes the anchor line beneath it.', [
                setLayer(found.logo.id, { x: 8, y: 10, w: 30, h: 6.5 }),
                setLayer(found.headline.id, { y: 20, h: 12, font: { sizePct: 5 } }),
                found.photo && setLayer(found.photo.id, { y: 36, h: 52 }),
                found.body && setLayer(found.body.id, { y: 90, h: 0.1, visible: false }),
            ].filter(Boolean));
        }

        return batches.slice(0, settings.count || 5);
    }

    return {
        SCHEMA_ID,
        COMMAND_TYPES,
        PRESETS,
        DEFAULT_RULES,
        LAYER_ID,
        PRESET_PARAMS: presetParams,
        validateBatch,
        applyBatch,
        finalizeBatch,
        createSnapshot,
        buildAssetCatalogue,
        resolveAssetRef,
        resolveColor: normalizeColor,
        measureBounds,
        normalizeGuardrailConfig,
        evaluateGuardrails: runGuardrails,
        presetKeyframes,
        proposeLayoutVariants,
        contrastRatio,
        revisionOf,
        getLayerById,
        formatOf,
    };
}));
