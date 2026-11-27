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

  func testGroupedWritesRollbackTogetherAndUndoBothOffline() async throws {
    let store = try CouncilStore(path: ":memory:")
    let first = BatchPut(type: "idea", id: "a", data: idea("first"), version: 0)
    let stale = BatchPut(type: "idea", id: "b", data: idea("stale"), version: 1)
    do {
      try await store.putTogether([first, stale])
      XCTFail("stale base version should abort the entire batch")
    } catch CouncilStore.StoreError.editChanged {}
    let empty = try await store.operations()
    XCTAssertTrue(empty.isEmpty)
    let noProjection = try await store.record(type: "idea", id: "a")
    XCTAssertNil(noProjection)
    try await store.putTogether([first, BatchPut(type: "idea", id: "b", data: idea("second"), version: 0)])
    let pending = try await store.operations()
    XCTAssertEqual(pending.count, 2)
    let batch = try XCTUnwrap(pending.first?.batchId)
    XCTAssertTrue(pending.allSatisfy { $0.batchId == batch })
    XCTAssertEqual(try pending.map { try command($0).action }, ["batch-put", "batch-put"])
    try await store.undo(pending[1].id)
    let final = try await store.operations()
    let remaining = try await store.records(type: "idea")
    XCTAssertTrue(final.isEmpty)
    XCTAssertTrue(remaining.isEmpty)
  }

  func testJournalTransferKeepsDateAndRejectsStaleSelection() async throws {
    let store = try CouncilStore(path: ":memory:")
    let source = confirmed("source", "留😀移后", version: 1)
    try await store.apply([source], cursor: "1")
    do {
      try await store.transferJournalText(source, selection: 2..<4)
      XCTFail("a selection that splits an emoji must fail")
    } catch CouncilStore.StoreError.invalidTransfer {}
    let destination = try await store.transferJournalText(source, selection: 1..<4)
    let original = try await store.record(type: "idea", id: source.id)
    let journal = try await store.record(type: "journal", id: destination)
    XCTAssertEqual(original?.text("body"), "留后")
    XCTAssertEqual(journal?.text("body"), "😀移")
    XCTAssertEqual(journal?.text("day"), "2026-11-07")
    XCTAssertEqual(journal?.text("kind"), "raw")
    do {
      try await store.transferJournalText(source, selection: 1..<4)
      XCTFail("a repeated migration must fail against the old source")
    } catch CouncilStore.StoreError.editChanged {}
    let ops = try await store.operations()
    let batch = try XCTUnwrap(ops.first?.batchId)
    XCTAssertEqual(ops.map(\.batchId), [batch, batch])
    XCTAssertEqual(try ops.map { try command($0).action }, ["batch-put", "batch-put"])
    _ = try await store.claimBatch(batch, count: 2)
    try await store.rejectBatch(batch, message: "conflict", conflictId: source.id,
      current: confirmed(source.id, "远端修改", version: 2))
    do {
      try await store.settle(source.id, keepLocal: true)
      XCTFail("a transfer must not blindly rebase its stale text range")
    } catch CouncilStore.StoreError.editChanged {}
    try await store.settle(source.id, keepLocal: false)
    let restored = try await store.record(type: "idea", id: source.id)
    let discarded = try await store.record(type: "journal", id: destination)
    XCTAssertEqual(restored?.text("body"), "远端修改")
    XCTAssertNil(discarded)
  }

  func testGroupedConflictKeepsBothDraftsAndRetriesUnderANewBatchID() async throws {
    let store = try CouncilStore(path: ":memory:")
    try await store.putTogether([
      BatchPut(type: "idea", id: "a", data: idea("first"), version: 0),
      BatchPut(type: "idea", id: "b", data: idea("second"), version: 0),
    ])
    let pending = try await store.operations()
    let batch = try XCTUnwrap(pending.first?.batchId)
    let claimed = try await store.claimBatch(batch, count: 2)
    XCTAssertTrue(claimed)
    let confirmed = confirmed("b", "new remote")
    try await store.rejectBatch(batch, message: "同批修改包含冲突", conflictId: "b", current: confirmed)
    let blocked = try await store.operations()
    XCTAssertEqual(blocked.map(\.state), ["error", "conflict"])
    try await store.settle("a", keepLocal: true)
    let retry = try await store.operations()
    XCTAssertEqual(retry.map(\.state), ["queued", "queued"])
    XCTAssertNotEqual(retry.first?.batchId, batch)
    XCTAssertEqual(try retry.map { try command($0).baseVersion }, [0, 1])
  }

  func testCompletingFromAStaleTaskListChecksPrerequisitesAndQueuesOnlyOnce() async throws {
    let store = try CouncilStore(path: ":memory:")
    let first = try await store.put(
      type: "task", data: ["title": .string("先写提纲"), "status": .string("pending")])
    let second = try await store.put(
      type: "task", data: [
        "title": .string("开始写作"), "status": .string("pending"),
        "prerequisiteIds": .array([.string(first)]),
      ])
    do {
      try await store.completeTask(id: second)
      XCTFail("the current prerequisites must still win over a stale widget")
    } catch CouncilStore.StoreError.blockedTask {}
    let blocked = try await store.record(type: "task", id: second)
    XCTAssertEqual(blocked?.text("status"), "pending")

    try await store.completeTask(id: first)
    try await store.completeTask(id: second, at: Date(timeIntervalSince1970: 100))
    try await store.completeTask(id: second, at: Date(timeIntervalSince1970: 200))
    let finished = try await store.record(type: "task", id: second)
    let queue = try await store.operations().filter { $0.entityId == second }
    XCTAssertEqual(finished?.text("status"), "completed")
    XCTAssertEqual(finished?.text("completedAt"), "1970-01-01T00:01:40Z")
    XCTAssertEqual(queue.count, 2, "one create and one completion")
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

  func testDocumentEditUsesItsOriginalFieldsAndMergesDisjointChanges() async throws {
    let store = try CouncilStore(path: ":memory:")
    let start = Record(
      id: "draft", type: "document", version: 1,
      data: ["title": .string("old title"), "body": .string("old body"), "kind": .string("thought")],
      deleted: false, updatedAt: "2026-11-07T00:00:00.000Z")
    try await store.apply([start], cursor: "1")
    var remote = start
    remote.version = 2
    remote.data["body"] = .string("remote body")
    try await store.apply([remote], cursor: "2")
    var local = start.data
    local["body"] = .string("local body")
    do {
      try await store.put(type: "document", data: local, id: start.id, editBase: start)
      XCTFail("a stale body must remain a draft")
    } catch CouncilStore.StoreError.editChanged {}

    local = start.data
    local["title"] = .string("local title")
    try await store.put(type: "document", data: local, id: start.id, editBase: start)
    let ops = try await store.operations()
    let patch = try command(XCTUnwrap(ops.first))
    XCTAssertEqual(patch.action, "patch")
    XCTAssertEqual(patch.baseVersion, 2)
    XCTAssertEqual(patch.data, ["title": .string("local title")])
    let row = try await store.record(type: "document", id: start.id)
    XCTAssertEqual(row?.title, "local title")
    XCTAssertEqual(row?.text("body"), "remote body")
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

  func testUnknownRecordLeavesTheEntirePageAndCursorUntouched() async throws {
    let store = try CouncilStore(path: ":memory:")
    try await store.apply([confirmed("a", "old")], cursor: "1")
    let unknown = Record(id: "unknown", type: "futureType", version: 1, data: [:],
      deleted: false, updatedAt: "2026-11-18T00:00:00Z")
    do {
      try await store.apply([confirmed("a", "new", version: 2), unknown], cursor: "3")
      XCTFail("An older app cannot acknowledge a record it does not understand")
    } catch CouncilStore.StoreError.unknownType {}
    let visible = try await store.record(type: "idea", id: "a")
    let cursor = try await store.metadata("cursor")
    XCTAssertEqual(visible?.text("body"), "old")
    XCTAssertEqual(cursor, "1")
  }

  func testFirstSnapshotPreservesOfflineNewRecordsInTheOutbox() async throws {
    let store = try CouncilStore(path: ":memory:")
    try await store.put(type: "idea", data: idea("new offline"), id: "a")
    let opsBefore = try await store.operations()
    let scope = SyncScope(datasetId: "dataset", generation: "initial")
    let snapshot = try JSONDecoder().decode(SyncSnapshot.self, from: Data("""
      {"datasetId":"dataset","generation":"initial","snapshotId":"page",
      "watermark":"400","total":1,"expiresAt":"2026-11-18T00:00:00Z"}
      """.utf8))
    try await store.beginSnapshot()
    try await store.stageSnapshot([confirmed("b", "already on server")])
    try await store.finishSnapshot(snapshot, scope: scope, reviewPending: false)
    let visible = try await store.records(type: "idea")
    let opsAfter = try await store.operations()
    XCTAssertEqual(Set(visible.map { $0.text("body") }), ["new offline", "already on server"])
    XCTAssertEqual(opsBefore, opsAfter)
  }

  func testSnapshotReplacementIsAtomicAndKeepsLocalDraftsForReview() async throws {
    let store = try CouncilStore(path: ":memory:")
    try await store.apply([confirmed("a", "old", version: 6), confirmed("b", "removed")], cursor: "6")
    try await store.put(type: "idea", data: idea("local"), id: "a")
    let original = try await store.operations().first!
    let claimed = try await store.mark(original, state: "sending")
    XCTAssertTrue(claimed)
    let scope = SyncScope(datasetId: "dataset", generation: "restored")
    let snapshot = try JSONDecoder().decode(SyncSnapshot.self, from: Data("""
      {"datasetId":"dataset","generation":"restored","snapshotId":"page",
      "watermark":"2","total":2,"expiresAt":"2026-11-18T00:00:00Z"}
      """.utf8))
    try await store.beginSnapshot()
    try await store.stageSnapshot([confirmed("a", "restored")])
    do {
      try await store.finishSnapshot(snapshot, scope: scope)
      XCTFail("An incomplete snapshot must not replace local data")
    } catch SyncCoordinator.SyncError.invalidResponse {}
    let visibleBefore = try await store.records(type: "idea")
    let cursorBefore = try await store.metadata("cursor")
    XCTAssertEqual(Set(visibleBefore.map { $0.text("body") }), ["removed", "local"])
    XCTAssertEqual(cursorBefore, "6")

    try await store.stageSnapshot([confirmed("c", "added")])
    try await store.finishSnapshot(snapshot, scope: scope)
    let visibleAfter = try await store.records(type: "idea")
    let cursorAfter = try await store.metadata("cursor")
    XCTAssertEqual(Set(visibleAfter.map { $0.text("body") }), ["restored", "added"])
    XCTAssertEqual(cursorAfter, "2")
    let pending = try await store.operations()
    XCTAssertEqual(pending.map(\.state), ["error"])
    XCTAssertEqual(pending.first?.recoveryDraft?.text("body"), "local")

    try await store.apply([confirmed("a", "restored + pulled", version: 2)], cursor: "3")
    let pulled = try await store.record(type: "idea", id: "a")
    XCTAssertEqual(pulled?.text("body"), "restored + pulled")
    try await store.settle("a", keepLocal: true)
    let operation = try await store.operations().first!
    XCTAssertNotEqual(operation.id, original.id)
    XCTAssertNil(operation.recoveryDraft)
    XCTAssertEqual(operation.state, "queued")
    let rebased = try command(operation)
    XCTAssertEqual(rebased.baseVersion, 2)
    XCTAssertEqual(rebased.data?["body"], .string("local"))
  }

  func testSnapshotSettlesKnownReceiptsAndExactBusinessKeysButKeepsLaterEdits() async throws {
    let store = try CouncilStore(path: ":memory:")
    try await store.put(type: "idea", data: idea("received"), id: "a")
    let sent = try await store.operations().first!
    _ = try await store.mark(sent, state: "sending")
    try await store.put(type: "idea", data: idea("newer edit"), id: "a")
    try await store.put(type: "budget", data: ["month": .string("2026-11"), "amountMinor": .string("3200")],
      id: "local-budget")
    let operations = try await store.operations()
    let budget = operations.last!
    let scope = SyncScope(datasetId: "dataset", generation: "restored")
    let snapshot = SyncSnapshot(datasetId: scope.datasetId, generation: scope.generation, watermark: "2",
      snapshotId: "snapshot", total: 2, expiresAt: "")
    try await store.beginSnapshot()
    try await store.stageSnapshot([
      confirmed("a", "received"),
      Record(id: "restored-budget", type: "budget", version: 1,
        data: ["month": .string("2026-11"), "amountMinor": .string("3200")],
        deleted: false, updatedAt: "2026-11-22T00:00:00Z"),
    ])
    try await store.finishSnapshot(snapshot, scope: scope, matches: [
      sent.id: .init(operationId: sent.id, kind: "receipt", entityId: "a", version: nil),
      budget.id: .init(operationId: budget.id, kind: "businessKey", entityId: "restored-budget", version: 1),
    ])
    let pending = try await store.operations()
    XCTAssertEqual(pending.map(\.id), [operations[1].id])
    XCTAssertEqual(pending.first?.recoveryDraft?.text("body"), "newer edit")
    let visibleBudgets = try await store.records(type: "budget")
    XCTAssertEqual(visibleBudgets.map(\.id), ["restored-budget"])
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
