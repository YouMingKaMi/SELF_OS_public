import React, { useEffect, useMemo, useRef, useState } from "react";
import "./freedom.css";
import { useEntities } from "../data/entities.ts";
import { useQuotes } from "../data/quotes.ts";
import { Heading, Panel, Stats, str, today, usePreference } from "../ui/shared.tsx";
import { money } from "./finance-model.ts";
import { dailyCost, freedom, whatIf, type CostBasis } from "../../../../modules/finance/index.ts";
import { treasury } from "../../../../modules/treasury/index.ts";

/** stable: money in hand, lights blue/gold. volatile: shown apart, optional. off: not counted (not in hand). */
type Role = "stable" | "volatile" | "off";
type Settings = { birthday: string; age: number; start: string; past: boolean; roles?: Record<string, Role>; showVolatile?: boolean; basis?: CostBasis; since?: string };
const roleNames: [Role, string][] = [
  ["stable", "稳定"],
  ["volatile", "波动"],
  ["off", "不计"],
];
const DAY = 86400000;
const shiftDay = (day: string, by: number) => new Date(Date.parse(day + "T12:00:00Z") + by * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DAY);
/** The birthday in the year the person turns `age`. */
const birthdayAt = (birthday: string, age: number) => {
  const [y, m, d] = birthday.split("-").map(Number);
  const date = new Date(Date.UTC(y + age, m - 1, d, 12));
  return date.toISOString().slice(0, 10);
};
const ageOn = (birthday: string, day: string) => {
  let age = Number(day.slice(0, 4)) - Number(birthday.slice(0, 4));
  if (day < birthdayAt(birthday, age)) age--;
  return age;
};
const span = (days: number) =>
  days >= 365 ? `${Math.floor(days / 365)} 年 ${Math.round((days % 365) / 30.4)} 个月` : `${days} 天`;
const yuan = (cents: number) => money(BigInt(Math.round(cents)));

export function Freedom() {
  const { entities } = useEntities("expense", "wallet", "walletEntry", "asset", "assetPrice");
  const [settings, setSettings] = usePreference<Settings>("freedom", { birthday: "", age: 80, start: today(), past: false });
  const now = today();
  const of = (type: string) => entities.filter((e) => e.type === type);
  const assets = of("asset");
  const { quotes } = useQuotes(assets.map((a) => str(a, "quoteId")).filter(Boolean));
  const live = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, quotes[str(a, "quoteId")]?.priceCNY])), [assets, quotes]);
  const book = { wallets: of("wallet"), assets, entries: of("walletEntry"), prices: of("assetPrice") };
  const report = useMemo(() => treasury({ ...book, live }), [entities, live]);
  const atStart = useMemo(() => treasury({ ...book, until: settings.start + "T23:59:59.999Z" }), [entities, settings.start]);
  // Every countable thing in the treasury: plain wallets, and assets summed across accounts.
  const items = [
    ...book.wallets
      .filter((w) => w.data.category === "cny" || w.data.category === "external")
      .map((w) => ({
        id: w.id,
        name: str(w, "name"),
        group: w.data.category === "cny" ? "人民币" : "外部投资",
        fallback: (w.data.category === "cny" ? "stable" : "off") as Role,
        value: report.wallets[w.id]?.value ?? 0n,
        start: atStart.wallets[w.id]?.value ?? 0n,
      })),
    ...assets.map((a) => ({
      id: a.id,
      name: str(a, "name"),
      group: a.data.kind === "crypto" ? "加密资产" : "股票",
      fallback: "volatile" as Role,
      value: report.assets[a.id]?.value ?? 0n,
      start: atStart.assets[a.id]?.value ?? 0n,
    })),
  ];
  const roleOf = (item: { id: string; fallback: Role }) => settings.roles?.[item.id] ?? item.fallback;
  const sumOf = (role: Role, key: "value" | "start") =>
    items.filter((i) => roleOf(i) === role).reduce((n, i) => n + i[key], 0n);
  // Blue and gold count only what is in hand; gold is its growth since the starting point.
  const total = sumOf("stable", "value");
  const startTotal = sumOf("stable", "start");
  const volatileTotal = sumOf("volatile", "value");
  const showVolatile = settings.showVolatile ?? true;
  const basis: CostBasis = settings.basis ?? "current";
  const costOptions = { since: settings.since || null, basis };
  const cost = useMemo(() => dailyCost(of("expense"), now, costOptions), [entities, now, basis, settings.since]);
  // The same average as it stood at the end of yesterday; today's effect is the difference.
  const before = useMemo(() => dailyCost(of("expense"), shiftDay(now, -1), costOptions).average, [entities, now, basis, settings.since]);
  const free = freedom({ assets: total, startAssets: startTotal, average: cost.average, volatile: volatileTotal });

  // What-if: one more event today.
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"spend" | "income">("spend");
  const cents = /^\d+(\.\d{1,2})?$/.test(amount) ? BigInt(Math.round(Number(amount) * 100)) : 0n;
  const preview = cents > 0n ? whatIf(cost, total, kind === "spend" ? { spend: cents } : { income: cents }) : null;

  const ready = /^\d{4}-\d{2}-\d{2}$/.test(settings.birthday) && settings.age > ageOn(settings.birthday, now);
  const end = ready ? birthdayAt(settings.birthday, settings.age) : now;
  const remaining = Math.max(0, daysBetween(now, end));
  const beforeDays = before > 0 ? Math.floor(Number(total) / before) : null;
  const todayEffect = free.days !== null && beforeDays !== null ? free.days - beforeDays : null;
  const need = (days: number) => Math.max(0, cost.average * days - Number(total));
  const coveredUntil = free.days !== null ? shiftDay(now, free.days) : null;

  return (
    <>
      <Heading
        eyebrow="FREEDOM LIGHTS"
        title="自由指南灯"
        description="手里的稳定资产 ÷ 日均花销 = 已经买下的自由天数。日均是从记账起点到今天的平均使用成本。"
      />
      <div className="freedom">
        <div className="freedom-side">
          <section className="freedom-hero">
            <small>已买下的自由</small>
            <strong>{free.days === null ? "—" : free.days.toLocaleString("zh-CN")}</strong>
            <span>
              天{free.days !== null && free.days >= 365 ? ` · 约 ${span(free.days)}` : ""}
            </span>
            {coveredUntil && ready && (
              <p>
                按现在的花法，能撑到 <b>{coveredUntil}</b>
                {free.days! >= remaining ? `，已覆盖到 ${settings.age} 岁` : `（${ageOn(settings.birthday, coveredUntil)} 岁）`}
              </p>
            )}
            {free.days !== null && free.volatile > 0 && (
              <p className="freedom-volatile">
                另有波动资产 {money(volatileTotal)}，按现价可再撑 <b>{free.volatile.toLocaleString("zh-CN")}</b> 天，但价格随时会变，不算进上面的数字。
              </p>
            )}
            {ready && free.days !== null && (
              <div className="freedom-progress" title="已覆盖的人生比例">
                <i style={{ width: Math.min(100, (free.days / Math.max(1, remaining)) * 100) + "%" }} />
                <em>{Math.min(100, (free.days / Math.max(1, remaining)) * 100).toFixed(1)}%</em>
              </div>
            )}
          </section>
          <div className="freedom-basis">
            <span>长期物品按</span>
            <div className="segmented">
              <button className={basis === "current" ? "active" : ""} onClick={() => setSettings({ ...settings, basis: "current" })}>
                当下日均
              </button>
              <button className={basis === "term" ? "active" : ""} onClick={() => setSettings({ ...settings, basis: "term" })}>
                期限日均
              </button>
            </div>
          </div>
          <Stats
            items={[
              ["日均花销", cost.days ? yuan(cost.average) : "—"],
              ["记账天数", cost.days ? cost.days + " 天" : "—"],
              ["稳定资产", money(total)],
              ["期间使用成本", yuan(cost.total)],
            ]}
          />
          <small className="freedom-note">
            {basis === "current"
              ? "当下日均：长期物品按「价格 ÷ 已用天数」计入，新买的大件很重，之后逐日变轻。"
              : "期限日均：长期物品按「价格 ÷ 预计使用天数」计入，代表长期稳态成本。"}
            {cost.since ? ` 从 ${cost.since} 算起。` : ""}
            {cost.days > 0 && cost.days < 90 ? " 记账不足 90 天，日均还会明显波动，仅供参考。" : ""}
          </small>
          <Panel title="今天">
            <p className="freedom-line">
              今天的使用成本 <b>{yuan(cost.today)}</b>
              {cost.days > 1 && (
                <>
                  ，{cost.today <= before ? "低于" : "高于"}此前日均 {yuan(before)}
                </>
              )}
            </p>
            {todayEffect !== null && (
              <p className={"freedom-effect " + (todayEffect >= 0 ? "up" : "down")}>
                {todayEffect === 0 ? "自由天数没有变化" : `自由 ${todayEffect > 0 ? "+" : "−"}${Math.abs(todayEffect)} 天`}
                <small>今天多过一天、多花一笔，日均随之变化；它是往后每一天的标准。</small>
              </p>
            )}
          </Panel>
          <Panel title="试算 · 如果今天">
            <div className="freedom-whatif">
              <div className="segmented">
                <button className={kind === "spend" ? "active" : ""} onClick={() => setKind("spend")}>
                  花掉
                </button>
                <button className={kind === "income" ? "active" : ""} onClick={() => setKind("income")}>
                  国库增加
                </button>
              </div>
              <input inputMode="decimal" placeholder="金额，如 8888" value={amount} onChange={(e) => setAmount(e.target.value.trim())} />
            </div>
            {preview && free.days !== null && preview.days !== null ? (
              <p className={"freedom-effect " + (preview.days >= free.days ? "up" : "down")}>
                自由 {preview.days >= free.days ? "+" : "−"}
                {Math.abs(preview.days - free.days).toLocaleString("zh-CN")} 天 → {preview.days.toLocaleString("zh-CN")} 天
                <small>
                  {kind === "spend"
                    ? `日均从 ${yuan(cost.average)} 变成 ${yuan(preview.average)}；记账 ${cost.days} 天，天数越多，单笔影响越小。`
                    : "收入只加一次资产，不改变日均。同样的金额，花掉比赚到影响大得多。"}
                </small>
              </p>
            ) : (
              <p className="freedom-hint">输入一个金额，右边的灯会跟着亮起或熄灭。</p>
            )}
          </Panel>
          {ready && cost.average > 0 && (
            <Panel title="离目标还差">
              <div className="freedom-gaps">
                {(
                  [
                    ["未来 10 年", 3653],
                    ["未来 20 年", 7305],
                    [`到 ${settings.age} 岁`, remaining],
                  ] as [string, number][]
                ).map(([label, days]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{need(days) <= 0 ? "已覆盖" : yuan(need(days))}</strong>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          <Panel title="哪些资产算数">
            <div className="freedom-roles">
              {["人民币", "外部投资", "加密资产", "股票"].map((group) => {
                const list = items.filter((i) => i.group === group);
                if (!list.length) return null;
                return (
                  <React.Fragment key={group}>
                    <small className="group">{group}</small>
                    {list.map((item) => (
                      <div key={item.id}>
                        <span className="row-main">
                          <span>{item.name}</span>
                          <small>{money(item.value)}</small>
                        </span>
                        <div className="segmented">
                          {roleNames.map(([role, label]) => (
                            <button
                              key={role}
                              className={roleOf(item) === role ? "active" : ""}
                              onClick={() => setSettings({ ...settings, roles: { ...settings.roles, [item.id]: role } })}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </React.Fragment>
                );
              })}
            </div>
            <label className="freedom-check">
              <input
                type="checkbox"
                checked={showVolatile}
                onChange={(e) => setSettings({ ...settings, showVolatile: e.target.checked })}
              />
              在方格里显示波动资产（紫色）
            </label>
            <small className="freedom-note">
              稳定：随时能用、在自己手里的钱，亮蓝灯和金灯。波动：价格起伏大，只作参考。不计：不在自己手里，例如外部投资。
            </small>
          </Panel>
          <Panel title="设置">
            <div className="freedom-settings">
              <label>
                生日
                <input type="date" value={settings.birthday} onChange={(e) => setSettings({ ...settings, birthday: e.target.value })} />
              </label>
              <label>
                想活到
                <input
                  type="number"
                  min={1}
                  max={130}
                  value={settings.age}
                  onChange={(e) => setSettings({ ...settings, age: Math.max(1, Math.min(130, Number(e.target.value) || 80)) })}
                />
              </label>
              <label>
                记账起点
                <input
                  type="date"
                  value={settings.since ?? cost.since ?? ""}
                  max={now}
                  onChange={(e) => setSettings({ ...settings, since: e.target.value || undefined })}
                />
              </label>
              <label>
                点灯起点
                <input type="date" value={settings.start} max={now} onChange={(e) => setSettings({ ...settings, start: e.target.value || now })} />
              </label>
              <label className="check">
                <input type="checkbox" checked={settings.past} onChange={(e) => setSettings({ ...settings, past: e.target.checked })} />
                显示已经过去的人生
              </label>
            </div>
            <small className="freedom-note">记账起点：从这天起算日均，默认是第一笔日常花销那天；之前补录的大件只计入之后每天的份额。点灯起点：这天已有的稳定资产亮蓝灯，之后的净增长亮金灯。设置只保存在这台设备。</small>
          </Panel>
        </div>
        <Panel
          className="freedom-board"
          title="人生方格"
          aside={
            <span className="freedom-legend">
              <i className="gold" />
              起点后的积累
              <i className="blue" />
              起点时的资产
              {showVolatile && free.volatile > 0 && (
                <>
                  <i className="volatile" />
                  波动资产
                </>
              )}
              <i className="none" />
              尚未覆盖
              {settings.past && (
                <>
                  <i className="past" />
                  已过去
                </>
              )}
            </span>
          }
        >
          {ready ? (
            <Lights
              birthday={settings.birthday}
              target={settings.age}
              past={settings.past}
              today={now}
              gold={free.gold}
              blue={free.blue}
              volatile={showVolatile ? free.volatile : 0}
              preview={preview && free.days !== null ? preview.days : null}
            />
          ) : (
            <p className="freedom-hint big">先在左下角「设置」里填上生日和想活到的年龄，方格就会亮起来。</p>
          )}
        </Panel>
      </div>
    </>
  );
}

/**
 * One row per year of life (starting on the birthday), one cell per day. From today onwards the
 * cells light gold, then blue, for as many days as are paid for. Changes animate cell by cell.
 */
function Lights(props: { birthday: string; target: number; past: boolean; today: string; gold: number; blue: number; volatile: number; preview: number | null }) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(900);
  const lit = props.gold + props.blue;
  const goal = props.preview ?? lit;
  const shown = useRef(goal);
  const [, tick] = useState(0);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.floor(entry.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // Ease towards the goal so lights visibly switch on or off.
  useEffect(() => {
    let raf = 0;
    const from = shown.current;
    const started = performance.now();
    const duration = Math.min(1600, 300 + Math.abs(goal - from) * 2);
    const step = (t: number) => {
      const k = Math.min(1, (t - started) / duration);
      shown.current = Math.round(from + (goal - from) * (1 - (1 - k) ** 3));
      tick((n) => n + 1);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [goal]);

  const ageNow = ageOn(props.birthday, props.today);
  const firstAge = props.past ? 0 : ageNow;
  const rows = Math.max(1, props.target - firstAge);
  const label = 34;
  const pitchX = (width - label) / 366;
  const pitchY = Math.max(9, Math.min(14, Math.round(pitchX * 3.2)));
  const height = rows * pitchY + 4;
  const todayRow = ageNow - firstAge;
  const todayCol = daysBetween(birthdayAt(props.birthday, ageNow), props.today);

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const ratio = window.devicePixelRatio || 1;
    node.width = width * ratio;
    node.height = height * ratio;
    const g = node.getContext("2d")!;
    g.scale(ratio, ratio);
    g.clearRect(0, 0, width, height);
    const css = getComputedStyle(document.documentElement);
    const color = (name: string) => css.getPropertyValue(name).trim();
    const off = color("--surface-3"),
      past = color("--line-2"),
      text = color("--text-3");
    const gold = "#d9ac4f",
      blue = "#6f97dc",
      lost = "#b5524a",
      gained = "#8fd3a4",
      volatile = "rgba(167, 139, 218, 0.55)";
    g.font = "10px ui-monospace, Menlo, monospace";
    g.textBaseline = "middle";
    // Index of a cell counted from today (0 = today); negative is the past.
    const base = Math.min(lit, goal);
    for (let row = 0; row < rows; row++) {
      const age = firstAge + row;
      const start = birthdayAt(props.birthday, age);
      const length = daysBetween(start, birthdayAt(props.birthday, age + 1));
      const offset = daysBetween(props.today, start); // days from today to this row's first cell
      if (age % 5 === 0 || row === 0) {
        g.fillStyle = text;
        g.fillText(String(age), 2, row * pitchY + pitchY / 2);
      }
      for (let col = 0; col < length; col++) {
        const index = offset + col;
        let fill = off;
        if (index < 0) fill = past;
        else if (index < shown.current) {
          fill = index < props.gold ? gold : blue;
          if (props.preview !== null && index >= base) fill = gained;
        } else if (props.preview !== null && index < lit) fill = lost;
        else if (props.preview === null && index < shown.current + props.volatile) fill = volatile;
        g.fillStyle = fill;
        g.fillRect(label + col * pitchX, row * pitchY, Math.max(1, pitchX - 0.6), pitchY - 2);
      }
    }
    // Today.
    g.fillStyle = color("--text");
    g.fillRect(label + todayCol * pitchX - 0.5, todayRow * pitchY - 1, Math.max(2, pitchX + 0.6), pitchY);
  });
  return (
    <div className="freedom-lights" ref={frame}>
      <div className="freedom-axis">
        <span>岁</span>
        <span>每行一岁，从生日那天开始；白色是今天</span>
      </div>
      <canvas ref={canvas} style={{ width, height }} role="img" aria-label={`已点亮 ${lit} 天`} />
    </div>
  );
}
