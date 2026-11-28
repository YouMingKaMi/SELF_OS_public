import React, { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import "./mobile-writing.css";
import { Icon } from "../../ui/Icon.tsx";
import { arr, monthNow, perform, str, today } from "../../ui/shared.tsx";
import { downloadFile } from "../../ui/download.ts";
import {
  clearDocumentDraft,
  readDocumentDraft,
  useDocumentDraft,
  writeDocumentDraft,
} from "../../ui/document-draft.ts";
import { useDocumentSearch } from "../../data/document-search.ts";
import { documentMarkdownParts, documentsMarkdown } from "../document-export.ts";
import {
  applyPatch,
  fieldPatch,
  hasFieldConflict,
} from "../../../../../packages/contracts/edit.ts";
import {
  put,
  remove,
  saveEdit,
  useEntities,
  type AnyEntity as Entity,
  type Data,
} from "../../data/entities.ts";
import {
  InkActionSheet,
  InkCard,
  InkChipBar,
  InkEmpty,
  InkHairline,
  InkNavIcon,
  InkNavText,
  InkScreen,
  InkSearch,
  InkSectionLabel,
  InkSheet,
  MobileSubPage,
  MobileToolbar,
  monthTitle,
  type ActionSheetItem,
} from "./MobileKit.tsx";

type DocKind = "monthly" | "note" | "thought";
type NoteSource = "unknown" | "original" | "ai" | "assisted" | "excerpt";

const KIND_TITLES: Record<DocKind, string> = {
  monthly: "月报",
  note: "资料笔记",
  thought: "个人思考",
};

const SOURCE_LABELS: Record<NoteSource, string> = {
  unknown: "来源未标注",
  original: "个人原创",
  ai: "AI 生成",
  assisted: "AI 辅助",
  excerpt: "摘录",
};

const SOURCE_OPTIONS: readonly NoteSource[] = [
  "unknown",
  "original",
  "ai",
  "assisted",
  "excerpt",
];

function docExcerpt(body: string): string {
  return body
    .replace(/[#*`>~\-\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function docDateLabel(doc: Entity, kind: DocKind): string {
  if (kind === "monthly") {
    const m = str(doc, "month") || str(doc, "day").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m)) return monthTitle(m);
    return m || doc.updatedAt.slice(0, 7);
  }
  return str(doc, "day") || doc.updatedAt.slice(0, 10);
}

function docSortKey(doc: Entity, kind: DocKind): string {
  if (kind === "monthly") {
    return str(doc, "month") || str(doc, "day").slice(0, 7) || doc.updatedAt.slice(0, 7);
  }
  return str(doc, "day") || doc.updatedAt.slice(0, 10);
}

function parseTagInput(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,，、\s]+/)
        .map((s) => s.trim().replace(/^#/, ""))
        .filter(Boolean),
    ),
  ];
}

function sanitizeDocData(kind: DocKind, raw: Data): Data {
  const next: Data = {
    ...raw,
    kind,
    title: String(raw.title ?? "").trim(),
    body: String(raw.body ?? ""),
  };
  if (kind === "monthly") {
    const m = String(raw.month ?? "").trim() || monthNow();
    next.month = m;
    if (!next.day) next.day = `${m}-01`;
  } else {
    if (!next.day) next.day = today();
    delete next.month;
  }
  if (kind === "note") {
    const domainId = String(raw.domainId ?? "").trim();
    if (domainId) {
      next.domainId = domainId;
      const src = String(raw.source ?? "unknown").trim();
      next.source = src || "unknown";
    } else {
      delete next.domainId;
      delete next.source;
      delete next.activityId;
    }
  } else {
    delete next.domainId;
    delete next.source;
    delete next.activityId;
  }
  if (Array.isArray(raw.tags)) {
    const cleaned = raw.tags.map(String).map((s) => s.trim()).filter(Boolean);
    if (cleaned.length > 0) next.tags = cleaned;
    else delete next.tags;
  }
  return next;
}

export function MobileDocuments({
  kind,
}: {
  kind: "monthly" | "note" | "thought";
}) {
  const { entities } = useEntities("document");
  const { entities: domains } = useEntities("domain");

  const [query, setQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [toast, setToast] = useState("");

  // Reset open document if kind switches
  useEffect(() => {
    setOpenDocId(null);
    setCreating(false);
    setQuery("");
    setDomainFilter("all");
    setTagFilter("all");
  }, [kind]);

  const kindTitle = KIND_TITLES[kind];

  const domainNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of domains) {
      if (!d.deleted) map.set(d.id, str(d, "name"));
    }
    return map;
  }, [domains]);

  const allDocs = useMemo(() => {
    return entities
      .filter((e) => !e.deleted && e.data.kind === kind)
      .sort(
        (a, b) =>
          docSortKey(b, kind).localeCompare(docSortKey(a, kind)) ||
          b.updatedAt.localeCompare(a.updatedAt),
      );
  }, [entities, kind]);

  const matches = useDocumentSearch(entities, query.trim());

  const domainChips = useMemo(() => {
    if (kind !== "note") return [];
    const counts = new Map<string, number>();
    let uncategorized = 0;
    for (const d of allDocs) {
      const did = str(d, "domainId");
      if (did && domainNameById.has(did)) {
        counts.set(did, (counts.get(did) ?? 0) + 1);
      } else {
        uncategorized += 1;
      }
    }
    const chips: { value: string; label: string; count?: number }[] = [
      { value: "all", label: "全部", count: allDocs.length },
    ];
    for (const d of domains) {
      if (d.deleted) continue;
      const cnt = counts.get(d.id) ?? 0;
      if (cnt > 0) {
        chips.push({ value: d.id, label: str(d, "name"), count: cnt });
      }
    }
    if (uncategorized > 0) {
      chips.push({ value: "__none__", label: "未分类", count: uncategorized });
    }
    return chips;
  }, [kind, allDocs, domains, domainNameById]);

  const tagChips = useMemo(() => {
    if (kind !== "thought") return [];
    const counts = new Map<string, number>();
    for (const d of allDocs) {
      for (const t of arr(d, "tags")) {
        if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    if (counts.size === 0) return [];
    const chips: { value: string; label: string; count?: number }[] = [
      { value: "all", label: "全部", count: allDocs.length },
    ];
    for (const [tag, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      chips.push({ value: tag, label: `#${tag}`, count });
    }
    return chips;
  }, [kind, allDocs]);

  const filteredDocs = useMemo(() => {
    const q = query.trim();
    return allDocs.filter((doc) => {
      if (kind === "note" && domainFilter !== "all") {
        const did = str(doc, "domainId");
        if (domainFilter === "__none__") {
          if (did && domainNameById.has(did)) return false;
        } else if (did !== domainFilter) {
          return false;
        }
      }
      if (kind === "thought" && tagFilter !== "all") {
        if (!arr(doc, "tags").includes(tagFilter)) return false;
      }
      if (!q) return true;
      if (matches) return matches.has(doc.id);
      const needle = q.toLowerCase();
      return (
        str(doc, "title").toLowerCase().includes(needle) ||
        str(doc, "body").toLowerCase().includes(needle)
      );
    });
  }, [allDocs, kind, domainFilter, tagFilter, domainNameById, query, matches]);

  const activeDoc = useMemo(
    () => (openDocId ? allDocs.find((d) => d.id === openDocId) ?? null : null),
    [allDocs, openDocId],
  );

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? "" : cur)), 2000);
  }

  function startNewDocument() {
    const draftKey = `${kind}:new`;
    if (!readDocumentDraft(draftKey)) {
      const m = monthNow();
      const base: Data =
        kind === "monthly"
          ? {
              kind,
              month: m,
              day: today(),
              title: `${monthTitle(m)} 月报`,
              body: "",
            }
          : {
              kind,
              day: today(),
              title: "",
              body: "",
              ...(kind === "note" && domainFilter !== "all" && domainFilter !== "__none__"
                ? { domainId: domainFilter, source: "unknown" }
                : {}),
              ...(kind === "thought" && tagFilter !== "all"
                ? { tags: [tagFilter] }
                : {}),
            };
      writeDocumentDraft(draftKey, { data: base, base: null });
    }
    setOpenDocId(null);
    setCreating(true);
  }

  async function exportAllMarkdown() {
    if (!allDocs.length) return;
    const d = today();
    await downloadFile(`${kindTitle}-${d}.md`, "text/markdown;charset=utf-8", async (write) => {
      let chunk = "";
      for (const part of documentMarkdownParts(allDocs, kindTitle, d)) {
        chunk += part;
        if (chunk.length >= 262_144) {
          await write(chunk);
          chunk = "";
        }
      }
      if (chunk) await write(chunk);
    });
    flash(`已导出 ${allDocs.length} 篇`);
  }

  const listMenuItems: ActionSheetItem[] = useMemo(() => {
    const items: ActionSheetItem[] = [
      {
        label: kind === "monthly" ? "新建月报" : "新建文章",
        icon: "plus",
        onClick: startNewDocument,
      },
    ];
    if (allDocs.length > 0) {
      items.push(
        {
          label: `复制全部 ${kindTitle} Markdown`,
          icon: "copy",
          onClick: () =>
            perform(
              navigator.clipboard
                .writeText(documentsMarkdown(allDocs, kindTitle, today()))
                .then(() => flash("已复制全部 Markdown")),
            ),
        },
        {
          label: `导出全部 ${kindTitle} (.md)`,
          icon: "download",
          onClick: () => perform(exportAllMarkdown()),
        },
      );
    }
    return items;
  }, [allDocs, kind, kindTitle, domainFilter, tagFilter]);

  // PUSHED DETAIL / NEW EDITOR SUBPAGE (List is NOT shown below!)
  if (creating) {
    return (
      <MobileDocumentDetail
        key={`${kind}:new`}
        kind={kind}
        doc={null}
        domains={domains}
        domainNameById={domainNameById}
        initialEditing
        onBack={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          setOpenDocId(id);
        }}
        onDeleted={() => setCreating(false)}
      />
    );
  }

  if (openDocId !== null) {
    return (
      <MobileDocumentDetail
        key={openDocId}
        kind={kind}
        doc={activeDoc}
        domains={domains}
        domainNameById={domainNameById}
        initialEditing={false}
        onBack={() => setOpenDocId(null)}
        onCreated={(id) => setOpenDocId(id)}
        onDeleted={() => setOpenDocId(null)}
      />
    );
  }

  // LIST SCREEN
  return (
    <InkScreen>
      <MobileToolbar>
        {allDocs.length > 0 && (
          <InkNavIcon
            icon="ellipsis"
            label="更多操作"
            onClick={() => setListMenuOpen(true)}
          />
        )}
        <InkNavIcon
          icon="plus"
          label={kind === "monthly" ? "新建月报" : "新建文章"}
          onClick={startNewDocument}
        />
      </MobileToolbar>

      <InkSearch
        value={query}
        onChange={setQuery}
        placeholder="搜索标题或正文…"
      />

      {kind === "note" && domainChips.length > 1 && (
        <InkChipBar
          size="sm"
          value={domainFilter}
          onChange={setDomainFilter}
          items={domainChips}
        />
      )}

      {kind === "thought" && tagChips.length > 1 && (
        <InkChipBar
          size="sm"
          value={tagFilter}
          onChange={setTagFilter}
          items={tagChips}
        />
      )}

      <InkSectionLabel
        title={kind === "monthly" ? "全部月报" : kind === "note" ? "资料笔记" : "个人思考"}
        aside={`${filteredDocs.length} 篇`}
      />

      {filteredDocs.length > 0 ? (
        <InkCard variant="compact">
          {filteredDocs.map((doc, idx) => {
            const title = str(doc, "title") || "无标题";
            const body = str(doc, "body");
            const excerpt = docExcerpt(body);
            const dateStr = docDateLabel(doc, kind);
            const charCount = body.trim().length;
            const domainName =
              kind === "note" ? domainNameById.get(str(doc, "domainId")) : undefined;
            const sourceRaw = str(doc, "source") as NoteSource;
            const showSource =
              kind === "note" &&
              Boolean(domainName) &&
              Boolean(sourceRaw) &&
              sourceRaw !== "unknown" &&
              sourceRaw in SOURCE_LABELS;
            const tags = kind === "thought" ? arr(doc, "tags").slice(0, 2) : [];

            return (
              <React.Fragment key={doc.id}>
                {idx > 0 && <InkHairline />}
                <button
                  type="button"
                  className="mw-doc-row"
                  onClick={() => setOpenDocId(doc.id)}
                >
                  <div className="mw-doc-row-main">
                    <div className="mw-doc-row-title">{title}</div>
                    {excerpt && <div className="mw-doc-row-excerpt">{excerpt}</div>}
                    <div className="mw-doc-row-meta">
                      <span>{dateStr}</span>
                      <span>·</span>
                      <span>{charCount} 字</span>
                      {domainName && (
                        <span className="mw-pill-tag">{domainName}</span>
                      )}
                      {showSource && (
                        <span className="mw-pill-tag muted">
                          {SOURCE_LABELS[sourceRaw]}
                        </span>
                      )}
                      {tags.map((t) => (
                        <span key={t} className="mw-pill-tag muted">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="mk-row-chevron" aria-hidden="true">
                    <Icon name="chevron-right" size={16} />
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </InkCard>
      ) : (
        <InkCard>
          {query.trim() ? (
            <InkEmpty text="没有找到相关文章，换个关键词试试" />
          ) : (
            <div className="mw-empty-hero">
              <h3>{kind === "monthly" ? "还没有月报" : "从一篇文字开始"}</h3>
              <p>
                {kind === "monthly"
                  ? "把一个月的行动、收获和方向沉淀下来，点击即可全屏阅读与编辑。"
                  : kind === "note"
                    ? "在领域中整理资料与摘录，支持 Markdown 阅读。"
                    : "安静地把一个想法写完整，随时回来重读与修改。"}
              </p>
              <button
                type="button"
                className="mk-pill solid"
                onClick={startNewDocument}
              >
                <Icon name="plus" size={15} />
                <span>{kind === "monthly" ? "写本月月报" : "开始写作"}</span>
              </button>
            </div>
          )}
        </InkCard>
      )}

      <InkActionSheet
        open={listMenuOpen}
        title={kindTitle}
        items={listMenuItems}
        onClose={() => setListMenuOpen(false)}
      />

      {toast && <div className="mw-toast">{toast}</div>}
    </InkScreen>
  );
}

/* ─────────────────────────── Pushed Document Reader & Editor ─────────────────────────── */

function MobileDocumentDetail({
  kind,
  doc,
  domains,
  domainNameById,
  initialEditing,
  onBack,
  onCreated,
  onDeleted,
}: {
  kind: DocKind;
  doc: Entity | null;
  domains: readonly Entity[];
  domainNameById: Map<string, string>;
  initialEditing: boolean;
  onBack: () => void;
  onCreated: (id: string) => void;
  onDeleted: () => void;
}) {
  const isNew = doc === null;
  const draftKey = `${kind}:${isNew ? "new" : doc.id}`;
  const savedDraft = useDocumentDraft(draftKey);

  const [editing, setEditing] = useState(initialEditing);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [metaSheetOpen, setMetaSheetOpen] = useState(false);
  const [toast, setToast] = useState("");

  // Metadata sheet local fields
  const [metaDate, setMetaDate] = useState("");
  const [metaDomainId, setMetaDomainId] = useState("");
  const [metaSource, setMetaSource] = useState<NoteSource>("unknown");
  const [metaTagsInput, setMetaTagsInput] = useState("");

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const dirty = Boolean(
    savedDraft &&
      (!savedDraft.base ||
        Object.keys(fieldPatch(savedDraft.base.data, savedDraft.data)).length > 0),
  );
  const draft: Data = dirty || isNew ? savedDraft?.data ?? {} : doc?.data ?? {};
  const hasConflict = Boolean(
    !isNew &&
      doc &&
      savedDraft?.base &&
      hasFieldConflict(
        savedDraft.base.data,
        doc.data,
        fieldPatch(savedDraft.base.data, draft),
      ),
  );
  const unknownBase = Boolean(!isNew && savedDraft && !savedDraft.base);
  const canSave = isNew || Boolean(doc && !hasConflict && !unknownBase);

  const editTitle = String(draft.title ?? "");
  const editBody = String(draft.body ?? "");
  const editMonth = String(draft.month ?? "") || monthNow();
  const editDay = String(draft.day ?? "") || today();
  const editDomainId = String(draft.domainId ?? "");
  const editSource = (String(draft.source ?? "unknown") || "unknown") as NoteSource;
  const editTags = Array.isArray(draft.tags) ? draft.tags.map(String).filter(Boolean) : [];

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? "" : cur)), 2000);
  }

  function updateDraft(next: Data) {
    writeDocumentDraft(draftKey, {
      data: next,
      base: dirty
        ? savedDraft?.base
        : isNew
          ? null
          : doc
            ? { version: doc.version, data: doc.data }
            : null,
    });
  }

  // Auto-grow title & body textareas cleanly so .ms-scroll handles scrolling natively
  useEffect(() => {
    if (!editing) return;
    const resize = (el: HTMLTextAreaElement | null) => {
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    resize(titleRef.current);
    resize(bodyRef.current);
  }, [editing, editTitle, editBody]);

  // Gentle auto-save for existing docs while editing
  useEffect(() => {
    if (!editing || isNew || !doc || !dirty || !canSave || saving) return;
    if (!editTitle.trim()) return;
    const timer = window.setTimeout(() => {
      void saveNow("stay");
    }, 1800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, isNew, doc?.id, dirty, canSave, saving, editTitle, editBody, editMonth, editDay, editDomainId, editSource]);

  async function saveNow(afterSave: "stay" | "read" | "back") {
    if (saving || !canSave) return;
    if (!editTitle.trim()) {
      flash("请先填写标题");
      return;
    }
    const clean = sanitizeDocData(kind, draft);
    setSaving(true);
    try {
      const currentDraftSnap = readDocumentDraft(draftKey);
      const id = isNew
        ? await put("document", clean)
        : await saveEdit(
            "document",
            doc!.id,
            savedDraft?.base?.data ?? doc!.data,
            clean,
          );
      if (readDocumentDraft(draftKey) === currentDraftSnap) {
        clearDocumentDraft(draftKey);
      }
      if (afterSave === "back") {
        onBack();
      } else if (isNew) {
        onCreated(id);
      } else if (afterSave === "read") {
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    if (isNew) {
      if (!editTitle.trim() && !editBody.trim()) {
        clearDocumentDraft(draftKey);
        onBack();
        return;
      }
      if (editTitle.trim() && !saving) {
        perform(saveNow("back"));
        return;
      }
      onBack();
      return;
    }
    if (editing && dirty && canSave && editTitle.trim() && !saving) {
      perform(saveNow("stay"));
    }
    onBack();
  }

  function openMetaSheet() {
    const sourceData = editing ? draft : doc?.data ?? {};
    setMetaDate(
      kind === "monthly"
        ? String(sourceData.month ?? "") || monthNow()
        : String(sourceData.day ?? "") || today(),
    );
    setMetaDomainId(String(sourceData.domainId ?? ""));
    setMetaSource(
      (String(sourceData.source ?? "unknown") || "unknown") as NoteSource,
    );
    const existingTags = Array.isArray(sourceData.tags)
      ? sourceData.tags.map(String).filter(Boolean)
      : [];
    setMetaTagsInput(existingTags.join(" "));
    setMetaSheetOpen(true);
  }

  async function saveMetadataSheet() {
    const parsedTags = parseTagInput(metaTagsInput);
    if (editing) {
      const next: Data = { ...draft };
      if (kind === "monthly") {
        next.month = metaDate || monthNow();
      } else {
        next.day = metaDate || today();
      }
      if (kind === "note") {
        if (metaDomainId) {
          next.domainId = metaDomainId;
          next.source = metaSource;
        } else {
          delete next.domainId;
          delete next.source;
        }
      }
      if (parsedTags.length > 0) next.tags = parsedTags;
      else delete next.tags;
      updateDraft(next);
      setMetaSheetOpen(false);
      return;
    }
    if (!doc) return;
    const next: Data = { ...doc.data };
    if (kind === "monthly") {
      next.month = metaDate || monthNow();
    } else {
      next.day = metaDate || today();
    }
    if (kind === "note") {
      if (metaDomainId) {
        next.domainId = metaDomainId;
        next.source = metaSource;
      } else {
        delete next.domainId;
        delete next.source;
      }
    }
    if (parsedTags.length > 0) next.tags = parsedTags;
    else delete next.tags;
    await saveEdit("document", doc.id, doc.data, sanitizeDocData(kind, next));
    setMetaSheetOpen(false);
    flash("元信息已更新");
  }

  async function copySingleMarkdown() {
    if (!doc) return;
    const md = documentsMarkdown([doc], str(doc, "title") || KIND_TITLES[kind], today());
    await navigator.clipboard.writeText(md);
    flash("已复制 Markdown");
  }

  async function exportSingleMarkdown() {
    if (!doc) return;
    const safeName = (str(doc, "title") || KIND_TITLES[kind]).replace(/[\\/:*?"<>|]/g, "-");
    const md = documentsMarkdown([doc], str(doc, "title") || KIND_TITLES[kind], today());
    await downloadFile(`${safeName}.md`, "text/markdown;charset=utf-8", async (write) => {
      await write(md);
    });
    flash("已导出 .md");
  }

  const pageTitle = isNew
    ? kind === "monthly"
      ? "新建月报"
      : "新建文章"
    : editing
      ? "编辑"
      : str(doc ?? undefined, "title") || KIND_TITLES[kind];

  const actionItems: ActionSheetItem[] = useMemo(() => {
    if (!doc) return [];
    return [
      {
        label: "复制 Markdown",
        icon: "copy",
        onClick: () => perform(copySingleMarkdown()),
      },
      {
        label: "导出 .md 文件",
        icon: "download",
        onClick: () => perform(exportSingleMarkdown()),
      },
      {
        label: "编辑元信息",
        icon: "sliders",
        onClick: openMetaSheet,
      },
      {
        label: "删除文章",
        icon: "trash",
        danger: true,
        onClick: () => setConfirmDeleteOpen(true),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, editing, draft]);

  const rightToolbar = editing ? (
    <InkNavText
      label={saving ? "保存中…" : "完成"}
      solid
      disabled={saving || !canSave || !editTitle.trim()}
      onClick={() => perform(saveNow("read"))}
    />
  ) : doc ? (
    <>
      <InkNavText label="编辑" onClick={() => setEditing(true)} />
      <InkNavIcon
        icon="ellipsis"
        label="更多操作"
        onClick={() => setMenuOpen(true)}
      />
    </>
  ) : undefined;

  const readerTitle = doc ? str(doc, "title") || "无标题" : "";
  const readerBody = doc ? str(doc, "body") : "";
  const readerDomain =
    doc && kind === "note" ? domainNameById.get(str(doc, "domainId")) : undefined;
  const readerSource = doc ? (str(doc, "source") as NoteSource) : "unknown";
  const readerTags = doc ? arr(doc, "tags") : [];

  return (
    <MobileSubPage title={pageTitle} onBack={handleBack} right={rightToolbar}>
      <InkScreen>
        {!isNew && !doc ? (
          <InkCard>
            <InkEmpty text="这篇文章已被移除。" />
          </InkCard>
        ) : editing ? (
          <div className="mw-editor">
            {(hasConflict || unknownBase) && doc && (
              <div className="mw-conflict-card" role="status">
                <span>
                  {unknownBase
                    ? "这是旧版草稿，请先对照当前同步版本。"
                    : "另一台设备修改了相同字段，请先对照当前版本。"}
                </span>
                <details>
                  <summary>查看当前同步版本</summary>
                  <pre className="mw-conflict-pre">
                    {str(doc, "title") + "\n\n" + str(doc, "body")}
                  </pre>
                </details>
                <div>
                  <button
                    type="button"
                    className="mk-pill sm solid"
                    onClick={() =>
                      writeDocumentDraft(draftKey, {
                        data: savedDraft?.base
                          ? applyPatch(
                              doc.data,
                              fieldPatch(savedDraft.base.data, draft),
                            )
                          : { ...doc.data, ...draft },
                        base: { version: doc.version, data: doc.data },
                      })
                    }
                  >
                    保留草稿修改，从当前版本继续
                  </button>
                </div>
              </div>
            )}

            <textarea
              ref={titleRef}
              rows={1}
              className="mw-editor-title"
              aria-label="文章标题"
              placeholder={kind === "monthly" ? "例如：2026年11月 月报" : "文章标题"}
              value={editTitle}
              onChange={(e) => updateDraft({ ...draft, title: e.target.value })}
            />

            <div className="mw-meta-strip">
              {kind === "monthly" ? (
                <span className="mw-meta-control">
                  <Icon name="calendar" size={13} />
                  <span>
                    {/^\d{4}-\d{2}$/.test(editMonth) ? monthTitle(editMonth) : editMonth}
                  </span>
                  <input
                    type="month"
                    aria-label="选择月份"
                    value={editMonth}
                    onChange={(e) => {
                      const nextMonth = e.target.value;
                      if (!nextMonth) return;
                      updateDraft({
                        ...draft,
                        month: nextMonth,
                        day: `${nextMonth}-01`,
                      });
                    }}
                  />
                </span>
              ) : (
                <span className="mw-meta-control">
                  <Icon name="calendar" size={13} />
                  <span>{editDay}</span>
                  <input
                    type="date"
                    aria-label="选择日期"
                    value={editDay}
                    onChange={(e) => {
                      if (e.target.value) updateDraft({ ...draft, day: e.target.value });
                    }}
                  />
                </span>
              )}

              {kind === "note" && (
                <>
                  <select
                    className="mw-meta-select"
                    aria-label="资料领域"
                    value={editDomainId}
                    onChange={(e) => {
                      const nextDomain = e.target.value;
                      const next: Data = { ...draft };
                      if (nextDomain) {
                        next.domainId = nextDomain;
                        next.source = next.source || "unknown";
                      } else {
                        delete next.domainId;
                        delete next.source;
                      }
                      updateDraft(next);
                    }}
                  >
                    <option value="">不属于领域</option>
                    {domains
                      .filter((d) => !d.deleted)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {str(d, "name")}
                        </option>
                      ))}
                  </select>
                  {editDomainId && (
                    <select
                      className="mw-meta-select"
                      aria-label="内容来源"
                      value={editSource}
                      onChange={(e) =>
                        updateDraft({ ...draft, source: e.target.value })
                      }
                    >
                      {SOURCE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {SOURCE_LABELS[opt]}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}

              <button
                type="button"
                className="mw-meta-control"
                onClick={openMetaSheet}
              >
                <Icon name="tag" size={13} />
                <span>
                  {editTags.length > 0 ? `${editTags.length} 个标签` : "标签"}
                </span>
              </button>
            </div>

            <InkHairline />

            <textarea
              ref={bodyRef}
              className="mw-editor-body"
              aria-label="文章正文"
              placeholder="从这里开始写，支持 Markdown…"
              value={editBody}
              onChange={(e) => updateDraft({ ...draft, body: e.target.value })}
            />

            <div className="mw-editor-foot">
              <span>{editBody.trim().length.toLocaleString("zh-CN")} 字 · Markdown</span>
              <span>{saving ? "保存中…" : dirty ? "待保存" : "已保存"}</span>
            </div>
          </div>
        ) : (
          <article className="mw-reader">
            <h1 className="mw-reader-title">{readerTitle}</h1>
            <div className="mw-reader-meta">
              <span>{docDateLabel(doc!, kind)}</span>
              <span>·</span>
              <span>{readerBody.trim().length.toLocaleString("zh-CN")} 字</span>
              {readerDomain && <span className="mw-pill-tag">{readerDomain}</span>}
              {kind === "note" &&
                readerDomain &&
                readerSource &&
                readerSource !== "unknown" &&
                readerSource in SOURCE_LABELS && (
                  <span className="mw-pill-tag muted">
                    {SOURCE_LABELS[readerSource]}
                  </span>
                )}
              {readerTags.map((t) => (
                <span key={t} className="mw-pill-tag muted">
                  #{t}
                </span>
              ))}
            </div>
            <InkHairline />
            {readerBody.trim() ? (
              <div className="mw-prose">
                <Markdown>{readerBody}</Markdown>
              </div>
            ) : (
              <InkCard>
                <div className="mw-empty-hero">
                  <h3>正文还是空的</h3>
                  <p>点击下方按钮进入 Markdown 写作模式。</p>
                  <button
                    type="button"
                    className="mk-pill solid"
                    onClick={() => setEditing(true)}
                  >
                    <Icon name="edit" size={14} />
                    <span>开始写作</span>
                  </button>
                </div>
              </InkCard>
            )}
          </article>
        )}

        <InkActionSheet
          open={menuOpen}
          title={readerTitle || KIND_TITLES[kind]}
          items={actionItems}
          onClose={() => setMenuOpen(false)}
        />

        <InkActionSheet
          open={confirmDeleteOpen}
          title="确认删除这篇文章？"
          items={[
            {
              label: "删除文章",
              icon: "trash",
              danger: true,
              onClick: () => {
                if (!doc) return;
                clearDocumentDraft(draftKey);
                perform(remove(doc).then(onDeleted));
              },
            },
          ]}
          onClose={() => setConfirmDeleteOpen(false)}
        />

        <InkSheet
          open={metaSheetOpen}
          title="编辑元信息"
          onClose={() => setMetaSheetOpen(false)}
          rightLabel="应用"
          onRight={() => perform(saveMetadataSheet())}
        >
          <div className="mk-form-group">
            <div className="mk-form-row">
              <span className="mk-form-label">
                {kind === "monthly" ? "月份" : "日期"}
              </span>
              <input
                type={kind === "monthly" ? "month" : "date"}
                className="mk-form-input right"
                value={metaDate}
                onChange={(e) => setMetaDate(e.target.value)}
              />
            </div>
            {kind === "note" && (
              <>
                <div className="mk-form-row">
                  <span className="mk-form-label">所属领域</span>
                  <select
                    className="mk-form-select"
                    value={metaDomainId}
                    onChange={(e) => setMetaDomainId(e.target.value)}
                  >
                    <option value="">不属于领域</option>
                    {domains
                      .filter((d) => !d.deleted)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {str(d, "name")}
                        </option>
                      ))}
                  </select>
                </div>
                {metaDomainId && (
                  <div className="mk-form-row">
                    <span className="mk-form-label">内容来源</span>
                    <select
                      className="mk-form-select"
                      value={metaSource}
                      onChange={(e) => setMetaSource(e.target.value as NoteSource)}
                    >
                      {SOURCE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {SOURCE_LABELS[opt]}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}
            <div className="mk-form-row col">
              <span className="mk-form-label">标签（用空格或逗号分隔）</span>
              <input
                type="text"
                className="mk-form-input"
                placeholder="例如：年度复盘 读书 思考"
                value={metaTagsInput}
                onChange={(e) => setMetaTagsInput(e.target.value)}
              />
            </div>
          </div>
        </InkSheet>

        {toast && <div className="mw-toast">{toast}</div>}
      </InkScreen>
    </MobileSubPage>
  );
}
