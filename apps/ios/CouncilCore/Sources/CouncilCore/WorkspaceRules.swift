import Foundation

public enum WorkspaceRules {
  public static let workspaceConfigID = "c0000000-0000-4000-8000-000000000001"

  public static let toggleableFeatures = [
    "practice", "tasks", "achievements", "habits", "ideas", "reading", "checklists",
    "thoughts", "expenses", "treasury", "freedom", "chronicle", "memoir", "storage",
    "raw", "monthly", "metrics", "days", "notes",
  ]

  private static let aliasableCore = ["home", "departments", "discover"]
  private static let coreFeatures = Set(aliasableCore + ["settings"])
  public static let aliasableFeatures = aliasableCore + toggleableFeatures
  public static let builtinDepartments = ["执行部", "财政部", "档案库", "中科院"]

  public enum Preset: String, CaseIterable, Sendable {
    case council, standard, minimal, custom
  }

  public struct PresetConfig: Sendable {
    public let disabledFeatures: [String]
    public let hiddenDepartments: [String]
  }

  public static let presets: [Preset: PresetConfig] = [
    .council: PresetConfig(disabledFeatures: [], hiddenDepartments: []),
    .standard: PresetConfig(
      disabledFeatures: [
        "practice", "reading", "checklists", "thoughts", "treasury", "freedom",
        "memoir", "raw", "monthly", "metrics",
      ], hiddenDepartments: []),
    .minimal: PresetConfig(
      disabledFeatures: [
        "practice", "achievements", "ideas", "reading", "checklists", "thoughts",
        "treasury", "freedom", "memoir", "storage", "raw", "monthly", "metrics", "days",
      ], hiddenDepartments: []),
  ]

  // ECMAScript String.trim whitespace, including BOM and excluding NEL.
  private static let aliasWhitespace = CharacterSet(charactersIn:
    "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}\u{00A0}\u{1680}\u{2000}\u{2001}\u{2002}"
    + "\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{2028}\u{2029}\u{202F}"
    + "\u{205F}\u{3000}\u{FEFF}")

  public static func parseAliasMap(_ raw: String?) -> [String: String] {
    // Foundation accepts BOM and trailing commas, which JSON.parse rejects.
    guard let raw, raw.unicodeScalars.first?.value != 0xFEFF else { return [:] }
    let tokens = #/"(?:[^"\\]|\\[\s\S])*"|(,[ \t\r\n]*[}\]])/#.matchingSemantics(.unicodeScalar)
    guard !raw.matches(of: tokens).contains(where: { $0.output.1 != nil }),
      let object = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any]
    else { return [:] }
    return object.compactMapValues { value in
      guard let value = value as? String else { return nil }
      let alias = value.trimmingCharacters(in: aliasWhitespace)
      return alias.isEmpty ? nil : alias
    }
  }

  public static func stringifyAliasMap(_ map: [String: String]) -> String? {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    let keys = map.keys.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) }
    let pairs = try? keys.compactMap { key -> String? in
      guard let value = map[key] else { return nil }
      let alias = value.trimmingCharacters(in: aliasWhitespace)
      guard !alias.isEmpty else { return nil }
      let encodedKey = String(decoding: try encoder.encode(key), as: UTF8.self)
      let encodedAlias = String(decoding: try encoder.encode(alias), as: UTF8.self)
      return encodedKey + ":" + encodedAlias
    }
    guard let pairs, !pairs.isEmpty else { return nil }
    return "{" + pairs.joined(separator: ",") + "}"
  }

  public static func detectWorkspacePreset(
    _ disabledFeatures: [String]? = nil, _ hiddenDepartments: [String]? = nil
  ) -> Preset {
    let disabled = Set(disabledFeatures ?? [])
    let hidden = Set(hiddenDepartments ?? [])
    for preset in Preset.allCases {
      guard let config = presets[preset] else { continue }
      if disabled == Set(config.disabledFeatures), hidden == Set(config.hiddenDepartments) {
        return preset
      }
    }
    return .custom
  }

  public static func isFeatureEnabled(_ key: String, _ disabledFeatures: [String]? = nil) -> Bool {
    coreFeatures.contains(key) || disabledFeatures?.contains(key) != true
  }
}
