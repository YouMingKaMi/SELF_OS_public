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
    Page {
      DayStrip(day: $day).padding(.horizontal, 4)
      Card {
        VStack(spacing: 0) {
          ForEach(Array(metrics.enumerated()), id: \.element.id) { index, metric in
            if index > 0 { Hairline() }
            MetricRow(metric: metric, day: day, selected: metric.id == focus?.id)
              .contentShape(Rectangle()).onTapGesture { withAnimation(.snappy) { selected = metric.id } }
              .contextMenu {
                Button("编辑指标", systemImage: "pencil") { form = EntityForm(type: "metric", record: metric) }
              }
          }
          if metrics.isEmpty { EmptyNote(text: "添加睡眠、心情或你关心的指标", icon: "waveform.path.ecg") }
        }
      }
      if let focus { MetricMonth(metric: focus, month: $month) }
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
  var body: some View {
    let logs = studio.all("metricLog").filter { $0.text("metricId") == metric.id }
    let log = logs.first { $0.text("day") == day }
    let recent = (0..<14).reversed().map { offset -> Double? in
      let d = Day.shift(day, -offset)
      return logs.first { $0.text("day") == d }.map { $0.number("value") }
    }
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
          set(max(lo, (log?.number("value") ?? lo + step) - step))
        } label: {
          Image(systemName: "minus").frame(width: 32, height: 34)
        }
        Text(log.map { TodayMetricsCard.number($0.number("value")) } ?? "—")
          .font(.system(size: 17, weight: .semibold, design: .rounded)).monospacedDigit()
          .foregroundStyle(log == nil ? Ink.text3 : Ink.text).frame(minWidth: 34).contentTransition(.numericText())
        Button {
          set(min(hi, (log?.number("value") ?? lo) + (log == nil ? 0 : step)))
        } label: {
          Image(systemName: "plus").frame(width: 32, height: 34)
        }
      }.buttonStyle(.plain).font(.system(size: 12, weight: .bold)).foregroundStyle(Ink.text)
        .background(Ink.raised, in: Capsule()).sensoryFeedback(.selection, trigger: log?.number("value"))
    }.padding(.vertical, 11)
  }
  func set(_ value: Double) {
    Task {
      await studio.save(
        "metricLog", ["metricId": .string(metric.id), "day": .string(day), "value": .number(value)])
    }
  }
}

struct MetricMonth: View {
  @Environment(Studio.self) private var studio
  let metric: Record
  @Binding var month: String
  var body: some View {
    let logs = studio.all("metricLog").filter { $0.text("metricId") == metric.id && $0.text("day").hasPrefix(month) }
    let summary = MetricRules.summary(logs)
    Card(icon: "chart.xyaxis.line", title: metric.title, meta: "缺失的日子不计入平均") {
      MonthBar(month: $month)
      StatRow(items: [
        ("记录", "\(summary.count) 天"),
        ("平均", summary.average.map { String(format: "%.2f", $0) } ?? "—"),
        ("最高", summary.maximum.map(TodayMetricsCard.number) ?? "—"),
        ("最低", summary.minimum.map(TodayMetricsCard.number) ?? "—"),
      ])
      if !logs.isEmpty {
        Chart(logs.sorted { $0.text("day") < $1.text("day") }) { log in
          LineMark(x: .value("日", Int(log.text("day").suffix(2)) ?? 0), y: .value("值", log.number("value")))
            .foregroundStyle(Ink.text).interpolationMethod(.monotone)
          PointMark(x: .value("日", Int(log.text("day").suffix(2)) ?? 0), y: .value("值", log.number("value")))
            .foregroundStyle(Ink.text).symbolSize(18)
        }
        .chartXScale(domain: 1...31)
        .chartXAxis { AxisMarks(values: [1, 8, 15, 22, 29]) { AxisValueLabel().foregroundStyle(Ink.text3) } }
        .chartYAxis { AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { AxisGridLine().foregroundStyle(Ink.line); AxisValueLabel().foregroundStyle(Ink.text3) } }
        .frame(height: 140)
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
  @State private var form: EntityForm?
  var templates: [Record] { studio.all("checklist") }
  var current: Record? { templates.first { $0.id == selected } ?? templates.first }
  var body: some View {
    let run = current.flatMap { list in
      studio.all("checklistRun").first { $0.text("checklistId") == list.id && $0.text("day") == Day.today }
    }
    let checked = run?.data["checked"]?.strings ?? []
    let items = current?.data["items"]?.strings ?? []
    Page {
      ChipBar(options: templates.map { ($0.id, $0.title) }, selection: Binding(get: { current?.id ?? "" }, set: { selected = $0 }))
      if let current {
        Card {
          HStack(alignment: .firstTextBaseline) {
            Text("\(checked.filter(items.contains).count)").font(Ink.figure).monospacedDigit()
              .contentTransition(.numericText())
            Text("/ \(items.count)").font(Ink.figureSmall).foregroundStyle(Ink.text3)
            Spacer()
            if !checked.isEmpty {
              Button("重置本次") { save(current, run: run, checked: []) }.buttonStyle(.chip)
            }
          }.foregroundStyle(Ink.text)
          Meter(value: items.isEmpty ? 0 : Double(checked.filter(items.contains).count) / Double(items.count))
          VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element) { index, item in
              if index > 0 { Hairline(inset: 40) }
              let on = checked.contains(item)
              Button {
                save(current, run: run, checked: on ? checked.filter { $0 != item } : checked + [item])
              } label: {
                HStack(spacing: 14) {
                  Ring(value: on ? 1 : 0, size: 24)
                  Text(item).font(.system(size: 17)).foregroundStyle(on ? Ink.text3 : Ink.text)
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
        Button("新清单", systemImage: "plus") { form = EntityForm(type: "checklist") }
        if let current { Button("编辑这份清单", systemImage: "pencil") { form = EntityForm(type: "checklist", record: current) } }
      } label: {
        Image(systemName: "ellipsis")
      }
    }
    .sheet(item: $form) { EntityFormSheet(form: $0) }
  }
  func save(_ list: Record, run: Record?, checked: [String]) {
    Task {
      await studio.save(
        "checklistRun",
        ["checklistId": .string(list.id), "day": .string(Day.today), "checked": .array(checked.map(JSONValue.string))],
        id: run?.id)
    }
  }
}
