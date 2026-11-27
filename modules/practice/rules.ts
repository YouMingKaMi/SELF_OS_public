import type { Rules } from "../kernel/index.ts";
import type { AnyEntity } from "../../packages/contracts/entities.ts";

type Placement = {
  domainId?: string;
  activityId?: string;
  problemId?: string;
  solutionId?: string;
};
/**
 * Anything filed under the practice tree must point at one consistent branch:
 * the activity and problem belong to the stated domain, the solution to the stated problem.
 * Exported so other modules that file records under a domain (documents) share the rule.
 */
export function checkPlacement(
  data: Placement,
  refs: Record<string, AnyEntity>,
) {
  if (
    refs.activityId &&
    data.domainId &&
    refs.activityId.data.domainId !== data.domainId
  )
    throw new Error("INVALID_ACTIVITY_DOMAIN");
  if (
    refs.problemId &&
    data.domainId &&
    refs.problemId.data.domainId !== data.domainId
  )
    throw new Error("INVALID_PROBLEM_DOMAIN");
  if (
    refs.eventId &&
    (refs.eventId.data.domainId !== data.domainId ||
      refs.eventId.data.activityId !== data.activityId ||
      data.problemId ||
      data.solutionId)
  )
    throw new Error("INVALID_EVENT_PLACEMENT");
  if (
    refs.solutionId &&
    data.problemId &&
    refs.solutionId.data.problemId !== data.problemId
  )
    throw new Error("INVALID_SOLUTION_PROBLEM");
}
const placed = {
  async check({
    data,
    refs,
  }: {
    data: Placement;
    refs: Record<string, AnyEntity>;
  }) {
    checkPlacement(data, refs);
  },
};

export const rules: Rules = {
  problem: placed,
  practiceEvent: {
    async check({ data, current, refs }, reader) {
      checkPlacement(data, refs);
      if (
        current &&
        (current.data.domainId !== data.domainId ||
          current.data.activityId !== data.activityId ||
          current.data.readingItemId !== data.readingItemId)
      )
        throw new Error("EVENT_PLACEMENT_LOCKED");
      if (!current && data.readingItemId) {
        const item = await reader.get("readingItem", data.readingItemId);
        if (!item || item.deleted) throw new Error("MISSING_READING_ITEM");
      }
    },
  },
  session: placed,
  progress: placed,
  solution: {
    /** A parent must be a live solution of the same problem, and the tree must stay a tree. */
    async check({ id, data }, reader) {
      let parentId = data.parentId;
      const seen = new Set([id]);
      for (let depth = 0; parentId; depth++) {
        if (depth >= 100) throw new Error("TREE_TOO_DEEP");
        if (seen.has(parentId)) throw new Error("CYCLE");
        seen.add(parentId);
        const parent = await reader.get("solution", parentId);
        if (
          !parent ||
          parent.deleted ||
          parent.data.problemId !== data.problemId
        )
          throw new Error("INVALID_PARENT");
        parentId = parent.data.parentId;
      }
    },
  },
};
