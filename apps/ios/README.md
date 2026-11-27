# SELF OS iPhone

正式工程为 `CouncilStudio.xcodeproj`，App 标识为 `org.personalcouncil.next.studio`。SwiftUI 界面在 `CouncilStudio/`，桌面小组件在 `CouncilWidgets/`。本地数据和同步协议由 `CouncilCore/` 管理，应用配对后连到正式服务器。

从仓库根目录构建 App 和小组件：

```sh
xcodebuild -project apps/ios/CouncilStudio.xcodeproj -scheme CouncilStudio \
  -destination 'generic/platform=iOS' -derivedDataPath /tmp/council-studio-build \
  CODE_SIGNING_ALLOWED=NO build
```

修改 Swift 文件清单后，可运行 `python3 scripts/generate-ios-studio-project.py` 重建工程。修改共享契约后运行 `npm run contracts:generate`，Swift 生成物位于 `CouncilCore/Sources/CouncilCore/Generated/`。

数据层测试通过 `npm run test:native` 连接本机隔离测试数据库和 API，使用独立的合成账号。iPhone 演示构建可通过 Xcode 的进程环境变量 `STUDIO_DEMO=local-preview` 使用独立本地数据库和内置演示数据。正式签名和安装步骤见 [iPhone 签名](../../docs/iphone-signing.md)。
