import XCTest
@testable import CouncilCore

final class HabitRulesTests: XCTestCase {
  private func record(_ type: String, _ id: String, _ data: [String: JSONValue], updated: String = "", deleted: Bool = false) -> Record {
    Record(id: id, type: type, version: 1, data: data, deleted: deleted, updatedAt: updated)
  }
  private var habit: Record {
    record("habit", "water", ["name": .string("喝水"), "kind": .string("quantity"), "showHome": .bool(true), "status": .string("active")])
  }
  private func rule(_ id: String = "r1", from: String = "2026-11-01", target: Double = 2, extra: [String: JSONValue] = [:]) -> Record {
    record("habitRule", id, ["habitId": .string("water"), "effectiveFrom": .string(from), "target": .number(target), "kind": .string("quantity")].merging(extra) { _, b in b })
  }
  private func log(_ day: String = "2026-11-08", value: Double, extra: [String: JSONValue] = [:], id: String = "log", updated: String = "") -> Record {
    record("habitLog", id, ["habitId": .string("water"), "day": .string(day), "value": .number(value)].merging(extra) { _, b in b }, updated: updated)
  }

  func testHistoricalLogKeepsItsSavedRuleEvenAfterNewPlan() {
    let old = rule(target: 2)
    let changed = rule("r2", from: "2026-11-05", target: 8)
    let records = [old, changed, log(value: 3, extra: ["ruleId": .string("r1")])]
    XCTAssertEqual(HabitRules.rule(habit: habit, day: "2026-11-08", records: records)?.id, "r1")
    XCTAssertTrue(HabitRules.isComplete(habit: habit, day: "2026-11-08", records: records))
    XCTAssertEqual(HabitRules.rule(habit: habit, day: "2026-11-09", records: records)?.id, "r2")
    XCTAssertNil(HabitRules.rule(habit: habit, day: "2026-10-31", records: records))
  }

  func testMissingAndExplicitZeroRemainDifferentAndDuplicateDaysAreNotDoubleCounted() {
    let records = [rule(), log(value: 99, id: "older", updated: "2026-11-08T01:00:00Z"),
      log(value: 0, updated: "2026-11-08T02:00:00Z"), log("2026-11-10", value: 4, id: "later")]
    let summary = HabitRules.month(habit: habit, month: "2026-11", records: records)
    XCTAssertEqual(summary.recordedDays, 2)
    XCTAssertEqual(summary.total, 4)
    XCTAssertEqual(summary.recordedAverage, 2)
    XCTAssertEqual(summary.completedDays, 1)
    XCTAssertNil(HabitRules.log(habit: habit, day: "2026-11-09", records: records))
    XCTAssertEqual(HabitRules.log(habit: habit, day: "2026-11-08", records: records)?.number("value"), 0)
    XCTAssertNil(HabitRules.month(habit: habit, month: "2026-10", records: records).recordedAverage)
    let missingValue = record("habitLog", "partial", ["habitId": .string("water"), "day": .string("2026-11-01")])
    XCTAssertNil(HabitRules.value(habit: habit, day: "2026-11-01", records: [missingValue]))
    XCTAssertEqual(HabitRules.month(habit: habit, month: "2026-11", records: [missingValue]).recordedDays, 0)
  }

  func testHomeWeekdayAndQuantityManualCollapse() {
    let scheduled = rule(extra: ["weekdays": .array([.string("0")])])
    XCTAssertTrue(HabitRules.shouldShowOnHome(habit: habit, day: "2026-11-08", records: [scheduled]))
    XCTAssertFalse(HabitRules.shouldShowOnHome(habit: habit, day: "2026-11-09", records: [scheduled]))
    XCTAssertTrue(HabitRules.shouldShowOnHome(habit: habit, day: "2026-11-08", records: [scheduled, log(value: 12)]))
    XCTAssertFalse(HabitRules.shouldShowOnHome(habit: habit, day: "2026-11-08", records: [scheduled, log(value: 12, extra: ["hidden": .bool(true)])]))
    for status in ["paused", "optional", "archived"] {
      var value = habit
      value.data["status"] = .string(status)
      XCTAssertFalse(HabitRules.shouldShowOnHome(habit: value, day: "2026-11-08", records: [scheduled]))
    }
    XCTAssertFalse(HabitRules.isScheduled(habit: habit, day: "2026-11-08", records: [rule(extra: ["weekdays": .array([])])]))
  }

  func testBinaryAutoHidesAndChecklistRequiresActualSnapshotItems() {
    let binary = rule(extra: ["kind": .string("binary")])
    XCTAssertFalse(HabitRules.shouldShowOnHome(habit: habit, day: "2026-11-08", records: [binary, log(value: 1)]))
    XCTAssertTrue(HabitRules.shouldShowOnHome(habit: habit, day: "2026-11-08", records: [binary, log(value: 0)]))
    let checklist = rule(extra: ["kind": .string("checklist"), "items": .array([.string("A"), .string("B")])])
    let recorded = log(value: 99, extra: ["items": .array([.string("A"), .string("obsolete")])])
    XCTAssertFalse(HabitRules.isComplete(habit: habit, day: "2026-11-08", records: [checklist, recorded]))
    XCTAssertEqual(HabitRules.month(habit: habit, month: "2026-11", records: [checklist, recorded]).total, 1)
    XCTAssertTrue(HabitRules.isComplete(habit: habit, day: "2026-11-08", records: [checklist, log(value: 0, extra: ["items": .array([.string("A"), .string("B")])])]))
    XCTAssertFalse(HabitRules.isComplete(habit: habit, day: "2026-11-08", records: [rule(extra: ["kind": .string("checklist"), "items": .array([])]), recorded]))
  }

  func testCalendarBoundariesDeletedAndForeignRules() {
    XCTAssertEqual(HabitRules.days(in: "2024-02").count, 29)
    XCTAssertEqual(HabitRules.days(in: "2026-02").last, "2026-02-28")
    XCTAssertTrue(HabitRules.days(in: "2026-13").isEmpty)
    XCTAssertNil(HabitRules.date("2026-02-30"))
    var foreign = rule("other", target: 100)
    foreign.data["habitId"] = .string("someoneElse")
    let saved = log(value: 2, extra: ["ruleId": .string("other")])
    XCTAssertEqual(HabitRules.rule(habit: habit, day: "2026-11-08", records: [rule(), foreign, saved])?.id, "r1")
    var deleted = log(value: 10)
    deleted.deleted = true
    XCTAssertNil(HabitRules.log(habit: habit, day: "2026-11-08", records: [deleted]))
  }
}
