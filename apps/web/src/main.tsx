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
const Home = React.lazy(() =>
  import("./features/Home.tsx").then((m) => ({ default: m.Home })),
);
const TaskScreen = React.lazy(() =>
  import("./features/Tasks.tsx").then((m) => ({ default: m.TaskScreen })),
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
  const initial = (location.pathname.slice(1) || "home") as FeatureKey;
  const [active, setActive] = useState<FeatureKey>(
    features.some((f) => f.key === initial) ? initial : "home",
  );
  const [tabs, setTabs] = usePreference<FeatureKey[]>("open-tabs", [
    "home",
    ...(initial !== "home" ? [initial] : []),
  ]);
  const [right, setRight] = useState<FeatureKey | null>(null);
  const [theme, setTheme] = usePreference("theme", "dark");
  const [error, setError] = useState("");
  const { state: syncState, message } = useSyncStatus();
  const conflicts = usePending().filter(
    (p) => p.state === "conflict" || p.state === "error",
  );
  const history = useRef<FeatureKey[]>([]);
  const [mobileMenu, setMobileMenu] = useState(false);
  function navigate(key: FeatureKey, pane: "left" | "right" = "left") {
    if (!features.some((f) => f.key === key)) return;
    if (pane === "right") {
      if (key === active) return;
      setRight(key);
    } else {
      if (active !== key) history.current.push(active);
      setActive(key);
      historyReplace(key);
      if (right === key) setRight(null);
    }
    if (!tabs.includes(key)) setTabs([...tabs, key]);
    setMobileMenu(false);
  }
  function historyReplace(key: FeatureKey) {
    window.history.replaceState(null, "", "/" + key);
  }
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
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  function screen(key: FeatureKey) {
    switch (key) {
      case "home":
        return <Home navigate={navigate} />;
      case "practice":
        return <Practice />;
      case "tasks":
        return <TaskScreen />;
      case "habits":
        return <Habits />;
      case "expenses":
        return <Finance />;
      case "freedom":
        return <FreedomPage />;
      case "treasury":
        return <Treasury />;
      case "chronicle":
        return <Journal kind="chronicle" />;
      case "raw":
        return <Journal kind="raw" />;
      case "ideas":
        return <Journal kind="idea" />;
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
  return (
    <div className="studio-shell">
      {syncState === "unauthorized" && <Pairing />}
      <aside className={"studio-sidebar " + (mobileMenu ? "mobile-open" : "")}>
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
                {f.name}
              </button>
            ))}
          <div className="nav-section">常用功能</div>
          {features
            .filter((f) =>
              [
                "practice",
                "tasks",
                "habits",
                "expenses",
                "treasury",
                "freedom",
                "chronicle",
                "raw",
                "monthly",
                "notes",
              ].includes(f.key),
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
                {f.name}
              </button>
            ))}
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
        <header className="studio-topbar">
          <div>
            <button
              className="mobile-menu"
              aria-label="展开菜单"
              onClick={() => setMobileMenu(!mobileMenu)}
            >
              <Icon name="menu" />
            </button>
            <button
              aria-label="返回上一标签"
              onClick={() => {
                const prev = history.current.pop();
                if (prev) {
                  setActive(prev);
                  historyReplace(prev);
                }
              }}
            >
              <Icon name="back" />
            </button>
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
                    {feature(key).name}
                  </button>
                  <button
                    aria-label={"关闭标签 " + feature(key).name}
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
            <button
              aria-label="分屏查看"
              onClick={() =>
                setRight(
                  right ? null : (tabs.find((k) => k !== active) ?? "discover"),
                )
              }
            >
              <Icon name="split" />
            </button>
          </div>
        </header>
        <div className={"workspace-panes " + (right ? "split" : "")}>
          <div className="workspace-pane primary-pane" key={active}>
            <React.Suspense
              fallback={<div className="quiet-empty">正在打开…</div>}
            >
              {screen(active)}
            </React.Suspense>
          </div>
          <div
            className={"split-drop " + (right ? "has-pane" : "")}
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add("dragover");
            }}
            onDragLeave={(e) => e.currentTarget.classList.remove("dragover")}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove("dragover");
              const key = e.dataTransfer.getData("feature") as FeatureKey;
              if (key) navigate(key, "right");
            }}
          >
            {right ? (
              <>
                <div className="pane-header">
                  <strong>{feature(right).name}</strong>
                  <button onClick={() => setRight(null)}>关闭分栏 ×</button>
                </div>
                <div className="workspace-pane" key={right}>
                  <React.Suspense
                    fallback={<div className="quiet-empty">正在打开…</div>}
                  >
                    {screen(right)}
                  </React.Suspense>
                </div>
              </>
            ) : (
              <span>拖到这里，在右侧打开</span>
            )}
          </div>
        </div>
        {error && (
          <div className="toast" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        <FloatingTimer />
        <nav className="mobile-dock">
          {(["home", "departments", "discover"] as const).map(
            (key) => (
              <button
                className={active === key ? "active" : ""}
                key={key}
                onClick={() => navigate(key)}
              >
                <Icon name={key} size={22} />
                <small>
                  {feature(key).name === "部门与知识库"
                    ? "部门"
                    : feature(key).name}
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
