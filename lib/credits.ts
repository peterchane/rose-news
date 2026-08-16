/**
 * AI Gateway balance. Peter asked to be warned before it runs out rather than
 * finding out from a failed brief, which is how Aug 10 was lost.
 */

const CREDITS_URL = 'https://ai-gateway.vercel.sh/v1/credits';

/** Warn once the balance drops below this many days of briefs. */
export const LOW_BALANCE_DAYS = 21;

export type Credits = { balance: number; used: number };

export async function fetchCredits(): Promise<Credits | null> {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(CREDITS_URL, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { balance?: string; total_used?: string };
    return { balance: Number(d.balance ?? 0), used: Number(d.total_used ?? 0) };
  } catch {
    return null;
  }
}

/** Null when there's plenty left; otherwise the warning to send. */
export function lowBalanceWarning(
  credits: Credits,
  costPerBrief: number,
): string | null {
  if (costPerBrief <= 0) return null;
  const days = Math.floor(credits.balance / costPerBrief);
  if (days > LOW_BALANCE_DAYS) return null;

  return (
    `Rose's brief has about ${days} days of credit left ` +
    `($${credits.balance.toFixed(2)} at roughly $${costPerBrief.toFixed(3)} per email).\n\n` +
    `Top up at https://vercel.com/dashboard → AI Gateway → Credits before it runs out. ` +
    `$10 buys roughly ${Math.round(10 / costPerBrief)} more days.`
  );
}
