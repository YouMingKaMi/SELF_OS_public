import assert from "node:assert/strict";
import { test } from "node:test";
import { DocumentSearchIndex } from "../../modules/documents/index.ts";

test("document search preserves exact substrings across bitmap blocks and replacements", () => {
  const index = new DocumentSearchIndex();
  const documents = Array.from({ length: 66 }, (_, position) => ({
    id: String(position),
    title: position % 2 ? "本机关键词索引" : "Personal Research",
    body: position % 4 ? "第三次离线搜索 🎧 记录。" : "先记录，再读完整文章。",
  }));
  for (const row of documents) index.upsert(row);
  for (const query of [
    "关",
    "关键",
    "关键词",
    "索引",
    "RESEARCH",
    "关键词 RESEARCH",
    "🎧",
    "文",
    "记录，再",
    "索引 第三",
    "次🎧",
  ]) {
    const expected = documents
      .filter((row) =>
        (row.title + " " + row.body)
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
      .map(({ id }) => id);
    assert.deepEqual(index.find(query).sort(), expected.sort());
  }
  index.remove("31");
  index.remove("64");
  index.upsert({ id: "32", title: "文稿", body: "测试正文替换" });
  index.upsert({ id: "new", title: "本机", body: "新增文稿" });

  assert.deepEqual(index.find("正文替换"), ["32"]);
  assert.deepEqual(index.find("新增"), ["new"]);
  assert.ok(!index.find("关键").includes("31"));
  assert.ok(!index.find("research").includes("64"));
  assert.ok(!index.find("research").includes("32"));
});
