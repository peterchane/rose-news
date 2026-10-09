import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterByRelevance, KEEP_AT_LEAST, KEEP_AT_OR_ABOVE, type ScoreFn } from '../lib/relevance';
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

test('a failing scorer keeps every candidate — it can never cost her the email', async () => {
  const clusters = make(20);
  const dead: ScoreFn = async () => {
    throw new Error('gateway timeout');
  };
  const { kept, dropped } = await filterByRelevance(clusters, dead);
  assert.equal(kept.length, 20);
  assert.equal(dropped.length, 0);
});

test('low scorers are dropped, high scorers kept', async () => {
  const clusters = make(20);
  // Odd ids are niche; even ids are real news.
  const { kept, dropped } = await filterByRelevance(clusters, scoring((id) => (id % 2 ? 2 : 8)));
  assert.ok(kept.every((c) => c.id % 2 === 0 || kept.length <= KEEP_AT_LEAST));
  assert.ok(dropped.every((d) => d.score < KEEP_AT_OR_ABOVE));
  assert.equal(kept.length + dropped.length, 20);
});

test('it never thins the list below the floor, even on a day it hates everything', async () => {
  const { kept } = await filterByRelevance(make(20), scoring(() => 1));
  assert.equal(kept.length, KEEP_AT_LEAST, 'the best of a bad day still gets written up');
});

test('a story the scorer forgot to mention is kept, not dropped', async () => {
  const clusters = make(20);
  // Returns verdicts only for ids 1-5, all low. The rest were skipped.
  const partial: ScoreFn = async () => [1, 2, 3, 4, 5].map((id) => ({ id, score: 1 }));
  const { kept } = await filterByRelevance(clusters, partial);
  for (let id = 6; id <= 20; id++) {
    assert.ok(kept.some((c) => c.id === id), `#${id} was never judged, so it stays`);
  }
});

test('a short list is not judged at all', async () => {
  let called = false;
  const spy: ScoreFn = async () => {
    called = true;
    return [];
  };
  const { kept } = await filterByRelevance(make(KEEP_AT_LEAST), spy);
  assert.equal(called, false, 'nothing to thin, so no call and no cost');
  assert.equal(kept.length, KEEP_AT_LEAST);
});

test('the holiday is never judged — it is added in code', async () => {
  const clusters = [...make(15), { ...make(1, 'jewish')[0], id: 99, title: 'Sukkot begins' }];
  const { kept } = await filterByRelevance(clusters, scoring(() => 0));
  assert.ok(kept.some((c) => c.id === 99));
});

test('a short list can be judged in full when the floor is zero', async () => {
  // Her interests are a short keyword-matched list. With the default floor of
  // ten they were never judged, which is how an Egyptian press protest got in
  // as a "journalism interest".
  const { kept, dropped } = await filterByRelevance(make(4), scoring((id) => (id === 2 ? 1 : 8)), 0);
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
});
