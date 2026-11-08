'use strict';
/**
 * post-idea.js — turns one menu item into a ready social post concept.
 *
 * A dish dragged onto a canvas is half a post. The other half is the copy: a
 * hook, the dish and its price, where it is, the hashtags, and the motion the
 * reel should use. This module writes all of that from the brand's own data —
 * menu item, menu, section, branch — so a concept never quotes a price the
 * menu does not have and never invents a location.
 *
 * Dependency-free and loaded as a plain <script> after brand-pack.js; it reads
 * nothing global, so the same call works under Node for tests.
 *
 *   concept(brand, { item, menu, section, location, format })
 *     → { badge, hook, kicker, title, description, price, handle, place,
 *         foot, caption, hashtags, hashtagsText, motion, emoji }
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StudioPostIdea = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const text = (value, limit) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit || 400);

    // A stable hash keeps the chosen hook the same for the same dish: a
    // concept that changes its headline every reload is not a concept.
    function hash(value) {
        let h = 2166136261;
        const input = String(value || '');
        for (let i = 0; i < input.length; i += 1) {
            h ^= input.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return Math.abs(h);
    }

    const pick = (list, seed) => list[hash(seed) % list.length];

    const HOOKS = {
        breakfast: [
            'Somebody is coming back for this.',
            'Worth getting out of bed for.',
            'Made for a slow morning.',
            'The reason you left the house.',
        ],
        drinks: [
            'Meet you at the bar.',
            'Poured cold, all day.',
            'One more? Go on then.',
            'The good part of the afternoon.',
        ],
        christmas: [
            'Christmas, sorted.',
            'Book the table before someone else does.',
            'Garnethill, after dark.',
        ],
        kids: [
            'For the bairns.',
            'Small guests, properly fed.',
        ],
        functions: [
            'Your room, your night.',
            'The whole place to yourselves.',
        ],
        food: [
            'On the menu today.',
            'Fresh from the kitchen.',
            'This is the one.',
            'Come hungry.',
        ],
    };

    const BADGES = {
        breakfast: ['MORNING SPECIAL', 'BRUNCH, ALL DAY', 'BREAKFAST RUN'],
        drinks: ['BEHIND THE BAR', 'POURING NOW'],
        christmas: ['CHRISTMAS 2026', 'FESTIVE MENU'],
        kids: ['BAIRNS MENU'],
        functions: ['FUNCTION MENU', 'PRIVATE HIRE'],
        food: ['ON THE MENU', 'FROM THE KITCHEN'],
    };

    const EMOJI = {
        breakfast: '🍳',
        drinks: '🥂',
        christmas: '🎄',
        kids: '🧒',
        functions: '🥂',
        food: '🍽️',
    };

    // Motion suggestions are recipes, not promises: the studio can build them
    // in Layer Studio, and the concept says what the ten seconds should do.
    const MOTION = {
        food: '0–3s the scene settles · 3–6s the dish and price rise in · 6–9s hold on the price',
        breakfast: '0–3s a slow push-in on the scene · 3–6s the dish name lifts in · 6–9s price and handle',
        drinks: '0–3s a slow push-in · 3–6s a shine passes across the glass · 6–9s price and handle',
        christmas: '0–3s the lights dim up · 3–6s the dish and price rise · 6–9s the location line',
        kids: '0–3s a gentle zoom · 3–6s the dish bounces in · 6–9s price and handle',
        functions: '0–3s the room dims · 3–6s the offer card slides up · 6–9s the booking line',
    };

    function kindOf(menu, item, section) {
        const kind = String(menu?.kind || '');
        if (kind === 'drinks' || kind === 'christmas' || kind === 'kids' || kind === 'functions') return kind;
        // A dish is read from its own section first: a Lunch dish on an
        // all-day menu is not a breakfast, whatever the menu serves.
        const context = `${section?.name || ''} ${item?.name || ''}`.toLowerCase();
        if (/lunch|sandwich|toastie|salad|main|supper|dinner/.test(context)) return 'food';
        if (/breakfast|brunch|egg|porridge|granola|yoghurt|yogurt|fruits? & grains?/.test(context)) return 'breakfast';
        const serves = Array.isArray(menu?.serves) ? menu.serves.map((entry) => String(entry).toLowerCase()) : [];
        if (serves.includes('breakfast') || serves.includes('brunch')) return 'breakfast';
        return 'food';
    }

    function slugTag(value, limit) {
        const words = String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/&/g, ' and ')
            .replace(/[^A-Za-z0-9\s-]+/g, ' ')
            .split(/[\s-]+/)
            .filter(Boolean);
        const kept = [];
        words.forEach((word) => {
            if (kept.length >= (limit || 3)) return;
            if (/^(the|and|a|of|with|or|for|to|on|in|at|our|your|from)$/i.test(word)) return;
            kept.push(word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
        });
        return kept.join('');
    }

    function contactOf(brand) {
        const brandContact = (brand && typeof brand === 'object' && brand.guidelines?.contact) || [];
        const map = {};
        brandContact.forEach((entry) => {
            const key = String(entry?.field || '').toLowerCase().replace(/[^a-z]+/g, '');
            if (key && entry?.value && !map[key]) map[key] = String(entry.value).trim();
        });
        return {
            address: map.address || '',
            phone: map.phone || map.telephone || '',
            email: map.email || '',
            website: map.website || String(brand?.url || ''),
            instagram: map.instagram || '',
        };
    }

    function handleOf(brand) {
        const contact = contactOf(brand);
        if (contact.instagram) {
            const match = contact.instagram.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
            if (match) return `@${match[1]}`;
            if (/^@/.test(contact.instagram)) return contact.instagram;
        }
        const website = contact.website.replace(/^https?:\/\//i, '').replace(/\/$/, '');
        return website || '';
    }

    // "15 John St, Glasgow G1 1HP, UK" → "Glasgow". A city is worth a hashtag;
    // guessing one would be worse than leaving it out.
    function cityOf(brand, location) {
        // The branch address is often just a street; the brand's contact
        // address usually carries the city. Try both before giving up.
        const addresses = [location?.address, contactOf(brand).address].filter(Boolean);
        for (const address of addresses) {
            const match = String(address).match(/,\s*([A-Za-z][A-Za-z\s]+?)\s*(?:,|[A-Z]{1,2}\d)/);
            if (match) return match[1].trim();
        }
        return '';
    }

    function hashtagsFor(brand, { item, menu, section, location }) {
        const tags = [];
        const add = (value) => {
            const tag = `#${String(value || '').replace(/^#/, '').replace(/\s+/g, '')}`;
            if (tag.length > 2 && !tags.includes(tag) && tags.length < 6) tags.push(tag);
        };
        add(slugTag(brand?.wordmark || brand?.name, 2));
        const city = cityOf(brand, location);
        if (city) add(slugTag(city, 2));
        // "Garnethill & Merchant City" is two places, not one hashtag.
        if (location?.name) {
            String(location.name).split(/\s*(?:&|,|\/|·)\s*/).filter(Boolean).slice(0, 2)
                .forEach((part) => add(slugTag(part, 2)));
        }
        add(slugTag(item?.name, 2));
        const kindTag = menu?.kind === 'drinks' ? 'Cocktails'
            : menu?.kind === 'kids' ? 'KidsMenu'
                : menu?.kind === 'christmas' ? 'ChristmasGlasgow'
                    : menu?.kind === 'functions' ? 'PrivateHire'
                        : section?.name || menu?.name;
        add(slugTag(kindTag, 2));
        if (city) add(slugTag(`${city} Eats`, 2));
        return tags;
    }

    function formatPrice(price, item) {
        const value = text(price, 40);
        if (!value) return '';
        // A menu price is often a pair (single/double, glass/bottle). The card
        // keeps the whole thing; the caption says where it starts.
        if (/\/|·/.test(value)) return value;
        return value;
    }

    function describe(item) {
        const description = text(item?.description, 220);
        const dietary = Array.isArray(item?.dietary) ? item.dietary.filter(Boolean) : [];
        if (!description && !dietary.length) return '';
        return [description, dietary.length ? `(${dietary.join(', ')})` : ''].filter(Boolean).join(' ').trim();
    }

    function concept(brand, options = {}) {
        const item = options.item || {};
        const menu = options.menu || {};
        const section = options.section || {};
        const location = options.location || null;
        const format = options.format === 'reel' ? 'reel' : 'feed';
        const kind = kindOf(menu, item, section);
        const seed = `${menu.id || ''}|${section.name || ''}|${item.name || ''}`;

        const title = text(item.name, 140);
        const description = describe(item);
        const price = formatPrice(item.price, item);
        const hook = pick(HOOKS[kind] || HOOKS.food, seed);
        const badge = pick(BADGES[kind] || BADGES.food, seed);
        const kicker = text(section.name || menu.name || '', 60);
        const handle = handleOf(brand);
        const place = [location?.name, location?.address].filter(Boolean).join(' · ')
            || text(contactOf(brand).address, 120);
        const emoji = EMOJI[kind] || EMOJI.food;
        const hashtags = hashtagsFor(brand, { item, menu, section, location });
        const motion = MOTION[kind] || MOTION.food;

        const lines = [];
        lines.push(`${hook} ${emoji}`.trim());
        const dishLine = [title, description].filter(Boolean).join(' — ');
        lines.push([dishLine, price].filter(Boolean).join(' · '));
        if (place) lines.push(`📍 ${place}`);
        const hours = text(menu.availability, 120);
        if (hours) lines.push(hours);
        const caption = [...lines, '', hashtags.join(' ')].filter((line) => line !== null).join('\n').trim();

        return {
            kind,
            badge,
            hook,
            kicker,
            title,
            description,
            price,
            handle,
            place,
            foot: [handle, place].filter(Boolean).join('\n'),
            emoji,
            caption,
            hashtags,
            hashtagsText: hashtags.join(' '),
            motion: `Motion idea: ${motion}.`,
            format,
        };
    }

    return {
        concept,
        hashtagsFor,
        cityOf,
        handleOf,
        kindOf,
        MOTION,
        HOOKS,
        BADGES,
    };
}));
