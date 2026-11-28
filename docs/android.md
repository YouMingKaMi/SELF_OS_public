# 安装与构建 Android APK

SELF OS 提供独立的 Android 原生安全壳（`apps/android/`，Kotlin + Android WebView，支持 Android 8.0+ / API 26–35），内置完整构建的 19 个核心移动端页面，支持 **「仅本机使用（无需服务器）」与「连接我的服务器」二合一**：

- **零服务器开箱即用（仅本机模式）**：无需购买或部署服务器，首次打开选择「仅本机使用（无需服务器）」即可通过 APK 内置资源离线运行，全部数据持久化在手机本地 IndexedDB，零外部网络请求，并支持随时导出完整 JSON 备份或从备份文件恢复（合并导入 / 覆盖恢复）。
- **随时切服与平滑迁移**：首次打开也可直接选择「连接我的服务器」填入自己的 HTTPS 站点地址；随时可在「设置 → Android 模式与服务器」或长按桌面应用图标「模式与连接设置」在仅本机与服务器模式之间无损切换。日后购买服务器时，只需在仅本机模式导出 JSON 备份，切换至服务器配对后执行「导入备份恢复（合并导入）」即可迁移全部历史记录。
- **同源安全边界**：全局禁用明文 HTTP（仅允许 `127.0.0.1` / `localhost` / `10.0.2.2` 本机调试），本地模式通过虚拟安全源隔离拦截一切外部子请求与 `/v1/*` 请求，外链通过系统浏览器打开，原生桥按源限定且仅顶层同源文档可调用。
- **手机端原生体验**：Edge-to-Edge 状态栏与手势条安全区自动适配、深色/浅色系统栏联动、系统返回手势（先收起弹窗/回退页面历史，首页双击退出）、系统文件选择器（支持导入 JSON 备份）与 Android SAF 流式文件导出、HttpOnly 配对会话持久化。

## 直接下载预编译 APK（推荐）

前往本仓库的 [GitHub Releases](https://github.com/YouMingKaMi/SELF_OS_public/releases) 下载最新的 `SELF-OS-*-release.apk`（及同目录 `.sha256` 校验文件）：

- 该通用安装包**不包含任何个人服务器地址或隐私信息**；
- 没有服务器的用户，首次打开直接点 **「仅本机使用（无需服务器）」** 即可离线记录，建议定期在「设置 → 数据管理」导出 JSON 备份；
- 已有自建服务器的用户，首次打开选择 **「连接我的服务器」** 填入自己的 SELF OS HTTPS 地址并输入一次性连接码即可同步使用。

## 自行构建签名 APK

需要 **Node.js 20+**、**JDK 17 或 21** 与 **Android SDK（Platform 35 + Build Tools 35.0.0）**。

```bash
# 构建二合一通用版正式签名 APK（自动构建 Web 并内置进 APK，默认不预填服务器地址，输出至 .build/android/SELF-OS-0.3.15-release.apk）
sh scripts/build-android-apk.sh

# 若 apps/web/dist 已最新，可跳过重复构建 Web：
sh scripts/build-android-apk.sh --skip-web-build

# 如需构建 Debug 包
SELF_OS_ANDROID_VARIANT=debug sh scripts/build-android-apk.sh

# 如需为自己预填默认服务器地址（仅限个人使用，切勿公开分发预填私域地址的 APK）
SELF_OS_URL=https://os.example.com sh scripts/build-android-apk.sh
# 或从本机 gitignored 的 infra/deploy/site.env 读取 COUNCIL_SITE：
sh scripts/build-android-apk.sh --with-site-env
```

### 签名与密钥库说明

- 首次运行 Release 构建且未传入外部密钥库时，脚本会自动在仓库外创建并复用本机签名密钥库（`~/.config/self-os/android-release.jks` 与 `android-release.env`，权限 `600`），避免后续升级安装因签名不一致无法覆盖。
- 也可通过环境变量显式指定已有密钥库：
  `SELF_OS_ANDROID_KEYSTORE`、`SELF_OS_ANDROID_KEY_ALIAS`、`SELF_OS_ANDROID_STORE_PASS`、`SELF_OS_ANDROID_KEY_PASS`。
- 每次打包均会默认先跑 Kotlin JUnit 核心安全单测，并用 `apksigner verify` 严格验签，同时在同目录输出 `.sha256` 校验文件。

## 安装到手机

将 `.build/android/SELF-OS-0.3.15-release.apk` 传到 Android 手机点击安装（允许安装未知来源应用），或连接电脑通过 `adb install -r .build/android/SELF-OS-0.3.15-release.apk` 覆盖安装。打开后按需选择「仅本机使用（无需服务器）」直接离线使用，或选择「连接我的服务器」并完成一次性连接码配对。
