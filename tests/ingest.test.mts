import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedItems, isReportableNews, isViolentCrime, isMacabre, isDistressing, cleanUrl, stripHtml } from '../lib/ingest';
import type { Feed } from '../lib/feeds';

const feed: Feed = {
  source: 'Test',
  section: 'world',
  url: 'https://example.com/rss',
  weight: 1,
  maxAgeHours: 30,
};

const NOW = Date.parse('2026-08-05T12:00:00Z');
const rss = (items: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${items}</channel></rss>`;
const item = (title: string, link: string, when: string, desc = 'A blurb.') =>
  `<item><title>${title}</title><link>${link}</link><pubDate>${when}</pubDate><description>${desc}</description></item>`;

const FRESH = 'Wed, 05 Aug 2026 09:00:00 GMT';
const STALE = 'Sun, 01 Aug 2026 09:00:00 GMT';

test('parses a normal RSS item', () => {
  const out = parseFeedItems(
    rss(item('Senate passes bill', 'https://example.com/news/senate', FRESH)),
    feed,
    NOW,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Senate passes bill');
  assert.equal(out[0].source, 'Test');
  assert.equal(out[0].section, 'world');
});

test('drops items older than the feed max age', () => {
  const xml = rss(item('Old news', 'https://example.com/news/old', STALE));
  assert.equal(parseFeedItems(xml, feed, NOW).length, 0);
  // Same item is fine for a feed with a long window (a weekly campus paper).
  assert.equal(parseFeedItems(xml, { ...feed, maxAgeHours: 336 }, NOW).length, 1);
});

test('drops items with no date at all', () => {
  const xml = rss('<item><title>Undated</title><link>https://example.com/a</link></item>');
  assert.equal(parseFeedItems(xml, feed, NOW).length, 0);
});

test('filters opinion, live blogs, video, and classifieds', () => {
  const junk = [
    item('A real take', 'https://example.com/opinion/take', FRESH),
    item('Rolling coverage', 'https://example.com/us-news/live/2026/aug/05/x', FRESH),
    item('Watch this', 'https://example.com/news/videos/abc', FRESH),
    item('Opinion | Something', 'https://example.com/news/thing', FRESH),
    item('Classifieds - August 5, 2026', 'https://example.com/news/classifieds-aug', FRESH),
    item('Live: the vote', 'https://example.com/news/vote-live', FRESH),
  ].join('');
  const out = parseFeedItems(rss(junk + item('Real story', 'https://example.com/news/real', FRESH)), feed, NOW);
  assert.deepEqual(out.map((a) => a.title), ['Real story']);
});

test('isReportableNews keeps ordinary article paths', () => {
  assert.ok(isReportableNews('Senate passes bill', 'https://npr.org/2026/08/05/g-s1-123/senate'));
  assert.ok(isReportableNews('USC beats UCLA', 'https://dailytrojan.com/2026/08/05/usc-beats-ucla/'));
  assert.ok(!isReportableNews('Anything', 'https://wsj.com/opinion/thing'));
  assert.ok(!isReportableNews('Anything', 'not-a-url'));
});

test('strips tracking query strings so dedupe works', () => {
  assert.equal(
    cleanUrl('https://example.com/a?utm_source=rss&utm_medium=feed#frag'),
    'https://example.com/a',
  );
});

test('decodes entities and strips markup from blurbs', () => {
  assert.equal(stripHtml('<p>Tom &amp; Jerry&#39;s <b>day</b></p>'), "Tom & Jerry's day");
});

test('reads Atom entries and their href links', () => {
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>Atom story</title>
    <link rel="alternate" href="https://example.com/news/atom"/>
    <updated>2026-08-05T09:00:00Z</updated><summary>Blurb</summary></entry></feed>`;
  const out = parseFeedItems(atom, feed, NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].link, 'https://example.com/news/atom');
});

test('handles CDATA-wrapped titles', () => {
  const xml = rss(
    `<item><title><![CDATA[Bell & Co "wins"]]></title><link>https://example.com/news/x</link><pubDate>${FRESH}</pubDate></item>`,
  );
  assert.equal(parseFeedItems(xml, feed, NOW)[0].title, 'Bell & Co "wins"');
});

test('a feed with a single item still parses (not treated as an array)', () => {
  const out = parseFeedItems(rss(item('Only one', 'https://example.com/news/one', FRESH)), feed, NOW);
  assert.equal(out.length, 1);
});

test('malformed XML yields no articles rather than throwing', () => {
  assert.doesNotThrow(() => parseFeedItems('<rss><channel><item>broken', feed, NOW));
  assert.doesNotThrow(() => parseFeedItems('', feed, NOW));
});

test('drops individual violent crime, which Rose asked not to receive', () => {
  for (const t of [
    'Seven killed after teen shooter opens fire at home and school in Thailand',
    'Boy Kills Grandparents and Then Five Teachers, Thai Authorities Say',
    'Man charged with murder after stabbing in Leeds',
    'Police launch manhunt after abduction of two children',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `should drop: ${t}`);
  }
});

test('conflict reporting survives only when no one dies in the headline', () => {
  // War is demoted in ranking (see select.ts) rather than filtered, but any
  // headline carrying a death is now dropped outright.
  for (const t of [
    'Israel strikes south Lebanon after evacuation warning',
    'Ukraine hits two oil refineries deep inside Russia',
  ]) {
    assert.ok(isReportableNews(t, 'https://example.com/news/x'), `should keep: ${t}`);
  }
  for (const t of [
    'Russian missile barrage on Kyiv kills 17 overnight',
    'Air strike on Gaza kills dozens, health ministry says',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `death is dropped: ${t}`);
  }
});

test('drops evergreen sports analysis that reads as stale news', () => {
  for (const t of [
    'NWSL Power Rankings: Washington Spirit take top spot',
    "Fantasy football managers, beware: The full 'Do Not Draft' list",
    'How the fates of all 30 MLB teams have changed since the trade deadline',
    'Way-too-early 2027 mock draft',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `should drop: ${t}`);
  }
});

test('keeps sports events that actually happened', () => {
  for (const t of [
    'Red Sox up streak to 8 with wild win vs. White Sox',
    'Dodgers trade for closer ahead of deadline',
    'Mahomes out four weeks with ankle injury',
  ]) {
    assert.ok(isReportableNews(t, 'https://example.com/news/x'), `should keep: ${t}`);
  }
});

test('no section is exempt from the crime filter any more', () => {
  // The exemption existed only for good-news outlets, which are gone. A rescue
  // story reads like a crime story, and nothing now argues for letting it in.
  const t = 'Girl kidnapped 12 years ago reunited with her family';
  for (const section of [undefined, 'science', 'us', 'world']) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x', section), `blocked in ${section}`);
  }
});

test('drops macabre stories that carry no crime verb', () => {
  for (const t of [
    'More than 50 decomposing bodies discovered inside a Chicago funeral home',
    'Bodies found in abandoned mortuary after tip-off',
    'Investigators recover human remains from storage unit',
    'Mass grave uncovered near the border',
    'Officials order exhumation of two dozen graves',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `should drop: ${t}`);
  }
});

test('macabre filter does not swallow ordinary news', () => {
  for (const t of [
    'Body camera footage released after ICE request denied',
    'Governing body approves new rules for the season',
    'Remains of the day: Senate wraps up before recess',
    'Scientists discover a new species in the deep ocean',
  ]) {
    assert.ok(isReportableNews(t, 'https://example.com/news/x'), `should keep: ${t}`);
  }
});

test('drops cause-of-death and overdose reporting', () => {
  for (const t of [
    'Brandon Clarke died from the effects of heroin and cocaine, medical examiner says',
    'Medical examiner rules death accidental',
    'Toxicology report released in actor’s death',
    'Star athlete died of a fentanyl overdose, coroner finds',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `should drop: ${t}`);
  }
});

test('drops anniversaries and memorials of violence', () => {
  for (const t of [
    'CDC staff mark anniversary of the shooting that killed an officer',
    'City marks one year since the attack',
    'Vigil for victims draws hundreds downtown',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `should drop: ${t}`);
  }
});



test('benign anniversaries still come through', () => {
  assert.ok(isReportableNews('Company marks 50 years since its founding', 'https://example.com/news/x'));
});

test('drops "on this day" historical filler', () => {
  for (const t of [
    'On this day in 1576, the first public theatre opened in London',
    'This day in history: the treaty that ended a war',
    '50 years ago today, a spacecraft left Earth',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `should drop: ${t}`);
  }
});

test('drops recurring columns from the good-news feeds', () => {
  for (const t of [
    'Good News in History, August 8',
    "What We're Reading: Building a Wildlife Corridor",
    'The Spark: How Neighbors Are Banding Together to Go Greener',
    'Life lessons: Joe Newman on what life so far has taught him',
    'Your Weekly Horoscope — Free Will Astrology',
    'What went right this week: the good news that matters',
  ]) {
    assert.ok(!isReportableNews(t, 'https://goodnewsnetwork.org/x', 'science'), `should drop: ${t}`);
  }
});

test('keeps real good-news events', () => {
  for (const t of [
    'New York sends $189 million to close the summer hunger gap',
    'Rare Australian fish named creature of the year after recovery',
    'Town raises enough to rebuild its library in three weeks',
  ]) {
    assert.ok(isReportableNews(t, 'https://goodnewsnetwork.org/x', 'science'), `should keep: ${t}`);
  }
});

test('drops crime, courts, divorce, and casualty reporting', () => {
  for (const t of [
    'Man arrested after shooting in downtown Chicago',
    'Actor charged with fraud in Manhattan court',
    'Couple announce divorce after 12 years',
    'Six dead in fatal crash on I-95',
    'Executive sentenced to five years for embezzlement',
    'Death toll rises to 40 after ferry capsizes',
    'Singer found dead at home, police say',
    'Former official pleads guilty to money laundering',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `should drop: ${t}`);
  }
});

test('substantive news survives the distressing filter', () => {
  // Unwelcome is not the same as distressing — policy, war, and a bad economy
  // all still belong in the brief.
  for (const t of [
    'Senate confirms new attorney general',
    'July jobs report shows unexpected loss of 23,000 jobs',
    'Iran and Oman near deal on Strait of Hormuz',
    'FDA approves Moderna mRNA flu vaccine',
    'Appeals court blocks ballroom construction',
    'Ukraine strikes two Russian oil refineries',
    'Trump signs executive orders on birthright citizenship',
    'Dodgers rally past Giants in extra innings',
  ]) {
    assert.ok(isReportableNews(t, 'https://example.com/news/x'), `should keep: ${t}`);
  }
});

test('drops anything about death, in any framing', () => {
  for (const t of [
    'Former senator dies at 91',
    'Airstrike kills dozens in border region',
    'Two dead after building collapse',
    'Nation mourns as funeral held for former leader',
    'Family fights over life support decision',
    'Posthumous album released by late singer',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `should drop: ${t}`);
  }
});

test('drops disease and grim medical news', () => {
  for (const t of [
    'Measles outbreak spreads across three states',
    'New study links diet to higher cancer risk',
    'Hospital reports surge in flu hospitalizations',
    'Teen mental health crisis deepens, report finds',
    'Opioid addiction rates climb in rural counties',
    'Spinach recalled over contamination fears',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `should drop: ${t}`);
  }
});

test('keeps medical progress', () => {
  for (const t of [
    'FDA approves Moderna mRNA flu vaccine',
    'Gene therapy cures rare blood disorder in trial',
    'Malaria deaths decline to lowest level on record',
    'Patient in remission after first successful treatment',
  ]) {
    assert.ok(isReportableNews(t, 'https://example.com/news/x'), `should keep: ${t}`);
  }
});

test('drops drug news', () => {
  for (const t of [
    'Police seize $2m of cocaine at the border',
    'Fentanyl deaths prompt new state rules',
    'Teen vaping rates climb again',
    'Cartel leader extradited to the US',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `should drop: ${t}`);
  }
});

test('keeps medicines and drug trials', () => {
  for (const t of [
    'New drug approved for rare kidney condition',
    'Cancer drug trial shows strong early results',
  ]) {
    assert.ok(isReportableNews(t, 'https://example.com/news/x'), `should keep: ${t}`);
  }
});

test('drops misconduct allegations and scandal', () => {
  for (const t of [
    'Ohio Republican Max Miller resists calls to quit over abuse allegations',
    'Executive accused of harassment by three former staff',
    'Senator faces misconduct allegations from aide',
    'Coach resigns amid scandal at the university',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `should drop: ${t}`);
  }
});

test('ordinary uses of those words survive', () => {
  for (const t of [
    'Senate passes bill to fund the government through December',
    'Appeals court blocks ballroom construction again',
    'Dodgers drop seventh straight in walk-off loss',
  ]) {
    assert.ok(isReportableNews(t, 'https://example.com/news/x'), `should keep: ${t}`);
  }
});

test('drops wildfire and natural-disaster news', () => {
  for (const t of [
    'Wildfire forces evacuations across rural Idaho',
    'Palisades brush fire grows to 3,000 acres',
    'Crews reach 40% containment on the forest fire',
    'Evacuation order issued as flames near the town',
    'Hurricane strengthens as it nears the Gulf coast',
    'Earthquake rattles northern California',
    'Flooding closes highways across the Midwest',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `should drop: ${t}`);
  }
});

test('fire-adjacent ordinary news survives', () => {
  for (const t of [
    'Senate fires back at the White House over the funding bill',
    'Coach fired after three seasons',
    'New rules aim to cut utility costs',
  ]) {
    assert.ok(isReportableNews(t, 'https://example.com/news/x'), `should keep: ${t}`);
  }
});

test('drops European migration stories', () => {
  for (const t of [
    "Spain imposes border controls against Italy as row over Ceuta migrants grows",
    'EU asylum rules face fresh challenge after arrivals surge',
    'Small boat crossings rise in the Channel',
    'Frontex expands patrols in the Mediterranean',
    'Deportation flights resume from Germany',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `should drop: ${t}`);
  }
});

test('non-migration border and travel news survives', () => {
  for (const t of [
    'Senate passes bill to fund the government into December',
    'Spain and Italy sign new trade agreement',
  ]) {
    assert.ok(isReportableNews(t, 'https://example.com/news/x'), `should keep: ${t}`);
  }
});

test('drops feel-good filler from the good-news feeds', () => {
  for (const t of [
    'Fishing guide called 911 after spotting manatee tangled in crab trap lines',
    'Wildlife officers rescue manatee as her calf watches nearby',
    'Dog reunited with owner after three years',
    'Heartwarming moment stranger pays for family groceries',
    'Good samaritan returns lost wallet with cash intact',
  ]) {
    assert.ok(!isReportableNews(t, 'https://goodnewsnetwork.org/x', 'science'), `should drop: ${t}`);
  }
});

test('keeps genuine advances that are not about disease', () => {
  // Disease news is out entirely now — "malaria cases fall" is still a story
  // about malaria — but discoveries and records still belong.
  for (const t of [
    'Sea eagle chick hatches as Ireland reintroduction takes hold',
    'National Geographic photographs its 18,000th species',
    'New York sends $189 million to close the summer hunger gap',
  ]) {
    assert.ok(isReportableNews(t, 'https://example.com/x', 'science'), `should keep: ${t}`);
  }
});

test('drops lawsuits being filed, keeps rulings', () => {
  for (const t of [
    'Human Rights Watch and three groups file suit against the administration',
    'Advocacy group sues over new immigration rule',
    'Lawsuit challenges the ballroom construction permit',
    'Class action filed against the airline',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `should drop: ${t}`);
  }
  for (const t of [
    'Appeals court blocks ballroom construction',
    'Supreme Court rules against the agency',
    'Judge strikes down the new rule',
    'Court upholds the lower ruling',
  ]) {
    assert.ok(isReportableNews(t, 'https://example.com/news/x'), `should keep: ${t}`);
  }
});

test('school violence is filtered absolutely, headline or summary', () => {
  for (const t of [
    'Gunman opens fire at high school in Colorado',
    'Two students killed in campus shooting',
    'Police respond to active shooter at elementary school',
    'Survivors of Parkland mark a decade of advocacy',
    'District expands lockdown drills after nearby threat',
    // Reached Rose on Aug 13: "shot" is not "shoot" + a suffix, so the
    // original pattern never matched it.
    'Five people shot outside residence hall at Virginia State University',
    'Shooting outside VSU dorm leaves five injured',
    'Two shot at fraternity house near campus',
  ]) {
    assert.ok(!isReportableNews(t, 'https://example.com/news/x'), `headline: ${t}`);
  }
  // Neutral headline, detail in the summary — must still be caught.
  assert.ok(
    !isReportableNews(
      'Community gathers in Ohio town',
      'https://example.com/news/x',
      'world',
      'The vigil followed a shooting at the local high school last week.',
    ),
    'summary must be checked too',
  );
});

test('the good-news exemption does not apply to school violence', () => {
  assert.ok(
    !isReportableNews('Students return to school a year after the shooting', 'https://goodnewsnetwork.org/x', 'science'),
  );
});

test('the filter deliberately over-blocks rather than risk a miss', () => {
  // "Photographer shot the eclipse from a campus rooftop" is caught. That's an
  // accepted cost: Peter's instruction was "never", so a lost photo story beats
  // a school shooting reaching a high school student.
  assert.ok(!isReportableNews('Photographer shot the eclipse from a campus rooftop', 'https://e.com/news/x'));
});

test('ordinary school news is unaffected', () => {
  for (const t of [
    'How schools are winning children over to healthier lunches',
    'District approves new high school construction budget',
    'University announces record research funding',
    'USC beats UCLA in overtime',
  ]) {
    assert.ok(isReportableNews(t, 'https://example.com/news/x'), `should keep: ${t}`);
  }
});
