/** @nx-mk/scenario 公共 API 入口（§8 树：dsl-schema/dsl-loader/runner/playwright-runner/scenario-replay） */
export { ScenarioFileSchema, ScenarioSchema, ScenarioStepSchema, GotoStepSchema, WaitStepSchema, WaitForRequestStepSchema, AssertFieldVisibleStepSchema, ScreenshotStepSchema, type ScenarioFile, type Scenario, type ScenarioStep, type GotoStep, type WaitStep, type WaitForRequestStep, type AssertFieldVisibleStep, type ScreenshotStep } from './dsl-schema.js'
// C9（§26.2）：Request DSL —— schema/校验/生成
export { RequestDeclSchema, RequestDeclFileSchema, RequestExpectFieldSchema, classifyFieldState, getFieldByPath, type RequestDecl, type RequestDeclFile, type RequestExpectField } from './request-dsl.js'
export { verifyRequest, verifyRequests, matchesTrace, type RequestTraceLike, type RequestVerification, type RequestFieldAssertionResult } from './verify-requests.js'
export { generateRequestDslFromTraces, renderRequestDslYaml, type GeneratedRequest } from './generate-request-dsl.js'
export { globToRegExp, loadScenarios, loadRequests, type LoadedScenario, type LoadedRequest, type LoadScenariosResult, type LoadRequestsResult } from './dsl-loader.js'
export { runScenario, runScenarioSuite, stepIdOf, type StepDriver, type StepResult, type ScenarioRunResult, type SuiteItem } from './runner.js'
export { hasChromium, createPlaywrightDriver, runScenarioWithPage, runScenarioSuiteInBrowser, type SuiteObservers } from './playwright-runner.js'
export { ScenarioReplayError, replayScenario, replayLaunch, makeScenarioReplayId, writeScenarioReplayTrail, type ScenarioReplayTrail } from './scenario-replay.js'
