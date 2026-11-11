import Foundation

/// Habit calculations receive a business date explicitly and never consult the system clock.
public enum HabitRules {
  public static func log(habit: Record, day: String, records: [Record]) -> Record? {
    records.filter {
      !$0.deleted && $0.type == "habitLog" && $0.text("habitId") == habit.id
        && $0.text("day") == day
    }.sorted(by: newest).first
  }

  public static func rule(habit: Record, day: String, records: [Record]) -> Record? {
    if let saved = log(habit: habit, day: day, records: records),
      let snapshot = records.first(where: {
        !$0.deleted && $0.type == "habitRule" && $0.id == saved.text("ruleId")
          && $0.text("habitId") == habit.id
      })
    { return snapshot }
    return records.filter {
      !$0.deleted && $0.type == "habitRule" && $0.text("habitId") == habit.id
        && !$0.text("effectiveFrom").isEmpty && $0.text("effectiveFrom") <= day
    }.sorted {
      if $0.text("effectiveFrom") != $1.text("effectiveFrom") {
        return $0.text("effectiveFrom") > $1.text("effectiveFrom")
      }
      return newest($0, $1)
    }.first
  }

  public static func kind(habit: Record, rule: Record?) -> String {
    rule?.text("kind", habit.text("kind", "binary")) ?? habit.text("kind", "binary")
  }
  public static func unit(habit: Record, rule: Record?) -> String {
    rule?.text("unit", habit.text("unit")) ?? habit.text("unit")
  }
  public static func items(habit: Record, rule: Record?) -> [String] {
    rule?.data["items"]?.strings ?? habit.data["items"]?.strings ?? []
  }
  public static func target(rule: Record?) -> Double {
    guard let target = rule?.data["target"]?.double, target.isFinite, target > 0 else { return 1 }
    return target
  }
  public static func isComplete(habit: Record, day: String, records: [Record]) -> Bool {
    guard let log = log(habit: habit, day: day, records: records) else { return false }
    let rule = rule(habit: habit, day: day, records: records)
    switch kind(habit: habit, rule: rule) {
    case "binary": return log.number("value") > 0
    case "checklist":
      let expected = items(habit: habit, rule: rule)
      let checked = Set(log.data["items"]?.strings ?? [])
      return !expected.isEmpty && expected.allSatisfy(checked.contains)
    default: return log.number("value") >= target(rule: rule)
    }
  }

  public static func isScheduled(habit: Record, day: String, records: [Record]) -> Bool {
    guard let date = date(day) else { return false }
    let rule = rule(habit: habit, day: day, records: records)
    // An absent schedule is legacy daily; an explicit empty schedule means no planned days.
    guard let weekdays = rule?.data["weekdays"]?.strings else { return true }
    return weekdays.contains(String(calendar.component(.weekday, from: date) - 1))
  }
  public static func value(habit: Record, day: String, records: [Record]) -> Double? {
    guard let log = log(habit: habit, day: day, records: records) else { return nil }
    let rule = rule(habit: habit, day: day, records: records)
    if kind(habit: habit, rule: rule) == "checklist" {
      return Double(Set(log.data["items"]?.strings ?? []).intersection(items(habit: habit, rule: rule)).count)
    }
    guard case .number(let value) = log.data["value"], value.isFinite else { return nil }
    return value
  }
  public static func shouldShowOnHome(habit: Record, day: String, records: [Record]) -> Bool {
    guard !habit.deleted, habit.text("status") == "active", habit.flag("showHome"),
      isScheduled(habit: habit, day: day, records: records),
      log(habit: habit, day: day, records: records)?.flag("hidden") != true
    else { return false }
    let rule = rule(habit: habit, day: day, records: records)
    return kind(habit: habit, rule: rule) != "binary"
      || !isComplete(habit: habit, day: day, records: records)
  }

  public static func month(habit: Record, month: String, records: [Record]) -> HabitMonthSummary {
    let days = days(in: month)
    let logs = days.compactMap { day -> Record? in
      guard value(habit: habit, day: day, records: records) != nil else { return nil }
      return log(habit: habit, day: day, records: records)
    }
    let total = logs.reduce(0.0) { $0 + (value(habit: habit, day: $1.text("day"), records: records) ?? 0) }
    return HabitMonthSummary(
      total: total, recordedDays: logs.count,
      completedDays: logs.filter { isComplete(habit: habit, day: $0.text("day"), records: records) }.count)
  }

  public static func days(in month: String) -> [String] {
    guard month.count == 7, let start = date(month + "-01"),
      let count = calendar.range(of: .day, in: .month, for: start)?.count else { return [] }
    return (1...count).map { month + String(format: "-%02d", $0) }
  }
  public static func date(_ day: String) -> Date? {
    guard day.count == 10 else { return nil }
    let f = formatter
    guard let date = f.date(from: day), f.string(from: date) == day else { return nil }
    return date
  }
  private static var calendar: Calendar {
    var value = Calendar(identifier: .gregorian)
    value.timeZone = TimeZone(secondsFromGMT: 0)!
    return value
  }
  private static var formatter: DateFormatter {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.calendar = calendar
    f.timeZone = calendar.timeZone
    f.dateFormat = "yyyy-MM-dd"
    f.isLenient = false
    return f
  }
  private static func newest(_ lhs: Record, _ rhs: Record) -> Bool {
    if lhs.updatedAt != rhs.updatedAt { return lhs.updatedAt > rhs.updatedAt }
    if lhs.version != rhs.version { return lhs.version > rhs.version }
    return lhs.id < rhs.id
  }
}

public struct HabitMonthSummary: Sendable, Equatable {
  public let total: Double
  public let recordedDays: Int
  public let completedDays: Int
  public var recordedAverage: Double? { recordedDays == 0 ? nil : total / Double(recordedDays) }
}
