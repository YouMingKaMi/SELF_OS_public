import CouncilCore
import SwiftUI

struct TasksScreen: View {
  @Environment(Studio.self) private var studio
  @State private var filter: String
  @State private var query = ""
  @State private var draft = ""
  @State private var editing: Record?
  @State private var adding = false
  @State private var saving = false
  @State private var listID = ""
  @State private var listName = ""
  @State private var editingList = false
  @State private var history = "completed"
  @State private var plannedDay: Date?
  @State private var month = Day.today.prefix(7).description
  @State private var graph = false
  @State private var showCompleted = false
  @State private var includeChildren = false
  @State private var linking = false
  @State private var source: String?
  @State private var parentID = ""
  @State private var notice: CompletionNotice?
  @State private var organizing = false
  @State private var imported: [String] = []

  init(initialFilter: String = "next") { _filter = State(initialValue: initialFilter) }

  private struct CompletionNotice: Equatable {
    let id: String
    let text: String
    let unlocked: Set<String>
  }

  private let views = [("next", "接下来"), ("inbox", "收件箱"), ("today", "今天"),
    ("blocked", "等前置"), ("pending", "待完成"), ("history", "历史")]

  var lists: [Record] {
    studio.all("taskList").sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
  }

  var body: some View {
    let all = studio.all("task")
    let byID = Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })
    let openBlockers = Dictionary(uniqueKeysWithValues: all.filter {
      $0.text("status") == "pending"
    }.map { ($0.id, TaskRules.blockers($0, byID: byID)) })
    let unlocks = openBlockers.values.reduce(into: [String: Int]()) { counts, keys in
      if keys.count == 1 { counts[keys[0], default: 0] += 1 }
    }
    let listNames = Dictionary(uniqueKeysWithValues: lists.map { ($0.id, $0.title) })
    let pendingIDs = Set(studio.pending.filter { $0.entityType == "task" }.map(\.entityId))
    let selectedFolder = lists.first(where: { $0.id == listID })
    let scoped = filter == "folder"
    let subset = all.filter { item in
      if scoped {
        let folder = item.text("listId")
        let inScope = folder == listID || (includeChildren && !listID.isEmpty && isDescendant(folder, of: listID))
        let status = item.text("status")
        return inScope && (status == "pending" || (showCompleted && status == "completed")) &&
          (query.isEmpty || (item.title + "\n" + item.text("note")).localizedCaseInsensitiveContains(query))
      }
      return matches(item, byID: byID, blockers: openBlockers)
    }
    let groups = filter == "next" && query.isEmpty ? nextGroups(subset) : grouped(subset)
    let visible = TaskDependencyLayout.layers(subset).flatMap { $0 }
    List {
      Section {
        if scoped {
          VStack(alignment: .leading, spacing: 10) {
            if let selectedFolder, !selectedFolder.text("parentId").isEmpty {
              Text(folderPath(selectedFolder.text("parentId"))).font(Ink.meta).foregroundStyle(Ink.text3)
            }
            Picker("任务视图", selection: $graph) {
              Text("列表").tag(false)
              Text("关系图").tag(true)
            }.pickerStyle(.segmented)
            HStack(spacing: 12) {
              Button(showCompleted ? "隐藏已完成" : "显示已完成") { showCompleted.toggle() }
              if selectedFolder != nil {
                Button(includeChildren ? "仅当前文件夹" : "包含子文件夹") {
                  includeChildren.toggle()
                  source = nil
                }
              }
              Spacer(minLength: 0)
              if graph {
                Button(linking ? "退出连线" : "连线") {
                  linking.toggle()
                  source = nil
                }
              }
              Button { organizing = true } label: {
                Image(systemName: "sparkles")
              }.accessibilityLabel("AI 整理")
            }.font(Ink.meta).buttonStyle(.borderless).foregroundStyle(Ink.text2)
            if graph && linking {
              Text(source == nil ? "选择前置任务" : "轻点后续任务。再次选择可移除连线。")
                .font(Ink.meta).foregroundStyle(Ink.text3)
            }
          }.cardRow()
        } else {
          VStack(alignment: .leading, spacing: 7) {
            if filter == "next" && query.isEmpty {
              Text("\(subset.count) 项可做").font(Ink.meta).foregroundStyle(Ink.text3)
            }
            ChipBar(options: views, selection: $filter)
          }.listRowBackground(Color.clear).listRowInsets(EdgeInsets())
        }
        if filter == "history" {
          Picker("状态", selection: $history) {
            Text("已完成").tag("completed")
            Text("已废弃").tag("discarded")
          }.pickerStyle(.segmented).cardRow()
          if history == "completed" {
            MonthBar(month: $month).cardRow()
          }
        }
        if filter == "pending" {
          Menu {
            Button("全部日期") { plannedDay = nil }
            Button("选日期…") {
              pickedDay = plannedDay ?? Date()
              pickingDay = true
            }
          } label: {
            Label(plannedDay.map(CalendarDays.string) ?? "全部日期", systemImage: "calendar")
              .font(Ink.meta).foregroundStyle(Ink.text2)
          }.cardRow()
        }
      }
      if scoped && !subset.isEmpty {
        Section {
          if graph {
            TaskMap(tasks: subset, blockers: openBlockers, unlocks: unlocks, source: source, linking: linking, canSelect: { item in
              canLink(item, byID: byID)
            }) { item in
              selectNode(item, byID: byID)
            }.cardRow()
          } else {
            VStack(spacing: 0) {
              ForEach(visible) { task in
                taskLine(task, blockers: openBlockers[task.id] ?? [], unlocks: unlocks[task.id] ?? 0,
                  listName: task.text("listId") == listID ? nil : folderPath(task.text("listId")),
                  pending: pendingIDs.contains(task.id))
                if task.id != visible.last?.id { Divider().padding(.leading, 44) }
              }
            }
            .background(alignment: .leading) { TaskListRail(tasks: visible, blockers: openBlockers) }
            .cardRow()
          }
        } header: {
          if !graph { Text("事项").foregroundStyle(Ink.text2).textCase(nil) }
        }
      } else {
        ForEach(groups, id: \.0) { group in
          Section {
            ForEach(group.1) { task in
              row(task, blockers: openBlockers[task.id] ?? [], unlocks: unlocks[task.id] ?? 0,
                listName: listNames[task.text("listId")].map { _ in folderPath(task.text("listId")) },
                pending: pendingIDs.contains(task.id))
            }
          } header: {
            Text(group.0).foregroundStyle(group.0 == "已过截止" ? Ink.amber : Ink.text2)
              .font(.system(size: 13, weight: .semibold)).textCase(nil)
          }
        }
      }
      if groups.isEmpty {
        Section {
          Text(query.isEmpty ? emptyLabel : "没有找到这件事").font(Ink.meta)
            .foregroundStyle(Ink.text3).cardRow()
        }
      }
    }
    .studioList()
    .searchable(text: $query, prompt: "搜索任务与备注")
    .safeAreaInset(edge: .bottom) {
      VStack(spacing: 8) {
        if let notice {
          HStack {
            Text(notice.text).font(Ink.meta).lineLimit(2)
            Spacer()
            Button("撤销") {
              guard let item = byID[notice.id], item.text("status") == "completed" else { self.notice = nil; return }
              Task { if await studio.task(item, "reopen") { self.notice = nil } }
            }.font(.system(size: 13, weight: .semibold))
          }.padding(12).background(Ink.raised, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Ink.line))
            .padding(.horizontal, 16)
            .accessibilityElement(children: .contain)
        }
        if !imported.isEmpty && notice == nil {
          HStack {
            Text("已保存 \(imported.count) 项").font(Ink.meta)
            Spacer()
            Button("撤销") {
              let ids = imported
              Task {
                let byID = Dictionary(uniqueKeysWithValues: studio.all("task").map { ($0.id, $0) })
                let records = ids.reversed().compactMap { byID[$0] }
                if records.count == ids.count, await studio.removeTogether(records), imported == ids {
                  imported = []
                }
              }
            }.font(.system(size: 13, weight: .semibold))
          }.padding(12).background(Ink.raised, in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16)
        }
        Composer(text: $draft, placeholder: scoped ? "添加事项" : "记到收件箱") { quickAdd() }
      }
    }
    .task(id: notice?.id) {
      guard let current = notice else { return }
      try? await Task.sleep(for: .seconds(8))
      if !Task.isCancelled && notice == current { notice = nil }
    }
    .task(id: imported) {
      guard !imported.isEmpty else { return }
      try? await Task.sleep(for: .seconds(8))
      if !Task.isCancelled { imported = [] }
    }
    .toolbar(.hidden, for: .tabBar)
    .toolbar {
      Menu {
        Button("接下来", systemImage: "checkmark.circle") { openFolder("", mode: "next") }
        Button("已完成", systemImage: "clock.arrow.circlepath") {
          history = "completed"
          openFolder("", mode: "history")
        }
        Button("收件箱", systemImage: "tray") { openFolder("", mode: "inbox") }
        Section("文件夹") {
          Button("根目录", systemImage: "folder") { openFolder("") }
          ForEach(lists.sorted { folderPath($0.id) < folderPath($1.id) }) { folder in
            Button(folderPath(folder.id), systemImage: "folder") { openFolder(folder.id) }
          }
          Button("新建文件夹", systemImage: "folder.badge.plus") { editFolder(parent: "") }
          if let selectedFolder {
            Button("新建子文件夹", systemImage: "plus") { editFolder(parent: selectedFolder.id) }
            Button("重命名当前文件夹", systemImage: "pencil") {
              listName = selectedFolder.title
              renameID = selectedFolder.id
              editingList = true
            }
          }
        }
      } label: {
        Image(systemName: "folder")
      }.accessibilityLabel("任务清单")
      Button {
        adding = true
      } label: {
        Image(systemName: "plus")
      }.accessibilityLabel("新任务")
    }
    .studioScreen(selectedFolder?.title ?? (scoped ? "根目录" : filter == "next" ? "接下来" : "任务"))
    .onChange(of: graph) { _, _ in linking = false; source = nil }
    .sheet(isPresented: $pickingDay) {
      VStack {
        DatePicker("日期", selection: $pickedDay, displayedComponents: .date)
          .datePickerStyle(.graphical)
        Button("查看这天") {
          plannedDay = pickedDay
          pickingDay = false
        }.buttonStyle(.borderedProminent)
      }.padding().presentationDetents([.medium]).presentationBackground(Ink.card)
        .environment(\.calendar, CalendarDays.calendar)
    }
    .sheet(isPresented: $organizing) { OrganizeTasksSheet(listID: listID) { imported = $0 } }
    .sheet(item: $editing) { TaskSheet(record: $0, onComplete: complete) }
    .sheet(isPresented: $adding) { TaskSheet(record: nil, initialListID: listID) }
    .alert(renameID == nil ? "新建清单" : "重命名清单", isPresented: $editingList) {
      TextField("清单名称", text: $listName)
      Button("取消", role: .cancel) { renameID = nil }
      Button("保存") { saveList() }
    }
  }

  @State private var renameID: String?
  @State private var pickingDay = false
  @State private var pickedDay = Date()
  private var emptyLabel: String {
    switch filter {
    case "next": return "目前没有可开始的任务"
    case "inbox": return "收件箱是空的"
    case "today": return "今天没有安排"
    case "blocked": return "没有在等前置的任务"
    default: return "这里还没有任务"
    }
  }

  private func quickAdd() {
    let title = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty, title.utf16.count <= 500, !saving else { return }
    saving = true
    let destination = listID
    Task {
      defer { saving = false }
      if await studio.task(nil, "create", title: title, schedule: Schedule(kind: "unscheduled"),
        fields: ["listId": .string(destination)]) {
        if draft.trimmingCharacters(in: .whitespacesAndNewlines) == title { draft = "" }
        plannedDay = nil
        if filter != "folder" && filter != "inbox" { filter = "next" }
      }
    }
  }

  private func saveList() {
    let name = listName.trimmingCharacters(in: .whitespacesAndNewlines)
    let id = renameID
    renameID = nil
    guard !name.isEmpty, name.utf16.count <= 80 else { return }
    Task {
      var fields: [String: JSONValue] = ["name": .string(name)]
      if let id, let folder = lists.first(where: { $0.id == id }) {
        fields["parentId"] = folder.data["parentId"]
      } else if !parentID.isEmpty { fields["parentId"] = .string(parentID) }
      if let saved = await studio.save("taskList", fields, id: id) { openFolder(saved) }
    }
  }

  private func toggle(_ task: Record) {
    Task {
      if task.text("status") == "completed" {
        if await studio.task(task, "reopen") { notice = nil }
      } else {
        _ = await complete(task)
      }
    }
  }

  private func complete(_ task: Record) async -> Bool {
    let items = studio.all("task")
    let byID = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
    let unlocked = items.filter {
      $0.text("status") == "pending" && TaskRules.blockers($0, byID: byID) == [task.id]
    }
    guard await studio.task(task, "complete") else { return false }
    let message = unlocked.first.map { unlocked.count == 1 ? "解锁了「\($0.title)」" : "解锁了 \(unlocked.count) 项" }
      ?? "已完成「\(task.title)」"
    notice = CompletionNotice(id: task.id, text: message, unlocked: Set(unlocked.map(\.id)))
    return true
  }

  private func openFolder(_ id: String, mode: String = "folder") {
    listID = id
    filter = mode
    graph = false
    source = nil
    linking = false
    query = ""
  }

  private func editFolder(parent: String) {
    parentID = parent
    listName = ""
    renameID = nil
    editingList = true
  }

  private func folderPath(_ id: String) -> String {
    let byID = Dictionary(uniqueKeysWithValues: lists.map { ($0.id, $0) })
    var node = id
    var seen = Set<String>()
    var parts: [String] = []
    while let item = byID[node], seen.insert(node).inserted {
      parts.append(item.title)
      node = item.text("parentId")
    }
    return parts.reversed().joined(separator: " / ")
  }

  private func isDescendant(_ id: String, of parent: String) -> Bool {
    let byID = Dictionary(uniqueKeysWithValues: lists.map { ($0.id, $0) })
    var node = id
    var seen = Set<String>()
    while let item = byID[node], seen.insert(node).inserted {
      node = item.text("parentId")
      if node == parent { return true }
    }
    return false
  }

  private func canLink(_ record: Record, byID: [String: Record]) -> Bool {
    guard record.text("status") == "pending" else { return false }
    guard let source, source != record.id else { return true }
    let ids = TaskRules.prerequisites(record)
    return ids.contains(source) || (ids.count < 40 && byID[source]?.text("status") == "pending" &&
      !TaskRules.reaches(source, target: record.id, byID: byID))
  }

  private func selectNode(_ item: Record, byID: [String: Record]) {
    guard linking else { editing = item; return }
    guard canLink(item, byID: byID) else { return }
    guard let source else { self.source = item.id; return }
    guard source != item.id else { self.source = nil; return }
    let before = TaskRules.prerequisites(item)
    let after = before.contains(source) ? before.filter { $0 != source } : before + [source]
    Task {
      if await studio.task(item, "dependency", fields: ["prerequisiteIds": .array(after.map(JSONValue.string))]) {
        self.source = nil
      }
    }
  }

  private func nextGroups(_ tasks: [Record]) -> [(String, [Record])] {
    let today = Day.today
    let week = CalendarDays.calendar.date(byAdding: .day, value: 7, to: CalendarDays.date(today) ?? Date())
      .map(CalendarDays.string) ?? today
    func deadline(_ task: Record) -> String {
      let schedule = TaskRules.schedule(task)
      return schedule.end ?? schedule.date ?? ""
    }
    let labels = ["已过截止", "今天", "7 天内", "稍后", "无截止时间"]
    var buckets = Array(repeating: [Record](), count: labels.count)
    for task in tasks.sorted(by: { deadline($0) < deadline($1) }) {
      let date = deadline(task)
      let index = TaskRules.schedule(task).kind == "deadline" && date < today ? 0
        : date.isEmpty ? 4 : date <= today ? 1 : date <= week ? 2 : 3
      buckets[index].append(task)
    }
    return zip(labels, buckets).filter { !$0.1.isEmpty }
  }

  private func matches(_ task: Record, byID: [String: Record], blockers: [String: [String]]) -> Bool {
    guard listID.isEmpty || task.text("listId") == listID else { return false }
    let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
    if !search.isEmpty {
      return (task.title + "\n" + task.text("note")).localizedCaseInsensitiveContains(search)
    }
    let status = task.text("status")
    if filter == "history" {
      return status == history && (history == "discarded" ||
        TaskRules.completionDay(task)?.hasPrefix(month) == true ||
        (TaskRules.completionDay(task) == nil && month == String(Day.today.prefix(7))))
    }
    guard status == "pending" else { return false }
    switch filter {
    case "next": return TaskRules.isNext(task, byID: byID, day: Day.today)
    case "inbox": return TaskRules.schedule(task).kind == "unscheduled" && task.text("listId").isEmpty
    case "today": return TaskRules.belongsToday(task, day: Day.today)
    case "blocked": return !(blockers[task.id]?.isEmpty ?? true)
    default:
      guard let plannedDay else { return true }
      let day = CalendarDays.string(plannedDay)
      switch TaskRules.schedule(task).kind {
      case "unscheduled", "recent": return false
      default: return TaskRules.inPeriod(task, start: day, end: day)
      }

    }
  }

  private func grouped(_ tasks: [Record]) -> [(String, [Record])] {
    var buckets: [String: [Record]] = [:]
    var order: [String: String] = [:]
    let today = Day.today
    for task in tasks {
      let schedule = TaskRules.schedule(task)
      let key: String
      let sort: String
      if task.text("status") == "completed" {
        if let done = TaskRules.completionDay(task) {
          key = done == today ? "今天完成" : Day.short(done) + " 完成"
          sort = "0-" + String(99_999_999 - (Int(done.replacingOccurrences(of: "-", with: "")) ?? 0))
        } else { (key, sort) = ("已完成", "0") }
      } else if task.text("status") == "discarded" {
        (key, sort) = ("已废弃", "Z")
      } else if schedule.kind == "deadline", let date = schedule.date, date < today {
        (key, sort) = ("已过截止", "1")
      } else if schedule.kind != "recent", schedule.kind != "unscheduled",
        TaskRules.inPeriod(task, start: today, end: today)
      {
        (key, sort) = ("今天", "2")
      } else if schedule.kind == "recent" {
        (key, sort) = ("近期", "4")
      } else if let date = schedule.date ?? schedule.start {
        key = TaskRules.label(schedule)
        sort = (date <= today ? "3" : "5") + date
      } else {
        (key, sort) = ("未定日期", "9")
      }
      buckets[key, default: []].append(task)
      order[key] = sort
    }
    return buckets.sorted { (order[$0.key] ?? "", $0.key) < (order[$1.key] ?? "", $1.key) }
      .map { ($0.key, $0.value) }
  }

  private func taskLine(_ task: Record, blockers: [String], unlocks: Int, listName: String?, pending: Bool)
    -> some View
  {
    let done = task.text("status") == "completed"
    let dropped = task.text("status") == "discarded"
    let canCheck = !dropped && (done || blockers.isEmpty)
    return HStack(spacing: 0) {
      Button {
        toggle(task)
      } label: {
        ZStack {
          Circle().fill(Ink.raised)
          if done {
            Circle().fill(Ink.text)
            Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Ink.card)
          } else {
            Circle().stroke(canCheck ? Ink.live : Ink.text3, style: StrokeStyle(lineWidth: 1.4, dash: canCheck ? [] : [3, 2]))
          }
        }.frame(width: 18, height: 18).frame(width: 44, height: 44).contentShape(Rectangle())
      }.buttonStyle(.plain).disabled(!canCheck)
        .accessibilityLabel((done ? "恢复 " : "完成 ") + task.title)
        .sensoryFeedback(.success, trigger: done) { _, new in new }
      Button {
        editing = task
      } label: {
        HStack {
          VStack(alignment: .leading, spacing: 3) {
            Text(task.title).font(Ink.row).lineLimit(1).foregroundStyle(done || dropped ? Ink.text3 : Ink.text)
              .strikethrough(done, color: Ink.text3)
            HStack(spacing: 6) {
              if let listName, !listName.isEmpty { Text(listName).lineLimit(1) }
              let schedule = TaskRules.schedule(task)
              if schedule.kind != "unscheduled" { Text(taskScheduleText(task)).lineLimit(1) }
              if !blockers.isEmpty { Text("↳ 等 \(blockers.count) 项").fixedSize() }
              if !done && !dropped && blockers.isEmpty && unlocks > 0 { Text("↪ 解锁 \(unlocks) 项").foregroundStyle(Ink.live).fixedSize() }
            }.font(Ink.meta).foregroundStyle(Ink.text3)
          }
          Spacer(minLength: 0)
          if pending {
            Image(systemName: "icloud.and.arrow.up").font(Ink.meta).foregroundStyle(Ink.text3)
          }
        }.frame(height: 49).contentShape(Rectangle())
      }.buttonStyle(.plain)
    }.background(notice?.unlocked.contains(task.id) == true ? Ink.live.opacity(0.12) : Color.clear)
  }

  private func row(_ task: Record, blockers: [String], unlocks: Int, listName: String?, pending: Bool)
    -> some View
  {
    let done = task.text("status") == "completed"
    let dropped = task.text("status") == "discarded"
    let canCheck = !dropped && (done || blockers.isEmpty)
    return taskLine(task, blockers: blockers, unlocks: unlocks, listName: listName, pending: pending).cardRow()
    .swipeActions(edge: .leading) {
      if canCheck {
        Button(done ? "恢复" : "完成", systemImage: "checkmark") {
          toggle(task)
        }.tint(Ink.live)
      }
    }
    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
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
  var initialListID = ""
  var onComplete: ((Record) async -> Bool)? = nil
  @State private var title = ""
  @State private var note = ""
  @State private var listID = ""
  @State private var kind = "unscheduled"
  @State private var date = Date()
  @State private var end = Date()
  @State private var hasTime = false
  @State private var clock = Date()
  @State private var prerequisites: [String] = []
  @State private var picking = false
  @State private var saving = false

  var body: some View {
    let all = studio.all("task")
    let byID = Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })
    NavigationStack {
      Form {
        Section {
          TextField("要做的事", text: $title, axis: .vertical).font(Ink.row).lineLimit(1...4)
          TextField("备注", text: $note, axis: .vertical).lineLimit(2...6)
        }.listRowBackground(Ink.raised)
        Section("安排") {
          Picker("方式", selection: $kind) {
            Text("未定").tag("unscheduled")
            Text("近期").tag("recent")
            Text("某天").tag("day")
            Text("期间").tag("range")
            Text("截止").tag("deadline")
          }.pickerStyle(.segmented)
          if ["day", "deadline", "range"].contains(kind) {
            DatePicker(kind == "range" ? "开始" : kind == "deadline" ? "截止到" : "日期",
              selection: $date, displayedComponents: .date)
          }
          if kind == "day" || kind == "deadline" {
            Toggle("指定时间", isOn: $hasTime)
            if hasTime { DatePicker("时间", selection: $clock, displayedComponents: .hourAndMinute) }
          }
          if kind == "range" {
            DatePicker("结束", selection: $end, in: date..., displayedComponents: .date)
          }
          Picker("所属清单", selection: $listID) {
            Text("不归类").tag("")
            ForEach(studio.all("taskList")) { Text($0.title).tag($0.id) }
          }
        }.listRowBackground(Ink.raised)
        Section("前置任务") {
          ForEach(prerequisites, id: \.self) { id in
            HStack {
              Label(byID[id]?.title ?? "已移除的任务",
                systemImage: byID[id]?.text("status") == "completed" ? "checkmark.circle" : "circle")
              Spacer()
              Button {
                prerequisites.removeAll { $0 == id }
              } label: {
                Image(systemName: "minus.circle").foregroundStyle(Ink.text2)
              }.buttonStyle(.plain).accessibilityLabel("移除前置任务")
            }
          }
          Button("添加前置任务", systemImage: "plus") { picking = true }
            .disabled(prerequisites.count >= 40)
        }.listRowBackground(Ink.raised)
        if let record {
          lifecycle(byID[record.id] ?? record, byID: byID)
        }
      }
      .scrollContentBackground(.hidden).background(Ink.card)
      .environment(\.locale, Locale(identifier: "zh_CN"))
      .environment(\.calendar, CalendarDays.calendar)
      .navigationTitle(record == nil ? "新任务" : "任务").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") { save() }.fontWeight(.semibold)
            .disabled(saving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
              title.utf16.count > 500 || note.utf16.count > 10000)
        }
      }
    }.studioSheet()
      .sheet(isPresented: $picking) {
        PrerequisitePicker(items: all.filter { item in
          item.text("status") == "pending" && !prerequisites.contains(item.id) &&
            (record.map { !TaskRules.reaches(item.id, target: $0.id, byID: byID) } ?? true)
        }) { prerequisites.append($0) }
      }
      .onAppear {
        listID = initialListID
        guard let record else { return }
        title = record.title
        note = record.text("note")
        listID = record.text("listId")
        prerequisites = TaskRules.prerequisites(record)
        let s = TaskRules.schedule(record)
        kind = s.kind
        let parts = record.text("scheduleTime").split(separator: ":").compactMap { Int($0) }
        if parts.count == 2, let saved = CalendarDays.calendar.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: Date()) {
          hasTime = true
          clock = saved
        }
        date = CalendarDays.date(s.date ?? s.start ?? "") ?? Date()
        end = CalendarDays.date(s.end ?? "") ?? date
      }
  }

  @ViewBuilder private func lifecycle(_ record: Record, byID: [String: Record]) -> some View {
    Section {
      let status = record.text("status")
      if status == "pending" {
        Button("标记完成", systemImage: "checkmark.circle") { act("complete") }
          .disabled(saving || !TaskRules.blockers(record, byID: byID).isEmpty)
      } else {
        Button("恢复待办", systemImage: "arrow.uturn.backward") { act("reopen") }.disabled(saving)
      }
      if status != "discarded" {
        Button("废弃这件事", systemImage: "xmark.circle", role: .destructive) { act("discard") }
          .disabled(saving)
      }
      if let done = TaskRules.completionDay(record) {
        LabeledContent("上次完成", value: done)
      }
    }.listRowBackground(Ink.raised)
  }

  private var schedule: Schedule {
    let a = CalendarDays.string(date)
    switch kind {
    case "day", "deadline": return Schedule(kind: kind, date: a)
    case "range": return Schedule(kind: kind, start: a, end: CalendarDays.string(max(date, end)))
    default: return Schedule(kind: kind)
    }
  }

  private var scheduleClock: String {
    guard hasTime && (kind == "day" || kind == "deadline") else { return "" }
    let parts = CalendarDays.calendar.dateComponents([.hour, .minute], from: clock)
    return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
  }

  private func save() {
    saving = true
    Task {
      defer { saving = false }
      if await studio.task(record, record == nil ? "create" : "schedule", title: title, schedule: schedule,
        fields: ["note": .string(note), "listId": .string(listID),
          "scheduleTime": .string(scheduleClock),
          "prerequisiteIds": .array(prerequisites.map(JSONValue.string))]) { dismiss() }
    }
  }

  private func act(_ action: String) {
    saving = true
    Task {
      defer { saving = false }
      if action == "complete", let record, let onComplete {
        let current = studio.all("task").first { $0.id == record.id } ?? record
        if await onComplete(current) { dismiss() }
      } else if await studio.task(record, action) {
        dismiss()
      }
    }
  }
}

private struct PrerequisitePicker: View {
  @Environment(\.dismiss) private var dismiss
  let items: [Record]
  let select: (String) -> Void
  @State private var search = ""
  var body: some View {
    NavigationStack {
      List(items.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }) { item in
        Button(item.title) {
          select(item.id)
          dismiss()
        }.cardRow()
      }.studioList()
        .searchable(text: $search, prompt: "搜索任务")
        .navigationTitle("选择前置").navigationBarTitleDisplayMode(.inline)
        .toolbar { Button("取消") { dismiss() } }
    }.studioSheet()
  }
}

private enum TaskDependencyLayout {
  static func layers(_ tasks: [Record]) -> [[Record]] {
    let byID = Dictionary(uniqueKeysWithValues: tasks.map { ($0.id, $0) })
    var levels: [String: Int] = [:]
    var waiting: [String: Int] = [:]
    var outgoing: [String: [String]] = [:]
    for task in tasks {
      for id in TaskRules.prerequisites(task) where byID[id] != nil {
        waiting[task.id, default: 0] += 1
        outgoing[id, default: []].append(task.id)
      }
    }
    var queue = tasks.filter { waiting[$0.id] == nil }.map(\.id)
    var result: [[Record]] = []
    var index = 0
    while index < queue.count {
      let id = queue[index]
      index += 1
      guard let task = byID[id] else { continue }
      let level = levels[id] ?? 0
      while result.count <= level { result.append([]) }
      result[level].append(task)
      for child in outgoing[id] ?? [] {
        levels[child] = max(levels[child] ?? 0, level + 1)
        waiting[child, default: 0] -= 1
        if waiting[child] == 0 { queue.append(child) }
      }
    }
    if queue.count < tasks.count {
      if result.isEmpty { result = [[]] }
      let placed = Set(queue)
      result[0].append(contentsOf: tasks.filter { !placed.contains($0.id) })
    }
    return result
  }
}

private struct TaskListRail: View {
  let tasks: [Record]
  let blockers: [String: [String]]
  var body: some View {
    Canvas { context, _ in
      let rows = Dictionary(uniqueKeysWithValues: tasks.enumerated().map { ($0.element.id, $0.offset) })
      for (row, item) in tasks.enumerated() {
        for (index, id) in TaskRules.prerequisites(item).enumerated() {
          guard let parent = rows[id] else { continue }
          let start = CGFloat(parent) * 50 + 24.5
          let end = CGFloat(row) * 50 + 24.5
          let lane = CGFloat(4 + index % 3 * 3)
          let turn = CGFloat(end > start ? 6 : -6)
          let path = Path { line in
            line.move(to: CGPoint(x: 22, y: start))
            line.addQuadCurve(to: CGPoint(x: lane, y: start + turn), control: CGPoint(x: lane, y: start))
            line.addLine(to: CGPoint(x: lane, y: end - turn))
            line.addQuadCurve(to: CGPoint(x: 22, y: end), control: CGPoint(x: lane, y: end))
          }
          let color = blockers[id]?.isEmpty == true ? Ink.live.opacity(0.6) : Ink.text3.opacity(0.38)
          context.stroke(path, with: .color(color), lineWidth: 1)
        }
      }
    }.frame(width: 32).allowsHitTesting(false).accessibilityHidden(true)
  }
}

private struct TaskMap: View {
  let tasks: [Record]
  let blockers: [String: [String]]
  let unlocks: [String: Int]
  let source: String?
  let linking: Bool
  let canSelect: (Record) -> Bool
  let select: (Record) -> Void
  @State private var zoom: CGFloat = 1
  private let nodeSize = CGSize(width: 140, height: 60)
  private let step = CGSize(width: 158, height: 100)

  var body: some View {
    let levels = TaskDependencyLayout.layers(tasks)
    let columns = levels.map(\.count).max() ?? 1
    let board = CGSize(width: max(295, CGFloat(columns) * step.width + 14), height: max(280, CGFloat(levels.count) * step.height))
    let points = positions(levels, width: board.width)
    VStack(alignment: .trailing, spacing: 8) {
      ScrollView([.horizontal, .vertical]) {
        ZStack(alignment: .topLeading) {
          Canvas { context, _ in
            var grid = Path()
            for x in stride(from: CGFloat(8), to: board.width, by: 14) {
              for y in stride(from: CGFloat(8), to: board.height, by: 14) {
                grid.addEllipse(in: CGRect(x: x, y: y, width: 1.4, height: 1.4))
              }
            }
            context.fill(grid, with: .color(Ink.text3.opacity(0.25)))
            for item in tasks {
              guard let point = points[item.id] else { continue }
              let parents = TaskRules.prerequisites(item).compactMap { id in
                points[id].map { (id, $0) }
              }.sorted { $0.1.x < $1.1.x }
              for (index, entry) in parents.enumerated() {
                let (id, parent) = entry
                let offset = (CGFloat(index) - CGFloat(parents.count - 1) / 2) * min(16, 110 / CGFloat(parents.count))
                let start = CGPoint(x: parent.x, y: parent.y + nodeSize.height / 2)
                let end = CGPoint(x: point.x + offset, y: point.y - nodeSize.height / 2 - 2)
                let middle = (start.y + end.y) / 2
                let path = Path { line in
                  line.move(to: start)
                  if point.y - parent.y > step.height {
                    let right = (parent.x + point.x) / 2 > board.width / 2
                    let gutter = right ? board.width - 8 : 8
                    let exit = start.y + 17
                    let entry = end.y - 17
                    line.addQuadCurve(to: CGPoint(x: gutter, y: exit),
                      control: CGPoint(x: start.x, y: exit))
                    line.addLine(to: CGPoint(x: gutter, y: entry))
                    line.addQuadCurve(to: end, control: CGPoint(x: end.x, y: entry))
                  } else {
                    line.addCurve(to: end, control1: CGPoint(x: start.x, y: middle),
                      control2: CGPoint(x: end.x, y: middle))
                  }
                  line.move(to: CGPoint(x: end.x - 3.5, y: end.y - 5))
                  line.addLine(to: end)
                  line.addLine(to: CGPoint(x: end.x + 3.5, y: end.y - 5))
                }
                context.stroke(path, with: .color(id == source ? Ink.live : Ink.text3.opacity(0.6)), style: StrokeStyle(lineWidth: 1.25, lineCap: .round))
              }
            }
          }.accessibilityHidden(true).allowsHitTesting(false)
          ForEach(tasks) { item in
            if let point = points[item.id] { node(item).position(point) }
          }
        }.frame(width: board.width, height: board.height)
          .scaleEffect(zoom, anchor: .topLeading)
          .frame(width: board.width * zoom, height: board.height * zoom, alignment: .topLeading)
      }
      .frame(height: min(420, board.height * zoom))
      .background(Ink.card, in: RoundedRectangle(cornerRadius: 12))
      .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Ink.line).allowsHitTesting(false))
      .accessibilityLabel("任务关系图")
      HStack(spacing: 8) {
        Button { zoom = max(0.65, zoom - 0.15) } label: { Image(systemName: "minus") }.accessibilityLabel("缩小关系图")
        Button("\(Int((zoom * 100).rounded()))%") { zoom = 1 }.accessibilityLabel("还原关系图大小")
        Button { zoom = min(1.6, zoom + 0.15) } label: { Image(systemName: "plus") }.accessibilityLabel("放大关系图")
      }.font(Ink.meta).buttonStyle(.borderless).foregroundStyle(Ink.text2)
    }
  }

  private func positions(_ levels: [[Record]], width: CGFloat) -> [String: CGPoint] {
    var points: [String: CGPoint] = [:]
    for (row, items) in levels.enumerated() {
      for (column, item) in items.enumerated() {
        var x = width / 2 + (CGFloat(column) - CGFloat(items.count - 1) / 2) * step.width
        if items.count == 1 {
          let parents = TaskRules.prerequisites(item).compactMap { points[$0]?.x }
          if !parents.isEmpty { x = parents.reduce(0, +) / CGFloat(parents.count) }
        }
        points[item.id] = CGPoint(x: x, y: 43 + CGFloat(row) * step.height)
      }
    }
    return points
  }

  private func node(_ item: Record) -> some View {
    let waiting = blockers[item.id]?.count ?? 0
    let done = item.text("status") == "completed"
    let ready = !done && waiting == 0
    return Button { select(item) } label: {
      VStack(alignment: .leading, spacing: 3) {
        Text(item.title).font(.system(size: 13, weight: .semibold)).lineLimit(2)
          .strikethrough(done).foregroundStyle(done ? Ink.text3 : Ink.text)
        HStack(spacing: 5) {
          if waiting > 0 { Text("↳ 等 \(waiting) 项") }
          else if let count = unlocks[item.id], count > 0 { Text("↪ 解锁 \(count) 项").foregroundStyle(Ink.live) }
          if TaskRules.schedule(item).kind != "unscheduled" { Text(taskScheduleText(item)).lineLimit(1) }
        }.font(Ink.meta).foregroundStyle(Ink.text3)
      }.padding(.horizontal, 9)
        .frame(width: nodeSize.width, height: nodeSize.height, alignment: .leading)
        .background(ready ? Ink.live.opacity(0.13) : Ink.raised, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(source == item.id ? Ink.live : Ink.text3.opacity(ready ? 0.4 : 0.28)))
        .contentShape(Rectangle())
    }.buttonStyle(.plain).disabled(linking && !canSelect(item))
  }
}


private func taskScheduleText(_ task: Record) -> String {
  let clock = task.text("scheduleTime")
  let date = TaskRules.label(TaskRules.schedule(task))
  return clock.isEmpty ? date : date + " " + clock
}

private struct OrganizeTasksSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let listID: String
  let onDone: ([String]) -> Void
  @State private var input = ""
  @State private var endpoint = ""
  @State private var model = ""
  @State private var apiKey = ""
  @State private var items: [TaskPlanService.Item] = []
  @State private var ids: [String: String] = [:]
  @State private var error = ""
  @State private var busy = false

  var body: some View {
    NavigationStack {
      Form {
        if items.isEmpty {
          Section {
            TextField("粘贴一段想整理的事情…", text: $input, axis: .vertical).lineLimit(4...10)
          } footer: { Text("点击整理时，原文会发送到你填写的模型接口。") }
          Section {
            TextField("HTTPS 接口完整地址", text: $endpoint).keyboardType(.URL)
              .textInputAutocapitalization(.never).autocorrectionDisabled()
            TextField("模型名称", text: $model).textInputAutocapitalization(.never).autocorrectionDisabled()
            SecureField("API 密钥", text: $apiKey).textInputAutocapitalization(.never)
          }
        } else {
          Section("待添加") {
            ForEach($items) { $item in
              VStack(alignment: .leading, spacing: 4) {
                TextField("事项名称", text: $item.title).font(Ink.row)
                if let date = item.date, !date.isEmpty {
                  Text([date, item.time ?? ""].filter { !$0.isEmpty }.joined(separator: " ")).font(Ink.meta)
                }
                if !item.after.isEmpty {
                  Text("前置 · " + item.after.compactMap { key in items.first { $0.key == key }?.title }
                    .joined(separator: "、")).font(Ink.meta)
                }
                if let note = item.note, !note.isEmpty { Text(note).font(Ink.meta) }
              }.foregroundStyle(Ink.text2)
            }
          }
          Section { DisclosureGroup("原文") { Text(input).font(Ink.row) } }
        }
        if !error.isEmpty { Section { Text(error).font(Ink.meta).foregroundStyle(Ink.amber) } }
      }
      .disabled(busy)
      .navigationTitle("AI 整理").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("取消") { dismiss() }.disabled(busy)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(busy ? "处理中…" : items.isEmpty ? "整理" : "添加 \(items.count) 项") {
            if items.isEmpty { generate() } else { apply() }
          }.disabled(busy || (items.isEmpty
            ? input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || input.utf16.count > 4000 || endpoint.isEmpty || model.isEmpty
            : items.contains { $0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || $0.title.utf16.count > 500 }))
        }
      }
    }.studioSheet().interactiveDismissDisabled(busy)
  }

  private func generate() {
    busy = true
    error = ""
    Task {
      defer { busy = false }
      do {
        let ordered = try await TaskPlanService.propose(endpoint: endpoint, model: model, apiKey: apiKey,
          input: input, day: Day.today)
        ids = Dictionary(uniqueKeysWithValues: ordered.map { ($0.key, UUID().uuidString.lowercased()) })
        items = ordered
        apiKey = ""
      } catch let issue as TaskPlanService.Failure {
        error = issue.message
      } catch {
        self.error = error is DecodingError ? "模型没有返回有效的任务格式，请重试。" : "无法连接模型接口。"
      }
    }
  }

  private func apply() {
    busy = true
    error = ""
    Task {
      defer { busy = false }
      let createdAt = ISO8601DateFormatter().string(from: Date())
      let writes = items.compactMap { item -> BatchPut? in
        guard let id = ids[item.key] else { return nil }
        let date = item.date.flatMap { value in
          value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil &&
            CalendarDays.date(value).map(CalendarDays.string) == value ? value : nil
        }
        var fields: [String: JSONValue] = [
          "title": .string(item.title.trimmingCharacters(in: .whitespacesAndNewlines)), "status": .string("pending"),
          "listId": .string(listID), "createdAt": .string(createdAt),
          "prerequisiteIds": .array(Set(item.after).sorted().compactMap { ids[$0].map(JSONValue.string) }),
          "note": .string(String((item.note ?? "").unicodeScalars.prefix(2500)) + "\n\n原文\n" + input),
        ]
        fields.merge(TaskRules.fields(date.map { Schedule(kind: "deadline", date: $0) } ?? Schedule(kind: "unscheduled"))) { _, value in value }
        if date != nil, let clock = item.time, clock.range(of: #"^(?:[01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil {
          fields["scheduleTime"] = .string(clock)
        }
        return BatchPut(type: "task", id: id, data: fields, version: 0)
      }
      guard writes.count == items.count else {
        error = "事项编号不完整，请重新整理。"
        return
      }
      let saved: Bool
      if let only = writes.first, writes.count == 1 {
        saved = await studio.save("task", only.data, id: only.id) != nil
      } else {
        saved = await studio.saveTogether(writes)
      }
      guard saved else {
        error = studio.error ?? "整批事项未保存，草稿仍保留。请重试。"
        return
      }
      onDone(writes.map(\.id))
      dismiss()
    }
  }
}
