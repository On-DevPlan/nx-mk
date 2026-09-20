# dashboard 代码地图

| 行为 | 文件 |
| --- | --- |
| server 入口 | packages/dashboard/src/server/index.ts |
| 只读路由 ×9 | packages/dashboard/src/server/routes/ |
| SQL 查询 | packages/dashboard/src/server/store/queries.ts |
| db/plugins 读取 | packages/dashboard/src/server/store/{db-reader,plugins-reader}.ts |
| events 尾读 + replay | packages/dashboard/src/server/{event-tail,replay}.ts |
| 静态托管 | packages/dashboard/src/server/{static,ui-dir}.ts |
| ui 壳与路由 | packages/dashboard/src/ui/{App,router}.tsx |
| 页面 ×9 | packages/dashboard/src/ui/pages/ |
| 轮询/实时 | packages/dashboard/src/ui/{poller,hooks}.ts |
| api 门面 | packages/dashboard/src/ui/api.ts |
| YAML 片段 | packages/dashboard/src/ui/yaml-snippet.ts |
| server↔ui 契约 | packages/dashboard/src/shared/api-types.ts |
