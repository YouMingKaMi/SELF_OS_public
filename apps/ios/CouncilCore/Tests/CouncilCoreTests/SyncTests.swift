import XCTest

@testable import CouncilCore

final class SyncTests: XCTestCase {
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
    try await computer.put(
      type: "task", data: TaskRules.apply("complete", to: row, now: "2026-11-08T03:00:00Z"), id: task)
    try await sync([b, a])
    let completed = try await phone.record(type: "task", id: task)
    XCTAssertEqual(completed?.text("status"), "completed")
    XCTAssertEqual(completed?.text("completedAt"), "2026-11-08T03:00:00.000Z")

    // A write the server refuses is kept and reported, not dropped or retried forever.
    try await phone.put(type: "idea", data: ["body": .string(""), "day": .string("2026-11-07"), "status": .string("pending")], id: UUID().uuidString.lowercased())
    try await sync([a])
    let rejected = try await phone.operations()
    XCTAssertEqual(rejected.map(\.state), ["error"])
    XCTAssertEqual(rejected.first?.error, "REQUIRED:body")
  }
}
