'use strict';
/**
 * brand-identity.js — the Brand identity workspace.
 *
 * Wires the brand-pack API into the studio: import a scraped brand-kit ZIP,
 * show the group and each brand's palette / type / voice / guidelines, and
 * create a real composition from the initial template set.
 *
 * The heavy lifting (schema + template builders) lives in brand-pack.js; this
 * file is DOM only.
 */
(function () {
    const API = 'api/brand-packs';
    const CORE = window.StudioBrand;
    const state = {
        packs: [],
        pack: null,
        brandId: null,
        tab: 'identity',
        loading: false,
        loaded: false,
        busy: false,
        error: '',
    };
    let root = null;

    // -----------------------------------------------------------------
    // Tiny DOM helpers
    // -----------------------------------------------------------------
    function $(id) {
        return document.getElementById(id);
    }

    function append(container, children) {
        (Array.isArray(children) ? children : [children]).forEach((child) => {
            if (child === null || child === undefined || child === false) return;
            if (Array.isArray(child)) append(container, child);
            else if (typeof child === 'string') container.appendChild(document.createTextNode(child));
            else container.appendChild(child);
        });
        return container;
    }

    function h(tag, props, children) {
        const node = document.createElement(tag);
        if (props) {
            Object.keys(props).forEach((key) => {
                const value = props[key];
                if (value === undefined || value === null || value === false) return;
                if (key === 'class') node.className = value;
                else if (key === 'text') node.textContent = value;
                else if (key === 'dataset') Object.assign(node.dataset, value);
                else if (key === 'style') {
                    Object.keys(value).forEach((property) => {
                        if (value[property] === undefined || value[property] === null) return;
                        if (property.startsWith('--')) node.style.setProperty(property, String(value[property]));
                        else node.style[property] = String(value[property]);
                    });
                } else if (key === 'onClick') node.addEventListener('click', value);
                else if (key === 'onChange') node.addEventListener('change', value);
                else node.setAttribute(key, value === true ? '' : String(value));
            });
        }
        if (children !== undefined) append(node, children);
        return node;
    }

    function hexSwatch(value) {
        return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#000000';
    }

    function setStatus(message, { error = false, busy = false } = {}) {
        const target = $('brandStatus');
        if (target) {
            target.textContent = message || '';
            target.dataset.error = String(Boolean(error));
            target.dataset.busy = String(Boolean(busy));
        }
        if (error && !message) target.textContent = '';
    }

    function studio() {
        return window.layerStudio || null;
    }

    function packById(id) {
        return state.packs.find((pack) => pack.id === id) || null;
    }

    function currentBrand() {
        if (!state.pack) return null;
        if (state.brandId) {
            const found = state.pack.brands.find((brand) => brand.id === state.brandId);
            if (found) return found;
        }
        return state.pack.brands[0] || null;
    }

    // -----------------------------------------------------------------
    // API
    // -----------------------------------------------------------------
    async function request(path, options) {
        const response = await fetch(path, { cache: 'no-store', ...(options || {}) });
        let data = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }
        if (!response.ok) throw new Error(data?.error || `The studio backend returned ${response.status}.`);
        return data;
    }

    async function fetchPacks() {
        const data = await request(API);
        state.packs = Array.isArray(data?.packs) ? data.packs : [];
        return state.packs;
    }

    async function fetchPack(id) {
        const data = await request(`${API}/${encodeURIComponent(id)}`);
        if (!data?.pack) throw new Error('The brand pack could not be read.');
        return data.pack;
    }

    async function ensureLoaded({ force = false } = {}) {
        if (state.loading) return;
        if (state.loaded && !force && state.packs.length) return;
        state.loading = true;
        try {
            await fetchPacks();
            state.loaded = true;
            state.error = '';
            if (state.pack && state.packs.some((pack) => pack.id === state.pack.id)) {
                state.pack = await fetchPack(state.pack.id).catch(() => state.pack);
            } else if (!state.pack && state.packs.length) {
                state.pack = await fetchPack(state.packs[0].id).catch(() => null);
                state.brandId = state.pack?.brands?.[0]?.id || null;
            }
        } catch (error) {
            state.loaded = true;
            state.error = error.message || 'Brand packs are unavailable.';
        } finally {
            state.loading = false;
        }
        renderSidebar();
    }

    async function selectPack(id) {
        if (!id) {
            state.pack = null;
            state.brandId = null;
            renderAll();
            return;
        }
        setStatus('Loading brand pack…', { busy: true });
        try {
            state.pack = await fetchPack(id);
            state.brandId = state.pack?.brands?.[0]?.id || null;
            state.error = '';
            renderAll();
            setStatus('');
        } catch (error) {
            setStatus(error.message || 'Could not load the brand pack.', { error: true });
        }
    }

    // -----------------------------------------------------------------
    // Sidebar
    // -----------------------------------------------------------------
    function renderSidebar() {
        const summary = $('brandSidebarSummary');
        const chips = $('brandSidebarChips');
        if (!summary || !chips) return;
        chips.replaceChildren();
        const pack = state.pack || (state.packs.length ? packById(state.packs[0].id) : null);
        if (state.error && !state.packs.length) {
            summary.textContent = 'Brand packs need the local server.';
            return;
        }
        if (!pack) {
            summary.textContent = state.packs.length
                ? `${state.packs.length} brand pack${state.packs.length === 1 ? '' : 's'} available.`
                : 'No brand pack imported yet.';
            return;
        }
        const brands = pack.brands || [];
        summary.textContent = `${pack.name} · ${brands.length} brand${brands.length === 1 ? '' : 's'}`;
        brands.slice(0, 8).forEach((brand) => {
            const swatch = brand.palette?.[1]?.hex || brand.palette?.[0]?.hex || '#ffffff';
            chips.appendChild(h('button', {
                type: 'button',
                class: 'brand-sidebar-chip',
                'data-brand-action': 'open-brand',
                'data-brand-id': brand.id,
                'data-brand-pack': pack.id,
                title: brand.tagline || brand.name,
            }, [
                h('i', { style: { background: hexSwatch(swatch) } }),
                h('span', { text: brand.name }),
            ]));
        });
    }

    // -----------------------------------------------------------------
    // Dialog
    // -----------------------------------------------------------------
    function openDialog({ brandId = null, tab = null } = {}) {
        ensureLoaded().then(() => {
            if (brandId && state.pack) {
                state.brandId = brandId;
            } else if (state.pack && !state.brandId) {
                state.brandId = state.pack.brands[0]?.id || null;
            }
            if (tab) state.tab = tab;
            renderAll();
        });
        const dialog = $('brandIdentityDialog');
        if (dialog && !dialog.open) {
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else dialog.setAttribute('open', '');
        }
        setStatus('');
    }

    function closeDialog() {
        const dialog = $('brandIdentityDialog');
        if (!dialog) return;
        if (dialog.open) dialog.close();
        else dialog.removeAttribute('open');
    }

    function renderAll() {
        renderSidebar();
        renderDialog();
    }

    function renderDialog() {
        const summary = $('brandIdentitySummary');
        const empty = $('brandEmptyState');
        const workspace = $('brandWorkspace');
        const select = $('brandPackSelect');
        const meta = $('brandPackMeta');
        const tabs = $('brandTabs');
        const detail = $('brandDetail');
        if (!summary || !empty || !workspace || !select || !tabs || !detail) return;

        select.replaceChildren();
        if (!state.packs.length) {
            select.appendChild(new Option('No packs imported', ''));
            select.disabled = true;
        } else {
            select.disabled = false;
            state.packs.forEach((pack) => {
                select.appendChild(new Option(`${pack.name} (${pack.brandCount} brands)`, pack.id));
            });
            select.value = state.pack?.id || state.packs[0].id;
        }

        if (!state.pack) {
            summary.textContent = state.error
                ? state.error
                : 'Import a brand-kit ZIP to read its palettes, type, guidelines and templates.';
            empty.hidden = false;
            workspace.hidden = true;
            if (meta) meta.textContent = '';
            return;
        }

        const brands = state.pack.brands || [];
        summary.textContent = `${state.pack.name} · ${brands.length} brand${brands.length === 1 ? '' : 's'} · ${state.pack.portfolio?.assets?.length || 0} group assets`;
        if (meta) {
            const warnings = state.pack.meta?.warnings || [];
            meta.textContent = warnings.length
                ? `${warnings.length} import warning${warnings.length === 1 ? '' : 's'}`
                : (state.pack.createdAt ? `Imported ${state.pack.createdAt.slice(0, 10)}` : '');
            meta.title = warnings.join('\n');
        }
        empty.hidden = true;
        workspace.hidden = false;

        tabs.replaceChildren();
        tabs.appendChild(h('button', {
            type: 'button',
            class: 'brand-tab',
            'data-brand-tab': '__pack__',
            'aria-selected': String(!state.brandId),
        }, [
            h('span', { text: 'Group' }),
        ]));
        brands.forEach((brand) => {
            const swatch = brand.palette?.[1]?.hex || brand.palette?.[0]?.hex || '#ffffff';
            tabs.appendChild(h('button', {
                type: 'button',
                class: 'brand-tab',
                'data-brand-tab': brand.id,
                'aria-selected': String(state.brandId === brand.id),
            }, [
                h('span', { class: 'brand-tab-swatch', style: { background: hexSwatch(swatch) } }),
                h('span', { text: brand.name }),
            ]));
        });
        tabs.appendChild(h('div', { class: 'brand-panel-actions' }, [
            h('button', {
                type: 'button',
                class: 'brand-button',
                'data-brand-action': 'refresh',
                title: 'Reload the pack list from disk',
            }, 'Refresh'),
            h('button', {
                type: 'button',
                class: 'brand-button',
                'data-brand-action': 'delete-pack',
                title: 'Delete this pack from data/brand-packs',
            }, 'Delete pack'),
        ]));

        detail.replaceChildren();
        if (state.brandId) detail.appendChild(renderDetailSectionTabs());
        const brand = currentBrand();
        if (!brand || !state.brandId) {
            detail.appendChild(renderPackTab());
        } else if (state.tab === 'templates') {
            detail.appendChild(renderTemplates(brand));
        } else if (state.tab === 'guidelines') {
            detail.appendChild(renderGuidelines(brand));
        } else {
            detail.appendChild(renderIdentity(brand));
        }
    }

    function renderDetailSectionTabs() {
        const tabs = [
            ['identity', 'Identity'],
            ['templates', 'Templates'],
            ['guidelines', 'Guidelines'],
        ];
        return h('div', { class: 'brand-detail-section-tabs', role: 'tablist', 'aria-label': 'Brand detail' }, tabs.map(([id, label]) => h('button', {
            type: 'button',
            role: 'tab',
            'data-brand-section': id,
            'aria-selected': String(state.tab === id),
            text: label,
        })));
    }

    // -----------------------------------------------------------------
    // Panels
    // -----------------------------------------------------------------
    function renderPackTab() {
        const pack = state.pack;
        if (!pack) return h('div');
        const portfolio = pack.portfolio || {};
        const panel = h('div', { class: 'brand-pack-overview' });
        panel.appendChild(h('div', { class: 'brand-card' }, [
            h('header', null, [
                h('h4', { text: pack.name }),
                h('span', { class: 'brand-count', text: `${pack.brands.length} brands` }),
            ]),
            h('p', { class: 'brand-pack-summary', text: portfolio.summary || pack.description || 'No group summary in the pack.' }),
            portfolio.docUrl ? h('p', null, [
                h('a', { href: portfolio.docUrl, target: '_blank', rel: 'noopener', text: `Open ${portfolio.docTitle || 'the group guide'} (.docx)` }),
            ]) : null,
        ]));

        panel.appendChild(h('div', { class: 'brand-brand-cards' }, pack.brands.map((brand) => h('button', {
            type: 'button',
            class: 'brand-brand-card',
            'data-brand-tab': brand.id,
            'aria-label': `Open ${brand.name}`,
        }, [
            h('div', {
                class: 'brand-brand-cover',
                style: brand.cover ? { backgroundImage: `url("${String(brand.cover).replace(/"/g, '%22')}")` } : { background: brand.palette?.[0]?.hex || '#1a1920' },
            }),
            h('div', { class: 'brand-brand-body' }, [
                h('strong', { text: brand.name }),
                h('span', { text: brand.tagline || brand.wordmark || '' }),
                h('span', { class: 'brand-chips' }, brand.palette.slice(0, 5).map((entry) => h('i', {
                    style: {
                        display: 'inline-block',
                        width: '12px',
                        height: '12px',
                        marginRight: '3px',
                        borderRadius: '50%',
                        background: hexSwatch(entry.hex),
                    },
                }))),
            ]),
        ]))));

        if (portfolio.assets?.length) {
            panel.appendChild(h('div', { class: 'brand-card' }, [
                h('header', null, [h('h4', { text: 'Group assets' }), h('span', { class: 'brand-count', text: String(portfolio.assets.length) })]),
                h('div', { class: 'brand-photo-grid' }, portfolio.assets.map((asset) => h('a', {
                    href: asset.url,
                    target: '_blank',
                    rel: 'noopener',
                    title: asset.name,
                }, [h('img', { src: asset.url, alt: asset.name, loading: 'lazy' })]))),
            ]));
        }

        const applications = portfolio.guidelines?.applications || [];
        if (applications.length) {
            panel.appendChild(renderApplications(applications, 'The group’s applications'));
        }
        return panel;
    }

    function renderIdentity(brand) {
        const panel = h('div', { class: 'brand-panel' });
        panel.appendChild(renderHero(brand));
        const grid = h('div', { class: 'brand-grid' });
        grid.appendChild(renderPalette(brand));
        grid.appendChild(renderType(brand));
        grid.appendChild(renderVoice(brand));
        grid.appendChild(renderLogos(brand));
        if (brand.photography?.length) grid.appendChild(renderPhotography(brand));
        if (brand.paletteImages?.length || brand.typeSpecimens?.length) grid.appendChild(renderSpecimens(brand));
        panel.appendChild(grid);
        return panel;
    }

    function renderHero(brand) {
        const coverStyle = brand.cover
            ? { backgroundImage: `url("${String(brand.cover).replace(/"/g, '%22')}")` }
            : { background: brand.palette?.[0]?.hex || '#1a1920' };
        const facts = [
            brand.url ? brand.url.replace(/^https?:\/\//, '') : '',
            brand.version ? `v${brand.version}` : '',
            brand.captured ? `captured ${brand.captured}` : '',
            brand.tokensPath ? 'tokens' : '',
        ].filter(Boolean);
        const hero = h('div', { class: 'brand-hero' }, [
            h('div', { class: 'brand-hero-copy' }, [
                h('h3', { text: brand.name }),
                h('p', { class: 'brand-tagline', text: brand.tagline || brand.wordmark || '' }),
                h('div', { class: 'brand-facts' }, facts.map((fact) => h('span', { text: fact }))),
                h('div', { class: 'brand-actions', style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' } }, [
                    h('button', {
                        type: 'button',
                        class: 'brand-primary',
                        'data-brand-action': 'create-template',
                        'data-template-id': 'menu',
                    }, 'Create a menu'),
                    h('button', {
                        type: 'button',
                        'data-brand-action': 'attach-kit',
                    }, 'Attach brand kit'),
                    brand.guidelines?.docUrl
                        ? h('a', { href: brand.guidelines.docUrl, target: '_blank', rel: 'noopener' }, 'Open guide (.docx)')
                        : null,
                ]),
            ]),
            h('div', { class: 'brand-hero-cover', style: coverStyle }),
        ]);
        const strip = h('div', { class: 'brand-swatch-strip' }, brand.palette.slice(0, 10).map((entry) => h('span', {
            style: { background: hexSwatch(entry.hex) },
            title: `${entry.name} ${entry.hex}`,
        })));
        return h('div', null, [hero, strip]);
    }

    function renderPalette(brand) {
        return h('section', { class: 'brand-card' }, [
            h('header', null, [
                h('h4', { text: 'Palette' }),
                h('span', { class: 'brand-count', text: `${brand.palette.length} colours` }),
            ]),
            h('div', { class: 'brand-swatches' }, brand.palette.map((entry) => h('button', {
                type: 'button',
                class: 'brand-swatch',
                'data-brand-copy': entry.hex,
                title: `${entry.role || entry.name} — click to copy ${entry.hex}`,
            }, [
                h('span', { class: 'brand-swatch-chip', style: { background: hexSwatch(entry.hex) } }),
                h('span', { class: 'brand-swatch-name', text: entry.name }),
                h('span', {
                    class: 'brand-swatch-meta',
                    text: `${entry.hex}${entry.share ? ` · ${entry.share}%` : ''}${entry.tier === 'secondary' ? ' · secondary' : ''}`,
                }),
            ]))),
        ]);
    }

    function renderType(brand) {
        const families = brand.typography?.families || [];
        const scale = brand.typography?.scale || [];
        return h('section', { class: 'brand-card' }, [
            h('header', null, [
                h('h4', { text: 'Typography' }),
                h('span', { class: 'brand-count', text: `${families.length} families` }),
            ]),
            h('div', { class: 'brand-type-row' }, [
                h('span', { text: 'Family' }),
                h('span', { text: 'Cut' }),
                h('span', { text: 'Weight' }),
            ]),
            ...families.map((family) => h('div', { class: 'brand-type-row' }, [
                h('span', { text: family }),
                h('span', { text: familyCut(family) }),
                h('span', { text: String(familyWeight(family)) }),
            ])),
            scale.length
                ? h('div', { style: { marginTop: '10px' } }, [
                    h('div', { class: 'brand-type-scale-row' }, [
                        h('span', { text: 'Step' }),
                        h('span', { text: 'Family' }),
                        h('span', { text: 'Size' }),
                    ]),
                    ...scale.slice(0, 12).map((entry) => h('div', { class: 'brand-type-scale-row' }, [
                        h('span', { text: entry.id }),
                        h('span', { text: entry.family || '' }),
                        h('span', { text: entry.size || (entry.px ? `${entry.px}px` : '') }),
                    ])),
                ])
                : null,
            h('p', {
                style: { marginTop: '10px' },
                text: 'Families are named from the guide. Templates use Helvetica Neue / Georgia stand-ins; upload the licensed binaries and relink for exact typesetting.',
            }),
        ]);
    }

    function familyWeight(family) {
        const text = String(family || '').toLowerCase();
        if (/thin|hairline/.test(text)) return 200;
        if (/extra\s*light|extralight/.test(text)) return 200;
        if (/semi\s*bold|demibold/.test(text)) return 600;
        if (/black|heavy/.test(text)) return 800;
        if (/bold/.test(text)) return 700;
        if (/medium/.test(text)) return 500;
        if (/light/.test(text)) return 300;
        return 400;
    }

    function familyCut(family) {
        const text = String(family || '');
        if (/extra\s*light|extralight/i.test(text)) return 'Extra light';
        if (/thin|hairline/i.test(text)) return 'Thin';
        if (/light/i.test(text)) return 'Light';
        if (/black|heavy/i.test(text)) return 'Black';
        if (/bold/i.test(text)) return 'Bold';
        if (/medium/i.test(text)) return 'Medium';
        return 'Regular';
    }

    function renderVoice(brand) {
        const voice = brand.voice || { attributes: [], prefer: [], avoid: [] };
        return h('section', { class: 'brand-card' }, [
            h('header', null, [h('h4', { text: 'Voice' }), h('span', { class: 'brand-count', text: `${voice.attributes.length} attributes` })]),
            voice.attributes.length ? h('div', { class: 'brand-chips' }, voice.attributes.map((item) => h('span', { class: 'brand-chip', text: item }))) : null,
            voice.prefer.length ? h('div', { style: { marginTop: '9px' } }, [
                h('p', { text: 'Words we use' }),
                h('div', { class: 'brand-chips' }, voice.prefer.slice(0, 14).map((item) => h('span', { class: 'brand-chip', 'data-tone': 'prefer', text: item }))),
            ]) : null,
            voice.avoid.length ? h('div', { style: { marginTop: '9px' } }, [
                h('p', { text: 'Words we avoid' }),
                h('div', { class: 'brand-chips' }, voice.avoid.slice(0, 14).map((item) => h('span', { class: 'brand-chip', 'data-tone': 'avoid', text: item }))),
            ]) : null,
        ]);
    }

    function renderLogos(brand) {
        const logos = (brand.logos || []).filter((logo) => !logo.presentation);
        const presentation = (brand.logos || []).filter((logo) => logo.presentation);
        return h('section', { class: 'brand-card' }, [
            h('header', null, [
                h('h4', { text: 'Logo files' }),
                h('span', { class: 'brand-count', text: `${logos.length} cuts${presentation.length ? ` · ${presentation.length} plate` : ''}` }),
            ]),
            logos.length
                ? h('div', { class: 'brand-logos' }, logos.map((logo) => h('div', {
                    class: 'brand-logo-tile',
                    title: logo.url,
                }, [
                    h('img', { src: logo.url, alt: logo.name, loading: 'lazy' }),
                    h('span', { text: `${logo.variant} · ${logo.kind}${logo.format ? ` · ${logo.format}` : ''}` }),
                ])))
                : h('p', { text: 'No logo files in the pack.' }),
        ]);
    }

    function renderPhotography(brand) {
        return h('section', { class: 'brand-card' }, [
            h('header', null, [
                h('h4', { text: 'Photography' }),
                h('span', { class: 'brand-count', text: `${brand.photography.length} images` }),
            ]),
            h('div', { class: 'brand-photo-grid' }, brand.photography.map((photo) => h('a', {
                href: photo.url,
                target: '_blank',
                rel: 'noopener',
                title: photo.name,
            }, [h('img', { src: photo.url, alt: photo.name, loading: 'lazy' })]))),
        ]);
    }

    function renderSpecimens(brand) {
        const assets = [...(brand.paletteImages || []), ...(brand.typeSpecimens || [])];
        if (!assets.length) return null;
        return h('section', { class: 'brand-card' }, [
            h('header', null, [
                h('h4', { text: 'Specimens' }),
                h('span', { class: 'brand-count', text: `${assets.length} images` }),
            ]),
            h('div', { class: 'brand-photo-grid' }, assets.map((asset) => h('a', {
                href: asset.url,
                target: '_blank',
                rel: 'noopener',
                title: asset.name,
            }, [h('img', { src: asset.url, alt: asset.name, loading: 'lazy' })]))),
        ]);
    }

    function renderGuidelines(brand) {
        const guide = brand.guidelines || {};
        const panel = h('div', { class: 'brand-panel' });
        if (guide.positioning) {
            panel.appendChild(h('section', { class: 'brand-card' }, [
                h('header', null, [h('h4', { text: 'Positioning' })]),
                h('p', { text: guide.positioning }),
            ]));
        }
        if (guide.applications?.length) panel.appendChild(renderApplications(guide.applications, 'Applications'));
        if (guide.printSpec?.length || guide.contact?.length || guide.logoRules?.length || guide.typeHierarchy?.length) {
            const grid = h('div', { class: 'brand-grid' });
            if (guide.printSpec?.length) grid.appendChild(renderPairs('Print specification', guide.printSpec, 'item', 'specification'));
            if (guide.contact?.length) grid.appendChild(renderPairs('Contact block', guide.contact, 'field', 'value'));
            if (guide.logoRules?.length) grid.appendChild(renderPairs('Logo rules', guide.logoRules, 'rule', 'specification'));
            if (guide.typeHierarchy?.length) grid.appendChild(renderTypeHierarchy(guide.typeHierarchy));
            panel.appendChild(grid);
        }
        if (guide.sections?.length) {
            panel.appendChild(renderDocSections(guide));
        }
        if (!panel.childNodes.length) {
            panel.appendChild(h('div', { class: 'brand-card' }, [
                h('h4', { text: 'No guide in this pack' }),
                h('p', { text: 'Add a *Brand-Guide.docx next to the brand tokens and re-import to read its application matrix and contact block.' }),
            ]));
        }
        return panel;
    }

    function renderApplications(applications, title) {
        const rows = applications.slice(0, 20);
        return h('section', { class: 'brand-card' }, [
            h('header', null, [
                h('h4', { text: title }),
                h('span', { class: 'brand-count', text: `${applications.length} rows` }),
            ]),
            h('div', { class: 'brand-guideline-list' }, rows.map((row) => h('div', { class: 'brand-guideline' }, [
                h('strong', { text: row.application }),
                row.specification ? h('p', { text: row.specification }) : null,
                row.scope ? h('span', { text: row.scope }) : null,
            ]))),
        ]);
    }

    function renderPairs(title, pairs, firstKey, secondKey) {
        return h('section', { class: 'brand-card' }, [
            h('header', null, [h('h4', { text: title }), h('span', { class: 'brand-count', text: String(pairs.length) })]),
            h('div', { class: 'brand-pairs' }, pairs.map((pair) => h('div', { class: 'brand-pair' }, [
                h('span', { text: pair[firstKey] || pair.field || pair.item || pair.rule || '' }),
                h('span', { text: pair[secondKey] || pair.value || pair.specification || '' }),
            ]))),
        ]);
    }

    function renderTypeHierarchy(rows) {
        return h('section', { class: 'brand-card' }, [
            h('header', null, [h('h4', { text: 'Type hierarchy' }), h('span', { class: 'brand-count', text: String(rows.length) })]),
            h('div', null, rows.slice(0, 14).map((row) => h('div', { class: 'brand-guideline' }, [
                h('strong', { text: row.role }),
                h('p', { text: `${row.typeface}${row.size ? ` · ${row.size}` : ''}` }),
                row.notes ? h('span', { text: row.notes }) : null,
            ]))),
        ]);
    }

    function renderDocSections(guide) {
        const sections = guide.sections.filter((section) => section.heading || section.paragraphs.length || section.tables.length);
        return h('section', { class: 'brand-card' }, [
            h('header', null, [
                h('h4', { text: 'The guide' }),
                h('span', { class: 'brand-count', text: `${sections.length} sections` }),
            ]),
            guide.docUrl ? h('p', { style: { marginBottom: '8px' } }, [
                h('a', { href: guide.docUrl, target: '_blank', rel: 'noopener', text: 'Open the source document (.docx)' }),
            ]) : null,
            h('div', { class: 'brand-doc-sections' }, sections.slice(0, 40).map((section) => h('details', null, [
                h('summary', { text: `${'·'.repeat(Math.max(0, section.level - 1))} ${section.heading || 'Untitled section'}` }),
                h('div', { class: 'brand-doc-body' }, [
                    ...section.paragraphs.map((paragraph) => h('p', { text: paragraph })),
                    ...section.tables.map((table) => h('p', {
                        text: [table.head.join(' · '), ...table.rows.map((row) => row.join(' · '))].join(' — '),
                    })),
                ]),
            ]))),
        ]);
    }

    // -----------------------------------------------------------------
    // Templates
    // -----------------------------------------------------------------
    function renderTemplates(brand) {
        const catalog = CORE ? CORE.templateCatalog(brand) : [];
        const panel = h('div', { class: 'brand-panel' });
        panel.appendChild(h('div', { class: 'brand-card' }, [
            h('header', null, [
                h('h4', { text: 'Initial templates' }),
                h('span', { class: 'brand-count', text: `${catalog.length} templates` }),
            ]),
            h('p', {
                text: 'Each template is a real composition: variables, formats and the brand kit are already attached. Create one and edit it like any other scene.',
            }),
            h('p', {
                text: 'Licensed families do not travel with the pack. Templates use Helvetica Neue / Georgia as explicit stand-ins and record the intended family in the composition metadata; upload the real fonts and relink when they are available.',
            }),
        ]));
        const grid = h('div', { class: 'brand-templates' });
        catalog.forEach((template) => {
            const definition = CORE?.TEMPLATES?.find((entry) => entry.id === template.id);
            let composition = null;
            if (CORE && definition) {
                try {
                    composition = CORE.createTemplateComposition({
                        packId: state.pack.id,
                        packName: state.pack.name,
                        brand,
                        templateId: template.id,
                        projectId: 'preview',
                    });
                } catch {
                    composition = null;
                }
            }
            const card = h('article', { class: 'brand-template' }, [
                renderTemplatePreview(composition),
                h('h4', { text: template.label }),
                h('span', { class: 'brand-template-spec', text: template.spec }),
                h('p', { class: 'brand-template-description', text: template.description }),
                template.guideline
                    ? h('p', { class: 'brand-template-guideline', text: template.guideline.specification })
                    : null,
                h('div', { class: 'brand-template-actions' }, [
                    h('button', {
                        type: 'button',
                        class: 'brand-primary',
                        'data-brand-action': 'create-template',
                        'data-template-id': template.id,
                    }, 'Create'),
                    h('button', {
                        type: 'button',
                        'data-brand-action': 'attach-kit',
                    }, 'Use kit'),
                    h('span', { class: 'brand-template-formats', text: template.formats.length ? `${1 + template.formats.length} formats` : '1 format' }),
                ]),
            ]);
            grid.appendChild(card);
        });
        panel.appendChild(grid);
        return panel;
    }

    function renderTemplatePreview(composition) {
        const box = h('div', { class: 'brand-preview' });
        if (!composition || !composition.layers?.length) {
            box.appendChild(h('div', { class: 'brand-preview-empty', text: 'No preview' }));
            return box;
        }
        const maxWidth = 240;
        const maxHeight = 190;
        const scale = Math.min(maxWidth / composition.width, maxHeight / composition.height);
        const width = Math.max(20, Math.round(composition.width * scale));
        const height = Math.max(20, Math.round(composition.height * scale));
        const canvas = h('div', {
            class: 'brand-preview-canvas',
            style: { width: `${width}px`, height: `${height}px` },
        });
        canvas.style.background = composition.meta?.palette?.ground || '#000000';
        composition.layers.slice().sort((a, b) => a.z - b.z).forEach((layer) => {
            const geometry = {
                left: `${layer.x}%`,
                top: `${layer.y}%`,
                width: `${layer.w}%`,
                height: `${layer.h}%`,
                zIndex: String(layer.z),
            };
            if (layer.type === 'text') {
                const fontSize = Math.max(1, (height * Number(layer.font?.sizePct || 3)) / 100);
                const node = h('div', {
                    class: 'brand-preview-layer brand-preview-text',
                    style: {
                        ...geometry,
                        color: layer.color,
                        fontFamily: `"${String(layer.font?.family || 'Inter').replace(/"/g, '')}", sans-serif`,
                        fontWeight: String(layer.font?.weight || 400),
                        fontStyle: layer.font?.style || 'normal',
                        fontSize: `${fontSize}px`,
                        lineHeight: String(layer.font?.lineHeight || 1.2),
                        letterSpacing: `${Number(layer.font?.letterSpacingEm || 0)}em`,
                        textTransform: layer.font?.transform || 'none',
                        textAlign: layer.align || 'left',
                        alignItems: layer.verticalAlign === 'top' ? 'flex-start' : (layer.verticalAlign === 'bottom' ? 'flex-end' : 'center'),
                        opacity: String(layer.opacity ?? 1),
                    },
                }, [h('span', { text: layer.text || '' })]);
                canvas.appendChild(node);
            } else {
                const url = String(layer.url || '');
                if (!url) return;
                canvas.appendChild(h('div', {
                    class: 'brand-preview-layer',
                    style: {
                        ...geometry,
                        backgroundImage: `url("${url.replace(/"/g, '%22')}")`,
                        backgroundSize: layer.fit === 'contain' ? 'contain' : 'cover',
                        opacity: String(layer.opacity ?? 1),
                    },
                }));
            }
        });
        box.appendChild(canvas);
        return box;
    }

    // -----------------------------------------------------------------
    // Actions
    // -----------------------------------------------------------------
    async function importZip(file) {
        if (!file) return;
        if (!/\.zip$/i.test(file.name || '')) {
            setStatus('Choose a .zip of the brand-kit folder.', { error: true });
            return;
        }
        openDialog();
        state.busy = true;
        renderBusy();
        setStatus(`Reading ${file.name}…`, { busy: true });
        try {
            const dataUrl = await readFileAsDataUrl(file);
            setStatus('Reading tokens, guides and brand assets…', { busy: true });
            const data = await request(`${API}/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ zip: dataUrl, zipName: file.name }),
            });
            const pack = data?.pack;
            if (!pack) throw new Error('The import returned no pack.');
            state.packs = [data.summary, ...state.packs.filter((entry) => entry.id !== pack.id)];
            state.pack = pack;
            state.brandId = pack.brands[0]?.id || null;
            state.tab = 'identity';
            state.error = '';
            state.loaded = true;
            renderAll();
            const counts = pack.brands.map((brand) => brand.name).join(', ');
            setStatus(`Imported “${pack.name}” — ${counts}.`);
        } catch (error) {
            setStatus(error.message || 'Could not import the brand pack.', { error: true });
        } finally {
            state.busy = false;
            renderBusy();
        }
    }

    async function createTemplate(templateId) {
        const brand = currentBrand();
        const studioRef = studio();
        if (!state.pack || !brand || !CORE) {
            setStatus('Import a brand pack first.', { error: true });
            return;
        }
        if (!studioRef) {
            setStatus('The studio is still loading. Try again in a moment.', { error: true });
            return;
        }
        state.busy = true;
        renderBusy();
        setStatus(`Building ${templateId} for ${brand.name}…`, { busy: true });
        try {
            const result = await request(`${API}/${encodeURIComponent(state.pack.id)}/templates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ brandId: brand.id, templateId }),
            });
            if (!result?.composition) throw new Error('The template returned no composition.');
            studioRef.openComposition(result.composition, {
                projectId: result.project.id,
                projectMeta: result.composition.meta || null,
            });
            studioRef.loadProjectCatalog({ selectProjectId: `import-${result.project.id}` }).catch(() => {});
            closeDialog();
            studioRef.setStatus(`Created “${result.project.name}” — ${result.project.width} × ${result.project.height}, ${result.composition.layers.length} layers.`);
        } catch (error) {
            setStatus(error.message || 'Could not create the template.', { error: true });
        } finally {
            state.busy = false;
            renderBusy();
        }
    }

    async function attachKit() {
        const brand = currentBrand();
        const studioRef = studio();
        if (!brand) return;
        if (!studioRef?.composition) {
            setStatus('Open a composition first.', { error: true });
            return;
        }
        try {
            let kit = null;
            if (brand.brandKitId) {
                const data = await request(`api/brand-kits/${encodeURIComponent(brand.brandKitId)}`).catch(() => null);
                kit = data?.kit || null;
            }
            if (!kit && CORE) kit = CORE.brandKitFor(brand);
            if (!kit) throw new Error('This brand has no palette, fonts or logos to attach.');
            studioRef.composition.brandKit = kit;
            studioRef.composition.brandKitId = brand.brandKitId || null;
            studioRef.render();
            studioRef.scheduleSave();
            studioRef.setStatus(`Attached the ${brand.name} brand kit (${kit.palette.length} colours, ${kit.fonts.length} fonts).`);
            setStatus(`Attached “${kit.name}” to this composition.`);
        } catch (error) {
            setStatus(error.message || 'Could not attach the brand kit.', { error: true });
        }
    }

    async function deletePack() {
        if (!state.pack) return;
        const pack = state.pack;
        if (!window.confirm(`Delete the brand pack “${pack.name}” from disk? Its shared kits are removed; compositions keep their embedded snapshots and templates keep their copied assets.`)) return;
        setStatus('Deleting…', { busy: true });
        try {
            await request(`${API}/${encodeURIComponent(pack.id)}`, { method: 'DELETE' });
            state.packs = state.packs.filter((entry) => entry.id !== pack.id);
            state.pack = null;
            state.brandId = null;
            if (state.packs.length) {
                state.pack = await fetchPack(state.packs[0].id).catch(() => null);
                state.brandId = state.pack?.brands?.[0]?.id || null;
            }
            renderAll();
            setStatus('Brand pack deleted.');
        } catch (error) {
            setStatus(error.message || 'Could not delete the pack.', { error: true });
        }
    }

    function copyText(value) {
        const textValue = String(value || '');
        if (!textValue) return;
        const done = () => setStatus(`Copied ${textValue}.`);
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(textValue).then(done).catch(() => setStatus(textValue));
            return;
        }
        setStatus(textValue);
    }

    function renderBusy() {
        document.querySelectorAll('[data-brand-action="create-template"], [data-brand-action="import"], [data-brand-action="delete-pack"]').forEach((button) => {
            button.disabled = state.busy;
        });
        const submit = $('brandPackZipInput');
        if (submit) submit.disabled = state.busy;
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Could not read the ZIP.'));
            reader.readAsDataURL(file);
        });
    }

    // -----------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------
    function onDocumentClick(event) {
        const copy = event.target.closest('[data-brand-copy]');
        if (copy) {
            copyText(copy.dataset.brandCopy);
            return;
        }
        const action = event.target.closest('[data-brand-action]');
        if (!action) return;
        const kind = action.dataset.brandAction;
        if (kind === 'open') {
            event.preventDefault();
            openDialog();
        } else if (kind === 'open-brand') {
            event.preventDefault();
            const packId = action.dataset.brandPack || null;
            const brandId = action.dataset.brandId || null;
            if (packId && state.pack?.id !== packId) {
                selectPack(packId).then(() => openDialog({ brandId }));
            } else {
                openDialog({ brandId });
            }
        } else if (kind === 'import') {
            event.preventDefault();
            openDialog();
            $('brandPackZipInput')?.click();
        } else if (kind === 'close') {
            event.preventDefault();
            closeDialog();
        } else if (kind === 'refresh') {
            event.preventDefault();
            ensureLoaded({ force: true }).then(() => setStatus('Brand packs refreshed.'));
        } else if (kind === 'delete-pack') {
            event.preventDefault();
            deletePack();
        } else if (kind === 'create-template') {
            event.preventDefault();
            createTemplate(action.dataset.templateId || 'menu');
        } else if (kind === 'attach-kit') {
            event.preventDefault();
            attachKit();
        }
    }

    function onDialogClick(event) {
        const tab = event.target.closest('[data-brand-tab]');
        if (tab) {
            event.preventDefault();
            const value = tab.dataset.brandTab;
            if (value === '__pack__') {
                state.brandId = null;
            } else {
                state.brandId = value;
                state.tab = 'identity';
            }
            renderDialog();
            return;
        }
        const section = event.target.closest('[data-brand-section]');
        if (section) {
            event.preventDefault();
            state.tab = section.dataset.brandSection;
            renderDialog();
        }
    }

    function bind() {
        root = $('layerStudioView') || document.body;
        document.addEventListener('click', onDocumentClick);
        const dialog = $('brandIdentityDialog');
        if (dialog) dialog.addEventListener('click', onDialogClick);
        const select = $('brandPackSelect');
        if (select) {
            select.addEventListener('change', () => selectPack(select.value));
        }
        const input = $('brandPackZipInput');
        if (input) {
            input.addEventListener('change', () => {
                const file = input.files?.[0] || null;
                input.value = '';
                importZip(file);
            });
        }
        const dialogClose = $('brandIdentityDialog');
        if (dialogClose) {
            dialogClose.addEventListener('close', () => setStatus(''));
        }
        renderSidebar();
        ensureLoaded();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind, { once: true });
    } else {
        bind();
    }

    window.brandIdentity = {
        open: openDialog,
        close: closeDialog,
        refresh: () => ensureLoaded({ force: true }),
        state,
    };
}());
