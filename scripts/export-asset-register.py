#!/usr/bin/env python3
"""export-asset-register.py — the asset and provenance register, as a workbook.

Answers the question a provenance register exists to answer: for every file the
studio can put in a design, where did it come from, what rights are recorded,
and who cleared it.

Two sheets plus an audit trail:
    Summary     counts by brand, approval, provenance and rights
    Register    one row per asset, filterable
    Corrections what the pack changed and why

Usage
    python3 scripts/export-asset-register.py --pack <packId> --out <dir>
"""
from __future__ import annotations

import argparse
import csv
import json
import pathlib
import sys
from collections import Counter

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = pathlib.Path(__file__).resolve().parent.parent
PACKS = ROOT / "data" / "brand-packs"
ASSETS = ROOT / "data" / "assets"

HEADER_FILL = PatternFill("solid", fgColor="1F1F1F")
HEADER_FONT = Font(color="FFFFFF", bold=True, size=10)
APPROVED_FILL = PatternFill("solid", fgColor="E8F3EC")
UNKNOWN_FILL = PatternFill("solid", fgColor="FBF1DF")

COLUMNS = [
    ("Brand", 18),
    ("Asset", 30),
    ("Role", 12),
    ("Class", 20),
    ("Provenance", 14),
    ("Confidence", 12),
    ("Rights", 14),
    ("Consent", 14),
    ("Approval", 12),
    ("Approved by", 12),
    ("Approved at", 20),
    ("Dimensions", 14),
    ("KB", 8),
    ("Source path", 46),
]


def read_json(path: pathlib.Path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def collect(pack_id: str):
    pack_dir = PACKS / pack_id
    pack = read_json(pack_dir / "pack.json")
    if not pack:
        raise SystemExit(f"No pack.json in {pack_dir}")
    pack = pack["pack"]
    names = {brand["id"]: brand.get("name", brand["id"]) for brand in pack.get("brands", [])}

    rows = []
    for metadata in sorted(ASSETS.glob("ast_*/metadata.json")):
        record = read_json(metadata)
        if not record or (record.get("binding") or {}).get("packId") != pack_id:
            continue
        brand_id = (record.get("binding") or {}).get("brandId") or ""
        identity = record.get("identity") or {}
        usage = record.get("usage") or {}
        provenance = record.get("provenance") or {}
        review = record.get("review") or {}
        width, height = identity.get("width"), identity.get("height")
        rows.append({
            "Brand": names.get(brand_id, brand_id or "—"),
            "Asset": record.get("name", ""),
            "Role": record.get("role", ""),
            "Class": record.get("class", ""),
            "Provenance": provenance.get("kind", "unknown"),
            "Confidence": provenance.get("confidence", ""),
            "Rights": usage.get("rights", "unknown"),
            "Consent": usage.get("consent", ""),
            "Approval": review.get("state", "proposed"),
            "Approved by": review.get("by", ""),
            "Approved at": (review.get("at") or "")[:19].replace("T", " "),
            "Dimensions": f"{width} × {height}" if width and height else "",
            "KB": round((identity.get("bytes") or 0) / 1024),
            "Source path": (record.get("source") or {}).get("path", ""),
        })
    return pack, rows


def style_header(sheet, columns):
    for index, (label, width) in enumerate(columns, start=1):
        cell = sheet.cell(row=1, column=index, value=label)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(vertical="center")
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.freeze_panes = "A2"
    sheet.row_dimensions[1].height = 20


def build(pack, rows, out: pathlib.Path):
    workbook = Workbook()

    summary = workbook.active
    summary.title = "Summary"
    summary["A1"] = f"{pack['name']} — asset and provenance register"
    summary["A1"].font = Font(bold=True, size=14)
    summary["A2"] = f"{len(rows)} assets · generated from data/assets metadata"
    summary["A2"].font = Font(color="6E6E6E", size=10)

    by_brand = Counter(row["Brand"] for row in rows)
    by_approval = Counter(row["Approval"] for row in rows)
    by_provenance = Counter(row["Provenance"] for row in rows)
    by_rights = Counter(row["Rights"] for row in rows)

    def table(top, title, counts):
        summary.cell(row=top, column=1, value=title).font = Font(bold=True, size=11)
        for offset, (key, count) in enumerate(sorted(counts.items(), key=lambda item: (-item[1], item[0])), start=1):
            summary.cell(row=top + offset, column=1, value=key)
            summary.cell(row=top + offset, column=2, value=count)
        summary.column_dimensions["A"].width = 30
        summary.column_dimensions["B"].width = 12
        return top + len(counts) + 3

    top = table(4, "By brand", by_brand)
    top = table(top, "By approval", by_approval)
    top = table(top, "By provenance", by_provenance)
    top = table(top, "By rights", by_rights)

    summary.cell(row=top, column=1, value="Rule of the register").font = Font(bold=True, size=11)
    summary.cell(row=top + 1, column=1,
                 value="Unknown rights block every export until an asset is approved. Approval is a name, not a checkbox.")
    summary.cell(row=top + 1, column=1).alignment = Alignment(wrap_text=True, vertical="top")
    summary.merge_cells(start_row=top + 1, start_column=1, end_row=top + 1, end_column=6)
    summary.row_dimensions[top + 1].height = 30

    register = workbook.create_sheet("Register")
    style_header(register, COLUMNS)
    for row_index, row in enumerate(rows, start=2):
        for column_index, (label, _) in enumerate(COLUMNS, start=1):
            cell = register.cell(row=row_index, column=column_index, value=row[label])
            if label == "KB" and isinstance(cell.value, int):
                cell.number_format = "#,##0"
            if label in ("Provenance", "Approval", "Rights", "Confidence", "Class", "Role"):
                cell.alignment = Alignment(horizontal="left")
        if row["Approval"] == "approved":
            for column_index in range(1, len(COLUMNS) + 1):
                register.cell(row=row_index, column=column_index).fill = APPROVED_FILL
        if row["Rights"] == "unknown":
            register.cell(row=row_index, column=7).fill = UNKNOWN_FILL
    register.auto_filter.ref = f"A1:{get_column_letter(len(COLUMNS))}{len(rows) + 1}"

    corrections = (pack.get("meta") or {}).get("corrections") or []
    trail = workbook.create_sheet("Corrections")
    style_header(trail, [("Field", 22), ("From", 34), ("To", 34), ("Evidence", 60), ("At", 22)])
    for row_index, entry in enumerate(corrections, start=2):
        values = [entry.get("field", ""), entry.get("from", ""), entry.get("to", ""),
                  entry.get("evidence", ""), (entry.get("at") or "")[:19].replace("T", " ")]
        for column_index, value in enumerate(values, start=1):
            cell = trail.cell(row=row_index, column=column_index, value=value)
            cell.alignment = Alignment(wrap_text=True, vertical="top")

    out.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(out)

    csv_file = out.with_suffix(".csv")
    with open(csv_file, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=[label for label, _ in COLUMNS])
        writer.writeheader()
        writer.writerows(rows)
    return csv_file


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pack", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    pack, rows = collect(args.pack)
    if not rows:
        print("No assets indexed for that pack.", file=sys.stderr)
        return 1
    out = pathlib.Path(args.out)
    if not out.is_absolute():
        out = ROOT / out
    csv_file = build(pack, rows, out)
    print(f"wrote {out.relative_to(ROOT)} · {len(rows)} assets")
    print(f"wrote {csv_file.relative_to(ROOT)}")
    states = Counter(row["Approval"] for row in rows)
    print("  approval:", dict(states))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
