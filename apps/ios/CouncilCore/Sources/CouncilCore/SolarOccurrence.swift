import Foundation

public enum SolarOccurrence {
  /// Find the occurrence on or after a business day and preserve the original month-day anchor.
  public static func next(
    from first: Date, onOrAfter after: Date, unit: String, interval: Int, calendar: Calendar
  ) -> Date? {
    guard (1...10000).contains(interval) else { return nil }
    if first >= after { return first }

    if unit == "day" || unit == "week" {
      guard let days = calendar.dateComponents([.day], from: first, to: after).day else { return nil }
      let step = interval * (unit == "week" ? 7 : 1)
      return calendar.date(byAdding: .day, value: ((days + step - 1) / step) * step, to: first)
        .flatMap { calendar.component(.year, from: $0) <= 9999 ? $0 : nil }
    }
    guard unit == "month" || unit == "year",
          let firstMonth = calendar.dateInterval(of: .month, for: first)?.start,
          let afterMonth = calendar.dateInterval(of: .month, for: after)?.start,
          let months = calendar.dateComponents([.month], from: firstMonth, to: afterMonth).month
    else { return nil }
    let step = interval * (unit == "year" ? 12 : 1)
    let index = months / step
    let anchorDay = calendar.component(.day, from: first)
    func candidate(_ index: Int) -> Date? {
      guard let month = calendar.date(byAdding: .month, value: index * step, to: firstMonth),
            calendar.component(.year, from: month) <= 9999,
            let lastDay = calendar.range(of: .day, in: .month, for: month)?.count
      else { return nil }
      return calendar.date(byAdding: .day, value: min(anchorDay, lastDay) - 1, to: month)
    }
    guard let next = candidate(index) else { return nil }
    return next >= after ? next : candidate(index + 1)
  }
}
