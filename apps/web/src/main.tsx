import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { features, feature, type FeatureKey } from "./navigation.ts";
import { Icon } from "./ui/Icon.tsx";
import {
  usePending,
  useSyncStatus,
  startSync,
  synchronize,
} from "./data/entities.ts";
import { usePreference } from "./ui/shared.tsx";
import { Pairing } from "./ui/Pairing.tsx";
import { syncAndroidTheme } from "./ui/android-bridge.ts";
import { useWorkspaceConfig } from "./features/workspace-config.ts";
const Home = React.lazy(() =>
  import("./features/Home.tsx").then((m) => ({ default: m.Home })),
);
const TaskScreen = React.lazy(() =>
  import("./features/Tasks.tsx").then((m) => ({ default: m.TaskScreen })),
);
const Achievements = React.lazy(() =>
  import("./features/Achievements.tsx").then((m) => ({ default: m.Achievements })),
);
const Practice = React.lazy(() =>
  import("./features/Practice.tsx").then((m) => ({ default: m.Practice })),
);
import { FloatingTimer } from "./features/PracticeTimer.tsx";
const Habits = React.lazy(() =>
  import("./features/Habits.tsx").then((m) => ({ default: m.Habits })),
);
const Finance = React.lazy(() =>
  import("./features/Finance.tsx").then((m) => ({ default: m.Finance })),
);
const Treasury = React.lazy(() =>
  import("./features/Treasury.tsx").then((m) => ({ default: m.Treasury })),
);
const FreedomPage = React.lazy(() =>
  import("./features/Freedom.tsx").then((m) => ({ default: m.Freedom })),
);
const Documents = React.lazy(() =>
  import("./features/Writing.tsx").then((m) => ({ default: m.Documents })),
);
const Journal = React.lazy(() =>
  import("./features/Writing.tsx").then((m) => ({ default: m.Journal })),
);
const Memoir = React.lazy(() =>
  import("./features/Memoir.tsx").then((m) => ({ default: m.Memoir })),
);
const Storage = React.lazy(() =>
  import("./features/Storage.tsx").then((m) => ({ default: m.Storage })),
);
const ReadingList = React.lazy(() =>
  import("./features/ReadingList.tsx").then((m) => ({ default: m.ReadingList })),
);
const ImportantDays = React.lazy(() =>
  import("./features/Life.tsx").then((m) => ({ default: m.ImportantDays })),
);
const Metrics = React.lazy(() =>
  import("./features/Life.tsx").then((m) => ({ default: m.Metrics })),
);
const Checklists = React.lazy(() =>
  import("./features/Life.tsx").then((m) => ({ default: m.Checklists })),
);
const Departments = React.lazy(() =>
  import("./features/Workspace.tsx").then((m) => ({ default: m.Departments })),
);
const Discover = React.lazy(() =>
  import("./features/Workspace.tsx").then((m) => ({ default: m.Discover })),
);
const Settings = React.lazy(() =>
  import("./features/Workspace.tsx").then((m) => ({ default: m.Settings })),
);
import "./ui/theme.css";
function App() {
  const initial = feature(location.pathname.slice(1)).key;
  const [active, setActive] = useState<FeatureKey>(initial);
  const [savedTabs, setTabs] = usePreference<FeatureKey[]>("open-tabs", [
    "home",
    ...(initial !== "home" ? [initial] : []),
  ]);
  const knownTabs = savedTabs.filter((key) => feature(key).key === key);
  const tabs = knownTabs.length > 0 ? knownTabs : [initial];
  // Split view, VS Code style: a second feature on the right, remembered across reloads.
  const [savedRight, setRight] = usePreference<FeatureKey | null>("split-right", null);
  const right = savedRight && feature(savedRight).key === savedRight ? savedRight : null;
  const [ratio, setRatio] = usePreference("split-ratio", 0.5);
  const [dragging, setDragging] = useState(false);
  const [picker, setPicker] = useState(false);
  const panes = useRef<HTMLDivElement>(null);
  // Sidebar favourites: the user's own list and order.
  const [favorites, setFavorites] = usePreference<FeatureKey[]>("sidebar-favorites", [
    "practice", "tasks", "achievements", "habits", "expenses", "treasury", "freedom", "chronicle", "memoir", "storage", "raw", "monthly", "notes",
  ]);
  const [editingNav, setEditingNav] = useState(false);
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  const [theme, setTheme] = usePreference("theme", "dark");
  const [error, setError] = useState("");
  const { state: syncState, message } = useSyncStatus();
  const conflicts = usePending().filter(
    (p) => p.state === "conflict" || p.state === "error",
  );
  const [practiceRequest, setPracticeRequest] = useState<{ id: string }>();
  const [journalFocus, setJournalFocus] = useState<{
    kind: "idea" | "raw";
    day: string;
    id: string;
  }>();
  const history = useRef<FeatureKey[]>([]);
  const forwardHistory = useRef<FeatureKey[]>([]);
  const [, bumpHistoryVersion] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = usePreference<boolean>(
    "macos-sidebar-collapsed",
    false,
  );
  const [mobileMenu, setMobileMenu] = useState(false);
  const ws = useWorkspaceConfig();
  function navigate(key: FeatureKey, pane: "left" | "right" = "left") {
    if (!features.some((f) => f.key === key)) return;
    if (pane === "right") {
      if (key === active) return;
      setRight(key);
    } else {
      if (active !== key) {
        history.current.push(active);
        forwardHistory.current = [];
        bumpHistoryVersion((v) => v + 1);
      }
      setActive(key);
      historyReplace(key);
      if (right === key) setRight(null);
    }
    if (!tabs.includes(key)) setTabs([...tabs, key]);
    setMobileMenu(false);
  }
  function stepBack() {
    const prev = history.current.pop();
    if (!prev) return;
    forwardHistory.current.push(active);
    setActive(prev);
    historyReplace(prev);
    bumpHistoryVersion((v) => v + 1);
  }
  function stepForward() {
    const next = forwardHistory.current.pop();
    if (!next) return;
    history.current.push(active);
    setActive(next);
    historyReplace(next);
    bumpHistoryVersion((v) => v + 1);
  }
  function historyReplace(key: FeatureKey) {
    window.history.replaceState(null, "", "/" + key);
  }
  useEffect(() => {
    const start = (e: DragEvent) => e.dataTransfer?.types.includes("feature") && setDragging(true);
    const end = () => {
      setDragging(false);
      setDropBefore(null);
    };
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, []);
  useEffect(() => {
    startSync();
    const onError = (e: Event) => setError((e as CustomEvent).detail);
    window.addEventListener("council-error", onError);
    return () => {
      window.removeEventListener("council-error", onError);
    };
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved: "dark" | "light" =
        theme === "system" ? (media.matches ? "dark" : "light") : theme === "light" ? "light" : "dark";
      document.documentElement.dataset.theme = resolved;
      syncAndroidTheme(resolved);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    window.__selfOSHandleBack = () => {
      if (mobileMenu) {
        setMobileMenu(false);
        return true;
      }
      if (picker) {
        setPicker(false);
        return true;
      }
      if (history.current.length > 0) {
        stepBack();
        return true;
      }
      if (active !== "home") {
        setActive("home");
        historyReplace("home");
        return true;
      }
      return false;
    };
    return () => {
      delete window.__selfOSHandleBack;
    };
  }, [mobileMenu, picker, active]);
  function screen(key: FeatureKey) {
    switch (key) {
      case "home":
        return <Home navigate={navigate} />;
      case "practice":
        return <Practice eventRequest={practiceRequest} />;
      case "tasks":
        return <TaskScreen />;
      case "achievements":
        return <Achievements />;
      case "habits":
        return <Habits />;
      case "expenses":
        return <Finance />;
      case "freedom":
        return <FreedomPage />;
      case "treasury":
        return <Treasury />;
      case "chronicle":
        return <Journal kind="chronicle" onOpenMemoir={() => navigate("memoir")} />;
      case "memoir":
        return <Memoir onOpenChronicle={() => navigate("chronicle")} />;
      case "storage":
        return <Storage />;
      case "raw":
        return (
          <Journal
            kind="raw"
            focus={journalFocus?.kind === "raw" ? journalFocus : undefined}
            onConsumeFocus={() => setJournalFocus(undefined)}
            onOpenTarget={(target) => {
              setJournalFocus(target);
              navigate(target.kind === "idea" ? "ideas" : "raw");
            }}
          />
        );
      case "ideas":
        return (
          <Journal
            kind="idea"
            focus={journalFocus?.kind === "idea" ? journalFocus : undefined}
            onConsumeFocus={() => setJournalFocus(undefined)}
            onOpenTarget={(target) => {
              setJournalFocus(target);
              navigate(target.kind === "idea" ? "ideas" : "raw");
            }}
          />
        );
      case "reading":
        return <ReadingList openEvent={(id) => { setPracticeRequest({ id }); navigate("practice"); }} />;
      case "thoughts":
        return <Documents kind="thought" />;
      case "monthly":
        return <Documents kind="monthly" />;
      case "notes":
        return <Documents kind="note" />;
      case "metrics":
        return <Metrics />;
      case "days":
        return <ImportantDays />;
      case "checklists":
        return <Checklists />;
      case "departments":
        return <Departments navigate={navigate} />;
      case "discover":
        return <Discover navigate={navigate} />;
      case "settings":
        return <Settings theme={theme} setTheme={setTheme} />;
    }
  }
  useEffect(() => {
    const onToggle = () => setSidebarCollapsed(!sidebarCollapsed);
    window.addEventListener("selfos-toggle-sidebar", onToggle);
    return () => window.removeEventListener("selfos-toggle-sidebar", onToggle);
  }, [sidebarCollapsed, setSidebarCollapsed]);

  const macosControls = (
    <div className="macos-chrome-controls">
      <button
        type="button"
        aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
        title={sidebarCollapsed ? "展开侧边栏 (⇧⌘S)" : "收起侧边栏 (⇧⌘S)"}
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
      >
        <Icon name="sidebar" size={14} />
      </button>
      <button
        type="button"
        aria-label="后退"
        title="后退"
        disabled={history.current.length === 0}
        onClick={stepBack}
      >
        <Icon name="chevron-left" size={14} />
      </button>
      <button
        type="button"
        aria-label="前进"
        title="前进"
        disabled={forwardHistory.current.length === 0}
        onClick={stepForward}
      >
        <Icon name="chevron-right" size={14} />
      </button>
    </div>
  );

  return (
    <div className={"studio-shell" + (sidebarCollapsed ? " sidebar-collapsed" : "")}>
      {syncState === "unauthorized" && <Pairing />}
      {mobileMenu && (
        <div
          className="mobile-scrim"
          aria-hidden="true"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <aside className={"studio-sidebar " + (mobileMenu ? "mobile-open" : "")}>
        <div className="macos-sidebar-head macos-drag-bar">
          {macosControls}
        </div>
        <button className="studio-brand" onClick={() => navigate("home")}>
          <img src="/favicon.svg" alt="" width={26} height={26} />
          <strong>
            SELF OS<small>PERSONAL SYSTEM</small>
          </strong>
        </button>
        <nav>
          <div className="nav-section">工作区</div>
          {features
            .filter((f) =>
              ["home", "departments", "discover"].includes(f.key),
            )
            .map((f) => (
              <button
                key={f.key}
                aria-current={active === f.key ? "page" : undefined}
                className={active === f.key ? "active" : ""}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("feature", f.key)}
                onClick={() => navigate(f.key)}
              >
                <Icon name={f.key} />
                {ws.labelOf(f.key)}
              </button>
            ))}
          <div className="nav-section nav-section-row">
            常用功能
            <button
              className="nav-edit"
              type="button"
              aria-label={editingNav ? "完成常用功能编辑" : "编辑常用功能"}
              title={editingNav ? "完成编辑" : "编辑常用功能"}
              aria-pressed={editingNav}
              onClick={() => setEditingNav(!editingNav)}
            >
              <Icon name={editingNav ? "check" : "settings"} size={14} />
            </button>
          </div>
          {favorites
            .filter((key) => features.some((f) => f.key === key) && ws.isEnabled(key))
            .map((key) => (
              <button
                key={key}
                aria-current={active === key ? "page" : undefined}
                className={(active === key ? "active" : "") + (dropBefore === key ? " drop-before" : "")}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("feature", key)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropBefore(key);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const moved = e.dataTransfer.getData("feature") as FeatureKey;
                  if (!moved || moved === key) return;
                  const rest = favorites.filter((k) => k !== moved);
                  rest.splice(rest.indexOf(key), 0, moved);
                  setFavorites(rest);
                  setDropBefore(null);
                }}
                onClick={() => navigate(key)}
              >
                <Icon name={key} />
                {ws.labelOf(key)}
                {editingNav && (
                  <span
                    className="nav-remove"
                    role="button"
                    aria-label={"移出常用 " + ws.labelOf(key)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFavorites(favorites.filter((k) => k !== key));
                    }}
                  >
                    ×
                  </span>
                )}
              </button>
            ))}
          {editingNav && (
            <div className="nav-add">
              <small>添加到常用</small>
              {features
                .filter(
                  (f) =>
                    !["home", "departments", "discover", "settings"].includes(f.key) &&
                    ws.isEnabled(f.key) &&
                    !favorites.includes(f.key),
                )
                .map((f) => (
                  <button key={f.key} onClick={() => setFavorites([...favorites, f.key])}>
                    <Icon name={f.key} />
                    {ws.labelOf(f.key)}
                    <span className="nav-plus">＋</span>
                  </button>
                ))}
            </div>
          )}
          {!editingNav && <small className="nav-hint">拖动排序；拖到右侧可分屏</small>}
        </nav>
        <div className="studio-sidebar-bottom">
          <button onClick={() => navigate("settings")}>
            <Icon name="settings" />
            设置
          </button>
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} />
            {theme === "dark" ? "浅色外观" : "深色外观"}
          </button>
          <small>{message}</small>
        </div>
      </aside>
      <div className="studio-main">
        <header className="studio-topbar macos-drag-bar">
          <div>
            {sidebarCollapsed && macosControls}
            <button
              className="mobile-menu"
              aria-label="展开菜单"
              onClick={() => setMobileMenu(!mobileMenu)}
            >
              <Icon name="menu" />
            </button>
            <button
              className="web-back-btn"
              aria-label="返回上一标签"
              onClick={stepBack}
            >
              <Icon name="back" />
            </button>
            <span className="mobile-page-title">{ws.labelOf(active)}</span>
            <div className="workspace-tabs">
              {tabs.map((key) => (
                <div
                  key={key}
                  draggable
                  className={
                    active === key ? "active" : right === key ? "secondary" : ""
                  }
                  onDragStart={(e) => e.dataTransfer.setData("feature", key)}
                >
                  <button onClick={() => navigate(key)}>
                    {ws.labelOf(key)}
                  </button>
                  <button
                    aria-label={"关闭标签 " + ws.labelOf(key)}
                    onClick={() => {
                      const remaining = tabs.filter((k) => k !== key);
                      setTabs(remaining.length ? remaining : ["home"]);
                      if (active === key) {
                        setActive(remaining.at(-1) ?? "home");
                        historyReplace(remaining.at(-1) ?? "home");
                      }
                      if (right === key) setRight(null);
                    }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <button aria-label="全局搜索" onClick={() => navigate("discover")}>
              <Icon name="discover" />
            </button>
            <button
              className="global-sync"
              aria-label="全系统同步"
              title={conflicts.length ? "有记录待处理" : message}
              onClick={() => {
                void synchronize();
              }}
            >
              <span className="status-dot" />
              <span className="sync-message">
                {conflicts.length ? "有记录待处理" : message}
              </span>
              <Icon name="sync" size={14} />
            </button>
            <span className="split-picker">
              <button
                aria-label="分屏查看"
                className={right ? "on" : ""}
                onClick={() => (right ? setRight(null) : setPicker(!picker))}
                title={right ? "关闭分屏" : "在右侧打开另一个功能"}
              >
                <Icon name="split" />
              </button>
              {picker && (
                <div className="split-menu" onMouseLeave={() => setPicker(false)}>
                  <small>在右侧打开</small>
                  {features
                    .filter((f) => f.key !== active && f.key !== "settings" && ws.isEnabled(f.key))
                    .map((f) => (
                      <button
                        key={f.key}
                        onClick={() => {
                          navigate(f.key, "right");
                          setPicker(false);
                        }}
                      >
                        <Icon name={f.key} size={14} />
                        {ws.labelOf(f.key)}
                      </button>
                    ))}
                </div>
              )}
            </span>
          </div>
        </header>
        <div className={"workspace-panes " + (right ? "split" : "")} ref={panes}>
          <div
            className="workspace-pane primary-pane"
            key={active}
            style={right ? { flex: `0 0 ${ratio * 100}%` } : undefined}
          >
            <React.Suspense fallback={<div className="quiet-empty">正在打开…</div>}>{screen(active)}</React.Suspense>
          </div>
          {right && (
            <>
              <div
                className="split-divider"
                role="separator"
                aria-label="拖动调整分屏比例"
                onPointerDown={(e) => {
                  const box = panes.current!.getBoundingClientRect();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const move = (ev: PointerEvent) =>
                    setRatio(Math.min(0.75, Math.max(0.25, (ev.clientX - box.left) / box.width)));
                  const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                    document.body.classList.remove("resizing");
                  };
                  document.body.classList.add("resizing");
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
                onDoubleClick={() => setRatio(0.5)}
              />
              <div className="secondary-pane">
                <div className="pane-header">
                  <select
                    aria-label="右侧显示的功能"
                    value={right}
                    onChange={(e) => navigate(e.target.value as FeatureKey, "right")}
                  >
                    {features
                      .filter((f) => f.key !== active && f.key !== "settings" && (ws.isEnabled(f.key) || f.key === right))
                      .map((f) => (
                        <option key={f.key} value={f.key}>
                          {ws.labelOf(f.key)}
                        </option>
                      ))}
                  </select>
                  <span>
                    <button
                      title="左右交换"
                      onClick={() => {
                        const left = active;
                        setActive(right);
                        historyReplace(right);
                        setRight(left);
                      }}
                    >
                      ⇄ 交换
                    </button>
                    <button title="关闭右侧" onClick={() => setRight(null)}>
                      ×
                    </button>
                  </span>
                </div>
                <div className="workspace-pane" key={right}>
                  <React.Suspense fallback={<div className="quiet-empty">正在打开…</div>}>{screen(right)}</React.Suspense>
                </div>
              </div>
            </>
          )}
          {dragging && (
            <div className="drop-overlay">
              {(["left", "right"] as const).map((side) => (
                <div
                  key={side}
                  className={"drop-zone " + side}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add("over");
                  }}
                  onDragLeave={(e) => e.currentTarget.classList.remove("over")}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const key = e.dataTransfer.getData("feature") as FeatureKey;
                    if (key) navigate(key, side);
                  }}
                >
                  <span>{side === "left" ? "在左侧打开" : right ? "替换右侧" : "在右侧分屏打开"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {error && (
          <div className="toast" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        <FloatingTimer />
        <nav className="mobile-dock">
          {(["home", "departments", "discover", "settings"] as const).map(
            (key) => (
              <button
                className={active === key ? "active" : ""}
                key={key}
                onClick={() => navigate(key)}
              >
                <Icon name={key} size={20} />
                <small>
                  {ws.labelOf(key) === "部门与知识库"
                    ? "部门"
                    : ws.labelOf(key)}
                </small>
              </button>
            ),
          )}
        </nav>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
if (import.meta.env.PROD && "serviceWorker" in navigator)
  void navigator.serviceWorker.register("/sw.js");
