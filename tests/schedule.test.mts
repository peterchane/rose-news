import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeliveryHour, currentHourPT, todayPT } from '../lib/schedule';
import { parseNotes } from '../lib/notes';

/** The two cron entries registered in vercel.json. */
const CRON_HOURS_UTC = [15, 16];

/** Does this cron entry fire, at every minute of its slip window? */
function entryFires(date: string, utcHour: number): boolean | 'inconsistent' {
  const results = Array.from({ length: 60 }, (_, m) =>
    isDeliveryHour(
      new Date(`${date}T${String(utcHour).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`),
    ),
  );
  if (results.every(Boolean)) return true;
  if (results.every((r) => !r)) return false;
  return 'inconsistent';
}

for (const [label, date] of [
  ['midsummer (PDT)', '2026-07-15'],
  ['midwinter (PST)', '2026-01-15'],
  ['spring-forward day', '2026-03-08'],
  ['fall-back day', '2026-11-01'],
  ['day before spring-forward', '2026-03-07'],
  ['day after fall-back', '2026-11-02'],
] as const) {
  test(`exactly one send at 8am PT on ${label}`, () => {
    const firing = CRON_HOURS_UTC.filter((h) => {
      const r = entryFires(date, h);
      assert.notEqual(r, 'inconsistent', `${h}:00 UTC entry is ambiguous across its slip window`);
      return r === true;
    });
    assert.equal(firing.length, 1, `expected 1 firing entry, got ${firing.length}`);

    const hour = currentHourPT(new Date(`${date}T${String(firing[0]).padStart(2, '0')}:30:00Z`));
    assert.equal(hour, 8, 'lands in the 8am Pacific hour');
  });
}

test('off-hours never trigger a send', () => {
  for (const h of [0, 6, 12, 14, 17, 20, 23]) {
    assert.equal(isDeliveryHour(new Date(`2026-07-15T${String(h).padStart(2, '0')}:30:00Z`)), false);
  }
});

test('todayPT rolls over on Pacific time, not UTC', () => {
  // 05:00 UTC is still the previous evening in California.
  assert.equal(todayPT(new Date('2026-08-06T05:00:00Z')), '2026-08-05');
  assert.equal(todayPT(new Date('2026-08-06T16:00:00Z')), '2026-08-06');
});

test('notes file parses to one message per line, comments ignored', () => {
  const notes = parseNotes('# heading\n\nFirst note\nSecond note\n');
  assert.deepEqual(notes, ['First note', 'Second note']);
});

test('the real notes.txt has usable content', async () => {
  const { readFileSync } = await import('node:fs');
  const notes = parseNotes(readFileSync('notes.txt', 'utf8'));
  assert.ok(notes.length >= 1);
  for (const n of notes) assert.ok(n.length < 200, 'notes stay short');
});
