import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  messages: defineTable({
    owner: v.string(),
    providerMessageId: v.string(),
    to: v.string(),
    text: v.string(),
    status: v.string(),
    createdAt: v.number(),
  })
    .index("by_owner", ["owner"])
    .index("by_provider_message", ["providerMessageId"]),

  webhookEvents: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    payload: v.any(),
    occurredAt: v.optional(v.string()),
    receivedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_received", ["receivedAt"]),
});
