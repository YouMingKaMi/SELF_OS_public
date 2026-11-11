import { timeSummary } from "../../../../modules/practice/index.ts";
import React, { useState, useRef } from "react";
import "./home.css";
import { useEntities, put } from "../data/entities.ts";
import { useTasks, enqueue, type Task } from "../data/tasks.ts";
import { inPeriod, scheduleLabel } from "../scheduling.ts";
import { Icon } from "../ui/Icon.tsx";
import { HomePractice } from "./HomePractice.tsx";
import { useEffect } from "react";
import {
  Heading,
  Panel,
  Stats,
  Empty,
  today,
  str,
  perform,
  usePreference,
} from "../ui/shared.tsx";
import { HabitRow, habitRule } from "./Habits.tsx";
const ImportantSummary = React.lazy(() => import("./ImportantSummary.tsx"));

import { money, net } from "./finance-model.ts";
import type { Navigate, FeatureKey } from "../navigation.ts";
const cards = [
  ["practice", "此时 · 推进"],
  ["time", "今日积累"],
  ["tasks", "今日任务"],
  ["recent", "近期任务"],
  ["habits", "习惯打卡"],
  ["expenses", "花销"],
  ["chronicle", "记录与回顾"],
  ["raw", "未加工信息原料"],
  ["days", "重要日子"],
  ["metrics", "每日指标"],
] as const;
type CardKey = (typeof cards)[number][0];
export const useTaskSummary = () => useTasks().tasks;
export function Home({ navigate }: { navigate: Navigate }) {
  // The dashboard reads the small daily types; documents are never loaded here.
  const { entities } = useEntities(
    "domain",
    "activity",
    "problem",
    "solution",
    "session",
    "habit",
    "habitRule",
    "habitLog",
    "expense",
    "category",
    "journal",
    "metric",
    "metricLog",
    "importantDay",
  );
  const tasks = useTaskSummary();
  const [layout, setLayout] = usePreference<
    { key: CardKey; size: "half" | "wide" }[]
  >(
    "home-layout",
    cards.map(([key]) => ({
      key,
      size: key === "practice" || key === "chronicle" ? "wide" : "half",
    })),
  );
  const [editing, setEditing] = useState(false);
  const [expenseForm, setExpenseForm] = useState(false);
  const [draft, setDraft] = usePreference("home-chronicle-draft", "");
  const [raw, setRaw] = usePreference("home-raw-draft", "");
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<CardKey | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = grid.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const gap =
        parseFloat(getComputedStyle(node).getPropertyValue("--home-gap")) || 20;
      for (const entry of entries) {
        const card = entry.target.closest<HTMLElement>("[data-card]");
        if (card)
          card.style.gridRowEnd =
            "span " +
            Math.ceil(entry.target.getBoundingClientRect().height + gap);
      }
    });
    node
      .querySelectorAll(".home-widget>.panel")
      .forEach((panel) => observer.observe(panel));
    return () => observer.disconnect();
  }, [JSON.stringify(layout)]);
  const domains = entities.filter(
    (e) =>
      e.type === "domain" &&
      (e.data.focused ||
        entities.some(
          (s) =>
            s.type === "session" &&
            s.data.domainId === e.id &&
            s.data.day === today(),
        )),
  );
  const logs = entities.filter(
    (e) =>
      e.type === "journal" &&
      e.data.kind === "chronicle" &&
      e.data.day === today(),
  );
  const summary = timeSummary(
    entities.filter((e) => e.type === "session"),
    Date.now(),
  );
  const homeHabits = entities.filter(
    (e) =>
      e.type === "habit" &&
      e.data.status === "active" &&
      e.data.showHome &&
      (
        (habitRule(e, today(), entities)?.data.weekdays as string[]) ?? []
      ).includes(String(new Date(today() + "T12:00:00+08:00").getDay())),
  );
  const expense = entities
    .filter((e) => e.type === "expense" && e.data.day === today())
    .reduce((n, e) => n + net(e), 0n);
  function route(key: CardKey): FeatureKey {
    return key === "recent"
      ? "tasks"
      : key === "time"
        ? "practice"
        : key === "chronicle"
          ? "chronicle"
          : key;
  }
  function move(source: CardKey, target: CardKey) {
    if (source === target) return;
    const copy = [...layout];
    const from = copy.findIndex((c) => c.key === source),
      to = copy.findIndex((c) => c.key === target);
    if (from < 0 || to < 0) return;
    copy.splice(to, 0, copy.splice(from, 1)[0]);
    setLayout(copy);
  }
  return (
    <>
      <Heading
        eyebrow={"YOUR DAILY SPACE · " + today()}
        title={
          Number(today().slice(5, 7)) +
          "月" +
          Number(today().slice(8)) +
          "日 · 周" +
          "日一二三四五六"[new Date(today() + "T12:00:00Z").getUTCDay()]
        }
        description="今天，也在慢慢向前。"
      >
        <button onClick={() => setEditing(!editing)}>
          {editing ? "完成排版" : "调整布局"}
        </button>
      </Heading>
      <div className="home-quick-actions" aria-label="快速记录">
        <span>快速记录</span>
        <button
          onClick={() => {
            const field = grid.current?.querySelector<HTMLTextAreaElement>(
              '[aria-label="主页记录一件事"]',
            );
            if (field) {
              field.scrollIntoView({ block: "center", behavior: "smooth" });
              field.focus({ preventScroll: true });
            } else navigate("chronicle");
          }}
        >
          <Icon name="chronicle" size={16} />
          记一件事
        </button>
        <button onClick={() => setExpenseForm(true)}>
          <Icon name="expenses" size={16} />
          记一笔花销
        </button>
        <button
          onClick={() => {
            const field = grid.current?.querySelector<HTMLTextAreaElement>(
              '[aria-label="主页原料内容"]',
            );
            if (field) {
              field.scrollIntoView({ block: "center", behavior: "smooth" });
              field.focus({ preventScroll: true });
            } else navigate("raw");
          }}
        >
          <Icon name="raw" size={16} />
          收集原料
        </button>
        <button onClick={() => navigate("ideas")}>
          <Icon name="ideas" size={16} />
          暂存想法
        </button>
      </div>
      {editing && (
        <div className="widget-catalog">
          <span>添加板块</span>
          {cards
            .filter(([key]) => !layout.some((c) => c.key === key))
            .map(([key, label]) => (
              <button
                key={key}
                onClick={() => setLayout([...layout, { key, size: "half" }])}
              >
                ＋ {label}
              </button>
            ))}
          <small>长按进入排版，拖动卡片可调整位置</small>
        </div>
      )}
      <div className="home-grid" ref={grid}>
        {layout.map((card) => (
          <div
            key={card.key}
            data-card={card.key}
            className={
              "home-widget " + card.size + (editing ? " arranging" : "")
            }
            draggable={editing}
            onDragStart={(e) => {
              drag.current = card.key;
              e.dataTransfer.setData("text/card", card.key);
            }}
            onDragOver={(e) => {
              if (editing) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const source = e.dataTransfer.getData("text/card") as CardKey;
              if (source) move(source, card.key);
              drag.current = null;
            }}
            onPointerDown={(e) => {
              if (
                (e.target as HTMLElement).closest(
                  "button,input,textarea,select",
                )
              )
                return;
              if (editing) drag.current = card.key;
              longPress.current = setTimeout(() => {
                setEditing(true);
                drag.current = card.key;
              }, 550);
            }}
            onPointerMove={(e) => {
              if (!editing || !drag.current) {
                if (longPress.current) clearTimeout(longPress.current);
                return;
              }
              if (e.pointerType === "touch") {
                e.preventDefault();
                const target = document
                  .elementFromPoint(e.clientX, e.clientY)
                  ?.closest<HTMLElement>("[data-card]")?.dataset.card as
                  CardKey | undefined;
                if (target) move(drag.current, target);
              }
            }}
            onPointerUp={() => {
              if (longPress.current) clearTimeout(longPress.current);
              drag.current = null;
            }}
            onClick={(e) => {
              if (
                !editing &&
                !(e.target as HTMLElement).closest(
                  "button,input,textarea,select,a",
                )
              )
                navigate(route(card.key));
            }}
          >
            {editing && (
              <div className="widget-controls">
                <button
                  onClick={() =>
                    setLayout(layout.filter((c) => c.key !== card.key))
                  }
                >
                  移除
                </button>
                <button
                  onClick={() =>
                    setLayout(
                      layout.map((c) =>
                        c.key === card.key
                          ? { ...c, size: c.size === "half" ? "wide" : "half" }
                          : c,
                      ),
                    )
                  }
                >
                  {card.size === "half" ? "改为全宽" : "改为半宽"}
                </button>
              </div>
            )}
            <Panel
              title={cards.find(([key]) => key === card.key)![1]}
              aside={
                <button
                  aria-label={
                    "打开 " + cards.find(([key]) => key === card.key)![1]
                  }
                  onClick={() => navigate(route(card.key))}
                >
                  <Icon name="arrow" size={15} />
                </button>
              }
            >
              {card.key === "practice" ? (
                <HomePractice entities={entities} navigate={navigate} />
              ) : card.key === "time" ? (
                <>
                  <div className="home-figure">
                    <strong>
                      {Math.floor((summary.daily[today()] ?? 0) / 60)}
                    </strong>
                    <span>分钟 · 今日累计</span>
                  </div>
                  <div className="time-breakdown">
                    {domains.map((e) => {
                      const seconds =
                        timeSummary(
                          entities.filter(
                            (s) =>
                              s.type === "session" && s.data.domainId === e.id,
                          ),
                          Date.now(),
                        ).daily[today()] ?? 0;
                      return (
                        <div key={e.id}>
                          <div>
                            <span>{str(e, "name")}</span>
                            <strong>
                              {Math.floor(seconds / 60)} <small>分钟</small>
                            </strong>
                          </div>
                          <div className="time-track">
                            <span
                              style={{
                                width:
                                  Math.min(
                                    100,
                                    (seconds /
                                      Math.max(
                                        summary.daily[today()] ?? 0,
                                        1,
                                      )) *
                                      100,
                                  ) + "%",
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                    {!domains.length && (
                      <p className="home-empty">
                        推进一件事之后，时间会在这里积累。
                      </p>
                    )}
                  </div>
                </>
              ) : card.key === "tasks" || card.key === "recent" ? (
                <HomeTaskList
                  tasks={tasks.filter(
                    (t) =>
                      t.status === "pending" &&
                      (card.key === "tasks"
                        ? inPeriod(t, "", today())
                        : t.schedule?.kind === "recent"),
                  )}
                  navigate={navigate}
                  recent={card.key === "recent"}
                />
              ) : card.key === "habits" ? (
                <div>
                  {!homeHabits.length && (
                    <p className="home-empty">
                      今天没有安排习惯。可以到习惯库随手记录。
                    </p>
                  )}
                  {homeHabits.map((e) => (
                    <HabitRow
                      key={e.id}
                      habit={e}
                      day={today()}
                      all={entities}
                      home
                    />
                  ))}
                  <button className="muted" onClick={() => navigate("habits")}>
                    全部记录与统计 ↗
                  </button>
                </div>
              ) : card.key === "expenses" ? (
                <>
                  <div className="home-figure">
                    <strong>{money(expense)}</strong>
                    <span>今日花销</span>
                  </div>
                  <button
                    className="primary"
                    onClick={() => setExpenseForm(true)}
                  >
                    <Icon name="plus" size={15} />
                    记一笔
                  </button>
                </>
              ) : card.key === "chronicle" ? (
                <>
                  <div className="home-chronicle">
                    {!logs.length && (
                      <p className="muted">今天还没有记录，先留下一件小事。</p>
                    )}
                    {logs.map((e) => (
                      <p key={e.id}>{str(e, "body")}</p>
                    ))}
                  </div>
                  <textarea
                    aria-label="主页记录一件事"
                    placeholder="记下今天发生的一件事…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        if (draft.trim())
                          perform(
                            put("journal", {
                              kind: "chronicle",
                              day: today(),
                              body: draft,
                              complete: false,
                            }).then(() => setDraft("")),
                          );
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (draft.trim())
                        perform(
                          put("journal", {
                            kind: "chronicle",
                            day: today(),
                            body: draft,
                            complete: false,
                          }).then(() => setDraft("")),
                        );
                    }}
                  >
                    ＋ 记下一件事
                  </button>
                </>
              ) : card.key === "raw" ? (
                <>
                  <textarea
                    aria-label="主页原料内容"
                    placeholder="粘贴原文、链接或随手记下的片段，保留换行…"
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                  />
                  <button
                    className="primary"
                    disabled={!raw.trim()}
                    onClick={() =>
                      perform(
                        put("journal", {
                          kind: "raw",
                          day: today(),
                          body: raw,
                          complete: false,
                        }).then(() => setRaw("")),
                      )
                    }
                  >
                    确认
                  </button>
                </>
              ) : card.key === "days" ? (
                <React.Suspense fallback={<small>正在读取日子…</small>}>
                  <ImportantSummary entities={entities} navigate={navigate} />
                </React.Suspense>
              ) : (
                <div className="dense-list">
                  {!entities.some((e) => e.type === "metric") && (
                    <p className="home-empty">
                      添加睡眠、心情等指标，逐日留下自己的状态。
                    </p>
                  )}
                  {entities
                    .filter((e) => e.type === "metric")
                    .map((e) => (
                      <button key={e.id} onClick={() => navigate("metrics")}>
                        <span>{str(e, "name")}</span>
                        <strong>
                          {str(
                            entities.find(
                              (log) =>
                                log.type === "metricLog" &&
                                log.data.metricId === e.id &&
                                log.data.day === today(),
                            ),
                            "value",
                            "—",
                          )}{" "}
                          {str(e, "unit")}
                        </strong>
                      </button>
                    ))}
                </div>
              )}
            </Panel>
          </div>
        ))}
      </div>
      {expenseForm && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-expense-title"
          >
            <header>
              <h2 id="home-expense-title">记一笔花销</h2>
              <button
                aria-label="关闭记账"
                onClick={() => setExpenseForm(false)}
              >
                <Icon name="close" />
              </button>
            </header>
            <React.Suspense fallback={<Empty text="正在打开记账…" />}>
              <QuickExpense
                categories={entities.filter((e) => e.type === "category")}
                onClose={() => setExpenseForm(false)}
              />
            </React.Suspense>
          </div>
        </div>
      )}
    </>
  );
}
const QuickExpense = React.lazy(() =>
  import("./Finance.tsx").then((m) => ({ default: m.ExpenseEditor })),
);
function HomeTaskList({
  tasks,
  navigate,
  recent,
}: {
  tasks: Task[];
  navigate: Navigate;
  recent: boolean;
}) {
  const [busy, setBusy] = useState<string>();
  return (
    <div className="home-tasks">
      <div className="home-task-count">
        <strong>{tasks.length}</strong>
        <span>件待完成</span>
      </div>
      {tasks.length === 0 ? (
        <p className="home-empty">
          {recent
            ? "近期没有待办，给接下来留一点余地。"
            : "今天没有安排，可以开始一件想做的事。"}
        </p>
      ) : (
        tasks.slice(0, 4).map((task) => (
          <div className="home-task-row" key={task.id}>
            <button
              className="task-check"
              aria-label={"完成任务 " + task.title}
              disabled={busy === task.id}
              onClick={() => {
                setBusy(task.id);
                perform(
                  enqueue("complete", task.id).finally(() =>
                    setBusy(undefined),
                  ),
                );
              }}
            >
              <Icon name="check" size={14} />
            </button>
            <button
              className="home-task-title"
              onClick={() => navigate("tasks")}
            >
              {task.title}
              <small>{scheduleLabel(task.schedule)}</small>
            </button>
          </div>
        ))
      )}
      <button className="home-task-more" onClick={() => navigate("tasks")}>
        {tasks.length > 4 ? `查看其余 ${tasks.length - 4} 件任务` : "管理任务"}
        <Icon name="arrow" size={13} />
      </button>
    </div>
  );
}
