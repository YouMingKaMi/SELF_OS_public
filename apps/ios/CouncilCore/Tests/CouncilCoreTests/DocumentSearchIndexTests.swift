import XCTest
@testable import CouncilCore

@MainActor final class DocumentSearchIndexTests: XCTestCase {
  func testExactQueriesAndChangesAcrossBlocks() async {
    let search = DocumentSearchIndex()
    var records = (0..<66).map { i in
      Record(
        id: String(i), type: "document", version: 1,
        data: [
          "kind": .string(i == 65 ? "monthly" : "thought"),
          "title": .string(i.isMultiple(of: 2) ? "Café Research" : "本机全文索引"),
          "body": .string(i.isMultiple(of: 4) ? "先记录，再读完整文章。" : "离线工作 🎧 获得专注。"),
        ],
        deleted: false, updatedAt: "2026-11-22T00:00:00Z")
    }
    for query in ["全", "全文", "录，再", "RESEARCH", "CAFE\u{301}", "🎧", "全文 research", "🎧获得", ""] {
      let expected = records
        .filter {
          $0.text("kind") == "thought" && (query.isEmpty
            || $0.title.localizedCaseInsensitiveContains(query)
            || $0.text("body").localizedCaseInsensitiveContains(query))
        }.map(\.id).sorted()
      let results = await search.search(kind: "thought", at: 1, records: records, query: query)
      XCTAssertEqual(results.map(\.id), expected, query)
    }

    records[31].deleted = true
    records[32].data["body"] = .string("保存后的新正文")
    var added = records[31]
    added.id = "new"
    added.deleted = false
    added.data["body"] = .string("全新文稿")
    records.append(added)
    let removed = await search.search(kind: "thought", at: 2, records: records, query: "索引")
    XCTAssertFalse(removed.contains { $0.id == "31" })
    let changed = await search.search(kind: "thought", at: 2, records: records, query: "新正文")
    XCTAssertEqual(changed.map(\.id), ["32"])
    let reused = await search.search(kind: "thought", at: 2, records: records, query: "全新")
    XCTAssertEqual(reused.map(\.id), ["new"])
  }
}
