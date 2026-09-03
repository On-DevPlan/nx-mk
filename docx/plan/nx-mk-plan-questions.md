# mk 方案澄清问题（Brainstorming Q&A）

> 目的：在进入实现规划前，把方案中影响整体走向的关键决策点钉死。
> 工作方式：AI 在下面按主题列出问题 + 候选项 + 推荐；用户回答后，AI 把答案回填到对应位置，并补充新的追问（若有）。
> 当前状态：**所有决策已盖棺定论（2026-09-03 收口）**。下一步进入 spec 撰写阶段。

---

## A. 用户画像与价值主张

> 影响：决定 mk 是"个人开发者玩具"还是"团队工程基建"，进而决定功能优先级、UI 复杂度、CI 集成深度。

### A1. 目标用户是？

- [x] (a) 独立前端开发者 / 自由职业者，单兵使用
- [x] (b) 小型团队（≤10 人），共享一份 mk.config.yml
- [ ] (c) 中型团队（10–50 人），需要权限/隔离
- [ ] (d) 大型组织（≥50 人），需中央化 dashboard / 审计 / 合规

**AI 推荐**：(b)。MVP 应聚焦"小团队愿意每天用"，(c)(d) 是商业版/企业版的事。

**最终**：(a) + (b)。独立开发者最契合 + 小型团队（≤10 人）常见可行；后者需自行处理配置。

### A2. 主要使用场景是？

- [x] (a) 本地开发自检（`npx mk` 边开发边看 coverage）
- [ ] (b) PR review 辅助（reviewer 看 coverage diff）
- [ ] (c) CI 阻断门（coverage 不达标合不进 main）
- [ ] (d) 阶段性技术债盘点（季度/半年度）

**AI 推荐**：(a) + (c) 组合。MVP 主打本地体验，CI 作为硬性出口。

**最终**：(a) 本地开发自检为主。CI 决策见 E 段：暂不实施。

### A3. 用户对结果的容忍度？

- [x] (a) 0 容忍 - 任何 suspicious 都阻断
- [ ] (b) 默认宽松，按需开启严格
- [ ] (c) 只看覆盖率数字，不看可疑性

**最终**：默认严格（suspicious 阻断），可配置宽松（anti-cheat 全开 default；policy 严格模式为 default，宽松模式 opt-in）。

---

## B. 后端契约假设

> 影响：决定 manifest 的来源是"单一可信源"还是"运行时校验后修正"。

### B1. OpenAPI 文档的可信度假设？

- [ ] (a) 假设 OpenAPI 完整、准确，缺失即 mk 报错退出
- [ ] (b) 接受 OpenAPI 有缺失，运行时用真实响应补充 schema
- [ ] (c) 完全从运行时 HAR/抓包生成 manifest，不需要 OpenAPI
- [x] (d) OpenAPI 优先 + 运行时校验漂移

**AI 推荐**：(d)。Section 5 把"OpenAPI 驱动"放在定位，但 Section 43 又承认 "Swagger 不准" 是已知风险。需要在 spec 写清楚 fallback 路径。

**最终**：(d)。

### B2. 字段"实际类型" 与 OpenAPI schema 不一致时？

- [x] (a) 信任实际响应，覆盖 schema（推荐 - 但要写 diff 报告）
- [ ] (b) 标记为 suspicious，要求用户修复 schema
- [ ] (c) 静默忽略差异
- [ ] (d) 仅警告，不阻断

**最终**：(a)。

### B3. 是否支持 GraphQL / tRPC / 内部 RPC（非 REST）？

- [ ] (a) 不支持 - 只做 REST/OpenAPI
- [x] (b) 通过 plugin 扩展
- [ ] (c) MVP 不支持，但 spec 必须预留扩展点

**最终**：(b)。plugin 协议已稳定（M4 Capability seam 落地），GraphQL/tRPC 不进 MVP，可后置。

---

## C. 运行时侵入性（最关键的 UX 决策）

> 影响：决定"零摩擦接入"还是"项目级 SDK 改造"。直接决定 adoption 难度。

### C1. 接入 mk 需要改业务代码吗？

- [ ] (a) **零侵入** - 只配 mk.config.yml，mk 自动注入 proxy（可能用 Vite/webpack plugin 或 playwright route）
- [x] (b) **轻侵入** - 业务代码用 `api.user.getUser()` 风格的 SDK（替换 fetch 调用）  ← **SDK Facade 接入（X1-A）**
- [x] (c) **中侵入** - 还要加 `<Field field="...">` 包裹或 `data-mk-field` 属性  ← **UI Evidence 增强**
- [ ] (d) **重侵入** - 需要 codemod / loader / 构建配置改动

**AI 推荐**：分层（C1a 字段读取零侵入 / C1b UI evidence 中侵入）。

**最终（X1-A 决议，详见下方 ✅ 已解决冲突段）**：
- 接入路径 = 用户装 `@mk/client`，业务代码改用 SDK Facade（`api.user.getUser()`）
- 业务代码不感知模式（生产 vs analysis），由 SDK 根据模式自动切换内部行为
- "零侵入"在此语境 = **业务代码无 if/else 分支**，**不是"不改代码"**
- UI Evidence 仍需 `<Field>` 或 `data-mk-field` 显式标记

### C2. 生产 bundle 是否会带 mk 运行时？

- [x] (a) 完全剥离 - 生产打包 0 字节 mk  ← tracker 类 0 字节；SDK 薄壳 1-3KB 可接受（不含分析逻辑）
- [ ] (b) 运行时条件 import - 生产仅保留 noop fallback
- [ ] (c) 接受小体积残留（<5KB）

**AI 推荐**：(a)。生产污染是已知风险（Section 43 列出）。

**最终**：(a)。实现策略：分析期构建注入 + 条件虚拟模块 + tree-shaking alias（详见下方 C2 实现策略）。

### C3. 框架支持范围？

- [x] (a) React only  ← MVP：React + Vite 先打穿闭环
- [ ] (b) React + Vue
- [ ] (c) React + Vue + Svelte
- [ ] (d) 任意 SPA（含原生 JS）

**最终**：(a)。后续扩展：Phase 2 Next Client → Phase 3 Vue → Phase 4 任意 SPA。




c类问题回复：

我的建议答案如下：

> ⚠️ **历史保留段（已 superseded）**：下方是 AI 早期对 C1/C2/C3 的"分层"提案（默认零侵入 + UI evidence 中侵入）。该提案后被 **C-X1 → X1-A 决议**替代（业务代码用 SDK Facade，"零侵入"= 无 if/else 分支而非"不改代码"）。保留这段仅为决策溯源，**最终决策以 🚨 → ✅ 已解决冲突 段为准**。

## C. 运行时侵入性决策（历史提案，superseded by X1-A）

### C1. 接入 mk 需要改业务代码吗？

**推荐选择：分层，但产品默认口径选 (a) 零侵入，能力分级实现。**

具体分成三档：

- **基础字段返回/请求追踪：零侵入**
  - 用户只配置 `mk.config.yml`
  - mk 通过 Vite/Webpack plugin、Playwright route、fetch/XHR patch、响应 JSON proxy 注入完成
  - 不要求业务代码改成 `api.user.getUser()`
  - 可以拿到：
    - 请求列表
    - 响应字段树
    - 字段值状态
    - ignored returned fields
    - endpoint coverage
    - raw backend field coverage
- **字段读取追踪：尽量零侵入，允许轻度不完美**
  - 通过分析构建时注入 proxy
  - 对常见 `fetch().json()` / `axios` response 做代理增强
  - 不要求统一 SDK
  - 但需要接受某些复杂封装场景可能无法 100% 捕获
- **UI Evidence：推荐中侵入**
  - 必须使用 `<Field field="...">` 或 `data-mk-field`
  - 因为 mk 无法可靠判断：
    - 字段是否真的渲染给用户
    - 字段是业务展示还是日志/调试
    - 字段是否被隐藏
    - JSX 表达式和 API 字段的语义映射
  - 后续可以提供 codemod / Babel/SWC 自动注入来降低成本

所以最终选择可以写成：

```markdown
- [x] (a) 零侵入：作为默认接入方式，覆盖请求捕获、响应字段分析、Coverage Policy、Replay、基础报告
- [x] (c) 中侵入：作为增强接入方式，用于获取高置信度 UI Evidence
```

不建议把主路径设计成：

```markdown
- [ ] (b) 必须替换为 api.user.getUser()
```

原因是这会显著提高 adoption 难度。可以保留 `@mk/runtime` / `@mk/client` 作为可选增强，但不能作为接入前提。

也不建议默认选择：

```markdown
- [ ] (d) 重侵入
```

codemod / loader / 构建改动应该是可选增强，不是第一步必须做。

---

### C1 结论

我的最终建议：

> **默认零侵入接入，增强 UI Evidence 时允许中侵入。**

也就是：

```
mk.config.yml only
  -> 可获得请求级、响应字段级、Policy、Replay、基础覆盖率

<Field> / data-mk-field
  -> 可获得可信 UI Evidence、字段展示覆盖率、Agent 精准修复
```

针对你问的：

> 能不能接受“必须用 `<Field>` 才能拿到 UI evidence”？

我的回答是：

**可以接受，而且应该明确这样设计。**

但产品表达上不要说“必须改代码才能用 mk”，而应该说：

```
mk 默认零侵入可用；
如果你需要高置信度 UI Evidence，请使用 <Field> 或 data-mk-field 标记。
```

这样 UX 更好。

---

## C2. 生产 bundle 是否会带 mk 运行时？

**推荐选择：(a) 完全剥离。**

```markdown
- [x] (a) 完全剥离 - 生产打包 0 字节 mk
- [ ] (b) 运行时条件 import - 生产仅保留 noop fallback
- [ ] (c) 接受小体积残留（<5KB）
```

理由：

1. mk 是分析工具，不应该污染生产 bundle。
2. 生产残留会引发用户对性能、安全、合规的担忧。
3. 你的系统会处理响应字段、请求、脱敏、trace、coverage，这些概念不能出现在生产包里。
4. “0 字节生产污染”会成为很强的产品卖点。

---

### C2 实现策略

建议使用三层保证：

#### 1. 分析专用构建注入

通过 Vite/Webpack plugin 只在 mk analysis run 时注入：

```tsx
define: {
  __MK_ANALYSIS__: "true"
}
```

生产构建中：

```tsx
__MK_ANALYSIS__ = false
```

---

#### 2. 条件虚拟模块

业务或注入代码引用：

```tsx
import { Field } from "virtual:mk/runtime"
```

分析模式解析到：

```tsx
@mk/runtime/analysis
```

生产模式解析到：

```tsx
empty module
```

如果做到完全剥离，生产甚至不应该解析到 `noop`，而是由 plugin 在生产构建不注入任何引用。

---

#### 3. Tree-shaking + alias

分析模式：

```tsx
resolve.alias = {
  "@mk/runtime": "@mk/runtime/analysis"
}
```

生产模式：

```tsx
resolve.alias = {
  "@mk/runtime": "@mk/runtime/empty"
}
```

但最优是：

```
用户生产构建完全不安装/不启用 mk plugin
```

也就是 mk 只在：

```bash
npx mk
```

启动的临时分析构建里注入。

---

### C2 结论

最终写法：

> mk 的生产目标是 **0 字节残留**。所有 proxy、collector、Field wrapper、DOM marker、SSE bridge、trace 逻辑只存在于 `npx mk` 启动的 analysis session 中，不进入用户正常 production build。

---

## C3. 框架支持范围？

**MVP 推荐选择：(a) React only。**

```markdown
- [x] (a) React only
- [ ] (b) React + Vue
- [ ] (c) React + Vue + Svelte
- [ ] (d) 任意 SPA（含原生 JS）
```

理由：

1. 你的系统复杂度已经很高：
   - OpenAPI Manifest
   - Runtime Proxy
   - Request Trace
   - Coverage Policy
   - Dashboard
   - Replay
   - Agent Loop
2. UI Evidence 和 Agent 修复都强依赖框架语义。
3. React 生态最适合先做：
   - Vite React 项目多
   - JSX AST 相对成熟
   - Agent 修改组件更容易
   - `<Field>` wrapper 好实现
   - Playwright 验证链路简单
4. 如果一开始支持 Vue/Svelte，会拖慢核心闭环。

---

### C3 分阶段规划

#### Phase 1：React + Vite

```
目标：跑通完整闭环
支持：
- React
- Vite
- fetch
- axios
- JSON response
- Field wrapper
- data-mk-field
```

#### Phase 2：React + Next CSR 部分

```
支持：
- Next.js client component
- client-side fetch
- 页面级 UI evidence
暂不完整支持：
- RSC
- SSR server-side field access
```

#### Phase 3：Vue

```
支持：
- Vue 3
- Vite
- <MkField field="...">
- data-mk-field
```

#### Phase 4：任意 SPA

```
支持：
- fetch/XHR/axios request trace
- response field tree
- policy
- replay
但 UI evidence 降级为 data-mk-field 手动标记
```

---

### C3 结论

最终选择：

> **MVP 只做 React + Vite，先打穿完整闭环。后续扩展 Vue，再扩展任意 SPA 的请求级分析。**

---

## 最终决策汇总（历史草案，superseded by X1-A）

```markdown
## C. 运行时侵入性

### C1. 接入 mk 需要改业务代码吗？

- [x] (a) 零侵入 - 默认接入方式
- [ ] (b) 轻侵入 - 不作为必需，仅作为可选 SDK 增强
- [x] (c) 中侵入 - 仅用于高置信度 UI Evidence
- [ ] (d) 重侵入 - 不作为默认路径

决策：
mk 默认零侵入可用；只配置 mk.config.yml 即可获得请求级、响应字段级、Policy、Replay、基础覆盖率。
如果需要可信 UI Evidence，则需要使用 `<Field field="...">` 或 `data-mk-field`。

### C2. 生产 bundle 是否会带 mk 运行时？

- [x] (a) 完全剥离 - 生产打包 0 字节 mk
- [ ] (b) 运行时条件 import - 生产仅保留 noop fallback
- [ ] (c) 接受小体积残留（<5KB）

决策：
mk 所有运行时逻辑只存在于 analysis session，不进入用户生产构建。

### C3. 框架支持范围？

- [x] (a) React only
- [ ] (b) React + Vue
- [ ] (c) React + Vue + Svelte
- [ ] (d) 任意 SPA（含原生 JS）

决策：
MVP 支持 React + Vite；后续扩展 Next Client、Vue，再扩展任意 SPA 的请求级分析。
```

> ⚠️ 上方汇总中的 C1 决策（C1a + C1c = 默认零侵入 + UI evidence 中侵入）已被 **C-X1 → X1-A** 替代（业务代码改用 SDK Facade）。C2/C3 维持不变。**最终请参考下方 🚨 → ✅ 已解决冲突 段 + 已确认决策表格**。

---

## 我建议你在完整方案中改成这句话（历史文案，已不准确）

> mk 采用“默认零侵入、证据增强可选侵入”的接入策略。用户只需配置 `mk.config.yml` 即可获得请求捕获、响应字段分析、Coverage Policy、Request Trace 和 Replay；若需要高置信度 UI Evidence，则通过 `<Field field="...">` 或 `data-mk-field` 显式标记。所有 mk runtime 只在 `npx mk` 启动的 analysis session 中注入，生产构建 0 字节残留。MVP 仅支持 React + Vite，优先打穿完整闭环。

---

## D. Agent 边界

> 影响：决定 MVP 是"真的能改代码"还是"只能给建议"。直接影响 review 复杂度。

### D1. MVP Agent 的具体能力？

- [x] (a) 只能产出 patch 文本 / diff，用户手动 apply  ← MVP 推荐
- [ ] (b) 能写入文件，需用户 commit
- [ ] (c) 能 apply + 自动 commit（不允许直接 push）
- [ ] (d) 全自动 apply + commit + push + 开 PR

**AI 推荐**：(a) 做 MVP，(b)/(c) 作为 Phase 5+ 后置能力。(d) 永远不会是默认。

**最终**：(a)。MVP 不实现 workspace-write、git auto-commit；agent 输出直接展示在 dashboard。

### D2. Agent 必须支持哪些 provider？

- [x] (a) Claude Code SDK only
- [ ] (b) Claude Code SDK + HTTP adapter（接任意 LLM）
- [ ] (c) Claude Code SDK + HTTP + Command adapter（接本地脚本）
- [ ] (d) 全部上述 + OpenAI 原生 SDK

**最终**：(a)。简化 provider，agent-sdk 接口更简洁。

### D3. Agent 是否能修改 Coverage Policy / mk.config.yml？

- [ ] (a) 不能 - policy 永远由用户决定
- [ ] (b) 只能给建议（policy-agent 默认模式）
- [x] (c) 可以，但需明确审计  ← 需明确 diff

**最终**：(c)。policy-agent 必须输出 diff，可被 review/reject。

---

## E. CI 与工程化

### E1. `npx mk ci` 跑在哪？

- [ ] (a) GitHub Actions / GitLab CI 提供的 Linux runner
- [ ] (b) 用户自建 runner（有完整 Chromium）
- [ ] (c) Docker 镜像内置 Chromium
- [ ] (d) 默认接受 Chromium 由 mk 自动下载

### E2. CI 模式下 Dashboard 行为？

- [ ] (a) 不启动 dashboard
- [ ] (b) 启动但不开浏览器，仅监听本地端口
- [ ] (c) 上传报告到中央服务（需要 SaaS）

**最终**：E1/E2 **暂不实施**——MVP 不实现 `npx mk ci`，roadmap 删除 Phase 5 后的 CI 优先级。

---

## F. 性能与首次体验

### F1. 首次 `npx mk`（冷启动 + 装包 + 检测 + 生成 manifest + 启动 dashboard + 启动 app + 跑 scenario + 出报告）期望耗时？

- [ ] (a) ≤30 秒 - 用户愿意等待
- [ ] (b) ≤2 分钟 - 用户会去倒咖啡
- [ ] (c) ≤5 分钟 - 用户去开会
- [ ] (d) 没有上限

启动可以快点，显示各项指标进度条
d

### F2. Watch 模式增量更新粒度？

- [ ] (a) OpenAPI 变 → 全量重跑 scenario
- [ ] (b) OpenAPI 变 → 只重跑 manifest + affected scenarios
- [ ] (c) 文件级 diff，仅重跑变化文件涉及的 endpoint

你构思一下，我认为 b较为合适

### F3. Scenario 并发度？

- [ ] (a) 串行 - 简单但慢
- [x] (b) 并发 N 个（可配置，默认 3，最大 10）  ← 每个 scenario 独立 browser context 避免状态污染
- [ ] (c) 智能调度（按 endpoint 依赖图）

**AI 推荐**：(b)。3 个 context ≈ 30s vs 串行 90s。配置项 `scenarios.concurrency`，默认 3。

**最终**：(b)。

---

## G. 数据生命周期

### G1. `.mk/runs/` 保留策略？

- [x] (a) 保留最近 N 次（默认 10）  ← 可用户配置
- [ ] (b) 保留总大小上限（默认 1GB）
- [ ] (c) 永不自动清理
- [ ] (d) 用户自定义

**最终**：(a)。配置项 `runtime.retainRuns`。

### G2. 单次 run SQLite 大小预估？

> 用于估算磁盘占用。100 endpoints × 100 fields × 50 requests ≈ 50k 行。粗算 5-20 MB/run。

- [x] (a) 接受 10-50 MB/run
- [ ] (b) 必须 < 10 MB/run
- [ ] (c) 无所谓

**最终**：(a)。无存储压缩需求，SQLite 直存。

### G3. Dashboard 历史 run 浏览？

- [ ] (a) 默认显示全部历史 run
- [ ] (b) 默认只显示最新 run
- [x] (c) 按需切换（配置项 `dashboard.defaultView: latest | history`，默认 latest）

**AI 推荐**：(c)。开发者使用频率 ≈ 90% 查最新 run / 10% 回看历史；默认 latest + 配置可改最优。

**最终**：(c)。

---

## H. 商业模式与分发

### H1. CLI license？

- [x] (a) MIT - 纯开源
- [ ] (b) Apache 2.0 - 带专利授权
- [ ] (c) 商业 license - 闭源
- [ ] (d) 双 license（开源 + 商业）

**最终**：(a)。全商用。

### H2. 是否计划 SaaS（中心化 dashboard / 数据聚合）？

- [x] (a) 永远本地化  ← MVP 暂时本地化
- [ ] (b) 提供可选 SaaS（团队版）
- [ ] (c) 完全 SaaS 化

**最终**：(a)。dashboard 不上传数据，所有产物本地。

---

## I. 多框架与扩展性（可后置）

### I1. Plugin 协议是否锁定？

- [ ] (a) 锁定 v1，强约束
- [ ] (b) 渐进演进，semver 严格
- [x] (c) 不承诺，向后兼容按尽力而为  ← 后置决策

**最终**：(c)。plugin 协议 v1 可快速演进，不需 semver 严格承诺。

### I2. 是否暴露内部协议（如 OpenAPI manifest 格式、coverage report schema）？

- [ ] (a) 完全私有
- [ ] (b) 公开 schema spec，方便第三方工具互操作
- [x] (c) 部分公开（coverage report 公开，manifest 私有）  ← 后置决策

**最终**：(c)。MVP 不讨论实现细节，先把 core 跑通。

---

## J. 隐私与合规

### J1. 默认隐私策略？

- [x] (a) 默认 masked（推荐）  ← 邮箱/电话/token 自动脱敏；raw 模式需显式开启
- [ ] (b) 默认 raw（开发友好）
- [ ] (c) 默认 none（不存响应值）

**AI 推荐**：(a)。git history 一旦 push 就收不回，默认 masked 最稳。

**最终**：(a)。配置项 `privacy.responseValues.mode: masked | raw | none`。

### J2. 是否需要审计日志（谁在何时跑了 mk）？

- [x] (a) 不需要  ← 本地单人项目，无审计
- [ ] (b) 需要（写本地）
- [ ] (c) 需要（写远程）

**最终**：(a)。团队版后置时再补。

### J3. 响应值 raw 模式的访问控制？

- [x] (a) 任何人都能切  ← 但 dashboard 切到 raw 时显示红色 banner 警告
- [ ] (b) 需要显式开启 + 警告
- [ ] (c) 需要密码 / 二次确认

**最终**：(a)。

---

## K. Demo App 与验证

> 影响：决定 MVP 怎么自验证。没有 demo app，所有"覆盖率"指标都是空话。

### K1. `examples/react-vite-demo` 必须演示哪些场景？

- [ ] (a) 至少 3 个页面 × 5 个 endpoint × 20 个字段
- [ ] (b) 必须覆盖 required / optional / ignored 三类字段
- [ ] (c) 必须包含 missing required 和 suspicious coverage 示例
- [ ] (d) 必须包含至少 1 个 DSL scenario + 1 个 GET replay 成功案例

**AI 推荐**：(b) + (c) + (d)。

**最终**：(b) + (c) + (d)。


### K2. 是否需要 mock 后端？

- [ ] (a) 需要 - demo 内置 mock server
- [x] (b) 不需要 - 依赖真实后端  ← demo 自带真实后端（见 K-X1）
- [ ] (c) 两者皆可，mk 自动识别

**最终**：(b)。

### K-X1：demo app 后端用什么实现？

- [ ] (a) **Express** —— 最常见，教程多
- [ ] (b) **Fastify** —— 与 mk dashboard-server 同栈
- [x] (c) **Hono**  ← TypeScript-native、<50KB、zod-openapi 自动导出 swagger.json 给 mk
- [ ] (d) **JSON Server** —— 零代码 REST mock

**AI 推荐**：(c)。TypeScript-native，与 dashboard-server 风格统一，OpenAPI 自动导出。

**最终**：(c) Hono。

---

## 已确认决策（结构化归档）

> 主题按 A→K 顺序。每项记录：**答案**、**理由摘要**、**对 spec 的下游影响**。

### A. 用户画像与价值主张

- **A1**：(a)+(b)。独立开发者最契合 + 小型团队（≤10 人）常见可行；后者需自行处理配置。
  - 影响：UI 简洁化、配置本地化、dashboard 不强调团队协作（无 shared workspace）
- **A2**：以本地开发自检为主（不主打 CI）。
  - 影响：CI 模式可降级为可选项（与 E 决策一致）
- **A3**：默认严格（suspicious 阻断），可配置宽松。
  - 影响：anti-cheat 默认全开，policy 严格模式为 default，宽松模式 opt-in

### B. 后端契约假设

- **B1**：**(d) OpenAPI 优先 + 运行时校验漂移**。
  - 影响：manifest 接受运行时响应覆盖 OpenAPI schema，需写 diff 报告（输出位置待定）
- **B2**：**(a) 信任实际响应，覆盖 schema**。
  - 影响：schema override 写入 resolved manifest（用于本次 run + 写回？待定）
- **B3**：**(b) 通过 plugin 扩展**。
  - 影响：plugin 协议必须稳定，GraphQL/tRPC 不进 MVP

### C. 运行时侵入性（已细化 + 修订定义）

- **C1**：**SDK Facade 接入** —— 业务代码改用 `api.user.getUser()`，由 SDK 根据模式自动切换。
  - 影响：用户需手动装 `@mk/client` 包 + 修改 import；不算"零代码改动"，但"零模式分支"
  - 与"零侵入"的语义校准：零侵入 = 业务代码无 if/else 分支，不是"不改代码"
- **C2**：**(a) tracker 完全剥离**。生产 build 中 tracker 类代码 0 字节；SDK 薄壳（~1-3KB）允许存在。
  - 影响：alpha=tracker 0 字节；SDK 是接入契约，不算"残留"
- **C3**：**(a) React + Vite only**（MVP）。后续 Next Client → Vue → 任意 SPA。

### D. Agent 边界

- **D1**：**(a) 只产出 patch 文本 / diff，用户手动 apply**。
  - 影响：MVP 不实现 workspace-write、git auto-commit 等能力；agent 输出直接展示在 dashboard
  - 后续可加：(b) 写入文件、(c) 自动 commit，作为 Phase 5+ 能力
- **D2**：**(a) Claude Code SDK only**。
  - 影响：不需要 HTTP/Command adapter，agent-sdk 接口更简洁
- **D3**：**(c) 可以修改 Coverage Policy，但需明确 diff**。
  - 影响：policy-agent 必须输出 diff，可被 review/reject

### E. CI 与工程化

- **E1/E2**：**CI 插件暂不实施**。
  - 影响：MVP 不实现 `npx mk ci`，roadmap 中删除 Phase 5 后的 CI 优先级

### F. 性能与首次体验

- **F1**：**(d) 没有硬上限，启动要快，进度可见**。
  - 影响：进度条 + Live Metrics 必要（方案已有，无需改动）
- **F2**：**(b) OpenAPI 变 → 只重跑 manifest + affected scenarios**。
  - 影响：watch 模式需做 endpoint → scenario 依赖图
- **F3**：**(b) 并发 3 个独立 browser context，默认 N=3，可配（最大 10）**。
  - 影响：spec 必须定义 `scenarios.concurrency` 配置项；每个 scenario 用 `browser.newContext()` 隔离

### G. 数据生命周期

- **G1**：**(a) 保留最近 N 次（默认 10）+ 用户可配置**。
  - 影响：mk.config.yml 增加 `runtime.retainRuns` 字段
- **G2**：**(a) 接受 10-50 MB/run**。
  - 影响：无存储压缩需求，SQLite 直存
- **G3**：**(c) 默认显示最新 run，按需切历史**。
  - 影响：配置项 `dashboard.defaultView: latest | history`，默认 latest

### H. 商业模式与分发

- **H1**：**(a) MIT**。
  - 影响：所有包可商用，第三方 plugin 协议无需特别考虑 license
- **H2**：**暂时本地化**。
  - 影响：dashboard 不上传数据，所有产物本地

### I. 多框架与扩展性（后置）

- **I1/I2**：**后置**，MVP 不讨论。
  - 影响：plugin 协议 v1 可快速演进，不需 semver 严格承诺

### K. Demo App 与验证

- **K1**：(b)+(c)+(d)。demo 必须覆盖 required/optional/ignored + 含 missing required + 至少 1 DSL + 1 GET replay。
  - 影响：demo app 必须有真实的后端 + 真实的前端页面 + 至少一个可复现场景
- **K2**：**(b) mk 自身不需要内置 mock server，依赖真实后端**。
- **K-X1**：**(c) Hono** —— TypeScript-native、<50KB、zod-openapi 自动导出 swagger.json 给 mk。
  - 影响：与 mk dashboard-server 风格统一；demo 全栈 TS；OpenAPI 自动产出
  - 候选被排除：(a) Express 不同栈 + 不 TS-native；(b) Fastify 同栈但生态重；(d) JSON Server 不能产 OpenAPI

### J. 隐私与合规

- **J1**：**(a) 默认 masked**。邮箱/电话/token 自动脱敏；raw 模式需用户显式切换。
- **J2**：**(a) 不需要审计日志**（本地单人项目）。
- **J3**：**(a) 任何人都能切 raw 模式**，但 dashboard 切换时显示**红色 banner 警告**提醒"响应值将以明文存储"。

---

## SDK 落地路径决策（spec 必须包含）

### SDK-CG1. SDK 代码如何生成？
- **决策**：**(b) mk 在 session 启动时基于 OpenAPI 临时生成 SDK 文件**。
  - 路径：用户 OpenAPI → mk 解析 → 生成 `node_modules/@mk/client/{endpoint}.ts` → 用户 `import { api } from '@mk/client'`
  - 影响：runtime 包 (`@mk/client`) 只包含通用 fetch wrapper + manifest 加载逻辑；endpoint 实现是动态生成

### SDK-CG2. OpenAPI Manifest → API Client 的代码生成路径是？
- **决策**：**(b) 编译期 codegen**（session 启动时执行一次，生成可被 IDE 静态分析的 .ts 文件）。
  - 路径：OpenAPI → AST 转换 → typed API client（带方法签名、参数类型、返回值类型）
  - 影响：用户获得完整 TypeScript 类型提示；IDE 自动补全可用

### SDK-CG3. 用户已有 axios/原生 fetch 项目如何迁移？
- **决策**：**(b)+(c) codemod 自动迁移 + fetch monkey-patch fallback**。
  - (b)：mk 提供 codemod 工具（`npx mk migrate`），扫描项目里的 `fetch('/api/...')` 替换为 `api.xxx.xxx()`
  - (c)：对于无法立即迁移的代码，mk 也提供 fetch monkey-patch（拦截 fetch 调用），保证 coverage 不丢失
  - 影响：spec 必须定义 codemod 工具的命令、扫描规则、转换规则

---

## 完整决策清单（最终版）

| 编号 | 决策 | 关键影响 |
|---|---|---|
| A1 | (a)+(b) 个人+小团队 | UI 简洁、本地化 |
| A2 | 本地开发自检为主 | 不主打 CI |
| A3 | 默认严格 | anti-cheat 默认开 |
| B1 | OpenAPI + 运行时校验漂移 | manifest 接受响应覆盖 schema |
| B2 | 信任实际响应 | 覆盖 + diff 报告 |
| B3 | plugin 扩展 | GraphQL/tRPC 后置 |
| C1 | 分层（默认零侵入 + UI evidence 中侵入） | SDK Facade 是关键 |
| C2 | 完全剥离（tracker 0 字节） | SDK 薄壳 ~1-3KB 可接受 |
| C3 | React + Vite only | MVP 闭环 |
| D1 | (a) 只产 diff | MVP 不写文件 |
| D2 | Claude Code SDK only | 简化 provider |
| D3 | 可改 policy 但需 diff | policy-agent 输出 diff |
| E | CI 暂不实施 | 删除 ci 子项目 |
| F1 | 无硬上限，进度可见 | Live Metrics |
| F2 | OpenAPI 变 → 重跑 manifest + affected | 依赖图 |
| F3 | 并发 3 browser context | scenarios.concurrency |
| G1 | 保留 N=10，可配 | runtime.retainRuns |
| G2 | 10-50 MB/run | 直存 |
| G3 | 默认 latest，可配 | dashboard.defaultView |
| H1 | MIT | 全商用 |
| H2 | 本地化 | dashboard 不上传 |
| I | 后置 | plugin 协议可演进 |
| J1 | 默认 masked | privacy.responseValues.mode |
| J2 | 无审计 | 单人项目 |
| J3 | 任何人都能切 + 红色 banner | dashboard UX |
| K1 | (b)+(c)+(d) | demo 验证集 |
| K2 | mk 不带 mock | demo 自带后端 |
| K-X1 | (c) Hono | zod-openapi 自动导出 swagger.json |
| C-X1 | **X1-A + α** | SDK Facade + tracker 0 字节 |
| SDK-CG1 | session 生成 SDK | 动态生成 endpoint |
| SDK-CG2 | 编译期 codegen | 静态类型 |
| SDK-CG3 | codemod + fetch monkey-patch | 迁移路径 |

---

## 方案修订清单（mk-plan.md 需要更新的部分）

> 基于以上决策，原始方案有几处需要修订：

| 方案原文 | 修订建议 | 原因 |
|---|---|---|
| §18.1（模式解耦） | ✅ 保留 | 与 C-X1 决策一致 |
| §18.2（Strategy + Middleware） | ✅ 保留 | SDK 内部实现细节 |
| §19（字段级 Proxy） | ⚠️ **改写为 "SDK Facade 内部 Proxy"** | Proxy 不再是用户配置层，是 SDK 内部行为 |
| §20（UI Evidence） | ⚠️ **明确 `<Field>` 与 data-mk-field 的边界** | UI evidence 唯一可靠来源是显式标记 |
| §41（MVP 范围） | ⚠️ **补充 SDK 路径描述** | MVP 必须能跑通 SDK Facade 完整链路 |
| §42（Roadmap） | ⚠️ **删除 CI 相关 Phase** | E 决策：CI 暂不实施 |
| §42（Roadmap） | ⚠️ **新增 SDK Codegen 作为 Phase 1.5** | SDK-CG1/CG2 落地 |
| §43（风险表） | ⚠️ **新增"SDK adoption 阻力"风险** | 用户需手动装包 + 改 import |
| §5（产品形态） | ⚠️ **明确 "SDK Facade" 作为接入模式** | Section 5.3 Runtime 当前描述模糊 |

---

## 待补充追问

> 回答上述问题后，AI 根据答案衍生的新追问会追加到这里。

### ✅ 已全部清空（2026-09-03 收口）

所有 Q&A（A→K + X1-X 衍生的 D-X1 / F3 / G3 / J1 / K-X1）已落定，无未答问题。

---

## 下一步

所有决策已收口。下一步进入 spec 撰写阶段（per brainstorming 流程）。需用户确认 spec 范围。

---

## 🚨 → ✅ 已解决冲突（C-X1 → X1-A）

### ✅ 已解决：C-X1

**冲突原始描述**：

- C1 选了"默认零侵入"——业务代码不改
- C2 选了"生产 0 字节"——mk runtime 不进入 prod build
- 但方案 Section 19（字段级 Proxy）依赖构建期注入

**用户澄清（最新）**：

> "零侵入"在 mk 语境下的含义是**业务代码不感知模式**，**SDK Facade 是接入方式本身**。
> 业务代码始终调用 `api.user.getUser(id)`，由 SDK 根据模式自动切换内部行为。

**最终决定**：

| 维度 | 决策 |
|---|---|
| **集成路径** | **X1-A**：用户安装 `@mk/client`，业务代码改用 SDK Facade |
| **生产 bundle** | SDK 薄壳保留 ~1-3KB（纯 fetch 包装），tracker 类代码 0 字节 |
| **field-access 追踪** | ✅ 可获得（SDK 在 analysis 模式下自动启用） |
| **UI Evidence** | 仍需 `<Field>` 或 `data-mk-field` 显式标记 |

#### 接入示例

```ts
// package.json
{
  "dependencies": {
    "@mk/client": "^0.1.0"  // 用户手动安装
  }
}

// 业务代码
import { api } from '@mk/client'
const user = await api.user.getUser(id)

// production: api.user.getUser -> fetch -> data
// analysis:   api.user.getUser -> fetch -> bind manifest -> tracked proxy -> collector -> data
```

#### 对方案原文的修订建议

- Section 18.1（模式解耦）✅ **保持原样**——这本来就是 SDK Facade 模式
- Section 18.2（Strategy + Middleware）✅ **保持原样**——middleware 链在 SDK 内部组装
- Section 19（字段级 Proxy）⚠️ **需要明确**：Proxy 现在是 SDK 内部行为，不是用户配置
- Section 41（MVP）✅ **保持原样**——MVP 已限定 React + Vite，SDK 可自然落地

#### 后续 spec 必须澄清

1. SDK Facade 代码生成方式（已在 SDK-CG1 落地：session 启动时临时生成）
2. OpenAPI Manifest → API Client 的代码生成路径（已在 SDK-CG2 落地：编译期 codegen）
3. 用户已有 axios/原生 fetch 项目如何迁移（已在 SDK-CG3 落地：codemod + fetch monkey-patch）

---

## 收口说明（2026-09-03）

> 本 doc 历经多轮 Q&A，2026-09-03 完成最终收口。所有 A-K 决策 + X1-X 衍生项 + SDK 路径决策已固化进 markdown。

**结构**：
- A→K 章节保留原始 Q&A 格式 + `[x]` 标记 + 最终决策行（便于回溯）
- 124→453 行 = 早期"分层 (a)+(c)" 提案（**superseded by X1-A**，仅作溯源保留）
- "已确认决策" 段化化归档（按主题），便于 spec 撰写时引用
- "完整决策清单" 表格 = 一页纸摘要
- C-X1 冲突 + SDK 路径决策单独成段
- "方案修订清单" 列出 mk-plan.md 需更新的章节

**下一步**：
1. 把"方案修订清单"中的 5 项修订落到 `docx/plan/nx-mk-plan.md`
2. 进入 spec 撰写：Phase 1.5 SDK Codegen → Phase 2 SDK Facade + Field Proxy
3. 起 `examples/react-vite-demo` + Hono 后端，验证 SDK 闭环

---
