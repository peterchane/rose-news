import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJokes, jokeForDate, footerLines, isDadDay, DAD_MESSAGE } from '../lib/jokes';

/**
 * Peter: "at the bottom include knock knock jokes instead of the message from
 * dad. but once a week show the message from dad."
 */
const JOKES = parseJokes(readFileSync('jokes.txt', 'utf8'));

test('jokes.txt parses, comments and blank lines ignored', () => {
  assert.ok(JOKES.length >= 30, `only ${JOKES.length} jokes`);
  assert.deepEqual(parseJokes('# a comment\n\nLettuce | Lettuce in!\nbroken line\n'), [
    { who: 'Lettuce', punchline: 'Lettuce in!' },
  ]);
});

test('a weekday ends with a knock-knock joke', () => {
  // Monday, Oct 26 2026.
  const lines = footerLines('2026-10-26', JOKES);
  assert.equal(lines[0], 'Knock knock.');
  assert.equal(lines[1], "Who's there?");
  assert.match(lines[3], / who\?$/);
  assert.equal(lines.length, 5);
});

test('Sunday ends with the message from Dad instead', () => {
  assert.equal(isDadDay('2026-11-01'), true, 'Nov 1 2026 is a Sunday');
  assert.deepEqual(footerLines('2026-11-01', JOKES), [DAD_MESSAGE]);
  // Exactly once a week.
  const week = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'];
  assert.equal(week.filter((d) => isDadDay(d)).length, 1);
});

test('a different joke each day, the same one all day', () => {
  assert.notDeepEqual(jokeForDate('2026-10-26', JOKES), jokeForDate('2026-10-27', JOKES));
  assert.deepEqual(jokeForDate('2026-10-26', JOKES), jokeForDate('2026-10-26', JOKES));
});

test('with no jokes file, Dad’s message still closes the email', () => {
  assert.deepEqual(footerLines('2026-10-26', []), [DAD_MESSAGE]);
});
