# 微信支付记账

Mac 上的导入页面使用已配置的 wechat-cli 读取「微信支付」公众号中的付款通知。付款金额、商户、业务日期及去重标识由通知提取。退款、收款、转账和其他会话不进入此流程。账单通过现有同步接口写入 SELF OS，网页和 iPhone 可查看。

## 数据与隐私

- 工具只在本机读取微信支付公众号通知；不会上传到任何第三方服务。
- 导入的金额、商户、日期和备注只发送到你指定的 SELF OS 地址，走现有配对凭证和 HTTPS。
- 连接凭证、去重水位和商户规则保存在本机 `~/Library/Application Support/SELF OS/WeChat Pay`，不写入项目目录。
- 自动同步由本机 LaunchAgent 运行；停止方法见下方 `launchctl bootout`。
- 公开仓库不包含你的服务器地址、连接码或微信账号配置。

## 使用

1. 在运行记账工具的 Mac 打开 SELF OS「花销 → 微信支付」，选「读取最近两天」。首次连接时，浏览器可能询问是否允许访问本机。若内嵌受浏览器限制，可从同一页单独打开 `http://127.0.0.1:18766/`。
2. 勾选需要记账的支付。有把握时选择用途。对固定食堂等商户，勾选「记住用途」可以在以后自动匹配同名商户。
3. 选择「导入所选」。未选类别的支付保留实际金额和日期，计入花销总额。在「花销 → 待分类」可以补用途并改账单名称。勾选「记住这个商户的用途」会让下次同商户付款沿用名称和分类。只改名时，影响当前账单。
4. 可开启「自动同步新通知」。首次从开启时刻开始检查，每五分钟尝试一次。以后打开页面仍可关闭或修改商户规则。
5. 自动处理依赖 Mac 登录且本机已收到对应微信通知。每日补扫自动记账开启后的最近 30 天。可在「按日期补扫」中查看每次最多 90 天的旧通知，再选取要导入的支付。原账单已删除的支付不会重新建账。

## 本机安装维护

需要已配置的 Python wechat-cli 项目及原有依赖。以普通用户运行以下命令。正式服务器的地址由操作者指定。

```sh
python3 tools/wechat-pay/bridge.py --endpoint https://your-self-os.example --wechat-project /path/to/wechat-cli --open
```

页面的连接码需由服务器生成，类型为 `cli`。完成配对后，可退出手动进程，再使用下述命令安装登录后台服务。工具只绑定 Mac 本机。连接信息与分类规则存储在本机的 `Library/Application Support/SELF OS/WeChat Pay`。每个连接独立维护去重和扫描进度，重新配对后需要重新开启自动同步。

```sh
python3 tools/wechat-pay/install-macos.py --endpoint https://your-self-os.example --wechat-project /path/to/wechat-cli
```

停用整项服务可执行 `launchctl bootout "gui/$(id -u)/org.personalcouncil.wechat-pay"`，并移除对应 LaunchAgent 文件。也可由 SELF OS 的管理程序撤销该设备凭证。

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/wechat-pay
```
