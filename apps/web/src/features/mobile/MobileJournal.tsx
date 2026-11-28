import React, { useEffect, useMemo, useRef, useState } from "react";
import "./mobile-writing.css";
import { Icon } from "../../ui/Icon.tsx";
import { monthNow, perform, str, today, usePreference } from "../../ui/shared.tsx";
import {
  put,
  remove,
  saveEdit,
  transferJournalText,
  undoPending,
  useDatedEntities,
  useEntities,
  usePending,
  type AnyEntity as Entity,
} from "../../data/entities.ts";
import {
  InkActionSheet,
  InkCard,
  InkChipBar,
  InkComposer,
  InkDayStrip,
  InkEmpty,
  InkHairline,
  InkMonthBar,
  InkNavText,
  InkRing,
  InkScreen,
  InkSectionLabel,
  InkSegmented,
  InkSheet,
  InkSwitch,
  MobileToolbar,
  shiftDay,
  shortDate,
  weekdayChar,
  type ActionSheetItem,
} from "./MobileKit.tsx";

export type JournalTarget = {
  kind: "idea" | "raw";
  day: string;
  id: string;
};

const MAX_IDEA_TRANSFER_UNITS = 100_000;

function formatTransferError(err: unknown): string {
  const code = err instanceof Error ? err.message : String(err ?? "");
  switch (code) {
    case "INVALID_TRANSFER_SOURCE":
      return "当前记录无法迁移，可能已被修改或移除。";
    case "INVALID_TRANSFER_SELECTION":
      return "选中的文字范围无效，请重新拖选一段非空正文。";
    case "TRANSFER_TOO_LONG":
      return "选段超过想法暂存单条长度上限（100,000 字符），请缩小选区后再移动。";
    default:
      return code || "迁移失败，请刷新原文后重试。";
  }
}

export function MobileJournal({
  kind,
  onOpenMemoir,
  onOpenTarget,
  focus,
  onConsumeFocus,
}: {
  kind: "chronicle" | "raw" | "idea";
  onOpenMemoir?: () => void;
  onOpenTarget?: (target: { kind: "idea" | "raw"; day: string; id: string }) => void;
  focus?: { kind: "idea" | "raw"; day: string; id: string };
  onConsumeFocus?: () => void;
}) {
  if (kind === "chronicle") {
    return <MobileChronicleScreen onOpenMemoir={onOpenMemoir} />;
  }
  if (kind === "raw") {
    return (
      <MobileRawScreen
        onOpenTarget={onOpenTarget}
        focus={focus}
        onConsumeFocus={onConsumeFocus}
      />
    );
  }
  return (
    <MobileIdeaScreen
      onOpenTarget={onOpenTarget}
      focus={focus}
      onConsumeFocus={onConsumeFocus}
    />
  );
}

/* ─────────────────────────── 1. Chronicle (编年史) ─────────────────────────── */

function MobileChronicleScreen({
  onOpenMemoir,
}: {
  onOpenMemoir?: () => void;
}) {
  const nowDay = today();
  const [viewMode, setViewMode] = useState<"day" | "month">("day");
  const [day, setDay] = useState(nowDay);
  const [month, setMonth] = useState(monthNow());
  const [draft, setDraft] = usePreference("draft-chronicle", "");
  const [editing, setEditing] = useState<Entity | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editDay, setEditDay] = useState(nowDay);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState("");

  const pending = usePending();
  const queuedIds = useMemo(() => {
    const map = new Map<string, string>();
    for (const op of pending) map.set(op.entityId, op.state);
    return map;
  }, [pending]);

  // Load 28-day strip range + current month cleanly without loading all history
  const stripAnchor = day > nowDay ? day : nowDay;
  const stripFrom = shiftDay(day < stripAnchor ? day : stripAnchor, -28);
  const stripThrough = shiftDay(stripAnchor, 7);
  const stripRowsRaw = useDatedEntities(stripFrom, stripThrough, "journal");
  const monthRowsRaw = useDatedEntities(`${month}-01`, `${month}-31`, "journal");

  const stripRows = useMemo(
    () => stripRowsRaw.filter((e) => e.data.kind === "chronicle"),
    [stripRowsRaw],
  );
  const monthRows = useMemo(
    () => monthRowsRaw.filter((e) => e.data.kind === "chronicle"),
    [monthRowsRaw],
  );

  const markedDays = useMemo(() => {
    const set = new Set<string>();
    for (const e of stripRows) {
      const d = str(e, "day");
      if (d) set.add(d);
    }
    return set;
  }, [stripRows]);

  const dayRows = useMemo(() => {
    const source = day.startsWith(month + "-") ? monthRows : stripRows;
    return source
      .filter((e) => e.data.day === day)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }, [day, month, monthRows, stripRows]);

  const monthByDay = useMemo(() => {
    const groups = new Map<string, Entity[]>();
    for (const e of monthRows) {
      const d = str(e, "day");
      if (!d) continue;
      const list = groups.get(d);
      if (list) list.push(e);
      else groups.set(d, [e]);
    }
    const sortedDays = [...groups.keys()].sort((a, b) => b.localeCompare(a));
    return sortedDays.map((d) => ({
      day: d,
      items: (groups.get(d) ?? []).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
    }));
  }, [monthRows]);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? "" : cur)), 2000);
  }

  function handleSelectDay(next: string) {
    setDay(next);
    setMonth(next.slice(0, 7));
  }

  function openEdit(e: Entity) {
    setEditing(e);
    setEditBody(str(e, "body"));
    setEditDay(str(e, "day") || today());
    setConfirmDelete(false);
  }

  async function submitNew() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const targetDay = viewMode === "day" ? day : today();
    await put("journal", {
      kind: "chronicle",
      day: targetDay,
      body: text,
      complete: false,
    });
  }

  async function saveEditRow() {
    if (!editing || saving || !editBody.trim()) return;
    setSaving(true);
    try {
      await saveEdit("journal", editing.id, editing.data, {
        ...editing.data,
        body: editBody,
        day: editDay || str(editing, "day"),
      });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  function renderEntryRow(e: Entity, idx: number) {
    const isQueued = queuedIds.get(e.id) === "queued";
    return (
      <React.Fragment key={e.id}>
        {idx > 0 && <InkHairline />}
        <button type="button" className="mw-journal-row" onClick={() => openEdit(e)}>
          <div className="mw-journal-body-col">
            <div className="mw-journal-text">{str(e, "body")}</div>
          </div>
          {isQueued && (
            <span className="mw-sync-icon" aria-label="待同步">
              <Icon name="sync" size={13} />
            </span>
          )}
        </button>
      </React.Fragment>
    );
  }

  return (
    <InkScreen hasComposer>
      <MobileToolbar>
        <InkNavText
          label={viewMode === "day" ? "月视图" : "日视图"}
          onClick={() => setViewMode((m) => (m === "day" ? "month" : "day"))}
        />
        {onOpenMemoir && <InkNavText label="回忆录" onClick={onOpenMemoir} />}
      </MobileToolbar>

      {viewMode === "day" ? (
        <>
          <InkDayStrip day={day} onChange={handleSelectDay} markedDays={markedDays} />
          <InkSectionLabel
            title={day === nowDay ? "今天" : shortDate(day)}
            aside={`${dayRows.length} 件事`}
          />
          {dayRows.length > 0 ? (
            <InkCard variant="compact">
              {dayRows.map((e, i) => renderEntryRow(e, i))}
            </InkCard>
          ) : (
            <InkCard>
              <InkEmpty
                text={day === nowDay ? "这一天还空着，从下面写第一件。" : "这一天没有记录"}
              />
            </InkCard>
          )}
        </>
      ) : (
        <>
          <InkMonthBar month={month} onChange={setMonth} />
          <InkSectionLabel
            title={`${monthRows.length} 件事`}
            aside={`${monthByDay.length} 天有记录`}
          />
          {monthByDay.length === 0 ? (
            <InkCard>
              <InkEmpty text="这个月还没有记录" />
            </InkCard>
          ) : (
            monthByDay.map((group) => (
              <React.Fragment key={group.day}>
                <button
                  type="button"
                  className="mw-day-group-head"
                  onClick={() => {
                    handleSelectDay(group.day);
                    setViewMode("day");
                  }}
                >
                  <span className="mw-day-group-num">{Number(group.day.slice(8, 10))}</span>
                  <span className="mw-day-group-week">周{weekdayChar(group.day)}</span>
                  <span className="mw-day-group-tag">
                    {group.day === day ? "当前日" : `${group.items.length} 件`}
                  </span>
                </button>
                <InkCard variant="compact">
                  {group.items.map((e, i) => renderEntryRow(e, i))}
                </InkCard>
              </React.Fragment>
            ))
          )}
        </>
      )}

      <InkComposer
        value={draft}
        onChange={setDraft}
        onSubmit={() => perform(submitNew())}
        placeholder={
          viewMode === "day" && day !== nowDay
            ? `写下 ${shortDate(day)} 发生的事…`
            : "写下今天发生的事…"
        }
      />

      <InkSheet
        open={editing !== null}
        title="编辑记录"
        onClose={() => setEditing(null)}
        rightLabel={saving ? "保存中…" : "保存"}
        rightDisabled={saving || !editBody.trim()}
        onRight={() => perform(saveEditRow())}
      >
        {editing && (
          <>
            <div className="mk-form-group">
              <div className="mk-form-row">
                <span className="mk-form-label">日期</span>
                <input
                  type="date"
                  className="mk-form-input right"
                  value={editDay}
                  onChange={(e) => setEditDay(e.target.value)}
                />
              </div>
            </div>
            <textarea
              className="mk-field-textarea"
              rows={6}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              placeholder="记录内容…"
            />
            <div className="mw-sheet-actions">
              <button
                type="button"
                className="mk-pill sm"
                onClick={() => {
                  perform(
                    navigator.clipboard.writeText(editBody).then(() => flash("已复制")),
                  );
                }}
              >
                <Icon name="copy" size={14} />
                <span>复制</span>
              </button>
              {queuedIds.get(editing.id) === "queued" && (
                <button
                  type="button"
                  className="mk-pill sm"
                  onClick={() => {
                    const id = editing.id;
                    setEditing(null);
                    perform(undoPending(id));
                  }}
                >
                  <Icon name="undo" size={14} />
                  <span>撤销待发送</span>
                </button>
              )}
              <button
                type="button"
                className="mk-pill sm danger"
                style={{ marginLeft: "auto" }}
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true);
                    return;
                  }
                  const target = editing;
                  setEditing(null);
                  perform(remove(target));
                }}
              >
                <Icon name="trash" size={14} />
                <span>{confirmDelete ? "再点确认删除" : "删除"}</span>
              </button>
            </div>
          </>
        )}
      </InkSheet>

      {toast && <div className="mw-toast">{toast}</div>}
    </InkScreen>
  );
}

/* ─────────────────────────── 2. Raw Material (未加工原料) ─────────────────────────── */

function MobileRawScreen({
  onOpenTarget,
  focus,
  onConsumeFocus,
}: {
  onOpenTarget?: (target: JournalTarget) => void;
  focus?: JournalTarget;
  onConsumeFocus?: () => void;
}) {
  const nowDay = today();
  const [scope, setScope] = useState<"day" | "all">("day");
  const [day, setDay] = useState(nowDay);
  const [completeFilter, setCompleteFilter] = useState<"pending" | "all" | "done">("all");
  const [draft, setDraft] = usePreference("draft-raw", "");

  const [actionRow, setActionRow] = useState<Entity | null>(null);
  const [editing, setEditing] = useState<Entity | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editDay, setEditDay] = useState(nowDay);
  const [editComplete, setEditComplete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [transferring, setTransferring] = useState<Entity | null>(null);
  const [transferBanner, setTransferBanner] = useState<JournalTarget | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const pending = usePending();
  const queuedIds = useMemo(() => {
    const map = new Map<string, string>();
    for (const op of pending) map.set(op.entityId, op.state);
    return map;
  }, [pending]);

  const stripAnchor = day > nowDay ? day : nowDay;
  const stripFrom = shiftDay(day < stripAnchor ? day : stripAnchor, -28);
  const stripThrough = shiftDay(stripAnchor, 7);

  const rangeFrom = scope === "all" ? "0000-01-01" : stripFrom;
  const rangeThrough = scope === "all" ? "9999-12-31" : stripThrough;
  const loadedRows = useDatedEntities(rangeFrom, rangeThrough, "journal");

  const rawRows = useMemo(
    () => loadedRows.filter((e) => e.data.kind === "raw"),
    [loadedRows],
  );

  const markedDays = useMemo(() => {
    const set = new Set<string>();
    for (const e of rawRows) {
      const d = str(e, "day");
      if (d) set.add(d);
    }
    return set;
  }, [rawRows]);

  const dayRows = useMemo(
    () =>
      rawRows
        .filter((e) => e.data.day === day)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
    [rawRows, day],
  );

  const allGrouped = useMemo(() => {
    const filtered = rawRows.filter((e) => {
      const done = Boolean(e.data.complete);
      if (completeFilter === "pending") return !done;
      if (completeFilter === "done") return done;
      return true;
    });
    const groups = new Map<string, Entity[]>();
    for (const e of filtered) {
      const d = str(e, "day");
      if (!d) continue;
      const list = groups.get(d);
      if (list) list.push(e);
      else groups.set(d, [e]);
    }
    return [...groups.keys()]
      .sort((a, b) => b.localeCompare(a))
      .map((d) => ({
        day: d,
        items: (groups.get(d) ?? []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      }));
  }, [rawRows, completeFilter]);

  const rawCounts = useMemo(() => {
    let done = 0;
    for (const e of rawRows) if (e.data.complete) done += 1;
    return { total: rawRows.length, done, pending: rawRows.length - done };
  }, [rawRows]);

  const liveTransferSource = useMemo(
    () => (transferring ? rawRows.find((e) => e.id === transferring.id) : undefined),
    [rawRows, transferring],
  );

  useEffect(() => {
    if (!focus || focus.kind !== "raw") return;
    setDay(focus.day);
    setScope("day");
    setHighlightedId(focus.id);
    onConsumeFocus?.();
  }, [focus, onConsumeFocus]);

  useEffect(() => {
    if (!highlightedId) return;
    const node = document.querySelector<HTMLElement>(
      `[data-mw-journal-id="${CSS.escape(highlightedId)}"]`,
    );
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setHighlightedId(null), 3200);
    return () => window.clearTimeout(timer);
  }, [highlightedId, rawRows.length, day, scope]);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? "" : cur)), 2000);
  }

  function openEdit(e: Entity) {
    setEditing(e);
    setEditBody(str(e, "body"));
    setEditDay(str(e, "day") || today());
    setEditComplete(Boolean(e.data.complete));
    setConfirmDelete(false);
  }

  async function submitNew() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await put("journal", {
      kind: "raw",
      day: scope === "day" ? day : today(),
      body: text,
      complete: false,
    });
  }

  async function saveEditRow() {
    if (!editing || saving || !editBody.trim()) return;
    setSaving(true);
    try {
      await saveEdit("journal", editing.id, editing.data, {
        ...editing.data,
        body: editBody,
        day: editDay || str(editing, "day"),
        complete: editComplete,
      });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  function toggleComplete(e: Entity) {
    perform(
      saveEdit("journal", e.id, e.data, {
        ...e.data,
        complete: !e.data.complete,
      }),
    );
  }

  function renderRawRow(e: Entity, idx: number) {
    const done = Boolean(e.data.complete);
    const isQueued = queuedIds.get(e.id) === "queued";
    return (
      <React.Fragment key={e.id}>
        {idx > 0 && <InkHairline />}
        <button
          type="button"
          data-mw-journal-id={e.id}
          className={"mw-journal-row" + (highlightedId === e.id ? " highlighted" : "")}
          onClick={() => setActionRow(e)}
        >
          <div className="mw-journal-body-col">
            <div className={"mw-journal-text mono" + (done ? " done-raw" : "")}>
              {str(e, "body")}
            </div>
            {done && (
              <div className="mw-journal-meta">
                <span className="mw-pill-tag live">已处理</span>
              </div>
            )}
          </div>
          {isQueued && (
            <span className="mw-sync-icon" aria-label="待同步">
              <Icon name="sync" size={13} />
            </span>
          )}
        </button>
      </React.Fragment>
    );
  }

  const actionItems: ActionSheetItem[] = useMemo(() => {
    if (!actionRow) return [];
    const done = Boolean(actionRow.data.complete);
    const isQueued = queuedIds.get(actionRow.id) === "queued";
    const list: ActionSheetItem[] = [
      {
        label: "编辑原文",
        icon: "edit",
        onClick: () => openEdit(actionRow),
      },
      {
        label: done ? "标记为未处理" : "标记为已处理",
        icon: "check",
        onClick: () => toggleComplete(actionRow),
      },
      {
        label: "转入想法暂存",
        icon: "arrow-left-right",
        onClick: () => setTransferring(actionRow),
      },
      {
        label: "复制原文",
        icon: "copy",
        onClick: () =>
          perform(
            navigator.clipboard
              .writeText(str(actionRow, "body"))
              .then(() => flash("已复制原文")),
          ),
      },
    ];
    if (isQueued) {
      list.push({
        label: "撤销待发送",
        icon: "undo",
        onClick: () => perform(undoPending(actionRow.id)),
      });
    }
    list.push({
      label: "删除这条原料",
      icon: "trash",
      danger: true,
      onClick: () => perform(remove(actionRow)),
    });
    return list;
  }, [actionRow, queuedIds]);

  return (
    <InkScreen hasComposer>
      {transferBanner && (
        <TransferNoticeBanner
          banner={transferBanner}
          onOpenTarget={onOpenTarget}
          onDismiss={() => setTransferBanner(null)}
        />
      )}

      <InkSegmented
        value={scope}
        onChange={setScope}
        options={[
          { value: "day", label: "按日" },
          { value: "all", label: "全部" },
        ]}
      />

      {scope === "day" ? (
        <>
          <InkDayStrip day={day} onChange={setDay} markedDays={markedDays} />
          <InkSectionLabel
            title={day === nowDay ? "今天" : shortDate(day)}
            aside={`${dayRows.length} 条原料`}
          />
          {dayRows.length > 0 ? (
            <InkCard variant="compact">
              {dayRows.map((e, i) => renderRawRow(e, i))}
            </InkCard>
          ) : (
            <InkCard>
              <InkEmpty
                text={
                  day === nowDay
                    ? "这一天还没有原料，粘贴原文、链接或摘录在下方记下。"
                    : "这一天没有原料记录"
                }
              />
            </InkCard>
          )}
        </>
      ) : (
        <>
          <InkChipBar
            size="sm"
            value={completeFilter}
            onChange={setCompleteFilter}
            items={[
              { value: "all", label: "全部", count: rawCounts.total },
              { value: "pending", label: "未处理", count: rawCounts.pending },
              { value: "done", label: "已处理", count: rawCounts.done },
            ]}
          />
          {allGrouped.length === 0 ? (
            <InkCard>
              <InkEmpty text="还没有未加工原料" />
            </InkCard>
          ) : (
            allGrouped.map((group) => (
              <React.Fragment key={group.day}>
                <button
                  type="button"
                  className="mw-day-group-head"
                  onClick={() => {
                    setDay(group.day);
                    setScope("day");
                  }}
                >
                  <span className="mw-day-group-num">{shortDate(group.day)}</span>
                  <span className="mw-day-group-week">
                    {group.day.slice(0, 4)} · 周{weekdayChar(group.day)}
                  </span>
                  <span className="mw-day-group-tag">{group.items.length} 条</span>
                </button>
                <InkCard variant="compact">
                  {group.items.map((e, i) => renderRawRow(e, i))}
                </InkCard>
              </React.Fragment>
            ))
          )}
        </>
      )}

      <InkComposer
        value={draft}
        onChange={setDraft}
        onSubmit={() => perform(submitNew())}
        placeholder="收集一条原料…"
      />

      <InkActionSheet
        open={actionRow !== null}
        title={actionRow ? shortDate(str(actionRow, "day")) + " · 未加工原料" : undefined}
        items={actionItems}
        onClose={() => setActionRow(null)}
      />

      <InkSheet
        open={editing !== null}
        title="编辑原料"
        onClose={() => setEditing(null)}
        rightLabel={saving ? "保存中…" : "保存"}
        rightDisabled={saving || !editBody.trim()}
        onRight={() => perform(saveEditRow())}
      >
        {editing && (
          <>
            <div className="mk-form-group">
              <div className="mk-form-row">
                <span className="mk-form-label">日期</span>
                <input
                  type="date"
                  className="mk-form-input right"
                  value={editDay}
                  onChange={(e) => setEditDay(e.target.value)}
                />
              </div>
              <div className="mk-form-row">
                <span className="mk-form-label">已处理</span>
                <InkSwitch
                  checked={editComplete}
                  onChange={setEditComplete}
                  label="标记已处理"
                />
              </div>
            </div>
            <textarea
              className="mk-field-textarea"
              rows={8}
              style={{ fontFamily: "var(--mono)", fontSize: "13.5px" }}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              placeholder="原文、链接或语音文字…"
            />
            <div className="mw-sheet-actions">
              <button
                type="button"
                className="mk-pill sm"
                disabled={editBody !== str(editing, "body")}
                onClick={() => {
                  const target = editing;
                  setEditing(null);
                  setTransferring(target);
                }}
              >
                <Icon name="arrow-left-right" size={14} />
                <span>{editBody !== str(editing, "body") ? "先保存再转入想法" : "转入想法暂存"}</span>
              </button>
              <button
                type="button"
                className="mk-pill sm danger"
                style={{ marginLeft: "auto" }}
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true);
                    return;
                  }
                  const target = editing;
                  setEditing(null);
                  perform(remove(target));
                }}
              >
                <Icon name="trash" size={14} />
                <span>{confirmDelete ? "再点确认删除" : "删除"}</span>
              </button>
            </div>
          </>
        )}
      </InkSheet>

      <MobileJournalTransferSheet
        source={transferring}
        liveSource={liveTransferSource}
        targetKind="idea"
        onReloadLatest={() => {
          if (liveTransferSource) setTransferring(liveTransferSource);
        }}
        onClose={() => setTransferring(null)}
        onTransferred={(target) => {
          setTransferring(null);
          setTransferBanner(target);
        }}
      />

      {toast && <div className="mw-toast">{toast}</div>}
    </InkScreen>
  );
}

/* ─────────────────────────── 3. Ideas (想法暂存) ─────────────────────────── */

type IdeaFilter = "pending" | "completed" | "discarded" | "all";
type IdeaStatus = "pending" | "completed" | "discarded";

const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  pending: "待处理",
  completed: "已采纳",
  discarded: "已放弃",
};

function normalizeIdeaStatus(raw: unknown): IdeaStatus {
  if (raw === "completed" || raw === "discarded") return raw;
  return "pending";
}

function MobileIdeaScreen({
  onOpenTarget,
  focus,
  onConsumeFocus,
}: {
  onOpenTarget?: (target: JournalTarget) => void;
  focus?: JournalTarget;
  onConsumeFocus?: () => void;
}) {
  const { entities } = useEntities("idea");
  const [filter, setFilter] = useState<IdeaFilter>("pending");
  const [draft, setDraft] = usePreference("draft-idea", "");

  const [actionRow, setActionRow] = useState<Entity | null>(null);
  const [editing, setEditing] = useState<Entity | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editDay, setEditDay] = useState(today());
  const [editStatus, setEditStatus] = useState<IdeaStatus>("pending");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [transferring, setTransferring] = useState<Entity | null>(null);
  const [transferBanner, setTransferBanner] = useState<JournalTarget | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const pending = usePending();
  const queuedIds = useMemo(() => {
    const map = new Map<string, string>();
    for (const op of pending) map.set(op.entityId, op.state);
    return map;
  }, [pending]);

  const activeEntities = useMemo(
    () => entities.filter((e) => !e.deleted),
    [entities],
  );

  const counts = useMemo(() => {
    const c = { pending: 0, completed: 0, discarded: 0, all: activeEntities.length };
    for (const e of activeEntities) {
      c[normalizeIdeaStatus(e.data.status)] += 1;
    }
    return c;
  }, [activeEntities]);

  const rows = useMemo(
    () =>
      activeEntities
        .filter((e) => filter === "all" || normalizeIdeaStatus(e.data.status) === filter)
        .sort(
          (a, b) =>
            str(b, "day").localeCompare(str(a, "day")) ||
            b.updatedAt.localeCompare(a.updatedAt),
        ),
    [activeEntities, filter],
  );

  const liveTransferSource = useMemo(
    () => (transferring ? activeEntities.find((e) => e.id === transferring.id) : undefined),
    [activeEntities, transferring],
  );

  useEffect(() => {
    if (!focus || focus.kind !== "idea") return;
    setFilter("pending");
    setHighlightedId(focus.id);
    onConsumeFocus?.();
  }, [focus, onConsumeFocus]);

  useEffect(() => {
    if (!highlightedId) return;
    const node = document.querySelector<HTMLElement>(
      `[data-mw-journal-id="${CSS.escape(highlightedId)}"]`,
    );
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setHighlightedId(null), 3200);
    return () => window.clearTimeout(timer);
  }, [highlightedId, rows.length, filter]);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? "" : cur)), 2000);
  }

  function openEdit(e: Entity) {
    setEditing(e);
    setEditBody(str(e, "body"));
    setEditDay(str(e, "day") || today());
    setEditStatus(normalizeIdeaStatus(e.data.status));
    setConfirmDelete(false);
  }

  function setIdeaStatus(e: Entity, next: IdeaStatus) {
    perform(saveEdit("idea", e.id, e.data, { ...e.data, status: next }));
  }

  async function submitNew() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await put("idea", {
      body: text,
      day: today(),
      status: "pending",
    });
    if (filter === "completed" || filter === "discarded") {
      setFilter("pending");
    }
  }

  async function saveEditRow() {
    if (!editing || saving || !editBody.trim()) return;
    setSaving(true);
    try {
      await saveEdit("idea", editing.id, editing.data, {
        ...editing.data,
        body: editBody,
        day: editDay || str(editing, "day"),
        status: editStatus,
      });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  const actionItems: ActionSheetItem[] = useMemo(() => {
    if (!actionRow) return [];
    const status = normalizeIdeaStatus(actionRow.data.status);
    const isQueued = queuedIds.get(actionRow.id) === "queued";
    const list: ActionSheetItem[] = [
      {
        label: "编辑想法",
        icon: "edit",
        onClick: () => openEdit(actionRow),
      },
    ];
    if (status !== "completed") {
      list.push({
        label: "采纳",
        icon: "check",
        onClick: () => setIdeaStatus(actionRow, "completed"),
      });
    }
    if (status !== "discarded") {
      list.push({
        label: "放弃",
        icon: "close",
        onClick: () => setIdeaStatus(actionRow, "discarded"),
      });
    }
    if (status !== "pending") {
      list.push({
        label: "恢复待处理",
        icon: "undo",
        onClick: () => setIdeaStatus(actionRow, "pending"),
      });
    }
    list.push(
      {
        label: "转入未加工原料",
        icon: "arrow-left-right",
        onClick: () => setTransferring(actionRow),
      },
      {
        label: "复制内容",
        icon: "copy",
        onClick: () =>
          perform(
            navigator.clipboard
              .writeText(str(actionRow, "body"))
              .then(() => flash("已复制")),
          ),
      },
    );
    if (isQueued) {
      list.push({
        label: "撤销待发送",
        icon: "undo",
        onClick: () => perform(undoPending(actionRow.id)),
      });
    }
    list.push({
      label: "删除这个想法",
      icon: "trash",
      danger: true,
      onClick: () => perform(remove(actionRow)),
    });
    return list;
  }, [actionRow, queuedIds]);

  return (
    <InkScreen hasComposer>
      {transferBanner && (
        <TransferNoticeBanner
          banner={transferBanner}
          onOpenTarget={onOpenTarget}
          onDismiss={() => setTransferBanner(null)}
        />
      )}

      <InkChipBar
        value={filter}
        onChange={setFilter}
        items={[
          { value: "pending", label: "待处理", count: counts.pending },
          { value: "completed", label: "已采纳", count: counts.completed },
          { value: "discarded", label: "已放弃", count: counts.discarded },
          { value: "all", label: "全部", count: counts.all },
        ]}
      />

      <InkSectionLabel
        title={
          filter === "all"
            ? "全部想法"
            : IDEA_STATUS_LABELS[filter]
        }
        aside={`${rows.length} 个想法`}
      />

      {rows.length > 0 ? (
        <InkCard variant="compact">
          {rows.map((e, idx) => {
            const status = normalizeIdeaStatus(e.data.status);
            const isQueued = queuedIds.get(e.id) === "queued";
            const d = str(e, "day");
            return (
              <React.Fragment key={e.id}>
                {idx > 0 && <InkHairline inset={34} />}
                <div
                  data-mw-journal-id={e.id}
                  className={
                    "mw-journal-row" + (highlightedId === e.id ? " highlighted" : "")
                  }
                  role="button"
                  tabIndex={0}
                  onClick={() => setActionRow(e)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      setActionRow(e);
                    }
                  }}
                >
                  <InkRing
                    done={status === "completed"}
                    label={status === "completed" ? "恢复待处理" : "采纳此想法"}
                    onClick={() =>
                      setIdeaStatus(
                        e,
                        status === "completed" ? "pending" : "completed",
                      )
                    }
                  />
                  <div className="mw-journal-body-col">
                    <div
                      className={
                        "mw-journal-text" +
                        (status === "completed"
                          ? " completed"
                          : status === "discarded"
                            ? " discarded"
                            : "")
                      }
                    >
                      {str(e, "body")}
                    </div>
                    <div className="mw-journal-meta">
                      {d && <span>{shortDate(d)}</span>}
                      {filter === "all" && status !== "pending" && (
                        <span
                          className={
                            "mw-pill-tag" +
                            (status === "completed" ? " live" : " muted")
                          }
                        >
                          {IDEA_STATUS_LABELS[status]}
                        </span>
                      )}
                    </div>
                  </div>
                  {isQueued && (
                    <span className="mw-sync-icon" aria-label="待同步">
                      <Icon name="sync" size={13} />
                    </span>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </InkCard>
      ) : (
        <InkCard>
          <InkEmpty
            text={
              filter === "pending"
                ? "还没有待处理的想法，从下面随手记下一条。"
                : "这一分类下还没有想法"
            }
          />
        </InkCard>
      )}

      <InkComposer
        value={draft}
        onChange={setDraft}
        onSubmit={() => perform(submitNew())}
        placeholder="记下一个想法…"
      />

      <InkActionSheet
        open={actionRow !== null}
        title={actionRow ? shortDate(str(actionRow, "day")) + " · 想法暂存" : undefined}
        items={actionItems}
        onClose={() => setActionRow(null)}
      />

      <InkSheet
        open={editing !== null}
        title="编辑想法"
        onClose={() => setEditing(null)}
        rightLabel={saving ? "保存中…" : "保存"}
        rightDisabled={saving || !editBody.trim()}
        onRight={() => perform(saveEditRow())}
      >
        {editing && (
          <>
            <InkSegmented
              onCard
              value={editStatus}
              onChange={setEditStatus}
              options={[
                { value: "pending", label: "待处理" },
                { value: "completed", label: "已采纳" },
                { value: "discarded", label: "已放弃" },
              ]}
            />
            <div className="mk-form-group">
              <div className="mk-form-row">
                <span className="mk-form-label">日期</span>
                <input
                  type="date"
                  className="mk-form-input right"
                  value={editDay}
                  onChange={(e) => setEditDay(e.target.value)}
                />
              </div>
            </div>
            <textarea
              className="mk-field-textarea"
              rows={6}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              placeholder="写下你的想法…"
            />
            <div className="mw-sheet-actions">
              <button
                type="button"
                className="mk-pill sm"
                disabled={editBody !== str(editing, "body")}
                onClick={() => {
                  const target = editing;
                  setEditing(null);
                  setTransferring(target);
                }}
              >
                <Icon name="arrow-left-right" size={14} />
                <span>{editBody !== str(editing, "body") ? "先保存再转入原料" : "转入原料"}</span>
              </button>
              <button
                type="button"
                className="mk-pill sm danger"
                style={{ marginLeft: "auto" }}
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true);
                    return;
                  }
                  const target = editing;
                  setEditing(null);
                  perform(remove(target));
                }}
              >
                <Icon name="trash" size={14} />
                <span>{confirmDelete ? "再点确认删除" : "删除"}</span>
              </button>
            </div>
          </>
        )}
      </InkSheet>

      <MobileJournalTransferSheet
        source={transferring}
        liveSource={liveTransferSource}
        targetKind="raw"
        onReloadLatest={() => {
          if (liveTransferSource) setTransferring(liveTransferSource);
        }}
        onClose={() => setTransferring(null)}
        onTransferred={(target) => {
          setTransferring(null);
          setTransferBanner(target);
        }}
      />

      {toast && <div className="mw-toast">{toast}</div>}
    </InkScreen>
  );
}

/* ─────────────────────────── Shared Transfer Notice & Sheet ─────────────────────────── */

function TransferNoticeBanner({
  banner,
  onOpenTarget,
  onDismiss,
}: {
  banner: JournalTarget;
  onOpenTarget?: (target: JournalTarget) => void;
  onDismiss: () => void;
}) {
  const destLabel = banner.kind === "raw" ? "未加工原料" : "想法暂存";
  return (
    <InkCard variant="tight">
      <div className="mw-transfer-banner" role="status">
        <div className="mw-transfer-banner-copy">
          <strong>已移至{destLabel}</strong>
          <small>保留原日期 {banner.day}</small>
        </div>
        {onOpenTarget && (
          <button
            type="button"
            className="mk-pill sm"
            onClick={() => {
              onDismiss();
              onOpenTarget(banner);
            }}
          >
            去查看
          </button>
        )}
        <button
          type="button"
          className="mw-transfer-banner-close"
          aria-label="关闭提示"
          onClick={onDismiss}
        >
          <Icon name="close" size={13} />
        </button>
      </div>
    </InkCard>
  );
}

function MobileJournalTransferSheet({
  source,
  liveSource,
  targetKind,
  onReloadLatest,
  onClose,
  onTransferred,
}: {
  source: Entity | null;
  liveSource?: Entity;
  targetKind: "idea" | "raw";
  onReloadLatest: () => void;
  onClose: () => void;
  onTransferred: (target: JournalTarget) => void;
}) {
  const body = source ? str(source, "body") : "";
  const day = source ? str(source, "day") : "";
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setRange(null);
    setError("");
  }, [source?.id, source?.version, body]);

  const targetTitle = targetKind === "raw" ? "未加工原料" : "想法暂存";
  const removedExternally = Boolean(source && (!liveSource || liveSource.deleted));
  const changedExternally = Boolean(
    source &&
      !removedExternally &&
      liveSource &&
      (liveSource.version !== source.version ||
        str(liveSource, "body") !== body ||
        str(liveSource, "day") !== day),
  );

  const selectedText = range ? body.slice(range.start, range.end) : "";
  const hasSelection = Boolean(range && range.end > range.start);
  const selectionBlank = hasSelection && !selectedText.trim();
  const remainingText = hasSelection
    ? body.slice(0, range!.start) + body.slice(range!.end)
    : "";
  const removesWholeSource = !hasSelection || !remainingText.trim();
  const payloadUnits = hasSelection ? selectedText.length : body.length;
  const tooLong = targetKind === "idea" && payloadUnits > MAX_IDEA_TRANSFER_UNITS;

  function syncSelection() {
    const el = areaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    setError("");
    if (end > start) {
      setRange({ start, end });
    } else {
      setRange(null);
    }
  }

  function clearSelection() {
    setRange(null);
    setError("");
    const el = areaRef.current;
    if (el) el.setSelectionRange(0, 0);
  }

  async function submit() {
    if (
      !source ||
      submitting ||
      removedExternally ||
      changedExternally ||
      selectionBlank ||
      tooLong
    ) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const createdId = await transferJournalText(
        source,
        hasSelection && range ? { start: range.start, end: range.end } : undefined,
      );
      onTransferred({ kind: targetKind, day, id: createdId });
    } catch (err) {
      setError(formatTransferError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canConfirm =
    Boolean(source) &&
    !submitting &&
    !removedExternally &&
    !changedExternally &&
    !selectionBlank &&
    !tooLong;

  return (
    <InkSheet
      open={source !== null}
      title={`移至${targetTitle}`}
      onClose={() => {
        if (!submitting) onClose();
      }}
      rightLabel={
        submitting ? "移动中…" : hasSelection ? "移动选段" : "移动整条"
      }
      rightDisabled={!canConfirm}
      onRight={() => void submit()}
    >
      {source && (
        <>
          <div className="mw-transfer-meta">
            <span>移动而非复制</span>
            <span>·</span>
            <span>保留原日期 {day}</span>
            {targetKind === "idea" && (
              <>
                <span>·</span>
                <span>进入待处理</span>
              </>
            )}
          </div>

          {removedExternally ? (
            <div className="mw-transfer-alert">
              这条记录已在另一端移除，无法继续迁移。
            </div>
          ) : changedExternally ? (
            <div className="mw-transfer-alert">
              <span>另一台设备已更新原文，请载入最新后再重新选段。</span>
              <div>
                <button
                  type="button"
                  className="mk-pill sm solid"
                  onClick={onReloadLatest}
                >
                  载入最新原文
                </button>
              </div>
            </div>
          ) : null}

          <div className="mw-transfer-picker-head">
            <span>长按拖选一段文字可仅移动选段；不选则移动整条。</span>
            {hasSelection && (
              <button
                type="button"
                className="mk-text-btn accent"
                onClick={clearSelection}
              >
                清除选区
              </button>
            )}
          </div>

          <textarea
            ref={areaRef}
            className="mw-transfer-source"
            readOnly
            value={body}
            aria-label="选择要移动的正文范围"
            onSelect={syncSelection}
            onTouchEnd={syncSelection}
            onMouseUp={syncSelection}
            onKeyUp={syncSelection}
          />

          <div className="mw-transfer-summary">
            {selectionBlank ? (
              <div className="mw-transfer-warn">
                当前选区只有空白字符，请重新选择有效文字。
              </div>
            ) : tooLong ? (
              <div className="mw-transfer-warn">
                当前内容共 {payloadUnits.toLocaleString("zh-CN")} 字符，超过想法暂存单条上限（100,000），请缩小选区。
              </div>
            ) : hasSelection ? (
              <>
                <strong>
                  移动选段（{selectedText.length} 字符）→ {targetTitle}
                </strong>
                <small>
                  {removesWholeSource
                    ? "选区已覆盖全部正文，移动后原条目会从原列表移除。"
                    : "未选中的其余文字会留在原条目中。"}
                </small>
                <blockquote className="mw-transfer-preview">
                  {selectedText.length > 220
                    ? selectedText.slice(0, 220) + "…"
                    : selectedText}
                </blockquote>
              </>
            ) : (
              <>
                <strong>
                  移动整条（{body.length} 字符）→ {targetTitle}
                </strong>
                <small>
                  整条移动后原条目将离开原列表，并在 {day} 生成新记录。
                </small>
              </>
            )}
          </div>

          {error && <div className="mw-transfer-warn">{error}</div>}
        </>
      )}
    </InkSheet>
  );
}
