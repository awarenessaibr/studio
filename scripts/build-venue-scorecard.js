#!/usr/bin/env node
'use strict';
/**
 * build-venue-scorecard.js — one A4 page per venue, built from the pack.
 *
 * The page is deliberately boring and specific: what the numbers are, how big
 * the sample is, and what to do next. Every figure is read from the venue's
 * `business.profile.json`; nothing is retyped, and every sampled number carries
 * its sample size so an owner cannot mistake 48 reviews for 6,969.
 *
 * Usage
 *   node scripts/build-venue-scorecard.js --pack <packId> --venue <venueId> --out <dir>
 *   node scripts/build-venue-scorecard.js --pack … --venue … --out … --pdf
 *
 * With --pdf it prints the HTML to PDF through the local Chrome. Without it,
 * the HTML is written and the command to print it is echoed.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PACKS = path.join(ROOT, 'data', 'brand-packs');
const CHROME_CANDIDATES = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
];

function arg(name, fallback = '') {
    const index = process.argv.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const next = process.argv[index + 1];
    return next && !next.startsWith('--') ? next : true;
}

const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = (value, digits = 0) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const CHANNEL_LABELS = { tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram' };
const hcase = (value) => {
    const key = String(value || '').toLowerCase();
    return CHANNEL_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1));
};

const pct = (value) => (Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : '—');

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The venue's one-line format description, from the portfolio guide's table. */
function venueDescription(pack, brand) {
    const sections = pack?.portfolio?.guidelines?.sections || [];
    for (const section of sections) {
        for (const table of section.tables || []) {
            const head = (table.head || []).map((cell) => String(cell).toUpperCase());
            if (!head.includes('VENUE') || !head.includes('FORMAT')) continue;
            const vi = head.indexOf('VENUE');
            const fi = head.indexOf('FORMAT');
            for (const row of table.rows || []) {
                if (String(row[vi] || '').toLowerCase() === String(brand.name || '').toLowerCase()) {
                    return String(row[fi] || '');
                }
            }
        }
    }
    return brand.tagline || '';
}

function dataUri(file, mime) {
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function findChrome() {
    for (const candidate of CHROME_CANDIDATES) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function buildHtml({ brand, profile, pack, wordmark, font }) {
    const p = profile;
    const palette = brand.palette || [];
    const accent = palette[0]?.hex || '#055768';
    const grey = palette.find((c) => /cawley grey/i.test(c.name || ''))?.hex || '#A5B0B7';
    const ink = palette.find((c) => /ink/i.test(c.name || ''))?.hex || '#3D3E3E';

    const scores = p.scores || {};
    const rep = p.reputation || {};
    const social = p.social || {};
    const web = p.web || {};
    const compliance = p.compliance || {};
    const sources = Object.entries(rep.sources || {}).filter(([, s]) => s && (s.rating || s.count));
    const collected = Number(rep.collected_reviews) || 0;
    const total = Number(rep.total_reviews) || 0;
    const matrix = (social.matrix || []).filter((m) => m && m.present);
    const followers = Number((social.totals || {}).followers) || 0;
    const themes = Object.entries(rep.themes || {})
        .map(([name, t]) => ({ name, ...t }))
        .sort((a, b) => (b.mentions || 0) - (a.mentions || 0))
        .slice(0, 6);
    const conflicts = (p.identity || {}).conflicts || [];
    const latest = social.latest_activity || '';
    const stale = (social.stale_platforms || []).map(hcase).join(', ');

    const scoreTiles = [
        ['Overall', scores.overall],
        ['Reputation', scores.reputation],
        ['Social', scores.social_strength],
        ['Content', scores.content_health],
        ['Discoverability', scores.discoverability],
    ].map(([label, value]) => `
        <div class="tile"><div class="tile-n">${num(value)}</div><div class="tile-l">${esc(label)}</div></div>`)
        .join('');

    const sourceRows = sources.map(([, s]) => `
        <tr>
            <td>${esc(s.label)}</td>
            <td class="r">${s.rating ? num(s.rating, 1) : '—'}</td>
            <td class="r">${s.count ? num(s.count) : '—'}</td>
        </tr>`).join('');

    const dist = rep.distribution || {};
    const distTotal = ['5', '4', '3', '2', '1'].reduce((sum, key) => sum + (Number(dist[key]) || 0), 0) || 1;
    const distBar = ['5', '4', '3', '2', '1'].map((star) => {
        const count = Number(dist[star]) || 0;
        const share = Math.round((count / distTotal) * 100);
        return `<div class="dist-row">
            <span class="dist-star">${star}★</span>
            <span class="dist-track"><span class="dist-fill" style="width:${share}%"></span></span>
            <span class="dist-count">${count}</span>
        </div>`;
    }).join('');

    const themeRows = themes.map((t) => {
        const pos = Number(t.positive) || 0;
        const neg = Number(t.negative) || 0;
        const net = pos + neg ? Math.round((pos / (pos + neg)) * 100) : 0;
        const colour = net >= 65 ? '#1E7A4B' : net >= 50 ? '#B06B00' : '#B3261E';
        return `<div class="theme">
            <span class="theme-name">${esc(t.name)}</span>
            <span class="theme-track"><span class="theme-fill" style="width:${net}%;background:${colour}"></span></span>
            <span class="theme-score" style="color:${colour}">${net}%</span>
            <span class="theme-mentions">${t.mentions} mentions</span>
        </div>`;
    }).join('');

    const channelRows = matrix.map((m) => `
        <tr>
            <td>${esc(m.label)}</td>
            <td class="r">${m.followers ? num(m.followers) : '—'}</td>
            <td class="r small">${m.last_post ? String(m.last_post).slice(0, 10) : '—'}</td>
        </tr>`).join('');

    const actions = [];
    if (Number(rep.owner_response_rate) < 0.5) {
        actions.push([
            'Reply to recent reviews',
            `${pct(rep.owner_response_rate)} of the ${collected} reviews read have a reply. `
            + 'Pick a weekly slot and answer the last twenty. The number to move is coverage, not sentiment.',
        ]);
    }
    if (latest && /^\d{4}/.test(latest)) {
        actions.push([
            'Restart the social calendar',
            `${num(followers)} followers across ${matrix.length} platforms, and the last recorded activity is ${esc(latest)}.`
            + (stale ? ` Stale: ${esc(stale)}.` : ''),
        ]);
    }
    if (conflicts.length) {
        const detail = conflicts.map((c) => {
            const variants = (c.variants || []).filter(Boolean);
            return `${c.field}: ${variants.length} variants`;
        }).join('; ');
        actions.push(['Resolve the contact data',
            `${detail}. A guest comparing two pages can see the contradiction; one canonical record removes it.`]);
    }
    // A page with one action looks unfinished. Fill from facts already on the
    // page, never from a promise: a channel decision and a split theme are both
    // observable states, not forecasts.
    if (actions.length < 3 && (social.gaps || []).length) {
        actions.push(['Decide on the missing channels',
            `No presence found on ${social.gaps.map(hcase).join(', ')}. That is a decision to take or leave, not a gap to apologise for.`]);
    }
    if (actions.length < 3 && themes.length) {
        const split = themes
            .map((t) => {
                const pos = Number(t.positive) || 0;
                const neg = Number(t.negative) || 0;
                return { name: t.name, mentions: t.mentions || 0, net: pos + neg ? pos / (pos + neg) : 1 };
            })
            .filter((t) => t.mentions >= 5)
            .sort((a, b) => a.net - b.net)[0];
        if (split && split.net < 0.6) {
            actions.push(['The theme guests are split on',
                `${hcase(split.name)} sits at ${Math.round(split.net * 100)}% across ${split.mentions} mentions — `
                + 'the lowest of the themes with enough volume to read.']);
        }
    }

    const consulted = Object.entries(rep.sources || {})
        .filter(([, s]) => s && (s.rating || s.count || s.url))
        .map(([, s]) => `${s.label}${s.count ? ` · ${num(s.count)}` : ''}`);
    const notFound = Object.entries(p.provenance?.sources || {})
        .filter(([, s]) => s && !s.ok && !s.url)
        .map(([key]) => key);

    const trend = rep.velocity || {};
    const recent = Number(trend.recent_avg_rating);
    const older = Number(trend.older_avg_rating);
    const trendText = Number.isFinite(recent) && Number.isFinite(older)
        ? `${recent.toFixed(2)} recent vs ${older.toFixed(2)} older`
        : '—';

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(brand.name)} — venue scorecard</title>
<style>
@font-face{font-family:Mulish;src:url(${font}) format('truetype');font-weight:100 1000;}
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:Mulish,'Helvetica Neue',Arial,sans-serif;color:${ink};background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;padding:12mm 12mm 10mm;display:flex;flex-direction:column;gap:5mm;justify-content:space-between}
header{background:${accent};color:#fff;border-radius:2mm;padding:6mm 7mm;display:flex;align-items:flex-end;justify-content:space-between}
header img{height:9mm;display:block}
header .meta{text-align:right;font-size:7.4pt;line-height:1.5;opacity:.9;letter-spacing:.04em;text-transform:uppercase}
h1{font-size:15pt;margin:0;font-weight:700;letter-spacing:-.01em}
.sub{color:#6E6E6E;font-size:8.6pt;margin-top:1mm;line-height:1.45}
.scores{display:flex;gap:2mm}
.tile{flex:1;border:.3mm solid #E4E4E0;border-radius:1.6mm;padding:2.4mm 3mm}
.tile-n{font-size:14pt;font-weight:700;line-height:1;color:${accent}}
.tile-l{font-size:6.6pt;text-transform:uppercase;letter-spacing:.09em;color:#8A8A86;margin-top:1.4mm}
.cols{display:flex;gap:6mm}
.col{flex:1;min-width:0}
h2{font-size:8pt;text-transform:uppercase;letter-spacing:.11em;color:#8A8A86;margin:0 0 2mm;font-weight:700}
table{width:100%;border-collapse:collapse;font-size:8.4pt}
td{padding:1.1mm 0;border-bottom:.2mm solid #EEEEEA}
td.r{text-align:right;font-variant-numeric:tabular-nums}
td.small{font-size:7.4pt;color:#6E6E6E}
.big{font-size:21pt;font-weight:700;line-height:1;color:${ink}}
.big small{font-size:8pt;font-weight:400;color:#8A8A86;margin-left:2mm}
.note{font-size:7.2pt;color:#8A8A86;margin-top:1.6mm;line-height:1.5}
.dist-row{display:flex;align-items:center;gap:2mm;font-size:7.6pt;margin-bottom:1mm}
.dist-star{width:7mm;color:#6E6E6E}
.dist-track{flex:1;height:2.2mm;background:#F0F0EC;border-radius:1mm;overflow:hidden}
.dist-fill{display:block;height:100%;background:${accent}}
.dist-count{width:7mm;text-align:right;font-variant-numeric:tabular-nums}
.theme{display:flex;align-items:center;gap:2mm;font-size:7.8pt;margin-bottom:1.5mm}
.theme-name{width:26mm;text-transform:capitalize}
.theme-track{flex:1;height:2mm;background:#F0F0EC;border-radius:1mm;overflow:hidden}
.theme-fill{display:block;height:100%}
.theme-score{width:9mm;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
.theme-mentions{width:20mm;text-align:right;color:#8A8A86;font-size:7pt}
.actions{display:flex;gap:4mm}
.action{flex:1;border-left:.8mm solid ${accent};padding-left:3.4mm}
.action b{display:block;font-size:8.6pt;margin-bottom:1mm}
.action span{font-size:7.4pt;color:#6E6E6E;line-height:1.5}
footer{margin-top:0;border-top:.2mm solid #E4E4E0;padding-top:2mm;display:flex;justify-content:space-between;font-size:6.8pt;color:#8A8A86}
.flag{color:#B3261E;font-weight:700}
.chips{display:flex;flex-wrap:wrap;gap:1.6mm}
.chip{border:.25mm solid #E4E4E0;border-radius:1.2mm;padding:1.2mm 2.4mm;font-size:7.4pt;color:#4A4A46}
th{text-align:left;font-size:6.6pt;text-transform:uppercase;letter-spacing:.09em;color:#8A8A86;font-weight:700;padding:0 0 1mm;border-bottom:.2mm solid #E4E4E0}
th.r{text-align:right}
</style></head>
<body><div class="page">

<header>
    <img src="${wordmark}" alt="${esc(brand.name)}">
    <div class="meta">Venue intelligence<br>Prepared ${esc((p.generated_at || '').slice(0, 10))}</div>
</header>

<div>
    <h1>${esc(brand.name)}${p.business?.city ? `, ${esc(p.business.city)}` : ''}</h1>
    <div class="sub">${esc(venueDescription(pack, brand))}</div>
</div>

<div class="scores">${scoreTiles}</div>

<div class="cols">
    <div class="col">
        <h2>Reputation</h2>
        <div class="big">${num(rep.consensus_rating, 1)}<small>consensus of ${num(total)} reviews</small></div>
        <table>
            <thead><tr><th>Source</th><th class="r">Rating</th><th class="r">Reviews</th></tr></thead>
            <tbody>${sourceRows}</tbody>
        </table>
        <div class="note">Trend ${esc(trendText)} · ${num(collected)} reviews read in full
            (${total ? Math.round((collected / total) * 100) : 0}% of the total)${Number(rep.rating_disagreement) > 0
            ? ` · ${num(rep.rating_disagreement, 1)} point spread between platforms` : ''}</div>
        <h2 style="margin-top:4mm">Rating distribution</h2>
        ${distBar}
        <div class="note">${num(collected)} sampled reviews. The ${num(total)} total is the headline; this sample is what the themes are drawn from.</div>
    </div>

    <div class="col">
        <h2>Social</h2>
        <div class="big">${num(followers)}<small>followers</small></div>
        <table><thead><tr><th>Channel</th><th class="r">Followers</th><th class="r">Last post</th></tr></thead>
            <tbody>${channelRows}</tbody></table>
        <div class="note">Last recorded activity ${esc(latest || '—')}${stale ? ` · <span class="flag">stale: ${esc(stale)}</span>` : ''}
            ${(social.gaps || []).length ? ` · no presence on ${esc(social.gaps.map(hcase).join(', '))}` : ''}</div>

        <h2 style="margin-top:4mm">Web &amp; compliance</h2>
        <table><tbody>
            <tr><td>Online booking</td><td class="r">${web.has_online_booking ? esc((web.booking_providers || []).join(', ') || 'yes') : 'none detected'}</td></tr>
            <tr><td>Menu online</td><td class="r">${web.has_menu_online ? 'yes' : 'no'}</td></tr>
            <tr><td>Pages read</td><td class="r">${num(web.pages_crawled)}</td></tr>
            <tr><td>${esc(compliance.scheme || 'Hygiene')}</td><td class="r">${esc(compliance.rating || '—')}${compliance.inspection_date ? ` · ${esc(String(compliance.inspection_date).slice(0, 10))}` : ''}</td></tr>
        </tbody></table>
        <div class="note">Owner response rate ${pct(rep.owner_response_rate)}.${conflicts.length ? ' Contact data disagrees across sources.' : ''}</div>
    </div>
</div>

<div>
    <h2>What guests talk about</h2>
    ${themeRows}
</div>

<div>
    <h2>Evidence base</h2>
    <div class="chips">
        ${consulted.map((item) => `<span class="chip">${esc(item)}</span>`).join('')}
        <span class="chip">Website · ${num(web.pages_crawled)} pages</span>
        ${(compliance.scheme ? `<span class="chip">${esc(compliance.scheme)} · ${esc(compliance.rating || '')}</span>` : '')}
    </div>
    <div class="note">${notFound.length
        ? `Searched, no profile found: ${esc(notFound.slice(0, 4).join(', '))}`
          + `${notFound.length > 4 ? ` and ${notFound.length - 4} others` : ''}. `
          + 'That is a discovery gap at our end, not a platform gap.'
        : 'Every source searched returned a profile.'}</div>
</div>

<div>
    <h2>Where the next hour goes</h2>
    <div class="actions">
        ${actions.slice(0, 3).map(([title, body], index) => `
        <div class="action"><b>${index + 1}. ${esc(title)}</b><span>${esc(body)}</span></div>`).join('')}
    </div>
</div>

<footer>
    <span>Prepared from publicly available business information. No client-supplied data was used.</span>
    <span>${esc(p.schema_version || 'v2.0')} · ${num(collected)}/${num(total)} reviews sampled</span>
</footer>

</div></body></html>`;
}

function main() {
    const packId = arg('pack');
    const venueId = arg('venue');
    const outDir = arg('out', 'deliverables');
    const wantPdf = process.argv.includes('--pdf');
    if (!packId || !venueId) {
        console.error('Usage: node scripts/build-venue-scorecard.js --pack <packId> --venue <venueId> --out <dir> [--pdf]');
        process.exit(2);
    }

    const packDir = path.join(PACKS, packId);
    const pack = readJson(path.join(packDir, 'pack.json')).pack;
    const brand = (pack.brands || []).find((b) => b.id === venueId);
    if (!brand) {
        console.error(`No brand "${venueId}" in ${packId}. Have: ${(pack.brands || []).map((b) => b.id).join(', ')}`);
        process.exit(2);
    }

    const profileFile = path.join(packDir, 'files', venueId, 'social', 'business.profile.json');
    if (!fs.existsSync(profileFile)) {
        console.error(`No social profile for ${venueId}: ${profileFile}`);
        process.exit(2);
    }
    const profile = readJson(profileFile);

    const markFile = path.join(packDir, 'files', venueId, 'assets', 'logos', `${venueId}-wordmark-white.png`);
    const inkMark = path.join(packDir, 'files', venueId, 'assets', 'logos', `${venueId}-wordmark-ink.png`);
    const mark = fs.existsSync(markFile) ? markFile : inkMark;
    if (!fs.existsSync(mark)) {
        console.error(`No wordmark for ${venueId}.`);
        process.exit(2);
    }
    const fontFile = path.join(ROOT, 'data', 'fonts', 'mulish-7ff882.ttf');
    const font = fs.existsSync(fontFile) ? dataUri(fontFile, 'font/ttf') : '';

    const html = buildHtml({
        brand, profile, pack,
        wordmark: dataUri(mark, 'image/png'),
        font: font || 'data:font/ttf;base64,',
    });

    const dir = path.resolve(ROOT, String(outDir));
    fs.mkdirSync(dir, { recursive: true });
    const htmlFile = path.join(dir, `${venueId}-one-pager.html`);
    fs.writeFileSync(htmlFile, html);
    console.log(`wrote ${path.relative(ROOT, htmlFile)}`);

    if (!wantPdf) return;
    const chrome = findChrome();
    if (!chrome) {
        console.log('Chrome not found — open the HTML and print to A4 PDF.');
        return;
    }
    const pdfFile = path.join(dir, `${venueId}-one-pager.pdf`);
    const base = [
        '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
        `--print-to-pdf=${pdfFile}`, `file://${htmlFile}`,
    ];
    // Sandboxed environments deny Chrome its profile and crash directories
    // outside the workspace. Retry with those writes redirected and the
    // renderer's own sandbox off; the first attempt stays the safe default.
    const scratch = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'scorecard-chrome-'));
    const fallback = [
        '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
        '--no-sandbox', '--disable-breakpad', '--disable-crash-reporter',
        '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${path.join(scratch, 'profile')}`,
        `--crash-dumps-dir=${scratch}`,
        `--print-to-pdf=${pdfFile}`, `file://${htmlFile}`,
    ];
    try {
        execFileSync(chrome, base, { stdio: 'ignore' });
    } catch {
        try {
            execFileSync(chrome, fallback, { stdio: 'ignore' });
        } catch (error) {
            console.error('Chrome could not print the PDF. Open the HTML and print to A4.');
            return;
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    }
    const kb = Math.round(fs.statSync(pdfFile).size / 1024);
    console.log(`wrote ${path.relative(ROOT, pdfFile)} (${kb} kB)`);
}

main();
