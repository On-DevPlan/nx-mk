import { createHash } from 'node:crypto'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

export interface FieldIdInput {
  method: HttpMethod
  path: string                              // OpenAPI path template, e.g. '/users/{id}'
  direction: 'request' | 'response'
  status?: string                           // only for response
  normalizedFieldPath: string              // e.g. 'data[].user.id'
}

export function stableFieldId(input: FieldIdInput): string {
  const raw = [
    input.method,
    input.path,
    input.direction,
    input.status ?? '',
    input.normalizedFieldPath,
  ].join(':')
  return createHash('sha1').update(raw).digest('hex').slice(0, 12)
}
