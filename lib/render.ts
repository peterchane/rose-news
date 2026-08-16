import { CITATION_RE, type Brief } from './write';
import type { Cluster } from './select';
import { noteForToday } from './notes';

const LINK_COLOR = '#1a56b8';
const TEXT_COLOR = '#1a1a1a';
const MUTED_COLOR = '#6b6b6b';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** URLs come only from the candidate map, but the attribute is still escaped. */
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

export type RenderedBrief = {
  subject: string;
  html: string;
  text: string;
  /** Cluster ids that survived resolution — what actually shipped. */
  citedIds: number[];
};

/**
 * Replace every [anchor](#id) with a real link from the candidate map. An id
 * with no matching cluster degrades to plain text: a missing link is a small
 * loss, a fabricated one is a betrayal of the whole premise.
 */
function resolveCitations(
  paragraph: string,
  byId: Map<number, Cluster>,
  cited: Set<number>,
  mode: 'html' | 'text',
): string {
  const parts: string[] = [];
  let cursor = 0;

  for (const match of paragraph.matchAll(CITATION_RE)) {
    const [full, anchor, rawId] = match;
    const start = match.index!;
    parts.push(mode === 'html' ? escapeHtml(paragraph.slice(cursor, start)) : paragraph.slice(cursor, start));
    cursor = start + full.length;

    const cluster = byId.get(Number(rawId));
    if (!cluster) {
      parts.push(mode === 'html' ? escapeHtml(anchor) : anchor);
      continue;
    }

    cited.add(cluster.id);
    if (mode === 'html') {
      parts.push(
        `<a href="${escapeAttr(cluster.link)}" style="color:${LINK_COLOR};text-decoration:underline;">${escapeHtml(anchor)}</a>`,
      );
    } else {
      parts.push(`${anchor} [${cluster.id}]`);
    }
  }

  const tail = paragraph.slice(cursor);
  parts.push(mode === 'html' ? escapeHtml(tail) : tail);
  return parts.join('');
}

export function renderBrief(brief: Brief, clusters: Cluster[]): RenderedBrief {
  const byId = new Map(clusters.map((c) => [c.id, c]));
  const cited = new Set<number>();
  const note = noteForToday();

  const bodyHtml = brief.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 20px;font-size:16px;line-height:1.65;color:${TEXT_COLOR};">${resolveCitations(p, byId, cited, 'html')}</p>`,
    )
    .join('\n        ');

  // Inline styles only. Gmail strips <style> blocks and mangles flex/grid, so
  // the layout is a single centered column of block elements.
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(brief.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f5f5f3;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(brief.subject)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f3;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border-radius:8px;">
            <tr>
              <td style="padding:36px 32px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
                ${bodyHtml}
                <p style="margin:32px 0 0;padding-top:20px;border-top:1px solid #e5e5e2;font-size:14px;line-height:1.6;color:${TEXT_COLOR};">
                  <strong style="color:${MUTED_COLOR};">Message from Dad:</strong> ${escapeHtml(note)}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  // Plaintext keeps the same [n] markers and lists the sources once at the end.
  const textCited = new Set<number>();
  const textBody = brief.paragraphs
    .map((p) => resolveCitations(p, byId, textCited, 'text'))
    .join('\n\n');

  const sources = [...textCited]
    .sort((a, b) => a - b)
    .map((id) => {
      const c = byId.get(id)!;
      return `[${id}] ${c.source} — ${c.link}`;
    })
    .join('\n');

  const text = `${textBody}\n\nMessage from Dad: ${note}\n\n---\nSOURCES\n${sources}\n`;

  return { subject: brief.subject, html, text, citedIds: [...cited].sort((a, b) => a - b) };
}
