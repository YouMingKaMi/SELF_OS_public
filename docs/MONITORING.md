# 本机监测

SELF OS 每 15 分钟可进行一次本机采样。监测服务使用专用本机账号和 PostgreSQL peer 认证，只读取系统统计。采样保留最多 7 天、672 条。记录包含计数、空间、耗时和探测状态。告警与恢复事件进入服务器日志。

## 启用和查看

1. 分别发布最新 API 和服务器配置，使每日备份服务能写入已验证归档的状态。 [部署说明](deploy.md)
2. 如需覆盖阈值，将 `infra/deploy/monitor.env.example` 复制到服务器的 `/etc/council-next/monitor.env` 后调整相应值。默认配置可以直接使用。
3. 在获准发布时，从仓库根目录运行 `sh infra/deploy/deploy.sh monitor`。独立模式安装并启用监测定时器。
4. 在服务器用 `systemctl start council-next-monitor.service` 立即采样。使用 `journalctl -u council-next-monitor.service` 查看状态变化，使用 `journalctl -u council-next-monitor.service -p warning` 筛选告警。完整采样在 `/var/lib/council-next-monitor/history.json`。

## 采样和排查

| 检查 | 默认判定 | 排查入口 |
| --- | --- | --- |
| API | 本机保护路由按预期返回 401，耗时不超过 1.5 秒 | `systemctl status council-next-api.service` |
| 数据库 | 统计查询在限定时间内完成，同库等待锁的数量不超过 2 | PostgreSQL 服务状态、锁、索引与回执增长 |
| 磁盘 | 数据库卷与备份卷的使用率均低于 85% | 核对挂载、可用空间和保留策略 |
| 已验证备份 | 上次成功的恢复校验对应快照不早于 36 小时前 | `journalctl -u council-next-backup.service` |

同一异常须连续出现两次才能触发。持续异常每 60 分钟最多重复一次。出现正常样本后记录本机恢复事件。首次部署后，新的备份状态在下一次成功验收归档后出现。可以用 `systemctl disable --now council-next-monitor.timer` 停止并禁用监测定时器。

容量样本保留数据库和索引空间、回执与快照所占空间、估算记录数、数据库累计读取元组数、当前锁等待和磁盘可用空间。24 小时的 p50/p95 表示本机探测耗时。连续采样的累计计数可用于查看增长。真实用户请求、浏览器或 iPhone 的离线队列耗时以及首次安装仍需独立采样。
