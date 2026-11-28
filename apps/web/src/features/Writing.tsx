import React, { useEffect, useMemo, useRef, useState } from "react";
import "./writing.css";
import { useDocumentSearch } from "../data/document-search.ts";
import { documentMarkdownParts, documentsMarkdown } from "./document-export.ts";
import { downloadFile } from "../ui/download.ts";
import Markdown from "react-markdown";
import { Icon } from "../ui/Icon.tsx";
import { useMobileDetail } from "../ui/mobile-detail.ts";
import {
  useDocumentDraft,
  writeDocumentDraft,
  clearDocumentDraft,
  readDocumentDraft,
  anotherDocumentDraft,
} from "../ui/document-draft.ts";
import { applyPatch, fieldPatch, hasFieldConflict } from "../../../../packages/contracts/edit.ts";
import {
  useDatedEntities,
  useEntities,
  usePending,
  put,
  remove,
  saveEdit,
  transferJournalText,
  undoPending,
  type AnyEntity as Entity,
  type Data,
} from "../data/entities.ts";
import {
  Heading,
  Panel,
  Empty,
  Month,
  DayPicker,
  monthNow,
  today,
  str,
  perform,
  usePreference,
} from "../ui/shared.tsx";
const weekday = (day: string) =>
  "日一二三四五六"[new Date(day + "T12:00:00Z").getUTCDay()] ?? "";
const copy = {
  chronicle: {
    title: "编年史",
    eyebrow: "CHRONICLE · LIFE IN MOMENTS",
    description: "一边记录当下，一边连续回看这个月。",
    left: "当天",
    unit: "件事",
    placeholder: "今天发生了什么？写一件事，按回车继续下一件。",
  },
  raw: {
    title: "未加工信息原料",
    eyebrow: "RAW · KEEP IT AS IT IS",
    description: "先保留原文，留待以后整理；换行会完整保留。",
    left: "收集",
    unit: "条原料",
    placeholder: "粘贴原文、链接或语音文字…",
  },
  idea: {
    title: "想法暂存",
    eyebrow: "IDEAS · ONE LINE EACH",
    description: "一行一个想法，随手记下，也随时重新开始。",
    left: "随手记下",
    unit: "个想法",
    placeholder: "记下一个想法，按回车保存。",
  },
} as const;
type JournalTarget = { kind: "idea" | "raw"; day: string; id: string };

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

export function Journal({
  kind,
  focus,
  onConsumeFocus,
  onOpenTarget,
  onOpenMemoir,
}: {
  kind: "chronicle" | "raw" | "idea";
  focus?: JournalTarget;
  onConsumeFocus?: () => void;
  onOpenTarget?: (target: JournalTarget) => void;
  onOpenMemoir?: () => void;
}) {
  const type = kind === "idea" ? "idea" : "journal";
  const pending = usePending();
  const [day, setDay] = useState(today());
  const [month, setMonth] = useState(monthNow());
  const inMonth = day.startsWith(month + "-");
  const monthRows = useDatedEntities(month + "-01", month + "-31", type);
  const selectedRows = useDatedEntities(day, inMonth ? "" : day, type);
  const [draft, setDraft] = usePreference("draft-" + kind, "");
  const [edit, setEdit] = useState<Entity>();
  const [editBody, setEditBody] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [status, setStatus] = useState("pending");
  const [transferSource, setTransferSource] = useState<Entity>();
  const [transferNotice, setTransferNotice] = useState<JournalTarget>();
  const [focusedId, setFocusedId] = useState<string>();
  const text = copy[kind];
  const canTransfer = kind === "idea" || kind === "raw";
  const targetKind: "idea" | "raw" = kind === "idea" ? "raw" : "idea";
  const targetLabel = targetKind === "raw" ? "未加工信息原料" : "想法暂存";

  useEffect(() => {
    if (!focus || focus.kind !== kind) return;
    setDay(focus.day);
    setMonth(focus.day.slice(0, 7));
    if (kind === "idea") setStatus("pending");
    setFocusedId(focus.id);
    onConsumeFocus?.();
  }, [focus, kind, onConsumeFocus]);

  useEffect(() => {
    if (!focusedId) return;
    const node = document.querySelector<HTMLElement>(
      `[data-journal-id="${CSS.escape(focusedId)}"]`,
    );
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setFocusedId(undefined), 3200);
    return () => window.clearTimeout(timer);
  }, [focusedId, day, month, selectedRows.length, monthRows.length]);

  const rows = monthRows.filter((e) =>
    kind === "idea" ? e.data.status === status : e.data.kind === kind,
  );
  const allLoaded = useMemo(() => {
    const map = new Map<string, Entity>();
    for (const row of monthRows) map.set(row.id, row);
    for (const row of selectedRows) map.set(row.id, row);
    return map;
  }, [monthRows, selectedRows]);
  const liveTransferSource = transferSource
    ? allLoaded.get(transferSource.id)
    : undefined;
  async function add() {
    if (!draft.trim()) return;
    await put(kind === "idea" ? "idea" : "journal", {
      body: draft,
      day,
      ...(kind === "idea" ? { status: "pending" } : { kind, complete: false }),
    });
    setDraft("");
  }
  // The left side always shows the chosen day in full, whatever the status filter on the right.
  const selected = (inMonth ? monthRows : selectedRows)
    .filter(
      (e) =>
        e.data.day === day && (kind === "idea" ? true : e.data.kind === kind),
    )
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const history = rows.sort(
      (a, b) =>
        String(b.data.day).localeCompare(String(a.data.day)) ||
        a.updatedAt.localeCompare(b.updatedAt),
    );
  const days = [...new Set(history.map((e) => str(e, "day")))];
  function setIdea(e: Entity, next: string) {
    perform(
      put(
        "idea",
        { ...e.data, status: e.data.status === next ? "pending" : next },
        e,
      ),
    );
  }
  function line(e: Entity) {
    const queued =
      pending.filter((p) => p.entityId === e.id).at(-1)?.state === "queued";
    return (
      <div
        className={
          "journal-row" +
          (kind === "idea" && e.data.status !== "pending"
            ? " " + str(e, "status")
            : "") +
          (focusedId === e.id ? " focused" : "")
        }
        data-journal-id={e.id}
        key={e.id}
      >
        {edit?.id === e.id ? (
          <div className="journal-edit">
            <textarea
              autoFocus
              value={editBody}
              onChange={(event) => setEditBody(event.target.value)}
            />
            <div className="form-actions">
              <button disabled={savingEdit} onClick={() => setEdit(undefined)}>
                取消
              </button>
              <button
                className="primary"
                disabled={savingEdit}
                onClick={() => {
                  if (savingEdit) return;
                  setSavingEdit(true);
                  perform(
                    saveEdit(e.type, e.id, edit.data, { ...edit.data, body: editBody })
                      .then(() => setEdit(undefined))
                      .finally(() => setSavingEdit(false)),
                  );
                }}
              >
                {savingEdit ? "保存中…" : "确认修改"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="journal-text">{str(e, "body")}</div>
            {queued && <span className="pill">待同步</span>}
            <div className="row-tools">
              <button
                onClick={() => {
                  setEdit(e);
                  setEditBody(str(e, "body"));
                }}
              >
                编辑
              </button>
              {canTransfer && (
                <button
                  onClick={() => {
                    setEdit(undefined);
                    setTransferSource(e);
                  }}
                >
                  {targetKind === "raw" ? "移至原料" : "移至想法"}
                </button>
              )}
              {kind === "idea" && (
                <>
                  <button onClick={() => setIdea(e, "completed")}>
                    {e.data.status === "completed" ? "恢复" : "完成"}
                  </button>
                  <button onClick={() => setIdea(e, "discarded")}>
                    {e.data.status === "discarded" ? "恢复" : "废弃"}
                  </button>
                </>
              )}
              <button onClick={() => perform(remove(e))}>移除</button>
              {queued && (
                <button onClick={() => perform(undoPending(e.id))}>
                  撤销待发送
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }
  const isToday = day === today();
  return (
    <>
      <Heading
        eyebrow={text.eyebrow}
        title={text.title}
        description={text.description}
      >
        {kind === "chronicle" && onOpenMemoir && (
          <button type="button" onClick={onOpenMemoir}>
            回忆录 <Icon name="arrow" size={13} />
          </button>
        )}
      </Heading>
      {transferNotice && (
        <div className="transfer-banner" role="status">
          <span>
            已移至{transferNotice.kind === "raw" ? "未加工信息原料" : "想法暂存"}
            （保留日期 {transferNotice.day}）
          </span>
          <div className="transfer-banner-actions">
            {onOpenTarget && (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  const dest = transferNotice;
                  setTransferNotice(undefined);
                  onOpenTarget(dest);
                }}
              >
                去查看 <Icon name="arrow" size={12} />
              </button>
            )}
            <button
              type="button"
              className="ghost"
              aria-label="关闭提示"
              onClick={() => setTransferNotice(undefined)}
            >
              ×
            </button>
          </div>
        </div>
      )}
      <div className={"columns journal " + kind}>
        <Panel
          className="journal-capture"
          title={text.left + " · " + selected.length + " " + text.unit}
          aside={<DayPicker label="记录日期" value={day} onChange={setDay} />}
        >
          <div className="capture-box">
            <textarea
              className={"capture-text " + (kind === "raw" ? "tall" : "")}
              aria-label="记录内容"
              placeholder={text.placeholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  kind !== "raw"
                ) {
                  e.preventDefault();
                  perform(add());
                }
              }}
            />
            <div className="form-actions">
              <small>
                {kind === "raw"
                  ? "原文不会被改写或拆分"
                  : "Enter 保存 · Shift + Enter 换行"}
              </small>
              <button
                className="primary"
                disabled={!draft.trim()}
                onClick={() => perform(add())}
              >
                确认
              </button>
            </div>
          </div>
          <div className="journal-lines">
            {selected.map(line)}
            {!selected.length && (
              <Empty
                text={
                  isToday ? "这一天还空着，从第一件开始。" : "这一天没有记录"
                }
              />
            )}
          </div>
        </Panel>
        <Panel
          className="journal-review"
          title={kind === "idea" ? "想法库" : "月度回看"}
          aside={
            <>
              {kind === "idea" && (
                <div className="segmented">
                  {[
                    ["pending", "待实现"],
                    ["completed", "已完成"],
                    ["discarded", "已废弃"],
                  ].map(([key, label]) => (
                    <button
                      className={status === key ? "active" : ""}
                      onClick={() => setStatus(key)}
                      key={key}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <small className="mono">
                {history.length} {text.unit}
              </small>
              <Month value={month} onChange={setMonth} label="回看月份" />
            </>
          }
        >
          <div className="history-list">
            {history.length === 0 && <Empty text="这个月还没有记录" />}
            {days.map((date) => (
              <section
                className={"day-block" + (date === day ? " current" : "")}
                key={date}
              >
                <header
                  role="button"
                  tabIndex={0}
                  title="点日期，在左边编辑这一天"
                  onClick={() => setDay(date)}
                  onKeyDown={(e) => e.key === "Enter" && setDay(date)}
                >
                  <h3>{date.slice(8)}</h3>
                  <small>周{weekday(date)}</small>
                  {date === day && <em className="editing-mark">编辑中</em>}
                </header>
                {history.filter((e) => e.data.day === date).map(line)}
              </section>
            ))}
          </div>
        </Panel>
      </div>
      {transferSource && canTransfer && (
        <JournalTransferModal
          source={transferSource}
          liveSource={liveTransferSource}
          targetKind={targetKind}
          targetLabel={targetLabel}
          onReloadLatest={() => {
            if (liveTransferSource) setTransferSource(liveTransferSource);
          }}
          onClose={() => setTransferSource(undefined)}
          onTransferred={(target) => {
            setTransferSource(undefined);
            setTransferNotice(target);
          }}
        />
      )}
    </>
  );
}

function JournalTransferModal({
  source,
  liveSource,
  targetKind,
  targetLabel,
  onReloadLatest,
  onClose,
  onTransferred,
}: {
  source: Entity;
  liveSource?: Entity;
  targetKind: "idea" | "raw";
  targetLabel: string;
  onReloadLatest: () => void;
  onClose: () => void;
  onTransferred: (target: JournalTarget) => void;
}) {
  const body = str(source, "body");
  const day = str(source, "day");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setRange(null);
    setError("");
  }, [source.id, source.version, body]);

  const removedExternally = !liveSource || liveSource.deleted;
  const changedExternally =
    !removedExternally &&
    (liveSource.version !== source.version ||
      str(liveSource, "body") !== body ||
      str(liveSource, "day") !== day);

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
    if (submitting || removedExternally || changedExternally || selectionBlank || tooLong) return;
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

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="modal transfer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="journal-transfer-title"
      >
        <header>
          <h2 id="journal-transfer-title">移至{targetLabel}</h2>
          <button
            type="button"
            aria-label="关闭迁移窗口"
            disabled={submitting}
            onClick={onClose}
          >
            <Icon name="close" size={14} />
          </button>
        </header>

        <div className="transfer-meta">
          <span>移动而非复制</span>
          <span className="transfer-dot">·</span>
          <span>保留原日期 {day}</span>
          {targetKind === "idea" && (
            <>
              <span className="transfer-dot">·</span>
              <span>进入待实现想法</span>
            </>
          )}
        </div>

        {removedExternally ? (
          <div className="transfer-alert">
            这条记录已在另一端移除，无法继续迁移。请关闭窗口查看最新列表。
          </div>
        ) : changedExternally ? (
          <div className="transfer-alert">
            <span>另一台设备刚更新了这条原文，请先载入最新内容再重新选段。</span>
            <button type="button" onClick={onReloadLatest}>
              载入最新原文
            </button>
          </div>
        ) : null}

        <div className="transfer-picker">
          <div className="transfer-picker-head">
            <small>在下方原文里拖选一段文字可仅移动选段；不选则移动整条。</small>
            {hasSelection && (
              <button
                type="button"
                className="ghost"
                onClick={clearSelection}
              >
                清除选区
              </button>
            )}
          </div>
          <textarea
            ref={areaRef}
            className="transfer-source"
            readOnly
            value={body}
            aria-label="选择要移动的正文范围"
            onSelect={syncSelection}
            onMouseUp={syncSelection}
            onKeyUp={syncSelection}
          />
        </div>

        <div className="transfer-summary">
          {selectionBlank ? (
            <p className="transfer-warn">当前选区只有空白字符，请重新选择有效文字。</p>
          ) : tooLong ? (
            <p className="transfer-warn">
              当前内容共 {payloadUnits.toLocaleString("zh-CN")} 字符，超过想法暂存单条上限（100,000），请拖选更短的一段。
            </p>
          ) : hasSelection ? (
            <>
              <div className="transfer-summary-head">
                <strong>移动选段（{selectedText.length} 字符）→ {targetLabel}</strong>
                <small>
                  {removesWholeSource
                    ? "选区已覆盖全部正文，移动后原条目会从当前列表移除。"
                    : "未选中的其余文字会留在原条目中。"}
                </small>
              </div>
              <blockquote className="transfer-preview">
                {selectedText.length > 260
                  ? selectedText.slice(0, 260) + "…"
                  : selectedText}
              </blockquote>
            </>
          ) : (
            <div className="transfer-summary-head">
              <strong>移动整条（{body.length} 字符）→ {targetLabel}</strong>
              <small>整条移动后，原条目将从当前列表移除，并在 {day} 生成新记录。</small>
            </div>
          )}
        </div>

        {error && <p className="inline-error">{error}</p>}

        <div className="form-actions">
          <button type="button" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={
              submitting ||
              removedExternally ||
              changedExternally ||
              selectionBlank ||
              tooLong
            }
            onClick={() => void submit()}
          >
            {submitting
              ? "正在移动…"
              : hasSelection
                ? `移动选段至${targetKind === "raw" ? "原料" : "想法"}`
                : `移动整条至${targetKind === "raw" ? "原料" : "想法"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
export function Documents({ kind }: { kind: "note" | "thought" | "monthly" }) {
  const { entities } = useEntities("document");
  const { entities: domains } = useEntities("domain");
  const [selected, setSelected] = usePreference<string | undefined>(
    "selected-doc-" + kind,
    undefined,
  );
  const [search, setSearch] = useState("");
  const [editing, setEditing] = usePreference(
    "document-editing-" + kind,
    false,
  );
  const [newMode, setNewMode] = usePreference("document-new-" + kind, false);
  const [copied, setCopied] = useState(false);
  const [persistenceError, setPersistenceError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const allDocuments = useMemo(() => entities
    .filter((e) => e.data.kind === kind)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [entities, kind]);
  const matches = useDocumentSearch(entities, search);
  const list = search ? allDocuments.filter((e) => matches?.has(e.id)) : allDocuments;
  const current = allDocuments.find((e) => e.id === selected) ??
    (editing && !newMode && selected ? undefined : allDocuments[0]);
  const editedId = editing && !newMode ? selected ?? current?.id : current?.id;
  const draftKey = kind + ":" + (newMode ? "new" : (editedId ?? "new"));
  const savedDraft = useDocumentDraft(draftKey);
  const dirty = savedDraft && (!savedDraft.base ||
    Object.keys(fieldPatch(savedDraft.base.data, savedDraft.data)).length > 0);
  const draft = dirty || newMode ? savedDraft?.data ?? {} : current?.data ?? {};
  const hasConflict = !newMode && Boolean(savedDraft?.base && current &&
    hasFieldConflict(savedDraft.base.data, current.data, fieldPatch(savedDraft.base.data, draft)));
  const unknownBase = !newMode && Boolean(savedDraft && !savedDraft.base);
  const canSave = newMode || Boolean(current && !hasConflict && !unknownBase);
  const anotherDraft = editing && !dirty ? anotherDocumentDraft(draftKey) : undefined;
  function persist(key: string, data: Data, original: Pick<Entity, "version" | "data"> | null | undefined) {
    setPersistenceError(!writeDocumentDraft(key, { data, base: original }));
  }
  function setDraft(data: Data) {
    persist(draftKey, data, dirty ? savedDraft?.base : newMode ? null : current &&
      { version: current.version, data: current.data });
  }
  function open(e: Entity) {
    setSelected(e.id);
    setEditing(false);
    setNewMode(false);
    mobileDetail.openDetail();
  }
  function create() {
    if (!readDocumentDraft(kind + ":new"))
      persist(kind + ":new", {
        title: kind === "monthly" ? monthNow() + " · 月报" : "",
        body: "",
        kind,
        day: today(),
        ...(kind === "monthly" ? { month: monthNow() } : {}),
      }, null);
    setNewMode(true);
    setEditing(true);
    mobileDetail.openDetail();
  }
  function edit() {
    if (!current) return;
    setSelected(current.id);
    setNewMode(false);
    setEditing(true);
  }
  async function save() {
    if (saving || !canSave) return;
    if (!String(draft.title ?? "").trim()) throw new Error("请填写标题");
    const data: Data = { ...draft, kind };
    if (kind !== "note") {
      delete data.source;
      delete data.domainId;
      delete data.activityId;
    }
    setSaving(true);
    try {
      const id = newMode
        ? await put("document", data)
        : await saveEdit("document", current!.id, savedDraft?.base?.data ?? current!.data, data);
      if (readDocumentDraft(draftKey) !== savedDraft) return;
      clearDocumentDraft(draftKey);
      setSelected(id);
      setEditing(false);
      setNewMode(false);
    } finally {
      setSaving(false);
    }
  }
  const title =
    kind === "thought" ? "个人思考" : kind === "monthly" ? "月报" : "资料笔记";
  const mobileDetail = useMobileDetail(
    editing
      ? newMode
        ? kind === "monthly"
          ? "写月报"
          : "新建文章"
        : "编辑文章"
      : str(current, "title", title),
  );
  async function exportMarkdown() {
    const day = today();
    setExporting(true);
    try {
      await downloadFile(`${title}-${day}.md`, "text/markdown;charset=utf-8", async (write) => {
        let chunk = "";
        for (const part of documentMarkdownParts(allDocuments, title, day)) {
          chunk += part;
          if (chunk.length >= 262_144) {
            await write(chunk);
            chunk = "";
          }
        }
        if (chunk) await write(chunk);
      });
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      {mobileDetail.showList && (
      <Heading
        eyebrow="READ · THINK · KEEP"
        title={title}
        description={
          kind === "monthly"
            ? "把一个月的行动与感受放在一起，回看自己的方向。"
            : kind === "thought"
              ? "留一处安静的地方，把想法写完整。"
              : "在领域中积累资料，让知识有迹可循。"
        }
      >
        <button
          disabled={!allDocuments.length}
          title="把全部文章合并成一份 Markdown 复制到剪贴板，可以直接粘贴给 AI"
          onClick={() =>
            perform(
              navigator.clipboard
                .writeText(documentsMarkdown(allDocuments, title, today()))
                .then(() => setCopied(true))
                .then(() => setTimeout(() => setCopied(false), 2000)),
            )
          }
        >
          {copied ? "已复制" : "复制全部"}
        </button>
        <button
          disabled={!allDocuments.length || exporting}
          title="把全部文章合并成一份 Markdown 文件下载"
          onClick={() => perform(exportMarkdown())}
        >
          {exporting ? "正在导出…" : "导出 .md"}
        </button>
        <button className="primary" onClick={create}>
          ＋ {kind === "monthly" ? "写月报" : "新建文章"}
        </button>
      </Heading>
      )}
      <div className="columns reader documents">
        {mobileDetail.showList && (
        <Panel
          className="document-index"
          title={kind === "monthly" ? "往期月报" : "全部文章"}
          aside={<small>{list.length} 篇</small>}
        >
          <input
            className="search-field"
            aria-label="搜索文章"
            placeholder="搜索标题或正文…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="article-list" aria-busy={Boolean(search && !matches)}>
            {!list.length && (
              <Empty
                text={
                  search
                    ? matches ? "没有找到相关文章，试试其他关键词" : "正在搜索文章…"
                    : "文章会按最近修改排列在这里"
                }
              />
            )}
            {list.map((e) => (
              <button
                key={e.id}
                className={current?.id === e.id ? "selected" : ""}
                aria-current={current?.id === e.id ? "true" : undefined}
                onClick={() => open(e)}
              >
                <strong>{str(e, "title")}</strong>
                <p>
                  {str(e, "body")
                    .replace(/[#*`>\-]/g, "")
                    .slice(0, 90)}
                </p>
                <small>
                  {str(e, kind === "monthly" ? "month" : "day")}
                  {kind === "note" && e.data.domainId
                    ? " · " +
                      str(
                        domains.find((d) => d.id === e.data.domainId),
                        "name",
                      )
                    : ""}
                </small>
              </button>
            ))}
          </div>
        </Panel>
        )}
        {mobileDetail.showDetail && (
        <Panel
          className="document-paper"
          title={editing ? "编辑文章" : str(current, "title", "选择一篇文章")}
          aside={
            <div>
              {current && !editing && <button onClick={edit}>编辑</button>}
              {current && !editing && (
                <button
                  onClick={() => {
                    const file = new Blob([str(current, "body")], {
                      type: "text/markdown",
                    });
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(file);
                    link.download = str(current, "title") + ".md";
                    link.click();
                    URL.revokeObjectURL(link.href);
                  }}
                >
                  导出
                </button>
              )}
              {current && !editing && (
                <button
                  className="muted"
                  onClick={() => perform(remove(current))}
                >
                  移入回收站
                </button>
              )}
            </div>
          }
        >
          {editing ? (
            <>
              {(hasConflict || unknownBase || (!newMode && !current)) && (
                <div role="status" className="editor-hint">
                  {!current ? "这条记录已被移除，仍可复制草稿。"
                    : unknownBase ? "这是旧版草稿，请先对照当前版本。"
                      : "另一台设备修改了相同字段，请先对照当前版本。"}
                  {current && (
                    <details>
                      <summary>查看当前同步版本</summary>
                      <strong>{str(current, "title")}</strong>
                      <pre className="editor-current-version">{str(current, "body")}</pre>
                      <button onClick={() => persist(draftKey,
                        savedDraft?.base
                          ? applyPatch(current.data, fieldPatch(savedDraft.base.data, draft))
                          : { ...current.data, ...draft },
                        { version: current.version, data: current.data })}>
                        保留草稿修改，从当前版本继续
                      </button>
                    </details>
                  )}
                </div>
              )}
              {anotherDraft && (
                <button onClick={() => persist(draftKey, anotherDraft.data, anotherDraft.base)}>
                  恢复其他窗口的草稿
                </button>
              )}
              <input
                aria-label="文章标题"
                placeholder="文章标题"
                className="article-title"
                value={String(draft.title ?? "")}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              <div className="document-metadata">
                <input
                  aria-label={kind === "monthly" ? "文章月份" : "文章日期"}
                  type={kind === "monthly" ? "month" : "date"}
                  value={String(
                    draft[kind === "monthly" ? "month" : "day"] ?? "",
                  )}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [kind === "monthly" ? "month" : "day"]: e.target.value,
                    })
                  }
                />
                {kind === "note" && (
                  <>
                    <select
                      aria-label="资料领域"
                      value={String(draft.domainId ?? "")}
                      onChange={(e) =>
                        setDraft({ ...draft, domainId: e.target.value })
                      }
                    >
                      <option value="">选择中科院领域</option>
                      {domains.map((e) => (
                        <option key={e.id} value={e.id}>
                          {str(e, "name")}
                        </option>
                      ))}
                    </select>
                    {draft.domainId && (
                      <select
                        aria-label="内容来源"
                        value={String(draft.source ?? "unknown")}
                        onChange={(e) =>
                          setDraft({ ...draft, source: e.target.value })
                        }
                      >
                        <option value="unknown">来源未标注</option>
                        <option value="original">个人原创</option>
                        <option value="ai">AI 生成</option>
                        <option value="assisted">AI 辅助</option>
                        <option value="excerpt">摘录</option>
                      </select>
                    )}
                  </>
                )}
              </div>
              <p className="editor-hint">
                支持 Markdown · 正文草稿自动保存在此设备
              </p>
              <textarea
                placeholder="从这里开始写…"
                className="markdown-editor"
                aria-label="文章正文"
                value={String(draft.body ?? "")}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
              <div className="form-actions">
                <button className="primary" disabled={saving || !canSave} onClick={() => perform(save())}>
                  保存文章
                </button>
                <button onClick={() => setEditing(false)}>返回阅读</button>
                {persistenceError && <small role="alert">草稿无法写入本机存储，请先保存文章或复制正文。</small>}
              </div>
            </>
          ) : current ? (
            <>
              <div className="document-metadata">
                <span className="mono">
                  {str(current, kind === "monthly" ? "month" : "day")}
                </span>
                {kind === "note" && current.data.domainId && (
                  <span>
                    {str(
                      domains.find((d) => d.id === current.data.domainId),
                      "name",
                    )}
                  </span>
                )}
                {kind === "note" &&
                  current.data.domainId &&
                  current.data.source === "ai" && (
                    <span className="pill">AI 生成</span>
                  )}
                <span>{str(current, "body").length} 字</span>
              </div>
              <article className="prose">
                <Markdown>{str(current, "body")}</Markdown>
              </article>
            </>
          ) : (
            <div className="document-empty">
              <h3>从一篇文字开始</h3>
              <p>
                {kind === "monthly"
                  ? "写下本月的行动、收获和未解的问题。往期月报会保留在右侧。"
                  : "这里保存完整的文章。可以自由写作，也可以整理已有的笔记。"}
              </p>
              <button className="primary" onClick={create}>
                <Icon name="plus" size={15} />
                {kind === "monthly" ? "开始写月报" : "开始写作"}
              </button>
            </div>
          )}
        </Panel>
        )}
      </div>
    </>
  );
}
