# SELF OS 的 ChatGPT 只读连接

原插件的三项能力为 `council_status`、`council_read` 和 `council_expenses_summary`。连接走 OpenAI Secure MCP Tunnel。查询程序与连接程序通过标准输入输出通信。公开站点和同步 API 无需加路由。

## 部署

1. 部署 `services/council-query` 和内核 PostgreSQL 入口。服务器应用代码位于 `/opt/council-next/app`。
2. 以 root 运行 `sh infra/deploy/configure-council-query.sh`。脚本确认数据库只有一个资料拥有者，建立独立 PostgreSQL 读取角色，并写入绑定资料库的配置。
3. 以 root 运行 `sh infra/deploy/install-council-tunnel.sh`，安装并校验 [OpenAI 发布的 Linux 连接程序](https://github.com/openai/tunnel-client/releases/tag/v0.0.21)。
4. 在服务器以 root 限权保存现有隧道 ID 和专用运行密钥，文件分别为 `/etc/council-next/query-tunnel.env`（`COUNCIL_QUERY_TUNNEL`）及 `/etc/council-next/query-tunnel.key`。两者权限为 `0600`。systemd 通过凭证目录把密钥提供给常驻进程。密钥不属于仓库或数据库备份。
5. 安装 `infra/deploy/council-next-query.service` 至 `/etc/systemd/system/`，执行 `systemctl daemon-reload` 和 `systemctl enable --now council-next-query`。用 `curl -fsS "$(cat /run/council-next-query/health.url)/readyz"` 确认在线，再从已安装的 ChatGPT 插件实际调用状态工具。

## 数据范围

只查询已经同步到服务器的资料。笔记、思考、月报和原料由 `data.kind` 区分。花销以人民币分进行精确运算，回收冲减原购买日。国库可读钱包变动及市场价格，旧接口的独立国库历史快照在新版中没有对应记录。单条正文超过 16,000 个字符时会标记截断，完整版可在 SELF OS 中查看。

分页查询按已绑定的资料拥有者、栏目和日期筛选。普通分页在同一个只读数据库快照中核对修订号、统计总数并选出页内记录，再读取这些记录的正文。带关键词的查询也先按这些条件缩小候选范围，随后沿用原有的 Unicode 子串匹配规则。没有日期或 ID 条件的关键词查询仍可能扫描整栏。花销汇总只从数据库读取要求月份截至范围内的支出和用途分类。
