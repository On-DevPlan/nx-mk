# plugin-swagger

plan 对应：§16 Manifest 设计（OpenAPI 输入端）+ §5 产品形态（插件化组织能力）。

## 主干

- `index.ts`：从 OpenAPI 输入到插件注册的最小实现——manifest 解析本体在 [[nx-mk-manifest-pipeline]]，本插件消费而非重复解析
- 唯一测试 packages/plugin-swagger/src/__tests__/index.test.ts 是契约守护——改注册面先跑它

## 代码落点

| 行为 | 文件 |
| --- | --- |
| 插件全量 | packages/plugin-swagger/src/index.ts |
| 契约测试 | packages/plugin-swagger/src/__tests__/index.test.ts |

## 易错

- 不要在插件内再实现一遍 OpenAPI 解析——单一解析真相在 packages/manifest
