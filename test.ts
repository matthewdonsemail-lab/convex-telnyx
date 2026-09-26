import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import * as telnyxFunctions from "./telnyx.js";
import * as generatedApi from "./_generated/api.js";
import * as generatedServer from "./_generated/server.js";
import schema from "./schema.js";

/**
 * The component's function modules, for `convex-test`.
 *
 * Declared statically rather than with `import.meta.glob` so the Convex
 * analyzer can bundle this directory: `import.meta` is not available in the
 * Convex runtime. The `_generated` entries are required by `convex-test` to
 * locate the modules root.
 */
export const modules: Record<string, () => Promise<unknown>> = {
  "./telnyx.ts": async () => telnyxFunctions,
  "./_generated/api.ts": async () => generatedApi,
  "./_generated/server.ts": async () => generatedServer,
};

/**
 * Register the component with the test convex instance.
 *
 * @param t The test convex instance, e.g. from calling `convexTest`.
 * @param name The name of the component, as registered in `convex.config.ts`.
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "telnyx",
) {
  t.registerComponent(name, schema, modules);
}

export default { register, schema, modules };
