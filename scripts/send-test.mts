/**
 * One-off: builds today's brief and sends it to the address given as argv[2]
 * (or ROSE_EMAIL). Use this to check rendering in a real inbox.
 *   npm run send:test -- you@example.com
 */
import { buildBrief } from '../lib/pipeline';
import { sendBrief } from '../lib/send';

const to = process.argv[2] || process.env.ROSE_EMAIL;
if (!to) throw new Error('Pass a recipient: npm run send:test -- you@example.com');
process.env.ROSE_EMAIL = to;

// Anything that reaches Rose is always blind-copied. Only drop the copy when
// the test is addressed to the copy address itself, which would just duplicate.
const copy = process.env.COPY_EMAIL?.trim().toLowerCase();
if (copy && copy === to.trim().toLowerCase()) {
  delete process.env.COPY_EMAIL;
}

const { rendered, clusters, failures } = await buildBrief();
console.log('model    :', process.env.BRIEF_MODEL || 'anthropic/claude-sonnet-5');
console.log('subject  :', rendered.subject);
console.log('cited    :', rendered.citedIds.length, 'of', clusters.length, 'candidates');
console.log('failures :', failures.length ? failures.join('; ') : 'none');

const id = await sendBrief(rendered);
const bcc = process.env.COPY_EMAIL?.trim();
console.log(`\nSENT → ${to}${bcc ? `  (bcc ${bcc})` : "  (no bcc)"}  ${id}`);
