import { useState } from "react";
import { requestTaskPlan, type Proposal } from "../data/task-plan.ts";
import { enqueueTogether, put, type Data } from "../data/entities.ts";
import { fromSchedule } from "../../../../modules/tasks/index.ts";
import { today } from "../ui/shared.tsx";

export function TaskOrganize({
  listId,
  close,
  onDone,
}: {
  listId: string;
  close: () => void;
  onDone: (ids: string[]) => void;
}) {
  const [original, setOriginal] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [draft, setDraft] = useState<Proposal>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function generate() {
    setBusy(true);
    setError("");
    try {
      setDraft(
        await requestTaskPlan(endpoint, model, apiKey, original, today()),
      );
      setApiKey("");
    } catch (issue) {
      setError(
        issue instanceof TypeError
          ? "无法连接接口。请检查地址和服务商是否允许网页直接调用。"
          : issue instanceof SyntaxError
            ? "模型没有返回有效的任务格式，请重试。"
            : issue instanceof Error
              ? issue.message
              : "整理失败，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const createdAt = new Date().toISOString();
      const writes = draft.items.map((item) => ({
        type: "task" as const,
        id: draft.ids.get(item.key)!,
        action: "put" as const,
        baseVersion: 0,
        data: {
          title: item.title.trim(),
          status: "pending",
          createdAt,
          ...fromSchedule(item.date
            ? { kind: "deadline", date: item.date }
            : { kind: "unscheduled" }),
          listId,
          scheduleTime: item.time,
          prerequisiteIds: item.after.map((key) => draft.ids.get(key)!),
          note: [item.note, "原文\n" + draft.original].filter(Boolean).join("\n\n"),
        } satisfies Data,
      }));
      if (writes.length === 1) await put("task", writes[0].data, writes[0]);
      else await enqueueTogether(writes);
      onDone(writes.map((write) => write.id));
    } catch {
      setError("整批事项未保存，草稿仍保留。请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="task-detail-layer"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy)
          close();
      }}
    >
      <section
        className="task-organize"
        role="dialog"
        aria-modal="true"
        aria-label="AI 整理"
      >
        <h2>AI 整理</h2>
        {draft ? (
          <>
            <div className="task-organize-review">
              {draft.items.map((item) => (
                <div key={item.key}>
                  <input
                    aria-label="事项名称"
                    value={item.title}
                    maxLength={500}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        items: draft.items.map((row) =>
                          row.key === item.key
                            ? { ...row, title: event.target.value }
                            : row,
                        ),
                      })
                    }
                  />
                  {(item.date || item.after.length > 0) && (
                    <small>
                      {[
                        [item.date, item.time].filter(Boolean).join(" "),
                        item.after.length
                          ? "前置 · " +
                            item.after
                              .map(
                                (id) =>
                                  draft.items.find((row) => row.key === id)
                                    ?.title,
                              )
                              .join("、")
                          : "",
                      ]
                        .filter(Boolean)
                        .join("　")}
                    </small>
                  )}
                  {item.note && <small>{item.note}</small>}
                </div>
              ))}
            </div>
            <details>
              <summary>原文</summary>
              <p className="task-organize-original">{draft.original}</p>
            </details>
          </>
        ) : (
          <>
            <textarea
              aria-label="要整理的原文"
              placeholder="粘贴一段想整理的事情…"
              value={original}
              maxLength={4000}
              onChange={(event) => setOriginal(event.target.value)}
            />
            <p>点击整理时，原文会发送到你填写的模型接口。</p>
            <label>
              接口完整地址
              <input
                type="url"
                placeholder="https://…/chat/completions"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
              />
            </label>
            <label>
              模型名称
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
            <label>
              API 密钥
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <footer>
          <button
            type="button"
            onClick={close}
            disabled={busy}
          >
            取消
          </button>
          <button
            className="primary"
            type="button"
            disabled={
              busy ||
              (draft
                ? draft.items.some((item) => !item.title.trim())
                : !original.trim() || !model.trim() || !endpoint.trim())
            }
            onClick={() => void (draft ? apply() : generate())}
          >
            {busy
              ? "处理中…"
              : draft
                ? `添加 ${draft.items.length} 项`
                : "整理"}
          </button>
        </footer>
      </section>
    </div>
  );
}
