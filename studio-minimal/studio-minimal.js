// Loaded after brand-identity.js (see studio-v2.html).
(() => {
    'use strict';

    function init() {
        const bar = document.querySelector('.layer-main');
        if (!bar) return;

        const chips = [...bar.querySelectorAll('[data-bar-toggle]')];
        const panelOf = (chip) => {
            const id = chip.getAttribute('aria-controls');
            return id ? document.getElementById(id) : null;
        };

        const setOpen = (open) => {
            chips.forEach((chip) => {
                const panel = panelOf(chip);
                const on = chip === open && Boolean(panel);
                chip.setAttribute('aria-expanded', String(on));
                if (panel) panel.hidden = !on;
            });
        };

        chips.forEach((chip) => {
            chip.addEventListener('click', () => {
                const isOpen = chip.getAttribute('aria-expanded') === 'true';
                setOpen(isOpen ? null : chip);
            });
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            if (document.querySelector('dialog[open]')) return;
            setOpen(null);
        });

        // Start the sidebar quiet: only Layers is open; the rest expand on demand.
        const sidebar = document.querySelector('.layer-sidebar');
        if (!sidebar) return;
        sidebar.querySelectorAll('[data-section-content]').forEach((body) => {
            const name = body.dataset.sectionContent;
            if (!name || name === 'layers') return;
            const toggle = sidebar.querySelector(`[data-action="toggle-section"][data-section="${name}"]`);
            if (!toggle) return;
            toggle.setAttribute('aria-expanded', 'false');
            body.hidden = true;
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
