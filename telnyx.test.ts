/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import nacl from "tweetnacl";
import schema from "./schema.js";
import { register, modules } from "./test.js";
import { api, internal } from "./_generated/api.js";
import type { ComponentApi } from "./_generated/component.js";

/** The component's own public API reference, shaped as a host would see it. */
const componentApi = { telnyx: api.telnyx } as unknown as ComponentApi<"telnyx">;

const webhookBody = JSON.stringify({
  data: {
    event_type: "message.received",
    id: "evt_1",
    occurred_at: "2026-03-05T18:30:00.000Z",
    payload: {
      id: "msg_in_1",
      direction: "inbound",
      to: [{ phone_number: "+15550000001", status: "webhook_delivered" }],
      from: { phone_number: "+15550000002" },
      text: "Hello",
    },
  },
});

describe("telnyx component", () => {
  test("records a message once and lists it per owner", async () => {
    const t = convexTest(schema, modules);
    register(t, "telnyx");

    const message = {
      owner: "user_1",
      providerMessageId: "msg_1",
      to: "+15550000002",
      text: "Hello",
      status: "queued",
      createdAt: Date.now(),
    };
    await t.mutation(internal.telnyx.recordMessage, message);
    await t.mutation(internal.telnyx.recordMessage, message);

    const messages = await t.query(api.telnyx.listMessages, { owner: "user_1" });
    expect(messages).toHaveLength(1);
    expect(messages[0].providerMessageId).toBe("msg_1");

    expect(await t.query(api.telnyx.listMessages, { owner: "user_2" })).toHaveLength(0);
  });

  test("deduplicates webhook events by event id", async () => {
    const t = convexTest(schema, modules);
    register(t, "telnyx");

    const event = {
      eventId: "evt_1",
      eventType: "message.received",
      payload: { id: "msg_in_1" },
      occurredAt: "2026-03-05T18:30:00.000Z",
      receivedAt: Date.now(),
    };
    await t.mutation(internal.telnyx.recordWebhook, event);
    await t.mutation(internal.telnyx.recordWebhook, event);

    const events = await t.query(api.telnyx.listWebhookEvents, {});
    expect(events).toHaveLength(1);
    expect(events[0].eventId).toBe("evt_1");
  });

  test("verifyWebhook fails closed when no public key is configured", async () => {
    const t = convexTest(schema, modules);
    register(t, "telnyx");

    const timestamp = Math.floor(Date.now() / 1000);
    const headers = {
      "telnyx-timestamp": String(timestamp),
      "telnyx-signature-ed25519": Buffer.from(new Uint8Array(64)).toString("base64"),
    };

    const verified = await t.action(api.telnyx.verifyWebhook, { rawBody: webhookBody, headers });
    expect(verified).toBeNull();

    const events = await t.query(api.telnyx.listWebhookEvents, {});
    expect(events).toHaveLength(0);
  });

  test("client forwards verifyWebhook through the component action", async () => {
    const t = convexTest(schema, modules);
    register(t, "telnyx");

    const { Telnyx } = await import("./client.js");
    const client = new Telnyx(componentApi);
    const actionCtx = {
      runAction: (reference: any, args: any) => t.action(reference, args),
    } as any;

    const keyPair = nacl.sign.keyPair();
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = Buffer.from(
      nacl.sign.detached(new TextEncoder().encode(`${timestamp}|${webhookBody}`), keyPair.secretKey),
    ).toString("base64");

    const result = await client.verifyWebhook(actionCtx, {
      rawBody: webhookBody,
      headers: { "telnyx-timestamp": String(timestamp), "telnyx-signature-ed25519": signature },
    });

    // No TELNYX_PUBLIC_KEY in the test environment, so verification must reject.
    expect(result).toBeNull();
  });
});
