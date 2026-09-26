import nacl from "tweetnacl";

export type TelnyxEventType = "message.received" | "message.sent" | "message.finalized";

export type TelnyxMessagePayload = {
  id: string;
  direction: "inbound" | "outbound";
  to: Array<{ phone_number: string; status?: string }>;
  from?: { phone_number: string; carrier?: string; line_type?: string };
  text?: string;
  media?: Array<{ url: string; content_type?: string; size?: number }>;
  errors?: Array<{ code: string; title?: string; detail?: string }>;
  completed_at?: string | null;
  messaging_profile_id?: string;
  received_at?: string;
};

export type TelnyxWebhookEvent = {
  event_type: TelnyxEventType;
  id: string;
  occurred_at?: string;
  payload: TelnyxMessagePayload;
};

export type TelnyxSendInput = {
  from: string;
  to: string;
  text: string;
  webhook_url?: string;
  media_urls?: string[];
};

export type TelnyxSendResult = {
  id: string;
  status: string;
};

export class TelnyxProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TelnyxProviderError";
  }
}

const E164 = /^\+[1-9]\d{6,14}$/;
const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;
const EVENT_TYPES = new Set<TelnyxEventType>(["message.received", "message.sent", "message.finalized"]);

function requireE164(value: string, field: string): string {
  if (!E164.test(value)) throw new TelnyxProviderError(`${field} must be E.164 formatted`, 0);
  return value;
}

function parseMessagePayload(value: unknown): TelnyxMessagePayload {
  if (typeof value !== "object" || value === null) throw new TelnyxProviderError("Telnyx payload is missing", 0);
  const payload = value as Partial<TelnyxMessagePayload>;
  if (typeof payload.id !== "string" || !Array.isArray(payload.to)) {
    throw new TelnyxProviderError("Telnyx payload has an unexpected shape", 0);
  }
  return payload as TelnyxMessagePayload;
}

export function parseTelnyxWebhook(rawBody: string): TelnyxWebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new TelnyxProviderError("Telnyx webhook body is not JSON", 0);
  }
  if (typeof parsed !== "object" || parsed === null) throw new TelnyxProviderError("Telnyx webhook body is invalid", 0);
  const data = (parsed as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) throw new TelnyxProviderError("Telnyx webhook data is missing", 0);
  const event = data as { event_type?: unknown; id?: unknown; occurred_at?: unknown; payload?: unknown };
  if (typeof event.event_type !== "string" || !EVENT_TYPES.has(event.event_type as TelnyxEventType)) {
    throw new TelnyxProviderError("Telnyx webhook event type is unsupported", 0);
  }
  if (typeof event.id !== "string") throw new TelnyxProviderError("Telnyx webhook event id is missing", 0);
  return {
    event_type: event.event_type as TelnyxEventType,
    id: event.id,
    occurred_at: typeof event.occurred_at === "string" ? event.occurred_at : undefined,
    payload: parseMessagePayload(event.payload),
  };
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

export async function sendTelnyxSms(input: {
  apiKey?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
  message: TelnyxSendInput;
}): Promise<TelnyxSendResult> {
  const apiKey = input.apiKey?.trim() ?? "";
  if (!apiKey) throw new TelnyxProviderError("TELNYX_API_KEY is not set", 0);
  const baseUrl = (input.baseUrl ?? "https://api.telnyx.com/v2").replace(/\/+$/, "");
  const fetcher = input.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const from = requireE164(input.message.from, "from");
  const to = requireE164(input.message.to, "to");
  if (!input.message.text.trim()) throw new TelnyxProviderError("Message text is required", 0);
  if (input.message.text.length > 1600) throw new TelnyxProviderError("Message text is too long", 0);

  const response = await fetcher(`${baseUrl}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...input.message, from, to }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new TelnyxProviderError(`Telnyx send failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`, response.status);
  }
  const body = (await response.json()) as { data?: { id?: unknown; to?: Array<{ status?: unknown }> } };
  if (typeof body.data?.id !== "string") throw new TelnyxProviderError("Telnyx send response has no message id", response.status);
  const status = body.data?.to?.[0]?.status;
  return { id: body.data.id, status: typeof status === "string" ? status : "queued" };
}

export function verifyTelnyxWebhook(input: {
  rawBody: string;
  headers: Record<string, string>;
  publicKey?: string;
  now?: number;
}): TelnyxWebhookEvent | null {
  const timestamp = Number(input.headers["telnyx-timestamp"]);
  const signature = input.headers["telnyx-signature-ed25519"];
  const publicKey = input.publicKey?.trim() ?? "";
  const now = input.now ?? Date.now();
  if (!timestamp || !signature || !publicKey) return null;
  if (Math.abs(now - timestamp * 1000) > MAX_WEBHOOK_AGE_MS) return null;
  try {
    const message = new TextEncoder().encode(`${timestamp}|${input.rawBody}`);
    const valid = nacl.sign.detached.verify(message, decodeBase64(signature), decodeBase64(publicKey));
    return valid ? parseTelnyxWebhook(input.rawBody) : null;
  } catch {
    return null;
  }
}
