import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseStories, isMediaOrCulture, TOP_NEWS, MAX_INTERESTS } from '../lib/choose';
import type { Cluster } from '../lib/select';
import type { Section } from '../lib/feeds';

/**
 * Peter: "there are a small set of top stories every day that matter. include
 * those. and then include stories based on the personalized interests i told
 * you." Two groups, nothing else. The relevance call is stubbed to approve
 * everything, so these pin the selection rules, not a model's judgment.
 */
const approve = async (lines: string) =>
  [...lines.matchAll(/#(\d+)/g)].map((m) => ({ id: Number(m[1]), score: 9 }));

let next = 1;

/** Genuinely different headlines: the duplicate check would fold look-alikes. */
const HEADLINES = [
  'Senate passes the spending bill', 'Fed holds interest rates steady', 'Supreme Court takes up tariffs',
  'Oil prices fall below ninety dollars', 'NASA delays the lunar landing', 'Unemployment ticks up in September',
  'Governors meet over water rights', 'Airline strike grounds flights', 'Housing starts climb again',
  'Treasury yields jump on inflation data', 'FDA approves a new vaccine', 'Census shows population shift south',
];
const c = (section: Section, title: string, score: number): Cluster => ({
  id: next++, title, section, blurb: '', link: 'https://e.com/x', source: 'NPR',
  coverage: [], publishedAt: new Date(), score,
});

test('top news is the highest-ranked news, and only a handful of it', async () => {
  const all = HEADLINES.map((h, i) => c('us', h, 50 - i));
  const { top } = await chooseStories(all, approve);
  assert.equal(top.length, TOP_NEWS);
  assert.ok(top.every((t) => t.tier === 'top'));
  assert.deepEqual(top.map((t) => t.score), [50, 49, 48, 47, 46]);
});

test('a low-ranked niche story never gets in just because a section had room', async () => {
  const all = [
    ...HEADLINES.slice(0, 8).map((h, i) => c('us', h, 40 - i)),
    c('science', 'A 550-year-old sea arch collapses in Hawaii', 2),
    c('world', 'Regional museum closes after two centuries', 1),
  ];
  const { top, interests } = await chooseStories(all, approve);
  const chosen = [...top, ...interests].map((x) => x.title);
  assert.ok(!chosen.some((t) => /sea arch|museum/.test(t)), `niche got in: ${chosen.join(' | ')}`);
});

test('her interests get in even when they would never be top news', async () => {
  const all = [
    ...HEADLINES.slice(0, 8).map((h, i) => c('us', h, 40 - i)),
    c('us', 'Los Angeles braces for a heat wave this weekend', 0.5),
    c('business', 'Major newsrooms suspend shared White House coverage', 0.5),
    c('usc', 'Lincoln Riley fired after fourth straight loss', 0.5),
  ];
  const { interests } = await chooseStories(all, approve);
  const titles = interests.map((x) => x.title);
  assert.ok(titles.some((t) => /Los Angeles/.test(t)), 'LA');
  assert.ok(titles.some((t) => /newsrooms/.test(t)), 'journalism');
  assert.ok(titles.some((t) => /Riley/.test(t)), 'a big USC story');
  assert.ok(interests.length <= MAX_INTERESTS);
  assert.ok(interests.every((x) => x.tier === 'interest'));
});

test('journalism, PR, pop culture and media count as her interests', () => {
  for (const t of [
    'Major newsrooms suspend shared White House coverage',
    'PR firm faces backlash over crisis communications',
    'Taylor Swift album breaks streaming records',
    'Netflix and Paramount reshape the streaming wars',
  ]) {
    assert.ok(isMediaOrCulture(t), `should count: ${t}`);
  }
  assert.ok(!isMediaOrCulture('Senate passes the spending bill'), 'politics is not media');
});

test('a routine USC note is not an interest; a big one is', async () => {
  const all = [
    ...HEADLINES.slice(0, 6).map((h, i) => c('us', h, 40 - i)),
    c('usc', 'USC practice report: three players day-to-day', 5),
    c('usc', 'USC ranked No. 12 in the preseason poll', 5),
  ];
  const { interests } = await chooseStories(all, approve);
  const titles = interests.map((x) => x.title);
  assert.ok(titles.some((t) => /ranked/.test(t)));
  assert.ok(!titles.some((t) => /practice report/.test(t)));
});
