'use strict';
/**
 * Regression checks for the crawler's pure helpers.
 *
 * These run the Python module in-process (no network, no crawl) because the
 * defects they cover were silent: press logos filled the logo slot, SVG
 * wordmarks were downloaded and then deleted, and every venue without an
 * explicit country was assumed to be in the UK.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'crawler-combined.py');

function pythonBinary() {
    const venv = path.join(ROOT, '.venv', 'bin', 'python');
    return fs.existsSync(venv) ? venv : 'python3';
}

const PROBE = `
import importlib.util, json, sys, tempfile, os
spec = importlib.util.spec_from_file_location("crawler", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
sys.modules["crawler"] = mod
spec.loader.exec_module(mod)

out = {}
out["countries"] = {
    "lisbon": mod.country_from_address("1200-058 Lisboa, Portugal"),
    "dict": mod.country_from_address({"full": "Rua Augusta 100, Porto, Portugal"}),
    "uk": mod.country_from_address("12 Market St, St Andrews, Fife, KY16 9NS"),
    "ni": mod.country_from_address("Belfast, Northern Ireland"),
    "unknown": mod.country_from_address(""),
}
out["phones"] = {
    "pt": mod.normalize_phone("(41) 99279-7895", "Portugal"),
    "uk": mod.normalize_phone("01334 123456"),
}
out["press"] = {
    "exame": mod.is_press_logo("exame-formated"),
    "logo": mod.is_press_logo("logo-primary"),
}

svg = os.path.join(tempfile.mkdtemp(), "mark.svg")
with open(svg, "w") as fh:
    fh.write('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" '
             'viewBox="0 0 240 60" onload="alert(1)"><script>alert(2)</script>'
             '<rect width="240" height="60"/></svg>')
out["svg"] = {
    "info": list(mod.get_image_info(svg)),
    "sniff": mod.looks_like_svg(svg),
    "not_html": mod.looks_like_svg(sys.argv[2]),
}
mod.clean_svg_file(svg)
out["svg"]["cleaned"] = open(svg).read()

from bs4 import BeautifulSoup
html = """
<html><body>
<header id="site-header"><a href="/"><img src="/layout/logo.svg" alt="Brand logo"></a></header>
<section class="press-logos">
  <a href="https://exame.com"><img src="/press/exame.jpg" alt="Exame logo"></a>
  <a href="https://vogue.com"><img src="/press/vogue.jpg" alt="Vogue logo"></a>
  <a href="https://veja.com"><img src="/press/veja.jpg" alt="Veja logo"></a>
  <a href="https://forbes.com"><img src="/press/forbes.jpg" alt="Forbes logo"></a>
</section>
<footer><a href="https://ukio.com"><img src="/partners/ukio.jpg" alt="Ukio logo"></a></footer>
</body></html>
"""
soup = BeautifulSoup(html, "html.parser")
cands = mod.extract_logo_candidates(soup, "https://thecoffee.jp/")
out["logo_urls"] = [c["url"] for c in cands]
out["logo_in_nav"] = [c["in_nav"] for c in cands]

# A targets.json written by an older build still says "United Kingdom"; the
# address on file has to win, or --report-only republishes UK-only lookups.
out["target_country"] = {
    "prefers_address": mod.resolve_target_country({
        "country": "United Kingdom",
        "hints": {"address": "Rua de S. Paulo 81, 1200-058 Lisboa, Portugal"},
    }),
    "keeps_declared": mod.resolve_target_country({"country": "United Kingdom"}),
}


class Ctx:
    pass


ctx = Ctx()
ctx.country = "Portugal"
ctx.results = {"food_hygiene": {
    "source": "food_hygiene", "mode": "fsa-api", "ok": True,
    "url": "https://ratings.food.gov.uk/business/en-GB/749385",
    "compliance": {"rating": "5"},
}}
mod.drop_offshore_results(ctx)
cached = ctx.results["food_hygiene"]
out["offshore"] = {
    "url": cached.get("url"),
    "reason": (cached.get("metrics") or {}).get("skipped_reason"),
    "compliance": cached.get("compliance"),
}
print(json.dumps(out))
`;

function runProbe(code = PROBE) {
    const result = spawnSync(
        pythonBinary(),
        ['-c', code, SCRIPT, path.join(ROOT, 'pages', 'crawler.html')],
        { cwd: ROOT, encoding: 'utf8', timeout: 60000 },
    );
    if (result.error) return { skip: `python unavailable: ${result.error.message}` };
    if (result.status !== 0) {
        const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
        if (/ModuleNotFoundError/.test(detail)) return { skip: detail.split('\n').pop() };
        return { error: detail };
    }
    const line = result.stdout.trim().split('\n').pop();
    return { data: JSON.parse(line) };
}

const probe = runProbe();

test('python crawler helpers: press logos, SVG passthrough, country', (t) => {
    if (probe.skip) {
        t.skip(probe.skip);
        return;
    }
    assert.equal(probe.error, undefined, probe.error);

    assert.equal(probe.data.countries.lisbon, 'Portugal');
    assert.equal(probe.data.countries.dict, 'Portugal');
    assert.equal(probe.data.countries.uk, 'United Kingdom');
    assert.equal(probe.data.countries.ni, 'United Kingdom');
    assert.equal(probe.data.countries.unknown, '');

    assert.equal(probe.data.phones.pt, '(41) 99279-7895');
    assert.equal(probe.data.phones.uk, '01334123456');

    assert.equal(probe.data.press.exame, true);
    assert.equal(probe.data.press.logo, false);

    assert.deepEqual(probe.data.svg.info, [240, 60, 'SVG']);
    assert.equal(probe.data.svg.sniff, true);
    assert.equal(probe.data.svg.not_html, false);
    assert.ok(!/script|onload/i.test(probe.data.svg.cleaned),
        'downloaded SVG is stripped of scriptable content');
    assert.match(probe.data.svg.cleaned, /width="240"/);

    assert.deepEqual(probe.data.logo_urls, ['https://thecoffee.jp/layout/logo.svg']);
    assert.deepEqual(probe.data.logo_in_nav, [true]);

    assert.equal(probe.data.target_country.prefers_address, 'Portugal');
    assert.equal(probe.data.target_country.keeps_declared, 'United Kingdom');

    assert.equal(probe.data.offshore.url, null,
        'a cached UK rating is dropped for a non-UK venue');
    assert.equal(probe.data.offshore.compliance, null);
    assert.match(probe.data.offshore.reason, /UK-only source dropped/);
});

/**
 * P1: profile URLs were used verbatim, `ok` alone counted as presence, and the
 * report never explained why `collected_reviews` was smaller than the sum of
 * the per-source counts.
 */
const PROBE_P1 = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("crawler", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
sys.modules["crawler"] = mod
spec.loader.exec_module(mod)

out = {}
out["canonical"] = {
    "youtube_bare": mod.canonical_profile_url("youtube", "https://www.youtube.com/thecoffeejp"),
    "youtube_handle": mod.canonical_profile_url(
        "youtube", "https://youtube.com/@thecoffeejp?si=abc"),
    "youtube_channel": mod.canonical_profile_url(
        "youtube", "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"),
    "youtube_legacy": mod.canonical_profile_url("youtube", "https://www.youtube.com/c/TheCoffeeJP"),
    "youtube_watch": mod.canonical_profile_url("youtube", "https://www.youtube.com/watch?v=abc"),
    "instagram": mod.canonical_profile_url(
        "instagram", "https://www.instagram.com/thecoffee.jp/?hl=en&igshid=xyz"),
    "instagram_post": mod.canonical_profile_url("instagram", "https://www.instagram.com/p/Cabc123/"),
    "linkedin_posts": mod.canonical_profile_url(
        "linkedin", "https://www.linkedin.com/company/the-coffee-jp/posts/?trk=abc"),
    "facebook_id": mod.canonical_profile_url(
        "facebook", "https://www.facebook.com/profile.php?id=100012345"),
    "maps": mod.canonical_profile_url(
        "google", "https://www.google.com/maps/search/The+Coffee?hl=en&gl=pt&utm_source=x"),
}

results = {
    "instagram": {"ok": True, "profile": {"handle": "thecoffee", "followers": 250000}},
    "tiktok": {"ok": True, "profile": {}},
    "linkedin": {"ok": True, "profile": {"handle": "the-coffee-jp", "followers": 44941}},
    "youtube": {"ok": False, "url": "https://www.youtube.com/@gone",
                "warnings": ["channel unreachable: HTTP 404 not found"]},
}
social = mod.analyze_social(results)
out["presence"] = sorted(row["source"] for row in social["matrix"] if row["present"])
out["gaps"] = social["gaps"]
out["not_discovered"] = social["not_discovered"]
out["platforms_present"] = social["totals"]["platforms_present"]

rep = mod.aggregate_reviews({
    "google": {"label": "Google", "rating": {"value": 4.8, "count": 1449},
               "reviews": [{"author": "Ana", "text": "Great coffee and lovely staff",
                            "rating": 5},
                           {"author": "Ana", "text": "Great coffee and lovely staff",
                            "rating": 5}]},
})
out["dedupe"] = {"collected": rep["collected_reviews"], "raw": rep["collected_raw"],
                 "merged": rep["duplicates_merged"]}

out["flags"] = {"videos": mod.DOWNLOAD_VIDEOS, "photos": mod.MAX_CURATED_PHOTOS,
                "logos": mod.MAX_CURATED_LOGOS}
out["locale"] = {"pt": mod.COUNTRY_LOCALE["Portugal"], "gb": mod.COUNTRY_LOCALE["United Kingdom"]}
print(json.dumps(out))
`;

const probeP1 = runProbe(PROBE_P1);

test('python crawler helpers: canonical URLs, presence, dedupe', (t) => {
    if (probeP1.skip) {
        t.skip(probeP1.skip);
        return;
    }
    assert.equal(probeP1.error, undefined, probeP1.error);
    const { canonical, presence, gaps, not_discovered: notDiscovered, dedupe, flags, locale } =
        probeP1.data;

    assert.equal(canonical.youtube_bare, 'https://www.youtube.com/@thecoffeejp');
    assert.equal(canonical.youtube_handle, 'https://www.youtube.com/@thecoffeejp');
    assert.equal(canonical.youtube_channel,
        'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv');
    assert.equal(canonical.youtube_legacy, 'https://www.youtube.com/c/TheCoffeeJP',
        'legacy vanity paths are not rewritten into @handles that 404');
    assert.equal(canonical.youtube_watch, 'https://www.youtube.com/watch?v=abc');
    assert.equal(canonical.instagram, 'https://www.instagram.com/thecoffee.jp/');
    assert.equal(canonical.instagram_post, 'https://www.instagram.com/p/Cabc123');
    assert.equal(canonical.linkedin_posts, 'https://www.linkedin.com/company/the-coffee-jp/');
    assert.equal(canonical.facebook_id, 'https://www.facebook.com/profile.php?id=100012345');
    assert.equal(canonical.maps,
        'https://www.google.com/maps/search/The+Coffee?hl=en&gl=pt');

    assert.deepEqual(presence, ['instagram', 'linkedin'],
        'a fetched-but-empty profile is not presence');
    assert.deepEqual(gaps, ['tiktok', 'youtube']);
    assert.deepEqual(notDiscovered, ['facebook']);
    assert.equal(probeP1.data.platforms_present, 2);

    assert.deepEqual(dedupe, { collected: 1, raw: 2, merged: 1 });

    assert.equal(flags.videos, false, 'videos are opt-in');
    assert.equal(flags.photos, 12);
    assert.equal(flags.logos, 3);
    assert.deepEqual(locale.pt, ['pt', 'pt']);
    assert.deepEqual(locale.gb, ['en', 'gb']);
});
