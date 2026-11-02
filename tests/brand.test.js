'use strict';
/**
 * Brand-pack tests: schema normalisation, brand kits, template compositions,
 * the DOCX guide reader and a full synthetic ZIP import.
 *
 * Run with: node --test "tests/*.test.js"
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const Core = require('../src/shared/studio-core.js');
const Brand = require('../src/shared/brand-pack.js');
const { parseBrandDocx } = require('../src/server/brand-docx.js');
const server = require('../server.js');

const ROOT = path.join(__dirname, '..');
const PACKS = path.join(ROOT, 'data', 'brand-packs');
const IMPORTS = path.join(ROOT, 'data', 'imports');
const KITS = path.join(ROOT, 'data', 'brand-kits');
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wFZQ/3kAAAAAElFTkSuQmCC',
    'base64',
);

const tokens = () => ({
    brand: {
        name: 'Test Brand',
        wordmark: 'test brand',
        tagline: 'Carefully made.',
        url: 'https://test.example',
        version: '1.0',
        captured: 'October 2026',
    },
    color: {
        'test-black': {
            value: '#111111',
            share: 55,
            tier: 'primary',
            role: 'Primary ground, menu covers, print backgrounds',
        },
        'test-brass': {
            value: '#C9A227',
            share: 20,
            tier: 'primary',
            role: 'Accent, headings, rules',
        },
        'test-chalk': {
            value: '#FFFFFF',
            share: 25,
            tier: 'primary',
            role: 'Type on black, page ground in print',
        },
    },
    typography: {
        families: ['Test Sans Light', 'Test Serif Regular'],
        scale: {
            title: { family: 'Test Sans Light', size: '40 px / 1.2', px: 40, note: 'Display' },
            'body-m': { family: 'Test Serif Regular', size: '16 px / 1.3', px: 16, note: 'Body' },
        },
    },
    voice: {
        attributes: ['Understated', 'Editorial'],
        prefer: ['seasonal', 'carefully made'],
        avoid: ['cheap eats', 'deal'],
    },
});

const brandInput = () => ({
    id: 'test-brand',
    name: 'Test Brand',
    tagline: 'Carefully made.',
    url: 'https://test.example',
    palette: tokens().color,
    typography: tokens().typography,
    voice: tokens().voice,
    logos: [
        { name: 'test-wordmark-white.svg', url: '/x/test-wordmark-white.svg' },
        { name: 'test-monogram-black.svg', url: '/x/test-monogram-black.svg' },
        { name: 'logo-plate.png', url: '/x/logo-plate.png' },
    ],
    photography: [{ name: 'test-hero.jpg', url: '/x/test-hero.jpg', width: 1600, height: 900 }],
    guidelines: {
        applications: [
            { application: 'Menus', specification: 'Black ground, brass prices', scope: 'Food and drinks' },
            { application: 'Vouchers', specification: 'Cross-venue', scope: 'Gift' },
        ],
        contact: [
            { field: 'Address', value: '1 Test Street' },
            { field: 'Telephone', value: '01334 000000' },
            { field: 'Website', value: 'www.test.example' },
        ],
    },
});

// ---------------------------------------------------------------------
// A tiny ZIP writer (stored entries only; the reader ignores the CRC)
// ---------------------------------------------------------------------
function zipStored(files) {
    const local = [];
    const central = [];
    let offset = 0;
    files.forEach((file) => {
        const name = Buffer.from(file.name, 'utf8');
        const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(0, 8);
        header.writeUInt32LE(0, 14);
        header.writeUInt32LE(data.length, 18);
        header.writeUInt32LE(data.length, 22);
        header.writeUInt16LE(name.length, 26);
        header.writeUInt16LE(0, 28);
        local.push(header, name, data);

        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50, 0);
        entry.writeUInt16LE(20, 4);
        entry.writeUInt16LE(20, 6);
        entry.writeUInt16LE(0, 10);
        entry.writeUInt32LE(0, 16);
        entry.writeUInt32LE(data.length, 20);
        entry.writeUInt32LE(data.length, 24);
        entry.writeUInt16LE(name.length, 28);
        entry.writeUInt32LE(0, 38);
        entry.writeUInt32LE(offset, 42);
        central.push(entry, name);
        offset += header.length + name.length + data.length;
    });
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, directory, end]);
}

// --- synthetic Word parts -------------------------------------------
function cell(text) {
    return `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}
function row(cells) {
    return `<w:tr>${cells.map(cell).join('')}</w:tr>`;
}
function paragraph(text, style) {
    return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}
function table(head, rows) {
    return `<w:tbl>${row(head)}${rows.map(row).join('')}</w:tbl>`;
}

function docx() {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${paragraph('The brand at a glance', 'Heading1')}
${paragraph('The positioning statement', 'Heading2')}
${paragraph('Test Brand is a small, carefully made reference venue on a single street.')}
${paragraph('Applications', 'Heading1')}
${table(['APPLICATION', 'SPECIFICATION', 'SCOPE'], [
    ['Menus', 'A4, black ground, brass prices', 'Food and drinks'],
    ['Vouchers', 'Cross-venue, redeemable everywhere', 'Gift'],
])}
${paragraph('Print specification', 'Heading2')}
${table(['ITEM', 'SPECIFICATION'], [
    ['Brochure format', '148.5 × 148.5 mm square'],
    ['Imagery', 'CMYK, 300 ppi at final size'],
])}
${paragraph('Contact block — use this wording everywhere', 'Heading2')}
${table(['FIELD', 'VALUE'], [
    ['Address', '1 Test Street, Test Town'],
    ['Telephone', '01334 000000'],
    ['Website', 'www.test.example'],
])}
${paragraph('The brand at a glance facts are below.', 'Heading2')}
${table(['FACT', 'DETAIL'], [
    ['Opened', '2012'],
    ['Covers', '65 seated'],
])}
${paragraph('The logo system', 'Heading1')}
${paragraph('Rules of use', 'Heading2')}
${table(['RULE', 'SPECIFICATION'], [
    ['Clear space', 'The height of the h on all sides'],
    ['Minimum size', 'Script 28 mm wide'],
])}
${paragraph('Typography', 'Heading1')}
${table(['ROLE', 'TYPEFACE', 'SIZE / LEADING', 'NOTES'], [
    ['Title', 'Test Sans Light', '40 px', 'Sentence case'],
])}
</w:body></w:document>`;
    return zipStored([
        { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types/>' },
        { name: 'word/document.xml', data: documentXml },
        {
            name: 'word/styles.xml',
            data: '<?xml version="1.0"?><w:styles xmlns:w="w"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>',
        },
    ]);
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------
test('normalizeBrandPack carries palette, type, voice and assets', () => {
    const pack = Brand.normalizeBrandPack({
        id: 'pack',
        name: 'Test pack',
        brands: [brandInput()],
    });
    assert.ok(pack);
    assert.strictEqual(pack.brands.length, 1);
    const brand = pack.brands[0];
    assert.strictEqual(brand.palette.length, 3);
    assert.deepStrictEqual(brand.palette[0].rgb, [17, 17, 17]);
    assert.strictEqual(brand.palette[0].tier, 'primary');
    assert.strictEqual(brand.typography.families.length, 2);
    assert.strictEqual(brand.typography.scale.length, 2);
    assert.deepStrictEqual(brand.voice.attributes, ['Understated', 'Editorial']);
    assert.strictEqual(brand.logos.length, 3);
    assert.strictEqual(brand.logos[0].variant, 'light');
    assert.strictEqual(brand.logos[0].kind, 'wordmark');
    assert.strictEqual(brand.logos[2].presentation, true);
    assert.strictEqual(brand.guidelines.applications.length, 2);
});

test('normalizeBrandPack keeps structured crawler menu content', () => {
    const pack = Brand.normalizeBrandPack({
        name: 'Content Pack',
        brands: [{
            id: 'content-brand',
            name: 'Content Brand',
            content: {
                menu: {
                    title: 'Menu',
                    sections: [{
                        name: 'Small plates',
                        items: [{ name: 'Bread', price: '£4', description: 'butter' }],
                    }],
                },
                hours: { mon: '12–10pm' },
                bookingUrl: 'https://content.example/book',
            },
        }],
    });
    const brand = pack.brands[0];
    assert.equal(brand.content.menu.sections[0].name, 'Small plates');
    assert.equal(brand.content.menu.sections[0].items[0].price, '£4');
    assert.equal(brand.content.hours.mon, '12–10pm');
    assert.equal(brand.content.bookingUrl, 'https://content.example/book');
});

test('normalizeBrandPack preserves percent-encoded asset URLs', () => {
    const pack = Brand.normalizeBrandPack({
        name: 'Encoded pack',
        brands: [{
            name: 'Encoded brand',
            palette: { ink: { value: '#111111', share: 100, tier: 'primary' } },
            logos: [{ name: 'John Smith.svg', url: '/api/x/John%20Smith.svg' }],
            photography: [{ name: 'Room & bar.jpg', url: '/api/x/Room%20%26%20bar.jpg' }],
        }],
    });
    assert.strictEqual(pack.brands[0].logos[0].url, '/api/x/John%20Smith.svg');
    assert.strictEqual(pack.brands[0].photography[0].url, '/api/x/Room%20%26%20bar.jpg');
});

test('brandKitFor maps the palette, fonts and logo cuts', () => {
    const brand = Brand.normalizeBrand(brandInput(), 0);
    const kit = Brand.brandKitFor(brand, 'test-kit');
    assert.strictEqual(kit.id, 'test-kit');
    assert.strictEqual(kit.palette.length, 3);
    assert.strictEqual(kit.palette[1].hex, '#c9a227');
    assert.strictEqual(kit.fonts[0].family, 'Test Sans Light');
    assert.strictEqual(kit.fonts[0].weight, 300);
    // The presentation plate is not a logo cut.
    assert.strictEqual(kit.logos.length, 2);
});

test('palette roles follow the guide and keep text readable', () => {
    const brand = Brand.normalizeBrand(brandInput(), 0);
    const menu = Brand.paletteRoles(brand, 'menu');
    assert.strictEqual(menu.ground.hex, '#111111');
    assert.strictEqual(menu.accent.hex, '#c9a227');
    assert.strictEqual(menu.ink.hex, '#ffffff');
    const back = Brand.paletteRoles(brand, 'business-card-back');
    assert.strictEqual(back.ground.hex, '#ffffff');
    assert.strictEqual(back.ink.hex, '#111111');
});

test('the template catalog exposes the initial set with print specs', () => {
    const brand = Brand.normalizeBrand(brandInput(), 0);
    const catalog = Brand.templateCatalog(brand);
    assert.deepStrictEqual(catalog.map((entry) => entry.id), [
        'menu',
        'business-card-front',
        'business-card-back',
        'flyer',
        'table-card',
        'voucher',
        'social-post',
        'social-story',
        'social-reel',
        'square-loop',
        'display-screen',
        'digital-menu-board',
        'link-preview',
    ]);
    const menu = catalog.find((entry) => entry.id === 'menu');
    assert.match(menu.spec, /A4/);
    assert.match(menu.spec, /300 dpi/);
    assert.strictEqual(menu.guideline.specification, 'Black ground, brass prices');
    assert.deepStrictEqual(menu.formats, ['A5 menu', 'A3 menu']);
    // Digital templates carry a loop duration and motion, which is what makes
    // the same card exportable as a GIF or an MP4.
    const story = catalog.find((entry) => entry.id === 'social-story');
    assert.strictEqual(story.channel, 'social');
    assert.strictEqual(story.duration, 6000);
    assert.strictEqual(story.motion, true);
    assert.match(story.spec, /1080 × 1920/);
    const board = catalog.find((entry) => entry.id === 'digital-menu-board');
    assert.strictEqual(board.channel, 'display');
    assert.match(board.spec, /1920 × 1080/);
});

test('createTemplateComposition builds a valid v3 composition', () => {
    const brand = Brand.normalizeBrand(brandInput(), 0);
    brand.brandKitId = 'test-kit';
    const composition = Brand.createTemplateComposition({
        packId: 'pack',
        packName: 'Test pack',
        brand,
        templateId: 'menu',
        projectId: 'project-1',
    });
    assert.strictEqual(composition.version, 3);
    assert.strictEqual(composition.id, 'project-1');
    assert.strictEqual(composition.width, 2480);
    assert.strictEqual(composition.height, 3508);
    assert.strictEqual(composition.formats.length, 3);
    assert.strictEqual(composition.formats[0].isMaster, true);
    assert.strictEqual(composition.brandKitId, 'test-kit');
    assert.ok(composition.brandKit.palette.length >= 3);

    const ids = composition.layers.map((layer) => layer.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    const variables = new Set(composition.variables.map((variable) => variable.id));
    composition.layers.forEach((layer) => {
        assert.ok(layer.x >= -100 && layer.x <= 200);
        assert.ok(layer.y >= -100 && layer.y <= 200);
        assert.ok(layer.w >= 1 && layer.w <= 300);
        assert.ok(layer.h >= 1 && layer.h <= 300);
        if (layer.bindings?.text) assert.ok(variables.has(layer.bindings.text), layer.id);
    });
    composition.formats.forEach((format) => {
        assert.deepStrictEqual(Core.safeZoneViolations(composition, { format }), []);
    });
    // Licensed guides name families that do not travel with the pack. Templates
    // use explicit system stand-ins so they export, and record the intent.
    const textFamilies = new Set(composition.layers.filter((layer) => layer.type === 'text').map((layer) => layer.font.family));
    textFamilies.forEach((family) => assert.ok(Brand.isSystemFamily(family), family));
    assert.strictEqual(composition.meta.fontSubstitutions['Test Sans Light'], 'Helvetica Neue');
    assert.strictEqual(composition.meta.fontSubstitutions['Test Serif Regular'], 'Georgia');
    assert.ok(composition.brandKit.fonts.some((font) => font.family === 'Helvetica Neue'));
    const report = Core.validateAgainstBrandKit(composition, { kit: composition.brandKit, format: composition.formats[0] });
    assert.strictEqual(report.ok, true, JSON.stringify(report.groups.filter((group) => !group.ok)));
});

test('every template builds and respects its safe area', () => {
    const brand = Brand.normalizeBrand(brandInput(), 0);
    Brand.templateCatalog(brand).forEach((template) => {
        const composition = Brand.createTemplateComposition({ brand, templateId: template.id, projectId: 'p' });
        assert.ok(composition.layers.length > 2, template.id);
        assert.ok(composition.variables.length > 0, template.id);
        composition.formats.forEach((format) => {
            assert.deepStrictEqual(Core.safeZoneViolations(composition, { format }), [], `${template.id}/${format.id}`);
        });
    });
});

test('digital templates carry loop-safe keyframes and a real duration', () => {
    const brand = Brand.normalizeBrand(brandInput(), 0);
    const digital = Brand.templateCatalog(brand).filter((template) => template.motion);
    assert.deepStrictEqual(digital.map((template) => template.id), [
        'social-story',
        'social-reel',
        'square-loop',
        'display-screen',
        'digital-menu-board',
        'link-preview',
    ]);
    digital.forEach((template) => {
        const composition = Brand.createTemplateComposition({ brand, templateId: template.id });
        assert.strictEqual(composition.duration, template.duration, template.id);
        assert.ok(composition.duration > 0, template.id);
        const moving = composition.layers.filter((layer) => (layer.keyframes || []).length > 1);
        assert.ok(moving.length > 0, `${template.id} has no motion`);
        moving.forEach((layer) => {
            const frames = layer.keyframes;
            assert.ok(frames.length >= 2, layer.id);
            assert.ok(frames.every((frame) => frame.time >= 0 && frame.time <= composition.duration), layer.id);
            // The first and last frame must match so a short GIF loops cleanly.
            const first = frames[0];
            const last = frames[frames.length - 1];
            ['x', 'y', 'w', 'h', 'opacity'].forEach((property) => {
                assert.ok(Math.abs(first[property] - last[property]) < 0.01, `${template.id}/${layer.id}/${property}`);
            });
        });
    });
});

test('parseBrandDocx reads the application, print, contact and type tables', () => {
    const doc = parseBrandDocx(docx(), {
        readZipEntries: server.readZipEntries,
        extractZipEntry: server.extractZipEntry,
    }, { name: 'Test guide' });
    assert.strictEqual(doc.applications.length, 2);
    assert.strictEqual(doc.applications[0].application, 'Menus');
    assert.strictEqual(doc.applications[0].specification, 'A4, black ground, brass prices');
    assert.strictEqual(doc.printSpec.length, 2);
    assert.strictEqual(doc.printSpec[0].field, 'Brochure format');
    assert.strictEqual(doc.contact.length, 3);
    assert.strictEqual(doc.contact[0].value, '1 Test Street, Test Town');
    assert.strictEqual(doc.facts.length, 2);
    assert.strictEqual(doc.typeHierarchy.length, 1);
    assert.strictEqual(doc.typeHierarchy[0].role, 'Title');
    assert.strictEqual(doc.logoRules.length, 2);
    assert.match(doc.positioning, /carefully made reference venue/);
    assert.ok(doc.sections.length >= 5);
});

test('a brand-kit ZIP becomes a pack, kits, assets and a template project', async () => {
    const zip = zipStored([
        { name: 'README.md', data: '# Test group — brand documentation\n\nA small group of test venues used by the suite.\n' },
        { name: '00-portfolio/overview.docx', data: docx() },
        { name: '01-test-brand/tokens/test.tokens.json', data: JSON.stringify(tokens()) },
        { name: '01-test-brand/Test-Brand-Guide.docx', data: docx() },
        {
            name: '01-test-brand/assets/logos/test-wordmark-white.svg',
            data: '<svg viewBox="0 0 20 4"><path fill="#FFFFFF" d="M0 0h20v4H0z" fill="#000000"/></svg>',
        },
        { name: '01-test-brand/assets/photography/test-hero.png', data: PNG },
        { name: '01-test-brand/assets/colors/palette.png', data: PNG },
        { name: '01-test-brand/assets/cover.png', data: PNG },
    ]);
    let packId = null;
    let projectId = null;
    let copyId = null;
    try {
        const result = await server.createBrandPackImport({ zip: zip.toString('base64'), zipName: 'test-kit.zip' });
        packId = result.pack.id;
        assert.match(result.pack.name, /Test group/);
        assert.strictEqual(result.pack.brands.length, 1);
        const brand = result.pack.brands[0];
        assert.strictEqual(brand.name, 'Test Brand');
        assert.strictEqual(brand.palette.length, 3);
        assert.strictEqual(brand.typography.families.length, 2);
        assert.strictEqual(brand.logos.length, 1);
        assert.strictEqual(brand.photography.length, 1);
        assert.ok(brand.brandKitId, 'a shared kit is created');
        assert.ok(brand.guidelines.applications.length >= 1);
        assert.ok(result.pack.meta.warnings.some((warning) => /Repaired test-wordmark-white\.svg/.test(warning)));

        const kit = await server.readBrandKit(brand.brandKitId);
        assert.strictEqual(kit.kit.palette.length, 3);

        // The malformed SVG was repaired on disk.
        const svgFile = path.join(PACKS, packId, 'files', brand.id, 'assets', 'logos', 'test-wordmark-white.svg');
        const svg = await fsp.readFile(svgFile, 'utf8');
        assert.strictEqual(svg.match(/fill=/g).length, 1);

        const roundTrip = await server.readBrandPack(packId);
        assert.strictEqual(roundTrip.pack.brands[0].name, 'Test Brand');
        assert.ok((await server.listBrandPacks()).some((entry) => entry.id === packId));

        const project = await server.createBrandTemplateProject(packId, {
            brandId: brand.id,
            templateId: 'flyer',
        });
        projectId = project.project.id;
        assert.strictEqual(project.composition.meta.source, 'brand-template');
        assert.strictEqual(project.composition.meta.templateId, 'flyer');
        assert.strictEqual(project.composition.brandKitId, null);
        assert.strictEqual(project.composition.meta.sharedKitId, brand.brandKitId);
        const saved = await server.readSavedComposition(projectId);
        assert.strictEqual(saved.layers.length, project.composition.layers.length);
        // Referenced pack assets are copied into the project, so deleting the
        // pack cannot break the creative.
        const imageUrls = saved.layers.filter((layer) => layer.type === 'image' && !layer.url.startsWith('data:')).map((layer) => layer.url);
        assert.ok(imageUrls.length > 0);
        imageUrls.forEach((url) => assert.match(url, new RegExp(`^/data/imports/${projectId}/assets/`)));
        saved.brandKit.logos.forEach((logo) => assert.match(logo.url, new RegExp(`^/data/imports/${projectId}/assets/`)));
        const report = Core.validateAgainstBrandKit(saved, { kit: saved.brandKit, format: saved.formats[0] });
        assert.strictEqual(report.ok, true, JSON.stringify(report.groups.filter((group) => !group.ok)));

        // Publish a snapshot from a fresh (not yet localized) composition, so
        // the store has to copy the pack's own asset URLs.
        const snapshot = Brand.createTemplateComposition({
            packId,
            packName: result.pack.name,
            brand,
            templateId: 'social-story',
            projectId: 'preview',
            name: 'Test story loop',
        });
        const published = await server.saveBrandTemplate(packId, {
            brandId: brand.id,
            name: 'Test story loop',
            composition: snapshot,
        });
        const templateId = published.template.id;
        assert.strictEqual(published.template.source, 'saved');
        assert.strictEqual(published.template.duration, 6000);
        assert.ok(published.template.layerCount > 3);
        const storedUrls = published.composition.layers
            .filter((layer) => layer.type === 'image' && !layer.url.startsWith('data:'))
            .map((layer) => layer.url);
        assert.ok(storedUrls.length > 0);
        storedUrls.forEach((url) => assert.match(url, /\/templates\/test-brand\/.+\/files\//));
        const listed = await server.listBrandTemplates(packId, { brandId: brand.id });
        assert.strictEqual(listed.templates.length, 1);
        assert.strictEqual(listed.templates[0].id, templateId);
        assert.ok(listed.projects.some((entry) => entry.projectId === projectId));
        assert.ok(listed.projects.some((entry) => entry.projectId === projectId && entry.savedTemplateId === null));

        const opened = await server.openSavedBrandTemplate(packId, brand.id, templateId, {});
        copyId = opened.project.id;
        assert.strictEqual(opened.composition.meta.brandTemplateId, templateId);
        assert.strictEqual(opened.composition.duration, 6000);
        // The working copy localizes the snapshot's files into its own folder.
        opened.composition.layers
            .filter((layer) => layer.type === 'image' && !layer.url.startsWith('data:'))
            .forEach((layer) => assert.match(layer.url, new RegExp(`^/data/imports/${copyId}/assets/`)));

        // Publishing a project copies the project's own /data/imports assets
        // into the template folder as well, so the snapshot is self-contained.
        const fromProject = await server.saveBrandTemplate(packId, {
            brandId: brand.id,
            projectId,
            name: 'Project snapshot',
        });
        const projectSnapshot = fromProject.composition.layers
            .filter((layer) => layer.type === 'image' && !layer.url.startsWith('data:'))
            .map((layer) => layer.url);
        assert.ok(projectSnapshot.length > 0);
        projectSnapshot.forEach((url) => assert.match(url, new RegExp(
            `^/api/brand-packs/${packId}/templates/test-brand/${fromProject.template.id}/files/`,
        )));
        await server.deleteSavedBrandTemplate(packId, brand.id, fromProject.template.id);
        await server.deleteSavedBrandTemplate(packId, brand.id, templateId);
        const after = await server.listBrandTemplates(packId, { brandId: brand.id });
        assert.strictEqual(after.templates.length, 0);
    } finally {
        if (projectId) await fsp.rm(path.join(IMPORTS, projectId), { recursive: true, force: true }).catch(() => {});
        if (copyId) await fsp.rm(path.join(IMPORTS, copyId), { recursive: true, force: true }).catch(() => {});
        if (packId) {
            const pack = await server.readBrandPack(packId).catch(() => null);
            await server.deleteBrandPack(packId).catch(() => {});
            for (const brand of pack?.pack?.brands || []) {
                if (brand.brandKitId) await fsp.rm(path.join(KITS, `${brand.brandKitId}.json`), { force: true }).catch(() => {});
            }
        }
    }
});

test('a ZIP without brands is rejected and leaves no pack behind', async () => {
    const before = await fsp.readdir(PACKS).catch(() => []);
    const zip = zipStored([{ name: 'README.md', data: '# Empty\n\nNothing to import here, just a readme file that is long enough.' }]);
    await assert.rejects(
        () => server.createBrandPackImport({ zip: zip.toString('base64') }),
        /No brands were found/,
    );
    const after = await fsp.readdir(PACKS).catch(() => []);
    assert.deepStrictEqual(after, before);
});
