#!/usr/bin/env python3
"""Apply a motion plan to a Layer Studio composition.

usage: apply-motion.py COMPOSITION.json PLAN.json [--duration MS] [--fps N]
                         [--no-plate] [--in-place] [-o OUT]
"""

import argparse
import copy
import fnmatch
import json
import math
from pathlib import Path


MAX_DURATION_MS = 30_000
MAX_KEYFRAMES_PER_LAYER = 400
MAX_TRANSLATION_PCT = 1.0
MAX_ROTATION_DEG = 1.0
MAX_SCALE_AMPLITUDE = 0.1
ALLOWED_RULE_FIELDS = {
    "match", "static", "ax", "ay", "rot", "opacity", "scale", "cycles", "phase",
}


def finite_number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number.")
    return float(value)


def validate_plan(plan):
    if not isinstance(plan, dict):
        raise ValueError("The motion plan must be a JSON object.")
    if set(plan) - {"_doc", "duration", "rules"}:
        raise ValueError("The motion plan contains unknown top-level fields.")
    rules = plan.get("rules")
    if not isinstance(rules, list) or not rules:
        raise ValueError('The motion plan must contain a non-empty "rules" array.')
    for index, rule in enumerate(rules):
        label = f"rules[{index}]"
        if not isinstance(rule, dict):
            raise ValueError(f"{label} must be an object.")
        if set(rule) - ALLOWED_RULE_FIELDS:
            raise ValueError(f"{label} contains unknown fields.")
        if not isinstance(rule.get("match"), str) or not rule["match"]:
            raise ValueError(f'{label} must have a non-empty "match" glob.')
        if "static" in rule and not isinstance(rule["static"], bool):
            raise ValueError(f'{label}.static must be a boolean.')
        for field in ("ax", "ay"):
            if field in rule and abs(finite_number(rule[field], f"{label}.{field}")) > MAX_TRANSLATION_PCT:
                raise ValueError(f"{label}.{field} exceeds the 1% translation limit.")
        if "rot" in rule and abs(finite_number(rule["rot"], f"{label}.rot")) > MAX_ROTATION_DEG:
            raise ValueError(f"{label}.rot exceeds the 1 degree rotation limit.")
        if "scale" in rule:
            scale = finite_number(rule["scale"], f"{label}.scale")
            if not 0 <= scale <= MAX_SCALE_AMPLITUDE:
                raise ValueError(f"{label}.scale must be between 0 and {MAX_SCALE_AMPLITUDE}.")
        if "cycles" in rule:
            cycles = finite_number(rule["cycles"], f"{label}.cycles")
            if not 0 < cycles <= 20:
                raise ValueError(f"{label}.cycles must be greater than 0 and at most 20.")
        if "phase" in rule:
            phase = finite_number(rule["phase"], f"{label}.phase")
            if not 0 <= phase <= 1:
                raise ValueError(f"{label}.phase must be between 0 and 1.")
        if "opacity" in rule:
            opacity = rule["opacity"]
            if not isinstance(opacity, list) or len(opacity) != 2:
                raise ValueError(f"{label}.opacity must be a two-value array.")
            if any(not 0 <= finite_number(value, f"{label}.opacity") <= 1 for value in opacity):
                raise ValueError(f"{label}.opacity values must be between 0 and 1.")
    return rules


def make_keyframe(time, x, y, width, height, opacity, rotation):
    return {
        "time": int(round(time)),
        "x": round(x, 4),
        "y": round(y, 4),
        "w": round(width, 4),
        "h": round(height, 4),
        "opacity": round(opacity, 4),
        "rotation": round(rotation, 4),
    }


def build_keyframes(layer, rule, duration, fps):
    samples = max(2, round(duration / 1000 * fps))
    if samples + 1 > MAX_KEYFRAMES_PER_LAYER:
        raise ValueError(
            f"{duration}ms at {fps}fps needs {samples + 1} keyframes; "
            f"the studio limit is {MAX_KEYFRAMES_PER_LAYER} per layer."
        )
    cycles = rule.get("cycles", 1)
    phase = rule.get("phase", 0.0)
    ax = rule.get("ax", 0.0)
    ay = rule.get("ay", 0.0)
    rotation = rule.get("rot", 0.0)
    low, high = rule.get("opacity", [layer["opacity"], layer["opacity"]])
    scale = rule.get("scale", 0.0)
    frames = []
    for index in range(samples + 1):
        progress = index / samples
        angle = 2 * math.pi * (cycles * progress + phase)
        sine = math.sin(angle)
        cosine = math.cos(angle)
        factor = 1 + scale * sine
        width = layer["w"] * factor
        height = layer["h"] * factor
        x = layer["x"] + ax * sine - (width - layer["w"]) / 2
        y = layer["y"] + ay * cosine - (height - layer["h"]) / 2
        opacity = low + (high - low) * (0.5 + 0.5 * sine)
        frames.append(make_keyframe(
            progress * duration, x, y, width, height, opacity,
            layer["rotation"] + rotation * sine,
        ))
    return frames


def apply_motion(composition, plan, duration=None, fps=12, no_plate=False):
    rules = validate_plan(plan)
    if not isinstance(composition, dict) or not isinstance(composition.get("layers"), list):
        raise ValueError('The composition must be an object with a "layers" array.')
    if not isinstance(fps, int) or isinstance(fps, bool) or not 1 <= fps <= 60:
        raise ValueError("FPS must be an integer between 1 and 60.")
    selected_duration = duration if duration is not None else plan.get("duration", composition.get("duration"))
    if not isinstance(selected_duration, int) or isinstance(selected_duration, bool):
        raise ValueError("Duration must be an integer number of milliseconds.")
    if not 1 <= selected_duration <= MAX_DURATION_MS:
        raise ValueError(f"Duration must be between 1 and {MAX_DURATION_MS} milliseconds.")

    result = copy.deepcopy(composition)
    result["duration"] = selected_duration
    layer_ids = [layer.get("id") for layer in result["layers"]]
    reference_id = result.get("referenceLayerId")
    if reference_id and reference_id not in layer_ids:
        raise ValueError(f'Reference layer "{reference_id}" is not present in the composition.')
    reference = next((layer for layer in result["layers"] if layer.get("id") == reference_id), None)
    if reference:
        if not no_plate:
            reference["visible"] = True
            reference["locked"] = True
            reference["z"] = min(
                finite_number(layer.get("z", 0), f'layer "{layer.get("name", layer.get("id"))}".z')
                for layer in result["layers"]
            )
        reference["keyframes"] = []

    animated = static = untouched = 0
    for layer in result["layers"]:
        if layer is reference:
            continue
        name = layer.get("name")
        if not isinstance(name, str):
            raise ValueError(f'Layer "{layer.get("id")}" has no valid name.')
        rule = next((entry for entry in rules if fnmatch.fnmatchcase(name, entry["match"])), None)
        if rule is None:
            untouched += 1
            continue
        if rule.get("static"):
            layer["keyframes"] = []
            static += 1
            continue
        base = {
            key: finite_number(layer.get(source_key), f'layer "{name}".{source_key}')
            for key, source_key in (
                ("x", "x"), ("y", "y"), ("w", "w"), ("h", "h"),
                ("opacity", "opacity"), ("rotation", "rotation"),
            )
        }
        if base["w"] <= 0 or base["h"] <= 0:
            raise ValueError(f'Layer "{name}" must have positive width and height.')
        layer["keyframes"] = build_keyframes(base, rule, selected_duration, fps)
        animated += 1
    return result, {"animated": animated, "static": static, "untouched": untouched}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("composition")
    parser.add_argument("plan")
    parser.add_argument("--duration", type=int)
    parser.add_argument("--fps", type=int, default=12)
    parser.add_argument("--no-plate", action="store_true")
    output = parser.add_mutually_exclusive_group()
    output.add_argument("--in-place", action="store_true", help="Replace the input composition.")
    output.add_argument("-o", "--out", help="Write to this path instead of a sidecar.")
    args = parser.parse_args()

    source = Path(args.composition)
    composition = json.loads(source.read_text(encoding="utf-8"))
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    try:
        result, counts = apply_motion(composition, plan, args.duration, args.fps, args.no_plate)
    except ValueError as error:
        parser.error(str(error))

    if args.in_place:
        target = source
    elif args.out:
        target = Path(args.out)
        if target.resolve() == source.resolve():
            parser.error('Use "--in-place" to explicitly replace the input composition.')
    else:
        target = source.with_name(f"{source.stem}.animated{source.suffix}")
    target.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(
        f'{counts["animated"]} animated, {counts["static"]} static, '
        f'{counts["untouched"]} unchanged; {result["duration"]}ms -> {target}'
    )


if __name__ == "__main__":
    main()
