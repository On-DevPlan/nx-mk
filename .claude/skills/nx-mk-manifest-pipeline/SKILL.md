---
name: nx-mk-manifest-pipeline
description: Use when working on packages/manifest, packages/manifest-schema, packages/config, or packages/schema —— OpenAPI 解析、manifest 生成、field-id/路径归一化、nx-mk.config.yml 读写. Progressive disclosure with refs to plan sections and code map.
---

# nx-mk manifest-pipeline

config → OpenAPI 解析 → manifest 生成 → 归一化 field-id 的上游链路。主干导航，细节在 references/。

## 板块边界

`packages/config`（yml 读写）、`packages/schema`（通用 schema 错误模型）、`packages/manifest`（OpenAPI 解析）、`packages/manifest-schema`（字段归一化与 field-id）。不含 manifest 的消费端语义（coverage 见 [[nx-mk-coverage-analysis]]，codegen 见 [[nx-mk-client-facade]]）。

## 链路主干（勿改顺序）

1. `config/loader.ts` 读 nx-mk.config.yml → `config/schema.ts` 校验（goal/coverage/agent/dashboard 段）
2. `manifest/parser.ts` 解析 OpenAPI（含 $refs 递归，tests/parser-refs）
3. `manifest-schema/schema-walker.ts` 遍历 schema → `normalizer.ts` 归一化 → `field-id.ts` 生成 endpointId/fieldId
4. 产物 manifest 供 codegen / coverage / dashboard 三端消费

## 设计仲裁

id-space 唯一真相是 normalizedPath（plan §17 裁决）——一切 id 对齐讨论从这里出发。

## 引用索引（按需加载）

| ref | 何时读取 | 路径 |
| --- | --- | --- |
| [[config-schema]] | 加配置段/字段、改校验规则前 | references/config-schema.md |
| [[manifest-walk]] | 动解析遍历、normalizer、field-id 生成前 | references/manifest-walk.md |
| [[manifest-code-map]] | 在四个包内定位行为落点 | references/manifest-code-map.md |
