import CouncilCore
import SwiftUI

// MARK: - Shortcuts

struct ShortcutsScreen: View {
  @Environment(Studio.self) private var studio
  @AppStorage("studio-shortcuts") private var stored = "practice,expenses,chronicle,habits,tasks,checklists"
  @State private var editing = false
  var keys: [Feature] { stored.split(separator: ",").compactMap { Feature(rawValue: String($0)) } }
  var body: some View {
    Page {
      IconGrid {
        ForEach(keys) { feature in
          NavigationLink(value: feature) {
            AppIcon(symbol: feature.symbol, name: feature.name, live: feature == .practice && studio.runningSession != nil)
          }.buttonStyle(.icon)
            .contextMenu {
              Text(glance(feature))
              Button("从快捷入口移除", systemImage: "minus.circle") {
                stored = keys.filter { $0 != feature }.map(\.rawValue).joined(separator: ",")
              }
            }
        }
        Button {
          editing = true
        } label: {
          AppIcon(symbol: "plus", name: "添加", ghost: true)
        }.buttonStyle(.icon)
      }.padding(.top, 8)
    }
    .navigationTitle("快捷入口").toolbarBackground(Ink.bg, for: .navigationBar)
    .toolbar { Button("编辑") { editing = true } }
    .sheet(isPresented: $editing) { ShortcutEditor(stored: $stored) }
  }
  /// One live fact per tile, so the grid is also a glance.
  func glance(_ feature: Feature) -> String {
    let today = Day.today
    switch feature {
    case .expenses:
      return "今日 " + Money.format(FinanceRules.total(studio.all("expense").filter { $0.text("day") == today }, month: String(today.prefix(7)), basis: .actual, asOf: today))
    case .practice:
      return studio.runningSession != nil ? "正在计时" : "今日 " + Clock.span(TimeMath.summarize(studio.all("session"), now: Date()).daily[today] ?? 0)
    case .chronicle:
      return "今天 \(studio.all("journal").filter { $0.text("kind") == "chronicle" && $0.text("day") == today }.count) 件事"
    case .habits:
      let records = studio.habitRecords
      let list = studio.all("habit").filter { HabitRules.isScheduled(habit: $0, day: today, records: records) }
      return "\(list.filter { HabitRules.isComplete(habit: $0, day: today, records: records) }.count)/\(list.count) 已完成"
    case .tasks:
      return "\(studio.all("task").filter { TaskRules.belongsToday($0, day: today) }.count) 件今天要做"
    default:
      return feature.department
    }
  }
}

struct ShortcutEditor: View {
  @Binding var stored: String
  @Environment(\.dismiss) private var dismiss
  @State private var list: [Feature] = []
  var body: some View {
    NavigationStack {
      List {
        Section("已添加") {
          ForEach(list) { f in Label(f.name, systemImage: f.symbol).listRowBackground(Ink.raised) }
            .onMove { list.move(fromOffsets: $0, toOffset: $1) }
            .onDelete { list.remove(atOffsets: $0) }
        }
        Section("可添加") {
          ForEach(Feature.allCases.filter { !list.contains($0) }) { f in
            Button {
              list.append(f)
            } label: {
              Label(f.name, systemImage: f.symbol)
            }.listRowBackground(Ink.raised)
          }
        }
      }.environment(\.editMode, .constant(.active)).scrollContentBackground(.hidden)
        .navigationTitle("快捷入口").navigationBarTitleDisplayMode(.inline)
        .toolbar {
          Button("完成") {
            stored = list.map(\.rawValue).joined(separator: ",")
            dismiss()
          }.fontWeight(.semibold)
        }
    }.studioSheet().onAppear { list = stored.split(separator: ",").compactMap { Feature(rawValue: String($0)) } }
  }
}

// MARK: - Departments

struct DepartmentRoute: Hashable { let id: String }

/// A department: built-in by name, or a custom record.
struct DepartmentInfo: Identifiable {
  let id: String
  let name: String
  let symbol: String
  let features: [Feature]
  let record: Record?
}

extension Studio {
  static let builtInDepartments = ["执行部", "财政部", "档案库", "中科院"]
  var departments: [DepartmentInfo] {
    let symbols = ["执行部": "bolt.horizontal", "财政部": "yensign", "档案库": "archivebox", "中科院": "atom"]
    return Studio.builtInDepartments.map { name in
      DepartmentInfo(
        id: name, name: name, symbol: symbols[name] ?? "folder",
        features: Feature.allCases.filter { $0.department == name }, record: nil)
    }
      + all("department").map { custom in
        DepartmentInfo(
          id: custom.id, name: custom.title, symbol: "folder",
          features: (custom.data["features"]?.strings ?? []).compactMap(Feature.init(rawValue:)), record: custom)
      }
  }
}

struct DepartmentsScreen: View {
  @Environment(Studio.self) private var studio
  @AppStorage("studio-common-departments") private var commonStored = "执行部,财政部,档案库,中科院"
  @State private var scope = "common"
  @State private var form: EntityForm?
  var common: [String] { commonStored.split(separator: ",").map(String.init) }
  var body: some View {
    let all = studio.departments
    let shown = scope == "common" ? all.filter { common.contains($0.id) } : all
    Page {
      ChipBar(
        options: [("common", "常用部门 \(common.filter { id in all.contains { $0.id == id } }.count)"), ("all", "所有部门 \(all.count)")],
        selection: $scope)
      IconGrid {
        ForEach(shown) { department in
          NavigationLink(value: DepartmentRoute(id: department.id)) {
            DepartmentIcon(department: department, pinned: scope == "all" && common.contains(department.id))
          }.buttonStyle(.icon)
            .contextMenu {
              if common.contains(department.id) {
                Button("移出常用", systemImage: "star.slash") {
                  commonStored = common.filter { $0 != department.id }.joined(separator: ",")
                }
              } else {
                Button("加入常用", systemImage: "star") {
                  commonStored = (common + [department.id]).joined(separator: ",")
                }
              }
              if let record = department.record {
                Button("编辑部门", systemImage: "pencil") { form = EntityForm(type: "department", record: record) }
              }
            }
        }
        if scope == "all" {
          Button {
            form = EntityForm(type: "department", fields: ["name", "features"])
          } label: {
            AppIcon(symbol: "plus", name: "新部门", ghost: true)
          }.buttonStyle(.icon)
        }
      }.padding(.top, 6)
      if shown.isEmpty {
        Text("长按“所有部门”里的部门，加入常用。").font(Ink.meta).foregroundStyle(Ink.text3)
          .frame(maxWidth: .infinity).padding(.top, 24)
      }
    }
    .navigationTitle("部门").toolbarBackground(Ink.bg, for: .navigationBar)
    .navigationDestination(for: DepartmentRoute.self) { route in DepartmentDetail(id: route.id) }
    .sheet(item: $form) { EntityFormSheet(form: $0) }
  }
}

struct DepartmentDetail: View {
  @Environment(Studio.self) private var studio
  let id: String
  var body: some View {
    let department = studio.departments.first { $0.id == id }
    Page {
      IconGrid {
        ForEach(department?.features ?? []) { feature in
          NavigationLink(value: feature) {
            AppIcon(symbol: feature.symbol, name: feature.name)
          }.buttonStyle(.icon)
        }
      }.padding(.top, 8)
      if id == "中科院", !studio.all("domain").isEmpty {
        SectionLabel(text: "领域")
        Card {
          VStack(spacing: 0) {
            ForEach(Array(studio.all("domain").enumerated()), id: \.element.id) { index, domain in
              if index > 0 { Hairline() }
              HStack {
                Text(domain.title).font(Ink.row).foregroundStyle(Ink.text)
                Spacer()
                Text("\(studio.all("activity").filter { $0.text("domainId") == domain.id }.count) 子领域 · \(studio.all("document").filter { $0.text("domainId") == domain.id }.count) 篇资料")
                  .font(.system(size: 12)).foregroundStyle(Ink.text3)
              }.padding(.vertical, 11)
            }
          }
        }
      }
    }
    .navigationTitle(department?.name ?? "部门").navigationBarTitleDisplayMode(.inline)
    .toolbarBackground(Ink.bg, for: .navigationBar)
  }
}

// MARK: - Home-screen icons

/// Four columns, like the iPhone home screen.
struct IconGrid<Content: View>: View {
  @ViewBuilder var content: Content
  var body: some View {
    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: 4), spacing: 22) {
      content
    }
  }
}

/// A squircle tile with a glyph and a one-line name underneath.
struct AppIcon: View {
  let symbol: String
  let name: String
  var live = false
  var ghost = false
  var body: some View {
    VStack(spacing: 7) {
      ZStack(alignment: .topTrailing) {
        IconTile(ghost: ghost) {
          Image(systemName: symbol).font(.system(size: 25, weight: ghost ? .regular : .medium))
            .foregroundStyle(ghost ? Ink.text3 : Ink.text)
        }
        if live {
          Circle().fill(Color(red: 0.29, green: 0.87, blue: 0.5)).frame(width: 10, height: 10)
            .overlay(Circle().stroke(Ink.bg, lineWidth: 2)).offset(x: 3, y: -3)
        }
      }
      Text(name).font(.system(size: 12, weight: .medium)).foregroundStyle(ghost ? Ink.text3 : Ink.text2)
        .lineLimit(1).minimumScaleFactor(0.85)
    }
  }
}

/// Each department has its own mark; the tile stays black and white — distinction by glyph, not colour.
struct DepartmentIcon: View {
  let department: DepartmentInfo
  var pinned = false
  static let marks: [String: String] = [
    "执行部": "scope", "财政部": "yensign", "档案库": "books.vertical", "中科院": "atom",
  ]
  var body: some View {
    let shape = RoundedRectangle(cornerRadius: 17, style: .continuous)
    VStack(spacing: 7) {
      ZStack {
        shape.fill(LinearGradient(colors: [Color(white: 0.16), Color(white: 0.05)], startPoint: .top, endPoint: .bottom))
        // A soft top sheen, like light on lacquer.
        shape.fill(
          RadialGradient(colors: [Color.white.opacity(0.10), .clear], center: .top, startRadius: 0, endRadius: 46))
        if let symbol = DepartmentIcon.marks[department.name] {
          Image(systemName: symbol).font(.system(size: 26, weight: .light))
            .foregroundStyle(LinearGradient(colors: [.white, Color(white: 0.62)], startPoint: .top, endPoint: .bottom))
        } else {
          Text(String(department.name.prefix(1))).font(.system(size: 26, weight: .regular, design: .serif))
            .foregroundStyle(LinearGradient(colors: [.white, Color(white: 0.62)], startPoint: .top, endPoint: .bottom))
        }
        shape.strokeBorder(
          LinearGradient(colors: [Color.white.opacity(0.22), Color.white.opacity(0.03)], startPoint: .top, endPoint: .bottom),
          lineWidth: 0.75)
      }
      .frame(width: 64, height: 64)
      .shadow(color: .black.opacity(0.6), radius: 8, y: 4)
      HStack(spacing: 3) {
        if pinned { Image(systemName: "star.fill").font(.system(size: 8)).foregroundStyle(Ink.text3) }
        Text(department.name).font(.system(size: 12, weight: .medium)).foregroundStyle(Ink.text2).lineLimit(1)
      }
    }
  }
}

struct IconTile<Content: View>: View {
  var ghost = false
  @ViewBuilder var content: Content
  var body: some View {
    let shape = RoundedRectangle(cornerRadius: 17, style: .continuous)
    content
      .frame(width: 64, height: 64)
      .background {
        if ghost {
          shape.strokeBorder(Ink.text3.opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
        } else {
          shape.fill(
            LinearGradient(
              colors: [Color(white: 0.17), Color(white: 0.085)], startPoint: .top, endPoint: .bottom)
          )
          .overlay(shape.strokeBorder(Color.white.opacity(0.09), lineWidth: 0.5))
          .shadow(color: .black.opacity(0.5), radius: 6, y: 3)
        }
      }
  }
}

/// Home-screen press feel: shrink slightly while held.
struct IconButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.scaleEffect(configuration.isPressed ? 0.9 : 1)
      .animation(.snappy(duration: 0.18), value: configuration.isPressed)
      .contentShape(Rectangle())
  }
}
extension ButtonStyle where Self == IconButtonStyle {
  static var icon: IconButtonStyle { IconButtonStyle() }
}

// MARK: - Review

struct ReviewScreen: View {
  @Environment(Studio.self) private var studio
  @State private var month = String(Day.today.prefix(7))
  @State private var settings = false
  var body: some View {
    let summary = TimeMath.summarize(studio.all("session"), now: Date())
    let time = summary.daily.filter { $0.key.hasPrefix(month) }.values.reduce(0, +)
    let lines = studio.all("journal").filter { $0.text("kind") == "chronicle" && $0.text("day").hasPrefix(month) }
    let spend = FinanceRules.total(studio.all("expense"), month: month, basis: .actual, asOf: Day.today)
    let records = studio.habitRecords
    let habits = studio.all("habit").filter { $0.text("status") != "archived" }
    let monthSummaries = habits.map { HabitRules.month(habit: $0, month: month, records: records) }
    let doneTasks = studio.all("task").filter { TaskRules.completionDay($0)?.hasPrefix(month) == true }
    Page {
      MonthBar(month: $month).padding(.horizontal, 6)
      LazyVGrid(columns: [GridItem(.flexible(), spacing: Ink.gap), GridItem(.flexible(), spacing: Ink.gap)], spacing: Ink.gap) {
        tile("推进", Clock.span(time), "scope")
        tile("花销", Money.format(spend), "creditcard")
        tile("完成任务", "\(doneTasks.count)", "checklist")
        tile("习惯完成", "\(monthSummaries.map(\.completedDays).reduce(0, +)) 次", "repeat")
      }
      Card(icon: "book.closed", title: "这个月发生的事", meta: "\(lines.count) 件") {
        VStack(alignment: .leading, spacing: 0) {
          let days = Array(Set(lines.map { $0.text("day") })).sorted(by: >)
          ForEach(Array(days.prefix(12).enumerated()), id: \.element) { index, day in
            if index > 0 { Hairline(inset: 44) }
            HStack(alignment: .top, spacing: 12) {
              Text(String(Int(day.suffix(2)) ?? 0)).font(.system(size: 18, weight: .semibold, design: .rounded))
                .foregroundStyle(Ink.text).frame(width: 32, alignment: .leading)
              VStack(alignment: .leading, spacing: 4) {
                ForEach(lines.filter { $0.text("day") == day }) { line in
                  Text(line.text("body")).font(Ink.row).foregroundStyle(Ink.text2).lineLimit(2)
                }
              }
            }.padding(.vertical, 10)
          }
          if lines.isEmpty { EmptyNote(text: "这个月还没有记录") }
        }
      }
    }
    .navigationTitle("回顾").toolbarBackground(Ink.bg, for: .navigationBar)
    .toolbar {
      Button {
        settings = true
      } label: {
        Image(systemName: "gearshape")
      }.accessibilityLabel("设置")
    }
    .sheet(isPresented: $settings) { SettingsSheet() }
  }
  func tile(_ title: String, _ value: String, _ icon: String) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Label(title, systemImage: icon).font(Ink.meta).foregroundStyle(Ink.text3)
      Text(value).font(Ink.figureSmall).monospacedDigit().foregroundStyle(Ink.text).lineLimit(1).minimumScaleFactor(0.6)
    }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
      .background(Ink.card, in: RoundedRectangle(cornerRadius: Ink.radius, style: .continuous))
  }
}

// MARK: - Search

struct SearchScreen: View {
  @Environment(Studio.self) private var studio
  @State private var query = ""
  @State private var results: [Record] = []
  var body: some View {
    List {
      ForEach(results) { row in
        NavigationLink(value: feature(row)) {
          VStack(alignment: .leading, spacing: 4) {
            Text(row.title).font(Ink.row).foregroundStyle(Ink.text).lineLimit(2)
            Text(kind(row) + " · " + row.text("day", String(row.updatedAt.prefix(10)))).font(.system(size: 12))
              .foregroundStyle(Ink.text3)
          }.padding(.vertical, 2)
        }.cardRow()
      }
      if !query.isEmpty && results.isEmpty {
        Text("没有找到相关记录").font(Ink.meta).foregroundStyle(Ink.text3).cardRow()
      }
    }
    .studioList()
    .navigationTitle("搜索").toolbarBackground(Ink.bg, for: .navigationBar)
    .searchable(text: $query, prompt: "文章、记录、任务、消费…")
    .task(id: query) {
      try? await Task.sleep(for: .milliseconds(180))
      results = (try? await studio.store.search(query)) ?? []
    }
  }
  func kind(_ row: Record) -> String {
    [
      "document": "文章", "journal": "记录", "idea": "想法", "task": "任务", "expense": "消费", "problem": "问题",
      "solution": "方案", "progress": "进展", "habit": "习惯", "wallet": "账户", "importantDay": "日子",
    ][row.type] ?? row.type
  }
  func feature(_ row: Record) -> Feature {
    switch row.type {
    case "document": return row.text("kind") == "monthly" ? .monthly : row.text("kind") == "thought" ? .thoughts : .notes
    case "journal": return row.text("kind") == "raw" ? .raw : .chronicle
    case "idea": return .ideas
    case "task": return .tasks
    case "expense", "category", "budget", "recurringExpense": return .expenses
    case "wallet", "walletEntry": return .treasury
    case "habit", "habitLog": return .habits
    case "metric", "metricLog": return .metrics
    case "importantDay": return .days
    case "checklist": return .checklists
    default: return .practice
    }
  }
}

// MARK: - Settings

struct SettingsSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  @State private var code = ""
  @State private var pairing = false
  @State private var pairError: String?
  var body: some View {
    @Bindable var studio = studio
    NavigationStack {
      Form {
        Section {
          LabeledContent("状态") {
            Label(studio.syncState.label, systemImage: studio.syncState.symbol)
          }
          TextField("服务地址", text: $studio.endpoint).textInputAutocapitalization(.never)
            .keyboardType(.URL).autocorrectionDisabled()
          if studio.token.isEmpty || studio.syncState == .unauthorized {
            TextField("一次性连接码", text: $code).textInputAutocapitalization(.characters)
              .autocorrectionDisabled().font(.system(.body, design: .monospaced))
              .textContentType(.oneTimeCode)
            if let pairError { Text(pairError).font(.system(size: 12)).foregroundStyle(Ink.amber) }
            Button(pairing ? "正在连接…" : "连接这台手机") {
              pairing = true
              Task {
                pairError = await studio.pair(code: code)
                if pairError == nil { code = "" }
                pairing = false
              }
            }.disabled(pairing || code.filter { $0.isLetter || $0.isNumber }.count < 8)
          } else {
            Button("立即同步") { Task { await studio.sync() } }
            Button("断开此设备", role: .destructive) { Task { await studio.unpair() } }
          }
        } header: {
          Text("同步")
        } footer: {
          Text("连接码由服务器生成、只能用一次。凭证保存在本机钥匙串；断开后记录仍留在手机上。")
        }.listRowBackground(Ink.raised)
        Section("待发送与异常 · \(studio.pending.count)") {
          ForEach(studio.pending) { op in
            VStack(alignment: .leading, spacing: 6) {
              Text(studio.title(of: op)).lineLimit(2)
              Text(op.state == "conflict" ? "另一端也改了这条" : op.state == "error" ? (op.error ?? "内容需要检查") : "等待同步")
                .font(.system(size: 12)).foregroundStyle(op.state == "queued" ? Ink.text3 : Ink.amber)
              if ["conflict", "error"].contains(op.state) {
                HStack {
                  Button("保留本机") { Task { await studio.resolve(op, keep: true) } }.buttonStyle(.chip)
                  Button("采用服务器") { Task { await studio.resolve(op, keep: false) } }.buttonStyle(.chip)
                }
              }
            }.listRowBackground(Ink.raised)
          }
          if studio.pending.isEmpty { Text("全部已同步").foregroundStyle(Ink.text3).listRowBackground(Ink.raised) }
        }
      }.scrollContentBackground(.hidden).background(Ink.card)
        .navigationTitle("设置").navigationBarTitleDisplayMode(.inline)
        .toolbar { Button("完成") { dismiss() }.fontWeight(.semibold) }
    }.studioSheet()
  }
}
