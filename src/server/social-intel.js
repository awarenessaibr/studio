/**
 * social-intel.js — shared normaliser and deterministic reading of a scraped
 * business social profile. No network, no LLM, no dependencies.
 *
 * Input is the crawler's `business.profile.json` (plus optional
 * `social.tokens.json`). Output is what the Social intelligence page renders:
 * channels, reputation, themes, voice and a small set of evidence-backed actions.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SocialIntel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const SCHEMA = 'studio/social-intelligence/v1';
    const CHANNELS = ['instagram', 'facebook', 'tiktok', 'youtube', 'google', 'tripadvisor', 'website'];
    const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

    const num = (value) => {
        if (value === null || value === undefined || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };
    const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
    const arr = (value) => (Array.isArray(value) ? value : []);
    const obj = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    const pct = (value) => {
        const n = num(value);
        return n === null ? 0 : Math.max(0, Math.min(1, n));
    };

    function channelList(social) {
        const matrix = arr(social.matrix);
        const bySource = new Map();
        for (const entry of matrix) {
            if (!entry || typeof entry !== 'object') continue;
            const source = text(entry.source || entry.label, 40).toLowerCase();
            if (!source) continue;
            bySource.set(source, entry);
        }
        const channels = [];
        for (const [source, entry] of bySource.entries()) {
            const completeness = num(obj(social.completeness)[source]);
            channels.push({
                source,
                label: text(entry.label || source, 60),
                url: text(entry.url, 500),
                present: Boolean(entry.present),
                handle: text(entry.handle, 120),
                followers: num(entry.followers),
                following: num(entry.following),
                posts: num(entry.posts),
                likes: num(entry.likes),
                checkins: num(entry.checkins),
                verified: entry.verified === true,
                bio: text(entry.bio, 800),
                category: text(entry.category, 80),
                lastPost: text(entry.last_post, 80),
                daysSincePost: num(entry.days_since_post),
                postsCollected: num(entry.posts_collected) || 0,
                mode: text(entry.mode, 40),
                completeness: completeness === null ? null : pct(completeness),
                warnings: arr(entry.warnings).map((warning) => text(warning, 500)).filter(Boolean),
            });
        }
        channels.sort((a, b) => Number(b.present) - Number(a.present) || (b.followers || 0) - (a.followers || 0));
        return channels;
    }

    function sourceList(reputation) {
        return Object.entries(obj(reputation.sources)).map(([source, entry]) => ({
            source,
            label: text(entry.label || source, 80),
            rating: num(entry.rating),
            count: num(entry.count),
            collected: num(entry.collected) || 0,
            mode: text(entry.mode, 40),
            url: text(entry.url, 500),
            distribution: normaliseDistribution(entry.distribution),
            warnings: arr(entry.warnings).map((warning) => text(warning, 500)).filter(Boolean),
        })).sort((a, b) => (b.count || 0) - (a.count || 0));
    }

    function normaliseDistribution(value) {
        const source = obj(value);
        const out = {};
        for (const star of ['1', '2', '3', '4', '5']) {
            const n = num(source[star]);
            if (n !== null) out[star] = n;
        }
        return out;
    }

    function themeList(reputation) {
        return Object.entries(obj(reputation.themes)).map(([name, entry]) => {
            const samples = arr(entry.samples).map((sample) => ({
                snippet: text(sample.snippet || sample.text, 600),
                rating: num(sample.rating),
                source: text(sample.source, 40),
            })).filter((sample) => sample.snippet);
            return {
                name: text(name, 80),
                mentions: num(entry.mentions) || 0,
                positive: num(entry.positive) || 0,
                negative: num(entry.negative) || 0,
                neutral: num(entry.neutral) || 0,
                netSentiment: num(entry.net_sentiment) || 0,
                samples,
            };
        }).sort((a, b) => b.mentions - a.mentions || a.netSentiment - b.netSentiment);
    }

    function contentMixList(social) {
        return Object.entries(obj(social.content_mix)).map(([type, entry]) => ({
            type,
            count: num(entry.count) || 0,
            share: pct(entry.share),
        })).sort((a, b) => b.count - a.count);
    }

    function cadenceList(social) {
        if (Array.isArray(social.cadence)) {
            return social.cadence.map((entry) => ({ key: text(entry.key || entry.period, 40), count: num(entry.count) || 0 }));
        }
        return Object.entries(obj(social.cadence)).map(([key, count]) => ({ key, count: num(count) || 0 }));
    }

    function hashtagList(social, tokens) {
        const source = arr(social.hashtags).length ? social.hashtags : arr(tokens.topHashtags);
        return source.map((entry) => {
            if (typeof entry === 'string') return { tag: entry, count: null };
            return { tag: text(entry.tag || entry.name || entry.hashtag, 60), count: num(entry.count) };
        }).filter((entry) => entry.tag);
    }

    function voiceData(tokens, reputation) {
        const voice = obj(tokens.voice);
        const keywords = arr(voice.topKeywords).length ? voice.topKeywords : arr(reputation.topics).map((entry) => entry.label);
        return {
            keywords: keywords.map((keyword) => text(keyword, 60)).filter(Boolean).slice(0, 24),
            samples: arr(voice.samples).map((sample) => text(sample, 800)).filter(Boolean).slice(0, 6),
            hashtags: arr(voice.topHashtags).map((tag) => text(tag, 60)).filter(Boolean),
        };
    }

    function normaliseProfile(profile, meta = {}) {
        const source = obj(profile);
        const business = obj(source.business);
        const social = obj(source.social);
        const reputation = obj(source.reputation);
        const identity = obj(source.identity);
        const web = obj(source.web);
        const tokens = obj(meta.tokens);
        const channels = channelList(social);
        const sources = sourceList(reputation);
        const themes = themeList(reputation);
        const distribution = normaliseDistribution(reputation.distribution);
        const reviewTotal = num(reputation.total_reviews);
        const collected = num(reputation.collected_reviews);
        const sentiment = obj(reputation.sentiment);
        const notables = obj(reputation.notable);
        const reviewList = arr(reputation.reviews).length ? arr(reputation.reviews) : arr(obj(reputation.notable).reviews);
        const intelligence = buildIntelligence({
            business, social, reputation, identity, web,
            channels, sources, themes, distribution,
            tokens, reviewTotal, collected, sentiment,
        });
        const dataset = {
            schema: SCHEMA,
            id: text(meta.id, 120),
            kind: text(meta.kind, 30),
            file: text(meta.file, 500),
            generatedAt: text(source.generated_at, 40),
            group: text(source.group, 120),
            business: {
                name: text(business.name || business.slug || 'Untitled business', 160),
                slug: text(business.slug, 120),
                city: text(business.city, 80),
                region: text(business.region, 80),
                country: text(business.country, 80),
                category: text(business.category, 80),
                website: text(business.website, 500),
                aliases: arr(business.aliases).map((alias) => text(alias, 120)).filter(Boolean),
            },
            scores: Object.fromEntries(Object.entries(obj(source.scores)).map(([key, value]) => [key, num(value)])),
            identity: {
                address: text(obj(identity.canonical).address, 300),
                phone: text(obj(identity.canonical).phone, 80),
                email: text(arr(obj(identity.canonical).emails)[0], 160),
                consistency: num(identity.consistency),
                conflicts: arr(identity.conflicts).map((conflict) => ({
                    field: text(conflict.field, 40),
                    variants: arr(conflict.variants).map((variant) => text(variant, 200)).filter(Boolean),
                })),
            },
            web: {
                hasOnlineBooking: web.has_online_booking === true,
                hasOnlineDelivery: web.has_online_delivery === true,
                hasMenuOnline: web.has_menu_online === true,
                pagesCrawled: num(web.pages_crawled),
                tech: arr(web.tech).map((item) => text(item, 40)).filter(Boolean),
                mentions: num(web.mention_count) || 0,
            },
            channels,
            totals: {
                followers: num(obj(social.totals).followers) || 0,
                platformsPresent: num(obj(social.totals).platforms_present) || channels.filter((channel) => channel.present).length,
                platformsConfigured: num(obj(social.totals).platforms_configured) || channels.length,
            },
            gaps: arr(social.gaps).map((gap) => text(gap, 40)).filter(Boolean),
            handles: obj(social.handles),
            handleConsistency: num(social.handle_consistency),
            completeness: Object.fromEntries(Object.entries(obj(social.completeness)).map(([key, value]) => [key, pct(value)])),
            latestActivity: text(social.latest_activity, 80),
            stalePlatforms: arr(social.stale_platforms).map((item) => text(item, 40)).filter(Boolean),
            activePlatforms: arr(social.active_platforms).map((item) => text(item, 40)).filter(Boolean),
            cadence: cadenceList(social),
            contentMix: contentMixList(social),
            hashtags: hashtagList(social, tokens),
            engagement: obj(social.engagement),
            reputation: {
                rating: num(reputation.consensus_rating),
                meanRating: num(reputation.simple_mean_rating),
                totalReviews: reviewTotal,
                collectedReviews: collected,
                sources,
                sourcesPresent: arr(reputation.sources_present).map((item) => text(item, 40)).filter(Boolean),
                distribution,
                sentiment: {
                    mean: num(sentiment.mean),
                    positive: num(sentiment.positive) || 0,
                    neutral: num(sentiment.neutral) || 0,
                    negative: num(sentiment.negative) || 0,
                    positiveShare: pct(sentiment.positive_share),
                    negativeShare: pct(sentiment.negative_share),
                },
                velocity: {
                    reviewsPerMonth: num(obj(reputation.velocity).reviews_per_month),
                    monthsCovered: num(obj(reputation.velocity).months_covered),
                    latestReview: text(obj(reputation.velocity).latest_review, 40),
                    byMonth: obj(obj(reputation.velocity).by_month),
                },
                ownerResponseRate: num(reputation.owner_response_rate),
                languages: Object.fromEntries(Object.entries(obj(reputation.languages)).map(([key, value]) => [key, num(value) || 0])),
                themes,
                topics: arr(reputation.topics).map((topic) => ({
                    label: text(topic.label, 60),
                    mentions: num(topic.mentions) || 0,
                    source: text(topic.source, 40),
                })).filter((topic) => topic.label),
                best: arr(notables.best).map(normaliseReview).filter(Boolean),
                worst: arr(notables.worst).map(normaliseReview).filter(Boolean),
                reviews: reviewList.map(normaliseReview).filter(Boolean),
                redFlags: arr(reputation.red_flags).map((flag) => text(flag, 300)).filter(Boolean),
            },
            voice: voiceData(tokens, reputation),
            signals: {
                strengths: arr(obj(source.signals).strengths).map((item) => text(item, 300)).filter(Boolean),
                weaknesses: arr(obj(source.signals).weaknesses).map((item) => text(item, 300)).filter(Boolean),
                opportunities: arr(obj(source.signals).opportunities).map((item) => text(item, 300)).filter(Boolean),
                risks: arr(obj(source.signals).risks).map((item) => text(item, 300)).filter(Boolean),
            },
            intelligence,
            warnings: [
                ...channels.flatMap((channel) => channel.warnings.map((warning) => ({ scope: channel.label, warning }))),
                ...sources.flatMap((source) => source.warnings.map((warning) => ({ scope: source.label, warning }))),
            ].slice(0, 24),
        };
        return dataset;
    }

    function normaliseReview(review) {
        if (!review || typeof review !== 'object') return null;
        const textValue = text(review.text, 1200);
        if (!textValue) return null;
        const ownerReply = review.owner_response;
        const ownerResponseText = typeof ownerReply === 'string'
            ? text(ownerReply, 2000)
            : (ownerReply && typeof ownerReply === 'object' && typeof ownerReply.text === 'string'
                ? text(ownerReply.text, 2000)
                : '');
        return {
            source: text(review.source, 40),
            author: text(review.author, 120),
            rating: num(review.rating),
            date: text(review.date, 40),
            excerpt: textValue,
            sentiment: num(review.sentiment),
            ownerResponse: Boolean(ownerResponseText),
            ownerResponseText,
        };
    }

    function buildIntelligence(ctx) {
        const { business, social, reputation, web, channels, sources, themes, distribution, reviewTotal, collected, sentiment } = ctx;
        const totalFollowers = Math.max(
            channels.reduce((sum, channel) => sum + (channel.followers || 0), 0),
            Number(obj(social.totals).followers) || 0,
        );
        const present = channels.filter((channel) => channel.present);
        const gaps = arr(social.gaps);
        const rating = num(reputation.consensus_rating);
        const negativeShare = pct(sentiment.negative_share);
        const ownerRate = num(reputation.owner_response_rate);
        const actions = [];
        const add = (code, severity, title, detail) => {
            if (!actions.some((action) => action.code === code)) actions.push({ code, severity, title, detail });
        };

        const negativeTheme = themes.find((theme) => theme.mentions >= 2 && theme.netSentiment <= -0.2);
        if (negativeTheme) {
            add('NEGATIVE_THEME', 'high', `Repair the “${negativeTheme.name}” theme`,
                `${negativeTheme.mentions} mentions, net sentiment ${negativeTheme.netSentiment.toFixed(2)}. Read the quoted reviews before changing the offer.`);
        }
        if (rating !== null && rating < 4) {
            add('RATING_BELOW_COMFORT', 'high', `Lift the ${rating.toFixed(1)}★ consensus rating`,
                `${reviewTotal ?? 'Unknown'} total reviews. The 4.2 threshold is a working heuristic, not a verdict.`);
        }
        if (ownerRate === 0 && (reviewTotal || 0) > 0) {
            add('NO_OWNER_RESPONSES', 'high', 'Start replying to reviews',
                'No owner responses were visible in the collected reviews. Replies are evidence of an operating business, not just marketing.');
        }
        if ((reviewTotal || 0) >= 20 && (collected || 0) < 10) {
            add('THIN_REVIEW_DEPTH', 'medium', `Only ${collected || 0} of ${reviewTotal} reviews were readable`,
                'Treat sentiment and themes as indicative. The full review source needs an API key or a browser session.');
        }
        if (gaps.length) {
            add('CHANNEL_GAP', 'medium', `No presence on ${gaps.join(', ')}`,
                'Open the channel only if the business can sustain it; an abandoned profile is worse than a missing one.');
        }
        const consistency = num(social.handle_consistency);
        if (present.length > 1 && consistency !== null && consistency < 0.5) {
            add('HANDLE_DRIFT', 'medium', 'The handles do not line up',
                `Handle consistency is ${Math.round(consistency * 100)}%. Use one handle across channels so a customer can find the next profile.`);
        }
        if (arr(social.stale_platforms).length) {
            add('STALE_CHANNEL', 'medium', `Stale channel: ${arr(social.stale_platforms).join(', ')}`,
                'The crawler found a profile but no recent activity. Either refresh it or remove it from the directory links.');
        }
        if (web.has_online_booking === false) {
            add('NO_ONLINE_BOOKING', 'low', 'Add a direct booking path',
                'No booking provider was found. This is conversion, not social reach, but it is the next practical step.');
        }
        if (!sources.length) {
            add('NO_REVIEW_SOURCE', 'medium', 'No review source was reachable',
                'The social profile has no reputation evidence. Do not present a rating you cannot source.');
        }
        if (!present.length) {
            add('NO_SOCIAL_CHANNEL', 'high', 'No social channel found',
                'The business may be offline-first. Confirm before proposing a channel strategy.');
        }
        actions.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

        let tone = 'steady';
        let title = 'A real footprint, with gaps';
        let summary = 'There is enough public evidence to describe the business, but the picture is not complete.';
        if (!present.length && rating === null) {
            tone = 'empty';
            title = 'No usable social evidence yet';
            summary = 'The crawler did not return a social channel or a review source. Do not infer a voice from an empty file.';
        } else if (negativeShare >= 0.3 || (rating !== null && rating < 4) || actions.some((action) => action.severity === 'high')) {
            tone = 'risk';
            title = 'The reputation needs attention';
            summary = 'The footprint is real, but the rating, sentiment or response behaviour contains a clear risk. Read the source reviews before acting.';
        } else if ((collected || 0) < 10 || present.length <= 1) {
            tone = 'thin';
            title = 'Thin evidence, useful signals';
            summary = 'The channels and themes are real, but review depth is small. Use this as a brief, not a benchmark.';
        } else if ((rating || 0) >= 4.3 && totalFollowers >= 2000) {
            tone = 'strong';
            title = 'A healthy public footprint';
            summary = 'The rating and audience are both established. The remaining work is consistency and conversion, not discovery.';
        }

        const distributionTotal = Object.values(distribution).reduce((sum, value) => sum + (Number(value) || 0), 0);
        return {
            tone,
            title,
            summary,
            totalFollowers,
            presentChannels: present.length,
            missingChannels: gaps.length,
            reviewDepth: {
                total: reviewTotal,
                collected: collected || 0,
                share: reviewTotal ? Math.min(1, (collected || 0) / reviewTotal) : 0,
            },
            rating,
            negativeShare,
            ownerResponseRate: ownerRate,
            distributionTotal,
            actions,
        };
    }

    /** Score how well a brand pack record matches a scraped business. */
    function matchBrand(brand, dataset) {
        if (!brand || !dataset) return -1;
        const clean = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        const brandName = clean(brand.name);
        const brandId = clean(brand.id);
        const businessName = clean(dataset.business?.name);
        const slug = clean(dataset.business?.slug);
        let score = 0;
        if (brandName && brandName === businessName) score = Math.max(score, 100);
        if (brandId && brandId === slug) score = Math.max(score, 95);
        if (brandName && businessName && (brandName.includes(businessName) || businessName.includes(brandName))) score = Math.max(score, 70);
        for (const alias of arr(dataset.business?.aliases)) {
            const aliasClean = clean(alias);
            if (aliasClean && (aliasClean === brandName || aliasClean === brandId)) score = Math.max(score, 85);
        }
        return score;
    }

    return {
        SCHEMA,
        CHANNELS,
        normaliseProfile,
        buildIntelligence,
        matchBrand,
        channelList,
        themeList,
        normaliseDistribution,
    };
}));
