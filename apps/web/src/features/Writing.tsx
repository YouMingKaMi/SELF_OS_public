import React, { useState } from "react";
import "./writing.css";
import Markdown from "react-markdown";
import { Icon } from "../ui/Icon.tsx";
import {
  useDocumentDraft,
  writeDocumentDraft,
  clearDocumentDraft,
  hasDocumentDraft,
} from "../ui/document-draft.ts";
import {
  useEntities,
  usePending,
  put,
  remove,
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
export function Journal({ kind }: { kind: "chronicle" | "raw" | "idea" }) {
  const { entities }: { entities: Entity[] } = useEntities(
    kind === "idea" ? "idea" : "journal",
  );
  const pending = usePending();
  const [day, setDay] = useState(today());
  const [month, setMonth] = useState(monthNow());
  const [draft, setDraft] = usePreference("draft-" + kind, "");
  const [edit, setEdit] = useState<string>();
  const [editBody, setEditBody] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [status, setStatus] = useState("pending");
  const text = copy[kind];
  const rows = entities.filter((e) =>
    kind === "idea" ? e.data.status === status : e.data.kind === kind,
  );
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
  const selected = entities
    .filter(
      (e) =>
        e.data.day === day && (kind === "idea" ? true : e.data.kind === kind),
    )
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const history = rows
    .filter((e) => String(e.data.day).startsWith(month))
    .sort(
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
            : "")
        }
        key={e.id}
      >
        {edit === e.id ? (
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
                    put(e.type, { ...e.data, body: editBody }, e)
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
                  setEdit(e.id);
                  setEditBody(str(e, "body"));
                }}
              >
                编辑
              </button>
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
      />
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
                <header>
                  <h3>{date.slice(8)}</h3>
                  <small>周{weekday(date)}</small>
                  <button onClick={() => setDay(date)}>
                    {date === day ? "正在编辑" : "补记"}
                  </button>
                </header>
                {history.filter((e) => e.data.day === date).map(line)}
              </section>
            ))}
          </div>
        </Panel>
      </div>
    </>
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
  const allDocuments = entities
    .filter((e) => e.data.kind === kind)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const list = allDocuments
    .filter((e) =>
      (str(e, "title") + " " + str(e, "body"))
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const current =
    allDocuments.find((e) => e.id === selected) ?? allDocuments[0];
  const draftKey = kind + ":" + (newMode ? "new" : (current?.id ?? "new"));
  const [draft, setDraft] = useDocumentDraft(draftKey, current?.data ?? {});
  function open(e: Entity) {
    setSelected(e.id);
    setEditing(false);
    setNewMode(false);
  }
  function create() {
    if (!hasDocumentDraft(kind + ":new"))
      writeDocumentDraft(kind + ":new", {
        title: kind === "monthly" ? monthNow() + " · 月报" : "",
        body: "",
        kind,
        day: today(),
        ...(kind === "monthly" ? { month: monthNow() } : {}),
      });
    setNewMode(true);
    setEditing(true);
  }
  function edit() {
    if (current && !hasDocumentDraft(kind + ":" + current.id))
      writeDocumentDraft(kind + ":" + current.id, current.data);
    setNewMode(false);
    setEditing(true);
  }
  async function save() {
    if (!String(draft.title ?? "").trim()) throw new Error("请填写标题");
    const data: Data = { ...draft, kind };
    if (kind !== "note") {
      delete data.source;
      delete data.domainId;
      delete data.activityId;
    }
    const id = await put("document", data, newMode ? undefined : current);
    setSelected(id);
    setEditing(false);
    setNewMode(false);
    clearDocumentDraft(draftKey);
  }
  const title =
    kind === "thought" ? "个人思考" : kind === "monthly" ? "月报" : "资料笔记";
  return (
    <>
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
        <button className="primary" onClick={create}>
          ＋ {kind === "monthly" ? "写月报" : "新建文章"}
        </button>
      </Heading>
      <div className="columns reader documents">
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
          <div className="article-list">
            {!list.length && (
              <Empty
                text={
                  search
                    ? "没有找到相关文章，试试其他关键词"
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
                <button className="primary" onClick={() => perform(save())}>
                  保存文章
                </button>
                <button onClick={() => setEditing(false)}>返回阅读</button>
                <small>草稿自动保存在此设备</small>
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
      </div>
    </>
  );
}
