# TODO — Aug 6/7

## First thing: did the 8am send work?

The cron fires between 8:00 and 8:59am PT (Hobby precision is ±59 min). This is the
first fully automatic run — every prior send was triggered by hand.

- [ ] Check your inbox for the BCC copy. If it's there, it worked.
- [ ] If nothing arrived by ~9:15am, check the logs:
      `./node_modules/.bin/vercel logs rose-news --prod`
      A failure emails `ALERT_EMAIL` (you), so silence in both places means the cron
      didn't fire at all — different problem from the brief failing.

## Read it as Rose would

- [ ] Does the USC paragraph read naturally? Those stories are days old (the Daily
      Trojan publishes weekly). The prompt says to frame them as "what's going on at
      USC" rather than today's news — check that it actually does.
- [ ] Is there a US sports story? Now enforced in code, but confirm it isn't shoehorned.
- [ ] Any editorializing? A draft earlier ended a Bessent line with "a claim that
      clashes with the data" — that's the model taking a side, which the prompt forbids.
      Flag anything similar.
- [ ] Sentence length and paragraph breaks still feel right?
- [ ] Click 3-4 links and confirm each goes where the sentence says.

## Decisions still open

- [ ] **Source list.** The 15 feeds are my picks, not yours. On US politics the mix
      leans center-left (NPR, NYT, Guardian) with WSJ the only counterweight, and its
      opinion section is filtered out. You said you'd send a list — that's the biggest
      remaining judgment call in the whole thing.
- [ ] **Google Sheet for sources.** Deferred. Until then, editing `feeds.txt` needs a
      redeploy. CSV to paste is ready whenever you want it.
- [ ] **Opus.** You said Opus is fine, but the Vercel top-up never landed, so it's
      running Sonnet 5 on the free tier. Add credits and set `BRIEF_MODEL=anthropic/claude-opus-5`
      to switch. My guess is you won't see a difference on this task.
- [ ] **Blob storage.** Skipped for now. Revisit if day-over-day repetition starts
      bugging you — that's what it fixes.

## Housekeeping

- [ ] Commit the code. Everything since the scaffold is uncommitted and living in one
      untracked directory.
- [ ] Decide whether the daily note rotation is right. Five messages cycling in
      `notes.txt`; today's was the reply-feedback one.

## Notes

- Sends 8am PT year-round. Two cron entries (15:00 and 16:00 UTC) with the route gating
  on the actual Pacific hour, so DST needs no maintenance.
- `npm test` — 64 tests. Run after any source change.
- `npm run check:feeds` — live check that every feed still responds.
- Rose received two unscheduled briefs on Aug 5 from my testing. Tomorrow's 8am is the
  first real one.
