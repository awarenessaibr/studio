'use strict';
/**
 * thumbnail-service.js — cached, resized JPEG covers for local images.
 *
 * The studio stores final images at print/reel resolution (often 2000–6800 px
 * on the long edge). A catalogue that lists hundreds of designs cannot ship
 * those originals as 44 px covers, so `/api/thumbnail?src=…&w=…` asks this
 * module for one small JPEG per (source mtime, width).
 *
 *   data/cache/thumbnails/<sha1>.jpg
 *
 * Generation uses ffmpeg, the only optional binary the project already relies
 * on for video/audio. The caller resolves and validates the source path; this
 * module only knows how to read it, scale it and cache the result.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const FFMPEG_BINARY = String(process.env.STUDIO_FFMPEG || 'ffmpeg').trim() || 'ffmpeg';
const DEFAULT_WIDTH = 160;
const MIN_WIDTH = 32;
const MAX_WIDTH = 640;
const MAX_SOURCE_BYTES = 160 * 1024 * 1024;
const MAX_CONCURRENCY = 3;
const TIMEOUT_MS = 60_000;
const RASTER_SOURCE = /\.(?:png|jpe?g|webp)$/i;

let active = 0;
const waiting = [];
const inflight = new Map();

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        execFile(FFMPEG_BINARY, args, {
            timeout: TIMEOUT_MS,
            maxBuffer: 4 * 1024 * 1024,
            windowsHide: true,
        }, (error, stdout, stderr) => {
            if (error) {
                error.stderr = String(stderr || '');
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}

/** At most MAX_CONCURRENCY ffmpeg processes: one page load asks for a dozen. */
async function withSlot(task) {
    if (active >= MAX_CONCURRENCY) {
        await new Promise((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
        return await task();
    } finally {
        active -= 1;
        const next = waiting.shift();
        if (next) next();
    }
}

function clampWidth(value) {
    const width = Math.round(Number(value));
    if (!Number.isFinite(width) || width <= 0) return DEFAULT_WIDTH;
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

function cacheKey(sourceKey, stat, width) {
    return crypto
        .createHash('sha1')
        .update(`${sourceKey}\n${stat.mtimeMs}\n${stat.size}\n${width}`)
        .digest('hex')
        .slice(0, 40);
}

async function existingFile(target) {
    try {
        const stat = await fsp.stat(target);
        return stat.isFile() && stat.size > 0 ? stat : null;
    } catch {
        return null;
    }
}

/**
 * Return the cached thumbnail for `sourceFile`, generating it on first use.
 *
 * @param {object} options
 * @param {string} options.sourceFile  absolute path to a PNG/JPEG/WebP
 * @param {string} options.sourceKey   stable identity for the source URL
 * @param {number} [options.width]     target width in px (32–640)
 * @param {string} options.cacheDir    directory for generated JPEG files
 * @returns {Promise<{file: string, width: number, etag: string}>}
 */
async function ensureThumbnail({ sourceFile, sourceKey, width, cacheDir }) {
    if (!RASTER_SOURCE.test(sourceFile)) {
        throw httpError(415, 'Thumbnails are generated from PNG, JPEG or WebP images only.');
    }
    let stat;
    try {
        stat = await fsp.stat(sourceFile);
    } catch (error) {
        if (error.code === 'ENOENT') throw httpError(404, 'The thumbnail source does not exist.');
        throw error;
    }
    if (!stat.isFile()) throw httpError(404, 'The thumbnail source is not a file.');
    if (stat.size > MAX_SOURCE_BYTES) throw httpError(413, 'The thumbnail source is too large.');

    const targetWidth = clampWidth(width);
    const key = cacheKey(sourceKey, stat, targetWidth);
    const target = path.join(cacheDir, `${key}.jpg`);
    const cached = await existingFile(target);
    if (cached) return { file: target, width: targetWidth, etag: key };

    const pending = inflight.get(target);
    if (pending) return pending;

    const job = (async () => {
        await fsp.mkdir(cacheDir, { recursive: true });
        const temp = path.join(cacheDir, `.${key}.${process.pid}.${Date.now()}.jpg`);
        try {
            await withSlot(() => runFfmpeg([
                '-hide_banner', '-loglevel', 'error', '-y',
                '-i', sourceFile,
                '-vf', `scale=${targetWidth}:-2:flags=lanczos`,
                '-frames:v', '1',
                '-q:v', '4',
                '-f', 'mjpeg',
                temp,
            ]));
            const output = await existingFile(temp);
            if (!output) throw httpError(502, 'The thumbnail could not be generated.');
            await fsp.rename(temp, target);
            return { file: target, width: targetWidth, etag: key };
        } catch (error) {
            await fsp.rm(temp, { force: true }).catch(() => {});
            if (error.code === 'ENOENT') {
                throw httpError(501, 'Thumbnails need ffmpeg. Install it or set STUDIO_FFMPEG.');
            }
            if (error.status) throw error;
            const detail = String(error.stderr || error.message || '').trim().slice(0, 240);
            throw httpError(502, `The thumbnail could not be generated${detail ? `: ${detail}` : '.'}`);
        }
    })().finally(() => inflight.delete(target));

    inflight.set(target, job);
    return job;
}

module.exports = {
    DEFAULT_WIDTH,
    MIN_WIDTH,
    MAX_WIDTH,
    RASTER_SOURCE,
    clampWidth,
    ensureThumbnail,
};
