import Foundation

/// A derived, local search index. It is rebuilt from projected records, including offline edits.
public actor DocumentSearchIndex {
  private static let bucketCount = 1 << 15
  private static let rowsPerBlock = UInt32.bitWidth

  private struct SearchText: Equatable {
    let title: String
    let body: String

    init(_ record: Record) {
      title = record.title
      body = record.text("body")
    }
  }

  private struct Block {
    var buckets = [UInt32](repeating: 0, count: bucketCount)
    var ids = [String](repeating: "", count: rowsPerBlock)
  }

  private let locale = Locale.current
  private var blocks: [Block] = []
  private var slots: [String: Int] = [:]
  private var source: [String: SearchText] = [:]
  private var freeSlots: [Int] = []
  private var nextSlot = 0
  private var ordered: [Record] = []
  private var indexedKind: String?
  private var indexedRevision: Int?

  public init() {}

  public func search(kind: String, at revision: Int, records: [Record], query: String) -> [Record] {
    if Task.isCancelled { return [] }
    if indexedKind != kind || indexedRevision != revision {
      let current = records.filter { !$0.deleted && $0.type == "document" && $0.text("kind") == kind }
      let live = Set(current.map(\.id))
      for id in slots.keys.filter({ !live.contains($0) }) {
        if let slot = slots.removeValue(forKey: id), let text = source.removeValue(forKey: id) {
          write(text, slot: slot, add: false)
          freeSlots.append(slot)
        }
      }
      for record in current {
        let text = SearchText(record)
        if source[record.id] == text { continue }
        let slot: Int
        if let existing = slots[record.id], let old = source[record.id] {
          slot = existing
          write(old, slot: slot, add: false)
        } else {
          if let available = freeSlots.popLast() {
            slot = available
          } else {
            slot = nextSlot
            nextSlot += 1
          }
          let block = slot / Self.rowsPerBlock
          if block == blocks.count { blocks.append(Block()) }
          slots[record.id] = slot
          blocks[block].ids[slot % Self.rowsPerBlock] = record.id
        }
        source[record.id] = text
        write(text, slot: slot, add: true)
      }
      ordered = current.sorted {
        $0.updatedAt == $1.updatedAt ? $0.id < $1.id : $0.updatedAt > $1.updatedAt
      }
      indexedKind = kind
      indexedRevision = revision
    }
    if query.isEmpty { return ordered }

    let queryUnits = units(query)
    if queryUnits.isEmpty { return [] }
    let width = min(3, queryUnits.count)
    var keys = Set<Int>()
    for offset in 0...(queryUnits.count - width) {
      keys.insert(Self.bucket(
        queryUnits[offset],
        width > 1 ? queryUnits[offset + 1] : 0,
        width > 2 ? queryUnits[offset + 2] : 0
      ))
    }
    var matches = Set<String>()
    for block in blocks {
      var candidates = UInt32.max
      for key in keys {
        candidates &= block.buckets[key]
        if candidates == 0 { break }
      }
      while candidates != 0 {
        let id = block.ids[candidates.trailingZeroBitCount]
        if let text = source[id],
          text.title.localizedCaseInsensitiveContains(query) || text.body.localizedCaseInsensitiveContains(query)
        {
          matches.insert(id)
        }
        candidates &= candidates - 1
      }
    }
    return ordered.filter { matches.contains($0.id) }
  }

  private func units(_ text: String) -> [Int] {
    text.folding(options: .caseInsensitive, locale: locale)
      .precomposedStringWithCanonicalMapping.utf16.map { Int($0) + 1 }
  }

  private static func bucket(_ first: Int, _ second: Int = 0, _ third: Int = 0) -> Int {
    let hash = first * 31 + second * 993 + third * 30727
    return (hash ^ (hash >> 16)) & (bucketCount - 1)
  }

  private func write(_ text: SearchText, slot: Int, add: Bool) {
    let block = slot / Self.rowsPerBlock
    let bit = UInt32(1) << (slot % Self.rowsPerBlock)
    for value in [text.title, text.body] {
      let units = units(value)
      Self.write(&blocks[block].buckets, units: units, bit: bit, add: add)
    }
  }

  private static func write(_ buckets: inout [UInt32], units: [Int], bit: UInt32, add: Bool) {
    func change(_ key: Int) {
      if add { buckets[key] |= bit } else { buckets[key] &= ~bit }
    }
    for i in units.indices {
      change(bucket(units[i]))
      if i + 1 >= units.count { continue }
      change(bucket(units[i], units[i + 1]))
      if i + 2 < units.count { change(bucket(units[i], units[i + 1], units[i + 2])) }
    }
  }
}
