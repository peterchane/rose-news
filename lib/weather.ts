/**
 * A one-line weather heads-up for Rose, and only when the weather is about to
 * do something different.
 *
 * Peter's rule: she cares about weather only when it CHANGES, because a change
 * is what alters what she wears and what she can do. A forecast that reads like
 * every other LA day is noise, so on those days this says nothing at all.
 *
 * The line is written here in code rather than by the model. It costs nothing,
 * it cannot be hallucinated, and a weather sentence has exactly one correct
 * form — there is nothing for a writer to add.
 */

/** USC's campus, which is where Rose actually is. ZIP 90089. */
export const USC = { lat: 34.0224, lon: -118.2851 } as const;

/** A daytime or nighttime slot as the National Weather Service reports it. */
export type Period = {
  name: string;
  isDaytime: boolean;
  temperature: number;
  probabilityOfPrecipitation?: { value: number | null };
  shortForecast: string;
};

/**
 * Rain, graded — LA gets little enough of it that even a real chance is worth
 * saying out loud, and rain is the only thing this reports.
 *
 * Temperature is deliberately NOT reported. Peter's call: a cool-down or a hot
 * day passes without comment, so the line appears rarely enough that seeing one
 * means something.
 */
export const RAIN_LIKELY = 50;
export const RAIN_EXPECTED = 30;
export const RAIN_CHANCE = 15;

const precip = (p: Period): number => p.probabilityOfPrecipitation?.value ?? 0;

/** NWS often names rain in the summary before the odds get interesting. */
const saysRain = (p: Period): boolean => /rain|shower|storm|drizzle/i.test(p.shortForecast ?? '');

/** Thunderstorms are worth naming as storms; "rain" undersells them. */
const saysStorm = (p: Period): boolean => /thunder|storm/i.test(p.shortForecast ?? '');

/**
 * Rain gets the WHOLE forecast range, not the three-day window the temperature
 * rules use. Peter asked for a heads-up before rain arrives, and in LA that
 * warning is worth more the earlier it comes.
 */
function rainNote(periods: Period[]): string | null {
  const coming = periods.find((p) => precip(p) >= RAIN_CHANCE || (saysRain(p) && precip(p) > 0));
  if (!coming) return null;

  const odds = precip(coming);
  const soon = when(coming.name);
  // Today's own weather is a statement; anything later is a heads-up.
  const isNow = periods.indexOf(coming) === 0;
  const storm = saysStorm(coming);
  const what = storm ? 'Storms' : 'Rain';
  const noun = storm ? 'storms' : 'rain';

  // A plain statement of fact, with no advice attached. Peter's call: she can
  // decide what to do about rain herself.
  if (odds >= RAIN_LIKELY) {
    return isNow ? `${what} today.` : `${what} ${storm ? 'are' : 'is'} likely ${soon}.`;
  }
  if (odds >= RAIN_EXPECTED) {
    return isNow ? `${what} today.` : `${what} ${storm ? 'are' : 'is'} expected ${soon}.`;
  }
  return `There's a chance of ${noun} ${soon}.`;
}

/** Turns "Monday" / "This Afternoon" into something that reads naturally. */
function when(name: string): string {
  if (/^(this afternoon|today)$/i.test(name)) return 'later today';
  if (/^tonight$/i.test(name)) return 'tonight';
  if (/night$/i.test(name)) return `${name.replace(/ night$/i, '')} night`;
  return name;
}

/**
 * The heads-up, or null when there is no rain to warn her about.
 *
 * Silence is the overwhelmingly common case and the correct one. Rain and
 * storms are the only things worth interrupting her morning for; heat, cold and
 * a swing in either direction all pass without comment.
 */
export function weatherNote(periods: Period[]): string | null {
  return rainNote(periods);
}

/**
 * Fetches the forecast for USC. Returns null on any failure.
 *
 * A weather line is a nicety; the brief is the point. Nothing in here is
 * allowed to become a reason the email doesn't go out, so every error path
 * ends the same way — no line, no noise, send the brief.
 */
export async function fetchForecast(
  fetchImpl: typeof fetch = fetch,
): Promise<Period[] | null> {
  // NWS asks callers to identify themselves; it is otherwise keyless and free.
  const headers = { 'User-Agent': 'rose-news daily brief (peterchane@gmail.com)' };
  const timeout = AbortSignal.timeout(8000);

  try {
    const pointRes = await fetchImpl(
      `https://api.weather.gov/points/${USC.lat},${USC.lon}`,
      { headers, signal: timeout },
    );
    if (!pointRes.ok) return null;
    const point = await pointRes.json();
    const url = point?.properties?.forecast;
    if (typeof url !== 'string') return null;

    const res = await fetchImpl(url, { headers, signal: timeout });
    if (!res.ok) return null;
    const data = await res.json();
    const periods = data?.properties?.periods;
    return Array.isArray(periods) ? (periods as Period[]) : null;
  } catch {
    return null;
  }
}

/** The whole feature in one call: the line for today, or nothing. */
export async function todaysWeatherNote(
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const periods = await fetchForecast(fetchImpl);
  if (!periods) {
    console.warn('[weather] forecast unavailable; omitting the weather line');
    return null;
  }
  return weatherNote(periods);
}
