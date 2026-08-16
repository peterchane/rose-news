import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { todayPT } from './schedule';

/**
 * The personal line at the bottom of each email. Lives in notes.txt at the repo
 * root so it can be edited without touching code, same as feeds.txt.
 */

const FALLBACK = 'You can reply to this email with any feedback!';

export function parseNotes(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

function load(): string[] {
  try {
    const notes = parseNotes(readFileSync(join(process.cwd(), 'notes.txt'), 'utf8'));
    return notes.length > 0 ? notes : [FALLBACK];
  } catch {
    console.warn('[notes] could not read notes.txt; using the default line');
    return [FALLBACK];
  }
}

const NOTES = load();

/**
 * Rotates by calendar day so the note is stable within a day and cycles evenly
 * across the list. Keyed off the Pacific date, matching the send schedule.
 */
export function noteForToday(date: string = todayPT()): string {
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return NOTES[((days % NOTES.length) + NOTES.length) % NOTES.length];
}

export const ALL_NOTES = NOTES;
