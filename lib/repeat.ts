import type { Cluster } from './select';
import type { PreviousBrief } from './write';

/**
 * Rose asked not to be told the same story twice. Suppression happens here, by
 * removing covered stories from the candidate list, rather than by instructing
 * the model — an instruction competes with the "always include USC/sports"
 * rules and loses, which is exactly how a four-day-old USC item repeated.
 */

const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','in','on','at','to','for','with','from',
  'by','as','is','are','was','were','be','been','it','its','this','that','has',
  'have','had','will','would','can','could','not','no','new','says','say','said',
  'after','over','into','about','more','than','his','her','their','they','he',
  'she','first','two','one','you','what','why','how','who','amid','up','down',
  'out','off','may','might','still','now','set','sets','top',
]);

function tokens(title: string): Set<string> {
  return new Set(
    title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Same measure used for clustering: shared / smaller set. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.min(a.size, b.size);
}

/**
 * Deliberately looser than the clustering threshold. A story rewritten a day
 * later shares fewer words than two outlets covering it the same hour, and the
 * cost of a false negative (Rose reads it twice) is worse than a false positive
 * (one story sits out a day).
 */
const SAME_STORY = 0.34;
const MIN_SHARED = 2;

/**
 * A running story is not a repeat.
 *
 * Suppression removed the Trump-Xi summit on the day of the state dinner,
 * because it had been mentioned on the two days before — and removed Iran's
 * Hormuz offer the same way. What was left to lead the email was a watchdog
 * report on ICE procurement.
 *
 * So the day's biggest stories survive suppression. The writer is already told
 * to open with what changed rather than re-explain the background, which is the
 * right treatment for a story Rose has been following.
 */
const STILL_THE_NEWS = 3;

function stillTheNews(clusters: Cluster[]): Set<number> {
  const ranked = [...clusters]
    .filter((c) => c.section !== 'sports' && c.section !== 'usc' && c.section !== 'jewish')
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0 || ranked[0].score === ranked[ranked.length - 1].score) return new Set();
  return new Set(ranked.slice(0, STILL_THE_NEWS).map((c) => c.id));
}

export function dropAlreadyCovered(
  clusters: Cluster[],
  previous: PreviousBrief | null,
): { kept: Cluster[]; dropped: Cluster[] } {
  if (!previous?.topics?.length) return { kept: clusters, dropped: [] };

  const running = stillTheNews(clusters);

  const seen = previous.topics.map(tokens);
  const kept: Cluster[] = [];
  const dropped: Cluster[] = [];

  for (const c of clusters) {
    // Still the day's news, so it stays — however familiar it looks.
    if (running.has(c.id)) {
      kept.push(c);
      continue;
    }
    const t = tokens(c.title);
    let shared = 0;
    const isRepeat = seen.some((s) => {
      let n = 0;
      for (const w of t) if (s.has(w)) n++;
      shared = n;
      return n >= MIN_SHARED && overlap(s, t) >= SAME_STORY;
    });
    (isRepeat ? dropped : kept).push(c);
  }

  // Renumber so ids stay contiguous for the model.
  return { kept: kept.map((c, i) => ({ ...c, id: i + 1 })), dropped };
}
