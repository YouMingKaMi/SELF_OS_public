import CouncilCore
import SwiftUI

/// Ink — the visual language of the design app.
///
/// Pure black, three lifted near-blacks, white as the only accent. Cards carry the structure;
/// there are no header rules inside them. Numbers are rounded and tabular; the moment you
/// look at most (today, the running timer, this month's spend) is always the largest thing.
enum Ink {
  static let bg = Color.black
  static let card = Color(white: 0.071)
  static let raised = Color(white: 0.118)
  static let pressed = Color(white: 0.16)
  static let line = Color.white.opacity(0.075)
  static let text = Color.white.opacity(0.94)
  static let text2 = Color.white.opacity(0.56)
  static let text3 = Color.white.opacity(0.34)
  static let live = Color(red: 0.30, green: 0.86, blue: 0.53)
  static let amber = Color(red: 0.97, green: 0.73, blue: 0.30)
  static let danger = Color(red: 1, green: 0.43, blue: 0.43)
  static let radius: CGFloat = 24
  static let gap: CGFloat = 12
  static let pad: CGFloat = 18

  static let display = Font.system(size: 34, weight: .bold)
  static let figure = Font.system(size: 40, weight: .semibold, design: .rounded)
  static let figureMid = Font.system(size: 28, weight: .semibold, design: .rounded)
  static let figureSmall = Font.system(size: 20, weight: .semibold, design: .rounded)
  static let title = Font.system(size: 15, weight: .semibold)
  static let body = Font.system(size: 16)
  static let row = Font.system(size: 15)
  static let meta = Font.system(size: 13)
  static let micro = Font.system(size: 11, weight: .medium)
}

// MARK: - Containers

/// The one container. Optional header: symbol · title ······ meta ›
struct Card<Content: View>: View {
  var icon: String? = nil
  var title: String? = nil
  var meta: String? = nil
  var chevron = false
  var padding: CGFloat = Ink.pad
  @ViewBuilder var content: Content
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      if title != nil || meta != nil {
        HStack(spacing: 8) {
          if let icon {
            Image(systemName: icon).font(.system(size: 14, weight: .medium))
              .foregroundStyle(Ink.text2).frame(width: 18)
          }
          if let title { Text(title).font(Ink.title).foregroundStyle(Ink.text) }
          Spacer(minLength: 8)
          if let meta { Text(meta).font(Ink.meta).foregroundStyle(Ink.text3).monospacedDigit() }
          if chevron {
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold))
              .foregroundStyle(Ink.text3)
          }
        }
      }
      content
    }
    .padding(padding)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Ink.card, in: RoundedRectangle(cornerRadius: Ink.radius, style: .continuous))
  }
}

/// Small label above a group of cards.
struct SectionLabel: View {
  let text: String
  var trailing: String? = nil
  var action: (() -> Void)? = nil
  var body: some View {
    HStack {
      Text(text).font(.system(size: 13, weight: .semibold)).foregroundStyle(Ink.text2)
      Spacer()
      if let trailing {
        if let action {
          Button(trailing, action: action).font(Ink.meta).foregroundStyle(Ink.text2)
        } else {
          Text(trailing).font(Ink.meta).foregroundStyle(Ink.text3)
        }
      }
    }.padding(.horizontal, 6).padding(.top, 8)
  }
}

struct Hairline: View {
  var inset: CGFloat = 0
  var body: some View {
    Rectangle().fill(Ink.line).frame(height: 1 / 3).padding(.leading, inset)
  }
}

/// Black page with the standard scroll rhythm.
struct Page<Content: View>: View {
  @ViewBuilder var content: Content
  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: Ink.gap) { content }
          .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 32)
      }
      .scrollDismissesKeyboard(.interactively)
      .background(Ink.bg)
      .task {
        // STUDIO_SCROLL=<id> jumps to a section; used for device screenshots.
        guard let anchor = ProcessInfo.processInfo.environment["STUDIO_SCROLL"] else { return }
        try? await Task.sleep(for: .milliseconds(600))
        proxy.scrollTo(anchor, anchor: .top)
      }
    }
  }
}

// MARK: - Figures

struct Figure: View {
  let value: String
  var unit: String? = nil
  var caption: String? = nil
  var font: Font = Ink.figure
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(value).font(font).monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
          .contentTransition(.numericText())
        if let unit { Text(unit).font(Ink.meta).foregroundStyle(Ink.text2) }
      }.foregroundStyle(Ink.text)
      if let caption { Text(caption).font(Ink.meta).foregroundStyle(Ink.text3) }
    }
  }
}

/// A row of small figures separated by space, not boxes.
struct StatRow: View {
  let items: [(String, String)]
  var body: some View {
    HStack(alignment: .top, spacing: 0) {
      ForEach(Array(items.enumerated()), id: \.offset) { _, item in
        VStack(alignment: .leading, spacing: 3) {
          Text(item.0).font(Ink.micro).foregroundStyle(Ink.text3)
          Text(item.1).font(.system(size: 17, weight: .semibold, design: .rounded))
            .monospacedDigit().foregroundStyle(Ink.text).lineLimit(1).minimumScaleFactor(0.6)
        }.frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }
}

struct Meter: View {
  let value: Double
  var marker: Double? = nil
  var tint: Color = Ink.text
  var height: CGFloat = 5
  var body: some View {
    GeometryReader { g in
      ZStack(alignment: .leading) {
        Capsule().fill(Color.white.opacity(0.09))
        Capsule().fill(tint).frame(width: max(0, min(1, value)) * g.size.width)
        if let marker {
          Rectangle().fill(Ink.text2).frame(width: 1.5, height: height + 8)
            .offset(x: max(0, min(1, marker)) * g.size.width)
        }
      }
    }.frame(height: height)
  }
}

struct Ring: View {
  let value: Double
  var done: Bool { value >= 1 }
  var size: CGFloat = 26
  var body: some View {
    ZStack {
      if done {
        Circle().fill(Ink.text)
        Image(systemName: "checkmark").font(.system(size: size * 0.42, weight: .bold))
          .foregroundStyle(.black)
      } else {
        Circle().stroke(Color.white.opacity(0.16), lineWidth: 2)
        Circle().trim(from: 0, to: max(0, min(1, value))).rotation(.degrees(-90))
          .stroke(Ink.text, style: StrokeStyle(lineWidth: 2, lineCap: .round))
      }
    }.frame(width: size, height: size).animation(.snappy, value: value)
  }
}

// MARK: - Controls

struct PillStyle: ButtonStyle {
  var prominent = false
  var compact = false
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: compact ? 13 : 15, weight: .semibold))
      .foregroundStyle(prominent ? Color.black : Ink.text)
      .padding(.horizontal, compact ? 12 : 16).frame(height: compact ? 32 : 42)
      .background(prominent ? Ink.text : Ink.raised, in: Capsule())
      .opacity(configuration.isPressed ? 0.7 : 1)
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .animation(.snappy(duration: 0.15), value: configuration.isPressed)
  }
}
extension ButtonStyle where Self == PillStyle {
  static var pill: PillStyle { PillStyle() }
  static var pillProminent: PillStyle { PillStyle(prominent: true) }
  static var chip: PillStyle { PillStyle(compact: true) }
}

/// Tappable row inside a card: whole row is the target, press darkens it.
struct RowStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.contentShape(Rectangle())
      .background(configuration.isPressed ? Color.white.opacity(0.05) : .clear)
  }
}
extension ButtonStyle where Self == RowStyle { static var row: RowStyle { RowStyle() } }

struct Chip: View {
  let text: String
  let selected: Bool
  let action: () -> Void
  var body: some View {
    Button(action: action) {
      Text(text).font(.system(size: 14, weight: selected ? .semibold : .regular))
        .foregroundStyle(selected ? Color.black : Ink.text2)
        .padding(.horizontal, 14).frame(height: 34)
        .background(selected ? Ink.text : Ink.raised, in: Capsule())
    }.buttonStyle(.plain).sensoryFeedback(.selection, trigger: selected)
  }
}

struct ChipBar: View {
  let options: [(String, String)]
  @Binding var selection: String
  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(options, id: \.0) { option in
          Chip(text: option.1, selected: selection == option.0) {
            withAnimation(.snappy) { selection = option.0 }
          }
        }
      }
    }.scrollClipDisabled()
  }
}

/// Fourteen days around the chosen one; swipe for more, tap the title to jump anywhere.
struct DayStrip: View {
  @Binding var day: String
  @State private var picking = false
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Button {
          picking = true
        } label: {
          HStack(spacing: 6) {
            Text(Day.short(day) + " 周" + Day.weekday(day)).font(.system(size: 17, weight: .semibold))
            Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
              .foregroundStyle(Ink.text3)
          }.foregroundStyle(Ink.text)
        }.buttonStyle(.plain)
        Spacer()
        if day != Day.today {
          Button("回到今天") { withAnimation(.snappy) { day = Day.today } }
            .font(Ink.meta).foregroundStyle(Ink.text2)
        }
      }
      ScrollViewReader { proxy in
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 6) {
            ForEach(-20..<8, id: \.self) { offset in
              let date = Day.shift(Day.today, offset)
              let selected = date == day
              Button {
                withAnimation(.snappy) { day = date }
              } label: {
                VStack(spacing: 4) {
                  Text(Day.weekday(date)).font(Ink.micro)
                    .foregroundStyle(selected ? Color.black.opacity(0.6) : Ink.text3)
                  Text(String(Int(date.suffix(2)) ?? 0))
                    .font(.system(size: 17, weight: .semibold, design: .rounded))
                    .foregroundStyle(selected ? Color.black : date > Day.today ? Ink.text3 : Ink.text)
                  Circle().fill(date == Day.today ? (selected ? Color.black : Ink.text) : .clear)
                    .frame(width: 4, height: 4)
                }.frame(width: 42, height: 64)
                  .background(selected ? Ink.text : Ink.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
              }.buttonStyle(.plain).id(date)
            }
          }
        }.scrollClipDisabled()
          .onAppear { proxy.scrollTo(day, anchor: .center) }
          .onChange(of: day) { _, value in withAnimation { proxy.scrollTo(value, anchor: .center) } }
      }.sensoryFeedback(.selection, trigger: day)
    }.frame(maxWidth: .infinity, alignment: .leading)
    .sheet(isPresented: $picking) {
      DatePicker(
        "日期",
        selection: Binding(
          get: { CalendarDays.date(day) ?? Date() },
          set: { day = CalendarDays.string($0) }), displayedComponents: .date
      ).datePickerStyle(.graphical).environment(\.locale, Locale(identifier: "zh_CN"))
        .padding().presentationDetents([.medium]).presentationBackground(Ink.card)
    }
  }
}

struct MonthBar: View {
  @Binding var month: String
  var body: some View {
    HStack(spacing: 4) {
      Button {
        withAnimation(.snappy) { month = Day.shiftMonth(month, -1) }
      } label: {
        Image(systemName: "chevron.left").frame(width: 34, height: 34)
      }
      Text(Day.monthTitle(month)).font(.system(size: 15, weight: .semibold)).monospacedDigit()
        .contentTransition(.numericText())
      Button {
        withAnimation(.snappy) { month = Day.shiftMonth(month, 1) }
      } label: {
        Image(systemName: "chevron.right").frame(width: 34, height: 34)
      }
      Spacer()
      if month != String(Day.today.prefix(7)) {
        Button("本月") { withAnimation(.snappy) { month = String(Day.today.prefix(7)) } }
          .font(Ink.meta)
      }
    }.buttonStyle(.plain).foregroundStyle(Ink.text).sensoryFeedback(.selection, trigger: month)
  }
}

/// Thumb-reach input pinned above the keyboard / home indicator: a floating capsule, glass on iOS 26.
struct Composer: View {
  @Binding var text: String
  var placeholder: String
  var multiline = false
  var send: () -> Void
  @FocusState private var focused: Bool
  var empty: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
  var body: some View {
    HStack(alignment: .bottom, spacing: 6) {
      TextField(placeholder, text: $text, axis: .vertical)
        .lineLimit(multiline ? 1...8 : 1...5).font(Ink.body).focused($focused)
        .padding(.leading, 18).padding(.vertical, 12)
      Button(action: submit) {
        Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold))
          .foregroundStyle(empty ? Ink.text3 : .black)
          .frame(width: 36, height: 36)
          .background(empty ? Color.white.opacity(0.08) : Ink.text, in: Circle())
      }.buttonStyle(.plain).disabled(empty).padding(.trailing, 6).padding(.bottom, 6)
        .accessibilityLabel("保存").sensoryFeedback(.impact(weight: .light), trigger: text.isEmpty)
    }
    .modifier(GlassCapsule())
    .padding(.horizontal, 14).padding(.top, 14).padding(.bottom, 6)
    .background {
      LinearGradient(colors: [Ink.bg.opacity(0), Ink.bg.opacity(0.92)], startPoint: .top, endPoint: .center)
        .ignoresSafeArea()
    }
  }
  func submit() {
    guard !empty else { return }
    send()
  }
}

/// Glass on iOS 26; a raised surface with a hairline before.
struct GlassCapsule: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    } else {
      content.background(Ink.raised, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(Ink.line))
    }
  }
}

struct EmptyNote: View {
  let text: String
  var icon: String? = nil
  var body: some View {
    HStack(spacing: 10) {
      if let icon { Image(systemName: icon).foregroundStyle(Ink.text3) }
      Text(text).font(Ink.meta).foregroundStyle(Ink.text3)
    }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6)
  }
}

/// Tiny line chart for recent values; gaps stay gaps.
struct Spark: View {
  let values: [Double?]
  var body: some View {
    GeometryReader { g in
      let known = values.compactMap { $0 }
      let lo = known.min() ?? 0
      let hi = known.max() ?? 1
      let span = max(hi - lo, 0.0001)
      let x = { (i: Int) in CGFloat(i) / CGFloat(max(values.count - 1, 1)) * g.size.width }
      let y = { (v: Double) in g.size.height - 2 - CGFloat((v - lo) / span) * (g.size.height - 4) }
      Path { p in
        var open = false
        for (i, v) in values.enumerated() {
          guard let v else {
            open = false
            continue
          }
          if open { p.addLine(to: CGPoint(x: x(i), y: y(v))) } else {
            p.move(to: CGPoint(x: x(i), y: y(v)))
          }
          open = true
        }
      }.stroke(Ink.text2, style: StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round))
      if let last = values.lastIndex(where: { $0 != nil }), let v = values[last] {
        Circle().fill(Ink.text).frame(width: 5, height: 5).position(x: x(last), y: y(v))
      }
    }
  }
}

extension View {
  /// Standard sheet chrome.
  func studioSheet() -> some View {
    presentationBackground(Ink.card).presentationCornerRadius(28)
  }
  /// Dark navigation surface for pushed pages.
  func studioScreen(_ title: String) -> some View {
    navigationTitle(title).navigationBarTitleDisplayMode(.inline)
      .toolbarBackground(Ink.bg, for: .navigationBar)
      .background(Ink.bg)
  }
}

/// Map raw schema values to the words people use.
enum Words {
  static let options: [String: String] = [
    "binary": "打卡", "quantity": "数量", "checklist": "多项", "active": "进行中", "paused": "暂停计划",
    "optional": "随手记录", "archived": "已停用", "pending": "待推进", "completed": "已完成",
    "discarded": "已废弃", "resolved": "已解决", "immediate": "当次消费", "estimated": "预计使用",
    "fixed": "固定期限", "set": "设余额", "delta": "增减", "once": "仅一次", "weekly": "每周",
    "monthly": "每月", "yearly": "每年", "custom": "自定义", "solar": "公历", "lunar": "农历", "cny": "人民币",
    "external": "外部投资", "crypto": "加密资产", "stock": "股票", "unknown": "未标明", "original": "原创",
    "ai": "AI 生成", "assisted": "AI 辅助", "excerpt": "摘录", "day": "天", "week": "周", "month": "月",
    "year": "年", "note": "资料", "thought": "思考", "chronicle": "编年史", "raw": "原料",
  ]
  static func of(_ value: String) -> String { options[value] ?? value }
}
