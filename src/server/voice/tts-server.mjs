/* Managed MLX-Audio server + the one speech seam the TTS page needs.
 *
 * The TTS page (`tts-management.html`) talks to an OpenAI-compatible server on
 * :8771 directly. On this machine that server exists — it is Olivia's
 * `.tts-venv` with `mlx_audio` and 38 GB of cached models — but nothing started
 * it, so the page rendered `unreachable`. This module owns that lifecycle:
 *
 *   probe → reuse an externally started server, or spawn the local one
 *   link  → expose the cached HF models to a project-local HF_HOME
 *   ready → register the cached voice-design model and proxy speech requests
 *
 * Constraints, both deliberate:
 *   • Olivia's tree is never written. Its model cache is linked (read-only in
 *     practice) into `<repo>/.cache/huggingface`, and the server runs with
 *     HF_HUB_OFFLINE by default so it cannot download into a linked directory.
 *   • No dependency is installed by this module. If no MLX-Audio python is
 *     found, the status says exactly that and the page keeps its honest
 *     `unreachable` state.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './tts-config.mjs';

const MAX_AUDIO_BYTES = Number(process.env.OIA_TTS_AUDIO_MAX_BYTES) || 48 * 1024 * 1024;

const state = {
  phase: 'idle',       // idle | starting | registering | ready | external | failed | disabled
  owned: false,
  pid: null,
  error: null,
  startedAt: null,
  readyAt: null,
  registering: false,
  models: [],
  registered: [],
  lastProbeAt: 0,
  lastProbeOk: false,
  logFile: null,
};

let starting = null;
let child = null;
let probeCache = { at: 0, ok: false, models: [], error: null };

function baseUrl() {
  return config.tts.url.replace(/\/+$/, '');
}

function localTarget() {
  try {
    const parsed = new URL(baseUrl());
    const host = parsed.hostname.toLowerCase();
    const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return { parsed, local };
  } catch {
    return { parsed: null, local: false };
  }
}

/** A short, bounded HTTP probe; never throws. */
async function probe({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - probeCache.at < 1500) return probeCache;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${baseUrl()}/v1/models`, { signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    const models = Array.isArray(body?.data) ? body.data.map((m) => m?.id).filter(Boolean) : [];
    probeCache = { at: now, ok: res.ok, status: res.status, models, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    probeCache = {
      at: now,
      ok: false,
      status: 0,
      models: [],
      error: err.name === 'AbortError' ? 'probe timed out' : (err.message || String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
  state.lastProbeAt = now;
  state.lastProbeOk = probeCache.ok;
  if (probeCache.ok) state.models = probeCache.models;
  return probeCache;
}

/* ── local installation discovery ───────────────────────────────────────── */

/** Candidate python executables, most specific first. */
function pythonCandidates() {
  const list = [];
  if (config.tts.python) list.push(config.tts.python);
  // The UI is vendored (olivia/frontend), but the MLX-Audio environment is a
  // 1.4 GB installed runtime, not a UI asset: it stays where it was installed.
  // OIA_TTS_VENV overrides it; a repo-local venv wins when one exists.
  list.push(join(config.repoRoot, '.tts-venv', 'bin', 'python'));
  list.push(join(config.tts.externalVenv, 'bin', 'python'));
  list.push('python3');
  return list;
}

let pythonCache = null;
function findPython() {
  if (pythonCache !== null) return pythonCache;
  for (const candidate of pythonCandidates()) {
    if (candidate.includes('/') && !existsSync(candidate)) continue;
    // `python3` from PATH is only accepted if mlx_audio is importable; that is
    // checked lazily by the caller because the import can take ~1s.
    pythonCache = candidate;
    return candidate;
  }
  pythonCache = null;
  return null;
}

function canImportMlx(python) {
  return new Promise((resolveImport) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolveImport(ok);
    };
    let proc;
    try {
      proc = spawn(python, ['-c', 'import mlx_audio, sys; sys.stdout.write("ok")'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      });
    } catch {
      done(false);
      return;
    }
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      done(false);
    }, 15000);
    proc.stdout.on('data', (chunk) => {
      if (String(chunk).includes('ok')) done(true);
    });
    proc.on('error', () => { clearTimeout(timer); done(false); });
    proc.on('close', (code) => { clearTimeout(timer); done(code === 0); });
  });
}

/**
 * Make the cached model directories visible to a project-local HF_HOME by
 * symlinking `models--*` entries. Nothing inside Olivia is written: Hugging Face
 * writes locks and downloads under our HF_HOME (and offline mode prevents the
 * latter from reaching a linked directory at all).
 */
function linkModelCache() {
  const hfHome = config.tts.hfHome;
  mkdirSync(join(hfHome, 'hub'), { recursive: true });
  const sourceHub = join(config.tts.modelSource, 'hub');
  if (!existsSync(sourceHub)) return { linked: 0, note: `no model cache at ${sourceHub}` };
  let linked = 0;
  for (const name of readdirSync(sourceHub)) {
    if (!name.startsWith('models--')) continue;
    const target = join(hfHome, 'hub', name);
    if (existsSync(target)) continue;
    try {
      symlinkSync(join(sourceHub, name), target, 'dir');
      linked += 1;
    } catch { /* an unreadable cache entry is not fatal */ }
  }
  return { linked, hfHome, sourceHub };
}

/** Models worth registering automatically: cached TTS voice-design models. */
function cachedVoiceDesignModels() {
  const hub = join(config.tts.hfHome, 'hub');
  if (!existsSync(hub)) return [];
  const found = [];
  for (const name of readdirSync(hub)) {
    if (!/qwen3-tts.*voicedesign/i.test(name)) continue;
    const model = name.replace(/^models--/, '').replace(/--/g, '/');
    // A snapshot must actually be present, not just an empty cache folder.
    const dir = join(hub, name, 'snapshots');
    if (existsSync(dir) && readdirSync(dir).length) found.push(model);
  }
  return found;
}

async function registerModel(model) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8 * 60 * 1000);
  state.registering = true;
  state.phase = 'registering';
  try {
    const res = await fetch(`${baseUrl()}/v1/models?model_name=${encodeURIComponent(model)}`, {
      method: 'POST',
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.detail || `HTTP ${res.status}`);
    if (!state.registered.includes(model)) state.registered.push(model);
    return true;
  } finally {
    clearTimeout(timer);
    state.registering = false;
    state.phase = state.owned ? 'ready' : (state.lastProbeOk ? 'external' : state.phase);
  }
}

async function autoRegisterModels() {
  const configured = config.tts.autoRegister;
  const models = Array.isArray(configured) && configured.length
    ? configured
    : (configured === null ? cachedVoiceDesignModels() : []);
  if (!models.length) return;
  for (const model of models) {
    try {
      await registerModel(model);
    } catch (err) {
      state.error = `could not register ${model}: ${err.message}`;
    }
  }
}

/* ── lifecycle ──────────────────────────────────────────────────────────── */

function spawnServer(python) {
  const { parsed } = localTarget();
  const port = parsed?.port || 8771;
  const host = parsed?.hostname && parsed.hostname !== 'localhost' ? parsed.hostname : '127.0.0.1';
  const logDir = join(config.state.dir, 'tts');
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, 'mlx-audio.log');
  state.logFile = logFile;

  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    // The launcher's DSH_* describe its own session; a TTS child does not need them.
    if (key.startsWith('DSH_')) continue;
    env[key] = value;
  }
  env.HF_HOME = config.tts.hfHome;
  env.PYTHONUNBUFFERED = '1';
  env.PYTHONDONTWRITEBYTECODE = '1';
  if (config.tts.offline) {
    env.HF_HUB_OFFLINE = '1';
    env.TRANSFORMERS_OFFLINE = '1';
  }
  env.HF_HUB_DISABLE_TELEMETRY = '1';

  const origins = [
    `http://127.0.0.1:${config.http.port}`,
    `http://localhost:${config.http.port}`,
  ];
  const args = [
    '-m', 'mlx_audio.server',
    '--host', host,
    '--port', String(port),
    '--allowed-origins', ...origins,
    '--log-dir', join(logDir, 'logs'),
  ];

  const fd = openSync(logFile, 'a');
  const proc = spawn(python, args, {
    cwd: config.state.dir,
    env,
    stdio: ['ignore', fd, fd],
  });
  proc.on('error', (err) => {
    state.phase = 'failed';
    state.error = `failed to start MLX-Audio: ${err.message}`;
    state.pid = null;
    state.owned = false;
  });
  proc.on('exit', (code, signal) => {
    if (state.pid === proc.pid) {
      state.owned = false;
      state.pid = null;
      state.phase = code === 0 ? 'idle' : 'failed';
      if (code !== 0) state.error = `MLX-Audio exited (${signal || code}); see ${logFile}`;
    }
  });
  return proc;
}

async function waitUntilReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const p = await probe({ force: true });
    if (p.ok) return p;
    if (state.phase === 'failed') return p;
    await new Promise((r) => setTimeout(r, 500));
  }
  return probe({ force: true });
}

/**
 * Ensure a TTS server is answering. Returns the status snapshot.
 * Concurrent callers share one start attempt.
 */
export function ensureTtsServer() {
  if (starting) return starting;
  const { local } = localTarget();
  if (!local) {
    // A remote MLX server is the operator's business; probe, never spawn.
    return probe({ force: true }).then((p) => {
      state.phase = p.ok ? 'external' : 'failed';
      if (!p.ok) state.error = p.error || 'remote TTS server is unreachable';
      return ttsStatus();
    });
  }
  if (!config.tts.autostart) {
    return probe({ force: true }).then((p) => {
      state.phase = p.ok ? 'external' : 'disabled';
      if (!p.ok) state.error = 'OIA_TTS_AUTOSTART=0 and nothing is listening on ' + baseUrl();
      return ttsStatus();
    });
  }

  starting = (async () => {
    const first = await probe({ force: true });
    if (first.ok) {
      // A later call must not "forget" that this adapter spawned the server (the
      // speech and preview paths call ensure repeatedly). Ownership is sticky
      // until stop/shutdown.
      state.phase = state.owned ? 'ready' : 'external';
      state.error = null;
      if (state.registered.length === 0) await autoRegisterModels().catch(() => {});
      return ttsStatus();
    }

    const python = findPython();
    if (!python || !(await canImportMlx(python))) {
      state.phase = 'failed';
      state.error = python
        ? `${python} cannot import mlx_audio; set OIA_MLX_TTS_PYTHON to an MLX-Audio venv`
        : 'no MLX-Audio python found; set OIA_MLX_TTS_PYTHON or install mlx-audio';
      return ttsStatus();
    }

    const link = linkModelCache();
    if (link.linked) {
      state.error = null;
    }
    state.phase = 'starting';
    state.owned = true;
    state.startedAt = new Date().toISOString();
    state.error = null;
    child = spawnServer(python);
    state.pid = child.pid || null;

    const ready = await waitUntilReady(config.tts.startTimeoutMs);
    if (!ready.ok) {
      state.phase = 'failed';
      state.error = ready.error || `MLX-Audio did not become ready in ${config.tts.startTimeoutMs}ms`;
      return ttsStatus();
    }
    state.phase = 'ready';
    state.readyAt = new Date().toISOString();
    state.models = ready.models;
    // Model registration loads weights; do it after the API is up, and let the
    // page connect while that happens.
    autoRegisterModels().catch((err) => { state.error = err.message; });
    return ttsStatus();
  })().finally(() => { starting = null; });

  return starting;
}

export function stopTtsServer() {
  if (!child || !state.owned) return { ok: true, stopped: false, note: 'no managed server' };
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  const pid = child.pid;
  state.owned = false;
  state.pid = null;
  state.phase = 'idle';
  child = null;
  return { ok: true, stopped: true, pid };
}

/* ── status + proxy ─────────────────────────────────────────────────────── */

export async function ttsStatus() {
  const p = await probe();
  let phase = state.phase;
  if (state.registering) {
    // Loading weights blocks the server's HTTP loop; a probe timeout here is
    // expected, not a failure. Say "registering" while it works.
    phase = 'registering';
  } else if (p.ok) {
    phase = state.owned ? 'ready' : 'external';
  } else if (phase === 'ready') {
    phase = 'starting';       // transient while the model server is busy
  } else if (phase === 'external' && p.status === 0) {
    phase = 'starting';
  }
  const ready = p.ok && !state.registering;
  return {
    url: baseUrl(),
    phase,
    ready,
    managed: state.owned,
    pid: state.pid,
    models: p.models || state.models,
    registered: state.registered,
    autostart: config.tts.autostart,
    hfHome: config.tts.hfHome,
    modelSource: config.tts.modelSource,
    offline: config.tts.offline,
    startedAt: state.startedAt,
    readyAt: state.readyAt,
    error: ready ? null : (state.registering ? null : (state.error || p.error || null)),
    logFile: state.logFile,
    probeAt: new Date(p.at || Date.now()).toISOString(),
  };
}

/** Read a JSON endpoint from MLX-Audio, ensuring the server first. */
export async function ttsJson(path, { method = 'GET' } = {}) {
  await ensureTtsServer();
  const res = await fetch(`${baseUrl()}${path}`, { method });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const detail = body?.detail || body?.error || `HTTP ${res.status}`;
    throw Object.assign(new Error(`MLX-Audio: ${detail}`), { status: 502 });
  }
  return body;
}

/**
 * POST /v1/audio/speech. Returns `{ bytes, contentType, engine }`.
 * `payload` is the OpenAI-shaped body the TTS page sends.
 */
export async function ttsSpeech(payload, { timeoutMs = config.tts.speechTimeoutMs } = {}) {
  await ensureTtsServer();
  // A model must be registered before it can synthesise; this also waits out a
  // registration that is already loading so a preview does not race it.
  if (payload?.model) await ttsEnsureModel(payload.model);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const attempt = async () => {
    const res = await fetch(`${baseUrl()}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/*' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let detail = text;
      try { detail = JSON.parse(text)?.detail || text; } catch { /* plain text */ }
      throw Object.assign(
        new Error(`MLX-Audio speech failed: ${String(detail).slice(0, 300)}`),
        { status: 502 },
      );
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) throw Object.assign(new Error('MLX-Audio returned empty audio'), { status: 502 });
    if (buffer.length > MAX_AUDIO_BYTES) {
      throw Object.assign(new Error(`audio exceeds ${MAX_AUDIO_BYTES} bytes`), { status: 413 });
    }
    return {
      bytes: buffer,
      contentType: res.headers.get('content-type') || 'audio/mpeg',
      engine: 'mlx-audio',
    };
  };

  try {
    try {
      return await attempt();
    } catch (err) {
      // A dropped keep-alive between the adapter and the model server is not a
      // synthesis failure; one retry is safe because TTS has no side effects.
      if (err.status || err.name === 'AbortError' || controller.signal.aborted) throw err;
      await new Promise((resolveWait) => setTimeout(resolveWait, 300));
      return await attempt();
    }
  } catch (err) {
    if (err.name === 'AbortError' || controller.signal.aborted) {
      throw Object.assign(new Error('MLX-Audio synthesis timed out'), { status: 504 });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Synchronous snapshot for `/api/book/engines`; never starts anything. */
export function ttsSnapshot() {
  const { local } = localTarget();
  return {
    url: baseUrl(),
    local,
    phase: state.phase,
    ready: state.lastProbeOk,
    managed: state.owned,
    models: state.models,
    error: state.error,
  };
}

/**
 * Make sure a model is registered on the server. Registration loads weights, so
 * this is the slow path (first use of a designed voice's cloning model).
 */
export async function ttsEnsureModel(model) {
  const name = String(model || '').trim();
  if (!name) throw Object.assign(new Error('model is required'), { status: 400 });
  await ensureTtsServer();
  // Wait out a registration already in progress (the model server blocks while
  // loading weights, so probing now would only time out).
  const deadline = Date.now() + 8 * 60 * 1000;
  while (state.registering && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  let p = await probe({ force: true });
  if (!p.ok) {
    // A speech request or model load can block the server's loop past the probe
    // timeout. One short retry distinguishes "busy" from "down".
    await new Promise((resolveWait) => setTimeout(resolveWait, 600));
    p = await probe({ force: true });
  }
  if (!p.ok) {
    throw Object.assign(
      new Error(`MLX-Audio is not available: ${state.error || p.error || 'unknown reason'}`),
      { status: 503 },
    );
  }
  if (p.models.includes(name)) return { model: name, registered: true, loaded: false };
  await registerModel(name);
  await probe({ force: true });
  return { model: name, registered: true, loaded: true };
}

