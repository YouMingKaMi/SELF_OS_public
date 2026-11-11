# API · 本地开发版

三个文件，各一个职责：

- `compose.ts`：组合根。唯一知道所有业务模块的地方；把各模块的规则注入同步内核，并拒绝模块给别人的实体挂规则。
- `app.ts`：HTTP 适配。认证、校验信封、调用用例、把规则错误映射为 400/409。不含业务逻辑。
- `server.ts`：进程入口。读环境变量、执行数据库迁移、监听端口。

接口只有两个：`POST /v1/commands`（写）与 `GET /v1/changes`（按游标拉取），契约见 packages/contracts/openapi.json（生成物）。

只监听 127.0.0.1:8899。当前是 local-demo 开发身份与进程 Bearer 令牌，不是生产认证；`Authenticate` 是将来接入设备配对时唯一需要替换的点。可用 COUNCIL_API_PORT / COUNCIL_DEV_OWNER 启动隔离的测试实例。

推荐在项目根运行 `npm run dev`，由启动器给两个本地进程注入同一个随机密钥；它不会进入前端包。独立运行 API 时，自行设置至少 24 位 COUNCIL_DEV_TOKEN，再执行 `npm run api`。

数据库见 infra/compose.yaml，默认 127.0.0.1:55439/council_next。表建在 PostgreSQL schema `council` 中，由 infra/migrations 的编号迁移创建（启动时自动执行，已执行的迁移文件不可修改）。重构前的开发表仍留在 `public` schema，未被读取也未被删除。

验证：`npm run verify`、`npm run test:integration`。数据库测试只清理各自随机测试身份的合成资料。
