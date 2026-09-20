# 构建顺序与验收步骤

plan 对应：§11 产物目录 + §39 Watch 模式（后置）+ §40 CI 模式（后置，MVP 不实施）+ §41 MVP 范围 + §42 Roadmap。

## 构建铁律（逐字，无 turbo）

```
corepack pnpm --filter @nx-mk/client build
&& corepack pnpm --filter @nx-mk/coverage build
&& corepack pnpm --filter @nx-mk/kernel build
&& corepack pnpm --filter @nx-mk/config build
&& corepack pnpm --filter @nx-mk/plugin-playwright build
&& corepack pnpm --filter @nx-mk/cli build
```
demo 一键：`corepack pnpm demo:codegen`（demo:openapi → nx-mk run → codegen）。

## Phase 3 验收链（README 手动验收步骤）

1. `demo:openapi` 重新生成 manifest
2. 起 examples/react-vite-demo 后端（8787）+ vite（5173，`MK_ANALYSIS=true`）
3. demo 目录内 `node ../../packages/cli/dist/index.js run`
4. 断言：stdout Coverage 三行 + goal:met / events.jsonl goal:met / `.nx-mk/runs/*/events.jsonl` / runs.terminated_by='goal-met' / coverage-report.json requiredCoverage===1

## 后置项边界

- Watch（§39）/ CI（§40）MVP 不实施——CI 段 config 已删，不要顺手加
- agent 死链/死配置排查命令 `doctor`，先 doctor 再动代码
