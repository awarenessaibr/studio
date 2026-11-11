'use strict';
/**
 * Hydrates a deployed Studio Builder page. The layout and the real stage are
 * server-rendered; this script only adds live counts, a stage reload and the
 * deployment metadata from the server.
 */
(() => {
    const recordEl = document.getElementById('studio-page-record');
    let record = null;
    try { record = recordEl ? JSON.parse(recordEl.textContent) : null; } catch { record = null; }

    const live = {
        brandPacks: (catalog) => catalog?.live?.brandPacks?.count,
        fonts: (catalog) => catalog?.live?.fonts?.count,
        animations: (catalog) => catalog?.live?.animations?.count,
        assets: (catalog) => catalog?.live?.assets?.total,
        library: (catalog) => catalog?.live?.library?.count,
        segments: (catalog) => catalog?.live?.segments?.counts?.groups,
    };

    function hydrate(catalog) {
        for (const element of document.querySelectorAll('[data-live-for]')) {
            const read = live[element.dataset.liveFor];
            const value = read ? read(catalog) : null;
            if (value == null) continue;
            element.textContent = String(value);
            element.title = `${value} ${element.dataset.liveFor} available on this server`;
        }
        const stamp = document.querySelector('[data-deployed-at]');
        if (stamp && catalog?.live?.generatedAt) {
            stamp.title = `Live counts read at ${new Date(catalog.live.generatedAt).toLocaleString()}`;
        }
    }

    async function loadLive() {
        try {
            const response = await fetch('/api/studio-builder/catalog', { cache: 'no-store' });
            if (!response.ok) return;
            hydrate(await response.json());
        } catch {
            // A deployed page still renders the layout and the real stage when
            // the catalog endpoint is unavailable.
        }
    }

    const reload = document.querySelector('[data-stage-reload]');
    if (reload) {
        reload.addEventListener('click', () => {
            const frame = document.querySelector('.dp-stage-frame');
            if (!frame) return;
            const url = new URL(frame.src, location.href);
            url.searchParams.set('_deployedReload', String(Date.now()));
            frame.src = url.href;
            reload.textContent = 'Reloaded';
            setTimeout(() => { reload.textContent = 'Reload'; }, 1200);
        });
    }

    if (record) {
        const stamp = document.querySelector('[data-deployed-at]');
        if (stamp && record.createdAt) {
            const when = new Date(record.createdAt).toLocaleString();
            const base = record.baseSource ? ` · ${record.baseSource}` : '';
            const surface = record.surfaceLabel ? ` · ${record.surfaceLabel}` : '';
            stamp.textContent = `Deployed ${when}${base}${surface}`;
            stamp.title = `Deployed ${new Date(record.createdAt).toLocaleString()}`;
            stamp.dataset.deployedAt = record.createdAt;
        }
    }

    loadLive();
})();
