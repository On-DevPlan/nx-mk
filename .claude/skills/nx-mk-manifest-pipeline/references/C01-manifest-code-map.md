# manifest-pipeline 代码地图

| 行为 | 文件 |
| --- | --- |
| config 发现/加载 | packages/config/src/loader.ts |
| config 校验 | packages/config/src/schema.ts |
| OpenAPI 解析（含 $refs） | packages/manifest/src/parser.ts |
| schema 遍历 | packages/manifest-schema/src/schema-walker.ts |
| 路径归一化 | packages/manifest-schema/src/normalizer.ts |
| endpointId/fieldId | packages/manifest-schema/src/field-id.ts |
| 通用 schema 错误模型 | packages/schema/src/errors.ts、index.ts |

测试：config/__tests__（agent/dashboard/loader 三段）、manifest/__tests__（parser + parser-refs）、manifest-schema/__tests__（field-id / normalizer / schema-walker + fixtures）。
