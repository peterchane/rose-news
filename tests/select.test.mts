import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectClusters } from '../lib/select';
import type { Article } from '../lib/ingest';
import type { Section } from '../lib/feeds';

const QUOTAS: Record<Section, number> = {
  us: 4, world: 5, business: 3, tech: 3, science: 3, sports: 2, usc: 2, jewish: 1,
};

let seq = 0;
function article(over: Partial<Article> = {}): Article {
  seq++;
  return {
    title: `Story number ${seq} about something`,
    link: `https://example.com/a${seq}`,
    source: 'NPR',
    section: 'world',
    weight: 1,
    publishedAt: new Date(Date.now() - 60 * 60 * 1000),
    // Mid-feed by default, so placement doesn't quietly skew existing cases.
    rank: 20,
    blurb: 'A blurb that is long enough to be chosen as the cluster blurb for testing.',
    ...over,
  };
}

test('merges the same story reported by different outlets', () => {
  const clusters = selectClusters(
    [
      article({ title: 'Iran and Oman reach deal on Strait of Hormuz', source: 'BBC' }),
      article({ title: 'Iran says Hormuz deal with Oman is final', source: 'NPR' }),
    ],
    QUOTAS,
  );
  assert.equal(clusters.length, 1, 'both headlines describe one story');
  assert.equal(clusters[0].coverage.length, 2);
});

test('keeps genuinely different stories apart', () => {
  const clusters = selectClusters(
    [
      article({ title: 'Iran and Oman reach deal on Strait of Hormuz', source: 'BBC' }),
      article({ title: 'Dodgers beat Giants in extra innings', source: 'ESPN' }),
    ],
    QUOTAS,
  );
  assert.equal(clusters.length, 2);
});

test('one outlet covering a story twice counts as a single source', () => {
  const clusters = selectClusters(
    [
      article({ title: 'Kyiv struck by missile barrage overnight', source: 'BBC' }),
      article({ title: 'Kyiv hit by missile barrage, 17 killed', source: 'BBC' }),
    ],
    QUOTAS,
  );
  assert.equal(clusters[0].coverage.length, 1, 'coverage is deduped by outlet');
});

test('corroborated stories outrank single-source ones', () => {
  const clusters = selectClusters(
    [
      article({ title: 'Solo scoop nobody else carried today', source: 'NPR' }),
      article({ title: 'Major summit ends with signed agreement', source: 'BBC' }),
      article({ title: 'Summit ends after leaders sign agreement', source: 'NPR' }),
      article({ title: 'Leaders sign agreement as summit ends', source: 'The Guardian' }),
    ],
    QUOTAS,
  );
  assert.match(clusters[0].title, /[Ss]ummit/, 'the three-outlet story leads');
});

test('respects each section quota', () => {
  const subjects = [
    'Senate confirms new ambassador to Brazil',
    'Wildfire forces evacuations across rural Idaho',
    'Central bank holds interest rates steady',
    'Ferry capsizes off the coast of Indonesia',
    'Parliament dissolves ahead of snap elections',
    'Drought empties reservoirs across the Maghreb',
    'Volcano erupts on a remote Pacific island',
    'Trade delegation walks out of Geneva talks',
    'Museum recovers a painting stolen in 1974',
    'Rail strike halts freight across the Midwest',
  ];
  const many = subjects.map((title) => article({ title, section: 'world' }));
  const clusters = selectClusters(many, QUOTAS);
  assert.equal(clusters.filter((c) => c.section === 'world').length, QUOTAS.world);
});

test('caps how much of a section one outlet can fill', () => {
  // 10 distinct NYT stories and 2 from NPR, for a 5-slot section.
  const nyt = [
    'Senate confirms ambassador to Brazil',
    'Wildfire forces evacuations in Idaho',
    'Central bank holds rates steady',
    'Ferry capsizes off Indonesia',
    'Parliament dissolves before elections',
    'Drought empties Maghreb reservoirs',
    'Volcano erupts on Pacific island',
    'Trade delegation exits Geneva talks',
  ].map((title) => article({ title, source: 'The New York Times' }));
  const npr = [
    'Museum recovers painting stolen in 1974',
    'Rail strike halts Midwest freight',
  ].map((title) => article({ title, source: 'NPR' }));
  const world = selectClusters([...nyt, ...npr], QUOTAS).filter((c) => c.section === 'world');
  const fromNyt = world.filter((c) => c.source === 'The New York Times').length;
  assert.ok(fromNyt < world.length, 'NYT does not take every slot');
  assert.ok(world.some((c) => c.source === 'NPR'), 'the smaller outlet gets in');
});

test('a story spanning two sections is assigned to one of them', () => {
  const clusters = selectClusters(
    [
      article({ title: 'Oil prices jump as Hormuz tensions rise', section: 'world', source: 'BBC' }),
      article({ title: 'Hormuz tensions send oil prices jumping', section: 'business', source: 'CNBC' }),
    ],
    QUOTAS,
  );
  assert.equal(clusters.length, 1, 'clustering crosses sections');
  assert.equal(clusters[0].coverage.length, 2);
});

test('ids are stable, sequential, and unique', () => {
  const clusters = selectClusters(
    Array.from({ length: 6 }, (_, i) => article({ title: `Topic ${i} with wholly separate content ${i}` })),
    QUOTAS,
  );
  assert.deepEqual(
    clusters.map((c) => c.id),
    clusters.map((_, i) => i + 1),
  );
});

test('the highest-weighted outlet supplies the primary link', () => {
  const clusters = selectClusters(
    [
      article({ title: 'Court rules on landmark privacy case', source: 'ScienceDaily', weight: 0.7, link: 'https://low.example/a' }),
      article({ title: 'Landmark privacy case decided by court', source: 'BBC', weight: 1.0, link: 'https://high.example/a' }),
    ],
    QUOTAS,
  );
  assert.equal(clusters[0].link, 'https://high.example/a');
  assert.equal(clusters[0].source, 'BBC');
});

test('empty input yields no clusters instead of throwing', () => {
  assert.deepEqual(selectClusters([], QUOTAS), []);
});

// ── Favorite teams ─────────────────────────────────────────────────────────
import { buildTeamPattern, parseTeams } from '../lib/teams';

const TEAMS = buildTeamPattern(['Dodgers', 'Cubs', 'USC', 'Trojans', 'Chicago Bears', 'Michigan']);

test('a favorite team outranks a better-sourced story about another team', () => {
  const clusters = selectClusters(
    [
      // Three outlets, but a team Rose doesn't follow.
      article({ title: 'Guardians edge Royals in twelve innings', section: 'sports', source: 'ESPN' }),
      article({ title: 'Royals fall to Guardians in extras', section: 'sports', source: 'CBS Sports' }),
      article({ title: 'Guardians beat Royals after long night', section: 'sports', source: 'Yahoo Sports' }),
      // One outlet, but her team.
      article({ title: 'Cubs rally past Brewers on late homer', section: 'sports', source: 'ESPN' }),
    ],
    { ...QUOTAS, sports: 2 },
    TEAMS,
  );
  assert.match(clusters.filter(c => c.section === 'sports')[0].title, /Cubs/);
});

test('a team mentioned only in the summary gets a smaller boost', () => {
  const clusters = selectClusters(
    [
      article({ title: 'Rivals meet in season opener', section: 'sports', source: 'ESPN',
        blurb: 'The Dodgers travel east for a three-game set against a division leader.' }),
      article({ title: 'Padres win on walk-off single', section: 'sports', source: 'ESPN' }),
    ],
    { ...QUOTAS, sports: 2 },
    TEAMS,
  );
  assert.match(clusters.filter(c => c.section === 'sports')[0].title, /Rivals meet/);
});

test('team preference does not reorder non-sports news', () => {
  // "Michigan" in a politics headline must not jump the queue.
  const clusters = selectClusters(
    [
      article({ title: 'Michigan certifies its primary results', section: 'us', source: 'NPR' }),
      article({ title: 'Senate confirms new attorney general', section: 'us', source: 'BBC' }),
      article({ title: 'Senate vote confirms attorney general pick', section: 'us', source: 'NPR' }),
    ],
    { ...QUOTAS, us: 2 },
    TEAMS,
  );
  assert.match(clusters.filter(c => c.section === 'us')[0].title, /Senate/, 'corroboration still wins for news');
});

test('no team list configured means sports is not filtered or boosted', () => {
  // With no teams set there is nothing to prefer, so corroboration decides and
  // the relevance filter must not empty the section.
  const withNone = selectClusters(
    [
      article({ title: 'Cubs rally past Brewers', section: 'sports', source: 'ESPN' }),
      article({ title: 'Guardians edge Royals tonight', section: 'sports', source: 'ESPN' }),
      article({ title: 'Royals fall to Guardians again', section: 'sports', source: 'CBS Sports' }),
    ],
    { ...QUOTAS, sports: 1 },
    null, null, null,
  );
  assert.equal(withNone.length, 1, 'sports is still populated');
  assert.match(withNone[0].title, /Guardians|Royals/, 'corroboration decides when no teams are set');
});

test('teams.txt parses and covers what Peter asked for', async () => {
  const { readFileSync } = await import('node:fs');
  const teams = parseTeams(readFileSync('teams.txt', 'utf8'));
  const p = buildTeamPattern(teams)!;
  for (const t of ['USC beats UCLA', 'Trojans land recruit', 'SMU upsets rival',
                   'Michigan rolls', 'Cubs trade for closer']) {
    assert.ok(p.test(t), `should match: ${t}`);
  }
  // Teams she explicitly does not follow.
  for (const t of ['Yankees beat Red Sox', 'Dodgers win in extras', 'Lakers trade guard',
                   'Rams sign veteran', 'Chargers cut receiver', 'Clippers fall short',
                   'Chicago Bears sign QB']) {
    assert.ok(!p.test(t), `should NOT match: ${t}`);
  }
});

test('war is demoted unless broadly covered, and drops out of the quota', () => {
  const clusters = selectClusters(
    [
      // Single-outlet war story.
      article({ title: 'Missile strike hits eastern front line', section: 'world', source: 'BBC' }),
      // Ordinary two-outlet story.
      article({ title: 'Parliament approves the new budget', section: 'world', source: 'NPR' }),
      article({ title: 'Budget approved by parliament', section: 'world', source: 'The Guardian' }),
    ],
    { ...QUOTAS, world: 1 },
  );
  assert.match(clusters[0].title, /budget/i, 'the non-war story wins the only slot');
});

test('war still leads when it is genuinely top news', () => {
  const clusters = selectClusters(
    [
      article({ title: 'Missile strike hits the capital overnight', section: 'world', source: 'BBC' }),
      article({ title: 'Capital struck by missiles overnight', section: 'world', source: 'NPR' }),
      article({ title: 'Overnight missile strike on the capital', section: 'world', source: 'The Guardian' }),
      article({ title: 'Parliament approves the new budget', section: 'world', source: 'CNBC' }),
    ],
    { ...QUOTAS, world: 1 },
  );
  assert.match(clusters[0].title, /missile/i, 'three outlets makes it the lead');
});

// ── Notable-only teams (Cubs) ──────────────────────────────────────────────
import { NOTABLE_EVENT, parseTeamRules } from '../lib/teams';

const CUBS = buildTeamPattern(['Cubs']);

test('a routine Cubs game loses to another favorite team', () => {
  const clusters = selectClusters(
    [
      article({ title: 'Cubs 4, Reds 2 as bullpen holds late', section: 'sports', source: 'ESPN' }),
      article({ title: 'Dodgers rally past Giants in the ninth', section: 'sports', source: 'ESPN' }),
    ],
    { ...QUOTAS, sports: 1 },
    TEAMS, CUBS, NOTABLE_EVENT,
  );
  assert.match(clusters[0].title, /Dodgers/, 'a box score does not spend the slot');
});

test('a Cubs trade beats everything else', () => {
  const clusters = selectClusters(
    [
      article({ title: 'Cubs trade for All-Star closer before deadline', section: 'sports', source: 'ESPN' }),
      article({ title: 'Dodgers rally past Giants in the ninth', section: 'sports', source: 'ESPN' }),
      article({ title: 'Giants fall to Dodgers again', section: 'sports', source: 'CBS Sports' }),
    ],
    { ...QUOTAS, sports: 1 },
    TEAMS, CUBS, NOTABLE_EVENT,
  );
  assert.match(clusters[0].title, /Cubs trade/);
});

test('a Cubs streak counts as notable', () => {
  const clusters = selectClusters(
    [
      article({ title: 'Cubs extend winning streak to nine', section: 'sports', source: 'ESPN' }),
      article({ title: 'Rams sign veteran guard to extension', section: 'sports', source: 'ESPN' }),
    ],
    { ...QUOTAS, sports: 1 },
    TEAMS, CUBS, NOTABLE_EVENT,
  );
  assert.match(clusters[0].title, /streak/);
});

test('every team is notable-only by default', async () => {
  // "Dodgers won last night" is not news. Only a trade, streak, injury or
  // title earns a slot, for every team — not just the Cubs.
  const { readFileSync } = await import('node:fs');
  const rules = parseTeamRules(readFileSync('teams.txt', 'utf8'));
  assert.deepEqual(rules.always, [], 'nothing opted into every-game coverage');
  for (const t of ['USC', 'Trojans', 'Cubs', 'Michigan']) {
    assert.ok(rules.notableOnly.includes(t), `${t} should be notable-only`);
  }
});

test('a "+" prefix opts a team into every-game coverage', () => {
  const rules = parseTeamRules('+Dodgers\nCubs');
  assert.deepEqual(rules.always, ['Dodgers']);
  assert.deepEqual(rules.notableOnly, ['Cubs']);
});

test('a routine game loses to a notable event for the same team', () => {
  const dodgers = buildTeamPattern(['Dodgers']);
  const clusters = selectClusters(
    [
      article({ title: 'Dodgers come back to beat Tigers on Monday night', section: 'sports', source: 'ESPN' }),
      article({ title: 'Dodgers place ace on injured list', section: 'sports', source: 'ESPN' }),
    ],
    { ...QUOTAS, sports: 1 },
    null, dodgers, NOTABLE_EVENT,
  );
  assert.match(clusters[0].title, /injured list/);
});

test('a tech story carried by two outlets beats a single-outlet niche one', () => {
  const clusters = selectClusters(
    [
      article({ title: 'Firmware flaw exposes thousands of motherboards', section: 'tech', source: 'Ars Technica', weight: 0.6 }),
      article({ title: 'Meta fined $567m in child safety ruling', section: 'tech', source: 'The New York Times' }),
      article({ title: 'Meta hit with record child safety fine', section: 'tech', source: 'CNBC' }),
    ],
    { ...QUOTAS, tech: 1 },
  );
  assert.match(clusters.filter(c => c.section === 'tech')[0].title, /Meta/);
});

test('niche-outlet tech is demoted, mainstream single-outlet tech is not', () => {
  const clusters = selectClusters(
    [
      article({ title: 'Obscure firmware flaw found in server controllers', section: 'tech', source: 'Ars Technica', weight: 0.6 }),
      article({ title: 'Judge rules Meta must fund mental health programs', section: 'tech', source: 'The New York Times', weight: 1.0 }),
    ],
    { ...QUOTAS, tech: 2 },
  );
  const niche = clusters.find(c => /firmware/.test(c.title))!;
  const national = clusters.find(c => /Meta/.test(c.title))!;
  assert.ok(national.score > niche.score, 'the national story wins');
  assert.equal(clusters.filter(c => c.section === 'tech')[0].title, national.title);
});

test('a single mainstream tech story is not penalised against other news', () => {
  const clusters = selectClusters(
    [
      article({ title: 'Judge rules Meta caused public nuisance', section: 'tech', source: 'The New York Times', weight: 1.0 }),
      article({ title: 'Senate approves the budget bill', section: 'us', source: 'NPR', weight: 1.0 }),
    ],
    { ...QUOTAS, tech: 1, us: 1 },
  );
  const tech = clusters.find(c => c.section === 'tech')!;
  const us = clusters.find(c => c.section === 'us')!;
  assert.equal(tech.score, us.score, 'no penalty for being tech');
});

test('sports about a team she does not follow never takes a slot', () => {
  // A Jets practice injury reached Rose purely because the section had room.
  const clusters = selectClusters(
    [
      article({ title: 'Jets running back Breece Hall strains groin at practice', section: 'sports', source: 'ESPN' }),
      article({ title: 'Knicks waive veteran forward', section: 'sports', source: 'CBS Sports' }),
    ],
    { ...QUOTAS, sports: 3 },
    null, buildTeamPattern(['USC', 'Cubs']), NOTABLE_EVENT,
  );
  assert.equal(clusters.filter((c) => c.section === 'sports').length, 0, 'sports is empty, not filled');
});

test('her teams still get through', () => {
  const clusters = selectClusters(
    [
      article({ title: 'Jets running back strains groin at practice', section: 'sports', source: 'ESPN' }),
      article({ title: 'Cubs trade for All-Star closer', section: 'sports', source: 'ESPN' }),
    ],
    { ...QUOTAS, sports: 3 },
    null, buildTeamPattern(['USC', 'Cubs']), NOTABLE_EVENT,
  );
  const sp = clusters.filter((c) => c.section === 'sports');
  assert.equal(sp.length, 1);
  assert.match(sp[0].title, /Cubs/);
});

test("an outlet's own front-page placement counts as importance", async () => {
  const { placementBoost, LEAD_BOOST } = await import('../lib/select');
  // Discarding placement is why the day's lead could go missing: NPR's first
  // item and its fortieth scored identically.
  assert.equal(placementBoost(0), LEAD_BOOST, 'the lead story');
  assert.ok(placementBoost(0) > placementBoost(5), 'lead beats mid-page');
  assert.ok(placementBoost(5) > placementBoost(30), 'mid-page beats the tail');
  assert.equal(placementBoost(40), 1, 'deep in the feed earns nothing');
});

test('a front-page lead outranks a trivial story two outlets happened to run', () => {
  const clusters = selectClusters(
    [
      article({ title: 'US and Iran trade strikes near the Strait of Hormuz', section: 'us', rank: 0 }),
      article({ title: 'Kalshi bans a former congressman after suspicious trades', section: 'us', rank: 25, source: 'CBS News' }),
      article({ title: 'Kalshi bans a former congressman after suspicious trades', section: 'us', rank: 30, source: 'NBC News' }),
    ],
    QUOTAS,
  );
  assert.match(clusters[0].title, /Iran/, `lead should win: ${clusters.map((c) => c.title).join(' | ')}`);
});
