import nacl from "tweetnacl";
import { describe, expect, it, vi } from "vitest";
import { sendTelnyxSms, verifyTelnyxWebhook, TelnyxProviderError } from "./telnyx.js";

const eventBody = JSON.stringify({
  data: {
    event_type: "message.received",
    id: "evt_123",
    occurred_at: "2026-03-05T18:30:00.000Z",
    payload: {
      id: "msg_123",
      direction: "inbound",
      to: [{ phone_number: "+15550000001", status: "webhook_delivered" }],
      from: { phone_number: "+15550000002" },
      text: "Hello",
    },
  },
});

function signedEvent(now = 1_800_000_000) {
  const keyPair = nacl.sign.keyPair();
  const signature = nacl.sign.detached(
    new TextEncoder().encode(`${now}|${eventBody}`),
    keyPair.secretKey,
  );
  return {
    publicKey: Buffer.from(keyPair.publicKey).toString("base64"),
    headers: {
      "telnyx-timestamp": String(now),
      "telnyx-signature-ed25519": Buffer.from(signature).toString("base64"),
    },
  };
}

describe("Telnyx component provider", () => {
  it("sends a message through the v2 messages endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ data: { id: "msg_123", to: [{ status: "queued" }] } }), { status: 200 }),
    );
    await expect(
      sendTelnyxSms({
        apiKey: "telnyx-test",
        fetcher,
        message: { from: "+15550000001", to: "+15550000002", text: "Hello" },
      }),
    ).resolves.toEqual({ id: "msg_123", status: "queued" });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telnyx.com/v2/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer telnyx-test");
  });

  it("rejects invalid numbers and empty messages before sending", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      sendTelnyxSms({ apiKey: "telnyx-test", fetcher, message: { from: "555", to: "+15550000002", text: "Hello" } }),
    ).rejects.toBeInstanceOf(TelnyxProviderError);
    await expect(
      sendTelnyxSms({ apiKey: "telnyx-test", fetcher, message: { from: "+15550000001", to: "+15550000002", text: " " } }),
    ).rejects.toThrow("text is required");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("verifies Ed25519 webhooks and rejects tampering or stale timestamps", () => {
    const now = 1_800_000_000;
    const signed = signedEvent(now);
    expect(verifyTelnyxWebhook({ rawBody: eventBody, headers: signed.headers, publicKey: signed.publicKey, now: now * 1000 })?.event_type).toBe("message.received");
    expect(verifyTelnyxWebhook({ rawBody: `${eventBody} `, headers: signed.headers, publicKey: signed.publicKey, now: now * 1000 })).toBeNull();
    expect(verifyTelnyxWebhook({ rawBody: eventBody, headers: signed.headers, publicKey: signed.publicKey, now: (now + 301) * 1000 })).toBeNull();
  });
});
