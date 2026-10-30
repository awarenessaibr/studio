#!/usr/bin/env node
'use strict';

/**
 * Render real preview frames of the Beards rig v3 through the studio's own
 * export renderer, then encode them with ffmpeg.
 *
 * Requires the studio backend:
 *   PORT=8123 node server.js
 * and Chrome (headless).
 *
 * Usage:
 *   node tools/render-beards-preview.js [--server-port 8123] [--fps 24] [--scale 2]
 *
 * Outputs into data/imports/beards-20261019000756-e757/preview/:
 *   beards-talk.mp4, beards-talk.gif and the stills used by ASSET-PACK.md.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_ID = 'beards-20261019000756-e757';
const PROJECT_DIR = path.join(ROOT, 'data', 'imports', PROJECT_ID);
const OUT_DIR = path.join(PROJECT_DIR, 'preview');
const FRAME_DIR = path.join('/tmp', 'beards-preview-frames');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
};
const SERVER_PORT = Number(argValue('--server-port', 8123));
const FPS = Number(argValue('--fps', 24));
const SCALE = Number(argValue('--scale', 2));
const DEBUG_PORT = Number(argValue('--chrome-port', 9344));
const PYTHON = argValue('--python', process.env.DSH_PYTHON || 'python3');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (response) => {
            let data = '';
            response.on('data', (chunk) => { data += chunk; });
            response.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', reject);
    });
}

async function connectChrome() {
    const chrome = spawn(CHROME, [
        '--headless=new',
        `--remote-debugging-port=${DEBUG_PORT}`,
        '--user-data-dir=/tmp/dsh-chrome-beards-render',
        '--no-sandbox',
        '--disable-crash-reporter',
        '--disable-breakpad',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--hide-scrollbars',
        '--window-size=1500,950',
        'about:blank',
    ], { stdio: ['ignore', 'ignore', 'ignore'] });
    chrome.on('exit', (code) => {
        if (code && code !== 0) console.warn(`chrome exited with ${code}`);
    });

    let target = null;
    for (let attempt = 0; attempt < 80 && !target; attempt += 1) {
        await sleep(200);
        try {
            const list = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
            target = list.find((item) => item.type === 'page');
        } catch (error) { /* chrome still booting */ }
    }
    if (!target) {
        chrome.kill('SIGKILL');
        throw new Error('Could not connect to headless Chrome.');
    }

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = reject;
    });
    let nextId = 1;
    const pending = new Map();
    const logs = [];
    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
            const entry = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
            else entry.resolve(message.result);
            return;
        }
        if (message.method === 'Runtime.exceptionThrown') {
            logs.push(`EXCEPTION ${message.params.exceptionDetails.text}`);
        }
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
            logs.push(`console.error ${message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')}`);
        }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
        width: 1500, height: 950, deviceScaleFactor: 1, mobile: false,
    });
    return {
        send,
        logs,
        close: async () => {
            try { await send('Browser.close'); } catch (error) { /* ignore */ }
            try { socket.close(); } catch (error) { /* ignore */ }
            chrome.kill('SIGKILL');
        },
    };
}

async function main() {
    await new Promise((resolve, reject) => {
        getJson(`http://127.0.0.1:${SERVER_PORT}/api/health`)
            .then(() => resolve())
            .catch(() => reject(new Error(`Studio backend is not running on ${SERVER_PORT}. Start it with: PORT=${SERVER_PORT} node server.js`)));
    });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.rmSync(FRAME_DIR, { recursive: true, force: true });
    fs.mkdirSync(FRAME_DIR, { recursive: true });

    const cdp = await connectChrome();
    const evaluate = async (expression, awaitPromise = true) => {
        const result = await cdp.send('Runtime.evaluate', {
            expression,
            awaitPromise,
            returnByValue: true,
        });
        if (result.exceptionDetails) {
            const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
            throw new Error(description);
        }
        return result.result.value;
    };

    try {
        await cdp.send('Page.navigate', { url: `http://127.0.0.1:${SERVER_PORT}/studio.html` });
        for (let attempt = 0; attempt < 60; attempt += 1) {
            await sleep(200);
            const ready = await evaluate('Boolean(window.layerStudio)', false);
            if (ready) break;
            if (attempt === 59) throw new Error('LayerStudio did not boot.');
        }

        const opened = await evaluate(`(async () => {
            const projectId = '${PROJECT_ID}';
            const response = await fetch('/api/projects/import-' + projectId + '/compositions/main');
            const value = await response.json();
            layerStudio.openComposition(value, { projectId, projectMeta: value.meta || null });
            // Rendering must not overwrite the saved project with preview settings.
            layerStudio.projectId = null;
            if (layerStudio._saveTimer) { window.clearTimeout(layerStudio._saveTimer); layerStudio._saveTimer = null; }
            await new Promise((resolve) => setTimeout(resolve, 300));
            return { layers: layerStudio.composition.layers.length, character: layerStudio.composition.characters?.[0]?.id };
        })()`);
        console.log(`opened ${opened.layers} layers, character ${opened.character}`);

        const characterId = opened.character;
        const baseSettings = {
            expression: 'neutral',
            blink: true,
            blinkRate: 13,
            blinkAmount: 0.95,
            talk: false,
            talkIntensity: 0.6,
            talkSpeed: 1,
            gazeX: 0,
            gazeY: 0,
            eyeWander: true,
            breathe: true,
            breatheAmount: 0.45,
            headSway: 0.7,
            saccade: true,
            speechText: '',
            speechRate: 0.95,
            speechStart: 0,
            mouthPose: '',
        };

        const applySettings = async (patch) => {
            await evaluate(`(async () => {
                layerStudio.updateCharacterSettings('${characterId}', ${JSON.stringify({ ...baseSettings, ...patch })}, { apply: true, silent: true });
                await new Promise((resolve) => setTimeout(resolve, 80));
                return true;
            })()`);
        };

        const stage = async (width, height) => {
            await evaluate(`(async () => {
                const studio = layerStudio;
                const snapshot = studio.createExportSnapshot();
                const canvas = document.createElement('canvas');
                canvas.width = ${width};
                canvas.height = ${height};
                const context = canvas.getContext('2d', { alpha: false });
                const assets = await studio.loadExportAssets(snapshot, 1600, Math.max(${width}, ${height}), 24000000);
                window.__beardsShot = { snapshot, assets, canvas, context };
                return { layers: snapshot.layers.length, assets: assets.size };
            })()`);
        };

        const renderFrame = async (time) => {
            const dataUrl = await evaluate(`(() => {
                const shot = window.__beardsShot;
                layerStudio.renderExportFrame(shot.context, shot.snapshot, shot.assets, ${time}, shot.canvas.width, shot.canvas.height);
                return shot.canvas.toDataURL('image/png');
            })()`, false);
            return Buffer.from(dataUrl.split(',')[1], 'base64');
        };

        const size = await evaluate(`(() => {
            const c = layerStudio.composition;
            return { width: c.width, height: c.height, duration: c.duration };
        })()`, false);
        const width = Math.round(size.width * SCALE);
        const height = Math.round(size.height * SCALE);
        console.log(`canvas ${width}x${height}, duration ${size.duration}ms`);

        // 1. Main talk shot -------------------------------------------------
        const talkText = 'Oh! Well met, traveler. I have been waiting for you. Come, sit by the fire. There is much to tell.';
        await applySettings({ speechText: talkText });
        await stage(width, height);
        const totalFrames = Math.round(size.duration / 1000 * FPS);
        console.log(`rendering talk shot: ${totalFrames} frames`);
        for (let frame = 0; frame < totalFrames; frame += 1) {
            const time = Math.round(frame * 1000 / FPS);
            const buffer = await renderFrame(time);
            fs.writeFileSync(path.join(FRAME_DIR, `talk-${String(frame).padStart(4, '0')}.png`), buffer);
            if (frame % 24 === 0) console.log(`  frame ${frame}/${totalFrames}`);
        }

        // 2. Expression sheet ----------------------------------------------
        console.log('rendering expressions');
        const expressions = ['neutral', 'happy', 'sad', 'surprised', 'angry'];
        for (const expression of expressions) {
            await applySettings({
                expression,
                speechText: '',
                mouthPose: '',
                blink: false,
                headSway: 0.15,
                saccade: false,
                gazeX: 0,
                gazeY: 0,
            });
            await stage(width, height);
            fs.writeFileSync(
                path.join(FRAME_DIR, `expression-${expression}.png`),
                await renderFrame(1200),
            );
        }

        // 3. Viseme sheet ---------------------------------------------------
        console.log('rendering visemes');
        const visemes = ['rest', 'a', 'e', 'i', 'o', 'u', 'mbp', 'fv', 'l', 'wq', 'smile', 'frown', 'open'];
        for (const viseme of visemes) {
            await applySettings({
                expression: 'neutral',
                speechText: '',
                mouthPose: viseme,
                blink: false,
                headSway: 0,
                saccade: false,
                gazeX: 0,
                gazeY: 0,
            });
            await stage(width, height);
            fs.writeFileSync(
                path.join(FRAME_DIR, `viseme-${viseme}.png`),
                await renderFrame(600),
            );
        }

        // 4. Blink strip ----------------------------------------------------
        console.log('rendering blink strip');
        await applySettings({
            expression: 'neutral',
            speechText: '',
            mouthPose: '',
            blink: true,
            blinkRate: 16,
            blinkAmount: 1,
            headSway: 0,
            saccade: false,
            gazeX: 0,
            gazeY: 0,
        });
        const blinkCenter = await evaluate(`(() => {
            const layer = layerStudio.composition.layers.find((item) => /eyelid-closed-left/.test(item.id));
            if (!layer || !layer.keyframes.length) return 1200;
            return layer.keyframes.reduce((best, frame) => (frame.opacity > best.opacity ? frame : best), layer.keyframes[0]).time;
        })()`, false);
        await stage(width, height);
        const blinkOffsets = [-180, -120, -60, 0, 60, 120, 180];
        for (let index = 0; index < blinkOffsets.length; index += 1) {
            const time = Math.max(0, Math.min(size.duration - 1, blinkCenter + blinkOffsets[index]));
            fs.writeFileSync(
                path.join(FRAME_DIR, `blink-${index}.png`),
                await renderFrame(time),
            );
        }
        console.log(`blink center at ${blinkCenter}ms`);

        // 5. Rest pose for the reference comparison -------------------------
        await applySettings({
            expression: 'neutral', speechText: '', mouthPose: '', blink: false,
            headSway: 0, saccade: false, gazeX: 0, gazeY: 0,
        });
        await stage(width, height);
        fs.writeFileSync(path.join(FRAME_DIR, 'rest.png'), await renderFrame(0));

        // 6. Studio UI screenshot ------------------------------------------
        console.log('capturing studio UI');
        await applySettings({ speechText: talkText, blink: true, headSway: 0.7 });
        await evaluate(`(() => {
            layerStudio.selectedLayerId = 'beards-eye-white-left';
            layerStudio.renderInspector();
            layerStudio.applyAnimationTime(2400);
            return true;
        })()`, false);
        await sleep(400);
        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT_DIR, 'beards-studio-ui.png'), Buffer.from(screenshot.data, 'base64'));

        if (cdp.logs.length) {
            console.log('--- browser errors ---');
            console.log(cdp.logs.slice(0, 20).join('\n'));
        }
    } finally {
        await cdp.close();
    }

    // 7. Encode ------------------------------------------------------------
    console.log('encoding mp4 + gif');
    const mp4 = path.join(OUT_DIR, 'beards-talk.mp4');
    const gif = path.join(OUT_DIR, 'beards-talk.gif');
    let result = spawnSync('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-framerate', String(FPS),
        '-i', path.join(FRAME_DIR, 'talk-%04d.png'),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17',
        '-movflags', '+faststart', mp4,
    ], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('ffmpeg mp4 encode failed');

    result = spawnSync('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-framerate', String(FPS),
        '-i', path.join(FRAME_DIR, 'talk-%04d.png'),
        '-vf', 'fps=12,scale=348:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=160[p];[s1][p]paletteuse=dither=sierra2_4a',
        '-loop', '0', gif,
    ], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('ffmpeg gif encode failed');

    // 8. Contact sheets ----------------------------------------------------
    console.log('building contact sheets');
    const sheetScript = path.join(ROOT, 'tools', 'build-beards-sheets.py');
    result = spawnSync(PYTHON, [sheetScript, '--frames', FRAME_DIR, '--out', OUT_DIR], { stdio: 'inherit' });
    if (result.status !== 0) console.warn('contact sheet step failed; frames are still available in /tmp');

    console.log(`\ndone:\n  ${path.relative(ROOT, mp4)}\n  ${path.relative(ROOT, gif)}\n  ${path.relative(ROOT, OUT_DIR)}/`);
}

main().catch((error) => {
    console.error(`render-beards-preview: ${error.message}`);
    process.exitCode = 1;
});
