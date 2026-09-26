import { ConvexError, v } from "convex/values";
import { action, env, internalMutation, query } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import {
  sendTelnyxSms,
  verifyTelnyxWebhook,
  type TelnyxSendResult,
  type TelnyxWebhookEvent,
} from "./lib/telnyx.js";

const messageRow = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  owner: v.string(),
  providerMessageId: v.string(),
  to: v.string(),
  text: v.string(),
  status: v.string(),
  createdAt: v.number(),
});

const webhookEventRow = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  eventId: v.string(),
  eventType: v.string(),
  payload: v.any(),
  occurredAt: v.optional(v.string()),
  receivedAt: v.number(),
});

const webhookEvent = v.union(
  v.null(),
  v.object({
    event_type: v.string(),
    id: v.string(),
    occurred_at: v.optional(v.string()),
    payload: v.any(),
  }),
);

/**
 * Send an SMS through `POST /v2/messages` and record it in the component's
 * isolated `messages` table, keyed by the Telnyx message id so a retried send
 * never double-logs.
 *
 * Auth lives in the app: components have no `ctx.auth`, so the caller passes
 * its already-verified owner string. The API key and default sender number
 * come only from the component's declared env, never from arguments.
 */
export const sendSms = action({
  args: {
    owner: v.string(),
    from: v.optional(v.string()),
    to: v.string(),
    text: v.string(),
    webhookUrl: v.optional(v.string()),
  },
  returns: v.object({ id: v.string(), status: v.string() }),
  handler: async (ctx, args): Promise<TelnyxSendResult> => {
    const from = args.from ?? env.TELNYX_FROM_NUMBER;
    if (!from) throw new ConvexError("TELNYX_FROM_NUMBER is not configured");
    const result = await sendTelnyxSms({
      apiKey: env.TELNYX_API_KEY,
      baseUrl: env.TELNYX_API_BASE_URL,
      message: {
        from,
        to: args.to,
        text: args.text,
        ...(args.webhookUrl ? { webhook_url: args.webhookUrl } : {}),
      },
    });
    await ctx.runMutation(internal.telnyx.recordMessage, {
      owner: args.owner,
      providerMessageId: result.id,
      to: args.to,
      text: args.text,
      status: result.status,
      createdAt: Date.now(),
    });
    return result;
  },
});

/**
 * Verify an Ed25519-signed Telnyx webhook against the exact raw body and store
 * the event once by Telnyx event id. Returns `null` for an invalid signature,
 * a stale timestamp, or an unparseable body, so the host can answer 401 and
 * let Telnyx retry.
 */
export const verifyWebhook = action({
  args: {
    rawBody: v.string(),
    headers: v.record(v.string(), v.string()),
  },
  returns: webhookEvent,
  handler: async (ctx, args): Promise<TelnyxWebhookEvent | null> => {
    const event = verifyTelnyxWebhook({
      rawBody: args.rawBody,
      headers: args.headers,
      publicKey: env.TELNYX_PUBLIC_KEY,
    });
    if (!event) return null;
    await ctx.runMutation(internal.telnyx.recordWebhook, {
      eventId: event.id,
      eventType: event.event_type,
      payload: event,
      occurredAt: event.occurred_at,
      receivedAt: Date.now(),
    });
    return event;
  },
});

/** Insert a sent message. Idempotent on `providerMessageId`. Internal: not part of the host-facing API. */
export const recordMessage = internalMutation({
  args: {
    owner: v.string(),
    providerMessageId: v.string(),
    to: v.string(),
    text: v.string(),
    status: v.string(),
    createdAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_provider_message", (q) => q.eq("providerMessageId", args.providerMessageId))
      .first();
    if (existing) return null;
    await ctx.db.insert("messages", args);
    return null;
  },
});

/** Insert a verified webhook event. Idempotent on `eventId`. Internal: not part of the host-facing API. */
export const recordWebhook = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    payload: v.any(),
    occurredAt: v.optional(v.string()),
    receivedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .first();
    if (existing) return null;
    await ctx.db.insert("webhookEvents", args);
    return null;
  },
});

/** List an owner's most recent messages, newest first. */
export const listMessages = query({
  args: { owner: v.string(), limit: v.optional(v.number()) },
  returns: v.array(messageRow),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_owner", (q) => q.eq("owner", args.owner))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

/** List the most recently received verified webhook events, newest first. */
export const listWebhookEvents = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(webhookEventRow),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("webhookEvents")
      .withIndex("by_received", (q) => q.gte("receivedAt", 0))
      .order("desc")
      .take(args.limit ?? 50);
  },
});
