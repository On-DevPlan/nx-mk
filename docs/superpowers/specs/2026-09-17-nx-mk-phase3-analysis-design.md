# nx-mk Spec: Phase 3 — 分析 (policy-engine 全量 / coverage analyzer / anti-cheat v0 / id-space 对齐)

> 日期：2026-09-17
> 范围：Phase 3 — 让 coverage 数据可判定（policy 规则 → 三指标 CoverageReport → 反作弊标记 → demo goal 闭环）
> 不在范围：Phase 4 Dashboard（页面/API）、Phase 5 Agent、scenario DSL/Replay（§26/§27）、Evidence Quality 其余检测（JSON.stringify dump / console.log 探针）、端点限定规则、manifest-tag/annotation 规则源、隐私脱敏
> 关联文档：
> - `docx/plan/nx-mk-plan.md`（§16.3/§16.4 Field、§17 路径归一化、§21 Coverage Policy、§22 Returned but ignored、§28 Coverage Analyzer、§29 Evidence Quality 与反作弊、§42 Phase 3 roadmap）
> - `docs/superpowers/specs/2026-09-16-nx-mk-phase2-collection-design.md`（采集层 — 本 spec 的数据来源）
> - `.superpowers/sdd/2026-09-16-phase2-collection/final-review.md`（id-space 缺口的实证与裁定）

---

## 1. 目标与非目标

### 1.1 现状与缺口

Phase 2 交付了完整采集链路，但分析层是占位：

1. **id 空间断裂（Phase 2 遗留首项，final review 实锤）**：goal-loop coverage 用 `field:${fieldId}` 字符串匹配，missing 索引来自 manifest `f.id`（stableFieldId 哈希），而 DOM 直报 fieldId 是 `dataMkField` 业务字符串、proxy hit 侧是 normalizedPath —— 三空间互不相交，demo 终止恒 max-turns（实为不跑 goal：config 无 `goal:` 段），`terminatedBy` 不落任何持久化文件
2. **coverage analyzer 是 D7 极简版**：只算 required-unhit=missing，无 policy 规则、无 §21 三指标、无 ignored/notApplicable 态
3. **无 policy-engine**：config 无 `coverage:` 段，用户无法声明 required/optional/ignored
4. **无 anti-cheat**：§29 的 hidden DOM / 空标记检测不存在；proxy 原型方法名（`data.then`/`tags.join`/`length`）作为噪音已实证落库（manual run field_hits 中 3 行）
5. **无 CoverageReport 产物**：run 结束无摘要输出、无 JSON 落盘

### 1.2 目标

本 spec 交付后：

1. **id 空间统一为 normalizedPath**（用户已确认）：goal-loop missing 索引改按 manifest `normalizedPath` 建；DOM `data-mk-field` 约定 = normalizedPath（demo 数据源修正）；proxy/DOM 两 hit 源天然同空间，**不需要 manifest 注入浏览器**
2. **`terminatedBy` 可观测**：goal 终止事件经 event-bus 落 events.jsonl；`runs` 表幂等加列 `terminated_by`
3. **policy-engine 全量（§21）**：config `coverage:` 段（required/optional/ignored glob 列表）→ 每字段 PolicyDecision（§21.4 逐字形状），优先级 §21.5 逐字
4. **coverage analyzer 全量（§28）**：CoverageReport（§28.2 形状）+ 三指标（§21.6）+ FieldCoverageState 四态（§21.3）+ ignored-returned 集合（§22 数据）
5. **anti-cheat v0 三类机检**：hidden DOM → suspicious；空标记（innerText 空或等于字段名）→ weak；proxy 原型方法名白名单 → 不进 field_hits
6. **run 产物闭环**：`nx-mk run` 末尾 stdout 三指标摘要 + `.nx-mk/coverage-report.json` 落盘
7. **demo `goal:` 段补齐** → §1.4.2（Phase 2 遗留）端到端 PASS：field-hit 提前 goal-met 在 events.jsonl 可审计

### 1.3 非目标

- Dashboard 页面/API（Phase 4）——CoverageReport JSON 是其数据契约
- Agent / suggest diff（Phase 5）
- scenario DSL / Replay / assertion_hit 数据源（§26/§27）
- 端点限定规则（`GET /users/{id}: data.x`）、manifest-tag/annotation 规则源（§21.4 source 四源只做 user-config + default 两源）
- JSON.stringify dump 检测、console.log 触发访问检测（需运行时探针，Dashboard 前补）
- 隐私脱敏（§24）
- policy-engine 不改 goal-loop 的 termination 语义（targetRatio 仍作用于 ratio；三指标中 ratio 对应 requiredCoverage）

### 1.4 成功标准

1. demo 手动验收：`nx-mk run`（带 `goal:` 段）→ events.jsonl 出现 `goal:met` 且 `runs.terminated_by='goal-met'`；coverage-report.json 三指标非零
2. 三点契约测试通过：manifest fieldPath ↔ proxy normalizedPath ↔ DOM data-mk-field 在 hermetic fixture 下互含
3. policy-engine 单测覆盖 §21.5 优先级矩阵全路径 + glob 语义（`*`/`**`/字面段）
4. analyzer 单测：四态 + 三指标算术 + ignored-returned + suspicious 全覆盖
5. proxy 白名单后 `data.then` 不再出现在 field_hits（回归测试 + demo 复跑验证）
6. 全部测试通过（当前 275 → 预计 +60±20）；`corepack pnpm run demo:typecheck` 绿

---

## 2. 仓库架构

### 2.1 目录变化

```
packages/coverage/src/
├── policy/
│   ├── index.ts                      # 公共导出
│   ├── glob.ts                       # 有限通配匹配（* 段内 + ** 跨段，纯函数）
│   └── policy-engine.ts              # evaluatePolicy(manifestFields, policyConfig) → PolicyDecision[]
├── analyzer/
│   ├── coverage-analyzer.ts          # 重写：analyzeCoverage(§28.2 CoverageReport)
│   └── report.ts                     # CoverageReport 类型 + JSON 序列化形状
├── db/
│   ├── schema.ts                     # +ensureColumn 幂等加列工具
│   └── client.ts                     # +coverage_fields 升级写入 / runs.terminated_by
└── anti-cheat/
    └── classify.ts                   # evidence → valid/weak/suspicious/invalid（§29.1）
packages/kernel/src/
├── initial-coverage.ts               # missing 索引 f.id → f.normalizedPath
├── kernel.ts                         # goal 终止事件走 event-bus；run 结束写 runs.terminated_by
└── goal-loop.ts                      # 无契约变化（computeCoverage 键不动——两侧 fieldId 已同为 path）
packages/config/src/
└── schema.ts                         # +coverage 段（required/optional/ignored glob 列表）
packages/client/src/proxy/
└── create-tracked-proxy.ts           # +原型方法名白名单（METHOD_NAME_BLOCKLIST）
packages/plugin-playwright/src/
└── scanner.ts                        # PAGE_SCAN_SCRIPT + textSample 读取（向后兼容可选字段）
packages/cli/src/
└── commands/run.ts                   # +analyzer 装配：flush 后跑 → stdout 摘要 + JSON 落盘
examples/react-vite-demo/
├── nx-mk.config.yml                  # +goal 段（targetRatio 1.0）+ coverage 段示例
└── app/src/components/*.tsx          # data-mk-field 值改为 data.* 约定
tests/integration/
└── phase3-analyze.test.ts            # 三点契约 + policy→analyzer→report 全链（hermetic）
```

### 2.2 依赖变化

- **零新第三方依赖**（glob 自实现有限语义）
- kernel 不新增依赖（initial-coverage 只多读一个字段；manifest 子集形状扩展）
- config/coverage/client/plugin-playwright 均为既有内部依赖

---

## 3. 组件职责

### 3.1 id-space 对齐（kernel + demo 数据源）

- `initial-coverage.ts`：`ManifestFieldSubset` 扩展 `normalizedPath` 字段；missing 项 `fieldId = f.normalizedPath`（§16.4 语义变更：Goal Loop 口径中 fieldId 即 normalizedPath）。文件中旧字段无 normalizedPath 时跳过（防御）
- **不变式**：goal-loop `computeCoverage`（`field:${fieldId}` 键）零改动 —— 上游两侧（snapshot hit 报告 fieldId=normalizedPath、DOM 直报 fieldId=dataMkField=path）已天然进同一空间
- **跨 endpoint 同名路径碰撞**（如 `data.id` 同时在两个 endpoint）：Set 语义合并命中，v0 容忍（与现 analyzer per-path 口径一致；endpoint 消歧推 Phase 4/5）
- demo 组件 `data-mk-field` 值修正为 normalizedPath 约定（`data.*`），manifest fieldPath 与之对齐（schema 即响应结构，天然对齐）
- `terminatedBy`：kernel goal 终止时（kernel.ts 现构造结果处）把 `goal:met`/`goal:unmet:<reason>` 事件交 event-bus（自动落 events.jsonl）；run.ts 在 kernel.run() 返回后从结果取 `terminatedBy` 调 `db.endRun(status, terminatedBy)`；`runs` 表经 `ensureColumn('terminated_by TEXT')` 幂等扩展（§25.1 是 plan 冻结 DDL，扩展列以 ALTER 落地，spec 记录为 schema 演进）

### 3.2 policy-engine（`packages/coverage/src/policy/`）

```ts
interface PolicyConfig {
  required?: string[]           // glob 列表
  optional?: string[]
  ignored?: string[]
}
interface PolicyDecision {      // §21.4 逐字
  fieldId: string
  fieldPath: string
  status: 'required' | 'optional' | 'ignored' | 'unknown'
  countedInRequiredCoverage: boolean
  countedInEffectiveCoverage: boolean
  matchedRule?: { source: 'user-config' | 'default'; pattern: string; reason?: string }
}
function evaluatePolicy(fields: ManifestFieldLike[], policy: PolicyConfig): PolicyDecision[]
```

- 优先级 §21.5 逐字：user required > user ignored > user optional > default > unknown；default = schema `required===true` ? required : optional（`field.required` 来自 §16.3 walker）
- 规则按 **列表顺序** 取首个命中（同列表内先声明先胜）；跨列表按优先级
- `countedInRequiredCoverage` = status==='required'；`countedInEffectiveCoverage` = status ∈ {required, optional}（§21.6 分母语义；ignored/unknown 两不进）
- glob 语义：按 `.` 分段；`*` 匹配单段、`**` 匹配任意段数、其余字面全等。单测钉死（`*.metadata.*` 匹配 `data.metadata.traceId` 不匹配 `data.metadata`）

### 3.3 coverage analyzer 全量（`packages/coverage/src/analyzer/`）

```ts
function analyzeCoverage(input: {
  runId: string
  manifest: ApiManifest
  policyDecisions: PolicyDecision[]
  drained: Drained                    // collector drain 产物（hits/traces/evidence）
  db: AnalyzerDb
}): CoverageReport                     // §28.2 形状（metrics + 四组 FieldCoverageItem + endpoints + requests）
```

- 每字段：policy status + accessHit（normalizedPath ∈ proxy hits）+ uiHit（normalizedPath ∈ evidence）→ FieldCoverageState 四态（§21.3）：policy ignored → 'ignored'；required/optional 且 (accessHit ∨ uiHit) → 'covered'；required 未命中 → 'missing'；optional 未命中 → 'notApplicable'（v0 语义：optional 未访问不进任何报告集合，区别于 D7 的 'optional-unhit' 字符串——state 值迁移为 §21.3 枚举）
- unknown 态字段（policy 未覆盖路径）→ 'notApplicable' + 不进分母
- 三指标 §21.6：requiredCoverage / effectiveCoverage / rawBackendFieldCoverage（分母分别为 policy required / required+optional / returned 全体）
- ignored-returned（§22 数据）：policy ignored 且 accessHit 的字段集合（含 hit count，供 Dashboard/CLI 列表）
- anti-cheat 输入接入：evidence 经 `classifyEvidence` 标注后计入 `weakEvidenceFields` / `suspiciousCoverage`
- coverage_fields 13 列写入升级：policy_status / coverage_state / access_hit / ui_hit / assertion_hit(恒 0) / suspicious / counted_required / counted_effective 逐列对齐
- 纯函数核心（内存计算）+ IO 仅 coverage_fields INSERT（nx-ce 分层延续）；返回 CoverageReport 由调用方落 JSON

### 3.4 anti-cheat v0（`packages/coverage/src/anti-cheat/`）

```ts
type EvidenceQuality = 'valid' | 'weak' | 'suspicious' | 'invalid'   // §29.1
function classifyEvidence(ev: { visible?: boolean; textSample?: string; fieldPath: string }): EvidenceQuality
```

1. **hidden DOM**：`visible === false` → `'suspicious'`（§29.2 display:none/visibility:hidden/offscreen 在采集侧已折叠为 visible 布尔——Phase 2 scanner 语义）
2. **空标记**：`textSample` 为空串或 `=== fieldPath` 末段字段名 → `'weak'`（只标记不展示真实值）
3. 其余（visible 且有真实文本）→ `'valid'`；`'invalid'` v0 不产（console.log 源检测后置）
- **textSample 落库**：`UiEvidenceCore` 增可选 `textSample?: string`（截断 80 字符）；`ui_evidence` 幂等加列 `text_sample TEXT`（ensureColumn 同 §3.1 机制，§25.7 plan DDL 演进记录同 runs.terminated_by）
- **proxy 白名单**（client/proxy）：`METHOD_NAME_BLOCKLIST = ['then','catch','finally','toJSON','valueOf','toString','length','size','join','map','filter','reduce','forEach','keys','values','entries','hasOwnProperty']` —— get 拦截命中名单 → 透传原值、**不** collector.hit、**不**递归包裹。注意 `length` 仅对 Array target 生效（plain object 的 `data.length` 字段是真字段，仍记 hit）
- jsonl 证据链：weak/suspicious 判定全部来自已落库/已采集数据，无新增运行时探针

### 3.5 run 装配 + 产物（`packages/cli/src/commands/run.ts`）

- 顺序（collect 配置时）：flushDrained → **analyzer**（读 manifest.json + config coverage 段 + drain 产物）→ CoverageReport → `stdout` 摘要（Required / Effective / Raw Backend 三行 + missing/ignored/suspicious 计数）→ `.nx-mk/coverage-report.json`（覆盖写）→ endRun(status, terminatedBy)
- 非 collect run（无 coverage.db）跳过 analyzer，行为不变
- analyzer 抛错 → run 标 failed（与 flush 同语义，spec §4 数据完整性优先）；报告写失败 → warn 不阻断（产物非关键路径）

### 3.6 demo 闭环

- `nx-mk.config.yml`：+`coverage:` 示例段（`ignored: ['**.metadata.**', 'data.internalRiskScore']`）+ `goal:` 段（`targetRatio: 1.0`；goal 语义沿用 kernel 现契约）
- 组件 data-mk-field 修正（3-4 处）；`MK_ANALYSIS=true` vite 链路不变
- 手动验收 = §1.4.1

---

## 4. 错误处理（fail-fast）

| 场景 | 处理 |
|---|---|
| config coverage 段非法（非 string[] / 空 pattern） | CONFIG_INVALID（config schema 校验，run 前 fail-fast） |
| manifest.json 缺失/解析失败（analyzer 阶段） | CoverageReport 以空 fields 产出 + stdout warn（run 不 fail——goal-loop 已容忍此态） |
| analyzer 内部异常 | run 标 failed + 原错上抛（数据完整性优先，同 flush） |
| coverage-report.json 写失败（权限等） | logger.warn + 继续（报告是产物不是账本；coverage_fields 已落库） |
| evidence 缺 textSample（旧采集数据） | 按 valid 处理（向后兼容，字段可选） |
| ensureColumn 在只读 db 上失败 | 抛出（schema 演进失败即环境失败） |
| proxy 白名单误伤真实字段 | 白名单常量导出可测；`length` 限 Array target 的判定有逐条单测 |

---

## 5. 数据流（运行时序增量）

```
nx-mk run（collect + coverage + goal 段）
  ├─ …Phase 2 链路不变（采集 → drain → flushDrained → SQLite）
  ├─ goal loop（goal 段存在时）：
  │    initial-coverage missing 索引 = manifest.normalizedPath（不再是 stableFieldId 哈希）
  │    beforeRun DOM 直报 fieldId=dataMkField(=path) → computeCoverage 命中 → 提前 goal-met
  │    终止事件 goal:met / goal:unmet:<reason> → event-bus → events.jsonl
  ├─ run 结束：
  │    runs.terminated_by = result.terminatedBy（ensureColumn 幂等列）
  │    policy-engine: manifest.fields + config coverage 段 → PolicyDecision[]
  │    analyzer: decisions + drained + evidence(含 textSample/visible) → CoverageReport
  │    coverage_fields 13 列升级写入；stdout 三指标摘要；coverage-report.json 落盘
  └─ 验收审计链：events.jsonl(goal:met) + runs.terminated_by + coverage-report.json 三点互证
```

---

## 6. 测试策略

全部 vitest 单测 + 集成扩展。**hermetic 约束不变**（不跑真浏览器）：

| 层 | 用例要点 |
|---|---|
| glob（coverage） | `*`/`**`/字面段/混合/无通配字面全等；`*.metadata.*` 匹配矩阵 |
| policy-engine（coverage） | §21.5 优先级矩阵逐行（required>ignored>optional>default>unknown）；同列表顺序优先；matchedRule 记录 source/pattern；counted* 布尔与 status 联动 |
| analyzer（coverage） | 四态全覆盖；三指标算术（含零分母）；ignored-returned 集合；unknown 不进分母；coverage_fields 列值锁（延续 13 列逐列绑定模式） |
| anti-cheat（coverage） | classifyEvidence 四分支 + 向后兼容（无 textSample） |
| proxy（client） | 白名单逐条：Promise 方法名（then/catch/finally）、Array 方法名（含 length 仅 Array target）、Object 原型名；真实字段不受影响回归 |
| scanner（plugin-playwright） | textSample 注入后 descriptor 形状（向后兼容可选） |
| initial-coverage（kernel） | missing 项 fieldId = normalizedPath；无 normalizedPath 字段跳过；PLACEHOLDER 不变 |
| runs 加列（coverage） | ensureColumn 幂等（重复调用不抛）；terminated_by 读写 |
| 集成（tests/integration） | **三点契约**：fixture manifest fieldPath ∈ proxy hit 空间 ∈ DOM data-mk-field 空间；policy→analyzer→CoverageReport 全链（hermetic SQLite）；goal-met 事件落 events.jsonl 断言（fake event-bus 流） |
| config | coverage 段 schema 校验（合法/非法/缺省） |

计数基线：275 → 预计 +60±20，全部通过；`corepack pnpm run demo:typecheck` 绿。

---

## 7. 决策摘要

| # | 决策 | 理由 |
|---|---|---|
| D1 | id 空间统一 normalizedPath（不引入 stableFieldId 映射） | 用户已确认；proxy/DOM 天然同空间，免 manifest 注入链路；§17 单源归一化已在 Phase 2 收敛 |
| D2 | policy 规则 v0 = config 全局 glob 三列表 | 用户已确认；plan §21.5 示例逐字对齐；端点限定/tag/annotation 后置 |
| D3 | anti-cheat v0 三类机检（hidden/空标记/白名单） | 用户已确认；全部复用已采数据零新探针；stringify/console.log 检测 Dashboard 前补 |
| D4 | glob 自实现（`*`/`**` 有限语义），零新依赖 | 规则面窄（路径段通配）；minimatch 全语义为过度引入 |
| D5 | terminatedBy 走 events.jsonl + runs 加列双通道 | 事件流是审计源（goal 事件现已存在只是未接 bus）；加列满足 Phase 4 查询；ensureColumn 幂等无 migrations |
| D6 | optional 未访问 state='notApplicable'（迁移自 D7 'optional-unhit'） | §21.3 枚举收口；coverage_fields 是表不是 API（无消费者锁定该字符串，集成测试同步改） |
| D7 | CoverageReport JSON 落 `.nx-mk/coverage-report.json`（覆盖写） | Phase 4 Dashboard 的数据契约起点；run 级产物与 coverage.db 分离（报告可删，账本不可） |
| D8 | demo goal 段 targetRatio 1.0 | demo 3 字段全命中即 goal-met，验收信号最清晰；真实项目自行调低 |

---

## 8. 风险与规避

| 风险 | 缓解 |
|---|---|
| normalizedPath 跨 endpoint 碰撞导致虚高覆盖 | v0 记录为已知限制（spec §3.1）；Phase 4 endpoint 消歧（trace 侧有 endpointId 可扩） |
| 白名单误伤（用户真有 `data.length` 字段） | `length` 限 Array target；名单导出可测可扩；误伤后果 = 少一条 hit（不破坏业务，探针纪律） |
| goal-met 提前终止导致采集不完整（漏字段） | 语义即如此（goal 达成即停）；coverage-report 照常产出；用户可调 targetRatio |
| runs 加列与 §25 plan DDL 漂移 | spec §3.1 明示 schema 演进记录；Phase 4 Dashboard 前统一校对 DDL |
| analyzer 重写破坏 Phase 2 集成测试 | 四态/13 列写法延续既有测试锁；迁移点 D6 单列一处 |
| textSample 引入隐私（值样本落库） | v0 只落 `空串/字段名` 判定所需最小信息（classify 只需布尔性判断）——落库文本截断 80 字符，§24 脱敏后置 |

---

## 9. 自检

- [x] 无 TBD/占位段
- [x] 与 Plan §16/§17/§21/§22/§28/§29 逐字对齐（D1-D3 引用对应节；§21.4 四源裁两源已声明）
- [x] Phase 2 遗留全数承接（id-space/terminatedBy/三点契约/goal 段 = §1.2.1/1.2.2/1.2.7）
- [x] 范围单一可承载单实施计划；非目标明确
- [x] 错误路径有归属（§4 表 7 行全覆盖）
