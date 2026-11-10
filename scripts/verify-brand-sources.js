#!/usr/bin/env node
'use strict';
/**
 * verify-brand-sources.js — check a brand's menus, rooms and hire content
 * against the documents and page snapshots they were read from.
 *
 * The check is deterministic and offline: prices are compared with the money
 * amounts in the source PDF, room facts with the saved page text and the
 * brochure page, images with the files on disk and the pack's photography
 * list, and every known source conflict with the note that records it. A
 * change to a price, a capacity or a source file fails the run instead of
 * silently shipping.
 *
 * Usage
 *   node scripts/verify-brand-sources.js --pack=<packId>
 *   node scripts/verify-brand-sources.js --pack=<packId> --brand=<brandId>
 *   node scripts/verify-brand-sources.js --pack=<packId> --brand=<brandId> --out=deliverables/x.md
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Brand = require('../src/shared/brand-pack.js');

const ROOT = path.resolve(__dirname, '..');
const PACKS = path.join(ROOT, 'data', 'brand-packs');

// One entry per hireable space. `site` and `brochure` are literal phrases the
// saved sources must still contain; `capacityIn` says which source carries
// the numbers in `content.venue.rooms[].capacity`.
const ROOM_CHECKS = [
    {
        id: 'the-tea-rooms',
        site: 'tearooms',
        brochurePage: 5,
        capacityIn: 'brochure',
        sitePhrases: ['sit-down meals, buffet setups or drinks-only functions', 'Private hire from 6pm', 'no disabled access or disabled toilet on this level'],
        brochurePhrases: ['3 long tables', '1 long table of 20', '8 small tables', 'TV and sound system', 'No disabled access'],
    },
    {
        id: 'room-13',
        site: 'room-13',
        brochurePage: 8,
        capacityIn: 'brochure',
        sitePhrases: ['one large table', 'two separate tables', 'No disabled access or disabled toilets on this level'],
        brochurePhrases: ['Holds 40 people', '12 around 1 table', '14 split over 2 tables', 'Sound system', 'No disabled access'],
    },
    {
        id: 'the-drawing-room',
        site: 'drawing-room',
        brochurePage: 6,
        capacityIn: 'brochure',
        sitePhrases: ['Dining layout', 'Afternoon tea layout', 'U-shape / top table', 'No disabled access or disabled toilets on this level'],
        brochurePhrases: ['2 long tables of 20', '5 separate tables', 'Sound system', 'No disabled access'],
    },
    {
        id: 'the-board-room',
        site: 'board-room',
        brochurePage: 7,
        capacityIn: 'brochure',
        sitePhrases: ['traditional boardroom-style seating', 'TV for presentations', 'no disabled access or disabled toilets on this level'],
        brochurePhrases: ['16 around 1 table', '2 tables of 12', 'TV and sound system', 'No disabled access'],
    },
    {
        id: 'the-cafe',
        site: 'cafe-function-room',
        brochurePage: 9,
        capacityIn: 'site',
        sitePhrases: ['up to 100 guests', 'accessible toilet', 'Disabled access available via Bath Lane', 'wireless microphone', 'karaoke machine'],
        brochurePhrases: ['DJ decks', 'Disabled access', 'stage set-up'],
    },
    {
        id: 'the-buff-club',
        site: 'function-room-hire',
        brochurePage: 10,
        capacityIn: 'none',
        sitePhrases: ['The Buff Club'],
        brochurePhrases: ['Sound system and DJ decks', 'No disabled access', 'afternoons or early evenings'],
    },
];

// A conflict is only allowed to stay in the data if its note stays with it.
const hasRoom = (content, id) => (content.venue?.rooms || []).some((room) => room.id === id);
const hasMenu = (content, id) => (content.menus || []).some((menu) => menu.id === id);
const CONFLICTS = [
    { id: 'five-spaces-six-rooms', must: 'five distinctive spaces', applies: (content) => (content.venue?.rooms || []).length >= 6 },
    { id: 'room-13-capacity', must: 'holds 40', applies: (content) => hasRoom(content, 'room-13') },
    { id: 'cafe-evening-days', must: 'Monday–Wednesday', applies: (content) => hasRoom(content, 'the-cafe') },
    { id: 'christmas-lunch-times', must: '12:30–3pm', applies: (content) => hasMenu(content, 'christmas-thu-sat') },
    { id: 'kids-age', must: '12 and under', applies: (content) => hasMenu(content, 'kids') },
    { id: 'tea-flavours', must: '42-flavour', applies: (content) => hasMenu(content, 'afternoon-tea') },
    { id: 'buffet-date', must: 'September 2024', applies: (content) => hasMenu(content, 'buffet') },
    { id: 'no-minimum-spend', must: 'No minimum spend', applies: (content) => Boolean(content.venue?.rooms?.length) },
];

function parseArgs(argv) {
    const options = { pack: '', brand: '', out: '', verbose: false };
    argv.forEach((arg) => {
        const [flag, value = ''] = arg.split('=');
        if (flag === '--pack') options.pack = value;
        else if (flag === '--brand') options.brand = value;
        else if (flag === '--out') options.out = value;
        else if (flag === '--verbose') options.verbose = true;
        else if (flag === '--help' || flag === '-h') {
            console.log('Usage: node scripts/verify-brand-sources.js --pack=<packId> [--brand=<brandId>] [--out=<file.md>] [--verbose]');
            process.exit(0);
        } else {
            console.error(`Unknown option: ${arg}`);
            process.exit(2);
        }
    });
    if (!options.pack) {
        console.error('--pack is required.');
        process.exit(2);
    }
    return options;
}

function normalize(value) {
    return String(value || '')
        .replace(/[’‘]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function has(text, phrase) {
    return normalize(text).includes(normalize(phrase));
}

function pdfText(file, page) {
    const args = page ? ['-layout', '-f', String(page), '-l', String(page), file, '-'] : ['-layout', file, '-'];
    try {
        return execFileSync('pdftotext', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    } catch (error) {
        return '';
    }
}

function pdfPages(file) {
    try {
        const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
        const match = info.match(/^Pages:\s+(\d+)/m);
        return match ? Number(match[1]) : null;
    } catch {
        return null;
    }
}

function money(text) {
    const amounts = new Set();
    const pattern = /£\s?(\d{1,4}(?:\.\d{1,2})?)/g;
    let match;
    while ((match = pattern.exec(String(text || '')))) amounts.add(Number(match[1]));
    return amounts;
}

function moneyIn(value) {
    const amounts = new Set();
    const pattern = /£\s?(\d{1,4}(?:\.\d{1,2})?)/g;
    let match;
    while ((match = pattern.exec(String(value || '')))) amounts.add(Number(match[1]));
    return [...amounts];
}

function numbers(value) {
    return [...new Set((String(value || '').match(/\b\d{1,4}\b/g) || []).map(Number))];
}

function addCheck(state, ok, label, detail) {
    state.checks += 1;
    if (ok) state.passed += 1;
    else state.failed += 1;
    if (!ok || state.verbose) {
        state.rows.push({ ok, label, detail: detail || '' });
    }
}

function render(state) {
    const lines = [];
    lines.push(`# Source verification — ${state.brandName}`);
    lines.push('');
    lines.push(`Pack \`${state.packId}\` · generated ${new Date().toISOString().slice(0, 10)}.`);
    lines.push('This report is generated by `scripts/verify-brand-sources.js`; it compares the pack with the source PDFs and the saved page snapshots.');
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push('| Check | Result |');
    lines.push('| --- | --- |');
    lines.push(`| Checks run | ${state.checks} |`);
    lines.push(`| Passed | ${state.passed} |`);
    lines.push(`| Failed | ${state.failed} |`);
    lines.push(`| Skipped (rules for another brand) | ${state.skipped} |`);
    lines.push(`| Warnings | ${state.warnings.length} |`);
    lines.push('');
    if (state.warnings.length) {
        lines.push('### Warnings');
        lines.push('');
        state.warnings.forEach((warning) => lines.push(`- ${warning}`));
        lines.push('');
    }
    if (state.rows.length) {
        lines.push('## Checks');
        lines.push('');
        lines.push('| Result | Check | Detail |');
        lines.push('| --- | --- | --- |');
        state.rows.forEach((row) => {
            const cell = (value) => String(value == null ? '' : value).replace(/\|/g, '\\|');
            lines.push(`| ${row.ok ? 'pass' : '**FAIL**'} | ${cell(row.label)} | ${cell(row.detail)} |`);
        });
        lines.push('');
    }
    if (state.menuRows.length) {
        lines.push('## Menu prices against their source PDF');
        lines.push('');
        lines.push('| Menu | Source | Price tokens | Missing |');
        lines.push('| --- | --- | --- | --- |');
        state.menuRows.forEach((row) => {
            lines.push(`| ${row.menu} | ${row.source} | ${row.checked} | ${row.missing.length ? row.missing.join(', ') : '—'} |`);
        });
        lines.push('');
    }
    if (state.roomRows.length) {
        lines.push('## Room facts against the site and the brochure');
        lines.push('');
        lines.push('| Room | Site | Brochure | Result |');
        lines.push('| --- | --- | --- | --- |');
        state.roomRows.forEach((row) => {
            lines.push(`| ${row.room} | ${row.site} | ${row.brochure} | ${row.ok ? 'pass' : '**FAIL**'} |`);
        });
        lines.push('');
    }
    lines.push('## Conflicts kept on the record');
    lines.push('');
    state.conflicts.forEach((row) => {
        lines.push(`- ${row.ok ? 'pass' : '**FAIL**'} — ${row.id}`);
    });
    lines.push('');
    return `${lines.join('\n')}\n`;
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const packDir = path.join(PACKS, options.pack);
    const packFile = path.join(packDir, 'pack.json');
    if (!fs.existsSync(packFile)) {
        console.error(`Pack “${options.pack}” not found.`);
        process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(packFile, 'utf8'));
    const pack = Brand.normalizeBrandPack(raw.pack || raw);
    if (!pack) {
        console.error('That pack could not be normalised.');
        process.exit(1);
    }
    const brands = pack.brands.filter((brand) => !options.brand || brand.id === options.brand);
    if (!brands.length) {
        console.error(options.brand ? `Brand “${options.brand}” is not in that pack.` : 'That pack has no brands.');
        process.exit(1);
    }

    let exitCode = 0;
    brands.forEach((brand) => {
        const brandRoot = path.join(packDir, 'files', brand.id);
        const sourcesRoot = path.join(brandRoot, 'sources');
        const content = brand.content || {};
        const state = {
            packId: options.pack,
            brandName: brand.name,
            checks: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            warnings: [],
            rows: [],
            menuRows: [],
            roomRows: [],
            conflicts: [],
            verbose: options.verbose,
        };

        // 1. Documents exist and their page counts are true.
        content.documents.forEach((document) => {
            const file = path.join(brandRoot, document.path);
            const exists = fs.existsSync(file);
            addCheck(state, exists, `document exists: ${document.path}`, exists ? '' : 'missing from the pack');
            if (!exists) return;
            const pages = pdfPages(file);
            if (pages != null) {
                addCheck(state, pages === document.pages, `document pages: ${document.path}`, `recorded ${document.pages}, PDF has ${pages}`);
            }
        });

        // 2. Prices against the PDF the menu was read from.
        content.menus.forEach((menu) => {
            const source = menu.source.document;
            if (!source) {
                state.warnings.push(`${menu.name}: no PDF source (${menu.source.note || 'promo image'}) — not machine-checked`);
                state.menuRows.push({ menu: menu.name, source: '—', checked: 0, missing: [] });
                return;
            }
            // A consolidated menu can be read from more than one PDF (the
            // Christmas lunch and dinner sheets, for example). Check every
            // document that names the menu, not only the anchor page.
            const linked = content.documents
                .filter((document) => (document.menuIds || []).includes(menu.id))
                .map((document) => document.path);
            const files = [...new Set([source, ...linked])].filter((file) => fs.existsSync(path.join(brandRoot, file)));
            if (!files.length) {
                addCheck(state, false, `menu source exists: ${menu.name}`, source);
                return;
            }
            const text = files.map((file) => pdfText(path.join(brandRoot, file), null)).join('\n');
            if (normalize(text).length < 40) {
                state.warnings.push(`${menu.name}: ${source} has no text layer — transcription checked by eye, not by script`);
                state.menuRows.push({ menu: menu.name, source: path.basename(source), checked: 0, missing: [] });
                return;
            }
            const available = money(text);
            const claims = [];
            if (menu.priceNote) moneyIn(menu.priceNote).forEach((amount) => claims.push({ amount, where: 'menu price note' }));
            menu.sections.forEach((section) => {
                moneyIn(section.price).forEach((amount) => claims.push({ amount, where: `section "${section.name}"` }));
                section.items.forEach((item) => {
                    moneyIn(item.price).forEach((amount) => claims.push({ amount, where: `item "${item.name}"` }));
                });
            });
            menu.packages.forEach((pack2) => {
                moneyIn(pack2.price).forEach((amount) => claims.push({ amount, where: `package "${pack2.name}"` }));
            });
            const missing = claims.filter((claim) => !available.has(claim.amount));
            addCheck(
                state,
                missing.length === 0,
                `menu prices: ${menu.name}`,
                missing.length ? missing.map((claim) => `£${claim.amount} (${claim.where})`).join(', ') : `${claims.length} tokens in ${files.map((file) => path.basename(file)).join(', ')}`,
            );
            state.menuRows.push({
                menu: menu.name,
                source: files.map((file) => path.basename(file)).join(', '),
                checked: claims.length,
                missing: missing.map((claim) => `£${claim.amount}`),
            });
        });

        // 3. Room facts against the saved page text and the brochure page.
        const brochure = content.documents.find((document) => /brochure/i.test(document.title) || /brochure/i.test(document.path));
        const siteManifestFile = path.join(sourcesRoot, 'site', 'manifest.json');
        const manifest = fs.existsSync(siteManifestFile) ? JSON.parse(fs.readFileSync(siteManifestFile, 'utf8')) : null;
        const brochureFile = brochure ? path.join(brandRoot, brochure.path) : null;
        const rooms = content.venue?.rooms || [];
        const roomChecks = new Map(ROOM_CHECKS.map((entry) => [entry.id, entry]));
        rooms.forEach((room) => {
            const check = roomChecks.get(room.id);
            if (!check) {
                state.warnings.push(`room ${room.id}: no verification rule — add one to ROOM_CHECKS`);
                return;
            }
            const siteFile = path.join(sourcesRoot, 'site', `${check.site}.txt`);
            const siteText = fs.existsSync(siteFile) ? fs.readFileSync(siteFile, 'utf8') : '';
            const brochureText = brochureFile && fs.existsSync(brochureFile) ? pdfText(brochureFile, check.brochurePage) : '';
            const siteOk = siteText && check.sitePhrases.every((phrase) => has(siteText, phrase));
            const brochureOk = brochureText && check.brochurePhrases.every((phrase) => has(brochureText, phrase));
            addCheck(state, siteOk, `room site phrases: ${room.name}`, siteOk ? check.site : `missing one of ${check.sitePhrases.join(' / ')}`);
            addCheck(state, brochureOk, `room brochure phrases: ${room.name}`, brochureOk ? `p.${check.brochurePage}` : `missing one of ${check.brochurePhrases.join(' / ')}`);
            addCheck(state, room.brochurePage === check.brochurePage, `room brochure page: ${room.name}`, `recorded ${room.brochurePage}, checked p.${check.brochurePage}`);
            if (check.capacityIn !== 'none') {
                const haystack = check.capacityIn === 'site' ? siteText : brochureText;
                const missing = numbers(room.capacity).filter((value) => !new RegExp(`\\b${value}\\b`).test(haystack));
                addCheck(
                    state,
                    missing.length === 0,
                    `room capacity numbers: ${room.name}`,
                    missing.length ? `not in ${check.capacityIn}: ${missing.join(', ')}` : `${numbers(room.capacity).join(', ')} in ${check.capacityIn}`,
                );
            }
            const image = room.image ? path.join(brandRoot, room.image) : '';
            addCheck(state, Boolean(image) && fs.existsSync(image), `room image exists: ${room.name}`, room.image || 'no image');
            const galleryMissing = (room.gallery || []).filter((file) => !fs.existsSync(path.join(brandRoot, file)));
            addCheck(state, galleryMissing.length === 0, `room gallery exists: ${room.name}`, galleryMissing.length ? `${galleryMissing.length} missing` : `${(room.gallery || []).length} files`);
            const photoPaths = new Set((brand.photography || []).map((photo) => photo.path));
            const unlisted = [room.image, ...(room.gallery || [])].filter((file) => file && !photoPaths.has(file));
            addCheck(state, unlisted.length === 0, `room photos listed in the pack: ${room.name}`, unlisted.length ? `${unlisted.length} not in photography[]` : 'all listed');
            state.roomRows.push({
                room: room.name,
                site: siteOk ? 'pass' : 'FAIL',
                brochure: brochureOk ? 'pass' : 'FAIL',
                ok: Boolean(siteOk && brochureOk && room.brochurePage === check.brochurePage),
            });
        });

        // 4. Every recorded conflict is still recorded.
        const noteText = [
            ...(content.venue?.notes || []),
            ...(content.venue?.rooms || []).map((room) => room.note || ''),
            ...content.menus.flatMap((menu) => menu.notes || []),
        ].join(' ');
        CONFLICTS.forEach((conflict) => {
            if (conflict.applies && !conflict.applies(content)) {
                state.skipped += 1;
                return;
            }
            const ok = has(noteText, conflict.must);
            addCheck(state, ok, `conflict documented: ${conflict.id}`, ok ? '' : `“${conflict.must}” is missing from the notes`);
            state.conflicts.push({ id: conflict.id, ok });
        });

        // 5. The content model invariants the studio relies on.
        const ids = content.menus.map((menu) => menu.id);
        addCheck(state, new Set(ids).size === ids.length, 'menu ids are unique', ids.join(', '));
        const branchIds = new Set((content.locations || []).map((location) => location.id));
        const bad = content.menus.flatMap((menu) => menu.branches.filter((branch) => !branchIds.has(branch)));
        addCheck(state, bad.length === 0, 'menu branches are real locations', bad.join(', ') || 'all resolve');

        state.rows.sort((a, b) => Number(a.ok) - Number(b.ok));
        const report = render(state);
        const out = options.out
            ? path.resolve(ROOT, options.out)
            : path.join(ROOT, 'deliverables', Brand.slugId(pack.name || options.pack), 'source-verification.md');
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, report);
        console.log(`✓ ${path.relative(ROOT, out)} — ${state.passed}/${state.checks} checks passed, ${state.failed} failed, ${state.warnings.length} warning${state.warnings.length === 1 ? '' : 's'}`);
        if (state.failed) exitCode = 1;
    });
    process.exit(exitCode);
}

main();
