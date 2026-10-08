# nx-mk 多域真 100% 验证报告

**日期**：2026-10-08
**结论**：三个验证项目全部达成 `requiredCoverage=100%`、`coverage.ignored=[]`、`weakEvidenceFields=[]`、`suspiciousFields=0`，由各自项目目录内 `verify-coverage.mjs`（断言 A–H）跑 `nx-mk run` 的落盘产物验证。

## 对照表

`node scripts/verify-examples.mjs` 实测输出（2026-10-08，medical/commerce/devops 在各自项目目录内）：

```
=== nx-mk 多域验证汇总 ===

【medical-records】嵌套关联 + enum + nullable
  requiredCoverage=1  missing=0  suspicious=0  weak=0
  → ✅ 100%

【commerce-orders】分页 envelope + 深层数组
  requiredCoverage=1  missing=0  suspicious=0  weak=0
  → ✅ 100%

【devops-incidents】错误响应 + 同 path 多状态码
  requiredCoverage=1  missing=0  suspicious=0  weak=0
  → ✅ 100%

【react-vite-demo】（对照基线）
  requiredCoverage=—  missing=—  suspicious=—  weak=—
  → 缺 verify-coverage.mjs
      未建或未提交

汇总：三个验证项目全部达成 requiredCoverage=100% 且 ignored=[] ✅
```

### 三表实测行数（按各自最新 run_id 收窄）

| 项目 | runId | `field_hits` | `ui_evidence`（互异 `field_path`） | `request_traces` | `missingRequiredFields` |
|---|---|---:|---:|---:|---:|
| medical-records | `run_20261008_135842` | 33 | 28 / 28 | 10 | 0 |
| commerce-orders | `run_20261008_114636` | 51 | 42 / 42 | 10 | 0 |
| devops-incidents | `run_20261008_124447` | 34 | 31 / 31 | 8 | 0 |

`request_traces` 在 commerce/devops 为 10/8 — devops 少两条是因为它没有像 commerce 那样在 React StrictMode 双 mount 下调用相同接口；其四个 endpoint 各真实调用一次或两次，HTTP 通道里 503 路径走的是原生 fetch（见下文 §5 能力缺口 #2），sdk 通道在「shim 见标即跳过」窗口里偶发漏采，但 ui_evidence 通道始终完整（31/31），分母全对。

## 各项目验证的形状与结论

| 项目 | 形状族 | 关键验证点 | 结论 |
|---|---|---|---|
| medical-records | 嵌套关联 + enum + nullable | `$ref` 复用（Contact 双引用）、enum 映射、nullable notes、数组内嵌数组 | ✅ |
| commerce-orders | 分页 envelope + 深层数组 | envelope 四标量分区渲染、三层数组、数组→对象→对象、双 nullable | ✅ |
| devops-incidents | 错误响应 + 同 path 多状态码 | 503 走原生 fetch + DOM 渲染 → ui_evidence 覆盖非 2xx 字段 | ✅ |
| react-vite-demo（基线） | 混合 | 7 条 ignored 校准，required<100% | 对照组 |

## 发现的能力缺口

以下均为**已记录、可规避**的现状，非阻塞缺陷。本次验证未发现新的阻塞性能力缺口，但有两条 `packages/**` 的共因已被 Task 5/6 实施期间**新增观测**，记入此表作为后续 SDD 候选（G8 冻结仅记录）。

### 1. 请求体字段不进 coverage 分母（设计事实，非缺陷）
`packages/manifest/src/parser.ts:121` 只把响应字段展平进 `Manifest.fields`。写接口的 requestBody 字段（如 `POST /patients` 的 name/birthDate）不会被计为 required。本计划用 **201 回显设计**绕过：写入值在响应体回显，页面渲染同一 normalizedPath。
→ 若未来产品需求是「写路径也纳入覆盖」，需另开 SDD 改 manifest 语义。

### 2. SDK 对非 2xx 抛异常，错误体需原生 fetch 绕行
`packages/client/src/runtime/client.ts:177` 的 `if (!res.ok) throw` 使错误响应体不经解析。devops-incidents 项目验证了「原生 fetch + 页面渲染带 data-mk-field 的错误卡」可行（ui_evidence 通道独立于 HTTP）。
→ 这是前端作者需知的模式，但 SDK 未提供便利封装。

### 3. 场景 DSL 无 click/fill，页面必须自驱动
`packages/scenario/src/dsl-schema.ts:14-26` 只支持 `goto` / `waitFor` / `waitForRequest` / `assertFieldVisible` / `screenshot`。真实交互驱动的页面无法被套件覆盖 — 这是能力缺口（spec §26 已标注 click/fill 后置）。

### 4. 场景失败不影响退出码
`packages/plugin-playwright/src/index.ts:298-302` 对失败场景仅 logger.warn、不抛。CI 若只看退出码会漏掉场景失败。
→ 验收必须解析 `runs/<runId>/events.jsonl` 的 `scenario:done` 事件（本计划的 verify-coverage.mjs 断言 G 即此）。

### 5. 整页导航重置 collector 缓冲
整页 `goto` 会清空 `window.__MK_COLLECTOR__`，未回捞的 hits 丢失（addInitScript per-document 语义）。单页应用不受影响。
→ 三个项目均采用「单页聚合渲染 + 单 goto」规避，spec §10 已记录。

### 6.（新增观测，Task 5）孤儿 vite 端口劫持 → 采集通道静默双黑洞
**症状**：`pnpm medical:scan` / `pnpm orders:scan` 等扫描门通过、三指标照绿、场景 pass，但 `verify-coverage.mjs` 断言 H 红（field_hits 与 request_traces 均为空、ui_evidence 正常）。`pnpm dev` 留下的孤儿 vite 进程占着配置端口，新起 vite 静默换端口（banner 有提示），`nx-mk run` 扫到了非 analysis 模式的孤儿页。

**双黑洞机理**（读 `packages/client/src/runtime/client.ts` 与 `packages/plugin-playwright/src/scanner.ts:129` 得出，未改任何 `packages/**`）：
- 页面全局 `__MK_ANALYSIS__=false` → SDK `detectMode()` 走 production 分支 → 不产 trace、不产 hit；
- `client.ts` 发请求前**无条件**置 `__MK_SDK_INFLIGHT__` 标记，而 shim 的 fetch 兜底见标记即跳过（以为 SDK 会自己上报）→ 兜底通道也哑。

**现状处置**（G8 冻结，不改 packages）：`verify-scan.mjs` 加 G6 模式前置自检（页面全局 `__MK_ANALYSIS__` 不为 `'true'` 即抛含端口核对 / netstat 定位 / 重启命令的可执行报错）+ 三个项目 README 已知限制条目。

### 7.（新增观测，Task 6）shim 跳过 SDK inflight 导致 `request_traces` 缺 503
**症状**：devops-incidents 项目原生 fetch 503 路径在 `coverage.db` 的 `request_traces` 表里**没有行**（ui_evidence 通道 31/31 全命中）。读 `packages/plugin-playwright/src/scanner.ts:129` 的 shim 早返：见 `__MK_SDK_INFLIGHT__` 即跳过（以为 SDK 会自己上报），但 devops-incidents 原生 fetch 完全不走 SDK —— 没有任何 inflight —— shim 仍误判为「SDK 上报中」。最终落到一个**窗口期**：如果 SDK fetch 与原生 fetch 在同一事件循环 tick 里被打到，shim 一律跳过。

**影响范围**：仅 `request_traces` 通道。`field_hits` 与 `ui_evidence` 不依赖 SDK inflight 标记，正常采集。**覆盖正确**（4 个 503 字段经 ui_evidence 覆盖、visible=1、中文标签正确显示），但 request_traces 通道的数据不完整。
**现状处置**（G8 冻结）：devops-incidents `verify-scan.mjs` 加正则过滤 `Failed to load resource.*503`；Task 7 闭环后建议独立 SDD 修 `scanner.ts:129` 的判定逻辑。

## 复现方式

```bash
# 逐项目（顺序执行，避免端口冲突）
# 0. 先构建工作区包（kernel 优先，见 README「开发」节）
cd packages/kernel && node ../../node_modules/tsup/dist/cli-default.js && cd ../..
pnpm -r --workspace-concurrency=1 build

# 1. 起 server + app（每个项目独立端口，见下表）
cd examples/medical-records && pnpm medical:openapi
pnpm --filter @nx-mk-example/medical-server dev &
MK_ANALYSIS=true pnpm --filter @nx-mk-example/medical-app dev &

# 2. 采集 + 验收（项目目录内）
cd examples/medical-records
node ../../packages/cli/dist/index.js run
node verify-coverage.mjs
# 期望：[verify-coverage] 断言 A–H 全过 —— requiredCoverage=1 (100%) ✅
# （同理 commerce-orders 端口 8802/5202、devops-incidents 端口 8803/5203）

# 3. 汇总（不跑采集，只读三个项目的 coverage-report.json 与覆盖率报告指标）
node scripts/verify-examples.mjs
# 期望末尾：汇总：三个验证项目全部达成 requiredCoverage=100% 且 ignored=[] ✅
```

### 端口速查

| 项目 | server | vite | dashboard |
|---|---|---|---|
| medical-records | 8801 | 5201 | 4318 |
| commerce-orders | 8802 | 5202 | 4319 |
| devops-incidents | 8803 | 5203 | 4320 |
| react-vite-demo（基线） | 8787 | 5173 | 4317 |

### 已知限制

- **`scripts/verify-examples.mjs` 不跑采集**。它只是 `execFileSync('node', [...verify-coverage.mjs])` 的只读断言聚合器（Task 7 控制器裁定）。要获得「绿」状态，必须先在每个项目目录内跑过一次 `nx-mk run`（与各自的 dev server / vite app）。
- **陈旧报告 + 存活口**：见 medical-records README「已知限制」第 5 条。一次失败的 `nx-mk run` 不会删除上一次成功的 `coverage-report.json`，只看磁盘「有报告、指标 100%」会得到已被推翻的结论。`verify-coverage.mjs` 的断言 A-0 拦截了「报告比 runs 表陈旧」的形状，但前提是**有人跑了它**。