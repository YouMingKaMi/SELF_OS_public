import React, { useMemo, useState } from "react";
import "./treasury.css";
import { useEntities, put, remove, type AnyEntity as Entity } from "../data/entities.ts";
import { useQuotes, searchQuotes, fetchQuotes } from "../data/quotes.ts";
import { Heading, Panel, Empty, RecordForm, Stats, Chart, str, perform } from "../ui/shared.tsx";
import { money } from "./finance-model.ts";
import { treasury, formatDecimal } from "../../../../modules/treasury/index.ts";
import type { AssetKind, Quote, QuoteMatch } from "../../../../packages/contracts/quotes.ts";

type Selection =
  | { kind: "all" }
  | { kind: "group"; key: Group }
  | { kind: "wallet"; id: string }
  | { kind: "asset"; id: string };
type Group = "crypto" | "stock" | "cny" | "external" | "accounts";
const groupNames: Record<Group, string> = {
  crypto: "加密资产",
  stock: "股票",
  cny: "人民币",
  external: "外部投资",
  accounts: "钱包与账户",
};
/** Exchange and brokerage wallets hold assets; 人民币 and 外部投资 wallets hold one balance. */
const isAccount = (w: Entity) => w.data.category === "crypto" || w.data.category === "stock";

/** A display currency and how many yuan one unit is worth (null when unknown). */
type Unit = { currency: string; rate: number | null };
const CNY: Unit = { currency: "CNY", rate: 1 };
const signs: Record<string, string> = { CNY: "¥", USD: "$", HKD: "HK$", EUR: "€", JPY: "JP¥", GBP: "£" };
const sign = (currency: string) => signs[currency] ?? currency + " ";
/** Yuan cents shown in `unit`. Overall totals stay in yuan; a single market shows its own currency. */
function show(cents: bigint | null | undefined, unit: Unit = CNY) {
  if (cents === null || cents === undefined) return "估值未知";
  if (unit.currency === "CNY" || !unit.rate) return money(cents);
  const value = Number(cents) / 100 / unit.rate;
  return (
    (value < 0 ? "−" : "") +
    sign(unit.currency) +
    Math.abs(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}
const qty = (n: bigint | null | undefined) => (n === null || n === undefined ? "未知" : Number(formatDecimal(n)).toLocaleString("zh-CN", { maximumFractionDigits: 8 }));
const day = (iso: string) => new Date(iso).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
const pct = (n: number | undefined) =>
  n === undefined ? null : <span className={n >= 0 ? "up" : "down"}>{(n >= 0 ? "+" : "") + n.toFixed(2)}%</span>;

export function Treasury() {
  const { entities } = useEntities("wallet", "walletEntry", "asset", "assetPrice");
  const prices = entities.filter((e) => e.type === "assetPrice");
  const wallets = entities.filter((e) => e.type === "wallet");
  const entries = entities.filter((e) => e.type === "walletEntry");
  const assets = entities
    .filter((e) => e.type === "asset")
    .sort((a, b) => Number(a.data.order ?? 0) - Number(b.data.order ?? 0) || str(a, "name").localeCompare(str(b, "name")));
  const { quotes, live, setQuotes } = useQuotes(assets.map((a) => str(a, "quoteId")).filter(Boolean));
  const quoteOf = (a: Entity): Quote | undefined => quotes[str(a, "quoteId")];
  const livePrices = useMemo(
    () => Object.fromEntries(assets.map((a) => [a.id, quotes[str(a, "quoteId")]?.priceCNY])),
    [assets, quotes],
  );
  const now = new Date().toISOString();
  const report = useMemo(
    () => treasury({ wallets, assets, entries, prices, live: livePrices, now }),
    [wallets, assets, entries, prices, livePrices],
  );
  /** An asset's own market currency, when a live quote tells us the rate. */
  const unitOf = (a: Entity): Unit => {
    const q = quoteOf(a);
    return q && Number(q.price) > 0 ? { currency: q.currency, rate: Number(q.priceCNY) / Number(q.price) } : CNY;
  };
  /** A set of assets shares a currency only if every one of them is quoted in it. */
  const unitOfAll = (list: Entity[]): Unit => {
    const units = list.map(unitOf);
    return units.length && units.every((u) => u.currency === units[0].currency && u.rate) ? units[0] : CNY;
  };

  const [sel, setSel] = useState<Selection>({ kind: "all" });
  const [days, setDays] = useState("90");
  const [modal, setModal] = useState<
    | { kind: "wallet"; entity?: Entity; category: string }
    | { kind: "asset"; entity?: Entity }
    | { kind: "search" }
    | { kind: "entry"; walletId: string; assetId?: string; entity?: Entity }
    | null
  >(null);
  const close = () => setModal(null);
  // One click: fetch fresh quotes and keep one price observation per quoted asset, so history follows the market.
  const [refreshing, setRefreshing] = useState("");
  async function recordPrices() {
    setRefreshing("正在刷新…");
    try {
      const fresh = await fetchQuotes(assets.map((a) => str(a, "quoteId")).filter(Boolean));
      setQuotes((old) => ({ ...old, ...fresh }));
      const at = new Date().toISOString();
      const quoted = assets.filter((a) => fresh[str(a, "quoteId")]);
      await Promise.all(quoted.map((a) => put("assetPrice", { assetId: a.id, at, price: fresh[str(a, "quoteId")].priceCNY })));
      setRefreshing(`已记录 ${quoted.length} 个标的的价格`);
    } catch {
      setRefreshing("行情暂时取不到");
    }
    setTimeout(() => setRefreshing(""), 2500);
  }

  const plain = wallets.filter((w) => !isAccount(w));
  const accounts = wallets.filter(isAccount);
  const assetsOf = (kind: AssetKind) => assets.filter((a) => a.data.kind === kind);
  const heldIn = (walletId: string) => assets.filter((a) => report.assets[a.id]?.byWallet[walletId] !== undefined);
  const walletsHolding = (assetId: string) => Object.keys(report.assets[assetId]?.byWallet ?? {}).length;
  const lastEntry = (walletId: string) =>
    entries.filter((e) => e.data.walletId === walletId).reduce((at, e) => (str(e, "at") > at ? str(e, "at") : at), "");
  const sum = (values: (bigint | null | undefined)[]) => values.reduce<bigint>((n, v) => n + (v ?? 0n), 0n);
  const groupValue: Record<Group, bigint> = {
    crypto: sum(assetsOf("crypto").map((a) => report.assets[a.id]?.value)),
    stock: sum(assetsOf("stock").map((a) => report.assets[a.id]?.value)),
    cny: sum(plain.filter((w) => w.data.category === "cny").map((w) => report.wallets[w.id]?.value)),
    external: sum(plain.filter((w) => w.data.category === "external").map((w) => report.wallets[w.id]?.value)),
    accounts: sum(accounts.map((w) => report.wallets[w.id]?.value)),
  };
  const share = (part: bigint) => (report.total > 0n ? Number((part * 1000n) / report.total) / 10 : 0);

  // The selection decides what the hero, chart and flow describe, and in which currency.
  const scope = useMemo(() => {
    if (sel.kind === "asset") {
      const a = assets.find((x) => x.id === sel.id);
      return { name: a ? str(a, "name") : "标的", unit: a ? unitOf(a) : CNY, filter: (e: Entity) => e.data.assetId === sel.id, wallets, assets: a ? [a] : [] };
    }
    if (sel.kind === "wallet") {
      const w = wallets.find((x) => x.id === sel.id);
      return {
        name: w ? str(w, "name") : "钱包",
        unit: w && isAccount(w) ? unitOfAll(heldIn(w.id)) : CNY,
        filter: (e: Entity) => e.data.walletId === sel.id,
        wallets: w ? [w] : [],
        assets,
      };
    }
    if (sel.kind === "group") {
      const name = groupNames[sel.key];
      if (sel.key === "crypto" || sel.key === "stock") {
        const list = assetsOf(sel.key);
        return { name, unit: unitOfAll(list), filter: (e: Entity) => list.some((a) => a.id === e.data.assetId), wallets, assets: list };
      }
      const list = sel.key === "accounts" ? accounts : plain.filter((w) => w.data.category === sel.key);
      return { name, unit: CNY, filter: (e: Entity) => list.some((w) => w.id === e.data.walletId), wallets: list, assets };
    }
    return { name: "全部资产", unit: CNY, filter: () => true, wallets, assets };
  }, [sel, wallets, assets, quotes, report]);
  const scoped = useMemo(
    () => treasury({ wallets: scope.wallets, assets: scope.assets, entries: entries.filter(scope.filter), prices, live: livePrices, now }),
    [scope, entries, livePrices],
  );
  const from = days === "all" ? "" : new Date(Date.now() - Number(days) * 86400000).toISOString();
  const toUnit = (cents: bigint) => Number(cents) / 100 / (scope.unit.rate ?? 1);
  const points = scoped.points.filter((p) => p.at >= from).map((p) => ({ x: p.at, y: toUnit(p.value) }));
  const change = points.length > 1 ? points[points.length - 1].y - points[0].y : null;
  const flow = entries.filter(scope.filter).sort((a, b) => str(b, "at").localeCompare(str(a, "at")));
  const walletName = (id: unknown) => str(wallets.find((w) => w.id === id), "name", "已删除钱包");
  const assetOf = (id: unknown) => assets.find((a) => a.id === id);

  const selectedAsset = sel.kind === "asset" ? assets.find((a) => a.id === sel.id) : undefined;
  const selectedWallet = sel.kind === "wallet" ? wallets.find((w) => w.id === sel.id) : undefined;

  const row = (key: string, active: boolean, onClick: () => void, title: React.ReactNode, meta: React.ReactNode, value: string) => (
    <button key={key} className={"asset-wallet" + (active ? " selected" : "")} onClick={onClick}>
      <span className="row-main">
        <span>{title}</span>
        <small>{meta}</small>
      </span>
      <span className="mono">{value}</span>
    </button>
  );
  const groupHeader = (key: Group, count: string, unit: Unit = CNY) => (
    <button
      className={"asset-category" + (sel.kind === "group" && sel.key === key ? " selected" : "")}
      onClick={() => setSel({ kind: "group", key })}
    >
      <span className="row-main">
        <strong>{groupNames[key]}</strong>
        <small>
          {count}
          {key === "accounts" ? "" : ` · 占 ${share(groupValue[key]).toFixed(1)}%`}
        </small>
      </span>
      <strong className="mono">{show(groupValue[key], unit)}</strong>
      {key !== "accounts" && <i className="share" style={{ "--value": share(groupValue[key]) / 100 } as React.CSSProperties} />}
    </button>
  );

  return (
    <>
      <Heading
        eyebrow="TREASURY · YOUR RESOURCES"
        title="国库"
        description="加密与股票以标的为主体，跨钱包累加；人民币按钱包。总额折合人民币，单一市场按其本币显示。"
      >
        <button onClick={() => setModal({ kind: "wallet", category: "cny" })}>＋ 人民币钱包</button>
        <button onClick={() => setModal({ kind: "wallet", category: "crypto" })}>＋ 交易所 / 券商</button>
        <button className="primary" onClick={() => setModal({ kind: "search" })}>
          ＋ 添加标的
        </button>
      </Heading>
      <div className="columns treasury">
        <Panel className="flush asset-tree" title="资产结构">
          <button className={"asset-root" + (sel.kind === "all" ? " selected" : "")} onClick={() => setSel({ kind: "all" })}>
            <span>全部资产 · 折合人民币</span>
            <strong>{money(report.total)}</strong>
          </button>
          {(["crypto", "stock"] as const).map((kind) => {
            const list = assetsOf(kind);
            return (
              <section key={kind} className="asset-group">
                {groupHeader(kind, `${list.length} 个标的`, unitOfAll(list))}
                {list.map((a) => {
                  const t = report.assets[a.id];
                  const n = walletsHolding(a.id);
                  return row(
                    a.id,
                    sel.kind === "asset" && sel.id === a.id,
                    () => setSel({ kind: "asset", id: a.id }),
                    <>
                      {str(a, "name")} <em className="ticker">{str(a, "symbol")}</em>
                    </>,
                    <>
                      {qty(t?.quantity)} {str(a, "symbol")}
                      {n > 0 ? ` · ${n} 个钱包` : " · 未持有"}
                      {quoteOf(a) && <> · {pct(quoteOf(a)!.changePercent)}</>}
                    </>,
                    show(t?.value, unitOf(a)),
                  );
                })}
                {!list.length && (
                  <button className="asset-wallet empty" onClick={() => setModal({ kind: "search" })}>
                    <span className="row-main">
                      <small>＋ 添加{kind === "crypto" ? "加密货币" : "股票"}</small>
                    </span>
                  </button>
                )}
              </section>
            );
          })}
          {(["cny", "external"] as const).map((category) => {
            const list = plain.filter((w) => w.data.category === category);
            if (!list.length) return null;
            return (
              <section key={category} className="asset-group">
                {groupHeader(category, `${list.length} 个钱包`)}
                {list.map((w) => {
                  const last = lastEntry(w.id);
                  return row(
                    w.id,
                    sel.kind === "wallet" && sel.id === w.id,
                    () => setSel({ kind: "wallet", id: w.id }),
                    str(w, "name"),
                    last ? `${day(last)} 更新` : "还没有记录",
                    show(report.wallets[w.id]?.value),
                  );
                })}
              </section>
            );
          })}
          <section className="asset-group">
            {groupHeader("accounts", `${accounts.length} 个 · 已计入上方标的`)}
            {accounts.map((w) => {
              const held = heldIn(w.id);
              return row(
                w.id,
                sel.kind === "wallet" && sel.id === w.id,
                () => setSel({ kind: "wallet", id: w.id }),
                str(w, "name"),
                held.length ? held.map((a) => str(a, "symbol") || str(a, "name")).join(" · ") : "暂无持仓",
                show(report.wallets[w.id]?.value, unitOfAll(held)),
              );
            })}
          </section>
        </Panel>
        <div className="stack">
          <section className="treasury-hero">
            <div>
              <small>
                {scope.name} · {scope.unit.currency === "CNY" ? "折合人民币" : `以${scope.unit.currency}计价`} ·{" "}
                {live ? "实时行情" : "行情暂不可用，使用最近价格"}
                <button
                  className="ghost hero-refresh"
                  title="刷新行情，并把当前价格记入历史"
                  disabled={refreshing === "正在刷新…" || !assets.length}
                  onClick={() => void recordPrices()}
                >
                  ↻ {refreshing || "刷新行情"}
                </button>
              </small>
              <strong>{show(scoped.total, scope.unit)}</strong>
              {scope.unit.currency !== "CNY" && <span className="pill">≈ {money(scoped.total)}</span>}
              {scoped.unknown > 0 && <span className="pill">{scoped.unknown} 项估值未知</span>}
            </div>
            <div className="hero-side">
              <span>{days === "all" ? "全部时间" : "近 " + days + " 天"}变化</span>
              <strong className={change === null ? "" : change >= 0 ? "up" : "down"}>
                {change === null
                  ? "—"
                  : (change >= 0 ? "+" : "−") +
                    sign(scope.unit.currency) +
                    Math.abs(change).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </strong>
              <small>含数量、价格与汇率变化，不等同投资收益</small>
            </div>
          </section>
          <Panel
            title="资产变化"
            aside={
              <div className="segmented">
                {[
                  ["30", "30 天"],
                  ["90", "90 天"],
                  ["365", "一年"],
                  ["all", "全部"],
                ].map(([key, label]) => (
                  <button key={key} className={days === key ? "active" : ""} onClick={() => setDays(key)}>
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            <Chart label={scope.name + "变化"} unit={" " + scope.unit.currency} points={points} />
          </Panel>

          {selectedAsset && (
            <AssetDetail
              asset={selectedAsset}
              total={report.assets[selectedAsset.id]}
              quote={quoteOf(selectedAsset)}
              unit={unitOf(selectedAsset)}
              accounts={accounts}
              walletName={walletName}
              onRecord={(walletId) => setModal({ kind: "entry", walletId, assetId: selectedAsset.id })}
              onEdit={() => setModal({ kind: "asset", entity: selectedAsset })}
              onNewAccount={() => setModal({ kind: "wallet", category: "crypto" })}
            />
          )}
          {selectedWallet && isAccount(selectedWallet) && (
            <Panel
              title={str(selectedWallet, "name") + " · 持仓"}
              aside={
                <span className="row-tools">
                  <button onClick={() => setModal({ kind: "wallet", entity: selectedWallet, category: "crypto" })}>编辑</button>
                  <button className="primary" onClick={() => setModal({ kind: "entry", walletId: selectedWallet.id })}>
                    ＋ 设定持仓
                  </button>
                </span>
              }
            >
              <div className="dense-list holdings">
                {heldIn(selectedWallet.id).map((a) => {
                  const q = report.assets[a.id].byWallet[selectedWallet.id];
                  const price = report.assets[a.id].price;
                  const value = price === null ? null : (q * price * 100n) / 10n ** 24n;
                  return (
                    <div key={a.id}>
                      <span className="row-main">
                        <strong>
                          {str(a, "name")} <em className="ticker">{str(a, "symbol")}</em>
                        </strong>
                        <small>
                          {qty(q)} {str(a, "symbol")}
                          {quoteOf(a) && <> · {pct(quoteOf(a)!.changePercent)}</>}
                        </small>
                      </span>
                      <strong className="mono">{show(value, unitOf(a))}</strong>
                      <span className="row-tools">
                        <button onClick={() => setModal({ kind: "entry", walletId: selectedWallet.id, assetId: a.id })}>调整</button>
                      </span>
                    </div>
                  );
                })}
                {!heldIn(selectedWallet.id).length && <Empty text="这个账户还没有持仓。点右上角设定某个标的的数量。" />}
              </div>
            </Panel>
          )}

          <Panel
            className="grow"
            title={scope.name + " · 流水"}
            aside={
              selectedWallet && !isAccount(selectedWallet) ? (
                <span className="row-tools">
                  <button onClick={() => setModal({ kind: "wallet", entity: selectedWallet, category: "cny" })}>编辑</button>
                  <button className="primary" onClick={() => setModal({ kind: "entry", walletId: selectedWallet.id })}>
                    ＋ 记录余额变化
                  </button>
                </span>
              ) : (
                <small>点「纠正」可修改或删除</small>
              )
            }
          >
            <div className="dense-list flow">
              {flow.slice(0, 200).map((e) => {
                const a = assetOf(e.data.assetId);
                const unitName = a ? str(a, "symbol") || str(a, "name") : "元";
                const amount = str(e, "quantity");
                const set = e.data.mode === "set";
                return (
                  <div key={e.id}>
                    <span className="mono when">
                      {new Date(str(e, "at")).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="row-main">
                      <strong>{a ? `${str(a, "name")} · ${walletName(e.data.walletId)}` : walletName(e.data.walletId)}</strong>
                      <small>
                        {set ? `设为 ${amount} ${unitName}` : `${amount.startsWith("-") ? "减少" : "增加"} ${amount.replace("-", "")} ${unitName}`}
                        {str(e, "reason") ? " · " + str(e, "reason") : ""}
                      </small>
                    </span>
                    <strong className={"mono qty" + (set ? "" : amount.startsWith("-") ? " down" : " up")}>
                      {set ? "= " + amount : (amount.startsWith("-") ? "" : "+") + amount}
                    </strong>
                    <span className="row-tools">
                      <button
                        onClick={() =>
                          setModal({ kind: "entry", walletId: str(e, "walletId"), assetId: e.data.assetId ? str(e, "assetId") : undefined, entity: e })
                        }
                      >
                        纠正
                      </button>
                    </span>
                  </div>
                );
              })}
              {!flow.length && <Empty text="还没有记录变化" />}
            </div>
          </Panel>
        </div>
      </div>

      {modal && (
        <div className="modal-backdrop">
          <div className="modal">
            <header>
              <h2>
                {modal.kind === "wallet"
                  ? modal.category === "cny" ? "人民币 / 外部投资钱包" : "交易所 / 钱包 / 券商"
                  : modal.kind === "asset"
                    ? "标的"
                    : modal.kind === "search"
                      ? "添加标的"
                      : modal.assetId ? "设定持仓" : "记录变化"}
              </h2>
              <button onClick={close}>×</button>
            </header>
            {modal.kind === "wallet" &&
              (modal.category === "cny" ? (
                <RecordForm
                  type="wallet"
                  entity={modal.entity}
                  defaults={{ name: "", category: "cny", currency: "CNY", asset: "人民币", unitPrice: "1", exchangeRate: "1" }}
                  fields={[
                    { key: "name", label: "钱包名称", required: true },
                    { key: "category", label: "类别", type: "select", options: [["cny", "人民币"], ["external", "外部投资"]] },
                  ]}
                  onSaved={(id) => {
                    setSel({ kind: "wallet", id });
                    close();
                  }}
                  onCancel={close}
                />
              ) : (
                <RecordForm
                  type="wallet"
                  entity={modal.entity}
                  defaults={{ name: "", category: "crypto", currency: "CNY" }}
                  fields={[
                    { key: "name", label: "名称（如 币安、OKX、冷钱包、富途）", required: true },
                    { key: "category", label: "主要持有", type: "select", options: [["crypto", "加密资产"], ["stock", "股票"]] },
                  ]}
                  onSaved={(id) => {
                    setSel({ kind: "wallet", id });
                    close();
                  }}
                  onCancel={close}
                />
              ))}
            {modal.kind === "asset" && modal.entity && (
              <RecordForm
                type="asset"
                entity={modal.entity}
                fields={[
                  { key: "name", label: "名称", required: true },
                  { key: "symbol", label: "代码" },
                  { key: "manualPrice", label: "备用价格（人民币，行情不可用时使用）" },
                ]}
                onSaved={close}
                onCancel={close}
              />
            )}
            {modal.kind === "search" && (
              <AssetSearch
                existing={assets.map((a) => str(a, "quoteId"))}
                onAdd={async (match) => {
                  const id = await put("asset", {
                    name: match.name,
                    symbol: match.symbol,
                    kind: match.kind,
                    quoteId: match.quoteId,
                    currency: match.currency,
                    order: assets.length,
                  });
                  setSel({ kind: "asset", id });
                  close();
                }}
                onManual={async (name, kind) => {
                  const id = await put("asset", { name, kind, order: assets.length });
                  setSel({ kind: "asset", id });
                  close();
                }}
              />
            )}
            {modal.kind === "entry" && (
              <RecordForm
                type="walletEntry"
                entity={modal.entity}
                defaults={{
                  walletId: modal.walletId,
                  ...(modal.assetId ? { assetId: modal.assetId } : {}),
                  mode: modal.assetId ? "set" : entries.some((e) => e.data.walletId === modal.walletId) ? "delta" : "set",
                  quantity: modal.assetId ? formatDecimal(report.assets[modal.assetId]?.byWallet[modal.walletId] ?? 0n) : "",
                  at: new Date().toISOString(),
                  reason: "",
                  // Remember the price of the moment, so history stays valued without live data.
                  ...(modal.assetId && report.assets[modal.assetId]?.price != null
                    ? { unitPrice: formatDecimal(report.assets[modal.assetId].price!, 6), exchangeRate: "1" }
                    : {}),
                }}
                fields={[
                  ...(isAccount(wallets.find((w) => w.id === modal.walletId) ?? ({ data: {} } as Entity))
                    ? [
                        { key: "walletId", label: "钱包 / 账户", type: "select" as const, options: accounts.map((w) => [w.id, str(w, "name")] as [string, string]) },
                        { key: "assetId", label: "标的", type: "select" as const, required: true, options: assets.map((a) => [a.id, `${str(a, "name")} ${str(a, "symbol")}`] as [string, string]) },
                      ]
                    : []),
                  {
                    key: "mode",
                    label: "记录方式",
                    type: "select",
                    options: [
                      ["set", "直接设定数量"],
                      ["delta", "增加 / 减少（负数）"],
                    ],
                  },
                  { key: "quantity", label: "数量", required: true },
                  { key: "at", label: "发生时间", type: "datetime-local", required: true },
                  { key: "reason", label: "说明" },
                ]}
                onSaved={close}
                onCancel={close}
              />
            )}
            {modal.kind === "entry" && modal.entity && (
              <div className="form-actions">
                <button
                  className="danger"
                  onClick={() => {
                    perform(remove(modal.entity!));
                    close();
                  }}
                >
                  删除这条记录
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function AssetDetail({
  asset,
  total,
  quote,
  unit,
  accounts,
  walletName,
  onRecord,
  onEdit,
  onNewAccount,
}: {
  asset: Entity;
  total: ReturnType<typeof treasury>["assets"][string] | undefined;
  quote: Quote | undefined;
  unit: Unit;
  accounts: Entity[];
  walletName: (id: unknown) => string;
  onRecord: (walletId: string) => void;
  onEdit: () => void;
  onNewAccount: () => void;
}) {
  const symbol = str(asset, "symbol");
  const byWallet = Object.entries(total?.byWallet ?? {}).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
  const others = accounts.filter((w) => total?.byWallet[w.id] === undefined);
  const priceCents = total?.price != null ? (total.price * 100n) / 10n ** 12n : null;
  return (
    <Panel
      title={`${str(asset, "name")} ${symbol} · 来自哪些钱包`}
      aside={
        <span className="row-tools">
          <button onClick={onEdit}>编辑</button>
          <select
            value=""
            onChange={(e) => (e.target.value === "new" ? onNewAccount() : e.target.value && onRecord(e.target.value))}
            aria-label="在钱包中添加"
          >
            <option value="">＋ 在钱包中添加…</option>
            {others.map((w) => (
              <option key={w.id} value={w.id}>
                {str(w, "name")}
              </option>
            ))}
            <option value="new">新的交易所 / 钱包…</option>
          </select>
        </span>
      }
    >
      <Stats
        items={[
          ["总数量", `${qty(total?.quantity)} ${symbol}`],
          [
            "现价",
            quote
              ? sign(quote.currency) +
                Number(quote.price).toLocaleString("zh-CN", { maximumFractionDigits: Number(quote.price) < 1 ? 6 : 2 }) +
                (quote.changePercent !== undefined ? `  ${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%` : "")
              : priceCents !== null
                ? show(priceCents) + "（最近记录）"
                : "未知",
          ],
          ["市值", show(total?.value, unit)],
          ["折合人民币", show(total?.value)],
        ]}
      />
      <div className="dense-list holdings">
        {byWallet.map(([walletId, q]) => {
          const value = total?.price != null ? (q * total.price * 100n) / 10n ** 24n : null;
          const part = total && total.quantity > 0n ? Number((q * 1000n) / total.quantity) / 10 : 0;
          return (
            <div key={walletId}>
              <span className="row-main">
                <strong>{walletName(walletId)}</strong>
                <small>
                  {qty(q)} {symbol} · 占 {part.toFixed(1)}%
                </small>
              </span>
              <strong className="mono">{show(value, unit)}</strong>
              <span className="row-tools">
                <button onClick={() => onRecord(walletId)}>调整</button>
              </span>
            </div>
          );
        })}
        {!byWallet.length && <Empty text="还没有钱包持有它。用右上角选择钱包添加数量。" />}
      </div>
    </Panel>
  );
}

function AssetSearch({
  existing,
  onAdd,
  onManual,
}: {
  existing: string[];
  onAdd: (match: QuoteMatch) => void;
  onManual: (name: string, kind: AssetKind) => void;
}) {
  const [kind, setKind] = useState<AssetKind>("stock");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<QuoteMatch[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setError("");
    try {
      setResults(await searchQuotes(q.trim(), kind));
    } catch {
      setError("行情服务暂时不可用，可以先手动添加。");
    }
    setBusy(false);
  }
  return (
    <form className="asset-search" onSubmit={run}>
      <div className="segmented">
        {(
          [
            ["stock", "股票 / 基金"],
            ["crypto", "加密货币"],
          ] as [AssetKind, string][]
        ).map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={kind === key ? "active" : ""}
            onClick={() => {
              setKind(key);
              setResults(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="asset-search-bar">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={kind === "stock" ? "名称或代码：英伟达、NVDA、CRCL、小米、00700…" : "名称或代码：Bitcoin、ETH、SOL…"}
        />
        <button className="primary" disabled={busy || !q.trim()}>
          {busy ? "搜索中…" : "搜索"}
        </button>
      </div>
      {error && <small className="pairing-error">{error}</small>}
      {results && (
        <div className="dense-list">
          {results.map((r) => {
            const added = existing.includes(r.quoteId);
            return (
              <div key={r.quoteId}>
                <span className="row-main">
                  <strong>{r.name}</strong>
                  <small>
                    {r.symbol} · {r.market} · {r.currency}
                  </small>
                </span>
                <span className="row-tools">
                  <button type="button" disabled={added} onClick={() => onAdd(r)}>
                    {added ? "已添加" : "添加"}
                  </button>
                </span>
              </div>
            );
          })}
          {!results.length && <Empty text="没有找到；可以换个写法，或手动添加。" />}
        </div>
      )}
      {q.trim() && (
        <button type="button" className="ghost" onClick={() => onManual(q.trim(), kind)}>
          找不到？手动添加「{q.trim()}」，自己填价格
        </button>
      )}
    </form>
  );
}
