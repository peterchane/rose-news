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
};

export function parseTeams(text: string): string[] {
  return parseTeamRules(text).always.concat(parseTeamRules(text).notableOnly);
}

export function parseTeamRules(text: string): TeamRules {
  const always: string[] = [];
  const notableOnly: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // `+` opts a team into every-game coverage; everything else is
    // notable-only, because "Dodgers won last night" is not news.
    if (line.startsWith('+')) always.push(line.slice(1).trim());
    else notableOnly.push(line.replace(/^!/, '').trim());
  }
  return { always, notableOnly };
}

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
    return { always: [], notableOnly: [] };
  }
}

const RULES = load();

export const TEAMS = [...RULES.always, ...RULES.notableOnly];
export const TEAM_PATTERN = buildTeamPattern(RULES.always);
export const NOTABLE_ONLY_PATTERN = buildTeamPattern(RULES.notableOnly);
