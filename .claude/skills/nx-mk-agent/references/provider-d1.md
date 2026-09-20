# Provider 与 D1 权限

plan 对应：§34 Agent Provider（claude-code 单实现）+ §36 Agent 权限模型（D1 决策）。

## 主干

- provider/claude-code.ts 是唯一 provider；MVP 不做多 provider 抽象——加 provider 属于 plan 层决策不是实现顺手改
- D1 权限模型（§36）：patches.ts 集中收敛工具调用白名单——绕过 patches 直调工具是漏洞，测试 patches.test.ts 守护
- claude-provider.test.ts 守 provider 契约；事件命名对齐 patch 见 [[nx-mk-kernel-core]] [[runstate-events]]

## 代码落点

| 行为 | 文件 |
| --- | --- |
| claude provider | packages/agent/src/provider/claude-code.ts |
| D1 权限 patches | packages/agent/src/patches.ts |
| 类型契约 | packages/agent/src/types.ts |

## 易错

- 权限扩面必须先过 §36 表登记，再改 patches.ts；只加白名单不改拒绝路径会静默放行
