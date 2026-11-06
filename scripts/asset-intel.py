#!/usr/bin/env python3
"""
asset-intel.py — optional Pillow sidecar for Business Asset Intelligence.

Commands (stdout is one JSON object; logs stay on stderr):

  status
  inspect   <path>
  operate   --op resize|crop|recolour --input <path> --output <path> [--params JSON]
  extract   <path>

Missing Pillow / pdftotext / tesseract degrade with a reason; they never make
an ingest fail. The Node side treats this process as optional.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from xml.etree import ElementTree as ET

try:
    from PIL import Image, ImageOps, ImageStat
    HAVE_PIL = True
except Exception:
    HAVE_PIL = False

MAX_PIXELS = 80_000_000
THUMB_EDGE = 320
PHASH_HEX = 16


def emit(payload: dict, code: int = 0) -> int:
    print(json.dumps(payload, ensure_ascii=False))
    return code


def fail(message: str, code: int = 1) -> int:
    return emit({"ok": False, "error": str(message)}, code)


def dhash(image: "Image.Image") -> str:
    gray = image.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    bits = 0
    for y in range(8):
        for x in range(8):
            bits <<= 1
            if gray.getpixel((x, y)) > gray.getpixel((x + 1, y)):
                bits |= 1
    return f"{bits:016x}"


def dominant_palette(image: "Image.Image", count: int = 5) -> list[str]:
    sample = image.convert("RGB")
    sample.thumbnail((256, 256))
    quant = sample.quantize(colors=max(2, count), method=Image.Quantize.MEDIANCUT)
    palette = quant.getpalette() or []
    colors = quant.getcolors() or []
    colors.sort(key=lambda entry: entry[0], reverse=True)
    out = []
    for _n, index in colors[:count]:
        base = index * 3
        if base + 2 >= len(palette):
            continue
        out.append("#{:02x}{:02x}{:02x}".format(*palette[base:base + 3]))
    return out


def inspect(path: str) -> dict:
    if not HAVE_PIL:
        return {"ok": False, "error": "Pillow is not installed"}
    if not os.path.isfile(path):
        return {"ok": False, "error": "File not found"}
    size = os.path.getsize(path)
    with Image.open(path) as image:
        width, height = image.size
        if width * height > MAX_PIXELS:
            return {"ok": False, "error": f"Image too large ({width}x{height})"}
        image.load()
        alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
        palette = dominant_palette(image)
        thumb = image.copy()
        thumb.thumbnail((THUMB_EDGE, THUMB_EDGE))
        if thumb.mode not in ("RGB", "RGBA"):
            thumb = thumb.convert("RGBA" if alpha else "RGB")
        buffer = io.BytesIO()
        thumb.save(buffer, format="WEBP", quality=82, method=4)
        exif_date = None
        try:
            exif = image.getexif()
            value = exif.get(36867) or exif.get(306)
            if value:
                exif_date = str(value)
        except Exception:
            pass
        return {
            "ok": True,
            "pHash": dhash(image),
            "palette": palette,
            "alpha": bool(alpha),
            "width": width,
            "height": height,
            "format": (image.format or "").lower(),
            "bytes": size,
            "exif": {"capturedAt": exif_date} if exif_date else {},
            "thumbnail": base64.b64encode(buffer.getvalue()).decode("ascii"),
        }


def operate(op: str, input_path: str, output_path: str, params: dict) -> dict:
    if not HAVE_PIL:
        return {"ok": False, "error": "Pillow is not installed"}
    with Image.open(input_path) as image:
        image.load()
        if op == "resize":
            width = int(params.get("width") or 0)
            height = int(params.get("height") or 0)
            if width <= 0 and height <= 0:
                return {"ok": False, "error": "resize needs width or height"}
            if width <= 0:
                width = round(image.width * height / image.height)
            if height <= 0:
                height = round(image.height * width / image.width)
            width = max(1, min(12000, width))
            height = max(1, min(12000, height))
            result = image.resize((width, height), Image.Resampling.LANCZOS)
        elif op == "crop":
            ratio = params.get("ratio")
            if ratio:
                try:
                    rw, rh = [float(part) for part in str(ratio).split(":")]
                    target = rw / rh
                except Exception:
                    return {"ok": False, "error": "crop ratio must be W:H"}
            else:
                target = float(params.get("aspect") or 1)
            current = image.width / image.height
            if current > target:
                width = round(image.height * target)
                left = round((image.width - width) * float(params.get("x", 0.5)))
                box = (max(0, left), 0, min(image.width, left + width), image.height)
            else:
                height = round(image.width / target)
                top = round((image.height - height) * float(params.get("y", 0.5)))
                box = (0, max(0, top), image.width, min(image.height, top + height))
            result = image.crop(box)
        elif op == "recolour":
            colour = params.get("color") or params.get("colour")
            match = re.match(r"^#?([0-9a-f]{6})$", str(colour or ""), re.I)
            if not match:
                return {"ok": False, "error": "recolour needs a #rrggbb colour"}
            rgb = tuple(int(match.group(1)[i:i + 2], 16) for i in (0, 2, 4))
            base = image.convert("RGBA")
            gray = ImageOps.grayscale(base)
            result = Image.new("RGBA", base.size, rgb + (255,))
            result.putalpha(gray.point(lambda value: value))
        else:
            return {"ok": False, "error": f"unsupported operation {op}"}

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        fmt = (os.path.splitext(output_path)[1].lstrip(".") or "png").upper()
        if fmt == "JPG":
            fmt = "JPEG"
        result.save(output_path, format=fmt, quality=90)
        return {
            "ok": True,
            "path": output_path,
            "width": result.width,
            "height": result.height,
            "format": fmt.lower(),
            "bytes": os.path.getsize(output_path),
        }


def docx_text(path: str) -> str:
    try:
        with zipfile.ZipFile(path) as archive:
            raw = archive.read("word/document.xml")
        root = ET.fromstring(raw)
        chunks = [node.text or "" for node in root.iter() if node.tag.endswith("}t")]
        return "\n".join(chunks)
    except Exception:
        return ""


def pdf_text(path: str) -> str:
    if not shutil.which("pdftotext"):
        return ""
    try:
        result = subprocess.run(["pdftotext", "-layout", path, "-"],
                                capture_output=True, text=True, timeout=30)
        return result.stdout if result.returncode == 0 else ""
    except Exception:
        return ""


def extract(path: str) -> dict:
    ext = os.path.splitext(path)[1].lower()
    text = ""
    method = "none"
    warnings = []
    if ext == ".docx":
        text = docx_text(path)
        method = "docx"
    elif ext == ".pdf":
        text = pdf_text(path)
        method = "pdftotext" if text else "none"
        if not text:
            warnings.append("pdftotext is unavailable or this PDF has no text layer")
    elif HAVE_PIL:
        if shutil.which("tesseract"):
            try:
                result = subprocess.run(["tesseract", path, "stdout", "--psm", "6"],
                                        capture_output=True, text=True, timeout=45)
                if result.returncode == 0:
                    text = result.stdout
                    method = "tesseract"
                else:
                    warnings.append("tesseract failed on this image")
            except Exception as exc:
                warnings.append(f"OCR failed: {exc}")
        else:
            warnings.append("tesseract is not installed; add it or use a text PDF/DOCX")
    rows = []
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if not line or len(line) > 140:
            continue
        match = re.search(r"[£$€]\s*\d{1,4}(?:[.,]\d{1,2})?", line)
        if match:
            name = line[:match.start()].strip(" .-—:|")
            if name:
                rows.append(f"{name} | | {match.group(0).replace(' ', '')}")
        elif len(line) <= 80 and line.isupper():
            rows.append(f"# {line}")
    return {"ok": True, "method": method, "text": text[:20000],
            "rows": rows[:200], "warnings": warnings}


def main(argv=None):
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    one = sub.add_parser("inspect")
    one.add_argument("path")
    op = sub.add_parser("operate")
    op.add_argument("--op", required=True)
    op.add_argument("--input", required=True)
    op.add_argument("--output", required=True)
    op.add_argument("--params", default="{}")
    ex = sub.add_parser("extract")
    ex.add_argument("path")
    args = parser.parse_args(argv)

    if args.command == "status":
        return emit({
            "ok": True,
            "pillow": HAVE_PIL,
            "ocr": bool(shutil.which("tesseract")),
            "pdftotext": bool(shutil.which("pdftotext")),
            "version": getattr(Image, "__version__", None) if HAVE_PIL else None,
        })
    try:
        if args.command == "inspect":
            return emit(inspect(args.path))
        if args.command == "operate":
            return emit(operate(args.op, args.input, args.output, json.loads(args.params or "{}")))
        if args.command == "extract":
            return emit(extract(args.path))
    except Exception as exc:
        return fail(exc)
    return fail("unknown command")


if __name__ == "__main__":
    sys.exit(main())
