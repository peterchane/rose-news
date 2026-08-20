/** Prints the note rotation, so a notes.txt edit can be checked before it sends. */
import { ALL_NOTES, noteForToday } from '../lib/notes';

console.log(`${ALL_NOTES.length} notes in rotation:\n`);
for (let i = 0; i < ALL_NOTES.length; i++) {
  const day = new Date(Date.UTC(2026, 7, 21 + i)).toISOString().slice(0, 10);
  console.log(`${day}  ${noteForToday(day)}`);
}
