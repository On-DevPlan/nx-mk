/**
 * SDK Facade usage demo —— 业务代码视角
 *
 * 真实场景下 `api.users.getUser()` 等方法由 nx-mk Phase 1.5 codegen 从
 * swagger.json 自动生成（见 docx/plan/nx-mk-plan.md §42.5）。
 *
 * 这里为了 demo 可独立跑通，先以**手写 placeholder 类型**展示调用形态：
 *   - 业务代码只 import `api`，不感知 production / analysis 模式
 *   - <Field> 包裹展示字段（见 docx/plan/nx-mk-plan.md §20）
 *   - Internal risk score 不包裹 → 故意不展示（Coverage Policy 应 ignore）
 *
 * 验收路径：
 *   1. demo/server 启动（Hono + zod-openapi）
 *   2. npx mk demo:openapi → swagger/openapi.json 落盘
 *   3. nx-mk plugin-swagger 读 swagger.json → .nx-mk/manifest.json
 *   4. nx-mk Phase 1.5 codegen → @nx-mk/client typed endpoints
 *   5. demo/app 启动 → 调 api.users.getUser() → 渲染 UI Evidence
 */
import { useEffect, useState } from 'react'
import { api } from './generated-sdk.js'

type User = {
  id: string
  name: string
  email: string | null
  tags: string[]
  address: { city: string; zip: string }
  internalRiskScore?: number
}

// Local Field placeholder —— 真实场景由 @nx-mk/client/react/Field 提供
function Field({ field, children }: { field: string; children: React.ReactNode }) {
  return (
    <span data-mk-field={field}>
      {children}
    </span>
  )
}

export function UserProfile() {
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.users
      .getUser('u_001')
      .then((u) => setUser(u as User))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error) return <div data-page="error">Error: {error}</div>
  if (!user) return <div data-page="loading">Loading…</div>

  return (
    <div data-page="user-profile">
      <h1>
        <Field field="user.profile.name">{user.name}</Field>
      </h1>
      <dl>
        <dt>Email</dt>
        <dd>
          <Field field="user.profile.email">{user.email ?? '—'}</Field>
        </dd>
        <dt>Tags</dt>
        <dd>
          <Field field="user.profile.tags">
            {user.tags.join(', ')}
          </Field>
        </dd>
        <dt>Address</dt>
        <dd>
          <Field field="user.profile.address.city">{user.address.city}</Field>
          {' · '}
          <Field field="user.profile.address.zip">{user.address.zip}</Field>
        </dd>
        {/* internalRiskScore 故意不包裹 —— Coverage Policy 期望 ignored */}
      </dl>
    </div>
  )
}
