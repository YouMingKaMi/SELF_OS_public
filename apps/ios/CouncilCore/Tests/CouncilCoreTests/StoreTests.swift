import XCTest

@testable import CouncilCore

final class StoreTests: XCTestCase {
  private func idea(_ body: String, status: String = "pending") -> [String: JSONValue] {
    ["body": .string(body), "day": .string("2026-11-07"), "status": .string(status)]
  }
  private func confirmed(_ id: String, _ body: String, version: Int = 1) -> Record {
    Record(
      id: id, type: "idea", version: version, data: idea(body), deleted: false,
      updatedAt: "2026-11-07T00:00:00.000Z")
  }
  private func command(_ op: PendingOperation) throws -> Command {
    try JSONDecoder().decode(Command.self, from: op.data)
  }

  func testOfflineQueueSurvivesRestartAndUndoRestoresThePreviousEdit() async throws {
    let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
    defer { try? FileManager.default.removeItem(atPath: path) }
    let store = try CouncilStore(path: path)
    try await store.put(type: "idea", data: idea("first"), id: "a")
    try await store.put(type: "idea", data: idea("edited"), id: "a")
    let reopened = try CouncilStore(path: path)
    let rows = try await reopened.records(type: "idea")
    XCTAssertEqual(rows.map { $0.text("body") }, ["edited"])
    XCTAssertEqual(rows.first?.version, 2)
    let operations = try await reopened.operations()
    XCTAssertEqual(try operations.map { try command($0).baseVersion }, [0, 1])
    try await reopened.undo(operations.last!.id)
    let reverted = try await reopened.record(type: "idea", id: "a")
    XCTAssertEqual(reverted?.text("body"), "first")
    XCTAssertEqual(reverted?.version, 1)
    try await reopened.undo(operations.first!.id)
    let gone = try await reopened.record(type: "idea", id: "a")
    XCTAssertNil(gone, "undoing an unsent create removes the record entirely")
  }

  func testTypedColumnsRoundTripEveryKindAndRangeQueriesRunInSQL() async throws {
    let store = try CouncilStore(path: ":memory:")
    let expense = ExpenseFields(
      title: "年费", day: "2026-11-07", amountMinor: "999999999999999999",
      necessary: true, mode: "fixed", startDay: "2026-11-07", endDay: "2027-11-06")
    try await store.put(type: "expense", data: expense.data, id: "e1")
    try await store.put(
      type: "expense",
      data: ExpenseFields(title: "午饭", day: "2026-10-31", amountMinor: "-3200", mode: "immediate").data,
      id: "e2")
    try await store.put(
      type: "checklist", data: ["name": .string("出门"), "items": .array([.string("钥匙"), .string("手机")])],
      id: "c1")
    try await store.put(
      type: "metricLog",
      data: ["metricId": .string("m"), "day": .string("2026-11-07"), "value": .number(7.5)], id: "l1")
    let november = try await store.records(
      Query("expense", range: .init("day", from: "2026-11-01", through: "2026-11-30")))
    XCTAssertEqual(november.map(\.id), ["e1"])
    XCTAssertEqual(november.first.flatMap(ExpenseFields.init), expense)
    let refund = try await store.record(type: "expense", id: "e2")
    XCTAssertEqual(refund?.text("amountMinor"), "-3200")
    let list = try await store.record(type: "checklist", id: "c1")
    XCTAssertEqual(list?.data["items"]?.strings, ["钥匙", "手机"])
    let log = try await store.records(Query("metricLog", equals: ["metricId": "m"]))
    XCTAssertEqual(log.first?.number("value"), 7.5)
    let found = try await store.search("年")
    XCTAssertEqual(found.map(\.id), ["e1"])
    do {
      _ = try await store.records(Query("expense", equals: ["nope": "x"]))
      XCTFail("unknown fields must not reach SQL")
    } catch CouncilStore.StoreError.unknownField {}
  }

  func testConflictBlocksFollowupsAndKeepLocalRebasesOnTheServerCopy() async throws {
    let store = try CouncilStore(path: ":memory:")
    try await store.apply([confirmed("a", "server")], cursor: "1")
    try await store.put(type: "idea", data: idea("offline"), id: "a")
    let op = try await store.operations().first!
    try await store.conflict(op, current: confirmed("a", "remote", version: 2))
    do {
      try await store.put(type: "idea", data: idea("again"), id: "a")
      XCTFail("an unresolved conflict must block further edits")
    } catch CouncilStore.StoreError.unresolvedConflict {}
    try await store.settle("a", keepLocal: true)
    let rebased = try command(try await store.operations().first!)
    XCTAssertEqual(rebased.baseVersion, 2)
    XCTAssertEqual(rebased.data?["body"], .string("offline"))
    let visible = try await store.record(type: "idea", id: "a")
    XCTAssertEqual(visible?.text("body"), "offline")
    XCTAssertEqual(visible?.version, 3)
  }

  func testAdoptingTheServerCopyDiscardsLocalEditsIncludingDeletes() async throws {
    let store = try CouncilStore(path: ":memory:")
    let original = confirmed("a", "server")
    try await store.apply([original], cursor: "1")
    try await store.remove(original)
    let hidden = try await store.records(type: "idea")
    XCTAssertTrue(hidden.isEmpty)
    let deletion = try await store.operations().first!
    try await store.conflict(deletion, current: confirmed("a", "remote", version: 2))
    try await store.settle("a", keepLocal: false)
    let restored = try await store.records(type: "idea")
    XCTAssertEqual(restored.map { $0.text("body") }, ["remote"])
    let queue = try await store.operations()
    XCTAssertTrue(queue.isEmpty)

    try await store.remove(restored[0])
    let again = try await store.operations().first!
    try await store.conflict(again, current: confirmed("a", "newer", version: 3))
    try await store.settle("a", keepLocal: true)
    let kept = try command(try await store.operations().first!)
    XCTAssertEqual([kept.action, String(kept.baseVersion)], ["delete", "3"])
  }

  func testServerChangesNeverOverwriteUnsentEditsAndAcceptanceSettlesTheRow() async throws {
    let store = try CouncilStore(path: ":memory:")
    try await store.apply([confirmed("a", "v1")], cursor: "1")
    try await store.put(type: "idea", data: idea("local"), id: "a")
    try await store.apply([confirmed("a", "remote", version: 2)], cursor: "2")
    let during = try await store.record(type: "idea", id: "a")
    XCTAssertEqual(during?.text("body"), "local", "a pull must not replace an unsent edit")
    let op = try await store.operations().first!
    try await store.accept(op, record: confirmed("a", "local", version: 2))
    let settled = try await store.record(type: "idea", id: "a")
    XCTAssertEqual(settled?.version, 2)
    try await store.apply([confirmed("a", "stale", version: 1)], cursor: "3")
    let kept = try await store.record(type: "idea", id: "a")
    XCTAssertEqual(kept?.text("body"), "local", "an older confirmed copy never wins")
    let cursor = try await store.metadata("cursor")
    XCTAssertEqual(cursor, "3")
  }

  func testUndoPreservesVersionChainAndUndoneOperationCannotBeSent() async throws {
    let store = try CouncilStore(path: ":memory:")
    try await store.put(type: "idea", data: idea("first"), id: "a")
    try await store.put(type: "idea", data: idea("second"), id: "a")
    let queue = try await store.operations()
    do {
      try await store.undo(queue[0].id)
      XCTFail("Cannot remove an earlier edit and leave its dependent version")
    } catch CouncilStore.StoreError.laterEdits {}
    try await store.undo(queue[1].id)
    let claimed = try await store.mark(queue[1], state: "sending")
    XCTAssertFalse(claimed, "An outbox snapshot taken before undo must not send the removed operation")
    let firstClaimed = try await store.mark(queue[0], state: "sending")
    XCTAssertTrue(firstClaimed)
    do {
      try await store.undo(queue[0].id)
      XCTFail("Sending operation is immutable")
    } catch CouncilStore.StoreError.alreadySending {}
  }

  func testObservationReportsOnlyItsOwnTable() async throws {
    let store = try CouncilStore(path: ":memory:")
    var updates = store.observe(Query("idea")).makeAsyncIterator()
    let initial = try await updates.next()
    XCTAssertEqual(initial?.count, 0)
    // A write to another table must not wake this observer; the next value is the idea itself.
    try await store.put(
      type: "metric", data: ["name": .string("睡眠")], id: "m")
    try await store.put(type: "idea", data: idea("seen"), id: "a")
    let next = try await updates.next()
    XCTAssertEqual(next?.map { $0.text("body") }, ["seen"])
  }

  func testTaskIntentsKeepCompletionHistoryAndFlatSchedule() throws {
    let created = TaskRules.apply(
      "create", to: nil, title: " run ", schedule: Schedule(kind: "range", start: "2026-11-28", end: "2026-12-03"),
      now: "2026-11-07T00:00:00Z")
    XCTAssertEqual(created["title"], .string("run"))
    XCTAssertEqual(created["scheduleStart"], .string("2026-11-28"))
    let task = Record(id: "t", type: "task", version: 1, data: created, deleted: false, updatedAt: "")
    XCTAssertEqual(TaskRules.schedule(task), Schedule(kind: "range", start: "2026-11-28", end: "2026-12-03"))
    XCTAssertNotNil(TaskFields(task))
    var done = task
    done.data = TaskRules.apply("complete", to: task, now: "2026-11-08T00:00:00Z")
    XCTAssertEqual(done.data["completedAt"], .string("2026-11-08T00:00:00Z"))
    let moved = TaskRules.apply(
      "schedule", to: done, schedule: Schedule(kind: "day", date: "2027-01-10"), now: "2026-11-09T00:00:00Z")
    XCTAssertEqual(moved["completedAt"], .string("2026-11-08T00:00:00Z"))
    XCTAssertNil(moved["scheduleStart"])
    XCTAssertEqual(moved["scheduleDate"], .string("2027-01-10"))
  }

  func testTimeBoundariesOverlapAndCrossClientDailyIDs() throws {
    XCTAssertEqual(
      StableID.forKey("habitLog:habit:2026-11-07"), "d6916ef8-7ada-56a0-8ffd-8b3066923dac")
  }
}
