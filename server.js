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
 *   PORT=8008 HOST=127.0.0.1 node server.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const IMPORTS_DIR = path.join(DATA_DIR, 'imports');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const PORT = Number(process.env.PORT) || 8008;
const HOST = process.env.HOST || '127.0.0.1';

const MAX_BODY = 320 * 1024 * 1024;
const MAX_ZIP = 220 * 1024 * 1024;
const MAX_REFERENCE = 60 * 1024 * 1024;
const MAX_EXTRACTED = 640 * 1024 * 1024;
const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const MAX_COMPOSITION_BYTES = 24 * 1024 * 1024;
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
const PROPOSAL_TIMEOUT = 300000;
const LLM_DETECT_TIMEOUT = 5000;
let ollamaCache = { at: 0, value: null };

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
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
        const width = Math.max(1, Math.min(300, segment.width / reference.width * 100));
        const height = Math.max(1, Math.min(300, segment.height / reference.height * 100));
        const box = initialPlacement(stem, width, height);
        const depth = depthFor(stem);
        layers.push({
            id: layerIdFor(segment.relative, index),
            name: stem,
            role: roleFor(stem),
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
        });
    });

    layers.sort((a, b) => a.z - b.z);
    let z = 2;
    layers.forEach((layer) => {
        if (layer.id === 'reference') return;
        layer.z = z;
        z += 2;
    });

    const composition = {
        version: 1,
        id,
        name,
        width: reference.width,
        height: reference.height,
        duration: DEFAULT_DURATION,
        referenceLayerId: 'reference',
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
        for (const file of files) {
            const match = file.isFile() && file.name.match(/^([A-Za-z0-9_-]{1,80})\.composition\.json$/);
            if (!match) continue;
            try {
                const composition = JSON.parse(await fsp.readFile(path.join(compositionsDir, file.name), 'utf8'));
                compositions.push({
                    id: match[1],
                    name: composition.name || match[1],
                    kind: 'repository',
                });
            } catch (error) {
                console.warn(`[studio] could not read composition ${entry.name}/${file.name}:`, error.message);
            }
        }
        if (compositions.length) {
            compositions.sort((a, b) => a.name.localeCompare(b.name));
            projects.push({
                id: `repo-${entry.name}`,
                name: entry.name.replace(/[-_]+/g, ' '),
                compositions,
            });
        }
    }

    const imports = await listImports();
    imports.forEach((project) => {
        projects.push({
            id: `import-${project.id}`,
            name: project.name,
            compositions: [{ id: 'main', name: project.name, kind: 'import' }],
        });
    });
    projects.sort((a, b) => a.name.localeCompare(b.name));
    return projects;
}

async function readStudioComposition(projectId, compositionId) {
    const repoMatch = projectId.match(/^repo-([A-Za-z0-9_-]{1,80})$/);
    if (repoMatch && /^[A-Za-z0-9_-]{1,80}$/.test(compositionId)) {
        const file = path.join(PROJECTS_DIR, repoMatch[1], 'compositions', `${compositionId}.composition.json`);
        try {
            return JSON.parse(await fsp.readFile(file, 'utf8'));
        } catch (error) {
            if (error.code === 'ENOENT') throw httpError(404, 'Repository composition not found.');
            throw httpError(500, `Could not read the repository composition: ${error.message}`);
        }
    }

    const importMatch = projectId.match(/^import-([A-Za-z0-9_-]{1,80})$/);
    if (importMatch && compositionId === 'main') {
        return readSavedComposition(importMatch[1]);
    }
    throw httpError(404, 'Project composition not found.');
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
        return {
            ...layer,
            part: layer.part || prior.part || '',
            group: layer.group || prior.group || '',
            variant: layer.variant || prior.variant || '',
        };
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
        version: 1,
        id,
        name: sanitizeLabel(incoming.name, existing.name || 'Imported scene'),
        width: Number(incoming.width) || existing.width,
        height: Number(incoming.height) || existing.height,
        duration: Number(incoming.duration) || existing.duration || DEFAULT_DURATION,
        referenceLayerId: typeof incoming.referenceLayerId === 'string' ? incoming.referenceLayerId : null,
        characters,
        layers,
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
    const families = Array.isArray(model?.details?.families)
        ? model.details.families.map((family) => String(family).toLowerCase())
        : [];
    return families.includes('clip')
        || /(vision|llava|moondream|minicpm-v|qwen[^ ]*vl|gemma3)/i.test(name);
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
        if (error.name === 'AbortError') throw new Error('The local LLM took too long to respond.');
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
    if (think !== null && /qwen3|deepseek-r1|gpt-oss/i.test(model)) body.think = think;
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

async function callOpenAICompatible(model, messages) {
    const apiKey = process.env.STUDIO_OPENAI_API_KEY?.trim();
    const configuredModel = process.env.STUDIO_OPENAI_MODEL?.trim();
    if (!apiKey || !configuredModel || configuredModel !== model) {
        throw httpError(400, 'The selected remote model is not configured on the studio server.');
    }
    const baseUrl = (process.env.STUDIO_OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    let endpoint;
    try {
        endpoint = new URL(`${baseUrl}/chat/completions`);
    } catch {
        throw httpError(500, 'STUDIO_OPENAI_BASE_URL must be a valid URL.');
    }
    if (!['http:', 'https:'].includes(endpoint.protocol)) {
        throw httpError(500, 'STUDIO_OPENAI_BASE_URL must use HTTP or HTTPS.');
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
    return layers.map((layer, index) => ({
        alias: `L${String(index + 1).padStart(2, '0')}`,
        id: layer.id,
        name: layer.name,
        role: layer.role || 'prop',
        z: layer.z ?? index,
        x: Number(layer.x ?? 0),
        y: Number(layer.y ?? 0),
        w: Number(layer.w ?? 0),
        h: Number(layer.h ?? 0),
    }));
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

function buildWriterPrompt({ composition, context, analysis, catalog, count, retry }) {
    const inventory = catalog
        .map((layer) => `${layer.alias} | ${layer.name} | ${layer.role} | z=${layer.z} | box=${layer.x.toFixed(1)},${layer.y.toFixed(1)},${layer.w.toFixed(1)},${layer.h.toFixed(1)}`)
        .join('\n');
    const characters = Array.isArray(composition.characters) ? composition.characters : [];
    const characterInventory = characters.map((character) => {
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
        ? `\nCHARACTERS (id | name | available parts | current expression):\n${characterInventory}\n`
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

LAYER INVENTORY (alias | name | role | z | x,y,w,h):
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
    const llm = await getLlmCatalog();
    if (!llm.available) throw httpError(503, llm.error || 'The local LLM is unavailable.');
    const visionModel = resolveModelId(payload.visionModel, llm.defaults.vision, llm.models, { vision: true });
    const textModel = resolveModelId(payload.textModel, llm.defaults.text, llm.models);
    const image = payload.image
        ? decodeBase64(payload.image, 'Reference image').toString('base64')
        : await readReferenceBase64(composition);

    const visionPrompt = buildVisionPrompt(composition, context, catalog);
    const visionResult = await callOllama(visionModel, [{
        role: 'user',
        content: visionPrompt,
        images: [image],
    }], { temperature: 0.2, numPredict: 600, numCtx: 8192 });
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
        });
        const writerResult = await callOllama(textModel, [{
            role: 'user',
            content: writerPrompt,
        }], {
            temperature: attempt ? 0.2 : 0.45,
            numPredict: 2400,
            numCtx: 16384,
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
        models: { vision: visionModel, text: textModel },
        analysis,
        proposals,
    };
    await updateProjectContext(id, context, data.models);
    await writeFileAtomic(path.join(IMPORTS_DIR, id, 'proposals.json'), JSON.stringify(data, null, 2));
    return data;
}

// ─── Routing ──────────────────────────────────────────────────────────

async function handleApi(req, res, pathname) {
    if (pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true });
        return;
    }

    if (pathname === '/api/llm/models' && req.method === 'GET') {
        sendJson(res, 200, await getLlmCatalog());
        return;
    }

    if (pathname === '/api/llm/organizer-models' && req.method === 'GET') {
        sendJson(res, 200, await getOrganizerModelCatalog());
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

    if (pathname === '/api/projects' && req.method === 'GET') {
        sendJson(res, 200, { projects: await listStudioProjects() });
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

function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Method not allowed.');
        return;
    }
    let relative = pathname === '/' ? 'studio.html' : pathname.replace(/^\/+/, '');
    if (!relative) relative = 'studio.html';
    let target;
    try {
        target = path.resolve(ROOT, relative);
    } catch {
        sendText(res, 400, 'Bad request.');
        return;
    }
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
        sendText(res, 403, 'Forbidden.');
        return;
    }
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
        console.log(`[studio] imports stored in ${IMPORTS_DIR}`);
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
    createImport,
    createCharacterImport,
    listImports,
    readSavedComposition,
    saveComposition,
    readAnimations,
    saveAnimations,
    getLlmCatalog,
    buildDirectorCatalog,
    normalizeDirectorProposals,
    generateDirectorIdeas,
};