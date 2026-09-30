/**
 * /settings/policy | /settings/agent | /settings/replay（C12，§30.1/§30.2）：
 * 三页共用 SettingsSectionPage —— GET /api/settings 拉现值（段缺省=安全默认）→
 * 编辑 JSON 文本（空 = 段删除，回到安全默认）→ Preview（dryRun diff）→
 * Apply（yamlSha 复核两段式原子写，下次 run 生效）。
 * 与 PluginSettings 同交互模型；状态机输出由路由测试覆盖（node 渲染无事件模拟）。
 */
import { useEffect, useState } from 'react'
import { ApiError, getJson, patchJson } from '../api'
import { useT } from '../i18n'
import type { SettingsResponse, ConfigWritePreviewResponse, ConfigWriteApplyResponse } from '../../shared/api-types'

/** 页面路由段 → config 顶层段名 */
export type SettingsSection = 'coverage' | 'agent' | 'replay'

const SECTION_TITLE: Record<SettingsSection, string> = {
  coverage: 'Coverage policy',
  agent: 'Agent',
  replay: 'Replay safety',
}

const SECTION_HINT: Record<SettingsSection, string> = {
  coverage: 'Coverage policy glob rules: required / optional / ignored lists. Entries are strings or {pattern, reason} objects.',
  agent: 'Agent provider (claude-code timeoutMs/maxTurns) and loop (maxIterations / stopIfNoImprovementRounds / maxTasksPerIteration).',
  replay: 'Replay safety rules: allowMethods / requireConfirmation lists and block patterns. Semantics are fail-closed (deny unless allowed).',
}

/** textarea 文本 → 补丁 value（'' = null 段删除；非法 JSON → undefined 并显错） */
function parseValue(
  text: string,
  T: (key: string, params?: Record<string, string | number>) => string,
  show: (msg: string, errors: string[] | null) => void,
): { value: Record<string, unknown> | null } | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return { value: null }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      show(T('config must be a JSON object'), null)
      return undefined
    }
    return { value: parsed as Record<string, unknown> }
  } catch (err) {
    show(T('invalid JSON: {msg}', { msg: (err as Error).message }), null)
    return undefined
  }
}

export function SettingsSectionPage({ section }: { section: SettingsSection }) {
  const T = useT()
  const [current, setCurrent] = useState<{ value: string; sha: string } | null>(null) // 初次 GET 结果
  const [draft, setDraft] = useState<string | null>(null) // 用户编辑缓冲（null = 未编辑）
  const [preview, setPreview] = useState<ConfigWritePreviewResponse | null>(null)
  const [applied, setApplied] = useState<ConfigWriteApplyResponse | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [schemaErrors, setSchemaErrors] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const show = (msg: string, errs: string[] | null): void => { setErrorText(msg); setSchemaErrors(errs) }

  const load = async (): Promise<void> => {
    setBusy(true)
    setErrorText(null)
    setSchemaErrors(null)
    try {
      const res = await getJson<SettingsResponse>('/api/settings')
      const v = res.sections[section]
      setCurrent({ value: v === null ? '' : JSON.stringify(v, null, 2), sha: res.yamlSha })
      setDraft(null)
    } catch (err) {
      setErrorText(err instanceof ApiError ? err.detailMessage : T('failed to load settings'))
    } finally {
      setBusy(false)
    }
  }
  // mount-once：settings 是低频读，不做轮询（无 usePolling）
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

  const text = draft ?? current?.value ?? ''

  const doPreview = async (): Promise<void> => {
    if (current === null) return
    const body = parseValue(text, T, show)
    if (body === undefined) return
    setBusy(true)
    setPreview(null)
    setApplied(null)
    try {
      const res = await patchJson<ConfigWritePreviewResponse>(`/api/settings/${section}`, { value: body.value, mode: 'preview' })
      setPreview(res)
      // 预览返回的是**当前磁盘**的 sha —— 更新 current.sha 供 apply 复核
      setCurrent({ value: current.value, sha: res.yamlSha })
    } catch (err) {
      show(err instanceof ApiError ? err.detailMessage : T('preview failed: {msg}', { msg: String(err) }), null)
    } finally {
      setBusy(false)
    }
  }

  const doApply = async (): Promise<void> => {
    if (preview === null) return
    const body = parseValue(text, T, show)
    if (body === undefined) return
    setBusy(true)
    try {
      const res = await patchJson<ConfigWriteApplyResponse>(`/api/settings/${section}`, { value: body.value, mode: 'apply', yamlSha: preview.yamlSha })
      setApplied(res)
      setPreview(null)
      await load()
    } catch (err) {
      show(err instanceof ApiError ? err.detailMessage : T('apply failed: {msg} — re-preview and retry', { msg: String(err) }), null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h1>{T('Settings')} · {T(SECTION_TITLE[section])}</h1>
      <p>{T(SECTION_HINT[section])}</p>
      <p>{T('Edit config as JSON — Preview shows the YAML diff; Apply writes nx-mk.config.yml (a .bak backup is kept). Takes effect on the next run. Empty text removes the section (back to safe defaults).')}</p>
      {current === null && errorText === null && <p className="loading">{T('loading…')}</p>}
      {errorText !== null && <p className="error">{errorText}</p>}
      {current !== null && (
        <>
          <textarea
            rows={12}
            value={text}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="{ }"
          />
          <p>
            <button onClick={() => void doPreview()} disabled={busy}>{T('Preview')}</button>{' '}
            <button onClick={() => void doApply()} disabled={busy || preview === null}>{T('Apply')}</button>
          </p>
          {schemaErrors !== null && schemaErrors.length > 0 && (
            <ul className="error">
              {schemaErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          {preview !== null && (
            <div className="section">
              <h2>{T('preview diff (not written yet):')}</h2>
              <pre>{preview.diff || '(no changes)'}</pre>
            </div>
          )}
          {applied !== null && (
            <p>{T('applied — takes effect on the next nx-mk run (backup: {path})', { path: applied.bakPath })}</p>
          )}
        </>
      )}
    </section>
  )
}
