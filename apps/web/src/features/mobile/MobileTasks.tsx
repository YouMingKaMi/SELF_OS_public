import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  belongsToday,
  isNextTask,
  reachesTask,
  validateSchedule,
} from "../../../../../modules/tasks/index.ts";
import {
  put,
  remove,
  synchronize,
  useEntities,
  type Entity,
} from "../../data/entities.ts";
import {
  editDependency,
  enqueue,
  resolve,
  taskBlockers,
  useTasks,
  type Schedule,
  type Task,
  type TaskPending,
} from "../../data/tasks.ts";
import {
  completionDay,
  groupTasks,
  inPeriod,
  scheduleLabel,
} from "../../scheduling.ts";
import { Icon } from "../../ui/Icon.tsx";
import { perform, today } from "../../ui/shared.tsx";
import { taskLayers } from "../TaskGraph.tsx";
import {
  InkActionSheet,
  InkCard,
  InkChipBar,
  InkComposer,
  InkEmpty,
  InkHairline,
  InkMonthBar,
  InkNavIcon,
  InkRing,
  InkScreen,
  InkSearch,
  InkSectionLabel,
  InkSegmented,
  InkSheet,
  InkSwitch,
  MobileSubPage,
  MobileToolbar,
  shortDate,
} from "./MobileKit.tsx";
import "./mobile-tasks.css";

type FilterKey = "next" | "inbox" | "today" | "blocked" | "open" | "history";
type HistoryTab = "completed" | "discarded";
type ScheduleKind = Schedule["kind"];

type CompletionNotice = {
  id: string;
  text: string;
  unlocked: Set<string>;
};

const TASK_ERRORS: Record<string, string> = {
  TASK_LIST_CYCLE: "文件夹不能放在自己的子文件夹里。",
  TASK_DEPENDENCY_CYCLE:
    "另一台设备的修改使前置关系形成了循环，请撤回后再重新选择。",
  TASK_PREREQUISITES_OPEN: "前置任务还未完成，可能已在另一台设备恢复待办。",
  TASK_PREREQUISITE_NOT_PENDING:
    "只能添加待完成的任务作为前置，它可能已在另一台设备完成或废弃。",
  TASK_PREREQUISITE_MISSING: "前置任务已不存在，请重新选择。",
  INVALID_TASK_LIST: "这份清单已不存在，请重新选择。",
};

function nextGroups(tasks: Task[], day: string) {
  const end = new Date(day + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 7);
  const week = end.toISOString().slice(0, 10);
  const buckets = ["已过截止", "今天", "7 天内", "稍后", "无截止时间"].map(
    (label) => ({ label, tasks: [] as Task[] }),
  );
  const targetDate = (task: Task) =>
    task.schedule.kind === "range"
      ? task.schedule.end
      : "date" in task.schedule
        ? task.schedule.date
        : "";
  const sorted = [...tasks].sort((a, b) =>
    (targetDate(a) + (a.scheduleTime || "24:00")).localeCompare(
      targetDate(b) + (b.scheduleTime || "24:00"),
    ),
  );
  for (const task of sorted) {
    const d = targetDate(task);
    const idx =
      task.schedule.kind === "deadline" && d < day
        ? 0
        : d && d <= day
          ? 1
          : d && d <= week
            ? 2
            : d
              ? 3
              : 4;
    buckets[idx]!.tasks.push(task);
  }
  return buckets.filter((g) => g.tasks.length > 0);
}

function compactScheduleText(task: Task, groupLabel?: string): string {
  const s = task.schedule;
  if (s.kind === "unscheduled") return "";
  const full = scheduleLabel(s);
  const sameAsGroup = full === groupLabel || (s.kind === "recent" && groupLabel === "近期完成");
  if (sameAsGroup) return task.scheduleTime;
  let text = full;
  if (s.kind === "day") text = shortDate(s.date);
  else if (s.kind === "deadline") text = `截止 ${shortDate(s.date)}`;
  else if (s.kind === "range") text = `${shortDate(s.start)}–${shortDate(s.end)}`;
  else if (s.kind === "recent") text = "近期";
  return task.scheduleTime ? `${text} ${task.scheduleTime}` : text;
}

function isOverdueTask(task: Task, todayKey: string): boolean {
  return (
    task.status === "pending" &&
    task.schedule.kind === "deadline" &&
    task.schedule.date < todayKey
  );
}

export function MobileTasks() {
  const { tasks, pending } = useTasks();
  const { entities: lists } = useEntities("taskList");
  const todayKey = today();
  const currentMonth = todayKey.slice(0, 7);

  const [filter, setFilter] = useState<FilterKey>("next");
  const [historyTab, setHistoryTab] = useState<HistoryTab>("completed");
  const [historyMonth, setHistoryMonth] = useState(currentMonth);
  const [plannedDay, setPlannedDay] = useState("");

  // Folder subpage state: null = main tabbed view; "" = 根目录; "<id>" = named folder
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [folderMode, setFolderMode] = useState<"list" | "graph">("list");
  const [showCompleted, setShowCompleted] = useState(false);
  const [includeChildren, setIncludeChildren] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkSource, setLinkSource] = useState<string | null>(null);

  // Composer & sheets
  const [draft, setDraft] = useState("");
  const [savingQuick, setSavingQuick] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [folderForm, setFolderForm] = useState<{
    mode: "create" | "rename";
    parentId: string;
    target?: Entity<"taskList">;
  } | null>(null);
  const [taskSheet, setTaskSheet] = useState<{
    open: boolean;
    task: Task | null;
    initialListId: string;
  }>({ open: false, task: null, initialListId: "" });

  // 5-second completion undo toast
  const [notice, setNotice] = useState<CompletionNotice | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const byId = useMemo(
    () => new Map(tasks.map((t) => [t.id, t])),
    [tasks],
  );

  const blockers = useMemo(() => taskBlockers(tasks), [tasks]);

  const unlockCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of tasks) {
      if (item.status !== "pending") continue;
      const missing = blockers.get(item.id);
      if (missing?.length === 1) {
        const key = missing[0]!;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [tasks, blockers]);

  const issueIds = useMemo(
    () =>
      new Set(
        pending
          .filter((op) => op.state === "conflict" || op.state === "error")
          .map((op) => op.entityId),
      ),
    [pending],
  );

  const folders = useMemo(() => {
    const byKey = new Map(lists.map((f) => [f.id, f]));
    const children = new Map<string, Entity<"taskList">[]>();
    for (const f of lists) {
      const pid = f.data.parentId ?? "";
      const key = byKey.has(pid) ? pid : "";
      const bucket = children.get(key) ?? [];
      bucket.push(f);
      children.set(key, bucket);
    }
    children.forEach((arr) =>
      arr.sort((a, b) => a.data.name.localeCompare(b.data.name, "zh-CN")),
    );
    const trail = (id: string) => {
      if (!id) return "";
      const names: string[] = [];
      const seen = new Set<string>();
      for (
        let cur = byKey.get(id);
        cur && !seen.has(cur.id);
        cur = byKey.get(cur.data.parentId ?? "")
      ) {
        seen.add(cur.id);
        names.unshift(cur.data.name);
      }
      return names.join(" / ");
    };
    const flat: { folder: Entity<"taskList">; depth: number; trail: string }[] = [];
    const visited = new Set<string>();
    const walk = (parent: string, depth: number) => {
      for (const f of children.get(parent) ?? []) {
        if (visited.has(f.id)) continue;
        visited.add(f.id);
        flat.push({ folder: f, depth, trail: trail(f.id) });
        walk(f.id, depth + 1);
      }
    };
    walk("", 0);
    return { byKey, children, trail, flat };
  }, [lists]);

  // Open counts per filter for InkChipBar badges
  const filterCounts = useMemo(() => {
    let next = 0;
    let inbox = 0;
    let todayCount = 0;
    let blocked = 0;
    let open = 0;
    for (const t of tasks) {
      if (t.status !== "pending") continue;
      open++;
      if (isNextTask(t, byId, todayKey)) next++;
      if (t.schedule.kind === "unscheduled" && !t.listId) inbox++;
      if (belongsToday(t, todayKey)) todayCount++;
      if ((blockers.get(t.id)?.length ?? 0) > 0) blocked++;
    }
    return { next, inbox, today: todayCount, blocked, open };
  }, [tasks, byId, blockers, todayKey]);

  const folderOpenCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) {
      if (t.status !== "pending") continue;
      const key = t.listId || "";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [tasks]);

  // Main view filtered tasks
  const mainVisible = useMemo(() => {
    return tasks.filter((t) => {
      if (filter === "history") {
        if (t.status !== historyTab) return false;
        if (historyTab === "discarded") return true;
        const done = completionDay(t);
        return done
          ? done.startsWith(historyMonth)
          : historyMonth === currentMonth;
      }
      if (t.status !== "pending") return false;
      if (filter === "next") return isNextTask(t, byId, todayKey);
      if (filter === "inbox")
        return t.schedule.kind === "unscheduled" && !t.listId;
      if (filter === "today") return belongsToday(t, todayKey);
      if (filter === "blocked") return (blockers.get(t.id)?.length ?? 0) > 0;
      // filter === "open"
      if (!plannedDay) return true;
      if (t.schedule.kind === "unscheduled" || t.schedule.kind === "recent")
        return false;
      return inPeriod(t, "", plannedDay);
    });
  }, [
    tasks,
    filter,
    historyTab,
    historyMonth,
    currentMonth,
    byId,
    todayKey,
    blockers,
    plannedDay,
  ]);

  const mainGroups = useMemo(() => {
    if (filter === "next") return nextGroups(mainVisible, todayKey);
    return groupTasks(mainVisible, todayKey).map((g) => ({
      label:
        g.label === `完成于 ${todayKey}`
          ? "今天完成"
          : g.label.startsWith("完成于 ")
            ? `${shortDate(g.label.slice(4))} 完成`
            : g.label,
      tasks: g.tasks,
    }));
  }, [filter, mainVisible, todayKey]);

  // Folder subpage tasks
  const activeFolder =
    activeFolderId && activeFolderId !== ""
      ? folders.byKey.get(activeFolderId)
      : undefined;

  const folderScopeIds = useMemo(() => {
    if (activeFolderId === null) return new Set<string>();
    const ids = new Set<string>([activeFolderId]);
    if (includeChildren && activeFolderId) {
      const queue = [activeFolderId];
      for (const pid of queue) {
        for (const child of folders.children.get(pid) ?? []) {
          if (ids.has(child.id)) continue;
          ids.add(child.id);
          queue.push(child.id);
        }
      }
    }
    return ids;
  }, [activeFolderId, includeChildren, folders]);

  const folderTasks = useMemo(() => {
    if (activeFolderId === null) return [];
    return tasks.filter(
      (t) =>
        folderScopeIds.has(t.listId) &&
        (t.status === "pending" || (showCompleted && t.status === "completed")),
    );
  }, [activeFolderId, tasks, folderScopeIds, showCompleted]);

  const folderLayered = useMemo(
    () => taskLayers(folderTasks),
    [folderTasks],
  );
  const folderOrdered = useMemo(
    () => folderLayered.flat(),
    [folderLayered],
  );

  // Actions
  function openFolder(id: string) {
    setActiveFolderId(id);
    setFolderMode("list");
    setLinking(false);
    setLinkSource(null);
    setFolderPickerOpen(false);
  }

  function exitFolder() {
    setActiveFolderId(null);
    setLinking(false);
    setLinkSource(null);
    setIncludeChildren(false);
  }

  async function completeTask(item: Task): Promise<boolean> {
    const unlocked = tasks.filter(
      (c) =>
        c.status === "pending" &&
        blockers.get(c.id)?.length === 1 &&
        blockers.get(c.id)![0] === item.id,
    );
    await enqueue("complete", item.id);
    void synchronize();
    setNotice({
      id: item.id,
      text:
        unlocked.length === 1
          ? `解锁了「${unlocked[0]!.title}」`
          : unlocked.length > 1
            ? `解锁了 ${unlocked.length} 项任务`
            : `已完成「${item.title}」`,
      unlocked: new Set(unlocked.map((c) => c.id)),
    });
    return true;
  }

  function handleToggle(item: Task) {
    perform(
      (async () => {
        if (item.status === "completed") {
          await enqueue("reopen", item.id);
          void synchronize();
          setNotice(null);
        } else {
          await completeTask(item);
        }
      })(),
    );
  }

  function handleQuickAdd() {
    const text = draft.trim();
    if (!text || text.length > 500 || savingQuick) return;
    setSavingQuick(true);
    const listId = activeFolderId ?? "";
    perform(
      (async () => {
        try {
          await enqueue(
            "create",
            crypto.randomUUID(),
            text,
            { kind: "unscheduled" },
            { listId },
          );
          setDraft("");
          void synchronize();
          if (activeFolderId === null && filter !== "inbox" && filter !== "next") {
            setFilter("inbox");
          }
        } finally {
          setSavingQuick(false);
        }
      })(),
    );
  }

  function canLinkNode(item: Task): boolean {
    if (item.status !== "pending" || issueIds.has(item.id)) return false;
    if (
      !linkSource ||
      item.id === linkSource ||
      item.prerequisiteIds.includes(linkSource)
    )
      return true;
    const parent = byId.get(linkSource);
    return (
      parent?.status === "pending" &&
      item.prerequisiteIds.length < 40 &&
      !reachesTask(linkSource, item.id, (id) => byId.get(id)?.prerequisiteIds ?? [])
    );
  }

  function handleGraphSelect(item: Task) {
    if (!linking) {
      setTaskSheet({ open: true, task: item, initialListId: activeFolderId ?? "" });
      return;
    }
    if (!canLinkNode(item)) return;
    if (!linkSource) {
      setLinkSource(item.id);
      return;
    }
    if (linkSource === item.id) {
      setLinkSource(null);
      return;
    }
    const removing = item.prerequisiteIds.includes(linkSource);
    perform(
      (async () => {
        await editDependency(linkSource, item.id, removing);
        setLinkSource(null);
        void synchronize();
      })(),
    );
  }

  function renderTaskRow(task: Task, groupLabel?: string, showFolder = true) {
    const isDone = task.status === "completed";
    const isDropped = task.status === "discarded";
    const waits = task.status === "pending" ? (blockers.get(task.id)?.length ?? 0) : 0;
    const unlocks =
      task.status === "pending" && waits === 0
        ? (unlockCount.get(task.id) ?? 0)
        : 0;
    const hasIssue = issueIds.has(task.id);
    const canCheck = !isDropped && (isDone || waits === 0) && !hasIssue;
    const sched = compactScheduleText(task, groupLabel);
    const overdue = isOverdueTask(task, todayKey);
    const folderLabel =
      showFolder && task.listId ? folders.trail(task.listId) : "";
    const hasMeta =
      Boolean(sched) ||
      Boolean(folderLabel) ||
      waits > 0 ||
      unlocks > 0 ||
      hasIssue ||
      isDropped;

    return (
      <div
        className={
          "mt-task-row" + (notice?.unlocked.has(task.id) ? " unlocked" : "")
        }
        data-mt-id={task.id}
      >
        <div className="mt-task-ring">
          <InkRing
            done={isDone}
            disabled={!canCheck}
            label={(isDone ? "恢复 " : "完成 ") + task.title}
            onClick={() => handleToggle(task)}
          />
        </div>
        <button
          type="button"
          className="mt-task-body"
          onClick={() =>
            setTaskSheet({
              open: true,
              task,
              initialListId: activeFolderId ?? "",
            })
          }
        >
          <span
            className={
              "mt-task-title" +
              (isDone ? " done" : isDropped ? " dropped" : "")
            }
          >
            {task.title}
          </span>
          {hasMeta && (
            <span className="mt-task-meta">
              {sched && (
                <span
                  className={"mt-task-meta-item" + (overdue ? " warn" : "")}
                >
                  {sched}
                </span>
              )}
              {folderLabel && (
                <span className="mt-task-meta-item">{folderLabel}</span>
              )}
              {waits > 0 && (
                <span className="mt-task-meta-item warn">
                  ↳ 等 {waits} 项
                </span>
              )}
              {unlocks > 0 && (
                <span className="mt-task-meta-item live">
                  ↪ 解锁 {unlocks} 项
                </span>
              )}
              {hasIssue && (
                <span className="mt-task-meta-item danger">待处理</span>
              )}
              {isDropped && (
                <span className="mt-task-meta-item">已废弃</span>
              )}
            </span>
          )}
        </button>
      </div>
    );
  }

  const chipItems = useMemo(
    () =>
      [
        { value: "next" as const, label: "接下来", count: filterCounts.next },
        { value: "inbox" as const, label: "收件箱", count: filterCounts.inbox },
        { value: "today" as const, label: "今天", count: filterCounts.today },
        {
          value: "blocked" as const,
          label: "等前置",
          count: filterCounts.blocked,
        },
        { value: "open" as const, label: "待完成", count: filterCounts.open },
        { value: "history" as const, label: "历史" },
      ] as const,
    [filterCounts],
  );

  const emptyMessage =
    filter === "next"
      ? "目前没有可开始的任务"
      : filter === "inbox"
        ? "收件箱是空的"
        : filter === "today"
          ? "今天没有安排"
          : filter === "blocked"
            ? "没有在等前置的任务"
            : filter === "history"
              ? historyTab === "completed"
                ? "这个月还没有已完成的任务"
                : "没有已废弃的任务"
              : plannedDay
                ? `${shortDate(plannedDay)} 没有安排`
                : "这里还没有任务";

  const liveEditingTask = taskSheet.task
    ? (byId.get(taskSheet.task.id) ?? taskSheet.task)
    : null;

  const activeFolderTitle = activeFolder ? activeFolder.data.name : "根目录";

  return (
    <>
      {activeFolderId !== null ? (
        <MobileSubPage
          title={activeFolderTitle}
          backLabel="任务"
          onBack={exitFolder}
          right={
            <>
              <InkNavIcon
                icon="ellipsis"
                label="文件夹选项"
                onClick={() => setFolderMenuOpen(true)}
              />
              <InkNavIcon
                icon="plus"
                label="新任务"
                onClick={() =>
                  setTaskSheet({
                    open: true,
                    task: null,
                    initialListId: activeFolderId,
                  })
                }
              />
            </>
          }
        >
          <InkScreen hasComposer>
            {activeFolder?.data.parentId && (
              <div className="mt-breadcrumb">
                {folders.trail(activeFolder.data.parentId)}
              </div>
            )}

            <InkSegmented
              options={[
                { value: "list" as const, label: "列表" },
                { value: "graph" as const, label: "依赖" },
              ]}
              value={folderMode}
              onChange={(next) => {
                setFolderMode(next);
                setLinking(false);
                setLinkSource(null);
              }}
            />

            <div className="mt-folder-tools">
              <button
                type="button"
                className={"mk-chip sm" + (showCompleted ? " active" : "")}
                onClick={() => setShowCompleted((v) => !v)}
              >
                {showCompleted ? "隐藏已完成" : "显示已完成"}
              </button>
              {activeFolder && (
                <button
                  type="button"
                  className={"mk-chip sm" + (includeChildren ? " active" : "")}
                  onClick={() => {
                    setIncludeChildren((v) => !v);
                    setLinkSource(null);
                  }}
                >
                  {includeChildren ? "含子文件夹" : "仅当前文件夹"}
                </button>
              )}
              {folderMode === "graph" && folderTasks.length > 1 && (
                <button
                  type="button"
                  className={"mk-chip sm" + (linking ? " active" : "")}
                  onClick={() => {
                    setLinking((v) => !v);
                    setLinkSource(null);
                  }}
                >
                  <Icon name="link" size={13} />
                  <span>{linking ? "退出连线" : "连线"}</span>
                </button>
              )}
            </div>

            {folderMode === "graph" && linking && (
              <div className="mt-link-hint">
                {linkSource
                  ? `已选「${byId.get(linkSource)?.title ?? "前置"}」，轻点后续任务添加或移除连线`
                  : "先轻点一个前置任务"}
              </div>
            )}

            {folderTasks.length === 0 ? (
              <InkCard>
                <InkEmpty text="这个文件夹里还没有任务" />
              </InkCard>
            ) : folderMode === "graph" ? (
              <InkCard variant="tight">
                <MobileTaskGraph
                  tasks={folderTasks}
                  layers={folderLayered}
                  blockers={blockers}
                  unlocks={unlockCount}
                  linking={linking}
                  source={linkSource}
                  canSelect={canLinkNode}
                  onSelect={handleGraphSelect}
                />
              </InkCard>
            ) : (
              <>
                <InkSectionLabel
                  title="事项"
                  aside={`${folderOrdered.length}`}
                />
                <InkCard variant="compact">
                  <MobileTaskRail
                    tasks={folderOrdered}
                    blockers={blockers}
                  >
                    {folderOrdered.map((item, idx) => (
                      <React.Fragment key={item.id}>
                        {renderTaskRow(
                          item,
                          undefined,
                          item.listId !== activeFolderId,
                        )}
                        {idx < folderOrdered.length - 1 && (
                          <InkHairline inset={34} />
                        )}
                      </React.Fragment>
                    ))}
                  </MobileTaskRail>
                </InkCard>
              </>
            )}

            <InkComposer
              value={draft}
              onChange={setDraft}
              onSubmit={handleQuickAdd}
              disabled={savingQuick}
              placeholder="在此文件夹记一件事…"
            />
          </InkScreen>
        </MobileSubPage>
      ) : (
        <>
          <MobileToolbar>
            <InkNavIcon
              icon="folder"
              label="任务文件夹"
              onClick={() => setFolderPickerOpen(true)}
            />
            <InkNavIcon
              icon="plus"
              label="新任务"
              onClick={() =>
                setTaskSheet({ open: true, task: null, initialListId: "" })
              }
            />
          </MobileToolbar>

          <InkScreen hasComposer>
            <InkChipBar
              items={chipItems}
              value={filter}
              onChange={(next) => {
                setFilter(next);
                if (next !== "open") setPlannedDay("");
              }}
            />

            {filter === "history" && (
              <>
                <InkSegmented
                  options={[
                    { value: "completed" as const, label: "已完成" },
                    { value: "discarded" as const, label: "已废弃" },
                  ]}
                  value={historyTab}
                  onChange={setHistoryTab}
                />
                {historyTab === "completed" && (
                  <InkMonthBar
                    month={historyMonth}
                    currentMonth={currentMonth}
                    onChange={setHistoryMonth}
                  />
                )}
              </>
            )}

            {filter === "open" && (
              <div className="mt-day-filter-bar">
                <span className={"mt-date-trigger" + (plannedDay ? " active" : "")}>
                  <Icon name="calendar" size={13} />
                  <span>
                    {plannedDay ? shortDate(plannedDay) : "按日期筛选"}
                  </span>
                  <input
                    type="date"
                    aria-label="筛选任务日期"
                    value={plannedDay}
                    onChange={(e) => setPlannedDay(e.target.value)}
                  />
                </span>
                {plannedDay && (
                  <button
                    type="button"
                    className="mk-text-btn"
                    onClick={() => setPlannedDay("")}
                  >
                    显示全部
                  </button>
                )}
              </div>
            )}

            {mainGroups.length === 0 ? (
              <InkCard>
                <InkEmpty text={emptyMessage} />
              </InkCard>
            ) : (
              mainGroups.map((group) => (
                <div
                  key={group.label}
                  className={group.label === "已过截止" ? "mt-section-warn" : ""}
                >
                  <InkSectionLabel
                    title={group.label}
                    aside={`${group.tasks.length}`}
                  />
                  <InkCard variant="compact">
                    {group.tasks.map((task, idx) => (
                      <React.Fragment key={task.id}>
                        {renderTaskRow(task, group.label, true)}
                        {idx < group.tasks.length - 1 && (
                          <InkHairline inset={34} />
                        )}
                      </React.Fragment>
                    ))}
                  </InkCard>
                </div>
              ))
            )}

            <InkComposer
              value={draft}
              onChange={setDraft}
              onSubmit={handleQuickAdd}
              disabled={savingQuick}
              placeholder="记到收件箱…"
            />
          </InkScreen>
        </>
      )}

      {/* 5-second completion undo toast */}
      {notice && (
        <div className="mk-undo-toast" role="status">
          <span>{notice.text}</span>
          <button
            type="button"
            onClick={() => {
              const id = notice.id;
              setNotice(null);
              perform(
                enqueue("reopen", id).then(() => {
                  void synchronize();
                }),
              );
            }}
          >
            撤销
          </button>
        </div>
      )}

      {/* Folder Picker Sheet */}
      <InkSheet
        open={folderPickerOpen}
        title="任务文件夹"
        leftLabel="关闭"
        rightLabel="新建"
        onClose={() => setFolderPickerOpen(false)}
        onRight={() => {
          setFolderPickerOpen(false);
          setFolderForm({ mode: "create", parentId: "" });
        }}
      >
        <InkSectionLabel title="视图" />
        <InkCard variant="compact">
          {(
            [
              ["next", "接下来", filterCounts.next],
              ["inbox", "收件箱", filterCounts.inbox],
              ["history", "历史记录", 0],
            ] as const
          ).map(([key, label, count], idx) => (
            <React.Fragment key={key}>
              <div className="mt-folder-row">
                <button
                  type="button"
                  className={
                    "mt-folder-btn" +
                    (activeFolderId === null && filter === key ? " active" : "")
                  }
                  onClick={() => {
                    setActiveFolderId(null);
                    setFilter(key);
                    setFolderPickerOpen(false);
                  }}
                >
                  <Icon
                    name={key === "history" ? "clock" : "tasks"}
                    size={16}
                  />
                  <span className="mt-folder-name">{label}</span>
                  {count > 0 && <span className="mt-folder-count">{count}</span>}
                </button>
              </div>
              {idx < 2 && <InkHairline inset={34} />}
            </React.Fragment>
          ))}
        </InkCard>

        <InkSectionLabel title="文件夹" aside={`${lists.length + 1}`} />
        <InkCard variant="compact">
          <div className="mt-folder-row">
            <button
              type="button"
              className={
                "mt-folder-btn" + (activeFolderId === "" ? " active" : "")
              }
              onClick={() => openFolder("")}
            >
              <Icon name="folder" size={16} />
              <span className="mt-folder-name">根目录</span>
              {(folderOpenCounts.get("") ?? 0) > 0 && (
                <span className="mt-folder-count">
                  {folderOpenCounts.get("")}
                </span>
              )}
            </button>
          </div>
          {folders.flat.map(({ folder, depth }) => {
            const count = folderOpenCounts.get(folder.id) ?? 0;
            return (
              <React.Fragment key={folder.id}>
                <InkHairline inset={34} />
                <div
                  className="mt-folder-row"
                  style={
                    depth > 0
                      ? { paddingLeft: Math.min(depth, 5) * 16 }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className={
                      "mt-folder-btn" +
                      (activeFolderId === folder.id ? " active" : "")
                    }
                    onClick={() => openFolder(folder.id)}
                  >
                    <Icon name="folder" size={16} />
                    <span className="mt-folder-name">{folder.data.name}</span>
                    {count > 0 && (
                      <span className="mt-folder-count">{count}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="mt-folder-edit"
                    aria-label={`重命名 ${folder.data.name}`}
                    onClick={() => {
                      setFolderPickerOpen(false);
                      setFolderForm({
                        mode: "rename",
                        parentId: folder.data.parentId ?? "",
                        target: folder,
                      });
                    }}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                </div>
              </React.Fragment>
            );
          })}
        </InkCard>
      </InkSheet>

      {/* Folder Options Action Sheet (inside Folder subpage) */}
      <InkActionSheet
        open={folderMenuOpen}
        title={activeFolderTitle}
        onClose={() => setFolderMenuOpen(false)}
        items={[
          ...(activeFolder
            ? [
                {
                  label: "重命名文件夹",
                  icon: "edit",
                  onClick: () =>
                    setFolderForm({
                      mode: "rename",
                      parentId: activeFolder.data.parentId ?? "",
                      target: activeFolder,
                    }),
                },
                {
                  label: "新建子文件夹",
                  icon: "plus",
                  onClick: () =>
                    setFolderForm({
                      mode: "create",
                      parentId: activeFolder.id,
                    }),
                },
              ]
            : [
                {
                  label: "新建文件夹",
                  icon: "plus",
                  onClick: () =>
                    setFolderForm({ mode: "create", parentId: "" }),
                },
              ]),
          {
            label: "切换文件夹",
            icon: "folder",
            onClick: () => setFolderPickerOpen(true),
          },
        ]}
      />

      {/* Create / Rename Folder Sheet */}
      {folderForm && (
        <FolderFormSheet
          form={folderForm}
          folders={folders.flat}
          onClose={() => setFolderForm(null)}
          onSaved={(savedId) => {
            setFolderForm(null);
            openFolder(savedId);
          }}
        />
      )}

      {/* Full Task Create / Edit Sheet */}
      <TaskEditorSheet
        open={taskSheet.open}
        task={liveEditingTask}
        initialListId={taskSheet.initialListId}
        allTasks={tasks}
        byId={byId}
        blockers={blockers}
        pendingOps={
          liveEditingTask
            ? pending.filter((op) => op.entityId === liveEditingTask.id)
            : []
        }
        folders={folders.flat}
        todayKey={todayKey}
        onComplete={completeTask}
        onClose={() =>
          setTaskSheet({ open: false, task: null, initialListId: "" })
        }
      />
    </>
  );
}

/* ─────────────────────────── Folder Create / Rename Sheet ─────────────────────────── */

function FolderFormSheet({
  form,
  folders,
  onClose,
  onSaved,
}: {
  form: {
    mode: "create" | "rename";
    parentId: string;
    target?: Entity<"taskList">;
  };
  folders: { folder: Entity<"taskList">; depth: number; trail: string }[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(
    form.mode === "rename" ? (form.target?.data.name ?? "") : "",
  );
  const [parentId, setParentId] = useState(form.parentId);
  const [saving, setSaving] = useState(false);

  const clean = name.trim();
  const canSave = clean.length > 0 && clean.length <= 80 && !saving;

  function handleSave() {
    if (!canSave) return;
    setSaving(true);
    perform(
      (async () => {
        try {
          const id = await put(
            "taskList",
            {
              name: clean,
              parentId:
                form.mode === "rename"
                  ? (form.target?.data.parentId ?? "")
                  : parentId,
            },
            form.mode === "rename" && form.target
              ? { id: form.target.id }
              : undefined,
          );
          void synchronize();
          onSaved(id);
        } finally {
          setSaving(false);
        }
      })(),
    );
  }

  return (
    <InkSheet
      open
      title={
        form.mode === "rename"
          ? "重命名文件夹"
          : parentId
            ? "新建子文件夹"
            : "新建文件夹"
      }
      rightLabel="保存"
      rightDisabled={!canSave}
      onClose={onClose}
      onRight={handleSave}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">名称</span>
          <input
            autoFocus
            className="mk-form-input right"
            placeholder="输入文件夹名称"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
          />
        </div>
        {form.mode === "create" && folders.length > 0 && (
          <div className="mk-form-row">
            <span className="mk-form-label">上级文件夹</span>
            <select
              className="mk-form-select"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">根目录（顶层）</option>
              {folders.map(({ folder, trail }) => (
                <option key={folder.id} value={folder.id}>
                  {trail}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </InkSheet>
  );
}

/* ─────────────────────────── Task Create / Edit Sheet ─────────────────────────── */

function TaskEditorSheet({
  open,
  task,
  initialListId,
  allTasks,
  byId,
  blockers,
  pendingOps,
  folders,
  todayKey,
  onComplete,
  onClose,
}: {
  open: boolean;
  task: Task | null;
  initialListId: string;
  allTasks: Task[];
  byId: Map<string, Task>;
  blockers: Map<string, string[]>;
  pendingOps: TaskPending[];
  folders: { folder: Entity<"taskList">; depth: number; trail: string }[];
  todayKey: string;
  onComplete: (task: Task) => Promise<boolean>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [listId, setListId] = useState("");
  const [kind, setKind] = useState<ScheduleKind>("unscheduled");
  const [date, setDate] = useState(todayKey);
  const [endDate, setEndDate] = useState(todayKey);
  const [hasTime, setHasTime] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [prerequisiteIds, setPrerequisiteIds] = useState<string[]>([]);
  const [pickingPrereq, setPickingPrereq] = useState(false);
  const [prereqQuery, setPrereqQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPickingPrereq(false);
    setPrereqQuery("");
    setConfirmDelete(false);
    if (!task) {
      setTitle("");
      setNote("");
      setListId(initialListId);
      setKind("unscheduled");
      setDate(todayKey);
      setEndDate(todayKey);
      setHasTime(false);
      setScheduleTime("09:00");
      setPrerequisiteIds([]);
      return;
    }
    setTitle(task.title);
    setNote(task.note);
    setListId(task.listId);
    setKind(task.schedule.kind);
    if (task.schedule.kind === "day" || task.schedule.kind === "deadline") {
      setDate(task.schedule.date);
      setEndDate(task.schedule.date);
    } else if (task.schedule.kind === "range") {
      setDate(task.schedule.start);
      setEndDate(task.schedule.end);
    } else {
      setDate(todayKey);
      setEndDate(todayKey);
    }
    setHasTime(Boolean(task.scheduleTime));
    setScheduleTime(task.scheduleTime || "09:00");
    setPrerequisiteIds(task.prerequisiteIds);
  }, [open, task?.id, task?.version, initialListId, todayKey]);

  const conflict = useMemo(
    () =>
      pendingOps.find((op) => op.state === "conflict" || op.state === "error"),
    [pendingOps],
  );

  const openBlockerCount = task ? (blockers.get(task.id)?.length ?? 0) : 0;

  const eligiblePrereqs = useMemo(() => {
    const q = prereqQuery.trim().toLowerCase();
    return allTasks.filter((c) => {
      if (c.status !== "pending") return false;
      if (task && c.id === task.id) return false;
      if (prerequisiteIds.includes(c.id)) return false;
      if (
        task &&
        reachesTask(c.id, task.id, (id) => byId.get(id)?.prerequisiteIds ?? [])
      )
        return false;
      return !q || c.title.toLowerCase().includes(q);
    });
  }, [allTasks, task, prerequisiteIds, byId, prereqQuery]);

  const cleanTitle = title.trim();
  const canSave =
    !saving &&
    !conflict &&
    cleanTitle.length > 0 &&
    cleanTitle.length <= 500 &&
    note.length <= 10000;

  function buildSchedule(): Schedule {
    if (kind === "day") return { kind: "day", date: date || todayKey };
    if (kind === "deadline") return { kind: "deadline", date: date || todayKey };
    if (kind === "range") {
      const start = date || todayKey;
      const end = endDate && endDate >= start ? endDate : start;
      return { kind: "range", start, end };
    }
    if (kind === "recent") return { kind: "recent" };
    return { kind: "unscheduled" };
  }

  function handleSave() {
    if (!canSave) return;
    setSaving(true);
    perform(
      (async () => {
        try {
          const plan = validateSchedule(buildSchedule());
          const clock =
            (kind === "day" || kind === "deadline") && hasTime
              ? scheduleTime
              : "";
          const details = {
            note,
            listId,
            scheduleTime: clock,
            prerequisiteIds,
          };
          if (task) {
            await enqueue("edit", task.id, cleanTitle, plan, details);
          } else {
            await enqueue(
              "create",
              crypto.randomUUID(),
              cleanTitle,
              plan,
              details,
            );
          }
          void synchronize();
          onClose();
        } finally {
          setSaving(false);
        }
      })(),
    );
  }

  function handleLifecycle(action: "complete" | "reopen" | "discard") {
    if (!task || saving) return;
    setSaving(true);
    perform(
      (async () => {
        try {
          if (action === "complete") {
            await onComplete(task);
          } else {
            await enqueue(action, task.id);
            void synchronize();
          }
          onClose();
        } finally {
          setSaving(false);
        }
      })(),
    );
  }

  function handleDelete() {
    if (!task || saving) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    perform(
      (async () => {
        try {
          await remove({ type: "task", id: task.id });
          void synchronize();
          onClose();
        } finally {
          setSaving(false);
        }
      })(),
    );
  }

  const lastDone = task ? completionDay(task) : null;

  return (
    <>
      <InkSheet
        open={open}
        title={task ? "任务详情" : "新任务"}
        rightLabel="保存"
        rightDisabled={!canSave}
        onClose={onClose}
        onRight={handleSave}
      >
        {conflict && task && (
          <div className="mt-conflict-box">
            <strong>
              {conflict.state === "conflict"
                ? "这件事在另一端有了修改"
                : "这次修改没有同步"}
            </strong>
            <p>
              {conflict.state === "conflict"
                ? `另一端版本：${conflict.server?.title ?? "已移除"}`
                : (TASK_ERRORS[conflict.error ?? ""] ??
                  "修改仍保留在本机，可撤回后重试。")}
            </p>
            <div className="mt-conflict-btns">
              {conflict.state === "conflict" && (
                <button
                  type="button"
                  className="mk-pill sm solid"
                  onClick={() =>
                    perform(
                      resolve(task.id, true).then(() => {
                        void synchronize();
                      }),
                    )
                  }
                >
                  保留我的修改
                </button>
              )}
              <button
                type="button"
                className="mk-pill sm"
                onClick={() =>
                  perform(
                    resolve(task.id, false).then(() => {
                      void synchronize();
                    }),
                  )
                }
              >
                {conflict.state === "conflict" ? "采用另一端" : "撤回修改"}
              </button>
            </div>
          </div>
        )}

        {/* Title & Note */}
        <div className="mk-form-group">
          <div className="mk-form-row col">
            <textarea
              className="mk-form-textarea"
              style={{ minHeight: 56 }}
              placeholder="要做的事"
              maxLength={500}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="mk-form-row col">
            <textarea
              className="mk-form-textarea"
              style={{ minHeight: 72 }}
              placeholder="备注（可选）"
              maxLength={10000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        {/* Schedule */}
        <InkSectionLabel title="安排" />
        <div className="mt-seg-5">
          <InkSegmented
            onCard
            options={[
              { value: "unscheduled" as const, label: "未定" },
              { value: "recent" as const, label: "近期" },
              { value: "day" as const, label: "某天" },
              { value: "deadline" as const, label: "截止" },
              { value: "range" as const, label: "期间" },
            ]}
            value={kind}
            onChange={(next) => {
              setKind(next);
              if (next !== "day" && next !== "deadline") setHasTime(false);
            }}
          />
        </div>

        <div className="mk-form-group">
          {(kind === "day" || kind === "deadline" || kind === "range") && (
            <div className="mk-form-row">
              <span className="mk-form-label">
                {kind === "range"
                  ? "开始日期"
                  : kind === "deadline"
                    ? "截止到"
                    : "日期"}
              </span>
              <input
                type="date"
                className="mk-form-input right"
                value={date}
                onChange={(e) => {
                  const val = e.target.value;
                  setDate(val);
                  if (kind === "range" && val && endDate < val) {
                    setEndDate(val);
                  }
                }}
              />
            </div>
          )}
          {(kind === "day" || kind === "deadline") && (
            <>
              <div className="mk-form-row">
                <span className="mk-form-label">指定时间</span>
                <InkSwitch
                  checked={hasTime}
                  onChange={setHasTime}
                  label="指定时间"
                />
              </div>
              {hasTime && (
                <div className="mk-form-row">
                  <span className="mk-form-label">时间</span>
                  <input
                    type="time"
                    className="mk-form-input right"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                  />
                </div>
              )}
            </>
          )}
          {kind === "range" && (
            <div className="mk-form-row">
              <span className="mk-form-label">结束日期</span>
              <input
                type="date"
                className="mk-form-input right"
                min={date}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          )}
          <div className="mk-form-row">
            <span className="mk-form-label">所属文件夹</span>
            <select
              className="mk-form-select"
              value={listId}
              onChange={(e) => setListId(e.target.value)}
            >
              <option value="">不归类</option>
              {folders.map(({ folder, trail }) => (
                <option key={folder.id} value={folder.id}>
                  {trail}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Prerequisites */}
        <InkSectionLabel
          title="前置任务"
          aside={
            prerequisiteIds.length > 0 ? `${prerequisiteIds.length} 项` : undefined
          }
        />
        <div className="mk-form-group">
          {prerequisiteIds.map((id) => {
            const ref = byId.get(id);
            const done = ref?.status === "completed";
            return (
              <div className="mt-prereq-row" key={id}>
                <div className="mt-prereq-title">
                  <span style={{ opacity: done ? 0.55 : 0.9 }}>
                    {done ? "✓" : "○"}
                  </span>
                  <span>{ref?.title ?? "已移除的任务"}</span>
                </div>
                <button
                  type="button"
                  className="mt-prereq-remove"
                  aria-label="移除前置任务"
                  onClick={() =>
                    setPrerequisiteIds((prev) => prev.filter((k) => k !== id))
                  }
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="mk-form-row"
            style={{
              width: "100%",
              border: 0,
              background: "transparent",
              color: "var(--text)",
              justifyContent: "flex-start",
            }}
            disabled={prerequisiteIds.length >= 40}
            onClick={() => {
              setPrereqQuery("");
              setPickingPrereq(true);
            }}
          >
            <Icon name="plus" size={15} />
            <span style={{ fontSize: 14.5 }}>添加前置任务</span>
          </button>
        </div>

        {/* Lifecycle actions for existing tasks */}
        {task && (
          <div className="mt-sheet-actions">
            {task.status === "pending" ? (
              <>
                <button
                  type="button"
                  className="mk-pill lg full solid"
                  disabled={saving || !!conflict || openBlockerCount > 0}
                  onClick={() => handleLifecycle("complete")}
                >
                  <Icon name="check" size={16} />
                  <span>标记完成</span>
                </button>
                {openBlockerCount > 0 && (
                  <div className="mt-sheet-hint warn">
                    需先完成 {openBlockerCount} 项前置任务才能标记完成
                  </div>
                )}
              </>
            ) : (
              <button
                type="button"
                className="mk-pill lg full solid"
                disabled={saving || !!conflict}
                onClick={() => handleLifecycle("reopen")}
              >
                <Icon name="undo" size={16} />
                <span>恢复待办</span>
              </button>
            )}

            {task.status !== "discarded" && (
              <button
                type="button"
                className="mk-pill lg full"
                disabled={saving || !!conflict}
                onClick={() => handleLifecycle("discard")}
              >
                废弃这件事
              </button>
            )}

            <button
              type="button"
              className="mk-pill lg full danger"
              disabled={saving}
              onClick={handleDelete}
            >
              <Icon name="trash" size={15} />
              <span>{confirmDelete ? "再次点击确认删除" : "删除任务"}</span>
            </button>

            {lastDone && (
              <div className="mt-sheet-hint">上次完成：{lastDone}</div>
            )}
          </div>
        )}
      </InkSheet>

      {/* Prerequisite Picker Nested Sheet */}
      <InkSheet
        open={open && pickingPrereq}
        title="选择前置任务"
        leftLabel="返回"
        onClose={() => setPickingPrereq(false)}
      >
        <InkSearch
          value={prereqQuery}
          onChange={setPrereqQuery}
          placeholder="搜索待完成任务…"
        />
        {eligiblePrereqs.length === 0 ? (
          <InkEmpty text="没有可选的前置任务" />
        ) : (
          <InkCard variant="compact">
            {eligiblePrereqs.slice(0, 40).map((cand, idx) => (
              <React.Fragment key={cand.id}>
                <button
                  type="button"
                  className="mk-row"
                  onClick={() => {
                    setPrerequisiteIds((prev) =>
                      prev.includes(cand.id) ? prev : [...prev, cand.id],
                    );
                    setPickingPrereq(false);
                  }}
                >
                  <div className="mk-row-main">
                    <span className="mk-row-title clamp-2">{cand.title}</span>
                    {cand.schedule.kind !== "unscheduled" && (
                      <span className="mk-row-sub">
                        {compactScheduleText(cand)}
                      </span>
                    )}
                  </div>
                  <span className="mk-row-right">
                    <Icon name="plus" size={15} />
                  </span>
                </button>
                {idx < Math.min(eligiblePrereqs.length, 40) - 1 && (
                  <InkHairline />
                )}
              </React.Fragment>
            ))}
          </InkCard>
        )}
      </InkSheet>
    </>
  );
}

/* ─────────────────────────── Folder List Dependency Rail ─────────────────────────── */

function MobileTaskRail({
  tasks,
  blockers,
  children,
}: {
  tasks: Task[];
  blockers: Map<string, string[]>;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [centers, setCenters] = useState<Record<string, number>>({});

  const edges = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.id));
    return tasks.flatMap((t) =>
      t.prerequisiteIds
        .filter((pid) => ids.has(pid))
        .map((from) => ({ from, to: t.id })),
    );
  }, [tasks]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || edges.length === 0) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      const next: Record<string, number> = {};
      el.querySelectorAll<HTMLElement>("[data-mt-id]").forEach((node) => {
        const rect = node.getBoundingClientRect();
        next[node.dataset.mtId!] = rect.top - top + rect.height / 2;
      });
      setCenters(next);
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [tasks, edges]);

  return (
    <div
      ref={wrapRef}
      className={"mt-rail-wrap" + (edges.length > 0 ? " has-rail" : "")}
    >
      {edges.length > 0 && (
        <svg className="mt-rail-svg" aria-hidden="true">
          {edges.map(({ from, to }, idx) => {
            const y1 = centers[from];
            const y2 = centers[to];
            if (y1 === undefined || y2 === undefined) return null;
            const lane = 3 + (idx % 3) * 3.5;
            const dir = y2 >= y1 ? 1 : -1;
            const r = Math.min(6, Math.abs(y2 - y1) / 3);
            const ready = (blockers.get(from)?.length ?? 0) === 0;
            return (
              <path
                key={from + "-" + to}
                d={`M18 ${y1} H${lane + r} Q${lane} ${y1} ${lane} ${y1 + dir * r} V${y2 - dir * r} Q${lane} ${y2} ${lane + r} ${y2} H18`}
                fill="none"
                stroke={
                  ready
                    ? "rgba(110, 224, 152, 0.55)"
                    : "rgba(255, 255, 255, 0.22)"
                }
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            );
          })}
        </svg>
      )}
      {children}
    </div>
  );
}

/* ─────────────────────────── Mobile OLED Dependency Graph (TaskMap) ─────────────────────────── */

function MobileTaskGraph({
  tasks,
  layers,
  blockers,
  unlocks,
  linking,
  source,
  canSelect,
  onSelect,
}: {
  tasks: Task[];
  layers: Task[][];
  blockers: Map<string, string[]>;
  unlocks: Map<string, number>;
  linking: boolean;
  source: string | null;
  canSelect: (task: Task) => boolean;
  onSelect: (task: Task) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const nodeW = 138;
  const nodeH = 62;
  const stepX = 154;
  const stepY = 98;
  const maxCols = Math.max(1, ...layers.map((l) => l.length));
  const boardW = Math.max(296, maxCols * stepX + 20);
  const boardH = Math.max(240, layers.length * stepY + 24);

  const points = useMemo(() => {
    const map = new Map<string, { cx: number; cy: number }>();
    layers.forEach((row, rIdx) => {
      row.forEach((item, cIdx) => {
        let cx = boardW / 2 + (cIdx - (row.length - 1) / 2) * stepX;
        if (row.length === 1) {
          const parents = item.prerequisiteIds
            .map((id) => map.get(id)?.cx)
            .filter((v): v is number => v !== undefined);
          if (parents.length > 0) {
            cx = parents.reduce((a, b) => a + b, 0) / parents.length;
          }
        }
        map.set(item.id, { cx, cy: 46 + rIdx * stepY });
      });
    });
    return map;
  }, [layers, boardW]);

  const edges = useMemo(() => {
    const list: { from: string; to: string; d: string }[] = [];
    for (const item of tasks) {
      const pt = points.get(item.id);
      if (!pt) continue;
      const parents = item.prerequisiteIds
        .map((id) => {
          const p = points.get(id);
          return p ? { id, p } : null;
        })
        .filter((x): x is { id: string; p: { cx: number; cy: number } } =>
          Boolean(x),
        )
        .sort((a, b) => a.p.cx - b.p.cx);

      parents.forEach(({ id, p }, idx) => {
        const offset =
          (idx - (parents.length - 1) / 2) *
          Math.min(16, 100 / Math.max(1, parents.length));
        const x1 = p.cx;
        const y1 = p.cy + nodeH / 2;
        const x2 = pt.cx + offset;
        const y2 = pt.cy - nodeH / 2 - 3;
        const midY = (y1 + y2) / 2;
        let d = "";
        if (pt.cy - p.cy > stepY) {
          const gutter = (p.cx + pt.cx) / 2 > boardW / 2 ? boardW - 8 : 8;
          d = `M${x1} ${y1} Q${x1} ${y1 + 16} ${gutter} ${y1 + 16} L${gutter} ${y2 - 16} Q${x2} ${y2 - 16} ${x2} ${y2}`;
        } else {
          d = `M${x1} ${y1} C${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`;
        }
        d += ` M${x2 - 3.5} ${y2 - 5} L${x2} ${y2} L${x2 + 3.5} ${y2 - 5}`;
        list.push({ from: id, to: item.id, d });
      });
    }
    return list;
  }, [tasks, points, boardW]);

  return (
    <>
      <div className="mt-graph-viewport" aria-label="任务依赖图">
        <div
          className="mt-graph-space"
          style={{ width: boardW * zoom, height: boardH * zoom }}
        >
          <div
            className="mt-graph-board"
            style={{
              width: boardW,
              height: boardH,
              transform: `scale(${zoom})`,
            }}
          >
            <svg
              className="mt-graph-svg"
              width={boardW}
              height={boardH}
              aria-hidden="true"
            >
              {edges.map((e) => (
                <path
                  key={e.from + "->" + e.to}
                  d={e.d}
                  fill="none"
                  stroke={
                    e.from === source
                      ? "var(--live)"
                      : "rgba(255, 255, 255, 0.32)"
                  }
                  strokeWidth={e.from === source ? 1.6 : 1.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </svg>
            {tasks.map((item) => {
              const pt = points.get(item.id);
              if (!pt) return null;
              const waiting = blockers.get(item.id)?.length ?? 0;
              const isDone = item.status === "completed";
              const ready = !isDone && waiting === 0;
              const unl = unlocks.get(item.id) ?? 0;
              const sched = compactScheduleText(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={
                    "mt-graph-node" +
                    (ready ? " ready" : "") +
                    (isDone ? " done" : "") +
                    (source === item.id ? " source" : "")
                  }
                  style={{
                    left: pt.cx - nodeW / 2,
                    top: pt.cy - nodeH / 2,
                    width: nodeW,
                    height: nodeH,
                  }}
                  disabled={linking && !canSelect(item)}
                  onClick={() => onSelect(item)}
                >
                  <span className="mt-graph-node-title">{item.title}</span>
                  <span
                    className={
                      "mt-graph-node-meta" +
                      (waiting > 0 ? " warn" : unl > 0 ? " live" : "")
                    }
                  >
                    {waiting > 0
                      ? `↳ 等 ${waiting} 项`
                      : unl > 0
                        ? `↪ 解锁 ${unl} 项`
                        : sched || (isDone ? "已完成" : "可开始")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-graph-zoom">
        <button
          type="button"
          className="mk-chip sm"
          aria-label="缩小依赖图"
          disabled={zoom <= 0.65}
          onClick={() => setZoom((z) => Math.max(0.65, +(z - 0.15).toFixed(2)))}
        >
          <Icon name="minus" size={13} />
        </button>
        <button
          type="button"
          className="mk-chip sm"
          onClick={() => setZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="mk-chip sm"
          aria-label="放大依赖图"
          disabled={zoom >= 1.5}
          onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.15).toFixed(2)))}
        >
          <Icon name="plus" size={13} />
        </button>
      </div>
    </>
  );
}
