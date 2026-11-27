# 安装 iPhone App

App 没有上架 App Store，需要用自己的 Mac 编译安装。需要 Xcode 和一个 Apple 账号（免费的就行）。

1. 用 Xcode 打开 `apps/ios/CouncilStudio.xcodeproj`。
2. 选中 CouncilStudio 这个 target，在 Signing & Capabilities 里选择你的 Team，并把 Bundle Identifier 改成一个你自己的唯一名字（例如 `com.你的名字.selfos`）。
3. 用数据线连上 iPhone，选中它，点运行。第一次需要在手机「设置 → 通用 → VPN 与设备管理」里信任开发者。
4. 打开 App，点「今日」页右上角的设置，填入你的服务器网址和[连接码](deploy.md#4-连接设备)。

想让服务器网址预先填好，可以在命令行编译时传入：

```bash
cd apps/ios && xcodebuild -project CouncilStudio.xcodeproj -scheme CouncilStudio \
  -destination 'id=<你的 iPhone 的 UDID>' -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=<你的 Team ID> COUNCIL_ENDPOINT=https://os.example.com build
```

## 需要知道的

- **免费 Apple 账号签名的 App 只有 7 天有效**，到期后打不开，需要重新运行一次安装（数据在手机和服务器上，不会丢）。也可以启用仓库附带的 Mac 热点无线自动续签脚本，见 [docs/iphone-signing.md](iphone-signing.md)。付费开发者账号是一年。
- **没连服务器也能用**，内容只存在这台手机上；连上之后会自动同步。
- **重要日子会在当天和提前几天的早上 9 点发通知**，第一次打开时请允许通知。
- 增删了 Swift 文件后，运行 `python3 scripts/generate-ios-studio-project.py` 重新生成工程文件。

## 今日任务小组件

工程里已包含 `CouncilWidgets` 扩展。用 Xcode 选中 CouncilStudio scheme 编译时，小组件会随 App 一起安装。它显示今天/明天的任务标题，点击完成会先写入共享队列，App 下次启动时校验任务状态并同步。

- 小组件会在桌面和锁屏显示任务标题；敏感任务不要放到锁屏。
- App 与扩展通过 Keychain 访问组共享任务投影，不共享数据库或同步凭证。
- 如果你修改了 Bundle Identifier，记得同步修改 `CouncilStudio` 与 `CouncilWidgets` 两个 target 的 `.entitlements` 和 `Info.plist` 中的共享 Keychain 组名（默认 `org.personalcouncil.next.studio.widget-items`），保持两处一致。
- 小组件使用 Keychain 共享，部分免费 Apple 账号可能无法为自定义组签名；遇到签名失败时先在 Xcode 的 Signing & Capabilities 里确认 Keychain Sharing 与 Team。
