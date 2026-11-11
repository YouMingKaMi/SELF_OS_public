import Foundation

public enum JSONValue: Codable, Sendable, Equatable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case array([JSONValue])
  case object([String: JSONValue])
  case null
  public init(from decoder: any Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let v = try? c.decode(Bool.self) {
      self = .bool(v)
    } else if let v = try? c.decode(String.self) {
      self = .string(v)
    } else if let v = try? c.decode(Double.self) {
      self = .number(v)
    } else if let v = try? c.decode([JSONValue].self) {
      self = .array(v)
    } else {
      self = .object(try c.decode([String: JSONValue].self))
    }
  }
  public func encode(to encoder: any Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .string(let v): try c.encode(v)
    case .number(let v): try c.encode(v)
    case .bool(let v): try c.encode(v)
    case .array(let v): try c.encode(v)
    case .object(let v): try c.encode(v)
    case .null: try c.encodeNil()
    }
  }
  public var text: String {
    switch self {
    case .string(let v): return v
    case .number(let v): return String(v)
    case .bool(let v): return v ? "true" : "false"
    default: return ""
    }
  }
  public var double: Double {
    if case .number(let v) = self { return v }
    return Double(text) ?? 0
  }
  public var boolean: Bool {
    if case .bool(let v) = self { return v }
    return false
  }
  public var strings: [String] {
    if case .array(let values) = self { return values.map(\.text) }
    return []
  }
  // Strict readers used by the generated typed structs: nil when the value has another shape.
  public var stringValue: String? {
    if case .string(let v) = self { return v }
    return nil
  }
  public var numberValue: Double? {
    if case .number(let v) = self { return v }
    return nil
  }
  public var boolValue: Bool? {
    if case .bool(let v) = self { return v }
    return nil
  }
  public var stringsValue: [String]? {
    if case .array(let values) = self { return values.compactMap(\.stringValue) }
    return nil
  }
}
extension Record {
  public func text(_ key: String, _ fallback: String = "") -> String { data[key]?.text ?? fallback }
  public func number(_ key: String) -> Double { data[key]?.double ?? 0 }
  public func flag(_ key: String) -> Bool { data[key]?.boolean ?? false }
  public var title: String { text("title", text("name", text("body"))) }
}
/// A task's plan as screens think about it. Stored flat on the entity (`scheduleKind`, …) so it can be queried.
public struct Schedule: Codable, Sendable, Equatable {
  public var kind: String
  public var date: String?
  public var start: String?
  public var end: String?
  public init(kind: String, date: String? = nil, start: String? = nil, end: String? = nil) {
    self.kind = kind
    self.date = date
    self.start = start
    self.end = end
  }
}
public enum BusinessDate {
  public static func day(_ date: Date = Date()) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "Asia/Shanghai")
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: date)
  }
}
