import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBrief, isFatal } from '../lib/write';
import type { Cluster } from '../lib/select';
import type { Section } from '../lib/feeds';

function cluster(id: number, section: Section = 'world'): Cluster {
  return {
    id, title: `Story ${id}`, section, blurb: '', link: `https://e.com/${id}`,
    source: 'NPR', coverage: [], publishedAt: new Date(), score: 1,
  };
}

// A realistic candidate set: enough world stories, plus sports and USC.
const CLUSTERS = [
  ...Array.from({ length: 8 }, (_, i) => cluster(i + 1)),
  cluster(9, 'sports'),
  cluster(10, 'usc'),
];

/** A well-formed paragraph citing two given ids. */
const para = (a: number, b: number) =>
  `Iran and Oman moved closer to a deal on the Strait of Hormuz, [reported in talks](#${a}). ` +
  `The waterway carries much of the world's oil. Washington has kept warships nearby. ` +
  `Israel separately [struck southern Lebanon](#${b}). The ceasefire is under strain again.`;

// Sports (#9) opens, per the fixed order. #10 is USC.
const ok = () => ({
  subject: 'Hormuz deal nears as Israel strikes Lebanon',
  paragraphs: [para(9, 10), para(1, 2), para(3, 4), para(5, 6), para(7, 8)],
});

test('a well-formed brief passes', () => {
  assert.deepEqual(validateBrief(ok(), CLUSTERS), []);
});

const cases: [string, () => any, RegExp][] = [
  ['too few paragraphs', () => ({ ...ok(), paragraphs: [para(1, 2), para(3, 4)] }), /5-9 paragraphs/],
  ['too many paragraphs', () => ({ ...ok(), paragraphs: Array.from({ length: 10 }, () => para(1, 2)) }), /5-9 paragraphs/],
  ['a bulleted list', () => ({ ...ok(), paragraphs: [...ok().paragraphs.slice(1), '- Iran did a thing worth noting here today\n- Israel did another separate thing'] }), /bulleted or numbered list/],
  ['a raw URL', () => ({ ...ok(), paragraphs: [...ok().paragraphs.slice(1), para(1, 2).replace('(#1)', '(https://evil.com)')] }), /raw URL/],
  ['an unknown id', () => ({ ...ok(), paragraphs: [...ok().paragraphs.slice(1), para(1, 2).replace('(#1)', '(#999)')] }), /#999/],
  ['a "read more" anchor', () => ({ ...ok(), paragraphs: [...ok().paragraphs.slice(1), para(1, 2).replace('[reported in talks]', '[read more]')] }), /meaningful phrase/],
  ['a paragraph with no citations', () => ({ ...ok(), paragraphs: [...ok().paragraphs.slice(1), para(1, 2).replace(/\[([^\]]+)\]\(#\d+\)/g, '$1')] }), /no citations/],
  ['a mid-paragraph topic pivot', () => ({ ...ok(), paragraphs: [...ok().paragraphs.slice(1), 'The vote passed the chamber on Tuesday evening after debate. Meanwhile a drone was found at a German airport, and police opened an investigation into how [it got there](#3).'] }), /pivots to a new topic/],
];

for (const [label, make, pattern] of cases) {
  test(`rejects ${label}`, () => {
    const problems = validateBrief(make(), CLUSTERS);
    assert.ok(problems.length > 0, 'should report a problem');
    assert.ok(problems.some((p) => pattern.test(p)), `expected ${pattern}, got: ${problems.join(' | ')}`);
  });
}

test('rejects a brief that skips sports when sports was available', () => {
  const b = { ...ok(), paragraphs: [para(1, 2), para(3, 4), para(5, 6), para(7, 8), para(1, 10)] };
  const problems = validateBrief(b, CLUSTERS);
  assert.ok(problems.some((p) => /sports/.test(p)), problems.join(' | '));
});

test('USC is a preference, not a hard requirement', () => {
  // The Daily Trojan publishes weekly. Requiring USC daily either forces a
  // repeat of a story Rose already read or wastes a retry on a fine brief.
  const b = { ...ok(), paragraphs: [para(9, 1), para(2, 3), para(4, 5), para(6, 7), para(8, 1)] };
  assert.ok(!validateBrief(b, CLUSTERS).some((p) => /USC/.test(p)));
});

test('does not demand sports when none was available', () => {
  const worldOnly = Array.from({ length: 10 }, (_, i) => cluster(i + 1));
  assert.deepEqual(validateBrief(ok(), worldOnly), []);
});

test('rejects a paragraph that is mostly link text', () => {
  const dense =
    `[This entire opening clause is one enormous anchor that runs on](#9) and ` +
    `[here is a second very long anchor consuming the remaining text](#2) plus [a third](#3).`;
  const problems = validateBrief({ ...ok(), paragraphs: [dense, para(3, 4), para(5, 6), para(7, 8), para(1, 10)] }, CLUSTERS);
  assert.ok(problems.some((p) => /mostly link text/.test(p)), problems.join(' | '));
});

test('rejects a brief with no good news when good news was available', () => {
  const withGood = [...CLUSTERS, cluster(11, 'good')];
  const problems = validateBrief(ok(), withGood);
  assert.ok(problems.some((p) => /good-news/.test(p)), problems.join(' | '));
});

test('accepts a brief that includes the good news', () => {
  const withGood = [...CLUSTERS, cluster(11, 'good')];
  const b = { ...ok(), paragraphs: [para(9, 10), para(1, 2), para(3, 4), para(5, 6), para(11, 7)] };
  assert.deepEqual(validateBrief(b, withGood), []);
});

test('does not demand good news when none was available', () => {
  assert.deepEqual(validateBrief(ok(), CLUSTERS), []);
});

test('good news must close, but the opening is free', () => {
  const cs = [...CLUSTERS, cluster(11, 'good')];
  // Good news buried in the middle — only that rule should fire.
  const wrong = { ...ok(), paragraphs: [para(1, 2), para(11, 3), para(4, 5), para(6, 7), para(9, 8)] };
  const problems = validateBrief(wrong, cs);
  assert.ok(problems.some((p) => /CLOSE with the good news/.test(p)), problems.join(' | '));
  assert.ok(!problems.some((p) => /OPEN with sports/.test(p)), 'the opening is not fixed');
});

test('any section may open the email', () => {
  const cs = [...CLUSTERS, cluster(11, 'good')];
  // News-first, sports-first and USC-first should all be acceptable.
  for (const first of [para(1, 2), para(9, 1), para(10, 1)]) {
    const b = { ...ok(), paragraphs: [first, para(3, 4), para(5, 6), para(9, 7), para(11, 8)] };
    assert.deepEqual(validateBrief(b, cs), [], `opening should be allowed: ${first.slice(0, 30)}`);
  }
});

test('accepts the correct order', () => {
  const cs = [...CLUSTERS, cluster(11, 'good')];
  const right = { ...ok(), paragraphs: [para(9, 1), para(2, 3), para(4, 5), para(6, 7), para(11, 8)] };
  assert.deepEqual(validateBrief(right, cs), []);
});

test('rejects a foreign story sandwiched between US stories', () => {
  const cs = [
    cluster(1, 'us'), cluster(2, 'us'), cluster(3, 'world'), cluster(4, 'us'),
    cluster(5, 'us'), cluster(6, 'us'), cluster(7, 'us'), cluster(8, 'us'),
    cluster(9, 'sports'), cluster(10, 'good'),
  ];
  const b = { ...ok(), paragraphs: [para(9, 1), para(1, 2), para(3, 3), para(4, 5), para(10, 6)] };
  const problems = validateBrief(b, cs);
  assert.ok(problems.some((p) => /before any foreign story/.test(p)), problems.join(' | '));
});

test('accepts all US news ahead of foreign news', () => {
  const cs = [
    cluster(1, 'us'), cluster(2, 'us'), cluster(3, 'world'), cluster(4, 'us'),
    cluster(5, 'us'), cluster(6, 'us'), cluster(7, 'us'), cluster(8, 'us'),
    cluster(9, 'sports'), cluster(10, 'good'),
  ];
  const b = { ...ok(), paragraphs: [para(9, 1), para(2, 4), para(5, 6), para(3, 3), para(10, 7)] };
  assert.deepEqual(validateBrief(b, cs), []);
});

test('requires a tech story when a mainstream outlet carried one', () => {
  const techCluster: Cluster = { ...cluster(11, 'tech'), source: 'The New York Times' };
  const cs = [...CLUSTERS, techCluster];
  const problems = validateBrief(ok(), cs);
  assert.ok(problems.some((p) => /major tech story/.test(p)), problems.join(' | '));
});

test('does not require tech when only the niche press covered it', () => {
  const niche: Cluster = { ...cluster(11, 'tech'), source: 'Ars Technica' };
  assert.ok(!validateBrief(ok(), [...CLUSTERS, niche]).some((p) => /major tech/.test(p)));
});

test('two outlets on a tech story makes it required even without a big desk', () => {
  const corroborated: Cluster = {
    ...cluster(11, 'tech'), source: 'Ars Technica',
    coverage: [{ source: 'Ars Technica', link: 'x' }, { source: 'The Verge', link: 'y' }],
  };
  const problems = validateBrief(ok(), [...CLUSTERS, corroborated]);
  assert.ok(problems.some((p) => /major tech story/.test(p)), problems.join(' | '));
});

test('accepts a brief that includes the tech story', () => {
  const techCluster: Cluster = { ...cluster(11, 'tech'), source: 'The New York Times' };
  const cs = [...CLUSTERS, techCluster];
  const b = { ...ok(), paragraphs: [para(9, 10), para(1, 2), para(11, 3), para(4, 5), para(6, 7)] };
  assert.deepEqual(validateBrief(b, cs), []);
});

test('the lead may be foreign; the rest still runs US before foreign', () => {
  const cs = [
    cluster(1, 'world'), cluster(2, 'us'), cluster(3, 'us'), cluster(4, 'world'),
    cluster(5, 'us'), cluster(6, 'us'), cluster(7, 'us'), cluster(8, 'us'),
    cluster(9, 'sports'), cluster(10, 'good'),
  ];
  // Foreign lead, then US, then foreign, sports, good — allowed.
  const okLead = {
    ...ok(),
    paragraphs: [para(1, 1), para(2, 3), para(5, 6), para(4, 4), para(9, 9), para(10, 7)],
  };
  assert.deepEqual(validateBrief(okLead, cs), []);

  // Foreign in the body followed by US — still rejected.
  const bad = {
    ...ok(),
    paragraphs: [para(2, 2), para(4, 4), para(5, 6), para(7, 8), para(9, 9), para(10, 3)],
  };
  assert.ok(validateBrief(bad, cs).some((p) => /before any foreign story/.test(p)));
});

test('school violence in the finished prose is fatal, never shipped', () => {
  const bad = {
    ...ok(),
    paragraphs: [
      para(9, 10),
      'A gunman opened fire at a high school in Ohio this week, and officials [confirmed the lockdown](#1). ' +
        'Classes resume Monday. The district has not commented further. Parents are asking questions.',
      para(3, 4), para(5, 6), para(7, 8),
    ],
  };
  const problems = validateBrief(bad, CLUSTERS);
  assert.ok(problems.some((p) => /school violence/.test(p)), problems.join(' | '));
  assert.ok(isFatal(problems.find((p) => /school violence/.test(p))!), 'must block the send');
});

test('a mid-paragraph pivot is repaired, never a reason to send nothing', () => {
  // Raised twice as a reader complaint, so it is no longer merely cosmetic.
  const b = {
    ...ok(),
    paragraphs: [
      para(9, 10),
      'Rosh Hashanah arrives Friday and opens the High Holy Days. Meanwhile a stretch of ' +
        'ocean is becoming a reserve, [protecting fish stocks](#1) for local residents there.',
      para(3, 4), para(5, 6), para(7, 8),
    ],
  };
  const problems = validateBrief(b, CLUSTERS);
  const pivot = problems.find((p) => /pivots to a new topic/.test(p));
  assert.ok(pivot, problems.join(' | '));
  // Cost Rose an entire edition on Aug 18 when it was fatal.
  assert.ok(!isFatal(pivot!), 'a formatting slip must never block the send');
});
