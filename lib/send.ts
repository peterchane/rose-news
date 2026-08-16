import nodemailer from 'nodemailer';
import { optional, required } from './env';
import type { RenderedBrief } from './render';

/**
 * Gmail SMTP. Sends from a real personal address with no domain to buy or
 * verify — which is what a transactional provider's shared sender can't do,
 * since those only deliver to the provider account's own owner.
 */
function transport() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: required('GMAIL_USER'),
      // App Password, not the account password. Google displays it with spaces
      // but SMTP won't accept them.
      pass: required('GMAIL_APP_PASSWORD').replace(/\s+/g, ''),
    },
  });
}

function fromAddress(): string {
  return `"${optional('FROM_NAME', "Dad's Daily Brief")}" <${required('GMAIL_USER')}>`;
}

/**
 * Replies and failure alerts default to the sending account rather than a
 * hard-coded address, so no personal email lives in the source.
 */
function replyTo(): string {
  return optional('REPLY_TO_EMAIL', required('GMAIL_USER'));
}

function alertTo(): string {
  return optional('ALERT_EMAIL', required('GMAIL_USER'));
}

type Message = {
  to: string;
  bcc?: string;
  subject: string;
  html?: string;
  text: string;
};

async function deliver(msg: Message): Promise<string> {
  const info = await transport().sendMail({
    from: fromAddress(),
    replyTo: replyTo(),
    ...msg,
  });
  return info.messageId;
}

export async function sendBrief(brief: RenderedBrief): Promise<string> {
  // Blind-copied rather than a second `to`, so Rose's copy still reads as an
  // email written to her.
  const copy = process.env.COPY_EMAIL?.trim();

  return deliver({
    to: required('ROSE_EMAIL'),
    ...(copy ? { bcc: copy } : {}),
    subject: brief.subject,
    html: brief.html,
    text: brief.text,
  });
}

/**
 * Failures go to the parent, never to Rose. A missing email is recoverable; a
 * broken one erodes the habit the whole project depends on.
 */
export async function sendFailureAlert(reason: string, detail: string): Promise<void> {
  try {
    await deliver({
      to: alertTo(),
      subject: `[rose-news] Brief did not send: ${reason}`,
      text: `Today's brief was not sent.\n\nReason: ${reason}\n\n${detail}\n`,
    });
  } catch (err) {
    // Nothing left to escalate to; the run logs are the last resort.
    console.error('[send] failure alert could not be delivered:', err);
  }
}

/** Confirms the SMTP credentials without sending anything. */
export async function verifyTransport(): Promise<void> {
  await transport().verify();
}
