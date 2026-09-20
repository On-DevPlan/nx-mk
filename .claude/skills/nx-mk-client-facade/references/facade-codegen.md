# SDK Facade codegen

plan 对应：§3 最终用户体验（npx 一键闭环）+ §8 Monorepo 结构（SDK Facade 接入版）+ §11 产物目录（generated-sdk.ts 落点）。

## 主干

- `generate-sdk.ts` 消费 manifest（[[nx-mk-manifest-pipeline]] 产物）→ emit-endpoint.ts 逐 endpoint 生成 API 方法、emit-types.ts 生成请求/响应类型
- 产物固定路径 `examples/react-vite-demo/app/src/generated-sdk.ts`，由 `pnpm demo:codegen` 闭环产出（demo:openapi → nx-mk run → codegen）
- codegen 语法校验铁律见 docs/hygiene-backlog.md（生成即解析校验，不许出无效 TS）

## 代码落点

| 行为 | 文件 |
| --- | --- |
| 生成入口 | packages/client/src/codegen/generate-sdk.ts |
| endpoint emission | packages/client/src/codegen/emit-endpoint.ts |
| 类型 emission | packages/client/src/codegen/emit-types.ts |
| demo 闭合脚本 | package.json demo:codegen / demo:openapi |

## 易错

- emit 模板改类型面必须与 manifest-schema 的 id/类型语义对齐，否则 field-id 断裂
- demo manifest 有 22 个 response 字段——codegen 改动后核对覆盖率三指标没有意外变化
