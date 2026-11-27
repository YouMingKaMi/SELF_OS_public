# 代码结构

```
apps/web                  网页（React）。界面只通过 src/data 读写数据，不直接碰网络或本地数据库
apps/macos                macOS 原生桌面壳（WKWebView，同源下载与安全导出保存）
apps/ios/CouncilStudio    iPhone App（SwiftUI）
apps/ios/CouncilWidgets   iPhone 今日任务小组件扩展
apps/ios/CouncilCore      iPhone 的本地数据库、同步和计算规则（Swift 包，可单独测试）
apps/android              Android 原生安全壳（Kotlin + Gradle + 签名 APK，支持 Edge-to-Edge 与 SAF 导出）
packages/contracts        所有数据类型的唯一定义（schema.ts），其他东西都从它生成
modules/kernel            与业务无关的同步内核：保存、版本、冲突、变化记录、设备身份、作用域快照
modules/<业务>            每个业务的规则，都是纯函数（finance、habits、tasks、treasury、storage、workspace…）
services/api              HTTP 接口，把上面这些组装起来
services/council-query    只读查询服务
services/council-gemini   经 OAuth PKCE 授权的只读 Gemini 连接器（可选）
infra                     数据库迁移（0001–0024）、部署与监测脚本
tools                     本机微信支付记账桥（可选）与迁移工具
tests                     单元测试、PostgreSQL 集成测试与浏览器端到端测试
```

## 几个关键设计

**一份定义，到处生成。** 加一个字段只改 `packages/contracts/schema.ts`，然后运行 `npm run contracts:generate` 和 `npm run db:migration -- <名字>`，TypeScript 类型、服务端校验、数据库迁移、iPhone 的表结构和接口文档都会跟着生成。

**一条同步协议。** 所有数据走同两个接口：`POST /v1/commands` 提交一次修改，`GET /v1/changes` 按游标拉取变化。每次修改带一个唯一编号，重复提交不会重复生效；两端改了同一条时，服务器返回当前版本，由用户决定保留哪个。`GET /v1/events` 只推送"有变化了"的提示，真正的数据仍然靠游标拉取。

**先存本机，再同步。** 网页用 IndexedDB，iPhone 用 SQLite。写入先落到本机和一个待发送队列，界面立刻更新；网络通了再按顺序发出去。

**规则是纯函数。** 花销摊销、习惯是否完成、资产估值、自由天数这些计算不依赖界面、数据库或当前时间，所以网页和服务端可以共用同一份，iPhone 上有对应的 Swift 实现，并用同一批测试样例核对。

**设备身份。** 服务器上生成一次性连接码，设备用它换一个可撤销的凭证：手机存在钥匙串里，网页是浏览器脚本读不到的 cookie。请求属于谁由凭证决定。

## 开发

```bash
npm run verify            # 结构检查 + 生成物是否最新 + 类型检查 + 单元测试
npm run test:integration  # 接真实数据库的同步测试（需要先启动 infra/compose.yaml 的数据库）
```

`scripts/check.mjs` 会检查上面的分层有没有被破坏，例如界面直接访问网络、业务规则引用了数据库。
