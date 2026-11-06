#!/usr/bin/env python3
"""
Brand, Social & Reputation Pipeline   (website crawler -> social crawler, one run)
==================================================================================

Runs two crawlers back to back for every site and consolidates the result into
one brand pack:

  1. WEBSITE PHASE  (WordPress document / media / brand crawler)
       REST API + sitemap + page crawl -> documents, images, videos, page text,
       brand tokens (colour, type, logos, photography), validated contact data,
       menu / hours content, brand-guide.json and a Word brand guide.

  2. SOCIAL PHASE   (business social & reputation intelligence crawler)
       Fed by phase 1: the business name, city, category, the social / review
       profile links found on the site, the validated NAP, and the pages
       already downloaded (so nothing is fetched twice). Collects Google Maps,
       TripAdvisor, Restaurant Guru, Instagram, Facebook, TikTok, YouTube,
       food-hygiene rating, press mentions, ... and derives a reputation +
       social dossier with scores, signals and a cross-business benchmark.

  3. CONSOLIDATION
       Each brand folder gets a social/ sub-folder, brand-guide.json (and the
       Word guide) gain reputation + social sections, 00-portfolio/ gets the
       group benchmark, and everything is zipped once.

OUTPUT
------
  <OUTPUT_ROOT>/
      <site-slug>/                      website working files (documents/, images/,
                                        videos/, pages_text/, discovered_media.csv)
      _social/                          social working files (cache, platforms/*.json,
                                        state.json, crawl.log) - resumable
      targets.json                      the social targets derived from the crawl
      <group>-brand-kit/                (group mode, the default)
          README.md   targets.json
          00-portfolio/                 overview .docx, portfolio.json,
                                        group.report.md, group.summary.json
          01-<brand>/
              <brand>-Brand-Guide.docx  brand-guide.json  cover.<ext>
              tokens/  content/  assets/
              social/                   business.profile.json  insights.md
                                        report.html  reviews.csv  reviews.all.json
                                        social.json  social-profile.json  assets/
      <group>-brand-kit.zip             the importable pack
  With --standalone each site gets <site-slug>/brand-kit.zip instead.

USAGE
-----
    python crawler-combined.py                         # every site in SITES, both phases
    python crawler-combined.py https://example.com/    # one ad-hoc site
    python crawler-combined.py --business hatch        # only configured sites matching "hatch"
    python crawler-combined.py --skip-social           # website phase only
    python crawler-combined.py --social-only           # social phase from saved targets.json
    python crawler-combined.py --report-only           # rebuild reports from saved platforms/*.json
    python crawler-combined.py --no-browser --deep --max-reviews 120
    python crawler-combined.py --only google,instagram --skip press
    python crawler-combined.py --targets my-targets.json --standalone
    python crawler-combined.py --dry-run               # print the plan, no network I/O
    python crawler-combined.py --list

Edit the CONFIGURATION block below to add sites. TARGET_OVERRIDES holds
hand-confirmed facts (profile URLs, aliases, category ...) that win over what
the crawl derives; anything not overridden is discovered.

SOCIAL SOURCES AND HOW THEY ARE FETCHED (tiers, degrading gracefully)
--------------------------------------------------------------------
  1. api      official API when a key is present
              (Google Places New, Facebook Graph, TikTok Research, SerpAPI)
  2. http     requests + JSON-LD / microdata / meta parsing  (fast, default)
  3. browser  headless Chromium via Playwright for JS pages and bot walls
Every source is optional: a blocked site records a warning and the run continues.

CREDENTIALS (all optional; env vars, or tokens.json / cookies.json next to the
script or in the working directory)
---------------------------------------------------------------------------
    GOOGLE_PLACES_API_KEY   Places API (New): authoritative place + 5 reviews
    SERPAPI_KEY             paginates the *full* Google review list
    FB_GRAPH_TOKEN          Facebook Graph + owned Instagram accounts
    TIKTOK_RESEARCH_TOKEN   TikTok Research API (approved projects only)
    cookies.json            {"instagram": {"sessionid": "..."}, ...} for
                            properties you own or are authorised to access

LIMITS (observed, not speculative)
----------------------------------
  * Google Maps renders only ~5 unique reviews to anonymous browsers. Rating,
    count, distribution and topics are complete; set GOOGLE_PLACES_API_KEY or
    SERPAPI_KEY for full review coverage.
  * TripAdvisor and Yelp sit behind bot walls. The connector tries HTTP, then a
    real browser, then records the block.
  * Social metrics that need a login are only available in cookie mode.
  * Sentiment and themes are lexicon-based and indicative; read the sample size.
  * Phone normalisation and the default locale/currency are UK-oriented; change
    DEFAULT_* / KNOWN_CITIES below (and normalize_phone) for other markets.
    The country itself is derived from the address, so non-UK venues no longer
    inherit UK-only lookups; phone numbers from other countries are kept as
    written instead of being dropped.
  * Asset rights and licensing are NOT verified by this tool.

TERMS OF SERVICE
----------------
Automated collection may breach the terms of some of these platforms. Prefer
official APIs, use cookie mode only for accounts you are authorised to access,
keep volumes low (the tool self-throttles per domain), and treat the output as
internal research. No warranty of legality is given or implied.
"""

from __future__ import annotations

import argparse
import base64
import csv
import gzip
import hashlib
import io
import contextlib
import json
import math
import mimetypes
import os
import random
import re
import shutil
import statistics
import sys
import threading
import time
import traceback
import urllib.parse as up
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html import escape as html_escape, unescape
from urllib.parse import parse_qs, unquote, urljoin, urlparse
from xml.sax.saxutils import escape as xml_escape

import requests
from bs4 import BeautifulSoup

try:  # optional: image dimensions, palette / specimen PNGs
    from PIL import Image, ImageDraw, ImageFont
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False

try:  # optional heavy dependency, only needed for tier-3 (browser) extraction
    from playwright.sync_api import sync_playwright
    HAVE_PLAYWRIGHT = True
except Exception:  # pragma: no cover - environment dependent
    sync_playwright = None
    HAVE_PLAYWRIGHT = False


SCHEMA_VERSION = "2.0"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


# =========================================================================
# CONFIGURATION
# =========================================================================
SITES = [
    "https://www.thephysician.bar/",
    "https://www.theadamson.com/",
    "https://www.hatchstandrews.com/",
]

# Everything lives under here: per-site website files, _social/ working files,
# the group brand kit and its ZIP.
OUTPUT_ROOT = "data/Julie-Dalton"

# If set, all sites go into ONE brand kit with numbered brand folders.
# If empty/None (or --standalone), each site gets its own brand-kit.zip.
BRAND_PACK_GROUP_NAME = "Julie-Dalton"
BRAND_PACK_GROUP_DESCRIPTION = (
    "This group contains brand kits for multiple venues managed by Julie Dalton. "
)
BRAND_PACK_GROUP_SLUG = "Julie-Dalton-brand-kit"

# ---- Pipeline switches ----
RUN_SOCIAL_PHASE = True            # False == --skip-social
ENRICH_BRAND_GUIDE = True          # add reputation / socialPresence / webPresence to brand-guide.json (+ .docx)
INCLUDE_SOCIAL_ASSETS_IN_PACK = True   # copy social avatars/covers into <brand>/social/assets

# ---- Locale defaults (used for brand tokens and for deriving the social target) ----
DEFAULT_LOCALE = "en-GB"
DEFAULT_CURRENCY = "GBP"
KNOWN_CITIES = ("St Andrews", "Glasgow", "Edinburgh")   # fallback city detection from page text

# Address -> country. A venue's country must come from its own evidence; never
# default it to the UK (that made a Lisbon cafe inherit UK food-hygiene checks).
COUNTRY_HINTS = (
    # UK first so "Northern Ireland" resolves to the UK, not Ireland.
    ("United Kingdom", ("united kingdom", "great britain", "england", "scotland",
                        "wales", "northern ireland", "london", "manchester",
                        "edinburgh", "glasgow", "st andrews", "birmingham", "bristol",
                        "leeds", "liverpool", "belfast", "cardiff")),
    ("Portugal", ("portugal", "lisboa", "lisbon", "porto", "cascais", "sintra")),
    ("Spain", ("spain", "españa", "espana", "madrid", "barcelona", "valencia", "sevilla")),
    ("Brazil", ("brasil", "brazil", "são paulo", "sao paulo", "rio de janeiro",
                "curitiba", "belo horizonte", "porto alegre")),
    ("France", ("france", "paris", "lyon", "marseille", "bordeaux")),
    ("Germany", ("germany", "deutschland", "berlin", "münchen", "munich", "hamburg")),
    ("Italy", ("italy", "italia", "milano", "milan", "roma", "rome", "firenze")),
    ("Netherlands", ("netherlands", "nederland", "amsterdam", "rotterdam")),
    ("Belgium", ("belgium", "belgië", "brussels", "bruxelles", "antwerp")),
    ("Austria", ("austria", "österreich", "wien", "vienna")),
    ("Switzerland", ("switzerland", "schweiz", "zürich", "zurich", "genève", "geneva")),
    ("Denmark", ("denmark", "danmark", "københavn", "copenhagen")),
    ("Sweden", ("sweden", "sverige", "stockholm", "göteborg")),
    ("Norway", ("norway", "norge", "oslo", "bergen")),
    ("Finland", ("finland", "suomi", "helsinki")),
    ("Ireland", ("ireland", "éire", "dublin", "cork", "galway")),
    ("Poland", ("poland", "polska", "warszawa", "warsaw", "kraków", "krakow")),
    ("Czechia", ("czechia", "czech republic", "praha", "prague")),
    ("Greece", ("greece", "ελλάδα", "athens", "αθήνα", "thessaloniki")),
    ("Turkey", ("turkey", "türkiye", "istanbul", "ankara", "izmir")),
    ("United Arab Emirates", ("united arab emirates", "uae", "dubai", "abu dhabi")),
    ("Japan", ("japan", "日本", "tokyo", "東京", "osaka", "大阪", "kyoto")),
    ("South Korea", ("south korea", "korea", "seoul", "서울", "busan")),
    ("Singapore", ("singapore",)),
    ("Australia", ("australia", "sydney", "melbourne", "brisbane", "perth")),
    ("New Zealand", ("new zealand", "aotearoa", "auckland", "wellington")),
    ("Canada", ("canada", "toronto", "vancouver", "montréal", "montreal")),
    ("United States", ("united states", "usa", "u.s.a.", "new york", "brooklyn",
                       "los angeles", "san francisco", "chicago", "miami", "seattle",
                       "austin", "boston", "portland", "denver", "atlanta")),
    ("Mexico", ("mexico", "méxico", "ciudad de méxico", "cdmx", "guadalajara")),
    ("Argentina", ("argentina", "buenos aires", "córdoba", "cordoba")),
    ("Colombia", ("colombia", "bogotá", "bogota", "medellín", "medellin")),
    ("Chile", ("chile", "santiago de chile")),
    ("South Africa", ("south africa", "cape town", "johannesburg", "durban")),
)

UK_COUNTRY_NAMES = ("united kingdom", "uk", "gb", "great britain", "england",
                    "scotland", "wales", "northern ireland")

# Google country signal (`gl`) + UI language (`hl`) for the Maps fallback URL.
# Was hardcoded to `hl=en&gl=gb`, which localises results to the UK.
COUNTRY_LOCALE = {
    "United Kingdom": ("en", "gb"), "Portugal": ("pt", "pt"), "Spain": ("es", "es"),
    "Brazil": ("pt-BR", "br"), "France": ("fr", "fr"), "Germany": ("de", "de"),
    "Italy": ("it", "it"), "Netherlands": ("nl", "nl"), "Belgium": ("nl", "be"),
    "Austria": ("de", "at"), "Switzerland": ("de", "ch"), "Denmark": ("da", "dk"),
    "Sweden": ("sv", "se"), "Norway": ("no", "no"), "Finland": ("fi", "fi"),
    "Ireland": ("en", "ie"), "Poland": ("pl", "pl"), "Czechia": ("cs", "cz"),
    "Greece": ("el", "gr"), "Turkey": ("tr", "tr"),
    "United Arab Emirates": ("en", "ae"), "Japan": ("ja", "jp"),
    "South Korea": ("ko", "kr"), "Singapore": ("en", "sg"),
    "Australia": ("en", "au"), "New Zealand": ("en", "nz"), "Canada": ("en", "ca"),
    "United States": ("en", "us"), "Mexico": ("es", "mx"), "Argentina": ("es", "ar"),
    "Colombia": ("es", "co"), "Chile": ("es", "cl"), "South Africa": ("en", "za"),
}

# ---- Hand-confirmed facts for the social phase (formerly TARGETS) ----------
# Matched to a crawled site by the host of `website`. Values here WIN over what
# the crawl derives; empty values never erase crawled ones. `profiles` are merged
# key by key. Sites without an entry are fully derived from their own pages.
#   name, slug, city, region, country, category, website,
#   profiles {}    -> trusted profile URLs (skip discovery cost)
#   aliases []     -> other spellings used for matching and search
#   competitors [] -> names used for local competitive context
#   notes str
TARGET_OVERRIDES = [
    {
        "name": "The Physician",
        "slug": "thephysician-bar",
        "city": "St Andrews",
        "region": "Scotland",
        "country": "United Kingdom",
        "category": "Bar",
        "aliases": ["The Physician Bar"],
        "website": "https://www.thephysician.bar/",
        "profiles": {
            "facebook": "https://www.facebook.com/profile.php?id=61554721448724",
            "instagram": "https://www.instagram.com/thephysician_standrews",
            "tripadvisor": "https://www.tripadvisor.co.uk/Restaurant_Review-g186533-d27299282-Reviews-The_Physician-St_Andrews_Fife_Scotland.html",
        },
    },
    {
        "name": "The Adamson",
        "slug": "theadamson",
        "city": "St Andrews",
        "region": "Scotland",
        "country": "United Kingdom",
        "category": "Restaurant",
        "aliases": ["The Adamson Restaurant"],
        "website": "https://www.theadamson.com/",
        "profiles": {
            "facebook": "https://www.facebook.com/TheAdamsonStAndrews",
            "instagram": "https://www.instagram.com/theadamsonstandrews/",
            "tiktok": "https://www.tiktok.com/@theadamsonstandrews",
            "tripadvisor": "https://www.tripadvisor.co.uk/Restaurant_Review-g186533-d2679481-Reviews-The_Adamson-St_Andrews_Fife_Scotland.html",
        },
    },
    {
        "name": "HATCH",
        "slug": "hatchstandrews",
        "city": "St Andrews",
        "region": "Scotland",
        "country": "United Kingdom",
        "category": "Restaurant",
        "aliases": ["HATCH Restaurant"],
        "website": "https://www.hatchstandrews.com/",
        "profiles": {
            "facebook": "https://www.facebook.com/HatchStAndrews",
            "instagram": "https://www.instagram.com/hatch_standrews/",
            "tripadvisor": "https://www.tripadvisor.co.uk/Restaurant_Review-g186533-d23378004-Reviews-Hatch-St_Andrews_Fife_Scotland.html",
        },
    },
]

# ---- Website-phase crawl tuning ----
WEB_REQUEST_DELAY = 0.3
MAX_PAGE_CRAWL = 500
WEB_MAX_WORKERS = 5
RESTRICT_CRAWL_TO_BASE_PATH = False
ALLOW_SUBDOMAINS = True
ALLOW_EXTERNAL_DOCUMENTS = False

# CDNs that legitimately serve a brand's own images/video. The site's HTML
# points at these hosts directly (Wix, Squarespace, Shopify, ...), so they must
# be downloaded even though they are not on the site's own domain.
MEDIA_HOST_SUFFIXES = (
    'wixstatic.com', 'wix.com', 'parastorage.com',
    'squarespace-cdn.com', 'sqspcdn.com', 'squarespace.com',
    'cloudfront.net', 'imgix.net', 'ctfassets.net', 'contentful.com',
    'cdn.shopify.com', 'shopifycdn.com', 'cloudinary.com',
    'amazonaws.com', 'azureedge.net', 'akamaized.net', 'fastly.net',
    'googleusercontent.com', 'ggpht.com', 'fbcdn.net', 'cdninstagram.com',
    'ytimg.com', 'vimeo.com', 'vimeocdn.com', 'jwplayer.com',
)

ENABLE_CRAWL_CHECKPOINT = True
CRAWL_CHECKPOINT_SAVE_EVERY = 50
CLEAR_CHECKPOINT_ON_COMPLETE = True

# ---- Brand-pack quality gates ----
LOGO_MIN_EDGE = 200            # px; anything smaller is treated as icon/favicon
PHOTO_MIN_SHORT_EDGE = 600     # px; keep photos at least this large
PHOTO_PRINT_SHORT_EDGE = 2000  # target for print-capable photos (flagged, not filtered)
COVER_MIN_WIDTH = 1600
COVER_MIN_HEIGHT = 1000
MAX_CURATED_PHOTOS = 12        # pack photography; was a hardcoded 6

# Videos never enter the brand pack and a single hero clip can be hundreds of
# MB, so the bytes are not downloaded unless asked for. They still appear in
# discovered_media.csv / video_embeds.csv.
DOWNLOAD_VIDEOS = False

# ---- Client-rendered (SPA) sites ----
# A Vite/Next/Nuxt shell returns no text, no links and no images, so the
# static crawl reports a one-page site. Detect that shape and render it.
RENDER_JS_SITES = True         # env CRAWLER_RENDER_JS=0 disables
SHELL_MAX_TEXT = 600           # visible characters in a shell document
SHELL_MAX_ELEMENTS = 60
SHELL_MAX_MEDIA = 2
SPA_MAX_ROUTES = 12            # rendered routes beyond the seed page
SPA_SETTLE_MS = 2500           # JS hydration wait after domcontentloaded
SPA_MAX_SCROLLS = 6
BUNDLE_MAX_FILES = 4
BUNDLE_MAX_BYTES = 4_000_000

# Absolute and root-relative asset paths inside a JS/CSS bundle.
LOGO_ASSET_PATTERN = re.compile(
    r'(?:^|[/_-])(?:logo|logotipo|wordmark|marca)(?:[/_.-]|$)', re.I)
BUNDLE_ASSET_PATTERN = re.compile(
    r'["\'(\s=]((?:https?://[^\s"\'()<>]+'
    r'|\.{0,2}/?(?:assets|static|media|images|img|uploads|files|build)/'
    r'[^\s"\'()<>]*?\.(?:jpe?g|png|gif|webp|avif|svg))'
    r'(?:[?#][^\s"\'()<>]*)?)["\')\s]',
    re.I,
)

# Route words used to pick the pages worth rendering/reading for a brand pack.
BRAND_PAGE_KEYWORDS = (
    'about', 'sobre', 'empresa', 'quem-somos', 'contact', 'contato', 'fale-conosco',
    'press', 'imprensa', 'brand', 'marca', 'media', 'midia', 'produtos', 'products',
    'onde-encontrar', 'onde-encontrar', 'lojas', 'stores', 'menu', 'cardapio',
)
# Link discovery only follows pages that carry NAP/brand facts. The English-only
# pattern meant a Portuguese nav ("Sobre", "Contato", "Onde Encontrar") was
# never queued, so a live site reported "1 page crawled".
DISCOVERY_PAGE_PATTERN = re.compile(
    r'contact|contato|contacto|about|sobre|empresa|quem[-_ ]somos|quienes[-_ ]somos|'
    r'menu|cardapio|produtos|productos|book|reserv|find[-_ ]?us|onde[-_ ]encontrar|'
    r'donde|location|localizacao|localizacion|lojas|tienda|horario|hours|gift|'
    r'franquia|revenda|distribuidor')
SPA_PRIORITY_ROUTE_WORDS = (
    'sobre', 'about', 'empresa', 'quem-somos', 'contato', 'contact', 'produtos',
    'products', 'onde-encontrar', 'lojas',
)



# =========================================================================
# PART A — WEBSITE CRAWLER: documents, media, brand tokens, brand pack
# (original crawler-website.py; colliding names carry a web_/WEB_ prefix)
# =========================================================================
# ------------------------------
# PER-SITE GLOBALS
# ------------------------------
BASE_URL = ""
OUTPUT_DIR = ""
DOWNLOAD_DIR = ""
IMAGE_DIR = ""
VIDEO_DIR = ""
TEXT_DIR = ""
BRAND_KIT_DIR = ""
EXPORT_DISCOVERED_URLS_CSV = ""
EXPORT_VIDEO_EMBEDS_CSV = ""
CRAWL_CHECKPOINT_FILE = ""
BASE_DOMAIN = ""
BASE_DOMAIN_SUFFIX = ""
BASE_SCOPE_PATH = "/"
PRIORITY_SEED_URLS = []
PERMANENTLY_FAILED = set()

# Simple in-memory fetch cache so brand extraction does not re-fetch pages
_page_cache = {}


# ------------------------------
# EXTENSION SETS
# ------------------------------
DOCUMENT_EXTENSIONS = {
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.csv', '.ppt', '.pptx', '.odt', '.ods', '.odp',
    '.rtf', '.txt', '.zip', '.rar', '.7z'
}

IMAGE_EXTENSIONS = {
    '.jpg', '.jpeg', '.png', '.gif', '.webp',
    '.svg', '.bmp', '.tiff', '.tif', '.ico', '.avif'
}

VIDEO_EXTENSIONS = {
    '.mp4', '.webm', '.ogv', '.mov', '.avi',
    '.mkv', '.m4v', '.flv', '.wmv', '.mpg', '.mpeg'
}

ALL_MEDIA_EXTENSIONS = DOCUMENT_EXTENSIONS | IMAGE_EXTENSIONS | VIDEO_EXTENSIONS

DOCUMENT_MIME_TYPES = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/csv",
    "application/zip",
    "application/x-rar-compressed",
    "application/x-7z-compressed",
]
IMAGE_MIME_TYPES = [
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/svg+xml", "image/bmp", "image/tiff", "image/avif", "image/x-icon",
]
VIDEO_MIME_TYPES = [
    "video/mp4", "video/webm", "video/ogg", "video/quicktime",
    "video/x-msvideo", "video/x-matroska", "video/mpeg",
]
ALL_MEDIA_MIME_TYPES = DOCUMENT_MIME_TYPES + IMAGE_MIME_TYPES + VIDEO_MIME_TYPES

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MediaCrawler/2.2; +http://example.com)"
}
HEADERS_FALLBACK = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
}

EXTRA_LINK_ATTRIBUTES = (
    'href', 'src', 'data-href', 'data-url', 'data-download',
    'data-file', 'onclick',
    'data-src', 'data-lazy-src', 'data-original', 'data-orig-file',
    'data-large-file', 'data-medium-file', 'data-full-url',
    'srcset', 'data-srcset', 'data-lazy-srcset',
    'data-background', 'data-bg', 'data-background-image',
    'data-video', 'data-mp4', 'data-webm', 'data-ogv',
    'poster',
)

NON_HTML_SUFFIXES = (
    '.jpg', '.jpeg', '.png', '.gif', '.css', '.js', '.xml',
    '.ico', '.svg', '.woff', '.woff2', '.webp', '.avif',
    '.mp4', '.webm', '.ogv', '.mov', '.m4v', '.pdf',
    '.zip', '.rar', '.7z'
)

VIDEO_EMBED_PATTERNS = [
    (r'youtube\.com/embed/([A-Za-z0-9_-]+)', 'youtube'),
    (r'youtube\.com/watch\?v=([A-Za-z0-9_-]+)', 'youtube'),
    (r'youtu\.be/([A-Za-z0-9_-]+)', 'youtube'),
    (r'vimeo\.com/video/(\d+)', 'vimeo'),
    (r'player\.vimeo\.com/video/(\d+)', 'vimeo'),
    (r'dailymotion\.com/embed/video/([A-Za-z0-9]+)', 'dailymotion'),
    (r'facebook\.com/plugins/video\.php\?href=([^&"\']+)', 'facebook'),
    (r'wistia\.(com|net)/embed/iframe/([A-Za-z0-9]+)', 'wistia'),
]

CSS_URL_PATTERN = re.compile(r"url\(\s*['\"]?([^'\")\s]+)['\"]?\s*\)", re.IGNORECASE)

SOCIAL_PATTERNS = {
    'facebook':  r'facebook\.com/',
    'instagram': r'instagram\.com/',
    'twitter':   r'(?<![A-Za-z0-9-])(?:twitter|x)\.com/',
    'linkedin':  r'linkedin\.com/',
    'tiktok':    r'tiktok\.com/',
    'youtube':   r'youtube\.com/',
    'pinterest': r'pinterest\.com/',
    'tripadvisor': r'tripadvisor\.(?:com|co\.[a-z]{2})/',
}

LOGO_HINTS = ('logo', 'wordmark', 'brandmark', 'brand-mark', 'emblem')

CSS_NAMED_COLORS = {
    'black': '#000000', 'white': '#ffffff', 'red': '#ff0000',
    'blue': '#0000ff', 'green': '#008000', 'yellow': '#ffff00',
    'gray': '#808080', 'grey': '#808080', 'silver': '#c0c0c0',
    'navy': '#000080', 'maroon': '#800000', 'olive': '#808000',
    'teal': '#008080', 'purple': '#800080', 'lime': '#00ff00',
    'aqua': '#00ffff', 'fuchsia': '#ff00ff', 'orange': '#ffa500',
    'gold': '#ffd700', 'beige': '#f5f5dc', 'ivory': '#fffff0',
    'coral': '#ff7f50', 'salmon': '#fa8072', 'crimson': '#dc143c',
    'chocolate': '#d2691e', 'tan': '#d2b48c', 'khaki': '#f0e68c',
    'plum': '#dda0dd', 'orchid': '#da70d6', 'violet': '#ee82ee',
}

# Font-family patterns that are framework internals, not real brands faces
FONT_INTERNAL_PATTERNS = re.compile(
    r'^('
    r'wf_|wfont_|wix-|wix_|avenir-lt|avenir-lt-w|helvetica-w01|helvetica-w02|'
    r'futura-lt|proxima-n-w01|brandon-grotesque|raleway-w|madefor-|wix-madefor|'
    r'squarespace|fonts-|sofia-pro|questrial|social-icons|'
    r'font-awesome|material-icons|helvetica neue|helveticaneue|orig_practice'
    r')',
    re.IGNORECASE,
)

# Wix theme colours that appear in almost every Wix site's CSS. They are UI
# defaults, not brand evidence; keeping them made every scraped brand blue.
PLATFORM_UI_COLORS = {
    '#116dff', '#f9ad4d', '#f4b8b9', '#f9d6d7', '#597dff',
    '#acbeff', '#ed8f90', '#d7b7fb', '#d5dfff',
}

# Sub-brand / non-venue keywords that should NOT appear in the logo slot
SUB_BRAND_KEYWORDS = (
    'loyalty', 'gift card', 'gift-card', 'voucher', 'the circle', 'the-circle',
    'reward', 'club card', 'membership', 'app-store', 'appstore', 'google-play',
    'payment', 'visa', 'mastercard', 'amex', 'paypal', 'klarna',
)

FAVICON_KEYWORDS = (
    'favicon', 'apple-touch-icon', 'apple-touch', 'android-chrome',
    'mstile', 'app-icon', 'appicon', 'safari-pinned', 'browserconfig',
)

ICON_KEYWORDS = (
    'sprite', 'ui-icon', 'ui_icon', 'social-icon', 'social_icon',
    'icon-', '-icon.', 'icon_', 'glyph',
)
LOGO_REJECT_KEYWORDS = (
    'hero', 'banner', 'storefront', 'interior', 'exterior', 'food-photo',
    'gallery', 'thumbnail', 'thumb', 'cropped', 'crop-',
)

# Press walls, "as featured in" strips and partner grids are not the brand's
# own mark. They almost always live in a dedicated container, link out to a
# third-party site, or carry an outlet name in the filename/alt text.
PRESS_LOGO_CONTAINERS = (
    'press', 'as-seen', 'as_seen', 'featured-in', 'featured_in', 'in-the-media',
    'media-logos', 'partner', 'client', 'imprensa', 'parceiro',
)

PRESS_LOGO_KEYWORDS = (
    'exame', 'vogue', 'veja', 'dezeen', 'forbes', 'bloomberg', 'monocle',
    'hypebeast', 'time out', 'timeout', 'wallpaper', 'guardian', 'nytimes',
    'new york times', 'financial times', 'estadao', 'gazeta', 'brasil journal',
    'bomgourmet', 'axis magazine', 'poppaganda', 'restaurant guru',
    'tripadvisor', 'opentable', 'yelp', 'michelin', 'monashees', 'ukio',
    'carolina herrera', 'heliotemil', 'egonlab', 'minor figures', 'nude project',
    'visa', 'mastercard', 'amex', 'paypal', 'klarna', 'spotify', 'apple',
    'google', 'linkedin', 'instagram', 'facebook', 'youtube', 'tiktok',
)

# A pack needs a primary mark, not every third-party logo on the homepage.
MAX_CURATED_LOGOS = 3


# =========================================================
# PER-SITE CONFIGURATION
# =========================================================
def web_site_slug(url):
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    path = parsed.path.strip("/") or "root"
    slug = f"{host}_{path}"
    slug = re.sub(r'[^A-Za-z0-9_.-]', '_', slug)
    return slug


def brand_slug(url):
    """Short slug for the brand folder: '02-boteco-do-brasil'."""
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    # Strip the domain suffix and keep the subdomain/name
    host = re.sub(r'\.(co\.uk|com|org|net|io|uk|scot|co)$', '', host)
    host = re.sub(r'[^A-Za-z0-9]+', '-', host).strip('-')
    return host or 'brand'


def configure_site(base_url):
    global BASE_URL, OUTPUT_DIR, DOWNLOAD_DIR, IMAGE_DIR, VIDEO_DIR, TEXT_DIR, BRAND_KIT_DIR
    global EXPORT_DISCOVERED_URLS_CSV, EXPORT_VIDEO_EMBEDS_CSV, CRAWL_CHECKPOINT_FILE
    global BASE_DOMAIN, BASE_DOMAIN_SUFFIX, BASE_SCOPE_PATH
    global PERMANENTLY_FAILED, PRIORITY_SEED_URLS
    global _page_cache

    parsed = urlparse(base_url)
    slug = web_site_slug(base_url)

    BASE_URL = base_url
    OUTPUT_DIR = os.path.join(OUTPUT_ROOT, slug)
    DOWNLOAD_DIR = os.path.join(OUTPUT_DIR, "documents")
    IMAGE_DIR = os.path.join(OUTPUT_DIR, "images")
    VIDEO_DIR = os.path.join(OUTPUT_DIR, "videos")
    TEXT_DIR = os.path.join(OUTPUT_DIR, "pages_text")
    BRAND_KIT_DIR = os.path.join(OUTPUT_DIR, "brand-kit")

    EXPORT_DISCOVERED_URLS_CSV = os.path.join(OUTPUT_DIR, "discovered_media.csv")
    EXPORT_VIDEO_EMBEDS_CSV = os.path.join(OUTPUT_DIR, "discovered_video_embeds.csv")
    CRAWL_CHECKPOINT_FILE = os.path.join(OUTPUT_DIR, "crawl_state.json")

    BASE_DOMAIN = parsed.netloc.lower()
    BASE_DOMAIN_SUFFIX = (
        BASE_DOMAIN[4:] if BASE_DOMAIN.startswith("www.") else BASE_DOMAIN
    )
    BASE_SCOPE_PATH = parsed.path or "/"
    if not BASE_SCOPE_PATH.endswith("/"):
        BASE_SCOPE_PATH += "/"

    PERMANENTLY_FAILED = set()
    PRIORITY_SEED_URLS = [base_url]
    _page_cache = {}


# =========================================================
# UTILITY FUNCTIONS
# =========================================================
def fix_response_encoding(resp):
    """requests assumes ISO-8859-1 for text/* without a charset, which mangles UTF-8
    (en-dashes, £, é ...). Honour <meta charset> when present, otherwise assume UTF-8."""
    try:
        ctype = (resp.headers.get('content-type') or '').lower()
        if 'charset' in ctype or not (ctype.startswith('text/') or 'xml' in ctype or 'json' in ctype):
            return resp
        head = resp.content[:4096]
        match = re.search(rb'<meta[^>]+charset=["\']?\s*([A-Za-z0-9_-]+)', head, re.IGNORECASE)
        resp.encoding = match.group(1).decode('ascii') if match else 'utf-8'
    except Exception:
        pass
    return resp


def get(url, stream=False, retries=3, log_errors=True, allow_redirects=True):
    current_headers = HEADERS.copy()
    for attempt in range(retries):
        try:
            if attempt >= 1:
                current_headers = HEADERS_FALLBACK.copy()

            resp = requests.get(
                url,
                headers=current_headers,
                timeout=30,
                stream=stream,
                allow_redirects=allow_redirects,
            )

            if resp.status_code == 429:
                wait = 5 * (attempt + 1)
                print(f"Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue

            if resp.status_code in (404, 410, 403):
                if log_errors:
                    print(f"Permanent client error {resp.status_code} for {url}")
                PERMANENTLY_FAILED.add(url)
                return None

            if resp.status_code >= 400:
                if log_errors:
                    print(f"Request failed: {resp.status_code} for {url}")
                return None

            resp.raise_for_status()
            if not stream:
                fix_response_encoding(resp)
            return resp

        except requests.exceptions.SSLError:
            if log_errors:
                print(f"SSL error for {url} (permanent, skipping)")
            PERMANENTLY_FAILED.add(url)
            return None
        except requests.RequestException as e:
            if log_errors:
                print(f"Request failed (attempt {attempt + 1}): {e}")
            time.sleep(2 ** attempt)
    return None


def fetch_text_cached(url):
    """Fetch HTML/CSS once; used by brand extraction."""
    if url in _page_cache:
        return _page_cache[url]
    resp = get(url, log_errors=False)
    text = resp.text if resp else None
    _page_cache[url] = text
    return text


def cached_html_for(url):
    """Best cached HTML for a URL, tolerating scheme/trailing-slash drift.

    The render pass stores HTML under the URL it rendered; link discovery then
    asks for slightly different spellings of the same page.
    """
    if not url:
        return None
    candidates = [url, url.rstrip('/'), url.rstrip('/') + '/']
    parsed = urlparse(url)
    if parsed.scheme == 'http':
        https = parsed._replace(scheme='https').geturl()
        candidates += [https, https.rstrip('/'), https.rstrip('/') + '/']
    for candidate in candidates:
        html = _page_cache.get(candidate)
        if html:
            return html
    key = (parsed.netloc.lower(), (parsed.path or '/').rstrip('/').lower())
    for cached_url, html in list(_page_cache.items()):
        if not html:
            continue
        other = urlparse(cached_url)
        if (other.netloc.lower(), (other.path or '/').rstrip('/').lower()) == key:
            return html
    return None


def is_same_domain(url):
    host = urlparse(url).netloc.lower()
    if host == BASE_DOMAIN:
        return True
    if not ALLOW_SUBDOMAINS:
        return False
    return host == BASE_DOMAIN_SUFFIX or host.endswith(f".{BASE_DOMAIN_SUFFIX}")


def is_page_in_scope(url):
    parsed = urlparse(url)
    if not is_same_domain(url):
        return False
    if not RESTRICT_CRAWL_TO_BASE_PATH or BASE_SCOPE_PATH == "/":
        return True
    path = parsed.path or "/"
    return path.startswith(BASE_SCOPE_PATH)


def is_document_url(url):
    path = urlparse(url).path.lower()
    if any(path.endswith(ext) for ext in DOCUMENT_EXTENSIONS):
        return True
    if re.search(r"/(download|baixar)(/|$)", path):
        return True
    query = parse_qs(urlparse(url).query or "", keep_blank_values=True)
    for key in ("download", "arquivo", "anexo", "file", "nomearquivo"):
        if any(str(v).strip() for v in query.get(key, [])):
            return True
    return False


def is_image_url(url):
    path = urlparse(url).path.lower()
    return any(path.endswith(ext) for ext in IMAGE_EXTENSIONS)


def is_video_url(url):
    path = urlparse(url).path.lower()
    return any(path.endswith(ext) for ext in VIDEO_EXTENSIONS)


def is_media_url(url):
    return is_document_url(url) or is_image_url(url) or is_video_url(url)


def classify_media(url):
    if is_image_url(url):
        return 'image'
    if is_video_url(url):
        return 'video'
    if is_document_url(url):
        return 'document'
    return None


def web_safe_filename(url):
    parsed = urlparse(url)
    name = os.path.basename(parsed.path)
    if not name:
        name = "file_" + hashlib.md5(url.encode("utf-8")).hexdigest()[:12]
    if '?' in name:
        name = name.split('?')[0]
    return name


def sanitize_filename(name):
    cleaned = os.path.basename(unescape(name or ""))
    cleaned = re.sub(r"[\\/:*?\"<>|]", "_", cleaned)
    cleaned = cleaned.strip().strip('.')
    return cleaned or "file"


def text_safe_filename(url):
    parsed = urlparse(url)
    path = parsed.path.strip('/')
    if not path:
        path = "index"
    name = path.replace('/', '_')
    if parsed.query:
        name += '_' + parsed.query[:50].replace('&', '_')
    name = re.sub(r'[\\/*?:"<>|]', '_', name)
    if not name.endswith('.txt'):
        name += '.txt'
    return name


def file_hash(path):
    """SHA-256 hash of a file (for de-duplication)."""
    h = hashlib.sha256()
    try:
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b''):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


def looks_like_svg(path):
    """True when the file really is an SVG document, not an HTML error page."""
    try:
        with open(path, 'rb') as svg_file:
            head = svg_file.read(8192)
    except OSError:
        return False
    low = head.lstrip().lower()
    if b'<html' in low[:2048] or b'<!doctype html' in low[:2048]:
        return False
    return b'<svg' in low[:4096]


def svg_dimensions(path):
    """Return (width, height) from viewBox or width/height; browsers default 300x150."""
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as svg_file:
            text = svg_file.read(20000)
    except OSError:
        return (300, 150)
    match = re.search(r'viewBox\s*=\s*["\']([^"\']+)', text, re.I)
    if match:
        parts = re.split(r'[\s,]+', match.group(1).strip())
        if len(parts) == 4:
            try:
                return (max(1, int(round(abs(float(parts[2]))))),
                        max(1, int(round(abs(float(parts[3]))))))
            except ValueError:
                pass
    width = re.search(r'\bwidth\s*=\s*["\']\s*([\d.]+)', text, re.I)
    height = re.search(r'\bheight\s*=\s*["\']\s*([\d.]+)', text, re.I)
    if width and height:
        try:
            return (max(1, int(float(width.group(1)))),
                    max(1, int(float(height.group(1)))))
        except ValueError:
            pass
    return (300, 150)


def image_info_without_pillow(path):
    """Read common raster dimensions and formats using only the standard library."""
    try:
        with open(path, 'rb') as image_file:
            header = image_file.read(32)
            if header.startswith(b'\x89PNG\r\n\x1a\n') and len(header) >= 24:
                return (int.from_bytes(header[16:20], 'big'),
                        int.from_bytes(header[20:24], 'big'), 'PNG')
            if header[:6] in (b'GIF87a', b'GIF89a') and len(header) >= 10:
                return (int.from_bytes(header[6:8], 'little'),
                        int.from_bytes(header[8:10], 'little'), 'GIF')
            if header.startswith(b'BM') and len(header) >= 26:
                width = int.from_bytes(header[18:22], 'little', signed=True)
                height = abs(int.from_bytes(header[22:26], 'little', signed=True))
                return (abs(width), height, 'BMP')
            if header.startswith(b'RIFF') and header[8:12] == b'WEBP':
                if header[12:16] == b'VP8X' and len(header) >= 30:
                    width = 1 + int.from_bytes(header[24:27], 'little')
                    height = 1 + int.from_bytes(header[27:30], 'little')
                    return (width, height, 'WEBP')
                if header[12:16] == b'VP8L' and len(header) >= 25 and header[20] == 0x2f:
                    bits = header[21:25]
                    width = 1 + bits[0] + ((bits[1] & 0x3f) << 8)
                    height = 1 + (bits[1] >> 6) + (bits[2] << 2) + ((bits[3] & 0x0f) << 10)
                    return (width, height, 'WEBP')
                if header[12:16] == b'VP8 ' and len(header) >= 30:
                    if header[23:26] == b'\x9d\x01\x2a':
                        width = int.from_bytes(header[26:28], 'little') & 0x3fff
                        height = int.from_bytes(header[28:30], 'little') & 0x3fff
                        return (width, height, 'WEBP')
            if header.startswith(b'\xff\xd8'):
                image_file.seek(2)
                while True:
                    if image_file.read(1) != b'\xff':
                        break
                    marker = image_file.read(1)
                    while marker == b'\xff':
                        marker = image_file.read(1)
                    if not marker:
                        break
                    if marker[0] in (0xd8, 0xd9):
                        continue
                    segment_length = image_file.read(2)
                    if len(segment_length) != 2:
                        break
                    length = int.from_bytes(segment_length, 'big')
                    if marker[0] in (0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
                                     0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf):
                        frame = image_file.read(5)
                        if len(frame) == 5:
                            return (int.from_bytes(frame[3:5], 'big'),
                                    int.from_bytes(frame[1:3], 'big'), 'JPEG')
                        break
                    image_file.seek(max(0, length - 2), os.SEEK_CUR)
    except OSError:
        return None
    return None


def get_image_info(path):
    """Return (width, height, format) or None."""
    if not path or not os.path.isfile(path):
        return None
    if looks_like_svg(path):
        width, height = svg_dimensions(path)
        return (width, height, 'SVG')
    if HAVE_PIL:
        try:
            with Image.open(path) as img:
                return (img.width, img.height, img.format or 'UNKNOWN')
        except Exception:
            return None
    return image_info_without_pillow(path)


def fix_image_extension(path):
    """Rename a file whose bytes are WebP (etc.) but whose extension is .jpg."""
    if not path or not os.path.isfile(path):
        return path
    info = get_image_info(path)
    if not info:
        return path
    fmt = info[2].upper()
    expected = {
        'JPEG': '.jpg', 'PNG': '.png', 'WEBP': '.webp',
        'GIF': '.gif', 'BMP': '.bmp', 'TIFF': '.tif', 'SVG': '.svg',
    }.get(fmt)
    if not expected:
        return path
    current = os.path.splitext(path)[1].lower()
    if current in (expected, expected.replace('.jpg', '.jpeg'),
                   expected.replace('.tif', '.tiff')):
        return path
    new_path = os.path.splitext(path)[0] + expected
    if new_path == path:
        return path
    if os.path.exists(new_path):
        base = os.path.splitext(new_path)[0]
        counter = 1
        while os.path.exists(f'{base}_{counter}{expected}'):
            counter += 1
        new_path = f'{base}_{counter}{expected}'
    try:
        os.rename(path, new_path)
        return new_path
    except OSError:
        return path


def extract_urls_from_text(text):
    if not text:
        return []
    text = unescape(str(text))
    pattern = (
        r"https?://[^\s'\"<>]+"
        r"|[A-Za-z0-9_./-]+\.(?:pdf|doc|docx|xls|xlsx|csv|ppt|pptx|odt|ods|odp|rtf|txt|zip|rar|7z"
        r"|jpg|jpeg|png|gif|webp|svg|bmp|tiff|tif|ico|avif"
        r"|mp4|webm|ogv|mov|avi|mkv|m4v|flv|wmv|mpg|mpeg)(?:\?[^\s'\"<>]*)?"
        r"|/[A-Za-z0-9_./-]*(?:download|baixar)[^\s'\"<>]*"
    )
    return re.findall(pattern, text, flags=re.IGNORECASE)


def normalize_candidate_url(raw, current_url):
    if not raw:
        return None
    value = unescape(str(raw)).strip().strip("'\"()[]{}")
    if not value or value.startswith('#') or value.lower().startswith("javascript:"):
        return None
    value = value.replace('\\/', '/')
    absolute = urljoin(current_url, value)
    absolute = absolute.split('#')[0].strip().rstrip(".,;)")
    return absolute or None


def extract_srcset_urls(srcset_value):
    """Parse srcset without splitting on the commas inside CDN URLs.

    Wix/Squarespace URLs contain commas in their transform segments
    (``w_1200,h_800``); a naive ``split(',')`` turns them into fragments like
    ``v.WEBP``. Srcset entries are separated by a descriptor, so match
    ``<url> <number><w|x>`` instead.
    """
    urls = []
    if not srcset_value:
        return urls
    value = str(srcset_value)
    for match in re.finditer(r'(\S+?)\s+(\d+(?:\.\d+)?)([wx])', value, re.IGNORECASE):
        url_part = match.group(1).strip().rstrip(',')
        if url_part and not url_part.startswith('data:'):
            urls.append(url_part)
    if urls:
        return urls
    # Fallback for descriptor-less srcsets (rare, but legal).
    for candidate in value.split(','):
        url_part = candidate.strip().split()[0] if candidate.strip() else ''
        if url_part and not url_part.startswith('data:'):
            urls.append(url_part)
    return urls


def extract_css_background_urls(css_text):
    if not css_text:
        return []
    return CSS_URL_PATTERN.findall(css_text)


def filename_from_response(url, resp):
    content_disposition = resp.headers.get('content-disposition') or ''
    filename = None
    match = re.search(r"filename\*=UTF-8''([^;]+)", content_disposition, flags=re.IGNORECASE)
    if match:
        filename = unquote(match.group(1))
    else:
        match = re.search(r'filename="?([^\";]+)"?', content_disposition, flags=re.IGNORECASE)
        if match:
            filename = match.group(1)
    filename = sanitize_filename(filename or web_safe_filename(url))
    content_type = (resp.headers.get('content-type') or '').split(';', 1)[0].strip().lower()
    base, ext = os.path.splitext(filename)
    if not ext and content_type:
        guessed = mimetypes.guess_extension(content_type)
        if guessed:
            filename = f"{base}{guessed}"
    return filename


def extract_page_text(html):
    try:
        soup = BeautifulSoup(html, 'lxml')
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript']):
            tag.decompose()
        text = soup.get_text(separator='\n', strip=True)
        text = re.sub(r'\n\s*\n', '\n', text)
        return text
    except Exception:
        return ""


def is_media_host_allowed(url):
    if ALLOW_EXTERNAL_DOCUMENTS:
        return True
    if is_same_domain(url):
        return True
    host = (urlparse(url).hostname or '').lower()
    if not host:
        return False
    return any(host == suffix or host.endswith('.' + suffix)
               for suffix in MEDIA_HOST_SUFFIXES)


# =========================================================
# CONTACT VALIDATION
# =========================================================
def normalize_phone(phone, country=None):
    """Normalize a phone number, keeping unknown-country numbers intact.

    UK numbers get the local ``0…`` form. Numbers from other countries are
    returned trimmed but otherwise unmodified — guessing a UK shape for a
    Lisbon landline used to yield None and silently drop the NAP.
    """
    if not phone:
        return None
    raw = str(phone).strip()
    digits = re.sub(r'[^\d+]', '', raw)
    if not digits:
        return None
    # An explicit foreign dialling code is authoritative: a Brazilian
    # `tel:+556333513307` used to be pushed through the UK rules and dropped
    # because the address did not resolve to a country.
    if digits.startswith('+') and not digits.startswith('+44'):
        return raw or None
    if digits.startswith('00') and not digits.startswith('0044'):
        return raw or None
    is_uk = (not country) or normalize_text(country) in tuple(
        normalize_text(name) for name in UK_COUNTRY_NAMES)
    if not is_uk:
        return raw or None
    if digits.startswith('+44'):
        national = digits[3:]
    elif digits.startswith('0044'):
        national = digits[4:]
    elif digits.startswith('44') and len(digits) > 10:
        national = digits[2:]
    else:
        national = digits
    if national.startswith('0'):
        national = national[1:]
    local = '0' + national
    if not local.isdigit() or len(local) not in (10, 11):
        return None
    return local


def select_brand_phones(phones_by_page, start_url):
    """Return the numbers that belong to the brand itself, not its stores.

    A "onde encontrar" / "store locator" page lists every franchisee's mobile;
    those are not the brand's NAP. Numbers from the home page and the contact
    page win, and a directory-only list is capped so the guide stays readable.
    """
    def page_rank(page_url):
        low = (page_url or '').lower()
        if low.rstrip('/') == (start_url or '').rstrip('/'):
            return 0
        if any(k in low for k in ('contact', 'contato', 'fale-conosco', 'atendimento')):
            return 1
        if any(k in low for k in ('onde-encontrar', 'lojas', 'stores', 'franquia',
                                  'revenda', 'distribuidor', 'localizacao')):
            return 3
        return 2

    ordered = sorted(phones_by_page.items(), key=lambda kv: page_rank(kv[0]))
    primary = [p for url, phones in ordered if page_rank(url) <= 1 for p in phones]
    if primary:
        return set(primary)
    fallback = [p for url, phones in ordered for p in phones]
    return set(fallback[:3])


def is_valid_email(email):
    if not email or '@' not in email:
        return False
    return bool(re.match(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$',
                         email.strip()))


def dedupe_emails(emails):
    """Validate and de-duplicate exact email addresses without guessing typos."""
    return sorted(set(e.lower().strip() for e in emails if is_valid_email(e)))


# website-crawl key -> social-crawler key
SOCIAL_KEY_MAP = {'twitter': 'x'}

GENERIC_TITLE_SEGMENTS = {
    'home', 'homepage', 'welcome', 'official site', 'official website',
    'menu', 'about', 'about us', 'contact', 'contact us',
}


def normalize_social_link(platform, url):
    """Validate a harvested link and return a canonical profile URL.

    Returns None for share buttons, tracking pixels, widget links and
    look-alike hosts (e.g. wix.com is not x.com), so only real profile links
    reach the brand tokens and the social crawler.
    """
    if not url or not isinstance(url, str):
        return None
    url = url.strip()
    if url.startswith('//'):
        url = 'https:' + url
    if not url.lower().startswith(('http://', 'https://')):
        return None
    key = SOCIAL_KEY_MAP.get(platform, platform)
    if key == 'facebook':
        parsed = urlparse(url)
        if parsed.path.rstrip('/').lower().endswith('profile.php'):
            ids = parse_qs(parsed.query).get('id') or []
            if ids and ids[0].isdigit():
                return f'https://www.facebook.com/profile.php?id={ids[0]}'
            return None
    if key in SOCIAL_URL_PATTERNS:
        handle = handle_from_url(key, url)
        return canonical_social_url(key, handle) if handle else None
    if key == 'tripadvisor':
        if re.search(r'tripadvisor\.[a-z.]+/[A-Za-z]+_Review-', url):
            return url.split('#')[0].split('?')[0]
        return None
    return None


def clean_social_links(raw_social):
    """{platform: url | [urls]} -> {platform: [validated canonical urls]} (page order)."""
    cleaned = {}
    for platform, value in (raw_social or {}).items():
        values = value if isinstance(value, (list, tuple, set)) else [value]
        urls = []
        for item in values:
            link = normalize_social_link(platform, item)
            if link and link not in urls:
                urls.append(link)
        if urls:
            cleaned[platform] = urls
    return cleaned


def tidy_brand_name(raw, url):
    """Pick the brand-like part of a page title such as 'Home | The Adamson – St Andrews'."""
    if not raw:
        return raw
    parts = [p.strip() for p in re.split(r'\s+[|–—·•:]\s+|\s*\|\s*|\s+-\s+', raw) if p and p.strip()]
    parts = [p for p in parts if p.lower() not in GENERIC_TITLE_SEGMENTS]
    if not parts:
        return raw.strip()
    if len(parts) == 1:
        return parts[0]
    host = urlparse(url).netloc.lower()
    core = re.sub(r'[^a-z0-9]', '', re.sub(r'^www\.', '', host).split('.')[0])

    def score(item):
        index, part = item
        flat = re.sub(r'[^a-z0-9]', '', part.lower())
        if flat and core and flat == core:
            return (2, -index)
        if flat and core and (flat in core or core in flat):
            return (1, -index)
        return (0, -index)

    return max(enumerate(parts), key=score)[1]


def build_contact_block(brand_data):
    """Build the importer-native contact block from tokens + page text."""
    raw = brand_data['contact']
    country = country_from_address(raw.get('address') or '')
    phones = sorted(set(filter(None, (normalize_phone(p, country) for p in raw['phones']))))
    emails = dedupe_emails(raw['emails'])
    social = clean_social_links(raw.get('social', {}))
    result = {
        'address': raw.get('address') or None,
        'phones': phones,
        'emails': emails,
        'website': BASE_URL,
        'socialLinks': social,
    }
    for platform, urls in social.items():
        result[platform] = urls[0] if urls else None
    for platform in SOCIAL_PATTERNS:
        result.setdefault(platform, None)
    return result


# =========================================================
# CSS / BRAND EXTRACTION
# =========================================================
def parse_css_color(value):
    """Return (hex_lower, (r, g, b)) or None."""
    if value is None:
        return None
    value = str(value).strip()
    if value.lower() in CSS_NAMED_COLORS:
        return parse_css_color(CSS_NAMED_COLORS[value.lower()])
    if value.startswith('#'):
        h = value[1:]
        if len(h) in (3, 4):
            h = ''.join(c * 2 for c in h[:3])
        elif len(h) in (6, 8):
            h = h[:6]
        else:
            return None
        if not re.match(r'^[0-9a-fA-F]{6}$', h):
            return None
        rgb = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
        return ('#' + h.lower(), rgb)
    m = re.match(r'rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)', value)
    if m:
        rgb = tuple(max(0, min(255, int(x))) for x in m.groups())
        return ('#%02x%02x%02x' % rgb, rgb)
    return None


def rgb_to_cmyk(rgb):
    r, g, b = [x / 255.0 for x in rgb]
    k = 1 - max(r, g, b)
    if k >= 1:
        return (0, 0, 0, 100)
    c = (1 - r - k) / (1 - k)
    m = (1 - g - k) / (1 - k)
    y = (1 - b - k) / (1 - k)
    return tuple(round(v * 100) for v in (c, m, y, k))


def hex_to_rgb(hex_color):
    h = hex_color.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def relative_luminance(rgb):
    def ch(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast_ratio(rgb1, rgb2):
    l1 = relative_luminance(rgb1)
    l2 = relative_luminance(rgb2)
    if l1 < l2:
        l1, l2 = l2, l1
    return (l1 + 0.05) / (l2 + 0.05)


def color_saturation(rgb):
    r, g, b = [x / 255.0 for x in rgb]
    mx, mn = max(r, g, b), min(r, g, b)
    if mx == 0:
        return 0
    return (mx - mn) / mx


def cluster_colors(counts, threshold=40):
    """Merge perceptually close colors. Returns {representative_hex: count}."""
    merged = {}
    for hex_color, count in counts.items():
        rgb = hex_to_rgb(hex_color)
        matched = None
        for existing_hex in merged:
            existing_rgb = hex_to_rgb(existing_hex)
            dist = sum((a - b) ** 2 for a, b in zip(rgb, existing_rgb)) ** 0.5
            if dist < threshold:
                matched = existing_hex
                break
        if matched:
            merged[matched] += count
        else:
            merged[hex_color] = count
    return merged


def derive_color_name(hex_color, css_variables):
    """If a CSS variable matches this color, use its name."""
    for prop, value in css_variables.items():
        parsed = parse_css_color(value)
        if parsed and parsed[0] == hex_color:
            name = prop.lstrip('-').replace('-', ' ').replace('_', ' ').title()
            for prefix in ('Color ', 'Colour ', 'Brand ', 'Theme ', 'Primary ', 'Secondary '):
                if name.startswith(prefix):
                    name = name[len(prefix):]
            if name:
                return name
    return None


def extract_css_tokens_into(css_text, tokens):
    """Accumulate font faces, families, observed type sizes, colors and variables."""
    if not css_text:
        return

    # @font-face
    for m in re.finditer(r'@font-face\s*\{([^}]+)\}', css_text):
        block = m.group(1)
        fam = re.search(r'font-family\s*:\s*[\'"]?([^\'";]+)', block)
        weight = re.search(r'font-weight\s*:\s*([^;]+)', block)
        style = re.search(r'font-style\s*:\s*([^;]+)', block)
        src = re.search(r'src\s*:\s*([^;]+)', block)
        if fam:
            tokens['font_faces'].append({
                'family': fam.group(1).strip(),
                'weight': (weight.group(1).strip() if weight else '400'),
                'style': (style.group(1).strip() if style else 'normal'),
                'src': (src.group(1).strip() if src else None),
            })

    # Custom properties
    for m in re.finditer(r'(--[a-zA-Z0-9_-]+)\s*:\s*([^;}]+)', css_text):
        prop, value = m.group(1), m.group(2).strip()
        tokens['variables'][prop] = value
        parsed = parse_css_color(value)
        if parsed:
            tokens['colors'][parsed[0]] += 5

    # font-family declarations
    for m in re.finditer(r'font-family\s*:\s*([^;}{]+)', css_text):
        for fam in m.group(1).split(','):
            fam = fam.strip().strip('\'"').strip()
            if not fam or fam.startswith('var('):
                continue
            if fam.lower() in ('inherit', 'initial', 'unset', 'revert',
                               'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy'):
                continue
            tokens['families'].add(fam)

    # Capture observed sizes from common text selectors; do not invent a scale.
    for rule in re.finditer(r'([^{}]+)\{([^{}]+)\}', css_text):
        selectors, declarations = rule.groups()
        size_match = re.search(
            r'font-size\s*:\s*(\d+(?:\.\d+)?px)\b', declarations, re.IGNORECASE
        )
        if not size_match:
            continue
        family_match = re.search(r'font-family\s*:\s*([^;]+)', declarations, re.IGNORECASE)
        family = family_match.group(1).split(',')[0].strip().strip('\'"') if family_match else None
        for selector in selectors.split(','):
            selector = selector.strip().lower()
            role = None
            if re.search(r'(^|[\s>+~])h1(?:[:.#\s]|$)', selector):
                role = 'h1'
            elif re.search(r'(^|[\s>+~])h2(?:[:.#\s]|$)', selector):
                role = 'h2'
            elif re.search(r'(^|[\s>+~])h3(?:[:.#\s]|$)', selector):
                role = 'h3'
            elif selector in ('body', 'html', 'p'):
                role = 'body'
            if role:
                tokens.setdefault('type_scale', []).append({
                    'id': role,
                    'family': family,
                    'size': size_match.group(1),
                    'px': round(float(size_match.group(1)[:-2])),
                })

    # generic color usage
    for m in re.finditer(r'(?:background-color|color|border-color|fill|stroke)\s*:\s*([^;}]+)', css_text):
        parsed = parse_css_color(m.group(1))
        if parsed:
            tokens['colors'][parsed[0]] += 1


def is_press_logo(text):
    """True when the filename/alt/label names a press outlet or partner."""
    flat = re.sub(r'[^a-z0-9]+', ' ', (text or '').lower()).strip()
    return any(keyword in flat for keyword in PRESS_LOGO_KEYWORDS)


def _logo_nav_context(img):
    """Return (in_header, in_press_wall) for an <img> candidate."""
    in_header = False
    press_wall = False
    node = img
    for _ in range(6):
        node = getattr(node, 'parent', None)
        if node is None or getattr(node, 'name', None) is None:
            break
        name = (node.name or '').lower()
        ident = ' '.join(
            [str(node.get('id') or '')]
            + [str(cls) for cls in (node.get('class') or [])]
        ).lower()
        if name in ('header', 'nav') or any(
                marker in ident for marker in ('masthead', 'site-header',
                                               'navbar', 'header', 'menu-bar')):
            in_header = True
        if any(marker in ident for marker in PRESS_LOGO_CONTAINERS):
            press_wall = True
        if press_wall:
            break
        # A strip of four or more logo-hinted images is a logo wall, not the
        # brand's own mark (press, partners, stockists, payments).
        if name in ('section', 'div', 'ul', 'footer') and len(node.find_all('img')) >= 4:
            logoish = 0
            for other in node.find_all('img'):
                text = ' '.join([
                    str(other.get('src') or ''), str(other.get('alt') or ''),
                    str(other.get('class') or ''),
                ]).lower()
                if any(hint in text for hint in LOGO_HINTS):
                    logoish += 1
            if logoish >= 4:
                press_wall = True
    return in_header, press_wall


def _logo_link_host(img, page_url):
    """Host of the anchor wrapping an image, so press logos that link out are dropped."""
    node = img
    for _ in range(4):
        node = getattr(node, 'parent', None)
        if node is None or getattr(node, 'name', None) is None:
            break
        if node.name == 'a' and node.get('href'):
            href = str(node['href']).strip()
            if href.lower().startswith(('javascript:', 'mailto:', 'tel:', '#')):
                return None
            return domain_of(urljoin(page_url, href))
    return None


ICON_SVG_TOKENS = ('lucide', 'feather', 'heroicon', 'fontawesome', 'fa-solid',
                   'fa-regular', 'fa-brands', 'material-icons', 'tabler-icon',
                   'bi bi-', 'ionicon', 'oi oi-')


def _svg_is_decorative_icon(svg, context=''):
    """True for UI glyphs (menu, moon, map-pin) that sit inside a header.

    A rendered SPA puts icon-library SVGs in the nav, and every one of them used
    to be collected as a logo candidate.
    """
    haystack = context
    if not haystack:
        haystack = ' '.join([
            ' '.join(svg.get('class', [])) if isinstance(svg.get('class'), list)
            else str(svg.get('class', '')),
            str(svg.get('id', '')),
        ]).lower()
    if any(token in haystack for token in ICON_SVG_TOKENS):
        return True
    edges = []
    for attr in ('width', 'height'):
        raw = str(svg.get(attr) or '').replace('px', '').strip()
        try:
            edges.append(float(raw))
        except ValueError:
            pass
    if edges and max(edges) <= 32:
        return True
    viewbox = str(svg.get('viewbox') or svg.get('viewBox') or '')
    parts = viewbox.replace(',', ' ').split()
    if len(parts) == 4:
        try:
            if max(float(parts[2]), float(parts[3])) <= 32:
                return True
        except ValueError:
            pass
    return False


def extract_logo_candidates(soup, page_url):
    """Return list of {kind, url, source} for logo candidates."""
    out = []
    seen = set()

    def add(url, source, kind='logo', label='', in_nav=False):
        if not url:
            return
        url = urljoin(page_url, url)
        if url in seen:
            return
        seen.add(url)
        out.append({'url': url, 'source': source, 'kind': kind, 'label': label,
                    'in_nav': in_nav})

    # <img> with logo hints
    for img in soup.find_all('img'):
        haystack = ' '.join([
            str(img.get('src', '')),
            str(img.get('data-src', '')),
            str(img.get('data-lazy-src', '')),
            str(img.get('alt', '')),
            str(img.get('class', '')),
            str(img.get('id', '')),
        ]).lower()
        if any(h in haystack for h in LOGO_HINTS):
            src = (img.get('src') or img.get('data-src')
                   or img.get('data-lazy-src') or img.get('data-original'))
            if src:
                in_header, press_wall = _logo_nav_context(img)
                page_host = domain_of(page_url)
                link_host = _logo_link_host(img, page_url)
                third_party = bool(
                    link_host and page_host and link_host != page_host
                    and not link_host.endswith('.' + page_host)
                    and not page_host.endswith('.' + link_host)
                )
                if not in_header and (press_wall or third_party
                                      or is_press_logo(haystack)):
                    continue
                add(src, 'img', 'logo', haystack, in_nav=in_header)

    # favicon / apple-touch-icon
    for link in soup.find_all('link', href=True):
        rel = [r.lower() for r in (link.get('rel') or [])]
        if any('icon' in r for r in rel):
            add(link['href'], 'favicon', 'mark', ' '.join(rel))

    # og:image and twitter:image
    for prop in ('og:image', 'twitter:image'):
        meta = soup.find('meta', property=prop) or soup.find('meta', attrs={'name': prop})
        if meta and meta.get('content'):
            add(meta['content'], prop, 'logo', prop)

    # Inline SVGs — often the clearest cut
    for i, svg in enumerate(soup.find_all('svg')):
        parent = svg.parent
        in_nav = False
        depth = 0
        while parent and depth < 4:
            name = getattr(parent, 'name', '') or ''
            cls = ' '.join(parent.get('class', []) if parent.has_attr('class') else [])
            if name in ('header', 'nav') or 'logo' in cls.lower() or 'brand' in cls.lower():
                in_nav = True
                break
            parent = parent.parent
            depth += 1
        svg_context = ' '.join([
            ' '.join(svg.get('class', [])) if isinstance(svg.get('class'), list)
            else str(svg.get('class', '')),
            str(svg.get('id', '')),
            str(svg.get('aria-label', '')),
            ' '.join(parent.get('class', [])) if parent and isinstance(parent.get('class'), list)
            else '',
        ]).lower()
        has_logo_hint = any(hint in svg_context for hint in LOGO_HINTS)
        if _svg_is_decorative_icon(svg, svg_context) and not has_logo_hint:
            continue
        if (in_nav or has_logo_hint) and not any(
            word in svg_context for word in ('social', 'sprite', 'facebook', 'instagram',
                                             'tiktok', 'twitter', 'youtube')
        ):
            out.append({
                'url': None,
                'source': 'inline-svg',
                'kind': 'logo',
                'inline_svg': str(svg),
                'index': i,
                'label': svg_context,
                'in_nav': in_nav,
            })

    return out


def extract_photography_candidates(soup, page_url, page_text_len=0):
    """Return hero-then-body image URLs, preferring the largest srcset cut."""
    hero = []
    body = []
    seen = set()

    def add(value, bucket):
        if not value:
            return
        url = urljoin(page_url, value)
        if not url.lower().startswith(('http://', 'https://')) or url in seen:
            return
        seen.add(url)
        bucket.append(url)

    for img in soup.find_all('img'):
        haystack = ' '.join([
            str(img.get('src', '')),
            str(img.get('data-src', '')),
            str(img.get('alt', '')),
            str(img.get('class', '')),
        ]).lower()
        if any(h in haystack for h in LOGO_HINTS):
            continue
        if any(x in haystack for x in ('icon', 'sprite', 'favicon', 'avatar')):
            continue
        src = (img.get('src') or img.get('data-src')
               or img.get('data-lazy-src') or img.get('data-original'))
        srcset = (img.get('srcset') or img.get('data-srcset')
                  or img.get('data-lazy-srcset') or '')
        largest = None
        best = -1.0
        for match in re.finditer(r'(\S+?)\s+(\d+(?:\.\d+)?)([wx])', srcset or '', re.I):
            candidate = match.group(1).strip().rstrip(',')
            score = float(match.group(2))
            if score > best:
                best = score
                largest = candidate
        if not src and not largest:
            continue
        cls = str(img.get('class', '')).lower()
        bucket = hero if any(k in cls for k in ('hero', 'banner', 'cover', 'featured')) else body
        # srcset usually holds the full-size Wix/Squarespace cut.
        add(largest, bucket)
        add(src, bucket)

    # <picture><source srcset="..."> is how Wix galleries expose the full-size
    # cut; the sibling <img> is often only a thumbnail.
    for source in soup.find_all('source'):
        srcset = source.get('srcset') or source.get('data-srcset') or ''
        largest = None
        best = -1.0
        for match in re.finditer(r'(\S+?)\s+(\d+(?:\.\d+)?)([wx])', srcset, re.I):
            candidate = match.group(1).strip().rstrip(',')
            score = float(match.group(2))
            if score > best:
                best = score
                largest = candidate
        add(largest, body)

    for tag in soup.find_all(style=True):
        style = tag.get('style') or ''
        if 'background' not in style.lower():
            continue
        for value in extract_css_background_urls(style):
            add(value, body)

    og = soup.find('meta', property='og:image')
    if og and og.get('content'):
        add(og['content'], hero)
    twitter = soup.find('meta', attrs={'name': 'twitter:image'})
    if twitter and twitter.get('content'):
        add(twitter['content'], hero)

    return hero + body


def extract_contact_info(soup):
    contacts = {
        'phones': set(), 'emails': set(), 'social': {}, 'address': None,
        'location': {}, 'category': None,
    }

    def add_social(platform, url):
        links = contacts['social'].setdefault(platform, [])
        if not isinstance(links, list):
            links = [links]
            contacts['social'][platform] = links
        if url not in links:
            links.append(url)

    for a in soup.find_all('a', href=True):
        href = a['href']
        if href.startswith('tel:'):
            contacts['phones'].add(href[4:].strip())
        elif href.startswith('mailto:'):
            contacts['emails'].add(href[7:].split('?')[0].strip())
        else:
            for platform, pat in SOCIAL_PATTERNS.items():
                if re.search(pat, href, re.IGNORECASE):
                    add_social(platform, href)

    for script in soup.find_all('script', type='application/ld+json'):
        try:
            data = json.loads(script.string or '')
        except Exception:
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if not isinstance(item, dict):
                continue
            type_ = item.get('@type') or ''
            type_list = type_ if isinstance(type_, list) else [type_]
            if not any(t in ('Organization', 'LocalBusiness', 'Restaurant',
                             'Hotel', 'LodgingBusiness', 'Store', 'Corporation')
                       for t in type_list):
                if not any(t in ('BarOrPub', 'CafeOrCoffeeShop', 'FoodEstablishment')
                           for t in type_list):
                    continue
            category_map = {
                'Restaurant': 'Restaurant', 'BarOrPub': 'Bar',
                'CafeOrCoffeeShop': 'Cafe', 'FoodEstablishment': 'Restaurant',
            }
            if not contacts['category']:
                contacts['category'] = next(
                    (category_map[t] for t in type_list if t in category_map), None
                )
            if item.get('telephone'):
                contacts['phones'].add(item['telephone'])
            if item.get('email'):
                contacts['emails'].add(item['email'].replace('mailto:', ''))
            addr = item.get('address')
            if isinstance(addr, dict):
                parts = [addr.get('streetAddress'), addr.get('addressLocality'),
                         addr.get('addressRegion'), addr.get('postalCode'),
                         addr.get('addressCountry')]
                addr_str = ', '.join(p for p in parts if p)
                if addr_str:
                    contacts['address'] = addr_str
                contacts['location'] = {
                    key: addr.get(source)
                    for key, source in (
                        ('city', 'addressLocality'),
                        ('region', 'addressRegion'),
                        ('country', 'addressCountry'),
                    ) if addr.get(source)
                }
            elif isinstance(addr, str) and addr:
                contacts['address'] = addr
            for same in (item.get('sameAs') or []):
                for platform, pat in SOCIAL_PATTERNS.items():
                    if isinstance(same, str) and re.search(pat, same, re.IGNORECASE):
                        add_social(platform, same)

    if not contacts['address']:
        address = extract_address_from_html(soup)
        if address:
            contacts['address'] = address
            contacts['location'] = location_from_address_string(address)

    return contacts


ADDRESS_CONTAINER_HINTS = ('address', 'endereco', 'endereço', 'adres', 'location',
                           'morada', 'where', 'onde-estamos', 'onde estamos')
ADDRESS_TEXT_HINTS = (
    r'\b(?:rua|avenida|av\.|alameda|travessa|rodovia|estrada|praça|praca|'
    r'street|road|avenue|lane|drive|high\s*street)\b',
    r'\b(?:cep|zip|postcode|post\s*code)\b',
    r'\b\d{5}-?\d{3}\b',
)
ADDRESS_BLOCKLIST = ('cookie', 'newsletter', 'banner', 'modal', 'copyright')


def _address_text(element):
    """Text of an address block, turning <br> into separators."""
    clone = BeautifulSoup(str(element), 'lxml')
    for br in clone.find_all('br'):
        br.replace_with(', ')
    text = clone.get_text(' ', strip=True)
    return re.sub(r'\s*,\s*', ', ', re.sub(r'\s+', ' ', text)).strip(' ,')


def extract_address_from_html(soup):
    """Postal address from markup when no JSON-LD carries one.

    Client-rendered sites (melano.com.br) ship the address as
    `<address>Rua …<br>CEP …</address>` and nothing structured.
    """
    for element in soup.find_all('address'):
        text = _address_text(element)
        if text and len(text) >= 12:
            return text

    for element in soup.find_all(attrs={'itemprop': True}):
        prop = str(element.get('itemprop', '')).lower()
        if prop in ('streetaddress', 'address'):
            text = _address_text(element)
            if text and len(text) >= 12:
                return text

    best, best_score = None, 0
    for element in soup.find_all(['div', 'p', 'span', 'li', 'section', 'footer']):
        if element.find(['div', 'p', 'section', 'footer']) is not None:
            continue  # innermost blocks only, so the whole page never matches
        text = _address_text(element)
        if not (12 <= len(text) <= 220):
            continue
        low = text.lower()
        if any(bad in low for bad in ADDRESS_BLOCKLIST):
            continue
        hint_blob = ' '.join([
            str(element.get('id', '')), str(element.get('class', '')),
            str(element.get('aria-label', '')),
        ]).lower()
        score = sum(1 for pat in ADDRESS_TEXT_HINTS if re.search(pat, low, re.I))
        if any(hint in hint_blob for hint in ADDRESS_CONTAINER_HINTS):
            score += 1
        if re.search(r'\d', text):
            score += 1
        if score >= 3 and score > best_score:
            best, best_score = text, score
    return best


def location_from_address_string(address):
    """city/region/country hints parsed out of a postal address string."""
    location = {}
    if not address:
        return location
    country = country_from_address(address)
    if country:
        location['country'] = country
    match = re.search(r',\s*([A-Za-z .\'\-]{3,})\s+(?:[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|[A-Z]{1,2}\d)',
                      address)
    city = match.group(1).strip() if match else ''
    if not city:
        for known in KNOWN_CITIES:
            if re.search(r'\b' + re.escape(known) + r'\b', address, re.I):
                city = known
                break
    if city:
        location['city'] = city
    region = re.search(r'[–-]\s*([A-Z]{2})\s*$', address.strip())
    if region:
        location.setdefault('region', region.group(1))
    return location


def extract_og_meta(soup):
    meta = {}
    for prop in ('og:site_name', 'og:title', 'og:description', 'og:image', 'og:type', 'og:url'):
        tag = soup.find('meta', property=prop)
        if tag and tag.get('content'):
            meta[prop] = tag['content'].strip()
    desc = soup.find('meta', attrs={'name': 'description'})
    if desc and desc.get('content'):
        meta.setdefault('description', desc['content'].strip())
    theme = soup.find('meta', attrs={'name': 'theme-color'})
    if theme and theme.get('content'):
        parsed = parse_css_color(theme['content'])
        if parsed:
            meta['theme_color'] = parsed[0]
    title = soup.find('title')
    if title and title.string:
        meta.setdefault('title', title.string.strip())
    return meta


def extract_brand_data(start_url, visited_pages, extra_media=None):
    """Fetch home + a handful of key pages; return the brand dict.

    extra_media are images the crawl already discovered (rendered <img> tags and
    asset paths inside a JS bundle) so a client-rendered site contributes real
    photography rather than only its og:image.
    """
    brand = {
        'name': None,
        'description': None,
        'logo_candidates': [],
        'photography_urls': [],
        'guide_urls': [],
        'menu_urls': [],
        'css_tokens': {
            'font_faces': [],
            'families': set(),
            'colors': Counter(),
            'variables': {},
            'type_scale': [],
        },
        'contact': {'phones': set(), 'emails': set(), 'social': {}, 'address': None},
        'location': {},
        'category': None,
        'og': {},
        'theme_color': None,
        'stylesheet_urls': set(),
        'cover_url': None,
        'inline_svgs': [],
    }

    key_pages = [start_url]
    for u in sorted(visited_pages):
        low = u.lower()
        if any(k in low for k in BRAND_PAGE_KEYWORDS):
            key_pages.append(u)
    key_pages = list(dict.fromkeys(key_pages))[:8]

    phones_by_page = {}
    for page_url in key_pages:
        html = fetch_text_cached(page_url)
        if not html:
            continue
        soup = BeautifulSoup(html, 'lxml')

        og = extract_og_meta(soup)
        if og:
            for k, v in og.items():
                brand['og'].setdefault(k, v)
            if not brand['name']:
                brand['name'] = og.get('og:site_name') or og.get('title')
            if not brand['description']:
                brand['description'] = og.get('og:description') or og.get('description')
            if og.get('theme_color') and not brand['theme_color']:
                brand['theme_color'] = og['theme_color']
            if og.get('og:image') and not brand['cover_url']:
                brand['cover_url'] = urljoin(page_url, og['og:image'])

        for logo in extract_logo_candidates(soup, page_url):
            brand['logo_candidates'].append(logo)
            if logo.get('inline_svg'):
                brand['inline_svgs'].append(logo)

        brand['photography_urls'].extend(
            extract_photography_candidates(soup, page_url)
        )

        contact = extract_contact_info(soup)
        brand['contact']['phones'].update(contact['phones'])
        if contact['phones']:
            phones_by_page[page_url] = set(contact['phones'])
        brand['contact']['emails'].update(contact['emails'])
        if contact['address']:
            brand['contact']['address'] = contact['address']
        if contact.get('location'):
            brand['location'].update(contact['location'])
        if contact.get('category'):
            brand['category'] = contact['category']
        for k, v in contact['social'].items():
            links = brand['contact']['social'].setdefault(k, [])
            if not isinstance(links, list):
                links = [links]
                brand['contact']['social'][k] = links
            values = v if isinstance(v, (list, tuple, set)) else [v]
            for value in values:
                if value not in links:
                    links.append(value)

        for link in soup.find_all('link', rel='stylesheet'):
            href = link.get('href')
            if href and not href.startswith('data:'):
                brand['stylesheet_urls'].add(urljoin(page_url, href))

        for style in soup.find_all('style'):
            if style.string:
                extract_css_tokens_into(style.string, brand['css_tokens'])

        # Brand-guide / press-kit / menu links
        for a in soup.find_all('a', href=True):
            href = urljoin(page_url, a['href'])
            text = (a.get_text(' ', strip=True) or '').lower()
            haystack = text + ' ' + href.lower()
            if any(k in haystack for k in ('brand guide', 'brand-guideline', 'press kit',
                                           'media kit', 'brand-kit', 'brandbook',
                                           'brand-book', 'logo pack', 'logo-pack')):
                brand['guide_urls'].append(href)
            if '.pdf' in href.lower() or '/menu' in href.lower():
                if 'menu' in text or 'menu' in href.lower():
                    brand['menu_urls'].append(href)

    brand['contact']['phones'] = select_brand_phones(phones_by_page, start_url)

    # Fetch up to 12 stylesheets for tokens
    for css_url in sorted(brand['stylesheet_urls'])[:12]:
        css = fetch_text_cached(css_url)
        if css:
            extract_css_tokens_into(css, brand['css_tokens'])

    # Page-title names ('Home | The Adamson – St Andrews') are tidied; og:site_name is trusted as-is.
    if brand['name'] and brand['name'] != brand['og'].get('og:site_name'):
        brand['name'] = tidy_brand_name(brand['name'], start_url)
    # Last-resort name
    if not brand['name']:
        parsed = urlparse(start_url)
        host = parsed.netloc.replace('www.', '')
        brand['name'] = host.split('.')[0].title()

    # Key pages repeat the same favicon/og:image; keep first-seen order but one
    # entry each so the pack does not list a logo five times.
    brand['photography_urls'] = list(dict.fromkeys(brand['photography_urls']))
    unique_logos, seen_logos = [], set()
    for candidate in brand['logo_candidates']:
        key = (candidate.get('source'), candidate.get('url') or candidate.get('inline_svg'))
        if key in seen_logos:
            continue
        seen_logos.add(key)
        unique_logos.append(candidate)
    brand['logo_candidates'] = unique_logos

    if extra_media:
        already = set(brand['photography_urls'])
        reject_words = ('logo', 'icon', 'favicon', 'sprite', 'avatar', 'placeholder')
        for url in sorted(extra_media):
            if url in already or not is_image_url(url):
                continue
            low = unquote(url).lower()
            name = unquote(urlparse(url).path).rsplit('/', 1)[-1]
            if LOGO_ASSET_PATTERN.search(name):
                # A React/Vite site often ships its wordmark only as a bundle
                # import, so no <img> ever exists in the DOM. The filename is
                # then the only evidence that this asset is the logo.
                if not (is_favicon_url(url) or is_icon_url(url)
                        or is_press_logo(name) or is_sub_brand(name)):
                    brand['logo_candidates'].append({
                        'url': url,
                        'source': 'bundle',
                        'kind': classify_logo_kind(name),
                        'label': os.path.splitext(name)[0],
                        'in_nav': False,
                    })
                continue
            if any(word in low for word in reject_words):
                continue
            brand['photography_urls'].append(url)
            already.add(url)

    # If no cover, take the first photography URL
    if not brand['cover_url'] and brand['photography_urls']:
        brand['cover_url'] = brand['photography_urls'][0]

    return brand


# =========================================================
# PHASE 1: WORDPRESS REST API
# =========================================================
def discover_wp_media_endpoints():
    candidates = []

    def add_candidate(value):
        if value and value not in candidates:
            candidates.append(value)

    add_candidate(urljoin(BASE_URL, "wp-json/wp/v2/media"))
    add_candidate(urljoin(BASE_URL, "/wp-json/wp/v2/media"))

    start_page = get(BASE_URL, log_errors=False)
    if start_page:
        soup = BeautifulSoup(start_page.text, 'lxml')
        for link in soup.find_all('link', href=True):
            rel = link.get('rel') or []
            if any("api.w.org" in str(r) for r in rel):
                rest_base = urljoin(BASE_URL, link['href']).rstrip('/')
                add_candidate(f"{rest_base}/wp/v2/media")
    return candidates


def get_wp_media_items():
    found = set()
    per_page = 100
    endpoints = discover_wp_media_endpoints()
    if not endpoints:
        print("REST API: no endpoint candidates discovered.")
        return found

    for base in endpoints:
        probe = get(f"{base}?per_page=1&page=1", log_errors=False)
        if not probe:
            continue
        print(f"REST API: using endpoint {base}")

        for mime in ALL_MEDIA_MIME_TYPES:
            page = 1
            while True:
                url = f"{base}?per_page={per_page}&page={page}&mime_type={mime}"
                resp = get(url, log_errors=False)
                if not resp:
                    break
                try:
                    data = resp.json()
                except Exception:
                    break
                if not data or not isinstance(data, list):
                    break
                for item in data:
                    source_url = item.get('source_url') or item.get('guid', {}).get('rendered')
                    if source_url and is_media_url(source_url):
                        found.add(source_url)
                if len(data) < per_page:
                    break
                page += 1
                time.sleep(WEB_REQUEST_DELAY)
        break

    print(f"REST API: found {len(found)} media URLs.")
    return found


# =========================================================
# PHASE 2: XML SITEMAP
# =========================================================
def parse_sitemap(sitemap_url):
    urls = set()
    if sitemap_url in PERMANENTLY_FAILED:
        return urls
    resp = get(sitemap_url)
    if not resp:
        return urls
    try:
        root = ET.fromstring(resp.content)
    except ET.ParseError:
        return urls

    ns = {'sm': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    for url_elem in root.findall('url/loc') or root.findall('.//sm:loc', ns):
        if url_elem is not None and url_elem.text:
            urls.add(url_elem.text.strip())
    for sitemap_elem in root.findall('sitemap/loc') or root.findall('.//sm:sitemap/sm:loc', ns):
        if sitemap_elem is not None and sitemap_elem.text:
            sub_url = sitemap_elem.text.strip()
            urls.update(parse_sitemap(sub_url))
    return urls


def get_sitemap_urls():
    sitemap_candidates = []

    def add_candidate(candidate):
        if candidate and candidate not in sitemap_candidates:
            sitemap_candidates.append(candidate)

    for name in ("wp-sitemap.xml", "sitemap.xml", "sitemap_index.xml"):
        add_candidate(urljoin(BASE_URL, name))
        add_candidate(urljoin(BASE_URL, f"/{name}"))

    for robots_url in (urljoin(BASE_URL, "robots.txt"), urljoin(BASE_URL, "/robots.txt")):
        robots_resp = get(robots_url, log_errors=False)
        if not robots_resp:
            continue
        for line in robots_resp.text.splitlines():
            if line.lower().startswith("sitemap:"):
                maybe = line.split(":", 1)[1].strip()
                if maybe:
                    add_candidate(maybe)

    all_urls = set()
    for sitemap_url in sitemap_candidates:
        print(f"Trying sitemap: {sitemap_url}")
        urls = parse_sitemap(sitemap_url)
        if urls:
            all_urls.update(urls)

    media_urls = {u for u in all_urls if is_media_url(u)}
    print(f"Sitemap: {len(all_urls)} total URLs, {len(media_urls)} media URLs.")
    return media_urls, all_urls


# =========================================================
# PHASE 3: PAGE CRAWLING
# =========================================================
def harvest_document(html, current_url):
    """Media URLs, in-scope links and video embeds found in one document.

    Shared by the static crawler and the headless-browser path so a rendered
    SPA is harvested exactly like a server-rendered page.
    """
    media, links, embeds, seen = set(), [], [], set()
    if not html:
        return media, links, embeds
    soup = BeautifulSoup(html, 'lxml')

    def record(candidate):
        if not candidate:
            return False
        if classify_media(candidate):
            if is_media_host_allowed(candidate):
                media.add(candidate)
            return True
        return False

    def evaluate(raw_value, parse_embedded=False):
        if not raw_value:
            return
        candidates = []
        if not parse_embedded:
            candidates.append(raw_value)
        else:
            # Only absolute/path URLs from the HTML blob. Bare filenames inside
            # script/JSON payloads (_M3A9150.jpg, v.WEBP) are not real links and
            # used to produce hundreds of 404 downloads.
            for token in extract_urls_from_text(raw_value):
                if token.startswith(('http://', 'https://', '//', '/', './', '../')):
                    candidates.append(token)
        for token in candidates:
            href = normalize_candidate_url(token, current_url)
            if not href or href in seen:
                continue
            seen.add(href)
            if record(href):
                continue
            if not is_same_domain(href):
                continue
            if href in PERMANENTLY_FAILED:
                continue
            if not is_page_in_scope(href):
                continue
            if href.lower().endswith(NON_HTML_SUFFIXES):
                continue
            links.append(href)

    def handle_srcset(srcset_value):
        for u in extract_srcset_urls(srcset_value):
            record(normalize_candidate_url(u, current_url))

    def handle_css_text(css_text):
        for u in extract_css_background_urls(css_text):
            record(normalize_candidate_url(u, current_url))

    for tag in soup.find_all(True):
        for attr in ('srcset', 'data-srcset', 'data-lazy-srcset'):
            val = tag.get(attr)
            if val:
                handle_srcset(val)

        style_val = tag.get('style')
        if style_val:
            handle_css_text(style_val)

        if tag.name == 'iframe':
            src = tag.get('src') or tag.get('data-src') or tag.get('data-lazy-src')
            if src:
                for pattern, platform in VIDEO_EMBED_PATTERNS:
                    if re.search(pattern, src):
                        embeds.append((platform, src, current_url))
                        break
                evaluate(src)

        for attr in EXTRA_LINK_ATTRIBUTES:
            value = tag.get(attr)
            if not value:
                continue
            if attr in ('srcset', 'data-srcset', 'data-lazy-srcset'):
                continue
            evaluate(value, parse_embedded=(attr == 'onclick'))

    for source_tag in soup.find_all('source'):
        src = source_tag.get('src')
        if src:
            evaluate(src)
        srcset = source_tag.get('srcset')
        if srcset:
            handle_srcset(srcset)

    for style_tag in soup.find_all('style'):
        if style_tag.string:
            handle_css_text(style_tag.string)

    evaluate(html, parse_embedded=True)
    return media, links, embeds


def looks_like_js_shell(html):
    """True when the HTML is a near-empty document a framework fills in later.

    Client-rendered sites return a shell with no links, no text and no images,
    so the static crawl sees a one-page site. Verified against melano.com.br
    (Vite/React, `<div id="root">` + one module script).
    """
    if not html or len(html) > 200_000:
        return False
    try:
        soup = BeautifulSoup(html, 'lxml')
    except Exception:
        return False
    body = soup.body or soup
    elements = len(body.find_all(True))
    if elements > SHELL_MAX_ELEMENTS:
        return False
    if len(body.find_all(['img', 'picture', 'video', 'source'])) > SHELL_MAX_MEDIA:
        return False
    text = body.get_text(' ', strip=True)
    if len(text) > SHELL_MAX_TEXT:
        return False
    if not soup.find('script'):
        return False
    root = soup.find(id=re.compile(r'^(?:root|app|__next|__nuxt|___gatsby|svelte)$', re.I))
    return bool(root) or elements <= 12


def _bundle_references(html, page_url):
    """Same-origin JS/CSS bundles that a shell page loads."""
    soup = BeautifulSoup(html, 'lxml')
    refs = []
    for script in soup.find_all('script', src=True):
        refs.append(urljoin(page_url, script['src']))
    for link in soup.find_all('link', href=True):
        rel = ' '.join(link.get('rel') or []).lower()
        if 'stylesheet' in rel or 'modulepreload' in rel or 'preload' in rel:
            refs.append(urljoin(page_url, link['href']))
    seen, out = set(), []
    for ref in refs:
        low = ref.lower().split('?')[0]
        if not low.endswith(('.js', '.mjs', '.css')):
            continue
        if not (is_same_domain(ref) or low.endswith('.css')):
            continue
        if ref in seen:
            continue
        seen.add(ref)
        out.append(ref)
    return out[:BUNDLE_MAX_FILES]


def resolve_bundle_asset(raw, page_url, bundle_url=""):
    """Absolute URL for an asset path found inside a JS/CSS bundle.

    Vite/webpack emit `/assets/…` (root-relative) or a bare `assets/…`, and
    both are served from the site root; only `./` means "next to the bundle".
    """
    value = (raw or "").strip()
    if not value:
        return None
    parsed = urlparse(page_url)
    origin = f"{parsed.scheme or 'https'}://{parsed.netloc}"
    if value.startswith(('http://', 'https://', '//')):
        base = origin
    elif bundle_url and value.startswith(('./', '../')):
        base = bundle_url
    else:
        base = origin + '/'
    return normalize_candidate_url(value, base)


def harvest_bundle_assets(html, page_url):
    """Asset URLs that only exist inside a JS/CSS bundle.

    A Vite/webpack build imports images from `/assets/…`; the strings are in
    the bundle, never in the shell HTML. Without this a client-rendered site
    yields a favicon and an og:image and nothing else.
    """
    assets = set()
    for bundle_url in _bundle_references(html, page_url):
        text = fetch_text_cached(bundle_url)
        if not text or len(text) > BUNDLE_MAX_BYTES:
            continue
        for match in BUNDLE_ASSET_PATTERN.finditer(text):
            candidate = resolve_bundle_asset(match.group(1), page_url, bundle_url)
            if candidate and is_media_host_allowed(candidate):
                assets.add(candidate)
    return assets


def crawl_pages(start_urls):
    visited, to_visit, media_urls = set(), [], set()
    text_pages, video_embeds = set(), set()
    if ENABLE_CRAWL_CHECKPOINT:
        checkpoint = load_crawl_checkpoint(CRAWL_CHECKPOINT_FILE)
        if checkpoint:
            visited = set(checkpoint.get("visited", []))
            to_visit = list(checkpoint.get("to_visit", []))
            media_urls = set(checkpoint.get("media_urls", []))
            text_pages = set(checkpoint.get("text_pages", []))
            video_embeds = {tuple(x) for x in checkpoint.get("video_embeds", [])}
            print(f"Resuming checkpoint: {len(visited)} visited, {len(to_visit)} queued, "
                  f"{len(media_urls)} media, {len(text_pages)} text pages")

    for seed in start_urls:
        if seed and seed not in visited and seed not in to_visit and seed not in PERMANENTLY_FAILED:
            if len(to_visit) < MAX_PAGE_CRAWL:
                to_visit.append(seed)

    pages_since_checkpoint = 0
    os.makedirs(TEXT_DIR, exist_ok=True)

    def queue_links(found_links):
        for href in found_links:
            if href in visited or href in to_visit:
                continue
            if len(to_visit) >= MAX_PAGE_CRAWL:
                continue
            to_visit.append(href)

    def handle_page_html(url, html):
        found_media, found_links, found_embeds = harvest_document(html, url)
        media_urls.update(found_media)
        video_embeds.update(found_embeds)
        queue_links(found_links)

    with ThreadPoolExecutor(max_workers=WEB_MAX_WORKERS) as executor:
        futures = {}
        while to_visit and len(visited) < MAX_PAGE_CRAWL:
            while to_visit and len(futures) < WEB_MAX_WORKERS * 2:
                url = to_visit.pop(0)
                if url in visited or url in PERMANENTLY_FAILED:
                    continue
                visited.add(url)
                pages_since_checkpoint += 1
                futures[executor.submit(get, url)] = url

            for future in as_completed(futures):
                url = futures.pop(future)
                try:
                    resp = future.result()
                    if resp and resp.status_code == 200:
                        ctype = (resp.headers.get('content-type') or '').lower()
                        if 'html' in ctype or not ctype:
                            _page_cache[url] = resp.text
                            if url not in text_pages:
                                try:
                                    text = extract_page_text(resp.text)
                                    if text.strip():
                                        txt_path = os.path.join(TEXT_DIR, text_safe_filename(url))
                                        with open(txt_path, 'w', encoding='utf-8') as f:
                                            f.write(text)
                                        text_pages.add(url)
                                except Exception as e:
                                    print(f"Text extraction error for {url}: {e}")
                            try:
                                handle_page_html(url, resp.text)
                            except Exception as e:
                                print(f"Link extraction error for {url}: {e}")
                except Exception as e:
                    print(f"Error crawling {url}: {e}")
                time.sleep(WEB_REQUEST_DELAY)

            if ENABLE_CRAWL_CHECKPOINT and pages_since_checkpoint >= CRAWL_CHECKPOINT_SAVE_EVERY:
                save_crawl_checkpoint(
                    CRAWL_CHECKPOINT_FILE, visited, to_visit,
                    media_urls, text_pages, video_embeds
                )
                pages_since_checkpoint = 0

    if ENABLE_CRAWL_CHECKPOINT:
        if CLEAR_CHECKPOINT_ON_COMPLETE and not to_visit:
            clear_crawl_checkpoint(CRAWL_CHECKPOINT_FILE)
        else:
            save_crawl_checkpoint(
                CRAWL_CHECKPOINT_FILE, visited, to_visit,
                media_urls, text_pages, video_embeds
            )

    if RENDER_JS_SITES and os.environ.get('CRAWLER_RENDER_JS', '1') != '0':
        try:
            rendered = render_js_site(start_urls, visited, text_pages)
            media_urls.update(rendered['media'])
            text_pages.update(rendered['text_pages'])
            video_embeds.update(rendered['video_embeds'])
        except Exception as e:
            print(f"JS rendering skipped: {e}")

    print(f"Page crawl: visited {len(visited)} pages, "
          f"found {len(media_urls)} media links, "
          f"saved text for {len(text_pages)} pages, "
          f"detected {len(video_embeds)} video embeds.")
    return media_urls, text_pages, video_embeds, visited


def _route_key(url):
    """Scheme/host/trailing-slash-insensitive key so '/produtos' == '/produtos/'."""
    parsed = urlparse(url)
    path = (parsed.path or "/").rstrip("/") or "/"
    return f"{parsed.netloc.lower()}{path}".lower()


def _write_page_text(url, html, text_pages, result):
    try:
        text = extract_page_text(html)
    except Exception:
        return
    if not text.strip():
        return
    try:
        os.makedirs(TEXT_DIR, exist_ok=True)
        with open(os.path.join(TEXT_DIR, text_safe_filename(url)), 'w', encoding='utf-8') as f:
            f.write(text)
        text_pages.add(url)
        result['text_pages'].add(url)
    except Exception as e:
        print(f"Text write error for {url}: {e}")


def _render_route(browser, url, settle_ms):
    """Render one route, scrolling so lazy grids and carousels populate."""
    page = browser.render(url, wait_ms=settle_ms, max_scrolls=SPA_MAX_SCROLLS,
                          scroll_selector="auto", wait_network_idle=True)
    if not page or not page.ok or len(page.text) < SHELL_MAX_TEXT:
        page = browser.render(url, wait_ms=max(settle_ms, 4500),
                              scroll_selector="auto", max_scrolls=SPA_MAX_SCROLLS,
                              wait_network_idle=True)
    return page


def render_js_site(start_urls, visited, text_pages):
    """Render client-side pages that the static crawl could only see as shells.

    melano.com.br is a Vite/React build: the HTML is `<div id="root"></div>`
    plus one module script, so the static crawl found 1 page, 2 media files and
    no text. Rendering the seed page and its in-scope routes recovers the real
    nav, copy, address and imagery, and the rendered HTML is cached in
    _page_cache so the social phase does not refetch the shell.
    """
    result = {'media': set(), 'text_pages': set(), 'video_embeds': set()}
    if not start_urls:
        return result
    seed = start_urls[0]
    shell_html = _page_cache.get(seed) or fetch_text_cached(seed) or ""
    if shell_html:
        bundle_assets = harvest_bundle_assets(shell_html, seed)
        if bundle_assets:
            print(f"Bundle assets: {len(bundle_assets)} media URLs referenced by JS/CSS")
            result['media'].update(bundle_assets)

        if not looks_like_js_shell(shell_html):
            return result
        print("Client-rendered page detected (no server HTML) — rendering with browser")
    else:
        print("No HTML fetched over HTTP — trying the browser")

    browser = Browser()
    if not browser.available():
        print("  ! browser unavailable; cannot render the page — enable Playwright "
              "and do not use --no-browser")
        return result

    routes, queued = [], set()
    page = _render_route(browser, seed, SPA_SETTLE_MS)
    if not page or not page.ok:
        print(f"  ! render failed: {page.error if page else 'no result'}")
        return result

    rendered_seed = page.text
    _page_cache[seed] = rendered_seed
    visited.add(seed)
    _write_page_text(seed, rendered_seed, text_pages, result)

    found_media, found_links, found_embeds = harvest_document(rendered_seed, seed)
    result['media'].update(found_media)
    result['video_embeds'].update(found_embeds)
    for href in found_links:
        norm = _route_key(href)
        if norm in queued or norm == _route_key(seed):
            continue
        queued.add(norm)
        routes.append(href)

    def route_rank(href):
        low = href.lower()
        for i, word in enumerate(SPA_PRIORITY_ROUTE_WORDS):
            if word in low:
                return i
        return len(SPA_PRIORITY_ROUTE_WORDS)

    routes.sort(key=route_rank)
    print(f"  seed rendered: {len(found_media)} media, {len(found_links)} links, "
          f"{len(routes)} routes to render")

    for href in routes[:SPA_MAX_ROUTES]:
        route = _render_route(browser, href, SPA_SETTLE_MS)
        if not route or not route.ok:
            continue
        _page_cache[href] = route.text
        visited.add(href)
        _write_page_text(href, route.text, text_pages, result)
        route_media, route_links, route_embeds = harvest_document(route.text, href)
        result['media'].update(route_media)
        result['video_embeds'].update(route_embeds)
        print(f"  rendered {urlparse(href).path or '/'}: "
              f"{len(route_media)} media")

    print(f"JS rendering: {len(result['media'])} media, "
          f"{len(result['text_pages'])} text pages, "
          f"{len(result['video_embeds'])} video embeds")
    return result


# =========================================================
# CHECKPOINT HELPERS
# =========================================================
def load_crawl_checkpoint(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except Exception as e:
        print(f"Could not load checkpoint '{path}': {e}")
    return None


def save_crawl_checkpoint(path, visited, to_visit, media_urls, text_pages, video_embeds):
    payload = {
        "visited": list(visited),
        "to_visit": list(to_visit),
        "media_urls": list(media_urls),
        "text_pages": list(text_pages),
        "video_embeds": list(video_embeds),
        "saved_at": int(time.time()),
    }
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)


def clear_crawl_checkpoint(path):
    if os.path.exists(path):
        os.remove(path)


def export_discovered_urls_csv(media_urls, csv_path):
    directory = os.path.dirname(csv_path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(["url", "host", "path", "type"])
        for url in sorted(media_urls):
            parsed = urlparse(url)
            writer.writerow([url, parsed.netloc, parsed.path, classify_media(url) or "unknown"])
    print(f"Exported discovered URLs to '{csv_path}'")


def export_video_embeds_csv(embeds, csv_path):
    if not embeds:
        return
    directory = os.path.dirname(csv_path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(["platform", "embed_url", "source_page"])
        for platform, embed_url, source_page in sorted(embeds):
            writer.writerow([platform, embed_url, source_page])
    print(f"Exported {len(embeds)} video embed(s) to '{csv_path}'")


# =========================================================
# PHASE 4: DOWNLOAD
# =========================================================
def target_dir_for(url):
    kind = classify_media(url)
    if kind == 'image':
        return IMAGE_DIR
    if kind == 'video':
        return VIDEO_DIR
    return DOWNLOAD_DIR


def download_media_file(url):
    try:
        if not DOWNLOAD_VIDEOS and classify_media(url) == 'video':
            return None
        resp = get(url, stream=True)
        if not resp:
            return None

        content_type = (resp.headers.get('content-type') or '').lower()
        kind = classify_media(url)
        if 'svg' in content_type:
            kind = 'image'

        # A media URL can still return an HTML error page (Wix/Squarespace
        # 404s, hotlink walls). Never save that as an image or a video.
        if content_type.startswith('text/html'):
            print(f"Skipping HTML response at {url} (content-type: {content_type})")
            return None

        target_dir = target_dir_for(url)
        os.makedirs(target_dir, exist_ok=True)

        filename = filename_from_response(url, resp)
        filepath = os.path.join(target_dir, filename)
        base, ext = os.path.splitext(filename)
        counter = 1
        while os.path.exists(filepath):
            filepath = os.path.join(target_dir, f"{base}_{counter}{ext}")
            counter += 1

        total = int(resp.headers.get('content-length', 0))
        if total:
            print(f"Downloading {filename} ({total // 1024} KB)...")
        else:
            print(f"Downloading {filename}...")

        with open(filepath, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)

        # Validate the bytes, not just the URL/headers.
        if kind == 'image':
            info = get_image_info(filepath)
            if not info:
                print(f"Discarding non-image download at {url}")
                try:
                    os.remove(filepath)
                except OSError:
                    pass
                return None
            # SVGs are vector: a 120x20 wordmark is legitimate, so judge them
            # by their longer edge instead of requiring 32px on both sides.
            too_small = (max(info[0], info[1]) < 32 if info[2] == 'SVG'
                         else info[0] < 32 or info[1] < 32)
            if too_small:
                print(f"Discarding tiny image {info[0]}x{info[1]} at {url}")
                try:
                    os.remove(filepath)
                except OSError:
                    pass
                return None
            if info[2] == 'SVG':
                clean_svg_file(filepath)
        elif kind == 'video':
            if os.path.getsize(filepath) < 4096:
                try:
                    os.remove(filepath)
                except OSError:
                    pass
                return None
        # Normalise MIME/extension (WebP saved as .jpg, etc.)
        return fix_image_extension(filepath)
    except Exception as e:
        print(f"Failed to download {url}: {e}")
        return None


def download_all(media_urls):
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    os.makedirs(IMAGE_DIR, exist_ok=True)
    os.makedirs(VIDEO_DIR, exist_ok=True)

    urls = list(media_urls)
    videos = {u for u in urls if classify_media(u) == 'video'}
    if videos and not DOWNLOAD_VIDEOS:
        urls = [u for u in urls if u not in videos]
        print(f"Skipping {len(videos)} video file(s): not used by the brand pack "
              f"(listed in discovered_media.csv; pass --with-videos to fetch).")

    url_to_path = {}
    with ThreadPoolExecutor(max_workers=WEB_MAX_WORKERS) as executor:
        futures = {executor.submit(download_media_file, url): url for url in urls}
        for future in as_completed(futures):
            url = futures[future]
            try:
                result = future.result()
                if result:
                    url_to_path[url] = result
            except Exception as e:
                print(f"Error on {url}: {e}")
    return url_to_path


# =========================================================
def normalize_inline_svg(text):
    """Repair case-sensitive SVG attributes and give the root a real size.

    BeautifulSoup/lxml serialises ``viewBox`` as ``viewbox``, so browsers fall
    back to 300x150 and a 10:1 wordmark is squashed/clipped when the studio
    renders it. Restore the camel-case names and add width/height from viewBox.
    """
    if not text:
        return text
    value = str(text)
    value = re.sub(r'\bviewbox\s*=', 'viewBox=', value, flags=re.I)
    value = re.sub(r'\bpreserveaspectratio\s*=', 'preserveAspectRatio=', value, flags=re.I)
    match = re.search(r'viewBox=["\']([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)["\']', value)
    if match:
        width, height = match.group(3), match.group(4)
        open_tag = re.search(r'<svg\b[^>]*>', value, re.I)
        if open_tag:
            tag = open_tag.group(0)
            if not re.search(r'\bwidth\s*=', tag, re.I):
                tag = tag[:-1] + f' width="{width}">'
            if not re.search(r'\bheight\s*=', tag, re.I):
                tag = tag[:-1] + f' height="{height}">'
            value = value[:open_tag.start()] + tag + value[open_tag.end():]
    return value


def sanitize_svg_text(text):
    """Strip scriptable content from a downloaded SVG before it enters a pack."""
    if not text:
        return text
    value = re.sub(r'<\s*script\b.*?<\s*/\s*script\s*>', '', text,
                   flags=re.I | re.S)
    value = re.sub(r'<\s*foreignObject\b.*?<\s*/\s*foreignObject\s*>', '',
                   value, flags=re.I | re.S)
    value = re.sub(r'\son[a-z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)', '', value,
                   flags=re.I)
    value = re.sub(r'(href|xlink:href)\s*=\s*("|\')\s*javascript:[^"\']*\2', '',
                   value, flags=re.I)
    return normalize_inline_svg(value)


def clean_svg_file(path):
    """Rewrite a downloaded .svg in place: sanitized, sized, camel-cased."""
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as svg_file:
            raw = svg_file.read()
    except OSError:
        return path
    cleaned = sanitize_svg_text(raw)
    if cleaned != raw:
        try:
            with open(path, 'w', encoding='utf-8') as svg_file:
                svg_file.write(cleaned)
        except OSError:
            pass
    return path


# PHASE 5: BRAND PACK WRITER
# =========================================================
# ------------------------------------------------------------------
# LOGO CURATION
# ------------------------------------------------------------------
def is_favicon_url(url):
    low = (url or '').lower()
    return any(k in low for k in FAVICON_KEYWORDS)


def is_icon_url(url):
    low = (url or '').lower()
    return any(k in low for k in ICON_KEYWORDS)


def is_sub_brand(url_or_text):
    low = (url_or_text or '').lower()
    return any(k in low for k in SUB_BRAND_KEYWORDS)


def is_logo_sized(path):
    """True if the file could be a real logo (not a favicon-sized icon)."""
    info = get_image_info(path)
    if not info:
        return os.path.splitext(path)[1].lower() == '.svg'
    w, h, fmt = info
    if fmt == 'SVG':
        return True
    if w < LOGO_MIN_EDGE or h < LOGO_MIN_EDGE:
        # A wide wordmark could legitimately be 455×100, so accept very wide flatter files
        if w >= 400 and h >= 40 and w / max(h, 1) >= 3:
            return True
        return False
    return True


def classify_logo_variant(url_or_html, kind='logo'):
    haystack = (url_or_html or '').lower()
    if any(x in haystack for x in ('monochrome', 'mono', 'black-white', 'black_white')):
        return 'mono'
    if any(x in haystack for x in ('logo-white', 'logo-light', 'logo-reverse',
                                   '-white.', '-light.', '_white.', '_light.')):
        return 'light'
    if any(x in haystack for x in ('logo-dark', 'logo-black', '-dark.', '-black.')):
        return 'dark'
    if any(x in haystack for x in ('logo-color', 'logo-colour', 'logo-full',
                                   '-color.', '-colour.')):
        return 'color'
    return 'primary'


def classify_logo_kind(url_or_html):
    haystack = (url_or_html or '').lower()
    if 'wordmark' in haystack:
        return 'wordmark'
    if any(x in haystack for x in ('mark', 'symbol', 'icon', 'emblem')):
        return 'mark'
    return 'logo'


def dedupe_files(paths):
    """Return unique files by content hash (first wins)."""
    seen = set()
    unique = []
    for p in paths:
        if not p or not os.path.isfile(p):
            continue
        h = file_hash(p)
        if not h or h in seen:
            continue
        seen.add(h)
        unique.append(p)
    return unique


def select_curated_logos(brand_data, url_to_path):
    """Return the final list of logo file records after curation."""
    candidates = []
    for i, cand in enumerate(brand_data['logo_candidates']):
        url = cand.get('url')
        if not url:
            continue
        if cand.get('source') in ('og:image', 'twitter:image', 'favicon'):
            continue
        if is_favicon_url(url):
            continue
        if is_icon_url(url):
            continue
        label = cand.get('label', '')
        candidate_text = url + ' ' + label
        if is_sub_brand(candidate_text):
            continue
        if any(keyword in candidate_text.lower() for keyword in LOGO_REJECT_KEYWORDS):
            continue
        if not cand.get('in_nav') and is_press_logo(candidate_text):
            continue
        if re.search(r'-\d{2,4}x\d{2,4}(?:\.[a-z0-9]+)?$', urlparse(url).path.lower()):
            continue
        local = url_to_path.get(url)
        if not local or not os.path.isfile(local):
            continue
        if not is_logo_sized(local):
            continue
        variant = classify_logo_variant(url + ' ' + cand.get('label', ''), cand['kind'])
        kind = classify_logo_kind(url + ' ' + cand.get('label', ''))
        candidates.append({
            'url': url,
            'local': local,
            'variant': variant,
            'kind': kind,
            'source': cand['source'],
            'in_nav': bool(cand.get('in_nav')),
            'index': i,
        })
    # De-dup by file hash; header/nav marks win, then extraction order.
    candidates.sort(key=lambda c: not c.get('in_nav'))
    seen_hashes = set()
    unique = []
    for c in candidates:
        h = file_hash(c['local'])
        if not h or h in seen_hashes:
            continue
        seen_hashes.add(h)
        unique.append(c)
    return unique[:MAX_CURATED_LOGOS]


def select_curated_photography(brand_data, url_to_path, cover_local=None):
    """Return up to MAX_CURATED_PHOTOS distinct, print-capable photos.

    The same Wix/Squarespace image arrives as several sizes (``~mv2.jpg``,
    ``~mv2_1.jpg``, ...). Group by the underlying media id and keep the largest
    cut so a gallery does not become five copies of one photo.
    """
    reject = ('logo', 'icon', 'favicon', 'sprite', 'avatar', 'snakeandstaff',
              'pattern', 'texture', 'frame', 'badge', 'placeholder')
    by_stem = {}
    for url in brand_data['photography_urls']:
        local = url_to_path.get(url)
        if not local or not os.path.isfile(local):
            continue
        if cover_local and local == cover_local:
            continue
        low = unquote(url).lower()
        if any(word in low for word in reject):
            continue
        info = get_image_info(local)
        if not info or info[2] == 'SVG':
            continue
        width, height, _ = info
        short = min(width, height)
        if short < PHOTO_MIN_SHORT_EDGE:
            continue
        path = unquote(urlparse(url).path)
        stem = re.sub(r'(_\d+)?\.(?:jpe?g|png|webp|avif|gif)$', '', path, flags=re.I)
        digest = file_hash(local)
        if not digest:
            continue
        current = by_stem.get(stem)
        score = (width * height, short)
        if not current or score > current[0]:
            by_stem[stem] = (score, local)

    ranked = sorted(by_stem.values(), key=lambda item: item[0], reverse=True)
    chosen = []
    seen_hashes = set()
    for _score, local in ranked:
        digest = file_hash(local)
        if not digest or digest in seen_hashes:
            continue
        seen_hashes.add(digest)
        chosen.append(local)
        if len(chosen) >= MAX_CURATED_PHOTOS:
            break
    return chosen


def select_cover(brand_data, url_to_path):
    """Return the best cover file or None."""
    candidates = []
    if brand_data.get('cover_url'):
        candidates.append(brand_data['cover_url'])
    candidates.extend(brand_data['photography_urls'][:3])

    best = None
    best_score = -1
    for url in candidates:
        local = url_to_path.get(url)
        if not local or not os.path.isfile(local):
            continue
        if is_sub_brand(url) or is_favicon_url(url) or is_icon_url(url):
            continue
        info = get_image_info(local)
        if not info:
            continue
        w, h, fmt = info
        if fmt == 'SVG':
            continue
        if w < COVER_MIN_WIDTH or h < COVER_MIN_HEIGHT:
            continue
        score = w * h
        if score > best_score:
            best = local
            best_score = score
    return best


# ------------------------------------------------------------------
# PALETTE + TYPOGRAPHY
# ------------------------------------------------------------------
def build_palette(css_tokens, theme_color=None):
    """Rank cluster colors and assign roles/tiers."""
    if theme_color and theme_color not in css_tokens['colors']:
        css_tokens['colors'][theme_color] += 10

    if not css_tokens['colors']:
        return []

    colours = dict(css_tokens['colors'])
    filtered = {
        hex_value: count for hex_value, count in colours.items()
        if hex_value.lower() not in PLATFORM_UI_COLORS
    }
    if len(filtered) >= 5:
        colours = filtered

    total = sum(colours.values())
    clustered = cluster_colors(colours)

    clustered = {h: c for h, c in clustered.items() if c >= 1}
    if not clustered:
        return []

    ranked = sorted(clustered.items(), key=lambda kv: -kv[1])[:14]

    palette = []
    for i, (hex_color, count) in enumerate(ranked):
        rgb = hex_to_rgb(hex_color)
        cmyk = rgb_to_cmyk(rgb)
        lum = relative_luminance(rgb)
        sat = color_saturation(rgb)
        tier = 'primary' if i < 3 else ('secondary' if i < 6 else 'tertiary')
        name = derive_color_name(hex_color, css_tokens['variables']) or hex_color.upper()
        palette.append({
            'name': name,
            'hex': hex_color,
            'rgb': list(rgb),
            'cmyk': list(cmyk),
            'share': round(count / total, 3) if total else 0,
            'tier': tier,
            'luminance': round(lum, 3),
            'saturation': round(sat, 3),
            'role': 'neutral',
        })

    if palette:
        by_lum = sorted(palette, key=lambda p: p['luminance'])
        by_lum[-1]['role'] = 'ground'
        by_lum[0]['role'] = 'ink'
        remaining = [p for p in palette if p['role'] == 'neutral']
        if remaining:
            accent = max(remaining, key=lambda p: (p['saturation'] * (1.2 if p['tier'] == 'primary' else 1.0)))
            accent['role'] = 'accent'
    return palette


def is_real_font_family(name):
    """True if the name is a plausible brand font, not a framework internal."""
    if not name or len(name) < 2:
        return False
    n = name.strip()
    if FONT_INTERNAL_PATTERNS.match(n):
        return False
    if any(c in n for c in ('px', '%', '{', '}', ';', ':', ')', '(', '!')):
        return False
    if n.startswith('var(') or n.startswith('--'):
        return False
    if n.lower() in ('inherit', 'initial', 'unset', 'revert',
                     'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
                     'system-ui', '-apple-system', 'blinkmacsystemfont'):
        return False
    return True


FONT_ALIASES = {
    'brandon-grot-w01-light': 'Brandon Grotesque',
    'brandon-grotesque': 'Brandon Grotesque',
    'bree-w01-thin-oblique': 'Bree',
    'din-next-w01-light': 'DIN Next',
    'playfair display': 'Playfair Display',
    'montserrat': 'Montserrat',
    'raleway': 'Raleway',
    'cinzel': 'Cinzel',
    'bree': 'Bree',
}
GENERIC_FONT_FAMILIES = {
    'arial', 'helvetica', 'consolas', 'menlo', 'inconsolata', 'madefor',
    'wix madefor text', 'system-ui', 'sans-serif', 'serif', 'monospace',
}


def _is_generic_font(name):
    low = (name or '').lower()
    return (low in GENERIC_FONT_FAMILIES
            or any(term in low for term in ('hiragino', 'meiryo', 'yu gothic',
                                            'noto sans cjk', 'ヒラギノ', 'メイリオ')))


def _font_display_name(name):
    low = (name or '').strip().lower()
    if low in FONT_ALIASES:
        return FONT_ALIASES[low]
    if low in GENERIC_FONT_FAMILIES:
        return name.strip().title() if low != 'arial' else 'Arial'
    return ' '.join(part.capitalize() if part.islower() else part
                    for part in name.strip().split())


def build_typography(css_tokens):
    faces = css_tokens['font_faces']
    declared = sorted(css_tokens['families'])

    families = {}
    for face in faces:
        fam = face['family']
        if not is_real_font_family(fam):
            continue
        display = _font_display_name(fam)
        families.setdefault(display, {'name': display, 'weights': set(), 'styles': set(),
                                      'role': None, 'source': 'css-font-face'})
        families[display]['weights'].add(face['weight'])
        families[display]['styles'].add(face['style'])

    for fam in declared:
        if not is_real_font_family(fam):
            continue
        display = _font_display_name(fam)
        if display not in families:
            families[display] = {'name': display, 'weights': {'400'}, 'styles': {'normal'},
                                 'role': None, 'source': 'css-font-family'}

    ordered = [value for value in families.values()
               if not _is_generic_font(value['name'])]
    if not ordered:
        ordered = list(families.values())
    if len(ordered) >= 2:
        ordered[0]['role'] = 'display'
        ordered[1]['role'] = 'body'
    elif ordered:
        ordered[0]['role'] = 'body'

    ordered = ordered[:8]
    out_families = [f['name'] for f in ordered]
    weights = {f['name']: sorted(f['weights']) for f in ordered}
    return {'families': out_families, 'weights': weights}


def build_type_scale(observed_sizes, display_family=None, body_family=None):
    """Return a usable scale; synthesize one when the CSS only yields body text."""
    by_role = {}
    for entry in observed_sizes:
        if not isinstance(entry, dict):
            continue
        role = entry.get('id')
        size = entry.get('size')
        px = entry.get('px')
        family = entry.get('family')
        if role and family and size and px and role not in by_role:
            by_role[role] = {
                'id': role,
                'family': family,
                'size': size,
                'px': px,
            }

    if len(by_role) < 2:
        display = display_family or body_family or 'Arial'
        body = body_family or display
        return [
            {'id': 'display', 'family': display, 'size': '40px', 'px': 40},
            {'id': 'h1', 'family': display, 'size': '28px', 'px': 28},
            {'id': 'h2', 'family': display, 'size': '20px', 'px': 20},
            {'id': 'body', 'family': body, 'size': '16px', 'px': 16},
            {'id': 'caption', 'family': body, 'size': '12px', 'px': 12},
        ]
    return list(by_role.values())


# ------------------------------------------------------------------
# CONTENT PACK (menu / hours / booking URL)
# ------------------------------------------------------------------
def _clean_menu_line(line):
    """Strip page chrome that survives text extraction (Wix/Squarespace)."""
    value = (line or '').replace('\xa0', ' ').strip()
    value = re.sub(r'\s+', ' ', value)
    if not value:
        return ''
    low = value.lower()
    if low in {'top of page', 'bottom of page', 'book a table', 'scroll',
               'menu', 'home', 'back', 'search', 'close'}:
        return ''
    if re.match(r'^[A-Z][A-Za-z &]+\s*\|\s*[A-Z]', value):
        return ''                     # page title: "COCKTAILS | The Physician"
    if re.match(r'^(?:https?://|www\.)', low):
        return ''
    if len(value) > 140:
        return ''
    return value


def _is_menu_description(line):
    """True when a line reads like an ingredient/description, not an item name."""
    if not line:
        return False
    low = line.lower()
    if line.endswith(('.', '!', '?')):
        return True
    if len(line) > 78:
        return True
    if ',' in line and len(line) > 24:
        return True
    if re.match(r'^(with|served|includes?|topped|on a|in a|from the|our)\b', low):
        return True
    return False


def extract_menu_sections(text, max_sections=12):
    """Parse a menu-ish page into sections with items and prices.

    Supports both common shapes:

        THE PHYSICIAN            THE PHYSICIAN            £11
        Absolut, lime, mint      Absolut, lime, mint
        £11

    The previous version only understood a price on the same line, which meant
    most Wix/Squarespace menus produced an empty content pack.
    """
    price_re = re.compile(r'[£$€]\s*\d{1,4}(?:[.,]\d{1,2})?')
    sections = []
    current = {'name': 'Menu', 'items': []}
    block = []

    def ensure_section(name):
        nonlocal current
        name = (name or '').strip()
        if not name:
            return
        if current['items']:
            sections.append(current)
            current = {'name': name, 'items': []}
        elif current['name'] == 'Menu':
            current['name'] = name
        elif current['name'] != name:
            sections.append(current)
            current = {'name': name, 'items': []}

    def add_item(name, price, description=''):
        name = (name or '').strip(' .-—:|')
        if not name or len(name) > 90:
            return
        item = {'name': name, 'price': price}
        description = (description or '').strip(' .-—:|')
        if description:
            item['description'] = description
        current['items'].append(item)

    def flush(price):
        nonlocal block
        lines = [line for line in block if line]
        block = []
        if not lines:
            return

        def all_caps(value):
            letters = [c for c in value if c.isalpha()]
            return bool(letters) and all(c.isupper() for c in letters)

        known_section = re.compile(
            r'^(cocktails?|drinks?|wine|beer|spirits?|food|menu|breakfast|brunch|'
            r'lunch|dinner|small plates|starters?|mains?|desserts?|sides?|'
            r'snacks?|coffee|tea|soft drinks|house calls|repeat prescriptions)$',
            re.IGNORECASE,
        )

        # Walk past section labels: known menu headings and Title-case labels
        # that introduce an ALL-CAPS item.
        headings = []
        while len(lines) >= 2:
            first = lines[0]
            if known_section.match(first) or (
                not all_caps(first) and all_caps(lines[1]) and len(first) <= 45
            ):
                headings.append(lines.pop(0))
                continue
            break

        name = lines[0]
        description = ' '.join(lines[1:]) if len(lines) > 1 else ''
        if headings:
            ensure_section(headings[-1])
        add_item(name, price, description)

    for raw_line in text.splitlines():
        line = _clean_menu_line(raw_line)
        if not line:
            continue
        prices = list(price_re.finditer(line))
        if not prices:
            block.append(line)
            continue
        # A same-line item can still have a heading collected in the block.
        if len(prices) == 1 and line[:prices[0].start()].strip():
            if block:
                ensure_section(block[-1])
                block = []
            name = line[:prices[0].start()].strip()
            description = line[prices[0].end():].strip()
            add_item(name, prices[0].group(0), description)
            continue
        if len(prices) == 1 and not line[:prices[0].start()].strip():
            flush(prices[0].group(0))
            continue
        # Multiple prices on one line: treat the whole line as one item at the
        # first price (wine lists often show glass/bottle pairs).
        if block:
            ensure_section(block[-1])
            block = []
        name = line[:prices[0].start()].strip()
        description = line[prices[0].end():].strip()
        add_item(name, prices[0].group(0), description)

    # Trailing block with no price is not an item; drop it.
    if current['items']:
        sections.append(current)
    # Keep labels but drop empty sections; cap the number.
    cleaned = [s for s in sections if s['items']]
    return cleaned[:max_sections]
def extract_hours(text):
    """Best-effort extraction of opening hours from page text."""
    hours = {}
    days = (
        ('mon', r'mon(?:day)?'), ('tue', r'tue(?:sday)?'),
        ('wed', r'wed(?:nesday)?'), ('thu', r'thu(?:rsday)?'),
        ('fri', r'fri(?:day)?'), ('sat', r'sat(?:urday)?'),
        ('sun', r'sun(?:day)?'),
    )
    day_re = re.compile(r'\b(' + '|'.join(pattern for _, pattern in days) + r')\b',
                        re.IGNORECASE)
    day_names = [name for name, _ in days]
    time_re = re.compile(
        r'(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)\s*(?:[–—\-]|to)\s*'
        r'(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)'
    )
    for line in text.splitlines():
        day_matches = list(day_re.finditer(line))
        time_match = time_re.search(line)
        if not day_matches or not time_match:
            continue
        day_keys = []
        for match in day_matches:
            token = match.group(1).lower()[:3]
            if token not in day_keys:
                day_keys.append(token)
        interval = f'{time_match.group(1).strip()}–{time_match.group(2).strip()}'
        if len(day_keys) >= 2:
            start = day_names.index(day_keys[0])
            end = day_names.index(day_keys[-1])
            step = 1 if end >= start else -1
            day_keys = [day_names[i] for i in range(start, end + step, step)]
        for day in day_keys:
            hours[day] = interval
    return hours


def extract_booking_url(text):
    for m in re.finditer(r'https?://[^\s<>"\']+(book|reserv|opentable|sevenrooms|resdiary)[^\s<>"\']*',
                         text, re.IGNORECASE):
        return m.group(0)
    return None


def extract_content_pack(pages_texts, pdf_texts):
    """Assemble a content/<brand>.json for Asset Studio."""
    menu_text = ''
    drinks_text = ''
    hours_source = ''
    booking_source = ''
    for name, text in list(pages_texts.items()) + list(pdf_texts.items()):
        low = name.lower()
        if 'menu' in low and 'drink' not in low and 'wine' not in low:
            menu_text = menu_text or text
        if 'drink' in low or 'wine' in low or 'cocktail' in low:
            drinks_text = drinks_text or text
        hours_source += '\n' + text
        booking_source += '\n' + text

    menu_sections = extract_menu_sections(menu_text) if menu_text else []
    drink_sections = extract_menu_sections(drinks_text) if drinks_text else []
    hours = extract_hours(hours_source)
    booking = extract_booking_url(booking_source)

    content = {}
    if menu_sections:
        content['menu'] = {
            'title': 'Menu',
            'sections': menu_sections,
        }
    if drink_sections:
        content['drinks'] = {
            'title': 'Drinks',
            'sections': drink_sections,
        }
    if hours:
        content['hours'] = hours
    if booking:
        content['bookingUrl'] = booking
    return content


def extract_pdf_text(pdf_path):
    """Extract text from a PDF using pypdf / PyPDF2 / pdftotext, in that order."""
    errors = []
    # pypdf (modern)
    try:
        from pypdf import PdfReader
        reader = PdfReader(pdf_path)
        return '\n'.join((p.extract_text() or '') for p in reader.pages)
    except ImportError:
        pass
    except Exception as e:
        errors.append(f'pypdf: {e}')
    # PyPDF2 (older)
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(pdf_path)
        return '\n'.join((p.extract_text() or '') for p in reader.pages)
    except ImportError:
        pass
    except Exception as e:
        errors.append(f'PyPDF2: {e}')
    # pdftotext (poppler)
    try:
        import subprocess
        result = subprocess.run(
            ['pdftotext', '-layout', pdf_path, '-'],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            return result.stdout
        errors.append(f'pdftotext exited {result.returncode}: {result.stderr.strip()}')
    except FileNotFoundError:
        errors.append('pdftotext is not installed')
    except Exception as e:
        errors.append(f'pdftotext: {e}')
    print(f"Could not extract PDF text from {pdf_path}: {'; '.join(errors)}")
    return ''


# ------------------------------------------------------------------
# VOICE / APPLICATIONS / BRAND FIT
# ------------------------------------------------------------------
def extract_voice_samples(pages_texts, max_samples=5):
    """Pick real, human-sounding sentences from about/home pages."""
    samples = []
    for name, text in pages_texts.items():
        low = name.lower()
        if 'index' not in low and 'about' not in low and 'home' not in low:
            continue
        for raw in text.splitlines():
            line = raw.strip()
            if not (40 <= len(line) <= 220):
                continue
            lower = line.lower()
            if any(x in lower for x in ('cookie', 'privacy', 'copyright', '©',
                                        'sign up', 'subscribe', 'newsletter',
                                        'all rights reserved', 'we use cookies')):
                continue
            if line.count('!') > 2 or line.count('?') > 2:
                continue
            samples.append(line)
            if len(samples) >= max_samples:
                return samples
    return samples


def infer_applications(brand_data, extras, content):
    apps = []
    menu_urls_lower = [u.lower() for u in brand_data.get('menu_urls', [])]
    has_menu = any('menu' in u for u in menu_urls_lower) or 'menu' in content
    has_drinks = any(('drink' in u or 'wine' in u or 'cocktail' in u)
                     for u in menu_urls_lower) or 'drinks' in content

    if has_menu:
        apps.append({'asset': 'menu', 'sizes': ['A4', 'A5'], 'priority': 1})
    if has_drinks:
        apps.append({'asset': 'drinks-list', 'sizes': ['A4', 'DL'], 'priority': 1})
    apps.append({'asset': 'business-card', 'sizes': ['90x55mm'], 'priority': 2})
    apps.append({'asset': 'social-posts', 'sizes': ['1080x1080', '1080x1350', '1080x1920'],
                 'priority': 1})
    apps.append({'asset': 'a-board', 'sizes': ['A1'], 'priority': 2})
    return apps


def infer_brand_fit(brand_data, extras, content):
    fit = ['social', 'stationery']
    if any('menu' in u.lower() for u in brand_data.get('menu_urls', [])) or 'menu' in content:
        fit.append('menus')
    if any('drink' in u.lower() or 'wine' in u.lower()
           for u in brand_data.get('menu_urls', [])) or 'drinks' in content:
        fit.append('drinks')
    if brand_data.get('contact', {}).get('address'):
        fit.append('signage')
    if extras.get('photography'):
        fit.append('photography-led')
    return fit


# ------------------------------------------------------------------
# ASSET WRITING
# ------------------------------------------------------------------
def copy_brand_assets(brand_data, url_to_path, brand_dir):
    """Write curated assets into <brand_dir>/assets/ and cover at brand root."""
    assets = {
        'logos':       os.path.join(brand_dir, 'assets', 'logos'),
        'colors':      os.path.join(brand_dir, 'assets', 'colors'),
        'type':        os.path.join(brand_dir, 'assets', 'type'),
        'photography': os.path.join(brand_dir, 'assets', 'photography'),
    }
    for d in assets.values():
        os.makedirs(d, exist_ok=True)
    os.makedirs(os.path.join(brand_dir, 'tokens'), exist_ok=True)
    os.makedirs(os.path.join(brand_dir, 'content'), exist_ok=True)

    # ---- Logos (curated + deduped) ----
    logo_files = []
    inline_hashes = set()

    # Inline SVGs come first: they are the site's own header mark and cannot be
    # a third-party press logo. Keep at most MAX_CURATED_LOGOS of them.
    for svg in brand_data.get('inline_svgs', []):
        if len(logo_files) >= MAX_CURATED_LOGOS:
            break
        text = svg.get('inline_svg', '')
        digest = hashlib.sha256(text.encode('utf-8')).hexdigest()
        if (digest in inline_hashes or is_sub_brand(text[:300])
                or is_icon_url(svg.get('label', '') + ' ' + text[:500])):
            continue
        # Skip very tiny icon sprites
        viewbox_match = re.search(r'viewBox=["\']([^"\']+)', text)
        skip = False
        if viewbox_match:
            parts = viewbox_match.group(1).split()
            if len(parts) == 4:
                try:
                    w, h = float(parts[2]), float(parts[3])
                    if w < 30 and h < 30:
                        skip = True
                except ValueError:
                    pass
        if skip:
            continue
        name = f"logo-inline-{svg['index']}.svg"
        dest = os.path.join(assets['logos'], name)
        try:
            with open(dest, 'w', encoding='utf-8') as f:
                f.write(normalize_inline_svg(text))
            inline_hashes.add(digest)
            logo_files.append({
                'file': f'assets/logos/{name}',
                'variant': 'primary',
                'kind': 'logo',
                'source': 'inline-svg',
            })
        except OSError as e:
            print(f"Could not write inline SVG logo {dest}: {e}")

    curated = select_curated_logos(brand_data, url_to_path)
    for i, c in enumerate(curated):
        if len(logo_files) >= MAX_CURATED_LOGOS:
            break
        ext = os.path.splitext(c['local'])[1].lower() or '.png'
        kind_part = '' if c['kind'] == 'logo' else f"-{c['kind']}"
        name = f"logo-{c['variant']}{kind_part}-{i}{ext}"
        dest = os.path.join(assets['logos'], name)
        try:
            shutil.copy(c['local'], dest)
            logo_files.append({
                'file': f'assets/logos/{name}',
                'variant': c['variant'],
                'kind': c['kind'],
                'source': c['source'],
                'rights': 'unknown; verify before publication',
            })
        except OSError as e:
            print(f"Could not copy logo {c['local']}: {e}")

    # ---- Photography ----
    photo_files = []
    cover = select_cover(brand_data, url_to_path)
    curated_photos = select_curated_photography(
        brand_data, url_to_path, cover_local=cover,
    )
    if not cover and curated_photos:
        cover = curated_photos[0]
    copied_hashes = set()
    for i, local in enumerate(curated_photos):
        digest = file_hash(local)
        if not digest or digest in copied_hashes:
            continue
        copied_hashes.add(digest)
        ext = os.path.splitext(local)[1].lower() or '.img'
        name = f"photo-{i + 1:02d}{ext}"
        dest = os.path.join(assets['photography'], name)
        try:
            shutil.copy2(local, dest)
            info = get_image_info(local)
            photo_files.append({
                'file': f'assets/photography/{name}',
                'width': info[0] if info else None,
                'height': info[1] if info else None,
                'printReady': bool(info and min(info[0], info[1]) >= PHOTO_PRINT_SHORT_EDGE),
                'source': next(
                    (url for url, path in url_to_path.items() if path == local), None
                ),
                'rights': 'unknown; verify before publication',
            })
        except OSError as e:
            print(f"Could not copy photography asset {local}: {e}")

    cover_file = None
    if cover:
        ext = os.path.splitext(cover)[1].lower() or '.img'
        cover_file = f'cover{ext}'
        try:
            shutil.copy2(cover, os.path.join(brand_dir, cover_file))
        except OSError as e:
            print(f"Could not copy cover image {cover}: {e}")
            cover_file = None

    # ---- Palette and typography specimens ----
    palette = build_palette(
        brand_data['css_tokens'], brand_data.get('theme_color')
    )
    if HAVE_PIL and palette:
        palette_path = os.path.join(assets['colors'], 'palette.png')
        try:
            width, height = 900, 140
            image = Image.new('RGB', (width, height), 'white')
            draw = ImageDraw.Draw(image)
            swatch_width = width // len(palette)
            for i, color in enumerate(palette):
                x0 = i * swatch_width
                x1 = width if i == len(palette) - 1 else (i + 1) * swatch_width
                draw.rectangle((x0, 0, x1, 85), fill=color['hex'])
                draw.text((x0 + 5, 95), color['hex'], fill='black')
            image.save(palette_path)
        except OSError as e:
            print(f"Could not render palette image: {e}")
    elif palette:
        palette_path = os.path.join(assets['colors'], 'palette.svg')
        swatch_width = 900 / len(palette)
        swatches = []
        for i, color in enumerate(palette):
            x = i * swatch_width
            label = xml_escape(color['hex'])
            swatches.append(
                f'<rect x="{x:.2f}" y="0" width="{swatch_width:.2f}" height="88" '
                f'fill="{color["hex"]}"/>'
                f'<text x="{x + 5:.2f}" y="112" font-size="16">{label}</text>'
            )
        with open(palette_path, 'w', encoding='utf-8') as f:
            f.write(
                '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="140">'
                + ''.join(swatches) + '</svg>'
            )

    typography = build_typography(brand_data['css_tokens'])
    type_scale = build_type_scale(
        brand_data['css_tokens'].get('type_scale', []),
        display_family=(typography['families'][0] if typography['families'] else None),
        body_family=(typography['families'][1] if len(typography['families']) > 1
                     else (typography['families'][0] if typography['families'] else None)),
    )
    typography['scale'] = type_scale
    typography['specimen'] = []
    if HAVE_PIL and typography['families']:
        specimen_path = os.path.join(assets['type'], 'specimen.png')
        try:
            image = Image.new('RGB', (1000, 260), 'white')
            draw = ImageDraw.Draw(image)
            default_font = ImageFont.load_default()
            draw.text((24, 20), brand_data['name'], fill='#222222', font=default_font)
            y = 65
            for family in typography['families'][:4]:
                draw.text((24, y), f"{family}: The quick brown fox", fill='#333333',
                          font=default_font)
                y += 42
            image.save(specimen_path)
            typography['specimen'].append('assets/type/specimen.png')
        except OSError as e:
            print(f"Could not render typography specimen: {e}")
    elif typography['families']:
        specimen_path = os.path.join(assets['type'], 'specimen.svg')
        rows = []
        for i, family in enumerate(typography['families'][:5]):
            family_attr = xml_escape(family, {'"': '&quot;', "'": '&apos;'})
            y = 55 + i * 44
            rows.append(
                f'<text x="24" y="{y}" font-family="{family_attr}" font-size="24">'
                f'{xml_escape(family)} — The quick brown fox</text>'
            )
        with open(specimen_path, 'w', encoding='utf-8') as f:
            f.write(
                '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="280">'
                '<rect width="100%" height="100%" fill="white"/>'
                + ''.join(rows) + '</svg>'
            )
        typography['specimen'].append('assets/type/specimen.svg')

    return {
        'logos': logo_files,
        'photography': photo_files,
        'cover': cover_file,
        'palette': palette,
        'typography': typography,
    }


LOCALE_BY_COUNTRY = {
    'Brazil': ('pt-BR', 'BRL'),
    'Portugal': ('pt-PT', 'EUR'),
    'United Kingdom': ('en-GB', 'GBP'),
    'Ireland': ('en-IE', 'EUR'),
    'United States': ('en-US', 'USD'),
    'Canada': ('en-CA', 'CAD'),
    'Australia': ('en-AU', 'AUD'),
    'Spain': ('es-ES', 'EUR'),
    'Mexico': ('es-MX', 'MXN'),
    'Argentina': ('es-AR', 'ARS'),
    'France': ('fr-FR', 'EUR'),
    'Italy': ('it-IT', 'EUR'),
    'Germany': ('de-DE', 'EUR'),
    'Netherlands': ('nl-NL', 'EUR'),
    'Japan': ('ja-JP', 'JPY'),
    'South Korea': ('ko-KR', 'KRW'),
}


def locale_and_currency(brand_data):
    """Locale/currency for the pack, taken from the brand's own country."""
    country = (brand_data.get('location') or {}).get('country') \
        or country_from_address((brand_data.get('contact') or {}).get('address') or '')
    return LOCALE_BY_COUNTRY.get(country, (DEFAULT_LOCALE, DEFAULT_CURRENCY))


def build_brand_tokens(brand_data, extras, content):
    contact = build_contact_block(brand_data)
    applications = infer_applications(brand_data, extras, content)
    locale, currency = locale_and_currency(brand_data)
    return {
        'brand': {
            'name': brand_data['name'],
            'slug': brand_slug(BASE_URL),
            'wordmark': brand_data['name'],
            'tagline': None,
            'url': BASE_URL,
            'locale': locale,
            'currency': currency,
        },
        'color': extras['palette'],
        'typography': extras['typography'],
        'voice': {
            'attributes': [],
            'prefer': [],
            'avoid': [],
            'samples': extras['voice_samples'],
        },
        'contact': contact,
        'applications': applications,
        'brandFit': infer_brand_fit(brand_data, extras, content),
        'menuUrls': sorted(set(brand_data.get('menu_urls', []))),
        'og': brand_data.get('og', {}),
        'source': BASE_URL,
        'scrapedAt': int(time.time()),
        'themeColor': brand_data.get('theme_color'),
    }


def build_guide_json(brand_data, extras, content, tokens):
    contact = tokens['contact']
    return {
        'brand': tokens['brand'],
        'positioning': {
            'description': brand_data.get('description'),
            'source': 'website metadata',
        },
        'applications': tokens['applications'],
        'brandFit': tokens['brandFit'],
        'contact': {
            'address': contact['address'],
            'phones': contact['phones'],
            'emails': contact['emails'],
            'website': contact['website'],
            'social': contact['socialLinks'],
        },
        'typography': {
            'families': extras['typography']['families'],
            'weights': extras['typography']['weights'],
            'scale': extras['typography']['scale'],
        },
        'logos': extras['logos'],
        'logoRules': {
            'status': 'recommendations; confirm with the brand owner',
            'clearSpace': 'Maintain clear space around the mark; exact measurement unknown.',
            'minimumSize': 'Minimum reproduction size has not been supplied.',
            'backgrounds': 'Use a contrast-appropriate logo variant; verify approved variants.',
        },
        'photography': extras['photography'],
        'cover': extras['cover'],
        'content': content,
        'rights': 'Asset rights and licensing were not verified by this crawl.',
    }


def write_brand_pack_contents(brand_data, url_to_path, brand_dir, pages_texts,
                              pdf_texts):
    assets = copy_brand_assets(brand_data, url_to_path, brand_dir)
    content = extract_content_pack(pages_texts, pdf_texts)
    voice_samples = extract_voice_samples(pages_texts)
    extras = dict(assets)
    extras['voice_samples'] = voice_samples
    tokens = build_brand_tokens(brand_data, extras, content)
    guide = build_guide_json(brand_data, extras, content, tokens)
    slug = brand_slug(BASE_URL)
    outputs = (
        (os.path.join(brand_dir, 'tokens', f'{slug}.tokens.json'), tokens),
        (os.path.join(brand_dir, 'brand-guide.json'), guide),
        (os.path.join(brand_dir, 'content', f'{slug}.json'), content),
    )
    for path, data in outputs:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')
    write_brand_guide_docx(guide, os.path.join(brand_dir, f'{slug}-Brand-Guide.docx'))
    return extras


def xml_text(value):
    value = str(value if value is not None else '')
    value = ''.join(c for c in value if c in '\t\n\r' or ord(c) >= 32)
    return xml_escape(value)


def docx_paragraph(text, style=None, bold=False):
    style_xml = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ''
    bold_xml = '<w:b/>' if bold else ''
    return (
        f'<w:p>{style_xml}<w:r><w:rPr>{bold_xml}</w:rPr>'
        f'<w:t xml:space="preserve">{xml_text(text)}</w:t></w:r></w:p>'
    )


def docx_table(headers, rows):
    def cell(value, header=False):
        bold = '<w:rPr><w:b/></w:rPr>' if header else ''
        return (
            '<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:r>'
            f'{bold}<w:t xml:space="preserve">{xml_text(value)}</w:t>'
            '</w:r></w:p></w:tc>'
        )

    rows_xml = ['<w:tr>' + ''.join(cell(h, True) for h in headers) + '</w:tr>']
    rows_xml.extend('<w:tr>' + ''.join(cell(v) for v in row) + '</w:tr>' for row in rows)
    borders = (
        '<w:tblBorders>'
        '<w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/>'
        '<w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/>'
        '<w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/>'
        '</w:tblBorders>'
    )
    return (
        '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>'
        f'{borders}</w:tblPr><w:tblGrid>'
        + ''.join('<w:gridCol w:w="3000"/>' for _ in headers)
        + '</w:tblGrid>' + ''.join(rows_xml) + '</w:tbl>'
    )


def write_docx(path, title, sections):
    body = [docx_paragraph(title, 'Title')]
    for section in sections:
        body.append(docx_paragraph(section['heading'], 'Heading1'))
        if section.get('text'):
            body.append(docx_paragraph(section['text']))
        if section.get('rows'):
            body.append(docx_table(section['headers'], section['rows']))
        for paragraph in section.get('paragraphs', []):
            body.append(docx_paragraph(paragraph))
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:body>' + ''.join(body) + '<w:sectPr/></w:body></w:document>'
    )
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/>'
        '<w:rPr><w:sz w:val="22"/></w:rPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>'
        '<w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>'
        '<w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>'
        '</w:styles>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '</Relationships>'
    )
    document_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '</Relationships>'
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as docx:
        docx.writestr('[Content_Types].xml', content_types)
        docx.writestr('_rels/.rels', root_rels)
        docx.writestr('word/document.xml', document)
        docx.writestr('word/styles.xml', styles)
        docx.writestr('word/_rels/document.xml.rels', document_rels)


def write_brand_guide_docx(guide, path):
    """Render the Word brand guide from the brand-guide.json structure.

    Working from the JSON (not from in-memory crawl objects) means the .docx can
    be regenerated later, e.g. after the social phase adds reputation data.
    """
    brand = guide.get('brand') or {}
    contact = guide.get('contact') or {}
    typography = guide.get('typography') or {}
    content = guide.get('content') or {}
    contact_rows = [
        ['Address', contact.get('address') or 'Not found'],
        ['Phone', ', '.join(contact.get('phones') or []) or 'Not found'],
        ['Email', ', '.join(contact.get('emails') or []) or 'Not found'],
        ['Website', contact.get('website') or ''],
    ]
    for platform, urls in (contact.get('social') or {}).items():
        urls = urls if isinstance(urls, (list, tuple)) else [urls]
        if urls and urls[0]:
            contact_rows.append([platform.title(), urls[0]])
    app_rows = [
        [item['asset'], ', '.join(item.get('sizes', [])), str(item.get('priority', ''))]
        for item in guide.get('applications') or []
    ]
    type_rows = [
        [item['id'], item.get('family') or 'Unknown', item['size']]
        for item in typography.get('scale') or []
    ]
    sections = [
        {'heading': 'Positioning',
         'text': (guide.get('positioning') or {}).get('description') or 'Not found in site metadata.'},
        {'heading': 'Applications', 'headers': ['Application', 'Suggested sizes', 'Priority'],
         'rows': app_rows or [['No menu/drinks application evidence found', '', '']]},
        {'heading': 'Contact', 'headers': ['Field', 'Value'], 'rows': contact_rows},
        {'heading': 'Typography', 'headers': ['Role', 'Family', 'Observed size'],
         'rows': type_rows or [['No observed type scale', '', '']],
         'paragraphs': ['Families: ' + (', '.join(typography.get('families') or []) or 'Not found')]},
        {'heading': 'Logo rules', 'paragraphs': [
            'Keep clear space around the mark; exact measurement is not known.',
            'No minimum reproduction size was supplied. Confirm approved variants and sizes with the brand owner.',
        ]},
        {'heading': 'Brand fit', 'text': ', '.join(guide.get('brandFit') or []) or 'No fit tags inferred.'},
        {'heading': 'Content',
         'text': json.dumps(content, ensure_ascii=False) if content else 'No menu or hours data extracted.'},
    ]

    reputation = guide.get('reputation')
    if reputation:
        scores = reputation.get('scores') or {}
        rows = [
            ['Consensus rating', format_number(reputation.get('consensusRating')) or '—'],
            ['Total reviews', format_number(reputation.get('totalReviews')) or '—'],
            ['Overall score (0-100)', str(scores.get('overall', '—'))],
            ['Reputation / Social / Content / Discoverability',
             ' / '.join(str(scores.get(k, '—')) for k in
                        ('reputation', 'social_strength', 'content_health', 'discoverability'))],
        ]
        for source, entry in (reputation.get('perSource') or {}).items():
            if entry.get('rating') or entry.get('count'):
                rows.append([f'{source} rating',
                             f"{entry.get('rating') or '—'} ({format_number(entry.get('count')) or '—'} reviews)"])
        paragraphs = []
        if reputation.get('strengths'):
            paragraphs.append('Strengths: ' + '; '.join(map(str, reputation['strengths'][:5])))
        if reputation.get('weaknesses'):
            paragraphs.append('Weaknesses: ' + '; '.join(map(str, reputation['weaknesses'][:5])))
        if reputation.get('risks'):
            paragraphs.append('Risks: ' + '; '.join(map(str, reputation['risks'][:5])))
        sections.append({'heading': 'Reputation', 'headers': ['Metric', 'Value'], 'rows': rows,
                         'paragraphs': paragraphs})
    presence = (guide.get('socialPresence') or {}).get('platforms')
    if presence:
        rows = [[p.get('label') or p.get('platform') or '',
                 p.get('handle') or p.get('url') or '',
                 format_number(p.get('followers')) or '—',
                 p.get('lastPost') or '—'] for p in presence if p.get('present')]
        if rows:
            sections.append({'heading': 'Social presence',
                             'headers': ['Platform', 'Handle / URL', 'Followers', 'Last post'],
                             'rows': rows})
    sections.append({'heading': 'Rights',
                     'text': 'Asset rights and licensing were not verified by this crawl.'})
    write_docx(path, f"{brand.get('name') or 'Brand'} — Brand Guide", sections)


def make_zip(source_dir, zip_path, include_paths=None):
    os.makedirs(os.path.dirname(zip_path), exist_ok=True)
    roots = include_paths or ['.']
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as archive:
        archived = set()
        for relative in roots:
            target = source_dir if relative == '.' else os.path.join(source_dir, relative)
            if os.path.isfile(target):
                if relative not in archived:
                    archive.write(target, relative)
                    archived.add(relative)
                continue
            if not os.path.isdir(target):
                continue
            for root, dirs, files in os.walk(target):
                dirs.sort()
                for filename in sorted(files):
                    full_path = os.path.join(root, filename)
                    arcname = os.path.relpath(full_path, source_dir)
                    if arcname not in archived:
                        archive.write(full_path, arcname)
                        archived.add(arcname)






def read_site_texts():
    pages = {}
    if os.path.isdir(TEXT_DIR):
        for filename in sorted(os.listdir(TEXT_DIR)):
            path = os.path.join(TEXT_DIR, filename)
            if filename.endswith('.txt') and os.path.isfile(path):
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        pages[filename] = f.read()
                except OSError as e:
                    print(f"Could not read page text {path}: {e}")
    pdfs = {}
    if os.path.isdir(DOWNLOAD_DIR):
        for filename in sorted(os.listdir(DOWNLOAD_DIR)):
            path = os.path.join(DOWNLOAD_DIR, filename)
            if not filename.lower().endswith('.pdf') or not os.path.isfile(path):
                continue
            if not any(k in filename.lower() for k in ('menu', 'drink', 'wine', 'cocktail')):
                continue
            text = extract_pdf_text(path)
            if text.strip():
                pdfs[filename] = text
    return pages, pdfs


def build_social_target(brand_data, pages_texts):
    """Derive the social-crawler target record from what the website crawl learned.

    Same shape as a TARGET_OVERRIDES entry, plus `hints` (validated address /
    phones / emails) that the social phase uses as fallbacks for NAP checks.
    """
    contact = brand_data.get('contact', {})
    location = dict(brand_data.get('location') or {})
    address = contact.get('address') or ''
    all_text = '\n'.join(pages_texts.values())
    location_text = f'{address}\n{all_text}'

    if not location.get('city'):
        postcode = re.search(
            r'\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b', address, re.IGNORECASE
        )
        if postcode:
            preceding = address[:postcode.start()].rstrip(' ,')
            components = [part.strip() for part in preceding.split(',') if part.strip()]
            if components:
                candidate = components[-1]
                if not re.search(r'\d', candidate):
                    location['city'] = candidate
    if not location.get('city'):
        for candidate in KNOWN_CITIES:
            if re.search(r'\b' + re.escape(candidate) + r'\b', location_text, re.IGNORECASE):
                location['city'] = candidate
                break

    if not location.get('region') and (location.get('city') or '').casefold() == 'st andrews':
        location['region'] = 'Scotland'
    if not location.get('region') and re.search(r'\bScotland\b', location_text, re.IGNORECASE):
        location['region'] = 'Scotland'
    if not location.get('country'):
        # Address only — page text mentions foreign cities in press/awards copy.
        # Blank is the honest answer when nothing is certain.
        location['country'] = country_from_address(address)

    category = brand_data.get('category')
    if not category:
        category_text = ' '.join([
            brand_data.get('name') or '',
            brand_data.get('description') or '',
            brand_data.get('og', {}).get('title') or '',
            all_text[:5000],
        ]).lower()
        if re.search(r'\b(cafe|café|coffee shop|coffeehouse)\b', category_text):
            category = 'Cafe'
        elif re.search(r'\b(restaurant|eatery|dining)\b', category_text):
            category = 'Restaurant'
        elif re.search(r'\b(bar|pub|cocktail bar)\b', category_text):
            category = 'Bar'

    # Only validated profile links (no share buttons / widgets); first = most prominent.
    profiles = {}
    for platform, urls in clean_social_links(contact.get('social', {})).items():
        key = SOCIAL_KEY_MAP.get(platform, platform)
        if urls and (key in SOCIAL_SOURCES or key in REVIEW_SOURCES):
            profiles[key] = urls[0]

    validated = build_contact_block(brand_data)
    name = brand_data.get('name') or brand_slug(BASE_URL)
    aliases = []
    if category and category.casefold() not in name.casefold():
        aliases.append(f'{name} {category}')
    return {
        'name': name,
        'slug': brand_slug(BASE_URL),
        'city': location.get('city'),
        'region': location.get('region'),
        'country': location.get('country'),
        'category': category,
        'aliases': aliases,
        'website': BASE_URL,
        'profiles': profiles,
        'hints': {
            'address': validated['address'],
            'phones': validated['phones'],
            'emails': validated['emails'],
        },
    }


def write_social_targets(path, targets):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(targets, f, ensure_ascii=False, indent=2)
        f.write('\n')


# =========================================================================
# PART B — SOCIAL & REPUTATION CRAWLER
# (original crawler-social.py)
# =========================================================================
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
    output_root = os.path.join(OUTPUT_ROOT, "_social")   # set again in configure_run()
    group = BRAND_PACK_GROUP_NAME or "group"
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
            if not stream and not json_response:
                fix_response_encoding(resp)

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
               progress_js=None, wait_after_scroll=1400, wait_network_idle=False,
               idle_timeout=8000):
        """Render a URL and return a FetchResult (via='browser').

        scroll_selector may be:
          * a CSS selector  -> that element is scrolled to the bottom
          * "auto"          -> the largest scrollable container is scrolled
          * "js:<code>"     -> custom JS is evaluated between scroll ticks
        progress_js, when given, returns a comparable number used to stop
        scrolling once the page stops producing new content.
        wait_network_idle additionally waits for pending requests to settle,
        which client-rendered sites need before their images exist.
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
            if wait_network_idle:
                try:
                    page.wait_for_load_state("networkidle", timeout=idle_timeout)
                except Exception:
                    log("networkidle wait timed out", "debug")
                page.wait_for_timeout(600)
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
    def _locate(name):
        for candidate in (name, os.path.join(SCRIPT_DIR, name)):
            if os.path.exists(candidate):
                return candidate
        return name

    cookies_path, tokens_path = _locate(cookies_path), _locate(tokens_path)
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
    "x": re.compile(r"(?<![A-Za-z0-9-])(?:https?://)?(?:www\.|mobile\.)?(?:x|twitter)\.com/(?!i/|intent|share|home|hashtag|search)([A-Za-z0-9_]{2,15})(?:/|$)", re.I),
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
    if platform == "facebook" and handle.lower() == "profile.php":
        ids = up.parse_qs(up.urlparse(url if "://" in url else "https://" + url).query).get("id") or []
        return ids[0] if ids and ids[0].isdigit() else None
    if platform == "facebook" and handle.lower() in FB_NON_HANDLE:
        return None
    if platform == "youtube":
        handle = handle.replace("channel/", "")
    return handle or None


def canonical_social_url(platform, handle):
    if not handle:
        return None
    if platform == "youtube":
        # Channel ids are stable; everything else is a modern @handle. The old
        # template produced youtube.com/<name>, which 404s.
        if handle.startswith("UC") and len(handle) > 20:
            return f"https://www.youtube.com/channel/{handle}"
        return f"https://www.youtube.com/@{handle.lstrip('@')}"
    if platform == "facebook" and str(handle).isdigit():
        return f"https://www.facebook.com/profile.php?id={handle}"
    template = CANONICAL_URL.get(platform)
    return template.format(handle) if template else None


TRACKING_PARAMS = ("utm_source", "utm_medium", "utm_campaign", "utm_term",
                   "utm_content", "utm_id", "gclid", "fbclid", "igshid",
                   "ref_src", "ref_url", "si", "feature", "_ga", "mc_cid",
                   "mc_eid", "yclid", "msclkid", "trk", "trkCampaign")


def canonical_profile_url(platform, url):
    """Canonical form of a discovered/seed profile URL.

    Seeds were used verbatim, so a hand-typed `youtube.com/thecoffeejp` (a 404)
    or an `instagram.com/name/?hl=en&igshid=...` went straight to the connector.
    Social links are rebuilt from the handle; tracking params are dropped
    everywhere except where they carry identity (`?cid=` on Google Maps).
    """
    if not url:
        return url
    raw = str(url).strip()
    if not raw.lower().startswith(("http://", "https://")):
        if raw.startswith("www.") or "." in raw.split("/")[0]:
            raw = "https://" + raw.lstrip("/")
        else:
            return url
    parsed = up.urlparse(raw)
    if not parsed.netloc:
        return url

    if platform in SOCIAL_SOURCES:
        rebuilt = _canonical_social_path(platform, parsed)
        if rebuilt:
            return rebuilt

    keep = [(k, v) for k, v in up.parse_qsl(parsed.query, keep_blank_values=True)
            if k.lower() not in TRACKING_PARAMS]
    query = up.urlencode(keep)
    return up.urlunparse((parsed.scheme, parsed.netloc.lower(), parsed.path.rstrip("/") or "/",
                          "", query, ""))


YT_NON_PROFILE = {"watch", "results", "feed", "playlist", "shorts", "hashtag",
                  "about", "premium", "gaming", "music"}
LI_ENTITY_KINDS = ("in", "company", "school", "showcase")


def _canonical_social_path(platform, parsed):
    """Rebuild a social URL from its identity segment, or None to leave it alone.

    Legacy vanity paths (`youtube.com/c/Name`, `linkedin.com/school/x`) are kept
    as-is: converting them to `@handle`/`company` invents a URL that 404s.
    """
    segments = [s for s in parsed.path.split("/") if s]
    if not segments:
        return None
    first = segments[0]

    if platform == "youtube":
        if first.startswith("@"):
            return f"https://www.youtube.com/@{first[1:]}"
        if first.lower() in ("channel", "c", "user") and len(segments) > 1:
            return f"https://www.youtube.com/{first.lower()}/{segments[1]}"
        if first.lower() in YT_NON_PROFILE:
            return None
        return f"https://www.youtube.com/@{first}"

    if platform == "linkedin":
        if first.lower() in LI_ENTITY_KINDS and len(segments) > 1:
            return f"https://www.linkedin.com/{first.lower()}/{segments[1]}/"
        return None

    handle = handle_from_url(platform, up.urlunparse(parsed))
    if not handle:
        return None
    canonical = canonical_social_url(platform, handle)
    # Only trust a single-segment path: `/p/`, `/reel/`, `/explore/` are content.
    if platform in ("instagram", "tiktok", "threads") and len(segments) > 1:
        return None
    return canonical


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


def discover_from_website(business, max_pages=None):
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
    page_limit = max(1, int(max_pages or MAX_PAGES_WEBSITE))
    while queue and fetched < page_limit:
        url = queue.pop(0)
        key = url.rstrip("/").lower()
        if key in seen:
            continue
        seen.add(key)
        cached = cached_html_for(url)
        if cached and len(cached) >= 800 and not looks_like_js_shell(cached):
            # The website crawl already rendered this page; re-fetching would
            # return the JS shell and report "1 page crawled".
            page = FetchResult(True, 200, url, cached, {}, "cache")
        else:
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
        meta = extract_og_meta(soup)
        title = (meta.get("title") or "")[:160]
        result["pages"].append({"url": page.url, "title": title,
                                "schema": bool(schema.get("rating") or schema.get("address"))})
        if fetched == 1:
            result["facts"].update({k: v for k, v in schema.items() if k != "reviews"})
            result["facts"].setdefault(
                "name",
                (schema.get("name") or meta.get("og:site_name")
                 or meta.get("og:title") or meta.get("title") or "").strip(),
            )
            result["facts"].setdefault("description", meta.get("og:description") or meta.get("description") or "")
        else:
            for key_name, value in schema.items():
                if key_name in ("telephone", "email", "hours", "address", "geo",
                                "menu_url", "price_range") and value:
                    result["facts"].setdefault(key_name, value)

        # visible text of the page feeds email / phone / hours parsing. A store
        # locator is skipped: its numbers belong to franchisees, and feeding
        # them in reported six false NAP conflicts against the brand's own phone.
        is_directory = bool(DISCOVERY_PAGE_PATTERN.search(page.url.lower())) and any(
            word in page.url.lower()
            for word in ('onde-encontrar', 'loja', 'stores', 'franquia', 'revenda',
                         'distribuidor', 'localizacao', 'location', 'unidades'))
        try:
            if not is_directory:
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
            if DISCOVERY_PAGE_PATTERN.search(text) \
                    or DISCOVERY_PAGE_PATTERN.search(href.lower()):
                if href.rstrip("/").lower() not in seen and len(queue) < MAX_PAGES_WEBSITE * 2:
                    queue.append(href)

        # Embedded widgets. Booking and delivery are routinely an <iframe> from
        # the provider (ResDiary, SevenRooms, OpenTable …) rather than a link,
        # so scanning only <a href> reports "no online booking" for venues that
        # have had one for years.
        for frame in soup.find_all(["iframe", "embed"], src=True):
            src = abs_url(page.url, frame["src"])
            if not src or src.startswith("data:"):
                continue
            host = domain_of(src)
            if not host or same_host(src, site):
                continue
            external_hosts[host] += 1
            if src not in external_urls and len(external_urls) < 400:
                external_urls.append(src.split("#")[0])

    blob = "\n".join(text_blob_parts)
    result["facts"]["emails"] = find_emails(blob)
    result["facts"]["phones"] = find_phones(blob)
    result["external_urls"] = external_urls
    result["external_hosts"] = external_hosts.most_common(40)
    if not result["facts"].get("telephone") and result["facts"]["phones"]:
        result["facts"]["telephone"] = result["facts"]["phones"][0]
    # Validated NAP from the full website crawl fills any gap in this shallow pass.
    hints = business.get("hints") or {}
    if not result["facts"].get("emails") and hints.get("emails"):
        result["facts"]["emails"] = list(hints["emails"])
    if not result["facts"]["phones"] and hints.get("phones"):
        result["facts"]["phones"] = list(hints["phones"])
        result["facts"].setdefault("telephone", hints["phones"][0])
    if hints.get("address") and not result["facts"].get("address"):
        result["facts"]["address"] = {"full": hints["address"]}
    return result


def discover_profiles(business, max_pages=None):
    """Resolve platform profiles: seeds > website links > aggregators > search."""
    profiles = {}
    evidence = {}
    website_data = discover_from_website(business, max_pages=max_pages)
    links = website_data.get("links", {})

    for platform, entries in links.items():
        if platform in SOCIAL_SOURCES or platform in REVIEW_SOURCES:
            handles = [e for e in entries if e.get("handle")]
            if handles:
                profiles.setdefault(
                    platform,
                    canonical_profile_url(
                        platform,
                        canonical_social_url(platform, handles[0]["handle"])
                        if platform in SOCIAL_SOURCES else handles[0]["url"]))
                evidence[platform] = "website"
            elif entries:
                profiles.setdefault(platform, canonical_profile_url(platform, entries[0]["url"]))
                evidence[platform] = "website"

    schema_links = website_data.get("facts", {}).get("same_as") or []
    for url in schema_links:
        platform, handle = classify_url(url)
        if platform and platform not in profiles:
            profiles[platform] = canonical_profile_url(platform, url)
            evidence[platform] = "website-schema"

    # Seeds override discovered values (human-confirmed)
    for platform, url in (business.get("profiles") or {}).items():
        if url:
            profiles[platform] = canonical_profile_url(platform, url)
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
    return canonical_profile_url(platform, scored[0][1])



# =========================================================================
# 8b. BUSINESS SEARCH + TARGET DISCOVERY (for the studio intake UI)
# =========================================================================
JSON_MARKER = "@@CRAWLER_JSON@@"
PLATFORM_LABELS = {
    "instagram": "Instagram", "facebook": "Facebook", "tiktok": "TikTok",
    "youtube": "YouTube", "tripadvisor": "Tripadvisor", "google": "Google",
    "x": "X", "threads": "Threads", "linkedin": "LinkedIn",
}
DISCOVERY_PLATFORMS = ("instagram", "facebook", "tiktok", "tripadvisor", "google", "youtube")


def _clean_display(value):
    text = re.sub(r"[\ue000-\uf8ff]+", " ", str(value or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _http_url(value):
    value = (value or "").strip()
    if not value:
        return None
    if value.startswith("//"):
        value = "https:" + value
    if not re.match(r"^https?://", value, re.I):
        value = "https://" + value
    return value


def _domain(url):
    try:
        return (urlparse(url).hostname or "").lower().removeprefix("www.")
    except Exception:
        return ""


def _candidate_key(candidate):
    host = _domain(candidate.get("website") or "")
    if host:
        return host
    return normalize_text(f"{candidate.get('name','')} {candidate.get('address','')}")


def google_maps_search(query, city=""):
    """Resolve a business through Google Maps in a real browser (no API key)."""
    if not HAVE_PLAYWRIGHT:
        raise RuntimeError("Playwright is not installed; Maps search needs it.")
    search = query.strip()
    if city and city.lower() not in search.lower():
        search = f"{search} {city}".strip()
    url = "https://www.google.com/maps/search/" + up.quote_plus(search) + "/?hl=en&gl=gb"
    warnings = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--no-sandbox"])
        try:
            context = browser.new_context(
                locale="en-GB",
                user_agent=("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) "
                            "Chrome/131.0.0.0 Safari/537.36"),
            )
            page = context.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(4500)
            # A list view can appear for ambiguous queries; open the first place.
            if page.locator('[data-item-id="address"]').count() == 0:
                links = page.locator("a.hfpxzc")
                if links.count():
                    links.first.click()
                    page.wait_for_timeout(3500)
            name = ""
            if page.locator("h1").count():
                name = _clean_display(page.locator("h1").first.inner_text())
            address = ""
            if page.locator('[data-item-id="address"]').count():
                aria = page.locator('[data-item-id="address"]').first.get_attribute("aria-label") or ""
                address = _clean_display(re.sub(r"^Address:\s*", "", aria))
            phone = ""
            phone_loc = page.locator('[data-item-id^="phone:"]')
            if phone_loc.count():
                aria = phone_loc.first.get_attribute("aria-label") or ""
                phone = _clean_display(re.sub(r"^Phone:\s*", "", aria))
            website = ""
            web_loc = page.locator('a[data-item-id="authority"]')
            if web_loc.count():
                website = web_loc.first.get_attribute("href") or ""
            category = ""
            if page.locator('button[jsaction*="category"]').count():
                category = _clean_display(page.locator('button[jsaction*="category"]').first.inner_text())
            rating = None
            reviews = None
            stars = page.locator('span[aria-label*="stars"]')
            for index in range(min(stars.count(), 6)):
                label = stars.nth(index).get_attribute("aria-label") or ""
                match = re.match(r"\s*([\d.]+)\s+stars?", label, re.I)
                if match:
                    rating = float(match.group(1))
                    break
            body_text = ""
            try:
                body_text = page.locator("body").inner_text()
            except Exception:
                pass
            match = re.search(r"\(([\d,]+)\)", body_text)
            if match:
                reviews = int(match.group(1).replace(",", ""))
            hours = ""
            hours_match = re.search(r"((?:Open|Closed)[^\n|]{0,80})", body_text)
            if hours_match:
                hours = _clean_display(hours_match.group(1))
            place_url = page.url
        finally:
            browser.close()

    if not name:
        raise RuntimeError("Google Maps returned no place for that search.")
    if not website:
        warnings.append("The Google Maps listing has no website.")
    candidate = {
        "name": name, "website": _http_url(website) or "",
        "address": address, "phone": phone, "category": category,
        "rating": rating, "reviews": reviews, "hours": hours,
        "placeUrl": place_url, "source": "google-maps", "confidence": 0.95,
    }
    return candidate, warnings


def nominatim_search(query, city="", limit=5):
    """Free OpenStreetMap fallback: name + address, sometimes a website tag."""
    search = " ".join(part for part in (query, city) if part)
    headers = {"User-Agent": "studio-layers-crawler/1.0 (internal brand research)"}
    response = requests.get(
        "https://nominatim.openstreetmap.org/search",
        params={"q": search, "format": "jsonv2", "addressdetails": "1",
                "extratags": "1", "limit": str(limit)},
        headers=headers, timeout=25,
    )
    response.raise_for_status()
    out = []
    for item in response.json() or []:
        tags = item.get("extratags") or {}
        display = _clean_display(item.get("display_name"))
        name = _clean_display(item.get("name") or display.split(",")[0])
        website = tags.get("website") or tags.get("contact:website") or ""
        phone = tags.get("phone") or tags.get("contact:phone") or ""
        category = _clean_display(tags.get("amenity") or item.get("type") or "")
        out.append({
            "name": name, "website": _http_url(website) or "",
            "address": display, "phone": phone, "category": category.title() if category else "",
            "rating": None, "reviews": None, "hours": tags.get("opening_hours") or "",
            "placeUrl": f"https://www.openstreetmap.org/{item.get('osm_type','node')}/{item.get('osm_id','')}",
            "source": "nominatim", "confidence": 0.6,
        })
    return out


def places_api_search(query, city="", limit=5):
    key = os.environ.get("GOOGLE_PLACES_API_KEY") or State.tokens.get("google_places_api_key")
    if not key:
        return []
    response = requests.post(
        "https://places.googleapis.com/v1/places:searchText",
        headers={
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": ("places.displayName,places.websiteUri,places.formattedAddress,"
                                 "places.nationalPhoneNumber,places.primaryTypeDisplayName,"
                                 "places.rating,places.userRatingCount,places.googleMapsUri"),
        },
        json={"textQuery": " ".join(part for part in (query, city) if part), "pageSize": limit},
        timeout=25,
    )
    response.raise_for_status()
    out = []
    for place in (response.json().get("places") or []):
        out.append({
            "name": _clean_display((place.get("displayName") or {}).get("text")),
            "website": place.get("websiteUri") or "",
            "address": _clean_display(place.get("formattedAddress")),
            "phone": _clean_display(place.get("nationalPhoneNumber")),
            "category": _clean_display((place.get("primaryTypeDisplayName") or {}).get("text")),
            "rating": place.get("rating"), "reviews": place.get("userRatingCount"),
            "hours": "", "placeUrl": place.get("googleMapsUri") or "",
            "source": "google-places", "confidence": 0.98,
        })
    return out


def web_search_candidates(query, city="", limit=6):
    """Last-resort candidates from the existing Bing/DDG web_search helper."""
    results = web_search(" ".join(part for part in (query, city) if part), count=max(limit * 2, 8))
    tokens = [t for t in normalize_text(query).split() if len(t) > 2]
    out = []
    for item in results:
        url = item.get("url") or ""
        platform, _handle = classify_url(url)
        if platform in SOCIAL_SOURCES or platform in REVIEW_SOURCES:
            continue
        if not _http_url(url):
            continue
        haystack = normalize_text(f"{item.get('title','')} {url}")
        if tokens and not any(token in haystack for token in tokens):
            continue
        out.append({
            "name": _clean_display(re.sub(r"\s*[|–—]\s*.*$", "", item.get("title") or "") or query),
            "website": url, "address": "", "phone": "", "category": "",
            "rating": None, "reviews": None, "hours": "",
            "placeUrl": url, "source": "web-search", "confidence": 0.45,
        })
        if len(out) >= limit:
            break
    return out


def search_businesses(query, city="", limit=6, provider="auto"):
    """Search by business name and return ranked, deduplicated candidates."""
    query = (query or "").strip()
    if len(query) < 2:
        raise ValueError("Enter at least two characters of the business name.")
    warnings = []
    candidates = []
    provider = (provider or "auto").lower()

    if provider in ("auto", "places"):
        try:
            candidates = places_api_search(query, city, limit)
        except Exception as exc:
            warnings.append(f"Google Places search failed: {exc}")
    if not candidates and provider in ("auto", "maps"):
        try:
            candidate, map_warnings = google_maps_search(query, city)
            candidates = [candidate]
            warnings.extend(map_warnings)
        except Exception as exc:
            warnings.append(f"Google Maps search failed: {exc}")
    if not candidates and provider in ("auto", "nominatim"):
        try:
            candidates = nominatim_search(query, city, limit)
            if candidates:
                warnings.append("Using OpenStreetMap: some listings have no website.")
        except Exception as exc:
            warnings.append(f"OpenStreetMap search failed: {exc}")
    if not candidates and provider in ("auto", "web"):
        try:
            candidates = web_search_candidates(query, city, limit)
        except Exception as exc:
            warnings.append(f"Web search failed: {exc}")

    deduped = []
    seen = set()
    for candidate in candidates:
        key = _candidate_key(candidate)
        if not key or key in seen:
            continue
        seen.add(key)
        if not candidate.get("website"):
            candidate["warnings"] = ["No website found; enter it manually to continue."]
        deduped.append(candidate)
    if not deduped:
        raise RuntimeError("No business found. Try adding the town/city, or paste the website URL.")
    return {
        "ok": True, "query": query, "city": city,
        "provider": deduped[0].get("source", "web-search"),
        "candidates": deduped[:limit], "warnings": warnings,
    }


def country_from_address(address):
    """Best-effort country for a postal address string, or '' when unknown.

    Only the last address component (the country slot) and explicit country
    names are trusted; a city mention alone is weaker evidence and is used
    only when nothing better exists.
    """
    if isinstance(address, dict):
        address = " ".join(str(address.get(key) or "") for key in
                          ("full", "line", "streetAddress", "addressLocality",
                           "addressRegion", "postalCode", "addressCountry"))
    raw = _clean_display(address) if address else ""
    if not raw:
        return ""
    # Split before de-accenting: normalize_text turns commas into spaces.
    parts = [p.strip() for p in re.split(r'[,;]', raw) if p.strip()]
    tail = normalize_text(parts[-1]) if parts else normalize_text(raw)

    def hint_forms(hints):
        # normalize_text drops non-Latin scripts, and an empty hint matches
        # everything (an address ending in "- TO" once resolved to Greece
        # through its Greek-script hint). Never compare against an empty form.
        return [h for h in (normalize_text(hint) for hint in hints) if h]

    if re.search(r'\bcep\b', raw, re.I) and re.search(r'\b\d{5}-?\d{3}\b', raw):
        return 'Brazil'

    for country, hints in COUNTRY_HINTS:
        if any(hint == tail for hint in hint_forms(hints)):
            return country
    text = normalize_text(raw)
    for country, hints in COUNTRY_HINTS:
        if any(re.search(r'\b' + re.escape(hint) + r'\b', text)
               for hint in hint_forms(hints)):
            return country
    return ""


def resolve_target_country(business):
    """Country for a saved target, preferring postal evidence over the label.

    A targets.json written by an older build may still say "United Kingdom"
    for a Lisbon venue, so the address (and the intake hint) win when they
    disagree.
    """
    hints = business.get("hints") or {}
    derived = country_from_address(business.get("address") or hints.get("address") or "")
    declared = clean_text(business.get("country") or "", 80)
    return derived or declared


def _address_city(address):
    if not address:
        return ""
    match = re.search(r",\s*([A-Za-z .'\-]+?)\s+(?:[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|[A-Z]{1,2}\d)", address)
    if match:
        return match.group(1).strip()
    for city in KNOWN_CITIES:
        if re.search(r"\b" + re.escape(city) + r"\b", address, re.I):
            return city
    parts = [part.strip() for part in address.split(",") if part.strip()]
    return parts[-1] if parts else ""


def _contact_address(value):
    if isinstance(value, dict):
        return _clean_display(value.get("full") or ", ".join(
            str(value.get(key) or "") for key in ("streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry")
            if value.get(key)
        ))
    return _clean_display(value)


def _canonical_profile(platform, url):
    return canonical_profile_url(platform, _http_url(url))


def build_discovery(website, name="", city="", category="", region="", country="",
                    profiles=None, maps=None, guess_profiles=False, search_profiles=False,
                    max_pages=8):
    """Shallow website + profile discovery, with an explicit status per platform."""
    website = _http_url(website)
    if not website:
        raise ValueError("A website URL is required.")
    maps = maps or {}
    seeds = {}
    for platform, url in (profiles or {}).items():
        if url:
            seeds[platform] = url
    business = {
        "name": name or maps.get("name") or _domain(website),
        "website": website,
        "city": city or maps.get("address") or "",
        "category": category or maps.get("category") or "",
        "profiles": seeds,
    }
    discovery = discover_profiles(business, max_pages=max_pages)
    website_data = discovery.get("website") or {}
    facts = website_data.get("facts") or {}
    warnings = list(website_data.get("warnings") or [])

    business_name = _clean_display(name or maps.get("name") or facts.get("name") or business["name"])
    address = _clean_display(maps.get("address") or _contact_address(facts.get("address")))
    phones = [_clean_display(p) for p in (facts.get("phones") or []) if p]
    if facts.get("telephone") and facts["telephone"] not in phones:
        phones.insert(0, _clean_display(facts["telephone"]))
    if maps.get("phone") and maps["phone"] not in phones:
        phones.insert(0, _clean_display(maps["phone"]))
    emails = sorted({str(e).strip() for e in (facts.get("emails") or []) if e})
    resolved_city = city or maps.get("city") or _address_city(address)
    resolved_category = category or maps.get("category") or facts.get("category") or ""
    resolved_region = region or ("Scotland" if resolved_city == "St Andrews" else "")
    resolved_country = country or country_from_address(address) or (
        "United Kingdom"
        if re.search(r"\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b", address)
        else ""
    )

    profiles_found = {}
    evidence = dict(discovery.get("evidence") or {})
    platform_rows = []
    for platform in DISCOVERY_PLATFORMS:
        label = PLATFORM_LABELS.get(platform, platform)
        url = _canonical_profile(platform, (discovery.get("profiles") or {}).get(platform))
        source = evidence.get(platform) or ""
        reason = ""
        status = "missing"
        metrics = {}

        if platform == "google" and maps.get("rating") is not None:
            url = maps.get("placeUrl") or url
            status = "found"
            source = "google-maps"
            metrics = {"rating": maps.get("rating"), "reviews": maps.get("reviews")}
            reason = "Rating and review count found on Google Maps."
        elif url:
            status = "found"
            reason = {
                "seed": "Confirmed profile URL.",
                "website": "Linked from the website.",
                "website-schema": "Declared in the website structured data.",
                "guessed": "Handle verified from the business name.",
                "search": "Found through a profile search.",
            }.get(source, "Found.")
        else:
            if not website_data.get("website"):
                reason = "The website could not be fetched."
            elif platform == "google":
                reason = "Collected during the full social run."
                status = "not_checked"
            else:
                reason = f"No {label} link on the website."
            if guess_profiles and platform in ("instagram", "facebook", "tiktok"):
                try:
                    guessed = discover_by_handle_guess(business, platform)
                except Exception:
                    guessed = None
                if guessed:
                    url = _canonical_profile(platform, guessed)
                    status = "found"
                    source = "guessed"
                    reason = "Handle verified from the business name."
            if not url and search_profiles:
                try:
                    found = search_for_profile(business, platform)
                except Exception as exc:
                    warnings.append(f"{label} search failed: {exc}")
                    found = None
                if found:
                    url = _canonical_profile(platform, found)
                    status = "found"
                    source = "search"
                    reason = "Found through a profile search."
            if not url and status == "missing" and search_profiles:
                reason = f"No {label} link on the website and no matching profile in search."

        row = {
            "key": platform, "label": label, "status": status,
            "url": url or "", "evidence": source, "reason": reason,
            "metrics": metrics,
        }
        platform_rows.append(row)
        if url:
            profiles_found[platform] = url

    target = {
        "name": business_name,
        "slug": brand_slug(website),
        "city": resolved_city,
        "region": resolved_region,
        "country": resolved_country,
        "category": resolved_category,
        "aliases": [],
        "website": website_data.get("website") or website,
        "profiles": profiles_found,
        "hints": {"address": address, "phones": phones, "emails": emails},
    }
    found = [row for row in platform_rows if row["status"] == "found"]
    return {
        "ok": True,
        "business": {
            "name": business_name,
            "website": target["website"],
            "address": address,
            "city": resolved_city,
            "region": resolved_region,
            "country": resolved_country,
            "category": resolved_category,
            "phone": phones[0] if phones else "",
            "emails": emails,
            "rating": maps.get("rating"),
            "reviews": maps.get("reviews"),
        },
        "platforms": platform_rows,
        "profiles": profiles_found,
        "target": target,
        "website": {
            "pages": (website_data.get("pages") or [])[:12],
            "warnings": warnings[:8],
        },
        "summary": {
            "found": len(found),
            "missing": len([row for row in platform_rows if row["status"] == "missing"]),
            "notChecked": len([row for row in platform_rows if row["status"] == "not_checked"]),
        },
        "warnings": warnings[:8],
    }


def crawler_status():
    import platform as _platform
    return {
        "ok": True,
        "python": _platform.python_version(),
        "executable": sys.executable,
        "venv": sys.prefix != getattr(sys, "base_prefix", sys.prefix),
        "script": os.path.abspath(__file__),
        "schema": SCHEMA_VERSION,
        "playwright": HAVE_PLAYWRIGHT,
        "pillow": HAVE_PIL,
        "pdftotext": bool(shutil.which("pdftotext")),
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "keys": {
            "google_places": bool(os.environ.get("GOOGLE_PLACES_API_KEY")),
            "serpapi": bool(os.environ.get("SERPAPI_KEY")),
            "facebook": bool(os.environ.get("FB_GRAPH_TOKEN")),
            "tiktok": bool(os.environ.get("TIKTOK_RESEARCH_TOKEN")),
        },
        "output_root": OUTPUT_ROOT,
    }


def load_json_arg(value, default=None):
    if not value:
        return default if default is not None else {}
    if os.path.isfile(value):
        with open(value, encoding="utf-8") as handle:
            return json.load(handle)
    return json.loads(value)


def emit_json(payload):
    print(JSON_MARKER + json.dumps(payload, ensure_ascii=False))


def json_mode(fn):
    buffer = io.StringIO()
    try:
        with contextlib.redirect_stdout(buffer):
            payload = fn()
        emit_json(payload)
        return 0 if payload.get("ok", True) else 1
    except Exception as exc:
        emit_json({"ok": False, "error": str(exc),
                   "log": buffer.getvalue().strip().splitlines()[-8:]})
        return 1


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
        self.dropped_seeds = {}
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
        return resolve_target_country(self.business)

    @property
    def is_uk(self):
        return normalize_text(self.country) in tuple(
            normalize_text(name) for name in UK_COUNTRY_NAMES)

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
        # NB: the Places API (New) rejects places.servesCuisine in a field mask
        # ("Cannot find matching fields"); requesting it fails the whole lookup.
        "places.takeout", "places.delivery",
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


def _serpapi_reviews(data_id=None, limit=20, language="en", place_id=None):
    """Collect Google reviews through SerpAPI within a small search budget.

    SerpAPI accepts either the Maps `data_id` (0x…:0x…) or a Places
    `place_id`; the Places path only has the latter. When pagination is not
    offered (the Free Plan returns 5 reviews per request), the remaining
    budget is spent on other sort orders and review topics, which surface
    different reviews and therefore more unique evidence.
    """
    token = State.tokens.get("serpapi_key")
    if not token or not (data_id or place_id):
        return [], 0
    collected = []
    seen = set()
    calls = 0
    topics = []
    page_token = None

    def record(batch):
        for item in batch:
            user = item.get("user") or {}
            text = clean_text(item.get("snippet")
                              or item.get("extracted_snippet", {}).get("original"))
            key = (item.get("review_id") or item.get("link")
                   or (normalize_text(user.get("name")) + normalize_text(text)[:60]))
            if key in seen:
                continue
            seen.add(key)
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
                "text": text,
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

    def query(extra=None):
        nonlocal calls
        calls += 1
        params = {"engine": "google_maps_reviews",
                  "hl": language,
                  "num": max(1, min(20, limit)),
                  "api_key": token}
        if place_id:
            params["place_id"] = place_id
        else:
            params["data_id"] = data_id
        params.update(extra or {})
        payload = fetch("https://serpapi.com/search.json", platform="google",
                        json_response=True, use_cache=False, params=params)
        if not payload.ok:
            log(f"serpapi reviews failed: {blocked_reason(payload)}", "debug")
            return None
        try:
            data = json.loads(payload.text)
        except ValueError:
            return None
        if data.get("error"):
            log(f"serpapi error: {data['error']}", "warn")
            return None
        return data

    data = query({"sort_by": "newestFirst"})
    if not data:
        return [], calls
    topics = data.get("topics") or []
    record(data.get("reviews") or [])
    page_token = (data.get("serpapi_pagination") or {}).get("next_page_token")

    # Paid plans paginate. Follow the token while it lasts.
    pages = 1
    while page_token and len(collected) < limit and pages < 20:
        data = query({"sort_by": "newestFirst", "next_page_token": page_token})
        if not data:
            break
        record(data.get("reviews") or [])
        page_token = (data.get("serpapi_pagination") or {}).get("next_page_token")
        pages += 1

    # No pagination: spend a small budget on sorts/topics to find more unique
    # reviews. Keep this proportional to the requested depth.
    if len(collected) < limit and not page_token:
        budget = min(12, max(4, int((limit + 3) / 4)))
        for sort in ("qualityScore", "ratingHigh", "ratingLow"):
            if len(collected) >= limit or calls >= budget:
                break
            data = query({"sort_by": sort})
            if data:
                record(data.get("reviews") or [])
        for topic in topics:
            if len(collected) >= limit or calls >= budget:
                break
            topic_id = topic.get("id")
            if not topic_id:
                continue
            data = query({"topic_id": topic_id})
            if data:
                record(data.get("reviews") or [])

    log(f"serpapi: {len(collected)} unique reviews from {calls} search(es)")
    return collected[:limit], calls

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
        if (State.max_reviews > len(result["reviews"])
                and State.tokens.get("serpapi_key")
                and result["metrics"].get("place_id")):
            bulk, serp_calls = _serpapi_reviews(limit=State.max_reviews,
                                               place_id=result["metrics"]["place_id"])
            if serp_calls:
                result["metrics"]["serpapi_searches"] = serp_calls
            if bulk:
                merged, seen_ids = [], set()
                before = len(result["reviews"])
                for review in bulk + list(result["reviews"]):
                    key = (review.get("review_id")
                           or (normalize_text(review.get("author"))
                               + normalize_text(review.get("text"))[:60]))
                    if key in seen_ids:
                        continue
                    seen_ids.add(key)
                    merged.append(review)
                result["reviews"] = merged[: State.max_reviews]
                result["mode"] = "places-api+serpapi"
                result["metrics"]["reviews_from_serpapi"] = max(0, len(result["reviews"]) - before)
        if len(result["reviews"]) < State.max_reviews:
            if State.tokens.get("serpapi_key"):
                added = result["metrics"].get("reviews_from_serpapi", 0)
                searches = result["metrics"].get("serpapi_searches", 0)
                result["warnings"].append(
                    f"Readable Google reviews: {len(result['reviews'])}; "
                    f"SerpAPI used {searches} search(es) and added {added} unique "
                    "review(s). The current plan returns 5 reviews per request; "
                    "a paid plan can paginate further if more coverage is needed.")
            else:
                result["warnings"].append(
                    "Places API caps reviews at 5 per place; add SERPAPI_KEY for more.")
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
        bulk, serp_calls = _serpapi_reviews(data_id=data_id, limit=State.max_reviews)
        if serp_calls:
            result["metrics"]["serpapi_searches"] = serp_calls
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
    city_slug = slugify(ctx.city)
    name_slug = slugify(ctx.name)
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
    country_text = normalize_text(getattr(ctx, "country", "") or "")
    if not country_text:
        result["warnings"].append("country unknown — skipped UK food-hygiene lookup")
        return finalize(result)
    if country_text not in tuple(normalize_text(name) for name in UK_COUNTRY_NAMES):
        # Expected for non-UK venues; not a defect worth flagging in the report.
        result["metrics"]["skipped_reason"] = "not a UK establishment"
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
    if score < 0.55:
        # Never publish an authoritative-looking ratings URL for a guess.
        result["warnings"].append(
            f"weak name match (score {score}) — please confirm manually")
        result["metrics"]["match_score"] = score
        return finalize(result)
    result["url"] = (f"https://ratings.food.gov.uk/business/en-GB/"
                     f"{best.get('FHRSID')}")
    result["mode"] = "fsa-api"

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
        "collected_raw": len(all_reviews),
        "duplicates_merged": len(all_reviews) - len(unique_reviews),
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
        if source not in results:
            continue
        data = results.get(source) or {}
        profile = data.get("profile") or {}
        # `ok` only means the fetch worked; a shell page with no identity fields is
        # not presence. Require at least one real profile field (or fetched posts).
        identity_fields = ("handle", "name", "followers", "bio", "profile_pic_url",
                           "external_url", "id", "likes", "checkins")
        present = any(profile.get(field) for field in identity_fields) or bool(
            data.get("posts") or data.get("videos"))
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

    confirmed = {row["source"] for row in matrix if row["present"]}
    # A gap is a platform we actually tried (had a URL for) but could not confirm.
    # Platforms never discovered are reported separately — "no YouTube" is not a
    # defect when nobody ever found a channel.
    gaps = sorted(source for source in results
                  if source in SOCIAL_SOURCES and source not in confirmed)
    not_discovered = [source for source in ("instagram", "facebook", "tiktok", "youtube")
                      if source not in results]

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
        "not_discovered": not_discovered,
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

    # A single wrong country used to pass silently because consistency only
    # counted address/phone/website clusters. Compare declared vs derived.
    seen_countries = {country_from_address(form) for form in addresses}
    seen_countries.add(country_from_address(business.get("address") or ""))
    seen_countries.discard("")
    declared_country = clean_text(business.get("country") or "")
    if len(seen_countries) > 1:
        conflicts.append({"field": "country",
                          "variants": sorted(seen_countries)})
    elif declared_country and seen_countries and declared_country not in seen_countries:
        conflicts.append({"field": "country",
                          "variants": [declared_country, *sorted(seen_countries)]})

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
        weaknesses.append("Profile found but not readable: " + ", ".join(social["gaps"]))
    if social.get("stale_platforms"):
        weaknesses.append("Stale profiles: " + ", ".join(social["stale_platforms"]))
    if identity.get("conflicts"):
        fields = ", ".join(c["field"] for c in identity["conflicts"])
        weaknesses.append(f"Inconsistent NAP data across sources ({fields})")

    if not web.get("has_online_booking"):
        opportunities.append("Add online booking (OpenTable/ResDiary/SevenRooms) "
                             "to capture direct demand")
    if social.get("not_discovered"):
        opportunities.append("No profile found on " + ", ".join(social["not_discovered"]) +
                             " — seed UGC reposts and short-form video there")
    if social.get("gaps"):
        opportunities.append("Profiles exist but are unreadable on "
                             + ", ".join(social["gaps"]) +
                             " — re-check handle/URL or connect the platform API")
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
def drop_offshore_results(ctx):
    """Discard persisted UK-only results when the venue is not in the UK.

    `--report-only` reuses saved platform JSON, so a run made before the
    country fix would still publish an FSA hygiene rating for, say, a Lisbon
    cafe. The country is checked here again, at read time.
    """
    country = normalize_text(getattr(ctx, "country", "") or "")
    if not country or country in UK_COUNTRY_NAMES:
        return
    for source in ("food_hygiene",):
        result = (ctx.results or {}).get(source) or {}
        if not (result.get("url") or result.get("compliance")):
            continue
        dropped = new_result(source, None, result.get("mode"))
        dropped["metrics"]["skipped_reason"] = (
            f"UK-only source dropped — venue is in {ctx.country}")
        ctx.results[source] = dropped


def assemble_profile(ctx, assets):
    drop_offshore_results(ctx)
    results = ctx.results
    reviews = aggregate_reviews(results)
    social = analyze_social(results)
    identity = reconcile_identity(results, ctx.business)
    # A confirmed intake target wins over the majority vote. Group sites often
    # repeat another venue's address in a footer, so the website alone can
    # resolve to the wrong NAP.
    hints = ctx.business.get("hints") or {}
    if hints.get("address"):
        identity["canonical"]["address"] = hints["address"]
        if hints["address"] not in identity.get("addresses_seen", []):
            identity.setdefault("addresses_seen", []).insert(0, hints["address"])
    if hints.get("phones"):
        identity["canonical"]["phone"] = hints["phones"][0]
    if hints.get("emails"):
        merged = list(hints["emails"]) + [e for e in identity["canonical"].get("emails", [])
                                          if e not in hints["emails"]]
        identity["canonical"]["emails"] = merged[:6]
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
            "reviews": reviews["reviews"],
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
            "dropped_seeds": getattr(ctx, "dropped_seeds", {}) or {},
            "sources": {source: {"mode": data.get("mode"), "url": data.get("url"),
                                 "ok": data.get("ok"),
                                 "reviews": len(data.get("reviews") or []),
                                 "rating": (data.get("rating") or {}).get("value"),
                                 "count": (data.get("rating") or {}).get("count"),
                                 # A skipped source was never applicable (e.g. the
                                 # UK hygiene register for a Lisbon venue), so it
                                 # must not be reported as a discovery gap.
                                 "skipped": bool(
                                     (data.get("metrics") or {}).get("skipped_reason")),
                                 "warnings": (data.get("warnings") or []) + (
                                     [(data.get("metrics") or {})["skipped_reason"]]
                                     if (data.get("metrics") or {}).get("skipped_reason")
                                     else [])}
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
         ["Reviews analysed in detail", format_number(rep["collected_reviews"]) + (
              f" ({format_number(rep['duplicates_merged'])} duplicates merged from "
              f"{format_number(rep['collected_raw'])})"
              if rep.get("duplicates_merged") else "")],
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
        lines.append(f"- **Found but unreadable:** {', '.join(social['gaps'])}")
    if social.get("not_discovered"):
        lines.append(f"- **Not discovered:** {', '.join(social['not_discovered'])}")
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
    not_found = []
    for source, entry in (profile["provenance"]["sources"] or {}).items():
        # Only sources actually consulted belong in the provenance table. A
        # source with no URL and no data was never reached: listing it as a row
        # reads like a platform gap nobody verified.
        if not entry.get("ok") and not entry.get("url") and not entry.get("skipped"):
            not_found.append(source)
            continue
        rows.append([source, entry.get("mode") or "—", entry.get("url") or "—",
                     format_number(entry.get("rating")), format_number(entry.get("count")),
                     entry.get("reviews"), "; ".join(entry.get("warnings") or [])[:120] or "—"])
    lines.append(md_table(["Source", "Mode", "URL", "Rating", "Count", "Pulled", "Warnings"], rows))
    lines.append("")
    if not_found:
        lines.append(f"_Searched, no profile URL discovered ({len(not_found)}): "
                     f"{', '.join(sorted(not_found))}. These are discovery gaps, not platform gaps._")
        lines.append("")
    dropped = (profile.get("provenance") or {}).get("dropped_seeds") or {}
    if dropped:
        lines.append("_Seed URLs rejected before the social phase (no connector run):_")
        for source, entry in sorted(dropped.items()):
            lines.append(f"- `{source}` {entry.get('url')} — {entry.get('reason')}")
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
    if social.get("gaps"):
        parts.append(f'<p class="small">Found but unreadable: {esc(", ".join(social["gaps"]))}</p>')
    if social.get("not_discovered"):
        parts.append(f'<p class="small">Not discovered: '
                     f'{esc(", ".join(social["not_discovered"]))}</p>')

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
    provenance = profile["provenance"]["sources"] or {}
    not_found = sorted(source for source, entry in provenance.items()
                       if not entry.get("ok") and not entry.get("url")
                       and not entry.get("skipped"))
    for source, entry in provenance.items():
        if not entry.get("ok") and not entry.get("url") and not entry.get("skipped"):
            continue
        note = "; ".join(entry.get("warnings") or [])[:200] or "ok"
        parts.append(f'<tr><td>{esc(source)}</td><td class="small">{esc(entry.get("mode") or "—")}</td>'
                     f'<td>{entry.get("reviews") or 0}</td><td class="small">{esc(note)}</td></tr>')
    parts.append('</tbody></table>')
    if not_found:
        parts.append(f'<p class="small">Searched, no profile URL discovered ({len(not_found)}): '
                     f'{esc(", ".join(not_found))} — discovery gaps, not platform gaps.</p>')
    dropped = (profile.get("provenance") or {}).get("dropped_seeds") or {}
    if dropped:
        parts.append('<p class="small">Seed URLs rejected before the social phase: '
                     + esc("; ".join(f"{source} {entry.get('url')} ({entry.get('reason')})"
                                     for source, entry in sorted(dropped.items())))
                     + '</p>')
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


DISCOVERY_LEDGER = "_discovery.json"

# A search-results URL is where a connector *looked*, not a profile it found.
SEARCH_URL_MARKERS = ("bing.com/search", "google.com/search", "duckduckgo.com/html",
                      "search.yahoo.com", "search.brave.com")


def _is_search_url(url):
    text = str(url or "").lower()
    return any(marker in text for marker in SEARCH_URL_MARKERS)


def _has_platform_evidence(data):
    """True when a connector returned something, not just a 'nothing found' shell.

    `ok: false` with no URL means profile discovery did not locate the venue on
    that platform. That is a gap in *discovery*, not evidence about the
    platform, and it must not become a `platforms/<source>.json` file. A URL
    only counts when it points at a profile — a search-results URL does not.
    """
    if not isinstance(data, dict):
        return False
    if data.get("ok"):
        return True
    if data.get("url") and not _is_search_url(data.get("url")):
        return True
    for key in ("business", "reviews", "rating", "posts", "profile"):
        value = data.get(key)
        if isinstance(value, (list, tuple)) and len(value):
            return True
        if isinstance(value, dict) and any(v for v in value.values()):
            return True
        if isinstance(value, (int, float)) and value:
            return True
    return False


def _record_discovery_miss(ctx, source, data):
    """Keep the *fact* that a source was looked for, without faking a platform."""
    path = os.path.join(ctx.platforms_dir, DISCOVERY_LEDGER)
    ledger = read_json(path, {}) or {}
    if not isinstance(ledger, dict):
        ledger = {}
    ledger = {k: v for k, v in ledger.items() if not str(k).startswith("_")}
    ledger[source] = {
        "url": (data or {}).get("url"),
        "mode": (data or {}).get("mode"),
        "checked_at": (data or {}).get("fetched_at") or iso_now(),
        "warnings": (data or {}).get("warnings") or [],
        "status": "not_found",
    }
    ledger["_note"] = ("Sources listed here were searched but no profile URL was "
                       "discovered. They are not platforms and must not be counted "
                       "as a platform gap.")
    write_json(path, ledger)
    stale = os.path.join(ctx.platforms_dir, f"{source}.json")
    if os.path.exists(stale):
        try:
            os.remove(stale)
        except OSError:
            pass


def _save_source_output(ctx, source, data):
    try:
        if not _has_platform_evidence(data):
            _record_discovery_miss(ctx, source, data)
            log(f"{source}: no profile discovered — recorded in {DISCOVERY_LEDGER}", "debug")
            return
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


def _seed_probe_candidates(profiles, evidence):
    """Seeds worth validating: an explicit URL for a source we know how to read."""
    for source, url in sorted(profiles.items()):
        if source not in SOCIAL_SOURCES or not url:
            continue
        if evidence.get(source) not in ("seed", "website", "website-schema",
                                        "search", "handle-guess", "maps-search"):
            continue
        if not str(url).lower().startswith("http"):
            continue
        yield source, url


def drop_dead_seeds(profiles, evidence):
    """Remove profile URLs that hard-404 so no connector is wasted on them.

    The reviewed run seeded `youtube.com/thecoffeejp`, fetched it once in
    discovery, got 404, and still ran the YouTube connector (another 404,
    reported as an empty platform). One probe here turns that into a warning.
    """
    dropped = {}
    for source, url in list(_seed_probe_candidates(profiles, evidence)):
        try:
            page = fetch(url, platform=source)
        except Exception as exc:
            log(f"discovery: {source} seed probe failed: {exc}", "debug")
            continue
        if page.status in (404, 410):
            dropped[source] = {"url": url, "reason": blocked_reason(page)}
            profiles.pop(source, None)
            evidence.pop(source, None)
            log(f"discovery: dropped {source} — {url} ({blocked_reason(page)})", "warn")
    return dropped


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
        gl_country = resolve_target_country(business)
        hl, gl = COUNTRY_LOCALE.get(gl_country, ("en", "gb"))
        profiles["google"] = ("https://www.google.com/maps/search/"
                              + up.quote(f"{business['name']} {business.get('city') or ''}".strip())
                              + f"?hl={hl}&gl={gl}")
        evidence["google"] = "maps-search"

    ctx = BizContext(business, {"profiles": profiles, "evidence": evidence,
                                "website": discovery.get("website") or {}}, out_dir)
    ctx.log_file = State.log_file
    ctx.dropped_seeds = drop_dead_seeds(profiles, evidence)

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
            if not name.endswith(".json") or name.startswith("_"):
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
    write_json(os.path.join(out_dir, "social-profile.json"),
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
        if not name.endswith(".json") or name.startswith("_"):
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
    ctx.country = resolve_target_country(business)
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
    write_json(os.path.join(out_dir, "social-profile.json"),
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


def write_group_report(summaries, profiles, out_dir=None):
    if not profiles:
        return
    group_dir = out_dir or State.output_root
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
# PART C — PIPELINE: website crawl -> social crawl -> one consolidated pack
# =========================================================================
PARALLEL = True
FORCE_REFRESH = False
MERGE_PREVIOUS_RUNS = True

# Files copied from the social working dir into <brand>/social/
SOCIAL_DELIVERABLES = (
    "business.profile.json", "social.json", "social-profile.json",
    "reviews.all.json", "reviews.csv", "insights.md", "report.html",
)


# ---------------------------------------------------------------------------
# targets: website crawl -> social crawl hand-off
# ---------------------------------------------------------------------------
def host_key(url):
    host = urlparse(url or "").netloc.lower()
    return host[4:] if host.startswith("www.") else host


def find_override(url):
    """Hand-confirmed TARGET_OVERRIDES entry for this site (matched by host)."""
    key = host_key(url)
    for item in TARGET_OVERRIDES:
        if item.get("website") and host_key(item["website"]) == key:
            return item
    return None


def merge_target(derived, override):
    """Overrides win; empty override values never erase crawled ones."""
    target = dict(derived)
    if not override:
        return target
    for key, value in override.items():
        if key == "profiles":
            merged = dict(derived.get("profiles") or {})
            merged.update({k: v for k, v in (value or {}).items() if v})
            target["profiles"] = merged
        elif key == "aliases":
            target["aliases"] = dedupe(list(value or []) + list(derived.get("aliases") or []))
        elif value not in (None, "", [], {}):
            target[key] = value
    return target


def load_targets_file(path):
    data = read_json(path, [])
    if isinstance(data, dict):
        data = data.get("targets") or []
    if not isinstance(data, list):
        raise SystemExit(f"--targets {path}: expected a JSON list of target objects")
    return [item for item in data if isinstance(item, dict) and item.get("website")]


def saved_targets_path():
    return os.path.join(OUTPUT_ROOT, "targets.json")


def load_saved_targets():
    """Targets from the last website phase; falls back to TARGET_OVERRIDES."""
    data = read_json(saved_targets_path(), [])
    targets = [t for t in data if isinstance(t, dict) and t.get("name")] if isinstance(data, list) else []
    if targets:
        return targets
    log("no saved targets.json - using TARGET_OVERRIDES as the target list", "warn")
    return [dict(item) for item in TARGET_OVERRIDES if item.get("name")]


def save_targets(new_targets):
    """Merge into targets.json by slug so a partial run (--business) never drops other sites."""
    existing = read_json(saved_targets_path(), [])
    by_slug = {}
    for item in (existing if isinstance(existing, list) else []):
        if isinstance(item, dict) and item.get("slug"):
            by_slug[item["slug"]] = item
    for item in new_targets:
        by_slug[item["slug"]] = item
    merged = list(by_slug.values())
    write_social_targets(saved_targets_path(), merged)
    return merged


# ---------------------------------------------------------------------------
# phase 1: website
# ---------------------------------------------------------------------------
def crawl_site(base_url):
    """Website phase for one site; returns everything later phases need."""
    configure_site(base_url)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    if FORCE_REFRESH:
        clear_crawl_checkpoint(CRAWL_CHECKPOINT_FILE)
    print(f"Output directory: {OUTPUT_DIR}")

    wp_media = get_wp_media_items()
    sitemap_media, sitemap_urls = get_sitemap_urls()
    media_urls, text_pages, video_embeds, visited = crawl_pages([BASE_URL])
    media_urls.update(wp_media)
    media_urls.update(sitemap_media)
    export_discovered_urls_csv(media_urls, EXPORT_DISCOVERED_URLS_CSV)
    export_video_embeds_csv(video_embeds, EXPORT_VIDEO_EMBEDS_CSV)

    print(f"Sitemap discovered {len(sitemap_urls)} URLs.")
    url_to_path = download_all(media_urls)
    brand_data = extract_brand_data(BASE_URL, visited, extra_media=media_urls)
    pages_texts, pdf_texts = read_site_texts()
    return {
        "base_url": BASE_URL,
        "brand_data": brand_data,
        "url_to_path": url_to_path,
        "visited": visited,
        "pages_texts": pages_texts,
        "pdf_texts": pdf_texts,
        # HTML already downloaded: handed to the social phase so it is not fetched twice
        "page_html": {u: _page_cache[u] for u in visited if isinstance(_page_cache.get(u), str)},
    }


def brand_dir_for(site_url, index, group_dir):
    slug = brand_slug(site_url)
    if group_dir:
        return os.path.join(group_dir, f"{index:02d}-{slug}")
    return os.path.join(OUTPUT_ROOT, web_site_slug(site_url), "brand-kit", f"01-{slug}")


# ---------------------------------------------------------------------------
# phase 2: social
# ---------------------------------------------------------------------------
def prime_social_cache(page_html):
    """Seed the social fetch cache with pages the website crawl already holds."""
    State.page_cache.clear()
    for url, html in (page_html or {}).items():
        State.page_cache[url] = FetchResult(ok=True, status=200, url=url, text=html,
                                            via="website-crawl")


def summary_from_profile(profile, out_dir):
    rep = profile.get("reputation") or {}
    social = (profile.get("social") or {}).get("totals") or {}
    return {
        "business": profile["business"]["name"], "slug": profile["business"]["slug"],
        "ok": True, "directory": out_dir,
        "consensus_rating": rep.get("consensus_rating"),
        "total_reviews": rep.get("total_reviews"),
        "collected_reviews": rep.get("collected_reviews"),
        "sources": rep.get("sources_present") or [],
        "followers": social.get("followers"),
        "platforms_present": social.get("platforms_present"),
        "scores": profile.get("scores") or {},
        "red_flags": len(rep.get("red_flags") or []),
        "insights": os.path.join(out_dir, "insights.md"),
        "report": os.path.join(out_dir, "report.html"),
    }


def run_social(target, index, total, page_html=None, report_only=False):
    """Social phase for one target. Never raises (except Ctrl-C)."""
    prime_social_cache(page_html)
    try:
        if report_only:
            profile = run_report_only(target)
            if not profile:
                return {"business": target["name"], "slug": target.get("slug"), "ok": False,
                        "error": "no saved platform data to rebuild from"}
            return summary_from_profile(profile, business_dir(target))
        return run_business(target, index, total)
    except KeyboardInterrupt:
        raise
    except Exception as exc:
        log(f"{target['name']} social phase failed: {exc}", "error")
        if State.verbose:
            traceback.print_exc()
        return {"business": target["name"], "slug": target.get("slug"), "ok": False,
                "error": str(exc)}
    finally:
        State.log_file = None
        State.page_cache.clear()


# ---------------------------------------------------------------------------
# phase 3: consolidation
# ---------------------------------------------------------------------------
def build_social_guide_blocks(profile):
    """Compact, additive blocks for brand-guide.json derived from business.profile.json."""
    rep = profile.get("reputation") or {}
    social = profile.get("social") or {}
    web = profile.get("web") or {}
    signals = profile.get("signals") or {}
    compliance = profile.get("compliance") or None
    return {
        "reputation": {
            "consensusRating": rep.get("consensus_rating"),
            "totalReviews": rep.get("total_reviews"),
            "collectedReviews": rep.get("collected_reviews"),
            "perSource": {s: {"rating": e.get("rating"), "count": e.get("count")}
                          for s, e in (rep.get("sources") or {}).items()},
            "sentiment": rep.get("sentiment"),
            "ownerResponseRate": rep.get("owner_response_rate"),
            "topThemes": list((rep.get("themes") or {}).keys())[:8],
            "redFlags": rep.get("red_flags") or [],
            "foodHygiene": compliance,
            "scores": profile.get("scores") or {},
            "strengths": (signals.get("strengths") or [])[:6],
            "weaknesses": (signals.get("weaknesses") or [])[:6],
            "opportunities": (signals.get("opportunities") or [])[:6],
            "risks": (signals.get("risks") or [])[:6],
            "generatedAt": profile.get("generated_at"),
            "detail": "social/business.profile.json",
        },
        "socialPresence": {
            "totals": social.get("totals") or {},
            "gaps": social.get("gaps") or [],
            "notDiscovered": social.get("not_discovered") or [],
            "platforms": [{
                "platform": row.get("source"), "label": row.get("label"),
                "url": row.get("url"), "handle": row.get("handle"),
                "present": row.get("present"), "followers": row.get("followers"),
                "lastPost": row.get("last_post"),
            } for row in (social.get("matrix") or [])],
        },
        "webPresence": {
            "hasOnlineBooking": web.get("has_online_booking"),
            "bookingProviders": web.get("booking_providers") or [],
            "deliveryProviders": web.get("delivery_providers") or [],
            "hasMenuOnline": web.get("has_menu_online"),
            "tech": web.get("tech") or [],
            "pressMentions": web.get("mention_count"),
        },
    }


def attach_social_to_brand_pack(brand_dir, profile):
    """Add reputation / social sections to brand-guide.json and re-render the Word guide."""
    guide_path = os.path.join(brand_dir, "brand-guide.json")
    guide = read_json(guide_path, {})
    if not isinstance(guide, dict) or not guide.get("brand"):
        log(f"no brand-guide.json in {brand_dir}; reputation block not attached", "warn")
        return False
    guide.update(build_social_guide_blocks(profile))
    write_json(guide_path, guide)
    docx_path = os.path.join(brand_dir, f"{guide['brand'].get('slug') or 'brand'}-Brand-Guide.docx")
    write_brand_guide_docx(guide, docx_path)
    return True


def consolidate_social(target, brand_dir):
    """Copy the social deliverables into <brand>/social and enrich the brand guide."""
    out_dir = business_dir(target)
    profile = read_json(os.path.join(out_dir, "business.profile.json"), {})
    if not profile:
        return None
    dest = os.path.join(brand_dir, "social")
    os.makedirs(dest, exist_ok=True)
    for name in SOCIAL_DELIVERABLES:
        src = os.path.join(out_dir, name)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(dest, name))
    assets_src = os.path.join(out_dir, "assets")
    if INCLUDE_SOCIAL_ASSETS_IN_PACK and os.path.isdir(assets_src):
        shutil.copytree(assets_src, os.path.join(dest, "assets"), dirs_exist_ok=True)
    if ENRICH_BRAND_GUIDE:
        attach_social_to_brand_pack(brand_dir, profile)
    return profile


def find_brand_dir(target, group_dir):
    """Locate the brand folder written by an earlier website phase."""
    slug = target.get("slug") or brand_slug(target.get("website") or "")
    if group_dir:
        if os.path.isdir(group_dir):
            for name in sorted(os.listdir(group_dir)):
                if re.match(r"^\d{2}-", name) and name[3:] == slug \
                        and os.path.isdir(os.path.join(group_dir, name)):
                    return os.path.join(group_dir, name)
        return None
    path = brand_dir_for(target.get("website") or "", 1, None)
    return path if os.path.isdir(path) else None


# ---------------------------------------------------------------------------
# group outputs (built from what is on disk, so partial / repeated runs stay correct)
# ---------------------------------------------------------------------------
def scan_brand_dirs(root):
    entries = []
    if not os.path.isdir(root):
        return entries
    for name in sorted(os.listdir(root)):
        path = os.path.join(root, name)
        if not (os.path.isdir(path) and re.match(r"^\d{2}-", name)):
            continue
        if name == "00-portfolio":
            continue
        guide = read_json(os.path.join(path, "brand-guide.json"), {})
        brand = guide.get("brand") or {}
        profile = read_json(os.path.join(path, "social", "business.profile.json"), {}) or None
        entries.append({
            "folder": name, "dir": path, "guide": guide, "profile": profile,
            "name": brand.get("name") or name[3:], "slug": brand.get("slug") or name[3:],
            "website": brand.get("url") or "",
        })
    return entries


def entry_metrics(entry):
    profile = entry.get("profile") or {}
    rep = profile.get("reputation") or {}
    social = (profile.get("social") or {}).get("totals") or {}
    return {
        "rating": rep.get("consensus_rating"), "reviews": rep.get("total_reviews"),
        "followers": social.get("followers"),
        "platforms": social.get("platforms_present"),
        "overall": (profile.get("scores") or {}).get("overall"),
    }


def write_group_readme(group_dir, entries, failures):
    lines = [f"# {BRAND_PACK_GROUP_NAME}", "", BRAND_PACK_GROUP_DESCRIPTION, "", "## Brands", ""]
    for entry in entries:
        line = f"- {entry['folder']} — {entry['name']} ({entry['website']})"
        if entry.get("profile"):
            m = entry_metrics(entry)
            line += (f" · rating {format_number(m['rating'])} from {format_number(m['reviews'])} reviews"
                     f" · {format_number(m['followers'])} followers · score {format_number(m['overall'])}/100")
        else:
            line += " · no social data"
        lines.append(line)
    for failure in failures:
        lines.append(f"- {failure['base_url']} — crawl failed: {failure['error']}")
    lines += [
        "", "## Contents", "",
        "- `00-portfolio/` — portfolio overview (.docx / .json) and the cross-business benchmark "
        "(`group.report.md`, `group.summary.json`).",
        "- `NN-<brand>/` — brand guide (.docx, `brand-guide.json`), `tokens/`, `content/`, "
        "`assets/`, and `social/` (reputation + social dossier: `insights.md`, `report.html`, "
        "`business.profile.json`, `reviews.csv`, ...).",
        "- `targets.json` — the business records handed from the website crawl to the social crawl.",
        "",
    ]
    with open(os.path.join(group_dir, "README.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def write_portfolio_outputs(portfolio_dir, entries, failures):
    rows = []
    for entry in entries:
        m = entry_metrics(entry)
        rows.append([entry["name"], entry["website"], entry["folder"],
                     format_number(m["rating"]), format_number(m["reviews"]),
                     format_number(m["followers"]), format_number(m["overall"])])
    filename = re.sub(r"[^A-Za-z0-9_.-]+", "-", BRAND_PACK_GROUP_NAME).strip("-") + "-Overview.docx"
    write_docx(
        os.path.join(portfolio_dir, filename), BRAND_PACK_GROUP_NAME,
        [{"heading": "Portfolio", "text": BRAND_PACK_GROUP_DESCRIPTION,
          "headers": ["Brand", "Website", "Folder", "Rating", "Reviews", "Followers", "Score"],
          "rows": rows}],
    )
    write_json(os.path.join(portfolio_dir, "portfolio.json"), {
        "group": BRAND_PACK_GROUP_NAME,
        "description": BRAND_PACK_GROUP_DESCRIPTION,
        "generatedAt": iso_now(),
        "brands": [{
            "folder": e["folder"], "name": e["name"], "slug": e["slug"], "website": e["website"],
            "metrics": entry_metrics(e), "scores": (e.get("profile") or {}).get("scores"),
            "hasSocialData": bool(e.get("profile")),
        } for e in entries],
        "failures": failures,
    })


def finalize_group(group_dir, failures=None):
    """Rebuild README, portfolio, benchmark and the single ZIP from the folders on disk."""
    failures = failures or []
    portfolio_dir = os.path.join(group_dir, "00-portfolio")
    os.makedirs(os.path.join(portfolio_dir, "assets"), exist_ok=True)
    entries = scan_brand_dirs(group_dir)
    if not entries:
        print("No brand folders to package.")
        return None
    profiles = [e["profile"] for e in entries if e.get("profile") and e["profile"].get("schema_version")]
    if profiles:
        write_group_report([], profiles, out_dir=portfolio_dir)
    write_portfolio_outputs(portfolio_dir, entries, failures)
    write_group_readme(group_dir, entries, failures)
    saved = saved_targets_path()
    if os.path.isfile(saved):
        shutil.copy2(saved, os.path.join(group_dir, "targets.json"))
    zip_path = os.path.join(OUTPUT_ROOT, f"{BRAND_PACK_GROUP_SLUG}.zip")
    included = ["README.md", "targets.json", "00-portfolio"] + [e["folder"] for e in entries]
    make_zip(group_dir, zip_path, included)
    return zip_path


def finalize_standalone(result):
    """Per-site README + brand-kit.zip (standalone mode)."""
    kit_dir = os.path.join(OUTPUT_ROOT, web_site_slug(result["base_url"]), "brand-kit")
    with open(os.path.join(kit_dir, "README.md"), "w", encoding="utf-8") as f:
        f.write(f"# {result['name']} Brand Kit\n\nSource: {result['base_url']}\n")
    zip_path = os.path.join(OUTPUT_ROOT, web_site_slug(result["base_url"]), "brand-kit.zip")
    make_zip(kit_dir, zip_path)
    return zip_path


# ---------------------------------------------------------------------------
# orchestration
# ---------------------------------------------------------------------------
def process_site(url, index, total, group_dir, do_social):
    """Website -> brand pack -> social -> consolidation for one site."""
    result = {"base_url": url}
    site = crawl_site(url)
    if not site["page_html"] and not site["pages_texts"]:
        # Nothing was fetched (DNS failure, blocked, wrong URL): do not build a junk
        # brand pack or spend a social crawl on a business called after the hostname.
        raise RuntimeError("no pages could be fetched from the site (unreachable, blocked, or wrong URL)")
    brand_data = site["brand_data"]
    target = merge_target(build_social_target(brand_data, site["pages_texts"]), find_override(url))

    # A confirmed target (Maps/search/UI or TARGET_OVERRIDES) wins over the
    # website's footer address. Wix sites in a group often repeat another
    # venue's address in the footer, which used to put 127 South Street on The
    # Physician's cards.
    hints = target.get("hints") or {}
    if hints.get("address"):
        brand_data.setdefault("contact", {})["address"] = hints["address"]
    if hints.get("phones"):
        brand_data["contact"]["phones"] = hints["phones"]
    if hints.get("emails"):
        brand_data["contact"]["emails"] = hints["emails"]

    brand_dir = brand_dir_for(url, index, group_dir)
    os.makedirs(brand_dir, exist_ok=True)
    extras = write_brand_pack_contents(
        brand_data, site["url_to_path"], brand_dir, site["pages_texts"], site["pdf_texts"]
    )
    result.update({
        "name": brand_data["name"], "brand_dir": brand_dir, "target": target,
        "logo_count": len(extras["logos"]), "photo_count": len(extras["photography"]),
        "page_count": len(site["visited"]), "media_count": len(site["url_to_path"]),
    })
    print(f"\nSocial target: {target['name']} · {target.get('city') or '?'} · "
          f"{target.get('category') or '?'} · profiles: "
          f"{', '.join(sorted(target.get('profiles') or {})) or 'none yet'}")

    if do_social:
        summary = run_social(target, index, total, page_html=site["page_html"])
        result["social"] = summary
        if summary.get("ok"):
            if not consolidate_social(target, brand_dir):
                result["social_error"] = "social output missing"
        else:
            result["social_error"] = summary.get("error") or "social phase produced no data"
    return result


def run_website_and_social(urls, numbering, group_dir, do_social):
    results = []
    interrupted = False
    for position, url in enumerate(urls, 1):
        print(f"\n[{position}/{len(urls)}] {url}")
        try:
            results.append(process_site(url, numbering[url], len(urls), group_dir, do_social))
        except KeyboardInterrupt:
            print("\ninterrupted - packaging what is finished so far")
            interrupted = True
            break
        except RuntimeError as e:          # expected failure (e.g. site unreachable)
            print(f"  x {url}: {e}")
            results.append({"base_url": url, "error": str(e)})
        except Exception as e:
            traceback.print_exc()
            results.append({"base_url": url, "error": str(e)})
    targets = [r["target"] for r in results if r.get("target")]
    if targets:
        save_targets(targets)
    return results, interrupted


def run_social_only(args, targets, group_dir):
    results = []
    for index, target in enumerate(targets, 1):
        summary = run_social(target, index, len(targets), report_only=args.report_only)
        result = {"base_url": target.get("website") or "", "name": target["name"],
                  "target": target, "social": summary}
        brand_dir = find_brand_dir(target, group_dir)
        result["brand_dir"] = brand_dir
        if summary.get("ok"):
            if brand_dir:
                consolidate_social(target, brand_dir)
            else:
                log(f"no brand folder found for {target['name']}; run the website phase first "
                    f"(social output stays in {business_dir(target)})", "warn")
        else:
            result["social_error"] = summary.get("error") or "social phase produced no data"
        results.append(result)
    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Website brand crawl followed by a social & reputation crawl, one consolidated pack.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  %(prog)s                              both phases for every configured site
  %(prog)s https://example.com/         one ad-hoc site
  %(prog)s --business hatch --no-browser
  %(prog)s --skip-social                website phase only
  %(prog)s --social-only --deep         re-run the social phase on saved targets
  %(prog)s --report-only                rebuild reports from saved platform data
  %(prog)s --dry-run
        """)
    parser.add_argument("urls", nargs="*", help="site URLs (default: SITES in the config block)")

    pipe = parser.add_argument_group("pipeline")
    pipe.add_argument("--business", action="append", default=[], metavar="TEXT",
                      help="only sites whose url / slug / name contains TEXT (repeatable)")
    pipe.add_argument("--standalone", action="store_true",
                      help="one brand-kit.zip per site instead of one group ZIP")
    pipe.add_argument("--skip-social", action="store_true", help="website phase only")
    pipe.add_argument("--social-only", action="store_true",
                      help="skip the website crawl; run the social phase on saved targets.json")
    pipe.add_argument("--report-only", action="store_true",
                      help="rebuild reports from saved platforms/*.json (no network); implies --social-only")
    pipe.add_argument("--targets", metavar="FILE",
                      help="JSON list of extra TARGET_OVERRIDES-style entries (win over built-ins)")
    pipe.add_argument("--output-root", default=None, help="override OUTPUT_ROOT")
    pipe.add_argument("--group", default=None, help="group name (also names the brand kit)")
    pipe.add_argument("--group-description", default=None,
                      help="one-line description used in the README and portfolio")
    pipe.add_argument("--with-videos", action="store_true",
                      help="also download video files (off by default: unused by the pack, "
                           "often hundreds of MB)")

    intake = parser.add_argument_group("intake / discovery (studio UI)")
    intake.add_argument("--status-json", action="store_true",
                        help="print Python/browser/dependency readiness as JSON and exit")
    intake.add_argument("--search-json", metavar="QUERY",
                        help="search for a business by name and print candidates as JSON")
    intake.add_argument("--search-city", default="", help="city hint for --search-json")
    intake.add_argument("--search-provider", choices=("auto", "places", "maps", "nominatim", "web"),
                        default="auto", help="search provider (default: auto)")
    intake.add_argument("--search-limit", type=int, default=6, help="max candidates (default 6)")
    intake.add_argument("--discover-json", action="store_true",
                        help="discover website + social profiles for --website and print JSON")
    intake.add_argument("--website", default="", help="business website for --discover-json")
    intake.add_argument("--name", default="", help="business name for --discover-json")
    intake.add_argument("--city", default="", help="city for --discover-json")
    intake.add_argument("--region", default="", help="region for --discover-json")
    intake.add_argument("--country", default="", help="country for --discover-json")
    intake.add_argument("--category", default="", help="category for --discover-json")
    intake.add_argument("--profiles-json", default="",
                        help="JSON object (or path) of confirmed profile URLs")
    intake.add_argument("--maps-json", default="",
                        help="JSON object (or path) with Maps rating/address/phone")
    intake.add_argument("--guess-profiles", action="store_true",
                        help="try name-based handles for missing Instagram/Facebook/TikTok")
    intake.add_argument("--search-profiles", action="store_true",
                        help="web-search for missing profiles (can be slow/blocked)")
    intake.add_argument("--discover-pages", type=int, default=8,
                        help="website pages to read during discovery (default 8)")
    pipe.add_argument("--max-pages", type=int, default=None,
                      help=f"website pages per site (default {MAX_PAGE_CRAWL})")
    pipe.add_argument("--force", action="store_true",
                      help="ignore website and social checkpoints and refetch")
    pipe.add_argument("--dry-run", action="store_true", help="print the plan, do no network I/O")
    pipe.add_argument("--list", action="store_true", help="list configured sites and overrides")
    pipe.add_argument("--verbose", "-v", action="store_true", help="debug logging")

    soc = parser.add_argument_group("social phase")
    soc.add_argument("--only", default=None,
                     help="comma separated source keys to run, e.g. google,instagram")
    soc.add_argument("--skip", default=None, help="comma separated source keys to skip")
    soc.add_argument("--deep", action="store_true",
                     help="paginate reviews, search for missing profiles, try more sources")
    soc.add_argument("--max-reviews", type=int, default=MAX_REVIEWS_PER_SOURCE,
                     help=f"max reviews per source (default {MAX_REVIEWS_PER_SOURCE})")
    soc.add_argument("--max-posts", type=int, default=MAX_POSTS_PER_PROFILE,
                     help=f"max posts per profile (default {MAX_POSTS_PER_PROFILE})")
    soc.add_argument("--no-browser", action="store_true",
                     help="disable Playwright (HTTP + JSON-LD only; Google reviews will be missing)")
    soc.add_argument("--no-cache", action="store_true", help="bypass the social HTTP cache")
    soc.add_argument("--no-assets", action="store_true", help="skip social image downloads")
    soc.add_argument("--keep-raw", action="store_true", help="store raw HTML per source")
    soc.add_argument("--sequential", action="store_true", help="disable parallel HTTP connectors")
    soc.add_argument("--no-merge", action="store_true",
                     help="do not fold earlier platform JSON files into this run")
    return parser.parse_args(argv)


def configure_run(args):
    """Apply CLI flags to module settings and the social crawler's State."""
    global OUTPUT_ROOT, BRAND_PACK_GROUP_NAME, BRAND_PACK_GROUP_SLUG, MAX_PAGE_CRAWL
    global PARALLEL, FORCE_REFRESH, MERGE_PREVIOUS_RUNS
    global MAX_POSTS_PER_PROFILE, KEEP_RAW_HTML, DOWNLOAD_ASSETS, RUN_SOCIAL_PHASE
    global DOWNLOAD_VIDEOS
    if args.output_root:
        OUTPUT_ROOT = args.output_root
    if args.group:
        BRAND_PACK_GROUP_NAME = args.group
        BRAND_PACK_GROUP_SLUG = re.sub(r"[^A-Za-z0-9_.-]+", "-", args.group).strip("-") + "-brand-kit"
    if args.group_description:
        globals()["BRAND_PACK_GROUP_DESCRIPTION"] = args.group_description
    elif args.group and args.group not in ("Julie-Dalton", "Dalton family venues"):
        globals()["BRAND_PACK_GROUP_DESCRIPTION"] = (
            f"Brand kit generated from a studio intake crawl for {args.group}."
        )
    if args.max_pages:
        MAX_PAGE_CRAWL = max(1, args.max_pages)
    if args.skip_social:
        RUN_SOCIAL_PHASE = False
    if getattr(args, "with_videos", False):
        DOWNLOAD_VIDEOS = True

    State.verbose = args.verbose
    State.use_browser = not args.no_browser
    State.deep = args.deep
    State.max_reviews = max(1, args.max_reviews)
    State.use_cache = not args.no_cache
    State.output_root = os.path.join(OUTPUT_ROOT, "_social")
    State.group = BRAND_PACK_GROUP_NAME or "group"
    State.only = ({s.strip().lower() for s in args.only.split(",") if s.strip()}
                  if args.only else None)
    State.skip = {s.strip().lower() for s in (args.skip or "").split(",") if s.strip()}
    MAX_POSTS_PER_PROFILE = max(1, args.max_posts)
    KEEP_RAW_HTML = bool(args.keep_raw)
    DOWNLOAD_ASSETS = not args.no_assets
    PARALLEL = not args.sequential
    FORCE_REFRESH = args.force
    MERGE_PREVIOUS_RUNS = not args.no_merge


def select_sites(args):
    """-> (urls to run, {url: stable folder number}). Numbers follow the full list
    so `--business hatch` re-uses 03-hatchstandrews instead of creating 01-."""
    all_urls = list(dict.fromkeys(args.urls or SITES))
    numbering = {url: i for i, url in enumerate(all_urls, 1)}
    wanted = [part.strip().lower() for value in args.business for part in value.split(",")
              if part.strip()]
    if not wanted:
        return all_urls, numbering
    chosen = []
    for url in all_urls:
        override = find_override(url) or {}
        haystack = " ".join([url, brand_slug(url), override.get("name", ""),
                             override.get("slug", "")]).lower()
        if any(w in haystack for w in wanted):
            chosen.append(url)
    return chosen, numbering


def select_saved_targets(args):
    targets = load_saved_targets()
    wanted = [part.strip().lower() for value in args.business for part in value.split(",")
              if part.strip()]
    if not wanted:
        return targets
    return [t for t in targets
            if any(w in " ".join([t.get("name", ""), t.get("slug", ""),
                                  t.get("website", "")]).lower() for w in wanted)]


def print_list():
    print(f"\nConfigured sites ({len(SITES)}) — group {BRAND_PACK_GROUP_NAME or '(standalone)'}\n")
    for i, url in enumerate(SITES, 1):
        override = find_override(url)
        print(f"  {i:02d}-{brand_slug(url)}")
        print(f"    url:      {url}")
        if override:
            profiles = override.get("profiles") or {}
            print(f"    override: {override.get('name')} · {override.get('city') or '?'} · "
                  f"{override.get('category') or '?'}")
            print(f"    seeds:    {', '.join(sorted(profiles)) or '(none)'}")
        else:
            print("    override: (none — fully derived from the crawl)")
        print()
    print("Social sources available:")
    print("  reviews: " + ", ".join(sorted(REVIEW_SOURCES)))
    print("  social:  " + ", ".join(sorted(SOCIAL_SOURCES)))
    print()


def print_dry_run(args, urls, numbering, group_dir):
    head("Dry run — plan only")
    print(f"output root : {OUTPUT_ROOT}")
    print(f"mode        : {'group ZIP -> ' + group_dir if group_dir else 'standalone (one ZIP per site)'}")
    social_on = RUN_SOCIAL_PHASE
    phases = (["social (saved targets)"] if (args.social_only or args.report_only)
              else ["website"] + (["social"] if social_on else []))
    print(f"phases      : {' -> '.join(phases)}")
    print(f"browser     : {'enabled' if State.use_browser else 'disabled'}")
    print(f"social src  : {', '.join(sorted(State.only)) if State.only else 'auto'}")
    print()
    if args.social_only or args.report_only:
        for target in select_saved_targets(args):
            print(f"  {target['name']}  ({target.get('website')})")
            print(f"    seeds: {', '.join(sorted(target.get('profiles') or {})) or '(none)'}")
            print(f"    out:   {business_dir(target)}")
        return
    for url in urls:
        override = find_override(url)
        print(f"  {numbering[url]:02d}-{brand_slug(url)}  {url}")
        print(f"    website out: {os.path.join(OUTPUT_ROOT, web_site_slug(url))}")
        print(f"    brand dir:   {brand_dir_for(url, numbering[url], group_dir)}")
        if social_on:
            seeds = ', '.join(sorted((override or {}).get('profiles') or {})) or '(discovered from the site)'
            print(f"    social seeds: {seeds}")
    print()


def print_summary(results):
    head("Summary")
    rows = []
    for r in results:
        social = r.get("social") or {}
        if r.get("error"):
            rows.append([r["base_url"], "-", "-", "-", "-", "-", "failed: " + str(r["error"])[:40]])
            continue
        if social.get("ok"):
            state = "ok"
        elif r.get("social_error"):
            state = "social: " + str(r["social_error"])[:30]
        elif "social" in r:
            state = "social failed"
        else:
            state = "website only"
        rows.append([
            r.get("name"), r.get("page_count", "-"), r.get("media_count", "-"),
            format_number(social.get("consensus_rating")) if social.get("ok") else "-",
            format_number(social.get("total_reviews")) if social.get("ok") else "-",
            format_number(social.get("followers")) if social.get("ok") else "-",
            state,
        ])
    print(md_table(["Business", "Pages", "Media", "Rating", "Reviews", "Followers", "State"], rows))
    for r in results:
        social = r.get("social") or {}
        if social.get("ok"):
            print(f"  {r['name']}: score {(social.get('scores') or {}).get('overall')} · "
                  f"{social.get('insights')}")
            print(f"    report: {social.get('report')}")


def main(argv=None):
    args = parse_args(argv)
    configure_run(args)

    if args.status_json:
        emit_json(crawler_status())
        return 0

    if args.search_json:
        return json_mode(lambda: search_businesses(
            args.search_json, args.search_city, args.search_limit, args.search_provider
        ))

    if args.discover_json:
        def _discover():
            profiles = load_json_arg(args.profiles_json, {})
            maps = load_json_arg(args.maps_json, {})
            return build_discovery(
                args.website, name=args.name, city=args.city, category=args.category,
                region=args.region, country=args.country, profiles=profiles, maps=maps,
                guess_profiles=args.guess_profiles, search_profiles=args.search_profiles,
                max_pages=args.discover_pages,
            )
        return json_mode(_discover)

    if args.targets:
        TARGET_OVERRIDES[:0] = load_targets_file(args.targets)
    if args.list:
        print_list()
        return 0

    social_only = args.social_only or args.report_only
    do_social = RUN_SOCIAL_PHASE and not args.skip_social
    group_mode = bool(BRAND_PACK_GROUP_NAME) and not args.standalone
    group_dir = os.path.join(OUTPUT_ROOT, BRAND_PACK_GROUP_SLUG) if group_mode else None
    urls, numbering = select_sites(args)

    if args.dry_run:
        print_dry_run(args, urls, numbering, group_dir)
        return 0
    if social_only and not RUN_SOCIAL_PHASE:
        print("--social-only/--report-only conflict with --skip-social")
        return 2

    if do_social:
        load_credentials()
        bootstrap_cache()
        if not HAVE_PLAYWRIGHT and State.use_browser:
            log("playwright not installed — browser tier disabled "
                "(pip install playwright && playwright install chromium)", "warn")
            State.use_browser = False

    started = time.time()
    interrupted = False
    try:
        if social_only:
            targets = select_saved_targets(args)
            if not targets:
                print("No targets selected.")
                return 1
            head(f"Social & reputation phase — {len(targets)} business(es)")
            results = run_social_only(args, targets, group_dir)
            failures = []
        else:
            if not urls:
                print("No sites selected.")
                return 1
            if group_mode:
                print(f"Group mode: writing {BRAND_PACK_GROUP_NAME} to {group_dir}")
                os.makedirs(os.path.join(group_dir, "00-portfolio", "assets"), exist_ok=True)
            results, interrupted = run_website_and_social(urls, numbering, group_dir, do_social)
            failures = [{"base_url": r["base_url"], "error": r["error"]}
                        for r in results if r.get("error")]

        packaged = None
        if group_mode:
            if any(not r.get("error") for r in results) or social_only:
                packaged = finalize_group(group_dir, failures)
        else:
            packaged = []
            for r in results:
                if r.get("error") or not r.get("brand_dir") or not os.path.isdir(r["brand_dir"]):
                    continue
                r["zip_path"] = finalize_standalone(r)
                packaged.append(r["zip_path"])
    finally:
        if do_social:
            Browser.close()

    print_summary(results)
    if packaged:
        print("\nBrand pack: " + (packaged if isinstance(packaged, str) else ", ".join(packaged)))
    if os.path.isfile(saved_targets_path()):
        print(f"Social crawler targets: {saved_targets_path()}")
    print(f"Finished in {time.time() - started:.0f}s"
          + (f" · cache hits {State.stats['cache_hits']} · browser fetches "
             f"{State.stats['browser_fetches']} · assets {State.stats['assets_downloaded']}"
             if do_social else ""))
    if interrupted:
        return 130
    return 1 if not results or all(r.get("error") for r in results) else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        try:
            Browser.close()
        except Exception:
            pass
        print("\ninterrupted")
        sys.exit(130)
