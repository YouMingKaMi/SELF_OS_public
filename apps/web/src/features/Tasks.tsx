import React, { useEffect, useMemo, useState } from "react";
import "./tasks.css";
import { Icon } from "../ui/Icon.tsx";
import { TaskOrganize } from "./TaskOrganize.tsx";
import { TaskGraph, TaskTrack, taskLayers } from "./TaskGraph.tsx";
import { Panel, today } from "../ui/shared.tsx";
import {
  TaskCalendarFilter,
  TaskPopover,
  TaskSchedulePicker,
  taskMonthLabel,
} from "./TaskDateControls.tsx";
import {
  enqueue,
  editDependency,
  undo,
  resolve,
  useTasks,
  type Task,
  type Schedule,
  type TaskDetails,
} from "../data/tasks.ts";
import {
  put,
  remove,
  enqueueTogether,
  synchronize,
  useEntities,
  useSyncStatus,
} from "../data/entities.ts";
import { ScheduleFields } from "../ScheduleFields.tsx";
import {
  inPeriod,
  groupTasks,
  sameSchedule,
  scheduleLabel,
} from "../scheduling.ts";
import {
  belongsToday,
  isNextTask,
  outstandingPrerequisites,
  reachesTask,
  validateSchedule,
} from "../../../../modules/tasks/index.ts";
function nextGroups(tasks: Task[], day: string) {
  const end = new Date(day + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 7);
  const week = end.toISOString().slice(0, 10);
  const groups = ["已过截止", "今天", "7 天内", "稍后", "无截止时间"].map(
    (label) => ({ label, tasks: [] as Task[] }),
  );
  const date = (task: Task) =>
    task.schedule.kind === "range"
      ? task.schedule.end
      : "date" in task.schedule
        ? task.schedule.date
        : "";
  for (const task of [...tasks].sort((a, b) =>
    (date(a) + (a.scheduleTime || "24:00")).localeCompare(
      date(b) + (b.scheduleTime || "24:00"),
    ),
  )) {
    const target = date(task);
    const index =
      task.schedule.kind === "deadline" && target < day
        ? 0
        : target && target <= day
          ? 1
          : target && target <= week
            ? 2
            : target
              ? 3
              : 4;
    groups[index]!.tasks.push(task);
  }
  return groups.filter((group) => group.tasks.length);
}

export function TaskScreen() {
  const data = useTasks();
  const { entities: lists } = useEntities("taskList");
  const [listId, setListId] = useState("");
  const [listDraft, setListDraft] = useState("");
  const [folderEditor, setFolderEditor] = useState<"new" | "rename" | null>(
    null,
  );
  const [folderParent, setFolderParent] = useState("");
  const [mode, setMode] = useState<"list" | "graph">("list");
  const [includeChildren, setIncludeChildren] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [linking, setLinking] = useState(false);
  const [source, setSource] = useState<string>();
  const [organizing, setOrganizing] = useState(false);
  const [imported, setImported] = useState<string[]>([]);
  const [notice, setNotice] = useState<{
    id: string;
    text: string;
    unlocked: Set<string>;
  }>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [details, setDetails] = useState<TaskDetails>({
    note: "",
    scheduleTime: "",
    listId: "",
    prerequisiteIds: [],
  });
  const [dependency, setDependency] = useState("");
  const byId = useMemo(
    () => new Map(data.tasks.map((item) => [item.id, item])),
    [data.tasks],
  );
  const blockers = useMemo(
    () =>
      new Map(
        data.tasks.map((item) => [
          item.id,
          outstandingPrerequisites(item, byId),
        ]),
      ),
    [data.tasks, byId],
  );
  const unlockCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of data.tasks) {
      if (item.status !== "pending") continue;
      const missing = blockers.get(item.id);
      const key = missing?.length === 1 ? missing[0] : undefined;
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [data.tasks, blockers]);
  const { state, message } = useSyncStatus();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("next");
  const [popup, setPopup] = useState<
    "folders" | "filters" | "calendar" | "schedule" | null
  >(null);
  const closePopup = () => setPopup(null);
  const togglePopup = (next: NonNullable<typeof popup>) =>
    setPopup((current) => (current === next ? null : next));
  const [title, setTitle] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [schedule, setSchedule] = useState<Schedule>({ kind: "unscheduled" });
  const [editSchedule, setEditSchedule] = useState<Schedule>({
    kind: "unscheduled",
  });
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [selected, setSelected] = useState<string>();
  const [edit, setEdit] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!selected && !folderEditor && !linking) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (folderEditor) setFolderEditor(null);
      else if (selected) setSelected(undefined);
      else {
        setLinking(false);
        setSource(undefined);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [selected, folderEditor, linking]);

  const update = synchronize;

  const task = data.tasks.find((t) => t.id === selected);
  useEffect(() => {
    setEdit(task?.title ?? "");
    setDetails({
      note: task?.note ?? "",
      scheduleTime: task?.scheduleTime ?? "",
      listId: task?.listId ?? "",
      prerequisiteIds: task?.prerequisiteIds ?? [],
    });
    setDependency("");
    setEditSchedule(task?.schedule ?? { kind: "unscheduled" });
  }, [task?.id, task?.version]);
  async function saveTask() {
    if (!task) return;
    const plan = validateSchedule(editSchedule);
    await enqueue("edit", task.id, edit, plan, details);
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
  const todayKey = today();
  const folders = useMemo(() => {
    const byKey = new Map(lists.map((folder) => [folder.id, folder]));
    const children = new Map<string, typeof lists>();
    for (const folder of lists) {
      const parent = folder.data.parentId ?? "";
      const key = byKey.has(parent) ? parent : "";
      children.set(key, [...(children.get(key) ?? []), folder]);
    }
    children.forEach((items) =>
      items.sort((a, b) => a.data.name.localeCompare(b.data.name, "zh-CN")),
    );
    const trail = (id: string) => {
      const names: string[] = [];
      const seen = new Set<string>();
      for (
        let folder = byKey.get(id);
        folder && !seen.has(folder.id);
        folder = byKey.get(folder.data.parentId ?? "")
      ) {
        seen.add(folder.id);
        names.unshift(folder.data.name);
      }
      return names.join(" / ");
    };
    return { byKey, children, trail };
  }, [lists]);
  const inFolder = useMemo(() => {
    const keys = new Set([listId]);
    if (includeChildren && listId) {
      const queue = [listId];
      for (const parent of queue)
        for (const folder of folders.children.get(parent) ?? []) {
          if (keys.has(folder.id)) continue;
          keys.add(folder.id);
          queue.push(folder.id);
        }
    }
    return keys;
  }, [listId, includeChildren, folders]);
  const activeFolder = folders.byKey.get(listId);
  const scope = filter === "folder";
  const isGraph = scope && mode === "graph";
  const matchesQuery = (t: Task) =>
    (t.title + "\n" + t.note)
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const issueIds = new Set(
    data.pending
      .filter((op) => op.state === "conflict" || op.state === "error")
      .map((op) => op.entityId),
  );
  const available = data.tasks.filter((item) =>
    isNextTask(item, byId, todayKey),
  );
  const folderTitle = activeFolder?.data.name ?? "根目录";
  const folderView = data.tasks.filter(
    (item) =>
      inFolder.has(item.listId) &&
      matchesQuery(item) &&
      (item.status === "pending" ||
        (showCompleted && item.status === "completed")) &&
      inPeriod(item, month, day),
  );
  function changeView(next: string, folder = "") {
    closePopup();
    setFilter(next);
    setListId(folder);
    setMode("list");
    setQuery("");
    setMonth("");
    setDay("");
    setLinking(false);
    setSource(undefined);
    setSelected(undefined);
  }
  const visible = scope
    ? folderView
    : data.tasks.filter((t) => {
        if (
          query &&
          !(t.title + "\n" + t.note)
            .toLowerCase()
            .includes(query.trim().toLowerCase())
        )
          return false;
        if (query.trim() && !month && !day) return true;
        if (month || day) {
          return (
            inPeriod(t, month, day) &&
            (!["pending", "completed", "discarded"].includes(filter) ||
              t.status === filter)
          );
        }
        if (filter === "all") return true;
        if (filter === "next") return isNextTask(t, byId, todayKey);
        if (filter === "inbox")
          return (
            t.status === "pending" &&
            t.schedule.kind === "unscheduled" &&
            !t.listId
          );
        if (filter === "today") return belongsToday(t, todayKey);
        if (filter === "blocked")
          return t.status === "pending" && !!blockers.get(t.id)?.length;
        return t.status === filter;
      });
  function capture(text: string) {
    if (adding) return;
    setAdding(true);
    void action(async () => {
      try {
        await enqueue(
          "create",
          crypto.randomUUID(),
          text,
          validateSchedule(schedule),
          { listId, scheduleTime: "date" in schedule ? scheduleTime : "" },
        );
        closePopup();
        setTitle((current) => (current.trim() === text ? "" : current));
        if (
          !scope &&
          !month &&
          !day &&
          (filter !== "next" ||
            ("date" in schedule &&
              schedule.kind === "day" &&
              schedule.date > todayKey) ||
            (schedule.kind === "range" && schedule.start > todayKey))
        )
          setFilter(
            filter === "inbox" && schedule.kind === "unscheduled"
              ? "inbox"
              : "pending",
          );
        setSchedule({ kind: "unscheduled" });
        setScheduleTime("");
      } finally {
        setAdding(false);
      }
    });
  }
  const pending = data.pending
    .filter((op) => op.entityId === selected)
    .sort((a, b) => a.sequence - b.sequence);
  const conflict = pending.find((op) =>
    ["conflict", "error"].includes(op.state),
  );
  const labels = {
    pending: "待完成",
    completed: "已完成",
    discarded: "已废弃",
  };
  const taskErrors: Record<string, string> = {
    TASK_LIST_CYCLE: "文件夹不能放在自己的子文件夹里。",
    TASK_DEPENDENCY_CYCLE:
      "另一台设备的修改使前置关系形成了循环。请撤回这次修改，再重新选择。",
    TASK_PREREQUISITES_OPEN: "前置任务还未完成，可能已在另一台设备恢复待办。",
    TASK_PREREQUISITE_NOT_PENDING:
      "只能添加待完成的任务作为前置。它可能已在另一台设备完成或废弃。",
    TASK_PREREQUISITE_MISSING: "前置任务已不存在，请重新选择。",
    INVALID_TASK_LIST: "这份清单已不存在，请重新选择。",
  };
  const syncLabel =
    state === "connecting"
      ? "正在同步"
      : data.pending.some(
            (op) => op.state === "conflict" || op.state === "error",
          )
        ? "有修改需要处理"
        : state === "synced"
          ? "已同步"
          : state === "offline"
            ? "离线 · 本机已保存"
            : state === "unauthorized"
              ? "需要重新授权 · 本机已保存"
              : "连接暂不可用";
  function tone(item: Task) {
    if (item.status !== "pending") return item.status;
    return blockers.get(item.id)?.length ? "waiting" : "ready";
  }
  function toggle(item: Task) {
    void action(async () => {
      const completes = item.status === "pending";
      const unlocked = completes
        ? data.tasks.filter(
            (candidate) =>
              candidate.status === "pending" &&
              blockers.get(candidate.id)?.length === 1 &&
              blockers.get(candidate.id)![0] === item.id,
          )
        : [];
      await enqueue(completes ? "complete" : "reopen", item.id);
      if (completes) {
        setNotice({
          id: item.id,
          text:
            unlocked.length === 1
              ? `解锁了「${unlocked[0]!.title}」`
              : unlocked.length
                ? `解锁了 ${unlocked.length} 项`
                : `已完成「${item.title}」`,
          unlocked: new Set(unlocked.map((candidate) => candidate.id)),
        });
      } else setNotice(undefined);
    });
  }
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!imported.length) return;
    const timer = window.setTimeout(() => setImported([]), 8000);
    return () => window.clearTimeout(timer);
  }, [imported]);

  function metadata(
    item: Task,
    context = false,
    compact = false,
    groupLabel?: string,
  ) {
    const label = scheduleLabel(item.schedule);
    const dateInHeading = label === groupLabel;
    const waits =
      item.status === "pending" ? (blockers.get(item.id)?.length ?? 0) : 0;
    const unlocks =
      item.status === "pending" && waits === 0
        ? (unlockCount.get(item.id) ?? 0)
        : 0;
    return (
      <>
        {context && item.listId && <span>{folders.trail(item.listId)}</span>}
        {item.schedule.kind !== "unscheduled" &&
          (!dateInHeading || item.scheduleTime) && (
            <span>
              <Icon name="days" size={12} />
              {!dateInHeading &&
                (compact && "date" in item.schedule
                  ? item.schedule.date.slice(5).replace("-", "/")
                  : label)}
              {item.scheduleTime &&
                (dateInHeading ? item.scheduleTime : " " + item.scheduleTime)}
            </span>
          )}
        {waits > 0 && <span className="task-waits">↳ 等 {waits} 项</span>}
        {unlocks > 0 && (
          <span className="task-unlocks">↪ 解锁 {unlocks} 项</span>
        )}
        {issueIds.has(item.id) && <span className="task-waits">待处理</span>}
        {item.status === "discarded" && <span>已废弃</span>}
      </>
    );
  }

  function canLink(item: Task) {
    if (item.status !== "pending" || issueIds.has(item.id)) return false;
    if (!source || item.id === source || item.prerequisiteIds.includes(source))
      return true;
    const parent = byId.get(source);
    return (
      parent?.status === "pending" &&
      item.prerequisiteIds.length < 40 &&
      !reachesTask(source, item.id, (id) => byId.get(id)?.prerequisiteIds ?? [])
    );
  }
  function setEdge(from: string, to: string, remove: boolean) {
    void action(async () => {
      await editDependency(from, to, remove);
      setSource(undefined);
    });
  }
  function graphSelect(item: Task) {
    if (!linking) {
      setSelected(item.id);
      return;
    }
    if (!canLink(item)) return;
    if (!source || source === item.id) {
      setSource(source ? undefined : item.id);
      return;
    }
    setEdge(source, item.id, item.prerequisiteIds.includes(source));
  }
  function renderRow(t: Task, groupLabel?: string) {
    const status = tone(t);
    return (
      <div
        key={t.id}
        data-track-id={t.id}
        className={`task-row ${status}${selected === t.id ? " selected" : ""}${notice?.unlocked.has(t.id) ? " just-unlocked" : ""}`}
      >
        <button
          className={`check ${t.status === "completed" ? "checked" : ""}`}
          aria-label={(t.status === "completed" ? "恢复 " : "完成 ") + t.title}
          title={status === "waiting" ? "先完成前置任务" : undefined}
          disabled={
            status === "discarded" || status === "waiting" || issueIds.has(t.id)
          }
          onClick={() => toggle(t)}
        >
          {t.status === "completed" ? "✓" : ""}
        </button>
        <button className="task-content" onClick={() => setSelected(t.id)}>
          <span className={t.status === "completed" ? "done" : ""}>
            {t.title}
          </span>
          <small className="task-row-meta">
            {metadata(t, !scope || t.listId !== listId, false, groupLabel)}
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
    );
  }
  function renderFolders(parent: string, depth: number): React.ReactNode {
    return (folders.children.get(parent) ?? []).map((folder) => {
      const hasChildren = folders.children.has(folder.id);
      const closed = collapsed.has(folder.id);
      return (
        <React.Fragment key={folder.id}>
          <div
            className="task-folder-item"
            style={{ paddingInlineStart: Math.min(depth, 8) * 12 }}
          >
            {hasChildren ? (
              <button
                className="ghost folder-disclosure"
                aria-label={(closed ? "展开 " : "折叠 ") + folder.data.name}
                aria-expanded={!closed}
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(folder.id)) next.delete(folder.id);
                    else next.add(folder.id);
                    return next;
                  })
                }
              >
                {closed ? "›" : "⌄"}
              </button>
            ) : (
              <span className="folder-spacer" />
            )}
            <button
              className={scope && listId === folder.id ? "active" : ""}
              onClick={() => changeView("folder", folder.id)}
            >
              <Icon name="folder" size={14} />
              <span>{folder.data.name}</span>
            </button>
          </div>
          {hasChildren && !closed && renderFolders(folder.id, depth + 1)}
        </React.Fragment>
      );
    });
  }
  function editFolder(kind: "new" | "rename", parent = "") {
    closePopup();
    setListDraft(kind === "rename" ? folderTitle : "");
    setFolderParent(parent);
    setFolderEditor(kind);
  }
  function saveFolder(event: React.FormEvent) {
    event.preventDefault();
    const name = listDraft.trim();
    if (!name) return;
    void action(async () => {
      const id = await put(
        "taskList",
        {
          name,
          parentId:
            folderEditor === "new"
              ? folderParent
              : (activeFolder?.data.parentId ?? ""),
        },
        folderEditor === "rename" && listId ? { id: listId } : undefined,
      );
      if (folderParent)
        setCollapsed(
          (current) =>
            new Set([...current].filter((key) => key !== folderParent)),
        );
      setFolderEditor(null);
      changeView("folder", id);
    });
  }
  const sectionTitle = scope
    ? folderTitle
    : (
        {
          next: "接下来",
          completed: "已完成",
          inbox: "收件箱",
          today: "今天",
          blocked: "等前置",
          pending: "待完成",
          discarded: "已废弃",
          all: "全部任务",
        } as Record<string, string>
      )[filter];
  const groups =
    filter === "next" && !query.trim() && !month && !day
      ? nextGroups(visible, todayKey)
      : groupTasks(visible, todayKey);
  const chain = scope && !month && !day ? taskLayers(folderView).flat() : [];
  return (
    <>
      <div className="task-workspace">
        <main className="task-page">
          <header className="task-page-head">
            <div className="task-page-title">
              {activeFolder?.data.parentId && (
                <small>{folders.trail(activeFolder.data.parentId)}</small>
              )}
              <h1>{query.trim() ? "搜索结果" : sectionTitle}</h1>
              {filter === "next" && !query.trim() && (
                <p>
                  {new Intl.DateTimeFormat("zh-CN", {
                    month: "long",
                    day: "numeric",
                    weekday: "long",
                    timeZone: "UTC",
                  }).format(new Date(todayKey + "T12:00:00Z"))}{" "}
                  · {available.length} 项可做
                </p>
              )}
            </div>
            <div className="task-page-controls">
              {scope && (
                <div className="segmented task-mode" aria-label="任务视图">
                  <button
                    aria-pressed={!isGraph}
                    className={!isGraph ? "active" : ""}
                    onClick={() => {
                      setMode("list");
                      setLinking(false);
                      setSource(undefined);
                    }}
                  >
                    列表
                  </button>
                  <button
                    aria-pressed={isGraph}
                    className={isGraph ? "active" : ""}
                    onClick={() => {
                      setMode("graph");
                      setMonth("");
                      setDay("");
                    }}
                  >
                    关系图
                  </button>
                </div>
              )}
              <button
                className="sync ghost"
                aria-label={syncLabel}
                title={message || syncLabel}
                onClick={() => void update()}
              >
                <span className="status-dot" />
                <span className="task-sync-label">{syncLabel}</span>
              </button>
            </div>
          </header>
          <div className="task-nav">
            <nav className="task-primary-views" aria-label="任务视图">
              {(
                [
                  ["next", "接下来"],
                  ["inbox", "收件箱"],
                  ["completed", "已完成"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-current={filter === key ? "page" : undefined}
                  onClick={() => changeView(key)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="task-nav-tools">
              <TaskPopover
                className="task-folders-control"
                open={popup === "folders"}
                label="任务文件夹"
                active={scope}
                trigger={
                  <>
                    <Icon name="folder" size={16} />
                    文件夹
                    <span className="task-caret" />
                  </>
                }
                onToggle={() => togglePopup("folders")}
                onClose={closePopup}
              >
                <div className="task-folder-heading">
                  <strong>文件夹</strong>
                  <button
                    type="button"
                    className="ghost"
                    aria-label="新建清单"
                    onClick={() => editFolder("new")}
                  >
                    <Icon name="plus" size={15} />
                    新建
                  </button>
                </div>
                <div className="task-folder-tree">
                  <div className="task-folder-item">
                    <span className="folder-spacer" />
                    <button
                      className={scope && !listId ? "active" : ""}
                      onClick={() => changeView("folder")}
                    >
                      <Icon name="folder" size={15} />
                      根目录
                    </button>
                  </div>
                  {renderFolders("", 0)}
                </div>
              </TaskPopover>
              {!isGraph && (
                <TaskPopover
                  className="task-month-control"
                  open={popup === "calendar"}
                  label="月历"
                  active={!!month || !!day}
                  trigger={
                    <>
                      <Icon name="monthly" size={16} />
                      <span>
                        {day || (month && taskMonthLabel(month)) || "月历"}
                      </span>
                      <span className="task-caret" />
                    </>
                  }
                  onToggle={() => togglePopup("calendar")}
                  onClose={closePopup}
                >
                  <TaskCalendarFilter
                    month={month}
                    day={day}
                    today={todayKey}
                    tasks={data.tasks.filter(
                      (item) =>
                        matchesQuery(item) &&
                        (scope
                          ? inFolder.has(item.listId) &&
                            (item.status === "pending" ||
                              (showCompleted && item.status === "completed"))
                          : !["pending", "completed", "discarded"].includes(
                              filter,
                            ) || item.status === filter),
                    )}
                    onChange={(period, date = "") => {
                      setMonth(period);
                      setDay(date);
                      closePopup();
                    }}
                  />
                </TaskPopover>
              )}
              <TaskPopover
                className="task-filters-control"
                open={popup === "filters"}
                label="更多任务筛选"
                active={[
                  "today",
                  "blocked",
                  "pending",
                  "discarded",
                  "all",
                ].includes(filter)}
                trigger={
                  <>
                    <Icon name="settings" size={16} />
                    筛选
                  </>
                }
                onToggle={() => togglePopup("filters")}
                onClose={closePopup}
              >
                {(
                  [
                    ["today", "今天"],
                    ["pending", "待完成"],
                    ["blocked", "等前置"],
                    ["discarded", "已废弃"],
                    ["all", "全部任务"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={filter === key}
                    onClick={() => changeView(key)}
                  >
                    {label}
                    {filter === key && <Icon name="check" size={14} />}
                  </button>
                ))}
              </TaskPopover>
            </div>
            <label className="task-search">
              <Icon name="discover" size={16} />
              <input
                className="search"
                aria-label="搜索任务"
                placeholder="搜索任务"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          {scope && (
            <div className="task-folder-tools">
              <button
                aria-pressed={showCompleted}
                className={showCompleted ? "active-filter" : ""}
                onClick={() => setShowCompleted(!showCompleted)}
              >
                显示已完成
              </button>
              {activeFolder && (
                <>
                  <button
                    aria-pressed={includeChildren}
                    className={includeChildren ? "active-filter" : ""}
                    onClick={() => {
                      setIncludeChildren(!includeChildren);
                      setSource(undefined);
                    }}
                  >
                    包含子文件夹
                  </button>
                  <button
                    className="ghost"
                    aria-label="新建子文件夹"
                    title="新建子文件夹"
                    onClick={() => editFolder("new", listId)}
                  >
                    <Icon name="plus" size={14} />
                  </button>
                  <button
                    className="ghost"
                    aria-label="编辑清单"
                    title="重命名文件夹"
                    onClick={() => editFolder("rename")}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                </>
              )}
              {isGraph && (
                <button
                  className={
                    "task-link-button " + (linking ? "active-filter" : "")
                  }
                  aria-pressed={linking}
                  onClick={() => {
                    setLinking(!linking);
                    setSource(undefined);
                    setSelected(undefined);
                  }}
                >
                  {linking ? "退出连线" : "连线"}
                </button>
              )}
            </div>
          )}
          <form
            className="task-capture"
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim()) capture(title.trim());
            }}
          >
            <input
              aria-label="添加任务"
              placeholder={scope ? "添加事项…" : "记下一件事…"}
              value={title}
              maxLength={500}
              onChange={(event) => setTitle(event.target.value)}
            />
            <TaskPopover
              className="task-schedule-control"
              open={popup === "schedule"}
              label="安排日期"
              active={schedule.kind !== "unscheduled"}
              trigger={
                <>
                  <Icon name="monthly" size={16} />
                  <span title={scheduleLabel(schedule)}>
                    {schedule.kind === "unscheduled"
                      ? "安排日期"
                      : [scheduleLabel(schedule), scheduleTime]
                          .filter(Boolean)
                          .join(" ")}
                  </span>
                </>
              }
              onToggle={() => togglePopup("schedule")}
              onClose={closePopup}
            >
              <TaskSchedulePicker
                schedule={schedule}
                time={scheduleTime}
                today={todayKey}
                onChange={(value) => {
                  setSchedule(value);
                  if (!("date" in value)) setScheduleTime("");
                }}
                onTime={setScheduleTime}
                onDone={closePopup}
              />
            </TaskPopover>
            {scope && (
              <button
                className="task-control task-ai-button"
                type="button"
                aria-label="AI 整理"
                title="AI 整理"
                onClick={() => setOrganizing(true)}
              >
                <Icon name="ideas" size={16} />
              </button>
            )}
            <button
              className="primary task-add-button"
              type="submit"
              aria-label="添加 ↵"
              title="添加任务"
              disabled={!title.trim() || adding}
            >
              <Icon name="plus" size={16} />
              <span>添加</span>
            </button>
          </form>
          {isGraph ? (
            <>
              {linking && (
                <p className="task-link-hint" role="status">
                  {source ? "选择后续任务，或点已有连线移除" : "选择前置任务"}
                </p>
              )}
              {folderView.length > 0 ? (
                <TaskGraph
                  tasks={folderView}
                  tone={tone}
                  metadata={(item) => metadata(item, false, true)}
                  open={graphSelect}
                  selected={selected}
                  highlighted={notice?.unlocked}
                  linking={linking}
                  source={source}
                  canLink={canLink}
                  onUnlink={(from, to) => setEdge(from, to, true)}
                />
              ) : (
                <p className="task-empty">这个文件夹里还没有可显示的事项。</p>
              )}
            </>
          ) : (
            <div className="task-list">
              {chain.length > 0 ? (
                <section className="task-group">
                  <h3>事项</h3>
                  <TaskTrack tasks={chain} tone={tone}>
                    {chain.map((item) => renderRow(item))}
                  </TaskTrack>
                </section>
              ) : (
                groups.map((group) => (
                  <section className="task-group" key={group.label}>
                    <h3>{group.label}</h3>
                    <div className="task-track">
                      {group.tasks.map((item) => renderRow(item, group.label))}
                    </div>
                  </section>
                ))
              )}
              {!visible.length && (
                <p className="task-empty">
                  {query.trim()
                    ? "没有找到这件事"
                    : filter === "next"
                      ? "现在没有可做的任务"
                      : "这里还没有任务"}
                </p>
              )}
            </div>
          )}
        </main>
        {task && (
          <div
            className="task-detail-layer"
            onClick={(event) => {
              if (event.target === event.currentTarget) setSelected(undefined);
            }}
          >
            <Panel
              className={"detail-panel" + (task ? " has-task" : "")}
              title="任务详情"
              aside={
                <button
                  aria-label="关闭详情"
                  className="ghost"
                  onClick={() => setSelected(undefined)}
                >
                  ×
                </button>
              }
            >
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
                    time={details.scheduleTime}
                    onTimeChange={(value) =>
                      setDetails({ ...details, scheduleTime: value })
                    }
                  />
                  <label htmlFor="task-note">备注</label>
                  <textarea
                    id="task-note"
                    rows={2}
                    maxLength={10000}
                    value={details.note}
                    onChange={(e) =>
                      setDetails({ ...details, note: e.target.value })
                    }
                  />
                  <label htmlFor="task-list-edit">所属清单</label>
                  <select
                    id="task-list-edit"
                    value={details.listId}
                    onChange={(e) =>
                      setDetails({ ...details, listId: e.target.value })
                    }
                  >
                    <option value="">不归类</option>
                    {lists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {folders.trail(list.id)}
                      </option>
                    ))}
                  </select>
                  <details
                    className="task-dependencies"
                    key={task.id}
                    open={details.prerequisiteIds.length > 0 || undefined}
                  >
                    <summary>
                      前置任务
                      {details.prerequisiteIds.length
                        ? " · " + details.prerequisiteIds.length
                        : ""}
                    </summary>
                    {details.prerequisiteIds.map((id) => (
                      <div className="task-dependency" key={id}>
                        <span>
                          {byId.get(id)?.status === "completed" ? "✓ " : "○ "}
                          {byId.get(id)?.title ?? "已移除的任务"}
                        </span>
                        <button
                          type="button"
                          className="ghost"
                          aria-label={"移除前置 " + (byId.get(id)?.title ?? id)}
                          onClick={() =>
                            setDetails({
                              ...details,
                              prerequisiteIds: details.prerequisiteIds.filter(
                                (key) => key !== id,
                              ),
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <input
                      aria-label="搜索前置任务"
                      placeholder="搜索要先做的任务…"
                      value={dependency}
                      onChange={(e) => setDependency(e.target.value)}
                    />
                    {dependency.trim() &&
                      data.tasks
                        .filter(
                          (candidate) =>
                            candidate.id !== task.id &&
                            candidate.status === "pending" &&
                            !details.prerequisiteIds.includes(candidate.id) &&
                            candidate.title
                              .toLowerCase()
                              .includes(dependency.trim().toLowerCase()) &&
                            !reachesTask(
                              candidate.id,
                              task.id,
                              (id) => byId.get(id)?.prerequisiteIds ?? [],
                            ),
                        )
                        .slice(0, 8)
                        .map((candidate) => (
                          <button
                            type="button"
                            className="ghost task-prerequisite-choice"
                            key={candidate.id}
                            disabled={details.prerequisiteIds.length >= 40}
                            onClick={() => {
                              setDetails({
                                ...details,
                                prerequisiteIds: [
                                  ...details.prerequisiteIds,
                                  candidate.id,
                                ],
                              });
                              setDependency("");
                            }}
                          >
                            ＋ {candidate.title}
                          </button>
                        ))}
                  </details>
                  <button
                    className="primary"
                    disabled={
                      !edit.trim() ||
                      (edit.trim() === task.title &&
                        sameSchedule(editSchedule, task.schedule) &&
                        details.note === task.note &&
                        details.scheduleTime === task.scheduleTime &&
                        details.listId === task.listId &&
                        JSON.stringify(details.prerequisiteIds) ===
                          JSON.stringify(task.prerequisiteIds)) ||
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
                      onClick={() => toggle(task)}
                      disabled={!!conflict || !!blockers.get(task.id)?.length}
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
                    <h3>
                      {conflict.state === "conflict"
                        ? "这件事在另一端有了修改"
                        : "这次修改没有同步"}
                    </h3>
                    <p>
                      {conflict.state === "conflict"
                        ? "你的记录仍保留在这里。选择要保留的版本。"
                        : (taskErrors[conflict.error ?? ""] ??
                          "这次修改仍在本机。可以撤回后重试。")}
                    </p>
                    <blockquote>
                      {conflict.server?.title ?? "服务器上没有此任务"}
                      <small>
                        {conflict.server ? labels[conflict.server.status] : ""}
                      </small>
                    </blockquote>
                    {conflict.state === "conflict" && (
                      <button
                        onClick={() =>
                          void action(() => resolve(task.id, true))
                        }
                      >
                        保留我的修改
                      </button>
                    )}
                    <button
                      onClick={() => void action(() => resolve(task.id, false))}
                    >
                      {conflict.state === "conflict"
                        ? "采用另一端版本"
                        : "撤回这次修改"}
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
                </div>
              </div>
            </Panel>
          </div>
        )}
      </div>
      {folderEditor && (
        <div
          className="task-detail-layer"
          onClick={(event) => {
            if (event.target === event.currentTarget) setFolderEditor(null);
          }}
        >
          <form className="task-folder-dialog" onSubmit={saveFolder}>
            <h2>
              {folderEditor === "rename"
                ? "重命名文件夹"
                : folderParent
                  ? "新建子文件夹"
                  : "新建文件夹"}
            </h2>
            <input
              autoFocus
              aria-label="清单名称"
              placeholder="文件夹名称"
              value={listDraft}
              maxLength={80}
              onChange={(event) => setListDraft(event.target.value)}
            />
            <div>
              <button type="button" onClick={() => setFolderEditor(null)}>
                取消
              </button>
              <button
                className="primary"
                type="submit"
                disabled={!listDraft.trim()}
              >
                保存清单
              </button>
            </div>
          </form>
        </div>
      )}
      {organizing && (
        <TaskOrganize
          listId={listId}
          close={() => setOrganizing(false)}
          onDone={(ids) => {
            setOrganizing(false);
            setImported(ids);
            void update();
          }}
        />
      )}
      {imported.length > 0 && !error && !notice && (
        <div className="toast task-notice" role="status">
          <span>已保存 {imported.length} 项</span>
          <button
            onClick={() =>
              void action(async () => {
                if (imported.length === 1) await remove({ type: "task", id: imported[0] });
                else await enqueueTogether([...imported].reverse().map((id) => ({
                  type: "task", id, action: "delete",
                })));
                setImported([]);
              })
            }
          >
            撤销
          </button>
          <button onClick={() => setImported([])} aria-label="关闭整理提示">
            ×
          </button>
        </div>
      )}
      {notice && !error && (
        <div className="toast task-notice" role="status">
          <span>{notice.text}</span>
          <button
            onClick={() =>
              void action(async () => {
                await enqueue("reopen", notice.id);
                setNotice(undefined);
              })
            }
          >
            撤销
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="toast">
          <span>{error}</span>
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}
    </>
  );
}
