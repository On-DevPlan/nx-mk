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
│       ├── generated-sdk.ts     # codegen 产物（pnpm demo:codegen 产出，勿手改）
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
#    在 demo 目录跑（配置已改名 nx-mk.config.yml，findConfigFile 自动向上查找）：
cd examples/react-vite-demo && node ../../packages/cli/dist/index.js run
#    期望：.nx-mk/manifest.json 含 3 endpoints（getUser / listUsers / createOrder）
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

## 运行闭环（Phase 1.5 验收形态）

三步串联（demo 目录 = `examples/react-vite-demo`）：

```bash
# 1. demo/server 产出 swagger/openapi.json（仓库根执行）
pnpm demo:openapi

# 2. plugin-swagger 解析 swagger.json → .nx-mk/manifest.json（demo 目录执行）
cd examples/react-vite-demo
node ../../packages/cli/dist/index.js run

# 3. manifest.json → typed SDK → app/src/generated-sdk.ts（demo 目录执行）
pnpm exec tsx generate-sdk.ts
```

或仓库根一键等价三步：`pnpm demo:codegen`（先重建 `@nx-mk/cli` 再串完整链路）。

存量代码迁移演示（SDK-CG3，demo 目录执行）：

```bash
node ../../packages/cli/dist/index.js migrate --dry-run
# 静态 fetch('/api/...') → api.ns.method() 改写预览；去掉 --dry-run 落盘
```
