import React, { useEffect, useMemo, useRef, useState } from "react";
import "./mobile-freedom.css";
import { useEntities } from "../../data/entities.ts";
import { useQuotes } from "../../data/quotes.ts";
import { str, today, usePreference } from "../../ui/shared.tsx";
import { minor, money } from "../finance-model.ts";
import {
  businessDayEnd,
  dailyCost,
  expenseKnownAt,
  freedom,
  freedomTrend,
  whatIf,
  type CostBasis,
} from "../../../../../modules/finance/index.ts";
import { treasury } from "../../../../../modules/treasury/index.ts";
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
  InkSwitch,
  InkSheet,
  InkLineChart,
  MobileToolbar,
  InkNavIcon,
} from "./MobileKit.tsx";

/* ─────────────────────────── Types & Exact Desktop Preference Contract ─────────────────────────── */

type Role = "stable" | "volatile" | "off";
type Settings = {
  birthday: string;
  age: number;
  start: string;
  past: boolean;
  roles?: Record<string, Role>;
  showVolatile?: boolean;
  basis?: CostBasis;
  since?: string;
};
type TrendRangeKey = "1" | "3" | "6" | "12" | "custom";

const ROLE_OPTIONS: readonly [Role, string][] = [
  ["stable", "稳定"],
  ["volatile", "波动"],
  ["off", "不计"],
];

const TREND_RANGES: readonly { value: TrendRangeKey; label: string }[] = [
  { value: "1", label: "1个月" },
  { value: "3", label: "3个月" },
  { value: "6", label: "6个月" },
  { value: "12", label: "1年" },
  { value: "custom", label: "自定义" },
];

const DAY_MS = 86_400_000;

const shiftDay = (day: string, by: number) =>
  new Date(Date.parse(day + "T12:00:00Z") + by * DAY_MS)
    .toISOString()
    .slice(0, 10);

const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DAY_MS,
  );

const birthdayAt = (birthday: string, age: number) => {
  const [y, m, d] = birthday.split("-").map(Number);
  return new Date(Date.UTC(y + age, m - 1, d, 12)).toISOString().slice(0, 10);
};

const ageOn = (birthday: string, day: string) => {
  let age = Number(day.slice(0, 4)) - Number(birthday.slice(0, 4));
  if (day < birthdayAt(birthday, age)) age--;
  return age;
};

const spanText = (days: number) =>
  days >= 365
    ? `${Math.floor(days / 365)} 年 ${Math.round((days % 365) / 30.4)} 个月`
    : `${days} 天`;

const yuan = (cents: number) => money(BigInt(Math.round(cents)));

function compactMoney(cents: bigint): string {
  const abs = cents < 0n ? -cents : cents;
  if (abs >= 1_000_000n) {
    return `¥${(Number(cents) / 100 / 10_000).toLocaleString("zh-CN", {
      maximumFractionDigits: 2,
    })}万`;
  }
  return money(cents);
}

function monthsBefore(day: string, months: number) {
  const [year, month, date] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date, last));
  return target.toISOString().slice(0, 10);
}

/* ─────────────────────────── Main Export ─────────────────────────── */

export function MobileFreedom() {
  const { entities } = useEntities(
    "expense",
    "wallet",
    "walletEntry",
    "asset",
    "assetPrice",
  );
  // Exact same localStorage key ("pc-next-freedom") and shape as desktop Freedom.tsx
  const [settings, setSettings] = usePreference<Settings>("freedom", {
    birthday: "",
    age: 80,
    start: today(),
    past: false,
  });

  const now = today();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // What-if states
  const [whatIfTab, setWhatIfTab] = useState<"event" | "plan">("event");
  const [eventDir, setEventDir] = useState<"spend" | "income">("spend");
  const [eventAmount, setEventAmount] = useState("");
  const [monthlySaveYuan, setMonthlySaveYuan] = useState(5000);
  const [simDailyYuanOverride, setSimDailyYuanOverride] = useState<number | null>(
    null,
  );

  // Trend range states
  const [trendRange, setTrendRange] = useState<TrendRangeKey>("1");
  const [customFrom, setCustomFrom] = useState(() => monthsBefore(now, 1));
  const [customTo, setCustomTo] = useState(now);

  const { expenses, book } = useMemo(() => {
    const of = (type: string) => entities.filter((e) => e.type === type);
    return {
      expenses: of("expense"),
      book: {
        wallets: of("wallet"),
        assets: of("asset"),
        entries: of("walletEntry"),
        prices: of("assetPrice"),
      },
    };
  }, [entities]);

  const { assets, wallets } = book;
  const quoteIds = useMemo(
    () => assets.map((a) => str(a, "quoteId")).filter(Boolean),
    [assets],
  );
  const { quotes } = useQuotes(quoteIds);
  const live = useMemo(
    () =>
      Object.fromEntries(
        assets.map((a) => [a.id, quotes[str(a, "quoteId")]?.priceCNY]),
      ),
    [assets, quotes],
  );

  const roleOf = (item: { id: string; fallback: Role }): Role =>
    settings.roles?.[item.id] ?? item.fallback;

  const selection = useMemo(
    () => ({
      wallets: new Set(
        wallets
          .filter((wallet) => {
            const category = str(wallet, "category");
            return (
              ["cny", "external"].includes(category) &&
              roleOf({
                id: wallet.id,
                fallback: category === "cny" ? "stable" : "off",
              }) === "stable"
            );
          })
          .map((wallet) => wallet.id),
      ),
      assets: new Set(
        assets
          .filter(
            (asset) =>
              roleOf({ id: asset.id, fallback: "volatile" }) === "stable",
          )
          .map((asset) => asset.id),
      ),
    }),
    [wallets, assets, settings.roles],
  );

  const {
    wallets: walletValues,
    assets: assetValues,
    history,
    selected,
  } = useMemo(
    () => treasury({ ...book, live, historyOf: selection }),
    [book, live, selection],
  );

  const total = selected?.value ?? 0n;
  const startDay =
    /^\d{4}-\d{2}-\d{2}$/.test(settings.start) && settings.start <= now
      ? settings.start
      : now;

  const startTotal = useMemo(() => {
    const before = businessDayEnd(startDay);
    return (
      history.findLast((point) => Date.parse(point.at) < before)?.value ?? null
    );
  }, [history, startDay]);

  const items = useMemo(
    () => [
      ...wallets
        .filter(
          (w) => w.data.category === "cny" || w.data.category === "external",
        )
        .map((w) => ({
          id: w.id,
          name: str(w, "name"),
          group: w.data.category === "cny" ? "人民币" : "外部投资",
          fallback: (w.data.category === "cny" ? "stable" : "off") as Role,
          value: walletValues[w.id]?.value ?? null,
        })),
      ...assets.map((a) => ({
        id: a.id,
        name: str(a, "name"),
        group: a.data.kind === "crypto" ? "加密资产" : "股票",
        fallback: "volatile" as Role,
        value: assetValues[a.id]?.value ?? null,
      })),
    ],
    [wallets, assets, walletValues, assetValues],
  );

  const volatileTotal = useMemo(
    () =>
      items
        .filter((i) => roleOf(i) === "volatile")
        .reduce((n, i) => n + (i.value ?? 0n), 0n),
    [items, settings.roles],
  );

  const complete = Boolean(selected?.known && selected.unknown === 0);
  const showVolatile = settings.showVolatile ?? true;
  const basis: CostBasis = settings.basis ?? "current";
  const costOptions = { since: settings.since || null, basis };

  const cost = useMemo(
    () => dailyCost(expenses, now, costOptions),
    [expenses, now, basis, settings.since],
  );
  const yesterdayAverage = useMemo(() => {
    const yesterday = shiftDay(now, -1);
    return dailyCost(
      expenses.map((row) => expenseKnownAt(row, yesterday)),
      yesterday,
      costOptions,
    ).average;
  }, [expenses, now, basis, settings.since]);

  const free = freedom({
    assets: total,
    startAssets: startTotal ?? 0n,
    average: complete ? cost.average : 0,
    volatile: volatileTotal,
  });

  // Single-event what-if (drives live Life Grid preview, matching Freedom.swift)
  const eventCents = /^\d{1,16}(\.\d{0,2})?$/.test(eventAmount.trim())
    ? BigInt(minor(eventAmount))
    : 0n;
  const eventPreview =
    whatIfTab === "event" && eventCents > 0n && complete
      ? whatIf(
          cost,
          total,
          eventDir === "spend" ? { spend: eventCents } : { income: eventCents },
        )
      : null;

  const ready =
    /^\d{4}-\d{2}-\d{2}$/.test(settings.birthday) &&
    settings.age > ageOn(settings.birthday, now);
  const end = ready ? birthdayAt(settings.birthday, settings.age) : now;
  const remaining = Math.max(0, daysBetween(now, end));
  const coveredRatio =
    ready && free.days !== null && remaining > 0
      ? Math.min(1, free.days / remaining)
      : 0;

  const beforeDays = freedom({
    assets: total,
    startAssets: total,
    average: yesterdayAverage,
  }).days;
  const todayEffect =
    free.days !== null && beforeDays !== null ? free.days - beforeDays : null;
  const needFor = (days: number) => Math.max(0, cost.average * days - Number(total));
  const coveredUntil = free.days !== null ? shiftDay(now, free.days) : null;

  // Long-term projection what-if (monthly saving & daily spend)
  const currentDailyYuan =
    cost.average > 0 ? Math.max(1, Math.round(cost.average / 100)) : 150;
  const simDailyYuan = simDailyYuanOverride ?? currentDailyYuan;
  const simDailyMax = Math.max(1000, Math.ceil((currentDailyYuan * 3) / 50) * 50);

  const planProjection = useMemo(() => {
    if (!complete || simDailyYuan <= 0) return null;
    const dailyCents = simDailyYuan * 100;
    const coveredDaysNow = Math.floor(Number(total > 0n ? total : 0n) / dailyCents);
    const annualSaveCents = Math.max(0, monthlySaveYuan) * 12 * 100;
    const yearsToTarget =
      ready && remaining > 0
        ? Math.max(
            0,
            (remaining * dailyCents - Number(total > 0n ? total : 0n)) /
              (annualSaveCents + 365.25 * dailyCents),
          )
        : null;
    const currentAge = ready ? ageOn(settings.birthday, now) : null;
    const freedomAge =
      yearsToTarget !== null && currentAge !== null
        ? Math.min(settings.age, currentAge + yearsToTarget)
        : null;
    return { coveredDaysNow, yearsToTarget, freedomAge };
  }, [complete, simDailyYuan, monthlySaveYuan, total, ready, remaining, settings.birthday, settings.age, now]);

  // Historical trends
  const trendFrom =
    trendRange === "custom"
      ? customFrom
      : monthsBefore(now, Number(trendRange));
  const trendTo = trendRange === "custom" ? customTo : now;
  const validTrendRange =
    Boolean(trendFrom) &&
    Boolean(trendTo) &&
    trendFrom <= trendTo &&
    trendTo <= now;

  const trend = useMemo(
    () =>
      validTrendRange
        ? freedomTrend(expenses, history, {
            from: trendFrom,
            to: trendTo,
            today: now,
            assetsToday: complete ? total : null,
            since: settings.since,
            basis,
          })
        : [],
    [
      validTrendRange,
      expenses,
      history,
      trendFrom,
      trendTo,
      now,
      complete,
      total,
      settings.since,
      basis,
    ],
  );

  const trendDaysPoints = useMemo(
    () => trend.map((p) => ({ x: p.day, y: p.days, label: p.day.slice(5) })),
    [trend],
  );
  const trendAvgPoints = useMemo(
    () =>
      trend.map((p) => ({
        x: p.day,
        y: p.average === null ? null : Math.round(p.average) / 100,
        label: p.day.slice(5),
      })),
    [trend],
  );
  const trendUsagePoints = useMemo(
    () =>
      trend.map((p) => ({
        x: p.day,
        y: p.usageCost === null ? null : Math.round(p.usageCost) / 100,
        label: p.day.slice(5),
      })),
    [trend],
  );

  const heroValue =
    free.days === null ? "—" : `${free.days.toLocaleString("zh-CN")} 天`;
  const heroCaption =
    complete && cost.days > 0
      ? `稳定资产 ${compactMoney(total)} ÷ 日均 ${yuan(cost.average)}`
      : free.days !== null && free.days >= 365
        ? `约 ${spanText(free.days)}`
        : undefined;

  return (
    <InkScreen>
      {/* Top-Right Settings Gear */}
      <MobileToolbar>
        <InkNavIcon
          icon="gear"
          label="自由指南灯设置"
          onClick={() => setSettingsOpen(true)}
        />
      </MobileToolbar>

      {/* 1. Freedom Hero InkCard AT THE VERY TOP */}
      <InkCard>
        <div className="mf-card-head">
          <span className="mf-card-title">已买下的自由</span>
          {free.days !== null && free.days >= 365 && (
            <span className="mf-card-meta">约 {spanText(free.days)}</span>
          )}
        </div>

        <InkFigure value={heroValue} caption={heroCaption} size="lg" />

        {!complete && (
          <p className="mf-hero-muted">
            {selected?.unknown
              ? `有 ${selected.unknown} 项稳定资产缺少估值，补齐后计算自由天数。`
              : "请在下方「资产归类」中选择纳入计算的稳定资产。"}
          </p>
        )}

        {complete && startTotal === null && (
          <p className="mf-hero-muted">
            点灯起点估值不全，累计天数暂无法拆分。
          </p>
        )}

        {coveredUntil && (
          <p className="mf-hero-line">
            按现在的花法，能撑到 <strong>{coveredUntil}</strong>
            {ready &&
              (free.days! >= remaining
                ? `，已覆盖到 ${settings.age} 岁`
                : `（${ageOn(settings.birthday, coveredUntil)} 岁）`)}
          </p>
        )}

        {free.days !== null && free.volatile > 0 && (
          <p className="mf-hero-muted">
            另有波动资产 {money(volatileTotal)}，按现价可再撑{" "}
            {free.volatile.toLocaleString("zh-CN")} 天（未计入上方数字）。
          </p>
        )}

        {ready && free.days !== null && remaining > 0 && (
          <div className="mf-meter-block">
            <div className="mf-meter-head">
              <span>到 {settings.age} 岁的覆盖比例</span>
              <span>{(coveredRatio * 100).toFixed(1)}%</span>
            </div>
            <InkMeter progress={coveredRatio} />
          </div>
        )}

        <InkHairline />

        <InkStatRow
          items={[
            {
              label: complete ? "稳定资产" : "已知稳定",
              value: selected?.known ? compactMoney(total) : "—",
            },
            {
              label: "日均花销",
              value: cost.days > 0 ? yuan(cost.average) : "—",
            },
            ready && free.days !== null && remaining > 0
              ? {
                  label: "自由覆盖率",
                  value: `${(coveredRatio * 100).toFixed(1)}%`,
                }
              : {
                  label: "记账天数",
                  value: cost.days > 0 ? `${cost.days} 天` : "—",
                },
          ]}
        />
      </InkCard>

      {/* 2. Cost Basis Toggle & Period Details */}
      <InkSegmented
        options={[
          { value: "current" as const, label: "当下日均" },
          { value: "term" as const, label: "期限日均" },
        ]}
        value={basis}
        onChange={(next) => setSettings({ ...settings, basis: next })}
      />

      <InkCard>
        <InkStatRow
          items={[
            {
              label: "记账天数",
              value: cost.days > 0 ? `${cost.days} 天` : "—",
            },
            {
              label: "期间使用成本",
              value: cost.days > 0 ? yuan(cost.total) : "—",
            },
          ]}
        />
      </InkCard>

      <p className="mf-note">
        {cost.since
          ? `从 ${cost.since} 算起。` +
            (basis === "current"
              ? "预计使用类按已用天数平均；固定期限仍按完整期限。"
              : "长期物品按使用期限平均。") +
            (cost.days > 0 && cost.days < 90
              ? " 记账不足 90 天，日均还会明显波动。"
              : "")
          : "还没有日常花销记录，填入第一笔后才会开始计算日均。"}
      </p>

      {/* 3. Life Grid (人生方格) */}
      <InkCard>
        <div className="mf-card-head">
          <span className="mf-card-title">人生方格</span>
          <span className="mf-card-meta">一行一岁 · 一格一天</span>
        </div>

        {ready && remaining > 0 ? (
          <>
            <MobileLifeGrid
              birthday={settings.birthday}
              target={settings.age}
              past={settings.past}
              today={now}
              gold={startTotal === null ? 0 : free.gold}
              blue={startTotal === null ? 0 : free.blue}
              volatileDays={showVolatile ? free.volatile : 0}
              preview={
                eventPreview && free.days !== null ? eventPreview.days : null
              }
            />
            <div className="mf-legend">
              <span className="mf-legend-item">
                <i className="mf-dot gold" />
                起点后积累
              </span>
              <span className="mf-legend-item">
                <i className="mf-dot blue" />
                起点时资产
              </span>
              {showVolatile && free.volatile > 0 && (
                <span className="mf-legend-item">
                  <i className="mf-dot volatile" />
                  波动资产
                </span>
              )}
              <span className="mf-legend-item">
                <i className="mf-dot none" />
                尚未覆盖
              </span>
              {settings.past && (
                <span className="mf-legend-item">
                  <i className="mf-dot past" />
                  已过去
                </span>
              )}
            </div>
            <p className="mf-hero-muted">
              白线是今天。上下滑动看年龄。
              {eventPreview?.days != null ? "（绿色增加，红色减少）" : ""}
            </p>
          </>
        ) : (
          <button
            type="button"
            className="mk-pill solid mf-cta-btn"
            onClick={() => setSettingsOpen(true)}
          >
            {settings.birthday ? "调整目标年龄" : "设置生日，点亮人生方格"}
          </button>
        )}
      </InkCard>

      {/* 4. Today & Target Gaps */}
      <InkCard>
        <div className="mf-card-head">
          <span className="mf-card-title">今天</span>
          {cost.days > 1 && (
            <span className="mf-card-meta">
              {cost.today <= yesterdayAverage ? "低于" : "高于"}此前日均{" "}
              {yuan(yesterdayAverage)}
            </span>
          )}
        </div>
        <InkFigure value={yuan(cost.today)} caption="今天的使用成本" size="md" />
        {todayEffect !== null && (
          <div
            className={
              "mf-delta-text " +
              (todayEffect > 0 ? "up" : todayEffect < 0 ? "down" : "flat")
            }
          >
            {todayEffect === 0
              ? "自由天数没有变化"
              : `自由 ${todayEffect > 0 ? "+" : "−"}${Math.abs(todayEffect)} 天`}
          </div>
        )}

        <InkHairline />

        <div className="mf-card-head">
          <span className="mf-card-title">离目标还差</span>
        </div>
        {!complete ? (
          <p className="mf-hero-muted">补齐稳定资产估值后，可计算目标缺口。</p>
        ) : cost.average > 0 ? (
          <div className="mf-gap-list">
            {(
              [
                ["未来 10 年", 3653],
                ["未来 20 年", 7305],
                ...(ready && remaining > 0
                  ? [[`到 ${settings.age} 岁`, remaining] as [string, number]]
                  : []),
              ] as [string, number][]
            ).map(([label, days]) => {
              const gap = needFor(days);
              return (
                <div key={label} className="mf-gap-row">
                  <span>{label}</span>
                  <strong className={gap <= 0 ? "done" : ""}>
                    {gap <= 0 ? "已覆盖" : yuan(gap)}
                  </strong>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mf-hero-muted">日均花销大于零后，可计算目标缺口。</p>
        )}
      </InkCard>

      {/* 5. 假设推演 (What-If) */}
      <InkCard>
        <div className="mf-card-head">
          <span className="mf-card-title">假设推演</span>
          <span className="mf-card-meta">仅试算，不记账</span>
        </div>

        <InkSegmented
          onCard
          options={[
            { value: "event" as const, label: "如果今天" },
            { value: "plan" as const, label: "储蓄与花销" },
          ]}
          value={whatIfTab}
          onChange={setWhatIfTab}
        />

        {whatIfTab === "event" ? (
          <div className="mf-sim-stack">
            <InkSegmented
              onCard
              options={[
                { value: "spend" as const, label: "花掉" },
                { value: "income" as const, label: "国库增加" },
              ]}
              value={eventDir}
              onChange={setEventDir}
            />
            <input
              type="text"
              inputMode="decimal"
              className="mk-field-input"
              placeholder="输入金额，如 8888"
              value={eventAmount}
              onChange={(e) => setEventAmount(e.target.value)}
            />
            {eventPreview && free.days !== null && eventPreview.days !== null ? (
              <div className="mf-preview-box">
                <InkFigure
                  value={`${eventPreview.days.toLocaleString("zh-CN")} 天`}
                  caption="试算后的自由天数"
                  size="sm"
                />
                <div
                  className={
                    "mf-delta-text " +
                    (eventPreview.days >= free.days ? "up" : "down")
                  }
                >
                  自由 {eventPreview.days >= free.days ? "+" : "−"}
                  {Math.abs(eventPreview.days - free.days).toLocaleString(
                    "zh-CN",
                  )}{" "}
                  天
                </div>
                <p className="mf-hero-muted">
                  {eventDir === "spend"
                    ? `日均从 ${yuan(cost.average)} 变为 ${yuan(eventPreview.average)}。`
                    : "收入只增加资产，不抬高日均。"}
                </p>
              </div>
            ) : eventAmount.trim() && eventCents <= 0n ? (
              <p className="mf-hero-muted">输入大于零的金额，最多两位小数。</p>
            ) : (
              <p className="mf-hero-muted">
                花掉会提高日均；国库增加会提高稳定资产，并实时预览到人生方格。
              </p>
            )}
          </div>
        ) : (
          <div className="mf-sim-stack">
            <div className="mf-slider-block">
              <div className="mf-slider-head">
                <span>每月净储蓄（元）</span>
                <input
                  type="number"
                  inputMode="numeric"
                  className="mf-slider-num"
                  min={0}
                  max={500000}
                  step={500}
                  value={monthlySaveYuan}
                  onChange={(e) =>
                    setMonthlySaveYuan(Math.max(0, Number(e.target.value) || 0))
                  }
                />
              </div>
              <input
                type="range"
                className="mf-range"
                min={0}
                max={50000}
                step={500}
                value={Math.min(50000, monthlySaveYuan)}
                onChange={(e) => setMonthlySaveYuan(Number(e.target.value))}
              />
            </div>

            <div className="mf-slider-block">
              <div className="mf-slider-head">
                <span>假设日均花销（元）</span>
                <input
                  type="number"
                  inputMode="numeric"
                  className="mf-slider-num"
                  min={1}
                  max={10000}
                  step={10}
                  value={simDailyYuan}
                  onChange={(e) =>
                    setSimDailyYuanOverride(
                      Math.max(1, Number(e.target.value) || 1),
                    )
                  }
                />
              </div>
              <input
                type="range"
                className="mf-range"
                min={20}
                max={simDailyMax}
                step={10}
                value={Math.min(simDailyMax, Math.max(20, simDailyYuan))}
                onChange={(e) =>
                  setSimDailyYuanOverride(Number(e.target.value))
                }
              />
            </div>

            {planProjection ? (
              <div className="mf-sim-result">
                <InkStatRow
                  items={[
                    {
                      label: "当前可覆盖",
                      value:
                        planProjection.coveredDaysNow >= 365
                          ? `${(planProjection.coveredDaysNow / 365).toFixed(1)} 年`
                          : `${planProjection.coveredDaysNow} 天`,
                    },
                    {
                      label: ready ? `覆至${settings.age}岁需` : "年储蓄增幅",
                      value:
                        planProjection.yearsToTarget !== null
                          ? planProjection.yearsToTarget <= 0.05
                            ? "已达成"
                            : `${planProjection.yearsToTarget.toFixed(1)} 年`
                          : `+${Math.round((monthlySaveYuan * 12) / simDailyYuan)} 天/年`,
                      tone:
                        planProjection.yearsToTarget !== null &&
                        planProjection.yearsToTarget <= 0.05
                          ? "live"
                          : "normal",
                    },
                    {
                      label: "预计达成年龄",
                      value:
                        planProjection.freedomAge !== null
                          ? `${planProjection.freedomAge.toFixed(1)} 岁`
                          : "设生日可算",
                    },
                  ]}
                />
              </div>
            ) : (
              <p className="mf-hero-muted">补齐稳定资产估值后即可推演。</p>
            )}
          </div>
        )}
      </InkCard>

      {/* 6. 历史趋势 (Trend) */}
      <InkCard>
        <div className="mf-card-head">
          <span className="mf-card-title">历史趋势</span>
        </div>

        <InkChipBar
          items={TREND_RANGES}
          value={trendRange}
          onChange={setTrendRange}
          size="sm"
        />

        {trendRange === "custom" && (
          <div className="mk-form-group">
            <div className="mk-form-row">
              <span className="mk-form-label">起始日</span>
              <input
                type="date"
                className="mk-form-input mf-date-input"
                max={customTo || now}
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </div>
            <div className="mk-form-row">
              <span className="mk-form-label">结束日</span>
              <input
                type="date"
                className="mk-form-input mf-date-input"
                min={customFrom || undefined}
                max={now}
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          </div>
        )}

        <p className="mf-hero-muted">
          累计日均从记账起点算到当天；每日实际使用成本包含当次消费与长期物品当天的成本。
        </p>

        {!validTrendRange ? (
          <p className="mf-hero-muted">
            请选择有效的日期范围，结束日最晚为今天。
          </p>
        ) : (
          <>
            <InkLineChart
              points={trendDaysPoints}
              label="自由天数"
              formatValue={(v) => `${Math.round(v).toLocaleString("zh-CN")} 天`}
              height={120}
            />
            <InkHairline />
            <InkLineChart
              points={trendAvgPoints}
              label="累计日均消费"
              formatValue={(v) => yuan(v * 100)}
              height={120}
            />
            <InkHairline />
            <InkLineChart
              points={trendUsagePoints}
              label="每日实际使用成本"
              formatValue={(v) => yuan(v * 100)}
              height={120}
            />
          </>
        )}
      </InkCard>

      {/* 7. 资产归类 (Asset Roles) */}
      <InkSectionLabel title="资产归类" aside={`${items.length} 项`} />
      <InkCard>
        {items.length > 0 ? (
          ["人民币", "外部投资", "加密资产", "股票"].map((group) => {
            const list = items.filter((i) => i.group === group);
            if (!list.length) return null;
            return (
              <div key={group} className="mf-role-group">
                <div className="mf-role-group-title">{group}</div>
                {list.map((item) => {
                  const activeRole = roleOf(item);
                  return (
                    <div key={item.id} className="mf-role-row">
                      <div className="mf-role-info">
                        <span className="mf-role-name">{item.name}</span>
                        <span className="mf-role-val">
                          {item.value === null ? "估值未知" : money(item.value)}
                        </span>
                      </div>
                      <div className="mf-role-pills" role="group" aria-label={item.name}>
                        {ROLE_OPTIONS.map(([role, label]) => (
                          <button
                            key={role}
                            type="button"
                            className={
                              "mf-role-pill" +
                              (activeRole === role ? " active" : "")
                            }
                            onClick={() =>
                              setSettings({
                                ...settings,
                                roles: { ...settings.roles, [item.id]: role },
                              })
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        ) : (
          <p className="mf-hero-muted">国库里还没有钱包或标的。</p>
        )}
        <p className="mf-hero-muted">
          稳定：随时能用、在手里的钱，点亮蓝灯与金灯。波动：价格起伏大，仅作参考。不计：暂不计入。
        </p>
      </InkCard>

      {/* Settings Bottom Sheet (Single-Column iOS Grouped Form — Zero 2-Column Overflow!) */}
      <InkSheet
        open={settingsOpen}
        title="指南灯设置"
        onClose={() => setSettingsOpen(false)}
        leftLabel="完成"
      >
        <InkSectionLabel title="人生方格" />
        <div className="mk-form-group">
          <div className="mk-form-row">
            <span className="mk-form-label">生日</span>
            <input
              type="date"
              className="mk-form-input mf-date-input"
              max={now}
              value={settings.birthday}
              onChange={(e) =>
                setSettings({ ...settings, birthday: e.target.value })
              }
            />
          </div>

          <div className="mk-form-row">
            <span className="mk-form-label">想活到</span>
            <div className="mf-age-stepper">
              <button
                type="button"
                className="mf-step-btn"
                aria-label="减少目标年龄"
                onClick={() =>
                  setSettings({
                    ...settings,
                    age: Math.max(1, (settings.age || 80) - 1),
                  })
                }
              >
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                className="mf-age-input"
                min={1}
                max={130}
                value={settings.age}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    age: Math.max(
                      1,
                      Math.min(130, Number(e.target.value) || 80),
                    ),
                  })
                }
              />
              <span className="mf-age-unit">岁</span>
              <button
                type="button"
                className="mf-step-btn"
                aria-label="增加目标年龄"
                onClick={() =>
                  setSettings({
                    ...settings,
                    age: Math.min(130, (settings.age || 80) + 1),
                  })
                }
              >
                +
              </button>
            </div>
          </div>

          <div className="mk-form-row">
            <span className="mk-form-label">记账起点</span>
            <div className="mf-since-actions">
              {settings.since && (
                <button
                  type="button"
                  className="mf-reset-link"
                  onClick={() =>
                    setSettings({ ...settings, since: undefined })
                  }
                >
                  自动
                </button>
              )}
              <input
                type="date"
                className="mk-form-input mf-date-input"
                max={now}
                value={settings.since ?? cost.since ?? ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    since: e.target.value || undefined,
                  })
                }
              />
            </div>
          </div>

          <div className="mk-form-row">
            <span className="mk-form-label">点灯起点</span>
            <input
              type="date"
              className="mk-form-input mf-date-input"
              max={now}
              value={startDay}
              onChange={(e) =>
                setSettings({ ...settings, start: e.target.value || now })
              }
            />
          </div>
        </div>

        <InkSectionLabel title="方格显示" />
        <div className="mk-form-group">
          <div className="mk-form-row">
            <span className="mk-form-label">显示已经过去的人生</span>
            <InkSwitch
              checked={settings.past}
              label="显示已经过去的人生"
              onChange={(checked) =>
                setSettings({ ...settings, past: checked })
              }
            />
          </div>
          <div className="mk-form-row">
            <span className="mk-form-label">在方格里显示波动资产</span>
            <InkSwitch
              checked={showVolatile}
              label="在方格里显示波动资产"
              onChange={(checked) =>
                setSettings({ ...settings, showVolatile: checked })
              }
            />
          </div>
        </div>

        <p className="mf-sheet-note">
          记账起点：从这天起算日均，默认是第一笔日常花销那天。点灯起点：这天已有的稳定资产亮蓝灯，之后的净增长亮金灯。设置与桌面端共享本地偏好。
        </p>
      </InkSheet>
    </InkScreen>
  );
}

/* ─────────────────────────── Responsive 360px-Safe Life Grid Canvas ─────────────────────────── */

function MobileLifeGrid({
  birthday,
  target,
  past,
  today: todayIso,
  gold,
  blue,
  volatileDays,
  preview,
}: {
  birthday: string;
  target: number;
  past: boolean;
  today: string;
  gold: number;
  blue: number;
  volatileDays: number;
  preview: number | null;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(288);

  const lit = gold + blue;
  const goal = preview ?? lit;
  const shownRef = useRef(goal);
  const [, setTick] = useState(0);

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const update = (w: number) => {
      if (w > 0) setWidth(Math.max(180, Math.floor(w)));
    };
    update(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      update(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Smooth ease animation when lit count or preview changes
  useEffect(() => {
    let raf = 0;
    const from = shownRef.current;
    if (from === goal) return;
    const started = performance.now();
    const duration = Math.min(1200, 260 + Math.abs(goal - from) * 1.6);
    const step = (t: number) => {
      const k = Math.min(1, (t - started) / duration);
      shownRef.current = Math.round(from + (goal - from) * (1 - (1 - k) ** 3));
      setTick((n) => n + 1);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [goal]);

  const ageNow = ageOn(birthday, todayIso);
  const firstAge = past ? 0 : ageNow;
  const rows = Math.max(1, Math.max(ageNow + 1, target) - firstAge);
  const labelWidth = 26;
  const rowHeight = 13;
  const pitchX = Math.max(0.4, (width - labelWidth) / 366);
  const height = rows * rowHeight + 4;
  const todayRow = ageNow - firstAge;
  const todayCol = daysBetween(birthdayAt(birthday, ageNow), todayIso);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const ratio = window.devicePixelRatio || 1;
    node.width = Math.round(width * ratio);
    node.height = Math.round(height * ratio);
    const ctx = node.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const isLight =
      document.documentElement.getAttribute("data-theme") === "light";
    const offColor = isLight
      ? "rgba(0, 0, 0, 0.11)"
      : "rgba(255, 255, 255, 0.14)";
    const pastColor = isLight
      ? "rgba(0, 0, 0, 0.05)"
      : "rgba(255, 255, 255, 0.06)";
    const textColor = isLight
      ? "rgba(24, 24, 24, 0.45)"
      : "rgba(255, 255, 255, 0.42)";
    const todayColor = isLight ? "#181818" : "#ffffff";

    const goldColor = "#f0b94a";
    const blueColor = "#5b92f0";
    const volatileColor = "rgba(167, 139, 218, 0.68)";
    const gainedColor = "#4ddb87";
    const lostColor = "#ff6e6e";

    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "middle";

    const base = Math.min(lit, goal);
    const cellW = Math.max(0.75, pitchX * 0.86);
    const cellH = rowHeight - 3;

    for (let row = 0; row < rows; row++) {
      const age = firstAge + row;
      const startIso = birthdayAt(birthday, age);
      const length = daysBetween(startIso, birthdayAt(birthday, age + 1));
      const offset = daysBetween(todayIso, startIso);
      const y = row * rowHeight;

      if (age === firstAge || age === ageNow || age % 5 === 0) {
        ctx.fillStyle = textColor;
        ctx.fillText(String(age), 2, y + rowHeight / 2);
      }

      for (let col = 0; col < length; col++) {
        const index = offset + col;
        let fill = offColor;
        if (index < 0) {
          fill = pastColor;
        } else if (index < shownRef.current) {
          fill = index < gold ? goldColor : blueColor;
          if (preview !== null && index >= base) fill = gainedColor;
        } else if (preview !== null && index < lit) {
          fill = lostColor;
        } else if (
          preview === null &&
          index < shownRef.current + volatileDays
        ) {
          fill = volatileColor;
        }
        ctx.fillStyle = fill;
        ctx.fillRect(labelWidth + col * pitchX, y + 1, cellW, cellH);
      }
    }

    // Crisp vertical marker line for Today
    if (todayRow >= 0 && todayRow < rows && todayCol >= 0) {
      ctx.fillStyle = todayColor;
      ctx.fillRect(
        labelWidth + todayCol * pitchX - 0.5,
        todayRow * rowHeight,
        Math.max(1.5, pitchX + 0.5),
        rowHeight,
      );
    }
  });

  return (
    <div className="mf-grid-frame" ref={frameRef}>
      <div className="mf-grid-scroll">
        <canvas
          ref={canvasRef}
          className="mf-grid-canvas"
          style={{ width: `${width}px`, height: `${height}px` }}
          role="img"
          aria-label={`人生方格，已覆盖 ${lit} 天`}
        />
      </div>
    </div>
  );
}
