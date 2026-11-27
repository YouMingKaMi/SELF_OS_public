/**
 * Treasury valuation, replayed once in time order.
 * Plain wallets (人民币, 外部投资) carry one balance each. Exchange and brokerage wallets carry
 * holdings per asset: an entry with `assetId` sets or moves that asset's quantity in that wallet.
 * An asset's total is the sum over wallets; its CNY price is the live quote, else the last price
 * recorded on an entry, else the asset's manual price.
 */
type Row = { id: string; updatedAt: string; version?: number; deleted?: boolean; data: Record<string, unknown> };
const SCALE = 1_000_000_000_000n; // 12 fraction digits, the contract's decimal precision
const VALUE_SCALE = SCALE ** 3n; // quantity × unit price × exchange rate
const text = (row: Row, key: string) => {
  const value = row.data[key];
  return value === undefined || value === null ? "" : String(value);
};

/** Exact contract decimal string → scaled integer. */
export function parseDecimal(value: string): bigint | null {
  const m = /^(-?)(\d{1,18})(?:\.(\d{1,12}))?$/.exec(value.trim());
  if (!m) return null;
  const scaled = BigInt(m[2]) * SCALE + BigInt((m[3] ?? "").padEnd(12, "0"));
  return m[1] ? -scaled : scaled;
}

/** Market providers can encode decimals with an exponent. Normalize without a Number round trip. */
function parseQuote(value: string): bigint | null {
  const exact = parseDecimal(value);
  if (exact !== null) return exact;
  const match = /^(-?)(\d{1,18})(?:\.(\d{1,24}))?[eE]([+-]?\d{1,3})$/.exec(value.trim());
  if (!match) return null;
  const fraction = match[3] ?? "";
  const scale = 12 + Number(match[4]) - fraction.length;
  const digits = (match[2] + fraction).replace(/^0+/, "");
  if (!digits) return 0n;
  if (digits.length + scale > 30) return null;
  const magnitude = scale >= 0
    ? BigInt(digits) * 10n ** BigInt(scale)
    : BigInt(digits.slice(0, digits.length + scale <= 0 ? 0 : digits.length + scale) || "0");
  return match[1] ? -magnitude : magnitude;
}

export function formatDecimal(n: bigint, digits = 8) {
  const sign = n < 0n ? "-" : "";
  const v = n < 0n ? -n : n;
  const fraction = String(v % SCALE).padStart(12, "0").slice(0, digits).replace(/0+$/, "");
  return sign + (v / SCALE).toString() + (fraction ? "." + fraction : "");
}

/** Round exact valuation once, at the requested output boundary (halves away from zero). */
const cents = (value: bigint) => {
  const sign = value < 0n ? -1n : 1n;
  return sign * ((value * sign * 200n + VALUE_SCALE) / (2n * VALUE_SCALE));
};
type Valuation = { known: number; unknown: number; value: bigint };
export type SelectedValuation = { value: bigint; known: number; unknown: number };
type Plain = { quantity: bigint | null; price: bigint | null; rate: bigint | null };

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
export type TreasuryPoint = { at: string; value: bigint; partial?: true };
export type WalletTotal = { quantity: bigint | null; value: bigint | null };
export type EntryChange = {
  /** Exact scaled delta, or null when a set establishes the first known balance. */
  delta: bigint | null;
  /** Scaled balance before this entry, or null when not yet established. */
  previous: bigint | null;
  /** Scaled balance immediately after this entry. */
  after: bigint;
};
export type TreasuryReport = {
  wallets: Record<string, WalletTotal>;
  assets: Record<string, AssetTotal>;
  entryChanges: Record<string, EntryChange>;
  /** CNY cents of everything with a known value. */
  total: bigint;
  unknown: number;
  points: TreasuryPoint[];
  history: { at: string; value: bigint | null }[];
  /** Current exact projection of a supplied selection, rounded after summing its known values. */
  selected?: SelectedValuation;
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
  /** Exclusive upper limit, compared as an instant. */
  before?: number;
  /** Instant of the closing "now" point; without it no live point is added. */
  now?: string;
  /** Project this selection's history using timestamped balances and prices. */
  historyOf?: { wallets: ReadonlySet<string>; assets: ReadonlySet<string> };
}): TreasuryReport {
  const wallets = input.wallets.filter((w) => !w.deleted);
  const assets = input.assets.filter((a) => !a.deleted);
  const plain = new Map<string, Plain>();
  for (const w of wallets) {
    const fixed = ["cny", "external"].includes(text(w, "category"));
    plain.set(w.id, {
      quantity: null,
      price: fixed ? SCALE : parseDecimal(text(w, "unitPrice")),
      rate: text(w, "currency") === "CNY" || fixed ? SCALE : parseDecimal(text(w, "exchangeRate")),
    });
  }
  const held = new Map<string, Map<string, bigint>>();
  const quantities = new Map<string, bigint>();
  const manualPrices = new Map<string, bigint>();
  const recorded = new Map<string, bigint>();
  for (const a of assets) {
    held.set(a.id, new Map());
    const manual = parseDecimal(text(a, "manualPrice"));
    if (manual !== null) manualPrices.set(a.id, manual * SCALE);
  }

  const selection = input.historyOf;
  const selectedPlain = (id: string) => !selection || selection.wallets.has(id);
  const selectedAsset = (id: string) => !selection || selection.assets.has(id);
  const recordedPrice = (id: string) => recorded.get(id) ?? (selection ? undefined : manualPrices.get(id));
  const plainValue = ({ quantity, price, rate }: Plain): bigint | null =>
    quantity === null || price === null || rate === null ? null : quantity * price * rate;
  const assetValue = (quantity: bigint | undefined, price: bigint | undefined): bigint | null => {
    if (quantity === undefined) return null;
    if (quantity === 0n) return 0n;
    return price === undefined ? null : quantity * price;
  };
  const activeWallets = new Set<string>();
  const projection: Valuation = {
    value: 0n,
    known: 0,
    unknown: selection ? selection.wallets.size + selection.assets.size : 0,
  };
  const replace = (old: bigint | null, next: bigint | null) => {
    projection.value += (next ?? 0n) - (old ?? 0n);
    const increment = Number(next !== null) - Number(old !== null);
    projection.known += increment;
    projection.unknown -= increment;
  };
  const until = input.until === undefined ? Infinity : Date.parse(input.until);
  const before = input.before ?? Infinity;
  // Resolve repeated snapshots before filtering so an old entry cannot survive its tombstone.
  const entries = new Map<string, Row>();
  for (const row of input.entries) {
    const current = entries.get(row.id);
    const version = row.version ?? 0;
    const currentVersion = current?.version ?? 0;
    if (!current || version > currentVersion || (version === currentVersion && row.updatedAt >= current.updatedAt)) {
      entries.set(row.id, row);
    }
  }
  const rows = [
    ...Array.from(entries.values()).filter(
      (e) => !e.deleted && plain.has(text(e, "walletId")) &&
        (!e.data.assetId || held.has(text(e, "assetId"))),
    ).map((row) => ({ row, observed: false, time: Date.parse(text(row, "at")) })),
    ...(input.prices ?? [])
      .filter((p) => !p.deleted && held.has(text(p, "assetId")))
      .map((row) => ({ row, observed: true, time: Date.parse(text(row, "at")) })),
  ].filter(({ time }) => Number.isFinite(time) && time <= until && time < before)
    .sort((a, b) => a.time - b.time || a.row.id.localeCompare(b.row.id));
  const points: TreasuryReport["points"] = [];
  const history: TreasuryReport["history"] = [];
  const entryChanges: TreasuryReport["entryChanges"] = {};
  const change = (row: Row, previous: bigint | null, quantity: bigint): EntryChange => {
    if (row.data.mode === "set") {
      return { previous, after: quantity, delta: previous === null ? null : quantity - previous };
    }
    return { previous, after: (previous ?? 0n) + quantity, delta: quantity };
  };
  for (const { row, observed } of rows) {
    const assetId = text(row, "assetId");
    const walletId = text(row, "walletId");
    if (assetId) {
      const oldQuantity = quantities.get(assetId);
      const old = assetValue(oldQuantity, recordedPrice(assetId));
      if (observed) {
        const price = parseQuote(text(row, "price"));
        if (price !== null) recorded.set(assetId, price * SCALE);
      } else {
        const quantity = parseDecimal(text(row, "quantity"));
        const byWallet = held.get(assetId)!;
        if (quantity !== null) {
          const result = change(row, byWallet.get(walletId) ?? null, quantity);
          entryChanges[row.id] = result;
          byWallet.set(walletId, result.after);
          quantities.set(assetId, (oldQuantity ?? 0n) + (result.delta ?? result.after));
        }
        const price = parseDecimal(text(row, "unitPrice"));
        const rate = parseDecimal(text(row, "exchangeRate"));
        if (price !== null) recorded.set(assetId, price * (rate ?? SCALE));
      }
      if (!selection && oldQuantity === undefined && quantities.has(assetId)) projection.unknown++;
      if (selectedAsset(assetId)) replace(old, assetValue(quantities.get(assetId), recordedPrice(assetId)));
    } else {
      const state = plain.get(walletId)!;
      const old = plainValue(state);
      const quantity = parseDecimal(text(row, "quantity"));
      if (quantity !== null) {
        if (!selection && !activeWallets.has(walletId)) {
          activeWallets.add(walletId);
          projection.unknown++;
        }
        const result = change(row, state.quantity, quantity);
        entryChanges[row.id] = result;
        state.quantity = result.after;
      }
      const price = parseDecimal(text(row, "unitPrice"));
      const rate = parseDecimal(text(row, "exchangeRate"));
      if (price !== null) state.price = price;
      if (rate !== null) state.rate = rate;
      if (selectedPlain(walletId)) replace(old, plainValue(state));
    }
    const at = text(row, "at");
    if (selection) {
      history.push({
        at,
        value: projection.known > 0 && projection.unknown === 0 ? cents(projection.value) : null,
      });
    } else {
      points.push({
        at, value: cents(projection.value),
        ...(projection.known === 0 || projection.unknown > 0 ? { partial: true } : {}),
      });
    }
  }

  const assetTotals: Record<string, AssetTotal> = {};
  const walletAssets = new Map<string, bigint | null>();
  let total = 0n;
  let unknown = 0;
  let known = 0;
  const selected: SelectedValuation | undefined = selection
    ? { value: 0n, known: 0, unknown: selection.wallets.size + selection.assets.size }
    : undefined;
  const addSelection = (value: bigint | null) => {
    if (!selected || value === null) return;
    selected.value += value;
    selected.known++;
    selected.unknown--;
  };
  for (const [assetId, byWallet] of held) {
    const quote = parseQuote(input.live?.[assetId] ?? "");
    const price = quote !== null ? quote * SCALE : recorded.get(assetId) ?? manualPrices.get(assetId);
    const quantity = quantities.get(assetId);
    const value = assetValue(quantity, price);
    if (value !== null) known++;
    else if (quantity !== undefined) unknown++;
    total += value ?? 0n;
    if (selectedAsset(assetId)) addSelection(value);
    assetTotals[assetId] = {
      quantity: quantity ?? 0n,
      price: price === undefined ? null : price / SCALE,
      live: quote !== null,
      value: value === null ? null : cents(value),
      byWallet: Object.fromEntries(byWallet),
    };
    for (const [walletId, amount] of byWallet) {
      const holding = assetValue(amount, price);
      const balance = walletAssets.get(walletId);
      walletAssets.set(walletId, holding === null || balance === null ? null : (balance ?? 0n) + holding);
    }
  }
  const walletTotals: Record<string, WalletTotal> = {};
  for (const [id, state] of plain) {
    const balance = plainValue(state);
    total += balance ?? 0n;
    if (balance !== null) known++;
    else if (activeWallets.has(id) || state.quantity !== null) unknown++;
    if (selectedPlain(id)) addSelection(balance);
    const holdings = walletAssets.get(id);
    const value = holdings === null || (balance === null && state.quantity !== null)
      ? null : holdings === undefined ? balance : (balance ?? 0n) + holdings;
    walletTotals[id] = {
      quantity: holdings === undefined ? state.quantity : null,
      value: value === null ? null : cents(value),
    };
  }
  const roundedTotal = cents(total);
  const partial = unknown > 0 || known === 0;
  const prior = points.at(-1);
  if (input.now && prior && Date.parse(input.now) >= Date.parse(prior.at) &&
      !input.until && input.before === undefined &&
      (prior.value !== roundedTotal || Boolean(prior.partial) !== partial))
    points.push({ at: input.now, value: roundedTotal, ...(partial ? { partial: true } : {}) });
  if (selected) selected.value = cents(selected.value);
  return { wallets: walletTotals, assets: assetTotals, entryChanges, total: roundedTotal, unknown, points, history, selected };
}

/** Samples a window of a replayed series without drawing across missing valuations. */
export function treasuryTrend(
  points: readonly TreasuryPoint[], from: string, maxPoints = 400,
): { at: string; value: bigint | null }[] {
  const start = from ? Date.parse(from) : -Infinity;
  const visible: TreasuryPoint[] = [];
  let preceding: TreasuryPoint | undefined;
  let lastTime = -Infinity;
  for (const point of points) {
    const time = Date.parse(point.at);
    if (time < start) {
      preceding = point;
      continue;
    }
    if (!visible.length && preceding && time > start) {
      visible.push({ ...preceding, at: from });
      lastTime = start;
    }
    if (lastTime === time) visible[visible.length - 1] = point;
    else visible.push(point);
    lastTime = time;
  }
  if (!visible.length && preceding) visible.push({ ...preceding, at: from });
  const chartPoint = ({ at, value, partial }: TreasuryPoint) => ({ at, value: partial ? null : value });
  const limit = Math.max(7, maxPoints);
  if (visible.length <= limit) return visible.map(chartPoint);

  // Allow two extrema per bucket and a gap before every retained point.
  const count = Math.floor((limit - 3) / 4);
  const buckets = Array.from({ length: count }, () => ({ low: -1, high: -1 }));
  const indices = new Set([0, visible.length - 1]);
  for (const [index, point] of visible.entries()) {
    if (point.partial) continue;
    const bucket = buckets[Math.floor(index * count / visible.length)];
    if (bucket.low < 0 || point.value < visible[bucket.low].value) bucket.low = index;
    if (bucket.high < 0 || point.value > visible[bucket.high].value) bucket.high = index;
  }
  for (const { low, high } of buckets) {
    if (low >= 0) indices.add(low);
    if (high >= 0) indices.add(high);
  }
  const sampled = [];
  let previous = -1;
  for (const index of [...indices].sort((a, b) => a - b)) {
    if (previous >= 0 && !visible[previous].partial && !visible[index].partial) {
      for (let skipped = previous + 1; skipped < index; skipped++) {
        if (visible[skipped].partial) {
          sampled.push(chartPoint(visible[skipped]));
          break;
        }
      }
    }
    sampled.push(chartPoint(visible[index]));
    previous = index;
  }
  return sampled;
}
