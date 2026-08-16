import { buildBrief } from '@/lib/pipeline';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Runs the full pipeline and returns the rendered email. Sends nothing and
 * archives nothing — this is where the prompt gets tuned.
 *
 * `?debug=1` appends the candidate list and resolved links for spot-checking
 * that every anchor points at real reporting.
 */
export async function GET(req: Request) {
  const debug = new URL(req.url).searchParams.get('debug') === '1';

  try {
    const { rendered, clusters, failures } = await buildBrief();

    let html = rendered.html;

    if (debug) {
      const byId = new Map(clusters.map((c) => [c.id, c]));
      const cited = rendered.citedIds
        .map((id) => {
          const c = byId.get(id)!;
          return `<li><strong>#${id}</strong> ${c.source} — <a href="${c.link}">${c.title}</a></li>`;
        })
        .join('');

      const uncited = clusters
        .filter((c) => !rendered.citedIds.includes(c.id))
        .map((c) => `<li>#${c.id} [${c.section}] ${c.title}</li>`)
        .join('');

      html += `
        <div style="max-width:600px;margin:0 auto 40px;padding:24px;background:#fff;border-radius:8px;font-family:-apple-system,sans-serif;font-size:13px;line-height:1.6;">
          <h3>Subject</h3><p>${rendered.subject}</p>
          <h3>Cited (${rendered.citedIds.length}) — click every one</h3><ul>${cited}</ul>
          <h3>Not used (${clusters.length - rendered.citedIds.length})</h3><ul>${uncited}</ul>
          <h3>Feed failures</h3><p>${failures.join('<br>') || 'none'}</p>
          <h3>Plaintext</h3><pre style="white-space:pre-wrap;background:#f5f5f3;padding:12px;">${rendered.text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')}</pre>
        </div>`;
    }

    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    return new Response(`<pre style="padding:24px;white-space:pre-wrap;">${detail}</pre>`, {
      status: 500,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
}
