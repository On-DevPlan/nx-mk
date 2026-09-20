# server 只读路由（E4/E5/E8）

plan 对应：§30 Dashboard 页面设计 + §31 插件设置页面（数据供给端）。

## 主干

- 路由族（packages/dashboard/src/server/routes/）：runs / events / metrics / fields / requests / ignored / replay / manifest / plugins——一一对应 ui 页面，不引入额外聚合端点
- store/queries.ts 是 SQL 唯一真相（表结构见 [[nx-mk-coverage-analysis]] [[sqlite-schema]]）；plugins-reader.ts 提供 per-run manifest 视图（plugins-manifest 产物，kernel 侧）
- event-tail.ts 提供 events.jsonl 尾读；replay.ts 处理回放数据拼装

## 代码落点

| 行为 | 文件 |
| --- | --- |
| 路由注册 | packages/dashboard/src/server/routes/（9 个文件） |
| SQL 查询 | packages/dashboard/src/server/store/queries.ts |
| db 读取 | packages/dashboard/src/server/store/db-reader.ts |
| plugins 清单读 | packages/dashboard/src/server/store/plugins-reader.ts |
| events 尾读 | packages/dashboard/src/server/event-tail.ts |
| 静态托管 | packages/dashboard/src/server/static.ts、ui-dir.ts |

## 易错

- 只读铁律：server 不含任何写路径；要写数据必须回到 CLI/kernel 链路
- 路由响应新增字段必须同步 shared/api-types.ts 与 ui/pages 消费端，三处一体改
