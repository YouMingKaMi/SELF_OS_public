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
public struct TreasuryEntryChange: Sendable, Equatable {
  /// Exact quantity delta; nil when a set establishes the first known balance.
  public let delta: Decimal?
  /// Balance before this entry; nil when not yet established.
  public let previous: Decimal?
  public let after: Decimal
}
public struct TreasuryReport: Sendable {
  /// Every wallet: 人民币 / 外部投资 carry a quantity; exchange / brokerage wallets only a value.
  public let balances: [String: TreasuryBalance]
  public let assets: [String: AssetTotal]
  public let entryChanges: [String: TreasuryEntryChange]
  public let points: [TreasuryPoint]
  public let total: Decimal?
  public let unknownWallets: Int
  public let history: [TreasuryHistoryPoint]
  public let selected: TreasuryValuation?
}

public struct TreasuryValuation: Sendable {
  public static let empty = TreasuryValuation()
  public internal(set) var value: Decimal = 0
  public internal(set) var known = 0
  public internal(set) var unknown = 0
}

public struct TreasuryHistoryPoint: Sendable {
  public let at: Date
  /// Value in yuan, or nil when the selected assets cannot yet be valued.
  public let value: Decimal?
}

public struct TreasurySelection: Sendable {
  public let wallets: Set<String>
  public let assets: Set<String>
  public init(wallets: Set<String>, assets: Set<String>) {
    self.wallets = wallets
    self.assets = assets
  }
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
    until: String? = nil, before: Date? = nil, now: Date? = nil, historyOf: TreasurySelection? = nil
  ) -> TreasuryReport {
    var plain: [String: Plain] = [:]
    var fixedWallets = Set<String>()
    for wallet in wallets where !wallet.deleted {
      let fixed = ["cny", "external"].contains(wallet.text("category"))
      if fixed { fixedWallets.insert(wallet.id) }
      plain[wallet.id] = Plain(
        price: fixed ? 1 : Decimal(string: wallet.text("unitPrice")),
        exchange: fixed || wallet.text("currency") == "CNY" ? 1 : Decimal(string: wallet.text("exchangeRate")))
    }
    var held: [String: [String: Decimal]] = [:]
    var quantities: [String: Decimal] = [:]
    var manual: [String: Decimal] = [:]
    var recorded: [String: Decimal] = [:]
    for asset in assets where !asset.deleted {
      held[asset.id] = [:]
      if let price = Decimal(string: asset.text("manualPrice")), !asset.text("manualPrice").isEmpty {
        manual[asset.id] = price
      }
    }

    func recordedPrice(_ id: String) -> Decimal? {
      recorded[id] ?? (historyOf == nil ? manual[id] : nil)
    }
    func assetValue(_ quantity: Decimal?, _ price: Decimal?) -> Decimal? {
      guard let quantity else { return nil }
      if quantity == 0 { return 0 }
      return price.map { quantity * $0 }
    }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let iso = ISO8601DateFormatter()
    func instant(_ text: String) -> Date? {
      fractional.date(from: text) ?? iso.date(from: text)
    }
    let last = until.flatMap(instant)
    // Resolve repeated snapshots before filtering so an old entry cannot survive its tombstone.
    let uniqueEntries = Dictionary(entries.map { ($0.id, $0) }, uniquingKeysWith: { current, row in
      if row.version != current.version { return row.version > current.version ? row : current }
      return row.updatedAt >= current.updatedAt ? row : current
    })
    let rows = (Array(uniqueEntries.values) + prices).compactMap { row -> (record: Record, at: Date)? in
      guard !row.deleted, let at = instant(row.text("at")),
            last.map({ at <= $0 }) ?? true, before.map({ at < $0 }) ?? true else { return nil }
      let asset = row.text("assetId")
      if row.type == "assetPrice" {
        guard held[asset] != nil else { return nil }
      } else {
        guard plain[row.text("walletId")] != nil, asset.isEmpty || held[asset] != nil else { return nil }
      }
      return (row, at)
    }.sorted { a, b in a.at == b.at ? a.record.id < b.record.id : a.at < b.at }

    var points: [TreasuryPoint] = []
    var history: [TreasuryHistoryPoint] = []
    var entryChanges: [String: TreasuryEntryChange] = [:]
    let decimalLocale = Locale(identifier: "en_US_POSIX")
    let quantityPattern = #/-?[0-9]{1,18}(?:\.[0-9]{1,12})?/#
    func entryQuantity(_ row: Record) -> Decimal? {
      let text = row.text("quantity").trimmingCharacters(in: .whitespacesAndNewlines)
      guard text.wholeMatch(of: quantityPattern) != nil else { return nil }
      return Decimal(string: text, locale: decimalLocale)
    }
    func change(_ row: Record, _ previous: Decimal?, _ quantity: Decimal) -> TreasuryEntryChange {
      if row.text("mode") == "set" {
        return TreasuryEntryChange(delta: previous.map { quantity - $0 }, previous: previous, after: quantity)
      }
      return TreasuryEntryChange(delta: quantity, previous: previous, after: (previous ?? 0) + quantity)
    }
    var activeWallets = Set<String>()
    var projection = TreasuryValuation(unknown: historyOf.map { $0.wallets.count + $0.assets.count } ?? 0)
    func replace(_ old: Decimal?, _ next: Decimal?) {
      projection.value += (next ?? 0) - (old ?? 0)
      let increment = (next == nil ? 0 : 1) - (old == nil ? 0 : 1)
      projection.known += increment
      projection.unknown -= increment
    }
    for (row, at) in rows {
      let assetId = row.text("assetId")
      let wallet = row.text("walletId")
      if !assetId.isEmpty {
        let previousQuantity = quantities[assetId]
        let old = assetValue(previousQuantity, recordedPrice(assetId))
        if row.type == "assetPrice" {
          if let price = Decimal(string: row.text("price")) { recorded[assetId] = price }
        } else {
          if let quantity = entryQuantity(row) {
            let result = change(row, held[assetId]![wallet], quantity)
            entryChanges[row.id] = result
            held[assetId]![wallet] = result.after
            quantities[assetId, default: 0] += result.delta ?? result.after
          }
          if let price = Decimal(string: row.text("unitPrice")) {
            let rate = Decimal(string: row.text("exchangeRate")) ?? 1
            recorded[assetId] = price * rate
          }
        }
        if historyOf == nil && previousQuantity == nil && quantities[assetId] != nil { projection.unknown += 1 }
        if historyOf?.assets.contains(assetId) ?? true {
          replace(old, assetValue(quantities[assetId], recordedPrice(assetId)))
        }
      } else {
        var state = plain[wallet]!
        let old = state.value
        if let quantity = entryQuantity(row) {
          if historyOf == nil && activeWallets.insert(wallet).inserted { projection.unknown += 1 }
          let result = change(row, state.quantity, quantity)
          entryChanges[row.id] = result
          state.quantity = result.after
        }
        if let price = Decimal(string: row.text("unitPrice")) { state.price = price }
        if let rate = Decimal(string: row.text("exchangeRate")) { state.exchange = rate }
        plain[wallet] = state
        if historyOf?.wallets.contains(wallet) ?? true { replace(old, state.value) }
      }
      if historyOf != nil {
        let value = projection.known > 0 && projection.unknown == 0 ? projection.value : nil
        history.append(TreasuryHistoryPoint(at: at, value: value))
      } else {
        points.append(TreasuryPoint(
          id: row.id, at: at, amount: NSDecimalNumber(decimal: projection.value).doubleValue,
          unknownWallets: max(projection.unknown, projection.known == 0 ? 1 : 0)))
      }
    }

    var unknown = 0
    var total = Decimal.zero
    var known = 0
    var activeUnknown = 0
    var selected = historyOf.map { TreasuryValuation(unknown: $0.wallets.count + $0.assets.count) }
    func addSelection(_ value: Decimal?) {
      guard let value else { return }
      selected?.value += value
      selected?.known += 1
      selected?.unknown -= 1
    }
    var totals: [String: AssetTotal] = [:]
    var walletAssets: [String: Decimal] = [:]
    var unpricedWalletAssets = Set<String>()
    for (assetId, byWallet) in held {
      let price = live[assetId] ?? recorded[assetId] ?? manual[assetId]
      let quantity = quantities[assetId]
      let value = assetValue(quantity, price)
      if let value { total += value; known += 1 }
      else if quantity != nil { unknown += 1; activeUnknown += 1 }
      if historyOf?.assets.contains(assetId) == true { addSelection(value) }
      totals[assetId] = AssetTotal(
        quantity: quantity ?? 0, price: price, live: live[assetId] != nil, value: value, byWallet: byWallet)
      for (walletId, amount) in byWallet {
        if let holding = assetValue(amount, price) { walletAssets[walletId, default: 0] += holding }
        else { unpricedWalletAssets.insert(walletId) }
      }
    }
    var balances: [String: TreasuryBalance] = [:]
    for (id, state) in plain {
      if let value = state.value { total += value; known += 1 }
      else if activeWallets.contains(id) || state.quantity != nil { unknown += 1; activeUnknown += 1 }
      else if fixedWallets.contains(id) { unknown += 1 }
      if historyOf?.wallets.contains(id) == true { addSelection(state.value) }
      if unpricedWalletAssets.contains(id) || (state.quantity != nil && state.value == nil) {
        balances[id] = TreasuryBalance(quantity: nil, value: nil)
      } else if let holdings = walletAssets[id] {
        balances[id] = TreasuryBalance(quantity: nil, value: (state.value ?? 0) + holdings)
      } else {
        balances[id] = TreasuryBalance(quantity: state.quantity, value: state.value)
      }
    }
    let current = NSDecimalNumber(decimal: total).doubleValue
    let partial = activeUnknown > 0 || known == 0
    if let now, before == nil, until == nil, let last = points.last, now >= last.at,
       last.amount != current || (last.unknownWallets > 0) != partial {
      points.append(TreasuryPoint(id: "now", at: now, amount: current,
                                  unknownWallets: max(activeUnknown, known == 0 ? 1 : 0)))
    }
    return TreasuryReport(
      balances: balances, assets: totals, entryChanges: entryChanges, points: points, total: known > 0 ? total : nil,
      unknownWallets: unknown, history: history, selected: selected)
  }

  /// Keep extrema inside the requested window and insert a marker for every skipped gap.
  public static func trend(_ points: [TreasuryPoint], from: Date?, maxPoints: Int = 400) -> [TreasuryPoint] {
    var visible: [TreasuryPoint] = []
    var preceding: TreasuryPoint?
    for point in points {
      if let from, point.at < from {
        preceding = point
        continue
      }
      if visible.isEmpty, let from, let preceding, point.at > from {
        visible.append(TreasuryPoint(id: "opening", at: from, amount: preceding.amount,
                                      unknownWallets: preceding.unknownWallets))
      }
      if visible.last?.at == point.at { visible[visible.count - 1] = point }
      else { visible.append(point) }
    }
    if visible.isEmpty, let from, let preceding {
      visible.append(TreasuryPoint(id: "opening", at: from, amount: preceding.amount,
                                    unknownWallets: preceding.unknownWallets))
    }
    let limit = max(7, maxPoints)
    guard visible.count > limit else { return visible }

    let count = (limit - 3) / 4
    var buckets = Array(repeating: (low: -1, high: -1), count: count)
    var indices: Set<Int> = [0, visible.count - 1]
    for (index, point) in visible.enumerated() where point.unknownWallets == 0 {
      let bucket = index * count / visible.count
      let low = buckets[bucket].low, high = buckets[bucket].high
      if low < 0 || point.amount < visible[low].amount { buckets[bucket].low = index }
      if high < 0 || point.amount > visible[high].amount { buckets[bucket].high = index }
    }
    for bucket in buckets {
      if bucket.low >= 0 { indices.insert(bucket.low) }
      if bucket.high >= 0 { indices.insert(bucket.high) }
    }
    var sampled: [TreasuryPoint] = []
    var previous: Int?
    for index in indices.sorted() {
      if let previous, visible[previous].unknownWallets == 0, visible[index].unknownWallets == 0,
         let gap = visible[(previous + 1)..<index].first(where: { $0.unknownWallets > 0 }) {
        sampled.append(gap)
      }
      sampled.append(visible[index])
      previous = index
    }
    return sampled
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
  public let timeSource: String?
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
