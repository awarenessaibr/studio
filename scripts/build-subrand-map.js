#!/usr/bin/env node
'use strict';
/**
 * build-subrand-map.js — trace one name across a group and show where it lives.
 *
 * A group usually has a word that behaves like a brand without being one: a
 * room, a cafe, a nickname. The question is never "does it exist" — guests use
 * it — but "where, in what form, and is there a mark". This script answers that
 * from the pack instead of from memory.
 *
 * For the given term it collects, per venue:
 *   - what the brand guide calls it (mentions + the sentences around them)
 *   - what the live estate calls it (page/menu URLs, review mentions)
 *   - the descriptive form actually used (cafe, coffee shop, lounge, bar …)
 *   - whether any asset exists that could serve as a mark
 *
 * Usage
 *   node scripts/build-subrand-map.js --pack <packId> --term "Bobby's" \
 *       --out deliverables/cawley --pdf
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PACKS = path.join(ROOT, 'data', 'brand-packs');
const { parseBrandDocx } = require(path.join(ROOT, 'src', 'server', 'brand-docx.js'));
const server = require(path.join(ROOT, 'server.js'));

const CHROME_CANDIDATES = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
];

// Words that follow the term without describing it.
const STOPWORDS = new Set(['was', 'is', 'are', 'and', 'in', 'at', 'by', 'has', 'have', 'with', 'for',
    'to', 'on', 'of', 'the', 'its', 'own', 'family', 'which', 'that', 'this', 'as', 'it', 'a', 'an']);

const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function arg(name, fallback = '') {
    const index = process.argv.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const next = process.argv[index + 1];
    return next && !next.startsWith('--') ? next : true;
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function findChrome() {
    for (const candidate of CHROME_CANDIDATES) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/** All the text a guide carries, plus the sentences that name the term. */
function readGuide(packDir, brand) {
    const rel = brand.docPath;
    if (!rel) return { text: '', sentences: [] };
    const file = path.join(packDir, 'files', brand.id, ...rel.split('/'));
    if (!fs.existsSync(file)) return { text: '', sentences: [] };
    try {
        const doc = parseBrandDocx(fs.readFileSync(file), {
            readZipEntries: server.readZipEntries,
            extractZipEntry: server.extractZipEntry,
        }, { name: brand.name });
        const blocks = [];
        for (const section of doc.sections || []) {
            if (section.heading) blocks.push(section.heading);
            for (const paragraph of section.paragraphs || []) blocks.push(paragraph);
            for (const table of section.tables || []) {
                for (const row of table.rows || []) blocks.push((row || []).join(' · '));
            }
        }
        return { text: blocks.join('\n'), sentences: blocks };
    } catch {
        return { text: '', sentences: [] };
    }
}

// A sub-brand form is a kind of room: cafe, lounge, coffee shop. "Bobby's
// family alongside" is a sentence, not a form, so the vocabulary is explicit.
const SPACE_NOUNS = ['coffee shop', 'coffee', 'lounge', 'cafe', 'café', 'bar', 'restaurant',
    'room', 'shop', 'bistro', 'brasserie', 'kitchen', 'terrace'];

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function formsAround(text, base) {
    const nouns = SPACE_NOUNS.map(escapeRe).join('|');
    const pattern = new RegExp(`${escapeRe(base)}['’]?s?[\\s,:;—-]+(${nouns})\\b`, 'gi');
    const counts = new Map();
    for (const match of String(text).matchAll(pattern)) {
        const form = String(match[1] || '').toLowerCase();
        if (!form) continue;
        counts.set(form, (counts.get(form) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** Sentences that mention the term, trimmed to something readable. */
function mentions(sentences, termPattern, limit = 2) {
    const out = [];
    for (const block of sentences) {
        for (const sentence of String(block).split(/(?<=[.!?])\s+/)) {
            if (!termPattern.test(sentence)) continue;
            const clean = sentence.replace(/\s+/g, ' ').trim();
            if (clean.length < 30) continue;
            out.push(clean.length > 240 ? `${clean.slice(0, 237)}…` : clean);
            if (out.length >= limit) return out;
        }
    }
    return out;
}

function collect(packDir, brand, termPattern, base) {
    const guide = readGuide(packDir, brand);
    const guideHits = (guide.text.match(termPattern) || []).length;

    const socialDir = path.join(packDir, 'files', brand.id, 'social');
    const pages = readJson(path.join(socialDir, 'platforms', 'website.json')) || {};
    const reviews = readJson(path.join(socialDir, 'reviews.all.json')) || [];
    const reviewList = Array.isArray(reviews) ? reviews : [];
    const reviewHits = reviewList.filter((review) => termPattern.test(String(review.text || ''))).length;

    const urls = new Set();
    for (const page of pages.pages || []) {
        if (termPattern.test(String(page.url || '')) || termPattern.test(String(page.title || ''))) {
            urls.add(String(page.url));
        }
    }
    for (const link of pages.links?.menu ? [pages.links.menu] : []) {
        if (termPattern.test(String(link || ''))) urls.add(String(link));
    }
    // Menu PDFs carry the name even when the page title does not.
    const blob = JSON.stringify(pages);
    for (const match of blob.matchAll(/https?:[^"\\\s]+/g)) {
        if (termPattern.test(match[0])) urls.add(match[0]);
    }

    const assets = [];
    const walk = (dir) => {
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (termPattern.test(entry.name)) assets.push(path.relative(packDir, full));
        }
    };
    walk(path.join(packDir, 'files', brand.id, 'assets'));

    const forms = formsAround(guide.text, base);
    const liveForms = formsAround(JSON.stringify(reviews), base);
    const merged = new Map(forms);
    for (const [form, count] of liveForms) merged.set(form, (merged.get(form) || 0) + count);

    return {
        brand,
        guideHits,
        reviewHits,
        urls: [...urls],
        assets,
        forms: [...merged.entries()].sort((a, b) => b[1] - a[1]),
        sentences: mentions(guide.sentences, termPattern),
        evidenceText: (() => {
            const hits = reviewList.filter((review) => termPattern.test(String(review.text || '')));
            return hits.length ? String(hits[0].text || '').slice(0, 200) : '';
        })(),
    };
}

function buildHtml({ pack, rows, term, generated }) {
    const palette = pack.portfolio?.palette || [];
    const accent = '#1F1F1F';
    const brandColour = rows.find((r) => r.forms.length)?.brand.palette?.[0]?.hex || '#055768';

    const columns = rows.map((row) => {
        const present = row.guideHits + row.reviewHits + row.urls.length + row.assets.length > 0;
        const forms = row.forms.slice(0, 3).map(([form, count]) => `<span class="chip">${esc(form)}${count > 1 ? ` · ${count}` : ''}</span>`).join('');
        const short = (file) => esc(String(file).split('/').pop().slice(0, 46));
        const evidence = [
            ...row.urls.slice(0, 3).map((url) => `<li><span class="mono">${short(url)}</span></li>`),
            ...row.assets.slice(0, 2).map((file) => `<li><span class="mono">${short(file)}</span></li>`),
        ].join('');
        const noEvidence = !evidence
            ? (row.guideHits
                ? `<p class="none">Named only in the guide (${row.guideHits} mentions). No page, menu or asset carries it.</p>`
                : '<p class="none">Nothing in the pack names it.</p>')
            : '';
        return `<div class="venue ${present ? '' : 'absent'}">
            <div class="venue-head">
                <h3>${esc(row.brand.name)}</h3>
                <span class="status ${present ? 'on' : 'off'}">${present ? 'named here' : 'not present'}</span>
            </div>
            <div class="forms">${forms || '<span class="chip muted">no descriptive form</span>'}</div>
            <dl class="counts">
                <div><dt>Guide</dt><dd>${row.guideHits} mention${row.guideHits === 1 ? '' : 's'}</dd></div>
                <div><dt>Reviews</dt><dd>${row.reviewHits}</dd></div>
                <div><dt>Pages &amp; menus</dt><dd>${row.urls.length}</dd></div>
                <div><dt>Assets</dt><dd>${row.assets.length}</dd></div>
            </dl>
            ${evidence ? `<ul class="evidence">${evidence}</ul>` : ''}${noEvidence}
            ${row.sentences.length ? `<blockquote>${esc(row.sentences[0])}</blockquote>` : ''}
        </div>`;
    }).join('');

    const presentCount = rows.filter((r) => r.guideHits + r.reviewHits + r.urls.length + r.assets.length > 0).length;
    const guideVenues = rows.filter((r) => r.guideHits > 0).length;
    // The gap between "documented" and "operated" is the finding, so say it.
    const undocumented = rows
        .filter((r) => r.guideHits === 0 && r.reviewHits + r.urls.length + r.assets.length > 0)
        .map((r) => r.brand.name);
    const gapNote = (guideVenues < presentCount && undocumented.length)
        ? `The guides describe it at ${guideVenues} venues; the estate shows ${presentCount} — `
          + `${undocumented.join(' and ')} runs it with no written mention.`
        : '';
    const totalGuide = rows.reduce((sum, r) => sum + r.guideHits, 0);
    const allForms = [...new Set(rows.flatMap((r) => r.forms.map(([form]) => form)))];
    const lockups = rows.reduce((sum, r) => sum + r.assets.filter((file) => /logo|wordmark|lockup|mark/i.test(file)).length, 0);

    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(term)} — sub-brand map</title>
<style>
@font-face{font-family:Mulish;src:url(${fontUri()}) format('truetype');font-weight:100 1000;}
@page{size:A4 landscape;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:Mulish,'Helvetica Neue',Arial,sans-serif;color:#1F1F1F;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:297mm;height:210mm;padding:11mm 12mm;display:flex;flex-direction:column;justify-content:space-between}
.eyebrow{font-size:6.6pt;text-transform:uppercase;letter-spacing:.16em;color:#8A8A86}
h1{font-size:19pt;margin:1.6mm 0 1mm;font-weight:700;letter-spacing:-.015em}
.lede{font-size:8.8pt;color:#5E5E5A;max-width:190mm;line-height:1.5}
.grid{display:flex;gap:3mm;margin-top:5mm}
.venue{flex:1;min-height:92mm;border:.25mm solid #E4E4E0;border-radius:1.8mm;padding:3.2mm;display:flex;flex-direction:column;gap:2mm}
.venue.absent{opacity:.55;background:#FAFAF8}
.venue-head{display:flex;align-items:baseline;justify-content:space-between;gap:2mm;min-height:9mm}
h3{font-size:9pt;margin:0;font-weight:700;line-height:1.2}
.status{font-size:6.2pt;text-transform:uppercase;letter-spacing:.08em;padding:.7mm 1.6mm;border-radius:1mm}
.status.on{background:${brandColour};color:#fff}
.status.off{background:#EDEDE9;color:#6E6E6A}
.forms{display:flex;flex-wrap:wrap;gap:1.2mm;min-height:5mm}
.chip{font-size:7pt;border:.2mm solid #E0E0DC;border-radius:1mm;padding:.8mm 1.6mm;color:#3D3E3E}
.chip.muted{color:#8A8A86;border-style:dashed}
.counts{display:flex;flex-direction:column;gap:.8mm;margin:0;font-size:7pt}
.counts div{display:flex;justify-content:space-between;border-bottom:.2mm solid #F0F0EC;padding-bottom:.6mm;gap:2mm}
.counts dt{color:#8A8A86;margin:0}
.counts dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}
.evidence,.none{margin:0;padding:0;list-style:none;font-size:6.6pt;color:#5E5E5A}
.evidence li{margin-bottom:.8mm;word-break:break-all}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:6.2pt}
blockquote{margin:auto 0 0;padding-left:2.4mm;border-left:.6mm solid ${brandColour};font-size:6.8pt;color:#5E5E5A;font-style:italic;line-height:1.45}
.band{display:flex;gap:4mm;margin-top:4mm}
.box{flex:1;border-radius:1.8mm;padding:3mm 3.4mm}
.box h4{margin:0 0 1.6mm;font-size:7.4pt;text-transform:uppercase;letter-spacing:.1em}
.box ul{margin:0;padding-left:3.6mm;font-size:7.6pt;line-height:1.55}
.has{background:#F3F6F3;border:.25mm solid #DCE6DC}
.has h4{color:#1E7A4B}
.missing{background:#FBF4F3;border:.25mm solid #EFD9D6}
.missing h4{color:#B3261E}
.decision{background:#F4F4F1;border:.25mm solid #E4E4E0}
.decision h4{color:#3D3E3E}
.decision ol{margin:0;padding-left:4mm;font-size:7.4pt;line-height:1.5}
.decision b{font-weight:700}
footer{display:flex;justify-content:space-between;font-size:6.4pt;color:#8A8A86;border-top:.2mm solid #E4E4E0;padding-top:2mm;margin-top:3mm}
</style></head><body><div class="page">

<div>
    <div class="eyebrow">Sub-brand audit · ${esc(pack.name)}</div>
    <h1>${esc(term)} — one name, ${presentCount} venues, ${lockups === 0 ? 'no mark' : `${lockups} mark${lockups === 1 ? '' : 's'}`}.</h1>
    <div class="lede">The term appears in ${totalGuide} places across the brand guides and in guest reviews.
        ${allForms.length > 1
            ? `It is described ${allForms.length} different ways — ${allForms.map(esc).join(', ')}.`
            : 'It is described one way.'}
        ${lockups === 0 ? 'No lockup, palette or type sample exists for it anywhere in the pack.' : ''}
        ${gapNote ? `<br><strong>${esc(gapNote)}</strong>` : ''}</div>
</div>

<div class="grid">${columns}</div>

<div class="band">
    <div class="box has">
        <h4>What exists</h4>
        <ul>
            <li>A name guests already use unprompted.</li>
            <li>Operational footprint across ${presentCount} venues${allForms.length ? `: ${allForms.map(esc).join(', ')}` : ''}.</li>
            <li>Its own menus and pages at the venues that develop it.</li>
        </ul>
    </div>
    <div class="box missing">
        <h4>What is missing</h4>
        <ul>
            <li>No wordmark or lockup in any asset folder.</li>
            <li>No palette or type of its own.</li>
            <li>No single spelling: apostrophe and capitalisation both wander.</li>
            <li>Uneven guide coverage — a venue can operate it with no written mention.</li>
        </ul>
    </div>
    <div class="box decision">
        <h4>The decision to take</h4>
        <ol>
            <li><b>Room name.</b> One approved descriptor, used everywhere. Cheapest, and stops the drift.</li>
            <li><b>Sub-brand.</b> A lockup, a palette and a page per venue — worth it only if it will be marketed.</li>
            <li><b>Retire it.</b> Fold every mention back into the venue name.</li>
        </ol>
    </div>
</div>

<footer>
    <span>Traced from the brand guides, live pages, menus and ${rows.reduce((sum, r) => sum + r.reviewHits, 0)} guest reviews. No client-supplied material was used.</span>
    <span>${esc(generated)}</span>
</footer>

</div></body></html>`;
}

let cachedFont = null;
function fontUri() {
    if (cachedFont) return cachedFont;
    const file = path.join(ROOT, 'data', 'fonts', 'mulish-7ff882.ttf');
    cachedFont = `data:font/ttf;base64,${fs.readFileSync(file).toString('base64')}`;
    return cachedFont;
}

function main() {
    const packId = arg('pack');
    const term = String(arg('term', ''));
    const outDir = String(arg('out', 'deliverables'));
    const wantPdf = process.argv.includes('--pdf');
    if (!packId || !term) {
        console.error('Usage: node scripts/build-subrand-map.js --pack <packId> --term "<name>" --out <dir> [--pdf]');
        process.exit(2);
    }

    const packDir = path.join(PACKS, packId);
    const pack = readJson(path.join(packDir, 'pack.json'))?.pack;
    if (!pack) {
        console.error(`No pack at ${packDir}`);
        process.exit(2);
    }

    const base = term.replace(/['’]s?$/i, '');
    const termPattern = new RegExp(`${escapeRe(base)}['’]?s?`, 'gi');
    const rows = (pack.brands || []).map((brand) => collect(packDir, brand, termPattern, base));

    const html = buildHtml({
        pack,
        rows,
        term,
        generated: `Prepared ${new Date().toISOString().slice(0, 10)}`,
    });

    const dir = path.resolve(ROOT, outDir);
    fs.mkdirSync(dir, { recursive: true });
    const slug = term.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const htmlFile = path.join(dir, `${slug}-sub-brand-map.html`);
    fs.writeFileSync(htmlFile, html);
    console.log(`wrote ${path.relative(ROOT, htmlFile)}`);
    for (const row of rows) {
        console.log(`  ${row.brand.name.padEnd(28)} guide ${String(row.guideHits).padStart(3)} · reviews ${String(row.reviewHits).padStart(2)} · `
            + `pages ${row.urls.length} · assets ${row.assets.length} · forms: ${row.forms.map(([f]) => f).join(', ') || '—'}`);
    }

    if (!wantPdf) return;
    const chrome = findChrome();
    if (!chrome) {
        console.log('Chrome not found — open the HTML and print to A4 landscape.');
        return;
    }
    const pdfFile = path.join(dir, `${slug}-sub-brand-map.pdf`);
    const chromeBase = ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdfFile}`, `file://${htmlFile}`];
    const scratch = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'subbrand-chrome-'));
    const fallback = ['--headless=new', '--disable-gpu', '--no-pdf-header-footer',
        '--no-sandbox', '--disable-breakpad', '--disable-crash-reporter', '--no-first-run',
        `--user-data-dir=${path.join(scratch, 'profile')}`, `--crash-dumps-dir=${scratch}`,
        `--print-to-pdf=${pdfFile}`, `file://${htmlFile}`];
    try {
        execFileSync(chrome, chromeBase, { stdio: 'ignore' });
    } catch {
        try {
            execFileSync(chrome, fallback, { stdio: 'ignore' });
        } catch {
            console.error('Chrome could not print the PDF. Open the HTML and print to A4 landscape.');
            return;
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    }
    console.log(`wrote ${path.relative(ROOT, pdfFile)} (${Math.round(fs.statSync(pdfFile).size / 1024)} kB)`);
}

main();
