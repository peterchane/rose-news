import { generateObject } from 'ai';
import { z } from 'zod';
import type { Cluster } from './select';

/**
 * A cheap model reads the day's candidate headlines and asks one question:
 * is this top news, or something Rose specifically cares about?
 *
 * Relevance was ~40 hand-written patterns, each added after Rose read something
 * Peter didn't want — a TV listing, a rate table, a bar in Massachusetts. Peter:
 * "rules wont scale." One morning brought a missing medical plane, a collapsed
 * sea arch in Hawaii and a museum closing in Philadelphia, none of which any
 * pattern knew about. A judgment generalises; a pattern only matches what it
 * has already seen.
 *
 * Scope is relevance only. Violence, death, sexual violence, drugs, fire and
 * disease stay as code in lib/ingest.ts — a model deciding whether a school
 * shooting reaches her is not acceptable at any accuracy.
 *
 * Fails open: if the call errors or times out, every candidate is kept. This
 * makes the brief better on a good day and must never cost her the email.
 */

export const RELEVANCE_MODEL = 'google/gemini-3-flash';

/** Candidates scoring below this are dropped before the writer sees them. */
export const KEEP_AT_OR_ABOVE = 5;

/** Never thin the list below this, whatever the scores say. */
export const KEEP_AT_LEAST = 10;

const verdicts = z.object({
  scores: z.array(z.object({ id: z.number(), score: z.number() })),
});

const INSTRUCTIONS = `You are choosing stories for a daily news email to Rose: 18, a student at USC in Los Angeles, American.

Score each headline 0-10 for whether it belongs in her email.

8-10:
- Genuinely top national news, or world news every major US outlet is leading with.
- USC and its football; the Cubs, SMU or Michigan football when something notable happened.
- Los Angeles and California.
- Weather: a major US storm (hurricane, blizzard, major outbreak) or any California / LA weather.
- The media business she wants to work near: US newsrooms, journalism, PR, streaming, Hollywood, pop culture moments everyone is talking about.
- The biggest tech companies (Apple, Google, Meta, Microsoft, Amazon, Nvidia, OpenAI, Anthropic, Tesla, Netflix) or a major AI policy decision.
5-7: solid US news a well-read 18-year-old would want to know.
0-4:
- Foreign news that isn't one of the day's biggest world stories, including press, protests or politics in another country.
- Smaller tech and business: startups, funding rounds, a lesser-known company's IPO, a company merely "backed by" a big one.
- Weather anywhere outside the US, or minor US weather.
- Niche, local to somewhere else, or not really news: a landmark collapsing, a regional museum closing, a small accident far away, a feature or profile, a curiosity, a viral photo, an incremental update.

Be strict. A short email of real news beats a long one padded with niche items.`;

export type ScoreFn = (lines: string) => Promise<{ id: number; score: number }[]>;

const defaultScore: ScoreFn = async (lines) => {
  const { object } = await generateObject({
    model: RELEVANCE_MODEL,
    schema: verdicts,
    system: INSTRUCTIONS,
    prompt: `Score every headline below. Return one {id, score} for each.\n\n${lines}`,
    temperature: 0,
    maxOutputTokens: 4000,
    // Reasoning burned Gemini's output budget and truncated mid-JSON when it
    // wrote the brief; the same holds here.
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } } },
    abortSignal: AbortSignal.timeout(30_000),
  });
  return object.scores;
};

export async function filterByRelevance(
  clusters: Cluster[],
  score: ScoreFn = defaultScore,
  /**
   * Never thin below this many. Ten for the top-news pool; zero for her
   * interests, which are already a short list and must be judged individually —
   * an Egyptian press protest got in as a "journalism interest" unjudged.
   */
  floor: number = KEEP_AT_LEAST,
): Promise<{ kept: Cluster[]; dropped: { cluster: Cluster; score: number }[] }> {
  if (clusters.length === 0 || clusters.length <= floor) return { kept: clusters, dropped: [] };

  // The holiday line is added in code, not judged.
  const judged = clusters.filter((c) => c.section !== 'jewish');
  const lines = judged.map((c) => `#${c.id} [${c.section}] ${c.title}`).join('\n');

  let scores: Map<number, number>;
  try {
    const result = await score(lines);
    scores = new Map(result.map((r) => [r.id, r.score]));
  } catch (err) {
    console.warn('[relevance] scorer unavailable; keeping every candidate:', err instanceof Error ? err.message : err);
    return { kept: clusters, dropped: [] };
  }

  // A story the scorer skipped is kept, not dropped. Silence is not a verdict.
  const scoreOf = (c: Cluster) => scores.get(c.id) ?? KEEP_AT_OR_ABOVE;

  const ranked = [...judged].sort((a, b) => scoreOf(b) - scoreOf(a));
  const keepIds = new Set(
    ranked
      .filter((c, i) => scoreOf(c) >= KEEP_AT_OR_ABOVE || i < floor)
      .map((c) => c.id),
  );

  const kept = clusters.filter((c) => c.section === 'jewish' || keepIds.has(c.id));
  const dropped = judged
    .filter((c) => !keepIds.has(c.id))
    .map((cluster) => ({ cluster, score: scoreOf(cluster) }));

  return { kept, dropped };
}
