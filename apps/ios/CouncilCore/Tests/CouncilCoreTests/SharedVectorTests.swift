import XCTest

@testable import CouncilCore

/// The same language-neutral vectors the TypeScript rules run (fixtures/*.json at the repository root).
/// A rule change that is made on one side only fails here.
final class SharedVectorTests: XCTestCase {
  private func vectors(_ name: String) throws -> [[String: Any]] {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let data = try Data(contentsOf: root.appendingPathComponent("fixtures/" + name))
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
  }
  private func record(_ type: String, _ fields: [String: Any], id: String = "x") throws -> Record {
    let data = try JSONDecoder().decode(
      [String: JSONValue].self, from: JSONSerialization.data(withJSONObject: fields))
    return Record(id: id, type: type, version: 1, data: data, deleted: false, updatedAt: "")
  }

  func testLedgerVectors() throws {
    for vector in try vectors("ledger-vectors.json") {
      let name = vector["name"] as! String
      let asOf = vector["asOf"] as! String
      let expense = try record("expense", vector["expense"] as! [String: Any])
      XCTAssertEqual(FinanceRules.string(FinanceRules.net(expense)), vector["net"] as? String, name)
      for expected in vector["days"] as! [[String: String]] {
        for (basis, key) in [(FinanceRules.Basis.term, "term"), (.current, "current")] {
          XCTAssertEqual(
            FinanceRules.string(
              FinanceRules.contribution(expense, day: expected["day"]!, basis: basis, asOf: asOf)),
            expected[key], "\(name) · \(expected["day"]!) \(key)")
        }
      }
      let month = vector["month"] as! [String: String]
      for (basis, key) in [(FinanceRules.Basis.term, "term"), (.current, "current")] {
        XCTAssertEqual(
          FinanceRules.string(
            FinanceRules.total([expense], month: month["month"]!, basis: basis, asOf: asOf)),
          month[key], "\(name) · month \(key)")
      }
    }
  }

  func testTimeVectors() throws {
    let iso = ISO8601DateFormatter()
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    for vector in try vectors("time-vectors.json") {
      let name = vector["name"] as! String
      let text = vector["now"] as! String
      let now = try XCTUnwrap(fractional.date(from: text) ?? iso.date(from: text))
      let sessions = try (vector["sessions"] as! [[String: Any]]).enumerated().map {
        try record("session", $0.element, id: String($0.offset))
      }
      let summary = TimeMath.summarize(sessions, now: now)
      let daily = (vector["daily"] as! [String: NSNumber]).mapValues(\.doubleValue)
      XCTAssertEqual(summary.daily, daily, name)
      XCTAssertEqual(summary.overlapSeconds, (vector["overlapSeconds"] as! NSNumber).doubleValue, name)
      XCTAssertEqual(summary.manualSeconds, (vector["manualSeconds"] as! NSNumber).doubleValue, name)
    }
  }
}
