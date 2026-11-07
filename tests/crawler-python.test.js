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

/**
 * P2: melano.com.br is a Vite/React build. The static crawl saw a 1.3 KB shell,
 * so the run reported success with one page, no logo, no photography and no
 * address. A shell must be recognised, its bundle assets harvested, decorative
 * header icons must stay out of the logo slot, and the HTML <address> block
 * must supply the postal address.
 */
const PROBE_P2 = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("crawler", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
sys.modules["crawler"] = mod
spec.loader.exec_module(mod)
from bs4 import BeautifulSoup

mod.configure_site("https://melano.com.br/")
out = {}

SHELL = """<!doctype html><html><head>
<link rel="icon" href="/favicon.png">
<script type="module" crossorigin src="/assets/index-CZrm7rxH.js"></script>
<link rel="stylesheet" href="/assets/index-DIBlNMOA.css">
</head><body><div id="root"></div></body></html>"""
out["shell_detected"] = mod.looks_like_js_shell(SHELL)
out["shell_bundles"] = mod._bundle_references(SHELL, "https://melano.com.br/")

RENDERED = """<!doctype html><html><body>
<header><nav>
<svg class="lucide lucide-menu" width="24" height="24" viewBox="0 0 24 24"><line x1="4" x2="20"/></svg>
<img src="/assets/logo-melano-L1W7aZ4g.png" alt="Melano Sorvetes - Logo" width="180" height="90">
</nav></header>
<footer>
<address class="not-italic">Rua Manuel da Rocha, no 753, Setor Central<br>CEP 77402-040 - Gurupi - TO</address>
</footer>
</body></html>"""
out["rendered_is_shell"] = mod.looks_like_js_shell(RENDERED)

soup = BeautifulSoup(RENDERED, "lxml")
out["logo_urls"] = [c["url"] for c in mod.extract_logo_candidates(soup, "https://melano.com.br/") if c.get("url") and c.get("source") == "img"]
out["logo_svgs"] = [c for c in mod.extract_logo_candidates(soup, "https://melano.com.br/") if c.get("inline_svg")]

contact = mod.extract_contact_info(soup)
out["address"] = contact["address"]
out["region"] = (contact["location"] or {}).get("region")

# A Greek-script hint de-accents to "", which used to match every address.
out["country_cep"] = mod.country_from_address("Rua X, 753, CEP 77402-040 - Gurupi - TO")
out["country_to_state"] = mod.country_from_address("Rua X, 753, Setor Central - TO")
out["phone_br"] = mod.normalize_phone("+556333513307")
out["country_uk"] = mod.country_from_address("10 Downing St, London SW1A 2AA, United Kingdom")

media, links, embeds = mod.harvest_document(RENDERED, "https://melano.com.br/")
out["harvest_media"] = sorted(media)
out["harvest_links"] = sorted(links)

BUNDLE = 'const a="/assets/picoles-DHW2-Oiw.png",b="assets/fachada-melano-DAFmBKzU.webp";'
out["bundle_assets"] = sorted({
    mod.resolve_bundle_asset(m.group(1), "https://melano.com.br/",
                             "https://melano.com.br/assets/index-x.js")
    for m in mod.BUNDLE_ASSET_PATTERN.finditer(BUNDLE)
})
out["route_key"] = [mod._route_key("https://melano.com.br/produtos/"),
                    mod._route_key("https://melano.com.br/produtos?categoria=acai")]
out["brand_phones"] = sorted(mod.select_brand_phones({
    "https://x.com/onde-encontrar": {"63999990000", "63999990001"},
    "https://x.com/": {"+5511999990000"},
}, "https://x.com/"))
out["directory_phone_cap"] = sorted(mod.select_brand_phones({
    "https://x.com/lojas": {str(i) for i in range(10)},
}, "https://x.com/"))
out["locale_br"] = list(mod.locale_and_currency({"location": {"country": "Brazil"}, "contact": {}}))
out["locale_unknown"] = list(mod.locale_and_currency({"location": {}, "contact": {"address": ""}}))
out["asset_logo"] = bool(mod.LOGO_ASSET_PATTERN.search("logo-melano-L1W7aZ4g.png"))
out["asset_photo"] = bool(mod.LOGO_ASSET_PATTERN.search("sorvete-acai-Bw6Bbodv.png"))
out["pt_nav"] = [bool(mod.DISCOVERY_PAGE_PATTERN.search(w))
                 for w in ("sobre", "contato", "onde encontrar", "produtos")]
out["pt_nav_skip"] = bool(mod.DISCOVERY_PAGE_PATTERN.search("politica-de-privacidade"))
print(json.dumps(out))
`;

const probeP2 = runProbe(PROBE_P2);

test('python crawler helpers: JS shells, bundle assets, HTML address', (t) => {
    if (probeP2.skip) {
        t.skip(probeP2.skip);
        return;
    }
    assert.equal(probeP2.error, undefined, probeP2.error);

    assert.equal(probeP2.data.shell_detected, true, 'a Vite shell is recognised');
    assert.deepEqual(probeP2.data.shell_bundles, [
        'https://melano.com.br/assets/index-CZrm7rxH.js',
        'https://melano.com.br/assets/index-DIBlNMOA.css',
    ]);
    assert.equal(probeP2.data.rendered_is_shell, false, 'rendered markup is not a shell');

    assert.deepEqual(probeP2.data.logo_urls,
        ['https://melano.com.br/assets/logo-melano-L1W7aZ4g.png']);
    assert.deepEqual(probeP2.data.logo_svgs, [],
        'lucide nav icons are not logo candidates');

    assert.match(probeP2.data.address, /^Rua Manuel da Rocha/);
    assert.match(probeP2.data.address, /77402-040/);
    assert.equal(probeP2.data.region, 'TO');

    assert.equal(probeP2.data.country_cep, 'Brazil', 'a CEP postcode identifies Brazil');
    assert.equal(probeP2.data.country_to_state, '',
        'a Greek-script hint must not match a de-accented address');
    assert.equal(probeP2.data.country_uk, 'United Kingdom');

    assert.equal(probeP2.data.phone_br, '+556333513307',
        'a foreign dialling code survives an unknown country');

    assert.deepEqual(probeP2.data.brand_phones, ['+5511999990000'],
        'store-locator numbers do not become the brand NAP');
    assert.equal(probeP2.data.directory_phone_cap.length, 3,
        'a directory-only page is capped');
    assert.deepEqual(probeP2.data.locale_br, ['pt-BR', 'BRL'],
        'the pack locale follows the address country');
    assert.deepEqual(probeP2.data.locale_unknown, ['en-GB', 'GBP'],
        'an unknown country keeps the default locale');
    assert.equal(probeP2.data.asset_logo, true,
        'a bundle asset named logo-* is a logo candidate');
    assert.equal(probeP2.data.asset_photo, false,
        'product photography is not a logo candidate');
    assert.deepEqual(probeP2.data.pt_nav, [true, true, true, true],
        'a localised nav is followed by link discovery');
    assert.equal(probeP2.data.pt_nav_skip, false,
        'unrelated pages are still skipped');

    assert.deepEqual(probeP2.data.harvest_media, [
        'https://melano.com.br/assets/logo-melano-L1W7aZ4g.png',
    ]);

    assert.deepEqual(probeP2.data.bundle_assets, [
        'https://melano.com.br/assets/fachada-melano-DAFmBKzU.webp',
        'https://melano.com.br/assets/picoles-DHW2-Oiw.png',
    ], 'asset paths inside a JS bundle are recovered');

    assert.equal(probeP2.data.route_key[0], probeP2.data.route_key[1],
        'query variants of one route collapse to a single render');
});

const PROBE_P3 = `
import importlib.util, json, os, sys, tempfile
spec = importlib.util.spec_from_file_location("crawler", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
sys.modules["crawler"] = mod
spec.loader.exec_module(mod)

url = "https://melano.com.br/"
mod.configure_site(url)
mod.TEXT_DIR = tempfile.mkdtemp()
mod.fetch_text_cached = lambda _url: None
html = "<html><body><main>" + ("Visible site content. " * 40) + "</main></body></html>"

class FakeBrowser:
    @classmethod
    def available(cls):
        return True

    @classmethod
    def render(cls, target, **kwargs):
        return mod.FetchResult(ok=True, status=200, url=target, text=html, via="browser")

mod.Browser = FakeBrowser
visited, text_pages = set(), set()
result = mod.render_js_site([url], visited, text_pages)
print(json.dumps({
    "visited": sorted(visited),
    "text_pages": sorted(text_pages),
    "result_text_pages": sorted(result["text_pages"]),
    "cached_html": mod._page_cache.get(url) == html,
}))
`;

const probeP3 = runProbe(PROBE_P3);

test('python crawler helpers: browser fallback when HTTP returns no HTML', (t) => {
    if (probeP3.skip) {
        t.skip(probeP3.skip);
        return;
    }
    assert.equal(probeP3.error, undefined, probeP3.error);
    assert.deepEqual(probeP3.data.visited, ['https://melano.com.br/']);
    assert.deepEqual(probeP3.data.text_pages, ['https://melano.com.br/']);
    assert.deepEqual(probeP3.data.result_text_pages, ['https://melano.com.br/']);
    assert.equal(probeP3.data.cached_html, true,
        'rendered HTML is cached for downstream brand and social extraction');
});

const PROBE_NETWORK_FIXES = `
import importlib.util, json, os, shutil, sys, tempfile, time
spec = importlib.util.spec_from_file_location("crawler", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
sys.modules["crawler"] = mod
spec.loader.exec_module(mod)

mod.configure_site("http://www.example.test/")
calls = []
def request(url, **kwargs):
    calls.append(url)
    if url.startswith("http://www.example.test/"):
        raise mod.requests.exceptions.SSLError("certificate host mismatch")
    response = mod.requests.Response()
    response.status_code = 200
    response.url = url
    response.headers["content-type"] = "text/html; charset=utf-8"
    response._content = b"<html>ok</html>"
    return response

original_request = mod.requests.get
mod.requests.get = request
try:
    fallback = mod.get("http://www.example.test/")
finally:
    mod.requests.get = original_request

out = {
    "fallback_url": fallback.url if fallback else None,
    "request_urls": calls,
    "canonical": mod.normalize_candidate_url(
        "http://www.example.test/assets/logo.png", "https://example.test/about"),
    "retry_after": mod.retry_after_seconds("120"),
    "follower_display": {
        "unknown": mod.format_social_followers({
            "totals": {"followers": 0, "followers_reported": 0},
            "matrix": [{"followers": None}],
        }),
        "measured_zero": mod.format_social_followers({
            "totals": {"followers": 0, "followers_reported": 1},
        }),
    },
}

class LimitedResponse:
    status_code = 429
    headers = {"Retry-After": "120"}
    url = "https://restaurantguru.com/one"
    text = "rate limited"

class Session:
    def __init__(self):
        self.calls = 0
    def get(self, url, **kwargs):
        self.calls += 1
        response = LimitedResponse()
        response.url = url
        return response

session = Session()
mod.State.sessions["restaurantguru"] = session
mod.State.page_cache.clear()
mod.State.rate_limit_cooldowns.clear()
mod.State.use_cache = False
mod.throttle = lambda _platform: None
first = mod.fetch("https://restaurantguru.com/one", platform="restaurantguru")
second = mod.fetch("https://restaurantguru.com/two", platform="restaurantguru")
out["rate_limit"] = {
    "first_status": first.status,
    "second_status": second.status,
    "network_calls": session.calls,
    "cooldown_seconds": round(mod.State.rate_limit_cooldowns["restaurantguru.com"] - time.time()),
}

out["crawl_keys"] = [
    mod.crawl_url_key("http://www.example.test/?utm_source=mail"),
    mod.crawl_url_key("https://example.test/"),
    mod.crawl_url_key("https://example.test/about/?fbclid=tracker"),
    mod.crawl_url_key("http://www.example.test/about"),
]

mod.configure_site("http://www.example.test/")
mod.TEXT_DIR = tempfile.mkdtemp()
temp_text_dir = mod.TEXT_DIR
mod.ENABLE_CRAWL_CHECKPOINT = False
mod.WEB_REQUEST_DELAY = 0
os.environ["CRAWLER_RENDER_JS"] = "0"
crawl_calls = []
def crawl_request(url, **kwargs):
    crawl_calls.append(url)
    response = mod.requests.Response()
    response.status_code = 200
    response.url = "https://example.test" + ("/about" if "about" in url else "/")
    response.headers["content-type"] = "text/html; charset=utf-8"
    response._content = (
        b'<html><body>Page text <a href="http://www.example.test/?utm_source=mail">home</a>'
        b'<a href="https://example.test/about/">about</a>'
        b'<a href="http://example.test/about?fbclid=tracker">about tracking</a>'
        b'</body></html>'
    )
    return response

original_get = mod.get
mod.get = crawl_request
try:
    _media, _text, _videos, crawl_visited = mod.crawl_pages(["http://www.example.test/"])
finally:
    mod.get = original_get
    shutil.rmtree(temp_text_dir)
out["crawl_aliases"] = {
    "calls": crawl_calls,
    "visited": sorted(crawl_visited),
}
print(json.dumps(out))
`;

const networkFixesProbe = runProbe(PROBE_NETWORK_FIXES);

test('python crawler retries broken www TLS via the apex and suppresses rate-limited repeats', (t) => {
    if (networkFixesProbe.skip) {
        t.skip(networkFixesProbe.skip);
        return;
    }
    assert.equal(networkFixesProbe.error, undefined, networkFixesProbe.error);
    assert.equal(networkFixesProbe.data.fallback_url, 'https://example.test/');
    assert.deepEqual(networkFixesProbe.data.request_urls, [
        'http://www.example.test/',
        'https://example.test/',
    ]);
    assert.equal(networkFixesProbe.data.canonical, 'https://example.test/assets/logo.png');
    assert.equal(networkFixesProbe.data.retry_after, 120);
    assert.equal(networkFixesProbe.data.follower_display.unknown, 'unavailable');
    assert.equal(networkFixesProbe.data.follower_display.measured_zero, '0');
    assert.deepEqual(networkFixesProbe.data.crawl_keys[0], networkFixesProbe.data.crawl_keys[1]);
    assert.equal(networkFixesProbe.data.crawl_keys[2], networkFixesProbe.data.crawl_keys[3]);
    assert.equal(networkFixesProbe.data.crawl_aliases.calls.length, 2,
        'www, apex, scheme, slash and tracking-query aliases are each fetched once');
    assert.equal(networkFixesProbe.data.crawl_aliases.visited.length, 2);
    assert.equal(networkFixesProbe.data.rate_limit.first_status, 429);
    assert.equal(networkFixesProbe.data.rate_limit.second_status, 429);
    assert.equal(networkFixesProbe.data.rate_limit.network_calls, 1,
        'a rate-limited host is not requested again during its Retry-After window');
    assert.ok(networkFixesProbe.data.rate_limit.cooldown_seconds > 110);
});
