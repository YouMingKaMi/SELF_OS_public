import Foundation

public struct ChecklistItem: Identifiable, Sendable, Equatable {
  public let id: String
  public var label: String

  public init(id: String, label: String) {
    self.id = id
    self.label = label
  }
}

public struct ChecklistState: Sendable {
  public let items: [ChecklistItem]
  public let checked: Set<String>
  public let ambiguous: Set<String>

  public func fields(checked: Set<String>) -> [String: JSONValue] {
    func array(_ values: [String]) -> JSONValue { .array(values.map(JSONValue.string)) }
    let selected = items.filter { checked.contains($0.id) }
    var seen = Set<String>()
    return [
      "itemIds": array(items.map(\.id)),
      "itemLabels": array(items.map(\.label)),
      "checkedItemIds": array(selected.map(\.id)),
      "checked": array(selected.map(\.label).filter { seen.insert($0).inserted }),
      "ambiguousChecked": array(ambiguous.sorted()),
    ]
  }
}

public enum ChecklistRules {
  public static func items(_ template: Record?) -> [ChecklistItem] {
    items(template?.data["items"]?.strings ?? [], template?.data["itemIds"]?.strings ?? [])
  }

  public static func state(_ template: Record?, run: Record?) -> ChecklistState {
    let entries: [ChecklistItem]
    if let labels = run?.data["itemLabels"]?.strings, let ids = run?.data["itemIds"]?.strings {
      entries = items(labels, ids)
    } else {
      entries = items(template)
    }
    var checked = Set(run?.data["checkedItemIds"]?.strings ?? [])
    var ambiguous = Set(run?.data["ambiguousChecked"]?.strings ?? [])
    if run?.data["checkedItemIds"]?.strings == nil {
      let byLabel = Dictionary(grouping: entries, by: \.label)
      for label in run?.data["checked"]?.strings ?? [] {
        if let matches = byLabel[label], matches.count == 1 {
          checked.insert(matches[0].id)
        } else {
          ambiguous.insert(label)
        }
      }
    }
    return ChecklistState(items: entries, checked: checked, ambiguous: ambiguous)
  }

  private static func items(_ labels: [String], _ ids: [String]) -> [ChecklistItem] {
    labels.enumerated().map { index, label in
      ChecklistItem(id: ids.indices.contains(index) ? ids[index] : "legacy:\(index)", label: label)
    }
  }
}
