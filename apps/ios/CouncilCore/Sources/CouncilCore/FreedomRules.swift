import Foundation

/// Mirrors the web freedom projection. Monetary values are cents.
public enum FreedomRules {
  public struct Cost: Sendable {
    public static let empty = Cost()
    public var since: String?
    public var days = 0
    public var total: Decimal = 0
    public var today: Decimal = 0
    public var average: Decimal { days > 0 ? total / Decimal(days) : 0 }
  }
  public static func cost(_ expenses: [Record], today: String, since custom: String = "", basis: FinanceRules.Basis = .current) -> Cost {
    let first = expenses.filter { !$0.deleted && ["", "immediate"].contains($0.text("mode")) }
      .map { $0.text("day") }.filter { FinanceRules.date($0) != nil && $0 <= today }.min()
    guard let since = FinanceRules.date(custom) != nil ? custom : first, since <= today else { return Cost() }
    var result = Cost(since: since, days: FinanceRules.inclusiveDays(since, today))
    for e in expenses where !e.deleted {
      if ["", "immediate"].contains(e.text("mode")) {
        let day = e.text("day")
        guard FinanceRules.date(day) != nil, day >= since, day <= today else { continue }
        result.total += FinanceRules.net(e)
        if day == today { result.today += FinanceRules.net(e) }
      } else if var rate = FinanceRules.daily(e, basis: basis, asOf: today) {
        let start = e.text("startDay")
        let end = min(today, FinanceRules.effectiveEnd(e, asOf: today))
        let used = FinanceRules.inclusiveDays(start, end)
        if basis == .term && e.text("mode") != "fixed" && e.text("endedDay").isEmpty && used > FinanceRules.inclusiveDays(start, e.text("endDay")) && used > 0 {
          rate = FinanceRules.net(e) / Decimal(used)
        }
        let count = FinanceRules.inclusiveDays(max(since, start), end)
        result.total += rate * Decimal(count)
        if count > 0 && end == today { result.today += rate }
      }
    }
    return result
  }
  public static func days(assets: Decimal, average: Decimal) -> Int? {
    guard average > 0 else { return nil }
    let n = NSDecimalNumber(decimal: max(0, assets) / average).doubleValue
    guard n.isFinite else { return nil }
    return Int(min(n.rounded(.down), 1_000_000))
  }

  /// The web rolls February 29 birthdays forward to March 1 in non-leap years.
  public static func birthday(_ birth: Date, atAge age: Int) -> Date {
    let calendar = FinanceRules.calendar
    var parts = calendar.dateComponents([.year, .month, .day], from: birth)
    parts.year = parts.year.map { $0 + age }
    return calendar.date(from: parts) ?? birth
  }

  public static func distance(from start: Date, to end: Date) -> Int {
    FinanceRules.calendar.dateComponents([.day], from: start, to: end).day ?? 0
  }

  public struct TrendPoint: Identifiable, Sendable {
    public let day: Date
    public let average: Decimal?
    public let usageCost: Decimal?
    public let days: Int?
    public var id: Date { day }
  }

  /// Hide sales and recoveries that had not yet occurred on a retrospective point.
  public static func expenseKnownAt(_ record: Record, day: String) -> Record {
    let ended = record.text("endedDay")
    let recoveryDate = record.text("recoveryDay")
    let recovery = recoveryDate.isEmpty ? (ended.isEmpty ? record.text("day") : ended) : recoveryDate
    guard ended > day || recovery > day else { return record }
    var data = record.data
    if ended > day { data.removeValue(forKey: "endedDay") }
    if recovery > day { data.removeValue(forKey: "recoveryMinor") }
    return Record(id: record.id, type: record.type, version: record.version, data: data,
                  deleted: record.deleted, updatedAt: record.updatedAt)
  }

  public static func trend(
    _ expenses: [Record], history: [TreasuryHistoryPoint], from: String, to: String,
    today: String, assetsToday: Decimal?, since: String, basis: FinanceRules.Basis
  ) -> [TrendPoint] {
    guard var date = FinanceRules.date(from), let last = FinanceRules.date(min(to, today)), date <= last else { return [] }
    let stride = max(1, (distance(from: date, to: last) + 365) / 366)
    let calendar = FinanceRules.calendar
    let sorted = history.sorted { $0.at < $1.at }
    let end = min(to, today)
    let customStart = FinanceRules.date(since) != nil
    var start = customStart ? since : nil
    var ordinaryByDay: [String: Decimal] = [:]
    var ordinaryEvents: [String: Decimal] = [:]
    var longTerm: [Record] = []
    for record in expenses where !record.deleted {
      if !["", "immediate"].contains(record.text("mode")) {
        longTerm.append(record)
        continue
      }
      let purchase = record.text("day")
      guard FinanceRules.date(purchase) != nil, purchase <= end else { continue }
      if !customStart { start = min(start ?? purchase, purchase) }
      if customStart && purchase < since { continue }
      let amount = FinanceRules.minor(record.text("amountMinor")) ?? 0
      let recovery = FinanceRules.minor(record.text("recoveryMinor")) ?? 0
      ordinaryByDay[purchase, default: 0] += amount
      ordinaryEvents[purchase, default: 0] += amount
      if recovery == 0 { continue }
      let ended = record.text("endedDay")
      let date = record.text("recoveryDay")
      let effective = min(today, max(purchase, date.isEmpty ? ended : date))
      ordinaryEvents[effective, default: 0] -= recovery
      if effective == purchase { ordinaryByDay[purchase, default: 0] -= recovery }
    }
    let events = ordinaryEvents.sorted { $0.key < $1.key }
    var eventIndex = 0
    var ordinaryTotal = Decimal.zero
    var cursor = 0
    var balance: Decimal?
    var result: [TrendPoint] = []
    let dayFormat = DateFormatter()
    dayFormat.locale = Locale(identifier: "en_US_POSIX")
    dayFormat.calendar = calendar
    dayFormat.timeZone = calendar.timeZone
    dayFormat.dateFormat = "yyyy-MM-dd"
    while !Task.isCancelled {
      let day = dayFormat.string(from: date)
      let nextMidnight = calendar.date(byAdding: .day, value: 1, to: date)!
      while cursor < sorted.count && sorted[cursor].at < nextMidnight {
        balance = sorted[cursor].value
        cursor += 1
      }
      while eventIndex < events.count && events[eventIndex].key <= day {
        ordinaryTotal += events[eventIndex].value
        eventIndex += 1
      }
      if let start, day >= start {
        let rows = day == today ? longTerm : longTerm.map { expenseKnownAt($0, day: day) }
        let costs = cost(rows, today: day, since: start, basis: basis)
        let average = costs.days > 0 ? (ordinaryTotal + costs.total) / Decimal(costs.days) : 0
        let assets = day == today ? assetsToday : balance.map { $0 * 100 }
        result.append(TrendPoint(day: date, average: average,
                                 usageCost: ordinaryByDay[day, default: 0] + costs.today,
                                 days: assets.flatMap { days(assets: $0, average: average) }))
      } else {
        result.append(TrendPoint(day: date, average: nil, usageCost: nil, days: nil))
      }
      if date == last { return result }
      date = min(last, calendar.date(byAdding: .day, value: stride, to: date)!)
    }
    return []
  }
}
