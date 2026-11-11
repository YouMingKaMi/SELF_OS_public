import Foundation

/// Personal-ledger rules. Money stays in Decimal minor units until display rounding.
/// No wall clock or implicit system timezone is read by this module.
public enum FinanceRules {
  public enum Basis: String, Sendable { case actual, term, current }
  public struct DayValue: Identifiable, Sendable {
    public var id: String { day }
    public let day: String
    public let minor: Decimal
  }
  public struct Summary: Sendable {
    public let days: [DayValue]
    public let total: Decimal
    public let calendarAverage: Decimal?
    public let recordedAverage: Decimal?
    public let recordedDays: Int
  }
  public static var calendar: Calendar {
    var value = Calendar(identifier: .gregorian)
    value.timeZone = TimeZone(identifier: "Asia/Shanghai")!
    value.locale = Locale(identifier: "en_US_POSIX")
    return value
  }
  public static func date(_ day: String) -> Date? {
    let parts = day.split(separator: "-", omittingEmptySubsequences: false)
    guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
      let year = Int(parts[0]), year > 0, let month = Int(parts[1]), let day = Int(parts[2]),
      let result = calendar.date(from: DateComponents(year: year, month: month, day: day))
    else { return nil }
    let actual = calendar.dateComponents([.year, .month, .day], from: result)
    return actual.year == year && actual.month == month && actual.day == day ? result : nil
  }
  public static func inclusiveDays(_ start: String, _ end: String) -> Int {
    guard let a = date(start), let b = date(end), b >= a else { return 0 }
    return (calendar.dateComponents([.day], from: a, to: b).day ?? -1) + 1
  }
  public static func shiftedMonth(_ month: String, by offset: Int) -> String? {
    guard let first = date(month + "-01"),
      let shifted = calendar.date(byAdding: .month, value: offset, to: first)
    else { return nil }
    return String(BusinessDate.day(shifted).prefix(7))
  }
  /// History months include every calendar day; current month stops at asOf; future months are empty.
  public static func monthDays(_ month: String, asOf: String) -> [String] {
    guard date(asOf) != nil, let first = date(month + "-01"),
      let range = calendar.range(of: .day, in: .month, for: first)
    else { return [] }
    return range.map { month + String(format: "-%02d", $0) }.filter { $0 <= asOf }
  }
  public static func minor(_ value: String) -> Decimal? {
    guard !value.isEmpty, value.allSatisfy({ $0.isASCII && ($0.isNumber || $0 == "-") }),
      value.dropFirst(value.hasPrefix("-") ? 1 : 0).allSatisfy(\.isNumber),
      value != "-"
    else { return nil }
    return Decimal(string: value, locale: Locale(identifier: "en_US_POSIX"))
  }
  public static func net(_ expense: Record) -> Decimal {
    (minor(expense.text("amountMinor")) ?? 0) - (minor(expense.text("recoveryMinor")) ?? 0)
  }
  public static func rounded(_ value: Decimal) -> Decimal {
    var source = value
    var result = Decimal()
    NSDecimalRound(&result, &source, 0, .plain)
    return result
  }
  public static func string(_ value: Decimal, rounded: Bool = true) -> String {
    NSDecimalNumber(decimal: rounded ? self.rounded(value) : value).stringValue
  }
  /// Fixed contracts keep their original complete-term denominator after early settlement.
  public static func daily(_ expense: Record, basis: Basis, asOf: String) -> Decimal? {
    let count = duration(expense, basis: basis, asOf: asOf)
    return count > 0 ? net(expense) / Decimal(count) : nil
  }
  private static func duration(_ expense: Record, basis: Basis, asOf: String) -> Int {
    let start = expense.text("startDay")
    guard date(asOf) != nil, date(start) != nil, start <= asOf,
      expense.text("mode") != "immediate"
    else { return 0 }
    let end: String
    if expense.text("mode") == "fixed" {
      end = expense.text("endDay")
    } else if !expense.text("endedDay").isEmpty {
      end = expense.text("endedDay")
    } else {
      end = basis == .current ? asOf : expense.text("endDay")
    }
    return inclusiveDays(start, end)
  }
  /// Sum fractional daily shares exactly, then round the final total to one minor unit.
  public static func dailyTotal(_ expenses: [Record], basis: Basis, asOf: String) -> Decimal {
    var result = FinanceFraction()
    for expense in expenses where !expense.deleted {
      result.add(net(expense), divisor: duration(expense, basis: basis, asOf: asOf))
    }
    return result.rounded()
  }
  public static func effectiveEnd(_ expense: Record, asOf: String) -> String {
    let confirmed = expense.text("endedDay")
    if expense.text("mode") == "fixed" {
      return confirmed.isEmpty ? expense.text("endDay") : min(confirmed, expense.text("endDay"))
    }
    return confirmed.isEmpty ? asOf : confirmed
  }
  public static func isHistory(_ expense: Record, asOf: String) -> Bool {
    expense.text("mode") != "immediate" && effectiveEnd(expense, asOf: asOf) < asOf
  }
  /// Long-term items as seen from one month. Figures are always as of today: an item still in use
  /// shows its numbers up to today; an ended one keeps its final, fixed numbers.
  /// Past month: everything that was in use during it. Current month: what is in use now;
  /// everything already ended goes to `hidden`.
  public static func longTerm(_ expenses: [Record], month: String, asOf: String)
    -> (shown: [Record], hidden: [Record])
  {
    let items = expenses.filter {
      !$0.deleted && $0.text("mode") != "immediate" && date($0.text("startDay")) != nil
    }.sorted { $0.text("startDay") > $1.text("startDay") }
    if month >= String(asOf.prefix(7)) {
      return (items.filter { !isHistory($0, asOf: asOf) }, items.filter { isHistory($0, asOf: asOf) })
    }
    let shown = items.filter {
      $0.text("startDay") <= month + "-31" && effectiveEnd($0, asOf: asOf) >= month + "-01"
    }
    return (shown, [])
  }

  /// Corrections and recoveries always remain attributed to the original purchase day.
  public static func contribution(_ expense: Record, day: String, basis: Basis, asOf: String)
    -> Decimal
  {
    guard date(day) != nil, date(asOf) != nil, day <= asOf, !expense.deleted else { return 0 }
    if basis == .actual || expense.text("mode") == "immediate" {
      return expense.text("day") == day ? net(expense) : 0
    }
    guard day >= expense.text("startDay"), day <= effectiveEnd(expense, asOf: asOf) else {
      return 0
    }
    return daily(expense, basis: basis, asOf: asOf) ?? 0
  }
  private static func aggregate(_ expenses: [Record], month: String, basis: Basis, asOf: String)
    -> FinanceFraction
  {
    let days = monthDays(month, asOf: asOf)
    var result = FinanceFraction()
    guard let first = days.first, let last = days.last else { return result }
    for expense in expenses where !expense.deleted {
      if basis == .actual || expense.text("mode") == "immediate" {
        if expense.text("day") >= first && expense.text("day") <= last { result.add(net(expense)) }
      } else {
        let start = max(first, expense.text("startDay"))
        let end = min(last, effectiveEnd(expense, asOf: asOf))
        result.add(
          net(expense), days: inclusiveDays(start, end),
          divisor: duration(expense, basis: basis, asOf: asOf))
      }
    }
    return result
  }
  public static func total(_ expenses: [Record], month: String, basis: Basis, asOf: String)
    -> Decimal
  {
    aggregate(expenses, month: month, basis: basis, asOf: asOf).rounded()
  }
  public static func summary(_ expenses: [Record], month: String, basis: Basis, asOf: String)
    -> Summary
  {
    let values = monthDays(month, asOf: asOf).map { day in
      DayValue(
        day: day,
        minor: expenses.reduce(Decimal()) {
          $0 + contribution($1, day: day, basis: basis, asOf: asOf)
        })
    }
    let amount = aggregate(expenses, month: month, basis: basis, asOf: asOf)
    // Recorded means an attributed record exists, including explicitly recorded zero values.
    let recorded = values.filter { value in
      expenses.contains { expense in
        guard !expense.deleted else { return false }
        if basis == .actual || expense.text("mode") == "immediate" {
          return expense.text("day") == value.day
        }
        return expense.text("startDay") <= value.day
          && effectiveEnd(expense, asOf: asOf) >= value.day
          && daily(expense, basis: basis, asOf: asOf) != nil
      }
    }.count
    return Summary(
      days: values, total: amount.rounded(),
      calendarAverage: values.isEmpty ? nil : amount.rounded(dividingBy: values.count),
      recordedAverage: recorded == 0 ? nil : amount.rounded(dividingBy: recorded),
      recordedDays: recorded)
  }
}

/// A single background-computable dashboard result, shared by summary, graph and breakdown rows.
public struct FinanceReport: Sendable {
  public struct Group: Identifiable, Sendable {
    public let id: String
    public let minor: Decimal
  }
  public let summary: FinanceRules.Summary
  public let previous: FinanceRules.Summary
  public let actualTotal: Decimal
  public let categories: [Group]
  public let subcategories: [Group]
  public let necessary: Decimal
  public let discretionary: Decimal
  public init(
    expenses: [Record], filtered: [Record], month: String, basis: FinanceRules.Basis, asOf: String
  ) {
    summary = FinanceRules.summary(filtered, month: month, basis: basis, asOf: asOf)
    previous = FinanceRules.summary(
      filtered, month: FinanceRules.shiftedMonth(month, by: -1) ?? "", basis: basis, asOf: asOf)
    actualTotal = FinanceRules.total(expenses, month: month, basis: .actual, asOf: asOf)
    func groups(_ key: String) -> [Group] {
      Dictionary(grouping: filtered, by: { $0.text(key) }).map { key, rows in
        Group(id: key, minor: FinanceRules.total(rows, month: month, basis: basis, asOf: asOf))
      }.filter { $0.minor != 0 }.sorted {
        $0.minor == $1.minor ? $0.id < $1.id : $0.minor > $1.minor
      }
    }
    categories = groups("categoryId")
    subcategories = groups("subcategoryId")
    necessary = FinanceRules.total(
      filtered.filter { $0.flag("necessary") }, month: month, basis: basis, asOf: asOf)
    discretionary = FinanceRules.total(
      filtered.filter { !$0.flag("necessary") }, month: month, basis: basis, asOf: asOf)
  }
}
