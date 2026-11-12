'use strict';
/* project-manifest.js
 * Turns a project's master composition JSON (+ optional segmentation index) into:
 *   1. a manifest (entities, groups, sources, windows, events)   -> build()
 *   2. a compact agent context string, always in the prompt       -> context()
 *   3. query functions the agent calls on demand                  -> find(), at(), keyframes()
 *   4. start modes: original / blank                              -> start()
 * Nothing here knows about a specific project: every name, label, colour word and time comes
 * from the files. Runs unchanged in the browser (window.ProjectManifest) and under Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProjectManifest = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const r2 = n => Math.round(n * 100) / 100;
  const stem = w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
  const slug = value => String(value || 'group').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'group';
  const tok = s => String(s || '').toLowerCase().split(/[^a-z0-9£%]+/).filter(w => w.length > 1).map(stem);
  const kf = l => (l.keyframes || []).slice().sort((a, b) => a.time - b.time);
  const sec = ms => r2(ms / 1000) + 's';
  const live = (l, dur) => windows(kf(l), dur);
  const MAX_EVENT_LINES = 140;

  // intervals (ms) where the layer is visible, from opacity keyframes
  function windows(k, dur) {
    if (!k.length) return [[0, dur]];
    const out = []; let s = null;
    for (const f of k) {
      if (f.opacity > 0 && s === null) s = f.time;
      if (f.opacity <= 0 && s !== null) { out.push([s, f.time]); s = null; }
    }
    if (s !== null) out.push([s, dur]);
    return out;
  }

  // per-layer changes, only while visible
  function layerEvents(k) {
    const ev = [];
    for (let i = 1; i < k.length; i++) {
      const a = k[i - 1], b = k[i];
      if (a.opacity <= 0 && b.opacity > 0) ev.push({ t: b.time, kind: 'appears' });
      else if (a.opacity > 0 && b.opacity <= 0) ev.push({ t: b.time, kind: 'disappears' });
      if (a.opacity > 0 || b.opacity > 0) {
        const dx = r2(b.x - a.x), dy = r2(b.y - a.y), dw = r2(b.w - a.w);
        if (Math.abs(dx) > .01 || Math.abs(dy) > .01) ev.push({ t: a.time, t2: b.time, kind: 'moves', dx, dy });
        if (Math.abs(dw) > .01) ev.push({ t: a.time, t2: b.time, kind: 'resizes', dw });
      }
    }
    return ev;
  }

  // Text sizes in HTML-imported projects are measured against the canvas width;
  // compositions authored in the studio measure them against the height. Infer the
  // basis from the measured boxes so one page renders both without project-specific code.
  function detectTextBasis(comp) {
    let width = 0, height = 0;
    for (const l of comp.layers) {
      if (l.type !== 'text' || !l.font || !(Number(l.font.sizePct) > 0) || !(Number(l.h) > 0)) continue;
      const boxH = Number(l.h) / 100 * comp.height;
      const sizePct = Number(l.font.sizePct);
      const ratio = Number(l.font.lineHeight) > 0 ? Number(l.font.lineHeight) : 1.2;
      const predictedWidth = sizePct / 100 * comp.width * ratio;
      const predictedHeight = sizePct / 100 * comp.height * ratio;
      const errorWidth = Math.abs(boxH - predictedWidth) / Math.max(boxH, predictedWidth);
      const errorHeight = Math.abs(boxH - predictedHeight) / Math.max(boxH, predictedHeight);
      if (Math.abs(errorWidth - errorHeight) < .02) continue; // too close to vote
      if (errorWidth < errorHeight) width += 1; else height += 1;
    }
    if (!width && !height) return 'height';
    return width >= height ? 'width' : 'height';
  }

  function build(comp, index) {
    const dur = comp.duration, ents = [], groups = new Map(), parents = new Map(), evMap = new Map();
    const idxParents = new Map(((index && index.parents) || []).map(p => [p.parentLayerId, p]));
    const textBasis = detectTextBasis(comp);

    for (const l of comp.layers) {
      const sg = (l.meta || {}).segmentation || {}, k = kf(l);
      const e = {
        id: l.id, name: l.name, type: l.type, parent: l.parentId || null, groupId: l.groupId || null,
        group: l.segmentGroup || null, label: sg.objectLabel || l.name, desc: sg.objectDescription || '',
        text: l.text || null, color: l.color || null, font: l.font ? `${l.font.family} ${l.font.sizePct}%` : null,
        box: { x: r2(l.x), y: r2(l.y), w: r2(l.w), h: r2(l.h) }, z: l.z, url: l.url || null,
        live: windows(k, dur), keyframes: k.length, segmented: !!sg.parentLayerId
      };
      ents.push(e);
      if (e.parent) {
        const p = parents.get(e.parent) || {
          id: e.parent, name: sg.parentName, scene: sg.sceneDescription, style: sg.sceneStyle,
          source: sg.sourceImage, size: [sg.sourceWidth, sg.sourceHeight], children: []
        };
        p.children.push(e.id); parents.set(e.parent, p);
        const g = groups.get(e.groupId) || { id: e.groupId, label: e.group, parent: e.parent, members: [] };
        g.members.push(e.id); groups.set(e.groupId, g);
      } else if (e.group) {
        // A flat extracted project has no parented image source, but it does
        // carry a semantic group on every layer. Keep those groups so the panel,
        // selection and agent can work with "Wall Art", "Props", etc.
        const gid = e.groupId || `group:${slug(e.group)}`;
        const g = groups.get(gid) || { id: gid, label: e.group, parent: null, members: [] };
        g.members.push(e.id); groups.set(gid, g);
        e.groupId = gid;
      }
      // events, clustered by (subject, time window) so 13 limbs moving together = one event
      const subj = e.parent ? (parents.get(e.parent).name || e.parent) : (e.group || e.name);
      for (const v of layerEvents(k)) {
        const key = [e.parent || e.id, v.kind === 'appears' || v.kind === 'disappears' ? v.kind : 'change', v.t, v.t2].join('|');
        let c = evMap.get(key);
        if (!c) {
          c = { t: v.t, t2: v.t2, kind: v.kind, subject: subj, ids: [] };
          evMap.set(key, c);
        } else if (v.kind === 'moves') {
          c.kind = 'moves';
        }
        if (v.dx !== undefined && c.dx === undefined) { c.dx = v.dx; c.dy = v.dy; }
        if (v.dw !== undefined && c.dw === undefined) c.dw = v.dw;
        if (!c.ids.includes(e.id)) c.ids.push(e.id);
      }
    }
    const byId = new Map(ents.map(e => [e.id, e]));
    for (const g of groups.values()) { // union box + window per group
      const m = g.members.map(i => byId.get(i)), x0 = Math.min(...m.map(e => e.box.x)), y0 = Math.min(...m.map(e => e.box.y));
      g.box = { x: r2(x0), y: r2(y0), w: r2(Math.max(...m.map(e => e.box.x + e.box.w)) - x0), h: r2(Math.max(...m.map(e => e.box.y + e.box.h)) - y0) };
      const w = m.flatMap(e => e.live); g.live = w.length ? [[Math.min(...w.map(a => a[0])), Math.max(...w.map(a => a[1]))]] : [];
    }
    const events = [...evMap.values()].sort((a, b) => a.t - b.t || (a.t2 || 0) - (b.t2 || 0));
    const notes = []; // generic observations the agent needs to plan honestly
    if (ents.some(e => e.segmented)) notes.push('Segmented children inherit their parent image keyframes: moving a whole subject means writing the same transform to every member (or adding a group node).');
    const flat = ents.filter(e => e.type === 'image' && !e.segmented && !e.groupId);
    if (flat.length) notes.push('Not segmented (single image): ' + flat.map(e => e.name + ' ' + e.id).join(', ') + '.');
    const flatGroups = [...groups.values()].filter(g => !g.parent);
    if (flatGroups.length) notes.push(`Flat semantic groups from the layer labels: ${flatGroups.map(g => `${g.label} (${g.members.length})`).join(', ')}.`);
    if (comp.meta && comp.meta.sourceVideo) {
      notes.push(`Source recording: ${comp.meta.sourceVideo}. The editable layers are a still reconstruction; play the recording for the original motion.`);
    } else if (!ents.some(e => e.type === 'image' && /video|gif|sprite/.test(e.url || ''))) {
      notes.push('No video or sprite frames in the project: new characters/effects must be generated and added as new layers.');
    }
    notes.push(...stackingNotes(ents, parents));
    return {
      id: comp.id, name: comp.name, canvas: { w: comp.width, h: comp.height }, durationMs: dur,
      textBasis, parents: [...parents.values()].map(p => ({ ...p, scene: p.scene || (idxParents.get(p.id) || {}).description })),
      groups: [...groups.values()], entities: ents, events, notes, _by: byId
    };
  }

  // A cut-out project can carry its "background" parts above the subject. That is
  // harmless while they are transparent, but a white block would cover the art.
  function stackingNotes(ents, parents) {
    const notes = [];
    for (const [parentId, parent] of parents) {
      const members = ents.filter(e => e.parent === parentId);
      const background = members.filter(e => /\b(background|unassigned)\b/i.test(`${e.label} ${e.group || ''}`));
      const subject = members.filter(e => !background.includes(e));
      if (!background.length || !subject.length) continue;
      const bgZ = Math.max(...background.map(e => Number(e.z) || 0));
      const below = subject.filter(e => (Number(e.z) || 0) < bgZ);
      if (!below.length) continue;
      const subjectZ = subject.map(e => Number(e.z) || 0);
      notes.push(`In "${parent.name}" ${background.length} background part${background.length === 1 ? '' : 's'} sit above ${below.length} of ${subject.length} subject parts (z ${r2(Math.min(...background.map(e => Number(e.z) || 0)))}-${r2(bgZ)} vs ${r2(Math.min(...subjectZ))}-${r2(Math.max(...subjectZ))}): check that no white block covers the art before animating.`);
    }
    return notes;
  }

  // compact text the agent always carries
  function context(m, { selection = [], mode = 'original' } = {}) {
    const L = [`PROJECT ${m.name} · canvas ${m.canvas.w}x${m.canvas.h} (coords in % of canvas) · ${sec(m.durationMs)} · mode: ${mode}`];
    L.push('IMAGE SOURCES:');
    for (const p of m.parents) L.push(`- ${p.id} "${p.name}" ${p.children.length} parts: ${String(p.scene || '').slice(0, 140)}`);
    L.push('SEMANTIC GROUPS (id | label | parts | box | visible):');
    for (const g of m.groups) L.push(`- ${g.id} | ${g.label} | ${g.members.map(i => m._by.get(i).label).join(', ')} | ${JSON.stringify(g.box)} | ${g.live.map(w => sec(w[0]) + '-' + sec(w[1])).join(',')}`);
    L.push('TEXT LAYERS:');
    for (const e of m.entities.filter(e => e.text)) L.push(`- ${e.id} "${e.text}" ${e.color} ${e.font} ${e.live.map(w => sec(w[0]) + '-' + sec(w[1])).join(',')}`);
    L.push('OTHER LAYERS: ' + m.entities.filter(e => e.type === 'image' && !e.segmented && !e.groupId).map(e => `${e.id} (${e.name})`).join(', '));
    if (m.textBasis) L.push(`TEXT SIZING: font.sizePct is % of the canvas ${m.textBasis} (inferred from the measured text boxes).`);
    L.push(`EVENTS (${mode === 'original' ? 'original animation' : 'cleared — the elements are static assets'}):`);
    const events = mode === 'original' ? m.events : [];
    for (const v of events.slice(0, MAX_EVENT_LINES)) {
      L.push(`- ${sec(v.t)}${v.t2 ? '→' + sec(v.t2) : ''} ${v.subject} ${v.kind}${v.dx !== undefined ? ` dx${v.dx} dy${v.dy}` : ''}${v.dw ? ` dw${v.dw}` : ''}${v.ids.length > 1 ? ` (${v.ids.length} parts)` : ''}`);
    }
    if (events.length > MAX_EVENT_LINES) L.push(`- … ${events.length - MAX_EVENT_LINES} more events (ask for visible_at or get_keyframes)`);
    L.push('NOTES: ' + m.notes.join(' '));
    if (selection.length) L.push('USER SELECTION: ' + resolve(m, selection).map(s => `${s.kind}:${s.label}[${s.ids.length}]`).join(', '));
    return L.join('\n');
  }

  // ids may be entity ids, group ids or parent (image) ids -> expanded entity ids
  function resolve(m, ids) {
    return (Array.isArray(ids) ? ids : []).map(id => {
      const g = m.groups.find(x => x.id === id), p = m.parents.find(x => x.id === id), e = m._by.get(id);
      if (g) return { kind: 'group', label: g.label, ids: g.members };
      if (p) return { kind: 'image', label: p.name, ids: p.children };
      if (e) return { kind: 'part', label: e.label, ids: [e.id] };
      return null;
    }).filter(Boolean);
  }

  // text -> ranked candidates. Fallback for the agent; it can also pass its own reading of the user's words.
  function find(m, query, limit = 6) {
    const docs = [
      ...m.entities.map(e => ({ kind: 'part', id: e.id, label: e.label, core: `${e.label} ${e.name} ${e.text || ''}`, more: `${e.desc} ${e.group || ''}`, w: 1 })),
      ...m.groups.map(g => ({ kind: 'group', id: g.id, label: g.label, core: g.label, more: g.members.map(i => m._by.get(i).label + ' ' + m._by.get(i).desc).join(' '), w: .6 }))
    ];
    docs.forEach(d => { d.C = new Set(tok(d.core)); d.M = new Set(tok(d.more)); });
    const df = {}; docs.forEach(d => new Set([...d.C, ...d.M]).forEach(t => df[t] = (df[t] || 0) + 1));
    const idf = t => Math.log(1 + docs.length / (df[t] || docs.length));       // common words in this project count less
    const T = tok(query);
    return docs.map(d => ({ kind: d.kind, id: d.id, label: d.label, s: d.w * T.reduce((a, t) => a + idf(t) * (d.C.has(t) ? 2 : d.M.has(t) ? 1 : 0), 0) }))
      .filter(h => h.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map(h => ({ ...h, s: r2(h.s) }));
  }

  const at = (m, ms) => m.entities.filter(e => e.live.some(w => ms >= w[0] && ms <= w[1])).map(e => ({ id: e.id, label: e.label }));
  const keyframes = (comp, id) => (comp.layers.find(l => l.id === id) || {}).keyframes || [];

  function summary(m) {
    return {
      id: m.id, name: m.name, canvas: m.canvas, durationMs: m.durationMs, textBasis: m.textBasis,
      layers: m.entities.length, sources: m.parents.length, groups: m.groups.length,
      texts: m.entities.filter(e => e.text).length,
      segmented: m.entities.filter(e => e.segmented).length,
      unsegmented: m.entities.filter(e => e.type === 'image' && !e.segmented && !e.groupId).length,
      events: m.events.length, notes: m.notes.length
    };
  }

  // original = keep keyframes; blank = every element kept as an asset at its first visible pose, no animation
  function start(comp, mode) {
    const c = JSON.parse(JSON.stringify(comp));
    if (mode === 'blank') for (const l of c.layers) {
      const k = kf(l), base = k.find(f => f.opacity > 0) || k[0] || l;
      l.keyframes = [{ time: 0, x: base.x, y: base.y, w: base.w, h: base.h, rotation: 0, opacity: 1, easing: 'linear' }];
    }
    c.id = comp.id + '--' + mode; return c; // always a new variant, the master is never overwritten
  }

  // tool schema the agent can call (query side of the hybrid)
  const TOOLS = [
    { name: 'find_elements', description: 'Rank project elements/groups matching words the user used to describe something.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'get_keyframes', description: 'Exact keyframes of one layer id.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'visible_at', description: 'Layers visible at a time in ms.', input_schema: { type: 'object', properties: { ms: { type: 'number' } }, required: ['ms'] } },
    { name: 'apply_timeline', description: 'Write keyframes to the new variant: [{ids:[...], keyframes:[{time,x,y,w,h,rotation,opacity,easing}]}]. Use group/image ids to target all members.', input_schema: { type: 'object', properties: { edits: { type: 'array' } }, required: ['edits'] } }
  ];

  return { build, context, resolve, find, at, keyframes, summary, start, windows, detectTextBasis, TOOLS };
}));
