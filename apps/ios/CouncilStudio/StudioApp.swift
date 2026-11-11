import CouncilCore
import SwiftUI

@main struct StudioApp: App {
  @State private var studio = Studio()
  @Environment(\.scenePhase) private var phase
  var body: some Scene {
    WindowGroup {
      RootView().environment(studio).preferredColorScheme(.dark).tint(Ink.text)
        .task {
          await studio.bootstrap()
          await studio.sync()
          // Hints do the fast path; this slow poll only covers a missed hint.
          while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(120))
            await studio.sync()
          }
        }
        .task { await studio.listen() }
        .task(id: studio.revision("importantDay")) { await studio.scheduleReminders() }
        .onChange(of: phase) { _, value in if value == .active { Task { await studio.sync() } } }
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
  case practice, tasks, habits, ideas, checklists, thoughts
  case expenses, treasury
  case chronicle, raw, monthly, metrics, days
  case notes
  var id: String { rawValue }
  var name: String {
    switch self {
    case .practice: "个人推进台"
    case .tasks: "任务"
    case .habits: "习惯"
    case .ideas: "想法暂存"
    case .checklists: "准备清单"
    case .thoughts: "个人思考"
    case .expenses: "花销"
    case .treasury: "国库"
    case .chronicle: "编年史"
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
    case .habits: "repeat"
    case .ideas: "lightbulb"
    case .checklists: "list.bullet.clipboard"
    case .thoughts: "text.quote"
    case .expenses: "creditcard"
    case .treasury: "building.columns"
    case .chronicle: "book.closed"
    case .raw: "tray.and.arrow.down"
    case .monthly: "calendar"
    case .metrics: "waveform.path.ecg"
    case .days: "gift"
    case .notes: "doc.text"
    }
  }
  var department: String {
    switch self {
    case .practice, .tasks, .habits, .ideas, .checklists, .thoughts: "执行部"
    case .expenses, .treasury: "财政部"
    case .chronicle, .raw, .monthly, .metrics, .days: "档案库"
    case .notes: "中科院"
    }
  }
  @MainActor @ViewBuilder var screen: some View {
    switch self {
    case .practice: PracticeScreen()
    case .tasks: TasksScreen()
    case .habits: HabitsScreen()
    case .ideas: JournalScreen(kind: .idea)
    case .checklists: ChecklistsScreen()
    case .thoughts: DocumentsScreen(kind: "thought")
    case .expenses: FinanceScreen()
    case .treasury: TreasuryScreen()
    case .chronicle: JournalScreen(kind: .chronicle)
    case .raw: JournalScreen(kind: .raw)
    case .monthly: DocumentsScreen(kind: "monthly")
    case .metrics: MetricsScreen()
    case .days: DaysScreen()
    case .notes: DocumentsScreen(kind: "note")
    }
  }
}

enum RootTab: String { case today, shortcuts, departments, review, search }

struct RootView: View {
  @Environment(Studio.self) private var studio
  @State private var tab: RootTab = .today
  @State private var todayPath: [Feature] = []
  @State private var shortcutPath: [Feature] = []
  @State private var departmentPath = NavigationPath()
  var body: some View {
    TabView(selection: $tab) {
      Tab("今日", systemImage: "square.grid.2x2.fill", value: RootTab.today) {
        NavigationStack(path: $todayPath) {
          TodayScreen().navigationDestination(for: Feature.self) { $0.screen }
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
      default: todayPath = [feature]
      }
    }
  }
}
