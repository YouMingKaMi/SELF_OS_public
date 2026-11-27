import CouncilCore
import SwiftUI

extension WorkspaceRules.Preset {
  var title: String {
    switch self {
    case .council: "个人内阁"
    case .standard: "常规生活"
    case .minimal: "极简起步"
    case .custom: "自定义"
    }
  }

  var badge: String {
    switch self {
    case .council: "全部 19 模块"
    case .standard: "精选 9 模块"
    case .minimal: "核心 5 模块"
    case .custom: "已自定义"
    }
  }

  var subtitle: String {
    switch self {
    case .council: "作者完整配置：开启全部模块与四大部门，零删减。"
    case .standard: "保留任务、习惯、花销、编年史、想法、资料笔记、重要日子、储物箱、成就。"
    case .minimal: "只留任务、习惯、花销、编年史、资料笔记，开箱最轻盈。"
    case .custom: "按个人偏好单独勾选模块与部门。"
    }
  }
}

extension Studio {
  var workspaceConfigRecord: Record? {
    let rows = all("workspaceConfig")
    return rows.first { $0.id == WorkspaceRules.workspaceConfigID } ?? rows.first
  }

  var disabledFeatures: [String] {
    workspaceConfigRecord?.data["disabledFeatures"]?.strings ?? []
  }

  var hiddenDepartments: [String] {
    workspaceConfigRecord?.data["hiddenDepartments"]?.strings ?? []
  }

  var featureAliases: [String: String] {
    WorkspaceRules.parseAliasMap(workspaceConfigRecord?.data["featureAliases"]?.text)
  }

  var departmentAliases: [String: String] {
    WorkspaceRules.parseAliasMap(workspaceConfigRecord?.data["departmentAliases"]?.text)
  }

  var workspacePreset: WorkspaceRules.Preset {
    WorkspaceRules.detectWorkspacePreset(disabledFeatures, hiddenDepartments)
  }

  var enabledFeatureCount: Int {
    WorkspaceRules.toggleableFeatures.filter { isFeatureEnabled($0) }.count
  }

  func isFeatureEnabled(_ key: String) -> Bool {
    WorkspaceRules.isFeatureEnabled(key, disabledFeatures)
  }

  func isFeatureEnabled(_ feature: Feature) -> Bool {
    isFeatureEnabled(feature.rawValue)
  }

  func featureName(_ feature: Feature) -> String {
    featureAliases[feature.rawValue] ?? feature.name
  }

  func departmentName(_ rawName: String) -> String {
    departmentAliases[rawName] ?? rawName
  }

  func isDepartmentVisible(_ rawName: String) -> Bool {
    !hiddenDepartments.contains(rawName)
  }

  private func saveWorkspaceConfig(_ nextData: [String: JSONValue]) async {
    if let existing = workspaceConfigRecord {
      _ = await save("workspaceConfig", nextData, id: existing.id, editBase: existing)
    } else {
      _ = await save("workspaceConfig", nextData, id: WorkspaceRules.workspaceConfigID)
    }
  }

  func applyWorkspacePreset(_ preset: WorkspaceRules.Preset) async {
    guard let def = WorkspaceRules.presets[preset] else { return }
    var data = workspaceConfigRecord?.data ?? [:]
    data["preset"] = .string(preset.rawValue)
    data["disabledFeatures"] = .array(def.disabledFeatures.map(JSONValue.string))
    data["hiddenDepartments"] = .array(def.hiddenDepartments.map(JSONValue.string))
    await saveWorkspaceConfig(data)
  }

  func toggleWorkspaceFeature(_ key: String) async {
    guard WorkspaceRules.toggleableFeatures.contains(key) else { return }
    var next = Set(disabledFeatures)
    if next.contains(key) { next.remove(key) } else { next.insert(key) }
    let list = WorkspaceRules.toggleableFeatures.filter { next.contains($0) }
    let preset = WorkspaceRules.detectWorkspacePreset(list, hiddenDepartments)
    var data = workspaceConfigRecord?.data ?? [:]
    data["preset"] = .string(preset.rawValue)
    data["disabledFeatures"] = .array(list.map(JSONValue.string))
    await saveWorkspaceConfig(data)
  }

  func toggleWorkspaceDepartment(_ name: String) async {
    guard WorkspaceRules.builtinDepartments.contains(name) else { return }
    var next = Set(hiddenDepartments)
    if next.contains(name) { next.remove(name) } else { next.insert(name) }
    let list = WorkspaceRules.builtinDepartments.filter { next.contains($0) }
    let preset = WorkspaceRules.detectWorkspacePreset(disabledFeatures, list)
    var data = workspaceConfigRecord?.data ?? [:]
    data["preset"] = .string(preset.rawValue)
    data["hiddenDepartments"] = .array(list.map(JSONValue.string))
    await saveWorkspaceConfig(data)
  }

  func setWorkspaceAliases(features: [String: String], departments: [String: String]) async {
    var cleanFeatures: [String: String] = [:]
    for f in Feature.allCases {
      let raw = (features[f.rawValue] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      let clamped = String(raw.prefix(40))
      if !clamped.isEmpty && clamped != f.name {
        cleanFeatures[f.rawValue] = clamped
      }
    }
    var cleanDepts: [String: String] = [:]
    for name in WorkspaceRules.builtinDepartments {
      let raw = (departments[name] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      let clamped = String(raw.prefix(40))
      if !clamped.isEmpty && clamped != name {
        cleanDepts[name] = clamped
      }
    }
    var data = workspaceConfigRecord?.data ?? [:]
    if let encoded = WorkspaceRules.stringifyAliasMap(cleanFeatures) {
      data["featureAliases"] = .string(encoded)
    } else {
      data.removeValue(forKey: "featureAliases")
    }
    if let encoded = WorkspaceRules.stringifyAliasMap(cleanDepts) {
      data["departmentAliases"] = .string(encoded)
    } else {
      data.removeValue(forKey: "departmentAliases")
    }
    await saveWorkspaceConfig(data)
  }

  func resetWorkspaceAliases() async {
    var data = workspaceConfigRecord?.data ?? [:]
    data.removeValue(forKey: "featureAliases")
    data.removeValue(forKey: "departmentAliases")
    await saveWorkspaceConfig(data)
  }
}

struct WorkspaceConfigScreen: View {
  @Environment(Studio.self) private var studio
  private let presets: [WorkspaceRules.Preset] = [.council, .standard, .minimal]

  var body: some View {
    let activePreset = studio.workspacePreset
    let aliasCount = studio.featureAliases.count + studio.departmentAliases.count

    Form {
      Section {
        ForEach(presets, id: \.self) { preset in
          Button {
            Task { await studio.applyWorkspacePreset(preset) }
          } label: {
            HStack(alignment: .top, spacing: 10) {
              VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                  Text(preset.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Ink.text)
                  Text(preset.badge)
                    .font(.system(size: 11))
                    .foregroundStyle(Ink.text3)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(Ink.card, in: Capsule())
                }
                Text(preset.subtitle)
                  .font(.system(size: 12))
                  .foregroundStyle(Ink.text3)
                  .fixedSize(horizontal: false, vertical: true)
              }
              Spacer(minLength: 8)
              if activePreset == preset {
                Image(systemName: "checkmark.circle.fill")
                  .foregroundStyle(Ink.text)
                  .font(.system(size: 18))
              } else {
                Image(systemName: "circle")
                  .foregroundStyle(Ink.text3)
                  .font(.system(size: 18))
              }
            }
            .padding(.vertical, 2)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .listRowBackground(Ink.raised)
        }
      } header: {
        Text("一键预设（跨端自动同步）")
      } footer: {
        Text("关闭模块只会隐藏入口，不会删除任何历史数据，随时可重新打开。")
      }

      Section {
        NavigationLink {
          WorkspaceAliasesScreen()
        } label: {
          HStack {
            Label("自定义模块与部门名称", systemImage: "textformat")
              .foregroundStyle(Ink.text)
            Spacer()
            Text(aliasCount > 0 ? "已自定义 \(aliasCount) 项" : "默认原名")
              .font(.system(size: 13))
              .foregroundStyle(Ink.text3)
          }
        }
        .listRowBackground(Ink.raised)
      } header: {
        Text("命名定制")
      }

      Section("内置部门显示") {
        ForEach(WorkspaceRules.builtinDepartments, id: \.self) { dept in
          Toggle(isOn: Binding(
            get: { studio.isDepartmentVisible(dept) },
            set: { _ in Task { await studio.toggleWorkspaceDepartment(dept) } }
          )) {
            let shown = studio.departmentName(dept)
            VStack(alignment: .leading, spacing: 2) {
              Text(shown).foregroundStyle(Ink.text)
              if shown != dept {
                Text("原名：\(dept)").font(.system(size: 11)).foregroundStyle(Ink.text3)
              }
            }
          }
          .listRowBackground(Ink.raised)
        }
      }

      Section("功能模块开关（已启用 \(studio.enabledFeatureCount)/\(Feature.allCases.count)）") {
        ForEach(Feature.allCases) { f in
          Toggle(isOn: Binding(
            get: { studio.isFeatureEnabled(f) },
            set: { _ in Task { await studio.toggleWorkspaceFeature(f.rawValue) } }
          )) {
            let shown = studio.featureName(f)
            HStack(spacing: 10) {
              Image(systemName: f.symbol)
                .font(.system(size: 15))
                .foregroundStyle(studio.isFeatureEnabled(f) ? Ink.text2 : Ink.text3)
                .frame(width: 22)
              VStack(alignment: .leading, spacing: 1) {
                Text(shown)
                  .foregroundStyle(studio.isFeatureEnabled(f) ? Ink.text : Ink.text3)
                if shown != f.name {
                  Text("原名：\(f.name)")
                    .font(.system(size: 11))
                    .foregroundStyle(Ink.text3)
                }
              }
            }
          }
          .listRowBackground(Ink.raised)
        }
      }
    }
    .scrollContentBackground(.hidden)
    .background(Ink.card)
    .navigationTitle("工作区定制")
    .navigationBarTitleDisplayMode(.inline)
  }
}

struct WorkspaceAliasesScreen: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  @State private var featureDrafts: [String: String] = [:]
  @State private var deptDrafts: [String: String] = [:]
  @State private var loaded = false
  @State private var saving = false

  var body: some View {
    Form {
      Section {
        ForEach(WorkspaceRules.builtinDepartments, id: \.self) { dept in
          HStack(spacing: 10) {
            Text(dept)
              .font(.system(size: 14))
              .foregroundStyle(Ink.text2)
              .frame(width: 72, alignment: .leading)
            TextField("留空使用原名", text: Binding(
              get: { deptDrafts[dept] ?? "" },
              set: { deptDrafts[dept] = $0 }
            ))
            .multilineTextAlignment(.trailing)
          }
          .listRowBackground(Ink.raised)
        }
      } header: {
        Text("内置部门名称")
      }

      Section {
        ForEach(Feature.allCases) { f in
          HStack(spacing: 10) {
            Image(systemName: f.symbol)
              .font(.system(size: 14))
              .foregroundStyle(Ink.text3)
              .frame(width: 20)
            Text(f.name)
              .font(.system(size: 14))
              .foregroundStyle(Ink.text2)
              .lineLimit(1)
            TextField("留空用原名", text: Binding(
              get: { featureDrafts[f.rawValue] ?? "" },
              set: { featureDrafts[f.rawValue] = $0 }
            ))
            .multilineTextAlignment(.trailing)
          }
          .listRowBackground(Ink.raised)
        }
      } header: {
        Text("功能模块名称")
      } footer: {
        Text("自定义名称会同步到 Mac、Web 与 iPhone；清空任意一项即可恢复默认原名。")
      }

      if !studio.featureAliases.isEmpty || !studio.departmentAliases.isEmpty {
        Section {
          Button("恢复全部默认原名", role: .destructive) {
            Task {
              await studio.resetWorkspaceAliases()
              featureDrafts = [:]
              deptDrafts = [:]
            }
          }
          .listRowBackground(Ink.raised)
        }
      }
    }
    .scrollContentBackground(.hidden)
    .background(Ink.card)
    .navigationTitle("自定义名称")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        Button("保存") {
          guard !saving else { return }
          saving = true
          Task {
            defer { saving = false }
            await studio.setWorkspaceAliases(features: featureDrafts, departments: deptDrafts)
            dismiss()
          }
        }
        .fontWeight(.semibold)
        .disabled(saving)
      }
    }
    .onAppear {
      guard !loaded else { return }
      loaded = true
      featureDrafts = studio.featureAliases
      deptDrafts = studio.departmentAliases
    }
  }
}
