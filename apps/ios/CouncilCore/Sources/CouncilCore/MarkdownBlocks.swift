import Foundation

/// A small native block model. Untrusted HTML remains text; no WebView or executable content.
public struct MarkdownBlock: Sendable, Equatable {
  public enum Kind: Sendable, Equatable {
    case heading(Int)
    case paragraph
    case bullet(String)
    case quote
    case code(String)
    case divider
  }
  public let kind: Kind
  public let text: String
  public init(kind: Kind, text: String) {
    self.kind = kind
    self.text = text
  }
}
public enum MarkdownBlocks {
  public static func parse(_ source: String) -> [MarkdownBlock] {
    var result: [MarkdownBlock] = []
    var paragraph: [String] = []
    var code: [String] = []
    var fence: String?
    var language = ""
    func flush() {
      if !paragraph.isEmpty {
        result.append(MarkdownBlock(kind: .paragraph, text: paragraph.joined(separator: "\n")))
        paragraph = []
      }
    }
    for line in source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      if let marker = fence {
        if trimmed.hasPrefix(marker) {
          result.append(MarkdownBlock(kind: .code(language), text: code.joined(separator: "\n")))
          code = []
          fence = nil
        } else {
          code.append(line)
        }
        continue
      }
      if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
        flush()
        fence = String(trimmed.prefix(3))
        language = String(trimmed.dropFirst(3))
        continue
      }
      if trimmed.isEmpty {
        flush()
        continue
      }
      let hashes = trimmed.prefix { $0 == "#" }.count
      if (1...6).contains(hashes), trimmed.dropFirst(hashes).first == " " {
        flush()
        result.append(
          MarkdownBlock(kind: .heading(hashes), text: String(trimmed.dropFirst(hashes + 1))))
        continue
      }
      if ["---", "***", "___"].contains(trimmed) {
        flush()
        result.append(MarkdownBlock(kind: .divider, text: ""))
        continue
      }
      if trimmed.hasPrefix("> ") {
        flush()
        result.append(MarkdownBlock(kind: .quote, text: String(trimmed.dropFirst(2))))
        continue
      }
      if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("+ ") {
        flush()
        result.append(MarkdownBlock(kind: .bullet("•"), text: String(trimmed.dropFirst(2))))
        continue
      }
      if let dot = trimmed.firstIndex(of: "."), dot != trimmed.startIndex,
        trimmed[..<dot].allSatisfy(\.isNumber), trimmed[trimmed.index(after: dot)...].hasPrefix(" ")
      {
        flush()
        result.append(
          MarkdownBlock(
            kind: .bullet(String(trimmed[...dot])),
            text: String(trimmed[trimmed.index(dot, offsetBy: 2)...])))
        continue
      }
      paragraph.append(line)
    }
    flush()
    if fence != nil {
      result.append(MarkdownBlock(kind: .code(language), text: code.joined(separator: "\n")))
    }
    return result
  }
}
