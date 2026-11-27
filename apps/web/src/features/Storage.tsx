import React, { useEffect, useMemo, useRef, useState } from "react";
import "./storage.css";
import {
  useEntities,
  put,
  remove,
  saveEdit,
  type AnyEntity as Entity,
} from "../data/entities.ts";
import { Heading, Empty, str, perform, usePreference } from "../ui/shared.tsx";
import {
  ItemVisual,
  StorageIconPickerModal,
  iconLabel,
  isBuiltinItemIcon,
} from "./storage-icons.tsx";

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
      <>
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
      </>
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
      <>
        <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      </>
    ),
  },
];

const DEFAULT_ZONES = ["随身", "宿舍", "家里"] as const;

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

function sortBoxList(list: Entity[]): Entity[] {
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

type FlatBoxOption = {
  box: Entity;
  depth: number;
  path: string;
  fullLabel: string;
};

export function Storage() {
  const { entities } = useEntities("storageBox", "storageItem");
  const [zoneFilter, setZoneFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);
  const [subFilterId, setSubFilterId] = useState<string>("all"); // "all" | compartment boxId
  const [quickTargetId, setQuickTargetId] = useState<string>(""); // when subFilterId==="all" and chest has sub-boxes
  const [addingSub, setAddingSub] = useState(false);
  const [newSubName, setNewSubName] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dropBoxId, setDropBoxId] = useState<string | null>(null);
  const [chestView, setChestView] = usePreference<"grid" | "list">(
    "storage-chest-view",
    "grid",
  );
  const [quickItemName, setQuickItemName] = useState("");
  const [boxModal, setBoxModal] = useState<{
    mode: "create" | "edit";
    box?: Entity;
    parentId?: string;
  } | null>(null);
  const [itemModal, setItemModal] = useState<Entity | null>(null);
  const [moveModal, setMoveModal] = useState<Entity | null>(null);
  const [iconPickerItem, setIconPickerItem] = useState<Entity | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  const boxes = useMemo(
    () => sortBoxList(entities.filter((e) => e.type === "storageBox" && !e.deleted)),
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
    const stack = [rootId];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const id = stack.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      for (const child of childrenMap.get(id) ?? []) {
        stack.push(child.id);
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
    const set = new Set<string>();
    for (const b of rootBoxes) {
      const z = str(b, "zone");
      if (z) set.add(z);
    }
    return [...set];
  }, [rootBoxes]);

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

  const outItems = useMemo(
    () =>
      items
        .filter((i) => i.data.status === "out")
        .sort((a, b) => str(a, "takenAt").localeCompare(str(b, "takenAt"))),
    [items],
  );

  const activeRoot = useMemo(
    () => (selectedRootId ? (boxById.get(selectedRootId) ?? null) : null),
    [selectedRootId, boxById],
  );

  useEffect(() => {
    if (!selectedRootId && rootBoxes.length > 0) {
      setSelectedRootId(rootBoxes[0]!.id);
    } else if (selectedRootId && !activeRoot) {
      setSelectedRootId(rootBoxes[0]?.id ?? null);
    }
  }, [selectedRootId, activeRoot, rootBoxes]);

  const activeSubBoxes = useMemo(
    () => (activeRoot ? (childrenMap.get(activeRoot.id) ?? []) : []),
    [activeRoot, childrenMap],
  );

  useEffect(() => {
    setSelectedItemId(null);
    setAddingSub(false);
    setNewSubName("");
    if (
      subFilterId !== "all" &&
      (!activeRoot ||
        (subFilterId !== activeRoot.id &&
          !activeSubBoxes.some((c) => c.id === subFilterId)))
    ) {
      setSubFilterId("all");
    }
  }, [selectedRootId]);

  useEffect(() => {
    if (subFilterId !== "all") {
      setQuickTargetId(subFilterId);
    } else if (activeRoot) {
      const valid =
        quickTargetId === activeRoot.id ||
        activeSubBoxes.some((c) => c.id === quickTargetId);
      if (!valid) {
        setQuickTargetId(activeSubBoxes[0]?.id ?? activeRoot.id);
      }
    }
  }, [subFilterId, activeRoot, activeSubBoxes]);

  const sortItems = (list: Entity[]) =>
    [...list].sort((a, b) => {
      const sa = a.data.status === "out" ? 1 : 0;
      const sb = b.data.status === "out" ? 1 : 0;
      if (sa !== sb) return sa - sb;
      return str(a, "name").localeCompare(str(b, "name"), "zh-CN");
    });

  const activeSections = useMemo(() => {
    if (!activeRoot) return [];
    if (activeSubBoxes.length === 0) {
      return [
        {
          box: activeRoot,
          title: "",
          isLooseRoot: false,
          items: sortItems(itemsByBox.get(activeRoot.id) ?? []),
        },
      ];
    }
    if (subFilterId !== "all") {
      const target = boxById.get(subFilterId) ?? activeRoot;
      return [
        {
          box: target,
          title: "",
          isLooseRoot: target.id === activeRoot.id,
          items: sortItems(itemsByBox.get(target.id) ?? []),
        },
      ];
    }
    const sections: {
      box: Entity;
      title: string;
      isLooseRoot: boolean;
      items: Entity[];
    }[] = [];
    const loose = sortItems(itemsByBox.get(activeRoot.id) ?? []);
    if (loose.length > 0) {
      sections.push({
        box: activeRoot,
        title: "未分区（主箱）",
        isLooseRoot: true,
        items: loose,
      });
    }
    for (const sub of activeSubBoxes) {
      sections.push({
        box: sub,
        title: str(sub, "name"),
        isLooseRoot: false,
        items: sortItems(itemsByBox.get(sub.id) ?? []),
      });
    }
    return sections;
  }, [activeRoot, activeSubBoxes, subFilterId, itemsByBox, boxById]);

  const activeVisibleItems = useMemo(
    () => activeSections.flatMap((s) => s.items),
    [activeSections],
  );

  const activeTotalInCount = useMemo(() => {
    if (!activeRoot) return 0;
    return subtreeIds(activeRoot.id).reduce(
      (n, id) =>
        n +
        (itemsByBox.get(id) ?? []).filter((i) => i.data.status !== "out").length,
      0,
    );
  }, [activeRoot, itemsByBox, childrenMap]);

  const selectedItem = useMemo(
    () => activeVisibleItems.find((i) => i.id === selectedItemId) ?? null,
    [activeVisibleItems, selectedItemId],
  );

  const needle = query.trim().toLowerCase();
  const searchHits = useMemo(() => {
    if (!needle) return [];
    return items.filter((item) => {
      const bid = str(item, "boxId");
      const homeId = str(item, "homeBoxId");
      const box = boxById.get(bid);
      const hay = [
        str(item, "name"),
        str(item, "aliases"),
        str(item, "note"),
        bid ? boxLabel(bid) : "",
        box ? str(box, "location") : "",
        homeId ? boxLabel(homeId) : "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [items, needle, boxById]);

  const visibleRootBoxes = useMemo(
    () =>
      zoneFilter === "all"
        ? rootBoxes
        : rootBoxes.filter((b) => str(b, "zone") === zoneFilter),
    [rootBoxes, zoneFilter],
  );

  const rootsByZone = useMemo(() => {
    const groups: { zone: string; boxes: Entity[] }[] = [];
    for (const box of visibleRootBoxes) {
      const z = str(box, "zone") || "未分组";
      let g = groups.find((x) => x.zone === z);
      if (!g) {
        g = { zone: z, boxes: [] };
        groups.push(g);
      }
      g.boxes.push(box);
    }
    return groups;
  }, [visibleRootBoxes]);

  function openBoxLocation(boxId: string) {
    const root = rootOf(boxId);
    if (!root) return;
    setSelectedRootId(root.id);
    if (root.id !== boxId) {
      setSubFilterId(boxId);
    } else {
      setSubFilterId("all");
    }
    setQuery("");
  }

  function takeOut(item: Entity) {
    perform(
      saveEdit("storageItem", item.id, item.data, {
        ...item.data,
        status: "out",
        takenAt: new Date().toISOString(),
      }),
    );
  }

  function returnHome(item: Entity) {
    const targetId = str(item, "homeBoxId") || str(item, "boxId");
    if (!targetId || !boxById.has(targetId)) {
      setMoveModal(item);
      return;
    }
    perform(
      saveEdit("storageItem", item.id, item.data, {
        ...item.data,
        status: "in_box",
        boxId: targetId,
        takenAt: null,
        verifiedAt: new Date().toISOString(),
      }),
    );
  }

  function moveToBox(item: Entity, targetBoxId: string) {
    if (item.data.status !== "out" && str(item, "boxId") === targetBoxId) return;
    perform(
      saveEdit("storageItem", item.id, item.data, {
        ...item.data,
        status: "in_box",
        boxId: targetBoxId,
        takenAt: null,
        verifiedAt: new Date().toISOString(),
      }),
    );
  }

  async function quickAddToActiveBox(e?: React.FormEvent) {
    e?.preventDefault();
    if (!activeRoot) return;
    const name = quickItemName.trim();
    if (!name) return;
    const targetId =
      subFilterId !== "all"
        ? subFilterId
        : quickTargetId && boxById.has(quickTargetId)
          ? quickTargetId
          : activeRoot.id;
    setQuickItemName("");
    await put("storageItem", {
      name,
      status: "in_box",
      boxId: targetId,
      homeBoxId: targetId,
      quantity: 1,
      verifiedAt: new Date().toISOString(),
    });
  }

  async function handleAddSubBox(e?: React.FormEvent) {
    e?.preventDefault();
    if (!activeRoot) return;
    const name = newSubName.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    setNewSubName("");
    setAddingSub(false);
    await put(
      "storageBox",
      {
        zone: str(activeRoot, "zone") || "宿舍",
        name,
        parentId: activeRoot.id,
        icon: str(activeRoot, "icon") || "box",
        order: activeSubBoxes.length + 1,
      },
      { id },
    );
    setSubFilterId(id);
  }

  async function createStarterBox(
    zone: string,
    name: string,
    icon: BoxIconKey,
    location: string,
  ) {
    const id = crypto.randomUUID();
    await put("storageBox", { zone, name, icon, location }, { id });
    setSelectedRootId(id);
  }

  function setItemIcon(item: Entity, nextIcon: string | null) {
    perform(
      saveEdit("storageItem", item.id, item.data, {
        ...item.data,
        icon: nextIcon,
      }),
    );
  }

  function renderSlotItem(item: Entity, containerBox: Entity) {
    const isOut = item.data.status === "out";
    const qty = typeof item.data.quantity === "number" ? item.data.quantity : 1;
    const homeId = str(item, "homeBoxId");
    const awayFromHome = !isOut && homeId && homeId !== containerBox.id;
    const isSelected = selectedItemId === item.id;
    return (
      <button
        key={item.id}
        type="button"
        draggable
        onDragStart={(e) => {
          setDragItemId(item.id);
          e.dataTransfer.setData("text/storage-item", item.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => {
          setDragItemId(null);
          setDropBoxId(null);
        }}
        className={
          "storage-mc-slot" +
          (isSelected ? " selected" : "") +
          (isOut ? " out" : "")
        }
        title={
          str(item, "note") ||
          (awayFromHome ? `常驻：${boxLabel(homeId)}` : str(item, "name"))
        }
        onClick={() =>
          setSelectedItemId((cur) => (cur === item.id ? null : item.id))
        }
        onDoubleClick={() => setItemModal(item)}
      >
        {awayFromHome && (
          <span className="storage-mc-dot" title={`常驻：${boxLabel(homeId)}`} />
        )}
        {qty > 1 && <span className="storage-mc-qty">×{qty}</span>}
        <span className="storage-mc-glyph">
          <ItemVisual
            icon={str(item, "icon")}
            name={str(item, "name")}
            aliases={str(item, "aliases")}
            boxPath={boxPath(containerBox.id)}
            size={21}
          />
        </span>
        <span className="storage-mc-name">{str(item, "name")}</span>
      </button>
    );
  }

  function renderListRow(item: Entity, containerBox: Entity) {
    const isOut = item.data.status === "out";
    const qty = typeof item.data.quantity === "number" ? item.data.quantity : 1;
    const homeId = str(item, "homeBoxId");
    const awayFromHome = !isOut && homeId && homeId !== containerBox.id;
    const elapsed = formatElapsed(str(item, "takenAt"));
    return (
      <div
        key={item.id}
        className={"storage-hairline-row" + (isOut ? " out" : "")}
      >
        <button
          type="button"
          className="storage-hairline-main"
          onClick={() => setItemModal(item)}
        >
          <span className="storage-hairline-icon">
            <ItemVisual
              icon={str(item, "icon")}
              name={str(item, "name")}
              aliases={str(item, "aliases")}
              boxPath={boxPath(containerBox.id)}
              size={16}
            />
          </span>
          <span className="storage-hairline-name">{str(item, "name")}</span>
          {qty > 1 && <span className="storage-qty">×{qty}</span>}
          {isOut && <span className="storage-hairline-out">{elapsed.text}</span>}
          {!isOut && awayFromHome && (
            <span className="storage-home-hint">常驻：{boxLabel(homeId)}</span>
          )}
          {!isOut && !awayFromHome && str(item, "note") && (
            <span className="storage-hairline-note">{str(item, "note")}</span>
          )}
        </button>
        <div className="storage-hairline-tools">
          {isOut ? (
            <button type="button" onClick={() => returnHome(item)}>
              归位
            </button>
          ) : (
            <>
              {awayFromHome && (
                <button type="button" onClick={() => returnHome(item)}>
                  归家
                </button>
              )}
              <button type="button" onClick={() => takeOut(item)}>
                取出
              </button>
            </>
          )}
          <button type="button" onClick={() => setMoveModal(item)}>
            移箱
          </button>
        </div>
      </div>
    );
  }

  const effectiveQuickTarget =
    subFilterId !== "all"
      ? boxById.get(subFilterId)
      : quickTargetId
        ? boxById.get(quickTargetId)
        : activeRoot ?? undefined;

  return (
    <div className="storage-page">
      <Heading
        eyebrow="STORAGE · CHESTS & INVENTORY"
        title="储物箱"
        description="像 MC 箱子一样记录每件东西的位置——支持箱内再分区域，秒搜精确定位到每一层。"
      >
        <button
          type="button"
          className="primary"
          onClick={() => setBoxModal({ mode: "create" })}
        >
          ＋ 新建箱子
        </button>
      </Heading>

      {/* Instant Spotlight Search */}
      <div className="storage-search-bar">
        <input
          ref={searchRef}
          className="storage-search-input"
          placeholder="找什么？搜物品名、别名、备注或箱子/分区（如：充电宝、耳机、前小袋）…"
          aria-label="搜索储物箱物品"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="muted"
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
          >
            清空
          </button>
        )}
      </div>

      {/* Instant Search Results */}
      {needle && (
        <section className="storage-search-results" aria-label="查找结果">
          <div className="storage-section-head">
            <strong>找到 {searchHits.length} 件相关物品</strong>
          </div>
          {searchHits.length === 0 ? (
            <Empty text="没有找到记录——是不是还没放进储物箱？" />
          ) : (
            <div className="storage-hit-list">
              {searchHits.map((item) => {
                const isOut = item.data.status === "out";
                const bid = str(item, "boxId");
                const homeId = str(item, "homeBoxId");
                const awayFromHome = !isOut && homeId && homeId !== bid;
                const elapsed = formatElapsed(str(item, "takenAt"));
                const qty =
                  typeof item.data.quantity === "number" ? item.data.quantity : 1;
                return (
                  <div className="storage-hit-row" key={item.id}>
                    <div className="storage-hit-main">
                      <div className="storage-hit-title">
                        <span className="storage-row-icon">
                          <ItemVisual
                            icon={str(item, "icon")}
                            name={str(item, "name")}
                            aliases={str(item, "aliases")}
                            boxPath={bid ? boxPath(bid) : ""}
                            size={15}
                          />
                        </span>
                        <button
                          type="button"
                          className="storage-link-btn"
                          onClick={() => setItemModal(item)}
                        >
                          <strong>{str(item, "name")}</strong>
                        </button>
                        {qty > 1 && <span className="storage-qty">×{qty}</span>}
                        {isOut ? (
                          <span
                            className={
                              "storage-status-badge out" +
                              (elapsed.stale ? " stale" : "")
                            }
                          >
                            {elapsed.text}
                            {bid ? ` · 原在 ${boxLabel(bid)}` : ""}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="storage-loc-pill"
                            onClick={() => bid && openBoxLocation(bid)}
                          >
                            {boxLabel(bid)}
                          </button>
                        )}
                        {awayFromHome && (
                          <span className="storage-home-hint">
                            常驻：{boxLabel(homeId)}
                          </span>
                        )}
                      </div>
                      {(str(item, "note") || str(item, "aliases")) && (
                        <small className="storage-hit-note">
                          {[str(item, "note"), str(item, "aliases")]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      )}
                    </div>
                    <div className="storage-hit-actions">
                      {isOut ? (
                        <button
                          type="button"
                          className="primary"
                          onClick={() => returnHome(item)}
                        >
                          归位
                        </button>
                      ) : (
                        <>
                          {awayFromHome && (
                            <button type="button" onClick={() => returnHome(item)}>
                              归回老家
                            </button>
                          )}
                          <button type="button" onClick={() => takeOut(item)}>
                            取出
                          </button>
                        </>
                      )}
                      <button type="button" onClick={() => setMoveModal(item)}>
                        换箱子
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Out-of-box Reminder Strip */}
      {outItems.length > 0 && (
        <section className="storage-out-strip" aria-label="已取出未归位物品">
          <div className="storage-out-head">
            <strong>在外未归位 · {outItems.length} 件</strong>
            <small>用完点一下「归位」，避免随手放丢</small>
          </div>
          <div className="storage-out-chips">
            {outItems.map((item) => {
              const elapsed = formatElapsed(str(item, "takenAt"));
              const bid = str(item, "boxId");
              const homeId = str(item, "homeBoxId");
              const destName = homeId ? boxPath(homeId) : bid ? boxPath(bid) : "";
              return (
                <div
                  className={"storage-out-chip" + (elapsed.stale ? " stale" : "")}
                  key={item.id}
                >
                  <button
                    type="button"
                    className="storage-out-chip-info"
                    onClick={() => setItemModal(item)}
                  >
                    <strong>{str(item, "name")}</strong>
                    <span>
                      {elapsed.text}
                      {bid ? ` · 来自 ${boxPath(bid)}` : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="storage-out-return"
                    title={destName ? `放回 ${destName}` : "放回箱子"}
                    onClick={() => returnHome(item)}
                  >
                    归位
                  </button>
                  <button
                    type="button"
                    className="storage-out-move"
                    onClick={() => setMoveModal(item)}
                  >
                    移至…
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Main Content */}
      {rootBoxes.length === 0 ? (
        <section className="storage-onboarding">
          <div className="storage-onboarding-inner">
            <strong>先摆几个现实里的“箱子”</strong>
            <p>
              不需要全屋盘点，先把装高频小物件（充电宝、耳机、数据线、证件、钥匙）的
              2~3 个容器建起来，再按需要往里面划分隔层/分区。
            </p>
            <div className="storage-starter-grid">
              {[
                {
                  zone: "随身",
                  name: "双肩包",
                  icon: "bag" as BoxIconKey,
                  loc: "可再分前小袋 / 中层 / 大袋",
                },
                {
                  zone: "宿舍",
                  name: "书桌抽屉",
                  icon: "drawer" as BoxIconKey,
                  loc: "桌面常用数码与文具",
                },
                {
                  zone: "宿舍",
                  name: "宿舍书架",
                  icon: "chest" as BoxIconKey,
                  loc: "可再分上层 / 下层 / 抽屉",
                },
              ].map((s) => (
                <button
                  key={s.name}
                  type="button"
                  className="storage-starter-btn"
                  onClick={() =>
                    void createStarterBox(s.zone, s.name, s.icon, s.loc)
                  }
                >
                  <BoxGlyph icon={s.icon} size={18} />
                  <span>
                    <strong>
                      {s.zone} · {s.name}
                    </strong>
                    <small>{s.loc}</small>
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="primary"
              onClick={() => setBoxModal({ mode: "create" })}
            >
              ＋ 自定义新建箱子
            </button>
          </div>
        </section>
      ) : (
        <div className="storage-workbench">
          {/* Left: Top-level Chest Wall */}
          <section className="storage-wall" aria-label="储物箱列表">
            <div className="storage-zone-bar" role="tablist" aria-label="场景筛选">
              <button
                type="button"
                role="tab"
                aria-selected={zoneFilter === "all"}
                className={zoneFilter === "all" ? "active" : ""}
                onClick={() => setZoneFilter("all")}
              >
                全部 <small>{rootBoxes.length}</small>
              </button>
              {zones.map((z) => (
                <button
                  key={z}
                  type="button"
                  role="tab"
                  aria-selected={zoneFilter === z}
                  className={zoneFilter === z ? "active" : ""}
                  onClick={() => setZoneFilter(z)}
                >
                  {z}{" "}
                  <small>
                    {rootBoxes.filter((b) => str(b, "zone") === z).length}
                  </small>
                </button>
              ))}
            </div>

            <div className="storage-wall-scroll">
              {rootsByZone.map((group) => (
                <div className="storage-zone-group" key={group.zone}>
                  <div className="storage-zone-title">
                    <strong>{group.zone}</strong>
                    <span>{group.boxes.length} 个箱子</span>
                  </div>
                  <div className="storage-chest-grid">
                    {group.boxes.map((box) => {
                      const subs = childrenMap.get(box.id) ?? [];
                      const allIds = subtreeIds(box.id);
                      const allInside = allIds.flatMap(
                        (id) => itemsByBox.get(id) ?? [],
                      );
                      const storedCount = allInside.filter(
                        (i) => i.data.status !== "out",
                      ).length;
                      const outCount = allInside.length - storedCount;
                      const isSelected = activeRoot?.id === box.id;
                      const isDropTarget =
                        dropBoxId === box.id &&
                        dragItemId !== null &&
                        activeRoot?.id !== box.id;
                      return (
                        <button
                          key={box.id}
                          type="button"
                          className={
                            "storage-chest" +
                            (isSelected ? " selected" : "") +
                            (isDropTarget ? " drop-over" : "")
                          }
                          onClick={() => {
                            setSelectedRootId(box.id);
                            setSubFilterId("all");
                          }}
                          onDragOver={(e) => {
                            if (!dragItemId) return;
                            e.preventDefault();
                            if (dropBoxId !== box.id) setDropBoxId(box.id);
                          }}
                          onDragLeave={() => {
                            if (dropBoxId === box.id) setDropBoxId(null);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const id =
                              e.dataTransfer.getData("text/storage-item") ||
                              dragItemId;
                            setDropBoxId(null);
                            setDragItemId(null);
                            if (!id) return;
                            const dragged = items.find((x) => x.id === id);
                            if (dragged) moveToBox(dragged, box.id);
                          }}
                        >
                          <div className="storage-chest-head">
                            <span className="storage-chest-icon">
                              <BoxGlyph icon={str(box, "icon")} size={17} />
                            </span>
                            <div className="storage-chest-meta">
                              <strong>{str(box, "name")}</strong>
                              {str(box, "location") && (
                                <small>{str(box, "location")}</small>
                              )}
                            </div>
                            <span className="storage-chest-count">
                              {storedCount}
                              {outCount > 0 ? ` (+${outCount}外)` : ""}
                            </span>
                          </div>
                          <div className="storage-chest-preview">
                            {subs.length > 0 ? (
                              subs.slice(0, 6).map((sub) => {
                                const subCount = (
                                  itemsByBox.get(sub.id) ?? []
                                ).filter((i) => i.data.status !== "out").length;
                                return (
                                  <span
                                    key={sub.id}
                                    className="storage-mini-sub"
                                  >
                                    {str(sub, "name")}
                                    <small>{subCount}</small>
                                  </span>
                                );
                              })
                            ) : allInside.length === 0 ? (
                              <span className="storage-preview-empty">空箱子</span>
                            ) : (
                              <>
                                {allInside.slice(0, 6).map((item) => (
                                  <span
                                    key={item.id}
                                    className={
                                      "storage-mini-slot" +
                                      (item.data.status === "out" ? " out" : "")
                                    }
                                  >
                                    {str(item, "name")}
                                  </span>
                                ))}
                                {allInside.length > 6 && (
                                  <span className="storage-mini-more">
                                    +{allInside.length - 6}
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Right: Open Chest View with Compartments */}
          <section className="storage-inspector" aria-label="开箱视图">
            {activeRoot ? (
              <>
                <div className="storage-inspector-head">
                  <div className="storage-inspector-title">
                    <span className="storage-chest-icon lg">
                      <BoxGlyph icon={str(activeRoot, "icon")} size={20} />
                    </span>
                    <div>
                      <div className="storage-inspector-name-row">
                        <h2>{str(activeRoot, "name")}</h2>
                        <span className="storage-zone-pill">
                          {str(activeRoot, "zone")}
                        </span>
                      </div>
                      <small>
                        {str(activeRoot, "location")
                          ? `${str(activeRoot, "location")} · `
                          : ""}
                        {activeTotalInCount} 件在箱内
                        {activeSubBoxes.length > 0
                          ? ` · ${activeSubBoxes.length} 个分区`
                          : ""}
                        {chestView === "grid" &&
                        (boxes.length > 1 || activeSubBoxes.length > 0)
                          ? " · 可拖拽换区/换箱"
                          : ""}
                      </small>
                    </div>
                  </div>
                  <div className="storage-inspector-tools">
                    <div className="segmented" aria-label="开箱视角">
                      <button
                        type="button"
                        className={chestView === "grid" ? "active" : ""}
                        onClick={() => setChestView("grid")}
                      >
                        图标格
                      </button>
                      <button
                        type="button"
                        className={chestView === "list" ? "active" : ""}
                        onClick={() => setChestView("list")}
                      >
                        清单
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setBoxModal({ mode: "edit", box: activeRoot })
                      }
                    >
                      编辑箱子
                    </button>
                  </div>
                </div>

                {/* Compartment / Sub-box Bar (also drop targets for items!) */}
                <div className="storage-sub-bar">
                  {activeSubBoxes.length > 0 && (
                    <>
                      <button
                        type="button"
                        className={
                          "storage-sub-pill" +
                          (subFilterId === "all" ? " active" : "")
                        }
                        onClick={() => setSubFilterId("all")}
                      >
                        全部分区 <small>{activeTotalInCount}</small>
                      </button>
                      {(itemsByBox.get(activeRoot.id) ?? []).length > 0 && (
                        <button
                          type="button"
                          className={
                            "storage-sub-pill" +
                            (subFilterId === activeRoot.id ? " active" : "") +
                            (dropBoxId === activeRoot.id ? " drop-over" : "")
                          }
                          onClick={() => setSubFilterId(activeRoot.id)}
                          onDragOver={(e) => {
                            if (!dragItemId) return;
                            e.preventDefault();
                            setDropBoxId(activeRoot.id);
                          }}
                          onDragLeave={() => {
                            if (dropBoxId === activeRoot.id) setDropBoxId(null);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const id =
                              e.dataTransfer.getData("text/storage-item") ||
                              dragItemId;
                            setDropBoxId(null);
                            setDragItemId(null);
                            const dragged = items.find((x) => x.id === id);
                            if (dragged) moveToBox(dragged, activeRoot.id);
                          }}
                        >
                          未分区{" "}
                          <small>
                            {(itemsByBox.get(activeRoot.id) ?? []).length}
                          </small>
                        </button>
                      )}
                      {activeSubBoxes.map((sub) => {
                        const cnt = (itemsByBox.get(sub.id) ?? []).length;
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            className={
                              "storage-sub-pill" +
                              (subFilterId === sub.id ? " active" : "") +
                              (dropBoxId === sub.id ? " drop-over" : "")
                            }
                            onClick={() => setSubFilterId(sub.id)}
                            onDragOver={(e) => {
                              if (!dragItemId) return;
                              e.preventDefault();
                              setDropBoxId(sub.id);
                            }}
                            onDragLeave={() => {
                              if (dropBoxId === sub.id) setDropBoxId(null);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const id =
                                e.dataTransfer.getData("text/storage-item") ||
                                dragItemId;
                              setDropBoxId(null);
                              setDragItemId(null);
                              const dragged = items.find((x) => x.id === id);
                              if (dragged) moveToBox(dragged, sub.id);
                            }}
                          >
                            {str(sub, "name")} <small>{cnt}</small>
                          </button>
                        );
                      })}
                    </>
                  )}

                  {addingSub ? (
                    <form
                      className="storage-sub-add-form"
                      onSubmit={(e) => void handleAddSubBox(e)}
                    >
                      <input
                        autoFocus
                        placeholder="分区名（如 前小袋 / 上层 / 抽屉）"
                        maxLength={120}
                        value={newSubName}
                        onChange={(e) => setNewSubName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setAddingSub(false);
                            setNewSubName("");
                          }
                        }}
                      />
                      <button
                        type="submit"
                        className="primary"
                        disabled={!newSubName.trim()}
                      >
                        添加
                      </button>
                      <button
                        type="button"
                        className="muted"
                        onClick={() => {
                          setAddingSub(false);
                          setNewSubName("");
                        }}
                      >
                        取消
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="storage-sub-add-btn"
                      onClick={() => setAddingSub(true)}
                    >
                      ＋ 划分区域
                    </button>
                  )}

                  {subFilterId !== "all" &&
                    subFilterId !== activeRoot.id &&
                    boxById.get(subFilterId) && (
                      <button
                        type="button"
                        className="storage-sub-edit-btn"
                        onClick={() =>
                          setBoxModal({
                            mode: "edit",
                            box: boxById.get(subFilterId),
                          })
                        }
                      >
                        编辑分区
                      </button>
                    )}
                </div>

                {/* Quick Add Item directly into this chest or chosen compartment */}
                <form
                  className="storage-quick-add"
                  onSubmit={(e) => void quickAddToActiveBox(e)}
                >
                  {activeSubBoxes.length > 0 && subFilterId === "all" && (
                    <select
                      className="storage-quick-target"
                      aria-label="放入目标分区"
                      value={quickTargetId || activeRoot.id}
                      onChange={(e) => setQuickTargetId(e.target.value)}
                    >
                      <option value={activeRoot.id}>未分区（主箱）</option>
                      {activeSubBoxes.map((sub) => (
                        <option key={sub.id} value={sub.id}>
                          {str(sub, "name")}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    placeholder={`往「${effectiveQuickTarget ? boxPath(effectiveQuickTarget.id) : str(activeRoot, "name")}」放入物品（回车即可）…`}
                    aria-label="往当前箱子放入物品"
                    maxLength={160}
                    value={quickItemName}
                    onChange={(e) => setQuickItemName(e.target.value)}
                  />
                  <button
                    type="submit"
                    className={quickItemName.trim() ? "primary" : ""}
                    disabled={!quickItemName.trim()}
                  >
                    放入
                  </button>
                </form>

                {/* Chest Interior (grouped by compartment when viewing All) */}
                <div className="storage-interior">
                  {activeSections.every((s) => s.items.length === 0) &&
                  activeSubBoxes.length === 0 ? (
                    <Empty text="这个箱子目前是空的，在上方输入物品名回车放进第一件，或点「＋ 划分区域」分出隔层。" />
                  ) : (
                    <div className="storage-sections-stack">
                      {activeSections.map((sec) => (
                        <div className="storage-sub-section" key={sec.box.id}>
                          {sec.title && (
                            <div className="storage-sub-section-head">
                              <div className="storage-sub-section-title">
                                <strong>{sec.title}</strong>
                                <span>{sec.items.length} 件</span>
                              </div>
                              {!sec.isLooseRoot && (
                                <button
                                  type="button"
                                  className="storage-sub-section-edit"
                                  onClick={() =>
                                    setBoxModal({ mode: "edit", box: sec.box })
                                  }
                                >
                                  编辑
                                </button>
                              )}
                            </div>
                          )}
                          {sec.items.length === 0 ? (
                            <p className="storage-sub-empty">
                              空分区 · 在上方选「{str(sec.box, "name")}」即可放入
                            </p>
                          ) : chestView === "grid" ? (
                            <div className="storage-mc-grid">
                              {sec.items.map((item) =>
                                renderSlotItem(item, sec.box),
                              )}
                            </div>
                          ) : (
                            <div className="storage-hairline-list">
                              {sec.items.map((item) =>
                                renderListRow(item, sec.box),
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quiet bottom action bar when a compact MC grid slot is selected */}
                {chestView === "grid" &&
                  selectedItem &&
                  (() => {
                    const isOut = selectedItem.data.status === "out";
                    const curBid = str(selectedItem, "boxId");
                    const homeId = str(selectedItem, "homeBoxId");
                    const away = !isOut && homeId && homeId !== curBid;
                    const elapsed = formatElapsed(str(selectedItem, "takenAt"));
                    const sub = isOut
                      ? elapsed.text
                      : away
                        ? `常驻：${boxLabel(homeId)}`
                        : str(selectedItem, "note") ||
                          str(selectedItem, "aliases") ||
                          (curBid ? boxPath(curBid) : "");
                    return (
                      <div className="storage-selection-bar">
                        <div className="storage-selection-info">
                          <strong>{str(selectedItem, "name")}</strong>
                          {sub && (
                            <span className={isOut ? "out" : ""}>{sub}</span>
                          )}
                        </div>
                        <div className="storage-selection-actions">
                          {isOut ? (
                            <button
                              type="button"
                              className="primary"
                              onClick={() => returnHome(selectedItem)}
                            >
                              一键归位
                            </button>
                          ) : (
                            <>
                              {away && (
                                <button
                                  type="button"
                                  onClick={() => returnHome(selectedItem)}
                                >
                                  归回老家
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => takeOut(selectedItem)}
                              >
                                取出
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => setIconPickerItem(selectedItem)}
                          >
                            换图标
                          </button>
                          <button
                            type="button"
                            onClick={() => setMoveModal(selectedItem)}
                          >
                            移箱/分区
                          </button>
                          <button
                            type="button"
                            onClick={() => setItemModal(selectedItem)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="muted"
                            aria-label="取消选中"
                            onClick={() => setSelectedItemId(null)}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })()}
              </>
            ) : (
              <div className="storage-empty-inspector">
                <Empty text="在左侧点开一个储物箱" />
              </div>
            )}
          </section>
        </div>
      )}

      {/* Create / Edit Box or Sub-box Modal */}
      {boxModal && (
        <BoxEditorModal
          mode={boxModal.mode}
          box={boxModal.box}
          defaultParentId={boxModal.parentId}
          existingZones={zones}
          rootBoxes={rootBoxes}
          childCount={
            boxModal.box ? (childrenMap.get(boxModal.box.id) ?? []).length : 0
          }
          itemsReferencingBox={
            boxModal.box
              ? items.filter(
                  (i) =>
                    str(i, "boxId") === boxModal.box!.id ||
                    str(i, "homeBoxId") === boxModal.box!.id,
                )
              : []
          }
          onClose={() => setBoxModal(null)}
          onSaved={(id, parentId) => {
            if (parentId) {
              const r = rootOf(parentId);
              if (r) setSelectedRootId(r.id);
              setSubFilterId(id);
            } else {
              setSelectedRootId(id);
              setSubFilterId("all");
            }
            setBoxModal(null);
          }}
          onDeleted={(deletedBox) => {
            const pid = str(deletedBox, "parentId");
            if (pid && subFilterId === deletedBox.id) {
              setSubFilterId("all");
            }
            setBoxModal(null);
          }}
        />
      )}

      {/* Move Item Modal (Hierarchical: Chests & Compartments) */}
      {moveModal && (
        <MoveItemModal
          item={moveModal}
          options={flatBoxOptions}
          onClose={() => setMoveModal(null)}
          onMove={(targetId) => {
            moveToBox(moveModal, targetId);
            setMoveModal(null);
          }}
        />
      )}

      {/* Item Detail Modal */}
      {itemModal && (
        <ItemEditorModal
          item={items.find((i) => i.id === itemModal.id) ?? itemModal}
          options={flatBoxOptions}
          onClose={() => setItemModal(null)}
        />
      )}

      {/* Quick 1-click Item Icon Picker Modal */}
      {iconPickerItem && (() => {
        const live = items.find((i) => i.id === iconPickerItem.id) ?? iconPickerItem;
        return (
          <StorageIconPickerModal
            itemName={str(live, "name")}
            currentIcon={str(live, "icon") || undefined}
            onSelect={(next) => {
              setItemIcon(live, next);
              setIconPickerItem(null);
            }}
            onClose={() => setIconPickerItem(null)}
          />
        );
      })()}
    </div>
  );
}

function BoxEditorModal({
  mode,
  box,
  defaultParentId,
  existingZones,
  rootBoxes,
  childCount,
  itemsReferencingBox,
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: "create" | "edit";
  box?: Entity;
  defaultParentId?: string;
  existingZones: string[];
  rootBoxes: Entity[];
  childCount: number;
  itemsReferencingBox: Entity[];
  onClose: () => void;
  onSaved: (id: string, parentId?: string) => void;
  onDeleted: (deletedBox: Entity) => void;
}) {
  const [parentId, setParentId] = useState(
    box ? str(box, "parentId") : (defaultParentId ?? ""),
  );
  const parentBox = rootBoxes.find((b) => b.id === parentId);
  const [zone, setZone] = useState(
    box ? str(box, "zone") : parentBox ? str(parentBox, "zone") : "宿舍",
  );
  const [name, setName] = useState(box ? str(box, "name") : "");
  const [icon, setIcon] = useState<BoxIconKey>(
    ((box ? str(box, "icon") : "chest") || "chest") as BoxIconKey,
  );
  const [location, setLocation] = useState(box ? str(box, "location") : "");
  const [saving, setSaving] = useState(false);

  const isSub = Boolean(parentId);
  const presetZones = [...new Set([...DEFAULT_ZONES, ...existingZones])];
  const insideCount = box
    ? itemsReferencingBox.filter((i) => str(i, "boxId") === box.id).length
    : 0;
  const homeOnlyItems = box
    ? itemsReferencingBox.filter(
        (i) => str(i, "boxId") !== box.id && str(i, "homeBoxId") === box.id,
      )
    : [];
  const canDelete = insideCount === 0 && childCount === 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const cleanZone = (parentBox ? str(parentBox, "zone") : zone).trim();
    const cleanName = name.trim();
    if (!cleanZone || !cleanName || saving) return;
    setSaving(true);
    try {
      const id = box?.id ?? crypto.randomUUID();
      if (box) {
        await saveEdit("storageBox", box.id, box.data, {
          ...box.data,
          zone: cleanZone,
          name: cleanName,
          parentId: parentId || null,
          icon,
          location: location.trim() || null,
        });
      } else {
        await put(
          "storageBox",
          {
            zone: cleanZone,
            name: cleanName,
            ...(parentId ? { parentId } : {}),
            icon,
            ...(location.trim() ? { location: location.trim() } : {}),
          },
          { id },
        );
      }
      onSaved(id, parentId || undefined);
    } finally {
      setSaving(false);
    }
  }

  async function deleteBox() {
    if (!box || !canDelete || saving) return;
    setSaving(true);
    try {
      for (const item of homeOnlyItems) {
        await saveEdit("storageItem", item.id, item.data, {
          ...item.data,
          homeBoxId: null,
        });
      }
      await remove(box);
      onDeleted(box);
    } finally {
      setSaving(false);
    }
  }

  const eligibleParents = rootBoxes.filter((b) => b.id !== box?.id);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal storage-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void save(e)}
      >
        <header>
          <h2>
            {mode === "create"
              ? isSub
                ? "新建分区 / 子箱"
                : "新建储物箱"
              : isSub
                ? "编辑分区 / 子箱"
                : "编辑储物箱"}
          </h2>
          <button type="button" className="muted" onClick={onClose}>
            ×
          </button>
        </header>

        {eligibleParents.length > 0 && childCount === 0 && (
          <div className="storage-form-field">
            <label>所属主箱（留空则为顶层箱子）</label>
            <select
              value={parentId}
              onChange={(e) => {
                const next = e.target.value;
                setParentId(next);
                const p = rootBoxes.find((b) => b.id === next);
                if (p) setZone(str(p, "zone"));
              }}
            >
              <option value="">作为顶层大箱子</option>
              {eligibleParents.map((b) => (
                <option key={b.id} value={b.id}>
                  {str(b, "zone")} · {str(b, "name")}
                </option>
              ))}
            </select>
          </div>
        )}

        {!isSub && (
          <div className="storage-form-field">
            <label>所属场景</label>
            <div className="storage-preset-chips">
              {presetZones.map((z) => (
                <button
                  key={z}
                  type="button"
                  className={zone === z ? "active" : ""}
                  onClick={() => setZone(z)}
                >
                  {z}
                </button>
              ))}
            </div>
            <input
              placeholder="或输入自定义场景（如 工作室、行李）"
              maxLength={80}
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              required
            />
          </div>
        )}

        <div className="storage-form-field">
          <label>{isSub ? "分区 / 隔层名称" : "箱子 / 容器名称"}</label>
          <input
            autoFocus
            placeholder={
              isSub
                ? "如 前小袋、中层、大袋、上层、下层、抽屉"
                : "如 双肩包、宿舍书架、书桌抽屉"
            }
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        {!isSub && (
          <div className="storage-form-field">
            <label>图标</label>
            <div className="storage-icon-picker">
              {BOX_ICONS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  className={icon === b.key ? "active" : ""}
                  onClick={() => setIcon(b.key)}
                  title={b.label}
                >
                  <BoxGlyph icon={b.key} size={17} />
                  <span>{b.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="storage-form-field">
          <label>具体方位说明（可选）</label>
          <input
            placeholder={
              isSub
                ? "如 最外侧拉链暗袋、靠左那一格"
                : "如 靠窗书桌左边第一层、床尾右侧"
            }
            maxLength={400}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        {mode === "edit" && !canDelete && (
          <p className="storage-delete-hint">
            {childCount > 0
              ? `下面还有 ${childCount} 个分区，请先删除分区后再删此箱子。`
              : `里面还有 ${insideCount} 件关联物品（含已取出未归位），移走或清空后才能删除。`}
          </p>
        )}

        <footer className="storage-modal-foot">
          <div>
            {mode === "edit" && (
              <button
                type="button"
                className="danger muted"
                disabled={!canDelete || saving}
                onClick={() => void deleteBox()}
              >
                {isSub ? "删除分区" : "删除箱子"}
              </button>
            )}
          </div>
          <div className="storage-modal-foot-right">
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!name.trim() || (!isSub && !zone.trim()) || saving}
            >
              保存
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function MoveItemModal({
  item,
  options,
  onClose,
  onMove,
}: {
  item: Entity;
  options: FlatBoxOption[];
  onClose: () => void;
  onMove: (targetBoxId: string) => void;
}) {
  const currentId = str(item, "boxId");
  const homeId = str(item, "homeBoxId");
  const isOut = item.data.status === "out";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal storage-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>移动「{str(item, "name")}」到哪个位置？</h2>
          <button type="button" className="muted" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="storage-move-list">
          {options.map((opt) => {
            const b = opt.box;
            const isCurrent = !isOut && b.id === currentId;
            const isHome = b.id === homeId;
            return (
              <button
                key={b.id}
                type="button"
                className={
                  "storage-move-opt" +
                  (isCurrent ? " current" : "") +
                  (opt.depth > 0 ? " nested" : "")
                }
                style={opt.depth > 0 ? { paddingLeft: 14 + opt.depth * 18 } : undefined}
                disabled={isCurrent}
                onClick={() => onMove(b.id)}
              >
                {opt.depth > 0 ? (
                  <span className="storage-move-branch">↳</span>
                ) : (
                  <BoxGlyph icon={str(b, "icon")} size={16} />
                )}
                <span className="storage-move-label">
                  <strong>{str(b, "name")}</strong>
                  <small>
                    {opt.depth > 0 ? opt.fullLabel : str(b, "zone")}
                    {str(b, "location") ? ` · ${str(b, "location")}` : ""}
                  </small>
                </span>
                {isCurrent && <span className="pill">当前位置</span>}
                {!isCurrent && isHome && <span className="pill">常驻老家</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ItemEditorModal({
  item,
  options,
  onClose,
}: {
  item: Entity;
  options: FlatBoxOption[];
  onClose: () => void;
}) {
  const [name, setName] = useState(str(item, "name"));
  const [icon, setIcon] = useState(str(item, "icon"));
  const [pickingIcon, setPickingIcon] = useState(false);
  const [status, setStatus] = useState<"in_box" | "out">(
    item.data.status === "out" ? "out" : "in_box",
  );
  const [boxId, setBoxId] = useState(str(item, "boxId"));
  const [homeBoxId, setHomeBoxId] = useState(str(item, "homeBoxId"));
  const [quantity, setQuantity] = useState(
    String(typeof item.data.quantity === "number" ? item.data.quantity : 1),
  );
  const [aliases, setAliases] = useState(str(item, "aliases"));
  const [note, setNote] = useState(str(item, "note"));
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || saving) return;
    if (status === "in_box" && !boxId) return;
    const qtyNum = Math.max(
      1,
      Math.min(9999, Math.round(Number(quantity) || 1)),
    );
    setSaving(true);
    try {
      await saveEdit("storageItem", item.id, item.data, {
        ...item.data,
        name: cleanName,
        icon: isBuiltinItemIcon(icon.trim()) ? icon.trim() : null,
        status,
        boxId: boxId || null,
        homeBoxId: homeBoxId || null,
        takenAt:
          status === "out"
            ? str(item, "takenAt") || new Date().toISOString()
            : null,
        quantity: qtyNum,
        aliases: aliases.trim() || null,
        note: note.trim() || null,
        verifiedAt:
          status === "in_box"
            ? new Date().toISOString()
            : str(item, "verifiedAt") || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal storage-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void save(e)}
      >
        <header>
          <h2>物品详情</h2>
          <button type="button" className="muted" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="storage-form-row">
          <div className="storage-form-field">
            <label>图标</label>
            <button
              type="button"
              className="storage-item-icon-btn"
              title="点击从 180 枚线框图标中更换"
              onClick={() => setPickingIcon(true)}
            >
              <ItemVisual
                icon={icon}
                name={name}
                aliases={aliases}
                size={20}
              />
            </button>
          </div>
          <div className="storage-form-field" style={{ flex: 1 }}>
            <label>物品名称</label>
            <input
              value={name}
              maxLength={160}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="storage-form-field" style={{ width: 84 }}>
            <label>数量</label>
            <input
              type="number"
              min={1}
              max={9999}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
        </div>
        {isBuiltinItemIcon(icon) && (
          <div className="storage-icon-hint-row">
            <span>当前已选线框图标：{iconLabel(icon)}</span>
            <button
              type="button"
              className="muted"
              onClick={() => setIcon("")}
            >
              恢复自动匹配
            </button>
          </div>
        )}

        <div className="storage-form-field">
          <label>当前状态</label>
          <div className="segmented">
            <button
              type="button"
              className={status === "in_box" ? "active" : ""}
              onClick={() => setStatus("in_box")}
            >
              在箱内
            </button>
            <button
              type="button"
              className={status === "out" ? "active" : ""}
              onClick={() => setStatus("out")}
            >
              已取出使用中
            </button>
          </div>
        </div>

        <div className="storage-form-row">
          <div className="storage-form-field" style={{ flex: 1 }}>
            <label>
              {status === "in_box" ? "当前所在箱子/分区" : "从哪个位置取出"}
            </label>
            <select value={boxId} onChange={(e) => setBoxId(e.target.value)}>
              {status === "out" && <option value="">未指定</option>}
              {options.map((opt) => (
                <option key={opt.box.id} value={opt.box.id}>
                  {opt.fullLabel}
                </option>
              ))}
            </select>
          </div>
          <div className="storage-form-field" style={{ flex: 1 }}>
            <label>常驻老家（一键归位目标）</label>
            <select
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

        <div className="storage-form-field">
          <label>搜索别名 / 关键词（可选）</label>
          <input
            placeholder="如 蓝牙耳机 / 充电器 / 备用线"
            maxLength={200}
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
          />
        </div>

        <div className="storage-form-field">
          <label>备注（可选）</label>
          <textarea
            rows={3}
            placeholder="如 装在黑色小收纳袋里、贴了白色标签…"
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <footer className="storage-modal-foot">
          <div>
            <button
              type="button"
              className="danger muted"
              onClick={() => {
                perform(remove(item).then(onClose));
              }}
            >
              删除物品
            </button>
          </div>
          <div className="storage-modal-foot-right">
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!name.trim() || (status === "in_box" && !boxId) || saving}
            >
              保存
            </button>
          </div>
        </footer>
      </form>
      {pickingIcon && (
        <StorageIconPickerModal
          itemName={name || "物品"}
          currentIcon={icon || undefined}
          onSelect={(next) => {
            setIcon(next ?? "");
            setPickingIcon(false);
          }}
          onClose={() => setPickingIcon(false)}
        />
      )}
    </div>
  );
}
