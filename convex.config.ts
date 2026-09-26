import { defineComponent } from "convex/server";
import { v } from "convex/values";

export default defineComponent("telnyx", {
  env: {
    TELNYX_API_KEY: v.optional(v.string()),
    TELNYX_PUBLIC_KEY: v.optional(v.string()),
    TELNYX_FROM_NUMBER: v.optional(v.string()),
    TELNYX_API_BASE_URL: v.optional(v.string()),
  },
});
