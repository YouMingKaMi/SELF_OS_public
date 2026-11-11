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
    try await push(baseURL, token: token, device: device!)
    try await pull(baseURL, token: token)
  }

  private func push(_ base: URL, token: String, device: String) async throws {
    let pending = try await store.operations()
    // An entity with an unresolved problem keeps its later edits queued, in order.
    var blocked = Set(pending.filter { ["conflict", "error"].contains($0.state) }.map(\.entityId))
    for op in pending where !blocked.contains(op.entityId) {
      guard try await store.mark(op, state: "sending") else { continue }
      let (data, status) = try await request(
        base, path: "/v1/commands", token: token, device: device, body: op.data)
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

  private func pull(_ base: URL, token: String) async throws {
    while true {
      let cursor = try await store.metadata("cursor") ?? "0"
      let (data, status) = try await request(
        base, path: "/v1/changes?limit=200&cursor=" + cursor, token: token)
      guard status == 200 else { throw SyncError.response(status) }
      let page = try JSONDecoder().decode(Changes.self, from: data)
      try await store.apply(page.changes.map(\.entity), cursor: page.nextCursor)
      if !page.hasMore { break }
    }
  }

  private func request(
    _ base: URL, path: String, token: String, device: String? = nil, body: Data? = nil
  ) async throws -> (Data, Int) {
    guard let url = URL(string: path, relativeTo: base) else { throw SyncError.invalidURL }
    var request = URLRequest(url: url)
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
    guard !ids.isEmpty else { return [:] }
    var components = URLComponents(url: baseURL.appendingPathComponent("v1/quotes"), resolvingAgainstBaseURL: false)
    components?.queryItems = [URLQueryItem(name: "ids", value: ids.joined(separator: ","))]
    guard let url = components?.url else { throw SyncError.invalidURL }
    struct Body: Decodable { let quotes: [String: Quote] }
    return try JSONDecoder().decode(Body.self, from: try await get(url, token: token)).quotes
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
    case invalidURL, invalidResponse
    case response(Int)
  }
}
