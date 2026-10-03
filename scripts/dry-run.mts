/**
 * Runs the whole pipeline and prints the result. Sends nothing.
 *
 * Exists because the failures that reached Rose as silence were all found the
 * same way: run it for real, see what validation says. Tests cover the rules;
 * this covers the day's actual candidates.
 */
// Test runs write with a cheap model unless told otherwise. On Oct 3 a day of
// dry runs on Opus burned through the $10 AI Gateway cap and Rose's next email
// failed. Her real email still uses Opus; this only changes test runs.
// Override with BRIEF_MODEL=... to test a specific model on purpose.
if (!process.env.BRIEF_MODEL) process.env.BRIEF_MODEL = 'google/gemini-3-flash';

const { buildBrief } = await import('../lib/pipeline');

const { rendered, clusters, failures } = await buildBrief();

console.log(`\n${clusters.length} candidates, ${failures.length} feed failures`);
console.log(`subject: ${rendered.subject}`);
const paragraphs = rendered.text.split('\n\n').filter((p) => p.trim());
console.log(`${paragraphs.length} paragraphs\n`);
console.log(rendered.text);
