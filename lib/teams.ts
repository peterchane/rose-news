import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Rose's teams. Sports feeds carry far more stories than the email has room
 * for, and without a thumb on the scale the slots go to whatever happened to be
 * corroborated — usually a team she doesn't follow.
 */

export type TeamRules = {
  /**
   * Boosted for every mention, including a routine game result. Marked with a
   * leading `+`. Rarely what you want.
   */
  always: string[];
  /**
   * The default. Boosted only when something notable happened — a trade, a
   * signing, a streak, an injury, a playoff berth. A single game result is not
   * news, even for a team she follows.
   */
  notableOnly: string[];
  /**
   * Postseason only, marked with a leading `!`. For a team Rose doesn't
   * follow but whose October run is unavoidable in Los Angeles — Peter, on the
   * Dodgers: "dodgers are in playoffs so that's ok for playoffs." A trade or a
   * regular-season win still isn't news.
   */
  postseasonOnly: string[];
};

export function parseTeams(text: string): string[] {
  const r = parseTeamRules(text);
  return [...r.always, ...r.notableOnly, ...r.postseasonOnly];
}

export function parseTeamRules(text: string): TeamRules {
  const always: string[] = [];
  const notableOnly: string[] = [];
  const postseasonOnly: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // `+` is every game, `!` is October only, and the default is notable-only,
    // because "Dodgers won last night" is not news.
    if (line.startsWith('+')) always.push(line.slice(1).trim());
    else if (line.startsWith('!')) postseasonOnly.push(line.slice(1).trim());
    else notableOnly.push(line.trim());
  }
  return { always, notableOnly, postseasonOnly };
}

/** October, and only October. Narrower than NOTABLE_EVENT on purpose. */
export const POSTSEASON_EVENT =
  /\b(playoffs?|postseason|world series|nlds|nlcs|alds|alcs|wild ?card|division series|pennant|clinch\w*|elimination|eliminated|game \d+|series lead)\b/i;

/**
 * A result worth telling Rose about: a trade, a signing, a streak, a sweep, a
 * title. Deliberately excludes "Cubs 4, Reds 2" — she doesn't want box scores.
 */
export const NOTABLE_EVENT =
  /\b(trade[ds]?|trading|acquir\w*|sign(s|ed|ing)?|waiv\w*|releas\w*|call(s|ed)? up|streak|sweep|swept|clinch\w*|playoff|postseason|world series|championship|title|no-hitter|perfect game|record|fires?|fired|hires?|hired|extension|contract|out for the season|injur\w*|suspend\w*|retires?|retirement|debut)\b/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive match on any configured team. */
export function buildTeamPattern(teams: string[]): RegExp | null {
  if (teams.length === 0) return null;
  // Longest first so "Chicago Bears" wins over "Bears" when both are listed.
  const alts = [...teams].sort((a, b) => b.length - a.length).map(escapeRe);
  return new RegExp(`\\b(${alts.join('|')})\\b`, 'i');
}

function load(): TeamRules {
  try {
    return parseTeamRules(readFileSync(join(process.cwd(), 'teams.txt'), 'utf8'));
  } catch {
    console.warn('[teams] could not read teams.txt; no team preference applied');
    return { always: [], notableOnly: [], postseasonOnly: [] };
  }
}

const RULES = load();

export const TEAMS = [...RULES.always, ...RULES.notableOnly, ...RULES.postseasonOnly];
export const TEAM_PATTERN = buildTeamPattern(RULES.always);
export const NOTABLE_ONLY_PATTERN = buildTeamPattern(RULES.notableOnly);
export const POSTSEASON_ONLY_PATTERN = buildTeamPattern(RULES.postseasonOnly);
