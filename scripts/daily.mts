/**
 * The daily run, for the local (launchd) schedule.
 *
 * Guards against double-sends with a marker file, since the Blob archive isn't
 * configured locally. On failure Rose gets nothing and the alert goes to
 * ALERT_EMAIL — a missing brief is recoverable, a broken one isn't.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBrief } from '../lib/pipeline';
import { sendBrief, sendFailureAlert } from '../lib/send';
import { todayPT } from '../lib/schedule';

const STATE_DIR = join(process.cwd(), '.state');
const LOG = join(STATE_DIR, 'daily.log');

function log(line: string) {
  const stamp = new Date().toISOString();
  const entry = `${stamp}  ${line}\n`;
  process.stdout.write(entry);
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(LOG, entry);
  } catch {
    /* logging must never break the run */
  }
}

const today = todayPT();
const marker = join(STATE_DIR, `sent-${today}.txt`);

if (existsSync(marker) && !process.argv.includes('--force')) {
  log(`already sent for ${today}; skipping. Use --force to override.`);
  process.exit(0);
}

try {
  const { rendered, clusters, failures } = await buildBrief();
  const id = await sendBrief(rendered);

  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(marker, `${id}\n${rendered.subject}\n`);

  log(
    `SENT ${today} → ${process.env.ROSE_EMAIL} | "${rendered.subject}" | ` +
      `${rendered.citedIds.length}/${clusters.length} stories | ` +
      `feed failures: ${failures.length ? failures.join('; ') : 'none'}`,
  );
} catch (err) {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  log(`FAILED ${today}: ${detail.split('\n')[0]}`);
  await sendFailureAlert(err instanceof Error ? (err.name || 'Error') : 'UnknownError', detail);
  process.exit(1);
}
