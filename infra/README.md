# 部署配置

正式环境：单台 Debian 12 服务器，Caddy（TLS、静态网页、`/v1` 反向代理）→ Node API（127.0.0.1:8790）→ PostgreSQL 18（仅本地套接字，peer 认证，无密码）。

| 文件 | 用途 |
| --- | --- |
| deploy/install.sh | 一次性、可重复执行：安装 PGDG PostgreSQL 18 与固定版本 Node（核对 SHASUMS256），建 `council` 用户与库、目录 |
| deploy/deploy.sh | 本机执行：构建网页，只同步服务端代码/契约/迁移与网页产物，`npm ci --omit=dev`，重启服务 |
| deploy/api.env.example | `/etc/council-next/api.env` 模板；不含任何密钥 |
| deploy/council-next-api.service | API systemd 单元（只读文件系统、无特权、内存上限） |
| deploy/council.caddy | 9443 站点：安全头、CSP、SSE 不缓冲、日志删除 Cookie/Authorization/IP |
| deploy/backup.sh + backup.service/timer | 每日 pg_dump → 恢复到临时库逐表核对 → 保留最新 3 份 |
| deploy/pull-backup.sh | Mac 把最新的已验证备份复制到 iCloud「SELF OS 备份/数据库」，核对校验和，保留最新 7 份 |
| deploy/install-backup-agent.sh | 在 Mac 上安装每日 13:00 自动执行上面这一步（LaunchAgent），日志在 ~/Library/Logs/CouncilNext |

设备管理（在服务器上执行，不经 HTTP）：

```sh
cd /opt/council-next/app && sudo -u council env DATABASE_URL='postgresql://council@/council_next?host=/var/run/postgresql' \
  /opt/council-next/node/bin/node services/api/admin.ts pair --name "iPhone" --kind phone   # 或 --kind web
# devices 列出；revoke <deviceId> 撤销
```

服务器地址不入库：`deploy.sh` 读取本机 `infra/deploy/site.env`（已在 .gitignore，示例见 deploy.sh 顶部）；iPhone 默认服务地址在构建时注入：`xcodebuild … COUNCIL_ENDPOINT=https://你的域名`，不注入时在设置里手填。

本地开发仍用 compose.yaml 的 PostgreSQL 与 `COUNCIL_DEV_TOKEN` 开发身份。

完整的部署步骤见 [docs/deploy.md](../docs/deploy.md)。
