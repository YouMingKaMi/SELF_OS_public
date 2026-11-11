import XCTest

@testable import CouncilCore

final class TreasuryRulesTests: XCTestCase {
  func wallet(_ id: String) -> Record {
    Record(
      id: id, type: "wallet", version: 1,
      data: ["name": .string(id), "category": .string("cny"), "currency": .string("CNY")],
      deleted: false, updatedAt: "")
  }
  func entry(_ id: String, _ day: String, _ mode: String, _ qty: String) -> Record {
    Record(
      id: id, type: "walletEntry", version: 1,
      data: [
        "walletId": .string("a"), "at": .string(day + "T00:00:00Z"), "mode": .string(mode),
        "quantity": .string(qty),
      ], deleted: false, updatedAt: "")
  }
  func testReplayPreservesRealDateSpacingUnknownWalletAndDecimalDelta() {
    let rows = [
      entry("c", "2026-11-08", "delta", "-0.05"), entry("a", "2026-10-16", "set", "100.10"),
      entry("b", "2026-11-01", "delta", "2.20"),
    ]
    let report = TreasuryRules.report(wallets: [wallet("a"), wallet("b")], entries: rows)
    XCTAssertEqual(report.total, Decimal(string: "102.25"))
    XCTAssertEqual(report.unknownWallets, 1)
    XCTAssertEqual(report.points.map(\.id), ["a", "b", "c"])
    XCTAssertGreaterThan(
      report.points[1].at.timeIntervalSince(report.points[0].at),
      report.points[2].at.timeIntervalSince(report.points[1].at))
    XCTAssertNil(
      TreasuryRules.report(
        wallets: [wallet("a")], entries: [entry("delta", "2026-11-08", "delta", "5")]
      ).total)
  }
}
