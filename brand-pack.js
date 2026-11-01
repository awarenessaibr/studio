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
    const MAX_PHOTOS = 80;

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
    function normalizeBrand(value, index) {
        const source = value && typeof value === 'object' ? value : {};
        const id = ID_PATTERN.test(String(source.id || ''))
            ? String(source.id)
            : slugId(source.name || source.dir, `brand-${index + 1}`);
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
            logos: normalizeLogos(source.logos),
            photography: normalizePhotos(source.photography),
            paletteImages: normalizeGallery(source.paletteImages),
            typeSpecimens: normalizeGallery(source.typeSpecimens),
            cover: normalizeAssetUrl(source.cover) || null,
            guidelines: normalizeGuidelines(source.guidelines),
            brandKitId: ID_PATTERN.test(String(source.brandKitId || '')) ? String(source.brandKitId) : null,
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

    function paletteRoles(brand, templateId) {
        const ground = pickGround(brand, templateId);
        const ink = pickInk(brand, ground);
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

    // ---------------------------------------------------------------------
    // Template catalog
    // ---------------------------------------------------------------------
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
    ];

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
        return TEMPLATES.map((template) => {
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
        const accentText = contrastRatio(roles.accent.hex, roles.ground.hex) >= 4
            ? roles.accent.hex
            : roles.ink.hex;
        return {
            brand,
            template,
            roles,
            accentText,
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

    let layerCounter = 0;
    function layerId(name) {
        layerCounter += 1;
        return `${name}-${layerCounter.toString(36)}`;
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
        const { roles, accentText, fonts, brand, logo, contact, website } = ctx;
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
        layers.push(textLayer({
            id: 'menu-kicker', name: 'Menu kicker', text: 'Menu',
            family: fonts.label, weight: 400, sizePct: 1.65, letterSpacingEm: 0.24,
            transform: 'uppercase', color: accentText, align: 'center',
            x: 9, y: 15.6, w: 82, h: 3.2, z: 10,
        }));
        variables.push(variable({ id: 'menu_title', name: 'Menu title', value: `${brand.name} menu` }));
        layers.push(textLayer({
            id: 'menu-title', name: 'Menu title', binding: 'menu_title',
            text: `${brand.name} menu`, family: fonts.title, weight: 300,
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
            value: footer || `${brand.name} · ${brand.tagline || 'Locally sourced, carefully served.'}`,
        }));
        layers.push(textLayer({
            id: 'menu-footer', name: 'Menu footer', binding: 'menu_footer',
            text: footer || brand.name, family: fonts.label, weight: 400, sizePct: 1.05,
            letterSpacingEm: 0.06, color: roles.ink.hex, opacity: 0.62, align: 'center',
            x: 9, y: 88.4, w: 82, h: 2.6, z: 12,
        }));
        return { layers, variables };
    }

    function buildBusinessCardFront(ctx) {
        const { roles, fonts, brand, logo, logoMark } = ctx;
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
        variables.push(variable({ id: 'card_tagline', name: 'Tagline', value: brand.tagline || 'Locally sourced, carefully served.' }));
        layers.push(textLayer({
            id: 'card-front-tagline', name: 'Tagline', binding: 'card_tagline',
            text: brand.tagline || 'Locally sourced, carefully served.', family: fonts.label,
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
        const { roles, accentText, fonts, brand, logoMark, contact, website } = ctx;
        const layers = [];
        const variables = [];
        layers.push(imageLayer({ id: 'card-back-ground', name: 'Card ground', color: roles.ground.hex, x: 0, y: 0, w: 100, h: 100, z: 0, bleed: true }));
        if (logoMark) {
            layers.push(imageLayer({
                id: 'card-back-logo', name: 'Card mark', url: logoMark.url, fit: 'contain',
                x: 74, y: 10, w: 18, h: 12, z: 6, bleed: true,
            }));
        }
        variables.push(variable({ id: 'card_name', name: 'Full name', value: 'Your name' }));
        layers.push(textLayer({
            id: 'card-back-name', name: 'Name', binding: 'card_name', text: 'Your name',
            family: fonts.title, weight: 300, sizePct: 6.2, lineHeight: 1.05,
            color: roles.ink.hex, align: 'left', x: 8, y: 11, w: 60, h: 12, z: 10,
        }));
        variables.push(variable({ id: 'card_role', name: 'Role', value: 'General manager' }));
        layers.push(textLayer({
            id: 'card-back-role', name: 'Role', binding: 'card_role', text: 'General manager',
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
        const { roles, accentText, fonts, brand, logo, logoLight, photo, contact, website } = ctx;
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
        variables.push(variable({ id: 'flyer_headline', name: 'Headline', value: 'A table worth crossing town for' }));
        layers.push(textLayer({
            id: 'flyer-headline', name: 'Headline', binding: 'flyer_headline',
            text: 'A table worth crossing town for', family: fonts.title, weight: 300,
            sizePct: 6.2, lineHeight: 1.02, color: roles.ink.hex, align: 'left',
            x: 8, y: 53, w: 84, h: 16, z: 12,
        }));
        variables.push(variable({ id: 'flyer_subhead', name: 'Sub-headline', value: brand.tagline || 'Locally sourced, carefully served.' }));
        layers.push(textLayer({
            id: 'flyer-subhead', name: 'Sub-headline', binding: 'flyer_subhead',
            text: brand.tagline || 'Locally sourced, carefully served.', family: fonts.heading,
            weight: 400, sizePct: 2.4, letterSpacingEm: 0.06, color: accentText,
            align: 'left', x: 8, y: 69.5, w: 84, h: 5.5, z: 12,
        }));
        variables.push(variable({
            id: 'flyer_body', name: 'Body copy',
            value: 'Seasonal plates, a considered drinks list and a room built for long lunches. Join us for dinner, private dining or a quiet drink at the bar.',
        }));
        layers.push(textLayer({
            id: 'flyer-body', name: 'Body copy', binding: 'flyer_body',
            text: 'Seasonal plates, a considered drinks list and a room built for long lunches. Join us for dinner, private dining or a quiet drink at the bar.',
            family: fonts.body, weight: 300, sizePct: 1.6, lineHeight: 1.45,
            color: roles.ink.hex, opacity: 0.78, align: 'left',
            x: 8, y: 76, w: 84, h: 8.5, z: 12,
        }));
        variables.push(variable({ id: 'flyer_cta', name: 'Call to action', value: 'Book a table' }));
        layers.push(textLayer({
            id: 'flyer-cta', name: 'Call to action', binding: 'flyer_cta', text: 'Book a table',
            family: fonts.label, weight: 400, sizePct: 1.7, letterSpacingEm: 0.18,
            transform: 'uppercase', color: accentText, align: 'left',
            x: 8, y: 88.5, w: 84, h: 3.1, z: 12,
        }));
        variables.push(variable({
            id: 'flyer_footer', name: 'Footer',
            value: [contact.address, website].filter(Boolean).join('  ·  ') || brand.name,
        }));
        layers.push(textLayer({
            id: 'flyer-footer', name: 'Footer', binding: 'flyer_footer',
            text: [contact.address, website].filter(Boolean).join('  ·  ') || brand.name,
            family: fonts.label, weight: 400, sizePct: 1.05, letterSpacingEm: 0.05,
            color: roles.ink.hex, opacity: 0.6, align: 'left',
            x: 8, y: 85.2, w: 84, h: 2.2, z: 12,
        }));
        return { layers, variables };
    }

    function buildTableCard(ctx) {
        const { roles, accentText, fonts, logo, logoMark } = ctx;
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
        variables.push(variable({ id: 'table_kicker', name: 'Kicker', value: "Chef's special" }));
        layers.push(textLayer({
            id: 'table-kicker', name: 'Kicker', binding: 'table_kicker', text: "Chef's special",
            family: fonts.label, weight: 400, sizePct: 1.9, letterSpacingEm: 0.2,
            transform: 'uppercase', color: accentText, align: 'center',
            x: 10, y: 27, w: 80, h: 4, z: 10,
        }));
        variables.push(variable({ id: 'table_dish', name: 'Dish', value: 'Dry-aged beef, bone marrow' }));
        layers.push(textLayer({
            id: 'table-dish', name: 'Dish', binding: 'table_dish', text: 'Dry-aged beef, bone marrow',
            family: fonts.title, weight: 300, sizePct: 4.6, lineHeight: 1.08,
            color: roles.ink.hex, align: 'center', x: 9, y: 33, w: 82, h: 13, z: 10,
        }));
        variables.push(variable({
            id: 'table_description', name: 'Description',
            value: 'Charcoal-grilled, watercress, roast shallot and a red wine jus.',
        }));
        layers.push(textLayer({
            id: 'table-description', name: 'Description', binding: 'table_description',
            text: 'Charcoal-grilled, watercress, roast shallot and a red wine jus.',
            family: fonts.body, weight: 300, sizePct: 1.8, lineHeight: 1.4,
            color: roles.ink.hex, opacity: 0.76, align: 'center',
            x: 12, y: 48, w: 76, h: 15, z: 10,
        }));
        variables.push(variable({ id: 'table_price', name: 'Price', value: '£34' }));
        layers.push(textLayer({
            id: 'table-price', name: 'Price', binding: 'table_price', text: '£34',
            family: fonts.title, weight: 300, sizePct: 3.8, color: accentText,
            align: 'center', x: 10, y: 66, w: 80, h: 8, z: 10,
        }));
        variables.push(variable({
            id: 'table_allergens', name: 'Allergens / note',
            value: 'Ask the team about allergens. Available while the kitchen is open.',
        }));
        layers.push(textLayer({
            id: 'table-allergens', name: 'Allergens / note', binding: 'table_allergens',
            text: 'Ask the team about allergens. Available while the kitchen is open.',
            family: fonts.body, weight: 300, sizePct: 1.25, lineHeight: 1.4,
            color: roles.ink.hex, opacity: 0.58, align: 'center',
            x: 12, y: 85, w: 76, h: 5, z: 10,
        }));
        return { layers, variables };
    }

    function buildVoucher(ctx) {
        const { roles, fonts, brand, logo, contact, website } = ctx;
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
        variables.push(variable({ id: 'voucher_title', name: 'Voucher title', value: 'Gift voucher' }));
        layers.push(textLayer({
            id: 'voucher-title', name: 'Voucher title', binding: 'voucher_title', text: 'Gift voucher',
            family: fonts.label, weight: 400, sizePct: 2.1, letterSpacingEm: 0.18,
            transform: 'uppercase', color: roles.ink.hex, opacity: 0.86, align: 'left',
            x: 8, y: 30, w: 56, h: 5, z: 10,
        }));
        variables.push(variable({ id: 'voucher_value', name: 'Value', value: '£50' }));
        layers.push(textLayer({
            id: 'voucher-value', name: 'Value', binding: 'voucher_value', text: '£50',
            family: fonts.title, weight: 300, sizePct: 8.4, lineHeight: 1,
            color: roles.ink.hex, align: 'left', x: 8, y: 36, w: 56, h: 16, z: 10,
        }));
        variables.push(variable({
            id: 'voucher_terms', name: 'Terms',
            value: 'Redeemable at any Dalton family venue. Valid for 12 months from purchase. One voucher per booking, not exchangeable for cash.',
        }));
        layers.push(textLayer({
            id: 'voucher-terms', name: 'Terms', binding: 'voucher_terms',
            text: 'Redeemable at any Dalton family venue. Valid for 12 months from purchase. One voucher per booking, not exchangeable for cash.',
            family: fonts.body, weight: 300, sizePct: 1.45, lineHeight: 1.4,
            color: roles.ink.hex, opacity: 0.78, align: 'left',
            x: 8, y: 56, w: 56, h: 18, z: 10,
        }));
        variables.push(variable({ id: 'voucher_code', name: 'Redemption code', value: 'GIFT-0001' }));
        layers.push(imageLayer({ id: 'voucher-panel', name: 'Code panel', color: roles.ink.hex, x: 70, y: 28, w: 22, h: 44, z: 8, bleed: true }));
        layers.push(textLayer({
            id: 'voucher-code', name: 'Redemption code', binding: 'voucher_code', text: 'GIFT-0001',
            family: fonts.label, weight: 400, sizePct: 2.2, letterSpacingEm: 0.14,
            transform: 'uppercase', color: roles.ground.hex, align: 'center',
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
            color: roles.ink.hex, opacity: 0.62, align: 'left',
            x: 8, y: 84, w: 84, h: 3, z: 10,
        }));
        return { layers, variables };
    }

    function buildSocialPost(ctx) {
        const { roles, accentText, fonts, brand, logo, logoLight, contact } = ctx;
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
        variables.push(variable({ id: 'social_headline', name: 'Headline', value: 'Dinner, served properly.' }));
        layers.push(textLayer({
            id: 'social-headline', name: 'Headline', binding: 'social_headline', text: 'Dinner, served properly.',
            family: fonts.title, weight: 300, sizePct: 8.4, lineHeight: 1.02,
            color: roles.ink.hex, align: 'center', x: 8, y: 30, w: 84, h: 24, z: 10,
        }));
        variables.push(variable({ id: 'social_subhead', name: 'Sub-headline', value: brand.tagline || 'Locally sourced, carefully served.' }));
        layers.push(textLayer({
            id: 'social-subhead', name: 'Sub-headline', binding: 'social_subhead',
            text: brand.tagline || 'Locally sourced, carefully served.', family: fonts.label,
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
            family: fonts.body, weight: 300, sizePct: 1.5, color: roles.ink.hex, opacity: 0.62,
            align: 'center', x: 8, y: 79, w: 84, h: 4.6, z: 10,
        }));
        return { layers, variables };
    }

    function formatFor(template) {
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
        const extras = (template.formats || []).map((format) => ({
            id: format.id,
            isMaster: false,
            channel: template.channel,
            label: format.label || format.id,
            width: format.width,
            height: format.height,
            layerOverrides: {},
            variableValues: {},
        }));
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
        const built = template.build(ctx);
        if (!built || !Array.isArray(built.layers) || !built.layers.length) {
            throw new Error(`The “${template.label}” template produced no layers.`);
        }
        // Font substitution: licensed families are named in the guide but no
        // binaries travel with the pack. Map each non-system family to a
        // stand-in and record the intent in meta.fontSubstitutions.
        const fontSubstitutions = {};
        if (source.useFallbackFonts !== false) {
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
        built.layers.sort((a, b) => a.z - b.z);
        const now = text(source.now, 40) || new Date().toISOString();
        const id = ID_PATTERN.test(String(source.projectId || ''))
            ? String(source.projectId)
            : slugId(`${brand.id}-${template.id}`, 'brand-template');
        const kit = brandKitFor(brand);
        const name = text(source.name, 120) || `${brand.name} — ${template.label}`;
        return {
            version: 3,
            id,
            name,
            width: template.width,
            height: template.height,
            duration: 10000,
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
                palette: {
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
        normalizeLogos,
        normalizeGuidelines,
        normalizeBrand,
        normalizeBrandPack,
        brandKitFor,
        fallbackFontFor,
        isSystemFamily,
        paletteRoles,
        logoFor,
        photoFor,
        contactMap,
        templateById,
        templateCatalog,
        templateSpec,
        createTemplateComposition,
    };
}));
