import Charts
import CouncilCore
import SwiftUI

// MARK: - Metrics

struct MetricsScreen: View {
  @Environment(Studio.self) private var studio
  @State private var day = Day.today
  @State private var month = String(Day.today.prefix(7))
  @State private var selected = ""
  @State private var form: EntityForm?
  var metrics: [Record] { studio.all("metric") }
  var focus: Record? { metrics.first { $0.id == selected } ?? metrics.first }
  var body: some View {
    let logs = Dictionary(grouping: studio.all("metricLog")) { $0.text("metricId") }
    let recentDays = (0..<14).reversed().map { Day.shift(day, -$0) }
    Page {
      DayStrip(day: $day).padding(.horizontal, 4)
      Card {
        VStack(spacing: 0) {
          ForEach(Array(metrics.enumerated()), id: \.element.id) { index, metric in
            if index > 0 { Hairline() }
            MetricRow(metric: metric, day: day, selected: metric.id == focus?.id,
                      logs: logs[metric.id] ?? [], recentDays: recentDays)
              .contentShape(Rectangle()).onTapGesture { withAnimation(.snappy) { selected = metric.id } }
              .contextMenu {
                Button("编辑指标", systemImage: "pencil") { form = EntityForm(type: "metric", record: metric) }
              }
          }
          if metrics.isEmpty { EmptyNote(text: "添加睡眠、心情或你关心的指标", icon: "waveform.path.ecg") }
        }
      }
      if let focus { MetricMonth(metric: focus, month: $month, logs: logs[focus.id] ?? []) }
    }
    .studioScreen("每日指标")
    .toolbar {
      Button {
        form = EntityForm(type: "metric", defaults: ["minimum": .number(0), "maximum": .number(10)])
      } label: {
        Image(systemName: "plus")
      }
    }
    .sheet(item: $form) { EntityFormSheet(form: $0) }
  }
}

struct MetricRow: View {
  @Environment(Studio.self) private var studio
  let metric: Record
  let day: String
  let selected: Bool
  let logs: [Record]
  let recentDays: [String]
  var body: some View {
    let firstDay = recentDays.first ?? day
    let byDay = Dictionary(grouping: logs.filter {
      let date = $0.text("day")
      return date >= firstDay && date <= day
    }) { $0.text("day") }
    let candidates = byDay[day] ?? []
    let value = MetricRules.value(candidates)
    let recent = recentDays.map { MetricRules.value(byDay[$0] ?? []) }
    let lo = metric.data["minimum"]?.double ?? 0
    let hi = metric.data["maximum"]?.double ?? 10
    let step = hi - lo > 20 ? 1.0 : 0.5
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 3) {
        Text(metric.title).font(.system(size: 16, weight: selected ? .semibold : .medium)).foregroundStyle(Ink.text)
        Text("\(TodayMetricsCard.number(lo))–\(TodayMetricsCard.number(hi)) \(metric.text("unit"))")
          .font(.system(size: 11)).monospacedDigit().foregroundStyle(Ink.text3)
      }
      Spacer(minLength: 4)
      Spark(values: recent).frame(width: 58, height: 22)
      HStack(spacing: 0) {
        Button {
          set(max(lo, (value ?? lo + step) - step), existing: candidates.first)
        } label: {
          Image(systemName: "minus").frame(width: 38, height: 38).contentShape(Rectangle())
        }
        Text(candidates.count > 1 ? "待核对" : value.map(TodayMetricsCard.number) ?? "—")
          .font(.system(size: 17, weight: .semibold, design: .rounded)).monospacedDigit()
          .foregroundStyle(value == nil ? Ink.text3 : Ink.text).frame(minWidth: 36).contentTransition(.numericText())
        Button {
          set(min(hi, (value ?? lo) + (value == nil ? 0 : step)), existing: candidates.first)
        } label: {
          Image(systemName: "plus").frame(width: 38, height: 38).contentShape(Rectangle())
        }
      }.buttonStyle(.plain).font(.system(size: 12, weight: .bold)).foregroundStyle(Ink.text)
        .background(Ink.raised, in: Capsule()).sensoryFeedback(.selection, trigger: value)
        .disabled(candidates.count > 1)
    }.padding(.vertical, 11)
  }
  func set(_ value: Double, existing: Record?) {
    Task {
      if let existing {
        await studio.update(existing, ["value": .number(value)])
      } else {
        await studio.save(
          "metricLog", ["metricId": .string(metric.id), "day": .string(day), "value": .number(value)])
      }
    }
  }
}

struct MetricMonth: View {
  let metric: Record
  @Binding var month: String
  let logs: [Record]
  var body: some View {
    let monthLogs = logs.filter { $0.text("day").hasPrefix(month) }
    let summary = MetricRules.summary(monthLogs)
    let days = Dictionary(grouping: monthLogs) { $0.text("day") }
    let samples = days.keys.sorted().compactMap { key in MetricRules.value(days[key] ?? []).map { (key, $0) } }
    let duplicates = days.values.filter { $0.count > 1 }.flatMap { $0 }.sorted { ($0.text("day"), $0.id) < ($1.text("day"), $1.id) }
    Card(icon: "chart.xyaxis.line", title: metric.title, meta: "缺失的日子不计入平均") {
      MonthBar(month: $month)
      StatRow(items: [
        ("记录", "\(summary.count) 天"),
        ("平均", summary.average.map { String(format: "%.2f", $0) } ?? "—"),
        ("最高", summary.maximum.map(TodayMetricsCard.number) ?? "—"),
        ("最低", summary.minimum.map(TodayMetricsCard.number) ?? "—"),
      ])
      if !samples.isEmpty {
        Chart(samples, id: \.0) { sample in
          LineMark(x: .value("日", Int(sample.0.suffix(2)) ?? 0), y: .value("值", sample.1))
            .foregroundStyle(Ink.text).interpolationMethod(.monotone)
          PointMark(x: .value("日", Int(sample.0.suffix(2)) ?? 0), y: .value("值", sample.1))
            .foregroundStyle(Ink.text).symbolSize(18)
        }
        .chartXScale(domain: 1...31)
        .chartXAxis { AxisMarks(values: [1, 8, 15, 22, 29]) { AxisValueLabel().foregroundStyle(Ink.text3) } }
        .chartYAxis { AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { AxisGridLine().foregroundStyle(Ink.line); AxisValueLabel().foregroundStyle(Ink.text3) } }
        .frame(height: 140)
      }
      if !duplicates.isEmpty {
        Text("待核对的重复记录").font(Ink.meta).foregroundStyle(Ink.text3)
        ForEach(duplicates) { row in
          let value = row.data["value"]?.numberValue
          let amount = value.map(TodayMetricsCard.number) ?? "未填数值"
          Text("\(row.text("day")) · \(amount) · \(row.text("note", row.id))")
            .font(Ink.meta)
            .foregroundStyle(Ink.text3)
        }
      }
    }
  }
}

// MARK: - Important days

struct DaysScreen: View {
  @Environment(Studio.self) private var studio
  @State private var editing: Record?
  @State private var adding = false
  var body: some View {
    let days = studio.all("importantDay").map { ($0, DayRule.daysUntil($0)) }
      .sorted { ($0.1 ?? 99999) < ($1.1 ?? 99999) }
    Page {
      if let first = days.first, let n = first.1 {
        Card {
          VStack(alignment: .leading, spacing: 6) {
            Text("下一个").font(Ink.meta).foregroundStyle(Ink.text3)
            Text(first.0.title).font(.system(size: 22, weight: .bold)).foregroundStyle(Ink.text)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
              Text(n == 0 ? "就是今天" : "\(n)").font(.system(size: 64, weight: .semibold, design: .rounded))
                .monospacedDigit().foregroundStyle(n == 0 ? Ink.amber : Ink.text)
              if n > 0 { Text("天后").font(Ink.body).foregroundStyle(Ink.text2) }
            }
            if let next = DayRule.next(first.0) {
              Text(CalendarDays.string(next) + " · " + DayRule.lunarText(next)).font(Ink.meta)
                .foregroundStyle(Ink.text3)
            }
          }
        }.onTapGesture { editing = first.0 }
      }
      Card {
        VStack(spacing: 0) {
          ForEach(Array(days.dropFirst().enumerated()), id: \.element.0.id) { index, item in
            if index > 0 { Hairline() }
            Button {
              editing = item.0
            } label: {
              HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 3) {
                  Text(item.0.title).font(Ink.row).foregroundStyle(Ink.text)
                  Text(
                    (DayRule.next(item.0).map { CalendarDays.string($0) } ?? "日期待检查") + " · "
                      + (item.0.text("calendar") == "lunar" ? "农历" : "公历") + " · " + Words.of(item.0.text("repeat"))
                  ).font(.system(size: 12)).monospacedDigit().foregroundStyle(Ink.text3)
                }
                Spacer()
                if let n = item.1 {
                  Text(n == 0 ? "今天" : "\(n)").font(Ink.figureSmall).monospacedDigit()
                    .foregroundStyle(n <= Int(item.0.number("remindDays")) ? Ink.amber : Ink.text)
                  if n > 0 { Text("天").font(Ink.meta).foregroundStyle(Ink.text3) }
                }
              }.padding(.vertical, 11)
            }.buttonStyle(.row)
          }
          if days.count <= 1 { EmptyNote(text: days.isEmpty ? "生日、纪念日与想记住的日子" : "只有这一个日子") }
        }
      }
    }
    .studioScreen("重要日子")
    .toolbar {
      Button {
        adding = true
      } label: {
        Image(systemName: "plus")
      }.accessibilityLabel("添加重要日子")
    }
    .sheet(item: $editing) { DayEditor(record: $0) }
    .sheet(isPresented: $adding) { DayEditor(record: nil) }
  }
}

/// Pick the real date once; for lunar days the lunar month/day (and leap) are derived from it.
struct DayEditor: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let record: Record?
  @State private var name = ""
  @State private var lunar = false
  @State private var date = Date()
  @State private var repeatRule = "yearly"
  @State private var interval = 1
  @State private var unit = "day"
  @State private var remind = 3
  @State private var note = ""
  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("名称", text: $name).font(.system(size: 18))
          Picker("历法", selection: $lunar) {
            Text("公历").tag(false)
            Text("农历").tag(true)
          }.pickerStyle(.segmented)
          DatePicker("日期", selection: $date, displayedComponents: .date)
          if lunar { LabeledContent("对应农历", value: DayRule.lunarText(date)) }
        }.listRowBackground(Ink.raised)
        Section {
          Picker("重复", selection: $repeatRule) {
            ForEach(["once", "weekly", "monthly", "yearly", "custom"], id: \.self) { Text(Words.of($0)).tag($0) }
          }
          if repeatRule == "custom" {
            Stepper("每 \(interval) \(Words.of(unit))", value: $interval, in: 1...1000)
            Picker("单位", selection: $unit) {
              ForEach(["day", "week", "month", "year"], id: \.self) { Text(Words.of($0)).tag($0) }
            }.pickerStyle(.segmented)
          }
          Stepper("提前 \(remind) 天提醒", value: $remind, in: 0...60)
          TextField("备注", text: $note, axis: .vertical).lineLimit(1...4)
        }.listRowBackground(Ink.raised)
        if let record {
          Section {
            Button("移入回收站", role: .destructive) {
              Task {
                await studio.remove(record)
                dismiss()
              }
            }
          }.listRowBackground(Ink.raised)
        }
      }
      .scrollContentBackground(.hidden).background(Ink.card)
      .environment(\.locale, Locale(identifier: "zh_CN"))
      .navigationTitle(record == nil ? "添加日子" : "编辑日子").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") { save() }.fontWeight(.semibold).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }
    }.studioSheet()
      .onAppear {
        guard let record else { return }
        name = record.title
        lunar = record.text("calendar") == "lunar"
        date = DayRule.date(record) ?? Date()
        repeatRule = record.text("repeat", "yearly")
        interval = max(1, Int(record.number("interval")))
        unit = record.text("intervalUnit", "day")
        remind = Int(record.number("remindDays"))
        note = record.text("note")
      }
  }
  func save() {
    let parts = DayRule.lunar.dateComponents([.year, .month, .day], from: date)
    let solarYear = DayRule.solar.component(.year, from: date)
    var data: [String: JSONValue] = record?.data ?? [:]
    data["name"] = .string(name)
    data["calendar"] = .string(lunar ? "lunar" : "solar")
    data["date"] = .string(CalendarDays.string(date))
    // Lunar year is stored as the Gregorian year in which that lunar year mostly falls.
    data["lunarYear"] = .number(Double((parts.month ?? 1) >= 11 && DayRule.solar.component(.month, from: date) <= 2 ? solarYear - 1 : solarYear))
    data["lunarMonth"] = .number(Double(parts.month ?? 1))
    data["lunarDay"] = .number(Double(parts.day ?? 1))
    data["leap"] = .bool(DayRule.lunar.dateComponents([.month], from: date).isLeapMonth ?? false)
    data["repeat"] = .string(repeatRule)
    data["interval"] = .number(Double(interval))
    data["intervalUnit"] = .string(unit)
    data["remindDays"] = .number(Double(remind))
    data["note"] = note.isEmpty ? nil : .string(note)
    Task { if await studio.save("importantDay", data, id: record?.id) != nil { dismiss() } }
  }
}

// MARK: - Checklists

struct ChecklistsScreen: View {
  @Environment(Studio.self) private var studio
  @State private var selected = ""
  @State private var editing: Record?
  @State private var adding = false
  var templates: [Record] { studio.all("checklist") }
  var current: Record? { templates.first { $0.id == selected } ?? templates.first }
  var body: some View {
    let day = Day.today
    let run = current.flatMap { list in
      studio.all("checklistRun").filter { $0.text("checklistId") == list.id && $0.text("day") == day }
        .sorted { lhs, rhs in
          if lhs.updatedAt != rhs.updatedAt { return lhs.updatedAt > rhs.updatedAt }
          if lhs.version != rhs.version { return lhs.version > rhs.version }
          return lhs.id < rhs.id
        }.first
    }
    let state = ChecklistRules.state(current, run: run)
    Page {
      ChipBar(options: templates.map { ($0.id, $0.title) }, selection: Binding(get: { current?.id ?? "" }, set: { selected = $0 }))
      if let current {
        Card {
          HStack(alignment: .firstTextBaseline) {
            Text("\(state.checked.count)").font(Ink.figure).monospacedDigit()
              .contentTransition(.numericText())
            Text("/ \(state.items.count)").font(Ink.figureSmall).foregroundStyle(Ink.text3)
            Spacer()
            if !state.checked.isEmpty {
              Button("重置本次") { save(current, run: run, day: day, state: state, checked: []) }.buttonStyle(.chip)
            }
          }.foregroundStyle(Ink.text)
          Meter(value: state.items.isEmpty ? 0 : Double(state.checked.count) / Double(state.items.count))
          if !state.ambiguous.isEmpty {
            Text("旧记录需核对 · " + state.ambiguous.sorted().joined(separator: "、"))
              .font(Ink.meta).foregroundStyle(Ink.text3)
          }
          VStack(spacing: 0) {
            ForEach(Array(state.items.enumerated()), id: \.element.id) { index, item in
              if index > 0 { Hairline(inset: 40) }
              let on = state.checked.contains(item.id)
              Button {
                var checked = state.checked
                if on { checked.remove(item.id) } else { checked.insert(item.id) }
                save(current, run: run, day: day, state: state, checked: checked)
              } label: {
                HStack(spacing: 14) {
                  Ring(value: on ? 1 : 0, size: 24)
                  Text(item.label).font(.system(size: 17)).foregroundStyle(on ? Ink.text3 : Ink.text)
                    .strikethrough(on, color: Ink.text3)
                  Spacer()
                }.padding(.vertical, 13)
              }.buttonStyle(.row).sensoryFeedback(.success, trigger: on) { _, new in new }
            }
          }
        }
        Text("勾选只属于今天这一次，不会改动清单本身。").font(.system(size: 12)).foregroundStyle(Ink.text3)
          .padding(.horizontal, 6)
      } else {
        Card { EmptyNote(text: "创建出门、洗澡或睡前清单", icon: "list.bullet.clipboard") }
      }
    }
    .studioScreen("准备清单")
    .toolbar {
      Menu {
        Button("新清单", systemImage: "plus") { adding = true }
        if let current { Button("编辑这份清单", systemImage: "pencil") { editing = current } }
      } label: {
        Image(systemName: "ellipsis")
      }
    }
    .sheet(item: $editing) { ChecklistSheet(record: $0) { selected = $0 } }
    .sheet(isPresented: $adding) { ChecklistSheet(record: nil) { selected = $0 } }
  }
  func save(_ list: Record, run: Record?, day: String, state: ChecklistState, checked: Set<String>) {
    var data = state.fields(checked: checked)
    data["checklistId"] = .string(list.id)
    data["day"] = .string(day)
    Task {
      await studio.save(
        "checklistRun", data, id: run?.id ?? StableID.forKey("checklistRun:" + list.id + ":" + day))
    }
  }
}

private struct ChecklistSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let record: Record?
  let onSaved: (String) -> Void
  @State private var name = ""
  @State private var input = ""
  @State private var items: [ChecklistItem] = []
  @State private var saving = false
  @State private var confirmDelete = false

  var body: some View {
    NavigationStack {
      Form {
        TextField("场景名称", text: $name)
        if record == nil {
          TextField("每行一个要准备的东西", text: $input, axis: .vertical).lineLimit(3...10)
        } else {
          ForEach($items) { $item in
            TextField("项目名称", text: $item.label)
          }.onDelete { items.remove(atOffsets: $0) }
          Button("添加项目", systemImage: "plus") {
            items.append(ChecklistItem(id: UUID().uuidString.lowercased(), label: ""))
          }
          Button("移入回收站", role: .destructive) { confirmDelete = true }
        }
      }
      .navigationTitle(record == nil ? "新清单" : "编辑清单")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存", action: save)
            .disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
              (record == nil ? input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty :
                  !items.contains { !$0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }))
        }
      }
      .confirmationDialog("移入回收站？", isPresented: $confirmDelete) {
        Button("移入回收站", role: .destructive) {
          guard let record else { return }
          Task { await studio.remove(record); dismiss() }
        }
      }
    }.studioSheet()
      .onAppear { name = record?.title ?? ""; items = ChecklistRules.items(record) }
  }

  private func save() {
    let source = record != nil ? items : input.split(separator: "\n").map {
      ChecklistItem(id: UUID().uuidString.lowercased(), label: String($0))
    }
    let rows = source.map { ChecklistItem(id: $0.id, label: $0.label.trimmingCharacters(in: .whitespacesAndNewlines)) }
      .filter { !$0.label.isEmpty }
    guard !saving, !rows.isEmpty else { return }
    saving = true
    Task {
      let data: [String: JSONValue] = [
        "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
        "items": .array(rows.map { .string($0.label) }),
        "itemIds": .array(rows.map { .string($0.id) }),
      ]
      if let id = await studio.save("checklist", data, id: record?.id) {
        onSaved(id)
        dismiss()
      }
      saving = false
    }
  }
}
