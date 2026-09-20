# manifest 生成与归一化

plan 对应：§16 Manifest 设计 + §17 路径归一化（id-space 对齐 normalizedPath）。

## 主干

- parser.ts：OpenAPI → 中间表示；$refs 递归解析，tests/fixtures/openapi-minimal.json 是最小夹具
- schema-walker.ts：按 §16 字段树遍历 response/request schema
- normalizer.ts：路径归一化（glob `*`/`**`/字面 与 coverage policy 同一套语义，§21）
- field-id.ts：endpointId/fieldId 生成规则唯一真相；endpointId 落 'unknown' 的 fallback 已知限制见 plugin-playwright 头注释（plan Ruling 8）

## 代码落点

| 行为 | 文件 |
| --- | --- |
| OpenAPI 解析 | packages/manifest/src/parser.ts |
| schema 遍历 | packages/manifest-schema/src/schema-walker.ts |
| 归一化 | packages/manifest-schema/src/normalizer.ts |
| field-id | packages/manifest-schema/src/field-id.ts |
| 通用 schema 错误 | packages/schema/src/errors.ts |

## 易错

- 归一化语义改动是破坏性 id-space 变更——改 normalizer 前先对齐 policy/glob 测试
- fixtures 目录存在双层嵌套（__tests__/fixtures/fixtures/），rebuild 时注意不要照搬嵌套
