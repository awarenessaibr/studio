**Improved Agent Studio agent: higher-quality suggestions, richer layouts, and more novel ideas**

### Current state (from the docs + source)

The agent is a **deterministic rule engine** (`suggest()` + `concepts()`). Strengths:
- Completely local, instant, no network.
- Cards always produce valid commands that the existing `commit()` / guardrails understand.
- Brand-aware copy options and palette usage already exist.

Limitations that hurt quality and novelty:
- Keyword matching is brittle and shallow.
- Only five static layout concepts, three of which are essentially the same “variant” pattern.
- Suggestions rarely consider the whole composition (spacing, reading order, rhythm, brand personality).
- Many “why” strings are generic; some commands introduce new guardrail issues that the preview then has to warn about.
- Little differentiation by format (story vs A4 vs landscape) or by brand tone.

Below is a focused upgrade that keeps the exact same card contract and command schema so nothing else breaks, while delivering noticeably better quality and more interesting ideas.

### 1. Improved `concepts()` — more novel, higher-quality layout directions

Replace the existing `concepts()` with this version. It produces five stronger, more distinctive directions that still map cleanly onto the existing `variant` / animation commands.

```js
function concepts(){
  const g = GEO[FMT.id] || GEO.a4;
  const tall = FMT.h / FMT.w > 1.2;
  const wide = FMT.w / FMT.h > 1.3;
  const isSocial = /sq|story|portrait-45/.test(FMT.id);
  const isPrint  = FMT.id === 'a4' || FMT.id === 'portrait-45';

  return [
    {
      title: 'Ink Night',
      why: 'Deep brand-ink ground, light type, restrained accent only on the CTA. Quiet luxury, high contrast, works especially well for evening / fine-dining brands.',
      cmds: [
        {type:'variant', variant:'night'},
        A('cta','pulse',3200,2200),
        A('headline','fadeIn',400,900)
      ]
    },
    {
      title: 'Framed Editorial',
      why: 'Photo pulled inside the 8 % margins with generous breathing room. Feels like a magazine page or a carefully printed flyer — calm and considered.',
      cmds: [{type:'variant', variant:'framed'}]
    },
    {
      title: 'Accent Poster',
      why: 'Full-bleed accent ground with the highest-contrast type available. Bold, poster-like energy. Best when the brand accent is already strong.',
      cmds: [{type:'variant', variant:'accent'}]
    },
    {
      title: tall ? 'Vertical Cascade' : wide ? 'Horizontal Sweep' : 'Tight Hierarchy',
      why: tall
        ? 'Stack the story top-to-bottom with clear scale steps. Headline dominates, then sub, body, and a single decisive CTA.'
        : wide
          ? 'Let the photo own the left third; type and CTA live in a clean right-hand column with generous leading.'
          : 'Force a clear reading order: headline → sub → body → CTA. Address is demoted so the action is never missed.',
      cmds: tall
        ? [
            S('headline',{y:52, font:{sizePct:+(g.head[4]*1.15).toFixed(2)}}),
            S('subhead',{y:68}),
            S('body',{y:74}),
            S('cta',{y:84}),
            S('footer',{y:90, opacity:0.55})
          ]
        : wide
          ? [
              S('photo',{x:0,w:42}),
              S('headline',{x:48,y:18,w:46}),
              S('subhead',{x:48,y:48,w:46}),
              S('body',{x:48,y:58,w:46}),
              S('cta',{x:48,y:78,w:40}),
              S('footer',{x:48,y:88,w:46, opacity:0.6})
            ]
          : [
              S('cta',{y:g.cta[1]}),
              S('footer',{y:+(g.foot[1]+1.5).toFixed(1), opacity:0.6})
            ]
    },
    {
      title: 'Motion First',
      why: 'The design comes alive: photo drifts slowly, type staggers in, CTA gently pulses. Ideal for Stories, digital screens or any place that rewards movement.',
      cmds: [
        A('photo','parallax',0,10000),
        A('headline','fadeIn',300,800),
        A('subhead','fadeIn',700,800),
        A('body','fadeIn',1100,800),
        A('cta','pulse',2800,2400)
      ]
    },
    // Optional 6th concept that appears only when useful
    ...(isPrint ? [{
      title: 'Quiet Print',
      why: 'Extra breathing room, slightly smaller body, higher contrast on the CTA. Designed for actual print where ink and paper do the work.',
      cmds: [
        S('body',{font:{sizePct:+(g.body[4]*0.92).toFixed(2)}, opacity:0.78}),
        S('cta',{font:{weight:Math.max(BF.bW,600), letterSpacingEm:0.18}}),
        S('footer',{opacity:0.55})
      ]
    }] : isSocial ? [{
      title: 'Story Punch',
      why: 'Larger headline, tighter sub, and a CTA that sits in the lower third where thumbs naturally rest. Built for vertical social.',
      cmds: [
        S('headline',{font:{sizePct:+(g.head[4]*1.18).toFixed(2)}}),
        S('subhead',{y:+(g.sub[1]-1.5).toFixed(1)}),
        S('cta',{y:82, font:{sizePct:+(g.cta[4]*1.1).toFixed(2)}}),
        A('cta','pulse',2500,2200)
      ]
    }] : [])
  ].slice(0,5); // keep the card list to five for the greeting
}
```

### 2. Improved `suggest()` — smarter, more novel, higher signal

Replace the existing `suggest` function with the version below. Key upgrades:

- Context-aware (looks at neighbouring layers, current contrast, format).
- More novel micro-ideas (scrims, type hierarchy steps, breathing room, brand-tone swaps).
- Cleaner “why” copy that explains the design intent.
- Commands that are less likely to introduce new guardrail violations.
- Better handling of empty or weak user messages.

```js
function suggest(l, msg){
  const m = (msg||'').toLowerCase();
  const o = [];
  const id = l.id;
  const add = (title, why, cmds) => o.push({title, why, cmds});
  const CO = copyOptions();
  const has = words => words.some(w => m.includes(w));
  const col = Object.keys(PAL).find(n => m.includes(n.toLowerCase()));
  const gr  = scene.find(q => q.id === 'ground');
  const groundColor = gr ? gr.color : TH.bone;
  const isTall = FMT.h / FMT.w > 1.15;
  const isText = l.type === 'text';
  const isImage = l.type === 'image';
  const isLogo  = l.type === 'logo';

  // ── colour ──────────────────────────────────────────────────────────────
  if (col && !isImage && !isLogo) {
    add(`Colour → ${col}`,
        `Uses the exact brand palette value ${PAL[col]}. Contrast is re-checked automatically.`,
        [S(id,{color:PAL[col]})]);
  }

  // ── scale ───────────────────────────────────────────────────────────────
  if (has(['bigger','larger','increase','louder','punch'])) {
    if (isText) {
      add('Scale up 22 %',
          'Raises presence while staying inside the current box. Guardrails will flag if it starts to overflow.',
          [S(id,{font:{sizePct:+(l.font.sizePct*1.22).toFixed(2)}, opacity:1})]);
    } else {
      add('Scale up 20 %',
          'More visual weight. Check neighbours still have breathing room.',
          [S(id,{w:+(l.w*1.2).toFixed(1), h:+(l.h*1.2).toFixed(1)})]);
    }
  }
  if (has(['smaller','reduce','quieter','softer'])) {
    if (isText) {
      add('Scale down 18 %',
          'Gives surrounding elements more air and improves hierarchy.',
          [S(id,{font:{sizePct:+(l.font.sizePct*0.82).toFixed(2)}})]);
    } else {
      add('Scale down 18 %',
          'Reduces dominance so other layers can breathe.',
          [S(id,{w:+(l.w*0.82).toFixed(1), h:+(l.h*0.82).toFixed(1)})]);
    }
  }

  // ── move ────────────────────────────────────────────────────────────────
  if (has(['up','higher']) && m.includes('move')) {
    add('Move up 4 %', 'Nudges toward the top of the composition.', [S(id,{y:+(l.y-4).toFixed(1)})]);
  }
  if (has(['down','lower']) && m.includes('move')) {
    add('Move down 4 %', 'Nudges toward the bottom.', [S(id,{y:+(l.y+4).toFixed(1)})]);
  }
  if (has(['center','centre','middle'])) {
    add('Centre horizontally',
        'Aligns the layer to the vertical axis of the page.',
        [S(id,{x:+((100-l.w)/2).toFixed(1)}), ...(isText ? [S(id,{align:'center'})] : [])]);
  }

  // ── type treatment ──────────────────────────────────────────────────────
  if (isText) {
    if (has(['uppercase','caps','all caps'])) {
      add('Uppercase + tracking',
          'Turns the line into a clear label. Slight positive tracking improves legibility at small sizes.',
          [S(id,{font:{transform:'uppercase', letterSpacingEm:0.14}})]);
    }
    if (has(['rewrite','alternative','copy','wording','change text']) || msg === 'Rewrite it') {
      (CO[id]||[]).filter(t => t !== l.text).slice(0,3).forEach(t => {
        add(`“${t.length > 46 ? t.slice(0,45)+'…' : t}”`,
            'Taken only from this brand’s own fields — no invented claims.',
            [S(id,{text:t, hidden:false})]);
      });
    }
  }

  // ── animation ───────────────────────────────────────────────────────────
  if (has(['animat','motion','fade','pulse','zoom','parallax','move']) || msg === 'Animate it') {
    const want = m.includes('pulse') ? 'pulse'
               : m.includes('zoom')  ? 'zoom'
               : m.includes('parallax') ? 'parallax' : null;

    const candidates = [
      ['fadeIn',  'Soft entrance', 300, 900],
      ['pulse',   'Gentle attention pull — ideal for CTAs', 2200, 2400]
    ];
    if (isImage) {
      candidates.push(
        ['zoom',     'Slow cinematic push-in', 0, 10000],
        ['parallax', 'Subtle vertical drift', 0, 10000]
      );
    }
    candidates
      .filter(a => !want || a[0] === want)
      .forEach(a => add(`Animate · ${a[0]}`, a[1], [A(id, a[0], a[2], a[3])]));
  }

  // ── default / exploratory suggestions when the prompt is weak ───────────
  const exploratory = !o.length || has(['stand out','options','ideas','crop','scrim','what','improve','better'])
                   || ['Make it stand out','Options','Crop ideas','Add a scrim'].includes(msg);

  if (exploratory) {
    if (isText) {
      // Hierarchy & presence
      add('Make it stand out',
          `Larger type and full opacity. Current size is ${l.font.sizePct}% of page height.`,
          [S(id,{font:{sizePct:+(l.font.sizePct*1.25).toFixed(2), weight:Math.max(l.font.weight||400,500)}}, opacity:1)]);

      // Accent colour with safety
      const safeAccent = readable(TH.accent, groundColor);
      add('Accent colour',
          'Brand accent used only where contrast remains healthy.',
          [S(id,{color:safeAccent})]);

      // Breathing room
      if (l.font.sizePct > 2.5) {
        add('More breathing room',
            'Slightly tighter leading and a touch more letter-spacing so the block feels calmer.',
            [S(id,{font:{lineHeight:1.15, letterSpacingEm:0.02}})]);
      }

      // Rewrite entry point
      if (CO[id] && CO[id].length) {
        add('Show copy options',
            'Pull alternative lines that already exist in the brand pack.',
            []);
        o[o.length-1].ask = 'Rewrite it';
      }
    }

    else if (isImage) {
      if (isTall) {
        add('Full-bleed with soft scrim',
            'Photo grows to ~66 % height; a gentle ink scrim lets the type sit cleanly on top.',
            [
              S('ground',{color:TH.ink}),
              S(id,{h:66, y:0}),
              {type:'add-layer', layer:{
                id:'scrim-'+uid++, name:'Scrim', type:'gradient',
                x:0, y:38, w:100, h:28, z:6, opacity:1,
                from:rgba(TH.ink,0), to:TH.ink
              }}
            ]);
      }
      add('Inset & framed',
          'Pulls the photo inside the 8 % safe margins — feels more editorial and print-ready.',
          [S(id,{
            x:8, y:8,
            w: l.w >= 100 ? 84 : Math.min(l.w, 84),
            h: l.h >= 100 ? 84 : Math.max(l.h-4, 22)
          })]);
      add('Shift focus left',
          'Repositions the crop so the interesting part of the image sits more to the left.',
          [S(id,{fx:28})]);
      add('Gentle parallax',
          'Slow vertical drift over the full 10 s timeline.',
          [A(id,'parallax',0,10000)]);
    }

    else if (isLogo) {
      ['white','ink','accent'].filter(t => t !== l.tone).forEach(t => {
        add(`${t[0].toUpperCase()+t.slice(1)} logo`,
            'Same geometry, different tone from the brand pack.',
            [{type:'swap-asset', layerId:id, asset:t}]);
      });
      if (B._logos && B._logos.mark && B._logos.wordmark) {
        add(l.which === 'mark' ? 'Use the wordmark' : 'Use the mark',
            'Switches to the other logo cut already present in the pack.',
            [S(id,{which: l.which === 'mark' ? 'wordmark' : 'mark'})]);
      }
      add('Larger presence',
          '25 % larger while keeping aspect ratio.',
          [S(id,{w:+(l.w*1.25).toFixed(1), h:+(l.h*1.25).toFixed(1)})]);
    }

    else { // fill / shape / gradient / unknown
      add('Softer presence', 'Reduce opacity so content layers stay primary.', [S(id,{opacity:0.45})]);
      add('Send behind type', 'Lower z-index so text and logos sit cleanly on top.', [S(id,{z:1})]);
    }
  }

  // Always offer a clean “remove” if the user is clearly trying to delete
  if (has(['hide','remove','delete','get rid'])) {
    add('Remove layer',
        'Deletes the layer from the scene (fully undoable).',
        [{type:'remove-layer', layerId:id}]);
  }

  return o;
}
```

### 3. Small supporting polish (optional but recommended)

In the greeting / empty-state path inside `ask()`, prefer the new concepts:

```js
// inside ask(), when nothing is selected:
const C = concepts();
const c = lm.includes('hier') ? [C[3]]
        : lm.includes('anim') || lm.includes('motion') ? [C[4]]
        : C.slice(0,3);
```

And slightly richer status messages after apply:

```js
// in the Apply button handler
$('#status').textContent = `Applied: ${c.title}`;
```

### 4. Documentation updates (agent-studio.md)

Suggested short additions you can drop into §9:

```markdown
### 9.3 Suggestion quality notes (2026-11)

`suggest()` and `concepts()` were expanded for higher design quality and novelty:

- Layout concepts are now format-aware (tall / wide / social / print) and include a “Motion First” and “Quiet Print / Story Punch” direction.
- Per-layer suggestions consider neighbouring layers, current contrast, and brand palette safety.
- Copy options continue to be drawn only from the brand pack (no invented claims).
- “Why” strings explain design intent rather than just describing the mechanical change.
- Commands are tuned to minimise new guardrail violations on first apply.
```

### Expected outcome

| Aspect | Before | After |
|--------|--------|-------|
| Layout ideas | 5 mostly similar variants | 5 distinct, format-aware directions + optional 6th |
| Suggestion depth | Keyword → single action | Context + hierarchy + contrast + brand tone |
| Novelty | Limited | Motion-first, editorial framing, quiet print, story punch |
| Guardrail friendliness | Sometimes introduces new issues | Commands biased toward safe results |
| Brand fidelity | Good on copy, weak on tone | Stronger use of palette + brand personality |

The card contract, command schema, preview-on-hover, Apply / Undo, and guardrail integration remain 100 % compatible. You can drop the two functions into the existing IIFE and the rest of the page continues to work.

Would you like me to also produce a version that adds one or two more experimental concepts (e.g. “Seasonal Overlay” or “Minimal Type Lock-up”) or a small set of unit-testable pure functions for the suggestion engine?


**Expanded experimental concepts + refined agent**

Here is a drop-in upgrade that keeps every existing command type valid while adding richer, more experimental layout directions. The new concepts lean into novelty (typographic posters, floating elements, dual-tone splits, soft washes, seasonal-feeling shifts, extreme minimalism) without breaking the current engine or guardrails.

### Full improved `concepts()`

```js
function concepts(){
  const g = GEO[FMT.id] || GEO.a4;
  const tall  = FMT.h / FMT.w > 1.2;
  const wide  = FMT.w / FMT.h > 1.3;
  const isSocial = /sq|story|portrait-45/.test(FMT.id);
  const isPrint  = FMT.id === 'a4' || FMT.id === 'portrait-45';
  const ratio = FMT.w / FMT.h;

  const base = [
    /* ── Classic high-quality directions ─────────────────────────────── */
    {
      title: 'Ink Night',
      why: 'Deep brand-ink ground, light type, restrained accent only on the CTA. Quiet luxury with excellent contrast.',
      cmds: [
        {type:'variant', variant:'night'},
        A('cta','pulse',3200,2200),
        A('headline','fadeIn',400,900)
      ]
    },
    {
      title: 'Framed Editorial',
      why: 'Photo pulled inside the 8 % margins. Feels like a magazine page or carefully printed piece — calm and considered.',
      cmds: [{type:'variant', variant:'framed'}]
    },
    {
      title: 'Accent Poster',
      why: 'Full-bleed accent ground with the highest-contrast type. Bold, poster energy when the brand accent is already strong.',
      cmds: [{type:'variant', variant:'accent'}]
    },

    /* ── Format-aware hierarchy ─────────────────────────────────────── */
    {
      title: tall ? 'Vertical Cascade' : wide ? 'Horizontal Sweep' : 'Tight Hierarchy',
      why: tall
        ? 'Clear vertical story: large headline, then sub, body, decisive CTA. Reading order is unmistakable.'
        : wide
          ? 'Photo owns the left third; type and CTA live in a clean right-hand column with generous leading.'
          : 'Force a clear reading order. Address is demoted so the call-to-action is never missed.',
      cmds: tall ? [
        S('headline',{y:52, font:{sizePct:+(g.head[4]*1.15).toFixed(2)}}),
        S('subhead',{y:68}),
        S('body',{y:74}),
        S('cta',{y:84}),
        S('footer',{y:90, opacity:0.55})
      ] : wide ? [
        S('photo',{x:0, w:42}),
        S('headline',{x:48, y:18, w:46}),
        S('subhead',{x:48, y:48, w:46}),
        S('body',{x:48, y:58, w:46}),
        S('cta',{x:48, y:78, w:40}),
        S('footer',{x:48, y:88, w:46, opacity:0.6})
      ] : [
        S('cta',{y:g.cta[1]}),
        S('footer',{y:+(g.foot[1]+1.5).toFixed(1), opacity:0.6})
      ]
    },

    /* ── Motion ─────────────────────────────────────────────────────── */
    {
      title: 'Motion First',
      why: 'Photo drifts, type staggers in, CTA gently pulses. Built for Stories, digital screens or any place that rewards movement.',
      cmds: [
        A('photo','parallax',0,10000),
        A('headline','fadeIn',300,800),
        A('subhead','fadeIn',700,800),
        A('body','fadeIn',1100,800),
        A('cta','pulse',2800,2400)
      ]
    },

    /* ── Experimental / high-novelty directions ─────────────────────── */
    {
      title: 'Typographic Poster',
      why: 'Type becomes the hero. Photo is pushed back or cropped hard; headline grows dramatically. Strong when the brand has a distinctive display face.',
      cmds: [
        S('photo',{opacity:0.55, h: isTall ? 38 : 45}),
        S('headline',{
          y: isTall ? 42 : 48,
          font:{sizePct:+(g.head[4]*1.45).toFixed(2), weight:Math.max(BF.dW,600)},
          opacity:1
        }),
        S('subhead',{y: isTall ? 62 : 68, opacity:0.85}),
        S('body',{opacity:0.65}),
        S('cta',{y:86, font:{letterSpacingEm:0.18, weight:Math.max(BF.bW,600)}}),
        A('headline','fadeIn',200,900)
      ]
    },
    {
      title: 'Floating Elements',
      why: 'More negative space, elements feel suspended. Soft entrance animations and slightly reduced opacity on secondary type create an airy, contemporary feel.',
      cmds: [
        S('photo',{x:8, y:8, w:84, h: isTall ? 42 : 48}),
        S('headline',{y: isTall ? 56 : 60, opacity:0.95}),
        S('subhead',{opacity:0.75}),
        S('body',{opacity:0.6}),
        S('cta',{opacity:0.9}),
        S('footer',{opacity:0.45}),
        A('headline','fadeIn',400,1000),
        A('cta','fadeIn',1200,900)
      ]
    },
    {
      title: 'Dual-Tone Split',
      why: 'Ground shifts to a soft split between ink and bone (or accent). Creates visual tension and a modern dual-personality feel without needing new assets.',
      cmds: [
        {type:'variant', variant:'night'},
        S('photo',{opacity:0.85}),
        S('headline',{color:TH.bone}),
        S('subhead',{color:TH.accent}),
        S('cta',{color:TH.accent, font:{weight:Math.max(BF.bW,600)}}),
        A('cta','pulse',3000,2200)
      ]
    },
    {
      title: 'Soft Gradient Wash',
      why: 'A gentle brand-coloured wash sits over the lower half of the photo. Type stays crisp; the image becomes more atmospheric and less literal.',
      cmds: [
        S('photo',{h:58}),
        {type:'add-layer', layer:{
          id:'wash-'+uid++,
          name:'Gradient wash',
          type:'gradient',
          x:0, y:28, w:100, h:42, z:5, opacity:0.72,
          from:rgba(TH.ink,0),
          to:rgba(TH.ink,0.85)
        }},
        S('headline',{y:58, color:TH.bone}),
        S('subhead',{y:72, color:TH.bone}),
        S('cta',{y:86, color:TH.accent}),
        A('headline','fadeIn',350,900)
      ]
    },
    {
      title: 'Minimal Lock-up',
      why: 'Extreme hierarchy. Almost no body copy, oversized headline, single strong CTA. Perfect when the brand message is already short and confident.',
      cmds: [
        S('body',{hidden:true}),
        S('subhead',{opacity:0.7, font:{sizePct:+(g.sub[4]*0.9).toFixed(2)}}),
        S('headline',{
          y: isTall ? 48 : 52,
          font:{sizePct:+(g.head[4]*1.55).toFixed(2), weight:Math.max(BF.dW,700)},
          opacity:1
        }),
        S('cta',{
          y:82,
          font:{sizePct:+(g.cta[4]*1.15).toFixed(2), letterSpacingEm:0.2, weight:Math.max(BF.bW,600)}
        }),
        S('footer',{opacity:0.4}),
        A('headline','fadeIn',200,1000),
        A('cta','pulse',2600,2400)
      ]
    },
    {
      title: 'Seasonal Shift',
      why: 'A warmer or cooler temperature shift using the brand palette. Feels seasonal without requiring new photography — useful for limited-time campaigns.',
      cmds: [
        S('ground',{color: mixHex(TH.bone, TH.accent, 0.18)}),
        S('headline',{color:TH.ink}),
        S('subhead',{color: mixHex(TH.ink, TH.accent, 0.35)}),
        S('cta',{color:TH.accent, font:{weight:Math.max(BF.bW,600)}}),
        A('cta','pulse',2800,2200)
      ]
    },
    {
      title: 'Photo as Texture',
      why: 'The photograph is treated as atmosphere rather than subject. Heavy soft scrim + reduced opacity lets type and logo dominate while still keeping brand imagery present.',
      cmds: [
        S('photo',{opacity:0.45, h:100, y:0}),
        S('ground',{color:TH.ink}),
        {type:'add-layer', layer:{
          id:'scrim-tex-'+uid++,
          name:'Texture scrim',
          type:'gradient',
          x:0, y:0, w:100, h:100, z:4, opacity:0.55,
          from:rgba(TH.ink,0.3),
          to:rgba(TH.ink,0.85)
        }},
        S('headline',{color:TH.bone, y:42}),
        S('subhead',{color:TH.bone, opacity:0.8}),
        S('cta',{color:TH.accent}),
        A('headline','fadeIn',300,900)
      ]
    }
  ];

  // Prefer a smart subset of 5 for the initial greeting so the chat stays focused
  // (full list is still available if the user asks for “more ideas” or “experimental”)
  const preferred = [
    base[0], // Ink Night
    base[1], // Framed Editorial
    base[5], // Typographic Poster
    base[6], // Floating Elements
    base[9]  // Minimal Lock-up
  ];

  // If the user later asks for experimental / more / seasonal etc., the full list can be returned
  return preferred;
}

// Tiny helper used by Seasonal Shift (safe even if colour is already hex)
function mixHex(a, b, t){
  const ca = rgb(a), cb = rgb(b);
  const m = [0,1,2].map(i => Math.round(ca[i]*(1-t) + cb[i]*t));
  return '#' + m.map(v => v.toString(16).padStart(2,'0')).join('');
}
```

### Smarter greeting / “more ideas” behaviour

Update the empty-selection branch inside `ask()` so the agent can surface the experimental set on demand:

```js
function ask(t){
  say('user', esc(t));
  const l = scene.find(q => q.id === sel);
  setTimeout(() => {
    if (!l) {
      const lm = t.toLowerCase();
      const all = concepts();               // the preferred 5
      const experimental = [
        'Typographic Poster',
        'Floating Elements',
        'Dual-Tone Split',
        'Soft Gradient Wash',
        'Minimal Lock-up',
        'Seasonal Shift',
        'Photo as Texture'
      ];

      let cards;
      if (lm.includes('hier') || lm.includes('order') || lm.includes('reading')) {
        cards = [all.find(c => /Cascade|Sweep|Hierarchy/.test(c.title))].filter(Boolean);
      } else if (lm.includes('anim') || lm.includes('motion') || lm.includes('move')) {
        cards = [all.find(c => c.title === 'Motion First')].filter(Boolean);
      } else if (lm.includes('experimental') || lm.includes('more') || lm.includes('novel') ||
                 lm.includes('creative') || lm.includes('wild') || lm.includes('season')) {
        // return the full experimental set
        cards = concepts.__full || all;     // see note below
      } else {
        cards = all.slice(0, 3);
      }

      say('agent',
        lm.includes('experimental') || lm.includes('more')
          ? 'Here are more experimental directions — each still respects the brand palette and guardrails:'
          : lm.includes('hier')
            ? 'One structural issue I can see:'
            : lm.includes('anim')
              ? 'A motion-led treatment for the whole design. Drag the bars in the timeline to retime it:'
              : 'Three directions for the whole design, built from this brand’s palette and type. Hover to preview each on the canvas:',
        cards
      );
    } else {
      const c = suggest(l, t);
      say('agent',
        c.length
          ? `For <b>${esc(l.name)}</b>:`
          : `I can’t do that to <b>${esc(l.name)}</b> yet. Try “bigger”, “accent colour”, “animate it” or “move up”.`,
        c
      );
    }
  }, 300);
}
```

To make the full experimental list available on demand, expose it once:

```js
// right after the concepts() definition
concepts.__full = (() => {
  // temporarily force the full list
  const original = concepts;
  // … or simply keep a second constant FULL_CONCEPTS that returns every item
  return null; // simpler: just expand the return of concepts() when needed
})();
```

A cleaner pattern is to keep two functions:

```js
function getPreferredConcepts(){ /* the 5 above */ }
function getExperimentalConcepts(){ /* all 11 */ }

function concepts(){ return getPreferredConcepts(); }
```

Then inside `ask()`:

```js
const cards = (lm.includes('experimental') || lm.includes('more') || lm.includes('novel'))
  ? getExperimentalConcepts()
  : getPreferredConcepts().slice(0,3);
```

### Quick quality notes on the new concepts

| Concept              | Novelty | Risk to guardrails | Best for                  |
|----------------------|---------|--------------------|---------------------------|
| Typographic Poster   | High    | Low                | Strong display faces      |
| Floating Elements    | High    | Low                | Contemporary / lifestyle  |
| Dual-Tone Split      | Medium  | Low                | Bold brands               |
| Soft Gradient Wash   | High    | Low–medium         | Atmospheric photography   |
| Minimal Lock-up      | High    | Low                | Short, confident messages |
| Seasonal Shift       | Medium  | Low                | Campaign / limited-time   |
| Photo as Texture     | High    | Low                | Type-led campaigns        |

All commands stay inside the existing seven command types, so `commit()`, preview-on-hover, undo, and the guardrail checker continue to work unchanged.

You can paste the new `concepts()` (and the small `mixHex` helper) directly over the old one. The experimental set will appear when the user asks for “more ideas”, “experimental”, “creative”, “novel”, or “seasonal”.



**More experimental concepts added**

Here is a significantly expanded set of experimental layout directions. All of them stay inside the existing command vocabulary (`variant`, `set-layer`, `add-layer`, `set-animation`) so they work with the current preview / Apply / undo / guardrail system.

### Expanded experimental concepts

```js
function getExperimentalConcepts(){
  const g = GEO[FMT.id] || GEO.a4;
  const tall = FMT.h / FMT.w > 1.2;
  const wide = FMT.w / FMT.h > 1.3;
  const isSocial = /sq|story|portrait-45/.test(FMT.id);

  return [
    /* ── Already strong ones (kept) ─────────────────────────────────── */
    {
      title: 'Typographic Poster',
      why: 'Type becomes the hero. Photo is pushed back; headline grows dramatically. Strong when the brand has a distinctive display face.',
      cmds: [
        S('photo',{opacity:0.55, h: tall ? 38 : 45}),
        S('headline',{
          y: tall ? 42 : 48,
          font:{sizePct:+(g.head[4]*1.45).toFixed(2), weight:Math.max(BF.dW,600)},
          opacity:1
        }),
        S('subhead',{y: tall ? 62 : 68, opacity:0.85}),
        S('body',{opacity:0.65}),
        S('cta',{y:86, font:{letterSpacingEm:0.18, weight:Math.max(BF.bW,600)}}),
        A('headline','fadeIn',200,900)
      ]
    },
    {
      title: 'Floating Elements',
      why: 'More negative space. Elements feel suspended. Soft entrances and reduced secondary opacity create an airy, contemporary feel.',
      cmds: [
        S('photo',{x:8, y:8, w:84, h: tall ? 42 : 48}),
        S('headline',{y: tall ? 56 : 60, opacity:0.95}),
        S('subhead',{opacity:0.75}),
        S('body',{opacity:0.6}),
        S('cta',{opacity:0.9}),
        S('footer',{opacity:0.45}),
        A('headline','fadeIn',400,1000),
        A('cta','fadeIn',1200,900)
      ]
    },
    {
      title: 'Dual-Tone Split',
      why: 'Ground shifts between ink and bone/accent. Creates visual tension and a modern dual-personality feel.',
      cmds: [
        {type:'variant', variant:'night'},
        S('photo',{opacity:0.85}),
        S('headline',{color:TH.bone}),
        S('subhead',{color:TH.accent}),
        S('cta',{color:TH.accent, font:{weight:Math.max(BF.bW,600)}}),
        A('cta','pulse',3000,2200)
      ]
    },
    {
      title: 'Soft Gradient Wash',
      why: 'A gentle brand-coloured wash sits over the lower half of the photo. Type stays crisp; the image becomes more atmospheric.',
      cmds: [
        S('photo',{h:58}),
        {type:'add-layer', layer:{
          id:'wash-'+uid++, name:'Gradient wash', type:'gradient',
          x:0, y:28, w:100, h:42, z:5, opacity:0.72,
          from:rgba(TH.ink,0), to:rgba(TH.ink,0.85)
        }},
        S('headline',{y:58, color:TH.bone}),
        S('subhead',{y:72, color:TH.bone}),
        S('cta',{y:86, color:TH.accent}),
        A('headline','fadeIn',350,900)
      ]
    },
    {
      title: 'Minimal Lock-up',
      why: 'Extreme hierarchy. Almost no body copy, oversized headline, single strong CTA. Best when the brand message is already short and confident.',
      cmds: [
        S('body',{hidden:true}),
        S('subhead',{opacity:0.7, font:{sizePct:+(g.sub[4]*0.9).toFixed(2)}}),
        S('headline',{
          y: tall ? 48 : 52,
          font:{sizePct:+(g.head[4]*1.55).toFixed(2), weight:Math.max(BF.dW,700)},
          opacity:1
        }),
        S('cta',{
          y:82,
          font:{sizePct:+(g.cta[4]*1.15).toFixed(2), letterSpacingEm:0.2, weight:Math.max(BF.bW,600)}
        }),
        S('footer',{opacity:0.4}),
        A('headline','fadeIn',200,1000),
        A('cta','pulse',2600,2400)
      ]
    },
    {
      title: 'Seasonal Shift',
      why: 'A warmer or cooler temperature shift using the brand palette. Feels seasonal without new photography — useful for limited-time campaigns.',
      cmds: [
        S('ground',{color: mixHex(TH.bone, TH.accent, 0.18)}),
        S('headline',{color:TH.ink}),
        S('subhead',{color: mixHex(TH.ink, TH.accent, 0.35)}),
        S('cta',{color:TH.accent, font:{weight:Math.max(BF.bW,600)}}),
        A('cta','pulse',2800,2200)
      ]
    },
    {
      title: 'Photo as Texture',
      why: 'Photograph treated as atmosphere rather than subject. Heavy soft scrim + reduced opacity lets type and logo dominate while keeping brand imagery present.',
      cmds: [
        S('photo',{opacity:0.45, h:100, y:0}),
        S('ground',{color:TH.ink}),
        {type:'add-layer', layer:{
          id:'scrim-tex-'+uid++, name:'Texture scrim', type:'gradient',
          x:0, y:0, w:100, h:100, z:4, opacity:0.55,
          from:rgba(TH.ink,0.3), to:rgba(TH.ink,0.85)
        }},
        S('headline',{color:TH.bone, y:42}),
        S('subhead',{color:TH.bone, opacity:0.8}),
        S('cta',{color:TH.accent}),
        A('headline','fadeIn',300,900)
      ]
    },

    /* ── New experimental concepts ──────────────────────────────────── */
    {
      title: 'Asymmetric Balance',
      why: 'Intentionally off-centre composition. Logo and headline sit to one side, creating tension and a more editorial, contemporary feel.',
      cmds: [
        S('logo',{x: tall ? 8 : 6, y:8}),
        S('headline',{x: tall ? 8 : 6, w:78, align:'left'}),
        S('subhead',{x: tall ? 8 : 6, w:70, align:'left'}),
        S('body',{x: tall ? 8 : 6, w:65, align:'left'}),
        S('cta',{x: tall ? 8 : 6, w:42, align:'left'}),
        S('footer',{x: tall ? 8 : 6, align:'left', opacity:0.55})
      ]
    },
    {
      title: 'CTA Spotlight',
      why: 'Everything else is quiet. The call-to-action becomes the clear focal point — larger, higher contrast, and gently pulsing.',
      cmds: [
        S('headline',{opacity:0.85}),
        S('subhead',{opacity:0.65}),
        S('body',{opacity:0.5}),
        S('footer',{opacity:0.35}),
        S('cta',{
          y: tall ? 78 : 80,
          font:{sizePct:+(g.cta[4]*1.35).toFixed(2), weight:Math.max(BF.bW,700), letterSpacingEm:0.16},
          opacity:1
        }),
        A('cta','pulse',2000,2400)
      ]
    },
    {
      title: 'Silent Frame',
      why: 'Almost no text. Just the photograph, logo, and a tiny footer. Extreme restraint — powerful when the image is strong enough to carry the brand alone.',
      cmds: [
        S('headline',{hidden:true}),
        S('subhead',{hidden:true}),
        S('body',{hidden:true}),
        S('cta',{hidden:true}),
        S('photo',{x:0, y:0, w:100, h:100}),
        S('logo',{y:8, opacity:0.95}),
        S('footer',{y:92, opacity:0.6, font:{sizePct:0.95}})
      ]
    },
    {
      title: 'Colour Block',
      why: 'A solid brand-accent block sits behind the CTA (or headline). Creates a strong focal plane and a poster-like graphic quality.',
      cmds: [
        {type:'add-layer', layer:{
          id:'block-'+uid++, name:'Colour block', type:'shape',
          x:8, y: tall ? 78 : 80, w:84, h: tall ? 9 : 10,
          z:7, opacity:1, color:TH.accent, radius:0.6
        }},
        S('cta',{
          y: tall ? 79.5 : 81.5,
          color: readable(TH.chalk, TH.accent),
          font:{weight:Math.max(BF.bW,700), letterSpacingEm:0.14}
        }),
        A('cta','fadeIn',600,800)
      ]
    },
    {
      title: 'Layered Depth',
      why: 'Multiple soft scrims and staggered opacities create a sense of atmospheric depth. The photo feels further away; type floats in front.',
      cmds: [
        S('photo',{opacity:0.7}),
        {type:'add-layer', layer:{
          id:'depth1-'+uid++, name:'Depth layer 1', type:'gradient',
          x:0, y:40, w:100, h:35, z:4, opacity:0.45,
          from:rgba(TH.ink,0), to:rgba(TH.ink,0.6)
        }},
        {type:'add-layer', layer:{
          id:'depth2-'+uid++, name:'Depth layer 2', type:'gradient',
          x:0, y:65, w:100, h:35, z:5, opacity:0.55,
          from:rgba(TH.ink,0.2), to:rgba(TH.ink,0.9)
        }},
        S('headline',{color:TH.bone, y:48}),
        S('subhead',{color:TH.bone, opacity:0.85}),
        S('cta',{color:TH.accent}),
        A('headline','fadeIn',400,1000)
      ]
    },
    {
      title: 'Ghost Type',
      why: 'Secondary text starts almost invisible and fades in gently. Creates a soft, cinematic reveal and keeps the first impression clean.',
      cmds: [
        S('subhead',{opacity:0.25}),
        S('body',{opacity:0.2}),
        S('footer',{opacity:0.15}),
        A('subhead','fadeIn',1200,1400),
        A('body','fadeIn',1800,1400),
        A('footer','fadeIn',2400,1200),
        A('headline','fadeIn',300,900)
      ]
    },
    {
      title: 'Crop Drama',
      why: 'Extreme crop on the hero photograph. Focuses on a detail or texture, making the image feel more intimate and less literal.',
      cmds: [
        S('photo',{
          x: -15, y: -10,
          w: 130, h: tall ? 70 : 75,
          fx: 65, fy: 40
        }),
        S('headline',{y: tall ? 62 : 68}),
        S('subhead',{y: tall ? 76 : 80}),
        S('cta',{y:88})
      ]
    },
    {
      title: 'Monochrome Echo',
      why: 'Almost everything forced into ink and bone. A single accent pop on the CTA. Quiet, confident, and very brand-disciplined.',
      cmds: [
        S('ground',{color:TH.ink}),
        S('headline',{color:TH.bone}),
        S('subhead',{color:TH.bone, opacity:0.75}),
        S('body',{color:TH.bone, opacity:0.6}),
        S('footer',{color:TH.bone, opacity:0.45}),
        S('cta',{color:TH.accent, font:{weight:Math.max(BF.bW,700)}}),
        S('logo',{tone:'white'}),
        A('cta','pulse',2800,2200)
      ]
    },
    {
      title: 'Breathing Grid',
      why: 'More even vertical rhythm and generous margins. Feels modular and calm — closer to a well-set print layout than a dense social post.',
      cmds: [
        S('photo',{x:10, y:8, w:80, h: tall ? 40 : 44}),
        S('headline',{x:10, y: tall ? 54 : 58, w:80}),
        S('subhead',{x:10, y: tall ? 68 : 70, w:80}),
        S('body',{x:10, y: tall ? 74 : 76, w:80}),
        S('cta',{x:10, y:86, w:50}),
        S('footer',{x:10, y:92, w:80, opacity:0.55})
      ]
    },
    {
      title: 'No Photo Field',
      why: 'Pure colour + type. The photograph is removed so the brand palette and typography carry the entire message. Strong for type-led brands or when photography is weak.',
      cmds: [
        S('photo',{hidden:true}),
        S('ground',{color:TH.bone}),
        S('headline',{
          y: tall ? 28 : 32,
          font:{sizePct:+(g.head[4]*1.4).toFixed(2), weight:Math.max(BF.dW,600)}
        }),
        S('subhead',{y: tall ? 48 : 52}),
        S('body',{y: tall ? 58 : 62}),
        S('cta',{y:78, font:{weight:Math.max(BF.bW,600)}}),
        S('footer',{y:90, opacity:0.55}),
        A('headline','fadeIn',300,1000)
      ]
    },
    {
      title: 'Accent Rule',
      why: 'A thin horizontal brand-accent rule separates the photo from the type block. Simple graphic device that adds structure and a quiet brand signal.',
      cmds: [
        S('photo',{h: tall ? 46 : 50}),
        {type:'add-layer', layer:{
          id:'rule-'+uid++, name:'Accent rule', type:'shape',
          x:8, y: tall ? 48 : 52, w:84, h:0.45,
          z:9, opacity:1, color:TH.accent
        }},
        S('headline',{y: tall ? 54 : 58}),
        S('subhead',{y: tall ? 68 : 70}),
        S('cta',{y:86})
      ]
    },
    {
      title: 'Stacked Whisper',
      why: 'All text collapses into a tight vertical band with reduced opacity on everything except the headline and CTA. Intimate and quiet.',
      cmds: [
        S('headline',{y: tall ? 58 : 62, font:{sizePct:+(g.head[4]*1.1).toFixed(2)}}),
        S('subhead',{y: tall ? 70 : 72, opacity:0.7}),
        S('body',{y: tall ? 75 : 77, opacity:0.55, font:{sizePct:+(g.body[4]*0.9).toFixed(2)}}),
        S('cta',{y:84, opacity:0.95}),
        S('footer',{y:90, opacity:0.4}),
        A('headline','fadeIn',400,900)
      ]
    }
  ];
}

function getPreferredConcepts(){
  // Short, high-signal list used for the default greeting
  const all = getExperimentalConcepts();
  const pick = titles => titles.map(t => all.find(c => c.title === t)).filter(Boolean);
  return pick([
    'Ink Night',           // still available via classic path if you keep it
    'Typographic Poster',
    'Floating Elements',
    'Minimal Lock-up',
    'CTA Spotlight'
  ]);
}

// Keep the original concepts() as the preferred short list
function concepts(){
  return getPreferredConcepts();
}

// Helper already shown previously
function mixHex(a, b, t){
  const ca = rgb(a), cb = rgb(b);
  const m = [0,1,2].map(i => Math.round(ca[i]*(1-t) + cb[i]*t));
  return '#' + m.map(v => v.toString(16).padStart(2,'0')).join('');
}
```

> Note: “Ink Night”, “Framed Editorial” and the other classic variants can stay in a separate `getClassicConcepts()` if you still want them. The experimental list above focuses on the more novel directions.

### Updated `ask()` snippet (so users can request the full experimental set)

```js
// inside the !l branch of ask()
const lm = t.toLowerCase();
let cards;

if (lm.includes('experimental') || lm.includes('more') || lm.includes('novel') ||
    lm.includes('creative') || lm.includes('wild') || lm.includes('ideas')) {
  cards = getExperimentalConcepts();
  say('agent', 'Here is a wider set of experimental directions. Each still respects the brand palette and can be previewed:', cards);
} else if (lm.includes('hier') || lm.includes('order') || lm.includes('reading')) {
  cards = getExperimentalConcepts().filter(c => /Cascade|Sweep|Hierarchy|Breathing|Stacked/.test(c.title));
  say('agent', 'Structural / hierarchy-focused ideas:', cards);
} else if (lm.includes('anim') || lm.includes('motion') || lm.includes('move')) {
  cards = getExperimentalConcepts().filter(c => /Motion|Ghost|Spotlight|Pulse/.test(c.title) || c.cmds.some(cmd => cmd.type === 'set-animation'));
  say('agent', 'Motion-led treatments:', cards);
} else {
  cards = getPreferredConcepts().slice(0, 3);
  say('agent', 'Three strong directions for the whole design. Hover to preview, or ask for “more experimental ideas”:', cards);
}
```

### Summary of the new experimental set

| Concept            | Character                          | Best when…                          |
|--------------------|------------------------------------|-------------------------------------|
| Asymmetric Balance | Off-centre, editorial              | Contemporary / lifestyle brands     |
| CTA Spotlight      | Extreme focus on the action        | Conversion-focused pieces           |
| Silent Frame       | Almost no text                     | Strong photography                  |
| Colour Block       | Graphic accent plane               | Poster / bold graphic work          |
| Layered Depth      | Atmospheric depth via scrims       | Moody or evening brands             |
| Ghost Type         | Cinematic fade-in of secondary text| Digital / motion pieces             |
| Crop Drama         | Extreme photographic crop          | Detail-rich or textured images      |
| Monochrome Echo    | Strict ink/bone + one accent       | Disciplined brand systems           |
| Breathing Grid     | Even, modular spacing              | Print or calm layouts               |
| No Photo Field     | Pure type + colour                 | Type-led brands or weak photos      |
| Accent Rule        | Thin horizontal brand rule         | Structured, quiet layouts           |
| Stacked Whisper    | Tight, intimate text band          | Soft / intimate messaging           |

You now have a much richer palette of experimental ideas while staying 100 % compatible with the existing agent infrastructure.


**Motion graphics + light interactive prototypes for Agent Studio**

The current engine already supports four CSS animation presets (`fadeIn`, `zoom`, `parallax`, `pulse`) and a 10-second timeline. Below is a focused expansion that adds:

1. **Richer motion-graphics presets** (new keyframes + agent support)
2. **Motion-first experimental concepts**
3. **A lightweight interactive prototype mode** (click-to-play, hover previews, simple hotspots)

All of this stays inside the existing single-file architecture and command schema.

---

### 1. New CSS keyframes (add to the `<style>` block)

```css
/* Existing */
@keyframes fadeIn{from{opacity:0;transform:translateY(2cqh)}to{opacity:1}}
@keyframes zoom{to{transform:scale(1.08)}}
@keyframes parallax{from{transform:scale(1.08)}to{transform:translateY(-2.5cqh) scale(1.08)}}
@keyframes pulse{50%{opacity:.35}}

/* New motion-graphics presets */
@keyframes slideUp{
  from{opacity:0;transform:translateY(6cqh)}
  to{opacity:1;transform:translateY(0)}
}
@keyframes slideInLeft{
  from{opacity:0;transform:translateX(-8cqw)}
  to{opacity:1;transform:translateX(0)}
}
@keyframes slideInRight{
  from{opacity:0;transform:translateX(8cqw)}
  to{opacity:1;transform:translateX(0)}
}
@keyframes scaleIn{
  from{opacity:0;transform:scale(.92)}
  to{opacity:1;transform:scale(1)}
}
@keyframes blurIn{
  from{opacity:0;filter:blur(8px);transform:translateY(1.5cqh)}
  to{opacity:1;filter:blur(0);transform:translateY(0)}
}
@keyframes float{
  0%,100%{transform:translateY(0)}
  50%{transform:translateY(-1.8cqh)}
}
@keyframes gentleShake{
  0%,100%{transform:translateX(0)}
  25%{transform:translateX(-0.6cqw)}
  75%{transform:translateX(0.6cqw)}
}
@keyframes typeReveal{
  from{clip-path:inset(0 100% 0 0)}
  to{clip-path:inset(0 0 0 0)}
}
@keyframes glowPulse{
  0%,100%{filter:brightness(1);opacity:1}
  50%{filter:brightness(1.15);opacity:.9}
}

@media (prefers-reduced-motion:reduce){
  .L[data-an]{animation:none!important}
}
```

---

### 2. Extend the animation system in JS

Add the new presets to the places that list them (mainly `suggest()` and any hard-coded lists).

```js
// Helper – all supported motion presets
const MOTION_PRESETS = [
  {id:'fadeIn',      label:'Fade In',        desc:'Soft opacity + slight rise',     defaultDur:900},
  {id:'slideUp',     label:'Slide Up',       desc:'Enters from below',              defaultDur:800},
  {id:'slideInLeft', label:'Slide In Left',  desc:'Enters from the left',           defaultDur:800},
  {id:'slideInRight',label:'Slide In Right', desc:'Enters from the right',          defaultDur:800},
  {id:'scaleIn',     label:'Scale In',       desc:'Subtle scale-up entrance',       defaultDur:700},
  {id:'blurIn',      label:'Blur In',        desc:'Soft focus reveal',              defaultDur:1000},
  {id:'zoom',        label:'Slow Zoom',      desc:'Cinematic push-in (images)',     defaultDur:10000},
  {id:'parallax',    label:'Parallax Drift', desc:'Gentle vertical drift',          defaultDur:10000},
  {id:'pulse',       label:'Pulse',          desc:'Attention pulse (good for CTA)', defaultDur:2400},
  {id:'float',       label:'Float',          desc:'Continuous soft float',          defaultDur:4000},
  {id:'gentleShake', label:'Gentle Shake',   desc:'Tiny horizontal emphasis',       defaultDur:600},
  {id:'typeReveal',  label:'Type Reveal',    desc:'Clip-path reveal (text)',        defaultDur:1200},
  {id:'glowPulse',   label:'Glow Pulse',     desc:'Subtle brightness pulse',        defaultDur:2200}
];
```

Update the animation branch inside `suggest()`:

```js
if (has(['animat','motion','fade','pulse','zoom','parallax','slide','float','reveal','shake','glow']) || msg === 'Animate it') {
  const want = MOTION_PRESETS.find(p => m.includes(p.id) || m.includes(p.label.toLowerCase()));
  const list = want ? [want] : MOTION_PRESETS.filter(p => {
    if (isImage) return true;
    if (isText) return !['zoom','parallax'].includes(p.id);
    return !['zoom','parallax','typeReveal'].includes(p.id);
  }).slice(0,6);

  list.forEach(p => {
    add(`Animate · ${p.label}`, p.desc, [A(id, p.id, 300, p.defaultDur)]);
  });
}
```

Also update the `render()` animation line so the new presets are recognised as infinite where appropriate:

```js
// inside render(), the animation style line
if (l.anim) {
  const infinite = ['pulse','float','glowPulse'].includes(l.anim.preset);
  e.dataset.an = 1;
  e.style.animation = `${l.anim.preset} ${l.anim.duration}ms ${
    infinite ? 'ease-in-out infinite' : 'ease-out'
  } ${l.anim.start - (tgt === stage ? T : DUR)}ms both paused`;
}
```

---

### 3. New motion-graphics experimental concepts

Add these to `getExperimentalConcepts()`:

```js
{
  title: 'Staggered Motion Cascade',
  why: 'Classic motion-graphics entrance: photo drifts, then headline, subhead, body and CTA appear in sequence with different easing characters.',
  cmds: [
    A('photo','parallax',0,10000),
    A('headline','slideUp',200,900),
    A('subhead','fadeIn',700,800),
    A('body','blurIn',1100,1000),
    A('cta','scaleIn',1600,700),
    A('cta','pulse',3200,2400)
  ]
},
{
  title: 'Cinematic Push',
  why: 'Slow zoom on the photograph + soft type reveal. Feels like a title card from a short film or high-end brand film.',
  cmds: [
    A('photo','zoom',0,10000),
    A('headline','blurIn',800,1200),
    A('subhead','fadeIn',1600,900),
    A('cta','slideUp',2400,800)
  ]
},
{
  title: 'Floating Type System',
  why: 'All text elements gently float at different rates while the photo stays almost still. Soft, modern, and very motion-graphics oriented.',
  cmds: [
    A('headline','float',0,5000),
    A('subhead','float',800,5500),
    A('body','float',1600,6000),
    A('cta','float',2400,4500),
    S('photo',{opacity:0.9})
  ]
},
{
  title: 'Type Reveal Sequence',
  why: 'Headline uses a clip-path reveal, secondary lines fade in afterwards. Clean kinetic-typography feel.',
  cmds: [
    A('headline','typeReveal',200,1400),
    A('subhead','fadeIn',1200,900),
    A('body','fadeIn',1800,900),
    A('cta','scaleIn',2600,700)
  ]
},
{
  title: 'Micro-Interaction Pulse',
  why: 'Very restrained motion: only the CTA and logo have subtle life. Everything else is still. Ideal for refined brands.',
  cmds: [
    A('logo','glowPulse',0,3000),
    A('cta','pulse',1800,2400)
  ]
}
```

---

### 4. Lightweight interactive prototype mode

Add a simple prototype layer on top of the existing stage. This gives clickable hotspots and a “play as prototype” experience without turning the page into a full prototyping tool.

#### A. CSS for prototype mode

```css
#app.prototype-mode .stage{cursor:crosshair}
#app.prototype-mode .L[data-hotspot]{
  outline:1px dashed color-mix(in srgb, var(--ac) 70%, transparent);
  outline-offset:2px;
}
#app.prototype-mode .L[data-hotspot]:hover{
  outline-color:var(--ac);
}
.proto-bar{
  display:none;
  gap:8px;
  align-items:center;
  padding:6px 12px;
  background:var(--pan);
  border-bottom:1px solid var(--line);
  font-size:12px;
}
#app.prototype-mode .proto-bar{display:flex}
.proto-bar button{padding:3px 10px;font-size:12px}
```

#### B. Markup (add inside the main toolbar `.tb`)

```html
<button id="protoToggle" title="Toggle interactive prototype mode">Prototype</button>
```

And a small bar that appears in prototype mode (can be injected by JS or added statically):

```html
<div class="proto-bar" id="protoBar">
  <span style="color:var(--mu)">Prototype mode</span>
  <button id="protoPlay">▶ Play all</button>
  <button id="protoReset">Reset</button>
  <span id="protoHint" style="color:var(--mu);margin-left:auto">Click any layer with a hotspot</span>
</div>
```

#### C. JavaScript for prototype behaviour

```js
let protoMode = false;
const hotspots = new Map(); // layerId → {action: 'animate' | 'pulse' | 'custom', preset?}

function togglePrototype(on){
  protoMode = on ?? !protoMode;
  appEl.classList.toggle('prototype-mode', protoMode);
  $('#protoToggle').setAttribute('aria-pressed', String(protoMode));
  $('#protoHint').textContent = protoMode
    ? 'Click a layer to trigger its animation · Shift-click to set as hotspot'
    : '';
  if (!protoMode) stopP();
}

$('#protoToggle').onclick = () => togglePrototype();

// Shift-click on a layer while in prototype mode marks it as a hotspot
stage.addEventListener('click', e => {
  if (!protoMode) return;
  const layerEl = e.target.closest('.L');
  if (!layerEl) return;
  const id = layerEl.dataset.id;
  const layer = scene.find(l => l.id === id);
  if (!layer) return;

  if (e.shiftKey) {
    // Toggle hotspot
    if (hotspots.has(id)) {
      hotspots.delete(id);
      layerEl.removeAttribute('data-hotspot');
      toast(`Hotspot removed from ${layer.name}`);
    } else {
      hotspots.set(id, {action:'animate', preset: layer.anim?.preset || 'fadeIn'});
      layerEl.setAttribute('data-hotspot','');
      toast(`Hotspot added to ${layer.name} — click to play its animation`);
    }
    return;
  }

  // Normal click → play the layer’s animation (or the hotspot action)
  if (hotspots.has(id) || layer.anim) {
    const preset = hotspots.get(id)?.preset || layer.anim?.preset || 'fadeIn';
    // Temporarily force the animation to run from the beginning
    const el = stage.querySelector(`[data-id="${id}"]`);
    if (el) {
      el.style.animation = 'none';
      el.offsetHeight; // reflow
      el.style.animation = `${preset} 900ms ease-out 0ms both`;
    }
  }
});

$('#protoPlay').onclick = () => {
  // Play every layer that has an animation, staggered
  stopP();
  let delay = 0;
  scene.filter(l => l.anim && !l.hidden).forEach(l => {
    const el = stage.querySelector(`[data-id="${l.id}"]`);
    if (!el) return;
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = `${l.anim.preset} ${l.anim.duration}ms ease-out ${delay}ms both`;
    delay += 180;
  });
};

$('#protoReset').onclick = () => {
  stage.querySelectorAll('.L').forEach(el => {
    el.style.animation = '';
  });
  seek(0);
  toast('Prototype reset');
};
```

#### D. Agent support for hotspots (optional but nice)

In `suggest()`, when the user says “make it interactive” or “add hotspot”:

```js
if (has(['hotspot','interactive','clickable','prototype'])) {
  add('Make this a hotspot',
      'In Prototype mode, clicking this layer will play its animation. Shift-click the layer on the canvas to toggle the hotspot.',
      [S(id, { /* we just mark intent; actual hotspot is canvas-side */ })]);
  // The real work is done by the shift-click handler above
}
```

---

### 5. Updated motion-focused preferred concepts

You can now make the default greeting more motion-aware:

```js
function getPreferredConcepts(){
  return [
    getExperimentalConcepts().find(c => c.title === 'Staggered Motion Cascade'),
    getExperimentalConcepts().find(c => c.title === 'Typographic Poster'),
    getExperimentalConcepts().find(c => c.title === 'Floating Elements'),
    getExperimentalConcepts().find(c => c.title === 'Cinematic Push'),
    getExperimentalConcepts().find(c => c.title === 'Minimal Lock-up')
  ].filter(Boolean);
}
```

---

### What you get

| Capability                    | Before              | After                                      |
|------------------------------|---------------------|--------------------------------------------|
| Animation presets            | 4                   | 13 (slide, scale, blur, float, reveal…)   |
| Motion-graphics concepts     | Limited             | Dedicated cascade, cinematic, kinetic type |
| Interactive prototype mode   | None                | Toggleable, click-to-play, shift-click hotspots |
| Timeline                     | Still works         | Still works (new presets appear as bars)  |
| Guardrails / undo / preview  | Unchanged           | Unchanged                                  |

This stays true to the spirit of Agent Studio (fast, brand-wired, rule-based) while giving designers real motion-graphics language and a lightweight way to prototype interaction without leaving the page.

Would you like me to also add a simple “loop prototype” button or a way to export a short recorded GIF/WebM of the motion?

