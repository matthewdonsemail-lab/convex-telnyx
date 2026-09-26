/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    telnyx: {
      listMessages: FunctionReference<
        "query",
        "internal",
        { limit?: number; owner: string },
        Array<{
          _creationTime: number;
          _id: string;
          createdAt: number;
          owner: string;
          providerMessageId: string;
          status: string;
          text: string;
          to: string;
        }>,
        Name
      >;
      listWebhookEvents: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          eventId: string;
          eventType: string;
          occurredAt?: string;
          payload: any;
          receivedAt: number;
        }>,
        Name
      >;
      sendSms: FunctionReference<
        "action",
        "internal",
        {
          from?: string;
          owner: string;
          text: string;
          to: string;
          webhookUrl?: string;
        },
        { id: string; status: string },
        Name
      >;
      verifyWebhook: FunctionReference<
        "action",
        "internal",
        { headers: Record<string, string>; rawBody: string },
        null | {
          event_type: string;
          id: string;
          occurred_at?: string;
          payload: any;
        },
        Name
      >;
    };
  };
