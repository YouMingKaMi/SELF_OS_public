import React, { useEffect, useMemo, useRef, useState } from "react";
import "./memoir.css";
import {
  useEntities,
  put,
  remove,
  saveEdit,
  type AnyEntity as Entity,
} from "../data/entities.ts";
import { Heading, Empty, str, perform } from "../ui/shared.tsx";
import { Icon } from "../ui/Icon.tsx";
import { useMobileDetail } from "../ui/mobile-detail.ts";

export type MemoirPeriod =
  | "high_school"
  | "middle_school"
  | "primary_and_below";

const PERIODS: readonly { key: MemoirPeriod; label: string; hint: string }[] = [
  { key: "high_school", label: "高中", hint: "少年尾声与走向成年之前" },
  { key: "middle_school", label: "初中", hint: "青涩成长与初识世界" },
  { key: "primary_and_below", label: "小学及以下", hint: "童年、故乡与最初的记忆" },
];

const PERIOD_LABEL: Record<MemoirPeriod, string> = {
  high_school: "高中",
  middle_school: "初中",
  primary_and_below: "小学及以下",
};

function normalizePeriod(raw: unknown): MemoirPeriod {
  if (raw === "high_school" || raw === "middle_school" || raw === "primary_and_below") {
    return raw;
  }
  return "high_school";
}

function excerpt(detail: string): string {
  const flat = detail.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? flat.slice(0, 90) + "…" : flat;
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

export function Memoir({
  onOpenChronicle,
}: {
  onOpenChronicle?: () => void;
}) {
  const { entities } = useEntities("memoir");
  const [periodFilter, setPeriodFilter] = useState<"all" | MemoirPeriod>("all");
  const [chronological, setChronological] = useState(false); // false: 高中→小学, true: 小学→高中
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Quick capture bar state
  const [draftPeriod, setDraftPeriod] = useState<MemoirPeriod>("high_school");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftApprox, setDraftApprox] = useState("");
  const [creating, setCreating] = useState(false);

  const quickInputRef = useRef<HTMLInputElement>(null);

  const orderedPeriods = useMemo(
    () => (chronological ? [...PERIODS].reverse() : [...PERIODS]),
    [chronological],
  );

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entities
      .filter((e) => !e.deleted)
      .filter((e) => {
        const p = normalizePeriod(e.data.period);
        if (periodFilter !== "all" && p !== periodFilter) return false;
        if (!q) return true;
        return (
          str(e, "title").toLowerCase().includes(q) ||
          str(e, "approxTime").toLowerCase().includes(q) ||
          str(e, "detail").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const oa = typeof a.data.order === "number" ? a.data.order : Number.MAX_SAFE_INTEGER;
        const ob = typeof b.data.order === "number" ? b.data.order : Number.MAX_SAFE_INTEGER;
        if (oa !== ob) return oa - ob;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [entities, periodFilter, query]);

  const countsByPeriod = useMemo(() => {
    const counts: Record<MemoirPeriod, number> = {
      high_school: 0,
      middle_school: 0,
      primary_and_below: 0,
    };
    for (const e of entities) {
      if (!e.deleted) counts[normalizePeriod(e.data.period)] += 1;
    }
    return counts;
  }, [entities]);

  const grouped = useMemo(() => {
    const map = new Map<MemoirPeriod, Entity[]>();
    for (const p of orderedPeriods) map.set(p.key, []);
    for (const item of items) {
      map.get(normalizePeriod(item.data.period))?.push(item);
    }
    return orderedPeriods
      .map((p) => ({ ...p, items: map.get(p.key) ?? [] }))
      .filter((g) => periodFilter === "all" || g.key === periodFilter);
  }, [items, orderedPeriods, periodFilter]);

  const active = useMemo(
    () => entities.find((e) => !e.deleted && e.id === selectedId) ?? null,
    [entities, selectedId],
  );

  // Auto-select first item on wide screens if current selection disappeared
  useEffect(() => {
    if (selectedId && !active) {
      setSelectedId(items[0]?.id ?? null);
    }
  }, [selectedId, active, items]);

  async function handleQuickAdd(e?: React.FormEvent) {
    e?.preventDefault();
    const title = draftTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    try {
      const id = crypto.randomUUID();
      const approx = draftApprox.trim();
      await put(
        "memoir",
        {
          period: draftPeriod,
          title,
          ...(approx ? { approxTime: approx } : {}),
        },
        { id },
      );
      setDraftTitle("");
      setDraftApprox("");
      setSelectedId(id);
      if (periodFilter !== "all" && periodFilter !== draftPeriod) {
        setPeriodFilter("all");
      }
      mobileDetail.openDetail();
    } finally {
      setCreating(false);
    }
  }

  const totalCount = entities.filter((e) => !e.deleted).length;
  const mobileDetail = useMobileDetail(
    active ? str(active, "title") : "回忆详情",
  );

  return (
    <div className="memoir-page">
      {mobileDetail.showList && (
      <Heading
        eyebrow="MEMOIR · BEFORE UNIVERSITY"
        title="回忆录"
        description="大学之前的人生编年史——先记下事件标题，点进去慢慢写完记得的所有细节。"
      >
        <button
          type="button"
          onClick={() => setChronological((v) => !v)}
          title="切换时间轴方向"
        >
          {chronological ? "由早及近 ↑" : "由近及远 ↓"}
        </button>
        {onOpenChronicle && (
          <button type="button" onClick={onOpenChronicle}>
            编年史 <Icon name="arrow" size={13} />
          </button>
        )}
        <button
          type="button"
          className="primary"
          onClick={() => quickInputRef.current?.focus()}
        >
          ＋ 记一段回忆
        </button>
      </Heading>
      )}

      <div className="memoir-layout">
        {/* Left: Quick capture + Timeline Index */}
        {mobileDetail.showList && (
        <section className="memoir-sidebar" aria-label="回忆目录">
          <form className="memoir-capture" onSubmit={(e) => void handleQuickAdd(e)}>
            <div className="memoir-capture-periods" role="radiogroup" aria-label="选择阶段">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="radio"
                  aria-checked={draftPeriod === p.key}
                  className={draftPeriod === p.key ? "active" : ""}
                  onClick={() => setDraftPeriod(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              ref={quickInputRef}
              className="memoir-capture-title"
              placeholder="突然想起哪件事？写个大致标题，回车记下…"
              value={draftTitle}
              maxLength={400}
              onChange={(e) => setDraftTitle(e.target.value)}
            />
            <div className="memoir-capture-foot">
              <input
                className="memoir-capture-approx"
                placeholder="大致时间（可选，如 高二夏天 / 约十岁）"
                value={draftApprox}
                maxLength={80}
                onChange={(e) => setDraftApprox(e.target.value)}
              />
              <button
                type="submit"
                className={draftTitle.trim() ? "primary" : ""}
                disabled={!draftTitle.trim() || creating}
              >
                记下
              </button>
            </div>
          </form>

          <div className="memoir-controls">
            <div className="memoir-filter-tabs" role="tablist" aria-label="阶段筛选">
              <button
                type="button"
                role="tab"
                aria-selected={periodFilter === "all"}
                className={periodFilter === "all" ? "active" : ""}
                onClick={() => setPeriodFilter("all")}
              >
                全部 <small>{totalCount}</small>
              </button>
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={periodFilter === p.key}
                  className={periodFilter === p.key ? "active" : ""}
                  onClick={() => setPeriodFilter(p.key)}
                >
                  {p.label} <small>{countsByPeriod[p.key]}</small>
                </button>
              ))}
            </div>
            <input
              className="memoir-search"
              placeholder="搜索标题、时间或细节…"
              aria-label="搜索回忆录"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="memoir-timeline">
            {items.length === 0 ? (
              <div className="memoir-empty-list">
                <Empty
                  text={
                    query.trim()
                      ? "没有找到相关的回忆"
                      : "还没有记下这个阶段的回忆，在上方留一个标题即可开始。"
                  }
                />
              </div>
            ) : (
              grouped.map((group) => {
                if (group.items.length === 0 && periodFilter === "all") return null;
                return (
                  <div className="memoir-group" key={group.key}>
                    <div className="memoir-group-head">
                      <strong>{group.label}</strong>
                      <span>{group.items.length} 段</span>
                    </div>
                    <div className="memoir-group-list">
                      {group.items.map((item) => {
                        const detail = str(item, "detail");
                        const approx = str(item, "approxTime");
                        const isSelected = active?.id === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={"memoir-card" + (isSelected ? " selected" : "")}
                            onClick={() => {
                              setSelectedId(item.id);
                              mobileDetail.openDetail();
                            }}
                          >
                            <div className="memoir-card-top">
                              <strong className="memoir-card-title">
                                {str(item, "title")}
                              </strong>
                              {approx && (
                                <span className="memoir-card-approx">{approx}</span>
                              )}
                            </div>
                            {detail.trim() ? (
                              <p className="memoir-card-excerpt">{excerpt(detail)}</p>
                            ) : (
                              <p className="memoir-card-placeholder">
                                点进去补写回忆细节…
                              </p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
        )}

        {/* Right: Detail Reader / Editor */}
        {mobileDetail.showDetail && (
        <section className="memoir-detail-pane" aria-label="回忆详情">
          {active ? (
            <MemoirDetailEditor
              key={active.id}
              entity={active}
              onDeleted={() => {
                const rest = items.filter((i) => i.id !== active.id);
                setSelectedId(rest[0]?.id ?? null);
                mobileDetail.closeDetail();
              }}
            />
          ) : (
            <div className="memoir-detail-empty">
              <div className="memoir-detail-empty-inner">
                <strong>大学之前的记忆档案</strong>
                <p>
                  想到某件过去发生的事，先在左侧选好「高中 / 初中 / 小学及以下」写下大致事件作为标题；
                  随时点进来，把你还记得的人物、场景、对话和感受全部写下来。
                </p>
                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedId(items[0]!.id)}
                  >
                    打开最近一段回忆
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
        )}
      </div>
    </div>
  );
}

function MemoirDetailEditor({
  entity,
  onDeleted,
}: {
  entity: Entity;
  onDeleted: () => void;
}) {
  const [period, setPeriod] = useState<MemoirPeriod>(
    normalizePeriod(entity.data.period),
  );
  const [title, setTitle] = useState(str(entity, "title"));
  const [approxTime, setApproxTime] = useState(str(entity, "approxTime"));
  const [detail, setDetail] = useState(str(entity, "detail"));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync external updates when not locally dirty
  const basePeriod = normalizePeriod(entity.data.period);
  const baseTitle = str(entity, "title");
  const baseApprox = str(entity, "approxTime");
  const baseDetail = str(entity, "detail");

  const dirty =
    period !== basePeriod ||
    title.trim() !== baseTitle ||
    approxTime.trim() !== baseApprox ||
    detail !== baseDetail;

  useEffect(() => {
    setPeriod(normalizePeriod(entity.data.period));
    setTitle(str(entity, "title"));
    setApproxTime(str(entity, "approxTime"));
    setDetail(str(entity, "detail"));
    setConfirmDelete(false);
  }, [entity.id, entity.version]);

  async function saveNow() {
    const cleanTitle = title.trim();
    if (!cleanTitle || !dirty || saving) return;
    setSaving(true);
    try {
      const nextData = {
        ...entity.data,
        period,
        title: cleanTitle,
        approxTime: approxTime.trim() || undefined,
        detail: detail || undefined,
      };
      await saveEdit("memoir", entity.id, entity.data, nextData);
    } finally {
      setSaving(false);
    }
  }

  // Cmd/Ctrl+S shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Gentle auto-save after 1.4s of idle typing
  useEffect(() => {
    if (!dirty || !title.trim() || saving) return;
    const timer = window.setTimeout(() => {
      void saveNow();
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [period, title, approxTime, detail, dirty, saving]);

  const charCount = detail.trim().length;

  return (
    <div className="memoir-editor">
      <div className="memoir-editor-bar">
        <div className="memoir-editor-meta">
          <div className="memoir-period-pills" role="radiogroup" aria-label="人生阶段">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={period === p.key}
                className={period === p.key ? "active" : ""}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            className="memoir-approx-input"
            placeholder="大致时间（如 高二下学期、初一暑假…）"
            aria-label="大致时间"
            maxLength={80}
            value={approxTime}
            onChange={(e) => setApproxTime(e.target.value)}
            onBlur={() => void saveNow()}
          />
        </div>

        <div className="memoir-editor-actions">
          <span className="memoir-save-state">
            {saving ? "保存中…" : dirty ? "待保存" : "已保存"}
          </span>
          {dirty && (
            <button
              type="button"
              className="primary"
              disabled={!title.trim() || saving}
              onClick={() => void saveNow()}
            >
              保存
            </button>
          )}
          {confirmDelete ? (
            <span className="memoir-confirm-del">
              <button
                type="button"
                className="danger"
                onClick={() => {
                  perform(remove(entity).then(onDeleted));
                }}
              >
                确认删除
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)}>
                取消
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="muted"
              onClick={() => setConfirmDelete(true)}
            >
              删除
            </button>
          )}
        </div>
      </div>

      <input
        className="memoir-editor-title"
        aria-label="事件标题"
        placeholder="用一句话概括这件事…"
        maxLength={400}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void saveNow()}
      />

      <textarea
        className="memoir-editor-detail"
        aria-label="回忆细节"
        placeholder={`写下你还记得的所有细节——当时的天气、地方、同行的人、说过的话或后来的想法……\n\n不必一次写完，以后突然想起更多细节随时回来补充。`}
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        onBlur={() => void saveNow()}
      />

      <div className="memoir-editor-foot">
        <span>
          {PERIOD_LABEL[period]}
          {approxTime.trim() ? ` · ${approxTime.trim()}` : ""}
        </span>
        <span>
          {charCount > 0 ? `${charCount.toLocaleString("zh-CN")} 字` : "尚无细节"}
          {entity.updatedAt ? ` · 更新于 ${formatUpdated(entity.updatedAt)}` : ""}
        </span>
      </div>
    </div>
  );
}
