# 安装与构建 Android APK

> [!WARNING]
> **早期测试版说明**：当前发布的 Android APK 属于早期尝鲜版本，**可能会出现很多问题，作者目前没有仔细去体验和研究**，请谨慎使用，遇到任何异常欢迎在仓库提 Issue 反馈。

SELF OS 提供独立的 Android 原生安全壳（`apps/android/`，Kotlin + Android WebView，支持 Android 8.0+ / API 26–35），复用已部署的响应式 Web 工作区，完整覆盖全部 19 个核心模块与跨端工作区定制，并在原生层补齐：

- **首次连接引导与随时切服**：默认通用版 APK 不内嵌任何服务器地址，安装打开后填入自己的 HTTPS 站点地址即可使用；随时可在「设置 → Android 服务器 → 连接设置」或长按桌面应用图标「连接设置」修改。
- **同源安全边界**：全局禁用明文 HTTP（仅允许 `127.0.0.1` / `localhost` / `10.0.2.2` 本机调试），外链通过系统浏览器打开，原生桥按源限定且仅顶层同源文档可调用。
- **手机端原生体验**：Edge-to-Edge 状态栏与手势条安全区自动适配、深色/浅色系统栏联动、系统返回手势（先收起弹窗/回退页面历史，首页双击退出）、系统文件选择器（支持导入 JSON）与 Android SAF 流式文件导出、HttpOnly 配对会话持久化。

## 直接下载预编译 APK（推荐尝鲜）

前往本仓库的 [GitHub Releases](https://github.com/YouMingKaMi/SELF_OS_public/releases) 下载最新的 `SELF-OS-*-release.apk`（及同目录 `.sha256` 校验文件）：

- 该通用安装包**不包含任何个人服务器地址或隐私信息**；
- 首次打开后填入你自己的 SELF OS HTTPS 地址，并按服务端配对流程输入一次性连接码即可使用。

## 自行构建签名 APK

需要 **JDK 17 或 21** 与 **Android SDK（Platform 35 + Build Tools 35.0.0）**。

```bash
# 构建通用版正式签名 APK（默认不预填服务器地址，输出至 .build/android/SELF-OS-0.3.14-release.apk）
sh scripts/build-android-apk.sh

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

将 `.build/android/SELF-OS-0.3.14-release.apk` 传到 Android 手机点击安装（允许安装未知来源应用），或连接电脑通过 `adb install -r .build/android/SELF-OS-0.3.14-release.apk` 覆盖安装。打开后输入服务器地址，并按服务器配对流程生成一次性连接码完成配对即可离线同步使用。
