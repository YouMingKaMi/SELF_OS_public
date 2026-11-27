import XCTest
@testable import CouncilCore
final class FreedomRulesTests: XCTestCase {
  func testTrendKeepsHistoricalGapsAndUsesTheBusinessDay() {
    func row(_ id: String, _ type: String, _ fields: [String: String]) -> Record {
      Record(id: id, type: type, version: 1, data: fields.mapValues(JSONValue.string), deleted: false, updatedAt: "")
    }
    let wallet = row("stable", "wallet", ["category": "cny"])
    let entry = row("balance", "walletEntry", [
      "walletId": "stable", "at": "2026-01-02T16:00:00Z", "mode": "set", "quantity": "200",
    ])
    let history = TreasuryRules.report(wallets: [wallet], entries: [entry],
                                       historyOf: TreasurySelection(wallets: ["stable"], assets: [])).history
    let points = FreedomRules.trend([
      expense(["day": "2026-01-01", "amountMinor": "10000"]),
      expense(["day": "2026-01-03", "amountMinor": "2000", "recoveryDay": "2026-01-04", "recoveryMinor": "2000"]),
    ], history: history, from: "2026-01-02", to: "2026-01-09", today: "2026-01-04",
       assetsToday: 25000, since: "", basis: .term)
    XCTAssertEqual(points.map { BusinessDate.day($0.day) }, ["2026-01-02", "2026-01-03", "2026-01-04"])
    XCTAssertEqual(points.map(\.average), [5000, 4000, 2500])
    XCTAssertEqual(points.map(\.usageCost), [0, 2000, 0])
    XCTAssertEqual(points.map(\.days), [nil, 5, 10])
  }

  func expense(_ fields: [String: String]) -> Record {
    Record(id: UUID().uuidString, type: "expense", version: 1,
           data: fields.mapValues { .string($0) }, deleted: false, updatedAt: "")
  }
  func testCalendarDaysAndFutureExcluded() {
    let rows = [expense(["day":"2026-01-01", "amountMinor":"10000"]), expense(["day":"2026-01-10", "amountMinor":"20000"]), expense(["day":"2026-02-01", "amountMinor":"99900"])]
    let cost = FreedomRules.cost(rows, today: "2026-01-10")
    XCTAssertEqual(cost.days, 10)
    XCTAssertEqual(cost.total, 30000)
    XCTAssertEqual(cost.average, 3000)
    XCTAssertEqual(cost.today, 20000)
  }
  func testOldPurchaseContributesOnlyWithinBookkeepingWindow() {
    let rows = [expense(["mode":"estimated", "day":"2026-01-01", "startDay":"2026-01-01", "endDay":"2028-09-26", "amountMinor":"100000"])]
    XCTAssertEqual(FreedomRules.cost(rows, today:"2026-04-10").days, 0)
    let current = FreedomRules.cost(rows, today:"2026-04-10", since:"2026-04-01")
    XCTAssertEqual(current.total, 10000)
    XCTAssertEqual(current.average, 1000)
  }
  func testFixedCostAndSettledRefund() {
    let fixed = expense(["mode":"fixed", "startDay":"2026-01-01", "endDay":"2026-12-31", "amountMinor":"365000"])
    XCTAssertEqual(FreedomRules.cost([fixed], today:"2026-01-10", since:"2026-01-01").average, 1000)
    let immediate = expense(["day":"2026-01-01", "amountMinor":"10000", "recoveryMinor":"4000"])
    XCTAssertEqual(FreedomRules.cost([immediate], today:"2026-01-10").total, 6000)
  }
  func testEstimatedTermDiffersFromCurrentAndDoesNotOverchargeAfterTerm() {
    let item = expense([
      "mode": "estimated", "startDay": "2026-01-01", "endDay": "2026-01-10",
      "amountMinor": "10000",
    ])
    let start = "2026-01-01"
    let early = "2026-01-05"
    XCTAssertEqual(FreedomRules.cost([item], today: early, since: start, basis: .current).average, 2000)
    XCTAssertEqual(FreedomRules.cost([item], today: early, since: start, basis: .term).average, 1000)
    XCTAssertEqual(FreedomRules.cost([item], today: "2026-01-20", since: start, basis: .term).total, 10000)
  }
  func testFreedomDaysZeroAndFloor() {
    XCTAssertNil(FreedomRules.days(assets:1000, average:0))
    XCTAssertEqual(FreedomRules.days(assets:10000, average:300), 33)
    XCTAssertEqual(FreedomRules.days(assets:-100, average:300), 0)
  }

  func testLeapBirthdayRowsRemainContiguous() throws {
    let birth = try XCTUnwrap(FinanceRules.date("2004-02-29"))
    let lastLeapBirthday = FreedomRules.birthday(birth, atAge: 20)
    let nextBirthday = FreedomRules.birthday(birth, atAge: 21)
    XCTAssertEqual(BusinessDate.day(nextBirthday), "2025-03-01")
    XCTAssertEqual(FreedomRules.distance(from: lastLeapBirthday, to: nextBirthday), 366)
    XCTAssertEqual(BusinessDate.day(FreedomRules.birthday(birth, atAge: 24)), "2028-02-29")
  }
}
