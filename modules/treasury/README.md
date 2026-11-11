# treasury

实体：wallet（钱包 / 账户）、asset（标的）、walletEntry（流水）。

- 人民币、外部投资：按钱包，每个钱包一个余额（流水无 assetId）。
- 加密资产、股票：以标的为主体。交易所 / 钱包 / 券商是 category 为 crypto 或 stock 的钱包，可持有多个标的；带 assetId 的流水设定或增减「该钱包里该标的」的数量。标的总量 = 所有钱包之和。
- 价格：实时行情（`GET /v1/quotes`，折算人民币）→ 最近一次记录在流水上的价格 → 标的的备用价格。记录持仓时会把当时的人民币单价写进流水，历史曲线因此不依赖实时行情。
- 估值规则是纯函数：Web `modules/treasury/domain/holdings.ts`，iPhone `CouncilCore/TreasuryRules.swift`（同一套规则）。
- 行情适配器在 `services/api/quotes.ts`：加密 CoinGecko，股票（美 / 港 / 沪 / 深）腾讯行情，汇率 exchangerate-api；只发送标的代码，缓存 60 秒。
