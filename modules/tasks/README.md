# tasks

拥有任务（task）与准备清单（checklist、checklistRun）；不拥有习惯、问题、文档。公开入口 index.ts。

- `domain/schedule.ts`：五种排期的校验、区间判断，以及排期与实体平铺字段（scheduleKind / scheduleDate / scheduleStart / scheduleEnd）的互转。
- `domain/task.ts`：状态流转；`settleLifecycle` 保证创建时间不变、完成时间只在首次完成时记录且改期不改写。
- `rules.ts`：把上述纯规则挂到 task 实体上，由服务端组合根注入同步内核。

任务与其他实体走同一条同步流，没有专用接口。
