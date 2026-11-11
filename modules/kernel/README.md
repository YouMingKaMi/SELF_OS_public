# kernel

同步协议的唯一实现，不含任何业务知识。

- `domain/normalize.ts`：按 schema 校验并规范化载荷（纯函数）。
- `application/sync.ts`：`SyncService.execute`（幂等回执、版本冲突、引用检查、调用模块规则、保存）与 `changes`（游标拉取）。
- `application/ports.ts`：`Store` / `Transaction` 端口，以及业务模块声明规则用的 `EntityRule`、`Reader`。
- `adapters/postgres.ts`：端口的 PostgreSQL 实现；`adapters/ddl.ts`、`migrate.ts`：由 schema 生成 DDL 与迁移执行；`adapters/memory.ts`：测试替身。

公开入口：`index.ts`（给业务模块，仅类型）、`server.ts`（给服务端组合根）。kernel 不得导入任何业务模块；业务模块只能经 `index.ts` 使用 kernel。

变更流：每个实体在 `sync_heads` 只有一行，指向其最新修订；拉取时取实体当前状态。因此反复保存长文不会让变更流增长，回执也不保存正文。回执清理（按设备水位）尚未实现。
