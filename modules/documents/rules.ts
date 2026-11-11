import type { Rules } from "../kernel/index.ts";
import { checkPlacement } from "../practice/index.ts";

export const rules: Rules = {
  document: {
    /** A provenance label only exists on reference notes filed under a domain. */
    validate(data) {
      if (
        data.source &&
        data.source !== "unknown" &&
        (data.kind !== "note" || !data.domainId)
      )
        throw new Error("INVALID_SOURCE_CONTEXT");
    },
    async check({ data, refs }) {
      checkPlacement(data, refs);
    },
  },
};
