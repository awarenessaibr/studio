#!/usr/bin/env bash
# install.sh — Debian/Ubuntu setup for the studio-layers project.
#
# Usage:
#   chmod +x install.sh
#   ./install.sh
#
# Optional overrides (env vars, place before ./install.sh):
#   NODE_MAJOR=22              # Node.js major to install if missing / too old
#   VENV_DIR=./.venv           # Python venv location (crawler expects .venv by default)
#   SKIP_NODE=1                # 1 = do not touch Node.js
#   SKIP_PYTHON=1              # 1 = skip venv + crawler sidecar deps
#   SKIP_PLAYWRIGHT=1          # 1 = skip Playwright Chromium download
#   SKIP_FFMPEG=1              # 1 = skip ffmpeg (MP4 transcode becomes unavailable)
#   INSTALL_OLLAMA=1           # 1 = install Ollama + pull default models (GB download)
#   VISION_MODEL=granite3.2-vision:2b
#   TEXT_MODEL=qwen3.5:9b
#
# Tested on: Ubuntu 22.04 / 24.04, Debian 12 (bookworm), Debian 13 (trixie).

set -euo pipefail

if [ -t 1 ]; then
    BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'
    YELLOW=$'\033[33m'; RED=$'\033[31m'; NC=$'\033[0m'
else
    BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; NC=""
fi
log()  { printf '%s[+]%s %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%s[!]%s %s\n' "$YELLOW" "$NC" "$*" >&2; }
die()  { printf '%s[x]%s %s\n' "$RED" "$NC" "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

NODE_MAJOR="${NODE_MAJOR:-22}"
VENV_DIR="${VENV_DIR:-$SCRIPT_DIR/.venv}"
SKIP_NODE="${SKIP_NODE:-0}"
SKIP_PYTHON="${SKIP_PYTHON:-0}"
SKIP_PLAYWRIGHT="${SKIP_PLAYWRIGHT:-0}"
SKIP_FFMPEG="${SKIP_FFMPEG:-0}"
INSTALL_OLLAMA="${INSTALL_OLLAMA:-0}"
VISION_MODEL="${VISION_MODEL:-granite3.2-vision:2b}"
TEXT_MODEL="${TEXT_MODEL:-qwen3.5:9b}"

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

# ── Distro detection ────────────────────────────────────────────────────
# shellcheck disable=SC1091
. /etc/os-release
DISTRO_ID="${ID:-unknown}"
DISTRO_VER="${VERSION_ID:-0}"
log "Detected: ${DISTRO_ID} ${DISTRO_VER}"

# ── 1. Base packages ────────────────────────────────────────────────────
log "Updating apt package lists…"
$SUDO apt-get update -y

BASE_PKGS=(
    build-essential ca-certificates curl git wget
    xz-utils unzip
)

# libglib2.0-0 became libglib2.0-0t64 on Debian 13 / Ubuntu 24.04+.
if apt-cache show libglib2.0-0t64 >/dev/null 2>&1; then
    BASE_PKGS+=(libglib2.0-0t64)
else
    BASE_PKGS+=(libglib2.0-0)
fi

if [ "$SKIP_PYTHON" = "0" ]; then
    if [ "$DISTRO_ID" = "debian" ] && [ "$DISTRO_VER" -ge 13 ] 2>/dev/null; then
        # python3-venv is transitional on Debian 13; python3-full is reliable.
        BASE_PKGS+=(python3 python3-dev python3-pip python3-full)
    else
        BASE_PKGS+=(python3 python3-dev python3-pip python3-venv)
    fi
fi

log "Installing base packages…"
$SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${BASE_PKGS[@]}"

# ── 2. ffmpeg (optional — MP4 transcode) ────────────────────────────────
if [ "$SKIP_FFMPEG" = "0" ]; then
    if command -v ffmpeg >/dev/null 2>&1; then
        log "ffmpeg already present: $(ffmpeg -version | head -n1)"
    else
        log "Installing ffmpeg…"
        $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg \
            || warn "ffmpeg install failed — the studio will fall back to browser MP4/WebM recording."
    fi
fi

# ── 3. Node.js ≥ 22.6 (required for node --test glob) ───────────────────
if [ "$SKIP_NODE" = "0" ]; then
    node_ok() {
        command -v node >/dev/null 2>&1 || return 1
        node -e 'const [a,b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 6) ? 0 : 1)' 2>/dev/null
    }
    if node_ok; then
        log "Node.js already OK: $(node -v)"
    else
        log "Installing Node.js ${NODE_MAJOR}.x via NodeSource…"
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO -E bash -
        $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
        node_ok || die "Node.js install did not land at ≥ 22.6 (got $(node -v 2>/dev/null || echo 'missing'))"
        log "Node.js: $(node -v)"
    fi
fi

# ── 4. Python venv + crawler / sidecar deps ─────────────────────────────
PLAYWRIGHT_OK=0
if [ "$SKIP_PYTHON" = "0" ] && [ -f "$SCRIPT_DIR/requirements.txt" ]; then
    if [ ! -x "$VENV_DIR/bin/python" ]; then
        log "Creating Python venv at $VENV_DIR"
        python3 -m venv "$VENV_DIR"
    else
        log "Reusing existing Python venv at $VENV_DIR"
    fi
    "$VENV_DIR/bin/python" -m pip install --upgrade pip >/dev/null
    log "Installing Python requirements (crawler + asset-intel + playwright)…"
    if ! "$VENV_DIR/bin/python" -m pip install -r "$SCRIPT_DIR/requirements.txt"; then
        warn "Some Python requirements failed; the crawler and asset library may be limited."
    fi

    if [ "$SKIP_PLAYWRIGHT" = "0" ] && "$VENV_DIR/bin/python" -c "import playwright" 2>/dev/null; then
        log "Installing Playwright system deps (may need sudo)…"
        $SUDO DEBIAN_FRONTEND=noninteractive "$VENV_DIR/bin/python" -m playwright install-deps chromium 2>/dev/null \
            || warn "playwright install-deps failed; some test harnesses may need additional system libraries."
        log "Downloading Playwright Chromium…"
        if "$VENV_DIR/bin/python" -m playwright install chromium; then
            PLAYWRIGHT_OK=1
        else
            warn "Playwright Chromium download failed; 'npm run test:asset-studio' / 'test:smoke' / 'test:visual' will not run until it succeeds."
        fi
    elif [ "$SKIP_PLAYWRIGHT" = "0" ]; then
        warn "Playwright Python package missing — skipping browser install."
    fi
else
    warn "Skipping Python sidecar (requirements.txt missing or SKIP_PYTHON=1)."
fi

# ── 5. Ollama (optional) ────────────────────────────────────────────────
if [ "$INSTALL_OLLAMA" = "1" ]; then
    if command -v ollama >/dev/null 2>&1; then
        log "Ollama already installed."
    else
        log "Installing Ollama…"
        curl -fsSL https://ollama.com/install.sh | sh \
            || warn "Ollama install failed; local AI animation ideas and Ollama-based voice design may be unavailable."
    fi
    if command -v ollama >/dev/null 2>&1; then
        if ! pgrep -x ollama >/dev/null 2>&1; then
            log "Starting Ollama in the background…"
            (ollama serve >/dev/null 2>&1 &) || true
            sleep 3
        fi
        for model in "$VISION_MODEL" "$TEXT_MODEL"; do
            log "Pulling Ollama model $model (this can take a while)…"
            ollama pull "$model" || warn "Could not pull $model — pull it manually when ready."
        done
    fi
fi

# ── 6. data dirs + .env ────────────────────────────────────────────────
log "Preparing data directories…"
mkdir -p "$SCRIPT_DIR"/data/{imports,projects,fonts,brand-kits,brand-packs,settings}

if [ ! -f "$SCRIPT_DIR/.env" ]; then
    if [ -f "$SCRIPT_DIR/.env.example" ]; then
        cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
        warn "Created .env from .env.example — add API keys as needed."
    else
        cat > "$SCRIPT_DIR/.env" <<'ENV'
# Optional crawler / asset-intel keys. Real env vars take precedence.
# SERPAPI_KEY=
# GOOGLE_PLACES_API_KEY=
# STUDIO_OLLAMA_URL=http://127.0.0.1:11434
# STUDIO_FFMPEG=/usr/bin/ffmpeg
# STUDIO_ADMIN_KEY=
ENV
        warn "Created placeholder .env — add SERPAPI_KEY / GOOGLE_PLACES_API_KEY as needed."
    fi
fi

# ── 7. Verify ──────────────────────────────────────────────────────────
log "Verifying install…"
if command -v node >/dev/null 2>&1; then
    printf '  node          %s\n' "$(node -v)"
    printf '  npm           %s\n' "$(npm -v)"
fi
if [ -x "$VENV_DIR/bin/python" ]; then
    "$VENV_DIR/bin/python" - <<'PY'
import sys
print(f"  python        {sys.version.split()[0]}")
for mod, name in [("PIL","Pillow"),("bs4","beautifulsoup4"),
                  ("lxml","lxml"),("requests","requests"),
                  ("playwright","playwright")]:
    try:
        __import__(mod); print(f"  {name:<13} ok")
    except Exception:
        print(f"  {name:<13} MISSING")
PY
fi
if command -v ffmpeg >/dev/null 2>&1; then
    printf '  ffmpeg        %s\n' "$(ffmpeg -version | head -n1 | awk '{print $3}')"
fi
if command -v ollama >/dev/null 2>&1; then
    printf '  ollama        %s\n' "$(ollama --version 2>/dev/null | head -n1 || echo installed)"
fi

FFMPEG_PATH="$(command -v ffmpeg || echo 'not found')"

# ── 8. Next steps ──────────────────────────────────────────────────────
cat <<EOF

${BOLD}Done.${NC}

Start the studio:
    node server.js

Then open:
    http://127.0.0.1:8008/               Layer Studio v2
    http://127.0.0.1:8008/asset-studio.html   Asset Studio
    http://127.0.0.1:8008/crawler.html        Brand intake
    http://127.0.0.1:8008/library.html        Asset library
    http://127.0.0.1:8008/social.html         Social intelligence
    http://127.0.0.1:8008/admin.html          Management (loopback only)

${DIM}Useful commands${NC}
  Tests (needs Playwright Chromium):  npm run test:smoke && npm run test:visual
  Crawler sidecar:                    source "$VENV_DIR/bin/activate" && npm run crawl
  ffmpeg on PATH:                     $FFMPEG_PATH
  Change port:                        PORT=8010 node server.js

${DIM}Notes${NC}
  • Voice Studio (MLX-Audio) is macOS / Apple Silicon only — on Linux
    /api/tts/* will report unavailable. Everything else works.
  • The AI features need Ollama: rerun with INSTALL_OLLAMA=1 to install it
    and pull ${VISION_MODEL} + ${TEXT_MODEL}.
  • data/ is your work folder (imports, brand packs, fonts); back it up.
  • Optional endpoints need keys in .env:  SERPAPI_KEY (search),
    GOOGLE_PLACES_API_KEY (business discovery).

EOF