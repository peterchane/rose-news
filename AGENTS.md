# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

---

# Working on rose-news

This sends a real email to a real teenager every morning at 8am Pacific. A
broken deploy or a bad filter reaches her, not a staging environment.

## Never push or deploy without running tests first

Four builds have been broken here, every one the same way: behaviour changed, a
test still asserted the old behaviour, and the push went out before the suite
ran. Each one emailed the owner an alert he hadn't been warned about.

```bash
npm test          # must be green BEFORE npm run build, vercel deploy, or git push
```

A `.githooks/pre-push` hook enforces this. Don't bypass it with `--no-verify`.

## Changing behaviour means changing its tests in the same edit

Before changing a rule, threshold, or pattern, grep for it in `tests/`. The old
value is almost certainly asserted somewhere. Update those assertions as part of
the change, not after the build fails.

## Say what shipped

State deploy and push status in the reply, without being asked. "Deployed to
Vercel and pushed to GitHub" or "not deployed yet". The owner should never have
to ask whether something is live.

## Don't trigger alerts he hasn't agreed to

A failed build emails him. So does a failed brief. Never deliberately break
something to demonstrate a safety net, and never send email to Rose without
explicit say-so for that send.

## The invariants

- **The model never handles a URL.** It cites numbered candidates as
  `[phrase](#12)`; `lib/render.ts` resolves them and drops anything unrecognised.
  Never let a URL into the prompt or accept one from the model.
- **Content filtering is code, not prompting** (`lib/ingest.ts`). School
  violence is checked against headline *and* summary, is never exempted, and is
  fatal in the finished prose too.
- **Failure means no email, plus an alert to the owner** — never a broken or
  half-correct email to Rose.

## Cost

One brief is ~$0.02. Extended thinking is disabled deliberately: it was 78% of
the bill for a task that is selection and formatting, not reasoning. Don't
re-enable it. Don't add retries that fire on cosmetic problems.

## Config lives in text files

`feeds.txt`, `teams.txt`, `notes.txt` at the repo root. The owner edits these
directly — keep them readable and commented, and don't move settings into code.
