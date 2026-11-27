# 全系统网页工作区

从项目根目录启动新版专用数据库，然后启动网页：

```sh
docker compose -f infra/compose.yaml up -d db
npm ci
npm run dev
```

入口：http://127.0.0.1:8900/home。API 固定 8899，数据库固定 55439，不会为了端口冲突自动换到另一个地址。

首次需要合成资料时，在项目根目录执行 `npm run seed`。这些脚本只作用于新版开发库，不读取旧系统。已有同 ID 修改不会被种子覆盖。

包含工作区标签与分屏、工作区模块定制、首页布局、部门与快捷入口、全局搜索、推进台、任务、习惯、账本、国库、自由指南灯、储物箱、回忆录、成就、文章、逐日记录、指标、重要日子和准备清单。整体架构见 [docs/architecture.md](../../docs/architecture.md)。

`npm run dev` 构建网页，再同时启动 API 和预览；两者使用进程内随机开发密钥，密钥不注入浏览器代码。Ctrl+C 停止两个服务。使用固定 local-demo 开发身份，正式配对尚未接入，不能直接公开部署。

记录先保存在 IndexedDB（库名 council-next-v2），每条操作单独排队；在线后自动同步。数据层在 src/data：页面只通过 entities.ts / tasks.ts 读写，某类实体在首次被页面订阅时才从磁盘读入，一次写入只通知订阅该类型的页面。页面壳与按功能拆分的编译资源由 Service Worker 缓存，API 结果不进入页面缓存。所有功能内页均支持离线刷新；首次需在线完成缓存。

两个设备修改同一条记录时保留冲突，支持采用服务器版本或重新提交本机最终状态。结果不明的发送保留原操作 ID 重试。尚未发送的最后一笔操作可撤销；删除使用版本化回收站记录。

验证：`npm run verify`、`npm run test:integration`、`npm run test:browser`。浏览器测试使用本机 Google Chrome 和独立临时资料。

依赖用途：React/React DOM 界面，Vite 构建，idb 本机事务，react-markdown 安全 Markdown 阅读，lunar-typescript 农历转换，Playwright 交互验收。准确版本在根 package-lock.json。官方来源在各依赖包的 npm/GitHub 项目页；没有复用旧工程组件。
