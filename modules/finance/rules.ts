import type { Rules } from "../kernel/index.ts";
import { validateFinance } from "./domain/validate.ts";

export const rules: Rules = {
  expense: {
    validate: validateFinance,
    async check({ data, refs }) {
      if (
        refs.subcategoryId &&
        refs.subcategoryId.data.parentId !== data.categoryId
      )
        throw new Error("INVALID_SUBCATEGORY");
    },
  },
  recurringExpense: { validate: validateFinance },
  budget: { validate: validateFinance },
  category: {
    /** Categories are exactly two levels deep; a default child must be one of its own children. */
    async check({ id, data, refs }) {
      if (
        refs.parentId &&
        (refs.parentId.data.parentId || data.parentId === id)
      )
        throw new Error("INVALID_CATEGORY_PARENT");
      if (refs.defaultChildId && refs.defaultChildId.data.parentId !== id)
        throw new Error("INVALID_DEFAULT_CHILD");
    },
  },
};
