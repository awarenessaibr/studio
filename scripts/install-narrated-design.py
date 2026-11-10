#!/usr/bin/env python3
"""
install-narrated-design.py — install a rendered narrated cut as a first-class
library design.

The design is a one-frame composition holding the poster, exactly like the
existing HTML stage reels, plus `sourceVideo` pointing at the narrated WebM.
That is what the Agent Studio plays: the recording, with its audio track.

Usage
  python3 scripts/install-narrated-design.py \
    deliverables/butterfly-cinematic-03-narrated/narration-timeline.json \
    scripts/source-manifests/butterfly-cinematic-03-narrated.render.json
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "data" / "library"
PROJECTS = ROOT / "data" / "projects"
NOW = datetime.now(timezone.utc)


def iso(ms: bool = False) -> str:
    if ms:
        return NOW.strftime("%Y-%m-%dT%H:%M:%S.") + f"{NOW.microsecond // 1000:03d}Z"
    return NOW.isoformat(timespec="seconds")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def default_audio_mix(duration: int) -> dict:
    return {
        "narration": {"volume": 1, "muted": False},
        "music": {
            "enabled": False, "url": "", "name": "", "durationMs": 0,
            "volume": 0.28, "startMs": 0, "endMs": duration, "inMs": 0,
            "loop": True, "fadeInMs": 800, "fadeOutMs": 1200,
            "duck": True, "duckDb": -9,
        },
    }


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: install-narrated-design.py <narration-timeline.json> <render-manifest.json>", file=sys.stderr)
        return 2
    timeline_path = Path(sys.argv[1]).resolve()
    render_path = Path(sys.argv[2]).resolve()
    timeline = json.loads(timeline_path.read_text(encoding="utf-8"))
    render = json.loads(render_path.read_text(encoding="utf-8"))

    design_id = timeline["id"]
    duration = int(timeline["durationMs"])
    width = int(timeline["width"])
    height = int(timeline["height"])
    poster_time = float(render.get("posterAt") or duration / 2000)
    stage_file = render.get("file") or f"deliverables/{design_id}/stage/cinematic-03-narrated.html"
    video = LIB / "sources" / f"{design_id}.webm"
    poster_jpg = LIB / "sources" / f"{design_id}.jpg"
    mix = (timeline_path.parent / timeline["audio"]["mix"]).resolve()
    for path in (video, poster_jpg, mix):
        if not path.exists():
            raise SystemExit(f"missing {path} — render the cut first")

    probe = json.loads(subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "json", str(video),
    ], check=True, capture_output=True, text=True).stdout)
    video_ms = round(float(probe["format"]["duration"]) * 1000)
    if abs(video_ms - duration) > 200:
        raise SystemExit(f"recording is {video_ms} ms, timeline says {duration} ms")

    # ── Project: one full-frame poster, like every HTML stage reel. ────────
    project = PROJECTS / design_id
    images = project / "images"
    compositions = project / "compositions"
    images.mkdir(parents=True, exist_ok=True)
    compositions.mkdir(parents=True, exist_ok=True)
    poster_png = images / "poster.png"
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-i", str(poster_jpg),
        "-frames:v", "1", str(poster_png),
    ], check=True)

    composition_path = compositions / f"{design_id}.composition.json"
    composition = {
        "version": 1,
        "id": design_id,
        "name": timeline["designName"],
        "width": width,
        "height": height,
        "duration": duration,
        "defaultLocale": "en",
        "activeLocale": None,
        "referenceLayerId": None,
        "characters": [],
        "formats": [{
            "id": "master", "isMaster": True, "channel": "social", "label": "Master",
            "width": width, "height": height, "layerOverrides": {}, "variableValues": {},
        }],
        "activeFormatId": "master",
        "variables": [],
        "brandKit": None,
        "brandKitId": None,
        "guardrails": {"enabled": False, "block": False},
        "showSafeZones": True,
        "revision": 0,
        "meta": {
            "brandName": timeline["brand"]["name"],
            "htmlSource": stage_file,
            "posterTime": poster_time,
            "exactPoster": True,
            "narrated": True,
            "narration": str(timeline_path.relative_to(ROOT)),
        },
        "sourceFacts": {
            "htmlSource": timeline["designName"],
            "stageMetadata": {
                "aspectRatio": f"{width}/{height}",
                "backgroundResolved": True,
                "textLayers": 0,
                "imageLayers": 1,
                "stageClasses": ["stage", "s916", "k-pigs"],
                "layout": "rasterized",
                "fonts": "baked",
            },
            "layerCount": 1,
            "warnings": [
                f"HTML stage rasterised to its exact frame at {poster_time:.2f}s. "
                "The narrated cut is the source recording with the 7 narration clips.",
            ],
            "kind": "html-stage-poster",
        },
        "layers": [{
            "id": "source-frame",
            "type": "image",
            "name": "Source frame",
            "role": "background",
            "z": 0,
            "x": 0, "y": 0, "w": 100, "h": 100,
            "url": f"/data/projects/{design_id}/images/poster.png",
            "visible": True,
            "opacity": 1,
            "keyframes": [
                {"time": 0, "x": 0, "y": 0, "w": 100, "h": 100, "opacity": 1},
                {"time": duration, "x": 0, "y": 0, "w": 100, "h": 100, "opacity": 1},
            ],
        }],
    }
    composition_path.write_text(json.dumps(composition, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # ── Original motion: a hold; playback uses sourceVideo. ───────────────
    anim_dir = LIB / "animations" / design_id
    anim_dir.mkdir(parents=True, exist_ok=True)
    anim_path = anim_dir / "original.animation.json"
    animation = {
        "schema": "agent-studio/animation/2",
        "kind": "studio-animation",
        "id": f"{design_id}-original",
        "name": "Original motion · narrated",
        "compositionId": design_id,
        "origin": "original",
        "createdAt": iso(),
        "duration": duration,
        "fps": int(timeline.get("fps", 25)),
        "source": {
            "app": "narrated-cut",
            "design": timeline["designName"],
            "layerCount": 1,
            "audio": timeline["audio"]["mix"],
        },
        "tracks": [{
            "layerId": "source-frame",
            "layerName": "Source frame",
            "layerType": "image",
            "role": "background",
            "text": "",
            "box": {"x": 0, "y": 0, "w": 1, "h": 1},
            "segments": [{
                "preset": "keyframes", "label": "Keyframes", "start": 0,
                "duration": duration, "loop": False,
                "frames": [
                    {"t": 0, "dx": 0, "dy": 0, "sx": 1, "sy": 1, "a": 1},
                    {"t": duration, "dx": 0, "dy": 0, "sx": 1, "sy": 1, "a": 1},
                ],
            }],
        }],
    }
    anim_path.write_text(json.dumps(animation, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # ── Detail + index entry. ─────────────────────────────────────────────
    tags = ["narrated", "html-stage", "reel", "butterfly-pig", "voice"]
    detail = {
        "schema": "agent-studio/library/1",
        "id": design_id,
        "project": design_id,
        "name": timeline["designName"],
        "brand": timeline["brand"],
        "kind": "event-promo",
        "tags": tags,
        "width": width,
        "height": height,
        "aspect": "9:16",
        "duration": duration,
        "composition": f"/data/projects/{design_id}/compositions/{design_id}.composition.json",
        "status": "ready",
        "issues": [],
        "layers": [{
            "id": "source-frame",
            "name": "Source frame",
            "type": "image",
            "kind": "photo",
            "z": 0,
            "box": {"x": 0, "y": 0, "w": 100, "h": 100},
            "window": [[0, None]],
            "url": f"/data/projects/{design_id}/images/poster.png",
            "groups": ["g-photo-source-frame"],
        }],
        "groups": [{
            "id": "g-photo-source-frame",
            "kind": "photo",
            "label": "Source frame",
            "layerIds": ["source-frame"],
            "children": [],
            "bbox": {"x": 0, "y": 0, "w": 100, "h": 100},
            "window": {"start": 0, "end": None},
            "slots": [{"layerId": "source-frame", "type": "image", "label": "Source frame", "current": ""}],
        }],
        "menuItems": [],
        "entities": {
            "business-name": ["THE BUTTERFLY AND THE PIG · THE GOSSIP"],
            "cta": ["Do join us."],
            "hours": ["Live music Fridays from 7:30, and Saturdays from 6:30."],
        },
        "builtAt": iso(),
        "animations": [{
            "id": f"{design_id}-original",
            "name": "Original motion · narrated",
            "origin": "original",
            "file": f"/data/library/animations/{design_id}/original.animation.json",
            "duration": duration,
            "tracks": 1,
            "status": "ok",
            "issues": [],
        }],
        "sourceVideo": f"/data/library/sources/{design_id}.webm",
        "sourcePoster": f"/data/library/sources/{design_id}.jpg",
        "sourceDuration": duration,
        "source": {
            "kind": "html-stage",
            "file": stage_file,
            "stage": 0,
            "posterTime": poster_time,
            "fps": int(timeline.get("fps", 25)),
            "audio": str(mix.relative_to(ROOT)),
            "timeline": str(timeline_path.relative_to(ROOT)),
        },
        "audioMixes": {"default": default_audio_mix(duration)},
        "narration": {
            "timeline": str(timeline_path.relative_to(ROOT)),
            "mix": str(mix.relative_to(ROOT)),
            "integratedLufs": timeline["audio"]["integratedLufs"],
            "truePeakDb": timeline["audio"]["truePeakDb"],
            "lineCount": len(timeline["lines"]),
            "lines": [{
                "index": line["index"],
                "speaker": line["speaker"],
                "text": line["text"],
                "speechStartMs": line["speechStartMs"],
                "speechEndMs": line["speechEndMs"],
                "cardStartMs": line["bubble"]["startMs"],
                "cardEndMs": line["bubble"]["endMs"],
            } for line in timeline["lines"]],
        },
    }
    detail_path = LIB / "designs" / f"{design_id}.json"
    detail_path.write_text(json.dumps(detail, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    entry = {
        "id": design_id,
        "name": timeline["designName"],
        "brandId": timeline["brand"]["id"],
        "kind": "event-promo",
        "tags": tags,
        "aspect": "9:16",
        "width": width,
        "height": height,
        "duration": duration,
        "layers": 1,
        "groups": 1,
        "status": "ready",
        "issues": 0,
        "thumbnail": f"/data/library/sources/{design_id}.jpg",
        "composition": detail["composition"],
        "detail": f"/data/library/designs/{design_id}.json",
        "menuItems": 0,
        "animations": [{
            "id": f"{design_id}-original",
            "name": "Original motion · narrated",
            "origin": "original",
            "file": f"/data/library/animations/{design_id}/original.animation.json",
            "duration": duration,
            "status": "ok",
        }],
        "sourceVideo": f"/data/library/sources/{design_id}.webm",
        "sourcePoster": f"/data/library/sources/{design_id}.jpg",
        "sourceDuration": duration,
    }

    index_path = LIB / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    designs = [design for design in index["designs"] if design["id"] != design_id]
    designs.append(entry)
    counts = index.get("counts", {})
    counts["designs"] = len(designs)
    counts["ready"] = sum(1 for design in designs if design.get("status") == "ready")
    counts["brands"] = len({design.get("brandId") for design in designs if design.get("brandId")})
    facets = {"kinds": {}, "aspects": {}, "status": {}, "brands": {}}
    for design in designs:
        facets["kinds"][design["kind"]] = facets["kinds"].get(design["kind"], 0) + 1
        facets["aspects"][design["aspect"]] = facets["aspects"].get(design["aspect"], 0) + 1
        facets["status"][design["status"]] = facets["status"].get(design["status"], 0) + 1
        facets["brands"][design["brandId"]] = facets["brands"].get(design["brandId"], 0) + 1
    index["designs"] = designs
    index["counts"] = counts
    index["facets"] = facets
    index["generatedAt"] = iso(ms=True)
    index_path.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # ── Link it as another animation on the design it was cut from. ───────
    # The Audio drawer and the player both treat an animation with a
    # sourceVideo as a source-backed cut, not a canvas animation.
    source_id = timeline.get("sourceDesignId")
    if source_id and source_id != design_id:
        source_detail_path = LIB / "designs" / f"{source_id}.json"
        if not source_detail_path.exists():
            raise SystemExit(f"source design not found: {source_detail_path}")
        source_detail = json.loads(source_detail_path.read_text(encoding="utf-8"))
        source_index = json.loads(index_path.read_text(encoding="utf-8"))
        source_entry = next((item for item in source_index["designs"] if item["id"] == source_id), None)
        if source_entry is None:
            raise SystemExit(f"source design is not in the catalogue: {source_id}")

        animation_id = f"{source_id}-narrated"
        source_anim_dir = LIB / "animations" / source_id
        source_anim_dir.mkdir(parents=True, exist_ok=True)
        source_anim_path = source_anim_dir / "narrated.animation.json"
        # The composition is served from /data/projects/<id>/…; read it from disk.
        composition_rel = str(source_detail.get("composition", "")).replace("/data/", "", 1)
        try:
            source_composition = json.loads((ROOT / "data" / composition_rel).read_text(encoding="utf-8"))
        except Exception:
            source_composition = None
        layer_id = "html-bg"
        if source_composition:
            layer_ids = [layer.get("id") for layer in source_composition.get("layers", [])]
            if layer_id not in layer_ids and layer_ids:
                layer_id = layer_ids[0]

        source_animation = {
            "schema": "agent-studio/animation/2",
            "kind": "studio-animation",
            "id": animation_id,
            "name": "Narrated cut",
            "compositionId": source_id,
            "origin": "narrated",
            "createdAt": iso(),
            "duration": duration,
            "fps": int(timeline.get("fps", 25)),
            "source": {
                "app": "narrated-cut",
                "design": source_detail.get("name", source_id),
                "layerCount": 1,
                "audio": str(mix.relative_to(ROOT)),
            },
            "narration": {
                "indexKey": design_id,
                "timeline": str(timeline_path.relative_to(ROOT)),
                "mix": str(mix.relative_to(ROOT)),
                "lineCount": len(timeline["lines"]),
            },
            "tracks": [{
                "layerId": layer_id,
                "layerName": "Source frame",
                "layerType": "image",
                "role": "background",
                "text": "",
                "box": {"x": 0, "y": 0, "w": 1, "h": 1},
                "segments": [{
                    "preset": "keyframes", "label": "Keyframes", "start": 0,
                    "duration": duration, "loop": False,
                    "frames": [
                        {"t": 0, "dx": 0, "dy": 0, "sx": 1, "sy": 1, "a": 1},
                        {"t": duration, "dx": 0, "dy": 0, "sx": 1, "sy": 1, "a": 1},
                    ],
                }],
            }],
        }
        source_anim_path.write_text(json.dumps(source_animation, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        anim_entry = {
            "id": animation_id,
            "name": "Narrated cut",
            "origin": "narrated",
            "file": f"/data/library/animations/{source_id}/narrated.animation.json",
            "duration": duration,
            "tracks": 1,
            "status": "ok",
            "issues": [],
            "sourceVideo": f"/data/library/sources/{design_id}.webm",
            "sourcePoster": f"/data/library/sources/{design_id}.jpg",
            "sourceDuration": duration,
            "narration": {
                "indexKey": design_id,
                "timeline": str(timeline_path.relative_to(ROOT)),
                "mix": str(mix.relative_to(ROOT)),
                "lineCount": len(timeline["lines"]),
            },
        }
        source_detail["animations"] = [item for item in source_detail.get("animations", []) if item.get("id") != animation_id] + [anim_entry]
        source_detail.setdefault("audioMixes", {})
        source_detail["audioMixes"].setdefault(animation_id, default_audio_mix(duration))
        source_detail["audioMixes"].setdefault("default", default_audio_mix(int(source_detail.get("duration") or duration)))
        source_detail_path.write_text(json.dumps(source_detail, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        source_entry["animations"] = [item for item in source_entry.get("animations", []) if item.get("id") != animation_id] + [{
            key: anim_entry[key] for key in ("id", "name", "origin", "file", "duration", "status", "sourceVideo", "sourcePoster", "sourceDuration", "narration")
        }]
        source_index["generatedAt"] = iso(ms=True)
        index_path.write_text(json.dumps(source_index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        print(f"linked     {source_id} → {animation_id} ({duration} ms)")

    # ── Manifest with the hashes that make the cut auditable. ─────────────
    manifest_path = LIB / "sources" / "narrated.json"
    manifest = {"schema": "agent-studio/narrated-cut/1", "capturedAt": iso(ms=True), "designs": []}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    manifest["capturedAt"] = iso(ms=True)
    manifest["designs"] = [item for item in manifest.get("designs", []) if item.get("id") != design_id]
    manifest["designs"].append({
        "id": design_id,
        "name": timeline["designName"],
        "width": width,
        "height": height,
        "duration": duration,
        "posterTime": poster_time,
        "lineCount": len(timeline["lines"]),
        "timeline": str(timeline_path.relative_to(ROOT)),
        "audio": str(mix.relative_to(ROOT)),
        "composition": str(composition_path.relative_to(ROOT)),
        "sourceVideo": entry["sourceVideo"],
        "sourcePoster": entry["sourcePoster"],
        "videoSha256": sha256(video),
        "posterSha256": sha256(poster_png),
        "mixSha256": sha256(mix),
    })
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"installed {design_id}")
    print(f"  project     {composition_path.relative_to(ROOT)}")
    print(f"  poster      {poster_png.relative_to(ROOT)}")
    print(f"  detail      {detail_path.relative_to(ROOT)}")
    print(f"  animation   {anim_path.relative_to(ROOT)}")
    print(f"  index       {len(designs)} designs, {counts['ready']} ready, brand {facets['brands'].get(timeline['brand']['id'])}")
    print(f"  manifests   {manifest_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
