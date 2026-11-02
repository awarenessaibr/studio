'use strict';
/**
 * CLI tests for composition-generator.js — scaffold mode and brief mode.
 *
 * Run with: node --test "tests/*.test.js"
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'src', 'server', 'composition-generator.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'brief.xlsx');

/**
 * Runs the CLI and returns both streams whatever the exit code: warnings go to
 * stderr and a partial run still exits 0.
 */
function run(args) {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
    return {
        status: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        output: `${result.stdout || ''}${result.stderr || ''}`,
    };
}

async function tempDir() {
    return fsp.mkdtemp(path.join(os.tmpdir(), 'ls-gen-'));
}

const template = () => ({
    version: 3,
    id: 'campaign',
    name: 'Winter campaign',
    width: 1080,
    height: 1080,
    duration: 4000,
    defaultLocale: 'en',
    referenceLayerId: null,
    characters: [],
    brandKit: null,
    formats: [{
        id: 'master', isMaster: true, channel: 'custom', label: 'Master',
        width: 1080, height: 1080, layerOverrides: {}, variableValues: {},
    }],
    activeFormatId: 'master',
    variables: [
        { id: 'headline', name: 'Headline', kind: 'text', defaultValue: 'Template headline', locked: false },
        { id: 'cta', name: 'CTA', kind: 'text', defaultValue: 'Template CTA', locked: false },
        { id: 'accent', name: 'Accent', kind: 'color', defaultValue: '#111111', locked: true },
    ],
    layers: [{
        id: 'headline', type: 'text', name: 'Headline', role: 'foreground',
        text: 'x', bindings: { text: 'headline', color: 'accent' },
        color: '#111111', align: 'left', verticalAlign: 'middle', overflow: 'clip',
        font: { family: 'Inter', weight: 700, sizePct: 6, lineHeight: 1.15, letterSpacingEm: 0, style: 'normal', transform: 'none' },
        x: 8, y: 20, w: 84, h: 20, z: 1, opacity: 1,
    }],
});

test('the CLI scaffolds a composition from a folder', async () => {
    const dir = await tempDir();
    try {
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wFZQ/3kAAAAAElFTkSuQmCC',
            'base64',
        );
        await fsp.writeFile(path.join(dir, 'background.png'), png);
        await fsp.writeFile(path.join(dir, 'hero-1.png'), png);
        await fsp.writeFile(path.join(dir, 'hero-2.png'), png);
        const out = path.join(dir, 'scene.json');
        const result = run([dir, 'Scaffold Test', '--text', 'Hello there', '--out', out]);
        assert.strictEqual(result.status, 0, result.output);
        assert.match(result.stdout, /layers/);
        const composition = JSON.parse(await fsp.readFile(out, 'utf8'));
        assert.strictEqual(composition.version, 3);
        assert.strictEqual(composition.formats.length, 1);
        assert.strictEqual(composition.activeFormatId, 'master');
        assert.ok(composition.layers.some((layer) => layer.type === 'text'), 'the --text layer is emitted');
        assert.ok(composition.layers.every((layer) => layer.type === 'text' || layer.frames.length >= 1));
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('the CLI writes one composition per brief row (xlsx)', async () => {
    const dir = await tempDir();
    try {
        const templatePath = path.join(dir, 'template.json');
        await fsp.writeFile(templatePath, JSON.stringify(template(), null, 2));
        const outDir = path.join(dir, 'out');
        const result = run(['--brief', FIXTURE, '--template', templatePath, '--out-dir', outDir]);
        assert.strictEqual(result.status, 0, result.output);
        assert.match(result.stdout, /3 compositions/);
        assert.match(result.stdout, /XLSX/);

        const files = (await fsp.readdir(outDir)).sort();
        assert.deepStrictEqual(files, [
            'spring-drop.composition.json',
            'summer.composition.json',
            'winter-launch.composition.json',
        ]);

        const spring = JSON.parse(await fsp.readFile(path.join(outDir, 'spring-drop.composition.json'), 'utf8'));
        assert.strictEqual(spring.name, 'Winter campaign — Spring drop');
        assert.strictEqual(spring.variables.find((v) => v.id === 'headline').defaultValue, 'Bloom & grow, gently');
        assert.strictEqual(spring.variables.find((v) => v.id === 'accent').defaultValue, '#f0a35e');
        assert.deepStrictEqual(spring.formats[0].variableValues, {}, 'row values become defaults, not overrides');
        assert.strictEqual(spring.layers.length, 1, 'the template layers are carried over');
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('the CLI reports invalid rows and keeps the valid ones', async () => {
    const dir = await tempDir();
    try {
        const templatePath = path.join(dir, 'template.json');
        await fsp.writeFile(templatePath, JSON.stringify(template(), null, 2));
        const briefPath = path.join(dir, 'rows.csv');
        await fsp.writeFile(briefPath,
            'Campaign name,Headline,CTA,Accent\n'
            + 'Good,Winter copy,Shop,#123456\n'
            + 'Bad,Broken copy,Shop,not-a-colour\n');
        const outDir = path.join(dir, 'out');
        const result = run(['--brief', briefPath, '--template', templatePath, '--out-dir', outDir]);
        assert.strictEqual(result.status, 0, result.output);
        assert.match(result.stderr, /row 3 skipped/);
        assert.match(result.stdout, /1 composition/);
        const files = await fsp.readdir(outDir);
        assert.ok(files.includes('good.composition.json'), 'the valid row is written');
        assert.ok(!files.some((name) => name.startsWith('bad')), 'the invalid row is not written');
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('the CLI refuses a template without variables and a brief with no match', async () => {
    const dir = await tempDir();
    try {
        const bare = { ...template(), variables: [] };
        const templatePath = path.join(dir, 'bare.json');
        await fsp.writeFile(templatePath, JSON.stringify(bare, null, 2));
        const noVariables = run([
            '--brief', path.join(__dirname, 'fixtures', 'brief.xlsx'),
            '--template', templatePath,
            '--out-dir', path.join(dir, 'a'),
        ]);
        assert.strictEqual(noVariables.status, 1, noVariables.output);
        assert.match(noVariables.output, /no variables/);

        const templatePath2 = path.join(dir, 't2.json');
        await fsp.writeFile(templatePath2, JSON.stringify(template(), null, 2));
        const briefPath = path.join(dir, 'unrelated.csv');
        await fsp.writeFile(briefPath, 'alpha,beta\n1,2\n');
        const noMatch = run([
            '--brief', briefPath,
            '--template', templatePath2,
            '--out-dir', path.join(dir, 'b'),
        ]);
        assert.strictEqual(noMatch.status, 1, noMatch.output);
        assert.match(noMatch.output, /No brief column matches/);
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('the CLI prints usage when neither a folder nor a brief is given', () => {
    const result = run([]);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /usage:/);
});
