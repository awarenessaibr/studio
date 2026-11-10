'use strict';
/**
 * brand-pack.js — shared brand-pack schema and template builder.
 *
 * A brand pack is the structured result of importing a scraped brand-kit
 * directory: a group (portfolio) plus one or more brands, each with a palette,
 * type system, voice, logo files, photography and the guidelines extracted
 * from its Word brand guide.
 *
 * This module is intentionally dependency-free and runs unchanged in the
 * browser and under Node:
 *
 *   normalizeBrandPack()          read + clamp an imported pack
 *   brandKitFor()                 map a brand to the studio's brand-kit shape
 *   templateCatalog()             the initial template set for a brand
 *   createTemplateComposition()   build a real v3 composition from a template
 *
 * The compositions it emits use only the public composition schema
 * (`studio-core.js`), so every existing render/export/validate path applies.
 *
 * Loaded as a plain <script> after studio-core.js and also require()-able.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StudioBrand = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const PACK_SCHEMA = 'layer-studio/brand-pack/v1';
    const TEMPLATE_SCHEMA = 'layer-studio/brand-template/v1';
    const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
    const HEX_COLOR = /^#[0-9a-f]{6}$/i;
    const MAX_BRAND_SECTIONS = 48;
    const MAX_SECTION_PARAGRAPHS = 14;
    const MAX_PARAGRAPH_CHARS = 900;
    const MAX_APPLICATIONS = 40;
    const MAX_LOGO_ASSETS = 60;
    const MAX_PHOTOS = 120;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
    const round2 = (value) => Math.round(Number(value) * 100) / 100;

    function text(value, limit) {
        if (typeof value !== 'string') return '';
        return value.replace(/\s+/g, ' ').trim().slice(0, limit || 400);
    }

    function titleCase(value) {
        return String(value || '')
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\b[a-z]/g, (char) => char.toUpperCase());
    }

    function slugId(value, fallback) {
        const slug = String(value || '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48);
        return ID_PATTERN.test(slug) ? slug : fallback;
    }

    // ---------------------------------------------------------------------
    // Colour
    // ---------------------------------------------------------------------
    function normalizeHex(value) {
        if (typeof value !== 'string') return '';
        const trimmed = value.trim();
        if (HEX_COLOR.test(trimmed)) return trimmed.toLowerCase();
        const short = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
        if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
        return '';
    }

    function hexToRgb(hex) {
        const value = normalizeHex(hex) || '#000000';
        return {
            r: Number.parseInt(value.slice(1, 3), 16),
            g: Number.parseInt(value.slice(3, 5), 16),
            b: Number.parseInt(value.slice(5, 7), 16),
        };
    }

    /** WCAG relative luminance, 0 (black) to 1 (white). */
    function luminance(hex) {
        const { r, g, b } = hexToRgb(hex);
        const channel = (value) => {
            const c = value / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    }

    function isDark(hex) {
        return luminance(hex) < 0.38;
    }

    function contrastRatio(a, b) {
        const la = luminance(a);
        const lb = luminance(b);
        return round2((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05));
    }

    /**
     * Opacity that keeps secondary ink text at AA on its ground. Templates build
     * hierarchy by fading ink toward the ground, but a fixed 0.6 drops small copy
     * under 4.5:1 on light brands, so the value follows the brand's ink/ground pair.
     */
    function mutedOpacity(bgHex, colorHex, target = 4.8) {
        const bg = hexToRgb(bgHex);
        const fg = hexToRgb(colorHex);
        const blended = (amount) => `#${['r', 'g', 'b']
            .map((key) => Math.round(clamp(bg[key] + (fg[key] - bg[key]) * amount, 0, 255))
                .toString(16).padStart(2, '0')).join('')}`;
        if (contrastRatio(blended(1), bgHex) < target) return 1;
        // More alpha means more foreground, so a passing midpoint lets the
        // search move down. `high` converges on the faintest value that passes.
        let low = 0;
        let high = 1;
        for (let step = 0; step < 20; step += 1) {
            const middle = (low + high) / 2;
            if (contrastRatio(blended(middle), bgHex) >= target) high = middle;
            else low = middle;
        }
        return Math.min(1, Math.max(0.35, Math.ceil(high * 100) / 100));
    }

    /**
     * A tagline is the one line a pack writes to be read, so it carries the
     * display headline and the name stands in when there is none. Authored copy
     * (`content.copy`) wins over every derived slot; the tagline / voice
     * fallback only fills what the copy deck has not written yet. Nothing here
     * is another brand's copy, which is what the templates used to ship.
     */
    function displayLines(brand) {
        const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const tagline = clean(brand?.tagline);
        const name = clean(brand?.name);
        const prefer = (brand?.voice?.prefer || []).map(clean).filter(Boolean);
        const copy = brand?.content?.copy || {};
        const headline = clean(copy.headline) || tagline || name || 'Now open';
        // Each of the four slots says something different: the tagline carries
        // the headline, the name labels it, and the voice's own terms fill the
        // detail line. A pack with neither falls back to neutral wording rather
        // than repeating itself.
        const subhead = clean(copy.subhead) || (name && name !== headline ? name : (prefer[0] || 'Available now'));
        const kicker = clean(copy.kicker) || (headline === name ? (prefer[0] || 'Now open') : (name || 'Open now'));
        const detail = clean(copy.detail) || prefer.slice(0, 3).join('  ·  ') || (subhead !== headline ? subhead : tagline || 'Welcome');
        const phrases = prefer.slice(0, 4);
        const derived = phrases.length
            ? `${phrases.slice(0, -1).join(', ')}${phrases.length > 1 ? ' and ' : ''}${phrases[phrases.length - 1]}.`
            : (tagline && name ? `${name} — ${tagline}` : headline);
        const body = clean(copy.body) || (derived.charAt(0).toUpperCase() + derived.slice(1));
        return { headline, subhead, kicker, detail, body };
    }

    function normalizeColorEntry(entry, key, index) {
        const source = entry && typeof entry === 'object' ? entry : {};
        const hex = normalizeHex(source.hex || source.value || source.color) || '#000000';
        const rgb = Array.isArray(source.rgb) && source.rgb.length >= 3
            ? source.rgb.slice(0, 3).map((part) => clamp(Math.round(finite(part, 0)), 0, 255))
            : (() => {
                const value = hexToRgb(hex);
                return [value.r, value.g, value.b];
            })();
        const cmyk = Array.isArray(source.cmyk) && source.cmyk.length >= 4
            ? source.cmyk.slice(0, 4).map((part) => clamp(Math.round(finite(part, 0)), 0, 100))
            : null;
        const share = Number.isFinite(Number(source.share)) ? clamp(Number(source.share), 0, 100) : 0;
        const tier = ['primary', 'secondary', 'reserved'].includes(source.tier)
            ? source.tier
            : (share > 0 ? 'primary' : 'secondary');
        return {
            key: text(key || source.key || `color-${index + 1}`, 60),
            name: text(source.name, 60) || titleCase(source.label || key || `Colour ${index + 1}`),
            hex,
            rgb,
            cmyk,
            role: text(source.role, 220),
            share,
            tier,
            index,
        };
    }

    function normalizePalette(value) {
        const list = [];
        if (Array.isArray(value)) {
            value.forEach((entry, index) => {
                if (!entry || typeof entry !== 'object') return;
                list.push(normalizeColorEntry(entry, entry.key || entry.name, index));
            });
        } else if (value && typeof value === 'object') {
            Object.keys(value).forEach((key, index) => {
                if (!value[key] || typeof value[key] !== 'object') return;
                list.push(normalizeColorEntry(value[key], key, index));
            });
        }
        return list.slice(0, 40);
    }

    function primaryColors(palette) {
        return palette.filter((entry) => entry.tier === 'primary');
    }

    function darkestColor(palette) {
        return palette.reduce((best, entry) => (!best || luminance(entry.hex) < luminance(best.hex) ? entry : best), null);
    }

    function lightestColor(palette) {
        return palette.reduce((best, entry) => (!best || luminance(entry.hex) > luminance(best.hex) ? entry : best), null);
    }

    // ---------------------------------------------------------------------
    // Typography / voice
    // ---------------------------------------------------------------------
    function weightFromFamily(family) {
        const name = String(family || '').toLowerCase();
        if (/thin|hairline/.test(name)) return 200;
        if (/extra\s*light|extralight|ultra\s*light/.test(name)) return 200;
        if (/semi\s*bold|demibold|demi\s*bold/.test(name)) return 600;
        if (/extra\s*bold|ultra\s*bold/.test(name)) return 800;
        if (/black|heavy/.test(name)) return 800;
        if (/bold/.test(name)) return 700;
        if (/medium/.test(name)) return 500;
        if (/light/.test(name)) return 300;
        return 400;
    }

    function styleFromFamily(family) {
        return /italic|oblique/i.test(String(family || '')) ? 'italic' : 'normal';
    }

    // Families the browser can always resolve. Generated templates substitute
    // these for licensed families and record the mapping in the composition
    // metadata, so an initial creative exports without a font upload while the
    // intended family stays documented.
    const SYSTEM_FAMILIES = new Set([
        'Inter', 'Helvetica', 'Helvetica Neue', 'Arial', 'Georgia', 'Times New Roman',
        'Verdana', 'Tahoma', 'Courier New', 'system-ui', 'ui-sans-serif', 'ui-serif',
        'ui-monospace', '-apple-system', 'sans-serif', 'serif', 'monospace',
    ]);

    function isSystemFamily(family) {
        return SYSTEM_FAMILIES.has(String(family || '').trim());
    }

    function fallbackFontFor(family) {
        const value = String(family || '').toLowerCase();
        if (/serif|practice|cinzel|bell mt|playfair|garamond|baskerville|didot|times|caslon|palatino|georgia/.test(value)) return 'Georgia';
        if (/script|handwrit|ernie|signature/.test(value)) return 'Georgia';
        if (/mono|courier|code/.test(value)) return 'Courier New';
        return 'Helvetica Neue';
    }

    function normalizeTypography(value) {
        const source = value && typeof value === 'object' ? value : {};
        const families = Array.isArray(source.families)
            ? source.families.map((family) => text(family, 80)).filter(Boolean).slice(0, 12)
            : [];
        const scale = [];
        if (Array.isArray(source.scale)) {
            source.scale.forEach((entry, index) => {
                if (!entry || typeof entry !== 'object') return;
                scale.push({
                    id: text(entry.id || `step-${index + 1}`, 40),
                    family: text(entry.family, 80),
                    size: text(entry.size, 80),
                    px: Number.isFinite(Number(entry.px)) ? Math.round(Number(entry.px)) : null,
                    note: text(entry.note, 160),
                });
            });
        } else if (source.scale && typeof source.scale === 'object') {
            Object.keys(source.scale).forEach((key, index) => {
                const entry = source.scale[key];
                if (!entry || typeof entry !== 'object') return;
                scale.push({
                    id: text(key, 40) || `step-${index + 1}`,
                    family: text(entry.family, 80),
                    size: text(entry.size, 80),
                    px: Number.isFinite(Number(entry.px)) ? Math.round(Number(entry.px)) : null,
                    note: text(entry.note, 160),
                });
            });
        }
        // Keep declared families and any family referenced only by the scale.
        scale.forEach((entry) => {
            if (entry.family && !families.some((family) => family.toLowerCase() === entry.family.toLowerCase())) {
                families.push(entry.family);
            }
        });
        return { families: families.slice(0, 12), scale: scale.slice(0, 40) };
    }

    function normalizeStringList(value, limit, max) {
        const list = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/[,;]\s*/) : []);
        return list.map((item) => text(item, limit)).filter(Boolean).slice(0, max || 24);
    }

    function normalizeVoice(value) {
        const source = value && typeof value === 'object' ? value : {};
        return {
            attributes: normalizeStringList(source.attributes, 80, 20),
            prefer: normalizeStringList(source.prefer, 160, 30),
            avoid: normalizeStringList(source.avoid, 160, 30),
        };
    }

    // ---------------------------------------------------------------------
    // Assets
    // ---------------------------------------------------------------------
    function normalizeAssetUrl(value) {
        if (typeof value !== 'string') return '';
        const url = value.trim();
        if (!url || url.length > 2048) return '';
        if (url.startsWith('data:image/')) return url;
        if (/^https?:\/\//i.test(url)) return url;
        // Relative and root-relative assets may be percent-encoded (a space in
        // a file name becomes %20) and may use parentheses or brackets.
        if (/^\/[^\s"'<>\\]+$/.test(url) && !url.split('/').includes('..')) return url;
        if (/^[A-Za-z0-9._~%()+,@\-/]+\.(?:png|jpe?g|gif|webp|svg|avif)$/i.test(url)
            && !url.split('/').includes('..')) return url;
        return '';
    }

    function fileExtension(name) {
        const match = String(name || '').match(/\.([a-z0-9]+)$/i);
        return match ? match[1].toLowerCase() : '';
    }

    function logoVariant(name) {
        const lower = String(name || '').toLowerCase();
        if (/white|chalk|reversed|negative|on-dark/.test(lower)) return 'light';
        if (/black|ink|dark|on-light/.test(lower)) return 'dark';
        if (/brass|vermilion|plum|sand|gold|colour|color/.test(lower)) return 'color';
        return 'primary';
    }

    function logoKind(name) {
        const lower = String(name || '').toLowerCase();
        if (/wordmark|lockup|script|logotype/.test(lower)) return 'wordmark';
        if (/monogram|icon|symbol|mark|roundel|favicon/.test(lower)) return 'mark';
        return 'logo';
    }

    function isPresentationAsset(name) {
        return /(?:^|[\s\-_.])(plate|crop|sheet|contact-sheet|cover)(?:[\s\-_.]|$)/i.test(String(name || ''));
    }

    function normalizeLogo(entry, index) {
        const source = entry && typeof entry === 'object' ? entry : {};
        const url = normalizeAssetUrl(source.url);
        if (!url) return null;
        const name = text(source.name, 80) || `Logo ${index + 1}`;
        return {
            name,
            url,
            path: text(source.path, 240),
            variant: ['light', 'dark', 'color', 'primary'].includes(source.variant)
                ? source.variant
                : logoVariant(name),
            kind: ['mark', 'wordmark', 'logo'].includes(source.kind) ? source.kind : logoKind(name),
            format: text(source.format, 12) || fileExtension(name),
            width: Number.isFinite(Number(source.width)) ? Math.round(Number(source.width)) : null,
            height: Number.isFinite(Number(source.height)) ? Math.round(Number(source.height)) : null,
            presentation: source.presentation === true || isPresentationAsset(name),
        };
    }

    function normalizeLogos(value) {
        if (!Array.isArray(value)) return [];
        return value.map(normalizeLogo).filter(Boolean).slice(0, MAX_LOGO_ASSETS);
    }

    function normalizePhotos(value) {
        if (!Array.isArray(value)) return [];
        return value.map((entry, index) => {
            const source = entry && typeof entry === 'object' ? entry : {};
            const url = normalizeAssetUrl(source.url);
            if (!url) return null;
            return {
                name: text(source.name, 80) || `Photograph ${index + 1}`,
                url,
                path: text(source.path, 240),
                width: Number.isFinite(Number(source.width)) ? Math.round(Number(source.width)) : null,
                height: Number.isFinite(Number(source.height)) ? Math.round(Number(source.height)) : null,
            };
        }).filter(Boolean).slice(0, MAX_PHOTOS);
    }

    function normalizeGallery(value) {
        if (!Array.isArray(value)) return [];
        return value.map((entry, index) => {
            const source = entry && typeof entry === 'object' ? entry : {};
            const url = normalizeAssetUrl(source.url);
            if (!url) return null;
            return {
                name: text(source.name, 80) || `Asset ${index + 1}`,
                url,
                path: text(source.path, 240),
                width: Number.isFinite(Number(source.width)) ? Math.round(Number(source.width)) : null,
                height: Number.isFinite(Number(source.height)) ? Math.round(Number(source.height)) : null,
            };
        }).filter(Boolean).slice(0, MAX_PHOTOS);
    }

    // ---------------------------------------------------------------------
    // Guidelines (produced by brand-docx.js on the server)
    // ---------------------------------------------------------------------
    function normalizePairs(value, keys) {
        const [firstKey, secondKey] = keys;
        if (Array.isArray(value)) {
            return value.map((entry) => {
                if (typeof entry === 'string') return { [firstKey]: text(entry, 240) };
                const source = entry && typeof entry === 'object' ? entry : {};
                const result = {};
                Object.keys(source).forEach((key) => {
                    result[key] = text(source[key], 400);
                });
                return result;
            }).filter((entry) => Object.values(entry).some(Boolean));
        }
        if (value && typeof value === 'object') {
            return Object.keys(value).map((key) => ({
                [firstKey]: text(key, 120),
                [secondKey]: text(value[key], 400),
            }));
        }
        return [];
    }

    function normalizeGuidelineTable(value) {
        if (!Array.isArray(value)) return [];
        return value.map((table) => {
            const source = table && typeof table === 'object' ? table : {};
            return {
                head: normalizeStringList(source.head, 80, 12),
                rows: Array.isArray(source.rows)
                    ? source.rows.slice(0, 40).map((row) => (Array.isArray(row) ? row : [])
                        .slice(0, 12).map((cell) => text(cell, 400)))
                    : [],
            };
        }).filter((table) => table.rows.length).slice(0, 24);
    }

    function normalizeSections(value) {
        if (!Array.isArray(value)) return [];
        return value.slice(0, MAX_BRAND_SECTIONS).map((section) => {
            const source = section && typeof section === 'object' ? section : {};
            return {
                level: Number.isFinite(Number(source.level)) ? clamp(Math.round(Number(source.level)), 1, 4) : 2,
                heading: text(source.heading, 200),
                paragraphs: (Array.isArray(source.paragraphs) ? source.paragraphs : [])
                    .map((paragraph) => text(paragraph, MAX_PARAGRAPH_CHARS))
                    .filter(Boolean)
                    .slice(0, MAX_SECTION_PARAGRAPHS),
                tables: normalizeGuidelineTable(source.tables),
            };
        }).filter((section) => section.heading || section.paragraphs.length || section.tables.length);
    }

    function normalizeGuidelines(value) {
        const source = value && typeof value === 'object' ? value : {};
        return {
            positioning: text(source.positioning, 1200),
            applications: (Array.isArray(source.applications) ? source.applications : []).map((entry) => {
                const item = entry && typeof entry === 'object' ? entry : {};
                return {
                    application: text(item.application, 160),
                    specification: text(item.specification, 800),
                    scope: text(item.scope, 400),
                };
            }).filter((entry) => entry.application).slice(0, MAX_APPLICATIONS),
            printSpec: normalizePairs(source.printSpec, ['item', 'specification']).slice(0, 40),
            contact: normalizePairs(source.contact, ['field', 'value']).slice(0, 40),
            facts: normalizePairs(source.facts, ['field', 'value']).slice(0, 40),
            typeHierarchy: (Array.isArray(source.typeHierarchy) ? source.typeHierarchy : []).map((entry) => {
                const item = entry && typeof entry === 'object' ? entry : {};
                return {
                    role: text(item.role, 120),
                    typeface: text(item.typeface, 160),
                    size: text(item.size, 160),
                    notes: text(item.notes, 400),
                };
            }).filter((entry) => entry.role || entry.typeface).slice(0, 40),
            logoRules: normalizePairs(source.logoRules, ['rule', 'specification']).slice(0, 40),
            docTitle: text(source.docTitle, 200),
            docUrl: normalizeAssetUrl(source.docUrl),
            sections: normalizeSections(source.sections),
        };
    }

    // ---------------------------------------------------------------------
    // Brand / pack normalization
    // ---------------------------------------------------------------------

    /**
     * Authored copy for a brand. A crawler pack can carry structured facts
     * (menu, hours) but the words that go on the artwork still need writing:
     * this block is the single place for the headline, the body, the dish
     * special, the voucher terms and the festive campaign. Templates and Asset
     * Studio read it instead of falling back to another venue's sample copy.
     */
    function normalizeCopy(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const out = {};
        const strings = [
            ['eyebrow', 120], ['headline', 180], ['subhead', 120], ['kicker', 60],
            ['detail', 200], ['body', 600], ['cta', 60], ['tag', 180], ['boldTitle', 120],
            ['kind', 40],
        ];
        strings.forEach(([key, limit]) => {
            const entry = text(value[key], limit);
            if (entry) out[key] = entry;
        });
        const group = (key, fields) => {
            const source = value[key];
            if (!source || typeof source !== 'object' || Array.isArray(source)) return;
            const block = {};
            fields.forEach(([field, limit]) => {
                const entry = text(source[field], limit);
                if (entry) block[field] = entry;
            });
            if (Object.keys(block).length) out[key] = block;
        };
        group('special', [
            ['kicker', 60], ['dish', 140], ['description', 260], ['price', 40], ['note', 200],
        ]);
        group('menu', [['title', 80], ['kicker', 40]]);
        group('voucher', [
            ['title', 80], ['value', 40], ['terms', 400], ['message', 200],
        ]);
        group('festive', [
            ['title', 140], ['date', 120], ['price', 80], ['body', 400], ['message', 200],
        ]);
        const dishes = Array.isArray(value.festive?.dishes) ? value.festive.dishes : [];
        const festiveDishes = dishes.slice(0, 12).map((dish) => ({
            name: text(dish?.name, 140),
            description: text(dish?.description, 220),
        })).filter((dish) => dish.name);
        if (festiveDishes.length) {
            out.festive = { ...(out.festive || {}), dishes: festiveDishes };
        }
        group('card', [['name', 80], ['role', 80]]);
        group('campaign', [
            ['rangeKicker', 60], ['rangeTitle', 140], ['rangeBody', 300],
            ['resellerKicker', 60], ['resellerTitle', 140], ['resellerBody', 300],
            ['resellerPhone', 60], ['resellerEmail', 120],
            ['premiumKicker', 60], ['premiumTitle', 140], ['premiumBody', 300],
            ['premiumBadge', 80],
        ]);
        return Object.keys(out).length ? out : null;
    }

    // ---------------------------------------------------------------------
    // Menus, venue hire and the content assets built from them
    // ---------------------------------------------------------------------

    const MENU_KINDS = ['food', 'drinks', 'kids', 'functions', 'christmas', 'desserts', 'canapes', 'buffet', 'other'];
    const DIETARY_MARKS = ['V', 'Ve', 'GFi', 'GF', 'DF', 'Vg'];
    const MAX_MENUS = 12;
    const MAX_MENU_SECTIONS = 16;
    const MAX_MENU_ITEMS = 60;

    // A brand can carry documents as well as images; the same no-`..` rule
    // applies, but PDFs, Office files and text are allowed where an image
    // would not be.
    function normalizeDocPath(value) {
        if (typeof value !== 'string') return '';
        const file = value.trim().slice(0, 240);
        if (!file || file.split('/').includes('..') || file.startsWith('http')) return '';
        return /^[A-Za-z0-9._~%()+,@\-/ ]+\.(?:pdf|docx?|xlsx?|csv|txt|md)$/i.test(file) ? file : '';
    }

    // Room photography is referenced by pack-relative path (the photography
    // list carries the served URL); the same no-`..` rule applies.
    function normalizeImagePath(value) {
        if (typeof value !== 'string') return '';
        const file = value.trim().slice(0, 240);
        if (!file || file.split('/').includes('..') || file.startsWith('http')) return '';
        return /^[A-Za-z0-9._~%()+,@\-/ ]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(file) ? file : '';
    }

    // A menu is dated material: prices and dishes change, and a poster that
    // quotes a retired price is worse than no poster. `validFrom`/`validTo`
    // stay on the menu so the studio can say how old a price is.
    function normalizeMenuDate(value) {
        const entry = text(value, 20);
        return /^\d{4}-\d{2}(?:-\d{2})?$/.test(entry) ? entry : '';
    }

    function normalizeDietary(value) {
        const list = Array.isArray(value)
            ? value
            : (typeof value === 'string' ? value.split(/[,/|]\s*/) : []);
        const seen = [];
        list.forEach((entry) => {
            const mark = text(entry, 12);
            if (!mark) return;
            const canonical = DIETARY_MARKS.find((code) => code.toLowerCase() === mark.toLowerCase())
                || (/^(?:gf|gluten.?free)$/i.test(mark) ? 'GFi'
                    : (/^(?:v|veggie|vegetarian)$/i.test(mark) ? 'V'
                        : (/^(?:ve|vegan)$/i.test(mark) ? 'Ve' : '')));
            if (canonical && !seen.includes(canonical)) seen.push(canonical);
        });
        return seen.slice(0, 6);
    }

    function normalizeMenuItems(value) {
        if (!Array.isArray(value)) return [];
        return value.slice(0, MAX_MENU_ITEMS).map((item) => {
            const entry = item && typeof item === 'object' ? item : {};
            return {
                name: text(entry.name, 140),
                description: text(entry.description, 260),
                price: text(entry.price, 40),
                note: text(entry.note, 160),
                dietary: normalizeDietary(entry.dietary),
            };
        }).filter((item) => item.name);
    }

    function normalizeMenuSections(value) {
        if (!Array.isArray(value)) return [];
        return value.slice(0, MAX_MENU_SECTIONS).map((section) => {
            const entry = section && typeof section === 'object' ? section : {};
            const items = normalizeMenuItems(entry.items);
            return {
                name: text(entry.name, 80),
                note: text(entry.note, 240),
                price: text(entry.price, 60),
                items,
            };
        }).filter((section) => section.items.length || section.name);
    }

    function normalizeMenuPackages(value) {
        if (!Array.isArray(value)) return [];
        return value.slice(0, 12).map((pack) => {
            const entry = pack && typeof pack === 'object' ? pack : {};
            return {
                name: text(entry.name, 80),
                description: text(entry.description, 320),
                price: text(entry.price, 60),
                unit: text(entry.unit, 40),
                minOrder: text(entry.minOrder, 60),
                includes: normalizeStringList(entry.includes, 120, 10),
            };
        }).filter((pack) => pack.name);
    }

    function normalizeMenu(value, index) {
        const entry = value && typeof value === 'object' ? value : {};
        const sections = normalizeMenuSections(entry.sections);
        const packages = normalizeMenuPackages(entry.packages);
        if (!sections.length && !packages.length) return null;
        const name = text(entry.name || entry.title, 80) || `Menu ${index + 1}`;
        const source = entry.source && typeof entry.source === 'object' ? entry.source : {};
        return {
            id: slugId(entry.id || name, `menu-${index + 1}`).slice(0, 60),
            name,
            kind: MENU_KINDS.includes(entry.kind) ? entry.kind : 'food',
            branches: normalizeStringList(entry.branches, 40, 8),
            summary: text(entry.summary, 300),
            availability: text(entry.availability, 160),
            serves: normalizeStringList(entry.serves, 40, 8),
            validFrom: normalizeMenuDate(entry.validFrom),
            validTo: normalizeMenuDate(entry.validTo),
            priceNote: text(entry.priceNote, 120),
            dietaryKey: normalizeStringList(entry.dietaryKey, 200, 6),
            notes: normalizeStringList(entry.notes, 240, 8),
            source: {
                document: normalizeDocPath(source.document),
                page: Number.isFinite(Number(source.page)) ? Math.max(1, Math.round(Number(source.page))) : null,
                note: text(source.note, 200),
            },
            sections,
            packages,
        };
    }

    /**
     * A brand's menus. `menus` is the full list; the older single `menu` /
     * `drinks` blocks are still honoured and folded into the same list so a
     * crawler pack written before this shape keeps working. The projections
     * back to `menu` / `drinks` happen in normalizeContent, which is what
     * Asset Studio and the template builders already read.
     */
    function normalizeMenus(value) {
        const menus = [];
        const add = (entry) => {
            const menu = normalizeMenu(entry, menus.length);
            if (menu && !menus.some((existing) => existing.id === menu.id)) menus.push(menu);
        };
        (Array.isArray(value) ? value : []).forEach(add);
        return menus.slice(0, MAX_MENUS);
    }

    function normalizeVenue(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const source = value;
        const hire = source.hire && typeof source.hire === 'object' ? source.hire : {};
        const faqs = (Array.isArray(source.faqs) ? source.faqs : []).slice(0, 20).map((faq) => {
            const entry = faq && typeof faq === 'object' ? faq : {};
            return { q: text(entry.q || entry.question, 200), a: text(entry.a || entry.answer, 800) };
        }).filter((faq) => faq.q && faq.a);
        const entertainment = (Array.isArray(source.entertainment) ? source.entertainment : [])
            .slice(0, 10).map((entry) => {
                const item = entry && typeof entry === 'object' ? entry : {};
                return {
                    name: text(item.name, 100),
                    detail: text(item.detail, 300),
                    price: text(item.price, 80),
                };
            }).filter((item) => item.name);
        const offers = (Array.isArray(source.offers) ? source.offers : []).slice(0, 16).map((entry) => {
            const item = entry && typeof entry === 'object' ? entry : {};
            return {
                id: slugId(item.id || item.title, 'offer').slice(0, 60),
                title: text(item.title, 80),
                detail: text(item.detail, 220),
                price: text(item.price, 60),
                branches: normalizeStringList(item.branches, 40, 8),
                menuId: text(item.menuId, 60),
            };
        }).filter((item) => item.title);
        // A townhouse can be hired room by room, and a hire brief needs the
        // capacity, AV and access of each one — not a paragraph of prose.
        const rooms = (Array.isArray(source.rooms) ? source.rooms : []).slice(0, 12).map((entry, index) => {
            const item = entry && typeof entry === 'object' ? entry : {};
            const gallery = (Array.isArray(item.gallery) ? item.gallery : [])
                .map(normalizeImagePath).filter(Boolean).slice(0, 24);
            return {
                id: slugId(item.id || item.name, `room-${index + 1}`).slice(0, 60),
                name: text(item.name, 80),
                location: text(item.location, 140),
                capacity: text(item.capacity, 180),
                layout: text(item.layout, 300),
                av: text(item.av, 240),
                toilets: text(item.toilets, 240),
                accessibility: text(item.accessibility, 300),
                available: text(item.available, 180),
                features: normalizeStringList(item.features, 160, 10),
                image: normalizeImagePath(item.image),
                gallery,
                url: normalizeAssetUrl(item.url),
                brochurePage: Number.isFinite(Number(item.brochurePage))
                    ? Math.max(1, Math.round(Number(item.brochurePage)))
                    : null,
                note: text(item.note, 300),
            };
        }).filter((item) => item.name);
        // `hire.*` is the nested shape a hand-written file may use; the flat
        // fields are what this function writes back. Reading both keeps a
        // saved pack idempotent — re-normalising it must not drop the fee.
        const pick = (field, limit, flat) => text(hire[field] || source[field] || flat, limit);
        const out = {
            name: text(source.name, 120),
            hireFee: pick('fee', 60, source.hireFee),
            hireFeeNote: pick('note', 240, source.hireFeeNote),
            minimumSpend: pick('minimumSpend', 60, source.minimumSpend),
            deposit: pick('deposit', 60, source.deposit),
            minGuests: pick('minGuests', 40, source.minGuests),
            maxGuests: pick('maxGuests', 40, source.maxGuests),
            minCatering: pick('minCatering', 40, source.minCatering),
            exclusiveUse: pick('exclusiveUse', 160, source.exclusiveUse),
            setupFrom: pick('setupFrom', 60, source.setupFrom),
            arrivalFrom: pick('arrivalFrom', 60, source.arrivalFrom),
            lastOrders: pick('lastOrders', 60, source.lastOrders),
            closes: pick('closes', 60, source.closes),
            capacityNote: text(source.capacityNote, 300),
            accessibility: text(source.accessibility, 500),
            parking: text(source.parking, 500),
            decorations: text(source.decorations, 500),
            music: text(source.music, 500),
            drinks: text(source.drinks, 500),
            catering: normalizeStringList(source.catering, 200, 10),
            occasions: normalizeStringList(source.occasions, 80, 12),
            terms: normalizeStringList(source.terms, 300, 24),
            notes: normalizeStringList(source.notes, 300, 10),
            faqs,
            entertainment,
            rooms,
            offers,
        };
        const filled = Object.values(out).some((entry) => (
            Array.isArray(entry) ? entry.length > 0 : typeof entry === 'string' ? entry.length > 0 : false
        ));
        return filled ? out : null;
    }

    function normalizeLocations(value) {
        if (!Array.isArray(value)) return [];
        return value.slice(0, 8).map((entry, index) => {
            const item = entry && typeof entry === 'object' ? entry : {};
            const name = text(item.name, 80);
            const id = slugId(item.id || name, `location-${index + 1}`).slice(0, 60);
            if (!name) return null;
            const hours = {};
            if (item.hours && typeof item.hours === 'object' && !Array.isArray(item.hours)) {
                Object.entries(item.hours).slice(0, 7).forEach(([day, label]) => {
                    const value = text(label, 60);
                    if (value) hours[text(day, 12)] = value;
                });
            }
            return {
                id,
                name,
                address: text(item.address, 200),
                postcode: text(item.postcode, 20),
                email: text(item.email, 120),
                phone: text(item.phone, 40),
                mapUrl: normalizeAssetUrl(item.mapUrl),
                hours: Object.keys(hours).length ? hours : null,
            };
        }).filter(Boolean);
    }

    function normalizeDocuments(value) {
        if (!Array.isArray(value)) return [];
        return value.slice(0, 24).map((entry) => {
            const item = entry && typeof entry === 'object' ? entry : {};
            const path = normalizeDocPath(item.path);
            const title = text(item.title, 160);
            if (!path || !title) return null;
            return {
                title,
                path,
                kind: text(item.kind, 40) || 'document',
                pages: Number.isFinite(Number(item.pages)) ? Math.max(1, Math.round(Number(item.pages))) : null,
                updated: normalizeMenuDate(item.updated),
                branch: text(item.branch, 60),
                note: text(item.note, 240),
                menuIds: normalizeStringList(item.menuIds, 60, 12),
            };
        }).filter(Boolean);
    }

    function normalizeContent(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const out = {};
        // One menus list, fed by both the rich `menus` array and the older
        // single `menu` / `drinks` blocks (a crawler pack writes those).
        const menus = normalizeMenus(value.menus);
        // Fold the older blocks in only when the full list is absent: a saved
        // pack carries both, and re-normalizing it must not duplicate them.
        if (!menus.length) {
            [['menu', 'food'], ['drinks', 'drinks']].forEach(([key, kind]) => {
                const legacy = value[key];
                if (!legacy || typeof legacy !== 'object' || !Array.isArray(legacy.sections)) return;
                const folded = normalizeMenu({
                    id: key,
                    name: legacy.title || (kind === 'drinks' ? 'Drinks' : 'Menu'),
                    kind,
                    sections: legacy.sections,
                }, menus.length);
                if (folded && !menus.some((menu) => menu.id === folded.id)) menus.push(folded);
            });
        }
        if (menus.length) {
            out.menus = menus;
            // Projections for the readers that predate the menus list.
            const primary = menus.find((menu) => menu.kind === 'food') || menus[0];
            const drinks = menus.find((menu) => menu.kind === 'drinks');
            if (primary) out.menu = { title: primary.name, sections: primary.sections };
            if (drinks) out.drinks = { title: drinks.name, sections: drinks.sections };
        }
        const venue = normalizeVenue(value.venue);
        if (venue) out.venue = venue;
        const locations = normalizeLocations(value.locations);
        if (locations.length) out.locations = locations;
        const documents = normalizeDocuments(value.documents);
        if (documents.length) out.documents = documents;
        if (value.hours && typeof value.hours === 'object' && !Array.isArray(value.hours)) {
            const hours = {};
            Object.entries(value.hours).slice(0, 7).forEach(([day, hoursText]) => {
                const label = text(hoursText, 60);
                if (label) hours[text(day, 12)] = label;
            });
            if (Object.keys(hours).length) out.hours = hours;
        }
        const bookingUrl = normalizeAssetUrl(value.bookingUrl);
        if (bookingUrl) out.bookingUrl = bookingUrl;
        const copy = normalizeCopy(value.copy);
        if (copy) out.copy = copy;
        return Object.keys(out).length ? out : null;
    }

    // ---------------------------------------------------------------------
    // Menus as draggable content assets
    // ---------------------------------------------------------------------
    //
    // The studio panel, Asset Studio and the library all want the same thing
    // from a menu: one line per dish that a design can take without more
    // parsing. These helpers own that format so the surfaces cannot drift:
    //
    //   Name | Description | £Price      one dish, currency trailing
    //   # Section name                   a heading in the same text block

    const MENU_ITEM_SEPARATOR = ' | ';

    function menuDietaryLabel(item) {
        const marks = Array.isArray(item?.dietary) ? item.dietary : [];
        return marks.length ? ` (${marks.join(', ')})` : '';
    }

    function menuItemLine(item) {
        if (!item || !item.name) return '';
        const description = [item.description, menuDietaryLabel(item)].filter(Boolean).join('').trim();
        return [item.name, description, item.price || ''].join(MENU_ITEM_SEPARATOR).trim();
    }

    function menuSectionHeading(section) {
        const name = text(section?.name, 80);
        if (!name) return '';
        return section?.price ? `# ${name} · ${text(section.price, 60)}` : `# ${name}`;
    }

    function menuSectionText(section) {
        if (!section) return '';
        const lines = [];
        const heading = menuSectionHeading(section);
        if (heading) lines.push(heading);
        (Array.isArray(section.items) ? section.items : []).forEach((item) => {
            const line = menuItemLine(item);
            if (line) lines.push(line);
        });
        if (section.note) lines.push(section.note);
        return lines.join('\n');
    }

    function menuText(menu) {
        if (!menu) return '';
        return (Array.isArray(menu.sections) ? menu.sections : [])
            .map(menuSectionText)
            .filter(Boolean)
            .join('\n');
    }

    /**
     * The menus a branch can use. A menu with no `branches` is the brand's,
     * every branch included; a menu that names branches is only offered there
     * (the Garnethill function menus do not belong on a Merchant City poster).
     */
    function menusFor(brand, branchId) {
        const menus = Array.isArray(brand?.content?.menus) ? brand.content.menus : [];
        const branch = String(branchId || '');
        return branch ? menus.filter((menu) => !menu.branches?.length || menu.branches.includes(branch)) : menus;
    }

    function menuRows(brand, menuId, branchId) {
        const menus = menusFor(brand, branchId);
        const menu = (menuId && menus.find((entry) => entry.id === menuId)) || menus[0];
        if (!menu) return [];
        return menuText(menu).split('\n').filter(Boolean);
    }

    function branchesOfBrand(brand) {
        const locations = Array.isArray(brand?.content?.locations) ? brand.content.locations : [];
        return locations.map((location) => ({ id: location.id, name: location.name }));
    }

    function branchLabel(brand, ids) {
        const list = Array.isArray(ids) ? ids : [];
        if (!list.length) return '';
        const locations = Array.isArray(brand?.content?.locations) ? brand.content.locations : [];
        const names = list.map((id) => locations.find((location) => location.id === id)?.name || titleCase(id));
        return names.join(' & ');
    }

    /**
     * Everything a menu or a venue can hand to a design, flat and addressed by
     * a stable id. The id is safe inside a drag payload (`kind:id`), so a drop
     * target only needs to look the asset up in this list.
     */
    function contentAssets(brand, options) {
        const opts = options || {};
        const menus = menusFor(brand, opts.branch);
        const groups = [];
        const assets = [];
        menus.forEach((menu) => {
            const itemCount = menu.sections.reduce((sum, section) => sum + (section.items?.length || 0), 0);
            const where = branchLabel(brand, menu.branches);
            const meta = [where, menu.availability, itemCount ? `${itemCount} items` : '']
                .filter(Boolean).join(' · ');
            const group = {
                id: menu.id,
                label: menu.name,
                kind: menu.kind,
                summary: menu.summary,
                availability: menu.availability,
                meta,
                validFrom: menu.validFrom,
                validTo: menu.validTo,
                assets: [],
            };
            const push = (asset) => {
                if (!asset || !asset.text) return;
                group.assets.push(asset.id);
                assets.push({ ...asset, group: menu.id, groupLabel: menu.name, branch: opts.branch || '' });
            };
            push({
                id: `menu-${menu.id}`,
                kind: 'menu',
                format: 'menu-list',
                label: menu.name,
                text: menuText(menu),
                meta,
                detail: menu.summary,
                price: menu.priceNote,
                menuId: menu.id,
            });
            (menu.packages || []).forEach((pack, index) => {
                push({
                    id: `menu-${menu.id}-pack-${index}`,
                    kind: 'package',
                    format: 'offer',
                    label: pack.name,
                    text: [pack.name, pack.description || pack.includes?.join(', '), pack.price].filter(Boolean).join(MENU_ITEM_SEPARATOR),
                    meta: [pack.minOrder, pack.unit].filter(Boolean).join(' · '),
                    detail: pack.description,
                    price: pack.price,
                    menuId: menu.id,
                    item: pack,
                });
            });
            menu.sections.forEach((section, sectionIndex) => {
                push({
                    id: `menu-${menu.id}-s${sectionIndex}`,
                    kind: 'section',
                    format: 'menu-list',
                    label: section.name || `Section ${sectionIndex + 1}`,
                    text: menuSectionText(section),
                    meta: [section.price, section.items?.length ? `${section.items.length} items` : '']
                        .filter(Boolean).join(' · '),
                    detail: section.note,
                    price: section.price,
                    menuId: menu.id,
                    sectionName: section.name,
                    sectionIndex,
                });
                (section.items || []).forEach((item, itemIndex) => {
                    push({
                        id: `menu-${menu.id}-s${sectionIndex}-i${itemIndex}`,
                        kind: 'item',
                        format: 'menu-item',
                        label: item.name,
                        text: menuItemLine(item),
                        meta: [section.name, item.price].filter(Boolean).join(' · '),
                        detail: [item.description, item.note].filter(Boolean).join(' · '),
                        price: item.price,
                        menuId: menu.id,
                        sectionName: section.name,
                        sectionIndex,
                        itemIndex,
                        item,
                    });
                });
            });
            groups.push(group);
        });
        const venue = brand?.content?.venue;
        const offers = [];
        (Array.isArray(venue?.offers) ? venue.offers : []).forEach((offer, index) => {
            if (opts.branch && offer.branches?.length && !offer.branches.includes(opts.branch)) return;
            const asset = {
                id: `venue-${offer.id || index}`,
                kind: 'offer',
                format: 'offer',
                label: offer.title,
                text: [offer.title, offer.detail, offer.price].filter(Boolean).join(MENU_ITEM_SEPARATOR),
                meta: branchLabel(brand, offer.branches),
                detail: offer.detail,
                price: offer.price,
                group: 'venue',
                groupLabel: 'Venue & functions',
                branch: opts.branch || '',
            };
            offers.push(asset);
            assets.push(asset);
        });
        // A room is a hire product too: a designer should be able to drop
        // "The Drawing Room · 2 long tables of 20" as a card, not retype it.
        const rooms = [];
        (Array.isArray(venue?.rooms) ? venue.rooms : []).forEach((room) => {
            const asset = {
                id: `room-${room.id}`,
                kind: 'room',
                format: 'offer',
                label: room.name,
                text: [
                    room.name,
                    [room.capacity, room.location].filter(Boolean).join(' · '),
                    '',
                ].join(MENU_ITEM_SEPARATOR),
                meta: [room.available, room.capacity].filter(Boolean).join(' · '),
                detail: [room.layout, room.av].filter(Boolean).join(' · '),
                price: '',
                group: 'venue',
                groupLabel: 'Venue & functions',
                branch: opts.branch || '',
                roomId: room.id,
                photo: room.image || '',
            };
            rooms.push(asset);
            assets.push(asset);
        });
        return {
            branch: opts.branch || '',
            menus: menus.map((menu) => ({
                id: menu.id,
                name: menu.name,
                kind: menu.kind,
                summary: menu.summary,
                availability: menu.availability,
                validFrom: menu.validFrom,
                validTo: menu.validTo,
                branches: menu.branches,
                priceNote: menu.priceNote,
            })),
            groups,
            offers,
            rooms,
            assets,
            venue: venue || null,
        };
    }

    /**
     * Social evidence attached to a brand from the social crawler. The raw
     * profile stays in `<brand>/social/`; this is the bounded summary a
     * template, a brief or the Brand identity dialog can read without opening
     * the crawler's JSON. A brand the crawler has not reached keeps a
     * `not-crawled` marker rather than a fabricated empty footprint.
     */
    function normalizeSocial(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const source = value;
        const status = text(source.status, 40);
        // A venue the crawler has not reached is a known gap, not an empty
        // footprint. Keep the marker so a scorecard can say "not yet prepared"
        // instead of rendering a row of zeros.
        if (status && !source.reputation && !source.socialPresence) {
            return { status, note: text(source.note, 240) };
        }
        const obj = (entry) => (entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {});
        const num = (entry) => (Number.isFinite(Number(entry)) ? Number(entry) : null);
        const safePath = (entry) => {
            const file = text(entry, 240);
            return file && !file.split('/').includes('..') ? file : '';
        };
        const list = (entry, limit, max) => normalizeStringList(entry, limit, max);

        const files = obj(source.files);
        const reputation = obj(source.reputation);
        const presence = obj(source.socialPresence);
        const web = obj(source.webPresence);
        const voice = obj(source.voice);
        const reading = obj(source.reading);
        const scores = obj(source.scores);
        const sentiment = obj(reputation.sentiment);
        const totals = obj(presence.totals);

        const perSource = {};
        Object.entries(obj(reputation.perSource)).slice(0, 12).forEach(([key, entry]) => {
            const rating = obj(entry);
            perSource[text(key, 40)] = { rating: num(rating.rating), count: num(rating.count) };
        });

        const redFlags = (Array.isArray(reputation.redFlags) ? reputation.redFlags : [])
            .slice(0, 8)
            .map((flag) => {
                const entry = obj(flag);
                return {
                    level: text(entry.level, 20),
                    issue: text(entry.issue, 120),
                    detail: text(entry.detail, 240),
                };
            })
            .filter((flag) => flag.issue);

        const platforms = (Array.isArray(presence.platforms) ? presence.platforms : [])
            .slice(0, 10)
            .map((platform) => {
                const entry = obj(platform);
                return {
                    platform: text(entry.platform, 40),
                    label: text(entry.label, 60),
                    url: normalizeAssetUrl(entry.url),
                    handle: text(entry.handle, 120),
                    present: entry.present === true,
                    followers: num(entry.followers),
                    lastPost: text(entry.lastPost, 40),
                };
            })
            .filter((platform) => platform.platform);

        const actions = (Array.isArray(source.actions) ? source.actions : [])
            .slice(0, 10)
            .map((action) => {
                const entry = obj(action);
                return {
                    code: text(entry.code, 60),
                    severity: text(entry.severity, 20),
                    title: text(entry.title, 160),
                    detail: text(entry.detail, 300),
                };
            })
            .filter((action) => action.title);

        const hygiene = obj(reputation.foodHygiene);
        const foodHygiene = Object.keys(hygiene).length ? {
            authority: text(hygiene.authority, 80),
            scheme: text(hygiene.scheme, 20),
            rating: text(hygiene.rating, 40),
            passed: hygiene.passed === true,
            inspectedAt: text(hygiene.inspectedAt || hygiene.inspection_date, 40),
            sourceUrl: normalizeAssetUrl(hygiene.sourceUrl || hygiene.source_url),
        } : null;

        const social = {
            status: text(source.status, 20) || 'crawled',
            slug: text(source.slug, 120),
            business: text(source.business, 160),
            run: text(source.run, 120),
            crawledAt: text(source.crawledAt, 40),
            note: text(source.note, 400),
            files: {
                profile: safePath(files.profile),
                tokens: safePath(files.tokens),
                insights: safePath(files.insights),
                report: safePath(files.report),
                reviews: safePath(files.reviews),
            },
            reputation: {
                consensusRating: num(reputation.consensusRating),
                totalReviews: num(reputation.totalReviews),
                collectedReviews: num(reputation.collectedReviews),
                perSource,
                sentiment: {
                    mean: num(sentiment.mean),
                    positive: num(sentiment.positive),
                    neutral: num(sentiment.neutral),
                    negative: num(sentiment.negative),
                    positiveShare: num(sentiment.positiveShare),
                    negativeShare: num(sentiment.negativeShare),
                },
                ownerResponseRate: num(reputation.ownerResponseRate),
                topThemes: list(reputation.topThemes, 60, 8),
                redFlags,
                foodHygiene,
                strengths: list(reputation.strengths, 240, 6),
                weaknesses: list(reputation.weaknesses, 240, 6),
                opportunities: list(reputation.opportunities, 240, 6),
                risks: list(reputation.risks, 240, 6),
                generatedAt: text(reputation.generatedAt, 40),
                detail: safePath(reputation.detail),
            },
            socialPresence: {
                totals: {
                    followers: num(totals.followers),
                    platformsPresent: num(totals.platformsPresent),
                    platformsConfigured: num(totals.platformsConfigured),
                },
                gaps: list(presence.gaps, 40, 8),
                platforms,
            },
            webPresence: {
                hasOnlineBooking: web.hasOnlineBooking === true,
                bookingProviders: list(web.bookingProviders, 60, 6),
                deliveryProviders: list(web.deliveryProviders, 60, 6),
                hasMenuOnline: web.hasMenuOnline === true,
                tech: list(web.tech, 40, 10),
                pressMentions: num(web.pressMentions),
            },
            voice: {
                keywords: list(voice.keywords, 60, 12),
                samples: list(voice.samples, 400, 2),
                hashtags: list(voice.hashtags, 60, 12),
            },
            scores: {
                overall: num(scores.overall),
                reputation: num(scores.reputation),
                socialStrength: num(scores.socialStrength),
                contentHealth: num(scores.contentHealth),
                discoverability: num(scores.discoverability),
            },
            reading: {
                tone: text(reading.tone, 20),
                title: text(reading.title, 160),
                summary: text(reading.summary, 600),
            },
            actions,
        };
        social.status = status || 'prepared';
        const hasEvidence = Boolean(social.slug || social.note || social.files.profile
            || platforms.length || social.reputation.totalReviews);
        return hasEvidence ? social : null;
    }

    // Where a brand's material came from, and how sure we are. Kept in step
    // with `asset-intel.js` (which owns the same vocabulary for files); the two
    // modules load independently, so a test asserts they agree rather than one
    // importing the other.
    const PROVENANCE_KINDS = ['supplied', 'public', 'extracted', 'inferred', 'unknown'];
    const PROVENANCE_CONFIDENCE = ['high', 'medium', 'low'];

    function normalizeProvenance(value) {
        const provenance = value && typeof value === 'object' ? value : {};
        return {
            kind: PROVENANCE_KINDS.includes(provenance.kind) ? provenance.kind : 'unknown',
            confidence: PROVENANCE_CONFIDENCE.includes(provenance.confidence)
                ? provenance.confidence
                : 'low',
            note: text(provenance.note, 280),
        };
    }

    function normalizeBrand(value, index) {
        const source = value && typeof value === 'object' ? value : {};
        const id = ID_PATTERN.test(String(source.id || ''))
            ? String(source.id)
            : slugId(source.name || source.dir, `brand-${index + 1}`);
        const content = normalizeContent(source.content);
        // Documents are listed in the content file (one source of truth) and
        // lifted onto the brand so the asset library can index them.
        const documents = normalizeDocuments(source.documents || source.content?.documents);
        const brand = {
            id,
            name: text(source.name, 120) || titleCase(source.dir) || `Brand ${index + 1}`,
            wordmark: text(source.wordmark, 160),
            tagline: text(source.tagline, 240),
            url: text(source.url, 240),
            version: text(source.version, 40),
            captured: text(source.captured, 60),
            dir: text(source.dir, 120),
            tokensPath: text(source.tokensPath, 240),
            docPath: text(source.docPath, 240),
            palette: normalizePalette(source.palette || source.color),
            typography: normalizeTypography(source.typography),
            voice: normalizeVoice(source.voice),
            content,
            documents,
            provenance: normalizeProvenance(source.provenance),
            social: normalizeSocial(source.social),
            logos: normalizeLogos(source.logos),
            photography: normalizePhotos(source.photography),
            paletteImages: normalizeGallery(source.paletteImages),
            typeSpecimens: normalizeGallery(source.typeSpecimens),
            cover: normalizeAssetUrl(source.cover) || null,
            guidelines: normalizeGuidelines(source.guidelines),
            brandKitId: ID_PATTERN.test(String(source.brandKitId || '')) ? String(source.brandKitId) : null,
            fontReady: source.fontReady === true,
            tokens: source.tokens && typeof source.tokens === 'object' ? source.tokens : null,
        };
        // A brand with no name and no palette is a folder, not a brand.
        if (!brand.name && !brand.palette.length) return null;
        return brand;
    }

    function normalizePortfolio(value) {
        const source = value && typeof value === 'object' ? value : {};
        return {
            name: text(source.name, 160),
            docTitle: text(source.docTitle, 200),
            docUrl: normalizeAssetUrl(source.docUrl),
            summary: text(source.summary, 1600),
            assets: normalizeGallery(source.assets),
            guidelines: normalizeGuidelines(source.guidelines),
        };
    }

    function normalizeBrandPack(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const source = value;
        const brands = (Array.isArray(source.brands) ? source.brands : [])
            .map(normalizeBrand)
            .filter(Boolean)
            .slice(0, 24);
        const name = text(source.name, 160) || 'Brand pack';
        const id = ID_PATTERN.test(String(source.id || ''))
            ? String(source.id)
            : slugId(name, 'brand-pack');
        return {
            schema: PACK_SCHEMA,
            id,
            name,
            description: text(source.description, 800),
            source: text(source.source, 40) || 'zip',
            storage: text(source.storage, 240),
            createdAt: text(source.createdAt, 40) || null,
            updatedAt: text(source.updatedAt, 40) || null,
            portfolio: normalizePortfolio(source.portfolio),
            provenance: normalizeProvenance(source.provenance),
            brands,
            meta: source.meta && typeof source.meta === 'object' ? source.meta : {},
        };
    }

    // ---------------------------------------------------------------------
    // Brand kit mapping (the existing studio brand-kit shape)
    // ---------------------------------------------------------------------
    function brandKitFor(brand, id) {
        if (!brand || typeof brand !== 'object') return null;
        const kitId = ID_PATTERN.test(String(id || brand.brandKitId || ''))
            ? String(id || brand.brandKitId)
            : slugId(`${brand.name}-kit`, 'brand-kit');
        const palette = (brand.palette || [])
            .map((entry) => ({ name: entry.name || titleCase(entry.key), hex: normalizeHex(entry.hex) || '#000000' }))
            .filter((entry) => entry.hex)
            .slice(0, 40);
        const seen = new Set();
        const fonts = [];
        (brand.typography?.families || []).forEach((family) => {
            const value = text(family, 80);
            if (!value) return;
            const key = `${value.toLowerCase()}|${weightFromFamily(value)}|${styleFromFamily(value)}`;
            if (seen.has(key)) return;
            seen.add(key);
            fonts.push({
                name: value,
                family: value,
                weight: weightFromFamily(value),
                style: styleFromFamily(value),
            });
        });
        const logos = (brand.logos || [])
            .filter((logo) => !logo.presentation)
            .map((logo) => ({ name: logo.name, url: logo.url }))
            .slice(0, 20);
        // Explicit stand-ins for the licensed families. The shared and
        // embedded kits carry them so validation agrees with the rendered text.
        [
            { name: 'Fallback — Sans', family: 'Helvetica Neue', weight: 400, style: 'normal' },
            { name: 'Fallback — Serif', family: 'Georgia', weight: 400, style: 'normal' },
        ].forEach((entry) => {
            if (!fonts.some((font) => font.family.toLowerCase() === entry.family.toLowerCase())) {
                fonts.push(entry);
            }
        });
        return {
            id: kitId,
            name: `${brand.name || 'Brand'} kit`,
            palette,
            fonts: fonts.slice(0, 12),
            logos,
        };
    }

    // ---------------------------------------------------------------------
    // Palette roles for a template
    // ---------------------------------------------------------------------
    const TEMPLATE_GROUND_HINTS = {
        menu: [/menu/i, /paper/i, /page ground/i, /print background/i, /primary ground/i],
        'business-card-front': [/primary brand ground/i, /logo field/i, /header/i, /section ground/i, /primary ground/i],
        'business-card-back': [/paper/i, /page ground/i, /off-white/i, /bone/i, /chalk/i],
        flyer: [/primary brand ground/i, /primary ground/i, /page ground/i, /menu/i],
        'table-card': [/paper/i, /menu/i, /page ground/i],
        voucher: [/logo field/i, /call to action/i, /highlight/i, /accent/i],
        social: [/primary ground/i, /page ground/i, /header/i],
    };

    const TEMPLATE_MATCHERS = {
        menu: /menu/i,
        'business-card-front': /business card|stationery|card/i,
        'business-card-back': /business card|stationery|card/i,
        flyer: /flyer|poster|leaflet/i,
        'table-card': /table card|table talker|menu/i,
        voucher: /voucher|gift/i,
        social: /social|instagram|facebook/i,
    };

    function applicationFor(brand, templateId) {
        const matcher = TEMPLATE_MATCHERS[templateId];
        if (!matcher) return null;
        const applications = brand?.guidelines?.applications || [];
        const found = applications.find((entry) => matcher.test(entry.application));
        if (found) return found;
        // A menu is also a good fallback for a table card.
        if (templateId === 'table-card') {
            return applications.find((entry) => /menu/i.test(entry.application)) || null;
        }
        return null;
    }

    /**
     * Names a palette colour answers to in prose. “Adamson Black” must match a
     * document that says “black ground”, so the last word of a compound name is
     * an alias too.
     */
    function colorAliases(entry) {
        const aliases = new Set();
        const add = (value) => {
            const cleaned = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            if (!cleaned || cleaned.length < 3) return;
            aliases.add(cleaned);
            const words = cleaned.split(' ').filter(Boolean);
            const last = words[words.length - 1];
            if (last && last.length >= 3) aliases.add(last);
        };
        add(entry.name);
        add(entry.key);
        // A hex value is only useful when the document quotes it.
        if (entry.hex) aliases.add(entry.hex);
        return [...aliases].filter((alias) => !/^(color|colour|palette|brand)$/.test(alias));
    }

    /** Palette colours explicitly named in a template's documentation row. */
    function documentedColors(brand, templateId) {
        const application = applicationFor(brand, templateId);
        if (!application) return [];
        const haystack = ` ${`${application.specification} ${application.scope}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
        const matches = [];
        (brand.palette || []).forEach((entry) => {
            let position = -1;
            colorAliases(entry).forEach((alias) => {
                const at = haystack.indexOf(alias);
                if (at < 0) return;
                // Require a word boundary so "ink" does not match "thinking".
                const before = haystack[at - 1];
                const after = haystack[at + alias.length];
                if (/[a-z0-9]/.test(before || ' ') || /[a-z0-9]/.test(after || ' ')) return;
                if (position < 0 || at < position) position = at;
            });
            if (position >= 0) matches.push({ entry, position });
        });
        return matches.sort((a, b) => a.position - b.position).map((match) => match.entry);
    }

    function pickGround(brand, templateId) {
        const palette = brand.palette || [];
        const documented = documentedColors(brand, templateId)[0];
        if (documented) return documented;
        const hints = TEMPLATE_GROUND_HINTS[templateId] || [/primary ground/i, /page ground/i];
        const primary = primaryColors(palette);
        for (const hint of hints) {
            // Primary colours win: a "palette accent" on a secondary swatch is
            // not a ground, however well the role text matches the hint.
            const found = primary.find((entry) => hint.test(`${entry.role} ${entry.name} ${entry.key}`));
            if (found) return found;
        }
        if (primary.length) {
            return primary.slice().sort((a, b) => b.share - a.share || a.index - b.index)[0];
        }
        return palette[0] || normalizeColorEntry({ name: 'Ink', hex: '#17161f' }, 'ink', 0);
    }

    function pickInk(brand, ground) {
        const palette = brand.palette || [];
        const candidates = palette
            .filter((entry) => entry.hex !== ground.hex)
            .map((entry) => ({ entry, ratio: contrastRatio(entry.hex, ground.hex) }));
        const white = { entry: normalizeColorEntry({ name: 'Chalk', hex: '#FFFFFF' }, 'chalk', 0), ratio: contrastRatio('#FFFFFF', ground.hex) };
        const ink = { entry: normalizeColorEntry({ name: 'Ink', hex: '#17161f' }, 'ink', 0), ratio: contrastRatio('#17161f', ground.hex) };
        // Brand palettes almost always contain the intended pairing; the two
        // neutrals only win when the palette has nothing better. The Physician
        // is the clearest case: ink artwork on vermilion reads better than white.
        // A palette entry always wins when it is legible: “Off White” is the
        // brand's word for the same near-white the fallback would invent.
        candidates.sort((a, b) => b.ratio - a.ratio);
        if (candidates.length && candidates[0].ratio >= 3) return candidates[0].entry;
        return white.ratio >= ink.ratio ? white.entry : ink.entry;
    }

    function pickAccent(brand, ground, ink, templateId) {
        const palette = brand.palette || [];
        const documented = documentedColors(brand, templateId);
        const eligible = palette.filter((entry) => entry.hex !== ground.hex && entry.hex !== ink.hex);
        const readable = (entry) => contrastRatio(entry.hex, ground.hex) >= 3.2;
        const visible = (entry) => contrastRatio(entry.hex, ground.hex) >= 2.4;
        const fallbackDocumented = documented.find((entry) => entry.hex !== ground.hex && entry.hex !== ink.hex && readable(entry));
        if (fallbackDocumented) return fallbackDocumented;
        const roleAccent = (list) => list.find((entry) => visible(entry) && /accent|call to action|heading|monogram|rule|highlight|button/i.test(entry.role));
        const primary = eligible.filter((entry) => entry.tier === 'primary');
        // A designated accent may be a low-contrast brand colour (vermilion on
        // bone). That is allowed: readableAccent() drops it for small text and
        // keeps the true brand colour on rules and large display type.
        const primaryRole = roleAccent(primary);
        if (primaryRole) return primaryRole;
        const byContrast = (list) => list
            .slice()
            .sort((a, b) => contrastRatio(b.hex, ground.hex) - contrastRatio(a.hex, ground.hex))[0];
        if (primary.length) {
            const readablePrimary = primary.filter(readable);
            if (readablePrimary.length) return byContrast(readablePrimary);
            return byContrast(primary);
        }
        const secondaryRole = roleAccent(eligible);
        if (secondaryRole) return secondaryRole;
        const readableEligible = eligible.filter(readable);
        if (readableEligible.length) return byContrast(readableEligible);
        if (eligible.length) {
            return eligible.slice().sort((a, b) => {
                const sa = Math.max(...a.rgb) - Math.min(...a.rgb);
                const sb = Math.max(...b.rgb) - Math.min(...b.rgb);
                return sb - sa;
            })[0];
        }
        return normalizeColorEntry({ name: 'Accent', hex: isDark(ground.hex) ? '#FFFFFF' : '#000000' }, 'accent', 0);
    }

    /**
     * A saturated brand ground (magenta, gold) often has no palette colour that
     * carries small copy at AA, which forces the text off-palette. Rather than
     * repaint the type, the ground is shaded — minimally, in whichever
     * direction reaches the bar first — so the palette ink reads on it.
     */
    function legibleGround(groundHex, inkHex, target = 4.65) {
        if (contrastRatio(groundHex, inkHex) >= target) return groundHex;
        const shade = (toward) => {
            for (let step = 1; step <= 50; step += 1) {
                const mixed = blendHex(groundHex, toward, step * 0.02);
                if (contrastRatio(mixed, inkHex) >= target) return { hex: mixed, step };
            }
            return null;
        };
        const light = shade('#ffffff');
        const dark = shade('#000000');
        if (light && dark) return (light.step <= dark.step ? light : dark).hex;
        return (light || dark)?.hex || groundHex;
    }

    function paletteRoles(brand, templateId) {
        let ground = pickGround(brand, templateId);
        const ink = pickInk(brand, ground);
        const pair = legibleGround(ground.hex, ink.hex);
        if (pair !== ground.hex) ground = { ...ground, hex: pair };
        const accent = pickAccent(brand, ground, ink, templateId);
        return {
            ground,
            accent,
            ink,
            contrast: contrastRatio(ground.hex, ink.hex),
            application: applicationFor(brand, templateId),
        };
    }

    // ---------------------------------------------------------------------
    // Asset selection
    // ---------------------------------------------------------------------
    function logoColorPenalty(brand, logo, groundHex) {
        const name = ` ${String(logo.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
        let penalty = 0;
        (brand.palette || []).forEach((entry) => {
            colorAliases(entry).forEach((alias) => {
                if (alias.length < 4 || !name.includes(` ${alias} `)) return;
                if (contrastRatio(entry.hex, groundHex) < 2.2) penalty = Math.min(penalty, -30);
            });
        });
        return penalty;
    }

    function logoScore(brand, logo, groundHex, kind) {
        const dark = isDark(groundHex);
        let score = logoColorPenalty(brand, logo, groundHex);
        if (dark && logo.variant === 'light') score += 20;
        if (dark && logo.variant === 'color') score += 8;
        if (dark && logo.variant === 'dark') score -= 30;
        if (!dark && logo.variant === 'dark') score += 20;
        if (!dark && logo.variant === 'color') score += 8;
        if (!dark && logo.variant === 'light') score -= 30;
        if (logo.variant === 'primary') score += 4;
        if (logo.format === 'svg') score += 6;
        if (logo.format === 'png') score += 3;
        // The requested cut is the strongest signal after reversibility: a
        // wordmark belongs on a menu, a mark on a card front.
        if (kind && logo.kind === kind) score += 16;
        if (logo.width && logo.height && logo.width > logo.height * 1.8) score += 2;
        return score;
    }

    function logoFor(brand, groundHex, kind) {
        const logos = (brand.logos || []).filter((logo) => !logo.presentation);
        if (!logos.length) return null;
        return logos
            .slice()
            .sort((a, b) => logoScore(brand, b, groundHex, kind) - logoScore(brand, a, groundHex, kind))[0] || null;
    }

    function photoFor(brand, prefer) {
        const photos = brand.photography || [];
        if (!photos.length) return null;
        const wanted = prefer ? new RegExp(prefer, 'i') : null;
        return photos
            .slice()
            .sort((a, b) => {
                const score = (photo) => {
                    let value = 0;
                    if (wanted && wanted.test(photo.name)) value += 12;
                    if (/hero|main|signature|interior|room/i.test(photo.name)) value += 5;
                    if (photo.width && photo.height) {
                        const ratio = photo.width / photo.height;
                        if (ratio >= 1.2 && ratio <= 2.2) value += 4;
                    }
                    return value;
                };
                return score(b) - score(a);
            })[0] || null;
    }

    function contactMap(brand) {
        const map = {};
        const add = (field, value) => {
            const key = String(field || '').toLowerCase().replace(/[^a-z]+/g, '');
            const val = text(value, 240);
            if (key && val && !map[key]) map[key] = val;
        };
        (brand.guidelines?.contact || []).forEach((entry) => add(entry.field, entry.value));
        (brand.guidelines?.facts || []).forEach((entry) => add(entry.field, entry.value));
        return {
            address: map.address || '',
            phone: map.telephone || map.phone || '',
            email: map.email || map.reservations || '',
            website: map.website || '',
            instagram: map.instagram || '',
            facebook: map.facebook || '',
        };
    }

    function websiteLabel(brand, contact) {
        const url = contact.website || brand.url || '';
        return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    }

    /**
     * Applies a brand's authored copy deck to one design's default text.
     *
     * The Asset Studio catalogue is written for another client, so its sample
     * dish, price, terms and festive event would otherwise land on every
     * brand. This is the one place that knows which catalogue field means what
     * (title on a flyer is the headline, on a voucher it is the label), used by
     * both Asset Studio and the Agent Studio bridge. A design the deck says
     * nothing about is left alone rather than filled with the sample.
     */
    function applyTemplateCopy(brand, category, designName, source) {
        const copy = brand?.content?.copy;
        if (!copy || !source || typeof source !== 'object') return source;
        const contact = contactMap(brand);
        const footer = [contact.address, websiteLabel(brand, contact)].filter(Boolean).join('  ·  ');
        const festive = copy.festive || {};
        const special = copy.special || {};
        const menu = copy.menu || {};
        const voucher = copy.voucher || {};
        const name = String(designName || '');
        const set = (field, value) => {
            if (!(field in source) || !value) return;
            source[field] = value;
        };
        const christmas = /christmas/i.test(name)
            || /christmas/i.test(source.title || '')
            || /decadance/i.test(source.body || '');

        const festiveMenu = category === 'menu' && /festive/i.test(name);
        if (category === 'menu' && 'items' in source) {
            const lines = [];
            if (festiveMenu && Array.isArray(festive.dishes) && festive.dishes.length) {
                festive.dishes.slice(0, 5).forEach((dish) => {
                    lines.push([dish.name, dish.description || '', ''].join(' | '));
                });
            } else {
                (brand?.content?.menu?.sections || []).slice(0, 3).forEach((section) => {
                    if (lines.length >= 5) return;
                    const items = Array.isArray(section.items) ? section.items : [];
                    if (!items.length) return;
                    // Designs differ in whether they draw section headings, so
                    // the shared line format stays flat: five real dishes that fit
                    // every layout, not eight lines that only fit the tallest.
                    items.slice(0, 5).forEach((item) => {
                        if (!item?.name || lines.length >= 5) return;
                        const description = item.description && item.description.length <= 70 ? item.description : '';
                        lines.push([item.name, description, item.price || ''].join(' | '));
                    });
                });
            }
            if (lines.length) source.items = lines.join('\n');
        }

        if (category === 'bizcard') {
            set('name', copy.card?.name);
            set('role', copy.card?.role || 'Your role');
            set('phone', contact.phone);
            set('email', contact.email);
            set('address', contact.address);
            set('web', websiteLabel(brand, contact));
            if ('handle' in source) source.handle = contact.instagram || '';
            set('tag', copy.tag);
        }

        if ('terms' in source) set('terms', voucher.terms);

        if (category === 'flyer') {
            if (christmas) {
                set('eyebrow', copy.kicker);
                set('title', festive.title);
                set('date', festive.date);
                set('price', festive.price);
                set('body', festive.body);
            } else {
                set('title', name === 'Bold colour' ? copy.boldTitle : copy.headline);
                set('sub', copy.subhead);
                set('body', copy.body);
                set('cta', copy.cta);
                if ('price' in source) set('price', special.price);
                if ('eyebrow' in source) {
                    set('eyebrow', /^(?:Sunday sessions|Decadance)/i.test(source.eyebrow || '')
                        ? copy.kicker
                        : special.kicker);
                }
            }
            set('foot', footer);
        }

        if (category === 'menu') {
            // Drinks, wine, kids and takeaway are their own menus: keep their
            // labels and leave their sample lists alone. Only the à la carte
            // layouts take the deck's title.
            if (/^(classic|centred|photo header)$/i.test(name)) {
                set('sub', menu.kicker);
                set('title', menu.title);
            }
            set('foot', footer);
        }

        if (category === 'voucher') {
            set('eyebrow', voucher.title);
            set('amount', voucher.value);
            set('msg', christmas ? festive.message : voucher.message);
            set('foot', footer);
        }

        // A post idea for a brand without structured menus: the deck's special
        // is the best dish it has, and the kicker is its menu label.
        if (category === 'postidea') {
            set('eyebrow', special.kicker);
            set('kicker', menu.kicker);
            set('title', special.dish);
            set('body', special.description);
            set('price', special.price);
            set('foot', footer);
        }

        if (category === 'tablecard') {
            if (/chef.s special/i.test(name)) {
                set('eyebrow', special.kicker);
                set('title', special.dish);
                set('body', special.description);
                set('price', special.price);
                set('foot', special.note);
            } else if (/scan/i.test(name)) {
                set('foot', websiteLabel(brand, contact));
            }
        }

        if (category === 'social') {
            if (/chef.s special/i.test(name)) {
                set('eyebrow', special.kicker);
                set('title', special.dish);
                set('price', special.price);
                set('foot', special.description);
            } else if (/christmas/i.test(name)) {
                set('title', festive.title);
                set('date', festive.date);
                set('price', festive.price);
            } else if (/statement|sunday sessions/i.test(name)) {
                set('title', copy.boldTitle);
                set('sub', copy.tag);
                set('cta', copy.cta);
                set('foot', footer);
            } else if (/announcement/i.test(name)) {
                set('eyebrow', special.kicker);
                set('title', special.dish);
                set('sub', special.price);
                set('foot', footer);
            }
        }

        return source;
    }

    // ---------------------------------------------------------------------
    // Template catalog
    // ---------------------------------------------------------------------
    const ICE_CREAM = (brand) => brand?.content?.copy?.kind === 'ice-cream';

    function cutoutPhotos(brand) {
        return (brand?.photography || []).filter((photo) => /^cutout /i.test(String(photo.name || '')));
    }

    function cutoutFor(brand, pattern) {
        const wanted = pattern ? new RegExp(pattern, 'i') : null;
        const cuts = cutoutPhotos(brand);
        return (wanted && cuts.find((photo) => wanted.test(photo.name))) || cuts[0] || null;
    }

    function socialFooter(contact, website) {
        const handle = String(contact.instagram || '')
            .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
            .replace(/\/+$/, '');
        return [handle ? `@${handle}` : '', website].filter(Boolean).join('  ·  ');
    }

    function buildFlavourCard(ctx) {
        const { roles, fonts, brand, logoLight, photo, contact, website } = ctx;
        const copy = brand?.content?.copy || {};
        const special = copy.special || {};
        const ground = roles.accent.hex;
        const white = '#ffffff';
        const yellow = '#ffec00';
        const ink = roles.ink.hex;
        const shot = cutoutFor(brand, 'brigadeiro') || cutoutFor(brand) || photo;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'flavour-ground', name: 'Ground', color: ground, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(imageLayer({ id: 'flavour-rule', name: 'Top rule', color: yellow, x: 0, y: 0, w: 100, h: 1.2, z: 2, bleed: true }));
        layers.push(imageLayer({ id: 'flavour-band', name: 'Bottom band', color: yellow, x: 0, y: 94, w: 100, h: 6, z: 2, bleed: true }));
        if (logoLight) {
            layers.push(imageLayer({ id: 'flavour-logo', name: 'Wordmark', url: logoLight.url, fit: 'contain', x: 8, y: 6, w: 30, h: 7, z: 6, bleed: true }));
        }
        variables.push(variable({ id: 'flavour_kicker', name: 'Kicker', value: special.kicker || 'Direto da fábrica' }));
        layers.push(textLayer({
            id: 'flavour-kicker', name: 'Kicker', binding: 'flavour_kicker', text: special.kicker || 'Direto da fábrica',
            family: fonts.label, weight: 600, sizePct: 1.8, letterSpacingEm: 0.22, transform: 'uppercase',
            color: yellow, align: 'left', x: 8, y: 18.4, w: 46, h: 3, z: 10,
        }));
        variables.push(variable({ id: 'flavour_name', name: 'Flavour', value: special.dish || 'Açaí trufado com avelã' }));
        layers.push(textLayer({
            id: 'flavour-name', name: 'Flavour name', binding: 'flavour_name', text: special.dish || 'Açaí trufado com avelã',
            family: fonts.title, weight: 600, sizePct: 7.2, lineHeight: 1.02, color: white,
            align: 'left', x: 8, y: 22.4, w: 44, h: 20, z: 10,
        }));
        variables.push(variable({ id: 'flavour_note', name: 'Note', value: special.description || 'Açaí cremoso com recheio trufado e avelã.' }));
        layers.push(textLayer({
            id: 'flavour-note', name: 'Note', binding: 'flavour_note', text: special.description || 'Açaí cremoso com recheio trufado e avelã.',
            family: fonts.body, weight: 400, sizePct: 2.1, lineHeight: 1.4, color: white, opacity: 0.9,
            align: 'left', x: 8, y: 44.4, w: 42, h: 9, z: 10,
        }));
        layers.push(imageLayer({ id: 'flavour-badge', name: 'Size badge', color: yellow, x: 8, y: 56.4, w: 22, h: 5.6, z: 8, bleed: false }));
        variables.push(variable({ id: 'flavour_size', name: 'Size', value: special.price || '60 g' }));
        layers.push(textLayer({
            id: 'flavour-size', name: 'Size', binding: 'flavour_size', text: special.price || '60 g',
            family: fonts.label, weight: 600, sizePct: 2.2, letterSpacingEm: 0.06, color: ink,
            align: 'center', x: 8, y: 57.4, w: 22, h: 4, z: 10,
        }));
        if (shot) {
            layers.push(imageLayer({
                id: 'flavour-product', name: 'Product cut-out', url: shot.url, fit: 'contain',
                x: 56, y: 30, w: 40, h: 58, z: 6, bleed: false,
            }));
        }
        layers.push(textLayer({
            id: 'flavour-cta', name: 'Call to action', text: 'Encontre um revendedor',
            family: fonts.label, weight: 600, sizePct: 1.7, letterSpacingEm: 0.16, transform: 'uppercase',
            color: white, align: 'left', x: 8, y: 80.5, w: 60, h: 3, z: 10,
        }));
        layers.push(textLayer({
            id: 'flavour-footer', name: 'Footer', text: socialFooter(contact, website),
            family: fonts.body, weight: 400, sizePct: 1.1, color: white, opacity: 0.9, align: 'left',
            x: 8, y: 13.8, w: 84, h: 2.4, z: 10,
        }));
        return { layers, variables };
    }

    function buildRangeSocial(ctx) {
        const { roles, accentText, fonts, brand, logo, contact, website } = ctx;
        const copy = brand?.content?.copy || {};
        const campaign = copy.campaign || {};
        const cuts = cutoutPhotos(brand);
        const picks = [
            cuts.find((p) => /açaí/i.test(p.name)),
            cuts.find((p) => /brigadeiro/i.test(p.name)),
            cuts.find((p) => /cupuaçu/i.test(p.name)),
        ].filter(Boolean);
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'range-ground', name: 'Ground', color: roles.ground.hex, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(imageLayer({ id: 'range-bar', name: 'Top bar', color: roles.accent.hex, x: 0, y: 0, w: 100, h: 2, z: 2, bleed: true }));
        if (logo) {
            layers.push(imageLayer({ id: 'range-logo', name: 'Wordmark', url: logo.url, fit: 'contain', x: 36, y: 7, w: 28, h: 7, z: 6, bleed: true }));
        }
        variables.push(variable({ id: 'range_kicker', name: 'Kicker', value: campaign.rangeKicker || 'Linha completa' }));
        layers.push(textLayer({
            id: 'range-kicker', name: 'Kicker', binding: 'range_kicker', text: campaign.rangeKicker || 'Linha completa',
            family: fonts.label, weight: 600, sizePct: 1.8, letterSpacingEm: 0.22, transform: 'uppercase',
            color: accentText, align: 'center', x: 8, y: 19, w: 84, h: 3, z: 10,
        }));
        variables.push(variable({ id: 'range_title', name: 'Headline', value: campaign.rangeTitle || 'Mais de 80 sabores.' }));
        layers.push(textLayer({
            id: 'range-title', name: 'Headline', binding: 'range_title', text: campaign.rangeTitle || 'Mais de 80 sabores.',
            family: fonts.title, weight: 600, sizePct: 8.4, lineHeight: 1.02, color: roles.ink.hex,
            align: 'center', x: 8, y: 23, w: 84, h: 13, z: 10,
        }));
        layers.push(imageLayer({ id: 'range-rule', name: 'Rule', color: roles.accent.hex, x: 44, y: 37.4, w: 12, h: 0.5, z: 5, bleed: true }));
        variables.push(variable({ id: 'range_body', name: 'Body', value: campaign.rangeBody || '' }));
        layers.push(textLayer({
            id: 'range-body', name: 'Body', binding: 'range_body', text: campaign.rangeBody || '',
            family: fonts.body, weight: 400, sizePct: 2.1, lineHeight: 1.4, color: roles.ink.hex, opacity: 0.78,
            align: 'center', x: 12, y: 41, w: 76, h: 8, z: 10,
        }));
        picks.slice(0, 3).forEach((photo, index) => {
            layers.push(imageLayer({
                id: `range-product-${index + 1}`, name: `Product ${index + 1}`, url: photo.url, fit: 'contain',
                x: 7 + index * 30, y: 52, w: 26, h: 28, z: 6, bleed: false,
            }));
        });
        layers.push(textLayer({
            id: 'range-cta', name: 'Call to action', text: copy.cta || 'Conheça os sabores',
            family: fonts.label, weight: 600, sizePct: 1.9, letterSpacingEm: 0.16, transform: 'uppercase',
            color: accentText, align: 'center', x: 8, y: 80.5, w: 84, h: 3, z: 10,
        }));
        layers.push(textLayer({
            id: 'range-footer', name: 'Footer', text: socialFooter(contact, website),
            family: fonts.body, weight: 400, sizePct: 1.2, color: roles.ink.hex, opacity: 0.72,
            align: 'center', x: 8, y: 15.4, w: 84, h: 3, z: 10,
        }));
        return { layers, variables };
    }

    function buildResellerSocial(ctx) {
        const { roles, fonts, brand, logoLight, contact, website } = ctx;
        const copy = brand?.content?.copy || {};
        const campaign = copy.campaign || {};
        const ground = roles.accent.hex;
        const yellow = '#ffec00';
        const white = '#ffffff';
        const ink = roles.ink.hex;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'reseller-ground', name: 'Ground', color: ground, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(imageLayer({ id: 'reseller-bar', name: 'Side bar', color: yellow, x: 0, y: 0, w: 2, h: 100, z: 2, bleed: true }));
        layers.push(textLayer({
            id: 'reseller-years', name: 'Years', text: '29', family: fonts.title, weight: 600, sizePct: 22,
            color: yellow, opacity: 0.16, align: 'right', x: 60, y: 48, w: 34, h: 30, z: 1,
        }));
        if (logoLight) {
            layers.push(imageLayer({ id: 'reseller-logo', name: 'Wordmark', url: logoLight.url, fit: 'contain', x: 8, y: 7, w: 32, h: 7, z: 6, bleed: true }));
        }
        variables.push(variable({ id: 'reseller_kicker', name: 'Kicker', value: campaign.resellerKicker || 'Seja um revendedor' }));
        layers.push(textLayer({
            id: 'reseller-kicker', name: 'Kicker', binding: 'reseller_kicker', text: campaign.resellerKicker || 'Seja um revendedor',
            family: fonts.label, weight: 600, sizePct: 1.8, letterSpacingEm: 0.22, transform: 'uppercase',
            color: yellow, align: 'left', x: 8, y: 21, w: 60, h: 3, z: 10,
        }));
        variables.push(variable({ id: 'reseller_title', name: 'Headline', value: campaign.resellerTitle || 'Leve a Melano para a sua região.' }));
        layers.push(textLayer({
            id: 'reseller-title', name: 'Headline', binding: 'reseller_title', text: campaign.resellerTitle || 'Leve a Melano para a sua região.',
            family: fonts.title, weight: 600, sizePct: 7.4, lineHeight: 1.03, color: white,
            align: 'left', x: 8, y: 25, w: 78, h: 18, z: 10,
        }));
        variables.push(variable({ id: 'reseller_body', name: 'Body', value: campaign.resellerBody || '' }));
        layers.push(textLayer({
            id: 'reseller-body', name: 'Body', binding: 'reseller_body', text: campaign.resellerBody || '',
            family: fonts.body, weight: 400, sizePct: 2.1, lineHeight: 1.45, color: white, opacity: 0.9,
            align: 'left', x: 8, y: 46, w: 70, h: 10, z: 10,
        }));
        variables.push(variable({ id: 'reseller_phone', name: 'Phone', value: campaign.resellerPhone || contact.phone }));
        layers.push(textLayer({
            id: 'reseller-phone', name: 'Phone', binding: 'reseller_phone', text: campaign.resellerPhone || contact.phone,
            family: fonts.title, weight: 600, sizePct: 4.4, color: yellow, align: 'left',
            x: 8, y: 59, w: 70, h: 6, z: 10,
        }));
        variables.push(variable({ id: 'reseller_email', name: 'Email', value: campaign.resellerEmail || contact.email }));
        layers.push(textLayer({
            id: 'reseller-email', name: 'Email', binding: 'reseller_email', text: campaign.resellerEmail || contact.email,
            family: fonts.body, weight: 400, sizePct: 2, color: white, opacity: 0.92,
            align: 'left', x: 8, y: 66, w: 70, h: 4, z: 10,
        }));
        layers.push(imageLayer({ id: 'reseller-cta-box', name: 'CTA box', color: yellow, x: 8, y: 76, w: 44, h: 7, z: 8, bleed: false }));
        layers.push(textLayer({
            id: 'reseller-cta', name: 'Call to action', text: 'Fale com a gente',
            family: fonts.label, weight: 600, sizePct: 1.9, letterSpacingEm: 0.14, transform: 'uppercase',
            color: ink, align: 'center', x: 8, y: 78, w: 44, h: 3, z: 10,
        }));
        layers.push(textLayer({
            id: 'reseller-footer', name: 'Footer', text: socialFooter(contact, website),
            family: fonts.body, weight: 500, sizePct: 1.3, color: white, opacity: 0.9,
            align: 'left', x: 8, y: 15.4, w: 84, h: 3, z: 10,
        }));
        return { layers, variables };
    }

    function buildPremiumSocial(ctx) {
        const { roles, fonts, brand, logoLight, contact, website } = ctx;
        const copy = brand?.content?.copy || {};
        const campaign = copy.campaign || {};
        const chocolate = '#2b1207';
        const gold = '#d9a441';
        const cream = '#fff6e5';
        const shot = cutoutFor(brand, 'brigadeiro') || cutoutFor(brand);
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'premium-ground', name: 'Chocolate ground', color: chocolate, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(imageLayer({ id: 'premium-rule-top', name: 'Gold rule', color: gold, x: 8, y: 6.6, w: 38, h: 0.22, z: 4, bleed: true }));
        layers.push(imageLayer({ id: 'premium-rule-side', name: 'Gold side rule', color: gold, x: 6, y: 24, w: 0.16, h: 34, z: 4, bleed: true }));
        if (logoLight) {
            layers.push(imageLayer({ id: 'premium-logo', name: 'Wordmark', url: logoLight.url, fit: 'contain', x: 8, y: 9, w: 28, h: 6, z: 6, bleed: true }));
        }
        variables.push(variable({ id: 'premium_kicker', name: 'Kicker', value: campaign.premiumKicker || 'Melano Premium' }));
        layers.push(textLayer({
            id: 'premium-kicker', name: 'Kicker', binding: 'premium_kicker', text: campaign.premiumKicker || 'Melano Premium',
            family: fonts.label, weight: 600, sizePct: 1.7, letterSpacingEm: 0.26, transform: 'uppercase',
            color: gold, align: 'left', x: 8, y: 21, w: 50, h: 3, z: 10,
        }));
        variables.push(variable({ id: 'premium_title', name: 'Headline', value: campaign.premiumTitle || 'Açaí trufado com avelã.' }));
        layers.push(textLayer({
            id: 'premium-title', name: 'Headline', binding: 'premium_title', text: campaign.premiumTitle || 'Açaí trufado com avelã.',
            family: fonts.title, weight: 600, sizePct: 7.0, lineHeight: 1.02, color: cream,
            align: 'left', x: 8, y: 26, w: 44, h: 18, z: 10,
        }));
        variables.push(variable({ id: 'premium_body', name: 'Body', value: campaign.premiumBody || '' }));
        layers.push(textLayer({
            id: 'premium-body', name: 'Body', binding: 'premium_body', text: campaign.premiumBody || '',
            family: fonts.body, weight: 400, sizePct: 1.9, lineHeight: 1.45, color: cream, opacity: 0.82,
            align: 'left', x: 8, y: 47, w: 40, h: 10, z: 10,
        }));
        layers.push(imageLayer({ id: 'premium-badge', name: 'Badge', color: gold, x: 8, y: 65, w: 34, h: 6.4, z: 8, bleed: false }));
        variables.push(variable({ id: 'premium_badge', name: 'Badge', value: campaign.premiumBadge || '29 anos de sabor' }));
        layers.push(textLayer({
            id: 'premium-badge-text', name: 'Badge text', binding: 'premium_badge', text: campaign.premiumBadge || '29 anos de sabor',
            family: fonts.label, weight: 600, sizePct: 1.7, letterSpacingEm: 0.12, transform: 'uppercase',
            color: chocolate, align: 'center', x: 8, y: 66.4, w: 34, h: 3.4, z: 10,
        }));
        if (shot) {
            layers.push(imageLayer({
                id: 'premium-product', name: 'Product cut-out', url: shot.url, fit: 'contain',
                x: 55, y: 28, w: 42, h: 58, z: 6, bleed: false,
            }));
        }
        layers.push(textLayer({
            id: 'premium-footer', name: 'Footer', text: socialFooter(contact, website),
            family: fonts.body, weight: 400, sizePct: 1.2, color: cream, opacity: 0.72,
            align: 'left', x: 8, y: 91.5, w: 84, h: 3, z: 10,
        }));
        return { layers, variables };
    }

    function buildFlavourStory(ctx) {
        const { roles, fonts, brand, logoLight, photo, contact, website } = ctx;
        const copy = brand?.content?.copy || {};
        const special = copy.special || {};
        const white = '#ffffff';
        const yellow = '#ffec00';
        const ink = roles.ink.hex;
        const shot = cutoutFor(brand, 'brigadeiro') || photo;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'fstory-ground', name: 'Ground', color: roles.accent.hex, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(imageLayer({ id: 'fstory-rule', name: 'Top rule', color: yellow, x: 0, y: 0, w: 100, h: 0.8, z: 2, bleed: true }));
        layers.push(imageLayer({ id: 'fstory-band', name: 'Bottom band', color: yellow, x: 0, y: 95, w: 100, h: 5, z: 2, bleed: true }));
        if (logoLight) {
            layers.push(imageLayer({ id: 'fstory-logo', name: 'Wordmark', url: logoLight.url, fit: 'contain', x: 8, y: 6, w: 34, h: 6, z: 6, bleed: true }));
        }
        layers.push(textLayer({
            id: 'fstory-handle', name: 'Handle', text: socialFooter(contact, website),
            family: fonts.body, weight: 400, sizePct: 0.9, color: white, opacity: 0.85,
            align: 'left', x: 8, y: 12.4, w: 84, h: 1.8, z: 10,
        }));
        variables.push(variable({ id: 'fstory_kicker', name: 'Kicker', value: special.kicker || 'Direto da fábrica' }));
        layers.push(textLayer({
            id: 'fstory-kicker', name: 'Kicker', binding: 'fstory_kicker', text: special.kicker || 'Direto da fábrica',
            family: fonts.label, weight: 600, sizePct: 1.5, letterSpacingEm: 0.22, transform: 'uppercase',
            color: yellow, align: 'left', x: 8, y: 16.8, w: 70, h: 2.6, z: 10,
        }));
        variables.push(variable({ id: 'fstory_name', name: 'Flavour', value: special.dish || 'Picolé brigadeiro' }));
        layers.push(textLayer({
            id: 'fstory-name', name: 'Flavour name', binding: 'fstory_name', text: special.dish || 'Picolé brigadeiro',
            family: fonts.title, weight: 600, sizePct: 6.6, lineHeight: 1.02, color: white,
            align: 'left', x: 8, y: 20.4, w: 84, h: 14, z: 10,
        }));
        variables.push(variable({ id: 'fstory_note', name: 'Note', value: special.description || '' }));
        layers.push(textLayer({
            id: 'fstory-note', name: 'Note', binding: 'fstory_note', text: special.description || '',
            family: fonts.body, weight: 400, sizePct: 1.7, lineHeight: 1.4, color: white, opacity: 0.9,
            align: 'left', x: 8, y: 35.4, w: 80, h: 7, z: 10,
        }));
        layers.push(imageLayer({ id: 'fstory-badge', name: 'Size badge', color: yellow, x: 8, y: 44, w: 30, h: 4.4, z: 8, bleed: false }));
        variables.push(variable({ id: 'fstory_size', name: 'Size', value: special.price || '75 g' }));
        layers.push(textLayer({
            id: 'fstory-size', name: 'Size', binding: 'fstory_size', text: special.price || '75 g',
            family: fonts.label, weight: 600, sizePct: 1.7, color: ink, align: 'center',
            x: 8, y: 44.9, w: 30, h: 2.8, z: 10,
        }));
        if (shot) {
            layers.push(imageLayer({
                id: 'fstory-product', name: 'Product cut-out', url: shot.url, fit: 'contain',
                x: 20, y: 48, w: 60, h: 30, z: 6, bleed: false,
            }));
        }
        layers.push(textLayer({
            id: 'fstory-cta', name: 'Call to action', text: 'Encontre um revendedor',
            family: fonts.label, weight: 600, sizePct: 1.4, letterSpacingEm: 0.16, transform: 'uppercase',
            color: white, align: 'left', x: 8, y: 80.4, w: 80, h: 2.4, z: 10,
        }));
        return { layers, variables };
    }

    function buildPremiumStory(ctx) {
        const { roles, fonts, brand, logoLight, contact, website } = ctx;
        const copy = brand?.content?.copy || {};
        const campaign = copy.campaign || {};
        const chocolate = '#2b1207';
        const gold = '#d9a441';
        const cream = '#fff6e5';
        const shot = cutoutFor(brand, 'brigadeiro') || cutoutFor(brand);
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'pstory-ground', name: 'Chocolate ground', color: chocolate, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(imageLayer({ id: 'pstory-rule-top', name: 'Gold rule', color: gold, x: 8, y: 5.4, w: 44, h: 0.18, z: 4, bleed: true }));
        if (logoLight) {
            layers.push(imageLayer({ id: 'pstory-logo', name: 'Wordmark', url: logoLight.url, fit: 'contain', x: 8, y: 7, w: 30, h: 5, z: 6, bleed: true }));
        }
        layers.push(textLayer({
            id: 'pstory-handle', name: 'Handle', text: socialFooter(contact, website),
            family: fonts.body, weight: 400, sizePct: 0.9, color: cream, opacity: 0.65,
            align: 'left', x: 8, y: 12.2, w: 84, h: 1.8, z: 10,
        }));
        variables.push(variable({ id: 'pstory_kicker', name: 'Kicker', value: campaign.premiumKicker || 'Melano Premium' }));
        layers.push(textLayer({
            id: 'pstory-kicker', name: 'Kicker', binding: 'pstory_kicker', text: campaign.premiumKicker || 'Melano Premium',
            family: fonts.label, weight: 600, sizePct: 1.5, letterSpacingEm: 0.26, transform: 'uppercase',
            color: gold, align: 'left', x: 8, y: 16.2, w: 70, h: 2.6, z: 10,
        }));
        variables.push(variable({ id: 'pstory_title', name: 'Headline', value: campaign.premiumTitle || 'Brigadeiro trufado.' }));
        layers.push(textLayer({
            id: 'pstory-title', name: 'Headline', binding: 'pstory_title', text: campaign.premiumTitle || 'Brigadeiro trufado.',
            family: fonts.title, weight: 600, sizePct: 6.4, lineHeight: 1.02, color: cream,
            align: 'left', x: 8, y: 20, w: 78, h: 12, z: 10,
        }));
        variables.push(variable({ id: 'pstory_body', name: 'Body', value: campaign.premiumBody || '' }));
        layers.push(textLayer({
            id: 'pstory-body', name: 'Body', binding: 'pstory_body', text: campaign.premiumBody || '',
            family: fonts.body, weight: 400, sizePct: 1.6, lineHeight: 1.4, color: cream, opacity: 0.82,
            align: 'left', x: 8, y: 32.4, w: 72, h: 6, z: 10,
        }));
        if (shot) {
            layers.push(imageLayer({
                id: 'pstory-product', name: 'Product cut-out', url: shot.url, fit: 'contain',
                x: 18, y: 39, w: 64, h: 38, z: 6, bleed: false,
            }));
        }
        layers.push(imageLayer({ id: 'pstory-badge', name: 'Badge', color: gold, x: 8, y: 79, w: 38, h: 4.2, z: 8, bleed: false }));
        variables.push(variable({ id: 'pstory_badge', name: 'Badge', value: campaign.premiumBadge || '29 anos de sabor' }));
        layers.push(textLayer({
            id: 'pstory-badge-text', name: 'Badge text', binding: 'pstory_badge', text: campaign.premiumBadge || '29 anos de sabor',
            family: fonts.label, weight: 600, sizePct: 1.4, letterSpacingEm: 0.12, transform: 'uppercase',
            color: chocolate, align: 'center', x: 8, y: 79.9, w: 38, h: 2.4, z: 10,
        }));
        return { layers, variables };
    }

    // ─── Cawley / Boardwalk social templates ──────────────────────────
    // Ten designs from the Boardwalk social pack (01.pdf) rebuilt as real v3
    // compositions: every word is a bindable text layer, every photo slot is an
    // image variable, and the waves, scallops, sun, glow and gull are compact
    // inline SVG art. Nothing is a screenshot, so variables, formats, guardrails
    // and the export path all apply.
    //
    // The art direction uses the venue's brighter site palette rather than the
    // pack's darker teal, so the colours are declared on each template and
    // merged into the composition kit (see createTemplateComposition). The
    // ground and orange are a touch deeper than the reference so white type
    // clears the contrast rule the studio enforces.

    const BW = Object.freeze({
        blue: '#0890ce',
        blueDeep: '#0b5f86',
        teal: '#00969e',
        mint: '#bee2de',
        mintLine: '#a6d5ce',
        ink: '#24424a',
        inkDeep: '#123f4c',
        yellow: '#feef00',
        orange: '#e8641a',
        white: '#ffffff',
    });

    const BOARDWALK_BRAND = (brand) => /boardwalk/i.test(`${brand?.id || ''} ${brand?.name || ''}`);

    // The reference art runs close to the edges. The studio's social default
    // (12 % top, 16 % bottom) would pull every footer into the middle, so these
    // cards declare their own 4 % margin — still a margin, just the one the
    // design was drawn with.
    const BW_SAFE_ZONE = Object.freeze({ top: 0.04, right: 0.04, bottom: 0.04, left: 0.04 });

    const BW_KIT_COLORS = Object.freeze([
        { name: 'Boardwalk Blue', hex: BW.blue },
        { name: 'Coast Teal', hex: BW.teal },
        { name: 'Sea Glass', hex: BW.mint },
        { name: 'Deep Ink', hex: BW.ink },
        { name: 'Sun Yellow', hex: BW.yellow },
        { name: 'Sunset Orange', hex: BW.orange },
    ]);

    function bwRound(value) {
        return Math.round(Number(value) * 100) / 100;
    }

    /** SVG art travels as a base64 data URL: compact, and immune to URL escaping. */
    function bwSvg(svg) {
        const base64 = typeof btoa === 'function'
            ? btoa(svg)
            : Buffer.from(svg, 'utf8').toString('base64');
        return `data:image/svg+xml;base64,${base64}`;
    }

    /**
     * A three-line wave band, generated as a repeating SVG pattern so even a
     * 1600 px header stays well under the 2 KB asset-URL cap.
     */
    function bwWaveUrl(options) {
        const spec = options || {};
        const widthPx = Math.max(1, finite(spec.width, 1080));
        const heightPx = Math.max(1, finite(spec.height, 54));
        const color = normalizeHex(spec.color) || BW.white;
        const W = 1000;
        const H = Math.max(24, Math.round((W * heightPx) / widthPx));
        const L = Math.max(70, Math.round(W * (finite(spec.wavelength, 0.21))));
        const A = H * (finite(spec.amplitude, 0.22));
        const base = H * (finite(spec.thickness, 0.09));
        const count = clamp(Math.round(finite(spec.rows, 3)), 2, 5);
        const rows = Array.from({ length: count }, (_, index) => {
            const f = count === 3
                ? [0.3, 0.52, 0.76][index]
                : 0.18 + (0.66 * index) / Math.max(1, count - 1);
            return { y: f, a: index % 2 ? 0.8 : 1, w: index === 1 ? 0.55 : 1 };
        });
        const paths = rows.map((row) => {
            const y = bwRound(H * row.y);
            const a = bwRound(A * row.a);
            const sw = bwRound(base * row.w);
            return `<path d="M0 ${bwRound(y - a)} C${bwRound(L * 0.25)} ${bwRound(y - a)} ${bwRound(L * 0.25)} ${bwRound(y + a)} ${bwRound(L / 2)} ${bwRound(y + a)} C${bwRound(L * 0.75)} ${bwRound(y + a)} ${bwRound(L * 0.75)} ${bwRound(y - a)} ${L} ${bwRound(y - a)}" fill="none" stroke="${color}" stroke-width="${sw}"/>`;
        }).join('');
        return bwSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><pattern id="w" width="${L}" height="${H}" patternUnits="userSpaceOnUse">${paths}</pattern></defs><rect width="${W}" height="${H}" fill="url(#w)"/></svg>`);
    }

    /**
     * The venue's scallop-shingle footer: overlapping shell arcs with a three
     * tick fan, tiled in two staggered rows.
     */
    function bwScallopUrl(options) {
        const spec = options || {};
        const widthPx = Math.max(1, finite(spec.width, 1080));
        const heightPx = Math.max(1, finite(spec.height, 150));
        const ground = normalizeHex(spec.ground) || BW.mint;
        const line = normalizeHex(spec.line) || BW.mintLine;
        const W = 1000;
        const H = Math.max(60, Math.round((W * heightPx) / widthPx));
        // Keep the shell roughly 120 px wide on every canvas, so a wide banner
        // gets more scallops rather than bigger ones.
        const T = Math.max(48, Math.round((105 * W) / widthPx));
        const S = Math.round(T * 0.56);
        const sw = bwRound((4 * W) / widthPx);
        const arcs = [0.5, 0.36, 0.22].map((f) => {
            const r = bwRound(T * f);
            const lift = bwRound(r * 1.3);
            return `<path d="M${bwRound(-r)} 0 C${bwRound(-r)} ${bwRound(-lift)} ${bwRound(r)} ${bwRound(-lift)} ${bwRound(r)} 0"/>`;
        }).join('');
        const ticks = `<path d="M0 ${bwRound(-T * 0.22)} L${bwRound(-T * 0.13)} ${bwRound(-T * 0.4)} M0 ${bwRound(-T * 0.22)} L${bwRound(T * 0.13)} ${bwRound(-T * 0.4)} M0 ${bwRound(-T * 0.22)} L0 ${bwRound(-T * 0.36)}"/>`;
        const motif = `<g id="m" fill="none" stroke="${line}" stroke-width="${sw}" stroke-linecap="round">${arcs}${ticks}</g>`;
        const tileH = 2 * S;
        return bwSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>${motif}<pattern id="p" width="${T}" height="${tileH}" patternUnits="userSpaceOnUse"><rect width="${T}" height="${tileH}" fill="${ground}"/><g opacity="0.62"><use xlink:href="#m" x="0" y="${tileH}"/><use xlink:href="#m" x="${T}" y="${tileH}"/><use xlink:href="#m" x="${T / 2}" y="${S}"/></g></pattern></defs><rect width="${W}" height="${H}" fill="url(#p)"/></svg>`);
    }

    function bwSunUrl(color) {
        const fill = normalizeHex(color) || BW.yellow;
        return bwSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="${fill}"/></svg>`);
    }

    /**
     * Warm glow. The layer paints the ground it sits on and then a radial
     * gradient, so it is a soft halo while the contrast pass still samples the
     * teal ground rather than a photograph stand-in.
     */
    function bwGlowUrl(color, base) {
        const fill = normalizeHex(color) || BW.orange;
        const ground = normalizeHex(base) || BW.teal;
        return bwSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 100 100"><defs><radialGradient id="g"><stop offset="0" stop-color="${fill}"/><stop offset="0.5" stop-color="${fill}" stop-opacity="0.92"/><stop offset="0.8" stop-color="${fill}" stop-opacity="0.45"/><stop offset="1" stop-color="${fill}" stop-opacity="0"/></radialGradient></defs><rect width="100" height="100" fill="${ground}"/><circle cx="50" cy="50" r="50" fill="url(#g)"/></svg>`);
    }

    function bwGullUrl(color) {
        const fill = normalizeHex(color) || BW.white;
        return bwSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="580" viewBox="0 0 100 58"><path d="M1 27C15 18 28 17 38 26C46 19 58 17 69 21C80 25 92 30 99 33C88 35 77 36 66 38C55 40 45 45 38 51C35 43 22 31 1 27Z" fill="${fill}"/></svg>`);
    }

    /**
     * A photo slot. The dashed frame and the "Add …" hint are baked into the
     * placeholder, so swapping the bound image variable removes the whole cue
     * without leaving orphaned type behind.
     */
    function bwPhotoUrl(options) {
        const spec = options || {};
        const fill = normalizeHex(spec.fill) || 'none';
        const stroke = normalizeHex(spec.stroke) || BW.white;
        const textColor = normalizeHex(spec.textColor) || BW.white;
        const label = text(spec.label, 48) || 'Add photo';
        const aspect = clamp(finite(spec.aspect, 1), 0.2, 5);
        const dash = clamp(finite(spec.dash, 1.8), 0.4, 4);
        const labelSize = clamp(finite(spec.font, 5), 1.5, 8);
        const h = bwRound(100 * aspect);
        const shape = spec.shape === 'rect'
            ? `<rect x="1.6" y="1.6" width="96.8" height="${bwRound(h - 3.2)}" rx="0"/>`
            : `<circle cx="50" cy="${bwRound(h / 2)}" r="${bwRound(Math.min(48, h / 2 - 2))}"/>`;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${bwRound(1000 * aspect)}" viewBox="0 0 100 ${h}"><g fill="${fill}" stroke="${stroke}" stroke-width="1.2" stroke-dasharray="${dash} ${bwRound(dash * 0.78)}">${shape}</g><text x="50" y="${bwRound(h / 2)}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="${labelSize}" fill="${textColor}">${label}</text></svg>`;
        return bwSvg(svg);
    }

    function bwImageVariable(id, name, url) {
        return {
            id,
            name,
            kind: 'image',
            defaultValue: String(url || '').slice(0, 2048),
            locked: false,
        };
    }

    function bwLogo(brand, variant) {
        const logos = (brand?.logos || []).filter((logo) => !logo.presentation);
        const words = logos.filter((logo) => String(logo.kind || '').toLowerCase() === 'wordmark');
        return words.find((logo) => logo.variant === variant)
            || words.find((logo) => logo.variant === 'color')
            || words[0]
            || null;
    }

    /** The group endorsement lockup, from the pack's portfolio assets when present. */
    function bwGroupLockup(ctx) {
        const assets = ctx?.portfolio?.assets || [];
        const usable = assets.filter((asset) => /\.(png|svg|webp)$/i.test(asset.url || ''));
        const named = usable.filter((asset) => /cawley/i.test(`${asset.name || ''} ${asset.path || ''}`));
        return named.find((asset) => /white|light/i.test(`${asset.name || ''} ${asset.path || ''}`))
            || named.find((asset) => /wordmark|lockup/i.test(`${asset.name || ''} ${asset.path || ''}`))
            || named[0]
            || null;
    }

    function bwWordmarkLayer(brand, spec) {
        const logo = bwLogo(brand, spec.variant || 'light');
        if (!logo) return null;
        const layer = imageLayer({
            id: spec.id, name: spec.name || 'Boardwalk wordmark', url: logo.url, fit: 'contain',
            x: spec.x, y: spec.y, w: spec.w, h: spec.h, z: spec.z ?? 20, bleed: true,
        });
        if (spec.recolor) {
            layer.recolorEnabled = true;
            layer.recolorColor = spec.recolor;
        }
        return layer;
    }

    function bwLockupLayer(ctx, spec) {
        const asset = bwGroupLockup(ctx);
        if (!asset) return null;
        return imageLayer({
            id: spec.id, name: spec.name || 'Cawley lockup', url: asset.url, fit: 'contain',
            x: spec.x, y: spec.y, w: spec.w, h: spec.h, z: spec.z ?? 20, bleed: true,
        });
    }

    function bwDashedCircle(spec) {
        return imageLayer({
            id: spec.id, name: spec.name || 'Photo slot', url: spec.url, fit: 'cover',
            x: spec.x, y: spec.y, w: spec.w, h: spec.h, z: spec.z ?? 6, bleed: false,
        });
    }

    /** The site handle every reference card carries. */
    const BW_SITE = 'www.cawleyhotels.com';
    const BW_GROUP_SITE = 'CAWLEYHOTELS.COM';

    function bwText(spec) {
        return textLayer({
            ...spec,
            family: spec.family || 'Helvetica Neue',
            weight: spec.weight ?? 300,
        });
    }

    // ── 1. Dessert of the day ─────────────────────────────────────────
    function buildDessertCard(ctx) {
        const { brand } = ctx;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'bw-dessert-ground', name: 'Blue ground', color: BW.blue, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(imageLayer({
            id: 'bw-dessert-pattern', name: 'Sea-glass scallops', url: bwScallopUrl({ width: 1080, height: 147, ground: BW.mint, line: BW.mintLine }),
            x: 0, y: 86.4, w: 100, h: 13.6, z: 1, bleed: true,
        }));
        const wordmark = bwWordmarkLayer(brand, { id: 'bw-dessert-wordmark', variant: 'light', x: 12, y: 5.4, w: 76, h: 8.45, z: 20 });
        if (wordmark) layers.push(wordmark);
        layers.push(bwText({
            id: 'bw-dessert-kicker', name: 'Kicker', binding: 'bw_dessert_kicker', text: 'Dessert of the day',
            sizePct: 2.7, letterSpacingEm: 0.26, transform: 'uppercase', color: BW.white,
            align: 'center', x: 5, y: 16.8, w: 90, h: 3.6, z: 30,
        }));
        variables.push(variable({ id: 'bw_dessert_kicker', name: 'Kicker', value: 'Dessert of the day' }));
        const photo = bwPhotoUrl({ label: 'Add dish photo', stroke: BW.white, textColor: BW.white, fill: 'none', dash: 1.8, font: 5.2 });
        const photoLayer = bwDashedCircle({ id: 'bw-dessert-photo', name: 'Dish photo', url: photo, x: 29, y: 26, w: 42, h: 42, z: 8 });
        photoLayer.bindings = { url: 'bw_dessert_photo' };
        layers.push(photoLayer);
        variables.push(bwImageVariable('bw_dessert_photo', 'Dish photo', photo));
        layers.push(bwText({
            id: 'bw-dessert-dish', name: 'Dish', binding: 'bw_dessert_dish', text: 'Sticky Toffee Pudding',
            family: 'Georgia', weight: 700, sizePct: 6.2, lineHeight: 1.05, color: BW.white,
            align: 'center', x: 5, y: 70.2, w: 90, h: 7, z: 30,
        }));
        variables.push(variable({ id: 'bw_dessert_dish', name: 'Dish', value: 'Sticky Toffee Pudding' }));
        layers.push(bwText({
            id: 'bw-dessert-detail', name: 'Description', binding: 'bw_dessert_detail',
            text: 'butterscotch sauce, vanilla ice cream · 8.95',
            family: 'Georgia', weight: 400, style: 'italic', sizePct: 2.7, color: BW.white,
            align: 'center', x: 5, y: 77.4, w: 90, h: 4.6, z: 30,
        }));
        variables.push(variable({ id: 'bw_dessert_detail', name: 'Description and price', value: 'butterscotch sauce, vanilla ice cream · 8.95' }));
        layers.push(imageLayer({
            id: 'bw-dessert-waves', name: 'Waves', url: bwWaveUrl({ width: 1080, height: 56, color: BW.white }),
            x: 0, y: 81.8, w: 100, h: 4.8, z: 12, bleed: true,
        }));
        layers.push(bwText({
            id: 'bw-dessert-footer', name: 'Website', binding: 'bw_dessert_footer', text: BW_SITE,
            sizePct: 2.5, weight: 500, letterSpacingEm: 0.01, color: BW.blueDeep,
            align: 'center', x: 5, y: 88.6, w: 90, h: 3.2, z: 30,
        }));
        variables.push(variable({ id: 'bw_dessert_footer', name: 'Website', value: BW_SITE }));
        return { layers, variables };
    }

    // ── 2. Sweets menu ────────────────────────────────────────────────
    function buildSweetsMenu(ctx) {
        const { brand } = ctx;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'bw-sweets-ground', name: 'Blue ground', color: BW.blue, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(imageLayer({ id: 'bw-sweets-mint', name: 'Mint ground', color: BW.mint, x: 0, y: 35.4, w: 100, h: 64.6, z: 1, bleed: true }));
        const wordmark = bwWordmarkLayer(brand, { id: 'bw-sweets-wordmark', variant: 'light', x: 12.5, y: 7.8, w: 75, h: 8.33, z: 20 });
        if (wordmark) layers.push(wordmark);
        layers.push(bwText({
            id: 'bw-sweets-kicker', name: 'Kicker', binding: 'bw_sweets_kicker', text: 'Sweets',
            sizePct: 2.7, letterSpacingEm: 0.34, transform: 'uppercase', color: BW.white,
            align: 'center', x: 5, y: 17.6, w: 90, h: 3.6, z: 30,
        }));
        variables.push(variable({ id: 'bw_sweets_kicker', name: 'Kicker', value: 'Sweets' }));
        layers.push(imageLayer({
            id: 'bw-sweets-waves', name: 'Waves', url: bwWaveUrl({ width: 1080, height: 74, color: BW.white }),
            x: 0, y: 30, w: 100, h: 5.6, z: 12, bleed: true,
        }));
        layers.push(imageLayer({ id: 'bw-sweets-card', name: 'Menu card', color: BW.white, x: 9, y: 39, w: 82, h: 27, z: 4, bleed: false }));
        const dishNames = ['Sticky Toffee Pudding', 'Caramel Churros', 'Homemade Tiramisu', 'Sicilian Lemon Sundae'];
        const prices = ['8.95', '8.95', '9.95', '9.95'];
        dishNames.forEach((name, index) => {
            const y = 43.2 + index * 5;
            layers.push(bwText({
                id: `bw-sweets-item-${index + 1}-name`, name: `Dish ${index + 1}`, binding: `bw_sweets_item_${index + 1}_name`, text: name,
                family: 'Georgia', weight: 700, sizePct: 3.3, color: BW.ink,
                align: 'left', x: 12.5, y, w: 55, h: 4.4, z: 30,
            }));
            variables.push(variable({ id: `bw_sweets_item_${index + 1}_name`, name: `Dish ${index + 1}`, value: name }));
            layers.push(bwText({
                id: `bw-sweets-item-${index + 1}-price`, name: `Price ${index + 1}`, binding: `bw_sweets_item_${index + 1}_price`, text: prices[index],
                family: 'Georgia', weight: 400, style: 'italic', sizePct: 3.1, color: BW.inkDeep,
                align: 'right', x: 70, y, w: 18, h: 4.4, z: 30,
            }));
            variables.push(variable({ id: `bw_sweets_item_${index + 1}_price`, name: `Price ${index + 1}`, value: prices[index] }));
        });
        layers.push(bwText({
            id: 'bw-sweets-tagline', name: 'Tagline', binding: 'bw_sweets_tagline', text: 'Save room for something sweet.',
            family: 'Georgia', weight: 400, style: 'italic', sizePct: 2.8, color: BW.inkDeep,
            align: 'center', x: 5, y: 68.4, w: 90, h: 4.2, z: 30,
        }));
        variables.push(variable({ id: 'bw_sweets_tagline', name: 'Tagline', value: 'Save room for something sweet.' }));
        layers.push(bwText({
            id: 'bw-sweets-footer', name: 'Website', binding: 'bw_sweets_footer', text: BW_SITE,
            sizePct: 2.4, weight: 500, color: BW.blueDeep,
            align: 'center', x: 5, y: 91.6, w: 90, h: 3.2, z: 30,
        }));
        variables.push(variable({ id: 'bw_sweets_footer', name: 'Website', value: BW_SITE }));
        return { layers, variables };
    }

    // ── 3. À la carte — pizza ─────────────────────────────────────────
    function buildALaCarte(ctx) {
        const { brand } = ctx;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'bw-alc-ground', name: 'Blue ground', color: BW.blue, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        const wordmark = bwWordmarkLayer(brand, { id: 'bw-alc-wordmark', variant: 'light', x: 12, y: 5.2, w: 76, h: 6.6, z: 20 });
        if (wordmark) layers.push(wordmark);
        layers.push(bwText({
            id: 'bw-alc-kicker', name: 'Kicker', binding: 'bw_alc_kicker', text: 'À la carte menu',
            sizePct: 2.5, letterSpacingEm: 0.3, transform: 'uppercase', color: BW.white,
            align: 'center', x: 5, y: 14, w: 90, h: 3.4, z: 30,
        }));
        variables.push(variable({ id: 'bw_alc_kicker', name: 'Kicker', value: 'À la carte menu' }));
        const photo = bwPhotoUrl({ shape: 'rect', aspect: 0.706, label: 'Add pizza photo', fill: '#8fd2ee', stroke: BW.white, textColor: BW.white, dash: 0.9, font: 2.8 });
        const photoLayer = bwDashedCircle({ id: 'bw-alc-photo', name: 'Pizza photo', url: photo, x: 7.5, y: 18.5, w: 85, h: 40, z: 8 });
        photoLayer.bindings = { url: 'bw_alc_photo' };
        layers.push(photoLayer);
        variables.push(bwImageVariable('bw_alc_photo', 'Pizza photo', photo));
        layers.push(bwText({
            id: 'bw-alc-eyebrow', name: 'Eyebrow', binding: 'bw_alc_eyebrow', text: 'Sea-salt stone baked',
            sizePct: 2.5, letterSpacingEm: 0.22, transform: 'uppercase', color: BW.white,
            align: 'center', x: 5, y: 63.2, w: 90, h: 3.2, z: 30,
        }));
        variables.push(variable({ id: 'bw_alc_eyebrow', name: 'Eyebrow', value: 'Sea-salt stone baked' }));
        layers.push(bwText({
            id: 'bw-alc-title', name: 'Dish title', binding: 'bw_alc_title', text: 'Pizza',
            family: 'Georgia', weight: 700, sizePct: 8.4, lineHeight: 1.02, color: BW.white,
            align: 'center', x: 5, y: 67.6, w: 90, h: 9.2, z: 30,
        }));
        variables.push(variable({ id: 'bw_alc_title', name: 'Dish title', value: 'Pizza' }));
        layers.push(bwText({
            id: 'bw-alc-flavours', name: 'Flavours', binding: 'bw_alc_flavours', text: 'Pepperoni & Hot Honey · Margherita · Vegana',
            family: 'Georgia', weight: 400, style: 'italic', sizePct: 2.6, lineHeight: 1.25, color: BW.white,
            align: 'center', x: 5, y: 75.4, w: 90, h: 6.4, z: 30,
        }));
        variables.push(variable({ id: 'bw_alc_flavours', name: 'Flavours', value: 'Pepperoni & Hot Honey · Margherita · Vegana' }));
        layers.push(bwText({
            id: 'bw-alc-price', name: 'Price line', binding: 'bw_alc_price', text: 'from 12.95',
            family: 'Georgia', weight: 400, style: 'italic', sizePct: 2.6, color: BW.white,
            align: 'center', x: 5, y: 80.4, w: 90, h: 4, z: 30,
        }));
        variables.push(variable({ id: 'bw_alc_price', name: 'Price line', value: 'from 12.95' }));
        layers.push(imageLayer({
            id: 'bw-alc-waves', name: 'Waves', url: bwWaveUrl({ width: 1000, height: 52, color: BW.white }),
            x: 0, y: 85.4, w: 100, h: 5, z: 12, bleed: true,
        }));
        layers.push(imageLayer({
            id: 'bw-alc-pattern', name: 'Sea-glass scallops', url: bwScallopUrl({ width: 1000, height: 150, ground: BW.mint, line: BW.mintLine }),
            x: 0, y: 90, w: 100, h: 10, z: 10, bleed: true,
        }));
        layers.push(bwText({
            id: 'bw-alc-footer', name: 'Website', binding: 'bw_alc_footer', text: BW_SITE,
            sizePct: 2.4, weight: 500, color: BW.blueDeep,
            align: 'center', x: 5, y: 92.4, w: 90, h: 3.2, z: 30,
        }));
        variables.push(variable({ id: 'bw_alc_footer', name: 'Website', value: BW_SITE }));
        return { layers, variables };
    }

    // ── 4. Good morning — breakfast story ─────────────────────────────
    function buildGoodMorning(ctx) {
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'bw-gm-ground', name: 'Blue ground', color: BW.blue, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        const lockup = bwLockupLayer(ctx, { id: 'bw-gm-lockup', x: 33, y: 12.8, w: 34, h: 6.6, z: 20 });
        if (lockup) layers.push(lockup);
        layers.push(bwText({
            id: 'bw-gm-headline', name: 'Headline', binding: 'bw_gm_headline', text: 'Good morning',
            sizePct: 10.3, weight: 300, lineHeight: 1, letterSpacingEm: 0.01, transform: 'uppercase', color: BW.white,
            align: 'center', x: 5, y: 26.6, w: 90, h: 21.4, z: 30,
        }));
        variables.push(variable({ id: 'bw_gm_headline', name: 'Headline', value: 'Good morning' }));
        layers.push(bwText({
            id: 'bw-gm-kicker', name: 'Kicker', binding: 'bw_gm_kicker', text: 'Now serving breakfast',
            sizePct: 2.2, letterSpacingEm: 0.16, transform: 'uppercase', color: BW.white,
            align: 'center', x: 5, y: 50.4, w: 90, h: 3.4, z: 30,
        }));
        variables.push(variable({ id: 'bw_gm_kicker', name: 'Kicker', value: 'Now serving breakfast' }));
        layers.push(bwText({
            id: 'bw-gm-dish', name: 'Dish', binding: 'bw_gm_dish', text: 'Full Scottish',
            family: 'Georgia', weight: 700, sizePct: 4.8, lineHeight: 1.05, color: BW.white,
            align: 'center', x: 5, y: 54, w: 90, h: 5.8, z: 30,
        }));
        variables.push(variable({ id: 'bw_gm_dish', name: 'Dish', value: 'Full Scottish' }));
        layers.push(bwText({
            id: 'bw-gm-detail', name: 'Description', binding: 'bw_gm_detail',
            text: 'your choice of eggs, dry-cured bacon, pork sausage, potato scone & black pudding · 14.95',
            family: 'Georgia', weight: 400, style: 'italic', sizePct: 2.2, lineHeight: 1.35, color: BW.white,
            align: 'center', x: 8, y: 60.4, w: 84, h: 8.4, z: 30,
        }));
        variables.push(variable({ id: 'bw_gm_detail', name: 'Description and price', value: 'your choice of eggs, dry-cured bacon, pork sausage, potato scone & black pudding · 14.95' }));
        layers.push(imageLayer({ id: 'bw-gm-gull', name: 'Gull', url: bwGullUrl(BW.white), x: 82, y: 68.4, w: 11, h: 5.8, z: 14, bleed: false }));
        layers.push(imageLayer({ id: 'bw-gm-sun', name: 'Sun', url: bwSunUrl(BW.yellow), x: 13, y: 78.5, w: 74, h: 41.6, z: 6, bleed: true }));
        layers.push(imageLayer({
            id: 'bw-gm-waves', name: 'Waves', url: bwWaveUrl({ width: 1080, height: 104, color: BW.white }),
            x: 0, y: 85.8, w: 100, h: 5.4, z: 12, bleed: true,
        }));
        layers.push(bwText({
            id: 'bw-gm-footer', name: 'Website', binding: 'bw_gm_footer', text: BW_SITE,
            sizePct: 2.4, weight: 500, color: BW.inkDeep,
            align: 'center', x: 5, y: 92, w: 90, h: 3.4, z: 30,
        }));
        variables.push(variable({ id: 'bw_gm_footer', name: 'Website', value: BW_SITE }));
        return { layers, variables };
    }

    // ── 5. Seasons — set-menu story ───────────────────────────────────
    function buildSeasonsStory(ctx) {
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'bw-seasons-ground', name: 'Teal ground', color: BW.teal, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(imageLayer({ id: 'bw-seasons-glow', name: 'Sunset glow', url: bwGlowUrl(BW.orange, BW.teal), x: 14, y: 21, w: 72, h: 40.5, z: 2, bleed: true }));
        const lockup = bwLockupLayer(ctx, { id: 'bw-seasons-lockup', x: 34, y: 12.2, w: 32, h: 6.6, z: 20 });
        if (lockup) layers.push(lockup);
        layers.push(imageLayer({ id: 'bw-seasons-gull', name: 'Gull', url: bwGullUrl(BW.white), x: 49, y: 27.2, w: 14, h: 7, z: 14, bleed: false }));
        layers.push(bwText({
            id: 'bw-seasons-title', name: 'Title', binding: 'bw_seasons_title', text: 'Seasons',
            sizePct: 8.2, weight: 300, lineHeight: 1.05, letterSpacingEm: 0.12, transform: 'uppercase', color: BW.white,
            align: 'center', x: 5, y: 38, w: 90, h: 9.2, z: 30,
        }));
        variables.push(variable({ id: 'bw_seasons_title', name: 'Title', value: 'Seasons' }));
        layers.push(bwText({
            id: 'bw-seasons-kicker', name: 'Kicker', binding: 'bw_seasons_kicker', text: 'Scottish set menu',
            sizePct: 2.2, letterSpacingEm: 0.24, transform: 'uppercase', color: BW.white,
            align: 'center', x: 5, y: 47.2, w: 90, h: 3.4, z: 30,
        }));
        variables.push(variable({ id: 'bw_seasons_kicker', name: 'Kicker', value: 'Scottish set menu' }));
        layers.push(bwText({
            id: 'bw-seasons-price-2', name: 'Two courses', binding: 'bw_seasons_price_2', text: '2 Courses · 25.95',
            family: 'Georgia', weight: 400, sizePct: 4.7, lineHeight: 1.02, color: BW.white,
            align: 'center', x: 5, y: 51.4, w: 90, h: 5.4, z: 30,
        }));
        variables.push(variable({ id: 'bw_seasons_price_2', name: 'Two courses', value: '2 Courses · 25.95' }));
        layers.push(bwText({
            id: 'bw-seasons-price-3', name: 'Three courses', binding: 'bw_seasons_price_3', text: '3 Courses · 29.95',
            family: 'Georgia', weight: 400, sizePct: 4.7, lineHeight: 1.02, color: BW.white,
            align: 'center', x: 5, y: 56.6, w: 90, h: 5.4, z: 30,
        }));
        variables.push(variable({ id: 'bw_seasons_price_3', name: 'Three courses', value: '3 Courses · 29.95' }));
        layers.push(bwText({
            id: 'bw-seasons-detail', name: 'Desserts', binding: 'bw_seasons_detail',
            text: 'Cullen Skink · Haggis, Neeps & Tatties',
            family: 'Georgia', weight: 400, style: 'italic', sizePct: 2.2, color: BW.white,
            align: 'center', x: 5, y: 63, w: 90, h: 4, z: 30,
        }));
        variables.push(variable({ id: 'bw_seasons_detail', name: 'Desserts', value: 'Cullen Skink · Haggis, Neeps & Tatties' }));
        layers.push(bwText({
            id: 'bw-seasons-detail-2', name: 'Desserts, second line', binding: 'bw_seasons_detail_2',
            text: 'Cranachan Mini Mess',
            family: 'Georgia', weight: 400, style: 'italic', sizePct: 2.2, color: BW.white,
            align: 'center', x: 5, y: 65.8, w: 90, h: 4, z: 30,
        }));
        variables.push(variable({ id: 'bw_seasons_detail_2', name: 'Desserts, second line', value: 'Cranachan Mini Mess' }));
        layers.push(imageLayer({
            id: 'bw-seasons-waves', name: 'Waves', url: bwWaveUrl({ width: 1080, height: 116, color: BW.white }),
            x: 0, y: 83.4, w: 100, h: 6.4, z: 12, bleed: true,
        }));
        layers.push(bwText({
            id: 'bw-seasons-footer', name: 'Website', binding: 'bw_seasons_footer', text: BW_GROUP_SITE,
            sizePct: 2.5, weight: 500, letterSpacingEm: 0.18, color: BW.white,
            align: 'center', x: 5, y: 91.8, w: 90, h: 3.4, z: 30,
        }));
        variables.push(variable({ id: 'bw_seasons_footer', name: 'Website', value: BW_GROUP_SITE }));
        return { layers, variables };
    }

    // ── 6. Event post ─────────────────────────────────────────────────
    function buildEventPost(ctx) {
        const { brand } = ctx;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'bw-event-ground', name: 'Blue ground', color: BW.blue, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        const wordmark = bwWordmarkLayer(brand, { id: 'bw-event-wordmark', variant: 'light', x: 8, y: 12.5, w: 48, h: 15.4, z: 20 });
        if (wordmark) layers.push(wordmark);
        layers.push(bwText({
            id: 'bw-event-type', name: 'Event type', binding: 'bw_event_type', text: '[Event type]',
            sizePct: 3.1, letterSpacingEm: 0.14, transform: 'uppercase', color: BW.white,
            align: 'left', x: 8, y: 32.4, w: 48, h: 4.6, z: 30,
        }));
        variables.push(variable({ id: 'bw_event_type', name: 'Event type', value: '[Event type]' }));
        layers.push(bwText({
            id: 'bw-event-headline', name: 'Headline', binding: 'bw_event_headline', text: '[Headline goes here]',
            family: 'Georgia', weight: 700, sizePct: 7.2, lineHeight: 1.04, color: BW.white,
            align: 'left', x: 8, y: 43.2, w: 48, h: 12.5, z: 30,
        }));
        variables.push(variable({ id: 'bw_event_headline', name: 'Headline', value: '[Headline goes here]' }));
        layers.push(bwText({
            id: 'bw-event-detail', name: 'Date and CTA', binding: 'bw_event_detail', text: '[Date] · [Time] · Book now',
            family: 'Georgia', weight: 400, style: 'italic', sizePct: 3, color: BW.white,
            align: 'left', x: 8, y: 57.2, w: 50, h: 5.2, z: 30,
        }));
        variables.push(variable({ id: 'bw-event_detail', name: 'Date and CTA', value: '[Date] · [Time] · Book now' }));
        const photo = bwPhotoUrl({ label: 'Add photo', fill: '#2f9fd6', stroke: BW.white, textColor: BW.white, dash: 1.9, font: 5.6 });
        const photoLayer = bwDashedCircle({ id: 'bw-event-photo', name: 'Event photo', url: photo, x: 59, y: 10, w: 35, h: 66.7, z: 8 });
        photoLayer.bindings = { url: 'bw_event_photo' };
        layers.push(photoLayer);
        variables.push(bwImageVariable('bw_event_photo', 'Event photo', photo));
        layers.push(imageLayer({
            id: 'bw-event-waves', name: 'Waves', url: bwWaveUrl({ width: 1200, height: 52, color: BW.white }),
            x: 0, y: 81.4, w: 100, h: 8.4, z: 12, bleed: true,
        }));
        layers.push(imageLayer({
            id: 'bw-event-pattern', name: 'Sea-glass scallops', url: bwScallopUrl({ width: 1200, height: 66, ground: BW.mint, line: BW.mintLine }),
            x: 0, y: 89.4, w: 100, h: 10.6, z: 10, bleed: true,
        }));
        layers.push(bwText({
            id: 'bw-event-footer', name: 'Website', binding: 'bw_event_footer', text: BW_SITE,
            sizePct: 2.6, weight: 500, color: BW.blueDeep,
            align: 'center', x: 5, y: 92.6, w: 90, h: 3.4, z: 30,
        }));
        variables.push(variable({ id: 'bw_event_footer', name: 'Website', value: BW_SITE }));
        return { layers, variables };
    }

    // ── 7. Announcement banner ────────────────────────────────────────
    function buildAnnouncement(ctx) {
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'bw-ann-ground', name: 'Blue ground', color: BW.blue, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        const lockup = bwLockupLayer(ctx, { id: 'bw-ann-lockup', x: 6, y: 13.4, w: 26, h: 15.4, z: 20 });
        if (lockup) layers.push(lockup);
        layers.push(imageLayer({ id: 'bw-ann-gull', name: 'Gull', url: bwGullUrl(BW.white), x: 72.5, y: 16.6, w: 14, h: 7.4, z: 14, bleed: false }));
        layers.push(bwText({
            id: 'bw-ann-topic', name: 'Topic', binding: 'bw_ann_topic', text: "[Topic · e.g. we're hiring]",
            sizePct: 2.9, letterSpacingEm: 0.12, transform: 'uppercase', color: BW.white,
            align: 'left', x: 6, y: 33.6, w: 52, h: 4.4, z: 30,
        }));
        variables.push(variable({ id: 'bw_ann_topic', name: 'Topic', value: "[Topic · e.g. we're hiring]" }));
        layers.push(bwText({
            id: 'bw-ann-headline', name: 'Headline', binding: 'bw_ann_headline', text: '[Headline goes here]',
            family: 'Georgia', weight: 700, sizePct: 7.2, lineHeight: 1.04, color: BW.white,
            align: 'left', x: 6, y: 42.8, w: 52, h: 12.5, z: 30,
        }));
        variables.push(variable({ id: 'bw_ann_headline', name: 'Headline', value: '[Headline goes here]' }));
        layers.push(bwText({
            id: 'bw-ann-detail', name: 'Supporting line', binding: 'bw_ann_detail', text: '[One supporting line]',
            family: 'Georgia', weight: 400, style: 'italic', sizePct: 3, color: BW.white,
            align: 'left', x: 6, y: 56.8, w: 52, h: 5.2, z: 30,
        }));
        variables.push(variable({ id: 'bw_ann_detail', name: 'Supporting line', value: '[One supporting line]' }));
        layers.push(imageLayer({ id: 'bw-ann-sun', name: 'Sun', url: bwSunUrl(BW.yellow), x: 58, y: 51, w: 42, h: 80, z: 6, bleed: true }));
        layers.push(imageLayer({
            id: 'bw-ann-waves', name: 'Waves', url: bwWaveUrl({ width: 1200, height: 52, color: BW.white }),
            x: 0, y: 77.4, w: 100, h: 9.4, z: 12, bleed: true,
        }));
        layers.push(bwText({
            id: 'bw-ann-footer', name: 'Website', binding: 'bw_ann_footer', text: BW_SITE,
            sizePct: 2.8, weight: 500, color: BW.white,
            align: 'left', x: 6, y: 88.6, w: 40, h: 3.8, z: 30,
        }));
        variables.push(variable({ id: 'bw_ann_footer', name: 'Website', value: BW_SITE }));
        return { layers, variables };
    }

    // ── 8. From the sea — dish post ───────────────────────────────────
    function buildFromTheSea(ctx) {
        const { brand } = ctx;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'bw-sea-ground', name: 'Paper ground', color: BW.white, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(imageLayer({
            id: 'bw-sea-pattern', name: 'Sea-glass scallops', url: bwScallopUrl({ width: 1600, height: 187, ground: BW.mint, line: BW.mintLine }),
            x: 0, y: 79.2, w: 100, h: 20.8, z: 1, bleed: true,
        }));
        const wordmark = bwWordmarkLayer(brand, { id: 'bw-sea-wordmark', variant: 'light', x: 8, y: 9.2, w: 51, h: 10.4, z: 20, recolor: BW.blue });
        if (wordmark) layers.push(wordmark);
        layers.push(bwText({
            id: 'bw-sea-kicker', name: 'Kicker', binding: 'bw_sea_kicker', text: 'From the sea',
            sizePct: 2.7, letterSpacingEm: 0.26, transform: 'uppercase', color: '#0a7f76',
            align: 'left', x: 8, y: 30.2, w: 45, h: 3.6, z: 30,
        }));
        variables.push(variable({ id: 'bw_sea_kicker', name: 'Kicker', value: 'From the sea' }));
        layers.push(bwText({
            id: 'bw-sea-dish', name: 'Dish', binding: 'bw_sea_dish', text: 'Classic Fish & Chips',
            family: 'Georgia', weight: 700, sizePct: 7.8, lineHeight: 1.02, color: BW.ink,
            align: 'left', x: 8, y: 34, w: 52, h: 18, z: 30,
        }));
        variables.push(variable({ id: 'bw_sea_dish', name: 'Dish', value: 'Classic Fish & Chips' }));
        layers.push(bwText({
            id: 'bw-sea-detail', name: 'Description', binding: 'bw_sea_detail',
            text: 'battered haddock, minted mushy peas, lemon wedge · 19.95',
            family: 'Georgia', weight: 400, style: 'italic', sizePct: 2.8, lineHeight: 1.35, color: BW.ink,
            align: 'left', x: 8, y: 54.4, w: 45, h: 8, z: 30,
        }));
        variables.push(variable({ id: 'bw_sea_detail', name: 'Description and price', value: 'battered haddock, minted mushy peas, lemon wedge · 19.95' }));
        const photo = bwPhotoUrl({ label: 'Add dish photo', fill: '#eaf5f9', stroke: BW.blue, textColor: '#1b4c5a', dash: 1.4, font: 4.2 });
        const photoLayer = bwDashedCircle({ id: 'bw-sea-photo', name: 'Dish photo', url: photo, x: 59, y: 8.5, w: 35, h: 62.2, z: 8 });
        photoLayer.bindings = { url: 'bw_sea_photo' };
        layers.push(photoLayer);
        variables.push(bwImageVariable('bw_sea_photo', 'Dish photo', photo));
        layers.push(imageLayer({
            id: 'bw-sea-waves', name: 'Waves', url: bwWaveUrl({ width: 1600, height: 76, color: BW.blue }),
            x: 0, y: 71, w: 100, h: 8.4, z: 12, bleed: true,
        }));
        layers.push(bwText({
            id: 'bw-sea-footer', name: 'Website', binding: 'bw_sea_footer', text: BW_SITE,
            sizePct: 2.7, weight: 500, color: BW.blueDeep,
            align: 'center', x: 5, y: 85, w: 90, h: 3.4, z: 30,
        }));
        variables.push(variable({ id: 'bw_sea_footer', name: 'Website', value: BW_SITE }));
        return { layers, variables };
    }

    // ── 9. Boardwalk banner ───────────────────────────────────────────
    function buildBoardwalkBanner(ctx) {
        const { brand } = ctx;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'bw-banner-ground', name: 'Blue ground', color: BW.blue, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        const wordmark = bwWordmarkLayer(brand, { id: 'bw-banner-wordmark', variant: 'light', x: 8, y: 11, w: 70, h: 20.5, z: 20 });
        if (wordmark) layers.push(wordmark);
        layers.push(imageLayer({ id: 'bw-banner-gull', name: 'Gull', url: bwGullUrl('#bfe3dc'), x: 76.5, y: 14.5, w: 13, h: 6.5, z: 21, bleed: false }));
        layers.push(bwText({
            id: 'bw-banner-caption', name: 'Caption', binding: 'bw_banner_caption', text: 'Cawley Hotels & Restaurants',
            sizePct: 4.2, letterSpacingEm: 0.34, transform: 'uppercase', color: BW.white,
            align: 'center', x: 5, y: 38.4, w: 90, h: 6, z: 30,
        }));
        variables.push(variable({ id: 'bw_banner_caption', name: 'Caption', value: 'Cawley Hotels & Restaurants' }));
        layers.push(imageLayer({
            id: 'bw-banner-waves', name: 'Waves', url: bwWaveUrl({ width: 1600, height: 90, rows: 4, color: BW.white }),
            x: 0, y: 69.5, w: 100, h: 15, z: 12, bleed: true,
        }));
        layers.push(imageLayer({
            id: 'bw-banner-pattern', name: 'Sea-glass scallops', url: bwScallopUrl({ width: 1600, height: 96, ground: BW.mint, line: BW.mintLine }),
            x: 0, y: 84, w: 100, h: 16, z: 10, bleed: true,
        }));
        return { layers, variables };
    }

    // ── 10. Group banner ──────────────────────────────────────────────
    function buildGroupBanner(ctx) {
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'bw-group-ground', name: 'Teal ground', color: BW.teal, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(imageLayer({ id: 'bw-group-glow', name: 'Sunset glow', url: bwGlowUrl(BW.orange, BW.teal), x: 57, y: -34, w: 42, h: 168, z: 2, bleed: true }));
        const lockup = bwLockupLayer(ctx, { id: 'bw-group-lockup', x: 56, y: 17, w: 28, h: 40, z: 20 });
        if (lockup) layers.push(lockup);
        layers.push(bwText({
            id: 'bw-group-venues', name: 'Venues', binding: 'bw_group_venues',
            text: 'Duck Bay · Boat Yard · Coast · Boardwalk · River House',
            sizePct: 3.4, letterSpacingEm: 0.14, transform: 'uppercase', color: BW.white,
            align: 'center', x: 42, y: 65.4, w: 56, h: 7.6, z: 30,
        }));
        variables.push(variable({ id: 'bw_group_venues', name: 'Venues', value: 'Duck Bay · Boat Yard · Coast · Boardwalk · River House' }));
        layers.push(imageLayer({
            id: 'bw-group-waves', name: 'Waves', url: bwWaveUrl({ width: 1600, height: 108, rows: 4, thickness: 0.05, color: BW.white }),
            x: 0, y: 74.5, w: 100, h: 25.5, z: 12, bleed: true,
        }));
        return { layers, variables };
    }

    const BW_TEMPLATES = [
        {
            id: 'bw-dessert',
            label: 'Dessert of the day',
            category: 'Social',
            description: 'A blue dessert card with the wordmark, a circular dish-photo slot, the dish and price, and the sea-glass footer.',
            channel: 'social',
            width: 1080,
            height: 1080,
            widthMm: null,
            heightMm: null,
            paper: '1:1',
            dpi: 72,
            formats: [],
            appliesTo: BOARDWALK_BRAND,
            safeZone: BW_SAFE_ZONE,
            kitColors: BW_KIT_COLORS,
            palette: { ground: BW.blue, ink: BW.ink, accent: BW.mint },
            build: buildDessertCard,
        },
        {
            id: 'bw-sweets-menu',
            label: 'Sweets menu',
            category: 'Social',
            description: 'A 4:5 sweets menu: a white card with four dishes and prices over the mint ground, wordmark and waves above.',
            channel: 'social',
            width: 1080,
            height: 1350,
            widthMm: null,
            heightMm: null,
            paper: '4:5',
            dpi: 72,
            formats: [],
            appliesTo: BOARDWALK_BRAND,
            safeZone: BW_SAFE_ZONE,
            kitColors: BW_KIT_COLORS,
            palette: { ground: BW.mint, ink: BW.ink, accent: BW.blue },
            build: buildSweetsMenu,
        },
        {
            id: 'bw-a-la-carte',
            label: 'À la carte — pizza',
            category: 'Social',
            description: 'A 2:3 à la carte card with a dashed pizza-photo frame, the sea-salt eyebrow, dish, flavours and price.',
            channel: 'social',
            width: 1000,
            height: 1500,
            widthMm: null,
            heightMm: null,
            paper: '2:3',
            dpi: 72,
            formats: [],
            appliesTo: BOARDWALK_BRAND,
            safeZone: BW_SAFE_ZONE,
            kitColors: BW_KIT_COLORS,
            palette: { ground: BW.blue, ink: BW.ink, accent: BW.white },
            build: buildALaCarte,
        },
        {
            id: 'bw-good-morning',
            label: 'Good morning story',
            category: 'Social',
            description: 'A 9:16 breakfast story: the Cawley lockup, a big GOOD MORNING, the Full Scottish line, a gull and the sun and waves.',
            channel: 'social',
            width: 1080,
            height: 1920,
            widthMm: null,
            heightMm: null,
            paper: '9:16',
            dpi: 72,
            formats: [],
            appliesTo: BOARDWALK_BRAND,
            safeZone: BW_SAFE_ZONE,
            kitColors: BW_KIT_COLORS,
            palette: { ground: BW.blue, ink: BW.ink, accent: BW.yellow },
            build: buildGoodMorning,
        },
        {
            id: 'bw-seasons',
            label: 'Seasons story',
            category: 'Social',
            description: 'A 9:16 set-menu story on teal with the orange glow, SEASONS, two price lines and the dessert list.',
            channel: 'social',
            width: 1080,
            height: 1920,
            widthMm: null,
            heightMm: null,
            paper: '9:16',
            dpi: 72,
            formats: [],
            appliesTo: BOARDWALK_BRAND,
            safeZone: BW_SAFE_ZONE,
            kitColors: BW_KIT_COLORS,
            palette: { ground: BW.teal, ink: BW.ink, accent: BW.orange },
            build: buildSeasonsStory,
        },
        {
            id: 'bw-event-post',
            label: 'Event post',
            category: 'Social',
            description: 'A 1.91:1 event card with the wordmark, event type, headline and date, plus a circular photo slot.',
            channel: 'social',
            width: 1200,
            height: 630,
            widthMm: null,
            heightMm: null,
            paper: '1.91:1',
            dpi: 72,
            formats: [],
            appliesTo: BOARDWALK_BRAND,
            safeZone: BW_SAFE_ZONE,
            kitColors: BW_KIT_COLORS,
            palette: { ground: BW.blue, ink: BW.ink, accent: BW.mint },
            build: buildEventPost,
        },
        {
            id: 'bw-announcement',
            label: 'Announcement banner',
            category: 'Social',
            description: 'A 1.91:1 announcement card: the Cawley lockup, topic, headline and supporting line over the sun and waves.',
            channel: 'social',
            width: 1200,
            height: 630,
            widthMm: null,
            heightMm: null,
            paper: '1.91:1',
            dpi: 72,
            formats: [],
            appliesTo: BOARDWALK_BRAND,
            safeZone: BW_SAFE_ZONE,
            kitColors: BW_KIT_COLORS,
            palette: { ground: BW.blue, ink: BW.ink, accent: BW.yellow },
            build: buildAnnouncement,
        },
        {
            id: 'bw-from-the-sea',
            label: 'From the sea — dish post',
            category: 'Social',
            description: 'A 16:9 light dish card with the blue wordmark, FROM THE SEA, the fish dish and a circular photo slot.',
            channel: 'social',
            width: 1600,
            height: 900,
            widthMm: null,
            heightMm: null,
            paper: '16:9',
            dpi: 72,
            formats: [],
            appliesTo: BOARDWALK_BRAND,
            safeZone: BW_SAFE_ZONE,
            kitColors: BW_KIT_COLORS,
            palette: { ground: BW.white, ink: BW.ink, accent: BW.mint },
            build: buildFromTheSea,
        },
        {
            id: 'bw-banner',
            label: 'Boardwalk banner',
            category: 'Social',
            description: 'A wide 8:3 boardwalk header with the full wordmark, the gull, the Cawley endorsement and the sea-glass footer.',
            channel: 'social',
            width: 1600,
            height: 600,
            widthMm: null,
            heightMm: null,
            paper: '8:3',
            dpi: 72,
            formats: [],
            appliesTo: BOARDWALK_BRAND,
            safeZone: BW_SAFE_ZONE,
            kitColors: BW_KIT_COLORS,
            palette: { ground: BW.blue, ink: BW.ink, accent: BW.mint },
            build: buildBoardwalkBanner,
        },
        {
            id: 'bw-group-banner',
            label: 'Group banner',
            category: 'Social',
            description: 'A 4:1 group header on teal with the Cawley lockup, the sunset glow and the five venue names.',
            channel: 'social',
            width: 1600,
            height: 400,
            widthMm: null,
            heightMm: null,
            paper: '4:1',
            dpi: 72,
            formats: [],
            appliesTo: BOARDWALK_BRAND,
            safeZone: BW_SAFE_ZONE,
            kitColors: BW_KIT_COLORS,
            palette: { ground: BW.teal, ink: BW.ink, accent: BW.orange },
            build: buildGroupBanner,
        },
    ];

    const TEMPLATES = [
        {
            id: 'menu',
            label: 'Menu',
            category: 'Print',
            description: 'A four- or five-course menu with prices, descriptions and a footer.',
            channel: 'print',
            width: 2480,
            height: 3508,
            widthMm: 210,
            heightMm: 297,
            paper: 'A4',
            dpi: 300,
            formats: [
                { id: 'a5', label: 'A5 menu', width: 1748, height: 2480, widthMm: 148, heightMm: 210 },
                { id: 'a3', label: 'A3 menu', width: 3508, height: 4961, widthMm: 297, heightMm: 420 },
            ],
            build: buildMenu,
        },
        {
            id: 'business-card-front',
            label: 'Business card — front',
            category: 'Stationery',
            description: 'Logo, tagline and a hairline rule on the brand ground.',
            channel: 'print',
            width: 1004,
            height: 650,
            widthMm: 85,
            heightMm: 55,
            paper: '85 × 55 mm',
            dpi: 300,
            formats: [],
            build: buildBusinessCardFront,
        },
        {
            id: 'business-card-back',
            label: 'Business card — back',
            category: 'Stationery',
            description: 'Name, role and the canonical contact block from the brand guide.',
            channel: 'print',
            width: 1004,
            height: 650,
            widthMm: 85,
            heightMm: 55,
            paper: '85 × 55 mm',
            dpi: 300,
            formats: [],
            build: buildBusinessCardBack,
        },
        {
            id: 'flyer',
            label: 'Flyer',
            category: 'Print',
            description: 'A5 portrait flyer with a full-bleed photograph band and a clear call to action.',
            channel: 'print',
            width: 1748,
            height: 2480,
            widthMm: 148,
            heightMm: 210,
            paper: 'A5',
            dpi: 300,
            formats: [],
            build: buildFlyer,
        },
        {
            id: 'table-card',
            label: 'Table card',
            category: 'In-store',
            description: 'A6 table talker for a dish, a special or a drink.',
            channel: 'print',
            width: 1240,
            height: 1748,
            widthMm: 105,
            heightMm: 148,
            paper: 'A6',
            dpi: 300,
            formats: [],
            build: buildTableCard,
        },
        {
            id: 'voucher',
            label: 'Gift voucher',
            category: 'Print',
            description: 'DL voucher with a value, terms, a redemption code and the venue contact.',
            channel: 'print',
            width: 2480,
            height: 1169,
            widthMm: 210,
            heightMm: 99,
            paper: 'DL',
            dpi: 300,
            formats: [],
            build: buildVoucher,
        },
        {
            id: 'social-post',
            label: 'Social post',
            category: 'Social',
            description: 'A square 1:1 post with a headline, a sub-head and the venue handle.',
            channel: 'social',
            width: 1080,
            height: 1080,
            widthMm: null,
            heightMm: null,
            paper: '1:1',
            dpi: 72,
            formats: [
                { id: 'portrait', label: '4:5 portrait', width: 1080, height: 1350, widthMm: null, heightMm: null },
            ],
            build: buildSocialPost,
        },
        {
            id: 'social-story',
            label: 'Story — animated',
            category: 'Digital',
            description: 'A 9:16 story that moves: a slow photographic push, the wordmark and a clear headline. Ready for GIF or MP4.',
            channel: 'social',
            width: 1080,
            height: 1920,
            widthMm: null,
            heightMm: null,
            paper: '9:16',
            dpi: 72,
            duration: 6000,
            motion: true,
            formats: [],
            build: buildSocialStory,
        },
        {
            id: 'social-reel',
            label: 'Reel — 9:16',
            category: 'Digital',
            description: 'A longer vertical loop with a parallax photograph, a large statement and the venue details. Video first, GIF ready.',
            channel: 'video',
            width: 1080,
            height: 1920,
            widthMm: null,
            heightMm: null,
            paper: '9:16',
            dpi: 72,
            duration: 8000,
            motion: true,
            formats: [],
            build: buildSocialReel,
        },
        {
            id: 'square-loop',
            label: 'Square loop — GIF',
            category: 'Digital',
            description: 'A type-led 1:1 loop with the wordmark, an accent bar and the tagline. A small, fast GIF for feeds and stories.',
            channel: 'social',
            width: 1080,
            height: 1080,
            widthMm: null,
            heightMm: null,
            paper: '1:1',
            dpi: 72,
            duration: 5000,
            motion: true,
            formats: [],
            build: buildSquareLoop,
        },
        {
            id: 'display-screen',
            label: 'Display screen — 16:9',
            category: 'Digital',
            description: 'A 1920 × 1080 screen loop for bars, receptions and social video, built from the brand photography.',
            channel: 'display',
            width: 1920,
            height: 1080,
            widthMm: null,
            heightMm: null,
            paper: '16:9',
            dpi: 72,
            duration: 6000,
            motion: true,
            formats: [],
            build: buildDisplayScreen,
        },
        {
            id: 'digital-menu-board',
            label: 'Digital menu board',
            category: 'Digital',
            description: 'A 16:9 menu board with five dishes, prices and the venue mark for screens above the bar.',
            channel: 'display',
            width: 1920,
            height: 1080,
            widthMm: null,
            heightMm: null,
            paper: '16:9',
            dpi: 72,
            duration: 5000,
            motion: true,
            formats: [],
            build: buildDigitalMenuBoard,
        },
        {
            id: 'link-preview',
            label: 'Link preview',
            category: 'Digital',
            description: 'A 1200 × 630 share card with the wordmark, a headline and the address; works as a still, GIF or MP4.',
            channel: 'social',
            width: 1200,
            height: 630,
            widthMm: null,
            heightMm: null,
            paper: '1.91:1',
            dpi: 72,
            duration: 4000,
            motion: true,
            formats: [],
            build: buildLinkPreview,
        },
        {
            id: 'flavour-card',
            label: 'Flavour spotlight',
            category: 'Social',
            description: 'A 4:5 flavour card with a cut-out product, size badge and a reseller call to action.',
            channel: 'social',
            width: 1080,
            height: 1350,
            widthMm: null,
            heightMm: null,
            paper: '4:5',
            dpi: 72,
            formats: [],
            appliesTo: ICE_CREAM,
            build: buildFlavourCard,
        },
        {
            id: 'range-social',
            label: 'Range post',
            category: 'Social',
            description: 'A square range post: three cut-out products under the 80-flavour headline.',
            channel: 'social',
            width: 1080,
            height: 1080,
            widthMm: null,
            heightMm: null,
            paper: '1:1',
            dpi: 72,
            formats: [],
            appliesTo: ICE_CREAM,
            build: buildRangeSocial,
        },
        {
            id: 'reseller-social',
            label: 'Reseller post',
            category: 'Social',
            description: 'A 4:5 recruitment post for new resellers, with the commercial phone and email.',
            channel: 'social',
            width: 1080,
            height: 1350,
            widthMm: null,
            heightMm: null,
            paper: '4:5',
            dpi: 72,
            formats: [],
            appliesTo: ICE_CREAM,
            build: buildResellerSocial,
        },
        {
            id: 'premium-social',
            label: 'Premium post',
            category: 'Social',
            description: 'A dark chocolate-and-gold 4:5 post for the truffled/pistachio line, product cut-out and 29-year seal.',
            channel: 'social',
            width: 1080,
            height: 1350,
            widthMm: null,
            heightMm: null,
            paper: '4:5',
            dpi: 72,
            formats: [],
            appliesTo: ICE_CREAM,
            build: buildPremiumSocial,
        },
        {
            id: 'flavour-story',
            label: 'Flavour story',
            category: 'Social',
            description: 'A 9:16 flavour story with a cut-out product, size badge and reseller call to action.',
            channel: 'social',
            width: 1080,
            height: 1920,
            widthMm: null,
            heightMm: null,
            paper: '9:16',
            dpi: 72,
            formats: [],
            appliesTo: ICE_CREAM,
            build: buildFlavourStory,
        },
        {
            id: 'premium-story',
            label: 'Premium story',
            category: 'Social',
            description: 'A 9:16 chocolate-and-gold story for the truffled line, with the 29-year seal.',
            channel: 'social',
            width: 1080,
            height: 1920,
            widthMm: null,
            heightMm: null,
            paper: '9:16',
            dpi: 72,
            formats: [],
            appliesTo: ICE_CREAM,
            build: buildPremiumStory,
        },
    ];

    // The Boardwalk social set is appended so the shared initial list stays in
    // its published order for every other brand.
    TEMPLATES.push(...BW_TEMPLATES);

    function templateById(id) {
        return TEMPLATES.find((template) => template.id === id) || null;
    }

    function templateSpec(template) {
        if (template.widthMm && template.heightMm) {
            return `${template.paper} · ${template.widthMm} × ${template.heightMm} mm · ${template.dpi} dpi`;
        }
        return `${template.width} × ${template.height} px · ${template.paper}`;
    }

    function templateCatalog(brand) {
        return TEMPLATES.filter((template) => !template.appliesTo || template.appliesTo(brand)).map((template) => {
            const application = brand ? applicationFor(brand, template.id) : null;
            return {
                id: template.id,
                label: template.label,
                category: template.category,
                description: template.description,
                spec: templateSpec(template),
                width: template.width,
                height: template.height,
                widthMm: template.widthMm,
                heightMm: template.heightMm,
                dpi: template.dpi,
                paper: template.paper,
                channel: template.channel,
                duration: Number(template.duration) || 10000,
                motion: template.motion === true,
                formats: template.formats.map((format) => format.label || format.id),
                guideline: application
                    ? { application: application.application, specification: application.specification, scope: application.scope }
                    : null,
            };
        });
    }

    // ---------------------------------------------------------------------
    // Composition builders
    // ---------------------------------------------------------------------
    function fontFor(brand, role) {
        const scale = brand?.typography?.scale || [];
        const families = brand?.typography?.families || [];
        const lookup = (id) => scale.find((entry) => entry.id === id && entry.family);
        const display = lookup('title') || lookup('display--wordmark') || lookup('heading-xl');
        const heading = lookup('heading-l') || lookup('heading-m') || lookup('heading-s') || display;
        const body = lookup('body-m') || lookup('body-l') || lookup('body-s');
        const label = lookup('menu--navigation') || lookup('heading-s') || heading;
        const pick = {
            display: display?.family,
            title: display?.family,
            heading: heading?.family,
            body: body?.family || families[1] || families[0],
            label: label?.family,
        }[role];
        return pick || families[0] || 'Inter';
    }

    function makeContext(brand, template) {
        const roles = paletteRoles(brand, template.id);
        const contact = contactMap(brand);
        // An accent has to survive on the ground it is set against: on the ink
        // grounds the display templates use, the ink itself is invisible, so
        // white takes over.
        const accentFor = (bgHex, target = 4.5) => {
            const bg = normalizeHex(bgHex) || '#ffffff';
            const candidates = [roles.accent.hex, roles.ink.hex, '#ffffff', '#0b0b0b'];
            return candidates.find((hex) => contrastRatio(hex, bg) >= target)
                || candidates.slice().sort((a, b) => contrastRatio(b, bg) - contrastRatio(a, bg))[0];
        };
        const accentText = accentFor(roles.ground.hex, 4);
        // Dark templates paint the same "ink" ground, but plenty of packs set
        // ink to white, so the scrim follows the darkest brand role instead of
        // assuming ink is dark.
        const scrim = [roles.ink.hex, roles.ground.hex, roles.accent.hex, '#0b0b0b']
            .map((hex) => normalizeHex(hex) || '#0b0b0b')
            .sort((a, b) => luminance(a) - luminance(b))[0];
        return {
            brand,
            template,
            roles,
            accentText,
            accentFor,
            muted: (colorHex, bgHex = roles.ground.hex) => mutedOpacity(bgHex, colorHex),
            scrim,
            onDark: [roles.accent.hex, '#ffffff', '#0b0b0b']
                .find((hex) => contrastRatio(hex, scrim) >= 4.5
                    && contrastRatio(hex, blendHex('#8a8a8a', scrim, 0.62)) >= 4.5)
                || '#ffffff',
            // Palette colours are tried first: a swap to pure black passes the
            // contrast guardrail but fails the off-palette one.
            contrastCandidates: {
                palette: [...new Set((brand.palette || [])
                    .map((entry) => normalizeHex(entry.hex))
                    .filter(Boolean))],
                fallback: [roles.ink.hex, roles.ground.hex, roles.accent.hex, '#ffffff', '#0b0b0b', '#000000'],
            },
            lines: displayLines(brand),
            fonts: {
                display: fontFor(brand, 'display'),
                title: fontFor(brand, 'title'),
                heading: fontFor(brand, 'heading'),
                body: fontFor(brand, 'body'),
                label: fontFor(brand, 'label'),
            },
            logo: logoFor(brand, roles.ground.hex, 'wordmark') || logoFor(brand, roles.ground.hex, 'logo'),
            logoMark: logoFor(brand, roles.ground.hex, 'mark') || logoFor(brand, roles.ground.hex, 'logo'),
            logoLight: logoFor(brand, '#111111', 'wordmark') || logoFor(brand, '#111111', 'logo'),
            photo: photoFor(brand),
            contact,
            website: websiteLabel(brand, contact),
        };
    }

    function solidUrl(hex) {
        const fill = normalizeHex(hex) || '#000000';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none"><rect width="1" height="1" fill="${fill}"/></svg>`;
        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    /**
     * Type is never the thing that bleeds. Photos, grounds and rules may run to
     * the trim, but a text box that crosses the safe margin is a trim risk on
     * print and a cut-off on screen, so its box is pulled back inside.
     */
    // Mirrors studio-core's per-channel safe zones: a story loses the bottom
    // 16% to the platform's UI, so type laid out to the print margin clips there.
    const CHANNEL_SAFE_ZONES = {
        social: { top: 12, right: 6, bottom: 16, left: 6 },
        display: { top: 5, right: 5, bottom: 5, left: 5 },
        video: { top: 10, right: 6, bottom: 10, left: 6 },
        instore: { top: 8, right: 8, bottom: 8, left: 8 },
        print: { top: 8, right: 8, bottom: 8, left: 8 },
    };
    // The studio's own guardrail holds every channel to an 8% trim margin, so a
    // channel that nominally allows less padding still has to clear 8% or the
    // published card opens with a guardrail warning.
    const TRIM_MARGIN = 8;
    function safeZoneForChannel(channel) {
        const zone = CHANNEL_SAFE_ZONES[channel] || CHANNEL_SAFE_ZONES.print;
        const atLeast = (value) => Math.max(TRIM_MARGIN, value);
        return {
            top: atLeast(zone.top),
            right: atLeast(zone.right),
            bottom: atLeast(zone.bottom),
            left: atLeast(zone.left),
        };
    }
    function fitTextToSafeArea(layer, zone) {
        if (!layer || layer.type !== 'text') return layer;
        const z = zone || safeZoneForChannel();
        const spanW = 100 - z.left - z.right;
        const spanH = 100 - z.top - z.bottom;
        const w = round2(clamp(finite(layer.w, spanW), 1, spanW));
        const h = round2(clamp(finite(layer.h, spanH), 1, spanH));
        layer.w = w;
        layer.h = h;
        layer.x = round2(clamp(finite(layer.x, z.left), z.left, Math.max(z.left, 100 - z.right - w)));
        layer.y = round2(clamp(finite(layer.y, z.top), z.top, Math.max(z.top, 100 - z.bottom - h)));
        if (Array.isArray(layer.keyframes)) {
            layer.keyframes.forEach((frame) => {
                const fw = round2(clamp(finite(frame.w, w), 1, spanW));
                const fh = round2(clamp(finite(frame.h, h), 1, spanH));
                frame.w = fw;
                frame.h = fh;
                frame.x = round2(clamp(finite(frame.x, layer.x), z.left, Math.max(z.left, 100 - z.right - fw)));
                frame.y = round2(clamp(finite(frame.y, layer.y), z.top, Math.max(z.top, 100 - z.bottom - fh)));
            });
        }
        return layer;
    }

    const TEXT_SAMPLES = [0.15, 0.5, 0.85];

    // Average advance of the stand-in families, in em. Deliberately a little
    // wide: the studio measures the real wrapped range, and a box that is too
    // tall costs nothing while a box that is too short clips the copy.
    const AVERAGE_ADVANCE = 0.56;
    function advanceEm(layer) {
        const font = layer.font || {};
        const family = String(font.family || '');
        let em = AVERAGE_ADVANCE;
        if (/condensed|narrow/i.test(family)) em -= 0.08;
        if (/serif|georgia|times|playfair|garamond|baskerville|didot|caslon/i.test(family)) em += 0.03;
        if (Number(font.weight) >= 700) em += 0.035;
        if (font.transform === 'uppercase') em += 0.08;
        return em + (Number(font.letterSpacingEm) || 0);
    }
    /**
     * Wrapped height of a text layer as a percentage of the canvas height, the
     * same unit the studio lays type out in (`sizePct` of height at `lineHeight`).
     */
    function estimateTextHeight(layer, format) {
        const sizePct = Number(layer.font?.sizePct) || 2;
        const lineHeight = Number(layer.font?.lineHeight) || 1.2;
        const fontSize = (sizePct / 100) * (format.height || 1000);
        const charWidth = Math.max(0.5, fontSize * advanceEm(layer));
        const boxWidth = ((Number(layer.w) || 100) / 100) * (format.width || 1000);
        const words = String(layer.text ?? '').split(/\s+/).filter(Boolean);
        let lines = 1;
        let line = 0;
        words.forEach((word, index) => {
            const wordWidth = word.length * charWidth;
            const next = index === 0 ? wordWidth : line + charWidth + wordWidth;
            if (next <= boxWidth) line = next;
            else if (index === 0) line = wordWidth;
            else { lines += 1; line = wordWidth; }
            while (line > boxWidth) { lines += 1; line -= boxWidth; }
        });
        return (lines * fontSize * lineHeight * 1.06) / (format.height || 1000) * 100;
    }
    const MIN_SIZE_PCT = 0.9;
    /**
     * A box only overflows because the copy is longer than the shape could hold.
     * Grow the box into the free space below it first, then reduce the type — so
     * a short headline keeps its size and a long one stops clipping.
     */
    function fitTextHeightBox(layer, format, layers, zone) {
        if (!layer || layer.type !== 'text') return layer;
        const floor = 100 - (zone || safeZoneForChannel()).bottom;
        const needed = estimateTextHeight(layer, format);
        if (needed <= layer.h) return layer;
        const blockers = layers.filter((other) => other !== layer
            && other.type !== 'image'
            && !other.hidden
            && other.y > layer.y + 0.5
            && other.x < layer.x + layer.w
            && other.x + other.w > layer.x);
        const limit = (blockers.length ? Math.min(...blockers.map((other) => other.y)) : floor) - 1.2;
        const roomBelow = Math.max(layer.h, limit - layer.y);
        const maxHeight = round2(Math.min(roomBelow, floor - layer.y));
        if (maxHeight > layer.h) {
            const grown = round2(Math.min(maxHeight, needed + 0.8));
            if (grown > layer.h) layer.h = grown;
        }
        for (let step = 0; step < 14; step += 1) {
            if (estimateTextHeight(layer, format) <= layer.h) return layer;
            const next = round2(Math.max(MIN_SIZE_PCT, (Number(layer.font.sizePct) || 2) * 0.94));
            if (next === layer.font.sizePct) break;
            layer.font.sizePct = next;
        }
        if (estimateTextHeight(layer, format) <= layer.h) return layer;
        // Nothing left to give: let the box take the height it needs, still
        // inside the safe margin.
        layer.h = round2(Math.min(floor - layer.y, Math.max(layer.h, estimateTextHeight(layer, format) + 0.4)));
        return layer;
    }
    /**
     * A layer's keyframes set the box height at run time, so a keyframe shorter
     * than the fitted box silently re-introduces the clip the fit just removed.
     */
    function fitTextHeight(layer, format, layers, zone) {
        const fitted = fitTextHeightBox(layer, format, layers, zone);
        if (!fitted || fitted.type !== 'text' || !Array.isArray(fitted.keyframes)) return fitted;
        const z = zone || safeZoneForChannel();
        fitted.keyframes.forEach((frame) => {
            if (frame.h === undefined || Number(frame.h) >= fitted.h) return;
            frame.h = fitted.h;
            frame.y = round2(clamp(finite(frame.y, fitted.y), z.top, Math.max(z.top, 100 - z.bottom - fitted.h)));
        });
        return fitted;
    }
    function blendHex(bgHex, colorHex, alpha) {
        const bg = hexToRgb(bgHex);
        const fg = hexToRgb(colorHex);
        return `#${['r', 'g', 'b']
            .map((key) => Math.round(clamp(bg[key] + (fg[key] - bg[key]) * clamp(alpha, 0, 1), 0, 255))
                .toString(16).padStart(2, '0')).join('')}`;
    }
    function solidFillOf(layer) {
        const url = typeof layer?.url === 'string' ? layer.url : '';
        if (!url.startsWith('data:image/svg+xml')) return null;
        const match = /fill="([^"]+)"/.exec(decodeURIComponent(url));
        return match ? normalizeHex(match[1]) : null;
    }
    /** The painted background under a point, or null when a photograph is in the way. */
    function backgroundAt(layers, layer, px, py, photoStandIn = '#8a8a8a') {
        let bg = '#ffffff';
        for (const other of layers) {
            if (other.type !== 'image' || other.z >= layer.z) continue;
            if (px < other.x - 0.01 || px > other.x + other.w + 0.01) continue;
            if (py < other.y - 0.01 || py > other.y + other.h + 0.01) continue;
            // A photograph is sampled at render time, so both a light and a dark
            // stand-in are scored: whatever the picture turns out to be, the text
            // has to read on it.
            const fill = solidFillOf(other) || photoStandIn;
            bg = blendHex(bg, fill, other.opacity ?? 1);
        }
        return bg;
    }
    // The studio scores the real pixels behind the text; the estimate here has to
    // land above the bar, not on it, or rounding puts it a tenth under.
    const CONTRAST_HEADROOM = 0.15;
    // Share of a text box a paint has to cover before it counts as the ground.
    const PAINT_COVERAGE = 0.25;
    const PHOTO_STAND_INS = ['#e4e4e4', '#8a8a8a', '#3a3a3a'];
    /**
     * The studio blocks on a contrast guardrail, so every text layer has to pass
     * it before it is published. Where a build function's chosen colour or fade
     * sits under AA on the painted ground, the fade is lifted first and the
     * colour swapped only as a last resort — to a palette colour before a
     * neutral, so the off-palette guardrail stays clear too.
     */
    function enforceTextContrast(layers, candidates, format) {
        const palette = Array.isArray(candidates) ? candidates : (candidates?.palette || []);
        const fallback = Array.isArray(candidates) ? candidates : (candidates?.fallback || []);
        const paints = layers.filter((layer) => layer.type === 'image');
        layers.forEach((layer) => {
            if (layer.type !== 'text') return;
            const against = paints.filter((paint) => paint.z < layer.z);
            if (!against.length) return;
            // Type sits centred in its box, so the studio measures contrast over
            // the wrapped glyphs, not over the empty padding. Sample the same
            // band here: sampling the whole box lets a hairline rule or a photo
            // edge below the last line force an unnecessary colour swap.
            const text = format ? Math.min(layer.h, estimateTextHeight(layer, format)) : layer.h;
            const top = layer.y + Math.max(0, (layer.h - text) / 2);
            const area = layer.w * layer.h;
            // A hairline rule or a thin band crossing the type is decoration, not
            // the ground the eye reads against. Ignore paints that cover only a
            // fraction of the box, or every rule below a headline forces a swap.
            const groundPaints = against.filter((paint) => {
                const overlap = Math.max(0, Math.min(paint.x + paint.w, layer.x + layer.w) - Math.max(paint.x, layer.x))
                    * Math.max(0, Math.min(paint.y + paint.h, layer.y + layer.h) - Math.max(paint.y, layer.y));
                return area > 0 && overlap / area >= PAINT_COVERAGE;
            });
            const backgrounds = [];
            for (const fx of TEXT_SAMPLES) {
                for (const fy of TEXT_SAMPLES) {
                    for (const standIn of PHOTO_STAND_INS) {
                        backgrounds.push(backgroundAt(groundPaints, layer, layer.x + layer.w * fx, top + text * fy, standIn));
                    }
                }
            }
            const threshold = ((layer.font?.sizePct ?? 2) >= 2.2 ? 3 : 4.5) + CONTRAST_HEADROOM;
            const score = (color, alpha) => backgrounds
                .reduce((worst, bg) => Math.min(worst, contrastRatio(blendHex(bg, color, alpha), bg)), Infinity);
            const color = normalizeHex(layer.color) || '#000000';
            let alpha = layer.opacity ?? 1;
            if (score(color, alpha) >= threshold) return;
            const lifted = Math.min(1, Math.ceil((alpha + 0.05) * 100) / 100);
            for (let step = lifted; step <= 1.0001; step += 0.02) {
                let value = Math.round(Math.min(1, step) * 100) / 100;
                if (score(color, value) >= threshold) { layer.opacity = value; return; }
            }
            const best = (list) => list
                .filter((hex) => hex)
                .sort((a, b) => score(b, 1) - score(a, 1))
                .find((hex) => score(hex, 1) >= threshold);
            const swapped = best(palette) || best(fallback);
            if (swapped) {
                layer.color = swapped;
                layer.opacity = 1;
                return;
            }
            layer.opacity = 1;
        });
        return layers;
    }

    let layerCounter = 0;
    function layerId(name) {
        layerCounter += 1;
        return `${name}-${layerCounter.toString(36)}`;
    }

    /**
     * The studio's keyframe schema animates x/y/w/h/rotation/opacity only.
     * Templates use slow, loop-safe motion (the first and last frame match), so
     * a card, a GIF and an MP4 all read as the same design.
     */
    function animate(layer, frames) {
        if (!layer || !Array.isArray(frames) || !frames.length) return layer;
        layer.keyframes = frames.map((frame) => ({
            time: Math.round(clamp(finite(frame.time, 0), 0, 30000)),
            x: round2(clamp(finite(frame.x, layer.x), -100, 200)),
            y: round2(clamp(finite(frame.y, layer.y), -100, 200)),
            w: round2(clamp(finite(frame.w, layer.w), 1, 300)),
            h: round2(clamp(finite(frame.h, layer.h), 1, 300)),
            rotation: round2(clamp(finite(frame.rotation, layer.rotation || 0), -180, 180)),
            opacity: round2(clamp(finite(frame.opacity, layer.opacity ?? 1), 0, 1)),
            easing: typeof frame.easing === 'string' && frame.easing ? frame.easing : 'easeInOutSine',
        }));
        return layer;
    }

    function imageLayer(spec) {
        const url = normalizeAssetUrl(spec.url) || solidUrl(spec.color || '#000000');
        return {
            id: spec.id || layerId('img'),
            type: 'image',
            name: spec.name || 'Image',
            role: spec.role || 'background',
            url,
            frames: [url],
            spriteFps: 1,
            spriteMode: 'once',
            fit: spec.fit === 'contain' ? 'contain' : 'cover',
            x: round2(clamp(finite(spec.x, 0), -100, 200)),
            y: round2(clamp(finite(spec.y, 0), -100, 200)),
            w: round2(clamp(finite(spec.w, 100), 1, 300)),
            h: round2(clamp(finite(spec.h, 100), 1, 300)),
            opacity: round2(clamp(finite(spec.opacity, 1), 0, 1)),
            rotation: 0,
            z: Math.round(finite(spec.z, 1)),
            visible: true,
            locked: false,
            positionConfirmed: true,
            bleed: spec.bleed === true,
            keyframes: [],
        };
    }

    function textLayer(spec) {
        const font = {
            family: spec.family || 'Inter',
            weight: Number.isFinite(Number(spec.weight)) ? Number(spec.weight) : weightFromFamily(spec.family),
            style: spec.style || 'normal',
            sizePct: round2(clamp(finite(spec.sizePct, 3), 0.5, 30)),
            lineHeight: round2(clamp(finite(spec.lineHeight, 1.2), 0.8, 3)),
            letterSpacingEm: round2(clamp(finite(spec.letterSpacingEm, 0), -0.1, 0.5)),
            transform: ['none', 'uppercase', 'lowercase', 'capitalize'].includes(spec.transform)
                ? spec.transform
                : 'none',
        };
        return {
            id: spec.id || layerId('text'),
            type: 'text',
            name: spec.name || 'Text',
            role: spec.role || 'foreground',
            text: text(spec.text, 4000),
            font,
            color: normalizeHex(spec.color) || '#111111',
            align: ['left', 'center', 'right'].includes(spec.align) ? spec.align : 'left',
            verticalAlign: ['top', 'middle', 'bottom'].includes(spec.verticalAlign) ? spec.verticalAlign : 'middle',
            overflow: 'clip',
            x: round2(clamp(finite(spec.x, 8), -100, 200)),
            y: round2(clamp(finite(spec.y, 8), -100, 200)),
            w: round2(clamp(finite(spec.w, 84), 1, 300)),
            h: round2(clamp(finite(spec.h, 6), 1, 300)),
            opacity: round2(clamp(finite(spec.opacity, 1), 0, 1)),
            rotation: 0,
            z: Math.round(finite(spec.z, 60)),
            visible: true,
            locked: false,
            positionConfirmed: true,
            bindings: spec.binding ? { text: spec.binding } : {},
            keyframes: [],
        };
    }

    function variable(def) {
        return {
            id: def.id,
            name: def.name || titleCase(def.id),
            kind: 'text',
            defaultValue: text(def.value, 4000),
            locked: false,
        };
    }

    function menuItems(brand) {
        const name = String(brand?.name || '').toLowerCase();
        // A pack that carries a real menu uses it. The layout takes five
        // entries, so flatten the sections in reading order and stop at five;
        // prices and descriptions travel with the dish they belong to.
        const sections = brand?.content?.menu?.sections || [];
        const fromContent = [];
        sections.forEach((section) => {
            (section.items || []).forEach((item) => {
                if (fromContent.length >= 5 || !item?.name) return;
                fromContent.push([item.name, item.description || '', item.price || '']);
            });
        });
        if (fromContent.length >= 3) {
            return fromContent.slice(0, 5);
        }
        if (/hatch/.test(name)) {
            return [
                ['Buttermilk pancakes', 'Blueberry compote, maple butter', '£11'],
                ['Smashed avocado', 'Sourdough, poached egg, chilli', '£12'],
                ['The full Hatch', 'Bacon, egg, sausage, tomato, toast', '£15'],
                ['Halloumi flatbread', 'Pickled slaw, harissa yoghurt', '£13'],
                ['Flat white', 'Hatch house blend', '£3.60'],
            ];
        }
        if (/physician/.test(name)) {
            return [
                ['Oysters, shallot vinegar', 'Six, shucked to order', '£18'],
                ['Cured salmon, dill oil', 'Rye, pickled cucumber', '£12'],
                ['Dry-aged beef, bone marrow', 'Charcoal-grilled, watercress', '£34'],
                ['Wild mushroom tart', 'Truffle, aged parmesan', '£22'],
                ['Negroni', 'Gin, vermouth, bitter orange', '£11'],
            ];
        }
        return [
            ['Hand-dived scallops', 'Brown butter, lemon, sea herbs', '£14'],
            ['Cured salmon', 'Rye, pickled cucumber, dill oil', '£12'],
            ['Dry-aged beef', 'Charcoal-grilled, bone marrow', '£34'],
            ['Seasonal vegetables', 'Herb oil, toasted seeds', '£9'],
            ['Dark chocolate delice', 'Salted caramel, crème fraîche', '£10'],
        ];
    }

    function buildMenu(ctx) {
        const { roles, accentText, fonts, brand, logo, contact, website, muted } = ctx;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'menu-ground', name: 'Menu ground', color: roles.ground.hex, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(imageLayer({ id: 'menu-rule-top', name: 'Top rule', color: roles.accent.hex, x: 9, y: 7.2, w: 82, h: 0.16, z: 2, bleed: true }));
        if (logo) {
            layers.push(imageLayer({
                id: 'menu-logo', name: 'Menu logo', url: logo.url, fit: 'contain',
                x: 39, y: 8.4, w: 22, h: 6.4, z: 6, bleed: true,
            }));
        }
        const menuCopy = brand?.content?.copy?.menu || {};
        layers.push(textLayer({
            id: 'menu-kicker', name: 'Menu kicker', text: menuCopy.kicker || 'Menu',
            family: fonts.label, weight: 400, sizePct: 1.65, letterSpacingEm: 0.24,
            transform: 'uppercase', color: accentText, align: 'center',
            x: 9, y: 15.6, w: 82, h: 3.2, z: 10,
        }));
        variables.push(variable({ id: 'menu_title', name: 'Menu title', value: menuCopy.title || `${brand.name} menu` }));
        layers.push(textLayer({
            id: 'menu-title', name: 'Menu title', binding: 'menu_title',
            text: menuCopy.title || `${brand.name} menu`, family: fonts.title, weight: 300,
            sizePct: 4.4, lineHeight: 1.05, color: roles.ink.hex, align: 'center',
            x: 9, y: 19, w: 82, h: 7.4, z: 11,
        }));
        layers.push(imageLayer({ id: 'menu-rule-mid', name: 'Divider', color: roles.accent.hex, x: 31, y: 27.2, w: 38, h: 0.14, z: 10, bleed: true }));
        const items = menuItems(brand);
        items.forEach((item, index) => {
            const number = index + 1;
            const baseY = 31 + index * 11.2;
            variables.push(variable({ id: `item_${number}_name`, name: `Item ${number} — name`, value: item[0] }));
            variables.push(variable({ id: `item_${number}_desc`, name: `Item ${number} — description`, value: item[1] }));
            variables.push(variable({ id: `item_${number}_price`, name: `Item ${number} — price`, value: item[2] }));
            layers.push(textLayer({
                id: `menu-item-${number}-name`, name: `Item ${number} name`, binding: `item_${number}_name`,
                text: item[0], family: fonts.heading, weight: 400, sizePct: 1.85,
                letterSpacingEm: 0.02, color: roles.ink.hex, align: 'left',
                x: 9, y: baseY, w: 64, h: 3.4, z: 20,
            }));
            layers.push(textLayer({
                id: `menu-item-${number}-price`, name: `Item ${number} price`, binding: `item_${number}_price`,
                text: item[2], family: fonts.body, weight: 400, sizePct: 1.85,
                color: accentText, align: 'right',
                x: 75, y: baseY, w: 16, h: 3.4, z: 20,
            }));
            layers.push(textLayer({
                id: `menu-item-${number}-desc`, name: `Item ${number} description`, binding: `item_${number}_desc`,
                text: item[1], family: fonts.body, weight: 300, sizePct: 1.25,
                lineHeight: 1.35, color: roles.ink.hex, opacity: 0.72, align: 'left',
                x: 9, y: baseY + 3.5, w: 72, h: 4.2, z: 20,
            }));
        });
        const footer = [contact.address, website].filter(Boolean).join('  ·  ');
        variables.push(variable({
            id: 'menu_footer', name: 'Menu footer',
            value: footer || [brand.name, brand.tagline].filter(Boolean).join(' · '),
        }));
        layers.push(textLayer({
            id: 'menu-footer', name: 'Menu footer', binding: 'menu_footer',
            text: footer || brand.name, family: fonts.label, weight: 400, sizePct: 1.05,
            letterSpacingEm: 0.06, color: roles.ink.hex, opacity: muted(roles.ink.hex),
            align: 'center', x: 9, y: 88.4, w: 82, h: 2.6, z: 12,
        }));
        return { layers, variables };
    }

    function buildBusinessCardFront(ctx) {
        const { roles, fonts, brand, logo, logoMark, lines, muted } = ctx;
        const mark = logoMark || logo;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'card-front-ground', name: 'Card ground', color: roles.ground.hex, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        if (mark) {
            layers.push(imageLayer({
                id: 'card-front-logo', name: 'Card logo', url: mark.url, fit: 'contain',
                x: 22, y: 18, w: 56, h: 26, z: 6, bleed: true,
            }));
        } else {
            layers.push(textLayer({
                id: 'card-front-wordmark', name: 'Wordmark', text: brand.wordmark || brand.name,
                family: fonts.title, weight: 300, sizePct: 9, color: roles.ink.hex, align: 'center',
                x: 16, y: 20, w: 68, h: 22, z: 6,
            }));
        }
        variables.push(variable({ id: 'card_tagline', name: 'Tagline', value: lines.subhead }));
        layers.push(textLayer({
            id: 'card-front-tagline', name: 'Tagline', binding: 'card_tagline',
            text: lines.subhead, family: fonts.label,
            weight: 400, sizePct: 2.5, letterSpacingEm: 0.12, transform: 'uppercase',
            color: roles.ink.hex, opacity: 0.86, align: 'center',
            x: 10, y: 55, w: 80, h: 6, z: 10,
        }));
        layers.push(imageLayer({ id: 'card-front-rule', name: 'Rule', color: roles.accent.hex, x: 9, y: 66.5, w: 82, h: 0.45, z: 8, bleed: true }));
        variables.push(variable({ id: 'card_website', name: 'Website', value: ctx.website || 'www.example.com' }));
        layers.push(textLayer({
            id: 'card-front-website', name: 'Website', binding: 'card_website',
            text: ctx.website || 'www.example.com', family: fonts.label, weight: 400, sizePct: 2.1,
            letterSpacingEm: 0.1, color: roles.ink.hex, opacity: 0.7, align: 'center',
            x: 10, y: 77, w: 80, h: 5, z: 10,
        }));
        return { layers, variables };
    }

    function buildBusinessCardBack(ctx) {
        const { roles, accentText, fonts, brand, logoMark, contact, website, lines, muted } = ctx;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'card-back-ground', name: 'Card ground', color: roles.ground.hex, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        if (logoMark) {
            layers.push(imageLayer({
                id: 'card-back-logo', name: 'Card mark', url: logoMark.url, fit: 'contain',
                x: 74, y: 10, w: 18, h: 12, z: 6, bleed: true,
            }));
        }
        const card = brand?.content?.copy?.card || {};
        const cardName = card.name || 'Your name';
        const cardRole = card.role || 'Your role';
        variables.push(variable({ id: 'card_name', name: 'Full name', value: cardName }));
        layers.push(textLayer({
            id: 'card-back-name', name: 'Name', binding: 'card_name', text: cardName,
            family: fonts.title, weight: 300, sizePct: 6.2, lineHeight: 1.05,
            color: roles.ink.hex, align: 'left', x: 8, y: 11, w: 60, h: 12, z: 10,
        }));
        variables.push(variable({ id: 'card_role', name: 'Role', value: cardRole }));
        layers.push(textLayer({
            id: 'card-back-role', name: 'Role', binding: 'card_role', text: cardRole,
            family: fonts.label, weight: 400, sizePct: 2.3, letterSpacingEm: 0.12,
            transform: 'uppercase', color: accentText, align: 'left',
            x: 8, y: 24, w: 60, h: 5, z: 10,
        }));
        const rows = [
            ['card_phone', 'Phone', contact.phone],
            ['card_email', 'Email', contact.email],
            ['card_address', 'Address', contact.address],
            ['card_site', 'Website', website || brand.url],
            ['card_social', 'Social', contact.instagram],
        ].filter((row) => row[2]);
        rows.forEach((row, index) => {
            variables.push(variable({ id: row[0], name: row[1], value: row[2] }));
            layers.push(textLayer({
                id: `card-back-${row[0]}`, name: row[1], binding: row[0], text: row[2],
                family: fonts.body, weight: 400, sizePct: 2.15, lineHeight: 1.3,
                color: roles.ink.hex, align: 'left',
                x: 8, y: 39 + index * 8.4, w: 68, h: 6.2, z: 10,
            }));
        });
        return { layers, variables };
    }

    function buildFlyer(ctx) {
        const { roles, accentText, fonts, brand, logo, logoLight, photo, contact, website, lines, muted } = ctx;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'flyer-ground', name: 'Flyer ground', color: roles.ground.hex, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        if (photo) {
            layers.push(imageLayer({
                id: 'flyer-photo', name: 'Hero photograph', url: photo.url, fit: 'cover',
                x: 0, y: 0, w: 100, h: 48, z: 2, bleed: true,
            }));
        }
        const onPhotoLogo = photo ? (logoLight || logo) : logo;
        if (onPhotoLogo) {
            layers.push(imageLayer({
                id: 'flyer-logo', name: 'Flyer logo', url: onPhotoLogo.url, fit: 'contain',
                x: 37, y: 6, w: 26, h: 9, z: 8, bleed: true,
            }));
        }
        variables.push(variable({ id: 'flyer_headline', name: 'Headline', value: lines.headline }));
        layers.push(textLayer({
            id: 'flyer-headline', name: 'Headline', binding: 'flyer_headline',
            text: lines.headline, family: fonts.title, weight: 300,
            sizePct: 6.2, lineHeight: 1.02, color: roles.ink.hex, align: 'left',
            x: 8, y: 53, w: 84, h: 16, z: 12,
        }));
        variables.push(variable({ id: 'flyer_subhead', name: 'Sub-headline', value: lines.subhead }));
        layers.push(textLayer({
            id: 'flyer-subhead', name: 'Sub-headline', binding: 'flyer_subhead',
            text: lines.subhead, family: fonts.heading,
            weight: 400, sizePct: 2.4, letterSpacingEm: 0.06, color: accentText,
            align: 'left', x: 8, y: 69.5, w: 84, h: 5.5, z: 12,
        }));
        variables.push(variable({
            id: 'flyer_body', name: 'Body copy',
            value: lines.body,
        }));
        layers.push(textLayer({
            id: 'flyer-body', name: 'Body copy', binding: 'flyer_body',
            text: lines.body,
            family: fonts.body, weight: 300, sizePct: 1.6, lineHeight: 1.45,
            color: roles.ink.hex, opacity: muted(roles.ink.hex), align: 'left',
            x: 8, y: 76, w: 84, h: 8.5, z: 12,
        }));
        const flyerCta = brand?.content?.copy?.cta || 'Find out more';
        variables.push(variable({ id: 'flyer_cta', name: 'Call to action', value: flyerCta }));
        layers.push(textLayer({
            id: 'flyer-cta', name: 'Call to action', binding: 'flyer_cta', text: flyerCta,
            family: fonts.label, weight: 400, sizePct: 1.7, letterSpacingEm: 0.18,
            transform: 'uppercase', color: accentText, align: 'left',
            x: 8, y: 85.4, w: 84, h: 3.1, z: 12,
        }));
        variables.push(variable({
            id: 'flyer_footer', name: 'Footer',
            value: [contact.address, website].filter(Boolean).join('  ·  ') || brand.name,
        }));
        layers.push(textLayer({
            id: 'flyer-footer', name: 'Footer', binding: 'flyer_footer',
            text: [contact.address, website].filter(Boolean).join('  ·  ') || brand.name,
            family: fonts.label, weight: 400, sizePct: 1.05, letterSpacingEm: 0.05,
            color: roles.ink.hex, opacity: muted(roles.ink.hex), align: 'left',
            x: 8, y: 89.2, w: 84, h: 2.2, z: 12,
        }));
        return { layers, variables };
    }

    function buildTableCard(ctx) {
        const { roles, accentText, fonts, brand, logo, logoMark, muted } = ctx;
        const special = brand?.content?.copy?.special || {};
        const kicker = special.kicker || "Chef's special";
        const dish = special.dish || 'Dry-aged beef, bone marrow';
        const description = special.description || 'Charcoal-grilled, watercress, roast shallot and a red wine jus.';
        const price = special.price || '£34';
        const note = special.note || 'Ask the team about allergens. Available while the kitchen is open.';
        const layers = [];
        const variables = [];
        const mark = logoMark || logo;
        layers.push(imageLayer({ id: 'table-ground', name: 'Card ground', color: roles.ground.hex, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(imageLayer({ id: 'table-rule-top', name: 'Top rule', color: roles.accent.hex, x: 10, y: 8, w: 80, h: 0.5, z: 2, bleed: true }));
        if (mark) {
            layers.push(imageLayer({
                id: 'table-logo', name: 'Venue mark', url: mark.url, fit: 'contain',
                x: 34, y: 11, w: 32, h: 11, z: 6, bleed: true,
            }));
        }
        variables.push(variable({ id: 'table_kicker', name: 'Kicker', value: kicker }));
        layers.push(textLayer({
            id: 'table-kicker', name: 'Kicker', binding: 'table_kicker', text: kicker,
            family: fonts.label, weight: 400, sizePct: 1.9, letterSpacingEm: 0.2,
            transform: 'uppercase', color: accentText, align: 'center',
            x: 10, y: 27, w: 80, h: 4, z: 10,
        }));
        variables.push(variable({ id: 'table_dish', name: 'Dish', value: dish }));
        layers.push(textLayer({
            id: 'table-dish', name: 'Dish', binding: 'table_dish', text: dish,
            family: fonts.title, weight: 300, sizePct: 4.6, lineHeight: 1.08,
            color: roles.ink.hex, align: 'center', x: 9, y: 33, w: 82, h: 13, z: 10,
        }));
        variables.push(variable({
            id: 'table_description', name: 'Description',
            value: description,
        }));
        layers.push(textLayer({
            id: 'table-description', name: 'Description', binding: 'table_description',
            text: description,
            family: fonts.body, weight: 300, sizePct: 1.8, lineHeight: 1.4,
            color: roles.ink.hex, opacity: 0.76, align: 'center',
            x: 12, y: 48, w: 76, h: 15, z: 10,
        }));
        variables.push(variable({ id: 'table_price', name: 'Price', value: price }));
        layers.push(textLayer({
            id: 'table-price', name: 'Price', binding: 'table_price', text: price,
            family: fonts.title, weight: 300, sizePct: 3.8, color: accentText,
            align: 'center', x: 10, y: 66, w: 80, h: 8, z: 10,
        }));
        variables.push(variable({
            id: 'table_allergens', name: 'Allergens / note',
            value: note,
        }));
        layers.push(textLayer({
            id: 'table-allergens', name: 'Allergens / note', binding: 'table_allergens',
            text: note,
            family: fonts.body, weight: 300, sizePct: 1.25, lineHeight: 1.4,
            color: roles.ink.hex, opacity: muted(roles.ink.hex), align: 'center',
            x: 12, y: 85, w: 76, h: 5, z: 10,
        }));
        return { layers, variables };
    }

    function buildVoucher(ctx) {
        const { roles, fonts, brand, logo, contact, website, muted } = ctx;
        const voucher = brand?.content?.copy?.voucher || {};
        const group = (brand?.guidelines?.facts || [])
            .find((entry) => /^group$/i.test(String(entry.field || '')))?.value || '';
        const redeemable = group && group.toLowerCase() !== String(brand.name || '').toLowerCase()
            ? `any ${group} venue`
            : String(brand.name || 'this venue');
        const title = voucher.title || 'Gift voucher';
        const value = voucher.value || '£50';
        const terms = voucher.terms
            || `Redeemable at ${redeemable}. Valid for 12 months from purchase. One voucher per booking, not exchangeable for cash.`;
        const layers = [];
        const variables = [];
        const site = website || brand.url;
        layers.push(imageLayer({ id: 'voucher-ground', name: 'Voucher ground', color: roles.ground.hex, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        if (logo) {
            layers.push(imageLayer({
                id: 'voucher-logo', name: 'Voucher logo', url: logo.url, fit: 'contain',
                x: 8, y: 10, w: 26, h: 15, z: 6, bleed: true,
            }));
        }
        variables.push(variable({ id: 'voucher_title', name: 'Voucher title', value: title }));
        layers.push(textLayer({
            id: 'voucher-title', name: 'Voucher title', binding: 'voucher_title', text: title,
            family: fonts.label, weight: 400, sizePct: 2.1, letterSpacingEm: 0.18,
            transform: 'uppercase', color: roles.ink.hex, opacity: 0.86, align: 'left',
            x: 8, y: 30, w: 56, h: 5, z: 10,
        }));
        variables.push(variable({ id: 'voucher_value', name: 'Value', value }));
        layers.push(textLayer({
            id: 'voucher-value', name: 'Value', binding: 'voucher_value', text: value,
            family: fonts.title, weight: 300, sizePct: 8.4, lineHeight: 1,
            color: roles.ink.hex, align: 'left', x: 8, y: 36, w: 56, h: 16, z: 10,
        }));
        variables.push(variable({
            id: 'voucher_terms', name: 'Terms',
            value: terms,
        }));
        layers.push(textLayer({
            id: 'voucher-terms', name: 'Terms', binding: 'voucher_terms',
            text: terms,
            family: fonts.body, weight: 300, sizePct: 1.45, lineHeight: 1.4,
            color: roles.ink.hex, opacity: 0.78, align: 'left',
            x: 8, y: 56, w: 56, h: 18, z: 10,
        }));
        variables.push(variable({ id: 'voucher_code', name: 'Redemption code', value: 'GIFT-0001' }));
        layers.push(imageLayer({ id: 'voucher-panel', name: 'Code panel', color: roles.ink.hex, x: 70, y: 28, w: 22, h: 44, z: 8, bleed: true }));
        // The code reads off the ink panel, so it takes the palette colour with
        // the most contrast there rather than the page ground.
        const panelInk = (ctx.contrastCandidates?.palette || [])
            .slice()
            .sort((a, b) => contrastRatio(b, roles.ink.hex) - contrastRatio(a, roles.ink.hex))[0] || '#ffffff';
        layers.push(textLayer({
            id: 'voucher-code', name: 'Redemption code', binding: 'voucher_code', text: 'GIFT-0001',
            family: fonts.label, weight: 400, sizePct: 2.2, letterSpacingEm: 0.14,
            transform: 'uppercase', color: panelInk, align: 'center',
            x: 71.5, y: 44, w: 19, h: 10, z: 12,
        }));
        variables.push(variable({
            id: 'voucher_footer', name: 'Footer',
            value: [contact.address, site].filter(Boolean).join('  ·  ') || brand.name,
        }));
        layers.push(textLayer({
            id: 'voucher-footer', name: 'Footer', binding: 'voucher_footer',
            text: [contact.address, site].filter(Boolean).join('  ·  ') || brand.name,
            family: fonts.label, weight: 400, sizePct: 1.1, letterSpacingEm: 0.05,
            color: roles.ink.hex, opacity: muted(roles.ink.hex), align: 'left',
            x: 8, y: 84, w: 84, h: 3, z: 10,
        }));
        return { layers, variables };
    }

    function buildSocialPost(ctx) {
        const { roles, accentText, fonts, brand, logo, logoLight, contact, lines, muted } = ctx;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'social-ground', name: 'Post ground', color: roles.ground.hex, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(imageLayer({ id: 'social-rule', name: 'Top rule', color: roles.accent.hex, x: 0, y: 0, w: 100, h: 1.4, z: 2, bleed: true }));
        const mark = logo;
        if (mark) {
            layers.push(imageLayer({
                id: 'social-logo', name: 'Post logo', url: mark.url, fit: 'contain',
                x: 38, y: 14, w: 24, h: 8, z: 6, bleed: true,
            }));
        }
        variables.push(variable({ id: 'social_headline', name: 'Headline', value: lines.headline }));
        layers.push(textLayer({
            id: 'social-headline', name: 'Headline', binding: 'social_headline', text: lines.headline,
            family: fonts.title, weight: 300, sizePct: 8.4, lineHeight: 1.02,
            color: roles.ink.hex, align: 'center', x: 8, y: 30, w: 84, h: 24, z: 10,
        }));
        variables.push(variable({ id: 'social_subhead', name: 'Sub-headline', value: lines.subhead }));
        layers.push(textLayer({
            id: 'social-subhead', name: 'Sub-headline', binding: 'social_subhead',
            text: lines.subhead, family: fonts.label,
            weight: 400, sizePct: 2.4, letterSpacingEm: 0.12, transform: 'uppercase',
            color: accentText, align: 'center', x: 8, y: 56, w: 84, h: 7, z: 10,
        }));
        variables.push(variable({
            id: 'social_footer', name: 'Footer',
            value: [contact.instagram, ctx.website].filter(Boolean).join('  ·  ') || brand.name,
        }));
        layers.push(textLayer({
            id: 'social-footer', name: 'Footer', binding: 'social_footer',
            text: [contact.instagram, ctx.website].filter(Boolean).join('  ·  ') || brand.name,
            family: fonts.body, weight: 300, sizePct: 1.5, color: roles.ink.hex,
            opacity: muted(roles.ink.hex), align: 'center', x: 8, y: 79, w: 84, h: 4.6, z: 10,
        }));
        return { layers, variables };
    }

    // ─── Digital / motion templates ──────────────────────────────────
    // These are normal v3 compositions: keyframes, photos and text are the
    // same objects the editor and the export pipeline already understand.

    function buildSocialStory(ctx) {
        const { roles, accentText, fonts, brand, logoLight, contact, website, lines, muted, scrim, onDark } = ctx;
        const photo = photoFor(brand, 'evening|food|interior|hero|signature') || ctx.photo;
        const on = logoLight || ctx.logo;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'story-ground', name: 'Story ground', color: roles.ground.hex, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        if (photo) {
            layers.push(animate(imageLayer({
                id: 'story-photo', name: 'Story photograph', url: photo.url, fit: 'cover',
                x: -2, y: -2, w: 104, h: 104, z: 1, bleed: true,
            }), [
                { time: 0, x: -2, y: -2, w: 104, h: 104 },
                { time: 3000, x: -6, y: -4, w: 112, h: 112 },
                { time: 6000, x: -2, y: -2, w: 104, h: 104 },
            ]));
        }
        layers.push(imageLayer({
            id: 'story-scrim', name: 'Story scrim', color: scrim,
            x: 0, y: 0, w: 100, h: 100, opacity: 0.56, z: 2, bleed: true,
        }));
        layers.push(animate(imageLayer({
            id: 'story-accent', name: 'Story accent', color: roles.accent.hex,
            x: 8, y: 52.4, w: 18, h: 0.55, z: 3, bleed: true,
        }), [
            { time: 0, x: 8, w: 18 },
            { time: 3000, x: 8, w: 26 },
            { time: 6000, x: 8, w: 18 },
        ]));
        if (on) {
            layers.push(animate(imageLayer({
                id: 'story-logo', name: 'Story logo', url: on.url, fit: 'contain',
                x: 31, y: 13, w: 38, h: 9, z: 6, bleed: true,
            }), [
                { time: 0, y: 13 },
                { time: 3000, y: 14 },
                { time: 6000, y: 13 },
            ]));
        }
        variables.push(variable({ id: 'story_kicker', name: 'Kicker', value: lines.kicker }));
        layers.push(animate(textLayer({
            id: 'story-kicker', name: 'Kicker', binding: 'story_kicker',
            text: lines.kicker, family: fonts.label, weight: 400,
            sizePct: 1.9, letterSpacingEm: 0.22, transform: 'uppercase',
            color: onDark, opacity: 0.9, align: 'left',
            x: 8, y: 55, w: 84, h: 2.6, z: 10,
        }), [
            { time: 0, y: 55 },
            { time: 3000, y: 54.4 },
            { time: 6000, y: 55 },
        ]));
        variables.push(variable({ id: 'story_headline', name: 'Headline', value: lines.headline }));
        layers.push(animate(textLayer({
            id: 'story-headline', name: 'Headline', binding: 'story_headline',
            text: lines.headline, family: fonts.title, weight: 300,
            sizePct: 5.8, lineHeight: 1.02, color: onDark, align: 'left',
            x: 8, y: 58, w: 84, h: 18.5, z: 10,
        }), [
            { time: 0, y: 58 },
            { time: 3000, y: 57.2 },
            { time: 6000, y: 58 },
        ]));
        variables.push(variable({ id: 'story_subhead', name: 'Sub-headline', value: lines.detail }));
        layers.push(animate(textLayer({
            id: 'story-subhead', name: 'Sub-headline', binding: 'story_subhead',
            text: lines.detail,
            family: fonts.body, weight: 300, sizePct: 1.6, lineHeight: 1.35,
            color: onDark, opacity: 0.86, align: 'left',
            x: 8, y: 77.2, w: 84, h: 5.2, z: 10,
        }), [
            { time: 0, y: 77.2 },
            { time: 3000, y: 76.7 },
            { time: 6000, y: 77.2 },
        ]));
        variables.push(variable({
            id: 'story_footer', name: 'Footer',
            value: [contact.instagram, website].filter(Boolean).join('  ·  ') || brand.name,
        }));
        layers.push(textLayer({
            id: 'story-footer', name: 'Footer', binding: 'story_footer',
            text: [contact.instagram, website].filter(Boolean).join('  ·  ') || brand.name,
            family: fonts.label, weight: 400, sizePct: 0.95, letterSpacingEm: 0.06,
            color: '#ffffff', opacity: 0.7, align: 'left',
            x: 8, y: 82.8, w: 84, h: 1.2, z: 10,
        }));
        return { layers, variables };
    }

    function buildSocialReel(ctx) {
        const { roles, accentText, fonts, brand, logoLight, contact, website, lines, muted, scrim, onDark } = ctx;
        const photo = photoFor(brand, 'signage|interior|room|founder|bar') || ctx.photo;
        const on = logoLight || ctx.logo;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'reel-ground', name: 'Reel ground', color: scrim, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        if (photo) {
            layers.push(animate(imageLayer({
                id: 'reel-photo', name: 'Reel photograph', url: photo.url, fit: 'cover',
                x: 0, y: 0, w: 100, h: 100, z: 1, bleed: true,
            }), [
                { time: 0, x: 0, y: 0, w: 100, h: 100 },
                { time: 4000, x: -5, y: -3, w: 110, h: 110 },
                { time: 8000, x: 0, y: 0, w: 100, h: 100 },
            ]));
        }
        layers.push(imageLayer({
            id: 'reel-scrim', name: 'Reel scrim', color: scrim,
            x: 0, y: 0, w: 100, h: 100, opacity: 0.62, z: 2, bleed: true,
        }));
        if (on) {
            layers.push(imageLayer({
                id: 'reel-logo', name: 'Reel logo', url: on.url, fit: 'contain',
                x: 8, y: 12, w: 30, h: 8, z: 6, bleed: true,
            }));
        }
        layers.push(animate(imageLayer({
            id: 'reel-rule', name: 'Reel rule', color: roles.accent.hex,
            x: 8, y: 44, w: 14, h: 0.6, z: 3, bleed: true,
        }), [
            { time: 0, w: 14 },
            { time: 4000, w: 24 },
            { time: 8000, w: 14 },
        ]));
        variables.push(variable({ id: 'reel_kicker', name: 'Kicker', value: lines.kicker }));
        layers.push(textLayer({
            id: 'reel-kicker', name: 'Kicker', binding: 'reel_kicker',
            text: lines.kicker, family: fonts.label, weight: 400,
            sizePct: 1.7, letterSpacingEm: 0.24, transform: 'uppercase',
            color: onDark, align: 'left', x: 8, y: 47, w: 84, h: 2.8, z: 10,
        }));
        variables.push(variable({ id: 'reel_headline', name: 'Headline', value: lines.headline }));
        layers.push(animate(textLayer({
            id: 'reel-headline', name: 'Headline', binding: 'reel_headline',
            text: lines.headline, family: fonts.title, weight: 300,
            sizePct: 6.0, lineHeight: 1.02, color: onDark, align: 'left',
            x: 8, y: 51, w: 84, h: 30, z: 10,
        }), [
            { time: 0, y: 51 },
            { time: 4000, y: 49.8 },
            { time: 8000, y: 51 },
        ]));
        variables.push(variable({ id: 'reel_detail', name: 'Detail', value: lines.detail }));
        layers.push(textLayer({
            id: 'reel-detail', name: 'Detail', binding: 'reel_detail',
            text: lines.detail,
            family: fonts.body, weight: 300, sizePct: 1.7, lineHeight: 1.35,
            color: onDark, opacity: 0.86, align: 'left',
            x: 8, y: 82.2, w: 84, h: 5, z: 10,
        }));
        variables.push(variable({
            id: 'reel_footer', name: 'Footer',
            value: [contact.address, website].filter(Boolean).join('  ·  ') || brand.name,
        }));
        layers.push(textLayer({
            id: 'reel-footer', name: 'Footer', binding: 'reel_footer',
            text: [contact.address, website].filter(Boolean).join('  ·  ') || brand.name,
            family: fonts.label, weight: 400, sizePct: 1.05, letterSpacingEm: 0.05,
            color: onDark, opacity: 0.86, align: 'left',
            x: 8, y: 87.6, w: 84, h: 2.2, z: 10,
        }));
        return { layers, variables };
    }

    function buildSquareLoop(ctx) {
        const { roles, accentText, fonts, brand, logoLight, contact, website, lines, muted, onDark, scrim } = ctx;
        const on = logoLight || ctx.logo;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'loop-ground', name: 'Loop ground', color: scrim, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(animate(imageLayer({
            id: 'loop-bar', name: 'Accent bar', color: roles.accent.hex,
            x: 0, y: 0, w: 2.4, h: 100, z: 1, bleed: true,
        }), [
            { time: 0, w: 2.4 },
            { time: 2500, w: 7 },
            { time: 5000, w: 2.4 },
        ]));
        if (on) {
            layers.push(animate(imageLayer({
                id: 'loop-logo', name: 'Loop logo', url: on.url, fit: 'contain',
                x: 8, y: 16, w: 34, h: 9, z: 6, bleed: true,
            }), [
                { time: 0, x: 8 },
                { time: 2500, x: 10 },
                { time: 5000, x: 8 },
            ]));
        }
        variables.push(variable({ id: 'loop_headline', name: 'Headline', value: lines.headline }));
        layers.push(animate(textLayer({
            id: 'loop-headline', name: 'Headline', binding: 'loop_headline',
            text: lines.headline, family: fonts.title, weight: 300,
            sizePct: 9.2, lineHeight: 1.02, color: onDark, align: 'left',
            x: 8, y: 32, w: 84, h: 22, z: 10,
        }), [
            { time: 0, y: 32 },
            { time: 2500, y: 30.6 },
            { time: 5000, y: 32 },
        ]));
        variables.push(variable({ id: 'loop_subhead', name: 'Sub-headline', value: lines.subhead }));
        layers.push(animate(textLayer({
            id: 'loop-subhead', name: 'Sub-headline', binding: 'loop_subhead',
            text: lines.subhead, family: fonts.label, weight: 400,
            sizePct: 2.1, letterSpacingEm: 0.18, transform: 'uppercase',
            color: onDark, align: 'left', x: 8, y: 57, w: 84, h: 4, z: 10,
        }), [
            { time: 0, x: 8 },
            { time: 2500, x: 9.4 },
            { time: 5000, x: 8 },
        ]));
        variables.push(variable({
            id: 'loop_footer', name: 'Footer',
            value: [contact.instagram, website].filter(Boolean).join('  ·  ') || brand.name,
        }));
        layers.push(textLayer({
            id: 'loop-footer', name: 'Footer', binding: 'loop_footer',
            text: [contact.instagram, website].filter(Boolean).join('  ·  ') || brand.name,
            family: fonts.body, weight: 300, sizePct: 1.5,
            color: onDark, opacity: 0.86, align: 'left',
            x: 8, y: 78, w: 84, h: 3, z: 10,
        }));
        return { layers, variables };
    }

    function buildDisplayScreen(ctx) {
        const { roles, accentText, fonts, brand, logoLight, contact, website, lines, muted, onDark, scrim } = ctx;
        const photo = photoFor(brand, 'interior|room|bar|hero|signature') || ctx.photo;
        const on = logoLight || ctx.logo;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'screen-ground', name: 'Screen ground', color: scrim, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        if (photo) {
            layers.push(animate(imageLayer({
                id: 'screen-photo', name: 'Screen photograph', url: photo.url, fit: 'cover',
                x: 0, y: 0, w: 100, h: 100, z: 1, bleed: true,
            }), [
                { time: 0, x: 0, y: 0, w: 100, h: 100 },
                { time: 3000, x: -3, y: -2, w: 107, h: 107 },
                { time: 6000, x: 0, y: 0, w: 100, h: 100 },
            ]));
        }
        layers.push(imageLayer({
            id: 'screen-scrim', name: 'Screen scrim', color: scrim,
            x: 0, y: 0, w: 100, h: 100, opacity: 0.55, z: 2, bleed: true,
        }));
        if (on) {
            layers.push(imageLayer({
                id: 'screen-logo', name: 'Screen logo', url: on.url, fit: 'contain',
                x: 7, y: 8, w: 24, h: 7, z: 6, bleed: true,
            }));
        }
        layers.push(animate(imageLayer({
            id: 'screen-rule', name: 'Screen rule', color: roles.accent.hex,
            x: 7, y: 61, w: 12, h: 0.6, z: 3, bleed: true,
        }), [
            { time: 0, w: 12 },
            { time: 3000, w: 20 },
            { time: 6000, w: 12 },
        ]));
        variables.push(variable({ id: 'screen_headline', name: 'Headline', value: lines.headline }));
        layers.push(animate(textLayer({
            id: 'screen-headline', name: 'Headline', binding: 'screen_headline',
            text: lines.headline, family: fonts.title, weight: 300,
            sizePct: 5.6, lineHeight: 1.02, color: onDark, align: 'left',
            x: 7, y: 65, w: 56, h: 17, z: 10,
        }), [
            { time: 0, y: 65 },
            { time: 3000, y: 63.8 },
            { time: 6000, y: 65 },
        ]));
        variables.push(variable({ id: 'screen_subhead', name: 'Sub-headline', value: lines.subhead }));
        layers.push(textLayer({
            id: 'screen-subhead', name: 'Sub-headline', binding: 'screen_subhead',
            text: lines.subhead, family: fonts.label, weight: 400,
            sizePct: 1.7, letterSpacingEm: 0.16, transform: 'uppercase',
            color: onDark, align: 'left', x: 8, y: 83.5, w: 55, h: 4, z: 10,
        }));
        variables.push(variable({ id: 'screen_detail', name: 'Detail', value: lines.detail }));
        layers.push(textLayer({
            id: 'screen-detail', name: 'Detail', binding: 'screen_detail',
            text: lines.detail,
            family: fonts.body, weight: 300, sizePct: 1.7, lineHeight: 1.35,
            color: onDark, opacity: 0.86, align: 'left',
            x: 66, y: 68, w: 26, h: 12, z: 10,
        }));
        variables.push(variable({
            id: 'screen_footer', name: 'Footer',
            value: [contact.address, website].filter(Boolean).join('  ·  ') || brand.name,
        }));
        layers.push(textLayer({
            id: 'screen-footer', name: 'Footer', binding: 'screen_footer',
            text: [contact.address, website].filter(Boolean).join('  ·  ') || brand.name,
            family: fonts.label, weight: 400, sizePct: 1.1, letterSpacingEm: 0.05,
            color: onDark, opacity: 0.86, align: 'left',
            x: 8, y: 90.5, w: 84, h: 2.5, z: 10,
        }));
        return { layers, variables };
    }

    function buildDigitalMenuBoard(ctx) {
        const { roles, accentText, fonts, brand, logo, contact, website, lines, muted } = ctx;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'board-ground', name: 'Board ground', color: roles.ground.hex, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(animate(imageLayer({
            id: 'board-rule', name: 'Board rule', color: roles.accent.hex,
            x: 7, y: 18, w: 30, h: 0.5, z: 2, bleed: true,
        }), [
            { time: 0, w: 30 },
            { time: 2500, w: 44 },
            { time: 5000, w: 30 },
        ]));
        if (logo) {
            layers.push(imageLayer({
                id: 'board-logo', name: 'Board logo', url: logo.url, fit: 'contain',
                x: 7, y: 8, w: 22, h: 7, z: 6, bleed: true,
            }));
        }
        const boardTitle = brand?.content?.copy?.menu?.title || `${brand.name} — menu`;
        variables.push(variable({ id: 'board_title', name: 'Board title', value: boardTitle }));
        layers.push(animate(textLayer({
            id: 'board-title', name: 'Board title', binding: 'board_title',
            text: boardTitle, family: fonts.title, weight: 300,
            sizePct: 4.2, lineHeight: 1.05, color: roles.ink.hex, align: 'left',
            x: 7, y: 20.5, w: 60, h: 7, z: 10,
        }), [
            { time: 0, y: 20.5 },
            { time: 2500, y: 19.9 },
            { time: 5000, y: 20.5 },
        ]));
        const items = menuItems(brand);
        items.forEach((item, index) => {
            const number = index + 1;
            const y = 32 + index * 10.4;
            variables.push(variable({ id: `board_item_${number}_name`, name: `Item ${number} — name`, value: item[0] }));
            variables.push(variable({ id: `board_item_${number}_desc`, name: `Item ${number} — description`, value: item[1] }));
            variables.push(variable({ id: `board_item_${number}_price`, name: `Item ${number} — price`, value: item[2] }));
            layers.push(textLayer({
                id: `board-item-${number}-name`, name: `Item ${number} name`, binding: `board_item_${number}_name`,
                text: item[0], family: fonts.heading, weight: 400, sizePct: 2.4,
                color: roles.ink.hex, align: 'left', x: 8, y, w: 66, h: 4.2, z: 10,
            }));
            layers.push(textLayer({
                id: `board-item-${number}-price`, name: `Item ${number} price`, binding: `board_item_${number}_price`,
                text: item[2], family: fonts.body, weight: 400, sizePct: 2.4,
                color: accentText, align: 'right', x: 79, y, w: 13, h: 4.2, z: 10,
            }));
            layers.push(textLayer({
                id: `board-item-${number}-desc`, name: `Item ${number} description`, binding: `board_item_${number}_desc`,
                text: item[1], family: fonts.body, weight: 300, sizePct: 1.5,
                lineHeight: 1.3, color: roles.ink.hex, opacity: muted(roles.ink.hex),
                align: 'left', x: 8, y: y + 3.9, w: 70, h: 3.6, z: 10,
            }));
        });
        variables.push(variable({
            id: 'board_footer', name: 'Footer',
            value: [contact.address, website].filter(Boolean).join('  ·  ') || brand.name,
        }));
        layers.push(textLayer({
            id: 'board-footer', name: 'Footer', binding: 'board_footer',
            text: [contact.address, website].filter(Boolean).join('  ·  ') || brand.name,
            family: fonts.label, weight: 400, sizePct: 1.2, letterSpacingEm: 0.05,
            color: roles.ink.hex, opacity: muted(roles.ink.hex), align: 'left',
            x: 8, y: 90, w: 84, h: 3, z: 10,
        }));
        return { layers, variables };
    }

    function buildLinkPreview(ctx) {
        const { roles, accentText, fonts, brand, logo, contact, website, lines, muted } = ctx;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'link-ground', name: 'Link ground', color: roles.ground.hex, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        layers.push(animate(imageLayer({
            id: 'link-bar', name: 'Accent bar', color: roles.accent.hex,
            x: 0, y: 0, w: 1.6, h: 100, z: 1, bleed: true,
        }), [
            { time: 0, w: 1.6 },
            { time: 2000, w: 4.2 },
            { time: 4000, w: 1.6 },
        ]));
        if (logo) {
            layers.push(imageLayer({
                id: 'link-logo', name: 'Link logo', url: logo.url, fit: 'contain',
                x: 7, y: 14, w: 22, h: 8, z: 6, bleed: true,
            }));
        }
        variables.push(variable({ id: 'link_kicker', name: 'Kicker', value: lines.kicker }));
        layers.push(textLayer({
            id: 'link-kicker', name: 'Kicker', binding: 'link_kicker',
            text: lines.kicker, family: fonts.label, weight: 400,
            sizePct: 2.2, letterSpacingEm: 0.2, transform: 'uppercase',
            color: accentText, align: 'left', x: 8, y: 27, w: 84, h: 4, z: 10,
        }));
        variables.push(variable({ id: 'link_headline', name: 'Headline', value: lines.headline }));
        layers.push(animate(textLayer({
            id: 'link-headline', name: 'Headline', binding: 'link_headline',
            text: lines.headline, family: fonts.title, weight: 300,
            sizePct: 6.4, lineHeight: 1.04, color: roles.ink.hex, align: 'left',
            x: 8, y: 33, w: 64, h: 24, z: 10,
        }), [
            { time: 0, y: 33 },
            { time: 2000, y: 31.8 },
            { time: 4000, y: 33 },
        ]));
        variables.push(variable({ id: 'link_subhead', name: 'Sub-headline', value: lines.detail }));
        layers.push(textLayer({
            id: 'link-subhead', name: 'Sub-headline', binding: 'link_subhead',
            text: lines.detail,
            family: fonts.body, weight: 300, sizePct: 2.1, lineHeight: 1.35,
            color: roles.ink.hex, opacity: muted(roles.ink.hex), align: 'left',
            x: 8, y: 62, w: 64, h: 8, z: 10,
        }));
        variables.push(variable({
            id: 'link_footer', name: 'Footer',
            value: [contact.address, website].filter(Boolean).join('  ·  ') || brand.name,
        }));
        layers.push(textLayer({
            id: 'link-footer', name: 'Footer', binding: 'link_footer',
            text: [contact.address, website].filter(Boolean).join('  ·  ') || brand.name,
            family: fonts.label, weight: 400, sizePct: 1.4, letterSpacingEm: 0.06,
            color: roles.ink.hex, opacity: muted(roles.ink.hex), align: 'left',
            x: 8, y: 77, w: 84, h: 4, z: 10,
        }));
        return { layers, variables };
    }

    function formatFor(template) {
        // A template can carry its own safe margin (as fractions of the
        // format). The studio reads it from the format, so the guardrail and
        // the build-time type fit agree.
        const safeZone = template.safeZone && typeof template.safeZone === 'object'
            ? {
                top: clamp(finite(template.safeZone.top, 0), 0, 0.45),
                right: clamp(finite(template.safeZone.right, 0), 0, 0.45),
                bottom: clamp(finite(template.safeZone.bottom, 0), 0, 0.45),
                left: clamp(finite(template.safeZone.left, 0), 0, 0.45),
            }
            : null;
        const master = {
            id: 'master',
            isMaster: true,
            channel: template.channel,
            label: 'Master',
            width: template.width,
            height: template.height,
            layerOverrides: {},
            variableValues: {},
        };
        if (safeZone) master.safeZone = safeZone;
        const extras = (template.formats || []).map((format) => {
            const entry = {
                id: format.id,
                isMaster: false,
                channel: template.channel,
                label: format.label || format.id,
                width: format.width,
                height: format.height,
                layerOverrides: {},
                variableValues: {},
            };
            if (safeZone) entry.safeZone = safeZone;
            return entry;
        });
        return [master, ...extras];
    }

    /**
     * Builds a complete v3 composition for one brand + one template.
     * `projectId` is optional; when given it becomes the composition id so the
     * backend can save it as a normal imported project.
     */
    function createTemplateComposition(options) {
        const source = options || {};
        const brand = normalizeBrand(source.brand, 0);
        if (!brand) throw new Error('A brand with a name or a palette is required.');
        const template = templateById(source.templateId);
        if (!template) throw new Error(`Unknown template “${source.templateId}”.`);
        layerCounter = 0;
        const ctx = makeContext(brand, template);
        // Group identity (the Cawley endorsement lockup) lives on the pack's
        // portfolio rather than on a single brand, so pass it through.
        ctx.portfolio = normalizePortfolio(source.portfolio);
        const built = template.build(ctx);
        if (!built || !Array.isArray(built.layers) || !built.layers.length) {
            throw new Error(`The “${template.label}” template produced no layers.`);
        }
        // Font substitution: licensed families are named in the guide but no
        // binaries travel with the pack. Map each non-system family to a
        // stand-in and record the intent in meta.fontSubstitutions.
        const fontSubstitutions = {};
        if (source.useFallbackFonts !== false && brand.fontReady !== true) {
            built.layers.forEach((layer) => {
                if (layer.type !== 'text') return;
                const family = layer.font?.family || '';
                if (!family || isSystemFamily(family)) return;
                const fallback = fallbackFontFor(family);
                fontSubstitutions[family] = fallback;
                layer.font.family = fallback;
            });
        }
        // Layer ids must be unique even when a build function reuses one.
        const seen = new Set();
        built.layers.forEach((layer, index) => {
            let id = layer.id || `layer-${index + 1}`;
            if (seen.has(id)) id = `${id}-${index + 1}`;
            seen.add(id);
            layer.id = id;
            if (layer.type === 'image') layer.bleed = layer.bleed === true;
        });
        const zone = template.safeZone && typeof template.safeZone === 'object'
            ? {
                top: clamp(finite(template.safeZone.top, 0), 0, 0.45) * 100,
                right: clamp(finite(template.safeZone.right, 0), 0, 0.45) * 100,
                bottom: clamp(finite(template.safeZone.bottom, 0), 0, 0.45) * 100,
                left: clamp(finite(template.safeZone.left, 0), 0, 0.45) * 100,
            }
            : safeZoneForChannel(template.channel);
        const layout = { width: template.width, height: template.height };
        built.layers.forEach((layer) => fitTextToSafeArea(layer, zone));
        built.layers.forEach((layer) => fitTextHeight(layer, layout, built.layers, zone));
        built.layers.forEach((layer) => fitTextToSafeArea(layer, zone));
        built.layers.sort((a, b) => a.z - b.z);
        enforceTextContrast(built.layers, ctx.contrastCandidates, layout);
        const now = text(source.now, 40) || new Date().toISOString();
        const id = ID_PATTERN.test(String(source.projectId || ''))
            ? String(source.projectId)
            : slugId(`${brand.id}-${template.id}`, 'brand-template');
        const kit = brandKitFor(brand);
        // Templates drawn in a wider art direction than the guide's palette
        // declare those colours here. Merging them into the composition kit
        // keeps the off-palette guardrail honest for a scene the user edits.
        if (kit && Array.isArray(template.kitColors) && template.kitColors.length) {
            const seenHex = new Set(kit.palette.map((entry) => entry.hex.toLowerCase()));
            template.kitColors.forEach((entry) => {
                const hex = normalizeHex(entry?.hex);
                if (!hex || seenHex.has(hex) || kit.palette.length >= 40) return;
                seenHex.add(hex);
                kit.palette.push({ name: text(entry.name, 80) || hex.toUpperCase(), hex });
            });
        }
        const name = text(source.name, 120) || `${brand.name} — ${template.label}`;
        return {
            version: 3,
            id,
            name,
            width: template.width,
            height: template.height,
            duration: Number(template.duration) || 10000,
            defaultLocale: 'en',
            referenceLayerId: null,
            characters: [],
            formats: formatFor(template),
            activeFormatId: 'master',
            variables: built.variables || [],
            brandKit: kit,
            brandKitId: brand.brandKitId || null,
            guardrails: { enabled: false, block: false },
            showSafeZones: true,
            layers: built.layers,
            meta: {
                source: 'brand-template',
                schema: TEMPLATE_SCHEMA,
                packId: text(source.packId, 80) || null,
                packName: text(source.packName, 160) || null,
                brandId: brand.id,
                brandName: brand.name,
                templateId: template.id,
                templateLabel: template.label,
                templateSpec: templateSpec(template),
                guideline: ctx.roles.application
                    ? {
                        application: ctx.roles.application.application,
                        specification: ctx.roles.application.specification,
                        scope: ctx.roles.application.scope,
                    }
                    : null,
                palette: template.palette && normalizeHex(template.palette.ground)
                    ? {
                        ground: normalizeHex(template.palette.ground),
                        accent: normalizeHex(template.palette.accent) || ctx.roles.accent.hex,
                        ink: normalizeHex(template.palette.ink) || ctx.roles.ink.hex,
                        contrast: ctx.roles.contrast,
                    }
                    : {
                        ground: ctx.roles.ground.hex,
                        accent: ctx.roles.accent.hex,
                        ink: ctx.roles.ink.hex,
                        contrast: ctx.roles.contrast,
                    },
                fontSubstitutions,
                createdAt: now,
                updatedAt: now,
            },
        };
    }

    return {
        PACK_SCHEMA,
        TEMPLATE_SCHEMA,
        TEMPLATES,
        ID_PATTERN,
        clamp,
        text,
        titleCase,
        slugId,
        normalizeHex,
        hexToRgb,
        luminance,
        isDark,
        contrastRatio,
        normalizeColorEntry,
        normalizePalette,
        normalizeTypography,
        normalizeVoice,
        normalizeProvenance,
        PROVENANCE_KINDS,
        PROVENANCE_CONFIDENCE,
        normalizeLogos,
        normalizeGuidelines,
        normalizeContent,
        normalizeMenus,
        normalizeMenu,
        normalizeVenue,
        normalizeLocations,
        normalizeDocuments,
        MENU_KINDS,
        menuItemLine,
        menuSectionText,
        menuText,
        menuRows,
        menusFor,
        contentAssets,
        branchesOfBrand,
        branchLabel,
        normalizeBrand,
        normalizeBrandPack,
        brandKitFor,
        fallbackFontFor,
        isSystemFamily,
        paletteRoles,
        logoFor,
        photoFor,
        contactMap,
        applyTemplateCopy,
        templateById,
        templateCatalog,
        templateSpec,
        createTemplateComposition,
    };
}));
