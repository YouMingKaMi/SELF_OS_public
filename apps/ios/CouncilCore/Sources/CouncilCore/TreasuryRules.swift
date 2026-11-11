import Foundation

public struct TreasuryPoint: Identifiable, Sendable {
  public let id: String
  public let at: Date
  public let amount: Double
  public let unknownWallets: Int
  public init(id: String, at: Date, amount: Double, unknownWallets: Int) {
    self.id = id
    self.at = at
    self.amount = amount
    self.unknownWallets = unknownWallets
  }
}
public struct TreasuryBalance: Sendable {
  public let quantity: Decimal?
  public let value: Decimal?
}
/// One asset across every wallet that holds it.
public struct AssetTotal: Sendable {
  public let quantity: Decimal
  /// CNY per unit: the live quote, else the last recorded price, else the manual price.
  public let price: Decimal?
  public let live: Bool
  public let value: Decimal?
  public let byWallet: [String: Decimal]
}
public struct TreasuryReport: Sendable {
  /// Every wallet: 人民币 / 外部投资 carry a quantity; exchange / brokerage wallets only a value.
  public let balances: [String: TreasuryBalance]
  public let assets: [String: AssetTotal]
  public let points: [TreasuryPoint]
  public let total: Decimal?
  public let unknownWallets: Int
}

/// Mirrors modules/treasury/domain/holdings.ts. Values are in yuan.
public enum TreasuryRules {
  private struct Plain {
    var quantity: Decimal?
    var price: Decimal?
    var exchange: Decimal?
    var value: Decimal? {
      guard let quantity, let price, let exchange else { return nil }
      return quantity * price * exchange
    }
  }
  public static func report(
    wallets: [Record], assets: [Record] = [], entries: [Record], prices: [Record] = [],
    live: [String: Decimal] = [:],
    until: String? = nil, now: Date? = nil
  ) -> TreasuryReport {
    var plain: [String: Plain] = [:]
    for wallet in wallets where !wallet.deleted {
      let fixed = ["cny", "external"].contains(wallet.text("category"))
      plain[wallet.id] = Plain(
        price: fixed ? 1 : Decimal(string: wallet.text("unitPrice")),
        exchange: fixed || wallet.text("currency") == "CNY" ? 1 : Decimal(string: wallet.text("exchangeRate")))
    }
    var held: [String: [String: Decimal]] = [:]
    var recorded: [String: Decimal] = [:]
    for asset in assets where !asset.deleted {
      held[asset.id] = [:]
      if let manual = Decimal(string: asset.text("manualPrice")), !asset.text("manualPrice").isEmpty {
        recorded[asset.id] = manual
      }
    }
    func totalNow(_ price: (String) -> Decimal?) -> Decimal {
      var sum = plain.values.compactMap(\.value).reduce(Decimal(), +)
      for (assetId, byWallet) in held {
        guard let p = price(assetId) else { continue }
        sum += byWallet.values.reduce(Decimal(), +) * p
      }
      return sum
    }
    // Observed prices (assetPrice) move the recorded price and add a chart point; holdings are untouched.
    let observed = prices.filter {
      !$0.deleted && held[$0.text("assetId")] != nil && (until == nil || $0.text("at") <= until!)
    }
    let rows = (entries.filter {
      !$0.deleted && plain[$0.text("walletId")] != nil && (until == nil || $0.text("at") <= until!)
        && ($0.text("assetId").isEmpty || held[$0.text("assetId")] != nil)
    } + observed).sorted {
      if $0.text("at") != $1.text("at") { return $0.text("at") < $1.text("at") }
      if $0.updatedAt != $1.updatedAt { return $0.updatedAt < $1.updatedAt }
      return $0.id < $1.id
    }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let iso = ISO8601DateFormatter()
    var points: [TreasuryPoint] = []
    for row in rows {
      guard let at = fractional.date(from: row.text("at")) ?? iso.date(from: row.text("at")) else { continue }
      if row.type == "assetPrice" {
        if let p = Decimal(string: row.text("price")) { recorded[row.text("assetId")] = p }
        points.append(
          TreasuryPoint(
            id: row.id, at: at, amount: NSDecimalNumber(decimal: totalNow { recorded[$0] }).doubleValue,
            unknownWallets: 0))
        continue
      }
      let quantity = Decimal(string: row.text("quantity"))
      let price = row.text("unitPrice").isEmpty ? nil : Decimal(string: row.text("unitPrice"))
      let rate = row.text("exchangeRate").isEmpty ? nil : Decimal(string: row.text("exchangeRate"))
      let assetId = row.text("assetId")
      if !assetId.isEmpty {
        let wallet = row.text("walletId")
        if let quantity {
          held[assetId]![wallet] = row.text("mode") == "set" ? quantity : (held[assetId]![wallet] ?? 0) + quantity
        }
        if let price { recorded[assetId] = price * (rate ?? 1) }
      } else {
        var state = plain[row.text("walletId")]!
        if let quantity {
          if row.text("mode") == "set" { state.quantity = quantity } else if let q = state.quantity { state.quantity = q + quantity }
        }
        if let price { state.price = price }
        if let rate { state.exchange = rate }
        plain[row.text("walletId")] = state
      }
      points.append(
        TreasuryPoint(
          id: row.id, at: at, amount: NSDecimalNumber(decimal: totalNow { recorded[$0] }).doubleValue,
          unknownWallets: 0))
    }
    func priceOf(_ assetId: String) -> (Decimal?, Bool) {
      if let p = live[assetId] { return (p, true) }
      return (recorded[assetId], false)
    }
    var unknown = 0
    var totals: [String: AssetTotal] = [:]
    for (assetId, byWallet) in held {
      let (price, isLive) = priceOf(assetId)
      let quantity = byWallet.values.reduce(Decimal(), +)
      let value = price.map { quantity * $0 }
      if value == nil && quantity != 0 { unknown += 1 }
      totals[assetId] = AssetTotal(quantity: quantity, price: price, live: isLive, value: value, byWallet: byWallet)
    }
    var balances: [String: TreasuryBalance] = [:]
    for (id, state) in plain {
      let holdings = held.filter { $0.value[id] != nil }
      if !holdings.isEmpty {
        var value: Decimal? = 0
        for (assetId, byWallet) in holdings {
          if let p = totals[assetId]?.price, let v = value { value = v + byWallet[id]! * p } else { value = nil }
        }
        balances[id] = TreasuryBalance(quantity: nil, value: value)
      } else {
        if state.value == nil && state.quantity != nil { unknown += 1 }
        balances[id] = TreasuryBalance(quantity: state.quantity, value: state.value)
      }
    }
    let total = totalNow { priceOf($0).0 }
    if let now, until == nil, let last = points.last, Decimal(last.amount) != total {
      points.append(TreasuryPoint(id: "now", at: now, amount: NSDecimalNumber(decimal: total).doubleValue, unknownWallets: unknown))
    }
    let anything = !plain.isEmpty || !held.isEmpty
    return TreasuryReport(
      balances: balances, assets: totals, points: points, total: anything ? total : nil, unknownWallets: unknown)
  }
}

/// Market data from the server (`GET /v1/quotes`). Never synchronised.
public struct Quote: Codable, Sendable {
  public let id: String
  public let name: String
  public let price: String
  public let currency: String
  public let priceCNY: String
  public let changePercent: Double?
  public let at: String
}
public struct QuoteMatch: Codable, Sendable, Identifiable, Hashable {
  public var id: String { quoteId }
  public let quoteId: String
  public let name: String
  public let symbol: String
  public let kind: String
  public let market: String
  public let currency: String
}
