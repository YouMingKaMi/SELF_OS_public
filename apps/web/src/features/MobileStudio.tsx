import React, { useEffect, useMemo, useState } from "react";
import "./mobile-studio.css";
import { timeSummary } from "../../../../modules/practice/index.ts";
import { belongsToday } from "../../../../modules/tasks/index.ts";
import { metricDays } from "../../../../modules/metrics/index.ts";
import { Icon } from "../ui/Icon.tsx";
import {
  useDatedEntities,
  useEntities,
  useEverything,
  usePending,
  useSyncStatus,
  put,
  synchronize,
  type AnyEntity as Entity,
} from "../data/entities.ts";
import { useTasks, enqueue, taskBlockers, type Task } from "../data/tasks.ts";
import { features, type FeatureKey, type Navigate } from "../navigation.ts";
import { scheduleLabel } from "../scheduling.ts";
import { MobileHabitLine, MobileHabits } from "./mobile/MobileHabits.tsx";
import { MobileNavProvider, useMobileNavState } from "./mobile/MobileKit.tsx";
import {
  habitRule,
  habitScheduled,
  latestHabitLogs,
  habitDone,
} from "./habit-model.ts";
import { money, net, minor } from "./finance-model.ts";
import { nextOccurrence } from "./calendar-model.ts";
import { Timer, controlSession } from "./PracticeTimer.tsx";
import {
  BUILTIN_DEPARTMENTS,
  PRESET_LIST,
  useWorkspaceConfig,
} from "./workspace-config.ts";
import {
  monthNow,
  num,
  perform,
  str,
  arr,
  today,
  usePreference,
} from "../ui/shared.tsx";

const MobileFinance = React.lazy(() =>
  import("./mobile/MobileFinance.tsx").then((m) => ({ default: m.MobileFinance })),
);
const MobileTasks = React.lazy(() =>
  import("./mobile/MobileTasks.tsx").then((m) => ({ default: m.MobileTasks })),
);
const MobileStorage = React.lazy(() =>
  import("./mobile/MobileStorage.tsx").then((m) => ({ default: m.MobileStorage })),
);
const MobilePractice = React.lazy(() =>
  import("./mobile/MobilePractice.tsx").then((m) => ({ default: m.MobilePractice })),
);
const MobileAchievements = React.lazy(() =>
  import("./mobile/MobileAchievements.tsx").then((m) => ({
    default: m.MobileAchievements,
  })),
);
const MobileTreasury = React.lazy(() =>
  import("./mobile/MobileTreasury.tsx").then((m) => ({ default: m.MobileTreasury })),
);
const MobileFreedom = React.lazy(() =>
  import("./mobile/MobileFreedom.tsx").then((m) => ({ default: m.MobileFreedom })),
);
const MobileJournal = React.lazy(() =>
  import("./mobile/MobileJournal.tsx").then((m) => ({ default: m.MobileJournal })),
);
const MobileDocuments = React.lazy(() =>
  import("./mobile/MobileDocuments.tsx").then((m) => ({
    default: m.MobileDocuments,
  })),
);
const MobileMemoir = React.lazy(() =>
  import("./mobile/MobileMemoir.tsx").then((m) => ({ default: m.MobileMemoir })),
);
const MobileImportantDays = React.lazy(() =>
  import("./mobile/MobileLife.tsx").then((m) => ({
    default: m.MobileImportantDays,
  })),
);
const MobileMetrics = React.lazy(() =>
  import("./mobile/MobileLife.tsx").then((m) => ({ default: m.MobileMetrics })),
);
const MobileChecklists = React.lazy(() =>
  import("./mobile/MobileLife.tsx").then((m) => ({ default: m.MobileChecklists })),
);
const MobileReadingList = React.lazy(() =>
  import("./mobile/MobileReadingList.tsx").then((m) => ({
    default: m.MobileReadingList,
  })),
);
const MobileSettings = React.lazy(() =>
  import("./mobile/MobileSettings.tsx").then((m) => ({
    default: m.MobileSettings,
  })),
);

type MobileTab = "today" | "shortcuts" | "departments" | "review" | "search";
type MobileRoute =
  | { kind: "dept"; id: string }
  | { kind: "feature"; key: FeatureKey }
  | { kind: "settings" };
type TodayCardKey =
  | "now"
  | "chronicle"
  | "pair"
  | "tasks"
  | "next"
  | "habits"
  | "days"
  | "metrics";
type QuickCaptureKind = "chronicle" | "expense" | "task" | "idea" | "raw";

const ALL_TODAY_CARDS: { key: TodayCardKey; name: string }[] = [
  { key: "now", name: "此刻推进" },
  { key: "chronicle", name: "记录与回顾" },
  { key: "pair", name: "花销与积累" },
  { key: "tasks", name: "待办" },
  { key: "next", name: "接下来" },
  { key: "habits", name: "习惯" },
  { key: "days", name: "重要日子" },
  { key: "metrics", name: "每日指标" },
];

const DEPT_MARKS: Record<string, string> = {
  执行部: "dept-exec",
  财政部: "dept-finance",
  档案库: "dept-archive",
  中科院: "dept-academy",
};

const KIND_LABELS: Record<string, string> = {
  document: "文章",
  journal: "记录",
  memoir: "回忆录",
  storageBox: "储物箱",
  storageItem: "物品",
  idea: "想法",
  readingItem: "收藏",
  expense: "消费",
  problem: "问题",
  solution: "方案",
  progress: "进展",
  domain: "领域",
  activity: "子领域",
  session: "计时",
  habit: "习惯",
  metric: "指标",
  wallet: "账户",
  importantDay: "日子",
  checklist: "清单",
  achievement: "成就",
};

function entityFeature(e: Entity): FeatureKey {
  switch (e.type) {
    case "document":
      return e.data.kind === "monthly"
        ? "monthly"
        : e.data.kind === "thought"
          ? "thoughts"
          : "notes";
    case "journal":
      return e.data.kind === "raw" ? "raw" : "chronicle";
    case "memoir":
      return "memoir";
    case "storageBox":
    case "storageItem":
      return "storage";
    case "idea":
      return "ideas";
    case "readingItem":
      return "reading";
    case "expense":
    case "category":
    case "budget":
    case "recurringExpense":
      return "expenses";
    case "wallet":
    case "walletEntry":
      return "treasury";
    case "habit":
    case "habitLog":
      return "habits";
    case "metric":
    case "metricLog":
      return "metrics";
    case "importantDay":
      return "days";
    case "checklist":
      return "checklists";
    case "achievement":
      return "achievements";
    default:
      return "practice";
  }
}

function shiftDay(iso: string, delta: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function weekdayChar(iso: string): string {
  return "日一二三四五六"[new Date(iso + "T12:00:00Z").getUTCDay()] ?? "";
}

function shortDate(iso: string): string {
  return `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
}

function formatSpan(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  if (mins < 60) return `${mins}分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}小时` : `${h}小时${m}分`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}年${m}月`;
}

function parsePositiveMinor(input: string): string | null {
  try {
    const val = minor(input);
    return BigInt(val) > 0n ? val : null;
  } catch {
    return null;
  }
}

export function MobileStudio({
  initialFeature,
  theme,
  setTheme,
}: {
  initialFeature: FeatureKey;
  theme: string;
  setTheme: (next: string) => void;
}) {
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);
  return (
    <MobileNavProvider portalEl={toolbarEl}>
      <MobileStudioInner
        initialFeature={initialFeature}
        theme={theme}
        setTheme={setTheme}
        setToolbarEl={setToolbarEl}
      />
    </MobileNavProvider>
  );
}

function MobileStudioInner({
  initialFeature,
  theme,
  setTheme,
  setToolbarEl,
}: {
  initialFeature: FeatureKey;
  theme: string;
  setTheme: (next: string) => void;
  setToolbarEl: (el: HTMLDivElement | null) => void;
}) {
  const ws = useWorkspaceConfig();
  const navCtx = useMobileNavState();
  const { state: syncState } = useSyncStatus(true);
  const conflicts = usePending().filter(
    (p) => p.state === "conflict" || p.state === "error",
  );

  const [tab, setTab] = useState<MobileTab>(() => {
    if (initialFeature === "departments") return "departments";
    if (initialFeature === "discover") return "search";
    return "today";
  });
  const [stack, setStack] = useState<MobileRoute[]>(() => {
    if (
      initialFeature === "home" ||
      initialFeature === "departments" ||
      initialFeature === "discover"
    ) {
      return [];
    }
    if (initialFeature === "settings") return [{ kind: "settings" }];
    return [{ kind: "feature", key: initialFeature }];
  });

  const [practiceRequest, setPracticeRequest] = useState<{ id: string }>();
  const [captureMenu, setCaptureMenu] = useState(false);
  const [capture, setCapture] = useState<QuickCaptureKind | null>(null);
  const [arranging, setArranging] = useState(false);
  const [editingShortcuts, setEditingShortcuts] = useState(false);
  const [creatingDept, setCreatingDept] = useState(false);

  const top = stack.at(-1);
  const activeSub = navCtx?.subPages.at(-1) ?? null;

  const navigate: Navigate = (key) => {
    if (key === "home") {
      setTab("today");
      setStack([]);
      return;
    }
    if (key === "departments") {
      setTab("departments");
      setStack([]);
      return;
    }
    if (key === "discover") {
      setTab("search");
      setStack([]);
      return;
    }
    if (key === "settings") {
      setStack((prev) => [...prev, { kind: "settings" }]);
      return;
    }
    setStack((prev) => [...prev, { kind: "feature", key }]);
  };

  function pop() {
    setStack((prev) => prev.slice(0, -1));
  }

  useEffect(() => {
    window.__selfOSHandleBack = () => {
      if (navCtx?.consumeBack()) return true;
      if (capture) {
        setCapture(null);
        return true;
      }
      if (captureMenu) {
        setCaptureMenu(false);
        return true;
      }
      if (arranging) {
        setArranging(false);
        return true;
      }
      if (editingShortcuts) {
        setEditingShortcuts(false);
        return true;
      }
      if (creatingDept) {
        setCreatingDept(false);
        return true;
      }
      if (stack.length > 0) {
        setStack((prev) => prev.slice(0, -1));
        return true;
      }
      if (tab !== "today") {
        setTab("today");
        return true;
      }
      return false;
    };
    return () => {
      delete window.__selfOSHandleBack;
    };
  }, [navCtx, capture, captureMenu, arranging, editingShortcuts, creatingDept, stack.length, tab]);

  const pushedTitle =
    top?.kind === "settings"
      ? "设置"
      : top?.kind === "feature"
        ? ws.labelOf(top.key)
        : top?.kind === "dept"
          ? BUILTIN_DEPARTMENTS.includes(top.id as (typeof BUILTIN_DEPARTMENTS)[number])
            ? ws.departmentLabel(top.id)
            : top.id
          : "";

  const backLabel =
    stack.length > 1
      ? "返回"
      : tab === "today"
        ? "今日"
        : tab === "shortcuts"
          ? "快捷"
          : tab === "departments"
            ? "部门"
            : tab === "review"
              ? "回顾"
              : "搜索";

  const showAttention =
    conflicts.length > 0 ||
    syncState === "offline" ||
    syncState === "unreachable" ||
    syncState === "attention";
  const syncLabel =
    syncState === "local"
      ? "仅本机"
      : conflicts.length > 0 || syncState === "attention"
        ? "待处理"
        : syncState === "offline" || syncState === "unreachable"
          ? "离线"
          : syncState === "connecting"
            ? "同步中"
            : "已同步";

  function renderMobileFeature(key: FeatureKey) {
    switch (key) {
      case "habits":
        return <MobileHabits />;
      case "expenses":
        return <MobileFinance />;
      case "tasks":
        return <MobileTasks />;
      case "storage":
        return <MobileStorage />;
      case "practice":
        return <MobilePractice eventRequest={practiceRequest} />;
      case "achievements":
        return <MobileAchievements />;
      case "treasury":
        return <MobileTreasury />;
      case "freedom":
        return <MobileFreedom />;
      case "chronicle":
        return (
          <MobileJournal
            kind="chronicle"
            onOpenMemoir={() => navigate("memoir")}
          />
        );
      case "raw":
        return (
          <MobileJournal
            kind="raw"
            onOpenTarget={(t) => navigate(t.kind === "idea" ? "ideas" : "raw")}
          />
        );
      case "ideas":
        return (
          <MobileJournal
            kind="idea"
            onOpenTarget={(t) => navigate(t.kind === "idea" ? "ideas" : "raw")}
          />
        );
      case "monthly":
        return <MobileDocuments kind="monthly" />;
      case "notes":
        return <MobileDocuments kind="note" />;
      case "thoughts":
        return <MobileDocuments kind="thought" />;
      case "memoir":
        return <MobileMemoir onOpenChronicle={() => navigate("chronicle")} />;
      case "days":
        return <MobileImportantDays />;
      case "metrics":
        return <MobileMetrics />;
      case "checklists":
        return <MobileChecklists />;
      case "reading":
        return (
          <MobileReadingList
            openEvent={(id) => {
              setPracticeRequest({ id });
              navigate("practice");
            }}
          />
        );
      case "settings":
        return <MobileSettings theme={theme} setTheme={setTheme} />;
      default:
        return null;
    }
  }

  return (
    <div className="ms-shell">
      <header className="ms-navbar">
        <div className="ms-nav-left">
          {top && (
            <button
              type="button"
              className="ms-nav-back"
              onClick={() => (activeSub ? activeSub.onBackRef.current() : pop())}
            >
              <Icon name="chevron-left" size={16} />
              <span>{activeSub ? (activeSub.backLabel ?? pushedTitle) : backLabel}</span>
            </button>
          )}
        </div>
        {top && <div className="ms-nav-title">{activeSub ? activeSub.title : pushedTitle}</div>}
        <div className="ms-nav-right">
          {!top && tab === "today" && (
            <>
              <button
                type="button"
                className="ms-nav-icon-btn"
                aria-label="调整首页"
                onClick={() => setArranging(true)}
              >
                <Icon name="sliders" size={17} />
              </button>
              <button
                type="button"
                className="ms-nav-icon-btn"
                aria-label="快速记录"
                onClick={() => setCaptureMenu(true)}
              >
                <Icon name="plus" size={18} />
              </button>
            </>
          )}
          {!top && tab === "shortcuts" && (
            <button
              type="button"
              className="ms-nav-text-btn"
              onClick={() => setEditingShortcuts(true)}
            >
              编辑
            </button>
          )}
          {!top && tab === "review" && (
            <button
              type="button"
              className="ms-nav-icon-btn"
              aria-label="设置"
              onClick={() => setStack([{ kind: "settings" }])}
            >
              <Icon name="gear" size={17} />
            </button>
          )}
          {top && <div className="ms-nav-portal" ref={setToolbarEl} />}
        </div>
      </header>

      <main className={"ms-scroll" + (top ? " pushed" : "")}>
        {top ? (
          top.kind === "dept" ? (
            <MobileDepartmentDetail
              deptId={top.id}
              onOpenFeature={(key) => setStack((prev) => [...prev, { kind: "feature", key }])}
            />
          ) : (
            <div className="ms-pushed-body" key={top.kind === "settings" ? "settings" : top.key}>
              <React.Suspense fallback={<div className="ms-empty-note">正在打开…</div>}>
                {renderMobileFeature(top.kind === "settings" ? "settings" : top.key)}
              </React.Suspense>
            </div>
          )
        ) : tab === "today" ? (
          <MobileTodayScreen
            syncLabel={syncLabel}
            showAttention={showAttention}
            onSync={() =>
              syncState === "local"
                ? setStack([{ kind: "settings" }])
                : void synchronize()
            }
            onOpenFeature={(key) => setStack([{ kind: "feature", key }])}
            onCapture={(kind) => setCapture(kind)}
            arranging={arranging}
            setArranging={setArranging}
          />
        ) : tab === "shortcuts" ? (
          <MobileShortcutsScreen
            onOpenFeature={(key) => setStack([{ kind: "feature", key }])}
            editing={editingShortcuts}
            setEditing={setEditingShortcuts}
          />
        ) : tab === "departments" ? (
          <MobileDepartmentsScreen
            onOpenDept={(id) => setStack([{ kind: "dept", id }])}
            creating={creatingDept}
            setCreating={setCreatingDept}
          />
        ) : tab === "review" ? (
          <MobileReviewScreen />
        ) : (
          <MobileSearchScreen
            onOpenFeature={(key) => setStack([{ kind: "feature", key }])}
          />
        )}
      </main>

      {!top && (
        <div className="ms-tabbar-wrap">
          <nav className="ms-tab-pill" aria-label="主导航">
            {(
              [
                ["today", "今日", "today-grid"],
                ["shortcuts", "快捷", "shortcuts"],
                ["departments", "部门", "dept-tab"],
                ["review", "回顾", "review"],
              ] as const
            ).map(([key, label, icon]) => (
              <button
                key={key}
                type="button"
                className={"ms-tab-btn" + (tab === key ? " active" : "")}
                onClick={() => setTab(key)}
              >
                <Icon name={icon} size={20} />
                <small>{label}</small>
              </button>
            ))}
          </nav>
          <button
            type="button"
            aria-label="搜索"
            className={"ms-tab-search" + (tab === "search" ? " active" : "")}
            onClick={() => setTab("search")}
          >
            <Icon name="discover" size={20} />
          </button>
        </div>
      )}

      {captureMenu && (
        <div className="ms-sheet-backdrop" onClick={() => setCaptureMenu(false)}>
          <div className="ms-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ms-sheet-head">
              <strong>快速记录</strong>
              <button
                type="button"
                className="ms-sheet-done"
                onClick={() => setCaptureMenu(false)}
              >
                关闭
              </button>
            </div>
            <div className="ms-sheet-list">
              {(
                [
                  ["chronicle", "chronicle", "记一件事"],
                  ["expenses", "expense", "记一笔花销"],
                  ["tasks", "task", "添加任务"],
                  ["ideas", "idea", "暂存想法"],
                  ["raw", "raw", "收集原料"],
                ] as const
              )
                .filter(([feat]) => ws.isEnabled(feat))
                .map(([feat, kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    className="ms-sheet-row"
                    onClick={() => {
                      setCaptureMenu(false);
                      setCapture(kind);
                    }}
                  >
                    <span className="ms-sheet-row-left">
                      <Icon name={feat} size={18} />
                      <span>{label}</span>
                    </span>
                    <Icon name="chevron-right" size={14} />
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {capture && (
        <QuickCaptureSheet
          kind={capture}
          onClose={() => setCapture(null)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── 1. TodayScreen (Today.swift 1:1) ─────────────────────────── */

function MobileTodayScreen({
  syncLabel,
  showAttention,
  onSync,
  onOpenFeature,
  onCapture,
  arranging,
  setArranging,
}: {
  syncLabel: string;
  showAttention: boolean;
  onSync: () => void;
  onOpenFeature: (key: FeatureKey) => void;
  onCapture: (kind: QuickCaptureKind) => void;
  arranging: boolean;
  setArranging: (v: boolean) => void;
}) {
  const day = today();
  const month = day.slice(0, 7);
  const ws = useWorkspaceConfig();
  const [cardOrder, setCardOrder] = usePreference<TodayCardKey[]>(
    "mobile-today-cards",
    ALL_TODAY_CARDS.map((c) => c.key),
  );
  const [domainId, setDomainId] = usePreference("practice-domain", "");
  const [activityId, setActivityId] = useState("");
  const [timerMenu, setTimerMenu] = useState(false);

  const { entities: ref } = useEntities(
    "domain",
    "activity",
    "session",
    "habit",
    "habitRule",
    "metric",
    "importantDay",
  );
  const daily = useDatedEntities(day, day, "habitLog", "journal", "metricLog");
  const monthExpenses = useDatedEntities(month + "-01", month + "-31", "expense");
  const { tasks } = useTasks();

  const entities = useMemo(() => [...ref, ...daily], [ref, daily]);
  const blockers = useMemo(() => taskBlockers(tasks), [tasks]);
  const domains = useMemo(
    () =>
      ref
        .filter((e) => e.type === "domain")
        .sort((a, b) => num(a, "order") - num(b, "order")),
    [ref],
  );
  const domain =
    domains.find((d) => d.id === domainId) ??
    domains.find((d) => d.data.focused) ??
    domains[0];
  const activities = useMemo(
    () =>
      ref.filter(
        (e) =>
          e.type === "activity" &&
          e.data.domainId === domain?.id &&
          !e.data.archived,
      ),
    [ref, domain?.id],
  );
  const running = useMemo(
    () =>
      ref.find(
        (e) =>
          e.type === "session" &&
          ["running", "paused"].includes(str(e, "status")),
      ),
    [ref],
  );
  const summary = useMemo(
    () =>
      timeSummary(
        ref.filter((e) => e.type === "session"),
        Date.now(),
      ),
    [ref],
  );
  const todaySeconds = summary.daily[day] ?? 0;
  const weekSeconds = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => summary.daily[shiftDay(day, -i)] ?? 0).reduce(
        (a, b) => a + b,
        0,
      ),
    [summary, day],
  );

  const todaySpend = useMemo(
    () =>
      monthExpenses
        .filter((e) => e.data.day === day)
        .reduce((sum, e) => sum + net(e), 0n),
    [monthExpenses, day],
  );
  const monthSpend = useMemo(
    () => monthExpenses.reduce((sum, e) => sum + net(e), 0n),
    [monthExpenses],
  );

  const chronicleLines = useMemo(
    () =>
      daily
        .filter((e) => e.type === "journal" && e.data.kind === "chronicle")
        .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)),
    [daily],
  );

  const todayTasks = useMemo(
    () => tasks.filter((t) => belongsToday(t, day)),
    [tasks, day],
  );
  const nextTasks = useMemo(
    () =>
      tasks
        .filter(
          (t) =>
            t.status === "pending" &&
            !belongsToday(t, day) &&
            (blockers.get(t.id)?.length ?? 0) === 0,
        )
        .slice(0, 5),
    [tasks, day, blockers],
  );

  const homeHabits = useMemo(
    () =>
      entities
        .filter(
          (e) =>
            e.type === "habit" &&
            e.data.status === "active" &&
            e.data.showHome &&
            habitScheduled(habitRule(e, day, entities), day) &&
            !latestHabitLogs(e.id, entities).get(day)?.data.hidden,
        )
        .sort((a, b) => num(a, "order") - num(b, "order")),
    [entities, day],
  );

  const soonDays = useMemo(
    () =>
      ref
        .filter((e) => e.type === "importantDay")
        .map((e) => {
          const next = nextOccurrence(e, day);
          const days = next
            ? Math.round(
                (Date.parse(next + "T12:00:00Z") -
                  Date.parse(day + "T12:00:00Z")) /
                  86400000,
              )
            : null;
          return { entity: e, next, days };
        })
        .filter(
          (item): item is { entity: Entity; next: string; days: number } =>
            item.next !== null &&
            item.days !== null &&
            item.days >= 0 &&
            item.days <= Math.max(30, num(item.entity, "remindDays")),
        )
        .sort((a, b) => a.days - b.days)
        .slice(0, 3),
    [ref, day],
  );

  const metrics = useMemo(() => ref.filter((e) => e.type === "metric"), [ref]);
  const metricReadings = useMemo(
    () => metricDays(daily.filter((e) => e.type === "metricLog")),
    [daily],
  );

  const isFreshEmpty =
    !ws.record && ref.length === 0 && tasks.length === 0 && monthExpenses.length === 0;

  async function startSession() {
    if (!domain || running) return;
    const act = activities.find((a) => a.id === activityId);
    const ts = new Date().toISOString();
    await put("session", {
      domainId: domain.id,
      ...(act ? { activityId: act.id } : {}),
      title: act ? str(act, "name") : str(domain, "name"),
      day,
      startedAt: ts,
      runningSince: ts,
      elapsedSeconds: 0,
      segments: [],
      status: "running",
      manual: false,
    });
  }

  function isCardEnabled(key: TodayCardKey): boolean {
    switch (key) {
      case "now":
        return ws.isEnabled("practice");
      case "chronicle":
        return ws.isEnabled("chronicle");
      case "pair":
        return ws.isEnabled("expenses") || ws.isEnabled("practice");
      case "tasks":
      case "next":
        return ws.isEnabled("tasks");
      case "habits":
        return ws.isEnabled("habits");
      case "days":
        return ws.isEnabled("days");
      case "metrics":
        return ws.isEnabled("metrics");
    }
  }

  const visibleCards = cardOrder.filter(isCardEnabled);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => shiftDay(day, i - 6)),
    [day],
  );
  const weekPeak = Math.max(...weekDays.map((d) => summary.daily[d] ?? 0), 1);

  return (
    <>
      <div className="ms-display-head">
        <div>
          <h1>{shortDate(day)}</h1>
          <div className="ms-display-sub">
            周{weekdayChar(day)} · 今天，也在慢慢向前
          </div>
        </div>
        <button
          type="button"
          className={"ms-sync-badge" + (showAttention ? " warn" : "")}
          onClick={onSync}
        >
          <span className="ms-sync-dot" />
          <span>{syncLabel}</span>
        </button>
      </div>

      {isFreshEmpty && (
        <section className="ms-card">
          <div className="ms-card-head">
            <span className="ms-card-title">选择起点模式</span>
            <span className="ms-card-meta">随时可在设置调整</span>
          </div>
          <div className="ms-chip-bar">
            {PRESET_LIST.map((p) => (
              <button
                key={p.id}
                type="button"
                className="ms-chip"
                onClick={() => perform(ws.applyPreset(p.id))}
              >
                {p.title} · {p.badge}
              </button>
            ))}
          </div>
        </section>
      )}

      {visibleCards.map((card) => {
        if (card === "now") {
          return (
            <section className="ms-card" key="now">
              <button
                type="button"
                className="ms-card-head-btn"
                onClick={() => onOpenFeature("practice")}
              >
                <span className="ms-card-icon">
                  <Icon name="practice" size={15} />
                </span>
                <span className="ms-card-title">此刻</span>
                {!running && <span className="ms-card-meta">准备开始</span>}
              </button>
              {running ? (
                <>
                  <div className="ms-live-top">
                    <span
                      className={
                        "ms-live-dot" +
                        (running.data.status === "running" ? "" : " paused")
                      }
                    />
                    <span>
                      {running.data.status === "running" ? "正在推进" : "已暂停"} ·{" "}
                      {str(
                        domains.find((d) => d.id === running.data.domainId),
                        "name",
                      )}
                    </span>
                  </div>
                  <div className="ms-live-title">{str(running, "title")}</div>
                  <div className="ms-live-row">
                    <div
                      className={
                        "ms-live-digits" +
                        (running.data.status === "running" ? "" : " paused")
                      }
                    >
                      <Timer session={running} />
                    </div>
                    <button
                      type="button"
                      className="ms-more-circle"
                      aria-label="本次计时选项"
                      onClick={() => setTimerMenu(true)}
                    >
                      <Icon name="ellipsis" size={18} />
                    </button>
                    <button
                      type="button"
                      className="ms-play-circle"
                      aria-label={running.data.status === "running" ? "暂停" : "继续"}
                      onClick={() =>
                        perform(
                          controlSession(
                            running,
                            running.data.status === "running" ? "pause" : "resume",
                          ),
                        )
                      }
                    >
                      <Icon
                        name={running.data.status === "running" ? "pause" : "play"}
                        size={20}
                      />
                    </button>
                  </div>
                </>
              ) : (
                <div className="ms-now-idle">
                  <div className="ms-now-pickers">
                    {domains.length > 0 ? (
                      <>
                        <select
                          className="ms-domain-select"
                          aria-label="选择推进领域"
                          value={domain?.id ?? ""}
                          onChange={(e) => {
                            setDomainId(e.target.value);
                            setActivityId("");
                          }}
                        >
                          {domains.map((d) => (
                            <option key={d.id} value={d.id}>
                              {str(d, "name")}
                            </option>
                          ))}
                        </select>
                        <select
                          className="ms-activity-select"
                          aria-label="选择推进子领域"
                          value={activityId}
                          onChange={(e) => setActivityId(e.target.value)}
                        >
                          <option value="">直接推进领域</option>
                          {activities.map((a) => (
                            <option key={a.id} value={a.id}>
                              {str(a, "name")}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="ms-card-head-btn"
                        onClick={() => onOpenFeature("practice")}
                      >
                        <strong style={{ fontSize: 22 }}>添加领域</strong>
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    className="ms-play-circle"
                    aria-label="开始推进"
                    disabled={!domain}
                    onClick={() => perform(startSession())}
                  >
                    <Icon name="play" size={20} />
                  </button>
                </div>
              )}
            </section>
          );
        }

        if (card === "chronicle") {
          return (
            <section className="ms-card" key="chronicle">
              <button
                type="button"
                className="ms-card-head-btn"
                onClick={() => onOpenFeature("chronicle")}
              >
                <span className="ms-card-icon">
                  <Icon name="chronicle" size={15} />
                </span>
                <span className="ms-card-title">记录与回顾</span>
                <span className="ms-card-meta">{chronicleLines.length} 件事</span>
              </button>
              <div className="ms-stack-rows">
                {chronicleLines.map((line, i) => (
                  <React.Fragment key={line.id}>
                    {i > 0 && <div className="ms-hairline" />}
                    <button
                      type="button"
                      className="ms-chronicle-line"
                      onClick={() => onOpenFeature("chronicle")}
                    >
                      {str(line, "body")}
                    </button>
                  </React.Fragment>
                ))}
                {chronicleLines.length > 0 && <div className="ms-hairline" />}
                <button
                  type="button"
                  className="ms-inline-add-row"
                  onClick={() => onCapture("chronicle")}
                >
                  <Icon name="plus" size={16} />
                  <span>写一件事</span>
                </button>
              </div>
            </section>
          );
        }

        if (card === "pair") {
          return (
            <div className="ms-pair-grid" key="pair">
              {ws.isEnabled("expenses") && (
                <section className="ms-card">
                  <button
                    type="button"
                    className="ms-card-head-btn"
                    onClick={() => onOpenFeature("expenses")}
                  >
                    <span className="ms-card-icon">
                      <Icon name="expenses" size={15} />
                    </span>
                    <span className="ms-card-title">今日花销</span>
                  </button>
                  <div onClick={() => onOpenFeature("expenses")}>
                    <div className="ms-figure-mid">{money(todaySpend)}</div>
                    <div className="ms-figure-caption">本月 {money(monthSpend)}</div>
                  </div>
                  <div className="ms-pair-foot">
                    <button
                      type="button"
                      className="ms-chip-btn"
                      onClick={() => onCapture("expense")}
                    >
                      <Icon name="plus" size={14} />
                      <span>记一笔</span>
                    </button>
                  </div>
                </section>
              )}
              {ws.isEnabled("practice") && (
                <section className="ms-card" onClick={() => onOpenFeature("practice")}>
                  <div className="ms-card-head">
                    <span className="ms-card-icon">
                      <Icon name="days" size={15} />
                    </span>
                    <span className="ms-card-title">今日积累</span>
                  </div>
                  <div>
                    <div className="ms-figure-mid">{formatSpan(todaySeconds)}</div>
                    <div className="ms-figure-caption">本周 {formatSpan(weekSeconds)}</div>
                  </div>
                  <div className="ms-pair-foot">
                    <div className="ms-week-bars">
                      {weekDays.map((d) => {
                        const val = summary.daily[d] ?? 0;
                        const h = Math.max(4, Math.round((24 * val) / weekPeak));
                        return (
                          <div className="ms-week-bar-col" key={d}>
                            <span
                              className={"ms-week-bar-pill" + (d === day ? " today" : "")}
                              style={{ height: h }}
                            />
                            <span
                              className={"ms-week-bar-day" + (d === day ? " today" : "")}
                            >
                              {weekdayChar(d)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>
              )}
            </div>
          );
        }

        if (card === "tasks") {
          return (
            <section className="ms-card" key="tasks">
              <button
                type="button"
                className="ms-card-head-btn"
                onClick={() => onOpenFeature("tasks")}
              >
                <span className="ms-card-icon">
                  <Icon name="tasks" size={15} />
                </span>
                <span className="ms-card-title">待办</span>
                <span className="ms-card-meta">{todayTasks.length} 项</span>
              </button>
              <div className="ms-stack-rows">
                {todayTasks.slice(0, 6).map((task, idx) => (
                  <React.Fragment key={task.id}>
                    {idx > 0 && <div className="ms-hairline inset-36" />}
                    <MobileTaskRow
                      task={task}
                      blocked={(blockers.get(task.id)?.length ?? 0) > 0}
                      todayIso={day}
                      onOpen={() => onOpenFeature("tasks")}
                    />
                  </React.Fragment>
                ))}
                {todayTasks.length === 0 && (
                  <div className="ms-empty-note">
                    今天没有安排，可以开始一件想做的事。
                  </div>
                )}
                <button
                  type="button"
                  className="ms-inline-add-row"
                  onClick={() => onCapture("task")}
                >
                  <Icon name="plus" size={16} />
                  <span>添加任务</span>
                </button>
              </div>
            </section>
          );
        }

        if (card === "next") {
          return (
            <section className="ms-card" key="next">
              <div className="ms-card-head">
                <span className="ms-card-icon">
                  <Icon name="check" size={15} />
                </span>
                <span className="ms-card-title">接下来</span>
                <button
                  type="button"
                  className="ms-card-meta"
                  style={{ border: 0, background: "transparent", padding: 0 }}
                  onClick={() => onOpenFeature("tasks")}
                >
                  查看全部
                  <Icon name="chevron-right" size={12} />
                </button>
              </div>
              <div className="ms-stack-rows">
                {nextTasks.map((task, idx) => (
                  <React.Fragment key={task.id}>
                    {idx > 0 && <div className="ms-hairline inset-36" />}
                    <MobileTaskRow
                      task={task}
                      blocked={false}
                      todayIso={day}
                      onOpen={() => onOpenFeature("tasks")}
                    />
                  </React.Fragment>
                ))}
                {nextTasks.length === 0 && (
                  <div className="ms-empty-note">现在没有可做的任务</div>
                )}
              </div>
            </section>
          );
        }

        if (card === "habits") {
          if (homeHabits.length === 0) return null;
          const doneCount = homeHabits.filter((h) => {
            const rule = habitRule(h, day, entities);
            const log = latestHabitLogs(h.id, entities).get(day);
            return habitDone(h, log, rule);
          }).length;
          return (
            <section className="ms-card" key="habits">
              <button
                type="button"
                className="ms-card-head-btn"
                onClick={() => onOpenFeature("habits")}
              >
                <span className="ms-card-icon">
                  <Icon name="habits" size={15} />
                </span>
                <span className="ms-card-title">习惯</span>
                <span className="ms-card-meta">
                  {doneCount}/{homeHabits.length}
                </span>
              </button>
              <div className="ms-stack-rows">
                {homeHabits.map((h, idx) => (
                  <React.Fragment key={h.id}>
                    {idx > 0 && <div className="ms-hairline inset-36" />}
                    <MobileHabitLine habit={h} day={day} all={entities} />
                  </React.Fragment>
                ))}
              </div>
            </section>
          );
        }

        if (card === "days") {
          if (soonDays.length === 0) return null;
          return (
            <section className="ms-card" key="days">
              <button
                type="button"
                className="ms-card-head-btn"
                onClick={() => onOpenFeature("days")}
              >
                <span className="ms-card-icon">
                  <Icon name="days" size={15} />
                </span>
                <span className="ms-card-title">重要日子</span>
              </button>
              <div className="ms-stack-rows">
                {soonDays.map(({ entity, next, days }, idx) => (
                  <React.Fragment key={entity.id}>
                    {idx > 0 && <div className="ms-hairline" />}
                    <div
                      className="ms-day-row"
                      onClick={() => onOpenFeature("days")}
                    >
                      <div>
                        <strong>{str(entity, "name", str(entity, "title"))}</strong>
                        <small>{next}</small>
                      </div>
                      {days === 0 ? (
                        <span className="ms-day-today">今天</span>
                      ) : (
                        <span className="ms-day-count">
                          <b>{days}</b>
                          <span>天</span>
                        </span>
                      )}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </section>
          );
        }

        if (card === "metrics") {
          if (metrics.length === 0) return null;
          return (
            <section
              className="ms-card"
              key="metrics"
              onClick={() => onOpenFeature("metrics")}
            >
              <div className="ms-card-head">
                <span className="ms-card-icon">
                  <Icon name="metrics" size={15} />
                </span>
                <span className="ms-card-title">每日指标</span>
                <span className="ms-card-meta">
                  <Icon name="chevron-right" size={13} />
                </span>
              </div>
              <div className="ms-metrics-row">
                {metrics.slice(0, 3).map((m) => {
                  const v = metricReadings.get(m.id)?.get(day);
                  return (
                    <div className="ms-metric-cell" key={m.id}>
                      <small>{str(m, "name", str(m, "title"))}</small>
                      <strong>
                        {v?.value == null ? "—" : v.value}
                        {str(m, "unit") && <em>{str(m, "unit")}</em>}
                      </strong>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        }

        return null;
      })}

      {timerMenu && running && (
        <div className="ms-sheet-backdrop" onClick={() => setTimerMenu(false)}>
          <div className="ms-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ms-sheet-head">
              <strong>本次计时</strong>
              <button
                type="button"
                className="ms-sheet-done"
                onClick={() => setTimerMenu(false)}
              >
                关闭
              </button>
            </div>
            <div className="ms-sheet-list">
              <button
                type="button"
                className="ms-sheet-row"
                onClick={() => {
                  setTimerMenu(false);
                  perform(controlSession(running, "finish"));
                }}
              >
                <span>结束并保存</span>
              </button>
              <button
                type="button"
                className="ms-sheet-row danger"
                onClick={() => {
                  setTimerMenu(false);
                  perform(controlSession(running, "cancel"));
                }}
              >
                <span>取消本次计时</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {arranging && (
        <div className="ms-sheet-backdrop" onClick={() => setArranging(false)}>
          <div className="ms-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ms-sheet-head">
              <strong>调整今日</strong>
              <button
                type="button"
                className="ms-sheet-done"
                onClick={() => setArranging(false)}
              >
                完成
              </button>
            </div>
            <div className="ms-sheet-list">
              {ALL_TODAY_CARDS.map((card) => {
                const enabled = cardOrder.includes(card.key);
                const idx = cardOrder.indexOf(card.key);
                return (
                  <div className="ms-sheet-row" key={card.key}>
                    <span>{card.name}</span>
                    <span className="ms-order-btns">
                      {enabled && idx > 0 && (
                        <button
                          type="button"
                          className="ms-mini-pill"
                          onClick={() => {
                            const next = [...cardOrder];
                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                            setCardOrder(next);
                          }}
                        >
                          ↑
                        </button>
                      )}
                      {enabled && idx < cardOrder.length - 1 && (
                        <button
                          type="button"
                          className="ms-mini-pill"
                          onClick={() => {
                            const next = [...cardOrder];
                            [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                            setCardOrder(next);
                          }}
                        >
                          ↓
                        </button>
                      )}
                      <button
                        type="button"
                        className={"ms-mini-pill" + (enabled ? " on" : "")}
                        onClick={() => {
                          setCardOrder(
                            enabled
                              ? cardOrder.filter((k) => k !== card.key)
                              : [...cardOrder, card.key],
                          );
                        }}
                      >
                        {enabled ? "显示" : "隐藏"}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MobileTaskRow({
  task,
  blocked,
  todayIso,
  onOpen,
}: {
  task: Task;
  blocked: boolean;
  todayIso: string;
  onOpen: () => void;
}) {
  const done = task.status === "completed";
  const overdue =
    task.schedule.kind === "deadline" && task.schedule.date < todayIso;
  return (
    <div className="ms-task-line">
      <button
        type="button"
        className="ms-ring-btn"
        disabled={blocked}
        aria-label={(done ? "恢复 " : "完成 ") + task.title}
        style={{ opacity: blocked ? 0.35 : 1 }}
        onClick={() => perform(enqueue(done ? "reopen" : "complete", task.id))}
      >
        <span className={"ms-ring" + (done ? " done" : "")}>
          {done && <Icon name="check" size={12} />}
        </span>
      </button>
      <button type="button" className="ms-task-body" onClick={onOpen}>
        <span className={"ms-task-title" + (done ? " done" : "")}>
          {task.title}
        </span>
        {blocked ? (
          <span className="ms-task-sub amber">等前置</span>
        ) : task.schedule.kind !== "unscheduled" ? (
          <span className={"ms-task-sub" + (overdue ? " amber" : "")}>
            {scheduleLabel(task.schedule)}
            {task.scheduleTime ? " " + task.scheduleTime : ""}
          </span>
        ) : null}
      </button>
    </div>
  );
}

/* ─────────────────────────── 2. ShortcutsScreen (Hub.swift 1:1) ─────────────────────────── */

function MobileShortcutsScreen({
  onOpenFeature,
  editing,
  setEditing,
}: {
  onOpenFeature: (key: FeatureKey) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
}) {
  const ws = useWorkspaceConfig();
  const { entities: sessions } = useEntities("session");
  const hasRunning = sessions.some((s) =>
    ["running", "paused"].includes(str(s, "status")),
  );
  const [stored, setStored] = usePreference<FeatureKey[]>("studio-shortcuts", [
    "practice",
    "expenses",
    "chronicle",
    "habits",
    "tasks",
    "achievements",
    "storage",
    "checklists",
  ]);

  const activeKeys = stored.filter(
    (k) =>
      features.some((f) => f.key === k) &&
      !["home", "departments", "discover", "settings"].includes(k) &&
      ws.isEnabled(k),
  );
  const addable = features.filter(
    (f) =>
      !["home", "departments", "discover", "settings"].includes(f.key) &&
      ws.isEnabled(f.key) &&
      !activeKeys.includes(f.key),
  );

  return (
    <>
      <div className="ms-display-head">
        <h1>快捷入口</h1>
      </div>
      <div className="ms-icon-grid">
        {activeKeys.map((key) => (
          <button
            key={key}
            type="button"
            className="ms-icon-item"
            onClick={() => onOpenFeature(key)}
          >
            <span className="ms-squircle">
              <Icon name={key} size={25} />
              {key === "practice" && hasRunning && <span className="ms-live-pip" />}
            </span>
            <span className="ms-icon-label">{ws.labelOf(key)}</span>
          </button>
        ))}
        <button
          type="button"
          className="ms-icon-item"
          onClick={() => setEditing(true)}
        >
          <span className="ms-squircle ghost">
            <Icon name="plus" size={24} />
          </span>
          <span className="ms-icon-label ghost">添加</span>
        </button>
      </div>

      {editing && (
        <div className="ms-sheet-backdrop" onClick={() => setEditing(false)}>
          <div className="ms-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ms-sheet-head">
              <strong>快捷入口</strong>
              <button
                type="button"
                className="ms-sheet-done"
                onClick={() => setEditing(false)}
              >
                完成
              </button>
            </div>
            <div className="ms-section-label">已添加</div>
            <div className="ms-sheet-list">
              {activeKeys.map((key, idx) => (
                <div className="ms-sheet-row" key={key}>
                  <span className="ms-sheet-row-left">
                    <Icon name={key} size={17} />
                    <span>{ws.labelOf(key)}</span>
                  </span>
                  <span className="ms-order-btns">
                    {idx > 0 && (
                      <button
                        type="button"
                        className="ms-mini-pill"
                        onClick={() => {
                          const next = [...activeKeys];
                          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                          setStored(next);
                        }}
                      >
                        ↑
                      </button>
                    )}
                    <button
                      type="button"
                      className="ms-mini-pill"
                      onClick={() => setStored(activeKeys.filter((k) => k !== key))}
                    >
                      移除
                    </button>
                  </span>
                </div>
              ))}
            </div>
            {addable.length > 0 && (
              <>
                <div className="ms-section-label">可添加</div>
                <div className="ms-sheet-list">
                  {addable.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      className="ms-sheet-row"
                      onClick={() => setStored([...activeKeys, f.key])}
                    >
                      <span className="ms-sheet-row-left">
                        <Icon name={f.key} size={17} />
                        <span>{ws.labelOf(f.key)}</span>
                      </span>
                      <Icon name="plus" size={16} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────── 3. DepartmentsScreen & Detail (Hub.swift 1:1) ─────────────────────────── */

function MobileDepartmentsScreen({
  onOpenDept,
  creating,
  setCreating,
}: {
  onOpenDept: (id: string) => void;
  creating: boolean;
  setCreating: (v: boolean) => void;
}) {
  const ws = useWorkspaceConfig();
  const { entities } = useEntities("department");
  const [scope, setScope] = useState<"common" | "all">("common");
  const [common, setCommon] = usePreference<string[]>("common-departments", [
    "执行部",
    "财政部",
    "档案库",
    "中科院",
  ]);
  const [newName, setNewName] = useState("");

  const custom = entities.filter((e) => e.type === "department");
  const all = [
    ...BUILTIN_DEPARTMENTS.filter((name) => ws.isDepartmentVisible(name)).map(
      (name) => ({
        id: name,
        rawName: name,
        name: ws.departmentLabel(name),
      }),
    ),
    ...custom.map((e) => ({
      id: e.id,
      rawName: str(e, "name"),
      name: str(e, "name"),
    })),
  ];

  const commonCount = common.filter((id) => all.some((d) => d.id === id)).length;
  const shown =
    scope === "common" ? all.filter((d) => common.includes(d.id)) : all;

  async function saveNewDept() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    await put("department", { name: trimmed, features: [] });
    setNewName("");
    setCreating(false);
  }

  return (
    <>
      <div className="ms-display-head">
        <h1>部门</h1>
      </div>
      <div className="ms-chip-bar">
        <button
          type="button"
          className={"ms-chip" + (scope === "common" ? " active" : "")}
          onClick={() => setScope("common")}
        >
          常用部门 {commonCount}
        </button>
        <button
          type="button"
          className={"ms-chip" + (scope === "all" ? " active" : "")}
          onClick={() => setScope("all")}
        >
          所有部门 {all.length}
        </button>
      </div>

      <div className="ms-icon-grid">
        {shown.map((dept) => {
          const mark = DEPT_MARKS[dept.rawName];
          return (
            <button
              key={dept.id}
              type="button"
              className="ms-icon-item"
              onClick={() => onOpenDept(dept.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCommon(
                  common.includes(dept.id)
                    ? common.filter((x) => x !== dept.id)
                    : [...common, dept.id],
                );
              }}
            >
              <span className="ms-squircle dept">
                {mark ? (
                  <Icon name={mark} size={26} />
                ) : (
                  <span className="ms-squircle-serif">{dept.name.slice(0, 1)}</span>
                )}
              </span>
              <span className="ms-icon-label">{dept.name}</span>
            </button>
          );
        })}
        {scope === "all" && (
          <button
            type="button"
            className="ms-icon-item"
            onClick={() => setCreating(true)}
          >
            <span className="ms-squircle ghost">
              <Icon name="plus" size={24} />
            </span>
            <span className="ms-icon-label ghost">新部门</span>
          </button>
        )}
      </div>

      {creating && (
        <div className="ms-sheet-backdrop" onClick={() => setCreating(false)}>
          <div className="ms-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ms-sheet-head">
              <strong>新部门</strong>
              <button
                type="button"
                className="ms-sheet-done"
                onClick={() => setCreating(false)}
              >
                取消
              </button>
            </div>
            <div className="ms-sheet-form">
              <input
                placeholder="部门名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button
                type="button"
                className="ms-sheet-primary"
                disabled={!newName.trim()}
                onClick={() => perform(saveNewDept())}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MobileDepartmentDetail({
  deptId,
  onOpenFeature,
}: {
  deptId: string;
  onOpenFeature: (key: FeatureKey) => void;
}) {
  const ws = useWorkspaceConfig();
  const { entities } = useEntities("department", "domain", "activity", "document");
  const custom = entities.find((e) => e.type === "department" && e.id === deptId);
  const featureKeys: FeatureKey[] = custom
    ? (arr(custom, "features") as FeatureKey[]).filter((k) => ws.isEnabled(k))
    : features
        .filter((f) => f.department === deptId && ws.isEnabled(f.key))
        .map((f) => f.key);
  const domains = entities.filter((e) => e.type === "domain");

  return (
    <>
      <div className="ms-icon-grid">
        {featureKeys.map((key) => (
          <button
            key={key}
            type="button"
            className="ms-icon-item"
            onClick={() => onOpenFeature(key)}
          >
            <span className="ms-squircle">
              <Icon name={key} size={25} />
            </span>
            <span className="ms-icon-label">{ws.labelOf(key)}</span>
          </button>
        ))}
      </div>
      {deptId === "中科院" && domains.length > 0 && (
        <>
          <div className="ms-section-label">领域</div>
          <section className="ms-card" style={{ gap: 0, padding: "6px 18px" }}>
            {domains.map((d, idx) => {
              const subCount = entities.filter(
                (e) => e.type === "activity" && e.data.domainId === d.id,
              ).length;
              const docCount = entities.filter(
                (e) => e.type === "document" && e.data.domainId === d.id,
              ).length;
              return (
                <React.Fragment key={d.id}>
                  {idx > 0 && <div className="ms-hairline" />}
                  <div
                    className="ms-domain-row"
                    onClick={() => onOpenFeature("notes")}
                  >
                    <strong>{str(d, "name")}</strong>
                    <small>
                      {subCount} 子领域 · {docCount} 篇资料
                    </small>
                  </div>
                </React.Fragment>
              );
            })}
          </section>
        </>
      )}
    </>
  );
}

/* ─────────────────────────── 4. ReviewScreen (Hub.swift 1:1) ─────────────────────────── */

function MobileReviewScreen() {
  const [month, setMonth] = useState(monthNow());
  const { entities: sessions } = useEntities("session", "habit", "habitRule");
  const dated = useDatedEntities(
    month + "-01",
    month + "-31",
    "expense",
    "journal",
    "habitLog",
  );
  const { tasks } = useTasks();

  const summary = useMemo(
    () =>
      timeSummary(
        sessions.filter((e) => e.type === "session"),
        Date.now(),
      ),
    [sessions],
  );
  const monthSeconds = useMemo(
    () =>
      Object.entries(summary.daily)
        .filter(([d]) => d.startsWith(month))
        .reduce((a, [, v]) => a + v, 0),
    [summary, month],
  );
  const spend = useMemo(
    () =>
      dated
        .filter((e) => e.type === "expense")
        .reduce((a, e) => a + net(e), 0n),
    [dated],
  );
  const doneTasks = useMemo(
    () =>
      tasks.filter((t) => {
        if (t.status !== "completed") return false;
        if (t.completedAt?.startsWith(month)) return true;
        if (t.schedule.kind === "day" || t.schedule.kind === "deadline") {
          return t.schedule.date.startsWith(month);
        }
        return false;
      }).length,
    [tasks, month],
  );
  const habitLogsCount = useMemo(() => {
    const allRef = [...sessions, ...dated];
    const habits = sessions.filter((e) => e.type === "habit");
    let count = 0;
    for (const h of habits) {
      const logs = latestHabitLogs(h.id, dated);
      for (const [d, log] of logs) {
        if (!d.startsWith(month)) continue;
        if (habitDone(h, log, habitRule(h, d, allRef))) count++;
      }
    }
    return count;
  }, [sessions, dated, month]);
  const lines = useMemo(
    () =>
      dated.filter((e) => e.type === "journal" && e.data.kind === "chronicle"),
    [dated],
  );
  const days = useMemo(
    () =>
      Array.from(new Set(lines.map((l) => str(l, "day")))).sort((a, b) =>
        b.localeCompare(a),
      ),
    [lines],
  );

  return (
    <>
      <div className="ms-display-head">
        <h1>回顾</h1>
      </div>
      <div className="ms-month-bar">
        <button
          type="button"
          aria-label="上一月"
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          <Icon name="chevron-left" size={16} />
        </button>
        <span className="ms-month-title">{monthTitle(month)}</span>
        <button
          type="button"
          aria-label="下一月"
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          <Icon name="chevron-right" size={16} />
        </button>
        {month !== monthNow() && (
          <button
            type="button"
            className="ms-month-today"
            onClick={() => setMonth(monthNow())}
          >
            本月
          </button>
        )}
      </div>

      <div className="ms-review-grid">
        <div className="ms-review-tile">
          <div className="ms-review-tile-head">
            <Icon name="practice" size={14} />
            <span>推进</span>
          </div>
          <strong>{formatSpan(monthSeconds)}</strong>
        </div>
        <div className="ms-review-tile">
          <div className="ms-review-tile-head">
            <Icon name="expenses" size={14} />
            <span>花销</span>
          </div>
          <strong>{money(spend)}</strong>
        </div>
        <div className="ms-review-tile">
          <div className="ms-review-tile-head">
            <Icon name="tasks" size={14} />
            <span>完成任务</span>
          </div>
          <strong>{doneTasks}</strong>
        </div>
        <div className="ms-review-tile">
          <div className="ms-review-tile-head">
            <Icon name="habits" size={14} />
            <span>习惯完成</span>
          </div>
          <strong>{habitLogsCount} 次</strong>
        </div>
      </div>

      <section className="ms-card">
        <div className="ms-card-head">
          <span className="ms-card-icon">
            <Icon name="chronicle" size={15} />
          </span>
          <span className="ms-card-title">这个月发生的事</span>
          <span className="ms-card-meta">{lines.length} 件</span>
        </div>
        <div className="ms-stack-rows">
          {days.map((d, idx) => (
            <React.Fragment key={d}>
              {idx > 0 && <div className="ms-hairline inset-44" />}
              <div className="ms-review-day">
                <span className="ms-review-day-num">{Number(d.slice(8, 10))}</span>
                <div className="ms-review-day-lines">
                  {lines
                    .filter((l) => str(l, "day") === d)
                    .map((l) => (
                      <p key={l.id}>{str(l, "body")}</p>
                    ))}
                </div>
              </div>
            </React.Fragment>
          ))}
          {lines.length === 0 && (
            <div className="ms-empty-note">这个月还没有记录</div>
          )}
        </div>
      </section>
    </>
  );
}

/* ─────────────────────────── 5. SearchScreen (Hub.swift 1:1) ─────────────────────────── */

function MobileSearchScreen({
  onOpenFeature,
}: {
  onOpenFeature: (key: FeatureKey) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const searchable = useEverything(Boolean(needle));
  const { tasks } = useTasks();

  const results = useMemo(() => {
    if (!needle) return [];
    const rows: { id: string; title: string; meta: string; target: FeatureKey }[] = [];
    for (const t of tasks) {
      if (t.title.toLowerCase().includes(needle)) {
        rows.push({
          id: "task-" + t.id,
          title: t.title,
          meta: "任务 · " + scheduleLabel(t.schedule),
          target: "tasks",
        });
      }
      if (rows.length >= 60) break;
    }
    for (const e of searchable) {
      if (rows.length >= 100) break;
      if (e.deleted || e.type === "workspaceConfig") continue;
      if (
        Object.values(e.data).some((v) =>
          String(v ?? "").toLowerCase().includes(needle),
        )
      ) {
        const title = str(
          e,
          "title",
          str(e, "name", str(e, "body").slice(0, 80)),
        );
        if (!title) continue;
        const when = str(e, "day", e.updatedAt.slice(0, 10));
        rows.push({
          id: e.id,
          title,
          meta: `${KIND_LABELS[e.type] ?? e.type} · ${when}`,
          target: entityFeature(e),
        });
      }
    }
    return rows;
  }, [needle, searchable, tasks]);

  return (
    <>
      <div className="ms-display-head">
        <h1>搜索</h1>
      </div>
      <div className="ms-search-bar">
        <Icon name="discover" size={16} />
        <input
          type="text"
          inputMode="search"
          enterKeyHint="search"
          placeholder="文章、记录、任务、消费…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="ms-search-clear"
            aria-label="清空"
            onClick={() => setQuery("")}
          >
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      {needle && results.length > 0 && (
        <div className="ms-search-card">
          {results.map((r, idx) => (
            <React.Fragment key={r.id}>
              {idx > 0 && <div className="ms-hairline" />}
              <button
                type="button"
                className="ms-search-row"
                onClick={() => onOpenFeature(r.target)}
              >
                <strong>{r.title}</strong>
                <small>{r.meta}</small>
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
      {needle && results.length === 0 && (
        <div className="ms-empty-note" style={{ paddingLeft: 6 }}>
          没有找到相关记录
        </div>
      )}
    </>
  );
}

/* ─────────────────────────── Quick Capture Sheet ─────────────────────────── */

function QuickCaptureSheet({
  kind,
  onClose,
}: {
  kind: QuickCaptureKind;
  onClose: () => void;
}) {
  const day = today();
  const { entities: categories } = useEntities("category");
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [necessary, setNecessary] = useState(true);
  const [schedule, setSchedule] = useState<"today" | "recent" | "unscheduled">("today");
  const [saving, setSaving] = useState(false);

  const heading =
    kind === "chronicle"
      ? "记一件事"
      : kind === "expense"
        ? "记一笔花销"
        : kind === "task"
          ? "添加任务"
          : kind === "idea"
            ? "暂存想法"
            : "收集原料";

  const parsedMinor = kind === "expense" ? parsePositiveMinor(amount) : null;

  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      if (kind === "chronicle" || kind === "raw") {
        if (!text.trim()) return;
        await put("journal", { kind, day, body: text.trim() });
      } else if (kind === "idea") {
        if (!text.trim()) return;
        await put("idea", {
          body: text.trim(),
          day,
          status: "pending",
        });
      } else if (kind === "task") {
        if (!text.trim()) return;
        await enqueue(
          "create",
          crypto.randomUUID(),
          text.trim(),
          schedule === "today"
            ? { kind: "day", date: day }
            : schedule === "recent"
              ? { kind: "recent" }
              : { kind: "unscheduled" },
        );
      } else if (kind === "expense") {
        if (!parsedMinor || !text.trim()) return;
        await put("expense", {
          title: text.trim(),
          day,
          amountMinor: parsedMinor,
          ...(categoryId ? { categoryId } : {}),
          necessary,
          mode: "immediate",
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ms-sheet-backdrop" onClick={onClose}>
      <div className="ms-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ms-sheet-head">
          <strong>{heading}</strong>
          <button type="button" className="ms-sheet-done" onClick={onClose}>
            取消
          </button>
        </div>
        <div className="ms-sheet-form">
          {kind === "expense" ? (
            <>
              <input
                inputMode="decimal"
                placeholder="金额（元，如 28.5）"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
              <input
                placeholder="项目名称（如 午餐）"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              {categories.length > 0 && (
                <select
                  aria-label="选择消费分类"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <option value="">待分类</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {str(c, "name")}
                    </option>
                  ))}
                </select>
              )}
              <div className="ms-chip-bar">
                <button
                  type="button"
                  className={"ms-chip" + (necessary ? " active" : "")}
                  onClick={() => setNecessary(true)}
                >
                  必要
                </button>
                <button
                  type="button"
                  className={"ms-chip" + (!necessary ? " active" : "")}
                  onClick={() => setNecessary(false)}
                >
                  非必要
                </button>
              </div>
            </>
          ) : kind === "task" ? (
            <>
              <input
                placeholder="任务名称"
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
              />
              <div className="ms-chip-bar">
                {(
                  [
                    ["today", "今天"],
                    ["recent", "近期"],
                    ["unscheduled", "无日期"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={"ms-chip" + (schedule === k ? " active" : "")}
                    onClick={() => setSchedule(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <textarea
              placeholder="写下内容…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
          )}
          <button
            type="button"
            className="ms-sheet-primary"
            disabled={
              saving ||
              !text.trim() ||
              (kind === "expense" && !parsedMinor)
            }
            onClick={() => perform(submit())}
          >
            {saving ? "正在保存…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
