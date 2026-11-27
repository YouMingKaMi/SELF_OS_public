import Foundation

public struct TimeSummary: Sendable {
  public let daily: [String: Double]
  public let overlapSeconds: Double
  public let manualSeconds: Double
  public let unlocatedSeconds: Double
  public var totalSeconds: Double { daily.values.reduce(0, +) }
}
public enum TimeMath {
  struct Interval {
    var start: Date
    var end: Date
  }
  private static func sessionTime(_ session: Record, now: Date)
    -> (ranges: [Interval], total: Double, manual: Double, unlocated: Double)
  {
    if session.text("status") == "cancelled" { return ([], 0, 0, 0) }
    let elapsed = session.number("elapsedSeconds")
    let recorded = elapsed.isFinite ? max(0, elapsed) : 0
    if session.flag("manual") { return ([], recorded, recorded, 0) }

    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let whole = ISO8601DateFormatter()
    func parse(_ text: String) -> Date? { iso.date(from: text) ?? whole.date(from: text) }
    var ranges = (session.data["segments"]?.strings ?? []).compactMap { segment -> Interval? in
      let parts = segment.split(separator: "/")
      guard parts.count == 2, let start = parse(String(parts[0])),
        let end = parse(String(parts[1])), end > start else { return nil }
      return Interval(start: start, end: end)
    }
    let closed = ranges.reduce(0) { $0 + $1.end.timeIntervalSince($1.start) }
    let remainder = recorded - closed
    let unlocated = remainder > 0.001 ? remainder : 0
    var running = 0.0
    if session.text("status") == "running", let start = parse(session.text("runningSince")), now > start {
      ranges.append(Interval(start: start, end: now))
      running = now.timeIntervalSince(start)
    }
    return (ranges, closed + unlocated + running, 0, unlocated)
  }
  public static func elapsed(_ session: Record, now: Date) -> Double {
    sessionTime(session, now: now).total
  }
  public static func summarize(
    _ sessions: [Record], now: Date, timezone: TimeZone = TimeZone(identifier: "Asia/Shanghai")!
  ) -> TimeSummary {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timezone
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timezone
    formatter.dateFormat = "yyyy-MM-dd"
    var ranges: [String: [Interval]] = [:]
    var daily: [String: Double] = [:]
    var manualSeconds = 0.0
    var unlocatedSeconds = 0.0
    for session in sessions {
      let time = sessionTime(session, now: now)
      let day = session.text("day")
      if time.manual + time.unlocated > 0,
         day.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil {
        daily[day, default: 0] += time.manual + time.unlocated
        manualSeconds += time.manual
        unlocatedSeconds += time.unlocated
      }
      for interval in time.ranges {
        var cursor = interval.start
        while cursor < interval.end {
          let boundary = min(
            interval.end,
            calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: cursor))!)
          ranges[formatter.string(from: cursor), default: []].append(
            Interval(start: cursor, end: boundary))
          cursor = boundary
        }
      }
    }
    var overlap = 0.0
    for (day, pieces) in ranges {
      let sorted = pieces.sorted { $0.start < $1.start }
      var union = 0.0
      var active: Interval?
      for value in sorted {
        if var prior = active {
          if value.start <= prior.end {
            prior.end = max(prior.end, value.end)
            active = prior
          } else {
            union += prior.end.timeIntervalSince(prior.start)
            active = value
          }
        } else {
          active = value
        }
      }
      if let active { union += active.end.timeIntervalSince(active.start) }
      overlap += pieces.reduce(0) { $0 + $1.end.timeIntervalSince($1.start) } - union
      daily[day, default: 0] += union
    }
    return TimeSummary(
      daily: daily, overlapSeconds: overlap, manualSeconds: manualSeconds,
      unlocatedSeconds: unlocatedSeconds)
  }
}
