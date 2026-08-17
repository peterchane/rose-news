import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { SECTION_LABELS, SECTION_ORDER } from './feeds';
import type { Cluster } from './select';
import { isSchoolViolence } from './ingest';

/**
 * Models are tried in order until one works. Gateway access changes without
 * warning — a tier limit, an exhausted balance, a model retired — and on Aug 10
 * a single hard-coded model took the whole brief down. Never depend on one.
 *
 * BRIEF_MODEL, when set, is tried first.
 */
export const MODEL_CHAIN: string[] = [
  process.env.BRIEF_MODEL,
  'anthropic/claude-sonnet-5',
  'anthropic/claude-opus-5',
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-3-haiku',
  'openai/gpt-5-mini',
  'google/gemini-2.5-flash',
].filter((m): m is string => Boolean(m));

/** The first entry, for logging and for the subject-line call. */
export const MODEL = MODEL_CHAIN[0];

/**
 * The model never writes a URL. It cites a cluster id — `[the Senate vote](#12)`
 * — and the renderer resolves that id against the candidate map. A fabricated
 * link is therefore not something the prompt discourages; it is something the
 * data model makes unrepresentable.
 */
export const briefSchema = z.object({
  // Optional on purpose. Sonnet reliably omits this field on longer candidate
  // lists, and a required-but-missing key makes the whole response unparseable
  // — which lost the Aug 6 brief. Absent subjects are synthesized below instead.
  subject: z
    .string()
    .optional()
    .describe(
      'REQUIRED. Email subject line naming the 2-3 biggest stories concretely, under 80 characters. No date prefix, no "Daily Brief".',
    ),
  // Deliberately loose. Count and shape are enforced by validateBrief, which
  // can hand the model specific feedback and retry. A constraint expressed here
  // instead becomes an unparseable-response error that kills the whole run —
  // which is exactly how the Aug 6 brief was lost.
  paragraphs: z
    .array(z.string())
    .describe(
      'The body: 5 to 9 paragraphs of flowing prose, each containing inline [phrase](#id) citations.',
    ),
});

type RawBrief = z.infer<typeof briefSchema>;

/** A brief that has been through writeBrief, so the subject is guaranteed. */
export type Brief = RawBrief & { subject: string };

/**
 * Sonnet drops the `subject` field on most runs once the system prompt is long,
 * so it's cheaper and far more reliable to ask for it on its own than to keep
 * fighting for it inside the main schema.
 */
/** Cached per invocation so the chain isn't re-probed for the subject call. */
let usableModel: string | null = null;
export function noteUsableModel(model: string) {
  usableModel = model;
}
async function firstUsableModel(): Promise<string> {
  return usableModel ?? MODEL;
}

export async function writeSubject(paragraphs: string[]): Promise<string | null> {
  try {
    const { text } = await generateText({
      model: await firstUsableModel(),
      prompt:
        `Write the email subject line for this news briefing.\n\n` +
        `Name the 2-3 biggest stories concretely. Under 80 characters. ` +
        `No date, no "Daily Brief", no quotes around it. Reply with the subject line only.\n\n` +
        paragraphs.join('\n\n').replace(/\[([^\]]+)\]\(#\d+\)/g, '$1'),
      temperature: 0.4,
      maxOutputTokens: 60,
    });
    const line = text.trim().split('\n')[0].replace(/^["']|["']$/g, '').trim();
    return line.length >= 10 && line.length <= 110 ? line : null;
  } catch (err) {
    console.warn('[write] subject call failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Last-resort subject built from the day's top stories, used only if the
 * dedicated subject call also fails. Headlines get truncated, so trim them to
 * something that reads like a subject rather than a cut-off sentence.
 */
export function synthesizeSubject(clusters: Cluster[]): string {
  const parts: string[] = [];
  for (const c of clusters.slice(0, 3)) {
    // Drop question headlines and subtitles; keep the first clause only.
    let short = c.title.split(/[:—–|?]/)[0].trim();
    // Explainer headlines ("What Is X Being Accused Of") make terrible subjects.
    if (/^(what|why|how|who|when|where)\b/i.test(short)) continue;
    if (short.length > 46) short = short.slice(0, 46).replace(/\s+\S*$/, '');
    if (!short) continue;
    if ([...parts, short].join(', ').length > 72) break;
    parts.push(short);
  }
  return parts.join(', ') || "Today's news";
}

/** Trim to a clean subject length at a word boundary. */
export function clampSubject(s: string, max = 78): string {
  const line = s.trim().replace(/\s+/g, ' ');
  if (line.length <= max) return line;
  return line.slice(0, max).replace(/[\s,;:—–-]+\S*$/, '').trim() || line.slice(0, max).trim();
}

/** Matches the model's citation syntax: [anchor text](#12) */
export const CITATION_RE = /\[([^\]\n]+)\]\(#(\d+)\)/g;

function formatCandidates(clusters: Cluster[]): string {
  const lines: string[] = [];
  for (const section of SECTION_ORDER) {
    const inSection = clusters.filter((c) => c.section === section);
    if (inSection.length === 0) continue;
    lines.push(`\n## ${SECTION_LABELS[section]}`);
    for (const c of inSection) {
      const outlets = c.coverage.map((x) => x.source).join(', ');
      const corroboration =
        c.coverage.length > 1 ? ` [covered by ${c.coverage.length} outlets: ${outlets}]` : ` [${c.source}]`;
      lines.push(`#${c.id} ${c.title}${corroboration}`);
      // Just enough context to disambiguate; the headline does the work.
      if (c.blurb) lines.push(`     ${c.blurb.slice(0, 110)}`);
    }
  }
  return lines.join('\n');
}

export const SYSTEM_PROMPT = `You write Rose's daily news email. She's a high school student (15-18), American, in California. She reads it because it's good, not because she has to.

Content is pre-filtered — crime, death, disease, drugs, disasters and gore never reach you. Don't police the topics; just write well.

ORDER:
- The prompt tells you which kind of story to LEAD WITH today. Follow it when a decent candidate exists; if there genuinely isn't one, lead with the biggest news story instead.
- A good lead is CONCRETE and affects people she can picture — money, jobs, schools, prices, a decision that changes something, a result. A bad lead is procedural or institutional: a lawsuit filed, a hearing scheduled, one agency's dispute with another, an argument about an international body. Those can appear later in the email, but never open it.
- Sports only when it's about a team she follows. If no sports candidates are offered, skip sports entirely — never fill the space with a team she has no stake in.
- After the lead, every US story comes before any foreign one. The lead itself can be foreign if that's genuinely the day's biggest story. Include a major tech story when one is offered.
- The Jewish holiday gets one or two sentences, near the end.
- Good news always closes the email.
Never announce the structure ("now to the news"). Just move between paragraphs.

FORM:
- 5-9 paragraphs, 40-80 words each. No headers or labels.
- One topic per paragraph. If you write "Meanwhile" or "Separately" mid-paragraph, break there instead.
- Sentences 12-20 words. One idea each.
- Never a bulleted or numbered list.

VOICE:
- A sharp friend telling her what happened. Not a newsletter, not a teacher.
- No greeting, no signoff, no exclamation points, no emoji, no "stay curious."
- Contractions yes. Hedging no.
- Report contested politics straight — what each side did, not what to think.

GLOSS THE UNFAMILIAR (she asked for this):
- Assume she hasn't heard of any country outside the US, UK, Canada, Mexico, China, Russia, France, Germany, Italy, Japan and Israel; any leader but the US president; any agency but the FBI and CIA; any economic term but inflation.
- On first mention only, work a 4-10 word gloss into the sentence: "Oman, a small country on the Arabian Peninsula next to Yemen". No parentheses, no asides. Never gloss twice, never gloss everyday words.

LINKS:
- Cite as [anchor](#ID) using the candidate number. You have no URLs — never write one.
- Anchor 3-6 words on a real phrase. Never "read more" or "here".
- 1-3 per paragraph. Most text is unlinked.

PICKING STORIES:
- Something must have happened: a vote, a ruling, a result, a launch. Not anniversaries, retrospectives, explainers, or someone restating a position.
- She follows USC football closely, plus SMU and Michigan. Cubs for major news only — a trade, signing, streak or playoff run, never a game result. She does not follow the Dodgers, Lakers, Rams, Chargers, Clippers or Bears.
- Sports means an event, not rankings or fantasy advice.
- Good news must be SUBSTANTIVE: a discovery, a species recovering, a record, a policy that worked, something restored or built. Never a feel-good vignette — one animal freed, one stranger's kind gesture, a local rescue. If the only thing that happened is that something nice happened to one creature, it isn't worth her time.
- Good news: prefer California, the West, or national.
- Foreign news only if it's genuinely big. Otherwise leave it out.

OUTPUT: return "subject" (a string, names 2-3 stories, under 80 chars) and "paragraphs" (an array of strings). Both, always.`;

/**
 * Which kind of story opens the email, rotated by date. Left to its own devices
 * the model picks the same section every day; rotating deliberately is what
 * actually varies the reading experience.
 */
export const LEAD_ROTATION = ['sports', 'us', 'usc', 'tech', 'us', 'science', 'us'] as const;

export function leadForDate(date: string): string {
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return LEAD_ROTATION[((days % LEAD_ROTATION.length) + LEAD_ROTATION.length) % LEAD_ROTATION.length];
}

const LEAD_LABEL: Record<string, string> = {
  sports: 'a sports story — ideally USC or the Cubs',
  us: 'the biggest US news story',
  usc: 'a USC story',
  tech: 'the major tech story',
  science: 'a science story',
};

export function buildPrompt(
  clusters: Cluster[],
  previous: PreviousBrief | null,
  lead?: string,
): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });

  const leadSection = lead ?? leadForDate(new Date().toISOString().slice(0, 10));
  const parts = [
    `Today is ${today}. Write today's briefing for Rose.`,
    `\nLEAD WITH: ${LEAD_LABEL[leadSection] ?? 'the biggest US news story'}. ` +
      `If no good candidate of that kind exists today, lead with the biggest US news story instead.`,
    `\nCandidate stories — these are the only stories you may write about, and the only IDs you may cite:\n${formatCandidates(clusters)}`,
  ];

  if (previous) {
    parts.push(
      `\n=== ALREADY SENT${previous.date ? ` (${previous.date})` : ''} ===\n` +
        `Subject was: ${previous.subject}\n` +
        `Stories she has ALREADY read about:\n${previous.topics.map((t) => `- ${t}`).join('\n')}\n\n` +
        `Rose asked not to be told the same story twice. Do NOT write about any story above again ` +
        `unless something genuinely new happened since — a new vote, a new death toll, a new decision. ` +
        `If nothing new happened, drop it entirely and use a different candidate, even a smaller one.\n` +
        `When a story HAS moved, open with what changed and reference the earlier coverage in passing ` +
        `("the Hormuz deal we mentioned yesterday was signed") rather than re-explaining the background.`,
    );
    if (previous.paragraphs?.length) {
      parts.push(
        `\nYesterday's exact wording, so you don't reuse phrasing:\n` +
          previous.paragraphs.map((p) => p.replace(/\[([^\]]+)\]\(#\d+\)/g, '$1')).join('\n\n'),
      );
    }
  }

  parts.push(
    `\nStories covered by several outlets are more likely to be the day's real news; weight them accordingly, but use your own judgment about what actually matters to a well-informed teenager.`,
  );

  return parts.join('\n');
}

export type PreviousBrief = {
  subject: string;
  /** Headlines of the stories yesterday's brief actually linked. */
  topics: string[];
  paragraphs?: string[];
  date?: string;
};

export class BriefValidationError extends Error {}

/** Raised for problems no retry can fix — credentials, access, quota. */
export class BriefConfigError extends Error {}

/**
 * Some failures are not the model's output being wrong; they're the call never
 * happening. Retrying those three times wastes the window and, worse, reports
 * "your response could not be parsed" when the truth is "this account can't use
 * this model" — which is exactly how the Aug 10 brief was lost.
 */
export function isUnretryable(message: string): boolean {
  return /free tier|do not have access|upgrade to paid|insufficient (credit|quota|funds)|quota exceeded|unauthenticated|unauthorized|invalid api key|billing/i.test(
    message,
  );
}

/**
 * Structural checks the prompt cannot guarantee. Anything caught here becomes
 * feedback for one retry — models reliably fix these when told specifically.
 */
/**
 * Problems that make a brief genuinely unsendable: fabricated or invalid links,
 * raw URLs, list formatting, or a body that isn't the right shape. Everything
 * else is a style nit worth one retry but not worth losing the day over.
 */
export function isFatal(problem: string): boolean {
  return /not a candidate ID|raw URL|bulleted or numbered list|paragraphs, got|distinct stories cited|school violence/.test(
    problem,
  );
}

export function validateBrief(brief: Brief, clusters: Cluster[]): string[] {
  const problems: string[] = [];

  // Absolute. Checked on the finished prose as well as at ingest, because this
  // is the one subject where a filter miss is not acceptable. Always fatal.
  for (const [i, para] of brief.paragraphs.entries()) {
    if (isSchoolViolence(para)) {
      problems.push(
        `Paragraph ${i + 1} refers to school violence, which must NEVER appear. Remove it entirely.`,
      );
    }
  }
  const validIds = new Set(clusters.map((c) => c.id));
  const sectionById = new Map(clusters.map((c) => [c.id, c.section]));

  if (brief.paragraphs.length < 5 || brief.paragraphs.length > 9) {
    problems.push(`Need 5-9 paragraphs, got ${brief.paragraphs.length}.`);
  }

  brief.paragraphs.forEach((para, i) => {
    const n = i + 1;

    if (/^\s*(?:[-*•]|\d+[.)])\s/m.test(para)) {
      problems.push(`Paragraph ${n} contains a bulleted or numbered list. Rewrite it as prose.`);
    }

    if (/https?:\/\//.test(para)) {
      problems.push(`Paragraph ${n} contains a raw URL. Cite candidates as [text](#ID) only.`);
    }

    const words = para.trim().split(/\s+/).length;
    if (words < 25) problems.push(`Paragraph ${n} is too short (${words} words); aim for 40-80.`);
    if (words > 110) problems.push(`Paragraph ${n} is too long (${words} words); aim for 40-80. Split it at the topic change.`);

    // A pivot word means two topics got fused into one block. It's legitimate
    // only as the paragraph's opening word, where it bridges from the previous
    // paragraph — anywhere else, including at the start of a later sentence,
    // it marks a topic change that should have been a paragraph break.
    const pivot = para.match(/\b(Meanwhile|Separately|Elsewhere|In other news)\b/);
    if (pivot && pivot.index !== undefined && para.slice(0, pivot.index).trim() !== '') {
      problems.push(
        `Paragraph ${n} pivots to a new topic mid-paragraph at "${pivot[1]}". Start a new paragraph there instead.`,
      );
    }

    let anchorChars = 0;
    let linkCount = 0;
    for (const m of para.matchAll(CITATION_RE)) {
      anchorChars += m[1].length;
      linkCount++;
      const id = Number(m[2]);
      if (!validIds.has(id)) {
        problems.push(`Paragraph ${n} cites #${id}, which is not a candidate ID.`);
      }
      // Match the WHOLE anchor, not a prefix — "more than 300 people who had
      // been abducted" is a fine anchor and used to trip the "more" rule.
      if (/^(read more|read this|here|this|this article|link|more|click here|click|full story)$/i.test(m[1].trim().replace(/[.,]$/, ''))) {
        problems.push(`Paragraph ${n} anchors a link on "${m[1]}". Anchor on a meaningful phrase.`);
      }
    }

    if (linkCount === 0) {
      problems.push(`Paragraph ${n} has no citations. Every paragraph needs 1-3.`);
    }
    if (linkCount > 4) {
      problems.push(`Paragraph ${n} has ${linkCount} links; use at most 3.`);
    }
    // 0.35 rather than 0.25: asking for meaningful multi-word anchors and then
    // enforcing a tight density budget are contradictory demands, and the tighter
    // number forced a retry on nearly every run. This still catches a genuine
    // link dump, which scores well north of 0.5.
    if (para.length > 0 && anchorChars / para.length > 0.35) {
      problems.push(
        `Paragraph ${n} is mostly link text. Shorten the anchors to 3-6 words and let the prose carry it.`,
      );
    }
  });

  const allCited = new Set(
    brief.paragraphs.flatMap((p) => [...p.matchAll(CITATION_RE)].map((m) => Number(m[2]))),
  );
  if (allCited.size < 5) {
    problems.push(`Only ${allCited.size} distinct stories cited. Cover more of the day's news.`);
  }

  // Sports gets a quota but nothing otherwise forces the writer to spend it,
  // and it kept getting dropped for another science item.
  // Order is fixed: sports opens, good news closes.
  const sectionsOf = (p: string) =>
    [...p.matchAll(CITATION_RE)].map((m) => sectionById.get(Number(m[2])));

  if (brief.paragraphs.length > 0) {
    // The opening is deliberately unconstrained. Forcing sports to paragraph 1
    // made every edition start the same way, which is what Peter objected to.
    const last = sectionsOf(brief.paragraphs[brief.paragraphs.length - 1]);
    if (clusters.some((c) => c.section === 'good') && !last.includes('good')) {
      problems.push('The email must CLOSE with the good news. Move it to the final paragraph.');
    }
  }

  // US news must be contiguous and come before anything foreign.
  // Sports, USC, the holiday and the good news bookend the email; they are not
  // part of the news run even when they happen to cite a US story too.
  const NOT_NEWS = new Set(['sports', 'usc', 'jewish', 'good']);
  const newsSections = brief.paragraphs.map((p) => {
    const secs = sectionsOf(p).filter((s): s is NonNullable<typeof s> => Boolean(s));
    if (secs.some((s) => NOT_NEWS.has(s))) return 'other';
    if (secs.includes('us')) return 'us';
    if (secs.includes('world')) return 'foreign';
    return 'other';
  });
  // The lead paragraph is exempt: it can be whatever is most interesting that
  // day. From the second paragraph on, US news still precedes foreign news.
  const afterLead = newsSections.slice(1);
  const firstForeignIdx = afterLead.indexOf('foreign');
  const firstForeign = firstForeignIdx === -1 ? -1 : firstForeignIdx + 1;
  if (firstForeign !== -1) {
    const usAfter = newsSections.indexOf('us', firstForeign);
    if (usAfter !== -1) {
      problems.push(
        `Paragraph ${usAfter + 1} is US news but comes after foreign news in paragraph ${firstForeign + 1}. ` +
          'Every US story must come before any foreign story.',
      );
    }
  }

  // Tech is required only when a story actually made the national news: a
  // mainstream desk carried it, or two outlets did. Otherwise a quiet tech day
  // would force a firmware story into the email.
  const nationalTech = clusters.some(
    (c) => c.section === 'tech' && (c.coverage.length >= 2 || /New York Times|CNBC|BBC|Washington Post/i.test(c.source)),
  );
  if (nationalTech && ![...allCited].some((id) => sectionById.get(id) === 'tech')) {
    problems.push(
      'A major tech story was available but not cited. Include it with the US news paragraphs.',
    );
  }

  for (const [section, label, hint] of [
    // USC is a preference, not a requirement. The Daily Trojan publishes weekly,
    // so demanding it every day either forces a repeat or burns retries on a
    // brief that is otherwise fine.
    ['sports', 'sports', 'normally near the end'],
    ['good', 'good-news', 'Rose gets one every day — give it the closing paragraph'],
    ['jewish', 'Jewish holiday', 'one or two sentences on the next holiday, near the end'],
  ] as const) {
    const available = clusters.some((c) => c.section === section);
    const cited = [...allCited].some((id) => sectionById.get(id) === section);
    if (available && !cited) {
      problems.push(`No ${label} story was cited, but one was available. Include at least one — ${hint}.`);
    }
  }


  return problems;
}

/**
 * Produces one candidate draft. Injectable so the retry behaviour can be tested
 * without calling a model.
 */
export type DraftFn = (prompt: string, temperature: number) => Promise<{
  object: RawBrief;
  usage: { inputTokens?: number; outputTokens?: number };
}>;

/**
 * Walks the chain, skipping models this account can't use. Only a genuinely
 * unusable-everywhere situation throws, and then the message names the real
 * cause rather than blaming the model's output.
 */
const defaultDraft: DraftFn = async (prompt, temperature) => {
  const blocked: string[] = [];

  for (const model of MODEL_CHAIN) {
    try {
      return (await generateObject({
        model,
        schema: briefSchema,
        system: SYSTEM_PROMPT,
        prompt,
        temperature,
        // Extended thinking was 78% of the output bill — 3,400 reasoning tokens
        // to produce a 900-token email. This is a formatting-and-selection task
        // against a supplied candidate list, not a reasoning problem.
        providerOptions: { anthropic: { thinking: { type: 'disabled' } } },
        // A 9-paragraph brief is ~1,200 tokens; this is headroom, not a target.
        maxOutputTokens: 3000,
      })) as Awaited<ReturnType<DraftFn>>;
    } catch (err) {
      const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
      if (isUnretryable(message) || /not found|does not exist/i.test(message)) {
        console.warn(`[write] ${model} unavailable, trying the next model: ${message.slice(0, 90)}`);
        blocked.push(model);
        continue;
      }
      // A real generation failure — let the retry loop handle it.
      throw err;
    }
  }

  throw new BriefConfigError(
    `No usable model. Tried ${blocked.length}: ${blocked.join(', ')}. ` +
      'The Vercel AI Gateway account has no access or no remaining credit — ' +
      'add credits at https://vercel.com/dashboard → AI Gateway.',
  );
};

export type SubjectFn = (paragraphs: string[]) => Promise<string | null>;

export async function writeBrief(
  clusters: Cluster[],
  previous: PreviousBrief | null,
  draft: DraftFn = defaultDraft,
  subjectFn: SubjectFn = writeSubject,
): Promise<Brief> {
  const basePrompt = buildPrompt(clusters, previous);
  const ATTEMPTS = 3;


  let lastProblems: string[] = [];

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const prompt =
      lastProblems.length === 0
        ? basePrompt
        : `${basePrompt}\n\nYour previous draft was rejected for these reasons:\n${lastProblems
            .map((p) => `- ${p}`)
            .join('\n')}\n\nWrite a corrected version that fixes every one of them.`;

    try {
      // Nudge toward the format on later tries rather than more creativity.
      const { object, usage } = await draft(prompt, attempt === 1 ? 0.7 : 0.4);

      console.log(
        `[write] ${MODEL} attempt ${attempt}: ` +
          `${usage.inputTokens ?? '?'} in / ${usage.outputTokens ?? '?'} out`,
      );

      let subject = object.subject?.trim() ?? '';
      if (!subject) {
        subject = (await subjectFn(object.paragraphs)) ?? '';
        console.warn(
          subject
            ? '[write] model omitted the subject; wrote one from the finished body'
            : '[write] subject call failed too; falling back to top headlines',
        );
      }
      const candidate: Brief = {
        ...object,
        subject: clampSubject(subject || synthesizeSubject(clusters)),
      };

      lastProblems = validateBrief(candidate, clusters);
      if (lastProblems.length === 0) return candidate;

      console.warn(
        `[write] attempt ${attempt} failed validation:\n${lastProblems.map((p) => `  - ${p}`).join('\n')}`,
      );

      // Every retry is another full model call — the dominant cost and the
      // dominant latency. A draft whose only faults are stylistic is already a
      // good email, so ship it rather than paying to re-roll for polish.
      if (!lastProblems.some(isFatal)) {
        console.warn(
          `[write] accepting final draft despite ${lastProblems.length} cosmetic issue(s)`,
        );
        return candidate;
      }
    } catch (err) {
      // A malformed or unparseable model response is retryable, not fatal.
      // Letting it escape is what silently killed a day's brief.
      const e = err as { message?: string; finishReason?: string; text?: string; cause?: { message?: string } };
      const message = e?.message?.split('\n')[0] ?? String(err);

      // Fail fast and truthfully rather than retrying something that cannot work.
      if (isUnretryable(message)) {
        throw new BriefConfigError(
          `${MODEL} is not usable by this account: ${message} ` +
            'Add credits at https://vercel.com/dashboard → AI Gateway, or set BRIEF_MODEL to a model the account can use.',
        );
      }

      // The cause carries the actual schema mismatch; without it the log says
      // only "did not match schema", which is useless for diagnosis.
      console.warn(
        `[write] attempt ${attempt} did not produce a usable object: ${message}` +
          ` | finishReason=${e?.finishReason ?? '?'}` +
          ` | cause=${String(e?.cause?.message ?? '').slice(0, 300)}` +
          ` | textLen=${String(e?.text ?? '').length}`,
      );
      lastProblems = [
        'Your last response could not be parsed. Return valid JSON matching the schema: ' +
          'a "subject" string and a "paragraphs" array of 5 to 9 plain strings. ' +
          'No markdown fences, no nested objects, no extra keys.',
      ];
    }
  }

  throw new BriefValidationError(
    `Brief failed after ${ATTEMPTS} attempts: ${lastProblems.join(' | ')}`,
  );
}
