# nx-mk Spec: 插件中心真实安装（zip 上传 / npm 安装）

> 日期：2026-10-03
> backlog 条目：**C17**（unique open item）——「dashboard upload zip（解压到 .nx-mk/plugins/）与 npm 安装指令执行 —— 新运行时功能，带安全面（路径穿越防护、包校验、npm registry 依赖）」
> 范围：让 `#/plugins` 安装区从 disabled 占位变为可用的真实安装 —— 上传 zip → 安全预检 → 落盘 → 记录安装清单；并给出卸载通路
> 不在范围：插件市场 / 远程索引 / 签名信任体系 / 依赖自动安装 / 插件热加载 / 权限模型（dashboard 恒绑 127.0.0.1 单用户）
> 关联文档：
> - `docx/plan/nx-mk-plan.md` §30（dashboard 设置面）、§5.1（CLI 子命令面）
> - `docs/hygiene-backlog.md` C17 行
> - `docs/superpowers/specs/2026-09-20-nx-mk-v1-plugin-config-writeback-design.md`（v1 插件配置写回，本 spec 的写盘纪律参照）

---

## 1. 目标与范围

### 1.1 一句话

用户在 dashboard 的插件中心**上传一个插件 zip**（或未来的 npm 包名），nx-mk 在**不执行任何脚本**的前提下把插件安全解压到 `<projectRoot>/.nx-mk/plugins/<name>/`，记录安装清单（含原始字节 sha256），并让后续 `nx-mk run` / `loop` 能按 config 的 `plugins:` 声明加载它。

### 1.2 背景（现状与代码锚点）

| 现状 | 锚点 |
|---|---|
| 安装区是 disabled 占位，文案明说「需专门安全裁定」 | `packages/dashboard/src/ui/pages/PluginCenter.tsx:58-63` |
| 插件**只能按 npm 包名加载**：`import(name)` → 取 `default`/`createPlugin` → `validateShape` → `validatePackageMatch`（对照包内 package.json） | `packages/kernel/src/plugin-registry.ts:55-101, 229-257` |
| 插件名合法门（拦路径穿越） | `plugin-registry.ts:30` `PLUGIN_NAME_RE` |
| CLI 已有「代码装配」通路：`extraPlugins: Plugin[]` + `excludePluginNames`（plugin-playwright 走此路） | `packages/cli/src/commands/run.ts:109-136` |
| dashboard server 写盘铁律：本包白名单**恰 1 文件** `server/replay.ts`；新写盘需求必须落在**其他包**（先例：scenario trail 写盘归 `@nx-mk/scenario`） | `packages/dashboard/src/server/routes/plugins.ts:4`、`routes/scenarios.ts:4` |
| 已装列表数据源：kernel 产出的 `plugins-manifest.json` | `packages/kernel/src/plugins-manifest.ts`、`dashboard/src/server/store/plugins-reader.ts` |

**结论（本 spec 的两个硬前提）**：
1. **写盘者必须落在 dashboard 包之外** —— 新增内部包 `@nx-mk/plugin-install` 承担全部 fs 写，dashboard 路由只做「形状门 + 委派 + 错误映射」（与 settings/plugins 路由同构）。
2. **zip/tar 解析没有内置能力，且 D2 铁律禁止新增外部 npm 包** —— 需要**自写最小 ZIP reader**（`node:zlib` 的 `inflateRaw` 即可解 deflate 条目），tar 线同理（见 §6 开放问题 Q2）。

### 1.3 非目标（v1 明确不做）

- 插件市场 / 远程 registry 索引 / 版本发现（`npm view` 类查询）
- 数字签名 / 供应链信任链（只做 sha256 记录与可选 pin）
- **执行 npm 生命周期脚本**（`postinstall` 等）：本 spec 全程不执行任何来自包的代码，除「用户显式声明加载」时的 `import`
- 依赖自动安装：插件必须自包含（打到 zip 里）或走 npm 线安装到 node_modules
- 插件热加载 / 运行时启用：装 ≠ 启用，启用仍靠 config `plugins:` 声明 + 下次 run
- Windows 打包格式（rar/7z）、多文件上传、断点续传

---

## 2. 设计

### 2.1 新包布局

```
packages/plugin-install/                 # @nx-mk/plugin-install —— 唯一的插件安装写者
├── src/
│   ├── zip-reader.ts        # 最小 ZIP 读取器：central directory 解析 + deflate/stored 解压（node:zlib）
│   ├── safety.ts            # 条目名/类型/尺寸/压缩比校验（纯函数，恶意样本矩阵可直测）
│   ├── installer.ts         # inspect()（只读预检）+ install()（tmp + rename 原子落盘）+ uninstall()
│   ├── lockfile.ts          # .nx-mk/plugins/plugins-lock.json 读写（安装清单 = 审计真源）
│   ├── errors.ts            # PluginInstallError（code → 语义，映射到 HTTP 由 dashboard 侧做）
│   └── index.ts
└── __tests__/{zip-reader,safety,installer,lockfile}.test.ts
```

> 依赖方向：`plugin-install` 只依赖 `node:*` 与 `@nx-mk/kernel`（错误原语）。**不依赖 dashboard**（保持写者独立）。

### 2.2 落点与加载通路（核心裁定）

- **落盘目录**：`<projectRoot>/.nx-mk/plugins/<pluginName>/`（含完整包结构：`package.json` + `dist/` + 资源）。
- **加载通路（三选一，见 §6 Q3；本 spec 推荐 A）**：
  - **A（推荐）**：`LoadPluginsOptions` 增 `dirs?: string[]`——解析顺序 `dirs`（`<dir>/<name>/package.json` 存在 → 以其 `main`/`exports` 的**绝对路径** import）→ 未命中回落既有 `import(name)` npm 解析。复用同一 `validateShape` / `validateConfigSchema`；`validatePackageMatch` 在 dirs 命中时改为读该目录的 `package.json`（同一函数加一个 path 参数）。
  - B：CLI 侧把已装插件构造成 `extraPlugins`（`run.ts` 已有此缝），kernel 不动 —— 但 `run`/`loop`/`start` 三处都要各自装配，装配面分叉。
  - C：装到项目 `node_modules/`（等同 `npm install` 语义）—— 满足 npm 线但破坏 zip 离线场景的目录隔离，且卸载要动 node_modules。
- **启用语义**：安装只落盘 + 记 lock；**不自动改 config**。UI 在安装成功后给出可复制的 `plugins:` 片段（用户自行写入，或用既有 v1 配置写回链的插件条目能力），下次 `nx-mk run` 生效。

### 2.3 安全设计（zip 通道，逐条可测）

预检（`inspect()`，只读，不落盘）与解压（`install()`）**共用同一校验函数**，避免 TOCTOU 双实现：

| # | 风险 | 规则 |
|---|---|---|
| S1 | 路径穿越（zip slip） | 条目名拒绝：绝对路径、盘符前缀、含 `..` 段、含 `\0`、含反斜杠（统一按 `/` 校验并拒绝 `\`）；解析后 `resolve(dest, name)` 必须仍在 `dest` 内（前缀 + 分隔符校验） |
| S2 | 符号链接逃逸 | 仅接受 unix mode 为 regular file / directory 的条目；`S_IFLNK`（symlink）、hardlink 条目**直接拒绝**（不尝试解） |
| S3 | zip bomb | 单文件解压上限 `MAX_FILE_BYTES`（默认 20 MiB）、总解压上限 `MAX_TOTAL_BYTES`（默认 80 MiB）、条目数上限 `MAX_ENTRIES`（默认 2000）、单条目压缩比上限 `MAX_RATIO`（默认 200:1） |
| S4 | 覆盖攻击 / 目录逃逸 | 目标目录 `<root>/.nx-mk/plugins/<name>`，`<name>` 必须过 `PLUGIN_NAME_RE`（复用 kernel 的同一正则）；目标已存在 → **fail-closed 需显式 `overwrite: true`**（UI 二次确认） |
| S5 | 原子性 / 并发 | 先解到 `<root>/.nx-mk/plugins/.staging-<random>/`，全量校验通过后 `rename` 到目标；`.install-lock` 文件防并发安装（存在即 409） |
| S6 | 部分落盘 | 任一步失败 → 删 staging，目标目录不留痕（对齐 analyzer 三表事务的「失败零落库」语义） |
| S7 | 身份冒用 | 必需 `package.json`：`name` 合法且与安装名一致、`version` 非空；入口（`main`/`exports`/`module` 任一）存在且落在包内 |
| S8 | 不可信代码 | **不执行** zip 内任何脚本/二进制；解压不 chmod +x；仅「用户声明 `plugins:` + run」时才 `import` |

### 2.4 安装清单（审计真源）

`.nx-mk/plugins/plugins-lock.json`：

```jsonc
{
  "version": 1,
  "plugins": {
    "@scope/my-plugin": {
      "name": "@scope/my-plugin",
      "version": "1.2.3",          // 取自包内 package.json
      "source": "zip",              // zip | npm
      "sha256": "<原始上传字节的 sha256>",
      "entry": "dist/index.js",
      "files": 42,
      "bytes": 181244,
      "installedAt": "2026-10-03T06:12:00.000Z"
    }
  }
}
```

- lock 是**卸载白名单**：`uninstall(name)` 只允许删 lock 里存在且 `source != 'built-in'` 的条目（防误删内置/手放目录）。
- 已装列表 UI：把 lock（本 spec 新增）+ `plugins-manifest.json`（既有，来自 kernel 运行期）合并展示，并标注二者差异（装了但没在 config 里启用 / config 声明了但未安装）。

### 2.5 dashboard API（路由层只做门 + 委派）

| 方法 | 路径 | 语义 |
|---|---|---|
| `POST` | `/api/plugins/inspect` | 上传字节（raw `application/zip` 或 base64）→ `inspect()` → 返回清单预览（name/version/入口/文件数/字节数/sha256/校验结论/`warnings`），**不落盘** |
| `POST` | `/api/plugins/install` | body = `{ sha256（来自 inspect，复核）| overwrite? }` → 命中 staging 内容 → `install()` → 返回新 lock 条目 + 可复制 config 片段 |
| `GET` | `/api/plugins/lock` | 返回 lock 内容（UI 已装列表用） |
| `DELETE` | `/api/plugins/:name` | `uninstall()`（仅 lock 内条目） |

- 两段式与 settings/plugins 写回同构：**inspect 先行 + sha 复核**（防「预览的内容 ≠ 安装的内容」），apply 阶段 sha 不匹配 → 409 要求重新 inspect。
- 上传体积门在路由层（默认 20 MiB，超出 413）；body 形状门 + 错误码映射（`PluginInstallError.code` → 400/404/409/413/500）。
- dashboard 包内**不出现任何 `writeFile`/`mkdir`** —— 全部经 `@nx-mk/plugin-install`。

### 2.6 CLI 面

- `nx-mk plugin install <file.zip> [--overwrite]`（先 inspect 打印清单，再要求 `--yes` 确认后落盘）
- `nx-mk plugin list`（读 lock）/ `nx-mk plugin uninstall <name>`
- 与 dashboard 共用同一 `installer` 实现（CLI 是「无 UI 的对等入口」，不是旁路）。
- `nx-mk doctor` 增加一项：lock 中的已装插件是否在 config `plugins:` 声明、包是否可解析（只读检查，不修）。

---

## 3. 错误路径

| 场景 | 时机 | 行为 |
|---|---|---|
| 非 zip / 缺 central directory / CRC 不符 | inspect | 400 `NOT_A_ZIP` / `CORRUPT_ARCHIVE`（附失败条目名，不抛原始栈） |
| 条目名穿越 / symlink / 非法名 | inspect | 400 `UNSAFE_ENTRY`，detail 列出全部违规条目（不是首个） |
| 超尺寸 / 条目数 / 压缩比 | inspect | 400 `ARCHIVE_TOO_LARGE` / `TOO_MANY_ENTRIES` / `SUSPICIOUS_RATIO`（附实测值与上限） |
| 缺 `package.json` / name 不合法 / version 空 / 入口缺失 | inspect | 400 `MANIFEST_INVALID` |
| 插件名非法（与安装名不符 / 未过 `PLUGIN_NAME_RE`） | inspect | 400 `INVALID_PLUGIN_NAME` |
| 目标目录已存在且未带 `overwrite` | install | 409 `ALREADY_INSTALLED`（附现有版本，UI 提示覆盖需二次确认） |
| `sha256` 与 inspect 时不一致 | install | 409 `CONTENT_CHANGED` —— 要求重新 inspect |
| `.install-lock` 已存在（并发安装） | install | 409 `INSTALL_IN_PROGRESS` |
| 目标目录不可写 / 磁盘满 | install | 500 `FS_ERROR`（staging 已清理，目标零残留） |
| 卸载目标不在 lock / `source=built-in` | uninstall | 404 `NOT_INSTALLED` / 403 `PROTECTED` |
| 已装但 config 未声明 | doctor / UI 提示 | 非错误：warn「已安装未启用 —— 在 `plugins:` 中加入 `<name>` 后下次 run 生效」 |

---

## 4. 测试计划

| 文件 | 覆盖 |
|---|---|
| `plugin-install/__tests__/zip-reader.test.ts` | stored/deflate 两法解压；UTF-8 中文条目名；多条目与目录条目；CRC 校验失败；截断归档；zip64 拒绝（或最小支持） |
| `plugin-install/__tests__/safety.test.ts` | **恶意矩阵**：`../escape`、`/abs/path`、`C:\evil`、`a/../../b`、反斜杠、`\0`、symlink 条目（构造 unix mode）、硬链接、超单文件/总量/条目数/压缩比、合法案例全通过 |
| `plugin-install/__tests__/installer.test.ts` | 落点正确（fixture zip 全字段还原）；原子性（注入解压中途失败 → 目标零残留）；overwrite 语义；并发锁；uninstall 白名单（内置/未装拒绝）；lock 写入内容与 sha256 一致 |
| `plugin-install/__tests__/lockfile.test.ts` | 读写往返；未知字段保留；损坏 lock → 明确错误不静默清空 |
| `dashboard/__tests__/plugin-install-routes.test.ts` | inspect/install/lock/delete 四路由；形状门 400；体积门 413；sha 复核 409；错误码映射；委派断言（spy installer，server 侧零 fs 写） |
| `kernel/__tests__/plugin-dirs.test.ts`（若采 Q3-A） | `dirs` 命中优先于 npm 解析；dirs 内 name 非法 / package.json 不符 → 既有错误码；未命中回落 npm 解析（行为不回归） |
| `cli/src/__tests__/plugin-install.test.ts` | `plugin install/list/uninstall` 三命令；`--yes` 缺失时不落盘；doctor 新增检查项 |

**回归锚**：`#/plugins` 既有三-tab 测试（安装区 disabled 断言）需改为「启用态 + 未安装时提示」，其余 812 测试不得回归。

---

## 5. 文档

- `packages/plugin-install/README.md`：包职责、安全规则表、lock 格式
- `docs/plugin-install.md`（用户向）：如何打包插件 zip（`package.json` + 入口 + 自包含要求）、上传/卸载流程、sha256 审计、常见失败码
- README：`#/plugins` 安装区与 `nx-mk plugin` 三条命令各一行
- `docs/hygiene-backlog.md`：C17 划 ☑（含落地注记）
- Plan：§47.10 落地记录（本 spec 的实现裁定）

---

## 6. 开放问题（需用户裁定后才进 plan）

| # | 问题 | 选项 | 建议 |
|---|---|---|---|
| Q1 | **npm 安装线本轮做不做？** | ① 只做 zip（离线/内网，零外部依赖）② 做 `npm pack` 拉 tarball（不跑脚本）③ 直接 `npm install`（脚本 + registry 依赖面） | **①**：③ 是任意代码执行面，与「不执行包内代码」直接冲突；② 需要自写 tar 解析（见 Q2 成本），价值低于 zip。npm 线整体延后到 v2，UI 保留 disabled + 文案说明 |
| Q2 | **为 ZIP/TAR 解析破 D2 铁律引入依赖？** | ① 自写最小 ZIP reader（约 200 行 + `node:zlib`）② 破例引 `yauzl`/`fflate`（约 20-30 KB，成熟） | **①**：D2 是跨期铁律，破例需专门裁定；ZIP 的 stored/deflate 两法与 central directory 解析成本可控，且安全校验本就必须自实现（库多半不做 zip-slip/ratio 校验） |
| Q3 | **加载通路** | A：kernel `loadPlugins` 增 `dirs`（推荐）｜B：CLI `extraPlugins` 注入｜C：装进 node_modules | **A**：单一解析入口、三命令共用；B 装配面分叉，C 破坏 zip 隔离 |
| Q4 | **覆盖安装与 sha pin** | ① 默认 fail-closed + UI 二次确认覆盖（推荐）② 允许静默覆盖 ③ 强制 `sha256` pin 才能装 | **①**；③ 作为可选字段（lock 已记 sha，允许用户把期望 sha 写进 config 做校验，v2 再启用） |

> **本 spec 只到设计为止**：Q1–Q4 裁定后另起 plan（TDD 任务分解），实现按仓库既有约定（单文件 ≤400 行、ESM `.js` 后缀、中文注释 + 英文标识符、D2、逐 Task 提交）。
