'use strict';
/**
 * social.js — Business social intelligence page.
 *
 * DOM only. The server has already normalised the crawler's business.profile.json
 * into channels, reputation, themes, voice and deterministic actions.
 */
(function () {
    const state = { sources: [], dataset: null, loading: false, error: '' };
    const $ = (id) => document.getElementById(id);

    const TONES = {
        risk: 'Attention',
        thin: 'Thin evidence',
        strong: 'Healthy',
        steady: 'Steady',
        empty: 'No evidence',
    };
    const SCORE_LABELS = {
        overall: 'Overall',
        reputation: 'Reputation',
        social_strength: 'Social strength',
        content_health: 'Content health',
        discoverability: 'Discoverability',
    };
    const number = new Intl.NumberFormat('en-GB');
    const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });

    function h(tag, props, children) {
        const node = document.createElement(tag);
        if (props) {
            Object.entries(props).forEach(([key, value]) => {
                if (value === undefined || value === null || value === false) return;
                if (key === 'class') node.className = value;
                else if (key === 'text') node.textContent = value;
                else if (key === 'dataset') Object.assign(node.dataset, value);
                else if (key === 'style') Object.assign(node.style, value);
                else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
                else if (value === true) node.setAttribute(key, '');
                else node.setAttribute(key, String(value));
            });
        }
        (Array.isArray(children) ? children : [children]).forEach((child) => {
            if (child === null || child === undefined || child === false) return;
            if (child instanceof Node) node.appendChild(child);
            else node.appendChild(document.createTextNode(String(child)));
        });
        return node;
    }

    const fmt = (value, fallback = '—') => (value === null || value === undefined ? fallback : number.format(value));
    const short = (value, fallback = '—') => (value === null || value === undefined ? fallback : compact.format(value));
    const pct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;
    const clean = (value) => String(value ?? '').replace(/[ \t]+/g, ' ').trim();
    const safeUrl = (value) => (/^https?:\/\//i.test(String(value || '')) ? String(value) : '');
    const truncate = (value, max = 280) => {
        const text = clean(value);
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    };

    async function api(path) {
        const response = await fetch(path, { cache: 'no-store', headers: { Accept: 'application/json' } });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || `The studio returned ${response.status}.`);
        return data;
    }

    function showEmpty(message) {
        $('socialContent').hidden = true;
        $('socialEmpty').hidden = false;
        if (message) {
            const node = $('socialEmpty').querySelector('strong');
            if (node) node.textContent = message;
        }
    }

    async function loadSources({ force = false } = {}) {
        if (state.loading) return;
        state.loading = true;
        try {
            const payload = await api(`/api/social/sources${force ? '?refresh=1' : ''}`);
            state.sources = payload.sources || [];
            const select = $('socialSource');
            select.textContent = '';
            if (!state.sources.length) {
                select.appendChild(h('option', { value: '', text: 'No social profiles found' }));
                showEmpty('No social profile has been scraped yet.');
                return;
            }
            state.sources.forEach((source) => select.appendChild(h('option', {
                value: source.id,
                text: `${source.label}${source.group ? ` — ${source.group}` : ''}`,
            })));
            const params = new URLSearchParams(location.search);
            let dataset = null;
            if (params.get('id') && state.sources.some((source) => source.id === params.get('id'))) {
                dataset = await loadDataset(params.get('id'));
            } else if (params.get('brandId') || params.get('name')) {
                const match = await api(`/api/social/by-brand?brandId=${encodeURIComponent(params.get('brandId') || '')}&name=${encodeURIComponent(params.get('name') || '')}`);
                dataset = match.dataset;
            }
            if (!dataset) dataset = await loadDataset(state.sources[0].id);
            select.value = dataset?.id || state.sources[0].id;
            render(dataset);
        } catch (error) {
            state.error = error.message;
            showEmpty(error.message);
        } finally {
            state.loading = false;
        }
    }

    async function loadDataset(id) {
        if (!id) return null;
        const payload = await api(`/api/social/${encodeURIComponent(id)}`);
        state.dataset = payload.dataset;
        const url = new URL(location.href);
        url.searchParams.set('id', id);
        url.searchParams.delete('brandId');
        url.searchParams.delete('name');
        history.replaceState({}, '', url);
        return state.dataset;
    }

    async function selectSource(id) {
        try {
            const dataset = await loadDataset(id);
            render(dataset);
        } catch (error) {
            showEmpty(error.message);
        }
    }

    function render(dataset) {
        if (!dataset) { showEmpty('No usable social profile was returned.'); return; }
        $('socialEmpty').hidden = true;
        $('socialContent').hidden = false;
        renderMeta(dataset);
        renderPosture(dataset);
        renderMetrics(dataset);
        renderScores(dataset);
        renderFootprint(dataset);
        renderPublishing(dataset);
        renderReputation(dataset);
        renderThemes(dataset);
        renderVoice(dataset);
        renderActions(dataset);
        renderEvidence(dataset);
    }

    function renderMeta(dataset) {
        $('socialBusinessMeta').textContent = [
            dataset.business.name,
            dataset.business.category,
            [dataset.business.city, dataset.business.region].filter(Boolean).join(', '),
        ].filter(Boolean).join(' · ');
        $('socialSourceMeta').textContent = [
            dataset.group ? `Group: ${dataset.group}` : '',
            dataset.kind === 'scraped' ? 'Curated scrape' : (dataset.kind === 'pack' ? 'Brand pack social folder' : 'Crawler run'),
            dataset.generatedAt ? `Scraped ${dataset.generatedAt.slice(0, 10)}` : '',
        ].filter(Boolean).join(' · ');
    }

    function renderPosture(dataset) {
        const intel = dataset.intelligence || {};
        const box = $('posture');
        box.dataset.tone = intel.tone || 'empty';
        $('postureTone').textContent = TONES[intel.tone] || 'Reading';
        $('postureTitle').textContent = intel.title || 'No reading yet';
        $('postureSummary').textContent = intel.summary || '';
        const strengths = $('postureStrengths');
        strengths.textContent = '';
        (dataset.signals?.strengths || []).slice(0, 4).forEach((item) => {
            strengths.appendChild(h('span', { text: truncate(item, 110) }));
        });
    }

    function renderMetrics(dataset) {
        const grid = $('metricGrid');
        grid.textContent = '';
        const intel = dataset.intelligence || {};
        const channels = dataset.channels || [];
        const present = channels.filter((channel) => channel.present).length;
        const cards = [
            ['Audience', short(intel.totalFollowers), `${number.format(intel.totalFollowers || 0)} followers across ${present} channel${present === 1 ? '' : 's'}`],
            ['Consensus rating', dataset.reputation?.rating == null ? '—' : `${dataset.reputation.rating.toFixed(1)}★`, `${fmt(dataset.reputation?.totalReviews)} total reviews`],
            ['Reviews read', fmt(dataset.reputation?.collectedReviews), `${pct(intel.reviewDepth?.share || 0)} of the published count`],
            ['Channels', `${present}/${dataset.totals?.platformsConfigured || channels.length}`, intel.missingChannels ? `${intel.missingChannels} tracked gap${intel.missingChannels === 1 ? '' : 's'}` : 'No tracked gaps'],
        ];
        cards.forEach(([label, value, detail]) => {
            grid.appendChild(h('article', { class: 'metric-card' }, [
                h('strong', { text: String(value) }),
                h('span', { text: label }),
                h('small', { text: detail }),
            ]));
        });
    }

    function renderScores(dataset) {
        const rows = $('scoreRows');
        rows.textContent = '';
        const scores = dataset.scores || {};
        const entries = Object.keys(SCORE_LABELS).filter((key) => scores[key] !== null && scores[key] !== undefined);
        if (!entries.length) {
            rows.appendChild(h('p', { class: 'empty-note', text: 'The crawler did not return signal scores for this profile.' }));
            return;
        }
        entries.forEach((key) => {
            const value = Number(scores[key]) || 0;
            rows.appendChild(h('div', { class: 'score-row', dataset: { low: value < 50 ? '1' : '0' } }, [
                h('div', { class: 'score-row-head' }, [h('span', { text: SCORE_LABELS[key] }), h('b', { text: String(Math.round(value)) })]),
                h('div', { class: 'score-track' }, h('i', { style: { width: `${Math.max(2, Math.min(100, value))}%` } })),
            ]));
        });
    }

    function renderFootprint(dataset) {
        const grid = $('channelGrid');
        grid.textContent = '';
        const channels = dataset.channels || [];
        if (!channels.length) {
            grid.appendChild(h('div', { class: 'empty-note', text: 'No social channels were returned. The gaps line below is the whole footprint.' }));
        }
        channels.forEach((channel) => {
            const card = h('article', { class: `channel-card${channel.present ? '' : ' is-missing'}` }, [
                h('div', { class: 'channel-head' }, [
                    h('h3', { text: channel.label }),
                    safeUrl(channel.url) ? h('a', { href: safeUrl(channel.url), target: '_blank', rel: 'noopener', text: 'Open ↗' }) : null,
                ]),
                h('div', { class: 'channel-handle', text: channel.handle ? `@${channel.handle.replace(/^@/, '')}` : (channel.present ? 'Profile found' : 'Not found') }),
                h('div', { class: 'channel-stats' }, [
                    h('div', null, [h('strong', { text: short(channel.followers) }), h('span', { text: 'followers' })]),
                    h('div', null, [h('strong', { text: short(channel.posts) }), h('span', { text: 'posts' })]),
                    h('div', null, [h('strong', { text: fmt(channel.postsCollected) }), h('span', { text: 'read' })]),
                ]),
                channel.bio ? h('div', { class: 'channel-bio', text: channel.bio }) : null,
                channel.completeness !== null ? h('div', { class: 'channel-completeness' }, [
                    h('div', { class: 'channel-completeness-head' }, [h('span', { text: 'Profile completeness' }), h('span', { text: pct(channel.completeness) })]),
                    h('div', { class: 'score-track' }, h('i', { style: { width: `${Math.round(channel.completeness * 100)}%` } })),
                ]) : null,
                ...channel.warnings.slice(0, 2).map((warning) => h('div', { class: 'channel-warning', text: truncate(warning, 240) })),
            ]);
            grid.appendChild(card);
        });

        const note = $('footprintNote');
        const consistency = dataset.handleConsistency;
        note.textContent = consistency === null || consistency === undefined
            ? 'The crawler did not score handle consistency.'
            : `Handle consistency ${pct(consistency)}${dataset.handles?.instagram ? ` · @${dataset.handles.instagram}` : ''}`;
        const gap = $('gapLine');
        gap.textContent = '';
        if ((dataset.gaps || []).length) {
            gap.appendChild(h('strong', { text: 'Tracked gaps' }));
            dataset.gaps.forEach((item) => gap.appendChild(h('span', { text: item })));
        } else {
            gap.appendChild(h('strong', { class: 'gap-ok', text: 'No tracked channel gaps.' }));
        }
    }

    function bar(label, share, valueLabel) {
        return h('div', { class: 'mix-row' }, [
            h('span', { class: 'mix-label', text: label }),
            h('div', { class: 'score-track' }, h('i', { style: { width: `${Math.max(2, Math.round((Number(share) || 0) * 100))}%` } })),
            h('span', { class: 'mix-value', text: valueLabel }),
        ]);
    }

    function renderPublishing(dataset) {
        const body = $('publishingBody');
        body.textContent = '';
        const mix = dataset.contentMix || [];
        const cadence = dataset.cadence || [];
        const hashtags = dataset.hashtags || [];

        body.appendChild(h('div', { class: 'publishing-block' }, [
            h('div', { class: 'block-label', text: 'Content mix' }),
            ...(mix.length ? mix.map((entry) => bar(entry.type, entry.share, fmt(entry.count))) : [h('div', { class: 'empty-note', text: 'No post-level content mix was readable. The crawler preserved profile metrics and review evidence instead.' })]),
        ]));

        const rhythmRows = [];
        cadence.slice(0, 6).forEach((entry) => rhythmRows.push([entry.key, fmt(entry.count)]));
        if (dataset.latestActivity) rhythmRows.unshift(['Latest activity', dataset.latestActivity]);
        if (dataset.reputation?.velocity?.reviewsPerMonth != null) rhythmRows.push(['Reviews / month', fmt(dataset.reputation.velocity.reviewsPerMonth)]);
        if (dataset.reputation?.velocity?.latestReview) rhythmRows.push(['Latest review', dataset.reputation.velocity.latestReview]);
        body.appendChild(h('div', { class: 'publishing-block' }, [
            h('div', { class: 'block-label', text: 'Rhythm' }),
            rhythmRows.length
                ? h('ul', { class: 'plain-list' }, rhythmRows.map(([label, value]) => h('li', null, [h('span', { text: label }), h('b', { text: value })])))
                : h('div', { class: 'empty-note', text: 'No cadence was available. This is common for public profile scrapes without post dates.' }),
        ]));

        body.appendChild(h('div', { class: 'publishing-block' }, [
            h('div', { class: 'block-label', text: 'Hashtags and keywords' }),
            hashtags.length
                ? h('div', { class: 'keyword-cloud' }, hashtags.slice(0, 18).map((tag) => h('span', { text: tag.count ? `#${tag.tag.replace(/^#/, '')} · ${tag.count}` : `#${tag.tag.replace(/^#/, '')}` })))
                : h('div', { class: 'empty-note', text: 'No hashtag or keyword sample was returned.' }),
        ]));
    }

    function stars(rating) {
        const value = Number(rating) || 0;
        const full = Math.round(value);
        return `${'★'.repeat(Math.max(0, Math.min(5, full)))}${'☆'.repeat(Math.max(0, 5 - full))}`;
    }

    function renderReputation(dataset) {
        const body = $('reputationBody');
        body.textContent = '';
        const reputation = dataset.reputation || {};
        if (reputation.rating == null && !reputation.totalReviews) {
            body.appendChild(h('div', { class: 'empty-note', text: 'No review source was reachable. Do not present a rating you cannot source.' }));
            return;
        }
        const summary = h('div', { class: 'reputation-summary' });
        summary.appendChild(h('div', { class: 'rating-block' }, [
            h('strong', { text: reputation.rating == null ? '—' : reputation.rating.toFixed(1) }),
            h('div', { class: 'stars', text: stars(reputation.rating) }),
            h('span', { text: `${fmt(reputation.totalReviews)} total reviews · ${fmt(reputation.collectedReviews)} read` }),
        ]));
        const distribution = h('div');
        const total = Object.values(reputation.distribution || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
        ['5', '4', '3', '2', '1'].forEach((star) => {
            const count = Number(reputation.distribution?.[star] || 0);
            distribution.appendChild(h('div', { class: 'distribution-row' }, [
                h('span', { text: `${star}★` }),
                h('div', { class: 'score-track' }, h('i', { style: { width: `${total ? Math.max(1, Math.round((count / total) * 100)) : 0}%` } })),
                h('span', { text: fmt(count) }),
            ]));
        });
        summary.appendChild(distribution);
        body.appendChild(summary);

        const sentiment = reputation.sentiment || {};
        body.appendChild(h('div', { class: 'sentiment-row' }, [
            h('div', { class: 'sentiment-cell positive' }, [h('strong', { text: fmt(sentiment.positive) }), h('span', { text: 'positive' })]),
            h('div', { class: 'sentiment-cell' }, [h('strong', { text: fmt(sentiment.neutral) }), h('span', { text: 'neutral' })]),
            h('div', { class: 'sentiment-cell negative' }, [h('strong', { text: fmt(sentiment.negative) }), h('span', { text: 'negative' })]),
        ]));

        const owner = reputation.ownerResponseRate;
        const details = [
            ['Owner responses', owner == null ? '—' : pct(owner)],
            ['Reviews / month', fmt(reputation.velocity?.reviewsPerMonth)],
            ['Sources', String(reputation.sources?.length || 0)],
            ['Languages', Object.keys(reputation.languages || {}).join(', ') || '—'],
        ];
        body.appendChild(h('div', { class: 'reputation-details' }, details.map(([label, value]) => h('div', { class: 'detail-cell' }, [h('strong', { text: value }), h('span', { text: label })]))));

        const sources = h('div', { class: 'source-list' });
        (reputation.sources || []).forEach((source) => {
            sources.appendChild(h('div', { class: 'source-row' }, [
                h('span', null, [h('b', { text: source.label }), source.warnings?.[0] ? h('small', { text: ` · ${truncate(source.warnings[0], 90)}` }) : null]),
                h('span', { text: source.rating == null ? `${fmt(source.collected)} read` : `${source.rating.toFixed(1)}★ · ${fmt(source.count)}` }),
            ]));
        });
        if (sources.children.length) body.appendChild(sources);

        const quotes = [...(reputation.best || []).slice(0, 1), ...(reputation.worst || []).slice(0, 1)];
        if (quotes.length) {
            body.appendChild(h('div', { class: 'quote-grid' }, quotes.map((quote, index) => h('article', { class: `quote-card${index === 1 ? ' is-worst' : ''}` }, [
                h('div', { class: 'quote-head' }, [h('b', { text: quote.author || 'Guest' }), h('span', { text: quote.rating == null ? quote.source : `${quote.rating.toFixed(1)}★ · ${quote.source}` })]),
                h('p', { text: truncate(quote.excerpt, 260) }),
                h('footer', { text: [quote.date, quote.ownerResponse ? 'owner replied' : 'no owner reply'].filter(Boolean).join(' · ') }),
            ]))));
        }
    }

    function renderThemes(dataset) {
        const grid = $('themeGrid');
        grid.textContent = '';
        const themes = dataset.reputation?.themes || [];
        $('themesNote').textContent = themes.length ? `${themes.length} recurring themes · sorted by mentions` : '';
        if (!themes.length) {
            grid.appendChild(h('div', { class: 'empty-note', text: 'No recurring theme was extracted. Review text may be too thin or the source blocked detail.' }));
            return;
        }
        themes.forEach((theme) => {
            const total = Math.max(1, theme.mentions);
            const pos = Math.round((theme.positive / total) * 100);
            const neg = Math.round((theme.negative / total) * 100);
            const neu = Math.max(0, 100 - pos - neg);
            const sample = theme.samples?.[0];
            grid.appendChild(h('article', { class: 'theme-card' }, [
                h('div', { class: 'theme-head' }, [
                    h('h3', { text: theme.name }),
                    h('span', { class: `theme-net ${theme.netSentiment > 0.15 ? 'positive' : theme.netSentiment < -0.15 ? 'negative' : ''}`, text: `${theme.netSentiment > 0 ? '+' : ''}${theme.netSentiment.toFixed(2)}` }),
                ]),
                h('div', { class: 'theme-meter' }, [
                    h('i', { class: 'pos', style: { width: `${pos}%` } }),
                    h('i', { class: 'neu', style: { width: `${neu}%` } }),
                    h('i', { class: 'neg', style: { width: `${neg}%` } }),
                ]),
                h('div', { class: 'theme-meta' }, [h('span', { text: `${theme.mentions} mentions` }), h('span', { text: `${theme.positive} + / ${theme.negative} −` })]),
                sample ? h('div', { class: 'theme-quote', text: `“${truncate(sample.snippet, 180)}”` }) : null,
            ]));
        });
    }

    function renderVoice(dataset) {
        const grid = $('voiceGrid');
        grid.textContent = '';
        const voice = dataset.voice || {};
        const bioChannel = (dataset.channels || []).find((channel) => channel.bio);
        const left = h('div');
        left.appendChild(h('div', { class: 'block-label', text: 'Words the evidence keeps using' }));
        left.appendChild(h('div', { class: 'keyword-cloud' }, (voice.keywords || []).length
            ? voice.keywords.map((keyword) => h('span', { text: keyword }))
            : [h('span', { text: 'No voice sample' })]));
        if (bioChannel) {
            left.appendChild(h('div', { class: 'block-label', text: 'Profile bio', style: { marginTop: '12px' } }));
            left.appendChild(h('div', { class: 'channel-bio', text: bioChannel.bio, style: { maxHeight: 'none' } }));
        }
        (voice.samples || []).slice(0, 3).forEach((sample) => {
            left.appendChild(h('div', { class: 'voice-sample', text: `“${truncate(sample, 260)}”`, small: null }));
        });
        if (!voice.samples?.length && !bioChannel) {
            left.appendChild(h('div', { class: 'empty-note', text: 'No voice sample was returned. The page does not invent one.' }));
        }
        grid.appendChild(left);

        const side = h('div', { class: 'voice-side' });
        const identity = dataset.identity || {};
        const rows = [
            ['Website', safeUrl(dataset.business.website) ? h('a', { href: safeUrl(dataset.business.website), target: '_blank', rel: 'noopener', text: 'Visit ↗' }) : '—'],
            ['Address', identity.address || '—'],
            ['Phone', identity.phone || '—'],
            ['Identity match', identity.consistency == null ? '—' : pct(identity.consistency)],
            ['Online booking', dataset.web?.hasOnlineBooking ? 'Found' : 'Not found'],
        ];
        rows.forEach(([label, value]) => side.appendChild(h('div', { class: 'identity-row' }, [h('span', { text: label }), typeof value === 'string' ? h('b', { text: value }) : value])));
        if (dataset.voice?.hashtags?.length) {
            side.appendChild(h('div', { class: 'block-label', text: 'Hashtags', style: { marginTop: '6px' } }));
            side.appendChild(h('div', { class: 'keyword-cloud' }, dataset.voice.hashtags.map((tag) => h('span', { text: `#${String(tag).replace(/^#/, '')}` }))));
        }
        grid.appendChild(side);
    }

    function renderActions(dataset) {
        const grid = $('actionGrid');
        grid.textContent = '';
        const actions = dataset.intelligence?.actions || [];
        if (!actions.length) {
            grid.appendChild(h('div', { class: 'empty-note', text: 'No evidence-backed action crossed the threshold. Keep the profile as a baseline and rescan after a campaign.' }));
        }
        actions.forEach((action) => grid.appendChild(h('article', { class: 'action-card', dataset: { severity: action.severity } }, [
            h('div', { class: 'action-head' }, [h('span', { class: 'severity', text: action.severity }), h('h3', { text: action.title })]),
            h('p', { text: action.detail }),
        ])));

        const opportunities = $('opportunityList');
        opportunities.textContent = '';
        const items = dataset.signals?.opportunities || [];
        if (items.length) {
            opportunities.appendChild(h('div', { class: 'block-label', text: 'From the crawler’s opportunity list' }));
            items.slice(0, 5).forEach((item) => opportunities.appendChild(h('p', { text: item })));
        }
    }

    function renderEvidence(dataset) {
        const body = $('evidenceBody');
        body.textContent = '';
        const source = dataset.source || {};
        const grid = h('div', { class: 'evidence-grid' });
        [
            ['Profile', source.file || '—'],
            ['Source', `${source.kind || dataset.kind || 'unknown'} · ${source.modifiedAt ? source.modifiedAt.slice(0, 19).replace('T', ' ') : 'unknown time'}`],
            ['Business slug', dataset.business.slug || '—'],
            ['Group', dataset.group || '—'],
            ['Generated', dataset.generatedAt || '—'],
            ['Channels read', String(dataset.channels?.length || 0)],
        ].forEach(([label, value]) => grid.appendChild(h('div', { class: 'evidence-card' }, [h('strong', { text: label }), h('code', { text: value })])));
        body.appendChild(grid);

        const warnings = dataset.warnings || [];
        if (warnings.length) {
            body.appendChild(h('div', { class: 'evidence-warnings' }, warnings.slice(0, 8).map((warning) => h('div', { class: 'evidence-warning' }, [
                h('b', { text: warning.scope || 'Source warning' }),
                h('span', { text: truncate(warning.warning, 300) }),
            ]))));
        }
        body.appendChild(h('p', { class: 'section-note', text: 'What this does not prove: a public profile is not a customer base, and a readable review sample is not a statistically robust sentiment study. The page reports the evidence and its gaps.', style: { marginTop: '10px', textAlign: 'left', maxWidth: '780px' } }));
    }

    function bind() {
        $('socialSource').addEventListener('change', (event) => selectSource(event.target.value));
        $('socialRefresh').addEventListener('click', () => loadSources({ force: true }));
    }

    async function init() {
        bind();
        await loadSources();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
