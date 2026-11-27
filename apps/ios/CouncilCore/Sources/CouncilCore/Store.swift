import Foundation
import GRDB

/// What a screen wants to read: one entity type, optionally narrowed. Every clause runs in SQLite.
public struct Query: Sendable, Hashable {
  public var type: String
  /// Field name → exact value, e.g. `["habitId": id]`.
  public var equals: [String: String] = [:]
  /// Inclusive range on a day/month/timestamp field, e.g. `("day", "2026-11-01", "2026-11-30")`.
  public var range: Range? = nil
  public var includeDeleted = false
  public var limit: Int? = nil
  public struct Range: Sendable, Hashable {
    public var field: String
    public var from: String
    public var through: String
    public init(_ field: String, from: String, through: String) {
      self.field = field
      self.from = from
      self.through = through
    }
  }
  public init(
    _ type: String, equals: [String: String] = [:], range: Range? = nil,
    includeDeleted: Bool = false, limit: Int? = nil
  ) {
    self.type = type
    self.equals = equals
    self.range = range
    self.includeDeleted = includeDeleted
    self.limit = limit
  }
}

/// One entity replacement in a local intent saved with other related edits.
public struct BatchPut: Sendable {
  public let type: String
  public let id: String
  public let data: [String: JSONValue]
  public let version: Int

  public init(type: String, id: String, data: [String: JSONValue], version: Int) {
    self.type = type
    self.id = id
    self.data = data
    self.version = version
  }
}

public struct PendingOperation: Identifiable, Sendable, Equatable {
  public let id: String
  public let entityId: String
  public let entityType: String
  public let batchId: String?
  /// The encoded `Command`, immutable once written.
  public let data: Data
  public let state: String
  public let error: String?
  public let recoveryDraft: Record?
}

/// The device's local database.
///
/// - One typed table per entity type, generated from the shared schema. A row is what the user
///   sees: the server-confirmed copy with this device's unsent edits applied.
/// - `operations` is the outbox. A local write updates the row and appends the operation in one
///   transaction, so the screen and the queue can never disagree.
/// - `shadows` keeps the confirmed copy of an entity only while it has unsent edits, so undo,
///   conflict resolution and incoming server changes never lose either side.
///
/// Writes cost one row regardless of database size; reads are SQL queries, observable per table.
public actor CouncilStore {
  nonisolated let database: DatabaseQueue
  private static let encoder = JSONEncoder()
  private static let decoder = JSONDecoder()

  public init(path: String) throws {
    database = try DatabaseQueue(path: path)
    try database.write { db in try Self.migrate(db) }
  }

  // MARK: - Layout

  /// Additive only, like the server: new tables and new nullable columns appear on upgrade.
  private static func migrate(_ db: Database) throws {
    try db.execute(
      sql: """
        CREATE TABLE IF NOT EXISTS operations(sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, entity_id TEXT NOT NULL, entity_type TEXT NOT NULL, payload BLOB NOT NULL, state TEXT NOT NULL DEFAULT 'queued', server BLOB, error TEXT);
        CREATE INDEX IF NOT EXISTS operations_entity ON operations(entity_id);
        CREATE TABLE IF NOT EXISTS shadows(id TEXT PRIMARY KEY, type TEXT NOT NULL, payload BLOB);
        CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS snapshot_stage(id TEXT PRIMARY KEY, payload BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS recovery_drafts(id TEXT PRIMARY KEY, payload BLOB NOT NULL);
        """)
    if try !db.columns(in: "operations").contains(where: { $0.name == "batch_id" }) {
      try db.execute(sql: "ALTER TABLE operations ADD COLUMN batch_id TEXT")
    }
    try db.execute(sql: "CREATE INDEX IF NOT EXISTS operations_batch ON operations(batch_id)")
    for spec in EntitySchema.all {
      let columns = spec.fields.map { "\"\($0.column)\" \($0.storage)" }.joined(separator: ", ")
      try db.execute(
        sql:
          "CREATE TABLE IF NOT EXISTS \"\(spec.table)\"(id TEXT PRIMARY KEY, version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, \(columns))"
      )
      let existing = Set(try db.columns(in: spec.table).map(\.name))
      for field in spec.fields where !existing.contains(field.column) {
        try db.execute(
          sql: "ALTER TABLE \"\(spec.table)\" ADD COLUMN \"\(field.column)\" \(field.storage)")
      }
      for field in spec.fields where [.day, .ref].contains(field.kind) {
        try db.execute(
          sql:
            "CREATE INDEX IF NOT EXISTS \"\(spec.table)_\(field.column)\" ON \"\(spec.table)\"(\"\(field.column)\")"
        )
      }
    }
  }

  // MARK: - Rows

  private static func record(_ spec: EntitySpec, _ row: Row) -> Record {
    var data: [String: JSONValue] = [:]
    for field in spec.fields {
      let value: DatabaseValue = row[field.column]
      switch value.storage {
      case .null, .blob: continue
      case .int64(let number):
        data[field.name] =
          field.kind == .boolean
          ? .bool(number != 0)
          : field.kind == .money ? .string(String(number)) : .number(Double(number))
      case .double(let number): data[field.name] = .number(number)
      case .string(let text):
        if field.kind == .strings {
          data[field.name] =
            (try? decoder.decode(JSONValue.self, from: Data(text.utf8))) ?? .array([])
        } else {
          data[field.name] = .string(text)
        }
      }
    }
    return Record(
      id: row["id"], type: spec.type, version: row["version"], data: data,
      deleted: row["deleted"], updatedAt: row["updated_at"])
  }

  /// Values a server would reject are still kept as typed: the user must see what they entered.
  private static func bind(_ value: JSONValue?) throws -> DatabaseValue {
    switch value {
    case .none, .null: return .null
    case .string(let text): return text.databaseValue
    case .number(let number):
      return number == number.rounded() && abs(number) < 9e15
        ? Int64(number).databaseValue : number.databaseValue
    case .bool(let flag): return flag.databaseValue
    case .array, .object:
      return String(decoding: try encoder.encode(value), as: UTF8.self).databaseValue
    }
  }

  private static func write(_ db: Database, _ record: Record) throws {
    guard let spec = EntitySchema.byType[record.type] else { throw StoreError.unknownType }
    let columns = ["id", "version", "deleted", "updated_at"] + spec.fields.map(\.column)
    var values: [DatabaseValue] = [
      record.id.databaseValue, record.version.databaseValue, record.deleted.databaseValue,
      record.updatedAt.databaseValue,
    ]
    for field in spec.fields { values.append(try bind(record.data[field.name])) }
    try db.execute(
      sql:
        "INSERT OR REPLACE INTO \"\(spec.table)\"(\(columns.map { "\"\($0)\"" }.joined(separator: ","))) VALUES(\(columns.map { _ in "?" }.joined(separator: ",")))",
      arguments: StatementArguments(values))
  }

  private static func fetchOne(_ db: Database, type: String, id: String) throws -> Record? {
    guard let spec = EntitySchema.byType[type] else { throw StoreError.unknownType }
    return try Row.fetchOne(
      db, sql: "SELECT * FROM \"\(spec.table)\" WHERE id=?", arguments: [id]
    ).map { record(spec, $0) }
  }

  private static func fetch(_ db: Database, _ query: Query) throws -> [Record] {
    guard let spec = EntitySchema.byType[query.type] else { throw StoreError.unknownType }
    var conditions: [String] = []
    var arguments: [DatabaseValue] = []
    if !query.includeDeleted { conditions.append("NOT deleted") }
    for (name, value) in query.equals.sorted(by: { $0.key < $1.key }) {
      guard let field = spec.field(name) else { throw StoreError.unknownField(name) }
      conditions.append("\"\(field.column)\"=?")
      arguments.append(value.databaseValue)
    }
    if let range = query.range {
      guard let field = spec.field(range.field) else { throw StoreError.unknownField(range.field) }
      conditions.append("\"\(field.column)\" BETWEEN ? AND ?")
      arguments += [range.from.databaseValue, range.through.databaseValue]
    }
    let filter = conditions.isEmpty ? "" : " WHERE " + conditions.joined(separator: " AND ")
    let limit = query.limit.map { " LIMIT \($0)" } ?? ""
    return try Row.fetchAll(
      db,
      sql: "SELECT * FROM \"\(spec.table)\"\(filter) ORDER BY updated_at DESC, id\(limit)",
      arguments: StatementArguments(arguments)
    ).map { record(spec, $0) }
  }

  // MARK: - Reading

  public func records(_ query: Query) throws -> [Record] {
    try database.read { db in try Self.fetch(db, query) }
  }
  public func records(type: String, includeDeleted: Bool = false) throws -> [Record] {
    try records(Query(type, includeDeleted: includeDeleted))
  }
  public func record(type: String, id: String) throws -> Record? {
    try database.read { db in try Self.fetchOne(db, type: type, id: id) }
  }

  /// Emits the current result, then again whenever the queried table changes. Other tables are ignored.
  public nonisolated func observe(_ query: Query) -> AsyncThrowingStream<[Record], Error> {
    stream(ValueObservation.tracking { db in try Self.fetch(db, query) })
  }
  public nonisolated func observeOperations() -> AsyncThrowingStream<[PendingOperation], Error> {
    stream(ValueObservation.tracking { db in try Self.operations(db) })
  }
  private nonisolated func stream<Value: Sendable>(
    _ observation: ValueObservation<ValueReducers.Fetch<Value>>
  ) -> AsyncThrowingStream<Value, Error> {
    let database = database
    return AsyncThrowingStream { continuation in
      let task = Task {
        do {
          for try await value in observation.values(in: database) { continuation.yield(value) }
          continuation.finish()
        } catch { continuation.finish(throwing: error) }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  /// Substring search over text fields, newest first. Runs in SQLite, never loads a whole table.
  public func search(_ text: String, type: String? = nil, limit: Int = 100) throws -> [Record] {
    let needle = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !needle.isEmpty else { return [] }
    let pattern =
      "%"
      + needle.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(
        of: "%", with: "\\%"
      ).replacingOccurrences(of: "_", with: "\\_") + "%"
    return try database.read { db in
      var found: [Record] = []
      for spec in EntitySchema.all where type == nil || type == spec.type {
        let columns = spec.fields.filter { [.string, .day, .month].contains($0.kind) }
        guard !columns.isEmpty else { continue }
        let match = columns.map { "\"\($0.column)\" LIKE ? ESCAPE '\\'" }.joined(separator: " OR ")
        found += try Row.fetchAll(
          db,
          sql:
            "SELECT * FROM \"\(spec.table)\" WHERE NOT deleted AND (\(match)) ORDER BY updated_at DESC LIMIT \(limit)",
          arguments: StatementArguments(columns.map { _ in pattern })
        ).map { Self.record(spec, $0) }
      }
      return Array(found.sorted { $0.updatedAt > $1.updatedAt }.prefix(limit))
    }
  }

  /// Live and deleted row counts across every type, for the settings screen.
  public func counts() throws -> (live: Int, deleted: Int) {
    try database.read { db in
      var live = 0
      var deleted = 0
      for spec in EntitySchema.all {
        let row = try Row.fetchOne(
          db,
          sql:
            "SELECT count(*) FILTER (WHERE NOT deleted) AS live, count(*) FILTER (WHERE deleted) AS gone FROM \"\(spec.table)\""
        )
        live += row?["live"] ?? 0
        deleted += row?["gone"] ?? 0
      }
      return (live, deleted)
    }
  }

  // MARK: - Local writes

  @discardableResult
  public func put(
    type: String, data: [String: JSONValue], id: String = UUID().uuidString.lowercased(),
    editBase: Record? = nil
  ) throws -> String {
    try database.write { db in
      guard let editBase else {
        try Self.enqueue(db, type: type, id: id, action: "put", data: data)
        return
      }
      guard editBase.id == id, editBase.type == type,
        let current = try Self.fetchOne(db, type: type, id: id), !current.deleted
      else { throw StoreError.recordRemoved }
      var patch: [String: JSONValue] = [:]
      for key in Set(editBase.data.keys).union(data.keys) {
        let old = editBase.data[key] ?? .null
        let next = data[key] ?? .null
        if old == next { continue }
        let latest = current.data[key] ?? .null
        guard latest == old || latest == next else { throw StoreError.editChanged }
        patch[key] = next
      }
      if !patch.isEmpty {
        try Self.enqueue(db, type: type, id: id, action: "patch", data: patch)
      }
    }
    return id
  }
  public func putTogether(_ writes: [BatchPut]) throws {
    guard (2...BatchCommand.maximum).contains(writes.count),
      Set(writes.map { $0.id.lowercased() }).count == writes.count
    else { throw StoreError.invalidBatch }
    try database.write { db in
      let batchId = UUID().uuidString.lowercased()
      for write in writes {
        let current = try Self.fetchOne(db, type: write.type, id: write.id)
        guard (current?.version ?? 0) == write.version else { throw StoreError.editChanged }
        try Self.enqueue(db, type: write.type, id: write.id, action: "put",
          data: write.data, batchId: batchId)
      }
    }
  }

  public func removeTogether(_ records: [Record]) throws {
    guard (2...BatchCommand.maximum).contains(records.count),
      Set(records.map { $0.id.lowercased() }).count == records.count
    else { throw StoreError.invalidBatch }
    try database.write { db in
      let batchId = UUID().uuidString.lowercased()
      for record in records {
        guard let current = try Self.fetchOne(db, type: record.type, id: record.id),
          !current.deleted, current.version == record.version else { throw StoreError.editChanged }
        try Self.enqueue(db, type: record.type, id: record.id, action: "delete",
          data: nil, batchId: batchId)
      }
    }
  }

  /// Move a whole record or a half-open range of UTF-16 offsets as one offline intent.
  @discardableResult
  public func transferJournalText(_ source: Record, selection: Range<Int>? = nil) throws -> String {
    try database.write { db in
      let toRaw = source.type == "idea"
      guard toRaw || (source.type == "journal" && source.text("kind") == "raw"),
        !source.deleted else { throw StoreError.invalidTransfer }
      guard let current = try Self.fetchOne(db, type: source.type, id: source.id),
        !current.deleted, current.version == source.version, current.data == source.data
      else { throw StoreError.editChanged }
      let units = Array(current.text("body").utf16)
      let range = selection ?? 0..<units.count
      func splitsScalar(_ offset: Int) -> Bool {
        offset > 0 && offset < units.count &&
          (0xd800...0xdbff).contains(units[offset - 1]) && (0xdc00...0xdfff).contains(units[offset])
      }
      guard !range.isEmpty, range.lowerBound >= 0, range.upperBound <= units.count,
        !splitsScalar(range.lowerBound), !splitsScalar(range.upperBound)
      else { throw StoreError.invalidTransfer }
      let moved = String(decoding: units[range], as: UTF16.self)
      // Same whitespace set as JavaScript trim and the server's required-body check.
      let whitespace = CharacterSet(charactersIn: "\t\n\u{0B}\u{0C}\r \u{A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")
      let blank: (String) -> Bool = {
        $0.unicodeScalars.allSatisfy(whitespace.contains)
      }
      guard !blank(moved), !current.text("day").isEmpty else { throw StoreError.invalidTransfer }
      guard toRaw || range.count <= 100_000 else { throw StoreError.transferTooLong }
      let remaining = String(decoding: units[..<range.lowerBound] + units[range.upperBound...], as: UTF16.self)
      let batchId = UUID().uuidString.lowercased()
      let id = UUID().uuidString.lowercased()
      if blank(remaining) {
        try Self.enqueue(db, type: current.type, id: current.id, action: "delete", data: nil, batchId: batchId)
      } else {
        var data = current.data
        data["body"] = .string(remaining)
        try Self.enqueue(db, type: current.type, id: current.id, action: "put", data: data, batchId: batchId)
      }
      let target: [String: JSONValue] = toRaw
        ? ["body": .string(moved), "day": .string(current.text("day")), "kind": .string("raw"), "complete": .bool(false)]
        : ["body": .string(moved), "day": .string(current.text("day")), "status": .string("pending")]
      try Self.enqueue(db, type: toRaw ? "journal" : "idea", id: id, action: "put", data: target, batchId: batchId)
      return id
    }
  }

  /// Validate the latest local task and all prerequisites in the same transaction that queues it.
  public func completeTask(id: String, at date: Date = Date()) throws {
    try database.write { db in
      guard let task = try Self.fetchOne(db, type: "task", id: id), !task.deleted else {
        throw StoreError.missingTask
      }
      if task.text("status") == "completed" { return }
      guard task.text("status") == "pending" else { throw StoreError.inactiveTask }
      for prerequisite in TaskRules.prerequisites(task) {
        guard let record = try Self.fetchOne(db, type: "task", id: prerequisite),
          !record.deleted, record.text("status") == "completed" else {
          throw StoreError.blockedTask
        }
      }
      let data = TaskRules.apply(
        "complete", to: task, now: ISO8601DateFormatter().string(from: date))
      try Self.enqueue(db, type: "task", id: id, action: "put", data: data)
    }
  }
  public func remove(_ record: Record) throws {
    try database.write { db in
      try Self.enqueue(db, type: record.type, id: record.id, action: "delete", data: nil)
    }
  }

  private static func enqueue(
    _ db: Database, type: String, id: String, action: String, data: [String: JSONValue]?,
    batchId: String? = nil
  ) throws {
    if try Int.fetchOne(
      db,
      sql: "SELECT count(*) FROM operations WHERE entity_id=? AND state IN ('conflict','error')",
      arguments: [id]) ?? 0 > 0
    {
      throw StoreError.unresolvedConflict
    }
    let current = try fetchOne(db, type: type, id: id)
    let queued =
      try Int.fetchOne(
        db, sql: "SELECT count(*) FROM operations WHERE entity_id=?", arguments: [id]) ?? 0
    if queued == 0 {
      // First unsent edit: remember what the server last confirmed (possibly "nothing").
      try db.execute(
        sql: "INSERT OR REPLACE INTO shadows(id,type,payload) VALUES(?,?,?)",
        arguments: [id, type, try current.map { try encoder.encode($0) }])
    }
    let command = Command(
      operationId: UUID().uuidString.lowercased(), entityId: id, entityType: type,
      // Do not let an older installed binary mistakenly send a member as a single command.
      baseVersion: current?.version ?? 0, action: batchId == nil ? action : "batch-" + action, data: data,
      occurredAt: ISO8601DateFormatter().string(from: Date()))
    try db.execute(
      sql: "INSERT INTO operations(id,entity_id,entity_type,payload,batch_id) VALUES(?,?,?,?,?)",
      arguments: [command.operationId, id, type, try encoder.encode(command), batchId])
    try write(db, project(current, command))
  }

  private static func project(_ current: Record?, _ command: Command) -> Record {
    var data = command.data ?? current?.data ?? [:]
    if command.action == "patch" {
      data = current?.data ?? [:]
      for (key, value) in command.data ?? [:] {
        data[key] = value == .null ? nil : value
      }
    }
    return Record(
      id: command.entityId, type: command.entityType, version: (current?.version ?? 0) + 1,
      data: data, deleted: ["delete", "batch-delete"].contains(command.action),
      updatedAt: command.occurredAt)
  }

  /// Recompute the visible row of one entity from its confirmed copy and the edits still queued.
  private static func rebuild(_ db: Database, type: String, id: String) throws {
    guard let spec = EntitySchema.byType[type] else { throw StoreError.unknownType }
    var entity = try Data.fetchOne(db, sql: "SELECT payload FROM shadows WHERE id=?", arguments: [id])
      .map { try decoder.decode(Record.self, from: $0) }
    let queued = try Data.fetchAll(
      db, sql: "SELECT payload FROM operations WHERE entity_id=? ORDER BY sequence",
      arguments: [id])
    if try Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM recovery_drafts WHERE id=?)",
      arguments: [id]) != true {
      for payload in queued { entity = project(entity, try decoder.decode(Command.self, from: payload)) }
    }
    if let entity {
      try write(db, entity)
    } else {
      try db.execute(sql: "DELETE FROM \"\(spec.table)\" WHERE id=?", arguments: [id])
    }
    if queued.isEmpty { try db.execute(sql: "DELETE FROM shadows WHERE id=?", arguments: [id]) }
  }

  // MARK: - Outbox

  private static func operations(_ db: Database) throws -> [PendingOperation] {
    try Row.fetchAll(db, sql: """
      SELECT operations.*, recovery_drafts.payload AS recovery_payload
      FROM operations LEFT JOIN recovery_drafts ON operations.entity_id=recovery_drafts.id
      ORDER BY sequence
      """).map { row in
      PendingOperation(
        id: row["id"], entityId: row["entity_id"], entityType: row["entity_type"],
        batchId: row["batch_id"], data: row["payload"], state: row["state"], error: row["error"],
        recoveryDraft: try (row["recovery_payload"] as Data?).map {
          try decoder.decode(Record.self, from: $0)
        })
    }
  }
  public func operations() throws -> [PendingOperation] {
    try database.read { db in try Self.operations(db) }
  }

  /// Claiming an operation for sending fails if it was undone in the meantime.
  @discardableResult public func mark(_ op: PendingOperation, state: String, error: String? = nil)
    throws -> Bool
  {
    try database.write { db in
      try db.execute(
        sql: "UPDATE operations SET state=?,error=? WHERE id=?"
          + (state == "sending" ? " AND state IN ('queued','sending')" : ""),
        arguments: [state, error, op.id])
      return db.changesCount == 1
    }
  }

  func claimBatch(_ id: String, count: Int) throws -> Bool {
    try database.write { db in
      let allowed = try Int.fetchOne(db, sql: """
        SELECT count(*) FROM operations
        WHERE batch_id=? AND state IN ('queued','sending')
        """, arguments: [id])
      guard allowed == count else { return false }
      try db.execute(sql: "UPDATE operations SET state='sending',error=NULL WHERE batch_id=?",
        arguments: [id])
      return true
    }
  }

  func acceptBatch(_ id: String, records: [Record]) throws {
    try database.write { db in
      let ids = try String.fetchAll(db, sql: "SELECT entity_id FROM operations WHERE batch_id=? ORDER BY sequence",
        arguments: [id])
      guard ids == records.map(\.id) else { throw SyncCoordinator.SyncError.invalidResponse }
      try db.execute(sql: "DELETE FROM operations WHERE batch_id=?", arguments: [id])
      for record in records { try Self.confirm(db, record) }
    }
  }

  func rejectBatch(_ id: String, message: String, conflictId: String? = nil, current: Record? = nil) throws {
    try database.write { db in
      try db.execute(sql: "UPDATE operations SET state='error',error=? WHERE batch_id=?",
        arguments: [message, id])
      if let conflictId {
        try db.execute(sql: """
          UPDATE operations SET state='conflict',server=? WHERE batch_id=? AND entity_id=?
          """, arguments: [try current.map { try Self.encoder.encode($0) }, id, conflictId])
      }
    }
  }

  /// The server accepted `op` and returned the confirmed entity.
  public func accept(_ op: PendingOperation, record: Record) throws {
    try database.write { db in
      try db.execute(sql: "DELETE FROM operations WHERE id=?", arguments: [op.id])
      try Self.confirm(db, record)
    }
  }
  public func conflict(_ op: PendingOperation, current: Record?) throws {
    let data = try current.map { try Self.encoder.encode($0) }
    try database.write { db in
      try db.execute(
        sql: "UPDATE operations SET state='conflict',server=? WHERE id=?", arguments: [data, op.id])
    }
  }

  /// A page of server changes and its cursor land in one transaction: a crash never skips a page.
  public func apply(_ records: [Record], cursor: String) throws {
    try database.write { db in
      for record in records { try Self.confirm(db, record) }
      try db.execute(
        sql: "INSERT INTO metadata VALUES('cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        arguments: [cursor])
    }
  }

  /// Take in a confirmed copy without disturbing unsent edits of the same entity.
  private static func confirm(_ db: Database, _ record: Record) throws {
    guard EntitySchema.byType[record.type] != nil else { throw StoreError.unknownType }
    let queued =
      try Int.fetchOne(
        db, sql: "SELECT count(*) FROM operations WHERE entity_id=?", arguments: [record.id]) ?? 0
    if queued > 0 {
      let known = try Data.fetchOne(
        db, sql: "SELECT payload FROM shadows WHERE id=?", arguments: [record.id]
      ).map { try decoder.decode(Record.self, from: $0) }
      if (known?.version ?? 0) <= record.version {
        try db.execute(
          sql: "INSERT OR REPLACE INTO shadows(id,type,payload) VALUES(?,?,?)",
          arguments: [record.id, record.type, try encoder.encode(record)])
        if try Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM recovery_drafts WHERE id=?)",
          arguments: [record.id]) == true {
          try write(db, record)
        }
      }
      return
    }
    try db.execute(sql: "DELETE FROM shadows WHERE id=?", arguments: [record.id])
    if let current = try fetchOne(db, type: record.type, id: record.id),
      current.version > record.version
    {
      return
    }
    try write(db, record)
  }

  /// Withdraw an edit that has not been sent and has no later edit depending on its version.
  public func undo(_ id: String) throws {
    try database.write { db in
      guard
        let target = try Row.fetchOne(
          db, sql: "SELECT * FROM operations WHERE id=?", arguments: [id]),
        target["state"] as String == "queued"
      else { throw StoreError.alreadySending }
      let group = try (target["batch_id"] as String?).map {
        try Row.fetchAll(db, sql: "SELECT * FROM operations WHERE batch_id=? ORDER BY sequence",
          arguments: [$0])
      } ?? [target]
      for member in group {
        guard member["state"] as String == "queued" else { throw StoreError.alreadySending }
        let later = try Int.fetchOne(
          db, sql: "SELECT count(*) FROM operations WHERE entity_id=? AND sequence>?",
          arguments: [member["entity_id"] as String, member["sequence"] as Int]) ?? 0
        guard later == 0 else { throw StoreError.laterEdits }
      }
      for member in group {
        try db.execute(sql: "DELETE FROM operations WHERE id=?", arguments: [member["id"] as String])
        try Self.rebuild(db, type: member["entity_type"], id: member["entity_id"])
      }
    }
  }

  /// Resolve a conflict or rejected write: adopt the server copy, optionally re-apply the local one on top.
  public func settle(_ entityId: String, keepLocal: Bool) throws {
    try database.write { db in
      guard
        let row = try Row.fetchOne(
          db,
          sql:
            "SELECT * FROM operations WHERE entity_id=? AND state IN ('conflict','error') ORDER BY sequence LIMIT 1",
          arguments: [entityId])
      else { return }
      if let batchId = row["batch_id"] as String? {
        try Self.settleBatch(db, id: batchId, keepLocal: keepLocal)
        return
      }
      let nextBatch = try Int.fetchOne(db, sql: """
        SELECT min(sequence) FROM operations WHERE entity_id=? AND batch_id IS NOT NULL
        """, arguments: [entityId])
      // An earlier decision must not remove a later, still pending, grouped intent.
      if let nextBatch {
        guard !keepLocal else { throw StoreError.laterEdits }
        if row["state"] as String == "conflict" {
          try db.execute(sql: "INSERT OR REPLACE INTO shadows(id,type,payload) VALUES(?,?,?)",
            arguments: [entityId, row["entity_type"] as String, row["server"] as Data?])
        }
        try db.execute(sql: "DELETE FROM operations WHERE entity_id=? AND sequence<?",
          arguments: [entityId, nextBatch])
        try Self.rebuild(db, type: row["entity_type"], id: entityId)
        return
      }
      let type: String = row["entity_type"]
      let draft = try Data.fetchOne(db, sql: "SELECT payload FROM recovery_drafts WHERE id=?",
        arguments: [entityId]).map { try Self.decoder.decode(Record.self, from: $0) }
      let local = try draft ?? Self.fetchOne(db, type: type, id: entityId)
      if row["state"] as String == "conflict" {
        try db.execute(
          sql: "INSERT OR REPLACE INTO shadows(id,type,payload) VALUES(?,?,?)",
          arguments: [entityId, type, row["server"] as Data?])
      }
      try db.execute(sql: "DELETE FROM operations WHERE entity_id=?", arguments: [entityId])
      try db.execute(sql: "DELETE FROM recovery_drafts WHERE id=?", arguments: [entityId])
      try Self.rebuild(db, type: type, id: entityId)
      guard keepLocal, let local else { return }
      if draft != nil, local.deleted {
        guard let confirmed = try Self.fetchOne(db, type: type, id: entityId),
          !confirmed.deleted else { return }
      }
      try Self.enqueue(
        db, type: type, id: entityId, action: local.deleted ? "delete" : "put",
        data: local.deleted ? nil : local.data)
    }
  }

  private static func settleBatch(_ db: Database, id: String, keepLocal: Bool) throws {
    let members = try Row.fetchAll(db, sql: "SELECT * FROM operations WHERE batch_id=? ORDER BY sequence",
      arguments: [id])
    if keepLocal && members.count == 2 &&
      Set(members.map { $0["entity_type"] as String }) == ["idea", "journal"] {
      throw StoreError.editChanged
    }
    let nextId = UUID().uuidString.lowercased()
    for member in members {
      let entityId: String = member["entity_id"]
      let type: String = member["entity_type"]
      let others = try Int.fetchOne(db, sql: "SELECT count(*) FROM operations WHERE entity_id=? AND id<>?",
        arguments: [entityId, member["id"] as String]) ?? 0
      if keepLocal && others != 0 { throw StoreError.laterEdits }
      if member["state"] as String == "conflict" {
        let existing = try Data.fetchOne(db, sql: "SELECT payload FROM shadows WHERE id=?", arguments: [entityId])
          .map { try decoder.decode(Record.self, from: $0) }
        let incoming = try (member["server"] as Data?).map { try decoder.decode(Record.self, from: $0) }
        let command = try decoder.decode(Command.self, from: member["payload"])
        if (existing?.version ?? 0) <= (incoming?.version ?? command.baseVersion) {
          try db.execute(sql: "INSERT OR REPLACE INTO shadows(id,type,payload) VALUES(?,?,?)",
            arguments: [entityId, type, member["server"] as Data?])
        }
      }
      try db.execute(sql: "DELETE FROM operations WHERE id=?", arguments: [member["id"] as String])
      if others == 0 {
        try db.execute(sql: "DELETE FROM recovery_drafts WHERE id=?", arguments: [entityId])
      }
      try rebuild(db, type: type, id: entityId)
      if keepLocal {
        let command = try decoder.decode(Command.self, from: member["payload"])
        try enqueue(db, type: type, id: entityId,
          action: command.action == "batch-delete" ? "delete" : "put", data: command.data, batchId: nextId)
      }
    }
  }

  // MARK: - Recovery

  func beginSnapshot() throws {
    try database.write { db in try db.execute(sql: "DELETE FROM snapshot_stage") }
  }

  func stageSnapshot(_ records: [Record]) throws {
    try database.write { db in
      for record in records {
        guard EntitySchema.byType[record.type] != nil else { throw StoreError.unknownType }
        try db.execute(sql: "INSERT INTO snapshot_stage(id,payload) VALUES(?,?)",
          arguments: [record.id, try Self.encoder.encode(record)])
      }
    }
  }

  /// Swap only a complete snapshot. Any failed write rolls back confirmed data and all drafts.
  func finishSnapshot(
    _ snapshot: SyncSnapshot, scope: SyncScope, reviewPending: Bool = true,
    matches: [String: RecoveryResponse.Match] = [:]
  ) throws {
    try database.write { db in
      guard try Int.fetchOne(db, sql: "SELECT count(*) FROM snapshot_stage") == snapshot.total
      else { throw SyncCoordinator.SyncError.invalidResponse }
      if reviewPending && !matches.isEmpty {
        let intents = RecoveryIntents(try Self.operations(db))
        let matched = try intents.settled(matches) { id in
          try Data.fetchOne(db, sql: "SELECT payload FROM snapshot_stage WHERE id=?", arguments: [id])
            .map { try Self.decoder.decode(Record.self, from: $0) }
        }
        for id in matched {
          try db.execute(sql: "DELETE FROM operations WHERE id=?", arguments: [id])
        }
      }
      let pendingEntities = try Row.fetchAll(db, sql: """
        SELECT DISTINCT entity_id,entity_type FROM operations
        WHERE entity_id NOT IN (SELECT id FROM recovery_drafts)
        """)
      if reviewPending {
        for row in pendingEntities {
          let id: String = row["entity_id"]
          let type: String = row["entity_type"]
          guard let local = try Self.fetchOne(db, type: type, id: id) else { continue }
          try db.execute(sql: "INSERT INTO recovery_drafts VALUES(?,?)",
            arguments: [id, try Self.encoder.encode(local)])
        }
        try db.execute(sql: "UPDATE operations SET state='error',server=NULL,error=?",
          arguments: ["服务器已从备份恢复，请核对恢复前的本机修改"])
      }
      try db.execute(sql: "DELETE FROM shadows")
      for spec in EntitySchema.all {
        try db.execute(sql: "DELETE FROM \"\(spec.table)\"")
      }
      let staged = try Data.fetchCursor(db, sql: "SELECT payload FROM snapshot_stage")
      while let payload = try staged.next() {
        let record = try Self.decoder.decode(Record.self, from: payload)
        try Self.confirm(db, record)
      }
      if !reviewPending {
        for row in pendingEntities {
          try Self.rebuild(db, type: row["entity_type"], id: row["entity_id"])
        }
      }
      try db.execute(sql: "DELETE FROM snapshot_stage")
      try Self.setMetadata(db, "cursor", snapshot.watermark)
      try Self.setMetadata(db, "scope", String(decoding: try Self.encoder.encode(scope), as: UTF8.self))
    }
  }

  // MARK: - Metadata

  public func metadata(_ key: String) throws -> String? {
    try database.read { db in
      try String.fetchOne(db, sql: "SELECT value FROM metadata WHERE key=?", arguments: [key])
    }
  }
  public func metadata(_ key: String, value: String) throws {
    try database.write { db in try Self.setMetadata(db, key, value) }
  }

  private static func setMetadata(_ db: Database, _ key: String, _ value: String) throws {
    try db.execute(
      sql: "INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      arguments: [key, value])
  }

  public enum StoreError: LocalizedError, Equatable {
    case unresolvedConflict, alreadySending, laterEdits, unknownType
    case recordRemoved, editChanged, invalidBatch
    case invalidTransfer, transferTooLong
    case missingTask, inactiveTask, blockedTask
    case unknownField(String)
    public var errorDescription: String? {
      switch self {
      case .unresolvedConflict: return "这条记录有未处理的冲突，请先选择保留哪个版本。"
      case .alreadySending: return "这次操作已经开始同步，结果确认后可再修改或移除。"
      case .laterEdits: return "请先撤销这条记录后续的待发送修改。"
      case .unknownType: return "收到了这个版本还不认识的记录类型，请更新 App。"
      case .recordRemoved: return "这条记录已被移除，草稿仍保留。"
      case .editChanged: return "另一台设备改过相同字段。请先对照当前版本，草稿仍保留。"
      case .unknownField(let name): return "未知字段：" + name
      case .invalidBatch: return "同一批修改需包含不同记录，且总数不能超限。"
      case .invalidTransfer: return "INVALID_TRANSFER"
      case .transferTooLong: return "TRANSFER_TOO_LONG"
      case .missingTask: return "这项任务已不存在。"
      case .inactiveTask: return "请先恢复待办。"
      case .blockedTask: return "请先完成前置任务。"
      }
    }
  }
}
