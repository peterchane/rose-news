import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackParagraphs, FALLBACK_NOTE, FALLBACK_STORIES } from '../lib/fallback';
import { writeBrief, type Brief, type DraftFn } from '../lib/write';
import type { Cluster } from '../lib/select';
import type { Section } from '../lib/feeds';

/**
 * Twice a bad draft meant Rose got no email at all: once when five of eight
 * paragraphs cited nothing, once when all three did. Every repair and retry in
 * lib/write.ts assumes there is a draft worth rescuing. This is what happens
 * when there isn't.
 */

function cluster(id: number, section: Section, over: Partial<Cluster> = {}): Cluster {
  return {
    id,
    title: `Headline number ${id} about something that happened`,
    section,
    blurb: `A sentence of context for story ${id}. And a second one that should be cut.`,
    link: `https://example.com/${id}`,
    source: 'NPR',
    coverage: [],
    publishedAt: new Date(),
    score: 100 - id,
    ...over,
  };
}

const CLUSTERS = [
  cluster(1, 'us'), cluster(2, 'us'), cluster(3, 'world'),
  cluster(4, 'tech'), cluster(5, 'science'), cluster(6, 'sports'), cluster(7, 'business'),
];

test('every fallback paragraph carries a citation', () => {
  // Without one the email has no link to the actual story, which is the only
  // thing this degraded mode is really delivering.
  for (const p of fallbackParagraphs(CLUSTERS)) {
    assert.match(p, /\[[^\]]+\]\(#\d+\)/, `no citation in: ${p}`);
  }
});

test('it covers several sections rather than six of one story', () => {
  const paragraphs = fallbackParagraphs(CLUSTERS);
  const ids = paragraphs.map((p) => Number(p.match(/\(#(\d+)\)/)![1]));
  assert.equal(new Set(ids).size, ids.length, 'no story appears twice');
  assert.ok(ids.length <= FALLBACK_STORIES);
});

test('it works on the thinnest possible day', () => {
  assert.deepEqual(fallbackParagraphs([]), [], 'no candidates, no crash');
  const one = fallbackParagraphs([cluster(1, 'us')]);
  assert.equal(one.length, 1);
  assert.match(one[0], /\(#1\)/);
});

test('a missing blurb still produces a sentence', () => {
  const bare = fallbackParagraphs([cluster(1, 'us', { blurb: '' })]);
  assert.match(bare[0], /^Headline number 1 about something that happened\. \[NPR\]\(#1\)$/);
});

test("a draft that fails every attempt still produces an email", async () => {
  // The exact shape of both failures: paragraphs that cite nothing at all.
  const useless: DraftFn = async () => ({
    object: { paragraphs: ['Something happened today.', 'Officials responded.', 'More soon.'] },
    usage: { inputTokens: 1, outputTokens: 1 },
  });

  const brief = await writeBrief(CLUSTERS, null, useless);
  assert.ok(brief.degraded, 'flagged as degraded so the owner is told');
  assert.equal(brief.paragraphs[0], FALLBACK_NOTE, 'and says so to Rose');
  assert.ok(brief.paragraphs.length > 1, 'with actual stories under it');
  assert.ok(brief.subject.startsWith('Rose News:'), 'still titled normally');
  for (const p of brief.paragraphs.slice(1)) {
    assert.match(p, /\(#\d+\)/, 'every story links somewhere');
  }
});

test('a good draft is never replaced by the fallback', async () => {
  const para = (a: number, b: number) =>
    `Officials moved to settle a long dispute this week, [according to talks](#${a}). ` +
    `The decision lands after months of pressure. Negotiators met for two days. ` +
    `A separate development [emerged on Tuesday](#${b}). Analysts expect more soon.`;
  const good: DraftFn = async () => ({
    object: { paragraphs: [para(6, 1), para(2, 3), para(4, 5), para(7, 1), para(3, 2)] },
    usage: { inputTokens: 1, outputTokens: 1 },
  });
  const brief = await writeBrief(CLUSTERS, null, good);
  assert.equal(brief.degraded, undefined, 'not degraded');
  assert.ok(!brief.paragraphs.includes(FALLBACK_NOTE));
});

test('a decent earlier draft is sent rather than the headline fallback', async () => {
  // Attempt 3 was a good email whose only flaw was skipping one story. It was
  // re-rolled, the re-roll failed outright, and Rose got headlines instead.
  const para = (a: number, b: number) =>
    `Officials moved to settle a long dispute this week, [according to talks](#${a}). ` +
    `The decision lands after months of pressure. Negotiators met for two days. ` +
    `A separate development [emerged on Tuesday](#${b}). Analysts expect more soon.`;
  const tagged = CLUSTERS.map((c) => ({ ...c, tier: c.id === 7 ? ('interest' as const) : ('top' as const) }));
  let calls = 0;
  const draft: DraftFn = async () => {
    calls++;
    if (calls === 4) throw new Error('No object generated: finishReason=length');
    // Good apart from skipping the interest story, #7: worth a retry, not fatal.
    return {
      object: { paragraphs: [para(6, 1), para(2, 3), para(4, 5), para(1, 2), para(3, 4)] },
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  };
  const brief = await writeBrief(tagged, null, draft);
  assert.equal(brief.degraded, undefined, 'not the headline fallback');
  assert.ok(!brief.paragraphs.includes(FALLBACK_NOTE));
  assert.ok(brief.paragraphs.some((p) => p.includes('#6')), 'the real draft was sent');
});

test('fallback text reads cleanly: no entities, no sentence cut at an initial', async () => {
  // With the AI blocked, the fallback prints titles and summaries verbatim, and
  // a test run showed "won&#039;t" and a summary cut off at "E.l.f.".
  const base = { link: 'https://e.com/x', coverage: [], publishedAt: new Date(), score: 1, section: 'us' as const };
  const [a, b, c] = fallbackParagraphs([
    { ...base, id: 1, source: 'ESPN', title: "Chris Sale won&#039;t start NLDS Game 2",
      blurb: 'Sale came out of the bullpen on Thursday against the Dodgers. More to come.' },
    { ...base, id: 2, source: 'CNBC', title: 'Why brands are branching out into original music',
      blurb: 'E.l.f. and Wendy’s are both releasing songs this fall to reach younger fans. Others may follow.' },
    { ...base, id: 3, source: 'NYT', title: 'U.S. withdraws bombers from a U.K. base',
      blurb: 'The withdrawal came with unusual speed, following what U.S. officials called credible new threats. It was announced late Friday.' },
  ]);
  assert.match(a, /won't/);
  assert.doesNotMatch(a, /&#/);
  assert.match(b, /releasing songs this fall/, 'not cut off at "E.l.f."');
  assert.match(c, /credible new threats/, 'not cut off at "U.S."');
});
