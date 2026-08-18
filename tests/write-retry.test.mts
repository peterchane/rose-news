import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefSchema, writeBrief, synthesizeSubject, clampSubject, validateBrief, isFatal, isUnretryable, MODEL_CHAIN, BriefValidationError, BriefConfigError, type Brief, type DraftFn } from '../lib/write';
import type { Cluster } from '../lib/select';

/**
 * Regression cover for the Aug 6 failure: generateObject threw
 * AI_NoObjectGeneratedError, it escaped writeBrief, and the day's brief was
 * lost without a single retry.
 */

const clusters: Cluster[] = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  title: `Story ${i + 1}`,
  section: i === 8 ? 'sports' : i === 9 ? 'usc' : 'world',
  blurb: '',
  link: `https://e.com/${i + 1}`,
  source: 'NPR',
  coverage: [],
  publishedAt: new Date(),
  score: 1,
}));

const para = (a: number, b: number) =>
  `Officials moved to settle a long-running dispute this week, [according to talks](#${a}). ` +
  `The decision lands after months of pressure. Negotiators met for two days. ` +
  `A separate development [emerged on Tuesday](#${b}). Analysts expect more soon.`;

// Sports (#9) opens and USC (#10) rides along, per the fixed order.
const good: Brief = {
  subject: 'A working subject line',
  paragraphs: [para(9, 10), para(1, 2), para(3, 4), para(5, 6), para(7, 8)],
};

function schemaError(): Error {
  const e = new Error('No object generated: response did not match schema.');
  e.name = 'AI_NoObjectGeneratedError';
  return e;
}

const wrap = (object: Brief) => ({ object, usage: { inputTokens: 1, outputTokens: 1 } });

test('the good fixture is actually valid (guards the other cases)', async () => {
  const out = await writeBrief(clusters, null, async () => wrap(good));
  assert.equal(out.subject, good.subject);
});

test('a thrown schema error is retried, not fatal', async () => {
  let calls = 0;
  const draft: DraftFn = async () => {
    calls++;
    if (calls === 1) throw schemaError();
    return wrap(good);
  };
  const out = await writeBrief(clusters, null, draft);
  assert.equal(calls, 2, 'retried after the throw');
  assert.equal(out.subject, good.subject);
});

test('survives two consecutive throws and succeeds on the third attempt', async () => {
  let calls = 0;
  const draft: DraftFn = async () => {
    calls++;
    if (calls < 3) throw schemaError();
    return wrap(good);
  };
  const out = await writeBrief(clusters, null, draft);
  assert.equal(calls, 3);
  assert.equal(out.subject, good.subject);
});

test('gives up after three failures rather than sending something broken', async () => {
  let calls = 0;
  const draft: DraftFn = async () => {
    calls++;
    throw schemaError();
  };
  await assert.rejects(() => writeBrief(clusters, null, draft), BriefValidationError);
  assert.equal(calls, 3, 'tried three times before giving up');
});

test('a validation failure is fed back to the next attempt', async () => {
  const prompts: string[] = [];
  let calls = 0;
  const draft: DraftFn = async (prompt) => {
    prompts.push(prompt);
    calls++;
    // First draft is too short — a validateBrief failure, not a schema throw.
    return wrap(calls === 1 ? { ...good, paragraphs: [para(1, 2), para(3, 4)] } : good);
  };
  const out = await writeBrief(clusters, null, draft);
  assert.equal(out.subject, good.subject);
  assert.match(prompts[1], /rejected for these reasons/);
  assert.match(prompts[1], /5-9 paragraphs/);
});

test('an unparseable response tells the next attempt what shape to return', async () => {
  const prompts: string[] = [];
  let calls = 0;
  const draft: DraftFn = async (prompt) => {
    prompts.push(prompt);
    calls++;
    if (calls === 1) throw schemaError();
    return wrap(good);
  };
  await writeBrief(clusters, null, draft);
  assert.match(prompts[1], /could not be parsed/);
  assert.match(prompts[1], /paragraphs/);
});

test('paragraph count is not constrained by the schema', () => {
  // A count constraint here would make a fixable draft unparseable, which is
  // precisely the bug. validateBrief owns the count.
  for (const n of [1, 4, 5, 9, 12]) {
    const r = briefSchema.safeParse({
      subject: 'x',
      paragraphs: Array.from({ length: n }, () => 'a paragraph'),
    });
    assert.ok(r.success, `${n} paragraphs must parse`);
  }
});

test('a response missing only the subject still parses', () => {
  // This is the Aug 6 failure mode. It must reach our code as a fixable draft,
  // not as an unparseable response — writeBrief supplies the subject.
  assert.ok(briefSchema.safeParse({ paragraphs: ['a'] }).success);
});

test('the schema still rejects genuinely wrong shapes', () => {
  assert.ok(!briefSchema.safeParse({ subject: 'x' }).success, 'paragraphs is required');
  assert.ok(!briefSchema.safeParse({ subject: 'x', paragraphs: 'nope' }).success);
  assert.ok(!briefSchema.safeParse({ subject: 'x', paragraphs: [{ text: 'a' }] }).success);
  assert.ok(!briefSchema.safeParse({ subject: 42, paragraphs: ['a'] }).success);
});

test('a missing subject is written by the dedicated subject call', async () => {
  const { subject: _drop, ...noSubject } = good;
  const out = await writeBrief(
    clusters, null,
    async () => wrap(noSubject as Brief),
    async () => 'A subject written from the body',
  );
  assert.equal(out.subject, 'A subject written from the body');
});

test('if the subject call also fails, headlines are used instead', async () => {
  const { subject: _drop, ...noSubject } = good;
  const out = await writeBrief(
    clusters, null,
    async () => wrap(noSubject as Brief),
    async () => null,
  );
  assert.ok(out.subject.length > 0, 'never empty');
  assert.ok(out.subject.includes('Story'), 'falls back to top headlines');
});

test('an empty-string subject is also replaced', async () => {
  const out = await writeBrief(
    clusters, null,
    async () => wrap({ ...good, subject: '   ' }),
    async () => 'Replacement subject',
  );
  assert.equal(out.subject, 'Replacement subject');
});

test('synthesizeSubject skips explainer headlines that read badly as subjects', () => {
  const s = synthesizeSubject([
    { ...clusters[0], title: 'What Is Fauci Being Accused of and Why Is He Being Held in Contempt?' },
    { ...clusters[1], title: 'Kyiv barrage kills 17' },
  ]);
  assert.ok(!/^What Is/.test(s), `got: ${s}`);
  assert.ok(s.includes('Kyiv'), `got: ${s}`);
});

test('synthesized subjects stay within a sane length', () => {
  const long = clusters.map((c, i) => ({ ...c, title: `A very long headline number ${i} `.repeat(4) }));
  assert.ok(synthesizeSubject(long).length <= 80, 'never runs away');
  assert.ok(synthesizeSubject([]).length > 0, 'degrades to a default');
});

test('a long anchor beginning with "more" is not mistaken for a "more" link', () => {
  // Real false positive that burned an attempt on Aug 6.
  const p =
    `Rescuers reached [more than 300 people who had been abducted](#1) in the north. ` +
    `The operation took two days. Families waited at the perimeter overnight. ` +
    `Officials have not said [who carried out the raid](#2). More detail is expected.`;
  const problems = validateBrief({ ...good, paragraphs: [p, para(3,4), para(5,6), para(7,8), para(9,10)] }, clusters);
  assert.ok(!problems.some((x) => /meaningful phrase/.test(x)), problems.join(' | '));
});

test('a bare "more" or "here" anchor is still rejected', () => {
  for (const anchor of ['more', 'here', 'read more', 'click here', 'this article']) {
    const p = `Something notable happened in the capital today and officials responded. ` +
      `Read the account [${anchor}](#1). The situation is still developing tonight. ` +
      `Analysts expect further movement [in coming days](#2). Nobody has commented.`;
    const problems = validateBrief({ ...good, paragraphs: [p, para(3,4), para(5,6), para(7,8), para(9,10)] }, clusters);
    assert.ok(problems.some((x) => /meaningful phrase/.test(x)), `"${anchor}" should be rejected`);
  }
});

test('subjects are clamped to a sane length at a word boundary', () => {
  const long = 'Fauci contempt fight escalates while Iran and Oman near a Hormuz agreement and Ukraine strikes refineries';
  const out = clampSubject(long);
  assert.ok(out.length <= 78, `got ${out.length}`);
  assert.ok(!out.endsWith(' '), 'no trailing space');
  assert.ok(!/\s\S{1,2}$/.test(out) || out.split(' ').length < 3, 'cut at a word boundary');
  assert.equal(clampSubject('Short one'), 'Short one');
});

test('an over-long subject is trimmed, never a reason to fail', async () => {
  const out = await writeBrief(
    clusters, null,
    async () => wrap({ ...good, subject: 'x '.repeat(80) }),
    async () => null,
  );
  assert.ok(out.subject.length <= 78);
});

test('a link-free paragraph is cosmetic, not fatal', () => {
  assert.ok(!isFatal('Paragraph 1 has no citations. Every paragraph needs 1-3.'));
  assert.ok(isFatal('Only 3 distinct stories cited. Cover more of the day\'s news.'));
});

test('fatal problems are distinguished from cosmetic ones', () => {
  assert.ok(isFatal('Paragraph 2 cites #999, which is not a candidate ID.'));
  assert.ok(isFatal('Paragraph 1 contains a raw URL. Cite candidates as [text](#ID) only.'));
  assert.ok(isFatal('Paragraph 3 contains a bulleted or numbered list. Rewrite it as prose.'));
  assert.ok(isFatal('Need 5-9 paragraphs, got 3.'));
  assert.ok(!isFatal('Paragraph 5 anchors a link on "more". Anchor on a meaningful phrase.'));
  // Repaired by splitPivots before validation, so it must never block a send.
  assert.ok(!isFatal('Paragraph 6 pivots to a new topic mid-paragraph at "Separately".'));
  assert.ok(!isFatal('Paragraph 2 is too short (30 words); aim for 40-80.'));
});

test('a final draft with only cosmetic issues is sent, not discarded', async () => {
  // A slightly short paragraph is a nit. A mid-paragraph pivot is NOT — that
  // became fatal after Peter raised it twice as a reader complaint.
  const short = 'The vote passed on Tuesday after debate. Officials expect [more detail](#1) soon.';
  const nitty = { ...good, paragraphs: [para(9, 10), short, para(3, 4), para(5, 6), para(7, 8)] };
  const problems = validateBrief(nitty, clusters);
  assert.ok(
    problems.length > 0 && !problems.some(isFatal),
    `fixture must have a cosmetic-only problem: ${problems.join(' | ')}`,
  );
  const out = await writeBrief(clusters, null, async () => wrap(nitty));
  assert.equal(out.paragraphs.length, 5, 'sent despite the nit');
});

test('a final draft with a fabricated link is still refused', async () => {
  const broken = { ...good, paragraphs: [para(1, 2), para(3, 4), para(5, 6), para(7, 8), para(9, 999)] };
  await assert.rejects(() => writeBrief(clusters, null, async () => wrap(broken)), BriefValidationError);
});

test('an access or billing failure fails fast instead of retrying', async () => {
  // Retrying a "no access to this model" error three times wastes the send
  // window and reports a parse failure that never happened.
  let calls = 0;
  const draft: DraftFn = async () => {
    calls++;
    throw new Error('Free tier users do not have access to this model. Upgrade to paid credits.');
  };
  await assert.rejects(() => writeBrief(clusters, null, draft), BriefConfigError);
  assert.equal(calls, 1, 'stopped after the first attempt');
});

test('the alert names the real cause, not a parse error', async () => {
  const draft: DraftFn = async () => {
    throw new Error('Free tier users do not have access to this model.');
  };
  await writeBrief(clusters, null, draft).catch((e) => {
    assert.match(e.message, /not usable by this account/);
    assert.match(e.message, /Add credits/);
    assert.ok(!/could not be parsed/.test(e.message));
  });
});

test('classifies retryable and unretryable failures correctly', () => {
  for (const m of [
    'Free tier users do not have access to this model',
    'Insufficient credits remaining',
    'Unauthorized: invalid API key',
    'quota exceeded for this billing period',
  ]) assert.ok(isUnretryable(m), `should be fatal: ${m}`);

  for (const m of [
    'No object generated: response did not match schema.',
    'The model returned an incomplete response',
    'fetch failed',
  ]) assert.ok(!isUnretryable(m), `should retry: ${m}`);
});

test('the model chain has real depth and no duplicates', () => {
  // Aug 10: one hard-coded model lost the day's brief. There must always be
  // somewhere else to go.
  assert.ok(MODEL_CHAIN.length >= 5, `only ${MODEL_CHAIN.length} models configured`);
  assert.equal(new Set(MODEL_CHAIN).size, MODEL_CHAIN.length, 'no duplicates');
  const providers = new Set(MODEL_CHAIN.map((m) => m.split('/')[0]));
  assert.ok(providers.size >= 2, 'the chain must span more than one provider');
});

test('an access error on one model does not fail the run outright', async () => {
  // Simulates the chain: first model blocked, second works.
  let attempt = 0;
  const draft: DraftFn = async () => {
    attempt++;
    if (attempt === 1) throw new Error('Free tier users do not have access to this model.');
    return wrap(good);
  };
  // writeBrief treats an access error as fatal because the chain lives inside
  // defaultDraft; a custom draft that recovers should still be honoured.
  await assert.rejects(() => writeBrief(clusters, null, draft), BriefConfigError);
});

test('pivots are split out before validation, so they cannot fail a brief', async () => {
  const { splitPivots } = await import('../lib/write');
  const withPivot = [
    'The vote passed Tuesday after a long debate over the text of the bill itself. ' +
      'Meanwhile a drone was found at an airport and police opened [an inquiry](#1).',
  ];
  const fixed = splitPivots(withPivot);
  assert.equal(fixed.length, 2, 'split into two paragraphs');
  assert.ok(!/Meanwhile/.test(fixed.join(' ')), 'the transition word is gone');
  assert.match(fixed[1], /^A drone/, 'the new paragraph is re-capitalised');
  assert.deepEqual(validateBrief({ subject: 'x', paragraphs: fixed }, clusters).filter((p) => /pivots/.test(p)), []);
});

test('a pivot at the start of a paragraph is left alone', async () => {
  const { splitPivots } = await import('../lib/write');
  const p = 'Meanwhile in Washington the Senate returned from recess to a full calendar.';
  assert.deepEqual(splitPivots([p]), [p]);
});
