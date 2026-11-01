'use strict';
/**
 * Unit tests for studio-core.js — run with: node --test tests/
 *
 * The core is deliberately DOM-free so the typesetter, the format resolver and
 * the variable/binding resolution can be exercised without a browser.
 */
const test = require('node:test');
const assert = require('node:assert');
const core = require('../studio-core.js');

/** Monospace measurer: every character is half the font size wide. */
const monoFactory = ({ sizePx }) => ({
    sizePx,
    ascentRatio: 0.8,
    descentRatio: 0.2,
    measureWidth: (value) => String(value ?? '').length * sizePx * 0.5,
});

function layout(overrides = {}) {
    return core.layoutText({
        text: 'aaa bbb ccc',
        font: { family: 'Inter', weight: 700, sizePct: 10, lineHeight: 1.15 },
        boxWidthPx: 500,
        boxHeightPx: 500,
        formatHeightPx: 1000,
        measureFactory: monoFactory,
        ...overrides,
    });
}

// ---------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------
test('normalizeTextValue accepts strings and locale maps', () => {
    assert.strictEqual(core.normalizeTextValue('hello'), 'hello');
    assert.deepStrictEqual(core.normalizeTextValue({ en: 'hi', 'pt-BR': 'olá' }), { en: 'hi', 'pt-BR': 'olá' });
    assert.strictEqual(core.normalizeTextValue(42), '');
    assert.strictEqual(core.normalizeTextValue(null), '');
    assert.strictEqual(core.normalizeTextValue(['a']), '');
    assert.strictEqual(core.normalizeTextValue('x'.repeat(9000)).length, core.MAX_TEXT_LENGTH);
});

test('normalizeTextFont clamps and defaults', () => {
    const font = core.normalizeTextFont({ family: 'Acme', weight: 650, sizePct: 999, lineHeight: 0.1, letterSpacingEm: 5, transform: 'nope' });
    assert.strictEqual(font.family, 'Acme');
    assert.strictEqual(font.weight, 700, 'invalid weight falls back to the default');
    assert.strictEqual(font.sizePct, 30, 'sizePct clamped to the maximum');
    assert.strictEqual(font.lineHeight, 0.8, 'lineHeight clamped to the minimum');
    assert.strictEqual(font.letterSpacingEm, 0.5);
    assert.strictEqual(font.transform, 'none');
    assert.deepStrictEqual(core.normalizeTextFont(undefined), core.TEXT_LAYER_DEFAULTS.font);
});

test('resolveLocaleText honours locale, fallback and first non-empty', () => {
    const text = { en: 'Hello', 'pt-BR': 'Olá' };
    assert.strictEqual(core.resolveLocaleText(text, 'pt-BR', 'en'), 'Olá');
    assert.strictEqual(core.resolveLocaleText(text, 'de', 'en'), 'Hello');
    assert.strictEqual(core.resolveLocaleText(text, 'de', 'de'), 'Hello', 'falls through to the first value');
    assert.strictEqual(core.resolveLocaleText('plain', 'de', 'en'), 'plain');
    assert.strictEqual(core.resolveLocaleText(null, 'de', 'en'), '');
});

test('applyTextTransform', () => {
    assert.strictEqual(core.applyTextTransform('hello world', 'uppercase'), 'HELLO WORLD');
    assert.strictEqual(core.applyTextTransform('HELLO', 'lowercase'), 'hello');
    assert.strictEqual(core.applyTextTransform('hello world', 'capitalize'), 'Hello World');
    assert.strictEqual(core.applyTextTransform('Hello', 'none'), 'Hello');
});

test('directionForLocale detects RTL languages', () => {
    assert.strictEqual(core.directionForLocale('ar'), 'rtl');
    assert.strictEqual(core.directionForLocale('he-IL'), 'rtl');
    assert.strictEqual(core.directionForLocale('fa'), 'rtl');
    assert.strictEqual(core.directionForLocale('en-US'), 'ltr');
    assert.strictEqual(core.directionForLocale(undefined), 'ltr');
});

test('isCjkChar recognises Han, Kana and Hangul', () => {
    assert.ok(core.isCjkChar('漢'));
    assert.ok(core.isCjkChar('あ'));
    assert.ok(core.isCjkChar('한'));
    assert.ok(!core.isCjkChar('A'));
});

// ---------------------------------------------------------------------------
// layoutText — the shared typesetter
// ---------------------------------------------------------------------------
test('layoutText lays a single short line at the top-left', () => {
    const result = layout({ text: 'abc' });
    assert.strictEqual(result.lines.length, 1);
    assert.strictEqual(result.lines[0].text, 'abc');
    assert.strictEqual(result.lines[0].x, 0);
    assert.strictEqual(result.lines[0].y, 0);
    assert.strictEqual(result.lines[0].width, 150);
    assert.strictEqual(result.sizePx, 100, 'sizePct is a percentage of the format height');
    assert.strictEqual(result.lineHeightPx, 115);
});

test('layoutText wraps at word boundaries and trims trailing spaces', () => {
    const result = layout();
    assert.deepStrictEqual(result.lines.map((line) => line.text), ['aaa bbb', 'ccc']);
    assert.strictEqual(result.lines[0].width, 350, 'trailing space is not counted');
    assert.strictEqual(result.lines[1].y, 115);
});

test('layoutText honours hard line breaks', () => {
    const result = layout({ text: 'aaa\nbbb' });
    assert.deepStrictEqual(result.lines.map((line) => line.text), ['aaa', 'bbb']);
    assert.strictEqual(result.lines[1].y, 115);
});

test('layoutText keeps blank lines for consecutive newlines', () => {
    const result = layout({ text: 'aaa\n\nbbb' });
    assert.deepStrictEqual(result.lines.map((line) => line.text), ['aaa', '', 'bbb']);
    assert.strictEqual(result.lines[2].y, 230);
});

test('layoutText breaks between CJK characters without spaces', () => {
    // Monospace measurer: 50px glyphs, 100px box → two glyphs per line.
    const result = layout({ text: '漢字漢字漢字', boxWidthPx: 100 });
    assert.deepStrictEqual(result.lines.map((line) => line.text), ['漢字', '漢字', '漢字']);
});

test('layoutText keeps a single oversized word on one line', () => {
    const result = layout({ text: 'supercalifragilistic', boxWidthPx: 100 });
    assert.strictEqual(result.lines.length, 1);
    assert.ok(result.lines[0].width > 100, 'the word overflows rather than being lost');
});

test('layoutText clips to lines that fit entirely', () => {
    // lineHeightPx is 115, so a 115px box holds exactly one line.
    const one = layout({ text: 'aaa\nbbb\nccc', boxHeightPx: 115, overflow: 'clip' });
    assert.deepStrictEqual(one.lines.map((line) => line.text), ['aaa']);
    assert.strictEqual(one.clipped, true);

    const two = layout({ text: 'aaa\nbbb\nccc', boxHeightPx: 230, overflow: 'clip' });
    assert.deepStrictEqual(two.lines.map((line) => line.text), ['aaa', 'bbb']);

    // A line that starts inside but ends outside the box is dropped, not cut.
    const partial = layout({ text: 'aaa\nbbb\nccc', boxHeightPx: 200, overflow: 'clip' });
    assert.deepStrictEqual(partial.lines.map((line) => line.text), ['aaa']);

    const visible = layout({ text: 'aaa\nbbb\nccc', boxHeightPx: 200, overflow: 'visible' });
    assert.strictEqual(visible.lines.length, 3);
    assert.strictEqual(visible.clipped, false);
});

test('layoutText applies horizontal alignment inside the box', () => {
    const centered = layout({ text: 'abc', align: 'center', boxWidthPx: 500 });
    assert.strictEqual(centered.lines[0].x, (500 - 150) / 2);

    const right = layout({ text: 'abc', align: 'right', boxWidthPx: 500 });
    assert.strictEqual(right.lines[0].x, 350);
});

test('layoutText applies vertical alignment inside the box', () => {
    const middle = layout({ text: 'abc', verticalAlign: 'middle', boxHeightPx: 300 });
    assert.strictEqual(middle.lines[0].y, (300 - 115) / 2);

    const bottom = layout({ text: 'abc', verticalAlign: 'bottom', boxHeightPx: 300 });
    assert.strictEqual(bottom.lines[0].y, 300 - 115);
});

test('layoutText reports the baseline used by DOM, canvas and SVG', () => {
    const result = layout({ text: 'abc', boxHeightPx: 500 });
    // ascent 80, descent 20, lineHeight 115 → halfLeading 7.5 → baseline 87.5
    assert.strictEqual(result.lines[0].baselineY, 87.5);
});

test('layoutText transforms text before measuring', () => {
    const result = layout({ text: 'abc', font: { sizePct: 10, transform: 'uppercase' } });
    assert.strictEqual(result.lines[0].text, 'ABC');
});

test('layoutText resolves the requested locale', () => {
    const result = layout({ text: { en: 'Hello', de: 'Hallo' }, locale: 'de', defaultLocale: 'en' });
    assert.strictEqual(result.lines[0].text, 'Hallo');
});

test('layoutText is deterministic without a canvas', () => {
    const result = core.layoutText({
        text: 'hello world',
        font: { sizePct: 8 },
        boxWidthPx: 400,
        boxHeightPx: 200,
        formatHeightPx: 1080,
        align: 'left',
    });
    assert.ok(result.lines.length >= 1);
    assert.ok(Number.isFinite(result.lines[0].width));
    assert.strictEqual(result.sizePx, 86.4);
});

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------
test('normalizeFormats synthesises a master for legacy compositions', () => {
    const formats = core.normalizeFormats(undefined, 1920, 1080);
    assert.strictEqual(formats.length, 1);
    assert.strictEqual(formats[0].id, 'master');
    assert.strictEqual(formats[0].isMaster, true);
    assert.strictEqual(formats[0].width, 1920);
    assert.strictEqual(formats[0].height, 1080);
    assert.deepStrictEqual(formats[0].layerOverrides, {});
});

test('normalizeFormats keeps exactly one master and unique ids', () => {
    const formats = core.normalizeFormats([
        { id: 'a', isMaster: true, width: 100, height: 100 },
        { id: 'a', isMaster: true, width: 200, height: 200 },
        { id: 'b', width: 300, height: 300 },
    ], 1080, 1080);
    assert.deepStrictEqual(formats.map((format) => format.id), ['a', 'b'], 'duplicate ids are dropped');
    assert.strictEqual(formats.filter((format) => format.isMaster).length, 1);
});

test('normalizeFormats promotes the first format when no master is flagged', () => {
    const formats = core.normalizeFormats([{ id: 'x' }, { id: 'y' }], 1080, 1080);
    assert.strictEqual(formats[0].isMaster, true);
    assert.strictEqual(formats[1].isMaster, false);
});

test('normalizeLayerOverrides accepts a per-format type scale', () => {
    const overrides = core.normalizeLayerOverrides({
        hero: { x: 10, fontSizePct: 40 },
        tiny: { fontSizePct: 0.1 },
        junk: { fontSizePct: 'nope' },
    });
    assert.strictEqual(overrides.hero.fontSizePct, 30, 'clamped to the maximum');
    assert.strictEqual(overrides.tiny.fontSizePct, 0.5, 'clamped to the minimum');
    assert.strictEqual(overrides.junk, undefined, 'an invalid size leaves nothing to store');
});

test('applyFormatOverride applies a per-format type scale to text only', () => {
    const text = {
        id: 't', type: 'text', font: { family: 'Inter', weight: 700, sizePct: 9, lineHeight: 1.15, letterSpacingEm: 0, style: 'normal', transform: 'none' },
    };
    const scaled = core.applyFormatOverride(text, { fontSizePct: 3.2 });
    assert.strictEqual(scaled.font.sizePct, 3.2);
    assert.strictEqual(scaled.font.family, 'Inter', 'the rest of the font spec is preserved');
    assert.strictEqual(text.font.sizePct, 9, 'the input is untouched');

    const image = { id: 'i', type: 'image', url: 'x.png' };
    assert.strictEqual(core.applyFormatOverride(image, { fontSizePct: 4 }).font, undefined);
});

test('normalizeLayerOverrides clamps and rejects junk', () => {
    const overrides = core.normalizeLayerOverrides({
        'layer-1': { x: 999, opacity: 2, visible: false, nope: 1 },
        'bad id!': { x: 1 },
        'layer-2': 'nope',
    });
    assert.deepStrictEqual(overrides['layer-1'], { x: 200, opacity: 1, visible: false });
    assert.strictEqual(overrides['bad id!'], undefined);
    assert.strictEqual(overrides['layer-2'], undefined);
});

test('getActiveFormat falls back to the master, then the first format', () => {
    const composition = {
        formats: [
            { id: 'master', isMaster: true, width: 1080, height: 1080 },
            { id: 'story', width: 1080, height: 1920 },
        ],
        activeFormatId: 'missing',
    };
    assert.strictEqual(core.getActiveFormat(composition).id, 'master');
    composition.activeFormatId = 'story';
    assert.strictEqual(core.getActiveFormat(composition).id, 'story');
    assert.strictEqual(core.ensureActiveFormat({ formats: composition.formats, activeFormatId: 'nope' }), 'master');
});

// ---------------------------------------------------------------------------
// Variables + bindings
// ---------------------------------------------------------------------------
const compositionFixture = () => ({
    width: 1080,
    height: 1080,
    defaultLocale: 'en',
    variables: [
        { id: 'headline', name: 'Headline', kind: 'text', defaultValue: 'Default headline', locked: false },
        { id: 'accent', name: 'Accent', kind: 'color', defaultValue: '#ff0000', locked: true },
    ],
    formats: [
        { id: 'master', isMaster: true, width: 1080, height: 1080, layerOverrides: {}, variableValues: {} },
        { id: 'story', width: 1080, height: 1920, layerOverrides: {}, variableValues: { headline: 'Story headline' } },
    ],
    activeFormatId: 'master',
    layers: [],
});

test('resolveVariables applies defaults, overrides and locks', () => {
    const composition = compositionFixture();
    const master = composition.formats[0];
    const story = composition.formats[1];
    assert.deepStrictEqual(core.resolveVariables(composition, master), {
        headline: 'Default headline',
        accent: '#ff0000',
    });
    const storyValues = core.resolveVariables(composition, story);
    assert.strictEqual(storyValues.headline, 'Story headline');
    assert.strictEqual(storyValues.accent, '#ff0000', 'locked variables ignore the format override');
});

test('applyBindings substitutes text, colour and url', () => {
    const values = { headline: 'Hi', accent: '#00ff00', hero: 'https://example.com/a.png' };
    const layer = {
        id: 'l1',
        type: 'text',
        text: 'old',
        color: '#000000',
        url: 'https://example.com/old.png',
        frames: ['https://example.com/old.png'],
        bindings: { text: 'headline', color: 'accent', url: 'hero' },
    };
    const next = core.applyBindings(layer, values);
    assert.strictEqual(next.text, 'Hi');
    assert.strictEqual(next.color, '#00ff00');
    assert.strictEqual(next.url, 'https://example.com/a.png');
    assert.deepStrictEqual(next.frames, ['https://example.com/a.png']);
    assert.strictEqual(layer.text, 'old', 'the input layer is not mutated');
});

test('applyBindings is a no-op without bindings', () => {
    const layer = { id: 'l1', type: 'image', url: 'x.png' };
    assert.strictEqual(core.applyBindings(layer, { headline: 'Hi' }), layer);
});

test('applyBindings keeps sprite frames coherent', () => {
    const layer = {
        id: 'sprite',
        url: 'a.png',
        frames: ['a.png', 'b.png'],
        bindings: { url: 'hero' },
    };
    const next = core.applyBindings(layer, { hero: 'c.png' });
    assert.deepStrictEqual(next.frames, ['c.png', 'b.png']);
});

test('applyBindings rejects an unsafe url binding', () => {
    const layer = { id: 'l1', url: 'a.png', frames: ['a.png'], bindings: { url: 'hero' } };
    const next = core.applyBindings(layer, { hero: 'javascript:alert(1)' });
    assert.strictEqual(next.url, 'a.png');
});

test('normalizeVariables clamps kinds and default values', () => {
    const variables = core.normalizeVariables([
        { id: 'a', name: 'A', kind: 'color', defaultValue: 'blue' },
        { id: 'a', name: 'A again', kind: 'nope', defaultValue: 5 },
        'junk',
    ]);
    assert.strictEqual(variables.length, 2);
    assert.strictEqual(variables[0].defaultValue, '#000000');
    assert.strictEqual(variables[1].kind, 'text');
    assert.notStrictEqual(variables[0].id, variables[1].id, 'ids are de-duplicated');
});

test('validateVariableAssignment validates by kind', () => {
    const variables = core.normalizeVariables([
        { id: 't', name: 'T', kind: 'text' },
        { id: 'c', name: 'C', kind: 'color' },
        { id: 'u', name: 'U', kind: 'image' },
    ]);
    assert.strictEqual(core.validateVariableAssignment(variables, 't', 'hello').ok, true);
    assert.strictEqual(core.validateVariableAssignment(variables, 't', 5).ok, false);
    assert.strictEqual(core.validateVariableAssignment(variables, 'c', '#aabbcc').ok, true);
    assert.strictEqual(core.validateVariableAssignment(variables, 'c', 'red').ok, false);
    assert.strictEqual(core.validateVariableAssignment(variables, 'u', 'https://example.com/a.png').ok, true);
    assert.strictEqual(core.validateVariableAssignment(variables, 'u', 'javascript:1').ok, false);
    assert.strictEqual(core.validateVariableAssignment(variables, 'missing', 'x').ok, false);
});

// ---------------------------------------------------------------------------
// resolveLayer — the single render path
// ---------------------------------------------------------------------------
test('resolveLayer is the identity for a master format with no variables', () => {
    const composition = { ...compositionFixture(), variables: [] };
    const layer = { id: 'l1', type: 'image', x: 10, y: 20, w: 30, h: 40, opacity: 1, keyframes: [] };
    const resolved = core.resolveLayer(layer, { composition, format: composition.formats[0] });
    assert.strictEqual(resolved.x, 10);
    assert.strictEqual(resolved.y, 20);
});

test('resolveLayer applies a per-format override', () => {
    const composition = compositionFixture();
    composition.formats[1].layerOverrides = { l1: { x: 50, opacity: 0.5 } };
    const layer = { id: 'l1', type: 'image', x: 10, y: 20, w: 30, h: 40, opacity: 1, keyframes: [] };
    const master = core.resolveLayer(layer, { composition, format: composition.formats[0] });
    const story = core.resolveLayer(layer, { composition, format: composition.formats[1] });
    assert.strictEqual(master.x, 10);
    assert.strictEqual(story.x, 50);
    assert.strictEqual(story.opacity, 0.5);
    assert.strictEqual(layer.x, 10, 'the source layer is untouched');
});

test('resolveLayer shifts keyframes by the override delta', () => {
    const composition = compositionFixture();
    composition.formats[1].layerOverrides = { l1: { x: 40 } };
    const layer = {
        id: 'l1', type: 'image', x: 10, y: 20, w: 30, h: 40, opacity: 1,
        keyframes: [
            { time: 0, x: 10, y: 20, w: 30, h: 40, rotation: 0, opacity: 1 },
            { time: 1000, x: 60, y: 20, w: 30, h: 40, rotation: 0, opacity: 1 },
        ],
    };
    const story = core.resolveLayer(layer, { composition, format: composition.formats[1] });
    assert.strictEqual(story.keyframes[0].x, 40);
    assert.strictEqual(story.keyframes[1].x, 90, 'the animation is offset, not flattened');
});

test('override application is idempotent, and a marked copy stays inert', () => {
    const composition = compositionFixture();
    composition.formats[1].layerOverrides = { l1: { x: 40 } };
    const layer = {
        id: 'l1', type: 'image', x: 10, y: 20, w: 30, h: 40, opacity: 1,
        keyframes: [
            { time: 0, x: 10, y: 20, w: 30, h: 40, rotation: 0, opacity: 1 },
            { time: 1000, x: 60, y: 20, w: 30, h: 40, rotation: 0, opacity: 1 },
        ],
    };
    const once = core.resolveLayer(layer, { composition, format: composition.formats[1] });
    assert.strictEqual(once.x, 40);
    assert.strictEqual(once.keyframes[0].x, 40, 'the keyframes are offset by the delta');

    // Re-applying the same override is a no-op: the delta is already zero.
    const twice = core.resolveLayer(
        { ...once, keyframes: once.keyframes.map((frame) => ({ ...frame })) },
        { composition, format: composition.formats[1] },
    );
    assert.deepStrictEqual(twice.keyframes, once.keyframes, 'a second pass does not shift again');

    // A marked copy is returned untouched, so a renderer may re-resolve safely.
    const marked = core.markResolved({ ...once, keyframes: once.keyframes.map((frame) => ({ ...frame })) });
    assert.strictEqual(core.resolveLayer(marked, { composition, format: composition.formats[1] }), marked);

    // The reason snapshots are built per format: re-resolving a resolved copy
    // against a DIFFERENT format would measure the delta from the wrong base.
    const master = core.resolveLayer({ ...once }, { composition, format: composition.formats[0] });
    assert.strictEqual(master.x, 40, 'the override leaks, which is why we snapshot per format');
});

test('resolveLayer applies variable bindings', () => {
    const composition = compositionFixture();
    composition.formats[1].variableValues = { headline: 'Bound on story' };
    const layer = { id: 't1', type: 'text', text: 'base', bindings: { text: 'headline' } };
    const master = core.resolveLayer(layer, { composition, format: composition.formats[0] });
    const story = core.resolveLayer(layer, { composition, format: composition.formats[1] });
    assert.strictEqual(master.text, 'Default headline');
    assert.strictEqual(story.text, 'Bound on story');
});

test('isPinned reports only real overrides', () => {
    const format = { layerOverrides: { l1: { x: 1 } } };
    assert.strictEqual(core.isPinned(format, 'l1'), true);
    assert.strictEqual(core.isPinned(format, 'l2'), false);
    assert.strictEqual(core.isPinned(null, 'l1'), false);
});

// ---------------------------------------------------------------------------
// Brand kit
// ---------------------------------------------------------------------------
test('normalizeBrandKit trims and defaults', () => {
    const kit = core.normalizeBrandKit({
        name: 'Acme',
        palette: [{ name: 'Red', hex: '#ff0000' }, { hex: 'nope' }, 'junk'],
        fonts: [{ name: 'Body', family: 'Inter', weight: 400 }],
        logos: [{ name: 'Mark', url: 'https://example.com/logo.png' }, { name: 'Broken' }],
    });
    assert.strictEqual(kit.name, 'Acme');
    assert.deepStrictEqual(kit.palette.map((entry) => entry.hex), ['#ff0000', '#000000']);
    assert.strictEqual(kit.fonts.length, 1);
    assert.strictEqual(kit.logos.length, 1, 'logos without a url are dropped');
    assert.strictEqual(core.normalizeBrandKit(null), null);
});

test('validateAgainstBrandKit reports drift without throwing', () => {
    const composition = {
        ...compositionFixture(),
        brandKit: {
            id: 'kit',
            name: 'Acme',
            palette: [{ name: 'Ink', hex: '#111111' }],
            fonts: [{ name: 'Body', family: 'Inter', weight: 400, style: 'normal' }],
            logos: [],
        },
        layers: [
            {
                id: 't1', type: 'text', name: 'Headline', visible: true,
                text: 'Hi', color: '#111111', font: { family: 'Inter' },
            },
            {
                id: 't2', type: 'text', name: 'CTA', visible: true,
                text: 'Go', color: '#3b7fbf', font: { family: 'Georgia' },
            },
        ],
    };
    const report = core.validateAgainstBrandKit(composition, {});
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.summary.issues, 2);
    const palette = report.groups.find((group) => group.id === 'palette');
    const fonts = report.groups.find((group) => group.id === 'fonts');
    assert.strictEqual(palette.ok, false);
    assert.strictEqual(fonts.ok, false);
    assert.ok(palette.entries.some((entry) => entry.layerId === 't2'));
});

test('validateAgainstBrandKit reports a missing kit', () => {
    const report = core.validateAgainstBrandKit({ layers: [], variables: [], formats: [] }, {});
    assert.strictEqual(report.ok, false);
    assert.match(report.groups[0].entries[0].text, /No brand kit/);
});

test('validateAgainstBrandKit is clean when everything matches', () => {
    const composition = {
        ...compositionFixture(),
        brandKit: {
            id: 'kit', name: 'Acme',
            palette: [{ name: 'Ink', hex: '#111111' }],
            fonts: [{ name: 'Body', family: 'Inter', weight: 400, style: 'normal' }],
            logos: [],
        },
        layers: [{
            id: 't1', type: 'text', name: 'Headline', visible: true,
            text: 'Hi', color: '#111111', font: { family: 'Inter' },
        }],
    };
    const report = core.validateAgainstBrandKit(composition, {});
    assert.strictEqual(report.ok, true);
});

// ---------------------------------------------------------------------------
// Channel presets
// ---------------------------------------------------------------------------
test('CHANNEL_PRESETS are well formed', () => {
    Object.entries(core.CHANNEL_PRESETS).forEach(([channel, presets]) => {
        assert.ok(core.FORMAT_CHANNELS.includes(channel));
        presets.forEach(([value, label]) => {
            assert.strictEqual(typeof label, 'string');
            if (value === 'custom') return;
            const [width, height] = value.split('x').map(Number);
            assert.ok(width > 0 && height > 0, `${channel} ${value}`);
        });
    });
});

// ---------------------------------------------------------------------------
// Brief ingestion (Phase 5)
// ---------------------------------------------------------------------------
test('parseDelimitedTable handles plain CSV with CRLF and a trailing newline', () => {
    const table = core.parseDelimitedTable('Headline,CTA\r\nWinter,Shop\r\nSpring,Buy\r\n');
    assert.deepStrictEqual(table.headers, ['Headline', 'CTA']);
    assert.deepStrictEqual(table.rows, [['Winter', 'Shop'], ['Spring', 'Buy']]);
});

test('parseDelimitedTable handles quoted fields, commas and doubled quotes', () => {
    const table = core.parseDelimitedTable('name,copy\nA,"Hello, world"\nB,"He said ""hi"""');
    assert.deepStrictEqual(table.rows, [['A', 'Hello, world'], ['B', 'He said "hi"']]);
});

test('parseDelimitedTable keeps newlines inside quoted fields', () => {
    const table = core.parseDelimitedTable('name,copy\nA,"line one\nline two"');
    assert.deepStrictEqual(table.headers, ['name', 'copy']);
    assert.deepStrictEqual(table.rows, [['A', 'line one\nline two']]);
});

test('parseDelimitedTable sniffs semicolons and tabs', () => {
    assert.deepStrictEqual(
        core.parseDelimitedTable('a;b\n1;2').rows,
        [['1', '2']],
    );
    assert.deepStrictEqual(
        core.parseDelimitedTable('a\tb\n1\t2').rows,
        [['1', '2']],
    );
});

test('parseDelimitedTable strips a BOM and ignores blank lines', () => {
    const table = core.parseDelimitedTable('\uFEFFa,b\n\n1,2\n,\n');
    assert.deepStrictEqual(table.headers, ['a', 'b']);
    assert.deepStrictEqual(table.rows, [['1', '2']]);
});

test('parseDelimitedTable de-duplicates and fills empty headers', () => {
    const table = core.parseDelimitedTable('name,name,\n1,2,3');
    assert.deepStrictEqual(table.headers, ['name', 'name (2)', 'Column 3']);
});

test('parseDelimitedTable tolerates an empty document', () => {
    assert.deepStrictEqual(core.parseDelimitedTable(''), { headers: [], rows: [] });
    assert.deepStrictEqual(core.parseDelimitedTable('\n\n'), { headers: [], rows: [] });
});

test('suggestBriefMapping matches by name, id and slug, without reusing a column', () => {
    const composition = {
        variables: [
            { id: 'headline', name: 'Headline', kind: 'text' },
            { id: 'cta-copy', name: 'CTA copy', kind: 'text' },
            { id: 'accent', name: 'Accent', kind: 'color' },
        ],
    };
    const mapping = core.suggestBriefMapping(composition, ['headline', 'CTA COPY', 'Accent colour']);
    assert.strictEqual(mapping.headline, 0);
    assert.strictEqual(mapping['cta-copy'], 1);
    assert.strictEqual(mapping.accent, 2);

    const partial = core.suggestBriefMapping(composition, ['Headline text', 'Other']);
    assert.strictEqual(partial.headline, 0, 'a substring match is allowed');
    assert.strictEqual(partial['cta-copy'], undefined);
});

test('coerceBriefValue normalises colours and rejects bad ones', () => {
    const colour = { id: 'c', name: 'C', kind: 'color' };
    assert.deepStrictEqual(core.coerceBriefValue(colour, '#ABC'), { ok: true, value: '#aabbcc' });
    assert.deepStrictEqual(core.coerceBriefValue(colour, '3B7FBF'), { ok: true, value: '#3b7fbf' });
    assert.strictEqual(core.coerceBriefValue(colour, 'red').ok, false);
    assert.strictEqual(core.coerceBriefValue(colour, '#12345').ok, false);
});

test('coerceBriefValue validates urls and allows empty text', () => {
    const image = { id: 'i', name: 'Hero', kind: 'image' };
    assert.strictEqual(core.coerceBriefValue(image, 'https://example.com/a.png').ok, true);
    assert.strictEqual(core.coerceBriefValue(image, 'javascript:alert(1)').ok, false);
    assert.strictEqual(core.coerceBriefValue(image, '').ok, false);

    const text = { id: 't', name: 'T', kind: 'text' };
    assert.deepStrictEqual(core.coerceBriefValue(text, ''), { ok: true, value: '' });
    assert.strictEqual(core.coerceBriefValue(text, 'x'.repeat(core.MAX_TEXT_LENGTH + 1)).ok, false);
});

test('resolveBriefRow reports per-variable errors and keeps the good values', () => {
    const composition = {
        variables: [
            { id: 'headline', name: 'Headline', kind: 'text' },
            { id: 'accent', name: 'Accent', kind: 'color' },
        ],
    };
    const ok = core.resolveBriefRow(composition, { headline: 0, accent: 1 }, ['Winter', '#ff0000']);
    assert.strictEqual(ok.ok, true);
    assert.deepStrictEqual(ok.values, { headline: 'Winter', accent: '#ff0000' });

    const bad = core.resolveBriefRow(composition, { headline: 0, accent: 1 }, ['Winter', 'nope']);
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.errors.length, 1);
    assert.strictEqual(bad.errors[0].variableId, 'accent');
    assert.match(bad.errors[0].error, /hex colour/);
    assert.strictEqual(bad.values.headline, 'Winter');
});

test('resolveBriefRow ignores unmapped variables and missing cells', () => {
    const composition = { variables: [{ id: 'a', name: 'A', kind: 'text' }, { id: 'b', name: 'B', kind: 'text' }] };
    const result = core.resolveBriefRow(composition, { a: 0 }, ['only']);
    assert.deepStrictEqual(result.values, { a: 'only' });
    assert.strictEqual(result.ok, true);
});

test('composeBriefRow sets defaults, clears format values and copies deeply', () => {
    const composition = compositionFixture();
    composition.formats[1].variableValues = { headline: 'Story copy', accent: '#00ff00' };
    composition.layers = [{ id: 'l1', type: 'text', text: 'x', bindings: { text: 'headline' }, keyframes: [{ time: 0 }] }];

    const next = core.composeBriefRow(composition, { headline: 'From the brief' }, { label: 'Row A' });
    assert.strictEqual(next.name, `${composition.name} — Row A`);
    assert.strictEqual(next.variables.find((v) => v.id === 'headline').defaultValue, 'From the brief');
    assert.strictEqual(next.formats[1].variableValues.headline, undefined, 'the per-format value is cleared');
    assert.strictEqual(next.formats[1].variableValues.accent, '#00ff00', 'unmapped values survive');
    assert.strictEqual(composition.variables.find((v) => v.id === 'headline').defaultValue, 'Default headline',
        'the template is untouched');

    next.layers[0].bindings.text = 'changed';
    next.layers[0].keyframes[0].time = 99;
    assert.strictEqual(composition.layers[0].bindings.text, 'headline');
    assert.strictEqual(composition.layers[0].keyframes[0].time, 0);
});

test('composeBriefRow respects locked variables', () => {
    const composition = compositionFixture();
    // "accent" is locked; a row value still applies because it becomes the default,
    // not a per-format override.
    const next = core.composeBriefRow(composition, { accent: '#123456' }, {});
    assert.strictEqual(next.variables.find((v) => v.id === 'accent').defaultValue, '#123456');
    assert.strictEqual(core.resolveVariables(next, next.formats[1]).accent, '#123456');
});

test('briefRowLabel prefers a name column, then a mapped text, then the index', () => {
    assert.strictEqual(core.briefRowLabel(['Row A', 'Copy'], ['Name', 'Headline'], { x: 1 }, 0), 'Row A');
    assert.strictEqual(core.briefRowLabel(['Winter launch', 'Built it'], ['Campaign name', 'Headline'], { x: 1 }, 0), 'Winter launch');
    assert.strictEqual(core.briefRowLabel(['', 'Copy'], ['Key', 'Headline'], { x: 1 }, 3), 'Copy');
    assert.strictEqual(core.briefRowLabel(['', ''], ['x', 'y'], {}, 4), 'row 5');
    assert.strictEqual(core.briefRowLabel(['Hero'], ['Hero image'], { hero: 0 }, 1), 'Hero', 'a mapped column is the fallback');
});

// ---------------------------------------------------------------------------
// Phase 4 — safe zones
// ---------------------------------------------------------------------------
const socialComposition = (layers) => ({
    width: 1080,
    height: 1920,
    defaultLocale: 'en',
    variables: [],
    brandKit: null,
    guardrails: { enabled: false, block: false },
    formats: [{
        id: 'story', isMaster: true, channel: 'social', label: 'Story',
        width: 1080, height: 1920, layerOverrides: {}, variableValues: {},
    }],
    activeFormatId: 'story',
    layers,
});

test('normalizeSafeZone clamps insets and treats all-zero as off', () => {
    assert.deepStrictEqual(core.normalizeSafeZone({ top: 0.1, right: 0.05, bottom: 0.2, left: 0.05 }), {
        top: 0.1, right: 0.05, bottom: 0.2, left: 0.05,
    });
    assert.strictEqual(core.normalizeSafeZone({ top: 0, right: 0, bottom: 0, left: 0 }), null);
    assert.strictEqual(core.normalizeSafeZone(null), null);
    assert.strictEqual(core.normalizeSafeZone({ top: 'x' }), null);
    assert.deepStrictEqual(core.normalizeSafeZone({ top: 9, left: -3 }), { top: 0.45, right: 0, bottom: 0, left: 0 });
});

test('safeZoneForFormat derives from the channel, honours overrides and can be turned off', () => {
    const social = { channel: 'social' };
    assert.deepStrictEqual(core.safeZoneForFormat(social), core.SAFE_ZONE_CHANNELS.social);
    assert.deepStrictEqual(
        core.safeZoneForFormat({ channel: 'social', safeZone: { top: 0.02, right: 0.02, bottom: 0.02, left: 0.02 } }),
        { top: 0.02, right: 0.02, bottom: 0.02, left: 0.02 },
    );
    assert.strictEqual(core.safeZoneForFormat({ channel: 'social', safeZone: null }), null, 'null switches it off');
    assert.strictEqual(core.safeZoneForFormat({ channel: 'custom' }), null, 'custom has no default');
    assert.strictEqual(core.safeZoneForFormat(null), null);
});

test('safeZoneRect converts insets to percentages', () => {
    assert.deepStrictEqual(core.safeZoneRect({ top: 0.1, right: 0.05, bottom: 0.2, left: 0.25 }), {
        left: 25, top: 10, right: 95, bottom: 80,
    });
    assert.strictEqual(core.safeZoneRect(null), null);
});

test('safeZoneViolations reports the edges a layer crosses', () => {
    const composition = socialComposition([
        { id: 'bleedbg', type: 'image', name: 'Bg', role: 'background', visible: true, x: 0, y: 0, w: 100, h: 100 },
        { id: 'good', type: 'text', name: 'Good', role: 'foreground', visible: true, x: 10, y: 20, w: 70, h: 60 },
        { id: 'bad', type: 'text', name: 'Bad', role: 'foreground', visible: true, x: 0, y: 0, w: 100, h: 100 },
        { id: 'bleeder', type: 'text', name: 'Bleeder', role: 'foreground', visible: true, bleed: true, x: 0, y: 0, w: 100, h: 100 },
        { id: 'hidden', type: 'text', name: 'Hidden', role: 'foreground', visible: false, x: 0, y: 0, w: 100, h: 100 },
        { id: 'prop', type: 'image', name: 'Prop', role: 'prop', visible: true, x: 0, y: 0, w: 100, h: 100 },
    ]);
    const violations = core.safeZoneViolations(composition, {});
    assert.deepStrictEqual(violations.map((violation) => violation.layerId), ['bad']);
    assert.deepStrictEqual(violations[0].edges, ['left', 'top', 'right', 'bottom']);
    assert.deepStrictEqual(violations[0].rect, { left: 6, top: 12, right: 94, bottom: 84 });
});

test('safeZoneViolations is empty when the format has no zone', () => {
    const composition = socialComposition([
        { id: 'bad', type: 'text', name: 'Bad', role: 'foreground', visible: true, x: 0, y: 0, w: 100, h: 100 },
    ]);
    composition.formats[0].safeZone = null;
    assert.deepStrictEqual(core.safeZoneViolations(composition, {}), []);
});

test('validation reports safe zones even without a brand kit', () => {
    const composition = socialComposition([
        { id: 'bad', type: 'text', name: 'Headline', role: 'foreground', visible: true, x: 0, y: 0, w: 100, h: 100 },
    ]);
    const report = core.validateAgainstBrandKit(composition, {});
    const zoneGroup = report.groups.find((group) => group.id === 'safeZone');
    assert.ok(zoneGroup, 'the safe-zone group is present');
    assert.strictEqual(zoneGroup.ok, false);
    assert.match(zoneGroup.entries[0].text, /crosses the safe area on the left, top, right, bottom/);
    assert.ok(report.groups.some((group) => group.id === 'kit'), 'the missing-kit group is still reported');
});

test('validation accepts a shared kit supplied by the caller', () => {
    const composition = socialComposition([
        { id: 't', type: 'text', name: 'Headline', role: 'foreground', visible: true, x: 10, y: 20, w: 70, h: 20, text: 'Hi', color: '#111111', font: { family: 'Inter' } },
    ]);
    composition.brandKit = null;
    const kit = { id: 'shared', name: 'Shared', palette: [{ name: 'Ink', hex: '#111111' }], fonts: [{ name: 'Body', family: 'Inter', weight: 400, style: 'normal' }], logos: [] };
    const report = core.validateAgainstBrandKit(composition, { kit });
    assert.ok(!report.groups.some((group) => group.id === 'kit'), 'no missing-kit group');
    assert.strictEqual(report.groups.find((group) => group.id === 'fonts').ok, true);
});

// ---------------------------------------------------------------------------
// Phase 4 — guardrails
// ---------------------------------------------------------------------------
test('normalizeGuardrails defaults to off', () => {
    assert.deepStrictEqual(core.normalizeGuardrails(undefined), { enabled: false, block: false });
    assert.deepStrictEqual(core.normalizeGuardrails({ enabled: true }), { enabled: true, block: false });
    assert.deepStrictEqual(core.normalizeGuardrails({ enabled: 1, block: 'yes' }), { enabled: false, block: false });
});

test('evaluateGuardrails is skipped when disabled', () => {
    const composition = socialComposition([]);
    const result = core.evaluateGuardrails(composition, {});
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.blocking, false);
});

test('evaluateGuardrails blocks on font drift and safe zones, but not on palette', () => {
    const composition = socialComposition([
        {
            id: 't', type: 'text', name: 'Headline', role: 'foreground', visible: true,
            x: 10, y: 20, w: 70, h: 20, text: 'Hi', color: '#3b7fbf',
            font: { family: 'Comic Sans MS' },
        },
    ]);
    composition.guardrails = { enabled: true, block: true };
    composition.brandKit = {
        id: 'kit', name: 'Acme',
        palette: [{ name: 'Ink', hex: '#111111' }],
        fonts: [{ name: 'Body', family: 'Inter', weight: 400, style: 'normal' }],
        logos: [],
    };
    const result = core.evaluateGuardrails(composition, {});
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((line) => /Font drift/.test(line)));
    assert.ok(result.warnings.some((line) => /Palette drift/.test(line)), 'palette is advisory');
    assert.strictEqual(result.blocking, true);
});

test('evaluateGuardrails does not block when block is off', () => {
    const composition = socialComposition([
        {
            id: 't', type: 'text', name: 'Headline', role: 'foreground', visible: true,
            x: 0, y: 0, w: 100, h: 100, text: 'Hi', color: '#111111', font: { family: 'Inter' },
        },
    ]);
    composition.guardrails = { enabled: true, block: false };
    composition.brandKit = {
        id: 'kit', name: 'Acme',
        palette: [{ name: 'Ink', hex: '#111111' }],
        fonts: [{ name: 'Body', family: 'Inter', weight: 400, style: 'normal' }],
        logos: [],
    };
    const result = core.evaluateGuardrails(composition, {});
    assert.strictEqual(result.ok, false, 'the safe-zone rule still fails');
    assert.strictEqual(result.blocking, false, 'but it does not block');
});
