import Charts
import CouncilCore
import SwiftUI

struct FreedomScreen: View {
  @Environment(Studio.self) private var studio
  @AppStorage("freedom-basis") private var basis = "current"
  @AppStorage("freedom-birthday") private var birthday = ""
  @AppStorage("freedom-since") private var since = ""
  @AppStorage("freedom-start") private var start = ""
  @AppStorage("freedom-age") private var age = 80
  @AppStorage("freedom-roles") private var rolesData = "{}"
  @AppStorage("freedom-show-past") private var showPast = false
  @AppStorage("freedom-show-volatile") private var showVolatile = true
  @State private var settings = false
  @State private var amount = ""
  @State private var direction = "spend"
  @State private var projection: FreedomProjection?
  @FocusState private var amountFocused: Bool
  var roles: [String: String] { (try? JSONDecoder().decode([String: String].self, from: Data(rolesData.utf8))) ?? [:] }
  func role(_ r: Record) -> String { roles[r.id] ?? (r.type == "wallet" ? (r.text("category") == "cny" ? "stable" : "off") : "volatile") }
  func setRole(_ r: Record, _ value: String) {
    var next = roles; next[r.id] = value
    if let data = try? JSONEncoder().encode(next), let text = String(data: data, encoding: .utf8) { rolesData = text }
  }
  var items: [Record] { studio.all("wallet").filter { ["cny", "external"].contains($0.text("category")) } + studio.all("asset") }
  var body: some View {
    let today = Day.today
    let businessDay = FinanceRules.date(today)!
    let birth = FinanceRules.date(birthday).flatMap { $0 <= businessDay ? $0 : nil }
    let remaining = birth.map { max(0, FreedomRules.distance(from: businessDay, to: FreedomRules.birthday($0, atAge: age))) } ?? 0
    let costBasis: FinanceRules.Basis = basis == "current" ? .current : .term
    let request = FreedomProjection.Request(
      today: today, since: since, start: start, basis: costBasis,
      revision: studio.revision("expense", "wallet", "walletEntry", "asset", "assetPrice"),
      roles: roles, live: studio.livePrices)
    let loaded = projection?.request == request ? projection : nil
    let cost = loaded?.cost ?? FreedomRules.Cost.empty
    let stable = (loaded?.stable.value ?? 0) * 100
    let complete = loaded.map { $0.stable.known > 0 && $0.stable.unknown == 0 } ?? false
    let free = complete ? FreedomRules.days(assets: stable, average: cost.average) : nil
    let startAssets = loaded?.startAssets
    let blue = min(free ?? 0, startAssets.flatMap { FreedomRules.days(assets: $0, average: cost.average) } ?? 0)
    let volatile = loaded?.volatile ?? 0
    let extra = complete ? max(0, (FreedomRules.days(
      assets: max(0, stable) + max(0, volatile), average: cost.average) ?? 0) - (free ?? 0)) : 0
    let change = Money.minor(amount).flatMap(FinanceRules.minor) ?? 0
    let preview = change > 0 && complete
      ? FreedomRules.days(
        assets: stable + (direction == "income" ? change : 0),
        average: (cost.total + (direction == "spend" ? change : 0)) / Decimal(max(1, cost.days)))
      : nil
    Page {
      Card(title: "已买下的自由") {
        Figure(value: free?.formatted() ?? "—", unit: free == nil ? nil : "天")
        if let loaded, !complete {
          Text(loaded.stable.unknown > 0
               ? "有 \(loaded.stable.unknown) 项稳定资产缺少估值，补齐后计算自由天数。"
               : "请选择纳入计算的稳定资产。")
            .font(Ink.meta).foregroundStyle(Ink.text3)
        }
        if complete && startAssets == nil {
          Text("点灯起点估值不全，累计天数暂无法拆分。").font(Ink.meta).foregroundStyle(Ink.text3)
        }
        if let free {
          Text("按现在的花法，能撑到 " + Day.shift(today, free))
            .font(Ink.meta).foregroundStyle(Ink.text2)
        }
        if volatile > 0 && extra > 0 {
          Text("另有波动资产 \(Money.format(volatile))，按现价可再撑 \(extra) 天。未计入上面的数字。")
            .font(Ink.meta).foregroundStyle(Ink.text3)
        }
        if let free, remaining > 0 {
          let covered = min(1, Double(free) / Double(remaining))
          VStack(alignment: .leading, spacing: 6) {
            HStack {
              Text("到 \(age) 岁的覆盖比例")
              Spacer()
              Text(covered, format: .percent.precision(.fractionLength(1))).monospacedDigit()
            }.font(Ink.micro).foregroundStyle(Ink.text2)
            Meter(value: covered)
          }
        }
      }.id("freedom-hero")
      Picker("长期物品", selection: $basis) { Text("当下日均").tag("current"); Text("期限日均").tag("term") }.pickerStyle(.segmented)
      Card {
        StatRow(items: [("日均花销", cost.days > 0 ? Money.format(cost.average) : "—"), ("记账天数", cost.days > 0 ? "\(cost.days) 天" : "—")])
        Hairline()
        StatRow(items: [
          (complete ? "稳定资产" : "已知稳定资产小计", (loaded?.stable.known ?? 0) > 0 ? Money.format(stable) : "—"),
          ("期间使用成本", Money.format(cost.total)),
        ])
      }.id("freedom-stats")
      Group {
        if let since = cost.since {
          Text("从 \(since) 算起。" + (basis == "current" ? "预计使用类按已用天数平均；固定期限仍按完整期限。" : "长期物品按使用期限平均。"))
        } else {
          Text("还没有日常花销记录，填入第一笔后才会开始计算日均。")
        }
      }
      .font(Ink.meta).foregroundStyle(Ink.text3).padding(.horizontal, 6)
      FreedomTrends(today: today, projection: loaded)
        .id("freedom-trends")
      Card(title: "人生方格", meta: "一行一岁 · 一格一天") {
        if let birth, remaining > 0 {
          FreedomGrid(birth: birth, today: businessDay, age: age, days: startAssets == nil ? 0 : free ?? 0, blue: blue,
                      extra: showVolatile ? extra : 0, preview: free == nil ? nil : preview, showPast: showPast)
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), alignment: .leading)], alignment: .leading, spacing: 6) {
            legend("起点后积累", Ink.amber)
            legend("起点资产", .blue)
            if showVolatile && extra > 0 { legend("波动资产", .purple) }
            legend("尚未覆盖", Color(white: 0.28))
          }
          Text("白线是今天。上下滑动看年龄。").font(Ink.micro).foregroundStyle(Ink.text3)
        } else {
          Button(birth == nil ? "设置生日，点亮人生方格" : "调整目标年龄") { settings = true }.font(Ink.row)
        }
      }.id("freedom-grid")
      Card(title: "今天") {
        Figure(value: Money.format(cost.today), caption: "今天的使用成本", font: Ink.figureMid)
        if let yesterday = loaded?.yesterday, let free,
           let previous = FreedomRules.days(assets: stable, average: yesterday.average) {
          let delta = free - previous
          Text("自由 \(delta >= 0 ? "+" : "")\(delta) 天")
            .font(Ink.row).foregroundStyle(delta >= 0 ? Ink.live : Ink.text2)
        }
      }.id("freedom-today")
      Card(title: "离目标还差") {
        if !complete {
          Text("补齐稳定资产估值后，可计算目标缺口。").font(Ink.meta).foregroundStyle(Ink.text3)
        } else if cost.average > 0 {
          ForEach([(10, 3653), (20, 7305)], id: \.0) { span in
            let need = max(0, cost.average * Decimal(span.1) - stable)
            HStack {
              Text("再有 \(span.0) 年").font(Ink.meta).foregroundStyle(Ink.text2)
              Spacer()
              Text(need <= 0 ? "已覆盖" : Money.format(need)).font(Ink.row)
            }
          }
          if remaining > 0 {
            let need = max(0, cost.average * Decimal(remaining) - stable)
            HStack {
              Text("到 \(age) 岁").font(Ink.meta).foregroundStyle(Ink.text2)
              Spacer()
              Text(need <= 0 ? "已覆盖" : Money.format(need)).font(Ink.row)
            }
          }
        } else {
          Text("日均花销大于零后，可计算目标缺口。").font(Ink.meta).foregroundStyle(Ink.text3)
        }
      }.id("freedom-gaps")
      Card(title: "试算 · 如果今天") {
        Picker("变化", selection: $direction) { Text("花掉").tag("spend"); Text("国库增加").tag("income") }.pickerStyle(.segmented)
        TextField("金额", text: $amount).keyboardType(.decimalPad)
          .focused($amountFocused)
          .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
          .padding(12)
          .studioInputBox(cornerRadius: 12, fill: Ink.raised) { amountFocused = true }
        if let preview {
          Figure(value: preview.formatted(), unit: "天", caption: "试算后的自由天数", font: Ink.figureMid)
        } else if !amount.isEmpty && change <= 0 {
          Text("输入大于零的金额，最多两位小数。").font(Ink.meta).foregroundStyle(Ink.text2)
        }
        Text("仅试算，不记账。花掉会提高日均；国库增加会提高稳定资产。") .font(Ink.meta).foregroundStyle(Ink.text3)
      }.id("freedom-whatif")
    }.studioScreen("自由指南灯")
      .onAppear { if start.isEmpty { start = today } }
      .task(id: request) {
        let expenses = studio.all("expense"), wallets = studio.all("wallet"), assets = studio.all("asset")
        let entries = studio.all("walletEntry"), prices = studio.all("assetPrice")
        let job = Task.detached(priority: .userInitiated) {
          FreedomProjection(request: request, expenses: expenses, wallets: wallets, assets: assets, entries: entries, prices: prices)
        }
        let result = await withTaskCancellationHandler { await job.value } onCancel: { job.cancel() }
        guard !Task.isCancelled else { return }
        projection = result
      }
      .refreshable { await studio.refreshQuotes() }
      .task(id: studio.revision("asset")) { await studio.refreshQuotes() }
      .toolbar { Button { settings = true } label: { Image(systemName: "slider.horizontal.3") }.accessibilityLabel("自由指南灯设置") }
      .sheet(isPresented: $settings) {
        NavigationStack {
          Form {
            Section("人生方格") {
              TextField("生日 YYYY-MM-DD", text: $birthday)
              Toggle("显示已经过去的年份", isOn: $showPast)
              Toggle("在方格中显示波动资产", isOn: $showVolatile)
              Stepper("目标年龄 \(age) 岁", value: $age, in: 1...130)
              TextField("积累起点 YYYY-MM-DD", text: $start)
              TextField("记账起点（留空自动）", text: $since)
            }
            Section("资产如何计入") {
              ForEach(items) { item in
                Picker(item.title, selection: Binding(get: { role(item) }, set: { setRole(item, $0) })) {
                  Text("稳定资产").tag("stable"); Text("波动资产").tag("volatile"); Text("不计入").tag("off")
                }
              }
            }
          }.navigationTitle("指南灯设置").toolbar { Button("完成") { settings = false } }
        }.studioSheet()
      }
  }
  func legend(_ text: String, _ color: Color) -> some View {
    HStack(spacing: 4) { Circle().fill(color).frame(width: 6, height: 6); Text(text).font(.system(size: 10)).foregroundStyle(Ink.text2) }
  }
}

private struct FreedomProjection: Sendable {
  struct Request: Equatable, Sendable {
    let today: String
    let since: String
    let start: String
    let basis: FinanceRules.Basis
    let revision: String
    let roles: [String: String]
    let live: [String: Decimal]
  }
  let request: Request
  let cost: FreedomRules.Cost
  let yesterday: FreedomRules.Cost
  let stable: TreasuryValuation
  let volatile: Decimal
  let startAssets: Decimal?
  let expenses: [Record]
  let history: [TreasuryHistoryPoint]

  init(request: Request, expenses: [Record], wallets: [Record], assets: [Record], entries: [Record], prices: [Record]) {
    self.request = request
    self.expenses = expenses
    cost = FreedomRules.cost(expenses, today: request.today, since: request.since, basis: request.basis)
    let prior = Day.shift(request.today, -1)
    yesterday = FreedomRules.cost(expenses.map { FreedomRules.expenseKnownAt($0, day: prior) },
                                  today: prior, since: request.since, basis: request.basis)
    let plain = wallets.filter { ["cny", "external"].contains($0.text("category")) }
    func role(_ wallet: Record) -> String {
      request.roles[wallet.id] ?? (wallet.text("category") == "cny" ? "stable" : "off")
    }
    let selection = TreasurySelection(
      wallets: Set(plain.filter { role($0) == "stable" }.map(\.id)),
      assets: Set(assets.filter { request.roles[$0.id] == "stable" }.map(\.id)))
    let report = TreasuryRules.report(wallets: wallets, assets: assets, entries: entries, prices: prices,
                                      live: request.live, historyOf: selection)
    stable = report.selected ?? TreasuryValuation.empty
    let volatileWallets = plain.filter { role($0) == "volatile" }.compactMap { report.balances[$0.id]?.value }
    let volatileAssets = assets.filter { (request.roles[$0.id] ?? "volatile") == "volatile" }.compactMap { report.assets[$0.id]?.value }
    volatile = (volatileWallets + volatileAssets).reduce(Decimal.zero, +) * 100
    history = report.history
    let start = FinanceRules.date(request.start) != nil && request.start <= request.today ? request.start : request.today
    let close = FinanceRules.date(start).flatMap { FinanceRules.calendar.date(byAdding: .day, value: 1, to: $0) }
    startAssets = close.flatMap { close in report.history.last(where: { $0.at < close })?.value }.map { $0 * 100 }
  }
}

private struct FreedomTrends: View {
  let today: String
  let projection: FreedomProjection?
  @State private var months = 1
  @State private var customFrom: Date?
  @State private var customTo: Date?
  @State private var selected: Date?
  @State private var points: [FreedomRules.TrendPoint] = []
  @State private var loaded: Request?

  private struct Request: Equatable {
    let from: String
    let to: String
    let projection: FreedomProjection.Request?
  }

  var body: some View {
    let end = FinanceRules.date(today)!
    let recentStart = FinanceRules.calendar.date(byAdding: .month, value: -(months == 0 ? 1 : months), to: end) ?? end
    let from = months == 0 ? customFrom ?? recentStart : recentStart
    let to = months == 0 ? customTo ?? end : end
    let request = Request(from: BusinessDate.day(from), to: BusinessDate.day(to), projection: projection?.request)
    Card(title: "历史趋势") {
      Picker("趋势范围", selection: $months) {
        Text("1 个月").tag(1)
        Text("3 个月").tag(3)
        Text("6 个月").tag(6)
        Text("1 年").tag(12)
        Text("自定义").tag(0)
      }.pickerStyle(.segmented)
      if months == 0 {
        DatePicker("起始日", selection: Binding(get: { from }, set: { customFrom = $0 }),
                   in: ...min(end, to), displayedComponents: .date)
        DatePicker("结束日", selection: Binding(get: { to }, set: { customTo = $0 }),
                   in: min(from, end)...end, displayedComponents: .date)
      }
      Text("累计日均从记账起点算到当天。每日实际使用成本包含当次消费与长期物品当天的成本。")
        .font(Ink.micro).foregroundStyle(Ink.text2)
      if projection == nil || loaded != request {
        ProgressView().frame(maxWidth: .infinity, minHeight: 130)
      } else {
        trendChart("自由天数", tint: Ink.amber, values: points.map { $0.days.map(Double.init) }) {
          "\(Int($0).formatted()) 天"
        }
        Hairline()
        trendChart("累计日均消费", tint: Color(red: 0.43, green: 0.59, blue: 0.86),
                   values: points.map { $0.average.map { NSDecimalNumber(decimal: $0 / 100).doubleValue } }) {
          Money.format(Decimal($0) * 100)
        }
        Hairline()
        trendChart("每日实际使用成本", tint: Ink.live,
                   values: points.map { $0.usageCost.map { NSDecimalNumber(decimal: $0 / 100).doubleValue } }) {
          Money.format(Decimal($0) * 100)
        }
      }
    }
    .environment(\.timeZone, FinanceRules.calendar.timeZone)
    .environment(\.calendar, FinanceRules.calendar)
    .task(id: request) {
      selected = nil
      guard let projection else { return }
      let job = Task.detached(priority: .userInitiated) {
        let stable = projection.stable
        let balance = stable.known > 0 && stable.unknown == 0 ? stable.value * 100 : nil
        return FreedomRules.trend(projection.expenses, history: projection.history, from: request.from, to: request.to,
                                  today: projection.request.today, assetsToday: balance,
                                  since: projection.request.since, basis: projection.request.basis)
      }
      let result = await withTaskCancellationHandler { await job.value } onCancel: { job.cancel() }
      guard !Task.isCancelled else { return }
      points = result
      loaded = request
    }
  }

  private struct Sample: Identifiable {
    let date: Date
    let value: Double
    let segment: Int
    var id: Date { date }
  }

  private func trendChart(_ title: String, tint: Color, values: [Double?], format: (Double) -> String) -> some View {
    var segment = 0
    let samples = zip(points, values).compactMap { point, value -> Sample? in
      guard let value else { segment += 1; return nil }
      return Sample(date: point.day, value: value, segment: segment)
    }
    let active = selected.flatMap { selection in
      points.indices.min { abs(points[$0].day.timeIntervalSince(selection)) < abs(points[$1].day.timeIntervalSince(selection)) }
    }
    let highlighted = active.map { (day: points[$0].day, value: values[$0]) } ??
      samples.last.map { (day: $0.date, value: Optional($0.value)) }
    return VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(title).font(Ink.title)
        Spacer()
        if let highlighted {
          Text(BusinessDate.day(highlighted.day) + " · " + (highlighted.value.map(format) ?? "无记录"))
            .font(Ink.meta).foregroundStyle(Ink.text2).monospacedDigit()
        }
      }
      if let first = points.first, let last = points.last, !samples.isEmpty {
        Chart {
          ForEach(samples) { sample in
            LineMark(x: .value("日期", sample.date), y: .value(title, sample.value),
                     series: .value("连续记录", sample.segment)).foregroundStyle(tint)
            if sample.date == highlighted?.day || samples.count == 1 {
              PointMark(x: .value("日期", sample.date), y: .value(title, sample.value)).foregroundStyle(tint)
            }
          }
          if selected != nil, let highlighted {
            RuleMark(x: .value("选择的日期", highlighted.day)).foregroundStyle(Ink.text3)
          }
        }
        .chartXScale(domain: first.day...(last.day == first.day ? last.day.addingTimeInterval(86_400) : last.day))
        .chartYScale(domain: .automatic(includesZero: false))
        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) { AxisValueLabel(format: .dateTime.month(.twoDigits).day(.twoDigits)) } }
        .chartXSelection(value: $selected)
        .frame(height: 132)
      } else {
        Text(title == "自由天数" ? "这个范围内还没有可计算的稳定资产和日均记录。" : "这个范围内还没有可计算的消费记录。")
          .font(Ink.meta).foregroundStyle(Ink.text2)
      }
    }
  }
}

private struct FreedomGrid: View {
  let birth: Date
  let today: Date
  let age: Int
  let days: Int
  let blue: Int
  let extra: Int
  let preview: Int?
  let showPast: Bool
  private let label: CGFloat = 30
  private let rowHeight: CGFloat = 14
  var body: some View {
    let calendar = FinanceRules.calendar
    let elapsedYears = calendar.component(.year, from: today) - calendar.component(.year, from: birth)
    let currentAge = today < FreedomRules.birthday(birth, atAge: elapsedYears) ? elapsedYears - 1 : elapsedYears
    let firstYear = showPast ? 0 : currentAge
    let rows = max(1, max(currentAge + 1, age) - firstYear)
    GeometryReader { geo in
      // A whole year fits across the card, as on the web; vertical scrolling walks through ages.
      let width = geo.size.width
      let pitch = max(0, (width - label) / 366)
      ScrollView(.vertical) {
        Canvas { context, _ in
          for year in firstYear..<(firstYear + rows) {
            let date = FreedomRules.birthday(birth, atAge: year)
            let end = FreedomRules.birthday(birth, atAge: year + 1)
            let count = FreedomRules.distance(from: date, to: end)
            let offset = FreedomRules.distance(from: today, to: date)
            let y = CGFloat(year - firstYear) * rowHeight
            if year == firstYear || year == currentAge || year % 5 == 0 {
              context.draw(
                Text("\(year)").font(.system(size: 9)).foregroundColor(Ink.text3),
                at: CGPoint(x: 12, y: y + rowHeight / 2))
            }
            for day in 0..<count {
              let n = offset + day
              var color = n < 0 ? Color(white: 0.09) : Color(white: 0.18)
              if n >= 0 && n < days { color = n < days - blue ? Ink.amber : .blue }
              if preview == nil && n >= days && n < days + extra { color = .purple.opacity(0.65) }
              if let preview, n >= 0 {
                if n >= days && n < preview { color = Ink.live }
                if n >= preview && n < days { color = Ink.danger }
              }
              if n == 0 { color = .white }
              context.fill(
                Path(
                  CGRect(
                    x: label + CGFloat(day) * pitch, y: y + 1,
                    width: pitch * 0.8, height: rowHeight - 3)),
                with: .color(color))
            }
            if year == currentAge {
              let column = -offset
              if column >= 0 && column < count {
                context.fill(
                  Path(
                    CGRect(
                      x: label + CGFloat(column) * pitch - 0.5, y: y,
                      width: 1.5, height: rowHeight)),
                  with: .color(.white))
              }
            }
          }
        }
        .frame(width: width, height: CGFloat(rows) * rowHeight)
        .accessibilityLabel("人生方格，已覆盖 \(days) 天")
      }
      .frame(height: 300)
    }
    .frame(height: 300)
  }
}
