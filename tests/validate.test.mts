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
  ['too many paragraphs', () => ({ ...ok(), paragraphs: Array.from({ length: 13 }, () => para(1, 2)) }), /5-9 paragraphs/],
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

test('no good-news rule survives — the section was removed entirely', () => {
  // Peter: "the good news stuff seems really random. lets remove it." Nothing
  // may demand, order, or reserve a closing slot for it any more.
  const problems = validateBrief(ok(), CLUSTERS);
  assert.ok(!problems.some((p) => /good.news/i.test(p)), problems.join(' | '));
  assert.deepEqual(problems, [], 'an ordinary brief is simply valid now');
});

test('any section may open the email', () => {
  // News-first, sports-first and USC-first should all be acceptable.
  for (const first of [para(1, 2), para(9, 1), para(10, 1)]) {
    const b = { ...ok(), paragraphs: [first, para(3, 4), para(5, 6), para(9, 7), para(8, 1)] };
    assert.deepEqual(validateBrief(b, CLUSTERS), [], `opening should be allowed: ${first.slice(0, 30)}`);
  }
});

test('accepts the correct order', () => {
  const right = { ...ok(), paragraphs: [para(9, 1), para(2, 3), para(4, 5), para(6, 7), para(8, 10)] };
  assert.deepEqual(validateBrief(right, CLUSTERS), []);
});

test('rejects a foreign story sandwiched between US stories', () => {
  const cs = [
    cluster(1, 'us'), cluster(2, 'us'), cluster(3, 'world'), cluster(4, 'us'),
    cluster(5, 'us'), cluster(6, 'us'), cluster(7, 'us'), cluster(8, 'us'),
    cluster(9, 'sports'), cluster(10, 'usc'),
  ];
  const b = { ...ok(), paragraphs: [para(9, 1), para(1, 2), para(3, 3), para(4, 5), para(10, 6)] };
  const problems = validateBrief(b, cs);
  assert.ok(problems.some((p) => /before any foreign story/.test(p)), problems.join(' | '));
});

test('accepts all US news ahead of foreign news', () => {
  const cs = [
    cluster(1, 'us'), cluster(2, 'us'), cluster(3, 'world'), cluster(4, 'us'),
    cluster(5, 'us'), cluster(6, 'us'), cluster(7, 'us'), cluster(8, 'us'),
    cluster(9, 'sports'), cluster(10, 'usc'),
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
    cluster(9, 'sports'), cluster(10, 'usc'),
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

test('a paragraph citing nothing is dropped, not sent', async () => {
  const { dropUncited } = await import('../lib/write');
  // How a Rosh Hashanah line reached Rose on a day the holiday was not a
  // candidate: no id behind it, because there was no candidate to cite.
  const fabricated = 'Rosh Hashanah, the Jewish new year, arrives in a few weeks.';
  const out = dropUncited([para(9, 10), para(1, 2), para(3, 4), para(5, 6), para(7, 8), fabricated]);
  assert.ok(!out.includes(fabricated), 'uncited paragraph must go');
  assert.equal(out.length, 5);
});

test('dropping uncited paragraphs never shrinks a brief below sendable', async () => {
  const { dropUncited } = await import('../lib/write');
  // Repair, not rejection: better a slightly loose brief than no email.
  const thin = [para(1, 2), para(3, 4), 'No citations here at all.', 'Nor here.'];
  assert.deepEqual(dropUncited(thin), thin);
});

test('prosecution and conviction stories are treated as crime', async () => {
  const { isViolentCrime } = await import('../lib/ingest');
  for (const t of [
    'L.A. prosecutor reduces charges against officer who recorded colleagues',
    'Former executive convicted of fraud in federal court',
    'Man pleads guilty in long-running case',
    'Judge sentenced the defendant on Tuesday',
  ]) {
    assert.ok(isViolentCrime(t), `should be filtered: ${t}`);
  }
});

test('the crime filter still leaves ordinary news alone', async () => {
  const { isViolentCrime } = await import('../lib/ingest');
  for (const t of [
    'US national debt passes $40 trillion for the first time',
    'Stripe to buy AI startup OpenRouter for $7.5 billion',
    'USC football gears up for 2026 with playoff goals',
    'Archaeologists triple the scale of an ancient Amazonian civilization',
    'Senate passes spending bill after long debate',
  ]) {
    assert.ok(!isViolentCrime(t), `should NOT be filtered: ${t}`);
  }
});

test('every validation rule declares its own severity', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../lib/write.ts', import.meta.url), 'utf8');
  // Whether Rose gets an email used to depend on whether a problem's WORDING
  // matched a regex, so adding a rule or rewording a message silently changed
  // who got mail. Rules must call fatal() or nit() and say which they are.
  const raw = src.split('\n').filter((l) => /problems\.push\(/.test(l) && !/=> problems\.push\(/.test(l));
  assert.deepEqual(raw, [], `these rules bypass fatal()/nit():\n${raw.join('\n')}`);
});

test('severity survives rewording a message', async () => {
  const { isFatal } = await import('../lib/write');
  // The old check keyed on phrases like "paragraphs, got". Prose must not decide.
  assert.ok(!isFatal('Need 5-9 paragraphs, got 10.'), 'wording alone is not fatal');
  assert.ok(!isFatal('Only 2 distinct stories cited. Cover more of the day.'));
});

test('problem text reaches the model without the severity marker', async () => {
  const { problemText } = await import('../lib/write');
  const bad = { ...ok(), paragraphs: [para(1, 2), para(3, 4)] };
  for (const p of validateBrief(bad, CLUSTERS)) {
    assert.ok(!problemText(p).startsWith('FATAL'), `leaked marker: ${p}`);
  }
});

test('food-safety and pathogen stories are filtered as disease', async () => {
  const { isDistressing } = await import('../lib/ingest');
  for (const t of [
    'Blueberry recall upgraded to highest risk category over possible E. coli',
    'Publix frozen berry recall expanded after contamination found',
    'Salmonella outbreak linked to onions sickens dozens',
    'Listeria found in packaged salad prompts recall',
    'CDC issues health alert over rising norovirus cases',
    'Bird flu detected in commercial poultry flock',
  ]) {
    assert.ok(isDistressing(t), `should be filtered: ${t}`);
  }
});

test('an ordinary product recall is not mistaken for disease news', async () => {
  const { isDistressing } = await import('../lib/ingest');
  // The filter is scoped to food and health on purpose.
  for (const t of [
    'Toyota recalls 300,000 trucks over a steering defect',
    'Apple recalls a laptop charger design',
  ]) {
    assert.ok(!isDistressing(t), `should NOT be filtered: ${t}`);
  }
});

test('fires are blocked however the headline names them', async () => {
  const { isDistressing } = await import('../lib/ingest');
  // Fires are named after places, not after the word "wildfire". "Ross Fire
  // still burning, 85,000 acres scorched" reached a draft past every pattern
  // that only looked for "wildfire" or "blaze".
  for (const t of [
    'Ross Fire still burning after a week, with 85,000 acres scorched',
    'Palisades Fire forces evacuations in Los Angeles',
    'Crews reach 40% containment on the Camp Fire',
    'Fire crews battle blaze near Malibu',
    'Wildfire still burning after a week',
  ]) {
    assert.ok(isDistressing(t), `should be filtered: ${t}`);
  }
});

test('ordinary English ending in "fire" is not a fire story', async () => {
  const { isDistressing } = await import('../lib/ingest');
  for (const t of [
    'Trump comes under fire from Senate Republicans',
    'Gaza ceasefire holds for a third week',
    'Senate passes spending bill after long debate',
  ]) {
    assert.ok(!isDistressing(t), `should NOT be filtered: ${t}`);
  }
});

test('trivia is demoted hard, and never closes the email as good news', async () => {
  const { isTrivia, TRIVIA_DEMOTION } = await import('../lib/select');
  // A betting-market ban outranked a government shutdown vote because two
  // outlets happened to carry it. Corroboration is not importance.
  for (const t of [
    'Kalshi bans ex-congressman George Santos for life after suspicious trades',
    'Met Gala exhibition honoring John Galliano is cancelled after backlash',
    '‘I Work, I Sleep, I Eat, I Ferret’: Notes From an Obsessive Subculture',
    '10 best things to do this weekend',
  ]) {
    assert.ok(isTrivia(t), `should be trivia: ${t}`);
  }
  for (const t of [
    'House returns with vote expected on Senate bill to prevent shutdown',
    'US and Iran trade strikes for first time in weeks',
    'USC football gears up for 2026 with playoff goals',
  ]) {
    assert.ok(!isTrivia(t), `should NOT be trivia: ${t}`);
  }
  assert.ok(TRIVIA_DEMOTION < 0.25, 'demotion must actually bury it');
});

test('a big USC story must be cited when one is available', async () => {
  const { isBigUscStory } = await import('../lib/write');
  // The empty-seats story sat unused in the candidate list because USC was
  // purely optional. Peter: "yes if it's a big story like this one."
  const big = {
    ...cluster(11, 'usc'),
    title: "USC's empty seats show fans still haven't bought in on Lincoln Riley's hype",
  };
  assert.ok(isBigUscStory(big.title));
  // Deliberately cites no USC story, so the new rule is what fires.
  const noUsc = { ...ok(), paragraphs: [para(9, 1), para(1, 2), para(3, 4), para(5, 6), para(7, 8)] };
  const problems = validateBrief(noUsc, [...CLUSTERS, big]);
  assert.ok(problems.some((p) => /significant USC story/.test(p)), problems.join(' | '));
});

test('routine USC beat coverage is still never forced', async () => {
  const { isBigUscStory } = await import('../lib/write');
  for (const t of [
    'USC practice report: three players day-to-day',
    'USC depth chart notes ahead of Saturday',
    'CPT rule change affects internship opportunities for USC students',
  ]) {
    assert.ok(!isBigUscStory(t), `should stay optional: ${t}`);
  }
  const minor = { ...cluster(11, 'usc'), title: 'USC practice report: three players day-to-day' };
  assert.ok(!validateBrief(ok(), [...CLUSTERS, minor]).some((p) => /significant USC/.test(p)));
});

test('citing the USC story satisfies the rule', () => {
  const big = { ...cluster(11, 'usc'), title: 'Lincoln Riley fired after fourth straight loss' };
  const b = { ...ok(), paragraphs: [para(9, 10), para(1, 2), para(3, 4), para(5, 6), para(11, 7)] };
  assert.ok(!validateBrief(b, [...CLUSTERS, big]).some((p) => /significant USC/.test(p)));
});
