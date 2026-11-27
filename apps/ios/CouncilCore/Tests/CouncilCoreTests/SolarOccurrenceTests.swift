import Foundation
import XCTest
@testable import CouncilCore

final class SolarOccurrenceTests: XCTestCase {
  func testDecadesAndOriginalMonthDayAnchor() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    let examples: [(String, String, String, Int, String)] = [
      ("1950-01-01", "2026-11-18", "day", 1, "2026-11-18"),
      ("2024-01-31", "2024-02-01", "month", 1, "2024-02-29"),
      ("2024-01-31", "2024-03-01", "month", 1, "2024-03-31"),
      ("2024-02-29", "2025-01-01", "year", 1, "2025-02-28"),
      ("2024-02-29", "2028-01-01", "year", 1, "2028-02-29"),
      ("2024-01-07", "2024-01-08", "week", 2, "2024-01-21"),
    ]
    for (base, from, unit, interval, expected) in examples {
      let first = try XCTUnwrap(formatter.date(from: base))
      let after = try XCTUnwrap(formatter.date(from: from))
      let result = SolarOccurrence.next(from: first, onOrAfter: after, unit: unit, interval: interval, calendar: calendar)
      XCTAssertEqual(result.map(formatter.string), expected)
    }
  }
}
