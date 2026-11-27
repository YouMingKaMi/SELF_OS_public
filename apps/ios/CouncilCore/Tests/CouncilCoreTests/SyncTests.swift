import XCTest

@testable import CouncilCore

final class SyncTests: XCTestCase {
  func testRealServiceCommitsOrRejectsBothHabitRecords() async throws {
    let env = ProcessInfo.processInfo.environment
    guard let base = env["COUNCIL_TEST_URL"], let token = env["COUNCIL_TEST_TOKEN"],
      let url = URL(string: base)
    else { throw XCTSkip("Requires isolated test API") }
    let phone = try CouncilStore(path: ":memory:")
    let peer = try CouncilStore(path: ":memory:")
    let a = SyncCoordinator(store: phone)
    let b = SyncCoordinator(store: peer)
    let id = UUID().uuidString.lowercased()
    let rule = UUID().uuidString.lowercased()
    let definition = BatchPut(type: "habit", id: id, data: [
      "name": .string("原子习惯"), "kind": .string("quantity"), "status": .string("active"),
    ], version: 0)
    func writeRule(_ target: Double) -> BatchPut {
      BatchPut(type: "habitRule", id: rule, data: [
        "habitId": .string(id), "effectiveFrom": .string("2026-11-18"), "kind": .string("quantity"),
        "target": .number(target),
      ], version: 0)
    }
    try await phone.putTogether([definition, writeRule(0)])
    try await a.synchronize(baseURL: url, token: token)
    try await b.synchronize(baseURL: url, token: token)
    let refused = try await phone.operations()
    let absent = try await peer.record(type: "habit", id: id)
    XCTAssertEqual(refused.map(\.state), ["error", "error"])
    XCTAssertNil(absent)
    try await phone.settle(id, keepLocal: false)

    try await phone.putTogether([definition, writeRule(10)])
    try await a.synchronize(baseURL: url, token: token)
    try await b.synchronize(baseURL: url, token: token)
    let queue = try await phone.operations()
    let accepted = try await peer.record(type: "habit", id: id)
    let acceptedRule = try await peer.record(type: "habitRule", id: rule)
    XCTAssertTrue(queue.isEmpty)
    XCTAssertEqual(accepted?.title, "原子习惯")
    XCTAssertEqual(acceptedRule?.text("habitId"), id)
    XCTAssertEqual(acceptedRule?.number("target"), 10)

    let confirmedRule = try XCTUnwrap(acceptedRule)
    let confirmedHabit = try XCTUnwrap(accepted)
    try await peer.removeTogether([confirmedRule, confirmedHabit])
    try await b.synchronize(baseURL: url, token: token)
    try await a.synchronize(baseURL: url, token: token)
    let removedHabit = try await phone.record(type: "habit", id: id)
    let removedRule = try await phone.record(type: "habitRule", id: rule)
    XCTAssertEqual(removedHabit?.deleted, true)
    XCTAssertEqual(removedRule?.deleted, true)
  }

  /// Two real local databases against the real API and PostgreSQL. Run: node scripts/verify-native-sync.mjs
  func testRealServiceTwoClientsConflictAndTasks() async throws {
    guard let base = ProcessInfo.processInfo.environment["COUNCIL_TEST_URL"],
      let token = ProcessInfo.processInfo.environment["COUNCIL_TEST_TOKEN"],
      let url = URL(string: base)
    else { throw XCTSkip("Requires isolated test API; run node scripts/verify-native-sync.mjs") }
    let phone = try CouncilStore(path: ":memory:")
    let computer = try CouncilStore(path: ":memory:")
    let a = SyncCoordinator(store: phone)
    let b = SyncCoordinator(store: computer)
    func sync(_ order: [SyncCoordinator]) async throws {
      for coordinator in order { try await coordinator.synchronize(baseURL: url, token: token) }
    }
    func idea(_ body: String) -> [String: JSONValue] {
      ["body": .string(body), "day": .string("2026-11-07"), "status": .string("pending")]
    }
    let id = UUID().uuidString.lowercased()
    try await phone.put(type: "idea", data: idea("phone offline"), id: id)
    try await sync([a, b])
    let received = try await computer.record(type: "idea", id: id)
    XCTAssertEqual(received?.text("body"), "phone offline")

    try await phone.put(type: "idea", data: idea("phone changed"), id: id)
    try await computer.put(type: "idea", data: idea("computer changed"), id: id)
    try await sync([a, b])
    let conflict = try await computer.operations()
    XCTAssertEqual(conflict.first?.state, "conflict")
    let untouched = try await computer.record(type: "idea", id: id)
    XCTAssertEqual(untouched?.text("body"), "computer changed", "the local edit stays visible")
    try await computer.settle(id, keepLocal: true)
    try await sync([b, a])
    let resolved = try await phone.record(type: "idea", id: id)
    XCTAssertEqual(resolved?.text("body"), "computer changed")

    // Tasks travel on the same stream as everything else.
    let task = UUID().uuidString.lowercased()
    try await phone.put(
      type: "task",
      data: TaskRules.apply(
        "create", to: nil, title: "native task", schedule: Schedule(kind: "recent"),
        now: "2026-11-07T00:00:00Z"), id: task)
    try await sync([a, b])
    let row = try await computer.record(type: "task", id: task)
    XCTAssertEqual(row?.title, "native task")
    let list = try await phone.put(type: "taskList", data: ["name": .string("课程清单")])
    let followup = try await phone.put(type: "task", data: [
      "title": .string("写提纲"),
      "status": .string("pending"),
      "scheduleKind": .string("recent"),
      "note": .string("从第一章开始"),
      "listId": .string(list),
      "prerequisiteIds": .array([.string(task)]),
    ])
    let queuedFollowup = try await phone.record(type: "task", id: followup)
    XCTAssertEqual(queuedFollowup.map(TaskRules.prerequisites), [task])
    try await sync([a, b])
    try await computer.put(
      type: "task", data: TaskRules.apply("complete", to: row, now: "2026-11-08T03:00:00Z"), id: task)
    try await sync([b, a])
    let completed = try await phone.record(type: "task", id: task)
    XCTAssertEqual(completed?.text("status"), "completed")
    XCTAssertEqual(completed?.text("completedAt"), "2026-11-08T03:00:00.000Z")

    let otherList = try await computer.record(type: "taskList", id: list)
    let otherFollowup = try await computer.record(type: "task", id: followup)
    let otherPrerequisite = try await computer.record(type: "task", id: task)
    XCTAssertEqual(otherList?.title, "课程清单")
    XCTAssertEqual(otherFollowup?.text("note"), "从第一章开始")
    XCTAssertEqual(otherFollowup?.text("listId"), list)
    if let otherFollowup, let otherPrerequisite {
      XCTAssertTrue(TaskRules.isNext(otherFollowup, byID: [task: otherPrerequisite], day: "2026-11-08"))
    } else { XCTFail("Planning records did not sync") }

    // A write the server refuses is kept and reported, not dropped or retried forever.
    try await phone.put(type: "idea", data: ["body": .string(""), "day": .string("2026-11-07"), "status": .string("pending")], id: UUID().uuidString.lowercased())
    try await sync([a])
    let rejected = try await phone.operations()
    XCTAssertEqual(rejected.map(\.state), ["error"])
    XCTAssertEqual(rejected.first?.error, "REQUIRED:body")
  }
}
