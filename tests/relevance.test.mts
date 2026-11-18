import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterByRelevance, KEEP_AT_OR_ABOVE, RelevanceUnavailableError, type ScoreFn } from '../lib/relevance';
import type { Cluster } from '../lib/select';
import type { Section } from '../lib/feeds';

/**
 * Relevance is judged by a model rather than ~40 patterns. Peter: "rules wont
 * scale." These tests pin the plumbing around the judgment, never the judgment
 * itself: the model is stubbed, so they are deterministic and free.
 */

const make = (n: number, section: Section = 'us'): Cluster[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1, title: `Story ${i + 1}`, section, blurb: '', link: 'https://e.com/x',
    source: 'NPR', coverage: [], publishedAt: new Date(), score: 1,
  }));

const scoring = (fn: (id: number) => number): ScoreFn => async (lines) =>
  [...lines.matchAll(/#(\d+)/g)].map((m) => ({ id: Number(m[1]), score: fn(Number(m[1])) }));

test('a judge that stays down skips the day rather than send unjudged stories', async () => {
  // Peter: "skip the day. never send random stuff."
  let calls = 0;
  const dead: ScoreFn = async () => {
    calls++;
    throw new Error('gateway timeout');
  };
  await assert.rejects(filterByRelevance(make(20), dead), RelevanceUnavailableError);
  assert.equal(calls, 2, 'one retry, then give up');
});

test('a single blip is retried, not fatal', async () => {
  let calls = 0;
  const flaky: ScoreFn = async (lines) => {
    if (++calls === 1) throw new Error('gateway timeout');
    return scoring(() => 8)(lines);
  };
  const { kept } = await filterByRelevance(make(5), flaky);
  assert.equal(kept.length, 5);
});

test('low scorers are dropped, high scorers kept', async () => {
  const clusters = make(20);
  // Odd ids are niche; even ids are real news.
  const { kept, dropped } = await filterByRelevance(clusters, scoring((id) => (id % 2 ? 2 : 8)));
  assert.ok(kept.every((c) => c.id % 2 === 0));
  assert.ok(dropped.every((d) => d.score < KEEP_AT_OR_ABOVE));
  assert.equal(kept.length + dropped.length, 20);
});

test('a rejected story is never added back, even on a day it hates everything', async () => {
  // Peter: "adding rejected stories is not ok."
  const { kept } = await filterByRelevance(make(20), scoring(() => 1));
  assert.equal(kept.length, 0);
});

test('a story the judge skipped is not approved, so it stays out', async () => {
  // Verdicts only for ids 1-5, all high. The rest were never judged.
  const partial: ScoreFn = async () => [1, 2, 3, 4, 5].map((id) => ({ id, score: 9 }));
  const { kept } = await filterByRelevance(make(20), partial);
  assert.deepEqual(kept.map((c) => c.id), [1, 2, 3, 4, 5]);
});

test('the holiday is never judged — it is added in code', async () => {
  const clusters = [...make(15), { ...make(1, 'jewish')[0], id: 99, title: 'Sukkot begins' }];
  const { kept } = await filterByRelevance(clusters, scoring(() => 0));
  assert.ok(kept.some((c) => c.id === 99));
});

test('a short list is judged in full', async () => {
  // A floor of ten once meant a short list was never judged, which is how an
  // Egyptian press protest got in as a "journalism interest".
  const { kept, dropped } = await filterByRelevance(make(4), scoring((id) => (id === 2 ? 1 : 8)));
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].cluster.id, 2);
  assert.equal(kept.length, 3);
});

test('the judge is told what Peter has ruled out', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../lib/relevance.ts', import.meta.url), 'utf8');
  // Today's misses, in the judge's own words — tuned instead of adding regexes.
  assert.match(src, /press, protests or politics in another country/, 'Egypt');
  assert.match(src, /lesser-known company's IPO, a company merely "backed by" a big one/, 'Firmus');
  assert.match(src, /major US storm .* or any California \/ LA weather/, 'weather focus');
  assert.match(src, /honors lists and "power 100"-style rankings from niche or community-specific publications/, 'Latina Powerhouse 100 list');
  assert.match(src, /women leading in media, entertainment and business/, 'women-exec stories are welcome');
});
