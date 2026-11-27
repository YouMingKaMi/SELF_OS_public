import Foundation

/// Turns the first reply from a chat-completion provider into a local task preview.
public enum TaskPlanRules {
  public struct Item: Codable, Equatable, Identifiable, Sendable {
    public let key: String
    public var title: String
    public let note: String?
    public let date: String?
    public let time: String?
    public let after: [String]
    public var id: String { key }
  }

  public enum Failure: String, LocalizedError {
    case missingContent, invalidJSON, invalidCount, invalidItem, invalidDependency, cycle
    public var errorDescription: String? {
      switch self {
      case .missingContent: "模型没有返回事项。"
      case .invalidJSON: "模型没有返回有效的任务格式，请重试。"
      case .invalidCount: "没有得到可用的事项，请重试。"
      case .invalidItem: "模型返回的事项格式不完整。"
      case .invalidDependency: "模型返回了无效的前置关系。"
      case .cycle: "模型返回的前置关系形成了循环。"
      }
    }
  }

  private static let spaces = CharacterSet(charactersIn:
    "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}\u{00A0}\u{1680}" +
    "\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}" +
    "\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")

  public static func parse(_ data: Data) throws -> [Item] {
    guard case .object(let response) = try decode(data),
      case .array(let choices) = response["choices"],
      case .object(let first) = choices.first,
      case .object(let message) = first["message"],
      let raw = message["content"]?.stringValue?.trimmingCharacters(in: spaces),
      !raw.isEmpty else { throw Failure.missingContent }

    let json = raw.replacingOccurrences(
      of: #"^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$"#, with: "",
      options: [.regularExpression, .caseInsensitive])
    guard case .object(let plan) = try decode(Data(json.utf8)),
      case .array(let entries) = plan["items"], (1...20).contains(entries.count)
    else { throw Failure.invalidCount }

    let items = try entries.map(normalize)
    let keys = Set(items.map(\.key))
    guard keys.count == items.count,
      items.allSatisfy({ $0.after.allSatisfy(keys.contains) })
    else { throw Failure.invalidDependency }

    var ordered: [Item] = []
    var placed = Set<String>()
    while ordered.count < items.count {
      guard let next = items.first(where: {
        !placed.contains($0.key) && $0.after.allSatisfy(placed.contains)
      }) else { throw Failure.cycle }
      ordered.append(next)
      placed.insert(next.key)
    }
    return ordered
  }

  private static func decode(_ data: Data) throws -> JSONValue {
    do { return try JSONDecoder().decode(JSONValue.self, from: data) }
    catch { throw Failure.invalidJSON }
  }

  private static func keyOf(_ input: String) -> String {
    input.trimmingCharacters(in: spaces).precomposedStringWithCanonicalMapping
  }

  private static func normalize(_ raw: JSONValue) throws -> Item {
    guard case .object(let data) = raw,
      let key = data["key"]?.stringValue.map(keyOf), !key.isEmpty,
      let title = data["title"]?.stringValue?.trimmingCharacters(in: spaces),
      !title.isEmpty, title.utf16.count <= 500,
      case .array(let entries) = data["after"]
    else { throw Failure.invalidItem }
    var seen = Set<String>()
    var after: [String] = []
    for entry in entries {
      guard let reference = entry.stringValue.map(keyOf) else { throw Failure.invalidItem }
      if seen.insert(reference).inserted { after.append(reference) }
    }
    let date = data["date"]?.stringValue ?? ""
    let time = data["time"]?.stringValue ?? ""
    let validDate = validDay(date)
    let validTime = validDate && time.utf16.count == 5 && time.range(
      of: #"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$"#, options: .regularExpression) != nil
    let note = data["note"]?.stringValue?.trimmingCharacters(in: spaces) ?? ""
    var bounded = note.utf16.prefix(5400)
    if let last = bounded.last, (0xD800...0xDBFF).contains(last) { bounded = bounded.dropLast() }
    return Item(key: key, title: title, note: String(decoding: bounded, as: UTF16.self),
      date: validDate ? date : "", time: validTime ? time : "", after: after)
  }

  private static func validDay(_ date: String) -> Bool {
    guard date.range(of: #"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"#, options: .regularExpression) != nil
    else { return false }
    let values = date.split(separator: "-").compactMap { Int($0) }
    guard values.count == 3, (1900...9999).contains(values[0]),
      (1...12).contains(values[1]) else { return false }
    let year = values[0], month = values[1], day = values[2]
    let leap = year.isMultiple(of: 4) && (!year.isMultiple(of: 100) || year.isMultiple(of: 400))
    let days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return (1...days[month - 1]).contains(day)
  }
}
