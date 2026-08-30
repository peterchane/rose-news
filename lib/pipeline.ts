import { ingest } from './ingest';
import { loadFeedConfig } from './feeds';
import { selectClusters, type Cluster } from './select';
import { writeBrief, type Brief } from './write';
import { renderBrief, type RenderedBrief } from './render';
import { todaysWeatherNote } from './weather';
import { loadPreviousBrief, loadRecentTopics } from './archive';
import { dropAlreadyCovered } from './repeat';
import { TEAM_PATTERN, NOTABLE_ONLY_PATTERN, NOTABLE_EVENT } from './teams';
import { nextHolidayCluster } from './jewish';
import { todayPT } from './schedule';
import { fetchCredits, lowBalanceWarning } from './credits';

/** Below this, the day's ingest is too thin to be worth sending. */
export const MIN_CLUSTERS = 12;

export class ThinNewsDayError extends Error {}

export type PipelineResult = {
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
  const clusters = selectClusters(articles, config.quotas, TEAM_PATTERN, NOTABLE_ONLY_PATTERN, NOTABLE_EVENT);

  if (clusters.length < MIN_CLUSTERS) {
    throw new ThinNewsDayError(
      `Only ${clusters.length} stories after ingest (need ${MIN_CLUSTERS}). ` +
        `${articles.length} articles fetched. Feed failures: ${failures.join('; ') || 'none'}`,
    );
  }

  // The holiday calendar isn't a feed; it's computed and appended so it shows
  // up every day rather than only when an outlet writes about it.
  const holiday = await nextHolidayCluster(todayPT());
  const withHoliday = holiday ? [...clusters, { ...holiday, id: clusters.length + 1 }] : clusters;
  if (holiday) console.log(`[jewish] ${holiday.title}`);

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

  const brief = await writeBrief(kept, previous);
  // Never blocks the brief: an unavailable forecast just means no weather line.
  const weather = await todaysWeatherNote();
  const rendered = renderBrief(brief, kept, weather);

  return { brief, rendered, clusters: kept, failures };
}
