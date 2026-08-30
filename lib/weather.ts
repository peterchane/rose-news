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
 * Thresholds tuned for Los Angeles, not for weather in general.
 *
 * LA summer highs sit in a narrow band, so an 8-degree move is genuinely
 * noticeable, and rain at any real probability is worth saying out loud
 * because it is rare enough to change plans.
 */
export const SWING_F = 8;
/** Rain, graded — LA gets little enough that a real chance is worth saying. */
export const RAIN_LIKELY = 50;
export const RAIN_EXPECTED = 30;
export const RAIN_CHANCE = 15;
export const HOT_F = 95;
export const CHILLY_F = 62;
/** How far ahead to look for a temperature change; beyond this she'd forget. */
export const LOOKAHEAD_DAYS = 3;

const precip = (p: Period): number => p.probabilityOfPrecipitation?.value ?? 0;

/** NWS often names rain in the summary before the odds get interesting. */
const saysRain = (p: Period): boolean => /rain|shower|storm|drizzle/i.test(p.shortForecast ?? '');

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

  if (odds >= RAIN_LIKELY) {
    return isNow ? 'Rain today — take a jacket.' : `Rain is likely ${soon} — plan on a jacket.`;
  }
  if (odds >= RAIN_EXPECTED) {
    return isNow ? 'Rain today — worth a jacket.' : `Rain is expected ${soon} — worth having a jacket.`;
  }
  return `There's a chance of rain ${soon} — worth keeping in mind.`;
}

/** Turns "Monday" / "This Afternoon" into something that reads naturally. */
function when(name: string): string {
  if (/^(this afternoon|today)$/i.test(name)) return 'later today';
  if (/^tonight$/i.test(name)) return 'tonight';
  if (/night$/i.test(name)) return `${name.replace(/ night$/i, '')} night`;
  return name;
}

/**
 * The heads-up, or null when the weather is doing nothing worth mentioning.
 *
 * Silence is the common case and the correct one. Every condition below has to
 * clear a threshold; nothing is reported merely because it is in the forecast.
 */
export function weatherNote(periods: Period[]): string | null {
  const days = periods.filter((p) => p.isDaytime).slice(0, LOOKAHEAD_DAYS + 1);
  const today = days[0];
  if (!today) return null;

  // Rain first: in LA it is the change that most obviously alters her day.
  const rain = rainNote(periods);
  if (rain) return rain;

  // Then a real temperature swing against today.
  for (const d of days.slice(1)) {
    const drop = today.temperature - d.temperature;
    if (drop >= SWING_F) {
      return `Cooling off by ${when(d.name)} — ${d.temperature}°F, about ${drop} degrees below today.`;
    }
    if (-drop >= SWING_F) {
      return `Warming up by ${when(d.name)} — ${d.temperature}°F, about ${-drop} degrees above today.`;
    }
  }

  // Finally, today being extreme on its own terms, swing or no swing.
  if (today.temperature >= HOT_F) return `Hot today — ${today.temperature}°F. Water, shade, the usual.`;
  if (today.temperature <= CHILLY_F) return `Chilly today — only ${today.temperature}°F. Worth a layer.`;

  // Nothing is changing. Say nothing.
  return null;
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
