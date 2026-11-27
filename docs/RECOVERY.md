# 灾难恢复

数据的权威副本在服务器的 PostgreSQL；Mac 不保存唯一数据。三份东西合起来可以从零恢复：

| 在哪 | 是什么 |
| --- | --- |
| GitHub `main` | 全部源代码、部署脚本、迁移 |
| iCloud `个人决策团备份/新版数据库/` | 每日数据库备份（服务器先恢复验证过，Mac 复制时再核对校验和），保留最新 7 份 |
| iCloud `个人决策团备份/恢复说明.md` | 本机专属信息：服务器地址、端口、域名、目录（不含任何私钥） |

服务器备份脚本保留最近 3 份，以及最近 4 个有备份的 UTC 周、6 个有备份的 UTC 月里各自最新的一份。重合的恢复点只占一份。新备份在空库恢复后，核对同一快照的变更头、回执、金额、文稿摘要，并附 SHA-256 校验和。服务器目录为 `/var/backups/council-next/`。

## 情况一：Mac 丢失或损坏（服务器正常）

数据不受影响；手机与网页继续直接和服务器同步。新 Mac 上：

1. 安装 Xcode、Node 24、Docker Desktop；登录同一个 iCloud 与 Apple ID。
2. `git clone https://github.com/YouMingKaMi/SELF_OS_public.git`，`npm ci`。
3. 按 iCloud 里的《恢复说明》写 `infra/deploy/site.env`。
4. 让新 Mac 能登录服务器：新 Mac 生成 SSH 钥匙（`ssh-keygen -t ed25519`），通过 VPS 服务商的网页控制台把公钥加到服务器 `/root/.ssh/authorized_keys`。旧钥匙同时删掉。
5. `sh infra/deploy/install-backup-agent.sh` 恢复每日 iCloud 备份。
6. 重新给手机装 App（见下）。

## 情况二：服务器丢失

1. 新开一台 Debian 12 服务器，`ssh root@新地址 'sh -s' < infra/deploy/install.sh`。
2. 把 iCloud 里最新的 `council-*.dump` 传上去，恢复：
   `su postgres -c "pg_restore -d council_next --no-owner --exit-on-error /路径/council-xxx.dump"`
3. 写 `/etc/council-next/api.env`（模板 `infra/deploy/api.env.example`），装 Caddy，`site.env` 改成新地址。部署阶段先保持客户端的访问关闭。
4. 使用 Node 24 在仓库根目录运行 `node scripts/rotate-restored-generation.ts`，通过 `DATABASE_URL` 显式指定刚恢复的数据库。脚本先执行兼容迁移，再切换恢复代际和清理旧快照。
5. 用支持恢复的新版本打开网页或 iPhone，并同步一次。设备会完整暂存服务端快照，再一次性切换已确认记录和同步位置。打开「设置」查看恢复前的本机修改，可选择重新提交或采用恢复出的记录。如果网页升级时其他旧标签页仍打开，关闭旧标签页后重新打开新版网页。
6. 恢复后的账本强制校验代际。旧网页、旧 iPhone 和旧微信记账工具需要更新后才能继续同步，本机数据会保留。新版微信记账工具检测到代际切换后会暂停自动记账并保留旧配置的本机副本。核对最近的支付，按需手动补录后再开启自动记账。

新版客户端先核对恢复出的快照与本机待发操作。原设备的已接受回执、原请求内容和快照记录版本一致时，会移除已完成的待发操作。对预算、指标、习惯和准备清单的单次新增，如果同一月份或日期下只有一条快照记录且全部字段一致，也会确认该操作。批次需要完整证明，同一记录上较早的未确认编辑会保留后续编辑的审核。

如果备份里缺少确凿证据，草稿仍保存在审核队列。只有用户选择保留本机版本时，才会以恢复出的记录为基线提交新的操作。

恢复点对应数据库生成备份快照的时刻。更晚的变更取决于现有客户端留存的草稿及独立导出的记录。恢复后先检查两台设备的同步状态和待处理操作，再恢复日常写入。

## 容量检查

在有数据库只读权限的环境显式传入 `DATABASE_URL`，运行 `node scripts/sync-capacity.mjs`。输出数据库、索引、快照、回执空间和当前锁等待数。服务器备份作业另外记录归档大小、恢复耗时和总耗时。持续采样与本机告警可独立启用。 [监测说明](MONITORING.md)

迁移 0019 后，可用 `node scripts/sync-receipt-retention.mjs preview` 查看可归档数。设备须已明确撤销超过 180 天，回执也须超过 180 天。手动执行 `archive` 每次最多移动 5000 条，回执继续参与原请求去重并随备份保留。若回退到迁移 0019 之前的服务版本，先执行 `recover` 把回执移回原表。

正常使用或长期离线的设备继续保留回执。已删除记录继续作为墓碑参与引用、恢复和跨设备同步。

## 情况三：两者都没了

先按情况一准备新 Mac，再按情况二重建服务器；数据来自 iCloud 备份，代码来自 GitHub。

## iPhone App 的签名

用免费 Apple ID 安装的 App 签名只有 7 天，到期后打不开，需要 Mac 重新构建安装（数据在手机和服务器上，不会丢）：

```
cd apps/ios && xcodebuild -project CouncilStudio.xcodeproj -scheme CouncilStudio \
  -destination 'id=<手机UDID>' -allowProvisioningUpdates DEVELOPMENT_TEAM=<团队ID> \
  COUNCIL_ENDPOINT=https://<你的域名> build
```

付费开发者账号签名为一年。网页版不受影响，随时可用。

## 已验证

2026-11-11：从 iCloud 中的备份恢复到空数据库，25 类、1058 条记录与线上逐类一致，已配对设备一并恢复。
