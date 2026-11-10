#!/usr/bin/env python3
"""Build the reusable segment-group library.

A *segment group* is the named set of cut-out layers that belongs together in
a composition -- clouds, sea and waves, birds, a character, a table setting,
the light effects. The group is the portable unit: it carries its members, the
source composition, a composited preview and the motion recipes that make
sense for it. An agent can copy a group into a new scene and apply one of its
motions without re-segmenting anything.

Sources (deliberately limited to the three roots that hold the authored work):

    data/imports/*/composition.json
    data/library/designs/*.json        (each points at its project composition)
    data/projects/0-0-Butterfly--bar-santa/compositions/*.composition.json

Output:

    data/library/segment-groups/
        index.json          catalogue of groups, categories and motions
        groups/<id>.json    full group document (members, sources, agent block)
        motions.json        reusable motion recipes
        thumbs/*.webp       composited previews (and small card versions)
        README.md           generated notes for humans and agents

Run:  .venv/bin/python scripts/build-segment-library.py
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - the venv ships Pillow
    sys.exit('Pillow is required: .venv/bin/python scripts/build-segment-library.py')

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
LIBRARY = DATA / 'library'
OUT = LIBRARY / 'segment-groups'
GROUPS_DIR = OUT / 'groups'
THUMBS_DIR = OUT / 'thumbs'

SCHEMA = 'studio/segment-groups/1'
MOTION_SCHEMA = 'studio/segment-group-motions/1'
BAR_SANTA_PROJECT = '0-0-Butterfly--bar-santa'
SKIP_COMPOSITION_NAMES = ('composition.pre-v3.json',)

PREVIEW_MAX = 900
CARD_MAX = 360
PAD_PERCENT = 2.5
COMPOSITE_LIMIT = 70

# ── taxonomy ────────────────────────────────────────────────────────────────

CATEGORIES = [
    {
        'id': 'sky-clouds',
        'label': 'Sky & clouds',
        'description': 'Sky plates, cloud cover, sun, snow and weather layers.',
        'color': '#6d8fb8',
        'motions': ['cloud-drift', 'cloud-breathe', 'snow-fall'],
    },
    {
        'id': 'sea-waves',
        'label': 'Sea & waves',
        'description': 'Sea bands, rolling waves, whitecaps, shorelines and water glints.',
        'color': '#3f8f9c',
        'motions': ['wave-roll', 'tide-rise'],
    },
    {
        'id': 'birds-wildlife',
        'label': 'Birds & wildlife',
        'description': 'Gulls, paper birds and other fauna that cross the frame.',
        'color': '#8a7f55',
        'motions': ['bird-flight', 'float'],
    },
    {
        'id': 'characters',
        'label': 'Characters',
        'description': 'People, anthropomorphic subjects and character part sets.',
        'color': '#b0624f',
        'motions': ['character-breathe', 'character-sway'],
    },
    {
        'id': 'nature',
        'label': 'Landscape & vegetation',
        'description': 'Trees, grass, flora, mountains, fields and landscape bands.',
        'color': '#6f8f5f',
        'motions': ['breeze-sway', 'cloud-drift'],
    },
    {
        'id': 'architecture',
        'label': 'Architecture & places',
        'description': 'Buildings, rooms, staircases, shop fronts and interiors.',
        'color': '#9a8264',
        'motions': ['parallax-drift'],
    },
    {
        'id': 'props',
        'label': 'Props & objects',
        'description': 'Furniture, tableware, books, products, decor and small objects.',
        'color': '#b08a4e',
        'motions': ['float'],
    },
    {
        'id': 'text',
        'label': 'Text & lettering',
        'description': 'Letter and wordmark cut-outs; use a text layer instead when possible.',
        'color': '#7a6c9a',
        'motions': ['hold'],
    },
    {
        'id': 'effects',
        'label': 'Light & effects',
        'description': 'Glows, sparkles, smoke, flashes, glints and lighting rigs.',
        'color': '#c49a3a',
        'motions': ['glow-pulse', 'sparkle', 'smoke-rise'],
    },
    {
        'id': 'foreground',
        'label': 'Foreground',
        'description': 'Near-camera framing layers, borders, barriers and foreground tools.',
        'color': '#8a6a58',
        'motions': ['parallax-drift'],
    },
    {
        'id': 'background',
        'label': 'Background',
        'description': 'Background plates, ground, floors, base washes and recovered pixels.',
        'color': '#6f7580',
        'motions': ['parallax-drift'],
    },
    {
        'id': 'other',
        'label': 'Other',
        'description': 'Groups whose label does not map onto the known categories yet.',
        'color': '#8b8b8b',
        'motions': ['float'],
    },
]

ALIASES = {
    'cloud': 'sky-clouds', 'clouds': 'sky-clouds', 'cloud-wooven': 'sky-clouds',
    'sky': 'sky-clouds', 'sky elements': 'sky-clouds', 'sky patches': 'sky-clouds',
    'sky life': 'sky-clouds', 'sun': 'sky-clouds', 'moon': 'sky-clouds',
    'stars': 'sky-clouds', 'rain': 'sky-clouds', 'snow': 'sky-clouds',
    'weather': 'sky-clouds', 'atmosphere': 'sky-clouds', 'aurora': 'sky-clouds',
    'sea': 'sea-waves', 'ocean': 'sea-waves', 'waves': 'sea-waves',
    'wave details': 'sea-waves', 'shoreline': 'sea-waves', 'glints': 'sea-waves',
    'water': 'sea-waves', 'foam': 'sea-waves', 'tide': 'sea-waves',
    'sea-glass scallops': 'sea-waves',
    'birds': 'birds-wildlife', 'bird': 'birds-wildlife', 'gull': 'birds-wildlife',
    'gulls': 'birds-wildlife', 'seagulls': 'birds-wildlife', 'gull-wooven': 'birds-wildlife',
    'fauna': 'birds-wildlife', 'wildlife': 'birds-wildlife', 'insects': 'birds-wildlife',
    'animals': 'birds-wildlife',
    'subject': 'characters', 'character': 'characters', 'characters': 'characters',
    'cyclist': 'characters', 'figure': 'characters', 'people': 'characters',
    'person': 'characters', 'santa': 'characters', 'face': 'characters',
    'hands': 'characters', 'head': 'characters', 'body': 'characters',
    'vegetation': 'nature', 'flora': 'nature', 'nature': 'nature',
    'landscape': 'nature', 'mountains': 'nature', 'trees': 'nature',
    'grass': 'nature', 'plants': 'nature', 'garden': 'nature',
    'flowers': 'nature', 'field': 'nature', 'floral decor': 'props',
    'architecture': 'architecture', 'buildings': 'architecture',
    'building': 'architecture', 'room': 'architecture', 'rooms': 'architecture',
    'staircase': 'architecture', 'cafe front': 'architecture',
    'background architecture': 'architecture', 'interior': 'architecture',
    'exterior': 'architecture', 'doorway': 'architecture',
    'props': 'props', 'prop': 'props', 'books': 'props', 'book': 'props',
    'tableware': 'props', 'table setting': 'props', 'furniture': 'props',
    'glassware': 'props', 'cocktail glass': 'props', 'garnish': 'props',
    'signage': 'props', 'vehicles': 'props', 'bicycle': 'props',
    'miniature props': 'props', 'patches': 'props', 'logo elements': 'props',
    'wall art': 'props', 'wall decor': 'props', 'decor': 'props',
    'details': 'props', 'detail': 'props', 'bar': 'props',
    'text': 'text', 'large text': 'text', 'small text': 'text',
    'letters': 'text', 'letter': 'text', 'wordmark': 'text',
    'thundercat text': 'text', 'pub+diner text': 'text',
    'text elements': 'text',
    'animation fx': 'effects', 'lighting': 'effects',
    'light animation': 'effects', 'effects': 'effects',
    'lighting rig': 'effects', 'shadow': 'effects', 'smoke': 'effects',
    'foreground': 'foreground', 'foreground tools': 'foreground',
    'foreground workbench': 'foreground', 'border': 'foreground',
    'barriers': 'foreground',
    'background': 'background', 'base': 'background', 'midground': 'background',
    'floor': 'background', 'ground': 'background', 'recovered': 'background',
    'unassigned': 'background',
}

# Order matters: the first keyword found in the lower-case label wins.
KEYWORDS = [
    ('cloud', 'sky-clouds'), ('sky', 'sky-clouds'), ('snow', 'sky-clouds'),
    ('rain', 'sky-clouds'), ('sun', 'sky-clouds'), ('sunset', 'sky-clouds'),
    ('wave', 'sea-waves'), ('sea', 'sea-waves'), ('ocean', 'sea-waves'),
    ('tide', 'sea-waves'), ('shore', 'sea-waves'), ('glint', 'sea-waves'),
    ('foam', 'sea-waves'), ('water', 'sea-waves'),
    ('bird', 'birds-wildlife'), ('gull', 'birds-wildlife'),
    ('character', 'characters'), ('subject', 'characters'),
    ('cyclist', 'characters'), ('farmer', 'characters'), ('pig', 'characters'),
    ('figure', 'characters'), ('dots', 'characters'),
    ('tree', 'nature'), ('grass', 'nature'), ('veget', 'nature'),
    ('flora', 'nature'), ('flower', 'nature'), ('plant', 'nature'),
    ('leaf', 'nature'), ('mountain', 'nature'), ('landscape', 'nature'),
    ('building', 'architecture'), ('architecture', 'architecture'),
    ('stair', 'architecture'), ('room', 'architecture'), ('cafe', 'architecture'),
    ('book', 'props'), ('tableware', 'props'), ('glass', 'props'),
    ('furniture', 'props'), ('prop', 'props'), ('sign', 'props'),
    ('bicycle', 'props'), ('decor', 'props'), ('patch', 'props'),
    ('letter', 'text'), ('text', 'text'), ('wordmark', 'text'),
    ('smoke', 'effects'), ('steam', 'effects'), ('sparkle', 'effects'),
    ('glow', 'effects'), ('light', 'effects'), ('shine', 'effects'),
    ('flash', 'effects'), ('candle', 'effects'), ('lantern', 'effects'),
    ('foreground', 'foreground'), ('border', 'foreground'),
    ('barrier', 'foreground'),
    ('background', 'background'), ('ground', 'background'), ('floor', 'background'),
    ('base', 'background'), ('midground', 'background'),
]

# Prefixes that are safe to use as an inferred group. Anything else falls back
# to the layer role, so a colour name like "teal-felt-wave-band" never becomes
# a "Teal" group.
KNOWN_PREFIXES = {
    'background': 'Background', 'backgrounds': 'Background',
    'foreground': 'Foreground', 'fg': 'Foreground',
    'book': 'Books', 'books': 'Books',
    'prop': 'Props', 'props': 'Props',
    'detail': 'Details', 'details': 'Details',
    'cloud': 'Clouds', 'clouds': 'Clouds',
    'wave': 'Waves', 'waves': 'Waves',
    'sea': 'Sea', 'ocean': 'Sea', 'sky': 'Sky',
    'bird': 'Birds', 'birds': 'Birds', 'gull': 'Birds', 'gulls': 'Birds',
    'seagull': 'Birds', 'seagulls': 'Birds',
    'tree': 'Vegetation', 'trees': 'Vegetation',
    'grass': 'Vegetation', 'plant': 'Vegetation', 'flower': 'Vegetation',
    'character': 'Character', 'characters': 'Character',
    'subject': 'Subject', 'figure': 'Character',
    'building': 'Buildings', 'buildings': 'Buildings',
    'stair': 'Staircase', 'stairs': 'Staircase',
    'text': 'Text', 'letter': 'Letters', 'letters': 'Letters',
    'frame': 'Frames', 'bottle': 'Bottles', 'glass': 'Glassware',
    'table': 'Tableware', 'chair': 'Furniture', 'lamp': 'Lighting',
    'smoke': 'Smoke', 'sparkle': 'Sparkles', 'glow': 'Glows',
}

ROLE_GROUPS = {
    'character': 'Character', 'character-part': 'Character',
    'prop': 'Props', 'ground': 'Ground', 'background': 'Background',
    'foreground': 'Foreground', 'effect': 'Effects',
    'text': 'Text', 'headline': 'Text', 'body': 'Text', 'cta': 'Text',
    'logo': 'Logo Elements', 'image': '',
}

# ── motion recipes ──────────────────────────────────────────────────────────

def motion(id, label, summary, duration, loop, phase, keys, categories, tags, easing='sine'):
    return {
        'id': id,
        'label': label,
        'summary': summary,
        'duration': duration,
        'loop': loop,
        'easing': easing,
        'phase': phase,
        'categories': categories,
        'tags': tags,
        'keys': keys,
    }


MOTIONS = [
    motion('cloud-drift', 'Cloud drift',
           'Slow horizontal drift with a gentle rise and a whisper of scale. Reads as weather, never as a camera move.',
           16000, True, 'stagger',
           {'dx': [[0, 0], [0.5, 0.018], [1, 0]], 'dy': [[0, 0], [0.5, -0.005], [1, 0]],
            's': [[0, 1], [0.5, 1.025], [1, 1]], 'rot': [[0, 0], [0.5, 0.35], [1, 0]],
            'a': [[0, 1], [1, 1]]},
           ['sky-clouds'], ['loop', 'ambient', 'sky']),
    motion('cloud-breathe', 'Cloud breathe',
           'A very small scale/opacity swell. Use on a static sky plate that must not travel.',
           9000, True, 'sync',
           {'dx': [[0, 0], [1, 0]], 'dy': [[0, 0], [1, 0]],
            's': [[0, 1], [0.5, 1.022], [1, 1]], 'rot': [[0, 0], [1, 0]],
            'a': [[0, 1], [0.5, 0.95], [1, 1]]},
           ['sky-clouds'], ['loop', 'ambient']),
    motion('wave-roll', 'Wave roll',
           'A looping horizontal surge with a slight lift, phase-shifted across the wave bands.',
           5200, True, 'alternate',
           {'dx': [[0, 0], [0.25, 0.011], [0.55, -0.006], [0.8, 0.008], [1, 0]],
            'dy': [[0, 0], [0.3, 0.009], [0.6, -0.004], [1, 0]],
            's': [[0, 1], [0.5, 1.008], [1, 1]], 'rot': [[0, 0], [0.35, 0.6], [0.7, -0.45], [1, 0]],
            'a': [[0, 1], [1, 1]]},
           ['sea-waves'], ['loop', 'water']),
    motion('tide-rise', 'Tide rise',
           'A slow, almost imperceptible rise and fall of the whole water band.',
           8000, True, 'sync',
           {'dx': [[0, 0], [1, 0]], 'dy': [[0, 0], [0.5, -0.012], [1, 0]],
            's': [[0, 1], [0.5, 1.006], [1, 1]], 'rot': [[0, 0], [1, 0]],
            'a': [[0, 1], [1, 1]]},
           ['sea-waves'], ['loop', 'water', 'ambient']),
    motion('bird-flight', 'Bird flight',
           'A long arc across the frame with a shallow bank. Stagger members so the flock does not move as one block.',
           9000, True, 'stagger',
           {'dx': [[0, -0.012], [0.5, 0.022], [1, 0.05]], 'dy': [[0, 0.004], [0.5, -0.014], [1, -0.006]],
            's': [[0, 0.98], [0.5, 1.02], [1, 0.98]], 'rot': [[0, -2], [0.5, 3], [1, -1]],
            'a': [[0, 1], [0.9, 1], [1, 0.85]]},
           ['birds-wildlife'], ['loop', 'flight', 'travel']),
    motion('character-breathe', 'Character breathe',
           'A tiny chest-scale rise and settle. Keeps a cut-out character alive without moving its feet.',
           4200, True, 'sync',
           {'dx': [[0, 0], [1, 0]], 'dy': [[0, 0], [0.5, -0.0018], [1, 0]],
            's': [[0, 1], [0.5, 1.012], [1, 1]], 'rot': [[0, 0], [0.5, 0.15], [1, 0]],
            'a': [[0, 1], [1, 1]]},
           ['characters'], ['loop', 'idle', 'character']),
    motion('character-sway', 'Character sway',
           'A slow weight shift left and right, useful for idle dialogue and waiting poses.',
           6000, True, 'alternate',
           {'dx': [[0, -0.003], [0.5, 0.003], [1, -0.003]], 'dy': [[0, 0], [1, 0]],
            's': [[0, 1], [1, 1]], 'rot': [[0, -0.9], [0.5, 0.9], [1, -0.9]],
            'a': [[0, 1], [1, 1]]},
           ['characters'], ['loop', 'idle', 'character']),
    motion('breeze-sway', 'Breeze sway',
           'A soft rotational sway with a small lateral push, phased across foliage.',
           4800, True, 'stagger',
           {'dx': [[0, 0], [0.5, 0.006], [1, 0]], 'dy': [[0, 0], [1, 0]],
            's': [[0, 1], [1, 1]], 'rot': [[0, -1.1], [0.5, 1.3], [1, -1.1]],
            'a': [[0, 1], [1, 1]]},
           ['nature'], ['loop', 'breeze', 'foliage']),
    motion('glow-pulse', 'Glow pulse',
           'A rhythmic opacity and scale pulse for lamps, candles, lanterns and glows.',
           2600, True, 'stagger',
           {'dx': [[0, 0], [1, 0]], 'dy': [[0, 0], [1, 0]],
            's': [[0, 1], [0.5, 1.035], [1, 1]], 'rot': [[0, 0], [1, 0]],
            'a': [[0, 0.62], [0.35, 1], [0.7, 0.78], [1, 0.62]]},
           ['effects'], ['loop', 'light', 'pulse']),
    motion('sparkle', 'Sparkle',
           'A quick, staggered twinkle. Each member gets its own phase so the set shimmers.',
           1800, True, 'stagger',
           {'dx': [[0, 0], [1, 0]], 'dy': [[0, 0], [1, 0]],
            's': [[0, 0.86], [0.5, 1.1], [1, 0.86]], 'rot': [[0, -4], [0.5, 5], [1, -4]],
            'a': [[0, 0.15], [0.5, 1], [1, 0.15]]},
           ['effects'], ['loop', 'twinkle', 'light']),
    motion('smoke-rise', 'Smoke rise',
           'A slow upward drift with a gradual fade and expansion, for chimney smoke and steam.',
           6000, True, 'stagger',
           {'dx': [[0, 0], [0.5, 0.006], [1, 0.002]], 'dy': [[0, 0], [1, -0.03]],
            's': [[0, 0.96], [1, 1.1]], 'rot': [[0, -1], [1, 2]],
            'a': [[0, 0.9], [0.7, 0.55], [1, 0]]},
           ['effects'], ['loop', 'smoke', 'rise']),
    motion('float', 'Float',
           'A calm vertical float with a touch of rotation. The generic idle for objects.',
           5200, True, 'stagger',
           {'dx': [[0, 0], [1, 0]], 'dy': [[0, 0], [0.5, -0.006], [1, 0]],
            's': [[0, 1], [1, 1]], 'rot': [[0, -0.6], [0.5, 0.6], [1, -0.6]],
            'a': [[0, 1], [1, 1]]},
           ['birds-wildlife', 'props', 'other'], ['loop', 'ambient']),
    motion('parallax-drift', 'Parallax drift',
           'A near-static drift for background and foreground bands. Pair with a slower front layer for depth.',
           12000, True, 'sync',
           {'dx': [[0, -0.004], [0.5, 0.004], [1, -0.004]], 'dy': [[0, 0], [0.5, -0.003], [1, 0]],
            's': [[0, 1], [0.5, 1.008], [1, 1]], 'rot': [[0, 0], [1, 0]],
            'a': [[0, 1], [1, 1]]},
           ['architecture', 'foreground', 'background'], ['loop', 'depth', 'ambient']),
    motion('snow-fall', 'Snow fall',
           'Continuous downward drift with phase-offset members. Use on a snow or particle group.',
           7000, True, 'stagger',
           {'dx': [[0, 0], [0.5, 0.008], [1, 0.002]], 'dy': [[0, 0], [1, 0.06]],
            's': [[0, 1], [1, 1]], 'rot': [[0, 0], [1, 8]],
            'a': [[0, 0.95], [1, 0.35]]},
           ['sky-clouds'], ['loop', 'weather', 'fall']),
    motion('rain-fall', 'Rain fall',
           'Fast downward streaks with a slight lean. Keep the group above the characters.',
           2200, True, 'stagger',
           {'dx': [[0, 0], [1, 0.008]], 'dy': [[0, -0.01], [1, 0.04]],
            's': [[0, 1], [1, 1]], 'rot': [[0, 7], [1, 7]],
            'a': [[0, 0.8], [1, 0.45]]},
           ['sky-clouds'], ['loop', 'weather', 'fall']),
    motion('hold', 'Hold',
           'No motion. Use when the group is set dressing rather than a moving layer.',
           3000, True, 'sync',
           {'dx': [[0, 0], [1, 0]], 'dy': [[0, 0], [1, 0]],
            's': [[0, 1], [1, 1]], 'rot': [[0, 0], [1, 0]],
            'a': [[0, 1], [1, 1]]},
           ['text', 'props', 'architecture', 'background', 'other'], ['static']),
]
MOTIONS_BY_ID = {item['id']: item for item in MOTIONS}

CATEGORY_MOTIONS = {
    'sky-clouds': ['cloud-drift', 'cloud-breathe', 'hold'],
    'sea-waves': ['wave-roll', 'tide-rise', 'hold'],
    'birds-wildlife': ['bird-flight', 'float', 'hold'],
    'characters': ['character-breathe', 'character-sway', 'hold'],
    'nature': ['breeze-sway', 'cloud-drift', 'hold'],
    'architecture': ['parallax-drift', 'hold'],
    'props': ['float', 'hold'],
    'text': ['hold'],
    'effects': ['glow-pulse', 'sparkle', 'smoke-rise'],
    'foreground': ['parallax-drift', 'hold'],
    'background': ['parallax-drift', 'hold'],
    'other': ['float', 'hold'],
}

LABEL_MOTIONS = [
    (re.compile(r'cloud|sky', re.I), ['cloud-drift', 'cloud-breathe']),
    (re.compile(r'wave|sea|ocean|tide|shore|glint|foam', re.I), ['wave-roll', 'tide-rise']),
    (re.compile(r'bird|gull|seagull', re.I), ['bird-flight', 'float']),
    (re.compile(r'character|subject|cyclist|figure|pig|farmer|dots', re.I),
     ['character-breathe', 'character-sway']),
    (re.compile(r'tree|grass|veget|flora|flower|plant|leaf|breeze', re.I), ['breeze-sway']),
    (re.compile(r'smoke|steam|fog|mist', re.I), ['smoke-rise']),
    (re.compile(r'sparkle|glint|glow|light|shine|flash|candle|lantern', re.I),
     ['glow-pulse', 'sparkle']),
    (re.compile(r'snow', re.I), ['snow-fall']),
    (re.compile(r'rain', re.I), ['rain-fall']),
    (re.compile(r'foreground|border|barrier|base|background', re.I), ['parallax-drift']),
]

USE_WHEN = {
    'sky-clouds': 'Use when a scene needs a sky plate with moving cloud cover, sun or weather. Place behind architecture and characters.',
    'sea-waves': 'Use when a scene needs water: put the sea band behind the shoreline and let the wave layers loop under it.',
    'birds-wildlife': 'Use when a scene needs life in the sky. Keep the flock above the background and behind foreground framing.',
    'characters': 'Use when a scene needs a person or character set. Group the parts, keep the feet anchored, and use an idle motion rather than a walk.',
    'nature': 'Use when a scene needs trees, grass or landscape bands. A breeze reads better on the silhouette than on the whole plate.',
    'architecture': 'Use as the room or street the scene is built inside. Keep motion to a subtle drift so the set stays stable.',
    'props': 'Use for set dressing: furniture, tableware, books and products. Float only when the object is meant to be loose.',
    'text': 'Use only for lettering cut-outs. Prefer a native text layer when the copy may change.',
    'effects': 'Use above the scene for light, glow, sparkle and smoke. Effects should never cover the subject\'s face.',
    'foreground': 'Use in front of everything for framing, borders and near-camera tools. Keep it still or drift it slowly.',
    'background': 'Use as the base plate behind every other layer. Keep it slower than the midground.',
    'other': 'Inspect the members before using; the category is not confirmed.',
}

OBSERVED_LABELS = [
    (re.compile(r'flight', re.I), 'bird-flight'),
    (re.compile(r'snow', re.I), 'snow-fall'),
    (re.compile(r'float', re.I), 'float'),
    (re.compile(r'sway', re.I), 'breeze-sway'),
    (re.compile(r'drift', re.I), 'cloud-drift'),
    (re.compile(r'pulse|shimmer|twinkle', re.I), 'glow-pulse'),
    (re.compile(r'breathe', re.I), 'character-breathe'),
    (re.compile(r'parallax|push-in|zoom', re.I), 'parallax-drift'),
]

# ── small helpers ───────────────────────────────────────────────────────────

def slug(value, max_len=56):
    value = unicodedata.normalize('NFKD', str(value or 'group'))
    value = re.sub(r'[\u0300-\u036f]', '', value)
    value = re.sub(r'[^A-Za-z0-9]+', '-', value).strip('-').lower()
    return (value or 'group')[:max_len].strip('-')


def round2(value):
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return 0.0


def label_display(label):
    text = re.sub(r'\s+', ' ', str(label or '')).strip()
    if not text:
        return 'Group'
    if text.islower():
        return text[:1].upper() + text[1:]
    return text


def category_for(label):
    key = re.sub(r'\s+', ' ', str(label or '')).strip().lower()
    if key in ALIASES:
        return ALIASES[key]
    if key.startswith('dots'):
        return 'characters'
    for keyword, category in KEYWORDS:
        if keyword in key:
            return category
    return 'other'


def relative(path):
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def public_url(path):
    return '/' + relative(path)


def sha1_file(path, cache):
    """A cheap content fingerprint.

    Hashing whole 2500x4440 PNGs dominated the build, and exact copies are
    byte-identical in their first blocks. Hash the head plus the file size:
    enough to collapse the copy compositions without reading everything.
    """
    key = str(path)
    if key in cache:
        return cache[key]
    digest = hashlib.sha1()
    try:
        with open(path, 'rb') as handle:
            digest.update(handle.read(256 * 1024))
        digest.update(str(path.stat().st_size).encode('ascii'))
        value = digest.hexdigest()
    except OSError:
        value = ''
    cache[key] = value
    return value


def image_size(path, cache):
    key = str(path)
    if key in cache:
        return cache[key]
    try:
        with Image.open(path) as image:
            value = image.size
    except Exception:
        value = None
    cache[key] = value
    return value


def image_url(layer):
    url = str(layer.get('url') or '').strip()
    if url:
        return url
    frames = layer.get('frames')
    if isinstance(frames, list) and frames:
        return str(frames[0] or '')
    return ''


def is_image_url(url):
    return bool(re.search(r'\.(?:png|jpe?g|webp|gif)$', url, re.I)) or url.startswith('data:image/')


def project_root_of(composition_path):
    """The folder that holds the images for a composition.

    Projects keep compositions in `compositions/`; imports keep a single
    `composition.json` at the project root.
    """
    parent = composition_path.parent
    if parent.name == 'compositions':
        return parent.parent
    return parent


def layer_box(layer):
    return {
        'x': round2(layer.get('x', 0)),
        'y': round2(layer.get('y', 0)),
        'w': round2(layer.get('w', 0)),
        'h': round2(layer.get('h', 0)),
    }


# ── source discovery ────────────────────────────────────────────────────────

class Resolver:
    """Resolve the URLs written in old compositions to files on this disk.

    Projects have been renumbered and copied since the compositions were
    written (`/data/projects/Boardwalk-cotton/...` now lives under
    `0-Boardwalk-cotton`), so an exact path is only the first guess.
    """

    def __init__(self, root):
        self.root = root
        self.basename = defaultdict(list)
        self.cache = {}
        self.hash_cache = {}
        self.size_cache = {}
        for base in (root / 'data' / 'projects', root / 'data' / 'imports'):
            if not base.exists():
                continue
            for path in base.rglob('*'):
                if path.is_file() and path.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp', '.gif'):
                    self.basename[path.name].append(path)

    def resolve(self, composition_path, url):
        if not url:
            return None
        # Old compositions sometimes point at the server origin or at the
        # project asset API rather than at /data.
        if url.startswith('http://localhost:') or url.startswith('https://localhost:'):
            parts = url.split('/', 3)
            url = '/' + (parts[3] if len(parts) > 3 else '')
        if url.startswith('/api/projects/'):
            url = '/data/projects/' + url[len('/api/projects/'):]
        if not url.startswith('/data/'):
            return None
        key = (str(composition_path), url)
        if key in self.cache:
            return self.cache[key]
        target = self.root / url.lstrip('/')
        found = None
        if target.is_file():
            found = target
        else:
            parts = url.lstrip('/').split('/')
            # data/projects/<project>/<tail> -> data/projects/<composition project>/<tail>
            if len(parts) > 3 and parts[1] in ('projects', 'imports'):
                project_root = project_root_of(composition_path)
                rebased = project_root.joinpath(*parts[3:])
                if rebased.is_file():
                    found = rebased
                if not found:
                    url_project = parts[2]
                    variants = [url_project]
                    if url_project.startswith('0-'):
                        variants.append(url_project[2:])
                    else:
                        variants.append('0-' + url_project)
                    for variant in variants:
                        candidate = self.root / 'data' / 'projects' / variant
                        candidate = candidate.joinpath(*parts[3:])
                        if candidate.is_file():
                            found = candidate
                            break
                if not found:
                    # Same relative tail under the composition's own project.
                    candidate = project_root.joinpath(*parts[3:])
                    if candidate.is_file():
                        found = candidate
        if not found:
            matches = self.basename.get(Path(url).name) or []
            if matches:
                # Prefer a file inside the same project tree, then the first.
                project_root = project_root_of(composition_path)
                inside = [item for item in matches if str(item).startswith(str(project_root))]
                found = sorted(inside or matches)[0]
        self.cache[key] = found
        return found

    def hash(self, path):
        return sha1_file(path, self.hash_cache)

    def size(self, path):
        return image_size(path, self.size_cache)


def scan_sources():
    sources = {}

    def add(path, kind, **meta):
        path = path.resolve()
        entry = sources.setdefault(str(path), {
            'path': path,
            'kind': kind,
            'designId': '',
            'designName': '',
            'brand': '',
            'designStatus': '',
            'projectId': path.parent.parent.name,
        })
        entry.update({key: value for key, value in meta.items() if value not in (None, '')})

    # Library designs: the catalogue is the authority for brand/status.
    design_dir = LIBRARY / 'designs'
    if design_dir.is_dir():
        for design_file in sorted(design_dir.glob('*.json')):
            try:
                design = json.loads(design_file.read_text('utf-8'))
            except Exception:
                continue
            composition = str(design.get('composition') or '').lstrip('/')
            if not composition:
                continue
            composition_path = (ROOT / composition)
            if not composition_path.is_file():
                continue
            brand = design.get('brand') or {}
            add(
                composition_path,
                'library-design',
                designId=str(design.get('id') or design_file.stem),
                designName=str(design.get('name') or design_file.stem),
                brand=str(brand.get('name') or brand.get('id') or design.get('brandId') or ''),
                designStatus=str(design.get('status') or ''),
            )

    # Imports: the working copies, including the ZIP-import compositions.
    imports_dir = DATA / 'imports'
    if imports_dir.is_dir():
        for composition_path in sorted(imports_dir.glob('*/composition.json')):
            add(composition_path, 'import', projectId=composition_path.parent.name)

    # The explicit bar-santa project requested for this pass.
    project_dir = DATA / 'projects' / BAR_SANTA_PROJECT / 'compositions'
    if project_dir.is_dir():
        for composition_path in sorted(project_dir.glob('*.composition.json')):
            add(composition_path, 'project', projectId=BAR_SANTA_PROJECT)

    return [entry for entry in sources.values() if entry['path'].name not in SKIP_COMPOSITION_NAMES]


# ── group extraction ────────────────────────────────────────────────────────

def infer_group(layer):
    folder = str(layer.get('folder') or '').strip()
    if folder and folder.lower() not in ('segments', 'images', 'segments/', 'images/'):
        category = category_for(folder)
        if category != 'other':
            return label_display(folder), 'folder', 0.68

    name = str(layer.get('name') or '')
    tokens = re.split(r'[-_\s]+', name.strip().lower())
    if tokens:
        prefix = tokens[0]
        if prefix in KNOWN_PREFIXES:
            return KNOWN_PREFIXES[prefix], 'name', 0.6

    role = str(layer.get('role') or '').strip().lower()
    label = ROLE_GROUPS.get(role, '')
    if label:
        return label, 'role', 0.42
    return '', '', 0.0


def group_layers(composition, reference_id):
    """Return ordered groups: label -> {origin, confidence, members[]}."""
    groups = {}
    skipped_data_uri = 0
    for index, layer in enumerate(composition.get('layers') or []):
        if not isinstance(layer, dict):
            continue
        layer_id = str(layer.get('id') or '')
        if not layer_id or layer_id == reference_id:
            continue
        url = image_url(layer)
        if not is_image_url(url):
            continue
        if url.startswith('data:'):
            # Sprite sheets and generated gradients live inline in old
            # compositions. They are not reusable cut-out segments and would
            # bloat every JSON with a multi-megabyte base64 string.
            skipped_data_uri += 1
            continue
        box = layer_box(layer)
        if box['w'] <= 0 or box['h'] <= 0:
            continue

        declared = str(layer.get('segmentGroup') or '').strip()
        if declared:
            label, origin, confidence = label_display(declared), 'declared', 1.0
        else:
            label, origin, confidence = infer_group(layer)
            if not label:
                continue

        bucket = groups.setdefault(label, {
            'label': label,
            'origin': origin,
            'confidence': confidence,
            'members': [],
        })
        if origin == 'declared':
            bucket['origin'] = 'declared'
            bucket['confidence'] = 1.0
        bucket['members'].append({
            'index': index,
            'layer': layer,
            'url': url,
            'box': box,
        })
    return list(groups.values()), skipped_data_uri


def member_signature(member, resolver, composition_path):
    layer = member['layer']
    box = member['box']
    resolved = resolver.resolve(composition_path, member['url'])
    digest = resolver.hash(resolved) if resolved else ''
    fingerprint = digest or f"{Path(member['url']).name}:{box['w']}x{box['h']}"
    return [str(layer.get('name') or layer.get('id') or ''), fingerprint,
            box['x'], box['y'], box['w'], box['h'], round2(layer.get('z', 0))]


def build_member(member, resolver, composition_path, composition_size):
    layer = member['layer']
    box = member['box']
    resolved = resolver.resolve(composition_path, member['url'])
    return {
        'layerId': str(layer.get('id') or ''),
        'name': str(layer.get('name') or layer.get('id') or 'segment'),
        'role': str(layer.get('role') or ''),
        'type': str(layer.get('type') or 'image'),
        'z': round2(layer.get('z', 0)),
        'box': dict(box),
        'rotation': round2(layer.get('rotation', 0)),
        'opacity': round2(layer.get('opacity', 1)),
        'visible': layer.get('visible') is not False,
        'segmentGroup': str(layer.get('segmentGroup') or ''),
        'url': public_url(resolved) if resolved else member['url'],
        'file': relative(resolved) if resolved else '',
        'available': bool(resolved),
    }


def union_bbox(members):
    usable = [m for m in members if m['available'] and m['box']['w'] > 0 and m['box']['h'] > 0]
    if not usable:
        usable = [m for m in members if m['box']['w'] > 0 and m['box']['h'] > 0]
    if not usable:
        return {'x': 0, 'y': 0, 'w': 100, 'h': 100}
    left = min(m['box']['x'] for m in usable)
    top = min(m['box']['y'] for m in usable)
    right = max(m['box']['x'] + m['box']['w'] for m in usable)
    bottom = max(m['box']['y'] + m['box']['h'] for m in usable)
    return {
        'x': round2(max(0, left)),
        'y': round2(max(0, top)),
        'w': round2(max(0.5, right - max(0, left))),
        'h': round2(max(0.5, bottom - max(0, top))),
    }


# ── previews ────────────────────────────────────────────────────────────────

def preview_region(members):
    bbox = union_bbox(members)
    pad_x = max(0.8, bbox['w'] * PAD_PERCENT / 100)
    pad_y = max(0.8, bbox['h'] * PAD_PERCENT / 100)
    left = max(0.0, bbox['x'] - pad_x)
    top = max(0.0, bbox['y'] - pad_y)
    right = min(100.0, bbox['x'] + bbox['w'] + pad_x)
    bottom = min(100.0, bbox['y'] + bbox['h'] + pad_y)
    return {
        'left': left,
        'top': top,
        'w': max(0.5, right - left),
        'h': max(0.5, bottom - top),
    }


def canvas_for_region(region, composition_width, composition_height, max_px):
    region_px_w = region['w'] / 100 * composition_width
    region_px_h = region['h'] / 100 * composition_height
    scale = min(max_px / max(region_px_w, 1), max_px / max(region_px_h, 1), 3.0)
    width = max(16, int(round(region_px_w * scale)))
    height = max(16, int(round(region_px_h * scale)))
    return Image.new('RGBA', (width, height), (0, 0, 0, 0)), scale


def composite_group(members, composition_width, composition_height, region, max_px):
    usable = [m for m in members if m['available'] and m['file']]
    if not usable:
        return None
    canvas, scale = canvas_for_region(region, composition_width, composition_height, max_px)
    ordered = sorted(usable, key=lambda item: (item['z'], item['layerId']))
    for member in ordered[:COMPOSITE_LIMIT]:
        path = ROOT / member['file']
        try:
            with Image.open(path) as source:
                image = source.convert('RGBA')
        except Exception:
            continue
        box = member['box']
        x = (box['x'] - region['left']) / 100 * composition_width * scale
        y = (box['y'] - region['top']) / 100 * composition_height * scale
        width = max(1, int(round(box['w'] / 100 * composition_width * scale)))
        height = max(1, int(round(box['h'] / 100 * composition_height * scale)))
        image = image.resize((width, height), Image.BILINEAR)
        canvas.alpha_composite(image, (int(round(x)), int(round(y))))
    return canvas if canvas.getbbox() is not None else None


def reference_group(reference_file, composition_width, composition_height, region, max_px):
    if not reference_file or not reference_file.is_file():
        return None
    try:
        with Image.open(reference_file) as source:
            image = source.convert('RGBA')
    except Exception:
        return None
    left = int(region['left'] / 100 * composition_width)
    top = int(region['top'] / 100 * composition_height)
    right = min(image.width, int((region['left'] + region['w']) / 100 * composition_width))
    bottom = min(image.height, int((region['top'] + region['h']) / 100 * composition_height))
    if right <= left or bottom <= top:
        return None
    cropped = image.crop((left, top, right, bottom))
    cropped.thumbnail((max_px, max_px), Image.BILINEAR)
    return cropped


def write_previews(canvas, group_id):
    full = canvas.copy()
    full.thumbnail((PREVIEW_MAX, PREVIEW_MAX), Image.LANCZOS)
    full.save(THUMBS_DIR / f'{group_id}.webp', 'WEBP', quality=82, method=4)
    card = canvas.copy()
    card.thumbnail((CARD_MAX, CARD_MAX), Image.LANCZOS)
    card.save(THUMBS_DIR / f'{group_id}.card.webp', 'WEBP', quality=80, method=4)
    return True


# ── animations (observed evidence) ──────────────────────────────────────────

def load_animation_tracks():
    tracks_by_composition = defaultdict(list)
    animation_dir = LIBRARY / 'animations'
    if not animation_dir.is_dir():
        return tracks_by_composition
    for path in sorted(animation_dir.rglob('*.animation.json')):
        try:
            document = json.loads(path.read_text('utf-8'))
        except Exception:
            continue
        composition_id = str(document.get('compositionId') or '')
        if not composition_id:
            continue
        tracks = document.get('tracks') or []
        if not tracks:
            continue
        for track in tracks:
            if not isinstance(track, dict):
                continue
            labels = []
            presets = []
            for segment in track.get('segments') or []:
                if not isinstance(segment, dict):
                    continue
                if segment.get('label'):
                    labels.append(str(segment['label']))
                if segment.get('preset'):
                    presets.append(str(segment['preset']))
            tracks_by_composition[composition_id].append({
                'animationId': str(document.get('id') or path.stem),
                'animationName': str(document.get('name') or ''),
                'origin': str(document.get('origin') or ''),
                'duration': document.get('duration') or 0,
                'layerId': str(track.get('layerId') or ''),
                'layerName': str(track.get('layerName') or ''),
                'role': str(track.get('role') or ''),
                'labels': labels,
                'presets': presets,
                'start': min([int(s.get('start') or 0) for s in track.get('segments') or [] if isinstance(s, dict)] or [0]),
            })
    return tracks_by_composition


def observed_motion(tracks_by_composition, composition_id, members):
    tracks = tracks_by_composition.get(composition_id) or []
    if not tracks:
        return None
    ids = {m['layerId'] for m in members}
    names = {m['name'].lower() for m in members}
    matched = [
        track for track in tracks
        if track['layerId'] in ids or (track['layerName'] and track['layerName'].lower() in names)
    ]
    if not matched:
        return None

    labels = Counter()
    for track in matched:
        for label in track['labels']:
            if label and label.lower() not in ('keyframes', 'hold', 'static'):
                labels[label] += 1

    suggested = []
    for label, _count in labels.most_common():
        for pattern, motion_id in OBSERVED_LABELS:
            if pattern.search(label) and motion_id not in suggested:
                suggested.append(motion_id)
                break

    examples = []
    seen = set()
    for track in matched:
        key = (track['animationId'], track['layerId'])
        if key in seen:
            continue
        seen.add(key)
        examples.append({
            'animationId': track['animationId'],
            'animationName': track['animationName'],
            'origin': track['origin'],
            'layerId': track['layerId'],
            'layerName': track['layerName'],
            'labels': track['labels'][:4],
            'duration': track['duration'],
        })
        if len(examples) >= 8:
            break

    return {
        'animationCount': len({track['animationId'] for track in matched}),
        'trackCount': len(matched),
        'labels': [{'label': label, 'count': count} for label, count in labels.most_common(8)],
        'suggestedMotions': suggested,
        'examples': examples,
    }


# ── motions per group ───────────────────────────────────────────────────────

def motion_reasons(motion_id):
    motion = MOTIONS_BY_ID.get(motion_id) or {}
    return motion.get('summary', '')


def motions_for_group(label, category_id, observed):
    selected = []
    source = {}

    def add(motion_id, origin, confidence, reason):
        if motion_id not in MOTIONS_BY_ID or motion_id in selected:
            return
        selected.append(motion_id)
        source[motion_id] = {'origin': origin, 'confidence': confidence, 'reason': reason}

    for motion_id in CATEGORY_MOTIONS.get(category_id, ['hold']):
        add(motion_id, 'category', 0.7, motion_reasons(motion_id))

    for pattern, motion_ids in LABEL_MOTIONS:
        if pattern.search(label):
            for motion_id in motion_ids:
                add(motion_id, 'label', 0.85, f'The label “{label}” matches this motion family.')
            break

    if observed:
        for motion_id in observed.get('suggestedMotions') or []:
            add(motion_id, 'observed', 0.95, 'An animation in the library already moves this group this way.')

    if not selected:
        add('hold', 'category', 0.5, motion_reasons('hold'))

    # Keep the list short and put the best recommendation first.
    selected = selected[:3]
    return [
        {
            'id': motion_id,
            'label': MOTIONS_BY_ID[motion_id]['label'],
            'summary': MOTIONS_BY_ID[motion_id]['summary'],
            'duration': MOTIONS_BY_ID[motion_id]['duration'],
            'loop': MOTIONS_BY_ID[motion_id]['loop'],
            'origin': source[motion_id]['origin'],
            'confidence': source[motion_id]['confidence'],
            'reason': source[motion_id]['reason'],
        }
        for motion_id in selected
    ]


# ── main build ──────────────────────────────────────────────────────────────

def main():
    started = time.time()
    resolver = Resolver(ROOT)
    sources = scan_sources()
    tracks_by_composition = load_animation_tracks()

    occurrences = []          # flat list of (label, category, signature, source, members, origin)
    composition_records = []
    warnings = []
    skipped_compositions = 0
    skipped_data_uris = 0

    for source in sources:
        path = source['path']
        try:
            composition = json.loads(path.read_text('utf-8'))
        except Exception as error:
            warnings.append(f'Could not read {relative(path)}: {error}')
            skipped_compositions += 1
            continue
        width = int(composition.get('width') or 0)
        height = int(composition.get('height') or 0)
        if width <= 0 or height <= 0:
            warnings.append(f'{relative(path)} has no usable canvas size.')
            skipped_compositions += 1
            continue

        reference_id = str(composition.get('referenceLayerId') or 'reference')
        groups, skipped_data_uri = group_layers(composition, reference_id)
        skipped_data_uris += skipped_data_uri
        if not groups:
            continue

        reference_layer = None
        for layer in composition.get('layers') or []:
            if isinstance(layer, dict) and str(layer.get('id') or '') == reference_id:
                reference_layer = layer
                break
        reference_url = ''
        if reference_layer:
            reference_resolved = resolver.resolve(path, image_url(reference_layer))
            if reference_resolved:
                reference_url = public_url(reference_resolved)

        composition_id = str(composition.get('id') or path.parent.name)
        design_id = source.get('designId', '')
        project_id = source.get('projectId') or path.parent.parent.name

        composition_records.append({
            'id': composition_id,
            'path': relative(path),
            'kind': source['kind'],
            'projectId': project_id,
            'designId': design_id,
            'width': width,
            'height': height,
            'groups': len(groups),
        })

        for group in groups:
            members = [
                build_member(member, resolver, path, (width, height))
                for member in group['members']
            ]
            if not members:
                continue
            signature = hashlib.sha1(json.dumps(
                sorted([member_signature(member, resolver, path) for member in group['members']]),
                separators=(',', ':'),
            ).encode('utf-8')).hexdigest()[:10]

            occurrences.append({
                'label': group['label'],
                'display': label_display(group['label']),
                'category': category_for(group['label']),
                'origin': group['origin'],
                'confidence': group['confidence'],
                'signature': signature,
                'members': members,
                'source': {
                    'kind': source['kind'],
                    'projectId': project_id,
                    'compositionId': composition_id,
                    'compositionPath': relative(path),
                    'designId': design_id,
                    'designName': source.get('designName', ''),
                    'brand': source.get('brand', ''),
                    'status': source.get('designStatus', ''),
                },
                'size': {'width': width, 'height': height},
                'reference': reference_url,
            })

    # Collapse exact copies (same art, same geometry) into one group asset.
    grouped = {}
    for occurrence in occurrences:
        key = (occurrence['category'], occurrence['display'].lower(), occurrence['signature'])
        bucket = grouped.setdefault(key, {
            'label': occurrence['display'],
            'category': occurrence['category'],
            'signature': occurrence['signature'],
            'occurrences': [],
        })
        bucket['occurrences'].append(occurrence)

    groups = []
    used_ids = set()
    for key, bucket in grouped.items():
        # Prefer a declared group with available art; then a library design;
        # then the shortest project name (usually the original, not the copy).
        def score(occurrence):
            available = sum(1 for member in occurrence['members'] if member['available'])
            ratio = available / max(1, len(occurrence['members']))
            return (
                1 if occurrence['origin'] == 'declared' else 0,
                1 if occurrence['source']['kind'] == 'library-design' else 0,
                round(ratio, 2),
                -len(occurrence['source']['projectId']),
            )

        canonical = sorted(bucket['occurrences'], key=score, reverse=True)[0]
        members = canonical['members']
        category = canonical['category']
        available = sum(1 for member in members if member['available'])
        bbox = union_bbox(members)
        z_values = [member['z'] for member in members]
        observed = observed_motion(tracks_by_composition, canonical['source']['compositionId'], members)
        motions = motions_for_group(canonical['label'], category, observed)

        base_id = f"{slug(canonical['label'])}-{bucket['signature'][:8]}"
        group_id = base_id
        suffix = 2
        while group_id in used_ids:
            group_id = f'{base_id}-{suffix}'
            suffix += 1
        used_ids.add(group_id)

        occurrences_public = []
        for occurrence in sorted(
            bucket['occurrences'],
            key=lambda item: (-sum(1 for m in item['members'] if m['available']), len(item['source']['projectId'])),
        ):
            occurrences_public.append({
                'kind': occurrence['source']['kind'],
                'projectId': occurrence['source']['projectId'],
                'compositionId': occurrence['source']['compositionId'],
                'compositionPath': occurrence['source']['compositionPath'],
                'designId': occurrence['source']['designId'],
                'designName': occurrence['source']['designName'],
                'brand': occurrence['source']['brand'],
                'status': occurrence['source']['status'],
                'memberCount': len(occurrence['members']),
                'availableCount': sum(1 for member in occurrence['members'] if member['available']),
            })

        category_meta = next(item for item in CATEGORIES if item['id'] == category)
        group = {
            'schema': SCHEMA,
            'id': group_id,
            'name': canonical['label'],
            'category': category,
            'categoryLabel': category_meta['label'],
            'categoryColor': category_meta['color'],
            'origin': canonical['origin'],
            'confidence': canonical['confidence'],
            'signature': bucket['signature'],
            'layerCount': len(members),
            'availableCount': available,
            'complete': available == len(members),
            'bbox': bbox,
            'zRange': [round2(min(z_values)), round2(max(z_values))] if z_values else [0, 0],
            'size': {
                'width': canonical['size']['width'],
                'height': canonical['size']['height'],
                'aspect': round2(canonical['size']['width'] / canonical['size']['height'])
                if canonical['size']['height'] else 1,
            },
            'source': {
                'kind': canonical['source']['kind'],
                'projectId': canonical['source']['projectId'],
                'compositionId': canonical['source']['compositionId'],
                'compositionPath': canonical['source']['compositionPath'],
                'designId': canonical['source']['designId'],
                'designName': canonical['source']['designName'],
                'brand': canonical['source']['brand'],
                'status': canonical['source']['status'],
            },
            'reference': {
                'url': canonical['reference'],
                'available': bool(canonical['reference']),
            },
            'occurrenceCount': len(occurrences_public),
            'occurrences': occurrences_public,
            'members': members,
            'motions': motions,
            'observed': observed,
            'preview': {
                'card': '',
                'full': '',
            },
            'tags': sorted({
                category_meta['label'],
                category,
                canonical['origin'],
                *[motion['id'] for motion in motions],
                *[member['role'] for member in members if member['role']],
            }),
        }
        groups.append(group)

    # Order: category, then declared first, then label, then source.
    category_order = {item['id']: index for index, item in enumerate(CATEGORIES)}
    groups.sort(key=lambda group: (
        category_order.get(group['category'], 999),
        0 if group['origin'] == 'declared' else 1,
        group['name'].lower(),
        group['source']['projectId'],
    ))

    # ── write outputs ───────────────────────────────────────────────────
    if GROUPS_DIR.exists():
        shutil.rmtree(GROUPS_DIR)
    if THUMBS_DIR.exists():
        shutil.rmtree(THUMBS_DIR)
    GROUPS_DIR.mkdir(parents=True, exist_ok=True)
    THUMBS_DIR.mkdir(parents=True, exist_ok=True)

    rendered = 0
    for index, group in enumerate(groups, 1):
        slug_id = group['id']
        size = group['size']
        region = preview_region(group['members'])
        canvas = None
        preview_mode = 'composite'
        available_members = [member for member in group['members'] if member['available']]
        reference_file = None
        if group['reference']['available']:
            reference_file = ROOT / group['reference']['url'].lstrip('/')
        if len(available_members) > COMPOSITE_LIMIT and reference_file:
            # Broad inferred groups can hold hundreds of props. Compositing
            # every one twice was the build's slowest step; the source frame
            # is a more honest thumbnail for that scale anyway.
            canvas = reference_group(reference_file, size['width'], size['height'], region, PREVIEW_MAX)
            preview_mode = 'reference'
        if canvas is None:
            canvas = composite_group(group['members'], size['width'], size['height'], region, PREVIEW_MAX)
            preview_mode = 'composite'
        if canvas is not None and write_previews(canvas, slug_id):
            group['preview']['card'] = public_url(THUMBS_DIR / f'{slug_id}.card.webp')
            group['preview']['full'] = public_url(THUMBS_DIR / f'{slug_id}.webp')
            group['preview']['mode'] = preview_mode
            if preview_mode == 'reference':
                group['preview']['note'] = 'The card preview is cropped from the source frame because this group has more than %d members; the live stage composites the members.' % COMPOSITE_LIMIT
            rendered += 1
        if index % 25 == 0:
            print(f'  previews {index}/{len(groups)}', flush=True)

        # The agent block is the part an LLM copies into a scene.
        primary = next((motion for motion in group['motions'] if motion['id'] != 'hold'), group['motions'][0])
        primary_recipe = MOTIONS_BY_ID.get(primary['id'], MOTIONS_BY_ID['hold'])
        group['agent'] = {
            'summary': (
                f"{group['name']} — {group['layerCount']} cut-out layers in the "
                f"{group['categoryLabel']} family. Source: {group['source']['compositionId']}."
            ),
            'useWhen': USE_WHEN.get(group['category'], USE_WHEN['other']),
            'insert': {
                'method': 'add-layers',
                'units': 'percent-of-canvas',
                'groupId': group['id'],
                'groupLabel': group['name'],
                'bbox': group['bbox'],
                'layers': [
                    {
                        'id': f"{group['id']}-{position + 1}",
                        'name': member['name'],
                        'role': member['role'] or 'image',
                        'z': member['z'],
                        'x': member['box']['x'],
                        'y': member['box']['y'],
                        'w': member['box']['w'],
                        'h': member['box']['h'],
                        'rotation': member['rotation'],
                        'opacity': member['opacity'],
                        'url': member['url'],
                        'fit': 'contain',
                        'segmentGroup': group['name'],
                    }
                    for position, member in enumerate(group['members'])
                    if member['available']
                ],
            },
            'motion': {
                'preset': primary['id'],
                'label': primary['label'],
                'duration': primary_recipe['duration'],
                'loop': primary_recipe['loop'],
                'phase': primary_recipe['phase'],
                'keys': primary_recipe['keys'],
                'applyTo': 'each-member',
                'note': (
                    'For each layer, at t (ms) = key time * duration: '
                    'x = base.x + dx * 100, y = base.y + dy * 100, '
                    'w = base.w * s, h = base.h * s, rotation = base.rotation + rot, '
                    'opacity = base.opacity * a. Stagger phases by member order when phase is "stagger".'
                ),
            },
            'notes': [
                'Coordinates are percentages of the target canvas, not pixels.',
                'The art is transparent PNG; keep the layer z order from members.',
                'Do not recolour or crop members; the group preview is the reference.',
            ] + ([f'{len(group["members"]) - available} member image(s) are missing on disk; '
                   'only available members are included in insert.layers.'] if available < len(group['members']) else []),
        }

        (GROUPS_DIR / f'{slug_id}.json').write_text(
            json.dumps(group, ensure_ascii=False, separators=(',', ':')), 'utf-8'
        )

    # Categories with live counts.
    category_counts = Counter(group['category'] for group in groups)
    category_layers = Counter()
    for group in groups:
        category_layers[group['category']] += group['layerCount']
    categories = []
    for category in CATEGORIES:
        items = [group for group in groups if group['category'] == category['id']]
        categories.append({
            'id': category['id'],
            'label': category['label'],
            'description': category['description'],
            'color': category['color'],
            'groupCount': category_counts.get(category['id'], 0),
            'layerCount': category_layers.get(category['id'], 0),
            'motions': category['motions'],
            'groups': [group['id'] for group in items],
        })

    # Index summaries deliberately omit the member arrays.
    summaries = []
    for group in groups:
        summaries.append({
            'id': group['id'],
            'name': group['name'],
            'category': group['category'],
            'categoryLabel': group['categoryLabel'],
            'categoryColor': group['categoryColor'],
            'origin': group['origin'],
            'confidence': group['confidence'],
            'layerCount': group['layerCount'],
            'availableCount': group['availableCount'],
            'complete': group['complete'],
            'occurrenceCount': group['occurrenceCount'],
            'source': group['source'],
            'preview': group['preview'],
            'bbox': group['bbox'],
            'zRange': group['zRange'],
            'size': group['size'],
            'motions': [
                {'id': motion['id'], 'label': motion['label'], 'origin': motion['origin']}
                for motion in group['motions']
            ],
            'tags': group['tags'],
            'keywords': ' '.join(sorted({
                group['name'],
                group['categoryLabel'],
                group['source']['projectId'],
                group['source']['compositionId'],
                *[member['name'] for member in group['members']],
            })).lower(),
        })

    motion_documents = []
    for motion_item in MOTIONS:
        motion_documents.append({
            **motion_item,
            'keyCount': len(motion_item['keys']),
            'groupsUsing': [group['id'] for group in groups
                            if any(item['id'] == motion_item['id'] for item in group['motions'])],
        })

    counts = {
        'compositionsScanned': len(sources),
        'compositions': len(composition_records),
        'groups': len(groups),
        'declaredGroups': sum(1 for group in groups if group['origin'] == 'declared'),
        'inferredGroups': sum(1 for group in groups if group['origin'] != 'declared'),
        'occurrences': len(occurrences),
        'duplicatesCollapsed': len(occurrences) - len(groups),
        'layers': sum(group['layerCount'] for group in groups),
        'availableLayers': sum(group['availableCount'] for group in groups),
        'missingLayers': sum(group['layerCount'] - group['availableCount'] for group in groups),
        'categories': sum(1 for category in categories if category['groupCount']),
        'motions': len(MOTIONS),
        'previews': rendered,
        'withoutPreview': len(groups) - rendered,
        'dataUriLayersSkipped': skipped_data_uris,
    }

    generated_at = datetime.now(timezone.utc).isoformat(timespec='seconds')
    index = {
        'schema': SCHEMA,
        'generatedAt': generated_at,
        'roots': [
            {'kind': 'import', 'path': 'data/imports/*/composition.json'},
            {'kind': 'library-design', 'path': 'data/library/designs/*.json → data/projects/*/compositions/*.json'},
            {'kind': 'project', 'path': f'data/projects/{BAR_SANTA_PROJECT}/compositions/*.composition.json'},
        ],
        'counts': counts,
        'categories': categories,
        'motions': [
            {
                'id': motion_item['id'],
                'label': motion_item['label'],
                'summary': motion_item['summary'],
                'duration': motion_item['duration'],
                'loop': motion_item['loop'],
                'categories': motion_item['categories'],
                'tags': motion_item['tags'],
            }
            for motion_item in MOTIONS
        ],
        'groups': summaries,
        'compositions': composition_records,
        'files': {
            'groupDetail': '/data/library/segment-groups/groups/{id}.json',
            'motions': '/data/library/segment-groups/motions.json',
            'preview': '/data/library/segment-groups/thumbs/{id}.webp',
            'card': '/data/library/segment-groups/thumbs/{id}.card.webp',
        },
        'warnings': warnings,
    }
    (OUT / 'index.json').write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')), 'utf-8')
    (OUT / 'motions.json').write_text(json.dumps({
        'schema': MOTION_SCHEMA,
        'generatedAt': generated_at,
        'counts': {'motions': len(motion_documents)},
        'motions': motion_documents,
    }, ensure_ascii=False, indent=1), 'utf-8')

    write_readme(generated_at, counts, categories, groups)
    elapsed = time.time() - started
    print(
        f"segment library: {counts['groups']} groups "
        f"({counts['declaredGroups']} declared / {counts['inferredGroups']} inferred), "
        f"{counts['layers']} layers, {counts['occurrences']} occurrences, "
        f"{counts['previews']} previews in {elapsed:.1f}s",
        flush=True,
    )
    print(f"wrote {relative(OUT)}", flush=True)
    if warnings:
        print(f'{len(warnings)} warning(s); see index.json', flush=True)


def write_readme(generated_at, counts, categories, groups):
    lines = [
        '# Segment groups',
        '',
        f'Generated by `scripts/build-segment-library.py` on {generated_at}. Do not edit by hand.',
        '',
        'A **segment group** is the named set of cut-out layers that belongs together in a',
        'composition: clouds, sea and waves, birds, a character, a table setting, the light',
        'effects. The group is the portable unit an agent can drop into a new scene, then',
        'animate with one of its motion recipes.',
        '',
        '## What is here',
        '',
        '| Path | Contents |',
        '|---|---|',
        '| `index.json` | Catalogue: counts, categories, motions, group summaries. Start here. |',
        '| `groups/<id>.json` | Full group: members, source occurrences, previews, agent insert block. |',
        '| `motions.json` | Reusable motion recipes (keyframes) referenced by groups. |',
        '| `thumbs/<id>.webp` | Full composited preview, transparent background. |',
        '| `thumbs/<id>.card.webp` | Small card preview for the grid. |',
        '',
        '## Counts',
        '',
        f"- {counts['groups']} groups ({counts['declaredGroups']} declared, {counts['inferredGroups']} inferred)",
        f"- {counts['layers']} layers ({counts['availableLayers']} images available, {counts['missingLayers']} missing)",
        f"- {counts['occurrences']} occurrences; {counts['duplicatesCollapsed']} exact copies collapsed",
        f"- {counts['categories']} populated categories, {counts['motions']} motion recipes",
        f"- {counts['previews']} groups with a rendered preview ({counts['withoutPreview']} without)",
        '',
        '## Categories',
        '',
        '| Category | Groups | Layers |',
        '|---|---:|---:|',
    ]
    for category in categories:
        if category['groupCount']:
            lines.append(f"| {category['label']} (`{category['id']}`) | {category['groupCount']} | {category['layerCount']} |")
    lines += [
        '',
        '## How a group is detected',
        '',
        '1. **Declared** — `layer.segmentGroup` in the composition. Confidence 1.0.',
        '2. **Folder** — the layer folder (`clouds/`, `birds/`) when no group is declared. Confidence 0.68.',
        '3. **Name prefix** — a known prefix such as `cloud-`, `gull-`, `book-`. Confidence 0.6.',
        '4. **Layer role** — `character-part`, `prop`, `ground`, and so on. Confidence 0.42.',
        '',
        'Groups with the same label and identical member art are collapsed; the duplicate',
        'compositions are kept in `occurrences`. The canonical source is the declared,',
        'library-owned, complete copy with the shortest project id.',
        '',
        '## Using a group in a scene',
        '',
        '1. Read `index.json` and filter `groups` by `category`, `name` or `keywords`.',
        '2. Read `groups/<id>.json`. `members` is the exact layer set with percentage boxes.',
        '3. Copy `agent.insert.layers` into the target composition, keeping `z` order.',
        '4. Apply `agent.motion` to each inserted layer; the note spells out the maths.',
        '',
        '```jsonc',
        '{',
        '  "group": "clouds-1a2b3c4d",',
        '  "motion": "cloud-drift",',
        '  "insert": { "method": "add-layers", "units": "percent-of-canvas" }',
        '}',
        '```',
        '',
        '## Rules of thumb',
        '',
        '- Coordinates are percentages of the canvas, never pixels.',
        '- Keep the member z order; the group was cut out in that order.',
        '- Prefer a native text layer over letter cut-outs.',
        '- Missing images are flagged (`available: false`) and excluded from `insert.layers`.',
        '- `origin` other than `declared` means the grouping was guessed from folder/name/role; inspect it first.',
        '',
        '## Rebuild',
        '',
        '```bash',
        'npm run build:segments',
        '```',
        '',
        'The UI is at `/segments` (also `/segment-library`).',
    ]
    (OUT / 'README.md').write_text('\n'.join(lines) + '\n', 'utf-8')


if __name__ == '__main__':
    main()
