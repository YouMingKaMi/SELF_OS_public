import XCTest

@testable import CouncilCore

final class FinanceRulesTests: XCTestCase {
  private func expense(_ fields: [String: String] = [:]) -> Record {
    var data: [String: JSONValue] = [
      "amountMinor": .string("10000"), "mode": .string("estimated"),
      "day": .string("2026-01-01"), "startDay": .string("2026-01-01"),
      "endDay": .string("2026-04-10"),
    ]
    for (key, value) in fields { data[key] = .string(value) }
    return Record(
      id: UUID().uuidString, type: "expense", version: 1, data: data, deleted: false, updatedAt: "")
  }
  func testTermAndCurrentWithExplicitClockAndUnconfirmedExpiry() {
    let e = expense()
    XCTAssertEqual(FinanceRules.daily(e, basis: .term, asOf: "2026-01-10"), 100)
    XCTAssertEqual(FinanceRules.daily(e, basis: .current, asOf: "2026-01-10"), 1000)
    XCTAssertNil(FinanceRules.daily(e, basis: .current, asOf: "2025-12-31"))
    XCTAssertFalse(FinanceRules.isHistory(e, asOf: "2026-05-01"))
    XCTAssertEqual(
      FinanceRules.contribution(e, day: "2026-05-01", basis: .term, asOf: "2026-05-01"), 100)
  }
  func testFixedDenominatorNeverChangesWithCurrentOrEarlyEnd() {
    let fixed = expense([
      "mode": "fixed", "amountMinor": "365000", "endDay": "2026-12-31", "endedDay": "2026-01-10",
    ])
    for basis in [FinanceRules.Basis.term, .current] {
      XCTAssertEqual(FinanceRules.daily(fixed, basis: basis, asOf: "2026-01-10"), 1000)
      XCTAssertEqual(
        FinanceRules.total([fixed], month: "2026-01", basis: basis, asOf: "2026-01-31"), 10000)
    }
    XCTAssertFalse(FinanceRules.isHistory(fixed, asOf: "2026-01-10"))
    XCTAssertTrue(FinanceRules.isHistory(fixed, asOf: "2026-01-11"))
  }
  func testSaleReattributesPurchaseWithoutNegativeSaleDayAndAllowsProfit() {
    let sold = expense([
      "recoveryMinor": "12000", "recoveryDay": "2026-02-10", "endedDay": "2026-02-10",
    ])
    XCTAssertEqual(FinanceRules.net(sold), -2000)
    XCTAssertEqual(
      FinanceRules.total([sold], month: "2026-01", basis: .actual, asOf: "2026-02-10"), -2000)
    XCTAssertEqual(
      FinanceRules.total([sold], month: "2026-02", basis: .actual, asOf: "2026-02-10"), 0)
    XCTAssertEqual(FinanceRules.daily(sold, basis: .term, asOf: "2026-02-10"), Decimal(-2000) / 41)
    XCTAssertEqual(
      FinanceRules.daily(sold, basis: .term, asOf: "2026-02-10"),
      FinanceRules.daily(sold, basis: .current, asOf: "2026-02-10"))
  }
  func testMonthlyUsageDoesNotAddLongPurchaseAndClipsAsOf() {
    let long = expense()
    let immediate = expense(["mode": "immediate", "amountMinor": "250", "day": "2026-01-10"])
    let future = expense(["mode": "immediate", "amountMinor": "999", "day": "2026-01-11"])
    XCTAssertEqual(
      FinanceRules.total(
        [long, immediate, future], month: "2026-01", basis: .term, asOf: "2026-01-10"), 1250)
    XCTAssertEqual(
      FinanceRules.total(
        [long, immediate, future], month: "2026-01", basis: .current, asOf: "2026-01-10"), 10250)
    XCTAssertEqual(
      FinanceRules.total(
        [long, immediate, future], month: "2026-01", basis: .actual, asOf: "2026-01-10"), 10250)
  }
  func testHistoricalCurrentViewReestimatesAtCurrentAsOf() {
    let e = expense()
    XCTAssertEqual(
      FinanceRules.total([e], month: "2026-01", basis: .current, asOf: "2026-02-19"), 6200)
    XCTAssertEqual(
      FinanceRules.total([e], month: "2026-01", basis: .term, asOf: "2026-02-19"), 3100)
  }
  func testCalendarBoundariesLeapMonthStrictInvalidDatesAndFuture() {
    XCTAssertEqual(FinanceRules.monthDays("2024-02", asOf: "2024-03-01").count, 29)
    XCTAssertEqual(FinanceRules.monthDays("2024-02", asOf: "2024-02-10").count, 10)
    XCTAssertEqual(FinanceRules.monthDays("2024-04", asOf: "2024-03-01"), [])
    XCTAssertNil(FinanceRules.date("2026-02-30"))
    XCTAssertNil(FinanceRules.date("2026-1-01"))
    XCTAssertEqual(FinanceRules.inclusiveDays("2024-02-28", "2024-03-01"), 3)
    XCTAssertEqual(FinanceRules.inclusiveDays("2024-03-01", "2024-02-28"), 0)
    XCTAssertEqual(FinanceRules.shiftedMonth("2026-01", by: -1), "2025-12")
  }
  func testFractionalSharesRoundOnlyAtAggregateAndLargeMoneyStaysExact() {
    let third = expense(["amountMinor": "100", "endDay": "2026-01-03"])
    XCTAssertEqual(
      FinanceRules.rounded(
        FinanceRules.total([third], month: "2026-01", basis: .term, asOf: "2026-01-03")), 100)
    XCTAssertEqual(
      FinanceRules.rounded(FinanceRules.daily(third, basis: .term, asOf: "2026-01-03")!) * 3, 99)
    let large = expense(["amountMinor": "9007199254740993", "recoveryMinor": "1"])
    XCTAssertEqual(FinanceRules.net(large), Decimal(string: "9007199254740992"))
    XCTAssertNil(FinanceRules.minor("10.5"))
    XCTAssertNil(FinanceRules.minor("10oops"))
  }
  func testExactHalfCentAcrossDifferentDenominatorsAndNegativeRecovery() {
    let third = expense(["amountMinor": "1", "endDay": "2026-01-03"])
    let sixth = expense(["amountMinor": "1", "endDay": "2026-01-06"])
    XCTAssertEqual(
      FinanceRules.total([third, sixth], month: "2026-01", basis: .term, asOf: "2026-01-01"), 1)
    XCTAssertEqual(FinanceRules.dailyTotal([third, sixth], basis: .term, asOf: "2026-01-01"), 1)
    let summary = FinanceRules.summary(
      [third, sixth], month: "2026-01", basis: .term, asOf: "2026-01-02")
    XCTAssertEqual(summary.total, 1)
    XCTAssertEqual(summary.calendarAverage, 1)
    var negative = FinanceFraction()
    negative.add(-1, divisor: 3)
    negative.add(-1, divisor: 6)
    XCTAssertEqual(negative.rounded(), -1)
    var large = FinanceFraction()
    large.add(Decimal(string: "9007199254740993")!, divisor: 3)
    large.add(Decimal(string: "9007199254740993")!, divisor: 6)
    XCTAssertEqual(large.rounded(), Decimal(string: "4503599627370497"))
    var coprime = FinanceFraction()
    let primes = [23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71]
    for prime in primes { coprime.add(Decimal(prime), divisor: prime) }
    XCTAssertEqual(coprime.rounded(), 12)
    coprime.add(-12)
    XCTAssertEqual(coprime.rounded(), 0)
  }
  func testZeroRecordedDayAndAbsentDaysHaveDifferentAverages() {
    let zero = expense(["mode": "immediate", "amountMinor": "0"])
    let paid = expense(["mode": "immediate", "amountMinor": "100", "day": "2026-01-02"])
    let summary = FinanceRules.summary(
      [zero, paid], month: "2026-01", basis: .actual, asOf: "2026-01-10")
    XCTAssertEqual(summary.recordedDays, 2)
    XCTAssertEqual(summary.recordedAverage, 50)
    XCTAssertEqual(summary.calendarAverage, 10)
    XCTAssertEqual(summary.days.count, 10)
  }
  func testReportCategoryChildAndNecessityTotalsShareBasis() {
    var first = expense([
      "mode": "immediate", "amountMinor": "100", "categoryId": "food", "subcategoryId": "meal",
    ])
    first.data["necessary"] = .bool(true)
    let second = expense([
      "mode": "immediate", "amountMinor": "30", "categoryId": "food", "subcategoryId": "coffee",
    ])
    let report = FinanceReport(
      expenses: [first, second], filtered: [first, second], month: "2026-01", basis: .actual,
      asOf: "2026-01-10")
    XCTAssertEqual(report.categories.first?.minor, 130)
    XCTAssertEqual(report.subcategories.count, 2)
    XCTAssertEqual(report.necessary, 100)
    XCTAssertEqual(report.discretionary, 30)
  }
}
