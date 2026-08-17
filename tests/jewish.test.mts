import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNextHoliday, describeHoliday } from '../lib/jewish';

const items = [
  { title: 'Rosh Chodesh Elul', date: '2026-08-13', category: 'roshchodesh' },
  { title: 'Rosh Hashana LaBehemot', date: '2026-08-14', category: 'holiday' },
  { title: 'Leil Selichot', date: '2026-09-05', category: 'holiday' },
  { title: 'Erev Rosh Hashana', date: '2026-09-11', category: 'holiday', hdate: '29 Elul 5786' },
  { title: 'Rosh Hashana 5787', date: '2026-09-12', category: 'holiday', hdate: '1 Tishrei 5787' },
  { title: 'Yom Kippur', date: '2026-09-21', category: 'holiday' },
];

test('picks the next noteworthy holiday, skipping minor observances', () => {
  const h = pickNextHoliday(items, '2026-08-09')!;
  assert.match(h.title, /Rosh Hashana/);
  assert.equal(h.date, '2026-09-11', 'the eve comes first and is the real heads-up');
});

test('ignores holidays that have already passed', () => {
  const h = pickNextHoliday(items, '2026-09-15')!;
  assert.equal(h.title, 'Yom Kippur');
});

test('a holiday today is still the next one', () => {
  const h = pickNextHoliday(items, '2026-09-21')!;
  assert.equal(h.title, 'Yom Kippur');
  assert.equal(h.daysAway, 0);
});

test('counts the days correctly', () => {
  assert.equal(pickNextHoliday(items, '2026-09-11')!.daysAway, 0);
  assert.equal(pickNextHoliday(items, '2026-09-10')!.daysAway, 1);
  assert.equal(pickNextHoliday(items, '2026-08-09')!.daysAway, 33);
});

test('links to the Chabad page for the holiday', () => {
  assert.match(pickNextHoliday(items, '2026-09-15')!.link, /chabad\.org.*Yom-Kippur/i);
  assert.match(pickNextHoliday(items, '2026-08-09')!.link, /chabad\.org.*Rosh-Hashanah/i);
});

test('falls back to the Chabad index for an unmapped holiday', () => {
  const h = pickNextHoliday([{ title: 'Sukkot', date: '2026-10-01', category: 'holiday' }], '2026-09-30')!;
  assert.match(h.link, /chabad\.org/);
});

test('returns null rather than throwing when nothing is upcoming', () => {
  assert.equal(pickNextHoliday([], '2026-08-09'), null);
  assert.equal(pickNextHoliday(items, '2027-01-01'), null);
});

test('describes the holiday in plain language', () => {
  const d = describeHoliday(pickNextHoliday(items, '2026-09-10')!);
  assert.match(d, /begins tomorrow/);
  assert.match(d, /September 11/);
  const today = describeHoliday(pickNextHoliday(items, '2026-09-21')!);
  assert.match(today, /begins today/);
});

test('skips minor observances whose names collide with major ones', () => {
  // "Rosh Hashana LaBehemot" is the new year for animals — announcing it as
  // Rosh Hashana would be wrong by a month.
  const h = pickNextHoliday(
    [
      { title: 'Rosh Hashana LaBehemot', date: '2026-08-14', category: 'holiday' },
      { title: 'Erev Rosh Hashana', date: '2026-09-11', category: 'holiday' },
    ],
    '2026-08-09',
  )!;
  assert.equal(h.date, '2026-09-11');
});

test('only major holidays are announced', () => {
  const minor = [
    { title: "Lag B'Omer", date: '2026-05-05', category: 'holiday' },
    { title: 'Tu BiShvat', date: '2026-02-02', category: 'holiday' },
    { title: "Tish'a B'Av", date: '2026-07-23', category: 'holiday' },
    { title: 'Rosh Chodesh Elul', date: '2026-08-13', category: 'roshchodesh' },
    { title: 'Chol hamoed Pesach', date: '2026-04-03', category: 'holiday' },
  ];
  assert.equal(pickNextHoliday(minor, '2026-01-01'), null, 'none of these qualify');
});

test('all eight major holidays do qualify', () => {
  for (const title of [
    'Erev Rosh Hashana', 'Yom Kippur', 'Sukkot', 'Simchat Torah',
    'Chanukah: 1 Candle', 'Purim', 'Erev Pesach', 'Shavuot',
  ]) {
    const h = pickNextHoliday([{ title, date: '2026-12-01', category: 'holiday' }], '2026-11-01');
    assert.ok(h, `${title} should qualify`);
    assert.match(h!.link, /chabad\.org/);
  }
});

test('a holiday far out is not announced every day', async () => {
  const { MENTION_WITHIN_DAYS } = await import('../lib/jewish');
  assert.ok(MENTION_WITHIN_DAYS <= 10, 'a month of daily reminders is nagging');
});
