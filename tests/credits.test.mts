import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lowBalanceWarning, LOW_BALANCE_DAYS } from '../lib/credits';

test('stays quiet while there is plenty of credit', () => {
  assert.equal(lowBalanceWarning({ balance: 12, used: 3 }, 0.065), null);
});

test('warns before the balance runs out, not after', () => {
  const w = lowBalanceWarning({ balance: 1.0, used: 14 }, 0.065)!;
  assert.ok(w, 'should warn');
  assert.match(w, /15 days of credit left/);
  assert.match(w, /vercel\.com\/dashboard/);
  assert.match(w, /\$10 buys roughly 154 more days/);
});

test('warns at the threshold, not one day late', () => {
  const cost = 0.065;
  assert.equal(lowBalanceWarning({ balance: cost * (LOW_BALANCE_DAYS + 5), used: 0 }, cost), null);
  assert.ok(lowBalanceWarning({ balance: cost * LOW_BALANCE_DAYS, used: 0 }, cost));
});

test('an empty balance still produces a warning rather than dividing by zero', () => {
  assert.match(lowBalanceWarning({ balance: 0, used: 15 }, 0.065)!, /0 days/);
  assert.equal(lowBalanceWarning({ balance: 5, used: 0 }, 0), null);
});
