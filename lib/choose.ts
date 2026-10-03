import type { Cluster } from './select';
import { isLocalStory } from './select';
import { topStories, isBigUscStory } from './write';
import { filterByRelevance, type ScoreFn } from './relevance';
import {
  TEAM_PATTERN, NOTABLE_ONLY_PATTERN, NOTABLE_EVENT,
  POSTSEASON_ONLY_PATTERN, POSTSEASON_EVENT,
} from './teams';

/**
 * A sports story she'd want, by the rules in teams.txt: every game for a "+"
 * team, notable news for the default teams, October only for a "!" team. The
 * full ranking still holds routine results, just with low scores, so the rule
 * has to be applied here rather than assumed.
 */
export function isHerSports(c: Cluster): boolean {
  const hay = `${c.title} ${c.blurb}`;
  if (TEAM_PATTERN?.test(hay)) return true;
  if (NOTABLE_ONLY_PATTERN?.test(hay) && NOTABLE_EVENT.test(hay)) return true;
  return Boolean(POSTSEASON_ONLY_PATTERN?.test(hay) && POSTSEASON_EVENT.test(hay));
}

/**
 * Which stories Rose gets: the day's top news, and the things she cares about.
 * Nothing else.
 *
 * Peter: "there are a small set of top stories every day that matter. include
 * those. and then include stories based on the personalized interests i told
 * you." The old design filled per-section quotas — some science, some business,
 * some world — and slot-filling is exactly where the niche stories came from: a
 * collapsed sea arch was a science slot that needed filling.
 */

/** How many top stories. A small set, by design. */
export const TOP_NEWS = 5;

/** How many interest stories at most, so a busy USC week can't crowd out the news. */
export const MAX_INTERESTS = 5;

/**
 * Journalism, PR, pop culture and media — Peter: "she is also interested in
 * journalism, PR, and what's in pop culture and media." The trivia demotion in
 * lib/select.ts still sinks pure gossip (dating rumours, red carpets), so this
 * surfaces the industry and the big cultural moments rather than the tabloid.
 */
const MEDIA_AND_CULTURE = new RegExp(
  [
    /\b(journalis\w*|newsrooms?|reporters?|editors?|press (freedom|pool|corps|secretary)|news (outlet|organization|industry|anchor)s?)\b/,
    /\b(public relations|publicist|pr (firm|agency|campaign|crisis)|press release|crisis communications?|brand (deal|campaign))\b/,
    /\b(media|streaming|netflix|disney|hbo|paramount|warner|spotify|youtube|tiktok|podcast\w*|box office|hollywood)\b/,
    /\b(album|tour|billboard|grammy|oscar|emmy|music|film|movie|series premiere|pop culture|viral|influencer|celebrit\w*)\b/,
  ]
    .map((r) => r.source)
    .join('|'),
  'i',
);

export function isMediaOrCulture(title: string): boolean {
  return MEDIA_AND_CULTURE.test(title);
}

/** A team she doesn't follow, only here for October. One story is plenty. */
const POSTSEASON_ONLY_CAP = 1;

/** How deep into the ranking the relevance check looks for the top news. */
const TOP_POOL = 15;

const NOT_NEWS = new Set(['sports', 'usc', 'jewish']);

export type Chosen = {
  /** The day's biggest stories, in ranked order. */
  top: Cluster[];
  /** USC, her teams, Los Angeles and California. */
  interests: Cluster[];
};

/**
 * `all` must be the full ranked set — selectClusters with no section quotas —
 * already through the harm filters and the sports relevance filter, so every
 * sports cluster in it is one of her teams.
 */
export async function chooseStories(all: Cluster[], score?: ScoreFn): Promise<Chosen> {
  // 1. Top news: highest corroboration and placement, with the relevance
  //    check vetoing anything that ranks well but isn't really news.
  const pool = all
    .filter((c) => !NOT_NEWS.has(c.section))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_POOL);
  const vetted = (await filterByRelevance(pool, score)).kept;
  const top = topStories(vetted, TOP_NEWS);

  // 2. Her interests: USC and her teams, Los Angeles and California, and
  //    journalism, PR, pop culture and media.
  const taken = new Set(top.map((c) => c.id));
  let postseasonOnly = 0;
  const interests = all
    .filter((c) => !taken.has(c.id))
    .filter((c) => {
      if (c.section === 'usc') return isBigUscStory(c.title);
      if (c.section === 'sports') return isHerSports(c);
      if (c.section === 'jewish') return false; // added in code, not written
      return isLocalStory(c.title) || isMediaOrCulture(c.title);
    })
    .sort((a, b) => b.score - a.score)
    .filter((c) => {
      // Three Dodgers stories crowded out everything else she follows.
      const isPostseasonOnly = Boolean(POSTSEASON_ONLY_PATTERN?.test(`${c.title} ${c.blurb}`));
      if (!isPostseasonOnly) return true;
      return ++postseasonOnly <= POSTSEASON_ONLY_CAP;
    })
    .slice(0, MAX_INTERESTS);

  return {
    top: top.map((c) => ({ ...c, tier: 'top' as const })),
    interests: interests.map((c) => ({ ...c, tier: 'interest' as const })),
  };
}
