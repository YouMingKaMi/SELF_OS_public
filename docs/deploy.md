# 部署到自己的服务器

你需要：一台 Debian 12 的云服务器（1 核 1 GB 内存就够）、一个指向它的域名、能用 SSH 钥匙以 root 登录。

整体结构：Caddy（自动申请 HTTPS 证书、提供网页、转发接口）→ Node 接口服务 → PostgreSQL 数据库。数据库只监听本机，不对外开放。

## 1. 准备服务器

在自己电脑的项目目录里执行，把安装脚本送到服务器上运行。它会安装 PostgreSQL 18 和 Node.js，创建运行用的系统用户、数据库和目录，可以重复执行：

```bash
ssh root@你的服务器 'sh -s' < infra/deploy/install.sh
```

再在服务器上安装 [Caddy](https://caddyserver.com/docs/install#debian-ubuntu-raspbian)，并在 `/etc/caddy/Caddyfile` 末尾加一行：

```
import /etc/caddy/council.caddy
```

## 2. 写配置

服务器上新建 `/etc/council-next/api.env`（参照 `infra/deploy/api.env.example`），把 `COUNCIL_PUBLIC_ORIGIN` 改成你的网址，例如 `https://os.example.com`。这个文件里没有任何密码。

自己电脑上新建 `infra/deploy/site.env`（已被 git 忽略，不会上传）：

```
COUNCIL_SSH=root@你的服务器
COUNCIL_SSH_PORT=22
COUNCIL_SITE=os.example.com
```

## 3. 部署

```bash
sh infra/deploy/deploy.sh
```

它会构建网页、把程序传到服务器、安装依赖、重启服务。以后每次更新代码，再执行一次这条命令即可；数据库结构的变更会在服务启动时自动应用。

## 4. 连接设备

设备第一次打开时需要输入连接码。连接码在服务器上生成，只能用一次，10 分钟内有效：

```bash
cd /opt/council-next/app && sudo -u council env 'DATABASE_URL=postgresql://council@/council_next?host=/var/run/postgresql' \
  /opt/council-next/node/bin/node services/api/admin.ts pair --name "我的电脑" --kind web
```

给手机生成时把 `--kind web` 换成 `--kind phone`。同一条命令把 `pair …` 换成 `devices` 可以列出所有设备，换成 `revoke <设备ID>` 可以撤销某台设备。

## 备份

服务器每天自动备份一次数据库：先导出，再恢复到一个临时数据库里逐表核对，确认能恢复才保留，只留最新 3 份，放在 `/var/backups/council-next/`。

如果你用 Mac，还可以让它每天把最新的备份复制一份到 iCloud（保留最新 7 份）：

```bash
sh infra/deploy/install-backup-agent.sh
```

## 换服务器或恢复数据

1. 在新服务器上重复第 1、2 步。
2. 把一份备份传上去并恢复：`su postgres -c "pg_restore -d council_next --no-owner --exit-on-error /路径/council-xxx.dump"`
3. 执行第 3 步部署，把域名指向新服务器。

备份里包含已配对的设备，域名不变的话，手机和浏览器不用重新配对。
