import AppIntents
import CouncilCore
import Foundation
import Security
import WidgetKit

struct WidgetTaskRow: Identifiable, Codable, Equatable, Sendable {
  let id: String
  let title: String
  let detail: String
  let blocked: Bool
}

struct WidgetTaskDay: Codable, Equatable, Sendable {
  let day: String
  let count: Int
  let rows: [WidgetTaskRow]
}

enum WidgetTasks {
  static let kind = "CouncilTodayTasks"

  // Shared only with our widget target. The database and the sync credential remain app-private.
  private static func keychain(service: String, account: String? = nil) -> [String: Any]? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "CouncilWidgetAccessGroup") as? String,
      !group.isEmpty else { return nil }
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "org.personalcouncil.next.studio.widget.tasks." + service,
      kSecAttrAccessGroup as String: group,
    ]
    query[kSecAttrAccount as String] = account
    return query
  }

  static func read() -> [WidgetTaskDay] {
    guard var query = keychain(service: "projection", account: "today") else { return [] }
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data else { return [] }
    return (try? JSONDecoder().decode([WidgetTaskDay].self, from: data)) ?? []
  }

  static func queuedCompletions() -> [String: Date] {
    guard var query = keychain(service: "completion") else { return [:] }
    query[kSecReturnAttributes as String] = true
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitAll
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let items = item as? [[String: Any]] else { return [:] }
    var result: [String: Date] = [:]
    for item in items {
      guard let id = item[kSecAttrAccount as String] as? String,
        let bytes = item[kSecValueData as String] as? Data,
        let date = try? JSONDecoder().decode(Date.self, from: bytes)
      else { continue }
      result[id] = date
    }
    return result
  }

  #if COUNCIL_WIDGET
  static func queueCompletion(_ id: String, now: Date = Date()) throws {
    // An extension action may only queue records from the current, open task projection.
    let day = CalendarDays.string(now)
    guard UUID(uuidString: id) != nil,
      read().first(where: { $0.day == day })?.rows.contains(where: { $0.id == id && !$0.blocked }) == true,
      var item = keychain(service: "completion", account: id)
    else { throw WidgetTaskActionError.openApp }
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    item[kSecValueData as String] = try JSONEncoder().encode(now)
    let result = SecItemAdd(item as CFDictionary, nil)
    guard result == errSecSuccess || result == errSecDuplicateItem else {
      throw WidgetTaskActionError.openApp
    }
  }
  #else
  static func clearCompletion(_ id: String) {
    guard let query = keychain(service: "completion", account: id) else { return }
    SecItemDelete(query as CFDictionary)
  }

  static func publish(_ tasks: [Record], now: Date = Date()) {
    guard ProcessInfo.processInfo.environment["STUDIO_DEMO"] == nil else { return }
    guard let query = keychain(service: "projection", account: "today") else { return }
    let calendar = CalendarDays.calendar
    let days = [now, calendar.date(byAdding: .day, value: 1, to: now) ?? now]
    let byID = Dictionary(uniqueKeysWithValues: tasks.map { ($0.id, $0) })
    let snapshot = days.map { date in
      let day = CalendarDays.string(date)
      let due = tasks.filter { TaskRules.belongsToday($0, day: day) }
      let rows = due.map { task in
        let plan = TaskRules.schedule(task)
        let time = task.text("scheduleTime")
        let blocked = !TaskRules.blockers(task, byID: byID).isEmpty
        let shortDate: (String) -> String = { String($0.suffix(5)).replacingOccurrences(of: "-", with: "/") }
        let scheduleDetail: String
        let priority: Int
        switch plan.kind {
        case "deadline":
          let d = plan.date ?? day
          if d < day {
            priority = 0
            scheduleDetail = time.isEmpty ? "已逾期" : "逾期 · \(time)"
          } else if d == day {
            priority = 1
            scheduleDetail = time.isEmpty ? "今天截止" : time
          } else {
            priority = 2
            scheduleDetail = "截止 \(shortDate(d))"
          }
        case "day":
          priority = 1
          scheduleDetail = time
        case "range":
          priority = 2
          scheduleDetail = plan.end.map { "至 \(shortDate($0))" } ?? ""
        case "recent":
          priority = 3
          scheduleDetail = "近期"
        default:
          priority = 4
          scheduleDetail = time
        }
        return (WidgetTaskRow(
          id: task.id, title: String(decoding: task.title.utf16.prefix(72), as: UTF16.self),
          detail: blocked ? "等前置" : scheduleDetail, blocked: blocked
        ), priority, plan.date ?? plan.end ?? "9999-12-31", time.isEmpty ? "24:00" : time)
      }.sorted {
        if $0.0.blocked != $1.0.blocked { return !$0.0.blocked }
        return ($0.1, $0.2, $0.3, $0.0.id) < ($1.1, $1.2, $1.3, $1.0.id)
      }
        .prefix(4).map { $0.0 }
      return WidgetTaskDay(day: day, count: due.count, rows: rows)
    }
    guard read() != snapshot, let data = try? JSONEncoder().encode(snapshot) else { return }
    let update = [kSecValueData as String: data]
    let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
    if status == errSecItemNotFound {
      var item = query.merging(update) { _, new in new }
      item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { return }
    } else if status != errSecSuccess {
      return
    }
    WidgetCenter.shared.reloadTimelines(ofKind: kind)
  }
  #endif
}

struct CompleteWidgetTaskIntent: AppIntent {
  static let title: LocalizedStringResource = "完成今日任务"
  static let isDiscoverable = false
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

  @available(iOS 26, *)
  static var supportedModes: IntentModes { [.background, .foreground(.dynamic)] }
  @available(iOS 27, *)
  static var allowedExecutionTargets: IntentExecutionTargets { .main }

  @Parameter(title: "任务")
  var taskID: String

  init() {}
  init(taskID: String) { self.taskID = taskID }

  @MainActor
  func perform() async throws -> some IntentResult {
    #if COUNCIL_WIDGET
    try WidgetTasks.queueCompletion(taskID)
    #else
    try await Studio.shared.completeWidgetTask(taskID)
    #endif
    return .result()
  }

}

#if !COUNCIL_WIDGET
// Lets WidgetKit route the action into the app process on releases before execution targets.
extension CompleteWidgetTaskIntent: ForegroundContinuableIntent {}
#endif

enum WidgetTaskActionError: LocalizedError {
  case openApp

  var errorDescription: String? { "请在 SELF OS 中完成这项任务。" }
}
