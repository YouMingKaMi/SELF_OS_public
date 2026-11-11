import React, { useEffect, useState } from "react";
import "./tasks.css";
import {
  Heading,
  Panel,
  Stats,
  Month,
  DayPicker,
  today,
  daysInMonth,
} from "../ui/shared.tsx";
import {
  enqueue,
  undo,
  resolve,
  useTasks,
  type Task,
  type Schedule,
} from "../data/tasks.ts";
import { synchronize, useSyncStatus } from "../data/entities.ts";
import { ScheduleFields } from "../ScheduleFields.tsx";
import {
  inPeriod,
  groupTasks,
  sameSchedule,
  scheduleLabel,
} from "../scheduling.ts";
import { validateSchedule } from "../../../../modules/tasks/index.ts";
export function TaskScreen() {
  const data = useTasks();
  const { state, message } = useSyncStatus();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("pending");
  const [title, setTitle] = useState("");
  const [schedule, setSchedule] = useState<Schedule>({ kind: "unscheduled" });
  const [editSchedule, setEditSchedule] = useState<Schedule>({
    kind: "unscheduled",
  });
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [selected, setSelected] = useState<string>();
  const [edit, setEdit] = useState("");
  const [error, setError] = useState("");

  const update = synchronize;

  const task = data.tasks.find((t) => t.id === selected);
  useEffect(() => {
    setEdit(task?.title ?? "");
    setEditSchedule(task?.schedule ?? { kind: "unscheduled" });
  }, [task?.id, task?.title, JSON.stringify(task?.schedule)]);
  async function saveTask() {
    if (!task) return;
    const plan = validateSchedule(editSchedule);
    if (edit.trim() !== task.title)
      await enqueue("rename", task.id, edit.trim());
    if (!sameSchedule(plan, task.schedule))
      await enqueue("schedule", task.id, undefined, plan);
  }

  async function action(fn: () => Promise<void>) {
    try {
      await fn();
      setError("");
      void update();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试");
    }
  }
  const visible = data.tasks.filter(
    (t) =>
      (filter === "all" || t.status === filter) &&
      t.title.toLowerCase().includes(query.toLowerCase()) &&
      inPeriod(t, month, day),
  );
  const pending = data.pending
    .filter((op) => op.entityId === selected)
    .sort((a, b) => a.sequence - b.sequence);
  const conflict = pending.find((op) => op.state === "conflict");
  const labels = {
    pending: "待完成",
    completed: "已完成",
    discarded: "已废弃",
  };
  const todayKey = today();
  const pendingTasks = data.tasks.filter((t) => t.status === "pending");
  const dueToday = pendingTasks.filter((t) => inPeriod(t, "", todayKey));
  const overdue = pendingTasks.filter(
    (t) => t.schedule.kind === "deadline" && t.schedule.date < todayKey,
  );
  const calendarMonth = month || todayKey.slice(0, 7);
  const calendarDays = daysInMonth(calendarMonth);
  const lead = new Date(calendarDays[0] + "T12:00:00Z").getUTCDay();
  const perDay = new Map(
    calendarDays.map((d) => [
      d,
      data.tasks.filter((t) => t.status !== "discarded" && inPeriod(t, "", d)),
    ]),
  );
  const syncLabel =
    state === "connecting"
      ? "正在同步"
      : data.pending.some((op) => op.state === "conflict")
        ? "有修改需要处理"
        : state === "synced"
          ? "已同步"
          : state === "offline"
            ? "离线 · 本机已保存"
            : state === "unauthorized"
              ? "需要重新授权 · 本机已保存"
              : "连接暂不可用";
  return (
    <>
      <Heading
        eyebrow="A LITTLE PROGRESS, EVERY DAY"
        title="任务"
        description="先记下来，准备好时再行动。完成以实际完成那天留档。"
      >
        <button
          className="sync ghost"
          onClick={() => void update()}
          title={message}
        >
          <span className="status-dot" />
          {syncLabel}
        </button>
      </Heading>
      <div className="columns wide-left tasks">
        <Panel
          className="task-panel"
          title={"待完成 " + pendingTasks.length + " · 共 " + data.tasks.length}
          aside={
            <input
              className="search"
              aria-label="搜索任务"
              placeholder="搜索…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          }
        >
          <div className="task-capture">
            <form
              className="capture"
              onSubmit={(event) => {
                event.preventDefault();
                if (!title.trim()) return;
                const text = title.trim();
                void action(async () => {
                  await enqueue(
                    "create",
                    crypto.randomUUID(),
                    text,
                    validateSchedule(schedule),
                  );
                  setTitle("");
                });
              }}
            >
              <input
                aria-label="添加任务"
                placeholder="记下一件想做的事，回车保存…"
                value={title}
                maxLength={500}
                onChange={(e) => setTitle(e.target.value)}
              />
              <button
                type="submit"
                className="primary"
                disabled={!title.trim()}
              >
                添加 <span>↵</span>
              </button>
            </form>
            <details className="new-schedule">
              <summary>安排 · {scheduleLabel(schedule)}</summary>
              <ScheduleFields
                prefix="new"
                value={schedule}
                onChange={setSchedule}
              />
            </details>
          </div>
          <div className="toolbar">
            <div className="segmented">
              {[
                ["pending", "待完成"],
                ["completed", "已完成"],
                ["discarded", "已废弃"],
                ["all", "全部"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={filter === key ? "active" : ""}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="spacer" />
            <button
              className={!month && !day ? "ghost active-filter" : "ghost"}
              onClick={() => {
                setMonth("");
                setDay("");
              }}
            >
              全部时间
            </button>
            <Month
              label="查看月份"
              value={month}
              onChange={(value) => {
                setMonth(value);
                setDay("");
              }}
            />
            <DayPicker
              label="查找日期"
              clearable
              value={day}
              onChange={(value) => {
                setDay(value);
                if (value) setMonth(value.slice(0, 7));
              }}
            />
          </div>
          {(month || day) && (
            <small className="filter-note">
              未定日期与近期任务只在“全部时间”里出现；已完成按完成日查看。
            </small>
          )}
          <div className="task-list">
            {visible.length === 0 ? (
              <div className="empty">
                <span>✓</span>
                <h3>
                  {query
                    ? "没有找到这件事"
                    : filter === "pending"
                      ? "给下一步留一个位置"
                      : "这里还没有记录"}
                </h3>
                <p>
                  {query
                    ? "试试其他关键词。"
                    : "在上方写下一件事，按回车保存。"}
                </p>
              </div>
            ) : (
              groupTasks(visible).map((group) => (
                <section className="task-group" key={group.label}>
                  <h3>
                    {group.label}
                    <span>{group.tasks.length}</span>
                  </h3>
                  {group.tasks.map((t) => (
                    <div
                      key={t.id}
                      className={
                        "task-row " + (selected === t.id ? "selected" : "")
                      }
                    >
                      <button
                        className={
                          "check " + (t.status === "completed" ? "checked" : "")
                        }
                        aria-label={
                          (t.status === "completed" ? "恢复 " : "完成 ") +
                          t.title
                        }
                        disabled={
                          t.status === "discarded" ||
                          data.pending.some(
                            (op) =>
                              op.entityId === t.id && op.state === "conflict",
                          )
                        }
                        onClick={() =>
                          void action(() =>
                            enqueue(
                              t.status === "completed" ? "reopen" : "complete",
                              t.id,
                            ),
                          )
                        }
                      >
                        {t.status === "completed" ? "✓" : ""}
                      </button>
                      <button
                        className="task-content"
                        onClick={() => setSelected(t.id)}
                      >
                        <span
                          className={t.status === "completed" ? "done" : ""}
                        >
                          {t.title}
                        </span>
                        <small>
                          {data.pending.some(
                            (op) =>
                              op.entityId === t.id && op.state === "conflict",
                          )
                            ? "需要处理冲突"
                            : data.pending.some((op) => op.entityId === t.id)
                              ? "已保存到本机 · 等待同步"
                              : labels[t.status]}
                        </small>
                      </button>
                      <button
                        className="detail-arrow"
                        aria-label={"查看 " + t.title}
                        onClick={() => setSelected(t.id)}
                      >
                        ↗
                      </button>
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>
        </Panel>
        <Panel
          className="detail-panel"
          title={task ? "任务详情" : "本月安排"}
          aside={
            task ? (
              <button
                aria-label="关闭详情"
                className="ghost"
                onClick={() => setSelected(undefined)}
              >
                ×
              </button>
            ) : (
              <small className="mono">{calendarMonth}</small>
            )
          }
        >
          {task ? (
            <div className="detail-body">
              <div className="pill">{labels[task.status]}</div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (edit.trim()) void action(saveTask);
                }}
              >
                <label htmlFor="task-title">要做的事</label>
                <textarea
                  id="task-title"
                  value={edit}
                  maxLength={500}
                  onChange={(e) => setEdit(e.target.value)}
                />
                <ScheduleFields
                  prefix="edit"
                  value={editSchedule}
                  onChange={setEditSchedule}
                />
                <button
                  className="primary"
                  disabled={
                    !edit.trim() ||
                    (edit.trim() === task.title &&
                      sameSchedule(editSchedule, task.schedule)) ||
                    !!conflict
                  }
                >
                  保存修改
                </button>
              </form>
              <div className="detail-actions">
                {task.status !== "pending" && (
                  <button
                    onClick={() =>
                      void action(() => enqueue("reopen", task.id))
                    }
                    disabled={!!conflict}
                  >
                    ↶ 恢复待办
                  </button>
                )}
                {task.status === "pending" && (
                  <button
                    onClick={() =>
                      void action(() => enqueue("complete", task.id))
                    }
                    disabled={!!conflict}
                  >
                    ✓ 标记完成
                  </button>
                )}
                {task.status !== "discarded" && (
                  <button
                    onClick={() =>
                      void action(() => enqueue("discard", task.id))
                    }
                    disabled={!!conflict}
                  >
                    废弃这件事
                  </button>
                )}
              </div>
              {pending.at(-1)?.state === "queued" && (
                <button
                  className="undo"
                  onClick={() => void action(() => undo(task.id))}
                >
                  ↶ 撤销最后一次待发送修改
                </button>
              )}
              {conflict && (
                <div className="conflict">
                  <h3>这件事在另一端有了修改</h3>
                  <p>你的记录仍保留在这里。选择要保留的版本。</p>
                  <blockquote>
                    {conflict.server?.title ?? "服务器上没有此任务"}
                    <small>
                      {conflict.server ? labels[conflict.server.status] : ""}
                    </small>
                  </blockquote>
                  <button
                    onClick={() => void action(() => resolve(task.id, true))}
                  >
                    保留我的修改
                  </button>
                  <button
                    onClick={() => void action(() => resolve(task.id, false))}
                  >
                    采用另一端版本
                  </button>
                </div>
              )}
              {task.completedAt && (
                <p className="completion-info">
                  上次完成：
                  {new Date(task.completedAt).toLocaleDateString("zh-CN")}
                </p>
              )}
              <div className="detail-foot">
                {pending.length ? "本机修改已保存" : "记录已同步"}
                <span>版本 {task.version}</span>
              </div>
            </div>
          ) : (
            <>
              <Stats
                items={[
                  ["待完成", String(pendingTasks.length)],
                  ["今天", String(dueToday.length)],
                  ["已过截止", String(overdue.length)],
                  [
                    "本月完成",
                    String(
                      data.tasks.filter(
                        (t) =>
                          t.status === "completed" &&
                          inPeriod(t, todayKey.slice(0, 7), ""),
                      ).length,
                    ),
                  ],
                ]}
              />
              <div className="task-calendar">
                {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
                  <span key={d} className="weekday">
                    {d}
                  </span>
                ))}
                {Array.from({ length: lead }, (_, i) => (
                  <span key={"lead" + i} />
                ))}
                {calendarDays.map((d) => {
                  const list = perDay.get(d) ?? [];
                  const open = list.filter((t) => t.status === "pending");
                  return (
                    <button
                      key={d}
                      title={list.map((t) => t.title).join("\n")}
                      className={
                        (d === day ? "current " : "") +
                        (d === todayKey ? "today " : "") +
                        (open.length ? "busy" : list.length ? "done" : "")
                      }
                      onClick={() => {
                        setDay(d === day ? "" : d);
                        setMonth(d.slice(0, 7));
                      }}
                    >
                      <span>{Number(d.slice(8))}</span>
                      {list.length > 0 && (
                        <i>
                          {list.slice(0, 3).map((t) => (
                            <b
                              key={t.id}
                              className={t.status === "completed" ? "done" : ""}
                            />
                          ))}
                        </i>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="muted-note">
                点一天筛选左侧清单；再点一次取消。实心点是待完成，空心点是已完成。
              </p>
            </>
          )}
        </Panel>
      </div>
      {error && (
        <div role="alert" className="toast">
          <span>{error}</span>
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}
    </>
  );
}
