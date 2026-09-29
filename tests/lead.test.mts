import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadForDate, LEAD_ROTATION, buildPrompt } from '../lib/write';
import type { Cluster } from '../lib/select';

test('the lead section rotates day to day', () => {
  const week = ['2026-08-11','2026-08-12','2026-08-13','2026-08-14','2026-08-15','2026-08-16','2026-08-17']
    .map(leadForDate);
  assert.equal(new Set(week).size >= 3, true, `too repetitive: ${week.join(', ')}`);
  assert.notEqual(week[0], week[1], 'consecutive days must differ');
});

test('the same date always gives the same lead', () => {
  assert.equal(leadForDate('2026-08-11'), leadForDate('2026-08-11'));
});

test('the rotation cycles with its own length', () => {
  const d1 = '2026-08-11';
  const later = new Date(Date.parse(`${d1}T00:00:00Z`) + LEAD_ROTATION.length * 86_400_000)
    .toISOString().slice(0, 10);
  assert.equal(leadForDate(d1), leadForDate(later));
});

test('the instruction reaches the prompt', () => {
  const clusters: Cluster[] = [{
    id: 1, title: 'A story', section: 'us', blurb: '', link: 'https://e.com/1',
    source: 'NPR', coverage: [], publishedAt: new Date(), score: 1,
  }];
  assert.match(buildPrompt(clusters, null, 'sports'), /LEAD WITH: a sports story/);
  assert.match(buildPrompt(clusters, null, 'tech'), /LEAD WITH: the major tech story/);
  assert.match(buildPrompt(clusters, null, 'sports'), /lead with the biggest US news story instead/);
});

test('science never opens the email', async () => {
  const { LEAD_ROTATION } = await import('../lib/write');
  // Peter: "science should never open."
  assert.ok(!(LEAD_ROTATION as readonly string[]).includes('science'));
});

test('while the Cubs are in the playoffs, they lead', async () => {
  const { cubsPlayoffLead, buildPrompt, validateBrief, isWorthRetry } = await import('../lib/write');
  // Peter: "put cubs at the top for as long as they are in the playoffs."
  const base = { blurb: '', link: 'https://e.com/x', source: 'ESPN', coverage: [], publishedAt: new Date(), score: 1 };
  const clusters = [
    { ...base, id: 1, section: 'us' as const, title: 'Senate passes the spending bill' },
    { ...base, id: 2, section: 'sports' as const, title: 'Cubs take Game 1 of the NLDS' },
    { ...base, id: 3, section: 'us' as const, title: 'Fed holds rates steady' },
  ];
  assert.equal(cubsPlayoffLead(clusters)?.id, 2);
  assert.match(buildPrompt(clusters, null), /LEAD WITH: the Cubs playoff story, #2/);

  const para = (a: number, b: number) =>
    `Officials moved to settle a long dispute this week, [according to talks](#${a}). ` +
    `The decision lands after months of pressure. Negotiators met for two days. ` +
    `A separate development [emerged on Tuesday](#${b}). Analysts expect more soon.`;
  const wrongLead = { subject: 'x', paragraphs: [para(1, 3), para(2, 1), para(3, 1), para(1, 2), para(3, 2)] };
  const hit = validateBrief(wrongLead, clusters).find((p) => /Cubs playoff story/.test(p));
  assert.ok(hit && isWorthRetry(hit), 'burying the Cubs earns a retry');
});

test('a regular-season Cubs story does not take over the lead', async () => {
  const { cubsPlayoffLead } = await import('../lib/write');
  const base = { blurb: '', link: 'https://e.com/x', source: 'ESPN', coverage: [], publishedAt: new Date(), score: 1 };
  assert.equal(
    cubsPlayoffLead([{ ...base, id: 1, section: 'sports' as const, title: 'Cubs trade for a reliever' }]),
    null,
  );
});
