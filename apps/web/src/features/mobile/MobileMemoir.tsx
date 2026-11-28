import React, { useEffect, useMemo, useRef, useState } from "react";
import "./mobile-writing.css";
import { Icon } from "../../ui/Icon.tsx";
import { perform, str } from "../../ui/shared.tsx";
import {
  put,
  remove,
  saveEdit,
  useEntities,
  type AnyEntity as Entity,
} from "../../data/entities.ts";
import {
  InkActionSheet,
  InkCard,
  InkChipBar,
  InkComposer,
  InkEmpty,
  InkHairline,
  InkNavIcon,
  InkNavText,
  InkScreen,
  InkSearch,
  InkSectionLabel,
  InkSegmented,
  InkSheet,
  MobileSubPage,
  MobileToolbar,
  type ActionSheetItem,
} from "./MobileKit.tsx";

type MemoirPeriod = "high_school" | "middle_school" | "primary_and_below";

const PERIODS: readonly { key: MemoirPeriod; label: string; short: string }[] = [
  { key: "high_school", label: "高中", short: "高中" },
  { key: "middle_school", label: "初中", short: "初中" },
  { key: "primary_and_below", label: "小学及以下", short: "小学" },
];

const PERIOD_LABEL: Record<MemoirPeriod, string> = {
  high_school: "高中",
  middle_school: "初中",
  primary_and_below: "小学及以下",
};

const PERIOD_SHORT: Record<MemoirPeriod, string> = {
  high_school: "高中",
  middle_school: "初中",
  primary_and_below: "小学",
};

function normalizePeriod(raw: unknown): MemoirPeriod {
  if (
    raw === "high_school" ||
    raw === "middle_school" ||
    raw === "primary_and_below"
  ) {
    return raw;
  }
  return "high_school";
}

function nextPeriod(cur: MemoirPeriod): MemoirPeriod {
  if (cur === "high_school") return "middle_school";
  if (cur === "middle_school") return "primary_and_below";
  return "high_school";
}

function snippetOf(detail: string): string {
  const flat = detail.replace(/\s+/g, " ").trim();
  return flat.length > 96 ? flat.slice(0, 96) + "…" : flat;
}

function formatUpdated(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function MobileMemoir({
  onOpenChronicle,
}: {
  onOpenChronicle?: () => void;
}) {
  const { entities } = useEntities("memoir");
  const [periodFilter, setPeriodFilter] = useState<"all" | MemoirPeriod>("all");
  const [chronological, setChronological] = useState(false); // false: 高中→小学, true: 小学→高中
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  // Bottom quick composer
  const [draftPeriod, setDraftPeriod] = useState<MemoirPeriod>("high_school");
  const [quickTitle, setQuickTitle] = useState("");
  const [quickSubmitting, setQuickSubmitting] = useState(false);

  // Quick Add Sheet (+ button)
  const [createOpen, setCreateOpen] = useState(false);
  const [newPeriod, setNewPeriod] = useState<MemoirPeriod>("high_school");
  const [newTitle, setNewTitle] = useState("");
  const [newApprox, setNewApprox] = useState("");
  const [newDetail, setNewDetail] = useState("");
  const [creating, setCreating] = useState(false);

  // Top-right more menu
  const [listMenuOpen, setListMenuOpen] = useState(false);

  const orderedPeriods = useMemo(
    () => (chronological ? [...PERIODS].reverse() : [...PERIODS]),
    [chronological],
  );

  const allItems = useMemo(() => {
    return entities
      .filter((e) => !e.deleted)
      .sort((a, b) => {
        const oa =
          typeof a.data.order === "number" ? a.data.order : Number.MAX_SAFE_INTEGER;
        const ob =
          typeof b.data.order === "number" ? b.data.order : Number.MAX_SAFE_INTEGER;
        if (oa !== ob) return oa - ob;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [entities]);

  const counts = useMemo(() => {
    const c: Record<MemoirPeriod, number> = {
      high_school: 0,
      middle_school: 0,
      primary_and_below: 0,
    };
    for (const item of allItems) {
      c[normalizePeriod(item.data.period)] += 1;
    }
    return c;
  }, [allItems]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allItems.filter((item) => {
      if (periodFilter !== "all" && normalizePeriod(item.data.period) !== periodFilter) {
        return false;
      }
      if (!q) return true;
      return (
        str(item, "title").toLowerCase().includes(q) ||
        str(item, "approxTime").toLowerCase().includes(q) ||
        str(item, "detail").toLowerCase().includes(q)
      );
    });
  }, [allItems, periodFilter, query]);

  const grouped = useMemo(() => {
    const map = new Map<MemoirPeriod, Entity[]>();
    for (const p of orderedPeriods) map.set(p.key, []);
    for (const item of filteredItems) {
      map.get(normalizePeriod(item.data.period))?.push(item);
    }
    return orderedPeriods
      .map((p) => ({ ...p, items: map.get(p.key) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [filteredItems, orderedPeriods]);

  const openEntry = useMemo(
    () => (openId ? allItems.find((e) => e.id === openId) ?? null : null),
    [allItems, openId],
  );

  function handleChangeFilter(next: "all" | MemoirPeriod) {
    setPeriodFilter(next);
    if (next !== "all") setDraftPeriod(next);
  }

  function openCreateSheet() {
    setNewPeriod(periodFilter === "all" ? draftPeriod : periodFilter);
    setNewTitle("");
    setNewApprox("");
    setNewDetail("");
    setCreateOpen(true);
  }

  async function submitQuickComposer() {
    const title = quickTitle.trim();
    if (!title || quickSubmitting) return;
    setQuickSubmitting(true);
    try {
      const id = crypto.randomUUID();
      const targetPeriod = draftPeriod;
      await put("memoir", { period: targetPeriod, title }, { id });
      setQuickTitle("");
      if (periodFilter !== "all" && periodFilter !== targetPeriod) {
        setPeriodFilter("all");
      }
      setOpenId(id);
    } finally {
      setQuickSubmitting(false);
    }
  }

  async function submitCreateSheet() {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    try {
      const id = crypto.randomUUID();
      const approx = newApprox.trim();
      await put(
        "memoir",
        {
          period: newPeriod,
          title,
          ...(approx ? { approxTime: approx } : {}),
          ...(newDetail ? { detail: newDetail } : {}),
        },
        { id },
      );
      setCreateOpen(false);
      if (periodFilter !== "all" && periodFilter !== newPeriod) {
        setPeriodFilter("all");
      }
      setOpenId(id);
    } finally {
      setCreating(false);
    }
  }

  const listMenuItems: ActionSheetItem[] = useMemo(() => {
    const list: ActionSheetItem[] = [
      {
        label: "由近及远（高中 → 小学）",
        active: !chronological,
        icon: !chronological ? "check" : undefined,
        onClick: () => setChronological(false),
      },
      {
        label: "由早及近（小学 → 高中）",
        active: chronological,
        icon: chronological ? "check" : undefined,
        onClick: () => setChronological(true),
      },
    ];
    if (onOpenChronicle) {
      list.push({
        label: "前往编年史",
        icon: "chronicle",
        onClick: onOpenChronicle,
      });
    }
    return list;
  }, [chronological, onOpenChronicle]);

  // PUSHED DETAIL EDITOR VIEW
  if (openId !== null) {
    return (
      <MobileMemoirDetail
        key={openId}
        entry={openEntry}
        onBack={() => setOpenId(null)}
        onDeleted={() => setOpenId(null)}
      />
    );
  }

  // LIST SCREEN
  return (
    <InkScreen hasComposer>
      <MobileToolbar>
        <InkNavIcon
          icon="ellipsis"
          label="排序与更多"
          onClick={() => setListMenuOpen(true)}
        />
        <InkNavIcon
          icon="plus"
          label="新建回忆"
          onClick={openCreateSheet}
        />
      </MobileToolbar>

      <InkSearch
        value={query}
        onChange={setQuery}
        placeholder="搜索事件标题、大致时间或细节…"
      />

      <InkChipBar
        size="sm"
        value={periodFilter}
        onChange={handleChangeFilter}
        items={[
          { value: "all", label: "全部", count: allItems.length },
          { value: "high_school", label: "高中", count: counts.high_school },
          { value: "middle_school", label: "初中", count: counts.middle_school },
          {
            value: "primary_and_below",
            label: "小学及以下",
            count: counts.primary_and_below,
          },
        ]}
      />

      {grouped.length === 0 ? (
        <InkCard>
          {query.trim() ? (
            <InkEmpty text="没有找到相关回忆，换个关键词试试" />
          ) : (
            <div className="mw-empty-hero">
              <h3>大学之前的记忆档案</h3>
              <p>
                突然想起一件大学前的事，可以在下方先写下标题记下，点进去慢慢补全所有细节。
              </p>
              <button
                type="button"
                className="mk-pill solid"
                onClick={openCreateSheet}
              >
                <Icon name="plus" size={15} />
                <span>写下第一段回忆</span>
              </button>
            </div>
          )}
        </InkCard>
      ) : (
        grouped.map((group) => (
          <React.Fragment key={group.key}>
            <InkSectionLabel title={group.label} aside={`${group.items.length} 段`} />
            <InkCard variant="compact">
              {group.items.map((item, idx) => {
                const title = str(item, "title") || "未命名回忆";
                const approx = str(item, "approxTime");
                const detail = str(item, "detail");
                const snippet = detail.trim() ? snippetOf(detail) : "";
                return (
                  <React.Fragment key={item.id}>
                    {idx > 0 && <InkHairline />}
                    <button
                      type="button"
                      className="mw-doc-row"
                      onClick={() => setOpenId(item.id)}
                    >
                      <div className="mw-doc-row-main">
                        <div className="mw-memoir-row-top">
                          <div className="mw-doc-row-title">{title}</div>
                          {approx && (
                            <span className="mw-memoir-approx">{approx}</span>
                          )}
                        </div>
                        {snippet ? (
                          <div className="mw-doc-row-excerpt">{snippet}</div>
                        ) : (
                          <div className="mw-memoir-placeholder">
                            点进去补写回忆细节…
                          </div>
                        )}
                      </div>
                      <span className="mk-row-chevron" aria-hidden="true">
                        <Icon name="chevron-right" size={16} />
                      </span>
                    </button>
                  </React.Fragment>
                );
              })}
            </InkCard>
          </React.Fragment>
        ))
      )}

      <InkComposer
        value={quickTitle}
        onChange={setQuickTitle}
        onSubmit={() => perform(submitQuickComposer())}
        disabled={quickSubmitting}
        placeholder="记下一段回忆标题…"
        leftSlot={
          <button
            type="button"
            className="mw-composer-period"
            aria-label={`切换阶段（当前：${PERIOD_LABEL[draftPeriod]}）`}
            onClick={() => setDraftPeriod((p) => nextPeriod(p))}
          >
            {PERIOD_SHORT[draftPeriod]}
          </button>
        }
      />

      <InkActionSheet
        open={listMenuOpen}
        title="回忆录"
        items={listMenuItems}
        onClose={() => setListMenuOpen(false)}
      />

      <InkSheet
        open={createOpen}
        title="记一段回忆"
        onClose={() => setCreateOpen(false)}
        rightLabel={creating ? "保存中…" : "保存"}
        rightDisabled={creating || !newTitle.trim()}
        onRight={() => perform(submitCreateSheet())}
      >
        <InkSegmented
          onCard
          value={newPeriod}
          onChange={setNewPeriod}
          options={PERIODS.map((p) => ({ value: p.key, label: p.label }))}
        />
        <div className="mk-form-group">
          <div className="mk-form-row col">
            <span className="mk-form-label">事件标题</span>
            <input
              type="text"
              className="mk-form-input"
              maxLength={400}
              placeholder="大致事件描述…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </div>
          <div className="mk-form-row col">
            <span className="mk-form-label">大致时间（可选）</span>
            <input
              type="text"
              className="mk-form-input"
              maxLength={80}
              placeholder="如 高二秋天、大概十岁"
              value={newApprox}
              onChange={(e) => setNewApprox(e.target.value)}
            />
          </div>
        </div>
        <textarea
          className="mk-field-textarea"
          rows={6}
          placeholder="写下你还记得的细节（可选，也可以之后点进去慢慢补写）…"
          value={newDetail}
          onChange={(e) => setNewDetail(e.target.value)}
        />
      </InkSheet>
    </InkScreen>
  );
}

/* ─────────────────────────── Pushed Memoir Detail Editor ─────────────────────────── */

function MobileMemoirDetail({
  entry,
  onBack,
  onDeleted,
}: {
  entry: Entity | null;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [period, setPeriod] = useState<MemoirPeriod>(
    normalizePeriod(entry?.data.period),
  );
  const [title, setTitle] = useState(str(entry ?? undefined, "title"));
  const [approxTime, setApproxTime] = useState(str(entry ?? undefined, "approxTime"));
  const [detail, setDetail] = useState(str(entry ?? undefined, "detail"));
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [toast, setToast] = useState("");

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const detailRef = useRef<HTMLTextAreaElement>(null);

  const basePeriod = normalizePeriod(entry?.data.period);
  const baseTitle = str(entry ?? undefined, "title");
  const baseApprox = str(entry ?? undefined, "approxTime");
  const baseDetail = str(entry ?? undefined, "detail");

  const dirty = Boolean(
    entry &&
      (period !== basePeriod ||
        title.trim() !== baseTitle ||
        approxTime.trim() !== baseApprox ||
        detail !== baseDetail),
  );

  // Sync initial load & external updates when local editor isn't dirty
  const initializedIdRef = useRef<string | null>(entry?.id ?? null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!entry) return;
    if (initializedIdRef.current !== entry.id || !dirtyRef.current) {
      initializedIdRef.current = entry.id;
      setPeriod(normalizePeriod(entry.data.period));
      setTitle(str(entry, "title"));
      setApproxTime(str(entry, "approxTime"));
      setDetail(str(entry, "detail"));
    }
  }, [entry?.id, entry?.version]);

  // Auto-grow textareas
  useEffect(() => {
    const resize = (el: HTMLTextAreaElement | null) => {
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    resize(titleRef.current);
    resize(detailRef.current);
  }, [title, detail]);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? "" : cur)), 2000);
  }

  async function saveNow() {
    const cleanTitle = title.trim();
    if (!entry || !cleanTitle || !dirty || saving) return;
    setSaving(true);
    try {
      const nextData = {
        ...entry.data,
        period,
        title: cleanTitle,
        approxTime: approxTime.trim() || undefined,
        detail: detail || undefined,
      };
      await saveEdit("memoir", entry.id, entry.data, nextData);
    } finally {
      setSaving(false);
    }
  }

  // Gentle auto-save after 1.4s idle
  useEffect(() => {
    if (!entry || !dirty || !title.trim() || saving) return;
    const timer = window.setTimeout(() => {
      void saveNow();
    }, 1400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, period, title, approxTime, detail, dirty, saving]);

  function handleBack() {
    if (entry && dirty && title.trim() && !saving) {
      perform(saveNow());
    }
    onBack();
  }

  const menuItems: ActionSheetItem[] = useMemo(() => {
    if (!entry) return [];
    return [
      {
        label: "复制这段回忆",
        icon: "copy",
        onClick: () => {
          const text = [title.trim(), approxTime.trim(), detail]
            .filter(Boolean)
            .join("\n\n");
          perform(navigator.clipboard.writeText(text).then(() => flash("已复制")));
        },
      },
      {
        label: "删除这段回忆",
        icon: "trash",
        danger: true,
        onClick: () => setConfirmDeleteOpen(true),
      },
    ];
  }, [entry, title, approxTime, detail]);

  const charCount = detail.trim().length;

  return (
    <MobileSubPage
      title={title.trim() || "回忆详情"}
      onBack={handleBack}
      right={
        entry ? (
          <>
            {dirty && (
              <InkNavText
                label={saving ? "保存中…" : "保存"}
                solid
                disabled={saving || !title.trim()}
                onClick={() => perform(saveNow())}
              />
            )}
            <InkNavIcon
              icon="ellipsis"
              label="更多操作"
              onClick={() => setMenuOpen(true)}
            />
          </>
        ) : undefined
      }
    >
      <InkScreen>
        {!entry ? (
          <InkCard>
            <InkEmpty text="这条回忆已被移除。" />
          </InkCard>
        ) : (
          <div className="mw-editor">
            <InkSegmented
              value={period}
              onChange={setPeriod}
              options={PERIODS.map((p) => ({ value: p.key, label: p.label }))}
            />

            <textarea
              ref={titleRef}
              rows={1}
              maxLength={400}
              className="mw-editor-title"
              aria-label="事件标题"
              placeholder="用一句话概括这件事…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void saveNow()}
            />

            <input
              type="text"
              maxLength={80}
              className="mw-editor-sub-input"
              aria-label="大致时间"
              placeholder="大致时间（可选，如 高二秋天、大概十岁…）"
              value={approxTime}
              onChange={(e) => setApproxTime(e.target.value)}
              onBlur={() => void saveNow()}
            />

            <InkHairline />

            <textarea
              ref={detailRef}
              className="mw-editor-body"
              aria-label="回忆细节"
              placeholder="写下你还记得的所有细节——时间地点、一起的人、发生了什么、当时的心情…"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              onBlur={() => void saveNow()}
            />

            <div className="mw-editor-foot">
              <span>
                {PERIOD_LABEL[period]}
                {approxTime.trim() ? ` · ${approxTime.trim()}` : ""}
              </span>
              <span>
                {charCount > 0 ? `${charCount.toLocaleString("zh-CN")} 字` : "尚无细节"}
                {" · "}
                {saving
                  ? "保存中…"
                  : dirty
                    ? "待保存"
                    : entry.updatedAt
                      ? `已保存 · ${formatUpdated(entry.updatedAt)}`
                      : "已保存"}
              </span>
            </div>
          </div>
        )}

        <InkActionSheet
          open={menuOpen}
          title={title.trim() || "回忆"}
          items={menuItems}
          onClose={() => setMenuOpen(false)}
        />

        <InkActionSheet
          open={confirmDeleteOpen}
          title="确认删除这段回忆？"
          items={[
            {
              label: "删除回忆",
              icon: "trash",
              danger: true,
              onClick: () => {
                if (!entry) return;
                perform(remove(entry).then(onDeleted));
              },
            },
          ]}
          onClose={() => setConfirmDeleteOpen(false)}
        />

        {toast && <div className="mw-toast">{toast}</div>}
      </InkScreen>
    </MobileSubPage>
  );
}
