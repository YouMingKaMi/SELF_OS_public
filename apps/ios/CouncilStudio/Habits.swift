import Charts
import CouncilCore
import SwiftUI

/// One habit on one day: progress ring, name, and the control its kind needs — reachable in one tap.
struct HabitLine: View {
  @Environment(Studio.self) private var studio
  let habit: Record
  let day: String
  var records: [Record] { studio.habitRecords }
  var body: some View {
    let records = records
    let log = HabitRules.log(habit: habit, day: day, records: records)
    let rule = HabitRules.rule(habit: habit, day: day, records: records)
    let kind = HabitRules.kind(habit: habit, rule: rule)
    let items = HabitRules.items(habit: habit, rule: rule)
    let target = HabitRules.target(rule: rule)
    let value = HabitRules.value(habit: habit, day: day, records: records)
    let done = HabitRules.isComplete(habit: habit, day: day, records: records)
    let checked = log?.data["items"]?.strings ?? []
    let progress =
      kind == "quantity"
      ? (value ?? 0) / max(target, 0.0001)
      : kind == "checklist" ? Double(checked.filter(items.contains).count) / Double(max(items.count, 1))
      : done ? 1 : 0
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 12) {
        Button {
          if kind == "binary" { save(done ? 0 : 1, log: log, rule: rule) }
          if kind == "quantity" && !done { save(target, log: log, rule: rule) }
        } label: {
          Ring(value: progress, size: 26)
        }.buttonStyle(.plain).sensoryFeedback(.success, trigger: done) { _, new in new }
          .accessibilityLabel(habit.title)
        VStack(alignment: .leading, spacing: 2) {
          Text(habit.title).font(.system(size: 16, weight: .medium)).foregroundStyle(Ink.text)
          Text(caption(kind: kind, value: value, target: target, rule: rule, done: done))
            .font(.system(size: 12)).monospacedDigit().foregroundStyle(Ink.text3)
        }
        Spacer(minLength: 4)
        if kind == "quantity" {
          HStack(spacing: 0) {
            Button {
              save(max(0, (value ?? 0) - 1), log: log, rule: rule)
            } label: {
              Image(systemName: "minus").frame(width: 34, height: 34)
            }.accessibilityLabel("减少 " + habit.title)
            Text(number(value ?? 0)).font(.system(size: 16, weight: .semibold, design: .rounded))
              .monospacedDigit().frame(minWidth: 26).contentTransition(.numericText())
            Button {
              save((value ?? 0) + 1, log: log, rule: rule)
            } label: {
              Image(systemName: "plus").frame(width: 34, height: 34)
            }.accessibilityLabel("增加 " + habit.title)
          }.buttonStyle(.plain).font(.system(size: 13, weight: .bold)).foregroundStyle(Ink.text)
            .background(Ink.raised, in: Capsule())
            .sensoryFeedback(.increase, trigger: value)
        }
      }
      if kind == "checklist" {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 6) {
            ForEach(items, id: \.self) { item in
              let on = checked.contains(item)
              Button {
                let next = on ? checked.filter { $0 != item } : checked + [item]
                save(Double(next.count), items: next, log: log, rule: rule)
              } label: {
                HStack(spacing: 4) {
                  Image(systemName: on ? "checkmark" : "plus").font(.system(size: 10, weight: .bold))
                  Text(item)
                }.font(.system(size: 13, weight: on ? .semibold : .regular))
                  .foregroundStyle(on ? Color.black : Ink.text2).padding(.horizontal, 11).frame(height: 30)
                  .background(on ? Ink.text : Ink.raised, in: Capsule())
              }.buttonStyle(.plain).sensoryFeedback(.selection, trigger: on)
            }
          }.padding(.leading, 38)
        }
      }
    }
  }
  func caption(kind: String, value: Double?, target: Double, rule: Record?, done: Bool) -> String {
    let unit = HabitRules.unit(habit: habit, rule: rule)
    if kind == "quantity" {
      return "\(number(value ?? 0)) / \(number(target)) \(unit)" + (done ? " · 已达成" : "")
    }
    if habit.text("status") == "paused" { return "计划暂停 · 可随手记录" }
    return done ? "已完成" : "待记录"
  }
  func number(_ value: Double) -> String {
    value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
  }
  func save(_ value: Double, items: [String]? = nil, log: Record?, rule: Record?) {
    var data: [String: JSONValue] = log?.data ?? [:]
    data["habitId"] = .string(habit.id)
    data["day"] = .string(day)
    data["value"] = .number(value)
    if let items { data["items"] = .array(items.map(JSONValue.string)) }
    if data["hidden"] == nil { data["hidden"] = .bool(false) }
    if data["ruleId"] == nil, let rule { data["ruleId"] = .string(rule.id) }
    Task { await studio.save("habitLog", data, id: log?.id) }
  }
}

struct HabitsScreen: View {
  @Environment(Studio.self) private var studio
  @State private var day = Day.today
  @State private var month = String(Day.today.prefix(7))
  @State private var selected = ""
  @State private var editing: Record?
  @State private var adding = false
  @State private var showArchived = false
  var habits: [Record] {
    studio.all("habit").filter { showArchived || $0.text("status") != "archived" }
      .sorted { $0.number("order") < $1.number("order") }
  }
  var focus: Record? { habits.first { $0.id == selected } ?? habits.first }
  var body: some View {
    Page {
      DayStrip(day: $day).padding(.horizontal, 4)
      Card {
        VStack(spacing: 0) {
          ForEach(Array(habits.enumerated()), id: \.element.id) { index, habit in
            if index > 0 { Hairline(inset: 38) }
            HabitLine(habit: habit, day: day).padding(.vertical, 12)
              .contentShape(Rectangle())
              .onTapGesture { withAnimation(.snappy) { selected = habit.id } }
              .contextMenu {
                Button("查看本月", systemImage: "chart.bar") { selected = habit.id }
                Button("编辑计划", systemImage: "slider.horizontal.3") { editing = habit }
                Button(
                  habit.text("status") == "paused" ? "恢复计划" : "暂停计划",
                  systemImage: habit.text("status") == "paused" ? "play" : "pause"
                ) {
                  Task {
                    await studio.update(
                      habit, ["status": .string(habit.text("status") == "paused" ? "active" : "paused")])
                  }
                }
                Button(
                  habit.flag("showHome") ? "不在首页显示" : "在首页显示",
                  systemImage: habit.flag("showHome") ? "eye.slash" : "eye"
                ) {
                  Task { await studio.update(habit, ["showHome": .bool(!habit.flag("showHome"))]) }
                }
              }
          }
          if habits.isEmpty { EmptyNote(text: "添加一个希望留下记录的习惯", icon: "repeat") }
        }
      }
      if let focus { MonthCard(habit: focus, month: $month, day: $day) }
      Button(showArchived ? "隐藏已停用" : "查看已停用") { showArchived.toggle() }
        .font(Ink.meta).foregroundStyle(Ink.text3).frame(maxWidth: .infinity)
    }
    .studioScreen("习惯")
    .toolbar {
      Button {
        adding = true
      } label: {
        Image(systemName: "plus")
      }.accessibilityLabel("添加习惯")
    }
    .sheet(item: $editing) { HabitPlanSheet(habit: $0) }
    .sheet(isPresented: $adding) { HabitPlanSheet(habit: nil) }
  }
}

/// A month at a glance: completion heat calendar on a real weekday grid, then the daily values.
struct MonthCard: View {
  @Environment(Studio.self) private var studio
  let habit: Record
  @Binding var month: String
  @Binding var day: String
  var body: some View {
    let records = studio.habitRecords
    let days = HabitRules.days(in: month)
    let summary = HabitRules.month(habit: habit, month: month, records: records)
    let lead = (CalendarDays.date(month + "-01").map { CalendarDays.calendar.component(.weekday, from: $0) } ?? 1) - 1
    let values = days.map { HabitRules.value(habit: habit, day: $0, records: records) }
    let kind = HabitRules.kind(habit: habit, rule: HabitRules.rule(habit: habit, day: days.last ?? Day.today, records: records))
    let elapsed = max(1, days.filter { $0 <= Day.today }.count)
    let rate = "\(Int((Double(summary.completedDays) / Double(elapsed) * 100).rounded()))%"
    Card(icon: "calendar", title: habit.title, meta: "本月") {
      MonthBar(month: $month)
      // Totals only mean something for quantities; check-ins and checklists are about how often.
      StatRow(items: kind == "quantity"
        ? [
          ("记录", "\(summary.recordedDays)/\(days.count)"),
          ("完成", "\(summary.completedDays)"),
          ("合计", number(summary.total)),
          ("日均", summary.recordedAverage.map(number) ?? "—"),
        ]
        : [
          (kind == "checklist" ? "全部完成" : "打卡", "\(summary.completedDays)/\(elapsed)"),
          ("完成率", rate),
          ("连续", "\(streak(records: records)) 天"),
        ])
      LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 5), count: 7), spacing: 5) {
        ForEach(Array("日一二三四五六"), id: \.self) { w in
          Text(String(w)).font(Ink.micro).foregroundStyle(Ink.text3)
        }
        ForEach(0..<lead, id: \.self) { _ in Color.clear.frame(height: 38) }
        ForEach(Array(days.enumerated()), id: \.element) { index, date in
          let done = HabitRules.isComplete(habit: habit, day: date, records: records)
          let recorded = values[index] != nil
          Button {
            day = date
          } label: {
            Text(String(Int(date.suffix(2)) ?? 0)).font(.system(size: 13, weight: .medium, design: .rounded))
              .foregroundStyle(done ? Color.black : recorded ? Ink.text : Ink.text3)
              .frame(maxWidth: .infinity).frame(height: 38)
              .background(
                done ? Ink.text : recorded ? Color.white.opacity(0.16) : Ink.raised.opacity(0.6),
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
              )
              .overlay {
                if date == day {
                  RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Ink.text2, lineWidth: 1.5)
                    .padding(-2.5)
                }
              }
          }.buttonStyle(.plain)
        }
      }
      if kind == "checklist" {
        ItemMatrix(habit: habit, days: days, records: records)
      }
      if values.contains(where: { $0 != nil }) && kind == "quantity" {
        Chart {
          ForEach(Array(days.enumerated()), id: \.element) { index, date in
            if let v = values[index] {
              BarMark(x: .value("日", Int(date.suffix(2)) ?? 0), y: .value("值", v), width: 6)
                .foregroundStyle(Ink.text).clipShape(Capsule())
            }
          }
        }.chartXAxis {
          AxisMarks(values: [1, 8, 15, 22, 29]) { AxisValueLabel().foregroundStyle(Ink.text3) }
        }.chartYAxis {
          AxisMarks(position: .trailing) {
            AxisGridLine().foregroundStyle(Ink.line)
            AxisValueLabel().foregroundStyle(Ink.text3)
          }
        }.frame(height: 120)
      }
    }
  }
  func number(_ value: Double) -> String {
    value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
  }
  /// Completed days in a row, ending today (or yesterday if today is not done yet).
  func streak(records: [Record]) -> Int {
    var cursor = HabitRules.isComplete(habit: habit, day: Day.today, records: records) ? Day.today : Day.shift(Day.today, -1)
    var count = 0
    while HabitRules.isComplete(habit: habit, day: cursor, records: records) && count < 3660 {
      count += 1
      cursor = Day.shift(cursor, -1)
    }
    return count
  }
}

/// Checklist habits: one row per item, one cell per day.
struct ItemMatrix: View {
  let habit: Record
  let days: [String]
  let records: [Record]
  var body: some View {
    let logs = Dictionary(
      days.compactMap { d in HabitRules.log(habit: habit, day: d, records: records).map { (d, $0.data["items"]?.strings ?? []) } },
      uniquingKeysWith: { a, _ in a })
    let planned = HabitRules.items(habit: habit, rule: HabitRules.rule(habit: habit, day: days.last ?? Day.today, records: records))
    let items = planned + Array(Set(logs.values.flatMap { $0 })).filter { !planned.contains($0) }.sorted()
    let elapsed = max(1, days.filter { $0 <= Day.today }.count)
    VStack(alignment: .leading, spacing: 9) {
      Text("各项打卡").font(.system(size: 12, weight: .medium)).foregroundStyle(Ink.text2)
      ForEach(items, id: \.self) { item in
        let count = days.filter { logs[$0]?.contains(item) == true }.count
        VStack(alignment: .leading, spacing: 5) {
          HStack {
            Text(item).font(.system(size: 13, weight: .medium)).foregroundStyle(Ink.text)
            Spacer()
            Text("\(count)").font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundStyle(Ink.text)
              + Text(" / \(elapsed) 天").font(.system(size: 11)).foregroundStyle(Ink.text3)
          }
          HStack(spacing: 2.5) {
            ForEach(days, id: \.self) { d in
              RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(logs[d]?.contains(item) == true ? Ink.text : Color.white.opacity(0.08))
                .frame(height: 12).opacity(d > Day.today ? 0.4 : 1)
            }
          }
        }
      }
    }.padding(.top, 6)
  }
}

/// Plan editor. Rule changes start a new rule version from the chosen day; history is never rewritten.
struct HabitPlanSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let habit: Record?
  @State private var name = ""
  @State private var kind = "binary"
  @State private var unit = ""
  @State private var items = ""
  @State private var target = 1.0
  @State private var weekdays: Set<String> = Set((0...6).map(String.init))
  @State private var status = "active"
  @State private var showHome = true
  @State private var effective = Date()
  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("名称", text: $name).font(.system(size: 18))
          Picker("记录方式", selection: $kind) {
            Text("打卡").tag("binary")
            Text("数量").tag("quantity")
            Text("多项").tag("checklist")
          }.pickerStyle(.segmented)
          if kind == "quantity" {
            HStack {
              Text("最低目标")
              Spacer()
              TextField("1", value: $target, format: .number).keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing).frame(width: 80)
              TextField("单位", text: $unit).frame(width: 60)
            }
          }
          if kind == "checklist" {
            TextField("每行一项", text: $items, axis: .vertical).lineLimit(3...8)
          }
        }.listRowBackground(Ink.raised)
        Section("安排") {
          HStack(spacing: 6) {
            ForEach(Array("日一二三四五六".enumerated()), id: \.offset) { index, label in
              let key = String(index)
              Button {
                if weekdays.contains(key) { weekdays.remove(key) } else { weekdays.insert(key) }
              } label: {
                Text(String(label)).font(.system(size: 14, weight: .semibold))
                  .foregroundStyle(weekdays.contains(key) ? Color.black : Ink.text2)
                  .frame(maxWidth: .infinity).frame(height: 36)
                  .background(weekdays.contains(key) ? Ink.text : Ink.card, in: Circle())
              }.buttonStyle(.plain)
            }
          }
          Picker("状态", selection: $status) {
            Text("按计划").tag("active")
            Text("暂停计划").tag("paused")
            Text("随手记录").tag("optional")
            Text("停用").tag("archived")
          }
          Toggle("在今日显示", isOn: $showHome)
          DatePicker("新规则从", selection: $effective, displayedComponents: .date)
        }.listRowBackground(Ink.raised)
      }
      .scrollContentBackground(.hidden).background(Ink.card)
      .environment(\.locale, Locale(identifier: "zh_CN"))
      .navigationTitle(habit == nil ? "添加习惯" : "编辑计划").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") { save() }.fontWeight(.semibold)
            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }
    }.studioSheet()
      .onAppear {
        guard let habit else { return }
        let rule = HabitRules.rule(habit: habit, day: Day.today, records: studio.habitRecords)
        name = habit.title
        kind = HabitRules.kind(habit: habit, rule: rule)
        unit = HabitRules.unit(habit: habit, rule: rule)
        items = HabitRules.items(habit: habit, rule: rule).joined(separator: "\n")
        target = HabitRules.target(rule: rule)
        if let days = rule?.data["weekdays"]?.strings { weekdays = Set(days) }
        status = habit.text("status", "active")
        showHome = habit.flag("showHome")
      }
  }
  func save() {
    let list = items.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter {
      !$0.isEmpty
    }
    var data: [String: JSONValue] = habit?.data ?? [:]
    data["name"] = .string(name)
    data["kind"] = .string(kind)
    data["unit"] = .string(unit)
    data["items"] = .array(list.map(JSONValue.string))
    data["status"] = .string(status)
    data["showHome"] = .bool(showHome)
    if data["order"] == nil { data["order"] = .number(Double(studio.all("habit").count)) }
    Task {
      guard let id = await studio.save("habit", data, id: habit?.id) else { return }
      let rule = habit.flatMap { HabitRules.rule(habit: $0, day: Day.today, records: studio.habitRecords) }
      let changed =
        rule == nil || rule!.text("kind") != kind || HabitRules.target(rule: rule) != target
        || Set(rule!.data["weekdays"]?.strings ?? []) != weekdays
        || rule!.data["items"]?.strings ?? [] != list || rule!.text("unit") != unit
      if changed {
        await studio.save(
          "habitRule",
          [
            "habitId": .string(id), "effectiveFrom": .string(CalendarDays.string(effective)),
            "target": .number(target), "weekdays": .array(weekdays.sorted().map(JSONValue.string)),
            "kind": .string(kind), "unit": .string(unit), "items": .array(list.map(JSONValue.string)),
          ])
      }
      dismiss()
    }
  }
}
