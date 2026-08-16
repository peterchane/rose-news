import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPreviousPath } from '../lib/archive';
import { buildPrompt, SYSTEM_PROMPT, type PreviousBrief } from '../lib/write';
import type { Cluster } from '../lib/select';

/**
 * Rose's two pieces of feedback:
 *   1. don't repeat stories between editions
 *   2. explain unfamiliar terms like "Oman"
 * Both depend on things that are easy to silently break — the archive lookup
 * and the prompt — so they're pinned here.
 */

// ── 1. Memory: which archived brief counts as "yesterday" ───────────────────

const paths = (...d: string[]) => d.map((x) => `briefs/${x}.json`);

test('picks the most recent day before today', () => {
  assert.equal(
    pickPreviousPath(paths('2026-08-03', '2026-08-05', '2026-08-04'), '2026-08-06'),
    'briefs/2026-08-05.json',
  );
});

test("never treats today's own brief as yesterday", () => {
  // A same-day re-run must not read its own output and suppress everything.
  assert.equal(pickPreviousPath(paths('2026-08-06'), '2026-08-06'), null);
  assert.equal(
    pickPreviousPath(paths('2026-08-06', '2026-08-05'), '2026-08-06'),
    'briefs/2026-08-05.json',
  );
});

test('ignores future-dated files', () => {
  // A clock skew or a hand-placed file must not become "yesterday".
  assert.equal(pickPreviousPath(paths('2026-08-09'), '2026-08-06'), null);
});

test('crosses month and year boundaries correctly', () => {
  assert.equal(pickPreviousPath(paths('2026-07-31'), '2026-08-01'), 'briefs/2026-07-31.json');
  assert.equal(pickPreviousPath(paths('2025-12-31'), '2026-01-01'), 'briefs/2025-12-31.json');
});

test('an empty or junk-filled archive yields nothing rather than throwing', () => {
  assert.equal(pickPreviousPath([], '2026-08-06'), null);
  assert.equal(pickPreviousPath(['briefs/notes.txt', 'briefs/'], '2026-08-06'), null);
});

// ── 2. The previous brief actually reaches the prompt ───────────────────────

const clusters: Cluster[] = [1, 2, 3].map((i) => ({
  id: i, title: `Candidate story ${i}`, section: 'world', blurb: 'blurb',
  link: `https://e.com/${i}`, source: 'NPR', coverage: [], publishedAt: new Date(), score: 1,
}));

const previous: PreviousBrief = {
  subject: 'Yesterday: Hormuz deal and Fauci vote',
  topics: ['Iran-Oman Hormuz deal', 'Fauci contempt vote'],
  paragraphs: ['Iran and [Oman](#1) neared a deal.', 'Fauci faced a vote.'],
  date: '2026-08-05',
};

test("yesterday's stories are listed in the prompt so they can be avoided", () => {
  const p = buildPrompt(clusters, previous);
  assert.match(p, /ALREADY SENT/);
  assert.match(p, /Iran-Oman Hormuz deal/);
  assert.match(p, /Fauci contempt vote/);
  assert.match(p, /2026-08-05/);
});

test('the prompt tells the model not to repeat them', () => {
  const p = buildPrompt(clusters, previous);
  assert.match(p, /not to be told the same story twice|Do NOT write about any story above again/);
  assert.match(p, /unless something genuinely new happened/);
});

test("yesterday's wording is included, with link markup stripped", () => {
  const p = buildPrompt(clusters, previous);
  assert.match(p, /Iran and Oman neared a deal\./, 'prose is present');
  assert.ok(!p.includes('[Oman](#1)'), 'citation markup is not fed back');
});

test('no previous brief means no ALREADY SENT block at all', () => {
  const p = buildPrompt(clusters, null);
  assert.ok(!p.includes('ALREADY SENT'));
  assert.match(p, /Candidate story 1/, 'candidates are still there');
});

test('a previous brief with no stored paragraphs still works', () => {
  const p = buildPrompt(clusters, { subject: 'x', topics: ['a topic'] });
  assert.match(p, /ALREADY SENT/);
  assert.match(p, /a topic/);
});

// ── 3. Glossing rules survive prompt edits ─────────────────────────────────

test('the prompt instructs glossing of unfamiliar terms', () => {
  assert.match(SYSTEM_PROMPT, /GLOSS THE UNFAMILIAR/);
  assert.match(SYSTEM_PROMPT, /Oman, a small country on the Arabian Peninsula/,
    'the example Rose actually asked for');
  assert.match(SYSTEM_PROMPT, /first mention only/i);
  assert.match(SYSTEM_PROMPT, /Never gloss twice/i);
});

test('the prompt no longer discourages defining terms', () => {
  // The original rule ("gloss ONLY genuinely specialized terms") is what caused
  // Oman to go unexplained. It must not come back.
  assert.ok(
    !/gloss only genuinely specialized terms/i.test(SYSTEM_PROMPT),
    'the rule that suppressed glossing must stay gone',
  );
});

test('glosses are required to read as prose, not asides', () => {
  assert.match(SYSTEM_PROMPT, /No parentheses, no asides/);
});

test('the prompt stays lean', () => {
  // It reached 2,065 tokens of overlapping rules and made every run cost more
  // and fail validation more often. Content filtering lives in code now.
  const approxTokens = SYSTEM_PROMPT.length / 4;
  assert.ok(approxTokens < 1000, `system prompt is ~${Math.round(approxTokens)} tokens`);
});
