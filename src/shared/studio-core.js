'use strict';
/**
 * studio-core.js — shared, framework-free primitives for Layer Studio.
 *
 * This module holds the schema normalisers and the pure resolution functions that
 * every render path must share:
 *
 *   layoutText()          one text layout used by the DOM, canvas and SVG renderers
 *   resolveLayer()        the single render path (format overrides + variable bindings)
 *   resolveVariables()    effective variable values for a (composition, format)
 *   applyBindings()       substitute bound layer fields with variable values
 *   normalizeFormats()    per-composition format list (multi-format)
 *   normalizeVariables()  typed template slots
 *   normalizeBrandKit()   palette / fonts / logos
 *   validateAgainstBrandKit()  non-blocking brand-drift report
 *
 * It has no DOM dependencies: the canvas measurer is injected through
 * buildTextMetrics(), so the module runs unchanged under Node for tests.
 *
 * Loaded as a plain <script> before _.js and also require()-able.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StudioCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    // ---------------------------------------------------------------------
    // Small helpers (kept local so this file stays dependency-free)
    // ---------------------------------------------------------------------
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
    const round2 = (value) => Math.round(Number(value) * 100) / 100;
    const HEX_COLOR = /^#[0-9a-f]{6}$/i;
    const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
    const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);/i;

    const DEFAULT_LOCALE = 'en';

    // ---------------------------------------------------------------------
    // Layer / text vocabulary
    // ---------------------------------------------------------------------
    const LAYER_TYPES = ['image', 'text'];
    const TEXT_ALIGNMENTS = ['left', 'center', 'right'];
    const VERTICAL_ALIGNMENTS = ['top', 'middle', 'bottom'];
    const TEXT_TRANSFORMS = ['none', 'uppercase', 'lowercase', 'capitalize'];
    const TEXT_OVERFLOWS = ['clip', 'visible'];
    const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
    const FONT_STYLES = ['normal', 'italic'];

    const MAX_TEXT_LENGTH = 4000;
    const MAX_TEXT_SIZES = 40;

    /** Families that never need a FontFace round-trip. */
    const SYSTEM_FONT_FAMILIES = [
        'Inter',
        'Helvetica',
        'Helvetica Neue',
        'Arial',
        'Georgia',
        'Times New Roman',
        'Verdana',
        'Tahoma',
        'Courier New',
        'system-ui',
        'ui-sans-serif',
        'ui-serif',
        'ui-monospace',
        '-apple-system',
        'sans-serif',
        'serif',
        'monospace',
    ];

    const FONT_SIZE_PCT = { min: 0.5, max: 30, fallback: 9 };
    const LINE_HEIGHT = { min: 0.8, max: 3, fallback: 1.15 };
    const LETTER_SPACING_EM = { min: -0.1, max: 0.5, fallback: 0 };

    const TEXT_LAYER_DEFAULTS = {
        text: 'Your headline here',
        font: {
            family: 'Inter',
            weight: 700,
            style: 'normal',
            sizePct: 9,
            lineHeight: 1.15,
            letterSpacingEm: 0,
            transform: 'none',
        },
        color: '#111111',
        align: 'left',
        verticalAlign: 'middle',
        overflow: 'clip',
    };

    // Scripts that wrap between any two characters when no word boundary fits.
    const CJK_RANGES = [
        [0x1100, 0x11FF],
        [0x2E80, 0x2FDF],
        [0x3000, 0x303F],
        [0x3040, 0x30FF],
        [0x3130, 0x318F],
        [0x3400, 0x4DBF],
        [0x4E00, 0x9FFF],
        [0xA960, 0xA97F],
        [0xAC00, 0xD7FF],
        [0xF900, 0xFAFF],
        [0xFE30, 0xFE4F],
        [0xFF00, 0xFFEF],
    ];

    const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur', 'yi', 'dv', 'ps'];

    function isCjkCodePoint(codePoint) {
        return CJK_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
    }

    function isCjkChar(char) {
        if (!char) return false;
        return isCjkCodePoint(char.codePointAt(0));
    }

    function directionForLocale(locale) {
        const language = String(locale || DEFAULT_LOCALE).toLowerCase().split(/[-_]/)[0];
        return RTL_LANGUAGES.includes(language) ? 'rtl' : 'ltr';
    }

    function isSystemFont(family) {
        const name = String(family || '').trim();
        return SYSTEM_FONT_FAMILIES.some((candidate) => candidate.toLowerCase() === name.toLowerCase());
    }

    function sanitizeId(value, fallback) {
        const text = String(value ?? '').trim();
        return ID_PATTERN.test(text) ? text : fallback;
    }

    // ---------------------------------------------------------------------
    // Text normalisation
    // ---------------------------------------------------------------------
    function normalizeTextFont(value) {
        const source = value && typeof value === 'object' ? value : {};
        const weight = Number(source.weight);
        const sizePct = finite(source.sizePct, FONT_SIZE_PCT.fallback);
        return {
            family: typeof source.family === 'string' && source.family.trim()
                ? source.family.trim().slice(0, 80)
                : TEXT_LAYER_DEFAULTS.font.family,
            weight: FONT_WEIGHTS.includes(weight) ? weight : TEXT_LAYER_DEFAULTS.font.weight,
            style: FONT_STYLES.includes(source.style) ? source.style : TEXT_LAYER_DEFAULTS.font.style,
            sizePct: round2(clamp(sizePct, FONT_SIZE_PCT.min, FONT_SIZE_PCT.max)),
            lineHeight: round2(clamp(finite(source.lineHeight, LINE_HEIGHT.fallback), LINE_HEIGHT.min, LINE_HEIGHT.max)),
            letterSpacingEm: round2(clamp(
                finite(source.letterSpacingEm, LETTER_SPACING_EM.fallback),
                LETTER_SPACING_EM.min,
                LETTER_SPACING_EM.max,
            )),
            transform: TEXT_TRANSFORMS.includes(source.transform) ? source.transform : 'none',
        };
    }

    /**
     * `text` is either a plain string or a locale map: { en: '…', 'pt-BR': '…' }.
     * Both forms are preserved so Phase 3 locale export can read the map.
     */
    function normalizeTextValue(value) {
        if (typeof value === 'string') return value.slice(0, MAX_TEXT_LENGTH);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const result = {};
            Object.keys(value).slice(0, MAX_TEXT_SIZES).forEach((key) => {
                const locale = String(key).trim().slice(0, 24);
                if (!locale) return;
                if (typeof value[key] === 'string') result[locale] = value[key].slice(0, MAX_TEXT_LENGTH);
            });
            return result;
        }
        return '';
    }

    function normalizeBindings(value) {
        const source = value && typeof value === 'object' ? value : {};
        const result = {};
        ['text', 'color', 'url'].forEach((key) => {
            const id = source[key];
            if (typeof id === 'string' && ID_PATTERN.test(id)) result[key] = id;
        });
        return result;
    }

    function normalizeTextSpec(values) {
        const source = values && typeof values === 'object' ? values : {};
        return {
            text: normalizeTextValue(source.text),
            font: normalizeTextFont(source.font),
            color: HEX_COLOR.test(source.color) ? String(source.color).toLowerCase() : TEXT_LAYER_DEFAULTS.color,
            align: TEXT_ALIGNMENTS.includes(source.align) ? source.align : TEXT_LAYER_DEFAULTS.align,
            verticalAlign: VERTICAL_ALIGNMENTS.includes(source.verticalAlign)
                ? source.verticalAlign
                : TEXT_LAYER_DEFAULTS.verticalAlign,
            overflow: source.overflow === 'visible' ? 'visible' : 'clip',
        };
    }

    /** Picks the best string for a locale out of the string-or-map `text` field. */
    function resolveLocaleText(text, locale, fallbackLocale) {
        if (typeof text === 'string') return text;
        if (!text || typeof text !== 'object') return '';
        const keys = Object.keys(text);
        if (!keys.length) return '';
        const primary = String(locale || '').trim();
        if (primary && typeof text[primary] === 'string') return text[primary];
        const fallback = String(fallbackLocale || DEFAULT_LOCALE).trim();
        if (fallback && typeof text[fallback] === 'string') return text[fallback];
        for (const key of keys) {
            if (typeof text[key] === 'string' && text[key]) return text[key];
        }
        return '';
    }

    function applyTextTransform(text, transform) {
        const value = String(text ?? '');
        if (transform === 'uppercase') return value.toUpperCase();
        if (transform === 'lowercase') return value.toLowerCase();
        if (transform === 'capitalize') {
            return value.replace(/(^|\s)(\S)/g, (match, lead, char) => `${lead}${char.toUpperCase()}`);
        }
        return value;
    }

    // ---------------------------------------------------------------------
    // Fonts → CSS / canvas strings
    // ---------------------------------------------------------------------
    const GENERIC_FAMILIES = new Set([
        'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace',
        'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
        'inherit', 'initial', 'unset', '-apple-system',
    ]);

    function cssFontFamily(family) {
        const name = String(family || '').trim() || TEXT_LAYER_DEFAULTS.font.family;
        if (GENERIC_FAMILIES.has(name.toLowerCase())) return name;
        const escaped = name.replace(/["\\]/g, '');
        return `"${escaped}", sans-serif`;
    }

    function cssFontString(font, sizePx) {
        const spec = normalizeTextFont(font);
        const size = Math.max(1, finite(sizePx, 16));
        return `${spec.style} ${spec.weight} ${round2(size)}px ${cssFontFamily(spec.family)}`;
    }

    /**
     * Builds the measurement adapter layoutText needs from a 2D context.
     * Ratios are reported relative to `sizePx` so the same numbers work at the
     * format scale and at any export scale.
     */
    function buildTextMetrics(context, options) {
        const source = options || {};
        const weight = Number(source.weight);
        const sizePx = Math.max(1, finite(source.sizePx, 16));
        const letterSpacingEm = finite(source.letterSpacingEm, 0);
        const spacing = letterSpacingEm * sizePx;
        context.font = `${FONT_STYLES.includes(source.style) ? source.style : 'normal'} ${FONT_WEIGHTS.includes(weight) ? weight : 400} ${round2(sizePx)}px ${cssFontFamily(source.family)}`;
        const supportsLetterSpacing = 'letterSpacing' in context;
        if (supportsLetterSpacing) context.letterSpacing = `${round2(spacing)}px`;
        const sample = context.measureText('Hg');
        const ascent = Number(sample.fontBoundingBoxAscent);
        const descent = Number(sample.fontBoundingBoxDescent);
        const measureWidth = (value) => {
            const str = String(value ?? '');
            if (!str) return 0;
            const base = context.measureText(str).width;
            return supportsLetterSpacing ? base : base + spacing * str.length;
        };
        return {
            sizePx,
            supportsLetterSpacing,
            ascentRatio: Number.isFinite(ascent) && ascent > 0 ? ascent / sizePx : 0.8,
            descentRatio: Number.isFinite(descent) && descent > 0 ? descent / sizePx : 0.2,
            measureWidth,
        };
    }

    /** Deterministic fallback used when no canvas is available (tests, SSR). */
    function fallbackTextMetrics(sizePx, options) {
        const source = options || {};
        const size = Math.max(1, finite(sizePx, 16));
        const letterSpacingEm = finite(source.letterSpacingEm, 0);
        const advance = size * 0.58 + letterSpacingEm * size;
        return {
            sizePx: size,
            supportsLetterSpacing: true,
            ascentRatio: 0.8,
            descentRatio: 0.2,
            measureWidth: (value) => String(value ?? '').length * advance,
        };
    }

    // ---------------------------------------------------------------------
    // Typesetting
    // ---------------------------------------------------------------------
    const SPACE_CHARS = new Set([' ', '\t', '\u00a0']);

    function breakUnits(text, measureWidth) {
        const units = [];
        let buffer = '';
        const flush = () => {
            if (!buffer) return;
            units.push({ text: buffer, width: measureWidth(buffer), space: false });
            buffer = '';
        };
        for (const char of String(text ?? '')) {
            if (SPACE_CHARS.has(char)) {
                flush();
                units.push({ text: ' ', width: measureWidth(' '), space: true });
                continue;
            }
            if (isCjkChar(char)) {
                flush();
                units.push({ text: char, width: measureWidth(char), space: false });
                continue;
            }
            buffer += char;
        }
        flush();
        return units;
    }

    /**
     * layoutText — the one typesetter used by DOM, canvas and SVG.
     *
     * All coordinates are returned in *format* pixels with a top-left origin on
     * the layer box. `sizePct` is a percentage of the format height, which is
     * what lets one headline scale across every format without overrides.
     *
     * options:
     *   text              string | { locale: string }
     *   font              normalised or raw font spec
     *   boxWidthPx        layer box width in format px
     *   boxHeightPx       layer box height in format px
     *   formatHeightPx    format height in format px (drives sizePct)
     *   locale            locale key for the text map
     *   defaultLocale     fallback locale key
     *   align, verticalAlign, overflow
     *   measureFactory    ({ family, weight, style, sizePx, letterSpacingEm }) => metrics
     *
     * Returns:
     *   { sizePx, lineHeightPx, lines: [{ text, x, y, baselineY, width }],
     *     totalHeight, direction, clipped }
     */
    function layoutText(options) {
        const source = options || {};
        const font = normalizeTextFont(source.font);
        const boxWidthPx = Math.max(1, finite(source.boxWidthPx, 1));
        const boxHeightPx = Math.max(1, finite(source.boxHeightPx, 1));
        const formatHeightPx = Math.max(1, finite(source.formatHeightPx, boxHeightPx));
        const align = TEXT_ALIGNMENTS.includes(source.align) ? source.align : 'left';
        const verticalAlign = VERTICAL_ALIGNMENTS.includes(source.verticalAlign) ? source.verticalAlign : 'top';
        const overflow = source.overflow === 'visible' ? 'visible' : 'clip';
        const locale = source.locale;
        const defaultLocale = source.defaultLocale || DEFAULT_LOCALE;
        const direction = directionForLocale(locale || defaultLocale);

        const sizePx = Math.max(1, font.sizePct / 100 * formatHeightPx);
        const lineHeightPx = Math.max(1, sizePx * font.lineHeight);

        const metrics = typeof source.metrics === 'object' && source.metrics
            ? source.metrics
            : (typeof source.measureFactory === 'function'
                ? source.measureFactory({ ...font, sizePx })
                : fallbackTextMetrics(sizePx, font));

        const raw = applyTextTransform(
            resolveLocaleText(source.text, locale, defaultLocale),
            font.transform,
        );

        const lines = [];
        let cursorY = 0;
        const pushLine = (parts, width) => {
            lines.push({ text: parts.map((unit) => unit.text).join(''), width, y: cursorY });
            cursorY += lineHeightPx;
        };

        String(raw).split('\n').forEach((segment) => {
            const units = breakUnits(segment, metrics.measureWidth);
            if (!units.length) {
                pushLine([], 0);
                return;
            }
            let current = [];
            let currentWidth = 0;
            units.forEach((unit) => {
                if (unit.space) {
                    if (!current.length) return; // never start a line with a space
                    const nextWidth = currentWidth + unit.width;
                    if (nextWidth <= boxWidthPx) {
                        current.push(unit);
                        currentWidth = nextWidth;
                    } else {
                        pushLine(current, currentWidth);
                        current = [];
                        currentWidth = 0;
                    }
                    return;
                }
                const nextWidth = currentWidth + unit.width;
                if (!current.length || nextWidth <= boxWidthPx) {
                    current.push(unit);
                    currentWidth = nextWidth;
                    return;
                }
                // Trim the trailing space of the line we are about to close.
                while (current.length && current[current.length - 1].space) {
                    currentWidth -= metrics.measureWidth(' ');
                    current.pop();
                }
                pushLine(current, Math.max(0, currentWidth));
                current = [unit];
                currentWidth = unit.width;
            });
            while (current.length && current[current.length - 1].space) {
                currentWidth -= metrics.measureWidth(' ');
                current.pop();
            }
            pushLine(current, Math.max(0, currentWidth));
        });

        const ascent = metrics.ascentRatio * sizePx;
        const descent = metrics.descentRatio * sizePx;
        const halfLeading = (lineHeightPx - (ascent + descent)) / 2;
        const baselineOffset = halfLeading + ascent;

        let clipped = false;
        let visible = lines;
        if (overflow === 'clip') {
            // Only lines that fit *entirely* survive: a half-cut glyph would look
            // identical on screen and in an export, but it reads as a bug.
            visible = lines.filter((line) => line.y + lineHeightPx <= boxHeightPx + 0.5);
            clipped = visible.length !== lines.length;
        }

        const totalHeight = visible.length * lineHeightPx;
        let offsetY = 0;
        if (verticalAlign === 'middle') offsetY = Math.max(0, (boxHeightPx - totalHeight) / 2);
        else if (verticalAlign === 'bottom') offsetY = Math.max(0, boxHeightPx - totalHeight);

        const laidOut = visible.map((line) => {
            let x = 0;
            if (align === 'center') x = (boxWidthPx - line.width) / 2;
            else if (align === 'right') x = boxWidthPx - line.width;
            const y = line.y + offsetY;
            return {
                text: line.text,
                x: round2(x),
                y: round2(y),
                baselineY: round2(y + baselineOffset),
                width: round2(line.width),
            };
        });

        return {
            sizePx: round2(sizePx),
            lineHeightPx: round2(lineHeightPx),
            lines: laidOut,
            totalHeight: round2(totalHeight),
            direction,
            clipped,
            clippedLines: lines.length - visible.length,
            font,
            align,
            verticalAlign,
            overflow,
        };
    }

    const MIN_TEXT_SIZE_PCT = 0.5;
    const MAX_TEXT_SIZE_PCT = 30;

    /**
     * Plans the smallest edit that reveals every clipped line of a text layer.
     *
     * Preference order, so the fix disturbs the design as little as possible:
     *   1. keep the type size and grow the box (down to `maxH`),
     *   2. keep the box and reduce the type size (down to `minSizePct`),
     *   3. grow the box and reduce the type size together.
     *
     * Pure: it never mutates the layer. Returns null when nothing fits.
     *
     * options:
     *   w, h        the box to start from (defaults to baseW/baseH, then w/h)
     *   maxH        the tallest the box may become; defaults to h (no growth)
     *   minSizePct  the smallest type size that is still acceptable
     *   locale, defaultLocale, measureFactory  forwarded to layoutText()
     */
    function planTextFit(layer, format, options = {}) {
        const source = layer && typeof layer === 'object' ? layer : {};
        const spec = format && finite(format.width, 0) > 0 && finite(format.height, 0) > 0
            ? format
            : { width: 1080, height: 1080 };
        const font = normalizeTextFont(source.font);
        const startSizePct = clamp(
            finite(font.sizePct, TEXT_LAYER_DEFAULTS.font.sizePct),
            MIN_TEXT_SIZE_PCT,
            MAX_TEXT_SIZE_PCT,
        );
        const widthPct = Math.max(0.5, finite(options.w, finite(source.baseW, finite(source.w, 100))));
        const baseHeightPct = Math.max(0.5, finite(options.h, finite(source.baseH, finite(source.h, 10))));
        const maxHeightPct = Math.max(baseHeightPct, finite(options.maxH, baseHeightPct));
        const minSizePct = clamp(
            finite(options.minSizePct, round2(startSizePct * 0.5)),
            MIN_TEXT_SIZE_PCT,
            startSizePct,
        );
        const locale = options.locale || '';
        const defaultLocale = options.defaultLocale || DEFAULT_LOCALE;
        const measureFactory = typeof options.measureFactory === 'function' ? options.measureFactory : null;

        const layoutAt = (sizePct, heightPct) => layoutText({
            text: source.text,
            font: { ...font, sizePct },
            boxWidthPx: Math.max(1, widthPct / 100 * spec.width),
            boxHeightPx: Math.max(1, heightPct / 100 * spec.height),
            formatHeightPx: Math.max(1, spec.height),
            locale,
            defaultLocale,
            align: source.align,
            verticalAlign: source.verticalAlign,
            overflow: source.overflow,
            ...(measureFactory ? { measureFactory } : {}),
        });
        if (source.overflow === 'visible') return null;
        const current = layoutAt(startSizePct, baseHeightPct);
        if (!current.clippedLines) return null;
        const fits = (sizePct, heightPct) => layoutAt(sizePct, heightPct).clippedLines === 0;

        const smallestFittingHeight = (sizePct) => {
            if (maxHeightPct - baseHeightPct < 0.05) return null;
            if (!fits(sizePct, maxHeightPct)) return null;
            if (fits(sizePct, baseHeightPct)) return baseHeightPct;
            let lo = baseHeightPct, hi = maxHeightPct;
            for (let step = 0; step < 26; step += 1) {
                const mid = (lo + hi) / 2;
                if (fits(sizePct, mid)) hi = mid;
                else lo = mid;
            }
            let height = Math.min(maxHeightPct, Math.ceil(hi * 10) / 10);
            while (height > baseHeightPct && !fits(sizePct, height)) height = round2(height - 0.1);
            return height > baseHeightPct ? height : null;
        };
        const largestFittingSize = (heightPct) => {
            if (!fits(minSizePct, heightPct)) return null;
            if (fits(startSizePct, heightPct)) return startSizePct;
            let lo = minSizePct, hi = startSizePct;
            for (let step = 0; step < 26; step += 1) {
                const mid = (lo + hi) / 2;
                if (fits(mid, heightPct)) lo = mid;
                else hi = mid;
            }
            let size = Math.floor(lo * 10) / 10;
            while (size > minSizePct && !fits(size, heightPct)) size = round2(size - 0.1);
            return size >= minSizePct ? size : null;
        };
        const plan = (sizePct, heightPct, mode) => {
            const nextSize = clamp(round2(sizePct), MIN_TEXT_SIZE_PCT, MAX_TEXT_SIZE_PCT);
            const nextHeight = clamp(round2(heightPct), baseHeightPct, maxHeightPct);
            const sizeChanged = Math.abs(nextSize - round2(startSizePct)) > 0.001;
            const heightChanged = Math.abs(nextHeight - round2(baseHeightPct)) > 0.001;
            if (!sizeChanged && !heightChanged) return null;
            return {
                sizePct: nextSize,
                h: nextHeight,
                mode,
                clippedLines: current.clippedLines,
                lineCount: current.lines.length + current.clippedLines,
                sizeChanged,
                heightChanged,
            };
        };

        const grown = smallestFittingHeight(startSizePct);
        if (grown != null) return plan(startSizePct, grown, 'box');
        const shrunk = largestFittingSize(baseHeightPct);
        if (shrunk != null) return plan(shrunk, baseHeightPct, 'size');
        if (maxHeightPct > baseHeightPct) {
            const sizeAtMaxHeight = largestFittingSize(maxHeightPct);
            if (sizeAtMaxHeight != null) {
                const height = smallestFittingHeight(sizeAtMaxHeight) ?? maxHeightPct;
                return plan(sizeAtMaxHeight, height, 'both');
            }
        }
        return null;
    }

    // ---------------------------------------------------------------------
    // Formats
    // ---------------------------------------------------------------------
    const FORMAT_CHANNELS = ['social', 'display', 'video', 'instore', 'print', 'custom'];
    const MAX_FORMATS = 24;

    const CHANNEL_PRESETS = {
        social: [
            ['1080x1080', 'Meta Feed'],
            ['1080x1350', 'Instagram Portrait'],
            ['1080x1920', 'Story / Reels'],
            ['1200x628', 'LinkedIn'],
        ],
        display: [
            ['300x250', 'Medium Rectangle'],
            ['728x90', 'Leaderboard'],
            ['160x600', 'Wide Skyscraper'],
            ['320x50', 'Mobile Banner'],
        ],
        video: [
            ['1920x1080', 'YouTube Pre-roll'],
            ['1080x1080', 'Square Video'],
            ['1080x1920', 'Vertical Video'],
        ],
        instore: [
            ['1920x1080', 'Landscape Screen'],
            ['1080x1920', 'Portrait Screen'],
        ],
        print: [
            ['2480x3508', 'A4 (300 dpi)'],
            ['1748x2480', 'A5 (300 dpi)'],
        ],
        custom: [['custom', 'Custom size…']],
    };

    const OVERRIDE_RANGES = {
        x: [-100, 200],
        y: [-100, 200],
        w: [1, 300],
        h: [1, 300],
        rotation: [-3600, 3600],
        opacity: [0, 1],
        z: [-1000, 1000],
    };

    function normalizeLayerOverrides(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        const out = {};
        Object.keys(value).slice(0, 500).forEach((layerId) => {
            if (!ID_PATTERN.test(layerId)) return;
            const raw = value[layerId];
            if (!raw || typeof raw !== 'object') return;
            const entry = {};
            Object.keys(OVERRIDE_RANGES).forEach((prop) => {
                if (raw[prop] === undefined) return;
                const numeric = Number(raw[prop]);
                if (!Number.isFinite(numeric)) return;
                entry[prop] = round2(clamp(numeric, ...OVERRIDE_RANGES[prop]));
            });
            // Per-format type scale: a headline sized for 1080x1080 is unreadable
            // in a 728x90 banner, and sizePct is relative to the format height.
            if (raw.fontSizePct !== undefined) {
                const size = Number(raw.fontSizePct);
                if (Number.isFinite(size)) {
                    entry.fontSizePct = round2(clamp(size, FONT_SIZE_PCT.min, FONT_SIZE_PCT.max));
                }
            }
            if (raw.visible !== undefined) entry.visible = raw.visible !== false;
            if (raw.locked !== undefined) entry.locked = raw.locked === true;
            if (Object.keys(entry).length) out[layerId] = entry;
        });
        return out;
    }

    const VARIABLE_KINDS = ['text', 'color', 'url', 'image'];
    const MAX_VARIABLES = 60;
    const MAX_PALETTE = 40;
    const MAX_KIT_FONTS = 12;
    const MAX_KIT_LOGOS = 20;

    function normalizeVariableValue(kind, value) {
        if (kind === 'color') return HEX_COLOR.test(value) ? String(value).toLowerCase() : '#000000';
        if (typeof value !== 'string') return '';
        return value.slice(0, kind === 'text' ? MAX_TEXT_LENGTH : 2048);
    }

    function normalizeVariableValues(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        const out = {};
        Object.keys(value).slice(0, MAX_VARIABLES).forEach((key) => {
            if (!ID_PATTERN.test(key)) return;
            if (typeof value[key] === 'string') out[key] = value[key].slice(0, MAX_TEXT_LENGTH);
        });
        return out;
    }

    function normalizeVariables(value) {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        const result = [];
        value.slice(0, MAX_VARIABLES).forEach((item, index) => {
            if (!item || typeof item !== 'object') return;
            let id = sanitizeId(item.id, `variable-${index + 1}`);
            while (seen.has(id)) id = `${id}-${seen.size + 1}`;
            seen.add(id);
            const kind = VARIABLE_KINDS.includes(item.kind) ? item.kind : 'text';
            result.push({
                id,
                name: (typeof item.name === 'string' ? item.name.trim().slice(0, 80) : '') || `Variable ${index + 1}`,
                kind,
                defaultValue: normalizeVariableValue(kind, item.defaultValue),
                locked: item.locked === true,
            });
        });
        return result;
    }

    function normalizeFormat(value, index) {
        const source = value && typeof value === 'object' ? value : {};
        const format = {
            id: sanitizeId(source.id, `format-${index + 1}`),
            isMaster: source.isMaster === true,
            channel: FORMAT_CHANNELS.includes(source.channel) ? source.channel : 'custom',
            label: (typeof source.label === 'string' ? source.label.trim().slice(0, 80) : '') || `Format ${index + 1}`,
            width: Math.round(clamp(finite(source.width, 1080), 1, 10000)),
            height: Math.round(clamp(finite(source.height, 1080), 1, 10000)),
            layerOverrides: normalizeLayerOverrides(source.layerOverrides),
            variableValues: normalizeVariableValues(source.variableValues),
        };
        // undefined = derive from the channel; null = off; object = custom insets.
        if (source.safeZone === null || source.safeZone === false) {
            format.safeZone = null;
        } else if (source.safeZone && typeof source.safeZone === 'object') {
            const zone = normalizeSafeZone(source.safeZone);
            if (zone) format.safeZone = zone;
        }
        return format;
    }

    function normalizeFormats(value, fallbackWidth, fallbackHeight) {
        const width = Math.round(clamp(finite(fallbackWidth, 1080), 1, 10000));
        const height = Math.round(clamp(finite(fallbackHeight, 1080), 1, 10000));
        let formats = Array.isArray(value)
            ? value.slice(0, MAX_FORMATS).map((item, index) => normalizeFormat(item, index))
            : [];

        // De-duplicate ids, keeping the first occurrence.
        const seen = new Set();
        formats = formats.filter((format) => {
            if (seen.has(format.id)) return false;
            seen.add(format.id);
            return true;
        });

        if (!formats.length) {
            formats = [{
                id: 'master',
                isMaster: true,
                channel: 'custom',
                label: 'Master',
                width,
                height,
                layerOverrides: {},
                variableValues: {},
            }];
        }

        // Exactly one master: the first flagged one, else the first format.
        let masterSeen = false;
        formats.forEach((format) => {
            if (!format.isMaster) return;
            if (masterSeen) format.isMaster = false;
            else masterSeen = true;
        });
        if (!masterSeen) formats[0].isMaster = true;
        return formats;
    }

    function getMasterFormat(composition) {
        const formats = composition && Array.isArray(composition.formats) ? composition.formats : [];
        return formats.find((format) => format.isMaster) || formats[0] || null;
    }

    function getActiveFormat(composition) {
        const formats = composition && Array.isArray(composition.formats) ? composition.formats : [];
        if (!formats.length) return null;
        return formats.find((format) => format.id === composition.activeFormatId)
            || formats.find((format) => format.isMaster)
            || formats[0];
    }

    /** Keeps `activeFormatId` pointing at a real format. */
    function ensureActiveFormat(composition) {
        const formats = composition && Array.isArray(composition.formats) ? composition.formats : [];
        if (!formats.length) return 'master';
        const current = formats.find((format) => format.id === composition.activeFormatId);
        if (current) return current.id;
        const fallback = formats.find((format) => format.isMaster) || formats[0];
        return fallback.id;
    }

    function isPinned(format, layerId) {
        return Boolean(format && format.layerOverrides && Object.prototype.hasOwnProperty.call(format.layerOverrides, layerId));
    }

    function formatSize(format, composition) {
        if (format) return { width: format.width, height: format.height };
        if (composition) return { width: composition.width, height: composition.height };
        return { width: 1080, height: 1080 };
    }

    // ---------------------------------------------------------------------
    // Phase 4 — safe zones
    // ---------------------------------------------------------------------
    /**
     * Default insets per channel, as fractions of the format. They are a
     * starting point for UI chrome (a story's caption bar) or a print margin —
     * any format can override them, or switch them off entirely.
     */
    const SAFE_ZONE_CHANNELS = {
        social: { top: 0.12, right: 0.06, bottom: 0.16, left: 0.06 },
        display: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
        video: { top: 0.10, right: 0.06, bottom: 0.10, left: 0.06 },
        instore: { top: 0.08, right: 0.08, bottom: 0.08, left: 0.08 },
        print: { top: 0.08, right: 0.08, bottom: 0.08, left: 0.08 },
        custom: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    const SAFE_ZONE_EDGES = ['top', 'right', 'bottom', 'left'];
    const MAX_SAFE_INSET = 0.45;
    /**
     * Backgrounds are meant to bleed; text and the foreground cast are not.
     * A layer can opt out with `bleed: true`.
     */
    const SAFE_ZONE_ROLES = ['foreground', 'character', 'character-part'];

    function normalizeSafeZone(value) {
        if (!value || typeof value !== 'object') return null;
        const zone = {};
        let any = false;
        SAFE_ZONE_EDGES.forEach((edge) => {
            const amount = Number(value[edge]);
            zone[edge] = Number.isFinite(amount) ? round2(clamp(amount, 0, MAX_SAFE_INSET)) : 0;
            if (zone[edge] > 0) any = true;
        });
        return any ? zone : null;
    }

    /** The insets in force for a format, or null when there are none. */
    function safeZoneForFormat(format) {
        if (!format) return null;
        const explicit = normalizeSafeZone(format.safeZone);
        if (explicit) return explicit;
        if (format.safeZone === null) return null;
        return normalizeSafeZone(SAFE_ZONE_CHANNELS[format.channel] || SAFE_ZONE_CHANNELS.custom);
    }

    /** The safe rect in percent-of-format units. */
    function safeZoneRect(zone) {
        if (!zone) return null;
        return {
            left: round2(zone.left * 100),
            top: round2(zone.top * 100),
            right: round2(100 - zone.right * 100),
            bottom: round2(100 - zone.bottom * 100),
        };
    }

    function layerInSafeZoneScope(layer) {
        if (!layer || layer.visible === false || layer.bleed === true) return false;
        return layer.type === 'text' || SAFE_ZONE_ROLES.includes(layer.role);
    }

    /** Every scoped layer whose box crosses the safe rect for this format. */
    function safeZoneViolations(composition, context) {
        if (!composition) return [];
        const source = context || {};
        const format = source.format || getActiveFormat(composition);
        const zone = safeZoneForFormat(format);
        if (!zone) return [];
        const rect = safeZoneRect(zone);
        const violations = [];
        (composition.layers || []).forEach((rawLayer) => {
            if (!layerInSafeZoneScope(rawLayer)) return;
            const layer = resolveLayer(rawLayer, {
                composition,
                format,
                locale: source.locale,
            });
            const x = finite(layer.x, 0);
            const y = finite(layer.y, 0);
            const w = finite(layer.w, 0);
            const h = finite(layer.h, 0);
            const edges = [];
            if (x < rect.left - 0.01) edges.push('left');
            if (y < rect.top - 0.01) edges.push('top');
            if (x + w > rect.right + 0.01) edges.push('right');
            if (y + h > rect.bottom + 0.01) edges.push('bottom');
            if (!edges.length) return;
            violations.push({
                layerId: layer.id,
                name: layer.name,
                edges,
                box: { x, y, w, h },
                rect,
            });
        });
        return violations;
    }

    // ---------------------------------------------------------------------
    // Phase 4 — guardrails (a rules engine that can block an export)
    // ---------------------------------------------------------------------
    /**
     * Guardrails are opt-in per composition. Only rules that are objective and
     * actionable block: a text layer using a font outside the kit, and a scoped
     * element crossing the safe area. Palette and logo rules stay advisory —
     * white-on-photo body copy is legitimate, and the logo rule is a name
     * heuristic, so neither should stop a launch.
     */
    const GUARDRAIL_BLOCKING_RULES = ['fonts', 'safeZone'];

    function normalizeGuardrails(value) {
        const source = value && typeof value === 'object' ? value : {};
        return {
            enabled: source.enabled === true,
            block: source.block === true,
        };
    }

    /**
     * Runs the validation report through the guardrail rules.
     * `{ ok, skipped, errors, warnings, blocking }`
     */
    function evaluateGuardrails(composition, context) {
        const config = normalizeGuardrails(composition && composition.guardrails);
        if (!config.enabled) {
            return { ok: true, skipped: true, errors: [], warnings: [], blocking: false };
        }
        const report = validateAgainstBrandKit(composition, context);
        const errors = [];
        const warnings = [];
        report.groups.forEach((group) => {
            if (group.id === 'kit') return; // A missing kit is a setup problem, not a violation.
            const blocking = GUARDRAIL_BLOCKING_RULES.includes(group.id);
            group.entries.forEach((entry) => {
                if (entry.ok) return;
                (blocking ? errors : warnings).push(`${group.label}: ${entry.text}`);
            });
        });
        return {
            ok: errors.length === 0,
            skipped: false,
            errors,
            warnings,
            blocking: config.block && errors.length > 0,
        };
    }

    // ---------------------------------------------------------------------
    // Variables / bindings
    // ---------------------------------------------------------------------
    const NO_VARIABLES = Object.freeze({});

    function resolveVariables(composition, format) {
        const variables = composition && Array.isArray(composition.variables) ? composition.variables : null;
        if (!variables || !variables.length) return NO_VARIABLES;
        const out = {};
        variables.forEach((variable) => {
            const formatValue = format && format.variableValues ? format.variableValues[variable.id] : undefined;
            out[variable.id] = formatValue !== undefined && !variable.locked
                ? formatValue
                : variable.defaultValue;
        });
        return out;
    }

    function applyBindings(layer, values) {
        if (!layer || !layer.bindings || !values) return layer;
        const bindings = layer.bindings;
        const next = { ...layer };
        let changed = false;
        if (bindings.text && values[bindings.text] !== undefined) {
            next.text = values[bindings.text];
            changed = true;
        }
        if (bindings.color && values[bindings.color] !== undefined) {
            const value = values[bindings.color];
            if (HEX_COLOR.test(value)) {
                next.color = String(value).toLowerCase();
                changed = true;
            }
        }
        if (bindings.url && values[bindings.url] !== undefined) {
            const value = values[bindings.url];
            if (isSafeImageUrl(value)) {
                const previousUrl = layer.url;
                next.url = value;
                next.frames = swapSpriteFrames(layer, previousUrl, value);
                changed = true;
            }
        }
        return changed ? next : layer;
    }

    function swapSpriteFrames(layer, previousUrl, nextUrl) {
        const frames = Array.isArray(layer.frames) ? layer.frames : [];
        if (frames.length > 1) {
            const replaced = frames.map((frame) => (frame === previousUrl ? nextUrl : frame));
            return replaced[0] === nextUrl ? replaced : [nextUrl, ...replaced.slice(1)];
        }
        return [nextUrl];
    }

    function isSafeImageUrl(value) {
        if (typeof value !== 'string' || !value.trim()) return false;
        if (IMAGE_DATA_URL.test(value)) return true;
        if (/^(https?:)?\/\//i.test(value)) return true;
        if (/^(\.{0,2}\/)/.test(value)) return true;
        if (/^[A-Za-z0-9][A-Za-z0-9._~\-/]*\.(?:png|jpe?g|gif|webp|svg|avif)$/i.test(value)) return true;
        return false;
    }

    /** Applies one format's layer override to a layer, keyframe-aware. */
    function applyFormatOverride(layer, override) {
        if (!override || typeof override !== 'object') return layer;
        const next = { ...layer };
        if (override.fontSizePct !== undefined && layer.type === 'text') {
            next.font = { ...normalizeTextFont(layer.font), sizePct: override.fontSizePct };
        }
        const geometry = ['x', 'y', 'w', 'h', 'rotation'];
        const deltas = {};
        geometry.forEach((prop) => {
            if (override[prop] === undefined) return;
            const target = Number(override[prop]);
            if (!Number.isFinite(target)) return;
            const current = Number(layer[prop]);
            deltas[prop] = target - (Number.isFinite(current) ? current : 0);
            next[prop] = target;
        });
        const frames = Array.isArray(layer.keyframes) ? layer.keyframes : [];
        if (frames.length && Object.keys(deltas).length) {
            next.keyframes = frames.map((frame) => {
                const shifted = { ...frame };
                Object.keys(deltas).forEach((prop) => {
                    const value = Number(frame[prop]);
                    if (Number.isFinite(value)) shifted[prop] = round2(value + deltas[prop]);
                });
                return shifted;
            });
        }
        if (override.opacity !== undefined && !frames.length) next.opacity = override.opacity;
        if (override.visible !== undefined) next.visible = override.visible !== false;
        if (override.locked !== undefined) next.locked = override.locked === true;
        if (override.z !== undefined) next.z = override.z;
        return next;
    }

    /**
     * resolveLayer — THE single render path.
     *
     * Order matters: variable bindings first (they change layer *content*), then
     * the format override (it changes geometry and visibility). Keyframes are
     * still resolved later by getLayerStateAtTime() because they depend on time.
     *
     * The result is tagged so a second call is a no-op: keyframe shifting is not
     * idempotent, and renderers legitimately resolve the same layer twice.
     */
    const RESOLVED = typeof Symbol === 'function' ? Symbol('layerStudioResolved') : '__layerStudioResolved';

    /** Tags a copy of a resolved layer so it is never resolved twice. */
    function markResolved(layer) {
        if (!layer || typeof layer !== 'object') return layer;
        try {
            Object.defineProperty(layer, RESOLVED, { value: true, enumerable: false });
        } catch {
            /* a hostile object is returned as-is */
        }
        return layer;
    }

    function resolveLayer(layer, context) {
        if (!layer || typeof layer !== 'object') return layer;
        if (layer[RESOLVED]) return layer;
        const source = context || {};
        const composition = source.composition || null;
        const format = source.format || (composition ? getActiveFormat(composition) : null);
        const values = composition ? resolveVariables(composition, format) : {};
        const bound = applyBindings(layer, values);
        const override = format && format.layerOverrides ? format.layerOverrides[layer.id] : null;
        const result = applyFormatOverride(bound, override);
        if (result === layer) return layer;
        return markResolved(result);
    }

    // ---------------------------------------------------------------------
    // Brand kit
    // ---------------------------------------------------------------------
    function normalizeBrandKit(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const palette = Array.isArray(value.palette)
            ? value.palette.slice(0, MAX_PALETTE).filter((item) => item && typeof item === 'object').map((entry, index) => ({
                name: (typeof entry.name === 'string' ? entry.name.trim().slice(0, 60) : '') || `Color ${index + 1}`,
                hex: HEX_COLOR.test(entry.hex) ? String(entry.hex).toLowerCase() : '#000000',
            }))
            : [];
        const fonts = Array.isArray(value.fonts)
            ? value.fonts.slice(0, MAX_KIT_FONTS).filter((item) => item && typeof item === 'object').map((entry, index) => {
                const weight = Number(entry.weight);
                return {
                    name: (typeof entry.name === 'string' ? entry.name.trim().slice(0, 60) : '') || `Font ${index + 1}`,
                    family: (typeof entry.family === 'string' ? entry.family.trim().slice(0, 80) : '') || TEXT_LAYER_DEFAULTS.font.family,
                    weight: FONT_WEIGHTS.includes(weight) ? weight : 400,
                    style: FONT_STYLES.includes(entry.style) ? entry.style : 'normal',
                };
            })
            : [];
        const logos = Array.isArray(value.logos)
            ? value.logos.slice(0, MAX_KIT_LOGOS).map((item, index) => {
                const entry = item && typeof item === 'object' ? item : {};
                return {
                    name: (typeof entry.name === 'string' ? entry.name.trim().slice(0, 60) : '') || `Logo ${index + 1}`,
                    url: typeof entry.url === 'string' ? entry.url.slice(0, 2048) : '',
                };
            }).filter((logo) => logo.url)
            : [];
        const id = sanitizeId(value.id, 'brand-kit');
        const name = (typeof value.name === 'string' ? value.name.trim().slice(0, 80) : '') || 'Brand kit';
        if (!palette.length && !fonts.length && !logos.length && !value.name) return null;
        return { id, name, palette, fonts, logos };
    }

    const LOGO_NAME = /\blogo\b/i;

    function countIssues(groups) {
        return groups.reduce((total, group) => total + group.entries.filter((entry) => !entry.ok).length, 0);
    }

    function countSummary(groups) {
        return {
            checked: groups.reduce((total, group) => total + group.entries.length, 0),
            issues: countIssues(groups),
        };
    }

    /**
     * validateAgainstBrandKit — non-blocking drift report.
     * Never throws; always returns the same shape.
     */
    function validateAgainstBrandKit(composition, context) {
        const source = context || {};
        // A shared kit can be supplied by the caller (one kit, many compositions).
        const kit = source.kit || (composition && composition.brandKit) || null;
        const format = source.format || (composition ? getActiveFormat(composition) : null);
        const locale = source.locale;
        const groups = [];
        const addGroup = (id, label, entries) => {
            const failures = entries.filter((entry) => !entry.ok);
            groups.push({ id, label, ok: failures.length === 0, entries });
        };

        // Safe zones are channel geometry: they need no brand kit.
        if (safeZoneForFormat(format)) {
            const violations = safeZoneViolations(composition, { format, locale });
            const byLayer = new Map(violations.map((violation) => [violation.layerId, violation]));
            const entries = (composition.layers || [])
                .filter(layerInSafeZoneScope)
                .map((layer) => {
                    const violation = byLayer.get(layer.id);
                    return {
                        ok: !violation,
                        layerId: layer.id,
                        text: violation
                            ? `“${layer.name}” crosses the safe area on the ${violation.edges.join(', ')}.`
                            : `“${layer.name}” is inside the safe area.`,
                    };
                });
            if (entries.length) addGroup('safeZone', 'Safe zones', entries);
        }

        if (!kit) {
            addGroup('kit', 'Brand kit', [{
                ok: false,
                text: 'No brand kit is attached to this composition. Add a palette and fonts to validate against.',
            }]);
            const issues = countIssues(groups);
            return { ok: issues === 0, groups, summary: countSummary(groups) };
        }

        const paletteHexes = new Set(kit.palette.map((entry) => entry.hex));
        const families = new Set(kit.fonts.map((entry) => entry.family.toLowerCase()));
        const logoUrls = new Set(kit.logos.map((entry) => entry.url));

        const layers = (composition.layers || []).map((layer) => resolveLayer(layer, {
            composition, format, locale,
        }));

        const colorEntries = layers
            .filter((layer) => layer.type === 'text' && layer.visible)
            .map((layer) => {
                const color = String(layer.color || '').toLowerCase();
                return {
                    ok: !color || paletteHexes.has(color),
                    layerId: layer.id,
                    text: paletteHexes.has(color)
                        ? `“${layer.name}” uses ${color}`
                        : `“${layer.name}” uses ${color} — not in the brand palette.`,
                };
            });
        addGroup('palette', 'Palette drift', colorEntries);

        const fontEntries = layers
            .filter((layer) => layer.type === 'text' && layer.visible)
            .map((layer) => {
                const family = String(layer.font?.family || '');
                return {
                    ok: families.has(family.toLowerCase()),
                    layerId: layer.id,
                    text: families.has(family.toLowerCase())
                        ? `“${layer.name}” uses ${family}`
                        : `“${layer.name}” uses “${family}” — not in the brand kit fonts.`,
                };
            });
        addGroup('fonts', 'Font drift', fontEntries);

        const logoEntries = layers
            .filter((layer) => layer.type !== 'text' && layer.visible && LOGO_NAME.test(layer.name || ''))
            .map((layer) => {
                const url = layer.url || '';
                return {
                    ok: logoUrls.has(url),
                    layerId: layer.id,
                    text: logoUrls.has(url)
                        ? `“${layer.name}” matches a kit logo`
                        : `“${layer.name}” is named like a logo but its image is not in the kit.`,
                };
            });
        addGroup('logos', 'Missing logos', logoEntries);

        const issues = countIssues(groups);
        return { ok: issues === 0, groups, summary: countSummary(groups) };
    }

    // ---------------------------------------------------------------------
    // Phase 5 — brief ingestion (CSV / XLSX rows → variable values)
    // ---------------------------------------------------------------------
    const MAX_BRIEF_ROWS = 500;
    const MAX_BRIEF_COLUMNS = 64;

    /** Counts delimiters outside quoted regions, so "a,b" does not skew it. */
    function countDelimiter(line, delimiter) {
        let count = 0;
        let quoted = false;
        for (let index = 0; index < line.length; index += 1) {
            const char = line[index];
            if (char === '"') {
                if (quoted && line[index + 1] === '"') index += 1;
                else quoted = !quoted;
                continue;
            }
            if (!quoted && char === delimiter) count += 1;
        }
        return count;
    }

    function detectDelimiter(text) {
        const candidates = [',', ';', '\t', '|'];
        const firstLine = String(text ?? '').split(/\r\n|\n|\r/).find((line) => line.trim()) || '';
        let best = { delimiter: ',', count: -1 };
        candidates.forEach((delimiter) => {
            const count = countDelimiter(firstLine, delimiter);
            if (count > best.count) best = { delimiter, count };
        });
        return best.count > 0 ? best.delimiter : ',';
    }

    function dedupeHeaders(values) {
        const seen = new Map();
        return values.map((value, index) => {
            const base = String(value ?? '').trim().slice(0, 120) || `Column ${index + 1}`;
            const count = seen.get(base.toLowerCase()) || 0;
            seen.set(base.toLowerCase(), count + 1);
            return count ? `${base} (${count + 1})` : base;
        });
    }

    /** Turns a matrix into `{ headers, rows }`, dropping blank rows/columns. */
    function normalizeTable(matrix) {
        const rows = (Array.isArray(matrix) ? matrix : [])
            .filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim() !== ''));
        if (!rows.length) return { headers: [], rows: [] };
        const width = Math.min(MAX_BRIEF_COLUMNS, Math.max(...rows.map((row) => row.length)));
        const headers = dedupeHeaders(rows[0].slice(0, width));
        const body = rows.slice(1, MAX_BRIEF_ROWS + 1).map((row) => (
            headers.map((_, index) => String(row[index] ?? '').trim())
        ));
        return { headers, rows: body };
    }

    /**
     * RFC 4180 with practical extensions: BOM, CRLF/LF/CR, doubled quotes, and
     * delimiter sniffing between comma, semicolon, tab and pipe.
     */
    function parseDelimitedTable(text, options) {
        const source = String(text ?? '').replace(/^\uFEFF/, '');
        const delimiter = (options && options.delimiter) || detectDelimiter(source);
        const matrix = [];
        let row = [];
        let field = '';
        let quoted = false;
        for (let index = 0; index < source.length; index += 1) {
            const char = source[index];
            if (quoted) {
                if (char === '"') {
                    if (source[index + 1] === '"') {
                        field += '"';
                        index += 1;
                    } else {
                        quoted = false;
                    }
                } else {
                    field += char;
                }
                continue;
            }
            if (char === '"' && field === '') {
                quoted = true;
                continue;
            }
            if (char === delimiter) {
                row.push(field);
                field = '';
                continue;
            }
            if (char === '\n' || char === '\r') {
                if (char === '\r' && source[index + 1] === '\n') index += 1;
                row.push(field);
                matrix.push(row);
                row = [];
                field = '';
                continue;
            }
            field += char;
        }
        if (field !== '' || row.length) {
            row.push(field);
            matrix.push(row);
        }
        return normalizeTable(matrix);
    }

    function normalizeBriefKey(value) {
        return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    }

    /**
     * Suggests `{ variableId: columnIndex }`. Exact name/id match first, then a
     * cautious substring match; each column is used at most once.
     */
    function suggestBriefMapping(composition, headers) {
        const variables = (composition && Array.isArray(composition.variables)) ? composition.variables : [];
        const normalized = (headers || []).map(normalizeBriefKey);
        const mapping = {};
        const used = new Set();
        variables.forEach((variable) => {
            const keys = [normalizeBriefKey(variable.name), normalizeBriefKey(variable.id)].filter(Boolean);
            const index = normalized.findIndex((header, position) => (
                !used.has(position) && header && keys.includes(header)
            ));
            if (index < 0) return;
            mapping[variable.id] = index;
            used.add(index);
        });
        variables.forEach((variable) => {
            if (mapping[variable.id] !== undefined) return;
            const key = normalizeBriefKey(variable.name);
            if (key.length < 3) return;
            const index = normalized.findIndex((header, position) => {
                if (used.has(position) || header.length < 3) return false;
                return header.includes(key) || key.includes(header);
            });
            if (index < 0) return;
            mapping[variable.id] = index;
            used.add(index);
        });
        return mapping;
    }

    /** Coerces one cell to a variable's kind. Returns `{ ok, value, error }`. */
    function coerceBriefValue(variable, raw) {
        const text = String(raw ?? '').trim();
        if (!variable) return { ok: false, error: 'Unknown variable.' };
        if (variable.kind === 'color') {
            let hex = text.replace(/^#/, '');
            if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split('').map((char) => char + char).join('');
            if (!/^[0-9a-f]{6}$/i.test(hex)) {
                return { ok: false, error: `“${text}” is not a hex colour (#rrggbb or #rgb).` };
            }
            return { ok: true, value: `#${hex.toLowerCase()}` };
        }
        if (variable.kind === 'text') {
            if (text.length > MAX_TEXT_LENGTH) {
                return { ok: false, error: `Text is longer than ${MAX_TEXT_LENGTH} characters.` };
            }
            return { ok: true, value: text };
        }
        if (!text) return { ok: false, error: `“${variable.name}” needs an image or URL value.` };
        if (!isSafeImageUrl(text)) {
            return { ok: false, error: `“${text}” is not an https, relative or data image URL.` };
        }
        return { ok: true, value: text };
    }

    /** Reads one row through a mapping, without touching the composition. */
    function resolveBriefRow(composition, mapping, row) {
        const variables = (composition && Array.isArray(composition.variables)) ? composition.variables : [];
        const values = {};
        const errors = [];
        variables.forEach((variable) => {
            const index = mapping ? mapping[variable.id] : undefined;
            if (!Number.isInteger(index) || index < 0) return;
            const raw = Array.isArray(row) ? row[index] : undefined;
            if (raw === undefined) return;
            const coerced = coerceBriefValue(variable, raw);
            if (!coerced.ok) {
                errors.push({ variableId: variable.id, variable: variable.name, raw: String(raw ?? ''), error: coerced.error });
                return;
            }
            values[variable.id] = coerced.value;
        });
        return { ok: errors.length === 0, values, errors };
    }

    /**
     * A derived composition for one row: the row's values become the variable
     * defaults, so every format inherits them and `locked` is respected.
     */
    function composeBriefRow(composition, values, options) {
        const label = options && typeof options.label === 'string' ? options.label : '';
        const next = {
            ...composition,
            name: label ? `${composition.name} — ${label}` : composition.name,
            variables: (composition.variables || []).map((variable) => (
                values[variable.id] !== undefined ? { ...variable, defaultValue: values[variable.id] } : { ...variable }
            )),
            formats: (composition.formats || []).map((format) => {
                const variableValues = { ...(format.variableValues || {}) };
                Object.keys(values).forEach((id) => { delete variableValues[id]; });
                return { ...format, variableValues };
            }),
            layers: (composition.layers || []).map((layer) => ({
                ...layer,
                keyframes: (layer.keyframes || []).map((frame) => ({ ...frame })),
                bindings: { ...(layer.bindings || {}) },
            })),
        };
        return next;
    }

    /** A stable, human-readable label for a brief row. */
    function briefRowLabel(row, headers, mapping, index) {
        const list = Array.isArray(headers) ? headers : [];
        // "Campaign name" should win over the first mapped column.
        const suggested = list.findIndex((header) => (
            /(^|[^a-z])(name|title|label|key|slug)([^a-z]|$)/i.test(String(header).trim())
        ));
        const mapped = Object.values(mapping || {}).filter((value) => Number.isInteger(value) && value >= 0);
        const candidates = [suggested, ...mapped].filter((value) => Number.isInteger(value) && value >= 0);
        for (const position of candidates) {
            const value = String((row && row[position]) ?? '').trim();
            if (value) return value.slice(0, 80);
        }
        return `row ${index + 1}`;
    }

    // ---------------------------------------------------------------------
    // Agent-command value validation
    // ---------------------------------------------------------------------
    function validateVariableAssignment(variables, variableId, value) {
        const list = Array.isArray(variables) ? variables : [];
        const variable = list.find((item) => item.id === variableId);
        if (!variable) return { ok: false, error: `Unknown variable “${variableId}”.` };
        if (typeof value !== 'string') return { ok: false, error: 'A variable value must be a string.' };
        if (variable.kind === 'color') {
            if (!HEX_COLOR.test(value)) return { ok: false, error: `“${variable.name}” expects a #rrggbb colour.` };
            return { ok: true, value: value.toLowerCase() };
        }
        if (variable.kind === 'text') {
            if (value.length > MAX_TEXT_LENGTH) return { ok: false, error: `“${variable.name}” exceeds ${MAX_TEXT_LENGTH} characters.` };
            return { ok: true, value };
        }
        if (!isSafeImageUrl(value)) return { ok: false, error: `“${variable.name}” expects an https, relative or data image URL.` };
        return { ok: true, value };
    }

    return {
        // primitives
        clamp,
        finite,
        round2,
        DEFAULT_LOCALE,

        // vocabulary
        LAYER_TYPES,
        TEXT_ALIGNMENTS,
        VERTICAL_ALIGNMENTS,
        TEXT_TRANSFORMS,
        TEXT_OVERFLOWS,
        FONT_WEIGHTS,
        FONT_STYLES,
        SYSTEM_FONT_FAMILIES,
        TEXT_LAYER_DEFAULTS,
        FONT_SIZE_PCT,
        LINE_HEIGHT,
        LETTER_SPACING_EM,
        MAX_TEXT_LENGTH,
        RTL_LANGUAGES,

        // text
        isCjkChar,
        isCjkCodePoint,
        directionForLocale,
        isSystemFont,
        sanitizeId,
        normalizeTextFont,
        normalizeTextValue,
        normalizeTextSpec,
        normalizeBindings,
        resolveLocaleText,
        applyTextTransform,
        cssFontFamily,
        cssFontString,
        buildTextMetrics,
        fallbackTextMetrics,
        breakUnits,
        layoutText,
        planTextFit,
        MIN_TEXT_SIZE_PCT,
        MAX_TEXT_SIZE_PCT,

        // formats
        FORMAT_CHANNELS,
        MAX_FORMATS,
        CHANNEL_PRESETS,
        OVERRIDE_RANGES,
        normalizeLayerOverrides,
        normalizeFormat,
        normalizeFormats,
        getMasterFormat,
        getActiveFormat,
        ensureActiveFormat,
        isPinned,
        formatSize,

        // variables + resolution
        VARIABLE_KINDS,
        MAX_VARIABLES,
        MAX_PALETTE,
        MAX_KIT_FONTS,
        MAX_KIT_LOGOS,
        normalizeVariableValue,
        normalizeVariableValues,
        normalizeVariables,
        resolveVariables,
        applyBindings,
        applyFormatOverride,
        resolveLayer,
        isSafeImageUrl,
        swapSpriteFrames,

        // safe zones + guardrails
        SAFE_ZONE_CHANNELS,
        SAFE_ZONE_EDGES,
        SAFE_ZONE_ROLES,
        MAX_SAFE_INSET,
        GUARDRAIL_BLOCKING_RULES,
        normalizeSafeZone,
        safeZoneForFormat,
        safeZoneRect,
        layerInSafeZoneScope,
        safeZoneViolations,
        normalizeGuardrails,
        evaluateGuardrails,

        // brief ingestion
        MAX_BRIEF_ROWS,
        MAX_BRIEF_COLUMNS,
        detectDelimiter,
        normalizeTable,
        parseDelimitedTable,
        suggestBriefMapping,
        coerceBriefValue,
        resolveBriefRow,
        composeBriefRow,
        briefRowLabel,

        // resolution marker
        markResolved,

        // brand kit
        normalizeBrandKit,
        validateAgainstBrandKit,
        validateVariableAssignment,
    };
}));
