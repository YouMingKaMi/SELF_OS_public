import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  put,
  remove,
  useEntities,
  type AnyEntity,
  type EntityData,
} from "../../data/entities.ts";
import { Icon } from "../../ui/Icon.tsx";
import {
  arr,
  num,
  perform,
  str,
  today,
  usePreference,
} from "../../ui/shared.tsx";
import {
  InkCard,
  InkComposer,
  InkEmpty,
  InkHairline,
  InkMeter,
  InkNavIcon,
  InkScreen,
  InkSearch,
  InkSectionLabel,
  InkSegmented,
  InkSheet,
  InkStatRow,
  InkSwitch,
  MobileToolbar,
} from "./MobileKit.tsx";
import "./mobile-achievements.css";

type AchievementScope = "lifetime" | "annual";
type ViewMode = "list" | "tree";
type ScopeFilter = "all" | "lifetime" | "annual";
type StatusFilter = "all" | "pending" | "done";

type Achievement = {
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

const DEMO_ID_PREFIX = "a0000000-0000-4000-8000-0000000000";

const ACH_ICONS: readonly {
  key: string;
  label: string;
  svg: React.ReactNode;
}[] = [
  {
    key: "check",
    label: "达成",
    svg: <path d="m4.5 12.5 5 5L19.5 7" />,
  },
  {
    key: "run",
    label: "跑步",
    svg: (
      <path d="M13 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM7 21l3-6 2.5 2v4h2v-5.5l-2.5-2 1-3.5 3 2h3v-2h-2.5l-2.5-2c-.8-.6-2-.5-2.6.4L9 13l-3 1v2l2.5-.8L7 21Z" />
    ),
  },
  {
    key: "mountain",
    label: "山峰",
    svg: <path d="m3 19 6.5-11 4.2 6.5 2.8-4 4.5 8.5H3Z" />,
  },
  {
    key: "bike",
    label: "骑行",
    svg: (
      <>
        <circle cx="6.5" cy="16.5" r="3" />
        <circle cx="17.5" cy="16.5" r="3" />
        <path d="M6.5 16.5 10 10h4l2 3.5M10 10 8.5 7H7m7 3 3 6.5" />
      </>
    ),
  },
  {
    key: "compass",
    label: "远行",
    svg: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m15.5 8.5-2.2 5.2-5.2 2.2 2.2-5.2 5.2-2.2Z" />
      </>
    ),
  },
  {
    key: "globe",
    label: "世界",
    svg: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.6 12h16.8M12 3.5c2.5 2.4 3.8 5.4 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.4-3.8-8.5s1.3-6.1 3.8-8.5Z" />
      </>
    ),
  },
  {
    key: "book",
    label: "阅读",
    svg: (
      <path d="M12 5.5C8.5 3.5 5 4 3 5v14c2-1 5.5-1.5 9 .5 3.5-2 7-1.5 9-.5V5c-2-1-5.5-1.5-9 .5Zm0 0v14" />
    ),
  },
  {
    key: "language",
    label: "语言",
    svg: (
      <path d="M4 5h10M9 3v2m2.5 0c-.5 4-2.8 7.5-6.5 9.5m2.5-5c1.3 2 3.2 3.8 5.5 5m1 5.5 3.5-9 3.5 9m-5.8-2.8h4.6" />
    ),
  },
  {
    key: "coin",
    label: "储备",
    svg: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m9 8 3 3.5L15 8m-6 4h6m-6 3h6m-3-3.5V18" />
      </>
    ),
  },
  {
    key: "code",
    label: "作品",
    svg: <path d="m8 8-4 4 4 4m8-8 4 4-4 4m-2.5-10-3 12" />,
  },
  {
    key: "home",
    label: "生活",
    svg: <path d="m3 10 9-7 9 7v10H3Zm6 10v-6h6v6" />,
  },
  {
    key: "clock",
    label: "积累",
    svg: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7v5l3.5 2" />
      </>
    ),
  },
];

function iconSvgFor(key: string): React.ReactNode {
  return (ACH_ICONS.find((i) => i.key === key) ?? ACH_ICONS[0]!).svg;
}

function EmblemTile({
  icon,
  done,
  size = "md",
}: {
  icon: string;
  done: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const px = size === "lg" ? 22 : size === "sm" ? 15 : 18;
  return (
    <span
      className={
        "ma-tile" +
        (done ? " done" : "") +
        (size !== "md" ? ` ${size}` : "")
      }
      aria-hidden="true"
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {iconSvgFor(icon)}
      </svg>
    </span>
  );
}

function formatNum(v: number): string {
  if (!Number.isFinite(v)) return "0";
  if (Math.abs(v - Math.round(v)) < 1e-6) {
    return Math.round(v).toLocaleString("zh-CN");
  }
  return Number(v.toFixed(2)).toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  });
}

function toAchievement(entity: AnyEntity): Achievement {
  const defaultYear = today().slice(0, 4);
  return {
    id: entity.id,
    entity,
    scope: entity.data.scope === "annual" ? "annual" : "lifetime",
    year: str(entity, "year", defaultYear) || defaultYear,
    category: str(entity, "category", ""),
    title: str(entity, "title"),
    description: str(entity, "description"),
    icon: str(entity, "icon", "check"),
    prevIds: arr(entity, "prevIds"),
    current: Math.max(0, num(entity, "current", 0)),
    target: Math.max(1, num(entity, "target", 1)),
    unit: str(entity, "unit", "次") || "次",
    completed: Boolean(entity.data.completed),
    completedAt: entity.data.completedAt
      ? String(entity.data.completedAt)
      : undefined,
    note: str(entity, "note"),
  };
}

function toPayload(
  item: Omit<Achievement, "entity">,
): EntityData<"achievement"> {
  return {
    title: item.title,
    description: item.description,
    scope: item.scope,
    ...(item.scope === "annual"
      ? { year: item.year || today().slice(0, 4) }
      : {}),
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
      const node = byId.get(curr);
      if (node) comp.push(node);
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

type EditorConfig = {
  record?: Achievement;
  defaultScope: AchievementScope;
  defaultCategory: string;
  defaultPrevId?: string;
};

export function MobileAchievements() {
  const { entities } = useEntities("achievement");
  const [customCategories, setCustomCategories] = usePreference<string[]>(
    "achievement-categories",
    [],
  );

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [quickTitle, setQuickTitle] = useState("");

  // Sheets
  const [filterOpen, setFilterOpen] = useState(false);
  const [catSheetOpen, setCatSheetOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorConfig, setEditorConfig] = useState<EditorConfig | null>(null);

  // Clean up legacy seeded demo records if present
  const cleanedRef = useRef(false);
  useEffect(() => {
    const demos = entities.filter((e) => e.id.startsWith(DEMO_ID_PREFIX));
    if (demos.length === 0 || cleanedRef.current) return;
    cleanedRef.current = true;
    perform(
      (async () => {
        for (const demo of demos) await remove(demo);
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

  const byId = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );

  const categories = useMemo(() => {
    const set = new Set<string>(customCategories.filter(Boolean));
    for (const item of items) {
      if (item.category.trim()) set.add(item.category.trim());
    }
    return [...set];
  }, [customCategories, items]);

  const ensureCategory = (cat: string) => {
    const trimmed = cat.trim();
    if (!trimmed || customCategories.includes(trimmed)) return;
    setCustomCategories([...customCategories, trimmed]);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (scopeFilter !== "all" && item.scope !== scopeFilter) return false;
      if (categoryFilter !== "all" && item.category !== categoryFilter)
        return false;
      if (statusFilter === "done" && !item.completed) return false;
      if (statusFilter === "pending" && item.completed) return false;
      if (q) {
        return (
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.note.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, scopeFilter, categoryFilter, statusFilter, search]);

  const lifetimeAll = useMemo(
    () => items.filter((i) => i.scope === "lifetime"),
    [items],
  );
  const annualAll = useMemo(
    () => items.filter((i) => i.scope === "annual"),
    [items],
  );

  const lifetimeFiltered = useMemo(
    () => filtered.filter((i) => i.scope === "lifetime"),
    [filtered],
  );

  const annualByYear = useMemo(() => {
    const map = new Map<string, Achievement[]>();
    for (const item of filtered) {
      if (item.scope !== "annual") continue;
      const y = item.year || today().slice(0, 4);
      const bucket = map.get(y) ?? [];
      bucket.push(item);
      map.set(y, bucket);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const { trees, unlinked } = useMemo(
    () => buildConnectedTrees(filtered),
    [filtered],
  );

  const doneCount = filtered.filter((i) => i.completed).length;
  const totalCount = filtered.length;
  const ratio = totalCount > 0 ? doneCount / totalCount : 0;
  const donePct = Math.round(ratio * 100);

  const activeFilterParts: string[] = [];
  if (scopeFilter === "lifetime") activeFilterParts.push("人生成就");
  else if (scopeFilter === "annual") activeFilterParts.push("年度成就");
  if (statusFilter === "pending") activeFilterParts.push("未完成");
  else if (statusFilter === "done") activeFilterParts.push("已完成");
  if (categoryFilter !== "all") activeFilterParts.push(categoryFilter);
  if (search.trim()) activeFilterParts.push(`「${search.trim()}」`);
  const hasActiveFilter = activeFilterParts.length > 0;

  const clearFilters = () => {
    setScopeFilter("all");
    setStatusFilter("all");
    setCategoryFilter("all");
    setSearch("");
  };

  const selectedItem = selectedId ? byId.get(selectedId) ?? null : null;

  const savePatch = (item: Achievement, patch: Partial<Achievement>) => {
    const next = { ...item, ...patch };
    perform(put("achievement", toPayload(next), { id: item.id }));
  };

  const openCreate = (defaultPrevId?: string) => {
    setEditorConfig({
      defaultScope: scopeFilter === "annual" ? "annual" : "lifetime",
      defaultCategory:
        categoryFilter === "all" ? (categories[0] ?? "") : categoryFilter,
      defaultPrevId,
    });
  };

  const handleQuickAdd = () => {
    const title = quickTitle.trim();
    if (!title) return;
    setQuickTitle("");
    const targetScope: AchievementScope =
      scopeFilter === "annual" ? "annual" : "lifetime";
    const targetCat =
      categoryFilter === "all" ? (categories[0] ?? "") : categoryFilter;
    perform(
      put("achievement", {
        title,
        description: "",
        scope: targetScope,
        ...(targetScope === "annual" ? { year: today().slice(0, 4) } : {}),
        category: targetCat,
        icon: "check",
        prevIds: [],
        current: 0,
        target: 1,
        unit: "次",
        completed: false,
        note: "",
      }),
    );
  };

  function renderAchievementRow(item: Achievement) {
    const current = item.completed ? item.target : item.current;
    const itemRatio =
      item.target > 1
        ? Math.min(1, current / item.target)
        : item.completed
          ? 1
          : 0;
    const subtitle =
      item.completed && item.note.trim()
        ? item.note.trim()
        : item.description.trim();
    const metaLabel =
      item.target > 1 && !item.completed
        ? `${formatNum(current)} / ${formatNum(item.target)} ${item.unit}`
        : item.completed
          ? `已完成${item.completedAt ? ` · ${item.completedAt}` : ""}`
          : "未完成";

    return (
      <button
        type="button"
        className="ma-row"
        onClick={() => setSelectedId(item.id)}
      >
        <EmblemTile icon={item.icon} done={item.completed} />
        <span className="ma-row-body">
          <span
            className={"ma-row-title" + (item.completed ? "" : " pending")}
          >
            {item.title}
          </span>
          {subtitle && <span className="ma-row-desc">{subtitle}</span>}
          <span className="ma-row-meta">
            {item.category && (
              <span className="ma-cat-pill">{item.category}</span>
            )}
            <span className={"ma-meta-text" + (item.completed ? " done" : "")}>
              {metaLabel}
            </span>
          </span>
          {item.target > 1 && (
            <span className="ma-row-meter">
              <InkMeter
                progress={itemRatio}
                tone={item.completed ? "live" : "default"}
              />
            </span>
          )}
        </span>
        <span className="ma-row-chev">
          <Icon name="chevron-right" size={14} />
        </span>
      </button>
    );
  }

  return (
    <InkScreen hasComposer>
      <MobileToolbar>
        <span className="ma-nav-wrap">
          <InkNavIcon
            icon="filter"
            label="筛选"
            onClick={() => setFilterOpen(true)}
          />
          {hasActiveFilter && <span className="ma-nav-dot" />}
        </span>
        <InkNavIcon icon="plus" label="新建成就" onClick={() => openCreate()} />
      </MobileToolbar>

      {/* Clean 2-tab switch — 100% 360px safe */}
      <InkSegmented<ViewMode>
        value={viewMode}
        onChange={setViewMode}
        options={[
          { value: "list", label: "列表" },
          { value: "tree", label: "进度树" },
        ]}
      />

      {/* Quiet filter summary bar when active */}
      {hasActiveFilter && (
        <div className="ma-filter-bar">
          <span>已筛选：{activeFilterParts.join(" · ")}</span>
          <button
            type="button"
            className="mk-text-btn accent"
            onClick={clearFilters}
          >
            清除
          </button>
        </div>
      )}

      {/* Summary Hero Card */}
      <InkCard>
        <div className="ma-hero-top">
          <span className="ma-hero-label">
            <Icon name="achievements" size={15} />
            <span>成就总览</span>
          </span>
          <span className="ma-hero-pct">已完成 {donePct}%</span>
        </div>
        <div className="ma-hero-figure">
          <span className="ma-hero-big">
            已完成 {doneCount} / {totalCount}
          </span>
          <span className="ma-hero-unit">项已点亮</span>
        </div>
        <InkMeter progress={ratio} />
        <InkStatRow
          items={[
            {
              label: "人生成就",
              value: `${lifetimeAll.filter((i) => i.completed).length}/${lifetimeAll.length}`,
            },
            {
              label: "年度成就",
              value: `${annualAll.filter((i) => i.completed).length}/${annualAll.length}`,
            },
            {
              label: "完成率",
              value: `${donePct}%`,
            },
          ]}
        />
      </InkCard>

      {/* ─────────────────────────── List View ─────────────────────────── */}
      {viewMode === "list" && (
        <>
          {lifetimeFiltered.length > 0 && (
            <>
              <InkSectionLabel
                title="人生成就"
                aside={`${lifetimeFiltered.filter((i) => i.completed).length}/${lifetimeFiltered.length} 已点亮`}
              />
              <InkCard variant="compact">
                {lifetimeFiltered.map((item, idx) => (
                  <React.Fragment key={item.id}>
                    {idx > 0 && <InkHairline inset={44} />}
                    {renderAchievementRow(item)}
                  </React.Fragment>
                ))}
              </InkCard>
            </>
          )}

          {annualByYear.map(([year, group]) => (
            <React.Fragment key={year}>
              <InkSectionLabel
                title={`${year} 年度成就`}
                aside={`${group.filter((i) => i.completed).length}/${group.length} 已点亮`}
              />
              <InkCard variant="compact">
                {group.map((item, idx) => (
                  <React.Fragment key={item.id}>
                    {idx > 0 && <InkHairline inset={44} />}
                    {renderAchievementRow(item)}
                  </React.Fragment>
                ))}
              </InkCard>
            </React.Fragment>
          ))}

          {filtered.length === 0 && (
            <InkCard>
              <InkEmpty text="当前条件下还没有成就记录，可在底部随手添加。" />
            </InkCard>
          )}
        </>
      )}

      {/* ─────────────────────────── Vertical Progression Tree View ─────────────────────────── */}
      {viewMode === "tree" && (
        <>
          {trees.length === 0 && unlinked.length === 0 && (
            <InkCard>
              <InkEmpty text="当前条件下还没有成就记录。" />
            </InkCard>
          )}

          {trees.map((comp, treeIdx) => {
            const layers = layoutTreeLayers(comp);
            const compDone = comp.filter((i) => i.completed).length;
            const rootNode = layers[0]?.[0];
            const tailNode = layers.at(-1)?.at(-1);
            const chainTitle =
              rootNode?.category ||
              rootNode?.title ||
              `进阶路线 ${treeIdx + 1}`;
            return (
              <InkCard key={comp[0]?.id ?? treeIdx}>
                <div className="ma-tree-head">
                  <span className="ma-tree-title">{chainTitle}</span>
                  <span className="ma-tree-count">
                    {compDone}/{comp.length} 已达成
                  </span>
                </div>

                <div className="ma-tree-layers">
                  {layers.map((tierItems, tierIdx) => {
                    const tierAllDone = tierItems.every((i) => i.completed);
                    const tierAnyDone = tierItems.some((i) => i.completed);
                    return (
                      <div className="ma-tier" key={tierIdx}>
                        <div className="ma-tier-rail">
                          <span
                            className={
                              "ma-tier-line" + (tierIdx === 0 ? " hidden" : "")
                            }
                          />
                          <span
                            className={
                              "ma-tier-dot" +
                              (tierAllDone
                                ? " done"
                                : tierAnyDone
                                  ? " partial"
                                  : "")
                            }
                          />
                          <span
                            className={
                              "ma-tier-line" +
                              (tierIdx === layers.length - 1 ? " hidden" : "")
                            }
                          />
                        </div>
                        <div className="ma-tier-body">
                          <span className="ma-tier-label">
                            第 {tierIdx + 1} 阶
                          </span>
                          {tierItems.map((node) => {
                            const prevTitles = node.prevIds
                              .map((pid) => byId.get(pid)?.title)
                              .filter(Boolean)
                              .join("、");
                            const cur = node.completed
                              ? node.target
                              : node.current;
                            const nodeRatio =
                              node.target > 1
                                ? Math.min(1, cur / node.target)
                                : node.completed
                                  ? 1
                                  : 0;
                            return (
                              <button
                                key={node.id}
                                type="button"
                                className="ma-tree-node"
                                onClick={() => setSelectedId(node.id)}
                              >
                                <EmblemTile
                                  icon={node.icon}
                                  done={node.completed}
                                  size="sm"
                                />
                                <span className="ma-tree-node-main">
                                  <span className="ma-tree-node-title">
                                    {node.title}
                                  </span>
                                  <span className="ma-tree-node-meta">
                                    {node.completed
                                      ? `已完成${node.completedAt ? ` · ${node.completedAt}` : ""}`
                                      : node.target > 1
                                        ? `${formatNum(cur)} / ${formatNum(node.target)} ${node.unit}`
                                        : prevTitles
                                          ? `前置：${prevTitles}`
                                          : "未完成"}
                                  </span>
                                  {node.target > 1 && (
                                    <InkMeter
                                      progress={nodeRatio}
                                      tone={
                                        node.completed ? "live" : "default"
                                      }
                                    />
                                  )}
                                </span>
                                <span className="mk-row-chevron">
                                  <Icon name="chevron-right" size={14} />
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {tailNode && (
                  <button
                    type="button"
                    className="mk-text-btn accent"
                    onClick={() => openCreate(tailNode.id)}
                  >
                    <Icon name="plus" size={14} />
                    <span>延伸下一阶成就</span>
                  </button>
                )}
              </InkCard>
            );
          })}

          {unlinked.length > 0 && (
            <>
              <InkSectionLabel
                title="独立成就（未串联前置）"
                aside={`${unlinked.length} 项`}
              />
              <InkCard variant="compact">
                {unlinked.map((item, idx) => (
                  <React.Fragment key={item.id}>
                    {idx > 0 && <InkHairline inset={44} />}
                    {renderAchievementRow(item)}
                  </React.Fragment>
                ))}
              </InkCard>
            </>
          )}
        </>
      )}

      {/* Pinned Bottom Quick-Add Composer (1:1 with Achievements.swift) */}
      <InkComposer
        value={quickTitle}
        onChange={setQuickTitle}
        placeholder={
          scopeFilter === "annual"
            ? "记下一个今年想完成的目标…"
            : "记下一个想完成的人生成就…"
        }
        onSubmit={handleQuickAdd}
      />

      {/* ─────────────────────────── Filter Sheet ─────────────────────────── */}
      <InkSheet
        open={filterOpen}
        title="筛选与板块"
        onClose={() => setFilterOpen(false)}
        leftLabel="完成"
        rightLabel={hasActiveFilter ? "清除" : undefined}
        onRight={hasActiveFilter ? clearFilters : undefined}
      >
        <InkSearch
          value={search}
          onChange={setSearch}
          placeholder="搜索标题、描述或记录…"
        />

        <div className="ma-sheet-sec-label">跨度</div>
        <div className="mk-flow-chips">
          {(
            [
              ["all", `全部 (${items.length})`],
              ["lifetime", `人生成就 (${lifetimeAll.length})`],
              ["annual", `年度成就 (${annualAll.length})`],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              className={"mk-chip sm" + (scopeFilter === val ? " active" : "")}
              onClick={() => setScopeFilter(val)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ma-sheet-sec-label">状态</div>
        <div className="mk-flow-chips">
          {(
            [
              ["all", "全部状态"],
              ["pending", "未完成"],
              ["done", "已完成"],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              className={
                "mk-chip sm" + (statusFilter === val ? " active" : "")
              }
              onClick={() => setStatusFilter(val)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ma-sheet-sec-label">板块</div>
        <div className="mk-flow-chips">
          <button
            type="button"
            className={
              "mk-chip sm" + (categoryFilter === "all" ? " active" : "")
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
            return (
              <button
                key={cat}
                type="button"
                className={
                  "mk-chip sm" + (categoryFilter === cat ? " active" : "")
                }
                onClick={() => setCategoryFilter(cat)}
              >
                <span>{cat}</span>
                <span className="mk-chip-count">
                  {done}/{list.length}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="mk-pill full"
          onClick={() => {
            setFilterOpen(false);
            setCatSheetOpen(true);
          }}
        >
          <Icon name="tag" size={15} />
          <span>管理板块分类</span>
        </button>
      </InkSheet>

      {/* ─────────────────────────── Detail & Progress Sheet ─────────────────────────── */}
      {selectedItem && (
        <AchievementDetailSheet
          item={selectedItem}
          allItems={items}
          onClose={() => setSelectedId(null)}
          onSelectOther={(otherId) => setSelectedId(otherId)}
          onPatch={(patch) => savePatch(selectedItem, patch)}
          onEdit={() => {
            const target = selectedItem;
            setSelectedId(null);
            setEditorConfig({
              record: target,
              defaultScope: target.scope,
              defaultCategory: target.category,
            });
          }}
          onAppendNext={() => {
            const target = selectedItem;
            setSelectedId(null);
            setEditorConfig({
              defaultScope: target.scope,
              defaultCategory: target.category,
              defaultPrevId: target.id,
            });
          }}
          onDelete={() => {
            const target = selectedItem;
            setSelectedId(null);
            perform(remove(target.entity));
          }}
        />
      )}

      {/* ─────────────────────────── Create / Edit Sheet ─────────────────────────── */}
      {editorConfig && (
        <AchievementEditorSheet
          config={editorConfig}
          categories={categories}
          allItems={items}
          onEnsureCategory={ensureCategory}
          onClose={() => setEditorConfig(null)}
        />
      )}

      {/* ─────────────────────────── Categories Manager Sheet ─────────────────────────── */}
      {catSheetOpen && (
        <CategoriesSheet
          categories={categories}
          allItems={items}
          onClose={() => setCatSheetOpen(false)}
          onAdd={(name) => ensureCategory(name)}
          onRename={(oldName, newName) => {
            const next = categories.map((c) => (c === oldName ? newName : c));
            setCustomCategories([...new Set(next)]);
            if (categoryFilter === oldName) setCategoryFilter(newName);
            perform(
              (async () => {
                for (const item of items) {
                  if (item.category === oldName) {
                    await put(
                      "achievement",
                      toPayload({ ...item, category: newName }),
                      { id: item.id },
                    );
                  }
                }
              })(),
            );
          }}
          onDelete={(name) => {
            setCustomCategories(categories.filter((c) => c !== name));
            if (categoryFilter === name) setCategoryFilter("all");
            perform(
              (async () => {
                for (const item of items) {
                  if (item.category === name) {
                    await put(
                      "achievement",
                      toPayload({ ...item, category: "" }),
                      { id: item.id },
                    );
                  }
                }
              })(),
            );
          }}
        />
      )}
    </InkScreen>
  );
}

/* ─────────────────────────── Achievement Detail & Progress Sheet ─────────────────────────── */

function AchievementDetailSheet({
  item,
  allItems,
  onClose,
  onSelectOther,
  onPatch,
  onEdit,
  onAppendNext,
  onDelete,
}: {
  item: Achievement;
  allItems: Achievement[];
  onClose: () => void;
  onSelectOther: (id: string) => void;
  onPatch: (patch: Partial<Achievement>) => void;
  onEdit: () => void;
  onAppendNext: () => void;
  onDelete: () => void;
}) {
  const [progressInput, setProgressInput] = useState(String(item.current));
  const [completedAt, setCompletedAt] = useState(item.completedAt ?? today());
  const [note, setNote] = useState(item.note);
  const [savedToast, setSavedToast] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setProgressInput(String(item.completed ? item.target : item.current));
    setCompletedAt(item.completedAt ?? today());
    setNote(item.note);
    setSavedToast(false);
    setConfirmDelete(false);
  }, [item.id, item.current, item.completed, item.completedAt, item.note, item.target]);

  const byId = useMemo(
    () => new Map(allItems.map((i) => [i.id, i])),
    [allItems],
  );

  const prevItems = useMemo(
    () =>
      item.prevIds
        .map((id) => byId.get(id))
        .filter((x): x is Achievement => Boolean(x)),
    [item.prevIds, byId],
  );

  const nextItems = useMemo(
    () => allItems.filter((other) => other.prevIds.includes(item.id)),
    [allItems, item.id],
  );

  // Full vertical progression chain (ancestors + self + descendants)
  const progressionChain = useMemo(() => {
    const ancestors: Achievement[] = [];
    const seen = new Set<string>([item.id]);
    let curr = item;
    while (true) {
      const pid = curr.prevIds.find((id) => byId.has(id) && !seen.has(id));
      if (!pid) break;
      const parent = byId.get(pid)!;
      seen.add(pid);
      ancestors.unshift(parent);
      curr = parent;
    }
    const descendants: Achievement[] = [];
    let tail = item;
    while (true) {
      const child = allItems.find(
        (other) => other.prevIds.includes(tail.id) && !seen.has(other.id),
      );
      if (!child) break;
      seen.add(child.id);
      descendants.push(child);
      tail = child;
    }
    const chain = [...ancestors, item, ...descendants];
    return chain.length > 1 ? chain : [];
  }, [item, allItems, byId]);

  const current = item.completed ? item.target : item.current;
  const ratio =
    item.target > 1
      ? Math.min(1, current / item.target)
      : item.completed
        ? 1
        : 0;

  const applyProgress = (nextVal: number) => {
    if (!Number.isFinite(nextVal)) return;
    const clamped = Math.max(0, Number(nextVal.toFixed(2)));
    const reached = item.target > 1 && clamped >= item.target;
    setProgressInput(String(clamped));
    onPatch({
      current: clamped,
      ...(reached && !item.completed
        ? { completed: true, completedAt: completedAt || today() }
        : !reached && item.completed
          ? { completed: false }
          : {}),
    });
  };

  const toggleComplete = () => {
    if (item.completed) {
      onPatch({ completed: false });
    } else {
      const day = completedAt || today();
      setCompletedAt(day);
      onPatch({
        completed: true,
        completedAt: day,
        current: item.target > 1 ? item.target : 1,
      });
    }
  };

  const saveRecord = () => {
    onPatch({
      note: note.trim(),
      ...(completedAt ? { completedAt } : {}),
    });
    setSavedToast(true);
  };

  const parsedInput = Number(progressInput.trim());

  return (
    <InkSheet
      open
      title="成就详情"
      onClose={onClose}
      leftLabel="关闭"
      rightLabel="编辑"
      onRight={onEdit}
    >
      {/* Hero & Complete Toggle */}
      <div className="ma-detail-card">
        <div className="ma-detail-hero">
          <EmblemTile icon={item.icon} done={item.completed} size="lg" />
          <div className="ma-detail-head-copy">
            <div className="ma-detail-pills">
              <span className="ma-detail-pill">
                {item.scope === "annual"
                  ? `${item.year} 年度成就`
                  : "人生成就"}
              </span>
              {item.category && (
                <span className="ma-detail-pill">{item.category}</span>
              )}
            </div>
            <h3 className="ma-detail-title">{item.title}</h3>
            {item.description && (
              <p className="ma-detail-desc">{item.description}</p>
            )}
          </div>
        </div>

        <InkHairline />

        <div className="ma-toggle-row">
          <div className="ma-toggle-copy">
            <strong>
              {item.completed
                ? `已达成 · ${item.completedAt || today()}`
                : "尚未完成"}
            </strong>
            <small>
              {item.target > 1
                ? `当前 ${formatNum(current)} / ${formatNum(item.target)} ${item.unit}`
                : "完成时点击右侧确认，并可记下当时感想"}
            </small>
          </div>
          <button
            type="button"
            className={"mk-pill sm" + (item.completed ? "" : " solid")}
            onClick={toggleComplete}
          >
            {item.completed ? "撤销完成" : "确认完成"}
          </button>
        </div>
      </div>

      {/* Numeric Progress Card (quick +1 & custom update) */}
      {item.target > 1 && (
        <div className="ma-detail-card">
          <div className="ma-prog-bar-row">
            <span className="ma-hero-label">
              当前进度 · {Math.round(ratio * 100)}%
            </span>
            <span className="ma-hero-unit">
              {formatNum(current)} / {formatNum(item.target)} {item.unit}
            </span>
          </div>
          <InkMeter
            progress={ratio}
            tone={item.completed ? "live" : "default"}
          />
          <div className="ma-prog-input-group">
            <button
              type="button"
              className="mk-pill sm"
              onClick={() => applyProgress(current + 1)}
            >
              +1 {item.unit}
            </button>
            <input
              type="number"
              inputMode="decimal"
              className="ma-prog-input"
              aria-label="自定义当前进度"
              placeholder="输入数值"
              value={progressInput}
              onChange={(e) => setProgressInput(e.target.value)}
            />
            <button
              type="button"
              className="mk-pill sm solid"
              disabled={!progressInput.trim() || !Number.isFinite(parsedInput)}
              onClick={() => applyProgress(parsedInput)}
            >
              更新
            </button>
          </div>
        </div>
      )}

      {/* Completion Date & Note */}
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">完成日期</span>
          <input
            type="date"
            className="mk-form-input right"
            value={completedAt}
            onChange={(e) => setCompletedAt(e.target.value)}
          />
        </div>
        <div className="mk-form-row col">
          <span className="mk-form-label">完成记录 / 感想</span>
          <textarea
            className="mk-form-textarea"
            placeholder="记下真正完成那一刻的经过、时间细节或感受…"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setSavedToast(false);
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="mk-pill sm solid"
              onClick={saveRecord}
            >
              {savedToast ? "已保存" : "保存记录"}
            </button>
          </div>
        </div>
      </div>

      {/* Prerequisites / Next / Vertical Ladder */}
      <div className="ma-detail-card">
        <div className="ma-tree-head">
          <span className="ma-tree-title">进阶路线</span>
          <span className="ma-tree-count">
            {progressionChain.length > 0
              ? `共 ${progressionChain.length} 阶`
              : "独立成就"}
          </span>
        </div>

        {progressionChain.length > 0 ? (
          <div>
            {progressionChain.map((step, idx) => {
              const isCurr = step.id === item.id;
              return (
                <button
                  key={step.id}
                  type="button"
                  className="ma-ladder-step"
                  onClick={() => {
                    if (!isCurr) onSelectOther(step.id);
                  }}
                >
                  <span
                    className={
                      "ma-tier-dot" +
                      (step.completed ? " done" : isCurr ? " partial" : "")
                    }
                  />
                  <span className="ma-ladder-idx">{idx + 1}.</span>
                  <span
                    className={"ma-ladder-title" + (isCurr ? " current" : "")}
                  >
                    {step.title}
                  </span>
                  <span className="ma-ladder-status">
                    {step.completed ? step.completedAt || "已完成" : "未完成"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="ma-detail-desc" style={{ color: "var(--text-3)" }}>
            当前为独立成就，可在下方串联下一阶目标。
          </p>
        )}

        {(prevItems.length > 1 || nextItems.length > 1) && (
          <>
            <InkHairline />
            {prevItems.length > 0 && (
              <div className="mk-flow-chips">
                {prevItems.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="mk-chip sm"
                    onClick={() => onSelectOther(p.id)}
                  >
                    前置：{p.title}
                  </button>
                ))}
              </div>
            )}
            {nextItems.length > 0 && (
              <div className="mk-flow-chips">
                {nextItems.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className="mk-chip sm"
                    onClick={() => onSelectOther(n.id)}
                  >
                    后续：{n.title}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <button
          type="button"
          className="mk-text-btn accent"
          style={{ alignSelf: "flex-start" }}
          onClick={onAppendNext}
        >
          <Icon name="plus" size={14} />
          <span>在此之后延伸下一阶成就</span>
        </button>
      </div>

      {/* Delete */}
      <button
        type="button"
        className="mk-pill danger full"
        onClick={() => {
          if (!confirmDelete) {
            setConfirmDelete(true);
            return;
          }
          onDelete();
        }}
      >
        {confirmDelete ? "再次点击确认删除此成就" : "删除此成就"}
      </button>
    </InkSheet>
  );
}

/* ─────────────────────────── Create / Edit Achievement Sheet ─────────────────────────── */

function AchievementEditorSheet({
  config,
  categories,
  allItems,
  onEnsureCategory,
  onClose,
}: {
  config: EditorConfig;
  categories: string[];
  allItems: Achievement[];
  onEnsureCategory: (cat: string) => void;
  onClose: () => void;
}) {
  const rec = config.record;
  const [title, setTitle] = useState(rec?.title ?? "");
  const [description, setDescription] = useState(rec?.description ?? "");
  const [scope, setScope] = useState<AchievementScope>(
    rec?.scope ?? config.defaultScope,
  );
  const [year, setYear] = useState(rec?.year ?? today().slice(0, 4));
  const [category, setCategory] = useState(
    rec?.category ?? config.defaultCategory,
  );
  const [icon, setIcon] = useState(rec?.icon ?? "check");
  const [hasTarget, setHasTarget] = useState((rec?.target ?? 1) > 1);
  const [currentText, setCurrentText] = useState(String(rec?.current ?? 0));
  const [targetText, setTargetText] = useState(
    String((rec?.target ?? 1) > 1 ? rec!.target : 10),
  );
  const [unit, setUnit] = useState(rec?.unit ?? "次");
  const [prevId, setPrevId] = useState(
    rec?.prevIds[0] ?? config.defaultPrevId ?? "",
  );
  const [note, setNote] = useState(rec?.note ?? "");

  const prevCandidates = useMemo(
    () =>
      allItems.filter((candidate) => {
        if (rec && candidate.id === rec.id) return false;
        if (rec && wouldCycle(allItems, candidate.id, rec.id)) return false;
        return true;
      }),
    [allItems, rec],
  );

  const save = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const parsedTarget = Number(targetText.replace(/,/g, ""));
    const parsedCurrent = Number(currentText.replace(/,/g, ""));
    const targetVal = hasTarget
      ? Math.max(2, Number.isFinite(parsedTarget) ? parsedTarget : 10)
      : 1;
    const currentVal = hasTarget
      ? Math.max(0, Number.isFinite(parsedCurrent) ? parsedCurrent : 0)
      : rec?.completed
        ? 1
        : 0;

    const trimmedCat = category.trim();
    if (trimmedCat) onEnsureCategory(trimmedCat);

    const payload: EntityData<"achievement"> = {
      title: trimmedTitle,
      description: description.trim(),
      scope,
      ...(scope === "annual"
        ? { year: year.trim() || today().slice(0, 4) }
        : {}),
      category: trimmedCat,
      icon,
      prevIds: prevId ? [prevId] : [],
      current: currentVal,
      target: targetVal,
      unit: unit.trim() || "次",
      completed: rec?.completed ?? false,
      ...(rec?.completedAt ? { completedAt: rec.completedAt } : {}),
      note: note.trim(),
    };

    perform(put("achievement", payload, rec ? { id: rec.id } : undefined).then(onClose));
  };

  return (
    <InkSheet
      open
      title={rec ? "编辑成就" : "新建成就"}
      onClose={onClose}
      rightLabel="保存"
      rightDisabled={!title.trim()}
      onRight={save}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">名称</span>
          <input
            className="mk-form-input right"
            placeholder="例如：第一次去国外旅行"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus={!rec}
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">标准</span>
          <input
            className="mk-form-input right"
            placeholder="具体标准（选填）"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">类型</span>
          <select
            className="mk-form-select"
            value={scope}
            onChange={(e) => setScope(e.target.value as AchievementScope)}
          >
            <option value="lifetime">人生成就</option>
            <option value="annual">年度成就</option>
          </select>
        </div>
        {scope === "annual" && (
          <div className="mk-form-row">
            <span className="mk-form-label">年份</span>
            <input
              type="text"
              inputMode="numeric"
              className="mk-form-input right"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
        )}
        <div className="mk-form-row">
          <span className="mk-form-label">板块</span>
          <input
            className="mk-form-input right"
            placeholder="输入或下方点选（选填）"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>
        {categories.length > 0 && (
          <div className="mk-form-row col">
            <div className="mk-flow-chips">
              <button
                type="button"
                className={"mk-chip sm" + (!category ? " active" : "")}
                onClick={() => setCategory("")}
              >
                无分类
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={"mk-chip sm" + (category === c ? " active" : "")}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Numeric Target Progress */}
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">需要累计数值进度</span>
          <InkSwitch
            checked={hasTarget}
            onChange={setHasTarget}
            label="需要累计数值进度"
          />
        </div>
        {hasTarget && (
          <>
            <div className="mk-form-row">
              <span className="mk-form-label">当前进度</span>
              <input
                type="number"
                inputMode="decimal"
                className="mk-form-input right"
                value={currentText}
                onChange={(e) => setCurrentText(e.target.value)}
              />
            </div>
            <div className="mk-form-row">
              <span className="mk-form-label">目标数值</span>
              <input
                type="number"
                inputMode="decimal"
                className="mk-form-input right"
                value={targetText}
                onChange={(e) => setTargetText(e.target.value)}
              />
            </div>
            <div className="mk-form-row">
              <span className="mk-form-label">单位</span>
              <input
                className="mk-form-input right"
                placeholder="公里 / 本 / 天"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
          </>
        )}
      </div>

      {/* Icon Picker */}
      <div className="ma-detail-card">
        <span className="ma-sheet-sec-label">图标</span>
        <div className="ma-icon-grid">
          {ACH_ICONS.map((def) => (
            <button
              key={def.key}
              type="button"
              className={"ma-icon-opt" + (icon === def.key ? " active" : "")}
              onClick={() => setIcon(def.key)}
            >
              <span className="ma-icon-opt-box">
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {def.svg}
                </svg>
              </span>
              <small>{def.label}</small>
            </button>
          ))}
        </div>
      </div>

      {/* Prerequisite & Note */}
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">前置成就</span>
          <select
            className="mk-form-select"
            value={prevId}
            onChange={(e) => setPrevId(e.target.value)}
          >
            <option value="">不串联（独立成就）</option>
            {prevCandidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div className="mk-form-row col">
          <span className="mk-form-label">备注</span>
          <textarea
            className="mk-form-textarea"
            placeholder="补充说明…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
    </InkSheet>
  );
}

/* ─────────────────────────── Categories Manager Sheet ─────────────────────────── */

function CategoriesSheet({
  categories,
  allItems,
  onClose,
  onAdd,
  onRename,
  onDelete,
}: {
  categories: string[];
  allItems: Achievement[];
  onClose: () => void;
  onAdd: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  return (
    <InkSheet open title="板块管理" onClose={onClose} leftLabel="完成">
      <div className="ma-cat-add-row">
        <input
          className="mk-field-input"
          placeholder="输入自定义板块名…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          type="button"
          className="mk-pill solid"
          disabled={!newName.trim()}
          onClick={() => {
            const trimmed = newName.trim();
            if (!trimmed) return;
            onAdd(trimmed);
            setNewName("");
          }}
        >
          添加
        </button>
      </div>

      <div className="mk-form-group">
        {categories.length === 0 ? (
          <div style={{ padding: "12px" }}>
            <InkEmpty text="暂无自定义板块" />
          </div>
        ) : (
          categories.map((cat) => {
            const count = allItems.filter((i) => i.category === cat).length;
            if (renaming === cat) {
              return (
                <div className="ma-cat-manage-row" key={cat}>
                  <input
                    className="mk-form-input"
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="mk-pill sm solid"
                    onClick={() => {
                      const trimmed = renameText.trim();
                      if (trimmed && trimmed !== cat) onRename(cat, trimmed);
                      setRenaming(null);
                    }}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    className="mk-text-btn"
                    onClick={() => setRenaming(null)}
                  >
                    取消
                  </button>
                </div>
              );
            }
            return (
              <div className="ma-cat-manage-row" key={cat}>
                <div className="mk-row-main">
                  <span className="mk-row-title clamp-1">{cat}</span>
                  <span className="mk-row-sub">{count} 项成就</span>
                </div>
                <div style={{ display: "flex", gap: "8px", flex: "none" }}>
                  <button
                    type="button"
                    className="mk-text-btn accent"
                    onClick={() => {
                      setRenaming(cat);
                      setRenameText(cat);
                    }}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    className="mk-text-btn danger"
                    onClick={() => onDelete(cat)}
                  >
                    删除
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </InkSheet>
  );
}
