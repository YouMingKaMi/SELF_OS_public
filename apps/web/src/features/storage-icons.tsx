import React, { useMemo, useState } from "react";
import {
  BUILTIN_ITEM_ICONS,
  ICON_GROUPS,
  type BuiltinItemIconDef,
  type IconGroup,
  type SvgShape,
} from "./storage-icon-data.ts";

export { BUILTIN_ITEM_ICONS, ICON_GROUPS, type BuiltinItemIconDef, type IconGroup };

const BUILTIN_MAP = new Map<string, BuiltinItemIconDef>(
  BUILTIN_ITEM_ICONS.map((d) => [d.key, d]),
);

export function isBuiltinItemIcon(raw?: string): boolean {
  return Boolean(raw && BUILTIN_MAP.has(raw));
}

export function iconLabel(raw?: string): string {
  if (!raw) return "自动匹配";
  return BUILTIN_MAP.get(raw)?.label ?? "自动匹配";
}

function toReactAttrs(attrs: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    const camel = k.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
    out[camel] = v;
  }
  return out;
}

function WireframeSvg({
  shapes,
  size,
}: {
  shapes: readonly SvgShape[];
  size: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes.map(([tag, attrs], idx) =>
        React.createElement(tag, { key: idx, ...toReactAttrs(attrs) }),
      )}
    </svg>
  );
}

export function inferItemIcon(
  name: string,
  aliases = "",
  boxPath = "",
): string {
  const s = `${name} ${aliases}`.toLowerCase();

  // 数码充电
  if (/充电宝|移动电源|powerbank/.test(s)) return "battery";
  if (/5号电池|7号电池|干电池|纽扣电池|电池/.test(s)) return "battery_cell";
  if (/插排|接线板|插座|排插|转换插头/.test(s)) return "outlet";
  if (/充电头|充电器|氮化镓|适配器/.test(s)) return "plug";
  if (/airpods|入耳|耳塞|蓝牙耳机|耳机盒|无线耳机/.test(s)) return "earbuds";
  if (/耳机|头戴/.test(s)) return "earphone";
  if (/数据线|充电线|转接|转换|拓展坞|扩展坞|hub|hdmi|type-c|usb-c|网线/.test(s)) return "cable";
  if (/u盘|优盘|闪存盘|加密狗/.test(s)) return "usb";
  if (/移动硬盘|硬盘|固态|ssd/.test(s)) return "hdd";
  if (/内存卡|sd卡|tf卡|读卡器|存储卡/.test(s)) return "sdcard";
  if (/sim卡|电话卡|卡针|流量卡/.test(s)) return "sim";
  if (/手机|iphone|手机壳|钢化膜/.test(s)) return "phone";
  if (/电脑|macbook|笔记本电脑|散热器/.test(s)) return "laptop";
  if (/平板|ipad|kindle|电纸书|阅读器|手写笔/.test(s)) return "tablet";
  if (/显示器|便携屏|屏幕/.test(s)) return "monitor";
  if (/鼠标|触控板/.test(s)) return "mouse";
  if (/键盘|键帽|轴体/.test(s)) return "keyboard";
  if (/gopro|pocket|运动相机|摄像机|云台|稳定器/.test(s)) return "video";
  if (/相机|单反|微单|镜头|拍立得|三脚架/.test(s)) return "camera";
  if (/手柄|switch|游戏机|卡带|ps5|xbox/.test(s)) return "gamepad";
  if (/路由器|随身wifi|光猫|网卡/.test(s)) return "router";
  if (/音箱|音响/.test(s)) return "speaker";
  if (/麦克风|话筒|录音笔|声卡/.test(s)) return "mic";
  if (/打印机|标签机|相纸|墨盒/.test(s)) return "printer";
  if (/遥控器|投影仪|翻页笔|激光笔/.test(s)) return "remote";
  if (/树莓派|开发板|芯片|显卡|内存条/.test(s)) return "cpu";
  if (/光盘|cd|dvd|蓝光|唱片/.test(s)) return "disc";
  if (/收音机|对讲机|随身听|mp3/.test(s)) return "radio";

  // 证件财务
  if (/身份证|护照|驾照|校园卡|学生证|医保卡|社保卡|证件|门卡|通行证/.test(s)) return "card";
  if (/银行卡|信用卡|储蓄卡|公交卡|地铁卡|会员卡|礼品卡|卡片/.test(s)) return "bankcard";
  if (/钥匙|门禁/.test(s)) return "key";
  if (/钱包|卡包|零钱包|票夹|卡套/.test(s)) return "wallet";
  if (/现金|钞票|纸币|红包|外币|存折/.test(s)) return "banknote";
  if (/硬币|零钱|纪念币/.test(s)) return "coins";
  if (/存钱罐|储蓄罐/.test(s)) return "piggy";
  if (/发票|收据|小票|报销单/.test(s)) return "receipt";
  if (/票|门票|车票|机票|优惠券/.test(s)) return "ticket";
  if (/奖牌|工牌|胸牌|校徽|徽章/.test(s)) return "badge";
  if (/明信片|信件|信封|贺卡|邮票/.test(s)) return "mail";
  if (/快递|包裹|包装盒/.test(s)) return "package";
  if (/行李牌|标签|吊牌/.test(s)) return "tag";

  // 健康运动
  if (/创可贴|纱布|绷带|碘伏|酒精|棉签|膏药/.test(s)) return "bandage";
  if (/体温计|耳温枪|血压计|血氧仪|退烧贴|暖宝宝/.test(s)) return "thermometer";
  if (/眼药水|滴眼|鼻喷|生理盐水/.test(s)) return "eyedrop";
  if (/试纸|抗原|检测|注射/.test(s)) return "syringe";
  if (/病历|体检|处方|听诊/.test(s)) return "stethoscope";
  if (/口罩|护腕|护膝|防护/.test(s)) return "shield";
  if (/医药箱|急救包|药盒/.test(s)) return "med";
  if (/药|布洛芬|维生素|鱼油|钙片|褪黑素|保健品|感冒|胶囊/.test(s)) return "pill";
  if (/筋膜枪|按摩仪|心率带|理疗/.test(s)) return "heart";
  if (/哑铃|杠铃|弹力带|握力器|健腹轮|健身/.test(s)) return "dumbbell";
  if (/羽毛球|乒乓球|网球|球拍|手胶/.test(s)) return "racket";
  if (/篮球|足球|排球|球/.test(s)) return "ball";
  if (/泳镜|泳帽|泳衣|游泳/.test(s)) return "swim";
  if (/跳绳|瑜伽垫|泡沫轴|拉伸带/.test(s)) return "rope";
  if (/秒表|计时器/.test(s)) return "stopwatch";
  if (/花露水|驱蚊|防蚊|风油精|清凉油/.test(s)) return "sunscreen";
  if (/眼罩|耳塞|助眠/.test(s)) return "sleep";

  // 学习办公
  if (/毕业证|学位证|荣誉证书|资格证|成绩单/.test(s)) return "gradcap";
  if (/笔记本|手账|日记本|草稿本|活页本|本子/.test(s)) return "notebook";
  if (/便利贴|便签|索引贴|贴纸/.test(s)) return "sticky";
  if (/书签|书立/.test(s)) return "bookmark";
  if (/书|传$|传\b|用处|课本|教材|小说|杂志|手册|辞典|词典|指南|论$|简史|原理|思想|文集/.test(s)) return "book";
  if (/荧光笔|马克笔|水彩笔|白板笔|记号笔/.test(s)) return "highlighter";
  if (/画笔|毛笔|颜料|调色盘/.test(s)) return "brush";
  if (/剪刀|美工刀|裁纸刀|订书/.test(s)) return "scissors";
  if (/尺|圆规|卷尺|量角器/.test(s)) return "ruler";
  if (/文件夹|资料袋|风琴包|档案袋/.test(s)) return "folder";
  if (/合同|试卷|说明书|保修卡|简历|资料/.test(s)) return "document";
  if (/图钉|磁钉|冰箱贴|挂钩/.test(s)) return "pin";
  if (/回形针|夹子|燕尾夹|别针/.test(s)) return "paperclip";
  if (/计算器/.test(s)) return "calc";
  if (/日历|台历|挂历/.test(s)) return "calendar";
  if (/放大镜/.test(s)) return "magnifier";
  if (/望远镜/.test(s)) return "telescope";
  if (/印章|印泥|私章/.test(s)) return "stamp";
  if (/笔|橡皮|涂改/.test(s)) return "pen";

  // 穿戴出行
  if (/墨镜|太阳镜|偏光镜/.test(s)) return "sunglasses";
  if (/眼镜|隐形|护理液/.test(s)) return "glasses";
  if (/伞|雨衣/.test(s)) return "umbrella";
  if (/手表|手环|表带/.test(s)) return "watch";
  if (/双肩包|书包|背包/.test(s)) return "backpack";
  if (/行李箱|登机箱|拉杆箱/.test(s)) return "luggage";
  if (/公文包|内胆包/.test(s)) return "briefcase";
  if (/洗漱包|化妆包|斜挎包|胸包|收纳包/.test(s)) return "handbag";
  if (/帆布袋|购物袋|手提袋|收纳袋|袋/.test(s)) return "bag";
  if (/口红|唇膏|粉底|眉笔|腮红|眼影|化妆/.test(s)) return "cosmetic";
  if (/项链|戒指|耳环|手链|首饰|珠宝/.test(s)) return "gem";
  if (/帽子|鸭舌帽|渔夫帽|发箍|发夹/.test(s)) return "hat";
  if (/围巾|领带|手套|腰带|皮带/.test(s)) return "scarf";
  if (/鞋|拖鞋|鞋垫|鞋带/.test(s)) return "shoe";
  if (/衣|裤|袜|外套|卫衣|衬衫|毛衣|睡衣/.test(s)) return "shirt";
  if (/自行车|骑行|气筒|头盔/.test(s)) return "bike";
  if (/帐篷|睡袋|露营|野餐垫|登山杖/.test(s)) return "tent";
  if (/颈枕|旅行|出差/.test(s)) return "plane";
  if (/车载|行车记录仪|车充/.test(s)) return "car";

  // 饮食厨具
  if (/保温杯|水壶|水瓶|矿泉水|饮料瓶/.test(s)) return "bottle";
  if (/红酒|白酒|啤酒|洋酒|汽水/.test(s)) return "winebottle";
  if (/酒杯|玻璃杯/.test(s)) return "wineglass";
  if (/烧水壶|养生壶|吸管杯|奶茶/.test(s)) return "kettle";
  if (/茶|抹茶|枸杞|花茶/.test(s)) return "tea";
  if (/杯|咖啡/.test(s)) return "cup";
  if (/锅|煮锅|焖烧杯|厨具/.test(s)) return "chef";
  if (/水果刀|菜刀|削皮刀|开瓶器/.test(s)) return "knife";
  if (/碗|保鲜盒|便当盒|饭盒/.test(s)) return "soup";
  if (/筷子|勺子|餐具|叉子|吸管/.test(s)) return "utensils";
  if (/饼干|曲奇|面包|能量棒/.test(s)) return "cookie";
  if (/巧克力|糖|薄荷糖|口香糖|润喉糖/.test(s)) return "candy";
  if (/蛋糕|甜点|烘焙/.test(s)) return "cake";
  if (/调料|辣椒|蜂蜜|酱油/.test(s)) return "pepper";
  if (/零食|坚果|薯片|蛋白粉|麦片|泡面/.test(s)) return "snack";
  if (/牛奶|酸奶|燕麦|豆浆/.test(s)) return "egg";

  // 居家洗漱
  if (/手电|强光|头灯|露营灯/.test(s)) return "flashlight";
  if (/灯泡|灯带|灯管/.test(s)) return "bulb";
  if (/台灯|挂灯|小夜灯|护眼灯|灯/.test(s)) return "lamp";
  if (/蜡烛|香薰|精油|打火机|火柴/.test(s)) return "candle";
  if (/风扇|吹风机|挂烫机|加湿器|除湿/.test(s)) return "fan";
  if (/洗发|沐浴|护发|香皂|洗手液|浴球/.test(s)) return "bath";
  if (/牙刷|牙膏|牙线|漱口水|冲牙器/.test(s)) return "toothbrush";
  if (/毛巾|浴巾|洗脸巾|纸巾|抽纸|湿巾/.test(s)) return "towel";
  if (/剃须|刮胡|梳子|指甲剪|掏耳|理发/.test(s)) return "razor";
  if (/洗面|护肤|防晒|润唇|香水|面霜|面膜|水乳/.test(s)) return "sparkle";
  if (/床单|被套|枕头|枕套|毯子|蚊帐/.test(s)) return "bed";
  if (/抱枕|靠垫|坐垫|腰靠/.test(s)) return "sofa";
  if (/收纳盒|压缩袋|真空袋|整理箱/.test(s)) return "box_storage";
  if (/衣架|晒衣夹|粘毛器|除毛球/.test(s)) return "hanger";
  if (/垃圾袋|抹布|粘尘/.test(s)) return "trash";
  if (/洗衣液|凝珠|清洁剂|除味|喷雾|消毒/.test(s)) return "spray";
  if (/闹钟|时钟|番茄钟|温湿度计/.test(s)) return "clock";
  if (/绿植|盆栽|多肉|花盆/.test(s)) return "plant";
  if (/相册|照片|相框|证件照/.test(s)) return "photo";
  if (/镜子|化妆镜/.test(s)) return "mirror";
  if (/体重秤|体脂秤|电子秤|厨房秤/.test(s)) return "scale";
  if (/暖手宝|热水袋|电热毯|暖风/.test(s)) return "therm_room";

  // 工具兴趣
  if (/胶带|胶水|502|双面胶|纳米胶/.test(s)) return "tape";
  if (/电钻|电烙铁|热熔胶|万用表|测电笔/.test(s)) return "drill";
  if (/锤子|螺丝刀|改锥|螺丝|钉子|内六角/.test(s)) return "hammer";
  if (/钳子|镊子|撬棒|拆机/.test(s)) return "screwdriver";
  if (/锁|密码锁|挂锁/.test(s)) return "lock";
  if (/磁铁|强磁|吸盘/.test(s)) return "magnet";
  if (/吉他|尤克里里|拨片|琴弦|变调夹|口琴|乐器/.test(s)) return "guitar";
  if (/钢琴|电子琴|midi|卡林巴|拇指琴/.test(s)) return "piano";
  if (/鼓|鼓棒/.test(s)) return "drum";
  if (/节拍器|调音器|歌谱|乐谱|音乐/.test(s)) return "music";
  if (/骰子|桌游|麻将|象棋|围棋/.test(s)) return "dice";
  if (/扑克|塔罗|卡牌|游戏王|宝可梦/.test(s)) return "cards";
  if (/拼图|乐高|积木|魔方/.test(s)) return "puzzle";
  if (/玩偶|毛绒|公仔|娃娃|盲盒/.test(s)) return "toy";
  if (/胶卷|底片|票根/.test(s)) return "film";
  if (/无人机|航模|遥控车/.test(s)) return "drone";
  if (/鱼竿|鱼线|钓鱼|鱼缸/.test(s)) return "fish";
  if (/猫粮|狗粮|牵引绳|逗猫|宠物/.test(s)) return "pet";
  if (/针线|纽扣|手工|钩针/.test(s)) return "needle";
  if (/零件|扎带|垫片/.test(s)) return "box_part";
  if (/荧光棒|应援/.test(s)) return "light_stick";
  if (/工具|扳手|维修|五金/.test(s)) return "tool";
  if (/礼物|礼盒|伴手礼/.test(s)) return "gift";
  if (/手办|模型|高达|周边|立牌|摆件|收藏/.test(s)) return "star";
  if (/纪念册|同学录|珍藏/.test(s)) return "heart_keep";

  if (/书架|书柜/.test(boxPath)) return "book";
  return "item";
}

export function ItemVisual({
  icon,
  name,
  aliases = "",
  boxPath = "",
  size = 20,
}: {
  icon?: string;
  name: string;
  aliases?: string;
  boxPath?: string;
  size?: number;
}) {
  const custom = (icon ?? "").trim();
  const key = isBuiltinItemIcon(custom)
    ? custom
    : inferItemIcon(name, aliases, boxPath);
  const def = BUILTIN_MAP.get(key) ?? BUILTIN_MAP.get("item")!;
  return <WireframeSvg shapes={def.shapes} size={size} />;
}

export function StorageIconPickerModal({
  itemName,
  currentIcon,
  onSelect,
  onClose,
}: {
  itemName: string;
  currentIcon?: string;
  onSelect: (nextIcon: string | null) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState<"全部" | IconGroup>("全部");

  const q = search.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    const targetGroups =
      activeGroup === "全部" || q ? ICON_GROUPS : [activeGroup];
    return targetGroups
      .map((group) => ({
        group,
        icons: BUILTIN_ITEM_ICONS.filter(
          (d) =>
            d.group === group &&
            (!q ||
              d.label.toLowerCase().includes(q) ||
              d.keywords.toLowerCase().includes(q) ||
              d.key.toLowerCase().includes(q)),
        ),
      }))
      .filter((g) => g.icons.length > 0);
  }, [q, activeGroup]);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="modal storage-icon-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>为「{itemName}」选择线框图标</h2>
          <button type="button" className="muted" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="storage-icon-search-row">
          <input
            autoFocus
            className="storage-icon-search"
            placeholder={`搜索 ${BUILTIN_ITEM_ICONS.length} 枚黑白线框图标（如 充电宝、保温杯、吉他、口红）…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {currentIcon && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              title="恢复按物品名称自动匹配图标"
            >
              自动匹配
            </button>
          )}
        </div>

        <div className="storage-icon-tabs" role="tablist" aria-label="图标分类">
          <button
            type="button"
            role="tab"
            aria-selected={activeGroup === "全部"}
            className={activeGroup === "全部" ? "active" : ""}
            onClick={() => setActiveGroup("全部")}
          >
            全部 <small>{BUILTIN_ITEM_ICONS.length}</small>
          </button>
          {ICON_GROUPS.map((grp) => (
            <button
              key={grp}
              type="button"
              role="tab"
              aria-selected={activeGroup === grp}
              className={activeGroup === grp ? "active" : ""}
              onClick={() => setActiveGroup(grp)}
            >
              {grp}
            </button>
          ))}
        </div>

        <div className="storage-icon-catalog">
          {filteredGroups.length === 0 ? (
            <p className="storage-sub-empty">
              没有找到匹配的线框图标，试试换个更通用的关键词（如「电子」「收纳」「工具」）。
            </p>
          ) : (
            filteredGroups.map(({ group, icons }) => (
              <div className="storage-icon-group" key={group}>
                <div className="storage-icon-group-head">
                  <span className="storage-icon-group-title">{group}</span>
                  <small>{icons.length}</small>
                </div>
                <div className="storage-icon-grid">
                  {icons.map((d) => {
                    const active = currentIcon === d.key;
                    return (
                      <button
                        key={d.key}
                        type="button"
                        className={"storage-icon-opt" + (active ? " active" : "")}
                        onClick={() => onSelect(d.key)}
                        title={d.label}
                      >
                        <WireframeSvg shapes={d.shapes} size={18} />
                        <span>{d.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
