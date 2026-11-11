export const features = [
  { key: "home", name: "今日", icon: "⌂", department: "" },
  { key: "practice", name: "个人推进台", icon: "↗", department: "执行部" },
  { key: "tasks", name: "任务", icon: "✓", department: "执行部" },
  { key: "habits", name: "习惯记录库", icon: "∿", department: "执行部" },
  { key: "ideas", name: "想法暂存", icon: "✧", department: "执行部" },
  { key: "checklists", name: "准备清单", icon: "☷", department: "执行部" },
  { key: "expenses", name: "花销", icon: "¥", department: "财政部" },
  { key: "treasury", name: "国库", icon: "▣", department: "财政部" },
  { key: "freedom", name: "自由指南灯", icon: "✦", department: "财政部" },
  { key: "chronicle", name: "编年史", icon: "▤", department: "档案库" },
  { key: "raw", name: "未加工信息原料", icon: "✎", department: "档案库" },
  { key: "monthly", name: "月报", icon: "▦", department: "档案库" },
  { key: "metrics", name: "每日指标", icon: "∾", department: "档案库" },
  { key: "days", name: "重要日子", icon: "◷", department: "档案库" },
  { key: "notes", name: "资料笔记", icon: "▱", department: "中科院" },
  { key: "thoughts", name: "个人思考", icon: "◇", department: "执行部" },
  { key: "departments", name: "部门与知识库", icon: "⊞", department: "" },
  { key: "discover", name: "发现", icon: "⌕", department: "" },
  { key: "settings", name: "设置", icon: "⚙", department: "" },
] as const;
export type FeatureKey = (typeof features)[number]["key"];
export const feature = (key: string) =>
  features.find((f) => f.key === key) ?? features[0];
export type Navigate = (key: FeatureKey) => void;
