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
