'use strict';
/**
 * Asset Studio canvas engine.
 *
 * This is the shared drawing engine from the generated ThePhysicianAssetStudio
 * tools, adapted for a brand-aware studio:
 *
 *   - palette, fonts, logo and photography come from the active brand;
 *   - the decorative motif (rod / glass / sprig / …) can be swapped;
 *   - rendering is decoupled from the original per-category HTML pages.
 *
 * The category configs in categories.js are plain classic scripts. They call
 * the helpers declared here by name (photo, stack, logoAt, …), so those names
 * must stay top-level.
 */

let S = null;
let X = null;
let U = 1;

const SERIF_STACK = 'Georgia, "Times New Roman", serif';
const SANS_STACK = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const DEFAULT_QR = '';

// ─── colour helpers ──────────────────────────────────────────────────

function normalizeHex(value) {
    const hex = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : '#000000';
}

function colorLuma(value) {
    const hex = normalizeHex(value);
    const number = parseInt(hex.slice(1), 16);
    const r = (number >> 16) & 255;
    const g = (number >> 8) & 255;
    const b = number & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const mix = (a, b, t) => {
    const p = (h) => [1, 3, 5].map((i) => parseInt(normalizeHex(h).substr(i, 2), 16));
    const A = p(a);
    const B = p(b);
    return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

const rgba = (hex, alpha) => {
    const n = parseInt(normalizeHex(hex).slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
};

const C = (token) => {
    if (!S || !S.pal) return token;
    const map = {
        ink: S.pal.ink,
        paper: S.pal.paper,
        accent: S.pal.accent,
        mute: mix(S.pal.ink, S.pal.paper, 0.4),
    };
    return map[token] || token;
};

// A design that floods the accent colour needs text that contrasts with the
// accent, not with the page ground. Palettes differ: The Marlborough's accent
// is a light chalk, while The Butterfly's is a dark raspberry.
const accentTextColor = () => {
    const rgb = (hex) => {
        const n = parseInt(normalizeHex(hex).slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const luminance = (hex) => {
        const [r, g, b] = rgb(hex);
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    const accent = luminance(C('accent'));
    const paper = luminance(C('paper'));
    const ink = luminance(C('ink'));
    return Math.abs(accent - paper) >= Math.abs(accent - ink) ? C('paper') : C('ink');
};

const T = (key) => {
    const value = S?.t?.[key];
    return value == null ? '' : String(value);
};

const fnt = (role, weight, size) => {
    const fonts = S?.fonts || {};
    const family = role === 'd' ? fonts.display : role === 'b' ? fonts.serif : fonts.sans;
    return `${weight || 400} ${size}px ${family || SANS_STACK}`;
};

// ─── text helpers ────────────────────────────────────────────────────

function tw(text, font, tracking) {
    X.font = font;
    return tracking
        ? [...text].reduce((total, character) => total + X.measureText(character).width + tracking, -tracking)
        : X.measureText(text).width;
}

function wrap(text, font, tracking, maxWidth) {
    const lines = [];
    String(text).split('\n').forEach((paragraph) => {
        let line = '';
        paragraph.split(' ').forEach((word) => {
            const candidate = line ? `${line} ${word}` : word;
            if (tw(candidate, font, tracking) > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = candidate;
            }
        });
        lines.push(line);
    });
    return lines;
}

function put(text, x, y, font, tracking, align, color) {
    X.font = font;
    X.fillStyle = color;
    X.textBaseline = 'middle';
    if (S && Array.isArray(S.boxes) && !S._inLogo && String(text).trim()) {
        const size = Number((String(font).match(/([0-9.]+)px/) || [])[1] || 0);
        if (size > 0) {
            const width = tw(text, font, tracking);
            const height = size * 1.18;
            const left = align === 'c' ? x - width / 2 : align === 'r' ? x - width : x;
            S.boxes.push({
                kind: 'text',
                text: String(text),
                x: left,
                y: y - height / 2,
                w: width,
                h: height,
                side: S._side || 'f',
            });
        }
    }
    if (!tracking) {
        X.textAlign = align === 'c' ? 'center' : align === 'r' ? 'right' : 'left';
        X.fillText(text, x, y);
        return;
    }
    X.textAlign = 'left';
    const width = tw(text, font, tracking);
    let cursor = align === 'c' ? x - width / 2 : align === 'r' ? x - width : x;
    [...text].forEach((character) => {
        X.fillText(character, cursor, y);
        cursor += X.measureText(character).width + tracking;
    });
}

const R = (x, y, width, height, color) => {
    X.fillStyle = C(color);
    X.fillRect(x, y, width, height);
};

function grad(x, y, width, height, color, startAlpha, endAlpha) {
    const gradient = X.createLinearGradient(0, y, 0, y + height);
    gradient.addColorStop(0, rgba(color, startAlpha));
    gradient.addColorStop(1, rgba(color, endAlpha));
    X.fillStyle = gradient;
    X.fillRect(x, y, width, height);
}

// ─── logo ────────────────────────────────────────────────────────────

const logoTintCache = new WeakMap();

function tintedLogo(image, color) {
    let cache = logoTintCache.get(image);
    if (!cache) {
        cache = new Map();
        logoTintCache.set(image, cache);
    }
    if (cache.has(color)) return cache.get(color);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width || 1;
    canvas.height = image.naturalHeight || image.height || 1;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    cache.set(color, canvas);
    return canvas;
}

function sampleBackground(x, y, width, height) {
    try {
        const transform = X.getTransform();
        const points = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]
            .map(([px, py]) => [
                transform.a * px + transform.c * py + transform.e,
                transform.b * px + transform.d * py + transform.f,
            ]);
        const left = Math.max(0, Math.floor(Math.min(...points.map((point) => point[0]))));
        const top = Math.max(0, Math.floor(Math.min(...points.map((point) => point[1]))));
        const right = Math.min(X.canvas.width, Math.ceil(Math.max(...points.map((point) => point[0]))));
        const bottom = Math.min(X.canvas.height, Math.ceil(Math.max(...points.map((point) => point[1]))));
        if (right - left < 2 || bottom - top < 2) return null;
        const data = X.getImageData(left, top, right - left, bottom - top).data;
        let total = 0;
        let alpha = 0;
        for (let index = 0; index < data.length; index += 28) {
            const a = data[index + 3] / 255;
            if (a < 0.05) continue;
            total += ((0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255) * a;
            alpha += a;
        }
        return alpha ? total / alpha : null;
    } catch {
        return null;
    }
}

function logoAt(x, y, height, color, align, maxFraction) {
    const image = S?.logoWordmark || S?.logoMark;
    let ink = C(color);
    if (image && (image.naturalWidth || image.width)) {
        const aspect = (image.naturalWidth || image.width) / (image.naturalHeight || image.height);
        let targetHeight = height * 1.18 * (S.logoScale || 1);
        let targetWidth = targetHeight * aspect;
        const maxWidth = (S._W || 1080) * (maxFraction || 0.7);
        if (targetWidth > maxWidth) {
            targetWidth = maxWidth;
            targetHeight = targetWidth / aspect;
        }
        const startX = align === 'c' ? x - targetWidth / 2 : align === 'r' ? x - targetWidth : x;
        const startY = y + (height - targetHeight) / 2;
        // A white logo over a bright photograph disappears. Sample the area it
        // will cover and fall back to the brand ink when the ground is light.
        if (colorLuma(ink) > 0.9) {
            const background = sampleBackground(startX, startY, targetWidth, targetHeight);
            if (background !== null && background > 0.58) {
                ink = colorLuma(S.pal.ink) < 0.55 ? S.pal.ink : '#111111';
            }
        }
        if (S && Array.isArray(S.boxes)) {
            S.boxes.push({
                kind: 'logo',
                text: String(S?.brandWordmark || 'Logo'),
                x: startX,
                y: startY,
                w: targetWidth,
                h: targetHeight,
                side: S._side || 'f',
            });
        }
        const tinted = tintedLogo(image, ink);
        X.save();
        if (colorLuma(ink) > 0.7) {
            X.shadowColor = 'rgba(0, 0, 0, 0.45)';
            X.shadowBlur = Math.max(3, height * 0.16);
            X.shadowOffsetY = Math.max(1, height * 0.02);
        }
        X.drawImage(tinted, startX, startY, targetWidth, targetHeight);
        X.restore();
        return;
    }
    const label = String(S?.brandWordmark || 'BRAND');
    let fontSize = height;
    let tracking = fontSize * 0.02;
    let font = `700 ${fontSize}px ${S?.fonts?.display || SERIF_STACK}`;
    let textWidth = tw(label, font, tracking);
    const maxWidth = (S?._W || 1080) * (maxFraction || 0.72);
    if (textWidth > maxWidth) {
        fontSize *= maxWidth / textWidth;
        tracking = fontSize * 0.02;
        font = `700 ${fontSize}px ${S?.fonts?.display || SERIF_STACK}`;
        textWidth = tw(label, font, tracking);
    }
    const boxHeight = fontSize * 1.18;
    if (S && Array.isArray(S.boxes)) {
        S.boxes.push({
            kind: 'logo',
            text: label,
            x,
            y: y + (height - boxHeight) / 2,
            w: textWidth,
            h: boxHeight,
            side: S._side || 'f',
        });
    }
    if (S) S._inLogo = true;
    put(label, x, y + height * 0.5, font, tracking, align, ink);
    if (S) S._inLogo = false;
}

// ─── motifs ──────────────────────────────────────────────────────────

function rodBase(cx, y, height, color, lineWidth) {
    X.strokeStyle = color;
    X.fillStyle = color;
    X.lineWidth = lineWidth;
    X.lineCap = 'round';
    X.lineJoin = 'round';
    X.beginPath();
    X.moveTo(cx, y + height * 0.05);
    X.lineTo(cx, y + height);
    X.stroke();
    X.beginPath();
    X.arc(cx, y + height * 0.03, lineWidth * 1.8, 0, 7);
    X.stroke();
    const amplitude = height * 0.15;
    X.beginPath();
    for (let i = 0; i <= 70; i += 1) {
        const t = i / 70;
        const yy = y + height * 0.17 + t * height * 0.68;
        const xx = cx + amplitude * Math.sin(t * Math.PI * 4.4 + 0.6) * (1 - t * 0.25);
        if (i) X.lineTo(xx, yy); else X.moveTo(xx, yy);
    }
    X.stroke();
    X.beginPath();
    X.ellipse(
        cx + amplitude * Math.sin(0.6) - lineWidth * 1.6,
        y + height * 0.17,
        lineWidth * 2.2,
        lineWidth * 1.3,
        -0.3,
        0,
        7,
    );
    X.fill();
}

function glassBase(cx, y, height, color, accent) {
    X.strokeStyle = color;
    X.lineWidth = Math.max(2, height * 0.012);
    X.lineJoin = 'round';
    X.lineCap = 'round';
    const bowl = height * 0.34;
    const baseY = y + height * 0.36;
    X.beginPath();
    X.moveTo(cx - bowl, baseY);
    X.lineTo(cx + bowl, baseY);
    X.lineTo(cx, baseY + height * 0.34);
    X.closePath();
    X.moveTo(cx, baseY + height * 0.34);
    X.lineTo(cx, y + height * 0.95);
    X.moveTo(cx - height * 0.17, y + height * 0.95);
    X.quadraticCurveTo(cx, y + height * 0.9, cx + height * 0.17, y + height * 0.95);
    X.stroke();
    X.strokeStyle = accent;
    X.beginPath();
    X.moveTo(cx - bowl * 0.72, baseY + height * 0.05);
    X.lineTo(cx + bowl * 0.72, baseY + height * 0.05);
    X.lineTo(cx, baseY + height * 0.27);
    X.closePath();
    X.stroke();
    X.strokeStyle = color;
    [[0.1, -0.025, -0.5], [0.4, -0.035, -0.15]].forEach(([a, b, rotation]) => {
        X.save();
        X.translate(cx + bowl * a + height * 0.04, baseY + b * height);
        X.rotate(rotation);
        X.beginPath();
        X.ellipse(height * 0.08, 0, height * 0.09, height * 0.035, 0, 0, 7);
        X.stroke();
        X.restore();
    });
    X.fillStyle = accent;
    [[0.04, -0.02], [0.1, 0], [0.07, 0.03]].forEach(([a, b]) => {
        X.beginPath();
        X.arc(cx + height * a, baseY + b * height, height * 0.016, 0, 7);
        X.fill();
    });
}

function sprigBase(cx, cy, height, color, accent) {
    X.lineWidth = Math.max(2, height * 0.008);
    X.strokeStyle = color;
    X.lineCap = 'round';
    const baseX = cx;
    const baseY = cy + height * 0.5;
    [-0.7, -0.38, 0, 0.38, 0.7].forEach((angle, index) => {
        const length = height * (0.66 - Math.abs(angle) * 0.28);
        const tipX = cx + Math.sin(angle) * length;
        const tipY = baseY - Math.cos(angle) * length;
        X.strokeStyle = color;
        X.beginPath();
        X.moveTo(baseX, baseY);
        X.quadraticCurveTo(cx + Math.sin(angle) * length * 0.25, baseY - length * 0.6, tipX, tipY);
        X.stroke();
        [-0.75, 0.75].forEach((side) => {
            X.save();
            X.translate(tipX, tipY);
            X.rotate(angle + side);
            X.beginPath();
            X.ellipse(0, -height * 0.06, height * 0.032, height * 0.07, 0, 0, 7);
            X.stroke();
            X.restore();
        });
        [0.45, 0.7].forEach((position, dotIndex) => {
            X.fillStyle = (index + dotIndex) % 2 ? accent : color;
            X.beginPath();
            X.arc(
                baseX + (tipX - baseX) * position * 0.9 + (dotIndex ? height * 0.02 : -height * 0.02),
                baseY + (tipY - baseY) * position,
                height * 0.016,
                0,
                7,
            );
            X.fill();
        });
    });
}

// Generic vector set. Every drawer uses (cx, cy, size, ink, accent).
function drawSparkle(cx, cy, size, ink) {
    X.strokeStyle = ink;
    X.lineWidth = Math.max(1.5, size * 0.03);
    X.lineCap = 'round';
    const inner = size * 0.16;
    const outer = size * 0.46;
    X.beginPath();
    for (let i = 0; i < 8; i += 1) {
        const angle = (Math.PI / 4) * i;
        const radius = i % 2 ? inner : outer;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (i) X.lineTo(x, y); else X.moveTo(x, y);
    }
    X.closePath();
    X.stroke();
}

function drawSun(cx, cy, size, ink, accent) {
    X.strokeStyle = ink;
    X.lineWidth = Math.max(1.5, size * 0.025);
    X.beginPath();
    X.arc(cx, cy, size * 0.26, 0, 7);
    X.stroke();
    for (let i = 0; i < 12; i += 1) {
        const angle = (Math.PI / 6) * i;
        X.beginPath();
        X.moveTo(cx + Math.cos(angle) * size * 0.34, cy + Math.sin(angle) * size * 0.34);
        X.lineTo(cx + Math.cos(angle) * size * 0.46, cy + Math.sin(angle) * size * 0.46);
        X.stroke();
    }
    X.fillStyle = accent;
    X.beginPath();
    X.arc(cx, cy, size * 0.08, 0, 7);
    X.fill();
}

function drawArch(cx, cy, size, ink, accent) {
    X.strokeStyle = ink;
    X.lineWidth = Math.max(1.5, size * 0.025);
    X.lineCap = 'round';
    X.beginPath();
    X.moveTo(cx - size * 0.3, cy + size * 0.4);
    X.lineTo(cx - size * 0.3, cy - size * 0.02);
    X.arc(cx, cy - size * 0.02, size * 0.3, Math.PI, 0);
    X.lineTo(cx + size * 0.3, cy + size * 0.4);
    X.stroke();
    X.strokeStyle = accent;
    X.beginPath();
    X.moveTo(cx, cy + size * 0.32);
    X.lineTo(cx, cy - size * 0.3);
    X.stroke();
}

function drawWave(cx, cy, size, ink, accent) {
    X.lineWidth = Math.max(1.5, size * 0.025);
    X.lineCap = 'round';
    [-0.18, 0, 0.18].forEach((offset, index) => {
        X.strokeStyle = index === 1 ? accent : ink;
        X.beginPath();
        for (let i = 0; i <= 60; i += 1) {
            const t = i / 60;
            const x = cx - size * 0.46 + t * size * 0.92;
            const y = cy + offset * size + Math.sin(t * Math.PI * 3) * size * 0.09;
            if (i) X.lineTo(x, y); else X.moveTo(x, y);
        }
        X.stroke();
    });
}

function drawLeaf(cx, cy, size, ink, accent) {
    X.strokeStyle = ink;
    X.lineWidth = Math.max(1.5, size * 0.025);
    X.beginPath();
    X.moveTo(cx, cy + size * 0.44);
    X.bezierCurveTo(cx - size * 0.45, cy + size * 0.12, cx - size * 0.24, cy - size * 0.4, cx, cy - size * 0.48);
    X.bezierCurveTo(cx + size * 0.24, cy - size * 0.4, cx + size * 0.45, cy + size * 0.12, cx, cy + size * 0.44);
    X.stroke();
    X.strokeStyle = accent;
    X.beginPath();
    X.moveTo(cx, cy + size * 0.36);
    X.lineTo(cx, cy - size * 0.34);
    X.stroke();
    for (let i = 0; i < 4; i += 1) {
        const y = cy - size * 0.2 + i * size * 0.13;
        X.beginPath();
        X.moveTo(cx, y);
        X.lineTo(cx - size * 0.14, y - size * 0.06);
        X.moveTo(cx, y);
        X.lineTo(cx + size * 0.14, y - size * 0.06);
        X.stroke();
    }
}

function drawDiamond(cx, cy, size, ink, accent) {
    X.strokeStyle = ink;
    X.lineWidth = Math.max(1.5, size * 0.025);
    X.beginPath();
    X.moveTo(cx, cy - size * 0.45);
    X.lineTo(cx + size * 0.36, cy);
    X.lineTo(cx, cy + size * 0.45);
    X.lineTo(cx - size * 0.36, cy);
    X.closePath();
    X.stroke();
    X.strokeStyle = accent;
    X.beginPath();
    X.moveTo(cx, cy - size * 0.24);
    X.lineTo(cx + size * 0.19, cy);
    X.lineTo(cx, cy + size * 0.24);
    X.lineTo(cx - size * 0.19, cy);
    X.closePath();
    X.stroke();
}

function drawCross(cx, cy, size, ink, accent) {
    X.strokeStyle = ink;
    X.lineWidth = Math.max(1.5, size * 0.025);
    X.lineCap = 'round';
    const arm = size * 0.34;
    const thickness = size * 0.16;
    X.beginPath();
    X.moveTo(cx - thickness, cy - arm);
    X.lineTo(cx + thickness, cy - arm);
    X.lineTo(cx + thickness, cy - thickness);
    X.lineTo(cx + arm, cy - thickness);
    X.lineTo(cx + arm, cy + thickness);
    X.lineTo(cx + thickness, cy + thickness);
    X.lineTo(cx + thickness, cy + arm);
    X.lineTo(cx - thickness, cy + arm);
    X.lineTo(cx - thickness, cy + thickness);
    X.lineTo(cx - arm, cy + thickness);
    X.lineTo(cx - arm, cy - thickness);
    X.lineTo(cx - thickness, cy - thickness);
    X.closePath();
    X.stroke();
    X.strokeStyle = accent;
    X.beginPath();
    X.moveTo(cx, cy - size * 0.18);
    X.lineTo(cx, cy + size * 0.18);
    X.moveTo(cx - size * 0.18, cy);
    X.lineTo(cx + size * 0.18, cy);
    X.stroke();
}

function drawLaurel(cx, cy, size, ink, accent) {
    X.lineWidth = Math.max(1.5, size * 0.022);
    X.lineCap = 'round';
    [-1, 1].forEach((side) => {
        X.strokeStyle = ink;
        X.beginPath();
        X.arc(cx, cy + size * 0.08, size * 0.32, side < 0 ? Math.PI * 0.8 : Math.PI * 1.2, side < 0 ? Math.PI * 1.2 : Math.PI * 1.8);
        X.stroke();
        for (let i = 0; i < 4; i += 1) {
            const angle = (side < 0 ? Math.PI * 0.8 : Math.PI * 1.2) + i * 0.13;
            const x = cx + Math.cos(angle) * size * 0.32;
            const y = cy + size * 0.08 + Math.sin(angle) * size * 0.32;
            X.fillStyle = i === 1 ? accent : ink;
            X.beginPath();
            X.ellipse(x + side * size * 0.04, y, size * 0.05, size * 0.09, angle, 0, 7);
            X.fill();
        }
    });
}

function drawRing(cx, cy, size, ink, accent) {
    X.strokeStyle = ink;
    X.lineWidth = Math.max(1.5, size * 0.026);
    X.beginPath();
    X.arc(cx, cy, size * 0.38, 0, 7);
    X.stroke();
    X.strokeStyle = accent;
    X.lineWidth = Math.max(1.5, size * 0.018);
    X.beginPath();
    X.arc(cx, cy, size * 0.25, 0, 7);
    X.stroke();
    X.fillStyle = accent;
    X.beginPath();
    X.arc(cx, cy, size * 0.07, 0, 7);
    X.fill();
}

const VECTORS = {
    sprig: (cx, cy, size, ink, accent) => sprigBase(cx, cy - size * 0.25, size, ink, accent),
    glass: (cx, cy, size, ink, accent) => glassBase(cx, cy - size / 2, size, ink, accent),
    rod: (cx, cy, size, ink, accent) => rodBase(cx, cy - size / 2, size, ink, Math.max(2, size * 0.025)),
    star: (cx, cy, size, ink) => drawSparkle(cx, cy, size, ink),
    sun: drawSun,
    arch: drawArch,
    wave: drawWave,
    leaf: drawLeaf,
    diamond: drawDiamond,
    cross: drawCross,
    laurel: drawLaurel,
    ring: drawRing,
    none: () => {},
};

function drawMotif(kind, cx, cy, size, ink, accent) {
    if (!S?.motif || S.motif === 'auto') {
        const fallback = VECTORS[kind] || VECTORS.sprig;
        fallback(cx, cy, size, ink, accent);
        return;
    }
    const drawer = VECTORS[S.motif] || VECTORS[kind] || VECTORS.sprig;
    drawer(cx, cy, size, ink, accent);
}

function rod(cx, y, height, color, lineWidth) {
    if (!S?.motif || S.motif === 'auto') {
        rodBase(cx, y, height, color, lineWidth);
        return;
    }
    drawMotif('rod', cx, y + height / 2, height, color, C('accent'));
}

function glass(cx, y, height, color, accent) {
    if (!S?.motif || S.motif === 'auto') {
        glassBase(cx, y, height, color, accent);
        return;
    }
    drawMotif('glass', cx, y + height / 2, height, color, accent);
}

function sprig(cx, cy, height, color, accent) {
    if (!S?.motif || S.motif === 'auto') {
        sprigBase(cx, cy, height, color, accent);
        return;
    }
    drawMotif('sprig', cx, cy + height * 0.25, height, color, accent);
}

// ─── QR + photography ────────────────────────────────────────────────

function qrAt(x, y, size, force) {
    const value = S?.qr || (force ? S?.defaultQr || DEFAULT_QR : '');
    if (!value || typeof qrcode !== 'function') return;
    let data = String(value).trim();
    if (!/^https?:\/\//i.test(data) && /[./]/.test(data)) data = `https://${data}`;
    try {
        const qr = qrcode(0, 'M');
        qr.addData(data);
        qr.make();
        const count = qr.getModuleCount();
        const padding = size * 0.08;
        const unit = (size - 2 * padding) / count;
        X.fillStyle = '#ffffff';
        X.beginPath();
        X.roundRect(x, y, size, size, size * 0.06);
        X.fill();
        X.fillStyle = '#111111';
        for (let row = 0; row < count; row += 1) {
            for (let column = 0; column < count; column += 1) {
                if (qr.isDark(row, column)) X.fillRect(x + padding + column * unit, y + padding + row * unit, unit + 0.6, unit + 0.6);
            }
        }
    } catch {
        /* a malformed URL should never break the design */
    }
}

function photo(x, y, width, height, radius) {
    const image = S?.photos?.[S.sel] || S?.photos?.[0] || null;
    X.save();
    X.beginPath();
    if (radius) X.roundRect(x, y, width, height, radius); else X.rect(x, y, width, height);
    X.clip();
    if (image && (image.naturalWidth || image.width)) {
        const imageWidth = image.naturalWidth || image.width;
        const imageHeight = image.naturalHeight || image.height;
        const scale = Math.max(width / imageWidth, height / imageHeight);
        const drawWidth = imageWidth * scale;
        const drawHeight = imageHeight * scale;
        X.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
    } else {
        // No photography: a branded pattern rather than a grey hole. This is
        // honest (the Image tab still says no photography is attached) and
        // keeps software/product brands looking designed until real shots land.
        const accent = C('accent');
        const paper = C('paper');
        const wash = X.createLinearGradient(x, y, x + width, y + height);
        wash.addColorStop(0, accent);
        wash.addColorStop(1, mix(accent, paper, 0.62));
        X.fillStyle = wash;
        X.fillRect(x, y, width, height);
        X.save();
        X.globalAlpha = 0.14;
        X.strokeStyle = paper;
        X.lineWidth = Math.max(1, width * 0.0012);
        const step = Math.max(width, height) / 8;
        for (let i = -height; i < width + height; i += step) {
            X.beginPath();
            X.moveTo(x + i, y);
            X.lineTo(x + i + height, y + height);
            X.stroke();
        }
        X.globalAlpha = 0.2;
        X.fillStyle = paper;
        X.textAlign = 'center';
        X.textBaseline = 'middle';
        const label = String(S?.brandWordmark || '');
        let size = Math.min(width, height) * 0.16;
        X.font = `700 ${size}px ${S?.fonts?.display || 'sans-serif'}`;
        const labelWidth = X.measureText(label).width;
        if (labelWidth > width * 0.8) {
            size *= (width * 0.8) / labelWidth;
            X.font = `700 ${size}px ${S?.fonts?.display || 'sans-serif'}`;
        }
        X.fillText(label, x + width / 2, y + height / 2);
        X.restore();
    }
    X.restore();
}

// ─── text stack + menu list ──────────────────────────────────────────

function stack(rect, items, options = {}) {
    const [x, y, width, height] = rect;
    const align = options.al || 'c';
    const vertical = options.va || 'm';
    const ok = (item) => item.bar || item.logo || item.rod || item.sp || item.s || (item.k && T(item.k).trim());
    // Cawley's brand system sets its H1s in uppercase Mulish 700. Apply that
    // to title fields without touching the layouts' body/eyebrow styles.
    const styled = items.map((item) => {
        if (item.k !== 'title') return item;
        if (S?.typeProfile === 'cawley') return { ...item, up: 1, w: 700 };
        if (S?.typeProfile === 'kitchenos') return { ...item, w: S.titleWeight || 700 };
        if (S?.typeProfile === 'okja') return { ...item, w: 900 };
        return item;
    });
    const visible = styled.filter(ok);
    let factor = 1;
    let boxes;
    let total;

    for (let pass = 0; pass < 40; pass += 1) {
        boxes = visible.map((item, index) => {
            const size = (item.z || 40) * U * factor;
            const gap = index ? (item.g || 0) * U * factor : 0;
            if (item.bar) return { item, gap, height: (item.h || 6) * U * factor, maxWidth: 0 };
            if (item.logo) return { item, gap, height: item.logo * U * factor * 0.8, maxWidth: 0 };
            if (item.rod) return { item, gap, height: item.rod * U * factor, maxWidth: 0 };
            if (item.sp) {
                const motifHeight = (S?._H || 1080) * 0.13 * factor;
                return { item, gap, height: motifHeight, maxWidth: 0 };
            }
            let text = item.s || T(item.k);
            if (item.up) text = text.toUpperCase();
            const font = fnt(item.f || 'd', item.w, size);
            const tracking = (item.ls || 0) * size;
            const lines = wrap(text, font, tracking, width);
            const lineHeight = size * (item.lh || 1.15);
            return {
                item,
                gap,
                font,
                tracking,
                lines,
                lineHeight,
                size,
                height: lines.length * lineHeight,
                maxWidth: Math.max(...lines.map((line) => tw(line, font, tracking))),
            };
        });
        total = boxes.reduce((sum, box) => sum + box.gap + box.height, 0);
        if ((total <= height && boxes.every((box) => box.maxWidth <= width + 1)) || factor < 0.25) break;
        factor *= 0.94;
    }

    let cursorY = vertical === 't' ? y : vertical === 'b' ? y + height - total : y + (height - total) / 2;
    boxes.forEach((box) => {
        cursorY += box.gap;
        const item = box.item;
        const color = C(item.c || 'ink');
        const centerX = align === 'c' ? x + width / 2 : align === 'r' ? x + width : x;
        if (item.bar) {
            const barWidth = item.w ? (item.w <= 1 ? item.w * width : item.w * U * factor) : width;
            X.fillStyle = color;
            X.fillRect(align === 'c' ? centerX - barWidth / 2 : align === 'r' ? centerX - barWidth : centerX, cursorY, barWidth, box.height);
        } else if (item.logo) {
            logoAt(centerX, cursorY, item.logo * U * factor, color, align);
        } else if (item.rod) {
            rod(align === 'c' ? centerX : centerX + box.height * 0.15, cursorY, box.height, color, Math.max(2, box.height * 0.03));
        } else if (item.sp) {
            drawMotif('sprig', centerX, cursorY + box.height / 2, box.height, color, C('accent'));
        } else if (box.lines) {
            if (item.bg) {
                const backgroundWidth = box.maxWidth + box.size * 1.4;
                const backgroundHeight = box.height + box.size * 0.5;
                X.fillStyle = C(item.bg);
                X.fillRect(align === 'c' ? centerX - backgroundWidth / 2 : centerX, cursorY - box.size * 0.25, backgroundWidth, backgroundHeight);
            }
            box.lines.forEach((line, index) => {
                put(
                    line,
                    item.bg && align !== 'c' ? centerX + box.size * 0.7 : centerX,
                    cursorY + index * box.lineHeight + box.lineHeight / 2,
                    box.font,
                    box.tracking,
                    align,
                    color,
                );
            });
        }
        cursorY += box.height;
    });
    return cursorY;
}

function parseItems(value) {
    return String(value).split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        if (line[0] === '#') return { h: line.slice(1).trim() };
        const parts = line.split('|').map((part) => part.trim());
        return { n: parts[0], d: parts[1] || '', p: parts[2] || '' };
    });
}

function menuList(rect, options) {
    const [x, y, width, height] = rect;
    const items = parseItems(T('items'));
    const centered = options.al === 'c';
    const nameWidth = centered ? width : width * 0.8;
    let factor = 1;
    let boxes;
    let total;

    for (let pass = 0; pass < 40; pass += 1) {
        boxes = items.map((item, index) => {
            const gap = index ? options.g * U * factor * (item.h ? 1.8 : 1) : 0;
            if (item.h) {
                const size = options.zh * U * factor;
                return { item, gap, size, height: size * 1.4 };
            }
            const nameSize = options.zn * U * factor;
            const descSize = options.zd * U * factor;
            const priceSize = options.zp * U * factor;
            const nameFont = fnt('d', options.wn, nameSize);
            const descFont = fnt('b', 400, descSize);
            const nameLines = wrap(options.up ? item.n.toUpperCase() : item.n, nameFont, 0, nameWidth);
            const descLines = item.d ? wrap(item.d, descFont, 0, nameWidth) : [];
            return {
                item,
                gap,
                nameSize,
                descSize,
                priceSize,
                nameFont,
                descFont,
                nameLines,
                descLines,
                height: nameLines.length * nameSize * 1.2
                    + descLines.length * descSize * 1.4
                    + (centered && item.p ? priceSize * 1.5 : 0),
            };
        });
        total = boxes.reduce((sum, box) => sum + box.gap + box.height, 0);
        if (total <= height) break;
        factor *= 0.95;
    }

    let cursorY = y + (options.top ? 0 : (height - total) / 2);
    const centerX = centered ? x + width / 2 : x;
    const align = centered ? 'c' : 'l';

    boxes.forEach((box) => {
        cursorY += box.gap;
        const item = box.item;
        if (item.h) {
            put(item.h.toUpperCase(), centerX, cursorY + box.height / 2, fnt('l', 700, box.size), box.size * 0.28, align, C('accent'));
            cursorY += box.height;
            return;
        }
        box.nameLines.forEach((line, index) => put(line, centerX, cursorY + (index + 0.5) * box.nameSize * 1.2, box.nameFont, 0, align, C('ink')));
        let nextY = cursorY + box.nameLines.length * box.nameSize * 1.2;
        if (item.p && !centered) put(item.p, x + width, cursorY + box.nameSize * 0.6, fnt('d', 400, box.priceSize), 0, 'r', C('ink'));
        box.descLines.forEach((line, index) => put(line, centerX, nextY + (index + 0.5) * box.descSize * 1.4, box.descFont, 0, align, C('mute')));
        nextY += box.descLines.length * box.descSize * 1.4;
        if (item.p && centered) put(item.p, centerX, nextY + box.priceSize * 0.75, fnt('d', 400, box.priceSize), 0, 'c', C('accent'));
        cursorY += box.height;
    });
}


// ─── die-cut shapes ──────────────────────────────────────────────────

// Shapes are described on the size preset (`shape: 'circle' | 'hanger' |
// 'sleeve' | 'rounded'`). The same path is used to clip the preview/PNG and,
// in print.js, to draw the vector cut line at trim.
function shapePath(shape, width, height) {
    X.beginPath();
    if (shape === 'circle') {
        X.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
        return;
    }
    const radius = shape === 'sleeve' ? Math.min(width, height) * 0.02 : Math.min(width, height) * 0.05;
    X.roundRect(0, 0, width, height, radius);
    if (shape === 'hanger') {
        const hole = Math.min(width * 0.42, height * 0.095);
        X.moveTo(width / 2 + hole, height * 0.14);
        X.arc(width / 2, height * 0.14, hole, 0, Math.PI * 2, true);
    }
}

// ─── tabular copy ────────────────────────────────────────────────────

// A row is either a section heading (`# Wines by the glass`) or cells split on
// `|`. This is the same syntax the menus use, extended to more columns.
function parseRows(value) {
    return String(value == null ? '' : value)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => (line[0] === '#'
            ? { h: line.slice(1).trim() }
            : { cells: line.split('|').map((cell) => cell.trim()) }));
}

const ALLERGENS = [
    ['Cel', 'Celery'],
    ['Glu', 'Cereals containing gluten'],
    ['Cru', 'Crustaceans'],
    ['Egg', 'Eggs'],
    ['Fis', 'Fish'],
    ['Lup', 'Lupin'],
    ['Mil', 'Milk'],
    ['Mol', 'Molluscs'],
    ['Mus', 'Mustard'],
    ['Nut', 'Tree nuts'],
    ['Pea', 'Peanuts'],
    ['Ses', 'Sesame'],
    ['Soy', 'Soya'],
    ['Sul', 'Sulphites'],
];

function parseAllergens(value) {
    const found = new Set();
    String(value == null ? '' : value).split(/[,;/]+/).forEach((token) => {
        const text = token.trim().toLowerCase();
        if (!text) return;
        const number = parseInt(text, 10);
        if (Number.isInteger(number) && number >= 1 && number <= ALLERGENS.length) {
            found.add(number - 1);
            return;
        }
        const index = ALLERGENS.findIndex(([abbr, name]) => {
            const full = name.toLowerCase();
            return full === text || abbr.toLowerCase() === text || full.startsWith(text.slice(0, 3));
        });
        if (index >= 0) found.add(index);
    });
    return found;
}

function wineList(rect, options = {}) {
    const [x, y, width, height] = rect;
    const columns = Math.max(1, Math.min(2, options.columns || 1));
    const gap = options.gap != null ? options.gap : width * 0.05;
    const colWidth = (width - gap * (columns - 1)) / columns;
    const rows = parseRows(T('wines'));
    if (!rows.length) return;
    const perColumn = Math.ceil(rows.length / columns);
    const chunks = [];
    for (let index = 0; index < columns; index += 1) {
        chunks.push(rows.slice(index * perColumn, (index + 1) * perColumn));
    }
    let factor = 1;
    let layout = null;
    for (let pass = 0; pass < 40; pass += 1) {
        layout = chunks.map((chunk) => {
            const items = chunk.map((row, index) => {
                const heading = Boolean(row.h);
                const nameSize = (options.zn || 30) * U * factor;
                const regionSize = (options.zd || 18) * U * factor;
                const priceSize = (options.zp || 24) * U * factor;
                const nameFont = fnt('d', options.wn, nameSize);
                const regionFont = fnt('b', 400, regionSize);
                const priceFont = fnt('d', 400, priceSize);
                if (heading) return { row, heading, size: (options.zh || 20) * U * factor, height: (options.zh || 20) * U * factor * 2.1 };
                const cells = row.cells || [];
                const nameLines = wrap(cells[0] || '', nameFont, 0, colWidth * 0.62);
                const regionLines = cells[1] ? wrap(cells[1], regionFont, 0, colWidth * 0.62) : [];
                return {
                    row, heading: false, cells, nameSize, regionSize, priceSize, nameFont, regionFont, priceFont,
                    nameLines, regionLines,
                    height: nameLines.length * nameSize * 1.12 + regionLines.length * regionSize * 1.25 + (options.g || 14) * U * factor,
                };
            });
            return { items, total: items.reduce((sum, item) => sum + item.height, 0) };
        });
        if (layout.every((column) => column.total <= height) || factor < 0.5) break;
        factor *= 0.96;
    }
    chunks.forEach((chunk, columnIndex) => {
        const left = x + columnIndex * (colWidth + gap);
        let cursor = y;
        if (options.top !== false) {
            put('GLASS', left + colWidth * 0.78, cursor, fnt('l', 700, 13 * U), 0, 'c', C('mute'));
            put('BOTTLE', left + colWidth * 0.93, cursor, fnt('l', 700, 13 * U), 0, 'c', C('mute'));
            X.strokeStyle = C('accent');
            X.lineWidth = Math.max(1, 2 * U);
            X.beginPath();
            X.moveTo(left, cursor + 12 * U);
            X.lineTo(left + colWidth, cursor + 12 * U);
            X.stroke();
            cursor += 30 * U;
        }
        layout[columnIndex].items.forEach((item) => {
            if (item.heading) {
                put(item.row.h.toUpperCase(), left, cursor + item.size * 0.7, fnt('l', 700, item.size), item.size * 0.22, 'l', C('accent'));
                cursor += item.height;
                return;
            }
            item.nameLines.forEach((line, lineIndex) => put(line, left, cursor + item.nameSize * (0.6 + lineIndex * 1.12), item.nameFont, 0, 'l', C('ink')));
            const afterName = cursor + item.nameLines.length * item.nameSize * 1.12;
            item.regionLines.forEach((line, lineIndex) => put(line, left, afterName + item.regionSize * (0.6 + lineIndex * 1.25), item.regionFont, 0, 'l', C('mute')));
            const cells = item.cells || [];
            const priceY = cursor + item.nameSize * 0.6;
            if (cells[2]) put(cells[2], left + colWidth * 0.78, priceY, item.priceFont, 0, 'c', C('ink'));
            if (cells[3]) put(cells[3], left + colWidth * 0.93, priceY, item.priceFont, 0, 'c', C('ink'));
            cursor += item.height;
        });
    });
}

function allergenMatrix(rect, options = {}) {
    const [x, y, width, height] = rect;
    const rows = parseRows(T('items'));
    const labelWidth = width * (options.labelWidth || 0.34);
    const colWidth = (width - labelWidth) / ALLERGENS.length;
    const headerHeight = (options.header || 54) * U;
    const footerHeight = (options.footer || 74) * U;
    const body = rows.filter((row) => !row.h);
    const rowHeight = Math.min((height - headerHeight - footerHeight) / Math.max(1, body.length), 54 * U);
    X.fillStyle = C('accent');
    X.fillRect(x, y, width, headerHeight);
    put('DISH', x + 12 * U, y + headerHeight * 0.55, fnt('l', 700, 15 * U), 1.4 * U, 'l', C('paper'));
    ALLERGENS.forEach(([abbr], index) => {
        put(abbr, x + labelWidth + colWidth * (index + 0.5), y + headerHeight * 0.55, fnt('l', 700, 13 * U), 0, 'c', C('paper'));
    });
    let cursor = y + headerHeight;
    rows.forEach((row) => {
        if (row.h) {
            put(row.h.toUpperCase(), x + 4 * U, cursor + 11 * U, fnt('l', 700, 14 * U), 1.2 * U, 'l', C('accent'));
            cursor += 24 * U;
            return;
        }
        X.fillStyle = (body.indexOf(row) % 2) ? mix(C('paper'), C('ink'), 0.06) : C('paper');
        X.fillRect(x, cursor, width, rowHeight);
        const marks = parseAllergens((row.cells || [])[1] || '');
        put(String((row.cells || [])[0] || ''), x + 12 * U, cursor + rowHeight * 0.55, fnt('b', 600, 19 * U), 0, 'l', C('ink'));
        ALLERGENS.forEach(([, name], index) => {
            if (!marks.has(index)) return;
            X.fillStyle = C('accent');
            X.beginPath();
            X.arc(x + labelWidth + colWidth * (index + 0.5), cursor + rowHeight * 0.5, Math.min(colWidth, rowHeight) * 0.22, 0, Math.PI * 2);
            X.fill();
        });
        X.strokeStyle = mix(C('paper'), C('ink'), 0.18);
        X.lineWidth = Math.max(1, 1 * U);
        X.beginPath();
        X.moveTo(x, cursor + rowHeight);
        X.lineTo(x + width, cursor + rowHeight);
        X.stroke();
        cursor += rowHeight;
    });
    const legend = ['Celery', 'Gluten', 'Crustaceans', 'Eggs', 'Fish', 'Lupin', 'Milk', 'Molluscs', 'Mustard', 'Tree nuts', 'Peanuts', 'Sesame', 'Soya', 'Sulphites'];
    const legendY = y + height - footerHeight + 6 * U;
    put('CONTAINS / MAY CONTAIN', x + 2 * U, legendY, fnt('l', 700, 12 * U), 1.2 * U, 'l', C('mute'));
    ALLERGENS.forEach(([abbr], index) => {
        const line = index < 7 ? 0 : 1;
        const column = index % 7;
        put(`${index + 1} ${abbr} · ${legend[index]}`, x + 2 * U + column * (width / 7), legendY + (line + 1) * 14 * U, fnt('b', 400, 10.5 * U), 0, 'l', C('mute'));
    });
    const updated = T('updated');
    if (updated) put(updated, x + width, y + height - 2 * U, fnt('b', 400, 11 * U), 0, 'r', C('mute'));
}

function stampGrid(rect, options = {}) {
    const [x, y, width, height] = rect;
    const count = Math.max(6, Math.min(10, parseInt(T('stamps'), 10) || options.count || 8));
    const columns = count <= 6 ? 3 : count <= 8 ? 4 : 5;
    const rows = Math.ceil(count / columns);
    const cellW = width / columns;
    const cellH = height / rows;
    const radius = Math.min(cellW, cellH) * 0.36;
    for (let index = 0; index < count; index += 1) {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const cx = x + cellW * (column + 0.5);
        const cy = y + cellH * (row + 0.5);
        X.strokeStyle = C('ink');
        X.lineWidth = Math.max(1.2, radius * 0.09);
        X.beginPath();
        X.arc(cx, cy, radius, 0, Math.PI * 2);
        X.stroke();
        if (index === 0) {
            drawMotif(options.motif || 'star', cx, cy, radius * 1.25, C('accent'), C('accent'));
        } else {
            put(String(index + 1), cx, cy, fnt('d', 700, radius * 0.85), 0, 'c', C('mute'));
        }
    }
}

// ─── render ──────────────────────────────────────────────────────────

function render(canvas, size, template, state, targetWidth, options = {}) {
    if (!canvas || !size || !template) return null;
    const previousS = S;
    const previousX = X;
    const previousU = U;
    S = state;
    const scale = targetWidth ? targetWidth / size.w : 1;
    const width = Math.max(1, Math.round(size.w * scale));
    const height = Math.max(1, Math.round(size.h * scale));
    const sides = size.sides || 1;
    const gap = 40 * scale;
    const sideHeight = (height - gap * (sides - 1)) / sides;
    const shape = options.clipShape === false ? null : (size.shape || null);
    canvas.width = width;
    canvas.height = height;
    X = canvas.getContext('2d');
    // Preview keeps a neutral stage behind a die-cut shape; PNG export asks
    // for a transparent backdrop instead.
    if (options.backdrop === false) X.clearRect(0, 0, width, height);
    else {
        // A die-cut preview reads as a sheet on a light table, not a grey square.
        X.fillStyle = shape ? '#f6f3ee' : '#cfcac2';
        X.fillRect(0, 0, width, height);
    }
    U = width / 1080;
    S._W = width;
    S._H = sideHeight;
    S.boxes = [];
    for (let index = 0; index < sides; index += 1) {
        S._side = sides > 1 ? 'fb'[index] : (size.side || 'f');
        X.save();
        X.translate(0, index * (sideHeight + gap));
        if (shape) {
            shapePath(shape, width, sideHeight);
            X.clip('evenodd');
        } else {
            X.beginPath();
            X.rect(0, 0, width, sideHeight);
            X.clip();
        }
        X.fillStyle = C('paper');
        X.fillRect(0, 0, width, sideHeight);
        template.draw(width, sideHeight, S._side);
        X.restore();
    }
    S = previousS;
    X = previousX;
    U = previousU;
    return { width, height, shape };
}

function renderToCanvas(canvas, size, template, state) {
    return render(canvas, size, template, state, null);
}

function renderThumb(canvas, size, template, state, width = 220) {
    return render(canvas, size, template, state, width);
}

function drawVectorPreview(canvas, id, palette, width = 96, height = 96) {
    const previousS = S;
    const previousX = X;
    S = {
        pal: palette,
        fonts: { display: SERIF_STACK, serif: SERIF_STACK, sans: SANS_STACK },
        motif: 'auto',
    };
    X = canvas.getContext('2d');
    canvas.width = width * 2;
    canvas.height = height * 2;
    X.scale(2, 2);
    X.clearRect(0, 0, width, height);
    const drawer = VECTORS[id];
    if (drawer) {
        X.lineCap = 'round';
        X.lineJoin = 'round';
        drawer(width / 2, height / 2, Math.min(width, height) * 0.62, C('ink'), C('accent'));
    }
    S = previousS;
    X = previousX;
}

function templateUsesMotif(template) {
    return /\b(rod|glass|sprig)\s*\(|(?:\bsp\s*:)/.test(String(template?.draw || ''));
}

window.AssetEngine = {
    render,
    renderToCanvas,
    renderThumb,
    drawVectorPreview,
    templateUsesMotif,
    VECTORS: Object.keys(VECTORS),
    SERIF_STACK,
    SANS_STACK,
};
