# ui 页面与轮询

plan 对应：§30 Dashboard 页面设计（页面清单与信息层级）+ §31 插件设置页面（YAML 片段形态）。

## 主干

- 页面清单（packages/dashboard/src/ui/pages/）：Overview / RunsList / RunOverview / FieldsList / IgnoredList / RequestsList / RequestDetail / ManifestBrowser / PluginSettings
- 刷新三通道：poller.ts 常态轮询（R11）+ useEventSource 实时事件（b50383b）+ Replay 行落库驱动；轮询通道禁止删除
- PluginSettings 通过 yaml-snippet.ts 生成 nx-mk.config.yml 片段（copy-oriented，不回写）；shotsplates PluginSettings 与 manifest 树浏览器由 ManifestBrowser 渲染
- hooks.ts 承载数据获取 hook；api.ts 是唯一 fetch 门面

## 代码落点

| 行为 | 文件 |
| --- | --- |
| 应用壳/路由 | packages/dashboard/src/ui/App.tsx、router.tsx |
| 轮询 | packages/dashboard/src/ui/poller.ts |
| 实时 hook | packages/dashboard/src/ui/hooks.ts |
| api 门面 | packages/dashboard/src/ui/api.ts |
| YAML 片段 | packages/dashboard/src/ui/yaml-snippet.ts |

## 易错

- api-types（shared）是契约边界——先改 shared 再改 server 再改 ui，顺序错即 TS 红
- 不给页面加写操作（只读工作台裁决）
