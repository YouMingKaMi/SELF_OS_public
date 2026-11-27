import assert from "node:assert/strict";
import { test } from "node:test";
import { documentsMarkdown } from "../../apps/web/src/features/document-export.ts";

test("Markdown export preserves headings, fences, and whitespace verbatim", () => {
  const body =
    "  \n# 标题\n\n````md\n```sh\n# comment\n  echo hi  \n```\n````\n\n";
  const result = documentsMarkdown(
    [
      {
        updatedAt: "2026-02-08T10:00:00Z",
        data: {
          title: "原文",
          day: "2026-02-08",
          tags: ["代码", "例子"],
          body,
        },
      },
    ],
    "导出",
    "2026-03-01",
  );
  assert.equal(
    result,
    "# 导出\n\n共 1 篇，导出于 2026-03-01。按日期从早到晚排列。\n\n---\n\n## 原文\n\n> 日期：2026-02-08 · 标签：代码、例子\n\n" +
      body +
      "\n",
  );
});

test("monthly exports use the report month when the writing date differs", () => {
  const result = documentsMarkdown(
    [
      {
        updatedAt: "2026-03-07T10:00:00Z",
        data: { kind: "monthly", title: "二月", month: "2026-02" },
      },
      {
        updatedAt: "2026-03-08T10:00:00Z",
        data: {
          kind: "monthly",
          title: "一月",
          month: "2026-01",
          day: "2026-03-08",
        },
      },
    ],
    "月报",
    "2026-03-09",
  );
  assert.match(
    result,
    /## 一月\n\n> 日期：2026-01\n\n（空）\n\n---\n\n## 二月\n\n> 日期：2026-02\n\n（空）/,
  );
});
