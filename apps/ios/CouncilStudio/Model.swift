import CouncilCore
import Observation
import Security
import SwiftUI

/// Live records of one entity type. A screen that reads it re-renders only when that table changes.
@MainActor @Observable final class Feed {
  fileprivate(set) var records: [Record] = []
  fileprivate(set) var revision = 0
}

/// The one object views talk to. Views never touch SQLite or the network.
@MainActor @Observable final class Studio {
  var pending: [PendingOperation] = []
  var syncState: SyncState = .idle
  var error: String?
  private var syncing = false
  private var syncAgain = false
  private var scheduled: Task<Void, Never>?
  @ObservationIgnored private var feeds: [String: Feed] = [:]
  @ObservationIgnored private var observers: [Task<Void, Never>] = []
  let store: CouncilStore
  let coordinator: SyncCoordinator
  var endpoint: String { didSet { UserDefaults.standard.set(endpoint, forKey: "studio-endpoint") } }
  var token: String { didSet { Keychain.save(token) } }

  enum SyncState: Equatable {
    case idle, syncing, synced, offline, unauthorized, unreachable, attention, local
    var label: String {
      switch self {
      case .idle: "准备同步"
      case .syncing: "同步中"
      case .synced: "已同步"
      case .offline: "未联网 · 已存本机"
      case .unauthorized: "需重新连接"
      case .unreachable: "服务不可达 · 已存本机"
      case .attention: "有记录待处理"
      case .local: "仅本机"
      }
    }
    var symbol: String {
      switch self {
      case .synced: "checkmark.circle"
      case .syncing, .idle: "arrow.triangle.2.circlepath"
      case .attention, .unauthorized: "exclamationmark.circle"
      case .local: "iphone"
      default: "icloud.slash"
      }
    }
  }

  init() {
    let folder = URL.applicationSupportDirectory.appendingPathComponent(
      "CouncilStudio", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      // Real data lives in council.sqlite; the synthetic demo has its own file and never mixes in.
      // STUDIO_DEMO=<name> opens its own database (studio-<name>.sqlite), so a new fixture set starts clean.
      let demo = ProcessInfo.processInfo.environment["STUDIO_DEMO"]
      store = try CouncilStore(path: folder.appendingPathComponent(demo.map { "studio-\($0).sqlite" } ?? "council.sqlite").path)
    } catch { fatalError("无法打开本机数据库：\(error.localizedDescription)") }
    coordinator = SyncCoordinator(store: store)
    let env = ProcessInfo.processInfo.environment
    endpoint =
      env["COUNCIL_API_URL"] ?? UserDefaults.standard.string(forKey: "studio-endpoint")
      ?? Studio.defaultEndpoint
    token = env["COUNCIL_DEV_TOKEN"] ?? Keychain.read()
    // One-time move from the local development server to the deployed one; the old shared token is not a device credential.
    if env["COUNCIL_API_URL"] == nil, [":8799", ":8899"].contains(where: endpoint.contains) {
      endpoint = Studio.defaultEndpoint
      token = ""
      // Property observers do not run during init: persist explicitly.
      UserDefaults.standard.set(endpoint, forKey: "studio-endpoint")
      Keychain.save("")
    }
    if env["COUNCIL_DEV_TOKEN"] != nil {
      Keychain.save(token)
      UserDefaults.standard.set(endpoint, forKey: "studio-endpoint")
    }
  }

  // MARK: Reading

  func all(_ type: String) -> [Record] { feed(type).records }
  func feed(_ type: String) -> Feed {
    if let feed = feeds[type] { return feed }
    let feed = Feed()
    feeds[type] = feed
    let updates = store.observe(Query(type))
    observers.append(
      Task { [weak self] in
        do {
          for try await records in updates {
            feed.records = records
            feed.revision += 1
          }
        } catch { self?.error = error.localizedDescription }
      })
    return feed
  }
  /// Changes whenever any of the named tables changes: a `.task(id:)` key for derived work.
  func revision(_ types: String...) -> String {
    types.map { String(feed($0).revision) }.joined(separator: ".")
  }
  func record(_ id: String?, in type: String) -> Record? {
    guard let id, !id.isEmpty else { return nil }
    return all(type).first { $0.id == id }
  }
  var habitRecords: [Record] { all("habit") + all("habitRule") + all("habitLog") }

  func bootstrap() async {
    do {
      if ProcessInfo.processInfo.environment["STUDIO_DEMO"] != nil,
        try await store.metadata("demo-seeded") == nil
      {
        if let url = Bundle.main.url(forResource: "demo-fixtures", withExtension: "json") {
          let fixtures = try JSONDecoder().decode([Record].self, from: Data(contentsOf: url))
          try await store.apply(fixtures, cursor: "0")
        }
        try await store.metadata("demo-seeded", value: "true")
      }
    } catch { self.error = error.localizedDescription }
    for type in ["task", "habit", "habitRule", "habitLog", "session", "domain", "journal", "expense"] {
      let feed = feed(type)
      if feed.revision == 0, let rows = try? await store.records(type: type) { feed.records = rows }
    }
    let operations = store.observeOperations()
    observers.append(
      Task { [weak self] in
        do { for try await rows in operations { self?.pending = rows } } catch {}
      })
  }

  // MARK: Sync

  var canSync: Bool {
    !token.isEmpty && URL(string: endpoint).map { ["http", "https"].contains($0.scheme ?? "") }
      == true
  }
  func sync() async {
    guard canSync, let url = URL(string: endpoint) else {
      syncState = .local
      return
    }
    if syncing {
      syncAgain = true
      return
    }
    syncing = true
    defer { syncing = false }
    repeat {
      syncAgain = false
      syncState = .syncing
      do {
        try await coordinator.synchronize(baseURL: url, token: token)
        let stuck = (try? await store.operations())?.contains {
          ["conflict", "error"].contains($0.state)
        }
        syncState = stuck == true ? .attention : .synced
      } catch {
        if case SyncCoordinator.SyncError.response(let code) = error, [401, 403].contains(code) {
          syncState = .unauthorized
        } else if let e = error as? URLError, e.code == .notConnectedToInternet {
          syncState = .offline
        } else {
          syncState = .unreachable
        }
        return
      }
    } while syncAgain && !Task.isCancelled
  }
  /// Re-plan important-day notifications from the stored records.
  func scheduleReminders() async {
    let days = (try? await store.records(type: "importantDay")) ?? all("importantDay")
    await Reminders.schedule(days)
  }

  // MARK: Market data — live quotes, the last good answer kept on the phone for offline use.

  var quotes: [String: Quote] = (try? JSONDecoder().decode(
    [String: Quote].self, from: UserDefaults.standard.data(forKey: "studio-quotes") ?? Data())) ?? [:]
  var quotesLive = false
  func refreshQuotes() async {
    // Read from the store: the observed feed may not have loaded yet on first open.
    let assets = (try? await store.records(type: "asset")) ?? all("asset")
    let ids = Set(assets.filter { !$0.deleted }.map { $0.text("quoteId") }.filter { !$0.isEmpty })
    guard canSync, let url = URL(string: endpoint), !ids.isEmpty else { return }
    do {
      let fresh = try await SyncCoordinator.quotes(baseURL: url, token: token, ids: Array(ids))
      quotes.merge(fresh) { $1 }
      quotesLive = true
      if let data = try? JSONEncoder().encode(quotes) { UserDefaults.standard.set(data, forKey: "studio-quotes") }
    } catch { quotesLive = false }
  }
  /// Fetch live quotes and keep one price observation per quoted asset, so the history chart moves with the market.
  func recordPrices() async -> Int {
    await refreshQuotes()
    guard quotesLive else { return 0 }
    let at = ISO8601DateFormatter().string(from: Date())
    var count = 0
    for asset in all("asset") where !asset.deleted {
      guard let q = quotes[asset.text("quoteId")], Decimal(string: q.priceCNY) != nil else { continue }
      if await save("assetPrice", ["assetId": .string(asset.id), "at": .string(at), "price": .string(q.priceCNY)]) != nil {
        count += 1
      }
    }
    return count
  }
  func searchQuotes(_ query: String, kind: String) async throws -> [QuoteMatch] {
    guard canSync, let url = URL(string: endpoint) else { throw SyncCoordinator.SyncError.invalidURL }
    return try await SyncCoordinator.searchQuotes(baseURL: url, token: token, query: query, kind: kind)
  }
  /// assetId → live CNY price.
  var livePrices: [String: Decimal] {
    var result: [String: Decimal] = [:]
    for asset in all("asset") {
      if let q = quotes[asset.text("quoteId")], let p = Decimal(string: q.priceCNY) { result[asset.id] = p }
    }
    return result
  }
  func treasuryReport(wallets: [Record]? = nil, assets: [Record]? = nil, entries: [Record]? = nil) -> TreasuryReport {
    TreasuryRules.report(
      wallets: wallets ?? all("wallet"), assets: assets ?? all("asset"), entries: entries ?? all("walletEntry"),
      prices: all("assetPrice"), live: livePrices, now: Date())
  }

  /// Injected at build time (`COUNCIL_ENDPOINT=https://…` on the xcodebuild command line, via Info.plist);
  /// the server address is never committed. Empty means: type it in Settings.
  static let defaultEndpoint = (Bundle.main.object(forInfoDictionaryKey: "CouncilEndpoint") as? String) ?? ""

  /// Pair with a one-time code shown on the server. Returns a message on failure.
  func pair(code: String) async -> String? {
    guard let url = URL(string: endpoint) else { return "服务地址不正确" }
    do {
      token = try await SyncCoordinator.pair(baseURL: url, code: code)
      await sync()
      return nil
    } catch SyncCoordinator.SyncError.response(let code) {
      return code == 429 ? "尝试太频繁，请稍后再试" : "连接码无效或已过期"
    } catch {
      return "连不上服务器，请检查网络"
    }
  }
  /// Disconnect this phone. Local records stay; unsent edits wait for the next pairing.
  func unpair() async {
    if let url = URL(string: endpoint), !token.isEmpty {
      try? await SyncCoordinator.revoke(baseURL: url, token: token)
    }
    token = ""
    syncState = .local
  }

  /// While the app is in the foreground, keep a hint stream open; reconnect with backoff and jitter.
  func listen() async {
    var failures = 0
    while !Task.isCancelled {
      guard canSync, let url = URL(string: endpoint), syncState != .unauthorized else {
        try? await Task.sleep(for: .seconds(5))
        continue
      }
      do {
        for try await _ in SyncCoordinator.hints(baseURL: url, token: token) {
          failures = 0
          requestSync()
        }
      } catch SyncCoordinator.SyncError.response(let code) where [401, 403].contains(code) {
        syncState = .unauthorized
      } catch {}
      failures += 1
      let ceiling = min(60.0, pow(2, Double(min(failures, 6))))
      try? await Task.sleep(for: .seconds(ceiling / 2 + Double.random(in: 0...(ceiling / 2))))
    }
  }

  private func requestSync() {
    guard scheduled == nil else { return }
    scheduled = Task {
      try? await Task.sleep(for: .milliseconds(300))
      scheduled = nil
      await sync()
    }
  }

  // MARK: Writing — one row and one outbox entry each; observing screens update themselves.

  @discardableResult
  func save(_ type: String, _ data: [String: JSONValue], id: String? = nil) async -> String? {
    error = nil
    do {
      let daily = ["habitLog": "habitId", "metricLog": "metricId", "checklistRun": "checklistId"]
      let stable = daily[type].flatMap { data[$0]?.text }.map {
        StableID.forKey(type + ":" + $0 + ":" + (data["day"]?.text ?? ""))
      }
      let saved = try await store.put(
        type: type, data: data, id: id ?? stable ?? UUID().uuidString.lowercased())
      requestSync()
      return saved
    } catch {
      self.error = error.localizedDescription
      return nil
    }
  }
  func update(_ record: Record, _ fields: [String: JSONValue]) async {
    var data = record.data
    for (key, value) in fields {
      if value == .null { data.removeValue(forKey: key) } else { data[key] = value }
    }
    await save(record.type, data, id: record.id)
  }
  func remove(_ record: Record) async {
    error = nil
    do {
      try await store.remove(record)
      requestSync()
    } catch { self.error = error.localizedDescription }
  }
  func task(_ record: Record?, _ action: String, title: String? = nil, schedule: Schedule? = nil)
    async
  {
    var latest = record
    if let record, let shown = try? await store.record(type: "task", id: record.id) {
      latest = shown
    }
    await save(
      "task",
      TaskRules.apply(
        action, to: latest, title: title, schedule: schedule,
        now: ISO8601DateFormatter().string(from: Date())),
      id: record?.id)
  }
  func undo(_ op: PendingOperation) async {
    do { try await store.undo(op.id) } catch { self.error = error.localizedDescription }
  }
  func resolve(_ op: PendingOperation, keep: Bool) async {
    do {
      try await store.settle(op.entityId, keepLocal: keep)
      requestSync()
    } catch { self.error = error.localizedDescription }
  }
  func title(of op: PendingOperation) -> String {
    let data = (try? JSONDecoder().decode(Command.self, from: op.data))?.data ?? [:]
    let text = data["title"]?.text ?? data["name"]?.text ?? data["body"]?.text ?? ""
    return text.isEmpty ? "一条本机修改" : text
  }

  // MARK: Practice sessions

  var runningSession: Record? {
    all("session").first { ["running", "paused"].contains($0.text("status")) }
  }
  func start(domain: Record, activity: Record? = nil, problem: Record? = nil, solution: Record? = nil)
    async
  {
    guard runningSession == nil else {
      error = "已有一段推进正在计时，请先结束或取消。"
      return
    }
    let now = ISO8601DateFormatter().string(from: Date())
    var data: [String: JSONValue] = [
      "domainId": .string(domain.id),
      "title": .string(solution?.title ?? problem?.title ?? activity?.title ?? domain.title),
      "day": .string(BusinessDate.day()), "startedAt": .string(now), "runningSince": .string(now),
      "elapsedSeconds": .number(0), "status": .string("running"), "manual": .bool(false),
      "segments": .array([]),
    ]
    if let activity { data["activityId"] = .string(activity.id) }
    if let problem { data["problemId"] = .string(problem.id) }
    if let solution { data["solutionId"] = .string(solution.id) }
    await save("session", data)
  }
  /// pause · resume · finish · cancel. Elapsed time is folded into segments, never ticked into storage.
  func control(_ session: Record, _ action: String) async {
    var data = session.data
    let now = ISO8601DateFormatter().string(from: Date())
    if session.text("status") == "running" {
      data["elapsedSeconds"] = .number(Clock.elapsed(session))
      if !session.text("runningSince").isEmpty {
        data["segments"] = .array(
          (session.data["segments"]?.strings ?? []).map(JSONValue.string) + [
            .string(session.text("runningSince") + "/" + now)
          ])
      }
    }
    data.removeValue(forKey: "runningSince")
    data["status"] = .string(
      ["pause": "paused", "resume": "running", "cancel": "cancelled"][action] ?? "finished")
    if action == "resume" { data["runningSince"] = .string(now) }
    if ["finish", "cancel"].contains(action) { data["endedAt"] = .string(now) }
    await save("session", data, id: session.id)
  }
}

enum Clock {
  static func parse(_ text: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: text) ?? ISO8601DateFormatter().date(from: text)
  }
  static func elapsed(_ session: Record, _ now: Date = Date()) -> Double {
    if session.text("status") == "cancelled" { return 0 }
    let saved = session.number("elapsedSeconds")
    if session.text("status") == "running", let since = parse(session.text("runningSince")) {
      return saved + max(0, now.timeIntervalSince(since))
    }
    return saved
  }
  static func digits(_ seconds: Double) -> String {
    let n = Int(max(0, seconds))
    return n >= 3600
      ? String(format: "%d:%02d:%02d", n / 3600, n / 60 % 60, n % 60)
      : String(format: "%02d:%02d", n / 60, n % 60)
  }
  /// 3h 05m reads better than a stopwatch for totals.
  static func span(_ seconds: Double) -> String {
    let m = Int((seconds / 60).rounded())
    return m < 60 ? "\(m)m" : "\(m / 60)h \(String(format: "%02d", m % 60))m"
  }
}

/// Important-day occurrence rules: lunar dates resolve through the Chinese calendar.
enum DayRule {
  static var solar: Calendar {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "Asia/Shanghai")!
    return c
  }
  static var lunar: Calendar {
    var c = Calendar(identifier: .chinese)
    c.timeZone = solar.timeZone
    return c
  }
  static func date(_ record: Record) -> Date? {
    if record.text("calendar") == "lunar" {
      guard
        let middle = solar.date(
          from: DateComponents(year: Int(record.number("lunarYear")), month: 7, day: 1))
      else { return nil }
      var parts = lunar.dateComponents([.era, .year], from: middle)
      parts.month = Int(record.number("lunarMonth"))
      parts.day = Int(record.number("lunarDay"))
      parts.isLeapMonth = record.flag("leap")
      return lunar.date(from: parts)
    }
    return CalendarDays.date(record.text("date"))
  }
  static func next(_ record: Record) -> Date? {
    guard let initial = date(record) else { return nil }
    if record.text("repeat") == "once" { return initial }
    let today = solar.startOfDay(for: Date())
    let calendar = record.text("calendar") == "lunar" ? lunar : solar
    let unit =
      ["weekly": "week", "monthly": "month", "yearly": "year"][record.text("repeat")]
      ?? record.text("intervalUnit")
    let component: Calendar.Component =
      unit == "year" ? .year : unit == "month" ? .month : unit == "week" ? .weekOfYear : .day
    let step = record.text("repeat") == "custom" ? max(1, Int(record.number("interval"))) : 1
    for index in 0..<10000 {
      guard let candidate = calendar.date(byAdding: component, value: index * step, to: initial)
      else { return nil }
      if candidate >= today { return candidate }
    }
    return nil
  }
  static func daysUntil(_ record: Record) -> Int? {
    guard let date = next(record) else { return nil }
    return solar.dateComponents([.day], from: solar.startOfDay(for: Date()), to: date).day
  }
  static func lunarText(_ date: Date) -> String {
    let parts = lunar.dateComponents([.month, .day], from: date)
    let months = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"]
    let tens = ["初", "十", "廿", "三"]
    let ones = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"]
    let d = parts.day ?? 1
    let day = d == 10 ? "初十" : d == 20 ? "二十" : d == 30 ? "三十" : tens[d / 10] + ones[d % 10]
    return "农历" + (parts.isLeapMonth == true ? "闰" : "") + months[((parts.month ?? 1) - 1) % 12] + "月" + day
  }
}

enum Day {
  static func shift(_ day: String, _ by: Int) -> String {
    guard let date = CalendarDays.date(day),
      let next = CalendarDays.calendar.date(byAdding: .day, value: by, to: date)
    else { return day }
    return CalendarDays.string(next)
  }
  static func shiftMonth(_ month: String, _ by: Int) -> String {
    guard let date = CalendarDays.date(month + "-01"),
      let next = CalendarDays.calendar.date(byAdding: .month, value: by, to: date)
    else { return month }
    return String(CalendarDays.string(next).prefix(7))
  }
  static func weekday(_ day: String) -> String {
    guard let date = CalendarDays.date(day) else { return "" }
    return "日一二三四五六".map(String.init)[CalendarDays.calendar.component(.weekday, from: date) - 1]
  }
  static func short(_ day: String) -> String {
    guard day.count >= 10 else { return day }
    return "\(Int(day.dropFirst(5).prefix(2)) ?? 0)月\(Int(day.suffix(2)) ?? 0)日"
  }
  static func monthTitle(_ month: String) -> String {
    "\(month.prefix(4))年\(Int(month.suffix(2)) ?? 0)月"
  }
  static var today: String { BusinessDate.day() }
}

enum Money {
  /// "12345" minor units → "¥123.45". Exact; never via Double.
  static func format(_ minor: String) -> String {
    guard let value = FinanceRules.minor(minor) else { return "—" }
    return format(value)
  }
  static func format(_ minor: Decimal) -> String {
    let negative = minor < 0
    let cents = NSDecimalNumber(decimal: FinanceRules.rounded(negative ? -minor : minor)).int64Value
    let yuan = cents / 100
    let grouped = NumberFormatter.localizedString(from: NSNumber(value: yuan), number: .decimal)
    return (negative ? "−" : "") + "¥" + grouped + "." + String(format: "%02d", cents % 100)
  }
  /// "12.5" → "1250". Nil for anything that is not a plain amount.
  static func minor(_ text: String) -> String? {
    let value = text.trimmingCharacters(in: .whitespaces)
    guard value.range(of: #"^-?[0-9]+(\.[0-9]{1,2})?$"#, options: .regularExpression) != nil,
      let d = Decimal(string: value, locale: Locale(identifier: "en_US_POSIX"))
    else { return nil }
    return FinanceRules.string(d * 100)
  }
  static func yuan(_ minor: String) -> String {
    guard let v = FinanceRules.minor(minor) else { return "" }
    return NSDecimalNumber(decimal: v / 100).stringValue
  }
}

enum Keychain {
  static var query: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "org.personalcouncil.next.studio",
      kSecAttrAccount as String: "device-token",
    ]
  }
  static func read() -> String {
    var q = query
    q[kSecReturnData as String] = true
    var result: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data
    else { return "" }
    return String(data: data, encoding: .utf8) ?? ""
  }
  static func save(_ value: String) {
    SecItemDelete(query as CFDictionary)
    guard !value.isEmpty else { return }
    var q = query
    q[kSecValueData as String] = Data(value.utf8)
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(q as CFDictionary, nil)
  }
}
