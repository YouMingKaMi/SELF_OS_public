import CouncilCore
import Foundation
import UserNotifications

/// Local notifications for important days: one N days before (their own remindDays) and one on the day, at 09:00.
/// Recomputed from scratch whenever important days change or the app opens; nothing is sent to the server.
enum Reminders {
  static let prefix = "important-day-"
  static func schedule(_ records: [Record]) async {
    let center = UNUserNotificationCenter.current()
    if await center.notificationSettings().authorizationStatus == .notDetermined {
      _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
    }
    guard [.authorized, .provisional].contains(await center.notificationSettings().authorizationStatus) else { return }
    let pending = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefix) }
    center.removePendingNotificationRequests(withIdentifiers: pending)
    let calendar = DayRule.solar
    let now = Date()
    var requests: [UNNotificationRequest] = []
    for record in records where !record.deleted {
      guard let day = DayRule.next(record) else { continue }
      let lead = max(0, Int(record.number("remindDays")))
      let dateText = day.formatted(.dateTime.month().day().locale(Locale(identifier: "zh_CN")))
      var moments: [(Int, String)] = [(0, "今天是「\(record.title)」")]
      if lead > 0 { moments.append((lead, "「\(record.title)」还有 \(lead) 天 · \(dateText)")) }
      for (before, title) in moments {
        guard let base = calendar.date(byAdding: .day, value: -before, to: day),
          let fire = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: base), fire > now
        else { continue }
        let content = UNMutableNotificationContent()
        content.title = title
        if record.text("calendar") == "lunar" { content.body = DayRule.lunarText(day) }
        content.sound = .default
        let parts = calendar.dateComponents(in: calendar.timeZone, from: fire)
        let trigger = UNCalendarNotificationTrigger(
          dateMatching: DateComponents(year: parts.year, month: parts.month, day: parts.day, hour: 9, minute: 0),
          repeats: false)
        requests.append(UNNotificationRequest(identifier: "\(prefix)\(record.id)-\(before)", content: content, trigger: trigger))
      }
    }
    // iOS keeps at most 64 pending notifications; the soonest matter most.
    for request in requests.sorted(by: { fireDate($0) < fireDate($1) }).prefix(60) {
      try? await center.add(request)
    }
  }
  private static func fireDate(_ request: UNNotificationRequest) -> Date {
    (request.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate() ?? .distantFuture
  }
}
