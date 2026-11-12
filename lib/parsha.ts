import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { todayPT } from './schedule';

/**
 * The bottom of the email: this week's Torah portion. Peter: "replace knock
 * knock jokes with summary of this week's torah portion." Sunday keeps the
 * message from Dad.
 *
 * Which portion comes from Hebcal; what it says comes from parsha.txt, which
 * Peter edits directly. The summaries are written once rather than by the
 * model each day, so they cannot drift or be made up.
 *
 * Like the weather line, this must never cost her the email: any failure
 * falls back to the message from Dad.
 */

export const DAD_MESSAGE = 'Rose news email with love from Dad';

/** Sunday: the message from Dad. */
export const DAD_DAY = 0;

/** Los Angeles, for Hebcal. The diaspora reading schedule is the default. */
const LA_GEONAMEID = 5368361;

export type Parsha = { name: string; summary: string };

/** Hebcal writes "Beha’alotcha" with a curly apostrophe; the file may not. */
const key = (name: string) => name.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();

export function parseParshaFile(text: string): Map<string, Parsha> {
  const out = new Map<string, Parsha>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [name, ...rest] = line.split('|');
    const summary = rest.join('|').trim();
    if (name.trim() && summary) out.set(key(name), { name: name.trim(), summary });
  }
  return out;
}

/**
 * The summary for a portion as Hebcal names it. A double portion
 * ("Vayakhel-Pekudei") is the two summaries together. "Lech-Lecha" is one
 * portion with a hyphen in its name, so an exact match is tried first.
 */
export function summaryFor(name: string, file: Map<string, Parsha>): string | null {
  const exact = file.get(key(name));
  if (exact) return exact.summary;
  const halves = name.split('-').map((h) => file.get(key(h)));
  if (halves.length === 2 && halves.every(Boolean)) return halves.map((h) => h!.summary).join(' ');
  return null;
}

function loadParshaFile(): Map<string, Parsha> {
  try {
    return parseParshaFile(readFileSync(join(process.cwd(), 'parsha.txt'), 'utf8'));
  } catch {
    console.warn('[parsha] could not read parsha.txt; using the message from Dad');
    return new Map();
  }
}

/**
 * The portion read on the coming Shabbat — on Sunday, next week's. Null when
 * Shabbat is a holiday with its own reading, or on any failure.
 */
export async function fetchParshaName(date: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const [y, m, d] = date.split('-').map(Number);
  const url = `https://www.hebcal.com/shabbat?cfg=json&geonameid=${LA_GEONAMEID}&gy=${y}&gm=${m}&gd=${d}`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const item = (data?.items ?? []).find((i: any) => i?.category === 'parashat');
    const title = typeof item?.title === 'string' ? item.title.replace(/^Parashat\s+/, '').trim() : '';
    return title || null;
  } catch {
    return null;
  }
}

export async function weeksParsha(
  date: string = todayPT(),
  fetchImpl: typeof fetch = fetch,
  file: Map<string, Parsha> = loadParshaFile(),
): Promise<Parsha | null> {
  const name = await fetchParshaName(date, fetchImpl);
  if (!name) return null;
  const summary = summaryFor(name, file);
  if (!summary) {
    console.warn(`[parsha] no summary in parsha.txt for "${name}"; using the message from Dad`);
    return null;
  }
  return { name, summary };
}

export function isDadDay(date: string = todayPT()): boolean {
  return new Date(`${date}T12:00:00Z`).getUTCDay() === DAD_DAY;
}

/** The lines that close the email: the Torah portion, or Dad's message on Sundays. */
export function footerLines(date: string = todayPT(), parsha: Parsha | null = null): string[] {
  if (isDadDay(date) || !parsha) return [DAD_MESSAGE];
  return [`This week's Torah portion: ${parsha.name}`, parsha.summary];
}
