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
