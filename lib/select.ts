import type { Article } from './ingest';
import { SECTION_ORDER, type Section } from './feeds';

/**
 * A cluster is one real-world story, merged across every outlet that covered it.
 * The `id` is what the writing model cites; it is the only handle it ever gets
 * on a URL.
 */
export type Cluster = {
  id: number;
  title: string;
  section: Section;
  blurb: string;
  /** Primary link — the highest-weighted outlet covering the story. */
  link: string;
  source: string;
  /** Every outlet that ran this story, primary first. */
  coverage: { source: string; link: string }[];
  publishedAt: Date;
  score: number;
};

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'from', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it',
  'its', 'this', 'that', 'these', 'those', 'has', 'have', 'had', 'will', 'would',
  'can', 'could', 'not', 'no', 'new', 'says', 'say', 'said', 'after', 'over',
  'into', 'about', 'more', 'than', 'his', 'her', 'their', 'they', 'he', 'she',
  'first', 'two', 'one', 'you', 'what', 'why', 'how', 'who', 'amid', 'up',
  'down', 'out', 'off', 'may', 'might', 'still', 'now', 'set', 'sets', 'top',
]);

/** Content words only — the signal for "these two headlines are the same story". */
function tokenize(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * Overlap coefficient (shared / smaller set) rather than Jaccard. Outlets write
 * headlines of wildly different lengths for the same story — "Iran and Oman
 * agree on route through strait" vs "Iran says deal with Oman on Strait of
 * Hormuz is in final stages" — and Jaccard punishes that length mismatch hard
 * enough to miss the match entirely.
 */
function overlap(a: Set<string>, b: Set<string>): { ratio: number; shared: number } {
  if (a.size === 0 || b.size === 0) return { ratio: 0, shared: 0 };
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return { ratio: shared / Math.min(a.size, b.size), shared };
}

/**
 * Both conditions must hold. The ratio alone false-merges short headlines that
 * happen to share one common word; the absolute floor alone merges long
 * headlines that share boilerplate.
 */
const OVERLAP_THRESHOLD = 0.4;
const MIN_SHARED_TOKENS = 2;

/** No single outlet may supply more than this share of a section's quota. */
const MAX_OUTLET_SHARE = 0.45;

type WorkingCluster = {
  articles: Article[];
  tokens: Set<string>;
};

function hoursOld(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}

/**
 * Corroboration is the primary signal: a story four outlets ran is more likely
 * to be the day's actual news than a single outlet's feature. Recency and outlet
 * weight break ties.
 */
function scoreCluster(articles: Article[]): number {
  const distinctSources = new Set(articles.map((a) => a.source)).size;
  const corroboration = Math.pow(distinctSources, 1.6);
  const bestWeight = Math.max(...articles.map((a) => a.weight));
  const newest = Math.min(...articles.map((a) => hoursOld(a.publishedAt)));
  // Full credit for the last 6 hours, decaying to ~0.4 at 30 hours.
  const freshness = Math.max(0.4, 1 - Math.max(0, newest - 6) / 40);
  return corroboration * bestWeight * freshness;
}

/**
 * A story's section is decided by its members, not by which feed happened to
 * surface it first — the Strait of Hormuz story arrives via both a world feed
 * and a business feed, and belongs in world.
 */
function resolveSection(articles: Article[]): Section {
  const tally = new Map<Section, number>();
  for (const a of articles) {
    tally.set(a.section, (tally.get(a.section) ?? 0) + a.weight);
  }
  let best: Section = articles[0].section;
  let bestScore = -1;
  // SECTION_ORDER iteration keeps ties deterministic and favors hard news.
  for (const section of SECTION_ORDER) {
    const score = tally.get(section) ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = section;
    }
  }
  return best;
}

/**
 * A favorite team must outrank even a heavily-covered game between teams Rose
 * doesn't follow. Corroboration scales as sources^1.6, so three outlets score
 * ~5.8; the boost sits above that deliberately. This is a personal briefing —
 * a Cubs result beats a better-sourced game she has no stake in.
 */
const FAVORITE_TEAM_BOOST = 6.5;
/** A team named only in the summary is weaker evidence the story is about them. */
const FAVORITE_TEAM_BLURB_BOOST = 2.2;

/**
 * "Tech that made the national news" is about WHERE it ran, not how many
 * outlets ran it. A single NYT ruling on Meta is national; a single Ars
 * Technica firmware story is not. So the demotion keys off the outlet's weight
 * — mainstream desks are 1.0, the specialist press is set low in feeds.txt —
 * rather than penalising every single-source tech story.
 */
const TECH_MAINSTREAM_WEIGHT = 0.8;
const TECH_NICHE_DEMOTION = 0.25;
const TECH_CORROBORATED_BOOST = 1.5;

function techPenalty(section: Section, weight: number, sources: number): number {
  if (section !== 'tech') return 1;
  if (sources >= 2) return TECH_CORROBORATED_BOOST;
  return weight >= TECH_MAINSTREAM_WEIGHT ? 1 : TECH_NICHE_DEMOTION;
}

/**
 * War coverage. Rose gets it only when it's the day's top story, so a cluster
 * that isn't broadly corroborated gets pushed down out of the quota rather than
 * filtered outright — a genuinely major development still leads.
 */
const WAR = /\b(air ?strikes?|missile|shell(ed|ing)|bombard|offensive|front ?line|troops|invasion|ceasefire|war|combat|militants?|insurgents?|drone (attack|strike))\b/i;
/** Distinct outlets needed before a war story counts as top news. */
const WAR_TOP_NEWS_SOURCES = 3;
const WAR_DEMOTION = 0.2;

function warPenalty(title: string, sources: number): number {
  if (!WAR.test(title)) return 1;
  return sources >= WAR_TOP_NEWS_SOURCES ? 1 : WAR_DEMOTION;
}

/**
 * Teams Rose wants only when something notable happens. A trade or a streak is
 * promoted hard; a routine game recap is pushed down so it doesn't spend a slot.
 */
const NOTABLE_ONLY_PROMOTION = 7.0;
const NOTABLE_ONLY_DEMOTION = 0.15;

function notableOnlyAdjustment(
  title: string,
  section: Section,
  teams: RegExp | null,
  notable: RegExp | null,
): number {
  if (!teams || !notable || section !== 'sports') return 1;
  if (!teams.test(title)) return 1;
  return notable.test(title) ? NOTABLE_ONLY_PROMOTION : NOTABLE_ONLY_DEMOTION;
}

/** Only applies to sports; a team name in a news headline shouldn't reorder news. */
function favoriteBoost(
  title: string,
  blurb: string,
  section: Section,
  pattern: RegExp | null,
): number {
  if (!pattern || (section !== 'sports' && section !== 'usc')) return 1;
  return pattern.test(title)
    ? FAVORITE_TEAM_BOOST
    : pattern.test(blurb)
      ? FAVORITE_TEAM_BLURB_BOOST
      : 1;
}

export function selectClusters(
  articles: Article[],
  quotas: Record<Section, number>,
  teamPattern: RegExp | null = null,
  notableOnlyPattern: RegExp | null = null,
  notableEvent: RegExp | null = null,
): Cluster[] {
  // Cluster across all sections. A story that spans world and business is the
  // strongest corroboration signal there is, and per-section clustering would
  // hide exactly that.
  const clusters: WorkingCluster[] = [];

  // Newest first so the freshest headline anchors each cluster's token set.
  const ordered = [...articles].sort(
    (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
  );

  for (const article of ordered) {
    const tokens = tokenize(article.title);
    if (tokens.size === 0) continue;

    let best: WorkingCluster | null = null;
    let bestRatio = 0;
    for (const c of clusters) {
      const { ratio, shared } = overlap(c.tokens, tokens);
      if (shared >= MIN_SHARED_TOKENS && ratio >= OVERLAP_THRESHOLD && ratio > bestRatio) {
        best = c;
        bestRatio = ratio;
      }
    }

    if (best) {
      best.articles.push(article);
      // Deliberately do NOT widen the token set. Accumulating tokens makes a
      // cluster progressively easier to join and eventually swallows unrelated
      // stories.
    } else {
      clusters.push({ articles: [article], tokens });
    }
  }

  const scored = clusters.map((c) => {
    // Highest-weighted, then newest, outlet becomes the primary link.
    const byRank = [...c.articles].sort(
      (a, b) => b.weight - a.weight || b.publishedAt.getTime() - a.publishedAt.getTime(),
    );
    const primary = byRank[0];

    // One entry per outlet — a single outlet covering a story twice shouldn't
    // read as two independent sources.
    const coverage: { source: string; link: string }[] = [];
    const seenSources = new Set<string>();
    for (const a of byRank) {
      if (seenSources.has(a.source)) continue;
      seenSources.add(a.source);
      coverage.push({ source: a.source, link: a.link });
    }

    // Prefer a real blurb over an empty one, regardless of outlet rank.
    const blurb = byRank.find((a) => a.blurb.length > 60)?.blurb ?? primary.blurb;

    const section = resolveSection(c.articles);

    return {
      title: primary.title,
      section,
      blurb,
      link: primary.link,
      source: primary.source,
      coverage,
      publishedAt: new Date(Math.max(...c.articles.map((a) => a.publishedAt.getTime()))),
      score:
        scoreCluster(c.articles) *
        favoriteBoost(primary.title, blurb, section, teamPattern) *
        warPenalty(primary.title, coverage.length) *
        techPenalty(section, primary.weight, coverage.length) *
        notableOnlyAdjustment(primary.title, section, notableOnlyPattern, notableEvent),
    };
  });

  // Fill each section's quota by score, but cap any one outlet's share so a
  // high-volume feed (NYT's homepage carries 20+ items) can't crowd out the
  // rest of the section.
  const selected: Omit<Cluster, 'id'>[] = [];

  for (const section of SECTION_ORDER) {
    const quota = quotas[section];
    const pool = scored
      .filter((c) => c.section === section)
      .sort((a, b) => b.score - a.score);

    const perOutletCap = Math.max(2, Math.floor(quota * MAX_OUTLET_SHARE));
    const outletCount = new Map<string, number>();
    const picked: typeof pool = [];
    const deferred: typeof pool = [];

    for (const c of pool) {
      if (picked.length >= quota) break;
      const used = outletCount.get(c.source) ?? 0;
      if (used >= perOutletCap) {
        deferred.push(c);
        continue;
      }
      outletCount.set(c.source, used + 1);
      picked.push(c);
    }

    // If diversity capping left the section short, backfill by score.
    for (const c of deferred) {
      if (picked.length >= quota) break;
      picked.push(c);
    }

    selected.push(...picked);
  }

  // Assign ids in presentation order so the model reads world news first.
  return selected.map((c, i) => ({ ...c, id: i + 1 }));
}
