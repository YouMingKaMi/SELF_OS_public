import type { Rules } from "../kernel/index.ts";
import { validateFinance } from "./domain/validate.ts";

export const rules: Rules = {
  expense: {
    validate(data) {
      validateFinance(data);
      const confirmation = data.wechatMerchantRule;
      if (
        confirmation &&
        ((confirmation.length !== 3 && confirmation.length !== 4) ||
          !confirmation[0].trim() ||
          Array.from(confirmation[0]).length > 200 ||
          !/^[a-f\d-]{36}$/i.test(confirmation[1]) ||
          !Number.isFinite(Date.parse(confirmation[2])) ||
          (confirmation.length === 4 &&
            (!confirmation[3].trim() || confirmation[3].length > 500)))
      )
        throw new Error("INVALID_WECHAT_MERCHANT_RULE");
    },
    prepare({ data, current }) {
      const merchant = current?.data.wechatMerchant || data.wechatMerchant;
      const confirmation = data.wechatMerchantRule;
      return {
        ...data,
        wechatMerchant: merchant,
        wechatMerchantRule:
          confirmation && merchant
            ? [merchant, ...confirmation.slice(1)]
            : (confirmation ?? current?.data.wechatMerchantRule),
      };
    },
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
