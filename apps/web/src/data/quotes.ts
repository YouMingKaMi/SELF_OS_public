/** Live market data from the server. Not synchronised; the last good answer is kept per browser for offline use. */
import { useEffect, useState } from "react";
import type { AssetKind, Quote, Quotes, QuoteMatch } from "../../../../packages/contracts/quotes.ts";

const storageKey = "council-quotes";
function remembered(): Record<string, Quote> {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? "{}");
  } catch {
    return {};
  }
}
function remember(quotes: Record<string, Quote>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ ...remembered(), ...quotes }));
  } catch {
    /* storage unavailable: live data only */
  }
}

export async function fetchQuotes(ids: string[]): Promise<Quotes> {
  const wanted = [...new Set(ids)];
  const batches = [];
  for (let first = 0; first < wanted.length; first += 40) {
    const batch = wanted.slice(first, first + 40);
    batches.push(fetch("/v1/quotes?ids=" + encodeURIComponent(batch.join(",")), {
      headers: { "x-council-request": "1" },
      signal: AbortSignal.timeout(12000),
    }).then(async (response): Promise<Quotes> => {
      if (!response.ok) throw new Error("QUOTES_UNAVAILABLE");
      return response.json();
    }));
  }
  const quotes: Record<string, Quote> = {};
  for (const result of await Promise.allSettled(batches))
    if (result.status === "fulfilled") Object.assign(quotes, result.value.quotes);
  if (Object.keys(quotes).length) remember(quotes);
  return { quotes, missing: wanted.filter((id) => !quotes[id]) };
}

export async function searchQuotes(q: string, kind: AssetKind): Promise<QuoteMatch[]> {
  const response = await fetch(
    `/v1/quotes/search?kind=${kind}&q=${encodeURIComponent(q)}`,
    { headers: { "x-council-request": "1" }, signal: AbortSignal.timeout(12000) },
  );
  if (!response.ok) throw new Error("QUOTES_UNAVAILABLE");
  return (await response.json()).results;
}

/** Quotes for the given ids, refreshed every minute while mounted and visible. */
export function useQuotes(ids: string[]) {
  const key = [...new Set(ids)].sort().join(",");
  const [quotes, setQuotes] = useState<Record<string, Quote>>(remembered);
  const [latest, setLatest] = useState<Record<string, Quote>>({});
  function accept(result: Quotes) {
    setQuotes((old) => ({ ...old, ...result.quotes }));
    setLatest(result.quotes);
  }
  useEffect(() => {
    if (!key) return;
    let stop = false;
    const load = () => {
      if (document.hidden) return;
      fetchQuotes(key.split(","))
        .then((result) => { if (!stop) accept(result); });
    };
    load();
    const timer = setInterval(load, 60000);
    document.addEventListener("visibilitychange", load);
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [key]);
  const statusOf = (id: string) => {
    if (!quotes[id]) return "缺报价";
    const current = latest[id];
    if (!current || Date.now() - Date.parse(current.at) > 300_000) return "最近报价";
    return current.timeSource === "market" ? "市场报价" : "最近获取";
  };
  return { quotes, statusOf, accept };
}
