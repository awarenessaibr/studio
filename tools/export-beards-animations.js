#!/usr/bin/env node
'use strict';

/**
 * Bake the animation library into standalone compositions.
 *
 * Each entry in data/imports/<project>/animations.json is applied through the
 * studio's own rig v3, then exported with its keyframes baked in. The result is
 * a set of files under data/projects/Beards/compositions/<animation-id>.composition.json,
 * one per animation, so they appear in the project/composition selectors and can
 * be played immediately.
 *
 * Usage:
 *   node tools/export-beards-animations.js [--project beards-20261019000756-e757]
 *                                         [--out data/projects/Beards]
 *                                         [--server-port 8123]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
};
const PROJECT_ID = argValue('--project', 'beards-20261019000756-e757');
const SERVER_PORT = Number(argValue('--server-port', 8123));
const DEBUG_PORT = Number(argValue('--chrome-port', 9415));
const OUT_DIR = path.resolve(ROOT, argValue('--out', 'data/projects/Beards'));
const COMPOSITION_DIR = path.join(OUT_DIR, 'compositions');
const IMPORTS_DIR = path.join(ROOT, 'data', 'imports', PROJECT_ID);
const ANIMATIONS_FILE = path.join(IMPORTS_DIR, 'animations.json');
const COMPOSITION_FILE = path.join(IMPORTS_DIR, 'composition.json');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (response) => {
            let data = '';
            response.on('data', (chunk) => { data += chunk; });
            response.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
            });
        }).on('error', reject);
    });
}

function slug(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

async function connectChrome() {
    const chrome = spawn(CHROME, [
        '--headless=new',
        `--remote-debugging-port=${DEBUG_PORT}`,
        '--user-data-dir=/tmp/dsh-chrome-beards-animations',
        '--no-sandbox',
        '--disable-crash-reporter',
        '--disable-breakpad',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1500,950',
        'about:blank',
    ], { stdio: ['ignore', 'ignore', 'ignore'] });
    let target = null;
    for (let attempt = 0; attempt < 80 && !target; attempt += 1) {
        await sleep(200);
        try {
            const list = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
            target = list.find((item) => item.type === 'page');
        } catch (error) { /* booting */ }
    }
    if (!target) {
        chrome.kill('SIGKILL');
        throw new Error('Could not connect to headless Chrome.');
    }
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let nextId = 1;
    const pending = new Map();
    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (!message.id || !pending.has(message.id)) return;
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
    await send('Runtime.enable');
    await send('Page.enable');
    return {
        send,
        close: async () => {
            try { await send('Browser.close'); } catch (error) { /* ignore */ }
            try { socket.close(); } catch (error) { /* ignore */ }
            chrome.kill('SIGKILL');
        },
    };
}

async function main() {
    await getJson(`http://127.0.0.1:${SERVER_PORT}/api/health`);
    const library = JSON.parse(fs.readFileSync(ANIMATIONS_FILE, 'utf8'));
    const animations = Array.isArray(library.animations) ? library.animations : [];
    if (!animations.length) throw new Error('animations.json has no animations.');
    const base = JSON.parse(fs.readFileSync(COMPOSITION_FILE, 'utf8'));

    fs.mkdirSync(COMPOSITION_DIR, { recursive: true });
    const cdp = await connectChrome();
    const evaluate = async (expression, awaitPromise = true) => {
        const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        }
        return result.result.value;
    };
    try {
        await cdp.send('Page.navigate', { url: `http://127.0.0.1:${SERVER_PORT}/studio.html` });
        for (let attempt = 0; attempt < 60; attempt += 1) {
            await sleep(200);
            if (await evaluate('Boolean(window.layerStudio)', false)) break;
            if (attempt === 59) throw new Error('LayerStudio did not boot.');
        }
        await evaluate(`window.__beardsBase = ${JSON.stringify(base)}; true`);

        const written = [];
        for (const animation of animations) {
            const payload = await evaluate(`(async () => {
                const studio = layerStudio;
                studio.openComposition(window.__beardsBase, { projectId: null });
                studio.projectId = null;
                if (studio._saveTimer) { window.clearTimeout(studio._saveTimer); studio._saveTimer = null; }
                await new Promise((resolve) => setTimeout(resolve, 140));
                studio.updateCharacterSettings('character-1', ${JSON.stringify(animation.settings)}, { apply: true, silent: true });
                await new Promise((resolve) => setTimeout(resolve, 100));
                const snapshot = studio.createExportSnapshot();
                snapshot.id = 'beards-${slug(animation.id)}';
                snapshot.name = ${JSON.stringify(animation.name)};
                snapshot.duration = ${Number(animation.duration) || 10000};
                snapshot.meta = {
                    ...(snapshot.meta || {}),
                    source: 'beards-animations',
                    animationId: ${JSON.stringify(animation.id)},
                    animationName: ${JSON.stringify(animation.name)},
                    description: ${JSON.stringify(animation.description || '')},
                    library: '/data/imports/${PROJECT_ID}/animations.json',
                    createdAt: new Date().toISOString(),
                };
                return JSON.stringify(snapshot);
            })()`);
            const composition = JSON.parse(payload);
            const file = path.join(COMPOSITION_DIR, `${slug(animation.id)}.composition.json`);
            fs.writeFileSync(file, `${JSON.stringify(composition, null, 2)}\n`, 'utf8');
            const animated = composition.layers.filter((layer) => (layer.keyframes || []).length > 1).length;
            written.push({
                id: animation.id,
                name: animation.name,
                file: path.relative(ROOT, file),
                size: fs.statSync(file).size,
                animated,
                applied: composition.characters?.[0]?.applied === true,
            });
            console.log(`baked ${animation.id}  ${(fs.statSync(file).size / 1024 / 1024).toFixed(2)} MB  ${animated} animated layers`);
        }

        const readme = `# Beards — animation library

Each composition was baked from [\`animations.json\`](../../imports/${PROJECT_ID}/animations.json)
through rig v3. Open the **Beards** project, pick a composition and press **Play**.

| Composition | Animation | Duration | Animated layers |
|---|---|---|---|
${written.map((item) => `| \`${item.file.split('/').pop()}\` | ${item.name} | ${(JSON.parse(fs.readFileSync(path.join(ROOT, item.file), 'utf8')).duration / 1000).toFixed(0)} s | ${item.animated} |`).join('\n')}

Regenerate with:

\`\`\`bash
node tools/export-beards-animations.js
\`\`\`

The source animation presets live in
\`data/imports/${PROJECT_ID}/animations.json\`; the Character panel's **Animations**
section plays the same list inside the import project.
`;
        fs.writeFileSync(path.join(OUT_DIR, 'README.md'), readme, 'utf8');
        console.log(`wrote ${path.relative(ROOT, path.join(OUT_DIR, 'README.md'))}`);
        console.log(JSON.stringify(written, null, 2));
    } finally {
        await cdp.close();
    }
}

main().catch((error) => {
    console.error(`export-beards-animations: ${error.message}`);
    process.exitCode = 1;
});
