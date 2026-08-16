import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBrief } from '../lib/render';
import type { Cluster } from '../lib/select';
import type { Brief } from '../lib/write';

function cluster(id: number, over: Partial<Cluster> = {}): Cluster {
  return {
    id,
    title: `Story ${id}`,
    section: 'world',
    blurb: 'blurb',
    link: `https://example.com/story-${id}`,
    source: 'NPR',
    coverage: [{ source: 'NPR', link: `https://example.com/story-${id}` }],
    publishedAt: new Date(),
    score: 1,
    ...over,
  };
}

const clusters = [cluster(1), cluster(2), cluster(3)];
const brief = (paragraphs: string[]): Brief => ({ subject: 'Subject line', paragraphs });

test('resolves a citation to the real article URL', () => {
  const out = renderBrief(brief(['The [Senate vote](#1) happened.']), clusters);
  assert.match(out.html, /href="https:\/\/example\.com\/story-1"/);
  assert.match(out.html, />Senate vote<\/a>/);
  assert.deepEqual(out.citedIds, [1]);
});

test('a citation to an unknown id degrades to plain text, never a link', () => {
  const out = renderBrief(brief(['A [made up claim](#999) appears here.']), clusters);
  assert.ok(out.html.includes('made up claim'), 'the words survive');
  assert.ok(!out.html.includes('999'), 'the bogus id never reaches the output');
  assert.equal((out.html.match(/<a /g) ?? []).length, 0, 'no anchor is emitted');
  assert.deepEqual(out.citedIds, []);
});

test('every anchor in the output points at a real candidate URL', () => {
  const known = new Set(clusters.map((c) => c.link));
  const out = renderBrief(
    brief(['One [a](#1) two [b](#2) three [c](#3) and a fake [d](#42).']),
    clusters,
  );
  const hrefs = [...out.html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(hrefs.length, 3);
  for (const h of hrefs) assert.ok(known.has(h), `${h} is a real candidate link`);
});

test('escapes HTML in body text and in anchor text', () => {
  const out = renderBrief(
    brief(['<script>alert(1)</script> and [<b>bold</b> claim](#1) & more.']),
    clusters,
  );
  assert.ok(!/<script>/.test(out.html), 'no raw script tag');
  assert.ok(out.html.includes('&lt;script&gt;'));
  assert.ok(out.html.includes('&lt;b&gt;bold&lt;/b&gt;'), 'anchor text is escaped too');
});

test('escapes a quote in a candidate URL rather than breaking the attribute', () => {
  const out = renderBrief(brief(['Look [here](#1).']), [
    cluster(1, { link: 'https://example.com/a"onmouseover="x' }),
  ]);
  assert.ok(!/href="[^"]*"[a-z]/.test(out.html), 'no attribute injection');
});

test('includes the daily note and no date header', () => {
  const out = renderBrief(brief(['Something [happened](#1) today.']), clusters);
  assert.match(out.html, /Message from Dad:/);
  assert.ok(!/Rose&rsquo;s Daily Brief|Rose's Daily Brief/.test(out.html));
});

test('plaintext carries numbered refs and a source list', () => {
  const out = renderBrief(brief(['The [Senate vote](#1) and [another](#2).']), clusters);
  assert.match(out.text, /Senate vote \[1\]/);
  assert.match(out.text, /\[1\] NPR — https:\/\/example\.com\/story-1/);
  assert.ok(!out.text.includes('<'), 'no markup leaks into plaintext');
});

test('subject passes through unchanged', () => {
  const out = renderBrief({ subject: 'Kyiv hit, Iran nears deal', paragraphs: ['A [x](#1) b.'] }, clusters);
  assert.equal(out.subject, 'Kyiv hit, Iran nears deal');
});
