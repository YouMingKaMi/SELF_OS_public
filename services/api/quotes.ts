/**
 * Market data adapter: crypto from CoinGecko, stocks from Tencent quotes, FX from exchangerate-api.
 * Only asset identifiers leave the server; nothing about holdings or the owner does.
 * Results are cached briefly so many devices do not multiply upstream calls.
 */
import type { AssetKind, Quote, QuoteMatch, Quotes } from "../../packages/contracts/quotes.ts";
import { quoteIdPattern } from "../../packages/contracts/quotes.ts";

type Fetch = typeof fetch;
const validId = new RegExp(quoteIdPattern);
const markets: Record<string, [string, string]> = {
  us: ["美股", "USD"],
  hk: ["港股", "HKD"],
  sh: ["沪市", "CNY"],
  sz: ["深市", "CNY"],
  bj: ["北交所", "CNY"],
};

export class QuoteService {
  private cache = new Map<string, { quote: Quote; until: number }>();
  private rates: { cnyPer: Record<string, number>; until: number } | undefined;
  private get: Fetch;
  private ttl: number;
  constructor(get: Fetch = fetch, ttlSeconds = 60) {
    this.get = get;
    this.ttl = ttlSeconds * 1000;
  }

  private async text(url: string, encoding = "utf-8") {
    const response = await this.get(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "Mozilla/5.0 (personal-council quotes)" },
    });
    if (!response.ok) throw new Error("UPSTREAM_" + response.status);
    return new TextDecoder(encoding).decode(await response.arrayBuffer());
  }

  /** CNY per one unit of each currency. */
  private async cnyPer(currency: string) {
    if (currency === "CNY") return 1;
    if (!this.rates || this.rates.until < Date.now()) {
      const body = JSON.parse(await this.text("https://open.er-api.com/v6/latest/CNY"));
      const cnyPer: Record<string, number> = {};
      for (const [code, rate] of Object.entries(body.rates as Record<string, number>))
        if (rate > 0) cnyPer[code] = 1 / rate;
      this.rates = { cnyPer, until: Date.now() + 3_600_000 };
    }
    const rate = this.rates.cnyPer[currency];
    if (!rate) throw new Error("NO_RATE");
    return rate;
  }

  async quotes(ids: string[]): Promise<Quotes> {
    const wanted = [...new Set(ids)].filter((id) => validId.test(id)).slice(0, 60);
    const now = Date.now();
    const quotes: Record<string, Quote> = {};
    const stale = wanted.filter((id) => {
      const hit = this.cache.get(id);
      if (hit && hit.until > now) quotes[id] = hit.quote;
      return !quotes[id];
    });
    const at = new Date().toISOString();
    const coins = stale.filter((id) => id.startsWith("coingecko:")).map((id) => id.slice(10));
    if (coins.length) {
      try {
        const body = JSON.parse(
          await this.text(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(",")}&vs_currencies=usd,cny&include_24hr_change=true`,
          ),
        );
        for (const coin of coins) {
          const row = body[coin];
          if (!row?.cny) continue;
          quotes["coingecko:" + coin] = {
            id: "coingecko:" + coin,
            name: coin,
            price: String(row.usd ?? row.cny),
            currency: row.usd ? "USD" : "CNY",
            priceCNY: String(row.cny),
            changePercent: typeof row.usd_24h_change === "number" ? Math.round(row.usd_24h_change * 100) / 100 : undefined,
            at,
          };
        }
      } catch {
        /* reported as missing */
      }
    }
    const stocks = stale.filter((id) => id.startsWith("tencent:")).map((id) => id.slice(8));
    if (stocks.length) {
      try {
        const body = await this.text(`https://qt.gtimg.cn/q=${stocks.join(",")}`, "gbk");
        for (const line of body.split(";")) {
          const match = line.match(/v_([a-zA-Z0-9.]+)="([^"]*)"/);
          if (!match) continue;
          const f = match[2].split("~");
          const price = Number(f[3]);
          const previous = Number(f[4]);
          if (!(price > 0)) continue;
          const currency = markets[match[1].slice(0, 2)]?.[1] ?? "CNY";
          const id = "tencent:" + match[1];
          quotes[id] = {
            id,
            name: f[1],
            price: f[3],
            currency,
            priceCNY: String(Math.round(price * (await this.cnyPer(currency)) * 1e6) / 1e6),
            changePercent: previous > 0 ? Math.round(((price - previous) / previous) * 10000) / 100 : undefined,
            at,
          };
        }
      } catch {
        /* reported as missing */
      }
    }
    for (const id of stale)
      if (quotes[id]) this.cache.set(id, { quote: quotes[id], until: now + this.ttl });
    return { quotes, missing: wanted.filter((id) => !quotes[id]) };
  }

  async search(query: string, kind: AssetKind): Promise<QuoteMatch[]> {
    const q = query.trim().slice(0, 40);
    if (!q) return [];
    if (kind === "crypto") {
      const body = JSON.parse(
        await this.text("https://api.coingecko.com/api/v3/search?query=" + encodeURIComponent(q)),
      );
      return (body.coins ?? []).slice(0, 12).map((c: { id: string; name: string; symbol: string }) => ({
        quoteId: "coingecko:" + c.id,
        name: c.name,
        symbol: String(c.symbol).toUpperCase(),
        kind,
        market: "加密",
        currency: "USD",
      }));
    }
    const body = await this.text(
      "https://smartbox.gtimg.cn/s3/?v=2&t=all&q=" + encodeURIComponent(q),
    );
    const hint = body.match(/v_hint="([^"]*)"/)?.[1] ?? "";
    const decoded = hint.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const results: QuoteMatch[] = [];
    for (const item of decoded.split("^")) {
      const [market, code, name, , type] = item.split("~");
      if (!markets[market] || !/^(GP|ETF|LOF)/.test(type ?? "")) continue;
      const local = market === "us" ? code.split(".")[0].toUpperCase() : code;
      const quoteId = "tencent:" + market + local;
      if (!validId.test(quoteId)) continue;
      results.push({
        quoteId,
        name,
        symbol: local,
        kind,
        market: markets[market][0],
        currency: markets[market][1],
      });
    }
    return results.slice(0, 12);
  }
}
