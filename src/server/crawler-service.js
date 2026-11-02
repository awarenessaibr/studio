'use strict';
/**
 * crawler-service.js — runs `scripts/crawler-combined.py` for the intake UI.
 *
 * The Python crawler is the source of truth. This module only:
 *   - resolves the venv Python + script,
 *   - runs the read-only `--search-json` / `--discover-json` modes,
 *   - starts a full website + social run as a managed background job,
 *   - keeps a small status/log record under data/_crawler/runs/<id>/.
 *
 * No shell strings: every argument is passed to spawn() as an array member.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data', '_crawler');
const RUNS_DIR = path.join(DATA_DIR, 'runs');
const SCRIPT = path.join(ROOT, 'scripts', 'crawler-combined.py');
const VENV_PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
const JSON_MARKER = '@@CRAWLER_JSON@@';
const MAX_ACTIVE_RUNS = 2;
const MAX_GROUP_TARGETS = 12;
const MAX_LOG_LINES = 240;

const jobs = new Map();          // id -> { child, log: [], logPath, status }
let statusCache = { at: 0, value: null };

function pythonPath() {
    if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
    return process.env.STUDIO_PYTHON || process.env.PYTHON || 'python3';
}

function commandExists(command) {
    if (!command) return false;
    if (command.includes(path.sep)) return fs.existsSync(command);
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    return result.status === 0 && Boolean(String(result.stdout || '').trim());
}

function safeError(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function boundedString(value, label, { max = 160, required = false } = {}) {
    if (value === undefined || value === null) value = '';
    if (typeof value !== 'string') throw safeError(`${label} must be text.`);
    const text = value.trim();
    if (required && !text) throw safeError(`${label} is required.`);
    if (text.length > max) throw safeError(`${label} is too long (${max} characters maximum).`);
    return text;
}

function publicUrl(value, label = 'Website', max = 500) {
    const text = boundedString(value, label, { max, required: true });
    let url;
    try {
        url = new URL(text);
    } catch {
        throw safeError(`${label} must be a valid http(s) URL.`);
    }
    if (!/^https?:$/.test(url.protocol)) throw safeError(`${label} must use http or https.`);
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1'
        || host.endsWith('.localhost') || /^10\./.test(host)
        || /^192\.168\./.test(host) || /^169\.254\./.test(host)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
        throw safeError('Internal or private addresses are not allowed.');
    }
    if (url.username || url.password) throw safeError('URLs with credentials are not allowed.');
    return url.toString();
}

function cleanProfiles(value) {
    const out = {};
    if (value === undefined || value === null) return out;
    if (typeof value !== 'object' || Array.isArray(value)) throw safeError('Profiles must be an object.');
    const allowed = ['instagram', 'facebook', 'tiktok', 'youtube', 'tripadvisor', 'google', 'x', 'threads', 'linkedin'];
    for (const [key, raw] of Object.entries(value)) {
        if (!allowed.includes(key)) continue;
        if (raw === undefined || raw === null || raw === '') continue;
        // Google Maps share URLs can carry long place/data payloads; they are
        // still valid profile seeds and must not be rejected at 500 chars.
        const url = publicUrl(String(raw), `${key} URL`, 8000);
        out[key] = url;
    }
    return out;
}

function cleanHints(value) {
    const out = {};
    if (value === undefined || value === null) return out;
    if (typeof value !== 'object' || Array.isArray(value)) return out;
    if (value.address) out.address = boundedString(value.address, 'Address', { max: 300 });
    if (Array.isArray(value.phones)) {
        out.phones = value.phones.map((p) => boundedString(String(p), 'Phone', { max: 40 })).filter(Boolean).slice(0, 5);
    }
    if (Array.isArray(value.emails)) {
        out.emails = value.emails.map((e) => boundedString(String(e), 'Email', { max: 160 })).filter(Boolean).slice(0, 5);
    }
    return out;
}

function cleanTarget(input) {
    if (!input || typeof input !== 'object') throw safeError('A target is required.');
    const name = boundedString(input.name, 'Business name', { max: 120, required: true });
    const website = publicUrl(input.website);
    return {
        name,
        slug: boundedString(input.slug || '', 'Slug', { max: 80 }),
        city: boundedString(input.city || '', 'City', { max: 80 }),
        region: boundedString(input.region || '', 'Region', { max: 80 }),
        country: boundedString(input.country || '', 'Country', { max: 80 }),
        category: boundedString(input.category || '', 'Category', { max: 80 }),
        website,
        profiles: cleanProfiles(input.profiles),
        hints: cleanHints(input.hints),
    };
}

function cleanTargets(payload) {
    const raw = Array.isArray(payload.targets) ? payload.targets
        : (payload.target && typeof payload.target === 'object' ? [payload.target] : []);
    if (!raw.length) throw safeError('At least one restaurant is required.');
    if (raw.length > MAX_GROUP_TARGETS) {
        throw safeError(`A group can contain at most ${MAX_GROUP_TARGETS} restaurants.`);
    }
    const targets = [];
    const seen = new Set();
    for (const item of raw) {
        const target = cleanTarget(item);
        const key = target.website.replace(/\/+$/, '').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push(target);
    }
    if (!targets.length) throw safeError('At least one restaurant is required.');
    return targets;
}

function parseJsonOutput(stdout, stderr) {
    const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i];
        const index = line.indexOf(JSON_MARKER);
        if (index === -1) continue;
        try {
            return JSON.parse(line.slice(index + JSON_MARKER.length));
        } catch (error) {
            throw safeError(`The crawler returned malformed JSON: ${error.message}`, 502);
        }
    }
    throw safeError(`The crawler returned no JSON.${stderr ? ` ${stderr.slice(0, 500)}` : ''}`, 502);
}

function spawnJson(args, { timeout = 150000 } = {}) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(SCRIPT)) {
            reject(safeError('scripts/crawler-combined.py is missing.', 500));
            return;
        }
        const child = spawn(pythonPath(), [SCRIPT, ...args], {
            cwd: ROOT,
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { child.kill('SIGKILL'); } catch { /* ignore */ }
            reject(safeError('The crawler did not finish in time. Try again, or add a website URL manually.', 504));
        }, timeout);

        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(safeError(`Could not start Python: ${error.message}`, 500));
        });
        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            let payload;
            try {
                payload = parseJsonOutput(stdout, stderr);
            } catch (error) {
                reject(error);
                return;
            }
            if (payload.ok === false) {
                reject(safeError(payload.error || 'The crawler could not complete that request.', 422));
                return;
            }
            resolve(payload);
        });
    });
}

async function status() {
    if (statusCache.value && Date.now() - statusCache.at < 20000) return statusCache.value;
    const fallback = {
        ok: false,
        available: false,
        script: fs.existsSync(SCRIPT),
        python: pythonPath(),
        pythonExists: commandExists(pythonPath()),
        playwright: false,
        pillow: false,
        pdftotext: false,
        venv: false,
    };
    let value = fallback;
    if (fallback.script && fallback.pythonExists) {
        try {
            const result = await spawnJson(['--status-json'], { timeout: 20000 });
            value = {
                ...result,
                available: true,
                pythonVersion: result.python,
                python: pythonPath(),
                pythonExists: true,
                script: true,
            };
        } catch (error) {
            value = { ...fallback, error: error.message };
        }
    }
    statusCache = { at: Date.now(), value };
    return value;
}

async function search({ query, city = '', provider = 'auto', limit = 6 } = {}) {
    const q = boundedString(query, 'Business name', { max: 160, required: true });
    if (q.length < 2) throw safeError('Enter at least two characters.');
    const options = { timeout: 150000 };
    const args = ['--search-json', q, '--search-city', boundedString(city, 'City', { max: 100 }),
        '--search-provider', ['auto', 'maps', 'places', 'nominatim', 'web'].includes(provider) ? provider : 'auto',
        '--search-limit', String(Math.min(10, Math.max(1, Number(limit) || 6)))];
    return spawnJson(args, options);
}

async function discover(payload = {}) {
    const website = publicUrl(payload.website);
    const args = ['--discover-json', '--website', website,
        '--name', boundedString(payload.name || '', 'Business name', { max: 120 }),
        '--city', boundedString(payload.city || '', 'City', { max: 100 }),
        '--category', boundedString(payload.category || '', 'Category', { max: 100 }),
        '--region', boundedString(payload.region || '', 'Region', { max: 100 }),
        '--country', boundedString(payload.country || '', 'Country', { max: 100 }),
        '--discover-pages', String(Math.min(24, Math.max(2, Number(payload.pages) || 8)))];
    const profiles = cleanProfiles(payload.profiles || {});
    if (Object.keys(profiles).length) args.push('--profiles-json', JSON.stringify(profiles));
    const maps = payload.maps && typeof payload.maps === 'object' ? payload.maps : {};
    const cleanMaps = {};
    for (const key of ['rating', 'reviews', 'address', 'phone', 'city', 'category', 'placeUrl']) {
        if (maps[key] !== undefined && maps[key] !== null && maps[key] !== '') cleanMaps[key] = maps[key];
    }
    if (Object.keys(cleanMaps).length) args.push('--maps-json', JSON.stringify(cleanMaps));
    if (payload.guessProfiles) args.push('--guess-profiles');
    if (payload.searchProfiles) args.push('--search-profiles');
    return spawnJson(args, { timeout: 180000 });
}

function runIdFor(name) {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const slug = String(name || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'brand';
    return `${slug}-${stamp}-${crypto.randomBytes(2).toString('hex')}`;
}

function activeRuns() {
    return [...jobs.values()].filter((job) => job.status.state === 'running').length;
}

const SOCIAL_SOURCE_KEYS = new Set([
    'instagram', 'facebook', 'tiktok', 'youtube', 'x', 'threads', 'pinterest', 'linkedin', 'snapchat',
    'google', 'tripadvisor', 'restaurantguru', 'yelp', 'trustpilot', 'opentable', 'thefork',
    'quandoo', 'booking', 'expedia', 'michelin', 'foursquare', 'zomato',
]);

function cleanSocialOptions(input = {}) {
    const options = input && typeof input === 'object' ? input : {};
    const sources = [...new Set((Array.isArray(options.sources) ? options.sources : [])
        .map((source) => String(source || '').trim().toLowerCase())
        .filter((source) => SOCIAL_SOURCE_KEYS.has(source)))];
    const clamp = (value, fallback, max) => {
        const parsed = Number(value);
        return Math.min(max, Math.max(1, Number.isFinite(parsed) ? parsed : fallback));
    };
    return {
        sources,
        deep: Boolean(options.deep),
        maxReviews: clamp(options.maxReviews, 20, 500),
        maxPosts: clamp(options.maxPosts, 6, 60),
        browser: options.browser !== false,
        cache: options.cache !== false,
        assets: options.assets !== false,
        raw: Boolean(options.raw),
        sequential: Boolean(options.sequential),
        merge: options.merge !== false,
    };
}

function findSocialProfile(outputDir) {
    const socialRoot = path.join(outputDir, '_social');
    try {
        return fs.readdirSync(socialRoot, { withFileTypes: true })
            .some((entry) => entry.isDirectory()
                && fs.existsSync(path.join(socialRoot, entry.name, 'business.profile.json')));
    } catch {
        return false;
    }
}

/** Spawn a managed crawler run and wire its log, phase and status file. */
function launchJob({ runDir, outputDir, args, status }) {
    const id = status.id;
    const logPath = status.logPath || path.join(runDir, 'run.log');
    const child = spawn(pythonPath(), args, {
        cwd: ROOT,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
    });
    const job = { child, log: status.log, logPath, status, runDir, outputDir };
    jobs.set(id, job);

    const append = (chunk, stream) => {
        const text = chunk.toString();
        for (const line of text.split(/\r?\n/)) {
            if (!line) continue;
            job.log.push(line);
            if (job.log.length > MAX_LOG_LINES) job.log.shift();
            try {
                fs.appendFileSync(logPath, `${stream === 'err' ? '! ' : ''}${line}\n`);
            } catch { /* ignore log write errors */ }
        }
        updatePhase(job);
    };
    child.stdout.on('data', (chunk) => append(chunk, 'out'));
    child.stderr.on('data', (chunk) => append(chunk, 'err'));
    child.on('error', async (error) => {
        job.status.state = 'failed';
        job.status.error = `Could not start Python: ${error.message}`;
        job.status.finishedAt = new Date().toISOString();
        await writeStatus(runDir, job.status);
    });
    child.on('close', async (code) => {
        job.status.exitCode = code;
        job.status.finishedAt = new Date().toISOString();
        job.status.zip = status.kind === 'social' ? '' : (findZip(outputDir) || '');
        if (job.status.state === 'cancelled') {
            job.status.phase = 'cancelled';
        } else if (code === 0 && (status.kind === 'social' ? findSocialProfile(outputDir) : job.status.zip)) {
            job.status.state = 'done';
            job.status.phase = 'done';
        } else {
            job.status.state = 'failed';
            job.status.phase = 'failed';
            job.status.error = job.status.error || lastError(job.log)
                || (status.kind === 'social' && code === 0
                    ? 'The social crawl finished without producing a business profile. Check the log for the source failure.'
                    : `The crawler exited with code ${code}.`);
        }
        await writeStatus(runDir, job.status);
    });

    return publicStatus(job);
}

async function startSocialRun(payload = {}) {
    if (activeRuns() >= MAX_ACTIVE_RUNS) {
        throw safeError('Two crawls are already running. Wait for one to finish or cancel it.', 429);
    }
    const target = cleanTarget(payload.target || {});
    const group = boundedString(payload.group || target.name, 'Group name', { max: 120 });
    const options = cleanSocialOptions(payload.options || payload);
    const website = String(target.website || '').replace(/\/+$/, '').toLowerCase();
    for (const job of jobs.values()) {
        if (job.status.state !== 'running' || job.status.kind !== 'social') continue;
        if (String(job.status.target?.website || '').replace(/\/+$/, '').toLowerCase() === website) {
            throw safeError('A social crawl for this business is already running.', 429);
        }
    }
    const id = runIdFor(`${target.name}-social`);
    const runDir = path.join(RUNS_DIR, id);
    const outputDir = path.join(runDir, 'output');
    await fsp.mkdir(outputDir, { recursive: true });
    // load_saved_targets() reads targets.json from the output root. Writing it
    // there is what keeps this run to the one business instead of every
    // pre-configured target in the script.
    await fsp.writeFile(path.join(runDir, 'target.json'), JSON.stringify([target], null, 2));
    await fsp.writeFile(path.join(outputDir, 'targets.json'), JSON.stringify([target], null, 2));

    const args = [SCRIPT, '--social-only', '--standalone',
        '--output-root', outputDir,
        '--group', group,
        '--max-reviews', String(options.maxReviews),
        '--max-posts', String(options.maxPosts)];
    if (options.sources.length) args.push('--only', options.sources.join(','));
    if (options.deep) args.push('--deep');
    if (!options.browser) args.push('--no-browser');
    if (!options.cache) args.push('--no-cache');
    if (!options.assets) args.push('--no-assets');
    if (options.raw) args.push('--keep-raw');
    if (options.sequential) args.push('--sequential');
    if (!options.merge) args.push('--no-merge');

    const status = {
        kind: 'social',
        id,
        state: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        error: '',
        target,
        targets: [target],
        targetCount: 1,
        group,
        groupDescription: `Social and reputation re-crawl for ${target.name}.`,
        options,
        runDir,
        outputDir,
        zip: '',
        importedPackId: '',
        phase: 'social',
        log: [],
    };
    status.logPath = path.join(runDir, 'run.log');
    await fsp.writeFile(status.logPath, '');
    await writeStatus(runDir, status);
    return launchJob({ runDir, outputDir, args, status });
}

async function startRun(payload = {}) {
    if (activeRuns() >= MAX_ACTIVE_RUNS) {
        throw safeError('Two crawls are already running. Wait for one to finish or cancel it.', 429);
    }
    const targets = cleanTargets(payload);
    const target = targets[0];
    const group = boundedString(payload.group || target.name, 'Group name', { max: 120, required: true });
    const description = boundedString(payload.groupDescription
        || `Brand kit generated from a studio intake crawl for ${group}.`,
    'Group description', { max: 300 });
    const options = {
        social: payload.social !== false,
        browser: payload.browser !== false,
        deep: Boolean(payload.deep),
        maxPages: Math.min(200, Math.max(2, Number(payload.maxPages) || 60)),
        maxReviews: Math.min(500, Math.max(0, Number(payload.maxReviews) || 20)),
        maxPosts: Math.min(60, Math.max(0, Number(payload.maxPosts) || 6)),
    };

    const id = runIdFor(group);
    const runDir = path.join(RUNS_DIR, id);
    const outputDir = path.join(runDir, 'output');
    await fsp.mkdir(outputDir, { recursive: true });
    const targetPath = path.join(runDir, 'target.json');
    await fsp.writeFile(targetPath, JSON.stringify(targets, null, 2));

    const args = [SCRIPT, ...targets.map((entry) => entry.website),
        '--targets', targetPath,
        '--output-root', outputDir,
        '--group', group,
        '--group-description', description,
        '--max-pages', String(options.maxPages),
        '--max-reviews', String(options.maxReviews),
        '--max-posts', String(options.maxPosts),
        '--force'];
    if (!options.social) args.push('--skip-social');
    if (!options.browser) args.push('--no-browser');
    if (options.deep) args.push('--deep');

    const status = {
        id,
        state: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        error: '',
        target,
        targets,
        targetCount: targets.length,
        group,
        groupDescription: description,
        options,
        runDir,
        outputDir,
        zip: '',
        importedPackId: '',
        phase: 'starting',
        log: [],
    };
    const logPath = path.join(runDir, 'run.log');
    status.logPath = logPath;
    await fsp.writeFile(logPath, '');
    await writeStatus(runDir, status);

    return launchJob({ runDir, outputDir, args, status });
}

function updatePhase(job) {
    const text = job.log.join('\n');
    let phase = job.status.kind === 'social' ? 'social' : 'website';
    const current = [...text.matchAll(/^\[(\d+)\/(\d+)\]\s+(\S+)/gm)].pop();
    if (current) {
        job.status.currentIndex = Number(current[1]);
        job.status.currentUrl = current[3];
        job.status.phase = job.status.kind === 'social' ? 'social' : 'website';
    }
    if (/Social target:/.test(text)) phase = 'website';
    if (/Social & reputation phase|\[1\/\d+\] The |profiles resolved/.test(text)) phase = 'social';
    if (/consolidat|group report|Summary/.test(text)) phase = 'social';
    if (/Brand pack:/.test(text)) phase = 'packaging';
    if (/Finished in/.test(text)) phase = 'done';
    job.status.phase = phase;
}

function lastError(lines) {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (/^(?:\s*[x!]|\s*Traceback|\w*Error:)/.test(lines[i])) return lines[i].replace(/^\s*[x!]\s*/, '').slice(0, 400);
    }
    return '';
}

function findZip(outputDir) {
    try {
        const files = fs.readdirSync(outputDir)
            .filter((name) => name.toLowerCase().endsWith('.zip'))
            .map((name) => path.join(outputDir, name))
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        return files[0] || '';
    } catch {
        return '';
    }
}

async function writeStatus(runDir, status) {
    const copy = { ...status, log: undefined, logPath: undefined };
    await fsp.writeFile(path.join(runDir, 'status.json'), JSON.stringify(copy, null, 2));
}

function publicStatus(job) {
    const status = job.status;
    return {
        kind: status.kind || 'full',
        id: status.id,
        state: status.state,
        startedAt: status.startedAt,
        finishedAt: status.finishedAt,
        exitCode: status.exitCode,
        error: status.error,
        target: status.target,
        targets: status.targets || (status.target ? [status.target] : []),
        targetCount: status.targetCount || (status.targets || []).length || (status.target ? 1 : 0),
        currentIndex: status.currentIndex || 0,
        currentUrl: status.currentUrl || '',
        group: status.group,
        options: status.options,
        phase: status.phase,
        zip: status.zip ? path.basename(status.zip) : '',
        zipPath: status.zip || '',
        importedPackId: status.importedPackId || '',
        log: (job.log || []).slice(-120),
        outputDir: status.outputDir,
    };
}

async function getRun(id) {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(String(id || ''))) throw safeError('Invalid run id.', 400);
    const job = jobs.get(id);
    if (job) {
        updatePhase(job);
        return publicStatus(job);
    }
    const runDir = path.join(RUNS_DIR, id);
    let raw;
    try {
        raw = await fsp.readFile(path.join(runDir, 'status.json'), 'utf8');
    } catch {
        throw safeError('Run not found.', 404);
    }
    const status = JSON.parse(raw);
    let log = [];
    try {
        log = (await fsp.readFile(path.join(runDir, 'run.log'), 'utf8')).split(/\r?\n/).filter(Boolean).slice(-120);
    } catch { /* ignore */ }
    if (status.state === 'running') {
        status.state = 'interrupted';
        status.error = status.error || 'The server restarted while this run was in progress.';
    }
    return {
        ...status,
        targets: status.targets || (status.target ? [status.target] : []),
        targetCount: status.targetCount || (status.targets || []).length || (status.target ? 1 : 0),
        zip: status.zip ? path.basename(status.zip) : '',
        zipPath: status.zip || '',
        log,
    };
}

async function listRuns() {
    let dirs = [];
    try {
        dirs = await fsp.readdir(RUNS_DIR, { withFileTypes: true });
    } catch {
        return [];
    }
    const runs = [];
    for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const runDir = path.join(RUNS_DIR, dir.name);
        try {
            const status = JSON.parse(await fsp.readFile(path.join(runDir, 'status.json'), 'utf8'));
            // Social re-crawls belong to the Social page, not the intake list.
            if (status.kind === 'social') continue;
            const job = jobs.get(dir.name);
            const state = job ? job.status.state
                : (status.state === 'running' ? 'interrupted' : status.state);
            runs.push({
                id: status.id,
                state,
                startedAt: status.startedAt,
                finishedAt: status.finishedAt,
                group: status.group,
                name: ((status.targets || []).length > 1)
                    ? `${status.group} (${status.targets.length} restaurants)`
                    : ((status.target || {}).name || status.group),
                targetCount: (status.targets || []).length || (status.target ? 1 : 0),
                zip: status.zip ? path.basename(status.zip) : '',
                importedPackId: status.importedPackId || '',
                error: status.error || '',
            });
        } catch { /* ignore incomplete run folders */ }
    }
    return runs.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 30);
}

async function cancelRun(id) {
    const job = jobs.get(id);
    if (!job) throw safeError('That run is not active.', 409);
    if (job.status.state !== 'running') return publicStatus(job);
    try {
        process.kill(-job.child.pid, 'SIGTERM');
    } catch {
        try { job.child.kill('SIGTERM'); } catch { /* ignore */ }
    }
    job.status.state = 'cancelled';
    job.status.error = 'Cancelled by the user.';
    job.status.finishedAt = new Date().toISOString();
    await writeStatus(job.runDir, job.status);
    return publicStatus(job);
}

async function zipForRun(id) {
    const run = await getRun(id);
    if (run.state !== 'done' || !run.zipPath) throw safeError('This run has no finished ZIP yet.', 409);
    const resolved = path.resolve(run.zipPath);
    if (!resolved.startsWith(path.resolve(RUNS_DIR) + path.sep)) throw safeError('Invalid run output.', 400);
    if (!fs.existsSync(resolved)) throw safeError('The run ZIP is missing on disk.', 404);
    return resolved;
}

async function markImported(id, packId) {
    const job = jobs.get(id);
    if (job) {
        job.status.importedPackId = packId;
        await writeStatus(job.runDir, job.status);
        return;
    }
    const runDir = path.join(RUNS_DIR, id);
    try {
        const status = JSON.parse(await fsp.readFile(path.join(runDir, 'status.json'), 'utf8'));
        status.importedPackId = packId;
        await writeStatus(runDir, status);
    } catch { /* ignore */ }
}

module.exports = {
    status,
    search,
    discover,
    startRun,
    startSocialRun,
    cleanSocialOptions,
    getRun,
    listRuns,
    cancelRun,
    zipForRun,
    markImported,
    cleanTargets,
    RUNS_DIR,
};
