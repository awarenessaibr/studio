#!/usr/bin/env python3
"""Build the Beards character asset pack (rig v3).

The pack is a *drop-in placeholder*: every file can be replaced by an
AI-generated PNG with the same name, same canvas and same bounding box.
`tools/apply-beards-rig.js` reads ``assets/manifest.json`` and wires the
files into the composition.

What it derives from the source art
-----------------------------------
* face-base.png      clean skin head plate (eyes/brows/mouth erased, nose kept)
* eye-white-*.png    eyeballs with the baked-in pupil removed
* pupil-*.png        the original pupil cut-outs
* eye-highlight-*.png small specular dots
* eyelid-{half,closed}-{left,right}.png  eyelid patches shaped to each eye
* brow-{left,right}-{neutral,raised,furrowed,sad}.png expression variants
* mouth-<viseme>.png  13 lip-sync mouth shapes
* mustache-upper.png  mustache hair with the baked lower lip removed
* ear-left.png / ear-right.png  ears recovered from the final image
* beard.png, hair-front.png, hair-back.png, shirt.png, hand-*.png

Run:
    python3 tools/build-beards-assets.py [--preview]

``--preview`` writes ``assets/_preview-sheet.png`` and
``assets/_preview-head.png`` for visual QA.
"""

from __future__ import annotations

import argparse
import json
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.path.join(ROOT, 'data', 'imports', 'beards-20261019000756-e757')
SEGMENTS = os.path.join(PROJECT, 'segments', 'bearded-man')
ASSETS = os.path.join(PROJECT, 'assets')

W, H = 348, 546

SKIN = (243, 200, 158, 255)
SKIN_TOP = (245, 204, 164, 255)
SKIN_SHADE = (232, 180, 138, 255)
SKIN_LIGHT = (250, 217, 180, 255)
LINE = (58, 47, 38, 255)
LINE_SOFT = (74, 62, 51, 255)
HAIR = (119, 111, 100, 255)
HAIR_DARK = (73, 66, 58, 255)
EYE_WHITE = (237, 237, 237, 255)
PUPIL = (20, 20, 20, 255)
MOUTH_DARK = (43, 27, 22, 255)
MOUTH_MID = (92, 47, 41, 255)
TONGUE = (186, 104, 97, 255)
TONGUE_LIGHT = (206, 126, 118, 255)
TEETH = (246, 240, 229, 255)
TEETH_SHADE = (224, 214, 199, 255)

# ── Composition boxes (percent of 348×546) ───────────────────────────────
BOXES = {
    'eye-left': (26.44, 26.56, 22.99, 15.20),
    'eye-right': (48.28, 26.74, 22.70, 15.38),
    'pupil-left': (30.46, 32.97, 4.31, 2.75),
    'pupil-right': (51.44, 33.15, 4.31, 2.75),
    'brow-left': (25.57, 22.53, 21.26, 5.86),
    'brow-right': (50.86, 22.89, 21.26, 5.86),
    'mouth': (36.78, 47.25, 24.71, 8.42),
    'ear-left': (9.20, 27.47, 14.37, 18.32),
    'ear-right': (77.59, 27.47, 17.24, 20.15),
    'mustache': (29.02, 44.32, 38.79, 12.27),
    'beard': (16.67, 35.16, 65.80, 60.99),
    'hair-front': (8.62, 0.18, 86.21, 62.45),
    'hair-back': (7.76, 0.37, 87.36, 95.60),
    'shirt': (1.44, 55.13, 97.70, 37.55),
    'hand-left': (0.29, 76.56, 18.39, 10.99),
    'hand-right': (81.03, 77.11, 18.97, 11.17),
    'face': (0.0, 0.0, 100.0, 100.0),
}

EYE_NAMES = {'left': 'large-white-eyes-1', 'right': 'large-white-eyes-2'}
PUPIL_NAMES = {'left': 'black-pupils-1', 'right': 'black-pupils-2'}


# ── Small raster helpers ─────────────────────────────────────────────────

def load(path: str) -> Image.Image:
    return Image.open(path).convert('RGBA')


def alpha_mask(image: Image.Image, threshold: int = 8) -> Image.Image:
    """Binary mask image ('L') from an RGBA image's alpha channel."""
    return image.getchannel('A').point(lambda value: 255 if value > threshold else 0)


def to_canvas(image: Image.Image, box, size=(W, H), resample=Image.LANCZOS) -> Image.Image:
    x, y, w, h = box
    target_w = max(1, round(w / 100 * size[0]))
    target_h = max(1, round(h / 100 * size[1]))
    resized = image.resize((target_w, target_h), resample)
    canvas = Image.new('RGBA', size, (0, 0, 0, 0))
    canvas.alpha_composite(resized, (round(x / 100 * size[0]), round(y / 100 * size[1])))
    return canvas


def place_mask(image: Image.Image, box, size=(W, H)) -> Image.Image:
    return to_canvas(alpha_mask(image), box, size, Image.NEAREST)


def union_masks(masks) -> Image.Image:
    out = np.zeros((H, W), dtype='uint16')
    for mask in masks:
        array = np.asarray(mask)
        if array.ndim == 3:
            array = array[:, :, 3]
        out |= array.astype('uint16')
    return Image.fromarray(out.clip(0, 255).astype('uint8'))


def fill_holes(mask: Image.Image) -> Image.Image:
    """Fill enclosed holes in a binary mask (PIL flood fill, no numpy needed)."""
    padded = Image.new('L', (mask.width + 2, mask.height + 2), 0)
    padded.paste(mask, (1, 1))
    ImageDraw.floodfill(padded, (0, 0), 128, thresh=10)
    holes = padded.point(lambda value: 0 if value == 128 else 255)
    holes.paste(0, (0, 0, padded.width, 1))
    holes.paste(0, (0, padded.height - 1, padded.width, padded.height))
    holes.paste(0, (0, 0, 1, padded.height))
    holes.paste(0, (padded.width - 1, 0, padded.width, padded.height))
    return holes.crop((1, 1, padded.width - 1, padded.height - 1))


def dilate(mask: Image.Image, radius: int) -> Image.Image:
    if radius <= 0:
        return mask
    size = radius * 2 + 1
    return mask.filter(ImageFilter.MaxFilter(size))


def solidify(image: Image.Image, radius: int = 1) -> Image.Image:
    """Grow a cut-out's alpha by a hair so it covers the face plate seam."""
    alpha = image.getchannel('A')
    alpha = alpha.filter(ImageFilter.MaxFilter(radius * 2 + 1))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.55))
    out = image.copy()
    out.putalpha(alpha)
    return out


def feather(mask: Image.Image, radius: float) -> Image.Image:
    if radius <= 0:
        return mask
    return mask.filter(ImageFilter.GaussianBlur(radius))


def warm_skin(pixel) -> bool:
    r, g, b, a = pixel
    return a > 40 and r > 188 and g > 132 and b < 208 and (r - b) > 38


def luma(pixel) -> float:
    return 0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2]


def jitter_path(points, amount=0.45, seed=7):
    rnd = random.Random(seed)
    return [(x + rnd.uniform(-amount, amount), y + rnd.uniform(-amount, amount)) for x, y in points]


def stroke(draw: ImageDraw.ImageDraw, points, fill=LINE, width=1.6, seed=1, supersample=4, jitter=0.35):
    pts = jitter_path(points, jitter, seed)
    scaled = [(x * supersample, y * supersample) for x, y in pts]
    draw.line(scaled, fill=fill, width=max(1, round(width * supersample)), joint='curve')
    radius = width * supersample / 2
    for x, y in (scaled[0], scaled[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def poly(draw, points, fill=None, outline=None, width=1.6, seed=1, supersample=4, jitter=0.4):
    pts = jitter_path(points, jitter, seed)
    scaled = [(x * supersample, y * supersample) for x, y in pts]
    draw.polygon(scaled, fill=fill)
    if outline:
        draw.line(scaled + [scaled[0]], fill=outline, width=max(1, round(width * supersample)), joint='curve')


def ellipse(draw, box, fill=None, outline=None, width=1.6, supersample=4):
    x0, y0, x1, y1 = [v * supersample for v in box]
    draw.ellipse((x0, y0, x1, y1), fill=fill, outline=outline,
                 width=max(1, round(width * supersample)) if outline else 0)


# ── Asset builders ──────────────────────────────────────────────────────

def build_face_plate(reference: Image.Image, cutouts: dict) -> Image.Image:
    silhouette = alpha_mask(reference, 8)
    outer = [
        cutouts['hair-front'], cutouts['hair-back'], cutouts['beard'],
        cutouts['shirt'], cutouts['hand-left'], cutouts['hand-right'],
        cutouts['ear-left'], cutouts['ear-right'],
    ]
    outer_mask = union_masks(outer)
    # keep the plate 1px inside the outer silhouette so it can never show a
    # skin halo outside the hair, then tuck it 2px under the hair/beard edges.
    inner_silhouette = silhouette.filter(ImageFilter.MinFilter(3))
    face = np.asarray(inner_silhouette).astype('uint16') & (255 - np.asarray(outer_mask).astype('uint16'))
    face = Image.fromarray(face.clip(0, 255).astype('uint8'))
    face = fill_holes(face)
    face = dilate(face, 2)
    face = face.filter(ImageFilter.GaussianBlur(1.1))
    # Keep the head only; drop stray slivers below the shirt line.
    clip = Image.new('L', (W, H), 0)
    ImageDraw.Draw(clip).rectangle((0, 0, W, 355), fill=255)
    face = Image.fromarray((np.asarray(face).astype('uint16') & np.asarray(clip).astype('uint16')).astype('uint8'))
    # Keep the RGB flat skin and vary only alpha: pasting with a soft mask
    # would blend the RGB towards black and leave a dark seam.
    plate = Image.new('RGBA', (W, H), SKIN)
    plate.putalpha(face)
    # Nose: keep the original line work, drop the skin and the eye whites.
    ref_px = reference.load()
    nose = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    nose_px = nose.load()
    for y in range(206, 256):
        for x in range(140, 210):
            r, g, b, a = ref_px[x, y]
            if a < 60:
                continue
            value = luma((r, g, b, a))
            if value > 205:
                continue
            nose_px[x, y] = (r, g, b, a if value < 150 else 120)
    nose = nose.filter(ImageFilter.GaussianBlur(0.25))
    plate.alpha_composite(nose)
    return plate


def build_clean_eye(eye_path: str, eye_box) -> Image.Image:
    image = load(eye_path)
    pixels = image.load()
    dark = []
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            if a > 120 and luma((r, g, b, a)) < 90:
                dark.append((x, y))
    if dark:
        xs = [x for x, _ in dark]
        ys = [y for _, y in dark]
        x0, x1 = min(xs) - 3, max(xs) + 3
        y0, y1 = min(ys) - 3, max(ys) + 3
        # sample the surrounding white
        whites = []
        for y in range(image.height):
            for x in range(image.width):
                r, g, b, a = pixels[x, y]
                if a > 200 and luma((r, g, b, a)) > 190:
                    whites.append((r, g, b))
        base = tuple(sorted(whites, key=lambda c: sum(c))[len(whites) // 2]) if whites else EYE_WHITE[:3]
        patch = Image.new('L', (image.width, image.height), 0)
        ImageDraw.Draw(patch).ellipse((x0, y0, x1, y1), fill=255)
        patch = patch.filter(ImageFilter.GaussianBlur(1.4))
        fill = Image.new('RGBA', image.size, base + (255,))
        image = Image.composite(fill, image, patch)
    return image


def build_highlight(size=(15, 15)) -> Image.Image:
    image = Image.new('RGBA', size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((3.2, 3.0, 8.0, 7.8), fill=(255, 255, 255, 235))
    image = image.filter(ImageFilter.GaussianBlur(0.6))
    return image


def build_eyelid(eye_path: str, state: str) -> Image.Image:
    scale = 4
    eye = load(eye_path)
    width, height = eye.size
    big = eye.resize((width * scale, height * scale), Image.LANCZOS)
    silhouette = dilate(alpha_mask(big, 8), scale)
    fill_mask = Image.new('L', big.size, 0)
    fill_draw = ImageDraw.Draw(fill_mask)
    if state == 'closed':
        fill_draw.rectangle((0, 0, big.width, big.height), fill=255)
    else:
        points = []
        for x in range(width):
            ratio = (x - width / 2) / (width / 2)
            points.append((x, height * (0.235 + 0.15 * (1 - ratio * ratio))))
        points += [(width, height), (0, height)]
        fill_draw.polygon([(x * scale, y * scale) for x, y in points], fill=255)
    fill_mask = Image.fromarray(
        (np.asarray(fill_mask).astype('uint16') & np.asarray(silhouette).astype('uint16')).astype('uint8')
    )
    lid = Image.new('RGBA', big.size, SKIN)
    lid.putalpha(fill_mask)
    lash = Image.new('RGBA', big.size, (0, 0, 0, 0))
    lash_draw = ImageDraw.Draw(lash)
    if state == 'closed':
        y = height * 0.55
        points = [(width * 0.10, y), (width * 0.28, y + height * 0.055),
                  (width * 0.52, y + height * 0.05), (width * 0.76, y + height * 0.015),
                  (width * 0.90, y - height * 0.02)]
    else:
        points = []
        for x in range(width):
            ratio = (x - width / 2) / (width / 2)
            points.append((x, height * (0.235 + 0.15 * (1 - ratio * ratio))))
    stroke(lash_draw, points, fill=LINE, width=1.7, seed=3, supersample=scale, jitter=0.04)
    for index in range(2):
        bx = width * (0.78 + index * 0.05)
        by = height * (0.55 if state == 'closed' else 0.45)
        stroke(lash_draw, [(bx, by), (bx + width * 0.022, by + height * 0.028)],
               fill=LINE, width=1.05, seed=10 + index, supersample=scale, jitter=0.03)
    lash.putalpha(Image.fromarray(
        (np.asarray(lash.getchannel('A')).astype('uint16')
         & np.asarray(silhouette).astype('uint16')).astype('uint8')
    ))
    lid.alpha_composite(lash)
    crease = Image.new('RGBA', big.size, (0, 0, 0, 0))
    crease_draw = ImageDraw.Draw(crease)
    if state == 'closed':
        cy = height * 0.38
        stroke(crease_draw, [(width * 0.18, cy), (width * 0.5, cy - height * 0.045),
                             (width * 0.82, cy)], fill=SKIN_SHADE, width=1.1, seed=6,
               supersample=scale, jitter=0.05)
    else:
        cy = height * 0.20
        stroke(crease_draw, [(width * 0.20, cy), (width * 0.5, cy - height * 0.04),
                             (width * 0.80, cy)], fill=SKIN_SHADE, width=1.0, seed=6,
               supersample=scale, jitter=0.05)
    crease.putalpha(Image.fromarray(
        (np.asarray(crease.getchannel('A')).astype('uint16')
         & np.asarray(fill_mask).astype('uint16')).astype('uint8')
    ))
    lid.alpha_composite(crease)
    return lid.resize((width, height), Image.LANCZOS)


MOUTH_GEOM = {
    #          width  lip-top  shape      teeth  tongue  curve
    'rest':  dict(w=30, lip=14.5, shape='line',   teeth=0, tongue=0, curve=0),
    'mbp':   dict(w=28, lip=15.0, shape='line',   teeth=0, tongue=0, curve=0),
    'a':     dict(w=38, lip=32.0, shape='wide',   teeth=5, tongue=7, curve=0),
    'e':     dict(w=42, lip=27.0, shape='wide',   teeth=3.8, tongue=0, curve=0),
    'i':     dict(w=36, lip=24.0, shape='wide',   teeth=3.2, tongue=0, curve=0),
    'o':     dict(w=25, lip=32.0, shape='round',  teeth=0, tongue=6, curve=0),
    'u':     dict(w=18, lip=31.0, shape='round',  teeth=0, tongue=0, curve=0),
    'wq':    dict(w=14, lip=29.0, shape='round',  teeth=0, tongue=0, curve=0),
    'fv':    dict(w=31, lip=22.0, shape='wide',   teeth=4, tongue=0, curve=0),
    'l':     dict(w=32, lip=28.0, shape='wide',   teeth=0, tongue=6, curve=0),
    'smile': dict(w=44, lip=29.0, shape='smile',  teeth=5, tongue=0, curve=1),
    'frown': dict(w=40, lip=15.0, shape='frown',  teeth=0, tongue=0, curve=-1),
    'open':  dict(w=30, lip=33.0, shape='round',  teeth=5, tongue=8, curve=0),
}


def build_mouth(viseme: str) -> Image.Image:
    scale = 4
    width, height = 86, 46
    image = Image.new('RGBA', (width * scale, height * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    geom = MOUTH_GEOM.get(viseme, MOUTH_GEOM['rest'])
    cx = 43.0
    lip_top = geom['lip']
    mouth_w = geom['w']
    cavity_top = 13.0
    lip_bottom = 37.5
    curve = geom['curve']

    def scaled(value):
        if len(value) == 4 and isinstance(value[0], (int, float)):
            return tuple(item * scale for item in value)
        return [(x * scale, y * scale) for x, y in value]

    # 2. cavity mask
    cavity_mask = Image.new('L', image.size, 0)
    cavity_draw = ImageDraw.Draw(cavity_mask)
    if geom['shape'] in ('wide', 'smile'):
        top_inset = 3.0
        points = [
            (cx - mouth_w / 2 + top_inset, cavity_top),
            (cx + mouth_w / 2 - top_inset, cavity_top),
            (cx + mouth_w / 2, cavity_top + 2.5),
            (cx + mouth_w / 2 - 1.5, lip_top - 2.5),
            (cx + mouth_w / 2 - 5, lip_top),
            (cx, lip_top + 0.8),
            (cx - mouth_w / 2 + 5, lip_top),
            (cx - mouth_w / 2 + 1.5, lip_top - 2.5),
            (cx - mouth_w / 2, cavity_top + 2.5),
        ]
        if geom['shape'] == 'smile':
            points = [
                (cx - mouth_w / 2, cavity_top + 3.5),
                (cx - mouth_w / 2 + 7, cavity_top - 1.5),
                (cx, cavity_top + 0.5),
                (cx + mouth_w / 2 - 7, cavity_top - 1.5),
                (cx + mouth_w / 2, cavity_top + 3.5),
                (cx + mouth_w / 2 - 2, lip_top - 3),
                (cx + mouth_w / 2 - 6, lip_top - 0.5),
                (cx, lip_top + 0.5),
                (cx - mouth_w / 2 + 6, lip_top - 0.5),
                (cx - mouth_w / 2 + 2, lip_top - 3),
            ]
        cavity_draw.polygon(scaled(points), fill=255)
    elif geom['shape'] == 'round':
        cavity_draw.ellipse(scaled((cx - mouth_w / 2, cavity_top, cx + mouth_w / 2, lip_top)), fill=255)

    if geom['shape'] not in ('line', 'frown'):
        image.paste(Image.new('RGBA', image.size, MOUTH_DARK), (0, 0), cavity_mask)

        if geom['teeth']:
            teeth_mask = Image.new('L', image.size, 0)
            ImageDraw.Draw(teeth_mask).rounded_rectangle(
                ((cx - mouth_w * 0.38) * scale, (cavity_top + 1.0) * scale,
                 (cx + mouth_w * 0.38) * scale, (cavity_top + 1.0 + geom['teeth']) * scale),
                radius=1.2 * scale, fill=255,
            )
            teeth_mask = Image.fromarray(
                (np.asarray(teeth_mask).astype('uint16') & np.asarray(cavity_mask).astype('uint16')).astype('uint8')
            )
            image.paste(Image.new('RGBA', image.size, TEETH), (0, 0), teeth_mask)
            # tooth separations
            for offset in (-0.24, 0.0, 0.24):
                x = cx + mouth_w * offset
                draw.line(scaled([(x, cavity_top + 1.4), (x, cavity_top + 0.6 + geom['teeth'])]),
                          fill=TEETH_SHADE, width=max(1, round(0.8 * scale)))

        if geom['tongue']:
            tongue_mask = Image.new('L', image.size, 0)
            tongue_h = geom['tongue']
            ImageDraw.Draw(tongue_mask).ellipse(
                scaled((cx - mouth_w * 0.30, lip_top - tongue_h, cx + mouth_w * 0.30, lip_top - 0.5)), fill=255,
            )
            tongue_mask = Image.fromarray(
                (np.asarray(tongue_mask).astype('uint16') & np.asarray(cavity_mask).astype('uint16')).astype('uint8')
            )
            image.paste(Image.new('RGBA', image.size, TONGUE), (0, 0), tongue_mask)

    # 3. lower lip: half-ellipse below the mouth line, outlined on the outside only
    lip_w = mouth_w + (34 if geom['shape'] in ('line', 'frown') else 20)
    half_w = lip_w / 2

    def top_y(u):
        # u in [-1, 1] across the lip
        if curve > 0:
            return lip_top + 2.6 * max(0.0, 1 - u * u)
        if curve < 0:
            return lip_top - 2.4 * max(0.0, 1 - u * u)
        return lip_top + 1.0 * max(0.0, 1 - u * u)

    top_points = []
    for index in range(13):
        u = -1 + 2 * index / 12
        top_points.append((cx + u * (half_w - 4), top_y(u)))
    bottom_points = []
    for index in range(25):
        u = -1 + 2 * index / 24
        bottom_points.append((cx + u * half_w, lip_bottom - 0.5 - 2.2 * (1 - u * u)))
    lip_points = top_points + list(reversed(bottom_points))
    poly(draw, lip_points, fill=SKIN, outline=None, seed=4, jitter=0.12)
    stroke(draw, bottom_points, fill=LINE, width=1.5, seed=5, supersample=scale, jitter=0.08)
    # lower-lip highlight
    highlight_h = max(2.0, (lip_bottom - lip_top) * 0.34)
    ellipse(draw, (cx - lip_w * 0.26, lip_bottom - highlight_h - 1.4,
                   cx + lip_w * 0.26, lip_bottom - 2.0), fill=SKIN_LIGHT, outline=None)

    # 4. mouth line along the top edge of the lower lip
    if geom['shape'] == 'mbp':
        stroke(draw, top_points, fill=LINE, width=1.9, seed=7, supersample=scale, jitter=0.04)
        stroke(draw, [(x, y + 2.2) for x, y in top_points], fill=LINE_SOFT,
               width=1.1, seed=8, supersample=scale, jitter=0.04)
    else:
        stroke(draw, top_points, fill=LINE, width=1.9, seed=7, supersample=scale, jitter=0.04)

    return image.resize((width, height), Image.LANCZOS)


def build_brow(reference: Image.Image, side: str) -> Image.Image:
    box = BOXES[f'brow-{side}']
    x, y, w, h = [round(v) for v in (
        box[0] / 100 * W, box[1] / 100 * H, box[2] / 100 * W, box[3] / 100 * H,
    )]
    crop = reference.crop((x, y, x + w, y + h))
    px = crop.load()
    mask = Image.new('L', crop.size, 0)
    mask_px = mask.load()
    for yy in range(crop.height):
        for xx in range(crop.width):
            r, g, b, a = px[xx, yy]
            if a < 60:
                continue
            if luma((r, g, b, a)) < 158:
                mask_px[xx, yy] = 255
    # keep only the brow (the eye rim can clip the box), then feather the edge
    core_x = crop.width * (0.62 if side == 'left' else 0.38)
    core_y = crop.height * 0.42
    mask = largest_component(mask, (core_x, core_y))
    mask = mask.filter(ImageFilter.GaussianBlur(0.7))
    out = Image.new('RGBA', crop.size, (112, 101, 87, 255))
    out.putalpha(mask)
    return out


def shear_brow(brow: Image.Image, side: str, amount: float, lift: float = 0.0) -> Image.Image:
    """Shear the brow vertically so its inner end moves down (positive) or up."""
    width, height = brow.size
    inner_left = side == 'right'
    if inner_left:
        matrix = (1, 0, 0, amount, 1, -amount * width + lift)
    else:
        matrix = (1, 0, 0, -amount, 1, amount * width + lift)
    return brow.transform(brow.size, Image.AFFINE, matrix, resample=Image.BICUBIC)


def draw_lip(draw, top: float = 15.0, seed: int = 4, filled: bool = True):
    points = [
        (11, 24), (16, 19), (27, 15.5), (38, 15), (43, 17),
        (48, 15), (59, 15.5), (70, 19), (75, 24), (73, 30),
        (66, 35), (54, 37.5), (42, 38), (30, 37), (18, 34), (12, 30),
    ]
    shifted = []
    for x, y in points:
        if y > top:
            shifted.append((x, y))
        else:
            shifted.append((x, top + (y - 15) * 0.15))
    poly(draw, shifted, fill=SKIN, outline=LINE, width=1.5, seed=seed)
    # subtle lower-lip highlight
    if filled:
        poly(draw, [(30, 28), (42, 30), (54, 28), (50, 33), (42, 34), (34, 33)],
             fill=SKIN_LIGHT, outline=None, seed=seed + 1)


def build_mustache(original: Image.Image) -> Image.Image:
    image = original.copy()
    px = image.load()
    alpha = np.asarray(image.getchannel('A')).astype('uint16')
    skin = Image.new('L', image.size, 0)
    skin_px = skin.load()
    for y in range(image.height):
        for x in range(image.width):
            if warm_skin(px[x, y]):
                skin_px[x, y] = 255
    skin = fill_holes(skin)
    skin = dilate(skin, 1)
    remove = np.asarray(skin).astype('uint16')
    # the dark mouth slit sits on the lip's upper edge; clear it and the
    # anti-aliased fringe so the mouth shapes can draw a clean mouth line
    lip_zone = dilate(skin, 3)
    zone = np.asarray(lip_zone)
    for y in range(image.height):
        for x in range(image.width):
            if zone[y, x] > 128 and px[x, y][3] > 40 and luma(px[x, y]) < 120:
                remove[y, x] = 255
    alpha = alpha * (255 - remove) // 255
    image.putalpha(Image.fromarray(alpha.clip(0, 255).astype('uint8')))
    return image


def largest_component(mask: Image.Image, near: tuple) -> Image.Image:
    """Keep the connected component of a binary mask closest to ``near``."""
    import collections
    width, height = mask.size
    pixels = mask.load()
    labels = [[0] * width for _ in range(height)]
    best = None
    best_distance = 1e18
    current = 0
    for start_y in range(height):
        for start_x in range(width):
            if pixels[start_x, start_y] < 128 or labels[start_y][start_x]:
                continue
            current += 1
            queue = collections.deque([(start_x, start_y)])
            labels[start_y][start_x] = current
            points = []
            while queue:
                x, y = queue.popleft()
                points.append((x, y))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < width and 0 <= ny < height and not labels[ny][nx] and pixels[nx, ny] >= 128:
                        labels[ny][nx] = current
                        queue.append((nx, ny))
            if len(points) < 30:
                continue
            cx = sum(point[0] for point in points) / len(points)
            cy = sum(point[1] for point in points) / len(points)
            distance = (cx - near[0]) ** 2 + (cy - near[1]) ** 2
            if distance < best_distance:
                best_distance = distance
                best = points
    out = Image.new('L', mask.size, 0)
    if best:
        draw = ImageDraw.Draw(out)
        for x, y in best:
            draw.point((x, y), fill=255)
    return out


def build_ear(reference: Image.Image, side: str) -> Image.Image:
    x, y, w, h = [round(v) for v in (
        BOXES[f'ear-{side}'][0] / 100 * W, BOXES[f'ear-{side}'][1] / 100 * H,
        BOXES[f'ear-{side}'][2] / 100 * W, BOXES[f'ear-{side}'][3] / 100 * H,
    )]
    crop = reference.crop((x, y, x + w, y + h))
    px = crop.load()
    skin = Image.new('L', crop.size, 0)
    skin_px = skin.load()
    for yy in range(crop.height):
        for xx in range(crop.width):
            if warm_skin(px[xx, yy]):
                skin_px[xx, yy] = 255
    core = {'left': (54 - x, 200 - y), 'right': (290 - x, 204 - y)}[side]
    ear = largest_component(skin, core)
    keep = dilate(ear, 1)
    # include the dark ink outline that sits directly around the ear
    outline = Image.new('L', crop.size, 0)
    outline_px = outline.load()
    zone = dilate(ear, 4)
    zone_px = zone.load()
    for yy in range(crop.height):
        for xx in range(crop.width):
            if zone_px[xx, yy] > 128 and px[xx, yy][3] > 60 and luma(px[xx, yy]) < 100:
                outline_px[xx, yy] = 255
    combined = Image.fromarray(
        (np.asarray(keep).astype('uint16') | np.asarray(outline).astype('uint16')).astype('uint8')
    )
    combined = combined.filter(ImageFilter.GaussianBlur(0.6))
    out = crop.copy()
    out.putalpha(combined)
    return out


def save(image: Image.Image, name: str):
    path = os.path.join(ASSETS, name)
    image.save(path, optimize=True)
    return path


def relative_percent_box(box):
    return {'x': round(box[0], 2), 'y': round(box[1], 2), 'w': round(box[2], 2), 'h': round(box[3], 2)}


# ── Main ────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preview', action='store_true', help='write QA preview sheets')
    args = parser.parse_args()

    os.makedirs(ASSETS, exist_ok=True)
    reference = load(os.path.join(PROJECT, 'reference.png'))

    # source cut-outs placed on the full canvas (used for mask math)
    base_cutouts = {
        'beard': to_canvas(load(os.path.join(SEGMENTS, 'gray-beard.png')), BOXES['beard']),
        'hair-front': to_canvas(load(os.path.join(SEGMENTS, 'long-gray-hair', 'long-gray-hair-1.png')), BOXES['hair-front']),
        'hair-back': to_canvas(load(os.path.join(SEGMENTS, 'long-gray-hair', 'long-gray-hair-2.png')), BOXES['hair-back']),
        'shirt': to_canvas(load(os.path.join(SEGMENTS, 'black-shirt.png')), BOXES['shirt']),
        'hand-left': to_canvas(load(os.path.join(SEGMENTS, 'hands', 'hands-2.png')), BOXES['hand-left']),
        'hand-right': to_canvas(load(os.path.join(SEGMENTS, 'hands', 'hands-1.png')), BOXES['hand-right']),
    }
    ears = {side: build_ear(reference, side) for side in ('left', 'right')}
    for side, image in ears.items():
        base_cutouts[f'ear-{side}'] = to_canvas(image, BOXES[f'ear-{side}'])

    # 1. face plate
    face_plate = build_face_plate(reference, base_cutouts)
    save(face_plate, 'face-base.png')

    # 2. eyes / pupils / highlights
    for side in ('left', 'right'):
        eye_path = os.path.join(SEGMENTS, 'large-white-eyes', f'{EYE_NAMES[side]}.png')
        clean = build_clean_eye(eye_path, BOXES[f'eye-{side}'])
        save(clean, f'eye-white-{side}.png')
        pupil = load(os.path.join(SEGMENTS, 'black-pupils', f'{PUPIL_NAMES[side]}.png'))
        save(pupil, f'pupil-{side}.png')
        save(build_highlight(), f'eye-highlight-{side}.png')

    # 3. eyelids
    for side in ('left', 'right'):
        eye_path = os.path.join(SEGMENTS, 'large-white-eyes', f'{EYE_NAMES[side]}.png')
        save(build_eyelid(eye_path, 'half'), f'eyelid-half-{side}.png')
        save(build_eyelid(eye_path, 'closed'), f'eyelid-closed-{side}.png')

    # 4. brows
    for side in ('left', 'right'):
        neutral = build_brow(reference, side)
        save(neutral, f'brow-{side}-neutral.png')
        save(neutral.transform(neutral.size, Image.AFFINE, (1, 0, 0, 0, 1, -2.5), resample=Image.BICUBIC),
             f'brow-{side}-raised.png')
        save(shear_brow(neutral, side, 0.13, 1.0), f'brow-{side}-furrowed.png')
        save(shear_brow(neutral, side, -0.11, 0.0), f'brow-{side}-sad.png')

    # 5. mouths
    for viseme in ('rest', 'a', 'e', 'i', 'o', 'u', 'mbp', 'fv', 'l', 'wq', 'smile', 'frown', 'open'):
        save(build_mouth(viseme), f'mouth-{viseme}.png')

    # 6. mustache + support art
    save(build_mustache(load(os.path.join(SEGMENTS, 'mustache.png'))), 'mustache-upper.png')
    for name, box in (('beard', 'beard'), ('hair-front', 'hair-front'), ('hair-back', 'hair-back'),
                      ('shirt', 'shirt'), ('hand-left', 'hand-left'), ('hand-right', 'hand-right')):
        source = {
            'beard': os.path.join(SEGMENTS, 'gray-beard.png'),
            'hair-front': os.path.join(SEGMENTS, 'long-gray-hair', 'long-gray-hair-1.png'),
            'hair-back': os.path.join(SEGMENTS, 'long-gray-hair', 'long-gray-hair-2.png'),
            'shirt': os.path.join(SEGMENTS, 'black-shirt.png'),
            'hand-left': os.path.join(SEGMENTS, 'hands', 'hands-2.png'),
            'hand-right': os.path.join(SEGMENTS, 'hands', 'hands-1.png'),
        }[name]
        save(load(source), f'{name}.png')
    for side, image in ears.items():
        save(image, f'ear-{side}.png')

    # 7. manifest
    def asset(file, part, group, variant, name, box, z, visible=True, opacity=1.0, rig=True, extra=None):
        entry = {
            'file': file,
            'part': part,
            'group': group,
            'variant': variant,
            'name': name,
            'box': relative_percent_box(box),
            'z': z,
            'visible': visible,
            'opacity': opacity,
            'rig': rig,
            'role': 'character-part',
        }
        if extra:
            entry.update(extra)
        return entry

    assets = [
        asset('face-base.png', 'face', 'face', 'base', 'Face base', BOXES['face'], 1),
        asset('eye-white-left.png', 'eyes', 'eye-left', 'open', 'Eye white L', BOXES['eye-left'], 21),
        asset('eye-white-right.png', 'eyes', 'eye-right', 'open', 'Eye white R', BOXES['eye-right'], 23),
        asset('pupil-left.png', 'pupils', 'pupil-left', 'center', 'Pupil L', BOXES['pupil-left'], 22),
        asset('pupil-right.png', 'pupils', 'pupil-right', 'center', 'Pupil R', BOXES['pupil-right'], 24),
        asset('eye-highlight-left.png', 'highlights', 'highlight-left', 'lit', 'Eye light L', BOXES['pupil-left'], 25),
        asset('eye-highlight-right.png', 'highlights', 'highlight-right', 'lit', 'Eye light R', BOXES['pupil-right'], 26),
        asset('eyelid-half-left.png', 'eyelids', 'eyelid-left', 'half', 'Eyelid half L', BOXES['eye-left'], 28, opacity=0.0),
        asset('eyelid-closed-left.png', 'eyelids', 'eyelid-left', 'closed', 'Eyelid closed L', BOXES['eye-left'], 28, opacity=0.0),
        asset('eyelid-half-right.png', 'eyelids', 'eyelid-right', 'half', 'Eyelid half R', BOXES['eye-right'], 28, opacity=0.0),
        asset('eyelid-closed-right.png', 'eyelids', 'eyelid-right', 'closed', 'Eyelid closed R', BOXES['eye-right'], 28, opacity=0.0),
        asset('mustache-upper.png', 'mustache', 'mustache', 'upper', 'Mustache', BOXES['mustache'], 20),
        asset('beard.png', 'beard', 'beard', 'main', 'Gray beard', BOXES['beard'], 8),
        asset('hair-front.png', 'head', 'hair-front', 'front', 'Hair front', BOXES['hair-front'], 14),
        asset('hair-back.png', 'head', 'hair-back', 'back', 'Hair back', BOXES['hair-back'], 16),
        asset('shirt.png', 'body', 'shirt', 'main', 'Black shirt', BOXES['shirt'], 6),
        asset('hand-left.png', 'hands', 'hand-left', 'open', 'Hand L', BOXES['hand-left'], 10),
        asset('hand-right.png', 'hands', 'hand-right', 'open', 'Hand R', BOXES['hand-right'], 12),
        asset('ear-left.png', 'ears', 'ear-left', 'base', 'Ear L', BOXES['ear-left'], 17),
        asset('ear-right.png', 'ears', 'ear-right', 'base', 'Ear R', BOXES['ear-right'], 17),
    ]
    for side in ('left', 'right'):
        for pose, z in (('neutral', 0), ('raised', 1), ('furrowed', 2), ('sad', 3)):
            assets.append(asset(
                f'brow-{side}-{pose}.png', 'brows', f'brow-{side}', pose,
                f'Brow {side} {pose}', BOXES[f'brow-{side}'], 30 + z,
                opacity=1.0 if pose == 'neutral' else 0.0,
            ))
    for index, viseme in enumerate(('rest', 'a', 'e', 'i', 'o', 'u', 'mbp', 'fv', 'l', 'wq', 'smile', 'frown', 'open')):
        assets.append(asset(
            f'mouth-{viseme}.png', 'mouth', 'mouth', viseme, f'Mouth {viseme}',
            BOXES['mouth'], 19 + index * 0.01,
            opacity=1.0 if viseme == 'rest' else 0.0,
        ))

    manifest = {
        'schema': 'layer-studio/asset-pack/v1',
        'name': 'Beards',
        'canvas': {'width': W, 'height': H},
        'source': 'reference.png',
        'assets': assets,
        'groups': {
            'eyelid-left': ['half', 'closed'],
            'eyelid-right': ['half', 'closed'],
            'brow-left': ['neutral', 'raised', 'furrowed', 'sad'],
            'brow-right': ['neutral', 'raised', 'furrowed', 'sad'],
            'mouth': ['rest', 'a', 'e', 'i', 'o', 'u', 'mbp', 'fv', 'l', 'wq', 'smile', 'frown', 'open'],
        },
        'notes': [
            'Every PNG is authored on the 348x546 scene canvas.',
            'Variant layers share one box and switch through opacity keyframes.',
            'Replace a file, keep the name, rerun tools/apply-beards-rig.js.',
        ],
    }
    with open(os.path.join(ASSETS, 'manifest.json'), 'w', encoding='utf-8') as handle:
        json.dump(manifest, handle, indent=2)
        handle.write('\n')

    if args.preview:
        write_previews(assets)
        write_alignment_guide(reference)

    print(f'wrote {len(assets)} assets to {ASSETS}')
    return 0


def guide_font(size: int):
    for path in ('/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass
    return ImageFont.load_default()


def write_alignment_guide(reference: Image.Image):
    scale = 2
    guide = Image.new('RGBA', (W * scale, H * scale), (255, 255, 255, 255))
    guide.alpha_composite(reference.resize((W * scale, H * scale), Image.LANCZOS))
    draw = ImageDraw.Draw(guide)
    features = [
        ('brow-left', 'brow L', (32, 110, 210), 'above'),
        ('brow-right', 'brow R', (32, 110, 210), 'above'),
        ('eye-left', 'eye L', (210, 44, 40), 'below'),
        ('eye-right', 'eye R', (210, 44, 40), 'below'),
        ('pupil-left', 'pupil L', (140, 20, 20), None),
        ('pupil-right', 'pupil R', (140, 20, 20), None),
        ('mustache', 'mustache', (160, 90, 10), 'inside'),
        ('mouth', 'mouth', (228, 120, 10), 'below'),
        ('ear-left', 'ear L', (0, 150, 120), 'above'),
        ('ear-right', 'ear R', (0, 150, 120), 'above'),
        ('hand-left', 'hand L', (0, 150, 120), 'above'),
        ('hand-right', 'hand R', (0, 150, 120), 'above'),
    ]
    for name, text, color, placement in features:
        box = BOXES[name]
        x0 = box[0] / 100 * W * scale
        y0 = box[1] / 100 * H * scale
        x1 = x0 + box[2] / 100 * W * scale
        y1 = y0 + box[3] / 100 * H * scale
        draw.rectangle((x0, y0, x1, y1), outline=color, width=2)
        if not placement:
            continue
        if placement == 'below':
            tx, ty = x0 + 2, y1 + 3
        elif placement == 'inside':
            tx, ty = x0 + 3, y0 + 2
        else:
            tx, ty = x0 + 2, max(2, y0 - 21)
        tw = draw.textlength(text, font=guide_font(17))
        draw.rectangle((tx - 2, ty - 1, tx + tw + 2, ty + 19), fill=(255, 255, 255, 230))
        draw.text((tx, ty), text, font=guide_font(17), fill=color)
    legend = [
        ('eyes', (210, 44, 40)),
        ('pupils / highlights', (140, 20, 20)),
        ('brows', (32, 110, 210)),
        ('mouth', (228, 120, 10)),
        ('mustache', (160, 90, 10)),
        ('ears / hands', (0, 150, 120)),
    ]
    box_w, box_h = 250, 23 * len(legend) + 14
    draw.rectangle((W * scale - box_w - 8, H * scale - box_h - 8,
                    W * scale - 8, H * scale - 8), fill=(255, 255, 255, 238), outline=(60, 60, 60, 255))
    for index, (text, color) in enumerate(legend):
        y = H * scale - box_h - 1 + index * 23
        draw.rectangle((W * scale - box_w, y + 4, W * scale - box_w + 13, y + 17), fill=color)
        draw.text((W * scale - box_w + 20, y), text, font=guide_font(16), fill=(28, 28, 28))
    guide.save(os.path.join(ASSETS, '_alignment-guide.png'))


def write_previews(assets):
    names = ['face-base.png', 'eye-white-left.png', 'eye-white-right.png',
             'pupil-left.png', 'eye-highlight-left.png', 'eyelid-half-left.png', 'eyelid-closed-left.png',
             'eyelid-half-right.png', 'eyelid-closed-right.png',
             'brow-left-neutral.png', 'brow-left-raised.png', 'brow-left-furrowed.png', 'brow-left-sad.png',
             'brow-right-neutral.png', 'brow-right-raised.png', 'brow-right-furrowed.png', 'brow-right-sad.png',
             'mouth-rest.png', 'mouth-a.png', 'mouth-e.png', 'mouth-i.png', 'mouth-o.png', 'mouth-u.png',
             'mouth-mbp.png', 'mouth-fv.png', 'mouth-l.png', 'mouth-wq.png', 'mouth-smile.png',
             'mouth-frown.png', 'mouth-open.png', 'mustache-upper.png', 'ear-left.png', 'ear-right.png',
             'beard.png', 'hair-front.png', 'hair-back.png', 'shirt.png', 'hand-left.png', 'hand-right.png']
    cell = 190
    cols = 6
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * cell, rows * (cell + 20)), (250, 250, 250, 255))
    draw = ImageDraw.Draw(sheet)
    for index, name in enumerate(names):
        image = load(os.path.join(ASSETS, name))
        image.thumbnail((cell - 16, cell - 16), Image.LANCZOS)
        x = (index % cols) * cell
        y = (index // cols) * (cell + 20)
        for yy in range(y, y + cell, 10):
            for xx in range(x, x + cell, 10):
                if ((xx // 10) + (yy // 10)) % 2 == 0:
                    draw.rectangle((xx, yy, xx + 9, yy + 9), fill=(230, 230, 230, 255))
        sheet.alpha_composite(image, (x + 8, y + 8))
        draw.text((x + 6, y + cell + 2), name, fill=(20, 20, 20, 255))
    sheet.save(os.path.join(ASSETS, '_preview-sheet.png'))

    # Head preview: plate + cut-outs, no reference, at rest.
    head = Image.new('RGBA', (W, H), (255, 255, 255, 255))
    manifest = json.load(open(os.path.join(ASSETS, 'manifest.json'), encoding='utf-8'))
    for entry in sorted(manifest['assets'], key=lambda item: item['z']):
        if entry['opacity'] <= 0:
            continue
        image = to_canvas(load(os.path.join(ASSETS, entry['file'])), (
            entry['box']['x'], entry['box']['y'], entry['box']['w'], entry['box']['h'],
        ))
        state = image.getchannel('A')
        if entry['opacity'] < 1:
            state = state.point(lambda value: round(value * entry['opacity']))
            image.putalpha(state)
        head.alpha_composite(image)
    head.crop((0, 0, W, 420)).resize((W * 2, 840), Image.LANCZOS).save(
        os.path.join(ASSETS, '_preview-head.png'),
    )


if __name__ == '__main__':
    raise SystemExit(main())
