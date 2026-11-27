import CouncilCore
import SwiftUI

enum AchievementIcons {
  static let all: [(key: String, label: String, symbol: String)] = [
    ("check", "达成", "checkmark.seal"),
    ("run", "跑步", "figure.run"),
    ("mountain", "山峰", "mountain.2"),
    ("bike", "骑行", "figure.outdoor.cycle"),
    ("compass", "远行", "safari"),
    ("globe", "世界", "globe.asia.australia"),
    ("book", "阅读", "book.closed"),
    ("language", "语言", "character.book.closed"),
    ("coin", "储备", "yensign.circle"),
    ("code", "作品", "chevron.left.forwardslash.chevron.right"),
    ("home", "生活", "house"),
    ("clock", "积累", "clock"),
  ]

  static func symbol(_ key: String) -> String {
    all.first { $0.key == key }?.symbol ?? "trophy"
  }
}

// MARK: - iPhone Achievements Screen

struct AchievementsScreen: View {
  @Environment(Studio.self) private var studio
  @AppStorage("studio-achievement-categories-v2") private var storedCategoriesRaw = ""
  @State private var scope = "all"
  @State private var category = "all"
  @State private var status = "all"
  @State private var quickTitle = ""
  @State private var selectedRecord: Record?
  @State private var editingSheet: AchievementEditorConfig?
  @State private var showCategories = false

  var allRecords: [Record] {
    studio.all("achievement").filter { !$0.id.hasPrefix("a0000000-0000-4000-8000-0000000000") }
  }

  var storedCategories: [String] {
    storedCategoriesRaw
      .split(separator: "\n")
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
  }

  func setStoredCategories(_ list: [String]) {
    var seen = Set<String>()
    let unique = list
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty && seen.insert($0).inserted }
    storedCategoriesRaw = unique.joined(separator: "\n")
  }

  var categories: [String] {
    var list = storedCategories
    for r in allRecords {
      let c = r.text("category").trimmingCharacters(in: .whitespacesAndNewlines)
      if !c.isEmpty && !list.contains(c) { list.append(c) }
    }
    return list
  }

  var filtered: [Record] {
    allRecords.filter { r in
      if scope != "all" && r.text("scope", "lifetime") != scope { return false }
      if category != "all" && r.text("category") != category { return false }
      let done = r.flag("completed")
      if status == "done" && !done { return false }
      if status == "pending" && done { return false }
      return true
    }
  }

  var hasActiveFilter: Bool {
    scope != "all" || category != "all" || status != "all"
  }

  var activeFilterSummary: String {
    var parts: [String] = []
    if scope == "lifetime" { parts.append("人生成就") }
    else if scope == "annual" { parts.append("年度成就") }
    if category != "all" { parts.append(category) }
    if status == "pending" { parts.append("未完成") }
    else if status == "done" { parts.append("已完成") }
    return parts.joined(separator: " · ")
  }

  var lifetimeFiltered: [Record] {
    filtered.filter { $0.text("scope", "lifetime") == "lifetime" }
  }

  var annualFiltered: [Record] {
    filtered.filter { $0.text("scope", "lifetime") == "annual" }
  }

  var body: some View {
    let doneCount = filtered.filter { $0.flag("completed") }.count
    let totalCount = filtered.count
    let ratio = totalCount > 0 ? Double(doneCount) / Double(totalCount) : 0
    let lifetimeAll = allRecords.filter { $0.text("scope", "lifetime") == "lifetime" }
    let annualAll = allRecords.filter { $0.text("scope", "lifetime") == "annual" }

    Page {
      // 1. Overview Hero Card (clean, without daily-habit style accumulating counters)
      Card(icon: "trophy", title: "成就总览", meta: "已完成 \(Int((ratio * 100).rounded()))%") {
        HStack(alignment: .lastTextBaseline) {
          Figure(
            value: "\(doneCount)",
            unit: "/ \(totalCount) 项已点亮",
            font: Ink.figureMid
          )
          Spacer()
        }
        Meter(value: ratio, height: 6)
        StatRow(items: [
          ("人生成就", "\(lifetimeAll.filter { $0.flag("completed") }.count)/\(lifetimeAll.count)"),
          ("年度成就", "\(annualAll.filter { $0.flag("completed") }.count)/\(annualAll.count)"),
        ])
      }

      // Quiet inline indicator only when a toolbar filter is active
      if hasActiveFilter {
        HStack(spacing: 8) {
          Text("已筛选：\(activeFilterSummary)")
            .font(Ink.micro)
            .foregroundStyle(Ink.text3)
          Spacer()
          Button("清除") {
            withAnimation(.snappy(duration: 0.18)) {
              scope = "all"
              category = "all"
              status = "all"
            }
          }
          .font(Ink.micro)
          .foregroundStyle(Ink.text2)
        }
        .padding(.horizontal, 4)
      }

      // 2. Lifetime Achievements List (Unified 46x46 Square Emblem Cards)
      if !lifetimeFiltered.isEmpty {
        SectionLabel(
          text: "人生成就",
          trailing: "\(lifetimeFiltered.filter { $0.flag("completed") }.count)/\(lifetimeFiltered.count) 已点亮"
        )
        VStack(spacing: 10) {
          ForEach(lifetimeFiltered) { item in
            MobileAchievementCard(
              record: item,
              allRecords: allRecords,
              onTap: { selectedRecord = item }
            )
          }
        }
      }

      // 3. Annual Achievements List
      if !annualFiltered.isEmpty {
        SectionLabel(
          text: "2026 年度成就",
          trailing: "\(annualFiltered.filter { $0.flag("completed") }.count)/\(annualFiltered.count) 已点亮"
        )
        VStack(spacing: 10) {
          ForEach(annualFiltered) { item in
            MobileAchievementCard(
              record: item,
              allRecords: allRecords,
              onTap: { selectedRecord = item }
            )
          }
        }
      }

      if filtered.isEmpty {
        Card {
          EmptyNote(text: "当前条件下还没有成就记录，可在底部随手添加", icon: "trophy")
        }
      }
    }
    .studioScreen("成就")
    .safeAreaInset(edge: .bottom) {
      Composer(
        text: $quickTitle,
        placeholder: scope == "annual" ? "记下一个今年想完成的目标…" : "记下一个想完成的人生成就…"
      ) {
        let title = quickTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        quickTitle = ""
        let targetScope = scope == "annual" ? "annual" : "lifetime"
        let targetCat = category == "all" ? (categories.first ?? "") : category
        Task {
          await studio.save(
            "achievement",
            [
              "title": .string(title),
              "description": .string(""),
              "scope": .string(targetScope),
              "year": .string("2026"),
              "category": .string(targetCat),
              "icon": .string("check"),
              "prevIds": .array([]),
              "current": .number(0),
              "target": .number(1),
              "unit": .string("次"),
              "completed": .bool(false),
              "note": .string(""),
            ]
          )
        }
      }
    }
    .toolbar {
      ToolbarItemGroup(placement: .topBarTrailing) {
        Menu {
          Section("跨度") {
            Picker("跨度", selection: $scope) {
              Text("全部 (\(allRecords.count))").tag("all")
              Text("人生成就 (\(lifetimeAll.count))").tag("lifetime")
              Text("年度成就 (\(annualAll.count))").tag("annual")
            }
          }
          Section("状态") {
            Picker("状态", selection: $status) {
              Text("全部状态").tag("all")
              Text("未完成").tag("pending")
              Text("已完成").tag("done")
            }
          }
          if !categories.isEmpty {
            Section("板块") {
              Picker("板块", selection: $category) {
                Text("全部板块").tag("all")
                ForEach(categories, id: \.self) { cat in
                  Text(cat).tag(cat)
                }
              }
            }
          }
          Section {
            if hasActiveFilter {
              Button("清除全部筛选", role: .destructive) {
                scope = "all"
                category = "all"
                status = "all"
              }
            }
            Button("管理板块", systemImage: "tag") {
              showCategories = true
            }
          }
        } label: {
          Image(systemName: hasActiveFilter ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }.accessibilityLabel("筛选与板块")

        Button {
          editingSheet = AchievementEditorConfig(
            record: nil,
            defaultScope: scope == "annual" ? "annual" : "lifetime",
            defaultCategory: category == "all" ? (categories.first ?? "") : category,
            defaultPrevId: nil
          )
        } label: {
          Image(systemName: "plus")
        }.accessibilityLabel("新建成就")
      }
    }
    .task {
      for demo in studio.all("achievement") where demo.id.hasPrefix("a0000000-0000-4000-8000-0000000000") {
        await studio.remove(demo)
      }
    }
    .sheet(item: $selectedRecord) { rec in
      let latest = allRecords.first { $0.id == rec.id } ?? rec
      AchievementDetailSheet(
        record: latest,
        allRecords: allRecords,
        onSelectOther: { other in selectedRecord = other },
        onEdit: { target in
          selectedRecord = nil
          editingSheet = AchievementEditorConfig(
            record: target,
            defaultScope: target.text("scope", "lifetime"),
            defaultCategory: target.text("category"),
            defaultPrevId: nil
          )
        },
        onAppendNext: { fromTarget in
          selectedRecord = nil
          editingSheet = AchievementEditorConfig(
            record: nil,
            defaultScope: fromTarget.text("scope", "lifetime"),
            defaultCategory: fromTarget.text("category"),
            defaultPrevId: fromTarget.id
          )
        }
      )
    }
    .sheet(item: $editingSheet) { config in
      AchievementEditorSheet(
        config: config,
        categories: categories,
        allRecords: allRecords,
        onEnsureCategory: { newCat in
          let trimmed = newCat.trimmingCharacters(in: .whitespacesAndNewlines)
          if !trimmed.isEmpty && !storedCategories.contains(trimmed) {
            setStoredCategories(storedCategories + [trimmed])
          }
        }
      )
    }
    .sheet(isPresented: $showCategories) {
      AchievementCategoriesSheet(
        categories: categories,
        allRecords: allRecords,
        onAdd: { name in
          setStoredCategories(categories + [name])
        },
        onRename: { oldName, newName in
          let next = categories.map { $0 == oldName ? newName : $0 }
          setStoredCategories(next)
          if category == oldName { category = newName }
          Task {
            for r in allRecords where r.text("category") == oldName {
              await studio.update(r, ["category": .string(newName)])
            }
          }
        },
        onDelete: { name in
          setStoredCategories(categories.filter { $0 != name })
          if category == name { category = "all" }
          Task {
            for r in allRecords where r.text("category") == name {
              await studio.update(r, ["category": .string("")])
            }
          }
        }
      )
    }
  }
}

// MARK: - Unified 46x46 Emblem Box

struct AchievementEmblemBox: View {
  let iconKey: String
  let done: Bool
  var size: CGFloat = 46

  var body: some View {
    let radius = size * 0.24
    ZStack {
      RoundedRectangle(cornerRadius: radius, style: .continuous)
        .fill(done ? Ink.text : Ink.raised)
      if !done {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
          .stroke(Ink.line, lineWidth: 1)
      }
      Image(systemName: AchievementIcons.symbol(iconKey))
        .font(.system(size: size * 0.41, weight: .semibold))
        .foregroundStyle(done ? Color.black : Ink.text2)
    }
    .frame(width: size, height: size)
  }
}

enum AchievementFormat {
  static func number(_ value: Double) -> String {
    if value.truncatingRemainder(dividingBy: 1) == 0 {
      return NumberFormatter.localizedString(from: NSNumber(value: Int(value)), number: .decimal)
    }
    return String(format: "%.1f", value)
  }
  static func plainNumber(_ value: Double) -> String {
    if value.truncatingRemainder(dividingBy: 1) == 0 {
      return String(Int(value))
    }
    return String(format: "%.2f", value).replacingOccurrences(of: #"0+$"#, with: "", options: .regularExpression)
  }
  static func date(from day: String) -> Date {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.date(from: day) ?? Date()
  }
  static func dayString(from date: Date) -> String {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: date)
  }
}

// MARK: - Unified Mobile Achievement Card (Matches V4 Web Proportions)

struct MobileAchievementCard: View {
  @Environment(Studio.self) private var studio
  let record: Record
  let allRecords: [Record]
  let onTap: () -> Void

  var body: some View {
    let done = record.flag("completed")
    let target = max(1, record.number("target"))
    let current = done ? target : max(0, record.number("current"))
    let ratio = target > 1 ? min(1, current / target) : (done ? 1 : 0)
    let tag = record.text("scope", "lifetime") == "annual"
      ? "\(record.text("year", "2026")) 年度"
      : record.text("category", "人生成就")
    let desc = record.text("description")
    let note = record.text("note").trimmingCharacters(in: .whitespacesAndNewlines)
    let completedAt = record.text("completedAt")
    let nextStage = allRecords.first { ($0.data["prevIds"]?.strings ?? []).contains(record.id) }

    HStack(spacing: 13) {
      AchievementEmblemBox(iconKey: record.text("icon", "check"), done: done, size: 46)

      VStack(alignment: .leading, spacing: 5) {
        // Row 1: Title + Tag
        HStack(spacing: 6) {
          Text(record.title)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(done ? Ink.text : Ink.text.opacity(0.84))
            .lineLimit(1)
          Spacer(minLength: 4)
          Text(tag)
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(Ink.text3)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Ink.raised, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
        }

        // Row 2: Completion record excerpt when completed, else requirement description
        Text(
          done && !note.isEmpty
            ? note
            : (desc.isEmpty ? (record.text("scope") == "annual" ? "年度目标" : "人生成就") : desc)
        )
          .font(.system(size: 12))
          .foregroundStyle(Ink.text3)
          .lineLimit(1)

        // Row 3: Progress bar (for unfinished numeric targets) or Completion Date + Meta
        if target > 1 && !done {
          HStack(spacing: 10) {
            Meter(value: ratio, tint: Ink.text2, height: 5)
            Text("\(AchievementFormat.number(current))/\(AchievementFormat.number(target)) \(record.text("unit", "次"))")
              .font(.system(size: 11, weight: .medium, design: .monospaced))
              .foregroundStyle(Ink.text3)
          }
        } else {
          HStack {
            Text(done ? (completedAt.isEmpty ? "已达成" : "\(completedAt) 达成") : "未完成")
              .font(.system(size: 11, weight: .medium, design: .monospaced))
              .foregroundStyle(done ? Ink.text2 : Ink.text3)
            Spacer()
            if target > 1 {
              Text("\(AchievementFormat.number(target)) \(record.text("unit", "次"))")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(Ink.text3)
            } else if let nextStage {
              Text("→ \(nextStage.title)")
                .font(.system(size: 11))
                .foregroundStyle(Ink.text3)
                .lineLimit(1)
            }
          }
        }
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
    .background(
      done ? Ink.raised.opacity(0.85) : Ink.card,
      in: RoundedRectangle(cornerRadius: 18, style: .continuous)
    )
    .overlay(
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .stroke(done ? Color.white.opacity(0.14) : Ink.line, lineWidth: 1)
    )
    .contentShape(Rectangle())
    .onTapGesture(perform: onTap)
  }
}

// MARK: - Achievement Detail & Vertical Progression Chain Sheet

struct AchievementDetailSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let record: Record
  let allRecords: [Record]
  let onSelectOther: (Record) -> Void
  let onEdit: (Record) -> Void
  let onAppendNext: (Record) -> Void

  @State private var noteText = ""
  @State private var completedDay = ""
  @State private var completedDate = Date()
  @State private var progressInput = ""
  private enum DetailField { case progress, note }
  @FocusState private var focusedField: DetailField?

  /// Walk up and down `prevIds` to show the connected vertical progression ladder on mobile.
  var progressionChain: [Record] {
    let byId = Dictionary(uniqueKeysWithValues: allRecords.map { ($0.id, $0) })
    var ancestors: [Record] = []
    var seen = Set<String>([record.id])
    var curr = record
    while let prevId = (curr.data["prevIds"]?.strings ?? []).first(where: { byId[$0] != nil }),
          !seen.contains(prevId),
          let parent = byId[prevId]
    {
      seen.insert(prevId)
      ancestors.insert(parent, at: 0)
      curr = parent
    }

    var descendants: [Record] = []
    var tail = record
    while let next = allRecords.first(where: {
      ($0.data["prevIds"]?.strings ?? []).contains(tail.id) && !seen.contains($0.id)
    }) {
      seen.insert(next.id)
      descendants.append(next)
      tail = next
    }

    let chain = ancestors + [record] + descendants
    return chain.count > 1 ? chain : []
  }

  var body: some View {
    let done = record.flag("completed")
    let target = max(1, record.number("target"))
    let current = done ? target : max(0, record.number("current"))
    let unit = record.text("unit", "次")
    let ratio = target > 1 ? min(1, current / target) : (done ? 1 : 0)

    NavigationStack {
      Page {
        // Hero Header
        Card {
          HStack(alignment: .top, spacing: 14) {
            AchievementEmblemBox(iconKey: record.text("icon", "check"), done: done, size: 52)
            VStack(alignment: .leading, spacing: 5) {
              HStack(spacing: 6) {
                Text(record.text("scope") == "annual" ? "\(record.text("year", "2026")) 年度成就" : "人生成就")
                  .font(Ink.micro).foregroundStyle(Ink.text2)
                  .padding(.horizontal, 7).padding(.vertical, 2)
                  .background(Ink.raised, in: Capsule())
                if !record.text("category").isEmpty {
                  Text(record.text("category"))
                    .font(Ink.micro).foregroundStyle(Ink.text3)
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .background(Ink.raised, in: Capsule())
                }
              }
              Text(record.title).font(.system(size: 19, weight: .bold)).foregroundStyle(Ink.text)
              if !record.text("description").isEmpty {
                Text(record.text("description")).font(Ink.meta).foregroundStyle(Ink.text2)
              }
            }
          }

          Hairline()

          // Primary Completion Button
          HStack {
            VStack(alignment: .leading, spacing: 2) {
              Text(done ? "已达成 · \(record.text("completedAt", Day.today))" : "尚未完成")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Ink.text)
              Text(target > 1 ? "当前数值 \(AchievementFormat.number(current)) / \(AchievementFormat.number(target)) \(unit)" : "真正完成时在此确认，并记录当时的时间与感想")
                .font(.system(size: 12))
                .foregroundStyle(Ink.text3)
            }
            Spacer()
            Button(done ? "撤销完成" : "确认完成") {
              var patch: [String: JSONValue] = ["completed": .bool(!done)]
              if !done {
                let day = completedDay.isEmpty ? Day.today : completedDay
                patch["completedAt"] = .string(day)
                completedDay = day
                completedDate = AchievementFormat.date(from: day)
                if target > 1 {
                  patch["current"] = .number(target)
                  progressInput = AchievementFormat.plainNumber(target)
                }
              }
              Task { await studio.update(record, patch) }
            }
            .buttonStyle(PillStyle(prominent: !done, compact: true))
            .sensoryFeedback(.impact(weight: .medium), trigger: done)
          }
        }

        // Direct Numeric Progress Card (no +/- steppers)
        if target > 1 {
          Card(icon: "chart.bar.fill", title: "当前进度", meta: "\(Int((ratio * 100).rounded()))%") {
            HStack(alignment: .center, spacing: 10) {
              Figure(
                value: AchievementFormat.number(current),
                unit: "/ \(AchievementFormat.number(target)) \(unit)",
                font: Ink.figureMid
              )
              Spacer()
              HStack(spacing: 6) {
                TextField("数值", text: $progressInput)
                  .keyboardType(.decimalPad)
                  .font(.system(size: 15, weight: .medium, design: .monospaced))
                  .multilineTextAlignment(.trailing)
                  .focused($focusedField, equals: .progress)
                  .frame(minHeight: 24)
                  .padding(.horizontal, 10)
                  .padding(.vertical, 6)
                  .frame(width: 86)
                  .studioInputBox(cornerRadius: 8, fill: Ink.bg, stroke: Ink.line) {
                    focusedField = .progress
                  }
                Button("更新") { applyDirectProgress() }
                  .buttonStyle(PillStyle(prominent: true, compact: true))
                  .disabled(Double(progressInput.trimmingCharacters(in: .whitespacesAndNewlines)) == nil)
              }
            }
            Meter(value: ratio, height: 6)
          }
        }

        // Completion Time & Record Card
        Card(icon: "calendar.badge.checkmark", title: "完成时间与记录") {
          HStack {
            Text("完成日期").font(Ink.meta).foregroundStyle(Ink.text2)
            Spacer()
            DatePicker(
              "",
              selection: $completedDate,
              displayedComponents: .date
            )
            .labelsHidden()
            .onChange(of: completedDate) { _, newValue in
              completedDay = AchievementFormat.dayString(from: newValue)
            }
          }
          Hairline()
          TextField("记下真正完成那一刻的经过、时间细节或当时的感受…", text: $noteText, axis: .vertical)
            .lineLimit(3...7)
            .font(Ink.body)
            .focused($focusedField, equals: .note)
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .topLeading)
            .background(Color.clear.contentShape(Rectangle()).onTapGesture { focusedField = .note })
          HStack {
            Button("删除此成就", role: .destructive) {
              Task {
                await studio.remove(record)
                dismiss()
              }
            }.font(Ink.meta).foregroundStyle(Ink.danger)
            Spacer()
            Button("保存记录") {
              saveNote()
            }.buttonStyle(PillStyle(prominent: true, compact: true))
          }
        }

        // Mobile Vertical Progression Ladder
        Card(
          icon: "point.topleft.down.curvedto.point.bottomright.up",
          title: "进阶路线排序",
          meta: progressionChain.isEmpty ? "独立成就" : "共 \(progressionChain.count) 阶"
        ) {
          if progressionChain.isEmpty {
            Text("当前为独立成就。如果你有下一阶段目标（如存够 3 个月 → 6 个月 → 1 年），可以点下方按钮串联成进阶阶梯。")
              .font(Ink.meta).foregroundStyle(Ink.text3)
          } else {
            VStack(alignment: .leading, spacing: 0) {
              ForEach(Array(progressionChain.enumerated()), id: \.element.id) { idx, stepItem in
                let isCurrent = stepItem.id == record.id
                let stepDone = stepItem.flag("completed")
                Button {
                  if !isCurrent { onSelectOther(stepItem) }
                } label: {
                  HStack(spacing: 12) {
                    VStack(spacing: 0) {
                      Rectangle()
                        .fill(idx == 0 ? Color.clear : Ink.line)
                        .frame(width: 1.5, height: 10)
                      Circle()
                        .fill(stepDone ? Ink.text : (isCurrent ? Ink.text2 : Ink.raised))
                        .frame(width: 10, height: 10)
                        .overlay(Circle().stroke(Ink.text2, lineWidth: isCurrent ? 2 : 0))
                      Rectangle()
                        .fill(idx == progressionChain.count - 1 ? Color.clear : Ink.line)
                        .frame(width: 1.5, height: 10)
                    }
                    Text("\(idx + 1).")
                      .font(.system(size: 12, design: .monospaced))
                      .foregroundStyle(Ink.text3)
                    Text(stepItem.title)
                      .font(.system(size: 14, weight: isCurrent ? .bold : .regular))
                      .foregroundStyle(isCurrent ? Ink.text : (stepDone ? Ink.text2 : Ink.text3))
                    Spacer()
                    Text(stepDone ? (stepItem.text("completedAt").isEmpty ? "已完成" : stepItem.text("completedAt")) : "未完成")
                      .font(.system(size: 11, design: .monospaced))
                      .foregroundStyle(stepDone ? Ink.text2 : Ink.text3)
                  }
                  .padding(.vertical, 4)
                }.buttonStyle(.plain)
              }
            }
          }
          Button {
            onAppendNext(record)
          } label: {
            Label("在此之后延伸下一阶成就", systemImage: "plus.circle")
              .font(.system(size: 13, weight: .medium))
              .foregroundStyle(Ink.text2)
          }.padding(.top, 4)
        }
      }
      .navigationTitle("成就详情")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button("编辑") { onEdit(record) }
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button("完成") {
            saveNote()
            dismiss()
          }.fontWeight(.semibold)
        }
      }
      .onAppear { syncFields() }
      .onChange(of: record.id) { _, _ in syncFields() }
    }.studioSheet()
  }

  private func syncFields() {
    noteText = record.text("note")
    completedDay = record.text("completedAt")
    completedDate = AchievementFormat.date(from: completedDay.isEmpty ? Day.today : completedDay)
    progressInput = AchievementFormat.plainNumber(max(0, record.number("current")))
  }

  private func applyDirectProgress() {
    let trimmed = progressInput.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let parsed = Double(trimmed) else { return }
    let target = max(1, record.number("target"))
    let next = max(0, (parsed * 100).rounded() / 100)
    var patch: [String: JSONValue] = ["current": .number(next)]
    if next >= target && !record.flag("completed") {
      let day = completedDay.isEmpty ? Day.today : completedDay
      patch["completed"] = .bool(true)
      patch["completedAt"] = .string(day)
      completedDay = day
    }
    Task { await studio.update(record, patch) }
  }

  private func saveNote() {
    var patch: [String: JSONValue] = ["note": .string(noteText.trimmingCharacters(in: .whitespacesAndNewlines))]
    let trimmedDay = completedDay.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmedDay.isEmpty {
      patch["completedAt"] = .string(trimmedDay)
    } else if record.flag("completed") {
      patch["completedAt"] = .string(AchievementFormat.dayString(from: completedDate))
    }
    Task { await studio.update(record, patch) }
  }
}

// MARK: - Create / Edit Achievement Sheet

struct AchievementEditorConfig: Identifiable {
  let id = UUID()
  let record: Record?
  let defaultScope: String
  let defaultCategory: String
  let defaultPrevId: String?
}

struct AchievementEditorSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let config: AchievementEditorConfig
  let categories: [String]
  let allRecords: [Record]
  let onEnsureCategory: (String) -> Void

  @State private var title = ""
  @State private var description = ""
  @State private var scope = "lifetime"
  @State private var year = "2026"
  @State private var category = ""
  @State private var icon = "check"
  @State private var hasTarget = false
  @State private var currentText = "0"
  @State private var targetText = "10"
  @State private var unit = "次"
  @State private var prevId = ""
  @State private var note = ""

  var body: some View {
    NavigationStack {
      Form {
        Section("基本信息") {
          TextField("成就名称（如：第一次去国外旅行）", text: $title)
          TextField("具体标准（选填）", text: $description)
          Picker("成就类型", selection: $scope) {
            Text("人生成就").tag("lifetime")
            Text("年度成就").tag("annual")
          }
          if scope == "annual" {
            TextField("所属年份", text: $year).keyboardType(.numberPad)
          }
          if !categories.isEmpty {
            Picker("选择已有分类", selection: $category) {
              Text("无分类").tag("")
              ForEach(categories, id: \.self) { c in
                Text(c).tag(c)
              }
            }
          }
          TextField("或直接输入自定义分类（选填）", text: $category)
        }.listRowBackground(Ink.raised)

        Section("进度方式") {
          Toggle("需要累计数值进度", isOn: $hasTarget)
          if hasTarget {
            HStack {
              Text("当前进度")
              Spacer()
              TextField("0", text: $currentText)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
            }
            HStack {
              Text("目标数值")
              Spacer()
              TextField("10", text: $targetText)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
            }
            HStack {
              Text("单位")
              Spacer()
              TextField("公里 / 天 / 本", text: $unit)
                .multilineTextAlignment(.trailing)
            }
          }
        }.listRowBackground(Ink.raised)

        Section("图标") {
          LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 6), spacing: 10) {
            ForEach(AchievementIcons.all, id: \.key) { item in
              Button {
                icon = item.key
              } label: {
                VStack(spacing: 4) {
                  Image(systemName: item.symbol)
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 36, height: 36)
                    .background(icon == item.key ? Ink.text : Ink.card, in: RoundedRectangle(cornerRadius: 8))
                    .foregroundStyle(icon == item.key ? Color.black : Ink.text2)
                  Text(item.label).font(.system(size: 10)).foregroundStyle(Ink.text3)
                }
              }.buttonStyle(.plain)
            }
          }.padding(.vertical, 4)
        }.listRowBackground(Ink.raised)

        Section("进阶排序（选填）") {
          Picker("排在哪个成就之后", selection: $prevId) {
            Text("不串联（独立成就）").tag("")
            ForEach(allRecords.filter { $0.id != config.record?.id }) { candidate in
              Text(candidate.title).tag(candidate.id)
            }
          }
        }.listRowBackground(Ink.raised)

        Section("备注") {
          TextField("补充说明…", text: $note, axis: .vertical).lineLimit(2...5)
        }.listRowBackground(Ink.raised)
      }
      .scrollContentBackground(.hidden)
      .background(Ink.card)
      .navigationTitle(config.record == nil ? "新建成就" : "编辑成就")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button("取消") { dismiss() }
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button("保存") {
            save()
          }
          .fontWeight(.semibold)
          .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
      }
      .onAppear {
        if let rec = config.record {
          title = rec.title
          description = rec.text("description")
          scope = rec.text("scope", "lifetime")
          year = rec.text("year", "2026")
          category = rec.text("category")
          icon = rec.text("icon", "check")
          let t = max(1, rec.number("target"))
          hasTarget = t > 1
          currentText = AchievementFormat.plainNumber(rec.number("current"))
          targetText = AchievementFormat.plainNumber(t > 1 ? t : 10)
          unit = rec.text("unit", "次")
          prevId = (rec.data["prevIds"]?.strings ?? []).first ?? ""
          note = rec.text("note")
        } else {
          scope = config.defaultScope
          category = config.defaultCategory
          prevId = config.defaultPrevId ?? ""
        }
      }
    }.studioSheet()
  }

  private func save() {
    let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedTitle.isEmpty else { return }
    let targetVal = hasTarget ? max(2, Double(targetText.replacingOccurrences(of: ",", with: "")) ?? 10) : 1
    let currentVal = hasTarget
      ? max(0, Double(currentText.replacingOccurrences(of: ",", with: "")) ?? 0)
      : (config.record?.flag("completed") == true ? 1 : 0)

    let trimmedCategory = category.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmedCategory.isEmpty {
      onEnsureCategory(trimmedCategory)
    }

    var data: [String: JSONValue] = [
      "title": .string(trimmedTitle),
      "description": .string(description.trimmingCharacters(in: .whitespacesAndNewlines)),
      "scope": .string(scope),
      "category": .string(trimmedCategory),
      "icon": .string(icon),
      "prevIds": .array(prevId.isEmpty ? [] : [.string(prevId)]),
      "current": .number(currentVal),
      "target": .number(targetVal),
      "unit": .string(unit.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "次" : unit),
      "completed": .bool(config.record?.flag("completed") ?? false),
      "note": .string(note.trimmingCharacters(in: .whitespacesAndNewlines)),
    ]
    if scope == "annual" {
      data["year"] = .string(year.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "2026" : year)
    }
    if let completedAt = config.record?.text("completedAt"), !completedAt.isEmpty {
      data["completedAt"] = .string(completedAt)
    }
    Task {
      await studio.save("achievement", data, id: config.record?.id, editBase: config.record)
      dismiss()
    }
  }
}

// MARK: - Manage Achievement Categories Sheet

struct AchievementCategoriesSheet: View {
  @Environment(\.dismiss) private var dismiss
  let categories: [String]
  let allRecords: [Record]
  let onAdd: (String) -> Void
  let onRename: (String, String) -> Void
  let onDelete: (String) -> Void

  @State private var newName = ""
  @State private var renamingTarget: String?
  @State private var renameText = ""

  var body: some View {
    NavigationStack {
      Form {
        Section("新增分类") {
          HStack(spacing: 10) {
            TextField("输入自定义分类名…", text: $newName)
            Button("添加") {
              let trimmed = newName.trimmingCharacters(in: .whitespacesAndNewlines)
              guard !trimmed.isEmpty else { return }
              onAdd(trimmed)
              newName = ""
            }
            .buttonStyle(PillStyle(prominent: true, compact: true))
            .disabled(newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
        }.listRowBackground(Ink.raised)

        Section("已有分类（可重命名或全部删除）") {
          if categories.isEmpty {
            Text("暂无自定义分类")
              .font(Ink.meta)
              .foregroundStyle(Ink.text3)
          } else {
            ForEach(categories, id: \.self) { cat in
              let count = allRecords.filter { $0.text("category") == cat }.count
              if renamingTarget == cat {
                HStack(spacing: 8) {
                  TextField("新名称", text: $renameText)
                  Button("保存") {
                    let trimmed = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty && trimmed != cat {
                      onRename(cat, trimmed)
                    }
                    renamingTarget = nil
                  }
                  .buttonStyle(PillStyle(prominent: true, compact: true))
                  Button("取消") {
                    renamingTarget = nil
                  }
                  .font(Ink.meta)
                  .foregroundStyle(Ink.text3)
                }
              } else {
                HStack {
                  VStack(alignment: .leading, spacing: 2) {
                    Text(cat).font(.system(size: 15, weight: .medium)).foregroundStyle(Ink.text)
                    Text("\(count) 项成就").font(.system(size: 12)).foregroundStyle(Ink.text3)
                  }
                  Spacer()
                  Button("重命名") {
                    renamingTarget = cat
                    renameText = cat
                  }
                  .font(Ink.meta)
                  .foregroundStyle(Ink.text2)
                  .buttonStyle(.plain)

                  Button("删除", role: .destructive) {
                    onDelete(cat)
                  }
                  .font(Ink.meta)
                  .foregroundStyle(Ink.danger)
                  .buttonStyle(.plain)
                  .padding(.leading, 10)
                }
              }
            }
          }
        }.listRowBackground(Ink.raised)
      }
      .scrollContentBackground(.hidden)
      .background(Ink.card)
      .navigationTitle("分类管理")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("完成") { dismiss() }.fontWeight(.semibold)
        }
      }
    }.studioSheet()
  }
}
