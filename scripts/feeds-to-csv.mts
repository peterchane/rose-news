/**
 * Prints the current feed config as CSV for pasting into a Google Sheet.
 *
 *     npm run feeds:csv
 *
 * In Google Sheets: File > Import > Upload, or just paste and use
 * Data > Split text to columns.
 */
import { loadFeedConfig, SECTION_ORDER } from '../lib/feeds';

const config = await loadFeedConfig();

const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

console.log(['section', 'outlet', 'url', 'weight'].join(','));
for (const f of config.feeds) {
  console.log([f.section, esc(f.source), esc(f.url), f.weight].join(','));
}
for (const s of SECTION_ORDER) {
  console.log(['quota', s, config.quotas[s], ''].join(','));
}
