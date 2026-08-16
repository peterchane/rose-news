import { alreadySentToday, archiveBrief } from '@/lib/archive';
import { buildBrief } from '@/lib/pipeline';
import { currentHourPT, isDeliveryHour, TARGET_HOUR_PT } from '@/lib/schedule';
import { sendBrief, sendFailureAlert } from '@/lib/send';
import { fetchCredits, lowBalanceWarning } from '@/lib/credits';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // `?force=1` runs regardless of the clock, for manual triggers from the
  // Vercel dashboard.
  const force = new URL(req.url).searchParams.get('force') === '1';

  // Two cron entries fire daily (15:00 and 16:00 UTC) so that exactly one lands
  // in the 8am Pacific hour year-round. The other one no-ops here.
  if (!force && !isDeliveryHour()) {
    return Response.json({
      ok: true,
      skipped: 'off-hour',
      hourPT: currentHourPT(),
      targetHourPT: TARGET_HOUR_PT,
    });
  }

  if (!force && (await alreadySentToday())) {
    return Response.json({ ok: true, skipped: 'already-sent-today' });
  }

  try {
    const { brief, rendered, clusters, failures } = await buildBrief();

    const id = await sendBrief(rendered);

    // Archiving is bookkeeping; a failure here must not report the send as failed.
    try {
      await archiveBrief(brief, clusters, rendered.html, rendered.citedIds);
    } catch (err) {
      console.error('[cron] archive failed after successful send:', err);
    }

    // Warn well before the balance runs out, rather than after a failed brief.
    try {
      const credits = await fetchCredits();
      if (credits) {
        const warning = lowBalanceWarning(credits, 0.065);
        console.log(`[credits] $${credits.balance.toFixed(2)} left`);
        if (warning) await sendFailureAlert('AI credit running low', warning);
      }
    } catch (err) {
      console.warn('[credits] balance check failed:', err);
    }

    return Response.json({
      ok: true,
      messageId: id,
      subject: rendered.subject,
      paragraphs: brief.paragraphs.length,
      storiesCited: rendered.citedIds.length,
      candidates: clusters.length,
      feedFailures: failures,
    });
  } catch (err) {
    const reason = err instanceof Error ? (err.name || 'Error') : 'UnknownError';
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error('[cron] brief failed:', detail);

    await sendFailureAlert(reason, detail);

    // 200 keeps Vercel from retrying a run we already alerted on.
    return Response.json({ ok: false, reason, detail }, { status: 200 });
  }
}
