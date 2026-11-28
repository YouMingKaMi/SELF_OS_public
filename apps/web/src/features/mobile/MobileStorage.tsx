import React, { useEffect, useMemo, useState } from "react";
import {
  put,
  remove,
  saveEdit,
  synchronize,
  useEntities,
  type AnyEntity as Entity,
} from "../../data/entities.ts";
import { Icon } from "../../ui/Icon.tsx";
import { num, perform, str, usePreference } from "../../ui/shared.tsx";
import {
  BUILTIN_ITEM_ICONS,
  ICON_GROUPS,
  ItemVisual,
  iconLabel,
  isBuiltinItemIcon,
  type IconGroup,
} from "../storage-icons.tsx";
import {
  InkActionSheet,
  InkCard,
  InkChipBar,
  InkComposer,
  InkEmpty,
  InkHairline,
  InkNavIcon,
  InkScreen,
  InkSearch,
  InkSectionLabel,
  InkSegmented,
  InkSheet,
  MobileSubPage,
  MobileToolbar,
} from "./MobileKit.tsx";
import "./mobile-storage.css";

type BoxIconKey =
  | "chest"
  | "drawer"
  | "bag"
  | "box"
  | "suitcase"
  | "medkit"
  | "tools"
  | "folder";

const BOX_ICONS: readonly {
  key: BoxIconKey;
  label: string;
  svg: React.ReactNode;
}[] = [
  {
    key: "chest",
    label: "储物箱",
    svg: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18M10 10v3h4v-3" />
      </>
    ),
  },
  {
    key: "drawer",
    label: "抽屉",
    svg: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 12h18M10 8h4M10 16h4" />
      </>
    ),
  },
  {
    key: "bag",
    label: "背包",
    svg: (
      <>
        <path d="M5 10a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" />
        <path d="M9 5V4a3 3 0 0 1 6 0v1M8 14h8v6H8Z" />
      </>
    ),
  },
  {
    key: "box",
    label: "收纳盒",
    svg: (
      <>
        <path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8" />
        <rect x="2" y="4" width="20" height="4" rx="1" />
        <path d="M10 12h4" />
      </>
    ),
  },
  {
    key: "suitcase",
    label: "行李箱",
    svg: (
      <>
        <rect x="5" y="7" width="14" height="14" rx="2" />
        <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M9 11v6M15 11v6" />
      </>
    ),
  },
  {
    key: "tools",
    label: "工具数码",
    svg: (
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
    ),
  },
  {
    key: "medkit",
    label: "医药箱",
    svg: (
      <>
        <rect x="3" y="6" width="18" height="14" rx="2" />
        <path d="M9 6V4h6v2M12 10v6M9 13h6" />
      </>
    ),
  },
  {
    key: "folder",
    label: "证件袋",
    svg: (
      <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    ),
  },
];

const DEFAULT_ZONES = ["随身", "宿舍", "家里"] as const;

type FlatBoxOption = {
  box: Entity;
  depth: number;
  path: string;
  fullLabel: string;
};

function BoxGlyph({ icon, size = 18 }: { icon?: string; size?: number }) {
  const def = BOX_ICONS.find((b) => b.key === icon) ?? BOX_ICONS[0]!;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {def.svg}
    </svg>
  );
}

function formatElapsed(iso?: string): { text: string; stale: boolean } {
  if (!iso) return { text: "已取出", stale: false };
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return { text: "刚刚取出", stale: false };
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return { text: "刚刚取出", stale: false };
  if (mins < 60) return { text: `${mins} 分钟前取出`, stale: false };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { text: `${hours} 小时前取出`, stale: hours >= 12 };
  const days = Math.floor(hours / 24);
  return { text: `${days} 天前取出`, stale: true };
}

function formatVerified(iso?: string): string {
  if (!iso) return "尚未核对";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "尚未核对";
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function sortBoxes(list: Entity[]): Entity[] {
  return [...list].sort((a, b) => {
    const za = str(a, "zone");
    const zb = str(b, "zone");
    const ia = DEFAULT_ZONES.indexOf(za as (typeof DEFAULT_ZONES)[number]);
    const ib = DEFAULT_ZONES.indexOf(zb as (typeof DEFAULT_ZONES)[number]);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    if (za !== zb) return za.localeCompare(zb, "zh-CN");
    const oa = typeof a.data.order === "number" ? a.data.order : 9999;
    const ob = typeof b.data.order === "number" ? b.data.order : 9999;
    if (oa !== ob) return oa - ob;
    return str(a, "name").localeCompare(str(b, "name"), "zh-CN");
  });
}

function sortItems(list: Entity[]): Entity[] {
  return [...list].sort((a, b) => {
    const sa = a.data.status === "out" ? 1 : 0;
    const sb = b.data.status === "out" ? 1 : 0;
    if (sa !== sb) return sa - sb;
    return str(a, "name").localeCompare(str(b, "name"), "zh-CN");
  });
}

export function MobileStorage() {
  const { entities } = useEntities("storageBox", "storageItem");

  const [query, setQuery] = useState("");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [boxStack, setBoxStack] = useState<string[]>([]);
  const [viewMode, setViewMode] = usePreference<"grid" | "list">(
    "storage-mobile-view",
    "grid",
  );
  const [quickDraft, setQuickDraft] = useState("");

  // Sheets & Menus
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [boxMenuOpen, setBoxMenuOpen] = useState(false);
  const [boxSheet, setBoxSheet] = useState<{
    open: boolean;
    mode: "create" | "edit";
    box?: Entity;
    defaultParentId?: string;
  }>({ open: false, mode: "create" });
  const [itemSheet, setItemSheet] = useState<{
    open: boolean;
    item: Entity | null;
    defaultBoxId: string;
  }>({ open: false, item: null, defaultBoxId: "" });
  const [moveTargetItem, setMoveTargetItem] = useState<Entity | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const boxes = useMemo(
    () => sortBoxes(entities.filter((e) => e.type === "storageBox" && !e.deleted)),
    [entities],
  );

  const items = useMemo(
    () =>
      entities
        .filter((e) => e.type === "storageItem" && !e.deleted)
        .sort((a, b) => str(a, "name").localeCompare(str(b, "name"), "zh-CN")),
    [entities],
  );

  const boxById = useMemo(
    () => new Map(boxes.map((b) => [b.id, b])),
    [boxes],
  );

  const itemById = useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items],
  );

  const childrenMap = useMemo(() => {
    const map = new Map<string, Entity[]>();
    for (const b of boxes) {
      const pid = str(b, "parentId");
      if (!pid || !boxById.has(pid)) continue;
      const list = map.get(pid) ?? [];
      list.push(b);
      map.set(pid, list);
    }
    return map;
  }, [boxes, boxById]);

  const rootBoxes = useMemo(
    () =>
      boxes.filter((b) => {
        const pid = str(b, "parentId");
        return !pid || !boxById.has(pid);
      }),
    [boxes, boxById],
  );

  const itemsByBox = useMemo(() => {
    const map = new Map<string, Entity[]>();
    for (const item of items) {
      const bid = str(item, "boxId");
      if (!bid) continue;
      const list = map.get(bid) ?? [];
      list.push(item);
      map.set(bid, list);
    }
    return map;
  }, [items]);

  const rootOf = (boxId: string): Entity | undefined => {
    let cur = boxById.get(boxId);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const pid = str(cur, "parentId");
      if (!pid || !boxById.has(pid)) return cur;
      cur = boxById.get(pid);
    }
    return cur;
  };

  const boxPath = (boxId?: string): string => {
    if (!boxId) return "未指定箱子";
    const parts: string[] = [];
    let cur = boxById.get(boxId);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(str(cur, "name"));
      const pid = str(cur, "parentId");
      cur = pid ? boxById.get(pid) : undefined;
    }
    return parts.join(" / ") || "未知箱子";
  };

  const boxLabel = (boxId?: string): string => {
    if (!boxId) return "未指定箱子";
    const root = rootOf(boxId);
    const z = root ? str(root, "zone") : "";
    const p = boxPath(boxId);
    return z ? `${z} · ${p}` : p;
  };

  const subtreeIds = (rootId: string): string[] => {
    const out: string[] = [];
    const queue = [rootId];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      for (const child of childrenMap.get(id) ?? []) {
        queue.push(child.id);
      }
    }
    return out;
  };

  const flatBoxOptions = useMemo<FlatBoxOption[]>(() => {
    const result: FlatBoxOption[] = [];
    const seen = new Set<string>();
    const visit = (box: Entity, depth: number) => {
      if (seen.has(box.id)) return;
      seen.add(box.id);
      result.push({
        box,
        depth,
        path: boxPath(box.id),
        fullLabel: boxLabel(box.id),
      });
      for (const child of childrenMap.get(box.id) ?? []) {
        visit(child, depth + 1);
      }
    };
    for (const root of rootBoxes) visit(root, 0);
    return result;
  }, [rootBoxes, childrenMap, boxById]);

  const zones = useMemo(() => {
    const list: string[] = [];
    for (const b of rootBoxes) {
      const z = str(b, "zone");
      if (z && !list.includes(z)) list.push(z);
    }
    return list;
  }, [rootBoxes]);

  const outItems = useMemo(
    () =>
      items
        .filter((i) => i.data.status === "out")
        .sort((a, b) => str(a, "takenAt").localeCompare(str(b, "takenAt"))),
    [items],
  );

  // Prune boxStack if a box was deleted on another device
  const validStack = useMemo(
    () => boxStack.filter((id) => boxById.has(id)),
    [boxStack, boxById],
  );
  const currentBoxId = validStack.at(-1) ?? null;
  const currentBox = currentBoxId ? (boxById.get(currentBoxId) ?? null) : null;
  const prevBoxId = validStack.length > 1 ? validStack[validStack.length - 2] : null;
  const prevBox = prevBoxId ? boxById.get(prevBoxId) : undefined;

  // Search results (matching items AND boxes)
  const needle = query.trim().toLowerCase();
  const searchBoxHits = useMemo(() => {
    if (!needle) return [];
    return boxes.filter((b) => {
      const hay = [
        str(b, "name"),
        str(b, "zone"),
        str(b, "location"),
        boxPath(b.id),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [boxes, needle, boxById]);

  const searchItemHits = useMemo(() => {
    if (!needle) return [];
    return items.filter((item) => {
      const bid = str(item, "boxId");
      const homeId = str(item, "homeBoxId");
      const b = boxById.get(bid);
      const hay = [
        str(item, "name"),
        str(item, "aliases"),
        str(item, "note"),
        bid ? boxLabel(bid) : "",
        b ? str(b, "location") : "",
        homeId ? boxLabel(homeId) : "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [items, needle, boxById]);

  const zoneChipItems = useMemo(() => {
    return [
      { value: "all", label: "全部", count: rootBoxes.length },
      ...zones.map((z) => ({
        value: z,
        label: z,
        count: rootBoxes.filter((b) => str(b, "zone") === z).length,
      })),
    ];
  }, [zones, rootBoxes]);

  const shownZoneGroups = useMemo(() => {
    const filtered =
      zoneFilter === "all"
        ? rootBoxes
        : rootBoxes.filter((b) => str(b, "zone") === zoneFilter);
    const groups: { zone: string; boxes: Entity[] }[] = [];
    for (const box of filtered) {
      const z = str(box, "zone") || "未分组";
      let g = groups.find((x) => x.zone === z);
      if (!g) {
        g = { zone: z, boxes: [] };
        groups.push(g);
      }
      g.boxes.push(box);
    }
    return groups;
  }, [rootBoxes, zoneFilter]);

  // Navigation helpers
  function openBoxByChain(boxId: string) {
    const chain: string[] = [];
    let cur = boxById.get(boxId);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur.id);
      const pid = str(cur, "parentId");
      cur = pid ? boxById.get(pid) : undefined;
    }
    if (chain.length > 0) {
      setBoxStack(chain);
      setQuickDraft("");
    }
  }

  function pushBox(boxId: string) {
    setBoxStack((prev) => [...prev.filter((id) => boxById.has(id)), boxId]);
    setQuickDraft("");
  }

  function popBox() {
    setBoxStack((prev) => prev.filter((id) => boxById.has(id)).slice(0, -1));
    setQuickDraft("");
  }

  // Item mutations
  function takeOut(item: Entity) {
    perform(
      saveEdit("storageItem", item.id, item.data, {
        ...item.data,
        status: "out",
        takenAt: new Date().toISOString(),
      }).then(() => {
        void synchronize();
        setToast(`已取出「${str(item, "name")}」`);
      }),
    );
  }

  function returnHome(item: Entity) {
    const targetId = str(item, "homeBoxId") || str(item, "boxId");
    if (!targetId || !boxById.has(targetId)) {
      setMoveTargetItem(item);
      return;
    }
    perform(
      saveEdit("storageItem", item.id, item.data, {
        ...item.data,
        status: "in_box",
        boxId: targetId,
        takenAt: null,
        verifiedAt: new Date().toISOString(),
      }).then(() => {
        void synchronize();
        setToast(`已放回「${boxPath(targetId)}」`);
      }),
    );
  }

  function moveToBox(item: Entity, targetBoxId: string) {
    perform(
      saveEdit("storageItem", item.id, item.data, {
        ...item.data,
        status: "in_box",
        boxId: targetBoxId,
        takenAt: null,
        verifiedAt: new Date().toISOString(),
      }).then(() => {
        void synchronize();
        setMoveTargetItem(null);
        setToast(`已移入「${boxPath(targetBoxId)}」`);
      }),
    );
  }

  function markVerified(item: Entity) {
    perform(
      saveEdit("storageItem", item.id, item.data, {
        ...item.data,
        verifiedAt: new Date().toISOString(),
      }).then(() => {
        void synchronize();
        setToast(`已核对「${str(item, "name")}」`);
      }),
    );
  }

  function quickAddItem(targetBoxId: string) {
    const clean = quickDraft.trim();
    if (!clean) return;
    setQuickDraft("");
    perform(
      put("storageItem", {
        name: clean,
        status: "in_box",
        boxId: targetBoxId,
        homeBoxId: targetBoxId,
        quantity: 1,
        verifiedAt: new Date().toISOString(),
      }).then(() => {
        void synchronize();
      }),
    );
  }

  function createStarterBox(
    zone: string,
    name: string,
    icon: BoxIconKey,
    location: string,
  ) {
    const id = crypto.randomUUID();
    perform(
      put("storageBox", { zone, name, icon, location }, { id }).then(() => {
        void synchronize();
        setBoxStack([id]);
      }),
    );
  }

  // Current Box Detail computed state
  const directSubBoxes = currentBox ? (childrenMap.get(currentBox.id) ?? []) : [];
  const directItems = useMemo(
    () => (currentBox ? sortItems(itemsByBox.get(currentBox.id) ?? []) : []),
    [currentBox, itemsByBox],
  );
  const subtreeItemCount = useMemo(() => {
    if (!currentBox) return 0;
    return subtreeIds(currentBox.id).reduce(
      (sum, id) => sum + (itemsByBox.get(id)?.length ?? 0),
      0,
    );
  }, [currentBox, itemsByBox, childrenMap]);

  const liveEditingItem = itemSheet.item
    ? (itemById.get(itemSheet.item.id) ?? itemSheet.item)
    : null;
  const liveMovingItem = moveTargetItem
    ? (itemById.get(moveTargetItem.id) ?? moveTargetItem)
    : null;

  return (
    <>
      {currentBox ? (
        <MobileSubPage
          title={str(currentBox, "name")}
          backLabel={prevBox ? str(prevBox, "name") : "储物箱"}
          onBack={popBox}
          right={
            <>
              <InkNavIcon
                icon={viewMode === "grid" ? "list" : "grid"}
                label={viewMode === "grid" ? "切换列表视图" : "切换网格视图"}
                onClick={() =>
                  setViewMode(viewMode === "grid" ? "list" : "grid")
                }
              />
              <InkNavIcon
                icon="ellipsis"
                label="箱子选项"
                onClick={() => setBoxMenuOpen(true)}
              />
              <InkNavIcon
                icon="plus"
                label="添加物品"
                onClick={() =>
                  setItemSheet({
                    open: true,
                    item: null,
                    defaultBoxId: currentBox.id,
                  })
                }
              />
            </>
          }
        >
          <InkScreen hasComposer>
            {(str(currentBox, "location") ||
              str(currentBox, "parentId") ||
              str(currentBox, "zone")) && (
              <div className="mst-detail-meta">
                {str(currentBox, "parentId")
                  ? boxLabel(currentBox.id)
                  : str(currentBox, "zone")}
                {str(currentBox, "location")
                  ? ` · ${str(currentBox, "location")}`
                  : ""}
              </div>
            )}

            {/* Sub-boxes / compartments strip */}
            {directSubBoxes.length > 0 && (
              <>
                <InkSectionLabel
                  title="子隔层"
                  aside={`${directSubBoxes.length} 个`}
                />
                <div className="mst-sub-strip">
                  {directSubBoxes.map((sub) => {
                    const count = subtreeIds(sub.id).reduce(
                      (n, id) => n + (itemsByBox.get(id)?.length ?? 0),
                      0,
                    );
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        className="mst-sub-chip"
                        onClick={() => pushBox(sub.id)}
                      >
                        <BoxGlyph icon={str(sub, "icon")} size={15} />
                        <span>{str(sub, "name")}</span>
                        <span className="mst-sub-chip-count">{count}</span>
                        <Icon name="chevron-right" size={13} />
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="mst-sub-chip-add"
                    onClick={() =>
                      setBoxSheet({
                        open: true,
                        mode: "create",
                        defaultParentId: currentBox.id,
                      })
                    }
                  >
                    <Icon name="plus" size={13} />
                    <span>添加隔层</span>
                  </button>
                </div>
              </>
            )}

            {/* Direct items inside current box */}
            {directItems.length === 0 ? (
              <InkCard>
                <InkEmpty
                  text={
                    directSubBoxes.length > 0
                      ? subtreeItemCount > 0
                        ? `共 ${subtreeItemCount} 件物品分布在上方子隔层中，轻点隔层查看，或在下方直接放入主箱`
                        : "轻点上方子隔层查看，或在下方输入物品名称放入主箱"
                      : "这里还是空的，在下方输入物品名即可放入，或点右上角「⋯」添加子隔层"
                  }
                />
              </InkCard>
            ) : (
              <>
                <InkSectionLabel
                  title={directSubBoxes.length > 0 ? "主箱物品" : "箱内物品"}
                  aside={`${directItems.length} 件`}
                />
                {viewMode === "grid" ? (
                  <div className="mst-grid">
                    {directItems.map((item) => {
                      const isOut = item.data.status === "out";
                      const qty = Math.max(1, num(item, "quantity", 1));
                      const homeId = str(item, "homeBoxId");
                      const away = !isOut && Boolean(homeId) && homeId !== currentBox.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={"mst-tile" + (isOut ? " out" : "")}
                          onClick={() =>
                            setItemSheet({
                              open: true,
                              item,
                              defaultBoxId: currentBox.id,
                            })
                          }
                        >
                          {isOut ? (
                            <span className="mst-tile-badge">在外</span>
                          ) : away ? (
                            <span className="mst-tile-dot" title="暂放此箱" />
                          ) : null}
                          {qty > 1 && (
                            <span className="mst-tile-qty">×{qty}</span>
                          )}
                          <span className="mst-tile-icon">
                            <ItemVisual
                              icon={str(item, "icon")}
                              name={str(item, "name")}
                              aliases={str(item, "aliases")}
                              boxPath={boxPath(currentBox.id)}
                              size={22}
                            />
                          </span>
                          <span className="mst-tile-name">
                            {str(item, "name")}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <InkCard variant="compact">
                    {directItems.map((item, idx) => {
                      const isOut = item.data.status === "out";
                      const qty = Math.max(1, num(item, "quantity", 1));
                      const homeId = str(item, "homeBoxId");
                      const away =
                        !isOut && Boolean(homeId) && homeId !== currentBox.id;
                      const elapsed = formatElapsed(str(item, "takenAt"));
                      return (
                        <React.Fragment key={item.id}>
                          <div
                            className="mk-row"
                            role="button"
                            tabIndex={0}
                            onClick={() =>
                              setItemSheet({
                                open: true,
                                item,
                                defaultBoxId: currentBox.id,
                              })
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setItemSheet({
                                  open: true,
                                  item,
                                  defaultBoxId: currentBox.id,
                                });
                              }
                            }}
                          >
                            <span
                              className={"mst-item-icon" + (isOut ? " out" : "")}
                            >
                              <ItemVisual
                                icon={str(item, "icon")}
                                name={str(item, "name")}
                                aliases={str(item, "aliases")}
                                boxPath={boxPath(currentBox.id)}
                                size={17}
                              />
                            </span>
                            <div className="mk-row-main">
                              <div className="mst-title-line">
                                <span
                                  className={
                                    "mk-row-title clamp-1" +
                                    (isOut ? " mst-title-out" : "")
                                  }
                                >
                                  {str(item, "name")}
                                </span>
                                {qty > 1 && (
                                  <span className="mst-qty">×{qty}</span>
                                )}
                              </div>
                              {isOut ? (
                                <span className="mk-row-sub warn">
                                  {elapsed.text}
                                </span>
                              ) : away ? (
                                <span className="mk-row-sub">
                                  常驻：{boxLabel(homeId)}
                                </span>
                              ) : str(item, "note") ? (
                                <span className="mk-row-sub">
                                  {str(item, "note")}
                                </span>
                              ) : null}
                            </div>
                            <span className="mk-row-right">
                              {isOut ? (
                                <button
                                  type="button"
                                  className="mk-pill sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    returnHome(item);
                                  }}
                                >
                                  放回
                                </button>
                              ) : (
                                <span className="mk-row-chevron">
                                  <Icon name="chevron-right" size={14} />
                                </span>
                              )}
                            </span>
                          </div>
                          {idx < directItems.length - 1 && (
                            <InkHairline inset={44} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </InkCard>
                )}
              </>
            )}

            <InkComposer
              value={quickDraft}
              onChange={setQuickDraft}
              onSubmit={() => quickAddItem(currentBox.id)}
              placeholder={`往「${str(currentBox, "name")}」放入物品…`}
            />
          </InkScreen>
        </MobileSubPage>
      ) : (
        <>
          <MobileToolbar>
            <InkNavIcon
              icon="plus"
              label="添加箱子或物品"
              onClick={() => {
                if (boxes.length === 0) {
                  setBoxSheet({ open: true, mode: "create" });
                } else {
                  setAddMenuOpen(true);
                }
              }}
            />
          </MobileToolbar>

          <InkScreen>
            <InkSearch
              value={query}
              onChange={setQuery}
              placeholder="搜索物品、别名、箱子…"
            />

            {needle ? (
              <>
                {searchBoxHits.length > 0 && (
                  <>
                    <InkSectionLabel
                      title="匹配的箱子"
                      aside={`${searchBoxHits.length} 个`}
                    />
                    <InkCard variant="compact">
                      {searchBoxHits.map((b, idx) => {
                        const count = subtreeIds(b.id).reduce(
                          (n, id) => n + (itemsByBox.get(id)?.length ?? 0),
                          0,
                        );
                        return (
                          <React.Fragment key={b.id}>
                            <button
                              type="button"
                              className="mk-row"
                              onClick={() => openBoxByChain(b.id)}
                            >
                              <span className="mst-box-icon">
                                <BoxGlyph icon={str(b, "icon")} size={17} />
                              </span>
                              <div className="mk-row-main">
                                <span className="mk-row-title clamp-1">
                                  {str(b, "name")}
                                </span>
                                <span className="mk-row-sub">
                                  {boxLabel(b.id)}
                                  {str(b, "location")
                                    ? ` · ${str(b, "location")}`
                                    : ""}
                                </span>
                              </div>
                              <span className="mk-row-right">
                                <small>{count} 件</small>
                                <span className="mk-row-chevron">
                                  <Icon name="chevron-right" size={14} />
                                </span>
                              </span>
                            </button>
                            {idx < searchBoxHits.length - 1 && (
                              <InkHairline inset={44} />
                            )}
                          </React.Fragment>
                        );
                      })}
                    </InkCard>
                  </>
                )}

                <InkSectionLabel
                  title="匹配的物品"
                  aside={`${searchItemHits.length} 件`}
                />
                {searchItemHits.length === 0 ? (
                  <InkCard>
                    <InkEmpty text="没有找到记录——是不是还没放进储物箱？" />
                  </InkCard>
                ) : (
                  <InkCard variant="compact">
                    {searchItemHits.map((item, idx) => {
                      const isOut = item.data.status === "out";
                      const bid = str(item, "boxId");
                      const homeId = str(item, "homeBoxId");
                      const away =
                        !isOut && Boolean(homeId) && homeId !== bid;
                      const qty = Math.max(1, num(item, "quantity", 1));
                      const elapsed = formatElapsed(str(item, "takenAt"));
                      return (
                        <React.Fragment key={item.id}>
                          <div
                            className="mk-row"
                            role="button"
                            tabIndex={0}
                            onClick={() =>
                              setItemSheet({
                                open: true,
                                item,
                                defaultBoxId: bid,
                              })
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setItemSheet({
                                  open: true,
                                  item,
                                  defaultBoxId: bid,
                                });
                              }
                            }}
                          >
                            <span
                              className={"mst-item-icon" + (isOut ? " out" : "")}
                            >
                              <ItemVisual
                                icon={str(item, "icon")}
                                name={str(item, "name")}
                                aliases={str(item, "aliases")}
                                boxPath={bid ? boxPath(bid) : ""}
                                size={17}
                              />
                            </span>
                            <div className="mk-row-main">
                              <div className="mst-title-line">
                                <span className="mk-row-title clamp-1">
                                  {str(item, "name")}
                                </span>
                                {qty > 1 && (
                                  <span className="mst-qty">×{qty}</span>
                                )}
                              </div>
                              <span
                                className={
                                  "mk-row-sub" +
                                  (isOut && elapsed.stale ? " warn" : "")
                                }
                              >
                                {isOut
                                  ? `${elapsed.text}${bid ? ` · 原在 ${boxLabel(bid)}` : ""}`
                                  : bid
                                    ? `${boxLabel(bid)}${away ? `（常驻：${boxPath(homeId)}）` : ""}`
                                    : "未指定箱子"}
                              </span>
                            </div>
                            <span className="mk-row-right">
                              <button
                                type="button"
                                className="mk-pill sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isOut) returnHome(item);
                                  else takeOut(item);
                                }}
                              >
                                {isOut ? "放回" : "取出"}
                              </button>
                            </span>
                          </div>
                          {idx < searchItemHits.length - 1 && (
                            <InkHairline inset={44} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </InkCard>
                )}
              </>
            ) : (
              <>
                {/* Out-of-box reminder strip */}
                {outItems.length > 0 && (
                  <div className="mst-warn-section">
                    <InkSectionLabel
                      title="在外未归位"
                      aside={`${outItems.length} 件`}
                    />
                    <InkCard variant="compact">
                      {outItems.map((item, idx) => {
                        const bid = str(item, "boxId");
                        const qty = Math.max(1, num(item, "quantity", 1));
                        const elapsed = formatElapsed(str(item, "takenAt"));
                        return (
                          <React.Fragment key={item.id}>
                            <div
                              className="mk-row"
                              role="button"
                              tabIndex={0}
                              onClick={() =>
                                setItemSheet({
                                  open: true,
                                  item,
                                  defaultBoxId: bid,
                                })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setItemSheet({
                                    open: true,
                                    item,
                                    defaultBoxId: bid,
                                  });
                                }
                              }}
                            >
                              <span className="mst-item-icon out">
                                <ItemVisual
                                  icon={str(item, "icon")}
                                  name={str(item, "name")}
                                  aliases={str(item, "aliases")}
                                  boxPath={bid ? boxPath(bid) : ""}
                                  size={17}
                                />
                              </span>
                              <div className="mk-row-main">
                                <div className="mst-title-line">
                                  <span className="mk-row-title clamp-1">
                                    {str(item, "name")}
                                  </span>
                                  {qty > 1 && (
                                    <span className="mst-qty">×{qty}</span>
                                  )}
                                </div>
                                <span
                                  className={
                                    "mk-row-sub" +
                                    (elapsed.stale ? " warn" : "")
                                  }
                                >
                                  {elapsed.text}
                                  {bid ? ` · 来自 ${boxPath(bid)}` : ""}
                                </span>
                              </div>
                              <span className="mk-row-right">
                                <button
                                  type="button"
                                  className="mk-pill sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    returnHome(item);
                                  }}
                                >
                                  放回
                                </button>
                              </span>
                            </div>
                            {idx < outItems.length - 1 && (
                              <InkHairline inset={44} />
                            )}
                          </React.Fragment>
                        );
                      })}
                    </InkCard>
                  </div>
                )}

                {/* Empty onboarding OR Zone chips + Box List */}
                {rootBoxes.length === 0 ? (
                  <InkCard>
                    <div className="mst-onboarding-title">
                      先摆几个现实里的“箱子”
                    </div>
                    <div className="mst-onboarding-sub">
                      先把装充电宝、耳机、数据线、证件的常用容器建起来，点进去还能再分隔层。
                    </div>
                    <div className="mst-starter-list">
                      {(
                        [
                          ["随身", "双肩包", "bag", "可再分前小袋 / 中层 / 大袋"],
                          ["宿舍", "书桌抽屉", "drawer", "桌面数码与文具"],
                          ["宿舍", "宿舍书架", "chest", "可再分上层 / 下层 / 抽屉"],
                        ] as const
                      ).map(([z, n, ic, loc]) => (
                        <button
                          key={n}
                          type="button"
                          className="mst-starter-btn"
                          onClick={() => createStarterBox(z, n, ic, loc)}
                        >
                          <span className="mst-box-icon">
                            <BoxGlyph icon={ic} size={18} />
                          </span>
                          <div className="mk-row-main">
                            <span className="mk-row-title clamp-1">
                              {z} · {n}
                            </span>
                            <span className="mk-row-sub">{loc}</span>
                          </div>
                          <Icon name="plus" size={16} />
                        </button>
                      ))}
                    </div>
                  </InkCard>
                ) : (
                  <>
                    {zones.length > 0 && (
                      <InkChipBar
                        items={zoneChipItems}
                        value={zoneFilter}
                        onChange={setZoneFilter}
                      />
                    )}

                    {shownZoneGroups.map((group) => (
                      <React.Fragment key={group.zone}>
                        <InkSectionLabel
                          title={group.zone}
                          aside={`${group.boxes.length} 个箱子`}
                        />
                        <InkCard variant="compact">
                          {group.boxes.map((box, idx) => {
                            const subs = childrenMap.get(box.id) ?? [];
                            const ids = new Set(subtreeIds(box.id));
                            const inside = items.filter((i) =>
                              ids.has(str(i, "boxId")),
                            );
                            const stored = inside.filter(
                              (i) => i.data.status !== "out",
                            ).length;
                            const out = inside.length - stored;
                            const preview =
                              subs.length > 0
                                ? `隔层：${subs
                                    .slice(0, 4)
                                    .map((s) => str(s, "name"))
                                    .join(" · ")}${subs.length > 4 ? " …" : ""}`
                                : inside.length > 0
                                  ? `${inside
                                      .slice(0, 4)
                                      .map((i) => str(i, "name"))
                                      .join(" · ")}${inside.length > 4 ? " …" : ""}`
                                  : "空箱子";
                            const loc = str(box, "location");
                            return (
                              <React.Fragment key={box.id}>
                                <button
                                  type="button"
                                  className="mk-row"
                                  onClick={() => pushBox(box.id)}
                                >
                                  <span className="mst-box-icon">
                                    <BoxGlyph icon={str(box, "icon")} size={18} />
                                  </span>
                                  <div className="mk-row-main">
                                    <span className="mk-row-title clamp-1">
                                      {str(box, "name")}
                                    </span>
                                    <span className="mk-row-sub">
                                      {loc ? `${loc} · ` : ""}
                                      {preview}
                                    </span>
                                  </div>
                                  <span className="mk-row-right">
                                    <small>
                                      {out > 0
                                        ? `${stored} (+${out}外)`
                                        : `${stored} 件`}
                                    </small>
                                    <span className="mk-row-chevron">
                                      <Icon name="chevron-right" size={14} />
                                    </span>
                                  </span>
                                </button>
                                {idx < group.boxes.length - 1 && (
                                  <InkHairline inset={44} />
                                )}
                              </React.Fragment>
                            );
                          })}
                        </InkCard>
                      </React.Fragment>
                    ))}
                  </>
                )}
              </>
            )}
          </InkScreen>
        </>
      )}

      {/* Subtle status toast */}
      {toast && (
        <div className="mk-undo-toast" role="status">
          <span>{toast}</span>
        </div>
      )}

      {/* Top-level + ActionSheet */}
      <InkActionSheet
        open={addMenuOpen}
        title="添加到储物箱"
        onClose={() => setAddMenuOpen(false)}
        items={[
          {
            label: "新建储物箱",
            icon: "storage",
            onClick: () => setBoxSheet({ open: true, mode: "create" }),
          },
          {
            label: "放入新物品",
            icon: "plus",
            onClick: () =>
              setItemSheet({
                open: true,
                item: null,
                defaultBoxId: flatBoxOptions[0]?.box.id ?? "",
              }),
          },
        ]}
      />

      {/* Box Detail ... ActionSheet */}
      {currentBox && (
        <InkActionSheet
          open={boxMenuOpen}
          title={str(currentBox, "name")}
          onClose={() => setBoxMenuOpen(false)}
          items={[
            {
              label: "编辑箱子",
              icon: "edit",
              onClick: () =>
                setBoxSheet({ open: true, mode: "edit", box: currentBox }),
            },
            {
              label: "添加子隔层",
              icon: "plus",
              onClick: () =>
                setBoxSheet({
                  open: true,
                  mode: "create",
                  defaultParentId: currentBox.id,
                }),
            },
            {
              label: "删除箱子",
              icon: "trash",
              danger: true,
              onClick: () => {
                const subCount = (childrenMap.get(currentBox.id) ?? []).length;
                const insideCount = (itemsByBox.get(currentBox.id) ?? []).length;
                if (subCount > 0) {
                  setToast(`下面还有 ${subCount} 个子隔层，请先删除隔层`);
                  return;
                }
                if (insideCount > 0) {
                  setToast(`箱内还有 ${insideCount} 件物品，请先移走或清空`);
                  return;
                }
                setBoxSheet({ open: true, mode: "edit", box: currentBox });
              },
            },
          ]}
        />
      )}

      {/* Box Create / Edit Sheet */}
      <BoxEditorSheet
        open={boxSheet.open}
        mode={boxSheet.mode}
        box={boxSheet.box}
        defaultParentId={boxSheet.defaultParentId}
        boxes={boxes}
        flatOptions={flatBoxOptions}
        existingZones={zones}
        childrenMap={childrenMap}
        items={items}
        subtreeIds={subtreeIds}
        onClose={() => setBoxSheet({ open: false, mode: "create" })}
        onDeleted={(deletedId) => {
          setBoxStack((prev) => prev.filter((id) => id !== deletedId));
          setBoxSheet({ open: false, mode: "create" });
          setToast("已删除");
        }}
      />

      {/* Item Create / Edit Sheet */}
      <ItemEditorSheet
        open={itemSheet.open}
        item={liveEditingItem}
        defaultBoxId={itemSheet.defaultBoxId}
        options={flatBoxOptions}
        boxPath={boxPath}
        onQuickTakeOut={(it) => takeOut(it)}
        onQuickReturn={(it) => returnHome(it)}
        onQuickVerify={(it) => markVerified(it)}
        onOpenMove={(it) => setMoveTargetItem(it)}
        onClose={() =>
          setItemSheet({ open: false, item: null, defaultBoxId: "" })
        }
      />

      {/* Move Item Sheet */}
      <MoveItemSheet
        item={liveMovingItem}
        options={flatBoxOptions}
        onClose={() => setMoveTargetItem(null)}
        onMove={(targetId) => {
          if (liveMovingItem) moveToBox(liveMovingItem, targetId);
        }}
      />
    </>
  );
}

/* ─────────────────────────── Box Editor Sheet ─────────────────────────── */

function BoxEditorSheet({
  open,
  mode,
  box,
  defaultParentId,
  boxes,
  flatOptions,
  existingZones,
  childrenMap,
  items,
  subtreeIds,
  onClose,
  onDeleted,
}: {
  open: boolean;
  mode: "create" | "edit";
  box?: Entity;
  defaultParentId?: string;
  boxes: Entity[];
  flatOptions: FlatBoxOption[];
  existingZones: string[];
  childrenMap: Map<string, Entity[]>;
  items: Entity[];
  subtreeIds: (rootId: string) => string[];
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const boxById = useMemo(
    () => new Map(boxes.map((b) => [b.id, b])),
    [boxes],
  );
  const [parentId, setParentId] = useState("");
  const [zone, setZone] = useState("宿舍");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<BoxIconKey>("chest");
  const [location, setLocation] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (mode === "edit" && box) {
      setParentId(str(box, "parentId"));
      setZone(str(box, "zone") || "宿舍");
      setName(str(box, "name"));
      setIcon((str(box, "icon") || "chest") as BoxIconKey);
      setLocation(str(box, "location"));
    } else {
      const pid = defaultParentId ?? "";
      const p = pid ? boxById.get(pid) : undefined;
      setParentId(pid);
      setZone(p ? str(p, "zone") || "宿舍" : existingZones[0] ?? "宿舍");
      setName("");
      setIcon((p ? str(p, "icon") : "chest") as BoxIconKey);
      setLocation("");
    }
  }, [open, mode, box?.id, defaultParentId]);

  const isSub = Boolean(parentId);
  const forbiddenParents = useMemo(
    () => new Set(box ? subtreeIds(box.id) : []),
    [box, subtreeIds],
  );
  const eligibleParents = useMemo(
    () => flatOptions.filter((opt) => !forbiddenParents.has(opt.box.id)),
    [flatOptions, forbiddenParents],
  );

  const presetZones = useMemo(
    () => [...new Set([...DEFAULT_ZONES, ...existingZones])],
    [existingZones],
  );

  const childCount = box ? (childrenMap.get(box.id)?.length ?? 0) : 0;
  const insideCount = box
    ? items.filter((i) => str(i, "boxId") === box.id).length
    : 0;
  const canDelete = Boolean(box) && childCount === 0 && insideCount === 0;

  const cleanName = name.trim();
  const resolvedZone = (
    parentId ? str(boxById.get(parentId), "zone") : zone
  ).trim();
  const canSave = !saving && cleanName.length > 0 && resolvedZone.length > 0;

  function handleSave() {
    if (!canSave) return;
    setSaving(true);
    perform(
      (async () => {
        try {
          const cleanLoc = location.trim();
          if (mode === "edit" && box) {
            await saveEdit("storageBox", box.id, box.data, {
              ...box.data,
              zone: resolvedZone,
              name: cleanName,
              parentId: parentId || null,
              icon,
              location: cleanLoc || null,
            });
          } else {
            await put("storageBox", {
              zone: resolvedZone,
              name: cleanName,
              ...(parentId ? { parentId } : {}),
              icon,
              ...(cleanLoc ? { location: cleanLoc } : {}),
            });
          }
          void synchronize();
          onClose();
        } finally {
          setSaving(false);
        }
      })(),
    );
  }

  function handleDelete() {
    if (!box || !canDelete || saving) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    const homeOnly = items.filter(
      (i) => str(i, "boxId") !== box.id && str(i, "homeBoxId") === box.id,
    );
    perform(
      (async () => {
        try {
          for (const it of homeOnly) {
            await saveEdit("storageItem", it.id, it.data, {
              ...it.data,
              homeBoxId: null,
            });
          }
          await remove(box);
          void synchronize();
          onDeleted(box.id);
        } finally {
          setSaving(false);
        }
      })(),
    );
  }

  return (
    <InkSheet
      open={open}
      title={
        mode === "create"
          ? isSub
            ? "添加子隔层"
            : "新建储物箱"
          : isSub
            ? "编辑隔层"
            : "编辑储物箱"
      }
      rightLabel="保存"
      rightDisabled={!canSave}
      onClose={onClose}
      onRight={handleSave}
    >
      {eligibleParents.length > 0 && (
        <div className="mk-form-group">
          <div className="mk-form-row">
            <span className="mk-form-label">归属层级</span>
            <select
              className="mk-form-select"
              value={parentId}
              onChange={(e) => {
                const next = e.target.value;
                setParentId(next);
                const p = boxById.get(next);
                if (p) setZone(str(p, "zone") || "宿舍");
              }}
            >
              <option value="">作为顶层大箱子</option>
              {eligibleParents.map((opt) => (
                <option key={opt.box.id} value={opt.box.id}>
                  {opt.fullLabel}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {!isSub && (
        <>
          <InkSectionLabel title="所属场景" />
          <InkChipBar
            size="sm"
            items={presetZones.map((z) => ({ value: z, label: z }))}
            value={zone}
            onChange={setZone}
          />
          <input
            className="mk-field-input"
            placeholder="或输入自定义场景（如 随身、宿舍、家里）"
            maxLength={80}
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          />
        </>
      )}

      <InkSectionLabel title={isSub ? "隔层信息" : "箱子信息"} />
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">名称</span>
          <input
            className="mk-form-input right"
            placeholder={
              isSub ? "如 前小袋、中层、上层" : "如 双肩包、书桌抽屉"
            }
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">方位说明</span>
          <input
            className="mk-form-input right"
            placeholder="可选（如 靠窗左边第一格）"
            maxLength={400}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
      </div>

      <InkSectionLabel title="容器图标" />
      <div className="mst-icon-grid">
        {BOX_ICONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            className={"mst-icon-opt" + (icon === opt.key ? " active" : "")}
            onClick={() => setIcon(opt.key)}
          >
            <BoxGlyph icon={opt.key} size={18} />
            <span>{opt.label}</span>
          </button>
        ))}
      </div>

      {mode === "edit" && box && (
        <>
          {!canDelete ? (
            <div className="mst-sheet-hint">
              {childCount > 0
                ? `下面还有 ${childCount} 个子隔层，请先删除隔层后再删此箱子。`
                : `里面还有 ${insideCount} 件物品（含已取出未归位），移走或清空后才能删除。`}
            </div>
          ) : (
            <button
              type="button"
              className="mk-pill lg full danger"
              disabled={saving}
              onClick={handleDelete}
            >
              <Icon name="trash" size={15} />
              <span>
                {confirmDelete
                  ? "再次点击确认删除"
                  : isSub
                    ? "删除此隔层"
                    : "删除此箱子"}
              </span>
            </button>
          )}
        </>
      )}
    </InkSheet>
  );
}

/* ─────────────────────────── Item Editor Sheet ─────────────────────────── */

function ItemEditorSheet({
  open,
  item,
  defaultBoxId,
  options,
  boxPath,
  onQuickTakeOut,
  onQuickReturn,
  onQuickVerify,
  onOpenMove,
  onClose,
}: {
  open: boolean;
  item: Entity | null;
  defaultBoxId: string;
  options: FlatBoxOption[];
  boxPath: (id?: string) => string;
  onQuickTakeOut: (item: Entity) => void;
  onQuickReturn: (item: Entity) => void;
  onQuickVerify: (item: Entity) => void;
  onOpenMove: (item: Entity) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [pickingIcon, setPickingIcon] = useState(false);
  const [status, setStatus] = useState<"in_box" | "out">("in_box");
  const [boxId, setBoxId] = useState("");
  const [homeBoxId, setHomeBoxId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [aliases, setAliases] = useState("");
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPickingIcon(false);
    setConfirmDelete(false);
    if (!item) {
      const target = defaultBoxId || options[0]?.box.id || "";
      setName("");
      setIcon("");
      setStatus("in_box");
      setBoxId(target);
      setHomeBoxId(target);
      setQuantity(1);
      setAliases("");
      setNote("");
      return;
    }
    setName(str(item, "name"));
    setIcon(str(item, "icon"));
    setStatus(item.data.status === "out" ? "out" : "in_box");
    setBoxId(str(item, "boxId"));
    setHomeBoxId(str(item, "homeBoxId"));
    setQuantity(Math.max(1, num(item, "quantity", 1)));
    setAliases(str(item, "aliases"));
    setNote(str(item, "note"));
  }, [open, item?.id, item?.version, defaultBoxId]);

  const cleanName = name.trim();
  const canSave =
    !saving && cleanName.length > 0 && (status === "out" || Boolean(boxId));

  function handleSave() {
    if (!canSave) return;
    setSaving(true);
    const now = new Date().toISOString();
    const cleanIcon = icon.trim();
    const qty = Math.max(1, Math.min(9999, Math.round(quantity || 1)));
    perform(
      (async () => {
        try {
          if (item) {
            await saveEdit("storageItem", item.id, item.data, {
              ...item.data,
              name: cleanName,
              icon: isBuiltinItemIcon(cleanIcon) ? cleanIcon : null,
              status,
              boxId: boxId || null,
              homeBoxId: homeBoxId || null,
              takenAt:
                status === "out" ? str(item, "takenAt") || now : null,
              quantity: qty,
              aliases: aliases.trim() || null,
              note: note.trim() || null,
              verifiedAt:
                status === "in_box" ? now : str(item, "verifiedAt") || null,
            });
          } else {
            await put("storageItem", {
              name: cleanName,
              ...(isBuiltinItemIcon(cleanIcon) ? { icon: cleanIcon } : {}),
              status,
              ...(boxId ? { boxId } : {}),
              ...(homeBoxId ? { homeBoxId } : {}),
              ...(status === "out" ? { takenAt: now } : {}),
              quantity: qty,
              ...(aliases.trim() ? { aliases: aliases.trim() } : {}),
              ...(note.trim() ? { note: note.trim() } : {}),
              verifiedAt: now,
            });
          }
          void synchronize();
          onClose();
        } finally {
          setSaving(false);
        }
      })(),
    );
  }

  function handleDelete() {
    if (!item || saving) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    perform(
      remove(item)
        .then(() => {
          void synchronize();
          onClose();
        })
        .finally(() => setSaving(false)),
    );
  }

  const isCurrentlyOut = item?.data.status === "out";

  return (
    <>
      <InkSheet
        open={open}
        title={item ? "物品详情" : "放入新物品"}
        rightLabel="保存"
        rightDisabled={!canSave}
        onClose={onClose}
        onRight={handleSave}
      >
        {/* Quick actions for existing item */}
        {item && (
          <div className="mst-quick-actions">
            <button
              type="button"
              className={"mk-pill" + (isCurrentlyOut ? " solid" : "")}
              onClick={() => {
                if (isCurrentlyOut) onQuickReturn(item);
                else onQuickTakeOut(item);
                onClose();
              }}
            >
              <span>{isCurrentlyOut ? "放回箱内" : "取出使用"}</span>
            </button>
            <button
              type="button"
              className="mk-pill"
              onClick={() => {
                onClose();
                onOpenMove(item);
              }}
            >
              <Icon name="arrow-left-right" size={14} />
              <span>移箱</span>
            </button>
            <button
              type="button"
              className="mk-pill"
              onClick={() => onQuickVerify(item)}
            >
              <Icon name="check" size={14} />
              <span>已核对</span>
            </button>
          </div>
        )}

        {/* Basic info + Icon picker trigger */}
        <div className="mk-form-group">
          <div className="mst-icon-row">
            <span className="mst-icon-preview">
              <ItemVisual
                icon={icon}
                name={name}
                aliases={aliases}
                boxPath={boxId ? boxPath(boxId) : ""}
                size={22}
              />
            </span>
            <div className="mk-row-main">
              <span className="mk-row-title clamp-1">物品图标</span>
              <span className="mk-row-sub">
                {isBuiltinItemIcon(icon) ? iconLabel(icon) : "按名称自动匹配"}
              </span>
            </div>
            {isBuiltinItemIcon(icon) && (
              <button
                type="button"
                className="mk-pill sm"
                onClick={() => setIcon("")}
              >
                自动
              </button>
            )}
            <button
              type="button"
              className="mk-pill sm"
              onClick={() => setPickingIcon(true)}
            >
              更换
            </button>
          </div>

          <div className="mk-form-row">
            <span className="mk-form-label">物品名称</span>
            <input
              className="mk-form-input right"
              placeholder="如 充电宝、耳机、护照"
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="mk-form-row">
            <span className="mk-form-label">数量</span>
            <div className="mst-qty-stepper">
              <button
                type="button"
                className="mst-qty-btn"
                aria-label="减少数量"
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                <Icon name="minus" size={14} />
              </button>
              <span className="mst-qty-val">{quantity}</span>
              <button
                type="button"
                className="mst-qty-btn"
                aria-label="增加数量"
                disabled={quantity >= 9999}
                onClick={() => setQuantity((q) => Math.min(9999, q + 1))}
              >
                <Icon name="plus" size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Location & Status */}
        <InkSectionLabel title="位置与状态" />
        <InkSegmented
          onCard
          options={[
            { value: "in_box" as const, label: "在箱内" },
            { value: "out" as const, label: "已取出使用中" },
          ]}
          value={status}
          onChange={setStatus}
        />

        <div className="mk-form-group">
          <div className="mk-form-row">
            <span className="mk-form-label">
              {status === "in_box" ? "所在箱子" : "取出自"}
            </span>
            <select
              className="mk-form-select"
              value={boxId}
              onChange={(e) => setBoxId(e.target.value)}
            >
              {status === "out" && <option value="">未指定</option>}
              {options.map((opt) => (
                <option key={opt.box.id} value={opt.box.id}>
                  {opt.fullLabel}
                </option>
              ))}
            </select>
          </div>
          <div className="mk-form-row">
            <span className="mk-form-label">常驻老家</span>
            <select
              className="mk-form-select"
              value={homeBoxId}
              onChange={(e) => setHomeBoxId(e.target.value)}
            >
              <option value="">不设固定老家</option>
              {options.map((opt) => (
                <option key={opt.box.id} value={opt.box.id}>
                  {opt.fullLabel}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Aliases & Note */}
        <InkSectionLabel title="搜索与备注" />
        <div className="mk-form-group">
          <div className="mk-form-row">
            <span className="mk-form-label">搜索别名</span>
            <input
              className="mk-form-input right"
              placeholder="如 蓝牙耳机 / 备用线"
              maxLength={200}
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
            />
          </div>
          <div className="mk-form-row col">
            <textarea
              className="mk-form-textarea"
              style={{ minHeight: 72 }}
              placeholder="备注（如 在黑色收纳袋里）"
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        {item && (
          <>
            <div className="mst-sheet-hint">
              上次核对：{formatVerified(str(item, "verifiedAt"))}
            </div>
            <button
              type="button"
              className="mk-pill lg full danger"
              disabled={saving}
              onClick={handleDelete}
            >
              <Icon name="trash" size={15} />
              <span>{confirmDelete ? "再次点击确认删除" : "删除物品"}</span>
            </button>
          </>
        )}
      </InkSheet>

      {/* Nested Mobile Icon Picker Sheet using storage-icons.tsx */}
      <ItemIconPickerSheet
        open={open && pickingIcon}
        currentIcon={icon}
        onSelect={(next) => {
          setIcon(next);
          setPickingIcon(false);
        }}
        onClose={() => setPickingIcon(false)}
      />
    </>
  );
}

/* ─────────────────────────── Mobile Icon Picker Sheet ─────────────────────────── */

function ItemIconPickerSheet({
  open,
  currentIcon,
  onSelect,
  onClose,
}: {
  open: boolean;
  currentIcon: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<"全部" | IconGroup>("全部");

  useEffect(() => {
    if (open) {
      setSearch("");
      setGroup("全部");
    }
  }, [open]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    return BUILTIN_ITEM_ICONS.filter((d) => {
      if (!q && group !== "全部" && d.group !== group) return false;
      if (!q) return true;
      return (
        d.label.toLowerCase().includes(q) ||
        d.keywords.toLowerCase().includes(q) ||
        d.key.toLowerCase().includes(q)
      );
    });
  }, [q, group]);

  return (
    <InkSheet
      open={open}
      title="选择物品图标"
      leftLabel="返回"
      rightLabel={currentIcon ? "自动匹配" : undefined}
      onClose={onClose}
      onRight={currentIcon ? () => onSelect("") : undefined}
    >
      <InkSearch
        value={search}
        onChange={setSearch}
        placeholder={`搜索 ${BUILTIN_ITEM_ICONS.length} 枚图标…`}
      />

      {!q && (
        <InkChipBar
          size="sm"
          items={[
            { value: "全部" as const, label: "全部" },
            ...ICON_GROUPS.map((g) => ({ value: g, label: g })),
          ]}
          value={group}
          onChange={setGroup}
        />
      )}

      {filtered.length === 0 ? (
        <InkEmpty text="没有找到匹配的图标" />
      ) : (
        <div className="mst-icon-grid">
          {filtered.map((def) => (
            <button
              key={def.key}
              type="button"
              className={
                "mst-icon-opt" + (currentIcon === def.key ? " active" : "")
              }
              onClick={() => onSelect(def.key)}
            >
              <ItemVisual icon={def.key} name={def.label} size={20} />
              <span>{def.label}</span>
            </button>
          ))}
        </div>
      )}
    </InkSheet>
  );
}

/* ─────────────────────────── Move Item Sheet ─────────────────────────── */

function MoveItemSheet({
  item,
  options,
  onClose,
  onMove,
}: {
  item: Entity | null;
  options: FlatBoxOption[];
  onClose: () => void;
  onMove: (targetBoxId: string) => void;
}) {
  const currentId = item ? str(item, "boxId") : "";
  const homeId = item ? str(item, "homeBoxId") : "";
  const isOut = item?.data.status === "out";

  return (
    <InkSheet
      open={Boolean(item)}
      title={item ? `移动「${str(item, "name")}」` : "移动物品"}
      leftLabel="取消"
      onClose={onClose}
    >
      {options.length === 0 ? (
        <InkEmpty text="请先新建一个储物箱" />
      ) : (
        <InkCard variant="compact">
          {options.map((opt, idx) => {
            const b = opt.box;
            const isCurrent = !isOut && b.id === currentId;
            const isHome = b.id === homeId;
            return (
              <React.Fragment key={b.id}>
                <button
                  type="button"
                  className="mst-move-row"
                  style={
                    opt.depth > 0
                      ? { paddingLeft: Math.min(opt.depth, 5) * 16 }
                      : undefined
                  }
                  disabled={isCurrent}
                  onClick={() => onMove(b.id)}
                >
                  {opt.depth > 0 ? (
                    <span className="mst-move-branch">↳</span>
                  ) : (
                    <span className="mst-box-icon">
                      <BoxGlyph icon={str(b, "icon")} size={16} />
                    </span>
                  )}
                  <div className="mk-row-main">
                    <span className="mk-row-title clamp-1">
                      {str(b, "name")}
                    </span>
                    <span className="mk-row-sub">
                      {opt.depth > 0 ? opt.fullLabel : str(b, "zone")}
                      {str(b, "location") ? ` · ${str(b, "location")}` : ""}
                    </span>
                  </div>
                  <span className="mk-row-right">
                    {isCurrent && <small>当前</small>}
                    {!isCurrent && isHome && <small>常驻</small>}
                  </span>
                </button>
                {idx < options.length - 1 && <InkHairline inset={44} />}
              </React.Fragment>
            );
          })}
        </InkCard>
      )}
    </InkSheet>
  );
}
