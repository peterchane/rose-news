import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedFile, parseFeedSheet, parseCsv, FeedConfigError } from '../lib/feeds';

test('pipe file: parses a minimal row and defaults weight and age', () => {
  const c = parseFeedFile('world | NPR | https://npr.org/rss');
  assert.equal(c.feeds.length, 1);
  assert.deepEqual(c.feeds[0], {
    section: 'world',
    source: 'NPR',
    url: 'https://npr.org/rss',
    weight: 1.0,
    maxAgeHours: 30,
  });
});

test('pipe file: honors weight and max-age columns', () => {
  const c = parseFeedFile('usc | Daily Trojan | https://dailytrojan.com/feed/ | 0.9 | 336');
  assert.equal(c.feeds[0].weight, 0.9);
  assert.equal(c.feeds[0].maxAgeHours, 336);
});

test('pipe file: ignores comments and blank lines', () => {
  const c = parseFeedFile(`
# a comment
world | NPR | https://npr.org/rss   # trailing comment

`);
  assert.equal(c.feeds.length, 1);
  assert.equal(c.feeds[0].url, 'https://npr.org/rss');
});

test('quota rows override defaults; unlisted sections keep theirs', () => {
  const c = parseFeedFile(`
world | NPR | https://npr.org/rss
quota | world | 3
`);
  assert.equal(c.quotas.world, 3);
  assert.equal(c.quotas.sports, 4, 'untouched section keeps its default');
});

test('a bad row is skipped and warned about, never fatal', () => {
  const c = parseFeedFile(`
bogus | Typo | https://a.com/rss
world | NoUrl
world | BadProto | ftp://a.com/rss
world |  | https://a.com/rss
world | Good | https://good.com/rss
`);
  assert.equal(c.feeds.length, 1, 'only the valid row survives');
  assert.equal(c.feeds[0].source, 'Good');
  assert.equal(c.warnings.length, 4);
  assert.match(c.warnings[0], /row 1/, 'warnings carry line numbers');
});

test('out-of-range weight falls back to 1.0 with a warning', () => {
  const c = parseFeedFile('world | X | https://a.com/rss | 9');
  assert.equal(c.feeds[0].weight, 1.0);
  assert.match(c.warnings[0], /weight/);
});

test('a file with no usable feeds throws rather than sending an empty brief', () => {
  assert.throws(() => parseFeedFile('# nothing\n'), FeedConfigError);
  assert.throws(() => parseFeedFile('bogus | X | https://a.com/rss'), FeedConfigError);
});

test('CSV: parses quoted fields, embedded commas, and escaped quotes', () => {
  const rows = parseCsv('a,"b,c","say ""hi"""\n1,2,3');
  assert.deepEqual(rows[0], ['a', 'b,c', 'say "hi"']);
  assert.deepEqual(rows[1], ['1', '2', '3']);
});

test('CSV sheet: skips a header row and parses like the file', () => {
  const c = parseFeedSheet(
    'section,outlet,url,weight,maxage\nworld,NPR,https://npr.org/rss,0.9,48\nquota,world,3,,\n',
  );
  assert.equal(c.feeds.length, 1);
  assert.equal(c.feeds[0].weight, 0.9);
  assert.equal(c.feeds[0].maxAgeHours, 48);
  assert.equal(c.quotas.world, 3);
  assert.equal(c.origin, 'sheet');
});

test('CSV sheet: an outlet name containing a comma survives', () => {
  const c = parseFeedSheet('world,"Smith, Jones & Co",https://a.com/rss\n');
  assert.equal(c.feeds[0].source, 'Smith, Jones & Co');
});

test('the real feeds.txt in this repo is valid', async () => {
  const { readFileSync } = await import('node:fs');
  const c = parseFeedFile(readFileSync('feeds.txt', 'utf8'));
  assert.ok(c.feeds.length >= 5, 'has a real set of feeds');
  assert.deepEqual(c.warnings, [], 'no malformed rows');
  for (const f of c.feeds) {
    assert.match(f.url, /^https?:\/\//, `${f.source} has a usable URL`);
  }
  // Every section with a quota needs a feed behind it — except `jewish`, which
  // is computed from the Hebcal calendar rather than fetched from a feed.
  for (const [section, quota] of Object.entries(c.quotas)) {
    if (quota > 0 && section !== 'jewish') {
      assert.ok(
        c.feeds.some((f) => f.section === section),
        `section "${section}" has quota ${quota} but no feeds`,
      );
    }
  }
});
