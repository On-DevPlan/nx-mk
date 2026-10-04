# Runtime Instrumentation（采集注入）

plan 对应：§18 Runtime Instrumentation + §20 UI Evidence（显式 Field 标记）+ §23 Request Trace。

## 主干

- 拦截三层：`proxy/create-tracked-proxy.ts`（SDK 方法追踪，含 path-normalizer 归一化）→ `runtime/patch.ts` patchGlobalFetch 兜底 → plugin-playwright addInitScript 启动注入（契约对齐点）
- `collector/collector.ts` 挂 `window.__MK_COLLECTOR__` 缓冲三表数据；noop-collector.ts 是 analysis=false 时的空实现
- `react/Field.tsx` 显式标记是 UI evidence 唯一来源（§20 铁律：不隐式推断；空标记 weak、hidden DOM suspicious —— anti-cheat 判定见 [[nx-mk-coverage-analysis]]）
- `migrate/engine.ts` 静态替换存量 fetch —— `npx nx-mk migrate`，只做替换不改手写逻辑

## 代码落点

| 行为 | 文件 |
| --- | --- |
| SDK 方法追踪 | packages/client/src/proxy/create-tracked-proxy.ts |
| 路径归一化 | packages/client/src/proxy/path-normalizer.ts |
| fetch 兜底 | packages/client/src/runtime/patch.ts |
| 缓冲回捞 | packages/client/src/collector/collector.ts、noop-collector.ts |
| analysis 开关 | packages/client/src/mode/analysis.ts |
| Field 标记 | packages/client/src/react/Field.tsx |
| migrate 引擎 | packages/client/src/migrate/engine.ts |

## 易错

- `MK_ANALYSIS=true` 给 vite 进程（define 烘焙），不是 CLI——README env 纠错注记为准
- 整页导航重置 collector 缓冲（addInitScript per-document 语义）——判断采集丢数据时先查导航类型再查协议
- path-normalizer 与 manifest-schema/normalizer 是同一归一化语义的两处实现，改语义必须双改同测
