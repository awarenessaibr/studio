'use strict';
/**
 * Brand Asset Studio.
 *
 * A new, focused UI over the brand packs produced by the brand-identity step
 * and the category designs extracted from ThePhysicianAssetStudio. It keeps the
 * brand palette, type, logos, photography and guidelines as the single source
 * of truth, and sends the final asset to PNG or print.
 */
(() => {
    const API = 'api';
    const SESSION_KEY = 'assetStudio.session.v1';
    const SAVED_KEY = 'assetStudio.saved.v1';
    const SAVED_LIMIT = 24;
    const PREVIEW_MAX = 1500;
    const THUMB_WIDTH = 220;

    const CATEGORY_META = {
        flyer: { label: 'Flyers', hint: 'A4 · A3 · social' },
        menu: { label: 'Menus', hint: 'A4 · DL · story' },
        voucher: { label: 'Gift vouchers', hint: 'wide · A5 · digital' },
        bizcard: { label: 'Business cards', hint: 'front · back · both' },
        tablecard: { label: 'Table cards', hint: 'A5 · square' },
        social: { label: 'Social posts', hint: 'square · 4:5 · story' },
        signage: { label: 'Signage', hint: 'A1 · A3 · screens · roll-up' },
        guest: { label: 'Guest cards', hint: 'loyalty · reviews · hangers' },
        stationery: { label: 'Stationery', hint: 'letterhead · thank-you' },
        packaging: { label: 'Packaging', hint: 'stickers · coasters · sleeves' },
        compliance: { label: 'Compliance', hint: 'allergens · prep labels' },
    };

    const TEMPLATE_IDS = {
        flyer: 'flyer',
        menu: 'menu',
        voucher: 'voucher',
        bizcard: 'business-card-front',
        tablecard: 'table-card',
        social: 'social-post',
        signage: 'flyer',
        guest: 'table-card',
        stationery: 'flyer',
        packaging: 'voucher',
        compliance: 'menu',
    };

    const STUDIO_FONTS = [
        ['Georgia — editorial serif', 'Georgia, "Times New Roman", serif'],
        ['Times New Roman — classic serif', '"Times New Roman", Times, serif'],
        ['Palatino — humanist serif', '"Palatino Linotype", Palatino, "Book Antiqua", serif'],
        ['Baskerville — book serif', 'Baskerville, "Times New Roman", serif'],
        ['Didot — high-contrast serif', 'Didot, "Bodoni MT", "Times New Roman", serif'],
        ['Helvetica Neue — neutral sans', '"Helvetica Neue", Helvetica, Arial, sans-serif'],
        ['Arial — system sans', 'Arial, Helvetica, sans-serif'],
        ['Futura — geometric sans', 'Futura, "Trebuchet MS", Arial, sans-serif'],
        ['Gill Sans — humanist sans', '"Gill Sans", "Trebuchet MS", sans-serif'],
        ['Optima — flared sans', 'Optima, Candara, "Segoe UI", sans-serif'],
        ['Avenir — warm sans', 'Avenir, "Avenir Next", "Helvetica Neue", sans-serif'],
        ['Verdana — wide sans', 'Verdana, Geneva, sans-serif'],
        ['Trebuchet — friendly sans', '"Trebuchet MS", "Lucida Grande", sans-serif'],
        ['Courier New — mono', '"Courier New", Courier, monospace'],
        ['American Typewriter — slab', '"American Typewriter", "Courier New", monospace'],
        ['Copperplate — display', 'Copperplate, "Times New Roman", serif'],
        ['Impact — poster sans', 'Impact, "Arial Black", sans-serif'],
        ['Brush Script — script', '"Brush Script MT", "Georgia", cursive'],
    ];

    const MOTIF_LABELS = {
        auto: 'Original',
        sprig: 'Botanical',
        glass: 'Cocktail',
        rod: 'Rod',
        star: 'Sparkle',
        sun: 'Sun',
        arch: 'Arch',
        wave: 'Wave',
        leaf: 'Leaf',
        diamond: 'Diamond',
        cross: 'Cross',
        laurel: 'Laurel',
        ring: 'Ring',
        logo: 'Logo',
        none: 'None',
    };

    let printWarnings = [];
    let printWarningAcknowledged = false;

    const printOptions = {
        bleed: 3,
        safe: 4,
        marks: true,
        dpi: 300,
    };

    const BRAND_COPY = {
        'the-butterfly-and-the-pig': {
            eyebrow: 'Georgian townhouse · Bath Street',
            sub: 'A love story, twenty-one years long.',
            boldTitle: 'Dinner, served properly.',
            body: 'Breakfast, lunch and afternoon tea in the Tea Rooms; drinks and live music in the Bar; home-cooked Scottish dishes in the Restaurant.',
            cta: 'Book a table',
            tag: 'A love story, twenty-one years long.',
            terms: 'Redeemable at The Butterfly and the Pig. Valid for 12 months from purchase. One voucher per booking, not exchangeable for cash.',
            items: `# Tea Rooms
Breakfast | Served from 9am
Afternoon Tea | Cakes, scones and sandwiches
# Restaurant
Sunday Lunch | Two courses
Home-cooked Scottish dishes | Seasonal menu
# Bar
Drinks & live entertainment | Seven days`,
        },
        'the-marlborough': {
            eyebrow: 'Ballroom · bars · club rooms',
            sub: 'A dazzling world of nightlife experiences.',
            boldTitle: 'The night starts here.',
            body: "A multipurpose space for the passionate, the peculiar and the party-goers. Ballroom, Red Room, Dear Josephine's and B Side.",
            cta: 'Book a table',
            tag: 'A dazzling world of nightlife experiences.',
            terms: 'Redeemable at The Marlborough. Valid for 12 months from purchase. One voucher per booking, not exchangeable for cash.',
            phone: 'Email enquiries',
            handle: '',
            items: `# Cocktails
Signature cocktail | Ask about today's pour
Espresso martini | Vodka, coffee liqueur, espresso
# Champagne
House champagne | Glass or bottle
# Small plates
Olives | Warm, marinated
Fries | Sea salt and rosemary`,
        },
        'the-singl-end': {
            eyebrow: 'Café and bakehouse · Garnethill & Merchant City',
            sub: 'Famous for brunch. Infamous for our cake table.',
            boldTitle: 'Famous for brunch.',
            body: 'Hearty home-cooked breakfast, brunch and cakes, all made in-house. Two cafés and one bakehouse in Glasgow.',
            cta: 'Book a table',
            tag: 'Famous for brunch. Infamous for our cake table.',
            terms: 'Redeemable at The Singl-end. Valid for 12 months from purchase. One voucher per booking, not exchangeable for cash.',
            items: `# Brunch
Brunch plate | Eggs, bacon, toast and all the trimmings
French toast | Seasonal fruit and syrup
# Cake table
Cake of the day | Ask at the counter
# Coffee
Flat white | House espresso`,
        },
        boardwalk: {
            eyebrow: 'Restaurant, carvery & bar · Falkirk',
            sub: 'Stylish, all day dining.',
            body: 'All-day dining beside the Falkirk Wheel: breakfast from nine, a Sunday carvery, a late bar and terraces with a view.',
            cta: 'Book a table',
            tag: 'Stylish, all day dining.',
            boldTitle: 'All day, done properly.',
            terms: 'Redeemable at Boardwalk. Valid for 12 months from purchase. One voucher per booking, not exchangeable for cash.',
            christmas: {
                title: 'Christmas at Boardwalk',
                date: 'Available throughout December',
                price: 'Festive menus available',
                message: 'Merry Christmas from Boardwalk.',
                body: 'Join us for Christmas lunch, festive menus and a table beside the Falkirk Wheel.',
            },
            items: `# Breakfast
Morning rolls | Served from 9am
Full breakfast | Bacon, sausage, egg and toast
# Carvery
Sunday carvery | Choose from the day's roasts
# All day
Fish and chips | Classic, with tartare
Puddings | Ask for today's board`,
        },
        'boat-yard': {
            eyebrow: 'Restaurant, carvery & lounge · Lochwinnoch',
            sub: "Renfrewshire's premier restaurant & bar.",
            body: 'Country dining at Lochwinnoch: weekend carvery, panoramic views over Castle Semple and a lounge for the evening.',
            cta: 'Book a table',
            tag: "Renfrewshire's premier restaurant & bar.",
            boldTitle: "Renfrewshire's finest.",
            terms: 'Redeemable at The Boat Yard. Valid for 12 months from purchase. One voucher per booking, not exchangeable for cash.',
            christmas: {
                title: 'Christmas at The Boat Yard',
                date: 'Available throughout December',
                price: 'Festive menus available',
                message: 'Merry Christmas from The Boat Yard.',
                body: 'Join us for Christmas lunch, festive menus and views over Castle Semple.',
            },
            items: `# Carvery
Weekend carvery | Choose from the day's roasts
# Classics
Fish and chips | Classic, with tartare
Steak pie | Slow-cooked, with mash
# Bobby's Lounge
Light bites | Available all day`,
        },
        coast: {
            eyebrow: 'Bar & restaurant · Langbank, Inverclyde',
            sub: 'Riverside dining.',
            body: 'Riverside dining on the Clyde: a nautical room at Langbank, an extensive menu from ten and one of the best views in Inverclyde.',
            cta: 'Book a table',
            tag: 'Riverside dining.',
            boldTitle: 'A table by the Clyde.',
            terms: 'Redeemable at Coast Bar & Restaurant. Valid for 12 months from purchase. One voucher per booking, not exchangeable for cash.',
            christmas: {
                title: 'Christmas at Coast',
                date: 'Available throughout December',
                price: 'Festive menus available',
                message: 'Merry Christmas from Coast.',
                body: 'Join us for Christmas lunch, festive menus and a table by the Clyde.',
            },
            items: `# Riverside
Soup of the day | With crusty bread
# Mains
Fish and chips | Classic, with tartare
Riverside salad | Seasonal leaves and dressing
# Drinks
Coast spritz | Ask for today's pour`,
        },
        'duck-bay': {
            eyebrow: 'Hotel, cottages & restaurant · Loch Lomond',
            sub: 'Lochside luxury.',
            body: 'A family-run hotel, restaurant and cottages on the banks of Loch Lomond since 1985: lochside dining, afternoon tea and weddings.',
            cta: 'Book a table',
            tag: 'Lochside luxury.',
            boldTitle: 'A table by the loch.',
            terms: 'Redeemable at Duck Bay Hotel & Cottages. Valid for 12 months from purchase. One voucher per booking, not exchangeable for cash.',
            christmas: {
                title: 'Christmas at Duck Bay',
                date: 'Available throughout December',
                price: 'Festive menus available',
                message: 'Merry Christmas from Duck Bay.',
                body: 'Join us for Christmas lunch, festive menus and a table by Loch Lomond.',
            },
            items: `# Lochside
Soup of the day | With crusty bread
# Afternoon tea
Afternoon tea | Sandwiches, scones and cakes
# Dinner
Fish and chips | Classic, with tartare`,
        },
        'river-house': {
            eyebrow: 'Restaurant & bar · Stirling',
            sub: 'Relaxed dining, elevated.',
            body: "Contemporary dining above the loch, with Stirling Castle in the view, a private dining room for twelve and Bobby's bar after dark.",
            cta: 'Book a table',
            tag: 'Relaxed dining, elevated.',
            boldTitle: 'A table with a view.',
            terms: 'Redeemable at River House. Valid for 12 months from purchase. One voucher per booking, not exchangeable for cash.',
            christmas: {
                title: 'Christmas at River House',
                date: 'Available throughout December',
                price: 'Festive menus available',
                message: 'Merry Christmas from River House.',
                body: 'Join us for Christmas lunch, festive menus and a table with a castle view.',
            },
            items: `# Starters
Soup of the day | With crusty bread
# Mains
Fish and chips | Classic, with tartare
Steak | Ask for today's cut
# Bobby's
Afternoon tea | By day
Cocktails | By night`,
        },
        'kitchen-os': {
            eyebrow: 'Kitchen operations platform',
            sub: 'The operating system for professional kitchens.',
            body: 'One login for food safety, allergens, labelling, waste and costing — built for professional kitchens that get inspected.',
            cta: 'Book a demo',
            tag: 'The operating system for professional kitchens.',
            terms: 'Redeemable against a Kitchen OS plan. One code per account. Valid for 12 months.',
            flyerTitle: 'Run a tighter kitchen.',
            featureTitle: 'One platform.',
            featureBody: 'Food safety, allergens, labelling and waste in one login.',
            featurePrice: '500+ kitchens',
            featureEyebrow: 'Kitchen OS platform',
            socialTitle: 'See it in action.',
            announcementTitle: 'Meet KIM, your kitchen intelligence manager.',
            announcementEyebrow: 'New from Kitchen OS',
            announcementSub: 'Book a demo',
            scanTitle: 'Scan to see Kitchen OS in action',
            scanEyebrow: 'Scan for the demo',
            boldTitle: 'Run a tighter kitchen.',
            christmas: {
                title: 'A calmer Christmas service.',
                date: 'Book a demo before December',
                price: 'Festive onboarding',
                body: 'Get your kitchen audit-ready before the Christmas rush.',
                message: 'Merry Christmas from Kitchen OS.',
            },
            items: `# Food safety
Digital HACCP | Temperature monitoring and checklists
# Allergens
AllerQ | QR allergen menus that update themselves
# Labelling
Food Label System | Prep, use-by and PPDS labels
# Waste
F*** Waste | Under-bin scales and cost reporting`,
        },
        'food-safe-system': {
            eyebrow: 'Digital food safety & HACCP',
            sub: 'Ditch the paperwork. Dodge the fines.',
            body: 'Digital HACCP, wireless temperature sensors and inspection-ready records for kitchens that get inspected.',
            cta: 'Book a demo',
            tag: 'Ditch the paperwork. Dodge the fines.',
            terms: 'Redeemable against a Food Safe System plan. One code per account. Valid for 12 months.',
            flyerTitle: 'Pass every inspection.',
            featureTitle: 'Audit-ready, every day.',
            featureBody: 'Wireless sensors, smart checklists and instant compliance reports.',
            featurePrice: 'From £15/month',
            featureEyebrow: 'Food Safe System',
            socialTitle: 'See it in action.',
            announcementTitle: 'New: wireless sensors, live in minutes.',
            announcementEyebrow: 'New from Food Safe System',
            announcementSub: 'Book a demo',
            scanTitle: 'Scan to see Food Safe System in action',
            scanEyebrow: 'Scan for the demo',
            boldTitle: 'Pass every inspection.',
            christmas: {
                title: 'A calmer Christmas service.',
                date: 'Book a demo before December',
                price: 'Festive onboarding',
                body: 'Stay audit-ready through the Christmas rush.',
                message: 'Merry Christmas from Food Safe System.',
            },
            items: `# Compliance
Digital HACCP | Audit-ready records
# Monitoring
Wireless sensors | Temperature breaches, alerted
# Checklists
Smart checklists | Completed by the team
# Reports
Instant reports | Ready for the EHO`,
        },
        'food-label-system': {
            eyebrow: 'Digital labelling for kitchens',
            sub: 'Smart digital labelling for modern kitchens.',
            body: 'Automated date, use-by and PPDS labelling: a thermal printer, an app and compliant labels, priced per kitchen.',
            cta: 'Book a demo',
            tag: 'Smart digital labelling for modern kitchens.',
            terms: 'Redeemable against a Food Label System plan. One code per account. Valid for 12 months.',
            flyerTitle: 'Labels that think.',
            featureTitle: 'Print in seconds.',
            featureBody: 'Prep, use-by and PPDS labels from a thermal printer and app.',
            featurePrice: '£35/month',
            featureEyebrow: 'Food Label System',
            socialTitle: 'See it in action.',
            announcementTitle: 'New: PPDS labels, printed in seconds.',
            announcementEyebrow: 'New from Food Label System',
            announcementSub: 'Book a demo',
            scanTitle: 'Scan to see Food Label System in action',
            scanEyebrow: 'Scan for the demo',
            boldTitle: 'Labels that think.',
            christmas: {
                title: 'A calmer Christmas service.',
                date: 'Book a demo before December',
                price: 'Festive onboarding',
                body: 'Keep every label compliant through Christmas.',
                message: 'Merry Christmas from Food Label System.',
            },
            items: `# Labels
Prep labels | Date, time and initials
# Use-by
Use-by labels | Clear, compliant dates
# PPDS
PPDS labels | For planned prep
# Hardware
Thermal printer | Two-year warranty`,
        },
        allerq: {
            eyebrow: 'Digital allergen menus',
            sub: 'Digital allergen menus that update themselves.',
            body: 'QR-code allergen and dietary menus that update when the recipe changes, so the guest sees the menu the kitchen is cooking.',
            cta: 'Book a demo',
            tag: 'Digital allergen menus that update themselves.',
            phone: 'Book a demo online',
            terms: 'Redeemable against an AllerQ plan. One code per account. Valid for 12 months.',
            flyerTitle: 'The menu updates itself.',
            featureTitle: 'One QR code.',
            featureBody: 'Allergen and dietary menus behind a QR code that stays current.',
            featurePrice: 'From £5/month',
            featureEyebrow: 'AllerQ',
            socialTitle: 'See it in action.',
            announcementTitle: 'New: 14 allergens, one QR code.',
            announcementEyebrow: 'New from AllerQ',
            announcementSub: 'Book a demo',
            scanTitle: 'Scan to see the AllerQ menu',
            scanEyebrow: 'Scan for the menu',
            boldTitle: 'The menu updates itself.',
            christmas: {
                title: 'A calmer Christmas service.',
                date: 'Book a demo before December',
                price: 'Festive onboarding',
                body: 'Update every allergen menu before the Christmas menu lands.',
                message: 'Merry Christmas from AllerQ.',
            },
            items: `# Allergens
14 allergens | Clearly listed
# Menus
QR menus | Updated in one place
# Dietary
Dietary filters | Guest-friendly
# Print
Table cards | QR-ready`,
        },
        'f-waste': {
            eyebrow: 'Waste tracking for kitchens',
            sub: 'Turning waste into profit.',
            body: 'IoT under-bin scales and waste analytics that show the operator what to stop buying — 50%+ waste reduction and a proven 14:1 ROI.',
            cta: 'Book a demo',
            tag: 'Turning waste into profit.',
            terms: 'Redeemable against an F*** Waste plan. One code per account. Valid for 12 months.',
            flyerTitle: 'Cut the waste bill.',
            featureTitle: 'Know your waste.',
            featureBody: 'A scale under the bin weighs, categorises and costs every waste stream.',
            featurePrice: '14:1 ROI',
            featureEyebrow: 'F*** Waste',
            socialTitle: 'See it in action.',
            announcementTitle: 'New: under-bin scales, live in minutes.',
            announcementEyebrow: 'New from F*** Waste',
            announcementSub: 'Book a demo',
            scanTitle: 'Scan to see F*** Waste in action',
            scanEyebrow: 'Scan for the demo',
            boldTitle: 'Cut the waste bill.',
            christmas: {
                title: 'A calmer Christmas service.',
                date: 'Book a demo before December',
                price: 'Festive onboarding',
                body: 'Cut the Christmas waste bill before January.',
                message: 'Merry Christmas from F*** Waste.',
            },
            items: `# Waste
Under-bin scales | Weigh every bin
# Costs
Cost per kilo | What it costs you
# Reporting
ESG reports | Kilograms, cost and trend
# Savings
14:1 ROI | Proven pilots`,
        },
        okja: {
            eyebrow: 'Cafés · bakery · coffee',
            sub: 'Built from scratch. Made to be remembered.',
            body: 'Pastries, coffee and plant m!lks made from scratch in Cape Town and London. No shortcuts, no labels, no coffee snobbery.',
            cta: 'Order online',
            tag: 'Built from scratch. Made to be remembered.',
            terms: 'Redeemable at okja cafés. One per visit. Valid for 12 months.',
            flyerTitle: 'OK, JA.',
            featureTitle: 'Simple is hard.',
            featureBody: 'Pastries, coffee and plant m!lks made from scratch, with no shortcuts.',
            featurePrice: 'Cape Town · London',
            featureEyebrow: 'okja cafés',
            socialTitle: 'OK, JA.',
            announcementTitle: 'A new home in Liverpool Street.',
            announcementEyebrow: 'New café',
            announcementSub: 'Come say hi.',
            scanTitle: 'Scan to see okja',
            scanEyebrow: 'okja online',
            boldTitle: 'Simple is hard.',
            christmas: {
                title: 'OK, festive.',
                date: 'Available in December',
                price: 'Festive bakes',
                body: 'Mince pies, cinnamon buns and coffee, made from scratch in Cape Town and London.',
                message: 'Merry Christmas from okja.',
            },
            items: `# Pastries
Croissant | Made from scratch
Pain au chocolat | House chocolate
# Coffee
Flat white | House espresso
Matcha | Ceremonial grade
# M!lks
Oat m!lk | Italian oats, 16%
Soy m!lk | The Frumpy Überbean
# Granola & spread
Granola | The Third Kind
Chocolate hazelnut spread | Deez Nuts`,
        },
    };

    const CAWLEY_IDS = new Set(['boardwalk', 'boat-yard', 'coast', 'duck-bay', 'river-house']);
    const KITCHENOS_IDS = new Set(['kitchen-os', 'food-safe-system', 'food-label-system', 'allerq', 'f-waste']);
    const OKJA_IDS = new Set(['okja']);
    const BRAND_FONT_ROLES = {
        'kitchen-os': { display: 'Atkinson Hyperlegible 700', body: 'Atkinson Hyperlegible 400' },
        'food-safe-system': { display: 'Figtree 700', body: 'Open Sans 400' },
        'food-label-system': { display: 'Atkinson Hyperlegible 700', body: 'Atkinson Hyperlegible 400' },
        allerq: { display: 'Francois One', body: 'Poppins 400' },
        'f-waste': { display: 'Atkinson Hyperlegible 700', body: 'Atkinson Hyperlegible 400' },
        okja: { display: 'Okja Display 900', body: 'Okja Text 400' },
    };

    const CONTROLS = [
        ['colours', 'Colours'],
        ['type', 'Type'],
        ['image', 'Image'],
        ['motif', 'Motif'],
        ['logo', 'Logo'],
        ['text', 'Text'],
        ['size', 'Size'],
        ['saved', 'Saved'],
    ];

    const state = {
        packs: [],
        pack: null,
        brands: [],
        brand: null,
        categoryId: 'flyer',
        templateIndex: 0,
        sizeIndex: 0,
        slideIndex: 0,
        pal: { paper: '#ebe6e0', ink: '#17162e', accent: '#eb5b3c' },
        fonts: {
            display: 'Georgia, "Times New Roman", serif',
            serif: 'Georgia, "Times New Roman", serif',
            sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        },
        motif: 'auto',
        motifOn: true,
        motifLast: 'sprig',
        motifScale: 1,
        motifX: 0,
        motifY: 0,
        motifAnchor: null,
        logoOn: true,
        logoBaseScale: 1,
        logoX: 0,
        logoY: 0,
        logoAnchor: null,
        zoom: 1,
        zoomX: 0,
        zoomY: 0,
        zoomBase: null,
        qr: '',
        text: {},
        photoIndex: 0,
        photos: [],
        photoSources: [],
        logoWordmark: null,
        logoMark: null,
        logoScale: 1,
        uploadedFonts: [],
        saved: [],
        activeTab: 'colours',
        loadingPack: false,
        libraryAssets: [],
        libraryRows: [],
        libraryClass: '',
        libraryVerifiedOnly: false,
        libraryLoadedBrand: '',
    };

    const el = {};
    const imageCache = new Map();
    const packCache = new Map();
    const libraryCache = new Map();
    const LAST_BRANDS_KEY = 'assetStudio.lastBrands.v1';
    const defaultTextCache = new Map();
    let previewFrame = 0;
    let thumbTimer = 0;
    let sessionTimer = 0;
    let toastTimer = 0;

    // ─── tiny DOM helpers ────────────────────────────────────────────

    const make = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    };

    const clear = (node) => {
        while (node.firstChild) node.removeChild(node.firstChild);
    };

    const button = (label, className, onClick) => {
        const node = make('button', className, label);
        node.type = 'button';
        if (onClick) node.addEventListener('click', onClick);
        return node;
    };

    const fetchJson = async (path, options) => {
        const response = await fetch(path, { cache: 'no-store', ...options });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || `${response.status} ${response.statusText}`);
        return payload;
    };

    const loadImage = (src) => {
        if (imageCache.has(src)) return imageCache.get(src);
        const promise = new Promise((resolve, reject) => {
            const image = new Image();
            image.decoding = 'async';
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error(`Could not load ${src}`));
            image.src = src;
        });
        imageCache.set(src, promise);
        return promise;
    };

    const slug = (value) => String(value || '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 70) || 'asset';

    const luma = (hex) => {
        const match = /^#([0-9a-f]{6})$/i.exec(hex || '');
        if (!match) return 0.5;
        const value = parseInt(match[1], 16);
        const r = (value >> 16) & 255;
        const g = (value >> 8) & 255;
        const b = value & 255;
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };

    const contactValue = (field) => {
        const contact = state.brand?.guidelines?.contact || [];
        const entry = contact.find((item) => String(item.field || '').toLowerCase() === field.toLowerCase());
        return entry?.value || '';
    };

    const website = () => {
        const value = contactValue('Website') || state.brand?.url || '';
        return String(value).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    };

    const websiteUrl = () => {
        const value = String(state.brand?.url || '').trim();
        if (value) return value;
        const site = website();
        return site ? `https://${site}` : '';
    };

    // ─── category + template helpers ─────────────────────────────────

    const currentCategory = () => window.AssetCategories[state.categoryId];
    const currentTemplate = () => currentCategory()?.tpls[state.templateIndex] || null;
    // A template may list the size presets it supports (`sizes: ['A4 portrait',
    // …]`). Categories with mixed print/screen work (signage, packaging) need
    // this; categories where every design shares the list need nothing.
    const sizesForTemplate = (template = currentTemplate(), category = currentCategory()) => {
        const all = category?.sizes || [];
        if (!template || !Array.isArray(template.sizes) || !template.sizes.length) return all;
        const allowed = new Set(template.sizes);
        const filtered = all.filter((size) => allowed.has(size.n));
        return filtered.length ? filtered : all;
    };

    const currentSize = () => {
        const sizes = sizesForTemplate();
        return sizes[state.sizeIndex] || sizes[0] || { w: 1080, h: 1080, n: 'Square' };
    };

    // print | screen | thermal — drives which exports are offered.
    const currentProfile = () => currentTemplate()?.profile || currentCategory()?.profile || 'print';

    const slidePoints = () => String(state.text?.points || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const slideCount = (template = currentTemplate()) => (
        template?.multi ? Math.max(3, Math.min(10, 2 + slidePoints().length)) : 1
    );

    const clampSlide = () => {
        state.slideIndex = Math.max(0, Math.min(slideCount() - 1, Number(state.slideIndex) || 0));
        return state.slideIndex;
    };
    const categoryLabel = (id = state.categoryId) => CATEGORY_META[id]?.label || window.AssetCategories[id]?.title?.replace(/ Maker$/, '') || id;

    const templateHasPhoto = (template) => Boolean(template?.ph)
        || /photo\s*\(/.test(String(template?.draw || ''));

    const defaultMotifFor = (template) => {
        const source = String(template?.draw || '');
        if (/glass\s*\(/.test(source)) return 'glass';
        if (/sprig\s*\(/.test(source) || /\bsp\s*:/.test(source)) return 'sprig';
        if (/rod\s*\(/.test(source)) return 'rod';
        // Designs that only call drawMotif() still have an original element;
        // pick the first quoted vector so the "Original" tile has a preview.
        for (const id of ['sprig', 'glass', 'rod', 'laurel', 'arch', 'wave', 'leaf', 'star', 'sun', 'diamond', 'cross', 'ring']) {
            if (source.includes(`'${id}'`) || source.includes(`"${id}"`)) return id;
        }
        return 'none';
    };

    const templateHasMotif = (template) => window.AssetEngine.templateUsesMotif(template);

    const defaultMotifForBrand = (brand, template) => {
        if (!brand) return 'auto';
        // The extracted designs share a medical rod motif. It is right for
        // The Physician and wrong for every hospitality brand in Monteleone
        // Group, so those brands start with the motif off. Glass/sprig motifs
        // are generic enough to keep.
        if (OKJA_IDS.has(brand.id) && templateHasMotif(template) && template.n !== 'Christmas sprig') {
            return 'arch';
        }
        if (KITCHENOS_IDS.has(brand.id) && templateHasMotif(template) && template.n !== 'Christmas sprig') {
            return (brand.id === 'food-label-system' || brand.id === 'allerq') ? 'diamond' : 'ring';
        }
        if (CAWLEY_IDS.has(brand.id) && templateHasMotif(template) && template.n !== 'Christmas sprig') {
            return (brand.id === 'boardwalk' || brand.id === 'river-house') ? 'arch' : 'wave';
        }
        if (BRAND_COPY[brand.id] && defaultMotifFor(template) === 'rod') {
            if (brand.id === 'the-marlborough') return 'glass';
            return 'sprig';
        }
        return 'auto';
    };

    // Motif placement: scale and offsets are normalised (fraction of the
    // design, -0.45…0.45) so a saved asset restores on any output size.
    const clampMotifScale = (value) => Math.max(0.3, Math.min(2.5, Number(value) || 1));
    const clampMotifOffset = (value) => Math.max(-0.45, Math.min(0.45, Number(value) || 0));
    const clampLogoScale = (value, fallback = 1) => {
        const number = Number(value);
        return Math.max(0.3, Math.min(2.5, Number.isFinite(number) && number > 0 ? number : (fallback || 1)));
    };
    const resetMotifPlacement = () => {
        state.motifOn = true;
        state.motifScale = 1;
        state.motifX = 0;
        state.motifY = 0;
    };

    const resetLogoPlacement = () => {
        state.logoOn = true;
        state.logoScale = state.logoBaseScale || 1;
        state.logoX = 0;
        state.logoY = 0;
    };

    const categoryDefaultText = (template, index) => {
        if (!template) return {};
        const key = `${state.brand?.id || 'none'}|${state.categoryId}|${index}`;
        if (defaultTextCache.has(key)) return { ...defaultTextCache.get(key) };
        const text = {};
        const source = { ...(template.t || {}) };
        // A crawler pack carries structured menu content. Prefill the menu
        // designs with it instead of the generic scallops/beef set.
        const brandContent = state.brand?.content;
        if (state.categoryId === 'menu' && brandContent) {
            const menu = brandContent.menu || brandContent.drinks;
            if (menu && Array.isArray(menu.sections) && menu.sections.length) {
                const lines = [];
                // A printed menu needs air. The crawler can return 30+ dishes;
                // keep the first three sections / ten lines so the layout
                // stays legible, and let the user paste more in the Text tab.
                menu.sections.slice(0, 3).forEach((section) => {
                    if (lines.length >= 10) return;
                    const items = Array.isArray(section.items) ? section.items : [];
                    if (!items.length) return;
                    if (section.name) lines.push(`# ${section.name}`);
                    items.slice(0, 5).forEach((item) => {
                        if (!item || !item.name || lines.length >= 10) return;
                        const description = item.description && item.description.length <= 70
                            ? item.description
                            : '';
                        lines.push([item.name, description, item.price || ''].join(' | '));
                    });
                });
                if (lines.length) {
                    source.items = lines.join('\n');
                    source.title = menu.title || 'Menu';
                }
            }
        }
        const copy = BRAND_COPY[state.brand?.id];
        if (copy) {
            Object.entries(copy).forEach(([field, value]) => {
                if (!(field in source)) return;
                // Do not flatten design-specific labels: a Secret Santa voucher
                // still says Secret Santa, and a dish card keeps its dish copy.
                if (field === 'eyebrow'
                    && !(state.categoryId === 'flyer' && /^(?:Decadance|Sunday sessions)/i.test(source.eyebrow || ''))) return;
                if (field === 'body' && !/Seasonal plates|Book a table for Sunday lunch/i.test(source.body || '')) return;
                if (field === 'sub' && source.sub && !/^Find your cure\.$/i.test(source.sub)) return;
                source[field] = value;
            });
            if (copy.boldTitle && (template.n === 'Bold colour' || template.n === 'Statement')) {
                source.title = copy.boldTitle;
            }
            // Replace the extracted The Adamson/Physician Christmas event copy
            // with a neutral, brand-led Christmas message. Cawley venues can
            // supply their own body/venue line; the rest get a safe generic.
            if (/Christmas/i.test(source.title || '') || /Decadance/i.test(source.body || '') || /Christmas/i.test(source.msg || '')) {
                const christmas = copy.christmas || {
                    title: `Christmas at ${state.brand?.name || 'our venue'}`,
                    date: 'Available throughout December',
                    price: 'Festive menus available',
                    body: `Join us for Christmas at ${state.brand?.name || 'our venue'}.`,
                    message: `Merry Christmas from ${state.brand?.name || 'our venue'}.`,
                };
                if ('title' in source && /Christmas/i.test(source.title || '')) source.title = christmas.title;
                if ('date' in source) source.date = christmas.date;
                if ('price' in source) source.price = christmas.price;
                if ('body' in source && /Decadance/i.test(source.body || '')) source.body = christmas.body;
                if ('msg' in source && /Find your cure/i.test(source.msg || '')) source.msg = christmas.message;
            }
            if (copy.flyerTitle || copy.featureTitle || copy.announcementTitle || copy.scanTitle) {
                const isChef = /^Chef.s special$/i.test(template.n || '');
                if (copy.flyerTitle && state.categoryId === 'flyer' && template.n === 'Table worth crossing') {
                    source.title = copy.flyerTitle;
                }
                if (copy.featureTitle && (template.n === 'Night photo' || isChef)) {
                    if ('title' in source) source.title = copy.featureTitle;
                    if ('body' in source) source.body = copy.featureBody;
                    if (isChef && 'foot' in source) source.foot = copy.featureBody;
                    if ('price' in source) source.price = copy.featurePrice;
                    if ('eyebrow' in source) source.eyebrow = copy.featureEyebrow;
                }
                if (copy.socialTitle && template.n === 'Sunday sessions') source.title = copy.socialTitle;
                if (copy.announcementTitle && template.n === 'Announcement') {
                    if ('title' in source) source.title = copy.announcementTitle;
                    if ('sub' in source) source.sub = copy.announcementSub;
                    if ('eyebrow' in source) source.eyebrow = copy.announcementEyebrow;
                }
                if (copy.scanTitle && template.n === 'Scan for the menu') {
                    if ('title' in source) source.title = copy.scanTitle;
                    if ('eyebrow' in source) source.eyebrow = copy.scanEyebrow || 'Scan for the demo';
                }
            }
        }
        Object.entries(source).forEach(([field, value]) => {
            text[field] = typeof value === 'string' ? brandify(value) : value;
        });
        defaultTextCache.set(key, text);
        return { ...text };
    };

    // ─── brand identity helpers ──────────────────────────────────────

    const brandRolesFor = (brand, categoryId) => {
        const templateId = TEMPLATE_IDS[categoryId] || 'flyer';
        try {
            const roles = window.StudioBrand.paletteRoles(brand, templateId);
            if (roles?.ground?.hex && roles?.ink?.hex && roles?.accent?.hex) {
                // Keep the signature accent of the two KitchenOS brands whose
                // primary is a light green/lime: the generic contrast picker
                // chooses a safe navy, but the brand's action colour is the
                // green/lime. Text and logos switch to ink through the
                // accent-aware helpers in the engine.
                const preferred = brand.id === 'kitchen-os'
                    ? '#00b589'
                    : brand.id === 'food-label-system' ? '#c3e941' : null;
                if (preferred) {
                    const entry = (brand.palette || []).find((item) => String(item.hex || '').toLowerCase() === preferred);
                    if (entry) return { ...roles, accent: entry };
                }
                return roles;
            }
        } catch {
            /* fall through to a simple, safe palette */
        }
        const entries = (brand.palette || []).filter((entry) => /^#[0-9a-f]{6}$/i.test(entry.hex || ''));
        const ground = entries[0] || { hex: '#17162e' };
        const ink = entries
            .filter((entry) => entry.hex !== ground.hex)
            .sort((a, b) => window.StudioBrand.contrastRatio(b.hex, ground.hex) - window.StudioBrand.contrastRatio(a.hex, ground.hex))[0]
            || { hex: '#ffffff' };
        const accent = entries.find((entry) => entry.hex !== ground.hex && entry.hex !== ink.hex) || { hex: '#eb5b3c' };
        return { ground, ink, accent };
    };

    const fontFamilies = (brand) => {
        const families = new Set();
        (brand?.typography?.families || []).forEach((family) => families.add(family));
        (brand?.typography?.scale || []).forEach((entry) => entry.family && families.add(entry.family));
        try {
            const kit = window.StudioBrand.brandKitFor(brand);
            (kit?.fonts || []).forEach((font) => font.family && families.add(font.family));
        } catch {
            /* no kit is fine */
        }
        return [...families]
            .filter((family) => family && !/wordmark|artwork|logo/i.test(family))
            .slice(0, 14);
    };

    const normalizeFamilyName = (family) => String(family || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\b(?:400|300|200|500|600|700|800|900|regular|light|bold|italic|variable|var|uppercase)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const isUploadedFamily = (family) => state.uploadedFonts.some(
        (font) => normalizeFamilyName(font.family) === normalizeFamilyName(family),
    );

    const stackSuffix = (family) => {
        const name = String(family || '').toLowerCase();
        if (name.includes('fallback') && name.includes('serif')) return 'Georgia, "Times New Roman", serif';
        if (name.includes('fallback') && name.includes('sans')) return '"Helvetica Neue", Helvetica, Arial, sans-serif';
        if (/georgia|times|serif|cinzel|palatino|baskerville|garamond|caslon|didot|bodoni|script|adamson|playfair|alegreya|im fell|primer|caprasimo/i.test(name)) {
            return 'Georgia, "Times New Roman", serif';
        }
        if (/courier|mono|typewriter/i.test(name)) return '"Courier New", Courier, monospace';
        return '"Helvetica Neue", Helvetica, Arial, sans-serif';
    };

    const fontStackFor = (family) => {
        const uploaded = state.uploadedFonts.find(
            (font) => normalizeFamilyName(font.family) === normalizeFamilyName(family),
        );
        if (uploaded) return `"${uploaded.family}", ${stackSuffix(family)}`;
        if (/fallback/i.test(String(family))) return stackSuffix(family);
        if (window.StudioBrand.isSystemFamily?.(family)) {
            if (/georgia/i.test(family)) return 'Georgia, "Times New Roman", serif';
            if (/times/i.test(family)) return '"Times New Roman", Times, serif';
            if (/palatino/i.test(family)) return '"Palatino Linotype", Palatino, "Book Antiqua", serif';
            if (/courier/i.test(family)) return '"Courier New", Courier, monospace';
            if (/helvetica/i.test(family)) return '"Helvetica Neue", Helvetica, Arial, sans-serif';
            if (/arial/i.test(family)) return 'Arial, Helvetica, sans-serif';
            return `"${family}", ${stackSuffix(family)}`;
        }
        return stackSuffix(family);
    };

    const defaultFontsForBrand = (brand) => {
        const roles = BRAND_FONT_ROLES[brand.id];
        if (roles) {
            const display = fontStackFor(roles.display);
            const body = fontStackFor(roles.body);
            return { display, serif: body, sans: body };
        }
        const families = fontFamilies(brand);
        // Prefer any uploaded family the brand actually uses. Duck Bay lists
        // "Bright Gesture / Georgia" first even though Mulish is the web face.
        const uploaded = families.find((family) => isUploadedFamily(family));
        if (uploaded) {
            const bodyFamily = families.find((family) => family !== uploaded && isUploadedFamily(family)) || uploaded;
            const display = fontStackFor(uploaded);
            const body = fontStackFor(bodyFamily);
            return { display, serif: body, sans: body };
        }
        const first = families[0];
        if (first && window.StudioBrand.isSystemFamily?.(first)) {
            const display = fontStackFor(first);
            const body = fontStackFor(families[1] || first);
            return { display, serif: body, sans: body };
        }
        const stacks = families.map(fontStackFor);
        const serif = stacks.find((stack) => /Georgia|Times|Palatino|Baskerville|Didot|Copperplate/i.test(stack))
            || 'Georgia, "Times New Roman", serif';
        const sans = stacks.find((stack) => /Helvetica|Arial|sans-serif/i.test(stack))
            || '"Helvetica Neue", Helvetica, Arial, sans-serif';
        return { display: serif, serif, sans };
    };

    const brandify = (value) => {
        if (typeof value !== 'string') return value;
        const brand = state.brand;
        if (!brand) return value;
        // Empty, never another venue's details: if this brand has no recorded
        // contact value the placeholder is cleared rather than left as someone
        // else's address.
        const address = contactValue('Address') || '';
        const phone = contactValue('Telephone') || '';
        const email = contactValue('Email') || '';
        const instagram = contactValue('Instagram') || '';
        const site = website();
        const tagline = brand.tagline || '';
        let result = value
            .replace(/the adamson\s*\|\s*THE PHYSICIAN/gi, brand.name)
            .replace(/THE PHYSICIAN/g, brand.name.toUpperCase())
            .replace(/The Physician/g, brand.name)
            .replace(/the physician/gi, brand.name)
            .replace(/www\.thephysician\.bar/gi, site)
            .replace(/www\.theadamson\.com/gi, site)
            .replace(/www\.hatchstandrews\.com/gi, site)
            .replace(/@thephysician_standrews/gi, instagram)
            .replace(/@theadamsonstandrews/gi, instagram)
            .replace(/@hatch_standrews/gi, instagram);
        // The catalogue writes the placeholder address in several shapes — with
        // and without the postcode, before a middot, at the end of a line. Match
        // the street, not one exact string, or a shorter variant survives into
        // the artwork.
        if (!address || !result.includes(address)) {
            result = result.replace(/12[79] South Street, St Andrews(?:,?\s*KY16\s*9UH)?/gi, address);
        }
        return result
            .replace(/reservations@theadamson\.com/gi, email)
            .replace(/reservations@hatchstandrews\.com/gi, email)
            .replace(/01334\s*479191/g, phone)
            .replace(/01334\s*475\s*557/g, phone)
            .replace(/Find your cure\./gi, tagline)
            // More catalogue copy that belongs to a specific venue: a tagline and
            // a fake company number. Both would survive into a real document.
            .replace(/Scottish produce, warm welcome/gi, tagline)
            .replace(/Registered in Scotland\s*·\s*Company no\.?\s*SC0+/gi, '')
            .replace(/\s*·\s*·\s*/g, ' · ')
            .replace(/^\s*·\s*/, '')
            .replace(/\s*·\s*$/, '')
            .replace(/(,\s*GB)(,\s*GB)+/gi, ', GB');
    };

    const applyTheme = () => {
        const accent = state.pal.accent;
        document.documentElement.style.setProperty('--brand', accent);
        document.documentElement.style.setProperty('--brand-ink', luma(accent) > 0.62 ? '#1a1a2e' : '#ffffff');
    };

    const applyBrandPalette = () => {
        const roles = brandRolesFor(state.brand, state.categoryId);
        state.pal = {
            paper: roles.ground.hex,
            ink: roles.ink.hex,
            accent: roles.accent.hex,
        };
        applyTheme();
    };

    const trimLogo = (image) => {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (!width || !height) return image;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;
        try {
            const data = context.getImageData(0, 0, width, height).data;
            for (let y = 0; y < height; y += 1) {
                for (let x = 0; x < width; x += 1) {
                    if (data[(y * width + x) * 4 + 3] <= 8) continue;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        } catch {
            return canvas;
        }
        if (maxX < minX || maxY < minY) return canvas;
        const cropped = document.createElement('canvas');
        cropped.width = maxX - minX + 1;
        cropped.height = maxY - minY + 1;
        cropped.getContext('2d').drawImage(
            canvas,
            minX, minY, cropped.width, cropped.height,
            0, 0, cropped.width, cropped.height,
        );
        return cropped;
    };

    const tintLogoDataUrl = (image, color) => {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        context.globalCompositeOperation = 'source-in';
        context.fillStyle = color;
        context.fillRect(0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
    };

    const loadBrandMedia = async (brand) => {
        if (brand._media) return brand._media;
        const logos = brand.logos || [];
        const isPlate = (logo) => /plate|presentation/i.test(logo?.name || '');
        // Only a real wordmark belongs in the design logo slot. A mark or a
        // presentation plate would be cropped into a wordmark-shaped hole; the
        // typographic fallback in the engine is cleaner for those brands.
        const wordmark = logos.find((logo) => (logo.kind === 'wordmark' || logo.kind === 'logo') && !isPlate(logo))
            || logos.find((logo) => logo.kind === 'wordmark');
        const mark = logos.find((logo) => logo.kind === 'mark' && !isPlate(logo)) || null;
        const load = (logo) => (logo?.url ? loadImage(logo.url).catch(() => null) : Promise.resolve(null));
        const [rawLogo, rawMark] = await Promise.all([load(wordmark), load(mark)]);
        const logoImage = rawLogo ? trimLogo(rawLogo) : null;
        const markImage = rawMark ? trimLogo(rawMark) : null;
        const lightLogoUrl = logoImage ? tintLogoDataUrl(logoImage, '#ffffff') : '';
        const darkLogoUrl = logoImage ? tintLogoDataUrl(logoImage, '#1a1a2e') : '';
        const lightMarkUrl = markImage ? tintLogoDataUrl(markImage, '#ffffff') : '';
        const darkMarkUrl = markImage ? tintLogoDataUrl(markImage, '#1a1a2e') : '';
        const sources = (brand.photography || []).map((photo) => ({
            name: photo.name || 'Photography',
            src: photo.url,
            uploaded: false,
        }));
        const loaded = await Promise.all(sources.map((source) => loadImage(source.src).catch(() => null)));
        const photos = [];
        const photoSources = [];
        loaded.forEach((image, index) => {
            if (!image) return;
            photos.push(image);
            photoSources.push(sources[index]);
        });
        const media = {
            logoImage,
            markImage,
            darkLogoUrl,
            lightLogoUrl,
            darkMarkUrl,
            lightMarkUrl,
            photos,
            sources: photoSources,
        };
        brand._media = media;
        return media;
    };

    // ─── session + saved assets ──────────────────────────────────────

    const readSession = () => {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    };

    const readLastBrands = () => {
        try {
            const raw = localStorage.getItem(LAST_BRANDS_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    };

    const writeLastBrand = (packId, brandId) => {
        if (!packId || !brandId) return;
        try {
            const map = readLastBrands();
            map[packId] = brandId;
            localStorage.setItem(LAST_BRANDS_KEY, JSON.stringify(map));
        } catch {
            /* storage is optional */
        }
    };

    const queueSession = () => {
        if (!state.brand) return;
        window.clearTimeout(sessionTimer);
        sessionTimer = window.setTimeout(persistSession, 280);
    };

    const persistSession = () => {
        if (!state.brand) return;
        const payload = {
            packId: state.pack?.id || null,
            packId: state.pack?.id || null,
            brandId: state.brand.id,
            categoryId: state.categoryId,
            templateIndex: state.templateIndex,
            sizeIndex: state.sizeIndex,
            slideIndex: state.slideIndex,
            pal: state.pal,
            fonts: state.fonts,
            motif: state.motif,
            motifOn: state.motifOn !== false,
            motifScale: state.motifScale,
            motifX: state.motifX,
            motifY: state.motifY,
            logoOn: state.logoOn !== false,
            logoScale: state.logoScale,
            logoX: state.logoX,
            logoY: state.logoY,
            qr: state.qr,
            text: state.text,
            photoIndex: state.photoIndex,
        };
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
        } catch {
            /* private mode or a full quota — the editor still works */
        }
    };

    const loadSaved = () => {
        try {
            const raw = localStorage.getItem(SAVED_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            state.saved = Array.isArray(parsed) ? parsed.slice(0, SAVED_LIMIT) : [];
        } catch {
            state.saved = [];
        }
    };

    const persistSaved = () => {
        try {
            localStorage.setItem(SAVED_KEY, JSON.stringify(state.saved));
            return true;
        } catch {
            return false;
        }
    };

    // ─── boot ────────────────────────────────────────────────────────

    const cacheDom = () => {
        [
            'boot', 'studio', 'groupSelect', 'topbarHint', 'brandSwitch', 'brandInfoBtn',
            'categoryNav', 'designMeta', 'designGrid', 'controlTabs', 'controlBody',
            'previewBrand', 'previewTitle', 'previewFormat', 'previewSize', 'previewCanvas',
            'downloadBtn', 'printBtn', 'saveBtn', 'exportNote', 'brandGate', 'gateClose',
            'gateGrid', 'gateError', 'gatePortfolio', 'gateGroups', 'brandDrawer', 'drawerBackdrop',
            'drawerBody', 'drawerTitle', 'drawerClose', 'toast', 'photoInput', 'fontInput',
            'printPackBtn', 'printDialog', 'printBackdrop', 'printClose', 'printBleed',
            'printSafe', 'printMarks', 'printDpi', 'printMeta', 'printPageCount',
            'printPreview', 'printReport', 'printDownload', 'printCancel', 'printStatus',
            'jpgBtn', 'slideNav', 'slidePrev', 'slideLabel', 'slideNext', 'slideDownload',
        ].forEach((id) => { el[id] = document.getElementById(id); });
    };

    const bindEvents = () => {
        el.downloadBtn.addEventListener('click', downloadAsset);
        el.jpgBtn.addEventListener('click', downloadJpg);
        el.slidePrev.addEventListener('click', () => goToSlide(-1));
        el.slideNext.addEventListener('click', () => goToSlide(1));
        el.slideDownload.addEventListener('click', downloadSlides);
        el.printBtn.addEventListener('click', printAsset);
        el.saveBtn.addEventListener('click', saveAsset);
        el.groupSelect.addEventListener('change', () => activatePack(el.groupSelect.value, { autoSelect: true }));
        el.brandInfoBtn.addEventListener('click', openDrawer);
        el.drawerClose.addEventListener('click', closeDrawer);
        el.drawerBackdrop.addEventListener('click', closeDrawer);
        el.gateClose.addEventListener('click', () => { if (state.brand) hideGate(); });
        el.photoInput.addEventListener('change', () => uploadPhoto(el.photoInput.files?.[0]));
        el.fontInput.addEventListener('change', () => uploadFont(el.fontInput.files?.[0]));
        el.printPackBtn.addEventListener('click', openPrintDialog);
        el.printClose.addEventListener('click', closePrintDialog);
        el.printCancel.addEventListener('click', closePrintDialog);
        el.printBackdrop.addEventListener('click', closePrintDialog);
        ['printBleed', 'printSafe', 'printDpi', 'printMarks'].forEach((id) => {
            el[id].addEventListener('change', () => {
                updatePrintOptions();
                refreshPrintPreview();
            });
        });
        el.printDownload.addEventListener('click', downloadPrintPack);
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (!el.printDialog.hidden) {
                closePrintDialog();
                return;
            }
            if (!el.brandDrawer.hidden) {
                closeDrawer();
                return;
            }
            if (!el.brandGate.hidden && state.brand) hideGate();
        });
        window.addEventListener('beforeunload', persistSession);
    };

    const boot = async () => {
        cacheDom();
        bindEvents();
        bindCanvasDrag();
        bindZoom();
        loadSaved();
        el.boot.hidden = false;
        try {
            await Promise.all([loadPackSummaries(), loadFonts()]);
            const packs = state.packs;
            if (!packs.length) throw new Error('No brand packs are available.');
            const session = readSession();
            const sessionPack = session?.brandId ? packSummaryForBrand(session.brandId) : null;
            const savedPackId = localStorage.getItem('assetStudio.packId');
            const params = new URLSearchParams(location.search);
            const requestedPackId = params.get('pack');
            const requestedBrandId = params.get('brand') || params.get('brandId');
            const requestedPack = requestedPackId && packs.some((pack) => pack.id === requestedPackId)
                ? requestedPackId
                : null;
            const requestedBrandPack = requestedBrandId ? packSummaryForBrand(requestedBrandId) : null;
            const brandIsInRequestedPack = Boolean(requestedBrandId && requestedBrandPack
                && (requestedBrandPack.brands || []).some((brand) => brand.id === requestedBrandId));
            // The gate is the entry point: a plain visit never resumes a brand
            // by itself. Only an explicit deep link (?brand=/?brandId=, or a
            // one-brand ?pack=) opens the workspace straight away.
            const packId = (brandIsInRequestedPack ? requestedBrandPack.id : null)
                || requestedPack
                || sessionPack?.id
                || (session?.packId && packs.some((pack) => pack.id === session.packId) ? session.packId : null)
                || (packs.some((pack) => pack.id === savedPackId) ? savedPackId : packs[0].id);
            const pack = await loadPackData(packId);
            setActivePack(pack);
            await preloadPackMedia();
            renderGroupSelect();
            buildBrandSwitch();
            buildGate();
            const deepBrand = requestedBrandId && state.brands.some((brand) => brand.id === requestedBrandId)
                ? requestedBrandId
                : null;
            if (deepBrand) {
                await selectBrand(deepBrand, { restoreSession: true, session });
            } else if (requestedPack === pack.id && state.brands.length === 1) {
                await selectBrand(state.brands[0].id, { restoreSession: true, session });
            } else {
                showGate();
            }
        } catch (error) {
            showBootError(error);
        }
    };

    const loadPackSummaries = async () => {
        const data = await fetchJson(`${API}/brand-packs`);
        const packs = Array.isArray(data?.packs) ? data.packs : [];
        if (!packs.length) throw new Error('No brand packs are available.');
        state.packs = packs;
        return packs;
    };

    const loadPackData = async (packId) => {
        if (!packId) throw new Error('No brand group selected.');
        if (packCache.has(packId)) return packCache.get(packId);
        const payload = await fetchJson(`${API}/brand-packs/${encodeURIComponent(packId)}`);
        const pack = payload?.pack || null;
        if (!pack?.brands?.length) throw new Error('The brand group contains no brands.');
        packCache.set(packId, pack);
        return pack;
    };

    const setActivePack = (pack) => {
        state.pack = pack;
        state.brands = Array.isArray(pack?.brands) ? pack.brands : [];
        try {
            localStorage.setItem('assetStudio.packId', pack?.id || '');
        } catch {
            /* storage is optional */
        }
    };

    const preloadPackMedia = async () => {
        await Promise.all(state.brands.map((brand) => loadBrandMedia(brand).catch(() => null)));
    };

    const packSummaryForBrand = (brandId) => {
        if (!brandId) return null;
        const summary = state.packs.find((pack) => (pack.brands || []).some((brand) => brand.id === brandId));
        if (summary) return summary;
        for (const pack of packCache.values()) {
            if ((pack.brands || []).some((brand) => brand.id === brandId)) {
                return state.packs.find((entry) => entry.id === pack.id) || { id: pack.id, name: pack.name, brands: pack.brands };
            }
        }
        return null;
    };

    const loadFonts = async () => {
        try {
            const data = await fetchJson(`${API}/fonts`);
            const fonts = Array.isArray(data?.fonts) ? data.fonts : [];
            for (const font of fonts) {
                if (await registerFont(font)) state.uploadedFonts.push(font);
            }
        } catch {
            /* fonts are optional */
        }
    };

    const registerFont = async (font) => {
        if (!font?.family || !font?.url) return false;
        try {
            const face = new FontFace(font.family, `url("${font.url}")`, { weight: '100 1000' });
            await face.load();
            document.fonts.add(face);
            return true;
        } catch {
            return false;
        }
    };

    const showBootError = (error) => {
        el.studio.hidden = true;
        el.brandGate.hidden = true;
        el.boot.hidden = false;
        clear(el.boot);
        el.boot.append(make('div', 'boot-mark', '!'));
        const copy = make('p');
        copy.append(make('strong', null, 'Asset Studio could not open.'));
        const message = String(error?.message || 'The studio could not load.');
        copy.append(document.createElement('br'), document.createTextNode(
            /brand pack/i.test(message)
                ? 'No brand packs are available yet. Import a brand-kit ZIP in Studio V2 → Brand identity, then reload this page.'
                : /fetch|network|failed/i.test(message)
                    ? 'Start the local studio server with `node server.js`, then open http://127.0.0.1:8008/asset-studio.html.'
                    : message,
        ));
        el.boot.append(copy);
        const retry = button('Reload', 'btn', () => window.location.reload());
        const link = document.createElement('a');
        link.className = 'btn';
        link.href = 'studio-v2.html';
        link.textContent = 'Open Studio V2';
        const actions = make('div', 'button-row');
        actions.style.justifyContent = 'center';
        actions.append(retry, link);
        el.boot.append(actions);
    };

    const showStudio = () => {
        el.boot.hidden = true;
        el.studio.hidden = false;
    };

    const showGate = () => {
        el.boot.hidden = true;
        if (!state.brands.length) {
            showBootError(new Error('No brand packs are available.'));
            return;
        }
        renderGateGroups();
        el.gatePortfolio.textContent = state.pack?.name || 'Brand portfolio';
        el.gateClose.hidden = !state.brand;
        el.brandGate.hidden = false;
        document.body.style.overflow = 'hidden';
    };

    const hideGate = () => {
        el.brandGate.hidden = true;
        document.body.style.overflow = '';
    };

    const renderGroupSelect = () => {
        if (!el.groupSelect) return;
        const current = state.pack?.id || '';
        clear(el.groupSelect);
        state.packs.forEach((pack) => {
            const option = document.createElement('option');
            option.value = pack.id;
            option.textContent = pack.name;
            if (pack.id === current) option.selected = true;
            el.groupSelect.append(option);
        });
        el.groupSelect.value = current;
        el.groupSelect.disabled = state.loadingPack || state.packs.length < 2;
        el.groupSelect.hidden = state.packs.length < 2;
    };

    const renderGateGroups = () => {
        clear(el.gateGroups);
        if (state.packs.length <= 1) {
            el.gateGroups.hidden = true;
            return;
        }
        el.gateGroups.hidden = false;
        state.packs.forEach((pack) => {
            const tab = button(pack.name, 'group-tab', () => {
                if (pack.id !== state.pack?.id) activatePack(pack.id, { autoSelect: false });
            });
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(pack.id === state.pack?.id));
            tab.disabled = state.loadingPack;
            el.gateGroups.append(tab);
        });
    };

    const buildBrandSwitch = () => {
        clear(el.brandSwitch);
        state.brands.forEach((brand) => {
            const item = button(null, null, () => selectBrand(brand.id));
            item.setAttribute('aria-pressed', String(state.brand?.id === brand.id));
            const dot = make('i', 'brand-dot');
            dot.style.setProperty('--dot', brand.palette?.[1]?.hex || brand.palette?.[0]?.hex || '#eb5b3c');
            item.append(dot, document.createTextNode(brand.name));
            el.brandSwitch.append(item);
        });
    };

    const flatCoverColor = (brand) => {
        const entries = (brand.palette || []).filter((entry) => /^#[0-9a-f]{6}$/i.test(entry.hex || ''));
        const chosen = entries.find((entry) => {
            try {
                return window.StudioBrand.contrastRatio(entry.hex, '#ffffff') >= 4.5;
            } catch {
                return false;
            }
        });
        return chosen?.hex || '#111827';
    };

    const buildGate = () => {
        renderGateGroups();
        el.gatePortfolio.textContent = state.pack?.name || 'Brand portfolio';
        clear(el.gateGrid);
        state.brands.forEach((brand) => {
            const card = button(null, 'gate-card', () => chooseBrand(brand.id));
            const cover = make('div', 'gate-cover');
            const photoUrl = brand.photography?.[0]?.url || '';
            const hasPhoto = Boolean(photoUrl);
            if (hasPhoto) {
                const image = document.createElement('img');
                image.src = photoUrl;
                image.alt = '';
                image.loading = 'lazy';
                image.decoding = 'async';
                cover.append(image);
            } else {
                // Software and other brands may have no photography. Use a
                // flat brand-colour tile with the wordmark rather than the
                // brand-guide cover (which is full of document furniture).
                cover.classList.add('flat');
                cover.style.background = flatCoverColor(brand);
            }
            const logoUrl = brand._media?.lightLogoUrl || brand._media?.lightMarkUrl || brand._media?.darkLogoUrl || brand._media?.darkMarkUrl || '';
            if (logoUrl) {
                const logo = document.createElement('img');
                logo.className = hasPhoto ? 'gate-logo' : 'gate-logo gate-logo-large';
                logo.src = logoUrl;
                logo.alt = `${brand.name} logo`;
                logo.loading = 'lazy';
                cover.append(logo);
            } else if (!hasPhoto) {
                cover.append(make('span', 'gate-wordmark', brand.wordmark || brand.name));
            }
            const body = make('div', 'gate-card-body');
            body.append(make('h3', null, brand.name));
            body.append(make('p', null, brand.tagline || brand.guidelines?.positioning || 'Brand identity'));
            const strip = make('div', 'palette-strip');
            (brand.palette || []).slice(0, 7).forEach((entry) => {
                const swatch = document.createElement('i');
                swatch.style.setProperty('--swatch', entry.hex);
                strip.append(swatch);
            });
            body.append(strip);
            const open = make('span', 'gate-open');
            open.append(document.createTextNode('Open studio'), make('span', null, '→'));
            body.append(open);
            card.append(cover, body);
            el.gateGrid.append(card);
        });
    };

    const activatePack = async (packId, options = {}) => {
        if (!packId || state.loadingPack) return;
        if (state.pack?.id === packId) {
            if (options.autoSelect && !state.brand) {
                const last = readLastBrands()[packId];
                const brandId = last && state.brands.some((brand) => brand.id === last)
                    ? last
                    : state.brands[0]?.id;
                if (brandId) await selectBrand(brandId);
            }
            return;
        }
        const summary = state.packs.find((pack) => pack.id === packId);
        if (!summary) return;
        state.loadingPack = true;
        el.groupSelect.disabled = true;
        renderGateGroups();
        const gateWasOpen = !el.brandGate.hidden;
        if (gateWasOpen) {
            clear(el.gateGrid);
            el.gateGrid.append(make('p', 'empty-note', `Loading ${summary.name}…`));
        }
        try {
            const pack = await loadPackData(packId);
            setActivePack(pack);
            await preloadPackMedia();
            buildBrandSwitch();
            buildGate();
            if (options.autoSelect) {
                const last = readLastBrands()[packId];
                const preferred = options.preferredBrandId && state.brands.some((brand) => brand.id === options.preferredBrandId)
                    ? options.preferredBrandId
                    : (last && state.brands.some((brand) => brand.id === last) ? last : state.brands[0]?.id);
                state.brand = null;
                if (preferred) await selectBrand(preferred);
            } else {
                state.brand = null;
                buildGate();
                showGate();
            }
            toast(`Switched to ${pack.name}.`);
        } catch (error) {
            toast(`Could not switch group: ${error.message}`, true);
            if (gateWasOpen) {
                buildGate();
                showGate();
            }
        } finally {
            state.loadingPack = false;
            renderGroupSelect();
            renderGateGroups();
            el.groupSelect.disabled = state.packs.length < 2;
        }
    };

    const chooseBrand = async (brandId) => {
        if (state.brand?.id === brandId) {
            hideGate();
            return;
        }
        // Picking the brand you were last working on resumes that edit; picking
        // another one starts clean. The gate still comes first on every load.
        const session = readSession();
        await selectBrand(brandId, { restoreSession: true, session });
    };

    const selectBrand = async (brandId, options = {}) => {
        const brand = state.brands.find((item) => item.id === brandId);
        if (!brand) return;
        state.brand = brand;
        const session = options.session || null;
        const restore = Boolean(options.restoreSession && session && session.brandId === brand.id);
        state.categoryId = restore && window.AssetCategories[session.categoryId]
            ? session.categoryId
            : (window.AssetCategories[state.categoryId] ? state.categoryId : 'flyer');
        const media = await loadBrandMedia(brand);
        state.logoWordmark = media.designLogo || media.logoImage;
        state.logoMark = media.logoImage ? media.markImage : null;
        // Brand-specific optical correction for the logo slot; the logo panel
        // starts from it and the reset button returns to it.
        state.logoBaseScale = { 'food-safe-system': 1.8, 'food-label-system': 1.35, allerq: 1.2, 'kitchen-os': 1.15, okja: 1.4 }[brand.id] || 1;
        state.logoScale = state.logoBaseScale;
        state.logoOn = true;
        state.logoX = 0;
        state.logoY = 0;
        state.photos = [...media.photos];
        state.photoSources = media.sources.map((source) => ({ ...source }));
        state.photoIndex = 0;
        state.qr = '';
        state.libraryAssets = [];
        state.libraryRows = [];
        state.libraryLoadedBrand = '';
        libraryCache.clear();
        loadLibraryForBrand(brand);
        state.fonts = defaultFontsForBrand(brand);
        applyBrandPalette();

        const category = currentCategory();
        let templateIndex = 0;
        let sizeIndex = 0;
        if (restore) {
            if (Number.isInteger(session.templateIndex)
                && session.templateIndex >= 0
                && session.templateIndex < category.tpls.length) templateIndex = session.templateIndex;
        }
        state.templateIndex = templateIndex;
        state.sizeIndex = 0;
        const restoredSizes = sizesForTemplate(category.tpls[templateIndex], category);
        if (restore && Number.isInteger(session.sizeIndex)
            && session.sizeIndex >= 0
            && session.sizeIndex < restoredSizes.length) sizeIndex = session.sizeIndex;
        state.sizeIndex = sizeIndex;
        state.slideIndex = 0;
        state.motif = defaultMotifForBrand(brand, category.tpls[templateIndex]);
        resetMotifPlacement();
        state.text = categoryDefaultText(category.tpls[templateIndex], templateIndex);
        if (restore) applySessionOverrides(session);
        writeLastBrand(state.pack?.id, brand.id);
        clearZoom();
        hideGate();
        showStudio();
        renderWorkspace();
        queueSession();
    };

    const applySessionOverrides = (session) => {
        if (session.pal && ['paper', 'ink', 'accent'].every((role) => /^#[0-9a-f]{6}$/i.test(session.pal[role] || ''))) {
            state.pal = { ...state.pal, ...session.pal };
        }
        if (session.fonts && ['display', 'serif', 'sans'].every((role) => typeof session.fonts[role] === 'string')) {
            state.fonts = { ...session.fonts };
        }
        if (session.text && typeof session.text === 'object') state.text = { ...session.text };
        if (Number.isInteger(session.slideIndex)) state.slideIndex = session.slideIndex;
        if (typeof session.qr === 'string') state.qr = session.qr;
        if (session.motif && (session.motif === 'auto' || MOTIF_LABELS[session.motif])) {
            state.motif = BRAND_COPY[state.brand?.id] && session.motif === 'auto'
                ? defaultMotifForBrand(state.brand, currentTemplate())
                : session.motif;
        }
        if (typeof session.motifOn === 'boolean') state.motifOn = session.motifOn;
        if (Number.isFinite(Number(session.motifScale))) state.motifScale = clampMotifScale(session.motifScale);
        if (Number.isFinite(Number(session.motifX))) state.motifX = clampMotifOffset(session.motifX);
        if (Number.isFinite(Number(session.motifY))) state.motifY = clampMotifOffset(session.motifY);
        if (typeof session.logoOn === 'boolean') state.logoOn = session.logoOn;
        if (Number.isFinite(Number(session.logoScale))) state.logoScale = clampLogoScale(session.logoScale);
        if (Number.isFinite(Number(session.logoX))) state.logoX = clampMotifOffset(session.logoX);
        if (Number.isFinite(Number(session.logoY))) state.logoY = clampMotifOffset(session.logoY);
        if (Number.isInteger(session.photoIndex) && session.photoIndex >= 0 && session.photoIndex < state.photos.length) {
            state.photoIndex = session.photoIndex;
        }
        applyTheme();
    };

    // ─── category / template / size selection ───────────────────────

    const selectCategory = (categoryId) => {
        if (!window.AssetCategories[categoryId]) return;
        if (state.categoryId === categoryId && state.brand) return;
        state.categoryId = categoryId;
        state.templateIndex = 0;
        state.sizeIndex = 0;
        state.slideIndex = 0;
        state.qr = '';
        applyBrandPalette();
        const category = currentCategory();
        state.motif = defaultMotifForBrand(state.brand, category.tpls[0]);
        resetMotifPlacement();
        resetLogoPlacement();
        state.text = categoryDefaultText(category.tpls[0], 0);
        clearZoom();
        renderWorkspace();
    };

    const selectTemplate = (index) => {
        const category = currentCategory();
        if (!category?.tpls[index]) return;
        state.templateIndex = index;
        state.sizeIndex = 0;
        state.slideIndex = 0;
        state.motif = defaultMotifForBrand(state.brand, category.tpls[index]);
        resetMotifPlacement();
        resetLogoPlacement();
        state.text = categoryDefaultText(category.tpls[index], index);
        clearZoom();
        renderWorkspace();
    };

    const selectSize = (index) => {
        if (!sizesForTemplate()[index]) return;
        state.sizeIndex = index;
        clearZoom();
        document.querySelectorAll('[data-size-index]').forEach((node) => {
            node.setAttribute('aria-pressed', String(Number(node.dataset.sizeIndex) === index));
        });
        renderHeader();
        renderPreview();
        queueSession();
    };

    // ─── rendering ───────────────────────────────────────────────────

    const renderWorkspace = () => {
        if (!state.brand) return;
        applyTheme();
        renderGroupSelect();
        renderBrandSwitch();
        renderCategoryNav();
        renderDesignGrid();
        renderControlTabs();
        renderHeader();
        renderPreview();
        queueSession();
    };

    const renderCategoryNav = () => {
        clear(el.categoryNav);
        Object.keys(window.AssetCategories).forEach((id) => {
            const category = window.AssetCategories[id];
            const tab = button(null, 'category-tab', () => selectCategory(id));
            tab.setAttribute('aria-selected', String(id === state.categoryId));
            tab.append(make('b', null, categoryLabel(id)), make('small', null, `${category.tpls.length} designs`));
            el.categoryNav.append(tab);
        });
    };

    const renderDesignGrid = () => {
        const category = currentCategory();
        clear(el.designGrid);
        el.designMeta.textContent = `${state.templateIndex + 1} of ${category.tpls.length}`;
        category.tpls.forEach((template, index) => {
            const tile = button(null, 'design-tile', () => selectTemplate(index));
            tile.setAttribute('aria-pressed', String(index === state.templateIndex));
            const thumb = make('div', 'design-thumb');
            thumb.append(document.createElement('canvas'));
            const label = make('span', null, template.n);
            tile.append(thumb, label);
            el.designGrid.append(tile);
        });
        renderDesignThumbnails();
    };

    const renderDesignThumbnails = () => {
        const category = currentCategory();
        [...el.designGrid.querySelectorAll('.design-tile')].forEach((tile, index) => {
            const canvas = tile.querySelector('canvas');
            const template = category.tpls[index];
            const sizes = sizesForTemplate(template, category);
            const thumbSize = sizes[category.thumb != null ? category.thumb : 0] || sizes[0];
            if (!thumbSize) return;
            const text = index === state.templateIndex ? state.text : categoryDefaultText(template, index);
            const targetWidth = Math.min(THUMB_WIDTH * 2, Math.round(292 * (thumbSize.w / thumbSize.h)));
            try {
                const thumbState = buildRenderState(text);
                thumbState.slideIndex = 0;
                window.AssetEngine.render(canvas, thumbSize, template, thumbState, targetWidth);
            } catch {
                /* a broken preview must not stop the editor */
            }
        });
    };

    const renderControlTabs = () => {
        clear(el.controlTabs);
        CONTROLS.forEach(([id, label]) => {
            const count = id === 'saved' && state.saved.length ? ` (${state.saved.length})` : '';
            const tab = button(`${label}${count}`, 'control-tab', () => setActiveTab(id));
            tab.id = `control-tab-${id}`;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(state.activeTab === id));
            tab.setAttribute('aria-controls', 'controlBody');
            el.controlTabs.append(tab);
        });
        renderControlBody();
    };

    const setActiveTab = (id) => {
        state.activeTab = id;
        [...el.controlTabs.children].forEach((tab) => {
            tab.setAttribute('aria-selected', String(tab.id === `control-tab-${id}`));
        });
        renderControlBody();
    };

    const renderControlBody = () => {
        clear(el.controlBody);
        if (state.activeTab === 'colours') renderColoursPanel();
        else if (state.activeTab === 'type') renderTypePanel();
        else if (state.activeTab === 'image') renderImagePanel();
        else if (state.activeTab === 'motif') renderMotifPanel();
        else if (state.activeTab === 'logo') renderLogoPanel();
        else if (state.activeTab === 'text') renderTextPanel();
        else if (state.activeTab === 'size') renderSizePanel();
        else if (state.activeTab === 'saved') renderSavedPanel();
        else renderColoursPanel();
    };

    const renderColoursPanel = () => {
        el.controlBody.append(make('p', 'control-note',
            `Brand palette from ${state.brand.name}. Choose a swatch by name or pick a custom colour; the design updates live.`));

        const roles = brandRolesFor(state.brand, state.categoryId);
        const brandSets = [
            ['Brand', { paper: roles.ground.hex, ink: roles.ink.hex, accent: roles.accent.hex }],
            ['Inverted', { paper: state.pal.ink, ink: state.pal.paper, accent: state.pal.accent }],
            ['Light', { paper: '#ffffff', ink: state.pal.ink, accent: state.pal.accent }],
            ['Dark', { paper: state.pal.ink, ink: '#ffffff', accent: state.pal.accent }],
        ];

        const presets = make('div', 'preset-row');
        brandSets.forEach(([label, palette]) => {
            const preset = button(null, 'preset', () => {
                state.pal = { ...palette };
                applyTheme();
                renderControlBody();
                schedulePreviewAndThumbs();
                queueSession();
            });
            preset.setAttribute('aria-label', `${label} palette`);
            const one = document.createElement('i');
            one.style.setProperty('--p', palette.paper);
            const two = document.createElement('i');
            two.style.setProperty('--i', palette.ink);
            const three = document.createElement('i');
            three.style.setProperty('--a', palette.accent);
            preset.append(one, two, three, make('span', null, label));
            presets.append(preset);
        });
        el.controlBody.append(presets);

        const palette = state.brand.palette || [];
        [['paper', 'Background'], ['ink', 'Text'], ['accent', 'Accent']].forEach(([role, label]) => {
            const roleLabel = make('div', 'role-label');
            roleLabel.append(make('span', null, label), make('em', null, state.pal[role].toUpperCase()));
            el.controlBody.append(roleLabel);

            const row = make('div', 'color-row');
            const color = document.createElement('input');
            color.type = 'color';
            color.value = state.pal[role];
            color.setAttribute('aria-label', `${label} colour`);
            const select = document.createElement('select');
            select.setAttribute('aria-label', `Choose a brand colour for ${label.toLowerCase()}`);
            const custom = document.createElement('option');
            custom.value = 'custom';
            custom.textContent = 'Custom colour…';
            select.append(custom);
            palette.forEach((entry) => {
                const option = document.createElement('option');
                option.value = entry.hex;
                option.textContent = `${entry.name} · ${entry.hex}`;
                select.append(option);
            });
            select.value = palette.some((entry) => entry.hex === state.pal[role]) ? state.pal[role] : 'custom';

            color.addEventListener('input', () => {
                state.pal[role] = color.value;
                roleLabel.querySelector('em').textContent = color.value.toUpperCase();
                select.value = palette.some((entry) => entry.hex === color.value) ? color.value : 'custom';
                applyTheme();
                schedulePreviewAndThumbs();
                queueSession();
            });
            select.addEventListener('change', () => {
                if (select.value === 'custom') return;
                state.pal[role] = select.value;
                color.value = select.value;
                roleLabel.querySelector('em').textContent = select.value.toUpperCase();
                applyTheme();
                schedulePreviewAndThumbs();
                queueSession();
            });
            row.append(color, select);
            el.controlBody.append(row);
        });

        const actions = make('div', 'button-row');
        actions.append(button('Reset to brand palette', 'btn wide', () => {
            applyBrandPalette();
            state.fonts = defaultFontsForBrand(state.brand);
            renderControlBody();
            schedulePreviewAndThumbs();
            queueSession();
            toast('Brand palette and type restored.');
        }));
        el.controlBody.append(actions);
    };

    const renderTypePanel = () => {
        el.controlBody.append(make('p', 'control-note',
            'Brand families are listed first. Commercial families fall back to the nearest system cut until you upload the licensed file.'));

        [['display', 'Display', 'Headlines and large type'],
         ['serif', 'Editorial', 'Serif text, prices and captions'],
         ['sans', 'Text', 'Sans-serif labels and body copy']].forEach(([role, label, hint]) => {
            const field = make('label', 'field');
            field.append(make('span', null, label));
            const select = document.createElement('select');
            select.setAttribute('aria-label', `${label} font`);
            const current = state.fonts[role];

            const used = new Set();
            const brandFamilies = fontFamilies(state.brand);
            if (brandFamilies.length) {
                const group = document.createElement('optgroup');
                group.label = `${state.brand.name} type`;
                brandFamilies.forEach((family) => {
                    const stack = fontStackFor(family);
                    if (used.has(stack)) return;
                    used.add(stack);
                    const option = document.createElement('option');
                    option.value = stack;
                    option.textContent = isUploadedFamily(family)
                        ? `${family} · uploaded`
                        : `${family} · brand fallback`;
                    group.append(option);
                });
                if (group.children.length) select.append(group);
            }

            const studioGroup = document.createElement('optgroup');
            studioGroup.label = 'Studio fonts';
            STUDIO_FONTS.forEach(([studioLabel, stack]) => {
                if (used.has(stack)) return;
                used.add(stack);
                const option = document.createElement('option');
                option.value = stack;
                option.textContent = studioLabel;
                studioGroup.append(option);
            });
            select.append(studioGroup);

            if (state.uploadedFonts.length) {
                const uploadedGroup = document.createElement('optgroup');
                uploadedGroup.label = 'Uploaded fonts';
                state.uploadedFonts.forEach((font) => {
                    const stack = fontStackFor(font.family);
                    if (used.has(stack)) return;
                    used.add(stack);
                    const option = document.createElement('option');
                    option.value = stack;
                    option.textContent = `${font.family} · uploaded`;
                    uploadedGroup.append(option);
                });
                if (uploadedGroup.children.length) select.append(uploadedGroup);
            }

            if (!used.has(current)) {
                const currentOption = document.createElement('option');
                currentOption.value = current;
                currentOption.textContent = `${current.split(',')[0].replace(/"/g, '')} — current`;
                select.prepend(currentOption);
            }
            select.value = current;
            select.addEventListener('change', () => {
                state.fonts[role] = select.value;
                schedulePreviewAndThumbs();
                queueSession();
            });
            field.append(select, make('small', 'hint', hint));
            el.controlBody.append(field);
        });

        const actions = make('div', 'button-row');
        actions.append(
            button('Upload font', 'btn', () => el.fontInput.click()),
            button('Reset to brand type', 'btn', () => {
                state.fonts = defaultFontsForBrand(state.brand);
                renderControlBody();
                schedulePreviewAndThumbs();
                queueSession();
                toast('Brand type restored.');
            }),
        );
        el.controlBody.append(actions);
        el.controlBody.append(make('p', 'hint',
            'WOFF2, WOFF, TTF or OTF · max 2 MB. Uploaded fonts are stored by the studio backend and become available in every design.'));
    };

    // ─── Business library (BAI) ─────────────────────────────────────
    const loadLibraryForBrand = async (brand) => {
        if (!brand?.id || state.libraryLoadedBrand === brand.id) return;
        state.libraryLoadedBrand = brand.id;
        try {
            const data = await fetchJson(`${API}/assets?brandId=${encodeURIComponent(brand.id)}&limit=100`);
            if (state.brand?.id !== brand.id) return;
            state.libraryAssets = Array.isArray(data?.assets) ? data.assets : [];
            state.libraryAssets.forEach((asset) => libraryCache.set(asset.id, asset));
        } catch {
            state.libraryAssets = [];
        }
        try {
            const docs = await fetchJson(`${API}/assets?brandId=${encodeURIComponent(brand.id)}&class=business-document&limit=20`);
            const rows = [];
            for (const summary of (docs?.assets || [])) {
                if (!summary.extracted?.rows) continue;
                try {
                    const { asset } = await fetchJson(`${API}/assets/${encodeURIComponent(summary.id)}`);
                    if (asset?.extracted?.rows?.length) rows.push(...asset.extracted.rows);
                } catch { /* ignore one bad document */ }
                if (rows.length) break;
            }
            if (state.brand?.id === brand.id) state.libraryRows = rows;
        } catch {
            state.libraryRows = [];
        }
        if (state.brand?.id === brand.id && ['image', 'text'].includes(state.activeTab)) renderControlBody();
    };

    const libraryRecord = (id) => {
        if (!id) return null;
        const cached = libraryCache.get(id);
        if (cached?.identity) return cached;
        const summary = state.libraryAssets.find((asset) => asset.id === id);
        if (!summary) return cached || null;
        return {
            ...summary,
            identity: {
                width: summary.width, height: summary.height, format: summary.format,
                bytes: summary.bytes, palette: [],
            },
            review: { state: summary.state, by: 'library', at: null, note: '' },
            binding: { packId: summary.packId, brandId: summary.brandId, match: 'declared', confidence: 1 },
            source: { kind: 'pack', packId: summary.packId, brandId: summary.brandId, path: '', originName: summary.name },
            status: summary.status || 'active',
            master: summary.master || { isMaster: true, of: null },
            usageLog: { designs: 0, downloads: 0, lastUsedAt: null },
        };
    };

    const activeLibraryAsset = () => {
        const source = state.photoSources[state.photoIndex];
        return source?.assetId ? libraryRecord(source.assetId) : null;
    };

    const exportVerdict = (surface = 'export') => {
        const asset = activeLibraryAsset();
        if (!asset || !window.AssetIntel) return { ok: true, blockers: [], warnings: [] };
        return window.AssetIntel.evaluateUsage([asset], {
            spec: currentPrintSpec() || { w: currentSize().w, h: currentSize().h },
            size: currentSize(),
            profile: currentProfile(),
            surface,
        });
    };

    const recordAssetUsage = (action, extra = {}) => {
        const source = state.photoSources[state.photoIndex];
        if (!source?.assetId) return;
        const events = [{
            assetId: source.assetId,
            action,
            designId: extra.designId || '',
            size: currentSize()?.n || '',
            profile: currentProfile(),
        }];
        fetch(`${API}/assets/usage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ events }),
            keepalive: true,
        }).catch(() => {});
    };

    const selectLibraryAsset = async (summary) => {
        try {
            const { asset } = await fetchJson(`${API}/assets/${encodeURIComponent(summary.id)}`);
            libraryCache.set(asset.id, asset);
            if (!['image', 'photo', 'cover', 'logo'].includes(asset.role) && /pdf|docx/.test(asset.identity.format || '')) {
                toast('This is a document, not a photo. Use its extracted rows in the Text tab.', true);
                return;
            }
            const src = `/api/assets/${encodeURIComponent(asset.id)}/file/original`;
            const image = await loadImage(src);
            state.photos.push(image);
            state.photoSources.push({
                name: asset.name,
                src,
                uploaded: asset.source.kind === 'upload',
                assetId: asset.id,
                class: asset.class,
                verified: ['verified', 'approved'].includes(asset.review.state),
            });
            state.photoIndex = state.photos.length - 1;
            renderControlBody();
            schedulePreviewAndThumbs();
            queueSession();
            toast(`Using “${asset.name}” from the library.`);
        } catch (error) {
            toast(error.message || 'That asset could not be loaded.', true);
        }
    };

    const renderLibrarySection = () => {
        if (!state.libraryAssets.length && !state.libraryRows.length) return;
        const wrap = make('section', 'business-library');
        const head = make('div', 'business-library-head');
        const title = make('div', null);
        title.append(make('h3', null, 'Business library'), make('p', null,
            'Pack files, staff uploads and documents. Only verified assets are used without a warning.'));
        const link = make('a', 'business-library-link', 'Open library →');
        link.href = `library.html?brandId=${encodeURIComponent(state.brand.id)}`;
        head.append(title, link);
        wrap.append(head);

        const visualAssets = state.libraryAssets.filter((asset) => !['business-document', 'content'].includes(asset.class));
        const classes = [...new Set(visualAssets.map((asset) => asset.class))];
        const filters = make('div', 'business-library-filters');
        ['', ...classes].forEach((value) => {
            const chip = button(value ? value.replace(/-/g, ' ') : 'All', 'library-filter', () => {
                state.libraryClass = value;
                renderControlBody();
            });
            chip.dataset.active = String(state.libraryClass === value);
            filters.append(chip);
        });
        const verified = make('label', 'check');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = state.libraryVerifiedOnly;
        checkbox.addEventListener('change', () => {
            state.libraryVerifiedOnly = checkbox.checked;
            renderControlBody();
        });
        verified.append(checkbox, document.createTextNode('Verified only'));
        filters.append(verified);
        wrap.append(filters);

        const visible = visualAssets.filter((asset) => (
            (!state.libraryClass || asset.class === state.libraryClass)
            && (!state.libraryVerifiedOnly || asset.state === 'verified')
        ));
        if (!visible.length) {
            wrap.append(make('p', 'hint', 'No library assets match this filter.'));
            el.controlBody.append(wrap);
            return;
        }
        const grid = make('div', 'business-library-grid');
        visible.slice(0, 18).forEach((asset) => {
            const tile = button(null, 'business-library-tile', () => selectLibraryAsset(asset));
            const image = document.createElement('img');
            image.src = asset.thumb || asset.sourceUrl;
            image.alt = asset.name;
            image.loading = 'lazy';
            image.addEventListener('error', () => {
                if (image.src !== location.origin + asset.sourceUrl) image.src = asset.sourceUrl;
            });
            tile.append(image);
            tile.append(make('span', 'library-tile-name', asset.name));
            const meta = make('span', 'library-tile-meta');
            meta.append(make('i', 'library-state', ''));
            meta.lastChild.dataset.state = asset.state;
            meta.append(document.createTextNode(asset.class.replace(/-/g, ' ')));
            tile.append(meta);
            grid.append(tile);
        });
        wrap.append(grid);
        el.controlBody.append(wrap);
    };

    const renderImagePanel = () => {
        const template = currentTemplate();
        if (!templateHasPhoto(template)) {
            el.controlBody.append(make('p', 'control-note',
                'This design has no photo slot. Choose a design with a photograph — the gallery marks designs that use brand photography.'));
            return;
        }
        el.controlBody.append(make('p', 'control-note',
            'Brand photography is loaded from the active brand pack. Upload a shot to add it to this asset; it travels with a saved asset.'));

        renderLibrarySection();

        const grid = make('div', 'photo-grid');
        state.photoSources.forEach((source, index) => {
            const tile = button(null, 'photo-tile', () => {
                state.photoIndex = index;
                renderControlBody();
                schedulePreviewAndThumbs();
                queueSession();
            });
            tile.setAttribute('aria-pressed', String(index === state.photoIndex));
            const image = document.createElement('img');
            image.src = source.src;
            image.alt = source.name;
            image.loading = 'lazy';
            tile.append(image, make('span', null, source.name));
            if (source.uploaded) tile.append(make('span', 'uploaded', 'up'));
            grid.append(tile);
        });
        el.controlBody.append(grid);
        if (!state.photoSources.length) {
            el.controlBody.append(make('p', 'hint', 'No photography is attached to this brand yet. Upload an image to use the photo slot.'));
        }

        const actions = make('div', 'button-row');
        actions.append(
            button('Upload image', 'btn', () => el.photoInput.click()),
            button('Reset to brand photography', 'btn', () => {
                const media = state.brand._media;
                state.photos = [...(media?.photos || [])];
                state.photoSources = (media?.sources || []).map((source) => ({ ...source }));
                state.photoIndex = 0;
                renderControlBody();
                schedulePreviewAndThumbs();
                queueSession();
                toast('Brand photography restored.');
            }),
        );
        el.controlBody.append(actions);
    };

    const templateHasAnyMotif = (template) => templateHasMotif(template)
        || /drawMotif\s*\(/.test(String(template?.draw || ''));

    const motifSelection = (hasSlot) => {
        if (state.motifOn === false) return 'none';
        if (state.motif === 'auto' && !hasSlot) return 'none';
        return state.motif || 'auto';
    };

    let motifInputRefs = null;
    let logoInputRefs = null;

    const drawMotifTile = (canvas, id, template) => {
        const size = 156;
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, size, size);
        if (id === 'logo') {
            const image = state.logoWordmark || state.logoMark;
            if (image && (image.naturalWidth || image.width)) {
                const imageWidth = image.naturalWidth || image.width;
                const imageHeight = image.naturalHeight || image.height;
                const box = size - 30;
                const scale = Math.min(box / imageWidth, box / imageHeight);
                context.drawImage(image, (size - imageWidth * scale) / 2,
                    (size - imageHeight * scale) / 2, imageWidth * scale, imageHeight * scale);
                return;
            }
            context.fillStyle = state.pal.ink;
            context.font = `700 34px ${state.fonts.display || 'Georgia, serif'}`;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(state.brand?.wordmark || state.brand?.name || 'Logo', size / 2, size / 2);
            return;
        }
        if (id === 'none') {
            context.strokeStyle = state.pal.ink;
            context.globalAlpha = 0.35;
            context.lineWidth = 3;
            context.beginPath();
            context.arc(size / 2, size / 2, size * 0.28, 0, Math.PI * 2);
            context.moveTo(size * 0.3, size * 0.7);
            context.lineTo(size * 0.7, size * 0.3);
            context.stroke();
            return;
        }
        window.AssetEngine.drawVectorPreview(canvas, id === 'auto' ? defaultMotifFor(template) : id, state.pal, 78, 78);
    };

    const buildSlider = (label, value, min, max, step, onChange, format, ariaLabel) => {
        const row = make('label', 'motif-slider');
        const head = make('span', 'motif-slider-head');
        const valueLabel = make('span', 'motif-value', format(value));
        head.append(make('span', null, label), valueLabel);
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(value);
        input.setAttribute('aria-label', ariaLabel || label);
        input.addEventListener('input', () => {
            const next = Number(input.value);
            onChange(next);
            valueLabel.textContent = format(next);
            schedulePreviewAndThumbs();
            queueSession();
        });
        row.append(head, input);
        return { row, input, valueLabel, format };
    };

    const addSlider = (controls, refs, key, label, value, min, max, step, onChange, format, ariaLabel) => {
        const slider = buildSlider(label, value, min, max, step, onChange, format, ariaLabel);
        refs[key] = slider;
        controls.append(slider.row);
    };

    const syncSliders = (refs, values) => {
        Object.entries(refs || {}).forEach(([key, ref]) => {
            if (!ref) return;
            ref.input.value = String(values[key]);
            ref.valueLabel.textContent = ref.format(values[key]);
        });
    };

    const syncMotifControls = () => syncSliders(motifInputRefs, {
        size: Math.round((state.motifScale || 1) * 100),
        x: Math.round((state.motifX || 0) * 100),
        y: Math.round((state.motifY || 0) * 100),
    });

    const syncLogoControls = () => syncSliders(logoInputRefs, {
        size: Math.round((state.logoScale || 1) * 100),
        x: Math.round((state.logoX || 0) * 100),
        y: Math.round((state.logoY || 0) * 100),
    });

    const renderMotifPanel = () => {
        const template = currentTemplate();
        const hasSlot = templateHasAnyMotif(template);
        const current = motifSelection(hasSlot);
        const active = current !== 'none';

        el.controlBody.append(make('p', 'control-note',
            'The motif is optional on every design: choose an element or the brand logo, or switch it off. Move and scale it on the preview — saved assets keep its position.'));

        const toggleRow = make('div', 'motif-toggle');
        const toggle = button(active ? 'Motif on' : 'Motif off', 'btn', () => {
            if (active) {
                state.motifOn = false;
            } else {
                state.motifOn = true;
                if (state.motif === 'none' || (state.motif === 'auto' && !hasSlot)) {
                    const last = state.motifLast && MOTIF_LABELS[state.motifLast] && state.motifLast !== 'none'
                        ? state.motifLast
                        : (hasSlot ? 'auto' : 'sprig');
                    state.motif = last;
                }
            }
            renderControlBody();
            schedulePreviewAndThumbs();
            queueSession();
        });
        toggle.setAttribute('aria-pressed', String(active));
        toggle.setAttribute('aria-label', active ? 'Hide the motif' : 'Show the motif');
        toggleRow.append(toggle, make('span', 'motif-toggle-hint',
            active ? 'Shown on this design' : 'Hidden on this design'));
        el.controlBody.append(toggleRow);

        const refs = {};
        motifInputRefs = refs;
        if (active) {
            const controls = make('div', 'motif-controls');
            addSlider(controls, refs, 'size', 'Size', Math.round((state.motifScale || 1) * 100), 30, 250, 5,
                (value) => { state.motifScale = value / 100; }, (value) => `${value}%`, 'Motif size');
            addSlider(controls, refs, 'x', 'Horizontal', Math.round((state.motifX || 0) * 100), -45, 45, 1,
                (value) => { state.motifX = value / 100; }, (value) => `${value > 0 ? '+' : ''}${value}%`, 'Motif horizontal position');
            addSlider(controls, refs, 'y', 'Vertical', Math.round((state.motifY || 0) * 100), -45, 45, 1,
                (value) => { state.motifY = value / 100; }, (value) => `${value > 0 ? '+' : ''}${value}%`, 'Motif vertical position');
            const actions = make('div', 'button-row');
            actions.append(button('Reset placement', 'btn', () => {
                state.motifScale = 1;
                state.motifX = 0;
                state.motifY = 0;
                syncMotifControls();
                schedulePreviewAndThumbs();
                queueSession();
            }));
            controls.append(actions);
            el.controlBody.append(controls);
            el.controlBody.append(make('p', 'hint',
                'Tip: drag the motif on the preview to move it. Size and position are saved with the asset.'));
        }

        const grid = make('div', 'motif-grid');
        const options = [
            ...(hasSlot ? ['auto'] : []),
            'logo',
            ...window.AssetEngine.VECTORS.filter((id) => id !== 'none'),
            'none',
        ];
        options.forEach((id) => {
            const tile = button(null, 'motif-tile', () => {
                state.motif = id;
                state.motifOn = id !== 'none';
                if (id !== 'none') state.motifLast = id;
                renderControlBody();
                schedulePreviewAndThumbs();
                queueSession();
            });
            tile.setAttribute('aria-pressed', String(current === id));
            tile.dataset.motif = id;
            const canvas = document.createElement('canvas');
            drawMotifTile(canvas, id, template);
            tile.append(canvas, make('span', null, MOTIF_LABELS[id] || id));
            grid.append(tile);
        });
        el.controlBody.append(grid);
    };

    const templateHasLogo = (template) => /logoAt\s*\(/.test(String(template?.draw || ''));

    const renderLogoPanel = () => {
        const template = currentTemplate();
        if (!templateHasLogo(template)) {
            el.controlBody.append(make('p', 'control-note',
                'This design does not place a brand logo. Choose a design with a logo to hide, move or resize it.'));
            return;
        }
        const active = state.logoOn !== false;
        el.controlBody.append(make('p', 'control-note',
            'The logo is optional here. Hide it, or move and scale it on the preview — the saved asset keeps the placement.'));

        const toggleRow = make('div', 'motif-toggle');
        const toggle = button(active ? 'Logo on' : 'Logo off', 'btn', () => {
            state.logoOn = state.logoOn === false;
            renderControlBody();
            schedulePreviewAndThumbs();
            queueSession();
        });
        toggle.setAttribute('aria-pressed', String(active));
        toggle.setAttribute('aria-label', active ? 'Hide the logo' : 'Show the logo');
        toggleRow.append(toggle, make('span', 'motif-toggle-hint',
            active ? 'Shown on this design' : 'Hidden on this design'));
        el.controlBody.append(toggleRow);

        const refs = {};
        logoInputRefs = refs;
        if (active) {
            const controls = make('div', 'motif-controls');
            addSlider(controls, refs, 'size', 'Size', Math.round((state.logoScale || 1) * 100), 30, 250, 5,
                (value) => { state.logoScale = value / 100; }, (value) => `${value}%`, 'Logo size');
            addSlider(controls, refs, 'x', 'Horizontal', Math.round((state.logoX || 0) * 100), -45, 45, 1,
                (value) => { state.logoX = value / 100; }, (value) => `${value > 0 ? '+' : ''}${value}%`, 'Logo horizontal position');
            addSlider(controls, refs, 'y', 'Vertical', Math.round((state.logoY || 0) * 100), -45, 45, 1,
                (value) => { state.logoY = value / 100; }, (value) => `${value > 0 ? '+' : ''}${value}%`, 'Logo vertical position');
            const actions = make('div', 'button-row');
            actions.append(button('Reset placement', 'btn', () => {
                state.logoScale = state.logoBaseScale || 1;
                state.logoX = 0;
                state.logoY = 0;
                syncLogoControls();
                schedulePreviewAndThumbs();
                queueSession();
            }));
            controls.append(actions);
            el.controlBody.append(controls);
            el.controlBody.append(make('p', 'hint',
                'Tip: drag the logo on the preview to move it. Size and position are saved with the asset.'));
        }

        const preview = make('div', 'logo-preview');
        const canvas = document.createElement('canvas');
        drawMotifTile(canvas, 'logo', template);
        preview.append(canvas, make('span', null, state.brand?.wordmark || state.brand?.name || 'Brand'));
        el.controlBody.append(preview);
    };

    let canvasDrag = null;

    const motifHitRadius = (anchor) => Math.max(anchor.size * 0.7, 26);

    const canvasPoint = (event) => {
        const canvas = el.previewCanvas;
        const rect = canvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * (canvas.width / Math.max(1, rect.width)),
            y: (event.clientY - rect.top) * (canvas.height / Math.max(1, rect.height)),
        };
    };

    const motifHit = (point, anchor) => Boolean(anchor) && state.motifOn !== false
        && Math.hypot(point.x - anchor.x, point.y - anchor.y) <= motifHitRadius(anchor);

    const logoHit = (point, anchor) => Boolean(anchor) && state.logoOn !== false
        && point.x >= anchor.x - 8 && point.x <= anchor.x + anchor.w + 8
        && point.y >= anchor.y - 8 && point.y <= anchor.y + anchor.h + 8;

    const dragTargetAt = (point) => {
        const motif = motifHit(point, state.motifAnchor);
        const logo = logoHit(point, state.logoAnchor);
        // The open panel decides when the two elements overlap.
        if (state.activeTab === 'logo' && logo) return 'logo';
        if (state.activeTab === 'motif' && motif) return 'motif';
        if (motif) return 'motif';
        if (logo) return 'logo';
        return null;
    };

    const bindCanvasDrag = () => {
        const canvas = el.previewCanvas;
        if (!canvas) return;
        canvas.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            const point = canvasPoint(event);
            const target = dragTargetAt(point);
            if (target) {
                event.preventDefault();
                canvas.setPointerCapture(event.pointerId);
                const anchor = target === 'motif' ? state.motifAnchor : state.logoAnchor;
                canvasDrag = {
                    pointerId: event.pointerId,
                    kind: target,
                    startX: point.x,
                    startY: point.y,
                    baseX: target === 'motif' ? (state.motifX || 0) : (state.logoX || 0),
                    baseY: target === 'motif' ? (state.motifY || 0) : (state.logoY || 0),
                    panelW: anchor?.canvasWidth || canvas.width,
                    panelH: anchor?.canvasHeight || canvas.height,
                };
                canvas.style.cursor = 'grabbing';
                return;
            }
            // Empty canvas while zoomed: pan the inspection view.
            if (state.zoom > 1) {
                event.preventDefault();
                canvas.setPointerCapture(event.pointerId);
                canvasDrag = {
                    pointerId: event.pointerId,
                    kind: 'pan',
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    baseX: state.zoomX,
                    baseY: state.zoomY,
                };
                canvas.style.cursor = 'grabbing';
            }
        });
        canvas.addEventListener('pointermove', (event) => {
            if (canvasDrag && event.pointerId === canvasDrag.pointerId) {
                if (canvasDrag.kind === 'pan') {
                    state.zoomX = canvasDrag.baseX + (event.clientX - canvasDrag.startClientX);
                    state.zoomY = canvasDrag.baseY + (event.clientY - canvasDrag.startClientY);
                    clampZoomPan();
                    applyZoom();
                } else {
                    const point = canvasPoint(event);
                    const offsetX = (point.x - canvasDrag.startX) / Math.max(1, canvasDrag.panelW);
                    const offsetY = (point.y - canvasDrag.startY) / Math.max(1, canvasDrag.panelH);
                    if (canvasDrag.kind === 'motif') {
                        state.motifX = clampMotifOffset(canvasDrag.baseX + offsetX);
                        state.motifY = clampMotifOffset(canvasDrag.baseY + offsetY);
                        syncMotifControls();
                    } else {
                        state.logoX = clampMotifOffset(canvasDrag.baseX + offsetX);
                        state.logoY = clampMotifOffset(canvasDrag.baseY + offsetY);
                        syncLogoControls();
                    }
                    schedulePreviewAndThumbs();
                    queueSession();
                }
                return;
            }
            const point = canvasPoint(event);
            const target = dragTargetAt(point);
            canvas.style.cursor = target ? 'grab' : (state.zoom > 1 ? 'grab' : '');
        });
        const finish = (event) => {
            if (!canvasDrag || event.pointerId !== canvasDrag.pointerId) return;
            const wasPan = canvasDrag.kind === 'pan';
            canvasDrag = null;
            canvas.style.cursor = '';
            if (!wasPan) queueSession();
        };
        canvas.addEventListener('pointerup', finish);
        canvas.addEventListener('pointercancel', finish);
        canvas.addEventListener('pointerleave', () => {
            if (!canvasDrag) canvas.style.cursor = '';
        });
    };

    const FIELD_LABELS = {
        item: 'Item', prep: 'Prep date', useby: 'Use-by date', initials: 'Initials',
        allergens: 'Allergens', storage: 'Storage', network: 'Wi-Fi network',
        password: 'Wi-Fi password', breakfast: 'Breakfast', reception: 'Reception',
        brandLine: 'Brand line', address: 'Address', phone: 'Phone', email: 'Email',
        web: 'Website', wines: 'Wines — Name | Region | Glass | Bottle',
        points: 'Slides — one point per line', activity: 'Activity copy',
        lines: 'Lines — Label | Value', updated: 'Updated line', order: 'Order line',
        delivery: 'Delivery line', reward: 'Reward line', stamps: 'Stamps (6, 8 or 10)',
        terms: 'Terms', message: 'Message', altTitle: 'Back title',
        altMessage: 'Back message', eyebrow: 'Small line above', sub: 'Sub-headline',
        title: 'Headline', body: 'Description', date: 'Date', price: 'Price',
        cta: 'Call to action', foot: 'Footer line', qr: 'QR link',
    };

    const humanizeField = (key) => String(key)
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
        .replace(/^./, (character) => character.toUpperCase());

    const renderTextPanel = () => {
        const template = currentTemplate();
        const category = currentCategory();
        el.controlBody.append(make('p', 'control-note',
            'Leave a field empty and it disappears from the design. The copy is brandified when you switch brands.'));

        // Template order wins: a design can use its own fields, and any copy
        // key gets an editable input even when the category declares none.
        const declared = new Map((category.fields || []).map(([key, label, rows]) => [key, { label, rows }]));
        const fields = Object.keys(template.t || {}).map((key) => {
            const meta = declared.get(key) || {};
            const value = template.t[key];
            let rows = meta.rows;
            if (rows === undefined && typeof value === 'string'
                && (value.includes('\n') || value.length > 80)) {
                rows = Math.min(7, Math.max(2, value.split('\n').length));
            }
            return [key, meta.label || FIELD_LABELS[key] || humanizeField(key), rows];
        });
        if (template.hint) {
            el.controlBody.append(make('p', 'control-hint', template.hint));
        }
        fields.forEach(([key, label, rows]) => {
            const field = make('label', 'field');
            field.append(make('span', null, label));
            const control = rows
                ? document.createElement('textarea')
                : document.createElement('input');
            if (!rows) control.type = 'text';
            if (rows) control.rows = rows;
            control.value = state.text[key] ?? '';
            control.addEventListener('input', () => {
                state.text[key] = control.value;
                schedulePreview();
                scheduleThumbs();
                queueSession();
            });
            field.append(control);
            if ((key === 'items' || key === 'wines') && state.libraryRows.length) {
                const insert = button('Insert menu rows from the library', 'btn small', () => {
                    control.value = state.libraryRows.join('\n');
                    state.text[key] = control.value;
                    schedulePreview();
                    scheduleThumbs();
                    queueSession();
                    toast('Menu rows inserted. Edit them freely.');
                });
                field.append(insert);
            }
            el.controlBody.append(field);
        });
        if (!fields.length) {
            el.controlBody.append(make('p', 'hint', 'This design has no text fields.'));
        }

        if (template.q) {
            const field = make('label', 'field');
            field.append(make('span', null, category.qr || 'QR code link'));
            const input = document.createElement('input');
            input.type = 'url';
            input.placeholder = websiteUrl();
            input.value = state.qr;
            input.addEventListener('input', () => {
                state.qr = input.value;
                schedulePreview();
                scheduleThumbs();
                queueSession();
            });
            field.append(input);
            el.controlBody.append(field);
            const actions = make('div', 'button-row');
            actions.append(button('Use brand website', 'btn', () => {
                state.qr = websiteUrl();
                input.value = state.qr;
                schedulePreview();
                queueSession();
            }));
            el.controlBody.append(actions);
            if (template.q && 'code' in (template.t || {})) {
                el.controlBody.append(make('p', 'hint', 'A QR link replaces the printed voucher code on this design.'));
            }
        }

        const actions = make('div', 'button-row');
        actions.append(button('Reset copy', 'btn', () => {
            state.text = categoryDefaultText(template, state.templateIndex);
            renderControlBody();
            schedulePreview();
            queueSession();
            toast('Copy reset to the brand defaults.');
        }));
        el.controlBody.append(actions);
    };

    const renderSizePanel = () => {
        const category = currentCategory();
        el.controlBody.append(make('p', 'control-note',
            'The size is the export size. Downloads render at these exact pixels.'));
        const list = make('div', 'size-list');
        sizesForTemplate().forEach((size, index) => {
            const option = button(null, 'size-option', () => selectSize(index));
            option.setAttribute('aria-pressed', String(index === state.sizeIndex));
            option.dataset.sizeIndex = String(index);
            const left = make('span');
            left.append(make('b', null, size.n), make('small', null, size.d || ''));
            option.append(left, make('em', null, `${size.w} × ${size.h}px`));
            list.append(option);
        });
        el.controlBody.append(list);
    };

    const renderSavedPanel = () => {
        el.controlBody.append(make('p', 'control-note',
            'Saved assets keep their design, size, palette, type, copy and images in this browser.'));
        const actions = make('div', 'button-row');
        actions.append(button('Save current asset', 'btn primary wide', saveAsset));
        el.controlBody.append(actions);
        if (!state.saved.length) {
            el.controlBody.append(make('p', 'empty-note', 'Nothing saved yet. Define an asset and hit “Save asset”.'));
            return;
        }
        const grid = make('div', 'saved-grid');
        state.saved.forEach((entry) => {
            const card = make('div', 'saved-card');
            const image = document.createElement('img');
            image.src = entry.thumb || '';
            image.alt = entry.name || 'Saved asset';
            image.loading = 'lazy';
            card.append(image, make('b', null, entry.name || 'Untitled asset'));
            const pack = packSummaryForBrand(entry.brandId);
            const brandName = pack?.brands?.find((brand) => brand.id === entry.brandId)?.name || entry.brandId;
            card.append(make('small', null, `${pack?.name ? `${pack.name} · ` : ''}${brandName} · ${categoryLabel(entry.categoryId)}`));
            const row = make('div', 'saved-actions');
            row.append(
                button('Open', null, () => restoreSaved(entry)),
                button('Delete', null, () => deleteSaved(entry.id)),
            );
            card.append(row);
            grid.append(card);
        });
        el.controlBody.append(grid);
    };

    const renderBrandSwitch = () => {
        buildBrandSwitch();
    };

    const renderHeader = () => {
        const template = currentTemplate();
        const size = currentSize();
        const category = currentCategory();
        if (!template || !size || !category) return;
        el.previewBrand.textContent = `${state.brand.name} · ${categoryLabel()}`;
        el.previewTitle.textContent = template.n;
        el.previewFormat.textContent = size.n;
        el.previewSize.textContent = `${size.w} × ${size.h} px`;
        const profile = currentProfile();
        const canPrint = profile === 'print';
        el.printPackBtn.hidden = !canPrint;
        el.printBtn.hidden = !canPrint;
        el.jpgBtn.hidden = profile !== 'screen';
        el.downloadBtn.textContent = profile === 'thermal' ? 'Download greyscale PNG' : 'Download PNG';
        const printVerdict = canPrint ? exportVerdict('print') : { blockers: [], warnings: [] };
        const exportVerdictNow = exportVerdict('export');
        const blocked = printVerdict.blockers.length > 0;
        el.printPackBtn.disabled = blocked;
        el.printBtn.disabled = blocked;
        el.jpgBtn.disabled = exportVerdictNow.blockers.length > 0;
        const note = profile === 'screen'
            ? 'Screen design · PNG or JPG · no print pack'
            : profile === 'thermal'
                ? 'Thermal label · greyscale PNG · no CMYK'
                : `${size.d ? `${size.d} · ` : ''}full resolution PNG`;
        el.exportNote.textContent = note;
        if (blocked) {
            const reason = printVerdict.blockers[0].message;
            el.exportNote.textContent = `${note} · ${reason}`;
            el.printPackBtn.title = reason;
            el.printBtn.title = reason;
        } else {
            el.printPackBtn.title = '';
            el.printBtn.title = '';
        }
        const warnings = [...new Set([
            ...printVerdict.warnings.map((warning) => warning.message),
            ...exportVerdictNow.warnings.map((warning) => warning.message),
        ])];
        if (warnings.length && !blocked) {
            el.exportNote.textContent = `${el.exportNote.textContent} · ${warnings[0]}`;
        }
        el.designMeta.textContent = `${state.templateIndex + 1} of ${category.tpls.length}`;
        el.topbarHint.textContent = `${state.brand.name} · ${categoryLabel()} · ${template.n}`;
        document.title = `${state.brand.name} — ${template.n} · Asset Studio`;
    };

    const buildRenderState = (text) => ({
        t: text || {},
        slideIndex: state.slideIndex || 0,
        slideCount: slideCount(),
        pal: state.pal,
        fonts: state.fonts,
        photos: state.photos,
        sel: state.photoIndex,
        qr: state.qr,
        motif: state.motif,
        motifOn: state.motifOn !== false,
        motifScale: state.motifScale,
        motifX: state.motifX,
        motifY: state.motifY,
        logoWordmark: state.logoWordmark,
        logoMark: state.logoMark,
        logoScale: state.logoScale || 1,
        logoOn: state.logoOn !== false,
        logoX: state.logoX,
        logoY: state.logoY,
        brandWordmark: state.brand?.wordmark || state.brand?.name || 'Brand',
        typeProfile: CAWLEY_IDS.has(state.brand?.id)
            ? 'cawley'
            : KITCHENOS_IDS.has(state.brand?.id)
                ? 'kitchenos'
                : OKJA_IDS.has(state.brand?.id) ? 'okja' : null,
        titleWeight: state.brand?.id === 'allerq' ? 400 : 700,
        defaultQr: websiteUrl(),
    });

    // ─── zoomable preview (inspection only, never exported) ───────────
    const ZOOM_MAX = 5;
    const ZOOM_RENDER_MAX = 3500;
    let zoomBar = null;
    let zoomRenderTimer = 0;

    const zoomStage = () => el.previewCanvas?.closest('.stage') || null;

    const updateZoomBar = () => {
        if (!zoomBar) return;
        const value = zoomBar.querySelector('.zoom-value');
        const reset = zoomBar.querySelector('.zoom-reset');
        if (value) value.textContent = `${Math.round(state.zoom * 100)}%`;
        if (reset) reset.hidden = state.zoom <= 1.001;
        zoomBar.classList.toggle('is-zoomed', state.zoom > 1.001);
    };

    const clampZoomPan = () => {
        const stage = zoomStage();
        if (!stage || !state.zoomBase) {
            state.zoomX = 0;
            state.zoomY = 0;
            return;
        }
        const rect = stage.getBoundingClientRect();
        const style = window.getComputedStyle(stage);
        const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
        const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
        const viewW = Math.max(1, rect.width - padX);
        const viewH = Math.max(1, rect.height - padY);
        const maxX = Math.max(0, (state.zoomBase.w * state.zoom - viewW) / 2);
        const maxY = Math.max(0, (state.zoomBase.h * state.zoom - viewH) / 2);
        state.zoomX = Math.max(-maxX, Math.min(maxX, state.zoomX));
        state.zoomY = Math.max(-maxY, Math.min(maxY, state.zoomY));
    };

    const applyZoom = () => {
        const canvas = el.previewCanvas;
        if (!canvas) return;
        if (state.zoom <= 1.001) {
            state.zoom = 1;
            state.zoomX = 0;
            state.zoomY = 0;
            state.zoomBase = null;
            canvas.style.width = '';
            canvas.style.height = '';
            canvas.style.transform = '';
            canvas.style.transformOrigin = '';
            updateZoomBar();
            return;
        }
        if (!state.zoomBase) {
            const rect = canvas.getBoundingClientRect();
            state.zoomBase = { w: rect.width, h: rect.height };
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
        }
        canvas.style.transformOrigin = 'center center';
        canvas.style.transform = `translate(${state.zoomX}px, ${state.zoomY}px) scale(${state.zoom})`;
        updateZoomBar();
    };

    const scheduleZoomRender = () => {
        window.clearTimeout(zoomRenderTimer);
        zoomRenderTimer = window.setTimeout(() => { renderPreview(); }, 140);
    };

    const zoomTo = (next, clientX, clientY) => {
        const canvas = el.previewCanvas;
        if (!canvas) return;
        const target = Math.max(1, Math.min(ZOOM_MAX, next));
        if (Math.abs(target - state.zoom) < 0.0005) return;
        const rect = canvas.getBoundingClientRect();
        if (!state.zoomBase) {
            state.zoomBase = { w: rect.width, h: rect.height };
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
        }
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const ratio = target / state.zoom;
        state.zoomX += (clientX - cx) * (1 - ratio);
        state.zoomY += (clientY - cy) * (1 - ratio);
        state.zoom = target;
        if (target === 1) {
            state.zoomX = 0;
            state.zoomY = 0;
            state.zoomBase = null;
            window.clearTimeout(zoomRenderTimer);
            applyZoom();
            renderPreview();
            return;
        }
        clampZoomPan();
        applyZoom();
        scheduleZoomRender();
    };

    const clearZoom = () => {
        state.zoom = 1;
        state.zoomX = 0;
        state.zoomY = 0;
        state.zoomBase = null;
        window.clearTimeout(zoomRenderTimer);
        applyZoom();
    };

    const resetZoom = () => {
        if (state.zoom === 1 && !state.zoomBase) return;
        clearZoom();
        renderPreview();
    };

    const zoomStep = (factor) => {
        const canvas = el.previewCanvas;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        zoomTo(state.zoom * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
    };

    const bindZoom = () => {
        const canvas = el.previewCanvas;
        const stage = zoomStage();
        if (!canvas || !stage) return;
        zoomBar = make('div', 'zoom-bar');
        const out = button('−', 'zoom-btn', () => zoomStep(1 / 1.35));
        const value = make('span', 'zoom-value', '100%');
        const inBtn = button('+', 'zoom-btn', () => zoomStep(1.35));
        const reset = button('Reset', 'zoom-btn zoom-reset', resetZoom);
        reset.hidden = true;
        zoomBar.append(out, value, inBtn, reset);
        stage.append(zoomBar);
        // Scrolling over the preview inspects it instead of scrolling the page.
        stage.addEventListener('wheel', (event) => {
            if (Math.abs(event.deltaY) < 0.4 && Math.abs(event.deltaX) < 0.4) return;
            event.preventDefault();
            const factor = Math.exp(-event.deltaY * 0.0016);
            zoomTo(state.zoom * factor, event.clientX, event.clientY);
        }, { passive: false });
        canvas.addEventListener('dblclick', (event) => {
            if (state.zoom > 1) {
                event.preventDefault();
                resetZoom();
            }
        });
        window.addEventListener('resize', () => {
            if (state.zoom > 1) resetZoom();
        });
        updateZoomBar();
    };

    const renderPreview = () => {
        const template = currentTemplate();
        const size = currentSize();
        if (!template || !size) return;
        clampSlide();
        const baseTarget = Math.min(size.w, PREVIEW_MAX);
        // Upscale the render while inspecting so the zoom shows real detail.
        const targetWidth = Math.min(ZOOM_RENDER_MAX, Math.round(baseTarget * Math.max(1, state.zoom)));
        try {
            const rendered = window.AssetEngine.render(el.previewCanvas, size, template,
                buildRenderState(state.text), targetWidth);
            // Rendered anchors power click-and-drag placement.
            state.motifAnchor = rendered?.motif || null;
            state.logoAnchor = rendered?.logo || null;
        } catch (error) {
            state.motifAnchor = null;
            state.logoAnchor = null;
            toast(`Could not render this design: ${error.message}`, true);
        }
        if (state.zoom > 1 && state.zoomBase) {
            el.previewCanvas.style.width = `${state.zoomBase.w}px`;
            el.previewCanvas.style.height = `${state.zoomBase.h}px`;
        }
        renderHeader();
        updateSlideNav();
    };

    const updateSlideNav = () => {
        const multi = Boolean(currentTemplate()?.multi);
        el.slideNav.hidden = !multi;
        if (!multi) return;
        const total = slideCount();
        const index = clampSlide();
        el.slideLabel.textContent = `Slide ${index + 1} of ${total}`;
        el.slidePrev.disabled = index === 0;
        el.slideNext.disabled = index >= total - 1;
        el.slideDownload.textContent = `Download ${total} slides`;
    };

    const goToSlide = (delta) => {
        state.slideIndex = Math.max(0, Math.min(slideCount() - 1, (state.slideIndex || 0) + delta));
        renderPreview();
        queueSession();
    };

    const schedulePreview = () => {
        cancelAnimationFrame(previewFrame);
        previewFrame = requestAnimationFrame(renderPreview);
    };

    const scheduleThumbs = () => {
        window.clearTimeout(thumbTimer);
        thumbTimer = window.setTimeout(renderDesignThumbnails, 140);
    };

    const schedulePreviewAndThumbs = () => {
        schedulePreview();
        scheduleThumbs();
    };

    // ─── export / save / restore ─────────────────────────────────────

    const fullSizeCanvas = (options = {}) => {
        const canvas = document.createElement('canvas');
        window.AssetEngine.render(canvas, currentSize(), currentTemplate(), buildRenderState(state.text), null,
            { backdrop: false, ...options });
        return canvas;
    };

    const saveCanvas = (canvas, name, type = 'image/png', quality) => new Promise((resolve) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                resolve(null);
                return;
            }
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = name;
            document.body.append(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1500);
            resolve(blob);
        }, type, quality);
    });

    const greyscaleCanvas = (source) => {
        const canvas = document.createElement('canvas');
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext('2d');
        context.filter = 'grayscale(1)';
        context.drawImage(source, 0, 0);
        return canvas;
    };

    const assetBaseName = () => `${slug(state.brand.name)}-${state.categoryId}-${slug(currentTemplate().n)}-${slug(currentSize().n)}`;

    const downloadAsset = () => {
        try {
            const profile = currentProfile();
            let canvas = fullSizeCanvas();
            if (profile === 'thermal') canvas = greyscaleCanvas(canvas);
            const name = `${assetBaseName()}${profile === 'thermal' ? '-thermal' : ''}.png`;
            toast('Rendering the full-resolution PNG…');
            saveCanvas(canvas, name).then((blob) => {
                if (blob) recordAssetUsage('download');
                toast(blob ? `Downloaded ${name}` : 'The PNG could not be encoded. Try a smaller size.', !blob);
            });
        } catch (error) {
            toast(`Export failed: ${error.message}`, true);
        }
    };

    const downloadJpg = () => {
        const verdict = exportVerdict('export');
        if (verdict.blockers.length) {
            toast(verdict.blockers[0].message, true);
            return;
        }
        try {
            const source = fullSizeCanvas();
            const canvas = document.createElement('canvas');
            canvas.width = source.width;
            canvas.height = source.height;
            const context = canvas.getContext('2d');
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(source, 0, 0);
            const name = `${assetBaseName()}.jpg`;
            toast('Rendering the full-resolution JPG…');
            saveCanvas(canvas, name, 'image/jpeg', 0.92).then((blob) => {
                if (blob) recordAssetUsage('download');
                toast(blob ? `Downloaded ${name}` : 'The JPG could not be encoded.', !blob);
            });
        } catch (error) {
            toast(`Export failed: ${error.message}`, true);
        }
    };

    const downloadSlides = async () => {
        const template = currentTemplate();
        if (!template?.multi) return;
        const total = slideCount();
        const base = assetBaseName();
        const previous = state.slideIndex;
        toast(`Rendering ${total} slides…`);
        for (let index = 0; index < total; index += 1) {
            state.slideIndex = index;
            const name = `${base}-slide-${String(index + 1).padStart(2, '0')}.png`;
            // eslint-disable-next-line no-await-in-loop
            await saveCanvas(fullSizeCanvas(), name);
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => window.setTimeout(resolve, 320));
        }
        state.slideIndex = previous;
        renderPreview();
        toast(`Downloaded ${total} slide images.`);
    };

    const printAsset = () => {
        const verdict = exportVerdict('print');
        if (verdict.blockers.length) {
            toast(verdict.blockers[0].message, true);
            return;
        }
        const canvas = fullSizeCanvas();
        const image = canvas.toDataURL('image/png');
        const win = window.open('', '_blank');
        if (!win) {
            toast('Allow pop-ups to print this asset.', true);
            return;
        }
        win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${state.brand.name} — ${currentTemplate().n}</title><style>@page{margin:0}html,body{margin:0;padding:0}img{display:block;width:100%;max-width:100%;height:auto}</style></head><body><img src="${image}" alt=""></body></html>`);
        win.document.close();
        win.setTimeout(() => { win.focus(); win.print(); }, 350);
    };

    // ─── print pack ─────────────────────────────────────────────────

    const currentPrintSpec = () => {
        if (!window.AssetPrint) return null;
        const spec = window.AssetPrint.resolveSpec(state.categoryId, currentSize());
        return spec && spec.w > 0 && spec.h > 0 ? spec : null;
    };

    const printSides = () => {
        const size = currentSize();
        if (size.sides === 2) return ['f', 'b'];
        if (size.side === 'b') return ['b'];
        return ['f'];
    };

    const printSideSize = (side) => {
        const size = currentSize();
        if (size.sides === 2) {
            const sideHeight = (size.h - 40 * (size.sides - 1)) / size.sides;
            return { ...size, h: sideHeight, sides: 1, side };
        }
        return { ...size, sides: 1, side };
    };

    const renderPrintSide = (side, width, slideIndex = null) => {
        const template = currentTemplate();
        const renderState = buildRenderState(state.text);
        renderState.slideIndex = slideIndex == null ? state.slideIndex : slideIndex;
        renderState.boxes = [];
        const canvas = document.createElement('canvas');
        // Print uses the unclipped artwork plus a vector cut line, so the
        // bleed can extend past a die-cut edge.
        window.AssetEngine.render(canvas, printSideSize(side), template, renderState, width, { clipShape: false });
        return { canvas, renderState };
    };

    const updatePrintOptions = () => {
        printOptions.bleed = Number(el.printBleed.value) || 0;
        printOptions.safe = Number(el.printSafe.value) || 4;
        printOptions.dpi = Number(el.printDpi.value) || 300;
        printOptions.marks = el.printMarks.checked;
    };

    const syncPrintOptions = () => {
        el.printBleed.value = String(printOptions.bleed);
        el.printSafe.value = String(printOptions.safe);
        el.printDpi.value = String(printOptions.dpi);
        el.printMarks.checked = printOptions.marks;
    };

    const strokeCutPreview = (context, shape, width, height) => {
        if (!shape) return;
        context.save();
        context.strokeStyle = 'rgba(214, 0, 160, 0.95)';
        context.lineWidth = Math.max(1.5, width * 0.0022);
        context.setLineDash([Math.max(5, width * 0.008), Math.max(4, width * 0.006)]);
        context.beginPath();
        if (shape === 'circle') {
            context.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
        } else {
            const radius = Math.min(width, height) * (shape === 'sleeve' ? 0.02 : 0.05);
            context.roundRect(0, 0, width, height, radius);
            if (shape === 'hanger') {
                const hole = Math.min(width * 0.42, height * 0.095);
                context.moveTo(width / 2 + hole, height * 0.14);
                context.arc(width / 2, height * 0.14, hole, 0, Math.PI * 2, true);
            }
        }
        context.stroke();
        context.restore();
    };

    const drawPrintOverlay = (canvas, spec, safe, boxes, side) => {
        const context = canvas.getContext('2d');
        const scaleX = canvas.width / spec.w;
        const scaleY = canvas.height / spec.h;
        const insetX = safe * scaleX;
        const insetY = safe * scaleY;
        context.save();
        context.strokeStyle = 'rgba(225, 84, 58, 0.9)';
        context.lineWidth = Math.max(1, canvas.width * 0.0015);
        context.setLineDash([Math.max(4, canvas.width * 0.006), Math.max(3, canvas.width * 0.004)]);
        context.strokeRect(
            insetX,
            insetY,
            Math.max(1, canvas.width - insetX * 2),
            Math.max(1, canvas.height - insetY * 2),
        );
        context.setLineDash([]);
        const violations = window.AssetPrint.checkBoxes(boxes, spec.w, spec.h, scaleX, scaleY, safe)
            .filter((violation) => violation.side === side);
        context.strokeStyle = 'rgba(217, 48, 37, 0.95)';
        context.lineWidth = Math.max(1.5, canvas.width * 0.0025);
        violations.forEach((violation) => {
            context.strokeRect(violation.x, violation.y, violation.w, violation.h);
        });
        context.restore();
        strokeCutPreview(context, spec.shape, canvas.width, canvas.height);
    };

    const printMetaLines = (spec, sides) => {
        const slugMm = printOptions.marks ? 6 : 0;
        const metrics = window.AssetPrint.pageMetrics({
            trimW: spec.w,
            trimH: spec.h,
            bleed: printOptions.bleed,
            slug: slugMm,
            marks: printOptions.marks,
        });
        const lines = [
            `${categoryLabel()} · ${currentTemplate().n} · ${currentSize().n}`,
            `Trim ${spec.w} × ${spec.h} mm · bleed ${printOptions.bleed} mm`,
            `Page ${metrics.mediaW} × ${metrics.mediaH} mm · ${printOptions.dpi} dpi · CMYK`,
            printOptions.marks ? `Crop marks · ${slugMm} mm slug` : 'No crop marks',
            `${sides.length} page${sides.length === 1 ? '' : 's'}${sides.length > 1 ? ' · front + back' : ''}`,
        ];
        if (spec.shape) {
            lines.push(`Die-cut: ${spec.shape} · vector cut line in magenta (not a spot colour)`);
        }
        if (spec.largeFormat) {
            lines.push(`Large format · working ${printOptions.dpi} dpi`);
        }
        if (spec.digital) {
            lines.push('Digital size — the physical size is an approximate 10 px/mm conversion. Choose a print size for a print house.');
        }
        lines.push('Direct CMYK conversion · no ICC output intent');
        if (!window.AssetPrint.canCompress()) {
            lines.push('This browser cannot compress PDF streams; the file will be large.');
        }
        return lines;
    };

    const refreshPrintPreview = () => {
        if (el.printDialog.hidden) return;
        updatePrintOptions();
        const spec = currentPrintSpec();
        if (!spec) {
            el.printReport.textContent = 'This size cannot be prepared for print.';
            return;
        }
        const sides = printSides();
        const previewWidth = 900;
        let first = null;
        let total = 0;
        const rows = [];

        sides.forEach((side) => {
            const data = renderPrintSide(side, previewWidth);
            if (!first) first = data;
            const scaleX = data.canvas.width / spec.w;
            const scaleY = data.canvas.height / spec.h;
            const violations = window.AssetPrint.checkBoxes(
                data.renderState.boxes,
                spec.w,
                spec.h,
                scaleX,
                scaleY,
                printOptions.safe,
            );
            total += violations.length;
            const sideLabel = side === 'b' ? 'Back' : 'Front';
            if (!violations.length) {
                if (sides.length > 1) {
                    rows.push({
                        state: 'ok',
                        label: `${sideLabel}: clear`,
                        detail: `All text and logo boxes are at least ${printOptions.safe} mm from the trim.`,
                    });
                }
            } else {
                violations.slice(0, 8).forEach((violation) => {
                    const edges = violation.edges
                        .map((entry) => `${entry.edge} ${entry.distance.toFixed(1)} mm`)
                        .join(', ');
                    rows.push({
                        state: 'warn',
                        label: `${sideLabel} · ${violation.kind === 'logo' ? 'Logo' : (violation.text || 'Text').slice(0, 42)}`,
                        detail: `${violation.min.toFixed(1)} mm from the trim (safe ${printOptions.safe} mm; ${edges}).`,
                    });
                });
                if (violations.length > 8) {
                    rows.push({
                        state: 'warn',
                        label: sideLabel,
                        detail: `${violations.length - 8} more box(es) inside the safe margin.`,
                    });
                }
            }
        });

        if (first) {
            el.printPreview.width = first.canvas.width;
            el.printPreview.height = first.canvas.height;
            const context = el.printPreview.getContext('2d');
            context.drawImage(first.canvas, 0, 0);
            drawPrintOverlay(el.printPreview, spec, printOptions.safe, first.renderState.boxes, sides[0]);
        }

        clear(el.printReport);
        const summary = make('div', 'print-report-row');
        summary.dataset.state = total ? 'warn' : 'ok';
        summary.append(
            make('strong', null, total ? `${total} safe-zone notice${total === 1 ? '' : 's'}.` : 'Safe.'),
            make('span', null, total
                ? 'These boxes sit inside the safe margin. The PDF can still be generated; move the copy or logos inward if the printer requires a hard safe zone.'
                : 'Text and logos are clear of the trim. The check is a preflight aid, not a substitute for the printer’s own preflight.'),
        );
        el.printReport.append(summary);
        rows.forEach((row) => {
            const line = make('div', 'print-report-row');
            line.dataset.state = row.state;
            line.append(make('strong', null, row.label), make('span', null, row.detail));
            el.printReport.append(line);
        });
        el.printReport.append(make('p', 'print-report-note',
            'The check covers recorded text and logo boxes, not every decorative shape or photograph. Full-bleed images are intended to cross the trim.'));
        el.printReport.append(make('p', 'print-report-note',
            'CMYK is a direct RGB→CMYK conversion without an ICC output intent. The PDF carries trim and bleed boxes plus crop marks; it is not PDF/X-certified.'));

        clear(el.printMeta);
        printMetaLines(spec, sides).forEach((line) => el.printMeta.append(make('div', null, line)));
        el.printPageCount.textContent = `${sides[0] === 'b' ? 'Back' : 'Front'} preview · ${sides.length} page${sides.length === 1 ? '' : 's'}`;
    };

    const openPrintDialog = () => {
        if (!state.brand) return;
        if (!window.AssetPrint) {
            toast('The print writer is still loading.', true);
            return;
        }
        const spec = currentPrintSpec();
        if (!spec) {
            toast('This size cannot be prepared for print.', true);
            return;
        }
        const verdict = exportVerdict('print');
        if (verdict.blockers.length) {
            toast(verdict.blockers[0].message, true);
            return;
        }
        printWarnings = verdict.warnings;
        printWarningAcknowledged = false;
        if (Number(spec.dpi)) printOptions.dpi = Number(spec.dpi);
        syncPrintOptions();
        el.printStatus.textContent = '';
        el.printDownload.disabled = false;
        el.printDownload.textContent = 'Download print pack';
        el.printDialog.hidden = false;
        document.body.style.overflow = 'hidden';
        refreshPrintPreview();
        if (printWarnings.length) {
            el.printStatus.textContent = `Warnings: ${printWarnings.map((warning) => warning.message).join(' ')} Click Download once to acknowledge.`;
        }
        el.printClose.focus();
    };

    const closePrintDialog = () => {
        el.printDialog.hidden = true;
        if (el.brandGate.hidden && el.brandDrawer.hidden) document.body.style.overflow = '';
        el.printPackBtn.focus();
    };

    const downloadPrintPack = async () => {
        updatePrintOptions();
        const spec = currentPrintSpec();
        if (!spec) {
            toast('This size cannot be prepared for print.', true);
            return;
        }
        const verdict = exportVerdict('print');
        if (verdict.blockers.length) {
            toast(verdict.blockers[0].message, true);
            return;
        }
        if (verdict.warnings.length && !printWarningAcknowledged) {
            printWarnings = verdict.warnings;
            printWarningAcknowledged = true;
            el.printStatus.textContent = `Warnings: ${verdict.warnings.map((warning) => warning.message).join(' ')} Click Download print pack again to continue.`;
            return;
        }
        if (verdict.warnings.length) printWarnings = verdict.warnings;
        const sides = printSides();
        const bleed = printOptions.bleed;
        const marks = printOptions.marks;
        const slugMm = marks ? 6 : 0;
        const dpi = printOptions.dpi;
        const pxPerMm = dpi / 25.4;
        const trimWpx = Math.max(1, Math.round(spec.w * pxPerMm));
        const trimHpx = Math.max(1, Math.round(spec.h * pxPerMm));
        const bleedPx = Math.round(bleed * pxPerMm);

        el.printDownload.disabled = true;
        el.printDownload.textContent = 'Rendering…';
        el.printStatus.textContent = 'Rendering trim pages…';
        try {
            const pages = [];
            for (let index = 0; index < sides.length; index += 1) {
                el.printStatus.textContent = `Rendering ${index + 1} of ${sides.length}…`;
                const { canvas: trimCanvas } = renderPrintSide(sides[index], trimWpx);
                const pageCanvas = document.createElement('canvas');
                pageCanvas.width = trimWpx + bleedPx * 2;
                pageCanvas.height = trimHpx + bleedPx * 2;
                const context = pageCanvas.getContext('2d');
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
                // Extend the edge artwork into the bleed, then lay the trim
                // render back over the centre.
                context.drawImage(trimCanvas, 0, 0, pageCanvas.width, pageCanvas.height);
                context.drawImage(trimCanvas, bleedPx, bleedPx, trimWpx, trimHpx);
                pages.push({
                    canvas: pageCanvas,
                    trimW: spec.w,
                    trimH: spec.h,
                    bleed,
                    slug: slugMm,
                    marks,
                    shape: spec.shape || null,
                });
            }
            el.printStatus.textContent = 'Converting to CMYK and writing the PDF…';
            const blob = await window.AssetPrint.buildPdf({
                pages,
                title: `${state.brand.name} ${currentTemplate().n} ${currentSize().n}`.replace(/[^\x20-\x7E]/g, ' '),
                onProgress: (page, total) => {
                    el.printStatus.textContent = `Converting page ${page} of ${total} to CMYK…`;
                },
            });
            const filename = `${slug(state.brand.name)}-${state.categoryId}-${slug(currentTemplate().n)}-${slug(currentSize().n)}-print-pack.pdf`;
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.append(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 2000);
            el.printStatus.textContent = `PDF ready · ${(blob.size / 1024 / 1024).toFixed(1)} MB`;
            recordAssetUsage('download');
            toast(`Downloaded ${filename} (${(blob.size / 1024 / 1024).toFixed(1)} MB).`);
        } catch (error) {
            el.printStatus.textContent = error.message || 'The print pack could not be written.';
            toast(`Print pack failed: ${error.message}`, true);
        } finally {
            el.printDownload.disabled = false;
            el.printDownload.textContent = 'Download print pack';
        }
    };

    const makeThumb = () => {
        const canvas = document.createElement('canvas');
        window.AssetEngine.render(canvas, currentSize(), currentTemplate(), buildRenderState(state.text), 420);
        return canvas.toDataURL('image/jpeg', 0.82);
    };

    const saveAsset = () => {
        const template = currentTemplate();
        const size = currentSize();
        if (!state.brand || !template || !size) return;
        const fallbackName = `${state.brand.name} — ${template.n}`;
        const name = window.prompt('Name this asset', fallbackName);
        if (name === null) return;
        let thumb = '';
        try {
            thumb = makeThumb();
        } catch {
            thumb = '';
        }
        const entry = {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            name: String(name || fallbackName).trim().slice(0, 80) || fallbackName,
            brandId: state.brand.id,
            categoryId: state.categoryId,
            templateIndex: state.templateIndex,
            sizeIndex: state.sizeIndex,
            slideIndex: state.slideIndex,
            pal: { ...state.pal },
            fonts: { ...state.fonts },
            motif: state.motif,
            motifOn: state.motifOn !== false,
            motifScale: state.motifScale,
            motifX: state.motifX,
            motifY: state.motifY,
            logoOn: state.logoOn !== false,
            logoScale: state.logoScale,
            logoX: state.logoX,
            logoY: state.logoY,
            qr: state.qr,
            text: { ...state.text },
            photoIndex: state.photoIndex,
            photoSources: state.photoSources.map((source) => ({ ...source })),
            thumb,
            updatedAt: Date.now(),
        };
        state.saved = [entry, ...state.saved].slice(0, SAVED_LIMIT);
        if (!persistSaved()) {
            entry.photoSources = entry.photoSources.filter((source) => !source.uploaded);
            state.saved = [entry, ...state.saved.filter((item) => item.id !== entry.id)].slice(0, SAVED_LIMIT);
            if (!persistSaved()) {
                toast('Could not save this asset — browser storage is full.', true);
                return;
            }
        }
        renderControlTabs();
        setActiveTab('saved');
        recordAssetUsage('design', { designId: entry.id });
        toast(`Saved “${entry.name}”.`);
    };

    const deleteSaved = (id) => {
        state.saved = state.saved.filter((entry) => entry.id !== id);
        persistSaved();
        renderControlTabs();
        setActiveTab('saved');
        toast('Saved asset removed.');
    };

    const restoreSaved = async (entry) => {
        const pack = packSummaryForBrand(entry.brandId);
        if (!pack) {
            toast('The brand group for this saved asset is not available.', true);
            return;
        }
        if (state.pack?.id !== pack.id) {
            await activatePack(pack.id, { autoSelect: true, preferredBrandId: entry.brandId });
        } else if (state.brand?.id !== entry.brandId) {
            await selectBrand(entry.brandId);
        }
        const brand = state.brands.find((item) => item.id === entry.brandId);
        if (!brand) {
            toast('The brand for this saved asset is not available.', true);
            return;
        }
        if (!window.AssetCategories[entry.categoryId]) {
            toast('The category for this saved asset is not available.', true);
            return;
        }
        state.categoryId = entry.categoryId;
        const category = currentCategory();
        state.templateIndex = Math.min(Math.max(0, Number(entry.templateIndex) || 0), category.tpls.length - 1);
        const restoredSizes = sizesForTemplate(category.tpls[state.templateIndex], category);
        state.sizeIndex = Math.min(Math.max(0, Number(entry.sizeIndex) || 0), Math.max(0, restoredSizes.length - 1));
        state.slideIndex = Math.max(0, Number(entry.slideIndex) || 0);
        state.text = { ...(entry.text || categoryDefaultText(category.tpls[state.templateIndex], state.templateIndex)) };
        if (entry.pal) state.pal = { ...state.pal, ...entry.pal };
        if (entry.fonts) state.fonts = { ...state.fonts, ...entry.fonts };
        state.motif = entry.motif || 'auto';
        state.motifOn = entry.motifOn !== false && state.motif !== 'none';
        state.motifScale = clampMotifScale(entry.motifScale);
        state.motifX = clampMotifOffset(entry.motifX);
        state.motifY = clampMotifOffset(entry.motifY);
        state.logoOn = entry.logoOn !== false;
        state.logoScale = clampLogoScale(entry.logoScale, state.logoBaseScale || 1);
        state.logoX = clampMotifOffset(entry.logoX);
        state.logoY = clampMotifOffset(entry.logoY);
        state.qr = entry.qr || '';
        state.photoIndex = Number(entry.photoIndex) || 0;
        if (Array.isArray(entry.photoSources) && entry.photoSources.length) {
            const loaded = await Promise.all(entry.photoSources.map((source) => loadImage(source.src).catch(() => null)));
            const photos = [];
            const sources = [];
            loaded.forEach((image, index) => {
                if (!image) return;
                photos.push(image);
                sources.push({ ...entry.photoSources[index] });
            });
            if (photos.length) {
                state.photos = photos;
                state.photoSources = sources;
                state.photoIndex = Math.min(state.photoIndex, photos.length - 1);
            }
        }
        applyTheme();
        clearZoom();
        hideGate();
        showStudio();
        renderWorkspace();
        toast(`Restored “${entry.name}”.`);
    };

    // ─── uploads ─────────────────────────────────────────────────────

    const uploadPhoto = async (file) => {
        el.photoInput.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast('Choose an image file (PNG, JPEG, WebP or SVG).', true);
            return;
        }
        if (file.size > 12 * 1024 * 1024) {
            toast('Images are limited to 12 MB.', true);
            return;
        }
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('The image could not be read.'));
            reader.readAsDataURL(file);
        }).catch((error) => {
            toast(error.message, true);
            return null;
        });
        if (!dataUrl) return;
        let source = { name: file.name || 'Uploaded image', src: dataUrl, uploaded: true };
        let libraryAsset = null;
        try {
            const result = await fetchJson(`${API}/assets/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    packId: state.pack?.id,
                    brandId: state.brand.id,
                    files: [{ name: file.name || 'upload.jpg', dataUrl, rights: 'unknown' }],
                }),
            });
            libraryAsset = result?.created?.[0] || null;
            if (libraryAsset) {
                source = {
                    name: libraryAsset.name,
                    src: libraryAsset.sourceUrl,
                    uploaded: true,
                    assetId: libraryAsset.id,
                    class: libraryAsset.class,
                    verified: false,
                };
                state.libraryAssets = [libraryAsset, ...state.libraryAssets.filter((item) => item.id !== libraryAsset.id)];
                libraryCache.set(libraryAsset.id, libraryAsset);
            }
        } catch (error) {
            // The studio still works when the backend is unavailable: keep the
            // local data URL and let the operator save it later.
            toast(`Library unavailable: ${error.message}`, true);
        }
        const image = await loadImage(source.src).catch(() => null);
        if (!image) {
            toast('That image could not be decoded.', true);
            return;
        }
        state.photos.push(image);
        state.photoSources.push(source);
        state.photoIndex = state.photos.length - 1;
        renderControlBody();
        schedulePreviewAndThumbs();
        queueSession();
        toast(libraryAsset
            ? `Added “${file.name || 'image'}” to this asset and the library.`
            : `Added “${file.name || 'image'}” to this asset.`);
    };

    const uploadFont = async (file) => {
        el.fontInput.value = '';
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            toast('Fonts are limited to 2 MB.', true);
            return;
        }
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('The font could not be read.'));
            reader.readAsDataURL(file);
        }).catch((error) => {
            toast(error.message, true);
            return null;
        });
        if (!dataUrl) return;
        toast(`Uploading ${file.name}…`);
        try {
            const font = await fetchJson(`${API}/fonts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: file.name, dataUrl }),
            });
            if (!(await registerFont(font))) throw new Error('The font was stored but could not be loaded in this browser.');
            state.uploadedFonts.push(font);
            state.fonts.display = fontStackFor(font.family);
            renderWorkspace();
            toast(`${font.family} added and set as the display font.`);
        } catch (error) {
            toast(error.message || 'The font could not be uploaded.', true);
        }
    };

    // ─── brand drawer ────────────────────────────────────────────────

    const openDrawer = () => {
        if (!state.brand) return;
        renderDrawer();
        el.brandDrawer.hidden = false;
        el.drawerBackdrop.hidden = false;
        document.body.style.overflow = 'hidden';
        el.drawerClose.focus();
    };

    const closeDrawer = () => {
        el.brandDrawer.hidden = true;
        el.drawerBackdrop.hidden = true;
        if (el.brandGate.hidden) document.body.style.overflow = '';
        el.brandInfoBtn.focus();
    };

    const drawerSection = (title, build) => {
        const section = make('section', 'drawer-section');
        section.append(make('h4', null, title));
        build(section);
        return section;
    };

    const renderDrawer = () => {
        const brand = state.brand;
        if (!brand) return;
        el.drawerTitle.textContent = brand.name;
        clear(el.drawerBody);

        const hero = make('div', 'drawer-hero');
        const heroUrl = brand.photography?.[0]?.url || '';
        const hasPhoto = Boolean(heroUrl);
        if (hasPhoto) {
            const cover = document.createElement('img');
            cover.className = 'cover';
            cover.src = heroUrl;
            cover.alt = `${brand.name} hero`;
            cover.loading = 'lazy';
            hero.append(cover);
        } else {
            const band = make('div', 'flat-brand');
            band.style.background = flatCoverColor(brand);
            const logoUrl = brand._media?.lightLogoUrl || brand._media?.lightMarkUrl;
            if (logoUrl) {
                const logo = document.createElement('img');
                logo.src = logoUrl;
                logo.alt = `${brand.name} logo`;
                logo.loading = 'lazy';
                band.append(logo);
            } else {
                band.append(make('span', null, brand.wordmark || brand.name));
            }
            hero.append(band);
        }
        const drawerLogo = hasPhoto ? (brand._media?.darkLogoUrl || brand._media?.darkMarkUrl) : null;
        if (drawerLogo) {
            const logo = document.createElement('img');
            logo.className = 'logo';
            logo.src = drawerLogo;
            logo.alt = `${brand.name} logo`;
            hero.append(logo);
        }
        hero.append(make('h3', null, brand.name));
        if (brand.tagline) hero.append(make('p', null, brand.tagline));
        if (brand.guidelines?.positioning) hero.append(make('p', null, brand.guidelines.positioning));
        const links = make('div', 'button-row');
        if (websiteUrl()) {
            const site = document.createElement('a');
            site.className = 'btn';
            site.href = websiteUrl();
            site.target = '_blank';
            site.rel = 'noopener';
            site.textContent = website();
            links.append(site);
        }
        if (brand.guidelines?.docUrl) {
            const guide = document.createElement('a');
            guide.className = 'btn';
            guide.href = brand.guidelines.docUrl;
            guide.target = '_blank';
            guide.rel = 'noopener';
            guide.textContent = 'Download brand guide';
            links.append(guide);
        }
        const manage = document.createElement('a');
        manage.className = 'btn';
        manage.href = 'studio-v2.html';
        manage.textContent = 'Manage in Studio V2';
        links.append(manage);
        if (links.children.length) hero.append(links);
        el.drawerBody.append(hero);

        el.drawerBody.append(drawerSection('Palette', (section) => {
            const grid = make('div', 'swatches');
            (brand.palette || []).forEach((entry) => {
                const swatch = make('div', 'swatch');
                const color = document.createElement('i');
                color.style.setProperty('--hex', entry.hex);
                swatch.append(color, make('span', null, entry.name), make('small', null, `${entry.hex}${entry.role ? ` · ${entry.role}` : ''}`));
                grid.append(swatch);
            });
            section.append(grid);
            const actions = make('div', 'drawer-actions');
            actions.append(button('Apply this palette & type', 'btn wide', () => {
                applyBrandPalette();
                state.fonts = defaultFontsForBrand(brand);
                renderWorkspace();
                closeDrawer();
                toast('Brand palette and type applied.');
            }));
            section.append(actions);
        }));

        const contact = brand.guidelines?.contact || [];
        if (contact.length) {
            el.drawerBody.append(drawerSection('Contact', (section) => {
                const list = make('div', 'type-list');
                contact.forEach((entry) => {
                    const row = make('div', 'type-row');
                    row.append(make('span', null, entry.field || 'Contact'), make('span', null, entry.value || ''));
                    list.append(row);
                });
                section.append(list);
            }));
        }

        const families = fontFamilies(brand);
        if (families.length || brand.typography?.scale?.length) {
            el.drawerBody.append(drawerSection('Typography', (section) => {
                const list = make('div', 'type-list');
                families.forEach((family) => {
                    const row = make('div', 'type-row');
                    const stack = fontStackFor(family);
                    const label = isUploadedFamily(family)
                        ? 'uploaded'
                        : (/Helvetica|Arial|sans-serif/i.test(stack) ? 'sans fallback' : 'serif fallback');
                    row.append(make('span', null, family), make('span', null, label));
                    list.append(row);
                });
                (brand.typography?.scale || []).slice(0, 8).forEach((entry) => {
                    const row = make('div', 'type-row');
                    row.append(make('span', null, entry.id || entry.family), make('span', null, entry.size || entry.note || ''));
                    list.append(row);
                });
                section.append(list);
            }));
        }

        if (brand.logos?.length) {
            el.drawerBody.append(drawerSection('Logos', (section) => {
                const grid = make('div', 'logo-grid');
                brand.logos.slice(0, 12).forEach((logo) => {
                    const card = make('div', 'logo-card');
                    const image = document.createElement('img');
                    image.src = logo.url;
                    image.alt = logo.name || 'Brand logo';
                    image.loading = 'lazy';
                    card.append(image, make('span', null, logo.name || 'Logo'));
                    grid.append(card);
                });
                section.append(grid);
            }));
        }

        if (brand.photography?.length) {
            el.drawerBody.append(drawerSection('Photography', (section) => {
                const grid = make('div', 'photo-grid-wide');
                brand.photography.slice(0, 9).forEach((photo) => {
                    const figure = document.createElement('figure');
                    const image = document.createElement('img');
                    image.src = photo.url;
                    image.alt = photo.name || 'Brand photography';
                    image.loading = 'lazy';
                    figure.append(image, make('figcaption', null, photo.name || 'Photography'));
                    grid.append(figure);
                });
                section.append(grid);
            }));
        }

        const applications = brand.guidelines?.applications || [];
        const voice = brand.voice || {};
        if (brand.guidelines?.positioning || applications.length || voice.attributes?.length) {
            el.drawerBody.append(drawerSection('Guidelines', (section) => {
                if (brand.guidelines?.positioning) section.append(make('p', 'hint', brand.guidelines.positioning));
                if (brand.guidelines?.printSpec) section.append(make('p', 'hint', brand.guidelines.printSpec));
                if (applications.length) {
                    const list = make('div', 'apps-list');
                    applications.slice(0, 8).forEach((application) => {
                        const row = make('div', 'app-row');
                        row.append(make('b', null, application.application || 'Application'));
                        row.append(make('span', null, application.specification || application.scope || ''));
                        list.append(row);
                    });
                    section.append(list);
                }
                if (voice.attributes?.length) {
                    const tags = make('div', 'voice-tags');
                    voice.attributes.forEach((attribute) => tags.append(make('span', null, attribute)));
                    section.append(tags);
                }
                if (voice.prefer?.length) {
                    const label = make('p', 'hint', 'Prefer');
                    label.style.marginTop = '12px';
                    section.append(label);
                    const tags = make('div', 'voice-tags');
                    voice.prefer.slice(0, 12).forEach((word) => tags.append(make('span', null, word)));
                    section.append(tags);
                }
                if (voice.avoid?.length) {
                    const label = make('p', 'hint', 'Avoid');
                    label.style.marginTop = '12px';
                    section.append(label);
                    const tags = make('div', 'voice-tags');
                    voice.avoid.slice(0, 12).forEach((word) => tags.append(make('span', null, word)));
                    section.append(tags);
                }
            }));
        }
    };

    // ─── toast ───────────────────────────────────────────────────────

    const toast = (message, error = false) => {
        window.clearTimeout(toastTimer);
        el.toast.textContent = message;
        el.toast.dataset.error = error ? 'true' : '';
        el.toast.hidden = false;
        toastTimer = window.setTimeout(() => { el.toast.hidden = true; }, 3400);
    };

    // ─── go ──────────────────────────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
