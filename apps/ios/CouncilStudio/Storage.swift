import CouncilCore
import SwiftUI

enum StorageBoxIcon: String, CaseIterable, Identifiable {
  case chest, drawer, bag, box, suitcase, tools, medkit, folder

  var id: String { rawValue }

  var label: String {
    switch self {
    case .chest: "储物箱"
    case .drawer: "抽屉"
    case .bag: "背包"
    case .box: "收纳盒"
    case .suitcase: "行李箱"
    case .tools: "工具数码"
    case .medkit: "医药箱"
    case .folder: "证件袋"
    }
  }

  var symbol: String {
    switch self {
    case .chest: "shippingbox"
    case .drawer: "tray.2"
    case .bag: "backpack"
    case .box: "archivebox"
    case .suitcase: "suitcase"
    case .tools: "wrench.and.screwdriver"
    case .medkit: "cross.case"
    case .folder: "folder"
    }
  }

  static func from(_ raw: String) -> StorageBoxIcon {
    StorageBoxIcon(rawValue: raw) ?? .chest
  }
}

private struct FlatBoxOption: Identifiable {
  let box: Record
  let depth: Int
  let path: String
  let fullLabel: String
  var id: String { box.id }
}

private enum StorageHelpers {
  static let defaultZones = ["随身", "宿舍", "家里"]

  static func isoNow() -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: Date())
  }

  static func elapsed(_ iso: String) -> (text: String, stale: Bool) {
    guard !iso.isEmpty, let date = Clock.parse(iso) else { return ("已取出", false) }
    let seconds = max(0, Date().timeIntervalSince(date))
    let mins = Int(seconds / 60)
    if mins < 1 { return ("刚刚取出", false) }
    if mins < 60 { return ("\(mins) 分钟前取出", false) }
    let hours = mins / 60
    if hours < 24 { return ("\(hours) 小时前取出", hours >= 12) }
    let days = hours / 24
    return ("\(days) 天前取出", true)
  }

  static func sortBoxes(_ boxes: [Record]) -> [Record] {
    boxes.sorted { a, b in
      let za = a.text("zone")
      let zb = b.text("zone")
      let ia = defaultZones.firstIndex(of: za) ?? 99
      let ib = defaultZones.firstIndex(of: zb) ?? 99
      if ia != ib { return ia < ib }
      if za != zb { return za.localizedStandardCompare(zb) == .orderedAscending }
      let oa = a.data["order"]?.numberValue ?? Double.greatestFiniteMagnitude
      let ob = b.data["order"]?.numberValue ?? Double.greatestFiniteMagnitude
      if oa != ob { return oa < ob }
      return a.text("name").localizedStandardCompare(b.text("name")) == .orderedAscending
    }
  }

  static func rootBoxes(_ boxes: [Record], map: [String: Record]) -> [Record] {
    boxes.filter { b in
      let pid = b.text("parentId")
      return pid.isEmpty || map[pid] == nil
    }
  }

  static func children(of parentId: String, in boxes: [Record]) -> [Record] {
    boxes.filter { $0.text("parentId") == parentId }
  }

  static func root(of boxId: String, map: [String: Record]) -> Record? {
    var cur = map[boxId]
    var seen = Set<String>()
    while let node = cur, seen.insert(node.id).inserted {
      let pid = node.text("parentId")
      guard !pid.isEmpty, let parent = map[pid] else { return node }
      cur = parent
    }
    return cur
  }

  static func boxPath(_ boxId: String, map: [String: Record]) -> String {
    guard !boxId.isEmpty else { return "未指定箱子" }
    var parts: [String] = []
    var cur = map[boxId]
    var seen = Set<String>()
    while let node = cur, seen.insert(node.id).inserted {
      parts.insert(node.text("name"), at: 0)
      let pid = node.text("parentId")
      cur = pid.isEmpty ? nil : map[pid]
    }
    return parts.isEmpty ? "未知箱子" : parts.joined(separator: " / ")
  }

  static func fullLabel(_ boxId: String, map: [String: Record]) -> String {
    guard !boxId.isEmpty else { return "未指定箱子" }
    let rootBox = root(of: boxId, map: map)
    let zone = rootBox?.text("zone") ?? ""
    let path = boxPath(boxId, map: map)
    return zone.isEmpty ? path : "\(zone) · \(path)"
  }

  static func subtreeIDs(of rootId: String, boxes: [Record]) -> [String] {
    var out: [String] = []
    var queue = [rootId]
    var seen = Set<String>()
    while !queue.isEmpty {
      let id = queue.removeFirst()
      guard seen.insert(id).inserted else { continue }
      out.append(id)
      for child in boxes where child.text("parentId") == id {
        queue.append(child.id)
      }
    }
    return out
  }

  static func flatOptions(_ boxes: [Record], map: [String: Record]) -> [FlatBoxOption] {
    var result: [FlatBoxOption] = []
    var seen = Set<String>()
    func visit(_ box: Record, depth: Int) {
      guard seen.insert(box.id).inserted else { return }
      result.append(
        FlatBoxOption(
          box: box,
          depth: depth,
          path: boxPath(box.id, map: map),
          fullLabel: fullLabel(box.id, map: map)
        )
      )
      for child in children(of: box.id, in: boxes) {
        visit(child, depth: depth + 1)
      }
    }
    for root in rootBoxes(boxes, map: map) { visit(root, depth: 0) }
    return result
  }

  static func quantity(of item: Record) -> Int {
    if let n = item.data["quantity"]?.numberValue { return max(1, Int(n)) }
    return 1
  }
}

struct StorageScreen: View {
  @Environment(Studio.self) private var studio
  @State private var query = ""
  @State private var zoneFilter: String? = nil
  @State private var addingBox = false
  @State private var movingItem: Record?
  @State private var editingItem: Record?

  private var boxes: [Record] {
    StorageHelpers.sortBoxes(studio.all("storageBox"))
  }

  private var items: [Record] {
    studio.all("storageItem").sorted {
      $0.text("name").localizedStandardCompare($1.text("name")) == .orderedAscending
    }
  }

  private var boxByID: [String: Record] {
    Dictionary(uniqueKeysWithValues: boxes.map { ($0.id, $0) })
  }

  private var outItems: [Record] {
    items
      .filter { $0.text("status") == "out" }
      .sorted { $0.text("takenAt") < $1.text("takenAt") }
  }

  var body: some View {
    let allBoxes = boxes
    let map = boxByID
    let roots = StorageHelpers.rootBoxes(allBoxes, map: map)
    let zones: [String] = {
      var list: [String] = []
      for b in roots {
        let z = b.text("zone")
        if !z.isEmpty && !list.contains(z) { list.append(z) }
      }
      return list
    }()
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let searching = !q.isEmpty
    let searchHits: [Record] = searching ? items.filter { item in
      let bid = item.text("boxId")
      let homeId = item.text("homeBoxId")
      let hay = [
        item.text("name"),
        item.text("aliases"),
        item.text("note"),
        bid.isEmpty ? "" : StorageHelpers.fullLabel(bid, map: map),
        map[bid]?.text("location") ?? "",
        homeId.isEmpty ? "" : StorageHelpers.fullLabel(homeId, map: map),
      ].joined(separator: " ")
      return hay.localizedCaseInsensitiveContains(q)
    } : []

    List {
      if searching {
        Section {
          if searchHits.isEmpty {
            Text("没有找到记录——是不是还没放进储物箱？")
              .font(Ink.meta)
              .foregroundStyle(Ink.text3)
              .cardRow()
          } else {
            ForEach(searchHits) { item in
              searchHitRow(item, map: map)
            }
          }
        } header: {
          Text("找到 \(searchHits.count) 件")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Ink.text2)
            .textCase(nil)
        }
      } else {
        if !outItems.isEmpty {
          Section {
            ForEach(outItems) { item in
              outItemRow(item, map: map)
            }
          } header: {
            HStack {
              Text("在外未归位")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Ink.amber)
              Spacer()
              Text("\(outItems.count) 件 · 用完点归位")
                .font(Ink.meta)
                .foregroundStyle(Ink.text3)
            }
            .textCase(nil)
          }
        }

        if let zf = zoneFilter {
          Section {
            HStack {
              Text("当前场景：\(zf)")
                .font(Ink.meta)
                .foregroundStyle(Ink.text3)
              Spacer()
              Button("清除") { zoneFilter = nil }
                .font(Ink.meta)
                .foregroundStyle(Ink.text2)
                .buttonStyle(.plain)
            }
            .cardRow()
          }
        }

        if roots.isEmpty {
          Section {
            VStack(alignment: .leading, spacing: 10) {
              Text("先摆几个现实里的“箱子”")
                .font(Ink.title)
                .foregroundStyle(Ink.text)
              Text("先把装充电宝、耳机、数据线、证件的 2~3 个常用容器建起来，点进去还能再分区域/隔层。")
                .font(Ink.meta)
                .foregroundStyle(Ink.text3)
              VStack(spacing: 8) {
                starterButton(zone: "随身", name: "双肩包", icon: .bag, location: "可再分前小袋 / 中层 / 大袋")
                starterButton(zone: "宿舍", name: "书桌抽屉", icon: .drawer, location: "桌面数码与文具")
                starterButton(zone: "宿舍", name: "宿舍书架", icon: .chest, location: "可再分上层 / 下层 / 抽屉")
              }
              .padding(.top, 2)
            }
            .padding(.vertical, 6)
            .cardRow()
          }
        } else {
          let shownZones = zoneFilter.map { [$0] } ?? zones
          ForEach(shownZones, id: \.self) { zone in
            let zoneRoots = roots.filter { $0.text("zone") == zone }
            if !zoneRoots.isEmpty {
              Section {
                ForEach(zoneRoots) { box in
                  let subs = StorageHelpers.children(of: box.id, in: allBoxes)
                  let allIDs = Set(StorageHelpers.subtreeIDs(of: box.id, boxes: allBoxes))
                  let inside = items.filter { allIDs.contains($0.text("boxId")) }
                  NavigationLink {
                    StorageBoxDetailScreen(boxId: box.id)
                  } label: {
                    boxRow(box, subs: subs, inside: inside)
                  }
                  .cardRow()
                }
              } header: {
                HStack {
                  Text(zone)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Ink.text2)
                  Spacer()
                  Text("\(zoneRoots.count) 个箱子")
                    .font(Ink.meta)
                    .monospacedDigit()
                    .foregroundStyle(Ink.text3)
                }
                .textCase(nil)
              }
            }
          }
        }
      }
    }
    .studioList()
    .searchable(text: $query, prompt: "找什么？搜物品、别名、备注或箱子/分区…")
    .toolbar(.hidden, for: .tabBar)
    .studioScreen("储物箱")
    .toolbar {
      if zones.count > 1 {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            Button {
              zoneFilter = nil
            } label: {
              Label("全部场景", systemImage: zoneFilter == nil ? "checkmark" : "")
            }
            ForEach(zones, id: \.self) { z in
              Button {
                zoneFilter = z
              } label: {
                Label(z, systemImage: zoneFilter == z ? "checkmark" : "")
              }
            }
          } label: {
            Image(
              systemName: zoneFilter == nil
                ? "line.3.horizontal.decrease.circle"
                : "line.3.horizontal.decrease.circle.fill"
            )
          }
          .accessibilityLabel("筛选场景")
        }
      }
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          addingBox = true
        } label: {
          Image(systemName: "plus")
        }
        .accessibilityLabel("新建储物箱")
      }
    }
    .sheet(isPresented: $addingBox) {
      StorageBoxEditorSheet(box: nil, defaultParentId: nil, existingZones: zones)
    }
    .sheet(item: $movingItem) { item in
      StorageMoveSheet(item: item, boxes: allBoxes)
    }
    .sheet(item: $editingItem) { item in
      StorageItemEditorSheet(item: item, boxes: allBoxes)
    }
  }

  private func starterButton(zone: String, name: String, icon: StorageBoxIcon, location: String) -> some View {
    Button {
      Task {
        _ = await studio.save("storageBox", [
          "zone": .string(zone),
          "name": .string(name),
          "icon": .string(icon.rawValue),
          "location": .string(location),
        ])
      }
    } label: {
      HStack(spacing: 10) {
        Image(systemName: icon.symbol)
          .font(.system(size: 16))
          .foregroundStyle(Ink.text2)
          .frame(width: 28, height: 28)
          .background(Ink.raised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        VStack(alignment: .leading, spacing: 2) {
          Text("\(zone) · \(name)").font(Ink.row).foregroundStyle(Ink.text)
          Text(location).font(.system(size: 12)).foregroundStyle(Ink.text3)
        }
        Spacer()
        Image(systemName: "plus.circle").foregroundStyle(Ink.text3)
      }
      .padding(10)
      .background(Ink.bg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Ink.line))
    }
    .buttonStyle(.plain)
  }

  private func boxRow(_ box: Record, subs: [Record], inside: [Record]) -> some View {
    let icon = StorageBoxIcon.from(box.text("icon"))
    let storedCount = inside.filter { $0.text("status") != "out" }.count
    let outCount = inside.count - storedCount
    let preview: String = {
      if !subs.isEmpty {
        return subs.prefix(4).map { $0.text("name") }.joined(separator: " · ") + (subs.count > 4 ? " …" : "")
      }
      if inside.isEmpty { return "空箱子" }
      return inside.prefix(4).map { $0.text("name") }.joined(separator: " · ") + (inside.count > 4 ? " …" : "")
    }()

    return HStack(alignment: .top, spacing: 12) {
      Image(systemName: icon.symbol)
        .font(.system(size: 16, weight: .medium))
        .foregroundStyle(Ink.text2)
        .frame(width: 36, height: 36)
        .background(Ink.raised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Ink.line))

      VStack(alignment: .leading, spacing: 4) {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(box.text("name"))
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Ink.text)
            .lineLimit(1)
          Spacer(minLength: 4)
          Text(outCount > 0 ? "\(storedCount) 件 (+\(outCount)外)" : "\(storedCount) 件")
            .font(.system(size: 12))
            .monospacedDigit()
            .foregroundStyle(Ink.text3)
        }
        if !box.text("location").isEmpty {
          Text(box.text("location"))
            .font(.system(size: 12))
            .foregroundStyle(Ink.text3)
            .lineLimit(1)
        }
        Text(subs.isEmpty ? preview : "分区：\(preview)")
          .font(.system(size: 12))
          .foregroundStyle(inside.isEmpty && subs.isEmpty ? Ink.text3 : Ink.text2)
          .lineLimit(1)
      }
    }
    .padding(.vertical, 3)
  }

  private func outItemRow(_ item: Record, map: [String: Record]) -> some View {
    let elapsed = StorageHelpers.elapsed(item.text("takenAt"))
    let bid = item.text("boxId")
    let qty = StorageHelpers.quantity(of: item)
    return HStack(spacing: 10) {
      StorageItemGlyph(
        icon: item.text("icon"),
        name: item.text("name"),
        aliases: item.text("aliases"),
        boxPath: bid.isEmpty ? "" : StorageHelpers.boxPath(bid, map: map),
        size: 16,
        color: Ink.amber
      )
      .frame(width: 24)
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(item.text("name")).font(Ink.row).foregroundStyle(Ink.text).lineLimit(1)
          if qty > 1 {
            Text("×\(qty)").font(.system(size: 11, weight: .semibold)).monospacedDigit()
              .foregroundStyle(Ink.text3)
          }
        }
        Text(elapsed.text + (bid.isEmpty ? "" : " · 来自 \(StorageHelpers.boxPath(bid, map: map))"))
          .font(.system(size: 12))
          .foregroundStyle(elapsed.stale ? Ink.amber : Ink.text3)
          .lineLimit(1)
      }
      Spacer(minLength: 4)
      Button("归位") { returnHome(item, map: map) }
        .buttonStyle(.chip)
    }
    .contentShape(Rectangle())
    .onTapGesture { editingItem = item }
    .cardRow()
    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
      Button("移箱", systemImage: "arrow.left.arrow.right") { movingItem = item }
        .tint(Color(white: 0.42))
    }
  }

  private func searchHitRow(_ item: Record, map: [String: Record]) -> some View {
    let isOut = item.text("status") == "out"
    let bid = item.text("boxId")
    let homeId = item.text("homeBoxId")
    let away = !isOut && !homeId.isEmpty && homeId != bid
    let elapsed = StorageHelpers.elapsed(item.text("takenAt"))
    let qty = StorageHelpers.quantity(of: item)

    return HStack(spacing: 10) {
      StorageItemGlyph(
        icon: item.text("icon"),
        name: item.text("name"),
        aliases: item.text("aliases"),
        boxPath: bid.isEmpty ? "" : StorageHelpers.boxPath(bid, map: map),
        size: 17,
        color: isOut ? Ink.amber : Ink.text2
      )
      .frame(width: 26)
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 6) {
          Text(item.text("name"))
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Ink.text)
            .lineLimit(1)
          if qty > 1 {
            Text("×\(qty)").font(.system(size: 11, weight: .semibold)).monospacedDigit()
              .foregroundStyle(Ink.text3)
          }
        }
        if isOut {
          Text(elapsed.text + (bid.isEmpty ? "" : " · 原在 \(StorageHelpers.fullLabel(bid, map: map))"))
            .font(.system(size: 12))
            .foregroundStyle(elapsed.stale ? Ink.amber : Ink.text2)
            .lineLimit(1)
        } else if !bid.isEmpty {
          Text(
            StorageHelpers.fullLabel(bid, map: map)
              + (away ? "（常驻：\(StorageHelpers.boxPath(homeId, map: map))）" : "")
          )
          .font(.system(size: 12))
          .foregroundStyle(Ink.text2)
          .lineLimit(1)
        }
        if !item.text("note").isEmpty {
          Text(item.text("note")).font(.system(size: 12)).foregroundStyle(Ink.text3).lineLimit(1)
        }
      }
      Spacer(minLength: 4)
      Button(isOut ? "归位" : "取出") {
        if isOut { returnHome(item, map: map) } else { takeOut(item) }
      }
      .buttonStyle(.chip)
    }
    .contentShape(Rectangle())
    .onTapGesture { editingItem = item }
    .cardRow()
    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
      Button("移箱", systemImage: "arrow.left.arrow.right") { movingItem = item }
        .tint(Color(white: 0.42))
    }
  }

  private func takeOut(_ item: Record) {
    var data = item.data
    data["status"] = .string("out")
    data["takenAt"] = .string(StorageHelpers.isoNow())
    Task { _ = await studio.save("storageItem", data, id: item.id, editBase: item) }
  }

  private func returnHome(_ item: Record, map: [String: Record]) {
    let targetId = !item.text("homeBoxId").isEmpty ? item.text("homeBoxId") : item.text("boxId")
    guard !targetId.isEmpty, map[targetId] != nil else {
      movingItem = item
      return
    }
    var data = item.data
    data["status"] = .string("in_box")
    data["boxId"] = .string(targetId)
    data["takenAt"] = nil
    data["verifiedAt"] = .string(StorageHelpers.isoNow())
    Task { _ = await studio.save("storageItem", data, id: item.id, editBase: item) }
  }
}

private struct StorageMoveBatch: Identifiable {
  let id = UUID()
  let items: [Record]
}

struct StorageBoxDetailScreen: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let boxId: String
  @AppStorage("storage-ios-grid-mode") private var gridMode = true
  @State private var subFilterId: String = "all"
  @State private var quickTargetId: String = ""
  @State private var quickName = ""
  @State private var selectedItemId: String? = nil
  @State private var selecting = false
  @State private var selectedItemIDs: Set<String> = []
  @State private var dropTargetBoxId: String? = nil
  @State private var moveToast: String? = nil
  @State private var editingBox: Record?
  @State private var addingSub = false
  @State private var editingItem: Record?
  @State private var moveBatch: StorageMoveBatch?
  @State private var iconPickerItem: Record?
  @FocusState private var quickFocused: Bool

  private var allBoxes: [Record] {
    StorageHelpers.sortBoxes(studio.all("storageBox"))
  }

  private var boxByID: [String: Record] {
    Dictionary(uniqueKeysWithValues: allBoxes.map { ($0.id, $0) })
  }

  private var box: Record? {
    boxByID[boxId]
  }

  private var subBoxes: [Record] {
    StorageHelpers.children(of: boxId, in: allBoxes)
  }

  private var allItems: [Record] {
    studio.all("storageItem")
  }

  private func itemsIn(_ id: String) -> [Record] {
    allItems
      .filter { $0.text("boxId") == id }
      .sorted { a, b in
        let sa = a.text("status") == "out" ? 1 : 0
        let sb = b.text("status") == "out" ? 1 : 0
        if sa != sb { return sa < sb }
        return a.text("name").localizedStandardCompare(b.text("name")) == .orderedAscending
      }
  }

  private struct BoxSection: Identifiable {
    let box: Record
    let title: String
    let isLooseRoot: Bool
    let items: [Record]
    var id: String { box.id }
  }

  var body: some View {
    let current = box
    let subs = subBoxes
    let map = boxByID
    let sections: [BoxSection] = {
      guard let current else { return [] }
      if subs.isEmpty {
        return [BoxSection(box: current, title: "", isLooseRoot: false, items: itemsIn(current.id))]
      }
      if subFilterId != "all", let target = map[subFilterId] {
        return [BoxSection(box: target, title: "", isLooseRoot: target.id == current.id, items: itemsIn(target.id))]
      }
      var list: [BoxSection] = []
      let loose = itemsIn(current.id)
      if !loose.isEmpty {
        list.append(BoxSection(box: current, title: "未分区（主箱）", isLooseRoot: true, items: loose))
      }
      for sub in subs {
        list.append(BoxSection(box: sub, title: sub.text("name"), isLooseRoot: false, items: itemsIn(sub.id)))
      }
      return list
    }()
    let visibleItems = sections.flatMap(\.items)
    let boxAllItemCount = StorageHelpers.subtreeIDs(of: boxId, boxes: allBoxes)
      .reduce(0) { $0 + itemsIn($1).count }
    let selectedItem = selecting ? nil : selectedItemId.flatMap { id in visibleItems.first { $0.id == id } }
    let selectedRecords = allItems.filter { selectedItemIDs.contains($0.id) }
    let visibleIDSet = Set(visibleItems.map(\.id))
    let allVisibleSelected = !visibleIDSet.isEmpty && visibleIDSet.isSubset(of: selectedItemIDs)
    let resolvedQuickTargetId: String = {
      if subFilterId != "all", map[subFilterId] != nil { return subFilterId }
      if !quickTargetId.isEmpty, quickTargetId == boxId || subs.contains(where: { $0.id == quickTargetId }) {
        return quickTargetId
      }
      return subs.first?.id ?? boxId
    }()

    Group {
      if gridMode {
        ScrollView {
          VStack(alignment: .leading, spacing: 14) {
            if let current, !current.text("location").isEmpty {
              Text("\(current.text("zone")) · \(current.text("location"))")
                .font(Ink.meta)
                .foregroundStyle(Ink.text3)
            }
            if sections.allSatisfy({ $0.items.isEmpty }) && subs.isEmpty {
              Card {
                Text("这个箱子还是空的，在下方输入物品名称即可放入，或点上方「＋ 划分区域」分出隔层。")
                  .font(Ink.meta)
                  .foregroundStyle(Ink.text3)
              }
            } else {
              let cols = [
                GridItem(.flexible(), spacing: 9),
                GridItem(.flexible(), spacing: 9),
                GridItem(.flexible(), spacing: 9),
              ]
              ForEach(sections) { sec in
                let isDropTarget = dropTargetBoxId == sec.box.id && !subs.isEmpty
                let secIDs = Set(sec.items.map(\.id))
                let secAllChecked = !secIDs.isEmpty && secIDs.isSubset(of: selectedItemIDs)

                VStack(alignment: .leading, spacing: 8) {
                  if !sec.title.isEmpty {
                    HStack(spacing: 8) {
                      Text(sec.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(isDropTarget ? Ink.text : Ink.text2)
                      Text("\(sec.items.count) 件")
                        .font(Ink.meta)
                        .monospacedDigit()
                        .foregroundStyle(Ink.text3)
                      if isDropTarget {
                        Text("松手移入")
                          .font(.system(size: 11, weight: .semibold))
                          .foregroundStyle(Color.black)
                          .padding(.horizontal, 7)
                          .padding(.vertical, 2)
                          .background(Ink.text, in: Capsule())
                      }
                      Spacer()
                      if selecting && !sec.items.isEmpty {
                        Button(secAllChecked ? "取消本区" : "全选本区") {
                          if secAllChecked {
                            selectedItemIDs.subtract(secIDs)
                          } else {
                            selectedItemIDs.formUnion(secIDs)
                          }
                        }
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Ink.text2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 4)
                        .contentShape(Rectangle())
                        .buttonStyle(.plain)
                      } else if !sec.isLooseRoot {
                        Button("编辑") { editingBox = sec.box }
                          .font(.system(size: 12))
                          .foregroundStyle(Ink.text3)
                          .padding(.horizontal, 6)
                          .padding(.vertical, 4)
                          .contentShape(Rectangle())
                          .buttonStyle(.plain)
                      }
                    }
                  }
                  if sec.items.isEmpty {
                    HStack(spacing: 6) {
                      Image(systemName: isDropTarget ? "tray.and.arrow.down.fill" : "tray")
                        .font(.system(size: 12))
                      Text(isDropTarget ? "松手放入「\(sec.box.text("name"))」" : "空分区 · 可直接拖拽物品到这里，或点右上角「选择」批量移入")
                        .font(.system(size: 12))
                    }
                    .foregroundStyle(isDropTarget ? Ink.text : Ink.text3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 14)
                    .background(
                      isDropTarget ? Ink.raised : Ink.card.opacity(0.6),
                      in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                    )
                    .overlay(
                      RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(
                          isDropTarget ? Ink.text : Ink.line,
                          style: StrokeStyle(lineWidth: isDropTarget ? 1.4 : 1, dash: isDropTarget ? [] : [4, 3])
                        )
                    )
                  } else {
                    LazyVGrid(columns: cols, spacing: 9) {
                      ForEach(sec.items) { item in
                        compactGridSlot(
                          item,
                          containerBox: sec.box,
                          selected: selecting ? selectedItemIDs.contains(item.id) : selectedItemId == item.id,
                          map: map
                        )
                      }
                    }
                  }
                }
                .padding(isDropTarget ? 8 : 0)
                .background(
                  isDropTarget ? Ink.raised.opacity(0.45) : Color.clear,
                  in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
                .overlay(
                  RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(isDropTarget ? Ink.text.opacity(0.8) : Color.clear, lineWidth: 1.2)
                )
                .dropDestination(for: String.self) { payloads, _ in
                  handleDrop(payloads: payloads, into: sec.box.id, map: map)
                } isTargeted: { targeted in
                  withAnimation(.snappy(duration: 0.14)) {
                    if targeted {
                      dropTargetBoxId = sec.box.id
                    } else if dropTargetBoxId == sec.box.id {
                      dropTargetBoxId = nil
                    }
                  }
                }
              }
            }
          }
          .padding(.horizontal, 16)
          .padding(.vertical, 12)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Ink.bg)
      } else {
        List {
          ForEach(sections) { sec in
            let secIDs = Set(sec.items.map(\.id))
            let secAllChecked = !secIDs.isEmpty && secIDs.isSubset(of: selectedItemIDs)
            Section {
              ForEach(sec.items) { item in
                listRow(item, containerBox: sec.box, map: map)
              }
              if sec.items.isEmpty {
                Text("空分区 · 可直接拖拽物品到上方分区胶囊")
                  .font(Ink.meta)
                  .foregroundStyle(Ink.text3)
                  .cardRow()
              }
            } header: {
              HStack {
                Text(sec.title.isEmpty ? "\(sec.items.filter { $0.text("status") != "out" }.count) 件在箱内" : "\(sec.title) · \(sec.items.count) 件")
                  .font(.system(size: 13, weight: .semibold))
                  .foregroundStyle(Ink.text2)
                Spacer()
                if selecting && !sec.items.isEmpty {
                  Button(secAllChecked ? "取消本区" : "全选本区") {
                    if secAllChecked {
                      selectedItemIDs.subtract(secIDs)
                    } else {
                      selectedItemIDs.formUnion(secIDs)
                    }
                  }
                  .font(.system(size: 12, weight: .medium))
                  .foregroundStyle(Ink.text2)
                  .buttonStyle(.plain)
                } else if !sec.title.isEmpty && !sec.isLooseRoot {
                  Button("编辑") { editingBox = sec.box }
                    .font(.system(size: 12))
                    .foregroundStyle(Ink.text3)
                    .buttonStyle(.plain)
                }
              }
              .textCase(nil)
            }
          }
        }
        .studioList()
      }
    }
    .safeAreaInset(edge: .top, spacing: 0) {
      VStack(spacing: 0) {
        compartmentStrip(current: current, subs: subs, map: map)
          .padding(.horizontal, 16)
          .padding(.vertical, 8)
        if let moveToast {
          HStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
              .font(.system(size: 13))
              .foregroundStyle(Ink.live)
            Text(moveToast)
              .font(.system(size: 13, weight: .medium))
              .foregroundStyle(Ink.text)
            Spacer()
          }
          .padding(.horizontal, 16)
          .padding(.bottom, 8)
          .transition(.opacity.combined(with: .move(edge: .top)))
        }
      }
      .background(Ink.bg.opacity(0.96))
      .overlay(alignment: .bottom) { Hairline() }
    }
    .safeAreaInset(edge: .bottom, spacing: 0) {
      VStack(spacing: 0) {
        if selecting {
          batchActionBar(
            selectedRecords: selectedRecords,
            allVisibleSelected: allVisibleSelected,
            visibleIDSet: visibleIDSet,
            current: current,
            subs: subs,
            map: map
          )
        } else {
          if gridMode, let selectedItem {
            selectionActionBar(selectedItem, map: map)
          }
          quickAddBar(
            subs: subs,
            targetId: resolvedQuickTargetId,
            targetLabel: StorageHelpers.boxPath(resolvedQuickTargetId, map: map)
          )
        }
      }
    }
    .sensoryFeedback(.impact(weight: .light), trigger: dropTargetBoxId)
    .task(id: moveToast) {
      guard moveToast != nil else { return }
      try? await Task.sleep(for: .seconds(2.2))
      if !Task.isCancelled {
        withAnimation(.snappy(duration: 0.2)) { moveToast = nil }
      }
    }
    .toolbar(.hidden, for: .tabBar)
    .studioScreen(current?.text("name") ?? "储物箱")
    .toolbar {
      if selecting {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            if allVisibleSelected {
              selectedItemIDs.subtract(visibleIDSet)
            } else {
              selectedItemIDs.formUnion(visibleIDSet)
            }
          } label: {
            Image(systemName: allVisibleSelected ? "checklist.unchecked" : "checklist.checked")
          }
          .disabled(visibleIDSet.isEmpty)
          .accessibilityLabel(allVisibleSelected ? "取消全选" : "全选当前")
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            withAnimation(.snappy(duration: 0.16)) {
              selecting = false
              selectedItemIDs = []
            }
          } label: {
            Image(systemName: "checkmark")
          }
          .accessibilityLabel("完成选择")
        }
      } else {
        if boxAllItemCount > 0 {
          ToolbarItem(placement: .topBarTrailing) {
            Button {
              withAnimation(.snappy(duration: 0.16)) {
                selecting = true
                selectedItemId = nil
                selectedItemIDs = []
              }
            } label: {
              Image(systemName: "checkmark.circle")
            }
            .accessibilityLabel("多选批量整理")
          }
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            gridMode.toggle()
            selectedItemId = nil
          } label: {
            Image(systemName: gridMode ? "list.bullet" : "square.grid.2x2")
          }
          .accessibilityLabel(gridMode ? "切换为清单视图" : "切换为图标格视图")
        }
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            Button("划分新区域 / 子箱", systemImage: "plus.rectangle.on.folder") {
              addingSub = true
            }
            if let current {
              Button("编辑箱子", systemImage: "slider.horizontal.3") {
                editingBox = current
              }
            }
            if subFilterId != "all", subFilterId != boxId, let activeSub = map[subFilterId] {
              Button("编辑当前分区「\(activeSub.text("name"))」", systemImage: "pencil") {
                editingBox = activeSub
              }
            }
          } label: {
            Image(systemName: "ellipsis.circle")
          }
          .accessibilityLabel("箱子与分区选项")
        }
      }
    }
    .sheet(item: $editingBox) { target in
      let zones = Array(Set(allBoxes.map { $0.text("zone") }.filter { !$0.isEmpty })).sorted()
      StorageBoxEditorSheet(box: target, defaultParentId: nil, existingZones: zones) {
        if target.id == boxId {
          dismiss()
        } else if subFilterId == target.id {
          subFilterId = "all"
        }
      }
    }
    .sheet(isPresented: $addingSub) {
      let zones = Array(Set(allBoxes.map { $0.text("zone") }.filter { !$0.isEmpty })).sorted()
      StorageBoxEditorSheet(box: nil, defaultParentId: boxId, existingZones: zones)
    }
    .sheet(item: $editingItem) { item in
      StorageItemEditorSheet(item: item, boxes: allBoxes)
    }
    .sheet(item: $moveBatch) { batch in
      StorageMoveSheet(items: batch.items, boxes: allBoxes) { targetBoxId, movedCount in
        let label = StorageHelpers.boxPath(targetBoxId, map: map)
        withAnimation(.snappy(duration: 0.18)) {
          moveToast = "已移入「\(label)」（\(movedCount) 件）"
          if selecting {
            selectedItemIDs.subtract(batch.items.map(\.id))
            if selectedItemIDs.isEmpty { selecting = false }
          }
        }
      }
    }
    .sheet(item: $iconPickerItem) { item in
      StorageIconPickerSheet(
        itemName: item.text("name"),
        currentIcon: item.text("icon")
      ) { next in
        updateIcon(item, to: next)
      }
    }
  }

  private func compartmentStrip(current: Record?, subs: [Record], map: [String: Record]) -> some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        if !subs.isEmpty {
          Chip(text: "全部", selected: subFilterId == "all") {
            subFilterId = "all"
          }
          if let current {
            let looseCount = itemsIn(current.id).count
            if looseCount > 0 || dropTargetBoxId != nil {
              dropChip(
                text: looseCount > 0 ? "未分区 \(looseCount)" : "未分区",
                targetBoxId: current.id,
                selected: subFilterId == current.id,
                map: map
              ) {
                subFilterId = current.id
              }
            }
          }
          ForEach(subs) { sub in
            dropChip(
              text: "\(sub.text("name")) \(itemsIn(sub.id).count)",
              targetBoxId: sub.id,
              selected: subFilterId == sub.id,
              map: map
            ) {
              subFilterId = sub.id
            }
          }
        }
        Button {
          addingSub = true
        } label: {
          Label("划分区域", systemImage: "plus")
            .font(.system(size: 13))
            .foregroundStyle(Ink.text3)
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .overlay(Capsule().stroke(Ink.line, style: StrokeStyle(lineWidth: 1, dash: [3, 2])))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
      }
    }
  }

  private func dropChip(
    text: String,
    targetBoxId: String,
    selected: Bool,
    map: [String: Record],
    action: @escaping () -> Void
  ) -> some View {
    let targeted = dropTargetBoxId == targetBoxId
    return Button(action: action) {
      Text(text)
        .font(.system(size: 14, weight: selected || targeted ? .semibold : .regular))
        .foregroundStyle(selected ? Color.black : Ink.text2)
        .padding(.horizontal, 14)
        .frame(minHeight: 36)
        .background(selected ? Ink.text : targeted ? Ink.pressed : Ink.raised, in: Capsule())
        .overlay(
          Capsule()
            .stroke(targeted ? Ink.text : Color.clear, lineWidth: 1.5)
        )
        .scaleEffect(targeted ? 1.06 : 1)
        .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .sensoryFeedback(.selection, trigger: selected)
    .dropDestination(for: String.self) { payloads, _ in
      handleDrop(payloads: payloads, into: targetBoxId, map: map)
    } isTargeted: { isOver in
      withAnimation(.snappy(duration: 0.14)) {
        if isOver {
          dropTargetBoxId = targetBoxId
        } else if dropTargetBoxId == targetBoxId {
          dropTargetBoxId = nil
        }
      }
    }
  }

  private func dragIDs(for item: Record) -> [String] {
    if selecting && selectedItemIDs.contains(item.id) && selectedItemIDs.count > 1 {
      return Array(selectedItemIDs)
    }
    return [item.id]
  }

  private func dragPayload(for item: Record) -> String {
    "selfos-storage-items:" + dragIDs(for: item).joined(separator: ",")
  }

  private func dragPreview(for item: Record, path: String) -> some View {
    let count = dragIDs(for: item).count
    return HStack(spacing: 8) {
      StorageItemGlyph(
        icon: item.text("icon"),
        name: item.text("name"),
        aliases: item.text("aliases"),
        boxPath: path,
        size: 17,
        color: Ink.text
      )
      Text(count > 1 ? "移动 \(count) 件物品" : item.text("name"))
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(Ink.text)
        .lineLimit(1)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(Ink.raised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Ink.text.opacity(0.6)))
  }

  private func handleDrop(payloads: [String], into targetBoxId: String, map: [String: Record]) -> Bool {
    var ids: [String] = []
    for p in payloads {
      if p.hasPrefix("selfos-storage-items:") {
        ids += String(p.dropFirst("selfos-storage-items:".count))
          .split(separator: ",")
          .map(String.init)
      } else if !p.isEmpty {
        ids.append(p)
      }
    }
    let idSet = Set(ids)
    let targets = allItems.filter { item in
      idSet.contains(item.id) && !(item.text("status") == "in_box" && item.text("boxId") == targetBoxId)
    }
    dropTargetBoxId = nil
    guard !targets.isEmpty else { return false }
    moveItems(targets, into: targetBoxId, map: map)
    return true
  }

  private func moveItems(_ itemsToMove: [Record], into targetBoxId: String, map: [String: Record]) {
    guard !itemsToMove.isEmpty else { return }
    let now = StorageHelpers.isoNow()
    let label = StorageHelpers.boxPath(targetBoxId, map: map)
    let movedIDs = Set(itemsToMove.map(\.id))
    let count = itemsToMove.count
    withAnimation(.snappy(duration: 0.18)) {
      moveToast = "已移入「\(label)」（\(count) 件）"
      if selecting {
        selectedItemIDs.subtract(movedIDs)
        if selectedItemIDs.isEmpty { selecting = false }
      }
      if let sid = selectedItemId, movedIDs.contains(sid) {
        selectedItemId = nil
      }
    }
    Task {
      for item in itemsToMove {
        var data = item.data
        data["status"] = .string("in_box")
        data["boxId"] = .string(targetBoxId)
        data["takenAt"] = nil
        data["verifiedAt"] = .string(now)
        _ = await studio.save("storageItem", data, id: item.id, editBase: item)
      }
    }
  }

  private func compactGridSlot(
    _ item: Record,
    containerBox: Record,
    selected: Bool,
    map: [String: Record]
  ) -> some View {
    let isOut = item.text("status") == "out"
    let qty = StorageHelpers.quantity(of: item)
    let homeId = item.text("homeBoxId")
    let away = !isOut && !homeId.isEmpty && homeId != containerBox.id
    let path = StorageHelpers.boxPath(containerBox.id, map: map)

    return Button {
      withAnimation(.snappy(duration: 0.16)) {
        if selecting {
          if selectedItemIDs.contains(item.id) {
            selectedItemIDs.remove(item.id)
          } else {
            selectedItemIDs.insert(item.id)
          }
        } else {
          selectedItemId = selected ? nil : item.id
        }
      }
    } label: {
      ZStack {
        VStack(spacing: 7) {
          StorageItemGlyph(
            icon: item.text("icon"),
            name: item.text("name"),
            aliases: item.text("aliases"),
            boxPath: path,
            size: 20,
            color: isOut ? Ink.amber : selected ? Ink.text : Ink.text2
          )
          .frame(height: 24)
          Text(item.text("name"))
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(isOut ? Ink.text3 : Ink.text)
            .strikethrough(isOut, color: Ink.text3)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 88)
      }
      .overlay(alignment: .topLeading) {
        if selecting {
          Image(systemName: selected ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(selected ? Ink.text : Ink.text3)
            .padding(6)
        } else if away {
          Circle()
            .fill(Ink.text3)
            .frame(width: 5, height: 5)
            .padding(7)
        }
      }
      .overlay(alignment: .topTrailing) {
        if qty > 1 {
          Text("×\(qty)")
            .font(.system(size: 10, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(Ink.text3)
            .padding(.top, 5)
            .padding(.trailing, 7)
        }
      }
      .background(selected ? Ink.raised : Ink.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .stroke(
            selected ? Ink.text : isOut ? Ink.amber.opacity(0.65) : Ink.line,
            style: StrokeStyle(lineWidth: selected ? 1.3 : 1, dash: isOut && !selected ? [4, 3] : [])
          )
      )
      .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      .opacity(isOut ? 0.82 : 1)
    }
    .buttonStyle(.plain)
    .sensoryFeedback(.selection, trigger: selected)
    .draggable(dragPayload(for: item)) {
      dragPreview(for: item, path: path)
    }
    .contextMenu {
      Button("多选批量整理", systemImage: "checkmark.circle") {
        withAnimation(.snappy(duration: 0.16)) {
          selecting = true
          selectedItemId = nil
          selectedItemIDs.insert(item.id)
        }
      }
      Button(isOut ? "一键归位" : "取出", systemImage: isOut ? "arrow.uturn.backward" : "tray.and.arrow.up") {
        if isOut { returnHome(item, map: map) } else { takeOut(item) }
      }
      if away {
        Button("归回老家", systemImage: "house") { returnHome(item, map: map) }
      }
      Button("更换图标", systemImage: "sparkles") { iconPickerItem = item }
      Button("移到其他箱子/分区", systemImage: "arrow.left.arrow.right") {
        moveBatch = StorageMoveBatch(items: [item])
      }
      Button("编辑详情", systemImage: "pencil") { editingItem = item }
      Button("删除", systemImage: "trash", role: .destructive) {
        Task { await studio.remove(item) }
      }
    }
  }

  private func batchActionBar(
    selectedRecords: [Record],
    allVisibleSelected: Bool,
    visibleIDSet: Set<String>,
    current: Record?,
    subs: [Record],
    map: [String: Record]
  ) -> some View {
    let count = selectedRecords.count
    let allOut = count > 0 && selectedRecords.allSatisfy { $0.text("status") == "out" }

    return VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        Text(count == 0 ? "轻点勾选要整理的物品，或长按直接拖拽" : "已选 \(count) 件")
          .font(.system(size: 13, weight: count > 0 ? .semibold : .regular))
          .foregroundStyle(count > 0 ? Ink.text : Ink.text3)
          .lineLimit(1)
        Spacer(minLength: 4)
        if count > 0 {
          Button(allOut ? "批量归位" : "批量取出") {
            if allOut {
              for item in selectedRecords { returnHome(item, map: map) }
            } else {
              for item in selectedRecords where item.text("status") != "out" { takeOut(item) }
            }
            withAnimation(.snappy(duration: 0.16)) {
              selectedItemIDs = []
              selecting = false
            }
          }
          .buttonStyle(.chip)
          Button("移至其他箱…") {
            moveBatch = StorageMoveBatch(items: selectedRecords)
          }
          .buttonStyle(.chip)
        }
      }

      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 7) {
          if !subs.isEmpty {
            Text("移入本箱分区")
              .font(.system(size: 12))
              .foregroundStyle(Ink.text3)
            if let current {
              Button("未分区") {
                moveItems(selectedRecords, into: current.id, map: map)
              }
              .buttonStyle(.chip)
              .disabled(count == 0)
              .opacity(count == 0 ? 0.45 : 1)
            }
            ForEach(subs) { sub in
              Button(sub.text("name")) {
                moveItems(selectedRecords, into: sub.id, map: map)
              }
              .buttonStyle(PillStyle(prominent: count > 0, compact: true))
              .disabled(count == 0)
              .opacity(count == 0 ? 0.45 : 1)
            }
          }
          Button {
            addingSub = true
          } label: {
            Label(subs.isEmpty ? "先划分本箱分区" : "新建分区", systemImage: "plus")
              .font(.system(size: 13))
              .foregroundStyle(Ink.text2)
              .padding(.horizontal, 12)
              .frame(minHeight: 36)
              .overlay(Capsule().stroke(Ink.line, style: StrokeStyle(lineWidth: 1, dash: [3, 2])))
              .contentShape(Capsule())
          }
          .buttonStyle(.plain)
        }
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
    .background(Ink.card)
    .overlay(alignment: .top) { Hairline() }
  }

  private func selectionActionBar(_ item: Record, map: [String: Record]) -> some View {
    let isOut = item.text("status") == "out"
    let curBid = item.text("boxId")
    let homeId = item.text("homeBoxId")
    let away = !isOut && !homeId.isEmpty && homeId != curBid
    let elapsed = StorageHelpers.elapsed(item.text("takenAt"))
    let sub: String = isOut
      ? elapsed.text
      : away
        ? "常驻：\(StorageHelpers.boxPath(homeId, map: map))"
        : item.text("note")

    return VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 10) {
        Button {
          iconPickerItem = item
        } label: {
          StorageItemGlyph(
            icon: item.text("icon"),
            name: item.text("name"),
            aliases: item.text("aliases"),
            boxPath: curBid.isEmpty ? "" : StorageHelpers.boxPath(curBid, map: map),
            size: 18,
            color: isOut ? Ink.amber : Ink.text
          )
          .frame(width: 36, height: 36)
          .background(Ink.raised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
          .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(Ink.line))
          .contentShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("更换图标")

        VStack(alignment: .leading, spacing: 2) {
          Text(item.text("name"))
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Ink.text)
            .lineLimit(1)
          if !sub.isEmpty {
            Text(sub)
              .font(.system(size: 11))
              .foregroundStyle(isOut ? Ink.amber : Ink.text3)
              .lineLimit(1)
          }
        }
        Spacer(minLength: 4)
        Button {
          withAnimation(.snappy(duration: 0.14)) { selectedItemId = nil }
        } label: {
          Image(systemName: "xmark")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Ink.text3)
            .frame(width: 36, height: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
      }
      HStack(spacing: 8) {
        Button(isOut ? "归位" : away ? "归家" : "取出") {
          if isOut || away { returnHome(item, map: map) } else { takeOut(item) }
        }
        .buttonStyle(.chip)
        Button("换图标") { iconPickerItem = item }
          .buttonStyle(.chip)
        Button("移箱") { moveBatch = StorageMoveBatch(items: [item]) }
          .buttonStyle(.chip)
        Button("编辑") { editingItem = item }
          .buttonStyle(.chip)
        Spacer(minLength: 0)
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .background(Ink.card)
    .overlay(alignment: .top) { Hairline() }
  }

  private func listRow(_ item: Record, containerBox: Record, map: [String: Record]) -> some View {
    let isOut = item.text("status") == "out"
    let qty = StorageHelpers.quantity(of: item)
    let homeId = item.text("homeBoxId")
    let away = !isOut && !homeId.isEmpty && homeId != containerBox.id
    let elapsed = StorageHelpers.elapsed(item.text("takenAt"))
    let path = StorageHelpers.boxPath(containerBox.id, map: map)
    let checked = selectedItemIDs.contains(item.id)

    return HStack(spacing: 10) {
      if selecting {
        Image(systemName: checked ? "checkmark.circle.fill" : "circle")
          .font(.system(size: 19))
          .foregroundStyle(checked ? Ink.text : Ink.text3)
      }
      Button {
        if selecting {
          if checked { selectedItemIDs.remove(item.id) } else { selectedItemIDs.insert(item.id) }
        } else {
          iconPickerItem = item
        }
      } label: {
        StorageItemGlyph(
          icon: item.text("icon"),
          name: item.text("name"),
          aliases: item.text("aliases"),
          boxPath: path,
          size: 16,
          color: isOut ? Ink.amber : Ink.text3
        )
        .frame(width: 32, height: 32)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(selecting ? "勾选物品" : "更换图标")
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          Text(item.text("name"))
            .font(Ink.row)
            .foregroundStyle(isOut ? Ink.text3 : Ink.text)
            .strikethrough(isOut, color: Ink.text3)
            .lineLimit(1)
          if qty > 1 {
            Text("×\(qty)").font(.system(size: 11, weight: .semibold)).monospacedDigit()
              .foregroundStyle(Ink.text3)
          }
        }
        if isOut {
          Text(elapsed.text).font(.system(size: 12)).foregroundStyle(Ink.amber)
        } else if away {
          Text("常驻：\(StorageHelpers.fullLabel(homeId, map: map))")
            .font(.system(size: 12)).foregroundStyle(Ink.text3)
        } else if !item.text("note").isEmpty {
          Text(item.text("note")).font(.system(size: 12)).foregroundStyle(Ink.text3).lineLimit(1)
        }
      }
      Spacer(minLength: 4)
      if !selecting && isOut {
        Button("归位") { returnHome(item, map: map) }
          .buttonStyle(.chip)
      }
    }
    .contentShape(Rectangle())
    .onTapGesture {
      if selecting {
        withAnimation(.snappy(duration: 0.14)) {
          if checked { selectedItemIDs.remove(item.id) } else { selectedItemIDs.insert(item.id) }
        }
      } else {
        editingItem = item
      }
    }
    .cardRow()
    .draggable(dragPayload(for: item)) {
      dragPreview(for: item, path: path)
    }
    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
      if !selecting {
        Button("删除", systemImage: "trash", role: .destructive) {
          Task { await studio.remove(item) }
        }
        Button("移箱", systemImage: "arrow.left.arrow.right") {
          moveBatch = StorageMoveBatch(items: [item])
        }
        .tint(Color(white: 0.42))
        Button(isOut ? "归位" : "取出", systemImage: isOut ? "arrow.uturn.backward" : "tray.and.arrow.up") {
          if isOut { returnHome(item, map: map) } else { takeOut(item) }
        }
        .tint(Color(white: 0.28))
        if away {
          Button("归家", systemImage: "house") { returnHome(item, map: map) }
            .tint(Ink.live)
        }
      }
    }
  }

  private func quickAddBar(subs: [Record], targetId: String, targetLabel: String) -> some View {
    HStack(spacing: 8) {
      if !subs.isEmpty && subFilterId == "all" {
        Menu {
          Button("未分区（主箱）") { quickTargetId = boxId }
          ForEach(subs) { sub in
            Button(sub.text("name")) { quickTargetId = sub.id }
          }
        } label: {
          HStack(spacing: 3) {
            Text(boxByID[targetId]?.id == boxId ? "主箱" : (boxByID[targetId]?.text("name") ?? "分区"))
              .font(.system(size: 12, weight: .medium))
              .lineLimit(1)
            Image(systemName: "chevron.up.chevron.down")
              .font(.system(size: 9))
          }
          .foregroundStyle(Ink.text2)
          .padding(.horizontal, 10)
          .frame(minHeight: 32)
          .background(Ink.raised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
          .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
      }
      TextField("往「\(targetLabel)」放入物品…", text: $quickName)
        .font(Ink.body)
        .foregroundStyle(Ink.text)
        .focused($quickFocused)
        .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
        .submitLabel(.done)
        .onSubmit { quickAdd(into: targetId) }
      Button {
        quickAdd(into: targetId)
      } label: {
        Image(systemName: "plus.circle.fill")
          .font(.system(size: 26))
          .foregroundStyle(
            quickName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
              ? Ink.text3 : Ink.text
          )
          .frame(width: 38, height: 38)
          .contentShape(Circle())
      }
      .buttonStyle(.plain)
      .disabled(quickName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      .accessibilityLabel("放入物品")
    }
    .padding(.leading, 12)
    .padding(.trailing, 6)
    .padding(.vertical, 6)
    .studioInputBox(cornerRadius: 14, fill: Ink.card, stroke: Ink.line) {
      quickFocused = true
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .background(Ink.bg.opacity(0.96))
    .overlay(alignment: .top) { Hairline() }
  }

  private func quickAdd(into targetBoxId: String) {
    let clean = quickName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty else { return }
    quickName = ""
    let now = StorageHelpers.isoNow()
    Task {
      _ = await studio.save("storageItem", [
        "name": .string(clean),
        "status": .string("in_box"),
        "boxId": .string(targetBoxId),
        "homeBoxId": .string(targetBoxId),
        "quantity": .number(1),
        "verifiedAt": .string(now),
      ])
    }
  }

  private func updateIcon(_ item: Record, to next: String?) {
    let clean = (next ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    var data = item.data
    data["icon"] = StorageIconCatalog.isBuiltin(clean) ? .string(clean) : nil
    Task { _ = await studio.save("storageItem", data, id: item.id, editBase: item) }
  }

  private func takeOut(_ item: Record) {
    var data = item.data
    data["status"] = .string("out")
    data["takenAt"] = .string(StorageHelpers.isoNow())
    Task { _ = await studio.save("storageItem", data, id: item.id, editBase: item) }
  }

  private func returnHome(_ item: Record, map: [String: Record]) {
    let targetId = !item.text("homeBoxId").isEmpty ? item.text("homeBoxId") : item.text("boxId")
    guard !targetId.isEmpty, map[targetId] != nil else {
      moveBatch = StorageMoveBatch(items: [item])
      return
    }
    var data = item.data
    data["status"] = .string("in_box")
    data["boxId"] = .string(targetId)
    data["takenAt"] = nil
    data["verifiedAt"] = .string(StorageHelpers.isoNow())
    Task { _ = await studio.save("storageItem", data, id: item.id, editBase: item) }
  }
}

struct StorageBoxEditorSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let box: Record?
  let defaultParentId: String?
  let existingZones: [String]
  var onDeleted: (() -> Void)? = nil

  @State private var parentId = ""
  @State private var zone = "宿舍"
  @State private var name = ""
  @State private var icon: StorageBoxIcon = .chest
  @State private var location = ""
  @State private var saving = false
  @State private var loaded = false

  private var allBoxes: [Record] {
    StorageHelpers.sortBoxes(studio.all("storageBox"))
  }

  private var boxByID: [String: Record] {
    Dictionary(uniqueKeysWithValues: allBoxes.map { ($0.id, $0) })
  }

  private var rootBoxes: [Record] {
    StorageHelpers.rootBoxes(allBoxes, map: boxByID).filter { $0.id != box?.id }
  }

  private var isSub: Bool { !parentId.isEmpty }

  private var presetZones: [String] {
    var list = StorageHelpers.defaultZones
    for z in existingZones where !list.contains(z) { list.append(z) }
    return list
  }

  private var insideCount: Int {
    guard let box else { return 0 }
    return studio.all("storageItem").filter { $0.text("boxId") == box.id }.count
  }

  private var childCount: Int {
    guard let box else { return 0 }
    return allBoxes.filter { $0.text("parentId") == box.id }.count
  }

  var body: some View {
    NavigationStack {
      Form {
        if !rootBoxes.isEmpty && childCount == 0 {
          Section("归属层级") {
            Picker("所属主箱", selection: $parentId) {
              Text("作为顶层大箱子").tag("")
              ForEach(rootBoxes) { b in
                Text("\(b.text("zone")) · \(b.text("name"))").tag(b.id)
              }
            }
            .onChange(of: parentId) { _, next in
              if let p = boxByID[next] { zone = p.text("zone") }
            }
          }
        }
        if !isSub {
          Section("所属场景") {
            ScrollView(.horizontal, showsIndicators: false) {
              HStack(spacing: 6) {
                ForEach(presetZones, id: \.self) { z in
                  Chip(text: z, selected: zone == z) { zone = z }
                }
              }
            }
            TextField("场景名称（如 随身、宿舍、家里）", text: $zone)
          }
        }
        Section(isSub ? "分区信息" : "箱子信息") {
          TextField(
            isSub ? "分区名称（如 前小袋、中层、上层、抽屉）" : "箱子名称（如 双肩包、宿舍书架）",
            text: $name
          )
          TextField("具体方位说明（可选）", text: $location)
        }
        if !isSub {
          Section("图标") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 72))], spacing: 8) {
              ForEach(StorageBoxIcon.allCases) { opt in
                Button {
                  icon = opt
                } label: {
                  VStack(spacing: 4) {
                    Image(systemName: opt.symbol).font(.system(size: 16))
                    Text(opt.label).font(.system(size: 11))
                  }
                  .foregroundStyle(icon == opt ? Ink.text : Ink.text3)
                  .frame(maxWidth: .infinity)
                  .padding(.vertical, 8)
                  .background(icon == opt ? Ink.raised : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                  .overlay(RoundedRectangle(cornerRadius: 8).stroke(icon == opt ? Ink.text : Ink.line))
                }
                .buttonStyle(.plain)
              }
            }
            .padding(.vertical, 4)
          }
        }
        if let box {
          Section {
            if childCount > 0 {
              Text("下面还有 \(childCount) 个分区，请先删除分区后再删此箱子。")
                .font(Ink.meta)
                .foregroundStyle(Ink.text3)
            } else if insideCount > 0 {
              Text("里面还有 \(insideCount) 件物品（含已取出未归位），移走或清空后才能删除。")
                .font(Ink.meta)
                .foregroundStyle(Ink.text3)
            } else {
              Button(isSub ? "删除此分区" : "删除此箱子", role: .destructive) {
                deleteBox(box)
              }
              .disabled(saving)
            }
          }
        }
      }
      .navigationTitle(
        box == nil ? (isSub ? "新建分区" : "新建储物箱") : (isSub ? "编辑分区" : "编辑储物箱")
      )
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") { save() }
            .fontWeight(.semibold)
            .disabled(
              saving
                || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || (!isSub && zone.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            )
        }
      }
    }
    .studioSheet()
    .onAppear {
      guard !loaded else { return }
      loaded = true
      if let box {
        parentId = box.text("parentId")
        zone = box.text("zone")
        name = box.text("name")
        icon = StorageBoxIcon.from(box.text("icon"))
        location = box.text("location")
      } else if let defaultParentId {
        parentId = defaultParentId
        if let p = boxByID[defaultParentId] {
          zone = p.text("zone")
          icon = StorageBoxIcon.from(p.text("icon"))
        }
      }
    }
  }

  private func save() {
    let parentZone = boxByID[parentId]?.text("zone")
    let cleanZone = (parentZone ?? zone).trimmingCharacters(in: .whitespacesAndNewlines)
    let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let cleanLoc = location.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !cleanZone.isEmpty, !cleanName.isEmpty, !saving else { return }
    var data: [String: JSONValue] = box?.data ?? [:]
    data["zone"] = .string(cleanZone)
    data["name"] = .string(cleanName)
    data["parentId"] = parentId.isEmpty ? nil : .string(parentId)
    data["icon"] = .string(icon.rawValue)
    data["location"] = cleanLoc.isEmpty ? nil : .string(cleanLoc)
    saving = true
    Task {
      defer { saving = false }
      if await studio.save("storageBox", data, id: box?.id, editBase: box) != nil {
        dismiss()
      }
    }
  }

  private func deleteBox(_ box: Record) {
    guard insideCount == 0, childCount == 0, !saving else { return }
    saving = true
    let homeOnly = studio.all("storageItem").filter {
      $0.text("boxId") != box.id && $0.text("homeBoxId") == box.id
    }
    Task {
      defer { saving = false }
      for item in homeOnly {
        var d = item.data
        d["homeBoxId"] = nil
        _ = await studio.save("storageItem", d, id: item.id, editBase: item)
      }
      await studio.remove(box)
      dismiss()
      onDeleted?()
    }
  }
}

struct StorageMoveSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let items: [Record]
  let boxes: [Record]
  var onMoved: ((String, Int) -> Void)? = nil

  init(item: Record, boxes: [Record], onMoved: ((String, Int) -> Void)? = nil) {
    self.items = [item]
    self.boxes = boxes
    self.onMoved = onMoved
  }

  init(items: [Record], boxes: [Record], onMoved: ((String, Int) -> Void)? = nil) {
    self.items = items
    self.boxes = boxes
    self.onMoved = onMoved
  }

  var body: some View {
    let map = Dictionary(uniqueKeysWithValues: boxes.map { ($0.id, $0) })
    let options = StorageHelpers.flatOptions(boxes, map: map)
    let single = items.count == 1 ? items.first : nil
    let currentId = single?.text("boxId") ?? ""
    let homeId = single?.text("homeBoxId") ?? ""
    let isOut = single?.text("status") == "out"

    NavigationStack {
      List {
        ForEach(options) { opt in
          let b = opt.box
          let isCurrent = single != nil && !isOut && b.id == currentId
          Button {
            let now = StorageHelpers.isoNow()
            let targets = items.filter { !( $0.text("status") == "in_box" && $0.text("boxId") == b.id ) }
            Task {
              var moved = 0
              for item in targets {
                var data = item.data
                data["status"] = .string("in_box")
                data["boxId"] = .string(b.id)
                data["takenAt"] = nil
                data["verifiedAt"] = .string(now)
                if await studio.save("storageItem", data, id: item.id, editBase: item) != nil {
                  moved += 1
                }
              }
              if moved > 0 {
                onMoved?(b.id, moved)
              }
              dismiss()
            }
          } label: {
            HStack(spacing: 10) {
              if opt.depth > 0 {
                Text("↳")
                  .font(.system(size: 13, design: .monospaced))
                  .foregroundStyle(Ink.text3)
                  .padding(.leading, CGFloat(opt.depth * 14))
              } else {
                Image(systemName: StorageBoxIcon.from(b.text("icon")).symbol)
                  .foregroundStyle(Ink.text2)
                  .frame(width: 24)
              }
              VStack(alignment: .leading, spacing: 2) {
                Text(b.text("name")).font(Ink.row).foregroundStyle(Ink.text)
                Text(
                  (opt.depth > 0 ? opt.fullLabel : b.text("zone"))
                    + (b.text("location").isEmpty ? "" : " · " + b.text("location"))
                )
                .font(.system(size: 12)).foregroundStyle(Ink.text3)
              }
              Spacer()
              if isCurrent {
                Text("当前位置").font(.system(size: 11)).foregroundStyle(Ink.text3)
              } else if single != nil && b.id == homeId {
                Text("常驻老家").font(.system(size: 11)).foregroundStyle(Ink.text2)
              }
            }
            .contentShape(Rectangle())
          }
          .disabled(isCurrent)
          .cardRow()
        }
      }
      .studioList()
      .navigationTitle(
        single.map { "移动「\($0.text("name"))」" } ?? "批量移动 \(items.count) 件物品"
      )
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
      }
    }
    .studioSheet()
    .presentationDetents([.medium, .large])
  }
}

struct StorageItemEditorSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let item: Record
  let boxes: [Record]

  @State private var name = ""
  @State private var icon = ""
  @State private var pickingIcon = false
  @State private var status = "in_box"
  @State private var boxId = ""
  @State private var homeBoxId = ""
  @State private var quantity = 1
  @State private var aliases = ""
  @State private var note = ""
  @State private var saving = false
  @State private var loaded = false

  var body: some View {
    let map = Dictionary(uniqueKeysWithValues: boxes.map { ($0.id, $0) })
    let options = StorageHelpers.flatOptions(boxes, map: map)
    NavigationStack {
      Form {
        Section("基本") {
          HStack(spacing: 12) {
            Button {
              pickingIcon = true
            } label: {
              HStack(spacing: 10) {
                StorageItemGlyph(
                  icon: icon,
                  name: name,
                  aliases: aliases,
                  boxPath: boxId.isEmpty ? "" : StorageHelpers.boxPath(boxId, map: map),
                  size: 20,
                  color: Ink.text
                )
                .frame(width: 38, height: 38)
                .background(Ink.raised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Ink.line))
                VStack(alignment: .leading, spacing: 2) {
                  Text("物品图标")
                    .font(Ink.row)
                    .foregroundStyle(Ink.text)
                  Text(
                    StorageIconCatalog.isBuiltin(icon)
                      ? "已选线框（\(StorageIconCatalog.label(for: icon))）· 点此更换"
                      : "自动匹配 · 点此从 \(StorageIconCatalog.builtins.count) 枚线框图标中更换"
                  )
                  .font(.system(size: 12))
                  .foregroundStyle(Ink.text3)
                  .lineLimit(1)
                }
              }
            }
            .buttonStyle(.plain)
            Spacer(minLength: 4)
            if StorageIconCatalog.isBuiltin(icon) {
              Button("自动") { icon = "" }
                .buttonStyle(.chip)
            }
          }
          TextField("物品名称", text: $name)
          Stepper("数量：\(quantity)", value: $quantity, in: 1...9999)
        }
        Section("位置与防丢") {
          Picker("当前状态", selection: $status) {
            Text("在箱内").tag("in_box")
            Text("已取出使用中").tag("out")
          }
          .pickerStyle(.segmented)

          Picker(status == "in_box" ? "当前所在箱子/分区" : "从哪个位置取出", selection: $boxId) {
            if status == "out" { Text("未指定").tag("") }
            ForEach(options) { opt in
              Text(opt.fullLabel).tag(opt.box.id)
            }
          }
          Picker("常驻老家（一键归位）", selection: $homeBoxId) {
            Text("不设固定老家").tag("")
            ForEach(options) { opt in
              Text(opt.fullLabel).tag(opt.box.id)
            }
          }
        }
        Section("搜索与备注") {
          TextField("搜索别名（如 蓝牙耳机、充电器）", text: $aliases)
          TextField("备注（如 在黑色收纳袋里）", text: $note, axis: .vertical).lineLimit(2...5)
        }
        Section {
          Button("删除这件物品", role: .destructive) {
            Task {
              await studio.remove(item)
              dismiss()
            }
          }
        }
      }
      .navigationTitle("物品详情")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") { save() }
            .fontWeight(.semibold)
            .disabled(
              saving
                || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || (status == "in_box" && boxId.isEmpty)
            )
        }
      }
    }
    .studioSheet()
    .sheet(isPresented: $pickingIcon) {
      StorageIconPickerSheet(
        itemName: name.isEmpty ? "物品" : name,
        currentIcon: icon
      ) { next in
        icon = next ?? ""
      }
    }
    .onAppear {
      guard !loaded else { return }
      loaded = true
      name = item.text("name")
      icon = item.text("icon")
      status = item.text("status", "in_box")
      boxId = item.text("boxId")
      homeBoxId = item.text("homeBoxId")
      quantity = StorageHelpers.quantity(of: item)
      aliases = item.text("aliases")
      note = item.text("note")
    }
  }

  private func save() {
    let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let cleanIcon = icon.trimmingCharacters(in: .whitespacesAndNewlines)
    let cleanAliases = aliases.trimmingCharacters(in: .whitespacesAndNewlines)
    let cleanNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !cleanName.isEmpty, !saving else { return }
    if status == "in_box" && boxId.isEmpty { return }

    var data = item.data
    data["name"] = .string(cleanName)
    data["icon"] = StorageIconCatalog.isBuiltin(cleanIcon) ? .string(cleanIcon) : nil
    data["status"] = .string(status)
    data["boxId"] = boxId.isEmpty ? nil : .string(boxId)
    data["homeBoxId"] = homeBoxId.isEmpty ? nil : .string(homeBoxId)
    data["quantity"] = .number(Double(quantity))
    data["aliases"] = cleanAliases.isEmpty ? nil : .string(cleanAliases)
    data["note"] = cleanNote.isEmpty ? nil : .string(cleanNote)
    if status == "out" {
      if item.text("takenAt").isEmpty {
        data["takenAt"] = .string(StorageHelpers.isoNow())
      }
    } else {
      data["takenAt"] = nil
      data["verifiedAt"] = .string(StorageHelpers.isoNow())
    }
    saving = true
    Task {
      defer { saving = false }
      if await studio.save("storageItem", data, id: item.id, editBase: item) != nil {
        dismiss()
      }
    }
  }
}
