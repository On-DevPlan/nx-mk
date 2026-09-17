/**
 * SDK Facade usage demo —— 业务代码视角（Phase 3 goal 闭环验收形态）
 *
 * `api` 与 `User` 类型均来自 codegen 产物 generated-sdk.ts（真 swagger 链路）：
 *   demo:openapi → nx-mk run（plugin-swagger → manifest.json）→ generate-sdk.ts
 *
 *   - 业务代码只 import `api`，不感知 production / analysis 模式
 *   - <Field>（@nx-mk/client/react）包裹展示字段，渲染 data-mk-field
 *     ★ Phase 3 约定：Field 值 = manifest 字段 normalizedPath（demo GET /users/{id}）：
 *       data.id / data.name / data.email / data.tags[] / data.address.city / data.address.zip
 *       （user.id 补一个副标题行使 required 全可命中）
 *   - internalRiskScore 故意不包裹 → Coverage Policy 期望 ignored（coverage.ignored 裁定）
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api, type User } from './generated-sdk.js'

export function UserProfile() {
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.users
      .getUser({ id: 'u_001' })
      .then((u) => setUser(u))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error) return <div data-page="error">Error: {error}</div>
  if (!user) return <div data-page="loading">Loading…</div>

  return (
    <div data-page="user-profile">
      <h1>
        <Field field="data.name">{user.name}</Field>
      </h1>
      {/* user.id 副标题 —— manifest required 字段补全覆盖 */}
      <p data-testid="user-id">
        <Field field="data.id">{user.id}</Field>
      </p>
      <dl>
        <dt>Email</dt>
        <dd>
          <Field field="data.email">{user.email ?? '—'}</Field>
        </dd>
        <dt>Tags</dt>
        <dd>
          {/* 数组字段 normalizedPath = data.tags[]（manifest 归一化形态） */}
          <Field field="data.tags[]">
            {(user.tags ?? []).join(', ')}
          </Field>
        </dd>
        <dt>Address</dt>
        <dd>
          <Field field="data.address.city">{user.address?.city ?? '—'}</Field>
          {' · '}
          <Field field="data.address.zip">{user.address?.zip ?? '—'}</Field>
        </dd>
        {/* internalRiskScore 故意不包裹 —— Coverage Policy 期望 ignored */}
      </dl>
    </div>
  )
}
