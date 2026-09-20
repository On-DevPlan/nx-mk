# nx-mk Spec: v1 — Plugin Config 写回链（PATCH /api/plugins/:name/config，两段式 preview→apply）

> 日期：2026-09-20
> 范围：plugin config 写回链——`plugins` 配置格式扩展为 per-plugin 命名空间（向后兼容 string[]）、kernel per-plugin 校验输入、dashboard 两段式写回 API（dryRun preview → apply）、PluginSettings 页 YAML 编辑器（Preview/Apply）
> 不在范围：多代备份/rollback 路由（用户裁定放弃）；plugin-swagger 的 per-plugin 迁移（无可编辑旋钮，YAGNI）；YAML 编辑器语法高亮（textarea 够用）；agent 段/policy 段的编辑（只 plugin config）
> 关联文档：
> - `docx/plan/nx-mk-plan.md` §31（KernelPlugin configSchema + GET/PATCH /api/plugins 原文）
> - `docs/superpowers/specs/2026-09-20-nx-mk-phase45-dashboard-ops-design.md`（R6 留白：PATCH 推 v1；V5 裁定：v0 config=全量快照）
> - Phase 4.5 代码现状：`packages/dashboard/src/server/routes/plugins.ts`（只读 GET）、`server/store/plugins-reader.ts`、`ui/pages/PluginSettings.tsx`

---

## 1. 目标与裁定记录

### 1.1 一句话

用户在 dashboard 编辑任一插件的 config：Preview 出 YAML diff（不落盘），Apply 原子写回 `nx-mk.config.yml`（写前留 .bak），生效于下次 `nx-mk run`。

### 1.2 用户裁定记录（2026-09-20 两问两答）

| # | 问题 | 裁定 |
|---|---|---|
| W1 | PATCH 写回对象（当前无 per-plugin 命名空间） | **引入 per-plugin 配置**：`plugins` 扩为联合类型 `string \| {name, config}`；改动面最大但语义最干净，是 §31 原文预设方向 |
| W2 | diff 预览编排 | **两段式 preview→apply**：`PATCH ?dryRun=true` 生成 diff 不落盘；确认后 `dryRun=false` 才真写。UI 两段确认门 |

### 1.3 本期设计裁定（spec 级）

| # | 裁定 | 理由 / 代价 |
|---|---|---|
| W3 | `plugins` 联合类型向后兼容：裸 string 条目 config 视为 `{}`；schema 用 `z.union` + 归一化函数 `normalizePluginEntries()` 供 kernel 消费 | 现存所有 config 文件零破坏 |
| W4 | V5'（V5 修订）：v1 起 `loadPlugins`/`validateConfigSchema` 校验输入为**该条目的 per-plugin config 对象**，不再是全量 ResolvedConfig；`plugins-manifest.json` 条目 `config` 字段同步改为 per-plugin config | 全量快照语义废弃；两插件现无 configSchema，零迁移成本（已核实） |
| W5 | YAML 写回用 **`yaml` 包 round-trip**（repo 既有依赖，config 包已用）：解析保留注释与格式，仅替换目标插件条目 | 手写字符串拼接会砸注释；JSON.stringify 不可行（目标是 YML） |
| W6 | apply 原子性：tmp 文件 + rename 覆盖；写前留单代 `.bak`（`nx-mk.config.yml.bak` 覆盖式） | rename 同目录原子；单代备份是 v1 语义（多代已裁定放弃） |
| W7 | 并发保护：apply 前比对 config.yml 的 sha（preview 时返回给 UI，apply 时回传校验）；不符 → 409 要求重新 preview | 防 preview 与 apply 之间文件被外部修改 |
| W8 | 铁�律修订（R12）：dashboard server 写路径白名单 = `replay.ts`（.nx-mk/replays/） + `config-write.ts`（用户 config.yml，R6 兑现）。grep 核查表达式不变，白名单文件数 1→2 | config.yml 是用户文件非三来源产物，语义符合铁律精神 |

## 2. 架构

### 2.1 数据流

```
【Preview】PluginSettings 卡片 [Edit config] → textarea 编辑 YAML 片段
  PATCH /api/plugins/:name/config?dryRun=true {config, yamlSha?}
  server config-write.ts：读 config.yml（yaml round-trip）
    → 定位目标插件条目 → 合并新 config → dump 新 YML 文本 → unified diff
    → 校验（有 configSchema 则 validate；无 schema 则形状门 only）
    → 200 {valid, errors?, newYaml, yamlSha, diff}（不落盘）

【Apply】UI [Apply] → PATCH ?dryRun=false
  校验（同 preview）→ sha 复核（不符 409）
    → writeFileSync(nx-mk.config.yml.bak, 原文) → tmp+rename 原子写新 YML
    → 200 {applied: true, diff, bakPath}
    （plugins-manifest.json 旧值保留至下次 run 由 kernel 重写——stale 语义已由 E4 标志覆盖）

【Kernel 消费】loadPlugins(names→entries) 读 per-plugin config
  → validateConfigSchema(plugin, perPluginConfig)（W4 反转）
  → initPlugins 后 plugins-manifest 写 per-plugin config（V5'）
```

### 2.2 包改动面

```
packages/config/src/          # schema 扩展（联合类型）+ normalizePluginEntries 导出（~40 行）
packages/kernel/src/          # loadPlugins 入参 + validateConfigSchema 输入改 per-plugin（~20 行）
packages/plugin-playwright/src/  # 装配读 per-plugin config，缺省回落顶层 collect:（~15 行）
packages/dashboard/src/
  server/config-write.ts      # 新：round-trip 定位/合并/dump/diff/原子写/备份（核心新模块）
  server/routes/plugins.ts    # 追加 PATCH 路由（~80 行）
  server/index.ts              # BuildServerOptions 加 configPath?（start 命令透传）
  ui/pages/PluginSettings.tsx  # Edit config → textarea → Preview(diff) → Apply（~120 行）
packages/cli/src/commands/start.ts  # buildServer 调用传 configPath
```

### 2.3 API 增量

```
PATCH /api/plugins/:pluginName/config?dryRun=true|false    # ✅ 本期（W1/W2 五步）
GET  /api/plugins                                           # 既有（4.5），响应不变
PATCH /api/plugins/:pluginName/rollback                     # ❌ 多代回滚弃
```

请求 body：`{ config: Record<string, unknown>, yamlSha?: string }`（yamlSha 为 preview 返回的写前文件 sha，apply 时必传）。

## 3. 错误处理

| # | 场景 | 行为 |
|---|---|---|
| E1 | config 校验失败（有 configSchema → zod/schema 错误；无 schema → 仅联合类型/形状门） | 400 + errors 列表（preview/apply 同门） |
| E2 | config.yml 缺失 | 409 `config file not found`（不自动创建） |
| E3 | config.yml 不可解析（round-trip 失败） | 409 `config file unparseable` |
| E4 | 目标插件名不在 plugins 列表 | 404 `plugin not in config` |
| E5 | apply 时 yamlSha 与盘上不符（外部修改） | 409 `config changed since preview — re-preview` |
| E6 | 新 YAML dump 后 round-trip 再解析失败（防自伤） | 500 + tmp 清理，不落盘 |
| E7 | 写失败 | 500 + tmp 清理；.bak 已落，手动可恢复 |

## 4. 测试策略

| 层 | 要点 |
|---|---|
| config schema | 联合类型解析（string/对象/非法形状）+ normalizePluginEntries 输出形状 |
| kernel | loadPlugins 收 per-plugin config 入 validateConfigSchema（可用假 configSchema 插件断言收到的是条目 config 而非全量） |
| round-trip | 注释保留 / 仅目标条目变更 / 对象条目插入与替换 / E3 不可解析 |
| config-write | preview 不落盘 / diff 形状 / .bak 产生与内容 / tmp+rename 原子性 / E5 sha 失配 / E6 自伤防护 |
| 路由 | PATCH 全矩阵（E1-E7）+ dryRun=true/false 行为分叉 |
| UI | 编辑器渲染 + preview diff 显示 + apply 成功态（node renderToString） |

预计 +35±10 测试（当前 543 → ~578）。

## 5. 验收

1. 全套 vitest 绿（543 → ~578±10）+ `pnpm -r typecheck` 零回归
2. demo 手动验收：起服务 → /settings/plugins → Edit plugin-playwright config 改 maxTurns → Preview 显示 diff（含注释行原样保留）→ Apply → `nx-mk.config.yml.bak` 产生 + YML 内 config 变更 → `nx-mk run` 读取新值
3. 铁律 grep：dashboard server 写路径白名单 = `replay.ts` + 新 `config-write.ts`（恰 2 文件）
4. 向后兼容核查：现存未改格式 config 文件（string[]）全流程可用（schema 解析 + approve + run 零报错）
5. D2 五依赖不破（yaml 依赖 config 包已有，dashboard 不新增）
