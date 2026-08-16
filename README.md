# Rose's Daily Brief

One email each morning summarizing the day's news in prose — not a list of links.
Source links are woven into the sentences as inline anchors.

## How it works

```
ingest (12 RSS feeds) → cluster & rank → write (Claude) → render → send (Gmail) → archive (Blob)
```

**The model never writes a URL.** It receives a numbered candidate list built from
articles we actually fetched, and cites them as `[the Senate vote](#12)`. The renderer
resolves each id against that list and silently drops any id it doesn't recognize.
Fabricated links aren't discouraged by the prompt — they're unrepresentable.

Ranking favors stories covered by multiple outlets, caps any single outlet's share of a
section, and filters out opinion columns, live blogs, video stubs, and digest pages.

## Setup

1. Fill in `.env.local` (copied from `.env.example`):
   - `AI_GATEWAY_API_KEY` — Vercel dashboard → AI Gateway → API Keys
   - `GMAIL_APP_PASSWORD` — https://myaccount.google.com/apppasswords
   - `ROSE_EMAIL` — where the brief goes
   - `CRON_SECRET` — `openssl rand -hex 32`

2. Preview without sending anything:

```bash
npm run dev
```

Then open http://localhost:3000/api/preview?debug=1 — the debug view lists every
resolved link so you can click through and confirm each points at real reporting.

3. Deploy:

```bash
npm i -g vercel && vercel link && vercel deploy --prod
```

Set the same env vars in the Vercel dashboard, and attach a Blob store (Storage → Blob)
so the brief remembers what it covered yesterday. Without Blob it still sends; it just
repeats itself more.

## Schedule

Delivery is **8am Pacific, year-round**.

Vercel cron is UTC-only with no DST awareness, and the Hobby plan allows each cron entry
to fire only once a day. So `vercel.json` registers two entries — 15:00 and 16:00 UTC —
and `lib/schedule.ts` gates on the actual Pacific hour. In summer the 15:00 entry lands
at 8am PDT and the 16:00 one no-ops; in winter it's the reverse. Exactly one send per
day, verified against both DST transition days.

Hobby cron precision is ±59 minutes, so it arrives somewhere in the 8am hour.
`alreadySentToday()` in `lib/archive.ts` is the backstop against a double send.

## Failure policy

If ingest yields fewer than 12 stories, the model fails validation twice, or Gmail
errors, **Rose gets nothing** and a failure alert goes to `ALERT_EMAIL` instead. A
missing email is recoverable; a broken one erodes the habit.

## Tuning the voice

Everything about how it reads lives in `SYSTEM_PROMPT` in `lib/write.ts`. Structural
guarantees (paragraph count, no lists, link density, valid ids) are enforced in code by
`validateBrief`, which feeds specific failures back to the model for one retry.
