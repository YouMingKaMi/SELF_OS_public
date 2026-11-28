import React, { useEffect, useMemo, useState } from "react";
import {
  put,
  putKey,
  remove,
  useEntities,
  type Entity,
  type EntityData,
} from "../../data/entities.ts";
import { Icon } from "../../ui/Icon.tsx";
import { perform } from "../../ui/shared.tsx";
import { EventTime } from "../PracticeTimer.tsx";
import { noteParts, readingLink } from "../reading-links.ts";
import {
  InkActionSheet,
  InkCard,
  InkChipBar,
  InkComposer,
  InkEmpty,
  InkHairline,
  InkNavIcon,
  InkRing,
  InkScreen,
  InkSearch,
  InkSegmented,
  InkSheet,
  MobileToolbar,
} from "./MobileKit.tsx";
import "./mobile-screens.css";

type ReadingItem = Entity<"readingItem">;
type ReadingStatus = EntityData<"readingItem">["status"];

const EVENT_STATUS_LABEL: Record<string, string> = {
  resolved: "已完成",
  discarded: "已废弃",
  pending: "待推进",
  active: "推进中",
};

export function MobileReadingList({
  openEvent,
}: {
  openEvent?: (id: string) => void;
}) {
  const { entities: items } = useEntities("readingItem");
  const { entities: events } = useEntities("practiceEvent");
  const { entities: sessions } = useEntities("session");
  const { entities: domains } = useEntities("domain");
  const { entities: activities } = useEntities("activity");

  const [status, setStatus] = useState<ReadingStatus | "all">("unread");
  const [tag, setTag] = useState("");
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ReadingItem | undefined>(undefined);
  const [joining, setJoining] = useState<ReadingItem | undefined>(undefined);

  const eventsByItem = useMemo(() => {
    const map = new Map<string, Entity<"practiceEvent">>();
    for (const ev of events) {
      const id = ev.data.readingItemId;
      if (id && !map.has(id)) map.set(id, ev);
    }
    return map;
  }, [events]);

  const sessionsByEvent = useMemo(() => {
    const map = new Map<string, Entity<"session">[]>();
    for (const s of sessions) {
      const id = s.data.eventId;
      if (!id) continue;
      const list = map.get(id);
      if (list) list.push(s);
      else map.set(id, [s]);
    }
    return map;
  }, [sessions]);

  const domainsById = useMemo(
    () => new Map(domains.map((d) => [d.id, d])),
    [domains],
  );
  const activitiesById = useMemo(
    () => new Map(activities.map((a) => [a.id, a])),
    [activities],
  );

  const counts = useMemo(() => {
    let unread = 0;
    let read = 0;
    for (const item of items) {
      if (item.data.status === "read") read++;
      else unread++;
    }
    return { unread, read, all: items.length };
  }, [items]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      for (const t of item.data.tags ?? []) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [items]);

  const activeTag = tag && allTags.includes(tag) ? tag : "";

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter(({ data }) => {
        if (status !== "all" && data.status !== status) return false;
        if (activeTag && !(data.tags ?? []).includes(activeTag)) return false;
        if (!q) return true;
        return [data.title, data.source, data.note, ...(data.tags ?? [])].some(
          (text) => text?.toLowerCase().includes(q),
        );
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [items, status, activeTag, search]);

  function toggleStatus(item: ReadingItem) {
    const next: ReadingStatus = item.data.status === "unread" ? "read" : "unread";
    perform(
      put("readingItem", { ...item.data, status: next }, item),
    );
  }

  function handleQuickCapture() {
    const raw = composer.trim();
    if (!raw || submitting) return;
    setSubmitting(true);
    const link = readingLink(raw);
    const savedTitle = raw.slice(0, 2000);
    const savedNote = link ? raw.slice(0, 10000) : "";
    perform(
      put("readingItem", {
        title: savedTitle,
        source: "",
        tags: [],
        note: savedNote,
        status: "unread",
      })
        .then(() => {
          setComposer("");
          if (status === "read") setStatus("unread");
          setTag("");
        })
        .finally(() => setSubmitting(false)),
    );
  }

  function eventSummary(ev: Entity<"practiceEvent">): string {
    const domain = domainsById.get(ev.data.domainId)?.data.name;
    const activity = ev.data.activityId
      ? activitiesById.get(ev.data.activityId)?.data.name
      : undefined;
    const state = EVENT_STATUS_LABEL[ev.data.status] ?? "推进中";
    return [domain, activity, state].filter(Boolean).join(" / ");
  }

  const latestEditing = editing
    ? items.find((i) => i.id === editing.id)
    : undefined;

  return (
    <InkScreen hasComposer>
      <MobileToolbar>
        <InkNavIcon
          icon="plus"
          label="添加收藏"
          onClick={() => {
            setEditing(undefined);
            setSheetOpen(true);
          }}
        />
      </MobileToolbar>

      <InkChipBar
        value={status}
        onChange={setStatus}
        items={[
          { value: "unread", label: "待研究", count: counts.unread },
          { value: "read", label: "已读", count: counts.read },
          { value: "all", label: "全部", count: counts.all },
        ]}
      />

      {allTags.length > 0 && (
        <InkChipBar
          size="sm"
          value={activeTag}
          onChange={setTag}
          items={[
            { value: "", label: "全部标签" },
            ...allTags.map((t) => ({ value: t, label: `#${t}` })),
          ]}
        />
      )}

      <InkSearch
        value={search}
        onChange={setSearch}
        placeholder="搜索收藏标题、来源或标签…"
      />

      <InkCard variant="compact">
        {rows.map((item, index) => {
          const isRead = item.data.status === "read";
          const ev = eventsByItem.get(item.id);
          const link =
            readingLink(item.data.note ?? "") ?? readingLink(item.data.title);
          const metaParts: string[] = [];
          if (item.data.source) metaParts.push(item.data.source);
          if (item.data.tags?.length) {
            metaParts.push(item.data.tags.map((t) => `#${t}`).join(" "));
          }
          if (ev) metaParts.push(eventSummary(ev));
          else if (link) metaParts.push("含链接");

          return (
            <React.Fragment key={item.id}>
              {index > 0 && <InkHairline inset={34} />}
              <div className="mfx-check-row top">
                <InkRing
                  done={isRead}
                  label={isRead ? "标为待研究" : "标为已读"}
                  onClick={() => toggleStatus(item)}
                />
                <button
                  type="button"
                  className="mk-row"
                  style={{ padding: "2px 0", minHeight: 34 }}
                  onClick={() => {
                    setEditing(item);
                    setSheetOpen(true);
                  }}
                >
                  <div className="mk-row-main">
                    <div
                      className={
                        "mk-row-title clamp-2" + (isRead ? " mfx-strike" : "")
                      }
                    >
                      {item.data.title}
                    </div>
                    {metaParts.length > 0 && (
                      <div className="mk-row-sub">{metaParts.join(" · ")}</div>
                    )}
                  </div>
                  <div className="mk-row-right">
                    <span className="mk-row-chevron">
                      <Icon name="chevron-right" size={15} />
                    </span>
                  </div>
                </button>
              </div>
            </React.Fragment>
          );
        })}

        {rows.length === 0 && (
          <InkEmpty
            text={
              search.trim()
                ? "没有匹配的收藏"
                : status === "read"
                  ? "还没有已读的收藏"
                  : "在底部粘贴标题或链接，随时收集待研究内容"
            }
          />
        )}
      </InkCard>

      <InkComposer
        value={composer}
        onChange={setComposer}
        onSubmit={handleQuickCapture}
        disabled={submitting}
        placeholder="粘贴标题或链接…"
      />

      <ReadingDetailEditSheet
        open={sheetOpen}
        item={editing}
        latest={latestEditing}
        linkedEvent={editing ? eventsByItem.get(editing.id) : undefined}
        linkedEventLabel={
          editing && eventsByItem.get(editing.id)
            ? eventSummary(eventsByItem.get(editing.id)!)
            : undefined
        }
        linkedSessions={
          editing && eventsByItem.get(editing.id)
            ? sessionsByEvent.get(eventsByItem.get(editing.id)!.id) ?? []
            : []
        }
        openEvent={openEvent}
        onRequestJoin={(target) => {
          setSheetOpen(false);
          setJoining(target);
        }}
        onCreated={(createdStatus) => {
          setTag("");
          setSearch("");
          if (status !== "all" && status !== createdStatus) {
            setStatus(createdStatus);
          }
        }}
        onClose={() => setSheetOpen(false)}
      />

      <JoinPracticeSheet
        open={Boolean(joining)}
        item={joining}
        domains={domains}
        activities={activities}
        openEvent={openEvent}
        onClose={() => setJoining(undefined)}
      />
    </InkScreen>
  );
}

function ReadingDetailEditSheet({
  open,
  item,
  latest,
  linkedEvent,
  linkedEventLabel,
  linkedSessions,
  openEvent,
  onRequestJoin,
  onCreated,
  onClose,
}: {
  open: boolean;
  item?: ReadingItem;
  latest?: ReadingItem;
  linkedEvent?: Entity<"practiceEvent">;
  linkedEventLabel?: string;
  linkedSessions: Entity<"session">[];
  openEvent?: (id: string) => void;
  onRequestJoin: (item: ReadingItem) => void;
  onCreated: (status: ReadingStatus) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<ReadingStatus>("unread");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(item?.data.title ?? "");
    setSource(item?.data.source ?? "");
    setTags((item?.data.tags ?? []).join("、"));
    setNote(item?.data.note ?? "");
    setStatus(item?.data.status ?? "unread");
    setSaving(false);
    setConfirmDelete(false);
  }, [open, item]);

  const detectedLink = readingLink(note) ?? readingLink(title);
  const linkInNote = noteParts(note).find((p) => p.href)?.text;
  const savedTitle = title.trim() || linkInNote || "";
  const titleIsLink = noteParts(savedTitle).some(
    ({ text, href }) => text === savedTitle && href,
  );
  const savedNote = note.trim() || (titleIsLink ? savedTitle : "");
  const valid =
    savedTitle.length > 0 &&
    savedTitle.length <= 2000 &&
    source.trim().length <= 120 &&
    savedNote.length <= 10000 &&
    tags.length <= 300 &&
    (!item || Boolean(latest));

  function handleSave() {
    if (!valid || saving) return;
    setSaving(true);
    const parsedTags = [
      ...new Set(
        tags
          .split(/[,，、]/)
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ];
    perform(
      put(
        "readingItem",
        {
          title: savedTitle,
          source: source.trim(),
          tags: parsedTags,
          note: savedNote,
          status,
        },
        item,
      )
        .then(() => {
          if (!item) onCreated(status);
          onClose();
        })
        .finally(() => setSaving(false)),
    );
  }

  return (
    <>
      <InkSheet
        open={open}
        title={item ? "收藏详情" : "添加收藏"}
        onClose={() => {
          if (!saving) onClose();
        }}
        rightLabel={saving ? "保存中" : "保存"}
        rightDisabled={!valid || saving}
        onRight={handleSave}
      >
        {item && (
          <div className="mfx-action-strip">
            {detectedLink && (
              <a
                href={detectedLink}
                target="_blank"
                rel="noreferrer"
                className="mk-pill sm mfx-link-pill"
              >
                <Icon name="arrow" size={14} />
                <span>打开原文</span>
              </a>
            )}
            {linkedEvent ? (
              openEvent ? (
                <button
                  type="button"
                  className="mk-pill sm"
                  onClick={() => {
                    onClose();
                    openEvent(linkedEvent.id);
                  }}
                >
                  <Icon name="practice" size={14} />
                  <span>打开推进事件</span>
                </button>
              ) : (
                <span className="mk-pill sm">
                  <Icon name="practice" size={14} />
                  <span>已关联推进事件</span>
                </span>
              )
            ) : (
              <button
                type="button"
                className="mk-pill sm"
                onClick={() => onRequestJoin(latest ?? item)}
              >
                <Icon name="practice" size={14} />
                <span>转为推进事件</span>
              </button>
            )}
          </div>
        )}

        {item && linkedEvent && linkedEventLabel && (
          <div className="mfx-quote">
            <span className="mfx-quote-label">关联推进事件</span>
            {linkedEventLabel} · <EventTime sessions={linkedSessions} />
          </div>
        )}

        <div className="mk-form-group">
          <div className="mk-form-row">
            <span className="mk-form-label">状态</span>
            <div style={{ width: 164 }}>
              <InkSegmented
                onCard
                value={status}
                onChange={setStatus}
                options={[
                  { value: "unread", label: "待研究" },
                  { value: "read", label: "已读" },
                ]}
              />
            </div>
          </div>
          <div className="mk-form-row col">
            <span className="mk-form-label">标题或链接</span>
            <input
              className="mk-form-input"
              maxLength={2000}
              placeholder="文章标题或网址"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="mk-form-row">
            <span className="mk-form-label">来源</span>
            <input
              className="mk-form-input right"
              maxLength={120}
              placeholder="如：微信、X、论文"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>
          <div className="mk-form-row">
            <span className="mk-form-label">标签</span>
            <input
              className="mk-form-input right"
              maxLength={300}
              placeholder="用逗号或顿号分隔"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>
          <div className="mk-form-row col">
            <span className="mk-form-label">说明（网址或备注）</span>
            <textarea
              className="mk-form-textarea"
              maxLength={10000}
              placeholder="粘贴网址或写一句备注…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        {item && !latest && (
          <p className="mfx-error">这条收藏已被移除。</p>
        )}

        {item && latest && (
          <button
            type="button"
            className="mk-pill danger lg full"
            onClick={() => setConfirmDelete(true)}
          >
            移入回收站
          </button>
        )}
      </InkSheet>

      <InkActionSheet
        open={confirmDelete}
        title="移入回收站？"
        onClose={() => setConfirmDelete(false)}
        items={[
          {
            label: "移入回收站",
            icon: "trash",
            danger: true,
            onClick: () => {
              if (!item) return;
              perform(remove(item).then(() => onClose()));
            },
          },
        ]}
      />
    </>
  );
}

function JoinPracticeSheet({
  open,
  item,
  domains,
  activities,
  openEvent,
  onClose,
}: {
  open: boolean;
  item?: ReadingItem;
  domains: Entity<"domain">[];
  activities: Entity<"activity">[];
  openEvent?: (id: string) => void;
  onClose: () => void;
}) {
  const [domainId, setDomainId] = useState("");
  const [activityId, setActivityId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !item) return;
    const suggested = domains.find((domain) =>
      item.data.tags?.some(
        (t) => t.toLowerCase() === domain.data.name.toLowerCase(),
      ),
    );
    setDomainId(suggested?.id ?? "");
    setActivityId("");
    setSaving(false);
  }, [open, item, domains]);

  const visibleActivities = useMemo(
    () =>
      activities.filter(
        (a) => a.data.domainId === domainId && !a.data.archived,
      ),
    [activities, domainId],
  );

  function handleCreate() {
    if (!item || !domainId || saving) return;
    setSaving(true);
    perform(
      putKey("practiceEvent", `reading:${item.id}`, {
        domainId,
        ...(activityId ? { activityId } : {}),
        readingItemId: item.id,
        title: item.data.title,
        status: "active",
      })
        .then((id) => {
          onClose();
          openEvent?.(id);
        })
        .finally(() => setSaving(false)),
    );
  }

  return (
    <InkSheet
      open={open}
      title="转为推进事件"
      onClose={() => {
        if (!saving) onClose();
      }}
      rightLabel={saving ? "创建中" : "创建"}
      rightDisabled={!domainId || saving}
      onRight={handleCreate}
    >
      {item && (
        <div className="mfx-quote">
          <span className="mfx-quote-label">收藏条目</span>
          {item.data.title}
        </div>
      )}

      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">领域</span>
          <select
            className="mk-form-select"
            value={domainId}
            onChange={(e) => {
              setDomainId(e.target.value);
              setActivityId("");
            }}
          >
            <option value="">选择领域</option>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.data.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">子领域</span>
          <select
            className="mk-form-select"
            value={activityId}
            disabled={!domainId}
            onChange={(e) => setActivityId(e.target.value)}
          >
            <option value="">整个领域</option>
            {visibleActivities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.data.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {domains.length === 0 && (
        <p className="mfx-footnote">请先在个人推进台添加一个领域。</p>
      )}
    </InkSheet>
  );
}
