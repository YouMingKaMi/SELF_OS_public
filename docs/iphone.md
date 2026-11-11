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

- **免费 Apple 账号签名的 App 只有 7 天有效**，到期后打不开，需要重新运行一次安装。数据在手机和服务器上，不会丢。付费开发者账号是一年。
- **没连服务器也能用**，内容只存在这台手机上；连上之后会自动同步。
- **重要日子会在当天和提前几天的早上 9 点发通知**，第一次打开时请允许通知。
- 增删了 Swift 文件后，运行 `python3 scripts/generate-ios-studio-project.py` 重新生成工程文件。
