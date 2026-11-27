import XCTest

@testable import CouncilCore

final class StorageTests: XCTestCase {
  private let boxID = "00000000-0000-4000-8000-000000000001"
  private let homeBoxID = "00000000-0000-4000-8000-000000000002"
  private let takenAt = "2026-11-26T10:00:00.000Z"
  private let verifiedAt = "2026-11-25T10:00:00.000Z"

  func testStorageBoxFieldsRoundTripThroughWireRecord() throws {
    let full = StorageBoxFields(
      zone: "宿舍", name: "抽屉", parentId: homeBoxID, icon: "box", location: "书桌左侧", order: 1.5)
    let minimal = StorageBoxFields(zone: "随身", name: "双肩包")
    let fullRecord = try roundTrip(full.data, type: StorageBoxFields.entityType)
    let minimalRecord = try roundTrip(minimal.data, type: StorageBoxFields.entityType)

    XCTAssertEqual(fullRecord.type, "storageBox")
    XCTAssertEqual(fullRecord.data, [
      "zone": .string("宿舍"), "name": .string("抽屉"), "parentId": .string(homeBoxID),
      "icon": .string("box"),
      "location": .string("书桌左侧"), "order": .number(1.5),
    ])
    XCTAssertEqual(minimalRecord.data, ["zone": .string("随身"), "name": .string("双肩包")])
    XCTAssertEqual(StorageBoxFields(fullRecord), full)
    XCTAssertEqual(StorageBoxFields(minimalRecord), minimal)
  }

  func testStorageItemFieldsRoundTripThroughWireRecord() throws {
    let full = StorageItemFields(
      name: "耳机", icon: "🧑‍💻", status: "out", boxId: boxID, homeBoxId: homeBoxID, takenAt: takenAt,
      quantity: 2, aliases: "蓝牙耳机", note: "附充电线", verifiedAt: verifiedAt)
    let minimal = StorageItemFields(name: "充电宝", status: "out")
    let fullRecord = try roundTrip(full.data, type: StorageItemFields.entityType)
    let minimalRecord = try roundTrip(minimal.data, type: StorageItemFields.entityType)

    XCTAssertEqual(fullRecord.type, "storageItem")
    XCTAssertEqual(fullRecord.data, [
      "name": .string("耳机"), "icon": .string("🧑‍💻"), "status": .string("out"), "boxId": .string(boxID),
      "homeBoxId": .string(homeBoxID), "takenAt": .string(takenAt), "quantity": .number(2),
      "aliases": .string("蓝牙耳机"), "note": .string("附充电线"), "verifiedAt": .string(verifiedAt),
    ])
    XCTAssertEqual(minimalRecord.data, ["name": .string("充电宝"), "status": .string("out")])
    XCTAssertEqual(StorageItemFields(fullRecord), full)
    XCTAssertEqual(StorageItemFields(minimalRecord), minimal)
  }

  func testSQLiteRoundTripForBoxesAndItems() async throws {
    let store = try CouncilStore(path: ":memory:")
    let box = StorageBoxFields(
      zone: "随身", name: "双肩包", icon: "bag", location: "前袋", order: 2.5)
    let homeBox = StorageBoxFields(zone: "宿舍", name: "抽屉")
    let currentID = try await store.put(type: StorageBoxFields.entityType, data: box.data)
    let homeID = try await store.put(type: StorageBoxFields.entityType, data: homeBox.data)

    let item = StorageItemFields(
      name: "耳机", status: "in_box", boxId: currentID, homeBoxId: homeID,
      quantity: 1, aliases: "蓝牙耳机", note: "附充电线", verifiedAt: verifiedAt)
    let itemID = try await store.put(type: StorageItemFields.entityType, data: item.data)
    let savedBox = try await store.record(type: StorageBoxFields.entityType, id: currentID)
    let savedHome = try await store.record(type: StorageBoxFields.entityType, id: homeID)
    let savedItem = try await store.record(type: StorageItemFields.entityType, id: itemID)

    XCTAssertEqual(StorageBoxFields(try XCTUnwrap(savedBox)), box)
    XCTAssertEqual(StorageBoxFields(try XCTUnwrap(savedHome)), homeBox)
    let original = try XCTUnwrap(savedItem)
    XCTAssertEqual(StorageItemFields(original), item)

    var taken = item
    taken.status = "out"
    taken.takenAt = takenAt
    try await store.put(type: StorageItemFields.entityType, data: taken.data, id: itemID, editBase: original)
    let updatedItem = try await store.record(type: StorageItemFields.entityType, id: itemID)
    XCTAssertEqual(StorageItemFields(try XCTUnwrap(updatedItem)), taken)
  }

  func testItemIconRoundTripAndClearInSQLite() async throws {
    let store = try CouncilStore(path: ":memory:")
    let type = StorageItemFields.entityType
    var item = StorageItemFields(name: "耳机", icon: "earphone", status: "out")
    let id = try await store.put(type: type, data: item.data)
    let saved = try await store.record(type: type, id: id)
    let original = try XCTUnwrap(saved)
    XCTAssertEqual(StorageItemFields(original), item)

    item.icon = "🧑‍💻"
    try await store.put(type: type, data: item.data, id: id, editBase: original)
    let updated = try await store.record(type: type, id: id)
    let withEmoji = try XCTUnwrap(updated)
    XCTAssertEqual(StorageItemFields(withEmoji), item)

    item.icon = nil
    try await store.put(type: type, data: item.data, id: id, editBase: withEmoji)
    let cleared = try await store.record(type: type, id: id)
    let clearedRecord = try XCTUnwrap(cleared)
    XCTAssertNil(clearedRecord.data["icon"])
    XCTAssertEqual(StorageItemFields(clearedRecord), item)

    let operations = try await store.operations()
    let last = try XCTUnwrap(operations.last)
    let command = try JSONDecoder().decode(Command.self, from: last.data)
    XCTAssertEqual(command.action, "patch")
    XCTAssertEqual(command.data, ["icon": .null])
  }

  func testSubboxParentRoundTripAndClearInSQLite() async throws {
    let store = try CouncilStore(path: ":memory:")
    let parent = StorageBoxFields(zone: "随身", name: "双肩包")
    let parentID = try await store.put(type: StorageBoxFields.entityType, data: parent.data)
    var child = StorageBoxFields(zone: "随身", name: "前袋", parentId: parentID)
    let childID = try await store.put(type: StorageBoxFields.entityType, data: child.data)

    let saved = try await store.record(type: StorageBoxFields.entityType, id: childID)
    let original = try XCTUnwrap(saved)
    XCTAssertEqual(StorageBoxFields(original), child)

    child.parentId = nil
    try await store.put(type: StorageBoxFields.entityType, data: child.data, id: childID, editBase: original)
    let updated = try await store.record(type: StorageBoxFields.entityType, id: childID)
    let detached = try XCTUnwrap(updated)
    XCTAssertNil(detached.data["parentId"])
    XCTAssertEqual(StorageBoxFields(detached), child)
  }

  private func roundTrip(_ data: [String: JSONValue], type: String) throws -> Record {
    let record = Record(
      id: boxID, type: type, version: 1, data: data, deleted: false, updatedAt: verifiedAt)
    return try JSONDecoder().decode(Record.self, from: JSONEncoder().encode(record))
  }
}
