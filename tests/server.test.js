'use strict';
/**
 * Server-side tests: schema guards for the additive Phase 2/3 fields,
 * the director catalog's text annotation, and font magic-byte validation.
 *
 * Run with: node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const server = require('../server.js');

const IMPORTS = path.join(__dirname, '..', 'data', 'imports');
const FONTS = path.join(__dirname, '..', 'data', 'fonts');
const created = new Set();
const createdFonts = new Set();

async function seedProject(id, composition) {
    const dir = path.join(IMPORTS, id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'composition.json'), JSON.stringify(composition, null, 2));
    created.add(id);
    return id;
}

test.after(async () => {
    await Promise.all([
        ...[...created].map((id) => (
            fsp.rm(path.join(IMPORTS, id), { recursive: true, force: true }).catch(() => {})
        )),
        ...[...createdFonts].map((id) => (
            fsp.rm(path.join(FONTS, `${id}.ttf`), { force: true }).catch(() => {})
        )),
    ]);
});

test('DeepSeek director status requires server-side credentials and never exposes the API key', () => {
    const keys = ['STUDIO_DEEPSEEK_API_KEY', 'STUDIO_DEEPSEEK_MODEL', 'STUDIO_DEEPSEEK_BASE_URL'];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
        delete process.env.STUDIO_DEEPSEEK_API_KEY;
        process.env.STUDIO_DEEPSEEK_MODEL = 'deepseek-flash';
        const missingKey = server.getDeepSeekDirectorStatus();
        assert.equal(missingKey.available, false);
        assert.match(missingKey.error, /STUDIO_DEEPSEEK_API_KEY/);
        assert.equal(Object.hasOwn(missingKey, 'apiKey'), false);

        process.env.STUDIO_DEEPSEEK_API_KEY = 'test-secret';
        const configured = server.getDeepSeekDirectorStatus();
        assert.deepEqual(configured, { available: true, model: 'deepseek-flash', error: null });
        assert.equal(JSON.stringify(configured).includes('test-secret'), false);

        delete process.env.STUDIO_DEEPSEEK_MODEL;
        const missingModel = server.getDeepSeekDirectorStatus();
        assert.equal(missingModel.available, false);
        assert.match(missingModel.error, /STUDIO_DEEPSEEK_MODEL/);
    } finally {
        keys.forEach((key) => {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        });
    }
});

test('Ollama vision detection uses explicit capabilities and keeps legacy name fallback', () => {
    assert.equal(server.isVisionModel({
        name: 'ornith-1.5:9b',
        details: { families: ['qwen35'] },
        capabilities: ['tools', 'thinking', 'completion', 'vision'],
    }), true);
    assert.equal(server.isVisionModel({
        name: 'bonsai-2:9b',
        details: { families: ['qwen35'] },
        capabilities: ['completion', 'tools'],
    }), false);
    assert.equal(server.isVisionModel({ name: 'granite3.2-vision:2b' }), true);
});

test('Ollama thinking detection supports custom model names from capability metadata', () => {
    assert.equal(server.supportsThinking({
        name: 'bonsai-2:9b',
        capabilities: ['completion', 'vision', 'thinking'],
    }), true);
    assert.equal(server.supportsThinking({
        name: 'custom-text:7b',
        capabilities: ['completion'],
    }), false);
    assert.equal(server.supportsThinking({ name: 'qwen3.5:9b' }), true);
});

test('Ollama animation prompt stays compact while retaining scene and layer guidance', () => {
    const composition = {
        name: 'Coastal scene',
        width: 736,
        height: 1308,
        duration: 9000,
        characters: [],
    };
    const catalog = Array.from({ length: 27 }, (_, index) => ({
        alias: `L${String(index + 1).padStart(2, '0')}`,
        name: `Layer ${index + 1}`,
        role: 'background',
        type: 'image',
        z: index,
        x: 0,
        y: 0,
        w: 100,
        h: 100,
    }));
    const prompt = server.buildWriterPrompt({
        composition,
        context: '',
        analysis: { subject: 'lighthouse', mood: 'calm' },
        catalog,
        count: 4,
        retry: false,
        concise: true,
    });
    assert.ok(prompt.length < 2200);
    assert.match(prompt, /exactly 4 distinct ideas/);
    assert.match(prompt, /exactly 6 commands/);
    assert.match(prompt, /L27\|Layer 27\|background/);
    assert.match(prompt, /ANALYSIS:.*lighthouse/);
    assert.doesNotMatch(prompt, /box=/);
});

const baseComposition = () => ({
    version: 3,
    id: 'test-project',
    name: 'Test scene',
    width: 1080,
    height: 1080,
    duration: 3000,
    defaultLocale: 'en',
    referenceLayerId: null,
    characters: [],
    layers: [
        { id: 'bg', type: 'image', name: 'Sky', url: 'data:image/png;base64,AAAA', x: 0, y: 0, w: 100, h: 100, z: 0 },
    ],
});

// ---------------------------------------------------------------------------
// Project assets
// ---------------------------------------------------------------------------
test('resolveProjectAssetPath keeps repository assets inside assets/', () => {
    const root = path.join(__dirname, '..', 'data', 'projects', 'demo', 'assets');
    assert.strictEqual(
        server.resolveProjectAssetPath('demo', 'segments/dots/dot-001.png'),
        path.join(root, 'segments', 'dots', 'dot-001.png'),
    );
    assert.strictEqual(server.resolveProjectAssetPath('demo', '../composition.json'), null);
    assert.strictEqual(server.resolveProjectAssetPath('demo', 'segments/../../.env'), null);
    assert.strictEqual(server.resolveProjectAssetPath('demo', '.secret/x.png'), null);
    assert.strictEqual(server.resolveProjectAssetPath('bad/name', 'x.png'), null);
    assert.strictEqual(server.resolveProjectAssetPath('demo', ''), null);
});

// Created templates reference /data/imports/<id>/assets/... URLs. The static
// route must expose those raster files without exposing composition.json,
// source ZIPs or anything outside the import folder.
test('importPublicFile exposes import media only', () => {
    const imports = path.join(__dirname, '..', 'data', 'imports');
    assert.strictEqual(
        server.importPublicFile('/data/imports/demo/assets/logo.svg'),
        path.join(imports, 'demo', 'assets', 'logo.svg'),
    );
    assert.strictEqual(
        server.importPublicFile('/data/imports/demo/segments/01.png'),
        path.join(imports, 'demo', 'segments', '01.png'),
    );
    assert.strictEqual(server.importPublicFile('/data/imports/demo/composition.json'), null);
    assert.strictEqual(server.importPublicFile('/data/imports/demo/source.zip'), null);
    assert.strictEqual(server.importPublicFile('/data/imports/demo/../../.env'), null);
    assert.strictEqual(server.importPublicFile('/data/assets/demo/original.png'), null);
    assert.strictEqual(server.importPublicFile('/data/imports/demo/assets/page.html'), null);
});

test('projectPublicFile exposes project images and composition JSON only', () => {
    const projects = path.join(__dirname, '..', 'data', 'projects');
    assert.strictEqual(
        server.projectPublicFile('/data/projects/demo/images/Book/cover.png'),
        path.join(projects, 'demo', 'images', 'Book', 'cover.png'),
    );
    assert.strictEqual(
        server.projectPublicFile('/data/projects/demo/assets/segments/01.webp'),
        path.join(projects, 'demo', 'assets', 'segments', '01.webp'),
    );
    assert.strictEqual(
        server.projectPublicFile('/data/projects/demo/compositions/demo.composition.json'),
        path.join(projects, 'demo', 'compositions', 'demo.composition.json'),
    );
    assert.strictEqual(server.projectPublicFile('/data/projects/demo/compositions/page.html'), null);
    assert.strictEqual(server.projectPublicFile('/data/projects/demo/images/../../.env'), null);
    assert.strictEqual(server.projectPublicFile('/data/projects/demo/images/page.html'), null);
});

test('studio project archive status persists and can be restored', async () => {
    const catalog = await server.listStudioProjects();
    const project = catalog.find((item) => item.id === 'repo-Butterfly-The-Stairs');
    assert.ok(project, 'Butterfly-The-Stairs repository project is listed');
    const originalStatus = project.archived;
    try {
        await server.setStudioProjectArchived(project.id, !originalStatus);
        const archived = (await server.listStudioProjects()).find((item) => item.id === project.id);
        assert.equal(archived.archived, !originalStatus);
    } finally {
        await server.setStudioProjectArchived(project.id, originalStatus);
    }
    const restored = (await server.listStudioProjects()).find((item) => item.id === project.id);
    assert.equal(restored.archived, originalStatus);
});

test('repository scene animations are listed and loaded with their referenced scene', async () => {
    const catalog = await server.listStudioProjects();
    const project = catalog.find((item) => item.id === 'repo-Butterfly-The-Stairs');
    assert.ok(project, 'Butterfly-The-Stairs repository project is listed');
    const variants = project.compositions.filter((item) => item.kind === 'animation'
        && item.id.startsWith('ambient-'));
    assert.deepStrictEqual(
        variants.map((item) => item.id).sort(),
        ['ambient-lighting-and-movement'],
    );
    variants.forEach((variant) => {
        assert.equal(variant.sceneId, 'Butterfly-The-Stairs');
    });

    const loaded = await server.readStudioComposition(project.id, 'ambient-lighting-and-movement');
    assert.equal(loaded.type, 'studio-scene-animation');
    assert.equal(loaded.scene.id, 'Butterfly-The-Stairs');
    assert.equal(loaded.animation.id, 'ambient-lighting-and-movement');
});

test('repository animation folder accepts complete composition JSON variants', async () => {
    const catalog = await server.listStudioProjects();
    const project = catalog.find((item) => item.id === 'repo-Butterfly-The-Stairs');
    const variants = project.compositions.filter((item) => item.id.startsWith('Butterfly-Stairs-'));
    assert.deepStrictEqual(
        variants.map((item) => item.id).sort(),
        [
            'Butterfly-Stairs-A-gallery-reveal',
            'Butterfly-Stairs-B-warm-light-and-dust',
            'Butterfly-Stairs-C-parallax-push-in',
        ],
    );
    variants.forEach((variant) => assert.equal(variant.kind, 'animation'));

    const loaded = await server.readStudioComposition(
        project.id,
        'Butterfly-Stairs-C-parallax-push-in',
    );
    assert.equal(loaded.id, 'Butterfly-The-Stairs-parallax');
    assert.equal(loaded.duration, 9000);
    assert.equal(loaded.layers.length, 85);
    assert.ok(loaded.layers.some((layer) => layer.keyframes.length > 0));
});

test('transcodeVideoToMp4 yields an H.264 MP4 when ffmpeg is installed', async (t) => {
    const ffmpeg = process.env.STUDIO_FFMPEG || 'ffmpeg';
    const ffprobe = process.env.STUDIO_FFPROBE || 'ffprobe';
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'studio-transcode-test-'));
    const input = path.join(dir, 'input.mp4');
    try {
        try {
            execFileSync(ffmpeg, [
                '-hide_banner', '-loglevel', 'error', '-y',
                '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=0.6',
                '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input,
            ], { stdio: 'ignore' });
        } catch {
            t.skip('ffmpeg is not installed');
            return;
        }
        const source = await fsp.readFile(input);
        const output = await server.transcodeVideoToMp4(source, 'video/mp4');
        assert.ok(output.length > 500, `transcoded ${output.length} bytes`);
        assert.match(output.toString('latin1').slice(0, 32), /ftyp/);
        const transcodedPath = path.join(dir, 'transcoded.mp4');
        await fsp.writeFile(transcodedPath, output);
        // ffprobe is optional; the container header above is the mandatory
        // assertion. When it is present, prove the codec is H.264.
        let codec = '';
        try {
            codec = execFileSync(ffprobe, [
                '-hide_banner', '-loglevel', 'error',
                '-select_streams', 'v:0',
                '-show_entries', 'stream=codec_name',
                '-of', 'default=nw=1:nk=1',
                transcodedPath,
            ], { encoding: 'utf8' }).trim();
        } catch {
            codec = '';
        }
        if (codec) assert.strictEqual(codec, 'h264');
    } finally {
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
});

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------
test('detectFontFormat validates WOFF2, WOFF, TTF and OTF magic bytes', () => {
    assert.strictEqual(server.detectFontFormat(Buffer.from('wOF2xxxx')).ext, 'woff2');
    assert.strictEqual(server.detectFontFormat(Buffer.from('wOFFxxxx')).ext, 'woff');
    assert.strictEqual(server.detectFontFormat(Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00])).ext, 'ttf');
    assert.strictEqual(server.detectFontFormat(Buffer.from('OTTOxxxx')).ext, 'otf');
    assert.strictEqual(server.detectFontFormat(Buffer.from('NOPE')), null);
    assert.strictEqual(server.detectFontFormat(Buffer.alloc(0)), null);
    assert.strictEqual(server.detectFontFormat(null), null);
});

test('saveFont rejects a non data URL payload', async () => {
    await assert.rejects(() => server.saveFont({ name: 'X.woff2', dataUrl: 'not-a-data-url' }), /base64 data URL/);
});

test('saveFont rejects unsupported magic bytes', async () => {
    const dataUrl = `data:font/woff2;base64,${Buffer.from('JUNKJUNK').toString('base64')}`;
    await assert.rejects(() => server.saveFont({ name: 'X.woff2', dataUrl }), /Unsupported font format/);
});

test('saveFont stores a magic-byte-valid font and listFonts reports it', async () => {
    // A syntactically valid TTF header is all the server validates.
    const payload = Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.alloc(512, 7)]);
    const dataUrl = `data:font/ttf;base64,${payload.toString('base64')}`;
    const saved = await server.saveFont({ name: 'Smoke Sans.ttf', dataUrl });
    createdFonts.add(saved.id);
    assert.strictEqual(saved.family, 'Smoke Sans');
    assert.strictEqual(saved.format, 'ttf');
    assert.match(saved.url, /^\/api\/fonts\/smoke-sans-[0-9a-f]{6}\.ttf$/);
    const fonts = await server.listFonts();
    assert.ok(fonts.some((font) => font.id === saved.id), 'the listing includes the new font');
});

// ---------------------------------------------------------------------------
// Director catalog
// ---------------------------------------------------------------------------
test('buildDirectorCatalog marks text layers and includes their copy', () => {
    const composition = {
        ...baseComposition(),
        layers: [
            { id: 'bg', type: 'image', name: 'Sky', role: 'background', url: 'x.png', x: 0, y: 0, w: 100, h: 100, z: 0 },
            {
                id: 'headline', type: 'text', name: 'Headline', role: 'foreground',
                text: { en: 'Fire up the grill' }, font: { family: 'Inter' },
                x: 10, y: 20, w: 80, h: 10, z: 40,
            },
        ],
    };
    const catalog = server.buildDirectorCatalog(composition);
    const headline = catalog.find((entry) => entry.id === 'headline');
    assert.ok(headline, 'the text layer appears in the inventory');
    assert.strictEqual(headline.type, 'text');
    assert.strictEqual(headline.text, 'Fire up the grill');
    const background = catalog.find((entry) => entry.id === 'bg');
    assert.strictEqual(background.type, 'image');
});

// ---------------------------------------------------------------------------
// saveComposition guards
// ---------------------------------------------------------------------------
test('saveComposition preserves formats, variables and brandKit from a stale client', async () => {
    const seeded = {
        ...baseComposition(),
        formats: [
            { id: 'master', isMaster: true, channel: 'custom', label: 'Master', width: 1080, height: 1080, layerOverrides: {}, variableValues: {} },
            { id: 'story', isMaster: false, channel: 'social', label: 'Story', width: 1080, height: 1920, layerOverrides: {}, variableValues: {} },
        ],
        activeFormatId: 'story',
        variables: [{ id: 'headline', name: 'Headline', kind: 'text', defaultValue: 'Hi', locked: false }],
        brandKit: { id: 'kit', name: 'Acme', palette: [{ name: 'Ink', hex: '#111111' }], fonts: [], logos: [] },
    };
    const id = await seedProject(`test-stale-${Date.now().toString(36)}`, seeded);

    // A pre-Phase-2 client: no formats, variables or brandKit keys at all.
    const saved = await server.saveComposition(id, {
        composition: {
            version: 1,
            id,
            name: 'Test scene',
            width: 1080,
            height: 1080,
            duration: 3000,
            layers: [{ id: 'bg', name: 'Sky', url: 'data:image/png;base64,AAAA', x: 0, y: 0, w: 100, h: 100, z: 0 }],
        },
    });

    assert.strictEqual(saved.composition.version, 3, 'a stale client cannot downgrade the version');
    assert.strictEqual(saved.composition.formats.length, 2, 'stored formats survive');
    assert.strictEqual(saved.composition.activeFormatId, 'story');
    assert.strictEqual(saved.composition.variables.length, 1);
    assert.strictEqual(saved.composition.brandKit.name, 'Acme');
});

test('createCompositionProject writes an editable import project', async () => {
    const composition = {
        ...baseComposition(),
        id: 'incoming',
        name: 'Saved from Agent Studio',
    };
    const result = await server.createCompositionProject({ name: 'Agent save test', composition });
    created.add(result.project.id);
    assert.ok(/^agent-save-test-/.test(result.project.id));
    assert.strictEqual(result.composition.id, result.project.id);
    assert.strictEqual(result.composition.meta.source, 'agent-studio-save');
    const saved = JSON.parse(await fsp.readFile(
        path.join(IMPORTS, result.project.id, 'composition.json'),
        'utf8',
    ));
    assert.strictEqual(saved.id, result.project.id);
    assert.strictEqual(saved.name, 'Agent save test');
    assert.strictEqual(saved.layers.length, 1);
    assert.strictEqual(saved.meta.storage, `data/imports/${result.project.id}`);
});

test('saveComposition preserves text metadata and bindings from a stale client', async () => {
    const seeded = {
        ...baseComposition(),
        layers: [{
            id: 'headline',
            type: 'text',
            name: 'Headline',
            text: { en: 'Hello' },
            font: { family: 'Inter', weight: 700, sizePct: 9, lineHeight: 1.15, letterSpacingEm: 0, style: 'normal', transform: 'none' },
            color: '#111111',
            align: 'left',
            verticalAlign: 'top',
            overflow: 'clip',
            bindings: { text: 'headline' },
            x: 0, y: 0, w: 80, h: 10, z: 1,
        }],
    };
    const id = await seedProject(`test-text-${Date.now().toString(36)}`, seeded);

    const saved = await server.saveComposition(id, {
        composition: {
            version: 1,
            id,
            name: 'Test scene',
            width: 1080,
            height: 1080,
            duration: 3000,
            // The stale client drops type/text/font/bindings entirely.
            layers: [{ id: 'headline', name: 'Headline', url: 'data:image/png;base64,AAAA', x: 0, y: 0, w: 80, h: 10, z: 1 }],
        },
    });

    const layer = saved.composition.layers.find((item) => item.id === 'headline');
    assert.strictEqual(layer.type, 'text');
    assert.strictEqual(layer.text.en, 'Hello');
    assert.strictEqual(layer.font.family, 'Inter');
    assert.deepStrictEqual(layer.bindings, { text: 'headline' });
});

test('saveComposition preserves the Phase 4 fields from a stale client', async () => {
    const seeded = {
        ...baseComposition(),
        brandKitId: 'shared-kit-1',
        guardrails: { enabled: true, block: true },
        showSafeZones: false,
        formats: [{
            id: 'master', isMaster: true, channel: 'social', label: 'Master',
            width: 1080, height: 1080, layerOverrides: {}, variableValues: {},
            safeZone: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
        }],
        layers: [{ id: 'bg', type: 'text', name: 'Headline', text: 'x', bleed: true, x: 0, y: 0, w: 100, h: 100, z: 0 }],
    };
    const id = await seedProject(`test-phase4-${Date.now().toString(36)}`, seeded);

    const saved = await server.saveComposition(id, {
        composition: {
            version: 3,
            id,
            name: 'Test scene',
            width: 1080,
            height: 1080,
            duration: 3000,
            // A pre-Phase-4 client: no brandKitId / guardrails / showSafeZones.
            layers: [{ id: 'bg', name: 'Headline', url: 'data:image/png;base64,AAAA', x: 0, y: 0, w: 100, h: 100, z: 0 }],
        },
    });

    assert.strictEqual(saved.composition.brandKitId, 'shared-kit-1');
    assert.deepStrictEqual(saved.composition.guardrails, { enabled: true, block: true });
    assert.strictEqual(saved.composition.showSafeZones, false);
    assert.strictEqual(saved.composition.formats[0].safeZone.top, 0.1);
    assert.strictEqual(saved.composition.layers[0].bleed, true);
});

test('saveComposition accepts an intentional unlink (empty bindings object)', async () => {
    const seeded = {
        ...baseComposition(),
        layers: [{
            id: 'headline',
            type: 'text',
            name: 'Headline',
            text: 'Hello',
            bindings: { text: 'headline' },
            x: 0, y: 0, w: 80, h: 10, z: 1,
        }],
    };
    const id = await seedProject(`test-unlink-${Date.now().toString(36)}`, seeded);

    const saved = await server.saveComposition(id, {
        composition: {
            version: 3,
            id,
            name: 'Test scene',
            width: 1080,
            height: 1080,
            duration: 3000,
            layers: [{
                id: 'headline', type: 'text', name: 'Headline', text: 'Hello',
                bindings: {}, x: 0, y: 0, w: 80, h: 10, z: 1,
            }],
        },
    });

    const layer = saved.composition.layers.find((item) => item.id === 'headline');
    assert.deepStrictEqual(layer.bindings, {}, 'a current client may clear bindings');
});

test('saveComposition keeps the highest version so it never downgrades', async () => {
    const id = await seedProject(`test-version-${Date.now().toString(36)}`, {
        ...baseComposition(),
        version: 3,
    });
    const saved = await server.saveComposition(id, {
        composition: { ...baseComposition(), id, version: 2 },
    });
    assert.strictEqual(saved.composition.version, 3);
});

// ---------------------------------------------------------------------------
// Brief ingestion (Phase 5)
// ---------------------------------------------------------------------------
const FIXTURES = path.join(__dirname, 'fixtures');

test('parseBriefFile reads a real .xlsx workbook', async () => {
    const buffer = await fsp.readFile(path.join(FIXTURES, 'brief.xlsx'));
    const result = server.parseBriefFile('brief.xlsx', buffer);
    assert.strictEqual(result.source, 'xlsx');
    assert.strictEqual(result.sheet, 'Campaign');
    assert.deepStrictEqual(result.sheets, ['Campaign', 'Notes']);
    assert.deepStrictEqual(result.headers, [
        'Campaign name', 'Headline', 'CTA', 'Accent', 'Hero image', 'Priority',
    ]);
    assert.strictEqual(result.rows.length, 3);
    assert.deepStrictEqual(result.rows[0], [
        'Winter launch', 'Built for the long winter', 'Shop the jacket',
        '#0b1b33', 'https://example.com/winter.png', '1',
    ]);
    assert.strictEqual(result.rows[1][1], 'Bloom & grow, gently', 'XML entities are decoded');
});

test('parseBriefFile can select a named sheet and reports an empty one', async () => {
    const buffer = await fsp.readFile(path.join(FIXTURES, 'brief.xlsx'));
    const notes = server.parseBriefFile('brief.xlsx', buffer, { sheet: 'Notes' });
    assert.strictEqual(notes.sheet, 'Notes');
    assert.strictEqual(notes.headers[0], 'One row per creative. Columns map to template variables.');
});

test('parseBriefFile reads CSV with a BOM and quoted commas', () => {
    const csv = '\uFEFFCampaign name,Headline,Accent\nWinter,"Built, for the winter",#abc\n';
    const result = server.parseBriefFile('brief.csv', Buffer.from(csv, 'utf8'));
    assert.strictEqual(result.source, 'csv');
    assert.deepStrictEqual(result.headers, ['Campaign name', 'Headline', 'Accent']);
    assert.deepStrictEqual(result.rows, [['Winter', 'Built, for the winter', '#abc']]);
});

test('parseBriefFile rejects empty files, legacy .xls and mislabelled workbooks', () => {
    // parseBriefFile is synchronous: it throws rather than rejecting.
    assert.throws(() => server.parseBriefFile('x.csv', Buffer.alloc(0)), /empty/);
    const ole2 = Buffer.concat([Buffer.from([0xD0, 0xCF, 0x11, 0xE0]), Buffer.alloc(64)]);
    assert.throws(() => server.parseBriefFile('legacy.xls', ole2), /Legacy \.xls/);
    assert.throws(
        () => server.parseBriefFile('notes.xlsx', Buffer.from('a,b\n1,2')),
        /not a readable \.xlsx/,
    );
    assert.throws(() => server.parseBriefFile('empty.csv', Buffer.from('\n\n')), /no header row/);
});

test('a parsed brief drives composeBriefRow end to end', async () => {
    const fs = require('node:fs');
    const core = require('../src/shared/studio-core.js');
    const buffer = await fsp.readFile(path.join(FIXTURES, 'brief.xlsx'));
    const brief = server.parseBriefFile('brief.xlsx', buffer);
    const composition = {
        ...baseComposition(),
        name: 'Campaign template',
        variables: [
            { id: 'headline', name: 'Headline', kind: 'text', defaultValue: 'Template headline', locked: false },
            { id: 'cta', name: 'CTA', kind: 'text', defaultValue: 'Template CTA', locked: false },
            { id: 'accent', name: 'Accent', kind: 'color', defaultValue: '#000000', locked: true },
        ],
        formats: [{
            id: 'master', isMaster: true, label: 'Master', width: 1080, height: 1080,
            layerOverrides: {}, variableValues: {},
        }],
        layers: [{ id: 't', type: 'text', name: 'Headline', text: 'x', bindings: { text: 'headline', color: 'accent' } }],
    };
    assert.ok(fs.existsSync(path.join(FIXTURES, 'brief.xlsx')));

    const mapping = core.suggestBriefMapping(composition, brief.headers);
    assert.deepStrictEqual(mapping, { headline: 1, cta: 2, accent: 3 });

    const row = core.resolveBriefRow(composition, mapping, brief.rows[1]);
    assert.strictEqual(row.ok, true, JSON.stringify(row.errors));
    assert.strictEqual(row.values.headline, 'Bloom & grow, gently');
    assert.strictEqual(row.values.accent, '#f0a35e');

    const derived = core.composeBriefRow(composition, row.values, { label: 'Spring drop' });
    assert.strictEqual(derived.variables.find((v) => v.id === 'headline').defaultValue, 'Bloom & grow, gently');
    assert.strictEqual(core.resolveVariables(derived, derived.formats[0]).accent, '#f0a35e');
    assert.strictEqual(composition.variables[0].defaultValue, 'Template headline', 'the template is untouched');
});

// ---------------------------------------------------------------------------
// Shared brand kits (Phase 4)
// ---------------------------------------------------------------------------
const KITS = path.join(__dirname, '..', 'data', 'brand-kits');
const createdKits = new Set();

test.after(async () => {
    await Promise.all([...createdKits].map((id) => (
        fsp.rm(path.join(KITS, `${id}.json`), { force: true }).catch(() => {})
    )));
});

const kitPayload = (overrides = {}) => ({
    name: 'Acme',
    palette: [{ name: 'Ink', hex: '#111111' }, { name: 'Ember', hex: '#f0a35e' }],
    fonts: [{ name: 'Display', family: 'Inter', weight: 700, style: 'normal' }],
    logos: [{ name: 'Mark', url: 'https://example.com/logo.png' }],
    ...overrides,
});

test('brand kits round-trip through the store', async () => {
    const id = `test-kit-${Date.now().toString(36)}`;
    createdKits.add(id);
    const saved = await server.saveBrandKit(id, kitPayload());
    assert.strictEqual(saved.kit.id, id);
    assert.strictEqual(saved.kit.name, 'Acme');
    assert.strictEqual(saved.kit.palette.length, 2);
    assert.ok(saved.updatedAt, 'the save is timestamped');

    const read = await server.readBrandKit(id);
    assert.deepStrictEqual(read.kit.palette.map((entry) => entry.hex), ['#111111', '#f0a35e']);

    const listed = await server.listBrandKits();
    assert.ok(listed.some((kit) => kit.id === id), 'the new kit is listed');

    const updated = await server.saveBrandKit(id, kitPayload({ name: 'Acme v2' }));
    assert.strictEqual(updated.kit.name, 'Acme v2');
    const after = await server.readBrandKit(id);
    assert.strictEqual(after.kit.name, 'Acme v2');
});

test('Studio animation library persists reusable tracks and validates presets', async () => {
    const id = `test-animation-${Date.now().toString(36)}`;
    const payload = {
        id,
        name: 'Reusable motion',
        tracks: [{
            layerId: 'layer-one',
            layerName: 'Headline',
            event: {
                id: 'event-one',
                preset: 'fadeIn',
                start: 250,
                duration: 900,
                keyframes: [{ time: 250, x: 10, y: 20, w: 30, h: 40, opacity: 0.5 }],
            },
        }],
    };
    try {
        const saved = await server.saveStudioAnimation(payload);
        assert.strictEqual(saved.animation.id, id);
        assert.strictEqual(saved.animation.tracks[0].event.preset, 'fadeIn');
        const library = await server.readStudioAnimationLibrary();
        assert.ok(library.animations.some((animation) => animation.id === id));
        assert.strictEqual(library.animations.find((animation) => animation.id === id).tracks[0].event.keyframes[0].opacity, 0.5);
        await assert.rejects(() => server.saveStudioAnimation({
            id: `${id}-invalid`,
            name: 'Invalid motion',
            tracks: [{ layerId: 'layer-one', layerName: 'Headline', event: { preset: 'not-a-preset' } }],
        }), /unsupported animation preset/i);
        await server.deleteStudioAnimation(id);
        await assert.rejects(() => server.deleteStudioAnimation(id), /not found/i);
    } finally {
        const library = await server.readStudioAnimationLibrary();
        if (library.animations.some((animation) => animation.id === id)) await server.deleteStudioAnimation(id);
    }
});

test('deleting a brand kit removes it and 404s afterwards', async () => {
    const id = `test-kit-del-${Date.now().toString(36)}`;
    await server.saveBrandKit(id, kitPayload());
    await server.deleteBrandKit(id);
    await assert.rejects(() => server.readBrandKit(id), /not found/i);
    await assert.rejects(() => server.deleteBrandKit(id), /not found/i);
});

test('brand kit ids and payloads are validated', async () => {
    await assert.rejects(() => server.saveBrandKit('../escape', kitPayload()), /1-80 letters/);
    await assert.rejects(() => server.saveBrandKit('', kitPayload()), /1-80 letters/);
    await assert.rejects(() => server.saveBrandKit('test-kit-bad', {}), /must include a brand kit/);
    await assert.rejects(() => server.readBrandKit('no-such-kit'), /not found/i);
});

test('a shared kit validates a composition that has no embedded kit', () => {
    const kit = {
        id: 'shared', name: 'Shared',
        palette: [{ name: 'Ink', hex: '#111111' }],
        fonts: [{ name: 'Body', family: 'Inter', weight: 400, style: 'normal' }],
        logos: [],
    };
    const composition = { ...baseComposition(), brandKit: null, variables: [], formats: [], layers: [] };
    const core = require('../src/shared/studio-core.js');
    const report = core.validateAgainstBrandKit(composition, { kit });
    assert.ok(!report.groups.some((group) => group.id === 'kit'));
    assert.strictEqual(report.groups.find((group) => group.id === 'fonts').ok, true);
});

test('agent canvas animations are saved per template and can be removed', async () => {
    const templateId = `canvas-test-${Date.now().toString(36)}`;
    const saved = await server.saveAgentCanvasAnimation({
        name: 'Canvas test motion',
        templateId,
        templateName: 'Canvas test design',
        provider: 'test',
        prompt: 'test animation',
        animation: {
            schema: 'agent-studio/animation/2',
            kind: 'studio-animation',
            name: 'Canvas test motion',
            duration: 1200,
            fps: 25,
            tracks: [{
                layerId: 'headline',
                layerName: 'Headline',
                role: 'text',
                box: { x: 0.1, y: 0.1, w: 0.6, h: 0.2 },
                segments: [{
                    preset: 'fadeIn',
                    start: 0,
                    duration: 1200,
                    frames: [{ t: 0, a: 0 }, { t: 1200, a: 1 }],
                }],
            }],
        },
    });
    try {
        assert.strictEqual(saved.animation.templateId, templateId);
        assert.strictEqual(saved.animation.animation.schema, 'agent-studio/animation/2');
        const listed = (await server.readAgentCanvasAnimations()).filter((item) => item.templateId === templateId);
        assert.strictEqual(listed.length, 1);
        assert.strictEqual(listed[0].name, 'Canvas test motion');
    } finally {
        await server.deleteAgentCanvasAnimation(saved.animation.id).catch(() => {});
    }
});

test('agent canvas LLM requires a prompt', async () => {
    await assert.rejects(
        () => server.runAgentCanvasLlm({ prompt: '' }),
        (error) => /Ask the agent/.test(error.message),
    );
});

test('agent canvas parses a DeepSeek composition and animation response', async () => {
    const keys = ['STUDIO_DEEPSEEK_API_KEY', 'STUDIO_DEEPSEEK_MODEL', 'STUDIO_DEEPSEEK_BASE_URL'];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    const originalFetch = global.fetch;
    process.env.STUDIO_DEEPSEEK_API_KEY = 'test-key';
    process.env.STUDIO_DEEPSEEK_MODEL = 'deepseek-chat';
    delete process.env.STUDIO_DEEPSEEK_BASE_URL;
    const response = {
        reply: 'Made the headline smaller and added a fade.',
        observations: ['The headline was too close to the top edge.'],
        composition: {
            version: 3,
            name: 'Test canvas',
            width: 1080,
            height: 1920,
            duration: 2000,
            layers: [{ id: 'headline', type: 'text', x: 10, y: 10, w: 80, h: 20, text: 'Hello' }],
        },
        animation: {
            schema: 'agent-studio/animation/2',
            name: 'Canvas fade',
            duration: 2000,
            fps: 25,
            tracks: [{
                layerId: 'headline',
                layerName: 'Headline',
                segments: [{ start: 0, duration: 2000, frames: [{ t: 0, a: 0 }, { t: 2000, a: 1 }] }],
            }],
        },
    };
    let sentBody = null;
    global.fetch = async (_url, options) => {
        sentBody = JSON.parse(options.body);
        return {
            ok: true,
            text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }),
        };
    };
    try {
        const result = await server.runAgentCanvasLlm({
            prompt: 'Review and animate this',
            provider: 'deepseek',
            composition: { width: 1080, height: 1920, duration: 2000, layers: [{ id: 'headline', type: 'text', text: 'Hello' }] },
            library: { groups: [{ id: 'headline', label: 'Headline' }] },
        });
        assert.strictEqual(result.provider, 'deepseek');
        assert.strictEqual(result.reply, response.reply);
        assert.deepStrictEqual(result.observations, response.observations);
        assert.strictEqual(result.composition.layers[0].id, 'headline');
        assert.strictEqual(result.animation.tracks.length, 1);
        assert.strictEqual(result.animation.schema, 'agent-studio/animation/2');
        assert.match(sentBody.messages[1].content, /"library"/);
        assert.match(sentBody.messages[1].content, /Headline/);
    } finally {
        global.fetch = originalFetch;
        keys.forEach((key) => {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        });
    }
});
