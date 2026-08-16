import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Sources come from a published Google Sheet when FEEDS_SHEET_URL is set, and
 * from feeds.txt otherwise. The sheet wins because editing it takes effect on
 * the next run with no redeploy; the local file is the fallback so a network
 * blip or a broken share setting can't stop the brief going out.
 */

export type Section = 'us' | 'world' | 'business' | 'tech' | 'science' | 'sports' | 'usc' | 'good' | 'jewish';

export type Feed = {
  source: string;
  section: Section;
  url: string;
  weight: number;
  /**
   * How far back this feed's stories stay eligible. Defaults to 30h, which suits
   * daily outlets. Campus and weekly papers need far longer or they never appear.
   */
  maxAgeHours: number;
};

export type FeedConfig = {
  feeds: Feed[];
  quotas: Record<Section, number>;
  /** Complaints about individual rows, surfaced by check:feeds. */
  warnings: string[];
  origin: 'sheet' | 'file';
};

export const SECTION_ORDER: Section[] = ['us', 'world', 'business', 'tech', 'science', 'sports', 'usc', 'good', 'jewish'];

export const SECTION_LABELS: Record<Section, string> = {
  us: 'United States',
  world: 'World',
  business: 'Business & Economy',
  tech: 'Technology',
  science: 'Science, Health & Climate',
  sports: 'Sports & Culture',
  usc: 'USC (Daily Trojan)',
  good: 'Good News — include one of these every day',
  jewish: 'Upcoming Jewish holiday — mention every day',
};

const VALID_SECTIONS = new Set<string>(SECTION_ORDER);

const DEFAULT_QUOTAS: Record<Section, number> = {
  us: 10,
  world: 8,
  business: 6,
  tech: 6,
  science: 6,
  sports: 4,
  usc: 4,
  good: 5,
  jewish: 1,
};

/** Feeds that don't publish daily need a longer eligibility window. */
const DEFAULT_MAX_AGE_HOURS = 30;

export class FeedConfigError extends Error {}

/** Minimal CSV reader: handles quoted fields, embedded commas, and "" escapes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);

  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * Both sources reduce to the same shape: rows of
 * [section, outlet, url, weight?], plus `quota` rows.
 */
function buildConfig(rows: string[][], origin: FeedConfig['origin']): FeedConfig {
  const feeds: Feed[] = [];
  const quotas = { ...DEFAULT_QUOTAS };
  const warnings: string[] = [];

  rows.forEach((cols, i) => {
    const rowNo = i + 1;
    const [rawSection, source, url, weightRaw, ageRaw] = cols.map((c) => (c ?? '').trim());
    const section = rawSection.toLowerCase();

    if (!section || section.startsWith('#')) return;
    // Tolerate a header row in the sheet.
    if (section === 'section') return;

    if (section === 'quota') {
      const target = (source ?? '').toLowerCase();
      if (!VALID_SECTIONS.has(target)) {
        warnings.push(`row ${rowNo}: unknown section "${source}" in quota row — ignored`);
        return;
      }
      const n = Number(url);
      if (!Number.isFinite(n) || n < 0) {
        warnings.push(`row ${rowNo}: quota "${url}" is not a number — ignored`);
        return;
      }
      quotas[target as Section] = Math.floor(n);
      return;
    }

    if (!VALID_SECTIONS.has(section)) {
      warnings.push(
        `row ${rowNo}: unknown section "${rawSection}" (use ${SECTION_ORDER.join(', ')}) — ignored`,
      );
      return;
    }
    if (!source) {
      warnings.push(`row ${rowNo}: missing outlet name — ignored`);
      return;
    }
    if (!/^https?:\/\//.test(url ?? '')) {
      warnings.push(`row ${rowNo}: "${url}" is not a http(s) URL — ignored`);
      return;
    }

    let weight = 1.0;
    if (weightRaw) {
      const n = Number(weightRaw);
      if (!Number.isFinite(n) || n <= 0 || n > 1) {
        warnings.push(`row ${rowNo}: weight "${weightRaw}" must be 0.1-1.0 — using 1.0`);
      } else {
        weight = n;
      }
    }

    let maxAgeHours = DEFAULT_MAX_AGE_HOURS;
    if (ageRaw) {
      const n = Number(ageRaw);
      if (!Number.isFinite(n) || n <= 0) {
        warnings.push(`row ${rowNo}: max-age "${ageRaw}" must be a positive number of hours — using ${DEFAULT_MAX_AGE_HOURS}`);
      } else {
        maxAgeHours = n;
      }
    }

    feeds.push({ section: section as Section, source, url, weight, maxAgeHours });
  });

  if (feeds.length === 0) {
    throw new FeedConfigError('No usable feeds found. Each row needs section, outlet, and url.');
  }

  return { feeds, quotas, warnings, origin };
}

/** feeds.txt uses `|` columns; strip comments first. */
export function parseFeedFile(text: string): FeedConfig {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((l) => l.split('|'));
  return buildConfig(rows, 'file');
}

export function parseFeedSheet(csv: string): FeedConfig {
  return buildConfig(parseCsv(csv), 'sheet');
}

function loadFromFile(): FeedConfig {
  const path = join(process.cwd(), 'feeds.txt');
  try {
    return parseFeedFile(readFileSync(path, 'utf8'));
  } catch (err) {
    if (err instanceof FeedConfigError) throw err;
    throw new FeedConfigError(`Could not read ${path}. feeds.txt must sit at the repo root.`);
  }
}

let cached: { at: number; config: FeedConfig } | null = null;
const CACHE_MS = 60_000;

export async function loadFeedConfig(force = false): Promise<FeedConfig> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.config;

  const sheetUrl = process.env.FEEDS_SHEET_URL;
  let config: FeedConfig;

  if (sheetUrl) {
    try {
      const res = await fetch(sheetUrl, {
        signal: AbortSignal.timeout(15_000),
        redirect: 'follow',
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      // A sheet that isn't actually published returns an HTML sign-in page.
      if (/^\s*<(!doctype|html)/i.test(body)) {
        throw new Error('got HTML, not CSV — is the sheet published to the web?');
      }
      config = parseFeedSheet(body);
    } catch (err) {
      console.warn(
        `[feeds] sheet unavailable (${err instanceof Error ? err.message : err}); falling back to feeds.txt`,
      );
      config = loadFromFile();
    }
  } else {
    config = loadFromFile();
  }

  cached = { at: Date.now(), config };
  return config;
}
