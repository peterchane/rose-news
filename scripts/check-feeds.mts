/**
 * Verifies every configured feed. Run after editing your sources:
 *
 *     npm run check:feeds
 *
 * Reads the Google Sheet if FEEDS_SHEET_URL is set, otherwise feeds.txt.
 * Reports which feeds respond, how many usable stories each produced today,
 * and the top stories the writer would see.
 */
import { loadFeedConfig, SECTION_ORDER, SECTION_LABELS } from '../lib/feeds';
import { ingest } from '../lib/ingest';
import { selectClusters } from '../lib/select';

const config = await loadFeedConfig();

console.log(
  `\nSource: ${config.origin === 'sheet' ? 'Google Sheet (FEEDS_SHEET_URL)' : 'feeds.txt'}`,
);

if (config.warnings.length > 0) {
  console.log('\nProblems found:');
  for (const w of config.warnings) console.log(`  ! ${w}`);
}

const { articles, failures } = await ingest(config.feeds);

console.log(`\n${config.feeds.length} feeds configured\n${'─'.repeat(78)}`);

let broken = 0;
for (const section of SECTION_ORDER) {
  const feeds = config.feeds.filter((f) => f.section === section);
  if (feeds.length === 0) continue;
  console.log(`\n${SECTION_LABELS[section]}  (quota: ${config.quotas[section]} stories)`);

  for (const feed of feeds) {
    const failure = failures.find((f) => f.startsWith(`${feed.source} (${feed.section})`));
    if (failure) {
      broken++;
      console.log(`  BROKEN  ${feed.source.padEnd(24)} ${failure.split(': ').slice(1).join(': ')}`);
      continue;
    }
    const mine = articles.filter((a) => a.source === feed.source && a.section === feed.section);
    const sample = mine[0]?.title.slice(0, 42) ?? '';
    console.log(
      `  ${mine.length === 0 ? 'EMPTY ' : 'ok    '}  ${feed.source.padEnd(24)} ` +
        `${String(mine.length).padStart(3)} stories  w=${feed.weight}  ${sample ? `· ${sample}…` : ''}`,
    );
  }
}

const clusters = selectClusters(articles, config.quotas);
const corroborated = clusters.filter((c) => c.coverage.length > 1).length;

console.log(`\n${'─'.repeat(78)}`);
console.log(`${articles.length} usable stories → ${clusters.length} after merging duplicates`);
console.log(`${corroborated} covered by 2+ outlets (these rank highest)`);
if (broken > 0) console.log(`\n${broken} feed(s) BROKEN — fix or remove the URL`);

console.log(`\nTop 8 stories the writer would see today:`);
for (const c of clusters.slice(0, 8)) {
  console.log(`  [${c.section}] ${c.title.slice(0, 62)}`);
  console.log(`           ${c.coverage.map((x) => x.source).join(', ')}`);
}
console.log();
