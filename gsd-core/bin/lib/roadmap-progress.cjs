"use strict";
/**
 * Roadmap Progress Module (#5761, Phase 1 of epic #5692): the single owner of
 * "which table is this ROADMAP's Progress table, and what is its milestone
 * slice".
 *
 * Before this module the question was answered by six locators/scopers that
 * disagreed on `## Progress Tracker`, on a `## Progress` inside a fenced block,
 * and on the headingless fallback. Every READER now asks `locateRoadmapProgress`
 * (or, for the "does this span hold the Progress section" probe,
 * `findProgressSection`); a second hand-written `## Progress` regex or
 * table-locating call in a reader is the DEFECT.GENERATIVE-FIX shape.
 *
 * The rule, defined once:
 *   - The Progress section is the first level-2 ATX heading, outside fenced
 *     code, whose text starts with the word `Progress` (`## Progress`,
 *     `## Progress Tracker`). It runs to the next level-1/2 heading outside
 *     fenced code.
 *   - The table is the first table in that section whose header is a SUPERSET
 *     of the requested column set (ADR-2143 §3: addressed by NAME, never
 *     ordinal). A section with no matching table yields no table; it does not
 *     fall through to the rest of the document (#2012 decoy avoidance).
 *   - A document with no Progress heading is scanned whole (a headingless
 *     milestone slice, #1445, keeps resolving).
 *   - The milestone slice (#5165): when the caller names a milestone and the
 *     table carries a `Milestone` column, only that milestone's rows.
 *
 * Writers (`roadmap.cts`, `phase.cts`, traceability slices) still carry their
 * own slices, and so does `phase.cts`'s `cmdPhaseComplete` already-complete
 * check (it slices the Milestone column itself, with a blank-milestone-matches-
 * nothing rule this owner deliberately does not share); they move onto this
 * owner in Phase 2 (#5762).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMilestoneToken = normalizeMilestoneToken;
exports.milestoneVersionOf = milestoneVersionOf;
exports.findProgressSection = findProgressSection;
exports.locateRoadmapProgress = locateRoadmapProgress;
const markdown_table_cjs_1 = require("./markdown-table.cjs");
const markdown_sectionizer_cjs_1 = require("./markdown-sectionizer.cjs");
/** The canonical column set both RoadmapProgress variants carry. */
const CANONICAL_COLUMNS = ['Phase', 'Plans Complete', 'Status', 'Completed'];
/**
 * #5165: a milestone token compared by identity, not spelling — `v1.1`, `V1.1`
 * and ` 1.1 ` name one milestone. A hand-decorated Progress cell
 * (`**v1.1**`, `` `v1.1` ``, `v1.1 (current)`) still names its first
 * whitespace-separated token. Absent/blank tokens normalize to `''`.
 */
function normalizeMilestoneToken(value) {
    // `[v1.1](ROADMAP.md#v11)` names its link text.
    const unlinked = (milestoneVersionOf(value) ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    const first = unlinked.split(/\s+/)[0] ?? '';
    return first.replace(/^[*_`]+|[*_`:,;]+$/g, '').replace(/^v/i, '').toLowerCase();
}
/**
 * #5165: a STATE.md `milestone:` frontmatter value as a trimmed version string,
 * or null when it is absent, blank or not scalar text.
 */
function milestoneVersionOf(value) {
    if (typeof value !== 'string' && typeof value !== 'number')
        return null;
    const text = String(value).trim();
    return text === '' ? null : text;
}
/**
 * The Progress section of `content`: the first level-2 heading outside fenced
 * code whose text starts with the word `Progress`, up to the next level-1/2
 * heading. Null when the document has no such heading.
 */
function findProgressSection(content) {
    const headings = (0, markdown_sectionizer_cjs_1.tokenizeHeadings)(content);
    const index = headings.findIndex((h) => h.level === 2 && /^Progress\b/i.test(h.text));
    if (index === -1)
        return null;
    const next = headings.slice(index + 1).find((h) => h.level <= 2);
    return { start: headings[index].offset, end: next ? next.offset : content.length };
}
/** Which table is the Progress table, and what is its milestone slice. */
function locateRoadmapProgress(content, options = {}) {
    const section = findProgressSection(content);
    const scoped = section ? content.slice(section.start, section.end) : content;
    let table = null;
    for (const columns of options.columns ?? [CANONICAL_COLUMNS]) {
        table = (0, markdown_table_cjs_1.findTableWithColumns)(scoped, [...columns]);
        if (table)
            break;
    }
    if (!table)
        return { table: null, rows: [], section };
    const want = normalizeMilestoneToken(options.milestone);
    const rows = want !== '' && table.columns.includes('Milestone')
        ? table.rows.filter((r) => normalizeMilestoneToken(r['Milestone']) === want)
        : table.rows;
    return { table, rows, section };
}
