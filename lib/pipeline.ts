import { ingest } from './ingest';
import { loadFeedConfig } from './feeds';
import { selectClusters, type Cluster } from './select';
import { writeBrief, type Brief } from './write';
import { renderBrief, type RenderedBrief } from './render';
import { todaysWeatherNote } from './weather';
import { loadPreviousBrief, loadRecentTopics } from './archive';
import { dropAlreadyCovered } from './repeat';
import { TEAM_PATTERN, NOTABLE_ONLY_PATTERN, NOTABLE_EVENT, POSTSEASON_ONLY_PATTERN, POSTSEASON_EVENT } from './teams';
import { todaysHolidayNote } from './jewish';
import { chooseStories } from './choose';
import { todayPT } from './schedule';
import { fetchCredits, lowBalanceWarning } from './credits';

/** Below this, the day's ingest is too thin to be worth sending. */
export const MIN_CLUSTERS = 12;

export class ThinNewsDayError extends Error {}

export type PipelineResult = {
  /** Set when the brief is the headlines-only fallback; carries the reason. */
  degraded?: string;
  brief: Brief;
  rendered: RenderedBrief;
  clusters: Cluster[];
  failures: string[];
};

/** Everything up to but not including delivery. Shared by the cron and preview routes. */
export async function buildBrief(): Promise<PipelineResult> {
  const config = await loadFeedConfig();
  console.log(`[feeds] ${config.feeds.length} sources from ${config.origin}`);

  const { articles, failures } = await ingest(config.feeds);
  // The whole ranked field, with no per-section quotas: quotas filled slots
  // ("some science, some business"), and the slot-filling is where the niche
  // stories came from. chooseStories picks from this instead.
  const unlimited = Object.fromEntries(Object.keys(config.quotas).map((k) => [k, 999])) as typeof config.quotas;
  const clusters = selectClusters(articles, unlimited, TEAM_PATTERN, NOTABLE_ONLY_PATTERN, NOTABLE_EVENT, POSTSEASON_ONLY_PATTERN, POSTSEASON_EVENT);

  if (clusters.length < MIN_CLUSTERS) {
    throw new ThinNewsDayError(
      `Only ${clusters.length} stories after ingest (need ${MIN_CLUSTERS}). ` +
        `${articles.length} articles fetched. Feed failures: ${failures.join('; ') || 'none'}`,
    );
  }

  // The holiday line is written in code and appended at render time, not
  // offered to the writer as a story. Asked to write it, the model announced a
  // holiday that had already passed.
  const withHoliday = clusters;

  const previous = await loadPreviousBrief();

  // Remove anything already sent BEFORE the model sees it. Asking the model not
  // to repeat is unreliable, and a section rule ("always include USC") will
  // otherwise force a repeat when the only candidate is one she's already read.
  // Suppress against the whole week, not just yesterday.
  const recentTopics = await loadRecentTopics(7);
  const { kept, dropped } = dropAlreadyCovered(withHoliday, {
    subject: previous?.subject ?? '',
    topics: [...new Set([...(previous?.topics ?? []), ...recentTopics])],
    paragraphs: previous?.paragraphs,
    date: previous?.date,
  });
  if (dropped.length) {
    console.log(`[repeat] dropped ${dropped.length} already-covered: ${dropped.map((c) => c.title.slice(0, 40)).join(' | ')}`);
  }

  // Two groups and nothing else: the day's top news, and her interests.
  const { top, interests } = await chooseStories(kept);
  console.log(`[choose] top: ${top.map((c) => c.title.slice(0, 34)).join(' | ')}`);
  console.log(`[choose] interests: ${interests.map((c) => c.title.slice(0, 34)).join(' | ') || 'none today'}`);
  // Renumbered so the ids the writer cites stay contiguous.
  const relevant = [...top, ...interests].map((c, i) => ({ ...c, id: i + 1 }));

  const brief = await writeBrief(relevant, previous);
  // Never blocks the brief: an unavailable forecast just means no weather line.
  const [weather, holiday] = await Promise.all([todaysWeatherNote(), todaysHolidayNote(todayPT())]);
  if (holiday) console.log(`[jewish] ${holiday}`);
  const rendered = renderBrief(brief, relevant, weather, holiday);

  return { brief, rendered, clusters: relevant, failures, degraded: brief.degraded };
}
