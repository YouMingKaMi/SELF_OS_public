# 契约：单一来源

`schema.ts` 是每个同步实体的唯一定义（字段、类型、必填、归属模块、表名）。`fields.ts` 是字段词汇表。其他一切都由它派生，不允许在别处再描述一遍字段：

| 派生物 | 方式 |
| --- | --- |
| TypeScript 类型 `EntityData<"expense">`、`Entity<T>` | 类型推导，无需生成 |
| 服务端入参校验与规范化 | modules/kernel/domain/normalize.ts 读取 schema |
| PostgreSQL 表、外键、CHECK、索引 | `npm run db:migration -- <name>` 生成 infra/migrations/NNNN_*.sql |
| iPhone 本地 SQLite 表、字段元数据、类型化结构体、信封模型 | `npm run contracts:generate` 生成 CouncilCore/Generated/*.swift |
| openapi.json | `npm run contracts:generate` |

`entities.ts` 是同步协议的信封（Command / Receipt / Changes）。协议只有两个入口：`POST /v1/commands`、`GET /v1/changes`。

## 改字段的步骤

1. 改 `schema.ts`。v1 只允许新增可选字段；其他变化要有 v2 计划。
2. `npm run contracts:generate`，再 `npm run db:migration -- 说明性名字`。
3. `npm run verify`：生成物、迁移锁文件与 schema 任何一处不一致都会失败。

当前只服务 local-demo 开发身份；设备配对、epoch、首次快照尚未实现。
