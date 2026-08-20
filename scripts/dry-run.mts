/**
 * Runs the whole pipeline and prints the result. Sends nothing.
 *
 * Exists because the failures that reached Rose as silence were all found the
 * same way: run it for real, see what validation says. Tests cover the rules;
 * this covers the day's actual candidates.
 */
import { buildBrief } from '../lib/pipeline';

const { rendered, clusters, failures } = await buildBrief();

console.log(`\n${clusters.length} candidates, ${failures.length} feed failures`);
console.log(`subject: ${rendered.subject}`);
const paragraphs = rendered.text.split('\n\n').filter((p) => p.trim());
console.log(`${paragraphs.length} paragraphs\n`);
console.log(rendered.text);
