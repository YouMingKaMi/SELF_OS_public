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
  public init(
    operationId: String, entityId: String, entityType: String, baseVersion: Int, action: String,
    data: [String: JSONValue]?, occurredAt: String
  ) {
    self.operationId = operationId
    self.entityId = entityId
    self.entityType = entityType
    self.baseVersion = baseVersion
    self.action = action
    self.data = data
    self.occurredAt = occurredAt
  }
}
public struct Receipt: Codable, Sendable {
  public var outcome: String
  public var entity: Record?
  public var current: Record?
  public var revision: String?
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
