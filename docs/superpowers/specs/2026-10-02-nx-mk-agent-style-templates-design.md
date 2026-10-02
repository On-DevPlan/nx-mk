# nx-mk Spec: Agent Style Templates（api-ui-agent 风格模板插件 —— 可配置模板风格 + 选择）

> 日期：2026-10-02
> 范围：为 api-ui-agent 生成的交付前端引入「风格模板」体系——内置模板集 + 自定义 markdown 入口，config 选择，prompt 注入 + review guard className 白名单校验
> 不在范围：CSS 资产注入（模板携带真实样式文件）、workspace-write、dashboard 写面（settings 只读展示后续另立项）、provider 变更、kernel plugin-registry 扩展、非 claude-code provider
> 关联文档：
> - `docs/superpowers/specs/2026-09-18-nx-mk-phase5-agent-design.md`（agent loop / review guard G1-G4 / suggest-diff 铁律 D1 —— 本 spec 直接叠加其上）
> - `docx/plan/nx-mk-plan.md`（§35 内置插件、§44.4 不直接追求 100%、§3.5 prompt 组装）
> - 主 plan 编号（C 系列章节）在本 spec 并入 plan 文档时分配；文中以本 spec 章节号自引用

---

## 1. 目标与范围

### 1.1 一句话

用户在 `nx-mk.config.yml` 的 `agent.style` 段选择一个风格模板（内置 id 或自定义 markdown 路径），api-ui-agent 产 diff 时 prompt 携带该模板的风格规范，review guard 新增 G5 规则按模板的 className 白名单校验 patch——使 agent 生成前端的视觉风格从「LLM 自觉」变为「配置确定」。

### 1.2 背景（问题陈述）

当前 api-ui-agent 的 `buildPrompt`（`packages/agent/src/agents/api-ui.ts:31`）只含覆盖硬约束 + 字段上下文，无任何风格指令；前端 patch 的 JSX 结构与 className 全凭 LLM 发挥，与宿主应用风格的一致性无机制保证。本 spec 把风格从隐式变显式：**模板即 markdown 文档，选择即 config 一行，违规即 guard 拒绝**。

### 1.3 三项已拍板决策（brainstorm 2026-10-01）

| # | 决策 | 备选与否决理由 |
|---|---|---|
| S1 | 模板来源：**内置模板集 + 自定义 path 入口** | 否决「仅内置」（不可扩展）与「完全插件化」（kernel 加 UI 模板类型模糊零依赖地基职责，v1 过重） |
| S2 | 模板内容：**Prompt 规范（markdown 三段式）+ guard 规则（className 白名单）** | 否决「CSS 资产注入」（provider 只读三件套 D1，patch 复杂度失控）与「仅自动探测」（不可预期，无选择面） |
| S3 | 选择面：**仅 config 配置**（dashboard 只读展示留待后续） | 否决 dashboard 写面（绕过 config 与覆盖报告机制脱节）；否决双面（源头唯一性原则） |

### 1.4 目标清单（6 条）

1. **`packages/agent/src/style/`**：`StyleTemplate` 类型 + markdown loader（frontmatter 解析 + 校验）+ 5 个内置模板
2. **config `agent.style` 段**：`AgentStyleConfigSchema = { id?, path?, overrides? }`，三处接线（config schema / cli / agent runtime）
3. **prompt 注入**：`buildPrompt` 增加 `style` 参数，模板 description + rules 渲染进硬约束之前的独立段
4. **review guard G5（className 白名单）**：解析 patch 新增行的 class/className token，按模板白名单（支持通配符）或宿主 CSS 扫描放行；违规 → patch 落 `rejected/` + verdict reject
5. **启动期错误路径**：未知 id / 文件缺失 / frontmatter 缺字段均给出可操作错误信息（含内置模板清单）
6. **注入式可测**：loader 与 G5 均纯函数；`buildPrompt` 风格段可断言；全部测试不触真 claude（对齐 Phase 5 注入纪律）

### 1.5 非目标

- 模板携带 CSS 令牌/骨架文件并写入宿主（S2 否决；provider 只读权限不变）
- dashboard settings 页风格选择器 / PATCH 写面（C12 三段路由不动；只读展示属后续小项）
- api-client-agent / dsl-agent / policy-agent 的风格化（它们不产 UI，无风格语义）
- 多模板混排 / 页面级模板路由（v1 单 run 单模板）
- 模板市场 / 远程模板下载（path 仅限本地相对路径）
- 热更新（config 变更需重跑 `nx-mk loop`，与既有 config 语义一致）

---

## 2. 设计

### 2.1 目录与文件（目标 1）

```
packages/agent/src/style/
├── __tests__/
│   ├── loader.test.ts
│   └── guard-classname.test.ts     # G5 纯函数测试（实现可在 agents/review.ts 同域新文件）
├── loader.ts                       # parseStyleMarkdown() + loadStyleTemplate()（含内置注册表）
├── types.ts                        # StyleTemplate / StyleConfigInput
├── guard-classname.ts              # extractClassTokens / whitelistMatches / checkClassNames（G5 纯函数）
├── host-classes.ts                 # collectHostClasses(projectRoot)（模块级缓存；node:fs 递归，无新 glob 依赖）
└── templates/                      # 内置模板：*.ts 导出 markdown 契约字符串（tsup 不拷贝 .md 资产，
    │                               #   import.meta.url 在 ESM dist/Windows 下路径脆 —— 实现修订，契约不变）
    ├── tailwind-lite.ts            #   frontmatter + 正文与 §2.2 契约逐字同构；auto-detect 例外：
    ├── semantic-css.ts             #   以字面对象入注册表（不渲染 prompt 段，见 §2.4）
    ├── mui-style.ts
    └── unstyled.ts
```

### 2.2 数据结构

```ts
// style/types.ts
export interface StyleTemplate {
  id: string                      // 内置 id 或自定义文件 frontmatter id（缺省取文件名 stem）
  source: 'built-in' | 'custom'
  classNameWhitelist?: string[]   // G5 用；支持 'px-*' 通配；缺省 = auto-detect 语义
  description: string             // 注入 prompt 的风格概述（frontmatter 下方正文首段）
  rules: string[]                 // 注入 prompt 的硬约束（正文 '## Hard rules' 列表项）
}

// config 侧（packages/config/src/schema.ts）
export const AgentStyleConfigSchema = z.object({
  id: z.string().min(1).optional(),          // 内置 id 或自定义 frontmatter id
  path: z.string().min(1).optional(),        // 相对 nx-mk.config.yml 所在目录
  overrides: z.record(z.string()).optional(),// 键值对追加进 prompt 的模板变量（v1 仅透传 description 模板插值）
}).strict()
```

解析优先级：`path` 存在 → 加载自定义文件（`id` 缺省取文件名 stem）；否则 `id` 必须命中内置注册表；两者皆缺 → `auto-detect`（现网行为兼容：不配置即无风格段、G5 走宿主扫描，**不破坏既有用户**）。

markdown 格式约定（模板作者契约）：

```md
---
id: tailwind-lite                      # 可选；缺省取文件名 stem
classNameWhitelist: ["flex","grid","px-*","text-*"]   # 可选；YAML 数组；含通配符
---
风格概述段（1-3 句，原样进 prompt）。

## Hard rules
- 规则一（原样进 prompt，逐条一行）
- 规则二
```

`overrides` 语义：`description` 中 `{{key}}` 占位符按 overrides 键值替换，未提供的占位符原样保留并打启动警告（不做静默剔除）。

### 2.3 内置模板 5 个（v1 定版）

| id | 定位 | classNameWhitelist 示例 |
|---|---|---|
| `tailwind-lite` | utility-first，无自定义 CSS 文件 | `flex grid px-* py-* text-* bg-* border-* rounded-* font-*` |
| `semantic-css` | 复用宿主语义 class，禁 utility | 缺省（= 宿主扫描），rules 强制「新建 class 必须在宿主 styles 定义」 |
| `mui-style` | Material UI 组件与 sx prop | 白名单不适用 → 缺省；rules 约束「优先 MUI 组件，不引第三方 UI 库」 |
| `unstyled` | 纯结构渲染，最小 div/text | 缺省；rules 禁装饰性 class |
| `auto-detect` | **默认兜底**：不渲染 prompt 段（§2.4/DS3——「先读宿主再模仿」本就是 LLM 默认行为），G5 走宿主 CSS 扫描兜底 | 缺省（= 现网行为 + 宿主扫描） |

### 2.4 prompt 注入（目标 3）

`buildPrompt(task, ctx, style?: StyleTemplate)` 增加第三参数（可选）。渲染规则：`style === undefined` 时不渲染风格段（现网调用与测试逐字节兼容）；`style` 存在且 `source === 'custom'` 或 `id !== 'auto-detect'` 时渲染完整风格段；`id === 'auto-detect'` 时**不渲染风格段**（其语义全部由 G5 的宿主扫描兜底承担，prompt 不加噪声）。渲染位置：硬约束**之前**独立段：

```
Style guidelines (template: tailwind-lite):
<style.description>

Hard rules:
- <rule 1>
- <rule 2>
```

接线：runtime 在 loop 启动期 `loadStyleTemplate(config.agent.style)` 一次并缓存（含解析错误即进程级 fail-fast，见 §3）；逐 task 调 `ctx.ai.edit({ instructions: buildPrompt(task, ctx, style) })`。

### 2.5 review guard G5（目标 4）

现有检查链 G1 apply-check / G2 ignored-render / G3 json-dump / G4 console-probe（`agents/review.ts`）追加：

- **G5 `classname-whitelist`**：取 diff 新增行（复用 `addedLines()`），正则收集 `class="..."` / `className="..."` / `className={...}` 字符串字面量 token（空白分词）；
- 判定序：模板白名单命中（通配符转 `^prefix-.*$` 全词匹配）→ 放行；白名单缺省 → G5 退化为「宿主 CSS 扫描」：Glob 宿主 `**/*.{css,scss,tsx,jsx}` 收集既有 class 名集合，token 命中放行；两者皆未命中 → violation；
- 任一 violation → 该 patch 进 `rejected/` + `verdict: 'reject'` + check detail 列出违规 token 与所属文件（行为对齐 G2-G4）；
- G5 与 G2-G4 并列独立，注入缝沿用 `verifyDiff` 的 `inject` 模式（宿主 class 集合可注入，测试不触文件系统）。

### 2.6 config 三处接线（目标 2）

1. `packages/config/src/schema.ts`：`AgentConfigSchema` 加 `style: AgentStyleConfigSchema.optional()`；
2. `packages/cli`：config 读取/校验链路透传（对齐既有 `agent.provider / agent.loop` 两段的接线方式，不新增旁路）；
3. `packages/agent/src/runtime.ts`：启动期解析并缓存 `StyleTemplate`，传入各 agent 的 prompt 组装。

---

## 3. 错误路径（目标 5）

| 场景 | 时机 | 行为 |
|---|---|---|
| 未知 `id` 且无 `path` | loop 启动 | 进程级 fail-fast，错误信息列出全部内置 id 清单 |
| `path` 文件不存在 / 不可读 | loop 启动 | 进程级 fail-fast，信息含绝对路径 + 「应为相对 config 的路径」提示 |
| frontmatter 缺 `## Hard rules` 或正文为空 | loop 启动 | 进程级 fail-fast，信息含模板格式示例（§2.2 契约原文） |
| `id` 与 `path` 同时给出 | loop 启动 | `path` 优先；启动警告说明以 path 为准 |
| `classNameWhitelist: []` 空数组且 id ≠ auto-detect | loop 启动 | 允许 + 警告「空白名单等效 auto-detect 兜底」 |
| overrides 占位符无对应键 | loop 启动 | 允许 + 警告列出未替换占位符名 |
| G5 运行期宿主扫描零命中（全新项目） | task 级 | 该 token 记 violation，但 check detail 附「宿主未检出任何既有 class」提示，不静默 |

进程级 fail-fast 对齐 provider PROVIDER_UNAVAILABLE 的既有语义（config 错误不应烧掉 N 轮 LLM 调用后才失败）。

---

## 4. 测试计划（目标 6）

| 文件 | 覆盖 |
|---|---|
| `style/__tests__/loader.test.ts` | 5 内置模板可加载且字段完整；未知 id 错误含清单；path 缺失错误；frontmatter 缺段落错误；id+path 优先级；overrides 插值与警告；stem 缺省 id |
| `style/__tests__/guard-classname.test.ts` | 白名单命中/未命中；通配符匹配；缺省白名单走注入的宿主集合；violation 汇总进 verdict reject；与 G2-G4 并列不互斥 |
| `agents/__tests__/api-ui.test.ts`（扩展） | buildPrompt 三参：有 style 渲染风格段与位置（硬约束前）；无 style 与 style=auto-detect 两种情况输出均与现网逐字节一致（兼容回归锚） |
| `__tests__/runtime`（扩展） | style 解析失败 fail-fast 不进 loop；成功路径 prompt 携带 style 段 |
| `packages/config` schema 测试（扩展） | `agent.style` 合法/非法（strict 拒绝未知键）、id/path 类型校验 |

验收基线：全仓 vitest 绿（当前 765/765 基础上净增）；typecheck 13 包全绿。

---

## 5. 文档

- `docs/style-templates.md`：模板作者指南（frontmatter 契约、白名单通配符语义、G5 行为、5 内置模板对照表、自定义 path 示例）
- `docs/hygiene-backlog.md`：不涉及（无已知遗留债）
- README：`agent.style` 配置一行示例（并入既有 config 示例块，不新开章节）

---

## 6. 决策记录（新增）

| # | 决策 | 理由 |
|---|---|---|
| DS1 | 模板是 markdown 而非 TS 模块 | S2：prompt 规范天然是文本；用户无需会 TS 即可写模板；loader 单一解析点 |
| DS2 | G5 落在 agent 包 review 链，不新起 guard 子系统 | G1-G4 已是静态规则引擎，G5 是同构第 5 条；新子系统违 YAGNI |
| DS3 | 不配置 style = 解析出 auto-detect 模板对象：G5 走宿主扫描兜底，但 prompt **不渲染风格段**（逐字节兼容现网） | 不破坏既有用户与 765 测试基线；升级无感；auto-detect 的「先读宿主再模仿」本就是 LLM 默认行为，写进 prompt 是噪声 |
| DS4 | 解析错误进程级 fail-fast 而非 task 级降级 | config 错误烧 LLM 轮次是纯浪费；对齐 PROVIDER_UNAVAILABLE 语义 |
| DS5 | overrides 仅做 description 插值，不做 rules 合并 | v1 最小语义；rules 合并牵涉优先级仲裁，YAGNI，需要时 v2 扩 |
