import CouncilCore
import SwiftUI
import UIKit

@main struct StudioApp: App {
  @UIApplicationDelegateAdaptor(StudioAppDelegate.self) private var appDelegate
  @State private var studio = Studio.shared
  @Environment(\.scenePhase) private var phase

  init() {
    UIScrollView.appearance().delaysContentTouches = false
    StudioAppShortcuts.updateAppShortcutParameters()
  }
  var body: some Scene {
    WindowGroup {
      RootView().environment(studio).preferredColorScheme(.dark).tint(Ink.text)
        .task {
          await studio.bootstrap()
          await studio.applyWidgetCompletions()
          await studio.sync()
          // Hints do the fast path; this slow poll only covers a missed hint.
          while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(120))
            await studio.applyWidgetCompletions()
            await studio.sync()
          }
        }
        .task { await studio.listen() }
        .task(id: studio.revision("importantDay")) { await studio.scheduleReminders() }
        .onChange(of: phase) { _, value in
          if value == .active {
            Task {
              await studio.applyWidgetCompletions()
              await studio.sync()
            }
          }
        }
        .alert(
          "没能完成",
          isPresented: Binding(get: { studio.error != nil }, set: { if !$0 { studio.error = nil } })
        ) {
          Button("知道了", role: .cancel) {}
        } message: {
          Text(studio.error ?? "")
        }
    }
  }
}

/// Every feature, where it lives and how it looks in lists.
enum Feature: String, CaseIterable, Identifiable, Hashable {
  case practice, tasks, achievements, habits, ideas, reading, checklists, thoughts
  case expenses, treasury, freedom
  case chronicle, memoir, storage, raw, monthly, metrics, days
  case notes
  var id: String { rawValue }
  var name: String {
    switch self {
    case .practice: "个人推进台"
    case .tasks: "任务"
    case .achievements: "成就"
    case .habits: "习惯"
    case .ideas: "想法暂存"
    case .reading: "待研究清单"
    case .checklists: "准备清单"
    case .thoughts: "个人思考"
    case .expenses: "花销"
    case .treasury: "国库"
    case .freedom: "自由指南灯"
    case .chronicle: "编年史"
    case .memoir: "回忆录"
    case .storage: "储物箱"
    case .raw: "未加工原料"
    case .monthly: "月报"
    case .metrics: "每日指标"
    case .days: "重要日子"
    case .notes: "资料笔记"
    }
  }
  var symbol: String {
    switch self {
    case .practice: "scope"
    case .tasks: "checklist"
    case .achievements: "trophy"
    case .habits: "repeat"
    case .ideas: "lightbulb"
    case .reading: "bookmark"
    case .checklists: "list.bullet.clipboard"
    case .thoughts: "text.quote"
    case .expenses: "creditcard"
    case .treasury: "building.columns"
    case .freedom: "light.beacon.max"
    case .chronicle: "book.closed"
    case .memoir: "clock.arrow.circlepath"
    case .storage: "shippingbox"
    case .raw: "tray.and.arrow.down"
    case .monthly: "calendar"
    case .metrics: "waveform.path.ecg"
    case .days: "gift"
    case .notes: "doc.text"
    }
  }
  var department: String {
    switch self {
    case .practice, .tasks, .achievements, .ideas, .reading, .checklists: "执行部"
    case .expenses, .treasury, .freedom: "财政部"
    case .chronicle, .memoir, .storage, .raw, .monthly, .metrics, .days, .thoughts, .habits: "档案库"
    case .notes: "中科院"
    }
  }
  @MainActor @ViewBuilder var screen: some View {
    switch self {
    case .practice: PracticeScreen()
    case .tasks: TasksScreen()
    case .achievements: AchievementsScreen()
    case .habits: HabitsScreen()
    case .ideas: JournalScreen(kind: .idea)
    case .reading: ReadingListScreen()
    case .checklists: ChecklistsScreen()
    case .thoughts: DocumentsScreen(kind: "thought")
    case .expenses: FinanceScreen()
    case .treasury: TreasuryScreen()
    case .freedom: FreedomScreen()
    case .chronicle: JournalScreen(kind: .chronicle)
    case .memoir: MemoirScreen()
    case .storage: StorageScreen()
    case .raw: JournalScreen(kind: .raw)
    case .monthly: DocumentsScreen(kind: "monthly")
    case .metrics: MetricsScreen()
    case .days: DaysScreen()
    case .notes: DocumentsScreen(kind: "note")
    }
  }
}

enum RootTab: String { case today, shortcuts, departments, review, search }
private enum TaskListShortcut: Hashable { case today }

struct RootView: View {
  @Environment(Studio.self) private var studio
  @State private var systemEntry = SystemEntry.shared
  @State private var systemSheet: SystemDestination?
  @State private var tab: RootTab = .today
  @State private var todayPath = NavigationPath()
  @State private var shortcutPath: [Feature] = []
  @State private var departmentPath = NavigationPath()
  var body: some View {
    TabView(selection: $tab) {
      Tab("今日", systemImage: "square.grid.2x2.fill", value: RootTab.today) {
        NavigationStack(path: $todayPath) {
          TodayScreen { todayPath.append($0) }
            .navigationDestination(for: Feature.self) { $0.screen }
            .navigationDestination(for: TaskListShortcut.self) { _ in
              TasksScreen(initialFilter: "today")
            }
        }
      }
      Tab("快捷", systemImage: "bolt.fill", value: RootTab.shortcuts) {
        NavigationStack(path: $shortcutPath) {
          ShortcutsScreen().navigationDestination(for: Feature.self) { $0.screen }
        }
      }
      Tab("部门", systemImage: "building.2.fill", value: RootTab.departments) {
        NavigationStack(path: $departmentPath) {
          DepartmentsScreen().navigationDestination(for: Feature.self) { $0.screen }
        }
      }
      Tab("回顾", systemImage: "chart.bar.fill", value: RootTab.review) {
        NavigationStack { ReviewScreen().navigationDestination(for: Feature.self) { $0.screen } }
      }
      Tab(value: RootTab.search, role: .search) {
        NavigationStack { SearchScreen().navigationDestination(for: Feature.self) { $0.screen } }
      }
    }
    .onAppear(perform: route)
    .onOpenURL { url in
      if let destination = SystemDestination(url: url) { systemEntry.request = destination }
    }
    .onChange(of: systemEntry.request?.id, initial: true) { _, _ in
      guard let destination = systemEntry.request else { return }
      systemEntry.request = nil
      switch destination {
      case .todayTasks:
        tab = .today
        todayPath = NavigationPath([TaskListShortcut.today])
        systemSheet = nil
      case .feature(let feature):
        tab = .today
        todayPath = NavigationPath([feature])
        systemSheet = nil
      default:
        systemSheet = destination
      }
    }
    .sheet(item: $systemSheet) { destination in
      switch destination {
      case .voiceIdea: VoiceIdeaCapture()
      case .newTask: TaskSheet(record: nil)
      case .expense: ExpenseSheet(record: nil)
      case .task(let id): ShortcutTaskDetail(id: id)
      case .todayTasks, .feature: EmptyView()
      }
    }
  }
  /// STUDIO_ROUTE=tab[/feature] opens a screen directly; used for device screenshots.
  func route() {
    guard let value = ProcessInfo.processInfo.environment["STUDIO_ROUTE"] else { return }
    let parts = value.split(separator: "/").map(String.init)
    if let first = parts.first, let target = RootTab(rawValue: first) { tab = target }
    // departments/dept:<name> opens one department.
    if parts.count > 1, parts[1].hasPrefix("dept:") {
      departmentPath.append(DepartmentRoute(id: String(parts[1].dropFirst(5))))
      return
    }
    if parts.count > 1, let feature = Feature(rawValue: parts[1]) {
      switch tab {
      case .shortcuts: shortcutPath = [feature]
      case .departments: departmentPath = NavigationPath([feature])
      default: todayPath = NavigationPath([feature])
      }
    }
  }
}

private struct ShortcutTaskDetail: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let id: UUID

  var body: some View {
    let feed = studio.feed("task")
    if let item = feed.records.first(where: { UUID(uuidString: $0.id) == id && !$0.deleted }) {
      TaskSheet(record: item)
    } else {
      NavigationStack {
        Group {
          if feed.revision == 0 {
            ProgressView("载入任务…")
          } else {
            ContentUnavailableView("找不到这项任务", systemImage: "checklist")
          }
        }
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } } }
      }
    }
  }
}
