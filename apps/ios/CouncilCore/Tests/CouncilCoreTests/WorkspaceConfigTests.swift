import XCTest

@testable import CouncilCore

@MainActor
final class WorkspaceConfigTests: XCTestCase {
  private struct Vectors: Decodable {
    struct AliasCase: Decodable {
      let raw: String?
      let parsed: [String: String]
      let canonical: String?
    }

    let presetEnabledFeatures: [String: [String]]
    let aliasCases: [AliasCase]

    static func load() throws -> Self {
      let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      let data = try Data(contentsOf: root.appendingPathComponent("fixtures/workspace-config-vectors.json"))
      return try JSONDecoder().decode(Self.self, from: data)
    }
  }

  func testPresetsAndFeatureVisibility() throws {
    let vectors = try Vectors.load()
    let features = WorkspaceRules.toggleableFeatures
    XCTAssertEqual(features, vectors.presetEnabledFeatures["council"])
    XCTAssertEqual(WorkspaceRules.aliasableFeatures, ["home", "departments", "discover"] + features)
    XCTAssertEqual(WorkspaceRules.builtinDepartments, ["执行部", "财政部", "档案库", "中科院"])
    for preset in [WorkspaceRules.Preset.council, .standard, .minimal] {
      let config = try XCTUnwrap(WorkspaceRules.presets[preset])
      XCTAssertEqual(features.filter { WorkspaceRules.isFeatureEnabled($0, config.disabledFeatures) },
        vectors.presetEnabledFeatures[preset.rawValue])
      XCTAssertEqual(config.hiddenDepartments, [])
      let unordered = Array((config.disabledFeatures + config.disabledFeatures).reversed())
      XCTAssertEqual(WorkspaceRules.detectWorkspacePreset(unordered, []), preset)
    }
    XCTAssertEqual(WorkspaceRules.detectWorkspacePreset(), .council)
    XCTAssertEqual(WorkspaceRules.detectWorkspacePreset([], ["财政部", "财政部"]), .custom)
    XCTAssertEqual(WorkspaceRules.detectWorkspacePreset(["tasks"]), .custom)
    XCTAssertEqual(WorkspaceRules.detectWorkspacePreset(["future-module"]), .custom)
    let core = ["home", "departments", "discover", "settings"]
    for key in core {
      XCTAssertTrue(WorkspaceRules.isFeatureEnabled(key, core))
    }
    XCTAssertTrue(WorkspaceRules.isFeatureEnabled("future-module"))
    XCTAssertTrue(WorkspaceRules.isFeatureEnabled("future-module", features))
    XCTAssertFalse(WorkspaceRules.isFeatureEnabled("treasury", features))
  }

  func testAliasVectorsAndRoundTrip() throws {
    for vector in try Vectors.load().aliasCases {
      XCTAssertEqual(WorkspaceRules.parseAliasMap(vector.raw), vector.parsed, vector.raw ?? "")
      XCTAssertEqual(WorkspaceRules.stringifyAliasMap(vector.parsed), vector.canonical)
      XCTAssertEqual(WorkspaceRules.parseAliasMap(vector.canonical), vector.parsed)
    }
    XCTAssertEqual(WorkspaceRules.stringifyAliasMap(["home": "  首页\n", "notes": "\t"]),
      #"{"home":"首页"}"#)
    XCTAssertNil(WorkspaceRules.stringifyAliasMap(["home": " "]))
  }

  func testWorkspaceFieldsStoreRoundTripAndPatchClear() async throws {
    let store = try CouncilStore(path: ":memory:")
    let type = WorkspaceConfigFields.entityType
    let id = WorkspaceRules.workspaceConfigID
    XCTAssertEqual(id, "c0000000-0000-4000-8000-000000000001")
    let emptyStore = try await store.record(type: type, id: id)
    XCTAssertNil(emptyStore)

    var fields = WorkspaceConfigFields(
      preset: "custom", disabledFeatures: ["reading", "storage"],
      featureAliases: #"{"treasury":"资产账户"}"#, hiddenDepartments: ["档案库"],
      departmentAliases: #"{"财政部":"预算"}"#,
      sidebarFavorites: ["expenses"], phoneShortcuts: ["tasks"], homeCards: ["habits"])
    let savedID = try await store.put(type: type, data: fields.data, id: id)
    XCTAssertEqual(savedID, id)
    let saved = try await store.record(type: type, id: id)
    let original = try XCTUnwrap(saved)
    XCTAssertEqual(WorkspaceConfigFields(original), fields)
    let wireRecord = try JSONDecoder().decode(Record.self, from: JSONEncoder().encode(original))
    XCTAssertEqual(WorkspaceConfigFields(wireRecord), fields)

    fields.featureAliases = nil
    fields.departmentAliases = nil
    try await store.put(type: type, data: fields.data, id: id, editBase: original)
    let afterClear = try await store.record(type: type, id: id)
    let cleared = try XCTUnwrap(afterClear)
    XCTAssertEqual(WorkspaceConfigFields(cleared), fields)

    let defaults = WorkspaceConfigFields()
    try await store.put(type: type, data: defaults.data, id: id, editBase: cleared)
    let afterReset = try await store.record(type: type, id: id)
    let reset = try XCTUnwrap(afterReset)
    XCTAssertTrue(reset.data.isEmpty)
    XCTAssertEqual(WorkspaceConfigFields(reset), defaults)
    XCTAssertEqual(WorkspaceRules.detectWorkspacePreset(defaults.disabledFeatures, defaults.hiddenDepartments), .council)

    let operations = try await store.operations()
    let patches = try operations.dropFirst().map { try JSONDecoder().decode(Command.self, from: $0.data) }
    XCTAssertEqual(patches.map(\.action), ["patch", "patch"])
    XCTAssertEqual(patches.map(\.entityId), [id, id])
    XCTAssertEqual(patches.first?.data, ["featureAliases": .null, "departmentAliases": .null])
    XCTAssertEqual(patches.last?.data, [
      "preset": .null, "disabledFeatures": .null, "hiddenDepartments": .null,
      "sidebarFavorites": .null, "phoneShortcuts": .null, "homeCards": .null,
    ])
  }
}
