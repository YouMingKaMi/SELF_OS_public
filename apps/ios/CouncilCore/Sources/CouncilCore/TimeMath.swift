import Foundation

public struct TimeSummary: Sendable {
  public let daily: [String: Double]
  public let overlapSeconds: Double
  public let manualSeconds: Double
  public var totalSeconds: Double { daily.values.reduce(0, +) }
}
public enum TimeMath {
  struct Interval {
    var start: Date
    var end: Date
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
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    func parse(_ text: String) -> Date? {
      iso.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
    var ranges: [String: [Interval]] = [:]
    var manual: [String: Double] = [:]
    for session in sessions where session.text("status") != "cancelled" {
      var pieces: [Interval] = []
      if !session.flag("manual") {
        for text in session.data["segments"]?.strings ?? [] {
          let split = text.split(separator: "/").map(String.init)
          if split.count == 2, let start = parse(split[0]), let end = parse(split[1]), end > start {
            pieces.append(Interval(start: start, end: end))
          }
        }
        if session.text("status") == "running", let start = parse(session.text("runningSince")),
          now > start
        {
          pieces.append(Interval(start: start, end: now))
        }
        if pieces.isEmpty, let start = parse(session.text("startedAt")),
          session.number("elapsedSeconds") > 0
        {
          pieces = [
            Interval(start: start, end: start.addingTimeInterval(session.number("elapsedSeconds")))
          ]
        }
      }
      if pieces.isEmpty {
        manual[session.text("day"), default: 0] += max(0, session.number("elapsedSeconds"))
      }
      for interval in pieces {
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
    var daily = manual
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
      daily: daily, overlapSeconds: overlap, manualSeconds: manual.values.reduce(0, +))
  }
}
