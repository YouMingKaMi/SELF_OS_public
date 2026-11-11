import Charts
import CouncilCore
import SwiftUI

/// A display currency and how many yuan one unit is worth. Totals stay in yuan; one market shows its own currency.
struct MoneyUnit: Equatable {
  let currency: String
  let rate: Decimal
  static let cny = MoneyUnit(currency: "CNY", rate: 1)
  var sign: String { ["CNY": "¥", "USD": "$", "HKD": "HK$", "EUR": "€", "JPY": "JP¥", "GBP": "£"][currency] ?? currency + " " }
  var isYuan: Bool { currency == "CNY" }
}

extension Studio {
  func unit(of asset: Record) -> MoneyUnit {
    guard let q = quotes[asset.text("quoteId")], let price = Decimal(string: q.price), price > 0,
      let cny = Decimal(string: q.priceCNY)
    else { return .cny }
    return MoneyUnit(currency: q.currency, rate: cny / price)
  }
  /// Several assets share a currency only if every one is quoted in it.
  func unit(of assets: [Record]) -> MoneyUnit {
    let units = assets.map { unit(of: $0) }
    guard let first = units.first, units.allSatisfy({ $0.currency == first.currency }) else { return .cny }
    return first
  }
}

enum Yuan {
  /// Yuan shown in another currency.
  static func format(_ value: Decimal?, in unit: MoneyUnit) -> String {
    guard let value else { return "未知" }
    if unit.isYuan { return format(value) }
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.minimumFractionDigits = 2
    f.maximumFractionDigits = 2
    let n = value / unit.rate
    return (n < 0 ? "−" : "") + unit.sign + (f.string(from: NSDecimalNumber(decimal: abs(n))) ?? "")
  }
  /// Treasury values are in yuan with full precision; show cents.
  static func format(_ value: Decimal?) -> String { value.map { Money.format($0 * 100) } ?? "未知" }
  /// Plain decimal for editing (no grouping separators).
  static func plain(_ value: Decimal) -> String { NSDecimalNumber(decimal: value).stringValue }
  static func quantity(_ value: Decimal?) -> String {
    guard let value else { return "数量未知" }
    let n = NSDecimalNumber(decimal: value)
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.maximumFractionDigits = 8
    return f.string(from: n) ?? n.stringValue
  }
}

/// Exchange and brokerage wallets hold assets; 人民币 and 外部投资 wallets hold one balance.
func isAccount(_ wallet: Record) -> Bool { ["crypto", "stock"].contains(wallet.text("category")) }

struct TreasuryScreen: View {
  @Environment(Studio.self) private var studio
  @State private var range = 90
  @State private var sheet: TreasurySheet?
  @State private var refreshing = false
  @State private var refreshed: String?
  var body: some View {
    let wallets = studio.all("wallet")
    let assets = studio.all("asset").sorted { ($0.number("order"), $0.title) < ($1.number("order"), $1.title) }
    let report = studio.treasuryReport()
    let total = report.total ?? 0
    let share: (Decimal) -> Double = { total > 0 ? NSDecimalNumber(decimal: $0 / total).doubleValue : 0 }
    Page {
      ValueHero(title: "全部资产", report: report, range: $range, note: studio.quotesLive ? "实时行情" : nil)
      ForEach([("cny", "人民币", "yensign.circle"), ("external", "外部投资", "briefcase")], id: \.0) { kind in
        let list = wallets.filter { $0.text("category") == kind.0 }
        let sum = list.compactMap { report.balances[$0.id]?.value }.reduce(Decimal(), +)
        if !list.isEmpty {
          Card(icon: kind.2, title: kind.1, meta: String(format: "%.1f%%", share(sum) * 100)) {
            Text(Yuan.format(sum)).font(Ink.figureMid).monospacedDigit().foregroundStyle(Ink.text)
            Meter(value: share(sum), height: 3)
            RowList(items: list) { wallet in
              NavigationLink { WalletScreen(walletId: wallet.id) } label: {
                TreasuryRow(
                  title: wallet.title,
                  detail: studio.all("walletEntry").filter { $0.text("walletId") == wallet.id }.map { $0.text("at") }.max()
                    .flatMap { Clock.parse($0) }.map { $0.formatted(.dateTime.month().day()) + " 更新" } ?? "还没有记录",
                  value: report.balances[wallet.id]?.value)
              }.buttonStyle(.row)
            }
          }
        }
      }
      ForEach([("crypto", "加密资产", "bitcoinsign.circle"), ("stock", "股票", "chart.line.uptrend.xyaxis")], id: \.0) { kind in
        let list = assets.filter { $0.text("kind") == kind.0 }
        let sum = list.compactMap { report.assets[$0.id]?.value }.reduce(Decimal(), +)
        let unit = studio.unit(of: list)
        Card(icon: kind.2, title: kind.1, meta: list.isEmpty ? nil : String(format: "%.1f%%", share(sum) * 100)) {
          if list.isEmpty {
            Button { sheet = .search(kind.0) } label: {
              Label("添加第一个标的", systemImage: "plus").font(Ink.meta).foregroundStyle(Ink.text2)
            }.buttonStyle(.plain)
          } else {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
              Text(Yuan.format(sum, in: unit)).font(Ink.figureMid).monospacedDigit().foregroundStyle(Ink.text)
              if !unit.isYuan { Text("≈ " + Yuan.format(sum)).font(.system(size: 13)).monospacedDigit().foregroundStyle(Ink.text3) }
            }
            Meter(value: share(sum), height: 3)
            RowList(items: list) { asset in
              NavigationLink { AssetScreen(assetId: asset.id) } label: {
                AssetRow(
                  asset: asset, total: report.assets[asset.id], quote: studio.quotes[asset.text("quoteId")],
                  unit: studio.unit(of: asset), wallets: report.assets[asset.id]?.byWallet.count ?? 0)
              }.buttonStyle(.row)
            }
          }
        }.id(kind.0)
      }
      let accounts = wallets.filter(isAccount)
      Card(icon: "wallet.bifold", title: "钱包与账户", meta: accounts.isEmpty ? nil : "\(accounts.count)") {
        RowList(items: accounts) { wallet in
          NavigationLink { AccountScreen(walletId: wallet.id) } label: {
            TreasuryRow(
              title: wallet.title,
              detail: assets.filter { report.assets[$0.id]?.byWallet[wallet.id] != nil }
                .map { $0.text("symbol").contains { $0.isLetter } ? $0.text("symbol") : $0.title }.joined(separator: " · ")
                .ifEmpty("暂无持仓"),
              value: report.balances[wallet.id]?.value,
              unit: studio.unit(of: assets.filter { report.assets[$0.id]?.byWallet[wallet.id] != nil }))
          }.buttonStyle(.row)
        }
        Button { sheet = .account(nil) } label: {
          Label("添加交易所 / 钱包 / 券商", systemImage: "plus").font(Ink.meta).foregroundStyle(Ink.text2)
        }.buttonStyle(.plain).padding(.top, accounts.isEmpty ? 0 : 6)
      }
      Text("加密与股票以标的为主体，数量是所有钱包的合计；估值变化含价格与汇率，不等同投资收益。")
        .font(.system(size: 12)).foregroundStyle(Ink.text3).padding(.horizontal, 6)
    }
    .studioScreen("国库")
    .refreshable { await studio.refreshQuotes() }
    .task(id: studio.revision("asset")) {
      while !Task.isCancelled {
        await studio.refreshQuotes()
        try? await Task.sleep(for: .seconds(60))
      }
    }
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          Task {
            refreshing = true
            let n = await studio.recordPrices()
            refreshed = n > 0 ? "已记录 \(n) 个标的的最新价格" : "行情暂时取不到，稍后再试"
            refreshing = false
          }
        } label: {
          Image(systemName: "arrow.clockwise").rotationEffect(.degrees(refreshing ? 360 : 0))
            .animation(refreshing ? .linear(duration: 0.8).repeatForever(autoreverses: false) : .default, value: refreshing)
        }.disabled(refreshing).accessibilityLabel("刷新行情并记录价格")
      }
      ToolbarItem(placement: .topBarTrailing) {
      Menu {
        Button("添加股票", systemImage: "chart.line.uptrend.xyaxis") { sheet = .search("stock") }
        Button("添加加密货币", systemImage: "bitcoinsign.circle") { sheet = .search("crypto") }
        Button("添加交易所 / 钱包 / 券商", systemImage: "wallet.bifold") { sheet = .account(nil) }
        Button("添加人民币钱包", systemImage: "yensign.circle") { sheet = .plain }
      } label: {
        Image(systemName: "plus")
      }.accessibilityLabel("添加")
      }
    }
    .alert(refreshed ?? "", isPresented: Binding(get: { refreshed != nil }, set: { if !$0 { refreshed = nil } })) {
      Button("好", role: .cancel) {}
    }
    .sheet(item: $sheet) { $0.view }
  }
}

enum TreasurySheet: Identifiable {
  case search(String), account(Record?), plain, holding(walletId: String?, assetId: String?)
  var id: String {
    switch self {
    case .search(let k): "search-" + k
    case .account(let r): "account-" + (r?.id ?? "new")
    case .plain: "plain"
    case .holding(let w, let a): "holding-\(w ?? "")-\(a ?? "")"
    }
  }
  @MainActor @ViewBuilder var view: some View {
    switch self {
    case .search(let kind): AssetSearchSheet(kind: kind)
    case .account(let record):
      EntityFormSheet(
        form: record.map { EntityForm(type: "wallet", record: $0, fields: ["name", "category"]) }
          ?? EntityForm(
            type: "wallet", defaults: ["category": .string("crypto"), "currency": .string("CNY")],
            fields: ["name", "category"]))
    case .plain:
      EntityFormSheet(
        form: EntityForm(
          type: "wallet",
          defaults: ["category": .string("cny"), "currency": .string("CNY"), "asset": .string("人民币")],
          fields: ["name", "category"]))
    case .holding(let walletId, let assetId): HoldingSheet(walletId: walletId, assetId: assetId)
    }
  }
}

struct RowList<Item: Identifiable, Row: View>: View {
  let items: [Item]
  @ViewBuilder let row: (Item) -> Row
  var body: some View {
    VStack(spacing: 0) {
      ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
        if index > 0 { Hairline() }
        row(item)
      }
    }
  }
}

struct TreasuryRow: View {
  let title: String
  let detail: String
  let value: Decimal?
  var unit: MoneyUnit = .cny
  var body: some View {
    HStack {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(Ink.row).foregroundStyle(Ink.text)
        Text(detail).font(.system(size: 12)).monospacedDigit().foregroundStyle(Ink.text3)
      }
      Spacer()
      Text(Yuan.format(value, in: unit)).font(.system(size: 15, weight: .semibold, design: .rounded)).monospacedDigit()
        .foregroundStyle(value == nil ? Ink.text3 : Ink.text)
      Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Ink.text3)
    }.padding(.vertical, 10)
  }
}

struct AssetRow: View {
  let asset: Record
  let total: AssetTotal?
  let quote: Quote?
  var unit: MoneyUnit = .cny
  var wallets = 0
  var body: some View {
    HStack(spacing: 12) {
      // Letters read well as a badge (BTC, NVDA); numeric codes (01810) do not, so use the name.
      let symbol = asset.text("symbol")
      Text(symbol.contains { $0.isLetter } ? String(symbol.prefix(4)) : String(asset.title.prefix(2)))
        .font(.system(size: 10, weight: .bold, design: .rounded)).foregroundStyle(Ink.text)
        .frame(width: 38, height: 38).background(Ink.raised, in: Circle())
      VStack(alignment: .leading, spacing: 2) {
        Text(asset.title).font(Ink.row).foregroundStyle(Ink.text).lineLimit(1)
        HStack(spacing: 6) {
          Text(Yuan.quantity(total?.quantity) + " " + asset.text("symbol") + (wallets > 1 ? " · \(wallets) 个钱包" : ""))
          if let change = quote?.changePercent {
            Text((change >= 0 ? "+" : "") + String(format: "%.2f%%", change))
              .foregroundStyle(change >= 0 ? Ink.live : Ink.danger)
          }
        }.font(.system(size: 12)).monospacedDigit().foregroundStyle(Ink.text3)
      }
      Spacer()
      Text(Yuan.format(total?.value, in: unit)).font(.system(size: 15, weight: .semibold, design: .rounded)).monospacedDigit()
        .foregroundStyle(total?.value == nil ? Ink.text3 : Ink.text)
      Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Ink.text3)
    }.padding(.vertical, 9)
  }
}

/// One asset: its total, live price, and which wallets hold how much.
struct AssetScreen: View {
  @Environment(Studio.self) private var studio
  let assetId: String
  @State private var range = 90
  @State private var sheet: TreasurySheet?
  @State private var form: EntityForm?
  var body: some View {
    let asset = studio.record(assetId, in: "asset")
    let entries = studio.all("walletEntry").filter { $0.text("assetId") == assetId }
    let scoped = studio.treasuryReport(assets: asset.map { [$0] } ?? [], entries: entries)
    let total = scoped.assets[assetId]
    let quote = asset.flatMap { studio.quotes[$0.text("quoteId")] }
    let wallets = studio.all("wallet")
    let holders = (total?.byWallet ?? [:]).sorted { $0.value > $1.value }
    let others = wallets.filter { isAccount($0) && total?.byWallet[$0.id] == nil }
    List {
      Section {
        ValueHero(
          title: asset?.title ?? "标的", report: scoped, range: $range, note: total?.live == true ? "实时行情" : "最近价格",
          unit: asset.map { studio.unit(of: $0) } ?? .cny)
          .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
      }
      Section {
        StatRow(items: [
          ("总数量", Yuan.quantity(total?.quantity)),
          ("现价", quote.map { MoneyUnit(currency: $0.currency, rate: 1).sign + trimmed($0.price) } ?? total?.price.map { "¥" + trimmed("\($0)") } ?? "未知"),
          ("涨跌", quote?.changePercent.map { ($0 >= 0 ? "+" : "") + String(format: "%.2f%%", $0) } ?? "—"),
        ]).cardRow()
      }
      Section {
        ForEach(holders, id: \.key) { walletId, quantity in
          let part = (total?.quantity ?? 0) > 0 ? NSDecimalNumber(decimal: quantity / total!.quantity).doubleValue : 0
          Button { sheet = .holding(walletId: walletId, assetId: assetId) } label: {
            VStack(alignment: .leading, spacing: 7) {
              HStack {
                Text(wallets.first { $0.id == walletId }?.title ?? "已删除钱包").font(Ink.row).foregroundStyle(Ink.text)
                Spacer()
                Text(Yuan.format(total?.price.map { quantity * $0 }, in: asset.map { studio.unit(of: $0) } ?? .cny))
                  .font(.system(size: 15, weight: .semibold, design: .rounded))
                  .monospacedDigit().foregroundStyle(Ink.text)
              }
              Meter(value: part, height: 3)
              Text(Yuan.quantity(quantity) + " " + (asset?.text("symbol") ?? "") + String(format: " · %.1f%%", part * 100))
                .font(.system(size: 12)).monospacedDigit().foregroundStyle(Ink.text3)
            }
          }.buttonStyle(.plain).cardRow()
        }
        if !others.isEmpty || holders.isEmpty {
          Menu {
            ForEach(others) { wallet in Button(wallet.title) { sheet = .holding(walletId: wallet.id, assetId: assetId) } }
            Button("新的交易所 / 钱包…", systemImage: "plus") { sheet = .account(nil) }
          } label: {
            Label("在钱包中添加", systemImage: "plus").font(Ink.meta).foregroundStyle(Ink.text2)
          }.cardRow()
        }
      } header: {
        Text("来自哪些钱包").font(.system(size: 13, weight: .semibold)).foregroundStyle(Ink.text2).textCase(nil)
      }
      FlowSection(entries: entries, label: { entry in wallets.first { $0.id == entry.text("walletId") }?.title ?? "钱包" }) {
        sheet = .holding(walletId: $0.text("walletId"), assetId: assetId)
      }
    }
    .studioList()
    .studioScreen(asset?.title ?? "标的")
    .toolbar {
      Button {
        if let asset { form = EntityForm(type: "asset", record: asset, fields: ["name", "symbol", "manualPrice"]) }
      } label: {
        Image(systemName: "slider.horizontal.3")
      }.accessibilityLabel("编辑标的")
    }
    .sheet(item: $sheet) { $0.view }
    .sheet(item: $form) { EntityFormSheet(form: $0) }
  }
  func trimmed(_ value: String) -> String {
    guard let d = Decimal(string: value) else { return value }
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.maximumFractionDigits = d < 1 ? 6 : 2
    return f.string(from: NSDecimalNumber(decimal: d)) ?? value
  }
}

/// One exchange / brokerage wallet and what it holds.
struct AccountScreen: View {
  @Environment(Studio.self) private var studio
  let walletId: String
  @State private var range = 90
  @State private var sheet: TreasurySheet?
  var body: some View {
    let wallet = studio.record(walletId, in: "wallet")
    let entries = studio.all("walletEntry").filter { $0.text("walletId") == walletId }
    let scoped = studio.treasuryReport(wallets: wallet.map { [$0] } ?? [], entries: entries)
    let assets = studio.all("asset").filter { scoped.assets[$0.id]?.byWallet[walletId] != nil }
    List {
      Section {
        ValueHero(title: wallet?.title ?? "账户", report: scoped, range: $range, unit: studio.unit(of: assets))
          .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
      }
      Section {
        ForEach(assets) { asset in
          let quantity = scoped.assets[asset.id]?.byWallet[walletId] ?? 0
          Button { sheet = .holding(walletId: walletId, assetId: asset.id) } label: {
            TreasuryRow(
              title: asset.title, detail: Yuan.quantity(quantity) + " " + asset.text("symbol"),
              value: scoped.assets[asset.id]?.price.map { quantity * $0 }, unit: studio.unit(of: asset))
          }.buttonStyle(.plain).cardRow()
        }
        Button { sheet = .holding(walletId: walletId, assetId: nil) } label: {
          Label("设定一个标的的数量", systemImage: "plus").font(Ink.meta).foregroundStyle(Ink.text2)
        }.buttonStyle(.plain).cardRow()
      } header: {
        Text("持仓 · 点一项可调整").font(.system(size: 13, weight: .semibold)).foregroundStyle(Ink.text2).textCase(nil)
      }
      FlowSection(entries: entries, label: { studio.record($0.text("assetId"), in: "asset")?.title ?? "标的" }) {
        let asset = $0.text("assetId")
        sheet = .holding(walletId: walletId, assetId: asset.isEmpty ? nil : asset)
      }
    }
    .studioList()
    .studioScreen(wallet?.title ?? "账户")
    .toolbar {
      Button {
        if let wallet { sheet = .account(wallet) }
      } label: {
        Image(systemName: "slider.horizontal.3")
      }.accessibilityLabel("编辑账户")
    }
    .sheet(item: $sheet) { $0.view }
  }
}

struct FlowSection: View {
  @Environment(Studio.self) private var studio
  let entries: [Record]
  let label: (Record) -> String
  let open: (Record) -> Void
  var body: some View {
    Section {
      ForEach(entries.sorted { $0.text("at") > $1.text("at") }.prefix(100)) { entry in
        let set = entry.text("mode") == "set"
        let negative = entry.text("quantity").hasPrefix("-")
        HStack {
          VStack(alignment: .leading, spacing: 3) {
            Text(label(entry) + (entry.text("reason").isEmpty ? "" : " · " + entry.text("reason"))).font(Ink.row)
              .foregroundStyle(Ink.text).lineLimit(1)
            Text(Clock.parse(entry.text("at"))?.formatted(.dateTime.year().month().day().hour().minute()) ?? "")
              .font(.system(size: 12)).foregroundStyle(Ink.text3)
          }
          Spacer()
          Text((set ? "= " : negative ? "" : "+") + entry.text("quantity"))
            .font(.system(size: 15, weight: .semibold, design: .rounded)).monospacedDigit()
            .foregroundStyle(set ? Ink.text : negative ? Ink.danger : Ink.live)
        }.contentShape(Rectangle()).onTapGesture { open(entry) }.cardRow()
          .swipeActions {
            Button("删除", systemImage: "trash", role: .destructive) { Task { await studio.remove(entry) } }
          }
      }
      if entries.isEmpty { Text("还没有记录").font(Ink.meta).foregroundStyle(Ink.text3).cardRow() }
    } header: {
      Text("流水").font(.system(size: 13, weight: .semibold)).foregroundStyle(Ink.text2).textCase(nil)
    }
  }
}

/// Set or move one asset's quantity in one wallet. The current CNY price is recorded with it.
struct HoldingSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  @State var walletId: String?
  @State var assetId: String?
  @State private var mode = "set"
  @State private var quantity = ""
  @State private var reason = ""
  @State private var at = Date()
  @FocusState private var focused: Bool
  var valid: Bool {
    walletId != nil && assetId != nil
      && quantity.range(of: #"^-?[0-9]+(\.[0-9]{1,12})?$"#, options: .regularExpression) != nil
  }
  var body: some View {
    let accounts = studio.all("wallet").filter(isAccount)
    let assets = studio.all("asset")
    let report = studio.treasuryReport()
    let current = assetId.flatMap { a in walletId.flatMap { report.assets[a]?.byWallet[$0] } }
    NavigationStack {
      Form {
        Section {
          Picker("钱包", selection: $walletId) {
            Text("选择").tag(String?.none)
            ForEach(accounts) { Text($0.title).tag(Optional($0.id)) }
          }
          Picker("标的", selection: $assetId) {
            Text("选择").tag(String?.none)
            ForEach(assets) { Text($0.title + " " + $0.text("symbol")).tag(Optional($0.id)) }
          }
        }.listRowBackground(Ink.raised)
        Section {
          Picker("方式", selection: $mode) {
            Text("设定数量").tag("set")
            Text("增加 / 减少").tag("delta")
          }.pickerStyle(.segmented).listRowBackground(Color.clear).listRowInsets(EdgeInsets())
          TextField(mode == "set" ? "现在持有多少" : "+ 买入，- 卖出", text: $quantity)
            .font(.system(size: 34, weight: .semibold, design: .rounded)).monospacedDigit()
            .keyboardType(.numbersAndPunctuation).focused($focused)
          if let current { Text("当前 " + Yuan.quantity(current)).font(.system(size: 12)).foregroundStyle(Ink.text3) }
          TextField("说明（可选）", text: $reason)
          DatePicker("发生时间", selection: $at)
        }.listRowBackground(Ink.raised)
      }
      .scrollContentBackground(.hidden).background(Ink.card)
      .environment(\.locale, Locale(identifier: "zh_CN"))
      .navigationTitle("持仓").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") {
            guard let walletId, let assetId else { return }
            var data: [String: JSONValue] = [
              "walletId": .string(walletId), "assetId": .string(assetId), "mode": .string(mode),
              "quantity": .string(quantity), "at": .string(ISO8601DateFormatter().string(from: at)),
            ]
            if !reason.isEmpty { data["reason"] = .string(reason) }
            // The price of the moment keeps history valued even without live data later.
            if let price = report.assets[assetId]?.price {
              data["unitPrice"] = .string(NSDecimalNumber(decimal: price).stringValue)
              data["exchangeRate"] = .string("1")
            }
            Task { if await studio.save("walletEntry", data) != nil { dismiss() } }
          }.fontWeight(.semibold).disabled(!valid)
        }
      }
    }.studioSheet().presentationDetents([.large])
      .onAppear {
        if let current { quantity = Yuan.plain(current) }
        focused = walletId != nil && assetId != nil
      }
  }
}

/// Search the market and add an asset; or add one by hand with a manual price.
struct AssetSearchSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  @State var kind: String
  @State private var query = ""
  @State private var results: [QuoteMatch]?
  @State private var error: String?
  @State private var busy = false
  var body: some View {
    let existing = Set(studio.all("asset").map { $0.text("quoteId") })
    NavigationStack {
      List {
        Section {
          Picker("类型", selection: $kind) {
            Text("股票 / 基金").tag("stock")
            Text("加密货币").tag("crypto")
          }.pickerStyle(.segmented).listRowBackground(Color.clear).listRowInsets(EdgeInsets())
          HStack {
            TextField(kind == "stock" ? "英伟达、NVDA、CRCL、小米、00700" : "Bitcoin、ETH、SOL", text: $query)
              .textInputAutocapitalization(.never).autocorrectionDisabled().onSubmit(search)
            Button(busy ? "…" : "搜索", action: search).disabled(busy || query.trimmingCharacters(in: .whitespaces).isEmpty)
          }.listRowBackground(Ink.raised)
          if let error { Text(error).font(.system(size: 12)).foregroundStyle(Ink.amber).listRowBackground(Color.clear) }
        }
        if let results {
          Section {
            ForEach(results) { match in
              let added = existing.contains(match.quoteId)
              Button {
                Task {
                  _ = await studio.save(
                    "asset",
                    [
                      "name": .string(match.name), "symbol": .string(match.symbol), "kind": .string(match.kind),
                      "quoteId": .string(match.quoteId), "currency": .string(match.currency),
                      "order": .number(Double(studio.all("asset").count)),
                    ])
                  await studio.refreshQuotes()
                  dismiss()
                }
              } label: {
                HStack {
                  VStack(alignment: .leading, spacing: 2) {
                    Text(match.name).font(Ink.row).foregroundStyle(Ink.text)
                    Text("\(match.symbol) · \(match.market) · \(match.currency)").font(.system(size: 12)).foregroundStyle(Ink.text3)
                  }
                  Spacer()
                  Image(systemName: added ? "checkmark" : "plus.circle.fill").foregroundStyle(added ? Ink.text3 : Ink.text)
                }
              }.disabled(added).listRowBackground(Ink.raised)
            }
            if results.isEmpty { Text("没有找到，换个写法试试").foregroundStyle(Ink.text3).listRowBackground(Ink.raised) }
          } header: { Text("结果") }
        }
        if !query.trimmingCharacters(in: .whitespaces).isEmpty {
          Section {
            Button("手动添加「\(query.trimmingCharacters(in: .whitespaces))」，自己填价格") {
              Task {
                _ = await studio.save(
                  "asset", ["name": .string(query.trimmingCharacters(in: .whitespaces)), "kind": .string(kind)])
                dismiss()
              }
            }.foregroundStyle(Ink.text2).listRowBackground(Ink.raised)
          }
        }
      }
      .scrollContentBackground(.hidden).background(Ink.card)
      .navigationTitle("添加标的").navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
      .onChange(of: kind) { results = nil }
    }.studioSheet()
  }
  func search() {
    let q = query.trimmingCharacters(in: .whitespaces)
    guard !q.isEmpty else { return }
    busy = true
    error = nil
    Task {
      do { results = try await studio.searchQuotes(q, kind: kind) } catch {
        self.error = "行情服务暂时不可用，可以先手动添加。"
      }
      busy = false
    }
  }
}

/// Valuation hero: the number, how it moved, and the line — in one card.
struct ValueHero: View {
  let title: String
  let report: TreasuryReport
  @Binding var range: Int
  var note: String? = nil
  var unit: MoneyUnit = .cny
  var body: some View {
    let from = range == 0 ? Date.distantPast : Date().addingTimeInterval(-Double(range) * 86400)
    // One point per moment; balances move in steps, so draw steps.
    var seen = Set<Date>()
    let rate = NSDecimalNumber(decimal: unit.rate).doubleValue
    let points = report.points.filter { $0.at >= from }.reversed().filter { seen.insert($0.at).inserted }.reversed()
      .map { TreasuryPoint(id: $0.id, at: $0.at, amount: $0.amount / rate, unknownWallets: $0.unknownWallets) }
    let change = (points.last?.amount ?? 0) - (points.first?.amount ?? 0)
    Card {
      VStack(alignment: .leading, spacing: 4) {
        Text(title + (unit.isYuan ? " · 折合人民币" : " · 以\(unit.currency)计价") + (note.map { " · " + $0 } ?? ""))
          .font(Ink.meta).foregroundStyle(Ink.text3)
        Text(Yuan.format(report.total, in: unit)).font(Ink.figure).monospacedDigit().foregroundStyle(Ink.text)
          .lineLimit(1).minimumScaleFactor(0.5)
        if !unit.isYuan {
          Text("≈ " + Yuan.format(report.total)).font(.system(size: 13)).monospacedDigit().foregroundStyle(Ink.text3)
        }
        HStack(spacing: 6) {
          if points.count > 1 {
            Text((change >= 0 ? "+" : "−") + Yuan.format(Decimal(abs(change)) * unit.rate, in: unit))
              .foregroundStyle(change >= 0 ? Ink.live : Ink.danger)
            Text(range == 0 ? "全部时间" : "近 \(range) 天").foregroundStyle(Ink.text3)
          }
          if report.unknownWallets > 0 {
            Text("· \(report.unknownWallets) 项估值未知").foregroundStyle(Ink.text3)
          }
        }.font(.system(size: 13, weight: .medium)).monospacedDigit()
      }
      if points.count > 1 {
        Chart(points) { p in
          LineMark(x: .value("时间", p.at), y: .value("估值", p.amount))
            .foregroundStyle(Ink.text).lineStyle(StrokeStyle(lineWidth: 2)).interpolationMethod(.stepEnd)
          if p.id == points.last?.id {
            PointMark(x: .value("时间", p.at), y: .value("估值", p.amount)).foregroundStyle(Ink.text).symbolSize(36)
          }
        }
        .chartYScale(domain: .automatic(includesZero: false))
        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) { AxisValueLabel(format: .dateTime.month().day()).foregroundStyle(Ink.text3) } }
        .chartYAxis { AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { AxisGridLine().foregroundStyle(Ink.line); AxisValueLabel().foregroundStyle(Ink.text3) } }
        .frame(height: 150)
      }
      HStack(spacing: 6) {
        ForEach([(30, "30天"), (90, "90天"), (365, "一年"), (0, "全部")], id: \.0) { option in
          Chip(text: option.1, selected: range == option.0) { withAnimation(.snappy) { range = option.0 } }
        }
      }
    }
  }
}

struct WalletScreen: View {
  @Environment(Studio.self) private var studio
  let walletId: String
  @State private var range = 90
  @State private var adding = false
  @State private var correcting: Record?
  @State private var form: EntityForm?
  var body: some View {
    let wallet = studio.record(walletId, in: "wallet")
    let entries = studio.all("walletEntry").filter { $0.text("walletId") == walletId }
    let report = TreasuryRules.report(wallets: wallet.map { [$0] } ?? [], entries: entries)
    List {
      Section {
        ValueHero(title: wallet?.title ?? "", report: report, range: $range)
          .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
      }
      Section {
        StatRow(items: [
          ("数量", Yuan.quantity(report.balances[walletId]?.quantity)),
          ("单价", wallet?.text("unitPrice", "—").ifEmpty("—") ?? "—"),
          ("汇率", wallet?.text("exchangeRate", "—").ifEmpty("—") ?? "—"),
        ]).cardRow()
      }
      Section {
        ForEach(entries.sorted { $0.text("at") > $1.text("at") }) { entry in
          let set = entry.text("mode") == "set"
          let negative = entry.text("quantity").hasPrefix("-")
          HStack {
            VStack(alignment: .leading, spacing: 3) {
              Text(entry.text("reason").ifEmpty(set ? "设余额" : "增减")).font(Ink.row).foregroundStyle(Ink.text)
              Text(Clock.parse(entry.text("at"))?.formatted(.dateTime.year().month().day().hour().minute()) ?? "")
                .font(.system(size: 12)).foregroundStyle(Ink.text3)
            }
            Spacer()
            Text((set ? "= " : negative ? "" : "+") + entry.text("quantity"))
              .font(.system(size: 15, weight: .semibold, design: .rounded)).monospacedDigit()
              .foregroundStyle(set ? Ink.text : negative ? Ink.danger : Ink.live)
          }.contentShape(Rectangle()).onTapGesture { correcting = entry }.cardRow()
            .swipeActions {
              Button("删除", systemImage: "trash", role: .destructive) { Task { await studio.remove(entry) } }
            }
        }
        if entries.isEmpty { Text("还没有记录变化").font(Ink.meta).foregroundStyle(Ink.text3).cardRow() }
      } header: {
        Text("流水 · 点一条可纠正").font(.system(size: 13, weight: .semibold)).foregroundStyle(Ink.text2).textCase(nil)
      }
    }
    .studioList()
    .studioScreen(wallet?.title ?? "账户")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          if let wallet { form = EntityForm(type: "wallet", record: wallet) }
        } label: {
          Image(systemName: "slider.horizontal.3")
        }.accessibilityLabel("编辑账户")
      }
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          adding = true
        } label: {
          Image(systemName: "plus")
        }.accessibilityLabel("记录变化")
      }
    }
    .sheet(isPresented: $adding) { EntrySheet(walletId: walletId, entry: nil, first: entries.isEmpty) }
    .sheet(item: $correcting) { EntrySheet(walletId: walletId, entry: $0, first: false) }
    .sheet(item: $form) { EntityFormSheet(form: $0) }
  }
}

struct EntrySheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let walletId: String
  let entry: Record?
  let first: Bool
  @State private var mode = "delta"
  @State private var quantity = ""
  @State private var reason = ""
  @State private var at = Date()
  @FocusState private var focused: Bool
  var valid: Bool {
    quantity.range(of: #"^-?[0-9]+(\.[0-9]{1,12})?$"#, options: .regularExpression) != nil
  }
  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: 18) {
        Picker("方式", selection: $mode) {
          Text("增加 / 减少").tag("delta")
          Text("设为余额").tag("set")
        }.pickerStyle(.segmented)
        TextField(mode == "set" ? "现在的余额" : "+ 增加，- 减少", text: $quantity)
          .font(.system(size: 44, weight: .semibold, design: .rounded)).monospacedDigit()
          .keyboardType(.numbersAndPunctuation).focused($focused)
        TextField("说明（可选）", text: $reason).padding(14)
          .background(Ink.raised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        DatePicker("发生时间", selection: $at)
        Spacer()
      }.padding(20).background(Ink.card)
        .environment(\.locale, Locale(identifier: "zh_CN"))
        .navigationTitle(entry == nil ? "记录变化" : "纠正").navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
          ToolbarItem(placement: .confirmationAction) {
            Button("保存") {
              var data: [String: JSONValue] = entry?.data ?? [:]
              data["walletId"] = .string(walletId)
              data["mode"] = .string(mode)
              data["quantity"] = .string(quantity)
              data["at"] = .string(ISO8601DateFormatter().string(from: at))
              data["reason"] = reason.isEmpty ? nil : .string(reason)
              Task { if await studio.save("walletEntry", data, id: entry?.id) != nil { dismiss() } }
            }.fontWeight(.semibold).disabled(!valid)
          }
        }
    }.studioSheet().presentationDetents([.medium])
      .onAppear {
        mode = first ? "set" : "delta"
        focused = true
        guard let entry else { return }
        mode = entry.text("mode")
        quantity = entry.text("quantity")
        reason = entry.text("reason")
        at = Clock.parse(entry.text("at")) ?? Date()
      }
  }
}
