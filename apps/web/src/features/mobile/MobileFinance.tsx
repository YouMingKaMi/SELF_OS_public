import React, { useMemo, useState } from "react";
import {
  put,
  putKey,
  remove,
  useEntities,
  type AnyEntity as Entity,
  type Data,
} from "../../data/entities.ts";
import { Icon } from "../../ui/Icon.tsx";
import { arr, monthNow, perform, str, today } from "../../ui/shared.tsx";
import {
  add,
  daily,
  dayCount,
  effectiveEnd,
  isHistory,
  longTerm,
  minor,
  money,
  monthlyUsage,
  net,
  round,
} from "../finance-model.ts";
import {
  daysInMonth,
  InkActionSheet,
  InkBarChart,
  InkCard,
  InkEmpty,
  InkFigure,
  InkHairline,
  InkMeter,
  InkMonthBar,
  InkNavIcon,
  InkScreen,
  InkSectionLabel,
  InkSegmented,
  InkSheet,
  InkStatRow,
  InkSwitch,
  MobileToolbar,
  shiftDay,
  shiftMonth,
  weekdayChar,
} from "./MobileKit.tsx";
import "./mobile-finance.css";

type FinanceView = "ledger" | "spread" | "long" | "fixed";
type Basis = "actual" | "term" | "current";

const MODE_LABEL: Record<string, string> = {
  immediate: "当次",
  estimated: "预计使用",
  fixed: "固定期限",
};

function yuanStr(amountMinor: string): string {
  if (!amountMinor) return "";
  try {
    const n = BigInt(amountMinor);
    const neg = n < 0n ? "-" : "";
    const a = n < 0n ? -n : n;
    const whole = a / 100n;
    const cents = a % 100n;
    if (cents === 0n) return `${neg}${whole}`;
    return `${neg}${whole}.${String(cents).padStart(2, "0").replace(/0$/, "")}`;
  } catch {
    return "";
  }
}

function tryMinor(input: string): string | null {
  try {
    return minor(input);
  } catch {
    return null;
  }
}

/**
 * Exact 1:1 port of iPhone `FinanceScreen` (Finance.swift lines 5-393).
 * Vertical order:
 *  1. MonthBar
 *  2. Summary Hero Card AT THE VERY TOP (Figure + 实付/期限/当下 toggle + Budget Meter + 必要/非必要/日均)
 *  3. 4-tab Segmented (账本 / 分布 / 长期 / 固定)
 *  4. Active view content
 * Top-right navbar: `...` (月度预算 / 新分类 / 新固定支出) + `+` (记一笔).
 */
export function MobileFinance() {
  const { entities } = useEntities(
    "expense",
    "category",
    "budget",
    "recurringExpense",
  );
  const asOf = today();
  const [month, setMonth] = useState(monthNow());
  const [view, setView] = useState<FinanceView>("ledger");
  const [basis, setBasis] = useState<Basis>("actual");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [showEnded, setShowEnded] = useState(false);

  const [basisMenu, setBasisMenu] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Entity | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [recurringEdit, setRecurringEdit] = useState<Entity | null | undefined>(
    undefined,
  );

  const expenses = useMemo(
    () => entities.filter((e) => e.type === "expense" && !e.deleted),
    [entities],
  );
  const categories = useMemo(
    () => entities.filter((e) => e.type === "category" && !e.deleted),
    [entities],
  );
  const recurring = useMemo(
    () => entities.filter((e) => e.type === "recurringExpense" && !e.deleted),
    [entities],
  );
  const budget = useMemo(
    () =>
      entities.find(
        (e) => e.type === "budget" && !e.deleted && e.data.month === month,
      ),
    [entities, month],
  );

  const catName = (id: string) =>
    categories.find((c) => c.id === id)?.data.name
      ? String(categories.find((c) => c.id === id)!.data.name)
      : "未分类";

  const filtered = useMemo(
    () =>
      categoryFilter
        ? expenses.filter((e) => str(e, "categoryId") === categoryFilter)
        : expenses,
    [expenses, categoryFilter],
  );

  const monthDays = useMemo(() => daysInMonth(month), [month]);
  const prevMonthDays = useMemo(
    () => daysInMonth(shiftMonth(month, -1)),
    [month],
  );

  const report = useMemo(() => {
    const monthEntries = filtered.filter((e) => str(e, "day").startsWith(month));
    const actualTotal = monthEntries.reduce((sum, e) => sum + net(e), 0n);

    const calcTotal = (list: Entity[], days: string[]) => {
      if (basis === "actual") {
        const prefix = days[0]?.slice(0, 7) ?? month;
        return list
          .filter((e) => str(e, "day").startsWith(prefix))
          .reduce((sum, e) => sum + net(e), 0n);
      }
      return round(monthlyUsage(list, days, asOf, basis === "current").total);
    };

    const usageSeries = monthlyUsage(
      filtered,
      monthDays,
      asOf,
      basis === "current",
    );
    const dayPoints =
      basis === "actual"
        ? monthDays
            .filter((d) => d <= asOf)
            .map((d) => ({
              day: d,
              minor: monthEntries
                .filter((e) => str(e, "day") === d)
                .reduce((s, e) => s + net(e), 0n),
            }))
        : usageSeries.days.map((p) => ({ day: p.day, minor: round(p.value) }));

    const activeTotal =
      basis === "actual" ? actualTotal : round(usageSeries.total);
    const prevTotal = calcTotal(filtered, prevMonthDays);
    const necessary = calcTotal(
      filtered.filter((e) => e.data.necessary !== false),
      monthDays,
    );
    const discretionary = calcTotal(
      filtered.filter((e) => e.data.necessary === false),
      monthDays,
    );

    const elapsedDays = dayPoints.length;
    const recordedDays = dayPoints.filter((d) => d.minor !== 0n).length;
    const calendarAverage =
      elapsedDays > 0 ? activeTotal / BigInt(elapsedDays) : null;
    const recordedAverage =
      recordedDays > 0 ? activeTotal / BigInt(recordedDays) : null;

    // Category breakdown
    const catIds = Array.from(
      new Set(expenses.map((e) => str(e, "categoryId"))),
    );
    const catTotals = catIds
      .map((id) => ({
        id,
        minor: calcTotal(
          expenses.filter((e) => str(e, "categoryId") === id),
          monthDays,
        ),
      }))
      .filter((g) => g.minor !== 0n)
      .sort((a, b) => (b.minor > a.minor ? 1 : b.minor < a.minor ? -1 : 0));

    return {
      actualTotal,
      activeTotal,
      prevTotal,
      necessary,
      discretionary,
      dayPoints,
      elapsedDays,
      recordedDays,
      calendarAverage,
      recordedAverage,
      catTotals,
    };
  }, [filtered, expenses, month, monthDays, prevMonthDays, basis, asOf]);

  const budgetMinor = budget ? BigInt(str(budget, "amountMinor", "0")) : 0n;
  const isCurrentMonth = month === asOf.slice(0, 7);
  const pace =
    monthDays.length > 0 ? report.elapsedDays / monthDays.length : 0;
  const projected =
    isCurrentMonth && report.elapsedDays > 0
      ? (report.actualTotal * BigInt(monthDays.length)) /
        BigInt(report.elapsedDays)
      : report.actualTotal;

  // Ledger data
  const pendingUncategorized = useMemo(
    () =>
      expenses.filter(
        (e) => str(e, "day").startsWith(month) && !str(e, "categoryId"),
      ),
    [expenses, month],
  );
  const ledgerRows = useMemo(
    () =>
      reviewing
        ? pendingUncategorized
        : filtered.filter((e) => str(e, "day").startsWith(month)),
    [reviewing, pendingUncategorized, filtered, month],
  );
  const ledgerDays = useMemo(
    () =>
      Array.from(new Set(ledgerRows.map((e) => str(e, "day")))).sort((a, b) =>
        b.localeCompare(a),
      ),
    [ledgerRows],
  );

  // Long-term data
  const ltData = useMemo(
    () => longTerm(expenses, month, asOf),
    [expenses, month, asOf],
  );
  const ltInUse = useMemo(
    () => ltData.shown.filter((e) => !isHistory(e, asOf)),
    [ltData.shown, asOf],
  );
  const ltTermDaily = useMemo(() => {
    let sum = { n: 0n, d: 1n };
    for (const e of ltInUse) {
      const r = daily(e, asOf, false);
      if (r) sum = add(sum, r);
    }
    return round(sum);
  }, [ltInUse, asOf]);
  const ltCurrentDaily = useMemo(() => {
    let sum = { n: 0n, d: 1n };
    for (const e of ltInUse) {
      const r = daily(e, asOf, true);
      if (r) sum = add(sum, r);
    }
    return round(sum);
  }, [ltInUse, asOf]);

  return (
    <InkScreen>
      <MobileToolbar>
        <InkNavIcon
          icon="ellipsis"
          label="更多花销选项"
          onClick={() => setMoreMenu(true)}
        />
        <InkNavIcon
          icon="plus"
          label="记一笔"
          onClick={() => setAdding(true)}
        />
      </MobileToolbar>

      {/* 1. MonthBar */}
      <InkMonthBar month={month} onChange={setMonth} />

      {/* 2. Summary Hero Card AT THE VERY TOP (Finance.swift lines 39-44) */}
      <InkCard>
        <div className="mf-hero-top">
          <InkFigure
            value={money(report.activeTotal)}
            caption={
              basis === "actual"
                ? isCurrentMonth
                  ? "按目前节奏，月底约 " + money(projected)
                  : "实际净付款"
                : basis === "term"
                  ? "月度使用成本 · 期限均摊"
                  : "月度使用成本 · 当下均摊"
            }
          />
          <button
            type="button"
            className="mf-basis-btn"
            onClick={() => setBasisMenu(true)}
          >
            <span>
              {basis === "actual" ? "实付" : basis === "term" ? "期限" : "当下"}
            </span>
            <Icon name="chevron-down" size={11} />
          </button>
        </div>

        {budgetMinor > 0n && (
          <div className="mf-budget-wrap">
            <div className="mf-budget-bar">
              <div
                className={
                  "mf-budget-fill" +
                  (report.actualTotal > budgetMinor ? " over" : "")
                }
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      (Number(report.actualTotal) / Number(budgetMinor)) * 100,
                    ),
                  )}%`,
                }}
              />
              {isCurrentMonth && (
                <span
                  className="mf-budget-pace"
                  style={{ left: `${Math.min(100, Math.max(0, pace * 100))}%` }}
                />
              )}
            </div>
            <div className="mf-budget-meta">
              <span>预算 {money(budgetMinor)}</span>
              <span>
                {report.actualTotal > budgetMinor
                  ? "已超 " + money(report.actualTotal - budgetMinor)
                  : "剩 " + money(budgetMinor - report.actualTotal)}
              </span>
            </div>
          </div>
        )}

        <InkStatRow
          items={[
            { label: "必要", value: money(report.necessary) },
            { label: "非必要", value: money(report.discretionary) },
            {
              label: "日均",
              value:
                report.calendarAverage !== null
                  ? money(report.calendarAverage)
                  : "—",
            },
          ]}
        />
      </InkCard>

      {/* 3. 4-Tab Segmented Switch (Finance.swift lines 45-52) */}
      <InkSegmented
        options={[
          { value: "ledger", label: "账本" },
          { value: "spread", label: "分布" },
          { value: "long", label: "长期" },
          { value: "fixed", label: "固定" },
        ]}
        value={view}
        onChange={setView}
      />

      {/* 4. View Content */}
      {view === "ledger" && (
        <>
          {(pendingUncategorized.length > 0 || reviewing) && (
            <InkCard variant="compact">
              <button
                type="button"
                className="mk-row"
                onClick={() => {
                  setCategoryFilter("");
                  setReviewing((v) => !v);
                }}
              >
                <span className="mk-row-main">
                  <span className="mk-row-title">
                    {reviewing ? "返回全部账本" : "待分类"}
                  </span>
                </span>
                <span className="mk-row-right">
                  {!reviewing && (
                    <>
                      <span>{pendingUncategorized.length} 笔</span>
                      <span className="mk-row-chevron">
                        <Icon name="chevron-right" size={14} />
                      </span>
                    </>
                  )}
                </span>
              </button>
            </InkCard>
          )}

          {categoryFilter && (
            <InkCard variant="compact">
              <button
                type="button"
                className="mk-row"
                onClick={() => setCategoryFilter("")}
              >
                <span className="mk-row-title" style={{ color: "var(--text-2)" }}>
                  只看 {catName(categoryFilter)} · 点此取消
                </span>
                <Icon name="close" size={14} />
              </button>
            </InkCard>
          )}

          {ledgerDays.map((d) => {
            const list = ledgerRows
              .filter((e) => str(e, "day") === d)
              .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
            const daySum = list.reduce((s, e) => s + net(e), 0n);
            return (
              <React.Fragment key={d}>
                <div className="mf-day-head">
                  <span className="mf-day-head-left">
                    <strong>{Number(d.slice(-2))}</strong>
                    <small>周{weekdayChar(d)}</small>
                  </span>
                  <span className="mf-day-head-sum">{money(daySum)}</span>
                </div>
                <InkCard variant="compact">
                  {list.map((row, idx) => {
                    const amount = net(row);
                    const subParts = [
                      str(row, "categoryId")
                        ? catName(str(row, "categoryId"))
                        : "待分类",
                      str(row, "subcategoryId")
                        ? catName(str(row, "subcategoryId"))
                        : null,
                      row.data.mode && row.data.mode !== "immediate"
                        ? MODE_LABEL[str(row, "mode")] ?? str(row, "mode")
                        : null,
                    ].filter(Boolean);
                    return (
                      <React.Fragment key={row.id}>
                        {idx > 0 && <InkHairline />}
                        <button
                          type="button"
                          className="mk-row"
                          onClick={() => setEditing(row)}
                        >
                          <span className="mk-row-main">
                            <span className="mk-row-title clamp-1">
                              {str(row, "title")}
                            </span>
                            <span className="mk-row-sub">
                              {subParts.join(" · ")}
                            </span>
                          </span>
                          <span className="mk-row-right">
                            {row.data.necessary === false && (
                              <span className="mf-badge">非必要</span>
                            )}
                            <span
                              className={
                                "mf-amount" + (amount < 0n ? " refund" : "")
                              }
                            >
                              {money(amount)}
                            </span>
                          </span>
                        </button>
                      </React.Fragment>
                    );
                  })}
                </InkCard>
              </React.Fragment>
            );
          })}

          {ledgerDays.length === 0 && (
            <InkCard>
              <InkEmpty
                text={reviewing ? "本月账单已全部分类" : "这个月还没有记录"}
              />
            </InkCard>
          )}
        </>
      )}

      {view === "spread" && (
        <>
          <InkSectionLabel title="用途 · 点一项看明细" />
          <InkCard variant="compact">
            {report.catTotals.map((group, idx) => {
              const top = report.catTotals[0]?.minor ?? 1n;
              const ratio =
                top > 0n
                  ? Math.max(0, Number(group.minor) / Number(top))
                  : 0;
              return (
                <React.Fragment key={group.id || "uncategorized"}>
                  {idx > 0 && <InkHairline />}
                  <button
                    type="button"
                    className="mf-spread-row"
                    onClick={() => {
                      setReviewing(group.id === "");
                      setCategoryFilter(
                        categoryFilter === group.id ? "" : group.id,
                      );
                      setView("ledger");
                    }}
                  >
                    <div className="mf-spread-top">
                      <span>{group.id ? catName(group.id) : "待分类"}</span>
                      <strong>{money(group.minor)}</strong>
                    </div>
                    <InkMeter progress={ratio} />
                  </button>
                </React.Fragment>
              );
            })}
            {report.catTotals.length === 0 && (
              <InkEmpty text="记账后显示用途分布" />
            )}
          </InkCard>

          <InkSectionLabel title="每日" />
          <InkCard>
            <InkBarChart
              points={report.dayPoints.map((p) => ({
                x: p.day,
                y: Math.max(0, Number(p.minor) / 100),
                highlight: p.day === asOf,
                label: String(Number(p.day.slice(-2))),
              }))}
              label="每日花销"
              formatValue={(v) => `¥${v.toFixed(2)}`}
              height={146}
            />
            <InkStatRow
              items={[
                {
                  label: "有记录日均",
                  value:
                    report.recordedAverage !== null
                      ? money(report.recordedAverage)
                      : "—",
                },
                { label: "记录天数", value: `${report.recordedDays}` },
                { label: "上月", value: money(report.prevTotal) },
              ]}
            />
          </InkCard>
        </>
      )}

      {view === "long" && (
        <>
          <InkCard>
            <InkStatRow
              items={[
                { label: "期限日均", value: money(ltTermDaily) },
                { label: "当下日均", value: money(ltCurrentDaily) },
                {
                  label: month >= asOf.slice(0, 7) ? "使用中" : "当月在用",
                  value: `${ltData.shown.length} 件`,
                },
              ]}
            />
          </InkCard>

          <InkSectionLabel
            title={month >= asOf.slice(0, 7) ? "使用中" : "当月在用"}
          />
          <InkCard variant="compact">
            {ltData.shown.map((row, idx) => (
              <React.Fragment key={row.id}>
                {idx > 0 && <InkHairline />}
                <LongTermRow row={row} asOf={asOf} onOpen={() => setEditing(row)} />
              </React.Fragment>
            ))}
            {ltData.shown.length === 0 && (
              <InkEmpty
                text={
                  month >= asOf.slice(0, 7)
                    ? "没有使用中的长期物品"
                    : "这个月没有在用的长期物品"
                }
              />
            )}
          </InkCard>

          {ltData.hidden.length > 0 && (
            <InkCard variant="compact">
              <button
                type="button"
                className="mk-row"
                onClick={() => setShowEnded((v) => !v)}
              >
                <span className="mk-row-title" style={{ color: "var(--text-2)" }}>
                  已结束 · {ltData.hidden.length}
                </span>
                <Icon
                  name={showEnded ? "chevron-up" : "chevron-down"}
                  size={15}
                />
              </button>
              {showEnded &&
                ltData.hidden.map((row) => (
                  <React.Fragment key={row.id}>
                    <InkHairline />
                    <LongTermRow
                      row={row}
                      asOf={asOf}
                      onOpen={() => setEditing(row)}
                    />
                  </React.Fragment>
                ))}
            </InkCard>
          )}
        </>
      )}

      {view === "fixed" && (
        <>
          <InkCard variant="compact">
            {recurring.map((row, idx) => (
              <React.Fragment key={row.id}>
                {idx > 0 && <InkHairline />}
                <button
                  type="button"
                  className="mk-row"
                  onClick={() => setRecurringEdit(row)}
                >
                  <span className="mk-row-main">
                    <span
                      className="mk-row-title"
                      style={{
                        color: row.data.active ? "var(--text)" : "var(--text-3)",
                      }}
                    >
                      {str(row, "name")}
                    </span>
                    <span className="mk-row-sub">
                      {row.data.active
                        ? catName(str(row, "categoryId"))
                        : "已停用"}
                    </span>
                  </span>
                  <span className="mf-amount">
                    {money(str(row, "amountMinor", "0"))} / 月
                  </span>
                </button>
              </React.Fragment>
            ))}
            {recurring.length === 0 && (
              <InkEmpty text="订阅、房租这类每月固定的支出" />
            )}
          </InkCard>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-3)",
              padding: "0 6px",
              lineHeight: 1.5,
            }}
          >
            只作参考，不会自动记账；实际付款当天另记一笔。
          </div>
        </>
      )}

      {/* Basis Picker Action Sheet */}
      <InkActionSheet
        open={basisMenu}
        title="统计口径"
        onClose={() => setBasisMenu(false)}
        items={[
          {
            label: "实际净付款",
            active: basis === "actual",
            onClick: () => setBasis("actual"),
          },
          {
            label: "使用成本 · 期限均摊",
            active: basis === "term",
            onClick: () => setBasis("term"),
          },
          {
            label: "使用成本 · 当下均摊",
            active: basis === "current",
            onClick: () => setBasis("current"),
          },
        ]}
      />

      {/* Top-Right `...` Action Sheet */}
      <InkActionSheet
        open={moreMenu}
        title="花销管理"
        onClose={() => setMoreMenu(false)}
        items={[
          {
            label: "月度预算",
            icon: "sliders",
            onClick: () => setBudgetOpen(true),
          },
          {
            label: "新分类",
            icon: "tag",
            onClick: () => setCategoryOpen(true),
          },
          {
            label: "新固定支出",
            icon: "clock",
            onClick: () => setRecurringEdit(null),
          },
        ]}
      />

      {/* Expense Add/Edit Sheet */}
      <ExpenseSheet
        open={adding || editing !== null}
        record={editing}
        categories={categories}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      />

      {/* Budget Sheet */}
      <BudgetSheet
        open={budgetOpen}
        month={month}
        budget={budget}
        onClose={() => setBudgetOpen(false)}
      />

      {/* Category Sheet */}
      <CategorySheet
        open={categoryOpen}
        categories={categories}
        onClose={() => setCategoryOpen(false)}
      />

      {/* Recurring Expense Sheet */}
      <RecurringSheet
        open={recurringEdit !== undefined}
        record={recurringEdit ?? null}
        categories={categories}
        onClose={() => setRecurringEdit(undefined)}
      />
    </InkScreen>
  );
}

function LongTermRow({
  row,
  asOf,
  onOpen,
}: {
  row: Entity;
  asOf: string;
  onOpen: () => void;
}) {
  const start = str(row, "startDay");
  const end = effectiveEnd(row, asOf);
  const ended = isHistory(row, asOf);
  const planned = Math.max(1, dayCount(start, str(row, "endDay", end)));
  const used = Math.max(0, dayCount(start, asOf < end ? asOf : end));
  const termRate = daily(row, asOf, false);
  const curRate = daily(row, asOf, true);
  return (
    <button type="button" className="mf-long-row" onClick={onOpen}>
      <div className="mf-long-top">
        <span className={"mf-long-name" + (ended ? " ended" : "")}>
          <strong>{str(row, "title")}</strong>
          {ended && <span className="mf-long-pill">已结束</span>}
        </span>
        <span className="mf-amount" style={{ color: ended ? "var(--text-2)" : undefined }}>
          {money(net(row))}
        </span>
      </div>
      <InkMeter progress={Math.min(1, used / planned)} />
      <div className="mf-long-meta">
        {ended
          ? `${start.slice(5)} — ${end.slice(5)} · 用了 ${used} 天`
          : `${MODE_LABEL[str(row, "mode")] ?? str(row, "mode")} · 已用 ${used} / ${planned} 天`}
      </div>
      <div className="mf-long-rates">
        <span>
          期限 <b>{termRate ? money(round(termRate)) : "—"}</b>
        </span>
        <span>
          当下 <b className="now">{curRate ? money(round(curRate)) : "—"}</b>
        </span>
        <span>日均</span>
      </div>
    </button>
  );
}

function ExpenseSheet({
  open,
  record,
  categories,
  onClose,
}: {
  open: boolean;
  record: Entity | null;
  categories: Entity[];
  onClose: () => void;
}) {
  const parents = useMemo(
    () => categories.filter((c) => !str(c, "parentId")),
    [categories],
  );
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [necessary, setNecessary] = useState(true);
  const [day, setDay] = useState(today());
  const [mode, setMode] = useState<"immediate" | "estimated" | "fixed">(
    "immediate",
  );
  const [startDay, setStartDay] = useState(today());
  const [endDay, setEndDay] = useState(shiftDay(today(), 365));
  const [isEnded, setIsEnded] = useState(false);
  const [endedDay, setEndedDay] = useState(today());
  const [recovery, setRecovery] = useState("");
  const [note, setNote] = useState("");
  const [rememberMerchant, setRememberMerchant] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const children = useMemo(
    () =>
      categoryId
        ? categories.filter((c) => str(c, "parentId") === categoryId)
        : [],
    [categories, categoryId],
  );

  React.useEffect(() => {
    if (!open) return;
    setRememberMerchant(false);
    setConfirmDelete(false);
    if (!record) {
      setAmount("");
      setTitle("");
      const first =
        parents.find((p) => p.data.necessary !== false) ?? parents[0];
      setCategoryId(first?.id ?? "");
      setSubcategoryId(first ? str(first, "defaultChildId") : "");
      setNecessary(first ? first.data.necessary !== false : true);
      setDay(today());
      setMode("immediate");
      setStartDay(today());
      setEndDay(shiftDay(today(), 365));
      setIsEnded(false);
      setEndedDay(today());
      setRecovery("");
      setNote("");
      return;
    }
    setAmount(yuanStr(str(record, "amountMinor")));
    setTitle(str(record, "title"));
    setCategoryId(str(record, "categoryId"));
    setSubcategoryId(str(record, "subcategoryId"));
    setNecessary(record.data.necessary !== false);
    const d = str(record, "day", today());
    setDay(d);
    setMode(
      (str(record, "mode", "immediate") as
        | "immediate"
        | "estimated"
        | "fixed"),
    );
    setStartDay(str(record, "startDay", d));
    setEndDay(str(record, "endDay", shiftDay(d, 365)));
    setIsEnded(Boolean(str(record, "endedDay")));
    setEndedDay(str(record, "endedDay", today()));
    setRecovery(
      str(record, "recoveryMinor")
        ? yuanStr(str(record, "recoveryMinor"))
        : "",
    );
    setNote(str(record, "note"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record?.id]);

  const parsedMinor = tryMinor(amount);
  const canSave = Boolean(title.trim() && parsedMinor !== null);

  function save() {
    if (!canSave || parsedMinor === null) return;
    const trimmedTitle = title.trim();
    const data: Data = {
      ...record?.data,
      title: trimmedTitle,
      amountMinor: parsedMinor,
      day,
      necessary,
      mode,
    };
    if (categoryId) data.categoryId = categoryId;
    else delete data.categoryId;
    if (subcategoryId) data.subcategoryId = subcategoryId;
    else delete data.subcategoryId;
    if (note.trim()) data.note = note.trim();
    else delete data.note;

    delete data.startDay;
    delete data.endDay;
    delete data.endedDay;
    delete data.recoveryMinor;
    delete data.recoveryDay;

    if (mode !== "immediate") {
      data.startDay = startDay;
      data.endDay = endDay >= startDay ? endDay : startDay;
      if (isEnded) {
        data.endedDay = endedDay;
        const rMinor = recovery.trim() ? tryMinor(recovery) : null;
        if (rMinor && rMinor !== "0") {
          data.recoveryMinor = rMinor;
          data.recoveryDay = endedDay;
        }
      }
    }

    if (record && rememberMerchant && categoryId) {
      const savedMerchant =
        str(record, "wechatMerchant") ||
        arr(record, "wechatMerchantRule")[0] ||
        str(record, "title").replace(/\s+/g, " ").slice(0, 200);
      if (savedMerchant) {
        data.wechatMerchant = savedMerchant;
        data.wechatMerchantRule = [
          savedMerchant,
          subcategoryId || categoryId,
          new Date().toISOString(),
          trimmedTitle,
        ];
      }
    }

    perform(
      put("expense", data, record ?? undefined).then(() => {
        onClose();
      }),
    );
  }

  return (
    <>
      <InkSheet
        open={open}
        title={
          record
            ? !str(record, "categoryId")
              ? "补分类"
              : "编辑花销"
            : "记一笔"
        }
        onClose={onClose}
        rightLabel="保存"
        rightDisabled={!canSave}
        onRight={save}
      >
        <div className="mf-sheet-amount">
          <span className="mf-sheet-yen">¥</span>
          <input
            className="mf-sheet-amount-input"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            autoFocus={!record}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <input
          className="mk-field-input"
          placeholder="买了什么"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {parents.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--text-3)", paddingLeft: 2 }}>
              用途
            </div>
            <div className="mk-flow-chips">
              {parents.map((p) => {
                const on = categoryId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={"mk-chip" + (on ? " active" : "")}
                    onClick={() => {
                      if (on) {
                        setCategoryId("");
                        setSubcategoryId("");
                      } else {
                        setCategoryId(p.id);
                        setNecessary(p.data.necessary !== false);
                        setSubcategoryId(str(p, "defaultChildId"));
                      }
                    }}
                  >
                    {str(p, "name")}
                  </button>
                );
              })}
            </div>
            {children.length > 0 && (
              <div className="mk-flow-chips">
                {children.map((c) => {
                  const on = subcategoryId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={"mk-chip sm" + (on ? " active" : "")}
                      onClick={() => setSubcategoryId(on ? "" : c.id)}
                    >
                      {str(c, "name")}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="mk-form-group">
          <div className="mk-form-row">
            <span className="mk-form-label">必要支出</span>
            <InkSwitch
              checked={necessary}
              onChange={setNecessary}
              label="必要支出"
            />
          </div>
          <div className="mk-form-row">
            <span className="mk-form-label">日期</span>
            <input
              type="date"
              className="mk-form-input right"
              value={day}
              onChange={(e) => setDay(e.target.value || today())}
            />
          </div>
          <div className="mk-form-row">
            <InkSegmented
              onCard
              options={[
                { value: "immediate", label: "当次" },
                { value: "estimated", label: "预计使用" },
                { value: "fixed", label: "固定期限" },
              ]}
              value={mode}
              onChange={setMode}
            />
          </div>
          {mode !== "immediate" && (
            <>
              <div className="mk-form-row">
                <span className="mk-form-label">开始使用</span>
                <input
                  type="date"
                  className="mk-form-input right"
                  value={startDay}
                  onChange={(e) => setStartDay(e.target.value || day)}
                />
              </div>
              <div className="mk-form-row">
                <span className="mk-form-label">
                  {mode === "fixed" ? "到期" : "预计用到"}
                </span>
                <input
                  type="date"
                  className="mk-form-input right"
                  value={endDay}
                  onChange={(e) => setEndDay(e.target.value || startDay)}
                />
              </div>
              {record && (
                <>
                  <div className="mk-form-row">
                    <span className="mk-form-label">已结束 / 已出售</span>
                    <InkSwitch
                      checked={isEnded}
                      onChange={setIsEnded}
                      label="已结束"
                    />
                  </div>
                  {isEnded && (
                    <>
                      <div className="mk-form-row">
                        <span className="mk-form-label">实际结束</span>
                        <input
                          type="date"
                          className="mk-form-input right"
                          value={endedDay}
                          onChange={(e) => setEndedDay(e.target.value || today())}
                        />
                      </div>
                      <div className="mk-form-row">
                        <span className="mk-form-label">回收金额（元）</span>
                        <input
                          className="mk-form-input right"
                          inputMode="decimal"
                          placeholder="0"
                          value={recovery}
                          onChange={(e) => setRecovery(e.target.value)}
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <textarea
          className="mk-field-textarea"
          style={{ minHeight: 70 }}
          placeholder="备注"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {record && (
          <div className="mk-form-group">
            <div className="mk-form-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, color: "var(--text)" }}>
                  记住这个商户的用途
                </div>
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                  下次同商户的微信支付会沿用名称与分类
                </div>
              </div>
              <InkSwitch
                checked={rememberMerchant}
                onChange={(v) => {
                  if (categoryId) setRememberMerchant(v);
                }}
                label="记住商户规则"
              />
            </div>
          </div>
        )}

        {record && (
          <button
            type="button"
            className="mk-text-btn danger"
            style={{ width: "100%" }}
            onClick={() => setConfirmDelete(true)}
          >
            移入回收站
          </button>
        )}
      </InkSheet>

      <InkActionSheet
        open={confirmDelete}
        title="移入回收站？"
        onClose={() => setConfirmDelete(false)}
        items={[
          {
            label: "移入回收站",
            danger: true,
            onClick: () => {
              if (!record) return;
              perform(
                remove(record).then(() => {
                  onClose();
                }),
              );
            },
          },
        ]}
      />
    </>
  );
}

function BudgetSheet({
  open,
  month,
  budget,
  onClose,
}: {
  open: boolean;
  month: string;
  budget: Entity | undefined;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  React.useEffect(() => {
    if (open) setAmount(budget ? yuanStr(str(budget, "amountMinor")) : "");
  }, [open, budget]);

  const parsed = tryMinor(amount);

  return (
    <InkSheet
      open={open}
      title="月度预算"
      onClose={onClose}
      rightLabel="保存"
      rightDisabled={parsed === null}
      onRight={() => {
        if (parsed === null) return;
        perform(
          putKey("budget", month, { month, amountMinor: parsed }).then(() =>
            onClose(),
          ),
        );
      }}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">{month} 预算（元）</span>
          <input
            className="mk-form-input right"
            inputMode="decimal"
            placeholder="例如 3000"
            value={amount}
            autoFocus
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </div>
    </InkSheet>
  );
}

function CategorySheet({
  open,
  categories,
  onClose,
}: {
  open: boolean;
  categories: Entity[];
  onClose: () => void;
}) {
  const parents = categories.filter((c) => !str(c, "parentId"));
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [necessary, setNecessary] = useState(true);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setParentId("");
    setNecessary(true);
  }, [open]);

  return (
    <InkSheet
      open={open}
      title="新分类"
      onClose={onClose}
      rightLabel="保存"
      rightDisabled={!name.trim()}
      onRight={() => {
        if (!name.trim()) return;
        perform(
          put("category", {
            name: name.trim(),
            ...(parentId ? { parentId } : {}),
            necessary,
          }).then(() => onClose()),
        );
      }}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">名称</span>
          <input
            className="mk-form-input right"
            placeholder="分类名称"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">上级分类</span>
          <select
            className="mk-form-select"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">无（主分类）</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {str(p, "name")}
              </option>
            ))}
          </select>
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">默认必要支出</span>
          <InkSwitch checked={necessary} onChange={setNecessary} />
        </div>
      </div>
    </InkSheet>
  );
}

function RecurringSheet({
  open,
  record,
  categories,
  onClose,
}: {
  open: boolean;
  record: Entity | null;
  categories: Entity[];
  onClose: () => void;
}) {
  const parents = categories.filter((c) => !str(c, "parentId"));
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [active, setActive] = useState(true);

  React.useEffect(() => {
    if (!open) return;
    setName(record ? str(record, "name") : "");
    setAmount(record ? yuanStr(str(record, "amountMinor")) : "");
    setCategoryId(record ? str(record, "categoryId") : "");
    setActive(record ? Boolean(record.data.active) : true);
  }, [open, record]);

  const parsed = tryMinor(amount);

  return (
    <InkSheet
      open={open}
      title={record ? "编辑固定支出" : "新固定支出"}
      onClose={onClose}
      rightLabel="保存"
      rightDisabled={!name.trim() || parsed === null}
      onRight={() => {
        if (!name.trim() || parsed === null) return;
        perform(
          put(
            "recurringExpense",
            {
              name: name.trim(),
              amountMinor: parsed,
              ...(categoryId ? { categoryId } : {}),
              active,
            },
            record ?? undefined,
          ).then(() => onClose()),
        );
      }}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">名称</span>
          <input
            className="mk-form-input right"
            placeholder="如 房租 / iCloud"
            value={name}
            autoFocus={!record}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">每月金额（元）</span>
          <input
            className="mk-form-input right"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">用途</span>
          <select
            className="mk-form-select"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">无</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {str(p, "name")}
              </option>
            ))}
          </select>
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">启用</span>
          <InkSwitch checked={active} onChange={setActive} />
        </div>
      </div>
      {record && (
        <button
          type="button"
          className="mk-text-btn danger"
          style={{ width: "100%" }}
          onClick={() =>
            perform(
              remove(record).then(() => onClose()),
            )
          }
        >
          移入回收站
        </button>
      )}
    </InkSheet>
  );
}
