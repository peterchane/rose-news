import type { Cluster } from './select';
import { SECTION_ORDER } from './feeds';

/**
 * The email Rose gets when the writer cannot produce one.
 *
 * Twice now a bad draft has meant no email at all: once when five of eight
 * paragraphs cited nothing, once when all three did. Every repair and every
 * retry in lib/write.ts is a way of rescuing a draft, and all of them assume
 * there is a draft worth rescuing. This assumes nothing.
 *
 * It is deliberately dumb — headline, first line of the summary, a link — so
 * that it cannot fail the way prose can. It is not a good email. It is an email,
 * on a morning that would otherwise have been silent.
 */
export const FALLBACK_STORIES = 6;

/** A plain sentence per story, built from the candidate list alone. */
export function fallbackParagraphs(clusters: Cluster[], max = FALLBACK_STORIES): string[] {
  const picked = pickAcrossSections(clusters, max);

  return picked.map((c) => {
    const headline = tidy(c.title);
    const detail = firstSentence(c.blurb);
    // The citation is the whole point: lib/render.ts turns #id into the real
    // link, so even this degraded email still reaches the actual story.
    const cite = `[${c.source}](#${c.id})`;
    return detail ? `${headline}. ${detail} ${cite}` : `${headline}. ${cite}`;
  });
}

/**
 * Spread the picks over sections rather than taking the top six by score, so a
 * heavy news day doesn't hand her six paragraphs of the same story.
 */
function pickAcrossSections(clusters: Cluster[], max: number): Cluster[] {
  const byScore = [...clusters].sort((a, b) => b.score - a.score);
  const picked: Cluster[] = [];
  const used = new Set<string>();

  for (const section of SECTION_ORDER) {
    if (picked.length >= max) break;
    const best = byScore.find((c) => c.section === section && !picked.includes(c));
    if (best) {
      picked.push(best);
      used.add(section);
    }
  }
  // Backfill by score if the sections ran out before the quota did.
  for (const c of byScore) {
    if (picked.length >= max) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked;
}

/** Feed titles arrive with outlet suffixes, stray whitespace and trailing punctuation. */
function tidy(title: string): string {
  return title.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
}

function firstSentence(blurb: string): string {
  const clean = (blurb ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const end = clean.search(/[.!?]\s/);
  const sentence = end === -1 ? clean : clean.slice(0, end + 1);
  return sentence.length > 220 ? '' : sentence;
}

/** Said plainly at the top, because a short email with no explanation reads as broken. */
export const FALLBACK_NOTE =
  "Short one today — the full write-up didn't come together, so here are the headlines.";
