import CouncilCore
import Foundation
import UserNotifications

/// Fill a finite rolling window at 09:00 in the business timezone.
/// Important-day changes and app launches replenish the schedule.
enum Reminders {
  static let prefix = "important-day-"
  static func schedule(_ records: [Record]) async {
    let center = UNUserNotificationCenter.current()
    if await center.notificationSettings().authorizationStatus == .notDetermined {
      _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
    }
    guard [.authorized, .provisional].contains(await center.notificationSettings().authorizationStatus) else { return }
    let calendar = DayRule.solar
    let now = Date()
    let today = calendar.startOfDay(for: now)
    guard let horizon = calendar.date(byAdding: .day, value: 90, to: today) else { return }
    var requests: [UNNotificationRequest] = []
    for record in records where !record.deleted {
      let lead = max(0, Int(record.number("remindDays")))
      for before in lead > 0 ? [0, lead] : [0] {
        guard var cursor = calendar.date(byAdding: .day, value: before, to: today) else { continue }
        // Keep the first notification beyond the window for sparse anniversaries.
        for index in 0..<91 {
          guard let day = DayRule.next(record, from: cursor), day >= cursor,
            let base = calendar.date(byAdding: .day, value: -before, to: day),
            let fire = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: base)
          else { break }
          if index > 0 && base > horizon { break }
          let occurrence = CalendarDays.string(day)
          if fire > now && (before == 0 || record.text("dismissedDate") != occurrence) {
            let content = UNMutableNotificationContent()
            content.title = before == 0 ? "今天是「\(record.title)」" : "「\(record.title)」还有 \(before) 天 · \(occurrence)"
            if record.text("calendar") == "lunar" { content.body = DayRule.lunarText(day) }
            content.sound = .default
            var parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
            parts.timeZone = calendar.timeZone
            let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
            requests.append(UNNotificationRequest(
              identifier: "\(prefix)\(record.id)-\(occurrence)-\(before)", content: content, trigger: trigger))
          }
          if record.text("repeat") == "once" { break }
          guard let following = calendar.date(byAdding: .day, value: 1, to: day) else { break }
          cursor = following
        }
      }
    }
    let pending = await center.pendingNotificationRequests()
    let otherCount = pending.filter { !$0.identifier.hasPrefix(prefix) }.count
    let scheduled = requests.sorted {
      let lhs = fireDate($0), rhs = fireDate($1)
      return lhs == rhs ? $0.identifier < $1.identifier : lhs < rhs
    }.prefix(max(0, 60 - otherCount))
    let desired = Set(scheduled.map(\.identifier))
    let stale = pending.map(\.identifier).filter { $0.hasPrefix(prefix) && !desired.contains($0) }
    center.removePendingNotificationRequests(withIdentifiers: stale)
    for request in scheduled {
      try? await center.add(request)
    }
  }
  private static func fireDate(_ request: UNNotificationRequest) -> Date {
    (request.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate() ?? .distantFuture
  }
}
