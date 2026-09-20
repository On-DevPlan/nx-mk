# coverage 代码地图

| 行为 | 文件 | plan |
| --- | --- | --- |
| policy 引擎 | packages/coverage/src/policy/policy-engine.ts | §21 |
| glob 语义 | packages/coverage/src/policy/glob.ts | §21 |
| 三指标/四态 | packages/coverage/src/analyzer/coverage-analyzer.ts | §28/§21.3 |
| 报告落盘 | packages/coverage/src/analyzer/report.ts | §28 |
| anti-cheat 分类 | packages/coverage/src/anti-cheat/classify.ts | §29 |
| DOM 证据扫描 | packages/coverage/src/evidence/dom-scanner.ts | §29 |
| 表结构 | packages/coverage/src/db/schema.ts | §25 |
| 连接门面 | packages/coverage/src/db/client.ts | §25 |

测试全景：packages/coverage 各子模块 __tests__/；policy 与 anti-cheat 是口径改动必跑。
