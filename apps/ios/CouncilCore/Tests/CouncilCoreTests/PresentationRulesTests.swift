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
    XCTAssertTrue(TaskRules.belongsToday(range, day: "2026-11-02"))
    XCTAssertFalse(TaskRules.belongsToday(range, day: "2026-11-04"))
    let complete = task(
      Schedule(kind: "day", date: "2026-10-20"), status: "completed",
      completed: "2026-11-01T16:01:00.000Z")
    XCTAssertEqual(TaskRules.completionDay(complete), "2026-11-02")
    XCTAssertTrue(TaskRules.inPeriod(complete, start: "2026-11-01", end: "2026-11-30"))
    XCTAssertFalse(TaskRules.inPeriod(complete, start: "2026-10-01", end: "2026-10-31"))
  }
  func testUnknownDateNotTodayAndOverdueDeadlineIsToday() {
    XCTAssertFalse(
      TaskRules.belongsToday(task(Schedule(kind: "recent")), day: "2026-11-08"))
    XCTAssertTrue(
      TaskRules.belongsToday(
        task(Schedule(kind: "deadline", date: "2026-11-06")),
        day: "2026-11-08"))
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
