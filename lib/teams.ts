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
  /\b(trade[ds]?|trading|acquir\w*|sign(s|ed|ing)?|waiv\w*|releas\w*|call(s|ed)? up|streak|sweep|swept|clinch\w*|playoff|postseason|world series|championship|title|no-hitter|perfect game|record|fires?|fired|hires?|hired|extension|contract|out for the season|injur\w*|suspend\w*|retires?|retirement|debut|upsets?|upset\w*|undefeated|unbeaten|ranked|top 25|rivalry|bowl game|conference (title|championship)|rivalry game|knocks? off)\b/i;

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

/**
 * USC means football. Peter: "just football unless basketball has a very big
 * game." Any other USC sport named in the headline gets in only for a game that
 * genuinely matters — the NCAA tournament, a title game — never a ranking, an
 * exhibition or a routine win.
 */
const USC = /\b(usc|trojans?)\b/i;
const OTHER_SPORT =
  /\b(basketball|hoops|baseball|softball|volleyball|soccer|water polo|tennis|golf|track|swim\w*|lacrosse|hockey|beach volleyball|march madness)\b/i;
const VERY_BIG_GAME =
  /\b(ncaa tournament|march madness|final four|elite eight|sweet 16|sweet sixteen|national (title|championship)|championship game|title game|conference (title|championship) game|big ten tournament final|vs\.? no\. 1|against no\. 1)\b/i;

export function isUscOtherSport(c: { title: string; blurb: string }): boolean {
  const hay = `${c.title} ${c.blurb}`;
  return USC.test(hay) && OTHER_SPORT.test(hay);
}

export function uscSportAllowed(c: { title: string; blurb: string }): boolean {
  if (!isUscOtherSport(c)) return true;
  return VERY_BIG_GAME.test(`${c.title} ${c.blurb}`);
}

/**
 * The result of a USC football game. When one exists it always leads her
 * interests: USC upset Ohio State and the email ran a photo gallery that never
 * said who won, while the win itself sat unused.
 */
const RESULT = /\b(beat|beats|upset\w*|defeat\w*|stun\w*|rout\w*|tops?|edges?|falls? to|loses? to|lost to|win over|wins? (at|over|against)|loss to|knocks? off|holds? off|rall(y|ies) past)\b/i;

/**
 * Speculation that uses result words: "Is an upset brewing? Breaking down the
 * keys to Ohio State-USC" is a preview, and treating it as the result is what
 * kept the actual upset out of two emails.
 */
const SPECULATIVE = /\?|\b(brewing|keys to|breaking down|preview|predict\w*|odds|how to watch|what to watch|could|can|will|would|might|need to|must|bigger roles?|draft stock|matchup)\b/i;

export function isUscFootballResult(c: { title: string; blurb: string }): boolean {
  return USC.test(c.title) && RESULT.test(c.title) && !SPECULATIVE.test(c.title) && !isUscOtherSport(c);
}

/** The opponent named in a result headline, for telling one game from the next. */
export function opponentWords(title: string): Set<string> {
  const skip = /^(usc|trojans?|the|and|with|after|over|for|its|his|in|of|to|at|win|wins|upset|beats?|defeats?|stuns?|falls?|loses?|lost|saves?|hopes?|cfp|riley|embattled|relishes|state|university|college|north|south|east|west|central|angeles|rout|overtime|game|football|team|points|images|photos|coliseum)$/i;
  return new Set(
    title.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !skip.test(w)),
  );
}
