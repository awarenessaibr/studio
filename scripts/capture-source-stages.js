#!/usr/bin/env node
/**
 * Record source-exact original-motion stages.
 *
 *   node scripts/capture-source-stages.js scripts/source-manifests/batch7.json
 *
 * Each manifest item: {file,id,stage,width,height,duration}. The HTML is
 * isolated to the requested stage, animated from t=0, recorded at 25 fps,
 * trimmed of the load-in and stored beside a 50% poster in data/library/sources.
 * Requires Playwright, Chrome and ffmpeg on the host.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  try { ({ chromium } = require('/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright')); }
  catch { throw new Error('Playwright is required (npm i -g playwright or the MCP copy).'); }
}
const ROOT = path.resolve(__dirname, '..');
const manifestFile = path.resolve(process.argv[2] || path.join(__dirname, 'source-manifests', 'batch7.json'));
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const outDir = path.join(ROOT, 'data', 'library', 'sources');
const tmp = path.join('/tmp', `source-capture-${Date.now()}`);
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(tmp, { recursive: true });
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  for (const item of manifest) {
    const file = path.resolve(ROOT, item.file);
    const dir = path.join(tmp, item.id);
    fs.mkdirSync(dir, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: item.width, height: item.height },
      recordVideo: { dir, size: { width: item.width, height: item.height } },
    });
    const page = await context.newPage();
    await page.goto('file://' + encodeURI(file), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const ok = await page.evaluate(({ stage, width, height, selector }) => {
      const el = document.querySelectorAll(selector || '.stage')[stage];
      if (!el) return false;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.innerHTML = '';
      document.body.style.margin = '0';
      document.body.style.background = '#000';
      el.style.position = 'fixed'; el.style.left = '0'; el.style.top = '0';
      el.style.width = width + 'px'; el.style.height = height + 'px';
      el.style.maxWidth = 'none'; el.style.borderRadius = '0'; el.style.boxShadow = 'none';
      document.body.append(el);
      if (typeof o !== 'undefined' && o[el.id] !== undefined) o[el.id] = performance.now();
      else document.getAnimations().forEach((animation) => { try { animation.currentTime = 0; } catch {} });
      el.querySelectorAll('video').forEach((video) => { video.muted = true; video.currentTime = 0; video.play().catch(() => {}); });
      return true;
    }, { stage: item.stage, width: item.width, height: item.height, selector: item.selector });
    if (!ok) { console.warn('skip (stage missing)', item.id); await context.close(); continue; }
    await page.waitForTimeout(item.duration + 350);
    const videoPath = page.video().path();
    await context.close();
    const raw = await videoPath;
    const out = path.join(outDir, `${item.id}.webm`);
    // The context video includes the ~1.8 s load/isolate prefix.
    cp.execFileSync('ffmpeg', ['-y', '-ss', '2.0', '-t', String(item.duration / 1000), '-i', raw,
      '-c:v', 'libvpx-vp9', '-b:v', '5M', '-pix_fmt', 'yuv420p', out], { stdio: 'ignore' });
    cp.execFileSync('ffmpeg', ['-y', '-ss', String(item.duration / 2000), '-i', out, '-frames:v', '1',
      '-q:v', '3', path.join(outDir, `${item.id}.jpg`)], { stdio: 'ignore' });
    console.log('captured', item.id);
  }
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((error) => { console.error(error); process.exitCode = 1; });
