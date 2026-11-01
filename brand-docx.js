'use strict';
/**
 * brand-docx.js — dependency-free reader for the Word brand guides.
 *
 * A .docx is a ZIP of XML parts. The server already has a ZIP reader, so this
 * module takes those two primitives as an argument instead of requiring Node's
 * zlib or any third-party package:
 *
 *   const { readZipEntries, extractZipEntry } = require('./server.js');
 *   const doc = parseBrandDocx(buffer, { readZipEntries, extractZipEntry });
 *
 * It returns the document as an ordered block list plus the handful of tables
 * the brand system actually consumes: the application matrix, the print
 * specification, the canonical contact block and the type hierarchy.
 */

function decodeXmlEntities(value) {
    return String(value ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
        if (entity[0] === '#') {
            const hex = entity[1] === 'x' || entity[1] === 'X';
            const code = Number.parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10);
            if (!Number.isFinite(code)) return match;
            try {
                return String.fromCodePoint(code);
            } catch {
                return match;
            }
        }
        const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
        return Object.prototype.hasOwnProperty.call(named, entity) ? named[entity] : match;
    });
}

function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

/** Reads `w:val` out of a single qualifying tag. */
function attribute(xml, tag, name) {
    const match = String(xml || '').match(new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`, 'i'));
    return match ? decodeXmlEntities(match[1]) : '';
}

/** All visible text in a run of WordprocessingML, preserving tabs/spaces. */
function textFromXml(xml) {
    const source = String(xml || '');
    let result = '';
    const pattern = /<w:(t|tab|br|cr)\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:\1>)/g;
    let match;
    while ((match = pattern.exec(source))) {
        if (match[1] === 't') result += decodeXmlEntities(match[2] || '');
        else if (match[1] === 'tab') result += ' ';
        else result += '\n';
    }
    return result;
}

function styleMap(stylesXml) {
    const map = new Map();
    const source = String(stylesXml || '');
    const stylePattern = /<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g;
    let match;
    while ((match = stylePattern.exec(source))) {
        const id = attribute(`<w:style ${match[1]}>`, 'w:style', 'w:styleId')
            || (match[1].match(/\bw:styleId="([^"]*)"/) || [])[1] || '';
        if (!id) continue;
        const name = (match[2].match(/<w:name\b[^>]*\bw:val="([^"]*)"/) || [])[1] || '';
        map.set(id, decodeXmlEntities(name));
    }
    return map;
}

/** Heading level from a Word style id/name, or null for body text. */
function headingLevel(styleId, styleName) {
    const value = `${styleId || ''} ${styleName || ''}`.trim();
    if (!value) return null;
    if (/^title$/i.test(value) || /\btitle\b/i.test(styleName || '')) return 1;
    const heading = value.match(/heading\s*([1-6])/i);
    if (heading) return Math.min(4, Number(heading[1]));
    return null;
}

function isListStyle(styleId, styleName) {
    return /list|bullet/i.test(`${styleId || ''} ${styleName || ''}`);
}

function parseParagraph(xml, styles) {
    const source = String(xml || '');
    const styleId = attribute(source, 'w:pStyle', 'w:val')
        || ((source.match(/<w:pStyle\b[^>]*w:val="([^"]*)"/) || [])[1] || '');
    const styleName = styles.get(styleId) || '';
    let value = textFromXml(source);
    if (isListStyle(styleId, styleName)) value = value.trim() ? `• ${value.trim()}` : '';
    return {
        type: 'paragraph',
        styleId,
        styleName,
        level: headingLevel(styleId, styleName),
        text: clean(value),
    };
}

function parseTable(xml) {
    const source = String(xml || '');
    const rows = [];
    const rowPattern = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
    let rowMatch;
    while ((rowMatch = rowPattern.exec(source))) {
        const cells = [];
        const cellPattern = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
        let cellMatch;
        while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
            const parts = [];
            const paragraphPattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
            let paragraphMatch;
            while ((paragraphMatch = paragraphPattern.exec(cellMatch[1]))) {
                const value = clean(textFromXml(paragraphMatch[1]));
                if (value) parts.push(value);
            }
            cells.push(parts.join(' · '));
        }
        if (cells.some(Boolean)) rows.push(cells);
    }
    return { type: 'table', rows };
}

/** Finds `<w:p>` / `<w:tbl>` but never `<w:pPr>` or `<w:tblPr>`. */
function nextTag(source, tag, from) {
    const needle = `<${tag}`;
    let at = source.indexOf(needle, from);
    while (at >= 0) {
        const next = source[at + needle.length];
        if (next === '>' || next === ' ' || next === '\t' || next === '\r' || next === '\n') return at;
        at = source.indexOf(needle, at + 1);
    }
    return -1;
}

/**
 * Splits the body into paragraph and table blocks in document order.
 * Tables contain paragraphs, so the scan consumes a whole table at once.
 */
function parseBlocks(documentXml) {
    const source = String(documentXml || '');
    const bodyStart = source.indexOf('<w:body');
    const bodyEnd = source.lastIndexOf('</w:body>');
    if (bodyStart < 0) return [];
    const start = source.indexOf('>', bodyStart) + 1;
    const end = bodyEnd > start ? bodyEnd : source.length;
    const blocks = [];
    let cursor = start;
    while (cursor < end) {
        const nextParagraph = nextTag(source, 'w:p', cursor);
        const nextTable = nextTag(source, 'w:tbl', cursor);
        if (nextParagraph < 0 && nextTable < 0) break;
        const useTable = nextTable >= 0 && (nextParagraph < 0 || nextTable < nextParagraph);
        if (useTable) {
            // Walk nested tables so a table inside a cell cannot truncate one.
            let depth = 0;
            let scan = nextTable;
            let close = -1;
            while (scan < end) {
                const open = nextTag(source, 'w:tbl', scan);
                const shut = source.indexOf('</w:tbl>', scan);
                if (shut < 0) break;
                if (open >= 0 && open < shut) {
                    depth += 1;
                    scan = open + 6;
                    continue;
                }
                depth -= 1;
                scan = shut + 8;
                if (depth <= 0) {
                    close = scan;
                    break;
                }
            }
            if (close < 0) break;
            const tableXml = source.slice(nextTable, close);
            blocks.push(parseTable(tableXml));
            cursor = close;
            continue;
        }
        const close = source.indexOf('</w:p>', nextParagraph);
        if (close < 0) break;
        blocks.push(parseParagraph(source.slice(nextParagraph, close + 6), new Map()));
        cursor = close + 6;
    }
    return blocks;
}

function parseBlocksWithStyles(documentXml, styles) {
    return parseBlocks(documentXml).map((block) => {
        if (block.type !== 'paragraph') return block;
        const styleId = block.styleId;
        const styleName = styles.get(styleId) || block.styleName;
        return {
            ...block,
            styleName,
            level: headingLevel(styleId, styleName),
        };
    });
}

function tableHead(table) {
    if (!table) return [];
    return (Array.isArray(table.head) ? table.head : (table.rows?.[0] || [])).map((cell) => clean(cell));
}

function tableRows(table) {
    if (!table) return [];
    if (Array.isArray(table.head)) return table.rows || [];
    return (table.rows || []).slice(1);
}

function tablePairs(table) {
    const head = tableHead(table).map((cell) => cell.toLowerCase());
    const first = head[0] || '';
    const second = head[1] || '';
    if (!first || !second) return [];
    return tableRows(table).map((row) => ({
        field: clean(row[0]),
        value: clean(row[1]),
    })).filter((entry) => entry.field || entry.value);
}

function findTableByHeader(tables, matcher) {
    return tables.find((table) => {
        const head = tableHead(table).map((cell) => cell.toUpperCase());
        return head.length > 0 && matcher(head);
    }) || null;
}

function sectionTables(sections) {
    return sections.flatMap((section) => section.tables || []);
}

function normalizeSections(blocks) {
    const sections = [];
    let current = null;
    let parent = '';
    const open = (level, heading) => {
        current = { level, heading, parent, paragraphs: [], tables: [] };
        sections.push(current);
    };
    blocks.forEach((block) => {
        if (block.type === 'paragraph' && block.level !== null) {
            if (block.level === 1) parent = block.text;
            open(block.level, block.text);
            return;
        }
        if (block.type === 'table') {
            if (!current) open(1, '');
            if (block.rows.length) {
                current.tables.push({
                    head: block.rows[0],
                    rows: block.rows.slice(1),
                });
            }
            return;
        }
        if (!current) open(1, '');
        if (block.text) current.paragraphs.push(block.text);
    });
    return sections;
}

function readPart(readText, name) {
    try {
        return readText(name) || '';
    } catch {
        return '';
    }
}

/**
 * @param {Buffer} buffer              the .docx file
 * @param {{readZipEntries:Function, extractZipEntry:Function}} zip
 * @param {{name?:string}} [options]
 */
function parseBrandDocx(buffer, zip, options) {
    if (!buffer || !buffer.length) throw new Error('The brand guide is empty.');
    if (!zip || typeof zip.readZipEntries !== 'function' || typeof zip.extractZipEntry !== 'function') {
        throw new Error('A ZIP reader is required to read a .docx file.');
    }
    const entries = zip.readZipEntries(buffer);
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    const readText = (name) => {
        const entry = byName.get(name);
        if (!entry) return null;
        return zip.extractZipEntry(buffer, entry).toString('utf8');
    };
    const documentXml = readText('word/document.xml');
    if (!documentXml) throw new Error('The .docx has no word/document.xml part.');
    const styles = styleMap(readPart(readText, 'word/styles.xml'));
    const blocks = parseBlocksWithStyles(documentXml, styles);
    const sections = normalizeSections(blocks);
    const tables = sectionTables(sections);

    const applicationsTable = findTableByHeader(tables, (head) => head.some((cell) => cell.includes('APPLICATION')));
    const applications = applicationsTable
        ? tableRows(applicationsTable).map((row) => ({
            application: clean(row[0]),
            specification: clean(row[1]),
            scope: clean(row[2]),
        })).filter((entry) => entry.application)
        : [];

    const printTable = findTableByHeader(tables, (head) => (
        head.some((cell) => cell === 'ITEM')
        && head.some((cell) => cell.includes('SPECIFICATION'))
    ));
    const printSpec = printTable ? tablePairs(printTable) : [];

    const factsTable = findTableByHeader(tables, (head) => (
        head.some((cell) => cell === 'FACT') && head.some((cell) => cell === 'DETAIL')
    ));
    const facts = factsTable ? tablePairs(factsTable) : [];

    const contactSection = sections.find((section) => /contact block/i.test(section.heading));
    const contactTable = (contactSection && contactSection.tables[0])
        || findTableByHeader(tables, (head) => head.some((cell) => cell === 'FIELD') && head.some((cell) => cell === 'VALUE'));
    const contact = contactTable ? tablePairs(contactTable) : [];

    const typeTable = findTableByHeader(tables, (head) => (
        head.some((cell) => cell === 'ROLE') && head.some((cell) => cell.includes('TYPEFACE'))
    ));
    const typeHierarchy = typeTable
        ? tableRows(typeTable).map((row) => ({
            role: clean(row[0]),
            typeface: clean(row[1]),
            size: clean(row[2]),
            notes: clean(row[3]),
        })).filter((entry) => entry.role || entry.typeface)
        : [];

    // “Rules of use” is a subsection of “The logo system”; tables live there,
    // not under the H1 itself.
    const logoTable = tables.find((table) => {
        const head = tableHead(table).map((cell) => cell.toUpperCase());
        return head.includes('RULE') && head.some((cell) => cell.includes('SPECIFICATION'));
    });
    const logoRules = logoTable ? tablePairs(logoTable) : [];

    const positioningSection = sections.find((section) => /positioning/i.test(section.heading));
    const positioning = positioningSection && positioningSection.paragraphs[0]
        ? clean(positioningSection.paragraphs[0])
        : '';

    const firstParagraphs = sections
        .flatMap((section) => section.paragraphs)
        .filter((paragraph) => paragraph.length > 80)
        .slice(0, 2);

    return {
        name: clean(options?.name) || 'Brand guide',
        title: clean(options?.name) || '',
        sections,
        applications,
        printSpec,
        contact,
        facts,
        typeHierarchy,
        logoRules,
        positioning,
        summary: firstParagraphs.join(' '),
        counts: {
            sections: sections.length,
            tables: tables.length,
            paragraphs: sections.reduce((total, section) => total + section.paragraphs.length, 0),
        },
    };
}

module.exports = {
    parseBrandDocx,
    parseBlocks,
    parseTable,
    parseParagraph,
    headingLevel,
    textFromXml,
    decodeXmlEntities,
};
