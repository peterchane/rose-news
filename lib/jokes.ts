import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { todayPT } from './schedule';

/**
 * The bottom of the email. Peter: "at the bottom include knock knock jokes
 * instead of the message from dad. but once a week show the message from dad."
 * Jokes live in jokes.txt, which he edits directly, one per line as
 * "Who's there | Punchline".
 */

export type Joke = { who: string; punchline: string };

export const DAD_MESSAGE = 'Rose news email with love from Dad';

/** Sunday: the message from Dad instead of a joke. */
export const DAD_DAY = 0;

export function parseJokes(text: string): Joke[] {
  const jokes: Joke[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [who, ...rest] = line.split('|');
    const punchline = rest.join('|').trim();
    if (who.trim() && punchline) jokes.push({ who: who.trim(), punchline });
  }
  return jokes;
}

function loadJokes(): Joke[] {
  try {
    return parseJokes(readFileSync(join(process.cwd(), 'jokes.txt'), 'utf8'));
  } catch {
    console.warn('[jokes] could not read jokes.txt; using the message from Dad');
    return [];
  }
}

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T12:00:00Z`) / 86_400_000);

export function isDadDay(date: string = todayPT()): boolean {
  return new Date(`${date}T12:00:00Z`).getUTCDay() === DAD_DAY;
}

/** The same joke all day, the next one tomorrow, cycling through the file. */
export function jokeForDate(date: string, jokes: Joke[]): Joke | null {
  if (jokes.length === 0) return null;
  const n = dayNumber(date);
  return jokes[((n % jokes.length) + jokes.length) % jokes.length];
}

/** The lines that close the email: a knock-knock joke, or Dad's message on Sundays. */
export function footerLines(date: string = todayPT(), jokes: Joke[] = loadJokes()): string[] {
  const joke = isDadDay(date) ? null : jokeForDate(date, jokes);
  if (!joke) return [DAD_MESSAGE];
  return ['Knock knock.', "Who's there?", `${joke.who}.`, `${joke.who} who?`, joke.punchline];
}
