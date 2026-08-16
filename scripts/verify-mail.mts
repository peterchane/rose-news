/**
 * Checks the Gmail App Password without sending anything.
 *     npm run mail:verify
 */
import { verifyTransport } from '../lib/send';

try {
  await verifyTransport();
  console.log(`SMTP login OK as ${process.env.GMAIL_USER}`);
  console.log('Ready. Run: npm run send:test -- you@example.com');
} catch (e) {
  console.log('\nSMTP login FAILED:', (e as Error).message);
  console.log('\n- Is 2-Step Verification on for this account?');
  console.log('- Was the App Password created at myaccount.google.com/apppasswords?');
  console.log('- Paste all 16 characters; spaces are fine, they get stripped.');
  process.exit(1);
}
