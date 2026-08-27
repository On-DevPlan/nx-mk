import { stableFieldId } from './field-id'
import { normalizePath } from './normalizer'
import type { HttpMethod, FieldIdInput } from './field-id'

// ApiField shape (local; re-exported via index in T6)
interface LocalApiField {
  id: string
  endpointId: string
  direction: 'request' | 'response'
  status?: string
  path: string                              // raw field path (e.g. 'data.user.id')
  normalizedPath: string                    // after normalizePath()
  name: string
  type: string                              // OpenAPI type name: 'string' | 'integer' | 'object' | ...
  required?: boolean
  nullable?: boolean
  description?: string
  example?: unknown
  enum?: string[]
  schemaName?: string
  source: { openapiPointer: string }
}

export interface WalkContext extends Omit<FieldIdInput, 'normalizedFieldPath'> {
  endpointId: string
  normalizedFieldPath: string              // CURRENT path prefix being walked
  pointerPrefix?: string                    // JSON Pointer prefix, e.g. '/components/schemas/User'
}

// OpenAPI Schema object subset this walker understands.
interface SchemaNode {
  type?: string
  nullable?: boolean
  description?: string
  example?: unknown
  enum?: string[]
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  required?: string[]
  allOf?: SchemaNode[]
  oneOf?: SchemaNode[]
  anyOf?: SchemaNode[]
}

export function walkSchema(schema: SchemaNode, ctx: WalkContext): LocalApiField[] {
  // Strip a leading '#' defensively so callers may pass either a plain JSON
  // Pointer ('/components/...') or a full $ref-style pointer ('#/components/...').
  const base = (ctx.pointerPrefix ?? '').replace(/^#/, '')
  return walk(schema, ctx, ctx.normalizedFieldPath, ctx.normalizedFieldPath, base)
}

// rawPathSoFar  — dotted raw path, e.g. 'data.tags'
// normPathSoFar — normalized dotted path, e.g. 'data.tags[]'
// ptrSoFar      — JSON Pointer (no leading '#'), e.g. '/properties/tags'
function walk(schema: SchemaNode, ctx: WalkContext, rawPathSoFar: string, normPathSoFar: string, ptrSoFar: string): LocalApiField[] {
  // Handle allOf: merge sub-schemas into one object schema.
  if (Array.isArray(schema?.allOf)) {
    const merged: SchemaNode = { type: 'object', properties: {}, required: [] }
    for (const sub of schema.allOf) {
      const props = sub?.properties ?? {}
      Object.assign(merged.properties!, props)
      if (Array.isArray(sub?.required)) {
        merged.required!.push(...sub.required)
      }
    }
    if (schema.nullable) merged.nullable = true
    return walk(merged, ctx, rawPathSoFar, normPathSoFar, ptrSoFar)
  }

  // Handle oneOf / anyOf: walk each variant, suffix the path with the variant key + index.
  const variantKey = schema?.oneOf ? 'oneOf' : schema?.anyOf ? 'anyOf' : null
  if (variantKey) {
    const fields: LocalApiField[] = []
    const variants: SchemaNode[] = schema[variantKey] ?? []
    variants.forEach((variant: SchemaNode, idx: number) => {
      const variantRaw = `${rawPathSoFar}(${variantKey}[${idx}])`
      const variantNorm = `${normPathSoFar}(${variantKey}[${idx}])`
      const variantPtr = ptrSoFar ? `${ptrSoFar}/${variantKey}/${idx}` : `${variantKey}/${idx}`
      fields.push(...walk(variant, ctx, variantRaw, variantNorm, variantPtr))
    })
    return fields
  }

  // Array: recurse into items. The raw path stays at the array position;
  // the normalized path gains the '[]' suffix (spec §17).
  if (schema?.type === 'array') {
    const items = schema.items ?? {}
    const itemsPtr = ptrSoFar ? `${ptrSoFar}/items` : '/items'
    return walk(items, ctx, rawPathSoFar, `${normPathSoFar}[]`, itemsPtr)
  }

  // Object: emit a descriptor for object-typed properties and flatten children.
  if (schema?.type === 'object' || (schema?.properties && !schema?.type)) {
    const fields: LocalApiField[] = []
    const properties: Record<string, SchemaNode> = schema.properties ?? {}
    const requiredSet = new Set<string>(schema.required ?? [])
    for (const [propName, propSchema] of Object.entries(properties)) {
      const childRaw = rawPathSoFar === '' ? propName : `${rawPathSoFar}.${propName}`
      const childNorm = normPathSoFar === '' ? propName : `${normPathSoFar}.${propName}`
      const childPtr = ptrSoFar ? `${ptrSoFar}/properties/${propName}` : `/properties/${propName}`
      const childFields = walk(propSchema, ctx, childRaw, childNorm, childPtr)

      const isObject = propSchema?.type === 'object' || (propSchema?.properties && !propSchema?.type)
      if (isObject) {
        // Emit parent descriptor first, then the flattened children.
        fields.push({
          id: stableFieldId({
            method: ctx.method,
            path: ctx.path,
            direction: ctx.direction,
            status: ctx.status,
            normalizedFieldPath: childNorm,
          }),
          endpointId: ctx.endpointId,
          direction: ctx.direction,
          status: ctx.status,
          path: childRaw,
          normalizedPath: childNorm,
          name: propName,
          type: 'object',
          required: requiredSet.has(propName) ? true : undefined,
          nullable: propSchema?.nullable ? true : undefined,
          source: { openapiPointer: childPtr },
        })
        fields.push(...childFields)
      } else {
        // Leaf (primitive or array-of-primitive): childFields[0] is the leaf
        // descriptor — promote its name/source to the property. Keep any
        // extra fields (array-of-object children) so they are not lost.
        const [first, ...rest] = childFields
        fields.push({
          ...first!,
          name: propName,
          required: requiredSet.has(propName) ? true : undefined,
          source: { openapiPointer: childPtr },
        })
        fields.push(...rest)
      }
    }
    return fields
  }

  // Primitive: emit a single field descriptor.
  const field: LocalApiField = {
    id: stableFieldId({
      method: ctx.method,
      path: ctx.path,
      direction: ctx.direction,
      status: ctx.status,
      normalizedFieldPath: normPathSoFar,
    }),
    endpointId: ctx.endpointId,
    direction: ctx.direction,
    status: ctx.status,
    path: rawPathSoFar,
    normalizedPath: normalizePath(normPathSoFar),
    name: '',                          // caller (object loop) overrides
    type: schema?.type ?? 'unknown',
    required: undefined,
    nullable: schema?.nullable ? true : undefined,
    description: schema?.description,
    example: schema?.example,
    enum: schema?.enum,
    source: { openapiPointer: ptrSoFar ? ptrSoFar : '' },
  }
  return [field]
}
