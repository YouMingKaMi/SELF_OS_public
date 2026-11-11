import { test } from "node:test";
import assert from "node:assert/strict";
import { QuoteService } from "../../services/api/quotes.ts";

const gbk = (s: string) => new TextEncoder().encode(s); // ASCII-only fixtures decode identically
function fake(routes: Record<string, string>) {
  const calls: string[] = [];
  const get = (async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("", { status: 404 });
    return new Response(gbk(routes[key]));
  }) as typeof fetch;
  return { get, calls };
}

test("quotes: crypto in CNY, stocks converted with the market currency, cached", async () => {
  const { get, calls } = fake({
    "coingecko.com/api/v3/simple": JSON.stringify({ bitcoin: { usd: 70000, cny: 500000, usd_24h_change: 1.234 } }),
    "qt.gtimg.cn": 'v_usNVDA="200~NVIDIA~NVDA.OQ~100.00~95.00~0";\nv_hk01810="100~XIAOMI~01810~30.00~31.00~0";',
    "er-api.com": JSON.stringify({ rates: { USD: 0.14, HKD: 1.25 } }),
  });
  const service = new QuoteService(get);
  const r = await service.quotes(["coingecko:bitcoin", "tencent:usNVDA", "tencent:hk01810", "bogus"]);
  assert.equal(r.quotes["coingecko:bitcoin"].priceCNY, "500000");
  assert.equal(r.quotes["coingecko:bitcoin"].changePercent, 1.23);
  assert.equal(r.quotes["tencent:usNVDA"].currency, "USD");
  assert.equal(Number(r.quotes["tencent:usNVDA"].priceCNY).toFixed(2), (100 / 0.14).toFixed(2));
  assert.equal(r.quotes["tencent:hk01810"].changePercent, -3.23);
  assert.deepEqual(r.missing, []);
  const before = calls.length;
  await service.quotes(["tencent:usNVDA"]);
  assert.equal(calls.length, before, "served from cache");
});
test("quotes: search maps Tencent hints to quote ids and keeps only stocks and funds", async () => {
  const { get } = fake({
    smartbox: 'v_hint="us~crcl.n~Circle~circle~GP^hk~01810~Xiaomi~xm~GP^hk~13011~Warrant~w~QZ^sh~600519~Moutai~gzmt~GP-A"',
  });
  const results = await new QuoteService(get).search("x", "stock");
  assert.deepEqual(results.map((r) => r.quoteId), ["tencent:usCRCL", "tencent:hk01810", "tencent:sh600519"]);
  assert.equal(results[0].currency, "USD");
});
