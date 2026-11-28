import React, { useMemo, useState } from "react";
import "./mobile-treasury.css";
import {
  isLocalMode,
  useEntities,
  put,
  putKey,
  remove,
  type AnyEntity as Entity,
  type Data,
} from "../../data/entities.ts";
import { useQuotes, searchQuotes, fetchQuotes } from "../../data/quotes.ts";
import { Icon } from "../../ui/Icon.tsx";
import { str, perform } from "../../ui/shared.tsx";
import { money } from "../finance-model.ts";
import {
  treasury,
  treasuryTrend,
  formatDecimal,
  type AssetTotal,
  type EntryChange,
  type TreasuryReport,
} from "../../../../../modules/treasury/index.ts";
import type { AssetKind, Quote, QuoteMatch } from "../../../../../packages/contracts/quotes.ts";
import {
  InkScreen,
  InkCard,
  InkSectionLabel,
  InkHairline,
  InkFigure,
  InkStatRow,
  InkMeter,
  InkSegmented,
  InkChipBar,
  InkEmpty,
  InkSheet,
  InkActionSheet,
  InkLineChart,
  MobileToolbar,
  MobileSubPage,
  InkNavIcon,
} from "./MobileKit.tsx";

/* ─────────────────────────── Domain & Formatting Helpers ─────────────────────────── */

type Unit = { currency: string; rate: number | null };
type RangeKey = "30" | "90" | "365" | "all";
type DetailRoute =
  | { kind: "asset"; id: string }
  | { kind: "wallet"; id: string }
  | { kind: "account"; id: string };

type SheetState =
  | { kind: "search"; assetKind: AssetKind }
  | { kind: "wallet"; entity?: Entity; mode: "plain" | "account" }
  | { kind: "asset"; entity: Entity }
  | { kind: "holding"; walletId?: string; assetId?: string; entity?: Entity }
  | { kind: "plainEntry"; walletId: string; initialMode?: "set" | "delta"; entity?: Entity }
  | { kind: "quickMove" }
  | null;

const CNY: Unit = { currency: "CNY", rate: 1 };
const SIGNS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  HKD: "HK$",
  EUR: "€",
  JPY: "JP¥",
  GBP: "£",
};
const RANGE_ITEMS: readonly { value: RangeKey; label: string }[] = [
  { value: "30", label: "30天" },
  { value: "90", label: "90天" },
  { value: "365", label: "一年" },
  { value: "all", label: "全部" },
];
const DECIMAL_RE = /^-?\d{1,18}(\.\d{1,12})?$/;
const UNSIGNED_DECIMAL_RE = /^\d{1,18}(\.\d{1,12})?$/;

const signOf = (currency: string) => SIGNS[currency] ?? currency + " ";
const isAccount = (w: Entity) =>
  w.data.category === "crypto" || w.data.category === "stock";

function showMoney(cents: bigint | null | undefined, unit: Unit = CNY): string {
  if (cents === null || cents === undefined) return "估值未知";
  if (unit.currency === "CNY" || !unit.rate) return money(cents);
  const value = Number(cents) / 100 / unit.rate;
  return (
    (value < 0 ? "−" : "") +
    signOf(unit.currency) +
    Math.abs(value).toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function showCompactCny(cents: bigint): string {
  const abs = cents < 0n ? -cents : cents;
  if (abs >= 1_000_000n) {
    const wan = Number(cents) / 100 / 10_000;
    return `¥${wan.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}万`;
  }
  return money(cents);
}

function showQty(n: bigint | null | undefined): string {
  if (n === null || n === undefined) return "未知";
  return Number(formatDecimal(n)).toLocaleString("zh-CN", {
    maximumFractionDigits: 8,
  });
}

function showUnitPrice(priceStr: string): string {
  const n = Number(priceStr);
  if (!Number.isFinite(n)) return priceStr;
  return n.toLocaleString("zh-CN", {
    maximumFractionDigits: Math.abs(n) < 1 ? 6 : 2,
  });
}

function formatMonthDay(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function toLocalDateTimeInput(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return toLocalDateTimeInput(new Date().toISOString());
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function fromLocalDateTimeInput(val: string): string {
  const d = new Date(val);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function assetBadgeText(asset: Entity): string {
  const symbol = str(asset, "symbol").trim();
  if (/[A-Za-z]/.test(symbol)) return symbol.slice(0, 4).toUpperCase();
  return str(asset, "name").slice(0, 2);
}

function formatDeltaEntry(
  entry: Entity,
  change: EntryChange | undefined,
  unitName: string,
  plainWallet: boolean,
): { title: string; sub: string; figure: string; tone: "up" | "down" | "muted" | "normal" } {
  const set = entry.data.mode === "set";
  const raw = str(entry, "quantity");
  const negative = raw.startsWith("-");
  const absRaw = negative ? raw.slice(1) : raw;
  const reason = str(entry, "reason");
  const timeText = formatDateTime(str(entry, "at"));
  const suffix = unitName ? " " + unitName : "";

  if (set && change && change.delta !== null) {
    const delta = change.delta;
    const afterText = formatDecimal(change.after, 12);
    const deltaAbs = formatDecimal(delta < 0n ? -delta : delta, 12);
    if (delta > 0n) {
      return {
        title: reason || (plainWallet ? `增加 ${deltaAbs} 元` : ""),
        sub: `${timeText} · 余额 ${afterText}${suffix}`,
        figure: `+${deltaAbs}`,
        tone: "up",
      };
    }
    if (delta < 0n) {
      return {
        title: reason || (plainWallet ? `减少 ${deltaAbs} 元` : ""),
        sub: `${timeText} · 余额 ${afterText}${suffix}`,
        figure: `-${deltaAbs}`,
        tone: "down",
      };
    }
    return {
      title: reason || (plainWallet ? "余额未变" : ""),
      sub: `${timeText} · 余额未变（${afterText}${suffix}）`,
      figure: "0",
      tone: "muted",
    };
  }

  if (set) {
    return {
      title: reason || (plainWallet ? `初始设为 ${raw} 元` : ""),
      sub: plainWallet ? timeText : `${timeText} · 初始设定`,
      figure: `= ${raw}`,
      tone: "normal",
    };
  }

  return {
    title: reason || (plainWallet ? (negative ? `减少 ${absRaw} 元` : `增加 ${absRaw} 元`) : ""),
    sub: timeText,
    figure: (negative ? "" : "+") + raw,
    tone: negative ? "down" : "up",
  };
}

/* ─────────────────────────── Main Export ─────────────────────────── */

export function MobileTreasury() {
  const { entities } = useEntities("wallet", "walletEntry", "asset", "assetPrice");
  const { prices, wallets, entries, assets } = useMemo(
    () => ({
      prices: entities.filter((e) => e.type === "assetPrice"),
      wallets: entities.filter((e) => e.type === "wallet"),
      entries: entities.filter((e) => e.type === "walletEntry"),
      assets: entities
        .filter((e) => e.type === "asset")
        .sort(
          (a, b) =>
            Number(a.data.order ?? 0) - Number(b.data.order ?? 0) ||
            str(a, "name").localeCompare(str(b, "name")),
        ),
    }),
    [entities],
  );

  const quoteIds = useMemo(
    () => assets.map((a) => str(a, "quoteId")).filter(Boolean),
    [assets],
  );
  const { quotes, statusOf, accept } = useQuotes(quoteIds);
  const recentlyUpdated = quoteIds.filter((id) =>
    ["市场报价", "最近获取"].includes(statusOf(id)),
  ).length;
  const quoteOf = (a: Entity): Quote | undefined => quotes[str(a, "quoteId")];
  const livePrices = useMemo(
    () =>
      Object.fromEntries(
        assets.map((a) => [a.id, quotes[str(a, "quoteId")]?.priceCNY]),
      ),
    [assets, quotes],
  );

  const now = useMemo(() => new Date().toISOString(), [wallets, assets, entries, prices, livePrices]);
  const report = useMemo(
    () => treasury({ wallets, assets, entries, prices, live: livePrices, now }),
    [wallets, assets, entries, prices, livePrices, now],
  );

  const unitOf = (a: Entity): Unit => {
    const q = quoteOf(a);
    return q && Number(q.price) > 0
      ? { currency: q.currency, rate: Number(q.priceCNY) / Number(q.price) }
      : CNY;
  };

  const unitOfAll = (list: Entity[]): Unit => {
    const units = list.map(unitOf);
    return units.length &&
      units.every((u) => u.currency === units[0].currency && u.rate)
      ? units[0]
      : CNY;
  };

  const [range, setRange] = useState<RangeKey>("90");
  const [detail, setDetail] = useState<DetailRoute | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => {
      setToast((cur) => (cur === msg ? "" : cur));
    }, 2800);
  }

  async function recordPrices() {
    if (refreshing) return;
    if (isLocalMode()) {
      showToast("仅本机模式暂不支持联网行情，可在标的详情手动维护参考价");
      return;
    }
    if (!quoteIds.length) {
      showToast("还没有绑定行情的标的");
      return;
    }
    setRefreshing(true);
    try {
      const result = await fetchQuotes(quoteIds);
      accept(result);
      const quoted = assets.filter((a) => result.quotes[str(a, "quoteId")]);
      await Promise.all(
        quoted.map((a) => {
          const { at, priceCNY: price } = result.quotes[str(a, "quoteId")];
          return putKey("assetPrice", a.id + ":" + at, {
            assetId: a.id,
            at,
            price,
          });
        }),
      );
      showToast(
        quoted.length
          ? `已记录 ${quoted.length} 个标的的最新价格`
          : "行情暂时取不到，稍后再试",
      );
    } catch {
      showToast("行情暂时取不到，稍后再试");
    } finally {
      setRefreshing(false);
    }
  }

  const plainWallets = useMemo(
    () => wallets.filter((w) => !isAccount(w)),
    [wallets],
  );
  const accounts = useMemo(() => wallets.filter(isAccount), [wallets]);
  const cnyWallets = useMemo(
    () => plainWallets.filter((w) => w.data.category === "cny"),
    [plainWallets],
  );
  const externalWallets = useMemo(
    () => plainWallets.filter((w) => w.data.category === "external"),
    [plainWallets],
  );
  const cryptoAssets = useMemo(
    () => assets.filter((a) => a.data.kind === "crypto"),
    [assets],
  );
  const stockAssets = useMemo(
    () => assets.filter((a) => a.data.kind === "stock"),
    [assets],
  );

  const sumBig = (values: (bigint | null | undefined)[]) =>
    values.reduce<bigint>((n, v) => n + (v ?? 0n), 0n);

  const cnyTotal = sumBig(cnyWallets.map((w) => report.wallets[w.id]?.value));
  const externalTotal = sumBig(
    externalWallets.map((w) => report.wallets[w.id]?.value),
  );
  const cryptoTotal = sumBig(
    cryptoAssets.map((a) => report.assets[a.id]?.value),
  );
  const stockTotal = sumBig(stockAssets.map((a) => report.assets[a.id]?.value));

  const shareOf = (part: bigint) =>
    report.total > 0n ? Number((part * 1000n) / report.total) / 1000 : 0;

  const lastEntryAt = (walletId: string) =>
    entries
      .filter((e) => e.data.walletId === walletId)
      .reduce((at, e) => (str(e, "at") > at ? str(e, "at") : at), "");

  const heldIn = (walletId: string) =>
    assets.filter((a) => report.assets[a.id]?.byWallet[walletId] !== undefined);

  const breakdownItems = useMemo(() => {
    const all = [
      { label: "人民币现金", value: cnyTotal, hasItems: cnyWallets.length > 0 },
      { label: "股票", value: stockTotal, hasItems: stockAssets.length > 0 },
      { label: "加密资产", value: cryptoTotal, hasItems: cryptoAssets.length > 0 },
      { label: "外部投资", value: externalTotal, hasItems: externalWallets.length > 0 },
    ];
    const nonZero = all.filter((x) => x.value !== 0n || x.hasItems);
    const chosen = nonZero.length > 0 ? nonZero : all.slice(0, 3);
    return chosen.map((x) => ({
      label: x.label,
      value: showCompactCny(x.value),
    }));
  }, [
    cnyTotal,
    stockTotal,
    cryptoTotal,
    externalTotal,
    cnyWallets.length,
    stockAssets.length,
    cryptoAssets.length,
    externalWallets.length,
  ]);

  const activeAsset =
    detail?.kind === "asset"
      ? assets.find((a) => a.id === detail.id)
      : undefined;
  const activeWallet =
    detail?.kind === "wallet"
      ? wallets.find((w) => w.id === detail.id)
      : undefined;
  const activeAccount =
    detail?.kind === "account"
      ? wallets.find((w) => w.id === detail.id)
      : undefined;

  return (
    <InkScreen>
      {/* Root Toolbar (automatically yields when a MobileSubPage is open) */}
      <MobileToolbar>
        <span className={refreshing ? "mt-spin" : ""}>
          <InkNavIcon
            icon="sync"
            label="刷新行情并记录价格"
            onClick={() => void recordPrices()}
          />
        </span>
        <InkNavIcon
          icon="plus"
          label="添加"
          onClick={() => setAddMenuOpen(true)}
        />
      </MobileToolbar>

      {/* Pushed Detail SubPages */}
      {detail?.kind === "asset" && activeAsset ? (
        <AssetDetailView
          asset={activeAsset}
          wallets={wallets}
          accounts={accounts}
          entries={entries}
          prices={prices}
          livePrices={livePrices}
          quote={quoteOf(activeAsset)}
          quoteStatus={
            str(activeAsset, "quoteId")
              ? statusOf(str(activeAsset, "quoteId"))
              : undefined
          }
          unit={unitOf(activeAsset)}
          onBack={() => setDetail(null)}
          onHolding={(walletId, entity) =>
            setSheet({ kind: "holding", walletId, assetId: activeAsset.id, entity })
          }
          onEditAsset={() => setSheet({ kind: "asset", entity: activeAsset })}
          onNewAccount={() => setSheet({ kind: "wallet", mode: "account" })}
        />
      ) : detail?.kind === "wallet" && activeWallet ? (
        <WalletDetailView
          wallet={activeWallet}
          entries={entries}
          onBack={() => setDetail(null)}
          onAddEntry={(initialMode) =>
            setSheet({
              kind: "plainEntry",
              walletId: activeWallet.id,
              initialMode,
            })
          }
          onEditEntry={(entity) =>
            setSheet({
              kind: "plainEntry",
              walletId: activeWallet.id,
              entity,
            })
          }
          onEditWallet={() =>
            setSheet({ kind: "wallet", entity: activeWallet, mode: "plain" })
          }
        />
      ) : detail?.kind === "account" && activeAccount ? (
        <AccountDetailView
          account={activeAccount}
          assets={assets}
          entries={entries}
          prices={prices}
          livePrices={livePrices}
          quoteOf={quoteOf}
          unitOf={unitOf}
          unitOfAll={unitOfAll}
          onBack={() => setDetail(null)}
          onHolding={(assetId, entity) =>
            setSheet({
              kind: "holding",
              walletId: activeAccount.id,
              assetId,
              entity,
            })
          }
          onOpenAsset={(assetId) => setDetail({ kind: "asset", id: assetId })}
          onEditAccount={() =>
            setSheet({ kind: "wallet", entity: activeAccount, mode: "account" })
          }
        />
      ) : (
        /* Root Treasury View */
        <>
          {/* 1. Net Worth Hero Card */}
          <ValueHeroCard
            title="全部资产"
            report={report}
            range={range}
            onRangeChange={setRange}
            note={
              quoteIds.length
                ? `${recentlyUpdated}/${quoteIds.length} 个标的近期更新`
                : "账本估值"
            }
            breakdown={breakdownItems}
          />

          {/* 2. 标的持仓 (Assets: Crypto & Stock) */}
          <InkSectionLabel
            title="标的持仓"
            aside={`${assets.length} 个标的`}
          />

          {(
            [
              { kind: "crypto" as const, title: "加密资产", list: cryptoAssets, total: cryptoTotal, icon: "sparkles" },
              { kind: "stock" as const, title: "股票", list: stockAssets, total: stockTotal, icon: "metrics" },
            ] as const
          ).map((group) => {
            const groupUnit = unitOfAll(group.list);
            const share = shareOf(group.total);
            return (
              <InkCard key={group.kind}>
                <div className="mt-card-head">
                  <span className="mt-card-title">
                    <Icon name={group.icon} size={16} />
                    <span>{group.title}</span>
                  </span>
                  {group.list.length > 0 && (
                    <span className="mt-card-meta">
                      {(share * 100).toFixed(1)}%
                    </span>
                  )}
                </div>

                {group.list.length === 0 ? (
                  <button
                    type="button"
                    className="mt-add-row-btn"
                    onClick={() =>
                      setSheet({ kind: "search", assetKind: group.kind })
                    }
                  >
                    <Icon name="plus" size={15} />
                    <span>添加第一个标的</span>
                  </button>
                ) : (
                  <>
                    <div className="mt-group-sum">
                      <strong>{showMoney(group.total, groupUnit)}</strong>
                      {groupUnit.currency !== "CNY" && (
                        <small>≈ {money(group.total)}</small>
                      )}
                    </div>
                    <InkMeter progress={share} />
                    <div className="mt-list">
                      {group.list.map((asset, idx) => {
                        const aTotal = report.assets[asset.id];
                        const q = quoteOf(asset);
                        const aUnit = unitOf(asset);
                        const wCount = Object.keys(aTotal?.byWallet ?? {}).length;
                        const symbol = str(asset, "symbol");
                        return (
                          <React.Fragment key={asset.id}>
                            {idx > 0 && <InkHairline inset={44} />}
                            <button
                              type="button"
                              className="mk-row"
                              onClick={() =>
                                setDetail({ kind: "asset", id: asset.id })
                              }
                            >
                              <span className="mt-asset-badge">
                                {assetBadgeText(asset)}
                              </span>
                              <span className="mk-row-main">
                                <span className="mk-row-title clamp-1">
                                  {str(asset, "name")}
                                </span>
                                <span className="mt-sub-inline">
                                  <span>
                                    {showQty(aTotal?.quantity)}
                                    {symbol ? ` ${symbol}` : ""}
                                    {wCount > 1 ? ` · ${wCount} 个钱包` : ""}
                                  </span>
                                  {q?.changePercent !== undefined && (
                                    <span
                                      className={
                                        q.changePercent >= 0
                                          ? "mt-up"
                                          : "mt-down"
                                      }
                                    >
                                      {q.changePercent >= 0 ? "+" : ""}
                                      {q.changePercent.toFixed(2)}%
                                    </span>
                                  )}
                                </span>
                              </span>
                              <span className="mk-row-right">
                                <span
                                  className={
                                    "mk-row-val" +
                                    (aTotal?.value == null ? " mt-muted" : "")
                                  }
                                >
                                  {showMoney(aTotal?.value, aUnit)}
                                </span>
                                <span className="mk-row-chevron">
                                  <Icon name="chevron-right" size={14} />
                                </span>
                              </span>
                            </button>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </>
                )}
              </InkCard>
            );
          })}

          {/* 3. 现金与账户 (Plain Wallets + Exchange/Brokerage Accounts) */}
          <InkSectionLabel
            title="现金与账户"
            aside={`${wallets.length} 个钱包`}
          />

          {(
            [
              { key: "cny", title: "人民币", list: cnyWallets, total: cnyTotal, icon: "expenses" },
              { key: "external", title: "外部投资", list: externalWallets, total: externalTotal, icon: "folder" },
            ] as const
          ).map((group) => {
            if (group.list.length === 0) return null;
            const share = shareOf(group.total);
            return (
              <InkCard key={group.key}>
                <div className="mt-card-head">
                  <span className="mt-card-title">
                    <Icon name={group.icon} size={16} />
                    <span>{group.title}</span>
                  </span>
                  <span className="mt-card-meta">
                    {(share * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="mt-group-sum">
                  <strong>{money(group.total)}</strong>
                </div>
                <InkMeter progress={share} />
                <div className="mt-list">
                  {group.list.map((wallet, idx) => {
                    const last = lastEntryAt(wallet.id);
                    const val = report.wallets[wallet.id]?.value;
                    return (
                      <React.Fragment key={wallet.id}>
                        {idx > 0 && <InkHairline />}
                        <button
                          type="button"
                          className="mk-row"
                          onClick={() =>
                            setDetail({ kind: "wallet", id: wallet.id })
                          }
                        >
                          <span className="mk-row-main">
                            <span className="mk-row-title clamp-1">
                              {str(wallet, "name")}
                            </span>
                            <span className="mk-row-sub">
                              {last ? `${formatMonthDay(last)} 更新` : "还没有记录"}
                            </span>
                          </span>
                          <span className="mk-row-right">
                            <span
                              className={
                                "mk-row-val" +
                                (val == null ? " mt-muted" : "")
                              }
                            >
                              {showMoney(val)}
                            </span>
                            <span className="mk-row-chevron">
                              <Icon name="chevron-right" size={14} />
                            </span>
                          </span>
                        </button>
                      </React.Fragment>
                    );
                  })}
                </div>
              </InkCard>
            );
          })}

          {plainWallets.length === 0 && (
            <InkCard>
              <div className="mt-card-head">
                <span className="mt-card-title">
                  <Icon name="expenses" size={16} />
                  <span>人民币 / 外部投资</span>
                </span>
              </div>
              <button
                type="button"
                className="mt-add-row-btn"
                onClick={() => setSheet({ kind: "wallet", mode: "plain" })}
              >
                <Icon name="plus" size={15} />
                <span>添加人民币钱包</span>
              </button>
            </InkCard>
          )}

          {/* Exchange / Brokerage Accounts */}
          <InkCard>
            <div className="mt-card-head">
              <span className="mt-card-title">
                <Icon name="treasury" size={16} />
                <span>交易所 / 券商账户</span>
              </span>
              {accounts.length > 0 && (
                <span className="mt-card-meta">{accounts.length}</span>
              )}
            </div>
            {accounts.length > 0 && (
              <div className="mt-list">
                {accounts.map((wallet, idx) => {
                  const held = heldIn(wallet.id);
                  const heldText = held.length
                    ? held
                        .map((a) => {
                          const s = str(a, "symbol");
                          return /[A-Za-z]/.test(s) ? s : str(a, "name");
                        })
                        .join(" · ")
                    : "暂无持仓";
                  const val = report.wallets[wallet.id]?.value;
                  return (
                    <React.Fragment key={wallet.id}>
                      {idx > 0 && <InkHairline />}
                      <button
                        type="button"
                        className="mk-row"
                        onClick={() =>
                          setDetail({ kind: "account", id: wallet.id })
                        }
                      >
                        <span className="mk-row-main">
                          <span className="mk-row-title clamp-1">
                            {str(wallet, "name")}
                          </span>
                          <span className="mk-row-sub">{heldText}</span>
                        </span>
                        <span className="mk-row-right">
                          <span
                            className={
                              "mk-row-val" + (val == null ? " mt-muted" : "")
                            }
                          >
                            {showMoney(val, unitOfAll(held))}
                          </span>
                          <span className="mk-row-chevron">
                            <Icon name="chevron-right" size={14} />
                          </span>
                        </span>
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              className="mt-add-row-btn"
              onClick={() => setSheet({ kind: "wallet", mode: "account" })}
            >
              <Icon name="plus" size={15} />
              <span>添加交易所 / 钱包 / 券商</span>
            </button>
          </InkCard>

          <p className="mt-foot-note">
            加密与股票以标的为主体，数量是所有钱包的合计；估值变化含价格与汇率，不等同投资收益。
          </p>
        </>
      )}

      {/* Action Sheet for Top-Right `+` */}
      <InkActionSheet
        open={addMenuOpen}
        title="国库操作"
        onClose={() => setAddMenuOpen(false)}
        items={[
          {
            label: "记一笔变动",
            icon: "edit",
            onClick: () => setSheet({ kind: "quickMove" }),
          },
          {
            label: "新建标的（股票 / 加密）",
            icon: "metrics",
            onClick: () => setSheet({ kind: "search", assetKind: "stock" }),
          },
          {
            label: "新建账户（交易所 / 券商）",
            icon: "treasury",
            onClick: () => setSheet({ kind: "wallet", mode: "account" }),
          },
          {
            label: "新建现金 / 外部投资钱包",
            icon: "expenses",
            onClick: () => setSheet({ kind: "wallet", mode: "plain" }),
          },
        ]}
      />

      {/* Sheets */}
      {sheet?.kind === "quickMove" && (
        <QuickMoveSheet
          plainWallets={plainWallets}
          accounts={accounts}
          assets={assets}
          onClose={() => setSheet(null)}
          onPickPlain={(walletId) =>
            setSheet({ kind: "plainEntry", walletId })
          }
          onPickHolding={(walletId, assetId) =>
            setSheet({ kind: "holding", walletId, assetId })
          }
          onCreatePlainWallet={() =>
            setSheet({ kind: "wallet", mode: "plain" })
          }
          onCreateAccount={() =>
            setSheet({ kind: "wallet", mode: "account" })
          }
        />
      )}

      {sheet?.kind === "search" && (
        <AssetSearchSheet
          initialKind={sheet.assetKind}
          existingQuoteIds={assets.map((a) => str(a, "quoteId")).filter(Boolean)}
          assetCount={assets.length}
          onClose={() => setSheet(null)}
          onCreated={(id) => {
            setSheet(null);
            setDetail({ kind: "asset", id });
          }}
        />
      )}

      {sheet?.kind === "wallet" && (
        <WalletFormSheet
          entity={sheet.entity}
          mode={sheet.mode}
          onClose={() => setSheet(null)}
          onSaved={(id, isAcc) => {
            setSheet(null);
            setDetail({ kind: isAcc ? "account" : "wallet", id });
          }}
          onDeleted={() => {
            setSheet(null);
            setDetail(null);
          }}
        />
      )}

      {sheet?.kind === "asset" && (
        <AssetEditSheet
          entity={sheet.entity}
          onClose={() => setSheet(null)}
          onDeleted={() => {
            setSheet(null);
            setDetail(null);
          }}
        />
      )}

      {sheet?.kind === "holding" && (
        <HoldingFormSheet
          accounts={accounts}
          assets={assets}
          report={report}
          initialWalletId={sheet.walletId}
          initialAssetId={sheet.assetId}
          entity={sheet.entity}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === "plainEntry" && (
        <PlainEntrySheet
          walletId={sheet.walletId}
          wallet={wallets.find((w) => w.id === sheet.walletId)}
          currentBalance={report.wallets[sheet.walletId]?.quantity}
          hasEntries={entries.some((e) => e.data.walletId === sheet.walletId)}
          initialMode={sheet.initialMode}
          entity={sheet.entity}
          onClose={() => setSheet(null)}
        />
      )}

      {toast && (
        <div className="mk-undo-toast" role="status">
          <span>{toast}</span>
        </div>
      )}
    </InkScreen>
  );
}

/* ─────────────────────────── Shared Hero & Chart Card ─────────────────────────── */

function ValueHeroCard({
  title,
  report,
  range,
  onRangeChange,
  note,
  unit = CNY,
  breakdown,
  actions,
}: {
  title: string;
  report: TreasuryReport;
  range: RangeKey;
  onRangeChange: (next: RangeKey) => void;
  note?: string;
  unit?: Unit;
  breakdown?: { label: string; value: string }[];
  actions?: React.ReactNode;
}) {
  const from = useMemo(() => {
    if (range === "all") return "";
    return new Date(Date.now() - Number(range) * 86_400_000).toISOString();
  }, [range, report.points]);

  const rate = unit.rate ?? 1;
  const chartPoints = useMemo(
    () =>
      treasuryTrend(report.points, from, 180).map((p) => ({
        x: p.at,
        y: p.value === null ? null : Number(p.value) / 100 / rate,
        label: formatMonthDay(p.at),
      })),
    [report.points, from, rate],
  );

  const firstY = chartPoints[0]?.y;
  const lastY = chartPoints.at(-1)?.y;
  const change =
    chartPoints.length > 1 && firstY != null && lastY != null
      ? lastY - firstY
      : null;

  const formatChartVal = (v: number) =>
    (v < 0 ? "−" : "") +
    signOf(unit.currency) +
    Math.abs(v).toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <InkCard>
      <div className="mt-hero-eyebrow">
        {title} · {unit.currency === "CNY" ? "折合人民币" : `以${unit.currency}计价`}
        {note ? ` · ${note}` : ""}
      </div>

      <InkFigure value={showMoney(report.total, unit)} size="lg" />

      {unit.currency !== "CNY" && (
        <div className="mt-hero-subval">≈ {money(report.total)}</div>
      )}

      {(change !== null || report.unknown > 0) && (
        <div className="mt-change-row">
          {change !== null && (
            <>
              <span className={change >= 0 ? "mt-up" : "mt-down"}>
                {change >= 0 ? "+" : "−"}
                {signOf(unit.currency)}
                {Math.abs(change).toLocaleString("zh-CN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span>{range === "all" ? "全部时间" : `近 ${range} 天`}</span>
            </>
          )}
          {report.unknown > 0 && <span>· {report.unknown} 项估值未知</span>}
        </div>
      )}

      {breakdown && breakdown.length > 0 && (
        <>
          <InkHairline />
          {breakdown.length === 4 ? (
            <>
              <InkStatRow items={breakdown.slice(0, 2)} />
              <InkHairline />
              <InkStatRow items={breakdown.slice(2, 4)} />
            </>
          ) : (
            <InkStatRow items={breakdown} />
          )}
        </>
      )}

      {chartPoints.filter((p) => p.y !== null).length > 1 && (
        <>
          <InkHairline />
          <InkLineChart
            points={chartPoints}
            label="估值走势"
            formatValue={formatChartVal}
            height={128}
          />
        </>
      )}

      <InkChipBar
        items={RANGE_ITEMS}
        value={range}
        onChange={onRangeChange}
        size="sm"
      />

      {actions}
    </InkCard>
  );
}

/* ─────────────────────────── SubPage 1: Asset Detail ─────────────────────────── */

function AssetDetailView({
  asset,
  wallets,
  accounts,
  entries,
  prices,
  livePrices,
  quote,
  quoteStatus,
  unit,
  onBack,
  onHolding,
  onEditAsset,
  onNewAccount,
}: {
  asset: Entity;
  wallets: Entity[];
  accounts: Entity[];
  entries: Entity[];
  prices: Entity[];
  livePrices: Record<string, string | undefined>;
  quote: Quote | undefined;
  quoteStatus?: string;
  unit: Unit;
  onBack: () => void;
  onHolding: (walletId?: string, entity?: Entity) => void;
  onEditAsset: () => void;
  onNewAccount: () => void;
}) {
  const [range, setRange] = useState<RangeKey>("90");
  const [flowLimit, setFlowLimit] = useState(50);

  const assetEntries = useMemo(
    () => entries.filter((e) => e.data.assetId === asset.id),
    [entries, asset.id],
  );
  const now = useMemo(() => new Date().toISOString(), [assetEntries, prices, livePrices]);
  const scoped = useMemo(
    () =>
      treasury({
        wallets,
        assets: [asset],
        entries: assetEntries,
        prices,
        live: livePrices,
        now,
      }),
    [wallets, asset, assetEntries, prices, livePrices, now],
  );

  const total: AssetTotal | undefined = scoped.assets[asset.id];
  const symbol = str(asset, "symbol");
  const holders = useMemo(
    () =>
      Object.entries(total?.byWallet ?? {}).sort((a, b) =>
        b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0,
      ),
    [total],
  );
  const otherAccounts = useMemo(
    () => accounts.filter((w) => total?.byWallet[w.id] === undefined),
    [accounts, total],
  );
  const orderedEntries = useMemo(
    () =>
      [...assetEntries].sort(
        (a, b) => str(b, "at").localeCompare(str(a, "at")) || b.id.localeCompare(a.id),
      ),
    [assetEntries],
  );

  const priceDisplay = quote
    ? signOf(quote.currency) + showUnitPrice(quote.price)
    : total?.price != null
      ? "¥" + showUnitPrice(formatDecimal(total.price, 6))
      : "未知";

  const changeDisplay =
    quote?.changePercent !== undefined
      ? (quote.changePercent >= 0 ? "+" : "") + quote.changePercent.toFixed(2) + "%"
      : "—";
  const changeTone: "normal" | "live" | "danger" =
    quote?.changePercent === undefined
      ? "normal"
      : quote.changePercent >= 0
        ? "live"
        : "danger";

  const walletName = (id: unknown) =>
    str(wallets.find((w) => w.id === id), "name", "已删除钱包");

  return (
    <MobileSubPage
      title={str(asset, "name")}
      onBack={onBack}
      right={
        <>
          <InkNavIcon
            icon="plus"
            label="记录持仓"
            onClick={() => onHolding(otherAccounts[0]?.id ?? accounts[0]?.id)}
          />
          <InkNavIcon
            icon="sliders"
            label="编辑标的"
            onClick={onEditAsset}
          />
        </>
      }
    >
      <ValueHeroCard
        title={str(asset, "name")}
        report={scoped}
        range={range}
        onRangeChange={setRange}
        note={quoteStatus ?? "账本估值"}
        unit={unit}
      />

      <InkCard>
        <InkStatRow
          items={[
            { label: "总数量", value: showQty(total?.quantity) },
            { label: "现价", value: priceDisplay },
            { label: "涨跌", value: changeDisplay, tone: changeTone },
          ]}
        />
      </InkCard>

      <InkSectionLabel
        title="来自哪些钱包"
        aside={holders.length ? `${holders.length} 个` : undefined}
      />
      <InkCard>
        {holders.length > 0 ? (
          <div className="mt-list">
            {holders.map(([walletId, q], idx) => {
              const part =
                total && total.quantity > 0n
                  ? Number((q * 1000n) / total.quantity) / 1000
                  : 0;
              const val =
                total?.price != null
                  ? (q * total.price * 100n) / 10n ** 24n
                  : null;
              return (
                <React.Fragment key={walletId}>
                  {idx > 0 && <InkHairline />}
                  <button
                    type="button"
                    className="mt-holding-row"
                    onClick={() => onHolding(walletId)}
                  >
                    <span className="mt-holding-top">
                      <span className="mt-holding-name">
                        {walletName(walletId)}
                      </span>
                      <span className="mt-holding-val">
                        {showMoney(val, unit)}
                      </span>
                    </span>
                    <InkMeter progress={part} />
                    <span className="mt-holding-meta">
                      {showQty(q)}
                      {symbol ? ` ${symbol}` : ""} · {(part * 100).toFixed(1)}%
                    </span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        ) : (
          <InkEmpty text="还没有钱包持有该标的" />
        )}

        {accounts.length > 0 ? (
          <button
            type="button"
            className="mt-add-row-btn"
            onClick={() => onHolding(otherAccounts[0]?.id ?? accounts[0]?.id)}
          >
            <Icon name="plus" size={15} />
            <span>在钱包中添加 / 调整持仓</span>
          </button>
        ) : (
          <button
            type="button"
            className="mt-add-row-btn"
            onClick={onNewAccount}
          >
            <Icon name="plus" size={15} />
            <span>先新建交易所 / 券商账户</span>
          </button>
        )}
      </InkCard>

      <InkSectionLabel title="流水" aside="点一条可纠正" />
      <InkCard>
        {orderedEntries.length > 0 ? (
          <div className="mt-list">
            {orderedEntries.slice(0, flowLimit).map((entry, idx) => {
              const info = formatDeltaEntry(
                entry,
                scoped.entryChanges[entry.id],
                symbol,
                false,
              );
              const wName = walletName(entry.data.walletId);
              const titleText = info.title ? `${wName} · ${info.title}` : wName;
              return (
                <React.Fragment key={entry.id}>
                  {idx > 0 && <InkHairline />}
                  <button
                    type="button"
                    className="mk-row"
                    onClick={() => onHolding(str(entry, "walletId"), entry)}
                  >
                    <span className="mk-row-main">
                      <span className="mk-row-title clamp-1">{titleText}</span>
                      <span className="mk-row-sub">{info.sub}</span>
                    </span>
                    <span className="mk-row-right">
                      <span
                        className={
                          "mk-row-val" +
                          (info.tone === "up"
                            ? " mt-up"
                            : info.tone === "down"
                              ? " mt-down"
                              : info.tone === "muted"
                                ? " mt-muted"
                                : "")
                        }
                      >
                        {info.figure}
                      </span>
                    </span>
                  </button>
                </React.Fragment>
              );
            })}
            {orderedEntries.length > flowLimit && (
              <>
                <InkHairline />
                <button
                  type="button"
                  className="mt-add-row-btn"
                  onClick={() => setFlowLimit((n) => n + 50)}
                >
                  查看更多流水（余 {orderedEntries.length - flowLimit} 条）
                </button>
              </>
            )}
          </div>
        ) : (
          <InkEmpty text="还没有记录" />
        )}
      </InkCard>
    </MobileSubPage>
  );
}

/* ─────────────────────────── SubPage 2: Plain Wallet Detail ─────────────────────────── */

function WalletDetailView({
  wallet,
  entries,
  onBack,
  onAddEntry,
  onEditEntry,
  onEditWallet,
}: {
  wallet: Entity;
  entries: Entity[];
  onBack: () => void;
  onAddEntry: (mode: "set" | "delta") => void;
  onEditEntry: (entry: Entity) => void;
  onEditWallet: () => void;
}) {
  const [range, setRange] = useState<RangeKey>("90");
  const [flowLimit, setFlowLimit] = useState(50);

  const walletEntries = useMemo(
    () => entries.filter((e) => e.data.walletId === wallet.id),
    [entries, wallet.id],
  );
  const now = useMemo(() => new Date().toISOString(), [walletEntries]);
  const scoped = useMemo(
    () =>
      treasury({
        wallets: [wallet],
        assets: [],
        entries: walletEntries,
        now,
      }),
    [wallet, walletEntries, now],
  );

  const orderedEntries = useMemo(
    () =>
      [...walletEntries].sort(
        (a, b) => str(b, "at").localeCompare(str(a, "at")) || b.id.localeCompare(a.id),
      ),
    [walletEntries],
  );

  return (
    <MobileSubPage
      title={str(wallet, "name")}
      onBack={onBack}
      right={
        <>
          <InkNavIcon
            icon="sliders"
            label="编辑账户"
            onClick={onEditWallet}
          />
          <InkNavIcon
            icon="plus"
            label="记录变化"
            onClick={() => onAddEntry(walletEntries.length ? "delta" : "set")}
          />
        </>
      }
    >
      <ValueHeroCard
        title={str(wallet, "name")}
        report={scoped}
        range={range}
        onRangeChange={setRange}
        actions={
          <div className="mt-quick-actions">
            <button
              type="button"
              className="mk-pill solid"
              onClick={() => onAddEntry("set")}
            >
              校准余额
            </button>
            <button
              type="button"
              className="mk-pill"
              onClick={() => onAddEntry("delta")}
            >
              增减变动
            </button>
          </div>
        }
      />

      <InkCard>
        <InkStatRow
          items={[
            { label: "数量", value: showQty(scoped.wallets[wallet.id]?.quantity) },
            { label: "单价", value: str(wallet, "unitPrice") || "—" },
            { label: "汇率", value: str(wallet, "exchangeRate") || "—" },
          ]}
        />
      </InkCard>

      <InkSectionLabel title="流水 · 点一条可纠正" aside={`${orderedEntries.length} 条`} />
      <InkCard>
        {orderedEntries.length > 0 ? (
          <div className="mt-list">
            {orderedEntries.slice(0, flowLimit).map((entry, idx) => {
              const info = formatDeltaEntry(
                entry,
                scoped.entryChanges[entry.id],
                "元",
                true,
              );
              return (
                <React.Fragment key={entry.id}>
                  {idx > 0 && <InkHairline />}
                  <button
                    type="button"
                    className="mk-row"
                    onClick={() => onEditEntry(entry)}
                  >
                    <span className="mk-row-main">
                      <span className="mk-row-title clamp-1">{info.title}</span>
                      <span className="mk-row-sub">{info.sub}</span>
                    </span>
                    <span className="mk-row-right">
                      <span
                        className={
                          "mk-row-val" +
                          (info.tone === "up"
                            ? " mt-up"
                            : info.tone === "down"
                              ? " mt-down"
                              : info.tone === "muted"
                                ? " mt-muted"
                                : "")
                        }
                      >
                        {info.figure}
                      </span>
                    </span>
                  </button>
                </React.Fragment>
              );
            })}
            {orderedEntries.length > flowLimit && (
              <>
                <InkHairline />
                <button
                  type="button"
                  className="mt-add-row-btn"
                  onClick={() => setFlowLimit((n) => n + 50)}
                >
                  查看更多流水（余 {orderedEntries.length - flowLimit} 条）
                </button>
              </>
            )}
          </div>
        ) : (
          <InkEmpty text="还没有记录变化" />
        )}
      </InkCard>
    </MobileSubPage>
  );
}

/* ─────────────────────────── SubPage 3: Exchange/Brokerage Account Detail ─────────────────────────── */

function AccountDetailView({
  account,
  assets,
  entries,
  prices,
  livePrices,
  quoteOf,
  unitOf,
  unitOfAll,
  onBack,
  onHolding,
  onOpenAsset,
  onEditAccount,
}: {
  account: Entity;
  assets: Entity[];
  entries: Entity[];
  prices: Entity[];
  livePrices: Record<string, string | undefined>;
  quoteOf: (a: Entity) => Quote | undefined;
  unitOf: (a: Entity) => Unit;
  unitOfAll: (list: Entity[]) => Unit;
  onBack: () => void;
  onHolding: (assetId?: string, entity?: Entity) => void;
  onOpenAsset: (assetId: string) => void;
  onEditAccount: () => void;
}) {
  const [range, setRange] = useState<RangeKey>("90");
  const [flowLimit, setFlowLimit] = useState(50);

  const accountEntries = useMemo(
    () => entries.filter((e) => e.data.walletId === account.id),
    [entries, account.id],
  );
  const now = useMemo(() => new Date().toISOString(), [accountEntries, prices, livePrices]);
  const scoped = useMemo(
    () =>
      treasury({
        wallets: [account],
        assets,
        entries: accountEntries,
        prices,
        live: livePrices,
        now,
      }),
    [account, assets, accountEntries, prices, livePrices, now],
  );

  const heldAssets = useMemo(
    () =>
      assets.filter(
        (a) => scoped.assets[a.id]?.byWallet[account.id] !== undefined,
      ),
    [assets, scoped, account.id],
  );

  const orderedEntries = useMemo(
    () =>
      [...accountEntries].sort(
        (a, b) => str(b, "at").localeCompare(str(a, "at")) || b.id.localeCompare(a.id),
      ),
    [accountEntries],
  );

  return (
    <MobileSubPage
      title={str(account, "name")}
      onBack={onBack}
      right={
        <>
          <InkNavIcon
            icon="sliders"
            label="编辑账户"
            onClick={onEditAccount}
          />
          <InkNavIcon
            icon="plus"
            label="设定持仓"
            onClick={() => onHolding(undefined)}
          />
        </>
      }
    >
      <ValueHeroCard
        title={str(account, "name")}
        report={scoped}
        range={range}
        onRangeChange={setRange}
        unit={unitOfAll(heldAssets)}
      />

      <InkSectionLabel title="持仓 · 点一项可调整" aside={`${heldAssets.length} 个`} />
      <InkCard>
        {heldAssets.length > 0 ? (
          <div className="mt-list">
            {heldAssets.map((asset, idx) => {
              const qty = scoped.assets[asset.id]?.byWallet[account.id] ?? 0n;
              const price = scoped.assets[asset.id]?.price;
              const val =
                price != null ? (qty * price * 100n) / 10n ** 24n : null;
              const q = quoteOf(asset);
              const symbol = str(asset, "symbol");
              return (
                <React.Fragment key={asset.id}>
                  {idx > 0 && <InkHairline inset={44} />}
                  <button
                    type="button"
                    className="mk-row"
                    onClick={() => onHolding(asset.id)}
                  >
                    <span
                      className="mt-asset-badge"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenAsset(asset.id);
                      }}
                    >
                      {assetBadgeText(asset)}
                    </span>
                    <span className="mk-row-main">
                      <span className="mk-row-title clamp-1">
                        {str(asset, "name")}
                      </span>
                      <span className="mt-sub-inline">
                        <span>
                          {showQty(qty)}
                          {symbol ? ` ${symbol}` : ""}
                        </span>
                        {q?.changePercent !== undefined && (
                          <span
                            className={
                              q.changePercent >= 0 ? "mt-up" : "mt-down"
                            }
                          >
                            {q.changePercent >= 0 ? "+" : ""}
                            {q.changePercent.toFixed(2)}%
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="mk-row-right">
                      <span className="mk-row-val">
                        {showMoney(val, unitOf(asset))}
                      </span>
                      <span className="mk-row-chevron">
                        <Icon name="chevron-right" size={14} />
                      </span>
                    </span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        ) : (
          <InkEmpty text="这个账户还没有持仓" />
        )}
        <button
          type="button"
          className="mt-add-row-btn"
          onClick={() => onHolding(undefined)}
        >
          <Icon name="plus" size={15} />
          <span>设定一个标的的数量</span>
        </button>
      </InkCard>

      <InkSectionLabel title="流水" aside="点一条可纠正" />
      <InkCard>
        {orderedEntries.length > 0 ? (
          <div className="mt-list">
            {orderedEntries.slice(0, flowLimit).map((entry, idx) => {
              const asset = assets.find((a) => a.id === entry.data.assetId);
              const symbol = asset ? str(asset, "symbol") : "";
              const aName = asset ? str(asset, "name") : "标的";
              const info = formatDeltaEntry(
                entry,
                scoped.entryChanges[entry.id],
                symbol,
                false,
              );
              const titleText = info.title ? `${aName} · ${info.title}` : aName;
              return (
                <React.Fragment key={entry.id}>
                  {idx > 0 && <InkHairline />}
                  <button
                    type="button"
                    className="mk-row"
                    onClick={() =>
                      onHolding(
                        entry.data.assetId ? str(entry, "assetId") : undefined,
                        entry,
                      )
                    }
                  >
                    <span className="mk-row-main">
                      <span className="mk-row-title clamp-1">{titleText}</span>
                      <span className="mk-row-sub">{info.sub}</span>
                    </span>
                    <span className="mk-row-right">
                      <span
                        className={
                          "mk-row-val" +
                          (info.tone === "up"
                            ? " mt-up"
                            : info.tone === "down"
                              ? " mt-down"
                              : info.tone === "muted"
                                ? " mt-muted"
                                : "")
                        }
                      >
                        {info.figure}
                      </span>
                    </span>
                  </button>
                </React.Fragment>
              );
            })}
            {orderedEntries.length > flowLimit && (
              <>
                <InkHairline />
                <button
                  type="button"
                  className="mt-add-row-btn"
                  onClick={() => setFlowLimit((n) => n + 50)}
                >
                  查看更多流水（余 {orderedEntries.length - flowLimit} 条）
                </button>
              </>
            )}
          </div>
        ) : (
          <InkEmpty text="还没有记录" />
        )}
      </InkCard>
    </MobileSubPage>
  );
}

/* ─────────────────────────── Bottom Sheets ─────────────────────────── */

function QuickMoveSheet({
  plainWallets,
  accounts,
  assets,
  onClose,
  onPickPlain,
  onPickHolding,
  onCreatePlainWallet,
  onCreateAccount,
}: {
  plainWallets: Entity[];
  accounts: Entity[];
  assets: Entity[];
  onClose: () => void;
  onPickPlain: (walletId: string) => void;
  onPickHolding: (walletId?: string, assetId?: string) => void;
  onCreatePlainWallet: () => void;
  onCreateAccount: () => void;
}) {
  return (
    <InkSheet open title="记一笔变动" onClose={onClose} leftLabel="关闭">
      <InkSectionLabel title="现金 / 外部投资钱包" />
      <div className="mk-form-group">
        {plainWallets.length > 0 ? (
          plainWallets.map((w) => (
            <button
              key={w.id}
              type="button"
              className="mt-search-result"
              onClick={() => onPickPlain(w.id)}
            >
              <span className="mk-row-main">
                <span className="mk-row-title clamp-1">{str(w, "name")}</span>
                <span className="mk-row-sub">
                  {w.data.category === "cny" ? "人民币" : "外部投资"}
                </span>
              </span>
              <span className="mk-row-chevron">
                <Icon name="chevron-right" size={14} />
              </span>
            </button>
          ))
        ) : (
          <button
            type="button"
            className="mt-search-result"
            onClick={onCreatePlainWallet}
          >
            <span className="mk-row-title">＋ 先新建人民币钱包</span>
          </button>
        )}
      </div>

      <InkSectionLabel title="交易所 / 券商持仓" />
      <div className="mk-form-group">
        {accounts.length > 0 && assets.length > 0 ? (
          <button
            type="button"
            className="mt-search-result"
            onClick={() => onPickHolding(accounts[0].id, assets[0].id)}
          >
            <span className="mk-row-main">
              <span className="mk-row-title">设定或增减标的持仓</span>
              <span className="mk-row-sub">
                {accounts.length} 个账户 · {assets.length} 个标的
              </span>
            </span>
            <span className="mk-row-chevron">
              <Icon name="chevron-right" size={14} />
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="mt-search-result"
            onClick={onCreateAccount}
          >
            <span className="mk-row-title">＋ 先新建交易所 / 券商账户</span>
          </button>
        )}
      </div>
    </InkSheet>
  );
}

function AssetSearchSheet({
  initialKind,
  existingQuoteIds,
  assetCount,
  onClose,
  onCreated,
}: {
  initialKind: AssetKind;
  existingQuoteIds: string[];
  assetCount: number;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [kind, setKind] = useState<AssetKind>(initialKind);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QuoteMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manualPrice, setManualPrice] = useState("");

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError("");
    try {
      setResults(await searchQuotes(q, kind));
    } catch {
      setError("行情服务暂时不可用，可以先手动添加。");
    } finally {
      setBusy(false);
    }
  }

  async function addMatch(match: QuoteMatch) {
    const id = await put("asset", {
      name: match.name,
      symbol: match.symbol,
      kind: match.kind,
      quoteId: match.quoteId,
      currency: match.currency,
      order: assetCount,
    });
    void fetchQuotes([match.quoteId]).catch(() => undefined);
    onCreated(id);
  }

  async function addManual() {
    const name = query.trim();
    if (!name) return;
    const data: Data = { name, kind, order: assetCount };
    const price = manualPrice.trim();
    if (price) {
      if (!UNSIGNED_DECIMAL_RE.test(price)) {
        setError("备用价格需为非负数字");
        return;
      }
      data.manualPrice = price;
    }
    const id = await put("asset", data);
    onCreated(id);
  }

  return (
    <InkSheet open title="添加标的" onClose={onClose}>
      <InkSegmented
        onCard
        options={[
          { value: "stock" as const, label: "股票 / 基金" },
          { value: "crypto" as const, label: "加密货币" },
        ]}
        value={kind}
        onChange={(next) => {
          setKind(next);
          setResults(null);
          setError("");
        }}
      />

      <form className="mt-search-bar" onSubmit={(e) => void runSearch(e)}>
        <input
          type="text"
          className="mk-field-input"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            kind === "stock"
              ? "英伟达、NVDA、小米、00700"
              : "Bitcoin、ETH、SOL"
          }
        />
        <button
          type="submit"
          className="mk-pill solid"
          disabled={busy || !query.trim()}
        >
          {busy ? "…" : "搜索"}
        </button>
      </form>

      {error && <div className="mt-warn-note">{error}</div>}

      {results && (
        <>
          <InkSectionLabel title="搜索结果" aside={`${results.length} 项`} />
          <div className="mk-form-group">
            {results.length > 0 ? (
              results.map((match) => {
                const added = existingQuoteIds.includes(match.quoteId);
                return (
                  <button
                    key={match.quoteId}
                    type="button"
                    className="mt-search-result"
                    disabled={added}
                    onClick={() => void addMatch(match)}
                  >
                    <span className="mk-row-main">
                      <span className="mk-row-title clamp-1">{match.name}</span>
                      <span className="mk-row-sub">
                        {match.symbol} · {match.market} · {match.currency}
                      </span>
                    </span>
                    <span className="mk-pill sm">
                      {added ? "已添加" : "添加"}
                    </span>
                  </button>
                );
              })
            ) : (
              <InkEmpty text="没有找到，换个写法试试或下方手动添加" />
            )}
          </div>
        </>
      )}

      {query.trim() && (
        <>
          <InkSectionLabel title="手动添加" />
          <div className="mk-form-group">
            <div className="mk-form-row">
              <span className="mk-form-label">备用价 (¥)</span>
              <input
                type="text"
                inputMode="decimal"
                className="mk-form-input right"
                placeholder="可选，稍后也可填写"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            className="mk-pill full"
            onClick={() => void addManual()}
          >
            手动添加「{query.trim()}」
          </button>
        </>
      )}
    </InkSheet>
  );
}

function WalletFormSheet({
  entity,
  mode,
  onClose,
  onSaved,
  onDeleted,
}: {
  entity?: Entity;
  mode: "plain" | "account";
  onClose: () => void;
  onSaved: (id: string, isAcc: boolean) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(entity ? str(entity, "name") : "");
  const [category, setCategory] = useState<string>(
    entity
      ? str(entity, "category")
      : mode === "plain"
        ? "cny"
        : "crypto",
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const canSave = name.trim().length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const isAcc = category === "crypto" || category === "stock";
      const base: Data = entity
        ? { ...entity.data }
        : isAcc
          ? { currency: "CNY" }
          : {
              currency: "CNY",
              asset: category === "cny" ? "人民币" : "",
              unitPrice: "1",
              exchangeRate: "1",
            };
      base.name = name.trim();
      base.category = category;
      if (!base.currency) base.currency = "CNY";
      const id = await put("wallet", base, entity);
      onSaved(id, isAcc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setSaving(false);
    }
  }

  const categoryOptions =
    mode === "plain"
      ? [
          { value: "cny", label: "人民币" },
          { value: "external", label: "外部投资" },
        ]
      : [
          { value: "crypto", label: "加密资产" },
          { value: "stock", label: "股票券商" },
        ];

  return (
    <InkSheet
      open
      title={
        entity
          ? "编辑账户"
          : mode === "plain"
            ? "新建现金钱包"
            : "新建交易所 / 券商"
      }
      onClose={onClose}
      rightLabel={saving ? "保存中…" : "保存"}
      rightDisabled={!canSave}
      onRight={() => void save()}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">名称</span>
          <input
            type="text"
            className="mk-form-input right"
            autoFocus={!entity}
            placeholder={
              mode === "plain"
                ? "如 招行、支付宝、余额宝"
                : "如 币安、OKX、冷钱包、富途"
            }
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="mk-form-row col">
          <span className="mk-form-label">
            {mode === "plain" ? "类别" : "主要持有"}
          </span>
          <InkSegmented
            options={categoryOptions}
            value={category}
            onChange={setCategory}
          />
        </div>
      </div>

      {error && <div className="mt-form-error">{error}</div>}

      {entity && (
        <div className="mt-danger-zone">
          {confirmDelete ? (
            <div className="mt-confirm-row">
              <button
                type="button"
                className="mk-pill"
                onClick={() => setConfirmDelete(false)}
              >
                保留
              </button>
              <button
                type="button"
                className="mk-pill danger"
                onClick={() => {
                  perform(remove(entity).then(() => onDeleted()));
                }}
              >
                确认移入回收站
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="mk-pill danger full"
              onClick={() => setConfirmDelete(true)}
            >
              移入回收站
            </button>
          )}
        </div>
      )}
    </InkSheet>
  );
}

function AssetEditSheet({
  entity,
  onClose,
  onDeleted,
}: {
  entity: Entity;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(str(entity, "name"));
  const [symbol, setSymbol] = useState(str(entity, "symbol"));
  const [manualPrice, setManualPrice] = useState(str(entity, "manualPrice"));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const priceTrimmed = manualPrice.trim();
  const priceValid = !priceTrimmed || UNSIGNED_DECIMAL_RE.test(priceTrimmed);
  const canSave = name.trim().length > 0 && priceValid && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const next: Data = {
        ...entity.data,
        name: name.trim(),
        symbol: symbol.trim(),
      };
      if (priceTrimmed) {
        next.manualPrice = priceTrimmed;
      } else {
        delete next.manualPrice;
      }
      await put("asset", next, entity);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setSaving(false);
    }
  }

  return (
    <InkSheet
      open
      title="编辑标的"
      onClose={onClose}
      rightLabel={saving ? "保存中…" : "保存"}
      rightDisabled={!canSave}
      onRight={() => void save()}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">名称</span>
          <input
            type="text"
            className="mk-form-input right"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">代码</span>
          <input
            type="text"
            className="mk-form-input right"
            placeholder="如 BTC、NVDA"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">备用价 (¥)</span>
          <input
            type="text"
            inputMode="decimal"
            className="mk-form-input right"
            placeholder="行情不可用时使用"
            value={manualPrice}
            onChange={(e) => setManualPrice(e.target.value)}
          />
        </div>
      </div>

      {!priceValid && (
        <div className="mt-form-error">备用价格需为非负数字，最多 12 位小数</div>
      )}
      {error && <div className="mt-form-error">{error}</div>}

      <div className="mt-danger-zone">
        {confirmDelete ? (
          <div className="mt-confirm-row">
            <button
              type="button"
              className="mk-pill"
              onClick={() => setConfirmDelete(false)}
            >
              保留
            </button>
            <button
              type="button"
              className="mk-pill danger"
              onClick={() => {
                perform(remove(entity).then(() => onDeleted()));
              }}
            >
              确认移入回收站
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="mk-pill danger full"
            onClick={() => setConfirmDelete(true)}
          >
            移入回收站
          </button>
        )}
      </div>
    </InkSheet>
  );
}

function HoldingFormSheet({
  accounts,
  assets,
  report,
  initialWalletId,
  initialAssetId,
  entity,
  onClose,
}: {
  accounts: Entity[];
  assets: Entity[];
  report: TreasuryReport;
  initialWalletId?: string;
  initialAssetId?: string;
  entity?: Entity;
  onClose: () => void;
}) {
  const [walletId, setWalletId] = useState(
    entity ? str(entity, "walletId") : initialWalletId ?? accounts[0]?.id ?? "",
  );
  const [assetId, setAssetId] = useState(
    entity ? str(entity, "assetId") : initialAssetId ?? assets[0]?.id ?? "",
  );
  const [mode, setMode] = useState<"set" | "delta">(
    entity ? (entity.data.mode === "delta" ? "delta" : "set") : "set",
  );

  const initialQty = (() => {
    if (entity) {
      const raw = str(entity, "quantity");
      return raw.startsWith("-") ? raw.slice(1) : raw;
    }
    if (walletId && assetId) {
      const cur = report.assets[assetId]?.byWallet[walletId];
      if (cur !== undefined) return formatDecimal(cur, 12);
    }
    return "";
  })();

  const [negative, setNegative] = useState(
    entity ? str(entity, "quantity").startsWith("-") : false,
  );
  const [quantity, setQuantity] = useState(initialQty);
  const [reason, setReason] = useState(entity ? str(entity, "reason") : "");
  const [atLocal, setAtLocal] = useState(() =>
    toLocalDateTimeInput(entity ? str(entity, "at") : new Date().toISOString()),
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const currentHolding =
    walletId && assetId ? report.assets[assetId]?.byWallet[walletId] : undefined;

  const finalQty = (() => {
    const t = quantity.trim();
    if (!t) return "";
    if (t.startsWith("-") || t.startsWith("+")) return t.replace(/^\+/, "");
    return mode === "delta" && negative ? "-" + t : t;
  })();

  const valid =
    Boolean(walletId) &&
    Boolean(assetId) &&
    DECIMAL_RE.test(finalQty) &&
    !saving;

  async function save() {
    if (!valid) return;
    setSaving(true);
    setError("");
    try {
      const data: Data = entity ? { ...entity.data } : {};
      data.walletId = walletId;
      data.assetId = assetId;
      data.mode = mode;
      data.quantity = finalQty;
      data.at = fromLocalDateTimeInput(atLocal);
      if (reason.trim()) {
        data.reason = reason.trim();
      } else {
        delete data.reason;
      }
      if (!entity) {
        const price = report.assets[assetId]?.price;
        if (price != null) {
          data.unitPrice = formatDecimal(price, 12);
          data.exchangeRate = "1";
        }
      }
      await put("walletEntry", data, entity);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setSaving(false);
    }
  }

  return (
    <InkSheet
      open
      title={entity ? "纠正持仓记录" : "持仓变动"}
      onClose={onClose}
      rightLabel={saving ? "保存中…" : "保存"}
      rightDisabled={!valid}
      onRight={() => void save()}
    >
      <InkSegmented
        onCard
        options={[
          { value: "set" as const, label: "设定数量" },
          { value: "delta" as const, label: "增加 / 减少" },
        ]}
        value={mode}
        onChange={(next) => {
          setMode(next);
          if (next === "set") setNegative(false);
        }}
      />

      <div className="mt-big-amount-box">
        <div className="mt-big-amount-row">
          {mode === "delta" && (
            <button
              type="button"
              className={"mt-sign-btn " + (negative ? "minus" : "plus")}
              aria-label={negative ? "减少（点击切换为增加）" : "增加（点击切换为减少）"}
              onClick={() => setNegative((v) => !v)}
            >
              {negative ? "−" : "+"}
            </button>
          )}
          <input
            type="text"
            inputMode="decimal"
            className="mt-big-amount-input"
            autoFocus={!entity}
            placeholder={mode === "set" ? "现在持有多少" : "变动数量"}
            value={quantity}
            onChange={(e) => {
              const v = e.target.value;
              if (mode === "delta" && v.startsWith("-")) {
                setNegative(true);
                setQuantity(v.slice(1));
              } else if (mode === "delta" && v.startsWith("+")) {
                setNegative(false);
                setQuantity(v.slice(1));
              } else {
                setQuantity(v);
              }
            }}
          />
        </div>
        {currentHolding !== undefined && (
          <div className="mt-big-amount-hint">
            当前持有 {showQty(currentHolding)}
          </div>
        )}
      </div>

      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">钱包</span>
          <select
            className="mk-form-select"
            value={walletId}
            onChange={(e) => setWalletId(e.target.value)}
          >
            <option value="">请选择</option>
            {accounts.map((w) => (
              <option key={w.id} value={w.id}>
                {str(w, "name")}
              </option>
            ))}
          </select>
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">标的</span>
          <select
            className="mk-form-select"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
          >
            <option value="">请选择</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {str(a, "name")} {str(a, "symbol")}
              </option>
            ))}
          </select>
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">说明</span>
          <input
            type="text"
            className="mk-form-input right"
            placeholder="可选"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">时间</span>
          <input
            type="datetime-local"
            className="mk-form-input mt-datetime-input"
            value={atLocal}
            onChange={(e) => setAtLocal(e.target.value)}
          />
        </div>
      </div>

      {error && <div className="mt-form-error">{error}</div>}

      {entity && (
        <div className="mt-danger-zone">
          {confirmDelete ? (
            <div className="mt-confirm-row">
              <button
                type="button"
                className="mk-pill"
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="mk-pill danger"
                onClick={() => {
                  perform(remove(entity).then(() => onClose()));
                }}
              >
                确认删除
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="mk-pill danger full"
              onClick={() => setConfirmDelete(true)}
            >
              删除这条记录
            </button>
          )}
        </div>
      )}
    </InkSheet>
  );
}

function PlainEntrySheet({
  walletId,
  wallet,
  currentBalance,
  hasEntries,
  initialMode,
  entity,
  onClose,
}: {
  walletId: string;
  wallet?: Entity;
  currentBalance?: bigint | null;
  hasEntries: boolean;
  initialMode?: "set" | "delta";
  entity?: Entity;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"set" | "delta">(() => {
    if (entity) return entity.data.mode === "set" ? "set" : "delta";
    if (initialMode) return initialMode;
    return hasEntries ? "delta" : "set";
  });

  const [negative, setNegative] = useState(
    entity ? str(entity, "quantity").startsWith("-") : false,
  );
  const [quantity, setQuantity] = useState(() => {
    if (!entity) return "";
    const raw = str(entity, "quantity");
    return raw.startsWith("-") ? raw.slice(1) : raw;
  });
  const [reason, setReason] = useState(entity ? str(entity, "reason") : "");
  const [atLocal, setAtLocal] = useState(() =>
    toLocalDateTimeInput(entity ? str(entity, "at") : new Date().toISOString()),
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const finalQty = (() => {
    const t = quantity.trim();
    if (!t) return "";
    if (t.startsWith("-") || t.startsWith("+")) return t.replace(/^\+/, "");
    return mode === "delta" && negative ? "-" + t : t;
  })();

  const valid = DECIMAL_RE.test(finalQty) && !saving;

  async function save() {
    if (!valid) return;
    setSaving(true);
    setError("");
    try {
      const data: Data = entity ? { ...entity.data } : {};
      data.walletId = walletId;
      data.mode = mode;
      data.quantity = finalQty;
      data.at = fromLocalDateTimeInput(atLocal);
      if (reason.trim()) {
        data.reason = reason.trim();
      } else {
        delete data.reason;
      }
      delete data.assetId;
      await put("walletEntry", data, entity);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setSaving(false);
    }
  }

  return (
    <InkSheet
      open
      title={entity ? "纠正记录" : `${str(wallet, "name", "钱包")} · 变动`}
      onClose={onClose}
      rightLabel={saving ? "保存中…" : "保存"}
      rightDisabled={!valid}
      onRight={() => void save()}
    >
      <InkSegmented
        onCard
        options={[
          { value: "set" as const, label: "校准余额" },
          { value: "delta" as const, label: "增加 / 减少" },
        ]}
        value={mode}
        onChange={(next) => {
          setMode(next);
          if (next === "set") setNegative(false);
        }}
      />

      <div className="mt-big-amount-box">
        <div className="mt-big-amount-row">
          {mode === "delta" && (
            <button
              type="button"
              className={"mt-sign-btn " + (negative ? "minus" : "plus")}
              aria-label={negative ? "减少（点击切换为增加）" : "增加（点击切换为减少）"}
              onClick={() => setNegative((v) => !v)}
            >
              {negative ? "−" : "+"}
            </button>
          )}
          <input
            type="text"
            inputMode="decimal"
            className="mt-big-amount-input"
            autoFocus={!entity}
            placeholder={mode === "set" ? "现在的余额" : "变动金额"}
            value={quantity}
            onChange={(e) => {
              const v = e.target.value;
              if (mode === "delta" && v.startsWith("-")) {
                setNegative(true);
                setQuantity(v.slice(1));
              } else if (mode === "delta" && v.startsWith("+")) {
                setNegative(false);
                setQuantity(v.slice(1));
              } else {
                setQuantity(v);
              }
            }}
          />
        </div>
        {currentBalance != null && (
          <div className="mt-big-amount-hint">
            当前余额 ¥{showQty(currentBalance)}
          </div>
        )}
      </div>

      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">说明</span>
          <input
            type="text"
            className="mk-form-input right"
            placeholder="可选"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">时间</span>
          <input
            type="datetime-local"
            className="mk-form-input mt-datetime-input"
            value={atLocal}
            onChange={(e) => setAtLocal(e.target.value)}
          />
        </div>
      </div>

      {error && <div className="mt-form-error">{error}</div>}

      {entity && (
        <div className="mt-danger-zone">
          {confirmDelete ? (
            <div className="mt-confirm-row">
              <button
                type="button"
                className="mk-pill"
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="mk-pill danger"
                onClick={() => {
                  perform(remove(entity).then(() => onClose()));
                }}
              >
                确认删除
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="mk-pill danger full"
              onClick={() => setConfirmDelete(true)}
            >
              删除这条记录
            </button>
          )}
        </div>
      )}
    </InkSheet>
  );
}
