import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import "./achievements.css";
import {
  put,
  remove,
  useEntities,
  type AnyEntity,
  type EntityData,
} from "../data/entities.ts";
import {
  Empty,
  Heading,
  arr,
  num,
  perform,
  str,
  today,
  usePreference,
} from "../ui/shared.tsx";

export type AchievementScope = "lifetime" | "annual";

export type Achievement = {
  id: string;
  entity: AnyEntity;
  scope: AchievementScope;
  year: string;
  category: string;
  title: string;
  description: string;
  icon: string;
  prevIds: string[];
  current: number;
  target: number;
  unit: string;
  completed: boolean;
  completedAt?: string;
  note: string;
};

const DEFAULT_CATEGORIES: string[] = [];

const ICONS: Record<string, { label: string; svg: React.ReactNode }> = {
  check: {
    label: "达成",
    svg: <path d="m4.5 12.5 5 5L19.5 7" />,
  },
  run: {
    label: "跑步",
    svg: (
      <path d="M13 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM7 21l3-6 2.5 2v4h2v-5.5l-2.5-2 1-3.5 3 2h3v-2h-2.5l-2.5-2c-.8-.6-2-.5-2.6.4L9 13l-3 1v2l2.5-.8L7 21Z" />
    ),
  },
  mountain: {
    label: "山峰",
    svg: <path d="m3 19 6.5-11 4.2 6.5 2.8-4 4.5 8.5H3Z" />,
  },
  bike: {
    label: "骑行",
    svg: (
      <>
        <circle cx="6.5" cy="16.5" r="3" />
        <circle cx="17.5" cy="16.5" r="3" />
        <path d="M6.5 16.5 10 10h4l2 3.5M10 10 8.5 7H7m7 3 3 6.5" />
      </>
    ),
  },
  compass: {
    label: "远行",
    svg: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m15.5 8.5-2.2 5.2-5.2 2.2 2.2-5.2 5.2-2.2Z" />
      </>
    ),
  },
  globe: {
    label: "世界",
    svg: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.6 12h16.8M12 3.5c2.5 2.4 3.8 5.4 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.4-3.8-8.5s1.3-6.1 3.8-8.5Z" />
      </>
    ),
  },
  book: {
    label: "阅读",
    svg: (
      <path d="M12 5.5C8.5 3.5 5 4 3 5v14c2-1 5.5-1.5 9 .5 3.5-2 7-1.5 9-.5V5c-2-1-5.5-1.5-9 .5Zm0 0v14" />
    ),
  },
  language: {
    label: "语言",
    svg: (
      <path d="M4 5h10M9 3v2m2.5 0c-.5 4-2.8 7.5-6.5 9.5m2.5-5c1.3 2 3.2 3.8 5.5 5m1 5.5 3.5-9 3.5 9m-5.8-2.8h4.6" />
    ),
  },
  coin: {
    label: "储备",
    svg: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m9 8 3 3.5L15 8m-6 4h6m-6 3h6m-3-3.5V18" />
      </>
    ),
  },
  code: {
    label: "作品",
    svg: <path d="m8 8-4 4 4 4m8-8 4 4-4 4m-2.5-10-3 12" />,
  },
  home: {
    label: "生活",
    svg: <path d="m3 10 9-7 9 7v10H3Zm6 10v-6h6v6" />,
  },
  clock: {
    label: "积累",
    svg: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7v5l3.5 2" />
      </>
    ),
  },
};

const DEMO_ID_PREFIX = "a0000000-0000-4000-8000-0000000000";

function toAchievement(entity: AnyEntity): Achievement {
  return {
    id: entity.id,
    entity,
    scope: entity.data.scope === "annual" ? "annual" : "lifetime",
    year: str(entity, "year", "2026"),
    category: str(entity, "category", ""),
    title: str(entity, "title"),
    description: str(entity, "description"),
    icon: str(entity, "icon", "check"),
    prevIds: arr(entity, "prevIds"),
    current: num(entity, "current", 0),
    target: Math.max(1, num(entity, "target", 1)),
    unit: str(entity, "unit", "次"),
    completed: Boolean(entity.data.completed),
    completedAt: entity.data.completedAt
      ? String(entity.data.completedAt)
      : undefined,
    note: str(entity, "note"),
  };
}

function toPayload(item: Omit<Achievement, "entity">): EntityData<"achievement"> {
  return {
    title: item.title,
    description: item.description,
    scope: item.scope,
    ...(item.scope === "annual" ? { year: item.year || "2026" } : {}),
    category: item.category,
    icon: item.icon,
    prevIds: item.prevIds,
    current: item.current,
    target: item.target,
    unit: item.unit,
    completed: item.completed,
    ...(item.completedAt ? { completedAt: item.completedAt } : {}),
    note: item.note,
  };
}

function getProgress(item: Achievement) {
  if (item.completed) {
    return {
      ratio: 1,
      label:
        item.target > 1
          ? `${item.target.toLocaleString("zh-CN")}/${item.target.toLocaleString("zh-CN")}`
          : item.completedAt || "已完成",
    };
  }
  if (item.target > 1) {
    const c = Math.max(0, Math.min(item.target, item.current));
    return {
      ratio: c / item.target,
      label: `${item.current.toLocaleString("zh-CN")}/${item.target.toLocaleString("zh-CN")}`,
    };
  }
  return { ratio: 0, label: "未完成" };
}

export function IconBox({
  icon,
  done,
}: {
  icon: string;
  done: boolean;
}) {
  const def = ICONS[icon] ?? ICONS.check;
  return (
    <span className={"ach-icon-box" + (done ? " done" : "")} aria-hidden="true">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {def.svg}
      </svg>
    </span>
  );
}

export function AchievementCard({
  item,
  showTag = true,
  selected = false,
  style,
  onClick,
}: {
  item: Achievement;
  showTag?: boolean;
  selected?: boolean;
  style?: React.CSSProperties;
  onClick: () => void;
}) {
  const prog = getProgress(item);
  const tagText =
    item.scope === "annual"
      ? `${item.year || "2026"} 年度`
      : item.category || "人生";

  return (
    <button
      type="button"
      className={
        "ach-card" +
        (item.completed ? " done" : "") +
        (selected ? " selected" : "")
      }
      style={style}
      onClick={onClick}
    >
      <IconBox icon={item.icon} done={item.completed} />
      <span className="ach-card-body">
        <span className="ach-card-row1">
          <strong className="ach-card-title">{item.title}</strong>
          {showTag && <span className="ach-card-tag">{tagText}</span>}
        </span>

        <span className="ach-card-row2">
          {item.completed && item.note.trim()
            ? item.note.trim()
            : item.description || (item.scope === "lifetime" ? "人生成就" : "年度目标")}
        </span>

        <span className="ach-card-row3">
          {item.target > 1 ? (
            <>
              <span className="ach-card-bar">
                <i style={{ width: `${Math.round(prog.ratio * 100)}%` }} />
              </span>
              <span className="ach-card-num">
                {prog.label}
                {item.completed && item.completedAt ? ` · ${item.completedAt}` : ""}
              </span>
            </>
          ) : (
            <span className="ach-card-meta-line">
              <span
                className={item.completed ? "status-done" : "status-pending"}
              >
                {item.completed
                  ? item.completedAt
                    ? `${item.completedAt} 达成`
                    : "已达成"
                  : "未完成"}
              </span>
              <span>{item.unit ? `1 ${item.unit}` : ""}</span>
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function buildConnectedTrees(items: Achievement[]): {
  trees: Achievement[][];
  unlinked: Achievement[];
} {
  const byId = new Map(items.map((i) => [i.id, i]));
  const linkedIds = new Set<string>();

  for (const item of items) {
    const validPrevs = item.prevIds.filter((pid) => byId.has(pid));
    if (validPrevs.length > 0) {
      linkedIds.add(item.id);
      for (const pid of validPrevs) linkedIds.add(pid);
    }
  }

  const unlinked = items.filter((i) => !linkedIds.has(i.id));
  const treeItems = items.filter((i) => linkedIds.has(i.id));

  const adj = new Map<string, Set<string>>();
  for (const item of treeItems) adj.set(item.id, new Set());
  for (const item of treeItems) {
    for (const pid of item.prevIds) {
      if (adj.has(pid)) {
        adj.get(item.id)!.add(pid);
        adj.get(pid)!.add(item.id);
      }
    }
  }

  const visited = new Set<string>();
  const trees: Achievement[][] = [];
  for (const item of treeItems) {
    if (visited.has(item.id)) continue;
    const comp: Achievement[] = [];
    const queue = [item.id];
    visited.add(item.id);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const entity = byId.get(curr);
      if (entity) comp.push(entity);
      for (const nb of adj.get(curr) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    trees.push(comp);
  }

  return { trees, unlinked };
}

function layoutTreeLayers(items: Achievement[]): Achievement[][] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const rank = new Map<string, number>();
  const waiting = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const item of items) {
    for (const from of item.prevIds) {
      if (!byId.has(from)) continue;
      waiting.set(item.id, (waiting.get(item.id) ?? 0) + 1);
      const list = outgoing.get(from) ?? [];
      list.push(item.id);
      outgoing.set(from, list);
    }
  }

  const queue = items
    .filter((item) => !waiting.has(item.id))
    .map((item) => item.id);
  const layers: Achievement[][] = [];

  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    const level = rank.get(id) ?? 0;
    (layers[level] ??= []).push(byId.get(id)!);
    for (const to of outgoing.get(id) ?? []) {
      rank.set(to, Math.max(rank.get(to) ?? 0, level + 1));
      const count = waiting.get(to)! - 1;
      waiting.set(to, count);
      if (count === 0) queue.push(to);
    }
  }

  if (queue.length < items.length) {
    const placed = new Set(queue);
    (layers[0] ??= []).push(...items.filter((item) => !placed.has(item.id)));
  }

  return layers;
}

function wouldCycle(items: Achievement[], from: string, to: string): boolean {
  if (from === to) return true;
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (curr === to) return true;
    if (seen.has(curr)) continue;
    seen.add(curr);
    for (const p of byId.get(curr)?.prevIds ?? []) {
      if (byId.has(p)) stack.push(p);
    }
  }
  return false;
}

export function Achievements() {
  const { entities } = useEntities("achievement");
  const [customCategories, setCustomCategories] = usePreference<string[]>(
    "achievement-categories",
    DEFAULT_CATEGORIES,
  );
  const [viewMode, setViewMode] = useState<"grid" | "tree">("grid");
  const [scopeFilter, setScopeFilter] = useState<
    "all" | "lifetime" | "annual"
  >("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "done">(
    "all",
  );
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filterWrapRef.current && !filterWrapRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFilterOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [filterOpen]);

  // Tree custom ordering & linking state
  const [arranging, setArranging] = useState(false);
  const [linkSourceId, setLinkSourceId] = useState<string | null>(null);

  // Modals
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    mode: "create" | "edit";
    initial?: Partial<Achievement>;
  } | null>(null);
  const [catModal, setCatModal] = useState(false);
  const cleanedRef = useRef(false);

  // Automatically remove any previously seeded demo records if present
  useEffect(() => {
    const demoEntities = entities.filter((e) =>
      e.id.startsWith(DEMO_ID_PREFIX),
    );
    if (demoEntities.length === 0 || cleanedRef.current) return;
    cleanedRef.current = true;
    localStorage.removeItem("pc-next-ach-entity-seeded-v1");
    perform(
      (async () => {
        for (const demo of demoEntities) {
          await remove(demo);
        }
      })(),
    );
  }, [entities]);

  const items = useMemo(
    () =>
      entities
        .filter((e) => !e.id.startsWith(DEMO_ID_PREFIX))
        .map(toAchievement),
    [entities],
  );

  const categories = useMemo(() => {
    const set = new Set<string>(customCategories.filter(Boolean));
    for (const item of items) {
      if (item.category) set.add(item.category);
    }
    return [...set];
  }, [customCategories, items]);

  const byId = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (scopeFilter !== "all" && item.scope !== scopeFilter) return false;
      if (categoryFilter !== "all" && item.category !== categoryFilter)
        return false;
      if (statusFilter === "done" && !item.completed) return false;
      if (statusFilter === "pending" && item.completed) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.note.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, scopeFilter, categoryFilter, statusFilter, search]);

  const lifetimeItems = useMemo(
    () => filteredItems.filter((i) => i.scope === "lifetime"),
    [filteredItems],
  );
  const annualItems = useMemo(
    () => filteredItems.filter((i) => i.scope === "annual"),
    [filteredItems],
  );

  const { trees, unlinked } = useMemo(
    () => buildConnectedTrees(filteredItems),
    [filteredItems],
  );

  const doneCount = filteredItems.filter((i) => i.completed).length;
  const totalCount = filteredItems.length;
  const donePct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  const activeItem = activeId ? (byId.get(activeId) ?? null) : null;

  function savePatch(item: Achievement, patch: Partial<Achievement>) {
    const next = { ...item, ...patch };
    perform(put("achievement", toPayload(next), { id: item.id }));
  }

  function toggleComplete(item: Achievement) {
    if (item.completed) {
      savePatch(item, { completed: false });
    } else {
      savePatch(item, {
        completed: true,
        completedAt: item.completedAt || today(),
        current: item.target > 1 ? item.target : 1,
      });
    }
  }

  function setProgressValue(item: Achievement, rawVal: number) {
    if (!Number.isFinite(rawVal)) return;
    const nextVal = Math.max(0, Number(rawVal.toFixed(2)));
    const reached = item.target > 1 && nextVal >= item.target;
    savePatch(item, {
      current: nextVal,
      ...(reached && !item.completed
        ? { completed: true, completedAt: item.completedAt || today() }
        : {}),
    });
  }

  function toggleTreeLink(fromId: string, toId: string) {
    if (fromId === toId) return;
    const target = byId.get(toId);
    if (!target) return;
    const exists = target.prevIds.includes(fromId);
    if (!exists && wouldCycle(items, fromId, toId)) {
      window.dispatchEvent(
        new CustomEvent("council-error", {
          detail: "这两个成就已经有反向先后顺序，请先解除原连线",
        }),
      );
      return;
    }
    const prevIds = exists
      ? target.prevIds.filter((id) => id !== fromId)
      : [...target.prevIds, fromId];
    savePatch(target, { prevIds });
  }

  async function shiftNodeOrder(item: Achievement, dir: "left" | "right") {
    if (dir === "left") {
      const parentId = item.prevIds[0];
      if (!parentId) return;
      const parent = byId.get(parentId);
      if (!parent) return;
      const parentPrevs = parent.prevIds.filter((id) => id !== item.id);
      const children = items.filter((e) => e.prevIds.includes(item.id));
      await put("achievement", toPayload({ ...item, prevIds: parentPrevs }), {
        id: item.id,
      });
      await put("achievement", toPayload({ ...parent, prevIds: [item.id] }), {
        id: parent.id,
      });
      for (const child of children) {
        await put(
          "achievement",
          toPayload({
            ...child,
            prevIds: child.prevIds.map((pid) =>
              pid === item.id ? parent.id : pid,
            ),
          }),
          { id: child.id },
        );
      }
    } else {
      const child = items.find((i) => i.prevIds.includes(item.id));
      if (child) await shiftNodeOrder(child, "left");
    }
  }

  async function detachFromTree(item: Achievement) {
    const parentIds = item.prevIds;
    await put("achievement", toPayload({ ...item, prevIds: [] }), {
      id: item.id,
    });
    for (const child of items.filter((e) => e.prevIds.includes(item.id))) {
      const rest = child.prevIds.filter((id) => id !== item.id);
      await put(
        "achievement",
        toPayload({
          ...child,
          prevIds: [...new Set([...rest, ...parentIds])],
        }),
        { id: child.id },
      );
    }
  }

  const activeFilterParts: string[] = [];
  if (scopeFilter === "lifetime") activeFilterParts.push("人生成就");
  else if (scopeFilter === "annual") activeFilterParts.push("年度成就");
  if (statusFilter === "pending") activeFilterParts.push("未完成");
  else if (statusFilter === "done") activeFilterParts.push("已完成");
  if (categoryFilter !== "all") activeFilterParts.push(categoryFilter);
  if (search.trim()) activeFilterParts.push(`「${search.trim()}」`);
  const activeFilterCount = activeFilterParts.length;

  function clearFilters() {
    setScopeFilter("all");
    setStatusFilter("all");
    setCategoryFilter("all");
    setSearch("");
  }

  return (
    <div className="ach-page">
      <Heading eyebrow="ACHIEVEMENTS" title="成就">
        <div className="segmented" aria-label="视图模式">
          <button
            className={viewMode === "grid" ? "active" : ""}
            onClick={() => setViewMode("grid")}
          >
            全部成就
          </button>
          <button
            className={viewMode === "tree" ? "active" : ""}
            onClick={() => setViewMode("tree")}
          >
            进度树
          </button>
        </div>
        <div className="ach-filter-wrap" ref={filterWrapRef}>
          <button
            className={
              "ach-filter-trigger" + (activeFilterCount > 0 ? " has-active" : "")
            }
            aria-expanded={filterOpen}
            aria-haspopup="dialog"
            onClick={() => setFilterOpen((v) => !v)}
          >
            筛选{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
          {filterOpen && (
            <div className="ach-filter-popover" role="dialog" aria-label="筛选成就">
              <div className="ach-filter-group">
                <span className="ach-filter-label">搜索</span>
                <input
                  className="ach-filter-search"
                  placeholder="标题、描述或完成记录…"
                  aria-label="搜索成就"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="ach-filter-group">
                <span className="ach-filter-label">跨度</span>
                <div className="ach-filter-options">
                  {(
                    [
                      ["all", "全部"],
                      ["lifetime", "人生成就"],
                      ["annual", "年度成就"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={
                        "ach-filter-opt" + (scopeFilter === key ? " active" : "")
                      }
                      onClick={() => setScopeFilter(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ach-filter-group">
                <span className="ach-filter-label">状态</span>
                <div className="ach-filter-options">
                  {(
                    [
                      ["all", "全部"],
                      ["pending", "未完成"],
                      ["done", "已完成"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={
                        "ach-filter-opt" + (statusFilter === k ? " active" : "")
                      }
                      onClick={() => setStatusFilter(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ach-filter-group">
                <span className="ach-filter-label">板块</span>
                <div className="ach-filter-options">
                  <button
                    type="button"
                    className={
                      "ach-filter-opt" + (categoryFilter === "all" ? " active" : "")
                    }
                    onClick={() => setCategoryFilter("all")}
                  >
                    全部板块
                  </button>
                  {categories.map((cat) => {
                    const list = items.filter(
                      (i) =>
                        i.category === cat &&
                        (scopeFilter === "all" || i.scope === scopeFilter),
                    );
                    const done = list.filter((i) => i.completed).length;
                    const active = categoryFilter === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        className={"ach-filter-opt" + (active ? " active" : "")}
                        onClick={() => setCategoryFilter(cat)}
                      >
                        {cat}
                        <small>
                          {done}/{list.length}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </div>

              {activeFilterCount > 0 && (
                <div className="ach-filter-footer">
                  <button
                    type="button"
                    className="muted"
                    onClick={() => {
                      clearFilters();
                      setFilterOpen(false);
                    }}
                  >
                    清空筛选
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <button onClick={() => setCatModal(true)}>分类</button>
        <button
          className="primary"
          onClick={() =>
            setEditor({
              mode: "create",
              initial: {
                scope: scopeFilter === "annual" ? "annual" : "lifetime",
                category:
                  categoryFilter === "all"
                    ? (categories[0] ?? "")
                    : categoryFilter,
              },
            })
          }
        >
          ＋ 新建成就
        </button>
      </Heading>

      {activeFilterCount > 0 && (
        <div className="ach-active-filters">
          <span>当前筛选：{activeFilterParts.join(" · ")}</span>
          <button type="button" onClick={clearFilters}>
            清除
          </button>
        </div>
      )}

      {/* Overview Completion Strip */}
      <div className="ach-overview-strip">
        <div className="ach-overview-counts">
          <span>已完成</span>
          <strong>
            {doneCount} / {totalCount}
          </strong>
        </div>
        <div className="ach-overview-track">
          <i style={{ width: `${donePct}%` }} />
        </div>
        <div className="ach-overview-stats">
          <span>
            人生成就{" "}
            <b>
              {lifetimeItems.filter((i) => i.completed).length}/
              {lifetimeItems.length}
            </b>
          </span>
          <span>
            年度成就{" "}
            <b>
              {annualItems.filter((i) => i.completed).length}/
              {annualItems.length}
            </b>
          </span>
          <span>
            完成率 <b>{donePct}%</b>
          </span>
        </div>
      </div>

      {/* ───────────── VIEW 1: Scrollable Multi-Column Unified Card Grid (全部成就) ───────────── */}
      {viewMode === "grid" && (
        <div className="ach-sections-stack">
          {filteredItems.length === 0 && (
            <Empty text="当前筛选条件下没有成就记录" />
          )}

          {lifetimeItems.length > 0 && (
            <section className="ach-group-section">
              <div className="ach-group-head">
                <div className="ach-group-head-left">
                  <h2>人生成就</h2>
                  <small>
                    一辈子完成一次即满足的人生节点与长线积累 ·{" "}
                    {lifetimeItems.filter((i) => i.completed).length} /{" "}
                    {lifetimeItems.length} 已完成
                  </small>
                </div>
              </div>
              <div className="ach-cards-grid">
                {lifetimeItems.map((item) => (
                  <AchievementCard
                    key={item.id}
                    item={item}
                    onClick={() => setActiveId(item.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {annualItems.length > 0 && (
            <section className="ach-group-section">
              <div className="ach-group-head">
                <div className="ach-group-head-left">
                  <h2>2026 年度成就</h2>
                  <small>
                    今年想要完成的阶段目标清单 ·{" "}
                    {annualItems.filter((i) => i.completed).length} /{" "}
                    {annualItems.length} 已完成
                  </small>
                </div>
              </div>
              <div className="ach-cards-grid">
                {annualItems.map((item) => (
                  <AchievementCard
                    key={item.id}
                    item={item}
                    onClick={() => setActiveId(item.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ───────────── VIEW 2: Custom-Ordered Progression Trees (进度树) ───────────── */}
      {viewMode === "tree" && (
        <div className="ach-trees-container">
          <div className="ach-tree-toolbar">
            <div className="ach-tree-toolbar-info">
              <strong>自由进度树排序</strong>
              <span>
                {arranging
                  ? linkSourceId
                    ? `已选起点「${byId.get(linkSourceId)?.title ?? ""}」→ 请点击另一个成就将它排在后面（再次点击已连接的节点可取消连线）`
                    : "编排模式：可点击卡片右上角 ← / → 调整顺序，或依次点击两个成就把它们串成前后顺序"
                  : "按你自己的想法将成就排成先后路线（不强制完成顺序，任何一项都可以随时单独完成）"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {linkSourceId && (
                <button
                  className="muted"
                  onClick={() => setLinkSourceId(null)}
                >
                  取消起点
                </button>
              )}
              <button
                className={arranging ? "primary" : ""}
                onClick={() => {
                  setArranging(!arranging);
                  setLinkSourceId(null);
                }}
              >
                {arranging ? "完成排序编排" : "自定义排序 / 连线"}
              </button>
            </div>
          </div>

          {trees.length === 0 ? (
            <Empty text="当前分类下还没有排好顺序的进度树，点击上方「自定义排序 / 连线」把下方的成就串联起来" />
          ) : (
            trees.map((tree) => {
              const layers = layoutTreeLayers(tree);
              const root = layers[0]?.[0] ?? tree[0]!;
              const doneInTree = tree.filter((i) => i.completed).length;

              return (
                <ProgressionTreeBoard
                  key={root.id}
                  tree={tree}
                  layers={layers}
                  title={`${root.category ? root.category + " · " : ""}${root.title} 路线`}
                  doneCount={doneInTree}
                  allById={byId}
                  arranging={arranging}
                  linkSourceId={linkSourceId}
                  onNodeClick={(item) => {
                    if (arranging) {
                      if (!linkSourceId) {
                        setLinkSourceId(item.id);
                      } else if (linkSourceId === item.id) {
                        setLinkSourceId(null);
                      } else {
                        toggleTreeLink(linkSourceId, item.id);
                        setLinkSourceId(item.id);
                      }
                    } else {
                      setActiveId(item.id);
                    }
                  }}
                  onShift={(item, dir) => perform(shiftNodeOrder(item, dir))}
                  onDetach={(item) => perform(detachFromTree(item))}
                  onAppendNew={(fromItem) =>
                    setEditor({
                      mode: "create",
                      initial: {
                        scope: fromItem.scope,
                        category: fromItem.category,
                        icon: fromItem.icon,
                        prevIds: [fromItem.id],
                      },
                    })
                  }
                />
              );
            })
          )}

          {unlinked.length > 0 && (
            <div className="ach-unlinked-pool">
              <div className="ach-unlinked-head">
                <strong>未加入进度树的独立成就（{unlinked.length} 项）</strong>
                <small>
                  {arranging
                    ? linkSourceId
                      ? "点击下方任意成就，即可将它排在当前选中的起点之后"
                      : "先点击一项作为起点，再点击另一项即可组成新的进度树"
                    : "开启右上角「自定义排序 / 连线」即可将这些成就排入进度树"}
                </small>
              </div>
              <div className="ach-cards-grid">
                {unlinked.map((item) => (
                  <AchievementCard
                    key={item.id}
                    item={item}
                    selected={linkSourceId === item.id}
                    onClick={() => {
                      if (arranging) {
                        if (!linkSourceId) {
                          setLinkSourceId(item.id);
                        } else if (linkSourceId === item.id) {
                          setLinkSourceId(null);
                        } else {
                          toggleTreeLink(linkSourceId, item.id);
                          setLinkSourceId(item.id);
                        }
                      } else {
                        setActiveId(item.id);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Click Detail & Progress Action Modal */}
      {activeItem && (
        <AchievementDetailModal
          item={activeItem}
          allItems={items}
          byId={byId}
          onClose={() => setActiveId(null)}
          onSelectNode={(id) => setActiveId(id)}
          onToggleComplete={() => toggleComplete(activeItem)}
          onSetProgress={(value) => setProgressValue(activeItem, value)}
          onUpdate={(patch) => savePatch(activeItem, patch)}
          onAddNextStage={() => {
            const base = activeItem;
            setActiveId(null);
            setEditor({
              mode: "create",
              initial: {
                scope: base.scope,
                category: base.category,
                icon: base.icon,
                prevIds: [base.id],
              },
            });
          }}
          onEdit={() => {
            const base = activeItem;
            setActiveId(null);
            setEditor({
              mode: "edit",
              initial: base,
            });
          }}
          onDelete={() => {
            const target = activeItem;
            setActiveId(null);
            perform(
              (async () => {
                await remove(target.entity);
                for (const child of items.filter((i) =>
                  i.prevIds.includes(target.id),
                )) {
                  await put(
                    "achievement",
                    toPayload({
                      ...child,
                      prevIds: child.prevIds.filter((pid) => pid !== target.id),
                    }),
                    { id: child.id },
                  );
                }
              })(),
            );
          }}
        />
      )}

      {/* Create / Edit Achievement Modal */}
      {editor && (
        <AchievementEditorModal
          mode={editor.mode}
          initial={editor.initial}
          categories={categories}
          allItems={items}
          onClose={() => setEditor(null)}
          onSave={(saved) => {
            if (saved.category && !customCategories.includes(saved.category)) {
              setCustomCategories([...customCategories, saved.category]);
            }
            perform(
              put("achievement", toPayload(saved), { id: saved.id }),
            );
            setEditor(null);
          }}
        />
      )}

      {/* Category Manager Modal */}
      {catModal && (
        <CategoryModal
          categories={categories}
          items={items}
          onAddCategory={(name) => {
            if (!customCategories.includes(name)) {
              setCustomCategories([...customCategories, name]);
            }
          }}
          onRenameCategory={(oldName, newName) => {
            const trimmed = newName.trim();
            if (!trimmed || trimmed === oldName) return;
            const nextCats = categories.map((c) =>
              c === oldName ? trimmed : c,
            );
            setCustomCategories([...new Set(nextCats)]);
            for (const item of items.filter((i) => i.category === oldName)) {
              savePatch(item, { category: trimmed });
            }
            if (categoryFilter === oldName) setCategoryFilter(trimmed);
          }}
          onRemoveCategory={(name) => {
            const nextCats = categories.filter((c) => c !== name);
            setCustomCategories(nextCats);
            for (const item of items.filter((i) => i.category === name)) {
              savePatch(item, { category: "" });
            }
            if (categoryFilter === name) setCategoryFilter("all");
          }}
          onClose={() => setCatModal(false)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * Progression Tree Board Component
 * ───────────────────────────────────────────────────────── */
function ProgressionTreeBoard({
  tree,
  layers,
  title,
  doneCount,
  allById,
  arranging,
  linkSourceId,
  onNodeClick,
  onShift,
  onDetach,
  onAppendNew,
}: {
  tree: Achievement[];
  layers: Achievement[][];
  title: string;
  doneCount: number;
  allById: ReadonlyMap<string, Achievement>;
  arranging: boolean;
  linkSourceId: string | null;
  onNodeClick: (item: Achievement) => void;
  onShift: (item: Achievement, dir: "left" | "right") => void;
  onDetach: (item: Achievement) => void;
  onAppendNew: (fromItem: Achievement) => void;
}) {
  const markerId = useId();
  const treeSet = useMemo(() => new Set(tree.map((i) => i.id)), [tree]);

  const edges = useMemo(() => {
    const list: { from: string; to: string }[] = [];
    for (const item of tree) {
      for (const pid of item.prevIds) {
        if (treeSet.has(pid)) list.push({ from: pid, to: item.id });
      }
    }
    return list;
  }, [tree, treeSet]);

  const nodeWidth = layers.length >= 4 ? 246 : 262;
  const nodeHeight = 88;
  const gapX = layers.length >= 4 ? 40 : 48;
  const gapY = 20;
  const stepX = nodeWidth + gapX;
  const stepY = nodeHeight + gapY;
  const insetX = 18;
  const insetY = 22;

  const widest = Math.max(1, ...layers.map((l) => l.length));
  const canvasWidth = insetX * 2 + layers.length * stepX - gapX;
  const canvasHeight = insetY * 2 + widest * stepY - gapY;

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    layers.forEach((layer, colIdx) => {
      const colHeight = layer.length * stepY - gapY;
      const startY = Math.round((canvasHeight - colHeight) / 2);
      layer.forEach((item, rowIdx) => {
        const parents = item.prevIds
          .map((pid) => map.get(pid))
          .filter((p) => p !== undefined);
        const defaultY = startY + rowIdx * stepY;
        const y =
          layer.length === 1 && parents.length > 0
            ? Math.round(
                parents.reduce((s, p) => s + p.y, 0) / parents.length,
              )
            : defaultY;
        map.set(item.id, {
          x: insetX + colIdx * stepX,
          y,
        });
      });
    });
    return map;
  }, [layers, canvasHeight, stepX, stepY]);

  const lastNode = layers.at(-1)?.[0] ?? tree.at(-1)!;

  return (
    <div className="ach-tree-board-card">
      <div className="ach-tree-board-head">
        <div className="ach-tree-board-title">
          <strong>{title}</strong>
          <small>
            已完成 {doneCount} / {tree.length}
          </small>
        </div>
        <div className="ach-tree-board-actions">
          <button onClick={() => onAppendNew(lastNode)}>
            ＋ 在末尾延伸新成就
          </button>
        </div>
      </div>

      <div className="ach-tree-canvas-wrap">
        <div
          className="ach-tree-canvas"
          style={{ width: canvasWidth, height: canvasHeight }}
        >
          <svg
            className="ach-tree-svg"
            width={canvasWidth}
            height={canvasHeight}
            aria-hidden="true"
          >
            <defs>
              <marker
                id={markerId}
                viewBox="0 0 8 8"
                refX="6.5"
                refY="4"
                markerWidth="6.5"
                markerHeight="6.5"
                orient="auto"
              >
                <path d="M1 1.5 6 4 1 6.5" className="ach-tree-arrow-head" />
              </marker>
              <marker
                id={markerId + "-done"}
                viewBox="0 0 8 8"
                refX="6.5"
                refY="4"
                markerWidth="6.5"
                markerHeight="6.5"
                orient="auto"
              >
                <path
                  d="M1 1.5 6 4 1 6.5"
                  className="ach-tree-arrow-head done"
                />
              </marker>
            </defs>

            {edges.map(({ from, to }) => {
              const a = positions.get(from);
              const b = positions.get(to);
              if (!a || !b) return null;
              const fromItem = allById.get(from);
              const toItem = allById.get(to);
              const lit = Boolean(fromItem?.completed || toItem?.completed);

              const startX = a.x + nodeWidth;
              const startY = a.y + nodeHeight / 2;
              const endX = b.x - 3;
              const endY = b.y + nodeHeight / 2;
              const midX = Math.round((startX + endX) / 2);
              const dy = endY - startY;
              const r = Math.min(8, Math.abs(dy) / 2, (endX - startX) / 4);
              const dir = dy >= 0 ? 1 : -1;

              const d =
                Math.abs(dy) < 2
                  ? `M${startX} ${startY} H${endX}`
                  : `M${startX} ${startY} H${midX - r} Q${midX} ${startY} ${midX} ${startY + dir * r} V${endY - dir * r} Q${midX} ${endY} ${midX + r} ${endY} H${endX}`;

              return (
                <path
                  key={`${from}->${to}`}
                  d={d}
                  className={"ach-tree-path" + (lit ? " done" : "")}
                  markerEnd={`url(#${markerId}${lit ? "-done" : ""})`}
                />
              );
            })}
          </svg>

          {tree.map((item) => {
            const pos = positions.get(item.id);
            if (!pos) return null;
            const hasParent = item.prevIds.some((pid) => treeSet.has(pid));
            const hasChild = tree.some((t) => t.prevIds.includes(item.id));

            return (
              <div
                key={item.id}
                className="ach-tree-node-wrap"
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: nodeWidth,
                  height: nodeHeight,
                }}
              >
                {arranging && (
                  <div className="ach-node-order-bar">
                    <button
                      disabled={!hasParent}
                      title="向前移动一位"
                      onClick={(e) => {
                        e.stopPropagation();
                        onShift(item, "left");
                      }}
                    >
                      ←
                    </button>
                    <button
                      disabled={!hasChild}
                      title="向后移动一位"
                      onClick={(e) => {
                        e.stopPropagation();
                        onShift(item, "right");
                      }}
                    >
                      →
                    </button>
                    <button
                      title="从进度树移出（保留成就本身）"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDetach(item);
                      }}
                    >
                      移出
                    </button>
                  </div>
                )}
                <AchievementCard
                  item={item}
                  showTag={false}
                  selected={linkSourceId === item.id}
                  style={{ width: "100%", height: "100%" }}
                  onClick={() => onNodeClick(item)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * Detail & Progress Action Modal
 * ───────────────────────────────────────────────────────── */
function AchievementDetailModal({
  item,
  allItems,
  byId,
  onClose,
  onSelectNode,
  onToggleComplete,
  onSetProgress,
  onUpdate,
  onAddNextStage,
  onEdit,
  onDelete,
}: {
  item: Achievement;
  allItems: Achievement[];
  byId: ReadonlyMap<string, Achievement>;
  onClose: () => void;
  onSelectNode: (id: string) => void;
  onToggleComplete: () => void;
  onSetProgress: (value: number) => void;
  onUpdate: (patch: Partial<Achievement>) => void;
  onAddNextStage: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [progressInput, setProgressInput] = useState(String(item.current));
  const [noteDraft, setNoteDraft] = useState(item.note);

  useEffect(() => {
    setProgressInput(String(item.current));
  }, [item.id, item.current]);

  useEffect(() => {
    setNoteDraft(item.note);
  }, [item.id, item.note]);

  const parsedProgress = Number(progressInput.trim());
  const progressValid =
    progressInput.trim() !== "" &&
    Number.isFinite(parsedProgress) &&
    parsedProgress >= 0;
  const progressDirty =
    progressValid && Number(parsedProgress.toFixed(2)) !== item.current;

  function commitProgress(e?: React.FormEvent) {
    e?.preventDefault();
    if (!progressValid) return;
    onSetProgress(parsedProgress);
  }

  function flushNoteAndClose() {
    if (noteDraft !== item.note) {
      onUpdate({ note: noteDraft });
    }
    onClose();
  }

  const prevs = item.prevIds
    .map((id) => byId.get(id))
    .filter((p): p is Achievement => p !== undefined);
  const nextItems = allItems.filter((i) => i.prevIds.includes(item.id));
  const pct =
    item.target > 1
      ? Math.min(
          100,
          Math.round((item.current / Math.max(1, item.target)) * 100),
        )
      : item.completed
        ? 100
        : 0;

  return (
    <div className="modal-backdrop" onClick={flushNoteAndClose}>
      <div
        className="modal ach-modal-card"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ach-modal-hero">
          <IconBox icon={item.icon} done={item.completed} />
          <div className="ach-modal-hero-text">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="pill">
                {item.scope === "annual"
                  ? `${item.year || "2026"} 年度成就`
                  : "人生成就"}
              </span>
              {item.category && <span className="pill">{item.category}</span>}
              <span className={"pill" + (item.completed ? " solid" : "")}>
                {item.completed ? "已达成" : "未完成"}
              </span>
            </div>
            <h2>{item.title}</h2>
            {item.description && <p>{item.description}</p>}
          </div>
          <button
            className="muted"
            onClick={flushNoteAndClose}
            aria-label="关闭详情"
          >
            ×
          </button>
        </div>

        <div className="ach-modal-status-box">
          <div>
            <strong>
              {item.completed
                ? `已达成${item.completedAt ? ` · ${item.completedAt}` : ""}`
                : "尚未达成"}
            </strong>
            <small>
              {item.target > 1
                ? `当前进度：${item.current.toLocaleString("zh-CN")} / ${item.target.toLocaleString("zh-CN")} ${item.unit}`
                : "真正达成时点此确认，并记录当时的时间与故事"}
            </small>
          </div>
          <button
            className={item.completed ? "" : "primary"}
            onClick={onToggleComplete}
          >
            {item.completed ? "撤销完成" : "确认完成"}
          </button>
        </div>

        {item.target > 1 && (
          <form className="ach-modal-counter" onSubmit={commitProgress}>
            <div className="ach-modal-counter-top">
              <strong>
                {item.current.toLocaleString("zh-CN")} /{" "}
                {item.target.toLocaleString("zh-CN")} {item.unit} ({pct}%)
              </strong>
              <div className="ach-modal-counter-input">
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  aria-label="当前进度数值"
                  value={progressInput}
                  onChange={(e) => setProgressInput(e.target.value)}
                />
                {item.unit && <span className="ach-modal-counter-unit">{item.unit}</span>}
                <button
                  type="submit"
                  className={progressDirty ? "primary" : ""}
                  disabled={!progressDirty}
                >
                  更新
                </button>
              </div>
            </div>
            <div className="ach-card-bar">
              <i style={{ width: `${pct}%` }} />
            </div>
          </form>
        )}

        <div className="ach-modal-section ach-completion-box">
          <div className="ach-modal-section-head">
            <span>完成时间与记录</span>
            <label className="ach-completion-date">
              <span>完成时间</span>
              <input
                type="date"
                value={item.completedAt ?? ""}
                onChange={(e) =>
                  onUpdate({ completedAt: e.target.value || undefined })
                }
              />
            </label>
          </div>
          <textarea
            placeholder="记录真正完成那天的时间节点、关键数字或当时的感受…"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={() => {
              if (noteDraft !== item.note) {
                onUpdate({ note: noteDraft });
              }
            }}
          />
        </div>

        <div className="ach-modal-section">
          <div className="ach-modal-section-head">
            <span>进度树先后排序（仅作路线排序，不限制完成先后）</span>
            <button
              style={{ height: 24, fontSize: "var(--fs-xs)" }}
              onClick={onAddNextStage}
            >
              ＋ 在此之后延伸新成就
            </button>
          </div>
          {(prevs.length > 0 || nextItems.length > 0) && (
            <div className="ach-chips" style={{ marginTop: 2 }}>
              {prevs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={"ach-chip" + (p.completed ? " done" : "")}
                  onClick={() => onSelectNode(p.id)}
                >
                  前一项：{p.title}
                </button>
              ))}
              {nextItems.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={"ach-chip" + (n.completed ? " done" : "")}
                  onClick={() => onSelectNode(n.id)}
                >
                  后一项：{n.title}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ach-modal-footer">
          <div className="ach-modal-footer-left">
            <button className="danger muted" onClick={onDelete}>
              删除
            </button>
          </div>
          <div className="ach-modal-footer-right">
            <button onClick={onEdit}>编辑属性</button>
            <button className="primary" onClick={flushNoteAndClose}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * Modal: Create / Edit Achievement
 * ───────────────────────────────────────────────────────── */
function AchievementEditorModal({
  mode,
  initial,
  categories,
  allItems,
  onClose,
  onSave,
}: {
  mode: "create" | "edit";
  initial?: Partial<Achievement>;
  categories: string[];
  allItems: Achievement[];
  onClose: () => void;
  onSave: (item: Omit<Achievement, "entity">) => void;
}) {
  const id = initial?.id ?? crypto.randomUUID();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [scope, setScope] = useState<AchievementScope>(
    initial?.scope ?? "lifetime",
  );
  const [year, setYear] = useState(initial?.year ?? "2026");
  const [category, setCategory] = useState(
    initial?.category ?? categories[0] ?? "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "check");
  const [hasTarget, setHasTarget] = useState((initial?.target ?? 1) > 1);
  const [current, setCurrent] = useState(initial?.current ?? 0);
  const [target, setTarget] = useState(
    (initial?.target ?? 1) > 1 ? initial!.target! : 10,
  );
  const [unit, setUnit] = useState(initial?.unit ?? "次");
  const [prevIds, setPrevIds] = useState<string[]>(initial?.prevIds ?? []);
  const [note, setNote] = useState(initial?.note ?? "");

  const candidates = allItems.filter((i) => i.id !== id);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{mode === "create" ? "新建成就" : "编辑成就"}</h2>
          <button onClick={onClose}>×</button>
        </header>

        <form
          className="record-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            const finalTarget = hasTarget
              ? Math.max(2, Number(target) || 2)
              : 1;
            const finalCurrent = hasTarget
              ? Math.max(0, Number(current) || 0)
              : initial?.completed
                ? 1
                : 0;
            onSave({
              id,
              scope,
              year: scope === "annual" ? year.trim() || "2026" : "2026",
              category: category.trim(),
              title: title.trim(),
              description: description.trim(),
              icon,
              prevIds: prevIds.filter((pid) =>
                candidates.some((c) => c.id === pid),
              ),
              current: finalCurrent,
              target: finalTarget,
              unit: unit.trim() || "次",
              completed: initial?.completed ?? false,
              completedAt: initial?.completedAt,
              note: note.trim(),
            });
          }}
        >
          <label>
            <span>名称</span>
            <input
              required
              placeholder="如：第一次去国外旅行 / 累计跑步 10,000 公里"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <label>
            <span>板块分类（选填）</span>
            <input
              list="ach-category-options"
              placeholder="输入或选择自定义分类…"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <datalist id="ach-category-options">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>

          <div className="field">
            <span>成就类型</span>
            <div className="segmented">
              <button
                type="button"
                className={scope === "lifetime" ? "active" : ""}
                onClick={() => setScope("lifetime")}
              >
                人生成就
              </button>
              <button
                type="button"
                className={scope === "annual" ? "active" : ""}
                onClick={() => setScope("annual")}
              >
                年度成就
              </button>
            </div>
          </div>

          {scope === "annual" ? (
            <label>
              <span>所属年份</span>
              <input
                value={year}
                placeholder="2026"
                onChange={(e) => setYear(e.target.value)}
              />
            </label>
          ) : (
            <div className="field">
              <span>进度计量</span>
              <div className="segmented">
                <button
                  type="button"
                  className={!hasTarget ? "active" : ""}
                  onClick={() => setHasTarget(false)}
                >
                  单次达成
                </button>
                <button
                  type="button"
                  className={hasTarget ? "active" : ""}
                  onClick={() => setHasTarget(true)}
                >
                  长线积累数值
                </button>
              </div>
            </div>
          )}

          {scope === "annual" && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span>进度计量</span>
              <div className="segmented">
                <button
                  type="button"
                  className={!hasTarget ? "active" : ""}
                  onClick={() => setHasTarget(false)}
                >
                  单次达成
                </button>
                <button
                  type="button"
                  className={hasTarget ? "active" : ""}
                  onClick={() => setHasTarget(true)}
                >
                  累计数值进度
                </button>
              </div>
            </div>
          )}

          <label style={{ gridColumn: "1 / -1" }}>
            <span>具体描述</span>
            <input
              placeholder="用一句话写清楚完成标准…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          {hasTarget && (
            <>
              <label>
                <span>当前已完成数值</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={current}
                  onChange={(e) => setCurrent(Number(e.target.value))}
                />
              </label>
              <label>
                <span>目标数值与单位</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="number"
                    min={2}
                    step="any"
                    style={{ flex: 1 }}
                    value={target}
                    onChange={(e) => setTarget(Number(e.target.value))}
                  />
                  <input
                    style={{ width: 72 }}
                    placeholder="公里/天/本"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                  />
                </div>
              </label>
            </>
          )}

          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <span>图标</span>
            <div className="ach-icon-picker">
              {Object.entries(ICONS).map(([key, def]) => (
                <button
                  key={key}
                  type="button"
                  title={def.label}
                  className={"ach-icon-btn" + (icon === key ? " active" : "")}
                  onClick={() => setIcon(key)}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {def.svg}
                  </svg>
                </button>
              ))}
            </div>
          </div>

          {candidates.length > 0 && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span>
                排在哪个成就后面（选填，用于在「进度树」里自定义排序，不限制完成先后）
              </span>
              <div
                className="ach-chips"
                style={{ maxHeight: 110, overflowY: "auto", padding: 2 }}
              >
                {candidates
                  .filter((c) => c.category === category)
                  .concat(
                    candidates.filter((c) => c.category !== category),
                  )
                  .map((c) => {
                    const active = prevIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={"ach-chip" + (active ? " done" : "")}
                        onClick={() =>
                          setPrevIds(
                            active
                              ? prevIds.filter((x) => x !== c.id)
                              : [...prevIds, c.id],
                          )
                        }
                      >
                        {active ? "✓ " : ""}
                        {c.title}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          <label style={{ gridColumn: "1 / -1" }}>
            <span>备注（选填）</span>
            <textarea
              placeholder="补充记录…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <div className="form-actions">
            <button className="primary" type="submit">
              保存
            </button>
            <button type="button" onClick={onClose}>
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * Modal: Manage Categories
 * ───────────────────────────────────────────────────────── */
function CategoryModal({
  categories,
  items,
  onAddCategory,
  onRenameCategory,
  onRemoveCategory,
  onClose,
}: {
  categories: string[];
  items: Achievement[];
  onAddCategory: (name: string) => void;
  onRenameCategory: (oldName: string, newName: string) => void;
  onRemoveCategory: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>分类管理</h2>
          <button onClick={onClose}>×</button>
        </header>

        <div className="dense-list">
          {categories.length === 0 && (
            <div style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", padding: "8px 0" }}>
              暂无分类，可在下方添加你自己的分类名称
            </div>
          )}
          {categories.map((cat) => {
            const count = items.filter((i) => i.category === cat).length;
            const isEditing = editingCat === cat;
            return (
              <div key={cat}>
                {isEditing ? (
                  <form
                    style={{ display: "flex", gap: 6, flex: 1, alignItems: "center" }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (editValue.trim()) {
                        onRenameCategory(cat, editValue.trim());
                      }
                      setEditingCat(null);
                    }}
                  >
                    <input
                      autoFocus
                      style={{ flex: 1, height: 28 }}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                    <button className="primary" type="submit" style={{ height: 28 }}>
                      保存
                    </button>
                    <button
                      type="button"
                      style={{ height: 28 }}
                      onClick={() => setEditingCat(null)}
                    >
                      取消
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="row-main">
                      <strong>{cat}</strong>
                      <small>{count} 项成就</small>
                    </div>
                    <div className="row-tools">
                      <button
                        onClick={() => {
                          setEditingCat(cat);
                          setEditValue(cat);
                        }}
                      >
                        重命名
                      </button>
                      <button
                        className="danger"
                        onClick={() => onRemoveCategory(cat)}
                      >
                        删除
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <form
          style={{
            display: "flex",
            gap: 8,
            paddingTop: 8,
            borderTop: "1px solid var(--line)",
          }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            onAddCategory(name.trim());
            setName("");
          }}
        >
          <input
            style={{ flex: 1 }}
            placeholder="新增分类名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="primary" type="submit">
            添加
          </button>
        </form>
      </div>
    </div>
  );
}
