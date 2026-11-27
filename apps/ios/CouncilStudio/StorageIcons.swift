import SwiftUI

struct BuiltinItemIcon: Identifiable, Hashable {
  let key: String
  let label: String
  let group: String
  let symbol: String
  let keywords: String
  var id: String { key }
}

enum StorageIconCatalog {
  static let groups: [String] = ["数码充电", "学习办公", "证件财务", "穿戴出行", "饮食厨具", "居家洗漱", "健康运动", "工具兴趣"]

  static let builtins: [BuiltinItemIcon] = [
    BuiltinItemIcon(key: "battery", label: "充电宝", group: "数码充电", symbol: "battery.100percent.bolt", keywords: "充电宝 移动电源 电池 powerbank 锂电池 干电池 电量"),
    BuiltinItemIcon(key: "battery_cell", label: "干电池", group: "数码充电", symbol: "battery.75percent", keywords: "干电池 5号电池 7号电池 纽扣电池 备用电池"),
    BuiltinItemIcon(key: "plug", label: "充电头", group: "数码充电", symbol: "powerplug", keywords: "充电头 充电器 氮化镓 适配器 电源头"),
    BuiltinItemIcon(key: "outlet", label: "插排插座", group: "数码充电", symbol: "poweroutlet.type.b", keywords: "插排 接线板 插座 转换插头 排插 电源"),
    BuiltinItemIcon(key: "earphone", label: "头戴耳机", group: "数码充电", symbol: "headphones", keywords: "头戴耳机 耳机 降噪耳机 监听耳机 蓝牙耳机"),
    BuiltinItemIcon(key: "earbuds", label: "入耳耳机", group: "数码充电", symbol: "earbuds", keywords: "入耳耳机 airpods 蓝牙耳机 耳塞 耳机盒 无线耳机"),
    BuiltinItemIcon(key: "cable", label: "数据线", group: "数码充电", symbol: "cable.connector", keywords: "数据线 充电线 转接线 拓展坞 扩展坞 hub 网线 hdmi type-c usb-c"),
    BuiltinItemIcon(key: "usb", label: "U盘", group: "数码充电", symbol: "externaldrive.connected.to.line.below", keywords: "u盘 优盘 闪存盘 加密狗 接收器"),
    BuiltinItemIcon(key: "hdd", label: "移动硬盘", group: "数码充电", symbol: "externaldrive", keywords: "移动硬盘 硬盘 固态硬盘 ssd 硬盘盒 存储盘"),
    BuiltinItemIcon(key: "sdcard", label: "内存卡", group: "数码充电", symbol: "sdcard", keywords: "内存卡 sd卡 tf卡 读卡器 存储卡 相机卡"),
    BuiltinItemIcon(key: "phone", label: "手机", group: "数码充电", symbol: "iphone", keywords: "手机 iphone 备用机 手机壳 钢化膜 手机支架"),
    BuiltinItemIcon(key: "sim", label: "SIM卡针", group: "数码充电", symbol: "simcard", keywords: "sim卡 电话卡 卡针 流量卡 手机卡"),
    BuiltinItemIcon(key: "laptop", label: "笔记本电脑", group: "数码充电", symbol: "laptopcomputer", keywords: "电脑 笔记本 macbook 笔记本电脑 电脑支架 散热器 电脑包"),
    BuiltinItemIcon(key: "tablet", label: "平板电脑", group: "数码充电", symbol: "ipad", keywords: "平板 ipad kindle 电纸书 阅读器 手写笔 apple pencil"),
    BuiltinItemIcon(key: "monitor", label: "显示器", group: "数码充电", symbol: "display", keywords: "显示器 屏幕 便携屏 桌面屏 支架"),
    BuiltinItemIcon(key: "mouse", label: "鼠标", group: "数码充电", symbol: "computermouse", keywords: "鼠标 无线鼠标 触控板 鼠标垫 接收器"),
    BuiltinItemIcon(key: "keyboard", label: "键盘", group: "数码充电", symbol: "keyboard", keywords: "键盘 机械键盘 键帽 轴体 拔键器 腕托"),
    BuiltinItemIcon(key: "camera", label: "相机", group: "数码充电", symbol: "camera", keywords: "相机 微单 单反 镜头 拍立得 三脚架 胶卷 滤镜"),
    BuiltinItemIcon(key: "video", label: "运动相机", group: "数码充电", symbol: "video", keywords: "摄像机 运动相机 gopro pocket 云台 稳定器 录像"),
    BuiltinItemIcon(key: "gamepad", label: "游戏手柄", group: "数码充电", symbol: "gamecontroller", keywords: "手柄 游戏机 switch 卡带 ps5 xbox 摇杆 游戏"),
    BuiltinItemIcon(key: "router", label: "路由器", group: "数码充电", symbol: "wifi.router", keywords: "路由器 随身wifi 光猫 网卡 信号放大器"),
    BuiltinItemIcon(key: "speaker", label: "音箱", group: "数码充电", symbol: "hifispeaker", keywords: "音箱 音响 蓝牙音箱 蓝牙音响 小音箱"),
    BuiltinItemIcon(key: "mic", label: "麦克风", group: "数码充电", symbol: "mic", keywords: "麦克风 话筒 领夹麦 录音笔 声卡"),
    BuiltinItemIcon(key: "printer", label: "打印机", group: "数码充电", symbol: "printer", keywords: "打印机 拍立得相纸 错题打印机 标签机 碳粉 墨盒"),
    BuiltinItemIcon(key: "remote", label: "遥控器", group: "数码充电", symbol: "av.remote", keywords: "遥控器 电视 投影仪 翻页笔 激光笔"),
    BuiltinItemIcon(key: "cpu", label: "电子元件", group: "数码充电", symbol: "cpu", keywords: "芯片 树莓派 开发板 电子元件 内存条 显卡 配件"),
    BuiltinItemIcon(key: "disc", label: "光盘", group: "数码充电", symbol: "opticaldisc", keywords: "光盘 cd dvd 蓝光 唱片 刻录盘"),
    BuiltinItemIcon(key: "radio", label: "收音机", group: "数码充电", symbol: "radio", keywords: "收音机 对讲机 播放器 mp3 随身听"),
    BuiltinItemIcon(key: "book", label: "书本", group: "学习办公", symbol: "book.closed", keywords: "书 书本 课本 教材 小说 传记 简史 指南 杂志 词典 书架 书柜"),
    BuiltinItemIcon(key: "book_open", label: "翻开的书", group: "学习办公", symbol: "book", keywords: "书籍 读物 绘本 漫画 文献 讲义 书目"),
    BuiltinItemIcon(key: "notebook", label: "笔记本", group: "学习办公", symbol: "note.text", keywords: "笔记本 本子 手账 日记本 草稿本 活页本 计划本"),
    BuiltinItemIcon(key: "pen", label: "笔", group: "学习办公", symbol: "pencil", keywords: "笔 钢笔 中性笔 铅笔 笔芯 橡皮 涂改带 签字笔"),
    BuiltinItemIcon(key: "highlighter", label: "荧光笔", group: "学习办公", symbol: "highlighter", keywords: "荧光笔 马克笔 彩笔 记号笔 水彩笔 白板笔"),
    BuiltinItemIcon(key: "scissors", label: "剪刀", group: "学习办公", symbol: "scissors", keywords: "剪刀 美工刀 裁纸刀 拆快递 胶带 订书机"),
    BuiltinItemIcon(key: "ruler", label: "尺子", group: "学习办公", symbol: "ruler", keywords: "尺子 直尺 三角尺 圆规 卷尺 测量 文具 量角器"),
    BuiltinItemIcon(key: "folder", label: "文件夹", group: "学习办公", symbol: "folder", keywords: "文件夹 资料袋 风琴包 档案袋 试卷 收纳册"),
    BuiltinItemIcon(key: "document", label: "文档资料", group: "学习办公", symbol: "doc.text", keywords: "资料 合同 试卷 说明书 保修卡 证书 简历 复印件"),
    BuiltinItemIcon(key: "paperclip", label: "回形针", group: "学习办公", symbol: "paperclip", keywords: "回形针 夹子 燕尾夹 别针 固体胶 胶水 长尾夹"),
    BuiltinItemIcon(key: "pin", label: "图钉磁钉", group: "学习办公", symbol: "pin", keywords: "图钉 工字钉 磁钉 磁铁 冰箱贴 挂钩"),
    BuiltinItemIcon(key: "calc", label: "计算器", group: "学习办公", symbol: "plus.forwardslash.minus", keywords: "计算器 科学计算器 电子计算器 算账"),
    BuiltinItemIcon(key: "sticky", label: "便利贴", group: "学习办公", symbol: "square.and.pencil", keywords: "便利贴 便签 便签纸 索引贴 贴纸 胶带"),
    BuiltinItemIcon(key: "bookmark", label: "书签", group: "学习办公", symbol: "bookmark", keywords: "书签 阅读夹 金属书签 书立"),
    BuiltinItemIcon(key: "calendar", label: "日历台历", group: "学习办公", symbol: "calendar", keywords: "日历 台历 挂历 计划表 课表"),
    BuiltinItemIcon(key: "brush", label: "画笔美术", group: "学习办公", symbol: "paintbrush", keywords: "画笔 毛笔 颜料 调色盘 素描 美术 画具"),
    BuiltinItemIcon(key: "compass", label: "指南针", group: "学习办公", symbol: "safari", keywords: "指南针 圆规 绘图 户外导航"),
    BuiltinItemIcon(key: "globe", label: "地球仪", group: "学习办公", symbol: "globe", keywords: "地球仪 地图 世界地图 摆件"),
    BuiltinItemIcon(key: "magnifier", label: "放大镜", group: "学习办公", symbol: "magnifyingglass", keywords: "放大镜 检视镜 镜片 观察"),
    BuiltinItemIcon(key: "telescope", label: "望远镜", group: "学习办公", symbol: "binoculars", keywords: "望远镜 双筒望远镜 演唱会望远镜"),
    BuiltinItemIcon(key: "stamp", label: "印章", group: "学习办公", symbol: "seal", keywords: "印章 盖章 印泥 私章 纪念章"),
    BuiltinItemIcon(key: "gradcap", label: "证书学历", group: "学习办公", symbol: "graduationcap", keywords: "毕业证 学位证 荣誉证书 资格证 成绩单 考证"),
    BuiltinItemIcon(key: "card", label: "证件", group: "证件财务", symbol: "person.text.rectangle", keywords: "身份证 护照 驾照 校园卡 学生证 医保卡 社保卡 证件 门卡 港澳通行证"),
    BuiltinItemIcon(key: "bankcard", label: "银行卡", group: "证件财务", symbol: "creditcard", keywords: "银行卡 信用卡 储蓄卡 公交卡 地铁卡 会员卡 礼品卡 卡片"),
    BuiltinItemIcon(key: "key", label: "钥匙", group: "证件财务", symbol: "key", keywords: "钥匙 门禁 车钥匙 备用钥匙 钥匙扣 宿舍钥匙"),
    BuiltinItemIcon(key: "wallet", label: "钱包卡包", group: "证件财务", symbol: "wallet.pass", keywords: "钱包 卡包 零钱包 票夹 卡套"),
    BuiltinItemIcon(key: "banknote", label: "现金钞票", group: "证件财务", symbol: "banknote", keywords: "现金 钞票 纸币 红包 外币 存折 支票"),
    BuiltinItemIcon(key: "coins", label: "硬币零钱", group: "证件财务", symbol: "yensign.circle", keywords: "硬币 零钱 纪念币 筹码 游戏币"),
    BuiltinItemIcon(key: "piggy", label: "存钱罐", group: "证件财务", symbol: "dollarsign.circle", keywords: "存钱罐 储蓄罐 零钱盒"),
    BuiltinItemIcon(key: "ticket", label: "票据门票", group: "证件财务", symbol: "ticket", keywords: "票 火车票 机票 门票 电影票 演唱会票 购物券 优惠券"),
    BuiltinItemIcon(key: "receipt", label: "发票收据", group: "证件财务", symbol: "list.bullet.rectangle", keywords: "发票 收据 小票 报销单 账单 凭证"),
    BuiltinItemIcon(key: "badge", label: "徽章奖牌", group: "证件财务", symbol: "medal", keywords: "徽章 奖牌 工牌 胸牌 校徽 挂绳 荣誉"),
    BuiltinItemIcon(key: "gift", label: "礼物纪念", group: "证件财务", symbol: "gift", keywords: "礼物 礼盒 纪念品 伴手礼 惊喜"),
    BuiltinItemIcon(key: "mail", label: "信件明信片", group: "证件财务", symbol: "envelope", keywords: "信件 信封 明信片 贺卡 邀请函 邮票"),
    BuiltinItemIcon(key: "package", label: "包裹快递", group: "证件财务", symbol: "shippingbox", keywords: "包裹 快递盒 纸箱 寄件 包装盒 备件盒"),
    BuiltinItemIcon(key: "tag", label: "标签挂牌", group: "证件财务", symbol: "tag", keywords: "标签 吊牌 行李牌 贴纸 价格牌"),
    BuiltinItemIcon(key: "shirt", label: "上衣衣物", group: "穿戴出行", symbol: "tshirt", keywords: "衣 衣服 外套 卫衣 t恤 衬衫 裤 袜 睡衣 羽绒服 毛衣"),
    BuiltinItemIcon(key: "shoe", label: "鞋袜", group: "穿戴出行", symbol: "shoe", keywords: "鞋 运动鞋 拖鞋 凉鞋 皮鞋 鞋垫 鞋带 袜子"),
    BuiltinItemIcon(key: "glasses", label: "眼镜", group: "穿戴出行", symbol: "eyeglasses", keywords: "眼镜 近视镜 眼镜盒 眼镜布 隐形眼镜 护理液"),
    BuiltinItemIcon(key: "sunglasses", label: "墨镜", group: "穿戴出行", symbol: "sunglasses", keywords: "墨镜 太阳镜 偏光镜 防晒镜"),
    BuiltinItemIcon(key: "umbrella", label: "雨伞", group: "穿戴出行", symbol: "umbrella", keywords: "伞 雨伞 遮阳伞 折叠伞 雨衣"),
    BuiltinItemIcon(key: "watch", label: "手表手环", group: "穿戴出行", symbol: "applewatch", keywords: "手表 手环 apple watch 表带 机械表 智能表"),
    BuiltinItemIcon(key: "backpack", label: "双肩包", group: "穿戴出行", symbol: "backpack", keywords: "双肩包 书包 背包 登山包 电脑包"),
    BuiltinItemIcon(key: "bag", label: "手提袋", group: "穿戴出行", symbol: "bag", keywords: "包 帆布袋 购物袋 手提袋 收纳袋 托特包 环保袋"),
    BuiltinItemIcon(key: "handbag", label: "收纳小包", group: "穿戴出行", symbol: "handbag", keywords: "洗漱包 化妆包 数码收纳包 零钱包 斜挎包 胸包"),
    BuiltinItemIcon(key: "luggage", label: "行李箱", group: "穿戴出行", symbol: "suitcase", keywords: "行李箱 登机箱 拉杆箱 旅行箱 束箱带"),
    BuiltinItemIcon(key: "briefcase", label: "公文包", group: "穿戴出行", symbol: "briefcase", keywords: "公文包 文件包 商务包 电脑内胆包"),
    BuiltinItemIcon(key: "hat", label: "帽子头饰", group: "穿戴出行", symbol: "hat.cap", keywords: "帽子 鸭舌帽 渔夫帽 毛线帽 发箍 发夹 头绳"),
    BuiltinItemIcon(key: "scarf", label: "围巾手套", group: "穿戴出行", symbol: "wind", keywords: "围巾 领带 丝巾 手套 护耳 腰带 皮带"),
    BuiltinItemIcon(key: "gem", label: "首饰珠宝", group: "穿戴出行", symbol: "diamond", keywords: "首饰 项链 戒指 耳环 手链 胸针 珠宝 玉佩"),
    BuiltinItemIcon(key: "cosmetic", label: "美妆个护", group: "穿戴出行", symbol: "paintbrush.pointed", keywords: "口红 唇膏 眉笔 粉底 化妆品 腮红 眼影 美妆"),
    BuiltinItemIcon(key: "car", label: "车品配件", group: "穿戴出行", symbol: "car", keywords: "汽车 车载 车充 车钥匙 挪车牌 行车记录仪"),
    BuiltinItemIcon(key: "bike", label: "骑行装备", group: "穿戴出行", symbol: "bicycle", keywords: "自行车 骑行 车灯 气筒 车锁 头盔 骑行手套"),
    BuiltinItemIcon(key: "tent", label: "露营户外", group: "穿戴出行", symbol: "tent", keywords: "帐篷 露营 睡袋 野餐垫 天幕 登山杖 户外"),
    BuiltinItemIcon(key: "plane", label: "旅行出行", group: "穿戴出行", symbol: "airplane", keywords: "护照夹 颈枕 眼罩 转换插头 旅行装 出差 出行"),
    BuiltinItemIcon(key: "map", label: "地图攻略", group: "穿戴出行", symbol: "map", keywords: "地图 路线图 旅游攻略 导览图"),
    BuiltinItemIcon(key: "anchor", label: "挂扣绳索", group: "穿戴出行", symbol: "link", keywords: "登山扣 挂绳 伞绳 弹力绳 绑带 魔术贴"),
    BuiltinItemIcon(key: "feather", label: "轻质配饰", group: "穿戴出行", symbol: "leaf", keywords: "羽毛 挂件 吊坠 平安符 香囊"),
    BuiltinItemIcon(key: "cup", label: "咖啡茶杯", group: "饮食厨具", symbol: "cup.and.saucer", keywords: "杯 水杯 马克杯 咖啡杯 茶杯 咖啡 咖啡豆 茶叶"),
    BuiltinItemIcon(key: "bottle", label: "保温杯水壶", group: "饮食厨具", symbol: "waterbottle", keywords: "保温杯 运动水壶 矿泉水 饮料瓶 奶瓶 水瓶"),
    BuiltinItemIcon(key: "wineglass", label: "酒杯玻璃杯", group: "饮食厨具", symbol: "wineglass", keywords: "酒杯 红酒杯 玻璃杯 威士忌杯 酒吧"),
    BuiltinItemIcon(key: "winebottle", label: "酒水饮品", group: "饮食厨具", symbol: "wineglass.fill", keywords: "红酒 白酒 啤酒 洋酒 饮料 汽水 气泡水"),
    BuiltinItemIcon(key: "utensils", label: "餐具刀叉", group: "饮食厨具", symbol: "fork.knife", keywords: "筷子 勺子 餐具 叉子 饭盒 便携餐具 吸管"),
    BuiltinItemIcon(key: "chef", label: "厨具烹饪", group: "饮食厨具", symbol: "frying.pan", keywords: "锅 平底锅 奶锅 煮锅 电煮锅 焖烧杯 厨具 碗"),
    BuiltinItemIcon(key: "knife", label: "厨房刀具", group: "饮食厨具", symbol: "scissors", keywords: "水果刀 菜刀 削皮刀 开瓶器 开罐器"),
    BuiltinItemIcon(key: "kettle", label: "烧水壶", group: "饮食厨具", symbol: "mug", keywords: "烧水壶 养生壶 冲泡杯 奶茶杯 吸管杯"),
    BuiltinItemIcon(key: "snack", label: "零食干货", group: "饮食厨具", symbol: "basket", keywords: "零食 坚果 薯片 蛋白粉 麦片 泡面 干货 食品"),
    BuiltinItemIcon(key: "cookie", label: "饼干点心", group: "饮食厨具", symbol: "birthday.cake", keywords: "饼干 曲奇 糕点 面包 能量棒 威化"),
    BuiltinItemIcon(key: "candy", label: "糖果巧克力", group: "饮食厨具", symbol: "star.circle", keywords: "糖 糖果 巧克力 口香糖 薄荷糖 润喉糖"),
    BuiltinItemIcon(key: "cake", label: "甜点烘焙", group: "饮食厨具", symbol: "takeoutbag.and.cup.and.straw", keywords: "蛋糕 甜点 烘焙 模具 下午茶 外卖"),
    BuiltinItemIcon(key: "apple", label: "水果生鲜", group: "饮食厨具", symbol: "apple.logo", keywords: "水果 苹果 橘子 梨 干果 水果干"),
    BuiltinItemIcon(key: "tea", label: "茶叶茶具", group: "饮食厨具", symbol: "leaf.circle", keywords: "茶叶 茶包 抹茶 枸杞 花茶 茶具 泡茶"),
    BuiltinItemIcon(key: "ice", label: "冷饮冰格", group: "饮食厨具", symbol: "snowflake", keywords: "冰格 冰袋 保冷袋 冰块 冷藏"),
    BuiltinItemIcon(key: "soup", label: "碗碟汤勺", group: "饮食厨具", symbol: "cup.and.heat.waves", keywords: "碗 泡面碗 保鲜盒 便当盒 汤勺 汤碗"),
    BuiltinItemIcon(key: "pepper", label: "调味料", group: "饮食厨具", symbol: "flame", keywords: "调料 辣椒 盐 酱油 蜂蜜 咖啡粉 奶精 调味罐"),
    BuiltinItemIcon(key: "egg", label: "蛋奶早餐", group: "饮食厨具", symbol: "oval", keywords: "鸡蛋 牛奶 酸奶 燕麦 早餐 豆浆"),
    BuiltinItemIcon(key: "citrus", label: "冲饮维C", group: "饮食厨具", symbol: "sun.max", keywords: "泡腾片 柠檬片 果茶 果汁 冲饮"),
    BuiltinItemIcon(key: "sandwich", label: "便当主食", group: "饮食厨具", symbol: "tray", keywords: "便当 三明治 压缩饼干 自热米饭 挂面 主食"),
    BuiltinItemIcon(key: "cherry", label: "小食蜜饯", group: "饮食厨具", symbol: "heart.circle", keywords: "蜜饯 话梅 果脯 红枣 葡萄干 核桃"),
    BuiltinItemIcon(key: "droplet", label: "食用油饮水", group: "饮食厨具", symbol: "drop", keywords: "矿泉水 净水滤芯 橄榄油 饮用水 桶装水"),
    BuiltinItemIcon(key: "lamp", label: "台灯照明", group: "居家洗漱", symbol: "lamp.desk", keywords: "台灯 书桌灯 屏幕挂灯 氛围灯 小夜灯 护眼灯"),
    BuiltinItemIcon(key: "flashlight", label: "手电筒", group: "居家洗漱", symbol: "flashlight.on.fill", keywords: "手电 手电筒 强光手电 头灯 露营灯 应急灯"),
    BuiltinItemIcon(key: "bulb", label: "灯泡配件", group: "居家洗漱", symbol: "lightbulb", keywords: "灯泡 灯带 灯管 开关 遥控灯"),
    BuiltinItemIcon(key: "candle", label: "香薰蜡烛", group: "居家洗漱", symbol: "flame.circle", keywords: "蜡烛 香薰 精油 扩香石 火柴 打火机"),
    BuiltinItemIcon(key: "fan", label: "风扇电器", group: "居家洗漱", symbol: "fan", keywords: "风扇 小风扇 吹风机 挂烫机 加湿器 除湿器 小电器"),
    BuiltinItemIcon(key: "sparkle", label: "护肤洗漱", group: "居家洗漱", symbol: "sparkles", keywords: "洗面奶 护肤品 防晒霜 面霜 水乳 润唇膏 香水 面膜"),
    BuiltinItemIcon(key: "bath", label: "沐浴洗发", group: "居家洗漱", symbol: "shower", keywords: "洗发水 沐浴露 护发素 香皂 洗手液 浴球 搓澡巾"),
    BuiltinItemIcon(key: "toothbrush", label: "口腔护理", group: "居家洗漱", symbol: "mouth", keywords: "牙刷 电动牙刷 刷头 牙膏 牙线 漱口水 冲牙器"),
    BuiltinItemIcon(key: "towel", label: "毛巾纸巾", group: "居家洗漱", symbol: "scroll", keywords: "毛巾 浴巾 洗脸巾 纸巾 抽纸 湿巾 手帕 卫生纸"),
    BuiltinItemIcon(key: "razor", label: "剃须理容", group: "居家洗漱", symbol: "comb", keywords: "剃须刀 刮胡刀 梳子 指甲剪 掏耳勺 修眉刀 理发器"),
    BuiltinItemIcon(key: "bed", label: "床品寝具", group: "居家洗漱", symbol: "bed.double", keywords: "床单 被套 枕套 枕头 毯子 蚊帐 凉席 眼罩 耳塞"),
    BuiltinItemIcon(key: "sofa", label: "抱枕靠垫", group: "居家洗漱", symbol: "sofa", keywords: "抱枕 靠垫 坐垫 腰靠 懒人沙发 脚垫"),
    BuiltinItemIcon(key: "box_storage", label: "收纳盒", group: "居家洗漱", symbol: "archivebox", keywords: "收纳盒 整理箱 真空袋 压缩袋 分隔盒 收纳筐"),
    BuiltinItemIcon(key: "hanger", label: "衣架晾晒", group: "居家洗漱", symbol: "hanger", keywords: "衣架 晒衣夹 裤架 晾衣绳 粘毛器 除毛球机"),
    BuiltinItemIcon(key: "trash", label: "垃圾袋清洁", group: "居家洗漱", symbol: "trash", keywords: "垃圾袋 垃圾桶 抹布 粘尘滚筒 除尘掸"),
    BuiltinItemIcon(key: "spray", label: "清洁洗涤", group: "居家洗漱", symbol: "bubbles.and.sparkles", keywords: "洗衣液 洗衣凝珠 消毒喷雾 除味剂 洁厕 洗洁精 屏幕清洁剂"),
    BuiltinItemIcon(key: "clock", label: "闹钟时钟", group: "居家洗漱", symbol: "alarm", keywords: "闹钟 时钟 番茄钟 计时器 挂钟 温湿度计"),
    BuiltinItemIcon(key: "plant", label: "绿植盆栽", group: "居家洗漱", symbol: "camera.macro", keywords: "绿植 盆栽 多肉 营养液 浇花壶 种子 花盆"),
    BuiltinItemIcon(key: "flower", label: "鲜花干花", group: "居家洗漱", symbol: "laurel.leading", keywords: "鲜花 干花 花瓶 装饰花 永生花"),
    BuiltinItemIcon(key: "photo", label: "相册照片", group: "居家洗漱", symbol: "photo", keywords: "照片 相册 相框 拍立得照片 明信片 证件照"),
    BuiltinItemIcon(key: "mirror", label: "镜子", group: "居家洗漱", symbol: "circle.circle", keywords: "镜子 化妆镜 折叠镜 桌面镜"),
    BuiltinItemIcon(key: "home_decor", label: "家居摆件", group: "居家洗漱", symbol: "house", keywords: "摆件 装饰 门牌 挂画 桌面摆件"),
    BuiltinItemIcon(key: "scale", label: "体重秤", group: "居家洗漱", symbol: "scalemass", keywords: "体重秤 体脂秤 厨房秤 电子秤 行李秤"),
    BuiltinItemIcon(key: "therm_room", label: "暖气空调", group: "居家洗漱", symbol: "air.conditioner.horizontal", keywords: "空调遥控 暖风机 暖手宝 电热毯 热水袋 取暖"),
    BuiltinItemIcon(key: "med", label: "医药箱", group: "健康运动", symbol: "cross.case", keywords: "医药箱 急救包 常备药 药盒 感冒药 退烧药"),
    BuiltinItemIcon(key: "pill", label: "胶囊药品", group: "健康运动", symbol: "pills", keywords: "药 药片 胶囊 布洛芬 维生素 鱼油 钙片 益生菌 保健品 褪黑素"),
    BuiltinItemIcon(key: "bandage", label: "创可贴敷料", group: "健康运动", symbol: "bandage", keywords: "创可贴 纱布 绷带 碘伏 酒精棉片 棉签 云南白药 膏药"),
    BuiltinItemIcon(key: "thermometer", label: "体温计", group: "健康运动", symbol: "thermometer.medium", keywords: "体温计 耳温枪 血压计 血氧仪 退烧贴 暖宝宝"),
    BuiltinItemIcon(key: "eyedrop", label: "滴眼药水", group: "健康运动", symbol: "eyedropper", keywords: "眼药水 滴眼液 鼻喷 药水 碘伏液 生理盐水"),
    BuiltinItemIcon(key: "syringe", label: "医疗器械", group: "健康运动", symbol: "syringe", keywords: "医疗 针剂 血糖试纸 试纸 抗原 检测"),
    BuiltinItemIcon(key: "stethoscope", label: "健康监测", group: "健康运动", symbol: "stethoscope", keywords: "听诊器 体检报告 病历本 处方单 挂号"),
    BuiltinItemIcon(key: "shield", label: "口罩防护", group: "健康运动", symbol: "facemask", keywords: "口罩 n95 防护 护腕 护膝 护踝 防晒袖套 耳塞"),
    BuiltinItemIcon(key: "heart", label: "心率保健", group: "健康运动", symbol: "heart", keywords: "心率带 护心 保健 理疗仪 筋膜枪 按摩仪"),
    BuiltinItemIcon(key: "dumbbell", label: "哑铃健身", group: "健康运动", symbol: "dumbbell", keywords: "哑铃 杠铃 弹力带 握力器 健腹轮 俯卧撑支架 健身"),
    BuiltinItemIcon(key: "ball", label: "球类运动", group: "健康运动", symbol: "basketball", keywords: "篮球 足球 排球 球 球类 打气筒"),
    BuiltinItemIcon(key: "racket", label: "球拍羽乒", group: "健康运动", symbol: "tennis.racket", keywords: "羽毛球 羽毛球拍 乒乓球 乒乓球拍 网球拍 手胶 球筒"),
    BuiltinItemIcon(key: "run", label: "跑步装备", group: "健康运动", symbol: "figure.run", keywords: "跑鞋 跑步腰包 运动臂包 运动袜 导汗带"),
    BuiltinItemIcon(key: "swim", label: "游泳装备", group: "健康运动", symbol: "figure.pool.swim", keywords: "泳镜 泳帽 泳衣 鼻夹 游泳耳塞 干湿分离袋"),
    BuiltinItemIcon(key: "rope", label: "跳绳瑜伽", group: "健康运动", symbol: "figure.cooldown", keywords: "跳绳 瑜伽垫 泡沫轴 拉伸带 瑜伽砖 筋膜球"),
    BuiltinItemIcon(key: "stopwatch", label: "秒表计时", group: "健康运动", symbol: "stopwatch", keywords: "秒表 运动手表 计时器 计步器"),
    BuiltinItemIcon(key: "medal_sport", label: "奖杯赛事", group: "健康运动", symbol: "trophy", keywords: "奖杯 完赛奖牌 马拉松 号码布 比赛"),
    BuiltinItemIcon(key: "sunscreen", label: "户外防晒", group: "健康运动", symbol: "sun.max.trianglebadge.exclamationmark", keywords: "防晒 防蚊液 花露水 驱蚊 止痒 清凉油 风油精"),
    BuiltinItemIcon(key: "sleep", label: "助眠用品", group: "健康运动", symbol: "moon.zzz", keywords: "耳塞 眼罩 蒸汽眼罩 止鼾 助眠 颈托"),
    BuiltinItemIcon(key: "bone", label: "骨骼理疗", group: "健康运动", symbol: "figure.walk", keywords: "护腰 矫正带 足弓垫 按摩球 艾灸 刮痧板"),
    BuiltinItemIcon(key: "tool", label: "扳手工具", group: "工具兴趣", symbol: "wrench.and.screwdriver", keywords: "工具 扳手 维修 工具箱 配件 五金"),
    BuiltinItemIcon(key: "hammer", label: "锤子螺丝刀", group: "工具兴趣", symbol: "hammer", keywords: "锤子 螺丝刀 改锥 螺丝 钉子 膨胀管 内六角"),
    BuiltinItemIcon(key: "screwdriver", label: "精密维修", group: "工具兴趣", symbol: "wrench", keywords: "精密螺丝刀 钳子 尖嘴钳 镊子 拆机工具 撬棒 焊锡"),
    BuiltinItemIcon(key: "drill", label: "电动工具", group: "工具兴趣", symbol: "bolt.fill", keywords: "电动螺丝刀 电钻 热熔胶枪 电烙铁 测电笔 万用表"),
    BuiltinItemIcon(key: "tape", label: "胶带胶水", group: "工具兴趣", symbol: "circle.dashed", keywords: "胶带 透明胶 电工胶带 双面胶 502 胶水 ab胶 纳米胶"),
    BuiltinItemIcon(key: "lock", label: "锁具安全", group: "工具兴趣", symbol: "lock", keywords: "锁 密码锁 挂锁 车锁 柜锁 防盗 安全"),
    BuiltinItemIcon(key: "magnet", label: "磁铁吸盘", group: "工具兴趣", symbol: "bolt.circle", keywords: "磁铁 强磁 吸盘 磁吸片 引磁片 支架"),
    BuiltinItemIcon(key: "music", label: "音乐音频", group: "工具兴趣", symbol: "music.note", keywords: "音乐 节拍器 调音器 歌谱 乐谱 琴谱"),
    BuiltinItemIcon(key: "guitar", label: "吉他乐器", group: "工具兴趣", symbol: "guitars", keywords: "吉他 尤克里里 拨片 琴弦 变调夹 背带 口琴 笛子 乐器"),
    BuiltinItemIcon(key: "piano", label: "键盘钢琴", group: "工具兴趣", symbol: "pianokeys", keywords: "钢琴 电钢 midi键盘 电子琴 卡林巴 拇指琴"),
    BuiltinItemIcon(key: "drum", label: "打击乐器", group: "工具兴趣", symbol: "music.quarternote.3", keywords: "鼓 鼓棒 沙锤 打击乐 节奏"),
    BuiltinItemIcon(key: "dice", label: "骰子桌游", group: "工具兴趣", symbol: "dice", keywords: "骰子 桌游 狼人杀 三国杀 麻将 棋类 象棋 围棋"),
    BuiltinItemIcon(key: "cards", label: "扑克卡牌", group: "工具兴趣", symbol: "suit.spade", keywords: "扑克牌 牌 卡牌 塔罗牌 游戏王 宝可梦 球星卡"),
    BuiltinItemIcon(key: "puzzle", label: "拼图积木", group: "工具兴趣", symbol: "puzzlepiece", keywords: "拼图 乐高 积木 魔方 鲁班锁 益智玩具"),
    BuiltinItemIcon(key: "toy", label: "玩偶公仔", group: "工具兴趣", symbol: "teddybear", keywords: "玩偶 毛绒 公仔 娃娃 盲盒 泡泡玛特 挂偶"),
    BuiltinItemIcon(key: "star", label: "收藏手办", group: "工具兴趣", symbol: "star", keywords: "手办 模型 高达 周边 摆件 收藏 徽章 吧唧 立牌"),
    BuiltinItemIcon(key: "film", label: "电影胶卷", group: "工具兴趣", symbol: "film", keywords: "胶卷 底片 电影票根 放映 影碟 录像带"),
    BuiltinItemIcon(key: "drone", label: "航模飞机", group: "工具兴趣", symbol: "paperplane", keywords: "无人机 航模 飞机模型 遥控车 四驱车 桨叶"),
    BuiltinItemIcon(key: "rocket", label: "科幻摆件", group: "工具兴趣", symbol: "sparkles.rectangle.stack", keywords: "火箭 宇航员 摆件 科技 纪念品"),
    BuiltinItemIcon(key: "fish", label: "垂钓户外", group: "工具兴趣", symbol: "fish", keywords: "鱼竿 鱼线 鱼钩 浮漂 钓鱼 水族 鱼缸"),
    BuiltinItemIcon(key: "pet", label: "宠物用品", group: "工具兴趣", symbol: "pawprint", keywords: "宠物 猫粮 狗粮 牵引绳 逗猫棒 猫砂 宠物玩具"),
    BuiltinItemIcon(key: "needle", label: "针线手工", group: "工具兴趣", symbol: "paperclip.circle", keywords: "针线盒 针线 纽扣 别针 织毛衣 钩针 手工 diy"),
    BuiltinItemIcon(key: "box_part", label: "小零件盒", group: "工具兴趣", symbol: "square.grid.2x2", keywords: "零件 螺丝盒 电子零件 备用件 垫片 弹簧 扎带"),
    BuiltinItemIcon(key: "paint", label: "颜料手工", group: "工具兴趣", symbol: "paintpalette", keywords: "颜料 模型漆 勾线笔 喷漆 砂纸 手工刀 切割垫"),
    BuiltinItemIcon(key: "light_stick", label: "应援荧光", group: "工具兴趣", symbol: "wand.and.stars", keywords: "荧光棒 应援棒 仙女棒 演出 道具 魔术"),
    BuiltinItemIcon(key: "flag", label: "旗帜徽记", group: "工具兴趣", symbol: "flag", keywords: "旗帜 标语 贴画 车贴 冰箱贴"),
    BuiltinItemIcon(key: "heart_keep", label: "珍藏纪念", group: "工具兴趣", symbol: "heart.text.square", keywords: "珍藏 情书 日记 毕业纪念 同学录 纪念册 重要物品"),
    BuiltinItemIcon(key: "item", label: "通用物件", group: "工具兴趣", symbol: "cube", keywords: "物品 物件 杂物 其他 默认 通用 小东西"),
  ]

  static let byKey: [String: BuiltinItemIcon] = Dictionary(
    uniqueKeysWithValues: builtins.map { ($0.key, $0) }
  )

  static func isBuiltin(_ raw: String) -> Bool {
    !raw.isEmpty && byKey[raw] != nil
  }

  static func label(for key: String) -> String {
    byKey[key]?.label ?? "通用物件"
  }

  static func inferKey(name: String, aliases: String = "", boxPath: String = "") -> String {
    let s = (name + " " + aliases).lowercased()
    func has(_ keys: [String]) -> Bool { keys.contains { s.contains($0) } }

    // 数码充电
    if has(["充电宝", "移动电源", "powerbank"]) { return "battery" }
    if has(["5号电池", "7号电池", "干电池", "纽扣电池", "电池"]) { return "battery_cell" }
    if has(["插排", "接线板", "插座", "排插", "转换插头"]) { return "outlet" }
    if has(["充电头", "充电器", "氮化镓", "适配器"]) { return "plug" }
    if has(["airpods", "入耳", "耳塞", "蓝牙耳机", "耳机盒", "无线耳机"]) { return "earbuds" }
    if has(["耳机", "头戴"]) { return "earphone" }
    if has(["数据线", "充电线", "转接", "转换", "拓展坞", "扩展坞", "hub", "hdmi", "type-c", "usb-c", "网线"]) { return "cable" }
    if has(["u盘", "优盘", "闪存盘", "加密狗"]) { return "usb" }
    if has(["移动硬盘", "硬盘", "固态", "ssd"]) { return "hdd" }
    if has(["内存卡", "sd卡", "tf卡", "读卡器", "存储卡"]) { return "sdcard" }
    if has(["sim卡", "电话卡", "卡针", "流量卡"]) { return "sim" }
    if has(["手机", "iphone", "手机壳", "钢化膜"]) { return "phone" }
    if has(["电脑", "macbook", "笔记本电脑", "散热器"]) { return "laptop" }
    if has(["平板", "ipad", "kindle", "电纸书", "阅读器", "手写笔"]) { return "tablet" }
    if has(["显示器", "便携屏", "屏幕"]) { return "monitor" }
    if has(["鼠标", "触控板"]) { return "mouse" }
    if has(["键盘", "键帽", "轴体"]) { return "keyboard" }
    if has(["gopro", "pocket", "运动相机", "摄像机", "云台", "稳定器"]) { return "video" }
    if has(["相机", "单反", "微单", "镜头", "拍立得", "三脚架"]) { return "camera" }
    if has(["手柄", "switch", "游戏机", "卡带", "ps5", "xbox"]) { return "gamepad" }
    if has(["路由器", "随身wifi", "光猫", "网卡"]) { return "router" }
    if has(["音箱", "音响"]) { return "speaker" }
    if has(["麦克风", "话筒", "录音笔", "声卡"]) { return "mic" }
    if has(["打印机", "标签机", "相纸", "墨盒"]) { return "printer" }
    if has(["遥控器", "投影仪", "翻页笔", "激光笔"]) { return "remote" }
    if has(["树莓派", "开发板", "芯片", "显卡", "内存条"]) { return "cpu" }
    if has(["光盘", "cd", "dvd", "蓝光", "唱片"]) { return "disc" }
    if has(["收音机", "对讲机", "随身听", "mp3"]) { return "radio" }

    // 证件财务
    if has(["身份证", "护照", "驾照", "校园卡", "学生证", "医保卡", "社保卡", "证件", "门卡", "通行证"]) { return "card" }
    if has(["银行卡", "信用卡", "储蓄卡", "公交卡", "地铁卡", "会员卡", "礼品卡", "卡片"]) { return "bankcard" }
    if has(["钥匙", "门禁"]) { return "key" }
    if has(["钱包", "卡包", "零钱包", "票夹", "卡套"]) { return "wallet" }
    if has(["现金", "钞票", "纸币", "红包", "外币", "存折"]) { return "banknote" }
    if has(["硬币", "零钱", "纪念币"]) { return "coins" }
    if has(["存钱罐", "储蓄罐"]) { return "piggy" }
    if has(["发票", "收据", "小票", "报销单"]) { return "receipt" }
    if has(["票", "门票", "车票", "机票", "优惠券"]) { return "ticket" }
    if has(["奖牌", "工牌", "胸牌", "校徽", "徽章"]) { return "badge" }
    if has(["明信片", "信件", "信封", "贺卡", "邮票"]) { return "mail" }
    if has(["快递", "包裹", "包装盒"]) { return "package" }
    if has(["行李牌", "标签", "吊牌"]) { return "tag" }

    // 健康运动
    if has(["创可贴", "纱布", "绷带", "碘伏", "酒精", "棉签", "膏药"]) { return "bandage" }
    if has(["体温计", "耳温枪", "血压计", "血氧仪", "退烧贴", "暖宝宝"]) { return "thermometer" }
    if has(["眼药水", "滴眼", "鼻喷", "生理盐水"]) { return "eyedrop" }
    if has(["试纸", "抗原", "检测", "注射"]) { return "syringe" }
    if has(["病历", "体检", "处方", "听诊"]) { return "stethoscope" }
    if has(["口罩", "护腕", "护膝", "防护"]) { return "shield" }
    if has(["医药箱", "急救包", "药盒"]) { return "med" }
    if has(["药", "布洛芬", "维生素", "鱼油", "钙片", "褪黑素", "保健品", "感冒", "胶囊"]) { return "pill" }
    if has(["筋膜枪", "按摩仪", "心率带", "理疗"]) { return "heart" }
    if has(["哑铃", "杠铃", "弹力带", "握力器", "健腹轮", "健身"]) { return "dumbbell" }
    if has(["羽毛球", "乒乓球", "网球", "球拍", "手胶"]) { return "racket" }
    if has(["篮球", "足球", "排球", "球"]) { return "ball" }
    if has(["泳镜", "泳帽", "泳衣", "游泳"]) { return "swim" }
    if has(["跳绳", "瑜伽垫", "泡沫轴", "拉伸带"]) { return "rope" }
    if has(["秒表", "计时器"]) { return "stopwatch" }
    if has(["花露水", "驱蚊", "防蚊", "风油精", "清凉油"]) { return "sunscreen" }
    if has(["眼罩", "耳塞", "助眠"]) { return "sleep" }

    // 学习办公
    if has(["毕业证", "学位证", "荣誉证书", "资格证", "成绩单"]) { return "gradcap" }
    if has(["笔记本", "手账", "日记本", "草稿本", "活页本", "本子"]) { return "notebook" }
    if has(["便利贴", "便签", "索引贴", "贴纸"]) { return "sticky" }
    if has(["书签", "书立"]) { return "bookmark" }
    if has(["书", "用处", "课本", "教材", "小说", "杂志", "手册", "辞典", "词典", "指南", "简史", "原理", "思想", "文集"])
      || name.hasSuffix("传") || name.hasSuffix("论")
    {
      return "book"
    }
    if has(["荧光笔", "马克笔", "水彩笔", "白板笔", "记号笔"]) { return "highlighter" }
    if has(["画笔", "毛笔", "颜料", "调色盘"]) { return "brush" }
    if has(["剪刀", "美工刀", "裁纸刀", "订书"]) { return "scissors" }
    if has(["尺", "圆规", "卷尺", "量角器"]) { return "ruler" }
    if has(["文件夹", "资料袋", "风琴包", "档案袋"]) { return "folder" }
    if has(["合同", "试卷", "说明书", "保修卡", "简历", "资料"]) { return "document" }
    if has(["图钉", "磁钉", "冰箱贴", "挂钩"]) { return "pin" }
    if has(["回形针", "夹子", "燕尾夹", "别针"]) { return "paperclip" }
    if has(["计算器"]) { return "calc" }
    if has(["日历", "台历", "挂历"]) { return "calendar" }
    if has(["放大镜"]) { return "magnifier" }
    if has(["望远镜"]) { return "telescope" }
    if has(["印章", "印泥", "私章"]) { return "stamp" }
    if has(["笔", "橡皮", "涂改"]) { return "pen" }

    // 穿戴出行
    if has(["墨镜", "太阳镜", "偏光镜"]) { return "sunglasses" }
    if has(["眼镜", "隐形", "护理液"]) { return "glasses" }
    if has(["伞", "雨衣"]) { return "umbrella" }
    if has(["手表", "手环", "表带"]) { return "watch" }
    if has(["双肩包", "书包", "背包"]) { return "backpack" }
    if has(["行李箱", "登机箱", "拉杆箱"]) { return "luggage" }
    if has(["公文包", "内胆包"]) { return "briefcase" }
    if has(["洗漱包", "化妆包", "斜挎包", "胸包", "收纳包"]) { return "handbag" }
    if has(["帆布袋", "购物袋", "手提袋", "收纳袋", "袋"]) { return "bag" }
    if has(["口红", "唇膏", "粉底", "眉笔", "腮红", "眼影", "化妆"]) { return "cosmetic" }
    if has(["项链", "戒指", "耳环", "手链", "首饰", "珠宝"]) { return "gem" }
    if has(["帽子", "鸭舌帽", "渔夫帽", "发箍", "发夹"]) { return "hat" }
    if has(["围巾", "领带", "手套", "腰带", "皮带"]) { return "scarf" }
    if has(["鞋", "拖鞋", "鞋垫", "鞋带"]) { return "shoe" }
    if has(["衣", "裤", "袜", "外套", "卫衣", "衬衫", "毛衣", "睡衣"]) { return "shirt" }
    if has(["自行车", "骑行", "气筒", "头盔"]) { return "bike" }
    if has(["帐篷", "睡袋", "露营", "野餐垫", "登山杖"]) { return "tent" }
    if has(["颈枕", "旅行", "出差"]) { return "plane" }
    if has(["车载", "行车记录仪", "车充"]) { return "car" }

    // 饮食厨具
    if has(["保温杯", "水壶", "水瓶", "矿泉水", "饮料瓶"]) { return "bottle" }
    if has(["红酒", "白酒", "啤酒", "洋酒", "汽水"]) { return "winebottle" }
    if has(["酒杯", "玻璃杯"]) { return "wineglass" }
    if has(["烧水壶", "养生壶", "吸管杯", "奶茶"]) { return "kettle" }
    if has(["茶", "抹茶", "枸杞", "花茶"]) { return "tea" }
    if has(["杯", "咖啡"]) { return "cup" }
    if has(["锅", "煮锅", "焖烧杯", "厨具"]) { return "chef" }
    if has(["水果刀", "菜刀", "削皮刀", "开瓶器"]) { return "knife" }
    if has(["碗", "保鲜盒", "便当盒", "饭盒"]) { return "soup" }
    if has(["筷子", "勺子", "餐具", "叉子", "吸管"]) { return "utensils" }
    if has(["饼干", "曲奇", "面包", "能量棒"]) { return "cookie" }
    if has(["巧克力", "糖", "薄荷糖", "口香糖", "润喉糖"]) { return "candy" }
    if has(["蛋糕", "甜点", "烘焙"]) { return "cake" }
    if has(["调料", "辣椒", "蜂蜜", "酱油"]) { return "pepper" }
    if has(["零食", "坚果", "薯片", "蛋白粉", "麦片", "泡面"]) { return "snack" }
    if has(["牛奶", "酸奶", "燕麦", "豆浆"]) { return "egg" }

    // 居家洗漱
    if has(["手电", "强光", "头灯", "露营灯"]) { return "flashlight" }
    if has(["灯泡", "灯带", "灯管"]) { return "bulb" }
    if has(["台灯", "挂灯", "小夜灯", "护眼灯", "灯"]) { return "lamp" }
    if has(["蜡烛", "香薰", "精油", "打火机", "火柴"]) { return "candle" }
    if has(["风扇", "吹风机", "挂烫机", "加湿器", "除湿"]) { return "fan" }
    if has(["洗发", "沐浴", "护发", "香皂", "洗手液", "浴球"]) { return "bath" }
    if has(["牙刷", "牙膏", "牙线", "漱口水", "冲牙器"]) { return "toothbrush" }
    if has(["毛巾", "浴巾", "洗脸巾", "纸巾", "抽纸", "湿巾"]) { return "towel" }
    if has(["剃须", "刮胡", "梳子", "指甲剪", "掏耳", "理发"]) { return "razor" }
    if has(["洗面", "护肤", "防晒", "润唇", "香水", "面霜", "面膜", "水乳"]) { return "sparkle" }
    if has(["床单", "被套", "枕头", "枕套", "毯子", "蚊帐"]) { return "bed" }
    if has(["抱枕", "靠垫", "坐垫", "腰靠"]) { return "sofa" }
    if has(["收纳盒", "压缩袋", "真空袋", "整理箱"]) { return "box_storage" }
    if has(["衣架", "晒衣夹", "粘毛器", "除毛球"]) { return "hanger" }
    if has(["垃圾袋", "抹布", "粘尘"]) { return "trash" }
    if has(["洗衣液", "凝珠", "清洁剂", "除味", "喷雾", "消毒"]) { return "spray" }
    if has(["闹钟", "时钟", "番茄钟", "温湿度计"]) { return "clock" }
    if has(["绿植", "盆栽", "多肉", "花盆"]) { return "plant" }
    if has(["相册", "照片", "相框", "证件照"]) { return "photo" }
    if has(["镜子", "化妆镜"]) { return "mirror" }
    if has(["体重秤", "体脂秤", "电子秤", "厨房秤"]) { return "scale" }
    if has(["暖手宝", "热水袋", "电热毯", "暖风"]) { return "therm_room" }

    // 工具兴趣
    if has(["胶带", "胶水", "502", "双面胶", "纳米胶"]) { return "tape" }
    if has(["电钻", "电烙铁", "热熔胶", "万用表", "测电笔"]) { return "drill" }
    if has(["锤子", "螺丝刀", "改锥", "螺丝", "钉子", "内六角"]) { return "hammer" }
    if has(["钳子", "镊子", "撬棒", "拆机"]) { return "screwdriver" }
    if has(["锁", "密码锁", "挂锁"]) { return "lock" }
    if has(["磁铁", "强磁", "吸盘"]) { return "magnet" }
    if has(["吉他", "尤克里里", "拨片", "琴弦", "变调夹", "口琴", "乐器"]) { return "guitar" }
    if has(["钢琴", "电子琴", "midi", "卡林巴", "拇指琴"]) { return "piano" }
    if has(["鼓", "鼓棒"]) { return "drum" }
    if has(["节拍器", "调音器", "歌谱", "乐谱", "音乐"]) { return "music" }
    if has(["骰子", "桌游", "麻将", "象棋", "围棋"]) { return "dice" }
    if has(["扑克", "塔罗", "卡牌", "游戏王", "宝可梦"]) { return "cards" }
    if has(["拼图", "乐高", "积木", "魔方"]) { return "puzzle" }
    if has(["玩偶", "毛绒", "公仔", "娃娃", "盲盒"]) { return "toy" }
    if has(["胶卷", "底片", "票根"]) { return "film" }
    if has(["无人机", "航模", "遥控车"]) { return "drone" }
    if has(["鱼竿", "鱼线", "钓鱼", "鱼缸"]) { return "fish" }
    if has(["猫粮", "狗粮", "牵引绳", "逗猫", "宠物"]) { return "pet" }
    if has(["针线", "纽扣", "手工", "钩针"]) { return "needle" }
    if has(["零件", "扎带", "垫片"]) { return "box_part" }
    if has(["荧光棒", "应援"]) { return "light_stick" }
    if has(["工具", "扳手", "维修", "五金"]) { return "tool" }
    if has(["礼物", "礼盒", "伴手礼"]) { return "gift" }
    if has(["手办", "模型", "高达", "周边", "立牌", "摆件", "收藏"]) { return "star" }
    if has(["纪念册", "同学录", "珍藏"]) { return "heart_keep" }

    if boxPath.contains("书架") || boxPath.contains("书柜") { return "book" }
    return "item"
  }
}

struct StorageItemGlyph: View {
  let icon: String
  let name: String
  var aliases: String = ""
  var boxPath: String = ""
  var size: CGFloat = 19
  var color: Color = Ink.text2

  var body: some View {
    let custom = icon.trimmingCharacters(in: .whitespacesAndNewlines)
    let key = StorageIconCatalog.isBuiltin(custom)
      ? custom
      : StorageIconCatalog.inferKey(name: name, aliases: aliases, boxPath: boxPath)
    let symbol = StorageIconCatalog.byKey[key]?.symbol ?? "cube"
    Image(systemName: symbol)
      .font(.system(size: size, weight: .regular))
      .foregroundStyle(color)
  }
}

struct StorageIconPickerSheet: View {
  @Environment(\.dismiss) private var dismiss
  let itemName: String
  let currentIcon: String
  let onSelect: (String?) -> Void

  @State private var search = ""
  @State private var activeGroup: String = "全部"
  @FocusState private var searchFocused: Bool

  private var trimmedQuery: String {
    search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }

  private var filteredGroups: [(group: String, icons: [BuiltinItemIcon])] {
    let targetGroups = (activeGroup == "全部" || !trimmedQuery.isEmpty)
      ? StorageIconCatalog.groups
      : [activeGroup]
    return targetGroups.compactMap { group in
      let matched = StorageIconCatalog.builtins.filter { def in
        guard def.group == group else { return false }
        if trimmedQuery.isEmpty { return true }
        return def.label.lowercased().contains(trimmedQuery)
          || def.keywords.lowercased().contains(trimmedQuery)
          || def.key.lowercased().contains(trimmedQuery)
      }
      return matched.isEmpty ? nil : (group, matched)
    }
  }

  var body: some View {
    let iconCols = [
      GridItem(.flexible(), spacing: 8),
      GridItem(.flexible(), spacing: 8),
      GridItem(.flexible(), spacing: 8),
      GridItem(.flexible(), spacing: 8),
    ]
    let validCustom = StorageIconCatalog.isBuiltin(currentIcon)

    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 14) {
          // 1. Search Input (zero dead zone)
          HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
              .font(.system(size: 13))
              .foregroundStyle(Ink.text3)
            TextField("搜索 \(StorageIconCatalog.builtins.count) 枚线框图标（如 耳机、保温杯、吉他）…", text: $search)
              .font(.system(size: 14))
              .foregroundStyle(Ink.text)
              .focused($searchFocused)
              .frame(maxWidth: .infinity, minHeight: 26, alignment: .leading)
            if !search.isEmpty {
              Button {
                search = ""
              } label: {
                Image(systemName: "xmark.circle.fill")
                  .font(.system(size: 15))
                  .foregroundStyle(Ink.text3)
                  .frame(width: 32, height: 32)
                  .contentShape(Rectangle())
              }
              .buttonStyle(.plain)
            }
          }
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .studioInputBox(cornerRadius: 10, fill: Ink.card, stroke: Ink.line) {
            searchFocused = true
          }

          // 2. Category Filter Strip + Auto Reset
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
              Chip(text: "全部", selected: activeGroup == "全部") {
                activeGroup = "全部"
              }
              ForEach(StorageIconCatalog.groups, id: \.self) { grp in
                Chip(text: grp, selected: activeGroup == grp) {
                  activeGroup = grp
                }
              }
            }
          }

          if validCustom || !currentIcon.isEmpty {
            Button {
              onSelect(nil)
              dismiss()
            } label: {
              HStack(spacing: 6) {
                Image(systemName: "wand.and.stars")
                  .font(.system(size: 12))
                Text("恢复按物品名称自动匹配")
                  .font(.system(size: 13))
                Spacer()
              }
              .foregroundStyle(Ink.text2)
              .padding(.horizontal, 12)
              .padding(.vertical, 9)
              .background(Ink.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
              .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Ink.line))
              .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
          }

          // 3. Grouped Wireframe Icon Grid
          if filteredGroups.isEmpty {
            Text("没有找到匹配的线框图标，试试换个更通用的关键词（如「电子」「收纳」「工具」）。")
              .font(Ink.meta)
              .foregroundStyle(Ink.text3)
              .padding(.vertical, 12)
          } else {
            ForEach(filteredGroups, id: \.group) { sec in
              VStack(alignment: .leading, spacing: 8) {
                HStack {
                  Text(sec.group)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Ink.text3)
                  Spacer()
                  Text("\(sec.icons.count)")
                    .font(.system(size: 11))
                    .monospacedDigit()
                    .foregroundStyle(Ink.text3)
                }
                LazyVGrid(columns: iconCols, spacing: 8) {
                  ForEach(sec.icons) { def in
                    let active = currentIcon == def.key
                    Button {
                      onSelect(def.key)
                      dismiss()
                    } label: {
                      VStack(spacing: 5) {
                        Image(systemName: def.symbol)
                          .font(.system(size: 18, weight: .regular))
                          .frame(height: 22)
                        Text(def.label)
                          .font(.system(size: 11))
                          .lineLimit(1)
                      }
                      .foregroundStyle(active ? Ink.text : Ink.text2)
                      .frame(maxWidth: .infinity)
                      .padding(.vertical, 10)
                      .padding(.horizontal, 4)
                      .background(active ? Ink.raised : Ink.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                      .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                          .stroke(active ? Ink.text : Ink.line, lineWidth: active ? 1.3 : 1)
                      )
                      .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain)
                  }
                }
              }
            }
          }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
      }
      .scrollDismissesKeyboard(.interactively)
      .background(Ink.bg)
      .navigationTitle("为「\(itemName)」选图标")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("关闭") { dismiss() }
        }
      }
    }
    .studioSheet()
  }
}
