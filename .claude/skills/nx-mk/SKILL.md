---
name: nx-mk
description: Use when working on any package in the nx-mk monorepo (kernel / manifest / client / coverage / dashboard / agent / cli / plugins) to route to the right板块 skill. Master index: 主干架构总览 + 8 个板块 skill 的触发映射表.
---

# nx-mk 总索引

OpenAPI 驱动的前端 API/UI coverage 分析器 monorepo。pnpm workspace，12 包；设计唯一真相 `docx/plan/nx-mk-plan.md`（§1-46）。

## 全景主干

数据流一条线：OpenAPI → `nx-mk.config.yml`（config）→ manifest（manifest/manifest-schema）→ SDK Facade + 采集注入（client）→ chromium 驱动落三表（plugin-playwright）→ policy/三指标四态/SQLite（coverage）→ goal 判定终止 + events.jsonl（kernel）→ CLI 编排（cli）→ 只读工作台（dashboard）→ Agent 修复回路（agent）。

构建顺序固定：client → coverage → kernel → config → plugin-playwright → cli。

## 板块 skill 索引（按需加载）

| skill | 覆盖包 | 何时路由 | 路径 |
| --- | --- | --- | --- |
| [[nx-mk-kernel-core]] | packages/kernel | 微内核/event-bus/goal-loop/RunState/plugin 装配、run 终止判定问题 | nx-mk-kernel-core/ |
| [[nx-mk-manifest-pipeline]] | config / manifest / manifest-schema / schema | OpenAPI 解析、manifest 生成、field-id 归一化、config 读写 | nx-mk-manifest-pipeline/ |
| [[nx-mk-client-facade]] | packages/client | SDK codegen、collector/tracked-proxy 注入、patchGlobalFetch、migrate、Field 组件 | nx-mk-client-facade/ |
| [[nx-mk-coverage-analysis]] | packages/coverage | policy-engine、三指标四态、anti-cheat、SQLite 落库、ignored 校准 | nx-mk-coverage-analysis/ |
| [[nx-mk-dashboard]] | packages/dashboard | server 只读路由、SQLite reader、ui 轮询/页面、PluginSettings、Replay | nx-mk-dashboard/ |
| [[nx-mk-agent]] | packages/agent | Agent loop、claude-code provider、api-ui/review、D1 权限 patches、终止回滚 | nx-mk-agent/ |
| [[nx-mk-cli-config]] | packages/cli | run/start/init/doctor/migrate/loop、构建顺序、watch/CI 后置、验收步骤 | nx-mk-cli-config/ |
| [[nx-mk-plugins]] | plugin-playwright / plugin-swagger | 写新插件、chromium 采集驱动、插件契约与装配 | nx-mk-plugins/ |

## 跨板块裁决（改前先读）

- id-space 唯一真相是 normalizedPath（§17）——manifest / proxy / coverage 三处实现同语义，改必须同步
- 归一化语义三实现点：manifest-schema/normalizer、client/path-normalizer、coverage/policy/glob
- `MK_ANALYSIS=true` 给 vite 进程（define 烘焙），不是 CLI
- 事件名三处同步：agent 发（含 patches 对齐）→ kernel 落 → dashboard 读；RunState 字段新增必须可缺省
- 手动验收三点互证（stdout / events.jsonl goal:met / runs.terminated_by）改任何分析口径后必跑

## 维护义务（每次任务必须执行）

skill 里的 code-map / 口径 / 已知限制是快照，会随代码漂移。**每次在对某板块完成实质工作（改动/新增/排障）后，同步更新该板块 skill**：

1. **code-map**：新文件/新行为落点必须登记；文件改名/删除必须清掉旧行——各行「行号级别的准确性」不保证，但「行为→文件」映射必须真实
2. **易错项**：本次踩到的新坑追加进去（一句话一条），对应板块 refs 的「易错」段
3. **口径/已知限制**：协议、裁决、v0 限定如发生变化，更新对应 ref 的 plan 锚点记录
4. **主 SKILL.md**：只有板块边界或主干流程变化时才动（小改进不加进来，保持精瘦）

判断标准：下次会话读该 skill 的人，会不会被本次改动产生的过时信息误导？会 → 必须更新。

## 状态与背景

Phase 3 完成（policy-analyzer 全量 + goal 闭环）；Phase 4/4.5 dashboard ops 已合并（PR #17）；已知 v0 限制（endpointId unknown fallback、整页导航丢缓冲、cross-document 持久化后置）见 README 和 plan。阶段 spec 在 `docs/superpowers/specs/`。
