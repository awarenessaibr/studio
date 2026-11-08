#!/usr/bin/env node
/**
 * server.js — zero-dependency backend for LayerStudio.
 *
 * Serves the static studio and stores imported ZIP projects under
 * data/imports/<project-id>/:
 *
 *   source.zip          the original segments archive
 *   reference.<ext>     the final assembled image
 *   segments/...        extracted segment images
 *   composition.json    the generated LayerStudio composition
 *
 * Usage:
 *   node server.js
 *   PORT=8008 HOST=0.0.0.0 node server.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFile } = require('child_process');
const Core = require('./src/shared/studio-core.js');
const StudioBrand = require('./src/shared/brand-pack.js');
const { parseBrandDocx } = require('./src/server/brand-docx.js');
const Crawler = require('./src/server/crawler-service.js');
const AssetStore = require('./src/server/asset-store.js');
const AssetService = require('./src/server/asset-service.js');
const SocialStore = require('./src/server/social-store.js');
const { generateSegmentTexture } = require('./src/server/segment-texture.js');

// Load local API keys (SERPAPI_KEY, GOOGLE_PLACES_API_KEY, …) from .env.
// The crawler children inherit process.env, so this is the only place keys
// enter the system; they are never sent to the browser.
try {
    process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
    if (error.code !== 'ENOENT') console.warn('[studio] could not read .env:', error.message);
}

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const IMPORTS_DIR = path.join(DATA_DIR, 'imports');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const FONTS_DIR = path.join(DATA_DIR, 'fonts');
const BRAND_KITS_DIR = path.join(DATA_DIR, 'brand-kits');
const BRAND_PACKS_DIR = path.join(DATA_DIR, 'brand-packs');
const SETTINGS_DIR = path.join(DATA_DIR, 'settings');
const GROUP_SETTINGS_FILE = path.join(SETTINGS_DIR, 'groups.json');
const STUDIO_ANIMATION_LIBRARY_FILE = path.join(SETTINGS_DIR, 'studio-animation-library.json');
const STUDIO_PROJECT_ARCHIVE_FILE = path.join(SETTINGS_DIR, 'studio-project-archive.json');
// The management UI is a developer surface. With a key configured, every
// admin call must present it; without one, only loopback callers are allowed.
const ADMIN_KEY = String(process.env.STUDIO_ADMIN_KEY || '').trim();
const PORT = Number(process.env.PORT) || 8009;
const HOST = process.env.HOST || '0.0.0.0';

const MAX_BODY = 320 * 1024 * 1024;
const MAX_ZIP = 220 * 1024 * 1024;
const MAX_REFERENCE = 60 * 1024 * 1024;
const MAX_EXTRACTED = 640 * 1024 * 1024;
const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const MAX_SEGMENT_TEXTURE_BODY = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) * 2 + 1024 * 1024;
const MAX_COMPOSITION_BYTES = 24 * 1024 * 1024;
const MAX_FONT_BYTES = 2 * 1024 * 1024;
const MAX_BRIEF_BYTES = 8 * 1024 * 1024;
const MAX_BRAND_KIT_BYTES = 512 * 1024;
const MAX_BRAND_KITS = 200;
const MAX_BRAND_PACK_ZIP = 160 * 1024 * 1024;
const MAX_BRAND_PACKS = 50;
const MAX_BRAND_ASSET_BYTES = 40 * 1024 * 1024;
const MAX_BRAND_EXTRACTED_BYTES = 480 * 1024 * 1024;
const MAX_BRAND_FILES = 4000;
const MAX_BRAND_ASSETS = 240;
const BRAND_KIT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_LAYERS = 500;
const MAX_SEGMENTS = MAX_LAYERS - 1;
const DEFAULT_DURATION = 10000;

const PRESET_NAMES = [
    'breathe', 'idle', 'sway', 'walk', 'float', 'flicker',
    'drift', 'pulse', 'fadeIn', 'parallax',
    'fadeOut', 'zoom', 'spin', 'shake', 'hop', 'swing', 'orbit', 'nod', 'blinkIn',
];
const EASING_NAMES = [
    'linear', 'easeIn', 'easeOut', 'easeInOut',
    'easeInSine', 'easeOutSine', 'easeInOutSine',
    'easeInQuad', 'easeOutQuad', 'easeInOutQuad',
    'easeOutCubic', 'easeInOutCubic',
    'easeOutBack', 'easeInBack',
    'stepStart', 'stepEnd',
];
const CHARACTER_EXPRESSIONS = ['neutral', 'happy', 'sad', 'surprised', 'angry'];
const CHARACTER_VISEMES = ['rest', 'a', 'e', 'i', 'o', 'u', 'mbp', 'fv', 'l', 'wq', 'smile', 'frown', 'open'];
const CHARACTER_PART_KEYS = [
    'face', 'eyes', 'pupils', 'highlights', 'eyelids', 'brows', 'mouth', 'jaw',
    'teeth', 'tongue', 'mustache', 'beard', 'head', 'body', 'hands', 'ears',
    'neck', 'fx',
];
const CHARACTER_PART_MATCHERS = [
    ['pupils', /pupil|iris/i],
    ['highlights', /highlight|catchlight|specular|eye-shine/i],
    ['eyelids', /eyelid|lid(?:-|_|\b)/i],
    ['eyes', /eye|eyeball/i],
    ['brows', /brow/i],
    ['teeth', /teeth|tooth/i],
    ['tongue', /tongue/i],
    ['jaw', /jaw|chin/i],
    ['mouth', /mouth|lip/i],
    ['mustache', /mustache|moustache/i],
    ['face', /face|skin|head-base|face-base/i],
    ['ears', /ear(?:-|_|\b)/i],
    ['neck', /neck|throat/i],
    ['hands', /hand|fist|palm|arm/i],
    ['beard', /beard|whisker/i],
    ['head', /hair|head|skull|wig/i],
    ['body', /shirt|body|torso|dress|jacket|coat|robe|armor|suit/i],
];
const DEFAULT_VISION_MODEL = process.env.STUDIO_VISION_MODEL || 'granite3.2-vision:2b';
const DEFAULT_TEXT_MODEL = process.env.STUDIO_TEXT_MODEL || 'qwen3.5:9b';
const MAX_PROMPT_LAYERS = 120;
const MAX_CONTEXT_CHARS = 8000;
const MAX_VISION_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_ORGANIZER_BODY = 32 * 1024 * 1024;
const MAX_ORGANIZER_IMAGE_BYTES = 220 * 1024;
const PROPOSAL_TIMEOUT = 600000;
const LLM_DETECT_TIMEOUT = 5000;
let ollamaCache = { at: 0, value: null };

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
};

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function sendJson(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
    });
    res.end(body);
}

function sendText(res, status, message) {
    res.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(message),
        'Cache-Control': 'no-store',
    });
    res.end(message);
}

function readBody(req, limit = MAX_BODY) {
    return new Promise((resolve, reject) => {
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > limit) {
            reject(httpError(413, 'The upload is too large for this server.'));
            req.resume();
            return;
        }
        const chunks = [];
        let size = 0;
        let failed = false;
        req.on('data', (chunk) => {
            if (failed) return;
            size += chunk.length;
            if (size > limit) {
                failed = true;
                chunks.length = 0;
                reject(httpError(413, 'The upload is too large for this server.'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (!failed) resolve(Buffer.concat(chunks));
        });
        req.on('error', (error) => {
            if (!failed) reject(error);
        });
    });
}

function decodeBase64(value, label) {
    if (typeof value !== 'string' || !value.length) {
        throw httpError(400, `${label} is missing.`);
    }
    const trimmed = value.replace(/^data:[^;]+;base64,/, '');
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed)) {
        throw httpError(400, `${label} is not valid base64 data.`);
    }
    const buffer = Buffer.from(trimmed, 'base64');
    if (!buffer.length) throw httpError(400, `${label} is empty.`);
    return buffer;
}

/**
 * MediaRecorder on some Chromium builds writes VP9 inside an MP4 container,
 * which browsers and Instagram do not universally accept. The browser prefers
 * MP4 but cannot always request H.264. When ffmpeg is available we transcode
 * the recorded blob to a broadly playable H.264 MP4; when it is not, the
 * client keeps the browser recording and says so. This is the only optional
 * binary dependency in the project.
 */
const FFMPEG_BINARY = String(process.env.STUDIO_FFMPEG || 'ffmpeg').trim() || 'ffmpeg';
const MAX_TRANSCODE_BYTES = 320 * 1024 * 1024;
const MAX_TRANSCODE_CONCURRENCY = 2;
const TRANSCODE_TIMEOUT_MS = 180_000;
let transcodeActive = 0;
let ffmpegChecked = false;
let ffmpegAvailable = false;

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        execFile(FFMPEG_BINARY, args, {
            timeout: TRANSCODE_TIMEOUT_MS,
            maxBuffer: 8 * 1024 * 1024,
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

async function ffmpegExists() {
    if (ffmpegChecked) return ffmpegAvailable;
    ffmpegChecked = true;
    try {
        await runFfmpeg(['-hide_banner', '-version']);
        ffmpegAvailable = true;
    } catch {
        ffmpegAvailable = false;
    }
    return ffmpegAvailable;
}

async function transcodeVideoToMp4(buffer, contentType = '') {
    if (!buffer?.length) throw httpError(400, 'The video upload is empty.');
    if (buffer.length > MAX_TRANSCODE_BYTES) {
        throw httpError(413, 'The video is too large to transcode.');
    }
    if (!(await ffmpegExists())) {
        throw httpError(501, 'MP4 transcoding is unavailable. Install ffmpeg or set STUDIO_FFMPEG.');
    }
    if (transcodeActive >= MAX_TRANSCODE_CONCURRENCY) {
        throw httpError(429, 'The MP4 transcoder is busy. Try again in a moment.');
    }
    const extension = /webm/i.test(String(contentType)) ? 'webm' : 'mp4';
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'studio-video-'));
    const input = path.join(dir, `input.${extension}`);
    const output = path.join(dir, 'output.mp4');
    transcodeActive += 1;
    try {
        await fsp.writeFile(input, buffer);
        await runFfmpeg([
            '-hide_banner', '-loglevel', 'error', '-y',
            '-i', input,
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', '20',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-an',
            output,
        ]);
        const data = await fsp.readFile(output);
        if (!data.length) throw new Error('ffmpeg produced an empty file.');
        return data;
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw httpError(501, 'MP4 transcoding is unavailable. Install ffmpeg or set STUDIO_FFMPEG.');
        }
        if (error.status) throw error;
        const detail = String(error.stderr || error.message || '').trim().slice(0, 400);
        throw httpError(502, `The video could not be transcoded to MP4${detail ? `: ${detail}` : '.'}`);
    } finally {
        transcodeActive = Math.max(0, transcodeActive - 1);
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
}

function sanitizeLabel(value, fallback) {
    const label = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
    return label || fallback;
}

function sanitizeFilename(value, fallback) {
    const name = path.basename(typeof value === 'string' ? value.replace(/\\/g, '/') : '');
    return name.replace(/[^\w.\- ()]+/g, '_').slice(0, 120) || fallback;
}

function isImageName(name) {
    return /\.(png|jpe?g|gif|webp)$/i.test(name);
}

function safeRelativePath(name) {
    const normalized = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = normalized.split('/').filter(Boolean);
    if (!parts.length) return null;
    for (const part of parts) {
        if (part === '.' || part === '..') return null;
        if (part.startsWith('.') || part === '__MACOSX') return null;
        if (/[\0]/.test(part)) return null;
    }
    return parts.join('/');
}

function urlPath(...parts) {
    return `/${parts.map((part) => String(part).split('/').map(encodeURIComponent).join('/')).join('/')}`;
}

/**
 * Absolute path for a repository project's own asset, or null when the
 * project id / relative path would escape data/projects/<project>/assets.
 * `safeRelativePath` already rejects `..`, dotfiles and empty paths; the
 * prefix check is the belt-and-braces guard for the resolved path.
 */
function resolveProjectAssetPath(projectId, assetPath) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(projectId || ''))) return null;
    const relative = safeRelativePath(assetPath);
    if (!relative) return null;
    const root = path.join(PROJECTS_DIR, projectId, 'assets');
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) return null;
    return target;
}

// ─── Image format detection ───────────────────────────────────────────

function detectImageFormat(buffer) {
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') {
        return { format: 'png', extension: 'png', mime: 'image/png' };
    }
    if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return { format: 'jpeg', extension: 'jpg', mime: 'image/jpeg' };
    }
    if (buffer.length >= 6 && buffer.toString('ascii', 0, 3) === 'GIF') {
        return { format: 'gif', extension: 'gif', mime: 'image/gif' };
    }
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        return { format: 'webp', extension: 'webp', mime: 'image/webp' };
    }
    return null;
}

function readImageSize(buffer, format) {
    if (format === 'svg') {
        const source = buffer.toString('utf8', 0, Math.min(buffer.length, 4096));
        const width = source.match(/<svg\b[^>]*\bwidth=["']([\d.]+)/i);
        const height = source.match(/<svg\b[^>]*\bheight=["']([\d.]+)/i);
        if (width && height) {
            return { width: Math.round(Number(width[1])), height: Math.round(Number(height[1])) };
        }
        const box = source.match(/viewBox=["']([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)/i);
        if (box) return { width: Math.round(Number(box[3])), height: Math.round(Number(box[4])) };
        return null;
    }
    if (format === 'png') {
        if (buffer.length < 24) return null;
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (format === 'jpeg') {
        let offset = 2;
        while (offset < buffer.length - 8) {
            if (buffer[offset] !== 0xFF) { offset += 1; continue; }
            const marker = buffer[offset + 1];
            if (marker === 0xD8 || marker === 0xD9 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
                offset += 2;
                continue;
            }
            if (offset + 4 > buffer.length) return null;
            const length = buffer.readUInt16BE(offset + 2);
            if (length < 2) return null;
            if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
                if (offset + 9 > buffer.length) return null;
                return {
                    height: buffer.readUInt16BE(offset + 5),
                    width: buffer.readUInt16BE(offset + 7),
                };
            }
            offset += 2 + length;
        }
        return null;
    }
    if (format === 'gif') {
        if (buffer.length < 10) return null;
        return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (format === 'webp') {
        if (buffer.length < 30) return null;
        const chunk = buffer.toString('ascii', 12, 16);
        if (chunk === 'VP8X') {
            return {
                width: 1 + buffer.readUIntLE(24, 3),
                height: 1 + buffer.readUIntLE(27, 3),
            };
        }
        if (chunk === 'VP8L') {
            const bits = buffer.readUInt32LE(21);
            return {
                width: 1 + (bits & 0x3FFF),
                height: 1 + ((bits >> 14) & 0x3FFF),
            };
        }
        if (chunk === 'VP8 ') {
            return {
                width: buffer.readUInt16LE(26) & 0x3FFF,
                height: buffer.readUInt16LE(28) & 0x3FFF,
            };
        }
        return null;
    }
    return null;
}

// ─── ZIP reader (stored + deflate, no dependencies) ───────────────────

function findEndOfCentralDirectory(buffer) {
    const min = Math.max(0, buffer.length - 65557);
    for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
        if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
    }
    return -1;
}

function readZipEntries(buffer) {
    if (buffer.length < 22) throw httpError(400, 'The uploaded file is not a valid ZIP archive.');
    const eocd = findEndOfCentralDirectory(buffer);
    if (eocd < 0) throw httpError(400, 'The uploaded file is not a valid ZIP archive.');
    const diskNumber = buffer.readUInt16LE(eocd + 4);
    const directoryDisk = buffer.readUInt16LE(eocd + 6);
    const entryCount = buffer.readUInt16LE(eocd + 10);
    const directorySize = buffer.readUInt32LE(eocd + 12);
    const directoryOffset = buffer.readUInt32LE(eocd + 16);
    if (diskNumber !== 0 || directoryDisk !== 0) {
        throw httpError(400, 'Multi-disk ZIP archives are not supported.');
    }
    if (entryCount === 0xFFFF || directoryOffset === 0xFFFFFFFF || directorySize === 0xFFFFFFFF) {
        throw httpError(400, 'ZIP64 archives are not supported by this importer.');
    }
    if (directoryOffset + directorySize > buffer.length) {
        throw httpError(400, 'The ZIP central directory is truncated.');
    }

    const entries = [];
    let offset = directoryOffset;
    for (let index = 0; index < entryCount; index += 1) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
            throw httpError(400, 'The ZIP central directory is corrupt.');
        }
        const flags = buffer.readUInt16LE(offset + 8);
        const method = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localOffset = buffer.readUInt32LE(offset + 42);
        const nameStart = offset + 46;
        const nameEnd = nameStart + nameLength;
        if (nameEnd > buffer.length) throw httpError(400, 'The ZIP entry name is truncated.');
        const name = buffer.toString('utf8', nameStart, nameEnd);
        entries.push({
            name,
            flags,
            method,
            compressedSize,
            uncompressedSize,
            localOffset,
        });
        offset = nameEnd + extraLength + commentLength;
    }
    return entries;
}

function extractZipEntry(buffer, entry) {
    if (entry.flags & 0x01) throw httpError(400, `Encrypted ZIP entry is not supported: ${entry.name}`);
    if (entry.localOffset + 30 > buffer.length) {
        throw httpError(400, `ZIP entry is truncated: ${entry.name}`);
    }
    if (buffer.readUInt32LE(entry.localOffset) !== 0x04034b50) {
        throw httpError(400, `ZIP entry has a bad local header: ${entry.name}`);
    }
    const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
    const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
    const dataStart = entry.localOffset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > buffer.length) throw httpError(400, `ZIP entry data is truncated: ${entry.name}`);
    const compressed = buffer.subarray(dataStart, dataEnd);
    if (entry.method === 0) return Buffer.from(compressed);
    if (entry.method === 8) {
        try {
            return zlib.inflateRawSync(compressed, {
                maxOutputLength: Math.max(entry.uncompressedSize + 1024, 1024),
            });
        } catch (error) {
            throw httpError(400, `Could not inflate ZIP entry ${entry.name}: ${error.message}`);
        }
    }
    throw httpError(400, `Unsupported ZIP compression method ${entry.method} for ${entry.name}.`);
}

function readSegmentMetadata(zipBuffer, zipEntries, imageEntries) {
    const manifests = zipEntries.filter((entry) => entry.name === 'image-to-layers.json');
    if (!manifests.length) return new Map();
    if (manifests.length > 1) throw httpError(400, 'The ZIP contains multiple segmentation manifests.');

    const manifestEntry = manifests[0];
    if (manifestEntry.uncompressedSize > 2 * 1024 * 1024) {
        throw httpError(400, 'The segmentation manifest is too large.');
    }

    let manifest;
    try {
        manifest = JSON.parse(extractZipEntry(zipBuffer, manifestEntry).toString('utf8'));
    } catch (error) {
        if (error.status) throw error;
        throw httpError(400, 'The segmentation manifest is not valid JSON.');
    }
    if (manifest?.schema !== 'image-to-layers/segments-v1' || !Array.isArray(manifest.layers)) {
        throw httpError(400, 'The ZIP contains an unsupported segmentation manifest.');
    }
    if (manifest.layers.length > MAX_SEGMENTS) {
        throw httpError(400, `The segmentation manifest contains more than ${MAX_SEGMENTS} layers.`);
    }

    const imagePaths = new Set(imageEntries
        .map((entry) => safeRelativePath(entry.name))
        .filter(Boolean));
    const roleNames = new Set([
        'background', 'midground', 'ground', 'foreground',
        'character', 'character-part', 'prop', 'effect',
    ]);
    const metadata = new Map();
    for (const layer of manifest.layers) {
        if (!layer || typeof layer !== 'object' || Array.isArray(layer)
            || typeof layer.file !== 'string' || typeof layer.name !== 'string') {
            throw httpError(400, 'The segmentation manifest contains an invalid layer.');
        }
        const file = safeRelativePath(layer.file);
        if (!file || !imagePaths.has(file)) {
            throw httpError(400, `The segmentation manifest references a missing image: ${layer.file}`);
        }
        if (metadata.has(file)) {
            throw httpError(400, `The segmentation manifest references an image more than once: ${file}`);
        }
        if (typeof layer.role !== 'string' || !roleNames.has(layer.role)) {
            throw httpError(400, `The segmentation manifest has an invalid role for ${file}.`);
        }
        for (const field of ['group', 'label', 'description']) {
            if (layer[field] !== undefined && typeof layer[field] !== 'string') {
                throw httpError(400, `The segmentation manifest has an invalid ${field} for ${file}.`);
            }
        }
        metadata.set(file, {
            name: sanitizeLabel(layer.name, path.basename(file).replace(/\.[^.]+$/, '')),
            role: layer.role,
            segmentGroup: sanitizeLabel(layer.group, '').slice(0, 80),
            label: sanitizeLabel(layer.label, '').slice(0, 80),
            description: sanitizeLabel(layer.description, '').slice(0, 300),
        });
    }
    return metadata;
}

// ─── Composition generation ───────────────────────────────────────────

function roleFor(name) {
    const n = String(name || '').toLowerCase();
    if (/^(sky|clouds?|backdrop|background)$/.test(n) || /distant|hill|mountain|horizon/.test(n)) return 'background';
    if (/lake|water|river|sea|ground|floor|shore|sand|earth/.test(n)) return 'ground';
    if (/bubble|speech|caption|label|text/.test(n)) return 'effect';
    if (/man|woman|figure|character|robot|swan|bird|mermaid|fairy|dwarf|boy|girl/.test(n)) return 'character';
    if (/eye|display|screen|hair|beard|dress|hat|jacket|glasses|sunglasses/.test(n)) return 'character-part';
    return 'prop';
}

function depthFor(name) {
    const n = String(name || '').toLowerCase();
    if (/sky|backdrop|background/.test(n)) return 0;
    if (/cloud/.test(n)) return 10;
    if (/distant|mountain|hill|horizon/.test(n)) return 20;
    if (/willow|tree|forest/.test(n)) return 30;
    if (/lake|water|river|sea|ground|floor|shore|sand|earth/.test(n)) return 40;
    if (/reed|cattail|grass|bush|plant|flower|leaf|leaves/.test(n)) return 50;
    if (/rock|stone|box|crate|cardboard|shelf|table/.test(n)) return 60;
    if (/man|woman|figure|character|robot|swan|bird|animal/.test(n)) return 70;
    if (/display|screen/.test(n)) return 78;
    if (/eye/.test(n)) return 84;
    if (/bubble|speech|caption|label|text/.test(n)) return 90;
    return 45;
}

function initialPlacement(name, width, height) {
    const n = String(name || '').toLowerCase();
    const centeredX = Math.max(0, Math.min(100 - width, (100 - width) / 2));
    if (/sky|cloud|backdrop|background/.test(n)) return { x: centeredX, y: 0 };
    if (/lake|water|river|sea|ground|floor|shore|sand|earth/.test(n)) {
        return { x: centeredX, y: Math.max(0, 100 - height) };
    }
    if (/reed|cattail|grass|bush|plant|rock|stone/.test(n)) {
        return { x: centeredX, y: Math.max(0, 100 - height - 2) };
    }
    if (/willow|tree|forest|hill|mountain|distant/.test(n)) {
        return { x: centeredX, y: Math.max(0, Math.min(100 - height, 45 - height / 2)) };
    }
    if (/bubble|speech|caption|label|text/.test(n)) return { x: centeredX, y: 4 };
    return { x: centeredX, y: Math.max(0, (100 - height) / 2) };
}

function layerIdFor(relative, index) {
    const stem = relative.replace(/\.[^.]+$/, '');
    const slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    return `layer-${index.toString(36)}-${slug || 'segment'}`.slice(0, 80);
}

function characterValue(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function defaultCharacterSettings(overrides = {}) {
    const source = overrides && typeof overrides === 'object' ? overrides : {};
    return {
        expression: CHARACTER_EXPRESSIONS.includes(source.expression) ? source.expression : 'neutral',
        blink: source.blink !== false,
        blinkRate: clamp(Math.round(characterValue(source.blinkRate, 12)), 2, 30),
        blinkAmount: clamp(characterValue(source.blinkAmount, 0.9), 0, 1),
        talk: source.talk === true,
        talkIntensity: clamp(characterValue(source.talkIntensity, 0.55), 0, 1),
        talkSpeed: clamp(characterValue(source.talkSpeed, 1), 0.5, 2),
        mouthOpen: clamp(characterValue(source.mouthOpen, 1), 0, 2),
        gazeX: clamp(characterValue(source.gazeX, 0), -1, 1),
        gazeY: clamp(characterValue(source.gazeY, 0), -1, 1),
        eyeWander: source.eyeWander !== false,
        breathe: source.breathe !== false,
        breatheAmount: clamp(characterValue(source.breatheAmount, 0.4), 0, 1),
        headSway: clamp(characterValue(source.headSway, 0.6), 0, 1),
        pulseAmount: clamp(characterValue(source.pulseAmount, 0), 0, 1),
        saccade: source.saccade !== false,
        speechText: typeof source.speechText === 'string' ? source.speechText.slice(0, 300) : '',
        speechRate: clamp(characterValue(source.speechRate, 1), 0.5, 2),
        speechStart: clamp(characterValue(source.speechStart, 0), 0, 30000),
        mouthPose: CHARACTER_VISEMES.includes(source.mouthPose) ? source.mouthPose : '',
    };
}

function emptyCharacterParts() {
    const parts = {};
    CHARACTER_PART_KEYS.forEach((key) => { parts[key] = []; });
    return parts;
}

function classifyCharacterPart(name) {
    for (const [part, matcher] of CHARACTER_PART_MATCHERS) {
        if (matcher.test(name)) return part;
    }
    return null;
}

function characterBox(layer) {
    return {
        left: Number(layer.x) || 0,
        top: Number(layer.y) || 0,
        right: (Number(layer.x) || 0) + (Number(layer.w) || 0),
        bottom: (Number(layer.y) || 0) + (Number(layer.h) || 0),
    };
}

function boxesTouch(a, b, margin = 2) {
    return a.left <= b.right + margin
        && a.right >= b.left - margin
        && a.top <= b.bottom + margin
        && a.bottom >= b.top - margin;
}

function detectCharacters(composition) {
    const referenceId = composition.referenceLayerId;
    const layers = (composition.layers || []).filter((layer) => layer.id !== referenceId);
    if (!layers.length) return [];
    const wholePattern = /^(mermaid|man|woman|boy|girl|robot|dragon|knight|wizard|character|figure|person)(?:-with-|-in-|$)/i;
    const wholeLayers = [];
    const partEntries = [];
    layers.forEach((layer) => {
        const name = String(layer.name || '').toLowerCase();
        if (wholePattern.test(name)) {
            wholeLayers.push(layer);
            return;
        }
        const part = classifyCharacterPart(name);
        if (part) partEntries.push({ layer, part });
    });
    const characters = [];
    const usedPartIds = new Set();
    const usedNames = new Set();

    const prettify = (value) => {
        const text = String(value || '').replace(/[-_]+/g, ' ').replace(/\d+$/, '').trim();
        return text ? text.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Character';
    };

    const addCharacter = (name, parts, hiddenIds = []) => {
        const cleaned = {};
        let hasPart = false;
        CHARACTER_PART_KEYS.forEach((key) => {
            cleaned[key] = [...new Set(Array.isArray(parts[key]) ? parts[key] : [])];
            if (cleaned[key].length) hasPart = true;
        });
        if (!hasPart) return;
        const baseName = String(name || 'Character').replace(/\s+/g, ' ').trim() || 'Character';
        let finalName = baseName;
        let suffix = 2;
        while (usedNames.has(finalName.toLowerCase())) {
            finalName = `${baseName} ${suffix}`;
            suffix += 1;
        }
        usedNames.add(finalName.toLowerCase());
        characters.push({
            id: `character-${characters.length + 1}`,
            name: finalName,
            parts: cleaned,
            hidden: [...new Set(hiddenIds)].filter((layerId) => layers.some((layer) => layer.id === layerId)),
            settings: defaultCharacterSettings(),
            applied: false,
            detected: true,
            rigVersion: 3,
        });
    };

    wholeLayers.forEach((layer) => {
        const parts = emptyCharacterParts();
        parts.body.push(layer.id);
        parts.head.push(layer.id);
        const prefix = String(layer.name || '').toLowerCase();
        partEntries.forEach((entry) => {
            const partName = String(entry.layer.name || '').toLowerCase();
            if (partName.startsWith(`${prefix}-`)) {
                parts[entry.part].push(entry.layer.id);
                usedPartIds.add(entry.layer.id);
            }
        });
        addCharacter(prettify(layer.name), parts);
    });

    const remaining = partEntries.filter((entry) => !usedPartIds.has(entry.layer.id));
    if (!remaining.length) return characters.slice(0, 12);
    const parent = remaining.map((_, index) => index);
    const find = (index) => {
        let current = index;
        while (parent[current] !== current) {
            parent[current] = parent[parent[current]];
            current = parent[current];
        }
        return current;
    };
    const union = (a, b) => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent[rootB] = rootA;
    };
    for (let index = 0; index < remaining.length; index += 1) {
        for (let other = index + 1; other < remaining.length; other += 1) {
            if (boxesTouch(characterBox(remaining[index].layer), characterBox(remaining[other].layer), 3)) {
                union(index, other);
            }
        }
    }
    const groups = new Map();
    remaining.forEach((entry, index) => {
        const root = find(index);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(entry);
    });
    for (const group of groups.values()) {
        if (group.length < 2) continue;
        const parts = emptyCharacterParts();
        group.forEach((entry) => parts[entry.part].push(entry.layer.id));
        if (!parts.brows.length && parts.hands.length && parts.eyes.length) {
            const eyeLayers = parts.eyes
                .map((layerId) => layers.find((layer) => layer.id === layerId))
                .filter(Boolean);
            const eyeCenterY = eyeLayers.reduce((sum, layer) => sum + layer.y + layer.h / 2, 0)
                / Math.max(1, eyeLayers.length);
            const browIds = parts.hands.filter((layerId) => {
                const layer = layers.find((entry) => entry.id === layerId);
                return layer
                    && layer.y + layer.h / 2 < eyeCenterY
                    && layer.w * layer.h < 80;
            });
            if (browIds.length) {
                parts.brows = browIds;
                parts.hands = parts.hands.filter((layerId) => !browIds.includes(layerId));
            }
        }
        const hidden = [];
        if (parts.eyes.length >= 3) {
            const eyeLayers = parts.eyes
                .map((layerId) => layers.find((layer) => layer.id === layerId))
                .filter(Boolean);
            if (eyeLayers.length >= 3) {
                const widest = eyeLayers.reduce((best, layer) => (layer.w > best.w ? layer : best), eyeLayers[0]);
                const others = eyeLayers.filter((layer) => layer.id !== widest.id);
                const widestOther = Math.max(...others.map((layer) => layer.w));
                const minX = Math.min(...others.map((layer) => layer.x));
                const maxX = Math.max(...others.map((layer) => layer.x + layer.w));
                const covers = widest.x <= minX + 1 && widest.x + widest.w >= maxX - 1;
                if (others.length >= 2 && widest.w > widestOther * 1.45 && covers) {
                    parts.eyes = others.map((layer) => layer.id);
                    hidden.push(widest.id);
                    if (parts.pupils.length) {
                        parts.pupils.forEach((layerId) => hidden.push(layerId));
                        parts.pupils = [];
                    }
                }
            }
        }
        addCharacter(prettify(composition.name), parts, hidden);
    }
    return characters.slice(0, 12);
}

function ensureCharacters(composition) {
    const needsDetection = !Array.isArray(composition.characters)
        || composition.characters.length === 0
        || composition.characters.some((character) => Number(character.rigVersion) < 3);
    if (!needsDetection) return false;
    const oldLayerIds = new Set();
    (composition.characters || []).forEach((character) => {
        CHARACTER_PART_KEYS.forEach((part) => {
            (character.parts?.[part] || []).forEach((layerId) => oldLayerIds.add(layerId));
        });
        (character.hidden || []).forEach((layerId) => oldLayerIds.add(layerId));
    });
    const characters = detectCharacters(composition);
    if (!characters.length) {
        if (!Array.isArray(composition.characters)) composition.characters = [];
        return false;
    }
    composition.layers.forEach((layer) => {
        if (oldLayerIds.has(layer.id)) layer.keyframes = [];
    });
    composition.characters = characters;
    return true;
}

function buildComposition({ id, name, reference, segments, meta }) {
    const layers = [{
        id: 'reference',
        name: 'Final image',
        role: 'background',
        url: meta.referenceUrl,
        frames: [meta.referenceUrl],
        spriteFps: 1,
        spriteMode: 'once',
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        opacity: 1,
        z: 0,
        rotation: 0,
        fit: 'contain',
        visible: true,
        locked: true,
        positionConfirmed: true,
        keyframes: [],
    }];

    const ordered = [...segments].sort((a, b) => a.relative.localeCompare(b.relative, 'en', { numeric: true }));
    ordered.forEach((segment, index) => {
        const stem = path.basename(segment.relative).replace(/\.[^.]+$/, '');
        const layerName = segment.name || stem;
        const width = Math.max(1, Math.min(300, segment.width / reference.width * 100));
        const height = Math.max(1, Math.min(300, segment.height / reference.height * 100));
        const box = initialPlacement(layerName, width, height);
        const depth = depthFor(layerName);
        const layer = {
            id: layerIdFor(segment.relative, index),
            name: layerName,
            role: segment.role || roleFor(layerName),
            url: segment.url,
            frames: [segment.url],
            spriteFps: 1,
            spriteMode: 'once',
            x: Number(clamp(box.x, -100, 200).toFixed(2)),
            y: Number(clamp(box.y, -100, 200).toFixed(2)),
            w: Number(width.toFixed(2)),
            h: Number(height.toFixed(2)),
            opacity: 1,
            z: depth * 10 + index,
            rotation: 0,
            fit: 'contain',
            visible: true,
            locked: false,
            positionConfirmed: false,
            keyframes: [],
        };
        if (segment.segmentGroup) layer.segmentGroup = segment.segmentGroup;
        if (segment.label) layer.label = segment.label;
        if (segment.description) layer.description = segment.description;
        layers.push(layer);
    });

    layers.sort((a, b) => a.z - b.z);
    let z = 2;
    layers.forEach((layer) => {
        if (layer.id === 'reference') return;
        layer.z = z;
        z += 2;
    });

    const composition = {
        version: 3,
        id,
        name,
        width: reference.width,
        height: reference.height,
        duration: DEFAULT_DURATION,
        defaultLocale: 'en',
        referenceLayerId: 'reference',
        // Emit the master format explicitly so imports need no silent upgrade.
        formats: [{
            id: 'master',
            isMaster: true,
            channel: 'custom',
            label: 'Master',
            width: reference.width,
            height: reference.height,
            layerOverrides: {},
            variableValues: {},
        }],
        activeFormatId: 'master',
        variables: [],
        brandKit: null,
        layers,
        meta,
    };
    composition.characters = detectCharacters(composition);
    return composition;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// ─── Import persistence ───────────────────────────────────────────────

async function writeFileAtomic(file, data) {
    const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fsp.writeFile(temp, data);
    await fsp.rename(temp, file);
}

async function createImport(payload) {
    const zipBuffer = decodeBase64(payload.zip, 'Segments ZIP');
    if (zipBuffer.length > MAX_ZIP) throw httpError(413, 'The segments ZIP is too large.');
    const referenceBuffer = decodeBase64(payload.reference, 'Final image');
    if (referenceBuffer.length > MAX_REFERENCE) throw httpError(413, 'The final image is too large.');

    const referenceFormat = detectImageFormat(referenceBuffer);
    if (!referenceFormat) throw httpError(400, 'The final image must be a PNG, JPEG, GIF, or WebP file.');
    const referenceSize = readImageSize(referenceBuffer, referenceFormat.format);
    if (!referenceSize || !referenceSize.width || !referenceSize.height) {
        throw httpError(400, 'Could not read the final image dimensions.');
    }
    if (referenceSize.width > 10000 || referenceSize.height > 10000) {
        throw httpError(400, 'The final image cannot exceed 10000 pixels in either dimension.');
    }

    const zipEntries = readZipEntries(zipBuffer);
    const imageEntries = zipEntries.filter((entry) => {
        if (entry.name.endsWith('/')) return false;
        const relative = safeRelativePath(entry.name);
        return Boolean(relative && isImageName(relative));
    });
    if (!imageEntries.length) throw httpError(400, 'The ZIP does not contain any PNG, JPEG, GIF, or WebP images.');
    if (imageEntries.length > MAX_SEGMENTS) {
        throw httpError(400, `The ZIP contains more than ${MAX_SEGMENTS} segment images.`);
    }
    const segmentMetadata = readSegmentMetadata(zipBuffer, zipEntries, imageEntries);

    const name = sanitizeLabel(payload.name, 'Imported scene');
    const base = slugify(name) || 'imported-scene';
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const id = `${base.slice(0, 40)}-${stamp}-${crypto.randomBytes(2).toString('hex')}`;
    const projectDir = path.join(IMPORTS_DIR, id);
    const segmentsDir = path.join(projectDir, 'segments');
    const referenceName = sanitizeFilename(payload.referenceName, `final.${referenceFormat.extension}`);
    const zipName = sanitizeFilename(payload.zipName, 'segments.zip');
    const referenceFile = `reference.${referenceFormat.extension}`;
    const referenceUrl = urlPath('data', 'imports', id, referenceFile);

    await fsp.mkdir(segmentsDir, { recursive: true });

    try {
        const seen = new Set();
        const segments = [];
        let extractedBytes = 0;

        for (const entry of imageEntries) {
            const relative = safeRelativePath(entry.name);
            if (!relative || seen.has(relative)) continue;
            const data = extractZipEntry(zipBuffer, entry);
            extractedBytes += data.length;
            if (extractedBytes > MAX_EXTRACTED) throw httpError(413, 'The extracted ZIP is too large.');
            if (data.length > MAX_IMAGE_BYTES) throw httpError(413, `Segment image is too large: ${relative}`);

            const format = detectImageFormat(data);
            if (!format) continue;
            const size = readImageSize(data, format.format);
            if (!size || !size.width || !size.height) continue;

            const target = path.join(segmentsDir, ...relative.split('/'));
            const segmentsRoot = segmentsDir + path.sep;
            if (!path.resolve(target).startsWith(segmentsRoot)) continue;
            await fsp.mkdir(path.dirname(target), { recursive: true });
            await fsp.writeFile(target, data);
            seen.add(relative);
            segments.push({
                relative,
                url: urlPath('data', 'imports', id, 'segments', relative),
                width: size.width,
                height: size.height,
                ...(segmentMetadata.get(relative) || {}),
            });
        }

        if (!segments.length) throw httpError(400, 'The ZIP did not contain any readable images.');

        await fsp.writeFile(path.join(projectDir, 'source.zip'), zipBuffer);
        await fsp.writeFile(path.join(projectDir, referenceFile), referenceBuffer);

        const createdAt = new Date().toISOString();
        const meta = {
            source: 'zip',
            zipName,
            referenceName,
            referenceUrl,
            segmentCount: segments.length,
            createdAt,
            updatedAt: createdAt,
            storage: `data/imports/${id}`,
        };
        const composition = buildComposition({
            id,
            name,
            reference: {
                width: referenceSize.width,
                height: referenceSize.height,
                format: referenceFormat.format,
            },
            segments,
            meta,
        });
        await writeFileAtomic(path.join(projectDir, 'composition.json'), JSON.stringify(composition, null, 2));

        return {
            project: {
                id,
                name,
                createdAt,
                updatedAt: createdAt,
                width: composition.width,
                height: composition.height,
                layerCount: composition.layers.length,
                referenceUrl,
            },
            composition,
        };
    } catch (error) {
        await fsp.rm(projectDir, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
}

// ─── Character bundle import ──────────────────────────────────────────
const CHARACTER_SCHEMA = 'layer-studio/character/v1';
const MAX_CHARACTER_LAYERS = 120;

async function createCharacterImport(payload) {
    const zipBuffer = decodeBase64(payload.bundle, 'Character bundle');
    if (zipBuffer.length > MAX_ZIP) throw httpError(413, 'The character bundle is too large.');
    const entries = readZipEntries(zipBuffer).filter((entry) => !entry.name.endsWith('/'));
    const byPath = new Map();
    entries.forEach((entry) => {
        const relative = safeRelativePath(entry.name);
        if (relative && !byPath.has(relative)) byPath.set(relative, entry);
    });
    const manifestEntry = byPath.get('character.json');
    if (!manifestEntry) {
        throw httpError(400, 'This ZIP has no character.json. Export the bundle with "Export character" in Layer Studio, or use "Import ZIP + image" for plain segments.');
    }
    let manifest;
    try {
        manifest = JSON.parse(extractZipEntry(zipBuffer, manifestEntry).toString('utf8'));
    } catch {
        throw httpError(400, 'character.json is not valid JSON.');
    }
    if (!manifest || manifest.schema !== CHARACTER_SCHEMA) {
        throw httpError(400, `character.json must declare schema "${CHARACTER_SCHEMA}".`);
    }
    const sourceLayers = Array.isArray(manifest.layers) ? manifest.layers : [];
    if (!sourceLayers.length) throw httpError(400, 'The character bundle lists no layers.');
    if (sourceLayers.length > MAX_CHARACTER_LAYERS) {
        throw httpError(400, `A character bundle cannot contain more than ${MAX_CHARACTER_LAYERS} layers.`);
    }
    const rigSource = manifest.character && typeof manifest.character === 'object' ? manifest.character : null;
    if (!rigSource) throw httpError(400, 'character.json has no "character" rig definition.');

    const width = Math.round(clamp(Number(manifest.width) || 0, 16, 10000));
    const height = Math.round(clamp(Number(manifest.height) || 0, 16, 10000));
    if (!Number(manifest.width) || !Number(manifest.height)) {
        throw httpError(400, 'character.json must include the canvas width and height.');
    }

    const name = sanitizeLabel(payload.name || manifest.name, 'Imported character');
    const base = slugify(name) || 'imported-character';
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const id = `${base.slice(0, 40)}-${stamp}-${crypto.randomBytes(2).toString('hex')}`;
    const projectDir = path.join(IMPORTS_DIR, id);
    const segmentsDir = path.join(projectDir, 'segments');
    await fsp.mkdir(segmentsDir, { recursive: true });

    try {
        let extractedBytes = 0;
        const readImage = (relativeRaw, label) => {
            const relative = safeRelativePath(relativeRaw);
            const entry = relative ? byPath.get(relative) : null;
            if (!entry) throw httpError(400, `The bundle is missing ${label}: ${relativeRaw}`);
            const data = extractZipEntry(zipBuffer, entry);
            extractedBytes += data.length;
            if (extractedBytes > MAX_EXTRACTED) throw httpError(413, 'The extracted bundle is too large.');
            if (data.length > MAX_IMAGE_BYTES) throw httpError(413, `Image is too large: ${relative}`);
            const format = detectImageFormat(data);
            const size = format ? readImageSize(data, format.format) : null;
            if (!format || !size || !size.width || !size.height) {
                throw httpError(400, `${label} is not a readable image: ${relative}`);
            }
            return { relative, data, size };
        };

        const idMap = new Map();
        const layers = [];
        const used = new Set();
        const ordered = sourceLayers
            .map((layer, index) => ({ layer, index }))
            .filter(({ layer }) => layer && typeof layer === 'object' && typeof layer.file === 'string')
            .sort((a, b) => (Number(a.layer.z) || 0) - (Number(b.layer.z) || 0) || a.index - b.index);
        if (!ordered.length) throw httpError(400, 'No layer in character.json points at an image file.');

        for (let index = 0; index < ordered.length; index += 1) {
            const { layer } = ordered[index];
            const image = readImage(layer.file, 'layer image');
            if (used.has(image.relative)) {
                // Two manifest layers sharing a file are fine; reuse the stored copy.
            }
            used.add(image.relative);
            const target = path.join(segmentsDir, ...image.relative.split('/'));
            if (!path.resolve(target).startsWith(segmentsDir + path.sep)) {
                throw httpError(400, `Unsafe path in bundle: ${image.relative}`);
            }
            await fsp.mkdir(path.dirname(target), { recursive: true });
            await fsp.writeFile(target, image.data);
            const url = urlPath('data', 'imports', id, 'segments', image.relative);
            const stem = path.basename(image.relative).replace(/\.[^.]+$/, '');
            const newId = layerIdFor(image.relative, index);
            let finalId = newId;
            let bump = 2;
            while (layers.some((entry) => entry.id === finalId)) finalId = `${newId}-${bump++}`.slice(0, 80);
            if (typeof layer.id === 'string') idMap.set(layer.id, finalId);
            layers.push({
                id: finalId,
                name: sanitizeLabel(layer.name, stem),
                role: ['background', 'midground', 'ground', 'foreground', 'character', 'character-part', 'prop', 'effect']
                    .includes(layer.role) ? layer.role : 'character-part',
                url,
                frames: [url],
                spriteFps: 1,
                spriteMode: 'once',
                x: Number(clamp(characterValue(layer.x, 0), -100, 200).toFixed(3)),
                y: Number(clamp(characterValue(layer.y, 0), -100, 200).toFixed(3)),
                w: Number(clamp(characterValue(layer.w, 10), 1, 300).toFixed(3)),
                h: Number(clamp(characterValue(layer.h, 10), 1, 300).toFixed(3)),
                opacity: clamp(characterValue(layer.opacity, 1), 0, 1),
                z: (index + 1) * 2,
                rotation: clamp(characterValue(layer.rotation, 0), -3600, 3600),
                fit: layer.fit === 'cover' ? 'cover' : 'contain',
                visible: layer.visible !== false,
                locked: false,
                positionConfirmed: true,
                part: typeof layer.part === 'string' ? layer.part.slice(0, 32) : '',
                group: typeof layer.group === 'string' ? layer.group.slice(0, 64) : '',
                segmentGroup: typeof layer.segmentGroup === 'string' ? layer.segmentGroup.trim().slice(0, 80) : '',
                variant: typeof layer.variant === 'string' ? layer.variant.slice(0, 48) : '',
                keyframes: [],
            });
        }

        // Rig: remap manifest layer ids to the new ids and drop dangling ones.
        const mapIds = (list) => [...new Set(
            (Array.isArray(list) ? list : []).map((value) => idMap.get(value)).filter(Boolean),
        )];
        const parts = emptyCharacterParts();
        let hasPart = false;
        CHARACTER_PART_KEYS.forEach((key) => {
            parts[key] = mapIds(rigSource.parts?.[key]);
            if (parts[key].length) hasPart = true;
        });
        if (!hasPart) throw httpError(400, 'The character rig does not reference any layer in the bundle.');
        const character = {
            id: 'character-1',
            name: sanitizeLabel(rigSource.name, name),
            parts,
            hidden: mapIds(rigSource.hidden),
            coverLayerId: null,
            settings: defaultCharacterSettings(rigSource.settings),
            applied: true,
            detected: false,
            rigVersion: 3,
            variants: rigSource.variants && typeof rigSource.variants === 'object' ? rigSource.variants : null,
        };

        // Optional preview: kept as a hidden reference layer. The studio hides the
        // reference while a v3 rig is applied, so parts never double-expose it.
        let referenceUrl = layers[0].url;
        let referenceLayerId = null;
        if (typeof manifest.preview === 'string' && manifest.preview) {
            const preview = readImage(manifest.preview, 'preview image');
            const format = detectImageFormat(preview.data);
            const previewFile = `reference.${format.extension}`;
            await fsp.writeFile(path.join(projectDir, previewFile), preview.data);
            referenceUrl = urlPath('data', 'imports', id, previewFile);
            referenceLayerId = 'reference';
            layers.unshift({
                id: 'reference',
                name: 'Final image',
                role: 'background',
                url: referenceUrl,
                frames: [referenceUrl],
                spriteFps: 1,
                spriteMode: 'once',
                x: 0, y: 0, w: 100, h: 100,
                opacity: 1,
                z: 0,
                rotation: 0,
                fit: 'contain',
                visible: false,
                locked: true,
                positionConfirmed: true,
                keyframes: [],
            });
        }

        await fsp.writeFile(path.join(projectDir, 'source.zip'), zipBuffer);
        const createdAt = new Date().toISOString();
        const meta = {
            source: 'character',
            bundleName: sanitizeFilename(payload.bundleName, 'character.zip'),
            referenceUrl,
            segmentCount: layers.length,
            createdAt,
            updatedAt: createdAt,
            storage: `data/imports/${id}`,
        };
        if (typeof manifest.context === 'string' && manifest.context.trim()) {
            meta.context = manifest.context.trim().slice(0, MAX_CONTEXT_CHARS);
        }
        const composition = {
            version: 1,
            id,
            name,
            width,
            height,
            duration: Math.round(clamp(Number(manifest.duration) || DEFAULT_DURATION, 500, 30000)),
            referenceLayerId,
            layers,
            characters: [character],
            meta,
        };
        await writeFileAtomic(path.join(projectDir, 'composition.json'), JSON.stringify(composition, null, 2));
        return {
            project: {
                id,
                name,
                createdAt,
                updatedAt: createdAt,
                width,
                height,
                layerCount: layers.length,
                referenceUrl,
            },
            composition,
        };
    } catch (error) {
        await fsp.rm(projectDir, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
}

async function listImports() {
    await fsp.mkdir(IMPORTS_DIR, { recursive: true });
    const entries = await fsp.readdir(IMPORTS_DIR, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const compositionPath = path.join(IMPORTS_DIR, entry.name, 'composition.json');
        try {
            const stat = await fsp.stat(compositionPath);
            const composition = JSON.parse(await fsp.readFile(compositionPath, 'utf8'));
            const meta = composition.meta || {};
            projects.push({
                id: entry.name,
                name: composition.name || entry.name,
                createdAt: meta.createdAt || stat.birthtime.toISOString(),
                updatedAt: meta.updatedAt || stat.mtime.toISOString(),
                width: composition.width || 0,
                height: composition.height || 0,
                layerCount: Array.isArray(composition.layers)
                    ? composition.layers.filter((layer) => layer.rig !== true).length
                    : 0,
                referenceUrl: meta.referenceUrl || null,
            });
        } catch (error) {
            console.warn(`[studio] could not read project ${entry.name}:`, error.message);
        }
    }
    projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return projects;
}

async function listStudioProjects() {
    const archivedProjects = await readStudioProjectArchive();
    const projects = [];
    await fsp.mkdir(PROJECTS_DIR, { recursive: true });
    const entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory() || !/^[A-Za-z0-9_-]{1,80}$/.test(entry.name)) continue;
        const compositionsDir = path.join(PROJECTS_DIR, entry.name, 'compositions');
        let files;
        try {
            files = await fsp.readdir(compositionsDir, { withFileTypes: true });
        } catch (error) {
            if (error.code === 'ENOENT') continue;
            throw error;
        }
        const compositions = [];
        const compositionIds = new Set();
        for (const file of files) {
            const match = file.isFile() && file.name.match(/^([A-Za-z0-9_-]{1,80})\.composition\.json$/);
            if (!match) continue;
            try {
                const composition = JSON.parse(await fsp.readFile(path.join(compositionsDir, file.name), 'utf8'));
                compositionIds.add(match[1]);
                compositions.push({
                    id: match[1],
                    name: composition.name || match[1],
                    kind: 'repository',
                });
            } catch (error) {
                console.warn(`[studio] could not read composition ${entry.name}/${file.name}:`, error.message);
            }
        }
        const animationsDir = path.join(PROJECTS_DIR, entry.name, 'animations');
        let animationFiles = [];
        try {
            animationFiles = await fsp.readdir(animationsDir, { withFileTypes: true });
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        for (const file of animationFiles) {
            const match = file.isFile() && file.name.match(/^([A-Za-z0-9_-]{1,80})\.animation\.json$/);
            if (!match || compositionIds.has(match[1])) continue;
            try {
                const animationFile = path.join(animationsDir, file.name);
                const manifest = JSON.parse(await fsp.readFile(animationFile, 'utf8'));
                if (isStudioCompositionDocument(manifest)) {
                    compositions.push({
                        id: match[1],
                        name: manifest.name || match[1],
                        kind: 'animation',
                    });
                    continue;
                }
                if (manifest.version !== 1
                    || manifest.type !== 'studio-scene-animation'
                    || manifest.id !== match[1]
                    || manifest.projectId !== entry.name
                    || typeof manifest.name !== 'string'
                    || !/^[A-Za-z0-9_-]{1,80}$/.test(manifest.sceneId || '')
                    || !compositionIds.has(manifest.sceneId)) {
                    throw new Error('invalid scene animation manifest header or scene reference');
                }
                compositions.push({
                    id: manifest.id,
                    name: manifest.name,
                    kind: 'animation',
                    sceneId: manifest.sceneId,
                });
            } catch (error) {
                console.warn(`[studio] could not read scene animation ${entry.name}/${file.name}:`, error.message);
            }
        }
        if (compositions.length) {
            compositions.sort((a, b) => Number(a.kind === 'animation') - Number(b.kind === 'animation')
                || a.name.localeCompare(b.name));
            projects.push({
                id: `repo-${entry.name}`,
                name: entry.name.replace(/[-_]+/g, ' '),
                compositions,
                archived: archivedProjects.has(`repo-${entry.name}`),
            });
        }
    }

    const imports = await listImports();
    imports.forEach((project) => {
        projects.push({
            id: `import-${project.id}`,
            name: project.name,
            compositions: [{ id: 'main', name: project.name, kind: 'import' }],
            archived: archivedProjects.has(`import-${project.id}`),
        });
    });
    projects.sort((a, b) => a.name.localeCompare(b.name));
    return projects;
}

async function readStudioProjectArchive() {
    try {
        const archivedIds = JSON.parse(await fsp.readFile(STUDIO_PROJECT_ARCHIVE_FILE, 'utf8'));
        if (!Array.isArray(archivedIds)
            || archivedIds.some((id) => typeof id !== 'string' || !/^(?:repo|import)-[A-Za-z0-9_-]{1,80}$/.test(id))) {
            throw new Error('The studio project archive file has an invalid format.');
        }
        return new Set(archivedIds);
    } catch (error) {
        if (error.code === 'ENOENT') return new Set();
        throw error;
    }
}

async function setStudioProjectArchived(projectId, archived) {
    const projects = await listStudioProjects();
    if (!projects.some((project) => project.id === projectId)) {
        throw httpError(404, 'Studio project not found.');
    }
    const archivedIds = await readStudioProjectArchive();
    if (archived) archivedIds.add(projectId);
    else archivedIds.delete(projectId);
    await fsp.mkdir(SETTINGS_DIR, { recursive: true });
    await writeFileAtomic(
        STUDIO_PROJECT_ARCHIVE_FILE,
        JSON.stringify([...archivedIds].sort(), null, 2),
    );
    return { id: projectId, archived };
}

async function readStudioComposition(projectId, compositionId) {
    const repoMatch = projectId.match(/^repo-([A-Za-z0-9_-]{1,80})$/);
    if (repoMatch && /^[A-Za-z0-9_-]{1,80}$/.test(compositionId)) {
        try {
            const compositionFile = path.join(
                PROJECTS_DIR,
                repoMatch[1],
                'compositions',
                `${compositionId}.composition.json`,
            );
            try {
                return JSON.parse(await fsp.readFile(compositionFile, 'utf8'));
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }

            const animationFile = path.join(
                PROJECTS_DIR,
                repoMatch[1],
                'animations',
                `${compositionId}.animation.json`,
            );
            const manifest = JSON.parse(await fsp.readFile(animationFile, 'utf8'));
            if (isStudioCompositionDocument(manifest)) return manifest;
            if (manifest.version !== 1
                || manifest.type !== 'studio-scene-animation'
                || manifest.id !== compositionId
                || manifest.projectId !== repoMatch[1]
                || typeof manifest.sceneId !== 'string'
                || !/^[A-Za-z0-9_-]{1,80}$/.test(manifest.sceneId)) {
                throw httpError(400, 'The repository scene animation manifest is invalid.');
            }
            const sceneFile = path.join(
                PROJECTS_DIR,
                repoMatch[1],
                'compositions',
                `${manifest.sceneId}.composition.json`,
            );
            const scene = JSON.parse(await fsp.readFile(sceneFile, 'utf8'));
            return { type: 'studio-scene-animation', scene, animation: manifest };
        } catch (error) {
            if (error.code === 'ENOENT') throw httpError(404, 'Repository composition not found.');
            if (error.status) throw error;
            throw httpError(500, `Could not read the repository composition: ${error.message}`);
        }
    }

    const importMatch = projectId.match(/^import-([A-Za-z0-9_-]{1,80})$/);
    if (importMatch && compositionId === 'main') {
        return readSavedComposition(importMatch[1]);
    }
    throw httpError(404, 'Project composition not found.');
}

function isStudioCompositionDocument(value) {
    return Boolean(value
        && typeof value === 'object'
        && !Array.isArray(value)
        && typeof value.id === 'string'
        && /^[A-Za-z0-9_-]{1,80}$/.test(value.id)
        && typeof value.name === 'string'
        && Array.isArray(value.layers)
        && value.layers.length <= 500
        && Number.isFinite(value.width)
        && Number.isFinite(value.height)
        && Number.isFinite(value.duration));
}

async function readSavedComposition(id) {
    const file = path.join(IMPORTS_DIR, id, 'composition.json');
    try {
        const composition = JSON.parse(await fsp.readFile(file, 'utf8'));
        if (ensureCharacters(composition)) {
            await writeFileAtomic(file, JSON.stringify(composition, null, 2)).catch((error) => {
                console.warn(`[studio] could not persist detected characters for ${id}:`, error.message);
            });
        }
        return composition;
    } catch (error) {
        if (error.code === 'ENOENT') throw httpError(404, 'Saved project not found.');
        if (error.status) throw error;
        throw httpError(500, `Could not read the saved project: ${error.message}`);
    }
}

async function saveComposition(id, payload) {
    const projectDir = path.join(IMPORTS_DIR, id);
    const file = path.join(projectDir, 'composition.json');
    const existing = await readSavedComposition(id);
    const incoming = payload && typeof payload === 'object' && payload.composition ? payload.composition : payload;
    if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.layers)) {
        throw httpError(400, 'The request must include a composition with a layers array.');
    }
    if (incoming.layers.length > MAX_LAYERS) {
        throw httpError(400, `A composition cannot contain more than ${MAX_LAYERS} layers.`);
    }
    const encoded = JSON.stringify(incoming);
    if (encoded.length > MAX_COMPOSITION_BYTES) throw httpError(413, 'The composition is too large to save.');

    const meta = {
        ...(existing.meta || {}),
        ...(payload && typeof payload.meta === 'object' && payload.meta ? payload.meta : {}),
        updatedAt: new Date().toISOString(),
    };
    // Preserve rig metadata on round-trip, even if a stale client still
    // normalises layers with a schema that predates part/group/variant.
    const existingLayers = new Map((existing.layers || []).map((layer) => [layer.id, layer]));
    const layers = incoming.layers.map((layer) => {
        if (!layer || typeof layer !== 'object') return layer;
        const prior = existingLayers.get(layer.id);
        if (!prior) return layer;
        const merged = {
            ...layer,
            type: layer.type || prior.type || 'image',
            part: layer.part || prior.part || '',
            group: layer.group || prior.group || '',
            variant: layer.variant || prior.variant || '',
        };
        // Text metadata must survive a round-trip from a pre-text client.
        ['text', 'font', 'color', 'align', 'verticalAlign', 'overflow'].forEach((key) => {
            if (merged[key] === undefined && prior[key] !== undefined) merged[key] = prior[key];
        });
        // A current client always sends `bindings`; a stale one omits the key
        // entirely. Preserve only in the second case, so an intentional unlink
        // (an empty object) is never resurrected.
        if (!('bindings' in layer) && prior.bindings) merged.bindings = prior.bindings;
        // Phase 4: a client that predates safe zones must not strip the flag.
        if (!('bleed' in layer) && prior.bleed !== undefined) merged.bleed = prior.bleed;
        return merged;
    });
    // A stale v2 client must not downgrade a v3 rig that already exists.
    const existingCharacters = Array.isArray(existing.characters) ? existing.characters : [];
    const existingV3 = existingCharacters.find((character) => Number(character.rigVersion) >= 3);
    const incomingCharacters = Array.isArray(incoming.characters) ? incoming.characters : existingCharacters;
    const incomingHasV3 = incomingCharacters.some((character) => Number(character.rigVersion) >= 3);
    const characters = (existingV3 && !incomingHasV3)
        ? existingCharacters
        : incomingCharacters.slice(0, 12);
    const composition = {
        ...incoming,
        // Never downgrade a file's schema version on save.
        version: Math.max(Number(incoming.version) || 1, Number(existing.version) || 1),
        id,
        name: sanitizeLabel(incoming.name, existing.name || 'Imported scene'),
        width: Number(incoming.width) || existing.width,
        height: Number(incoming.height) || existing.height,
        duration: Number(incoming.duration) || existing.duration || DEFAULT_DURATION,
        defaultLocale: typeof incoming.defaultLocale === 'string'
            ? incoming.defaultLocale
            : (existing.defaultLocale || 'en'),
        referenceLayerId: typeof incoming.referenceLayerId === 'string' ? incoming.referenceLayerId : null,
        characters,
        layers,
        // Stale-client protection for the additive Phase 2/3 fields: a client
        // that predates them omits the key, so the stored value wins.
        formats: (Array.isArray(incoming.formats) && incoming.formats.length)
            ? incoming.formats
            : (Array.isArray(existing.formats) && existing.formats.length ? existing.formats : []),
        activeFormatId: typeof incoming.activeFormatId === 'string'
            ? incoming.activeFormatId
            : (existing.activeFormatId || 'master'),
        variables: Array.isArray(incoming.variables)
            ? incoming.variables
            : (Array.isArray(existing.variables) ? existing.variables : []),
        brandKit: incoming.brandKit !== undefined
            ? incoming.brandKit
            : (existing.brandKit !== undefined ? existing.brandKit : null),
        // Phase 4 fields: a stale client omits the key entirely, so keep what
        // is stored rather than silently detaching the shared kit.
        brandKitId: incoming.brandKitId !== undefined
            ? incoming.brandKitId
            : (existing.brandKitId !== undefined ? existing.brandKitId : null),
        guardrails: incoming.guardrails && typeof incoming.guardrails === 'object'
            ? incoming.guardrails
            : (existing.guardrails || { enabled: false, block: false }),
        showSafeZones: incoming.showSafeZones !== undefined
            ? incoming.showSafeZones !== false
            : (existing.showSafeZones !== false),
        meta,
    };
    await fsp.mkdir(projectDir, { recursive: true });
    await writeFileAtomic(file, JSON.stringify(composition, null, 2));
    return { composition, meta };
}

async function createRepositoryCopy(payload) {
    const sourceProjectId = typeof payload?.sourceProjectId === 'string' ? payload.sourceProjectId : '';
    const sourceCompositionId = typeof payload?.sourceCompositionId === 'string' ? payload.sourceCompositionId : '';
    if (!/^repo-[A-Za-z0-9_-]{1,80}$/.test(sourceProjectId)
        || !/^[A-Za-z0-9_-]{1,80}$/.test(sourceCompositionId)) {
        throw httpError(400, 'A valid repository project and composition are required.');
    }
    await readStudioComposition(sourceProjectId, sourceCompositionId);

    const incoming = payload.composition;
    if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.layers)) {
        throw httpError(400, 'The request must include a composition with a layers array.');
    }
    if (incoming.layers.length > MAX_LAYERS) {
        throw httpError(400, `A composition cannot contain more than ${MAX_LAYERS} layers.`);
    }
    if (JSON.stringify(incoming).length > MAX_COMPOSITION_BYTES) {
        throw httpError(413, 'The composition is too large to save.');
    }

    const name = sanitizeLabel(incoming.name, 'Repository composition');
    const copyName = sanitizeLabel(`${name} copy`, 'Repository composition copy');
    const base = slugify(copyName) || 'repository-copy';
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const id = `${base.slice(0, 40)}-${stamp}-${crypto.randomBytes(2).toString('hex')}`;
    const projectDir = path.join(IMPORTS_DIR, id);
    const createdAt = new Date().toISOString();
    const reference = incoming.layers.find((layer) => layer?.id === incoming.referenceLayerId);
    const meta = {
        ...(incoming.meta && typeof incoming.meta === 'object' ? incoming.meta : {}),
        source: 'repository-copy',
        sourceProjectId,
        sourceCompositionId,
        referenceUrl: reference?.url || incoming.meta?.referenceUrl || null,
        createdAt,
        updatedAt: createdAt,
        storage: `data/imports/${id}`,
    };
    const composition = {
        ...incoming,
        id,
        name: copyName,
        meta,
    };

    await fsp.mkdir(projectDir);
    try {
        await writeFileAtomic(path.join(projectDir, 'composition.json'), JSON.stringify(composition, null, 2));
    } catch (error) {
        await fsp.rm(projectDir, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
    return {
        project: {
            id,
            name: copyName,
            createdAt,
            updatedAt: createdAt,
            width: composition.width || 0,
            height: composition.height || 0,
            layerCount: composition.layers.filter((layer) => layer?.rig !== true).length,
            referenceUrl: meta.referenceUrl,
        },
        composition,
    };
}

const ANIMATIONS_FILE = 'animations.json';

function normalizeAnimationEntry(entry, index) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const id = typeof source.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(source.id)
        ? source.id
        : `animation-${index + 1}`;
    return {
        id,
        name: sanitizeLabel(source.name, `Animation ${index + 1}`),
        description: typeof source.description === 'string' ? source.description.slice(0, 200) : '',
        duration: clamp(Number(source.duration) || DEFAULT_DURATION, 500, 30000),
        settings: defaultCharacterSettings(source.settings && typeof source.settings === 'object' ? source.settings : {}),
    };
}

async function readAnimations(id) {
    const file = path.join(IMPORTS_DIR, id, ANIMATIONS_FILE);
    try {
        const data = JSON.parse(await fsp.readFile(file, 'utf8'));
        const animations = Array.isArray(data.animations)
            ? data.animations.slice(0, 40).map(normalizeAnimationEntry)
            : [];
        return { schema: 'layer-studio/animations/v1', animations };
    } catch (error) {
        if (error.code === 'ENOENT') return { schema: 'layer-studio/animations/v1', animations: [] };
        throw httpError(500, `Could not read the animation library: ${error.message}`);
    }
}

async function saveAnimations(id, payload) {
    const incoming = Array.isArray(payload?.animations) ? payload.animations : [];
    const seen = new Set();
    const animations = incoming.slice(0, 40).map(normalizeAnimationEntry).map((animation) => {
        let nextId = animation.id;
        let suffix = 2;
        while (seen.has(nextId)) {
            nextId = `${animation.id}-${suffix}`;
            suffix += 1;
        }
        seen.add(nextId);
        return { ...animation, id: nextId };
    });
    const projectDir = path.join(IMPORTS_DIR, id);
    await fsp.mkdir(projectDir, { recursive: true });
    await writeFileAtomic(path.join(projectDir, ANIMATIONS_FILE), JSON.stringify({
        schema: 'layer-studio/animations/v1',
        updatedAt: new Date().toISOString(),
        animations,
    }, null, 2));
    return { ok: true, animations };
}

function normalizeStudioAnimation(entry, index) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const tracks = Array.isArray(source.tracks) ? source.tracks.slice(0, MAX_LAYERS) : [];
    if (!tracks.length) throw httpError(400, 'An animation must include at least one layer track.');
    return {
        id: typeof source.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(source.id)
            ? source.id
            : `studio-animation-${index + 1}`,
        name: sanitizeLabel(source.name, `Animation ${index + 1}`),
        createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString(),
        tracks: tracks.map((track) => {
            const event = track && track.event && typeof track.event === 'object' ? track.event : {};
            const preset = String(event.preset || '');
            if (!PRESET_NAMES.includes(preset) && !(preset === 'keyframes' && Array.isArray(event.keyframes) && event.keyframes.length > 0)) {
                throw httpError(400, `Unsupported animation preset: ${preset || '(empty)'}.`);
            }
            const start = Number(event.start);
            const duration = Number(event.duration);
            const numeric = (value, fallback, min, max) => {
                const parsed = Number(value);
                return clamp(Number.isFinite(parsed) ? parsed : fallback, min, max);
            };
            const keyframes = Array.isArray(event.keyframes) ? event.keyframes.slice(0, 400).map((frame) => ({
                time: numeric(frame.time, 0, 0, 60000),
                x: numeric(frame.x, 0, 0, 100),
                y: numeric(frame.y, 0, 0, 100),
                w: numeric(frame.w, 0, 0, 100),
                h: numeric(frame.h, 0, 0, 100),
                opacity: numeric(frame.opacity, 1, 0, 1),
            })) : undefined;
            return {
                layerId: String(track && track.layerId || '').slice(0, 120),
                layerName: sanitizeLabel(track && track.layerName, 'Layer'),
                event: {
                    id: typeof event.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(event.id)
                        ? event.id
                        : `event-${index + 1}`,
                    preset,
                    start: clamp(Number.isFinite(start) ? start : 0, 0, 60000),
                    duration: clamp(Number.isFinite(duration) ? duration : 900, 100, 60000),
                    ...(keyframes && keyframes.length ? { keyframes } : {}),
                },
            };
        }),
    };
}

async function readStudioAnimationLibrary() {
    try {
        const data = JSON.parse(await fsp.readFile(STUDIO_ANIMATION_LIBRARY_FILE, 'utf8'));
        const animations = Array.isArray(data.animations)
            ? data.animations.slice(0, 200).map(normalizeStudioAnimation)
            : [];
        return { schema: 'agent-studio/animation-library/1', animations };
    } catch (error) {
        if (error.code === 'ENOENT') return { schema: 'agent-studio/animation-library/1', animations: [] };
        throw httpError(500, `Could not read the Studio animation library: ${error.message}`);
    }
}

async function saveStudioAnimation(payload) {
    const library = await readStudioAnimationLibrary();
    const incoming = normalizeStudioAnimation({
        ...payload,
        id: payload && payload.id || crypto.randomUUID(),
        createdAt: payload && payload.createdAt || new Date().toISOString(),
    }, library.animations.length);
    const animations = [incoming, ...library.animations.filter((item) => item.id !== incoming.id)].slice(0, 200);
    await fsp.mkdir(SETTINGS_DIR, { recursive: true });
    await writeFileAtomic(STUDIO_ANIMATION_LIBRARY_FILE, JSON.stringify({
        schema: 'agent-studio/animation-library/1',
        updatedAt: new Date().toISOString(),
        animations,
    }, null, 2));
    return { ok: true, animation: incoming, animations };
}

async function deleteStudioAnimation(id) {
    const library = await readStudioAnimationLibrary();
    const animations = library.animations.filter((item) => item.id !== id);
    if (animations.length === library.animations.length) throw httpError(404, 'Animation not found.');
    await writeFileAtomic(STUDIO_ANIMATION_LIBRARY_FILE, JSON.stringify({
        schema: 'agent-studio/animation-library/1',
        updatedAt: new Date().toISOString(),
        animations,
    }, null, 2));
    return { ok: true, animations };
}

// ─── Local LLM animation director ─────────────────────────────────────

const PARAM_RULES = {
    amplitude: [0.1, 10],
    tilt: [0.05, 15],
    distance: [0.1, 30],
    scale: [1.01, 1.3],
    startX: [-100, 200],
    endX: [-100, 200],
    from: [0.1, 5],
    to: [0.1, 5],
    turns: [-20, 20],
    decay: [0.1, 0.99],
    height: [0.1, 50],
    count: [1, 20],
    radius: [0.1, 50],
    cycles: [1, 20],
};

function normalizeOllamaUrl(value) {
    if (!value) return null;
    let raw = String(value).trim();
    if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
    try {
        const url = new URL(raw);
        if (url.hostname === '0.0.0.0' || url.hostname === '::' || url.hostname === '[::]') {
            url.hostname = '127.0.0.1';
        }
        return `${url.protocol}//${url.host}`;
    } catch {
        return null;
    }
}

function isVisionModel(model) {
    const name = String(model?.name || '').toLowerCase();
    const capabilities = Array.isArray(model?.capabilities)
        ? model.capabilities.map((capability) => String(capability).toLowerCase())
        : [];
    if (capabilities.length) return capabilities.includes('vision');
    const families = Array.isArray(model?.details?.families)
        ? model.details.families.map((family) => String(family).toLowerCase())
        : [];
    return families.includes('clip')
        || /(vision|llava|moondream|minicpm-v|qwen[^ ]*vl|gemma3)/i.test(name);
}

function supportsThinking(model) {
    const name = String(model?.name || '').toLowerCase();
    const capabilities = Array.isArray(model?.capabilities)
        ? model.capabilities.map((capability) => String(capability).toLowerCase())
        : [];
    return capabilities.includes('thinking') || /qwen3|deepseek-r1|gpt-oss/i.test(name);
}

async function fetchJsonWithTimeout(url, options, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const text = await response.text();
        let data = null;
        try {
            data = JSON.parse(text);
        } catch {
            data = null;
        }
        if (!response.ok) {
            throw new Error(`LLM request failed (${response.status}): ${data?.error || text.slice(0, 400) || response.statusText}`);
        }
        return data;
    } catch (error) {
        if (error.name === 'AbortError') throw new Error('The AI provider took too long to respond.');
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function detectOllama() {
    if (ollamaCache.value && Date.now() - ollamaCache.at < 5000) return ollamaCache.value;
    const candidates = [...new Set([
        normalizeOllamaUrl(process.env.STUDIO_OLLAMA_URL),
        normalizeOllamaUrl(process.env.OLLAMA_HOST),
        'http://127.0.0.1:11434',
        'http://127.0.0.1:11436',
    ].filter(Boolean))];
    for (const url of candidates) {
        try {
            const data = await fetchJsonWithTimeout(`${url}/api/tags`, {}, LLM_DETECT_TIMEOUT);
            if (Array.isArray(data?.models)) {
                const value = { url, models: data.models, error: null };
                ollamaCache = { at: Date.now(), value };
                return value;
            }
        } catch {
            // Try the next candidate.
        }
    }
    const value = {
        url: null,
        models: [],
        error: 'Local LLM unavailable. Start Ollama with "ollama serve" and install a vision model such as granite3.2-vision:2b.',
    };
    ollamaCache = { at: Date.now(), value };
    return value;
}

async function getLlmCatalog() {
    const status = await detectOllama();
    const models = (status.models || []).map((model) => ({
        id: model.name,
        size: model.size || 0,
        parameterSize: model.details?.parameter_size || '',
        vision: isVisionModel(model),
    })).sort((a, b) => Number(b.vision) - Number(a.vision) || a.id.localeCompare(b.id));
    const pick = (preferred, filter) => {
        const exact = models.find((model) => model.id === preferred);
        if (exact) return exact.id;
        return models.find(filter)?.id || null;
    };
    return {
        available: Boolean(status.url),
        url: status.url || null,
        models,
        defaults: {
            vision: pick(DEFAULT_VISION_MODEL, (model) => model.vision),
            text: pick(DEFAULT_TEXT_MODEL, (model) => !model.vision)
                || pick('', (model) => model.vision)
                || models[0]?.id
                || null,
        },
        error: status.error || null,
    };
}

function getDeepSeekDirectorConfig() {
    const apiKey = process.env.STUDIO_DEEPSEEK_API_KEY?.trim() || '';
    const model = process.env.STUDIO_DEEPSEEK_MODEL?.trim() || '';
    const baseUrl = process.env.STUDIO_DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com/v1';
    return {
        apiKey,
        model,
        baseUrl,
        available: Boolean(apiKey && model),
        error: !apiKey
            ? 'Set STUDIO_DEEPSEEK_API_KEY to enable the DeepSeek API.'
            : (!model ? 'Set STUDIO_DEEPSEEK_MODEL to the DeepSeek model available to your API key.' : null),
    };
}

function getDeepSeekDirectorStatus() {
    const { available, model, error } = getDeepSeekDirectorConfig();
    return { available, model: model || null, error };
}

async function getAnimationDirectorCatalog() {
    const ollama = await getLlmCatalog();
    const deepseek = getDeepSeekDirectorStatus();
    const ollamaReady = ollama.available && ollama.models.some((model) => model.vision);
    const providers = [
        {
            id: 'ollama',
            label: 'Ollama · local',
            available: ollamaReady,
            models: ollama.models,
            defaults: ollama.defaults,
            error: ollamaReady
                ? null
                : (ollama.error || 'Install an Ollama vision model to use the local director.'),
        },
        {
            id: 'deepseek',
            label: 'DeepSeek Flash · API',
            available: deepseek.available,
            model: deepseek.model || null,
            error: deepseek.error,
        },
    ];
    const defaultProvider = providers.find((provider) => provider.id === 'ollama' && provider.available)
        ? 'ollama'
        : (deepseek.available ? 'deepseek' : 'ollama');
    return {
        ...ollama,
        providers,
        defaultProvider,
        available: providers.some((provider) => provider.available),
    };
}

async function getOrganizerModelCatalog() {
    const catalog = await getLlmCatalog();
    const models = catalog.models.map((model) => ({ ...model, provider: 'ollama' }));
    const remoteModel = process.env.STUDIO_OPENAI_MODEL?.trim();
    const remoteHasKey = Boolean(process.env.STUDIO_OPENAI_API_KEY?.trim());
    if (remoteModel && remoteHasKey && remoteModel.length <= 120) {
        models.push({
            id: remoteModel,
            provider: 'openai-compatible',
            size: 0,
            parameterSize: '',
            vision: true,
        });
    }
    let error = models.length ? null : catalog.error || 'No organizer model is configured.';
    if (!models.length && remoteModel && !remoteHasKey) {
        error = 'Set STUDIO_OPENAI_API_KEY to use the configured remote vision model.';
    } else if (!models.length && remoteModel?.length > 120) {
        error = 'STUDIO_OPENAI_MODEL must be no longer than 120 characters.';
    }
    return {
        available: models.some((model) => model.vision),
        models: models.filter((model) => model.vision),
        error,
    };
}

async function callOllama(model, messages, {
    temperature = 0.35,
    numPredict = 1400,
    numCtx = 16384,
    think = null,
} = {}) {
    const status = await detectOllama();
    if (!status.url) throw httpError(503, status.error);
    if (!status.models.some((entry) => entry.name === model)) {
        throw httpError(400, `Model "${model}" is not installed. Available models: ${status.models.map((entry) => entry.name).join(', ') || '(none)'}.`);
    }
    const body = {
        model,
        messages,
        stream: false,
        format: 'json',
        options: { temperature, num_predict: numPredict, num_ctx: numCtx },
    };
    const modelInfo = status.models.find((entry) => entry.name === model);
    if (think !== null && supportsThinking(modelInfo || { name: model })) body.think = think;
    try {
        return await fetchJsonWithTimeout(`${status.url}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }, PROPOSAL_TIMEOUT);
    } catch (error) {
        throw httpError(502, `The local LLM request failed: ${error.message}`);
    }
}

async function callOpenAICompatible(model, messages, config = {}) {
    const apiKey = config.apiKey ?? process.env.STUDIO_OPENAI_API_KEY?.trim();
    const configuredModel = config.model ?? process.env.STUDIO_OPENAI_MODEL?.trim();
    if (!apiKey || !configuredModel || configuredModel !== model) {
        throw httpError(400, 'The selected remote model is not configured on the studio server.');
    }
    const baseUrl = (config.baseUrl || process.env.STUDIO_OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const baseUrlSetting = config.baseUrl ? 'STUDIO_DEEPSEEK_BASE_URL' : 'STUDIO_OPENAI_BASE_URL';
    let endpoint;
    try {
        endpoint = new URL(`${baseUrl}/chat/completions`);
    } catch {
        throw httpError(500, `${baseUrlSetting} must be a valid URL.`);
    }
    if (!['http:', 'https:'].includes(endpoint.protocol)) {
        throw httpError(500, `${baseUrlSetting} must use HTTP or HTTPS.`);
    }
    const loopbackHttp = endpoint.protocol === 'http:'
        && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'https:' && !loopbackHttp) {
        throw httpError(500, 'Remote LLM endpoints must use HTTPS; HTTP is allowed only for localhost.');
    }
    try {
        const result = await fetchJsonWithTimeout(endpoint.href, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: 0.2,
                response_format: { type: 'json_object' },
            }),
        }, PROPOSAL_TIMEOUT);
        const content = result?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
            throw new Error('The remote model returned an empty response.');
        }
        return { message: { content } };
    } catch (error) {
        throw httpError(502, `The remote LLM request failed: ${error.message}`);
    }
}

async function callDeepSeek(model, messages) {
    const config = getDeepSeekDirectorConfig();
    if (!config.available) throw httpError(503, config.error);
    if (model !== config.model) {
        throw httpError(400, 'The selected DeepSeek model is not configured on the studio server.');
    }
    return callOpenAICompatible(model, messages, config);
}

function extractJsonObject(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const cleaned = text.trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```\s*$/i, '')
        .trim();
    try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) return { proposals: parsed };
        if (parsed && typeof parsed === 'object') return parsed;
    } catch {
        // Try extracting JSON from responses with surrounding prose.
    }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            return JSON.parse(cleaned.slice(start, end + 1));
        } catch {
            // Fall through to the array case.
        }
    }
    const arrayStart = cleaned.indexOf('[');
    const arrayEnd = cleaned.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
        try {
            const parsed = JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
            if (Array.isArray(parsed)) return { proposals: parsed };
        } catch {
            return null;
        }
    }
    return null;
}

function parseOrganizerImage(value, label) {
    if (typeof value !== 'string') throw httpError(400, `${label} image is missing.`);
    const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw httpError(400, `${label} must be a PNG, JPEG, or WebP thumbnail.`);
    const data = Buffer.from(match[2], 'base64');
    if (!data.length || data.length > MAX_ORGANIZER_IMAGE_BYTES) {
        throw httpError(413, `${label} thumbnail must be no larger than ${MAX_ORGANIZER_IMAGE_BYTES} bytes.`);
    }
    return { data, mime: `image/${match[1]}` };
}

async function organizeSegments(payload) {
    const provider = payload?.provider;
    const model = typeof payload?.model === 'string' ? payload.model.trim().slice(0, 120) : '';
    const catalog = await getOrganizerModelCatalog();
    if (!model || !catalog.models.some((entry) => entry.id === model && entry.provider === provider)) {
        throw httpError(400, 'Choose an available vision model for segment organization.');
    }
    if (!Array.isArray(payload.layers) || !payload.layers.length || payload.layers.length > MAX_PROMPT_LAYERS) {
        throw httpError(400, `Organize between 1 and ${MAX_PROMPT_LAYERS} segments at a time.`);
    }
    const seen = new Set();
    const layers = payload.layers.map((entry, index) => {
        const id = typeof entry?.id === 'string' ? entry.id.trim().slice(0, 100) : '';
        if (!id || seen.has(id)) throw httpError(400, `Segment ${index + 1} has a missing or duplicate id.`);
        seen.add(id);
        return {
            id,
            name: sanitizeLabel(entry.name, `Segment ${index + 1}`),
            image: parseOrganizerImage(entry.image, `Segment ${index + 1}`),
        };
    });
    const reference = payload.reference
        ? parseOrganizerImage(payload.reference, 'Reference')
        : null;
    const inventory = layers.map(({ name }, index) => `S${String(index + 1).padStart(2, '0')} | ${name}`).join('\n');
    const instructions = [
        'You organize cutout layers from a single illustrated scene.',
        'Use the supplied final/reference image and each transparent segment thumbnail to infer what each segment depicts.',
        'The first supplied image is the final/reference image when one is present; following images correspond to the segment inventory order.',
        'Return only JSON: an object with a "layers" array of objects, or a JSON array of those objects.',
        'Include every segment exactly once. Copy its short S-number alias exactly into "id"; do not use filenames or invent ids.',
        'Each item must contain: id, concise readable name, concise semantic group, and role.',
        'Use role only from: background, midground, ground, foreground, character, character-part, prop, effect.',
        'Group related cuts together by depicted subject or material. Examples: trees, tree-branches, foliage, ground, boy, boy\'s-clothes, candle, candle-light, sparkling-dots.',
        'Use the existing names as clues, not as truth.',
        `Segments and corresponding thumbnail order:\n${inventory}`,
    ].join('\n\n');
    let response;
    if (provider === 'ollama') {
        response = await callOllama(model, [{
            role: 'user',
            content: instructions,
            images: [...(reference ? [reference] : []), ...layers.map((entry) => entry.image)]
                .map((image) => image.data.toString('base64')),
        }], { temperature: 0.2, numPredict: 5000, numCtx: 16384 });
    } else {
        const content = [{ type: 'text', text: instructions }];
        if (reference) {
            content.push({ type: 'text', text: 'Final/reference image:' });
            content.push({ type: 'image_url', image_url: { url: `data:${reference.mime};base64,${reference.data.toString('base64')}` } });
        }
        layers.forEach((entry, index) => {
            content.push({ type: 'text', text: `Segment ${index + 1}: ${entry.id} — ${entry.name}` });
            content.push({
                type: 'image_url',
                image_url: { url: `data:${entry.image.mime};base64,${entry.image.data.toString('base64')}` },
            });
        });
        response = await callOpenAICompatible(model, [{ role: 'user', content }]);
    }

    const raw = response?.message?.content || '';
    const parsed = extractJsonObject(raw);
    const proposed = Array.isArray(parsed?.layers)
        ? parsed.layers
        : (Array.isArray(parsed?.segments) ? parsed.segments
            : (Array.isArray(parsed?.suggestions) ? parsed.suggestions
                : (Array.isArray(parsed?.proposals) ? parsed.proposals : [])));
    const byAlias = new Map(layers.map((entry, index) => [
        `S${String(index + 1).padStart(2, '0')}`,
        entry,
    ]));
    const byId = new Map(layers.map((entry) => [entry.id, entry]));
    const roleNames = new Set([
        'background', 'midground', 'ground', 'foreground', 'character', 'character-part', 'prop', 'effect',
    ]);
    const result = [];
    proposed.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const requestedId = String(entry.id ?? entry.alias ?? '').trim();
        const alias = requestedId.toUpperCase();
        const aliasIndex = alias.match(/^S?0*(\d+)$/);
        const original = byId.get(requestedId)
            || byAlias.get(alias)
            || (aliasIndex ? layers[Number(aliasIndex[1]) - 1] : null);
        if (!original || result.some((item) => item.id === original.id)) return;
        result.push({
            id: original.id,
            originalName: original.name,
            name: sanitizeLabel(entry.name ?? entry.label ?? entry.title, original.name).slice(0, 100),
            group: sanitizeLabel(entry.group ?? entry.category, original.name).slice(0, 80),
            role: roleNames.has(entry.role) ? entry.role : 'prop',
        });
    });
    if (!result.length) {
        const preview = String(raw).trim().replace(/\s+/g, ' ').slice(0, 320);
        throw httpError(502, `The model response did not contain usable segment suggestions.${preview ? ` Response began: ${preview}` : ' The model returned an empty response.'}`);
    }
    return { layers: result, model: { provider, id: model } };
}

function buildDirectorCatalog(composition) {
    const referenceId = composition.referenceLayerId;
    const characterLayerIds = new Set();
    (composition.characters || []).forEach((character) => {
        Object.values(character.parts || {}).forEach((ids) => {
            if (Array.isArray(ids)) ids.forEach((layerId) => characterLayerIds.add(layerId));
        });
        (character.hidden || []).forEach((layerId) => characterLayerIds.add(layerId));
    });
    const roleRank = {
        character: 0,
        'character-part': 1,
        effect: 2,
        foreground: 3,
        prop: 4,
        ground: 5,
        midground: 6,
        background: 7,
    };
    const layers = composition.layers
        .filter((layer) => (
            layer.id !== referenceId
            && !characterLayerIds.has(layer.id)
            && layer.rig !== true
        ))
        .sort((a, b) => {
            const rankA = roleRank[a.role] ?? 4;
            const rankB = roleRank[b.role] ?? 4;
            if (rankA !== rankB) return rankA - rankB;
            return (b.z ?? 0) - (a.z ?? 0);
        })
        .slice(0, MAX_PROMPT_LAYERS);
    return layers.map((layer, index) => {
        const entry = {
            alias: `L${String(index + 1).padStart(2, '0')}`,
            id: layer.id,
            name: layer.name,
            type: layer.type === 'text' ? 'text' : 'image',
            role: layer.role || 'prop',
            z: layer.z ?? index,
            x: Number(layer.x ?? 0),
            y: Number(layer.y ?? 0),
            w: Number(layer.w ?? 0),
            h: Number(layer.h ?? 0),
        };
        if (entry.type === 'text') {
            const copy = typeof layer.text === 'string'
                ? layer.text
                : (layer.text && typeof layer.text === 'object' ? Object.values(layer.text).find((v) => typeof v === 'string') : '') || '';
            entry.text = String(copy).slice(0, 120);
        }
        return entry;
    });
}

function buildVisionPrompt(composition, context, catalog) {
    const layerNames = catalog.slice(0, 30).map((layer) => layer.name).join(', ');
    return `You are a visual analyst for a layered 2D storybook scene. Analyze the final assembled image and return ONLY a JSON object with these keys:
{
  "subject": "main character or object",
  "setting": "location and time of day",
  "mood": "emotional tone",
  "palette": ["3-5 color names"],
  "keyElements": ["visible elements that correspond to separate layers"],
  "motionCues": ["natural movements implied by the image"],
  "depthNotes": "foreground, midground, and background notes"
}

Project: ${composition.name}
Story/context: ${context || '(not provided)'}
Layer names: ${layerNames || '(none)'}

Keep every value short. Do not invent elements that are not in the image.`;
}

function buildWriterPrompt({ composition, context, analysis, catalog, count, retry, concise = false }) {
    const compactInventory = catalog
        .map((layer) => `${layer.alias}|${layer.name}|${layer.role}${layer.type === 'text' ? '|text' : ''}`)
        .join('\n');
    const characters = Array.isArray(composition.characters) ? composition.characters : [];
    const compactCharacterInventory = characters.map((character) => {
        const parts = CHARACTER_PART_KEYS
            .filter((key) => Array.isArray(character.parts?.[key]) && character.parts[key].length)
            .join(',');
        return `${character.id}|${character.name}|${parts || 'none'}`;
    }).join('\n');
    if (concise) {
        return `You direct subtle motion for a layered 2D scene. Return strict JSON only:
{"proposals":[{"title":"up to 4 words","description":"up to 12 words","commands":[{"layerId":"L01","preset":"drift","params":{"distance":2}}]}]}
Create exactly ${count} distinct ideas. Each needs exactly 6 commands on different listed layer aliases. Never animate the reference image. Use only these presets: drift, parallax, float, sway, swing, pulse, flicker, breathe, idle, fadeIn, fadeOut, zoom. Params: drift/parallax/float distance 1-4; sway amplitude 0.5-3 and tilt 1-5; swing amplitude 4-15; pulse scale 1.02-1.08; other presets use {}. Keep params minimal; omit easing.
Choose motions that fit each layer role and scene. Do not animate readable text with sway, spin, shake, or hop. If using character settings, use only listed character ids and valid settings; do not also animate their rig layers.
${retry ? 'Previous output was invalid; follow the JSON shape exactly.' : ''}
PROJECT: ${composition.name} (${composition.width}x${composition.height}, ${composition.duration}ms)
STORY: ${context || '(none)'}
ANALYSIS: ${JSON.stringify(analysis)}
LAYERS (alias|name|role):
${compactInventory}
CHARACTERS (id|name|parts):
${compactCharacterInventory || '(none)'}`;
    }
    const inventory = catalog
        .map((layer) => `${layer.alias} | ${layer.name}${layer.type === 'text' ? ' (text)' : ''} | ${layer.role} | z=${layer.z} | box=${layer.x.toFixed(1)},${layer.y.toFixed(1)},${layer.w.toFixed(1)},${layer.h.toFixed(1)}`)
        .join('\n');
    const detailedCharacterInventory = characters.map((character) => {
        const available = CHARACTER_PART_KEYS
            .filter((key) => Array.isArray(character.parts?.[key]) && character.parts[key].length)
            .join(', ') || 'none';
        return `${character.id} | ${character.name} | available parts: ${available} | current expression: ${character.settings?.expression || 'neutral'}`;
    }).join('\n');
    const characterJsonHint = characters.length
        ? `,
      "characters": [
        {"characterId": "character-1", "settings": {"expression": "happy", "blink": true, "speechText": "Well met, traveler.", "gazeX": 0.2, "gazeY": 0}}
      ]`
        : '';
    const characterRules = characters.length
        ? `
- Character rules:
  - Use ONLY character ids from the character list.
  - Only set blink or gaze when the character has eyes/pupils; only set talk when it has a mouth/beard; only set breathe when it has a head/body.
  - Use pulseAmount (0-1) for a synchronized eye-and-beard pulse; keep it low for subtle motion.
  - At least two proposals should include character settings when a character is present.
  - Do NOT add layer commands for layers that belong to a character when you set that character's settings; those layers are driven by the character rig. If every layer belongs to the character, a proposal may contain only character settings (0 layer commands).
  - Allowed settings: expression (neutral, happy, sad, surprised, angry), blink (boolean), blinkRate (2-30), blinkAmount (0-1), talk (boolean), talkIntensity (0-1), talkSpeed (0.5-2), gazeX (-1..1), gazeY (-1..1), eyeWander (boolean), breathe (boolean), breatheAmount (0-1), headSway (0-1), pulseAmount (0-1), saccade (boolean), speechText (max 220 chars), speechRate (0.5-2), speechStart (ms).
  - For lip-sync, write a short line in speechText and set talk to false. The rig derives visemes from the text; never describe mouth shapes yourself.
  - Use speechText for at most one proposal unless the story clearly needs two speaking beats.
`
        : '';
    const characterSection = characters.length
        ? `\nCHARACTERS (id | name | available parts | current expression):\n${detailedCharacterInventory}\n`
        : '';
    return `You are a senior animation director for layered 2D storybook scenes.
Given the visual analysis, story context, and layer inventory, propose ${count} distinct animation schemes a user can apply with one click.

Return STRICT JSON only, with this exact shape:
{
  "proposals": [
    {
      "title": "short evocative title",
      "description": "1-2 sentences describing the motion and feeling",
      "commands": [
        {"layerId": "L01", "preset": "drift", "params": {"distance": 2}},
        {"layerId": "L14", "preset": "sway", "params": {"amplitude": 1.5, "tilt": 2}}
      ]${characterJsonHint}
    }
  ]
}

RULES:
- layerId MUST be an alias from the inventory (L01, L02, ...). Never use numeric-only ids and never invent an id.
- Allowed presets ONLY: ${PRESET_NAMES.join(', ')}.
- Every proposal MUST contain ${characters.length ? 'character settings and/or 6-10 layer commands' : '6-10 commands'} on DIFFERENT layers. Never animate the same layer twice in one proposal.
- Do not animate the final reference image; it is not in the inventory.
- Layers marked (text) are readable copy: animate them with fadeIn, fadeOut, zoom, or pulse only. Never sway, spin, shake, or hop a headline.
- The composition may have multiple formats; every proposal applies to all of them, so animate the base layer and do not assume one size.
- background/cloud layers -> drift, parallax, or fadeOut; water/waves -> float or sway; vegetation/reeds/cattails -> sway or swing; character/mermaid -> breathe, idle, hop, or float; sparkles/stars -> flicker, pulse, or blinkIn; sword/shield -> float, spin, or idle; lettering -> fadeIn, fadeOut, zoom, or pulse.
- Use params that belong to the preset:
  sway -> {amplitude: 0.5-3, tilt: 1-5}
  float, drift, parallax -> {distance: 1-4}
  pulse -> {scale: 1.02-1.08}
  walk -> {startX, endX}
  zoom -> {from: 0.5-1.5, to: 1.0-2.0}
  spin -> {turns: 1-3}
  shake -> {amplitude: 1-3, decay: 0.8-0.95}
  hop -> {height: 2-8, count: 1-3}
  swing -> {amplitude: 4-15}
  orbit -> {radius: 2-6}
  nod -> {amplitude: 2-6, cycles: 1-3}
  breathe, idle, flicker, fadeIn, fadeOut, blinkIn -> {}
  (Optional) easing parameter for any motion preset: 'easeInOutSine', 'easeOutQuad', 'easeInQuad', 'easeOutBack', 'linear', etc.
- ${characters.length ? 'Each proposal MUST have character settings, or at least 6 layer commands.' : 'Every proposal MUST have at least 6 commands.'} Count them before returning.
- Make the ${count} proposals genuinely different in mood (for example calm, heroic, magical, intimate).
- Tailor the choices to the story context and the visual analysis.
${characterRules}${retry ? '\n- IMPORTANT: the previous response was not valid JSON or used invalid layer ids. Follow the schema exactly this time.' : ''}

PROJECT: ${composition.name}
CANVAS: ${composition.width}x${composition.height}, DURATION: ${composition.duration} ms
STORY / CONTEXT:
${context || '(not provided)'}
${characterSection}
VISUAL ANALYSIS:
${JSON.stringify(analysis, null, 2)}

LAYER INVENTORY (alias | name | role | z | x,y,w,h) — layers marked (text) are readable copy:
${inventory}`;
}

const PRESET_PARAM_KEYS = {
    breathe: ['easing'],
    idle: ['easing'],
    sway: ['amplitude', 'tilt', 'easing'],
    walk: ['startX', 'endX', 'easing'],
    float: ['distance', 'easing'],
    flicker: [],
    drift: ['distance', 'easing'],
    pulse: ['scale', 'easing'],
    fadeIn: ['easing'],
    parallax: ['distance', 'easing'],
    fadeOut: ['easing'],
    zoom: ['from', 'to', 'easing'],
    spin: ['turns', 'easing'],
    shake: ['amplitude', 'decay'],
    hop: ['height', 'count'],
    swing: ['amplitude', 'easing'],
    orbit: ['radius', 'easing'],
    nod: ['amplitude', 'cycles', 'easing'],
    blinkIn: [],
};

function normalizePresetParams(preset, raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const params = {};
    (PRESET_PARAM_KEYS[preset] || []).forEach((key) => {
        if (key === 'easing') {
            if (typeof raw.easing === 'string' && EASING_NAMES.includes(raw.easing)) {
                params.easing = raw.easing;
            }
            return;
        }
        if (!PARAM_RULES[key]) return;
        const [min, max] = PARAM_RULES[key];
        const value = Number(raw[key]);
        if (!Number.isFinite(value)) return;
        params[key] = Math.round(Math.min(max, Math.max(min, value)) * 1000) / 1000;
    });
    return params;
}

function normalizeProposalCharacters(value, characters) {
    if (!Array.isArray(characters) || !characters.length) return [];
    const list = Array.isArray(value)
        ? value
        : (value && typeof value === 'object' ? [value] : []);
    const byId = new Map(characters.map((character) => [character.id, character]));
    const byName = new Map(characters.map((character) => [String(character.name || '').toLowerCase(), character]));
    const settingKeys = [
        'expression', 'blink', 'blinkRate', 'blinkAmount', 'talk', 'talkIntensity',
        'talkSpeed', 'gazeX', 'gazeY', 'eyeWander', 'breathe', 'breatheAmount',
        'headSway', 'pulseAmount', 'saccade', 'speechText', 'speechRate', 'speechStart', 'mouthPose',
    ];
    const result = [];
    for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        const character = byId.get(entry.characterId)
            || byId.get(entry.id)
            || byName.get(String(entry.characterName || entry.name || '').toLowerCase());
        if (!character || result.some((item) => item.characterId === character.id)) continue;
        const source = entry.settings && typeof entry.settings === 'object' ? entry.settings : entry;
        if (!settingKeys.some((key) => key in source)) continue;
        result.push({
            characterId: character.id,
            characterName: character.name,
            settings: defaultCharacterSettings({ ...character.settings, ...source }),
        });
        if (result.length >= 8) break;
    }
    return result;
}

function normalizeDirectorProposals(value, catalog, count, characters = []) {
    const list = Array.isArray(value?.proposals)
        ? value.proposals
        : (Array.isArray(value) ? value : []);
    const byAlias = new Map(catalog.map((layer) => [layer.alias.toUpperCase(), layer]));
    const byId = new Map(catalog.map((layer) => [layer.id, layer]));
    const byName = new Map();
    catalog.forEach((layer) => {
        const key = String(layer.name).toLowerCase();
        byName.set(key, byName.has(key) ? null : layer);
    });
    const resolveLayer = (raw) => {
        const requested = String(raw || '').trim();
        if (!requested) return null;
        const aliasMatch = requested.match(/^L0*(\d+)$/i);
        const alias = aliasMatch ? `L${String(Number(aliasMatch[1])).padStart(2, '0')}` : requested.toUpperCase();
        return byAlias.get(alias)
            || byId.get(requested)
            || byName.get(requested.toLowerCase())
            || null;
    };
    const proposals = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const seen = new Set();
        const commands = [];
        const rawCommands = Array.isArray(item.commands) ? item.commands : [];
        for (const command of rawCommands) {
            if (!command || typeof command !== 'object') continue;
            const layer = resolveLayer(command.layerId ?? command.layerName ?? command.name);
            if (!layer || seen.has(layer.id)) continue;
            const preset = String(command.preset || '').trim();
            if (!PRESET_NAMES.includes(preset)) continue;
            commands.push({
                layerId: layer.id,
                layerName: layer.name,
                preset,
                params: normalizePresetParams(preset, command.params),
            });
            seen.add(layer.id);
            if (commands.length >= 12) break;
        }
        const characterSettings = normalizeProposalCharacters(
            item.characters || item.characterSettings,
            characters,
        );
        const characterLayerIds = new Set();
        characterSettings.forEach((entry) => {
            const character = characters.find((itemCharacter) => itemCharacter.id === entry.characterId);
            if (!character) return;
            CHARACTER_PART_KEYS.forEach((part) => {
                (character.parts?.[part] || []).forEach((layerId) => characterLayerIds.add(layerId));
            });
            (character.hidden || []).forEach((layerId) => characterLayerIds.add(layerId));
        });
        const finalCommands = characterLayerIds.size
            ? commands.filter((command) => !characterLayerIds.has(command.layerId))
            : commands;
        if (finalCommands.length < 2 && !characterSettings.length) continue;
        proposals.push({
            id: `idea-${proposals.length + 1}`,
            title: (typeof item.title === 'string' ? item.title.trim().slice(0, 120) : '') || `Animation idea ${proposals.length + 1}`,
            description: (typeof item.description === 'string' ? item.description.trim().slice(0, 400) : '') || 'A layered motion study for this scene.',
            commands: finalCommands,
            characters: characterSettings,
        });
        if (proposals.length >= count) break;
    }
    return proposals;
}

function resolveModelId(requested, fallback, models, { vision = false } = {}) {
    const chosen = models.find((model) => model.id === requested)
        || models.find((model) => model.id === fallback);
    if (chosen) {
        if (vision && !chosen.vision) {
            throw httpError(400, `Model "${chosen.id}" cannot read images. Choose a vision model.`);
        }
        return chosen.id;
    }
    const candidate = vision
        ? models.find((model) => model.vision)
        : (models.find((model) => !model.vision) || models[0]);
    if (!candidate) {
        throw httpError(503, vision
            ? 'No vision model is installed. Install one with "ollama pull granite3.2-vision:2b".'
            : 'No local text model is installed. Install one with "ollama pull qwen3.5:9b".');
    }
    return candidate.id;
}

async function readReferenceBase64(composition) {
    const reference = composition.layers.find((layer) => layer.id === composition.referenceLayerId)
        || composition.layers[0];
    if (!reference?.url) throw httpError(400, 'This project has no reference image to analyze.');
    if (reference.url.startsWith('data:image/')) {
        const comma = reference.url.indexOf(',');
        if (comma < 0) throw httpError(400, 'The reference image data is invalid.');
        return reference.url.slice(comma + 1);
    }
    let relative = reference.url.replace(/^\/+/, '');
    try {
        relative = decodeURIComponent(relative);
    } catch {
        // Keep the raw path if it is not URI encoded.
    }
    const file = path.resolve(ROOT, relative);
    const importsRoot = path.resolve(IMPORTS_DIR) + path.sep;
    if (!file.startsWith(importsRoot)) {
        throw httpError(400, 'The reference image must live inside data/imports for analysis.');
    }
    try {
        const stat = await fsp.stat(file);
        if (stat.size > MAX_VISION_IMAGE_BYTES) throw httpError(413, 'The reference image is too large for the vision model.');
        return (await fsp.readFile(file)).toString('base64');
    } catch (error) {
        if (error.status) throw error;
        throw httpError(404, 'Could not read the reference image for analysis.');
    }
}

async function updateProjectContext(id, context, director = null) {
    const composition = await readSavedComposition(id);
    const meta = {
        ...(composition.meta || {}),
        context: String(context || '').slice(0, MAX_CONTEXT_CHARS),
        updatedAt: new Date().toISOString(),
    };
    if (director && typeof director === 'object') {
        meta.director = {
            vision: typeof director.vision === 'string' ? director.vision.slice(0, 120) : '',
            text: typeof director.text === 'string' ? director.text.slice(0, 120) : '',
            provider: ['ollama', 'deepseek'].includes(director.provider)
                ? director.provider
                : (composition.meta?.director?.provider || ''),
        };
    }
    composition.meta = meta;
    await writeFileAtomic(path.join(IMPORTS_DIR, id, 'composition.json'), JSON.stringify(composition, null, 2));
    return composition;
}

async function readProposalsFile(id) {
    try {
        return JSON.parse(await fsp.readFile(path.join(IMPORTS_DIR, id, 'proposals.json'), 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw httpError(500, `Could not read the saved animation ideas: ${error.message}`);
    }
}

async function generateDirectorIdeas(id, payload = {}) {
    const composition = await readSavedComposition(id);
    const catalog = buildDirectorCatalog(composition);
    if (!catalog.length) throw httpError(400, 'Add at least one layer before requesting animation ideas.');
    const context = String(payload.context ?? composition.meta?.context ?? '')
        .slice(0, MAX_CONTEXT_CHARS)
        .trim();
    if (payload.context !== undefined || !composition.meta?.context) {
        await updateProjectContext(id, context);
    }
    const count = Math.min(6, Math.max(1, Number(payload.count) || 4));
    const provider = payload.provider === undefined ? 'ollama' : payload.provider;
    if (!['ollama', 'deepseek'].includes(provider)) {
        throw httpError(400, 'Choose either the Ollama or DeepSeek animation-ideas provider.');
    }
    let visionModel = null;
    let textModel = null;
    let deepseekModel = null;
    if (provider === 'ollama') {
        const llm = await getLlmCatalog();
        if (!llm.available) throw httpError(503, llm.error || 'The local LLM is unavailable.');
        visionModel = resolveModelId(payload.visionModel, llm.defaults.vision, llm.models, { vision: true });
        textModel = resolveModelId(payload.textModel, llm.defaults.text, llm.models);
    } else {
        const config = getDeepSeekDirectorConfig();
        if (!config.available) throw httpError(503, config.error);
        deepseekModel = config.model;
    }
    const image = payload.image
        ? decodeBase64(payload.image, 'Reference image').toString('base64')
        : await readReferenceBase64(composition);

    const visionPrompt = buildVisionPrompt(composition, context, catalog);
    const reference = composition.layers.find((layer) => layer.id === composition.referenceLayerId)
        || composition.layers[0];
    const imageMime = payload.image
        ? 'image/jpeg'
        : (reference?.url?.match(/^data:(image\/[a-z0-9.+-]+);/i)?.[1]
            || ({ '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(reference?.url || '').toLowerCase()])
            || 'image/jpeg');
    const visionMessage = provider === 'deepseek'
        ? {
            role: 'user',
            content: [
                { type: 'text', text: visionPrompt },
                { type: 'image_url', image_url: { url: `data:${imageMime};base64,${image}` } },
            ],
        }
        : { role: 'user', content: visionPrompt, images: [image] };
    const visionResult = provider === 'deepseek'
        ? await callDeepSeek(deepseekModel, [visionMessage])
        : await callOllama(visionModel, [visionMessage], {
            temperature: 0.2,
            numPredict: 300,
            numCtx: 4096,
            think: false,
        });
    const analysis = extractJsonObject(visionResult?.message?.content);
    if (!analysis) throw httpError(502, 'The vision model did not return a readable scene analysis.');

    let proposals = [];
    let raw = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const writerPrompt = buildWriterPrompt({
            composition,
            context,
            analysis,
            catalog,
            count,
            retry: attempt > 0,
            concise: provider === 'ollama',
        });
        const writerMessage = [{ role: 'user', content: writerPrompt }];
        const writerResult = provider === 'deepseek'
            ? await callDeepSeek(deepseekModel, writerMessage)
            : await callOllama(textModel, writerMessage, {
                temperature: attempt ? 0.2 : 0.45,
                numPredict: 800,
                numCtx: 4096,
                think: false,
            });
        raw = writerResult?.message?.content || '';
        proposals = normalizeDirectorProposals(
            extractJsonObject(raw),
            catalog,
            count,
            composition.characters || [],
        );
        if (proposals.length) break;
    }
    if (!proposals.length) {
        throw httpError(502, `The writer model did not return usable proposals. Output began: ${raw.slice(0, 240) || '(empty)'}`);
    }

    const data = {
        projectId: id,
        context,
        generatedAt: new Date().toISOString(),
        models: provider === 'deepseek'
            ? { provider, vision: deepseekModel, text: deepseekModel }
            : { provider, vision: visionModel, text: textModel },
        analysis,
        proposals,
    };
    await updateProjectContext(id, context, data.models);
    await writeFileAtomic(path.join(IMPORTS_DIR, id, 'proposals.json'), JSON.stringify(data, null, 2));
    return data;
}

// ─── Routing ──────────────────────────────────────────────────────────

// ─── Fonts (Phase 1) ──────────────────────────────────────────────────
const FONT_FORMATS = [
    { ext: 'woff2', mime: 'font/woff2', magic: [0x77, 0x4F, 0x46, 0x32] },
    { ext: 'woff', mime: 'font/woff', magic: [0x77, 0x4F, 0x46, 0x46] },
    { ext: 'ttf', mime: 'font/ttf', magic: [0x00, 0x01, 0x00, 0x00] },
    { ext: 'otf', mime: 'font/otf', magic: [0x4F, 0x54, 0x54, 0x4F] },
];
const FONT_NAME = /^[A-Za-z0-9_-]{1,120}\.(?:woff2?|ttf|otf)$/i;

function detectFontFormat(buffer) {
    if (!buffer || buffer.length < 4) return null;
    return FONT_FORMATS.find((format) => format.magic.every((byte, index) => buffer[index] === byte)) || null;
}

function fontFamilyFromName(name) {
    const base = String(name || '')
        .replace(/\.[^.]+$/, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
    return base || 'Uploaded font';
}

async function saveFont(payload) {
    const name = typeof payload?.name === 'string' ? payload.name : '';
    const dataUrl = typeof payload?.dataUrl === 'string' ? payload.dataUrl : '';
    const match = dataUrl.match(/^data:[^;,]+;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw httpError(400, 'Send the font as a base64 data URL.');
    const buffer = Buffer.from(match[1], 'base64');
    if (!buffer.length) throw httpError(400, 'The font file is empty.');
    if (buffer.length > MAX_FONT_BYTES) throw httpError(413, 'Fonts are limited to 2 MB.');
    const format = detectFontFormat(buffer);
    if (!format) throw httpError(415, 'Unsupported font format. Use WOFF2, WOFF, TTF or OTF.');
    await fsp.mkdir(FONTS_DIR, { recursive: true });
    const family = fontFamilyFromName(name);
    const id = `${slugify(family) || 'font'}-${crypto.randomBytes(3).toString('hex')}`;
    await fsp.writeFile(path.join(FONTS_DIR, `${id}.${format.ext}`), buffer);
    return {
        id,
        family,
        // Data URLs keep the studio usable offline; the served URL is preferred.
        url: `/api/fonts/${id}.${format.ext}`,
        format: format.ext,
        bytes: buffer.length,
        weights: [400],
    };
}

async function listFonts() {
    try {
        const entries = await fsp.readdir(FONTS_DIR, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isFile() && FONT_NAME.test(entry.name))
            .map((entry) => {
                const id = entry.name.replace(/\.[^.]+$/, '');
                const family = id.replace(/-[0-9a-f]{6}$/i, '').replace(/-+/g, ' ').trim() || id;
                const format = FONT_FORMATS.find((item) => entry.name.toLowerCase().endsWith(`.${item.ext}`));
                return {
                    id,
                    family,
                    url: `/api/fonts/${encodeURIComponent(entry.name)}`,
                    format: format ? format.ext : 'bin',
                };
            })
            .sort((a, b) => a.family.localeCompare(b.family));
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

// ─── Shared brand kits (Phase 4) ─────────────────────────────────────
// One kit → many compositions. Each kit is a single JSON file; a composition
// references it by `brandKitId` and falls back to its embedded kit.

function brandKitFile(id) {
    if (!BRAND_KIT_ID.test(String(id || ''))) throw httpError(400, 'Invalid brand kit id.');
    return path.join(BRAND_KITS_DIR, `${id}.json`);
}

async function readBrandKit(id) {
    let raw;
    try {
        raw = await fsp.readFile(brandKitFile(id), 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') throw httpError(404, 'Brand kit not found.');
        throw error;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw httpError(500, `Brand kit ${id} is not valid JSON.`);
    }
    const kit = Core.normalizeBrandKit(parsed.kit || parsed);
    if (!kit) throw httpError(500, `Brand kit ${id} could not be read.`);
    return { kit, updatedAt: parsed.updatedAt || null };
}

async function listBrandKits() {
    let entries;
    try {
        entries = await fsp.readdir(BRAND_KITS_DIR, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    const ids = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name.replace(/\.json$/, ''))
        .filter((id) => BRAND_KIT_ID.test(id));
    const kits = [];
    for (const id of ids) {
        try {
            const { kit, updatedAt } = await readBrandKit(id);
            kits.push({ ...kit, updatedAt });
        } catch {
            // A corrupt kit must not hide the rest.
        }
    }
    return kits.sort((a, b) => a.name.localeCompare(b.name));
}

async function saveBrandKit(id, payload) {
    const kitId = String(id || '').trim();
    if (!BRAND_KIT_ID.test(kitId)) {
        throw httpError(400, 'A brand kit id must be 1-80 letters, digits, dashes or underscores.');
    }
    const incoming = payload && typeof payload === 'object' && payload.kit ? payload.kit : payload;
    const kit = Core.normalizeBrandKit({ ...incoming, id: kitId });
    if (!kit) throw httpError(400, 'The request must include a brand kit with a name, palette, fonts or logos.');
    const encoded = JSON.stringify({ kit, updatedAt: new Date().toISOString() }, null, 2);
    if (encoded.length > MAX_BRAND_KIT_BYTES) throw httpError(413, 'The brand kit is too large to save.');

    const existing = await listBrandKits();
    if (existing.length >= MAX_BRAND_KITS && !existing.some((entry) => entry.id === kitId)) {
        throw httpError(409, `There are already ${MAX_BRAND_KITS} brand kits. Delete one first.`);
    }
    await fsp.mkdir(BRAND_KITS_DIR, { recursive: true });
    await fsp.mkdir(SETTINGS_DIR, { recursive: true });
    await writeFileAtomic(brandKitFile(kitId), encoded);
    const saved = await readBrandKit(kitId);
    return { kit: saved.kit, updatedAt: saved.updatedAt };
}

async function deleteBrandKit(id) {
    try {
        await fsp.unlink(brandKitFile(id));
    } catch (error) {
        if (error.code === 'ENOENT') throw httpError(404, 'Brand kit not found.');
        throw error;
    }
    return { deleted: true };
}

// ─── Brand packs (Phase 6) ───────────────────────────────────────────
// A brand pack is the structured import of a scraped brand-kit folder: one
// group (portfolio) plus N brands, each with tokens, a Word guide, logos,
// photography and a generated studio brand kit. Template projects are built
// from the shared brand-pack module, so the browser and the CLI agree.
const BRAND_PACK_ID = /^[A-Za-z0-9_-]{1,80}$/;
const BRAND_ASSET_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

function brandPackDir(id) {
    if (!BRAND_PACK_ID.test(String(id || ''))) throw httpError(400, 'Invalid brand pack id.');
    return path.join(BRAND_PACKS_DIR, id);
}

function brandPackFile(id) {
    return path.join(brandPackDir(id), 'pack.json');
}

function brandPackSummary(pack) {
    return {
        id: pack.id,
        name: pack.name,
        description: pack.description,
        brandCount: pack.brands.length,
        brands: pack.brands.map((brand) => ({
            id: brand.id,
            name: brand.name,
            tagline: brand.tagline,
            cover: brand.cover,
            swatches: brand.palette.slice(0, 5).map((entry) => entry.hex),
        })),
        createdAt: pack.createdAt,
        updatedAt: pack.updatedAt,
        storage: pack.storage,
    };
}

async function readBrandPack(id) {
    let raw;
    try {
        raw = await fsp.readFile(brandPackFile(id), 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') throw httpError(404, 'Brand pack not found.');
        throw error;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw httpError(500, `Brand pack ${id} is not valid JSON.`);
    }
    const pack = StudioBrand.normalizeBrandPack(parsed.pack || parsed);
    if (!pack) throw httpError(500, `Brand pack ${id} could not be read.`);
    pack.id = id;
    return { pack, updatedAt: parsed.updatedAt || pack.updatedAt || null };
}

async function listBrandPacks() {
    let entries;
    try {
        entries = await fsp.readdir(BRAND_PACKS_DIR, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    const summaries = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !BRAND_PACK_ID.test(entry.name)) continue;
        try {
            const { pack } = await readBrandPack(entry.name);
            summaries.push(brandPackSummary(pack));
        } catch {
            // A corrupt pack must not hide the rest.
        }
    }
    return summaries.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function isLoopbackRequest(req) {
    const address = String(req.socket?.remoteAddress || '');
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function isAdminRequest(req) {
    if (ADMIN_KEY) return String(req.headers['x-admin-key'] || '') === ADMIN_KEY;
    return isLoopbackRequest(req);
}

function requireAdmin(req) {
    if (!isAdminRequest(req)) {
        throw httpError(401, ADMIN_KEY
            ? 'Admin access required. Send the x-admin-key header.'
            : 'Admin access is limited to localhost. Set STUDIO_ADMIN_KEY to allow remote access.');
    }
}

const GROUP_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

function normalizeGroupSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    const list = (entries) => [...new Set((Array.isArray(entries) ? entries : [])
        .map((entry) => String(entry || ''))
        .filter((entry) => GROUP_ID_PATTERN.test(entry)))].slice(0, MAX_BRAND_PACKS);
    const refs = (entries) => [...new Set((Array.isArray(entries) ? entries : [])
        .map((entry) => String(entry || ''))
        .filter((entry) => /^[A-Za-z0-9_-]{1,80}::[A-Za-z0-9_-]{1,80}$/.test(entry)))].slice(0, 2000);
    return {
        version: 3,
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
        order: list(source.order),
        hidden: list(source.hidden),
        hiddenBrands: refs(source.hiddenBrands),
        // Businesses whose client-facing social crawler is enabled.
        socialCrawler: refs(source.socialCrawler),
    };
}

async function readGroupSettings() {
    try {
        const raw = await fsp.readFile(GROUP_SETTINGS_FILE, 'utf8');
        return normalizeGroupSettings(JSON.parse(raw));
    } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
            console.error('[studio] could not read group settings:', error.message);
        }
        return normalizeGroupSettings(null);
    }
}

async function writeGroupSettings(value) {
    const settings = normalizeGroupSettings(value);
    settings.updatedAt = new Date().toISOString();
    await fsp.mkdir(SETTINGS_DIR, { recursive: true });
    const temporary = `${GROUP_SETTINGS_FILE}.${process.pid}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(settings, null, 2));
    await fsp.rename(temporary, GROUP_SETTINGS_FILE);
    return settings;
}

/** Filters hidden groups and businesses, and applies the dev-defined order. */
function overrideVisibleSocialCrawlerRefs(packs, settings) {
    const hidden = new Set(settings.hidden || []);
    const hiddenBrands = new Set(settings.hiddenBrands || []);
    const socialCrawler = new Set(settings.socialCrawler || []);
    for (const pack of packs || []) {
        if (hidden.has(pack.id)) continue;
        for (const brand of pack.brands || []) {
            const ref = `${pack.id}::${brand.id}`;
            if (!hiddenBrands.has(ref)) socialCrawler.add(ref);
        }
    }
    return socialCrawler;
}

function applyPackSettings(pack, settings, includeHidden = false) {
    const hidden = new Set(settings.hidden);
    const hiddenBrands = new Set(settings.hiddenBrands || []);
    const socialCrawler = overrideVisibleSocialCrawlerRefs([pack], settings);
    const brands = (pack.brands || [])
        .map((brand) => {
            const ref = `${pack.id}::${brand.id}`;
            return {
                ...brand,
                visible: !hiddenBrands.has(ref),
                socialCrawler: socialCrawler.has(ref),
            };
        })
        .filter((brand) => includeHidden || brand.visible);
    return {
        ...pack,
        brands,
        brandCount: brands.length,
        visible: !hidden.has(pack.id),
    };
}

function applyGroupSettings(packs, settings, includeHidden = false) {
    const order = new Map(settings.order.map((id, index) => [id, index]));
    return packs
        .filter((pack) => includeHidden || !settings.hidden.includes(pack.id))
        .map((pack) => applyPackSettings(pack, settings, includeHidden))
        // A visible group with every business hidden has nothing to show.
        .filter((pack) => includeHidden || pack.brands.length)
        .sort((a, b) => {
            const oa = order.has(a.id) ? order.get(a.id) : Number.POSITIVE_INFINITY;
            const ob = order.has(b.id) ? order.get(b.id) : Number.POSITIVE_INFINITY;
            if (oa !== ob) return oa - ob;
            return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        });
}

const SOCIAL_CRAWL_COOLDOWN_MS = 30000;
const socialCrawlStarts = new Map();

const SOCIAL_PROFILE_SOURCES = new Set([
    'instagram', 'facebook', 'tiktok', 'youtube', 'x', 'threads', 'pinterest', 'linkedin', 'snapchat',
    'google', 'tripadvisor', 'restaurantguru', 'yelp', 'trustpilot', 'opentable', 'thefork',
    'quandoo', 'booking', 'expedia', 'michelin', 'foursquare', 'zomato',
]);

function siteHostKey(value) {
    try {
        return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return '';
    }
}

function siteNameKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Resolve a scraped social dataset to a brand the admin can enable.
 * Website host wins; the social folder path is authoritative; name is a
 * fallback. Returns every match so duplicate brands across packs still work.
 */
async function socialCrawlAccess(dataset) {
    const [packs, settings] = await Promise.all([listBrandPacks(), readGroupSettings()]);
    const allowed = overrideVisibleSocialCrawlerRefs(packs, settings);
    const business = dataset?.business || {};
    const host = siteHostKey(business.website);
    const name = siteNameKey(business.name);
    const file = String(dataset?.source?.file || '').replaceAll('\\', '/');
    const matches = [];
    for (const pack of packs) {
        for (const brand of pack.brands || []) {
            let score = 0;
            if (file.includes(`brand-packs/${pack.id}/files/${brand.id}/social/`)) score = 3;
            else if (host && siteHostKey(brand.url) === host) score = 2;
            else if (name && siteNameKey(brand.name) === name) score = 1;
            if (!score) continue;
            matches.push({
                score,
                ref: `${pack.id}::${brand.id}`,
                packId: pack.id,
                packName: pack.name,
                brandId: brand.id,
                brandName: brand.name,
            });
        }
    }
    matches.sort((a, b) => b.score - a.score);
    const allowedMatch = matches.find((match) => allowed.has(match.ref));
    const best = allowedMatch || matches[0] || null;
    return {
        enabled: Boolean(allowedMatch),
        ref: best?.ref || '',
        hasWebsite: Boolean(business.website),
        packId: best?.packId || '',
        packName: best?.packName || '',
        brandId: best?.brandId || '',
        brandName: best?.brandName || '',
    };
}

async function groupSettingsPayload() {
    const [packs, settings] = await Promise.all([listBrandPacks(), readGroupSettings()]);
    const socialCrawler = [...overrideVisibleSocialCrawlerRefs(packs, settings)];
    return {
        packs: applyGroupSettings(packs, settings, true),
        settings: { ...settings, socialCrawler },
        adminKeyConfigured: Boolean(ADMIN_KEY),
    };
}

async function deleteBrandPack(id) {
    const dir = brandPackDir(id);
    try {
        await fsp.stat(dir);
    } catch (error) {
        if (error.code === 'ENOENT') throw httpError(404, 'Brand pack not found.');
        throw error;
    }
    // Remove the shared kits this pack created; any composition that attached
    // one keeps its embedded snapshot and falls back to it.
    const { pack } = await readBrandPack(id).catch(() => ({ pack: null }));
    await fsp.rm(dir, { recursive: true, force: true });
    await AssetStore.markPackOrphaned(id).catch(() => {});
    for (const brand of pack?.brands || []) {
        if (brand.brandKitId) await deleteBrandKit(brand.brandKitId).catch(() => {});
    }
    return { deleted: true };
}

// --- Import helpers -------------------------------------------------

function stripCommonRoot(files) {
    if (!files.length) return files;
    const parts = files.map((file) => String(file.raw || '').split('/').filter(Boolean));
    const root = parts[0][0];
    if (!root) return files;
    // Only strip a wrapper when every file sits inside it. A folder that is
    // itself a brand keeps its files one level down, so this is safe.
    if (!parts.every((segments) => segments.length > 1 && segments[0] === root)) return files;
    return files.map((file) => ({
        ...file,
        raw: String(file.raw || '').split('/').filter(Boolean).slice(1).join('/'),
    }));
}

function baseNameOf(relative) {
    const value = String(relative || '');
    return value.slice(value.lastIndexOf('/') + 1);
}

function dirOf(relative) {
    const value = String(relative || '');
    const at = value.lastIndexOf('/');
    return at < 0 ? '' : value.slice(0, at);
}

function topLevelOf(relative) {
    return String(relative || '').split('/')[0] || '';
}

function dirBeforeTokens(relative) {
    const value = String(relative || '');
    if (!/\.tokens\.json$/i.test(baseNameOf(value))) return null;
    // `social/social.tokens.json` is a reputation snapshot, not a brand folder.
    // Treating it as one used to add a phantom "<brand>-social" brand to every
    // imported crawler pack.
    if (/(^|\/)(social|00-portfolio)\//i.test(value)) return null;
    let dir = dirOf(value);
    if (/(^|\/)tokens$/i.test(dir)) dir = dir.replace(/(^|\/)tokens$/i, '');
    return dir.replace(/\/$/, '');
}

function parseTokensJson(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.brand || parsed.color || parsed.typography) return parsed;
    const keys = Object.keys(parsed).filter((key) => parsed[key] && typeof parsed[key] === 'object');
    if (!keys.length) return null;
    const single = keys.find((key) => parsed[key].brand);
    return single ? parsed[single] : parsed;
}

function combinedTokensFor(json, dir, fallbackName) {
    if (!json || typeof json !== 'object') return null;
    if (json.brand || json.color) return json;
    const slug = String(dir || '')
        .replace(/^\d+[-_]?/, '')
        .toLowerCase();
    const wanted = new Set([slug, slug.replace(/^the-/, ''), String(fallbackName || '').toLowerCase()]);
    const candidates = Object.entries(json).filter(([, value]) => value && typeof value === 'object' && (value.brand || value.color));
    if (!candidates.length) return null;
    const match = candidates.find(([key, value]) => {
        const names = [key, value.brand?.name, value.brand?.wordmark]
            .filter(Boolean)
            .map((name) => String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
        return names.some((name) => wanted.has(name) || slug.includes(name) || name.includes(slug.replace(/^the-/, '')));
    });
    if (match) return match[1];
    return candidates.length === 1 ? candidates[0][1] : null;
}

function readReadme(files, zipBuffer) {
    const entry = files.find((file) => /^readme\.md$/i.test(baseNameOf(file.relative)) && !dirOf(file.relative))
        || files.find((file) => /^readme\.md$/i.test(baseNameOf(file.relative)));
    if (!entry) return { name: '', description: '' };
    let raw = '';
    try {
        raw = extractZipEntry(zipBuffer, entry.entry).toString('utf8');
    } catch {
        return { name: '', description: '' };
    }
    const h1 = raw.match(/^#\s+(.+)$/m);
    const name = h1
        ? String(h1[1]).split(/\s+[—–]\s+/)[0].trim()
        : '';
    const paragraphs = raw
        .split(/\n{2,}/)
        .map((line) => {
            const trimmed = line.trim();
            return {
                heading: /^#+\s/.test(trimmed),
                text: trimmed.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim(),
            };
        })
        .filter((paragraph) => paragraph.text && paragraph.text.length > 40 && !paragraph.heading && !/^[-|`]/.test(paragraph.text))
        .map((paragraph) => paragraph.text);
    return { name, description: paragraphs[0] || '' };
}

function safeBrandAssetName(relative) {
    const value = String(relative || '').replace(/\\/g, '/');
    if (!value || value.length > 300) return null;
    const parts = value.split('/').filter(Boolean);
    if (!parts.length) return null;
    for (const part of parts) {
        if (part === '.' || part === '..' || part.startsWith('.')) return null;
        if (!/^[A-Za-z0-9][A-Za-z0-9._~ ()\-]{0,180}$/.test(part)) return null;
    }
    return parts.join('/');
}

function svgAsset(buffer) {
    const head = buffer.subarray(0, 1200).toString('utf8').toLowerCase();
    return head.includes('<svg');
}

/**
 * Brand-kit SVGs are generated artwork and occasionally carry duplicate
 * attributes (a recoloured path keeps the original `fill`). Browsers refuse to
 * decode such a file, so repair the start tags before storing it: keep the
 * first value of each attribute, drop event handlers and scripts, and make sure
 * the root carries the SVG namespace.
 */
function sanitizeSvgBuffer(buffer) {
    let source = buffer.toString('utf8');
    if (source.charCodeAt(0) === 0xFEFF) source = source.slice(1);
    source = source.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    source = source.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
    let repaired = 0;
    source = source.replace(/<([A-Za-z][\w:.-]*)((?:\s+[^<>]*?)?)(\/?)>/g, (match, tag, attrText, slash) => {
        const attrs = [];
        const seen = new Set();
        const attrPattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
        let attribute;
        while ((attribute = attrPattern.exec(attrText))) {
            const name = attribute[1];
            const lower = name.toLowerCase();
            if (seen.has(lower) || /^on/.test(lower)) {
                repaired += 1;
                continue;
            }
            seen.add(lower);
            const value = attribute[3] !== undefined ? attribute[3] : attribute[4];
            const canonical = tag.toLowerCase() === 'svg' && lower === 'viewbox'
                ? 'viewBox'
                : (tag.toLowerCase() === 'svg' && lower === 'preserveaspectratio' ? 'preserveAspectRatio' : name);
            attrs.push(`${canonical}="${String(value).replace(/"/g, '&quot;')}"`);
        }
        if (tag.toLowerCase() === 'svg') {
            if (!seen.has('xmlns')) {
                attrs.unshift('xmlns="http://www.w3.org/2000/svg"');
                repaired += 1;
            }
            const box = attrs.find((entry) => /^viewBox="/.test(entry));
            if (box) {
                const numbers = box.slice(9, -1).trim().split(/[\s,]+/);
                if (numbers.length === 4) {
                    if (!seen.has('width')) {
                        attrs.push(`width="${numbers[2]}"`);
                        repaired += 1;
                    }
                    if (!seen.has('height')) {
                        attrs.push(`height="${numbers[3]}"`);
                        repaired += 1;
                    }
                }
            }
        }
        return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}${slash}>`;
    });
    return { data: Buffer.from(source, 'utf8'), repaired };
}

function assetKind(relative) {
    const value = String(relative || '').toLowerCase();
    if (/(^|\/)logos?\//.test(value) || /(?:^|\/)(logo|wordmark|monogram|icon|symbol|lockup|mark)[^/]*\.(png|jpe?g|webp|svg)$/.test(value)) return 'logo';
    if (/(^|\/)colou?rs?\//.test(value) || /palette/.test(value)) return 'palette';
    if (/(^|\/)type\//.test(value) || /specimen/.test(value)) return 'type';
    if (/(^|\/)photography\//.test(value)) return 'photo';
    if (/(^|\/)cover\.(png|jpe?g|webp)$/.test(value)) return 'cover';
    return 'photo';
}

function assetLabel(relative) {
    return baseNameOf(relative).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
}

async function writeBrandAsset(filesDir, brandKey, relative, buffer) {
    const safe = safeBrandAssetName(relative);
    if (!safe) return null;
    const target = path.join(filesDir, brandKey, ...safe.split('/'));
    const root = path.join(filesDir, brandKey) + path.sep;
    if (!path.resolve(target).startsWith(root)) return null;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, buffer);
    return safe;
}

function chargeBrandBudget(budget, bytes) {
    if (!budget) return;
    budget.bytes += Number(bytes) || 0;
    if (budget.bytes > MAX_BRAND_EXTRACTED_BYTES) {
        throw httpError(413, 'The extracted brand kit is too large (480 MB maximum).');
    }
}

async function brandFromDirectory(options) {
    const {
        files, zipBuffer, brandDir, fallbackName, packId, packSlug, filesDir, warnings, budget,
    } = options;
    const dirPrefix = brandDir ? `${brandDir}/` : '';
    // A root-level brand (tokens at the ZIP root) owns every file, including
    // assets/; a folder brand owns only its own subtree.
    const inDir = files.filter((file) => (brandDir ? file.relative.startsWith(dirPrefix) : true));
    const relativeToBrand = (file) => (brandDir ? file.relative.slice(dirPrefix.length) : file.relative);

    // Tokens: the brand's own file wins over the group file.
    let tokens = null;
    let tokensPath = '';
    for (const file of inDir) {
        const tokenRelative = relativeToBrand(file);
        if (!/(^|\/)tokens\/[^/]+\.tokens\.json$/i.test(tokenRelative) && !/^[^/]+\.tokens\.json$/i.test(tokenRelative)) continue;
        try {
            tokens = parseTokensJson(extractZipEntry(zipBuffer, file.entry).toString('utf8'));
            tokensPath = relativeToBrand(file);
        } catch {
            warnings.push(`Could not read ${file.relative}.`);
        }
        break;
    }
    if (!tokens && options.rootTokens) {
        tokens = combinedTokensFor(options.rootTokens, brandDir, fallbackName);
        if (tokens) tokensPath = 'tokens (combined file)';
    }
    if (!tokens) {
        warnings.push(`${brandDir || 'The root folder'} has no readable tokens file.`);
        tokens = {};
    }

    const brandMeta = tokens.brand && typeof tokens.brand === 'object' ? tokens.brand : {};
    const name = (typeof brandMeta.name === 'string' && brandMeta.name.trim())
        || titleCaseBrand(brandDir || fallbackName)
        || 'Brand';
    const id = slugify((brandDir || name || fallbackName).replace(/^\d+[-_]?/, '')) || slugify(name) || 'brand';

    // The token file is the brand's canonical record (palette, type, voice).
    // It is parsed above; keep the JSON on disk as well, otherwise tokensPath
    // points at a file that was never extracted and every consumer of it has
    // to guess.
    if (tokensPath && !/combined file/i.test(tokensPath)) {
        const tokenFile = inDir.find((file) => relativeToBrand(file) === tokensPath);
        if (tokenFile) {
            try {
                const tokenBuffer = extractZipEntry(zipBuffer, tokenFile.entry);
                chargeBrandBudget(budget, tokenBuffer.length);
                const storedTokens = await writeBrandAsset(filesDir, id, tokensPath, tokenBuffer);
                if (storedTokens) tokensPath = storedTokens;
                else warnings.push(`Skipped ${tokensPath}: unsafe file name.`);
            } catch (error) {
                warnings.push(`Could not store ${tokensPath}: ${error.message}`);
            }
        }
    }

    // Guide: prefer a file whose name says brand guide.
    const docxFiles = inDir.filter((file) => /\.docx$/i.test(relativeToBrand(file)) && !/^assets\//i.test(relativeToBrand(file)));
    const docx = docxFiles.find((file) => /brand[-_ ]?guide/i.test(baseNameOf(file.relative))) || docxFiles[0] || null;
    let doc = null;
    let docPath = '';
    let docUrl = '';
    if (docx) {
        try {
            const docBuffer = extractZipEntry(zipBuffer, docx.entry);
            chargeBrandBudget(budget, docBuffer.length);
            doc = parseBrandDocx(docBuffer, {
                readZipEntries,
                extractZipEntry,
            }, { name: `${name} brand guide` });
            docPath = relativeToBrand(docx);
            const storedDoc = await writeBrandAsset(filesDir, id, docPath, docBuffer);
            if (storedDoc) {
                docUrl = urlPath('api', 'brand-packs', packId, 'files', id, storedDoc);
            }
        } catch (error) {
            warnings.push(`Could not read ${docx.relative}: ${error.message}`);
        }
    }

    // Content pack (menus / drinks / hours) is written by the crawler; keep it
    // on the brand so Asset Studio can prefill menu designs.
    let content = null;
    const contentFile = inDir.find((file) => /(^|\/)content\/[^/]+\.json$/i.test(relativeToBrand(file)));
    if (contentFile) {
        try {
            const raw = extractZipEntry(zipBuffer, contentFile.entry);
            if (raw.length <= 2 * 1024 * 1024) content = JSON.parse(raw.toString('utf8'));
        } catch (error) {
            warnings.push(`Could not read ${contentFile.relative}: ${error.message}`);
        }
    }

    // Assets.
    const logos = [];
    const photography = [];
    const paletteImages = [];
    const typeSpecimens = [];
    let cover = null;
    let coverRank = 99;
    let assetCount = 0;
    for (const file of inDir) {
        const relative = relativeToBrand(file);
        if (!BRAND_ASSET_EXT.test(relative)) continue;
        // Reputation avatars/covers are research, not brand photography.
        if (/(^|\/)social\//i.test(relative)) continue;
        if (assetCount >= MAX_BRAND_ASSETS) {
            warnings.push(`Skipped the remaining assets in ${brandDir || 'the root'}: the ${MAX_BRAND_ASSETS}-asset limit was reached.`);
            break;
        }
        assetCount += 1;
        let buffer;
        try {
            buffer = extractZipEntry(zipBuffer, file.entry);
        } catch (error) {
            warnings.push(`Could not extract ${file.relative}: ${error.message}`);
            continue;
        }
        if (buffer.length > MAX_BRAND_ASSET_BYTES) {
            warnings.push(`Skipped ${fileNameForWarning(file.relative)}: the asset exceeds 40 MB.`);
            continue;
        }
        chargeBrandBudget(budget, buffer.length);
        const isSvg = /\.svg$/i.test(relative) && svgAsset(buffer);
        const format = isSvg ? { format: 'svg', extension: 'svg', mime: 'image/svg+xml' } : detectImageFormat(buffer);
        if (!format) continue;
        let size = null;
        if (!isSvg) {
            try {
                size = readImageSize(buffer, format.format);
            } catch {
                size = null;
            }
        } else {
            const sanitized = sanitizeSvgBuffer(buffer);
            if (sanitized.repaired) warnings.push(`Repaired ${fileNameForWarning(relative)} (invalid SVG attributes).`);
            buffer = sanitized.data;
            try {
                size = readImageSize(buffer, 'svg');
            } catch {
                size = null;
            }
        }
        const stored = await writeBrandAsset(filesDir, id, relative, buffer);
        if (!stored) {
            warnings.push(`Skipped ${file.relative}: unsafe file name.`);
            continue;
        }
        const url = urlPath('api', 'brand-packs', packId, 'files', id, stored);
        const kind = assetKind(relative);
        const asset = {
            name: assetLabel(relative),
            url,
            path: stored,
            width: size ? size.width : null,
            height: size ? size.height : null,
            format: format.extension,
        };
        if (kind === 'logo') {
            logos.push({ ...asset, variant: undefined, kind: undefined, presentation: undefined });
        } else if (kind === 'palette') {
            paletteImages.push(asset);
            if (coverRank > 1) {
                cover = url;
                coverRank = 1;
            }
        } else if (kind === 'type') {
            typeSpecimens.push(asset);
        } else if (kind === 'cover') {
            // A brand cover is artwork, not reportage; it never enters the
            // photography pool used by the flyer template.
            cover = url;
            coverRank = 0;
        } else {
            photography.push(asset);
            if (coverRank > 2) {
                cover = url;
                coverRank = 2;
            }
        }
    }

    const brand = {
        id,
        name,
        wordmark: brandMeta.wordmark || '',
        tagline: brandMeta.tagline || '',
        url: brandMeta.url || '',
        version: brandMeta.version || '',
        captured: brandMeta.captured || '',
        dir: brandDir,
        tokensPath,
        docPath,
        palette: tokens.color || {},
        typography: tokens.typography || {},
        voice: tokens.voice || {},
        content,
        logos,
        photography,
        paletteImages,
        typeSpecimens,
        cover,
        brandKitId: null,
        guidelines: doc ? {
            positioning: doc.positioning,
            applications: doc.applications,
            printSpec: doc.printSpec,
            contact: doc.contact,
            facts: doc.facts,
            typeHierarchy: doc.typeHierarchy,
            logoRules: doc.logoRules,
            docTitle: doc.title,
            docUrl,
            sections: doc.sections,
        } : {},
        tokens: tokens.logo || null,
    };

    const normalized = StudioBrand.normalizeBrand(brand, 0);
    if (!normalized) return null;

    // Save the studio kit so every template composition can attach it by id.
    const kitId = slugify(`${packSlug}-${normalized.id}`).slice(0, 80);
    if (BRAND_KIT_ID.test(kitId)) {
        try {
            const kit = StudioBrand.brandKitFor(normalized, kitId);
            if (kit) {
                await saveBrandKit(kitId, { kit });
                normalized.brandKitId = kitId;
            }
        } catch (error) {
            warnings.push(`Could not save the shared kit for ${normalized.name}: ${error.message}`);
        }
    }
    return { brand: normalized, docPath, docUrl };
}

function titleCaseBrand(value) {
    const text = String(value || '').replace(/^\d+[-_]?/, '').replace(/[-_]+/g, ' ').trim();
    return text.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function fileNameForWarning(relative) {
    return baseNameOf(relative) || relative;
}

async function createBrandPackImport(payload) {
    const zipBuffer = decodeBase64(payload?.zip, 'Brand kit ZIP');
    if (zipBuffer.length > MAX_BRAND_PACK_ZIP) throw httpError(413, 'The brand kit ZIP is too large (160 MB maximum).');
    const zipEntries = readZipEntries(zipBuffer).filter((entry) => !entry.name.endsWith('/'));
    if (!zipEntries.length) throw httpError(400, 'The ZIP is empty.');
    if (zipEntries.length > MAX_BRAND_FILES) {
        throw httpError(413, `The ZIP contains more than ${MAX_BRAND_FILES} files.`);
    }

    let declared = 0;
    zipEntries.forEach((entry) => {
        declared += Number(entry.uncompressedSize) || 0;
    });
    if (declared > MAX_BRAND_EXTRACTED_BYTES) {
        throw httpError(413, 'The extracted brand kit is too large (480 MB maximum).');
    }

    const allFiles = stripCommonRoot(zipEntries.map((entry) => ({
        entry,
        raw: String(entry.name || '').replace(/\\/g, '/').replace(/^\/+/, ''),
    })));
    const files = [];
    for (const file of allFiles) {
        const relative = safeRelativePath(file.raw);
        if (!relative) continue;
        files.push({ ...file, relative });
    }
    if (!files.length) throw httpError(400, 'The ZIP does not contain any readable files.');

    const readme = readReadme(files, zipBuffer);
    const requestedName = sanitizeLabel(payload?.name, '').trim();
    const packName = requestedName || readme.name || titleCaseBrand(topLevelOf(files[0].relative)) || 'Brand pack';
    const packSlug = slugify(packName) || 'brand-pack';
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const packId = `${packSlug.slice(0, 40)}-${stamp}-${crypto.randomBytes(2).toString('hex')}`;
    const packDir = path.join(BRAND_PACKS_DIR, packId);
    const filesDir = path.join(packDir, 'files');
    const warnings = [];
    const budget = { bytes: 0 };
    const savedKitIds = [];
    const existingPacks = await listBrandPacks();
    if (existingPacks.length >= MAX_BRAND_PACKS) {
        throw httpError(409, `There are already ${MAX_BRAND_PACKS} brand packs. Delete one first.`);
    }

    await fsp.mkdir(filesDir, { recursive: true });
    try {
        const tokenFiles = files
            .map((file) => ({ ...file, dir: dirBeforeTokens(file.relative) }))
            .filter((file) => file.dir !== null);
        // Keep only brand directories that own the tokens file (dir/tokens/*.json).
        const ownedBrandDirs = [...new Set(tokenFiles
            .map((file) => file.dir)
            .filter((dir) => dir && dir.split('/').length >= 1))];
        let candidates = ownedBrandDirs.filter((dir) => !/portfolio/i.test(dir));
        // Numbered folders carry the intended reading order.
        candidates.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        if (!candidates.length) {
            const guideDirs = [...new Set(files
                .filter((file) => /brand[-_ ]?guide\.docx$/i.test(baseNameOf(file.relative)))
                .map((file) => dirOf(file.relative))
                .filter((dir) => dir && !/portfolio/i.test(dir)))];
            candidates = guideDirs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        }
        if (!candidates.length) {
            const docxDirs = [...new Set(files
                .filter((file) => /\.docx$/i.test(file.relative))
                .map((file) => dirOf(file.relative))
                .filter((dir) => dir && !/portfolio/i.test(dir)))];
            candidates = docxDirs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        }
        // A pack with tokens at the root is a single brand.
        const rootTokensFile = files.find((file) => /^tokens\/[^/]+\.tokens\.json$/i.test(file.relative))
            || files.find((file) => /^[^/]+\.tokens\.json$/i.test(file.relative) && !/(^|\/)(social|00-portfolio)\//i.test(file.relative));
        const rootTokens = rootTokensFile
            ? parseTokensJson(extractZipEntry(zipBuffer, rootTokensFile.entry).toString('utf8'))
            : null;
        if (!candidates.length && rootTokens) {
            // Tokens live at the root: the pack is a single brand.
            candidates = [''];
        }

        const brands = [];
        for (const dir of candidates) {
            const built = await brandFromDirectory({
                files,
                zipBuffer,
                brandDir: dir,
                fallbackName: packName,
                packId,
                packSlug,
                filesDir,
                warnings,
                rootTokens,
            });
            if (built && !brands.some((brand) => brand.id === built.brand.id)) {
                brands.push(built.brand);
                if (built.brand.brandKitId) savedKitIds.push(built.brand.brandKitId);
            }
        }
        if (!brands.length) {
            throw httpError(400, 'No brands were found. Expected a folder per brand, each with tokens/*.tokens.json and an optional *Brand-Guide.docx.');
        }

        // Portfolio: any folder that says so, otherwise the top-level docs.
        const portfolioDir = [...new Set(files.map((file) => topLevelOf(file.relative)))]
            .find((dir) => /portfolio/i.test(dir)) || '';
        let portfolio = { name: packName, summary: readme.description, assets: [] };
        if (portfolioDir) {
            const portfolioAssets = [];
            let portfolioDoc = null;
            let portfolioDocPath = '';
            for (const file of files) {
                if (!file.relative.startsWith(`${portfolioDir}/`)) continue;
                const relative = file.relative.slice(portfolioDir.length + 1);
                if (/\.docx$/i.test(relative) && !portfolioDoc) {
                    try {
                        const docBuffer = extractZipEntry(zipBuffer, file.entry);
                        chargeBrandBudget(budget, docBuffer.length);
                        portfolioDoc = parseBrandDocx(docBuffer, {
                            readZipEntries,
                            extractZipEntry,
                        }, { name: 'Portfolio brand overview' });
                        const storedDoc = await writeBrandAsset(filesDir, 'portfolio', relative, docBuffer);
                        portfolioDocPath = storedDoc ? relative : '';
                    } catch (error) {
                        warnings.push(`Could not read ${file.relative}: ${error.message}`);
                    }
                }
                if (!BRAND_ASSET_EXT.test(relative)) continue;
                if (portfolioAssets.length >= MAX_BRAND_ASSETS) continue;
                let buffer;
                try {
                    buffer = extractZipEntry(zipBuffer, file.entry);
                } catch {
                    continue;
                }
                if (buffer.length > MAX_BRAND_ASSET_BYTES) continue;
                chargeBrandBudget(budget, buffer.length);
                const isSvg = /\.svg$/i.test(relative) && svgAsset(buffer);
                const format = isSvg ? { format: 'svg', extension: 'svg' } : detectImageFormat(buffer);
                if (!format) continue;
                if (isSvg) buffer = sanitizeSvgBuffer(buffer).data;
                const stored = await writeBrandAsset(filesDir, 'portfolio', relative, buffer);
                if (!stored) continue;
                portfolioAssets.push({
                    name: assetLabel(relative),
                    url: urlPath('api', 'brand-packs', packId, 'files', 'portfolio', stored),
                    path: stored,
                });
            }
            portfolio = {
                name: portfolioDoc?.title || titleCaseBrand(portfolioDir),
                summary: portfolioDoc?.summary || readme.description,
                docTitle: portfolioDoc?.title || '',
                docUrl: portfolioDocPath
                    ? urlPath('api', 'brand-packs', packId, 'files', 'portfolio', safeBrandAssetName(portfolioDocPath) || baseNameOf(portfolioDocPath))
                    : '',
                assets: portfolioAssets,
                guidelines: portfolioDoc ? {
                    applications: portfolioDoc.applications,
                    printSpec: portfolioDoc.printSpec,
                    contact: portfolioDoc.contact,
                    facts: portfolioDoc.facts,
                    logoRules: portfolioDoc.logoRules,
                    typeHierarchy: portfolioDoc.typeHierarchy,
                    docTitle: portfolioDoc.title,
                    sections: portfolioDoc.sections,
                } : {},
            };
        }

        const createdAt = new Date().toISOString();
        const pack = StudioBrand.normalizeBrandPack({
            schema: StudioBrand.PACK_SCHEMA,
            id: packId,
            name: packName,
            description: readme.description,
            source: 'zip',
            storage: `data/brand-packs/${packId}`,
            createdAt,
            updatedAt: createdAt,
            brands,
            portfolio,
            meta: {
                source: 'zip',
                zipName: sanitizeFilename(payload?.zipName, 'brand-kit.zip'),
                fileCount: files.length,
                declaredBytes: declared,
                warnings: warnings.slice(0, 60),
                readme: readme.name,
                createdAt,
            },
        });
        if (!pack) throw httpError(500, 'The brand pack could not be built.');
        await writeFileAtomic(brandPackFile(packId), JSON.stringify({ pack, updatedAt: createdAt }, null, 2));
        return { pack, summary: brandPackSummary(pack) };
    } catch (error) {
        await fsp.rm(packDir, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
}

/**
 * Copies the pack assets a template actually references into its own import
 * project and rewrites the URLs. A created menu or card then survives the pack
 * being deleted, and the existing static /data/ route serves the files.
 */
async function localiseBrandAssets(packId, projectId, projectDir, composition) {
    const prefix = `/api/brand-packs/${packId}/files/`;
    const copied = new Set();
    const copy = async (url) => {
        if (typeof url !== 'string' || !url.startsWith(prefix)) return url;
        const relative = safeRelativePath(url.slice(prefix.length));
        if (!relative) return url;
        const source = path.join(BRAND_PACKS_DIR, packId, 'files', ...relative.split('/'));
        const target = path.join(projectDir, 'assets', ...relative.split('/'));
        try {
            await fsp.mkdir(path.dirname(target), { recursive: true });
            if (!copied.has(target)) {
                await fsp.copyFile(source, target);
                copied.add(target);
            }
        } catch {
            return url;
        }
        return urlPath('data', 'imports', projectId, 'assets', relative);
    };
    for (const layer of composition.layers || []) {
        if (typeof layer.url === 'string' && layer.url.startsWith(prefix)) {
            layer.url = await copy(layer.url);
            if (Array.isArray(layer.frames)) {
                layer.frames = await Promise.all(layer.frames.map((frame) => copy(frame)));
            }
        }
    }
    if (composition.brandKit && Array.isArray(composition.brandKit.logos)) {
        for (const logo of composition.brandKit.logos) {
            logo.url = await copy(logo.url);
        }
    }
    if (copied.size) composition.meta = { ...(composition.meta || {}), localAssets: copied.size };
}

async function createBrandTemplateProject(packId, payload) {
    const { pack } = await readBrandPack(packId);
    const brandId = String(payload?.brandId || '');
    const brand = pack.brands.find((entry) => entry.id === brandId);
    if (!brand) throw httpError(404, `The brand “${brandId || '?'}” is not in this pack.`);
    const templateId = String(payload?.templateId || '');
    const template = StudioBrand.templateById(templateId);
    if (!template) throw httpError(400, `Unknown template “${templateId}”.`);

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const base = slugify(`${brand.id}-${template.id}`) || 'brand-template';
    const id = `${base.slice(0, 48)}-${stamp}-${crypto.randomBytes(2).toString('hex')}`;
    const projectDir = path.join(IMPORTS_DIR, id);
    const name = sanitizeLabel(payload?.name, `${brand.name} — ${template.label}`);
    const createdAt = new Date().toISOString();
    let composition;
    try {
        composition = StudioBrand.createTemplateComposition({
            packId: pack.id,
            packName: pack.name,
            portfolio: pack.portfolio,
            brand,
            templateId: template.id,
            projectId: id,
            name,
        });
    } catch (error) {
        throw httpError(500, error.message || 'The template could not be built.');
    }
    composition.id = id;
    composition.name = name;
    composition.meta = {
        ...(composition.meta || {}),
        source: 'brand-template',
        storage: `data/imports/${id}`,
        createdAt,
        updatedAt: createdAt,
    };
    // The shared kit points at the pack's own asset URLs. A created template is
    // self-contained, so it keeps its localized kit snapshot instead; the shared
    // kit id is recorded for reference and can still be attached manually.
    composition.meta = { ...(composition.meta || {}), sharedKitId: brand.brandKitId || null };
    composition.brandKitId = null;
    await fsp.mkdir(projectDir, { recursive: true });
    try {
        await localiseBrandAssets(pack.id, id, projectDir, composition);
        await writeFileAtomic(path.join(projectDir, 'composition.json'), JSON.stringify(composition, null, 2));
    } catch (error) {
        await fsp.rm(projectDir, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
    return {
        project: {
            id,
            name,
            createdAt,
            updatedAt: createdAt,
            width: composition.width,
            height: composition.height,
            layerCount: composition.layers.length,
            referenceUrl: null,
            packId: pack.id,
            brandId: brand.id,
            templateId: template.id,
        },
        composition,
    };
}

// ─── Saved brand templates ───────────────────────────────────────────
// An initial template becomes a project when the user presses Create. When the
// work is finished they can publish that composition back to the brand: the
// snapshot below is independent of the project, so later edits never rewrite a
// template someone already published. Saved templates live beside the pack so
// they travel with it and can be exported as PNG, GIF or MP4 without the pack's
// original files.
const MAX_SAVED_BRAND_TEMPLATES = 60;
const SAVED_TEMPLATE_ID = /^[A-Za-z0-9_-]{1,100}$/;

function brandTemplatesRoot(packId, brandId) {
    return path.join(BRAND_PACKS_DIR, packId, 'templates', brandId);
}

function savedTemplateDir(packId, brandId, templateId) {
    return path.join(brandTemplatesRoot(packId, brandId), templateId);
}

function savedTemplateFile(packId, brandId, templateId) {
    return path.join(savedTemplateDir(packId, brandId, templateId), 'template.json');
}

function savedTemplateSummary(record) {
    const composition = record.composition || {};
    return {
        id: record.id,
        name: record.name,
        source: record.source || 'saved',
        sourceTemplateId: record.sourceTemplateId || composition.meta?.templateId || null,
        sourceProjectId: record.sourceProjectId || null,
        packId: record.packId,
        brandId: record.brandId,
        width: Number(record.width) || Number(composition.width) || 0,
        height: Number(record.height) || Number(composition.height) || 0,
        channel: record.channel || composition.formats?.[0]?.channel || 'custom',
        duration: Number(record.duration) || Number(composition.duration) || 0,
        layerCount: Number(record.layerCount) || (composition.layers || []).length,
        variableCount: Number(record.variableCount) || (composition.variables || []).length,
        formats: Array.isArray(record.formats) ? record.formats : [],
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        composition,
    };
}

function projectTemplateSummary(projectId, composition, savedTemplateId = null) {
    const meta = composition.meta || {};
    return {
        id: `project-${projectId}`,
        projectId,
        name: composition.name || meta.templateLabel || projectId,
        source: 'project',
        sourceTemplateId: meta.templateId || null,
        savedTemplateId,
        packId: meta.packId || null,
        brandId: meta.brandId || null,
        width: Number(composition.width) || 0,
        height: Number(composition.height) || 0,
        channel: composition.formats?.[0]?.channel || 'custom',
        duration: Number(composition.duration) || 0,
        layerCount: (composition.layers || []).length,
        variableCount: (composition.variables || []).length,
        formats: (composition.formats || []).map((format) => format.label || format.id),
        createdAt: meta.createdAt || null,
        updatedAt: meta.updatedAt || meta.createdAt || null,
        composition,
    };
}

async function readSavedBrandTemplateRecord(packId, brandId, templateId) {
    if (!SAVED_TEMPLATE_ID.test(templateId)) throw httpError(400, 'Invalid template id.');
    try {
        const record = JSON.parse(await fsp.readFile(savedTemplateFile(packId, brandId, templateId), 'utf8'));
        if (!record || typeof record !== 'object' || !record.composition) {
            throw httpError(500, 'The saved template file is incomplete.');
        }
        return record;
    } catch (error) {
        if (error.code === 'ENOENT') throw httpError(404, 'Saved template not found.');
        throw error;
    }
}

/**
 * Lists every saved snapshot for one brand plus the in-progress projects that
 * were created from that brand's templates. The projects explain "we already
 * made these"; the saved snapshots are the published, exportable versions.
 */
async function listBrandTemplates(packId, payload = {}) {
    const { pack } = await readBrandPack(packId);
    const brandId = String(payload.brandId || '');
    const brand = pack.brands.find((entry) => entry.id === brandId);
    if (!brand) throw httpError(404, `The brand “${brandId || '?'}” is not in this pack.`);

    const templates = [];
    const dir = brandTemplatesRoot(packId, brandId);
    let entries = [];
    try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    for (const entry of entries) {
        if (!entry.isDirectory() || !SAVED_TEMPLATE_ID.test(entry.name)) continue;
        try {
            const record = await readSavedBrandTemplateRecord(packId, brandId, entry.name);
            templates.push(savedTemplateSummary(record));
        } catch (error) {
            if (error.status === 404) continue;
            // A corrupt snapshot must not hide the others.
            console.warn(`[studio] could not read saved template ${entry.name}:`, error.message);
        }
    }
    templates.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

    const savedByProject = new Map(templates
        .filter((template) => template.sourceProjectId)
        .map((template) => [template.sourceProjectId, template.id]));
    const projects = [];
    let projectEntries = [];
    try {
        projectEntries = await fsp.readdir(IMPORTS_DIR, { withFileTypes: true });
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    for (const entry of projectEntries) {
        if (!entry.isDirectory() || !SAVED_TEMPLATE_ID.test(entry.name)) continue;
        let composition;
        try {
            composition = JSON.parse(await fsp.readFile(path.join(IMPORTS_DIR, entry.name, 'composition.json'), 'utf8'));
        } catch {
            continue;
        }
        const meta = composition?.meta || {};
        if (meta.packId !== packId || meta.brandId !== brandId) continue;
        if (meta.source !== 'brand-template') continue;
        projects.push(projectTemplateSummary(entry.name, composition, savedByProject.get(entry.name) || null));
    }
    projects.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

    return {
        packId,
        brandId,
        brandName: brand.name,
        templates: templates.slice(0, MAX_SAVED_BRAND_TEMPLATES),
        projects: projects.slice(0, MAX_SAVED_BRAND_TEMPLATES),
    };
}

/** Copies the pack assets a saved template references into its own folder. */
async function localiseSavedTemplateAssets(packId, brandId, templateId, composition) {
    const packPrefix = `/api/brand-packs/${packId}/files/`;
    const templatePrefix = new RegExp(`^/api/brand-packs/${packId}/templates/([A-Za-z0-9_-]{1,80})/([A-Za-z0-9_-]{1,100})/files/`);
    const publicPrefix = `/api/brand-packs/${packId}/templates/${brandId}/${templateId}/files/`;
    const root = savedTemplateDir(packId, brandId, templateId);
    const copied = new Set();
    const copy = async (url) => {
        if (typeof url !== 'string') return url;
        let source = null;
        let relative = null;
        if (url.startsWith(packPrefix)) {
            relative = safeRelativePath(url.slice(packPrefix.length));
            if (relative) source = path.join(BRAND_PACKS_DIR, packId, 'files', ...relative.split('/'));
        } else {
            const match = url.match(templatePrefix);
            const imported = url.match(/^\/data\/imports\/([A-Za-z0-9_-]{1,80})\/(.+)$/);
            if (match) {
                relative = safeRelativePath(url.slice(match[0].length));
                if (relative) source = path.join(savedTemplateDir(packId, match[1], match[2]), 'files', ...relative.split('/'));
            } else if (imported) {
                relative = safeRelativePath(imported[2]);
                if (relative) source = path.join(IMPORTS_DIR, imported[1], ...relative.split('/'));
            }
        }
        if (!source || !relative) return url;
        const target = path.join(root, 'files', ...relative.split('/'));
        try {
            await fsp.mkdir(path.dirname(target), { recursive: true });
            if (!copied.has(target)) {
                await fsp.copyFile(source, target);
                copied.add(target);
            }
        } catch {
            return url;
        }
        return `${publicPrefix}${relative}`;
    };
    for (const layer of composition.layers || []) {
        if (typeof layer.url === 'string') layer.url = await copy(layer.url);
        if (Array.isArray(layer.frames)) {
            layer.frames = await Promise.all(layer.frames.map((frame) => copy(frame)));
        }
    }
    if (composition.brandKit && Array.isArray(composition.brandKit.logos)) {
        for (const logo of composition.brandKit.logos) logo.url = await copy(logo.url);
    }
    return copied.size;
}

/**
 * Snapshots a live composition into the brand's template library. The client
 * sends its current, unsaved composition so the published template is exactly
 * what the user was looking at; `projectId` is recorded for traceability.
 */
async function saveBrandTemplate(packId, payload = {}) {
    const { pack } = await readBrandPack(packId);
    const brandId = String(payload.brandId || '');
    const brand = pack.brands.find((entry) => entry.id === brandId);
    if (!brand) throw httpError(404, `The brand “${brandId || '?'}” is not in this pack.`);

    const sourceProjectId = String(payload.projectId || '').trim();
    if (sourceProjectId && !SAVED_TEMPLATE_ID.test(sourceProjectId)) {
        throw httpError(400, 'Invalid source project id.');
    }
    let composition = payload.composition;
    if (!composition && sourceProjectId) composition = await readSavedComposition(sourceProjectId);
    if (!composition || typeof composition !== 'object' || !Array.isArray(composition.layers)) {
        throw httpError(400, 'The request must include a composition with a layers array.');
    }
    if (composition.layers.length > MAX_LAYERS) {
        throw httpError(413, `A composition cannot contain more than ${MAX_LAYERS} layers.`);
    }
    if (JSON.stringify(composition).length > MAX_COMPOSITION_BYTES) {
        throw httpError(413, 'The composition is too large to save as a template.');
    }

    const count = (await fsp.readdir(brandTemplatesRoot(packId, brandId)).catch(() => []))
        .filter((name) => SAVED_TEMPLATE_ID.test(name)).length;
    if (count >= MAX_SAVED_BRAND_TEMPLATES) {
        throw httpError(413, `A brand can hold at most ${MAX_SAVED_BRAND_TEMPLATES} saved templates.`);
    }

    const name = sanitizeLabel(payload.name, composition.name || `${brand.name} — Template`);
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const base = (slugify(name) || 'template').slice(0, 48);
    let id = `${base}-${stamp}-${crypto.randomBytes(2).toString('hex')}`;
    while (await fsp.stat(savedTemplateDir(packId, brandId, id)).then(() => true).catch(() => false)) {
        id = `${base}-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
    }

    const createdAt = new Date().toISOString();
    const snapshot = JSON.parse(JSON.stringify(composition));
    snapshot.layers = (snapshot.layers || [])
        .filter((layer) => layer && typeof layer === 'object' && typeof layer.id === 'string')
        .slice(0, MAX_LAYERS);
    if (!snapshot.layers.length) throw httpError(400, 'The composition has no publishable layers.');
    snapshot.variables = Array.isArray(snapshot.variables) ? snapshot.variables : [];
    snapshot.formats = Array.isArray(snapshot.formats) ? snapshot.formats : [];
    snapshot.characters = Array.isArray(snapshot.characters) ? snapshot.characters : [];
    snapshot.id = id;
    snapshot.name = name;
    snapshot.version = Math.max(3, Number(snapshot.version) || 3);
    snapshot.width = Math.max(1, Math.round(Number(snapshot.width) || 1080));
    snapshot.height = Math.max(1, Math.round(Number(snapshot.height) || 1080));
    snapshot.duration = Math.max(1, Math.round(Number(snapshot.duration) || DEFAULT_DURATION));
    snapshot.meta = {
        ...(snapshot.meta || {}),
        source: 'brand-template-saved',
        packId: pack.id,
        packName: pack.name,
        brandId: brand.id,
        brandName: brand.name,
        savedTemplateId: id,
        savedAt: createdAt,
        sourceProjectId: sourceProjectId || null,
        storage: `data/brand-packs/${pack.id}/templates/${brand.id}/${id}`,
    };
    const dir = savedTemplateDir(packId, brandId, id);
    await fsp.mkdir(dir, { recursive: true });
    try {
        await localiseSavedTemplateAssets(pack.id, brand.id, id, snapshot);
        const record = {
            id,
            packId: pack.id,
            brandId: brand.id,
            name,
            source: 'saved',
            sourceTemplateId: snapshot.meta?.templateId || payload.sourceTemplateId || null,
            sourceProjectId: sourceProjectId || null,
            width: snapshot.width,
            height: snapshot.height,
            channel: snapshot.formats?.[0]?.channel || 'custom',
            duration: snapshot.duration,
            layerCount: snapshot.layers.length,
            variableCount: (snapshot.variables || []).length,
            formats: (snapshot.formats || []).map((format) => format.label || format.id),
            createdAt,
            updatedAt: createdAt,
            composition: snapshot,
        };
        await writeFileAtomic(savedTemplateFile(packId, brand.id, id), JSON.stringify(record, null, 2));
        return { template: savedTemplateSummary(record), composition: snapshot };
    } catch (error) {
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
}

/** Creates a normal editable project from a published template snapshot. */
async function openSavedBrandTemplate(packId, brandId, templateId, payload = {}) {
    const { pack } = await readBrandPack(packId);
    const brand = pack.brands.find((entry) => entry.id === brandId);
    if (!brand) throw httpError(404, `The brand “${brandId}” is not in this pack.`);
    const record = await readSavedBrandTemplateRecord(packId, brandId, templateId);
    const composition = JSON.parse(JSON.stringify(record.composition));
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const base = (slugify(composition.name || record.name) || 'brand-template').slice(0, 48);
    const id = `${base}-${stamp}-${crypto.randomBytes(2).toString('hex')}`;
    const projectDir = path.join(IMPORTS_DIR, id);
    const createdAt = new Date().toISOString();
    const name = sanitizeLabel(payload.name, composition.name || record.name);

    // Copy the snapshot's files into the new project rather than linking to
    // the template folder, so deleting the published template cannot break a
    // copy that is already being edited.
    const templatePrefix = `/api/brand-packs/${packId}/templates/${brandId}/${templateId}/files/`;
    const projectPrefix = `/data/imports/${id}/assets/`;
    const copyAsset = async (url) => {
        if (typeof url !== 'string') return url;
        let source = null;
        let relative = null;
        let targetRelative = null;
        if (url.startsWith(templatePrefix)) {
            relative = safeRelativePath(url.slice(templatePrefix.length));
            // Import-sourced snapshots keep an assets/ segment in their copied
            // path; strip it once so the working copy does not nest it twice.
            targetRelative = relative && relative.startsWith('assets/') ? relative.slice('assets/'.length) : relative;
            if (relative) source = path.join(savedTemplateDir(packId, brandId, templateId), 'files', ...relative.split('/'));
        } else {
            const imported = url.match(/^\/data\/imports\/([A-Za-z0-9_-]{1,80})\/(.+)$/);
            if (imported) {
                relative = safeRelativePath(imported[2]);
                // Import URLs already include the project's assets/ folder;
                // do not nest it twice in the copy.
                targetRelative = relative && relative.startsWith('assets/') ? relative.slice('assets/'.length) : relative;
                if (relative) source = path.join(IMPORTS_DIR, imported[1], ...relative.split('/'));
            }
        }
        if (!source || !relative || !targetRelative) return url;
        const target = path.join(projectDir, 'assets', ...targetRelative.split('/'));
        try {
            await fsp.mkdir(path.dirname(target), { recursive: true });
            await fsp.copyFile(source, target);
        } catch {
            return url;
        }
        return `${projectPrefix}${targetRelative}`;
    };
    for (const layer of composition.layers || []) {
        if (typeof layer.url === 'string') layer.url = await copyAsset(layer.url);
        if (Array.isArray(layer.frames)) {
            layer.frames = await Promise.all(layer.frames.map((frame) => copyAsset(frame)));
        }
    }
    if (composition.brandKit && Array.isArray(composition.brandKit.logos)) {
        for (const logo of composition.brandKit.logos) logo.url = await copyAsset(logo.url);
    }

    composition.id = id;
    composition.name = name;
    composition.meta = {
        ...(composition.meta || {}),
        source: 'brand-template',
        packId: pack.id,
        packName: pack.name,
        brandId: brand.id,
        brandName: brand.name,
        templateId: composition.meta?.templateId || null,
        brandTemplateId: record.id,
        storage: `data/imports/${id}`,
        createdAt,
        updatedAt: createdAt,
    };
    await fsp.mkdir(projectDir, { recursive: true });
    try {
        await writeFileAtomic(path.join(projectDir, 'composition.json'), JSON.stringify(composition, null, 2));
    } catch (error) {
        await fsp.rm(projectDir, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
    return {
        project: {
            id,
            name,
            createdAt,
            updatedAt: createdAt,
            width: composition.width,
            height: composition.height,
            layerCount: composition.layers.length,
            referenceUrl: null,
            packId: pack.id,
            brandId: brand.id,
            templateId: composition.meta?.templateId || null,
            brandTemplateId: record.id,
        },
        composition,
    };
}

async function deleteSavedBrandTemplate(packId, brandId, templateId) {
    const { pack } = await readBrandPack(packId);
    if (!pack.brands.some((brand) => brand.id === brandId)) {
        throw httpError(404, `The brand “${brandId}” is not in this pack.`);
    }
    await readSavedBrandTemplateRecord(packId, brandId, templateId);
    await fsp.rm(savedTemplateDir(packId, brandId, templateId), { recursive: true, force: true });
    return { deleted: true, id: templateId };
}

/** The read-only file route for the assets a saved template copied. */
function savedTemplateAssetPath(packId, brandId, templateId, relativePath) {
    if (!SAVED_TEMPLATE_ID.test(templateId) || !SAVED_TEMPLATE_ID.test(brandId)) return null;
    const relative = safeRelativePath(relativePath);
    if (!relative) return null;
    const root = path.join(savedTemplateDir(packId, brandId, templateId), 'files');
    const target = path.join(root, ...relative.split('/'));
    const resolved = path.resolve(target);
    return resolved.startsWith(path.resolve(root) + path.sep) ? resolved : null;
}

// ─── Brief ingestion (Phase 5) ───────────────────────────────────────
// A brief is a CSV or an .xlsx table: one row per creative, one column per
// template variable. The XLSX reader is built on the ZIP reader above, so the
// server stays dependency-free.
const OLE2_MAGIC = Buffer.from([0xD0, 0xCF, 0x11, 0xE0]);

function decodeXmlEntities(value) {
    return String(value ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
        if (entity[0] === '#') {
            const hex = entity[1] === 'x' || entity[1] === 'X';
            const code = Number.parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10);
            if (!Number.isFinite(code)) return match;
            try {
                return String.fromCodePoint(code);
            } catch {
                return match;
            }
        }
        const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
        return Object.prototype.hasOwnProperty.call(named, entity) ? named[entity] : match;
    });
}

function parseSharedStrings(xml) {
    const strings = [];
    const entry = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let match;
    while ((match = entry.exec(String(xml || '')))) {
        const text = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
            .map((run) => decodeXmlEntities(run[1]))
            .join('');
        strings.push(text);
    }
    return strings;
}

function columnIndexFromRef(ref) {
    const letters = String(ref || '').match(/^[A-Z]+/i);
    if (!letters) return null;
    let index = 0;
    for (const char of letters[0].toUpperCase()) {
        index = index * 26 + (char.charCodeAt(0) - 64);
    }
    return index - 1;
}

function parseWorksheetRows(xml, sharedStrings) {
    const rows = [];
    const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch;
    while ((rowMatch = rowPattern.exec(String(xml || '')))) {
        const cells = [];
        const cellPattern = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;
        let cellMatch;
        while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
            const attrs = cellMatch[1] || cellMatch[2] || '';
            const body = cellMatch[3] || '';
            const ref = (attrs.match(/\br="([^"]+)"/) || [])[1] || '';
            const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || 'n';
            const position = columnIndexFromRef(ref);
            let value = '';
            if (type === 'inlineStr') {
                value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
                    .map((run) => decodeXmlEntities(run[1]))
                    .join('');
            } else {
                const raw = (body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1];
                const text = raw === undefined ? '' : decodeXmlEntities(raw);
                if (type === 's') {
                    const index = Number(text);
                    value = Number.isInteger(index) ? (sharedStrings[index] ?? '') : '';
                } else if (type === 'b') {
                    value = text === '1' ? 'TRUE' : 'FALSE';
                } else {
                    // Numbers, ISO dates and formula results all arrive as text;
                    // Excel date serials are left as-is.
                    value = text;
                }
            }
            const index = position === null || position < 0 ? cells.length : position;
            cells[index] = value;
        }
        rows.push(Array.from(cells, (cell) => (cell === undefined ? '' : cell)));
    }
    return rows;
}

function readXlsxSheet(buffer, options) {
    const entries = readZipEntries(buffer);
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    const readText = (name) => {
        const entry = byName.get(name);
        if (!entry) return null;
        return extractZipEntry(buffer, entry).toString('utf8');
    };

    const workbook = readText('xl/workbook.xml');
    if (!workbook) throw httpError(400, 'This workbook is missing xl/workbook.xml.');

    const sheets = [];
    const sheetPattern = /<sheet\b([^>]*?)\/?>/g;
    let match;
    while ((match = sheetPattern.exec(workbook))) {
        const attrs = match[1];
        const name = decodeXmlEntities((attrs.match(/\bname="([^"]*)"/) || [])[1] || '');
        const relId = (attrs.match(/\br:id="([^"]+)"/) || [])[1] || '';
        if (name) sheets.push({ name, relId });
    }
    if (!sheets.length) throw httpError(400, 'This workbook has no sheets.');

    const rels = readText('xl/_rels/workbook.xml.rels') || '';
    const targets = new Map();
    const relPattern = /<Relationship\b([^>]*?)\/?>/g;
    while ((match = relPattern.exec(rels))) {
        const attrs = match[1];
        const id = (attrs.match(/\bId="([^"]+)"/) || [])[1];
        const target = (attrs.match(/\bTarget="([^"]+)"/) || [])[1];
        if (id && target) targets.set(id, target);
    }

    const wanted = options && options.sheet ? String(options.sheet) : '';
    const chosen = (wanted && sheets.find((sheet) => sheet.name === wanted)) || sheets[0];

    // NB: `path` is the Node module here; the sheet part is `sheetPath`.
    let sheetPath = '';
    const target = targets.get(chosen.relId);
    if (target) {
        sheetPath = target.startsWith('/')
            ? path.posix.normalize(target.slice(1))
            : path.posix.normalize(`xl/${target}`);
    }
    if (!sheetPath || !byName.has(sheetPath)) {
        const conventional = `xl/worksheets/sheet${sheets.indexOf(chosen) + 1}.xml`;
        if (byName.has(conventional)) sheetPath = conventional;
        else if (byName.has('xl/worksheets/sheet1.xml')) sheetPath = 'xl/worksheets/sheet1.xml';
        else sheetPath = '';
    }
    const worksheet = sheetPath ? readText(sheetPath) : null;
    if (!worksheet) throw httpError(400, 'The selected worksheet could not be read.');

    const shared = parseSharedStrings(readText('xl/sharedStrings.xml') || '');
    return {
        sheet: chosen.name,
        sheets: sheets.map((sheet) => sheet.name),
        matrix: parseWorksheetRows(worksheet, shared),
    };
}

/** Parses a CSV or XLSX brief into `{ headers, rows, source, sheet }`. */
function parseBriefFile(name, buffer, options) {
    if (!buffer || !buffer.length) throw httpError(400, 'The brief file is empty.');
    if (buffer.length > MAX_BRIEF_BYTES) throw httpError(413, 'Brief files are limited to 8 MB.');
    const label = String(name || '');
    if (buffer.subarray(0, 4).equals(OLE2_MAGIC)) {
        throw httpError(415, 'Legacy .xls files are not supported. Save the sheet as .xlsx or .csv.');
    }
    if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
        const sheet = readXlsxSheet(buffer, options);
        const table = Core.normalizeTable(sheet.matrix);
        if (!table.headers.length) throw httpError(400, `The sheet “${sheet.sheet}” is empty.`);
        return { source: 'xlsx', sheet: sheet.sheet, sheets: sheet.sheets, ...table };
    }
    if (/\.(xlsx|xlsm|xls)$/i.test(label)) {
        throw httpError(415, 'That file is not a readable .xlsx workbook. Re-save it as .xlsx or .csv.');
    }
    const table = Core.parseDelimitedTable(buffer.toString('utf8'));
    if (!table.headers.length) throw httpError(400, 'The brief file has no header row.');
    return { source: 'csv', sheet: null, sheets: [], ...table };
}

async function readJsonRequest(req, limit = 2 * 1024 * 1024) {
    const body = await readBody(req, limit);
    try {
        return JSON.parse(body.toString('utf8') || '{}');
    } catch {
        throw httpError(400, 'The request must be valid JSON.');
    }
}

let voiceModulesPromise = null;
function voiceModules() {
    if (!voiceModulesPromise) {
        voiceModulesPromise = Promise.all([
            import('./src/server/voice/tts-server.mjs'),
            import('./src/server/voice/voice-design-agent.mjs'),
        ]).then(([server, agent]) => ({ server, agent }));
    }
    return voiceModulesPromise;
}

async function askVoiceEngine(prompt) {
    const llm = await getLlmCatalog();
    if (!llm.available) throw httpError(503, llm.error || 'The local voice-design engine is unavailable.');
    const model = resolveModelId('', llm.defaults.text, llm.models);
    const result = await callOllama(model, [{ role: 'user', content: prompt }], {
        temperature: 0.6, numPredict: 1800, numCtx: 16384,
    });
    const content = result?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw httpError(502, 'The voice-design engine returned an empty reply.');
    return content;
}

function fallbackProposals(message, context, agent) {
    const text = String(message || '').toLowerCase();
    const language = ['portuguese', 'english', 'spanish', 'french', 'german', 'italian', 'japanese']
        .find((entry) => text.includes(entry)) || context.current?.language || 'english';
    const presentation = /female|feminine|woman/.test(text) ? 'feminine'
        : (/male|masculine|man/.test(text) ? 'masculine' : 'androgynous');
    const age = /child|young/.test(text) ? 'youthful' : (/old|mature|elder/.test(text) ? 'mature' : 'adult');
    const sample = language === 'portuguese'
        ? 'Uma voz calma pode tornar uma história complicada mais fácil de acompanhar.'
        : 'A calm voice can make a complicated story easier to follow.';
    const base = {
        model: context.current?.model || context.models?.[0] || agent.FALLBACK_MODEL,
        language, locale: context.current?.locale || '',
        sample, presentation, age, sample,
    };
    return [
        agent.normalizeProposal({
            ...base,
            direction: 'Grounded documentary',
            name: 'Grounded documentary',
            delivery: 'warm',
            description: 'A grounded, intimate narrator with measured pacing and a warm low register. The voice sounds close to the listener, never theatrical.',
            refine: { rate: 0.9, energy: 0.35, pause: 'measured', register: 'low', brightness: 0.35, breathiness: 0.35, proximity: 'close' },
            rationale: 'A safe, human default for a story-led request when no language model is available.',
            changes: ['Slow the pace', 'Bring the voice closer', 'Lower the register'],
        }, context, 0),
        agent.normalizeProposal({
            ...base,
            direction: 'Bright editorial',
            name: 'Bright editorial',
            delivery: 'energetic',
            description: 'A bright, forward editorial voice with crisp articulation and a little lift. It carries a room without sounding like an advert.',
            refine: { rate: 1.05, energy: 0.65, pause: 'tight', register: 'mid-high', brightness: 0.7, proximity: 'mid' },
            rationale: 'A contrasting, more projected alternative built from the same request.',
            changes: ['Lift the energy', 'Brighten the tone', 'Tighten the pauses'],
        }, context, 1),
    ];
}

function analysisUnavailable(reason) {
    return `${reason} Image analysis is still available; confirm the class in the library.`;
}

async function handleApi(req, res, pathname) {
    if (pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true });
        return;
    }

    if (pathname === '/api/llm/models' && req.method === 'GET') {
        sendJson(res, 200, await getLlmCatalog());
        return;
    }

    if (pathname === '/api/llm/animation-director' && req.method === 'GET') {
        sendJson(res, 200, await getAnimationDirectorCatalog());
        return;
    }

    if (pathname === '/api/llm/organizer-models' && req.method === 'GET') {
        sendJson(res, 200, await getOrganizerModelCatalog());
        return;
    }

    if (pathname === '/api/crawler/status' && req.method === 'GET') {
        sendJson(res, 200, await Crawler.status());
        return;
    }

    if (pathname === '/api/crawler/search' && req.method === 'POST') {
        const body = await readJsonRequest(req);
        sendJson(res, 200, await Crawler.search(body));
        return;
    }

    if (pathname === '/api/crawler/discover' && req.method === 'POST') {
        const body = await readJsonRequest(req);
        sendJson(res, 200, await Crawler.discover(body));
        return;
    }

    if (pathname === '/api/crawler/runs' && req.method === 'GET') {
        sendJson(res, 200, { runs: await Crawler.listRuns() });
        return;
    }

    if (pathname === '/api/crawler/runs' && req.method === 'POST') {
        const body = await readJsonRequest(req);
        sendJson(res, 202, await Crawler.startRun(body));
        return;
    }

    const crawlerRunMatch = pathname.match(/^\/api\/crawler\/runs\/([A-Za-z0-9_-]{1,120})(?:\/(log|cancel|import|zip))?$/);
    if (crawlerRunMatch) {
        const runId = crawlerRunMatch[1];
        const action = crawlerRunMatch[2] || '';
        if (!action && req.method === 'GET') {
            sendJson(res, 200, await Crawler.getRun(runId));
            return;
        }
        if (action === 'log' && req.method === 'GET') {
            const run = await Crawler.getRun(runId);
            sendJson(res, 200, { id: run.id, state: run.state, phase: run.phase, log: run.log });
            return;
        }
        if (action === 'cancel' && req.method === 'POST') {
            sendJson(res, 200, await Crawler.cancelRun(runId));
            return;
        }
        if (action === 'zip' && req.method === 'GET') {
            const zipPath = await Crawler.zipForRun(runId);
            const stat = await fsp.stat(zipPath);
            res.writeHead(200, {
                'Content-Type': 'application/zip',
                'Content-Length': stat.size,
                'Content-Disposition': `attachment; filename="${path.basename(zipPath).replace(/[^A-Za-z0-9_.-]/g, '-')}"`,
                'Cache-Control': 'no-store',
            });
            fs.createReadStream(zipPath).pipe(res);
            return;
        }
        if (action === 'import' && req.method === 'POST') {
            const run = await Crawler.getRun(runId);
            if (run.importedPackId) {
                sendJson(res, 200, { alreadyImported: true, packId: run.importedPackId });
                return;
            }
            const zipPath = await Crawler.zipForRun(runId);
            const stat = await fsp.stat(zipPath);
            if (stat.size > MAX_BRAND_PACK_ZIP) {
                throw httpError(413, 'The crawler ZIP is larger than the brand-pack import limit.');
            }
            const zipBuffer = await fsp.readFile(zipPath);
            const imported = await createBrandPackImport({
                zip: `data:application/zip;base64,${zipBuffer.toString('base64')}`,
                zipName: path.basename(zipPath),
            });
            await Crawler.markImported(runId, imported.pack.id);
            sendJson(res, 201, imported);
            return;
        }
        throw httpError(405, 'Method not allowed for this crawler action.');
    }

    // ─── Business social intelligence ───────────────────────────────
    if (pathname === '/api/social/sources' && req.method === 'GET') {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        if (url.searchParams.get('refresh')) SocialStore.refresh({ force: true });
        sendJson(res, 200, { sources: SocialStore.listSources(), health: SocialStore.health() });
        return;
    }

    if (pathname === '/api/social/by-brand' && req.method === 'GET') {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const dataset = SocialStore.findByBrand({
            brandId: String(url.searchParams.get('brandId') || ''),
            name: String(url.searchParams.get('name') || ''),
        });
        sendJson(res, 200, { dataset, matched: Boolean(dataset) });
        return;
    }

    const socialMatch = pathname.match(/^\/api\/social\/(soc_[a-f0-9]{12})(\/crawl)?$/);
    if (socialMatch && (req.method === 'GET' || req.method === 'POST')) {
        const dataset = SocialStore.get(socialMatch[1]);
        if (!dataset) throw httpError(404, 'Social dataset not found.');
        if (!socialMatch[2]) {
            if (req.method !== 'GET') throw httpError(405, 'Use /api/social/:id/crawl to start a run.');
            sendJson(res, 200, { dataset, crawl: await socialCrawlAccess(dataset) });
            return;
        }
        if (req.method !== 'POST') throw httpError(405, 'Use POST to start a social crawl.');
        const access = await socialCrawlAccess(dataset);
        if (!access.enabled) {
            throw httpError(403, 'The social crawler is not enabled for this business. Ask the studio administrator.');
        }
        const business = dataset.business || {};
        if (!business.website) throw httpError(422, 'This business has no website on file, so the crawler has no seed.');
        const body = await readJsonRequest(req);
        const profiles = {};
        for (const channel of dataset.channels || []) {
            const source = String(channel.source || '').toLowerCase();
            if (!channel.present || !channel.url || !SOCIAL_PROFILE_SOURCES.has(source)) continue;
            profiles[source] = channel.url;
        }
        const target = {
            name: business.name,
            slug: business.slug || '',
            city: business.city || '',
            region: business.region || '',
            country: business.country || '',
            category: business.category || '',
            website: business.website,
            profiles,
        };
        const options = body && typeof body.options === 'object' && body.options ? body.options : body;
        const cooldownKey = access.ref || access.brandId || dataset.id;
        const lastStart = socialCrawlStarts.get(cooldownKey) || 0;
        if (Date.now() - lastStart < SOCIAL_CRAWL_COOLDOWN_MS) {
            throw httpError(429, 'A social crawl for this business was started recently. Try again in a moment.');
        }
        const run = await Crawler.startSocialRun({ target, group: access.packName || business.name, options });
        socialCrawlStarts.set(cooldownKey, Date.now());
        sendJson(res, 202, { run, access });
        return;
    }

    // ─── TTS and the voice-design agent ─────────────────────────────

    if (pathname === '/api/tts/status' && req.method === 'GET') {
        const { server } = await voiceModules();
        sendJson(res, 200, await server.ttsStatus());
        return;
    }

    if (pathname === '/api/tts/start' && req.method === 'POST') {
        const { server } = await voiceModules();
        sendJson(res, 200, await server.ensureTtsServer());
        return;
    }

    if (pathname === '/api/tts/stop' && req.method === 'POST') {
        const { server } = await voiceModules();
        const result = server.stopTtsServer();
        sendJson(res, 200, { ...result, ...(await server.ttsStatus()) });
        return;
    }

    if (pathname === '/api/tts/models' && req.method === 'GET') {
        const { server } = await voiceModules();
        try {
            await server.ensureTtsServer();
            sendJson(res, 200, await server.ttsJson('/v1/models'));
        } catch (error) {
            throw httpError(error.status || 502, error.message || 'TTS models are unavailable.');
        }
        return;
    }

    if (pathname === '/api/tts/voices' && req.method === 'GET') {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const model = url.searchParams.get('model');
        if (!model) throw httpError(400, 'A model query parameter is required.');
        const { server } = await voiceModules();
        try {
            await server.ensureTtsServer();
            sendJson(res, 200, await server.ttsJson(`/v1/audio/voices?model=${encodeURIComponent(model)}`));
        } catch (error) {
            throw httpError(error.status || 502, error.message || 'TTS voices are unavailable.');
        }
        return;
    }

    if (pathname === '/api/tts/speech' && req.method === 'POST') {
        const body = await readJsonRequest(req);
        const input = String(body?.input ?? body?.text ?? '').trim();
        const model = String(body?.model ?? '').trim();
        if (!input) throw httpError(400, 'The text to speak is required.');
        if (!model) throw httpError(400, 'A TTS model is required.');
        if (input.length > 20000) throw httpError(413, 'Text is limited to 20,000 characters.');
        const payload = { model, input };
        for (const key of ['instruct', 'voice', 'speed', 'lang_code', 'ref_audio', 'ref_text',
            'temperature', 'top_p', 'top_k', 'repetition_penalty', 'response_format', 'stream']) {
            if (body[key] !== undefined && body[key] !== null && body[key] !== '') payload[key] = body[key];
        }
        if (!payload.response_format) payload.response_format = 'wav';
        if (/voicedesign/i.test(model) && !payload.instruct) {
            payload.instruct = 'A clear, natural voice with a warm, measured delivery.';
        }
        const { server } = await voiceModules();
        try {
            const audio = await server.ttsSpeech(payload);
            res.writeHead(200, {
                'Content-Type': audio.contentType,
                'Content-Length': audio.bytes.length,
                'Cache-Control': 'no-store',
                'X-Studio-TTS-Engine': audio.engine,
            });
            res.end(audio.bytes);
        } catch (error) {
            throw httpError(error.status || 502, error.message || 'Speech synthesis failed.');
        }
        return;
    }

    if (pathname === '/api/tts/design/sessions' && req.method === 'GET') {
        const { agent } = await voiceModules();
        const userId = agent.resolveUserId(req);
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        sendJson(res, 200, {
            ...agent.listSessions(userId, { limit: Number(url.searchParams.get('limit')) || 20 }),
            user_id: userId,
        });
        return;
    }

    if (pathname === '/api/tts/design/sessions' && req.method === 'POST') {
        const { agent } = await voiceModules();
        const body = await readJsonRequest(req);
        sendJson(res, 200, { session: agent.createSession(agent.resolveUserId(req), { title: body?.title }) });
        return;
    }

    const voiceSessionMatch = pathname.match(/^\/api\/tts\/design\/sessions\/([^/]+)$/);
    if (voiceSessionMatch) {
        const { agent } = await voiceModules();
        const userId = agent.resolveUserId(req);
        const id = decodeURIComponent(voiceSessionMatch[1]);
        if (req.method === 'GET') {
            const session = agent.getSession(userId, id);
            if (!session) throw httpError(404, 'Voice-design session not found.');
            sendJson(res, 200, { session });
            return;
        }
        if (req.method === 'DELETE') {
            const removed = agent.deleteSession(userId, id);
            sendJson(res, removed ? 200 : 404, removed ? { ok: true, id } : { error: 'Voice-design session not found.' });
            return;
        }
        throw httpError(405, 'Method not allowed for this voice-design session.');
    }

    if (pathname === '/api/tts/design/suggest' && req.method === 'POST') {
        const { agent } = await voiceModules();
        const body = await readJsonRequest(req);
        const message = String(body?.message || '').trim().slice(0, 2000);
        if (!message) throw httpError(400, 'Describe the voice you want.');
        const userId = agent.resolveUserId(req);
        const previousSession = body?.session_id ? agent.getSession(userId, String(body.session_id)) : null;
        const context = body?.context && typeof body.context === 'object' ? body.context : {};
        let result;
        let fallback = false;
        try {
            result = await agent.generateProposals(askVoiceEngine, {
                message, context,
                history: previousSession?.messages || [],
                previous: previousSession?.proposals || [],
            });
        } catch (error) {
            // A local LLM is optional. Two curated, complete directions keep the
            // audition path usable and are clearly labelled as a fallback.
            if (error.status && error.status !== 503 && error.status !== 502) throw error;
            const proposals = fallbackProposals(message, context, agent);
            result = { proposals, attempts: [{ attempt: 0, note: 'deterministic fallback' }], elapsed_ms: 0 };
            fallback = true;
        }
        const assistantText = result.proposals
            .map((proposal, index) => `${index + 1}. ${proposal.direction} — ${proposal.rationale}`)
            .join('\n');
        const session = agent.appendTurn(userId, previousSession?.id, {
            message, proposals: result.proposals, assistantText,
        });
        sendJson(res, 200, {
            session, proposals: result.proposals,
            meta: {
                attempts: result.attempts, elapsed_ms: result.elapsed_ms,
                engine: fallback ? 'curated-fallback' : 'local-llm', user_id: userId,
            },
        });
        return;
    }

    const voicePreviewMatch = pathname.match(/^\/api\/tts\/design\/proposals\/([^/]+)\/(preview|applied)$/);
    if (voicePreviewMatch) {
        const { server, agent } = await voiceModules();
        const proposalId = decodeURIComponent(voicePreviewMatch[1]);
        const action = voicePreviewMatch[2];
        const userId = agent.resolveUserId(req);
        const body = req.method === 'POST' ? await readJsonRequest(req) : {};
        const session = body?.session_id ? agent.getSession(userId, String(body.session_id)) : null;
        const proposal = session?.proposals?.find((item) => item.id === proposalId);
        if (!proposal) throw httpError(404, 'Voice proposal not found in this session.');
        if (action === 'applied') {
            if (req.method !== 'POST') throw httpError(405, 'POST is required.');
            sendJson(res, 200, { session: agent.markApplied(userId, session.id, proposalId) });
            return;
        }
        if (req.method !== 'POST') throw httpError(405, 'POST is required.');
        try {
            const audio = await server.ttsSpeech(agent.proposalSpeechPayload(proposal));
            res.writeHead(200, {
                'Content-Type': audio.contentType,
                'Content-Length': audio.bytes.length,
                'Cache-Control': 'no-store',
                'X-Studio-TTS-Engine': audio.engine,
            });
            res.end(audio.bytes);
        } catch (error) {
            throw httpError(error.status || 502, error.message || 'Voice preview failed.');
        }
        return;
    }

    // ─── Video transcode (optional ffmpeg) ──────────────────────────

    if (pathname === '/api/video/transcode' && req.method === 'POST') {
        const body = await readBody(req, MAX_TRANSCODE_BYTES + 1024);
        const data = await transcodeVideoToMp4(body, req.headers['content-type'] || '');
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Content-Length': data.length,
            'Cache-Control': 'no-store',
            'X-Studio-Transcoded': 'h264',
        });
        res.end(data);
        return;
    }

    // ─── Business Asset Intelligence ────────────────────────────────

    if (pathname === '/api/assets/status' && req.method === 'GET') {
        const sidecar = await AssetService.status();
        const health = await AssetStore.assetHealth();
        const llm = await getLlmCatalog().catch(() => ({ available: false, error: 'LLM unavailable' }));
        sendJson(res, 200, {
            ...sidecar,
            vision: Boolean(llm.available && (llm.models || []).some((model) => model.vision)),
            visionReason: llm.available ? '' : (llm.error || 'No local vision model'),
            health,
        });
        return;
    }

    if (pathname === '/api/assets/taxonomy' && req.method === 'GET') {
        sendJson(res, 200, require('./src/shared/asset-intel.js').taxonomy());
        return;
    }

    if (pathname === '/api/assets/health' && req.method === 'GET') {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        sendJson(res, 200, await AssetStore.assetHealth({
            packId: url.searchParams.get('packId') || '',
            brandId: url.searchParams.get('brandId') || '',
        }));
        return;
    }

    if (pathname === '/api/assets' && req.method === 'GET') {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        sendJson(res, 200, await AssetStore.listAssets({
            packId: url.searchParams.get('packId') || '',
            brandId: url.searchParams.get('brandId') || '',
            class: url.searchParams.get('class') || '',
            state: url.searchParams.get('state') || '',
            status: url.searchParams.get('status') || '',
            operation: url.searchParams.get('operation') || '',
            verified: url.searchParams.get('verified') || '',
            q: url.searchParams.get('q') || '',
            limit: url.searchParams.get('limit') || '60',
            offset: url.searchParams.get('offset') || '0',
        }));
        return;
    }

    if (pathname === '/api/assets/ingest' && req.method === 'POST') {
        const body = await readJsonRequest(req, 220 * 1024 * 1024);
        sendJson(res, 201, await AssetStore.ingestAssets(body));
        return;
    }

    if (pathname === '/api/assets/index-pack' && req.method === 'POST') {
        const body = await readJsonRequest(req);
        if (!body?.packId) throw httpError(400, 'A pack id is required.');
        sendJson(res, 200, await AssetStore.indexPack(String(body.packId)));
        return;
    }

    if (pathname === '/api/assets/usage' && req.method === 'POST') {
        const body = await readJsonRequest(req);
        sendJson(res, 200, await AssetStore.recordUsage(body?.events || []));
        return;
    }

    const assetMatch = pathname.match(/^\/api\/assets\/(ast_[A-Za-z0-9_-]{1,72})(?:\/(verify|master|classify|usage)|\/operations\/([a-z-]+)|\/file\/([A-Za-z0-9_-]{1,40}))?$/);
    if (assetMatch) {
        const id = assetMatch[1];
        const action = assetMatch[2] || '';
        const operation = assetMatch[3] || '';
        const variant = assetMatch[4] || '';
        if (!action && !operation && !variant && req.method === 'GET') {
            sendJson(res, 200, { asset: await AssetStore.readAsset(id) });
            return;
        }
        if (!action && !operation && !variant && req.method === 'PATCH') {
            const body = await readJsonRequest(req);
            sendJson(res, 200, { asset: await AssetStore.patchAsset(id, body || {}) });
            return;
        }
        if (!action && !operation && !variant && req.method === 'DELETE') {
            const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            sendJson(res, 200, await AssetStore.deleteAsset(id, url.searchParams.get('purge') === '1'));
            return;
        }
        if (action === 'verify' && req.method === 'POST') {
            const body = await readJsonRequest(req);
            sendJson(res, 200, { asset: await AssetStore.verifyAsset(id, body?.state, body?.note) });
            return;
        }
        if (action === 'usage' && req.method === 'GET') {
            sendJson(res, 200, await AssetStore.assetUsage(id));
            return;
        }
        if (action === 'master' && req.method === 'POST') {
            const body = await readJsonRequest(req);
            const master = await AssetStore.readAsset(id);
            master.master = { isMaster: true, of: null };
            await AssetStore.saveAsset(master);
            const linked = [];
            for (const otherId of (Array.isArray(body?.of) ? body.of : []).slice(0, 50)) {
                if (!/^ast_/.test(String(otherId)) || otherId === id) continue;
                try {
                    const other = await AssetStore.readAsset(otherId);
                    other.master = { isMaster: false, of: id };
                    await AssetStore.saveAsset(other);
                    linked.push(otherId);
                } catch { /* ignore */ }
            }
            sendJson(res, 200, { master: master.id, linked });
            return;
        }
        if (action === 'classify' && req.method === 'POST') {
            const body = await readJsonRequest(req);
            const analyzed = await AssetStore.analyzeAsset(id);
            let asset = analyzed.asset;
            let warning = analyzed.warning || '';
            let classification = null;
            const shouldClassify = body?.force || asset.class === 'unclassified';
            if (shouldClassify) {
                try {
                    const llm = await getLlmCatalog();
                    if (!llm.available) throw new Error(llm.error || 'No local vision model is available.');
                    const model = resolveModelId(body?.model, llm.defaults.vision, llm.models, { vision: true });
                    const file = AssetStore.resolveFile(asset, 'original');
                    const stat = await fsp.stat(file.path);
                    if (stat.size > MAX_VISION_IMAGE_BYTES) throw new Error('The image is too large for the vision model.');
                    const image = (await fsp.readFile(file.path)).toString('base64');
                    const classes = require('./src/shared/asset-intel.js').CLASSES.filter((value) => value !== 'unclassified');
                    const prompt = [
                        'Classify this business asset for a brand asset library.',
                        `Allowed classes: ${classes.join(', ')}.`,
                        'Return JSON only: {"class":"...","role":"photo|logo|cover|menu|document|specimen","tags":["..."],"caption":"...","confidence":0.0}',
                        'Never choose brand-identity unless the image is a logo, wordmark, palette or type specimen.',
                    ].join(' ');
                    const result = await callOllama(model, [{
                        role: 'user', content: prompt, images: [image],
                    }], { temperature: 0.1, numPredict: 300, numCtx: 8192 });
                    classification = extractJsonObject(result?.message?.content);
                    if (!classification || !classes.includes(classification.class)) {
                        throw new Error('The vision model returned no usable class.');
                    }
                    asset = await AssetStore.patchAsset(asset.id, {
                        class: classification.class,
                        role: String(classification.role || asset.role).slice(0, 40),
                        tags: Array.isArray(classification.tags)
                            ? classification.tags.map((tag) => String(tag).slice(0, 32)).slice(0, 12)
                            : asset.tags,
                    });
                    warning = `Classified as ${classification.class}${classification.confidence != null
                        ? ` (${Math.round(Number(classification.confidence) * 100)}% confidence)` : ''}. Confirm in review.`;
                } catch (error) {
                    warning = analysisUnavailable(error.message);
                }
            }
            sendJson(res, 200, { asset, warning, classification });
            return;
        }
        if (operation && req.method === 'POST') {
            const body = await readJsonRequest(req);
            const result = await AssetStore.runOperation(id, operation, body?.params || {});
            sendJson(res, 201, result);
            return;
        }
        if (variant && req.method === 'GET') {
            const asset = await AssetStore.readAsset(id);
            const file = AssetStore.resolveFile(asset, variant);
            let stat;
            try { stat = await fsp.stat(file.path); } catch { throw httpError(404, 'Asset file not found.'); }
            res.writeHead(200, {
                'Content-Type': AssetStore.mimeFor(file.format),
                'Content-Length': stat.size,
                'Cache-Control': 'no-store',
            });
            fs.createReadStream(file.path).pipe(res);
            return;
        }
        throw httpError(405, 'Method not allowed for this asset action.');
    }

    if (pathname === '/api/admin/groups' && (req.method === 'GET' || req.method === 'PUT')) {
        requireAdmin(req);
        if (req.method === 'GET') {
            sendJson(res, 200, await groupSettingsPayload());
            return;
        }
        const body = await readJsonRequest(req);
        const packs = await listBrandPacks();
        const known = new Set(packs.map((pack) => pack.id));
        const brandRefs = new Set();
        packs.forEach((pack) => (pack.brands || []).forEach((brand) => brandRefs.add(`${pack.id}::${brand.id}`)));
        const order = [...new Set((Array.isArray(body?.order) ? body.order : [])
            .map((entry) => String(entry || ''))
            .filter((id) => known.has(id)))];
        const hidden = [...new Set((Array.isArray(body?.hidden) ? body.hidden : [])
            .map((entry) => String(entry || ''))
            .filter((id) => known.has(id)))];
        const hiddenBrands = [...new Set((Array.isArray(body?.hiddenBrands) ? body.hiddenBrands : [])
            .map((entry) => String(entry || ''))
            .filter((ref) => brandRefs.has(ref)))];
        const socialCrawler = [...new Set((Array.isArray(body?.socialCrawler) ? body.socialCrawler : [])
            .map((entry) => String(entry || ''))
            .filter((ref) => brandRefs.has(ref)))];
        if (hidden.length >= known.size && known.size) {
            throw httpError(400, 'Keep at least one group visible.');
        }
        const hiddenRefSet = new Set(hiddenBrands);
        for (const pack of packs) {
            if (hidden.includes(pack.id) || !(pack.brands || []).length) continue;
            const visibleBrands = pack.brands.filter((brand) => !hiddenRefSet.has(`${pack.id}::${brand.id}`));
            if (!visibleBrands.length) {
                throw httpError(400, `Every business in “${pack.name}” is hidden. Hide the whole group instead.`);
            }
        }
        const settings = await writeGroupSettings({ order, hidden, hiddenBrands, socialCrawler });
        sendJson(res, 200, {
            packs: applyGroupSettings(packs, settings, true),
            settings,
            adminKeyConfigured: Boolean(ADMIN_KEY),
        });
        return;
    }

    if (pathname === '/api/brand-packs' && req.method === 'GET') {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const includeHidden = url.searchParams.get('all') === '1';
        if (includeHidden) requireAdmin(req);
        const [packs, settings] = await Promise.all([listBrandPacks(), readGroupSettings()]);
        sendJson(res, 200, {
            packs: applyGroupSettings(packs, settings, includeHidden),
            hiddenCount: settings.hidden.length,
        });
        return;
    }

    if (pathname === '/api/brand-packs/import' && req.method === 'POST') {
        const body = await readBody(req, MAX_BRAND_PACK_ZIP * 2);
        let payload;
        try {
            payload = JSON.parse(body.toString('utf8'));
        } catch {
            throw httpError(400, 'The brand pack import must be valid JSON.');
        }
        sendJson(res, 201, await createBrandPackImport(payload || {}));
        return;
    }

    const brandPackFileMatch = pathname.match(/^\/api\/brand-packs\/([A-Za-z0-9_-]{1,80})\/files\/(.+)$/);
    if (brandPackFileMatch && req.method === 'GET') {
        const packId = brandPackFileMatch[1];
        const relative = safeRelativePath(brandPackFileMatch[2]);
        if (!relative) throw httpError(400, 'Invalid brand pack asset path.');
        const filesRoot = path.join(BRAND_PACKS_DIR, packId, 'files') + path.sep;
        const target = path.join(filesRoot, ...relative.split('/'));
        if (!path.resolve(target).startsWith(filesRoot)) throw httpError(400, 'Invalid brand pack asset path.');
        let data;
        try {
            data = await fsp.readFile(target);
        } catch (error) {
            if (error.code === 'ENOENT') throw httpError(404, 'Brand pack asset not found.');
            throw error;
        }
        const extension = path.extname(target).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME[extension] || 'application/octet-stream',
            'Content-Length': data.length,
            'Cache-Control': 'public, max-age=3600',
        });
        res.end(data);
        return;
    }

    const savedTemplateFileMatch = pathname.match(/^\/api\/brand-packs\/([A-Za-z0-9_-]{1,80})\/templates\/([A-Za-z0-9_-]{1,80})\/([A-Za-z0-9_-]{1,100})\/files\/(.+)$/);
    if (savedTemplateFileMatch && req.method === 'GET') {
        const [, packId, brandId, templateId, relative] = savedTemplateFileMatch;
        const target = savedTemplateAssetPath(packId, brandId, templateId, relative);
        if (!target) throw httpError(400, 'Invalid template asset path.');
        const extension = path.extname(target).toLowerCase();
        if (!IMPORT_PUBLIC_FILE.test(extension)) throw httpError(403, 'Template assets must be images or video.');
        let data;
        try {
            data = await fsp.readFile(target);
        } catch (error) {
            if (error.code === 'ENOENT') throw httpError(404, 'Template asset not found.');
            throw error;
        }
        res.writeHead(200, {
            'Content-Type': MIME[extension] || 'application/octet-stream',
            'Content-Length': data.length,
            'Cache-Control': 'public, max-age=3600',
        });
        res.end(data);
        return;
    }

    const savedTemplateOpenMatch = pathname.match(/^\/api\/brand-packs\/([A-Za-z0-9_-]{1,80})\/templates\/([A-Za-z0-9_-]{1,80})\/([A-Za-z0-9_-]{1,100})\/open$/);
    if (savedTemplateOpenMatch && req.method === 'POST') {
        const body = await readBody(req, 1024 * 1024);
        let payload = {};
        if (body.length) {
            try {
                payload = JSON.parse(body.toString('utf8'));
            } catch {
                throw httpError(400, 'The open request must be valid JSON.');
            }
        }
        sendJson(res, 201, await openSavedBrandTemplate(
            savedTemplateOpenMatch[1],
            savedTemplateOpenMatch[2],
            savedTemplateOpenMatch[3],
            payload || {},
        ));
        return;
    }

    const savedTemplateMatch = pathname.match(/^\/api\/brand-packs\/([A-Za-z0-9_-]{1,80})\/templates\/([A-Za-z0-9_-]{1,80})\/([A-Za-z0-9_-]{1,100})$/);
    if (savedTemplateMatch && req.method === 'GET') {
        const record = await readSavedBrandTemplateRecord(savedTemplateMatch[1], savedTemplateMatch[2], savedTemplateMatch[3]);
        sendJson(res, 200, { ...savedTemplateSummary(record), composition: record.composition });
        return;
    }
    if (savedTemplateMatch && req.method === 'DELETE') {
        sendJson(res, 200, await deleteSavedBrandTemplate(savedTemplateMatch[1], savedTemplateMatch[2], savedTemplateMatch[3]));
        return;
    }

    const savedTemplateSaveMatch = pathname.match(/^\/api\/brand-packs\/([A-Za-z0-9_-]{1,80})\/templates\/save$/);
    if (savedTemplateSaveMatch && req.method === 'POST') {
        const body = await readBody(req, MAX_COMPOSITION_BYTES + 1024 * 1024);
        let payload;
        try {
            payload = JSON.parse(body.toString('utf8'));
        } catch {
            throw httpError(400, 'The save request must be valid JSON.');
        }
        sendJson(res, 201, await saveBrandTemplate(savedTemplateSaveMatch[1], payload || {}));
        return;
    }

    const brandPackTemplateMatch = pathname.match(/^\/api\/brand-packs\/([A-Za-z0-9_-]{1,80})\/templates$/);
    if (brandPackTemplateMatch) {
        if (req.method === 'GET') {
            const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            sendJson(res, 200, await listBrandTemplates(brandPackTemplateMatch[1], {
                brandId: url.searchParams.get('brandId') || '',
            }));
            return;
        }
        if (req.method === 'POST') {
            const body = await readBody(req, 4 * 1024 * 1024);
            let payload;
            try {
                payload = JSON.parse(body.toString('utf8'));
            } catch {
                throw httpError(400, 'The template request must be valid JSON.');
            }
            sendJson(res, 201, await createBrandTemplateProject(brandPackTemplateMatch[1], payload || {}));
            return;
        }
    }

    const brandPackMatch = pathname.match(/^\/api\/brand-packs\/([A-Za-z0-9_-]{1,80})$/);
    if (brandPackMatch) {
        const packId = brandPackMatch[1];
        if (req.method === 'GET') {
            const result = await readBrandPack(packId);
            const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const includeHidden = url.searchParams.get('all') === '1' && isAdminRequest(req);
            if (includeHidden) {
                sendJson(res, 200, result);
            } else {
                const settings = await readGroupSettings();
                const filtered = applyPackSettings(result.pack, settings, false);
                if (!filtered.brands.length) throw httpError(404, 'Brand pack not found.');
                sendJson(res, 200, { ...result, pack: filtered });
            }
            return;
        }
        if (req.method === 'DELETE') {
            sendJson(res, 200, await deleteBrandPack(packId));
            return;
        }
    }

    if (pathname === '/api/brand-kits' && req.method === 'GET') {
        sendJson(res, 200, { kits: await listBrandKits() });
        return;
    }

    const brandKitMatch = pathname.match(/^\/api\/brand-kits\/([A-Za-z0-9_-]{1,80})$/);
    if (brandKitMatch) {
        const kitId = brandKitMatch[1];
        if (req.method === 'GET') {
            sendJson(res, 200, await readBrandKit(kitId));
            return;
        }
        if (req.method === 'PUT') {
            const body = await readBody(req, MAX_BRAND_KIT_BYTES * 2);
            let payload;
            try {
                payload = JSON.parse(body.toString('utf8'));
            } catch {
                throw httpError(400, 'The brand kit must be valid JSON.');
            }
            sendJson(res, 200, await saveBrandKit(kitId, payload));
            return;
        }
        if (req.method === 'DELETE') {
            sendJson(res, 200, await deleteBrandKit(kitId));
            return;
        }
    }

    if (pathname === '/api/briefs/parse' && req.method === 'POST') {
        const body = await readBody(req, MAX_BRIEF_BYTES * 2);
        let payload;
        try {
            payload = JSON.parse(body.toString('utf8'));
        } catch {
            throw httpError(400, 'The brief upload must be valid JSON.');
        }
        const dataUrl = typeof payload?.dataUrl === 'string' ? payload.dataUrl : '';
        const match = dataUrl.match(/^data:[^;,]*;base64,([A-Za-z0-9+/=]+)$/);
        if (!match) throw httpError(400, 'Send the brief as a base64 data URL.');
        sendJson(res, 200, parseBriefFile(
            payload?.name,
            Buffer.from(match[1], 'base64'),
            { sheet: typeof payload?.sheet === 'string' ? payload.sheet : '' },
        ));
        return;
    }

    if (pathname === '/api/fonts' && req.method === 'POST') {
        const body = await readBody(req, MAX_FONT_BYTES * 2);
        let payload;
        try {
            payload = JSON.parse(body.toString('utf8'));
        } catch {
            throw httpError(400, 'The font upload must be valid JSON.');
        }
        sendJson(res, 201, await saveFont(payload || {}));
        return;
    }

    if (pathname === '/api/fonts' && req.method === 'GET') {
        sendJson(res, 200, { fonts: await listFonts() });
        return;
    }

    if (pathname.startsWith('/api/fonts/') && req.method === 'GET') {
        const relative = decodeURIComponent(pathname.slice('/api/fonts/'.length));
        if (!FONT_NAME.test(relative)) throw httpError(400, 'Invalid font path.');
        let data;
        try {
            data = await fsp.readFile(path.join(FONTS_DIR, relative));
        } catch {
            throw httpError(404, 'Font not found.');
        }
        const format = FONT_FORMATS.find((item) => relative.toLowerCase().endsWith(`.${item.ext}`));
        res.writeHead(200, {
            'Content-Type': format ? format.mime : 'application/octet-stream',
            'Content-Length': data.length,
            'Cache-Control': 'public, max-age=31536000, immutable',
        });
        res.end(data);
        return;
    }

    if (pathname === '/api/segments/organize' && req.method === 'POST') {
        const body = await readBody(req, MAX_ORGANIZER_BODY);
        let payload;
        try {
            payload = JSON.parse(body.toString('utf8'));
        } catch {
            throw httpError(400, 'The segment-organization request must be valid JSON.');
        }
        sendJson(res, 200, await organizeSegments(payload || {}));
        return;
    }

    if (pathname === '/api/segments/texture' && req.method === 'POST') {
        const payload = await readJsonRequest(req, MAX_SEGMENT_TEXTURE_BODY);
        sendJson(res, 200, { image: await generateSegmentTexture(payload || {}) });
        return;
    }

    const proposalMatch = pathname.match(/^\/api\/imports\/([A-Za-z0-9_-]{1,80})\/proposals$/);
    if (proposalMatch) {
        const id = proposalMatch[1];
        if (req.method === 'GET') {
            const composition = await readSavedComposition(id);
            const saved = await readProposalsFile(id);
            sendJson(res, 200, {
                context: composition.meta?.context || '',
                generatedAt: saved?.generatedAt || null,
                models: saved?.models || null,
                analysis: saved?.analysis || null,
                proposals: Array.isArray(saved?.proposals) ? saved.proposals : [],
            });
            return;
        }
        if (req.method === 'POST') {
            const body = await readBody(req);
            let payload;
            try {
                payload = JSON.parse(body.toString('utf8'));
            } catch {
                throw httpError(400, 'The animation-idea request must be valid JSON.');
            }
            sendJson(res, 200, await generateDirectorIdeas(id, payload || {}));
            return;
        }
    }

    const contextMatch = pathname.match(/^\/api\/imports\/([A-Za-z0-9_-]{1,80})\/context$/);
    if (contextMatch && req.method === 'PUT') {
        const body = await readBody(req);
        let payload;
        try {
            payload = JSON.parse(body.toString('utf8'));
        } catch {
            throw httpError(400, 'The context request must be valid JSON.');
        }
        const composition = await updateProjectContext(
            contextMatch[1],
            String(payload?.context || ''),
            payload?.director || null,
        );
        sendJson(res, 200, {
            ok: true,
            context: composition.meta.context,
            director: composition.meta.director || null,
        });
        return;
    }

    if (pathname === '/api/imports' && req.method === 'GET') {
        sendJson(res, 200, { projects: await listImports() });
        return;
    }

    if (pathname === '/api/animation-library' && req.method === 'GET') {
        sendJson(res, 200, await readStudioAnimationLibrary());
        return;
    }

    if (pathname === '/api/animation-library' && req.method === 'POST') {
        const body = await readBody(req);
        let payload;
        try {
            payload = JSON.parse(body.toString('utf8'));
        } catch {
            throw httpError(400, 'The animation must be valid JSON.');
        }
        sendJson(res, 201, await saveStudioAnimation(payload || {}));
        return;
    }

    const studioAnimationMatch = pathname.match(/^\/api\/animation-library\/([A-Za-z0-9_-]{1,80})$/);
    if (studioAnimationMatch && req.method === 'DELETE') {
        sendJson(res, 200, await deleteStudioAnimation(studioAnimationMatch[1]));
        return;
    }

    if (pathname === '/api/projects' && req.method === 'GET') {
        sendJson(res, 200, { projects: await listStudioProjects() });
        return;
    }

    const projectArchiveMatch = pathname.match(
        /^\/api\/projects\/((?:repo|import)-[A-Za-z0-9_-]{1,80})\/archive$/,
    );
    if (projectArchiveMatch && req.method === 'PATCH') {
        const body = await readBody(req);
        let payload;
        try {
            payload = JSON.parse(body.toString('utf8'));
        } catch {
            throw httpError(400, 'The project archive request must be valid JSON.');
        }
        if (typeof payload?.archived !== 'boolean') {
            throw httpError(400, 'The project archive request must include a boolean "archived" value.');
        }
        sendJson(res, 200, await setStudioProjectArchived(projectArchiveMatch[1], payload.archived));
        return;
    }

    // Repository project assets are deliberately not served from /data (that
    // tree also holds imports, brand packs and secrets). This route exposes
    // only data/projects/<project>/assets/ so a checked-in composition can
    // reference its own PNGs without embedding data URLs.
    const projectAssetMatch = pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]{1,80})\/assets\/(.+)$/);
    if (projectAssetMatch && (req.method === 'GET' || req.method === 'HEAD')) {
        const target = resolveProjectAssetPath(projectAssetMatch[1], projectAssetMatch[2]);
        if (!target) throw httpError(403, 'Invalid project asset path.');
        sendFile(req, res, target);
        return;
    }

    const animationsMatch = pathname.match(/^\/api\/imports\/([A-Za-z0-9_-]{1,80})\/animations$/);
    if (animationsMatch) {
        const id = animationsMatch[1];
        if (req.method === 'GET') {
            sendJson(res, 200, await readAnimations(id));
            return;
        }
        if (req.method === 'PUT') {
            const body = await readBody(req);
            let payload;
            try {
                payload = JSON.parse(body.toString('utf8'));
            } catch {
                throw httpError(400, 'The animation library must be valid JSON.');
            }
            sendJson(res, 200, await saveAnimations(id, payload));
            return;
        }
    }

    const studioCompositionMatch = pathname.match(
        /^\/api\/projects\/([A-Za-z0-9_-]{1,90})\/compositions\/([A-Za-z0-9_-]{1,80})$/,
    );
    if (studioCompositionMatch && req.method === 'GET') {
        sendJson(res, 200, await readStudioComposition(studioCompositionMatch[1], studioCompositionMatch[2]));
        return;
    }

    if (pathname === '/api/imports/character' && req.method === 'POST') {
        const body = await readBody(req);
        let payload;
        try {
            payload = JSON.parse(body.toString('utf8'));
        } catch {
            throw httpError(400, 'The character import request must be valid JSON.');
        }
        const result = await createCharacterImport(payload || {});
        sendJson(res, 201, result);
        return;
    }

    if (pathname === '/api/imports/copy' && req.method === 'POST') {
        const body = await readBody(req);
        let payload;
        try {
            payload = JSON.parse(body.toString('utf8'));
        } catch {
            throw httpError(400, 'The copy request must be valid JSON.');
        }
        sendJson(res, 201, await createRepositoryCopy(payload || {}));
        return;
    }

    if (pathname === '/api/imports' && req.method === 'POST') {
        const body = await readBody(req);
        let payload;
        try {
            payload = JSON.parse(body.toString('utf8'));
        } catch {
            throw httpError(400, 'The import request must be valid JSON.');
        }
        const result = await createImport(payload || {});
        sendJson(res, 201, result);
        return;
    }

    const match = pathname.match(/^\/api\/imports\/([A-Za-z0-9_-]{1,80})\/composition\.json$/);
    if (match) {
        const id = match[1];
        if (req.method === 'GET') {
            sendJson(res, 200, await readSavedComposition(id));
            return;
        }
        if (req.method === 'PUT') {
            const body = await readBody(req);
            let payload;
            try {
                payload = JSON.parse(body.toString('utf8'));
            } catch {
                throw httpError(400, 'The save request must be valid JSON.');
            }
            const result = await saveComposition(id, payload);
            sendJson(res, 200, {
                ok: true,
                updatedAt: result.meta.updatedAt,
                project: {
                    id,
                    name: result.composition.name,
                    updatedAt: result.meta.updatedAt,
                    width: result.composition.width,
                    height: result.composition.height,
                    layerCount: result.composition.layers.filter((layer) => layer.rig !== true).length,
                    referenceUrl: result.meta.referenceUrl || null,
                },
            });
            return;
        }
    }

    throw httpError(404, 'API route not found.');
}

const PAGES_DIR = path.join(ROOT, 'pages');
const PAGE_ROUTES = {
    '/': 'studio-v2.html',
    '/studio': 'studio-v2.html',
    '/studio-v2': 'studio-v2.html',
    '/studio-v2.html': 'studio-v2.html',
    '/studio.html': 'studio.html',
    '/studio-agent': 'studio-agent.html',
    '/studio-agent.html': 'studio-agent.html',
    '/agent-first-studio': 'agent-first-studio.html',
    '/agent-first-studio.html': 'agent-first-studio.html',
    '/studio-import': 'studio-import.html',
    '/studio-import.html': 'studio-import.html',
    '/asset-studio': 'asset-studio.html',
    '/asset-studio.html': 'asset-studio.html',
    '/crawler': 'crawler.html',
    '/crawler.html': 'crawler.html',
    '/library': 'library.html',
    '/library.html': 'library.html',
    '/voice': 'voice.html',
    '/voice.html': 'voice.html',
    '/social': 'social.html',
    '/social.html': 'social.html',
    '/admin': 'admin.html',
    '/manage': 'admin.html',
    '/admin.html': 'admin.html',
};

const LEGACY_ASSETS = {
    '/_.js': 'src/client/shared/_.js',
    '/_.css': 'src/client/shared/_.css',
    '/studio-core.js': 'src/shared/studio-core.js',
    '/brand-pack.js': 'src/shared/brand-pack.js',
    '/asset-intel.js': 'src/shared/asset-intel.js',
    '/studio-v2.js': 'src/client/studio/studio-v2.js',
    '/brand-identity.js': 'src/client/brand/brand-identity.js',
    '/brand-identity.css': 'src/client/brand/brand-identity.css',
    '/crawler.js': 'src/client/crawler/crawler.js',
    '/crawler.css': 'src/client/crawler/crawler.css',
    '/library.js': 'src/client/library/library.js',
    '/library.css': 'src/client/library/library.css',
    '/social.js': 'src/client/social/social.js',
    '/social.css': 'src/client/social/social.css',
    '/voice.js': 'src/client/voice/voice.js',
    '/voice.css': 'src/client/voice/voice.css',
    '/admin.js': 'src/client/admin/admin.js',
    '/admin.css': 'src/client/admin/admin.css',
    '/tts-config.mjs': 'src/server/voice/tts-config.mjs',
    '/tts-server.mjs': 'src/server/voice/tts-server.mjs',
    '/voice-design-agent.mjs': 'src/server/voice/voice-design-agent.mjs',
};

const LEGACY_PREFIXES = [
    ['/asset-studio/', 'src/client/asset-studio/'],
    ['/studio-minimal/', 'src/client/studio/studio-minimal/'],
];

/**
 * A created template copies the brand assets it references into its own import
 * folder; its layers point at /data/imports/<id>/... so the creative survives
 * the brand pack being deleted. The /data tree stays private (composition JSON,
 * source ZIPs, brand kits, settings), but the raster/media files inside an
 * import are exactly what the canvas needs. Only these extensions are exposed.
 */
const IMPORT_PUBLIC_FILE = /\.(?:png|jpe?g|gif|webp|svg|avif|mp4|webm)$/i;

function importPublicFile(pathname) {
    const match = pathname.match(/^\/data\/imports\/([A-Za-z0-9_-]{1,80})\/(.+)$/);
    if (!match || !IMPORT_PUBLIC_FILE.test(match[2])) return null;
    const target = path.join(IMPORTS_DIR, match[1], ...match[2].split('/'));
    const root = path.resolve(IMPORTS_DIR) + path.sep;
    return path.resolve(target).startsWith(root) ? target : null;
}

function projectPublicFile(pathname) {
    const match = pathname.match(/^\/data\/projects\/([A-Za-z0-9_-]{1,80})\/(assets|images)\/(.+)$/);
    if (!match || !IMPORT_PUBLIC_FILE.test(match[3])) return null;
    const relative = safeRelativePath(match[3]);
    if (!relative) return null;
    const projectRoot = path.join(PROJECTS_DIR, match[1]);
    const target = path.resolve(projectRoot, match[2], ...relative.split('/'));
    return target.startsWith(path.resolve(projectRoot) + path.sep) ? target : null;
}

function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Method not allowed.');
        return;
    }
    // A read-only window onto the assets a created template needs.
    const importFile = importPublicFile(pathname);
    if (importFile) {
        sendFile(req, res, importFile);
        return;
    }
    const projectFile = projectPublicFile(pathname);
    if (projectFile) {
        sendFile(req, res, projectFile);
        return;
    }
    // Never serve local state, secrets or test/dev material as static files.
    const privatePath = pathname === '/.env'
        || pathname === '/server.js'
        || pathname.startsWith('/.')
        || ['/data', '/_dev', '/tests', '/tools', '/scripts', '/.git']
            .some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    if (privatePath) {
        sendText(res, 404, 'File not found.');
        return;
    }
    // HTML entry points live in pages/; their URLs stay at the root.
    const page = PAGE_ROUTES[pathname];
    if (page) {
        sendFile(req, res, path.join(PAGES_DIR, page));
        return;
    }
    if (pathname.startsWith('/pages/')) {
        const name = pathname.slice('/pages/'.length);
        if (PAGE_ROUTES[`/${name}`]) {
            res.writeHead(302, { Location: `/${name}`, 'Cache-Control': 'no-store' });
            res.end();
            return;
        }
        sendText(res, 404, 'File not found.');
        return;
    }
    // Old root asset URLs keep working after the move under src/.
    const legacy = LEGACY_ASSETS[pathname];
    const prefix = LEGACY_PREFIXES.find(([from]) => pathname.startsWith(from));
    const relative = legacy
        || (prefix ? prefix[1] + pathname.slice(prefix[0].length) : pathname.replace(/^\/+/, ''));
    sendFile(req, res, path.join(ROOT, relative));
}

function sendFile(req, res, target) {
    let resolved;
    try {
        resolved = path.resolve(target);
    } catch {
        sendText(res, 400, 'Bad request.');
        return;
    }
    if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
        sendText(res, 403, 'Forbidden.');
        return;
    }
    target = resolved;
    fs.stat(target, (error, stat) => {
        if (error || !stat.isFile()) {
            sendText(res, 404, 'File not found.');
            return;
        }
        const headers = {
            'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
            'Content-Length': stat.size,
            'Cache-Control': 'no-store',
        };
        res.writeHead(200, headers);
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        const stream = fs.createReadStream(target);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
    });
}

async function handle(req, res) {
    let pathname;
    try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        pathname = decodeURIComponent(url.pathname);
    } catch {
        sendText(res, 400, 'Bad request.');
        return;
    }
    try {
        if (pathname.startsWith('/api/')) {
            await handleApi(req, res, pathname);
            return;
        }
        if (pathname === '/favicon.ico') {
            res.writeHead(204, { 'Cache-Control': 'public, max-age=86400' });
            res.end();
            return;
        }
        serveStatic(req, res, pathname);
    } catch (error) {
        const status = error.status || 500;
        if (status >= 500) console.error('[studio] request failed:', error);
        if (res.headersSent) {
            res.destroy();
            return;
        }
        if (pathname.startsWith('/api/')) {
            sendJson(res, status, { error: error.message || 'Request failed.' });
        } else {
            sendText(res, status, error.message || 'Request failed.');
        }
    }
}

async function main() {
    await fsp.mkdir(IMPORTS_DIR, { recursive: true });
    await fsp.mkdir(BRAND_PACKS_DIR, { recursive: true });
    await fsp.mkdir(BRAND_KITS_DIR, { recursive: true });
    await fsp.mkdir(SETTINGS_DIR, { recursive: true });
    const server = http.createServer((req, res) => { handle(req, res); });
    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`[studio] port ${PORT} is already in use. Try PORT=${PORT + 1} node server.js`);
        } else {
            console.error('[studio] server error:', error);
        }
        process.exit(1);
    });
    server.listen(PORT, HOST, () => {
        console.log(`[studio] LayerStudio running at http://${HOST}:${PORT}/studio.html`);
        console.log(`[studio] Asset Studio running at http://${HOST}:${PORT}/asset-studio.html`);
        console.log(`[studio] Brand intake running at http://${HOST}:${PORT}/crawler.html`);
        console.log(`[studio] Asset library running at http://${HOST}:${PORT}/library.html`);
        console.log(`[studio] Voice Studio running at http://${HOST}:${PORT}/voice.html`);
        console.log(`[studio] Social intelligence running at http://${HOST}:${PORT}/social.html`);
        console.log(`[studio] Management (dev only) running at http://${HOST}:${PORT}/admin.html`);
        console.log(`[studio] imports stored in ${IMPORTS_DIR}`);
        console.log(`[studio] brand packs stored in ${BRAND_PACKS_DIR}`);
    });
}

if (require.main === module) {
    main().catch((error) => {
        console.error('[studio] failed to start:', error);
        process.exit(1);
    });
}

module.exports = {
    readZipEntries,
    extractZipEntry,
    detectImageFormat,
    readImageSize,
    buildComposition,
    detectCharacters,
    defaultCharacterSettings,
    normalizeProposalCharacters,
    safeRelativePath,
    resolveProjectAssetPath,
    listStudioProjects,
    setStudioProjectArchived,
    readStudioComposition,
    createImport,
    createCharacterImport,
    listImports,
    readSavedComposition,
    saveComposition,
    importPublicFile,
    projectPublicFile,
    readAnimations,
    saveAnimations,
    readStudioAnimationLibrary,
    saveStudioAnimation,
    deleteStudioAnimation,
    getLlmCatalog,
    getAnimationDirectorCatalog,
    getDeepSeekDirectorStatus,
    isVisionModel,
    supportsThinking,
    buildWriterPrompt,
    buildDirectorCatalog,
    detectFontFormat,
    transcodeVideoToMp4,
    saveFont,
    listFonts,
    parseBriefFile,
    readXlsxSheet,
    listBrandPacks,
    readBrandPack,
    deleteBrandPack,
    createBrandPackImport,
    createBrandTemplateProject,
    listBrandTemplates,
    saveBrandTemplate,
    openSavedBrandTemplate,
    deleteSavedBrandTemplate,
    savedTemplateAssetPath,
    listBrandKits,
    readBrandKit,
    saveBrandKit,
    deleteBrandKit,
    normalizeDirectorProposals,
    generateDirectorIdeas,
};