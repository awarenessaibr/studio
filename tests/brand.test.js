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

test('normalizeBrandPack keeps the authored copy deck bounded', () => {
    const pack = Brand.normalizeBrandPack({
        name: 'Copy pack',
        brands: [{
            id: 'copy-brand',
            name: 'Copy Brand',
            content: {
                menu: {
                    title: 'À la carte',
                    sections: [{ name: 'Starters', items: [{ name: 'Cullen skink', price: '£10.95' }] }],
                },
                copy: {
                    headline: 'A table by the water.',
                    body: 'Country dining with a view.',
                    subhead: 'The Test Arms',
                    special: { dish: 'Roast chicken Balmoral', price: '£20.95', note: 'Ask the team.' },
                    voucher: { value: '£50', terms: 'Redeemable at any Test Group venue.' },
                    festive: { title: 'Christmas at the Test Arms', price: '3 courses £39.50' },
                    card: { role: 'Your role' },
                    unknown: 'dropped',
                },
            },
        }],
    });
    const copy = pack.brands[0].content.copy;
    assert.equal(copy.headline, 'A table by the water.');
    assert.equal(copy.subhead, 'The Test Arms');
    assert.equal(copy.special.dish, 'Roast chicken Balmoral');
    assert.equal(copy.voucher.terms, 'Redeemable at any Test Group venue.');
    assert.equal(copy.festive.price, '3 courses £39.50');
    assert.equal(copy.card.role, 'Your role');
    assert.equal(copy.unknown, undefined);
});

const copyBrand = () => Brand.normalizeBrand({
    id: 'copy-venue',
    name: 'Copy Venue',
    tagline: 'Lochside luxury.',
    palette: [{ name: 'Ink', hex: '#111111' }, { name: 'Paper', hex: '#ffffff' }],
    guidelines: {
        contact: [{ field: 'Address', value: '1 Test Road' }, { field: 'Website', value: 'test.example' }],
        facts: [{ field: 'Group', value: 'Test Group' }],
    },
    content: {
        menu: {
            title: 'À la carte',
            sections: [{
                name: 'Starters',
                items: [
                    { name: 'Cullen skink', price: '£10.95', description: 'Smoked haddock' },
                    { name: 'Haggis fritters', price: '£10.95', description: 'Peppercorn sauce' },
                    { name: 'Roast chicken', price: '£20.95', description: 'Parma ham' },
                ],
            }],
        },
        copy: {
            headline: 'Lochside luxury.',
            subhead: 'Copy Venue',
            body: 'Real food, real prices.',
            cta: 'Book a table',
            tag: 'Lochside luxury.',
            special: { dish: 'Roast chicken Balmoral', price: '£20.95', description: 'Parma ham.', note: 'Ask the team.' },
            voucher: { value: '£50', terms: 'Redeemable at any Test Group venue. Valid for 12 months.' },
            festive: { title: 'Christmas at Copy Venue', date: 'Festive menu · from 12 noon', price: '3 courses £39.50', body: 'Roast turkey beside the water.', message: 'Merry Christmas.' },
            card: { role: 'Your role' },
        },
    },
}, 0);

test('ice-cream templates are offered only to ice-cream brands', () => {
    const ice = Brand.normalizeBrand({
        id: 'ice-brand',
        name: 'Ice Brand',
        fontReady: true,
        palette: [{ name: 'Blue', hex: '#0070d3' }, { name: 'Paper', hex: '#ffffff' }],
        typography: { families: ['Poppins', 'Roboto'], scale: [{ id: 'title', family: 'Poppins', size: '64px', px: 64 }, { id: 'body-m', family: 'Roboto', size: '16px', px: 16 }] },
        content: {
            copy: {
                kind: 'ice-cream',
                headline: 'Sabor de felicidade.',
                special: { dish: 'Picolé brigadeiro', price: '75 g' },
                campaign: { rangeTitle: 'Mais de 80 sabores.', premiumTitle: 'Brigadeiro trufado.' },
            },
        },
    }, 0);
    const iceIds = Brand.templateCatalog(ice).map((template) => template.id);
    assert.ok(iceIds.includes('flavour-card'));
    assert.ok(iceIds.includes('premium-social'));
    assert.ok(iceIds.includes('premium-story'));
    const plain = Brand.normalizeBrand({
        id: 'plain-brand',
        name: 'Plain Brand',
        palette: [{ name: 'Ink', hex: '#111111' }, { name: 'Paper', hex: '#ffffff' }],
    }, 0);
    const plainIds = Brand.templateCatalog(plain).map((template) => template.id);
    assert.ok(!plainIds.includes('flavour-card'));
    const composition = Brand.createTemplateComposition({ brand: ice, templateId: 'premium-social' });
    const variables = {};
    composition.variables.forEach((variable) => { variables[variable.id] = variable.defaultValue; });
    assert.equal(variables.premium_title, 'Brigadeiro trufado.');
    assert.equal(variables.premium_badge, '29 anos de sabor');
    assert.equal(variables.premium_kicker, 'Melano Premium');
    // A brand that declares its fonts are on the shelf keeps them.
    const text = composition.layers.find((layer) => layer.type === 'text' && layer.id === 'premium-title');
    assert.equal(text.font.family, 'Poppins');
});

test('voucher terms fall back to the brand group, never another group', () => {
    const brand = Brand.normalizeBrand({
        id: 'group-venue',
        name: 'Group Venue',
        palette: [{ name: 'Ink', hex: '#111111' }, { name: 'Paper', hex: '#ffffff' }],
        guidelines: { facts: [{ field: 'Group', value: 'Test Group' }] },
    }, 0);
    const composition = Brand.createTemplateComposition({ brand, templateId: 'voucher' });
    const terms = composition.variables.find((variable) => variable.id === 'voucher_terms').defaultValue;
    assert.match(terms, /any Test Group venue/);
    assert.ok(!/Dalton/.test(terms));
});

test('templates take their copy from the deck, not the sample catalogue', () => {
    const brand = copyBrand();
    const variables = (templateId) => {
        const composition = Brand.createTemplateComposition({ brand, templateId });
        const map = {};
        composition.variables.forEach((variable) => { map[variable.id] = variable.defaultValue; });
        return map;
    };
    const menu = variables('menu');
    assert.equal(menu.item_1_name, 'Cullen skink');
    assert.equal(menu.item_1_price, '£10.95');
    assert.ok(!JSON.stringify(menu).includes('Hand-dived'));
    const flyer = variables('flyer');
    assert.equal(flyer.flyer_headline, 'Lochside luxury.');
    assert.equal(flyer.flyer_subhead, 'Copy Venue');
    assert.equal(flyer.flyer_body, 'Real food, real prices.');
    const voucher = variables('voucher');
    assert.match(voucher.voucher_terms, /any Test Group venue/);
    assert.ok(!/Dalton/.test(voucher.voucher_terms));
    const table = variables('table-card');
    assert.equal(table.table_dish, 'Roast chicken Balmoral');
    assert.equal(table.table_price, '£20.95');
    assert.equal(variables('business-card-back').card_role, 'Your role');
});

test('applyTemplateCopy replaces another client\'s festive event', () => {
    const brand = copyBrand();
    const source = {
        title: 'Christmas Brunch',
        date: 'Sunday 13th December',
        price: '2 courses + cocktail £49',
        body: 'With Decadance DJs, singalongs, confetti & glowsticks',
    };
    Brand.applyTemplateCopy(brand, 'flyer', 'Christmas · photo', source);
    assert.equal(source.title, 'Christmas at Copy Venue');
    assert.equal(source.date, 'Festive menu · from 12 noon');
    assert.equal(source.price, '3 courses £39.50');
    assert.ok(!/Decadance/.test(source.body));
    assert.match(source.body, /Roast turkey/);
});

test('normalizeBrandPack carries the social intelligence summary', () => {
    const pack = Brand.normalizeBrandPack({
        name: 'Social pack',
        brands: [{
            id: 'duck-bay',
            name: 'Duck Bay Hotel & Cottages',
            social: {
                status: 'crawled',
                slug: 'duckbay',
                business: 'Duck Bay Hotel & Restaurant',
                run: 'cawley-hotel-group-20261102152632-bb41',
                crawledAt: '2026-11-02T15:31:06Z',
                files: {
                    profile: 'social/business.profile.json',
                    tokens: 'social/social.tokens.json',
                    report: '../outside.html',
                    secret: 'social/secret.json',
                },
                reputation: {
                    consensusRating: 4.3,
                    totalReviews: 3933,
                    collectedReviews: 52,
                    perSource: { google: { rating: 4.3, count: 3933 } },
                    sentiment: { mean: 0.56, positive: 39, neutral: 6, negative: 7, positiveShare: 0.75, negativeShare: 0.14 },
                    ownerResponseRate: 0,
                    topThemes: ['food quality', 'service'],
                    redFlags: [{ level: 'high', issue: 'rating drift downwards', detail: 'recent 3.75 vs older 4.12' }],
                    foodHygiene: { authority: 'Argyll and Bute', scheme: 'FHIS', rating: 'Pass', passed: true, inspectedAt: '2020-01-05' },
                    strengths: ['High review volume'],
                },
                socialPresence: {
                    totals: { followers: 7771, platformsPresent: 2, platformsConfigured: 2 },
                    gaps: ['tiktok', 'youtube'],
                    platforms: [{
                        platform: 'instagram',
                        label: 'Instagram',
                        url: 'https://www.instagram.com/duckbaymarina/',
                        handle: 'duckbaymarina',
                        present: true,
                        followers: 7771,
                        lastPost: null,
                    }],
                },
                webPresence: { hasOnlineBooking: false, hasMenuOnline: true, tech: ['wordpress'], pressMentions: 0 },
                voice: { keywords: ['food quality'], samples: ['A lovely stay by the loch.'], hashtags: [] },
                scores: { overall: 60.7, reputation: 70.8, socialStrength: 50.6, contentHealth: 44, discoverability: 73 },
                reading: { tone: 'risk', title: 'The reputation needs attention', summary: 'Read the source reviews before acting.' },
                actions: [{
                    code: 'NO_OWNER_RESPONSES',
                    severity: 'high',
                    title: 'Start replying to reviews',
                    detail: 'No owner responses were visible.',
                    injected: 'x',
                }],
                injected: 'ignored',
            },
        }],
    });
    const social = pack.brands[0].social;
    assert.ok(social);
    assert.equal(social.status, 'crawled');
    assert.equal(social.reputation.consensusRating, 4.3);
    assert.equal(social.reputation.totalReviews, 3933);
    assert.equal(social.reputation.perSource.google.count, 3933);
    assert.equal(social.reputation.foodHygiene.passed, true);
    assert.equal(social.reputation.redFlags[0].issue, 'rating drift downwards');
    assert.equal(social.socialPresence.platforms[0].handle, 'duckbaymarina');
    assert.equal(social.socialPresence.totals.followers, 7771);
    assert.equal(social.webPresence.hasOnlineBooking, false);
    assert.deepEqual(social.voice.keywords, ['food quality']);
    assert.equal(social.scores.socialStrength, 50.6);
    assert.equal(social.reading.tone, 'risk');
    assert.equal(social.actions[0].code, 'NO_OWNER_RESPONSES');
    assert.equal(social.actions[0].injected, undefined);
    assert.equal(social.files.profile, 'social/business.profile.json');
    assert.equal(social.files.report, '');
    assert.equal(social.files.secret, undefined);
    assert.equal(social.injected, undefined);
});

test('normalizeBrandPack marks a brand the social crawler has not reached', () => {
    const pack = Brand.normalizeBrandPack({
        name: 'Gap pack',
        brands: [
            { id: 'boat-yard', name: 'The Boat Yard', social: { status: 'not-crawled', note: 'No target in this run.', files: {} } },
            { id: 'no-social', name: 'No Social' },
            { id: 'empty-social', name: 'Empty Social', social: {} },
        ],
    });
    const boatYard = pack.brands.find((brand) => brand.id === 'boat-yard');
    assert.equal(boatYard.social.status, 'not-crawled');
    assert.match(boatYard.social.note, /No target/);
    assert.equal(pack.brands.find((brand) => brand.id === 'no-social').social, null);
    assert.equal(pack.brands.find((brand) => brand.id === 'empty-social').social, null);
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

        // The token file is the brand's canonical record. It is parsed into
        // pack.json, but it must also exist on disk or tokensPath dangles.
        assert.strictEqual(brand.tokensPath, 'tokens/test.tokens.json');
        const tokenFile = path.join(PACKS, packId, 'files', brand.id, ...brand.tokensPath.split('/'));
        const tokenJson = JSON.parse(await fsp.readFile(tokenFile, 'utf8'));
        assert.strictEqual(Object.keys(tokenJson.color).length, 3);
        assert.strictEqual(tokenJson.typography.families.length, 2);

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

test('brand-pack and asset-intel share one provenance vocabulary', () => {
    // The two modules load independently in the browser, so the shapes are kept
    // equal by assertion rather than by import.
    assert.deepEqual(Brand.PROVENANCE_KINDS, require('../src/shared/asset-intel.js').PROVENANCE_KINDS);
    assert.deepEqual(Brand.PROVENANCE_CONFIDENCE, require('../src/shared/asset-intel.js').PROVENANCE_CONFIDENCE);
    const pack = Brand.normalizeBrandPack({
        name: 'Provenance pack',
        provenance: { kind: 'public', confidence: 'medium', note: 'from the live site' },
        brands: [{ id: 'a', name: 'A', provenance: { kind: 'extracted', confidence: 'high' } }],
    });
    assert.equal(pack.provenance.kind, 'public');
    assert.equal(pack.brands[0].provenance.kind, 'extracted');
    assert.equal(pack.brands[0].provenance.confidence, 'high');
    // Unrecorded provenance stays unknown rather than defaulting to "supplied".
    const blank = Brand.normalizeBrandPack({ name: 'Blank', brands: [{ id: 'b', name: 'B' }] });
    assert.equal(blank.provenance.kind, 'unknown');
    assert.equal(blank.brands[0].provenance.kind, 'unknown');
});
