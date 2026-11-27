import XCTest

@testable import CouncilCore

final class MemoirTests: XCTestCase {
  func testWireRecordRoundTripsFullAndMinimalMemoirPayloads() throws {
    let full = MemoirFields(
      period: "high_school", title: "校运会接力", approxTime: "高二秋天",
      detail: "体育课练习交棒。\n\n比赛时跑第二棒。", order: 1.5)
    let minimal = MemoirFields(period: "primary_and_below", title: "第一次参加比赛")
    let expected: [[String: JSONValue]] = [
      [
        "period": .string("high_school"), "title": .string("校运会接力"),
        "approxTime": .string("高二秋天"), "detail": .string("体育课练习交棒。\n\n比赛时跑第二棒。"),
        "order": .number(1.5),
      ],
      ["period": .string("primary_and_below"), "title": .string("第一次参加比赛")],
    ]

    for (fields, payload) in zip([full, minimal], expected) {
      let record = Record(
        id: "memoir-fixture", type: MemoirFields.entityType, version: 1, data: fields.data,
        deleted: false, updatedAt: "2026-11-26T00:00:00.000Z")
      let decoded = try JSONDecoder().decode(Record.self, from: JSONEncoder().encode(record))
      XCTAssertEqual(decoded.type, "memoir")
      XCTAssertEqual(decoded.data, payload)
      XCTAssertEqual(MemoirFields(decoded), fields)
    }
  }

  func testMemoirSchemaAndSQLiteFieldMapping() async throws {
    let spec = try XCTUnwrap(EntitySchema.byType[EntityType.memoir.rawValue])
    XCTAssertEqual(spec.module, "journal")
    XCTAssertEqual(spec.table, "memoir_entries")
    XCTAssertEqual(spec.fields.filter(\.required).map(\.name), ["period", "title"])
    XCTAssertEqual(spec.field("period")?.kind, .choice)
    XCTAssertEqual(spec.field("period")?.values, ["high_school", "middle_school", "primary_and_below"])
    XCTAssertEqual(spec.field("approxTime")?.column, "approx_time")
    XCTAssertEqual(spec.field("order")?.storage, "REAL")

    let store = try CouncilStore(path: ":memory:")
    let fields = MemoirFields(
      period: "middle_school", title: "毕业纪念册", approxTime: "初三毕业前",
      detail: "在纪念册上签名。", order: 2.5)
    let id = try await store.put(type: MemoirFields.entityType, data: fields.data)
    let saved = try await store.record(type: MemoirFields.entityType, id: id)
    XCTAssertEqual(MemoirFields(try XCTUnwrap(saved)), fields)
  }
}
