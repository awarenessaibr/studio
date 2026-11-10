#!/usr/bin/env node
'use strict';
/**
 * export-menu-register.js — write a human-readable register of a brand's
 * menus, prices and venue hire from its pack.
 *
 * The pack stays the source of truth; this is the document a venue can read
 * back, check a price against and sign off. It is generated, so it never
 * drifts from what the studio will print.
 *
 * Usage
 *   node scripts/export-menu-register.js --pack=<packId>
 *   node scripts/export-menu-register.js --pack=<packId> --brand=<brandId>
 *   node scripts/export-menu-register.js --pack=<packId> --out=deliverables/x.md
 */
const fs = require('node:fs');
const path = require('node:path');
const Brand = require('../src/shared/brand-pack.js');

const ROOT = path.resolve(__dirname, '..');
const PACKS = path.join(ROOT, 'data', 'brand-packs');

function parseArgs(argv) {
    const options = { pack: '', brand: '', out: '' };
    argv.forEach((arg) => {
        const [flag, value = ''] = arg.split('=');
        if (flag === '--pack') options.pack = value;
        else if (flag === '--brand') options.brand = value;
        else if (flag === '--out') options.out = value;
        else if (flag === '--help' || flag === '-h') {
            console.log('Usage: node scripts/export-menu-register.js --pack=<packId> [--brand=<brandId>] [--out=<file.md>]');
            process.exit(0);
        } else {
            console.error(`Unknown option: ${arg}`);
            process.exit(2);
        }
    });
    return options;
}

const cell = (value) => String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();

function table(head, rows) {
    if (!rows.length) return '';
    return [
        `| ${head.join(' | ')} |`,
        `| ${head.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
    ].join('\n');
}

function renderBrand(brand, outFile) {
    const content = brand.content || {};
    const menus = Array.isArray(content.menus) ? content.menus : [];
    const venue = content.venue || null;
    const locations = Array.isArray(content.locations) ? content.locations : [];
    const documents = Array.isArray(brand.documents) ? brand.documents : [];
    const lines = [];

    lines.push(`# ${brand.name} — menus, prices and venue hire`);
    lines.push('');
    lines.push(`Generated from \`data/brand-packs/${brand._packId}/files/${brand.id}/content/${brand.id}.json\` on ${new Date().toISOString().slice(0, 10)}.`);
    lines.push('The pack is the source of truth; edit the content file and re-run `scripts/sync-brand-content.js`.');
    lines.push('');

    if (locations.length) {
        lines.push('## Branches');
        lines.push('');
        lines.push(table(
            ['Branch', 'Address', 'Postcode', 'Email', 'Hours'],
            locations.map((location) => [
                location.name,
                location.address,
                location.postcode,
                location.email,
                location.hours ? Object.entries(location.hours).map(([day, value]) => `${day} ${value}`).join(' · ') : '',
            ]),
        ));
        lines.push('');
    }

    lines.push('## Menus at a glance');
    lines.push('');
    lines.push(table(
        ['Menu', 'Kind', 'Branches', 'Valid', 'Sections', 'Items', 'Source'],
        menus.map((menu) => [
            menu.name,
            menu.kind,
            menu.branches.length ? Brand.branchLabel(brand, menu.branches) : 'All branches',
            [menu.validFrom, menu.validTo].filter(Boolean).join(' – ') || '—',
            menu.sections.length,
            menu.sections.reduce((sum, section) => sum + section.items.length, 0),
            menu.source.document ? `${path.basename(menu.source.document)} p.${menu.source.page || '?'}` : '—',
        ]),
    ));
    lines.push('');

    menus.forEach((menu) => {
        lines.push(`## ${menu.name}`);
        lines.push('');
        const meta = [
            menu.kind && `\`${menu.kind}\``,
            menu.branches.length ? Brand.branchLabel(brand, menu.branches) : 'All branches',
            menu.availability,
            [menu.validFrom, menu.validTo].filter(Boolean).length
                ? `valid ${[menu.validFrom, menu.validTo].filter(Boolean).join(' – ')}`
                : '',
            menu.source.document ? `from \`${path.basename(menu.source.document)}\`${menu.source.page ? ` p.${menu.source.page}` : ''}` : '',
        ].filter(Boolean);
        if (meta.length) lines.push(meta.join(' · '));
        if (menu.summary) lines.push('', menu.summary);
        if (menu.source.note) lines.push('', `> ${menu.source.note}`);
        if (menu.priceNote) lines.push('', `**${menu.priceNote}**`);
        if (menu.packages.length) {
            lines.push('', '**Set menus**', '');
            lines.push(table(
                ['Package', 'Price', 'Unit', 'Minimum', 'Includes'],
                menu.packages.map((pack) => [pack.name, pack.price, pack.unit, pack.minOrder, pack.includes.join(', ')]),
            ));
        }
        menu.sections.forEach((section) => {
            const heading = [section.name || 'Section', section.price].filter(Boolean).join(' — ');
            lines.push('', `### ${heading}`, '');
            if (section.note) lines.push(`${section.note}`, '');
            if (section.items.length) {
                lines.push(table(
                    ['Item', 'Description', 'Price', 'Dietary', 'Note'],
                    section.items.map((item) => [item.name, item.description, item.price, item.dietary.join(', '), item.note]),
                ));
            }
        });
        if (menu.notes.length) {
            lines.push('', '**Notes**');
            menu.notes.forEach((note) => lines.push(`- ${note}`));
        }
        if (menu.dietaryKey.length) {
            lines.push('', `*${menu.dietaryKey.join(' · ')}*`);
        }
        lines.push('');
    });

    if (venue) {
        lines.push('## Venue hire');
        lines.push('');
        if (venue.name) lines.push(`**${venue.name}**`, '');
        lines.push(table(
            ['Term', 'Value'],
            [
                ['Hire fee', venue.hireFee],
                ['Hire fee note', venue.hireFeeNote],
                ['Minimum spend', venue.minimumSpend],
                ['Deposit', venue.deposit],
                ['Guests', [venue.minGuests && `min ${venue.minGuests}`, venue.maxGuests && `max ${venue.maxGuests}`].filter(Boolean).join(', ')],
                ['Minimum for catering', venue.minCatering],
                ['Exclusive use', venue.exclusiveUse],
                ['Set-up from', venue.setupFrom],
                ['Arrival from', venue.arrivalFrom],
                ['Last orders', venue.lastOrders],
                ['Closes', venue.closes],
                ['Capacity note', venue.capacityNote],
                ['Accessibility', venue.accessibility],
                ['Parking', venue.parking],
                ['Decorations', venue.decorations],
                ['Music', venue.music],
                ['Drinks', venue.drinks],
                ['Occasions', venue.occasions.join(', ')],
                ['Catering', venue.catering.join(' · ')],
            ].filter(([, value]) => value),
        ));
        if (venue.rooms.length) {
            lines.push('', '### Rooms', '');
            lines.push(table(
                ['Room', 'Location', 'Capacity', 'AV', 'Access', 'Available', 'Source'],
                venue.rooms.map((room) => [
                    room.name, room.location, room.capacity, room.av, room.accessibility, room.available,
                    [room.url, room.brochurePage && `brochure p.${room.brochurePage}`].filter(Boolean).join(' · '),
                ]),
            ));
            venue.rooms.forEach((room) => {
                lines.push('', `#### ${room.name}`, '');
                if (room.image) {
                    const relative = path.relative(path.dirname(outFile), path.join(ROOT, 'data', 'brand-packs', brand._packId, 'files', brand.id, room.image));
                    lines.push(`![${room.name} — function room](${relative.split(path.sep).join('/')})`, '');
                }
                lines.push(table(
                    ['Term', 'Value'],
                    [
                        ['Location', room.location],
                        ['Capacity', room.capacity],
                        ['Layout', room.layout],
                        ['AV', room.av],
                        ['Toilets', room.toilets],
                        ['Access', room.accessibility],
                        ['Available', room.available],
                        ['Source', [room.url, room.brochurePage && `brochure p.${room.brochurePage}`].filter(Boolean).join(' · ')],
                        ['Photos', room.gallery.length ? `${room.gallery.length + (room.image ? 1 : 0)} in the pack (${room.gallery.length} in the gallery)` : ''],
                    ].filter(([, value]) => value),
                ));
                if (room.features.length) {
                    lines.push('', '**Features**');
                    room.features.forEach((feature) => lines.push(`- ${feature}`));
                }
                if (room.note) lines.push('', room.note);
            });
        }
        if (venue.offers.length) {
            lines.push('', '### Offers', '');
            lines.push(table(
                ['Offer', 'Detail', 'Price', 'Branches'],
                venue.offers.map((offer) => [
                    offer.title, offer.detail, offer.price,
                    offer.branches.length ? Brand.branchLabel(brand, offer.branches) : 'All branches',
                ]),
            ));
        }
        if (venue.entertainment.length) {
            lines.push('', '### Entertainment', '');
            lines.push(table(
                ['Partner', 'Detail', 'Price'],
                venue.entertainment.map((entry) => [entry.name, entry.detail, entry.price]),
            ));
        }
        if (venue.terms.length) {
            lines.push('', '### Terms', '');
            venue.terms.forEach((term) => lines.push(`- ${term}`));
        }
        if (venue.faqs.length) {
            lines.push('', '### FAQs');
            venue.faqs.forEach((faq) => lines.push('', `**${faq.q}**`, '', faq.a));
        }
        if (venue.notes.length) {
            lines.push('', '### Notes and conflicts');
            venue.notes.forEach((note) => lines.push(`- ${note}`));
        }
        lines.push('');
    }

    if (documents.length) {
        lines.push('## Source documents');
        lines.push('');
        lines.push(table(
            ['Document', 'Kind', 'Pages', 'Updated', 'Branch', 'Menus', 'Note'],
            documents.map((document) => [
                `\`${document.path}\``, document.kind, document.pages, document.updated,
                document.branch, document.menuIds.join(', '), document.note,
            ]),
        ));
        lines.push('');
    }

    return lines.join('\n');
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (!options.pack) {
        console.error('A pack id is required: --pack=<packId>');
        process.exit(2);
    }
    const file = path.join(PACKS, options.pack, 'pack.json');
    if (!fs.existsSync(file)) {
        console.error(`Pack “${options.pack}” not found.`);
        process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const pack = Brand.normalizeBrandPack(raw.pack || raw);
    if (!pack) {
        console.error('That pack could not be normalised.');
        process.exit(1);
    }
    const brands = pack.brands
        .filter((brand) => !options.brand || brand.id === options.brand)
        .map((brand) => ({ ...brand, _packId: options.pack }));
    if (!brands.length) {
        console.error(options.brand ? `Brand “${options.brand}” is not in that pack.` : 'That pack has no brands.');
        process.exit(1);
    }
    const out = options.out
        ? path.resolve(ROOT, options.out)
        : path.join(ROOT, 'deliverables', Brand.slugId(pack.name || options.pack), 'menus-and-venue.md');
    const body = brands.map((brand) => renderBrand(brand, out)).join('\n---\n\n');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${body}\n`);
    console.log(`✓ ${path.relative(ROOT, out)} (${brands.length} brand${brands.length === 1 ? '' : 's'})`);
}

main();
