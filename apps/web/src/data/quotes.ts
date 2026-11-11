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

export async function fetchQuotes(ids: string[]): Promise<Record<string, Quote>> {
  if (!ids.length) return {};
  const response = await fetch("/v1/quotes?ids=" + encodeURIComponent(ids.join(",")), {
    headers: { "x-council-request": "1" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("QUOTES_UNAVAILABLE");
  const body: Quotes = await response.json();
  remember(body.quotes);
  return body.quotes;
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
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!key) return;
    let stop = false;
    const load = () => {
      if (document.hidden) return;
      fetchQuotes(key.split(","))
        .then((q) => {
          if (stop) return;
          setQuotes((old) => ({ ...old, ...q }));
          setLive(true);
        })
        .catch(() => !stop && setLive(false));
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
  return { quotes, live, setQuotes };
}
