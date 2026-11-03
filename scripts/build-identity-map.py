#!/usr/bin/env python3
"""build-identity-map.py — the group identity map, rebuilt from the pack.

The map answers one question for an owner: do these venues share a system, or
are they five unrelated brands? It shows the lockups, the primaries, the shared
grey and the contrast each pairing actually achieves.

Everything comes from the pack: wordmark PNGs, palette entries from the token
file, venue descriptions from the portfolio guide. Nothing is retyped, so the
map cannot drift from the data it describes.

Usage
    python3 scripts/build-identity-map.py --pack cawley-hotels-…-d04d \
        --out deliverables/cawley/group-identity-map.png

Requires Pillow (bundled with the studio runtime).
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
PACKS = ROOT / "data" / "brand-packs"
FONTS = ROOT / "data" / "fonts"

S = 2  # supersample factor: draw at 2x, downscale, get clean type


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.strip().lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def luminance(hex_value: str) -> float:
    def channel(c: int) -> float:
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = hex_rgb(hex_value)
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast(a: str, b: str) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def font(size: int, weight: str = "Regular"):
    face = ImageFont.truetype(str(FONTS / "mulish-7ff882.ttf"), size * S)
    try:
        face.set_variation_by_name(weight)
    except Exception:  # static build: keep the default face rather than fail
        pass
    return face


def wrap(text: str, face, max_width: int) -> list[str]:
    words, lines, current = text.split(), [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if face.getlength(candidate) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_tracked(draw, xy, text, face, fill, tracking):
    """Letter-spaced text (Pillow has no tracking, so step per glyph)."""
    x, y = xy
    for char in text:
        draw.text((x, y), char, font=face, fill=fill)
        x += face.getlength(char) + tracking


def pick_wordmark(brand_dir: pathlib.Path) -> pathlib.Path | None:
    logos = sorted((brand_dir / "assets" / "logos").glob("*wordmark-white*.png"))
    if logos:
        return logos[0]
    any_mark = sorted((brand_dir / "assets" / "logos").glob("*wordmark*.png"))
    return any_mark[0] if any_mark else None


def portfolio_formats(pack: dict) -> dict[str, str]:
    """Venue description keyed by the portfolio table's venue label."""
    out: dict[str, str] = {}
    sections = ((pack.get("portfolio") or {}).get("guidelines") or {}).get("sections") or []
    for section in sections:
        for table in section.get("tables") or []:
            head = [str(cell).strip().upper() for cell in table.get("head") or []]
            if "VENUE" not in head or "FORMAT" not in head:
                continue
            vi, fi = head.index("VENUE"), head.index("FORMAT")
            for row in table.get("rows") or []:
                if len(row) > max(vi, fi):
                    out[str(row[vi]).strip()] = str(row[fi]).strip()
    return out


def portfolio_locations(pack: dict) -> dict[str, str]:
    """Venue town keyed by the portfolio table's brand label."""
    out: dict[str, str] = {}
    sections = ((pack.get("portfolio") or {}).get("guidelines") or {}).get("sections") or []
    for section in sections:
        for table in section.get("tables") or []:
            head = [str(cell).strip().upper() for cell in table.get("head") or []]
            if "BRAND" not in head or "LOCATION" not in head:
                continue
            bi, li = head.index("BRAND"), head.index("LOCATION")
            for row in table.get("rows") or []:
                if len(row) > max(bi, li):
                    out[str(row[bi]).strip()] = str(row[li]).strip()
    return out


def match_format(label: str, formats: dict[str, str]) -> str:
    if label in formats:
        return formats[label]
    key = label.lower()
    for name, value in formats.items():
        if name.lower() in key or key in name.lower():
            return value
    return ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=1800)
    ap.add_argument("--height", type=int, default=1000)
    ap.add_argument("--title", default="Five venues, one design system.")
    ap.add_argument("--subtitle", default=(
        "One sans, one shared grey, five primaries — venue autonomy "
        "inside a group system."
    ))
    ap.add_argument("--provenance", default="")
    args = ap.parse_args()

    pack_dir = PACKS / args.pack
    pack = json.loads((pack_dir / "pack.json").read_text())["pack"]
    brands = pack.get("brands") or []
    if not brands:
        print("No brands in pack.", file=sys.stderr)
        return 1

    formats = portfolio_formats(pack)
    locations = portfolio_locations(pack)
    ink, muted, hair, paper = "#1F1F1F", "#6E6E6E", "#DEDEDA", "#FAFAF8"
    ok, warn, bad = "#1E7A4B", "#B06B00", "#B3261E"

    W, H = args.width * S, args.height * S
    margin, gap = 64 * S, 20 * S
    panel_w = (W - 2 * margin - (len(brands) - 1) * gap) / len(brands)
    swatch_h = 340 * S

    image = Image.new("RGB", (W, H), hex_rgb(paper))
    draw = ImageDraw.Draw(image)

    # Header
    draw_tracked(draw, (margin, 52 * S), "CAWLEY HOTELS & RESTAURANTS",
                 font(12, "SemiBold"), muted, 2.2 * S)
    draw.text((margin, 78 * S), args.title, font=font(38, "SemiBold"), fill=ink)
    draw.text((margin, 132 * S), args.subtitle, font=font(16, "Light"), fill=muted)

    # Panels
    top = 196 * S
    failures: list[tuple[str, float]] = []
    for index, brand in enumerate(brands):
        x = margin + index * (panel_w + gap)
        accent = (brand.get("palette") or [{}])[0]
        accent_hex = accent.get("hex") or "#3D3E3E"

        draw.rounded_rectangle([x, top, x + panel_w, top + swatch_h],
                               radius=6 * S, fill=hex_rgb(accent_hex))

        mark = pick_wordmark(pack_dir / "files" / brand["id"])
        if mark:
            logo = Image.open(mark).convert("RGBA")
            box_w, box_h = panel_w * 0.78, swatch_h * 0.44
            scale = min(box_w / logo.width, box_h / logo.height)
            logo = logo.resize((max(1, int(logo.width * scale)),
                                max(1, int(logo.height * scale))), Image.LANCZOS)
            image.paste(logo, (int(x + (panel_w - logo.width) / 2),
                               int(top + (swatch_h - logo.height) / 2)), logo)

        cursor = top + swatch_h + 18 * S
        label = brand.get("name", brand["id"])
        draw.text((x, cursor), label, font=font(19, "SemiBold"), fill=ink)
        cursor += 26 * S
        locality = locations.get(label) or (brand.get("dir") or "").replace("-", " ").title()
        draw.text((x, cursor), locality, font=font(12, "Regular"), fill=muted)
        cursor += 26 * S

        # Palette: the three primaries, named and measured.
        for entry in (brand.get("palette") or [])[:3]:
            colour = entry.get("hex") or "#000000"
            draw.rounded_rectangle([x, cursor + 2 * S, x + 14 * S, cursor + 16 * S],
                                   radius=3 * S, fill=hex_rgb(colour),
                                   outline=hex_rgb(hair), width=1)
            draw.text((x + 22 * S, cursor + 1 * S),
                      f"{entry.get('name', '')}", font=font(11), fill=ink)
            draw.text((x + 22 * S, cursor + 14 * S), colour.upper(),
                      font=font(10.5, "Light"), fill=muted)
            cursor += 30 * S

        # Contrast: the number is computed, never copied.
        ratio = contrast("#FFFFFF", accent_hex)
        if ratio >= 4.5:
            verdict, colour = "AA body text", ok
        elif ratio >= 3:
            verdict, colour = "large text only", warn
        else:
            verdict, colour = "below floor", bad
            failures.append((label, ratio))
        draw.text((x, cursor + 2 * S), f"White on primary {ratio:.1f}:1",
                  font=font(11, "SemiBold"), fill=ink)
        draw.text((x + 132 * S, cursor + 2 * S), verdict, font=font(11, "SemiBold"), fill=colour)
        cursor += 26 * S

        description = match_format(label, formats)
        if description:
            face = font(11.5, "Light")
            for line in wrap(description, face, int(panel_w))[:5]:
                draw.text((x, cursor), line, font=face, fill=muted)
                cursor += 15 * S


    # Shared-system band: the claim "one design system" is only worth making if
    # the data supports it, so these three are computed from the palettes and
    # type lists rather than asserted.
    palettes = [b.get("palette") or [] for b in brands]
    shared_colours = None
    for entries in palettes:
        pairs = {(str(c.get("name", "")).lower(), str(c.get("hex", "")).lower()) for c in entries}
        shared_colours = pairs if shared_colours is None else (shared_colours & pairs)
    shared = sorted(shared_colours or [])
    families: dict[str, set[str]] = {}
    for brand in brands:
        for family in ((brand.get("typography") or {}).get("families") or []):
            base = str(family).split()[0] if str(family).strip() else ""
            if base:
                families.setdefault(base, set()).add(brand["id"])
    everything = set(families)
    shared_families = {name for name, owners in families.items() if len(owners) == len(brands)}
    extra_families = sorted(everything - shared_families)
    primaries = [((b.get("palette") or [{}])[0]).get("name", "") for b in brands]

    grey = next((pair for pair in shared if "grey" in pair[0]), None)
    others = [pair for pair in shared if pair != grey]
    colour_names = ([f"{grey[0].title()} {grey[1].upper()}"] if grey else []) + \
                   [f"{name.title()} {hexv.upper()}" for name, hexv in others]

    band_top = 762 * S
    draw.line([margin, band_top - 26 * S, W - margin, band_top - 26 * S],
              fill=hex_rgb(hair), width=1)
    shared_name = ", ".join(sorted(shared_families)) or "—"
    names = {b["id"]: b.get("name", b["id"]) for b in brands}
    extra_notes = []
    for family in extra_families:
        owners = [names.get(owner, owner) for owner in sorted(families[family])]
        extra_notes.append(f"{family} is used only at {', '.join(owners)}.")
    extra_note = (" " + " ".join(extra_notes)) if extra_notes else ""
    columns = [
        (f"{len(shared_families)} shared typeface" if len(shared_families) == 1
         else f"{len(shared_families)} shared typefaces",
         f"{shared_name} in every venue.{extra_note}"),
        (f"{len(shared)} shared colour" if len(shared) == 1 else f"{len(shared)} shared colours",
         f"{', '.join(colour_names)}. Grey is the one that reads as identity."),
        (f"{len(primaries)} primaries",
         f"{', '.join(primaries)}. Each venue changes its primary; the system holds."),
    ]
    col_w = (W - 2 * margin) / len(columns)
    for index, (big, small) in enumerate(columns):
        x = margin + index * col_w
        draw.text((x, band_top), big, font=font(24, "SemiBold"), fill=ink)
        face = font(12, "Light")
        cursor = band_top + 34 * S
        for line in wrap(small, face, int(col_w - 28 * S))[:3]:
            draw.text((x, cursor), line, font=face, fill=muted)
            cursor += 16 * S

    # Footer: what the map proves, then what it flags.
    foot = H - 104 * S
    draw.line([margin, foot - 18 * S, W - margin, foot - 18 * S], fill=hex_rgb(hair), width=1)
    draw.text((margin, foot), "The wordmarks are drawn in one geometric sans family.",
              font=font(12.5, "Regular"), fill=ink)

    if failures:
        names = ", ".join(f"{name} ({ratio:.1f}:1)" for name, ratio in failures)
        draw.text((margin, foot + 22 * S),
                  f"{names} pair white with their primary below the 3:1 large-text floor — "
                  "resolve the approved lockup before print.",
                  font=font(12.5, "Regular"), fill=bad)

    provenance = args.provenance or (
        "Prepared from publicly available business information and the venue brand "
        "guides. Provenance: extracted, not a client-supplied brand archive."
    )
    draw.text((margin, foot + 44 * S), provenance, font=font(11, "Light"), fill=muted)

    out = pathlib.Path(args.out)
    if not out.is_absolute():
        out = ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)
    image.resize((args.width, args.height), Image.LANCZOS).save(out, "PNG", optimize=True)
    print(f"wrote {out.relative_to(ROOT)} · {args.width}x{args.height} · "
          f"{len(brands)} venues · {len(failures)} contrast failure(s)")
    for name, ratio in failures:
        print(f"  below floor: {name} {ratio:.2f}:1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
