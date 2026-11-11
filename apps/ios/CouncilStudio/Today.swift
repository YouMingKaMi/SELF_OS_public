import CouncilCore
import SwiftUI

enum TodayCard: String, CaseIterable, Identifiable {
  case now, chronicle, pair, tasks, habits, days, metrics
  var id: String { rawValue }
  var name: String {
    switch self {
    case .now: "此刻推进"
    case .chronicle: "今天发生的事"
    case .pair: "花销与积累"
    case .tasks: "今日待办"
    case .habits: "习惯"
    case .days: "重要日子"
    case .metrics: "每日指标"
    }
  }
}

enum Capture: String, Identifiable {
  case chronicle, idea, raw, expense, task
  var id: String { rawValue }
}

struct TodayScreen: View {
  @Environment(Studio.self) private var studio
  @AppStorage("studio-today-cards") private var layout = TodayCard.allCases.map(\.rawValue).joined(
    separator: ",")
  @State private var capture: Capture?
  @State private var arranging = false
  var cards: [TodayCard] { layout.split(separator: ",").compactMap { TodayCard(rawValue: String($0)) } }
  var body: some View {
    Page {
      header
      ForEach(cards) { card in
        Group {
        switch card {
        case .now: NowCard()
        case .chronicle: ChronicleCard(capture: $capture)
        case .pair: PairCards(capture: $capture)
        case .tasks: TodayTasksCard(capture: $capture)
        case .habits: TodayHabitsCard()
        case .days: TodayDaysCard()
        case .metrics: TodayMetricsCard()
        }
        }.id(card.rawValue)
      }
    }
    .refreshable { await studio.sync() }
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          arranging = true
        } label: {
          Image(systemName: "slider.horizontal.3")
        }.accessibilityLabel("调整首页")
      }
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Button("记一件事", systemImage: "book.closed") { capture = .chronicle }
          Button("记一笔花销", systemImage: "creditcard") { capture = .expense }
          Button("添加任务", systemImage: "checklist") { capture = .task }
          Button("暂存想法", systemImage: "lightbulb") { capture = .idea }
          Button("收集原料", systemImage: "tray.and.arrow.down") { capture = .raw }
        } label: {
          Image(systemName: "plus")
        }.accessibilityLabel("快速记录")
      }
    }
    .toolbarBackground(Ink.bg, for: .navigationBar)
    .sheet(item: $capture) { kind in
      switch kind {
      case .expense: ExpenseSheet(record: nil)
      case .task: TaskSheet(record: nil)
      case .chronicle: QuickNoteSheet(kind: .chronicle)
      case .idea: QuickNoteSheet(kind: .idea)
      case .raw: QuickNoteSheet(kind: .raw)
      }
    }
    .sheet(isPresented: $arranging) { ArrangeSheet(layout: $layout) }
  }
  var header: some View {
    HStack(alignment: .lastTextBaseline) {
      VStack(alignment: .leading, spacing: 2) {
        Text(Day.short(Day.today)).font(Ink.display).foregroundStyle(Ink.text)
        Text("周" + Day.weekday(Day.today) + " · 今天，也在慢慢向前").font(Ink.meta)
          .foregroundStyle(Ink.text3)
      }
      Spacer()
      SyncBadge()
    }.padding(.horizontal, 4).padding(.bottom, 6)
  }
}

struct SyncBadge: View {
  @Environment(Studio.self) private var studio
  var body: some View {
    Button {
      Task { await studio.sync() }
    } label: {
      HStack(spacing: 5) {
        Image(systemName: studio.syncState.symbol)
          .symbolEffect(.rotate, isActive: studio.syncState == .syncing)
        Text(studio.syncState.label)
      }.font(.system(size: 12)).foregroundStyle(
        studio.syncState == .attention ? Ink.amber : Ink.text3)
    }.buttonStyle(.plain)
  }
}

// MARK: - Now

struct NowCard: View {
  @Environment(Studio.self) private var studio
  @AppStorage("studio-practice-domain") private var domainId = ""
  @AppStorage("studio-practice-activity") private var activityId = ""
  var domains: [Record] { studio.all("domain").sorted { $0.number("order") < $1.number("order") } }
  var domain: Record? { domains.first { $0.id == domainId } ?? domains.first }
  var activities: [Record] {
    studio.all("activity").filter { $0.text("domainId") == domain?.id && !$0.flag("archived") }
  }
  var body: some View {
    NavigationLink(value: Feature.practice) {
      Card(icon: "scope", title: "此刻", meta: studio.runningSession == nil ? "准备开始" : nil) {
        if let session = studio.runningSession {
          LiveSession(session: session)
        } else {
          idle
        }
      }
    }.buttonStyle(.plain)
  }
  var idle: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .center) {
        VStack(alignment: .leading, spacing: 8) {
          Menu {
            ForEach(domains) { d in
              Button(d.title) {
                domainId = d.id
                activityId = ""
              }
            }
          } label: {
            HStack(spacing: 6) {
              Text(domain?.title ?? "添加领域").font(.system(size: 26, weight: .bold))
              Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Ink.text3)
            }.foregroundStyle(Ink.text)
          }
          Menu {
            Button("直接推进领域") { activityId = "" }
            ForEach(activities) { a in Button(a.title) { activityId = a.id } }
          } label: {
            HStack(spacing: 4) {
              Text(activities.first { $0.id == activityId }?.title ?? "直接推进领域")
              Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold))
            }.font(Ink.meta).foregroundStyle(Ink.text2)
          }
        }
        Spacer()
        Button {
          guard let domain else { return }
          Task {
            await studio.start(domain: domain, activity: activities.first { $0.id == activityId })
          }
        } label: {
          Image(systemName: "play.fill").font(.system(size: 20, weight: .bold))
            .foregroundStyle(.black).frame(width: 60, height: 60).background(Ink.text, in: Circle())
        }.buttonStyle(.plain).accessibilityLabel("开始推进").disabled(domain == nil)
          .sensoryFeedback(.impact, trigger: studio.runningSession?.id)
      }
    }
  }
}

/// The running timer: amber pulse, live digits, the two actions you need with one thumb.
struct LiveSession: View {
  @Environment(Studio.self) private var studio
  let session: Record
  var running: Bool { session.text("status") == "running" }
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 6) {
        Circle().fill(running ? Ink.amber : Ink.text3).frame(width: 7, height: 7)
          .symbolEffect(.pulse, isActive: running)
        Text(running ? "正在推进" : "已暂停").font(Ink.meta).foregroundStyle(Ink.text2)
        Text("· " + (studio.record(session.text("domainId"), in: "domain")?.title ?? ""))
          .font(Ink.meta).foregroundStyle(Ink.text3)
      }
      Text(session.title).font(.system(size: 20, weight: .semibold)).foregroundStyle(Ink.text)
        .lineLimit(2)
      HStack(alignment: .center) {
        TimelineView(.periodic(from: .now, by: 1)) { context in
          Text(Clock.digits(Clock.elapsed(session, context.date)))
            .font(.system(size: 46, weight: .medium, design: .rounded)).monospacedDigit()
            .foregroundStyle(running ? Ink.text : Ink.text2).contentTransition(.numericText())
        }
        Spacer()
        Menu {
          Button("结束并保存", systemImage: "stop.fill") {
            Task { await studio.control(session, "finish") }
          }
          Button("取消本次计时", systemImage: "xmark", role: .destructive) {
            Task { await studio.control(session, "cancel") }
          }
        } label: {
          Image(systemName: "ellipsis").font(.system(size: 18, weight: .bold))
            .frame(width: 48, height: 48).background(Ink.raised, in: Circle())
        }.accessibilityLabel("本次计时选项")
        Button {
          Task { await studio.control(session, running ? "pause" : "resume") }
        } label: {
          Image(systemName: running ? "pause.fill" : "play.fill").font(.system(size: 20, weight: .bold))
            .foregroundStyle(.black).frame(width: 60, height: 60).background(Ink.text, in: Circle())
        }.buttonStyle(.plain).accessibilityLabel(running ? "暂停" : "继续")
          .sensoryFeedback(.impact(weight: .medium), trigger: running)
      }.foregroundStyle(Ink.text)
    }
  }
}

// MARK: - Chronicle

struct ChronicleCard: View {
  @Environment(Studio.self) private var studio
  @Binding var capture: Capture?
  var lines: [Record] {
    studio.all("journal").filter { $0.text("kind") == "chronicle" && $0.text("day") == Day.today }
      .sorted { $0.updatedAt < $1.updatedAt }
  }
  var body: some View {
    NavigationLink(value: Feature.chronicle) {
      Card(icon: "book.closed", title: "记录与回顾", meta: "\(lines.count) 件事") {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(lines.enumerated()), id: \.element.id) { index, line in
            if index > 0 { Hairline() }
            Text(line.text("body")).font(Ink.body).foregroundStyle(Ink.text).lineSpacing(3)
              .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 11)
              .multilineTextAlignment(.leading)
          }
          if !lines.isEmpty { Hairline() }
          Button {
            capture = .chronicle
          } label: {
            Label("写一件事", systemImage: "plus").font(.system(size: 15, weight: .medium))
              .foregroundStyle(Ink.text2).frame(maxWidth: .infinity, alignment: .leading)
              .padding(.top, lines.isEmpty ? 0 : 12)
          }.buttonStyle(.plain)
        }
      }
    }.buttonStyle(.plain)
  }
}

// MARK: - Spend + time

struct PairCards: View {
  @Environment(Studio.self) private var studio
  @Binding var capture: Capture?
  var body: some View {
    let today = Day.today
    let expenses = studio.all("expense")
    let todaySpend = FinanceRules.total(
      expenses.filter { $0.text("day") == today }, month: String(today.prefix(7)), basis: .actual,
      asOf: today)
    let month = FinanceRules.total(
      expenses, month: String(today.prefix(7)), basis: .actual, asOf: today)
    let summary = TimeMath.summarize(studio.all("session"), now: Date())
    let seconds = summary.daily[today] ?? 0
    HStack(alignment: .top, spacing: Ink.gap) {
      NavigationLink(value: Feature.expenses) {
        Card(icon: "creditcard", title: "今日花销") {
          VStack(alignment: .leading, spacing: 14) {
            Figure(value: Money.format(todaySpend), caption: "本月 " + Money.format(month),
              font: Ink.figureMid)
            Spacer(minLength: 0)
            Button {
              capture = .expense
            } label: {
              Label("记一笔", systemImage: "plus").font(.system(size: 14, weight: .semibold))
            }.buttonStyle(.chip)
          }.frame(maxHeight: .infinity, alignment: .topLeading)
        }.frame(maxHeight: .infinity)
      }.buttonStyle(.plain)
      NavigationLink(value: Feature.practice) {
        Card(icon: "clock", title: "今日积累") {
          VStack(alignment: .leading, spacing: 14) {
            Figure(value: Clock.span(seconds), caption: "本周 " + Clock.span(week(summary)),
              font: Ink.figureMid)
            Spacer(minLength: 0)
            WeekBars(daily: summary.daily)
          }.frame(maxHeight: .infinity, alignment: .topLeading)
        }.frame(maxHeight: .infinity)
      }.buttonStyle(.plain)
    }.fixedSize(horizontal: false, vertical: true)
  }
  func week(_ summary: TimeSummary) -> Double {
    (0..<7).map { summary.daily[Day.shift(Day.today, -$0)] ?? 0 }.reduce(0, +)
  }
}

/// Seven thin bars, today brightest.
struct WeekBars: View {
  let daily: [String: Double]
  var body: some View {
    let days = (0..<7).reversed().map { Day.shift(Day.today, -$0) }
    let peak = max(days.map { daily[$0] ?? 0 }.max() ?? 0, 1)
    HStack(alignment: .bottom) {
      ForEach(Array(days.enumerated()), id: \.element) { index, day in
        if index > 0 { Spacer(minLength: 0) }
        VStack(spacing: 4) {
          Capsule().fill(day == Day.today ? Ink.text : Color.white.opacity(0.2))
            .frame(width: 5, height: max(4, 26 * (daily[day] ?? 0) / peak))
          Text(Day.weekday(day)).font(.system(size: 9, weight: .medium))
            .foregroundStyle(day == Day.today ? Ink.text2 : Ink.text3)
        }
      }
    }.frame(height: 40, alignment: .bottom)
  }
}

// MARK: - Tasks

struct TodayTasksCard: View {
  @Environment(Studio.self) private var studio
  @Binding var capture: Capture?
  var tasks: [Record] {
    studio.all("task").filter {
      TaskRules.belongsToday($0, day: Day.today)
        || ($0.text("status") == "pending" && TaskRules.schedule($0).kind == "recent")
    }.sorted { TaskRules.schedule($0).kind < TaskRules.schedule($1).kind }
  }
  var body: some View {
    NavigationLink(value: Feature.tasks) {
      Card(icon: "checklist", title: "待办", meta: "\(tasks.count) 项") {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(tasks.prefix(6).enumerated()), id: \.element.id) { index, task in
            if index > 0 { Hairline(inset: 36) }
            TaskLine(task: task)
          }
          if tasks.isEmpty { EmptyNote(text: "今天没有安排，可以开始一件想做的事。") }
          Button {
            capture = .task
          } label: {
            Label("添加任务", systemImage: "plus").font(.system(size: 15, weight: .medium))
              .foregroundStyle(Ink.text2)
          }.buttonStyle(.plain).padding(.top, 10)
        }
      }
    }.buttonStyle(.plain)
  }
}

struct TaskLine: View {
  @Environment(Studio.self) private var studio
  let task: Record
  var done: Bool { task.text("status") == "completed" }
  var body: some View {
    HStack(spacing: 12) {
      Button {
        Task { await studio.task(task, done ? "reopen" : "complete") }
      } label: {
        Ring(value: done ? 1 : 0, size: 22)
      }.buttonStyle(.plain).accessibilityLabel((done ? "恢复 " : "完成 ") + task.title)
        .sensoryFeedback(.success, trigger: done) { _, new in new }
      VStack(alignment: .leading, spacing: 2) {
        Text(task.title).font(Ink.row).foregroundStyle(done ? Ink.text3 : Ink.text)
          .strikethrough(done, color: Ink.text3).lineLimit(2)
        let schedule = TaskRules.schedule(task)
        if schedule.kind != "unscheduled" {
          Text(TaskRules.label(schedule)).font(.system(size: 12)).foregroundStyle(
            schedule.kind == "deadline" && (schedule.date ?? "") < Day.today ? Ink.amber : Ink.text3)
        }
      }
      Spacer(minLength: 0)
    }.padding(.vertical, 9)
  }
}

// MARK: - Habits

struct TodayHabitsCard: View {
  @Environment(Studio.self) private var studio
  var body: some View {
    let records = studio.habitRecords
    let habits = studio.all("habit").filter {
      HabitRules.shouldShowOnHome(habit: $0, day: Day.today, records: records)
    }.sorted { $0.number("order") < $1.number("order") }
    if !habits.isEmpty {
      NavigationLink(value: Feature.habits) {
        Card(
          icon: "repeat", title: "习惯",
          meta:
            "\(habits.filter { HabitRules.isComplete(habit: $0, day: Day.today, records: records) }.count)/\(habits.count)"
        ) {
          VStack(spacing: 0) {
            ForEach(Array(habits.enumerated()), id: \.element.id) { index, habit in
              if index > 0 { Hairline(inset: 40) }
              HabitLine(habit: habit, day: Day.today).padding(.vertical, 9)
            }
          }
        }
      }.buttonStyle(.plain)
    }
  }
}

// MARK: - Days & metrics

struct TodayDaysCard: View {
  @Environment(Studio.self) private var studio
  var body: some View {
    let soon = studio.all("importantDay").compactMap { day -> (Record, Int)? in
      guard let n = DayRule.daysUntil(day), n >= 0, n <= max(30, Int(day.number("remindDays"))) else {
        return nil
      }
      return (day, n)
    }.sorted { $0.1 < $1.1 }
    if !soon.isEmpty {
      NavigationLink(value: Feature.days) {
        Card(icon: "gift", title: "重要日子") {
          VStack(spacing: 0) {
            ForEach(Array(soon.prefix(3).enumerated()), id: \.element.0.id) { index, item in
              if index > 0 { Hairline() }
              HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                  Text(item.0.title).font(Ink.row).foregroundStyle(Ink.text)
                  if let next = DayRule.next(item.0) {
                    Text(CalendarDays.string(next)).font(.system(size: 12)).monospacedDigit()
                      .foregroundStyle(Ink.text3)
                  }
                }
                Spacer()
                if item.1 == 0 {
                  Text("今天").font(Ink.figureSmall).foregroundStyle(Ink.amber)
                } else {
                  Text("\(item.1)").font(Ink.figureMid).monospacedDigit().foregroundStyle(Ink.text)
                  Text("天").font(Ink.meta).foregroundStyle(Ink.text3)
                }
              }.padding(.vertical, 8)
            }
          }
        }
      }.buttonStyle(.plain)
    }
  }
}

struct TodayMetricsCard: View {
  @Environment(Studio.self) private var studio
  var body: some View {
    let metrics = studio.all("metric")
    if !metrics.isEmpty {
      NavigationLink(value: Feature.metrics) {
        Card(icon: "waveform.path.ecg", title: "每日指标", chevron: true) {
          HStack(spacing: 0) {
            ForEach(metrics.prefix(3)) { metric in
              let log = studio.all("metricLog").first {
                $0.text("metricId") == metric.id && $0.text("day") == Day.today
              }
              VStack(alignment: .leading, spacing: 4) {
                Text(metric.title).font(Ink.micro).foregroundStyle(Ink.text3)
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                  Text(log.map { Self.number($0.number("value")) } ?? "—")
                    .font(Ink.figureSmall).monospacedDigit().foregroundStyle(
                      log == nil ? Ink.text3 : Ink.text)
                  Text(metric.text("unit")).font(.system(size: 11)).foregroundStyle(Ink.text3)
                }
              }.frame(maxWidth: .infinity, alignment: .leading)
            }
          }
        }
      }.buttonStyle(.plain)
    }
  }
  static func number(_ value: Double) -> String {
    value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
  }
}

// MARK: - Arrange

struct ArrangeSheet: View {
  @Binding var layout: String
  @Environment(\.dismiss) private var dismiss
  @State private var order: [TodayCard] = []
  @State private var shown: Set<TodayCard> = []
  var body: some View {
    NavigationStack {
      List {
        Section {
          ForEach(order) { card in
            HStack {
              Text(card.name)
              Spacer()
              Toggle(
                "", isOn: Binding(
                  get: { shown.contains(card) },
                  set: { if $0 { shown.insert(card) } else { shown.remove(card) } })
              ).labelsHidden()
            }.listRowBackground(Ink.raised)
          }.onMove { order.move(fromOffsets: $0, toOffset: $1) }
        } footer: {
          Text("拖动调整顺序，关闭的板块不会出现在今日。排列只保存在这台手机。")
        }
      }.environment(\.editMode, .constant(.active)).scrollContentBackground(.hidden)
        .navigationTitle("调整今日").navigationBarTitleDisplayMode(.inline)
        .toolbar {
          Button("完成") {
            layout = order.filter { shown.contains($0) }.map(\.rawValue).joined(separator: ",")
            dismiss()
          }.fontWeight(.semibold)
        }
    }.studioSheet().presentationDetents([.medium, .large])
      .onAppear {
        let current = layout.split(separator: ",").compactMap { TodayCard(rawValue: String($0)) }
        order = current + TodayCard.allCases.filter { !current.contains($0) }
        shown = Set(current)
      }
  }
}
