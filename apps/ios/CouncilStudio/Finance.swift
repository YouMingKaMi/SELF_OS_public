import Charts
import CouncilCore
import SwiftUI

struct FinanceScreen: View {
  @Environment(Studio.self) private var studio
  // STUDIO_FINANCE=<view>:<yyyy-MM>[:ended] opens a view and month directly; used for device screenshots.
  private static let start = ProcessInfo.processInfo.environment["STUDIO_FINANCE"]?.split(separator: ":").map(String.init) ?? []
  @State private var month = start.count > 1 ? start[1] : String(Day.today.prefix(7))
  @State private var showEnded = start.count > 2
  @State private var view = start.first ?? "ledger"
  @State private var basis = FinanceRules.Basis.actual
  @State private var category = ""
  @State private var editing: Record?
  @State private var adding = false
  @State private var form: EntityForm?
  var expenses: [Record] { studio.all("expense") }
  var categories: [Record] { studio.all("category") }
  var filtered: [Record] {
    category.isEmpty ? expenses : expenses.filter { $0.text("categoryId") == category }
  }
  func name(_ id: String) -> String { categories.first { $0.id == id }?.title ?? "未分类" }

  var body: some View {
    let asOf = Day.today
    let report = FinanceReport(expenses: expenses, filtered: filtered, month: month, basis: basis, asOf: asOf)
    let budget = studio.all("budget").first { $0.text("month") == month }
    let budgetMinor = budget.flatMap { FinanceRules.minor($0.text("amountMinor")) }
    List {
      Section {
        MonthBar(month: $month).listRowBackground(Color.clear)
          .listRowInsets(EdgeInsets(top: 0, leading: 6, bottom: 0, trailing: 6))
      }
      Section { summary(report, budget: budgetMinor).cardRow() }
      Section {
        Picker("视图", selection: $view) {
          Text("账本").tag("ledger")
          Text("分布").tag("spread")
          Text("长期").tag("long")
          Text("固定").tag("fixed")
        }.pickerStyle(.segmented).listRowBackground(Color.clear).listRowInsets(EdgeInsets())
      }
      switch view {
      case "spread": spread(report)
      case "long": longTerm
      case "fixed": fixed
      default: ledger
      }
    }
    .studioList()
    .toolbar(.hidden, for: .tabBar)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Button("月度预算", systemImage: "gauge.with.dots.needle.33percent") {
            form = EntityForm(
              type: "budget", record: budget, defaults: ["month": .string(month)], fields: ["amountMinor"])
          }
          Button("新分类", systemImage: "folder.badge.plus") { form = EntityForm(type: "category") }
          Button("新固定支出", systemImage: "repeat") { form = EntityForm(type: "recurringExpense", defaults: ["active": .bool(true)]) }
        } label: {
          Image(systemName: "ellipsis")
        }
      }
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          adding = true
        } label: {
          Image(systemName: "plus")
        }.accessibilityLabel("记一笔")
      }
    }
    .studioScreen("花销")
    .sheet(item: $editing) { ExpenseSheet(record: $0) }
    .sheet(isPresented: $adding) { ExpenseSheet(record: nil) }
    .sheet(item: $form) { EntityFormSheet(form: $0) }
  }

  // MARK: Summary

  func summary(_ report: FinanceReport, budget: Decimal?) -> some View {
    let spent = report.actualTotal
    let days = Double(report.summary.days.count)
    let monthDays = Double(HabitRules.days(in: month).count)
    let pace = monthDays > 0 ? days / monthDays : 0
    let isCurrent = month == String(Day.today.prefix(7))
    let projected = isCurrent && days > 0 ? spent / Decimal(days) * Decimal(monthDays) : spent
    return VStack(alignment: .leading, spacing: 16) {
      HStack(alignment: .top) {
        Figure(
          value: Money.format(basis == .actual ? spent : report.summary.total),
          caption: basis == .actual
            ? (isCurrent ? "按目前节奏，月底约 " + Money.format(projected) : "实际净付款")
            : "月度使用成本")
        Spacer()
        Menu {
          Picker("口径", selection: $basis) {
            Text("实际净付款").tag(FinanceRules.Basis.actual)
            Text("使用成本 · 期限均摊").tag(FinanceRules.Basis.term)
            Text("使用成本 · 当下均摊").tag(FinanceRules.Basis.current)
          }
        } label: {
          HStack(spacing: 3) {
            Text(basis == .actual ? "实付" : basis == .term ? "期限" : "当下")
            Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
          }.font(.system(size: 12, weight: .semibold)).foregroundStyle(Ink.text2)
            .padding(.horizontal, 10).frame(height: 28).background(Ink.raised, in: Capsule())
        }
      }
      if let budget, budget > 0 {
        VStack(alignment: .leading, spacing: 8) {
          Meter(
            value: NSDecimalNumber(decimal: spent / budget).doubleValue, marker: isCurrent ? pace : nil,
            tint: spent > budget ? Ink.danger : Ink.text, height: 6)
          HStack {
            Text("预算 " + Money.format(budget))
            Spacer()
            Text(spent > budget ? "已超 " + Money.format(spent - budget) : "剩 " + Money.format(budget - spent))
          }.font(.system(size: 12)).monospacedDigit().foregroundStyle(Ink.text3)
        }
      }
      StatRow(items: [
        ("必要", Money.format(report.necessary)),
        ("非必要", Money.format(report.discretionary)),
        ("日均", report.summary.calendarAverage.map(Money.format) ?? "—"),
      ])
    }.padding(.vertical, 6)
  }

  // MARK: Ledger

  @ViewBuilder var ledger: some View {
    let rows = filtered.filter { $0.text("day").hasPrefix(month) }
    let days = Array(Set(rows.map { $0.text("day") })).sorted(by: >)
    if !category.isEmpty {
      Section {
        Button {
          category = ""
        } label: {
          Label("只看 " + name(category) + " · 点此取消", systemImage: "line.3.horizontal.decrease.circle")
            .font(Ink.meta).foregroundStyle(Ink.text2)
        }.cardRow()
      }
    }
    ForEach(days, id: \.self) { day in
      let list = rows.filter { $0.text("day") == day }.sorted { $0.updatedAt > $1.updatedAt }
      Section {
        ForEach(list) { row in
          Button {
            editing = row
          } label: {
            HStack(spacing: 12) {
              VStack(alignment: .leading, spacing: 3) {
                Text(row.title).font(Ink.row).foregroundStyle(Ink.text).lineLimit(1)
                Text(
                  [
                    name(row.text("categoryId")),
                    row.text("subcategoryId").isEmpty ? nil : name(row.text("subcategoryId")),
                    row.text("mode") == "immediate" ? nil : Words.of(row.text("mode")),
                  ].compactMap { $0 }.joined(separator: " · ")
                ).font(.system(size: 12)).foregroundStyle(Ink.text3)
              }
              Spacer()
              if !row.flag("necessary") {
                Text("非必要").font(.system(size: 10, weight: .medium)).foregroundStyle(Ink.text3)
                  .padding(.horizontal, 6).padding(.vertical, 2).overlay(Capsule().stroke(Ink.line))
              }
              Text(Money.format(FinanceRules.net(row))).font(.system(size: 16, weight: .semibold, design: .rounded))
                .monospacedDigit().foregroundStyle(FinanceRules.net(row) < 0 ? Ink.live : Ink.text)
            }
          }.buttonStyle(.plain).cardRow()
            .swipeActions {
              Button("删除", systemImage: "trash", role: .destructive) { Task { await studio.remove(row) } }
            }
        }
      } header: {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(String(Int(day.suffix(2)) ?? 0)).font(.system(size: 22, weight: .semibold, design: .rounded))
            .foregroundStyle(Ink.text)
          Text("周" + Day.weekday(day)).font(Ink.meta).foregroundStyle(Ink.text3)
          Spacer()
          Text(Money.format(list.reduce(Decimal()) { $0 + FinanceRules.net($1) })).font(Ink.meta)
            .monospacedDigit().foregroundStyle(Ink.text2)
        }.textCase(nil).padding(.leading, -4)
      }
    }
    if days.isEmpty {
      Section { Text("这个月还没有记录").font(Ink.meta).foregroundStyle(Ink.text3).cardRow() }
    }
  }

  // MARK: Spread

  @ViewBuilder func spread(_ report: FinanceReport) -> some View {
    let top = report.categories.first?.minor ?? 1
    Section {
      ForEach(report.categories) { group in
        Button {
          category = category == group.id ? "" : group.id
          view = "ledger"
        } label: {
          VStack(alignment: .leading, spacing: 7) {
            HStack {
              Text(group.id.isEmpty ? "未分类" : name(group.id)).font(Ink.row).foregroundStyle(Ink.text)
              Spacer()
              Text(Money.format(group.minor)).font(.system(size: 15, weight: .semibold, design: .rounded))
                .monospacedDigit().foregroundStyle(Ink.text)
            }
            Meter(value: top > 0 ? NSDecimalNumber(decimal: group.minor / top).doubleValue : 0, height: 4)
          }
        }.buttonStyle(.plain).cardRow()
      }
      if report.categories.isEmpty { Text("记账后显示用途分布").font(Ink.meta).foregroundStyle(Ink.text3).cardRow() }
    } header: {
      Text("用途 · 点一项看明细").font(.system(size: 13, weight: .semibold)).foregroundStyle(Ink.text2).textCase(nil)
    }
    Section {
      Chart {
        ForEach(report.summary.days) { day in
          BarMark(
            x: .value("日", Int(day.day.suffix(2)) ?? 0),
            y: .value("元", NSDecimalNumber(decimal: day.minor / 100).doubleValue), width: 6
          ).foregroundStyle(day.day == Day.today ? Ink.amber : Ink.text).clipShape(Capsule())
        }
      }.chartXAxis {
        AxisMarks(values: [1, 8, 15, 22, 29]) { AxisValueLabel().foregroundStyle(Ink.text3) }
      }.chartYAxis {
        AxisMarks(position: .trailing) {
          AxisGridLine().foregroundStyle(Ink.line)
          AxisValueLabel().foregroundStyle(Ink.text3)
        }
      }.frame(height: 160).cardRow()
      StatRow(items: [
        ("有记录日均", report.summary.recordedAverage.map(Money.format) ?? "—"),
        ("记录天数", "\(report.summary.recordedDays)"),
        ("上月", Money.format(report.previous.total)),
      ]).cardRow()
    } header: {
      Text("每日").font(.system(size: 13, weight: .semibold)).foregroundStyle(Ink.text2).textCase(nil)
    }
  }

  // MARK: Long-term

  @ViewBuilder var longTerm: some View {
    let asOf = Day.today
    let view = FinanceRules.longTerm(expenses, month: month, asOf: asOf)
    let current = month >= String(asOf.prefix(7))
    let inUse = view.shown.filter { !FinanceRules.isHistory($0, asOf: asOf) }
    Section {
      StatRow(items: [
        ("期限日均", Money.format(FinanceRules.dailyTotal(inUse, basis: .term, asOf: asOf))),
        ("当下日均", Money.format(FinanceRules.dailyTotal(inUse, basis: .current, asOf: asOf))),
        (current ? "使用中" : "当月在用", "\(view.shown.count) 件"),
      ]).cardRow()
    } footer: {
      if !current {
        Text("当月在用的长期物品；仍在用的按截至今天计算，已结束的保留结束时的数据。")
          .font(.system(size: 12)).foregroundStyle(Ink.text3)
      }
    }
    Section {
      ForEach(view.shown) { longRow($0) }
      if view.shown.isEmpty {
        Text(current ? "没有使用中的长期物品" : "这个月没有在用的长期物品").font(Ink.meta).foregroundStyle(Ink.text3).cardRow()
      }
    } header: {
      Text(current ? "使用中" : "当月在用").font(.system(size: 13, weight: .semibold)).foregroundStyle(Ink.text2).textCase(nil)
    }
    if !view.hidden.isEmpty {
      Section {
        Button {
          withAnimation(.snappy) { showEnded.toggle() }
        } label: {
          HStack {
            Text("已结束 · \(view.hidden.count)").font(.system(size: 14, weight: .medium)).foregroundStyle(Ink.text2)
            Spacer()
            Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(Ink.text3)
              .rotationEffect(.degrees(showEnded ? 180 : 0))
          }
        }.buttonStyle(.plain).cardRow()
        if showEnded { ForEach(view.hidden) { longRow($0) } }
      }
    }
  }
  func longRow(_ row: Record) -> some View {
    let asOf = Day.today
    let start = row.text("startDay")
    let end = FinanceRules.effectiveEnd(row, asOf: asOf)
    let ended = FinanceRules.isHistory(row, asOf: asOf)
    let planned = FinanceRules.inclusiveDays(start, row.text("endDay"))
    let used = FinanceRules.inclusiveDays(start, min(asOf, end))
    let format: (FinanceRules.Basis) -> String = { basis in
      FinanceRules.daily(row, basis: basis, asOf: asOf).map { Money.format(FinanceRules.rounded($0)) } ?? "—"
    }
    return Button {
      editing = row
    } label: {
      VStack(alignment: .leading, spacing: 8) {
        HStack(alignment: .firstTextBaseline) {
          Text(row.title).font(Ink.row).foregroundStyle(ended ? Ink.text2 : Ink.text)
          if ended {
            Text("已结束").font(.system(size: 11, weight: .medium)).foregroundStyle(Ink.text3)
              .padding(.horizontal, 6).padding(.vertical, 2).background(Ink.raised, in: Capsule())
          }
          Spacer()
          Text(Money.format(FinanceRules.net(row))).font(.system(size: 15, weight: .semibold, design: .rounded))
            .monospacedDigit().foregroundStyle(ended ? Ink.text2 : Ink.text)
        }
        Meter(value: planned > 0 ? min(1, Double(used) / Double(planned)) : 0, height: 3)
        HStack {
          Text(ended ? "\(start.suffix(5)) — \(end.suffix(5)) · 用了 \(used) 天" : "\(Words.of(row.text("mode"))) · 已用 \(used) / \(planned) 天")
          Spacer()
        }.font(.system(size: 12)).monospacedDigit().foregroundStyle(Ink.text3)
        HStack(spacing: 14) {
          Text("期限 ").foregroundStyle(Ink.text3) + Text(format(.term)).foregroundStyle(Ink.text2)
          Text("当下 ").foregroundStyle(Ink.text3) + Text(format(.current)).foregroundStyle(Ink.text)
          Spacer()
          Text("日均").foregroundStyle(Ink.text3)
        }.font(.system(size: 12, weight: .medium)).monospacedDigit()
      }
    }.buttonStyle(.plain).cardRow()
  }

  // MARK: Fixed

  @ViewBuilder var fixed: some View {
    let rows = studio.all("recurringExpense")
    Section {
      ForEach(rows) { row in
        Button {
          form = EntityForm(type: "recurringExpense", record: row)
        } label: {
          HStack {
            VStack(alignment: .leading, spacing: 3) {
              Text(row.title).font(Ink.row).foregroundStyle(row.flag("active") ? Ink.text : Ink.text3)
              Text(row.flag("active") ? name(row.text("categoryId")) : "已停用").font(.system(size: 12))
                .foregroundStyle(Ink.text3)
            }
            Spacer()
            Text(Money.format(row.text("amountMinor")) + " / 月").font(.system(size: 15, weight: .semibold, design: .rounded))
              .monospacedDigit().foregroundStyle(Ink.text)
          }
        }.buttonStyle(.plain).cardRow()
      }
      if rows.isEmpty { Text("订阅、房租这类每月固定的支出").font(Ink.meta).foregroundStyle(Ink.text3).cardRow() }
    } footer: {
      Text("只作参考，不会自动记账；实际付款当天另记一笔。").font(.system(size: 12)).foregroundStyle(Ink.text3)
    }
  }
}

/// Spend capture: the amount is the hero, categories are one tap, defaults follow the category.
struct ExpenseSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let record: Record?
  @State private var amount = ""
  @State private var title = ""
  @State private var category = ""
  @State private var child = ""
  @State private var necessary = true
  @State private var day = Date()
  @State private var mode = "immediate"
  @State private var start = Date()
  @State private var end = Date().addingTimeInterval(86400 * 365)
  @State private var ended: Date?
  @State private var recovery = ""
  @State private var note = ""
  @State private var confirmDelete = false
  @FocusState private var amountFocused: Bool
  var parents: [Record] { studio.all("category").filter { $0.text("parentId").isEmpty } }
  var children: [Record] { studio.all("category").filter { $0.text("parentId") == category && !category.isEmpty } }
  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("¥").font(.system(size: 30, weight: .semibold, design: .rounded)).foregroundStyle(Ink.text3)
            TextField("0", text: $amount).font(.system(size: 52, weight: .semibold, design: .rounded))
              .keyboardType(.decimalPad).focused($amountFocused).monospacedDigit()
          }
          TextField("买了什么", text: $title).font(.system(size: 18))
            .padding(14).background(Ink.raised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
          VStack(alignment: .leading, spacing: 10) {
            Text("用途").font(Ink.micro).foregroundStyle(Ink.text3)
            FlowChips(items: parents.map { ($0.id, $0.title) }, selection: category) { id in
              category = category == id ? "" : id
              if let row = parents.first(where: { $0.id == category }) {
                necessary = row.flag("necessary")
                child = row.text("defaultChildId")
              }
            }
            if !children.isEmpty {
              FlowChips(items: children.map { ($0.id, $0.title) }, selection: child, small: true) { id in
                child = child == id ? "" : id
              }
            }
          }
          VStack(spacing: 0) {
            Toggle("必要支出", isOn: $necessary).padding(.vertical, 10)
            Hairline()
            DatePicker("日期", selection: $day, displayedComponents: .date).padding(.vertical, 6)
            Hairline()
            Picker("方式", selection: $mode) {
              Text("当次").tag("immediate")
              Text("预计使用").tag("estimated")
              Text("固定期限").tag("fixed")
            }.pickerStyle(.segmented).padding(.vertical, 10)
            if mode != "immediate" {
              DatePicker("开始使用", selection: $start, displayedComponents: .date).padding(.vertical, 6)
              DatePicker(mode == "fixed" ? "到期" : "预计用到", selection: $end, in: start..., displayedComponents: .date)
                .padding(.vertical, 6)
              if record != nil {
                Hairline()
                Toggle("已结束 / 已出售", isOn: Binding(get: { ended != nil }, set: { ended = $0 ? Date() : nil }))
                  .padding(.vertical, 10)
                if ended != nil {
                  DatePicker("实际结束", selection: Binding(get: { ended ?? Date() }, set: { ended = $0 }), displayedComponents: .date)
                  HStack {
                    Text("回收金额")
                    TextField("0", text: $recovery).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                  }.padding(.vertical, 8)
                }
              }
            }
          }.padding(.horizontal, 14).background(Ink.raised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
          TextField("备注", text: $note, axis: .vertical).lineLimit(1...4)
            .padding(14).background(Ink.raised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
          if let record {
            Button("移入回收站", role: .destructive) { confirmDelete = true }.font(Ink.meta)
              .frame(maxWidth: .infinity)
              .confirmationDialog("移入回收站？", isPresented: $confirmDelete) {
                Button("移入回收站", role: .destructive) {
                  Task {
                    await studio.remove(record)
                    dismiss()
                  }
                }
              }
          }
        }.padding(20)
      }
      .background(Ink.card)
      .environment(\.locale, Locale(identifier: "zh_CN"))
      .navigationTitle(record == nil ? "记一笔" : "编辑").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") { save() }.fontWeight(.semibold)
            .disabled(Money.minor(amount) == nil || title.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }
    }.studioSheet().presentationDetents([.large])
      .onAppear(perform: load)
  }
  func load() {
    guard let record else {
      amountFocused = true
      if let first = parents.first(where: { $0.flag("necessary") }) ?? parents.first {
        category = first.id
        necessary = first.flag("necessary")
        child = first.text("defaultChildId")
      }
      return
    }
    amount = Money.yuan(record.text("amountMinor"))
    title = record.title
    category = record.text("categoryId")
    child = record.text("subcategoryId")
    necessary = record.flag("necessary")
    day = CalendarDays.date(record.text("day")) ?? Date()
    mode = record.text("mode", "immediate")
    start = CalendarDays.date(record.text("startDay")) ?? day
    end = CalendarDays.date(record.text("endDay")) ?? start
    ended = CalendarDays.date(record.text("endedDay"))
    recovery = record.text("recoveryMinor").isEmpty ? "" : Money.yuan(record.text("recoveryMinor"))
    note = record.text("note")
  }
  func save() {
    guard let minor = Money.minor(amount) else { return }
    var data: [String: JSONValue] = record?.data ?? [:]
    data["title"] = .string(title)
    data["amountMinor"] = .string(minor)
    data["day"] = .string(CalendarDays.string(day))
    data["necessary"] = .bool(necessary)
    data["mode"] = .string(mode)
    data["categoryId"] = category.isEmpty ? nil : .string(category)
    data["subcategoryId"] = child.isEmpty ? nil : .string(child)
    data["note"] = note.isEmpty ? nil : .string(note)
    for key in ["startDay", "endDay", "endedDay", "recoveryMinor", "recoveryDay"] { data[key] = nil }
    if mode != "immediate" {
      data["startDay"] = .string(CalendarDays.string(start))
      data["endDay"] = .string(CalendarDays.string(max(start, end)))
      if let ended {
        data["endedDay"] = .string(CalendarDays.string(ended))
        if let r = Money.minor(recovery), r != "0" {
          data["recoveryMinor"] = .string(r)
          data["recoveryDay"] = .string(CalendarDays.string(ended))
        }
      }
    }
    Task {
      if await studio.save("expense", data, id: record?.id) != nil { dismiss() }
    }
  }
}

/// Wrapping row of selectable chips.
struct FlowChips: View {
  let items: [(String, String)]
  let selection: String
  var small = false
  let pick: (String) -> Void
  var body: some View {
    FlowLayout(spacing: 8) {
      ForEach(items, id: \.0) { item in
        let on = item.0 == selection
        Button {
          pick(item.0)
        } label: {
          Text(item.1).font(.system(size: small ? 13 : 15, weight: on ? .semibold : .regular))
            .foregroundStyle(on ? Color.black : Ink.text2).padding(.horizontal, small ? 12 : 15)
            .frame(height: small ? 30 : 38).background(on ? Ink.text : Ink.raised, in: Capsule())
        }.buttonStyle(.plain).sensoryFeedback(.selection, trigger: on)
      }
    }
  }
}

struct FlowLayout: Layout {
  var spacing: CGFloat = 8
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? 320
    var x: CGFloat = 0
    var y: CGFloat = 0
    var line: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x + size.width > width, x > 0 {
        x = 0
        y += line + spacing
        line = 0
      }
      x += size.width + spacing
      line = max(line, size.height)
    }
    return CGSize(width: width, height: y + line)
  }
  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX
    var y = bounds.minY
    var line: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x + size.width > bounds.maxX, x > bounds.minX {
        x = bounds.minX
        y += line + spacing
        line = 0
      }
      view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      line = max(line, size.height)
    }
  }
}
