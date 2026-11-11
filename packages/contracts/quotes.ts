/** Market data, read-only and never synchronised. Served by GET /v1/quotes and GET /v1/quotes/search. */
export type AssetKind = "crypto" | "stock";
export type Quote = {
  /** Source key, as stored in `asset.quoteId`. */
  id: string;
  name: string;
  /** Price in the market currency, as a decimal string. */
  price: string;
  currency: string;
  /** Price converted to CNY, as a decimal string. */
  priceCNY: string;
  /** Change since the previous close, in percent; absent when the source has none. */
  changePercent?: number;
  at: string;
};
export type Quotes = { quotes: Record<string, Quote>; missing: string[] };
export type QuoteMatch = {
  quoteId: string;
  name: string;
  symbol: string;
  kind: AssetKind;
  /** e.g. 美股, 港股, 沪市, 深市, 加密 */
  market: string;
  currency: string;
};
export type QuoteSearch = { results: QuoteMatch[] };
/** Stable quote keys: `coingecko:<coin id>`, `tencent:<us|hk|sh|sz><code>`. */
export const quoteIdPattern = "^(coingecko:[a-z0-9-]{1,80}|tencent:(us[A-Z0-9.]{1,12}|hk[0-9]{5}|sh[0-9]{6}|sz[0-9]{6}|bj[0-9]{6}))$";
