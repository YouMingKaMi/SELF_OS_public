# finance

拥有消费（expense）、分类（category）、预算（budget）、固定支出参考（recurringExpense）。国库归 treasury。

- `domain/ledger.ts`：净额、日均、按日使用成本（有理数精确累加，最后一次取整）。Web 直接使用；Swift 的 FinanceRules 是对应实现，两端都跑 fixtures/ledger-vectors.json。
- `domain/cost.ts`：按天数的日均成本规则（fixtures/daily-costs.json）。
- `domain/validate.ts` + `rules.ts`：账本不变量（只有当次消费可为负、期限必须完整且有序、分类只有两级、细分类必须属于所选分类、默认子分类必须是自己的子分类）。
