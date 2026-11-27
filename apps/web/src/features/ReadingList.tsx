import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  put,
  putKey,
  remove,
  useEntities,
  type Entity,
  type EntityData,
} from "../data/entities.ts";
import { Empty, Heading, Panel, perform } from "../ui/shared.tsx";
import "./reading-list.css";
import { noteParts } from "./reading-links.ts";
import { EventTime } from "./PracticeTimer.tsx";

type Item = Entity<"readingItem">;
type Status = EntityData<"readingItem">["status"];

export function ReadingList({
  openEvent,
}: {
  openEvent: (id: string) => void;
}) {
  const { entities } = useEntities("readingItem");
  const { entities: events } = useEntities("practiceEvent");
  const { entities: sessions } = useEntities("session");
  const { entities: domains } = useEntities("domain");
  const { entities: activities } = useEntities("activity");
  const eventsByItem = useMemo(() => {
    const byItem = new Map<string, Entity<"practiceEvent">>();
    for (const event of events) {
      const id = event.data.readingItemId;
      if (id && !byItem.has(id)) byItem.set(id, event);
    }
    return byItem;
  }, [events]);
  const sessionsByEvent = useMemo(() => {
    const byEvent = new Map<string, Entity<"session">[]>();
    for (const session of sessions) {
      const id = session.data.eventId;
      if (!id) continue;
      const list = byEvent.get(id);
      if (list) list.push(session);
      else byEvent.set(id, [session]);
    }
    return byEvent;
  }, [sessions]);
  const domainsById = useMemo(() => new Map(domains.map((row) => [row.id, row])), [domains]);
  const activitiesById = useMemo(() => new Map(activities.map((row) => [row.id, row])), [activities]);
  const [linking, setLinking] = useState<Item>();
  const [status, setStatus] = useState<Status | "all">("all");
  const [tag, setTag] = useState("");
  const tags = [...new Set(entities.flatMap((item) => item.data.tags ?? []))];

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Item | "new">();
  const [deleting, setDeleting] = useState<Item>();
  const [removing, setRemoving] = useState(false);
  const query = search.trim().toLowerCase();
  const rows = entities
    .filter(
      ({ data }) =>
        (status === "all" || data.status === status) &&
        (!tag || data.tags?.includes(tag)) &&
        [data.title, data.source, data.note, ...(data.tags ?? [])].some(
          (text) => text?.toLowerCase().includes(query),
        ),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="reading-list">
      <Heading eyebrow="RESEARCH LIST" title="待研究清单">
        <button className="primary" onClick={() => setEditing("new")}>
          ＋ 添加收藏
        </button>
      </Heading>
      <Panel>
        <div className="reading-toolbar">
          <div className="segmented" role="group" aria-label="阅读状态">
            {(["all", "unread", "read"] as const).map((value) => (
              <button
                key={value}
                className={status === value ? "active" : ""}
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {value === "all"
                  ? "全部"
                  : value === "unread"
                    ? "未初读"
                    : "已初读"}
              </button>
            ))}
          </div>
          {tags.length > 0 && (
            <select
              aria-label="按标签筛选"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            >
              <option value="">全部标签</option>
              {tags.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          )}
          <input
            type="search"
            aria-label="搜索收藏"
            placeholder="搜索收藏…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {rows.length === 0 && (
          <Empty
            text={
              query
                ? "没有匹配的收藏"
                : status === "read"
                  ? "暂无已初读收藏"
                  : "粘贴一个链接，或记下文章标题。"
            }
          />
        )}
        <ul className="reading-items">
          {rows.map((item) => {
            const { title, source, note } = item.data;
            const event = eventsByItem.get(item.id);
            const domain = event && domainsById.get(event.data.domainId);
            const activity = event?.data.activityId ? activitiesById.get(event.data.activityId) : undefined;
            const state =
              event?.data.status === "resolved"
                ? "已完成"
                : event?.data.status === "discarded"
                  ? "已废弃"
                  : event?.data.status === "pending"
                    ? "待推进"
                    : "推进中";

            const parts = noteParts(note ?? "");
            const link = (
              parts.find((part) => part.href) ??
              noteParts(title).find((part) => part.href)
            )?.href;
            const toggle = () =>
              perform(
                put(
                  "readingItem",
                  {
                    ...item.data,
                    status: item.data.status === "unread" ? "read" : "unread",
                  },
                  item,
                ),
              );
            return (
              <li key={item.id} className="reading-row">
                <div className="reading-item">
                  {note && note !== title ? (
                    <details>
                      <summary>
                        <strong>{title}</strong>
                        {source && <span>{source}</span>}
                        <small>{note}</small>
                      </summary>
                      <div className="reading-note">
                        {parts.map(({ text, href }, i) =>
                          href ? (
                            <a
                              key={i}
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {text}
                            </a>
                          ) : (
                            <React.Fragment key={i}>{text}</React.Fragment>
                          ),
                        )}
                      </div>
                    </details>
                  ) : (
                    <div className="reading-label">
                      <strong>{title}</strong>
                      {source && <span>{source}</span>}
                    </div>
                  )}
                  <div className="reading-meta">
                    {(item.data.tags ?? []).map((value) => (
                      <span className="pill" key={value}>
                        {value}
                      </span>
                    ))}
                    {event && (
                      <span>
                        {[domain?.data.name, activity?.data.name, state]
                          .filter(Boolean)
                          .join(" / ")}{" "}
                        ·{" "}
                        <EventTime
                          sessions={sessionsByEvent.get(event.id) ?? []}
                        />
                      </span>
                    )}
                    {item.data.status === "read" && <span>已初读</span>}
                  </div>
                </div>
                <div className="reading-actions">
                  {link && (
                    <a href={link} target="_blank" rel="noreferrer">
                      打开原文 ↗
                    </a>
                  )}
                  <button onClick={toggle}>
                    {item.data.status === "unread" ? "标记初读" : "撤销初读"}
                  </button>
                  <button
                    onClick={() =>
                      event ? openEvent(event.id) : setLinking(item)
                    }
                  >
                    {event ? "打开推进事件" : "加入推进台"}
                  </button>
                  <button onClick={() => setEditing(item)}>编辑</button>
                  <button onClick={() => setDeleting(item)}>移除</button>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
      {editing && (
        <ReadingEditor
          item={editing === "new" ? undefined : editing}
          latest={
            editing === "new"
              ? undefined
              : entities.find(({ id }) => id === editing.id)
          }
          close={() => setEditing(undefined)}
          onCreate={() => {
            setStatus("all");
            setTag("");
            setSearch("");
          }}
        />
      )}
      {linking && (
        <JoinPractice
          item={linking}
          close={() => setLinking(undefined)}
          openEvent={openEvent}
        />
      )}
      {deleting && (
        <ReadingDialog
          label="移入回收站"
          close={() => {
            if (!removing) setDeleting(undefined);
          }}
        >
          <form
            className="reading-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (removing) return;
              setRemoving(true);
              perform(
                remove(deleting)
                  .then(() => setDeleting(undefined))
                  .finally(() => setRemoving(false)),
              );
            }}
          >
            <h2>移入回收站？</h2>
            <p>{deleting.data.title}</p>
            <div className="form-actions">
              <button
                type="button"
                disabled={removing}
                onClick={() => setDeleting(undefined)}
              >
                取消
              </button>
              <button type="submit" className="primary" disabled={removing}>
                移入回收站
              </button>
            </div>
          </form>
        </ReadingDialog>
      )}
    </div>
  );
}

function ReadingDialog({
  label,
  close,
  children,
}: {
  label: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="reading-dialog"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      {children}
    </dialog>
  );
}

function ReadingEditor({
  item,
  latest,
  close,
  onCreate,
}: {
  item?: Item;
  latest?: Item;
  close: () => void;
  onCreate: () => void;
}) {
  const [title, setTitle] = useState(item?.data.title ?? "");
  const [source, setSource] = useState(item?.data.source ?? "");
  const [tags, setTags] = useState(item?.data.tags?.join("、") ?? "");
  const [note, setNote] = useState(item?.data.note ?? "");
  const [saving, setSaving] = useState(false);
  const link = noteParts(note).find((part) => part.href)?.text;
  const savedTitle = title.trim() || link || "";
  const titleIsLink = noteParts(savedTitle).some(
    ({ text, href }) => text === savedTitle && href,
  );
  const savedNote = note.trim() || (titleIsLink ? savedTitle : "");
  const valid =
    !!savedTitle && savedTitle.length <= 2000 && (!item || !!latest);
  const label = item ? "编辑收藏" : "添加收藏";

  return (
    <ReadingDialog
      label={label}
      close={() => {
        if (!saving) close();
      }}
    >
      <form
        className="reading-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || saving) return;
          setSaving(true);
          perform(
            put(
              "readingItem",
              {
                title: savedTitle,
                source: source.trim(),
                note: savedNote,
                tags: [
                  ...new Set(
                    tags
                      .split(/[,，、]/)
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  ),
                ],
                status: latest?.data.status ?? "unread",
              },
              item,
            )
              .then(() => {
                if (!item) onCreate();
                close();
              })
              .finally(() => setSaving(false)),
          );
        }}
      >
        <h2>{label}</h2>
        <label>
          标题
          <input
            autoFocus
            value={title}
            maxLength={2000}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="文章标题或网址"
          />
        </label>
        <label>
          来源
          <input
            value={source}
            maxLength={120}
            onChange={(e) => setSource(e.target.value)}
            placeholder="例如：微信、X"
          />
        </label>
        <label>
          标签
          <input
            value={tags}
            maxLength={300}
            onChange={(e) => setTags(e.target.value)}
            placeholder="例如：AI、计算机"
          />
        </label>
        <label>
          说明
          <textarea
            value={note}
            maxLength={10000}
            rows={4}
            onChange={(e) => setNote(e.target.value)}
            placeholder="粘贴网址或写一句备注"
          />
        </label>
        {item && !latest && <p role="status">这条收藏已被移除。</p>}
        <div className="form-actions">
          <button type="button" disabled={saving} onClick={close}>
            取消
          </button>
          <button type="submit" className="primary" disabled={saving || !valid}>
            保存
          </button>
        </div>
      </form>
    </ReadingDialog>
  );
}

function JoinPractice({
  item,
  close,
  openEvent,
}: {
  item: Item;
  close: () => void;
  openEvent: (id: string) => void;
}) {
  const { entities: domains } = useEntities("domain");
  const { entities: activities } = useEntities("activity");
  const suggested = domains.find((domain) =>
    item.data.tags?.some(
      (tag) => tag.toLowerCase() === domain.data.name.toLowerCase(),
    ),
  );
  const [domainId, setDomain] = useState(suggested?.id ?? "");
  const [activityId, setActivity] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <ReadingDialog
      label="加入推进台"
      close={() => {
        if (!saving) close();
      }}
    >
      <form
        className="reading-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!domainId || saving) return;
          setSaving(true);
          perform(
            putKey("practiceEvent", "reading:" + item.id, {
              domainId,
              ...(activityId ? { activityId } : {}),
              readingItemId: item.id,
              title: item.data.title,
              status: "active",
            })
              .then((id) => {
                close();
                openEvent(id);
              })
              .finally(() => setSaving(false)),
          );
        }}
      >
        <h2>加入推进台</h2>
        <p>{item.data.title}</p>
        <label>
          领域
          <select
            required
            value={domainId}
            onChange={(e) => {
              setDomain(e.target.value);
              setActivity("");
            }}
          >
            <option value="">选择领域</option>
            {domains.map((domain) => (
              <option key={domain.id} value={domain.id}>
                {domain.data.name}
              </option>
            ))}
          </select>
        </label>
        {!domains.length && <p>请先在个人推进台添加一个领域。</p>}
        <label>
          子领域
          <select
            value={activityId}
            disabled={!domainId}
            onChange={(e) => setActivity(e.target.value)}
          >
            <option value="">整个领域</option>
            {activities
              .filter((a) => a.data.domainId === domainId && !a.data.archived)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.data.name}
                </option>
              ))}
          </select>
        </label>
        <div className="form-actions">
          <button type="button" disabled={saving} onClick={close}>
            取消
          </button>
          <button className="primary" disabled={!domainId || saving}>
            创建研究事件
          </button>
        </div>
      </form>
    </ReadingDialog>
  );
}
