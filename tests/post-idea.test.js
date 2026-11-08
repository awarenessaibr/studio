'use strict';
/**
 * Post-idea tests: one menu item becomes the post, its caption, its hashtags
 * and its motion — all from the brand's own data.
 *
 * Run with: node --test "tests/*.test.js"
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PostIdea = require('../src/shared/post-idea.js');
const Brand = require('../src/shared/brand-pack.js');

const ROOT = path.join(__dirname, '..');
const SINGL_END_PACK = path.join(
    ROOT, 'data', 'brand-packs', 'singl-end-merchant-city-20261107164459-34ab', 'pack.json',
);

const brand = {
    id: 'singl-end',
    name: 'The Singl-end Café',
    wordmark: 'The Singl-end Café',
    url: 'https://www.thesingl-end.co.uk/',
    guidelines: {
        contact: [
            { field: 'Address', value: '15 John St, Glasgow G1 1HP, UK' },
            { field: 'Instagram', value: 'https://www.instagram.com/singlendcafe_glasgow/' },
        ],
    },
};

const items = {
    granola: { name: 'Home Baked Granola', description: 'Greek yoghurt, maple syrup & seasonal fruit', price: '£7.50', dietary: ['GFi'] },
    spritz: { name: 'Aperol Spritz', description: 'Aperol, prosecco, soda', price: '£10.50', dietary: [] },
    noPrice: { name: 'Farmhouse gluten free bread', description: '', price: '', dietary: ['GFi', 'Ve'] },
};

const foodMenu = { id: 'all-day', name: 'All-day menu', kind: 'food', serves: ['breakfast', 'brunch', 'lunch'], availability: 'Open everyday · menu served all day', branches: ['garnethill', 'merchant-city'] };
const drinksMenu = { id: 'drinks', name: 'Drinks menu', kind: 'drinks', serves: ['drinks'], branches: ['garnethill', 'merchant-city'] };
const section = { name: 'Fruits & grains' };
const garnethill = { id: 'garnethill', name: 'Garnethill', address: '263 Renfrew Street' };

test('a dish becomes the post fields, a caption, hashtags and a motion idea', () => {
    const idea = PostIdea.concept(brand, { item: items.granola, menu: foodMenu, section, location: garnethill });
    assert.equal(idea.title, 'Home Baked Granola');
    assert.match(idea.description, /Greek yoghurt/);
    assert.match(idea.description, /\(GFi\)/, 'dietary marks travel with the description');
    assert.equal(idea.price, '£7.50');
    assert.equal(idea.kicker, 'Fruits & grains');
    assert.ok(idea.badge.length > 0);
    assert.equal(idea.handle, '@singlendcafe_glasgow');
    assert.equal(idea.place, 'Garnethill · 263 Renfrew Street');
    assert.match(idea.caption, /Home Baked Granola/);
    assert.match(idea.caption, /£7\.50/);
    assert.match(idea.caption, /📍 Garnethill/);
    assert.match(idea.caption, /#SinglEnd/);
    assert.match(idea.caption, /#Glasgow/);
    assert.match(idea.motion, /^Motion idea:/);
    assert.ok(idea.hashtags.length >= 3 && idea.hashtags.length <= 6);
    idea.hashtags.forEach((tag) => assert.match(tag, /^#[A-Za-z0-9]+$/, `${tag} is a usable tag`));
});

test('the same dish always gets the same hook and badge', () => {
    const first = PostIdea.concept(brand, { item: items.granola, menu: foodMenu, section });
    const second = PostIdea.concept(brand, { item: items.granola, menu: foodMenu, section });
    assert.equal(first.hook, second.hook);
    assert.equal(first.badge, second.badge);
    const other = PostIdea.concept(brand, { item: items.spritz, menu: drinksMenu, section: { name: 'Cocktails' } });
    assert.equal(first.badge === other.badge && first.hook === other.hook, false, 'another kind reads differently');
});

test('drinks read as drinks and a price-less dish leaves the price out', () => {
    const spritz = PostIdea.concept(brand, { item: items.spritz, menu: drinksMenu, section: { name: 'Cocktails' } });
    assert.equal(spritz.kind, 'drinks');
    assert.match(spritz.caption, /Aperol Spritz/);
    assert.match(spritz.caption, /£10\.50/);
    assert.match(spritz.motion, /glass/);

    const bread = PostIdea.concept(brand, { item: items.noPrice, menu: foodMenu, section });
    assert.equal(bread.price, '');
    assert.equal(bread.caption.includes('£'), false, 'no invented price');
    assert.match(bread.caption, /\(GFi, Ve\)/);
});

test('the hashtags use the brand, the city, the branch and the dish', () => {
    const tags = PostIdea.hashtagsFor(brand, { item: items.granola, menu: foodMenu, section, location: garnethill });
    assert.equal(tags[0], '#SinglEnd');
    assert.ok(tags.includes('#Glasgow'));
    assert.ok(tags.includes('#Garnethill'));
    assert.ok(tags.includes('#HomeBaked'));
    assert.ok(tags.includes('#GlasgowEats'));
    // A two-branch menu names each branch rather than merging them.
    const both = PostIdea.hashtagsFor(brand, {
        item: items.granola, menu: foodMenu, section,
        location: { name: 'Garnethill & Merchant City', address: '' },
    });
    assert.ok(both.includes('#Garnethill'));
    assert.ok(both.includes('#MerchantCity'));
    assert.equal(both.some((tag) => /GarnethillMerchant/.test(tag)), false);
});

test('a branch-scoped menu prints that branch; a two-branch menu does not pick one', () => {
    const one = PostIdea.concept(brand, { item: items.granola, menu: { ...foodMenu, branches: ['garnethill'] }, section, location: garnethill });
    assert.equal(one.place, 'Garnethill · 263 Renfrew Street');
    const both = PostIdea.concept(brand, {
        item: items.granola, menu: foodMenu, section,
        location: { name: 'Garnethill & Merchant City', address: '' },
    });
    assert.equal(both.place, 'Garnethill & Merchant City');
    const noLocation = PostIdea.concept(brand, { item: items.granola, menu: foodMenu, section, location: null });
    assert.match(noLocation.place, /15 John St/, 'falls back to the brand contact address');
});

test('the reel format changes the motion recipe, not the facts', () => {
    const feed = PostIdea.concept(brand, { item: items.granola, menu: foodMenu, section, format: 'feed' });
    const reel = PostIdea.concept(brand, { item: items.granola, menu: foodMenu, section, format: 'reel' });
    assert.equal(feed.caption, reel.caption);
    assert.equal(reel.format, 'reel');
});

test('the Singl-end pack turns a real dish into a usable caption', { skip: !fs.existsSync(SINGL_END_PACK) }, () => {
    const raw = JSON.parse(fs.readFileSync(SINGL_END_PACK, 'utf8'));
    const real = Brand.normalizeBrandPack(raw.pack || raw).brands[0];
    const menu = real.content.menus.find((entry) => entry.id === 'all-day');
    const plate = menu.sections.find((entry) => entry.name === 'Singl-eggs');
    const dish = plate.items.find((entry) => entry.name === 'Benedict');
    const idea = PostIdea.concept(real, { item: dish, menu, section: plate, location: real.content.locations[0] });
    assert.match(idea.caption, /Benedict/);
    assert.match(idea.caption, /£14\.75/);
    assert.match(idea.caption, /hollandaise/);
    assert.match(idea.hashtagsText, /#SinglEnd/);
    assert.match(idea.caption, /#Glasgow/);
    // The card's facts are the menu's facts.
    assert.equal(idea.title, dish.name);
    assert.equal(idea.price, dish.price);
});
