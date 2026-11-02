#!/usr/bin/env python3
"""
WordPress Document, Media & Brand Crawler (multi-site)

For each site it writes crawl artifacts under OUTPUT_ROOT and adds a brand
pack ready to import via POST /api/brand-packs/import. By default the group
configuration creates one ZIP with 00-portfolio/ and numbered brand folders.
Pass --standalone to create one brand-kit.zip per site; additional arguments
are treated as site URLs.

  <group ZIP>/
      README.md
      00-portfolio/                      portfolio overview
      01-<brand-slug>/
          <brand-slug>-Brand-Guide.docx
          brand-guide.json
          tokens/<brand-slug>.tokens.json
          content/<brand-slug>.json
          cover.<ext>                    only when image quality permits
          assets/                         curated logo, photo, palette and type assets
  OUTPUT_ROOT/<site-slug>/
      documents/  images/  videos/  pages_text/
      discovered_media.csv  discovered_video_embeds.csv

The token schema and asset layout follow the studio contract described in
`Scraped brand-kit review`: `brand`, `color`, `typography.families` (strings),
`typography.scale` (objects), curated logos, validated contact, structured
guide JSON, and (in group mode) a single ZIP with 00-portfolio/ + brand
folders numbered by slug.
"""

import sys
import os
import re
import csv
import json
import time
import shutil
import hashlib
import mimetypes
import zipfile
import requests
import xml.etree.ElementTree as ET
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape
from urllib.parse import urljoin, urlparse, unquote, parse_qs
from xml.sax.saxutils import escape as xml_escape

from bs4 import BeautifulSoup

try:
    from PIL import Image, ImageDraw, ImageFont
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False


# ------------------------------
# MULTI-SITE CONFIGURATION
# ------------------------------
SITES = [
    "https://www.thephysician.bar/",
    "https://www.theadamson.com/",
    "https://www.hatchstandrews.com/"
]

OUTPUT_ROOT = "data/Julie-Dalton"

# If set, all sites go into ONE brand-kit with numbered brand folders.
# If None, each site gets its own brand-kit.zip.
BRAND_PACK_GROUP_NAME = "Julie-Dalton"
BRAND_PACK_GROUP_DESCRIPTION = (
    "This group contains brand kits for multiple venues managed by Julie Dalton. "
)
BRAND_PACK_GROUP_SLUG = "Julie-Dalton-brand-kit"

# ---- Crawl tuning (shared) ----
REQUEST_DELAY = 0.3
MAX_PAGE_CRAWL = 500
MAX_WORKERS = 5
RESTRICT_CRAWL_TO_BASE_PATH = False
ALLOW_SUBDOMAINS = True
ALLOW_EXTERNAL_DOCUMENTS = False

ENABLE_CRAWL_CHECKPOINT = True
CRAWL_CHECKPOINT_SAVE_EVERY = 50
CLEAR_CHECKPOINT_ON_COMPLETE = True

# ---- Brand-pack quality gates (from the review) ----
LOGO_MIN_EDGE = 200           # px; anything smaller is treated as icon/favicon
LOGO_MIN_FLAT_ASPECT = 1.5    # logo width/height must be >= this for wordmarks... actually
LOGO_MIN_ASPECT = 0.1         # keep very wide wordmarks too
PHOTO_MIN_SHORT_EDGE = 600    # px; keep photos at least this large
PHOTO_PRINT_SHORT_EDGE = 2000  # target for print-capable photos (flagged, not filtered)
COVER_MIN_WIDTH = 1600
COVER_MIN_HEIGHT = 1000


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
    'twitter':   r'(?:twitter|x)\.com/',
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
    r'wix-|wix_|avenir-lt|avenir-lt-w|helvetica-w01|helvetica-w02|futura-lt|'
    r'proxima-n-w01|brandon-grotesque|raleway-w|madefor-|wix-madefor|'
    r'squarespace|fonts-|sofia-pro|questrial|social-icons|'
    r'font-awesome|material-icons'
    r')',
    re.IGNORECASE,
)

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


# =========================================================
# PER-SITE CONFIGURATION
# =========================================================
def site_slug(url):
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
    slug = site_slug(base_url)

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


def safe_filename(url):
    parsed = urlparse(url)
    name = os.path.basename(parsed.path)
    if not name:
        name = "file_" + str(abs(hash(url)))
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
        'GIF': '.gif', 'BMP': '.bmp', 'TIFF': '.tif',
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
    urls = []
    if not srcset_value:
        return urls
    for candidate in str(srcset_value).split(','):
        candidate = candidate.strip()
        if not candidate:
            continue
        url_part = candidate.split()[0]
        if url_part:
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
    filename = sanitize_filename(filename or safe_filename(url))
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
    return is_same_domain(url)


# =========================================================
# CONTACT VALIDATION
# =========================================================
def normalize_phone(phone):
    """Normalize a UK phone number to a clean local/international form."""
    if not phone:
        return None
    raw = str(phone).strip()
    digits = re.sub(r'[^\d+]', '', raw)
    if not digits:
        return None
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


def is_valid_email(email):
    if not email or '@' not in email:
        return False
    return bool(re.match(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$',
                         email.strip()))


def dedupe_emails(emails):
    """Validate and de-duplicate exact email addresses without guessing typos."""
    return sorted(set(e.lower().strip() for e in emails if is_valid_email(e)))


def build_contact_block(brand_data):
    """Build the importer-native contact block from tokens + page text."""
    raw = brand_data['contact']
    phones = sorted(set(filter(None, (normalize_phone(p) for p in raw['phones']))))
    emails = dedupe_emails(raw['emails'])
    social = {}
    for platform, url in raw.get('social', {}).items():
        urls = url if isinstance(url, (list, tuple, set)) else [url]
        social[platform] = sorted(set(value for value in urls if value))
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


def extract_logo_candidates(soup, page_url):
    """Return list of {kind, url, source} for logo candidates."""
    out = []
    seen = set()

    def add(url, source, kind='logo', label=''):
        if not url:
            return
        url = urljoin(page_url, url)
        if url in seen:
            return
        seen.add(url)
        out.append({'url': url, 'source': source, 'kind': kind, 'label': label})

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
                add(src, 'img', 'logo', haystack)

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
            })

    return out


def extract_photography_candidates(soup, page_url, page_text_len=0):
    """Return ordered hero-then-body image URLs."""
    hero = []
    body = []
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
        if not src:
            continue
        url = urljoin(page_url, src)
        cls = str(img.get('class', '')).lower()
        if 'hero' in cls or 'banner' in cls or 'cover' in cls or 'featured' in cls:
            hero.append(url)
        else:
            body.append(url)

    og = soup.find('meta', property='og:image')
    if og and og.get('content'):
        hero.insert(0, urljoin(page_url, og['content']))
    twitter = soup.find('meta', attrs={'name': 'twitter:image'})
    if twitter and twitter.get('content'):
        hero.insert(0, urljoin(page_url, twitter['content']))

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

    return contacts


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


def extract_brand_data(start_url, visited_pages):
    """Fetch home + a handful of key pages; return the brand dict."""
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
        if any(k in low for k in ('/about', '/press', '/contact', '/brand', '/media')):
            key_pages.append(u)
    key_pages = list(dict.fromkeys(key_pages))[:8]

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

    # Fetch up to 12 stylesheets for tokens
    for css_url in sorted(brand['stylesheet_urls'])[:12]:
        css = fetch_text_cached(css_url)
        if css:
            extract_css_tokens_into(css, brand['css_tokens'])

    # Last-resort name
    if not brand['name']:
        parsed = urlparse(start_url)
        host = parsed.netloc.replace('www.', '')
        brand['name'] = host.split('.')[0].title()

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
                time.sleep(REQUEST_DELAY)
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
def crawl_pages(start_urls):
    visited = set()
    to_visit = []
    media_urls = set()
    text_pages = set()
    video_embeds = set()

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

    def record_candidate(url):
        if not url:
            return False
        kind = classify_media(url)
        if kind:
            if is_media_host_allowed(url):
                media_urls.add(url)
            return True
        return False

    def handle_srcset(srcset_value, current_url):
        for u in extract_srcset_urls(srcset_value):
            normalized = normalize_candidate_url(u, current_url)
            if normalized:
                record_candidate(normalized)

    def handle_css_text(css_text, current_url):
        for u in extract_css_background_urls(css_text):
            normalized = normalize_candidate_url(u, current_url)
            if normalized:
                record_candidate(normalized)

    def handle_iframe(src, source_page):
        for pattern, platform in VIDEO_EMBED_PATTERNS:
            if re.search(pattern, src):
                video_embeds.add((platform, src, source_page))
                return

    def extract_links(html, current_url):
        soup = BeautifulSoup(html, 'lxml')
        seen_here = set()

        def evaluate_candidate(raw_value, parse_embedded=False):
            if not raw_value:
                return
            candidates = []
            if not parse_embedded:
                candidates.append(raw_value)
            else:
                candidates.extend(extract_urls_from_text(raw_value))
            for token in candidates:
                href = normalize_candidate_url(token, current_url)
                if not href or href in seen_here:
                    continue
                seen_here.add(href)

                if record_candidate(href):
                    continue

                if not is_same_domain(href):
                    continue
                if href in visited or href in PERMANENTLY_FAILED:
                    continue
                if len(to_visit) >= MAX_PAGE_CRAWL:
                    continue
                if href in to_visit:
                    continue
                if not is_page_in_scope(href):
                    continue
                if href.lower().endswith(NON_HTML_SUFFIXES):
                    continue
                to_visit.append(href)

        for tag in soup.find_all(True):
            for attr in ('srcset', 'data-srcset', 'data-lazy-srcset'):
                val = tag.get(attr)
                if val:
                    handle_srcset(val, current_url)

            style_val = tag.get('style')
            if style_val:
                handle_css_text(style_val, current_url)

            if tag.name == 'iframe':
                src = tag.get('src') or tag.get('data-src') or tag.get('data-lazy-src')
                if src:
                    handle_iframe(src, current_url)
                    evaluate_candidate(src)

            for attr in EXTRA_LINK_ATTRIBUTES:
                value = tag.get(attr)
                if not value:
                    continue
                if attr in ('srcset', 'data-srcset', 'data-lazy-srcset'):
                    continue
                evaluate_candidate(value, parse_embedded=(attr == 'onclick'))

        for source_tag in soup.find_all('source'):
            src = source_tag.get('src')
            if src:
                evaluate_candidate(src)
            srcset = source_tag.get('srcset')
            if srcset:
                handle_srcset(srcset, current_url)

        for style_tag in soup.find_all('style'):
            if style_tag.string:
                handle_css_text(style_tag.string, current_url)

        evaluate_candidate(html, parse_embedded=True)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {}
        while to_visit and len(visited) < MAX_PAGE_CRAWL:
            while to_visit and len(futures) < MAX_WORKERS * 2:
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
                                extract_links(resp.text, url)
                            except Exception as e:
                                print(f"Link extraction error for {url}: {e}")
                except Exception as e:
                    print(f"Error crawling {url}: {e}")
                time.sleep(REQUEST_DELAY)

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

    print(f"Page crawl: visited {len(visited)} pages, "
          f"found {len(media_urls)} media links, "
          f"saved text for {len(text_pages)} pages, "
          f"detected {len(video_embeds)} video embeds.")
    return media_urls, text_pages, video_embeds, visited


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
        resp = get(url, stream=True)
        if not resp:
            return None

        content_type = (resp.headers.get('content-type') or '').lower()

        if content_type.startswith('text/html') and not is_media_url(url):
            print(f"Skipping non-media response at {url} (content-type: {content_type})")
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
        # Normalise MIME/extension (WebP saved as .jpg, etc.)
        return fix_image_extension(filepath)
    except Exception as e:
        print(f"Failed to download {url}: {e}")
        return None


def download_all(media_urls):
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    os.makedirs(IMAGE_DIR, exist_ok=True)
    os.makedirs(VIDEO_DIR, exist_ok=True)

    url_to_path = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(download_media_file, url): url for url in media_urls}
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
            'index': i,
        })
    # De-dup by file hash
    seen_hashes = set()
    unique = []
    for c in candidates:
        h = file_hash(c['local'])
        if not h or h in seen_hashes:
            continue
        seen_hashes.add(h)
        unique.append(c)
    return unique


def select_curated_photography(brand_data, url_to_path, cover_local=None):
    """Return the final list of photography file records after quality gating."""
    chosen = []
    seen_hashes = set()
    for url in brand_data['photography_urls']:
        local = url_to_path.get(url)
        if not local or not os.path.isfile(local):
            continue
        if cover_local and local == cover_local:
            continue  # cover handled separately
        info = get_image_info(local)
        if not info or info[2] == 'SVG':
            continue
        width, height, _ = info
        short = min(width, height)
        if short < PHOTO_MIN_SHORT_EDGE:
            continue
        digest = file_hash(local)
        if not digest or digest in seen_hashes:
            continue
        seen_hashes.add(digest)
        chosen.append(local)
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

    total = sum(css_tokens['colors'].values())
    clustered = cluster_colors(css_tokens['colors'])

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
    if any(c in n for c in ('px', '%', '{', '}', ';', ':')):
        return False
    if n.startswith('var(') or n.startswith('--'):
        return False
    if n.lower() in ('inherit', 'initial', 'unset', 'revert',
                     'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
                     'system-ui', '-apple-system', 'blinkmacsystemfont'):
        return False
    return True


def build_typography(css_tokens):
    faces = css_tokens['font_faces']
    declared = sorted(css_tokens['families'])

    families = {}
    for face in faces:
        fam = face['family']
        if not is_real_font_family(fam):
            continue
        families.setdefault(fam, {'name': fam, 'weights': set(), 'styles': set(),
                                  'role': None, 'source': 'css-font-face'})
        families[fam]['weights'].add(face['weight'])
        families[fam]['styles'].add(face['style'])

    for fam in declared:
        if not is_real_font_family(fam):
            continue
        if fam not in families:
            families[fam] = {'name': fam, 'weights': {'400'}, 'styles': {'normal'},
                             'role': None, 'source': 'css-font-family'}

    ordered = list(families.values())
    if len(ordered) >= 2:
        ordered[0]['role'] = 'display'
        ordered[1]['role'] = 'body'
    elif ordered:
        ordered[0]['role'] = 'body'

    out_families = [f['name'] for f in ordered]
    weights = {f['name']: sorted(f['weights']) for f in ordered}
    return {'families': out_families, 'weights': weights}


def build_type_scale(observed_sizes, display_family=None, body_family=None):
    """Return unique, observed CSS sizes in the importer's object format."""
    del display_family, body_family
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
    return list(by_role.values())


# ------------------------------------------------------------------
# CONTENT PACK (menu / hours / booking URL)
# ------------------------------------------------------------------
def extract_menu_sections(text, max_sections=12):
    """Parse a menu-ish page text into sections with items and prices."""
    price_re = re.compile(r'[£$€]\s*\d{1,4}(?:[.,]\d{1,2})?')
    sections = []
    current = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if len(line) > 120:
            continue
        has_price = bool(price_re.search(line))
        # Section heading: short, capitalised, no price
        if not has_price and 2 <= len(line) <= 50 and not line.endswith('.'):
            if line.isupper() or (line[0].isupper() and line.count(' ') <= 4):
                if current is not None and current['items']:
                    sections.append(current)
                current = {'name': line, 'items': []}
                continue
        if has_price and current is not None:
            m = price_re.search(line)
            price = m.group(0)
            name = line[:m.start()].strip(' .-—:|')
            desc = line[m.end():].strip(' .-—:|')
            if name:
                item = {'name': name, 'price': price}
                if desc:
                    item['description'] = desc
                current['items'].append(item)
    if current is not None and current['items']:
        sections.append(current)
    return [s for s in sections if s['items']][:max_sections]


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
    curated = select_curated_logos(brand_data, url_to_path)
    inline_hashes = set()
    for i, c in enumerate(curated):
        ext = os.path.splitext(c['local'])[1].lower() or '.png'
        name = f"logo-{c['variant']}-{c['kind']}-{i}{ext}"
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

    # Inline SVGs — only keep ones that look like real logos (filtered by sub-brand keywords)
    for svg in brand_data.get('inline_svgs', []):
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
                f.write(text)
            inline_hashes.add(digest)
            logo_files.append({
                'file': f'assets/logos/{name}',
                'variant': 'primary',
                'kind': 'logo',
                'source': 'inline-svg',
            })
        except OSError as e:
            print(f"Could not write inline SVG logo {dest}: {e}")

    # ---- Photography ----
    photo_files = []
    cover = select_cover(brand_data, url_to_path)
    curated_photos = select_curated_photography(
        brand_data, url_to_path, cover_local=cover,
    )
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
    type_scale = build_type_scale(brand_data['css_tokens'].get('type_scale', []))
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


def build_brand_tokens(brand_data, extras, content):
    contact = build_contact_block(brand_data)
    applications = infer_applications(brand_data, extras, content)
    return {
        'brand': {
            'name': brand_data['name'],
            'slug': brand_slug(BASE_URL),
            'wordmark': brand_data['name'],
            'tagline': None,
            'url': BASE_URL,
            'locale': 'en-GB',
            'currency': 'GBP',
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
    write_brand_guide_docx(brand_data, extras, content, tokens,
                           os.path.join(brand_dir, f'{slug}-Brand-Guide.docx'))
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


def write_brand_guide_docx(brand_data, extras, content, tokens, path):
    contact = tokens['contact']
    contact_rows = [
        ['Address', contact['address'] or 'Not found'],
        ['Phone', ', '.join(contact['phones']) or 'Not found'],
        ['Email', ', '.join(contact['emails']) or 'Not found'],
        ['Website', contact['website']],
    ]
    contact_rows.extend(
        [platform.title(), value]
        for platform, value in contact.items()
        if platform in SOCIAL_PATTERNS and value
    )
    app_rows = [
        [item['asset'], ', '.join(item.get('sizes', [])), str(item.get('priority', ''))]
        for item in tokens['applications']
    ]
    type_rows = [
        [item['id'], item.get('family') or 'Unknown', item['size']]
        for item in extras['typography']['scale']
    ]
    sections = [
        {'heading': 'Positioning', 'text': brand_data.get('description') or 'Not found in site metadata.'},
        {'heading': 'Applications', 'headers': ['Application', 'Suggested sizes', 'Priority'],
         'rows': app_rows or [['No menu/drinks application evidence found', '', '']]},
        {'heading': 'Contact', 'headers': ['Field', 'Value'], 'rows': contact_rows},
        {'heading': 'Typography', 'headers': ['Role', 'Family', 'Observed size'],
         'rows': type_rows or [['No observed type scale', '', '']],
         'paragraphs': ['Families: ' + (', '.join(extras['typography']['families']) or 'Not found')]},
        {'heading': 'Logo rules', 'paragraphs': [
            'Keep clear space around the mark; exact measurement is not known.',
            'No minimum reproduction size was supplied. Confirm approved variants and sizes with the brand owner.',
        ]},
        {'heading': 'Brand fit', 'text': ', '.join(tokens['brandFit']) or 'No fit tags inferred.'},
        {'heading': 'Content', 'text': json.dumps(content, ensure_ascii=False) if content else 'No menu or hours data extracted.'},
        {'heading': 'Rights', 'text': 'Asset rights and licensing were not verified by this crawl.'},
    ]
    write_docx(path, f"{brand_data['name']} — Brand Guide", sections)


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


def write_group_readme(group_dir, results):
    path = os.path.join(group_dir, 'README.md')
    lines = [f'# {BRAND_PACK_GROUP_NAME}', '', BRAND_PACK_GROUP_DESCRIPTION, '', '## Brands', '']
    for result in results:
        if result.get('error'):
            lines.append(f"- {result['base_url']} — crawl failed: {result['error']}")
        else:
            lines.append(
                f"- {os.path.basename(result['brand_dir'])} — {result['name']} "
                f"({result['base_url']})"
            )
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


def write_portfolio_docx(portfolio_dir, results):
    rows = [
        [result.get('name') or 'Unknown', result.get('base_url', ''),
         os.path.basename(result.get('brand_dir', ''))]
        for result in results if not result.get('error')
    ]
    write_docx(
        os.path.join(portfolio_dir, 'Aseni-Group-Overview.docx'),
        BRAND_PACK_GROUP_NAME,
        [{'heading': 'Portfolio', 'text': BRAND_PACK_GROUP_DESCRIPTION,
          'headers': ['Brand', 'Website', 'Folder'], 'rows': rows}],
    )


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
    """Create the input record expected by crawler-studio-social-julie.py."""
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
        for candidate in ('St Andrews', 'Glasgow', 'Edinburgh'):
            if re.search(r'\b' + re.escape(candidate) + r'\b', location_text, re.IGNORECASE):
                location['city'] = candidate
                break

    if not location.get('region') and location.get('city', '').casefold() == 'st andrews':
        location['region'] = 'Scotland'
    if not location.get('region') and re.search(r'\bScotland\b', location_text, re.IGNORECASE):
        location['region'] = 'Scotland'
    if not location.get('country'):
        if re.search(r'\b(?:United Kingdom|UK|GB)\b', location_text, re.IGNORECASE):
            location['country'] = 'United Kingdom'
        elif re.search(r'\bScotland\b', location_text, re.IGNORECASE):
            location['country'] = 'United Kingdom'

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

    profiles = {}
    for platform, values in sorted(contact.get('social', {}).items()):
        urls = values if isinstance(values, (list, tuple, set)) else [values]
        valid_urls = sorted({
            str(url).strip() for url in urls
            if isinstance(url, str) and url.strip().startswith(('http://', 'https://'))
        })
        if valid_urls:
            profiles[platform] = valid_urls[0]

    website = brand_data.get('og', {}).get('og:url') or BASE_URL
    name = brand_data.get('name') or brand_slug(BASE_URL)
    aliases = []
    if category and category.casefold() not in name.casefold():
        aliases.append(f'{name} {category}')
    target = {
        'name': name,
        'slug': brand_slug(BASE_URL),
        'city': location.get('city'),
        'region': location.get('region'),
        'country': location.get('country'),
        'category': category,
        'aliases': aliases,
        'website': website,
        'profiles': profiles,
    }
    return target


def write_social_targets(path, targets):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(targets, f, ensure_ascii=False, indent=2)
        f.write('\n')


def run_site(base_url, index=1, group_dir=None):
    configure_site(base_url)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
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
    brand_data = extract_brand_data(BASE_URL, visited)
    pages_texts, pdf_texts = read_site_texts()
    target = build_social_target(brand_data, pages_texts)

    if group_dir:
        target = os.path.join(group_dir, f'{index:02d}-{brand_slug(BASE_URL)}')
    else:
        target = os.path.join(BRAND_KIT_DIR, f'01-{brand_slug(BASE_URL)}')
    os.makedirs(target, exist_ok=True)
    extras = write_brand_pack_contents(
        brand_data, url_to_path, target, pages_texts, pdf_texts
    )

    zip_path = None
    if not group_dir:
        os.makedirs(BRAND_KIT_DIR, exist_ok=True)
        readme = os.path.join(BRAND_KIT_DIR, 'README.md')
        with open(readme, 'w', encoding='utf-8') as f:
            f.write(f"# {brand_data['name']} Brand Kit\n\nSource: {BASE_URL}\n")
        zip_path = os.path.join(OUTPUT_DIR, 'brand-kit.zip')
        make_zip(BRAND_KIT_DIR, zip_path)

    return {
        'base_url': BASE_URL,
        'name': brand_data['name'],
        'brand_dir': target,
        'zip_path': zip_path,
        'logo_count': len(extras['logos']),
        'photo_count': len(extras['photography']),
        'page_count': len(visited),
        'media_count': len(url_to_path),
        'target': target,
    }


def main():
    args = list(sys.argv[1:])
    standalone = '--standalone' in args
    urls = [arg for arg in args if arg != '--standalone'] or SITES
    group_mode = bool(BRAND_PACK_GROUP_NAME) and not standalone
    group_dir = None
    portfolio_dir = None
    if group_mode:
        group_dir = os.path.join(OUTPUT_ROOT, BRAND_PACK_GROUP_SLUG)
        portfolio_dir = os.path.join(group_dir, '00-portfolio')
        os.makedirs(os.path.join(portfolio_dir, 'assets'), exist_ok=True)
        print(f"Group mode: writing {BRAND_PACK_GROUP_NAME} to {group_dir}")

    results = []
    for index, url in enumerate(urls, 1):
        print(f"\n[{index}/{len(urls)}] {url}")
        try:
            results.append(run_site(url, index=index, group_dir=group_dir))
        except Exception as e:
            import traceback
            traceback.print_exc()
            results.append({'base_url': url, 'error': str(e)})

    if group_mode and any(not result.get('error') for result in results):
        targets = [result['target'] for result in results if result.get('target')]
        targets_path = os.path.join(OUTPUT_ROOT, 'targets.json')
        write_social_targets(targets_path, targets)
        write_social_targets(os.path.join(group_dir, 'targets.json'), targets)
        write_group_readme(group_dir, results)
        write_portfolio_docx(portfolio_dir, results)
        zip_path = os.path.join(OUTPUT_ROOT, f'{BRAND_PACK_GROUP_SLUG}.zip')
        included = ['README.md', 'targets.json', '00-portfolio']
        included.extend(
            os.path.relpath(result['brand_dir'], group_dir)
            for result in results if not result.get('error')
        )
        make_zip(group_dir, zip_path, included)
        print(f"\nGroup pack: {zip_path}")
        print(f"Social crawler targets: {targets_path}")
    elif not group_mode:
        targets = [result['target'] for result in results if result.get('target')]
        if targets:
            targets_path = os.path.join(OUTPUT_ROOT, 'targets.json')
            write_social_targets(targets_path, targets)
            print(f"Social crawler targets: {targets_path}")

    print('\nCrawl summary:')
    for result in results:
        if result.get('error'):
            print(f"  FAILED {result['base_url']}: {result['error']}")
        else:
            print(
                f"  {result['name']}: {result['page_count']} pages, "
                f"{result['media_count']} media, {result['logo_count']} logos, "
                f"{result['photo_count']} photos"
            )
            if result.get('zip_path'):
                print(f"    Brand pack: {result['zip_path']}")
    return 1 if not results or all(result.get('error') for result in results) else 0


if __name__ == '__main__':
    sys.exit(main())