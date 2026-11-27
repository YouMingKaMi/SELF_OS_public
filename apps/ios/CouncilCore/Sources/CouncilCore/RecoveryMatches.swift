import Foundation

/// Store operations arrive in sequence order. A batch is one indivisible intent.
struct RecoveryIntents {
  private let groups: [(id: String, members: [PendingOperation])]
  private let countByEntity: [String: Int]
  private let decoder = JSONDecoder()

  init(_ operations: [PendingOperation]) {
    var indices: [String: Int] = [:]
    var groups: [(id: String, members: [PendingOperation])] = []
    var counts: [String: Int] = [:]
    for op in operations {
      let id = op.batchId ?? op.id
      if let index = indices[id] {
        groups[index].members.append(op)
      } else {
        indices[id] = groups.count
        groups.append((id, [op]))
      }
      counts[op.entityId, default: 0] += 1
    }
    self.groups = groups
    self.countByEntity = counts
  }

  private func eligible(_ members: [PendingOperation]) -> Bool {
    members.allSatisfy { $0.state == "queued" || $0.state == "sending" }
      && (members[0].batchId == nil || members.count >= 2)
  }

  private func creation(_ op: PendingOperation) -> [String: JSONValue]? {
    guard op.batchId == nil, countByEntity[op.entityId] == 1,
      RecoveryRequest.businessKeyTypes.contains(op.entityType),
      let command = try? decoder.decode(Command.self, from: op.data),
      command.action == "put", command.baseVersion == 0
    else { return nil }
    return command.data
  }

  func probes(scope: SyncScope?) -> [RecoveryRequest.Probe] {
    groups.compactMap { id, members -> RecoveryRequest.Probe? in
      guard eligible(members), let anchor = members.last else { return nil }
      let candidate = creation(anchor)
      var command: Command?
      var batch: BatchCommand?
      if members.allSatisfy({ $0.state == "sending" }) {
        if anchor.batchId == nil {
          command = try? decoder.decode(Command.self, from: anchor.data)
          command?.scope = scope
        } else if let commands = try? members.map({ try decoder.decode(Command.self, from: $0.data) }) {
          batch = BatchCommand(operationId: id, commands: commands.map(BatchCommand.Member.init), scope: scope)
        }
      }
      guard command != nil || batch != nil || candidate != nil else { return nil }
      return .init(operationId: id, entityType: anchor.entityType, entityId: anchor.entityId,
        creation: candidate, command: command, batch: batch)
    }
  }

  /// Require matching staged rows and keep later intents blocked behind unresolved predecessors.
  func settled(
    _ matches: [String: RecoveryResponse.Match], staged: (String) throws -> Record?
  ) throws -> Set<String> {
    var matched: Set<String> = []
    var blocked: Set<String> = []
    for (id, members) in groups {
      let verified: Bool
      if let match = matches[id], let anchor = members.last,
        eligible(members), !members.contains(where: { blocked.contains($0.entityId) }) {
        switch match.kind {
        case "receipt" where match.entityId == anchor.entityId && members.allSatisfy({ $0.state == "sending" }):
          verified = try members.allSatisfy { op in
            let command = try decoder.decode(Command.self, from: op.data)
            guard let record = try staged(op.entityId) else { return false }
            return record.type == op.entityType && record.version > command.baseVersion
          }
        case "businessKey" where creation(anchor) != nil:
          if let row = try staged(match.entityId), let version = match.version,
            row.type == anchor.entityType, !row.deleted, row.version == version {
            verified = try match.entityId == anchor.entityId ||
              (countByEntity[match.entityId] == nil && staged(anchor.entityId) == nil)
          } else {
            verified = false
          }
        default:
          verified = false
        }
      } else {
        verified = false
      }
      if verified { matched.formUnion(members.map(\.id)) }
      else { blocked.formUnion(members.map(\.entityId)) }
    }
    return matched
  }
}
