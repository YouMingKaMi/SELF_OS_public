import CouncilCore
import Observation
import Security
import SwiftUI
import WidgetKit

/// Live records of one entity type. A screen that reads it re-renders only when that table changes.
@MainActor @Observable final class Feed {
  fileprivate(set) var records: [Record] = []
  fileprivate(set) var revision = 0
}

/// The one object views talk to. Views never touch SQLite or the network.
@MainActor @Observable final class Studio {
  static let shared = Studio()
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
  private let demoMode: Bool
  var endpoint: String { didSet { if !demoMode { UserDefaults.standard.set(endpoint, forKey: "studio-endpoint") } } }
  var token: String { didSet { if !demoMode { Keychain.save(token) } } }

  enum SyncState: Equatable {
    case idle, syncing, synced, offline, unauthorized, unreachable, attention, upgradeRequired, local
    var label: String {
      switch self {
      case .idle: "准备同步"
      case .syncing: "同步中"
      case .synced: "已同步"
      case .offline: "未联网 · 已存本机"
      case .unauthorized: "需重新连接"
      case .unreachable: "服务不可达 · 已存本机"
      case .attention: "有记录待处理"
      case .upgradeRequired: "请更新 App 后继续同步"
      case .local: "仅本机"
      }
    }
    var symbol: String {
      switch self {
      case .synced: "checkmark.circle"
      case .syncing, .idle: "arrow.triangle.2.circlepath"
      case .attention, .unauthorized, .upgradeRequired: "exclamationmark.circle"
      case .local: "iphone"
      default: "icloud.slash"
      }
    }
  }

  init() {
    let env = ProcessInfo.processInfo.environment
    let demo = env["STUDIO_DEMO"]
    demoMode = demo != nil
    let folder = URL.applicationSupportDirectory.appendingPathComponent(
      "CouncilStudio", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      // Real data lives in council.sqlite; the synthetic demo has its own file and never mixes in.
      // STUDIO_DEMO=<name> opens its own database (studio-<name>.sqlite), so a new fixture set starts clean.
      store = try CouncilStore(path: folder.appendingPathComponent(demo.map { "studio-\($0).sqlite" } ?? "council.sqlite").path)
    } catch { fatalError("无法打开本机数据库：\(error.localizedDescription)") }
    coordinator = SyncCoordinator(store: store)
    if demoMode {
      endpoint = env["COUNCIL_API_URL"] ?? ""
      token = env["COUNCIL_DEV_TOKEN"] ?? ""
      return
    }
    endpoint = env["COUNCIL_API_URL"] ?? UserDefaults.standard.string(forKey: "studio-endpoint") ?? Studio.defaultEndpoint
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
            if type == "task" { WidgetTasks.publish(records) }
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
    for type in ["workspaceConfig", "task", "achievement", "habit", "habitRule", "habitLog", "session", "domain", "journal", "expense"] {
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
        } else if case CouncilStore.StoreError.unknownType = error {
          syncState = .upgradeRequired
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
  private var returnedQuotes: [String: Quote] = [:]
  func quoteStatus(_ id: String) -> String? {
    guard !id.isEmpty else { return nil }
    guard quotes[id] != nil else { return "缺报价" }
    let time = ISO8601DateFormatter()
    time.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let quote = returnedQuotes[id], let at = time.date(from: quote.at),
      Date().timeIntervalSince(at) <= 300 else { return "最近报价" }
    return quote.timeSource == "market" ? "市场报价" : "最近获取"
  }
  @discardableResult
  func refreshQuotes() async -> [String: Quote] {
    // Read from the store: the observed feed may not have loaded yet on first open.
    let assets = (try? await store.records(type: "asset")) ?? all("asset")
    let ids = Set(assets.filter { !$0.deleted }.map { $0.text("quoteId") }.filter { !$0.isEmpty })
    guard canSync, let url = URL(string: endpoint), !ids.isEmpty else { returnedQuotes = [:]; return [:] }
    let fresh = (try? await SyncCoordinator.quotes(baseURL: url, token: token, ids: Array(ids))) ?? [:]
    returnedQuotes = fresh
    quotes.merge(fresh) { $1 }
    if let data = try? JSONEncoder().encode(quotes) { UserDefaults.standard.set(data, forKey: "studio-quotes") }
    return fresh
  }
  /// Fetch live quotes and keep one price observation per quoted asset, so the history chart moves with the market.
  func recordPrices() async -> Int {
    let fresh = await refreshQuotes()
    var count = 0
    for asset in all("asset") where !asset.deleted {
      guard let q = fresh[asset.text("quoteId")], Decimal(string: q.priceCNY) != nil else { continue }
      let key = StableID.forKey("assetPrice:" + asset.id + ":" + q.at)
      if await save("assetPrice", ["assetId": .string(asset.id), "at": .string(q.at), "price": .string(q.priceCNY)], id: key) != nil {
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
  func save(
    _ type: String, _ data: [String: JSONValue], id: String? = nil, editBase: Record? = nil
  ) async -> String? {
    error = nil
    do {
      let daily = ["habitLog": "habitId", "metricLog": "metricId", "checklistRun": "checklistId"]
      let stable = daily[type].flatMap { data[$0]?.text }.map {
        StableID.forKey(type + ":" + $0 + ":" + (data["day"]?.text ?? ""))
      }
      let saved = try await store.put(
        type: type, data: data, id: id ?? stable ?? UUID().uuidString.lowercased(), editBase: editBase)
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
  func saveTogether(_ writes: [BatchPut]) async -> Bool {
    error = nil
    do {
      try await store.putTogether(writes)
      requestSync()
      return true
    } catch {
      self.error = error.localizedDescription
      return false
    }
  }
  func removeTogether(_ records: [Record]) async -> Bool {
    error = nil
    do {
      if records.count == 1 { try await store.remove(records[0]) }
      else { try await store.removeTogether(records) }
      requestSync()
      return true
    } catch {
      self.error = error.localizedDescription
      return false
    }
  }
  func remove(_ record: Record) async {
    error = nil
    do {
      try await store.remove(record)
      requestSync()
    } catch { self.error = error.localizedDescription }
  }
  enum JournalTransferFailure: Error {
    case changed(String)
    case invalid(String)
    var message: String {
      switch self {
      case .changed(let text), .invalid(let text): return text
      }
    }
  }
  func transferJournalText(_ source: Record, selection: Range<Int>? = nil) async -> Result<String, JournalTransferFailure> {
    error = nil
    do {
      let id = try await store.transferJournalText(source, selection: selection)
      requestSync()
      return .success(id)
    } catch CouncilStore.StoreError.editChanged {
      return .failure(.changed("另一台设备刚修改了这条原文，请先载入最新内容再重新选段。"))
    } catch CouncilStore.StoreError.transferTooLong {
      return .failure(.invalid("选段超过想法暂存单条长度上限（100,000 字符），请缩小选区后再移动。"))
    } catch CouncilStore.StoreError.invalidTransfer {
      return .failure(.invalid("选中的正文范围无效，或当前记录已被移除，请重新选择非空文字。"))
    } catch {
      return .failure(.invalid(error.localizedDescription))
    }
  }
  @discardableResult
  func task(
    _ record: Record?, _ action: String, title: String? = nil, schedule: Schedule? = nil,
    fields: [String: JSONValue] = [:]
  ) async -> Bool {
    if action == "complete", let record, title == nil, schedule == nil, fields.isEmpty {
      error = nil
      do {
        try await store.completeTask(id: record.id)
        requestSync()
        return true
      } catch {
        self.error = error.localizedDescription
        return false
      }
    }
    var latest = record
    if let record, let shown = try? await store.record(type: "task", id: record.id) {
      latest = shown
    }
    if action == "complete", let latest {
      if latest.text("status") == "discarded" {
        error = "请先恢复待办。"
        return false
      }
      for id in TaskRules.prerequisites(latest) {
        guard let item = try? await store.record(type: "task", id: id),
          !item.deleted, item.text("status") == "completed" else {
          error = "请先完成前置任务。"
          return false
        }
      }
    }
    var data = TaskRules.apply(
      action, to: latest, title: title, schedule: schedule,
      now: ISO8601DateFormatter().string(from: Date()))
    data.merge(fields) { _, new in new }
    return await save("task", data, id: record?.id) != nil
  }

  func completeWidgetTask(_ id: String) async throws {
    guard ProcessInfo.processInfo.environment["STUDIO_DEMO"] == nil else {
      throw WidgetTaskActionError.openApp
    }
    guard UUID(uuidString: id) != nil else { throw CouncilStore.StoreError.missingTask }
    try await store.completeTask(id: id)
    WidgetTasks.clearCompletion(id)
    WidgetTasks.publish(try await store.records(type: "task"))
    await sync()
  }

  func applyWidgetCompletions() async {
    guard ProcessInfo.processInfo.environment["STUDIO_DEMO"] == nil else { return }
    let requests = WidgetTasks.queuedCompletions()
    guard !requests.isEmpty else { return }
    for (id, date) in requests.sorted(by: { ($0.value, $0.key) < ($1.value, $1.key) }) {
      do {
        try await store.completeTask(id: id, at: date)
        WidgetTasks.clearCompletion(id)
      } catch let error as CouncilStore.StoreError {
        // The current database rules win over the projection used by the widget.
        WidgetTasks.clearCompletion(id)
        self.error = error.localizedDescription
      } catch {
        // A temporary database failure leaves the request queued for the next activation.
        self.error = error.localizedDescription
      }
    }
    if let tasks = try? await store.records(type: "task") { WidgetTasks.publish(tasks) }
    WidgetCenter.shared.reloadTimelines(ofKind: WidgetTasks.kind)
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
    if op.recoveryDraft?.deleted == true { return "删除记录" }
    let data = op.recoveryDraft?.data ?? (try? JSONDecoder().decode(Command.self, from: op.data))?.data ?? [:]
    let text = data["title"]?.text ?? data["name"]?.text ?? data["body"]?.text ?? ""
    return text.isEmpty ? "一条本机修改" : text
  }

  // MARK: Practice sessions

  var runningSession: Record? {
    all("session").first { ["running", "paused"].contains($0.text("status")) }
  }
  func start(domain: Record, activity: Record? = nil, problem: Record? = nil, solution: Record? = nil, event: Record? = nil)
    async
  {
    guard runningSession == nil else {
      error = "已有一段推进正在计时，请先结束或取消。"
      return
    }
    let now = ISO8601DateFormatter().string(from: Date())
    var data: [String: JSONValue] = [
      "domainId": .string(domain.id),
      "title": .string(String(decoding: (event?.title ?? solution?.title ?? problem?.title ?? activity?.title ?? domain.title).utf16.prefix(500), as: UTF16.self)),
      "day": .string(BusinessDate.day()), "startedAt": .string(now), "runningSince": .string(now),
      "elapsedSeconds": .number(0), "status": .string("running"), "manual": .bool(false),
      "segments": .array([]),
    ]
    if let event { data["eventId"] = .string(event.id) }
    if let activity { data["activityId"] = .string(activity.id) }
    if let problem { data["problemId"] = .string(problem.id) }
    if let solution { data["solutionId"] = .string(solution.id) }
    await save("session", data)
  }
  /// pause · resume · finish · cancel. Elapsed time is folded into segments, never ticked into storage.
  func control(_ session: Record, _ action: String) async {
    var data = session.data
    let instant = Date(timeIntervalSince1970: floor(Date().timeIntervalSince1970))
    let now = ISO8601DateFormatter().string(from: instant)
    if session.text("status") == "running" {
      data["elapsedSeconds"] = .number(Clock.elapsed(session, instant))
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
    TimeMath.elapsed(session, now: now)
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
      return lunarDate(
        year: Int(record.number("lunarYear")), month: Int(record.number("lunarMonth")),
        day: Int(record.number("lunarDay")), leap: record.flag("leap"))
    }
    return CalendarDays.date(record.text("date"))
  }
  static func next(_ record: Record, from: Date = Date()) -> Date? {
    guard let initial = date(record) else { return nil }
    if record.text("repeat") == "once" { return initial }
    let today = solar.startOfDay(for: from)
    if initial >= today { return initial }
    let unit =
      ["weekly": "week", "monthly": "month", "yearly": "year"][record.text("repeat")]
      ?? record.text("intervalUnit", "day")
    let step = record.text("repeat") == "custom" ? max(1, Int(record.number("interval"))) : 1
    if record.text("calendar") != "lunar" || unit == "day" || unit == "week" {
      return SolarOccurrence.next(from: initial, onOrAfter: today, unit: unit, interval: step, calendar: solar)
    }
    let anchorDay = Int(record.number("lunarDay"))
    if unit == "month" {
      guard var month = lunar.dateInterval(of: .month, for: initial)?.start else { return nil }
      let end = solar.date(from: DateComponents(year: 2101, month: 3, day: 1))!
      while month < end {
        guard let days = lunar.range(of: .day, in: .month, for: month)?.count,
              let candidate = lunar.date(byAdding: .day, value: min(anchorDay, days) - 1, to: month)
        else { return nil }
        if candidate >= today { return candidate }
        guard let following = lunar.date(byAdding: .month, value: step, to: month), following > month
        else { return nil }
        month = following
      }
      return nil
    }
    let firstYear = Int(record.number("lunarYear"))
    let start = firstYear + max(0, (solar.component(.year, from: today) - 1 - firstYear) / step) * step
    for year in stride(from: start, through: 2100, by: step) {
      guard let candidate = lunarDate(
        year: year, month: Int(record.number("lunarMonth")), day: anchorDay,
        leap: record.flag("leap"), clamp: true) else { continue }
      if candidate >= today { return candidate }
    }
    return nil
  }
  private static func lunarDate(year: Int, month: Int, day: Int, leap: Bool, clamp: Bool = false) -> Date? {
    guard (1900...2100).contains(year), (1...12).contains(month), (1...30).contains(day),
          let middle = solar.date(from: DateComponents(year: year, month: 7, day: 1))
    else { return nil }
    var parts = lunar.dateComponents([.era, .year], from: middle)
    parts.month = month
    parts.day = 1
    parts.isLeapMonth = leap
    guard let first = lunar.date(from: parts),
          let days = lunar.range(of: .day, in: .month, for: first)?.count,
          clamp || day <= days else { return nil }
    let actual = lunar.dateComponents([.era, .year, .month, .day], from: first)
    guard actual.era == parts.era, actual.year == parts.year,
          actual.month == month, actual.day == 1, actual.isLeapMonth == leap else { return nil }
    return lunar.date(byAdding: .day, value: min(day, days) - 1, to: first)
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
