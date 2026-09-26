import type { GenericActionCtx, GenericQueryCtx } from "convex/server";
import type { ComponentApi } from "./_generated/component.js";

export type TelnyxMessageRow = {
  _id: string;
  _creationTime: number;
  owner: string;
  providerMessageId: string;
  to: string;
  text: string;
  status: string;
  createdAt: number;
};

export type TelnyxWebhookEventRow = {
  _id: string;
  _creationTime: number;
  eventId: string;
  eventType: string;
  payload: unknown;
  occurredAt?: string;
  receivedAt: number;
};

export type TelnyxWebhookEvent = {
  id: string;
  event_type: string;
  occurred_at?: string;
  payload: unknown;
};

export type TelnyxSendResult = { id: string; status: string };

/**
 * The component API as seen by a host application.
 *
 * Aliased to the generated `ComponentApi` so the client can never drift from
 * the component's real function signatures.
 */
export type TelnyxComponentApi = ComponentApi<"telnyx">;

export interface TelnyxSendArgs {
  /**
   * Owner identifier from your host application (e.g. Clerk `identity.subject`).
   * Used to scope the component's internal `messages` table to a tenant.
   */
  owner: string;
  /**
   * Sender number in E.164 format. Defaults to the component's `TELNYX_FROM_NUMBER`.
   */
  from?: string;
  /** Recipient number in E.164 format. */
  to: string;
  /** Message body. Must be non-empty after trimming. */
  text: string;
  /** Optional per-message status callback URL. */
  webhookUrl?: string;
}

export interface TelnyxVerifyWebhookArgs {
  /** Raw, unparsed request body exactly as received from Telnyx. */
  rawBody: string;
  /** Lower-cased request headers, including `telnyx-signature-ed25519` and `telnyx-timestamp`. */
  headers: Record<string, string>;
}

export class Telnyx {
  constructor(public readonly component: TelnyxComponentApi) {}

  /**
   * Send an SMS through `POST /v2/messages`, then record it in the component's
   * isolated `messages` table keyed by the Telnyx message id.
   */
  sendSms(ctx: { runAction: GenericActionCtx<any>["runAction"] }, args: TelnyxSendArgs) {
    return ctx.runAction(this.component.telnyx.sendSms, args) as Promise<TelnyxSendResult>;
  }

  /**
   * Verify an Ed25519-signed Telnyx webhook against the raw body and record the
   * event once. Returns `null` when the signature is invalid or replayed.
   */
  verifyWebhook(ctx: { runAction: GenericActionCtx<any>["runAction"] }, args: TelnyxVerifyWebhookArgs) {
    return ctx.runAction(this.component.telnyx.verifyWebhook, args) as Promise<TelnyxWebhookEvent | null>;
  }

  /** List the most recent messages recorded for an owner. */
  listMessages(
    ctx: { runQuery: GenericQueryCtx<any>["runQuery"] },
    args: { owner: string; limit?: number },
  ) {
    return ctx.runQuery(this.component.telnyx.listMessages, args) as Promise<TelnyxMessageRow[]>;
  }

  /** List the most recently received webhook events. */
  listWebhookEvents(ctx: { runQuery: GenericQueryCtx<any>["runQuery"] }, args: { limit?: number } = {}) {
    return ctx.runQuery(this.component.telnyx.listWebhookEvents, args) as Promise<TelnyxWebhookEventRow[]>;
  }
}
