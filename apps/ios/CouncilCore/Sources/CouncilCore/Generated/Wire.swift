// Generated from packages/contracts/schema.ts by scripts/generate-contracts.ts. Do not edit.
import Foundation

/// One entity as the server confirmed it, or as this device currently projects it.
public struct Record: Codable, Sendable, Identifiable, Equatable {
  public var id: String
  public var type: String
  public var version: Int
  public var data: [String: JSONValue]
  public var deleted: Bool
  public var updatedAt: String
  public init(
    id: String, type: String, version: Int, data: [String: JSONValue], deleted: Bool,
    updatedAt: String
  ) {
    self.id = id
    self.type = type
    self.version = version
    self.data = data
    self.deleted = deleted
    self.updatedAt = updatedAt
  }
}
/// POST /v1/commands. `baseVersion` is the version this device edited; 0 creates.
public struct Command: Codable, Sendable, Equatable {
  public var operationId: String
  public var entityId: String
  public var entityType: String
  public var baseVersion: Int
  public var action: String
  public var data: [String: JSONValue]?
  public var occurredAt: String
  public var scope: SyncScope?
  public init(
    operationId: String, entityId: String, entityType: String, baseVersion: Int, action: String,
    data: [String: JSONValue]?, occurredAt: String, scope: SyncScope? = nil
  ) {
    self.operationId = operationId
    self.entityId = entityId
    self.entityType = entityType
    self.baseVersion = baseVersion
    self.action = action
    self.data = data
    self.occurredAt = occurredAt
    self.scope = scope
  }
}
public struct Receipt: Codable, Sendable {
  public var outcome: String
  public var entity: Record?
  public var current: Record?
  public var revision: String?
}
/// POST /v1/command-batches. Members apply in order under one receipt.
struct BatchCommand: Encodable, Sendable {
  static let maximum = 40
  let operationId: String
  let commands: [Member]
  let scope: SyncScope?

  struct Member: Encodable, Sendable {
    let entityId: String
    let entityType: String
    let baseVersion: Int
    let action: String
    let data: [String: JSONValue]?
    let occurredAt: String

    init(_ command: Command) {
      entityId = command.entityId
      entityType = command.entityType
      baseVersion = command.baseVersion
      action = command.action == "batch-delete" ? "delete" : "put"
      data = command.data
      occurredAt = command.occurredAt
    }
  }
}

struct BatchReceipt: Decodable, Sendable {
  let outcome: String
  let effects: [Receipt]?
  let entityId: String?
  let current: Record?
}

public struct Changes: Codable, Sendable {
  public struct Change: Codable, Sendable {
    public var revision: String
    public var entity: Record
  }
  public var changes: [Change]
  public var nextCursor: String
  public var hasMore: Bool
}
public struct SyncScope: Codable, Sendable, Equatable {
  public var datasetId: String
  public var generation: String
  public init(datasetId: String, generation: String) {
    self.datasetId = datasetId
    self.generation = generation
  }
}
public struct SyncDatasetState: Codable, Sendable, Equatable {
  public var datasetId: String
  public var generation: String
  public var watermark: String
  public var scopeRequired: Bool?
}
public struct SyncSnapshot: Codable, Sendable, Equatable {
  public var datasetId: String
  public var generation: String
  public var watermark: String
  public var snapshotId: String
  public var total: Int
  public var expiresAt: String
}
public struct SyncSnapshotPage: Codable, Sendable, Equatable {
  public var datasetId: String
  public var generation: String
  public var watermark: String
  public var snapshotId: String
  public var total: Int
  public var expiresAt: String
  public var records: [Record]
  public var nextPosition: String?
}

struct RecoveryRequest: Encodable, Sendable {
  static let pageSize = 10
  static let businessKeyTypes: Set<String> = ["budget", "metricLog", "habitLog", "checklistRun"]
  let scope: SyncScope
  let watermark: String
  let probes: [Probe]

  struct Probe: Encodable, Sendable {
    let operationId: String
    let entityType: String
    let entityId: String
    let creation: [String: JSONValue]?
    let command: Command?
    let batch: BatchCommand?
  }
}

struct RecoveryResponse: Decodable, Sendable {
  let matches: [Match]

  struct Match: Decodable, Sendable {
    let operationId: String
    let kind: String
    let entityId: String
    let version: Int?
  }
}
