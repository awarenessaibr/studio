'use strict';
/**
 * asset-service.js — optional Python sidecar runner for asset inspection and
 * image operations. Mirrors crawler-service.js: when the venv or Pillow is
 * absent, status says why and the store degrades to metadata-only.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'asset-intel.py');
const VENV_PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
const TIMEOUT = 20000;

let cache = { at: 0, value: null };

function pythonPath() {
    if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
    return process.env.STUDIO_PYTHON || process.env.PYTHON || 'python3';
}

function run(args, { timeout = TIMEOUT } = {}) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(SCRIPT)) {
            reject(new Error('scripts/asset-intel.py is missing.'));
            return;
        }
        const child = spawn(pythonPath(), [SCRIPT, ...args], {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { child.kill('SIGKILL'); } catch { /* ignore */ }
            reject(new Error('The asset sidecar timed out.'));
        }, timeout);
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(new Error(`Could not start the asset sidecar: ${error.message}`));
        });
        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            let payload = null;
            try { payload = JSON.parse(stdout.trim() || '{}'); } catch { /* below */ }
            if (!payload) {
                reject(new Error(`The asset sidecar returned invalid JSON${stderr ? `: ${stderr.slice(0, 300)}` : ''}`));
                return;
            }
            if (payload.ok === false) {
                reject(new Error(payload.error || `The asset sidecar failed (${code}).`));
                return;
            }
            resolve(payload);
        });
    });
}

async function status() {
    if (cache.value && Date.now() - cache.at < 20000) return cache.value;
    const base = {
        ok: true,
        available: false,
        python: pythonPath(),
        script: fs.existsSync(SCRIPT),
        pillow: false,
        ocr: false,
        pdftotext: false,
    };
    if (!base.script) {
        cache = { at: Date.now(), value: { ...base, reason: 'scripts/asset-intel.py is missing' } };
        return cache.value;
    }
    try {
        const payload = await run(['status'], { timeout: 8000 });
        cache = {
            at: Date.now(),
            value: { ...base, ...payload, available: Boolean(payload.pillow), reason: payload.pillow ? '' : 'Pillow is not installed' },
        };
    } catch (error) {
        cache = { at: Date.now(), value: { ...base, reason: error.message } };
    }
    return cache.value;
}

async function inspect(filePath) {
    return run(['inspect', filePath]);
}

async function operate(op, input, output, params = {}) {
    return run(['operate', '--op', op, '--input', input, '--output', output, '--params', JSON.stringify(params)]);
}

async function extract(filePath) {
    return run(['extract', filePath]);
}

module.exports = { status, inspect, operate, extract, pythonPath };
