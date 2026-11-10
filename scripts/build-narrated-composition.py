#!/usr/bin/env python3
"""
build-narrated-composition.py — put a spoken narration on an HTML stage and
re-time the stage's bubble sections so the words and the cards agree.

Why this lives at the deck level: the composition shown by the Agent Studio
(`butterfly-the-pig---cinematic-03`) is a recording of a CSS/JS deck. Its cards
are driven by `data-s` / `data-e` seconds on `.sc` elements. Stretching the 66
extracted layer keyframes by hand would never match those cards, and the
extracted text already drops lines in the Layer Studio. Retiming the deck and
recording it again keeps the composition and the motion identical by
construction — the same policy the library already uses for HTML stage reels.

Usage
  python3 scripts/build-narrated-composition.py \
    deliverables/butterfly-cinematic-03-narrated/narration-source.json

Outputs (next to the config)
  narration-timeline.json       the sync contract: every line, start, bubble window
  narration/lines/*.wav         trimmed, level-matched line clips
  narration/narration-mix.wav   one track: lines at their timeline positions
  narration/captions.srt        captions for the same windows
  stage/*.html                  the narrated deck (audio + transport, retimed cards)

Recording and muxing are separate: scripts/capture-dom-stages.js records the
deck (it understands `audio` in its manifest) and ffmpeg muxes the same mix.
"""
from __future__ import annotations

import json
import math
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(args: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs)


def probe_duration(path: Path) -> float:
    out = run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", str(path),
    ]).stdout.strip()
    return float(out)


def loudness(path: Path) -> tuple[float, float]:
    """Integrated LUFS and true peak of a file, measured by ffmpeg's loudnorm."""
    proc = subprocess.run([
        "ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
        "-af", "loudnorm=print_format=json", "-f", "null", "-",
    ], capture_output=True, text=True)
    match = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", proc.stderr, re.S)
    if not match:
        raise RuntimeError(f"Could not measure loudness of {path}")
    data = json.loads(match.group(0))
    return float(data["input_i"]), float(data["input_tp"])


def slug(text: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return text[:48] or "line"


def frames(seconds: float, fps: int) -> int:
    return int(round(seconds * fps))


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: build-narrated-composition.py <narration-source.json>", file=sys.stderr)
        return 2
    config_path = Path(sys.argv[1]).resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    base = config_path.parent
    notes = config.get("notes", "")

    fps = int(config.get("fps", 25))
    audio = config["audio"]
    layout = config["layout"]
    sr = int(audio["sampleRate"])
    pre_ms = int(round(float(audio["pre"]) * 1000))
    post_ms = int(round(float(audio["post"]) * 1000))
    lead_ms = int(round(float(layout["lead"]) * 1000))
    hold_ms = int(round(float(layout["hold"]) * 1000))
    gap_ms = int(round(float(layout["gap"]) * 1000))
    intro_ms = int(round(float(layout["intro"]) * 1000))
    outro_ms = int(round(float(layout["outroHold"]) * 1000))
    fade_ms = int(round(float(layout["fade"]) * 1000))

    lines_dir = base / "narration" / "lines"
    lines_dir.mkdir(parents=True, exist_ok=True)

    # ── 1. Trim each clip to its measured speech, then level-match it. ─────
    prepared = []
    for line in config["lines"]:
        source = (base / line["source"]).resolve()
        if not source.exists():
            source = (ROOT / line["source"]).resolve()
        if not source.exists():
            raise SystemExit(f"missing narration clip: {source}")
        trim_start = max(0.0, float(line["speechStart"]) - pre_ms / 1000)
        trim_end = min(probe_duration(source), float(line["speechEnd"]) + post_ms / 1000)
        name = f"{int(line['index']):02d}-{slug(line['speaker'])}-{slug(line['text'])[:34]}.wav"
        raw = lines_dir / f".{name}.raw.wav"
        run([
            "ffmpeg", "-y", "-v", "error", "-i", str(source),
            "-af", f"atrim=start={trim_start:.6f}:end={trim_end:.6f},asetpts=PTS-STARTPTS",
            "-ar", str(sr), "-ac", "1", "-c:a", "pcm_s16le", str(raw),
        ])
        integrated, peak = loudness(raw)
        # Level-match the lines on their own (mono) so no speaker is buried.
        # A short limiter catches the TTS plosives instead of throwing away
        # 3 dB of gain on a true-peak cap.
        gain = round(float(audio["lineLufs"]) - integrated, 1)
        out = lines_dir / name
        run([
            "ffmpeg", "-y", "-v", "error", "-i", str(raw),
            "-af", f"volume={gain}dB,alimiter=limit=0.891:attack=2:release=80:level=false",
            "-ar", str(sr), "-ac", "1", "-c:a", "pcm_s16le", str(out),
        ])
        raw.unlink(missing_ok=True)
        after_integrated, after_peak = loudness(out)
        prepared.append({
            "index": int(line["index"]),
            "speaker": line["speaker"],
            "text": line["text"],
            "source": line["source"],
            "clip": str(out.relative_to(base)),
            "clipDurationMs": int(round(probe_duration(out) * 1000)),
            "trim": {"start": round(trim_start, 3), "end": round(trim_end, 3)},
            "gainDb": gain,
            "lufs": round(after_integrated, 1),
            "truePeak": round(after_peak, 1),
        })

    # ── 2. Lay the lines out and derive the bubble windows. ───────────────
    bubbles = prepared[:6]
    outro = prepared[6]
    cursor = intro_ms
    for line in bubbles:
        line["startMs"] = cursor
        voice_end = cursor + line["clipDurationMs"] - post_ms
        line["speechStartMs"] = cursor + pre_ms
        line["speechEndMs"] = voice_end
        line["bubble"] = {"startMs": cursor + pre_ms - lead_ms, "endMs": voice_end + hold_ms}
        cursor = voice_end + gap_ms

    fin_start = bubbles[-1]["bubble"]["endMs"] + 450
    outro_start = fin_start + lead_ms - pre_ms
    outro["startMs"] = outro_start
    outro["speechStartMs"] = outro_start + pre_ms
    outro["speechEndMs"] = outro_start + outro["clipDurationMs"] - post_ms
    raw_total = outro["speechEndMs"] + outro_ms
    total_ms = int(math.ceil(raw_total / (1000 / fps)) * (1000 / fps))
    fin_end = total_ms
    outro["bubble"] = {"startMs": fin_start, "endMs": fin_end}

    if outro["startMs"] < fin_start:
        raise SystemExit("outro line starts before its card — widen the outro lead")

    # ── 3. Mix: every line at its own position, padded to the exact end. ──
    mix = base / "narration" / "narration-mix.wav"
    raw_mix = base / "narration" / ".narration-mix.raw.wav"
    inputs: list[str] = []
    filters: list[str] = []
    for i, line in enumerate(prepared):
        inputs += ["-i", str((base / line["clip"]).resolve())]
        filters.append(f"[{i}:a]adelay={line['startMs']}|{line['startMs']}[d{i}]")
    labels = "".join(f"[d{i}]" for i in range(len(prepared)))
    graph = (
        ";".join(filters)
        + f";{labels}amix=inputs={len(prepared)}:duration=longest:normalize=0[mixed]"
        + f";[mixed]apad=whole_dur={total_ms / 1000:.3f},atrim=0:{total_ms / 1000:.3f},"
        + f"pan=stereo|c0=c0|c1=c0[out]"
    )
    run([
        "ffmpeg", "-y", "-v", "error", *inputs,
        "-filter_complex", graph, "-map", "[out]",
        "-ar", str(sr), "-c:a", "pcm_s16le", str(raw_mix),
    ])
    raw_lufs, raw_peak = loudness(raw_mix)
    # One static gain for the finished stereo mix (no dynamic pumping), with a
    # limiter for the few plosives that would cross the true-peak ceiling.
    final_gain = round(float(audio["targetLufs"]) - raw_lufs, 1)
    run([
        "ffmpeg", "-y", "-v", "error", "-i", str(raw_mix),
        "-af", f"volume={final_gain}dB,alimiter=limit=0.891:attack=2:release=80:level=false,"
               f"atrim=0:{total_ms / 1000:.3f}",
        "-ar", str(sr), "-ac", str(int(audio["channels"])),
        "-c:a", "pcm_s16le", str(mix),
    ])
    raw_mix.unlink(missing_ok=True)
    mix_duration = int(round(probe_duration(mix) * 1000))
    mix_lufs, mix_peak = loudness(mix)

    # ── 4. Captions for the same speech windows. ──────────────────────────
    def stamp(ms: int) -> str:
        hours, rest = divmod(ms, 3_600_000)
        minutes, rest = divmod(rest, 60_000)
        seconds, millis = divmod(rest, 1000)
        return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"

    srt = []
    for i, line in enumerate(prepared, 1):
        srt.append(f"{i}\n{stamp(line['speechStartMs'])} --> {stamp(line['speechEndMs'])}\n{line['text']}\n")
    (base / "narration" / "captions.srt").write_text("\n".join(srt), encoding="utf-8")

    # ── 5. The sync contract. ─────────────────────────────────────────────
    timeline = {
        "schema": "studio/narration-timeline/1",
        "id": config["id"],
        "designName": config["designName"],
        "sourceDesignId": config.get("sourceDesignId", ""),
        "width": int(config["width"]),
        "height": int(config["height"]),
        "fps": fps,
        "durationMs": total_ms,
        "brand": config["brand"],
        "sourceDeck": config["sourceDeck"],
        "stageId": config["stageId"],
        "notes": notes,
        "layout": {
            "introMs": intro_ms, "leadMs": lead_ms, "holdMs": hold_ms,
            "gapMs": gap_ms, "outroHoldMs": outro_ms, "fadeMs": fade_ms,
            "preMs": pre_ms, "postMs": post_ms,
        },
        "audio": {
            "mix": str(mix.relative_to(base)),
            "sampleRate": sr,
            "channels": int(audio["channels"]),
            "targetLufs": float(audio["targetLufs"]),
            "integratedLufs": round(mix_lufs, 1),
            "truePeakDb": round(mix_peak, 1),
            "durationMs": mix_duration,
        },
        "lines": prepared,
        "fin": {"startMs": fin_start, "endMs": fin_end, "text": "Do join us.", "speaker": "Both"},
        "bubbles": [
            {
                "index": line["index"],
                "speaker": line["speaker"],
                "text": line["text"],
                "startMs": line["bubble"]["startMs"],
                "endMs": line["bubble"]["endMs"],
                "speechStartMs": line["speechStartMs"],
                "speechEndMs": line["speechEndMs"],
            }
            for line in bubbles
        ],
        "builtAt": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc).isoformat(timespec="seconds"),
    }
    (base / "narration-timeline.json").write_text(
        json.dumps(timeline, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # ── 6. Rebuild the deck with the new windows and the mix. ─────────────
    source_deck = ROOT / config["sourceDeck"]
    deck = source_deck.read_text(encoding="utf-8")
    css = "\n".join(re.findall(r"<style>(.*?)</style>", deck, re.S))
    fonts = re.search(r'<link href="https://fonts\.googleapis\.com[^"]+"[^>]*>', deck)
    stage_match = re.search(
        r'<div class="stage[^"]*" id="' + re.escape(config["stageId"]) + r'".*?(?=<div class="ctl">)',
        deck, re.S)
    if not stage_match:
        raise SystemExit("stage not found in the source deck")
    stage = stage_match.group(0)
    stage = re.sub(r"(<div class=\"stage[^\"]*\" id=\"" + re.escape(config["stageId"]) + r"\" data-d=\")[0-9]+",
                   lambda m: m.group(1) + str(total_ms), stage, count=1)

    sc_iter = iter(bubbles)
    def sc_times(match: re.Match) -> str:
        line = next(sc_iter)
        return (f'{match.group(1)}{line["bubble"]["startMs"] / 1000:.3f}'
                f'{match.group(2)}{line["bubble"]["endMs"] / 1000:.3f}{match.group(3)}')
    stage, count = re.subn(
        r'(<div class="t sc" data-s=")[0-9.]+(" data-e=")[0-9.]+(" data-w="[01]">)',
        sc_times, stage)
    if count != len(bubbles):
        raise SystemExit(f"expected {len(bubbles)} bubbles in the deck, found {count}")
    stage = re.sub(r'(<div class="t fin" data-s=")[0-9.]+(")',
                   lambda m: f'{m.group(1)}{fin_start / 1000:.2f}{m.group(2)}', stage, count=1)
    stage = stage.replace(
        '<div class="t kk" data-s=".3" data-e="99">',
        '<div class="t kk" data-s=".3" data-e="99">')
    stage = re.sub(
        r'(<div class="stage[^"]*"[^>]*>)',
        lambda m: m.group(1) + f'\n<audio id="mix" src="../{timeline["audio"]["mix"]}" preload="auto" hidden></audio>',
        stage, count=1)

    bubbles_js = json.dumps([
        {"s": line["bubble"]["startMs"] / 1000, "e": line["bubble"]["endMs"] / 1000, "w": idx % 2}
        for idx, line in enumerate(bubbles)
    ], separators=(",", ":"))
    total_s = total_ms / 1000.0
    fade_s = fade_ms / 1000.0

    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{config['designName']}</title>
{fonts.group(0) if fonts else ''}
<style>
{css}
/* narrated deck shell — deliberately outside the stage so capture is clean */
html,body{{margin:0;background:#0d0b10;color:#efe4d2;font-family:Jost,system-ui,sans-serif}}
body{{min-height:100vh;display:flex;flex-direction:column;align-items:center;gap:14px;padding:18px 16px 26px}}
.shell-head{{width:min(94vw,720px);display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap}}
.shell-head h1{{font-family:Cinzel,Georgia,serif;font-size:15px;letter-spacing:.16em;text-transform:uppercase;margin:0;color:#e6c97a}}
.shell-head p{{margin:0;color:#9c9086;font-size:11.5px;line-height:1.5}}
.stage{{width:min(94vw,calc((100vh - 150px) * 9 / 16));max-height:calc(100vh - 150px);border-radius:10px}}
.transport{{width:min(94vw,calc((100vh - 150px) * 9 / 16));display:grid;grid-template-columns:auto auto 1fr auto;gap:10px;align-items:center}}
.transport button{{background:#2a2731;color:#f3e6d0;border:0;border-radius:7px;padding:8px 11px;font:inherit;font-weight:600;cursor:pointer}}
.transport button:hover{{background:#3a3642}}
.transport button.primary{{background:#8c2f52}}
.transport input[type=range]{{width:100%;accent-color:#e6c97a}}
.transport time{{font-variant-numeric:tabular-nums;font-size:11.5px;color:#b8a590;white-space:nowrap}}
.caption-line{{width:min(94vw,calc((100vh - 150px) * 9 / 16));min-height:18px;color:#cfc0ab;font-size:11.5px;letter-spacing:.02em}}
body.capture{{padding:0;background:#000;display:block}}
body.capture .shell-head,body.capture .transport,body.capture .caption-line{{display:none}}
body.capture .stage{{width:100vw;height:100vh;max-height:none}}
/* The outgoing card clears before the next one opens (a .4 s exit, a .5 s
   entrance) so two different lines are never read on top of each other. */
.stage .t:not(.on){{transition-duration:.4s}}
@media (max-width:720px){{.stage{{width:min(96vw,calc((100vh - 190px) * 9 / 16))}}}}
</style>
</head>
<body>
<header class="shell-head">
  <h1>The Butterfly and the Pig · The Gossip</h1>
  <p>Narrated cut · {total_s:.1f}s · 7 lines · bubble cards timed to the voice</p>
</header>
{stage}
<div class="transport" aria-label="Playback">
  <button type="button" class="primary" id="play">Play</button>
  <button type="button" id="restart" title="Back to the start">Restart</button>
  <input id="seek" type="range" min="0" max="{total_ms}" step="10" value="0" aria-label="Timeline">
  <time id="clock">0:00.0 / {int(total_s // 60)}:{total_s % 60:04.1f}</time>
</div>
<div class="caption-line" id="caption" aria-live="polite"></div>
<script>
const D = {total_ms};
const FADE = {fade_s};
const BUBBLES = {bubbles_js};
const AUDIO = 'mix';
const stage = document.querySelector('.stage');
const mix = document.getElementById(AUDIO);
const cam = stage.querySelector('.cam');
const im = stage.querySelector('.im');
const fade = stage.querySelector('.fade');
const scNodes = [...stage.querySelectorAll('.sc')];
const playBtn = document.getElementById('play');
const clock = document.getElementById('clock');
const seek = document.getElementById('seek');
const caption = document.getElementById('caption');
let state = {{ c: .49, x: 50, y: 68 }};
let lastT = 0, T = 0, playing = false;
/* Recording runs on the wall clock. A headless page has no audio device, so
   media.currentTime advances slower than real time and the picture drifts
   behind a separately muxed track. Interactive playback still follows the
   audio clock, which is what the viewer actually hears. */
let capturing = false, wallStart = 0;

function wAt (t) {{ let w = -1; for (const b of BUBBLES) if (t >= b.s && t < b.e) w = b.w; return w; }}
function stepCam (t) {{
  const w = wAt(t);
  const tg = w < 0 ? .49 : (w === 0 ? .47 : .51);
  if (t < .2) state.c = .49;
  state.c += (tg - state.c) * .06;
  const z = 1 + .12 * (t / (D / 1000));
  const fx = w < 0 ? .49 : (w === 0 ? .425 : .57);
  const sx = 50 + (fx - state.c) * 266.7 * z;
  state.x += (sx - state.x) * .2;
}}
/* The camera in the source deck is damped once per animation frame. Reproduce
   that at a fixed 60 Hz so a seek and a playback reach the same frame. */
function advance (ms, reset) {{
  const t = Math.max(0, Math.min(D, ms)) / 1000;
  if (reset || t + 1e-6 < lastT) {{ state = {{ c: .49, x: 50, y: 68 }}; lastT = 0; }}
  let guard = 0;
  while (lastT + 1 / 60 <= t + 1e-6 && guard++ < 20000) {{ lastT += 1 / 60; stepCam(lastT); }}
  paint(t);
}}
function paint (t) {{
  stage.style.setProperty('--p', Math.min(1, (t * 1000) / D));
  stage.querySelectorAll('[data-s]').forEach(e => {{
    const s = +e.dataset.s, end = e.dataset.e ? +e.dataset.e : 99;
    e.classList.toggle('on', t >= s && t < end);
  }});
  const w = wAt(t);
  const z = 1 + .12 * (t / (D / 1000));
  cam.style.transform = 'scale(' + z + ')';
  im.style.left = (50 - state.c * 266.7) + 'cqw';
  stage.style.setProperty('--sx', w < 0 ? 50 : state.x);
  stage.style.setProperty('--sy', w < 0 ? 66 : 67);
  scNodes.forEach(e => e.style.setProperty('--tx', w < 0 ? 50 : state.x));
  fade.classList.toggle('on', t > D / 1000 - FADE || t < .1);
  const active = BUBBLES.find(b => t >= b.s && t < b.e);
  const line = active ? ({{
    1: 'Lord Pig: Pub quiz on Mondays, my dear. Half past seven.',
    2: 'Lady Pig: Open mic on Tuesdays. Eight-thirty. Do try to sing.',
    3: 'Lord Pig: Jazz on Wednesdays, with guest performers.',
    4: 'Lady Pig: Thursday is Trad, hosted by the students of the RCS.',
    5: 'Lord Pig: Live music Fridays from 7:30, and Saturdays from 6:30.',
    6: 'Lady Pig: And Sunday, darling… the Roast. Till sell out.'
  }})[active.index] : (t >= D / 1000 - 3.3 ? 'Do join us.' : '');
  if (caption) caption.textContent = line || '';
  const shown = Math.max(0, Math.min(D, Math.round(t * 1000)));
  seek.value = shown;
  clock.textContent = fmt(shown) + ' / ' + fmt(D);
}}
function fmt (ms) {{
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + '.' + String(Math.floor(ms / 100) % 10);
}}
function nowMs () {{ return capturing ? performance.now() - wallStart : mix.currentTime * 1000; }}
function loop () {{
  if (!playing) return;
  const t = Math.min(D, nowMs());
  advance(t, false);
  if (mix.ended || t >= D) {{ playing = false; playBtn.textContent = 'Play'; return; }}
  requestAnimationFrame(loop);
}}
function start () {{
  capturing = false; mix.currentTime = 0; advance(0, true); T = 0;
  const p = mix.play();
  playing = true; playBtn.textContent = 'Pause';
  requestAnimationFrame(loop);
  return p;
}}
function toggle () {{
  if (playing) {{ playing = false; mix.pause(); playBtn.textContent = 'Play'; return; }}
  if (mix.currentTime * 1000 >= D - 20) return start();
  playing = true; playBtn.textContent = 'Pause'; mix.play(); requestAnimationFrame(loop);
}}
playBtn.addEventListener('click', () => {{ toggle().catch(err => console.warn(err)); }});
document.getElementById('restart').addEventListener('click', () => {{ start().catch(err => console.warn(err)); }});
seek.addEventListener('input', () => {{
  const ms = Number(seek.value);
  const was = playing; playing = false;
  mix.currentTime = ms / 1000;
  advance(ms, true);
  if (was) {{ playing = true; mix.play(); requestAnimationFrame(loop); }}
}});
mix.addEventListener('ended', () => {{ playing = false; playBtn.textContent = 'Play'; }});
document.addEventListener('keydown', e => {{
  if (e.code === 'Space' && e.target.tagName !== 'INPUT') {{ e.preventDefault(); toggle(); }}
  if (e.code === 'ArrowRight') {{ seek.value = Math.min(D, Number(seek.value) + 250); seek.dispatchEvent(new Event('input')); }}
  if (e.code === 'ArrowLeft') {{ seek.value = Math.max(0, Number(seek.value) - 250); seek.dispatchEvent(new Event('input')); }}
}});
if (new URLSearchParams(location.search).has('capture')) document.body.classList.add('capture');
mix.addEventListener('loadedmetadata', () => advance(0, true));
advance(0, true);

/* Capture hook: the recording starts the audio and the clock at the same
   moment the green marker is removed. Muted so a headless run stays quiet. */
window.__narratedStart = () => {{
  capturing = true; playing = true; mix.pause(); mix.muted = true;
  advance(0, true); wallStart = performance.now();
  playBtn.textContent = 'Play';
  requestAnimationFrame(loop);
  return Promise.resolve();
}};
window.__narratedState = () => ({{
  t: Math.round(nowMs()),
  playing,
  on: [...stage.querySelectorAll('.sc.on')].map(e => e.textContent.trim().slice(0, 40)),
}});
window.__narratedSeek = ms => {{ capturing = false; playing = false; mix.muted = true; mix.currentTime = ms / 1000; advance(ms, true); }};

/* Frame-exact rendering for export. Every frame is computed from its own
   timestamp, so there is no recorder clock to drift. The .t entrance uses the
   same 0.5 s CSS ease as the deck; doing it by hand keeps the transition while
   making a seek reproduce exactly the frame that playback would show. */
function cubicBezier (x1, y1, x2, y2) {{
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = u => ((ax * u + bx) * u + cx) * u;
  const sy = u => ((ay * u + by) * u + cy) * u;
  return x => {{
    let lo = 0, hi = 1, u = x;
    for (let i = 0; i < 12; i += 1) {{
      const v = sx(u);
      if (Math.abs(v - x) < 1e-5) break;
      if (v < x) lo = u; else hi = u;
      u = (lo + hi) / 2;
    }}
    return sy(u);
  }};
}}
const EASE = cubicBezier(.25, .1, .25, 1);
window.__narratedMeta = {{ durationMs: D, fps: {fps} }};
window.__renderAt = ms => {{
  capturing = true; playing = false;
  const t = Math.max(0, Math.min(D, ms)) / 1000;
  advance(t * 1000, true);
  stage.querySelectorAll('.t').forEach(el => {{
    const s = +el.dataset.s, e = el.dataset.e ? +el.dataset.e : 1e9;
    let p = 0;
    if (t >= s && t < e) p = Math.min(1, (t - s) / .5);
    else if (t >= e) p = Math.max(0, 1 - (t - e) / .4);
    const a = EASE(Math.max(0, Math.min(1, p)));
    el.style.transition = 'none';
    el.style.opacity = a.toFixed(4);
    el.style.transform = 'translateY(' + ((1 - a) * 3).toFixed(3) + 'cqw)';
  }});
  const endA = Math.max(0, Math.min(1, (t - (D / 1000 - FADE)) / .4));
  const startA = t <= .1 ? 1 : Math.max(0, 1 - (t - .1) / .4);
  fade.style.transition = 'none';
  fade.style.opacity = Math.max(endA, startA).toFixed(4);
  document.getAnimations().forEach(a => {{
    try {{ a.pause(); a.currentTime = t * 1000; }} catch (e) {{}}
  }});
  return {{ t: Math.round(t * 1000), durationMs: D, fps: {fps} }};
}};
</script>
</body>
</html>
"""
    stage_out = base / "stage" / "cinematic-03-narrated.html"
    stage_out.parent.mkdir(parents=True, exist_ok=True)
    stage_out.write_text(page, encoding="utf-8")

    print(f"lines       {len(prepared)}  ({total_ms / 1000:.2f}s, {frames(total_ms / 1000, fps)} frames @ {fps}fps)")
    for line in prepared:
        print(f"  {line['index']:02d} {line['speaker']:<9} {line['startMs'] / 1000:6.2f}s  "
              f"speech {line['speechStartMs'] / 1000:6.2f}-{line['speechEndMs'] / 1000:6.2f}  "
              f"card {line['bubble']['startMs'] / 1000:6.2f}-{line['bubble']['endMs'] / 1000:6.2f}  "
              f"{line['gainDb']:+.1f} dB ({line['lufs']} LUFS)")
    print(f"mix         {mix_duration} ms  {mix_lufs:.1f} LUFS  peak {mix_peak:.1f} dB  {mix.relative_to(ROOT)}")
    print(f"deck        {stage_out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
