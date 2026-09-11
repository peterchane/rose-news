/** The hour, in Pacific time, the brief should land. */
export const TARGET_HOUR_PT = 8;
export const TIMEZONE = 'America/Los_Angeles';

/**
 * Vercel cron is UTC-only and has no DST awareness, and Hobby allows each cron
 * entry to fire only once a day. 8am Pacific is 15:00 UTC in summer and 16:00
 * UTC in winter, so `vercel.json` registers both hours as separate daily entries
 * and this gate decides which one is real today. Exactly one passes.
 */
export function isDeliveryHour(now: Date = new Date()): boolean {
  return currentHourPT(now) === TARGET_HOUR_PT;
}

export function currentHourPT(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE,
      hour: 'numeric',
      hour12: false,
    }).format(now),
  );
}

/** Calendar date in Pacific time, YYYY-MM-DD. The archive key and dedupe key. */
export function todayPT(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The email's subject line: "Rose News: Friday, Sept 11".
 *
 * Fixed and dated on purpose. A written subject had to describe the contents,
 * which made it one more thing that could be wrong — one edition led with a
 * story the email never mentioned. A date cannot be wrong, and it sorts and
 * scans in her inbox.
 */
const MONTHS = ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

export function dailySubject(date: string = todayPT()): string {
  const [y, m, d] = date.split('-').map(Number);
  // Built in UTC from an already-Pacific date string, so no second shift.
  const weekday = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  return `Rose News: ${weekday}, ${MONTHS[m - 1]} ${d}`;
}
