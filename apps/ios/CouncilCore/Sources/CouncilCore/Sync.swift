import Foundation

/// One coordinator per store. Sends the outbox in order, then pulls changes by cursor.
/// An operation becomes immutable before its first request, so a retry is always the same request.
public actor SyncCoordinator {
  private let store: CouncilStore
  private var running = false
  public init(store: CouncilStore) { self.store = store }

  public func synchronize(baseURL: URL, token: String) async throws {
    guard !running else { return }
    running = true
    defer { running = false }
    var device = try await store.metadata("device")
    if device == nil {
      device = UUID().uuidString.lowercased()
      try await store.metadata("device", value: device!)
    }
    for attempt in 0...1 {
      do {
        let scope = try await prepare(baseURL, token: token, device: device!)
        try await push(baseURL, token: token, device: device!, scope: scope)
        try await pull(baseURL, token: token, scope: scope)
        return
      } catch SyncError.scopeChanged where attempt == 0 {
        continue
      }
    }
  }

  private func push(_ base: URL, token: String, device: String, scope: SyncScope?) async throws {
    let pending = try await store.operations()
    var blocked = Set<String>()
    let batches = Dictionary(grouping: pending.filter { $0.batchId != nil }, by: { $0.batchId! })
    var handled = Set<String>()
    for op in pending {
      if let batchId = op.batchId {
        guard handled.insert(batchId).inserted, let members = batches[batchId] else { continue }
        if members.count < 2 || members.contains(where: {
          blocked.contains($0.entityId) || ["error", "conflict"].contains($0.state)
        }) {
          blocked.formUnion(members.map(\.entityId))
        } else if try await !pushBatch(base, token: token, device: device, scope: scope,
          id: batchId, operations: members) {
          blocked.formUnion(members.map(\.entityId))
        }
        continue
      }
      if ["error", "conflict"].contains(op.state) { blocked.insert(op.entityId) }
      guard !blocked.contains(op.entityId) else { continue }
      guard try await store.mark(op, state: "sending") else { continue }
      var body = op.data
      if let scope {
        var command = try JSONDecoder().decode(Command.self, from: op.data)
        command.scope = scope
        body = try JSONEncoder().encode(command)
      }
      let (data, status) = try await request(
        base, path: "/v1/commands", token: token, device: device, body: body)
      try Self.checkScope(data, status)
      if [400, 409].contains(status) {
        // The server understood and refused: keep the edit, show it, never retry it blindly.
        let message =
          (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
          ?? "数据需要检查"
        try await store.mark(op, state: "error", error: message)
        blocked.insert(op.entityId)
        continue
      }
      guard status == 200 else { throw SyncError.response(status) }
      let receipt = try JSONDecoder().decode(Receipt.self, from: data)
      if receipt.outcome == "accepted", let record = receipt.entity {
        try await store.accept(op, record: record)
      } else if receipt.outcome == "conflict" {
        try await store.conflict(op, current: receipt.current)
        blocked.insert(op.entityId)
      } else {
        throw SyncError.invalidResponse
      }
    }
  }

  private func pushBatch(
    _ base: URL, token: String, device: String, scope: SyncScope?, id: String,
    operations: [PendingOperation]
  ) async throws -> Bool {
    guard try await store.claimBatch(id, count: operations.count) else { return false }
    let decoder = JSONDecoder()
    let commands = try operations.map {
      try BatchCommand.Member(decoder.decode(Command.self, from: $0.data))
    }
    let body = try JSONEncoder().encode(BatchCommand(operationId: id, commands: commands, scope: scope))
    let (data, status) = try await request(
      base, path: "/v1/command-batches", token: token, device: device, body: body)
    try Self.checkScope(data, status)
    if [400, 409].contains(status) {
      let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"]
        as? String ?? "这批修改需要检查"
      try await store.rejectBatch(id, message: message)
      return false
    }
    guard status == 200 else { throw SyncError.response(status) }
    let receipt = try decoder.decode(BatchReceipt.self, from: data)
    if receipt.outcome == "accepted", let effects = receipt.effects {
      let records = effects.compactMap(\.entity)
      guard records.count == operations.count,
        zip(records, operations).allSatisfy({ $0.0.id == $0.1.entityId && $0.0.type == $0.1.entityType })
      else { throw SyncError.invalidResponse }
      try await store.acceptBatch(id, records: records)
      return true
    }
    if receipt.outcome == "conflict", let entityId = receipt.entityId,
      operations.contains(where: { $0.entityId == entityId }) {
      try await store.rejectBatch(id, message: "同批修改包含冲突", conflictId: entityId, current: receipt.current)
      return false
    }
    throw SyncError.invalidResponse
  }

  private func pull(_ base: URL, token: String, scope: SyncScope?) async throws {
    var query = ""
    if let scope {
      query = "&datasetId=\(scope.datasetId)&generation=\(scope.generation)"
    }
    while true {
      let cursor = try await store.metadata("cursor") ?? "0"
      let (data, status) = try await request(
        base, path: "/v1/changes?limit=200&cursor=" + cursor + query, token: token)
      try Self.checkScope(data, status)
      guard status == 200 else { throw SyncError.response(status) }
      let page = try JSONDecoder().decode(Changes.self, from: data)
      try await store.apply(page.changes.map(\.entity), cursor: page.nextCursor)
      if !page.hasMore { break }
    }
  }

  private static func checkScope(_ data: Data, _ status: Int) throws {
    guard status == 409 else { return }
    struct Failure: Decodable { let error: String }
    let code = (try? JSONDecoder().decode(Failure.self, from: data))?.error
    if let code, ["DATASET_MISMATCH", "GENERATION_MISMATCH", "CURSOR_AHEAD", "SYNC_UPGRADE_REQUIRED"].contains(code) {
      throw SyncError.scopeChanged
    }
  }

  private func prepare(_ base: URL, token: String, device: String) async throws -> SyncScope? {
    let stored = try await store.metadata("scope")
    let (data, status) = try await request(base, path: "/v1/sync-state", token: token)
    if status == 404 && stored == nil { return nil }
    guard status == 200 else { throw SyncError.response(status) }
    let state = try JSONDecoder().decode(SyncDatasetState.self, from: data)
    let scope = SyncScope(datasetId: state.datasetId, generation: state.generation)
    let known = try stored.map { try JSONDecoder().decode(SyncScope.self, from: Data($0.utf8)) }
    let storedCursor = try await store.metadata("cursor")
    guard UUID(uuidString: scope.datasetId) != nil, UUID(uuidString: scope.generation) != nil,
      let watermark = UInt64(state.watermark), let cursor = UInt64(storedCursor ?? "0")
    else { throw SyncError.invalidResponse }

    let reviewPending = cursor > watermark || (known.map { $0 != scope } ?? (state.scopeRequired == true))
    let bootstrap = known == nil && storedCursor == nil && watermark > 200
    if reviewPending || bootstrap {
      try await restore(base, token: token, device: device, scope: scope, reviewPending: reviewPending, known: known)
    } else if known == nil {
      try await store.metadata("scope", value: String(decoding: JSONEncoder().encode(scope), as: UTF8.self))
    }
    return scope
  }

  private func restore(
    _ base: URL, token: String, device: String, scope: SyncScope, reviewPending: Bool, known: SyncScope?
  ) async throws {
    let (data, status) = try await request(base, path: "/v1/snapshots", token: token, device: device,
      body: JSONEncoder().encode(scope))
    try Self.checkScope(data, status)
    guard status == 200 else { throw SyncError.response(status) }
    let snapshot = try JSONDecoder().decode(SyncSnapshot.self, from: data)
    guard snapshot.datasetId == scope.datasetId, snapshot.generation == scope.generation,
      UUID(uuidString: snapshot.snapshotId) != nil, UInt64(snapshot.watermark) != nil,
      snapshot.total >= 0 else { throw SyncError.invalidResponse }
    try await store.beginSnapshot()
    var position = "0"
    var total = 0
    while true {
      let path = "/v1/snapshots/\(snapshot.snapshotId)?after=\(position)&limit=200"
      let (data, status) = try await request(base, path: path, token: token)
      try Self.checkScope(data, status)
      guard status == 200 else { throw SyncError.response(status) }
      let page = try JSONDecoder().decode(SyncSnapshotPage.self, from: data)
      total += page.records.count
      guard page.datasetId == scope.datasetId, page.generation == scope.generation,
        page.snapshotId == snapshot.snapshotId, page.watermark == snapshot.watermark,
        page.total == snapshot.total, total <= snapshot.total
      else { throw SyncError.invalidResponse }
      try await store.stageSnapshot(page.records)
      guard let next = page.nextPosition else { break }
      guard !page.records.isEmpty, next == String(total) else { throw SyncError.invalidResponse }
      position = next
    }
    guard total == snapshot.total else { throw SyncError.invalidResponse }
    var matches: [String: RecoveryResponse.Match] = [:]
    if reviewPending && (known == nil || known?.datasetId == scope.datasetId) {
      let probes = RecoveryIntents(try await store.operations()).probes(scope: known)
      let size = RecoveryRequest.pageSize
      for i in stride(from: 0, to: probes.count, by: size) {
        let payload = RecoveryRequest(scope: scope, watermark: snapshot.watermark,
          probes: Array(probes[i..<min(i + size, probes.count)]))
        guard let (body, status) = try? await request(base, path: "/v1/recovery-matches",
          token: token, device: device, body: JSONEncoder().encode(payload))
        else { break }
        if status == 413 { continue }
        try Self.checkScope(body, status)
        guard status == 200, let response = try? JSONDecoder().decode(RecoveryResponse.self, from: body)
        else { break }
        for match in response.matches { matches[match.operationId] = match }
      }
    }
    let (current, currentStatus) = try await request(base, path: "/v1/sync-state", token: token)
    guard currentStatus == 200 else { throw SyncError.response(currentStatus) }
    let latest = try JSONDecoder().decode(SyncDatasetState.self, from: current)
    guard latest.datasetId == scope.datasetId, latest.generation == scope.generation
    else { throw SyncError.scopeChanged }
    try await store.finishSnapshot(snapshot, scope: scope, reviewPending: reviewPending, matches: matches)
  }

  private func request(
    _ base: URL, path: String, token: String, device: String? = nil, body: Data? = nil
  ) async throws -> (Data, Int) {
    guard let url = URL(string: path, relativeTo: base) else { throw SyncError.invalidURL }
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
    request.timeoutInterval = 12
    request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    if let body {
      request.httpMethod = "POST"
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    if let device { request.setValue(device, forHTTPHeaderField: "x-device-id") }
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw SyncError.invalidResponse }
    return (data, http.statusCode)
  }

  /// Server-sent "something changed" hints. Each yield means: pull now. The stream ends on disconnect.
  public nonisolated static func hints(baseURL: URL, token: String) -> AsyncThrowingStream<Void, Error> {
    AsyncThrowingStream { continuation in
      let task = Task {
        do {
          guard let url = URL(string: "/v1/events", relativeTo: baseURL) else { throw SyncError.invalidURL }
          var request = URLRequest(url: url)
          request.timeoutInterval = 90  // the server sends a keep-alive every 25 s
          request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
          request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
          let (bytes, response) = try await URLSession.shared.bytes(for: request)
          let status = (response as? HTTPURLResponse)?.statusCode ?? 0
          guard status == 200 else { throw SyncError.response(status) }
          for try await line in bytes.lines where line == "event: changed" || line == "event: ready" {
            continuation.yield()
          }
          continuation.finish()
        } catch { continuation.finish(throwing: error) }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  /// Exchange a one-time pairing code for a device credential (kept by the caller in the Keychain).
  public nonisolated static func pair(baseURL: URL, code: String) async throws -> String {
    guard let url = URL(string: "/v1/pair", relativeTo: baseURL) else { throw SyncError.invalidURL }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 12
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("1", forHTTPHeaderField: "x-council-request")
    request.httpBody = try JSONSerialization.data(withJSONObject: ["code": code])
    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else { throw SyncError.response(status) }
    guard let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let credential = body["credential"] as? String
    else { throw SyncError.invalidResponse }
    return credential
  }

  public nonisolated static func quotes(baseURL: URL, token: String, ids: [String]) async throws -> [String: Quote] {
    struct Body: Decodable { let quotes: [String: Quote] }
    let unique = Array(Set(ids)).sorted()
    return await withTaskGroup(of: [String: Quote].self) { group in
      for start in stride(from: 0, to: unique.count, by: 40) {
        let batch = unique[start..<min(start + 40, unique.count)].joined(separator: ",")
        group.addTask {
          var components = URLComponents(url: baseURL.appendingPathComponent("v1/quotes"), resolvingAgainstBaseURL: false)
          components?.queryItems = [URLQueryItem(name: "ids", value: batch)]
          guard let url = components?.url,
            let data = try? await get(url, token: token),
            let body = try? JSONDecoder().decode(Body.self, from: data) else { return [:] }
          return body.quotes
        }
      }
      var quotes: [String: Quote] = [:]
      for await batch in group { quotes.merge(batch) { _, quote in quote } }
      return quotes
    }
  }
  public nonisolated static func searchQuotes(baseURL: URL, token: String, query: String, kind: String) async throws -> [QuoteMatch] {
    var components = URLComponents(url: baseURL.appendingPathComponent("v1/quotes/search"), resolvingAgainstBaseURL: false)
    components?.queryItems = [URLQueryItem(name: "q", value: query), URLQueryItem(name: "kind", value: kind)]
    guard let url = components?.url else { throw SyncError.invalidURL }
    struct Body: Decodable { let results: [QuoteMatch] }
    return try JSONDecoder().decode(Body.self, from: try await get(url, token: token)).results
  }
  private nonisolated static func get(_ url: URL, token: String) async throws -> Data {
    var request = URLRequest(url: url)
    request.timeoutInterval = 12
    request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else { throw SyncError.response(status) }
    return data
  }

  /// Disconnect this device on the server; its credential stops working immediately.
  public nonisolated static func revoke(baseURL: URL, token: String) async throws {
    guard let url = URL(string: "/v1/session/revoke", relativeTo: baseURL) else { throw SyncError.invalidURL }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 12
    request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    _ = try await URLSession.shared.data(for: request)
  }

  public enum SyncError: Error {
    case invalidURL, invalidResponse, scopeChanged
    case response(Int)
  }
}
