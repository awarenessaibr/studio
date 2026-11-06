#!/usr/bin/env node
'use strict';
/**
 * Publishes the built-in brand template catalogue to the saved-template store,
 * so every brand in every pack has designs waiting in the Studio's
 * "Published templates" panel.
 *
 * Usage:
 *   node scripts/publish-brand-templates.js                # all packs, brands, templates
 *   node scripts/publish-brand-templates.js --dry-run      # report only
 *   node scripts/publish-brand-templates.js --pack=okja-…  # one pack
 *   node scripts/publish-brand-templates.js --brand=okja --template=social-post,flyer
 *   node scripts/publish-brand-templates.js --force        # replace existing snapshots
 *
 * Every pack on disk is covered, including the ones hidden from the Studio's
 * pack picker, so un-hiding a pack never leaves it without published designs.
 *
 * Already-published templates are skipped unless --force is passed, so the
 * script is safe to re-run. --force deletes the previous snapshot before
 * writing the new one, so re-publishing never duplicates the artwork on disk.
 */
const server = require('../server.js');
const Brand = require('../src/shared/brand-pack.js');

function parseArgs(argv) {
    const options = { pack: '', brand: '', templates: null, force: false, dryRun: false, quiet: false };
    for (const arg of argv) {
        const [flag, value = ''] = arg.split('=');
        if (flag === '--pack') options.pack = value;
        else if (flag === '--brand') options.brand = value;
        else if (flag === '--template' || flag === '--templates') {
            options.templates = value.split(',').map((entry) => entry.trim()).filter(Boolean);
        } else if (flag === '--force') options.force = true;
        else if (flag === '--dry-run') options.dryRun = true;
        else if (flag === '--quiet') options.quiet = true;
        else if (flag === '--help' || flag === '-h') {
            console.log('Usage: node scripts/publish-brand-templates.js [--pack=id] [--brand=id] [--template=a,b] [--force] [--dry-run] [--quiet]');
            process.exit(0);
        } else {
            console.error(`Unknown option: ${arg}`);
            process.exit(2);
        }
    }
    return options;
}

const options = parseArgs(process.argv.slice(2));

async function publishPack(packId, stats) {
    const { pack } = await server.readBrandPack(packId);
    const brands = (pack.brands || []).filter((brand) => (options.brand ? brand.id === options.brand : brand.visible !== false));
    if (!brands.length && options.brand) {
        console.error(`! ${pack.id}: brand “${options.brand}” not found`);
        stats.failed += 1;
        return;
    }

    for (const brand of brands) {
        let existing;
        try {
            existing = await server.listBrandTemplates(pack.id, { brandId: brand.id });
        } catch (error) {
            console.error(`! ${pack.id}/${brand.id}: ${error.message}`);
            stats.failed += 1;
            continue;
        }
        const bySource = new Map();
        for (const entry of existing.templates || []) {
            if (!entry.sourceTemplateId) continue;
            if (!bySource.has(entry.sourceTemplateId)) bySource.set(entry.sourceTemplateId, []);
            bySource.get(entry.sourceTemplateId).push(entry.id);
        }
        const published = new Set(bySource.keys());
        const catalog = Brand.templateCatalog(brand).filter((template) => (
            options.templates ? options.templates.includes(template.id) : true
        ));
        if (!catalog.length) {
            console.error(`! ${pack.id}/${brand.id}: no templates match the filter`);
            stats.failed += 1;
            continue;
        }

        for (const template of catalog) {
            const label = `${pack.id}/${brand.id}/${template.id}`;
            if (published.has(template.id) && !options.force) {
                stats.skipped += 1;
                if (!options.quiet) console.log(`= ${label} (already published)`);
                continue;
            }
            if (options.dryRun) {
                stats.planned += 1;
                console.log(`+ ${label} (planned)`);
                continue;
            }
            try {
                for (const stale of bySource.get(template.id) || []) {
                    await server.deleteSavedBrandTemplate(pack.id, brand.id, stale);
                    stats.replaced += 1;
                    if (!options.quiet) console.log(`- ${label} (replaced ${stale})`);
                }
                bySource.delete(template.id);
                const name = `${brand.name} — ${template.label}`;
                const composition = Brand.createTemplateComposition({
                    packId: pack.id,
                    packName: pack.name,
                    portfolio: pack.portfolio,
                    brand,
                    templateId: template.id,
                    name,
                });
                const saved = await server.saveBrandTemplate(pack.id, {
                    brandId: brand.id,
                    name,
                    composition,
                    sourceTemplateId: template.id,
                });
                stats.published += 1;
                published.add(template.id);
                if (!options.quiet) {
                    console.log(`✓ ${label} → ${saved.template.id} (${saved.template.layerCount} layers, ${saved.template.width}×${saved.template.height})`);
                }
            } catch (error) {
                stats.failed += 1;
                console.error(`! ${label}: ${error.message}`);
            }
        }
    }
}

async function main() {
    const packs = await server.listBrandPacks();
    const targets = options.pack ? packs.filter((pack) => pack.id === options.pack) : packs;
    if (!targets.length) {
        console.error(options.pack ? `! Pack “${options.pack}” not found.` : '! No brand packs on disk.');
        process.exit(1);
    }
    const stats = { published: 0, skipped: 0, replaced: 0, planned: 0, failed: 0 };
    for (const pack of targets) await publishPack(pack.id, stats);

    const done = options.dryRun ? stats.planned : stats.published;
    console.log(`\n${options.dryRun ? 'Planned' : 'Published'} ${done} · replaced ${stats.replaced} · skipped ${stats.skipped} · failed ${stats.failed}`);
    if (stats.failed) process.exitCode = 1;
}

main().catch((error) => {
    console.error(`! ${error.message}`);
    process.exit(1);
});
