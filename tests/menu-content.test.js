'use strict';
/**
 * Menu content tests: the structured menu/venue model on a brand, the copy
 * format the studio and Asset Studio share, and the content assets a drag
 * payload addresses.
 *
 * Run with: node --test "tests/*.test.js"
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Brand = require('../src/shared/brand-pack.js');

const ROOT = path.join(__dirname, '..');
const SINGL_END_PACK = path.join(
    ROOT, 'data', 'brand-packs', 'singl-end-merchant-city-20261107164459-3-20261109103425-e780', 'pack.json',
);

const sample = () => ({
    locations: [
        { id: 'garnethill', name: 'Garnethill', address: '263 Renfrew Street', postcode: 'G3 6TT' },
        { id: 'merchant-city', name: 'Merchant City', address: '15 John Street', postcode: 'G1 1HP' },
    ],
    menus: [{
        id: 'all-day',
        name: 'All-day menu',
        kind: 'food',
        branches: ['garnethill', 'merchant-city'],
        summary: 'Served all day.',
        availability: 'Open everyday',
        validFrom: '2026-04',
        priceNote: '',
        source: { document: 'documents/menu.pdf', page: 1 },
        sections: [
            {
                name: 'Fruits & grains',
                note: 'Additional toppings £1 each.',
                items: [
                    { name: 'Granola', description: 'Greek yoghurt', price: '£7.50', dietary: ['gfi', 'nonsense'] },
                    { name: 'Porridge', price: '£7.50', dietary: 've' },
                ],
            },
            { name: 'Sides', items: [{ name: 'Beans', price: '£3.25' }] },
        ],
    }, {
        id: 'christmas',
        name: 'Christmas menu',
        kind: 'christmas',
        branches: ['garnethill'],
        validTo: '2026-12-31',
        sections: [{ name: 'Mains', items: [{ name: 'Turkey Crown', dietary: ['DF'] }] }],
    }],
    venue: {
        name: 'Garnethill functions',
        hire: {
            fee: '£250',
            note: 'Exclusive use 7pm–12am',
            deposit: '£100',
            minGuests: '40',
            maxGuests: '100',
        },
        terms: ['Minimum spend £1,800.'],
        faqs: [{ q: 'Is there a hire fee?', a: 'Yes, £250.' }],
        offers: [{ title: 'Private hire', detail: 'Exclusive use', price: '£250', branches: ['garnethill'] }],
        occasions: ['Weddings'],
        rooms: [{
            name: 'The Drawing Room',
            location: 'First floor',
            capacity: 'Two long tables of 20',
            layout: 'Dining or afternoon tea',
            av: 'Sound system',
            toilets: 'On this floor',
            accessibility: 'No disabled access',
            available: 'Any time of day',
            features: ['Antique furnishings', 'Wedding breakfasts'],
            image: 'assets/photography/rooms/the-drawing-room-01.webp',
            gallery: ['assets/photography/rooms/the-drawing-room-02.webp', '../escape.jpg'],
            url: 'https://example.com/drawing-room',
            brochurePage: 6,
            note: 'The largest room.',
        }],
    },
    documents: [{ title: 'Menu', path: 'documents/menu.pdf', kind: 'menu', pages: 2, menuIds: ['all-day'] }],
    hours: { mon: '9–5PM' },
});

const brandFrom = (content) => {
    const pack = Brand.normalizeBrandPack({ name: 'Menus', brands: [{ id: 'menu-brand', name: 'Menu Brand', content }] });
    return pack.brands[0];
};

test('menus normalise branches, dietary marks and a dated source', () => {
    const brand = brandFrom(sample());
    const [menu, christmas] = brand.content.menus;
    assert.equal(brand.content.menus.length, 2);
    assert.equal(menu.id, 'all-day');
    assert.deepEqual(menu.branches, ['garnethill', 'merchant-city']);
    assert.equal(menu.validFrom, '2026-04');
    assert.equal(menu.source.document, 'documents/menu.pdf');
    assert.equal(menu.source.page, 1);
    assert.deepEqual(menu.sections[0].items[0].dietary, ['GFi']);
    assert.deepEqual(menu.sections[0].items[1].dietary, ['Ve']);
    assert.equal(menu.sections[0].note, 'Additional toppings £1 each.');
    assert.equal(christmas.validTo, '2026-12-31');
    assert.equal(christmas.kind, 'christmas');
});

test('the older single menu and drinks blocks fold into the menus list', () => {
    const brand = brandFrom({
        menu: { title: 'Menu', sections: [{ name: 'Plates', items: [{ name: 'Bread', price: '£4' }] }] },
        drinks: { title: 'Drinks', sections: [{ name: 'Beer', items: [{ name: 'Lager', price: '£6' }] }] },
    });
    const ids = brand.content.menus.map((menu) => menu.id);
    assert.deepEqual(ids, ['menu', 'drinks']);
    assert.equal(brand.content.menus[1].kind, 'drinks');
    // The projections the template builders already read stay in place.
    assert.equal(brand.content.menu.sections[0].name, 'Plates');
    assert.equal(brand.content.drinks.title, 'Drinks');
});

test('a saved pack is idempotent: menus are not re-folded from their projections', () => {
    const once = brandFrom(sample());
    const twice = Brand.normalizeContent(JSON.parse(JSON.stringify(once.content)));
    assert.deepEqual(twice.menus.map((menu) => menu.id), once.content.menus.map((menu) => menu.id));
});

test('venue hire, terms, FAQs and offers are bounded and kept', () => {
    const venue = brandFrom(sample()).content.venue;
    assert.equal(venue.hireFee, '£250');
    assert.equal(venue.deposit, '£100');
    assert.equal(venue.minGuests, '40');
    assert.equal(venue.terms.length, 1);
    assert.equal(venue.faqs[0].q, 'Is there a hire fee?');
    assert.equal(venue.offers[0].price, '£250');
    assert.deepEqual(venue.offers[0].branches, ['garnethill']);
    assert.deepEqual(venue.occasions, ['Weddings']);
    assert.equal(venue.rooms.length, 1);
    assert.equal(venue.rooms[0].image, 'assets/photography/rooms/the-drawing-room-01.webp');
    assert.deepEqual(venue.rooms[0].gallery, ['assets/photography/rooms/the-drawing-room-02.webp'], 'a path that escapes the pack is refused');
    assert.equal(venue.rooms[0].url, 'https://example.com/drawing-room');
    assert.equal(venue.rooms[0].brochurePage, 6);
    assert.deepEqual(venue.rooms[0].features, ['Antique furnishings', 'Wedding breakfasts']);
    // The written shape is flat (`hireFee`), the authored one nested; a saved
    // pack must survive a second normalise without losing the hire terms.
    const again = Brand.normalizeContent(JSON.parse(JSON.stringify(brandFrom(sample()).content))).venue;
    assert.equal(again.hireFee, '£250');
    assert.equal(again.hireFeeNote, 'Exclusive use 7pm–12am');
    assert.equal(again.deposit, '£100');
    assert.equal(again.minGuests, '40');
});

test('venue rooms keep the capacity, AV and access of each space', () => {
    const brand = brandFrom({
        venue: {
            name: 'A townhouse',
            rooms: [
                {
                    name: 'The Drawing Room',
                    location: 'First floor',
                    capacity: 'Two long tables of 20',
                    layout: 'Dining or afternoon tea',
                    av: 'Sound system',
                    toilets: 'On this floor',
                    accessibility: 'No disabled access',
                    available: 'Any time of day',
                    note: 'The largest room.',
                },
                { name: '' },
            ],
        },
    });
    const venue = brand.content.venue;
    assert.equal(venue.rooms.length, 1, 'a room without a name is dropped');
    assert.equal(venue.rooms[0].id, 'the-drawing-room');
    assert.equal(venue.rooms[0].capacity, 'Two long tables of 20');
    assert.equal(venue.rooms[0].av, 'Sound system');
    const again = Brand.normalizeContent(JSON.parse(JSON.stringify(brand.content))).venue;
    assert.equal(again.rooms[0].accessibility, 'No disabled access');
    assert.equal(again.rooms[0].available, 'Any time of day');
});

test('locations and documents are lifted onto the brand for the library', () => {
    const brand = brandFrom(sample());
    assert.equal(brand.content.locations.length, 2);
    assert.equal(brand.documents.length, 1);
    assert.equal(brand.documents[0].path, 'documents/menu.pdf');
    assert.equal(brand.documents[0].pages, 2);
    assert.deepEqual(brand.documents[0].menuIds, ['all-day']);
    // A path that escapes the pack is refused.
    const unsafe = Brand.normalizeDocuments([{ title: 'x', path: '../../secret.pdf' }]);
    assert.deepEqual(unsafe, []);
});

test('menuItemLine writes the one-line dish format the designs parse', () => {
    const line = Brand.menuItemLine({
        name: 'Home Baked Granola',
        description: 'Greek yoghurt, maple syrup & seasonal fruit',
        price: '£7.50',
        dietary: ['GFi'],
    });
    assert.equal(line, 'Home Baked Granola | Greek yoghurt, maple syrup & seasonal fruit (GFi) | £7.50');
    assert.equal(
        Brand.menuItemLine({ name: 'Crabba', dietary: ['Ve'] }),
        'Crabba | (Ve) |',
    );
    assert.equal(Brand.menuItemLine({ name: '' }), '');
});

test('a section keeps its heading, price and note in one block', () => {
    const text = Brand.menuSectionText({
        name: 'Menu 1',
        price: '£15 per person',
        note: 'Minimum 10',
        items: [{ name: 'Parma ham', price: '' }],
    });
    assert.equal(text.split('\n')[0], '# Menu 1 · £15 per person');
    assert.equal(text.split('\n')[1], 'Parma ham |  |');
    assert.equal(text.split('\n')[2], 'Minimum 10');
});

test('menusFor only offers a branch its own menus', () => {
    const brand = brandFrom(sample());
    const garnethill = Brand.menusFor(brand, 'garnethill').map((menu) => menu.id);
    const merchantCity = Brand.menusFor(brand, 'merchant-city').map((menu) => menu.id);
    assert.deepEqual(garnethill, ['all-day', 'christmas']);
    assert.deepEqual(merchantCity, ['all-day']);
    assert.deepEqual(Brand.menusFor(brand, '').map((menu) => menu.id), ['all-day', 'christmas']);
});

test('contentAssets gives every dish, section, menu and offer a stable id', () => {
    const brand = brandFrom(sample());
    const catalog = Brand.contentAssets(brand, { branch: 'garnethill' });
    const ids = catalog.assets.map((asset) => asset.id);
    assert.equal(new Set(ids).size, ids.length, 'asset ids are unique');
    assert.ok(ids.includes('menu-all-day'));
    assert.ok(ids.includes('menu-all-day-s0'));
    assert.ok(ids.includes('menu-all-day-s0-i1'));
    assert.ok(ids.includes('venue-private-hire'));
    const room = catalog.assets.find((asset) => asset.id === 'room-the-drawing-room');
    assert.ok(room, 'a room is a draggable asset');
    assert.equal(room.format, 'offer');
    assert.equal(room.roomId, 'the-drawing-room');
    assert.equal(room.label, 'The Drawing Room');
    assert.equal(room.text, 'The Drawing Room | Two long tables of 20 · First floor | ');
    const item = catalog.assets.find((asset) => asset.id === 'menu-all-day-s0-i1');
    assert.equal(item.format, 'menu-item');
    assert.equal(item.group, 'all-day');
    assert.equal(item.label, 'Porridge');
    assert.equal(item.text, 'Porridge | (Ve) | £7.50');
    // The draggable id never contains the separator the drop payload splits on.
    assert.equal(item.id.includes(':'), false);
    const offer = catalog.assets.find((asset) => asset.id === 'venue-private-hire');
    assert.equal(offer.format, 'offer');
    assert.equal(offer.price, '£250');
    // Merchant City does not get the Garnethill-only Christmas menu.
    const south = Brand.contentAssets(brand, { branch: 'merchant-city' }).assets.map((asset) => asset.id);
    assert.equal(south.some((id) => id.startsWith('menu-christmas')), false);
    assert.equal(south.some((id) => id.startsWith('venue-')), false);
});

test('menuRows flattens a menu into the rows the Asset Studio inserts', () => {
    const brand = brandFrom(sample());
    const rows = Brand.menuRows(brand);
    assert.deepEqual(rows, [
        '# Fruits & grains',
        'Granola | Greek yoghurt (GFi) | £7.50',
        'Porridge | (Ve) | £7.50',
        'Additional toppings £1 each.',
        '# Sides',
        'Beans |  | £3.25',
    ]);
    const sides = Brand.menuRows(brand, 'all-day');
    assert.equal(sides[0], '# Fruits & grains');
});

test('a menu document with no text layer still fails closed, not open', () => {
    const brand = brandFrom({ menus: [{ name: 'Empty', sections: [] }] });
    assert.equal(brand.content, null, 'a menu with no sections is not content');
});

test('the Singl-end pack carries its menus, venue and documents', { skip: !fs.existsSync(SINGL_END_PACK) }, () => {
    const raw = JSON.parse(fs.readFileSync(SINGL_END_PACK, 'utf8'));
    const pack = Brand.normalizeBrandPack(raw.pack || raw);
    const brand = pack.brands[0];
    const menus = brand.content.menus;
    assert.deepEqual(menus.map((menu) => menu.id), ['all-day', 'drinks', 'bairns', 'functions', 'christmas']);
    const allDay = menus[0];
    assert.ok(allDay.sections.length >= 6);
    const granola = allDay.sections[0].items.find((item) => item.name === 'Home Baked Granola');
    assert.equal(granola.price, '£7.50');
    assert.equal(granola.dietary.includes('GFi'), true);
    // Every menu points at a page, and every document it points at is on disk.
    menus.forEach((menu) => {
        assert.ok(menu.source.document, `${menu.id} has a source document`);
        assert.ok(menu.source.page, `${menu.id} names a page`);
    });
    brand.documents.forEach((document) => {
        const file = path.join(path.dirname(SINGL_END_PACK), 'files', brand.id, document.path);
        assert.ok(fs.existsSync(file), `${document.path} exists in the pack`);
    });
    assert.equal(brand.documents.length, 8);
    // The function menus are Garnethill's alone.
    assert.deepEqual(menus.find((menu) => menu.id === 'functions').branches, ['garnethill']);
    assert.deepEqual(menus.find((menu) => menu.id === 'all-day').branches, ['garnethill', 'merchant-city']);
});
