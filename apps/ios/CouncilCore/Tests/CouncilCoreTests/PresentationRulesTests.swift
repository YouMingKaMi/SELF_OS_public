import XCTest

@testable import CouncilCore

final class PresentationRulesTests: XCTestCase {
  func task(_ schedule: Schedule, status: String = "pending", completed: String = "") -> Record {
    var data: [String: JSONValue] = [
      "title": .string("Task"), "status": .string(status), "completedAt": .string(completed),
    ]
    data.merge(TaskRules.fields(schedule)) { _, new in new }
    return Record(id: "task", type: "task", version: 1, data: data, deleted: false, updatedAt: "")
  }
  func testTaskRangeOverlapsMonthAndCompletionUsesActualBusinessDay() {
    let range = task(Schedule(kind: "range", start: "2026-10-30", end: "2026-11-03"))
    XCTAssertTrue(TaskRules.inPeriod(range, start: "2026-11-01", end: "2026-11-30"))
    let complete = task(
      Schedule(kind: "day", date: "2026-10-20"), status: "completed",
      completed: "2026-11-01T16:01:00.000Z")
    XCTAssertEqual(TaskRules.completionDay(complete), "2026-11-02")
    XCTAssertTrue(TaskRules.inPeriod(complete, start: "2026-11-01", end: "2026-11-30"))
    XCTAssertFalse(TaskRules.inPeriod(complete, start: "2026-10-01", end: "2026-10-31"))
  }
  func testDeadlineCalendarPeriodMatchesOnlyTheDueDate() {
    let deadline = task(Schedule(kind: "deadline", date: "2026-11-09"))
    XCTAssertFalse(TaskRules.inPeriod(deadline, start: "2026-11-08", end: "2026-11-08"))
    XCTAssertTrue(TaskRules.inPeriod(deadline, start: "2026-11-09", end: "2026-11-09"))
  }
  func testTodayIncludesOnlyTheMatchingScheduledDay() {
    let record = task(Schedule(kind: "day", date: "2026-11-08"))
    XCTAssertFalse(TaskRules.belongsToday(record, day: "2026-11-07"))
    XCTAssertTrue(TaskRules.belongsToday(record, day: "2026-11-08"))
    XCTAssertFalse(TaskRules.belongsToday(record, day: "2026-11-09"))
  }
  func testTodayIncludesBothBoundariesAndTheInteriorOfAValidRange() {
    let record = task(Schedule(kind: "range", start: "2026-11-07", end: "2026-11-09"))
    XCTAssertFalse(TaskRules.belongsToday(record, day: "2026-11-06"))
    XCTAssertTrue(TaskRules.belongsToday(record, day: "2026-11-07"))
    XCTAssertTrue(TaskRules.belongsToday(record, day: "2026-11-08"))
    XCTAssertTrue(TaskRules.belongsToday(record, day: "2026-11-09"))
    XCTAssertFalse(TaskRules.belongsToday(record, day: "2026-11-10"))
    let singleDay = task(Schedule(kind: "range", start: "2026-11-08", end: "2026-11-08"))
    XCTAssertTrue(TaskRules.belongsToday(singleDay, day: "2026-11-08"))
  }
  func testTodayExcludesRangesWithInvalidOrReversedEndpoints() {
    let ranges = [
      (start: "", end: "2026-11-09"),
      (start: "2026-1-01", end: "2026-11-09"),
      (start: "2026-11-07", end: "2026-11-31"),
      (start: "2026-11-09", end: "2026-11-07"),
    ]
    for (start, end) in ranges {
      let record = task(Schedule(kind: "range", start: start, end: end))
      XCTAssertFalse(TaskRules.belongsToday(record, day: "2026-11-08"), "\(start) to \(end)")
    }
  }
  func testTodayIncludesDeadlinesWithValidDatesRegardlessOfWhenTheyFall() {
    for date in [
      "2026-11-09", "2026-11-08", "2026-11-07", "2028-02-29", "1900-01-01", "9999-12-31",
    ] {
      let record = task(Schedule(kind: "deadline", date: date))
      XCTAssertTrue(TaskRules.belongsToday(record, day: "2026-11-08"), date)
    }
  }
  func testTodayExcludesDeadlinesWithInvalidDates() {
    for date in ["", "2026-2-01", "2026-02-29", "1899-12-31", "10000-01-01"] {
      let record = task(Schedule(kind: "deadline", date: date))
      XCTAssertFalse(TaskRules.belongsToday(record, day: "2026-11-08"), date)
    }
  }
  func testTodayIncludesRecentAndExcludesUnscheduled() {
    XCTAssertTrue(TaskRules.belongsToday(task(Schedule(kind: "recent")), day: "2026-11-08"))
    XCTAssertFalse(TaskRules.belongsToday(task(Schedule(kind: "unscheduled")), day: "2026-11-08"))
  }
  func testOnlyPendingTasksBelongToToday() {
    for status in ["completed", "discarded", "unknown"] {
      let record = task(Schedule(kind: "recent"), status: status)
      XCTAssertFalse(TaskRules.belongsToday(record, day: "2026-11-08"), status)
    }
  }
  func testCalendarDaysRejectOverflowAndIncludeLeapDay() {
    XCTAssertNil(CalendarDays.date("2026-02-30"))
    XCTAssertEqual(CalendarDays.monthDays("2024-02").count, 29)
  }
  func testMetricZeroDoesNotBecomeMissingAndMarkdownKeepsCode() {
    let zero = Record(
      id: "zero", type: "metricLog", version: 1, data: ["value": .number(0)], deleted: false,
      updatedAt: "")
    let empty = Record(
      id: "empty", type: "metricLog", version: 1, data: [:], deleted: false, updatedAt: "")
    let summary = MetricRules.summary([zero, empty])
    XCTAssertEqual(summary.count, 1)
    XCTAssertEqual(summary.average, 0)
    let blocks = MarkdownBlocks.parse("# 标题\n\n- 一件事\n\n```swift\nlet a = 1\n```\n\n> 一段引用")
    XCTAssertEqual(
      blocks,
      [
        MarkdownBlock(kind: .heading(1), text: "标题"),
        MarkdownBlock(kind: .bullet("•"), text: "一件事"),
        MarkdownBlock(kind: .code("swift"), text: "let a = 1"),
        MarkdownBlock(kind: .quote, text: "一段引用"),
      ])
  }
}
