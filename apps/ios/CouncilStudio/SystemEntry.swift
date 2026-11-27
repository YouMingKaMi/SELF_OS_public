import AppIntents
import Observation
import UIKit

enum SystemDestination: Identifiable {
  case voiceIdea, newTask, todayTasks, expense, task(UUID), feature(Feature)

  var id: String {
    switch self {
    case .voiceIdea: "voice-idea"
    case .newTask: "new-task"
    case .todayTasks: "today-tasks"
    case .expense: "new-expense"
    case .task(let id): "task-\(id)"
    case .feature(let feature): "feature-\(feature.rawValue)"
    }
  }

  init?(quickAction: String) {
    switch quickAction {
    case "raw-material": self = .feature(.raw)
    case "new-task": self = .newTask
    case "preparation-checklists": self = .feature(.checklists)
    case "new-expense": self = .expense
    default: return nil
    }
  }

  init?(url: URL) {
    guard url.scheme == "selfos" else { return nil }
    switch (url.host, url.path) {
    case ("tasks", ""), ("tasks", "/"): self = .todayTasks
    case ("capture", "/task"): self = .newTask
    case ("capture", "/idea"): self = .voiceIdea
    case ("capture", "/expense"): self = .expense
    case ("task", _):
      guard let id = UUID(uuidString: url.lastPathComponent) else { return nil }
      self = .task(id)
    default: return nil
    }
  }
}

@MainActor @Observable
final class SystemEntry {
  static let shared = SystemEntry()
  var request: SystemDestination?

  @discardableResult
  func open(shortcut: UIApplicationShortcutItem) -> Bool {
    guard let destination = SystemDestination(quickAction: shortcut.type) else { return false }
    request = destination
    return true
  }
}

final class StudioAppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(
      name: nil, sessionRole: connectingSceneSession.role
    )
    if connectingSceneSession.role == .windowApplication {
      if let item = options.shortcutItem { SystemEntry.shared.open(shortcut: item) }
      configuration.delegateClass = StudioSceneDelegate.self
    }
    return configuration
  }
}

final class StudioSceneDelegate: UIResponder, UIWindowSceneDelegate {
  func windowScene(
    _ windowScene: UIWindowScene,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    completionHandler(SystemEntry.shared.open(shortcut: shortcutItem))
  }
}

struct RecordIdeaIntent: AppIntent {
  static let title: LocalizedStringResource = "语音记想法"
  static let description = IntentDescription("打开 SELF OS 并立即开始录音，停止后将文字保存到想法暂存。")

  // This also enables the foreground behavior on iOS 18.
  static let openAppWhenRun = true
  @available(iOS 26.0, *)
  static let supportedModes: IntentModes = .foreground

  @MainActor
  func perform() async throws -> some IntentResult {
    SystemEntry.shared.request = .voiceIdea
    return .result()
  }
}

struct StudioAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: RecordIdeaIntent(),
      phrases: [
        "用\(.applicationName)语音记想法",
        "用\(.applicationName)录下想法",
      ],
      shortTitle: "语音记想法",
      systemImageName: "mic.fill"
    )
  }
}
