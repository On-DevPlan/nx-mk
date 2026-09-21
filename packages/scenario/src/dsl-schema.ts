/**
 * Scenario DSL 文件 schema（spec §26.1 + S2/SP2）：
 * version 1；scenarios[]{id, name, route?, steps[]}；step discriminated union 5 种。
 * click/fill/assertVisible（§26.3 其余）后置——表单流 demo 出现再加（spec 范围声明）。
 */
import { z } from 'zod'

// 场景 id：kebab-case（与场景文件名解耦——文件可含多场景）
const ScenarioIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'scenario id must be kebab-case')

const OptionalTimeout = z.number().int().positive().max(60000).optional()

export const GotoStepSchema = z.object({ type: z.literal('goto'), url: z.string().min(1), id: z.string().optional() })
export const WaitStepSchema = z.object({ type: z.literal('waitFor'), selector: z.string().min(1), timeoutMs: OptionalTimeout, id: z.string().optional() })
export const WaitForRequestStepSchema = z.object({ type: z.literal('waitForRequest'), urlPattern: z.string().min(1), timeoutMs: OptionalTimeout, id: z.string().optional() })
export const AssertFieldVisibleStepSchema = z.object({ type: z.literal('assertFieldVisible'), field: z.string().min(1), timeoutMs: OptionalTimeout, id: z.string().optional() })
export const ScreenshotStepSchema = z.object({ type: z.literal('screenshot'), path: z.string().optional(), id: z.string().optional() })

export const ScenarioStepSchema = z.discriminatedUnion('type', [
  GotoStepSchema,
  WaitStepSchema,
  WaitForRequestStepSchema,
  AssertFieldVisibleStepSchema,
  ScreenshotStepSchema,
])

export type GotoStep = z.infer<typeof GotoStepSchema>
export type WaitStep = z.infer<typeof WaitStepSchema>
export type WaitForRequestStep = z.infer<typeof WaitForRequestStepSchema>
export type AssertFieldVisibleStep = z.infer<typeof AssertFieldVisibleStepSchema>
export type ScreenshotStep = z.infer<typeof ScreenshotStepSchema>
export type ScenarioStep = z.infer<typeof ScenarioStepSchema>

export const ScenarioSchema = z.object({
  id: ScenarioIdSchema,
  name: z.string().min(1),
  route: z.string().optional(),
  steps: z.array(ScenarioStepSchema).min(1).max(50),
})
export type Scenario = z.infer<typeof ScenarioSchema>

export const ScenarioFileSchema = z.object({
  version: z.literal(1),
  scenarios: z.array(ScenarioSchema).min(1),
})
export type ScenarioFile = z.infer<typeof ScenarioFileSchema>
