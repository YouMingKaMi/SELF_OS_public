import Foundation

public enum CalendarDays {
  public static var calendar: Calendar {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "Asia/Shanghai")!
    return c
  }
  public static func date(_ day: String) -> Date? {
    let parts = day.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3,
      let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    else { return nil }
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    return c.year == parts[0] && c.month == parts[1] && c.day == parts[2] ? date : nil
  }
  public static func string(_ date: Date) -> String {
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
  }
  public static func monthDays(_ month: String) -> [String] {
    guard let first = date(month + "-01"),
      let range = calendar.range(of: .day, in: .month, for: first)
    else { return [] }
    return range.map { month + String(format: "-%02d", $0) }
  }
}
public enum TaskRules {
  public static func schedule(_ record: Record) -> Schedule {
    let kind = record.text("scheduleKind", "unscheduled")
    switch kind {
    case "day", "deadline": return Schedule(kind: kind, date: record.data["scheduleDate"]?.stringValue)
    case "range":
      return Schedule(
        kind: kind, start: record.data["scheduleStart"]?.stringValue,
        end: record.data["scheduleEnd"]?.stringValue)
    default: return Schedule(kind: kind)
    }
  }
  /// The entity fields for a plan: only the ones that belong to its kind.
  public static func fields(_ schedule: Schedule) -> [String: JSONValue] {
    var data: [String: JSONValue] = ["scheduleKind": .string(schedule.kind)]
    if ["day", "deadline"].contains(schedule.kind), let date = schedule.date {
      data["scheduleDate"] = .string(date)
    }
    if schedule.kind == "range", let start = schedule.start, let end = schedule.end {
      data["scheduleStart"] = .string(start)
      data["scheduleEnd"] = .string(end)
    }
    return data
  }
  /// Apply one user intent to a task as this device sees it and return the payload to save.
  public static func apply(
    _ action: String, to current: Record?, title: String? = nil, schedule: Schedule? = nil,
    now: String
  ) -> [String: JSONValue] {
    var data = current?.data ?? ["status": .string("pending"), "createdAt": .string(now)]
    if let title { data["title"] = .string(title.trimmingCharacters(in: .whitespacesAndNewlines)) }
    if let schedule = schedule ?? (current == nil ? Schedule(kind: "unscheduled") : nil) {
      for key in ["scheduleKind", "scheduleDate", "scheduleStart", "scheduleEnd"] { data[key] = nil }
      data.merge(fields(schedule)) { _, new in new }
    }
    switch action {
    case "complete":
      if data["status"] != .string("completed") { data["completedAt"] = .string(now) }
      data["status"] = .string("completed")
    case "discard": data["status"] = .string("discarded")
    case "reopen": data["status"] = .string("pending")
    default: break
    }
    return data
  }
  public static func label(_ s: Schedule) -> String {
    switch s.kind {
    case "recent": return "近期完成"
    case "day": return s.date ?? "未定日期"
    case "deadline": return "截止 " + (s.date ?? "")
    case "range": return (s.start ?? "") + " — " + (s.end ?? "")
    default: return "未定日期"
    }
  }
  public static func completionDay(_ record: Record) -> String? {
    let text = record.text("completedAt")
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = f.date(from: text) ?? ISO8601DateFormatter().date(from: text) else {
      return nil
    }
    return CalendarDays.string(date)
  }
  public static func inPeriod(_ record: Record, start: String, end: String) -> Bool {
    if record.text("status") == "completed", let day = completionDay(record) {
      return day >= start && day <= end
    }
    let s = schedule(record)
    switch s.kind {
    case "day", "deadline": return (s.date ?? "") >= start && (s.date ?? "") <= end
    case "range": return (s.start ?? "") <= end && (s.end ?? "") >= start
    default: return true
    }
  }
  public static func belongsToday(_ record: Record, day: String) -> Bool {
    guard record.text("status") == "pending" else { return false }
    let s = schedule(record)
    if s.kind == "range" { return (s.start ?? "") <= day && (s.end ?? "") >= day }
    if s.kind == "deadline" { return (s.date ?? "") <= day }
    return s.kind == "day" && s.date == day
  }
}
public struct MetricSummary: Sendable {
  public let count: Int
  public let sum: Double
  public let average: Double?
  public let minimum: Double?
  public let maximum: Double?
}
public enum MetricRules {
  public static func summary(_ logs: [Record]) -> MetricSummary {
    let values = logs.compactMap { row -> Double? in
      guard case .number(let value) = row.data["value"], value.isFinite else { return nil }
      return value
    }
    let sum = values.reduce(0, +)
    return MetricSummary(
      count: values.count, sum: sum, average: values.isEmpty ? nil : sum / Double(values.count),
      minimum: values.min(), maximum: values.max())
  }
}
