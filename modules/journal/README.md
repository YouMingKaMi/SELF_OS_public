# journal

拥有编年史 / 未加工信息（journal）、想法暂存（idea）、大学前回忆录（memoir）与待读收藏（readingItem）。目前没有超出字段形状的服务端规则。

`memoir` 存在独立的 `memoir_entries` 表，通过 v1 命令与变化流同步。每条记录填写人生阶段与事件标题，可补充模糊时间、详细回忆与同阶段排序。日历日期可省略，回忆录通过 Gemini 的扩展只读分类 `memoir` 查询。
