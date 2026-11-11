'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const LIBRARY = path.join(ROOT, 'data', 'library');

function run(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `${command} exited with ${result.status}`);
    return `${result.stdout || ''}${result.stderr || ''}`;
}

function reservePort() {
    return new Promise((resolve, reject) => {
        const listener = net.createServer();
        listener.once('error', reject);
        listener.listen(0, '127.0.0.1', () => {
            const { port } = listener.address();
            listener.close((error) => error ? reject(error) : resolve(port));
        });
    });
}

async function waitForHealth(port, process) {
    for (let attempt = 0; attempt < 80; attempt++) {
        if (process.exitCode !== null) throw new Error('The studio server exited before becoming ready.');
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/health`);
            if (response.ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('The studio server did not become ready.');
}

function meanBandLevel(file, startSeconds) {
    const result = spawnSync('ffmpeg', [
        '-hide_banner', '-ss', String(startSeconds), '-i', file, '-t', '0.2',
        '-af', 'bandpass=f=880:width_type=h:width=80,volumedetect', '-f', 'null', '-',
    ], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || 'Could not inspect exported audio.');
    const match = `${result.stdout || ''}${result.stderr || ''}`.match(/mean_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/i);
    if (!match) throw new Error('ffmpeg did not report the inspected audio level.');
    return Number(match[1]);
}

test('audio mix export retains and times saved voice-over lines', async (t) => {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    } catch {
        t.skip('ffmpeg is required for the audio export integration test');
        return;
    }

    const id = `voice-export-${Date.now()}-${process.pid}`;
    const animationId = `${id}-cut`;
    const audioDir = path.join(LIBRARY, 'audio', id);
    const designFile = path.join(LIBRARY, 'designs', `${id}.json`);
    const sourceFile = path.join(LIBRARY, 'sources', `${id}-source.webm`);
    const outputFile = path.join(LIBRARY, 'sources', `${animationId}-mix.webm`);
    let child;

    try {
        await Promise.all([
            fs.mkdir(audioDir, { recursive: true }),
            fs.mkdir(path.dirname(designFile), { recursive: true }),
            fs.mkdir(path.dirname(sourceFile), { recursive: true }),
        ]);
        run('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=25:d=2',
            '-an', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', sourceFile,
        ]);
        run('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
            '-c:a', 'pcm_s16le', path.join(audioDir, 'music.wav'),
        ]);
        run('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=0.7',
            '-c:a', 'pcm_s16le', path.join(audioDir, 'voice.wav'),
        ]);
        await fs.writeFile(designFile, JSON.stringify({
            id,
            duration: 2000,
            sourceVideo: `/data/library/sources/${id}-source.webm`,
            animations: [{ id: animationId, duration: 2000 }],
        }));

        const port = await reservePort();
        child = spawn(process.execPath, ['server.js'], {
            cwd: ROOT,
            env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
            stdio: 'ignore',
        });
        await waitForHealth(port, child);
        const baseUrl = `http://127.0.0.1:${port}/api/library/audio`;
        const config = {
            narration: { volume: 1, muted: false },
            music: {
                enabled: true,
                url: `/data/library/audio/${id}/music.wav`,
                durationMs: 2000,
                volume: 0.2,
                startMs: 0,
                endMs: 2000,
                inMs: 0,
                loop: true,
                fadeInMs: 0,
                fadeOutMs: 0,
                duck: true,
                duckDb: -9,
            },
            script: {
                lines: [{
                    id: 'voice-line',
                    speaker: 'Test voice',
                    text: 'Timed narration',
                    startMs: 500,
                    audio: {
                        url: `/data/library/audio/${id}/voice.wav`,
                        durationMs: 700,
                        source: 'tts',
                        name: 'voice.wav',
                    },
                }],
            },
        };
        const saved = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ designId: id, animationId, config }),
        });
        const savedResult = await saved.json();
        assert.equal(saved.status, 200, JSON.stringify(savedResult));

        const rendered = await fetch(`${baseUrl}/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ designId: id, animationId }),
        });
        const result = await rendered.json();
        assert.equal(rendered.status, 200, JSON.stringify(result));
        assert.match(result.url, new RegExp(`${animationId}-mix\\.webm`));
        await fs.access(outputFile);

        const beforeVoice = meanBandLevel(outputFile, 0.1);
        const duringVoice = meanBandLevel(outputFile, 0.7);
        assert.ok(Number.isFinite(duringVoice), 'the narration is audible during its scheduled cue');
        assert.ok(
            !Number.isFinite(beforeVoice) || duringVoice > beforeVoice + 15,
            'the narration starts at its saved cue instead of being omitted or played from time zero',
        );
    } finally {
        if (child && child.exitCode === null) {
            child.kill('SIGTERM');
            await new Promise((resolve) => child.once('exit', resolve));
        }
        await Promise.all([
            fs.rm(audioDir, { recursive: true, force: true }),
            fs.rm(designFile, { force: true }),
            fs.rm(sourceFile, { force: true }),
            fs.rm(outputFile, { force: true }),
        ]);
    }
});
