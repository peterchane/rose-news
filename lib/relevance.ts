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
 * Fails closed. If the judge can't be reached after a second try, the day is
 * skipped and Peter gets an alert. It used to keep every candidate unjudged;
 * Peter: "skip the day. never send random stuff."
 */

export const RELEVANCE_MODEL = 'google/gemini-3-flash';

/** Candidates scoring below this are dropped before the writer sees them. */
export const KEEP_AT_OR_ABOVE = 5;

const verdicts = z.object({
  scores: z.array(z.object({ id: z.number(), score: z.number() })),
});

const INSTRUCTIONS = `You are choosing stories for a daily news email to Rose: 18, a student at USC in Los Angeles, American.

Score each headline 0-10 for whether it belongs in her email.

8-10:
- Genuinely top national news, or world news every major US outlet is leading with.
- USC and its football — above all, the result of a USC game; the Cubs, SMU or Michigan football when something notable happened.
- Los Angeles and California.
- Weather: a major US storm (hurricane, blizzard, major outbreak) or any California / LA weather.
- The media business she wants to work near: US newsrooms, journalism, PR, streaming, Hollywood, pop culture moments everyone is talking about — including women leading in media, entertainment and business.
- The biggest tech companies (Apple, Google, Meta, Microsoft, Amazon, Nvidia, OpenAI, Anthropic, Tesla, Netflix) or a major AI policy decision.
5-7: solid US news a well-read 18-year-old would want to know.
0-4:
- Foreign news that isn't one of the day's biggest world stories, including press, protests or politics in another country.
- Smaller tech and business: startups, funding rounds, a lesser-known company's IPO, a company merely "backed by" a big one.
- Weather anywhere outside the US, or minor US weather.
- Sports filler: previews and pregame pieces for a game already played, photo galleries, live-stream listings, draft-stock speculation.
- One person's case: a single detainee, deportation, custody fight or rescue. Unless it's the story every major outlet is leading with, it's an anecdote, not news.
- Reader call-outs: an outlet asking readers for questions, stories or tips ("What do you want to know about..."). Nothing happened.
- Sports business for leagues she doesn't follow (an NHL or NBA TV deal, league finances). That's sports, not the media business she cares about.
- Entertainment-trade filler: honors lists and "power 100"-style rankings from niche or community-specific publications, agency signings, mid-level personnel moves, awards-season campaigning. Mentioning Disney or Netflix doesn't make it news.
- Niche, local to somewhere else, or not really news: a landmark collapsing, a regional museum closing, a small accident far away, a feature or profile, a curiosity, a viral photo, an incremental update.

Be strict. A short email of real news beats a long one padded with niche items.`;

export type ScoreFn = (lines: string) => Promise<{ id: number; score: number }[]>;

/** The judge couldn't be reached. Thrown so the run fails and alerts Peter. */
export class RelevanceUnavailableError extends Error {
  name = 'RelevanceUnavailableError';
}

/** One more try after a failure: a passing blip shouldn't cost her the day. */
const SCORE_ATTEMPTS = 2;

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

/**
 * Keeps what the judge scores KEEP_AT_OR_ABOVE or higher, and nothing else.
 * There used to be a floor of ten that refilled the list with rejected stories
 * on a thin day. Peter: "adding rejected stories is not ok." A short email is
 * the answer to a thin day.
 */
export async function filterByRelevance(
  clusters: Cluster[],
  score: ScoreFn = defaultScore,
): Promise<{ kept: Cluster[]; dropped: { cluster: Cluster; score: number }[] }> {
  if (clusters.length === 0) return { kept: clusters, dropped: [] };

  // The holiday line is added in code, not judged.
  const judged = clusters.filter((c) => c.section !== 'jewish');
  const lines = judged.map((c) => `#${c.id} [${c.section}] ${c.title}`).join('\n');

  let scores: Map<number, number> | null = null;
  let lastError: unknown;
  for (let attempt = 1; attempt <= SCORE_ATTEMPTS && !scores; attempt++) {
    try {
      const result = await score(lines);
      scores = new Map(result.map((r) => [r.id, r.score]));
    } catch (err) {
      lastError = err;
      console.warn(`[relevance] attempt ${attempt} failed:`, err instanceof Error ? err.message : err);
    }
  }
  if (!scores) {
    const why = lastError instanceof Error ? lastError.message : String(lastError);
    throw new RelevanceUnavailableError(`The relevance judge could not be reached, so nothing was sent: ${why}`);
  }
  const verdicts = scores;

  // A story the judge skipped wasn't approved, so it doesn't go in.
  const scoreOf = (c: Cluster) => verdicts.get(c.id) ?? 0;

  const keepIds = new Set(judged.filter((c) => scoreOf(c) >= KEEP_AT_OR_ABOVE).map((c) => c.id));

  const kept = clusters.filter((c) => c.section === 'jewish' || keepIds.has(c.id));
  const dropped = judged
    .filter((c) => !keepIds.has(c.id))
    .map((cluster) => ({ cluster, score: scoreOf(cluster) }));

  return { kept, dropped };
}
