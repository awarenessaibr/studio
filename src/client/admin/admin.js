'use strict';
/**
 * admin.js — developer-only management of which brand groups the studio shows.
 *
 * Reads and writes /api/admin/groups (protected by STUDIO_ADMIN_KEY when set,
 * otherwise loopback-only). The public /api/brand-packs endpoint applies the
 * same settings, so every UI follows this list.
 */
(function () {
    const ENDPOINT = 'api/admin/groups';
    const KEY_STORAGE = 'studio.adminKey';

    const state = {
        packs: [],
        settings: { order: [], hidden: [] },
        loaded: false,
        busy: false,
        key: '',
        adminKeyConfigured: false,
        loadError: '',
        openCaps: new Set(),
    };

    const el = {};

    const make = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    };

    const clear = (node) => {
        while (node.firstChild) node.removeChild(node.firstChild);
    };

    const button = (label, className, onClick) => {
        const node = make('button', className, label);
        node.type = 'button';
        node.addEventListener('click', onClick);
        return node;
    };

    const readKey = () => {
        try {
            return sessionStorage.getItem(KEY_STORAGE) || '';
        } catch {
            return '';
        }
    };

    const writeKey = (value) => {
        try {
            if (value) sessionStorage.setItem(KEY_STORAGE, value);
            else sessionStorage.removeItem(KEY_STORAGE);
        } catch {
            /* private mode: the key simply lives for this page load */
        }
    };

    const setStatus = (message, error = false) => {
        el.status.textContent = message || '';
        el.status.dataset.error = String(Boolean(error));
    };

    const timestamp = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const formatDate = (value) => {
        const date = new Date(value || '');
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    };

    const hiddenSet = () => new Set(state.settings.hidden || []);
    const hiddenBrandSet = () => new Set(state.settings.hiddenBrands || []);
    const socialCrawlerSet = () => new Set(state.settings.socialCrawler || []);
    const visibleCount = () => state.packs.filter((pack) => !hiddenSet().has(pack.id)).length;
    const businessTotal = () => state.packs.reduce((total, pack) => total + (pack.brands || []).length, 0);
    const visibleBusinessCount = () => {
        const hiddenBrands = hiddenBrandSet();
        return state.packs.reduce((total, pack) => total + (pack.brands || [])
            .filter((brand) => !hiddenBrands.has(`${pack.id}::${brand.id}`)).length, 0);
    };

    const request = async (options = {}) => {
        const headers = { ...(options.headers || {}) };
        if (state.key) headers['x-admin-key'] = state.key;
        const response = await fetch(ENDPOINT, { ...options, headers });
        let payload = null;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }
        if (!response.ok) {
            const error = new Error(payload?.error || `Request failed (${response.status})`);
            error.status = response.status;
            throw error;
        }
        return payload;
    };

    const showKey = (message = '') => {
        el.keyPanel.hidden = false;
        el.keyError.textContent = message;
        el.keyError.hidden = !message;
        if (!el.keyInput.value) el.keyInput.value = state.key || '';
        el.keyInput.focus();
        el.keyInput.select();
    };

    const hideKey = () => {
        el.keyPanel.hidden = true;
        el.keyError.hidden = true;
        el.keyError.textContent = '';
    };

    const apply = (data) => {
        state.packs = Array.isArray(data?.packs) ? data.packs : [];
        state.settings = {
            order: Array.isArray(data?.settings?.order) ? data.settings.order : [],
            hidden: Array.isArray(data?.settings?.hidden) ? data.settings.hidden : [],
            hiddenBrands: Array.isArray(data?.settings?.hiddenBrands) ? data.settings.hiddenBrands : [],
            socialCrawler: Array.isArray(data?.settings?.socialCrawler) ? data.settings.socialCrawler : [],
            updatedAt: data?.settings?.updatedAt || '',
        };
        state.adminKeyConfigured = Boolean(data?.adminKeyConfigured);
        state.loaded = true;
        render();
    };

    const load = async () => {
        setStatus('Loading…');
        state.loadError = '';
        try {
            const data = await request();
            hideKey();
            apply(data);
            setStatus(state.settings.updatedAt ? `Saved ${formatDate(state.settings.updatedAt)}` : 'Ready');
        } catch (error) {
            if (error.status === 401) {
                state.loaded = false;
                render();
                showKey(error.message);
                setStatus('Locked', true);
                return;
            }
            if (error.status === 404) {
                state.loaded = false;
                state.loadError = 'Management API not loaded — restart the studio server (npm start).';
                render();
                setStatus(state.loadError, true);
                return;
            }
            setStatus(error.message, true);
        }
    };

    const save = async ({ order, hidden, hiddenBrands, socialCrawler }) => {
        if (state.busy) return;
        const nextHidden = [...new Set(hidden ?? state.settings.hidden)];
        if (state.packs.length && nextHidden.length >= state.packs.length) {
            setStatus('Keep at least one group visible.', true);
            return;
        }
        const nextHiddenBrands = [...new Set(hiddenBrands ?? state.settings.hiddenBrands)];
        const nextSocialCrawler = [...new Set(socialCrawler ?? state.settings.socialCrawler)];
        const hiddenGroupSet = new Set(nextHidden);
        const hiddenBrandRefs = new Set(nextHiddenBrands);
        for (const pack of state.packs) {
            if (hiddenGroupSet.has(pack.id) || !(pack.brands || []).length) continue;
            if (!pack.brands.some((brand) => !hiddenBrandRefs.has(`${pack.id}::${brand.id}`))) {
                setStatus(`Keep at least one business visible in “${pack.name}”.`, true);
                return;
            }
        }
        const nextOrder = order ?? state.packs.map((pack) => pack.id);
        const previous = { ...state.settings };
        state.settings = {
            ...state.settings,
            order: nextOrder,
            hidden: nextHidden,
            hiddenBrands: nextHiddenBrands,
            socialCrawler: nextSocialCrawler,
        };
        state.busy = true;
        render();
        setStatus('Saving…');
        try {
            const data = await request({
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    order: nextOrder,
                    hidden: nextHidden,
                    hiddenBrands: nextHiddenBrands,
                    socialCrawler: nextSocialCrawler,
                }),
            });
            state.busy = false;
            apply(data);
            setStatus(`Saved · ${timestamp()}`);
        } catch (error) {
            state.busy = false;
            state.settings = previous;
            render();
            if (error.status === 401) showKey(error.message);
            setStatus(error.message, true);
        }
    };

    const move = (index, delta) => {
        const ids = state.packs.map((pack) => pack.id);
        const target = index + delta;
        if (target < 0 || target >= ids.length) return;
        [ids[index], ids[target]] = [ids[target], ids[index]];
        save({ order: ids, hidden: state.settings.hidden });
    };

    const toggle = (pack, visible) => {
        const next = new Set(state.settings.hidden);
        if (visible) next.delete(pack.id);
        else next.add(pack.id);
        save({ order: state.packs.map((entry) => entry.id), hidden: [...next] });
    };

    const toggleSocialCrawler = (pack, brand, enabled) => {
        const ref = `${pack.id}::${brand.id}`;
        const next = new Set(socialCrawlerSet());
        if (enabled) next.add(ref);
        else next.delete(ref);
        save({
            order: state.packs.map((entry) => entry.id),
            hidden: state.settings.hidden,
            hiddenBrands: state.settings.hiddenBrands,
            socialCrawler: [...next],
        });
    };

    const toggleBrand = (pack, brand) => {
        const ref = `${pack.id}::${brand.id}`;
        const next = new Set(hiddenBrandSet());
        const currentlyHidden = next.has(ref);
        if (currentlyHidden) {
            next.delete(ref);
        } else {
            const groupHidden = hiddenSet().has(pack.id);
            const visibleBrands = (pack.brands || []).filter((entry) => !next.has(`${pack.id}::${entry.id}`));
            if (!groupHidden && visibleBrands.length <= 1) {
                setStatus(`Keep at least one business visible in “${pack.name}”.`, true);
                return;
            }
            next.add(ref);
        }
        save({
            order: state.packs.map((entry) => entry.id),
            hidden: state.settings.hidden,
            hiddenBrands: [...next],
        });
    };

    const coverFor = (pack) => {
        const node = make('div', 'group-cover');
        const withCover = (pack.brands || []).find((brand) => brand.cover);
        if (withCover) {
            const image = document.createElement('img');
            image.src = withCover.cover;
            image.alt = '';
            image.loading = 'lazy';
            image.addEventListener('error', () => {
                image.remove();
                node.append(swatchesFor(pack));
            });
            node.append(image);
        } else {
            node.append(swatchesFor(pack));
        }
        return node;
    };

    const swatchesFor = (pack) => {
        const strip = make('div', 'group-swatches');
        const swatches = (pack.brands || [])
            .flatMap((brand) => brand.swatches || [])
            .filter((value) => /^#[0-9a-f]{6}$/i.test(String(value || '')))
            .slice(0, 8);
        (swatches.length ? swatches : ['#1a1a2e', '#e1543a', '#f2eee7']).forEach((value) => {
            const swatch = make('span');
            swatch.style.background = value;
            strip.append(swatch);
        });
        return strip;
    };

    const renderCard = (pack, index) => {
        const hidden = hiddenSet().has(pack.id);
        const card = make('article', `group-card${hidden ? ' is-hidden' : ''}`);

        const main = make('div', 'group-main');
        const title = make('div', 'group-title');
        title.append(make('h2', null, pack.name || pack.id), make('span', 'group-id', pack.id));
        if (hidden) title.append(make('span', 'group-hidden-tag', 'Hidden'));
        main.append(title);

        const meta = make('div', 'group-meta');
        const brandCount = Number(pack.brandCount) || (pack.brands || []).length;
        meta.append(
            make('span', null, `${brandCount} brand${brandCount === 1 ? '' : 's'}`),
            make('span', null, `Added ${formatDate(pack.createdAt)}`),
            make('span', null, `Updated ${formatDate(pack.updatedAt)}`),
        );
        main.append(meta);

        const brands = make('div', 'group-brands');
        const hiddenBrands = hiddenBrandSet();
        (pack.brands || []).forEach((brand) => {
            const isHidden = hiddenBrands.has(`${pack.id}::${brand.id}`);
            const chip = button(brand.name, `group-brand${isHidden ? ' is-off' : ''}`, () => toggleBrand(pack, brand));
            chip.disabled = state.busy;
            chip.setAttribute('aria-pressed', String(!isHidden));
            chip.title = isHidden ? 'Hidden — click to show' : 'Visible — click to hide';
            brands.append(chip);
        });
        main.append(brands);

        const crawlerAllowed = socialCrawlerSet();
        const enabledCount = (pack.brands || [])
            .filter((brand) => crawlerAllowed.has(`${pack.id}::${brand.id}`)).length;
        const caps = document.createElement('details');
        caps.className = 'group-caps';
        caps.open = state.openCaps.has(pack.id);
        caps.addEventListener('toggle', () => {
            if (caps.open) state.openCaps.add(pack.id);
            else state.openCaps.delete(pack.id);
        });
        caps.append(make('summary', 'group-caps-summary',
            `Client social crawler · ${enabledCount} of ${(pack.brands || []).length} enabled`));
        const capList = make('div', 'cap-list');
        (pack.brands || []).forEach((brand) => {
            const ref = `${pack.id}::${brand.id}`;
            const row = make('label', 'cap-row');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = crawlerAllowed.has(ref);
            input.disabled = state.busy;
            input.addEventListener('change', () => toggleSocialCrawler(pack, brand, input.checked));
            row.append(input, make('span', 'cap-name', brand.name),
                make('span', 'cap-state', crawlerAllowed.has(ref) ? 'Enabled' : 'Hidden'));
            capList.append(row);
        });
        caps.append(capList);
        main.append(caps);

        const side = make('div', 'group-side');

        const switchLabel = make('label', 'switch');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !hidden;
        input.disabled = state.busy;
        input.setAttribute('aria-label', `Show ${pack.name || pack.id} in the studio`);
        input.addEventListener('change', () => toggle(pack, input.checked));
        switchLabel.append(input, make('span', 'switch-track'), make('span', 'switch-label', hidden ? 'Hidden' : 'Visible'));

        const order = make('div', 'group-order');
        const up = button('↑', null, () => move(index, -1));
        up.setAttribute('aria-label', `Move ${pack.name || pack.id} up`);
        up.disabled = state.busy || index === 0;
        const down = button('↓', null, () => move(index, 1));
        down.setAttribute('aria-label', `Move ${pack.name || pack.id} down`);
        down.disabled = state.busy || index === state.packs.length - 1;
        order.append(up, down);

        const links = make('div', 'group-links');
        const open = document.createElement('a');
        open.href = `asset-studio.html?pack=${encodeURIComponent(pack.id)}`;
        open.target = '_blank';
        open.rel = 'noopener';
        open.textContent = 'Open in Asset Studio';
        links.append(open);

        side.append(switchLabel, order, links);
        card.append(coverFor(pack), main, side);
        return card;
    };

    const render = () => {
        clear(el.groupList);
        if (!state.loaded) {
            el.groupCount.textContent = state.loadError ? 'Unavailable' : 'Locked';
            el.groupList.append(make('p', 'admin-loading',
                state.loadError || 'Enter the admin key to manage the groups.'));
            return;
        }
        const total = state.packs.length;
        const brandsTotal = businessTotal();
        el.groupCount.textContent = `${visibleCount()} of ${total} group${total === 1 ? '' : 's'}`
            + ` · ${visibleBusinessCount()} of ${brandsTotal} business${brandsTotal === 1 ? '' : 'es'} shown`;
        if (!total) {
            el.groupList.append(make('p', 'admin-loading', 'No brand packs found. Import one in the studio first.'));
            return;
        }
        state.packs.forEach((pack, index) => el.groupList.append(renderCard(pack, index)));
        el.modeNote.textContent = state.adminKeyConfigured
            ? 'Protected with STUDIO_ADMIN_KEY. The key is kept in this browser tab only.'
            : 'Local dev mode: management is limited to localhost because STUDIO_ADMIN_KEY is not set.';
    };

    const init = () => {
        [
            'keyPanel', 'keyInput', 'keyBtn', 'keyError', 'groupList', 'groupCount',
            'status', 'modeNote', 'showAllBtn', 'resetOrderBtn',
        ].forEach((id) => {
            el[id] = document.getElementById(id);
        });

        state.key = readKey();

        el.keyBtn.addEventListener('click', () => {
            const value = el.keyInput.value.trim();
            if (!value) {
                showKey('Enter the admin key.');
                return;
            }
            state.key = value;
            writeKey(value);
            load();
        });
        el.keyInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') el.keyBtn.click();
        });

        el.showAllBtn.addEventListener('click', () => {
            save({
                order: state.packs.map((pack) => pack.id),
                hidden: [],
                hiddenBrands: [],
                socialCrawler: state.settings.socialCrawler,
            });
        });
        el.resetOrderBtn.addEventListener('click', () => {
            save({ order: [], hidden: state.settings.hidden });
        });

        load();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
