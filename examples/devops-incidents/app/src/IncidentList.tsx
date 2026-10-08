/**
 * 事件列表 —— 覆盖 GET /services/{serviceId}/incidents 响应 schema 的全部 13 个
 * manifest 路径（11 个叶子 + 2 个 plain-object 父节点），以及
 * POST /incidents/{incidentId}/notes 201 回显的 2 个路径（data.body / data.createdAt）。
 *
 * 形状差异（与 commerce-orders / medical-records 对比）：
 *   - 三对象嵌套：data[].assignee.* + data[].impact.*（assignee 与 impact 是 plain object，
 *     walkSchema 对 array 元素的 object 属性仍产父描述符，故 assignee / impact 两条
 *     父路径在分母里 —— 各自渲染一个叶子摘要 Field）。
 *   - nullable：inc_001 的 resolvedAt 为 null → DASH 兜底（A1/A2；
 *     generateSdk 丢了可空性，TS 不会提醒）。
 *   - 数组内嵌数组：data[].impact.regions[] 是 array-of-primitive（string[]），
 *     带 [] 后缀的归一化形态。
 *
 * 备注回显区（201 验证点）：POST /incidents/{incidentId}/notes 的 2 个回显字段
 * （data.body / data.createdAt）若无页面真实发起该请求，运行期零 evidence →
 * 断言 B/C 必失败。组件 mount 即对 fixture 事件 inc_001 自驱动 POST 一次固定 note，
 * 渲染进独立 DOM 区 `<div data-testid="incident-note">`。S2 自驱动（DSL 无 click/fill）。
 *
 * A1/A2：每个值过兜底算子（字符串 ||，数值 String(x ?? DASH)）。
 * A3：enum 映射中文标签（severity: 严重1级/严重2级/严重3级、state: 待处理/已缓解/已解决），
 *   局部变量带 Text 后缀。
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api, type Incident, type IncidentNote } from './generated-sdk.js'

const DASH = '—'
const SEVERITY_LABEL: Record<string, string> = { sev1: '严重1级', sev2: '严重2级', sev3: '严重3级' }
const STATE_LABEL: Record<string, string> = { open: '待处理', mitigated: '已缓解', resolved: '已解决' }

/** 镜像 server INCIDENTS fixture 的事件 id —— 挂载断言（verify-pages.mjs）逐个核对 */
const NOTE_INCIDENT_IDS = ['inc_001', 'inc_002']

export function IncidentList() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<IncidentNote | null>(null)
  const [noteError, setNoteError] = useState<string | null>(null)

  useEffect(() => {
    api.incidents
      .listServiceIncidents({ serviceId: 'svc_001' })
      .then(setIncidents)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // 备注回显区（201 验证点）：S2 自驱动 —— mount 即对 fixture 事件提交一次固定 note，
  // 拿到 201 后渲染回显区。StrictMode 双调用 → POST 实际发两次（无持久化，两次均 valid）。
  useEffect(() => {
    const incidentId = NOTE_INCIDENT_IDS[0] ?? 'inc_001'
    api.incidents
      .createIncidentNote({ incidentId, body: { body: '已扩容并观察 30 分钟' } })
      .then(setNote)
      .catch((e: unknown) => setNoteError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error) return <section data-page="incidents-error">加载失败：{error}</section>
  if (!incidents) return <section data-page="incidents-loading">加载中…</section>

  return (
    <section data-page="incident-list">
      <h2>事件列表（{incidents.length} 条）</h2>
      <ol>
        {incidents.map((inc) => {
          // 局部变量带 Text 后缀，不取字段末段同名（A3 静态检查的前提）
          const idText = inc.id || DASH
          const titleText = inc.title || DASH
          const severityText = inc.severity ? (SEVERITY_LABEL[inc.severity] ?? inc.severity) : DASH
          const stateText = inc.state ? (STATE_LABEL[inc.state] ?? inc.state) : DASH
          const openedAtText = inc.openedAt || DASH
          // nullable：inc_001 的 resolvedAt 为 null → DASH 兜底（A1/A2；
          // generateSdk 丢了可空性，TS 视 inc.resolvedAt 为非空 string，不会提醒）
          const resolvedAtText = inc.resolvedAt || DASH
          const assigneeIdText = inc.assignee?.id || DASH
          const assigneeNameText = inc.assignee?.name || DASH
          const assigneeEmailText = inc.assignee?.email || DASH
          const usersAffectedText = String(inc.impact?.usersAffected ?? DASH)
          // array-of-primitive → 数组元素字段进分母。空数组时也渲染一个占位 Field。
          const regionsText = (inc.impact?.regions ?? []).join(', ') || DASH
          return (
            <li key={inc.id}>
              <div>
                {/* A3：渲染事件 id 值本身（'inc_001'），不等于末段 'id' */}
                <Field field="data[].id">{idText}</Field>
                {' · '}
                <Field field="data[].title">{titleText}</Field>
                {' · '}
                <Field field="data[].severity">{severityText}</Field>
                {' · '}
                <Field field="data[].state">{stateText}</Field>
              </div>
              <div>
                开启时间 <Field field="data[].openedAt">{openedAtText}</Field>
                {' · 解决时间 '}
                {/* nullable 验证点：inc_001.resolvedAt 为 null → DASH 兜底 */}
                <Field field="data[].resolvedAt">{resolvedAtText}</Field>
              </div>
              <div>
                处理人：
                <Field field="data[].assignee.id">{assigneeIdText}</Field>
                {' · '}
                <Field field="data[].assignee.name">{assigneeNameText}</Field>
                {' · '}
                <Field field="data[].assignee.email">{assigneeEmailText}</Field>
              </div>
              {/* 对象级：data[].assignee。walkSchema 对 array 元素的 object 属性仍产父描述符，
                  故这条 required 路径在分母里 —— 与三个叶子一并渲染（叶子摘要，非空 span）。 */}
              <div>
                处理人汇总：
                <Field field="data[].assignee">
                  {`（${assigneeIdText} · ${assigneeNameText} · ${assigneeEmailText}）`}
                </Field>
              </div>
              <div>
                影响：
                <Field field="data[].impact.usersAffected">{usersAffectedText}</Field>
                {' 用户 · 区域 '}
                {/* 三层数组叶：data[].impact.regions[]（array-of-primitive 带 []） */}
                <Field field="data[].impact.regions[]">{regionsText}</Field>
              </div>
              {/* 对象级：data[].impact —— 同 assignee，父描述符在分母里 */}
              <div>
                影响汇总：
                <Field field="data[].impact">
                  {`（${usersAffectedText} 用户 · ${regionsText}）`}
                </Field>
              </div>
            </li>
          )
        })}
      </ol>

      {/* ─── 备注回显区：POST /incidents/{incidentId}/notes 的 3 个 201 字段 ─── */}
      {noteError && <p data-page="incident-note-error">备注提交失败：{noteError}</p>}
      {note && (
        <div data-testid="incident-note">
          <h3>事件备注（201 回显验证）</h3>
          <dl>
            <dt>备注编号</dt>
            {/* A3：渲染 note id 值本身（'note_<ts>'），不等于末段 'id' */}
            <dd><Field field="data.id">{note.id || DASH}</Field></dd>

            <dt>备注正文</dt>
            <dd><Field field="data.body">{note.body || DASH}</Field></dd>

            <dt>提交时间</dt>
            <dd><Field field="data.createdAt">{note.createdAt || DASH}</Field></dd>
          </dl>
        </div>
      )}
    </section>
  )
}