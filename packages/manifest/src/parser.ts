import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import SwaggerParser from '@apidevtools/swagger-parser'
import { walkSchema } from './schema-walker'

// Same union as field-id's HttpMethod (re-exported as the canonical type here;
// index.ts re-exports HttpMethod from './parser').
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

export interface ApiField {
  id: string
  endpointId: string
  direction: 'request' | 'response'
  status?: string
  path: string
  normalizedPath: string
  name: string
  type: string
  required?: boolean
  nullable?: boolean
  description?: string
  example?: unknown
  enum?: string[]
  schemaName?: string
  source: { openapiPointer: string }
}

export interface ApiEndpoint {
  id: string
  method: HttpMethod
  path: string
  operationId?: string
  summary?: string
  tags?: string[]
  request?: {
    pathParams?: ApiField[]
    query?: ApiField[]
    headers?: ApiField[]
    body?: SchemaRef
  }
  responses: Array<{
    status: string
    schema?: SchemaRef
    fields: ApiField[]
  }>
}

export type SchemaRef =
  | { kind: 'named'; name: string }
  | { kind: 'inline' }
  | { kind: 'array' }
  | { kind: 'object' }
  | { kind: 'primitive'; type: string }

export interface ApiManifest {
  version: string
  source: {
    type: 'openapi'
    input: string
    hash: string
  }
  generatedAt: string
  endpoints: ApiEndpoint[]
  schemas: Record<string, ApiSchema>
  fields: ApiField[]
}

export interface ApiSchema {
  type: string
  properties?: Record<string, ApiSchema>
  items?: ApiSchema
  required?: string[]
  nullable?: boolean
}

export interface ParseOptions {
  cwd?: string
}

// JSON Pointer escape: replace ~ → ~0 and / → ~1 per RFC 6901.
function escapePointerSegment(seg: string): string {
  return seg.replace(/~/g, '~0').replace(/\//g, '~1')
}

export async function parseOpenApi(
  specPath: string,
  options: ParseOptions = {},
): Promise<ApiManifest> {
  const raw = readFileSync(specPath, 'utf8')
  const hash = createHash('sha1').update(raw).digest('hex').slice(0, 16)

  // new SwaggerParser().dereference resolves all $ref pointers AND validates the spec.
  // (The default export is a class constructor — it must be invoked with `new`.)
  const api: any = await new SwaggerParser().dereference(JSON.parse(raw))

  const endpoints: ApiEndpoint[] = []
  const allFields: ApiField[] = []

  for (const [path, pathItem] of Object.entries<any>(api.paths ?? {})) {
    for (const [method, operation] of Object.entries<any>(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head'].includes(method)) continue

      const httpMethod = method.toUpperCase() as HttpMethod
      const endpointId = createHash('sha1').update(`${httpMethod}:${path}`).digest('hex').slice(0, 12)

      // Request params
      const pathParams: ApiField[] = []
      const query: ApiField[] = []
      const headers: ApiField[] = []
      const params = (operation.parameters ?? []) as any[]
      for (const [index, param] of params.entries()) {
        const baseCtx = {
          method: httpMethod,
          path,
          direction: 'request' as const,
          status: undefined,
          endpointId,
          normalizedFieldPath: param.name,
        }
        const walkerFields = walkSchema(param.schema ?? {}, baseCtx)
        const field: ApiField = {
          ...walkerFields[0]!,
          name: param.name,
          required: param.required,
          source: {
            openapiPointer: `/paths/${escapePointerSegment(path)}/${method}/parameters/${index}`,
          },
        }
        if (param.in === 'path') pathParams.push(field)
        else if (param.in === 'query') query.push(field)
        else if (param.in === 'header') headers.push(field)
      }

      // Responses
      const responses: ApiEndpoint['responses'] = []
      for (const [status, response] of Object.entries<any>(operation.responses ?? {})) {
        const content = response?.content?.['application/json']
        const schema = content?.schema ?? null
        // Walk the response schema with a 'data' prefix so nested object
        // children get dotted paths (data.id, data.address.city, ...).
        const responseFields: ApiField[] = schema
          ? walkSchema(schema, {
              method: httpMethod,
              path,
              direction: 'response',
              status,
              endpointId,
              normalizedFieldPath: 'data',
            })
          : []

        responses.push({
          status,
          schema: schema ? { kind: 'object' } : undefined,
          fields: responseFields,
        })
        allFields.push(...responseFields)
      }

      endpoints.push({
        id: endpointId,
        method: httpMethod,
        path,
        operationId: operation.operationId,
        summary: operation.summary,
        tags: operation.tags,
        request: pathParams.length || query.length || headers.length
          ? { pathParams: pathParams.length ? pathParams : undefined,
              query: query.length ? query : undefined,
              headers: headers.length ? headers : undefined }
          : undefined,
        responses,
      })
    }
  }

  const schemas: Record<string, ApiSchema> = {}
  if (api.components?.schemas) {
    for (const [name, schema] of Object.entries<any>(api.components.schemas)) {
      schemas[name] = schema as ApiSchema
    }
  }

  return {
    version: '1',
    source: {
      type: 'openapi',
      input: specPath,
      hash,
    },
    generatedAt: new Date().toISOString(),
    endpoints,
    schemas,
    fields: allFields,
  }
}
