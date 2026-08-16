import { get, list, put } from '@vercel/blob';
import type { Cluster } from './select';
import type { Brief, PreviousBrief } from './write';
import { todayPT } from './schedule';

const PREFIX = 'briefs/';

export type ArchivedBrief = {
  date: string;
  subject: string;
  paragraphs: string[];
  html: string;
  citedTitles: string[];
  candidates: { id: number; title: string; link: string; source: string }[];
};

function hasBlobToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Whether today's brief already went out. Two cron entries target the same
 * route (see lib/schedule.ts), so this is the backstop against a double send if
 * the hour gate is ever ambiguous.
 *
 * Fails open: if the archive is unreachable we'd rather risk a duplicate than
 * silently skip the day.
 */
export async function alreadySentToday(): Promise<boolean> {
  if (!hasBlobToken()) return false;
  try {
    const { blobs } = await list({ prefix: `${PREFIX}${todayPT()}.json` });
    return blobs.length > 0;
  } catch (err) {
    console.warn('[archive] could not check today’s brief:', err);
    return false;
  }
}

export async function archiveBrief(
  brief: Brief,
  clusters: Cluster[],
  html: string,
  citedIds: number[],
): Promise<void> {
  if (!hasBlobToken()) {
    console.warn('[archive] BLOB_READ_WRITE_TOKEN unset; skipping archive');
    return;
  }

  const byId = new Map(clusters.map((c) => [c.id, c]));
  const record: ArchivedBrief = {
    date: todayPT(),
    subject: brief.subject,
    paragraphs: brief.paragraphs,
    html,
    citedTitles: citedIds.map((id) => byId.get(id)?.title ?? `#${id}`),
    candidates: clusters.map((c) => ({
      id: c.id,
      title: c.title,
      link: c.link,
      source: c.source,
    })),
  };

  // The store is private: these are Rose's briefs, including the personal note.
  await put(`${PREFIX}${record.date}.json`, JSON.stringify(record, null, 2), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/**
 * The most recent archived brief that isn't today's. Dates are ISO-shaped, so
 * lexical ordering is chronological. Today is excluded because a same-day
 * re-run must not treat its own output as "yesterday".
 */
export function pickPreviousPath(pathnames: string[], today: string): string | null {
  return (
    pathnames
      .filter((p) => /\d{4}-\d{2}-\d{2}\.json$/.test(p))
      // Strictly-earlier also excludes today, and rejects future-dated files
      // that a clock skew could otherwise turn into "yesterday".
      .filter((p) => p.slice(-15, -5) < today)
      .sort((a, b) => b.localeCompare(a))[0] ?? null
  );
}

/**
 * The most recent archived brief, so today's can avoid repeating it. Any failure
 * here is non-fatal — a brief with no memory of yesterday still beats no brief.
 */
/**
 * Every story cited in the last `days` briefs. Comparing only against yesterday
 * let the same USC item resurface every other day, since the Daily Trojan
 * publishes weekly and it stayed the only USC candidate all week.
 */
export async function loadRecentTopics(days = 7): Promise<string[]> {
  if (!hasBlobToken()) return [];
  try {
    const { blobs } = await list({ prefix: PREFIX });
    const recent = blobs
      .map((b) => b.pathname)
      .filter((p) => /\d{4}-\d{2}-\d{2}\.json$/.test(p))
      .sort((x, y) => y.localeCompare(x))
      .slice(0, days);

    const topics: string[] = [];
    for (const pathname of recent) {
      try {
        const r = await get(pathname, { access: 'private', useCache: false });
        if (!r) continue;
        const d = JSON.parse(await new Response(r.stream).text()) as ArchivedBrief;
        topics.push(...(d.citedTitles ?? []));
      } catch {
        /* one unreadable day must not lose the rest */
      }
    }
    return topics;
  } catch (err) {
    console.warn('[archive] could not load recent topics:', err);
    return [];
  }
}

export async function loadPreviousBrief(): Promise<PreviousBrief | null> {
  if (!hasBlobToken()) return null;

  try {
    const { blobs } = await list({ prefix: PREFIX });
    const priorPath = pickPreviousPath(blobs.map((b) => b.pathname), todayPT());
    if (!priorPath) return null;
    const prior = { pathname: priorPath };

    // A private blob's URL isn't publicly fetchable; read it through the SDK.
    const result = await get(prior.pathname, { access: 'private', useCache: false });
    if (!result) return null;

    const data = JSON.parse(await new Response(result.stream).text()) as ArchivedBrief;

    return {
      subject: data.subject,
      topics: data.citedTitles ?? [],
      paragraphs: data.paragraphs ?? [],
      date: data.date,
    };
  } catch (err) {
    console.warn('[archive] could not load previous brief:', err);
    return null;
  }
}
