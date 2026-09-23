/**
 * i18n —— 零依赖中英双语（D2 纪律：dashboard 不引运行时新依赖）。
 * 设计：
 * - 字典以英文原文为键：en 缺省即回退键本身（新增文案先写英文即可工作），
 *   zh 表缺项同样回退英文 —— 翻译可渐进补齐。
 * - 语言状态为模块级单例 + useSyncExternalStore 订阅；localStorage 持久化
 *   （仅浏览器；node 渲染测试环境恒 'en'，保证 renderToString 断言确定性）。
 * - 插值：'{name}' 占位，translate(lang, key, params) 纯函数可直测。
 */
import { useCallback, useSyncExternalStore } from 'react'

export type Lang = 'en' | 'zh'

const STORAGE_KEY = 'nx-mk-dashboard-lang'

/** 中文词典（键 = 英文原文；缺项回退英文） */
const zh: Record<string, string> = {
  // —— 通用 ——
  'loading…': '加载中…',
  'error {code}: {detail}': '错误 {code}: {detail}',
  'yes': '是',
  'no': '否',
  'Not found — pick a page above.': '页面不存在 —— 请从上方导航选择。',
  'Run not found: {id}': '找不到 run: {id}',
  'Request not found: {id}': '找不到请求: {id}',
  // —— 导航 ——
  'Overview': '总览',
  'Runs': '运行',
  'Scenarios': '场景',
  'Plugins': '插件',
  // —— Overview / RunOverview ——
  'failed to load runs': '运行列表加载失败',
  'No runs yet — run {cmd} first.': '还没有 run —— 请先运行 {cmd}。',
  'live': '实时',
  'terminated: {reason}': '终止: {reason}',
  'required': '必需',
  'effective': '有效',
  'raw backend': '后端原始',
  'missing required: {n}': '缺失必需: {n}',
  'ignored returned: {n}': '忽略仍返回: {n}',
  'suspicious: {n}': '可疑: {n}',
  'endpoints: {called}/{total}': '端点: {called}/{total}',
  'fields returned: {a}/{b}': '返回字段: {a}/{b}',
  'No coverage report yet — it is written when a run finishes.': '暂无覆盖率报告 —— run 结束时写入。',
  'No coverage report for this run (report is overwritten by the latest run). Requests and fields remain available below.': '该 run 无覆盖率报告（报告被最近一次 run 覆写）。下方请求与字段数据仍可查看。',
  'Requests →': '请求 →',
  'Fields →': '字段 →',
  'Ignored →': '忽略清单 →',
  'Manifest browser': 'Manifest 浏览器',
  // —— 表头（复用键）——
  'run': '运行',
  'status': '状态',
  'started': '开始时间',
  'ended': '结束时间',
  'terminated': '终止原因',
  'report': '报告',
  'method': '方法',
  'path / url': '路径 / URL',
  'duration': '耗时',
  'field': '字段',
  'count': '次数',
  'source': '来源',
  'last hit': '最后命中',
  'visible': '可见',
  'text sample': '文本样本',
  'selector': '选择器',
  'policy': '策略',
  'access/ui': '访问/UI',
  'details': '详情',
  'hit count': '命中次数',
  'matched rule': '匹配规则',
  'type': '类型',
  'step': '步骤',
  'ok': '成功',
  'ms': '耗时(ms)',
  'error': '错误',
  'path': '路径',
  'called': '已调用',
  // —— Requests / RequestDetail ——
  'Requests': '请求',
  '← Requests': '← 请求列表',
  '← Run': '← 运行',
  'No requests captured in this run.': '该 run 未捕获到请求。',
  'url': 'URL',
  'endpoint': '端点',
  'Field hits': '字段命中',
  'UI evidence': 'UI 证据',
  'not associated': '无关联',
  'Response body': '响应值',
  'not recorded': '未记录',
  'Replay': '回放',
  'Replay request': '回放请求',
  'Confirm replay': '确认回放',
  'unsafe/idempotent method requires confirmation': '非安全/幂等方法需要确认',
  'replay request failed': '回放请求失败',
  'replay-error: {err}': '回放错误: {err}',
  // —— Fields / Ignored ——
  'Fields': '字段',
  'Returned but ignored': '返回但被忽略',
  'Nothing ignored-and-returned in this run.': '该 run 没有忽略且仍返回的字段。',
  'No coverage report for this run (overwritten by the latest run).': '该 run 无覆盖率报告（已被最近一次 run 覆写）。',
  'No coverage_fields rows for this run — run with {cmd} config to populate.': '该 run 无 coverage_fields 行 —— 带 {cmd} 配置运行后写入。',
  'Covered': '已覆盖',
  'Missing (required)': '缺失（必需）',
  'Ignored': '已忽略',
  'Not applicable': '不适用',
  'hit count: {n}': '命中次数: {n}',
  'rule': '规则',
  'counted: required={a} effective={b}': '计数: required={a} effective={b}',
  // —— Manifest ——
  'Manifest': '清单',
  '{n} endpoints · {m} fields': '{n} 个端点 · {m} 个字段',
  'Endpoints': '端点',
  'fields': '字段数',
  'no fields': '无字段',
  // —— PluginSettings ——
  'Plugins endpoint not found.': '未找到 plugins 端点。',
  'kernel has not produced plugins-manifest.json yet — run once first.': 'kernel 尚未产出 plugins-manifest.json —— 请先运行一次。',
  'Edit per-plugin config — Preview shows the YAML diff; Apply writes nx-mk.config.yml (a .bak backup is kept). Takes effect on the next run.': '编辑插件配置 —— Preview 预览 YAML diff；Apply 写回 nx-mk.config.yml（保留 .bak 备份）。下次 run 生效。',
  'No schema exposed': '未提供 Schema',
  'Copy YAML': '复制 YAML',
  'Copied!': '已复制！',
  'Edit config': '编辑配置',
  'config is JSON (valid YAML) for plugin {name}': '插件 {name} 的 config（JSON，兼容 YAML）',
  'Preview': '预览',
  'Apply': '应用',
  'preview diff (not written yet):': '预览 diff（尚未写盘）:',
  'applied — takes effect on the next nx-mk run (backup: {path})': '已应用 —— 下次 nx-mk run 生效（备份: {path}）',
  'config must be a JSON object': 'config 必须是 JSON 对象',
  'invalid JSON: {msg}': 'JSON 无效: {msg}',
  'preview failed: {msg}': '预览失败: {msg}',
  'apply failed: {msg} — re-preview and retry': '应用失败: {msg} —— 请重新预览后重试',
  // —— Scenarios ——
  'no scenarios configured — add a scenarios: include: section to nx-mk.config.yml.': '未配置场景 —— 在 nx-mk.config.yml 中添加 scenarios: include: 段。',
  '{n} steps': '{n} 步',
  'Replaying…': '回放中…',
  'run once first': '请先运行一次',
  'replaying {id}…': '正在回放 {id}…',
  'replay failed — {msg}': '回放失败 —— {msg}',
  'pass': '通过',
  'fail': '失败',
  'trail written': '留痕已写入',
}

function loadStoredLang(): Lang {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const v = window.localStorage.getItem(STORAGE_KEY)
      if (v === 'zh' || v === 'en') return v
    }
  } catch { /* 存储不可用（node 渲染环境/隐私模式）→ 缺省 en */ }
  return 'en'
}

let currentLang: Lang = loadStoredLang()
const listeners = new Set<() => void>()

export function getLang(): Lang {
  return currentLang
}

/** 切换语言并持久化（浏览器）；node/存储不可用时仅切换不落盘 */
export function setLang(lang: Lang): void {
  if (lang === currentLang) return
  currentLang = lang
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(STORAGE_KEY, lang)
  } catch { /* 同 loadStoredLang */ }
  for (const notify of listeners) notify()
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

export type Translate = (key: string, params?: Record<string, string | number>) => string

/** 纯函数翻译（可直测）：zh 缺项回退英文键本身；{name} 占位插值 */
export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const template = (lang === 'zh' ? zh[key] : undefined) ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] !== undefined ? String(params[name]) : `{${name}}`)
}

/** 组件用：订阅语言状态，返回绑定当前语言的 t() */
export function useT(): Translate {
  const lang = useSyncExternalStore(subscribe, getLang, getLang)
  return useCallback((key, params) => translate(lang, key, params), [lang])
}

/** 导航语言开关用：[当前语言, 切换函数] */
export function useLang(): [Lang, (lang: Lang) => void] {
  const lang = useSyncExternalStore(subscribe, getLang, getLang)
  return [lang, setLang]
}
