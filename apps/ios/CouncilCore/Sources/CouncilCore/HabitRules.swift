import Foundation

/// Habit calculations receive a business date explicitly and never consult the system clock.
public enum HabitRules {
  public static func log(habit: Record, day: String, records: [Record]) -> Record? {
    records.lazy.filter {
      !$0.deleted && $0.type == "habitLog" && $0.text("habitId") == habit.id
        && $0.text("day") == day
    }.min(by: newest)
  }

  public static func rule(habit: Record, day: String, records: [Record]) -> Record? {
    if let saved = log(habit: habit, day: day, records: records),
      let snapshot = records.first(where: {
        !$0.deleted && $0.type == "habitRule" && $0.id == saved.text("ruleId")
          && $0.text("habitId") == habit.id
      })
    { return snapshot }
    return records.lazy.filter {
      !$0.deleted && $0.type == "habitRule" && $0.text("habitId") == habit.id
        && !$0.text("effectiveFrom").isEmpty && $0.text("effectiveFrom") <= day
    }.min(by: newerRule)
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
    return complete(habit: habit, log: log, rule: rule(habit: habit, day: day, records: records))
  }

  private static func complete(habit: Record, log: Record, rule: Record?) -> Bool {
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
    return recordedValue(habit: habit, log: log, rule: rule(habit: habit, day: day, records: records))
  }

  private static func recordedValue(habit: Record, log: Record, rule: Record?) -> Double? {
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
    months(habits: [habit], month: month, records: records)[0]
  }

  /// Calculate a month for several habits with a single pass over their history.
  public static func months(habits: [Record], month: String, records: [Record]) -> [HabitMonthSummary] {
    guard !habits.isEmpty else { return [] }
    let days = days(in: month)
    let requested = Set(habits.map(\.id))
    let monthDays = Set(days)
    var logs: [String: [String: Record]] = [:]
    var rules: [String: [Record]] = [:]

    for entry in records where !entry.deleted {
      let habitId = entry.text("habitId")
      guard requested.contains(habitId) else { continue }
      if entry.type == "habitLog" {
        let day = entry.text("day")
        guard monthDays.contains(day) else { continue }
        if let current = logs[habitId]?[day], !newest(entry, current) { continue }
        logs[habitId, default: [:]][day] = entry
      } else if entry.type == "habitRule" {
        rules[habitId, default: []].append(entry)
      }
    }

    return habits.map { habit in
      summarizeMonth(habit: habit, days: days, logs: logs[habit.id] ?? [:], rules: rules[habit.id] ?? [])
    }
  }

  private static func summarizeMonth(
    habit: Record, days: [String], logs: [String: Record], rules: [Record]
  ) -> HabitMonthSummary {
    let savedRules = Dictionary(rules.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    let timeline = rules.filter { !$0.text("effectiveFrom").isEmpty }.sorted(by: newerRule)
    var next = timeline.count
    var activeRule: Record?
    var valueTotals: [String: Double] = [:]
    var quantityTotals: [String: Double] = [:]
    var quantityDays = 0
    var recorded = 0
    var completed = 0
    for day in days {
      guard let log = logs[day] else { continue }
      while next > 0, timeline[next - 1].text("effectiveFrom") <= day {
        next -= 1
        activeRule = timeline[next]
      }
      let snapshot = savedRules[log.text("ruleId")] ?? activeRule
      guard let value = recordedValue(habit: habit, log: log, rule: snapshot) else { continue }
      let kind = kind(habit: habit, rule: snapshot)
      let unit = unit(habit: habit, rule: snapshot)
      valueTotals[kind + ":" + (kind == "quantity" ? unit : ""), default: 0] += value
      if kind == "quantity" {
        quantityTotals[unit, default: 0] += value
        quantityDays += 1
      }
      recorded += 1
      if complete(habit: habit, log: log, rule: snapshot) { completed += 1 }
    }
    return HabitMonthSummary(
      total: valueTotals.count <= 1 ? valueTotals.values.first ?? 0 : 0,
      comparableValues: valueTotals.count <= 1, recordedDays: recorded, completedDays: completed,
      quantityTotals: quantityTotals, quantityDays: quantityDays)
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
  private static func newerRule(_ lhs: Record, _ rhs: Record) -> Bool {
    let left = lhs.text("effectiveFrom")
    let right = rhs.text("effectiveFrom")
    return left == right ? newest(lhs, rhs) : left > right
  }
  private static func newest(_ lhs: Record, _ rhs: Record) -> Bool {
    if lhs.updatedAt != rhs.updatedAt { return lhs.updatedAt > rhs.updatedAt }
    if lhs.version != rhs.version { return lhs.version > rhs.version }
    return lhs.id < rhs.id
  }
}

public struct HabitMonthSummary: Sendable, Equatable {
  public let total: Double
  public let comparableValues: Bool
  public let recordedDays: Int
  public let completedDays: Int
  public let quantityTotals: [String: Double]
  public let quantityDays: Int
  public var recordedAverage: Double? {
    recordedDays == 0 || !comparableValues ? nil : total / Double(recordedDays)
  }
}
