/**
 * Treasury valuation, replayed once in time order.
 * Plain wallets (人民币, 外部投资) carry one balance each. Exchange and brokerage wallets carry
 * holdings per asset: an entry with `assetId` sets or moves that asset's quantity in that wallet.
 * An asset's total is the sum over wallets; its CNY price is the live quote, else the last price
 * recorded on an entry, else the asset's manual price.
 */
type Row = { id: string; updatedAt: string; deleted?: boolean; data: Record<string, unknown> };
const SCALE = 1_000_000_000_000n; // 12 fraction digits, the contract's decimal precision
const text = (row: Row, key: string) => {
  const value = row.data[key];
  return value === undefined || value === null ? "" : String(value);
};

/** Exact decimal string → scaled integer; null if not a decimal. */
export function parseDecimal(value: string): bigint | null {
  const m = /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(value.trim());
  if (!m) {
    const n = Number(value);
    if (!value || !Number.isFinite(n)) return null;
    return parseDecimal(n.toFixed(12).replace(/\.?0+$/, ""));
  }
  const v = BigInt(m[2]) * SCALE + BigInt((m[3] ?? "").padEnd(12, "0"));
  return m[1] ? -v : v;
}
export function formatDecimal(n: bigint, digits = 8) {
  const sign = n < 0n ? "-" : "";
  const v = n < 0n ? -n : n;
  const fraction = String(v % SCALE).padStart(12, "0").slice(0, digits).replace(/0+$/, "");
  return sign + (v / SCALE).toString() + (fraction ? "." + fraction : "");
}
/** quantity × price, both scaled → CNY cents. */
const cents = (quantity: bigint, price: bigint) => (quantity * price * 100n) / (SCALE * SCALE);

export type Holding = { quantity: bigint };
export type AssetTotal = {
  quantity: bigint;
  /** CNY per unit, scaled; null when unknown. */
  price: bigint | null;
  live: boolean;
  /** CNY cents; null when the price is unknown. */
  value: bigint | null;
  byWallet: Record<string, bigint>;
};
export type WalletTotal = { quantity: bigint | null; value: bigint | null };
export type TreasuryReport = {
  wallets: Record<string, WalletTotal>;
  assets: Record<string, AssetTotal>;
  /** CNY cents of everything with a known value. */
  total: bigint;
  unknown: number;
  points: { at: string; value: bigint }[];
};

export function treasury(input: {
  wallets: Row[];
  assets: Row[];
  entries: Row[];
  /** Observed prices (assetPrice records): move the recorded price, and the chart, without touching holdings. */
  prices?: Row[];
  /** assetId → live CNY price (decimal string). */
  live?: Record<string, string | undefined>;
  until?: string;
  /** Instant of the closing "now" point; without it no live point is added. */
  now?: string;
}): TreasuryReport {
  const wallets = input.wallets.filter((w) => !w.deleted);
  const assets = input.assets.filter((a) => !a.deleted);
  const plain = new Map<string, { quantity: bigint | null; price: bigint | null; rate: bigint | null }>();
  for (const w of wallets) {
    const fixed = ["cny", "external"].includes(text(w, "category"));
    plain.set(w.id, {
      quantity: null,
      price: fixed ? SCALE : parseDecimal(text(w, "unitPrice")),
      rate: text(w, "currency") === "CNY" || fixed ? SCALE : parseDecimal(text(w, "exchangeRate")),
    });
  }
  const held = new Map<string, Map<string, bigint>>(); // assetId → walletId → quantity
  const recorded = new Map<string, bigint>(); // assetId → last recorded CNY price
  for (const a of assets) {
    held.set(a.id, new Map());
    const manual = parseDecimal(text(a, "manualPrice"));
    if (manual !== null) recorded.set(a.id, manual);
  }
  const plainValue = (s: { quantity: bigint | null; price: bigint | null; rate: bigint | null }) =>
    s.quantity !== null && s.price !== null && s.rate !== null
      ? (s.quantity * s.price * s.rate * 100n) / (SCALE * SCALE * SCALE)
      : null;
  const totalAt = (prices: (assetId: string) => bigint | null) => {
    let sum = 0n;
    for (const s of plain.values()) sum += plainValue(s) ?? 0n;
    for (const [assetId, byWallet] of held) {
      const price = prices(assetId);
      if (price === null) continue;
      for (const q of byWallet.values()) sum += cents(q, price);
    }
    return sum;
  };
  const inRange = (row: Row) => !row.deleted && (!input.until || text(row, "at") <= input.until);
  const rows: Row[] = [
    ...input.entries.filter(
      (e) =>
        inRange(e) &&
        plain.has(text(e, "walletId")) &&
        (!e.data.assetId || held.has(text(e, "assetId"))),
    ),
    ...(input.prices ?? [])
      .filter((p) => inRange(p) && held.has(text(p, "assetId")))
      .map((p): Row => ({ ...p, data: { ...p.data, observed: true } })),
  ].sort(
    (a, b) =>
      text(a, "at").localeCompare(text(b, "at")) ||
      a.updatedAt.localeCompare(b.updatedAt) ||
      a.id.localeCompare(b.id),
  );
  const points: { at: string; value: bigint }[] = [];
  for (const row of rows) {
    if (row.data.observed) {
      const price = parseDecimal(text(row, "price"));
      if (price !== null) recorded.set(text(row, "assetId"), price);
      points.push({ at: text(row, "at"), value: totalAt((id) => recorded.get(id) ?? null) });
      continue;
    }
    const quantity = parseDecimal(text(row, "quantity"));
    const assetId = text(row, "assetId");
    if (assetId) {
      const byWallet = held.get(assetId)!;
      const wallet = text(row, "walletId");
      if (quantity !== null)
        byWallet.set(
          wallet,
          row.data.mode === "set" ? quantity : (byWallet.get(wallet) ?? 0n) + quantity,
        );
      const price = parseDecimal(text(row, "unitPrice"));
      const rate = parseDecimal(text(row, "exchangeRate"));
      if (price !== null) recorded.set(assetId, rate !== null ? (price * rate) / SCALE : price);
    } else {
      const state = plain.get(text(row, "walletId"))!;
      if (quantity !== null)
        state.quantity =
          row.data.mode === "set" ? quantity : state.quantity === null ? null : state.quantity + quantity;
      const price = parseDecimal(text(row, "unitPrice"));
      const rate = parseDecimal(text(row, "exchangeRate"));
      if (price !== null) state.price = price;
      if (rate !== null) state.rate = rate;
    }
    points.push({ at: text(row, "at"), value: totalAt((id) => recorded.get(id) ?? null) });
  }
  const priceOf = (assetId: string) => {
    const live = input.live?.[assetId];
    const parsed = live ? parseDecimal(live) : null;
    return parsed !== null ? { price: parsed, live: true } : { price: recorded.get(assetId) ?? null, live: false };
  };
  const assetTotals: Record<string, AssetTotal> = {};
  let unknown = 0;
  for (const [assetId, byWallet] of held) {
    const { price, live } = priceOf(assetId);
    const quantity = [...byWallet.values()].reduce((n, q) => n + q, 0n);
    const value = price === null ? null : cents(quantity, price);
    if (value === null && quantity !== 0n) unknown++;
    assetTotals[assetId] = { quantity, price, live, value, byWallet: Object.fromEntries(byWallet) };
  }
  const walletTotals: Record<string, WalletTotal> = {};
  for (const [id, state] of plain) {
    const holdings = [...held].filter(([, byWallet]) => byWallet.has(id));
    if (holdings.length) {
      let value: bigint | null = 0n;
      for (const [assetId, byWallet] of holdings) {
        const price = assetTotals[assetId].price;
        value = price === null || value === null ? null : value + cents(byWallet.get(id)!, price);
      }
      walletTotals[id] = { quantity: null, value };
    } else {
      const value = plainValue(state);
      if (value === null && state.quantity !== null) unknown++;
      walletTotals[id] = { quantity: state.quantity, value };
    }
  }
  const total = totalAt((id) => priceOf(id).price);
  if (input.now && points.length && points[points.length - 1].value !== total && !input.until)
    points.push({ at: input.now, value: total });
  return { wallets: walletTotals, assets: assetTotals, total, unknown, points };
}
