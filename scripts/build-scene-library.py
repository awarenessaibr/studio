#!/usr/bin/env python3
"""Build the curated scene/parts library from an exported Studio project.

The first reviewed scene is the Singl-End Bicicle cyclist ride. The source
folder is already a clean export: composition.json, animation.json,
segments.json and one transparent PNG per layer. This script does the semantic
work that a raw export cannot: names each part, groups it, describes it,
records its placement and animation, and writes an index the scene composer
can query.

Run:  python3 scripts/build-scene-library.py
      SCENE_SOURCE=/path/to/export python3 scripts/build-scene-library.py
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
from PIL import Image
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIBRARY = ROOT / "data" / "library"
OUT = LIBRARY / "scene-library"
ASSETS = OUT / "assets"
SCENES = OUT / "scenes"
PARTS = OUT / "parts"
GROUPS = OUT / "groups"
ANIMATIONS = OUT / "animations"

SCENE_ID = "singl-end-bicicle-cyclist-ride"
SCENE_SLUG = SCENE_ID
SCHEMA = "studio/scene-library/1"
PART_SCHEMA = "studio/scene-library/part/1"
GROUP_SCHEMA = "studio/scene-library/group/1"
BUILD_SCHEMA = "studio/scene-build/1"

ORIGINAL_ROOT = ROOT / "data" / "projects" / "Singl-End-Bicicle" / "images"

DEFAULT_SOURCE = (
    ROOT
    / "_dev"
    / "agent-first-canvas-library-expansion"
    / "agent-awareness-granular-library"
    / "the-butterfly-and-the-pig-singl-end-bicicle-cyclist-ride-and-light-dim-20261111-0247-segments"
)


def find_source() -> Path:
    env = os.environ.get("SCENE_SOURCE")
    if env:
        path = Path(env).expanduser().resolve()
        if path.is_dir():
            return path
        raise SystemExit(f"SCENE_SOURCE is not a directory: {path}")
    if DEFAULT_SOURCE.is_dir():
        return DEFAULT_SOURCE
    base = ROOT / "_dev" / "agent-first-canvas-library-expansion" / "agent-awareness-granular-library"
    candidates = sorted(base.glob("*-segments")) if base.is_dir() else []
    if len(candidates) == 1:
        return candidates[0]
    raise SystemExit("Could not find the scene export. Set SCENE_SOURCE to the *-segments folder.")


SOURCE = find_source()
SEGMENTS_DOC = json.loads((SOURCE / "segments.json").read_text("utf8"))
COMPOSITION = json.loads((SOURCE / "composition.json").read_text("utf8"))
ANIMATION_FILE = next(SOURCE.glob("*-animation.json"), None)
if ANIMATION_FILE is None:
    raise SystemExit("The export has no *-animation.json file.")
ANIMATION = json.loads(ANIMATION_FILE.read_text("utf8"))
PREVIEW_FILE = next(SOURCE.glob("*.png"), None)

SEGMENTS = {segment["name"]: segment for segment in SEGMENTS_DOC.get("segments", [])}
LAYERS = {layer["id"]: layer for layer in COMPOSITION.get("layers", [])}
TRACKS = {track["layerId"]: track for track in ANIMATION.get("tracks", [])}

# The export's `segments/` PNGs are full-canvas with transparent padding; the
# source project carries the clean, cropped cut-outs. Prefer the cropped file,
# and use the exported full-canvas alpha bbox to recover its placement.
ORIGINAL_IMAGES = {
    "metal-sculpting-tool": "foreground-tools/metal-sculpting-tool.png",
    "scattered-clay-pieces": "foreground-tools/scattered-clay-pieces.png",
    "mini-succulent-right": "miniature-props/mini-succulent-right.png",
    "wooden-workbench": "wooden-workbench.png",
    "mini-succulent-left": "miniature-props/mini-succulent-left.png",
    "wooden-handled-tool": "foreground-tools/wooden-handled-tool.png",
    "clay-jar": "foreground-tools/clay-jar.png",
    "bollard-right": "street-furniture/bollard-right.png",
    "cobblestone-sidewalk": "ground/cobblestone-sidewalk.png",
    "bollard-middle": "street-furniture/bollard-middle.png",
    "bollard-left": "street-furniture/bollard-left.png",
    "sloped-street": "ground/sloped-street.png",
    "chalkboard-sign": "street-furniture/chalkboard-sign.png",
    "cafe-sign": "cafe-sign.png",
    "large-brick-wall 2": "background-architecture/large-brick-wall.png",
    "large-brick-wall 3": "background-architecture/large-brick-wall.png",
    "large-brick-wall": "background-architecture/large-brick-wall.png",
    "background-buildings": "background-architecture/background-buildings.png",
    "street-lamp": "background-architecture/street-lamp.png",
    "black-softbox-left": "lighting-rig/black-softbox-left.png",
    "overhead-cables-lights": "lighting-rig/overhead-cables-lights.png",
    "bicycle-rear-wheel": "bicycle/bicycle-rear-wheel.png",
    "bicycle-front-wheel": "bicycle/bicycle-front-wheel.png",
    "bicycle-frame": "bicycle/bicycle-frame.png",
    "cyclist-leg": "cyclist/cyclist-leg.png",
    "cyclist-torso": "cyclist/cyclist-torso.png",
    "cyclist-head": "cyclist/cyclist-head.png",
    "unassigned": "unassigned.png",
}

PART_META = {
    "metal-sculpting-tool": {
        "label": "Metal sculpting tool",
        "category": "props",
        "groups": ["foreground-props"],
        "zone": "foreground",
        "description": "A small metal ribbon tool for shaping clay, resting on the workbench in the lower-left foreground.",
        "tags": ["tool", "metal", "clay", "workbench", "craft", "foreground"],
        "concepts": ["tools", "props", "foreground"],
    },
    "scattered-clay-pieces": {
        "label": "Scattered clay pieces",
        "category": "props",
        "groups": ["foreground-props"],
        "zone": "foreground",
        "description": "Loose terracotta pieces around the workbench, implying a making-in-progress story.",
        "tags": ["clay", "terracotta", "workbench", "craft", "foreground"],
        "concepts": ["tools", "props", "foreground"],
    },
    "mini-succulent-right": {
        "label": "Miniature succulent (right)",
        "category": "props",
        "groups": ["foreground-props"],
        "zone": "foreground",
        "description": "A small potted succulent at the right edge of the workbench, softening the foreground.",
        "tags": ["plant", "succulent", "greenery", "workbench", "foreground"],
        "concepts": ["plants", "props", "foreground"],
    },
    "wooden-workbench": {
        "label": "Wooden workbench",
        "category": "props",
        "groups": ["foreground-props"],
        "zone": "foreground",
        "description": "The wooden workbench that frames the bottom-left foreground and establishes the workshop scale.",
        "tags": ["workbench", "wood", "workshop", "table", "foreground"],
        "concepts": ["tools", "props", "foreground"],
    },
    "mini-succulent-left": {
        "label": "Miniature succulent (left)",
        "category": "props",
        "groups": ["foreground-props"],
        "zone": "foreground",
        "description": "A second small succulent, balancing the workbench styling on the left.",
        "tags": ["plant", "succulent", "greenery", "workbench", "foreground"],
        "concepts": ["plants", "props", "foreground"],
    },
    "wooden-handled-tool": {
        "label": "Wooden-handled tool",
        "category": "props",
        "groups": ["foreground-props"],
        "zone": "foreground",
        "description": "A wooden-handled modelling tool lying among the clay pieces.",
        "tags": ["tool", "wood", "clay", "craft", "foreground"],
        "concepts": ["tools", "props", "foreground"],
    },
    "clay-jar": {
        "label": "Clay jar",
        "category": "props",
        "groups": ["foreground-props"],
        "zone": "foreground",
        "description": "A terracotta jar among the workbench tools, reinforcing the pottery/workshop theme.",
        "tags": ["jar", "clay", "terracotta", "vessel", "workbench"],
        "concepts": ["tools", "props", "foreground"],
    },
    "bollard-right": {
        "label": "Bollard (right)",
        "category": "street-furniture",
        "groups": ["street-furniture"],
        "zone": "midground",
        "description": "A black cast-iron bollard at the right kerb; it sets the street line and depth.",
        "tags": ["bollard", "cast iron", "kerb", "street", "furniture"],
        "concepts": ["bollards", "street-furniture", "street"],
    },
    "cobblestone-sidewalk": {
        "label": "Duplicate bicycle side view (mislabeled)",
        "category": "reference",
        "groups": ["reference-plates"],
        "zone": "reference",
        "description": "The file named cobblestone-sidewalk is actually a large side-view bicycle cut-out, not pavement. It duplicates the bicycle subject and is kept as reference, not as a ground part.",
        "tags": ["reference", "duplicate", "bicycle", "mislabeled", "ground"],
        "concepts": ["reference"],
        "buildable": False,
        "kind": "duplicate",
    },
    "bollard-middle": {
        "label": "Duplicate bicycle wheel (mislabeled)",
        "category": "reference",
        "groups": ["reference-plates"],
        "zone": "reference",
        "description": "The file named bollard-middle is a large bicycle-wheel cut-out, not a bollard. It duplicates the bicycle and is kept as reference only.",
        "tags": ["reference", "duplicate", "bicycle", "wheel", "mislabeled"],
        "concepts": ["reference"],
        "buildable": False,
        "kind": "duplicate",
    },
    "bollard-left": {
        "label": "Bollard (left)",
        "category": "street-furniture",
        "groups": ["street-furniture"],
        "zone": "midground",
        "description": "The leftmost bollard, completing the row that guides the eye up the slope.",
        "tags": ["bollard", "cast iron", "kerb", "street", "furniture"],
        "concepts": ["bollards", "street-furniture", "street"],
    },
    "sloped-street": {
        "label": "Sloped pavement (clean crop)",
        "category": "street",
        "groups": ["street"],
        "zone": "ground",
        "description": "The clean left-hand pavement from the sloped street. The right side of the source cut-out contains a baked figure/bicycle, so this derived crop keeps only the clean setts and kerb.",
        "tags": ["street", "pavement", "setts", "kerb", "ground", "clean crop"],
        "concepts": ["street", "pavement"],
        "crop": [0, 0, 210, 270],
        "derived": True,
    },
    "chalkboard-sign": {
        "label": "Chalkboard A-board",
        "category": "signage",
        "groups": ["street-furniture", "signage", "cafe-frontage"],
        "zone": "midground",
        "description": "An A-board chalkboard outside the café, angled toward the street.",
        "tags": ["sign", "chalkboard", "a-board", "cafe", "street"],
        "concepts": ["cafe", "signage", "street-furniture"],
    },
    "unassigned": {
        "label": "Flattened scene plate (unassigned)",
        "category": "reference",
        "groups": ["reference-plates"],
        "zone": "reference",
        "description": "A full-frame composited plate exported without a semantic name. It contains the whole street; use it as visual context, not as a reusable cut-out.",
        "tags": ["reference", "plate", "flattened", "context"],
        "concepts": ["reference"],
        "buildable": False,
        "kind": "plate",
    },
    "cafe-sign": {
        "label": "Singl-end café wordmark",
        "category": "signage",
        "groups": ["street-furniture", "signage", "cafe-frontage"],
        "zone": "midground",
        "description": "The Singl-end wordmark painted on the brick café wall; a key brand/place signifier.",
        "tags": ["sign", "wordmark", "cafe", "brick", "typography", "brand"],
        "concepts": ["cafe", "signage", "buildings", "bricks"],
        "bakedInto": "large-brick-wall 2",
    },
    "large-brick-wall 2": {
        "label": "Brick wall + café wordmark",
        "category": "architecture",
        "groups": ["architecture", "cafe-frontage"],
        "zone": "background",
        "description": "The clean brick wall cut-out with the Singl-end wordmark baked into the brick and a cyclist-shaped transparent hole. Use this as the café frontage instead of adding the separate sign on top.",
        "tags": ["brick", "wall", "masonry", "cafe", "sign", "architecture"],
        "concepts": ["bricks", "buildings", "architecture", "cafe", "signage"],
        "containsBakedSign": True,
    },
    "background-buildings": {
        "label": "Background buildings",
        "category": "architecture",
        "groups": ["architecture", "cafe-frontage"],
        "zone": "background",
        "description": "The brick terrace mass behind the street; it establishes the urban canyon and the café's upper storeys.",
        "tags": ["building", "terrace", "brick", "architecture", "background"],
        "concepts": ["buildings", "architecture"],
    },
    "large-brick-wall 3": {
        "label": "Duplicate brick wall (reference)",
        "category": "reference",
        "groups": ["reference-plates"],
        "zone": "reference",
        "description": "A second copy of the same brick wall cut-out. It is identical to wall section 2 and is kept as reference, not as a separate build part.",
        "tags": ["reference", "duplicate", "brick", "wall"],
        "concepts": ["reference"],
        "buildable": False,
        "kind": "duplicate",
    },
    "large-brick-wall": {
        "label": "Flattened brick-wall plate",
        "category": "reference",
        "groups": ["reference-plates"],
        "zone": "reference",
        "description": "A full-frame, 100%-opaque plate mislabeled large-brick-wall. It contains the whole scene, so it is reference only and must not be inserted as a cut-out.",
        "tags": ["reference", "plate", "flattened", "brick", "context"],
        "concepts": ["reference"],
        "buildable": False,
        "kind": "plate",
    },
    "street-lamp": {
        "label": "Street lamp",
        "category": "lighting",
        "groups": ["street-furniture", "lighting", "cafe-frontage"],
        "zone": "background",
        "description": "A wall-mounted street lamp with a warm practical bulb; one of the scene's key vertical light sources.",
        "tags": ["lamp", "light", "street", "warm", "practical"],
        "concepts": ["lighting", "street-furniture", "night"],
    },
    "black-softbox-left": {
        "label": "Black softbox (left)",
        "category": "lighting",
        "groups": ["lighting"],
        "zone": "background",
        "description": "A black softbox/lighting rig at the left edge; part of the photographic lighting setup.",
        "tags": ["softbox", "lighting rig", "studio", "left", "black"],
        "concepts": ["lighting", "night"],
    },
    "overhead-cables-lights": {
        "label": "Overhead cables + lights",
        "category": "lighting",
        "groups": ["street-furniture", "lighting"],
        "zone": "background",
        "description": "String lights and overhead cables crossing the top of the street; adds the festive/evening layer.",
        "tags": ["string lights", "cables", "overhead", "street", "night"],
        "concepts": ["lighting", "street-furniture", "night"],
    },
    "bicycle-rear-wheel": {
        "label": "Bicycle rear wheel",
        "category": "bicycle",
        "groups": ["bicycle", "cyclist-rig"],
        "zone": "subject",
        "description": "Rear wheel of the bicycle; one of six animated ride parts.",
        "tags": ["bicycle", "bike", "wheel", "rear", "ride", "animated"],
        "concepts": ["bicycle", "cyclist", "motion"],
    },
    "bicycle-front-wheel": {
        "label": "Bicycle front wheel",
        "category": "bicycle",
        "groups": ["bicycle", "cyclist-rig"],
        "zone": "subject",
        "description": "Front wheel of the bicycle; turns with the observed ride track.",
        "tags": ["bicycle", "bike", "wheel", "front", "ride", "animated"],
        "concepts": ["bicycle", "cyclist", "motion"],
    },
    "bicycle-frame": {
        "label": "Bicycle frame",
        "category": "bicycle",
        "groups": ["bicycle", "cyclist-rig"],
        "zone": "subject",
        "description": "The bicycle frame; the anchor part for the ride rig.",
        "tags": ["bicycle", "bike", "frame", "ride", "animated"],
        "concepts": ["bicycle", "cyclist", "motion"],
    },
    "cyclist-leg": {
        "label": "Cyclist leg",
        "category": "cyclist",
        "groups": ["cyclist", "cyclist-rig"],
        "zone": "subject",
        "description": "The cyclist's leg, animated in the observed ride cycle.",
        "tags": ["cyclist", "rider", "person", "leg", "character", "animated"],
        "concepts": ["cyclist", "people", "motion"],
    },
    "cyclist-torso": {
        "label": "Cyclist torso",
        "category": "cyclist",
        "groups": ["cyclist", "cyclist-rig"],
        "zone": "subject",
        "description": "The cyclist's torso in a dark jacket; keeps the figure anchored over the bike.",
        "tags": ["cyclist", "rider", "person", "torso", "character", "animated"],
        "concepts": ["cyclist", "people", "motion"],
    },
    "cyclist-head": {
        "label": "Cyclist head",
        "category": "cyclist",
        "groups": ["cyclist", "cyclist-rig"],
        "zone": "subject",
        "description": "The cyclist's head; the top of the ride rig, animated with the torso.",
        "tags": ["cyclist", "rider", "person", "head", "character", "animated"],
        "concepts": ["cyclist", "people", "motion"],
    },
    "light pool on cyclist": {
        "label": "Light pool on cyclist",
        "category": "lighting",
        "groups": ["lighting"],
        "zone": "effect",
        "description": "An animated transparent overlay that pools light on the rider. The still frame is empty; the observed opacity track makes it visible during the ride.",
        "tags": ["light", "pool", "cyclist", "overlay", "effect", "animated"],
        "concepts": ["lighting", "cyclist", "night"],
        "staticVisible": False,
    },
    "spot glow 1": {
        "label": "Spot glow 1",
        "category": "lighting",
        "groups": ["lighting"],
        "zone": "effect",
        "description": "A warm spot-glow overlay on the brick wall; one of three overlapping pools of light.",
        "tags": ["light", "glow", "spotlight", "wall", "warm", "animated"],
        "concepts": ["lighting", "night"],
    },
    "spot glow 2": {
        "label": "Spot glow 2",
        "category": "lighting",
        "groups": ["lighting"],
        "zone": "effect",
        "description": "A second warm spot glow, overlapping the first to widen the light pool.",
        "tags": ["light", "glow", "spotlight", "wall", "warm", "animated"],
        "concepts": ["lighting", "night"],
    },
    "spot glow 3": {
        "label": "Spot glow 3",
        "category": "lighting",
        "groups": ["lighting"],
        "zone": "effect",
        "description": "A third spot glow, completing the warm wall wash.",
        "tags": ["light", "glow", "spotlight", "wall", "warm", "animated"],
        "concepts": ["lighting", "night"],
    },
    "softbox glow": {
        "label": "Softbox glow",
        "category": "lighting",
        "groups": ["lighting"],
        "zone": "effect",
        "description": "A soft glow on the left softbox, animated with the lighting track.",
        "tags": ["softbox", "glow", "light", "left", "animated"],
        "concepts": ["lighting", "night"],
    },
    "scene dimmer": {
        "label": "Scene dimmer",
        "category": "lighting",
        "groups": ["lighting"],
        "zone": "overlay",
        "description": "An animated full-frame dimmer used to bring the scene down at the end. The still frame is empty; its observed track changes opacity/position.",
        "tags": ["dimmer", "overlay", "dark", "night", "animated"],
        "concepts": ["lighting", "night"],
        "staticVisible": False,
    },
}

GROUP_META = {
    "architecture": {
        "label": "Architecture",
        "description": "Brick buildings and wall surfaces that form the café street. Use them behind the street, props and subject.",
        "category": "architecture",
        "order": 10,
        "tags": ["buildings", "bricks", "brick wall", "terrace", "cafe"],
    },
    "street": {
        "label": "Street & pavement",
        "description": "The clean left-hand pavement crop. The full street cut-out had a baked figure at the right edge, so this derived crop keeps only the setts and kerb.",
        "category": "street",
        "order": 20,
        "tags": ["street", "road", "pavement", "ground", "slope", "clean crop"],
    },
    "street-furniture": {
        "label": "Street furniture & signage",
        "description": "Bollards, café signs, lamp and overhead wires that make the street legible at human scale.",
        "category": "street-furniture",
        "order": 30,
        "tags": ["bollard", "sign", "lamp", "chalkboard", "cafe", "street"],
    },
    "signage": {
        "label": "Café signage",
        "description": "The Singl-end wordmark and A-board chalkboard. Use as the place/brand layer, not as editable copy.",
        "category": "signage",
        "order": 31,
        "tags": ["sign", "wordmark", "chalkboard", "cafe", "brand"],
    },
    "cafe-frontage": {
        "label": "Café frontage",
        "description": "The café corner in one pass: brick wall with the wordmark baked in and a cyclist-shaped hole, building mass, A-board and street lamp.",
        "category": "architecture",
        "order": 32,
        "tags": ["cafe", "frontage", "brick", "sign", "lamp"],
    },
    "foreground-props": {
        "label": "Foreground workshop",
        "description": "A workbench, clay, hand tools, jar and succulents. Use to frame the bottom-left and imply making.",
        "category": "props",
        "order": 40,
        "tags": ["workbench", "tools", "clay", "pottery", "plants", "foreground"],
    },
    "bicycle": {
        "label": "Bicycle",
        "description": "The bicycle split into rear wheel, front wheel and frame. Part of the animated ride rig.",
        "category": "bicycle",
        "order": 60,
        "tags": ["bicycle", "bike", "wheels", "frame", "ride"],
    },
    "cyclist": {
        "label": "Cyclist",
        "description": "The rider split into head, torso and leg. Animated with the bicycle over the street.",
        "category": "cyclist",
        "order": 65,
        "tags": ["cyclist", "rider", "person", "character", "ride"],
    },
    "cyclist-rig": {
        "label": "Cyclist + bicycle rig",
        "description": "All six subject parts together. This is the buildable moving unit; keep its parts in order and apply the observed ride tracks.",
        "category": "cyclist",
        "order": 60,
        "tags": ["cyclist", "bicycle", "ride", "animated", "subject"],
    },
    "lighting": {
        "label": "Lighting & night",
        "description": "Street lamp, softbox, overhead lights, spot glows and the scene dimmer. Use above the set to shape the night mood.",
        "category": "lighting",
        "order": 70,
        "tags": ["light", "lamp", "glow", "spotlight", "softbox", "night", "dimmer"],
    },
    "reference-plates": {
        "label": "Reference plates",
        "description": "Flattened full-scene plates plus mislabeled duplicate bicycle parts (cobblestone-sidewalk, bollard-middle, duplicate brick wall). Context only; never build with them.",
        "category": "reference",
        "order": 0,
        "tags": ["reference", "plate", "flattened", "context"],
        "buildable": False,
    },
}

CONCEPTS = [
    ("buildings", "Buildings", "Brick terraces and the building mass behind the street.", ["building", "buildings", "architecture", "terrace", "house", "houses"], ["background-buildings", "large-brick-wall 2", "large-brick-wall 3"]),
    ("bricks", "Bricks & brick walls", "Warm brick wall sections that build the café façade.", ["brick", "bricks", "brickwork", "wall", "walls", "masonry"], ["large-brick-wall 2", "large-brick-wall 3", "cafe-sign"]),
    ("street", "Street & pavement", "Clean left-hand pavement crop; the full street source had a baked figure at the right edge.", ["street", "road", "pavement", "sidewalk", "setts", "ground", "hill", "slope"], ["sloped-street"]),
    ("cyclist", "Cyclist", "A rider and their bicycle, split into six animated parts.", ["cyclist", "rider", "person on a bike", "woman on a bike", "man on a bike", "cycle rider"], ["bicycle-rear-wheel", "bicycle-front-wheel", "bicycle-frame", "cyclist-leg", "cyclist-torso", "cyclist-head"]),
    ("bicycle", "Bicycle", "The bicycle alone: rear wheel, front wheel and frame.", ["bike", "bicycle", "cycle", "wheel", "wheels", "frame"], ["bicycle-rear-wheel", "bicycle-front-wheel", "bicycle-frame"]),
    ("bollards", "Bollards", "Black cast-iron bollards that mark the kerb. The middle image was a mislabeled bicycle wheel and is reference-only.", ["bollard", "bollards", "post", "posts", "kerb"], ["bollard-right", "bollard-left"]),
    ("cafe", "Café & signage", "The Singl-end wordmark, A-board and café frontage.", ["cafe", "café", "coffee", "restaurant", "sign", "signage", "chalkboard", "wordmark", "a-board"], ["cafe-sign", "chalkboard-sign", "background-buildings", "street-lamp"]),
    ("lighting", "Lighting & night", "Street lamp, softbox, overhead lights, spot glows and dimmer.", ["light", "lights", "lighting", "lamp", "lamps", "glow", "glows", "spotlight", "spotlights", "softbox", "night", "evening", "dark", "dusk", "warm", "dim", "dimmer"], ["street-lamp", "black-softbox-left", "overhead-cables-lights", "spot glow 1", "spot glow 2", "spot glow 3", "softbox glow", "light pool on cyclist", "scene dimmer"]),
    ("plants", "Plants & greenery", "Small potted succulents on the workbench.", ["plant", "plants", "succulent", "succulents", "greenery", "foliage"], ["mini-succulent-right", "mini-succulent-left"]),
    ("tools", "Tools & workbench", "The wooden bench, clay, hand tools and jar.", ["tool", "tools", "workbench", "workshop", "clay", "pottery", "craft", "making", "jar", "bench", "table"], ["wooden-workbench", "metal-sculpting-tool", "scattered-clay-pieces", "wooden-handled-tool", "clay-jar"]),
    ("props", "Foreground props", "The workshop set dressing: tools, clay, plants, bench and jar.", ["prop", "props", "set dressing", "objects", "foreground", "workbench"], ["metal-sculpting-tool", "scattered-clay-pieces", "mini-succulent-right", "wooden-workbench", "mini-succulent-left", "wooden-handled-tool", "clay-jar"]),
    ("street-furniture", "Street furniture", "Bollards, signs, lamp and overhead wires.", ["street furniture", "bollard", "bollards", "sign", "signs", "lamp", "wires", "cables"], ["bollard-right", "bollard-left", "chalkboard-sign", "cafe-sign", "street-lamp", "overhead-cables-lights"]),
    ("people", "People", "The cyclist figure, split into head, torso and leg.", ["person", "people", "figure", "rider", "cyclist"], ["cyclist-head", "cyclist-torso", "cyclist-leg"]),
    ("night", "Night", "Warm practical lighting and the scene dimmer.", ["night", "evening", "dark", "dusk", "after dark", "dim"], ["street-lamp", "overhead-cables-lights", "spot glow 1", "spot glow 2", "spot glow 3", "softbox glow", "light pool on cyclist", "scene dimmer"]),
]
MISSING_CONCEPTS = [
    ("cars", "Cars & vehicles", "No car, van or other vehicle cut-outs exist in this scene library yet. The closest moving subject is the bicycle/cyclist rig.", ["car", "cars", "vehicle", "vehicles", "van", "vans", "truck", "trucks", "taxi"]),
    ("trees", "Trees", "No tree or woodland cut-outs are in this street set; use the background buildings and succulents for greenery for now.", ["tree", "trees", "woodland", "forest"]),
]


def clean_name(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def slug(value: str, max_len: int = 120) -> str:
    value = value.lower().replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return (value or "part")[:max_len].strip("-")


def asset_url(target: Path) -> str:
    return f"/data/library/scene-library/assets/{SCENE_SLUG}/{target.name}"


def copy_asset(relative: str) -> str:
    source = SOURCE / relative
    if not source.is_file():
        raise SystemExit(f"Missing source asset: {source}")
    target_dir = ASSETS / SCENE_SLUG
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / Path(relative).name
    if not target.exists() or target.stat().st_size != source.stat().st_size:
        shutil.copy2(source, target)
    return asset_url(target)


def copy_original(relative: str, part_name: str, index: int, crop=None) -> tuple[str, str, dict | None]:
    """Copy the clean cropped source cut-out instead of the padded export."""
    source = ORIGINAL_ROOT / relative
    if not source.is_file():
        return "", "", None
    target_dir = ASSETS / SCENE_SLUG
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{index:02d}-{part_name.replace(' ', '-').lower()}-{source.name}"
    with Image.open(source) as image:
        if crop:
            image = image.crop(tuple(int(value) for value in crop))
        image.save(target)
        size = {"width": image.width, "height": image.height}
    return asset_url(target), str(source.relative_to(ROOT)), size


def alpha_content_box(segment: dict) -> tuple[dict | None, dict | None]:
    """Return the content box in canvas percentages and the pixel bbox."""
    source = SOURCE / segment["file"]
    try:
        with Image.open(source) as image:
            rgba = image.convert("RGBA")
            bbox = rgba.getchannel("A").getbbox()
            width, height = rgba.size
    except Exception:
        return None, None
    if not bbox:
        return None, None
    x0, y0, x1, y1 = bbox
    return (
        {
            "x": round(x0 / width * 100, 2),
            "y": round(y0 / height * 100, 2),
            "w": round((x1 - x0) / width * 100, 2),
            "h": round((y1 - y0) / height * 100, 2),
        },
        {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0},
    )


def union_box(parts: list[dict]) -> dict:
    boxes = [part["box"] for part in parts if part.get("box")]
    if not boxes:
        return {"x": 0, "y": 0, "w": 100, "h": 100}
    x0 = min(box["x"] for box in boxes)
    y0 = min(box["y"] for box in boxes)
    x1 = max(box["x"] + box["w"] for box in boxes)
    y1 = max(box["y"] + box["h"] for box in boxes)
    return {"x": round(x0, 2), "y": round(y0, 2), "w": round(x1 - x0, 2), "h": round(y1 - y0, 2)}


def track_summary(track: dict) -> dict:
    segments = track.get("segments") or []
    frames = sum(len(segment.get("frames") or []) for segment in segments)
    fields = sorted({key for segment in segments for frame in (segment.get("frames") or []) for key in frame if key != "t"})
    return {
        "layerId": track["layerId"],
        "layerName": track.get("layerName") or track["layerId"],
        "segments": len(segments),
        "frames": frames,
        "fields": fields,
        "duration": int(track.get("duration") or ANIMATION.get("duration") or 8000),
        "loop": any(bool(segment.get("loop")) for segment in segments),
    }


def build_part(name: str, index: int) -> dict:
    segment = SEGMENTS.get(name)
    if segment is None:
        raise SystemExit(f"Part not found in segments.json: {name}")
    meta = PART_META.get(name)
    if meta is None:
        raise SystemExit(f"No curated metadata for part: {name}")
    layer = LAYERS.get(segment["id"], {})
    track = TRACKS.get(segment["id"])
    group_ids = list(meta.get("groups") or [])
    if track:
        group_ids = list(dict.fromkeys([*group_ids, "cyclist-rig" if "cyclist" in group_ids or "bicycle" in group_ids else group_ids[0]]))
    source_box = {
        "x": round(float(segment.get("box", {}).get("x", 0)), 2),
        "y": round(float(segment.get("box", {}).get("y", 0)), 2),
        "w": round(float(segment.get("box", {}).get("w", 100)), 2),
        "h": round(float(segment.get("box", {}).get("h", 100)), 2),
    }
    content_box, crop_box = alpha_content_box(segment)
    override_crop = meta.get("crop")
    # The composition layer box is the authoritative placement. The exported
    # full-canvas PNG is padded at its natural pixel scale, so its alpha bbox
    # is useful evidence but not the layer box (scaled subjects such as the
    # bicycle and cyclist differ). The original cropped art is placed in the
    # composition box.
    box = source_box
    if override_crop:
        try:
            with Image.open(ORIGINAL_ROOT / ORIGINAL_IMAGES.get(name, "")) as source_image:
                original_width = source_image.width
            box = {**source_box, "w": round(source_box["w"] * (override_crop[2] - override_crop[0]) / original_width, 2)}
        except Exception:
            pass
    # The full-canvas plate called large-brick-wall contains the whole scene;
    # as a reference it is shown at the full canvas. The clean wall cut-out is
    # reused for the buildable wall part instead.
    if name == "large-brick-wall":
        box = {"x": 0, "y": 0, "w": 100, "h": 100}
    original_url = ""
    original_file = ""
    image_size = None
    if name not in {"large-brick-wall", "unassigned"} and name not in {"light pool on cyclist", "scene dimmer"}:
        original_url, original_file, image_size = copy_original(ORIGINAL_IMAGES.get(name, ""), name, index, override_crop)
    if original_url:
        url = original_url
        file_value = original_file
    else:
        url = copy_asset(segment["file"])
        file_value = segment["file"]
    group_order = min((GROUP_META[group]["order"] for group in group_ids if group in GROUP_META), default=80)
    build_z = group_order * 10 + index
    part = {
        "schema": PART_SCHEMA,
        "id": segment["id"],
        "sourceLayerId": segment["id"],
        "sceneId": SCENE_ID,
        "index": segment.get("index", index + 1),
        "name": name,
        "label": meta["label"],
        "description": meta["description"],
        "category": meta["category"],
        "groupIds": group_ids,
        "role": layer.get("role") or "foreground",
        "type": layer.get("type") or segment.get("type") or "image",
        "kind": meta.get("kind") or "cutout",
        "buildable": meta.get("buildable", True),
        "staticVisible": meta.get("staticVisible", True) and bool(content_box),
        "zone": meta.get("zone") or "midground",
        "z": int(segment.get("z") or layer.get("z") or index),
        "buildZ": build_z,
        "box": box,
        "sourceBox": source_box,
        "contentBox": content_box,
        "crop": crop_box,
        "image": image_size,
        "opacity": round(float(segment.get("opacity", 1)), 3),
        "rotation": round(float(layer.get("rotation", 0) or 0), 2),
        "url": url,
        "file": file_value,
        "tags": meta["tags"],
        "concepts": meta["concepts"],
        "motion": ({"tracked": True, **track_summary(track)} if track else {"tracked": False}),
        "source": {"composition": "composition.json", "animation": ANIMATION_FILE.name if track else None, "segment": segment["file"], "original": original_file or None},
    }
    for key in ("containsBakedSign", "bakedInto", "derived"):
        if key in meta:
            part[key] = meta[key]
    if not part["buildable"]:
        part["buildZ"] = 0
    return part


def main() -> None:
    for directory in (OUT, ASSETS, SCENES, PARTS, GROUPS, ANIMATIONS):
        directory.mkdir(parents=True, exist_ok=True)

    part_names = list(PART_META.keys())
    parts = [build_part(name, index) for index, name in enumerate(part_names)]
    by_name = {part["name"]: part for part in parts}
    by_id = {part["id"]: part for part in parts}

    # Copy the source animation and preview; the scene record keeps only the
    # metadata and track math, but the exact file stays available for agents.
    animation_target = ANIMATIONS / f"{SCENE_SLUG}.json"
    shutil.copy2(ANIMATION_FILE, animation_target)
    preview_target = ASSETS / SCENE_SLUG / "preview.webp"
    if PREVIEW_FILE and PREVIEW_FILE.is_file():
        with Image.open(PREVIEW_FILE) as preview_image:
            preview_image.thumbnail((1200, 1200))
            preview_image.convert("RGB").save(preview_target, "WEBP", quality=84, method=4)
        preview_url = f"/data/library/scene-library/assets/{SCENE_SLUG}/preview.webp"
    else:
        preview_url = ""

    groups = []
    for group_id, meta in GROUP_META.items():
        members = [part for part in parts if group_id in part["groupIds"]]
        if not members:
            continue
        group = {
            "schema": GROUP_SCHEMA,
            "id": group_id,
            "label": meta["label"],
            "description": meta["description"],
            "category": meta["category"],
            "order": meta["order"],
            "origin": "curated",
            "confidence": 1,
            "buildable": meta.get("buildable", True),
            "tags": meta["tags"],
            "partIds": [part["id"] for part in members],
            "parts": [{"id": part["id"], "name": part["name"], "label": part["label"], "box": part["box"], "url": part["url"], "buildable": part["buildable"]} for part in members],
            "bbox": union_box(members),
            "counts": {
                "parts": len(members),
                "buildable": sum(1 for part in members if part["buildable"]),
                "animated": sum(1 for part in members if part["motion"].get("tracked")),
            },
        }
        (GROUPS / f"{group_id}.json").write_text(json.dumps(group, indent=2), "utf8")
        groups.append(group)

    groups.sort(key=lambda group: (group["order"], group["label"]))

    concepts = []
    for concept_id, label, description, aliases, names in CONCEPTS:
        concept_parts = [by_name[name] for name in names if name in by_name]
        concepts.append({
            "id": concept_id,
            "label": label,
            "description": description,
            "aliases": aliases,
            "partIds": [part["id"] for part in concept_parts],
            "partNames": names,
            "groupIds": sorted({group for part in concept_parts for group in part["groupIds"]}),
            "count": len(concept_parts),
            "missing": False,
        })
    for concept_id, label, description, aliases in MISSING_CONCEPTS:
        concepts.append({
            "id": concept_id,
            "label": label,
            "description": description,
            "aliases": aliases,
            "partIds": [],
            "partNames": [],
            "groupIds": [],
            "count": 0,
            "missing": True,
        })

    track_list = [track_summary(track) for track in ANIMATION.get("tracks", [])]
    tracks_by_id = {track["layerId"]: track for track in ANIMATION.get("tracks", [])}
    animation_tracks = []
    for layer_id, track in tracks_by_id.items():
        summary = next((item for item in track_list if item["layerId"] == layer_id), None)
        if summary:
            animation_tracks.append({**summary, "segments": track.get("segments", [])})

    default_ids = [part["id"] for part in sorted(parts, key=lambda part: part["buildZ"]) if part["buildable"]]
    base_ids = [by_name[name]["id"] for name in ["background-buildings", "large-brick-wall 2", "sloped-street"] if name in by_name]
    context_ids = [by_name[name]["id"] for name in ["bollard-right", "bollard-left", "chalkboard-sign", "cafe-sign", "street-lamp", "overhead-cables-lights"] if name in by_name]
    foreground_ids = [by_name[name]["id"] for name in ["wooden-workbench", "metal-sculpting-tool", "scattered-clay-pieces", "wooden-handled-tool", "clay-jar", "mini-succulent-right", "mini-succulent-left"] if name in by_name]
    cyclist_ids = [by_name[name]["id"] for name in ["bicycle-rear-wheel", "bicycle-front-wheel", "bicycle-frame", "cyclist-leg", "cyclist-torso", "cyclist-head"] if name in by_name]
    lighting_ids = [by_name[name]["id"] for name in ["street-lamp", "black-softbox-left", "overhead-cables-lights", "spot glow 1", "spot glow 2", "spot glow 3", "softbox glow", "light pool on cyclist", "scene dimmer"] if name in by_name]

    description = (
        "A narrow, sloping street outside the Singl-end café at night. Brick Georgian buildings and a warm café wordmark "
        "form the right wall; bollards mark the kerb, cobbles and setts catch the light, a cyclist rides through a pool of "
        "warm light, and a wooden workbench with clay tools and succulents frames the lower-left foreground."
    )
    scene = {
        "schema": SCHEMA,
        "id": SCENE_ID,
        "name": "Singl-End Bicicle — cyclist ride and light dim",
        "title": "Singl-End Bicicle — cyclist ride and light dim",
        "description": description,
        "setting": "A sloping café street at night",
        "timeOfDay": "night",
        "mood": ["cinematic", "warm", "urban", "handmade", "winter"],
        "width": int(SEGMENTS_DOC.get("width") or COMPOSITION.get("width") or 1098),
        "height": int(SEGMENTS_DOC.get("height") or COMPOSITION.get("height") or 976),
        "duration": int(SEGMENTS_DOC.get("duration") or ANIMATION.get("duration") or 8000),
        "brand": SEGMENTS_DOC.get("brand") or {},
        "pack": SEGMENTS_DOC.get("pack") or {},
        "brandPalette": SEGMENTS_DOC.get("palette") or [],
        "visualPalette": [
            {"name": "Night ink", "hex": "#15130f", "role": "Night ground and shadow"},
            {"name": "Tungsten", "hex": "#d79b52", "role": "Warm practical light and glow"},
            {"name": "Brick", "hex": "#8a4b35", "role": "Café wall and brickwork"},
            {"name": "Stone", "hex": "#5d564a", "role": "Setts, pavement and bollards"},
            {"name": "Cream light", "hex": "#f1ddb5", "role": "Highlights, sign lettering and light pools"},
        ],
        "formatLabel": SEGMENTS_DOC.get("formatLabel") or "",
        "templateId": SEGMENTS_DOC.get("templateId") or "",
        "createdAt": SEGMENTS_DOC.get("createdAt") or (COMPOSITION.get("meta") or {}).get("createdAt"),
        "guardrails": COMPOSITION.get("guardrails"),
        "source": {
            "folder": str(SOURCE.relative_to(ROOT)),
            "segments": "segments.json",
            "composition": "composition.json",
            "animation": ANIMATION_FILE.name,
            "preview": PREVIEW_FILE.name if PREVIEW_FILE else None,
            "segmentCount": len(SEGMENTS),
            "compositionVersion": COMPOSITION.get("version"),
            "agentSceneCount": len((COMPOSITION.get("meta") or {}).get("agentScene") or []),
            "reviewedAt": datetime.now(timezone.utc).isoformat(),
        },
        "preview": {"url": preview_url, "mode": "flattened"},
        "counts": {
            "parts": len(parts),
            "buildableParts": sum(1 for part in parts if part["buildable"]),
            "referenceParts": sum(1 for part in parts if not part["buildable"]),
            "groups": len(groups),
            "animatedParts": sum(1 for part in parts if part["motion"].get("tracked")),
            "tracks": len(animation_tracks),
        },
        "parts": parts,
        "groups": groups,
        "concepts": concepts,
        "animation": {
            "url": f"/data/library/scene-library/animations/{SCENE_SLUG}.json",
            "schema": ANIMATION.get("schema") or "agent-studio/animation/2",
            "id": ANIMATION.get("id") or "",
            "name": ANIMATION.get("name") or "",
            "createdAt": ANIMATION.get("createdAt") or "",
            "duration": int(ANIMATION.get("duration") or scene_duration_default()),
            "fps": int(ANIMATION.get("fps") or 25),
            "source": ANIMATION.get("source") or {},
            "tracks": animation_tracks,
            "recipes": [
                {
                    "id": "cyclist-ride",
                    "label": "Observed cyclist ride",
                    "description": "The source scene's six bicycle/cyclist tracks: the ride cycle, wheel and body motion across 8 seconds.",
                    "layerIds": cyclist_ids,
                    "duration": int(ANIMATION.get("duration") or 8000),
                    "loop": True,
                },
                {
                    "id": "night-glow",
                    "label": "Observed night glow + dim",
                    "description": "Street lamp, softbox, overhead lights, spot glows, light pool and scene dimmer from the source animation.",
                    "layerIds": lighting_ids,
                    "duration": int(ANIMATION.get("duration") or 8000),
                    "loop": True,
                },
                {
                    "id": "hold",
                    "label": "Hold / set dressing",
                    "description": "Static parts remain at their source boxes. Use hold for architecture, street, signage and foreground props.",
                    "layerIds": [part["id"] for part in parts if part["buildable"] and not part["motion"].get("tracked")],
                    "duration": 0,
                    "loop": False,
                },
            ],
        },
        "build": {
            "schema": BUILD_SCHEMA,
            "defaultPartIds": default_ids,
            "basePartIds": base_ids,
            "contextPartIds": context_ids,
            "foregroundPartIds": foreground_ids,
            "cyclistPartIds": cyclist_ids,
            "lightingPartIds": lighting_ids,
            "excludePartIds": [part["id"] for part in parts if not part["buildable"]],
            "canvas": {"width": int(SEGMENTS_DOC.get("width") or 1098), "height": int(SEGMENTS_DOC.get("height") or 976), "duration": int(SEGMENTS_DOC.get("duration") or 8000), "background": "#15130f"},
        },
        "agent": {
            "summary": "A complete night-street scene built from documented, reusable cut-outs. The cyclist rig and lighting are the only animated parts; everything else is set dressing with a hold.",
            "canBuild": ["brick street", "café frontage", "cyclist ride", "night lighting", "workshop foreground", "bollard/sign street furniture"],
            "buildHints": [
                "Start with architecture and street; keep them behind the props and subject.",
                "Place the six cyclist-rig parts together at their source boxes; their offsets and scales come from the observed animation tracks.",
                "Keep signage attached to the brick wall, and keep the street lamp above the street line.",
                "Use lighting above the set; the spot glows are overlays, not solid objects.",
                "Exclude reference plates: they are flattened full-scene images, not cut-outs.",
                "The café wordmark is baked into the brick wall; do not add the separate café-sign layer on top of it.",
            ],
            "dataQuality": [
                "The export's segment PNGs are full-canvas with transparent padding; the library uses the original cropped project art and the composition boxes.",
                "cobblestone-sidewalk is actually a large side-view bicycle cut-out, not pavement; it is reference-only.",
                "bollard-middle is actually a large bicycle-wheel cut-out; it is reference-only.",
                "large-brick-wall 2 and 3 are identical wall plates; wall 2 is the clean buildable wall, wall 3 is reference-only.",
                "large-brick-wall is a full-frame flattened plate with the whole scene; it is reference-only.",
                "unassigned is a full-frame flattened plate with the whole scene; it is reference-only.",
                "sloped-street's right edge contained a baked figure; the buildable part is a 210px clean crop of the left pavement.",
                "large-brick-wall 2 has a transparent cyclist-shaped hole and the café wordmark baked in; the animated rider fills the hole over the 8s ride.",
                "The export has no declared segmentGroup; the library groups were curated from folder names, layer names and roles, and are marked origin: curated.",
            ],
            "missingVocabulary": ["cars", "trees"],
            "examples": [
                "A cyclist passing a brick café at night, with warm lights and bollards.",
                "Buildings, cars, bricks and a cyclist.",
                "A brick street with café signage, bollards and warm spotlights.",
                "A workshop foreground with tools and plants, street behind.",
            ],
        },
    }

    # Scene-level animation track segments are large but useful for the client;
    # keep the full source track data in the scene document only.
    for track in animation_tracks:
        source_track = tracks_by_id.get(track["layerId"])
        if source_track:
            track["segments"] = source_track.get("segments", [])

    # Write part documents.
    for part in parts:
        doc = {**part, "scene": {"id": SCENE_ID, "name": scene["name"], "width": scene["width"], "height": scene["height"], "duration": scene["duration"]}}
        (PARTS / f"{part['id']}.json").write_text(json.dumps(doc, indent=2), "utf8")

    # Write the scene.
    (SCENES / f"{SCENE_ID}.json").write_text(json.dumps(scene, indent=2), "utf8")

    scene_summary = {
        "id": scene["id"],
        "name": scene["name"],
        "title": scene["title"],
        "description": scene["description"],
        "setting": scene["setting"],
        "timeOfDay": scene["timeOfDay"],
        "mood": scene["mood"],
        "formatLabel": scene["formatLabel"],
        "width": scene["width"],
        "height": scene["height"],
        "duration": scene["duration"],
        "preview": scene["preview"],
        "counts": scene["counts"],
        "groups": [{"id": group["id"], "label": group["label"], "counts": group["counts"]} for group in groups],
        "animation": {"url": scene["animation"]["url"], "tracks": scene["counts"]["tracks"]},
        "source": scene["source"],
        "examples": scene["agent"]["examples"],
    }

    index = {
        "schema": SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sceneId": SCENE_ID,
        "counts": {
            "scenes": 1,
            "parts": len(parts),
            "buildableParts": sum(1 for part in parts if part["buildable"]),
            "referenceParts": sum(1 for part in parts if not part["buildable"]),
            "groups": len(groups),
            "concepts": len(concepts),
            "missingConcepts": sum(1 for concept in concepts if concept["missing"]),
            "animatedParts": sum(1 for part in parts if part["motion"].get("tracked")),
            "tracks": len(animation_tracks),
        },
        "palette": scene["visualPalette"],
        "scenes": [scene_summary],
        "parts": sorted(parts, key=lambda part: part["buildZ"]),
        "groups": groups,
        "concepts": concepts,
        "examples": scene["agent"]["examples"],
        "missingVocabulary": scene["agent"]["missingVocabulary"],
        "files": {
            "scene": f"/data/library/scene-library/scenes/{SCENE_ID}.json",
            "animation": scene["animation"]["url"],
            "preview": preview_url,
        },
    }
    (OUT / "index.json").write_text(json.dumps(index, indent=2), "utf8")

    readme = f"""# Scene library — Singl-End Bicicle

Reviewed from `{scene['source']['folder']}`.

## Scene

**{scene['name']}**

{scene['description']}

- {scene['width']}×{scene['height']} px, {scene['duration']/1000:.1f}s
- {scene['counts']['parts']} parts ({scene['counts']['buildableParts']} buildable, {scene['counts']['referenceParts']} reference plates)
- {scene['counts']['groups']} groups · {scene['counts']['animatedParts']} animated parts · {scene['counts']['tracks']} tracks
- Palette: {', '.join(item['name']+' '+item['hex'] for item in scene['visualPalette'])}

## Build groups

| Group | Parts | What it is for |
|---|---:|---|
{chr(10).join(f"| {g['label']} | {g['counts']['parts']} | {g['description']} |" for g in groups)}

## Concepts the agent can search

{chr(10).join(f"- **{c['label']}** — {c['description']}" + (" _(not in this set yet)_" if c['missing'] else "") for c in concepts)}

## Data quality

{chr(10).join('- ' + item for item in scene['agent']['dataQuality'])}

## Agent rules

{chr(10).join('- ' + item for item in scene['agent']['buildHints'])}

## Files

- `index.json` — scene, parts, groups, concepts, examples.
- `scenes/{SCENE_ID}.json` — full scene, parts, groups and animation tracks.
- `parts/<id>.json` — each part with box, URL, description, tags, concepts and motion.
- `groups/<id>.json` — each group with members and bbox.
- `animations/{SCENE_SLUG}.json` — the observed 8s animation.
- `assets/{SCENE_SLUG}/` — transparent cut-outs and the flattened preview.

Rebuild with:

```bash
npm run build:scene-library
```
"""
    (OUT / "README.md").write_text(readme, "utf8")

    # Keep the asset folder clean: remove stale copies from earlier builds and
    # from the full-canvas export that the derived scene no longer uses.
    asset_dir = ASSETS / SCENE_SLUG
    used_assets = {Path(part["url"]).name for part in parts if part.get("url")}
    used_assets.add("preview.webp")
    if asset_dir.is_dir():
        for candidate in asset_dir.iterdir():
            if candidate.is_file() and candidate.name not in used_assets:
                candidate.unlink()

    print(f"scene library: {len(parts)} parts, {len(groups)} groups, {len(concepts)} concepts, {len(animation_tracks)} tracks")
    print(f"wrote {OUT.relative_to(ROOT)}")


def scene_duration_default() -> int:
    return int(SEGMENTS_DOC.get("duration") or ANIMATION.get("duration") or 8000)


if __name__ == "__main__":
    main()
