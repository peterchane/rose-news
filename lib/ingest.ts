import { XMLParser } from 'fast-xml-parser';
import { type Feed, type Section } from './feeds';

export type Article = {
  title: string;
  link: string;
  source: string;
  section: Section;
  weight: number;
  publishedAt: Date;
  blurb: string;
};

const FETCH_TIMEOUT_MS = 12_000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Feeds are wildly inconsistent about CDATA and entity escaping; let the
  // parser normalize rather than hand-rolling entity handling.
  processEntities: true,
  trimValues: true,
});

/** RSS items are `item`; Atom entries are `entry`. Both shapes appear in our feed set. */
function extractRawItems(parsed: unknown): Record<string, unknown>[] {
  const root = parsed as Record<string, any>;
  const candidates =
    root?.rss?.channel?.item ?? root?.channel?.item ?? root?.feed?.entry ?? [];
  const list = Array.isArray(candidates) ? candidates : [candidates];
  return list.filter((i): i is Record<string, unknown> => Boolean(i));
}

/** Values may be a string, a CDATA-wrapped object, or an array. Reduce to a string. */
function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return text(obj['#text'] ?? obj['_'] ?? '');
  }
  return '';
}

/** Atom puts the URL in `link.@_href`; RSS puts it in the element body. */
function extractLink(item: Record<string, any>): string {
  const raw = item.link;
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    const alternate = raw.find(
      (l) => typeof l === 'object' && (!l['@_rel'] || l['@_rel'] === 'alternate'),
    );
    return String(alternate?.['@_href'] ?? extractLink({ link: raw[0] })).trim();
  }
  if (raw && typeof raw === 'object') return String(raw['@_href'] ?? text(raw)).trim();
  return text(item.guid).trim();
}

/**
 * Feeds carry a lot that isn't reportable news: opinion columns, rolling live
 * blogs whose headlines are kitchen-sink strings, video/audio stubs, crosswords,
 * and digest "briefing" pages that just relink other stories. All of it pollutes
 * clustering and none of it belongs in the brief.
 */
const JUNK_PATH = /\/(opinion|live|videos?|podcasts?|crossword|briefing|interactive|gallery|in-pictures|audio|newsletter)[/-]/i;
const JUNK_TITLE =
  /^(opinion|analysis|editorial|review|watch|listen)\s*[|:]|(\blive\b.*\b(updates?|blog)\b)|\blive:\s|^classifieds\b/i;

/**
 * Sports feeds carry a large volume of evergreen analysis — rankings, fantasy
 * advice, draft guides — that has no event behind it and reads as stale news.
 */
/**
 * Recurring columns rather than events. The good-news outlets in particular run
 * daily history digests and reading roundups — "Good News in History, August 8"
 * is where the "on this day in 1576" filler came from.
 */
const COLUMN_TITLE =
  /^(good news in history|what we're reading|what we’re reading|the spark|life lessons|quote of the day|photo of the day|weekly roundup|this week in|your weekly|what went right)\b|\bin history,|\bnewsletter\b|\bhoroscope\b|\bastrology\b/i;

const EVERGREEN_TITLE =
  /\b(power rankings|fantasy (football|baseball|basketball|hockey)|do not draft|draft guide|mock draft|start[' ]?em|sit[' ]?em|way-too-early|best bets|odds, picks|predictions? for|everything to know|what to know about|how to watch|takeaways from|winners and losers|grades?:|ranking every|every team'?s?|fates? of all|all \d+ (mlb|nfl|nba|nhl|college) teams|since the trade deadline|season preview|what we learned|reshapes|what it means for|impact of the|revisiting|looking back at|why the \w+ (are|have|is)|the case for|the case against|villain|narrative|storyline|proves? that|shows? why|here'?s why|columnist|on this day in|this day in history|years ago today|from the archive|throwback)\b/i;

/**
 * Individual violent crime — school shootings, family murders, stabbings,
 * abductions, sexual violence. Rose is a teenager reading this over breakfast
 * and asked not to get this; it also isn't news she can do anything with.
 *
 * Deliberately does NOT match war and conflict reporting ("airstrike",
 * "shelling", "troops killed"), which stays in. The distinction is a named
 * individual committing a crime versus a state or army at war.
 */
const VIOLENT_CRIME = new RegExp(
  [
    // A person as the killer, never a weapon or army — so "Airstrike kills
    // dozens" and "Barrage kills 17" are correctly left alone.
    /\b(boy|girl|man|woman|teen|teenager|student|pupil|father|mother|son|daughter|husband|wife|suspect|attacker|driver)\s+(kills?|killed|shoots?|shot|stabb\w*|murder\w*)\b/,
    /\b(shooter|gunman|mass shooting|school shooting|serial killer|manhunt)\b/,
    /\bopen(s|ed)? fire\b/,
    /\bstabb(ed|ing)\b/,
    /\bmurder(s|ed|ing)?\b/,
    /\babduct(ed|ion)\b/,
    /\bkidnapp?(ed|ing)\b/,
    /\bsexual(ly)? (assault|abuse)\b/,
    /\brap(ed|ist)\b/,
    /\b(beheaded|dismembered)\b/,
    // Prosecutions and convictions are crime coverage too. A story about
    // charges being filed, reduced or upheld is still a story about a crime,
    // which is the whole category Rose asked to be kept out.
    /\b(charges?|indict\w*|prosecutor\w*|prosecut(e|ed|ion)|convict(ed|ion)|sentenc(ed|ing)|plead(s|ed)? guilty|arraign\w*|felony|manslaughter)\b/,
  ]
    .map((r) => r.source)
    .join('|'),
  'i',
);

export function isViolentCrime(title: string): boolean {
  return VIOLENT_CRIME.test(title);
}

/**
 * School shootings, absolutely and always. Peter's instruction was "never".
 * Rose is a high school student; this is the one subject where a near-miss is
 * unacceptable, so it's matched broadly and checked against the summary too,
 * not just the headline.
 */
const SCHOOL_VIOLENCE = new RegExp(
  [
    /\b(school|campus|classroom|university|college|dorm|residence hall|sorority|fraternity|elementary|high school|middle school|kindergarten|preschool|daycare)\b.{0,80}\b(shoot\w*|shot|gunman|gunfire|shooter|massacre|attack|killed|stabb\w*|lockdown|active threat)\b/,
    /\b(shoot\w*|shot|gunman|gunfire|shooter|massacre|lockdown|active threat)\b.{0,80}\b(school|campus|classroom|university|college|dorm|residence hall|sorority|fraternity|elementary|high school|middle school|kindergarten|preschool|daycare|students?|teachers?|pupils?)\b/,
    /\b(active shooter|school shooting|campus shooting|mass casualty)\b/,
    // The recurring named tragedies, which resurface in policy coverage.
    /\b(columbine|sandy hook|parkland|uvalde|virginia tech|marjory stoneman)\b/,
    /\b(school safety|lockdown|active shooter)\s+drills?\b/,
    /\blockdown\b/,
  ]
    .map((r) => r.source)
    .join('|'),
  'i',
);

/** Never exempted — not for good news, not for anything. */
export function isSchoolViolence(text: string): boolean {
  return SCHOOL_VIOLENCE.test(text);
}

/**
 * Grim without being criminal, so the violent-crime filter misses all of it.
 * Three things reached Rose this way and shouldn't have: 50 decomposing bodies
 * in a funeral home, an athlete's overdose autopsy result, and the anniversary
 * of a shooting. None is news she can use; all of them land badly at breakfast.
 */
const MACABRE = new RegExp(
  [
    // Bodies and remains.
    /\bdecompos(e|ed|ing|ition)\b/,
    /\b(bodies|body|corpses?|cadavers?|human remains|skeletal remains)\s+(found|discovered|recovered|piled|stored|unearthed)\b/,
    /\b(find|finds|found|discover(s|ed)?|recover(s|ed)?|unearth(s|ed)?)\s+(\w+\s+){0,3}(bodies|corpses?|human remains|skeletal remains)\b/,
    /\b(mass grave|exhum(e|ed|ation)|autops(y|ies)|morgue|mortuary|embalm)\b/,
    /\b(remains|body) of a (missing|dead)\b/,

    // Cause-of-death reporting on an individual.
    /\b(overdos(e|ed|ing)|died (from|of) (the effects of )?(heroin|cocaine|fentanyl|drugs?|alcohol))\b/,
    /\b(cause of death|medical examiner|coroner|toxicology)\b/,
    /\b(died by |death (ruled|declared)|ruled (a )?(suicide|homicide|accidental))\b/,
    /\bsuicide\b/,

    // Anniversaries and memorials of violence — no new development, all grief.
    // ("On this day in 1576" filler is handled by EVERGREEN_TITLE.)
    /\banniversary of (the |a )?(shooting|attack|massacre|bombing|crash|disaster|death)/,
    /\b(marks?|marking) (one|two|three|four|five|ten|\d+) years? since the (shooting|attack|massacre|bombing|crash|disaster|killing)/,
    /\b(memorial|vigil|remembers?|remembering) (for |the )?(victims|those killed|the dead)\b/,
  ]
    .map((r) => r.source)
    .join('|'),
  'i',
);

/**
 * Feel-good filler: one animal freed, one stranger's kind gesture, a
 * heartwarming local vignette. Rose called the rescued-manatee story stupid and
 * she was right — nothing changed, nothing was learned, it just happened to be
 * nice. Species-level conservation and real discoveries are NOT this.
 */
const SENTIMENTAL = new RegExp(
  [
    // A single animal in trouble and then not in trouble.
    /\b(rescu\w*|freed?|saved|untangl\w*|trapped|stranded|stuck)\b.{0,40}\b(dog|cat|puppy|kitten|manatee|whale|dolphin|deer|bear cub|duckling|horse|owl|turtle|seal|otter|calf|foal)\b/,
    /\b(dog|cat|puppy|kitten|manatee|whale|dolphin|deer|duckling|turtle|seal|otter)\b.{0,40}\b(rescu\w*|freed?|saved|reunited|returns? home)\b/,
    // Human-interest warmth.
    /\b(heartwarming|heartening|feel-?good|tear-?jerk|wholesome|adorable|precious|sweetest)\b/,
    /\b(good samaritan|random act of kindness|pays? it forward|restores? (your |our )?faith in humanity)\b/,
    /\b(surprise (reunion|proposal|homecoming)|emotional reunion|reunited after \d+ years)\b/,
    /\bcalled 9-?1-?1\b/,
  ]
    .map((r) => r.source)
    .join('|'),
  'i',
);

export function isSentimentalFiller(title: string): boolean {
  return SENTIMENTAL.test(title);
}

export function isMacabre(title: string): boolean {
  return MACABRE.test(title);
}

/**
 * Everything else Rose shouldn't get: crime and courts, personal scandal and
 * divorce, individual tragedy, and disasters reported by body count. Peter's
 * instruction was "no shootings, murder, crime, divorce, or any bad stuff".
 *
 * This does NOT remove hard news that happens to be unwelcome — a war, an
 * election, a bad jobs report, a policy fight all still come through. It
 * removes the stories that are only misfortune, where nothing is decided and
 * there's nothing to understand.
 */
const DISTRESSING = new RegExp(
  [
    // Crime and courts.
    /\b(arrest(s|ed)?|charged with|indict(ed|ment)|convict(ed|ion)|sentenc(ed|ing) to|pleads? guilty|on trial|mugshot)\b/,
    /\b(robbery|burglar(y|ies)|carjack|shoplift|arson|assault(ed)?|battery charge)\b/,
    /\b(fraud|embezzl|extort|racketeer|money laundering|trafficking|smuggl)\w*/,
    /\b(gunfire|shot dead|shooting|gunshot|stabbing|hostage|kidnap)\w*/,
    /\b(prison sentence|jailed|behind bars|death row|executed by)\b/,

    // Personal life and scandal.
    /\b(divorce|divorcing|split(s|ting)? from|breakup|cheating scandal|affair with|custody battle|restraining order|paternity)\b/,
    /\b(sex tape|nude photos)\b/,
    // Allegations of any kind of misconduct — the Max Miller "abuse
    // allegations" story reached Rose because only *sexual* abuse was matched.
    /\b(abuse|harassment|misconduct|assault|grooming|coerc\w*)\b/,
    /\b(allegations?|accus(ed|ations?)|alleged victim|whistleblower claim)\b/,
    /\b(scandal|disgraced|resigns? amid|steps? down amid|ousted amid)\b/,

    // Individual tragedy and disaster casualty counts.
    /\b(dies? (at|aged) \d+|found dead|declared dead|pronounced dead)\b/,
    /\b(fatal|deadly) (crash|fire|collision|accident|blaze|derailment)\b/,
    /\b\d+\s+(dead|killed|injured|missing|hurt)\b/,
    /\b(death toll|casualties|bodies of)\b/,
    // Death in any framing. Peter: "nothing about death".
    /\b(deaths?|dying|died|dead|dies|killed|kills|fatalit(y|ies)|mourn(s|ed|ing)?|funeral|obituar(y|ies)|posthumous)\b/,
    /\b(terminal(ly)? ill|life support|hospice|euthanasia|assisted dying)\b/,

    // Disease and grim medical news. Peter: "nothing about disease or bad
    // medical". Positive medical news — an approval, a cure, a breakthrough —
    // is handled by the exception below.
    /\b(cancer|tumou?r|leukemia|alzheimer|dementia|parkinson|als\b|diabetes|obesity|stroke|heart attack|cardiac)\b/,
    /\b(outbreak|epidemic|pandemic|infection|infectious|virus|viral (spread|outbreak)|covid|influenza|measles|ebola|cholera|malaria|tuberculosis|hiv|aids\b|superbug|antibiotic resistance)\b/,
    /\b(disease|illness|syndrome|disorder|diagnosis|diagnosed|symptoms|contagious|quarantine|hospitali[sz]\w*|intensive care|icu\b)\b/,
    /\b(recall(ed|s)? (over|after|due to)|contaminat|food poisoning|tainted|overdose deaths)\b/,
    /\b(mental health crisis|self-harm|eating disorder|addiction|addicted)\b/,

    // Drugs. Peter: "nothing about drugs and disease".
    /\b(drugs?|narcotics?|opioids?|heroin|cocaine|fentanyl|meth(amphetamine)?|opium|ecstasy|ketamine|vaping|vape)\b/,
    /\b(cartel|drug bust|drug ring|dealer|possession charge|drug test)\b/,
    /\b(plane|helicopter|bus|train|ferry) (crash|crashes|crashed|capsiz)\w*/,

    // A lawsuit being FILED decides nothing — it's a press release with a
    // docket number. A court RULING is news and is deliberately not matched
    // here ("rules", "blocks", "upholds", "strikes down" all survive).
    /\b(files? suit|filed suit|filing suit|sues?|suing|lawsuit (challeng|accus|alleg|seek)\w*|legal challenge|petition(s|ed)? the court|class action)\b/,
    /\b(advocacy group|rights group|watchdog|civil liberties group|coalition of)\w*\b.{0,30}\b(sue|suit|challenge|urge|demand|call on)\w*/,

    // Inside-Washington personnel process. A clearance revoked or an official
    // reassigned is procedure, not news Rose can use.
    /\b(security clearance|revokes? clearance|reassign(ed|ment)|placed on leave|acting director named|nominee withdraws?|resignation letter)\b/,

    // European migration. Peter asked for this out specifically, Ceuta included.
    /\b(migrant|migration|asylum|refugee|deportation|border controls?|schengen|frontex|ceuta|melilla|lampedusa|small boats?|channel crossing)\w*/,

    // Wildfires and the natural disasters that read the same way.
    /\b(wildfire|wild fire|brush ?fire|forest fire|grass ?fire|firestorm|blaze)\w*/,
    // Not a bare `evacuat` — that also matches conflict reporting like
    // "Israel strikes Lebanon after evacuation warning".
    /\b(evacuation order|containment|acres? burned|burn scar|fire season|fire crews)\b/,
    /\b(hurricane|tornado|typhoon|cyclone|earthquake|tsunami|landslide|mudslide|flooding|floods?|volcano|erupt(s|ed|ion))\b/,
  ]
    .map((r) => r.source)
    .join('|'),
  'i',
);

/**
 * Medical progress reads as disease news to the filter above but is exactly the
 * kind of story worth keeping — an approval, a cure, a treatment that worked.
 */
const MEDICAL_GOOD_NEWS =
  /\b(approv(e|ed|al)|cure[ds]?|breakthrough|treatment works|first successful|vaccine (approved|works|rollout)|survival rates? (rise|improve)|remission|recover(ed|y)|declin(e|es|ing) (in|to)|eradicat)\w*/i;

/** A drug being approved or trialled is medicine, not drug-crime news. */
const DRUG_AS_MEDICINE = /\b(drug|therapy|treatment)\s+(approv|trial|works|shows|study|candidate)\w*/i;

export function isDistressing(title: string): boolean {
  if (MEDICAL_GOOD_NEWS.test(title) || DRUG_AS_MEDICINE.test(title)) return false;
  return DISTRESSING.test(title);
}

export function isReportableNews(
  title: string,
  link: string,
  section?: string,
  blurb = '',
): boolean {
  // Checked against headline AND summary, and never exempted by section.
  if (isSchoolViolence(`${title} ${blurb}`)) return false;

  let path = '';
  try {
    path = new URL(link).pathname;
  } catch {
    return false;
  }
  // Trailing slash so a terminal segment like `/opinion` still matches.
  if (JUNK_PATH.test(`${path}/`)) return false;
  if (JUNK_TITLE.test(title)) return false;
  if (EVERGREEN_TITLE.test(title)) return false;
  if (COLUMN_TITLE.test(title)) return false;
  // Applies everywhere, including good news — especially good news.
  if (isSentimentalFiller(title)) return false;
  // Good-news outlets report rescues and recoveries, which legitimately use the
  // same words as crime reporting ("kidnapped girl reunited with family").
  if (section !== 'good' && (isViolentCrime(title) || isMacabre(title) || isDistressing(title))) {
    return false;
  }
  return true;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(item: Record<string, any>): Date | null {
  const raw =
    text(item.pubDate) ||
    text(item.published) ||
    text(item.updated) ||
    text(item['dc:date']);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Query strings on news links are almost entirely tracking parameters, and they
 * make otherwise-identical URLs look distinct during dedupe.
 */
export function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return u.toString();
  } catch {
    return url;
  }
}

async function fetchFeed(feed: Feed): Promise<Article[]> {
  const res = await fetch(feed.url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      // Several outlets return 403 to an unrecognized agent.
      'user-agent': 'Mozilla/5.0 (compatible; RoseNewsBrief/1.0)',
      accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`${feed.source} (${feed.section}) → HTTP ${res.status}`);

  return parseFeedItems(await res.text(), feed);
}

/**
 * Everything ingest does to a feed body except fetch it: parse, filter junk,
 * drop stale items, normalize. Split out so it can be tested against fixtures
 * without touching the network.
 */
export function parseFeedItems(xml: string, feed: Feed, now: number = Date.now()): Article[] {
  const items = extractRawItems(parser.parse(xml));
  const cutoff = now - feed.maxAgeHours * 60 * 60 * 1000;

  const articles: Article[] = [];
  for (const item of items) {
    const title = stripHtml(text((item as any).title));
    const link = cleanUrl(extractLink(item as any));
    const publishedAt = parseDate(item as any);

    if (!title || !link.startsWith('http')) continue;
    const blurbForFilter = stripHtml(
      text((item as any).description) ||
        text((item as any).summary) ||
        text((item as any)['content:encoded']),
    ).slice(0, 400);
    if (!isReportableNews(title, link, feed.section, blurbForFilter)) continue;
    // A feed with no dates at all would otherwise contribute nothing; but a
    // missing date on an individual item is more likely stale than fresh.
    if (!publishedAt || publishedAt.getTime() < cutoff) continue;

    const blurb = stripHtml(
      text((item as any).description) ||
        text((item as any).summary) ||
        text((item as any)['content:encoded']),
    ).slice(0, 400);

    articles.push({
      title,
      link,
      source: feed.source,
      section: feed.section,
      weight: feed.weight,
      publishedAt,
      blurb,
    });
  }
  return articles;
}

export type IngestResult = {
  articles: Article[];
  failures: string[];
};

/**
 * Fetch every feed concurrently. A dead or slow feed degrades coverage but must
 * never fail the run — the brief still goes out on whatever we did get.
 */
export async function ingest(feeds: Feed[]): Promise<IngestResult> {
  const settled = await Promise.allSettled(feeds.map(fetchFeed));

  const articles: Article[] = [];
  const failures: string[] = [];

  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      articles.push(...result.value);
    } else {
      const feed = feeds[i];
      failures.push(`${feed.source} (${feed.section}): ${result.reason?.message ?? result.reason}`);
    }
  });

  // Same article syndicated to two feeds (e.g. BBC world + BBC tech).
  const byUrl = new Map<string, Article>();
  for (const a of articles) {
    const existing = byUrl.get(a.link);
    if (!existing || a.publishedAt > existing.publishedAt) byUrl.set(a.link, a);
  }

  return {
    articles: [...byUrl.values()].sort(
      (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
    ),
    failures,
  };
}
