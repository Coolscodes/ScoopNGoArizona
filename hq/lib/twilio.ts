// Workstream 8 — Twilio SMS client (server-only).
//
// Owns: this file. Other workstreams call the /api/sms/send endpoint, not this
// module directly — but the messaging engine (/api/automations/run) uses sendSms()
// straight here on the server.
//
// Configuration comes from three env vars:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER   (the E.164 number texts are sent from)
//
// If any are missing, sendSms() throws a clear TwilioNotConfiguredError so callers
// can degrade gracefully (the /api/sms/send route catches it and logs a 'skipped'
// notification instead of crashing). Use isTwilioConfigured() to check first.

import twilio, { type Twilio } from 'twilio';

export class TwilioNotConfiguredError extends Error {
  constructor(message = 'Twilio is not configured (missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER).') {
    super(message);
    this.name = 'TwilioNotConfiguredError';
  }
}

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

function readConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !fromNumber) return null;
  // Twilio account SIDs start with "AC"; guard against obvious placeholders.
  if (!accountSid.startsWith('AC')) return null;
  return { accountSid, authToken, fromNumber };
}

export function isTwilioConfigured(): boolean {
  return readConfig() !== null;
}

let _client: Twilio | null = null;
let _clientSid: string | null = null;

function getClient(config: TwilioConfig): Twilio {
  // Reuse the client across calls, but rebuild if the SID changed (e.g. tests).
  if (_client && _clientSid === config.accountSid) return _client;
  _client = twilio(config.accountSid, config.authToken);
  _clientSid = config.accountSid;
  return _client;
}

export interface SendSmsResult {
  sid: string;
  status: string;
}

/**
 * Send an SMS via Twilio. Throws TwilioNotConfiguredError if the env vars are
 * missing/placeholder, or a generic Error on a Twilio API failure.
 */
export async function sendSms(to: string, body: string): Promise<SendSmsResult> {
  const config = readConfig();
  if (!config) throw new TwilioNotConfiguredError();

  if (typeof window !== 'undefined') {
    throw new Error('sendSms() is server-only and must not run in the browser.');
  }

  const client = getClient(config);
  const message = await client.messages.create({
    to,
    from: config.fromNumber,
    body,
  });

  return { sid: message.sid, status: message.status };
}
