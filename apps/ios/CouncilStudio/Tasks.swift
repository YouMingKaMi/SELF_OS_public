import CouncilCore
import SwiftUI

struct TasksScreen: View {
  @Environment(Studio.self) private var studio
  @State private var filter = "pending"
  @State private var query = ""
  @State private var draft = ""
  @State private var editing: Record?
  @State private var adding = false
  var tasks: [Record] {
    studio.all("task").filter {
      (filter == "all" || $0.text("status") == filter)
        && (query.isEmpty || $0.title.localizedCaseInsensitiveContains(query))
    }
  }
  /// Overdue first, then today, recent, dated by date, then undated. Done tasks by the day they were done.
  var groups: [(String, [Record])] {
    let today = Day.today
    var buckets: [String: [Record]] = [:]
    var order: [String: String] = [:]
    for task in tasks {
      let s = TaskRules.schedule(task)
      var key = ""
      var sort = ""
      if task.text("status") == "completed", let done = TaskRules.completionDay(task) {
        key = done == today ? "今天完成" : Day.short(done) + " 完成"
        sort = "0-" + String(99_999_999 - (Int(done.replacingOccurrences(of: "-", with: "")) ?? 0))
      } else if s.kind == "deadline", let date = s.date, date < today {
        (key, sort) = ("已过截止", "0")
      } else if TaskRules.belongsToday(task, day: today) {
        (key, sort) = ("今天", "1")
      } else if s.kind == "recent" {
        (key, sort) = ("近期", "2")
      } else if s.kind == "unscheduled" {
        (key, sort) = ("未定日期", "9")
      } else {
        let date = s.date ?? s.start ?? ""
        key = (s.kind == "deadline" ? "截止 " : "") + Day.short(date) + " 周" + Day.weekday(date)
        sort = "3" + date
      }
      buckets[key, default: []].append(task)
      order[key] = sort
    }
    return buckets.sorted { order[$0.key]! < order[$1.key]! }.map { ($0.key, $0.value) }
  }
  var body: some View {
    List {
      Section {
        ChipBar(
          options: [("pending", "待完成"), ("completed", "已完成"), ("discarded", "已废弃"), ("all", "全部")],
          selection: $filter
        ).listRowBackground(Color.clear).listRowInsets(EdgeInsets())
      }
      ForEach(groups, id: \.0) { group in
        Section {
          ForEach(group.1) { task in row(task) }
        } header: {
          HStack {
            Text(group.0).foregroundStyle(group.0 == "已过截止" ? Ink.amber : Ink.text2)
            Spacer()
            Text("\(group.1.count)").foregroundStyle(Ink.text3)
          }.font(.system(size: 13, weight: .semibold)).textCase(nil)
        }
      }
      if tasks.isEmpty {
        Section {
          Text(query.isEmpty ? "这里还没有任务" : "没有找到这件事").font(Ink.meta)
            .foregroundStyle(Ink.text3).cardRow()
        }
      }
    }
    .studioList()
    .animation(.snappy, value: tasks.map(\.id))
    .searchable(text: $query, prompt: "搜索任务")
    .safeAreaInset(edge: .bottom) {
      Composer(text: $draft, placeholder: "记下一件想做的事") {
        let title = draft
        draft = ""
        Task { await studio.task(nil, "create", title: title, schedule: Schedule(kind: "recent")) }
      }
    }
    .toolbar(.hidden, for: .tabBar)
    .toolbar {
      Button {
        adding = true
      } label: {
        Image(systemName: "calendar.badge.plus")
      }.accessibilityLabel("安排任务")
    }
    .studioScreen("任务")
    .sheet(item: $editing) { TaskSheet(record: $0) }
    .sheet(isPresented: $adding) { TaskSheet(record: nil) }
  }
  func row(_ task: Record) -> some View {
    let done = task.text("status") == "completed"
    let dropped = task.text("status") == "discarded"
    return HStack(spacing: 12) {
      Button {
        Task { await studio.task(task, done ? "reopen" : "complete") }
      } label: {
        Ring(value: done ? 1 : 0, size: 22).opacity(dropped ? 0.3 : 1)
      }.buttonStyle(.plain).disabled(dropped)
        .sensoryFeedback(.success, trigger: done) { _, new in new }
      VStack(alignment: .leading, spacing: 3) {
        Text(task.title).font(Ink.row).foregroundStyle(done || dropped ? Ink.text3 : Ink.text)
          .strikethrough(done, color: Ink.text3)
        let s = TaskRules.schedule(task)
        if s.kind == "range" || (s.kind == "deadline" && filter != "pending") {
          Text(TaskRules.label(s)).font(.system(size: 12)).foregroundStyle(Ink.text3)
        }
      }
      Spacer(minLength: 0)
      if studio.pending.contains(where: { $0.entityId == task.id }) {
        Image(systemName: "icloud.and.arrow.up").font(.system(size: 11)).foregroundStyle(Ink.text3)
      }
    }
    .contentShape(Rectangle()).onTapGesture { editing = task }
    .cardRow()
    .swipeActions(edge: .leading) {
      if !dropped {
        Button(done ? "恢复" : "完成", systemImage: "checkmark") {
          Task { await studio.task(task, done ? "reopen" : "complete") }
        }.tint(Ink.live)
      }
    }
    .swipeActions(edge: .trailing) {
      Button(dropped ? "恢复" : "废弃", systemImage: dropped ? "arrow.uturn.backward" : "xmark") {
        Task { await studio.task(task, dropped ? "reopen" : "discard") }
      }.tint(Color(white: 0.32))
    }
  }
}

struct TaskSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let record: Record?
  @State private var title = ""
  @State private var kind = "recent"
  @State private var date = Date()
  @State private var end = Date()
  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("要做的事", text: $title, axis: .vertical).font(.system(size: 18)).lineLimit(1...5)
        }.listRowBackground(Ink.raised)
        Section("安排") {
          Picker("方式", selection: $kind) {
            Text("近期").tag("recent")
            Text("某天").tag("day")
            Text("期间").tag("range")
            Text("截止").tag("deadline")
            Text("未定").tag("unscheduled")
          }.pickerStyle(.segmented)
          if ["day", "deadline", "range"].contains(kind) {
            DatePicker(kind == "range" ? "开始" : kind == "deadline" ? "截止到" : "日期",
              selection: $date, displayedComponents: .date)
          }
          if kind == "range" {
            DatePicker("结束", selection: $end, in: date..., displayedComponents: .date)
          }
        }.listRowBackground(Ink.raised)
        if let record {
          Section {
            let status = record.text("status")
            if status != "completed" {
              Button("标记完成", systemImage: "checkmark.circle") { act("complete") }
            } else {
              Button("恢复待办", systemImage: "arrow.uturn.backward") { act("reopen") }
            }
            if status != "discarded" {
              Button("废弃这件事", systemImage: "xmark.circle", role: .destructive) { act("discard") }
            }
            if let done = TaskRules.completionDay(record) {
              LabeledContent("完成于", value: done)
            }
          }.listRowBackground(Ink.raised)
        }
      }
      .scrollContentBackground(.hidden).background(Ink.card)
      .environment(\.locale, Locale(identifier: "zh_CN"))
      .navigationTitle(record == nil ? "新任务" : "任务").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") { save() }.fontWeight(.semibold)
            .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }
    }.studioSheet().presentationDetents([.medium, .large])
      .onAppear {
        guard let record else { return }
        title = record.title
        let s = TaskRules.schedule(record)
        kind = s.kind
        date = CalendarDays.date(s.date ?? s.start ?? "") ?? Date()
        end = CalendarDays.date(s.end ?? "") ?? date
      }
  }
  var schedule: Schedule {
    let a = CalendarDays.string(date)
    switch kind {
    case "day", "deadline": return Schedule(kind: kind, date: a)
    case "range": return Schedule(kind: kind, start: a, end: CalendarDays.string(max(date, end)))
    default: return Schedule(kind: kind)
    }
  }
  func save() {
    Task {
      await studio.task(record, record == nil ? "create" : "schedule", title: title, schedule: schedule)
      dismiss()
    }
  }
  func act(_ action: String) {
    Task {
      await studio.task(record, action)
      dismiss()
    }
  }
}
