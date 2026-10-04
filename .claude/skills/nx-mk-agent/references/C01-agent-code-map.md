# agent 代码地图

| 行为 | 文件 |
| --- | --- |
| loop 驱动/终止回滚 | packages/agent/src/runtime.ts |
| api-ui agent | packages/agent/src/agents/api-ui.ts |
| review agent | packages/agent/src/agents/review.ts |
| claude provider | packages/agent/src/provider/claude-code.ts |
| D1 权限 | packages/agent/src/patches.ts |
| SDK 门面 | packages/agent/src/index.ts |
| 类型 | packages/agent/src/types.ts |

测试全景（packages/agent/src/__tests__/ 8 个）：api-ui / claude-provider / patches / review / runtime-loop / runtime-terminate / sdk 每个子模块均有对应覆盖；协议改动全量必跑。
