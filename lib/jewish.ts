import type { Cluster } from './select';

/**
 * The next Jewish holiday. Not a news feed — a computed calendar entry, so it
 * appears every day rather than only when an outlet happens to write about it.
 *
 * Dates come from Hebcal's JSON API. Chabad.org is the source Peter asked for
 * and is where the links point, but it publishes no working holiday feed (its
 * RSS endpoints return 404 and 403), so Hebcal supplies the calendar and Chabad
 * supplies the reading.
 */

const HEBCAL =
  'https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&mod=on&nx=on&year=now&month=x&ss=off&mf=off&c=off&geo=none';

const CHABAD_HOLIDAYS = 'https://www.chabad.org/holidays/default_cdo/jewish/holidays.htm';

/** Chabad's own pages for the holidays worth flagging in advance. */
const CHABAD_LINKS: [RegExp, string][] = [
  [/rosh hashana/i, 'https://www.chabad.org/holidays/JewishNewYear/default_cdo/jewish/Rosh-Hashanah.htm'],
  [/yom kippur/i, 'https://www.chabad.org/holidays/JewishNewYear/template_cdo/aid/4687/jewish/Yom-Kippur.htm'],
  [/sukkot|sukkos/i, 'https://www.chabad.org/holidays/sukkot/default_cdo/jewish/Sukkot.htm'],
  [/shmini atzeret|simchat torah/i, 'https://www.chabad.org/holidays/jewishnewyear/template_cdo/aid/4517/jewish/Shemini-Atzeret-Simchat-Torah.htm'],
  [/chanukah|hanukkah/i, 'https://www.chabad.org/holidays/chanukah/default_cdo/jewish/Hanukkah.htm'],
  [/purim/i, 'https://www.chabad.org/holidays/purim/default_cdo/jewish/Purim.htm'],
  [/pesach|passover/i, 'https://www.chabad.org/holidays/pesach/default_cdo/jewish/Passover.htm'],
  [/shavuot|shavuos/i, 'https://www.chabad.org/holidays/shavuot/default_cdo/jewish/Shavuot.htm'],
];

/**
 * The major holidays only. Minor observances — Lag B'Omer, Tu BiShvat, Tisha
 * B'Av, Rosh Chodesh, the fast days — are deliberately excluded: they'd fill
 * this slot most weeks and turn a heads-up into noise.
 */
const MAJOR_HOLIDAYS =
  /(rosh hashana|yom kippur|sukkot|sukkos|shmini atzeret|simchat torah|chanukah|hanukkah|purim|pesach|passover|shavuot|shavuos)/i;

/**
 * Minor observances whose names collide with the major ones. "Rosh Hashana
 * LaBehemot" is the new year for animals — it matches MAJOR_HOLIDAYS and would
 * otherwise be announced a month before actual Rosh Hashana.
 */
const NOT_MAJOR = /(labehemot|la'?behemot|selichot|shushan|katan|pesach sheni|chol hamoed)/i;

export type Holiday = {
  title: string;
  date: string;
  hebrewDate: string;
  daysAway: number;
  link: string;
  memo: string;
};

function chabadLink(title: string): string {
  for (const [pattern, url] of CHABAD_LINKS) if (pattern.test(title)) return url;
  return CHABAD_HOLIDAYS;
}

export function pickNextHoliday(
  items: { title: string; date: string; hdate?: string; category?: string; memo?: string }[],
  today: string,
): Holiday | null {
  const upcoming = items
    .filter(
      (i) =>
        i.category === 'holiday' &&
        i.date >= today &&
        MAJOR_HOLIDAYS.test(i.title) &&
        !NOT_MAJOR.test(i.title),
    )
    // "Erev" is the eve; prefer the holiday itself unless the eve is what's next.
    .sort((a, b) => a.date.localeCompare(b.date));

  const next = upcoming[0];
  if (!next) return null;

  const days = Math.round(
    (Date.parse(`${next.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );

  return {
    title: next.title,
    date: next.date,
    hebrewDate: next.hdate ?? '',
    daysAway: days,
    link: chabadLink(next.title),
    memo: next.memo ?? '',
  };
}

/** Phrased the way it should read in the email. */
export function describeHoliday(h: Holiday): string {
  const when =
    h.daysAway === 0 ? 'today' : h.daysAway === 1 ? 'tomorrow' : `in ${h.daysAway} days`;
  const date = new Date(`${h.date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `${h.title} begins ${when}, on ${date}${h.hebrewDate ? ` (${h.hebrewDate})` : ''}.${h.memo ? ` ${h.memo}` : ''}`;
}

/**
 * Fetches the calendar and returns it shaped as a candidate cluster, so the
 * writer cites it the same way as any other story. Never throws — a calendar
 * outage must not stop the brief.
 */
/**
 * When a holiday earns a mention. Daily for five weeks is nagging; a single
 * reminder is easy to miss. So: a heads-up at 30 and 15 days, then every day
 * from a week out until the holiday itself.
 */
export const REMINDER_DAYS = [30, 15] as const;
export const DAILY_FROM_DAYS = 7;

export function shouldMention(daysAway: number): boolean {
  if (daysAway < 0) return false;
  if (daysAway <= DAILY_FROM_DAYS) return true;
  return (REMINDER_DAYS as readonly number[]).includes(daysAway);
}

export async function nextHolidayCluster(today: string): Promise<Omit<Cluster, 'id'> | null> {
  try {
    const res = await fetch(HEBCAL, {
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as { items?: Parameters<typeof pickNextHoliday>[0] };
    const holiday = pickNextHoliday(data.items ?? [], today);
    if (!holiday) return null;
    if (!shouldMention(holiday.daysAway)) {
      console.log(`[jewish] ${holiday.title} is ${holiday.daysAway} days out; not a reminder day`);
      return null;
    }

    return {
      title: `Upcoming Jewish holiday: ${holiday.title}`,
      section: 'jewish',
      blurb: describeHoliday(holiday),
      link: holiday.link,
      source: 'Chabad.org',
      coverage: [{ source: 'Chabad.org', link: holiday.link }],
      publishedAt: new Date(),
      score: 1,
    };
  } catch (err) {
    console.warn('[jewish] could not load the holiday calendar:', err);
    return null;
  }
}
