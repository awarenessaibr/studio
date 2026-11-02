#!/usr/bin/env python3
"""
Business Social & Reputation Intelligence Crawler  (v2)
=======================================================

Turns a business name + location into an evidence-backed dossier covering
social presence, ratings, reviews and everything that bears on reputation:
NAP data, opening hours, booking/delivery paths, hygiene compliance, press
mentions and a cross-platform benchmark. Every claim keeps its provenance.

WHAT IT COLLECTS
----------------
Reputation & reviews
  Google Maps ....... rating, review count, 5->1 star distribution, review text
                      (author, stars, date, owner reply, photos), Google's own
                      "mentioned in N reviews" topic tags, price level, category,
                      address, phone, website, plus code, opening hours.
  RestaurantGuru .... rating + count, hours, geo, cuisine, menu, and the
                      `sameAs` links that reveal the real website / IG / FB.
  TripAdvisor ....... bubble rating, "#x of y" rank, review count, breakdown,
                      awards (blocked from most datacentre IPs — see LIMITS).
  Yelp, Trustpilot, OpenTable, TheFork, Quandoo, Booking.com, Expedia,
  MICHELIN, Foursquare, Zomato ... one generic schema.org/JSON-LD connector,
  with review-block heuristics when markup is missing.

Social presence
  Instagram .... followers / following / posts / bio / category / verified /
                 external link (Graph API, then public profile meta).
  Facebook ..... followers, likes, check-ins ("were here"), talking-about,
                 category, about, rating, phone, address (Graph API, then web).
  TikTok ....... followers, likes, video count, bio, latest video stats.
  YouTube ...... subscribers, total views, video count, latest uploads (RSS).
  X, Threads, Pinterest, LinkedIn, Snapchat ... best-effort profile meta.

Business facts
  Website crawl (home / about / contact / menu / book / gift): NAP, hours,
  emails, phones, schema.org, social links, booking + delivery providers
  (OpenTable, ResDiary, SevenRooms, TheFork, Deliveroo, Uber Eats, Just Eat...),
  tech stack, sitemap size, menu presence.

Compliance & context
  UK Food Standards Agency .... hygiene rating (FHRS 0-5 / FHIS pass or
                                improvement required), inspection date,
                                authority, address (free open API, no key).
  Web mentions ................ listicles, awards, local press, incident
                                signals (search-engine backed, relevance-filtered).

DERIVED INTELLIGENCE
--------------------
  identity   canonical NAP, every observed variant, conflict detection,
             handle consistency across platforms.
  reputation cross-source consensus rating (volume-weighted), distribution,
             review velocity + trend, sentiment (negation/intensifier aware),
             theme extraction (food / service / drinks / atmosphere / value /
             wait / cleanliness / dietary / family / events / consistency),
             owner-response rate, red flags, standout quotes.
  social     presence matrix, reach, posting cadence, content mix, engagement
             where measurable, profile completeness, staleness, gaps.
  web        booking + delivery paths, menu, tech, page count, sitemap.
  scoring    0-100 for reputation, social strength, content health and
             discoverability (+ weighted overall).
  signals    strengths / weaknesses / opportunities / risks, each traceable
             to the data that produced it.
  benchmark  group report ranking every business against its siblings.

HOW EACH SOURCE IS FETCHED (tiers, degrading gracefully)
-------------------------------------------------------
  1. api      official API when a key is present
              (Google Places New, Facebook Graph, TikTok Research, SerpAPI)
  2. http     requests + JSON-LD / microdata / meta parsing  (fast, default)
  3. browser  headless Chromium via Playwright for JS pages and bot walls

Every source is optional: a blocked site records a warning and the run
continues. Each business gets a crawl.log, a per-source checkpoint
(state.json) for resumability, and platform JSON files that later runs merge
so `--only` stays incremental.

OUTPUT (per business)
---------------------
  crawler_output/_social_output/<group>/<slug>/
    business.profile.json   master record (all sections below)
    reviews.all.json        normalised reviews, all sources
    reviews.csv            spreadsheet-friendly export
    social.json            social matrix + completeness
    social.tokens.json     brand-pack tokens (v1-compatible shape, enriched)
    insights.md            human-readable brief with tables and quotes
    report.html            self-contained dark-mode dashboard
    platforms/<source>.json  raw per-source output incl. warnings
    platforms/raw/<source>.html  (only with --keep-raw)
    assets/                avatars, covers, photos
    discovery.json         resolved profile URLs + evidence
    crawl.log, state.json
  crawler_output/_social_output/<group>/group.report.md
  crawler_output/_social_output/<group>/group.summary.json

USAGE
-----
    python scripts/crawler-studio-social.py --list
    python scripts/crawler-studio-social.py --business bar-91 --dry-run
    python scripts/crawler-studio-social.py --business bar-91
    python scripts/crawler-studio-social.py --all
    python scripts/crawler-studio-social.py --all --no-browser
    python scripts/crawler-studio-social.py --business bar-91 --deep --max-reviews 120
    python scripts/crawler-studio-social.py --business bar-91 --only google,instagram
    python scripts/crawler-studio-social.py --business bar-91 --skip press,trustpilot
    python scripts/crawler-studio-social.py --all --report-only
    python scripts/crawler-studio-social.py --all --output-root out/run1 --group q4

Edit TARGETS (top of file) to add businesses. `profiles` entries are trusted
seeds; anything left out is discovered from the website, from aggregators,
from web search, or by verified handle guessing.

CREDENTIALS (all optional; env vars or tokens.json)
---------------------------------------------------
    GOOGLE_PLACES_API_KEY   Places API (New): authoritative place + 5 reviews
    SERPAPI_KEY             paginates the *full* Google review list
    FB_GRAPH_TOKEN          Facebook Graph + owned Instagram accounts
    TIKTOK_RESEARCH_TOKEN   TikTok Research API (approved projects only)
    cookies.json            {"instagram": {"sessionid": "..."}, ...} for
                            properties you own or are authorised to access

LIMITS (observed, not speculative)
----------------------------------
  * Google Maps renders only ~5 unique reviews to anonymous browsers. The
    rating, count, distribution and topics are complete; set
    GOOGLE_PLACES_API_KEY or SERPAPI_KEY for full review coverage.
  * TripAdvisor and Yelp sit behind bot walls (HTTP 403 and JS challenges).
    The connector tries HTTP, then a real browser, then records the block.
    Provide cookies.json for a session that can already see the page.
  * Search-engine results follow the caller's IP geolocation. Discovery
    therefore prefers website links, aggregator `sameAs` and verified handle
    guessing; web mentions are relevance-filtered and may come back empty.
  * Social metrics that require login (Instagram engagement, Facebook post
    text) are only available in cookie mode and are marked as such.
  * Sentiment and themes are lexicon-based and indicative: read the sample
    size before acting on them (the brief says so explicitly).

TERMS OF SERVICE
----------------
Automated collection may breach the terms of some of these platforms. Prefer
official APIs, use cookie mode only for accounts you are authorised to access,
keep volumes low (this tool self-throttles per domain), and treat the output as
internal research. No warranty of legality is given or implied.
"""

from __future__ import annotations

import argparse
import base64
import csv
import gzip
import hashlib
import json
import math
import os
import random
import re
import statistics
import sys
import threading
import time
import traceback
import urllib.parse as up
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html import escape as html_escape, unescape

import requests
from bs4 import BeautifulSoup

try:  # optional heavy dependency, only needed for tier-3 extraction
    from playwright.sync_api import sync_playwright
    HAVE_PLAYWRIGHT = True
except Exception:  # pragma: no cover - environment dependent
    sync_playwright = None
    HAVE_PLAYWRIGHT = False


SCHEMA_VERSION = "2.0"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)


# =========================================================================
# 1. TARGETS
# =========================================================================
# `profiles` seeds are trusted (no discovery cost). Everything not seeded is
# discovered from the website, from aggregators and from web search.
#
# Each business may set:
#   name, slug, city, region, country, category, website,
#   profiles {}          -> known/confirmed profile URLs
#   aliases []           -> other spellings used for matching and search
#   competitors []       -> names used for local competitive context
#   notes str

TARGETS = [
    {
        "name": "The Physician",
        "slug": "thephysician-bar",
        "city": "St Andrews",
        "region": "Scotland",
        "country": "United Kingdom",
        "category": "Bar",
        "aliases": [
        "The Physician Bar"
        ],
        "website": "https://www.thephysician.bar/",
        "profiles": {
        "facebook": "https://www.facebook.com/profile.php?id=61554721448724",
        "instagram": "https://www.instagram.com/thephysician_standrews",
        "tripadvisor": "https://www.tripadvisor.co.uk/Restaurant_Review-g186533-d27299282-Reviews-The_Physician-St_Andrews_Fife_Scotland.html"
        }
    },
    {
        "name": "The Adamson",
        "slug": "theadamson",
        "city": "St Andrews",
        "region": "Scotland",
        "country": "United Kingdom",
        "category": "Restaurant",
        "aliases": [
        "The Adamson Restaurant"
        ],
        "website": "https://www.theadamson.com/",
        "profiles": {
        "facebook": "https://www.facebook.com/TheAdamsonStAndrews",
        "instagram": "https://www.instagram.com/theadamsonstandrews/",
        "tiktok": "https://www.tiktok.com/@theadamsonstandrews",
        "tripadvisor": "https://www.tripadvisor.co.uk/Restaurant_Review-g186533-d2679481-Reviews-The_Adamson-St_Andrews_Fife_Scotland.html"
        }
    },
    {
        "name": "HATCH",
        "slug": "hatchstandrews",
        "city": "St Andrews",
        "region": "Scotland",
        "country": "United Kingdom",
        "category": "Restaurant",
        "aliases": [
        "HATCH Restaurant"
        ],
        "website": "https://www.hatchstandrews.com/",
        "profiles": {
        "facebook": "https://www.facebook.com/HatchStAndrews",
        "instagram": "https://www.instagram.com/hatch_standrews/",
        "tripadvisor": "https://www.tripadvisor.co.uk/Restaurant_Review-g186533-d23378004-Reviews-Hatch-St_Andrews_Fife_Scotland.html"
        }
    }
    ]


OUTPUT_ROOT = os.path.join("crawler_output", "_social_output",
                           "Julie-Dalton-STAndrews")
GROUP_NAME = "Julie-Dalton-STAndrews"


# =========================================================================
# 2. TUNABLES
# =========================================================================
MAX_POSTS_PER_PROFILE = 12
MAX_REVIEWS_PER_SOURCE = 200        # hard cap per source
MAX_PAGES_WEBSITE = 24              # website crawl breadth
MAX_SEARCH_QUERIES = 14
MAX_WORKERS = 4                     # concurrent HTTP connectors
REQUEST_TIMEOUT = 30
HTTP_RETRIES = 3
CACHE_TTL_SECONDS = 7 * 24 * 3600
KEEP_RAW_HTML = False
DOWNLOAD_ASSETS = True

# Politeness, per platform (seconds between requests to the same domain)
REQUEST_DELAY = {
    "default": 0.6,
    "instagram": 2.5,
    "facebook": 2.0,
    "tiktok": 2.5,
    "tripadvisor": 2.0,
    "google": 3.0,
    "yelp": 2.0,
    "trustpilot": 2.0,
    "restaurantguru": 1.5,
    "search": 2.5,
}

UA_DESKTOP = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
UA_MOBILE = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
             "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")
UA_BY_PLATFORM = {
    "default": UA_DESKTOP,
    "instagram": UA_DESKTOP,
    "facebook": UA_DESKTOP,
    "tiktok": UA_DESKTOP,
    "tripadvisor": UA_DESKTOP,
    "google": UA_DESKTOP,
}

BASE_HEADERS = {
    "Accept": ("text/html,application/xhtml+xml,application/xml;q=0.9,"
               "image/avif,image/webp,*/*;q=0.8"),
    "Accept-Language": "en-GB,en;q=0.9",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}

PLATFORM_DOMAIN = {
    "instagram": "instagram.com",
    "facebook": "facebook.com",
    "tiktok": "tiktok.com",
    "tripadvisor": "tripadvisor.com",
    "google": "google.com",
    "yelp": "yelp.com",
    "trustpilot": "trustpilot.com",
    "restaurantguru": "restaurantguru.com",
}

# source key -> (human label, brand colour for the HTML report)
SOURCE_LABELS = {
    "google": ("Google Maps", "#4285F4"),
    "tripadvisor": ("TripAdvisor", "#00AF87"),
    "restaurantguru": ("Restaurant Guru", "#FF6B35"),
    "yelp": ("Yelp", "#D32323"),
    "trustpilot": ("Trustpilot", "#00B67A"),
    "opentable": ("OpenTable", "#DA3743"),
    "thefork": ("TheFork", "#002D72"),
    "quandoo": ("Quandoo", "#C8102E"),
    "booking": ("Booking.com", "#003580"),
    "expedia": ("Expedia", "#FFC72C"),
    "michelin": ("MICHELIN Guide", "#C8102E"),
    "foursquare": ("Foursquare", "#F94877"),
    "zomato": ("Zomato", "#E23744"),
    "facebook": ("Facebook", "#1877F2"),
    "instagram": ("Instagram", "#E4405F"),
    "tiktok": ("TikTok", "#000000"),
    "youtube": ("YouTube", "#FF0000"),
    "x": ("X (Twitter)", "#000000"),
    "threads": ("Threads", "#000000"),
    "pinterest": ("Pinterest", "#BD081C"),
    "linkedin": ("LinkedIn", "#0A66C2"),
    "snapchat": ("Snapchat", "#FFFC00"),
    "website": ("Business website", "#6B7280"),
    "food_hygiene": ("Food hygiene rating", "#16A34A"),
    "press": ("Press & web mentions", "#8B5CF6"),
}

SOCIAL_SOURCES = {"instagram", "facebook", "tiktok", "youtube", "x",
                  "threads", "pinterest", "linkedin", "snapchat"}
REVIEW_SOURCES = {"google", "tripadvisor", "restaurantguru", "yelp",
                  "trustpilot", "opentable", "thefork", "quandoo", "booking",
                  "expedia", "michelin", "foursquare", "zomato"}


# =========================================================================
# 3. RUNTIME STATE
# =========================================================================
class State:
    """Mutable run-wide configuration and caches."""

    verbose = False
    use_browser = True
    deep = False
    max_reviews = MAX_REVIEWS_PER_SOURCE
    use_cache = True
    output_root = OUTPUT_ROOT
    group = GROUP_NAME
    only = None            # set of source keys
    skip = set()
    log_file = None
    cache_dir = None
    sessions = {}
    cookies = {}
    tokens = {}
    last_hit = {}
    page_cache = {}
    search_cache = {}
    browser = None
    stats = Counter()


def log(msg="", level="info"):
    """Console + per-business crawl.log logging."""
    if level == "debug" and not State.verbose:
        return
    prefix = {"warn": "  ! ", "error": "  x ", "ok": "  + ", "debug": "  . "}.get(level, "    ")
    line = f"{prefix}{msg}"
    print(line, flush=True)
    if State.log_file:
        try:
            with open(State.log_file, "a", encoding="utf-8") as fh:
                fh.write(f"[{datetime.now().strftime('%H:%M:%S')}] {line}\n")
        except OSError:
            pass


def head(title):
    line = "=" * 78
    log()
    log(line)
    log(title)
    log(line)


# =========================================================================
# 4. SMALL UTILITIES
# =========================================================================
def now_ts() -> int:
    return int(time.time())


def iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def slugify(value: str) -> str:
    if not value:
        return "unknown"
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return cleaned or "unknown"


def site_slug(value: str) -> str:
    """Kept from v1: safe directory name that preserves unicode-ish names."""
    if not value:
        return "unknown"
    cleaned = re.sub(r"[^A-Za-z0-9_.-]", "_", value.lower())
    return cleaned.strip("._") or "unknown"


def parse_count(value):
    """'1,234' / '1.2K' / '3.4M' / '2B' / '1 234' -> int."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    s = str(value).strip().replace(",", "").replace("\u202f", "").replace(" ", "").upper()
    s = s.replace("+", "")
    if not s:
        return None
    mult = 1
    if s.endswith("K") or s.endswith("THOUSAND"):
        mult, s = 1_000, re.sub(r"(K|THOUSAND)$", "", s)
    elif s.endswith("M") or s.endswith("MILLION"):
        mult, s = 1_000_000, re.sub(r"(M|MILLION)$", "", s)
    elif s.endswith("B"):
        mult, s = 1_000_000_000, re.sub(r"B$", "", s)
    try:
        return int(float(s) * mult)
    except (ValueError, TypeError):
        return None


def to_float(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace(",", ".")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def first(seq, default=None):
    for item in seq or []:
        if item:
            return item
    return default


def dedupe(seq):
    seen, out = set(), []
    for item in seq:
        key = json.dumps(item, sort_keys=True, default=str) if isinstance(item, (dict, list)) else str(item)
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


def clean_text(value, limit=None):
    if value is None:
        return None
    text = unescape(str(value))
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = (text.replace("\u00a0", " ").replace("\u202f", " ")
                .replace("\u2009", " ").replace("\u200b", ""))
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if limit and len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text or None


def normalize_text(value):
    """Lowercase, de-accent, strip punctuation — for fuzzy matching."""
    if not value:
        return ""
    text = clean_text(value) or ""
    text = text.lower()
    text = (text.replace("á", "a").replace("à", "a").replace("ã", "a")
                .replace("â", "a").replace("é", "e").replace("ê", "e")
                .replace("í", "i").replace("ó", "o").replace("ô", "o")
                .replace("õ", "o").replace("ú", "u").replace("ü", "u")
                .replace("ç", "c").replace("ñ", "n").replace("ß", "ss"))
    return re.sub(r"[^a-z0-9 ]+", " ", text).strip()


def brand_tokens(value):
    """Tokens that identify a brand for relevance checks (keeps 'bar')."""
    generic = {"the", "and", "of", "ltd", "limited", "co", "company", "inc",
               "llc", "uk", "scotland", "group", "restaurant"}
    return {t for t in normalize_text(value).split() if t not in generic and len(t) > 1}


def name_tokens(value):
    stop = {"the", "and", "of", "bar", "cafe", "café", "restaurant", "ltd",
            "limited", "co", "company", "inc", "llc", "uk", "scotland"}
    return {t for t in normalize_text(value).split() if t not in stop and len(t) > 1}


def similarity(a, b):
    """Token Jaccard + containment bonus, 0..1."""
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    jaccard = inter / union if union else 0.0
    containment = inter / min(len(ta), len(tb))
    return round(max(jaccard, containment * 0.9), 3)


def abs_url(base, href):
    if not href:
        return None
    href = unescape(str(href)).strip()
    if not href or href.startswith(("javascript:", "mailto:", "tel:", "#", "data:")):
        return None
    try:
        return up.urljoin(base, href)
    except Exception:
        return None


def domain_of(url):
    try:
        host = up.urlparse(url).netloc.lower()
    except Exception:
        return ""
    return host[4:] if host.startswith("www.") else host


def same_host(a, b):
    host_a, host_b = domain_of(a), domain_of(b)
    if not host_a or not host_b:
        return False
    return host_a == host_b or host_a.endswith("." + host_b) or host_b.endswith("." + host_a)


def short_hash(value, length=10):
    return hashlib.sha1(str(value).encode("utf-8")).hexdigest()[:length]


def safe_filename(url, fallback="file"):
    parsed = up.urlparse(url or "")
    name = os.path.basename(parsed.path).split("?")[0]
    if not name:
        name = f"{fallback}_{short_hash(url)}"
    name = re.sub(r"[\\/:*?\"<>|\s]", "_", unescape(name)).strip("._")
    if len(name) > 90:
        base, ext = os.path.splitext(name)
        name = base[:80] + ext
    return name or fallback


def json_safe(value):
    """Recursively strip lone surrogates so json.dump never explodes."""
    if isinstance(value, str):
        try:
            value.encode("utf-8")
            return value
        except UnicodeEncodeError:
            return value.encode("utf-8", "replace").decode("utf-8", "replace")
    if isinstance(value, dict):
        return {json_safe(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, set):
        return [json_safe(v) for v in value]
    return value


def write_json(path, data):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(json_safe(data), fh, indent=2, ensure_ascii=False, default=str)
    os.replace(tmp, path)


def read_json(path, default=None):
    if not path or not os.path.exists(path):
        return default if default is not None else {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, (dict, list)) else (default if default is not None else {})
    except Exception as exc:
        log(f"could not read {path}: {exc}", "warn")
        return default if default is not None else {}


def rel_to(path, root):
    try:
        return os.path.relpath(path, root).replace(os.sep, "/")
    except Exception:
        return path


# ---- rating / number / date normalisation -------------------------------
def normalize_rating(value, best=None):
    """Return (rating_on_5, best_rating) or (None, None)."""
    rating = to_float(value)
    if rating is None:
        return None, None
    best_val = to_float(best) if best is not None else None
    if best_val and best_val > 0 and abs(best_val - 5.0) > 0.01:
        rating = rating * 5.0 / best_val
    if rating <= 0:
        return None, best_val or 5.0
    return round(min(rating, 5.0), 2), best_val or 5.0


RELATIVE_DATE_RE = re.compile(
    r"(?:(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago)"
    r"|(?:a|an)\s+(second|minute|hour|day|week|month|year)\s+ago",
    re.I,
)


def relative_to_iso(text):
    """'3 months ago' -> ISO date (best effort, relative to now)."""
    if not text:
        return None
    m = RELATIVE_DATE_RE.search(str(text))
    if not m:
        return None
    amount = int(m.group(1)) if m.group(1) else 1
    unit = (m.group(2) or m.group(3) or "").lower()
    days = {"second": 0, "minute": 0, "hour": 0, "day": 1,
            "week": 7, "month": 30.4, "year": 365.25}.get(unit, 0) * amount
    dt = datetime.now(timezone.utc) - __import__("datetime").timedelta(days=days)
    return dt.strftime("%Y-%m-%d")


MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"], start=1)}


def any_date_to_iso(text):
    """Parse common review date formats into YYYY-MM-DD."""
    if not text:
        return None
    raw = str(text).strip()
    iso = relative_to_iso(raw)
    if iso:
        return iso
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", raw)
    if m:
        return m.group(0)
    # 12 March 2024 / March 2024 / March 12, 2024
    months_re = "|".join(MONTHS)
    m = re.search(rf"(\d{{1,2}})?\s*({months_re})\s*,?\s*(\d{{4}})", raw, re.I)
    if m:
        month = MONTHS.get(m.group(2).lower())
        day = int(m.group(1)) if m.group(1) else 1
        try:
            return f"{int(m.group(3)):04d}-{month:02d}-{day:02d}"
        except Exception:
            return None
    m = re.search(rf"({months_re})\s+(\d{{1,2}}),?\s*(\d{{4}})", raw, re.I)
    if m:
        month = MONTHS.get(m.group(1).lower())
        return f"{int(m.group(3)):04d}-{month:02d}-{int(m.group(2)):02d}"
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", raw)
    if m:
        d, mo, y = m.groups()
        return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    return None


def price_level_from(value):
    """'££' / '$$' / 'moderate' -> 1..4."""
    if value is None:
        return None
    s = str(value).strip()
    m = re.match(r"^([£$€]{1,4})", s)
    if m:
        return len(m.group(1))
    low = s.lower()
    if any(k in low for k in ("inexpensive", "cheap", "budget")):
        return 1
    if "moderate" in low or "mid" in low:
        return 2
    if any(k in low for k in ("expensive", "upscale", "premium")):
        return 3
    if any(k in low for k in ("very expensive", "fine dining", "luxury")):
        return 4
    return None


def price_label(level):
    return {1: "£", 2: "££", 3: "£££", 4: "££££"}.get(level)


# ---- polite rate limiting ----------------------------------------------
def throttle(platform):
    delay = REQUEST_DELAY.get(platform, REQUEST_DELAY["default"])
    host = PLATFORM_DOMAIN.get(platform, platform)
    last = State.last_hit.get(host, 0)
    wait = delay - (time.time() - last)
    if wait > 0:
        time.sleep(wait + random.uniform(0, 0.35))
    State.last_hit[host] = time.time()


# ---- HTTP fetch layer ---------------------------------------------------
class FetchResult:
    __slots__ = ("ok", "status", "url", "text", "headers", "via", "error",
                 "elapsed", "_soup")

    def __init__(self, ok=False, status=None, url="", text="", headers=None,
                 via="http", error=None, elapsed=0.0):
        self.ok = ok
        self.status = status
        self.url = url
        self.text = text or ""
        self.headers = headers or {}
        self.via = via
        self.error = error
        self.elapsed = elapsed
        self._soup = None

    def __bool__(self):
        return self.ok

    def __repr__(self):
        return f"<Fetch {self.via} {self.status} {len(self.text)}b {domain_of(self.url)}>"

    @property
    def soup(self):
        if self._soup is None:
            self._soup = BeautifulSoup(self.text or "", "lxml")
        return self._soup


def _session(platform):
    if platform in State.sessions:
        return State.sessions[platform]
    session = requests.Session()
    session.headers.update(BASE_HEADERS)
    session.headers["User-Agent"] = UA_BY_PLATFORM.get(platform, UA_DESKTOP)
    cookie_data = (State.cookies or {}).get(platform, {}) or {}
    for name, value in cookie_data.items():
        try:
            session.cookies.set(name, value, domain=f".{PLATFORM_DOMAIN.get(platform, domain_of('https://' + platform))}")
        except Exception:
            session.cookies.set(name, str(value))
    State.sessions[platform] = session
    return session


def _cache_path(url, platform):
    if not State.use_cache or not State.cache_dir:
        return None
    key = short_hash(f"{platform}|{url}", 24)
    return os.path.join(State.cache_dir, key + ".json.gz")


def _cache_read(path):
    if not path or not os.path.exists(path):
        return None
    try:
        if time.time() - os.path.getmtime(path) > CACHE_TTL_SECONDS:
            return None
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            data = json.load(fh)
        return FetchResult(ok=True, status=data.get("status"), url=data.get("url", ""),
                           text=data.get("text", ""), headers=data.get("headers") or {},
                           via="cache")
    except Exception:
        return None


def _cache_write(path, result):
    if not path:
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            json.dump({"status": result.status, "url": result.url,
                       "text": result.text, "headers": dict(result.headers or {}),
                       "at": now_ts()}, fh)
    except Exception as exc:
        log(f"cache write failed: {exc}", "debug")


def fetch(url, platform="default", retries=HTTP_RETRIES, stream=False,
          json_response=False, use_cache=True, referer=None, params=None,
          extra_headers=None):
    """Tier-2 fetch: requests with retries, jitter, caching and honest status."""
    if not url:
        return FetchResult(error="empty url")
    if url in State.page_cache and not params:
        cached = State.page_cache[url]
        if isinstance(cached, FetchResult):
            return cached

    cache_url = url
    if params:
        cache_url = url + ("&" if "?" in url else "?") + up.urlencode(sorted(params.items()))
    cache_file = _cache_path(cache_url, platform) if (use_cache and not stream) else None
    if cache_file:
        hit = _cache_read(cache_file)
        if hit:
            State.stats["cache_hits"] += 1
            State.page_cache[url] = hit
            return hit

    session = _session(platform)
    headers = dict(extra_headers or {})
    if referer:
        headers["Referer"] = referer
    started = time.time()
    last_error = None

    for attempt in range(max(1, retries)):
        throttle(platform)
        try:
            resp = session.get(url, timeout=REQUEST_TIMEOUT, stream=stream,
                               allow_redirects=True, headers=headers or None,
                               params=params)
            elapsed = time.time() - started

            if resp.status_code in (429, 503) or resp.status_code == 403 and "rate" in resp.text.lower()[:2000]:
                wait = min(60, REQUEST_DELAY.get(platform, 1.0) * (attempt + 1) * 4)
                log(f"rate limited ({resp.status_code}) on {platform}; sleeping {wait:.0f}s", "warn")
                time.sleep(wait + random.uniform(0, 1))
                last_error = f"HTTP {resp.status_code}"
                continue

            if json_response:
                try:
                    payload = resp.json()
                except ValueError:
                    return FetchResult(False, resp.status_code, resp.url, resp.text,
                                       dict(resp.headers), "http", "non-JSON response", elapsed)
                if resp.status_code >= 400:
                    msg = payload.get("error", {}).get("message") if isinstance(payload, dict) else None
                    return FetchResult(False, resp.status_code, resp.url, json.dumps(payload),
                                       dict(resp.headers), "http", msg or f"HTTP {resp.status_code}", elapsed)
                return FetchResult(True, resp.status_code, resp.url, json.dumps(payload),
                                   dict(resp.headers), "http", None, elapsed)

            if stream:
                return FetchResult(200 <= resp.status_code < 400, resp.status_code, resp.url,
                                   "", dict(resp.headers), "http", None, elapsed)

            result = FetchResult(200 <= resp.status_code < 400, resp.status_code, resp.url,
                                 resp.text, dict(resp.headers), "http", None, elapsed)
            if result.ok and cache_file:
                _cache_write(cache_file, result)
            if not result.ok:
                log(f"HTTP {resp.status_code} [{platform}] {url[:110]}", "warn")
            if not params:
                State.page_cache[url] = result
            return result

        except requests.RequestException as exc:
            last_error = str(exc)
            log(f"request failed ({attempt + 1}/{retries}) [{platform}] {exc.__class__.__name__}", "debug")
            time.sleep(min(20, (2 ** attempt) * 1.5) + random.uniform(0, 1))

    result = FetchResult(False, None, url, "", {}, "http", last_error or "request failed",
                         time.time() - started)
    if not params:
        State.page_cache[url] = result
    return result


# ---- browser layer (tier 3) --------------------------------------------
class Browser:
    """Lazy, single-instance headless Chromium for JS + bot-protected pages."""

    _playwright = None
    _browser = None
    _context = None
    _failures = 0

    @classmethod
    def available(cls):
        # Playwright's sync API is bound to the thread that created it: never
        # let a worker thread take the browser path.
        if threading.current_thread() is not threading.main_thread():
            return False
        return HAVE_PLAYWRIGHT and State.use_browser and cls._failures < 3

    @classmethod
    def _ensure(cls):
        if cls._context is not None:
            return cls._context
        cls._playwright = sync_playwright().start()
        args = ["--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-first-run",
                "--no-default-browser-check"]
        try:
            cls._browser = cls._playwright.chromium.launch(headless=True, args=args)
        except Exception:
            cls._browser = cls._playwright.chromium.launch(
                headless=True, args=args,
                executable_path=os.environ.get("CHROME_PATH") or None)
        cls._context = cls._browser.new_context(
            user_agent=UA_DESKTOP,
            locale="en-GB",
            viewport={"width": 1440, "height": 1000},
            timezone_id="Europe/London",
            geolocation={"latitude": 55.8609, "longitude": -4.2514},
            permissions=["geolocation"],
        )
        try:
            cls._context.add_init_script(
                "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
                "window.chrome = window.chrome || {runtime:{}};"
            )
        except Exception:
            pass
        cls._context.route("**/*", cls._route)
        return cls._context

    @staticmethod
    def _route(route):
        try:
            if route.request.resource_type in ("image", "media", "font"):
                route.abort()
            else:
                route.continue_()
        except Exception:
            try:
                route.continue_()
            except Exception:
                pass

    @classmethod
    def render(cls, url, wait_selector=None, wait_ms=2500, scroll_selector=None,
               max_scrolls=0, click_selectors=None, platform="default", timeout=45000,
               progress_js=None, wait_after_scroll=1400):
        """Render a URL and return a FetchResult (via='browser').

        scroll_selector may be:
          * a CSS selector  -> that element is scrolled to the bottom
          * "auto"          -> the largest scrollable container is scrolled
          * "js:<code>"     -> custom JS is evaluated between scroll ticks
        progress_js, when given, returns a comparable number used to stop
        scrolling once the page stops producing new content.
        """
        started = time.time()
        if not cls.available():
            return FetchResult(False, None, url, "", {}, "browser", "browser disabled or unavailable")
        throttle(platform)
        try:
            context = cls._ensure()
            page = context.new_page()
        except Exception as exc:
            cls._failures += 1
            log(f"browser launch failed: {str(exc)[:160]}", "warn")
            return FetchResult(False, None, url, "", {}, "browser", str(exc), time.time() - started)

        try:
            page.set_default_timeout(timeout)
            response = page.goto(url, wait_until="domcontentloaded", timeout=timeout)
            status = response.status if response else None
            if wait_ms:
                page.wait_for_timeout(wait_ms)
            if wait_selector:
                try:
                    page.wait_for_selector(wait_selector, timeout=min(timeout, 15000))
                except Exception:
                    log(f"selector not found: {wait_selector}", "debug")

            for selector in (click_selectors or []):
                if not selector:
                    continue
                try:
                    elements = page.locator(selector)
                    count = min(elements.count(), 12)
                    for i in range(count):
                        try:
                            elements.nth(i).click(timeout=1200)
                            page.wait_for_timeout(220)
                        except Exception:
                            continue
                except Exception:
                    continue

            if scroll_selector and max_scrolls:
                previous = -1
                for _ in range(max_scrolls):
                    try:
                        if scroll_selector == "auto":
                            page.evaluate(
                                "() => {"
                                "  const cards = [...document.querySelectorAll('div[data-review-id]')];"
                                "  let cands = [...document.querySelectorAll('div')].filter(e =>"
                                "      e.clientHeight > 220 && e.scrollHeight - e.clientHeight > 120 &&"
                                "      cards.some(c => e.contains(c)));"
                                "  if (!cands.length) {"
                                "    cands = [...document.querySelectorAll('div[role=\"main\"] div')]"
                                "      .filter(e => e.clientHeight > 220 && e.scrollHeight - e.clientHeight > 120);"
                                "  }"
                                "  if (!cands.length) { window.scrollTo(0, document.body.scrollHeight); return; }"
                                "  cands.sort((a, b) => (b.scrollHeight / b.clientHeight) - (a.scrollHeight / a.clientHeight));"
                                "  const el = cands[0];"
                                "  el.scrollBy(0, Math.max(600, el.clientHeight * 1.4));"
                                "  el.dispatchEvent(new Event('scroll', {bubbles: true}));"
                                "}")
                        elif scroll_selector.startswith("js:"):
                            page.evaluate(scroll_selector[3:])
                        else:
                            page.eval_on_selector(
                                scroll_selector,
                                "el => { el.scrollTop = el.scrollHeight; }")
                    except Exception:
                        break
                    page.wait_for_timeout(wait_after_scroll + random.randint(0, 400))
                    if progress_js:
                        try:
                            current = page.evaluate(progress_js)
                        except Exception:
                            break
                        if previous >= 0 and current <= previous:
                            break
                        previous = current

            html = page.content()
            final_url = page.url
            State.stats["browser_fetches"] += 1
            return FetchResult(200 <= (status or 200) < 400, status, final_url, html,
                               {}, "browser", None, time.time() - started)
        except Exception as exc:
            log(f"browser render failed [{platform}] {str(exc)[:140]}", "debug")
            return FetchResult(False, None, url, "", {}, "browser", str(exc), time.time() - started)
        finally:
            try:
                page.close()
            except Exception:
                pass

    @classmethod
    def close(cls):
        for obj in (cls._context, cls._browser):
            try:
                obj.close()
            except Exception:
                pass
        try:
            cls._playwright.stop()
        except Exception:
            pass
        cls._context = cls._browser = cls._playwright = None


# =========================================================================
# 5. CREDENTIALS & CACHE BOOTSTRAP
# =========================================================================
def load_credentials(cookies_path="cookies.json", tokens_path="tokens.json"):
    State.cookies = read_json(cookies_path, {}) if os.path.exists(cookies_path) else {}
    State.tokens = read_json(tokens_path, {}) if os.path.exists(tokens_path) else {}
    for env_key, token_key in (("FB_GRAPH_TOKEN", "fb_graph_token"),
                               ("TIKTOK_RESEARCH_TOKEN", "tiktok_research_token"),
                               ("GOOGLE_PLACES_API_KEY", "google_places_api_key"),
                               ("GOOGLE_MAPS_API_KEY", "google_places_api_key"),
                               ("SERPAPI_KEY", "serpapi_key")):
        value = os.environ.get(env_key)
        if value:
            State.tokens[token_key] = value
    if not isinstance(State.cookies, dict):
        State.cookies = {}
    if not isinstance(State.tokens, dict):
        State.tokens = {}
    if State.cookies:
        log(f"cookies loaded for: {', '.join(sorted(State.cookies))}")
    if State.tokens:
        log(f"tokens loaded for:  {', '.join(sorted(State.tokens))}")


def bootstrap_cache():
    State.cache_dir = os.path.join(State.output_root, "_cache")
    if State.use_cache:
        os.makedirs(State.cache_dir, exist_ok=True)


# =========================================================================
# 6. STRUCTURED DATA EXTRACTION (schema.org — the workhorse)
# =========================================================================
BUSINESS_TYPES = {
    "restaurant", "bar", "barorclub", "nightclub", "cafeorcoffeeshop", "bakery",
    "foodestablishment", "localbusiness", "hotel", "lodgingbusiness",
    "bedandbreakfast", "resort", "hostel", "motel", "attraction",
    "touristattraction", "store", "healthandbeautybusiness", "beautysalon",
    "hair salon", "hairsalon", "daySpa".lower(), "professionalservice",
    "organization", "corporation", "travelagency", "touristinformationcenter",
    "amusementpark", "museum", "entertainmentbusiness", "brewery", "winery",
    "distillery", "pub", "winery", "spa",
}
REVIEW_TYPES = {"review", "userreview"}


def jsonld_objects(soup):
    """Every JSON-LD object on the page, flattened (@graph aware)."""
    objects = []

    def push(node, depth=0):
        if depth > 4 or node is None:
            return
        if isinstance(node, list):
            for item in node:
                push(item, depth + 1)
            return
        if isinstance(node, dict):
            objects.append(node)
            if isinstance(node.get("@graph"), list):
                for item in node["@graph"]:
                    push(item, depth + 1)
            for value in node.values():
                if isinstance(value, (dict, list)) and value is not node.get("@graph"):
                    if isinstance(value, list) and value and isinstance(value[0], dict):
                        for item in value:
                            if isinstance(item, dict) and item.get("@type"):
                                push(item, depth + 1)

    for script in soup.find_all("script", type="application/ld+json"):
        raw = script.string or script.get_text() or ""
        raw = raw.strip()
        if not raw:
            continue
        raw = re.sub(r"^\s*<!--|-->\s*$", "", raw)
        try:
            push(json.loads(raw))
        except Exception:
            # Some sites emit trailing commas / bare objects; try a repair pass
            fixed = re.sub(r",\s*([}\]])", r"\1", raw)
            try:
                push(json.loads(fixed))
            except Exception:
                continue
    return objects


def _types_of(node):
    raw = node.get("@type") or node.get("type") or ""
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return set()
    return {str(t).strip().lower().replace(" ", "") for t in raw if t}


def is_business_node(node):
    return bool(_types_of(node) & BUSINESS_TYPES) or "aggregaterating" in {k.lower() for k in node}


def _first_url(value):
    if not value:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return value.get("url") or value.get("contentUrl") or value.get("src")
    if isinstance(value, list):
        for item in value:
            found = _first_url(item)
            if found:
                return found
    return None


def _all_urls(value):
    out = []
    if not value:
        return out
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, dict):
        for key in ("url", "contentUrl", "sameAs", "logo", "image"):
            if key in value:
                out.extend(_all_urls(value[key]))
    elif isinstance(value, list):
        for item in value:
            out.extend(_all_urls(item))
    return [u for u in out if isinstance(u, str)]


def normalize_address(value):
    if isinstance(value, str):
        return {"full": clean_text(value)}
    if not isinstance(value, dict):
        return None
    address = {
        "street": clean_text(value.get("streetAddress")),
        "city": clean_text(value.get("addressLocality")),
        "region": clean_text(value.get("addressRegion")),
        "postal": clean_text(value.get("postalCode")),
        "country": clean_text(value.get("addressCountry")),
    }
    if isinstance(address["country"], dict):
        address["country"] = clean_text(address["country"].get("name"))
    line = ", ".join(v for v in (address.get("street"), address.get("city"),
                                 address.get("region"), address.get("postal")) if v)
    if line:
        address["line"] = line
    return address or None


def normalize_hours(node):
    """Accept openingHoursSpecification | openingHours | text array."""
    hours = []
    spec = node.get("openingHoursSpecification") or node.get("openingHours")
    if isinstance(spec, dict):
        spec = [spec]
    if isinstance(spec, list):
        for item in spec:
            if isinstance(item, str):
                hours.append({"raw": clean_text(item)})
                continue
            if not isinstance(item, dict):
                continue
            days = item.get("dayOfWeek") or item.get("days")
            if isinstance(days, list):
                days = ", ".join(str(d).replace("https://schema.org/", "").replace("http://schema.org/", "") for d in days)
            def _hhmm(value):
                text = clean_text(value)
                if not text:
                    return None
                text = re.sub(r"^23:59(:59)?$", "00:00", text)
                return re.sub(r"^(\d{2}:\d{2}):\d{2}$", r"\1", text)

            hours.append({
                "days": clean_text(str(days).replace("https://schema.org/", "")) if days else None,
                "opens": _hhmm(item.get("opens")),
                "closes": _hhmm(item.get("closes")),
            })
    unique, seen = [], set()
    for entry in hours:
        if not (entry.get("raw") or entry.get("opens") or entry.get("closes")):
            continue
        key = (entry.get("days"), entry.get("opens"), entry.get("closes"), entry.get("raw"))
        if key in seen:
            continue
        seen.add(key)
        unique.append(entry)
    return unique


def normalize_review_node(node, source, base_url=None):
    if not isinstance(node, dict):
        return None
    rating_node = node.get("reviewRating") or node.get("rating") or {}
    if isinstance(rating_node, dict):
        raw_rating = rating_node.get("ratingValue")
        best = rating_node.get("bestRating") or 5
    else:
        raw_rating = rating_node
        best = 5
    rating, best = normalize_rating(raw_rating, best)
    author = node.get("author") or node.get("creator")
    if isinstance(author, dict):
        author = author.get("name") or author.get("@id")
    if isinstance(author, list):
        author = _first_url(author) or (author[0].get("name") if author and isinstance(author[0], dict) else None)
    date_raw = (node.get("datePublished") or node.get("dateCreated")
                or node.get("dateModified"))
    text = (node.get("reviewBody") or node.get("description")
            or node.get("text") or node.get("reviewAspect"))
    return {
        "source": source,
        "review_id": node.get("@id") or node.get("identifier") or None,
        "author": clean_text(author, 90) if author else None,
        "author_meta": None,
        "rating": rating,
        "rating_raw": raw_rating,
        "best_rating": best,
        "title": clean_text(node.get("name") or node.get("headline"), 160),
        "text": clean_text(text, 4000),
        "language": node.get("inLanguage"),
        "date": any_date_to_iso(date_raw),
        "date_raw": clean_text(str(date_raw)) if date_raw else None,
        "owner_response": None,
        "helpful": parse_count(node.get("positiveNotes") or node.get("voteCount")),
        "photos": len(node.get("image") or []) if isinstance(node.get("image"), list) else (1 if node.get("image") else 0),
        "url": abs_url(base_url, node.get("url")) if base_url else node.get("url"),
    }


def extract_schema_business(soup, base_url, source):
    """Pull the richest schema.org business record + reviews from a page."""
    out = {}
    objects = jsonld_objects(soup)
    business_nodes = [n for n in objects if is_business_node(n)]
    review_nodes = [n for n in objects if _types_of(n) & REVIEW_TYPES]

    node = None
    for candidate in business_nodes:
        if candidate.get("aggregateRating") or candidate.get("address") or candidate.get("name"):
            node = candidate
            break

    if node:
        out["name"] = clean_text(node.get("name"), 200)
        out["legal_name"] = clean_text(node.get("legalName"), 200)
        out["description"] = clean_text(node.get("description"), 1200)
        out["url"] = abs_url(base_url, node.get("url"))
        out["telephone"] = clean_text(node.get("telephone"), 60)
        out["email"] = clean_text(node.get("email"), 120)
        out["price_range"] = clean_text(node.get("priceRange"), 20)
        out["price_level"] = price_level_from(node.get("priceRange"))
        cuisine = node.get("servesCuisine")
        if isinstance(cuisine, str):
            cuisine = [c.strip() for c in re.split(r"[,/]", cuisine) if c.strip()]
        out["cuisine"] = [clean_text(c) for c in (cuisine or []) if c][:8]
        out["categories"] = [clean_text(node.get("category"))] if node.get("category") else []
        out["address"] = normalize_address(node.get("address"))
        geo = node.get("geo") or {}
        if isinstance(geo, dict):
            lat, lon = to_float(geo.get("latitude")), to_float(geo.get("longitude"))
            if lat is not None and lon is not None:
                out["geo"] = {"lat": lat, "lon": lon}
        hours = normalize_hours(node)
        if hours:
            out["hours"] = hours
        same_as = [u for u in _all_urls(node.get("sameAs")) if isinstance(u, str) and u.startswith("http")]
        if same_as:
            out["same_as"] = dedupe(same_as)
        images = [u for u in _all_urls(node.get("image")) if isinstance(u, str) and u.startswith("http")]
        if images:
            out["images"] = dedupe(images)[:12]
        logo = _first_url(node.get("logo"))
        if logo:
            out["logo"] = logo
        menu = _first_url(node.get("hasMenu") or node.get("menu"))
        if menu:
            out["menu_url"] = abs_url(base_url, menu)
        accepts = node.get("acceptsReservations")
        if accepts is not None:
            out["accepts_reservations"] = str(accepts).lower() in ("true", "1", "yes")

        agg = node.get("aggregateRating")
        if isinstance(agg, dict):
            rating, best = normalize_rating(agg.get("ratingValue"), agg.get("bestRating"))
            out["rating"] = {
                "value": rating,
                "count": parse_count(agg.get("reviewCount") or agg.get("ratingCount")),
                "best": best,
                "worst": to_float(agg.get("worstRating")),
            }
        elif "rating" not in out:
            # microdata fallback
            el = soup.find(attrs={"itemprop": "ratingValue"})
            cnt = soup.find(attrs={"itemprop": "reviewCount"}) or soup.find(attrs={"itemprop": "ratingCount"})
            if el and (el.get("content") or el.get_text(strip=True)):
                rating, best = normalize_rating(el.get("content") or el.get_text(strip=True))
                out["rating"] = {"value": rating,
                                 "count": parse_count((cnt.get("content") or cnt.get_text(strip=True)) if cnt else None),
                                 "best": best}

        reviews = []
        for item in (node.get("review") or []):
            normalized = normalize_review_node(item, source, base_url)
            if normalized and (normalized.get("text") or normalized.get("author")):
                reviews.append(normalized)
        for item in review_nodes:
            normalized = normalize_review_node(item, source, base_url)
            if normalized and (normalized.get("text") or normalized.get("author")):
                reviews.append(normalized)
        if reviews:
            out["reviews"] = dedupe(reviews)

    # Meta tags are a dependable secondary source of name/description/image
    meta = meta_tags(soup)
    if not out.get("name"):
        out["name"] = clean_text(meta.get("og:title") or meta.get("title"), 200)
    if not out.get("description"):
        out["description"] = clean_text(meta.get("og:description") or meta.get("description"), 900)
    if meta.get("og:image") and not out.get("images"):
        out["images"] = [meta["og:image"]]
    if not out.get("url"):
        out["url"] = meta.get("og:url") or base_url
    return out


def meta_tags(soup):
    """All name/property/itemprop meta tags, plus <title>."""
    meta = {}
    title = soup.find("title")
    if title:
        meta["title"] = clean_text(title.get_text(), 300)
    for tag in soup.find_all("meta"):
        key = (tag.get("property") or tag.get("name") or tag.get("itemprop") or "").strip().lower()
        content = tag.get("content")
        if key and content and key not in meta:
            meta[key] = clean_text(content, 1000)
    return meta


def extract_hours_from_text(text):
    """Parse 'Mon 12:00-00:00' style blobs into structured hours."""
    if not text:
        return []
    day_re = r"(mon|tue|wed|thu|fri|sat|sun)[a-z]*"
    hours = []
    for m in re.finditer(rf"({day_re}\s*(?:-|–|to)\s*{day_re})\s*[:\s]\s*"
                         r"(\d{{1,2}}[:.]?\d{{0,2}}\s*(?:am|pm)?)\s*(?:-|–|to)\s*"
                         r"(\d{{1,2}}[:.]?\d{{0,2}}\s*(?:am|pm)?)", text, re.I):
        hours.append({"days": m.group(1).title(),
                      "opens": m.group(2).strip(),
                      "closes": m.group(3).strip()})
    return hours


EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(?\d{1,4}\)?[\s.-]?){2,4}\d{2,4}")


def find_emails(text, limit=10):
    if not text:
        return []
    found = []
    for match in EMAIL_RE.findall(text):
        low = match.lower()
        if any(low.endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js")):
            continue
        if low.startswith(("example@", "you@", "name@", "email@")):
            continue
        if low not in found:
            found.append(low)
    return found[:limit]


def find_phones(text, limit=8):
    """Conservative phone extraction: drops the numeric noise found in JS."""
    if not text:
        return []
    out = []
    # PDF sizes / CSS values ("0.0 0.0 595.276") look phone-ish after stripping
    cleaned = re.sub(r"\d+\.\d+", " ", text)
    for match in re.finditer(
            r"(?<![\d.+])(?:\+|00)?(?:\(?\d{1,4}\)?[\s.\-]?){2,5}\d{2,4}(?![\d.])", cleaned):
        raw = re.sub(r"\s+", " ", match.group(0)).strip(" .-")
        digits = re.sub(r"\D", "", raw)
        if not (9 <= len(digits) <= 13):
            continue
        if "000000" in digits:          # asset ids, tracking ids, timestamps
            continue
        if not raw.startswith(("+", "00", "0", "(")) and " " not in raw and "-" not in raw:
            continue                    # unformatted long number: likely an id
        if digits.startswith("0") and len(digits) not in (10, 11):
            continue
        if raw not in out:
            out.append(raw)
    return out[: max(limit, 8)]


# =========================================================================
# 7. WEB SEARCH (discovery + press mentions)
# =========================================================================
def _decode_bing_url(href):
    href = unescape(href or "")
    if "bing.com/ck/a" not in href:
        return href
    try:
        query = up.parse_qs(up.urlparse(href).query)
        raw = (query.get("u") or [""])[0]
        if raw.startswith("a1"):
            raw = raw[2:]
        raw = raw.replace("-", "+").replace("_", "/")
        raw += "=" * (-len(raw) % 4)
        decoded = base64.urlsafe_b64decode(raw).decode("utf-8", "ignore")
        return decoded if decoded.startswith("http") else href
    except Exception:
        return href


def _parse_bing(html):
    """Bing's result markup is malformed (`data-id iid=SERP.1`), and HTML
    parsers silently drop the class attribute — so parse it with regexes."""
    results = []
    for block in re.findall(r'<li class="b_algo".*?(?=<li class="b_algo"|</ol>)',
                            html, re.S):
        link = re.search(r'<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        if not link:
            link = re.search(r'<a[^>]*class="tilk"[^>]*href="([^"]+)"', block, re.S)
            if not link:
                continue
            url, title_html = link.group(1), ""
        else:
            url, title_html = link.group(1), link.group(2)
        url = _decode_bing_url(url)
        if not url.startswith("http"):
            continue
        snippet = re.search(r'<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>(.*?)</p>', block, re.S) \
            or re.search(r'<p[^>]*>(.*?)</p>', block, re.S)
        results.append({
            "url": url,
            "title": clean_text(re.sub(r"<[^>]+>", "", title_html), 200),
            "snippet": clean_text(re.sub(r"<[^>]+>", " ", snippet.group(1)), 400) if snippet else None,
        })
    if results:
        return results
    # very defensive fallback: outbound links in the results list
    soup = BeautifulSoup(html, "lxml")
    for anchor in soup.select("ol#b_results a[href^='http'], #b_results a[href^='http']")[:20]:
        results.append({"url": anchor.get("href"),
                        "title": clean_text(anchor.get_text(), 160),
                        "snippet": None})
    return results


def _parse_ddg(html):
    soup = BeautifulSoup(html, "lxml")
    results = []
    for link in soup.select("a.result__a[href]"):
        href = unescape(link.get("href") or "")
        match = re.search(r"uddg=([^&]+)", href)
        url = up.unquote(match.group(1)) if match else href
        if not url.startswith("http"):
            continue
        snippet = link.find_parent("div", class_="result")
        snippet_el = snippet.select_one(".result__snippet") if snippet else None
        results.append({"url": url, "title": clean_text(link.get_text(), 200),
                        "snippet": clean_text(snippet_el.get_text(), 400) if snippet_el else None})
    return results


def web_search(query, market="en-GB", count=20, allow_cache=True):
    """Bing first (most reliable HTML), DuckDuckGo as a fallback.

    Note: result relevance depends on the caller's IP geolocation. The
    `mkt`/`cc`/`ensearch` triple keeps the locale pinned to the target
    market, and empty responses are never cached.
    """
    key = f"{query}|{market}"
    if allow_cache and key in State.search_cache:
        return State.search_cache[key]

    lang, _, country = market.partition("-")

    def _bing(q):
        result = fetch("https://www.bing.com/search", platform="search", params={
            "q": q, "count": str(count), "mkt": market, "setmkt": market,
            "setlang": lang, "cc": (country or "GB").upper(), "ensearch": "1",
            "form": "QBRE",
        })
        if result.ok and 'class="b_algo"' in result.text:
            return _parse_bing(result.text)
        return []

    def _ddg(q):
        result = fetch("https://html.duckduckgo.com/html/", platform="search",
                       params={"q": q, "kl": "uk-en"})
        if result.ok and "result__a" in result.text:
            return _parse_ddg(result.text)
        return []

    engine = "bing"
    results = _bing(query)
    if not results:
        # Quoted phrases often return nothing; retry unquoted once.
        relaxed = re.sub(r'"', "", query).strip()
        if relaxed and relaxed != query:
            results = _bing(relaxed)
    if not results:
        engine = "duckduckgo"
        results = _ddg(query)
    State.stats[f"search_{engine}"] += 1
    log(f"search [{engine}] {query!r} -> {len(results)} results", "debug")
    if allow_cache and results:
        State.search_cache[key] = results
    return results


# =========================================================================
# 8. PROFILE URL PATTERNS + DISCOVERY
# =========================================================================
SOCIAL_URL_PATTERNS = {
    "instagram": re.compile(r"(?:https?://)?(?:www\.)?instagram\.com/(?!p/|reel/|explore/|accounts/|stories/)([A-Za-z0-9_.]{2,40})", re.I),
    "facebook": re.compile(r"(?:https?://)?(?:[a-z]{2}-[a-z]{2}\.)?(?:www\.|m\.|web\.)?facebook\.com/(?!login|watch|sharer|share\.php|dialog|plugins|photo|event|groups|hashtag|permalink)([A-Za-z0-9_.\-]{2,120})", re.I),
    "tiktok": re.compile(r"(?:https?://)?(?:www\.)?tiktok\.com/@([A-Za-z0-9_.]{2,40})", re.I),
    "youtube": re.compile(r"(?:https?://)?(?:www\.|m\.)?youtube\.com/(?:@|c/|channel/|user/)([A-Za-z0-9_.\-]{2,80})", re.I),
    "x": re.compile(r"(?:https?://)?(?:www\.|mobile\.)?(?:x|twitter)\.com/(?!i/|intent|share|home|hashtag|search)([A-Za-z0-9_]{2,15})(?:/|$)", re.I),
    "threads": re.compile(r"(?:https?://)?(?:www\.)?threads\.(?:net|com)/@([A-Za-z0-9_.]{2,40})", re.I),
    "pinterest": re.compile(r"(?:https?://)?(?:[a-z]{2}\.)?(?:www\.)?pinterest\.(?:com|co\.uk)/([A-Za-z0-9_\-]{2,50})/?(?:$|\?)", re.I),
    "linkedin": re.compile(r"(?:https?://)?(?:[a-z]{2}\.)?(?:www\.)?linkedin\.com/(?:company|in)/([A-Za-z0-9_\-%]{2,90})", re.I),
    "snapchat": re.compile(r"(?:https?://)?(?:www\.)?snapchat\.com/add/([A-Za-z0-9_.\-]{2,40})", re.I),
}

CANONICAL_URL = {
    "instagram": "https://www.instagram.com/{}/",
    "facebook": "https://www.facebook.com/{}/",
    "tiktok": "https://www.tiktok.com/@{}",
    "youtube": "https://www.youtube.com/{}",
    "x": "https://x.com/{}",
    "threads": "https://www.threads.net/@{}",
    "pinterest": "https://www.pinterest.com/{}/",
    "linkedin": "https://www.linkedin.com/company/{}/",
    "snapchat": "https://www.snapchat.com/add/{}",
}

# Non-profile facebook paths that should never be treated as a page handle
FB_NON_HANDLE = {"tr", "pages", "profile.php", "people", "business", "help",
                 "policies", "privacy", "legal", "photo.php", "story.php",
                 "permalink.php", "watch", "reel", "reels", "events", "fundraisers"}

PLATFORM_REVIEW_DOMAINS = {
    "tripadvisor": ["tripadvisor.", "tripadvisor.co"],
    "yelp": ["yelp."],
    "trustpilot": ["trustpilot."],
    "opentable": ["opentable."],
    "thefork": ["thefork.", "bookatable."],
    "quandoo": ["quandoo."],
    "booking": ["booking.com"],
    "expedia": ["expedia."],
    "michelin": ["guide.michelin.com"],
    "foursquare": ["foursquare.com"],
    "zomato": ["zomato.com"],
    "restaurantguru": ["restaurantguru."],
    "google": ["google.com/maps", "goo.gl/maps", "maps.app.goo.gl", "g.co/kgs"],
}


def handle_from_url(platform, url):
    pattern = SOCIAL_URL_PATTERNS.get(platform)
    if not pattern or not url:
        return None
    match = pattern.search(url)
    if not match:
        return None
    handle = match.group(1).strip().strip("/")
    handle = handle.split("?")[0]
    if platform == "facebook" and handle.lower() in FB_NON_HANDLE:
        return None
    if platform == "youtube":
        handle = handle.replace("channel/", "")
    return handle or None


def canonical_social_url(platform, handle):
    if not handle:
        return None
    if platform == "youtube" and handle.startswith("UC") and len(handle) > 20:
        return f"https://www.youtube.com/channel/{handle}"
    template = CANONICAL_URL.get(platform)
    return template.format(handle) if template else None


def classify_url(url):
    """Return (platform_key, handle) for links that map to a known platform."""
    if not url:
        return None, None
    low = url.lower()
    for platform in SOCIAL_URL_PATTERNS:
        handle = handle_from_url(platform, url)
        if handle:
            return platform, handle
    for source, markers in PLATFORM_REVIEW_DOMAINS.items():
        if any(marker in low for marker in markers):
            return source, None
    return None, None


def link_harvest(soup, base_url):
    """All outbound links grouped by platform, from anchors + JSON-LD sameAs."""
    found = defaultdict(list)
    for anchor in soup.find_all("a", href=True):
        url = abs_url(base_url, anchor["href"])
        if not url:
            continue
        platform, handle = classify_url(url)
        if platform:
            found[platform].append({"url": url.split("?")[0] if platform in SOCIAL_SOURCES else url,
                                    "handle": handle,
                                    "text": clean_text(anchor.get_text(), 80)})
    for node in jsonld_objects(soup):
        for url in _all_urls(node.get("sameAs")):
            if not isinstance(url, str):
                continue
            platform, handle = classify_url(url)
            if platform:
                found[platform].append({"url": url, "handle": handle, "text": "sameAs"})
    return found


def discover_from_website(business):
    """Crawl the business site shallowly; harvest profiles + facts."""
    websites = []
    if business.get("website"):
        websites.append(business["website"])
    result = {"website": None, "pages": [], "links": {}, "facts": {}, "warnings": []}
    if not websites:
        return result

    site = websites[0]
    fetched = 0
    queue = [site]
    seen = set()
    text_blob_parts = []
    external_urls = []
    external_hosts = Counter()
    while queue and fetched < MAX_PAGES_WEBSITE:
        url = queue.pop(0)
        key = url.rstrip("/").lower()
        if key in seen:
            continue
        seen.add(key)
        page = fetch(url, platform="website")
        if (not page.ok or len(page.text or "") < 800) and Browser.available() and fetched == 0:
            log(f"website: escalating to browser for {url[:70]}", "debug")
            page = Browser.render(url, wait_selector="body", wait_ms=2500,
                                  platform="default")
        fetched += 1
        if not page.ok or not page.text:
            result["warnings"].append(f"website fetch failed: {url} ({page.status or page.error})")
            continue
        if fetched == 1:
            result["website"] = page.url
        soup = page.soup
        schema = extract_schema_business(soup, page.url, "website")
        title = (meta_tags(soup).get("title") or "")[:160]
        result["pages"].append({"url": page.url, "title": title,
                                "schema": bool(schema.get("rating") or schema.get("address"))})
        if fetched == 1:
            result["facts"].update({k: v for k, v in schema.items() if k != "reviews"})
        else:
            for key_name, value in schema.items():
                if key_name in ("telephone", "email", "hours", "address", "geo",
                                "menu_url", "price_range") and value:
                    result["facts"].setdefault(key_name, value)

        # visible text of the page feeds email / phone / hours parsing
        try:
            text_blob_parts.append(soup.get_text(" ", strip=True)[:20000])
        except Exception:
            pass
        text_hours = extract_hours_from_text(text_blob_parts[-1] if text_blob_parts else "")
        if text_hours:
            result["facts"].setdefault("hours", text_hours)

        if not result["facts"].get("menu_url"):
            for anchor in soup.find_all("a", href=True):
                href = abs_url(page.url, anchor["href"])
                label = normalize_text(anchor.get_text())
                if href and ("menu" in label or "menu" in href.lower()) \
                        and not href.lower().endswith((".jpg", ".png", ".webp", ".jpeg")):
                    result["facts"]["menu_url"] = href
                    break

        links = link_harvest(soup, page.url)
        for platform, entries in links.items():
            existing = {e["url"] for e in result["links"].get(platform, [])}
            for entry in entries:
                if entry["url"] not in existing:
                    result["links"].setdefault(platform, []).append(entry)

        # every outbound link (booking / delivery / press / partners)
        for anchor in soup.find_all("a", href=True):
            href = abs_url(page.url, anchor["href"])
            if not href:
                continue
            host = domain_of(href)
            if host and not same_host(href, site):
                external_hosts[host] += 1
                if href not in external_urls and len(external_urls) < 400:
                    external_urls.append(href.split("#")[0])
            if not same_host(href, site):
                continue
            text = normalize_text(anchor.get_text())
            if re.search(r"contact|about|menu|book|reserv|find-?us|location|hours|private|gift", text) \
                    or re.search(r"/(contact|about|menu|book|reserv|find-?us|location|hours|gift)", href.lower()):
                if href.rstrip("/").lower() not in seen and len(queue) < MAX_PAGES_WEBSITE * 2:
                    queue.append(href)

    blob = "\n".join(text_blob_parts)
    result["facts"]["emails"] = find_emails(blob)
    result["facts"]["phones"] = find_phones(blob)
    result["external_urls"] = external_urls
    result["external_hosts"] = external_hosts.most_common(40)
    if not result["facts"].get("telephone") and result["facts"]["phones"]:
        result["facts"]["telephone"] = result["facts"]["phones"][0]
    return result


def discover_profiles(business):
    """Resolve platform profiles: seeds > website links > aggregators > search."""
    profiles = {}
    evidence = {}
    website_data = discover_from_website(business)
    links = website_data.get("links", {})

    for platform, entries in links.items():
        if platform in SOCIAL_SOURCES or platform in REVIEW_SOURCES:
            handles = [e for e in entries if e.get("handle")]
            if handles:
                profiles.setdefault(platform, handles[0]["url"] if platform not in SOCIAL_SOURCES
                                    else canonical_social_url(platform, handles[0]["handle"]))
                evidence[platform] = "website"
            elif entries:
                profiles.setdefault(platform, entries[0]["url"])
                evidence[platform] = "website"

    schema_links = website_data.get("facts", {}).get("same_as") or []
    for url in schema_links:
        platform, handle = classify_url(url)
        if platform and platform not in profiles:
            profiles[platform] = canonical_social_url(platform, handle) if platform in SOCIAL_SOURCES and handle else url
            evidence[platform] = "website-schema"

    # Seeds override discovered values (human-confirmed)
    for platform, url in (business.get("profiles") or {}).items():
        if url:
            profiles[platform] = url
            evidence[platform] = "seed"

    return {
        "profiles": profiles,
        "evidence": evidence,
        "website": website_data,
    }


def handle_variants(business, limit=10):
    """Plausible handles for a business, cheapest-to-verify first."""
    name = business["name"]
    city = (business.get("city") or "").lower()
    words = [w for w in re.split(r"[^A-Za-z0-9]+", name.lower()) if w]
    joined = "".join(words)
    two_word = "".join(words[:2]) if len(words) >= 2 else joined
    variants = [
        f"{joined}{city}" if city else None,
        f"{two_word}{city}" if city and two_word else None,
        f"{joined}_{city}" if city else None,
        f"{'-'.join(words)}-{city}" if city else "-".join(words),
        joined,
        two_word,
    ]
    if len(words) >= 2:
        first, last = words[0], words[-1]
        variants += [
            f"{first}_{last}",
            f"{first}{last}",
            f"{first}-{last}",
            f"{first}_{city}" if city else None,
            f"{first}{city}" if city else None,
        ]
    out = []
    for variant in variants:
        if not variant:
            continue
        variant = re.sub(r"[^a-z0-9_.-]", "", variant)[:40]
        if variant and variant not in out:
            out.append(variant)
    return out[: max(limit, 10)]


def discover_by_handle_guess(business, platform, limit=10):
    """No search / no links? Try plausible handles and verify the page title.

    Candidates are scored, not just accepted: an exact city match and a
    follower count in the meta description beat a bare name match.
    """
    if platform not in ("instagram", "facebook"):
        return None
    tokens = brand_tokens(business["name"])
    city_key = normalize_text(business.get("city") or "")
    best = (0.0, None)
    for handle in handle_variants(business, limit):
        url = (f"https://www.instagram.com/{handle}/" if platform == "instagram"
               else f"https://www.facebook.com/{handle}/")
        page = fetch(url, platform=platform, use_cache=False)
        if not page.ok or len(page.text) < 4000:
            continue
        meta = meta_tags(page.soup)
        title = meta.get("og:title") or meta.get("title") or ""
        desc = meta.get("og:description") or ""
        haystack = normalize_text(f"{title} {desc}")
        hits = sum(1 for token in tokens if token in haystack)
        if hits == 0:
            continue
        display = re.sub(r"\s*\(@[^)]*\)|\s*[•|·].*$", "", title).strip()
        score = similarity(display or title, business["name"]) + 0.05 * hits
        if city_key and city_key in haystack:
            score += 0.25
        if city_key and city_key in normalize_text(handle):
            score += 0.15
        if re.search(r"[\d,.]+[KMB]?\s*[Ff]ollowers?", desc):
            score += 0.2
        if score > best[0]:
            best = (score, handle)
    if best[1] and best[0] >= 0.6:
        log(f"discovery: guessed {platform} handle '{best[1]}' (score {best[0]:.2f})", "ok")
        return (f"https://www.instagram.com/{best[1]}/" if platform == "instagram"
                else f"https://www.facebook.com/{best[1]}/")
    return None


def search_for_profile(business, platform):
    """Search-engine fallback for a missing profile."""
    city = business.get("city") or ""
    if platform in SOCIAL_SOURCES:
        domain = {"instagram": "instagram.com", "facebook": "facebook.com",
                  "tiktok": "tiktok.com", "youtube": "youtube.com",
                  "x": "x.com", "threads": "threads.net",
                  "pinterest": "pinterest.com", "linkedin": "linkedin.com",
                  "snapchat": "snapchat.com"}[platform]
        query = f'site:{domain} "{business["name"]}" {city}'.strip()
    else:
        domain = {"tripadvisor": "tripadvisor.com", "yelp": "yelp.com",
                  "trustpilot": "trustpilot.com", "opentable": "opentable.co.uk",
                  "thefork": "thefork.co.uk", "restaurantguru": "restaurantguru.com",
                  "booking": "booking.com", "michelin": "guide.michelin.com",
                  "foursquare": "foursquare.com", "zomato": "zomato.com",
                  "quandoo": "quandoo.co.uk"}.get(platform, "google.com/maps")
        query = f'site:{domain} "{business["name"]}" {city}'.strip()

    results = web_search(query)
    scored = []
    tokens = name_tokens(business["name"])
    for item in results:
        platform_guess, handle = classify_url(item["url"])
        if platform_guess != platform:
            continue
        haystack = normalize_text(f"{item.get('title','')} {item.get('snippet','')} {item.get('url','')}")
        overlap = sum(1 for token in tokens if token in haystack)
        city_bonus = 2 if city and normalize_text(city) in haystack else 0
        handle_bonus = 1 if handle and any(token in normalize_text(handle) for token in tokens) else 0
        score = overlap + city_bonus + handle_bonus
        if overlap >= 1:
            scored.append((score, item["url"], handle))
    scored.sort(reverse=True)
    if not scored:
        return None
    return scored[0][1]


# =========================================================================
# 9. CONNECTOR INFRASTRUCTURE
# =========================================================================
class BizContext:
    """Everything a connector needs, scoped to one business."""

    def __init__(self, business, discovery, output_dir):
        self.business = business
        self.profiles = discovery.get("profiles", {})
        self.evidence = discovery.get("evidence", {})
        self.website = discovery.get("website", {})
        self.output_dir = output_dir
        self.platforms_dir = os.path.join(output_dir, "platforms")
        self.assets_dir = os.path.join(output_dir, "assets")
        self.raw_dir = os.path.join(self.platforms_dir, "raw")
        self.results = {}
        for path in (self.output_dir, self.platforms_dir, self.assets_dir):
            os.makedirs(path, exist_ok=True)

    @property
    def name(self):
        return self.business["name"]

    @property
    def city(self):
        return self.business.get("city") or ""

    @property
    def country(self):
        return self.business.get("country") or "United Kingdom"

    def url_for(self, source):
        return self.profiles.get(source)

    def query(self, include_city=True):
        parts = [self.business["name"]]
        if include_city and self.city:
            parts.append(self.city)
        if self.country and "United Kingdom" not in self.country:
            parts.append(self.country)
        return ", ".join(parts)

    def save_raw(self, source, text, suffix="html"):
        if not KEEP_RAW_HTML or not text:
            return None
        try:
            os.makedirs(self.raw_dir, exist_ok=True)
            path = os.path.join(self.raw_dir, f"{source}.{suffix}")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text)
            return rel_to(path, self.output_dir)
        except OSError:
            return None

    def asset_dir(self, source, *parts):
        path = os.path.join(self.assets_dir, source, *parts)
        os.makedirs(path, exist_ok=True)
        return path


def new_result(source, url=None, mode=None):
    return {
        "source": source,
        "label": SOURCE_LABELS.get(source, (source,))[0],
        "url": url,
        "mode": mode,
        "ok": False,
        "fetched_at": iso_now(),
        "business": {},
        "rating": {},
        "reviews": [],
        "metrics": {},
        "profile": {},
        "topics": [],
        "posts": [],
        "links": {},
        "assets": {},
        "warnings": [],
    }


def finalize(result):
    reviews = result.get("reviews") or []
    rating = result.get("rating") or {}
    if reviews:
        values = [r["rating"] for r in reviews if r.get("rating")]
        if values and not rating.get("value"):
            rating["value"] = round(statistics.mean(values), 2)
        if not rating.get("count"):
            rating["count"] = len(reviews)
        result["rating"] = rating
    result["review_count_collected"] = len(reviews)
    result["ok"] = bool(rating.get("value") or rating.get("count") or reviews
                        or result.get("profile") or result.get("posts")
                        or result.get("business") or result.get("mentions")
                        or result.get("compliance"))
    return result


CONNECTORS = {}


def register(source, tier="http", requires=None):
    def decorator(fn):
        CONNECTORS[source] = {"source": source, "fn": fn, "tier": tier,
                              "requires": requires}
        return fn
    return decorator


# ---- shared page-level heuristics --------------------------------------
RATING_PATTERNS = [
    re.compile(r'"ratingValue"\s*:\s*"?([0-9.]+)"?'),
    re.compile(r'"aggregateRating".{0,200}?"ratingValue"\s*:\s*"?([0-9.]+)"?', re.S),
    re.compile(r'([0-9](?:[.,][0-9])?)\s*(?:out of|/)\s*5'),
    re.compile(r'([0-9](?:[.,][0-9])?)\s*stars?', re.I),
    re.compile(r'itemprop="ratingValue"[^>]*content="([0-9.]+)"'),
]
COUNT_PATTERNS = [
    re.compile(r'"reviewCount"\s*:\s*"?([0-9,]+)"?'),
    re.compile(r'"ratingCount"\s*:\s*"?([0-9,]+)"?'),
    re.compile(r'itemprop="reviewCount"[^>]*content="([0-9,]+)"'),
    re.compile(r'([\d,]{2,})\s*(?:reviews|ratings|avis|recensioni)', re.I),
]


def guess_rating_from_text(text, source):
    """Last-resort rating/count extraction from raw HTML or visible text."""
    if not text:
        return {}
    rating, count = None, None
    for pattern in RATING_PATTERNS:
        match = pattern.search(text)
        if match:
            value, _ = normalize_rating(match.group(1))
            if value and 0 < value <= 5:
                rating = value
                break
    for pattern in COUNT_PATTERNS:
        match = pattern.search(text)
        if match:
            count = parse_count(match.group(1))
            if count and count > 0:
                break
    return {"value": rating, "count": count}


def blocked_reason(result):
    """Human hint for common bot walls."""
    if result is None:
        return "no response"
    low = (result.text or "")[:3000].lower()
    if result.status in (401, 403):
        if "captcha" in low or "unusual traffic" in low:
            return f"HTTP {result.status} bot challenge"
        if "cloudflare" in low or "just a moment" in low:
            return f"HTTP {result.status} Cloudflare challenge"
        return f"HTTP {result.status} forbidden"
    if result.status == 404:
        return "HTTP 404 not found"
    if result.status == 429:
        return "HTTP 429 rate limited"
    if result.error:
        return result.error
    return f"HTTP {result.status}"


# =========================================================================
# 10. GOOGLE (Places API -> Maps place page)
# =========================================================================
def _places_api_lookup(ctx):
    """Tier 1: Places API (New) searchText. Returns partial result or None."""
    token = State.tokens.get("google_places_api_key")
    if not token:
        return None
    body = {
        "textQuery": ctx.query(),
        "languageCode": "en",
        "regionCode": "GB",
        "maxResultCount": 1,
    }
    fields = ",".join([
        "places.id", "places.displayName", "places.formattedAddress",
        "places.shortFormattedAddress", "places.location", "places.rating",
        "places.userRatingCount", "places.priceLevel", "places.priceRange",
        "places.nationalPhoneNumber", "places.internationalPhoneNumber",
        "places.websiteUri", "places.googleMapsUri", "places.googleMapsLinks",
        "places.regularOpeningHours", "places.currentOpeningHours",
        "places.types", "places.primaryTypeDisplayName",
        "places.editorialSummary", "places.businessStatus",
        "places.servesCuisine", "places.takeout", "places.delivery",
        "places.dineIn", "places.reservable", "places.reviews",
        "places.attributions", "places.iconMaskBaseUri", "places.photos",
    ])
    throttle("google")
    try:
        resp = _session("google").post(
            "https://places.googleapis.com/v1/places:searchText",
            headers={"Content-Type": "application/json",
                     "X-Goog-Api-Key": token,
                     "X-Goog-FieldMask": fields},
            json=body, timeout=REQUEST_TIMEOUT)
    except requests.RequestException as exc:
        log(f"places API failed: {exc}", "warn")
        return None
    if resp.status_code >= 400:
        log(f"places API HTTP {resp.status_code}: {resp.text[:200]}", "warn")
        return None
    try:
        payload = resp.json()
    except ValueError:
        return None
    places = payload.get("places") or []
    if not places:
        return None
    place = places[0]

    def _text(value):
        if isinstance(value, dict):
            return clean_text(value.get("text") or value.get("languageCode"))
        return clean_text(value)

    hours = []
    hours_block = place.get("regularOpeningHours") or {}
    for line in hours_block.get("weekdayDescriptions") or []:
        if ":" in line:
            day, _, rest = line.partition(":")
            hours.append({"days": day.strip(), "opens": rest.strip()})
    reviews = []
    for item in place.get("reviews") or []:
        author = (item.get("authorAttribution") or {}).get("displayName")
        text_block = item.get("text") or {}
        original = item.get("originalText") or {}
        reviews.append({
            "source": "google",
            "review_id": item.get("name"),
            "author": clean_text(author, 90),
            "author_meta": {"uri": (item.get("authorAttribution") or {}).get("uri")},
            "rating": to_float(item.get("rating")),
            "rating_raw": item.get("rating"),
            "best_rating": 5.0,
            "title": None,
            "text": clean_text(text_block.get("text") or original.get("text"), 4000),
            "language": text_block.get("languageCode") or original.get("languageCode"),
            "date": (item.get("publishTime") or "")[:10] or None,
            "date_raw": item.get("relativePublishTimeDescription"),
            "owner_response": None,
            "helpful": None,
            "photos": len(item.get("photos") or []),
            "url": item.get("googleMapsUri"),
        })
    price_level = None
    if place.get("priceLevel"):
        price_level = {"PRICE_LEVEL_INEXPENSIVE": 1, "PRICE_LEVEL_MODERATE": 2,
                       "PRICE_LEVEL_EXPENSIVE": 3, "PRICE_LEVEL_VERY_EXPENSIVE": 4}.get(place["priceLevel"])
    business = {
        "name": _text(place.get("displayName")),
        "address": {"full": place.get("formattedAddress"),
                    "short": place.get("shortFormattedAddress")},
        "geo": {"lat": (place.get("location") or {}).get("latitude"),
                "lon": (place.get("location") or {}).get("longitude")},
        "phone": place.get("nationalPhoneNumber") or place.get("internationalPhoneNumber"),
        "website": place.get("websiteUri"),
        "hours": hours,
        "categories": [clean_text((place.get("primaryTypeDisplayName") or {}).get("text"))]
                      + [clean_text(t.replace("_", " ")) for t in (place.get("types") or [])][:6],
        "price_level": price_level,
        "description": _text(place.get("editorialSummary")),
        "cuisine": [clean_text(c) for c in (place.get("servesCuisine") or [])],
        "status": place.get("businessStatus"),
        "attributes": {k: place.get(k) for k in ("takeout", "delivery", "dineIn", "reservable")
                       if place.get(k) is not None},
    }
    return {
        "mode": "places-api",
        "url": place.get("googleMapsUri"),
        "place_id": place.get("id"),
        "business": business,
        "rating": {"value": to_float(place.get("rating")),
                   "count": parse_count(place.get("userRatingCount")),
                   "best": 5.0},
        "reviews": reviews,
        "metrics": {"business_status": place.get("businessStatus")},
    }


MAPS_JS_REVIEW_COUNT = "() => new Set([...document.querySelectorAll('div[data-review-id]')].map(e=>e.getAttribute('data-review-id'))).size"


def _maps_extract(soup, url):
    """Parse a rendered Google Maps place page (DOM classes churn, so layered)."""
    data = {"business": {}, "rating": {}, "reviews": [], "topics": [],
            "metrics": {}, "warnings": []}
    business = data["business"]

    heading = soup.select_one("h1.DUwDvf") or soup.select_one("h1")
    if heading:
        business["name"] = clean_text(heading.get_text(), 200)

    # ---- overall rating + review count --------------------------------
    rating_value = None
    for node in soup.find_all(attrs={"aria-label": re.compile(r"stars?$", re.I)}):
        label = clean_text(node.get("aria-label"), 40) or ""
        match = re.fullmatch(r"([0-5](?:\.\d)?)\s+stars?", label.strip(), re.I)
        if match:
            rating_value = to_float(match.group(1))
            break
    if rating_value is None:
        for node in soup.select("div.F7nice span[aria-hidden='true'], span.ceNzKf, div.F7nice"):
            text = clean_text(node.get_text(), 40)
            if text and re.fullmatch(r"[0-5](?:[.,]\d)?", text):
                rating_value = to_float(text)
                break

    review_count = None
    # 1) authoritative: the star-distribution table sums to the total
    distribution_seed = {}
    for node in soup.find_all(attrs={"aria-label": re.compile(r"stars?,?\s*[\d,]+\s*reviews?", re.I)}):
        match = re.search(r"(\d)\s*stars?,\s*([\d,]+)\s*reviews?", node.get("aria-label", ""), re.I)
        if match:
            distribution_seed[match.group(1)] = parse_count(match.group(2))
    if distribution_seed:
        review_count = sum(v for v in distribution_seed.values() if v) or None

    # 2) "See more reviews (852)" -> total = visible + remaining
    if review_count is None:
        for node in soup.find_all(attrs={"aria-label": re.compile(r"more reviews", re.I)}):
            match = re.search(r"\(([\d,]+)\)", node.get("aria-label", ""))
            if match:
                visible = len(soup.select("div[data-review-id]"))
                review_count = (parse_count(match.group(1)) or 0) + visible
                data["metrics"]["see_more_reviews_remaining"] = parse_count(match.group(1))
                break

    # 3) any explicit "N reviews" label
    if review_count is None:
        for node in soup.find_all(attrs={"aria-label": re.compile(r"reviews$", re.I)}):
            match = re.search(r"([\d,.]+)\s*reviews", node.get("aria-label", ""), re.I)
            if match:
                candidate = parse_count(match.group(1))
                if candidate and candidate > 0:
                    review_count = max(review_count or 0, candidate)
    if review_count is None:
        for node in soup.select("div.F7nice span:last-child, button.HHrUdb"):
            count = parse_count(re.sub(r"[^\d,.KM]", "", node.get_text() or ""))
            if count:
                review_count = count
                break

    data["rating"] = {"value": rating_value, "count": review_count, "best": 5.0}

    # ---- star distribution --------------------------------------------
    if distribution_seed:
        data["rating"]["distribution"] = {
            str(k): v for k, v in distribution_seed.items() if v and 1 <= int(k) <= 5}

    # ---- detail rows ---------------------------------------------------
    for node in soup.find_all(attrs={"data-item-id": True}):
        item_id = node.get("data-item-id") or ""
        label = node.get("aria-label") or ""
        text = clean_text(node.get_text(), 300)
        if item_id == "address":
            address_text = re.sub(r"^Address:\s*", "", label or text, flags=re.I).strip()
            business["address"] = {"full": address_text} if address_text else {}
        elif item_id.startswith("phone"):
            phone = re.sub(r"^Phone:\s*", "", label or text, flags=re.I).strip()
            business["phone"] = phone or None
        elif item_id == "authority":
            href = node.get("href")
            if href and href.startswith("http"):
                business["website"] = href
        elif item_id == "oloc":
            business["plus_code"] = re.sub(r"^Plus code:\s*", "", label or text, flags=re.I)
        elif item_id in ("oh", "open_hours"):
            business["hours_label"] = clean_text(label or text, 400)

    # hours table (skip the star-distribution table)
    hours = []
    day_re = re.compile(r"^(mon|tue|wed|thu|fri|sat|sun)", re.I)
    for table in soup.find_all("table"):
        rows = []
        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            if len(cells) < 2:
                continue
            day = clean_text(cells[0].get_text(" ", strip=True), 40) or ""
            if not day_re.match(day):
                continue
            value = clean_text(cells[1].get_text(" ", strip=True), 80)
            row = {"days": day, "hours": value}
            split = re.match(r"(.+?)\s*[–—-]\s*(.+)", value or "")
            if split:
                row["opens"], row["closes"] = split.group(1).strip(), split.group(2).strip()
            rows.append(row)
        if rows:
            hours = rows
            break
    if hours:
        business["hours"] = hours

    # category + price
    categories = []
    for node in soup.select("button.DkEaL, button[jsaction*='category']"):
        text = clean_text(node.get_text(), 80)
        if text and text not in categories:
            categories.append(text)
    if categories:
        business["categories"] = categories[:6]
    for node in soup.select("span.mgr77e"):
        level = price_level_from(node.get_text())
        if level:
            business["price_level"] = level
            business["price_level_raw"] = clean_text(node.get_text(), 10)
            break

    # ---- topics ("mentioned in N reviews") -----------------------------
    topics = []
    seen_topics = set()
    for node in soup.find_all(attrs={"aria-label": re.compile(r"mentioned in .*review", re.I)}):
        label = clean_text(node.get("aria-label"), 120)
        match = re.match(r"(.+?),\s*mentioned in ([\d,]+)\s*reviews?", label or "", re.I)
        if match and match.group(1).lower() not in seen_topics:
            seen_topics.add(match.group(1).lower())
            topics.append({"label": match.group(1).strip(),
                           "mentions": parse_count(match.group(2))})
    data["topics"] = sorted(topics, key=lambda t: t.get("mentions") or 0, reverse=True)

    # ---- reviews -------------------------------------------------------
    seen_ids = set()
    for card in soup.select("div[data-review-id]"):
        review_id = card.get("data-review-id")
        if not review_id or review_id in seen_ids:
            continue
        seen_ids.add(review_id)

        author_el = card.select_one(".d4r55")
        author = clean_text(author_el.get_text(), 90) if author_el else clean_text(card.get("aria-label"), 90)
        meta_el = card.select_one(".RfnDt")
        author_meta = None
        if meta_el:
            meta_text = clean_text(meta_el.get_text(), 160) or ""
            author_meta = {
                "raw": meta_text,
                "local_guide": "local guide" in meta_text.lower(),
                "review_count": parse_count((re.search(r"([\d,]+)\s*review", meta_text, re.I) or [None, None])[1]),
                "photo_count": parse_count((re.search(r"([\d,]+)\s*photo", meta_text, re.I) or [None, None])[1]),
            }

        star_el = (card.select_one("span[aria-label*='star']")
                   or card.select_one(".kvMYJc[aria-label]"))
        rating = None
        if star_el:
            rating = to_float(re.search(r"([\d.]+)", star_el.get("aria-label", "")).group(1)
                              if re.search(r"([\d.]+)", star_el.get("aria-label", "")) else None)

        date_el = card.select_one(".rsqaWe")
        date_raw = clean_text(date_el.get_text(), 60) if date_el else None

        text_nodes = card.select(".wiI7pd")
        text = clean_text(text_nodes[0].get_text("\n"), 4000) if text_nodes else None
        truncated = False
        if text and text.rstrip().endswith(("…", "...")):
            truncated = True
            text = text.rstrip().rstrip("…").rstrip(".").strip()
        response = None
        response_container = card.select_one(".CDe7pd")
        if response_container:
            response_text_nodes = response_container.select(".wiI7pd")
            if response_text_nodes:
                response = {
                    "text": clean_text(response_text_nodes[0].get_text("\n"), 2000),
                    "date": None,
                }
                resp_date = response_container.select_one(".rsqaWe")
                if resp_date:
                    response["date"] = clean_text(resp_date.get_text(), 60)
            elif response_container.get_text(strip=True):
                response = {"text": clean_text(response_container.get_text("\n"), 2000)}
        if response is None and len(text_nodes) > 1:
            response = {"text": clean_text(text_nodes[1].get_text("\n"), 2000), "date": None}

        photos = len(card.select("button[aria-label*='Photo'] img, img[src*='googleusercontent']"))
        data["reviews"].append({
            "source": "google",
            "review_id": review_id,
            "author": author,
            "author_meta": author_meta,
            "rating": rating,
            "rating_raw": rating,
            "best_rating": 5.0,
            "title": None,
            "text": text,
            "language": None,
            "date": any_date_to_iso(date_raw),
            "date_raw": date_raw,
            "owner_response": response,
            "helpful": None,
            "photos": photos,
            "url": url,
            "truncated": truncated,
        })

    # ---- "reviews from the web" (other sites Google surfaces) ----------
    web_ratings = []
    for anchor in soup.find_all("a", href=True):
        platform, _ = classify_url(anchor["href"])
        if platform in SOCIAL_SOURCES or not platform or platform == "google":
            continue
        text = clean_text(anchor.get_text(" ", strip=True), 200) or ""
        match = re.search(r"([0-5][.,]\d)\s*(?:of 5|/5)?\s*[·|-]?\s*([\d,]+)?\s*(?:reviews?|ratings?)?", text)
        if match:
            web_ratings.append({
                "source": platform,
                "url": anchor["href"],
                "rating": to_float(match.group(1)),
                "count": parse_count(match.group(2)),
                "label": text[:120],
            })
    if web_ratings:
        data["metrics"]["reviews_from_web"] = dedupe(web_ratings)[:8]

    return data


def _serpapi_reviews(data_id, limit, language="en"):
    """Optional: paginate *all* Google reviews through SerpAPI.

    The free Maps page in a headless browser only exposes five unique
    reviews; a SerpAPI key (SERPAPI_KEY / tokens.json serpapi_key) unlocks
    the full list, which is what you want for sentiment/theme work.
    """
    token = State.tokens.get("serpapi_key")
    if not token or not data_id:
        return []
    collected = []
    page_token = None
    pages = 0
    while len(collected) < limit and pages < 40:
        params = {"engine": "google_maps_reviews", "data_id": data_id,
                  "hl": language, "sort_by": "newest", "api_key": token}
        if page_token:
            params["next_page_token"] = page_token
        payload = fetch("https://serpapi.com/search.json", platform="google",
                        json_response=True, use_cache=False, params=params)
        if not payload.ok:
            log(f"serpapi reviews failed: {blocked_reason(payload)}", "debug")
            break
        try:
            data = json.loads(payload.text)
        except ValueError:
            break
        if data.get("error"):
            log(f"serpapi error: {data['error']}", "warn")
            break
        batch = data.get("reviews") or []
        if not batch:
            break
        for item in batch:
            user = item.get("user") or {}
            collected.append({
                "source": "google",
                "review_id": item.get("review_id") or f"serp-{len(collected)}",
                "author": clean_text(user.get("name"), 90),
                "author_meta": {"local_guide": user.get("local_guide"),
                                "review_count": user.get("reviews"),
                                "photo_count": user.get("photos")},
                "rating": to_float(item.get("rating")),
                "rating_raw": item.get("rating"),
                "best_rating": 5.0,
                "title": None,
                "text": clean_text(item.get("snippet") or item.get("extracted_snippet", {}).get("original")),
                "language": item.get("iso_date") and language or None,
                "date": (item.get("iso_date") or item.get("date") or "")[:10] or None,
                "date_raw": item.get("date"),
                "owner_response": ({"text": clean_text((item.get("response") or {}).get("snippet")),
                                    "date": (item.get("response") or {}).get("iso_date")}
                                   if item.get("response") else None),
                "helpful": item.get("likes"),
                "photos": len(item.get("images") or []),
                "url": item.get("link"),
            })
        pages += 1
        page_token = (data.get("serpapi_pagination") or {}).get("next_page_token")
        if not page_token:
            break
    log(f"serpapi: {len(collected)} google reviews collected", "debug")
    return collected[:limit]


@register("google", tier="browser")
def fetch_google(ctx):
    """Google rating + reviews: Places API when a key exists, else Maps.

    Maps is rendered twice on purpose: the Overview panel carries NAP, hours,
    category and price, while the Reviews tab replaces that panel with the
    review list. Scraping only one view loses half the data.
    """
    result = new_result("google", ctx.url_for("google") or None, "places-api")

    api = _places_api_lookup(ctx)
    if api:
        for key in ("business", "rating", "reviews", "metrics", "url"):
            if api.get(key):
                result[key] = api[key]
        if api.get("place_id"):
            result["metrics"]["place_id"] = api["place_id"]
        result["mode"] = "places-api"
        if len(result["reviews"]) >= 5 and State.max_reviews > 5:
            result["warnings"].append(
                "Places API caps reviews at 5 per place; add SERPAPI_KEY for the full list")
        return finalize(result)

    seed = ctx.url_for("google") or ""
    if "/maps/place/" in seed:
        maps_url = seed
    else:
        maps_url = ("https://www.google.com/maps/search/"
                    + up.quote(f"{ctx.name} {ctx.city}".strip()) + "?hl=en&gl=gb")
    log(f"google: maps place page (browser) {maps_url[:90]}", "debug")

    consent = ["button[aria-label*='Accept all']", "button[aria-label*='Reject all']"]

    # ---- phase 1: overview (NAP, hours, category, price, rating, topics) --
    overview = Browser.render(maps_url, wait_selector="h1", wait_ms=3800,
                              platform="google", click_selectors=consent)
    if not overview.ok or not overview.text:
        result["warnings"].append(f"maps page unavailable: {blocked_reason(overview)}")
        return finalize(result)
    details = _maps_extract(overview.soup, overview.url)
    result["url"] = overview.url
    result["mode"] = "maps-browser"
    result["business"] = details["business"]
    result["rating"] = details["rating"]
    result["topics"] = details["topics"]
    result["metrics"].update(details["metrics"])

    # ---- phase 2: reviews tab -------------------------------------------
    max_scrolls = 30 if State.deep else 7
    reviews_page = Browser.render(
        overview.url,
        wait_selector="h1",
        wait_ms=3200,
        platform="google",
        click_selectors=[
            *consent,
            "button.hh2c6:has-text('Reviews')",
            "button[role='tab']:has-text('Reviews')",
            "button[aria-label='See more']",
            "button.w8nwRe",
        ],
        scroll_selector="auto",
        max_scrolls=max_scrolls,
        progress_js=MAPS_JS_REVIEW_COUNT,
    )
    extracted = details
    if reviews_page.ok and reviews_page.text:
        extracted = _maps_extract(reviews_page.soup, reviews_page.url)
        # the reviews view drops the detail panel: keep phase-1 facts
        for key, value in details["business"].items():
            if value and not extracted["business"].get(key):
                extracted["business"][key] = value
        if (extracted["rating"].get("count") or 0) < (details["rating"].get("count") or 0):
            extracted["rating"]["count"] = details["rating"].get("count")
        if not extracted["rating"].get("value") and details["rating"].get("value"):
            extracted["rating"]["value"] = details["rating"]["value"]
        if details["rating"].get("distribution") and not extracted["rating"].get("distribution"):
            extracted["rating"]["distribution"] = details["rating"]["distribution"]
        if not extracted["topics"] and details["topics"]:
            extracted["topics"] = details["topics"]
        if details["metrics"].get("reviews_from_web") and not extracted["metrics"].get("reviews_from_web"):
            extracted["metrics"]["reviews_from_web"] = details["metrics"]["reviews_from_web"]

    result["business"] = extracted["business"]
    result["rating"] = extracted["rating"]
    result["topics"] = extracted["topics"]
    result["metrics"].update(extracted["metrics"])
    if not result["business"].get("name"):
        result["business"]["name"] = ctx.name

    reviews = extracted["reviews"][: State.max_reviews]
    if reviews:
        result["reviews"] = reviews
    if not result["rating"].get("count") and reviews:
        result["rating"]["count"] = len(reviews)
    if not result["rating"].get("value") and reviews:
        values = [r["rating"] for r in reviews if r.get("rating")]
        if values:
            result["rating"]["value"] = round(statistics.mean(values), 2)
    result["metrics"]["reviews_collected_visible"] = len(reviews)

    # ---- optional deep pull through SerpAPI ------------------------------
    if State.tokens.get("serpapi_key"):
        match = re.search(r"0x[0-9a-f]+:0x[0-9a-f]+", overview.url or "")
        data_id = result["metrics"].get("place_id") or (match.group(0) if match else None)
        bulk = _serpapi_reviews(data_id, State.max_reviews)
        if bulk:
            merged, seen_ids = [], set()
            for review in bulk + list(result["reviews"]):
                key = (review.get("review_id") or
                       (normalize_text(review.get("author")) + normalize_text(review.get("text"))[:60]))
                if key in seen_ids:
                    continue
                seen_ids.add(key)
                merged.append(review)
            result["reviews"] = merged[: State.max_reviews]
            result["mode"] = "maps-browser+serpapi"
    elif len(result["reviews"]) <= 6:
        result["warnings"].append(
            "Google exposes only ~5 reviews to anonymous browsers; set "
            "GOOGLE_PLACES_API_KEY or SERPAPI_KEY for the full list "
            "(rating, count, distribution and topics are complete)")

    if not result["reviews"] and not result["rating"].get("value"):
        result["warnings"].append("could not read the Maps place page (layout change or consent wall)")
    return finalize(result)


# =========================================================================
# 11. TRIPADVISOR
# =========================================================================
TA_BREAKDOWN_LABELS = ["Excellent", "Very Good", "Average", "Poor", "Terrible"]


def _tripadvisor_extract(soup, url, result):
    schema = extract_schema_business(soup, url, "tripadvisor")
    for key in ("name", "description", "telephone", "email", "price_range",
                "price_level", "cuisine", "address", "geo", "hours", "menu_url"):
        if schema.get(key):
            result["business"][key] = schema[key]
    if schema.get("rating"):
        result["rating"].update({k: v for k, v in schema["rating"].items() if v is not None})
    if schema.get("reviews"):
        result["reviews"] = schema["reviews"]

    text = soup.get_text(" ", strip=True)

    # Ranking: "#3 of 1,234 Restaurants in Glasgow"
    match = re.search(r"#\s*([\d,]+)\s+of\s+([\d,]+)\s+(.+?)\s+in\s+(.+?)(?:\s*[|·]|$)",
                      text, re.I)
    if match and not result["metrics"].get("ranking"):
        result["metrics"]["ranking"] = {
            "position": parse_count(match.group(1)),
            "total": parse_count(match.group(2)),
            "category": clean_text(match.group(3), 60),
            "location": clean_text(match.group(4), 80),
        }

    # Travellers' choice / awards
    awards = []
    for keyword in ("Travellers' Choice", "Travelers' Choice", "Certificate of Excellence",
                    "MICHELIN", "Good Food Guide", "AA Rosette"):
        if keyword.lower() in text.lower():
            awards.append(keyword)
    if awards:
        result["metrics"]["awards"] = awards

    # Rating bubbles breakdown (5..1)
    breakdown = {}
    for label in TA_BREAKDOWN_LABELS:
        match = re.search(rf"{label}\s*[:\s]*([\d,]{1,7})", text, re.I)
        if match:
            breakdown[label] = parse_count(match.group(1))
    if breakdown:
        result["rating"]["distribution_named"] = breakdown
        total = sum(v for v in breakdown.values() if v)
        if total:
            weighted = sum((5 - i) * (breakdown.get(label) or 0)
                           for i, label in enumerate(TA_BREAKDOWN_LABELS))
            result["rating"]["distribution_weighted"] = round(weighted / total, 2)

    # Review cards are rendered from the API; scrape what is in the DOM.
    cards = soup.select("div[data-test-target='review-card'], div.reviewSelector, "
                        "div[data-reviewid], div[class*='reviewCard']")
    reviews = []
    for card in cards:
        card_text = clean_text(card.get_text("\n"), 4000)
        if not card_text:
            continue
        stars = card.select_one("[class*='ui_bubble_rating'], span[class*='bubble']")
        rating = None
        if stars:
            classes = " ".join(stars.get("class") or [])
            match = re.search(r"bubble_(\d0)", classes)
            if match:
                rating = int(match.group(1)) / 10
        title_el = card.select_one("a[class*='titleSpan'], div[class*='title']")
        date_el = card.select_one("span[class*='ratingDate'], div[class*='date']")
        author_el = card.select_one("a[class*='memberInfo'], span[class*='username']")
        body_el = card.select_one("p[class*='partial_entry'], div[class*='reviewText']")
        reviews.append({
            "source": "tripadvisor",
            "review_id": card.get("data-reviewid"),
            "author": clean_text(author_el.get_text(), 90) if author_el else None,
            "author_meta": None,
            "rating": rating,
            "rating_raw": rating,
            "best_rating": 5.0,
            "title": clean_text(title_el.get_text(), 160) if title_el else None,
            "text": clean_text(body_el.get_text("\n"), 4000) if body_el else card_text,
            "language": None,
            "date": any_date_to_iso(date_el.get_text() if date_el else None),
            "date_raw": clean_text(date_el.get_text(), 60) if date_el else None,
            "owner_response": None,
            "helpful": None,
            "photos": len(card.select("img")),
            "url": url,
        })
    seen = {r.get("review_id") for r in result["reviews"]}
    for review in reviews:
        if review.get("review_id") and review["review_id"] in seen:
            continue
        result["reviews"].append(review)
    result["reviews"] = [r for r in result["reviews"] if r.get("text") or r.get("author")]

    if not result["rating"].get("value"):
        result["rating"].update(guess_rating_from_text(text, "tripadvisor"))
    if not result["rating"].get("count"):
        match = re.search(r"([\d,]{2,})\s+reviews?", text, re.I)
        if match:
            result["rating"]["count"] = parse_count(match.group(1))
    return result


@register("tripadvisor", tier="http")
def fetch_tripadvisor(ctx):
    url = ctx.url_for("tripadvisor")
    result = new_result("tripadvisor", url, "public-html")
    if not url:
        result["warnings"].append("no tripadvisor URL (discovery found none)")
        return finalize(result)

    page = fetch(url, platform="tripadvisor")
    usable = page.ok and ("aggregateRating" in page.text or "bubble_rating" in page.text
                          or "review-card" in page.text)
    if not usable and Browser.available():
        log("tripadvisor: escalating to browser", "debug")
        page = Browser.render(url, wait_selector="body", wait_ms=4000,
                              platform="tripadvisor",
                              click_selectors=["button#onetrust-accept-btn-handler"])
        usable = page.ok and len(page.text) > 20000
        result["mode"] = "browser"
    if not usable:
        result["warnings"].append(f"blocked: {blocked_reason(page)}")
        return finalize(result)

    soup = BeautifulSoup(page.text, "lxml")
    if soup.title and "Access Denied" in soup.title.get_text():
        result["warnings"].append("access denied page returned")
        return finalize(result)
    result["url"] = page.url
    _tripadvisor_extract(soup, page.url, result)
    return finalize(result)


# =========================================================================
# 12. RESTAURANT GURU  (identity hub: sameAs -> real socials)
# =========================================================================
@register("restaurantguru", tier="http")
def fetch_restaurantguru(ctx):
    result = new_result("restaurantguru", ctx.url_for("restaurantguru"), "public-html")
    candidates = []
    if ctx.url_for("restaurantguru"):
        candidates.append(ctx.url_for("restaurantguru"))
    city_slug = ctx.city.replace(" ", "-")
    name_slug = re.sub(r"[^A-Za-z0-9]+", "-", ctx.name).strip("-")
    candidates.append(f"https://restaurantguru.com/{name_slug}-{city_slug}")
    candidates.append(f"https://restaurantguru.com/{name_slug}")

    page = None
    for candidate in candidates:
        page = fetch(candidate, platform="restaurantguru")
        if page.ok and len(page.text) > 5000 and "aggregateRating" in page.text:
            break
        page = None
    if page is None:
        found = search_for_profile(ctx.business, "restaurantguru")
        if found:
            page = fetch(found, platform="restaurantguru")
    if page is None or not page.ok:
        result["warnings"].append("listing not found on Restaurant Guru")
        return finalize(result)

    result["url"] = page.url
    soup = page.soup
    schema = extract_schema_business(soup, page.url, "restaurantguru")
    result["business"] = {k: v for k, v in schema.items() if k != "reviews"} or {}
    if schema.get("rating"):
        result["rating"].update(schema["rating"])
    if schema.get("reviews"):
        result["reviews"] = schema["reviews"]

    text = soup.get_text(" ", strip=True)
    if not result["rating"].get("value"):
        result["rating"].update(guess_rating_from_text(text, "restaurantguru"))
    if schema.get("same_as"):
        result["metrics"]["same_as"] = schema["same_as"]
    if schema.get("menu_url"):
        result["metrics"]["menu_url"] = schema["menu_url"]

    # Restaurant Guru mirrors other platforms' scores — capture them.
    cross = []
    for label in ("Google", "Facebook", "Tripadvisor", "TripAdvisor", "Yelp", "Zomato"):
        match = re.search(rf"{label}\s*(?:rating)?\s*[:\-]?\s*([0-5][.,]\d)\s*(?:/\s*5|out of 5)?",
                          text, re.I)
        if match:
            cross.append({"source": label.lower(), "rating": to_float(match.group(1))})
    if cross:
        result["metrics"]["mirrored_ratings"] = dedupe(cross)

    # Price / features frequently listed as tags
    if re.search(r"vegetarian", text, re.I):
        result["business"].setdefault("attributes", {})["vegetarian"] = True
    if re.search(r"vegan", text, re.I):
        result["business"].setdefault("attributes", {})["vegan"] = True
    if re.search(r"gluten[- ]free", text, re.I):
        result["business"].setdefault("attributes", {})["gluten_free"] = True
    return finalize(result)


# =========================================================================
# 13. GENERIC REVIEW-PLATFORM CONNECTOR (Yelp, Trustpilot, OpenTable, ...)
# =========================================================================
GENERIC_REVIEW_SITES = {
    "yelp": {"label": "Yelp", "domains": ["yelp.co.uk", "yelp.com"],
             "url_queries": ['site:{domain} "{name}" {city}']},
    "trustpilot": {"label": "Trustpilot", "domains": ["trustpilot.com"],
                   "url_queries": ['site:{domain} "{website}"', 'site:{domain} "{name}"']},
    "opentable": {"label": "OpenTable", "domains": ["opentable.co.uk", "opentable.com"],
                  "url_queries": ['site:{domain} "{name}" {city}']},
    "thefork": {"label": "TheFork", "domains": ["thefork.co.uk", "thefork.com", "bookatable.co.uk"],
                "url_queries": ['site:{domain} "{name}" {city}']},
    "quandoo": {"label": "Quandoo", "domains": ["quandoo.co.uk", "quandoo.com"],
                "url_queries": ['site:{domain} "{name}" {city}']},
    "booking": {"label": "Booking.com", "domains": ["booking.com"],
                "url_queries": ['site:{domain} "{name}" {city}']},
    "expedia": {"label": "Expedia", "domains": ["expedia.co.uk", "expedia.com", "hotels.com"],
                "url_queries": ['site:{domain} "{name}" {city}']},
    "michelin": {"label": "MICHELIN Guide", "domains": ["guide.michelin.com"],
                 "url_queries": ['site:{domain} "{name}" {city}']},
    "foursquare": {"label": "Foursquare", "domains": ["foursquare.com"],
                   "url_queries": ['site:{domain} "{name}" {city}']},
    "zomato": {"label": "Zomato", "domains": ["zomato.com"],
               "url_queries": ['site:{domain} "{name}" {city}']},
}


def _generic_review_extract(soup, url, source, result):
    schema = extract_schema_business(soup, url, source)
    result["business"] = {k: v for k, v in schema.items() if k != "reviews"} or {}
    if schema.get("rating"):
        result["rating"].update(schema["rating"])
    if schema.get("reviews"):
        result["reviews"] = schema["reviews"]
    text = soup.get_text(" ", strip=True)
    if not result["rating"].get("value"):
        guessed = guess_rating_from_text(text, source)
        for key, value in guessed.items():
            if value and not result["rating"].get(key):
                result["rating"][key] = value
    # Review-like blocks that aren't marked up
    if not result["reviews"]:
        for block in soup.select("[class*='review'], [data-review], [itemprop='review']")[:80]:
            block_text = clean_text(block.get_text("\n"), 1200)
            if not block_text or len(block_text) < 40:
                continue
            stars = block.select_one("[class*='star'], [aria-label*='star'], [class*='rating']")
            rating = None
            if stars:
                label = stars.get("aria-label") or stars.get("class") or ""
                match = re.search(r"([0-5](?:[.,]\d)?)", " ".join(label) if isinstance(label, list) else str(label))
                if match:
                    rating = to_float(match.group(1))
            result["reviews"].append({
                "source": source, "review_id": None, "author": None, "author_meta": None,
                "rating": rating, "rating_raw": rating, "best_rating": 5.0,
                "title": None, "text": block_text, "language": None,
                "date": None, "date_raw": None, "owner_response": None,
                "helpful": None, "photos": 0, "url": url,
            })
            if len(result["reviews"]) >= 30:
                break
    return result


def make_generic_review_connector(source):
    meta = GENERIC_REVIEW_SITES[source]

    def _connector(ctx):
        result = new_result(source, ctx.url_for(source), "public-html")
        urls = []
        if ctx.url_for(source):
            urls.append(ctx.url_for(source))
        for entry in (ctx.website.get("links", {}) or {}).get(source, []) or []:
            if entry.get("url"):
                urls.append(entry["url"])
        if not urls and State.deep:
            found = search_for_profile(ctx.business, source)
            if found:
                urls.append(found)
        if not urls:
            result["warnings"].append(f"no {meta['label']} URL discovered")
            return finalize(result)

        page = None
        for url in dedupe(urls)[:2]:
            page = fetch(url, platform="default")
            if page.ok and len(page.text) > 4000:
                break
            if Browser.available():
                page = Browser.render(url, wait_selector="body", wait_ms=3000)
                if page.ok and len(page.text) > 4000:
                    result["mode"] = "browser"
                    break
            page = None
        if page is None:
            result["warnings"].append(f"{meta['label']} unreachable/blocked")
            return finalize(result)

        result["url"] = page.url
        _generic_review_extract(page.soup, page.url, source, result)
        return finalize(result)

    _connector.__name__ = f"fetch_{source}"
    register(source, tier="http")(_connector)
    return _connector


for _source in GENERIC_REVIEW_SITES:
    make_generic_review_connector(_source)


# =========================================================================
# 14. SOCIAL PLATFORM CONNECTORS
# =========================================================================
LOGIN_WALL_MARKERS = ("loginform", "log in to instagram", "page isn't available",
                      "you must log in", "log into facebook", "content isn't available")


def _login_walled(html):
    low = (html or "")[:60000].lower()
    return any(marker in low for marker in LOGIN_WALL_MARKERS)


def _social_common(result, soup, url):
    meta = meta_tags(soup)
    result["metrics"]["meta"] = {k: v for k, v in meta.items()
                                 if k in ("og:title", "og:description", "og:image",
                                          "og:url", "description", "title")}
    return meta


# ---- Instagram ----------------------------------------------------------
@register("instagram", tier="browser")
def fetch_instagram(ctx):
    url = ctx.url_for("instagram")
    result = new_result("instagram", url, "browser")
    handle = handle_from_url("instagram", url) if url else None
    if not url:
        result["warnings"].append("no instagram profile discovered")
        return finalize(result)
    result["profile"]["handle"] = handle

    # Tier 1: Graph API for owned accounts
    token = State.tokens.get("fb_graph_token")
    ig_map = State.tokens.get("ig_business_ids") or {}
    if token and handle and isinstance(ig_map, dict) and ig_map.get(handle):
        fields = ("id,username,name,biography,followers_count,follows_count,"
                  "media_count,profile_picture_url,website")
        api = (f"https://graph.facebook.com/v19.0/{ig_map[handle]}"
               f"?fields={fields}&access_token={token}")
        payload = fetch(api, platform="instagram", json_response=True, use_cache=False)
        if payload.ok:
            try:
                data = json.loads(payload.text)
            except ValueError:
                data = {}
            if data and "error" not in data:
                result["profile"].update({
                    "handle": data.get("username") or handle,
                    "full_name": data.get("name"),
                    "bio": data.get("biography"),
                    "followers": data.get("followers_count"),
                    "following": data.get("follows_count"),
                    "posts": data.get("media_count"),
                    "external_url": data.get("website"),
                    "profile_pic_url": data.get("profile_picture_url"),
                })
                result["mode"] = "graph-api"
                return finalize(result)

    rendered = Browser.render(url, wait_selector="body", wait_ms=3200,
                              platform="instagram",
                              click_selectors=["button:has-text('Accept')"])
    html = rendered.text if rendered.ok else ""
    if not html:
        result["warnings"].append(f"profile unreachable: {blocked_reason(rendered)}")
        return finalize(result)
    result["url"] = rendered.url
    soup = BeautifulSoup(html, "lxml")
    meta = _social_common(result, soup, rendered.url)

    title = meta.get("og:title") or meta.get("title") or ""
    match = re.search(r"(.+?)\s*\(@([A-Za-z0-9_.]+)\)", title)
    if match:
        result["profile"]["full_name"] = clean_text(match.group(1), 120)
        result["profile"]["handle"] = match.group(2)
    desc = meta.get("og:description") or ""
    match = re.search(r"([\d,.]+[KMB]?)\s*[Ff]ollowers?,?\s*([\d,.]+[KMB]?)\s*[Ff]ollowing,?\s*"
                      r"([\d,.]+[KMB]?)\s*[Pp]osts", desc)
    if match:
        result["profile"]["followers"] = parse_count(match.group(1))
        result["profile"]["following"] = parse_count(match.group(2))
        result["profile"]["posts"] = parse_count(match.group(3))
    bio_match = re.search(r"Posts\s*[-–]\s*(.+)", desc)
    if bio_match:
        result["profile"]["bio"] = clean_text(bio_match.group(1), 600)
    if meta.get("og:image"):
        result["profile"]["profile_pic_url"] = meta["og:image"]

    # Embedded JSON (varies by rollout): pull whatever keys exist
    for pattern, key in (
        (r'"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)', "followers"),
        (r'"edge_follow"\s*:\s*\{\s*"count"\s*:\s*(\d+)', "following"),
        (r'"edge_owner_to_timeline_media"\s*:\s*\{\s*"count"\s*:\s*(\d+)', "posts"),
    ):
        match = re.search(pattern, html)
        if match:
            result["profile"].setdefault(key, parse_count(match.group(1)))
    for pattern, key in (
        (r'"biography"\s*:\s*"((?:[^"\\]|\\.)*)"', "bio"),
        (r'"full_name"\s*:\s*"((?:[^"\\]|\\.)*)"', "full_name"),
        (r'"external_url"\s*:\s*"((?:[^"\\]|\\.)*)"', "external_url"),
        (r'"business_category_name"\s*:\s*"((?:[^"\\]|\\.)*)"', "category"),
        (r'"category_name"\s*:\s*"((?:[^"\\]|\\.)*)"', "category"),
        (r'"profile_pic_url_hd"\s*:\s*"((?:[^"\\]|\\.)*)"', "profile_pic_url"),
    ):
        match = re.search(pattern, html)
        if match and not result["profile"].get(key):
            value = match.group(1).encode().decode("unicode_escape", "ignore")
            result["profile"][key] = clean_text(value, 600)
    if re.search(r'"is_verified"\s*:\s*true', html):
        result["profile"]["verified"] = True

    if not result["profile"].get("followers") and _login_walled(html):
        result["warnings"].append("login wall: only public meta captured")
    if result["profile"].get("followers"):
        result["mode"] = "web-public"

    # Post grid (only visible without login)
    post_urls = set()
    for anchor in soup.find_all("a", href=re.compile(r"/p/[A-Za-z0-9_-]+/")):
        post_urls.add(abs_url(rendered.url, anchor["href"]))
        if len(post_urls) >= MAX_POSTS_PER_PROFILE:
            break
    if post_urls:
        result["posts"] = [{"url": u, "type": "post"} for u in list(post_urls)[:MAX_POSTS_PER_PROFILE]]
        result["profile"]["recent_post_urls"] = len(post_urls)

    return finalize(result)


# ---- Facebook -----------------------------------------------------------
@register("facebook", tier="browser")
def fetch_facebook(ctx):
    url = ctx.url_for("facebook")
    result = new_result("facebook", url, "browser")
    if not url:
        result["warnings"].append("no facebook page discovered")
        return finalize(result)

    token = State.tokens.get("fb_graph_token")
    slug = handle_from_url("facebook", url)
    if token and slug:
        fields = ("name,category,about,description,phone,email,website,link,"
                  "location,fan_count,followers_count,rating_count,"
                  "overall_star_rating,cover,picture,engagement")
        api = (f"https://graph.facebook.com/v19.0/{slug}"
               f"?fields={fields}&access_token={token}")
        payload = fetch(api, platform="facebook", json_response=True, use_cache=False)
        if payload.ok:
            try:
                data = json.loads(payload.text)
            except ValueError:
                data = {}
            if data and "error" not in data:
                location = data.get("location") or {}
                result["profile"] = {
                    "name": data.get("name"),
                    "category": data.get("category"),
                    "about": data.get("about"),
                    "description": data.get("description"),
                    "followers": data.get("followers_count"),
                    "likes": data.get("fan_count"),
                    "phone": data.get("phone"),
                    "email": data.get("email"),
                    "website": data.get("website"),
                    "address": location.get("street_address"),
                    "city": location.get("city"),
                    "profile_pic_url": ((data.get("picture") or {}).get("data") or {}).get("url"),
                    "cover_url": (data.get("cover") or {}).get("source"),
                }
                if data.get("overall_star_rating"):
                    result["rating"] = {
                        "value": to_float(data.get("overall_star_rating")),
                        "count": parse_count(data.get("rating_count")),
                        "best": 5.0,
                    }
                result["mode"] = "graph-api"
                return finalize(result)

    rendered = Browser.render(url, wait_selector="body", wait_ms=4200, platform="facebook",
                              click_selectors=["button[aria-label*='Close']"])
    html = rendered.text if rendered.ok else ""
    if not html:
        result["warnings"].append(f"page unreachable: {blocked_reason(rendered)}")
        return finalize(result)
    result["url"] = rendered.url
    soup = BeautifulSoup(html, "lxml")
    meta = _social_common(result, soup, rendered.url)

    title = meta.get("title") or ""
    parts = [p.strip() for p in re.split(r"\|", title) if p.strip()]
    if parts:
        result["profile"]["name"] = parts[0]
        if len(parts) > 1:
            result["profile"]["category"] = parts[1]
    desc = meta.get("og:description") or ""
    if desc:
        match = re.search(r"([\d,.]+[KMB]?)\s*followers?", desc, re.I)
        if match:
            result["profile"]["followers"] = parse_count(match.group(1))
        match = re.search(r"([\d,.]+[KMB]?)\s*(?:people\s*)?(?:talking about this|talking about)",
                          desc, re.I)
        if match:
            result["profile"]["talking_about"] = parse_count(match.group(1))
        match = re.search(r"([\d,.]+[KMB]?)\s*were here", desc, re.I)
        if match:
            result["profile"]["checkins"] = parse_count(match.group(1))
        match = re.search(r"[\d,.]+\s*(?:followers?|likes?)[.\s·]+(.+)$", desc, re.I)
        if match:
            result["profile"]["about"] = clean_text(match.group(1), 900)
    if meta.get("og:image"):
        result["profile"]["cover_url"] = meta["og:image"]

    for pattern, key, cast in (
        (r'"page_name"\s*:\s*"((?:[^"\\]|\\.)*)"', "name", None),
        (r'"category_name"\s*:\s*"((?:[^"\\]|\\.)*)"', "category", None),
        (r'"fan_count"\s*:\s*(\d+)', "likes", parse_count),
        (r'"followers_count"\s*:\s*(\d+)', "followers", parse_count),
        (r'"overall_star_rating"\s*:\s*([\d.]+)', "rating", to_float),
        (r'"rating_count"\s*:\s*(\d+)', "review_count", parse_count),
        (r'"website"\s*:\s*"((?:[^"\\]|\\.)*)"', "website", None),
        (r'"phone"\s*:\s*"((?:[^"\\]|\\.)*)"', "phone", None),
        (r'"checkin_count"\s*:\s*(\d+)', "checkins", parse_count),
        (r'"talking_about_count"\s*:\s*(\d+)', "talking_about", parse_count),
    ):
        match = re.search(pattern, html)
        if match and not result["profile"].get(key):
            value = match.group(1)
            try:
                value = value.encode().decode("unicode_escape", "ignore")
            except Exception:
                pass
            result["profile"][key] = cast(value) if cast else clean_text(value, 600)

    if result["profile"].get("review_count") and not result["rating"].get("count"):
        result["rating"]["count"] = result["profile"].pop("review_count")
    if result["profile"].get("rating") and not result["rating"].get("value"):
        result["rating"]["value"] = result["profile"].pop("rating")

    if _login_walled(html) and not result["profile"].get("followers"):
        result["warnings"].append("login wall: limited public data")
    if result["profile"].get("followers"):
        result["mode"] = "web-public"
    return finalize(result)


# ---- TikTok -------------------------------------------------------------
@register("tiktok", tier="browser")
def fetch_tiktok(ctx):
    url = ctx.url_for("tiktok")
    result = new_result("tiktok", url, "browser")
    handle = handle_from_url("tiktok", url) if url else None
    if not url:
        result["warnings"].append("no tiktok profile discovered")
        return finalize(result)
    result["profile"]["handle"] = handle

    rendered = Browser.render(url, wait_selector="body", wait_ms=3800, platform="tiktok")
    html = rendered.text if rendered.ok else ""
    if not html:
        result["warnings"].append(f"profile unreachable: {blocked_reason(rendered)}")
        return finalize(result)
    result["url"] = rendered.url
    soup = BeautifulSoup(html, "lxml")
    meta = _social_common(result, soup, rendered.url)

    desc = meta.get("og:description") or ""
    if desc:
        match = re.search(r"([\d,.]+[KMB]?)\s*Likes?\.?\s*([\d,.]+[KMB]?)\s*[Ff]ollowers?",
                          desc, re.I)
        if match:
            result["profile"]["likes"] = parse_count(match.group(1))
            result["profile"]["followers"] = parse_count(match.group(2))
        bio_match = re.search(r"[Ff]ollowers?\s*\.?\s*(.+)$", desc)
        if bio_match:
            result["profile"]["bio"] = clean_text(bio_match.group(1), 600)
    title = meta.get("title") or ""
    match = re.search(r"(.+?)\(@([A-Za-z0-9_.]+)\)", title)
    if match:
        result["profile"]["nickname"] = clean_text(match.group(1), 120)
        result["profile"]["handle"] = match.group(2)

    state = None
    script = soup.find("script", id="__UNIVERSAL_DATA_FOR_REHYDRATION__")
    if script and script.string:
        try:
            state = json.loads(script.string)
        except Exception:
            state = None
    if state:
        scope = state.get("__DEFAULT_SCOPE__") or {}
        user_info = ((scope.get("webapp.user-detail") or {}).get("userInfo")) or {}
        user = user_info.get("user") or {}
        stats = user_info.get("stats") or {}
        if user:
            result["profile"].update({
                "handle": user.get("uniqueId") or result["profile"].get("handle"),
                "nickname": user.get("nickname") or result["profile"].get("nickname"),
                "bio": user.get("signature") or result["profile"].get("bio"),
                "verified": user.get("verified"),
                "followers": stats.get("followerCount") or result["profile"].get("followers"),
                "following": stats.get("followingCount"),
                "likes": stats.get("heartCount") or result["profile"].get("likes"),
                "videos": stats.get("videoCount"),
            })
            bio_link = user.get("bioLink") or {}
            if isinstance(bio_link, dict):
                result["profile"]["external_url"] = bio_link.get("link")
            if user.get("avatarLarger"):
                result["profile"]["profile_pic_url"] = user["avatarLarger"]
        item_module = scope.get("webapp.video-detail") or {}
        item = (item_module.get("itemInfo") or {}).get("itemStruct") or {}
        videos = []
        if item:
            stats = item.get("stats") or {}
            videos.append({
                "id": item.get("id"),
                "desc": clean_text(item.get("desc"), 600),
                "plays": stats.get("playCount"),
                "likes": stats.get("diggCount"),
                "comments": stats.get("commentCount"),
                "shares": stats.get("shareCount"),
                "created_at": item.get("createTime"),
            })
        if videos:
            result["posts"] = videos

    if not result["profile"].get("followers") and _login_walled(html):
        result["warnings"].append("login wall: only public meta captured")
    return finalize(result)


# ---- YouTube ------------------------------------------------------------
YT_SUBS_RE = re.compile(r'"subscriberCountText"\s*:\s*\{[^}]*?"(?:simpleText|content)"\s*:\s*"([^"]+)"')
YT_VIDEOS_RE = re.compile(r'"videosCountText"\s*:\s*\{.*?"(?:simpleText|content)"\s*:\s*"([^"]+)"', re.S)
YT_CHANNEL_RE = re.compile(r'"channelId"\s*:\s*"(UC[\w-]{20,24})"')
YT_VIEWS_RE = re.compile(r'"viewCountText"\s*:\s*\{[^}]*?"(?:simpleText|content)"\s*:\s*"([^"]+)"')


@register("youtube", tier="http")
def fetch_youtube(ctx):
    url = ctx.url_for("youtube")
    result = new_result("youtube", url, "public-html")
    if not url:
        result["warnings"].append("no youtube channel discovered")
        return finalize(result)

    page = fetch(url, platform="default")
    if not page.ok and Browser.available():
        page = Browser.render(url, wait_selector="body", wait_ms=3000)
        result["mode"] = "browser"
    if not page.ok:
        result["warnings"].append(f"channel unreachable: {blocked_reason(page)}")
        return finalize(result)
    result["url"] = page.url
    html = page.text
    soup = page.soup
    meta = _social_common(result, soup, page.url)
    result["profile"]["name"] = clean_text(meta.get("og:title") or meta.get("title"), 160)
    if meta.get("og:description"):
        result["profile"]["bio"] = clean_text(meta["og:description"], 900)
    if meta.get("og:image"):
        result["profile"]["profile_pic_url"] = meta["og:image"]

    match = YT_SUBS_RE.search(html)
    if match:
        result["profile"]["followers"] = parse_count(re.sub(r"[^\d,.KM]", "", match.group(1)))
    match = YT_VIDEOS_RE.search(html)
    if match:
        result["profile"]["videos"] = parse_count(re.sub(r"[^\d,.KM]", "", match.group(1)))
    match = YT_VIEWS_RE.search(html)
    if match:
        result["profile"]["views"] = parse_count(re.sub(r"[^\d,.KM]", "", match.group(1)))
    channel_id = (YT_CHANNEL_RE.search(html) or [None, None])[1]
    result["profile"]["channel_id"] = channel_id

    # RSS gives the latest uploads + exact dates with no auth
    if channel_id:
        feed = fetch(f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}",
                     platform="default")
        if feed.ok and "<entry>" in feed.text:
            entries = BeautifulSoup(feed.text, "xml").find_all("entry")[:MAX_POSTS_PER_PROFILE]
            videos = []
            for entry in entries:
                stats = entry.find("media:statistics") or entry.find("statistics")
                rating = entry.find("media:starRating") or entry.find("starRating")
                videos.append({
                    "id": (entry.find("yt:videoId") or entry.find("videoId") or {}).get_text() if entry.find("yt:videoId") or entry.find("videoId") else None,
                    "title": clean_text(entry.find("title").get_text() if entry.find("title") else None, 200),
                    "url": clean_text(entry.find("link").get("href") if entry.find("link") else None, 200),
                    "published": clean_text(entry.find("published").get_text() if entry.find("published") else None, 40),
                    "views": parse_count(stats.get("views")) if stats and stats.get("views") else None,
                    "likes": parse_count(rating.get("count")) if rating and rating.get("count") else None,
                })
            result["posts"] = videos
    return finalize(result)


# ---- light-touch social networks ---------------------------------------
def make_light_social_connector(source, extra_patterns=None):
    def _connector(ctx):
        url = ctx.url_for(source)
        result = new_result(source, url, "public-html")
        if not url:
            result["warnings"].append(f"no {source} profile discovered")
            return finalize(result)
        page = fetch(url, platform=source if source in PLATFORM_DOMAIN else "default")
        if not page.ok and Browser.available():
            page = Browser.render(url, wait_selector="body", wait_ms=3000, platform="default")
            result["mode"] = "browser"
        if not page.ok:
            result["warnings"].append(f"unreachable: {blocked_reason(page)}")
            return finalize(result)
        result["url"] = page.url
        soup = page.soup
        meta = _social_common(result, soup, page.url)
        result["profile"]["name"] = clean_text(meta.get("og:title") or meta.get("title"), 160)
        desc = meta.get("og:description") or ""
        if desc:
            result["profile"]["bio"] = clean_text(desc, 900)
            match = re.search(r"([\d,.]+[KMB]?)\s*[Ff]ollowers?", desc)
            if match:
                result["profile"]["followers"] = parse_count(match.group(1))
            match = re.search(r"([\d,.]+[KMB]?)\s*(?:posts|pins|tweets)", desc, re.I)
            if match:
                result["profile"]["posts"] = parse_count(match.group(1))
        if meta.get("og:image"):
            result["profile"]["profile_pic_url"] = meta["og:image"]
        for pattern, key in (extra_patterns or []):
            match = re.search(pattern, page.text)
            if match and not result["profile"].get(key):
                result["profile"][key] = parse_count(match.group(1)) if match.groups() else None
        return finalize(result)

    _connector.__name__ = f"fetch_{source}"
    register(source, tier="http")(_connector)
    return _connector


make_light_social_connector("x", [
    (r'"followers_count"\s*:\s*(\d+)', "followers"),
    (r'"statuses_count"\s*:\s*(\d+)', "posts"),
])
make_light_social_connector("threads", [
    (r'"follower_count"\s*:\s*(\d+)', "followers"),
])
make_light_social_connector("pinterest", [
    (r'"follower_count"\s*:\s*(\d+)', "followers"),
    (r'"pin_count"\s*:\s*(\d+)', "posts"),
])
make_light_social_connector("linkedin", [
    (r'"followerCount"\s*:\s*(\d+)', "followers"),
])
make_light_social_connector("snapchat", [])


# =========================================================================
# 14b. FOOD HYGIENE (UK FSA open API — no key, high signal)
# =========================================================================
FSA_API = "https://api.ratings.food.gov.uk/Establishments"


def _fsa_match_score(establishment, ctx):
    name_score = similarity(establishment.get("BusinessName") or "", ctx.name)
    address_bits = " ".join(str(establishment.get(key) or "") for key in
                            ("AddressLine1", "AddressLine2", "AddressLine3",
                             "AddressLine4", "PostCode"))
    city_bonus = 0.15 if normalize_text(ctx.city) and normalize_text(ctx.city) in normalize_text(address_bits) else 0
    postcode_bonus = 0.05 if re.search(r"[A-Z]{1,2}\d", establishment.get("PostCode") or "") else 0
    return round(name_score + city_bonus + postcode_bonus, 3)


@register("food_hygiene", tier="http")
def fetch_food_hygiene(ctx):
    """UK Food Standards Agency ratings: pass / improvement required / 0-5."""
    result = new_result("food_hygiene", None, "fsa-api")
    if normalize_text(ctx.country) not in ("united kingdom", "uk", "england",
                                           "scotland", "wales", "northern ireland"):
        result["warnings"].append("FSA data only covers UK establishments")
        return finalize(result)

    words = [w for w in ctx.name.split() if w]
    names = [ctx.name]
    if len(words) >= 2:
        names.append(" ".join(words[:2]))
        names.append(words[0])
    establishments = []
    for query_name in dedupe(names):
        for address in (ctx.city, ""):
            payload = fetch(FSA_API, platform="default", json_response=True,
                            params={"name": query_name, "address": address or "",
                                    "pageSize": "10"},
                            extra_headers={"x-api-version": "2",
                                           "Accept": "application/json"})
            if not payload.ok:
                result["warnings"].append(f"FSA lookup failed: {blocked_reason(payload)}")
                return finalize(result)
            try:
                data = json.loads(payload.text)
            except ValueError:
                result["warnings"].append("FSA response was not JSON")
                return finalize(result)
            establishments = data.get("establishments") or []
            if establishments:
                result["metrics"]["fsa_query"] = {"name": query_name,
                                                  "address": address or None}
                break
        if establishments:
            break
    if not establishments:
        result["warnings"].append("no FSA establishment matched")
        return finalize(result)
    best = max(establishments, key=lambda e: _fsa_match_score(e, ctx))
    score = _fsa_match_score(best, ctx)
    result["url"] = (f"https://ratings.food.gov.uk/business/en-GB/"
                     f"{best.get('FHRSID')}")
    result["mode"] = "fsa-api"
    if score < 0.55:
        result["warnings"].append(
            f"weak name match (score {score}) — please confirm manually")
        result["metrics"]["match_score"] = score
        return finalize(result)

    rating_value = best.get("RatingValue")
    scheme = best.get("SchemeType") or ""
    numeric = None
    try:
        numeric = int(str(rating_value).strip())
    except (TypeError, ValueError):
        numeric = None
    passed = None
    if numeric is not None:
        passed = numeric >= 3
    elif rating_value:
        low = str(rating_value).lower()
        passed = ("improvement" not in low and "awaiting" not in low
                  and "exempt" not in low)

    result["compliance"] = {
        "authority": best.get("LocalAuthorityName"),
        "scheme": scheme,
        "rating": rating_value,
        "rating_numeric": numeric,
        "passed": passed,
        "inspection_date": (best.get("RatingDate") or "")[:10] or None,
        "business_type": best.get("BusinessType"),
        "address": ", ".join(str(best.get(k)) for k in
                             ("AddressLine1", "AddressLine2", "AddressLine3", "AddressLine4")
                             if best.get(k)),
        "postcode": best.get("PostCode"),
        "fhrs_id": best.get("FHRSID"),
        "scores": best.get("scores") or {},
        "new_rating_pending": best.get("NewRatingPending"),
        "match_score": score,
        "source_url": result["url"],
    }
    result["business"] = {
        "name": best.get("BusinessName"),
        "address": {"full": result["compliance"]["address"],
                    "postal": best.get("PostCode")},
        "geo": {"lat": to_float((best.get("geocode") or {}).get("latitude")),
                "lon": to_float((best.get("geocode") or {}).get("longitude"))},
        "categories": [best.get("BusinessType")] if best.get("BusinessType") else [],
    }
    if passed is False:
        result["warnings"].append(
            f"hygiene rating '{rating_value}' — a reputational and legal risk item")
    return finalize(result)


# =========================================================================
# 14c. PRESS & WEB MENTIONS
# =========================================================================
MENTION_KIND_PATTERNS = (
    ("award", r"award|winner|won\b|best |top \d|numero uno|no\.? ?1|gold|rosette|michelin"),
    ("listicle", r"best .*(bars?|restaurants?|pubs?|places to eat|brunch)|guide to|where to eat"),
    ("press", r"herald|scotsman|bbc|stv|evening times|guardian|independent|time out|daily record"),
    ("incident", r"closed|closure|fire|police|prosecut|fine|hygiene|complaint|rat infestation"),
    ("listing", r"yelp|tripadvisor|opentable|restaurantguru|foursquare|zomato|bookatable"),
)


def _classify_mention(title, url):
    haystack = f"{title} {url}".lower()
    for kind, pattern in MENTION_KIND_PATTERNS:
        if re.search(pattern, haystack):
            return kind
    return "mention"


@register("press", tier="http")
def fetch_press(ctx):
    """Web mentions: listicles, awards, local press, anything newsworthy."""
    result = new_result("press", None, "web-search")
    own_hosts = {domain_of(url) for url in
                 (ctx.profiles.values() if isinstance(ctx.profiles, dict) else [])
                 if url}
    if ctx.website.get("website"):
        own_hosts.add(domain_of(ctx.website["website"]))
    blocked_hosts = set()
    for source, markers in PLATFORM_REVIEW_DOMAINS.items():
        blocked_hosts.update(markers)

    queries = [
        f'"{ctx.name}" {ctx.city}'.strip(),
        f'"{ctx.name}" {ctx.city} review award best'.strip(),
    ]
    seen = set()
    mentions = []
    seen_titles = set()
    tokens = brand_tokens(ctx.name)
    city_key = normalize_text(ctx.city)
    for query in queries:
        for item in web_search(query, count=20)[:12]:
            url = item.get("url") or ""
            host = domain_of(url)
            if not host or host in own_hosts:
                continue
            if any(marker in url.lower() for marker in blocked_hosts):
                continue
            if url.split("#")[0] in seen:
                continue
            # Only keep results that actually talk about this business.
            haystack = normalize_text(f"{item.get('title') or ''} {item.get('snippet') or ''}")
            hits = sum(1 for token in tokens if token in haystack)
            if tokens and hits < min(2, len(tokens)):
                continue
            if city_key and city_key not in haystack and city_key not in normalize_text(url):
                continue
            title_key = normalize_text(item.get("title"))[:60]
            if title_key and title_key in seen_titles:
                continue
            seen.add(url.split("#")[0])
            if title_key:
                seen_titles.add(title_key)
            mentions.append({
                "url": url,
                "title": item.get("title"),
                "snippet": item.get("snippet"),
                "host": host,
                "kind": _classify_mention(item.get("title") or "", url),
                "query": query,
            })
        time.sleep(1.0)

    result["mentions"] = mentions[:20]
    result["metrics"]["mention_count"] = len(mentions)
    result["metrics"]["kinds"] = dict(Counter(m["kind"] for m in mentions))
    result["url"] = f"https://www.bing.com/search?q={up.quote(queries[0])}"
    if not mentions:
        result["warnings"].append("no independent web mentions found")
    return finalize(result)


# =========================================================================
# 15. BUSINESS WEBSITE (NAP, providers, tech, menus)
# =========================================================================
BOOKING_PROVIDERS = {
    "opentable": "OpenTable", "resdiary": "ResDiary", "sevenrooms": "SevenRooms",
    "thefork": "TheFork", "quandoo": "Quandoo", "tock": "Tock",
    "designmynight": "DesignMyNight", "bookatable": "Bookatable", "resy": "Resy",
    "libro": "Libro", "formitable": "Formitable", "tablein": "Tablein",
}
DELIVERY_PROVIDERS = {
    "deliveroo": "Deliveroo", "ubereats": "Uber Eats", "just-eat": "Just Eat",
    "justeattakeaway": "Just Eat", "doordash": "DoorDash", "glovo": "Glovo",
    "foodhub": "Foodhub", "hungryhouse": "Hungryhouse", "zomato": "Zomato",
    "grubhub": "Grubhub", "menulog": "Menulog",
}
TECH_MARKERS = {
    "wordpress": ("wp-content", "wp-json"),
    "shopify": ("cdn.shopify.com", "shopify"),
    "squarespace": ("squarespace",),
    "wix": ("wix.com", "wixstatic"),
    "webflow": ("webflow",),
    "mailchimp": ("mailchimp", "list-manage.com"),
    "google_analytics": ("googletagmanager", "gtag(", "analytics.js"),
    "meta_pixel": ("connect.facebook.net", "fbq("),
    "hotjar": ("hotjar",),
    "cloudflare": ("cloudflare",),
}


@register("website", tier="http")
def fetch_website(ctx):
    result = new_result("website", ctx.website.get("website"), "http")
    website = ctx.website or {}
    facts = website.get("facts") or {}
    result["url"] = website.get("website")
    result["business"] = {k: v for k, v in facts.items() if k != "reviews"}
    result["pages"] = website.get("pages") or []

    links = website.get("links") or {}
    external = website.get("external_urls") or []
    booking, delivery = [], []
    for host_url in external:
        low = host_url.lower()
        for key, label in BOOKING_PROVIDERS.items():
            if key in low:
                booking.append({"provider": label, "url": host_url})
        for key, label in DELIVERY_PROVIDERS.items():
            if key in low:
                delivery.append({"provider": label, "url": host_url})
    if facts.get("menu_url"):
        result["links"]["menu"] = facts["menu_url"]
    result["links"]["booking"] = dedupe(booking)[:6]
    result["links"]["delivery"] = dedupe(delivery)[:6]
    result["links"]["social"] = {platform: [e["url"] for e in entries][:3]
                                 for platform, entries in links.items()
                                 if platform in SOCIAL_SOURCES}
    result["metrics"]["booking_providers"] = dedupe([b["provider"] for b in booking])
    result["metrics"]["delivery_providers"] = dedupe([d["provider"] for d in delivery])
    result["metrics"]["has_online_booking"] = bool(booking)
    result["metrics"]["has_online_delivery"] = bool(delivery)
    result["metrics"]["has_menu_online"] = bool(facts.get("menu_url"))
    result["metrics"]["emails"] = facts.get("emails") or []
    result["metrics"]["phones"] = facts.get("phones") or []

    tech = []
    if result["url"]:
        page = fetch(result["url"], platform="default")
        if page.ok:
            low = page.text.lower()
            for name, markers in TECH_MARKERS.items():
                if any(marker in low for marker in markers):
                    tech.append(name)
            result["metrics"]["page_size_kb"] = round(len(page.text) / 1024, 1)
            sitemap = fetch(up.urljoin(result["url"], "/sitemap.xml"), platform="default",
                            use_cache=True)
            if sitemap.ok and "<urlset" in sitemap.text.lower():
                result["metrics"]["sitemap_urls"] = sitemap.text.lower().count("<loc>")
    result["metrics"]["tech"] = tech
    if not result["url"]:
        result["warnings"].append("no website configured or discovered")
    return finalize(result)


# =========================================================================
# 16. ASSET DOWNLOADS
# =========================================================================
def download_asset(ctx, source, category, url, referer=None, fallback="asset"):
    """Stream an asset to assets/<source>/<category>/; returns relative path."""
    if not DOWNLOAD_ASSETS or not url or not url.startswith("http"):
        return None
    target_dir = ctx.asset_dir(source, category)
    try:
        throttle(source if source in REQUEST_DELAY else "default")
        resp = _session(source if source in UA_BY_PLATFORM else "default").get(
            url, stream=True, timeout=REQUEST_TIMEOUT,
            headers={"Referer": referer} if referer else None)
        if resp.status_code >= 400:
            return None
        ctype = (resp.headers.get("content-type") or "").lower()
        if "text/html" in ctype or "application/json" in ctype:
            return None
        name = safe_filename(url, fallback)
        base, ext = os.path.splitext(name)
        if not ext:
            ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
                   "image/gif": ".gif"}.get(ctype.split(";")[0].strip(), ".jpg")
            name = base + ext
        path = os.path.join(target_dir, name)
        counter = 1
        while os.path.exists(path) and os.path.getsize(path) > 0:
            path = os.path.join(target_dir, f"{base}_{counter}{ext}")
            counter += 1
        with open(path, "wb") as fh:
            for chunk in resp.iter_content(16384):
                if chunk:
                    fh.write(chunk)
        if os.path.getsize(path) < 800:
            os.remove(path)
            return None
        State.stats["assets_downloaded"] += 1
        return rel_to(path, ctx.output_dir)
    except Exception as exc:
        log(f"asset download failed: {str(exc)[:100]}", "debug")
        return None


def collect_assets(ctx):
    """Download brand-relevant imagery from the connectors' results."""
    assets = {}
    for source, data in ctx.results.items():
        if not data:
            continue
        profile = data.get("profile") or {}
        written = {}
        for key, url in (("avatar", profile.get("profile_pic_url")),
                         ("cover", profile.get("cover_url"))):
            path = download_asset(ctx, source, key, url)
            if path:
                written[key] = path
        business = data.get("business") or {}
        images = business.get("images") or []
        for index, url in enumerate(images[:4]):
            path = download_asset(ctx, source, "photos", url, fallback=f"photo-{index:02d}")
            if path:
                written.setdefault("photos", []).append(path)
        if written:
            assets[source] = written
    return assets


# =========================================================================
# 17. TEXT INTELLIGENCE (sentiment, themes, language)
# =========================================================================
POSITIVE_TERMS = {
    "amazing": 2, "excellent": 2, "outstanding": 2, "fantastic": 2, "superb": 2,
    "perfect": 2, "brilliant": 2, "delicious": 2, "gorgeous": 2, "stunning": 2,
    "best": 1.5, "love": 1.5, "loved": 1.5, "favourite": 1.5, "favorite": 1.5,
    "great": 1.5, "lovely": 1.5, "wonderful": 1.5, "awesome": 1.5, "gem": 1.5,
    "friendly": 1, "welcoming": 1, "attentive": 1, "helpful": 1, "polite": 1,
    "tasty": 1, "fresh": 1, "generous": 1, "good": 1, "nice": 0.8, "pleasant": 1,
    "cosy": 1, "cozy": 1, "warm": 0.8, "comfortable": 1, "clean": 1, "spotless": 1.5,
    "recommend": 1.5, "recommended": 1.5, "worth": 1, "value": 0.8, "reasonable": 1,
    "quick": 0.6, "prompt": 1, "efficient": 0.8, "flawless": 1.5, "faultless": 2,
    "vibrant": 1, "lively": 0.8, "buzzing": 0.8, "authentic": 1, "quality": 1,
    "impeccable": 2, "divine": 1.5, "mouthwatering": 1.5, "moreish": 1.2,
    "lovable": 1, "charming": 1, "relaxed": 0.8, "smooth": 0.6, "generous": 1,
    "accommodating": 1.2, "knowledgeable": 1, "consistent": 1, "impressed": 1.2,
    "impressive": 1.2, "exceeded": 1.2, "satisfied": 1, "enjoy": 1, "enjoyed": 1,
}
NEGATIVE_TERMS = {
    "terrible": -2, "awful": -2, "horrendous": -2, "disgusting": -2, "worst": -2,
    "inedible": -2, "revolting": -2, "appalling": -2, "atrocious": -2,
    "disappointing": -1.5, "disappointed": -1.5, "poor": -1.5, "bad": -1.2,
    "bland": -1.2, "dry": -1, "cold": -1, "stale": -1.2, "greasy": -1.2,
    "burnt": -1.2, "overcooked": -1.2, "undercooked": -1.2,
    "rude": -2, "ignored": -1.5, "unprofessional": -1.5, "dismissive": -1.5,
    "slow": -1, "waited": -0.8, "waiting": -0.8, "delay": -1, "delayed": -1,
    "overpriced": -1.5, "expensive": -0.8, "rip": -1.5, "rip-off": -2, "ripoff": -2,
    "dirty": -1.8, "filthy": -2, "sticky": -1.2, "smelly": -1.5, "grim": -1.5,
    "noisy": -0.8, "cramped": -0.8, "chaotic": -1, "uncomfortable": -1,
    "mediocre": -1.2, "letdown": -1.5, "let-down": -1.5, "never": -0.6,
    "avoid": -1.8, "complaint": -1.2, "complained": -1, "refund": -0.8,
    "mistake": -1, "wrong": -1, "missing": -1, "forgot": -1.2, "forgotten": -1.2,
    "soggy": -1, "rubbery": -1.2, "tasteless": -1.5, "watery": -1, "small": -0.5,
    "tough": -0.8, "chewy": -0.8, "lukewarm": -1.2, "unhygienic": -2,
    "unfriendly": -1.5, "sullen": -1.5, "arrogant": -1.5, "chaos": -1,
    "unacceptable": -1.8, "shambles": -1.8, "dire": -1.8, "meh": -1,
}
NEGATIONS = {"not", "no", "never", "n't", "without", "hardly", "barely", "isn't",
             "wasn't", "didn't", "don't", "doesn't", "won't", "can't", "couldn't"}
INTENSIFIERS = {"very", "really", "extremely", "so", "super", "incredibly",
                "absolutely", "totally", "utterly", "quite", "particularly"}

THEME_KEYWORDS = {
    "food quality": ["food", "meal", "dish", "dishes", "menu", "burger", "pizza",
                     "pasta", "steak", "fish", "chips", "starter", "dessert",
                     "breakfast", "brunch", "lunch", "dinner", "curry", "sushi",
                     "tacos", "salad", "soup", "sandwich", "portion", "flavour",
                     "flavor", "cooked", "taste", "tasty", "delicious", "bland"],
    "service": ["service", "staff", "waiter", "waitress", "server", "manager",
                "team", "host", "hostess", "bartender", "chef", "attentive",
                "friendly", "rude", "ignored", "attitude", "welcoming"],
    "drinks": ["drink", "drinks", "cocktail", "cocktails", "beer", "wine",
               "whisky", "whiskey", "gin", "coffee", "espresso", "martini",
               "pint", "prosecco", "spritz", "bar"],
    "atmosphere": ["atmosphere", "ambience", "ambiance", "vibe", "music", "decor",
                   "cosy", "cozy", "romantic", "lively", "noisy", "quiet",
                   "seating", "lighting", "interior"],
    "value": ["price", "prices", "priced", "value", "expensive", "cheap",
              "overpriced", "affordable", "money", "bill", "cost", "worth"],
    "wait time": ["wait", "waited", "waiting", "slow", "delay", "quick", "fast",
                  "queue", "queued", "booking", "reservation"],
    "cleanliness": ["clean", "dirty", "toilet", "toilets", "bathroom", "hygiene",
                    "sticky", "filthy", "spotless"],
    "location": ["location", "area", "merchant city", "city centre", "parking",
                 "transport", "walk", "nearby", "central"],
    "dietary": ["vegan", "vegetarian", "gluten", "gluten-free", "allergy",
                "allergies", "dairy", "coeliac", "celiac"],
    "family": ["kids", "children", "family", "highchair", "child friendly", "dog",
               "dogs", "dog friendly"],
    "events": ["birthday", "anniversary", "party", "celebrat", "christmas",
               "event", "function", "private dining"],
    "consistency": ["again", "return", "returned", "regular", "usual", "consistent",
                    "used to", "gone downhill", "standards"],
}


def tokenize_words(text):
    return re.findall(r"[a-zA-Z][a-zA-Z'\-]{1,}", (text or "").lower())


def sentiment_score(text):
    """Lexicon sentiment in [-1, 1] with negation + intensifier handling."""
    words = tokenize_words(text)
    if not words:
        return 0.0
    total = 0.0
    hits = 0
    for index, word in enumerate(words):
        base = POSITIVE_TERMS.get(word) or NEGATIVE_TERMS.get(word)
        if base is None:
            base = POSITIVE_TERMS.get(word.rstrip("s")) or NEGATIVE_TERMS.get(word.rstrip("s"))
        if base is None:
            continue
        weight = 1.0
        window = words[max(0, index - 3):index]
        if any(token in NEGATIONS for token in window):
            weight = -1.0
        elif any(token in INTENSIFIERS for token in window):
            weight = 1.45
        total += base * weight
        hits += 1
    if not hits:
        return 0.0
    raw = total / math.sqrt(hits * 2.2)
    return round(max(-1.0, min(1.0, math.tanh(raw))), 3)


def sentiment_label(score):
    if score >= 0.25:
        return "positive"
    if score <= -0.25:
        return "negative"
    return "neutral"


def detect_language(text):
    """Cheap 3-language guess (English / Portuguese / Spanish / French)."""
    if not text:
        return None
    words = set(tokenize_words(text)[:80])
    markers = {
        "en": {"the", "and", "was", "with", "food", "great", "service", "we"},
        "pt": {"o", "a", "de", "que", "com", "muito", "não", "para"},
        "es": {"el", "la", "de", "que", "con", "muy", "para", "pero"},
        "fr": {"le", "la", "les", "et", "avec", "très", "pour", "nous"},
    }
    scores = {lang: len(words & vocab) for lang, vocab in markers.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] >= 2 else None


def extract_themes(reviews):
    themes = {}
    for review in reviews:
        text = (review.get("text") or "") + " " + (review.get("title") or "")
        low = text.lower()
        if not low.strip():
            continue
        score = review.get("sentiment")
        if score is None:
            score = sentiment_score(text)
        label = sentiment_label(score)
        matched = set()
        for theme, keywords in THEME_KEYWORDS.items():
            if any(keyword in low for keyword in keywords):
                matched.add(theme)
        for theme in matched:
            entry = themes.setdefault(theme, {"mentions": 0, "positive": 0,
                                              "negative": 0, "neutral": 0,
                                              "samples": []})
            entry["mentions"] += 1
            entry[label] += 1
            if review.get("text") and len(entry["samples"]) < 3:
                entry["samples"].append({"rating": review.get("rating"),
                                         "snippet": clean_text(review.get("text"), 180),
                                         "source": review.get("source")})
    for entry in themes.values():
        entry["net_sentiment"] = round(
            (entry["positive"] - entry["negative"]) / max(1, entry["mentions"]), 2)
    return dict(sorted(themes.items(), key=lambda kv: -kv[1]["mentions"]))


# =========================================================================
# 18. REVIEW AGGREGATION
# =========================================================================
def _source_weight(source, count):
    base = {"google": 1.0, "tripadvisor": 0.9, "yelp": 0.8, "opentable": 0.9,
            "thefork": 0.8, "restaurantguru": 0.6, "trustpilot": 0.7,
            "booking": 0.8, "michelin": 1.0, "foursquare": 0.4,
            "quandoo": 0.7, "expedia": 0.7, "zomato": 0.5}.get(source, 0.5)
    volume = math.log10(max(1, count or 0) + 1) / 3.0
    return round(base * (0.55 + min(1.0, volume)), 3)


def aggregate_reviews(results):
    per_source = {}
    all_reviews = []
    for source, data in results.items():
        if not data:
            continue
        rating = data.get("rating") or {}
        reviews = data.get("reviews") or []
        value = rating.get("value")
        count = rating.get("count")
        if not (value or count or reviews):
            continue
        per_source[source] = {
            "label": data.get("label") or source,
            "rating": value,
            "count": count,
            "collected": len(reviews),
            "mode": data.get("mode"),
            "url": data.get("url"),
            "distribution": rating.get("distribution"),
            "ranking": (data.get("metrics") or {}).get("ranking"),
            "weight": _source_weight(source, count or len(reviews)),
        }
        for review in reviews:
            review = dict(review)
            review.setdefault("source", source)
            if review.get("sentiment") is None:
                review["sentiment"] = sentiment_score(review.get("text"))
            if review.get("language") is None:
                review["language"] = detect_language(review.get("text"))
            all_reviews.append(review)

    # dedupe (same author + same first 80 chars of text)
    seen = set()
    unique_reviews = []
    for review in all_reviews:
        key = (normalize_text(review.get("author"))[:40],
               normalize_text(review.get("text"))[:80])
        if key != ("", "") and key in seen:
            continue
        seen.add(key)
        unique_reviews.append(review)

    weighted_sum = 0.0
    weight_total = 0.0
    total_count = 0
    for source, entry in per_source.items():
        if entry["rating"] and entry["count"]:
            weighted_sum += entry["rating"] * entry["weight"] * math.log10(entry["count"] + 1)
            weight_total += entry["weight"] * math.log10(entry["count"] + 1)
        total_count += entry["count"] or 0
    consensus = round(weighted_sum / weight_total, 2) if weight_total else None
    simple_mean = None
    rated = [e["rating"] for e in per_source.values() if e["rating"]]
    if rated:
        simple_mean = round(statistics.mean(rated), 2)
    disagreement = None
    if len(rated) >= 2:
        disagreement = round(max(rated) - min(rated), 2)

    # merged distribution
    distribution = {}
    for entry in per_source.values():
        for stars, count in (entry.get("distribution") or {}).items():
            if count:
                distribution[str(stars)] = distribution.get(str(stars), 0) + count
    if not distribution and unique_reviews:
        for review in unique_reviews:
            rating = review.get("rating")
            if rating:
                bucket = str(int(round(rating)))
                distribution[bucket] = distribution.get(bucket, 0) + 1

    # sentiment + themes
    scores = [r["sentiment"] for r in unique_reviews if r.get("sentiment") is not None]
    sentiment_summary = {}
    if scores:
        labels = Counter(sentiment_label(s) for s in scores)
        sentiment_summary = {
            "mean": round(statistics.mean(scores), 3),
            "positive": labels.get("positive", 0),
            "neutral": labels.get("neutral", 0),
            "negative": labels.get("negative", 0),
            "positive_share": round(labels.get("positive", 0) / len(scores), 3),
            "negative_share": round(labels.get("negative", 0) / len(scores), 3),
        }

    # velocity from dated reviews
    dated = [r["date"] for r in unique_reviews if r.get("date")]
    velocity = {}
    if dated:
        months = Counter(d[:7] for d in dated)
        velocity = {"by_month": dict(sorted(months.items())),
                    "months_covered": len(months),
                    "reviews_per_month": round(len(dated) / max(1, len(months)), 2)}
        recent_cutoff = (datetime.now(timezone.utc) - __import__("datetime").timedelta(days=180)).strftime("%Y-%m-%d")
        recent = [r for r in unique_reviews
                  if r.get("date") and r["date"] >= recent_cutoff and r.get("rating")]
        older = [r for r in unique_reviews
                 if r.get("date") and r["date"] < recent_cutoff and r.get("rating")]
        if len(recent) >= 3 and len(older) >= 3:
            velocity["recent_avg_rating"] = round(statistics.mean(r["rating"] for r in recent), 2)
            velocity["older_avg_rating"] = round(statistics.mean(r["rating"] for r in older), 2)
            velocity["trend"] = round(velocity["recent_avg_rating"] - velocity["older_avg_rating"], 2)
            velocity["trend_label"] = ("improving" if velocity["trend"] > 0.25 else
                                       "declining" if velocity["trend"] < -0.25 else "stable")
        velocity["latest_review"] = max(dated)

    responded = [r for r in unique_reviews if r.get("owner_response")]
    response_rate = round(len(responded) / len(unique_reviews), 3) if unique_reviews else None

    by_language = Counter(r.get("language") or "unknown" for r in unique_reviews)

    notable = {
        "best": sorted([r for r in unique_reviews if (r.get("rating") or 0) >= 4.5
                        and len(r.get("text") or "") > 80],
                       key=lambda r: -(r.get("rating") or 0))[:3],
        "worst": sorted([r for r in unique_reviews if (r.get("rating") or 0) <= 2.5
                         and len(r.get("text") or "") > 60],
                        key=lambda r: (r.get("rating") or 5))[:3],
    }
    for bucket in notable.values():
        for review in bucket:
            review["text"] = clean_text(review.get("text"), 420)

    return {
        "per_source": per_source,
        "consensus_rating": consensus,
        "simple_mean_rating": simple_mean,
        "rating_disagreement": disagreement,
        "total_reviews_across_sources": total_count,
        "collected_reviews": len(unique_reviews),
        "distribution": distribution,
        "sentiment": sentiment_summary,
        "themes": extract_themes(unique_reviews),
        "velocity": velocity,
        "owner_response_rate": response_rate,
        "owner_responses_collected": len(responded),
        "languages": dict(by_language),
        "notable": notable,
        "reviews": unique_reviews,
        "sources_present": sorted(per_source),
    }


def review_red_flags(review_data, results):
    flags = []
    sentiment = review_data.get("sentiment") or {}
    if sentiment.get("negative_share", 0) > 0.3 and review_data.get("collected_reviews", 0) >= 8:
        flags.append({
            "level": "high",
            "issue": "high negative sentiment share",
            "detail": f"{round(sentiment['negative_share'] * 100)}% of collected reviews read negative",
        })
    velocity = review_data.get("velocity") or {}
    if velocity.get("trend_label") == "declining":
        flags.append({"level": "high", "issue": "rating drift downwards",
                      "detail": f"recent average {velocity.get('recent_avg_rating')} vs older {velocity.get('older_avg_rating')}"})
    distribution = review_data.get("distribution") or {}
    total_dist = sum(distribution.values()) if distribution else 0
    if total_dist >= 20:
        one_star = distribution.get("1") or 0
        five_star = distribution.get("5") or 0
        if one_star / total_dist > 0.12:
            flags.append({"level": "medium", "issue": "notable 1-star share",
                          "detail": f"{one_star} of {total_dist} ratings are 1-star"})
        if five_star / total_dist > 0.9:
            flags.append({"level": "low", "issue": "suspiciously uniform 5-star distribution",
                          "detail": "possible review gating or incentivised reviews"})
    if review_data.get("owner_response_rate") is not None and review_data["owner_response_rate"] < 0.15 \
            and review_data.get("collected_reviews", 0) >= 10:
        flags.append({"level": "medium", "issue": "low owner-response rate",
                      "detail": f"{round(review_data['owner_response_rate'] * 100)}% of visible reviews have a reply"})
    if review_data.get("rating_disagreement") and review_data["rating_disagreement"] >= 0.8:
        flags.append({"level": "medium", "issue": "sources disagree on quality",
                      "detail": f"{review_data['rating_disagreement']} point spread between platforms"})
    for source, entry in (review_data.get("per_source") or {}).items():
        if entry.get("rating") and entry["rating"] < 4.0 and (entry.get("count") or 0) >= 20:
            flags.append({"level": "medium", "issue": f"below-4.0 rating on {entry['label']}",
                          "detail": f"{entry['rating']} from {entry['count']} reviews"})
    return flags


# =========================================================================
# 19. SOCIAL ANALYSIS
# =========================================================================
def _latest_post_date(posts):
    dates = []
    for post in posts or []:
        raw = (post.get("published") or post.get("created_at") or post.get("timestamp")
               or post.get("date") or post.get("createdAt"))
        if raw is None:
            continue
        if isinstance(raw, (int, float)) or (isinstance(raw, str) and raw.isdigit()):
            try:
                dates.append(datetime.fromtimestamp(float(raw), timezone.utc))
                continue
            except (ValueError, OSError):
                continue
        iso = any_date_to_iso(str(raw))
        if iso:
            try:
                dates.append(datetime.strptime(iso, "%Y-%m-%d").replace(tzinfo=timezone.utc))
            except ValueError:
                continue
    return max(dates) if dates else None


def analyze_social(results):
    matrix = []
    totals = {"followers": 0, "platforms_present": 0, "platforms_configured": 0}
    completeness_fields = ("name", "bio", "profile_pic_url", "handle", "external_url")
    completeness = {}
    handles = {}

    for source in sorted(SOCIAL_SOURCES):
        data = results.get(source) or {}
        profile = data.get("profile") or {}
        present = bool(profile) or bool(data.get("ok"))
        if source not in results:
            continue
        totals["platforms_configured"] += 1
        if present:
            totals["platforms_present"] += 1
        followers = profile.get("followers")
        if followers:
            totals["followers"] += followers
        latest = _latest_post_date(data.get("posts"))
        posts = profile.get("posts") or profile.get("videos")
        row = {
            "source": source,
            "label": data.get("label") or source,
            "url": data.get("url"),
            "present": present,
            "handle": profile.get("handle"),
            "followers": followers,
            "following": profile.get("following"),
            "posts": posts,
            "verified": profile.get("verified"),
            "likes": profile.get("likes"),
            "checkins": profile.get("checkins"),
            "talking_about": profile.get("talking_about"),
            "category": profile.get("category"),
            "bio": clean_text(profile.get("bio"), 300),
            "external_url": profile.get("external_url") or profile.get("website"),
            "last_post": latest.strftime("%Y-%m-%d") if latest else None,
            "days_since_post": (datetime.now(timezone.utc) - latest).days if latest else None,
            "posts_collected": len(data.get("posts") or []),
            "mode": data.get("mode"),
            "warnings": data.get("warnings") or [],
        }
        matrix.append(row)
        if profile.get("handle"):
            handles[source] = profile["handle"]
        score = sum(1 for field in completeness_fields if profile.get(field))
        completeness[source] = round(score / len(completeness_fields), 2)

    matrix.sort(key=lambda r: (not r["present"], -(r["followers"] or 0)))

    latest_dates = [r["last_post"] for r in matrix if r["last_post"]]
    stale = [r["source"] for r in matrix
             if r["days_since_post"] is not None and r["days_since_post"] > 60]
    active = [r["source"] for r in matrix
              if r["days_since_post"] is not None and r["days_since_post"] <= 30]

    # handle consistency across platforms
    token_sets = [name_tokens(handle.replace("_", " ").replace(".", " ")) for handle in handles.values()]
    common = set.intersection(*token_sets) if len(token_sets) >= 2 else set()
    consistency = round(len(common) / max(1, len(token_sets)), 2) if token_sets else None

    gaps = [source for source in ("instagram", "facebook", "tiktok", "youtube")
            if source not in {row["source"] for row in matrix if row["present"]}]

    return {
        "matrix": matrix,
        "totals": totals,
        "completeness": completeness,
        "handles": handles,
        "handle_consistency": consistency,
        "latest_activity": max(latest_dates) if latest_dates else None,
        "stale_platforms": stale,
        "active_platforms": active,
        "gaps": gaps,
        "cadence": _cadence_from_results(results),
        "hashtags": _hashtags_from_results(results),
        "content_mix": _content_mix(results),
        "engagement": _engagement_estimates(results),
    }


def _cadence_from_results(results):
    out = {}
    for source in SOCIAL_SOURCES:
        data = results.get(source) or {}
        posts = data.get("posts") or []
        dates = []
        for post in posts:
            raw = post.get("published") or post.get("created_at") or post.get("createdAt")
            if raw is None:
                continue
            if isinstance(raw, (int, float)) or (isinstance(raw, str) and raw.isdigit()):
                try:
                    dates.append(datetime.fromtimestamp(float(raw), timezone.utc))
                except (ValueError, OSError):
                    continue
            else:
                iso = any_date_to_iso(str(raw))
                if iso:
                    try:
                        dates.append(datetime.strptime(iso, "%Y-%m-%d").replace(tzinfo=timezone.utc))
                    except ValueError:
                        continue
        if len(dates) >= 2:
            span_days = max(7, (max(dates) - min(dates)).days)
            out[source] = {
                "posts_sampled": len(dates),
                "window_days": span_days,
                "posts_per_month": round(len(dates) / (span_days / 30.4), 2),
            }
    return out


def _hashtags_from_results(results):
    counter = Counter()
    for source in SOCIAL_SOURCES:
        data = results.get(source) or {}
        for post in data.get("posts") or []:
            caption = post.get("caption") or post.get("desc") or ""
            counter.update(re.findall(r"#([A-Za-z0-9_]{2,40})", caption))
        profile = data.get("profile") or {}
        counter.update(re.findall(r"#([A-Za-z0-9_]{2,40})", profile.get("bio") or ""))
    return [f"#{tag}" for tag, _ in counter.most_common(20)]


def _content_mix(results):
    mix = Counter()
    for source in SOCIAL_SOURCES:
        data = results.get(source) or {}
        for post in data.get("posts") or []:
            kind = post.get("type") or ("video" if (post.get("plays") or post.get("isVideo")) else "post")
            mix[kind] += 1
        for _ in (data.get("business") or {}).get("images") or []:
            mix["photo"] += 1
    total = sum(mix.values())
    return {kind: {"count": count, "share": round(count / total, 2) if total else 0}
            for kind, count in mix.most_common()}


def _engagement_estimates(results):
    """Engagement rate where likes/comments + followers are both known."""
    out = {}
    for source in SOCIAL_SOURCES:
        data = results.get(source) or {}
        followers = (data.get("profile") or {}).get("followers")
        posts = data.get("posts") or []
        interactions = [(p.get("likes") or 0) + (p.get("comments") or 0) for p in posts
                        if p.get("likes") is not None or p.get("comments") is not None]
        if followers and interactions:
            average = statistics.mean(interactions)
            out[source] = {
                "followers": followers,
                "avg_interactions_per_post": round(average, 1),
                "engagement_rate": round(average / followers * 100, 2),
                "sample_posts": len(interactions),
            }
    return out


# =========================================================================
# 20. IDENTITY / NAP RECONCILIATION
# =========================================================================
REGION_ALIASES = {
    "sct": "scotland", "sco": "scotland", "eng": "england", "wls": "wales",
    "nir": "northern ireland", "gb": "united kingdom", "gbr": "united kingdom",
    "uk": "united kingdom", "gla": "glasgow", "edi": "edinburgh",
}


def address_key(text):
    """Comparable form of an address: aliases expanded, noise removed."""
    if not text:
        return ""
    tokens = normalize_text(text).split()
    expanded = [REGION_ALIASES.get(token, token) for token in tokens]
    return " ".join(expanded)


def reconcile_identity(results, business):
    names, addresses, phones, websites, emails = Counter(), Counter(), Counter(), Counter(), Counter()

    def add(counter, value):
        if not value:
            return
        text = clean_text(str(value))
        if not text or len(text) < 3:
            return
        counter[text] += 1

    for source, data in results.items():
        if not data:
            continue
        info = data.get("business") or {}
        profile = data.get("profile") or {}
        add(names, info.get("name"))
        add(names, profile.get("name") or profile.get("full_name") or profile.get("nickname"))
        add(phones, info.get("phone") or info.get("telephone"))
        add(phones, profile.get("phone"))
        add(emails, info.get("email"))
        add(emails, profile.get("email"))
        add(websites, info.get("website"))
        add(websites, profile.get("external_url") or profile.get("website"))
        address = info.get("address")
        if isinstance(address, dict):
            add(addresses, address.get("full"))
            add(addresses, address.get("line"))
        elif address:
            add(addresses, str(address))
        for email in (data.get("metrics") or {}).get("emails") or []:
            add(emails, email)
        for phone in (data.get("metrics") or {}).get("phones") or []:
            add(phones, phone)

    canonical_name = names.most_common(1)[0][0] if names else business.get("name")
    configured = business.get("name")
    if configured:
        for form in names:
            if normalize_text(form) == normalize_text(configured):
                canonical_name = form
                break
    canonical_address = addresses.most_common(1)[0][0] if addresses else None
    canonical_phone = phones.most_common(1)[0][0] if phones else None
    canonical_website = websites.most_common(1)[0][0] if websites else business.get("website")

    address_forms = [a for a, _ in addresses.most_common(6)]
    address_clusters = []
    for form in address_forms:
        key_tokens = set(address_key(form).split())
        if not key_tokens:
            continue
        placed = False
        for cluster in address_clusters:
            shared = len(key_tokens & cluster["tokens"])
            if shared / max(1, min(len(key_tokens), len(cluster["tokens"]))) >= 0.7:
                cluster["forms"].append(form)
                cluster["tokens"] |= key_tokens
                placed = True
                break
        if not placed:
            address_clusters.append({"tokens": key_tokens, "forms": [form]})
    name_forms = [n for n, _ in names.most_common(6)]

    conflicts = []
    if len(address_clusters) > 1:
        conflicts.append({"field": "address",
                          "variants": [c["forms"][0] for c in address_clusters]})
    if len(phones) > 2:
        conflicts.append({"field": "phone", "variants": [p for p, _ in phones.most_common(6)]})
    if len(websites) > 2:
        conflicts.append({"field": "website", "variants": [w for w, _ in websites.most_common(6)]})

    return {
        "canonical": {
            "name": canonical_name,
            "address": canonical_address,
            "phone": canonical_phone,
            "website": canonical_website,
            "emails": [e for e, _ in emails.most_common(6)],
        },
        "names_seen": name_forms,
        "addresses_seen": address_forms,
        "phones_seen": [p for p, _ in phones.most_common(6)],
        "websites_seen": [w for w, _ in websites.most_common(6)],
        "emails_seen": [e for e, _ in emails.most_common(6)],
        "conflicts": conflicts,
        "consistency": round(1.0 - min(1.0, len(conflicts) / 3.0), 2),
    }


# =========================================================================
# 21. SCORING & SIGNALS
# =========================================================================
def compute_scores(reviews, social, identity, web, results):
    reputation = 0.0
    rating = reviews.get("consensus_rating")
    count = reviews.get("total_reviews_across_sources") or 0
    sentiment = (reviews.get("sentiment") or {}).get("mean")
    response = reviews.get("owner_response_rate")

    if rating:
        reputation += clamp((rating - 2.5) / 2.5) * 55
    if count:
        reputation += clamp(math.log10(count + 1) / math.log10(5000)) * 20
    if sentiment is not None:
        reputation += clamp((sentiment + 1) / 2) * 15
    if response is not None:
        reputation += clamp(response / 0.6) * 10
    else:
        reputation += 4  # neutral when unknown

    social_strength = 0.0
    present = social.get("totals", {}).get("platforms_present", 0)
    followers = social.get("totals", {}).get("followers", 0)
    social_strength += clamp(present / 4) * 35
    if followers:
        social_strength += clamp(math.log10(followers + 1) / math.log10(50000)) * 40
    active = len(social.get("active_platforms") or [])
    social_strength += clamp(active / 3) * 25

    content_health = 0.0
    completeness = social.get("completeness") or {}
    if completeness:
        content_health += (sum(completeness.values()) / len(completeness)) * 35
    if web.get("has_menu_online"):
        content_health += 10
    if web.get("has_online_booking"):
        content_health += 15
    if (reviews.get("collected_reviews") or 0) >= 5:
        content_health += 10
    if social.get("latest_activity"):
        content_health += 10
    if any((results.get(s) or {}).get("mode") for s in SOCIAL_SOURCES):
        content_health += 5
    if identity.get("canonical", {}).get("address"):
        content_health += 5
    if web.get("has_online_delivery"):
        content_health += 5

    discoverability = 0.0
    discoverability += (identity.get("consistency") or 0) * 25
    if identity.get("canonical", {}).get("website"):
        discoverability += 15
    if (results.get("google") or {}).get("rating"):
        discoverability += 20
    discoverability += clamp(len(reviews.get("sources_present") or []) / 4) * 25
    if web.get("has_online_booking") or web.get("has_menu_online"):
        discoverability += 15

    scores = {
        "reputation": round(clamp(reputation / 100) * 100, 1),
        "social_strength": round(clamp(social_strength / 100) * 100, 1),
        "content_health": round(clamp(content_health / 100) * 100, 1),
        "discoverability": round(clamp(discoverability / 100) * 100, 1),
    }
    scores["overall"] = round(
        scores["reputation"] * 0.40 + scores["social_strength"] * 0.25 +
        scores["content_health"] * 0.20 + scores["discoverability"] * 0.15, 1)
    return scores


def build_signals(reviews, social, identity, web, scores):
    strengths, weaknesses, opportunities, risks = [], [], [], []

    rating = reviews.get("consensus_rating")
    if rating and rating >= 4.5:
        strengths.append(f"Strong consensus rating of {rating}/5 across "
                         f"{len(reviews.get('sources_present') or [])} platforms")
    if (reviews.get("total_reviews_across_sources") or 0) >= 500:
        strengths.append(f"High review volume ({reviews['total_reviews_across_sources']:,}) — "
                         "strong social proof")
    sentiment = (reviews.get("sentiment") or {})
    if sentiment.get("positive_share", 0) >= 0.6 and (reviews.get("collected_reviews") or 0) >= 8:
        strengths.append(f"{round(sentiment['positive_share'] * 100)}% of collected reviews read positive")
    if (reviews.get("collected_reviews") or 0) < 8:
        weaknesses.append(
            f"Only {reviews.get('collected_reviews') or 0} reviews were readable in detail — "
            "sentiment/theme reads are indicative, not statistically robust")
    themes = reviews.get("themes") or {}
    if themes:
        top_theme = next(iter(themes))
        top = themes[top_theme]
        if top.get("net_sentiment", 0) > 0.4 and top.get("mentions", 0) >= 5:
            strengths.append(f"Guests consistently praise {top_theme} "
                             f"({top['positive']} positive vs {top['negative']} negative mentions)")
    if (social.get("totals", {}).get("followers") or 0) > 0:
        strengths.append(f"{social['totals']['followers']:,} combined followers across "
                         f"{social['totals']['platforms_present']} social platforms")
    if web.get("booking_providers"):
        strengths.append("Online booking via " + ", ".join(web["booking_providers"]))
    if web.get("has_menu_online"):
        strengths.append("Menu published online (helps discovery + conversion)")

    if rating and rating < 4.2:
        weaknesses.append(f"Consensus rating {rating}/5 below the 4.2 comfort threshold")
    if (reviews.get("owner_response_rate") is not None
            and reviews["owner_response_rate"] < 0.2):
        pct = round(reviews["owner_response_rate"] * 100)
        if pct == 0:
            weaknesses.append("No owner responses visible on the collected reviews")
        else:
            weaknesses.append(f"Only {pct}% of visible reviews have an owner response")
    negative_themes = [name for name, entry in themes.items()
                       if entry.get("net_sentiment", 0) <= -0.2 and entry.get("mentions", 0) >= 3]
    if negative_themes:
        weaknesses.append("Negative theme clusters: " + ", ".join(negative_themes[:3]))
    if social.get("gaps"):
        weaknesses.append("No presence on " + ", ".join(social["gaps"]))
    if social.get("stale_platforms"):
        weaknesses.append("Stale profiles: " + ", ".join(social["stale_platforms"]))
    if identity.get("conflicts"):
        fields = ", ".join(c["field"] for c in identity["conflicts"])
        weaknesses.append(f"Inconsistent NAP data across sources ({fields})")

    if not web.get("has_online_booking"):
        opportunities.append("Add online booking (OpenTable/ResDiary/SevenRooms) "
                             "to capture direct demand")
    if social.get("gaps"):
        opportunities.append("Open and seed " + ", ".join(social["gaps"]) +
                             " with UGC reposts and short-form video")
    if (reviews.get("owner_response_rate") or 0) < 0.5:
        opportunities.append("Reply to every recent review — replies correlate with "
                             "higher ratings and conversion")
    if (reviews.get("collected_reviews") or 0) < 30:
        opportunities.append("Review volume is thin relative to competitors — "
                             "a post-visit ask could double social proof")
    if web.get("delivery_providers"):
        opportunities.append("Delivery listed on " + ", ".join(web["delivery_providers"]))
    else:
        opportunities.append("No delivery presence detected — consider Deliveroo/Uber Eats "
                             "for incremental revenue")

    for flag in review_red_flags(reviews, None):
        risks.append(f"{flag['issue']}: {flag['detail']}")
    if (scores.get("social_strength") or 0) < 40:
        risks.append("Social reach is low relative to review footprint — brand discovery "
                     "depends almost entirely on marketplace listings")

    return {
        "strengths": dedupe(strengths)[:6],
        "weaknesses": dedupe(weaknesses)[:6],
        "opportunities": dedupe(opportunities)[:6],
        "risks": dedupe(risks)[:5],
    }


# =========================================================================
# 22. PROFILE ASSEMBLY
# =========================================================================
def assemble_profile(ctx, assets):
    results = ctx.results
    reviews = aggregate_reviews(results)
    social = analyze_social(results)
    identity = reconcile_identity(results, ctx.business)
    website = results.get("website") or {}
    web = {
        "url": website.get("url"),
        "has_online_booking": (website.get("metrics") or {}).get("has_online_booking"),
        "has_online_delivery": (website.get("metrics") or {}).get("has_online_delivery"),
        "has_menu_online": (website.get("metrics") or {}).get("has_menu_online"),
        "booking_providers": (website.get("metrics") or {}).get("booking_providers") or [],
        "delivery_providers": (website.get("metrics") or {}).get("delivery_providers") or [],
        "tech": (website.get("metrics") or {}).get("tech") or [],
        "pages_crawled": len(website.get("pages") or []),
        "sitemap_urls": (website.get("metrics") or {}).get("sitemap_urls"),
    }
    compliance = (results.get("food_hygiene") or {}).get("compliance") or None
    mentions = (results.get("press") or {}).get("mentions") or []
    web["mentions"] = mentions[:20]
    web["mention_count"] = len(mentions)
    web["mention_kinds"] = (results.get("press") or {}).get("metrics", {}).get("kinds") or {}

    scores = compute_scores(reviews, social, identity, web, results)
    signals = build_signals(reviews, social, identity, web, scores)
    if compliance:
        if compliance.get("passed") is False:
            signals["risks"].insert(0, f"Food hygiene rating: {compliance.get('rating')} "
                                       f"({compliance.get('inspection_date')}) — "
                                       "fix and re-inspect before it reaches review sites")
            scores["reputation"] = round(max(0.0, scores["reputation"] - 8), 1)
            scores["overall"] = round(
                scores["reputation"] * 0.40 + scores["social_strength"] * 0.25 +
                scores["content_health"] * 0.20 + scores["discoverability"] * 0.15, 1)
        elif compliance.get("rating"):
            signals["strengths"].append(
                f"Food hygiene rating '{compliance.get('rating')}' "
                f"({compliance.get('inspection_date')})")
    if web["mention_kinds"].get("award"):
        signals["strengths"].append(
            f"{web['mention_kinds']['award']} award/editorial mention(s) in independent web coverage")
    if web["mention_kinds"].get("incident"):
        signals["risks"].append(
            f"{web['mention_kinds']['incident']} potentially negative press mention(s) found")
    flags = review_red_flags(reviews, results)

    # Google's own "mentioned in N reviews" tags are the cheapest theme signal
    topics = []
    for data in results.values():
        for topic in (data or {}).get("topics") or []:
            topics.append({"label": topic.get("label"),
                           "mentions": topic.get("mentions"),
                           "source": (data or {}).get("source")})
    web_ratings = []
    for data in results.values():
        for entry in ((data or {}).get("metrics") or {}).get("reviews_from_web") or []:
            web_ratings.append(entry)

    profile = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": iso_now(),
        "group": State.group,
        "business": {
            "name": ctx.name,
            "slug": ctx.business.get("slug") or site_slug(ctx.name),
            "aliases": ctx.business.get("aliases") or [],
            "city": ctx.city,
            "region": ctx.business.get("region"),
            "country": ctx.country,
            "category": ctx.business.get("category"),
            "website": identity["canonical"].get("website") or ctx.business.get("website"),
        },
        "identity": identity,
        "reputation": {
            "consensus_rating": reviews["consensus_rating"],
            "simple_mean_rating": reviews["simple_mean_rating"],
            "total_reviews": reviews["total_reviews_across_sources"],
            "collected_reviews": reviews["collected_reviews"],
            "sources": reviews["per_source"],
            "sources_present": reviews["sources_present"],
            "distribution": reviews["distribution"],
            "sentiment": reviews["sentiment"],
            "velocity": reviews["velocity"],
            "owner_response_rate": reviews["owner_response_rate"],
            "rating_disagreement": reviews["rating_disagreement"],
            "languages": reviews["languages"],
            "themes": reviews["themes"],
            "topics": dedupe(topics),
            "other_platform_ratings": dedupe(web_ratings),
            "notable": reviews["notable"],
            "red_flags": flags,
        },
        "social": social,
        "web": web,
        "compliance": compliance,
        "mentions": mentions[:20],
        "signals": signals,
        "scores": scores,
        "provenance": {
            "profiles": ctx.profiles,
            "profile_evidence": ctx.evidence,
            "sources": {source: {"mode": data.get("mode"), "url": data.get("url"),
                                 "ok": data.get("ok"),
                                 "reviews": len(data.get("reviews") or []),
                                 "rating": (data.get("rating") or {}).get("value"),
                                 "count": (data.get("rating") or {}).get("count"),
                                 "warnings": data.get("warnings") or []}
                        for source, data in results.items() if data},
            "assets": assets,
            "run_stats": dict(State.stats),
        },
    }
    return profile, reviews


# =========================================================================
# 23. OUTPUT WRITERS
# =========================================================================
def md_table(headers, rows):
    if not rows:
        return "_(no data)_\n"
    out = ["| " + " | ".join(str(h) for h in headers) + " |",
           "|" + "|".join("---" for _ in headers) + "|"]
    for row in rows:
        cells = []
        for value in row:
            text = "" if value is None else str(value)
            cells.append(text.replace("|", "\\|").replace("\n", " "))
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out) + "\n"


def format_number(value):
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:,.2f}".rstrip("0").rstrip(".")
    if isinstance(value, int):
        return f"{value:,}"
    return str(value)


def write_reviews_csv(path, reviews):
    columns = ["source", "date", "rating", "author", "title", "text",
               "sentiment", "language", "owner_response", "photos", "url"]
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for review in reviews:
            row = dict(review)
            response = row.get("owner_response")
            row["owner_response"] = (response or {}).get("text") if isinstance(response, dict) else response
            writer.writerow({key: row.get(key) for key in columns})


def write_insights_md(path, profile, reviews):
    business = profile["business"]
    scores = profile["scores"]
    rep = profile["reputation"]
    social = profile["social"]
    web = profile["web"]
    identity = profile["identity"]
    lines = [f"# {business['name']} — social & reputation intelligence", ""]
    lines.append(f"*Generated {profile['generated_at']} · group `{profile['group']}` · "
                 f"schema v{profile['schema_version']}*")
    lines.append("")

    lines.append("## 1. Snapshot")
    lines.append("")
    lines.append(md_table(
        ["Signal", "Value"],
        [["Consensus rating", f"{format_number(rep['consensus_rating'])} / 5"],
         ["Reviews across sources", format_number(rep["total_reviews"])],
         ["Reviews analysed in detail", format_number(rep["collected_reviews"])],
         ["Sources present", ", ".join(rep["sources"]) or "—"],
         ["Combined social followers", format_number(social["totals"]["followers"])],
         ["Platforms present", f"{social['totals']['platforms_present']} of "
                                f"{social['totals']['platforms_configured']}"],
         ["Last social activity", social.get("latest_activity") or "unknown"],
         ["Online booking", "yes" if web.get("has_online_booking") else "no"],
         ["Menu online", "yes" if web.get("has_menu_online") else "no"],
         ["Overall score", f"{scores['overall']} / 100"]]))
    lines.append(md_table(
        ["Reputation", "Social", "Content", "Discoverability"],
        [[f"{scores['reputation']}", f"{scores['social_strength']}",
          f"{scores['content_health']}", f"{scores['discoverability']}"]]))
    lines.append("")

    lines.append("## 2. Identity & NAP")
    lines.append("")
    lines.append(md_table(["Field", "Canonical value"],
                          [["Name", identity["canonical"].get("name")],
                           ["Address", identity["canonical"].get("address")],
                           ["Phone", identity["canonical"].get("phone")],
                           ["Website", identity["canonical"].get("website")],
                           ["Emails", ", ".join(identity["canonical"].get("emails") or [])]]))
    if identity["conflicts"]:
        lines.append("**Conflicts detected:**")
        for conflict in identity["conflicts"]:
            lines.append(f"- `{conflict['field']}`: " + " · ".join(conflict["variants"]))
    else:
        lines.append("_No NAP conflicts detected across sources._")
    lines.append("")

    lines.append("## 3. Reputation across platforms")
    lines.append("")
    rows = []
    for source, entry in sorted((rep["sources"] or {}).items(),
                                key=lambda kv: -(kv[1].get("count") or 0)):
        rows.append([entry["label"], f"{format_number(entry.get('rating'))}/5",
                     format_number(entry.get("count")),
                     format_number(entry.get("collected")), entry.get("mode") or "—"])
    lines.append(md_table(["Platform", "Rating", "Reviews", "Analysed", "Mode"], rows))
    if rep.get("distribution"):
        rows = [[f"{stars}★", format_number(count)] for stars, count in sorted(rep["distribution"].items(), reverse=True)]
        lines.append(md_table(["Stars", "Count"], rows))
    velocity = rep.get("velocity") or {}
    if velocity:
        lines.append(f"- Latest review: **{velocity.get('latest_review')}**")
        if velocity.get("reviews_per_month"):
            lines.append(f"- Velocity: **{velocity['reviews_per_month']} reviews/month** "
                         f"across {velocity.get('months_covered')} months")
        if velocity.get("trend_label"):
            lines.append(f"- Trend: **{velocity['trend_label']}** "
                         f"({velocity.get('recent_avg_rating')} recent vs {velocity.get('older_avg_rating')} older)")
    if rep.get("owner_response_rate") is not None:
        lines.append(f"- Owner response rate: **{round(rep['owner_response_rate'] * 100)}%**")
    if rep.get("rating_disagreement") is not None:
        lines.append(f"- Platform disagreement: **{rep['rating_disagreement']} points**")
    sentiment = rep.get("sentiment") or {}
    if sentiment:
        lines.append(f"- Sentiment: **{round(sentiment.get('positive_share', 0) * 100)}% positive**, "
                     f"{round(sentiment.get('negative_share', 0) * 100)}% negative "
                     f"(mean {sentiment.get('mean')})")
    if rep.get("red_flags"):
        lines.append("")
        lines.append("**Red flags**")
        for flag in rep["red_flags"]:
            lines.append(f"- `{flag['level']}` **{flag['issue']}** — {flag['detail']}")
    lines.append("")

    lines.append("## 4. What guests talk about")
    lines.append("")
    theme_rows = []
    for theme, entry in (rep.get("themes") or {}).items():
        theme_rows.append([theme, entry["mentions"], entry["positive"],
                           entry["negative"], entry["net_sentiment"]])
    lines.append(md_table(["Theme", "Mentions", "Pos", "Neg", "Net"], theme_rows))
    topics = rep.get("topics") or []
    if topics:
        lines.append("**Google topic tags** (terms Google surfaces from review text)")
        lines.append("")
        lines.append(md_table(["Topic", "Mentions"],
                              [[t.get("label"), t.get("mentions")] for t in topics[:15]]))
    other = rep.get("other_platform_ratings") or []
    if other:
        lines.append("**Other platform ratings surfaced by Google**")
        lines.append("")
        lines.append(md_table(["Platform", "Rating", "Reviews"],
                              [[o.get("source"), o.get("rating"), o.get("count")] for o in other]))
    for kind, label in (("best", "Standout praise"), ("worst", "Recurring complaints")):
        bucket = (rep.get("notable") or {}).get(kind) or []
        if bucket:
            lines.append(f"**{label}**")
            for review in bucket:
                stars = review.get("rating")
                lines.append(f"> {review.get('text')}")
                lines.append(f"> — {review.get('author') or 'anonymous'}, "
                             f"{stars}★ {review.get('date') or ''} "
                             f"({(rep['sources'].get(review.get('source'), {}) or {}).get('label', review.get('source'))})")
                lines.append("")
    lines.append("")

    if profile.get("compliance"):
        comp = profile["compliance"]
        lines.append("## 4b. Compliance")
        lines.append("")
        lines.append(md_table(["Field", "Value"],
                              [["Scheme", comp.get("scheme")],
                               ["Rating", comp.get("rating")],
                               ["Inspection date", comp.get("inspection_date")],
                               ["Authority", comp.get("authority")],
                               ["Business type", comp.get("business_type")],
                               ["Address", comp.get("address")],
                               ["Match confidence", comp.get("match_score")],
                               ["Source", comp.get("source_url")]]))
        scores_in = comp.get("scores") or {}
        if any(scores_in.values()):
            lines.append(md_table(["Hygiene", "Structural", "Confidence"],
                                  [[scores_in.get("Hygiene"), scores_in.get("Structural"),
                                    scores_in.get("ConfidenceInManagement")]]))
        lines.append("")

    lines.append("## 5. Social presence")
    lines.append("")
    rows = []
    for row in social["matrix"]:
        rows.append([row["label"],
                     "yes" if row["present"] else "no",
                     format_number(row["followers"]),
                     format_number(row["posts"]),
                     row["last_post"] or "—",
                     row.get("mode") or "—"])
    lines.append(md_table(["Platform", "Present", "Followers", "Posts", "Last post", "Mode"], rows))
    if social.get("gaps"):
        lines.append(f"- **Gaps:** {', '.join(social['gaps'])}")
    if social.get("stale_platforms"):
        lines.append(f"- **Stale (>60 days):** {', '.join(social['stale_platforms'])}")
    if social.get("handle_consistency") is not None:
        lines.append(f"- Handle consistency: **{social['handle_consistency']}**")
    if social.get("hashtags"):
        lines.append(f"- Hashtags seen: {' '.join(social['hashtags'][:15])}")
    for source, cadence in (social.get("cadence") or {}).items():
        lines.append(f"- Cadence `{source}`: {cadence['posts_per_month']} posts/month "
                     f"(sample {cadence['posts_sampled']})")
    lines.append("")

    lines.append("## 6. Web & conversion path")
    lines.append("")
    lines.append(md_table(
        ["Signal", "Value"],
        [["Website", web.get("url")],
         ["Pages crawled", web.get("pages_crawled")],
         ["Sitemap URLs", web.get("sitemap_urls")],
         ["Booking providers", ", ".join(web.get("booking_providers") or []) or "—"],
         ["Delivery providers", ", ".join(web.get("delivery_providers") or []) or "—"],
         ["Menu online", "yes" if web.get("has_menu_online") else "no"],
         ["Tech detected", ", ".join(web.get("tech") or []) or "—"]]))
    lines.append("")

    if profile.get("mentions"):
        lines.append("## 6b. Press & web mentions")
        lines.append("")
        rows = [[m.get("kind"), clean_text(m.get("title"), 90), m.get("host")]
                for m in profile["mentions"][:15]]
        lines.append(md_table(["Kind", "Title", "Host"], rows))
        lines.append("")

    signals = profile["signals"]
    lines.append("## 7. Signals")
    lines.append("")
    for key, title in (("strengths", "Strengths"), ("weaknesses", "Weaknesses"),
                       ("opportunities", "Opportunities"), ("risks", "Risks")):
        lines.append(f"**{title}**")
        for item in signals.get(key) or []:
            lines.append(f"- {item}")
        lines.append("")

    lines.append("## 8. Provenance")
    lines.append("")
    rows = []
    for source, entry in (profile["provenance"]["sources"] or {}).items():
        rows.append([source, entry.get("mode") or "—", entry.get("url") or "—",
                     format_number(entry.get("rating")), format_number(entry.get("count")),
                     entry.get("reviews"), "; ".join(entry.get("warnings") or [])[:120] or "—"])
    lines.append(md_table(["Source", "Mode", "URL", "Rating", "Count", "Pulled", "Warnings"], rows))
    lines.append("")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


REPORT_CSS = """
:root{--bg:#0f1115;--card:#171a21;--ink:#e7e9ee;--muted:#9aa3b2;--line:#252a34;
--good:#2fbf71;--warn:#f0a500;--bad:#e5484d;--accent:#6aa8ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:40px 24px 80px}
h1{font-size:30px;margin:0 0 6px;letter-spacing:-.02em}
h2{font-size:19px;margin:38px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--line)}
.sub{color:var(--muted);font-size:13px;margin-bottom:26px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.card .n{font-size:24px;font-weight:650;letter-spacing:-.02em}
.card .l{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-top:2px}
table{width:100%;border-collapse:collapse;margin:10px 0 16px;font-size:13.5px}
th{text-align:left;color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.07em;padding:8px 10px;border-bottom:1px solid var(--line)}
td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
tr:hover td{background:#1b1f27}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600}
.yes{background:rgba(47,191,113,.15);color:var(--good)}
.no{background:rgba(229,72,77,.13);color:var(--bad)}
blockquote{margin:8px 0 14px;padding:12px 16px;background:var(--card);border-left:3px solid var(--accent);border-radius:0 10px 10px 0;color:#d4d8e1;font-size:14px}
blockquote .who{display:block;color:var(--muted);font-size:12px;margin-top:6px}
ul{margin:8px 0 14px;padding-left:20px}
li{margin:5px 0}
.bar{height:6px;border-radius:99px;background:#222733;overflow:hidden;margin-top:6px}
.bar>i{display:block;height:100%;background:linear-gradient(90deg,#6aa8ff,#2fbf71)}
.split{display:grid;grid-template-columns:1fr 1fr;gap:22px}
@media(max-width:720px){.split{grid-template-columns:1fr}}
.small{color:var(--muted);font-size:12.5px}
"""


def write_report_html(path, profile, reviews):
    business = profile["business"]
    scores = profile["scores"]
    rep = profile["reputation"]
    social = profile["social"]
    web = profile["web"]
    esc = html_escape

    def score_card(label, value):
        return (f'<div class="card"><div class="n">{value}</div>'
                f'<div class="l">{esc(label)}</div>'
                f'<div class="bar"><i style="width:{max(2, min(100, float(value or 0)))}%"></i></div></div>')

    parts = [f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
             f'<meta name="viewport" content="width=device-width,initial-scale=1">'
             f'<title>{esc(business["name"])} — intelligence report</title>'
             f'<style>{REPORT_CSS}</style></head><body><div class="wrap">']
    parts.append(f'<h1>{esc(business["name"])}</h1>')
    parts.append(f'<div class="sub">{esc(business.get("city") or "")} · '
                 f'{esc(business.get("category") or "")} · generated {esc(profile["generated_at"])}</div>')
    parts.append('<div class="cards">')
    for label, value in (("Overall", scores["overall"]),
                         ("Reputation", scores["reputation"]),
                         ("Social", scores["social_strength"]),
                         ("Content", scores["content_health"]),
                         ("Discoverability", scores["discoverability"])):
        parts.append(score_card(label, value))
    parts.append('</div>')

    parts.append('<div class="cards">')
    parts.append(f'<div class="card"><div class="n">{format_number(rep["consensus_rating"])}<span class="small">/5</span></div><div class="l">Consensus rating</div></div>')
    parts.append(f'<div class="card"><div class="n">{format_number(rep["total_reviews"])}</div><div class="l">Reviews (all sources)</div></div>')
    parts.append(f'<div class="card"><div class="n">{format_number(social["totals"]["followers"])}</div><div class="l">Combined followers</div></div>')
    parts.append(f'<div class="card"><div class="n">{format_number(rep["collected_reviews"])}</div><div class="l">Reviews analysed</div></div>')
    parts.append('</div>')

    parts.append('<h2>Reputation by platform</h2>')
    rows = []
    for source, entry in sorted((rep["sources"] or {}).items(), key=lambda kv: -(kv[1].get("count") or 0)):
        rows.append(f'<tr><td>{esc(entry["label"])}</td><td>{format_number(entry.get("rating"))}</td>'
                    f'<td>{format_number(entry.get("count"))}</td>'
                    f'<td>{format_number(entry.get("collected"))}</td>'
                    f'<td class="small">{esc(entry.get("mode") or "—")}</td></tr>')
    parts.append('<table><thead><tr><th>Platform</th><th>Rating</th><th>Reviews</th>'
                 '<th>Analysed</th><th>Mode</th></tr></thead><tbody>' + "".join(rows) + '</tbody></table>')

    if rep.get("distribution"):
        parts.append('<h2>Rating distribution</h2><table><tbody>')
        for stars in ("5", "4", "3", "2", "1"):
            count = rep["distribution"].get(stars)
            if count:
                parts.append(f'<tr><td>{stars}★</td><td>{format_number(count)}</td></tr>')
        parts.append('</tbody></table>')

    if rep.get("themes"):
        parts.append('<h2>What guests talk about</h2><table><thead><tr><th>Theme</th>'
                     '<th>Mentions</th><th>Positive</th><th>Negative</th><th>Net</th></tr></thead><tbody>')
        for theme, entry in rep["themes"].items():
            net = entry["net_sentiment"]
            colour = "var(--good)" if net > 0.2 else "var(--bad)" if net < -0.2 else "var(--muted)"
            parts.append(f'<tr><td>{esc(theme)}</td><td>{entry["mentions"]}</td>'
                         f'<td>{entry["positive"]}</td><td>{entry["negative"]}</td>'
                         f'<td style="color:{colour};font-weight:600">{net}</td></tr>')
        parts.append('</tbody></table>')

    topics = rep.get("topics") or []
    if topics:
        parts.append('<h2>Guest topics (Google review summary)</h2><table><tbody>')
        for topic in topics[:15]:
            parts.append(f'<tr><td>{esc(str(topic.get("label")))}</td>'
                         f'<td>{format_number(topic.get("mentions"))} mentions</td></tr>')
        parts.append('</tbody></table>')
    other = rep.get("other_platform_ratings") or []
    if other:
        parts.append('<h2>Other platform ratings surfaced by Google</h2><table><tbody>')
        for entry in other:
            parts.append(f'<tr><td>{esc(str(entry.get("source")))}</td>'
                         f'<td>{format_number(entry.get("rating"))} / 5</td>'
                         f'<td>{format_number(entry.get("count"))} reviews</td></tr>')
        parts.append('</tbody></table>')

    for kind, title in (("best", "Standout praise"), ("worst", "Recurring complaints")):
        bucket = (rep.get("notable") or {}).get(kind) or []
        if bucket:
            parts.append(f'<h2>{title}</h2>')
            for review in bucket:
                label = (rep["sources"].get(review.get("source")) or {}).get("label", review.get("source"))
                parts.append(f'<blockquote>{esc(review.get("text") or "")}'
                             f'<span class="who">{esc(str(review.get("author") or "anonymous"))} · '
                             f'{format_number(review.get("rating"))}★ · {esc(review.get("date") or "")} · '
                             f'{esc(str(label))}</span></blockquote>')

    parts.append('<h2>Social presence</h2><table><thead><tr><th>Platform</th><th>Present</th>'
                 '<th>Followers</th><th>Posts</th><th>Last post</th><th>Link</th></tr></thead><tbody>')
    for row in social["matrix"]:
        pill = '<span class="pill yes">yes</span>' if row["present"] else '<span class="pill no">no</span>'
        link = f'<a href="{esc(row["url"])}" style="color:var(--accent)">profile</a>' if row.get("url") else "—"
        parts.append(f'<tr><td>{esc(row["label"])}</td><td>{pill}</td>'
                     f'<td>{format_number(row["followers"])}</td><td>{format_number(row["posts"])}</td>'
                     f'<td>{esc(row["last_post"] or "—")}</td><td>{link}</td></tr>')
    parts.append('</tbody></table>')

    parts.append('<div class="split">')
    parts.append('<div><h2>Strengths</h2><ul>')
    for item in profile["signals"].get("strengths") or []:
        parts.append(f'<li>{esc(item)}</li>')
    parts.append('</ul><h2>Opportunities</h2><ul>')
    for item in profile["signals"].get("opportunities") or []:
        parts.append(f'<li>{esc(item)}</li>')
    parts.append('</ul></div><div><h2>Weaknesses</h2><ul>')
    for item in profile["signals"].get("weaknesses") or []:
        parts.append(f'<li>{esc(item)}</li>')
    parts.append('</ul><h2>Risks</h2><ul>')
    for item in profile["signals"].get("risks") or []:
        parts.append(f'<li>{esc(item)}</li>')
    parts.append('</ul></div></div>')

    if profile.get("compliance"):
        comp = profile["compliance"]
        parts.append('<h2>Food hygiene</h2><table><tbody>')
        for label, value in (("Scheme", comp.get("scheme")),
                             ("Rating", comp.get("rating")),
                             ("Inspection date", comp.get("inspection_date")),
                             ("Authority", comp.get("authority")),
                             ("Business type", comp.get("business_type")),
                             ("Address", comp.get("address"))):
            parts.append(f'<tr><td class="small">{esc(label)}</td>'
                         f'<td>{esc(str(value if value is not None else "—"))}</td></tr>')
        parts.append('</tbody></table>')

    if profile.get("mentions"):
        parts.append('<h2>Press &amp; web mentions</h2><table><tbody>')
        for mention in profile["mentions"][:12]:
            parts.append(f'<tr><td class="small">{esc(str(mention.get("kind")))}</td>'
                         f'<td><a href="{esc(str(mention.get("url")))}" '
                         f'style="color:var(--accent)">{esc(str(mention.get("title") or mention.get("host")))}</a></td></tr>')
        parts.append('</tbody></table>')

    parts.append('<h2>Web & conversion</h2><table><tbody>')
    for label, value in (("Website", web.get("url")),
                         ("Booking", ", ".join(web.get("booking_providers") or []) or "—"),
                         ("Delivery", ", ".join(web.get("delivery_providers") or []) or "—"),
                         ("Menu online", "yes" if web.get("has_menu_online") else "no"),
                         ("Pages crawled", web.get("pages_crawled")),
                         ("Tech", ", ".join(web.get("tech") or []) or "—")):
        parts.append(f'<tr><td class="small">{esc(label)}</td><td>{esc(str(value if value is not None else "—"))}</td></tr>')
    parts.append('</tbody></table>')

    parts.append('<h2>Provenance</h2><table><thead><tr><th>Source</th><th>Mode</th>'
                 '<th>Pulled</th><th>Notes</th></tr></thead><tbody>')
    for source, entry in (profile["provenance"]["sources"] or {}).items():
        note = "; ".join(entry.get("warnings") or [])[:200] or "ok"
        parts.append(f'<tr><td>{esc(source)}</td><td class="small">{esc(entry.get("mode") or "—")}</td>'
                     f'<td>{entry.get("reviews") or 0}</td><td class="small">{esc(note)}</td></tr>')
    parts.append('</tbody></table>')
    parts.append(f'<p class="small">Generated by crawler-studio-social.py v{SCHEMA_VERSION} · '
                 f'{esc(profile["generated_at"])}</p>')
    parts.append('</div></body></html>')
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("".join(parts))


def build_tokens(profile, reviews, social):
    """Backward-compatible brand-pack tokens (v1 shape, enriched)."""
    rep = profile["reputation"]
    return {
        "business": profile["business"]["name"],
        "slug": profile["business"]["slug"],
        "scrapedAt": now_ts(),
        "schemaVersion": SCHEMA_VERSION,
        "voice": {
            "samples": [r.get("text") for r in (rep.get("notable", {}).get("best") or [])][:10],
            "topHashtags": social.get("hashtags") or [],
            "topKeywords": list((rep.get("themes") or {}).keys())[:20],
        },
        "platforms": {source: data for source, data in (profile["provenance"]["sources"] or {}).items()},
        "assets": profile["provenance"].get("assets") or {},
        "contact": {
            "emails": profile["identity"]["canonical"].get("emails") or [],
            "phones": profile["identity"].get("phones_seen") or [],
            "addresses": profile["identity"].get("addresses_seen") or [],
        },
        "reputation": {
            "consensusRating": rep.get("consensus_rating"),
            "totalReviews": rep.get("total_reviews"),
            "perSource": {source: {"rating": entry.get("rating"),
                                   "count": entry.get("count")}
                          for source, entry in (rep.get("sources") or {}).items()},
        },
        "scores": profile["scores"],
    }


# =========================================================================
# 24. ORCHESTRATION
# =========================================================================
def business_dir(business):
    return os.path.join(State.output_root,
                        site_slug(business.get("slug") or business["name"]))


def plan_connectors(ctx):
    """Decide which connectors are worth running for this business."""
    plan = []
    skip = State.skip or set()

    def want(source):
        if source in skip:
            return False
        if State.only and source not in State.only:
            return False
        return True

    if want("website") and (ctx.business.get("website") or ctx.website.get("website")):
        plan.append("website")
    elif want("website"):
        plan.append("website")  # connector records the "no website" warning

    if want("google"):
        plan.append("google")

    for source in ("tripadvisor", "restaurantguru"):
        if want(source) and (ctx.url_for(source) or State.deep or source == "restaurantguru"):
            plan.append(source)

    for source in GENERIC_REVIEW_SITES:
        if not want(source):
            continue
        if ctx.url_for(source) or (ctx.website.get("links", {}) or {}).get(source) or State.deep:
            plan.append(source)

    if want("food_hygiene"):
        plan.append("food_hygiene")

    for source in SOCIAL_SOURCES:
        if not want(source):
            continue
        if ctx.url_for(source):
            plan.append(source)

    if want("press"):
        plan.append("press")

    return dedupe(plan)


def _save_source_output(ctx, source, data):
    try:
        write_json(os.path.join(ctx.platforms_dir, f"{source}.json"), data)
    except Exception as exc:
        log(f"could not write {source}.json: {exc}", "warn")


def _run_connector(ctx, source, state):
    started = time.time()
    entry = CONNECTORS.get(source)
    if not entry:
        return None
    try:
        data = entry["fn"](ctx) or new_result(source)
    except Exception as exc:
        log(f"{source} connector crashed: {exc}", "error")
        if State.verbose:
            traceback.print_exc()
        data = new_result(source, ctx.url_for(source))
        data["warnings"].append(f"connector crashed: {exc}")
        State.stats["errors"] += 1
    data.setdefault("label", SOURCE_LABELS.get(source, (source,))[0])
    data["elapsed_seconds"] = round(time.time() - started, 1)
    reviews = len(data.get("reviews") or [])
    rating = (data.get("rating") or {}).get("value")
    count = (data.get("rating") or {}).get("count")
    flag = "ok" if data.get("ok") else "empty"
    detail = []
    if rating:
        detail.append(f"rating {rating}")
    if count:
        detail.append(f"{count} reviews")
    if reviews:
        detail.append(f"{reviews} pulled")
    if (data.get("profile") or {}).get("followers"):
        detail.append(f"{data['profile']['followers']} followers")
    warn = ("  ! " + "; ".join(data.get("warnings") or [])[:110]) if data.get("warnings") else ""
    log(f"[{flag:5s}] {source:14s} {' · '.join(detail) or '—'}{warn}",
        "ok" if data.get("ok") else "warn")
    _save_source_output(ctx, source, data)
    if ENABLE_CHECKPOINT and data.get("ok"):
        state[source] = {"done": True, "at": now_ts(),
                         "reviews": reviews, "rating": rating}
        write_json(os.path.join(ctx.output_dir, "state.json"), state)
    return data


ENABLE_CHECKPOINT = True


def run_business(business, index=1, total=1):
    out_dir = business_dir(business)
    os.makedirs(out_dir, exist_ok=True)
    State.log_file = os.path.join(out_dir, "crawl.log")
    with open(State.log_file, "a", encoding="utf-8") as fh:
        fh.write(f"\n--- run {iso_now()} ---\n")
    head(f"[{index}/{total}] {business['name']}")
    log(f"output: {out_dir}")

    discovery = discover_profiles(business)
    write_json(os.path.join(out_dir, "discovery.json"), discovery)
    profiles = discovery.get("profiles") or {}
    evidence = discovery.get("evidence") or {}

    # Fill the obvious social gaps through search (bounded).
    wanted_socials = [s for s in ("instagram", "facebook", "tiktok", "youtube")
                      if s not in profiles]
    attempts = len(wanted_socials) if State.deep else min(2, len(wanted_socials))
    for source in wanted_socials[:attempts]:
        found = None
        if State.deep:
            log(f"discovery: searching for {source}", "debug")
            found = search_for_profile(business, source)
            if found:
                evidence[source] = "search"
        if not found:
            found = discover_by_handle_guess(business, source)
            if found:
                evidence[source] = "handle-guess"
        if found:
            profiles[source] = found
            log(f"discovery: {source} -> {found[:80]}", "ok")

    if not profiles.get("google"):
        profiles["google"] = ("https://www.google.com/maps/search/"
                              + up.quote(f"{business['name']} {business.get('city') or ''}".strip())
                              + "?hl=en&gl=gb")
        evidence["google"] = "maps-search"

    ctx = BizContext(business, {"profiles": profiles, "evidence": evidence,
                                "website": discovery.get("website") or {}}, out_dir)
    ctx.log_file = State.log_file

    log("profiles resolved:")
    for source, url in sorted(profiles.items()):
        if url:
            log(f"  {source:14s} {url[:100]} ({evidence.get(source, 'unknown')})", "debug")

    job_plan = plan_connectors(ctx)
    state_path = os.path.join(out_dir, "state.json")
    state = read_json(state_path, {}) if ENABLE_CHECKPOINT and not FORCE_REFRESH else {}

    pending, resumed = [], []
    for source in job_plan:
        if state.get(source, {}).get("done"):
            cached = read_json(os.path.join(ctx.platforms_dir, f"{source}.json"), {})
            if cached:
                ctx.results[source] = cached
                resumed.append(source)
                log(f"[cache ] {source:14s} reusing checkpointed result", "debug")
                continue
        pending.append(source)

    if resumed:
        log(f"resumed from checkpoint: {', '.join(resumed)}")

    tasks = [s for s in pending if CONNECTORS[s]["tier"] != "browser"]
    browser_tasks = [s for s in pending if CONNECTORS[s]["tier"] == "browser"]

    if tasks:
        log(f"running {len(tasks)} HTTP connector(s): {', '.join(tasks)}", "debug")
        if PARALLEL and len(tasks) > 1:
            from concurrent.futures import ThreadPoolExecutor, as_completed
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
                futures = {pool.submit(_run_connector, ctx, source, state): source
                           for source in tasks}
                for future in as_completed(futures):
                    source = futures[future]
                    try:
                        ctx.results[source] = future.result()
                    except Exception as exc:
                        log(f"{source} failed: {exc}", "warn")
        else:
            for source in tasks:
                ctx.results[source] = _run_connector(ctx, source, state)

    for source in browser_tasks:
        ctx.results[source] = _run_connector(ctx, source, state)

    # If the site was unknown up front, the place sources just told us where
    # it is: crawl it now so web/booking/menu signals are not lost.
    if not (ctx.results.get("website") or {}).get("website"):
        late_url = None
        for source in ("google", "restaurantguru", "facebook", "food_hygiene"):
            candidate = ((ctx.results.get(source) or {}).get("business") or {}).get("website")
            if candidate and candidate.startswith("http"):
                late_url = candidate
                break
        if late_url:
            log(f"website: discovered late -> {late_url[:80]}", "debug")
            late_discovery = discover_from_website({"website": late_url,
                                                    "city": ctx.city,
                                                    "name": ctx.name})
            ctx.website.update(late_discovery)
            ctx.results["website"] = fetch_website(ctx)
            _save_source_output(ctx, "website", ctx.results["website"])
            write_json(os.path.join(ctx.output_dir, "discovery.json"), {
                "profiles": ctx.profiles, "evidence": ctx.evidence,
                "website": ctx.website,
            })

    # Partial runs (--only/--skip) must not throw away earlier evidence.
    if MERGE_PREVIOUS_RUNS and os.path.isdir(ctx.platforms_dir):
        merged = []
        for name in sorted(os.listdir(ctx.platforms_dir)):
            if not name.endswith(".json"):
                continue
            source = name[:-5]
            if source in ctx.results or source in (State.skip or set()):
                continue
            previous = read_json(os.path.join(ctx.platforms_dir, name), {})
            if previous and (previous.get("ok") or previous.get("reviews")):
                previous["from_previous_run_at"] = previous.get("fetched_at")
                ctx.results[source] = previous
                merged.append(source)
        if merged:
            log(f"merged {len(merged)} source(s) from a previous run: {', '.join(merged)}", "debug")

    if not ctx.results:
        log("no connector produced data", "error")
        return {"business": business["name"], "slug": business.get("slug"),
                "ok": False, "error": "no data collected", "profile_path": None}

    log("downloading brand assets", "debug")
    try:
        assets = collect_assets(ctx)
    except Exception as exc:
        log(f"asset collection failed: {exc}", "warn")
        assets = {}

    profile, review_data = assemble_profile(ctx, assets)

    write_json(os.path.join(out_dir, "business.profile.json"), profile)
    write_json(os.path.join(out_dir, "reviews.all.json"), review_data["reviews"])
    write_json(os.path.join(out_dir, "social.json"), profile["social"])
    write_json(os.path.join(out_dir, "social.tokens.json"),
               build_tokens(profile, review_data, profile["social"]))
    write_reviews_csv(os.path.join(out_dir, "reviews.csv"), review_data["reviews"])
    write_insights_md(os.path.join(out_dir, "insights.md"), profile, review_data)
    write_report_html(os.path.join(out_dir, "report.html"), profile, review_data)

    if ENABLE_CHECKPOINT:
        state["_complete"] = True
        state["_at"] = now_ts()
        write_json(state_path, state)

    summary = {
        "business": profile["business"]["name"],
        "slug": profile["business"]["slug"],
        "ok": True,
        "directory": out_dir,
        "consensus_rating": profile["reputation"]["consensus_rating"],
        "total_reviews": profile["reputation"]["total_reviews"],
        "collected_reviews": profile["reputation"]["collected_reviews"],
        "sources": profile["reputation"]["sources_present"],
        "followers": profile["social"]["totals"]["followers"],
        "platforms_present": profile["social"]["totals"]["platforms_present"],
        "scores": profile["scores"],
        "red_flags": len(profile["reputation"]["red_flags"]),
        "insights": os.path.join(out_dir, "insights.md"),
        "report": os.path.join(out_dir, "report.html"),
    }
    log(f"done · rating {format_number(summary['consensus_rating'])} · "
        f"{format_number(summary['total_reviews'])} reviews · "
        f"{format_number(summary['followers'])} followers · "
        f"score {summary['scores']['overall']}", "ok")
    return summary


def run_report_only(business):
    """Rebuild derived outputs from previously saved platform JSON files."""
    out_dir = business_dir(business)
    if not os.path.isdir(out_dir):
        log(f"no previous output at {out_dir}", "warn")
        return None
    State.log_file = os.path.join(out_dir, "crawl.log")
    platforms_dir = os.path.join(out_dir, "platforms")
    results = {}
    for name in os.listdir(platforms_dir) if os.path.isdir(platforms_dir) else []:
        if not name.endswith(".json"):
            continue
        source = name[:-5]
        results[source] = read_json(os.path.join(platforms_dir, name), {})

    class _Ctx:
        pass

    ctx = _Ctx()
    ctx.business = business
    ctx.results = results
    ctx.name = business["name"]
    ctx.city = business.get("city") or ""
    ctx.country = business.get("country") or "United Kingdom"
    discovery = read_json(os.path.join(out_dir, "discovery.json"), {})
    ctx.profiles = discovery.get("profiles") or {}
    ctx.evidence = discovery.get("evidence") or {}
    ctx.website = discovery.get("website") or {}
    ctx.output_dir = out_dir
    assets = (read_json(os.path.join(out_dir, "business.profile.json"), {})
              .get("provenance", {}) or {}).get("assets") or {}
    profile, review_data = assemble_profile(ctx, assets)
    write_json(os.path.join(out_dir, "business.profile.json"), profile)
    write_json(os.path.join(out_dir, "reviews.all.json"), review_data["reviews"])
    write_json(os.path.join(out_dir, "social.json"), profile["social"])
    write_json(os.path.join(out_dir, "social.tokens.json"),
               build_tokens(profile, review_data, profile["social"]))
    write_reviews_csv(os.path.join(out_dir, "reviews.csv"), review_data["reviews"])
    write_insights_md(os.path.join(out_dir, "insights.md"), profile, review_data)
    write_report_html(os.path.join(out_dir, "report.html"), profile, review_data)
    log(f"rebuilt reports for {business['name']}", "ok")
    return profile


def collect_all_profiles():
    """Every business.profile.json under the output root (not just this run).

    A `--business bar-91` run must still produce a group benchmark covering
    the whole folder, otherwise partial runs silently degrade the report.
    """
    profiles, seen = [], set()
    if not os.path.isdir(State.output_root):
        return profiles
    for name in sorted(os.listdir(State.output_root)):
        if name.startswith("_"):
            continue
        path = os.path.join(State.output_root, name, "business.profile.json")
        if not os.path.isfile(path):
            continue
        data = read_json(path, {})
        slug = (data.get("business") or {}).get("slug") or name
        if not data or slug in seen or not data.get("schema_version"):
            continue
        seen.add(slug)
        profiles.append(data)
    return profiles


def write_group_report(summaries, profiles):
    if not profiles:
        return
    group_dir = State.output_root
    os.makedirs(group_dir, exist_ok=True)

    ranked = sorted(profiles, key=lambda p: -(p.get("scores", {}).get("overall") or 0))
    rows = []
    for profile in ranked:
        rep = profile.get("reputation") or {}
        social = profile.get("social") or {}
        rows.append([
            profile["business"]["name"],
            format_number(rep.get("consensus_rating")),
            format_number(rep.get("total_reviews")),
            format_number((social.get("totals") or {}).get("followers")),
            format_number((social.get("totals") or {}).get("platforms_present")),
            (profile.get("scores") or {}).get("overall"),
            (profile.get("scores") or {}).get("reputation"),
            (profile.get("scores") or {}).get("social_strength"),
            (profile.get("scores") or {}).get("content_health"),
        ])

    lines = [f"# Group benchmark — {State.group}", "",
             f"*{len(profiles)} businesses · generated {iso_now()}*", "",
             "## Ranked overview", ""]
    lines.append(md_table(["Business", "Rating", "Reviews", "Followers", "Platforms",
                           "Overall", "Reputation", "Social", "Content"], rows))

    ratings = [p["reputation"]["consensus_rating"] for p in profiles
               if p["reputation"].get("consensus_rating")]
    followers = [p["social"]["totals"]["followers"] for p in profiles
                 if p["social"]["totals"].get("followers")]
    if ratings and len(ratings) >= 2:
        lines.append("## Reputation positioning")
        lines.append("")
        mean_rating = statistics.mean(ratings)
        lines.append(f"Group mean rating **{mean_rating:.2f}** "
                     f"(range {min(ratings)}–{max(ratings)}).")
        for profile in ranked:
            rating = profile["reputation"].get("consensus_rating")
            if not rating:
                continue
            delta = rating - mean_rating
            arrow = "above" if delta > 0.05 else "below" if delta < -0.05 else "in line with"
            lines.append(f"- **{profile['business']['name']}** — {rating} "
                         f"({abs(delta):.2f} {arrow} group mean)")
        lines.append("")
    if followers and len(followers) >= 2:
        lines.append("## Social reach positioning")
        lines.append("")
        mean_followers = statistics.mean(followers)
        for profile in sorted(profiles, key=lambda p: -(p["social"]["totals"].get("followers") or 0)):
            count = profile["social"]["totals"].get("followers") or 0
            share = round(count / sum(followers) * 100, 1) if sum(followers) else 0
            lines.append(f"- **{profile['business']['name']}** — {count:,} followers "
                         f"({share}% of group reach; mean {mean_followers:,.0f})")
        lines.append("")

    lines.append("## Source coverage")
    lines.append("")
    coverage = Counter()
    for profile in profiles:
        for source, entry in (profile.get("provenance", {}).get("sources") or {}).items():
            if entry.get("ok") or entry.get("reviews") or entry.get("rating"):
                coverage[source] += 1
    lines.append(md_table(["Source", "Businesses with data"], coverage.most_common()))

    lines.append("## Cross-business gaps")
    lines.append("")
    for profile in ranked:
        signals = profile.get("signals") or {}
        if signals.get("weaknesses"):
            lines.append(f"**{profile['business']['name']}**")
            for item in signals["weaknesses"][:3]:
                lines.append(f"- {item}")
            lines.append("")

    with open(os.path.join(group_dir, "group.report.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    write_json(os.path.join(group_dir, "group.summary.json"), {
        "group": State.group,
        "generated_at": iso_now(),
        "businesses": [{
            "name": p["business"]["name"],
            "slug": p["business"]["slug"],
            "rating": (p.get("reputation") or {}).get("consensus_rating"),
            "reviews": (p.get("reputation") or {}).get("total_reviews"),
            "followers": (p.get("social", {}).get("totals") or {}).get("followers"),
            "scores": p.get("scores"),
        } for p in ranked],
    })
    log(f"group report -> {os.path.join(group_dir, 'group.report.md')}", "ok")


# =========================================================================
# 25. CLI
# =========================================================================
PARALLEL = True
FORCE_REFRESH = False
MERGE_PREVIOUS_RUNS = True


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Deep social + reputation crawler for hospitality businesses.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  %(prog)s --list
  %(prog)s --business bar-91 --dry-run
  %(prog)s --business bar-91
  %(prog)s --all --no-browser
  %(prog)s --business bar-91 --only google,instagram --deep --max-reviews 120
  %(prog)s --all --report-only
        """)
    parser.add_argument("--business", action="append", default=[],
                        metavar="SLUG|NAME", help="business slug or name (repeatable)")
    parser.add_argument("--all", action="store_true", help="run every configured business")
    parser.add_argument("--list", action="store_true", help="list configured businesses")
    parser.add_argument("--only", default=None,
                        help="comma separated source keys to run, e.g. google,instagram")
    parser.add_argument("--skip", default=None,
                        help="comma separated source keys to skip")
    parser.add_argument("--deep", action="store_true",
                        help="paginate reviews, search for missing profiles, try more sources")
    parser.add_argument("--max-reviews", type=int, default=MAX_REVIEWS_PER_SOURCE,
                        help=f"max reviews per source (default {MAX_REVIEWS_PER_SOURCE})")
    parser.add_argument("--max-posts", type=int, default=MAX_POSTS_PER_PROFILE,
                        help=f"max posts per profile (default {MAX_POSTS_PER_PROFILE})")
    parser.add_argument("--no-browser", action="store_true",
                        help="disable Playwright (HTTP + JSON-LD only; Google reviews will be missing)")
    parser.add_argument("--no-cache", action="store_true", help="bypass the HTTP cache")
    parser.add_argument("--no-assets", action="store_true", help="skip image downloads")
    parser.add_argument("--keep-raw", action="store_true", help="store raw HTML per source")
    parser.add_argument("--sequential", action="store_true", help="disable parallel HTTP connectors")
    parser.add_argument("--force", action="store_true", help="ignore checkpoints and refetch")
    parser.add_argument("--no-merge", action="store_true",
                        help="do not fold earlier platform JSON files into this run")
    parser.add_argument("--dry-run", action="store_true", help="print the plan, do no network I/O")
    parser.add_argument("--report-only", action="store_true",
                        help="rebuild reports from previously saved platforms/*.json")
    parser.add_argument("--output-root", default=None, help="override the output directory")
    parser.add_argument("--group", default=None, help="group name used for reporting")
    parser.add_argument("--verbose", "-v", action="store_true", help="debug logging")
    return parser.parse_args(argv)


def select_businesses(args):
    if not args.business and not args.all:
        return TARGETS
    wanted = {part.strip().lower()
              for value in args.business if value.strip()
              for part in value.split(",") if part.strip()}
    if args.all:
        return TARGETS
    selected = []
    for business in TARGETS:
        keys = {str(business.get("slug", "")).lower(), business["name"].lower(),
                slugify(business["name"]), slugify(str(business.get("slug", "")))}
        if keys & wanted:
            selected.append(business)
            continue
        # tolerate prefixes and partial names ("ronzio", "boteco")
        if any(key.startswith(value) or value in key for value in wanted
               for key in keys if key):
            selected.append(business)
    missing = wanted - {k for b in selected for k in
                        {str(b.get("slug", "")).lower(), b["name"].lower()}}
    if missing:
        log(f"unknown business(es): {', '.join(sorted(missing))}", "warn")
    return selected


def print_list():
    print(f"\nConfigured businesses ({len(TARGETS)}) — group {GROUP_NAME}\n")
    for business in TARGETS:
        profiles = business.get("profiles") or {}
        print(f"  {business.get('slug') or site_slug(business['name'])}")
        print(f"    name:     {business['name']}")
        city = business.get("city") or ""
        print(f"    location: {city}{', ' + business.get('region', '') if business.get('region') else ''}")
        print(f"    website:  {business.get('website') or '(will be discovered)'}")
        print(f"    seeds:    {', '.join(sorted(profiles)) or '(none — discovery only)'}")
        print()
    print("Sources available:")
    print("  reviews: " + ", ".join(sorted(REVIEW_SOURCES)))
    print("  social:  " + ", ".join(sorted(SOCIAL_SOURCES)))
    print()


def print_summary(summaries):
    head("Summary")
    rows = []
    for summary in summaries:
        if not summary:
            continue
        rows.append([
            summary.get("business"),
            format_number(summary.get("consensus_rating")),
            format_number(summary.get("total_reviews")),
            format_number(summary.get("followers")),
            (summary.get("scores") or {}).get("overall"),
            summary.get("red_flags"),
            "ok" if summary.get("ok") else "failed",
        ])
    print(md_table(["Business", "Rating", "Reviews", "Followers", "Score", "Flags", "State"], rows))
    for summary in summaries:
        if not summary or not summary.get("ok"):
            continue
        print(f"  {summary['business']}")
        print(f"    insights: {summary['insights']}")
        print(f"    report:   {summary['report']}")
        print(f"    sources:  {', '.join(summary.get('sources') or []) or '—'}")
    group_report = os.path.join(State.output_root, "group.report.md")
    if os.path.exists(group_report):
        print(f"\n  group report: {group_report}\n")


def main(argv=None):
    global PARALLEL, FORCE_REFRESH, MAX_POSTS_PER_PROFILE, KEEP_RAW_HTML, DOWNLOAD_ASSETS
    global MERGE_PREVIOUS_RUNS
    args = parse_args(argv)
    State.verbose = args.verbose
    State.use_browser = not args.no_browser
    State.deep = args.deep
    State.max_reviews = max(1, args.max_reviews)
    MAX_POSTS_PER_PROFILE = max(1, args.max_posts)
    State.use_cache = not args.no_cache
    if args.output_root:
        State.output_root = args.output_root
    if args.group:
        State.group = args.group
    State.only = ({s.strip().lower() for s in args.only.split(",") if s.strip()}
                  if args.only else None)
    State.skip = {s.strip().lower() for s in (args.skip or "").split(",") if s.strip()}
    KEEP_RAW_HTML = bool(args.keep_raw)
    DOWNLOAD_ASSETS = not args.no_assets
    PARALLEL = not args.sequential
    FORCE_REFRESH = args.force
    MERGE_PREVIOUS_RUNS = not args.no_merge

    if args.list:
        print_list()
        return 0

    if State.only:
        unknown = State.only - set(CONNECTORS) - {"all"}
        if unknown:
            log(f"unknown --only keys ignored: {', '.join(sorted(unknown))}", "warn")

    load_credentials()
    bootstrap_cache()

    if not HAVE_PLAYWRIGHT and State.use_browser:
        log("playwright not installed — browser tier disabled "
            "(pip install playwright && playwright install chromium)", "warn")
        State.use_browser = False

    businesses = select_businesses(args)
    if not businesses:
        log("no businesses selected", "error")
        return 1

    if args.dry_run:
        head("Dry run — plan only")
        print(f"output root : {State.output_root}")
        print(f"group       : {State.group}")
        print(f"browser     : {'enabled' if State.use_browser else 'disabled'}")
        print(f"sources     : {', '.join(sorted(State.only)) if State.only else 'auto'}")
        print()
        for business in businesses:
            profiles = business.get("profiles") or {}
            print(f"  {business['name']}")
            print(f"    seeds: {', '.join(sorted(profiles)) or '(none)'}")
            print(f"    out:   {business_dir(business)}")
            print(f"    will run: website, google, "
                  f"{', '.join(sorted(profiles)) or 'discovery-only'}")
            print()
        return 0

    if args.report_only:
        for business in businesses:
            run_report_only(business)
        write_group_report([], collect_all_profiles())
        return 0

    head(f"Deep social & reputation crawl — {len(businesses)} business(es)")
    print(f"  output : {State.output_root}")
    print(f"  browser: {'on' if State.use_browser else 'off'} · "
          f"parallel: {'on' if PARALLEL else 'off'} · deep: {'on' if State.deep else 'off'}")
    print(f"  reviews/source cap: {State.max_reviews}")

    summaries = []
    started = time.time()
    for index, business in enumerate(businesses, 1):
        try:
            summaries.append(run_business(business, index, len(businesses)))
        except KeyboardInterrupt:
            log("interrupted by user", "warn")
            break
        except Exception as exc:
            log(f"{business['name']} failed: {exc}", "error")
            if State.verbose:
                traceback.print_exc()
            summaries.append({"business": business["name"],
                              "slug": business.get("slug"),
                              "ok": False, "error": str(exc)})

    write_group_report(summaries, collect_all_profiles())
    print_summary(summaries)
    elapsed = time.time() - started
    print(f"  finished in {elapsed:.0f}s · cache hits {State.stats['cache_hits']} · "
          f"browser fetches {State.stats['browser_fetches']} · "
          f"assets {State.stats['assets_downloaded']}")

    Browser.close()
    failures = [s for s in summaries if s and not s.get("ok")]
    return 0 if len(failures) < len(summaries or [1]) else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        Browser.close()
        print("\ninterrupted")
        sys.exit(130)
    finally:
        try:
            Browser.close()
        except Exception:
            pass
