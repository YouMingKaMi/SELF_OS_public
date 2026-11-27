type Doc = { updatedAt: string; data: Record<string, unknown> };
const str = (e: Doc, key: string) => String(e.data[key] ?? "");
const documentDate = (e: Doc) =>
  (e.data.kind === "monthly" ? str(e, "month") : str(e, "day")) ||
  (e.data.kind === "monthly" ? str(e, "day") : str(e, "month")) ||
  e.updatedAt.slice(0, 10);

/**
 * Every document of one kind as a single Markdown file, oldest first, each with its date and tags,
 * ready to hand to an AI or keep as an archive.
 */
export function* documentMarkdownParts(
  docs: readonly Doc[],
  title: string,
  today: string,
): IterableIterator<string> {
  const dated = [...docs].sort(
    (a, b) =>
      documentDate(a).localeCompare(documentDate(b)) ||
      a.updatedAt.localeCompare(b.updatedAt),
  );
  yield `# ${title}\n\n共 ${dated.length} 篇，导出于 ${today}。按日期从早到晚排列。\n\n---\n\n`;
  for (const [index, e] of dated.entries()) {
    if (index) yield "\n\n---\n\n";
    const date = documentDate(e);
    const tags = (Array.isArray(e.data.tags) ? e.data.tags : [])
      .map(String)
      .filter(Boolean);
    const meta = [
      `日期：${date}`,
      tags.length ? `标签：${tags.join("、")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    yield `## ${str(e, "title") || "无标题"}\n\n> ${meta}\n\n`;
    yield str(e, "body") || "（空）";
  }
  yield "\n";
}

export function documentsMarkdown(docs: Doc[], title: string, today: string) {
  return [...documentMarkdownParts(docs, title, today)].join("");
}
