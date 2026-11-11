#!/usr/bin/env node
'use strict';
/**
 * apply-vincent-hovorka-refinement.js — rebuild a refined brand pack from the
 * curated files on disk.
 *
 * The Vincent Hovorka pack was imported from a thin crawl: no content, no
 * documents, one logo (another business's), a placeholder email and a guide
 * full of review tables. The curation pass writes the real sources,
 * `content/<brand>.json`, `tokens/*.tokens.json`, `assets/logos`,
 * `assets/photography` and the Word guides. This script is the bridge back into
 * `pack.json` and the shared kits, using the same normalizers as an import.
 *
 * Usage
 *   node scripts/apply-vincent-hovorka-refinement.js --dry-run
 *   node scripts/apply-vincent-hovorka-refinement.js
 */
const fs = require('node:fs');
const path = require('node:path');
const Brand = require('../src/shared/brand-pack.js');
const { readZipEntries, extractZipEntry } = require('../server.js');
const { parseBrandDocx } = require('../src/server/brand-docx.js');

const ROOT = path.resolve(__dirname, '..');
const PACK_ID = 'vincent-hovorka-20261111070926-3fde';
const PACK_DIR = path.join(ROOT, 'data', 'brand-packs', PACK_ID);
const PACK_FILE = path.join(PACK_DIR, 'pack.json');
const KITS_DIR = path.join(ROOT, 'data', 'brand-kits');
const BRANDS = ['vincenthovorka', 'businessbreakthroughs-vincenthovorka', 'bordersweb'];
const IMAGE = /\.(png|jpe?g|webp|avif)$/i;
const dryRun = process.argv.includes('--dry-run');

function urlFor(brandId, relative) {
    return `/api/brand-packs/${PACK_ID}/files/${brandId}/${String(relative).split('/').map(encodeURIComponent).join('/')}`;
}

function imageSize(file) {
    const buffer = fs.readFileSync(file);
    if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
        let offset = 2;
        while (offset < buffer.length - 9) {
            if (buffer[offset] !== 0xff) { offset += 1; continue; }
            const marker = buffer[offset + 1];
            const length = buffer.readUInt16BE(offset + 2);
            if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
                return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
            }
            offset += 2 + length;
        }
    }
    if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') {
        if (buffer.slice(12, 16).toString() === 'VP8X') {
            return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
        }
    }
    return { width: null, height: null };
}

function label(file) {
    return path.basename(file, path.extname(file)).replace(/[-_]+/g, ' ');
}

// A logo entry is read in a picker, so name it the way a designer would:
// "VH wordmark — primary", not "vh logo primary wordmark".
function logoLabel(file) {
    const match = path.basename(file, path.extname(file)).match(/^(vh|bb|bw)-logo-(primary|white|ink)-(wordmark|mark)$/i);
    if (!match) return label(file);
    const [, prefix, variant, kind] = match;
    const variantLabel = variant.toLowerCase() === 'ink' ? 'ink (dark ground)' : variant.toLowerCase();
    return `${prefix.toUpperCase()} ${kind.toLowerCase()} — ${variantLabel}`;
}

function readTokens(brandId) {
    const file = path.join(PACK_DIR, 'files', brandId, 'tokens', `${brandId}.tokens.json`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function pad(n) { return String(n).padStart(2, '0'); }

function main() {
    const raw = JSON.parse(fs.readFileSync(PACK_FILE, 'utf8'));
    const pack = raw.pack || raw;
    const updated = [];
    const stamp = new Date().toISOString();

    BRANDS.forEach((brandId) => {
        const brand = (pack.brands || []).find((entry) => entry.id === brandId);
        if (!brand) throw new Error(`Brand ${brandId} is not in ${PACK_ID}`);
        const brandDir = path.join(PACK_DIR, 'files', brandId);
        const tokens = readTokens(brandId);

        brand.wordmark = tokens.brand.wordmark || brand.wordmark;
        brand.tagline = tokens.brand.tagline || '';
        brand.url = tokens.brand.url || brand.url;
        brand.version = '2 (refined)';
        brand.captured = '2026-11-11';
        brand.palette = Brand.normalizePalette(tokens.color);
        brand.typography = Brand.normalizeTypography(tokens.typography);
        brand.voice = Brand.normalizeVoice(tokens.voice);
        brand.tokens = tokens.logo || null;

        // Logos: the curated PNG cuts in assets/logos. The editable SVG
        // masters live in assets/logo-source and are not selection entries.
        const logoDir = path.join(brandDir, 'assets', 'logos');
        const logoFiles = fs.existsSync(logoDir)
            ? fs.readdirSync(logoDir).filter((name) => IMAGE.test(name)).sort((a, b) => {
                const rank = (name) => {
                    const kind = /wordmark/i.test(name) ? 0 : 10;
                    const variant = /white/i.test(name) ? 2 : (/ink|dark|black/i.test(name) ? 1 : 0);
                    return kind + variant;
                };
                return rank(a) - rank(b) || a.localeCompare(b);
            })
            : [];
        brand.logos = Brand.normalizeLogos(logoFiles.map((name) => {
            const relative = `assets/logos/${name}`;
            const size = imageSize(path.join(brandDir, relative));
            return {
                name: logoLabel(name),
                path: relative,
                url: urlFor(brandId, relative),
                format: path.extname(name).slice(1).toLowerCase(),
                width: size.width,
                height: size.height,
            };
        }));

        const photoDir = path.join(brandDir, 'assets', 'photography');
        const photoFiles = fs.existsSync(photoDir)
            ? fs.readdirSync(photoDir).filter((name) => IMAGE.test(name)).sort()
            : [];
        brand.photography = photoFiles.map((name) => {
            const relative = `assets/photography/${name}`;
            const size = imageSize(path.join(brandDir, relative));
            return {
                name: logoLabel(name),
                path: relative,
                url: urlFor(brandId, relative),
                width: size.width,
                height: size.height,
            };
        });

        const coverFile = path.join(brandDir, 'cover.jpg');
        brand.cover = fs.existsSync(coverFile) ? urlFor(brandId, 'cover.jpg') : '';

        // The palette strip and the type specimen are regenerated from the
        // curated palette and scale; keep their recorded dimensions honest.
        const paletteFile = path.join(brandDir, 'assets', 'colors', 'palette.png');
        brand.paletteImages = fs.existsSync(paletteFile)
            ? [{ name: 'palette', path: 'assets/colors/palette.png', url: urlFor(brandId, 'assets/colors/palette.png'), ...imageSize(paletteFile) }]
            : [];
        const specimenFile = path.join(brandDir, 'assets', 'type', 'specimen.png');
        brand.typeSpecimens = fs.existsSync(specimenFile)
            ? [{ name: 'specimen', path: 'assets/type/specimen.png', url: urlFor(brandId, 'assets/type/specimen.png'), ...imageSize(specimenFile) }]
            : [];

        // The Word guide is the human-readable record; parse it with the same
        // parser an import uses, so the guide and the pack cannot drift.
        const docName = `${brandId}-Brand-Guide.docx`;
        const docPath = path.join(brandDir, docName);
        if (fs.existsSync(docPath)) {
            const doc = parseBrandDocx(fs.readFileSync(docPath), { readZipEntries, extractZipEntry }, { name: `${brand.name} brand guide` });
            brand.docPath = docName;
            brand.guidelines = Brand.normalizeGuidelines({
                positioning: doc.positioning,
                applications: doc.applications.map((entry) => ({
                    application: entry.application,
                    specification: entry.specification,
                    scope: entry.scope,
                })),
                printSpec: doc.printSpec,
                contact: doc.contact,
                facts: doc.facts,
                typeHierarchy: doc.typeHierarchy.map((entry) => ({
                    role: entry.role, typeface: entry.typeface, size: entry.size, notes: entry.notes,
                })),
                logoRules: doc.logoRules,
                docTitle: `${brand.name} brand guide`,
                docUrl: urlFor(brandId, docName),
                sections: doc.sections,
            });
        }

        const contentFile = path.join(brandDir, 'content', `${brandId}.json`);
        if (fs.existsSync(contentFile)) {
            const parsed = JSON.parse(fs.readFileSync(contentFile, 'utf8'));
            brand.content = Brand.normalizeContent(parsed);
            const documents = Brand.normalizeDocuments(parsed.documents);
            brand.documents = documents.length ? documents : [];
        }

        const provenance = brand.provenance || {};
        brand.provenance = Brand.normalizeProvenance
            ? Brand.normalizeProvenance({
                kind: 'public',
                confidence: 'medium',
                note: provenance.note
                    || 'Compiled from the businesses\' own public websites and the published speaker sheet (captured 11 November 2026). No asset was supplied by the client.',
            })
            : { kind: 'public', confidence: 'medium', note: 'Compiled from public sources, captured 11 November 2026.' };

        const menus = brand.content?.menus || [];
        const items = menus.reduce((sum, menu) => sum + menu.sections.reduce((n, section) => n + section.items.length, 0), 0);
        updated.push(`${brandId}: ${brand.palette.length} colours · ${brand.typography.families.length} families · ${brand.logos.length} logos · ${brand.photography.length} photos · ${menus.length} menus / ${items} items · ${brand.guidelines?.facts?.length || 0} facts`);
    });

    // Portfolio: the group overview is one more Word document the studio shows.
    const portfolioDoc = path.join(PACK_DIR, 'files', 'portfolio', 'Vincent-Hovorka-Overview.docx');
    if (fs.existsSync(portfolioDoc)) {
        const doc = parseBrandDocx(fs.readFileSync(portfolioDoc), { readZipEntries, extractZipEntry }, { name: 'Vincent Hovorka portfolio' });
        pack.portfolio = pack.portfolio || {};
        pack.portfolio.name = 'Vincent Hovorka';
        pack.portfolio.docTitle = 'Vincent Hovorka — Portfolio';
        pack.portfolio.docUrl = `/api/brand-packs/${PACK_ID}/files/portfolio/Vincent-Hovorka-Overview.docx`;
        pack.portfolio.summary = 'One operator, three businesses: property partnerships, a founder podcast, and websites for local businesses.';
        pack.portfolio.guidelines = Brand.normalizeGuidelines({
            positioning: doc.positioning,
            applications: doc.applications,
            printSpec: doc.printSpec,
            contact: doc.contact,
            facts: doc.facts,
            typeHierarchy: doc.typeHierarchy,
            logoRules: doc.logoRules,
            docTitle: 'Vincent Hovorka — Portfolio',
            docUrl: pack.portfolio.docUrl,
            sections: doc.sections,
        });
        pack.portfolio.assets = [];
    }

    pack.description = 'Three businesses curated from the November 2026 intake: property partnerships, a founder podcast, and websites for local businesses.';

    // Keep the manifest's own file count honest after the curation pass.
    let fileCount = 0;
    let declaredBytes = 0;
    const walk = (dir) => {
        fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else {
                fileCount += 1;
                declaredBytes += fs.statSync(full).size;
            }
        });
    };
    walk(path.join(PACK_DIR, 'files'));
    pack.meta = { ...(pack.meta || {}), fileCount, declaredBytes };

    const next = { pack, updatedAt: stamp };
    if (!dryRun) {
        const temp = `${PACK_FILE}.tmp`;
        fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
        fs.renameSync(temp, PACK_FILE);
        // Shared kits are a mirror of the pack's palette, fonts and logos.
        pack.brands.forEach((brand) => {
            if (!brand.brandKitId) return;
            const kit = Brand.brandKitFor(brand, brand.brandKitId);
            if (!kit) return;
            const file = path.join(KITS_DIR, `${brand.brandKitId}.json`);
            fs.writeFileSync(file, `${JSON.stringify({ kit, updatedAt: stamp }, null, 2)}\n`);
        });
    }

    console.log(`${dryRun ? 'Would write' : 'Wrote'} ${path.relative(ROOT, PACK_FILE)}`);
    updated.forEach((line) => console.log(`  ${line}`));
}

main();
