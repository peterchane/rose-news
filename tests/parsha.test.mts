import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseParshaFile, summaryFor, weeksParsha, fetchParshaName, footerLines, isDadDay, DAD_MESSAGE,
} from '../lib/parsha';

/**
 * Peter: "replace knock knock jokes with summary of this week's torah portion."
 * Sunday keeps the message from Dad.
 */
const FILE = parseParshaFile(readFileSync('parsha.txt', 'utf8'));

/** Every name Hebcal uses across a full cycle, double portions included. */
const HEBCAL_NAMES = [
  'Bereshit', 'Noach', 'Lech-Lecha', 'Vayera', 'Chayei Sara', 'Toldot', 'Vayetzei', 'Vayishlach',
  'Vayeshev', 'Miketz', 'Vayigash', 'Vayechi', 'Shemot', 'Vaera', 'Bo', 'Beshalach', 'Yitro',
  'Mishpatim', 'Terumah', 'Tetzaveh', 'Ki Tisa', 'Vayakhel', 'Pekudei', 'Vayakhel-Pekudei',
  'Vayikra', 'Tzav', 'Shmini', 'Tazria', 'Metzora', 'Tazria-Metzora', 'Achrei Mot', 'Kedoshim',
  'Achrei Mot-Kedoshim', 'Emor', 'Behar', 'Bechukotai', 'Behar-Bechukotai', 'Bamidbar', 'Nasso',
  'Beha’alotcha', 'Sh’lach', 'Korach', 'Chukat', 'Balak', 'Chukat-Balak', 'Pinchas', 'Matot',
  'Masei', 'Matot-Masei', 'Devarim', 'Vaetchanan', 'Eikev', 'Re’eh', 'Shoftim', 'Ki Teitzei',
  'Ki Tavo', 'Nitzavim', 'Vayeilech', 'Nitzavim-Vayeilech', 'Ha’azinu',
];

const hebcal = (title: string | null) =>
  (async () => ({
    ok: true,
    json: async () => ({ items: title ? [{ category: 'parashat', title: `Parashat ${title}` }] : [] }),
  })) as unknown as typeof fetch;

test('parsha.txt has a summary for every portion Hebcal can name', () => {
  const missing = HEBCAL_NAMES.filter((n) => !summaryFor(n, FILE));
  assert.deepEqual(missing, []);
});

test('a double portion is both summaries; Lech-Lecha is one portion', () => {
  const both = summaryFor('Vayakhel-Pekudei', FILE)!;
  assert.ok(both.includes(summaryFor('Vayakhel', FILE)!) && both.includes(summaryFor('Pekudei', FILE)!));
  assert.equal(summaryFor('Lech-Lecha', FILE), FILE.get('lech-lecha')!.summary);
});

test('a weekday ends with this week\'s portion', async () => {
  // Thursday, Nov 12 2026: Toldot is read on Saturday the 14th.
  const parsha = await weeksParsha('2026-11-12', hebcal('Toldot'), FILE);
  const lines = footerLines('2026-11-12', parsha);
  assert.equal(lines[0], "This week's Torah portion: Toldot");
  assert.match(lines[1], /Esau and Jacob/);
});

test('Sunday ends with the message from Dad instead', () => {
  assert.equal(isDadDay('2026-11-15'), true, 'Nov 15 2026 is a Sunday');
  assert.deepEqual(footerLines('2026-11-15', { name: 'Vayetzei', summary: 'x' }), [DAD_MESSAGE]);
});

test('any failure falls back to Dad, never a broken footer', async () => {
  const dead = (async () => { throw new Error('ENOTFOUND www.hebcal.com'); }) as unknown as typeof fetch;
  assert.equal(await fetchParshaName('2026-11-12', dead), null);
  assert.equal(await weeksParsha('2026-11-12', dead, FILE), null);
  // A holiday Shabbat has no weekly portion.
  assert.equal(await weeksParsha('2026-11-12', hebcal(null), FILE), null);
  // A name the file doesn't know.
  assert.equal(await weeksParsha('2026-11-12', hebcal('Unknown'), FILE), null);
  assert.deepEqual(footerLines('2026-11-12', null), [DAD_MESSAGE]);
});
