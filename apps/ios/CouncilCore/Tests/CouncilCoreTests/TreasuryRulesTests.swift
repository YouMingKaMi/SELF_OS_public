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
    XCTAssertEqual(
      TreasuryRules.report(
        wallets: [wallet("a")], entries: [entry("delta", "2026-11-08", "delta", "5")]
      ).total, 5)
  }
  func testSubcentAssetHoldingsAreSummedAtFullPrecisionAndUnknownHistoryStaysBlank() {
    let asset = Record(
      id: "x", type: "asset", version: 1, data: ["manualPrice": .string("1")],
      deleted: false, updatedAt: "")
    let rows = ["a", "b"].map { wallet in
      Record(id: wallet, type: "walletEntry", version: 1, data: [
        "walletId": .string(wallet), "assetId": .string("x"), "quantity": .string("0.006"),
        "at": .string("2026-01-01T15:00:00Z"), "mode": .string("set"),
      ], deleted: false, updatedAt: "")
    }
    let report = TreasuryRules.report(
      wallets: [wallet("a"), wallet("b")], assets: [asset], entries: rows,
      historyOf: TreasurySelection(wallets: [], assets: ["x"]))
    XCTAssertEqual(report.total, Decimal(string: "0.012"))
    XCTAssertEqual(report.assets["x"]?.value, report.total)
    XCTAssertEqual(FinanceRules.rounded((report.total ?? 0) * 100), 1)
    XCTAssertTrue(report.history.allSatisfy { $0.value == nil }) // The manual price is only known now.
    XCTAssertEqual(report.selected?.known, 1)
  }
  func testPartialStableValuationRetainsKnownSubtotalAndExplicitZero() {
    let setBalance = entry("opening", "2026-01-01", "set", "18")
    let asset = Record(id: "x", type: "asset", version: 1, data: [:], deleted: false, updatedAt: "")
    let holding = Record(id: "holding", type: "walletEntry", version: 1, data: [
      "walletId": .string("b"), "assetId": .string("x"), "quantity": .string("-0.5"),
      "at": .string("2026-01-01T23:30:00+08:00"), "mode": .string("set"),
    ], deleted: false, updatedAt: "")
    let selection = TreasurySelection(wallets: ["a"], assets: ["x"])
    let withoutPrice = TreasuryRules.report(
      wallets: [wallet("a"), wallet("b")], assets: [asset], entries: [setBalance, holding],
      historyOf: selection)
    XCTAssertEqual(withoutPrice.selected?.known, 1)
    XCTAssertEqual(withoutPrice.selected?.unknown, 1)
    XCTAssertEqual(withoutPrice.selected?.value, 18)
    XCTAssertTrue(withoutPrice.history.allSatisfy { $0.value == nil })
    let withZeroPrice = TreasuryRules.report(
      wallets: [wallet("a"), wallet("b")], assets: [asset], entries: [setBalance, holding],
      live: ["x": 0], historyOf: selection)
    XCTAssertEqual(withZeroPrice.selected?.known, 2)
    XCTAssertEqual(withZeroPrice.selected?.unknown, 0)
    XCTAssertEqual(withZeroPrice.selected?.value, 18)
  }
  func testChartKeepsOpeningBalanceAndGapBetweenSampledExtremes() {
    let start = Date(timeIntervalSince1970: 0)
    let series = (0..<3_650).map { index in
      let value = index == 1_112 ? -505 : index == 1_177 ? 80_000 : index % 10
      return TreasuryPoint(id: String(index), at: start.addingTimeInterval(Double(index) * 3600 + 1),
                           amount: Double(value), unknownWallets: index == 1_150 ? 1 : 0)
    }
    let sampled = TreasuryRules.trend(series, from: start.addingTimeInterval(30 * 3600), maxPoints: 64)
    XCTAssertLessThanOrEqual(sampled.count, 64)
    XCTAssertEqual(sampled.first?.amount, 9)
    XCTAssertEqual(sampled.last?.id, "3649")
    XCTAssertTrue(sampled.contains { $0.id == "1112" && $0.amount == -505 })
    XCTAssertTrue(sampled.contains { $0.id == "1150" && $0.unknownWallets == 1 })
    XCTAssertTrue(sampled.contains { $0.id == "1177" && $0.amount == 80_000 })
  }

  private struct VectorRow: Decodable {
    let id: String
    let data: [String: JSONValue]
    let deleted: Bool?
    let version: Int?
    let updatedAt: String?
    func record(_ type: String) -> Record {
      Record(id: id, type: type, version: version ?? 1, data: data, deleted: deleted ?? false,
             updatedAt: updatedAt ?? "2026-02-01T00:00:00Z")
    }
  }
  private struct EntryChangeVectors: Decodable {
    struct Selection: Decodable {
      let wallets: Set<String>
      let assets: Set<String>
    }
    struct Vector: Decodable {
      let name: String
      let entries: [VectorRow]
      let prices: [VectorRow]?
      let until: String?
      let before: String?
      let historyOf: Selection?
      // [previous, delta, after], exact decimal strings shared with TypeScript.
      let expected: [String: [String?]]
      let balances: [String: String]?
      let holdings: [String: [String: String]]?
    }
    let wallets: [VectorRow]
    let assets: [VectorRow]
    let cases: [Vector]
  }

  func testEntryChangesMatchSharedExactDecimalVectors() throws {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let data = try Data(contentsOf: root.appendingPathComponent("modules/treasury/tests/entry-changes-vectors.json"))
    let vectors = try JSONDecoder().decode(EntryChangeVectors.self, from: data)
    func decimal(_ value: String) throws -> Decimal {
      try XCTUnwrap(Decimal(string: value, locale: Locale(identifier: "en_US_POSIX")), value)
    }
    for vector in vectors.cases {
      let report = TreasuryRules.report(
        wallets: vectors.wallets.map { $0.record("wallet") }, assets: vectors.assets.map { $0.record("asset") },
        entries: vector.entries.map { $0.record("walletEntry") }, prices: (vector.prices ?? []).map { $0.record("assetPrice") },
        until: vector.until,
        before: try vector.before.map { try XCTUnwrap(ISO8601DateFormatter().date(from: $0)) },
        historyOf: vector.historyOf.map { TreasurySelection(wallets: $0.wallets, assets: $0.assets) })
      var expected: [String: TreasuryEntryChange] = [:]
      for (id, values) in vector.expected {
        guard values.count == 3 else {
          XCTFail("\(vector.name): expected previous, delta and after for \(id)")
          continue
        }
        expected[id] = TreasuryEntryChange(
          delta: try values[1].map(decimal), previous: try values[0].map(decimal),
          after: try decimal(XCTUnwrap(values[2])))
      }
      XCTAssertEqual(report.entryChanges, expected, vector.name)
      for (id, quantity) in vector.balances ?? [:] {
        XCTAssertEqual(report.balances[id]?.quantity, try decimal(quantity), "\(vector.name): wallet \(id)")
      }
      for (asset, holdings) in vector.holdings ?? [:] {
        XCTAssertEqual(report.assets[asset]?.byWallet, try holdings.mapValues(decimal), "\(vector.name): asset \(asset)")
      }
    }
  }
}
