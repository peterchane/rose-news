import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReportableNews } from '../lib/ingest';

/**
 * The counterweight to broad filtering.
 *
 * Every content miss in this project has been a word variant — "die" not
 * "dies", "fatally" not "fatal", "shot" not "shoot", "acres scorched" not
 * "acres burned". The fix is to match word stems, and the risk of matching
 * stems is that ordinary news starts disappearing too.
 *
 * So this is the floor: real headlines, across every section Rose gets, that
 * must always reach her. Broaden the filters as far as you like; this is what
 * says you went too far.
 */
const MUST_SURVIVE = [
  // Politics and government
  'Senate passes spending bill after long debate',
  'House returns with a stopgap funding bill atop the agenda',
  'Supreme Court hears arguments over tariff powers',
  'Trump signs executive order on federal hiring',
  'Governor Newsom signs a package of housing bills',
  'Voters head to the polls in three states Tuesday',
  'Federal Reserve raises interest rates for the first time since 2023',
  'Congress reaches a deal to avoid a shutdown',

  // Economy and business
  'Inflation cools for a third straight month',
  'Stripe to buy AI startup OpenRouter for $7.5 billion',
  'Union settles contract talks with the airline',
  'Nvidia settles a patent dispute with Qualcomm',
  'Oil prices climb above $90 a barrel',
  'Mortgage demand from homebuyers drops 19% from a year ago',
  'Ford cuts truck prices to move inventory',

  // Tech and science
  'OpenAI ad business hits a $1 billion run rate',
  'Bank of England governor warns AI could raise cyber risks',
  'Astronomers confirm thousands of planets beyond our solar system',
  'Scientists find a giant dinosaur in Brazil',
  'China lands a reusable rocket for the first time',
  'Researchers triple the known scale of an ancient Amazonian civilization',

  // Sports
  'USC beats Michigan in the season opener',
  'Cubs clinch a playoff spot with a win over the Brewers',
  'SMU names a new starting quarterback',
  "USC's empty seats show fans still haven't bought in on Lincoln Riley",
  'Michigan hires a new offensive coordinator',

  // Campus and everyday
  'USC opens a new student center on campus',
  'California requires financial literacy courses in every high school',
  'Solar power passes 3 terawatts worldwide',
  'CBS News poll finds voters split on the economy',
  'Ukraine says Russia attacked its power grid overnight',
  'Hackers attacked the city water system, officials say',
  'Knife-edge vote expected in the Senate',
];

test('ordinary news survives the content filters', () => {
  const blocked = MUST_SURVIVE.filter((t) => !isReportableNews(t, 'https://example.com/news/x'));
  assert.deepEqual(blocked, [], `the filters are too broad — these were dropped:\n${blocked.join('\n')}`);
});

/**
 * The other half of the floor: variants that must NOT reach her. Every one of
 * these is a word form that slipped past an exact-match pattern at some point.
 */
const MUST_BLOCK = [
  'Three people drowned after a boat capsized',
  'Hostages released after a week-long standoff',
  'Report details torture at a detention site',
  'Dozens wounded in a market blast',
  'Riots break out after the verdict',
  'Famine spreads as aid convoys stall',
  'A stabbing outside the stadium is under investigation',
  'Man charged with murdering his neighbour',
  'Police hunt for the kidnappers',
  'Woman abducted from her home is found safe',
  'Killings rise in the capital',
  'The deadliest month on record',
  'Alabama inmate to die by lethal injection',
  'Uber to Pay $40 Million to Parents of Woman Fatally Hit by Car',
  'Ross Fire still burning, with 90,000 acres scorched',
  'A program in a Texas prison teaches incarcerated women to transcribe braille',
  // Rate tables and shopping guides: useful to somebody, not news, and Rose
  // has no savings to move.
  'Best High-Yield Savings Accounts for September 2026: Up to 4.50%',
  'The best credit cards for travel in 2026',
  'Our picks: the best budgeting apps',
  'Top mortgage rates this week',
  // Programme listings: a schedule, not a story. One reached Rose as a
  // paragraph about what her grandparents might watch over breakfast.
  'This week on "Sunday Morning" (Sept. 27)',
  'Tonight on 60 Minutes: an interview with the governor',
  'Full episode: Face the Nation, September 27',
  'Coming up on Meet the Press this Sunday',
  // One person attacking another. The Flydubai axe attack matched no verb and
  // no weapon on the list, and took a paragraph.
  'UAE says the Flydubai co-pilot who attacked his captain mid-flight used a crash axe',
  'Man attacked his neighbour with a hammer',
  'Passenger armed with a knife subdued on a flight',
];

test('word variants do not slip past the filters', () => {
  const missed = MUST_BLOCK.filter((t) => isReportableNews(t, 'https://example.com/news/x'));
  assert.deepEqual(missed, [], `these variants got through:\n${missed.join('\n')}`);
});

/**
 * Stems are the right tool and they cut both ways: `\bstab\w*` matched
 * "stability", which quietly dropped a Trump-Xi trade story three outlets ran.
 * These are innocent words that contain a blocked stem.
 */
const INNOCENT_LOOKALIKES = [
  'Trump and Xi seek trade stability as tariffs loom',
  'The killer app for AI is still unclear, analysts say',
  'Analysts expect market stability through the quarter',
  'A deadline looms for the funding bill',
  'The company established a new research arm',
  'Riotous applause greeted the announcement',
];

test('innocent words containing a blocked stem are not filtered', () => {
  const blocked = INNOCENT_LOOKALIKES.filter((t) => !isReportableNews(t, 'https://example.com/news/x'));
  assert.deepEqual(blocked, [], `stems are over-matching:\n${blocked.join('\n')}`);
});

/**
 * USC now arrives via Google News, because the Daily Trojan serves Cloudflare
 * bot protection to any server that asks — a 403 on the whole site, not just
 * the feed. An aggregator brings beat-blog filler alongside real coverage.
 */
test('aggregator filler is dropped, real USC news is not', async () => {
  const { isReportableNews, stripOutletSuffix } = await import('../lib/ingest');
  for (const t of [
    'Football vs USC Trojans on 10/28/2000 - Box Score',
    'Louisiana Ragin Cajuns vs. USC Trojans: Full Highlights',
    'Tale of the Tape for Oregon Ducks vs USC Trojans',
    'Oregon vs. USC Football Prediction & Odds - Sept. 26',
  ]) {
    assert.ok(!isReportableNews(t, 'https://news.google.com/x'), `should drop: ${t}`);
  }
  for (const t of [
    'Laura Abrams installed as dean of USC social work school',
    "USC's empty seats show fans still haven't bought in on Lincoln Riley",
    'Risks faced by teens online vary by platform, USC study shows',
  ]) {
    assert.ok(isReportableNews(t, 'https://news.google.com/x'), `should keep: ${t}`);
  }

  // The outlet is credited from the feed's own source tag, not left in the title.
  assert.equal(stripOutletSuffix('Oregon adds a twist - Sports Illustrated', 'Sports Illustrated'), 'Oregon adds a twist');
  assert.equal(stripOutletSuffix('A headline with - a dash in it', null), 'A headline with - a dash in it');
});

/**
 * Sexual violence, absolutely. Peter: "never show rape stories." Checked
 * against the summary as well as the headline — "Cornell University Rape
 * Investigation" reached the list of stories the writer was told it MUST cover.
 */
test('sexual violence never reaches her, headline or summary', async () => {
  const { isReportableNews, isSexualViolence } = await import('../lib/ingest');
  for (const t of [
    'Cornell University Rape Investigation: What We Know',
    'Alleged Cornell fraternity rape case will be reopened',
    'Coach charged with sexual assault of a student',
    'Report details sexual abuse at a youth camp',
  ]) {
    assert.ok(!isReportableNews(t, 'https://e.com/n/x'), `should be blocked: ${t}`);
  }
  // A clean headline with the detail only in the summary is still blocked.
  assert.ok(
    !isReportableNews('Cornell reopens an investigation', 'https://e.com/n/x', 'us',
      'The case involves an alleged rape at a fraternity house.'),
    'the summary alone is enough',
  );
  assert.ok(!isSexualViolence('Grape harvest begins early in Napa'), 'grape is not rape');
});

test('sexual violence in the finished prose is fatal', async () => {
  const { validateBrief, isFatal } = await import('../lib/write');
  const p = (n: number) =>
    `Officials moved to settle a long dispute this week, [according to talks](#${n}). ` +
    `The decision lands after months of pressure. Negotiators met for two days.`;
  const clusters = [1, 2, 3, 4, 5].map((id) => ({
    id, title: `Story ${id}`, section: 'us' as const, blurb: '', link: 'https://e.com/x',
    source: 'NPR', coverage: [], publishedAt: new Date(), score: 1,
  }));
  const bad = { subject: 'x', paragraphs: [p(1), p(2), p(3), 'An alleged rape at a fraternity [was reported](#4).', p(5)] };
  assert.ok(validateBrief(bad, clusters).some((x) => /sexual violence/.test(x) && isFatal(x)));
});

test('executions are blocked however the state phrases it', async () => {
  const { isReportableNews } = await import('../lib/ingest');
  for (const t of [
    'Tennessee is set to execute a woman for the first time in decades',
    'Texas executes a man convicted in 1998',
    'Oklahoma plans to execute two inmates next month',
  ]) {
    assert.ok(!isReportableNews(t, 'https://e.com/n/x'), `should be blocked: ${t}`);
  }
  for (const t of ['Company executed its merger plan ahead of schedule', 'USC executes a comeback in the fourth quarter']) {
    assert.ok(isReportableNews(t, 'https://e.com/n/x'), `should survive: ${t}`);
  }
});
