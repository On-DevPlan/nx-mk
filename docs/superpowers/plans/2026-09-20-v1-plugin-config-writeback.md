# v1 Plugin Config 写回链 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在 dashboard 编辑任一插件的 config：`PATCH /api/plugins/:name/config?dryRun=true` 出 YAML diff（不落盘），`dryRun=false` 原子写回 `nx-mk.config.yml`（写前留 `.bak`），kernel 侧 `plugins` 配置扩为 per-plugin 命名空间（向后兼容 `string[]`）并在下次 run 生效。

**Architecture:** 三层改动——① config/kernel 层把 `plugins` 条目从 `string` 扩为 `string | {name, config}` 联合（`normalizePluginEntries` 归一化，裸 string → `config: {}`），`loadPlugins`/`validateConfigSchema` 校验输入反转为 per-entry config（W4'），`plugins-manifest.json` 条目 `config` 字段改为 per-plugin 值（V5'）；② 写回引擎 `previewConfigWrite`/`applyConfigWrite` 落在 `@nx-mk/config`（它拥有 `yaml` 依赖），yaml Document API round-trip 保注释、tmp+rename 原子写、单代 `.bak`、sha 并发防护；③ dashboard 只加 PATCH 薄路由（校验门 + 错误码映射）+ PluginSettings 编辑器 UI。

**Tech Stack:** TypeScript ESM、zod（schema）、yaml@^2.4.5（Document API round-trip，config 包既有）、fastify（PATCH 路由）、React 19 renderToString（UI 测试）、vitest。

**Spec:** `docs/superpowers/specs/2026-09-20-nx-mk-v1-plugin-config-writeback-design.md`（W1-W8 裁定、§2.3 API、E1-E7 错误表、§4 测试策略、§5 验收——本计划据其论证，冲突以 spec 为准，唯 plan-level rulings 节显式修订处除外）

## Global Constraints（每个任务隐式继承）

- **D2 依赖铁律**：零新增外部 npm 包。`yaml` 只在 `@nx-mk/config`（已有 `^2.4.5`）；dashboard 新增的是 **workspace 内部依赖** `@nx-mk/config: workspace:*`（与既有 `@nx-mk/coverage: workspace:*` 同类，外部依赖数不变）
- **铁律 R12（W8 + 本计划 WP1 修订）**：dashboard server 的 fs 写路径白名单仍只有 `replay.ts` 一个文件——config.yml 的写动作全部发生在 `packages/config/src/writeback.ts`（config 包是用户配置的所有者，语义比 spec W8 原文更强）
- 单文件 ≤400 行；ESM 相对导入带 `.js` 后缀；`verbatimModuleSyntax`（类型导入用 `import type`）；`noUncheckedIndexedAccess`（数组访问判空）；中文注释 + 英文标识符/测试描述
- 测试从 repo 根跑：`PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run`；typecheck：`PATH=...:$PATH pnpm -r typecheck`
- 提交信息不带任何 attribution 行（用户常设指令），Conventional Commits 中文描述
- 全程不得引入 `jsdom`/`EventSource` stub——UI 测试只用 `renderToString`（node 环境）
- 现存 `string[]` 格式 config 文件必须零破坏（loader.test.ts 既有 fixtures 不改语义）

## Plan-Level Rulings（对 spec 的显式修订/澄清，SDD 执行时按此裁定）

| # | 裁定 | 理由 / 代价 |
|---|---|---|
| WP1 | 写回引擎（round-trip/diff/原子写/.bak/sha）实现为 `packages/config/src/writeback.ts`，**不**放 dashboard；dashboard 经 workspace 依赖 `@nx-mk/config` 消费 | `yaml` 依赖只在 config 包；spec §5.5 自己要求"dashboard 不新增"依赖。spec W8 白名单从"replay.ts + config-write.ts 两文件"修订为"dashboard server 仍恰 1 文件（replay.ts），config 包新增 writeback.ts 为 config.yml 唯一写者"——强度只增不减 |
| WP2 | spec E1 的"有 configSchema 则深度校验"**v1 降为形状门**（config 必须是 JSON object）+ E6 自伤防护；真实 configSchema 校验仍在 kernel 下次 run 的 loadPlugins fail-fast（PLUGIN_CONFIG_INVALID，退出码 6） | manifest 里只有序列化 JSON Schema（无 validator）；深度校验需 ajv（破 D2）或 dashboard 动态加载插件包（危险面）。UI 照常展示 manifest 的 configSchema JSON 作参考 |
| WP3 | 编辑器 textarea 内容用 **JSON**（JSON ⊂ YAML），`JSON.parse` 解析后进 PATCH body；不做 YAML 解析（dashboard 无 yaml 依赖） | 零依赖；UI 文案注明"config is JSON (valid YAML)"。spec §2.1 "textarea 编辑 YAML 片段"按此收窄 |
| WP4 | `dryRun` query 参数缺省 = `true`（安全默认）；仅显式 `?dryRun=false` 才落盘 | 两段式的门应由缺省侧倒向安全侧 |
| WP5 | kernel `validateConfigSchema` 改为导出（原模块私有）以便单测钉死 W4' 反转（输入= per-entry config） | 可测性；签名同时从 `ResolvedConfig` 收窄为 `Record<string, unknown>` |
| WP6 | `plugins-manifest.json` 条目 `config`：条目在 `plugins` 列表 → 该条目 config 对象；不在（extraPlugins/程序化装配）→ `null`（诚实缺省） | 全量快照语义废弃（V5'）；`null` 与既有 `configSchema: null` 形状对偶，plugins-reader sanitize 已容忍 unknown |
| WP7 | kernel 与 config 包各自持有一份 `normalizePluginEntries`（结构镜像，3 行逻辑）——kernel 不静态依赖 @nx-mk/config（沿用 kernel-runtime 动态 import 的既有边界） | 类型层重复（ResolvedConfig 已是先例）；换取包边界不破 |

## File Structure

```
packages/config/src/
  schema.ts                  # T1: PluginEntrySchema 联合 + ConfigSchema.plugins 扩类型
  index.ts                   # T1: 导出 PluginEntrySchema/PluginEntry/normalizePluginEntries
  writeback.ts               # T4: 写回引擎（新）
  __tests__/plugins-union.test.ts   # T1（新）
  __tests__/writeback.test.ts       # T4（新）
packages/kernel/src/
  types.ts                   # T2: Config.plugins 扩类型 + PluginConfigEntry 接口
  plugin-registry.ts         # T2: loadPlugins 收联合条目 + validateConfigSchema 反转+导出 + 本地 normalize
  plugins-manifest.ts        # T2: per-plugin config（V5'）
  kernel-runtime.ts          # T2: resolvePlugins 按条目名过滤 + 不再传全量 config
  index.ts                   # T2: 导出 PluginConfigEntry 类型（如缺）
  __tests__/plugin-registry.test.ts  # T2: 追加联合条目用例
  __tests__/plugin-schema.test.ts    # T2: 追加 W4' 反转钉死用例
  __tests__/plugins-manifest.test.ts # T2: config 断言改为 per-plugin
packages/plugin-playwright/src/
  index.ts                   # T3: resolveCollectTarget（导出纯函数）+ beforeRun 消费
  __tests__/collect-target.test.ts   # T3（新）
packages/dashboard/src/
  shared/api-types.ts        # T5: ConfigWritePreviewResponse/ConfigWriteApplyResponse
  server/types.ts            # T5: RouteContext.configPath?
  server/index.ts            # T5: BuildServerOptions.configPath? + ctx 透传
  server/routes/plugins.ts   # T5: PATCH 路由
  package.json               # T5: + @nx-mk/config workspace 依赖（pnpm-lock.yaml 同步）
  ui/api.ts                  # T6: patchJson
  ui/pages/PluginSettings.tsx # T6: Edit config → JSON textarea → Preview diff → Apply
  __tests__/plugins-config-routes.test.ts  # T5（新）
  __tests__/plugin-settings-editor.test.ts # T6（新）
packages/cli/src/commands/start.ts  # T5: buildServer 传 configPath
```

---

### Task 1: config 包 — plugins 联合类型 schema + normalizePluginEntries

**Files:**
- Modify: `packages/config/src/schema.ts`（ConfigSchema.plugins 一处 + 新增两个导出）
- Modify: `packages/config/src/index.ts:4`（导出行追加）
- Test: `packages/config/src/__tests__/plugins-union.test.ts`（新）

**Interfaces:**
- Consumes: 既有 `PluginNameSchema`（schema.ts 内部）
- Produces: `PluginEntrySchema`（zod union）、`type PluginEntry = string | { name: string; config: Record<string, unknown> }`、`normalizePluginEntries(entries: ReadonlyArray<PluginEntry>): Array<{ name: string; config: Record<string, unknown> }>`——Task 2 的 kernel 镜像版与 Task 4 的 writeback 都依赖这个形状

- [ ] **Step 1: 写失败测试**

创建 `packages/config/src/__tests__/plugins-union.test.ts`：

```ts
/**
 * plugins 联合类型（spec W1/W3）：裸 string 向后兼容 + { name, config } per-plugin 命名空间。
 */
import { describe, it, expect } from 'vitest'
import { ConfigSchema, PluginEntrySchema, normalizePluginEntries } from '../schema'

describe('ConfigSchema.plugins 联合类型', () => {
  it('裸 string 数组照常解析（向后兼容，现存 config 零破坏）', () => {
    const parsed = ConfigSchema.parse({ plugins: ['@nx-mk/plugin-swagger'] })
    expect(parsed.plugins).toEqual(['@nx-mk/plugin-swagger'])
  })

  it('对象条目解析出 { name, config }', () => {
    const parsed = ConfigSchema.parse({
      plugins: [{ name: '@nx-mk/plugin-swagger', config: { maxTurns: 7 } }],
    })
    expect(parsed.plugins).toEqual([{ name: '@nx-mk/plugin-swagger', config: { maxTurns: 7 } }])
  })

  it('对象条目缺 config → default {}', () => {
    const parsed = PluginEntrySchema.parse({ name: '@nx-mk/plugin-swagger' })
    expect(parsed).toEqual({ name: '@nx-mk/plugin-swagger', config: {} })
  })

  it('混合列表（string + 对象）可解析', () => {
    const parsed = ConfigSchema.parse({
      plugins: ['@nx-mk/plugin-playwright', { name: '@nx-mk/plugin-swagger', config: {} }],
    })
    expect(parsed.plugins).toHaveLength(2)
  })

  it('非法插件名（含空格）在对象条目内同样拒绝', () => {
    expect(() => PluginEntrySchema.parse({ name: 'BAD NAME WITH SPACES', config: {} })).toThrow()
  })

  it('非 string 非对象的条目拒绝', () => {
    expect(() => PluginEntrySchema.parse(42)).toThrow()
  })

  it('max 20 上限仍生效', () => {
    const twentyOne = Array.from({ length: 21 }, () => '@nx-mk/plugin-swagger')
    expect(() => ConfigSchema.parse({ plugins: twentyOne })).toThrow(/max 20 plugins/)
  })
})

describe('normalizePluginEntries（W3）', () => {
  it('裸 string → { name, config: {} }；对象原样透传', () => {
    expect(
      normalizePluginEntries([
        '@nx-mk/plugin-playwright',
        { name: '@nx-mk/plugin-swagger', config: { maxTurns: 7 } },
      ]),
    ).toEqual([
      { name: '@nx-mk/plugin-playwright', config: {} },
      { name: '@nx-mk/plugin-swagger', config: { maxTurns: 7 } },
    ])
  })

  it('空数组 → 空输出', () => {
    expect(normalizePluginEntries([])).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/config/src/__tests__/plugins-union.test.ts`
Expected: FAIL —— `PluginEntrySchema`/`normalizePluginEntries` 不存在（导入错误）；对象条目用例因 schema 仍是 `z.array(PluginNameSchema)` 而 throw

- [ ] **Step 3: 最小实现**

`packages/config/src/schema.ts` —— 在 `ConfigSchema` 定义之前（紧挨 `PluginNameSchema` 之后）加：

```ts
// v1（W1/W3）：插件条目联合类型 —— 裸包名字符串向后兼容；对象条目开 per-plugin 配置命名空间。
// 裸 string 条目的 config 语义上视为 {}（由 normalizePluginEntries 归一化）。
export const PluginEntrySchema = z.union([
  PluginNameSchema,
  z.object({
    name: PluginNameSchema,
    config: z.record(z.unknown()).default({}),
  }),
])
export type PluginEntry = z.infer<typeof PluginEntrySchema>

/** 裸 string → { name, config: {} }（W3）；kernel 侧有一份结构镜像实现（WP7，避免硬依赖） */
export function normalizePluginEntries(
  entries: ReadonlyArray<string | PluginEntry>,
): Array<{ name: string; config: Record<string, unknown> }> {
  return entries.map((e) => (typeof e === 'string' ? { name: e, config: {} } : { name: e.name, config: e.config }))
}
```

并把 `ConfigSchema` 里的 plugins 行：

```ts
    plugins: z.array(PluginNameSchema).max(20, 'max 20 plugins').default([]),
```

改为：

```ts
    plugins: z.array(PluginEntrySchema).max(20, 'max 20 plugins').default([]),
```

`packages/config/src/index.ts` 第 4 行的导出列表追加三个名字（保持既有单行风格，按字母序插入 `PluginEntrySchema, type PluginEntry, normalizePluginEntries` 到 schema 导出组内）。

- [ ] **Step 4: 跑测试确认通过 + 包内回归**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/config`
Expected: 新文件 9 用例 PASS；loader.test.ts 等既有用例零回归

- [ ] **Step 5: 提交**

```bash
git add packages/config/src/schema.ts packages/config/src/index.ts packages/config/src/__tests__/plugins-union.test.ts
git commit -m "feat(config): plugins 扩为 string|{name,config} 联合类型 + normalizePluginEntries（W1/W3）"
```

---

### Task 2: kernel — loadPlugins 联合条目 + validateConfigSchema 反转（W4'）+ manifest per-plugin（V5'）

**Files:**
- Modify: `packages/kernel/src/types.ts:92`（Config.plugins）+ 附近新增 `PluginConfigEntry`
- Modify: `packages/kernel/src/plugin-registry.ts`（loadPlugins 循环、validateConfigSchema、LoadPluginsOptions）
- Modify: `packages/kernel/src/plugins-manifest.ts`（buildPluginsManifest）
- Modify: `packages/kernel/src/kernel-runtime.ts:209-214`（resolvePlugins 过滤）
- Modify: `packages/kernel/src/index.ts:49-50`（导出 PluginConfigEntry）
- Test: `packages/kernel/src/__tests__/plugin-registry.test.ts`（追加）、`plugin-schema.test.ts`（追加）、`plugins-manifest.test.ts`（改写 config 断言）

**Interfaces:**
- Consumes: Task 1 的形状（kernel 本地镜像 `PluginConfigEntry`，WP7）
- Produces（Task 3/5 依赖）:
  - `type PluginConfigEntry = { name: string; config: Record<string, unknown> }`（从 `@nx-mk/kernel` 导出）
  - `Config.plugins: Array<string | PluginConfigEntry>`
  - `normalizePluginEntries(entries: ReadonlyArray<string | PluginConfigEntry>): PluginConfigEntry[]`（plugin-registry 导出）
  - `validateConfigSchema(plugin: Plugin, name: string, rawConfig: Record<string, unknown>): Promise<void>`（导出；输入语义 = per-entry config）
  - `LoadPluginsOptions` 不再有 `config` 字段（只剩 `cwd?`）

- [ ] **Step 1: 写失败测试**

`packages/kernel/src/__tests__/plugin-schema.test.ts` 文件末尾追加（`import` 区追加 `import { validateConfigSchema, normalizePluginEntries } from '../plugin-registry'`，并补 `import type { Plugin } from '../plugin'`）：

```ts
describe('W4’：validateConfigSchema 输入 = per-entry config（v1 反转）', () => {
  const schemaPlugin = {
    name: 'schema-p',
    version: '1.0.0',
    hooks: {},
    configSchema: z.object({ maxTurns: z.number().int().positive() }),
  } as unknown as Plugin

  it('合法条目 config 通过', async () => {
    await expect(validateConfigSchema(schemaPlugin, 'schema-p', { maxTurns: 3 })).resolves.toBeUndefined()
  })

  it('条目 config 缺必填字段 → PLUGIN_CONFIG_INVALID（旧全量语义下该字段来自顶层，此断言钉死反转）', async () => {
    await expect(validateConfigSchema(schemaPlugin, 'schema-p', {})).rejects.toMatchObject({
      code: 'PLUGIN_CONFIG_INVALID',
    })
  })

  it('不声明 schema 的插件跳过校验（向后兼容）', async () => {
    const bare = { name: 'b', version: '1', hooks: {} } as unknown as Plugin
    await expect(validateConfigSchema(bare, 'b', { anything: true })).resolves.toBeUndefined()
  })
})

describe('normalizePluginEntries（kernel 镜像，WP7）', () => {
  it('裸 string → { name, config: {} }；对象透传', () => {
    expect(
      normalizePluginEntries(['a-pkg', { name: 'b-pkg', config: { x: 1 } }]),
    ).toEqual([
      { name: 'a-pkg', config: {} },
      { name: 'b-pkg', config: { x: 1 } },
    ])
  })
})
```

`packages/kernel/src/__tests__/plugin-registry.test.ts` 的 `describe('loadPlugins', ...)` 内追加（workspace 内真实包 `@nx-mk/plugin-swagger` 可被动态 import——既有同款用例先例）：

```ts
  it('接受 string | {name, config} 联合条目（W1）', async () => {
    const plugins = await loadPlugins([
      '@nx-mk/plugin-swagger',
      { name: '@nx-mk/plugin-swagger', config: { maxTurns: 7 } },
    ])
    expect(plugins).toHaveLength(2)
    expect(plugins[0]!.name).toBe('@nx-mk/plugin-swagger')
  })

  it('非法形状条目（对象缺 name）→ PLUGIN_LOAD_FAILED 前置校验失败', async () => {
    // 运行期防御：kernel 侧 normalize 假定 schema 已把关，此处钉死坏对象不被静默吞
    await expect(
      loadPlugins([{ name: 42 } as unknown as string]),
    ).rejects.toMatchObject({ code: 'PLUGIN_LOAD_FAILED' })
  })
```

注意第二个用例的实现依赖 Step 3 中 loadPlugins 对对象条目做 `isValidPluginName(typeof e.name === 'string' ? e.name : '')` 式防御（非法名在加载前抛 PLUGIN_LOAD_FAILED——与既有 string 路径同一条错误链）。

`packages/kernel/src/__tests__/plugins-manifest.test.ts` 改写：第一条用例 `'serializes name/version/enabled/config/configSchema'` 中 `buildPluginsManifest([p], { logLevel: 'info' } as never)` 与 `expect(e.config).toEqual({ logLevel: 'info' })` 改为 per-plugin 语义：

```ts
    const m = buildPluginsManifest([p], { plugins: [{ name: '@nx-mk/plugin-swagger', config: { maxTurns: 7 } }] } as never)
    // ...（name/version/enabled/configSchema 断言不变）
    expect(e.config).toEqual({ maxTurns: 7 })
```

第三条用例 `'plugin without configSchema → null; undefined config → null'` 保持（`undefined` config → entries 空 Map → `config: null` 路径不变），另追加一条：

```ts
  it('不在 plugins 列表的插件（extraPlugins 装配）→ config null（WP6）', () => {
    const m = buildPluginsManifest(
      [{ name: 'assembled', version: '1', hooks: {} }],
      { plugins: ['@nx-mk/plugin-swagger'] } as never,
    )
    expect(m.plugins[0]!.config).toBeNull()
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/kernel/src/__tests__/plugin-schema.test.ts packages/kernel/src/__tests__/plugin-registry.test.ts packages/kernel/src/__tests__/plugins-manifest.test.ts`
Expected: FAIL —— `validateConfigSchema` 未导出、`normalizePluginEntries` 不存在、联合条目用例类型/运行失败、manifest config 断言仍是全量快照

- [ ] **Step 3: 最小实现**

**`packages/kernel/src/types.ts`** —— `Config` 接口（第 92 行附近）：

```ts
/** v1 per-plugin 配置条目（@nx-mk/config PluginEntrySchema 的结构镜像，WP7——kernel 不硬依赖 config 包） */
export interface PluginConfigEntry {
  name: string
  config: Record<string, unknown>
}
```

`plugins: string[]` 改为：

```ts
  plugins: Array<string | PluginConfigEntry>
```

**`packages/kernel/src/plugin-registry.ts`**：

1. 顶部 import 区：删掉 `import type { ResolvedConfig } from './types'`，改为 `import type { PluginConfigEntry } from './types'`。
2. `LoadPluginsOptions` 删掉 `config?: ResolvedConfig` 字段及其注释，只留 `cwd?: string`（注释改为：`cwd 决定插件包的解析基准（默认取当前进程工作目录）`）。
3. 新增导出（放在 `LoadPluginsOptions` 之后）：

```ts
/** 裸 string → { name, config: {} }（W3/WP7）；与 @nx-mk/config 的同名函数结构镜像 */
export function normalizePluginEntries(
  entries: ReadonlyArray<string | PluginConfigEntry>,
): PluginConfigEntry[] {
  return entries.map((e) => (typeof e === 'string' ? { name: e, config: {} } : e))
}
```

4. `loadPlugins` 签名与循环改为条目驱动（`names` → `entries`）：

```ts
export async function loadPlugins(
  entries: ReadonlyArray<string | PluginConfigEntry>,
  opts: LoadPluginsOptions = {},
): Promise<Plugin[]> {
  const list = normalizePluginEntries(entries)
  if (list.length === 0) return []
  const cwd = opts.cwd ?? process.cwd()
  // 以用户项目目录为基准构造 require，让 package.json 解析走用户项目的 node_modules
  const require = createRequire(cwd + '/')
  const plugins: Plugin[] = []
  for (const entry of list) {
    const name = entry.name
    // 校验段 ①：插件名必须是合法 npm 包名（对象条目同样过这道门）
    if (!isValidPluginName(name)) {
      throw new KernelError(
        'PLUGIN_LOAD_FAILED',
        `Invalid plugin name: '${name}' (must match ${PLUGIN_NAME_RE})`,
      )
    }
    // ……（②动态 import / ③工厂解析 / 工厂调用：与现文件逐字相同，变量 name 不变）
    // 校验段 ④ + ⑤：结构校验 + configSchema 校验（W4'：输入= 该条目的 per-plugin config）+ package.json 对照
    validateShape(plugin, name)
    await validateConfigSchema(plugin as Plugin, name, entry.config)
    await validatePackageMatch(plugin as Plugin, name, require)
    plugins.push(plugin as Plugin)
  }
  return plugins
}
```

注意：`entry.name` 类型是 `string`，但防御 `loadPlugins([{ name: 42 }])` 用例需要 normalize 对坏对象容错——`normalizePluginEntries` 的对象分支在坏输入（name 非 string）下会让 `isValidPluginName` 收到非 string。实现为：

```ts
export function normalizePluginEntries(
  entries: ReadonlyArray<string | PluginConfigEntry>,
): PluginConfigEntry[] {
  return entries.map((e) =>
    typeof e === 'string' ? { name: e, config: {} } : { name: e.name as string, config: e.config },
  )
}
```

并在 `loadPlugins` 循环头部把类型门做实（`name` 归一为 string，坏输入落进既有 `isValidPluginName` 失败链）：

```ts
    const name = typeof entry.name === 'string' ? entry.name : ''
```

5. `validateConfigSchema` 反转 + 导出（第 118-152 行区域）：

```ts
/**
 * M2（v1 W4' 反转）：用插件声明的 configSchema 校验**该插件条目的 per-plugin config**。
 * 若插件未声明 schema，跳过校验。不修改传入的 config 对象（只读）。
 *
 * @param plugin - 已通过 validateShape 的插件对象
 * @param name - 插件名（错误信息用）
 * @param rawConfig - 该插件条目的 config 对象（v0 的全量 ResolvedConfig 语义已废弃）
 */
export async function validateConfigSchema(
  plugin: Plugin,
  name: string,
  rawConfig: Record<string, unknown>,
): Promise<void> {
  // ……函数体逐字保留，仅参数类型收窄（validateConfig(plugin.configSchema, rawConfig) 调用不变）
}
```

**`packages/kernel/src/plugins-manifest.ts`** —— 头注释 V5 段替换为 `V5' 裁定：v1 起 plugins 为联合类型，条目 config = per-plugin 配置（WP6：不在列表中的插件 → null）`；`buildPluginsManifest` 改为：

```ts
import { normalizePluginEntries } from './plugin-registry.js'

export function buildPluginsManifest(plugins: Plugin[], config: ResolvedConfig | undefined): PluginsManifestFile {
  const entries = config ? normalizePluginEntries(config.plugins) : []
  const configByName = new Map(entries.map((e) => [e.name, e.config]))
  return {
    generatedAt: new Date().toISOString(),
    plugins: plugins.map((p) => ({
      name: p.name,
      version: p.version,
      enabled: true,
      config: configByName.get(p.name) ?? null,
      configSchema: serializeConfigSchema(p.configSchema),
    })),
  }
}
```

（`PluginManifestEntry.config` 注释同步改为 `per-plugin 配置（V5'）；不在 plugins 列表/不可得 → null`。）

**`packages/kernel/src/kernel-runtime.ts`** 第 209-214 行：

```ts
        // Ruling 5 追加缝（excludePluginNames）：先过滤配置数组（防双实例双 launch）——
        // v1 起条目是联合类型，按条目名过滤（W1）
        const excluded = new Set(opts.excludePluginNames ?? [])
        const config = deps.getConfig()!
        const entries = excluded.size === 0
          ? config.plugins
          : config.plugins.filter((e) => !excluded.has(typeof e === 'string' ? e : e.name))
        const loaded = await loadPlugins(entries, { cwd })
```

**`packages/kernel/src/index.ts`** 第 49-50 行区域追加类型导出：

```ts
export type { LoadPluginsOptions, PluginConfigEntry } from './plugin-registry'
```

（若 `PluginConfigEntry` 定义在 types.ts，则从 './types' 导出——以实际定义位置为准，两处只导出一次。）

- [ ] **Step 4: 跑测试确认通过 + 全 kernel 回归**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/kernel`
Expected: 全绿（plugin-assembly / kernel.test 等既有用例传 `string[]` 自动落入联合的 string 分支，零改动）

- [ ] **Step 5: typecheck 全仓（T2 是类型面最宽的任务）**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH pnpm -r typecheck`
Expected: 若 plugin-playwright / cli / dashboard 因 `Config.plugins` 类型收窄报错，按新联合类型修补调用点（本仓已知消费点仅 plugin-playwright `index.ts:80` 读 `collect` 段——不受影响；cli `run.ts` 不读 plugins 元素类型）。全部转绿后才提交。

- [ ] **Step 6: 提交**

```bash
git add packages/kernel/src packages/kernel/src/__tests__
git commit -m "feat(kernel): loadPlugins 收联合条目 + validateConfigSchema 反转为 per-entry config（W4'）+ manifest per-plugin（V5'）"
```

---

### Task 3: plugin-playwright — per-plugin config 优先，回落顶层 collect:（W1d）

**Files:**
- Modify: `packages/plugin-playwright/src/index.ts`（新增导出 `resolveCollectTarget` + beforeRun 消费）
- Test: `packages/plugin-playwright/src/__tests__/collect-target.test.ts`（新）

**Interfaces:**
- Consumes: Task 2 的 `PluginConfigEntry` / `ResolvedConfig`（`import type { ... } from '@nx-mk/kernel'`；若 kernel index 未导出 `ResolvedConfig` 则补导出）
- Produces: `resolveCollectTarget(config: Pick<ResolvedConfig, 'collect' | 'plugins'>, fallback: { url?: string; waitForSelector?: string }): { url?: string; waitForSelector?: string }`

- [ ] **Step 1: 写失败测试**

创建 `packages/plugin-playwright/src/__tests__/collect-target.test.ts`：

```ts
/**
 * resolveCollectTarget（W1d）：plugins 列表里本插件条目的 config 优先，回落顶层 collect: 段，
 * 再回落工厂 opts（CLI 装配注入）。
 */
import { describe, it, expect } from 'vitest'
import { resolveCollectTarget } from '../index'

describe('resolveCollectTarget', () => {
  it('对象条目 config 优先于顶层 collect 与 fallback', () => {
    expect(
      resolveCollectTarget(
        {
          collect: { url: 'http://from-collect' },
          plugins: [{ name: '@nx-mk/plugin-playwright', config: { url: 'http://from-entry' } }],
        },
        { url: 'http://from-opts' },
      ),
    ).toEqual({ url: 'http://from-entry', waitForSelector: undefined })
  })

  it('条目缺 url → 回落顶层 collect.url', () => {
    expect(
      resolveCollectTarget(
        {
          collect: { url: 'http://from-collect', waitForSelector: '[data-x]' },
          plugins: [{ name: '@nx-mk/plugin-playwright', config: {} }],
        },
        {},
      ),
    ).toEqual({ url: 'http://from-collect', waitForSelector: '[data-x]' })
  })

  it('裸 string 条目/无条目 → 仅顶层 collect 与 fallback', () => {
    expect(
      resolveCollectTarget({ collect: { url: 'http://c' }, plugins: ['other-pkg'] }, { url: 'http://o' }),
    ).toEqual({ url: 'http://c', waitForSelector: undefined })
    expect(resolveCollectTarget({ plugins: [] }, { waitForSelector: '[data-mk-field]' })).toEqual({
      url: undefined,
      waitForSelector: '[data-mk-field]',
    })
  })
})
```

（`CollectConfig` 若无 `waitForSelector` 之外字段约束，测试里对象字面量按既有 `CollectConfigSchema` 形状写；typecheck 报缺字段时以 `CollectConfig` 实际字段为准微调 fixture，不改断言。）

- [ ] **Step 2: 跑测试确认失败**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/plugin-playwright`
Expected: FAIL —— `resolveCollectTarget` 未导出

- [ ] **Step 3: 最小实现**

`packages/plugin-playwright/src/index.ts` 导出区新增（PLUGIN_NAME 常量 = `'@nx-mk/plugin-playwright'`）：

```ts
const PLUGIN_NAME = '@nx-mk/plugin-playwright'

export interface CollectTarget {
  url?: string
  waitForSelector?: string
}

/**
 * W1d：per-plugin config 优先级链 —— plugins 列表中本插件对象条目的 config
 * → 顶层 collect: 段 → 工厂 opts（CLI 装配注入）。
 */
export function resolveCollectTarget(
  config: Pick<ResolvedConfig, 'collect' | 'plugins'>,
  fallback: CollectTarget,
): CollectTarget {
  const own = config.plugins.find(
    (e): e is PluginConfigEntry => typeof e === 'object' && e !== null && e.name === PLUGIN_NAME,
  )
  const cfg = (own?.config ?? {}) as { url?: string; waitForSelector?: string }
  return {
    url: cfg.url ?? config.collect?.url ?? fallback.url,
    waitForSelector: cfg.waitForSelector ?? config.collect?.waitForSelector ?? fallback.waitForSelector,
  }
}
```

beforeRun 内（现第 94-99 行区域）替换 URL/waitForSelector 解析：

```ts
        const target = resolveCollectTarget(ctx.config as ResolvedConfig, opts)
        const url = target.url
        if (!url) {
          ctx.logger.warn('plugin-playwright: collect.url missing and no plugin url fallback')
          return
        }
        const waitForSelector = target.waitForSelector ?? '[data-mk-field]'
```

（原第 80 行 `const collect = ...` 读取保留给"collect 未配置 → 静默跳过"早退门：当 `collect` 与 plugins 列表都无本插件条目时维持既有 skip 行为；实现时若早退门条件与新解析冲突，以"有对象条目 config 即不跳过"为准微调该门——条目级配置等价于已配置采集。）

- [ ] **Step 4: 跑测试确认通过**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/plugin-playwright`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/plugin-playwright/src
git commit -m "feat(plugin-playwright): per-plugin config 优先解析采集目标，回落顶层 collect:（W1d）"
```

---

### Task 4: 写回引擎 — packages/config/src/writeback.ts（round-trip/diff/原子写/.bak/sha）

**Files:**
- Create: `packages/config/src/writeback.ts`
- Modify: `packages/config/src/index.ts`（导出）
- Test: `packages/config/src/__tests__/writeback.test.ts`（新）

**Interfaces:**
- Consumes: `yaml` 的 `parseDocument`（config 包既有依赖，探针已验证 round-trip 保注释、plain-object set、子字段更新均可行）
- Produces（Task 5 路由直接消费）:
  - `class ConfigWriteError extends Error { code: 'CONFIG_FILE_MISSING' | 'CONFIG_UNPARSEABLE' | 'PLUGIN_NOT_IN_CONFIG' | 'SHA_MISMATCH' | 'YAML_SELF_HARM' }`
  - `previewConfigWrite(configPath: string, pluginName: string, config: Record<string, unknown>): ConfigWritePreview`，`interface ConfigWritePreview { valid: true; errors: string[]; newYaml: string; yamlSha: string; diff: string }`
  - `applyConfigWrite(configPath: string, pluginName: string, config: Record<string, unknown>, expectedSha: string): ConfigWriteApplyResult`，`interface ConfigWriteApplyResult { applied: true; diff: string; bakPath: string; yamlSha: string }`
  - `naiveLineDiff(before: string, after: string): string`（导出以便单测；只输出 `- `/`+ ` 变更行，WP 裁定：无上下文行）

- [ ] **Step 1: 写失败测试**

创建 `packages/config/src/__tests__/writeback.test.ts`：

```ts
/**
 * 写回引擎（spec W5/W6/W7 + E2/E3/E4/E5/E6/E7）：yaml round-trip / naive diff / 原子写 / 单代 .bak / sha 防护。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256Text, previewConfigWrite, applyConfigWrite, naiveLineDiff, ConfigWriteError } from '../writeback'

const BASE_YAML = [
  '# 用户主配置',
  'logLevel: info',
  'plugins:',
  '  # 采集插件（注释行必须原样保留）',
  "  - '@nx-mk/plugin-playwright'",
  '  - name: \'@nx-mk/plugin-swagger\'',
  '    config:',
  '      maxTurns: 3',
  '',
].join('\n')

describe('naiveLineDiff', () => {
  it('输出 - / + 变更行（无上下文行，WP 裁定）', () => {
    expect(naiveLineDiff('a\nb\nc\n', 'a\nB\nc\n')).toEqual('- b\n+ B')
  })
  it('相同输入 → 空串', () => {
    expect(naiveLineDiff('x\n', 'x\n')).toBe('')
  })
})

describe('previewConfigWrite', () => {
  let dir: string
  let configPath: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nx-mk-wb-'))
    configPath = join(dir, 'nx-mk.config.yml')
    writeFileSync(configPath, BASE_YAML, 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('裸 string 条目被替换为对象条目；注释保留；原文件不动（不落盘）', () => {
    const p = previewConfigWrite(configPath, '@nx-mk/plugin-playwright', { url: 'http://new' })
    expect(p.valid).toBe(true)
    expect(p.errors).toEqual([])
    expect(p.newYaml).toContain("name: '@nx-mk/plugin-playwright'")
    expect(p.newYaml).toContain('url: http://new')
    expect(p.newYaml).toContain('# 采集插件（注释行必须原样保留）')
    expect(p.newYaml).toContain('maxTurns: 3')
    expect(p.diff).toContain("-  - '@nx-mk/plugin-playwright'")
    expect(p.diff).toContain('+   - name:')
    expect(readFileSync(configPath, 'utf8')).toBe(BASE_YAML) // preview 不落盘
    expect(existsSync(join(dir, 'nx-mk.config.yml.bak'))).toBe(false)
  })

  it('yamlSha = 写前文件内容的 sha256', () => {
    const p = previewConfigWrite(configPath, '@nx-mk/plugin-playwright', {})
    expect(p.yamlSha).toBe(sha256Text(BASE_YAML))
  })

  it('E4：插件不在 plugins 列表 → PLUGIN_NOT_IN_CONFIG', () => {
    expect(() => previewConfigWrite(configPath, 'not-listed-pkg', {})).toThrow(ConfigWriteError)
    try {
      previewConfigWrite(configPath, 'not-listed-pkg', {})
    } catch (err) {
      expect((err as ConfigWriteError).code).toBe('PLUGIN_NOT_IN_CONFIG')
    }
  })

  it('E2：config 文件缺失 → CONFIG_FILE_MISSING（不自动创建）', () => {
    expect(() => previewConfigWrite(join(dir, 'absent.yml'), 'p', {})).toThrowConfigErrorCode('CONFIG_FILE_MISSING')
  })

  it('E3：不可解析 YAML → CONFIG_UNPARSEABLE', () => {
    writeFileSync(configPath, 'plugins: [unclosed', 'utf8')
    expect(() => previewConfigWrite(configPath, 'p', {})).toThrowConfigErrorCode('CONFIG_UNPARSEABLE')
  })

  it('plugins 键不存在 → E4（无法定位条目）', () => {
    writeFileSync(configPath, 'logLevel: info\n', 'utf8')
    expect(() => previewConfigWrite(configPath, 'p', {})).toThrowConfigErrorCode('PLUGIN_NOT_IN_CONFIG')
  })
})

describe('applyConfigWrite', () => {
  let dir: string
  let configPath: string
  let bakPath: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nx-mk-wb-'))
    configPath = join(dir, 'nx-mk.config.yml')
    bakPath = join(dir, 'nx-mk.config.yml.bak')
    writeFileSync(configPath, BASE_YAML, 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('原子写生效 + .bak 保留原文 + 返回新文件 sha + 无 tmp 残留', () => {
    const sha = sha256Text(BASE_YAML)
    const r = applyConfigWrite(configPath, '@nx-mk/plugin-playwright', { url: 'http://v1' }, sha)
    expect(r.applied).toBe(true)
    expect(r.bakPath).toBe(bakPath)
    expect(readFileSync(bakPath, 'utf8')).toBe(BASE_YAML)
    const updated = readFileSync(configPath, 'utf8')
    expect(updated).toContain('url: http://v1')
    expect(updated).toContain('maxTurns: 3')
    expect(r.yamlSha).toBe(sha256Text(updated))
    // 原子性：目录里除 .bak 外无 tmp 残留
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'))
    expect(leftovers).toEqual([])
  })

  it('E5：sha 与盘上不符 → SHA_MISMATCH，文件保持原样', () => {
    expect(() =>
      applyConfigWrite(configPath, '@nx-mk/plugin-playwright', {}, 'deadbeef'),
    ).toThrowConfigErrorCode('SHA_MISMATCH')
    expect(readFileSync(configPath, 'utf8')).toBe(BASE_YAML)
    expect(existsSync(bakPath)).toBe(false)
  })

  it('E5：preview 与 apply 之间文件被外部修改 → SHA_MISMATCH', () => {
    const sha = sha256Text(BASE_YAML)
    writeFileSync(configPath, BASE_YAML.replace('maxTurns: 3', 'maxTurns: 99'), 'utf8')
    expect(() => applyConfigWrite(configPath, '@nx-mk/plugin-playwright', {}, sha)).toThrowConfigErrorCode('SHA_MISMATCH')
  })
})

// toThrowConfigErrorCode 辅助断言（避免每个用例重复 try/catch）
declare module 'vitest' {
  interface Assertion<T> {
    toThrowConfigErrorCode: (code: ConfigWriteError['code']) => void
  }
}
expect.extend({
  toThrowConfigErrorCode(fn: () => unknown, code: ConfigWriteError['code']) {
    let caught: unknown = null
    try {
      fn()
    } catch (err) {
      caught = err
    }
    const pass =
      caught instanceof ConfigWriteError && (caught as ConfigWriteError).code === code
    return { pass, message: () => `expected ConfigWriteError(${code}), got ${String(caught)}` }
  },
})
```

注意：`declare module 'vitest'` 断言扩展若与仓库 tsconfig 冲突（`expect.extend` 类型增强需要 `vitest` 的类型入口），允许退化为每个用例内联 try/catch 断言——但优先保留此辅助（类型增强写在测试文件内是 vitest 官方模式）。

- [ ] **Step 2: 跑测试确认失败**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/config/src/__tests__/writeback.test.ts`
Expected: FAIL —— `../writeback` 模块不存在

- [ ] **Step 3: 实现 writeback.ts**

创建 `packages/config/src/writeback.ts`（完整文件）：

```ts
/**
 * 用户配置写回引擎（spec v1 W5/W6/W7，WP1：本文件是 config.yml 的唯一写者）。
 *
 * 职责链：读原文 → sha 校验（apply）→ yaml Document round-trip 定位并替换目标插件条目
 * → dump 新文本 → 自伤防护（E6：新文本必须可再解析）→ naive diff →
 * apply 时 .bak 单代备份 + tmp+rename 原子落盘。
 * 全程不解析成普通对象再 stringify——那会砸掉用户注释与格式（W5）。
 */
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { parseDocument } from 'yaml'
import type { Document } from 'yaml'

export type ConfigWriteErrorCode =
  | 'CONFIG_FILE_MISSING'   // E2：409
  | 'CONFIG_UNPARSEABLE'    // E3：409
  | 'PLUGIN_NOT_IN_CONFIG'  // E4：404
  | 'SHA_MISMATCH'          // E5：409
  | 'YAML_SELF_HARM'        // E6：500（路由映射处维护 HTTP 码）

export class ConfigWriteError extends Error {
  constructor(
    readonly code: ConfigWriteErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ConfigWriteError'
  }
}

export interface ConfigWritePreview {
  valid: true
  errors: string[]
  newYaml: string
  yamlSha: string
  diff: string
}

export interface ConfigWriteApplyResult {
  applied: true
  diff: string
  bakPath: string
  yamlSha: string
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** naive 行级 diff（无 diff 依赖可用，D2）：只输出变更行（- 旧 / + 新），无上下文行 */
export function naiveLineDiff(before: string, after: string): string {
  const a = before.split('\n')
  const b = after.split('\n')
  const out: string[] = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue
    if (a[i] !== undefined) out.push(`- ${a[i]}`)
    if (b[i] !== undefined) out.push(`+ ${b[i]}`)
  }
  return out.join('\n')
}

/**
 * round-trip 核心（纯函数，不落盘）：在原文里定位 pluginName 条目并整体替换为
 * { name, config } 对象条目，dump 新文本并做自伤防护。
 * 裸 string 条目与对象条目都可作为定位目标（W3 向后兼容）。
 */
function renderConfigYaml(
  originalYaml: string,
  pluginName: string,
  config: Record<string, unknown>,
): { newYaml: string; diff: string } {
  const doc = parseDocument(originalYaml)
  if (doc.errors.length > 0) {
    throw new ConfigWriteError('CONFIG_UNPARSEABLE', `config file unparseable: ${doc.errors[0]?.message ?? 'unknown'}`)
  }
  const seq = doc.get('plugins', true)
  if (!seq || typeof seq !== 'object' || !('items' in (seq as object))) {
    throw new ConfigWriteError('PLUGIN_NOT_IN_CONFIG', `plugin not in config: ${pluginName} (no plugins list)`)
  }
  const pluginsSeq = seq as Document.Parsed & { items: unknown[] } // YAMLSeq
  let targetIndex = -1
  const itemCount = (pluginsSeq as unknown as { items: unknown[] }).items.length
  for (let i = 0; i < itemCount; i++) {
    const item = doc.getIn(['plugins', i], true) as unknown
    if (typeof item === 'string' || typeof (item as { value?: unknown })?.value === 'string') {
      // 裸 string 标量节点（keepNode=true 时是 YAMLScalar，value 是字符串值）
      const scalar = item as { value?: unknown }
      const s = typeof item === 'string' ? item : String(scalar.value)
      if (s === pluginName) {
        targetIndex = i
        break
      }
    } else if (item && typeof item === 'object' && 'get' in (item as object)) {
      // 对象条目（YAMLMap）：读 name 键的标量值
      const nameNode = (item as { get: (k: string, keep?: boolean) => unknown }).get('name', true) as
        | { value?: unknown }
        | undefined
      if (nameNode && nameNode.value === pluginName) {
        targetIndex = i
        break
      }
    }
  }
  if (targetIndex === -1) {
    throw new ConfigWriteError('PLUGIN_NOT_IN_CONFIG', `plugin not in config: ${pluginName}`)
  }
  // 探针已验证：plain JS 对象可直接 set，dump 为 name/config map；未触及条目与注释原样保留
  doc.setIn(['plugins', targetIndex], { name: pluginName, config })
  const newYaml = doc.toString()
  // E6 自伤防护：dump 结果必须可再解析，否则拒绝落盘
  const reParsed = parseDocument(newYaml)
  if (reParsed.errors.length > 0) {
    throw new ConfigWriteError('YAML_SELF_HARM', `refusing to write: rendered yaml no longer parses: ${reParsed.errors[0]?.message ?? 'unknown'}`)
  }
  return { newYaml, diff: naiveLineDiff(originalYaml, newYaml) }
}

/** E2 门 + 渲染 + sha（不落盘）。WP2：本函数不做 configSchema 深度校验（形状门在路由层）。 */
export function previewConfigWrite(
  configPath: string,
  pluginName: string,
  config: Record<string, unknown>,
): ConfigWritePreview {
  if (!existsSync(configPath)) {
    throw new ConfigWriteError('CONFIG_FILE_MISSING', `config file not found: ${configPath}`)
  }
  const raw = readFileSync(configPath, 'utf8')
  const { newYaml, diff } = renderConfigYaml(raw, pluginName, config)
  return { valid: true, errors: [], newYaml, yamlSha: sha256Text(raw), diff }
}

/**
 * 两段式 apply（W6/W7）：sha 复核 → .bak 单代备份（覆盖式）→ tmp+rename 原子写。
 * E7：任何写失败清理 tmp 后重抛；.bak 已落则手动可恢复。
 */
export function applyConfigWrite(
  configPath: string,
  pluginName: string,
  config: Record<string, unknown>,
  expectedSha: string,
): ConfigWriteApplyResult {
  if (!existsSync(configPath)) {
    throw new ConfigWriteError('CONFIG_FILE_MISSING', `config file not found: ${configPath}`)
  }
  const raw = readFileSync(configPath, 'utf8')
  if (sha256Text(raw) !== expectedSha) {
    throw new ConfigWriteError('SHA_MISMATCH', 'config changed since preview — re-preview')
  }
  const { newYaml, diff } = renderConfigYaml(raw, pluginName, config)
  const bakPath = `${configPath}.bak`
  writeFileSync(bakPath, raw, 'utf8')
  const tmpPath = join(dirname(configPath), `.${(configPath.split(/[\\/]/).pop() ?? 'config')}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`)
  try {
    writeFileSync(tmpPath, newYaml, 'utf8')
    renameSync(tmpPath, configPath)
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true })
    } catch {
      // tmp 清理失败不影响错误上抛（E7）
    }
    throw err
  }
  return { applied: true, diff, bakPath, yamlSha: sha256Text(newYaml) }
}
```

实现注记（给实现者的裁定，不算偏离）：
- `renderConfigYaml` 里对 YAMLSeq/YAMLMap 节点的类型收窄用结构检查（`'items' in`、`'get' in`）而非 import YAMLSeq/YAMLMap 类——`yaml` 包的类型导出按实际 `d.ts` 核对，若 `Document.Parsed` 断言写法与包类型不符，允许改成 `import type { YAMLSeq, YAMLMap } from 'yaml'` 的正规收窄（探针确认 `doc.get('plugins', true)` 返回 YAMLSeq）。
- `doc.setIn(['plugins', i], { name, config })` 与探针验证的 `seq.set(i, plainObj)` 等价；若 setIn 对标量条目替换行为异常，回落探针原式：`const s = doc.get('plugins', true) as YAMLSeq; s.set(targetIndex, { name: pluginName, config })`。

`packages/config/src/index.ts` 追加导出：

```ts
export { ConfigWriteError, previewConfigWrite, applyConfigWrite, naiveLineDiff, sha256Text, type ConfigWritePreview, type ConfigWriteApplyResult, type ConfigWriteErrorCode } from './writeback'
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/config`
Expected: writeback 10 用例 + Task 1 的 9 用例 + 既有用例全绿

- [ ] **Step 5: 提交**

```bash
git add packages/config/src/writeback.ts packages/config/src/index.ts packages/config/src/__tests__/writeback.test.ts
git commit -m "feat(config): 写回引擎 writeback.ts —— yaml round-trip + naive diff + 原子写 + .bak + sha 防护（W5/W6/W7）"
```

---

### Task 5: dashboard server — PATCH 路由 + configPath 接线 + E1-E7 矩阵测试

**Files:**
- Modify: `packages/dashboard/package.json`（dependencies 加 `"@nx-mk/config": "workspace:*"`）
- Modify: `pnpm-lock.yaml`（`pnpm install` 刷新，随代码同 commit）
- Modify: `packages/dashboard/src/shared/api-types.ts`（末尾追加两个响应类型）
- Modify: `packages/dashboard/src/server/types.ts`（RouteContext 加 `configPath?`）
- Modify: `packages/dashboard/src/server/index.ts`（BuildServerOptions + ctx 透传）
- Modify: `packages/dashboard/src/server/routes/plugins.ts`（PATCH 路由）
- Modify: `packages/cli/src/commands/start.ts:57-60`（buildServer 传 configPath）
- Test: `packages/dashboard/src/__tests__/plugins-config-routes.test.ts`（新）

**Interfaces:**
- Consumes: Task 4 的 `previewConfigWrite`/`applyConfigWrite`/`ConfigWriteError`（从 `@nx-mk/config` 导入）；既有 `buildServer({ nxMkDir, uiDistDir })` 签名
- Produces:
  - `PATCH /api/plugins/:pluginName/config?dryRun=true|false`，body `{ config: Record<string, unknown>, yamlSha?: string }`
  - 200 preview → `ConfigWritePreviewResponse`；200 apply → `ConfigWriteApplyResponse`；E1 400 / E2 409 / E3 409 / E4 404 / E5 409 / E6 500 / E7 500
  - `BuildServerOptions.configPath?: string`（start.ts 必传——发现失败则不传，路由以 409 E2 诚实降级）
  - `ConfigWritePreviewResponse { valid: boolean; errors: string[]; newYaml: string; yamlSha: string; diff: string }`、`ConfigWriteApplyResponse { applied: true; diff: string; bakPath: string; yamlSha: string }`（`shared/api-types.ts`）

- [ ] **Step 1: 依赖接线（先于测试，路由测试需要 import @nx-mk/config）**

`packages/dashboard/package.json` dependencies 按字母序插入：

```json
    "@nx-mk/config": "workspace:*",
```

然后在工作区根跑（workspace 依赖变更必须刷新 lockfile；此处**不用** `--frozen-lockfile`）：

```bash
PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH pnpm install
```

- [ ] **Step 2: 写失败测试**

创建 `packages/dashboard/src/__tests__/plugins-config-routes.test.ts`：

```ts
/**
 * PATCH /api/plugins/:name/config（spec §2.3 + E1-E7 矩阵，WP4 缺省 dryRun=true）。
 * 路由只做形状门 + 错误码映射；写回本体由 @nx-mk/config writeback 承担（WP1）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { buildServer } from '../server/index.js'
import { makeNxMkDir } from './fixtures.js'
import { sha256Text } from '@nx-mk/config'
import type { FastifyInstance } from 'fastify'
import type { ConfigWritePreviewResponse, ConfigWriteApplyResponse } from '../shared/api-types.js'

const BASE_YAML = [
  '# 用户主配置',
  'logLevel: info',
  'plugins:',
  '  # 采集插件',
  "  - '@nx-mk/plugin-playwright'",
  '  - name: \'@nx-mk/plugin-swagger\'',
  '    config:',
  '      maxTurns: 3',
  '',
].join('\n')

// 插件名含 / 与 @ —— 路径参数必须 URL 编码（find-my-way 按 / 分段，%2F 不切段）
const PW = encodeURIComponent('@nx-mk/plugin-playwright')
const SW = encodeURIComponent('@nx-mk/plugin-swagger')

describe('PATCH /api/plugins/:pluginName/config', () => {
  let dir: string
  let configPath: string
  let app: FastifyInstance

  function build(): void {
    app = buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui'), configPath })
  }
  beforeEach(() => {
    dir = makeNxMkDir([])
    configPath = join(dirname(dir), 'nx-mk.config.yml')
    writeFileSync(configPath, BASE_YAML, 'utf8')
  })
  afterEach(async () => {
    await app.close()
    rmSync(dirname(dir), { recursive: true, force: true })
  })

  it('缺省 dryRun=true：200 preview，diff 含 +/-，文件不动（E-门：写不发生）', async () => {
    build()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config`,
      payload: { config: { maxTurns: 9 } },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as ConfigWritePreviewResponse
    expect(body.valid).toBe(true)
    expect(body.yamlSha).toBe(sha256Text(BASE_YAML))
    expect(body.diff).toContain('maxTurns: 9')
    expect(readFileSync(configPath, 'utf8')).toBe(BASE_YAML)
  })

  it('E4：插件不在 plugins 列表 → 404', async () => {
    build()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${encodeURIComponent('ghost-pkg')}/config`,
      payload: { config: {} },
    })
    expect(res.statusCode).toBe(404)
  })

  it('E1：config 非 JSON object → 400', async () => {
    build()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config`,
      payload: { config: 'not-an-object' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('E2：config 文件缺失 → 409', async () => {
    rmSync(configPath)
    build()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config`,
      payload: { config: {} },
    })
    expect(res.statusCode).toBe(409)
  })

  it('E3：config 不可解析 → 409', async () => {
    writeFileSync(configPath, 'plugins: [unclosed', 'utf8')
    build()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config`,
      payload: { config: {} },
    })
    expect(res.statusCode).toBe(409)
  })

  it('apply 全链路：preview → dryRun=false 落盘 + .bak 产生 + 内容变更', async () => {
    build()
    const preview = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config?dryRun=true`,
      payload: { config: { maxTurns: 9 } },
    })
    const { yamlSha } = preview.json() as ConfigWritePreviewResponse
    const apply = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config?dryRun=false`,
      payload: { config: { maxTurns: 9 }, yamlSha },
    })
    expect(apply.statusCode).toBe(200)
    const body = apply.json() as ConfigWriteApplyResponse
    expect(body.applied).toBe(true)
    expect(readFileSync(body.bakPath, 'utf8')).toBe(BASE_YAML)
    expect(readFileSync(configPath, 'utf8')).toContain('maxTurns: 9')
  })

  it('E5：apply 带过期 sha → 409，文件保持原样', async () => {
    build()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config?dryRun=false`,
      payload: { config: {}, yamlSha: 'deadbeef' },
    })
    expect(res.statusCode).toBe(409)
    expect(readFileSync(configPath, 'utf8')).toBe(BASE_YAML)
    expect(existsSync(`${configPath}.bak`)).toBe(false)
  })

  it('apply 缺 yamlSha → 400（两段式的门）', async () => {
    build()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config?dryRun=false`,
      payload: { config: {} },
    })
    expect(res.statusCode).toBe(400)
  })

  it('configPath 未接线（start 未发现配置文件）→ 409 诚实降级', async () => {
    app = buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui') })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config`,
      payload: { config: {} },
    })
    expect(res.statusCode).toBe(409)
  })
})
```

（若 `%2F` 编码路径参数在 find-my-way 下不匹配——用第一个用例实测，若 404 route-miss，裁定回落方案：路由注册为 `app.patch('/api/plugins/:pluginName/config'…)` 不变，但 inject 的 url 换成把插件名放进 query `?plugin=…` 是**不允许**的（spec 钉死 path 参数）；正确回落是给路由加 `constraints` 或改用通配 `/api/plugins/*` 手工解析后缀。先实测编码方案，find-my-way 对 param 内 `%2F` 的支持以实测为准，实测结论记入 ledger。）

- [ ] **Step 3: 跑测试确认失败**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/dashboard/src/__tests__/plugins-config-routes.test.ts`
Expected: FAIL —— PATCH 路由不存在（404 route-miss）、`configPath` 不是 BuildServerOptions 字段（typecheck 失败）、`sha256Text` 无法从 @nx-mk/config 导入（Task 4 已导出则此半通过）

- [ ] **Step 4: 实现**

**`packages/dashboard/src/shared/api-types.ts`** 末尾追加：

```ts
/** PATCH /api/plugins/:name/config?dryRun=true 响应（spec §2.1/§2.3；WP2：errors 恒 []，形状门在路由层） */
export interface ConfigWritePreviewResponse {
  valid: boolean
  errors: string[]
  newYaml: string
  yamlSha: string
  diff: string
}

/** PATCH …?dryRun=false 响应（W6：.bak 单代备份 + 原子写） */
export interface ConfigWriteApplyResponse {
  applied: true
  diff: string
  bakPath: string
  yamlSha: string
}
```

**`packages/dashboard/src/server/types.ts`** —— `RouteContext` 增加：

```ts
  /** 用户主配置文件绝对路径（start 命令发现后透传；缺省 = 写回 API 以 409 诚实降级） */
  configPath?: string
```

**`packages/dashboard/src/server/index.ts`** —— `BuildServerOptions` 增加 `configPath?: string`（带同款注释）；ctx 装配行（现第 30 行）改为：

```ts
  const ctx = {
    nxMkDir: opts.nxMkDir,
    ...(opts.configPath !== undefined ? { configPath: opts.configPath } : {}),
    ...(opts.busyTimeoutMs !== undefined ? { busyTimeoutMs: opts.busyTimeoutMs } : {}),
  }
```

**`packages/dashboard/src/server/routes/plugins.ts`** 整文件改写为（头注释同步更新——移除"无写回（R6：PATCH 推 v1）"）：

```ts
/**
 * GET /api/plugins（Phase 4.5 R6）+ PATCH /api/plugins/:name/config（v1 W1/W2）。
 * 路由只做形状门（E1）+ 错误码映射（E2-E7 → HTTP）；写回本体在 @nx-mk/config writeback（WP1，
 * dashboard server 铁律白名单仍只有 replay.ts 一个写文件者）。
 */
import type { FastifyInstance } from 'fastify'
import type { RouteContext } from '../types.js'
import { readPluginsManifest } from '../store/plugins-reader.js'
import { previewConfigWrite, applyConfigWrite, ConfigWriteError } from '@nx-mk/config'
import type { ConfigWritePreviewResponse, ConfigWriteApplyResponse } from '../../shared/api-types.js'

// ConfigWriteErrorCode → HTTP（spec §3：E2/E3/E5 409、E4 404、E6 500；E1 形状门在下方独立处理）
function statusForWriteError(code: ConfigWriteError['code']): number {
  if (code === 'PLUGIN_NOT_IN_CONFIG') return 404
  if (code === 'YAML_SELF_HARM') return 500
  return 409
}

export function registerPluginRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/plugins', async () => readPluginsManifest(ctx.nxMkDir))

  app.patch('/api/plugins/:pluginName/config', async (req, reply) => {
    // configPath 未接线（start 未发现配置文件）→ 与 E2 同语义诚实降级（WP 裁定）
    if (!ctx.configPath) {
      return reply.code(409).send({ error: 'config file not found' })
    }
    const { pluginName } = req.params as { pluginName: string }
    const body = (req.body ?? {}) as { config?: unknown; yamlSha?: unknown }
    // E1（WP2 形状门）：config 必须是 JSON object；深度 configSchema 校验在 kernel 下次 run fail-fast
    if (typeof body.config !== 'object' || body.config === null || Array.isArray(body.config)) {
      return reply.code(400).send({ error: 'config must be a JSON object', errors: ['config must be a JSON object'] })
    }
    // WP4：缺省 dryRun=true（安全默认）；仅显式 false 才落盘
    const dryRun = (req.query as { dryRun?: string }).dryRun !== 'false'
    if (!dryRun && typeof body.yamlSha !== 'string') {
      return reply.code(400).send({ error: 'yamlSha required for apply (preview first)' })
    }
    try {
      if (dryRun) {
        const preview = previewConfigWrite(ctx.configPath, pluginName, body.config as Record<string, unknown>)
        return preview satisfies ConfigWritePreviewResponse
      }
      const result = applyConfigWrite(
        ctx.configPath,
        pluginName,
        body.config as Record<string, unknown>,
        body.yamlSha as string,
      )
      return result satisfies ConfigWriteApplyResponse
    } catch (err) {
      if (err instanceof ConfigWriteError) {
        return reply.code(statusForWriteError(err.code)).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })
}
```

**`packages/cli/src/commands/start.ts`** —— import 区追加 `import { findConfigFile } from '@nx-mk/config'`（cli 已依赖 @nx-mk/config，若实际未依赖则同款 workspace 依赖 + pnpm install——先 grep `packages/cli/package.json` 确认）；`buildServer` 调用（第 57-60 行）改为：

```ts
  // v1 写回链：把用户配置文件绝对路径透传给 dashboard（发现失败不阻断 start，API 侧 409 诚实降级）
  let configPath: string | undefined
  try {
    configPath = opts.configPath !== undefined
      ? join(cwd, opts.configPath)
      : await findConfigFile(cwd)
  } catch {
    configPath = undefined
  }

  const server = buildServer({
    nxMkDir: join(cwd, '.nx-mk'),
    uiDistDir: resolveUiDistDir(),
    ...(configPath !== undefined ? { configPath } : {}),
  })
```

（`opts.configPath` 若本就是绝对路径，`join(cwd, abs)` 在 win32 下返回绝对路径本身——行为正确，无需分支。）

- [ ] **Step 5: 跑测试确认通过 + dashboard 全量回归**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/dashboard`
Expected: 新文件 9 用例 PASS；plugins-manifest-routes/replay 等既有用例零回归

- [ ] **Step 6: typecheck + 提交**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH pnpm -r typecheck`
Expected: 全绿

```bash
git add packages/dashboard pnpm-lock.yaml packages/cli/src/commands/start.ts
git commit -m "feat(dashboard): PATCH /api/plugins/:name/config 两段式写回路由 + configPath 接线（W2/E1-E7）"
```

---

### Task 6: dashboard UI — PluginSettings 编辑器（JSON textarea → Preview diff → Apply）

**Files:**
- Modify: `packages/dashboard/src/ui/api.ts`（追加 `patchJson`，镜像 `postJson` 形状）
- Modify: `packages/dashboard/src/ui/pages/PluginSettings.tsx`（编辑器）
- Test: `packages/dashboard/src/__tests__/plugin-settings-editor.test.ts`（新）

**Interfaces:**
- Consumes: Task 5 的 `PATCH` 路由与 `ConfigWritePreviewResponse`/`ConfigWriteApplyResponse` 类型
- Produces: `patchJson<T>(path: string, body: unknown, fetchImpl?: typeof fetch): Promise<T>`（`ui/api.ts`）；`PluginSettings.tsx` 导出 `ConfigEditor`（供测试渲染）

- [ ] **Step 1: 写失败测试**

创建 `packages/dashboard/src/__tests__/plugin-settings-editor.test.ts`：

```ts
/**
 * PluginSettings v1 编辑器（WP3：JSON textarea；两段式 Preview→Apply）。
 * node 渲染环境只做 renderToString 冒烟——交互链路由 T5 的 inject 矩阵覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../ui/hooks', () => ({
  usePolling: vi.fn(),
  useEventSource: () => ({ connected: false }),
}))
const { usePolling } = await import('../ui/hooks')
const { PluginSettingsPage, ConfigEditor } = await import('../ui/pages/PluginSettings')

const ENTRY = {
  name: '@nx-mk/plugin-swagger',
  version: '0.1.0',
  enabled: true,
  config: { maxTurns: 3 },
  configSchema: null,
}

beforeEach(() => {
  vi.mocked(usePolling).mockReturnValue({
    data: { stale: false, plugins: [ENTRY] },
    error: null,
    refresh: () => {},
  } as never)
})

describe('PluginSettingsPage（v1 编辑器）', () => {
  it('渲染 Edit config 入口 + 不再声明 read-only（旧文案退场）', () => {
    const html = renderToString(<PluginSettingsPage />)
    expect(html).toContain('Edit config')
    expect(html).not.toContain('write-back lands in v1')
  })
})

describe('ConfigEditor', () => {
  it('textarea 预填当前 per-plugin config 的 JSON；含 Preview/Apply 按钮', () => {
    const html = renderToString(<ConfigEditor name={ENTRY.name} initial={ENTRY.config} />)
    expect(html).toContain('&quot;maxTurns&quot;')
    expect(html).toContain('Preview')
    expect(html).toContain('Apply')
  })

  it('initial 为 null/undefined → 空对象预填', () => {
    const html = renderToString(<ConfigEditor name="p" initial={null} />)
    expect(html).toContain('textarea')
  })
})
```

（页面组件若经 `usePolling` 泛型/返回类型不匹配导致 `as never` 断言报错，按 `usePolling<PluginsResponse>` 实际返回类型 `{ data, error, refresh }` 调整 mock 返回值结构——不改断言。）

- [ ] **Step 2: 跑测试确认失败**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/dashboard/src/__tests__/plugin-settings-editor.test.ts`
Expected: FAIL —— `ConfigEditor` 未导出、页面无 'Edit config' 文案、`patchJson` 尚不存在（页面未消费不报错，该断言在交互链由 T5 覆盖）

- [ ] **Step 3: 实现**

**`packages/dashboard/src/ui/api.ts`** —— `postJson` 之后镜像追加：

```ts
/** PATCH JSON（v1 写回链 W2）；错误处理与 postJson 同构 */
export async function patchJson<T>(path: string, body: unknown, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await fetchImpl(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let errBody: unknown = null
    try {
      errBody = await res.json()
    } catch {
      // 空/非 JSON body 容忍
    }
    throw new ApiError(res.status, errBody)
  }
  return res.json() as Promise<T>
}
```

**`packages/dashboard/src/ui/pages/PluginSettings.tsx`** —— 页面级改动：

1. import 区追加：

```ts
import { ApiError, patchJson } from '../api'
import type { ConfigWritePreviewResponse, ConfigWriteApplyResponse } from '../../shared/api-types'
```

2. `PluginSettingsPage` 返回区里 `<p className="empty">read-only — YAML snippets are for reference; write-back lands in v1.</p>` 替换为：

```tsx
      <p className="empty">Edit per-plugin config — Preview shows the YAML diff; Apply writes nx-mk.config.yml (a .bak backup is kept). Takes effect on the next run.</p>
```

3. `PluginCard` 追加编辑入口（保留既有 Copy YAML 区块不动）：

```tsx
function PluginCard({ entry }: { entry: PluginEntryView }) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const snippet = yamlSnippet(entry)
  return (
    <div className="section">
      <h2>
        {entry.name} <span className="badge">v{entry.version}</span>{' '}
        {entry.enabled ? <span className="badge">enabled</span> : null}
      </h2>
      {entry.configSchema === null ? <p className="empty">No schema exposed</p> : null}
      <pre>{snippet}</pre>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(snippet).then(() => setCopied(true))
        }}
      >
        {copied ? 'Copied!' : 'Copy YAML'}
      </button>{' '}
      <button onClick={() => setEditing(!editing)}>Edit config</button>
      {editing ? <ConfigEditor name={entry.name} initial={entry.config} /> : null}
    </div>
  )
}
```

4. 文件尾部追加编辑器（`ConfigEditor` **具名导出**）：

```tsx
/** v1 编辑器（WP3）：JSON ⊂ YAML，textarea 以 JSON 编辑 per-plugin config；两段式 Preview→Apply（W2）。 */
export function ConfigEditor({ name, initial }: { name: string; initial: unknown }) {
  const [text, setText] = useState(() => {
    try {
      return JSON.stringify(initial ?? {}, null, 2)
    } catch {
      return '{}'
    }
  })
  const [preview, setPreview] = useState<ConfigWritePreviewResponse | null>(null)
  const [applied, setApplied] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const parseConfig = (): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(text) as unknown
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>
      setErr('config must be a JSON object')
      return null
    } catch (e) {
      setErr(`invalid JSON: ${(e as Error).message}`)
      return null
    }
  }

  const doPreview = async (): Promise<void> => {
    const cfg = parseConfig()
    if (!cfg) return
    setErr(null)
    try {
      setPreview(await patchJson<ConfigWritePreviewResponse>(`/api/plugins/${encodeURIComponent(name)}/config?dryRun=true`, { config: cfg }))
    } catch (e) {
      setErr(e instanceof ApiError ? `preview failed: ${e.detailMessage}` : String(e))
    }
  }

  const doApply = async (): Promise<void> => {
    const cfg = parseConfig()
    if (!cfg || !preview) return
    setErr(null)
    try {
      const r = await patchJson<ConfigWriteApplyResponse>(
        `/api/plugins/${encodeURIComponent(name)}/config?dryRun=false`,
        { config: cfg, yamlSha: preview.yamlSha },
      )
      setPreview(null)
      setApplied(`applied — takes effect on the next nx-mk run (backup: ${r.bakPath})`)
    } catch (e) {
      // E5 常见态：提示重新 preview
      setErr(e instanceof ApiError ? `apply failed: ${e.detailMessage} — re-preview and retry` : String(e))
    }
  }

  return (
    <div className="section">
      <p className="empty">config is JSON (valid YAML) for plugin {name}</p>
      <textarea rows={8} cols={60} value={text} onChange={(e) => setText(e.target.value)} />
      <div>
        <button onClick={() => void doPreview()}>Preview</button>{' '}
        <button onClick={() => void doApply()} disabled={preview === null}>Apply</button>
      </div>
      {err ? <p className="error">{err}</p> : null}
      {preview ? (
        <div>
          <p className="empty">preview diff (not written yet):</p>
          <pre>{preview.diff}</pre>
        </div>
      ) : null}
      {applied ? <p className="empty">{applied}</p> : null}
    </div>
  )
}
```

5. 若 `packages/dashboard/src/__tests__/pages.test.ts` 有断言旧 read-only 文案的用例（grep `write-back lands in v1`），同步改为断言新文案子串 `Edit per-plugin config`。

- [ ] **Step 4: 跑测试确认通过 + 全 UI 回归**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/dashboard`
Expected: 新 3 用例 + pages.test / ui-phase45 等既有用例全绿（若 vi.mock 工厂缺导出导致其他测试文件报错——按 T6/V6 先例在其 mock 工厂补一行）

- [ ] **Step 5: 提交**

```bash
git add packages/dashboard/src/ui packages/dashboard/src/__tests__/plugin-settings-editor.test.ts packages/dashboard/src/__tests__/pages.test.ts
git commit -m "feat(dashboard-ui): PluginSettings 编辑器 —— JSON textarea → Preview diff → Apply（W2/WP3）"
```

---

### Task 7: 收尾 — 全仓验证 + 铁律 grep + 验收记录

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-nx-mk-v1-plugin-config-writeback-design.md`（§5 末尾追加"实现裁定记录"小节，把 WP1-WP7 + E6 未测声明落回 spec 文档）
- 无代码改动（除非验证暴露回归）

**Interfaces:**
- Consumes: Task 1-6 全部产物
- Produces: 绿基线 + 验收证据

- [ ] **Step 1: 全套测试 + typecheck**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run`
Expected: 全绿；计数 ≥ 543 + 31（T1:9 + T2:6 + T3:3 + T4:10 + T5:9 + T6:3 ≈ +40，spec 预算 ~578±10 容差内）

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH pnpm -r typecheck`
Expected: 零回归

- [ ] **Step 2: 铁律 grep（W8/WP1 修订版）**

Run: `grep -rn "writeFileSync\|renameSync\|appendFileSync\|createWriteStream" packages/dashboard/src/server/ --include="*.ts" | grep -v __tests__ | grep -v "\.d\.ts"`
Expected: 命中恰在 `server/replay.ts`（1 个源文件）——dashboard server 无新增写文件者；config.yml 唯一写者是 `packages/config/src/writeback.ts`（另跑 `grep -rln "renameSync" packages/config/src --include="*.ts"` 确认只此一处）

- [ ] **Step 3: E6 未测声明核验**

`writeback.test.ts` 无 E6 直接用例（WP 裁定：JSON-safe 输入无法触达 dump→reparse 失败路径，属 defense-in-depth）——确认 `ConfigWriteError('YAML_SELF_HARM', …)` 代码存在于 writeback.ts 且路由映射 500 分支被 `statusForWriteError` 覆盖（代码审读即可），记入 ledger。

- [ ] **Step 4: spec 文档追加实现裁定记录**

在 spec §5 验收之后追加：

```markdown
## 6. 实现裁定记录（SDD 执行期）

- WP1：写回引擎落 `packages/config/src/writeback.ts`（config 包拥有 yaml 依赖）；dashboard 经 `@nx-mk/config: workspace:*` 消费。W8 修订：dashboard server fs 写白名单仍恰 1 文件（replay.ts）——config.yml 唯一写者在 config 包，强度只增不减。
- WP2：E1 深度 configSchema 校验 v1 降为形状门（JSON object）；真实校验在 kernel 下次 run fail-fast（PLUGIN_CONFIG_INVALID）。理由：manifest 只有 JSON Schema 无 validator，深度校验需 ajv（破 D2）。
- WP3：编辑器 textarea 用 JSON（JSON ⊂ YAML），dashboard 不引入 yaml 解析。
- WP4：dryRun 缺省 true（安全默认）。
- WP5：kernel `validateConfigSchema` 导出以便单测钉死 W4' 反转。
- WP6：manifest 条目 config：在 plugins 列表 → 条目 config；不在 → null。
- WP7：kernel 与 config 各持一份 normalizePluginEntries（结构镜像，kernel 不硬依赖 config 包）。
- E6（YAML_SELF_HARM）为 defense-in-depth 路径，JSON-safe 输入不可触达，无直接单测（代码审读核验）。
```

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/specs/2026-09-20-nx-mk-v1-plugin-config-writeback-design.md
git commit -m "docs(spec): v1 写回链实现裁定记录（WP1-WP7 + E6 未测声明）"
```

---

## 验收对照（spec §5）

| spec 验收项 | 覆盖任务 |
|---|---|
| 1. 全套 vitest 绿（→ ~578±10）+ typecheck 零回归 | T7 Step 1 |
| 2. demo 手动验收（Edit → Preview diff 含注释 → Apply → .bak → run 读新值） | 链路 T1-T6；手动步骤：`pnpm nx run @nx-mk/cli:build` 后 `node packages/cli/dist/index.js start` → 浏览器 /settings/plugins → Edit config 改 maxTurns → Preview（确认 diff 中 `# 采集插件` 注释原样）→ Apply → 检查 `nx-mk.config.yml` 与 `.bak` → `nx-mk run` 生效 |
| 3. 铁律 grep 白名单（W8/WP1 修订：dashboard server 恰 1 写文件者） | T7 Step 2 |
| 4. 向后兼容：string[] config 全流程可用 | T1 用例 1 + loader.test 既有 fixtures + T2 Step 4 kernel 全绿 |
| 5. D2 五依赖不破（yaml 在 config 包已有；dashboard 只加 workspace 内部依赖） | T5 Step 1（package.json diff 审查：external deps 零变化） |
