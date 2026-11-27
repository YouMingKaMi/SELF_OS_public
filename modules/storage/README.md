# 储物箱

`storage` 拥有储物箱 `storageBox` 和物品 `storageItem`。Web 与 iPhone 通过 v1 命令和变化流读写，两种实体由[统一契约](../../packages/contracts/schema.ts)定义。

- 箱子保存时修剪场景和名称的首尾空白，物品保存时修剪名称的首尾空白。
- `storageBox.parentId` 是 v1 的可选箱子引用。没有父箱的记录是顶层箱子。用 patch 换父箱时写入新的 `parentId`，省略时保留原值，传 `null` 时移到顶层。
- 设置或修改父箱、恢复带父箱的记录时，服务端沿父箱链检查。修改或恢复时的自引用，以及跨层环路，返回 `STORAGE_BOX_CYCLE`。父箱不存在、已删除或属于其他所有者时返回 `MISSING_REFERENCE:parentId`。新建时引用自己的 ID 也会被拒绝，此时通用引用校验先返回 `MISSING_REFERENCE:parentId`。
- `in_box` 需要 `boxId`，缺少时返回 `STORAGE_BOX_REQUIRED`。`out` 可保留或清除当前位置和取出时间。两个箱子引用都由同步内核检查是否指向同一所有者的有效箱子。
- 归位可用一条 patch 同时写入 `status: "in_box"`、目标 `boxId` 和 `takenAt: null`。patch 保留省略的字段，服务端保留调用方提供的合法时间戳。
- 箱子有未删除的子箱，或者被未删除的物品通过 `boxId` 或 `homeBoxId` 引用时，删除返回 `STORAGE_BOX_NOT_EMPTY`。先移动或删除子箱，并处理物品引用，再删除父箱。
- 发布时先应用 `0022_storage_box_parent.sql` 并更新 API，再更新 Web 与 iPhone。迁移为已有箱子保留空的 `parent_id`。
