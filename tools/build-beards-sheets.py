#!/usr/bin/env python3
"""Compose the Beards preview contact sheets from rendered frames."""

from __future__ import annotations

import argparse
import os
import shutil

from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/Library/Fonts/Arial.ttf',
]


def font(size: int):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass
    return ImageFont.load_default()


def label(draw: ImageDraw.ImageDraw, text: str, x: int, y: int, size: int = 22, fill=(30, 30, 30)):
    draw.text((x, y), text, font=font(size), fill=fill)


def checker(size):
    image = Image.new('RGBA', size, (250, 250, 250, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], 14):
        for x in range(0, size[0], 14):
            if ((x // 14) + (y // 14)) % 2 == 0:
                draw.rectangle((x, y, x + 13, y + 13), fill=(242, 242, 242, 255))
    return image


def load(path):
    return Image.open(path).convert('RGBA')


def build_expressions(frames, out):
    names = ['neutral', 'happy', 'sad', 'surprised', 'angry']
    crops = []
    for name in names:
        image = load(os.path.join(frames, f'expression-{name}.png'))
        # head and shoulders
        crop = image.crop((30, 10, image.width - 30, int(image.height * 0.76)))
        crop = crop.resize((360, 420), Image.LANCZOS)
        crops.append((name, crop))
    width = len(crops) * 380 + 20
    sheet = Image.new('RGBA', (width, 470), (255, 255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    for index, (name, crop) in enumerate(crops):
        x = 10 + index * 380
        sheet.alpha_composite(crop, (x, 10))
        label(draw, name, x + 8, 438, 22)
    sheet.save(os.path.join(out, 'beards-expressions.png'))


def build_visemes(frames, out):
    names = ['rest', 'a', 'e', 'i', 'o', 'u', 'mbp', 'fv', 'l', 'wq', 'smile', 'frown', 'open']
    columns = 5
    cell_w, cell_h = 300, 240
    rows = (len(names) + columns - 1) // columns
    sheet = Image.new('RGBA', (columns * cell_w + 20, rows * cell_h + 20), (255, 255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    for index, name in enumerate(names):
        image = load(os.path.join(frames, f'viseme-{name}.png'))
        crop = image.crop((210, 450, 510, 660)).resize((280, 196), Image.LANCZOS)
        x = 10 + (index % columns) * cell_w
        y = 10 + (index // columns) * cell_h
        sheet.alpha_composite(crop, (x, y))
        label(draw, name, x + 6, y + 200, 20)
    sheet.save(os.path.join(out, 'beards-mouths.png'))


def build_blink(frames, out):
    count = 7
    cell_w, cell_h = 390, 280
    sheet = Image.new('RGBA', (count * cell_w + 20, cell_h + 20), (255, 255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    labels = ['-180 ms', '-120 ms', '-60 ms', 'blink', '+60 ms', '+120 ms', '+180 ms']
    for index in range(count):
        image = load(os.path.join(frames, f'blink-{index}.png'))
        crop = image.crop((140, 250, 530, 480)).resize((370, 218), Image.LANCZOS)
        x = 10 + index * cell_w
        sheet.alpha_composite(crop, (x, 10))
        label(draw, labels[index], x + 6, 238, 18)
    sheet.save(os.path.join(out, 'beards-blink.png'))


def build_filmstrip(frames, out):
    indices = [0, 48, 96, 144, 192, 228]
    cell_w, cell_h = 348, 546
    sheet = Image.new('RGBA', (len(indices) * (cell_w + 8) + 8, cell_h + 40), (255, 255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    for column, index in enumerate(indices):
        path = os.path.join(frames, f'talk-{index:04d}.png')
        if not os.path.exists(path):
            continue
        image = load(path).resize((cell_w, cell_h), Image.LANCZOS)
        x = 8 + column * (cell_w + 8)
        sheet.alpha_composite(image, (x, 8))
        label(draw, f'{index / 24:.1f}s', x + 6, cell_h + 12, 18)
    sheet.save(os.path.join(out, 'beards-filmstrip.png'))


def build_comparison(frames, out, project):
    reference = load(os.path.join(project, 'reference.png'))
    rest = load(os.path.join(frames, 'rest.png'))
    height = 820
    ref = reference.resize((int(reference.width * height / reference.height), height), Image.LANCZOS)
    rig = rest.resize((int(rest.width * height / rest.height), height), Image.LANCZOS)
    sheet = Image.new('RGBA', (ref.width + rig.width + 30, height + 50), (255, 255, 255, 255))
    sheet.alpha_composite(ref, (10, 40))
    sheet.alpha_composite(rig, (ref.width + 20, 40))
    draw = ImageDraw.Draw(sheet)
    label(draw, 'Reference / final image', 12, 10, 22)
    label(draw, 'Rig v3 — cut-outs only, reference hidden', ref.width + 22, 10, 22)
    sheet.save(os.path.join(out, 'beards-rig-vs-reference.png'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--frames', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--project', default=None)
    args = parser.parse_args()
    project = args.project or os.path.dirname(os.path.abspath(args.out))
    os.makedirs(args.out, exist_ok=True)

    build_expressions(args.frames, args.out)
    build_visemes(args.frames, args.out)
    build_blink(args.frames, args.out)
    build_filmstrip(args.frames, args.out)
    build_comparison(args.frames, args.out, project)

    asset_sheet = os.path.join(project, 'assets', '_preview-sheet.png')
    if os.path.exists(asset_sheet):
        shutil.copyfile(asset_sheet, os.path.join(args.out, 'beards-assets.png'))
    print(f'sheets written to {args.out}')


if __name__ == '__main__':
    main()
