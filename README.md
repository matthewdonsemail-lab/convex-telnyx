<p align="center">
  <img src="https://raw.githubusercontent.com/matthewdonsemail-lab/convex-telnyx/main/banner.png" alt="@listeningkit/telnyx — Convex component for Telnyx" width="100%" />
</p>

# @listeningkit/telnyx (Convex Telnyx Component)

> A production-ready [Convex Component](https://docs.convex.dev/components) for [Telnyx](https://telnyx.com) messaging: send SMS from a Convex action, verify Ed25519-signed webhooks, and keep every send and every event idempotent by default.

[![Convex Component](https://img.shields.io/badge/Convex-Component-blue)](https://docs.convex.dev/components)
[![npm version](https://img.shields.io/npm/v/@listeningkit/telnyx.svg)](https://www.npmjs.com/package/@listeningkit/telnyx)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

| | |
|---|---|
| **Provider** | [Telnyx](https://telnyx.com) messaging API (`POST /v2/messages`) |
| **Component** | `@listeningkit/telnyx` on [npm](https://www.npmjs.com/package/@listeningkit/telnyx) |
| **Source** | [github.com/matthewdonsemail-lab/convex-telnyx](https://github.com/matthewdonsemail-lab/convex-telnyx) |
| **Auth model** | Your app authenticates; the component receives an `owner` string |
| **License** | Apache-2.0 |

---

## Overview

Talking to Telnyx from a Convex backend means handling three things well: keeping the API key off the client, verifying webhook signatures correctly against the **raw** request body, and not double-sending or double-processing when Telnyx retries.

`@listeningkit/telnyx` does all three inside a Convex component:

- **Secrets stay server-side.** The API key, public key, and default sender number are declared in the component's environment, so callers never pass a credential as an argument.
- **Webhooks are verified properly.** Ed25519 verification over `<telnyx-timestamp>|<raw body>`, with a five-minute replay window.
- **Everything is idempotent.** Sends are keyed by Telnyx message id, webhook events by Telnyx event id, so retries and replays never duplicate rows.
- **The data model is isolated.** Messages and events live in the component's own schema partition and never pollute your app's tables.

---

## Convex Component Architecture

This package follows the [Convex Component Specification](https://docs.convex.dev/components/authoring):

```
telnyx/
├── banner.png             # Visual component header banner
├── convex.config.ts       # Component definition & typed environment variables
├── schema.ts              # Encapsulated schema (messages, webhookEvents)
├── telnyx.ts              # Component actions, mutations, and queries
├── client.ts              # Type-safe client wrapper for host applications
├── test.ts                # convex-test registration helper
├── lib/
│   └── telnyx.ts          # Pure helpers (E.164 validation, send, Ed25519 verify)
├── _generated/            # Generated component API bindings
├── dist/                  # Compiled JavaScript and TypeScript declarations
└── package.json           # Component exports, peerDependencies, and scripts
```

### 1. Sandboxed Database Isolation

The component owns its schema. `messages` and `webhookEvents` live inside the component's isolated partition, so they cannot collide with your application's tables and are not visible to your app's clients.

### 2. Typed Environment Injection

Environment variables are declared in [`convex.config.ts`](./convex.config.ts):

| Variable | Required | Purpose |
|---|---|---|
| `TELNYX_API_KEY` | yes | Telnyx v2 API key, sent as a bearer token |
| `TELNYX_PUBLIC_KEY` | for webhooks | Base64 Ed25519 public key from the Telnyx portal |
| `TELNYX_FROM_NUMBER` | yes, unless passed per call | Default E.164 sender number |
| `TELNYX_API_BASE_URL` | no | Override the API base (defaults to `https://api.telnyx.com/v2`) |

All are declared optional so installing the package never blocks codegen; actions fail with a clear error when a required one is missing.

### 3. Auth Lives in Your App

Convex components have no `ctx.auth`. Your app authenticates the caller and passes the resulting `owner` string, which the component uses to scope reads. This component never sees your auth provider — Clerk, Auth0, or your own session logic all work the same way.

### 4. Ergonomic Client Wrapper

Rather than assembling `ctx.runAction(components.telnyx.telnyx.sendSms, ...)` by hand, the package exports a typed `Telnyx` client whose constructor takes the generated `ComponentApi`, so it can never drift from the component's real signatures.

---

## Installation & Setup

### 1. Install the package

```bash
# npm
npm install @listeningkit/telnyx

# pnpm
pnpm add @listeningkit/telnyx

# yarn
yarn add @listeningkit/telnyx
```

*(Ensure `convex` `>=1.45.0` is installed as a peer dependency.)*

### 2. Register the component

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import telnyx from "@listeningkit/telnyx/convex.config";

const app = defineApp();
app.use(telnyx);

export default app;
```

### 3. Configure environment variables

```bash
npx convex env set TELNYX_API_KEY="your-telnyx-api-key"
npx convex env set TELNYX_PUBLIC_KEY="base64-ed25519-public-key"
npx convex env set TELNYX_FROM_NUMBER="+15550000001"
```

### 4. Regenerate types

```bash
npx convex dev --once
```

---

## Usage

### Send an SMS from an authenticated action

```ts
// convex/messages.ts
import { v } from "convex/values";
import { action } from "./_generated/server";
import { components } from "./_generated/api";
import { Telnyx } from "@listeningkit/telnyx";

const telnyx = new Telnyx(components.telnyx);

export const sendText = action({
  args: { to: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    // 1. Authenticate in your app — the component has no ctx.auth.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    // 2. Send. The API key and default sender come from the component env.
    return await telnyx.sendSms(ctx, {
      owner: identity.subject,
      to: args.to,
      text: args.text,
    });
  },
});
```

Numbers are validated as E.164 **before** any network call, so a malformed recipient never costs an API request.

### Receive and verify webhooks

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { components } from "./_generated/api";
import { Telnyx } from "@listeningkit/telnyx";

const telnyx = new Telnyx(components.telnyx);
const http = httpRouter();

http.route({
  path: "/telnyx/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Verification needs the exact bytes Telnyx signed.
    const rawBody = await request.text();
    const event = await telnyx.verifyWebhook(ctx, {
      rawBody,
      headers: Object.fromEntries(request.headers.entries()),
    });

    if (!event) return new Response("invalid Telnyx signature", { status: 401 });
    if (event.event_type === "message.received") {
      // event.payload carries id, direction, from, to, and text.
      console.log("inbound SMS", event.payload);
    }
    return Response.json({ ok: true });
  }),
});

export default http;
```

`verifyWebhook` returns `null` — never throws — for a bad signature, a stale timestamp, or an unparseable body, so you can answer `401` and let Telnyx retry. Verified events are recorded once, keyed by Telnyx event id.

### Read the component's records

```ts
import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { Telnyx } from "@listeningkit/telnyx";

const telnyx = new Telnyx(components.telnyx);

export const recentMessages = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    return await telnyx.listMessages(ctx, { owner: identity.subject, limit: 20 });
  },
});
```

---

## Production Guardrails

| Guardrail | Mechanism | Benefit |
|---|---|---|
| **Server-side secrets** | Component `env` only | The API key is never a function argument, so it cannot leak through client calls or logs |
| **E.164 validation** | `lib/telnyx.ts` before fetch | Invalid numbers fail locally instead of burning an API request |
| **Signature verification** | Ed25519 over `<timestamp>\|<raw body>` | Forged or modified webhooks are rejected |
| **Replay window** | Five-minute timestamp tolerance | A captured webhook cannot be replayed later |
| **Idempotent sends** | `messages` indexed by `providerMessageId` | A retried send never double-logs |
| **Idempotent events** | `webhookEvents` indexed by `eventId` | Telnyx retries are free no-ops |
| **Bounded upstream** | `AbortSignal.timeout(15_000)` | A hung Telnyx call cannot consume the action budget |

---

## Component Development & Publishing

```bash
# install
pnpm install

# generate component bindings (run before building so dist/ is not scanned)
pnpm run build:codegen

# compile declarations and JavaScript
pnpm run build

# type check and test
pnpm run typecheck
pnpm test
```

> **Note:** run `build:codegen` before `build`. Convex scans the component directory for modules, so a stale `dist/` would be analyzed as if it were source.

### Testing your integration with `convex-test`

```ts
import { convexTest } from "convex-test";
import { modules } from "@listeningkit/telnyx/test";
import schema from "./schema.js";
```

---

## License

Apache 2.0

---

<!-- footer:offer-set:start -->
## Support

If this is useful, a star helps someone else find it.

[![Stars](https://img.shields.io/github/stars/matthewdonsemail-lab/convex-telnyx?style=flat-square)](https://github.com/matthewdonsemail-lab/convex-telnyx/stargazers)
[![Forks](https://img.shields.io/github/forks/matthewdonsemail-lab/convex-telnyx?style=flat-square)](https://github.com/matthewdonsemail-lab/convex-telnyx/network/members)
[![Watchers](https://img.shields.io/github/watchers/matthewdonsemail-lab/convex-telnyx?style=flat-square)](https://github.com/matthewdonsemail-lab/convex-telnyx/watchers)
[![Last commit](https://img.shields.io/github/last-commit/matthewdonsemail-lab/convex-telnyx?style=flat-square)](https://github.com/matthewdonsemail-lab/convex-telnyx/commits)
[![License](https://img.shields.io/github/license/matthewdonsemail-lab/convex-telnyx?style=flat-square)](https://github.com/matthewdonsemail-lab/convex-telnyx/blob/main/LICENSE)

[![GitHub](https://img.shields.io/badge/GitHub-matthewdonsemail-lab/convex-telnyx-181717?style=flat-square&logo=github&link=https://github.com/matthewdonsemail-lab/convex-telnyx)](https://github.com/matthewdonsemail-lab/convex-telnyx)
[![X](https://img.shields.io/badge/X-matthewdonsemail-000000?style=flat-square&logo=x&link=https://x.com/matthewdonsemail)](https://x.com/matthewdonsemail)
[![Issues](https://img.shields.io/github/issues/matthewdonsemail-lab/convex-telnyx?style=flat-square)](https://github.com/matthewdonsemail-lab/convex-telnyx/issues)
[![Pull requests](https://img.shields.io/github/issues-pr/matthewdonsemail-lab/convex-telnyx?style=flat-square)](https://github.com/matthewdonsemail-lab/convex-telnyx/pulls)

## Star history

[![Star History Chart](https://api.star-history.com/image?repos=matthewdonsemail-lab/convex-telnyx&type=Date)](https://star-history.com/#matthewdonsemail-lab/convex-telnyx&Date)
<!-- footer:offer-set:end -->
