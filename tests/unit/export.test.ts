import { test } from "node:test";
import assert from "node:assert/strict";
import { documentsMarkdown } from "../../apps/web/src/features/document-export.ts";

const doc = (title: string, day: string, body: string, tags?: string[]) =>
  ({ id: title, type: "document", version: 1, deleted: false, updatedAt: "2026-11-01T00:00:00Z", data: { title, day, body, kind: "thought", ...(tags ? { tags } : {}) } }) as never;

test("thoughts export as one Markdown file, oldest first, with date and tags", () => {
  const md = documentsMarkdown([doc("后来", "2026-10-02", "# 小节\n内容"), doc("最早", "2026-09-01", "第一篇", ["人生", "时间"])], "个人思考", "2026-11-12");
  assert.match(md, /^# 个人思考\n\n共 2 篇，导出于 2026-11-12/);
  assert.ok(md.indexOf("## 最早") < md.indexOf("## 后来"));
  assert.match(md, /> 日期：2026-09-01 · 标签：人生、时间/);
  assert.match(md, /> 日期：2026-10-02\n/);
  assert.match(md, /^# 小节$/m, "export keeps the original heading and body");
});
