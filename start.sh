#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RUN_DIR="$SCRIPT_DIR/.run"
PID_FILE="$RUN_DIR/server.pid"
LOG_FILE="$RUN_DIR/server.log"
SERVER="$SCRIPT_DIR/server.js"
SERVER_NAME="$(basename "$SERVER")"

if ! command -v node >/dev/null 2>&1; then
    printf 'node was not found. Run ./install.sh or install Node.js.\n' >&2
    exit 1
fi

is_server_process() {
    local pid="$1"
    local args process_cwd
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    process_cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
    [[ "$args" == *"$SERVER"* || ( "$process_cwd" == "$SCRIPT_DIR" && "$args" == *"$SERVER_NAME"* ) ]]
}

studio_on_port() {
    node -e 'fetch(`http://127.0.0.1:${process.argv[1]}/api/health`).then(async response => { const body = await response.json(); process.exit(response.ok && body.ok ? 0 : 1); }).catch(() => process.exit(1));' "$1"
}

find_server_process() {
    local process_dir pid
    for process_dir in /proc/[0-9]*; do
        pid="${process_dir##*/}"
        if is_server_process "$pid"; then
            printf '%s\n' "$pid"
            return 0
        fi
    done
    return 1
}

if [ -f "$PID_FILE" ]; then
    old_pid="$(<"$PID_FILE")"
    if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" 2>/dev/null && is_server_process "$old_pid"; then
        if studio_on_port "${PORT:-8008}"; then
            printf 'Studio is already running on port %s (PID %s).\n' "${PORT:-8008}" "$old_pid"
            exit 0
        fi
        printf 'Studio process %s is running, but it is not serving on port %s. Stop it with ./stop.sh before restarting.\n' "$old_pid" "${PORT:-8008}" >&2
        exit 1
    fi
    printf 'Removing stale PID file.\n'
    rm -f "$PID_FILE"
fi

if existing_pid="$(find_server_process)"; then
    if studio_on_port "${PORT:-8008}"; then
        printf '%s\n' "$existing_pid" >"$PID_FILE"
        printf 'Studio is already running on port %s (PID %s); recorded it for ./stop.sh.\n' "${PORT:-8008}" "$existing_pid"
        exit 0
    fi
    printf 'Studio process %s is running, but it is not serving on port %s. Stop it before restarting.\n' "$existing_pid" "${PORT:-8008}" >&2
    exit 1
fi

requested_port="${PORT:-8008}"
if [[ ! "$requested_port" =~ ^[0-9]+$ ]] || [ "$requested_port" -lt 1 ] || [ "$requested_port" -gt 65535 ]; then
    printf 'PORT must be an integer between 1 and 65535 (got %s).\n' "$requested_port" >&2
    exit 1
fi
requested_port=$((10#$requested_port))
host="${HOST:-0.0.0.0}"
if ! node -e 'const net = require("node:net"); const server = net.createServer(); server.once("error", () => process.exit(1)); server.listen({ port: Number(process.argv[1]), host: process.argv[2] }, () => server.close(() => process.exit(0)));' "$requested_port" "$host"; then
    printf 'Port %s is occupied; refusing to start Studio on a different port.\n' "$requested_port" >&2
    exit 1
fi

mkdir -p "$RUN_DIR"
PORT="$requested_port" HOST="$host" nohup node "$SERVER" >"$LOG_FILE" 2>&1 </dev/null &
pid=$!
printf '%s\n' "$pid" >"$PID_FILE"

sleep 1
if ! kill -0 "$pid" 2>/dev/null || ! is_server_process "$pid"; then
    rm -f "$PID_FILE"
    printf 'Studio failed to start. See %s\n' "$LOG_FILE" >&2
    exit 1
fi

printf 'Studio started (PID %s): http://127.0.0.1:%s/\n' "$pid" "$requested_port"
printf 'Log: %s\n' "$LOG_FILE"
