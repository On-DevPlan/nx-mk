# examples/react-vite-demo · nx-mk Phase 1.5 SDK Facade 验收夹具

> 落地依据：`docx/plan/nx-mk-plan.md` §8 + §42.5 + K-X1（demo 后端用 Hono）

## 包含

```
examples/react-vite-demo/
├── server/        # Hono + zod-openapi 后端（K-X1）
│   └── src/
│       ├── index.ts             # 路由 + schema（OpenAPIHono）
│       └── generate-openapi.ts  # swagger.json 落盘（pnpm demo:openapi）
├── app/           # React + Vite 前端
│   └── src/
│       ├── generated-sdk.ts     # 手写 placeholder（Phase 1.5 codegen 落地后删）
│       └── UserProfile.tsx      # 业务代码：api.users.getUser() + <Field>
├── swagger/       # 产物（gitignored；由 demo:openapi 落盘）
│   └── openapi.json             # plugin-swagger 的输入
└── README.md
```

## 跑通顺序

```bash
# 0. 安装（首次）
pnpm install

# 1. 启动后端（http://localhost:8787）
pnpm dev:server
#   • OpenAPI doc: http://localhost:8787/doc

# 2. 落盘 swagger.json（另开终端）
pnpm demo:openapi
#   • 写到 examples/react-vite-demo/swagger/openapi.json

# 3. 启动 demo 前端（http://localhost:5173）
pnpm dev:app

# 4. 验证 nx-mk 闭环
#    在仓库根跑：
nx-mk run --config examples/react-vite-demo/mk.config.yml
#    期望：.nx-mk/manifest.json 含 1 endpoint + 7 fields（demo 真实 OpenAPI）
```

## 设计要点

- **K-X1 后端栈**：Hono（TypeScript-native + zod-openapi 自动导 OpenAPI）
- **C-X1 / X1-A 接入**：demo app 业务代码用 `api.users.getUser()` 风格，**不感知模式**；
  `generated-sdk.ts` 是手写 placeholder，待 Phase 1.5 codegen 落地后删除
- **§20 UI Evidence**：渲染层用 `<Field field="user.profile.name">` 显式标记；
  `internalRiskScore` 故意**不**包裹 → Coverage Policy 应 ignored
- **M14 Goal Loop 验收**：`manifest.json.fields[].id` 应与 demo 真实 OpenAPI 一一对应
- **K1 demo 验证集**：本 demo 已覆盖 required / optional / ignored 三类字段
  - required: `user.id`, `user.name`
  - optional: `user.email`, `user.tags`, `user.address.city`, `user.address.zip`
  - ignored: `user.internalRiskScore`（demo 不展示）

## Phase 1.5 落地后

1. 删除 `app/src/generated-sdk.ts`
2. 业务代码 `import { api } from '@nx-mk/client'`
3. 新增 `@nx-mk-example/app` 依赖 `"@nx-mk/client": "workspace:*"`（已预声明）
4. 跑 `pnpm --filter @nx-mk/client build` + demo 验证
