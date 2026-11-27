# SELF OS iPhone 续签

免费 Apple 开发账号的安装签名从签发起有效 7 天。到期后，按下面的步骤覆盖安装即可。保留手机上已有的 SELF OS，并使用原来的 Apple 账号和 App 标识，以保留本机资料。

## Mac 自动续签

桌面双击 **SELF OS iPhone 续签.command** 可立即尝试续签。打开热点或处在配对时可用的同一网络，并在需要时解锁 iPhone、保持 Mac 登录。脚本每 3 小时检查一次，在 App 和小组件中较早一个描述文件到期前 36 小时开始尝试。若剩余不足 24 小时仍失败，每 12 小时最多提醒一次。

自动续签使用固定的已发布 App 产物。Xcode 从指定项目请求更新描述文件，但项目编译结果只用于取得签名材料。手机版本必须与固定产物一致，脚本使用更长有效期的双描述文件重签，验签后再覆盖安装。Apple ID 需要重新登录时，打开 Xcode 的 **Settings → Accounts** 检查原账号。

管理员可在仓库根目录用 `/usr/bin/python3 scripts/ios-auto-resign.py force` 手动运行，用 `enable` 安装当前用户的后台任务和桌面入口，用 `disable` 卸载这两个入口。两者都可传相同的 `--shortcut` 指定自定义入口。日志和签名基线保存在 `~/Library/Application Support/SELF OS iPhone Resign/`。卸载入口后保留基线及状态。

若以后通过正式发布更新 iPhone 版本，当前自动续签会停止覆盖。重新启用前要核对新安装的版本与新发布产物，再用 `pin --artifact <已安装版本的 .app> --entitlements <该构建的 Debug-iphoneos 中间产物目录> --project apps/ios/CouncilStudio.xcodeproj` 固定基线。已有基线可先停用并把本机续签目录移到备份位置。

## Xcode 手动续签

1. 用数据线连接 iPhone 和 Mac，解锁手机。如果出现「信任此电脑」，在手机上点「信任」。
2. 在 Xcode 打开 [CouncilStudio.xcodeproj](../apps/ios/CouncilStudio.xcodeproj)。顶部方案选 `CouncilStudio`，运行设备选你的 iPhone。
3. 如果 Xcode 提示需要设置签名，在 **Xcode → Settings → Accounts** 登录原来的 Apple 账号。在项目的 **Signing & Capabilities** 中，给 `CouncilStudio` 和 `CouncilWidgets` 都选同一个 **Personal Team**，勾选 **Automatically manage signing**。保留原有 App 标识。
4. 按 **⌘R**。Xcode 会构建并覆盖安装。等待 SELF OS 在 iPhone 上打开。

构建前核对工程版本与手机上的版本。当前正式工程版本为 0.3.14 (20)。续签时优先使用上面的 Mac 专用入口。

以后如果 Xcode 仍保留签名设置，连接并解锁手机后，打开工程直接按 **⌘R** 即可。

如果续签后仍提示签名无效，在 Xcode 选 **Product → Clean Build Folder（⇧⌘K）**，再按 **⌘R**。

[Apple Personal Team 有效期说明](https://developer.apple.com/help/account/basics/about-your-developer-account) · [Apple 自动签名文档](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices/)
