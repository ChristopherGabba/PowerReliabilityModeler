import { z } from 'zod'
import { CATALOG } from './catalog'
import { endpointPosition, distance, routeConnector, worldPoint } from './geometry'
import {
  EQUIPMENT_TYPES,
  uid,
  type DocumentRecord,
  type ModelFile,
  type ConnectionRef,
  type Patch,
} from './types'

const id = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => v === v.trim(), 'IDs must not have leading or trailing spaces')
const number = z.number().finite()
const point = z.object({ x: number, y: number }).strict()
const viewport = point.extend({ zoom: number.min(0.02).max(8) })
const header = {
  schema_version: z.literal(1),
  model_name: z.string().trim().min(1).max(200),
  model_revision: z.string().max(80),
  model_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
      'Invalid model date',
    ),
}
const equipmentBase = point.extend({
  id,
  equipment_type: z.enum(EQUIPMENT_TYPES),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  kv_rating: number.nonnegative().nullable(),
  amp_rating: number.nonnegative().nullable(),
  derating_multiplier: number.min(0).max(1),
  bus_length: number.min(40).optional(),
})
const endpoint = z.object({ equipment_id: id, port_id: id, tap_offset: number.optional() }).strict()
const endpointRecord = z
  .object({ equipment_key: id, port_id: id, tap_offset: number.optional() })
  .strict()
const connectorBase = {
  id,
  points: z.array(point).min(2),
  routing: z.enum(['auto', 'manual']),
  bends: z.array(point),
}
const ref = z
  .object({ connector_id: id, port_id: id, connected_equipment_id: id, connected_port_id: id })
  .strict()
const publicSchema = z
  .object({
    ...header,
    equipment: z.array(equipmentBase.extend({ connections: z.array(ref) })),
    connectors: z.array(z.object({ ...connectorBase, from: endpoint, to: endpoint }).strict()),
    failovers: z.array(
      z
        .object({ equipment_id: id, failover_trigger_ids: z.array(id).min(1), failover_parent: id })
        .strict(),
    ),
    groups: z.array(z.object({ id, equipment_ids: z.array(id).min(2) }).strict()),
    viewport,
  })
  .strict()
const equipmentSchema = equipmentBase.extend({ key: id }).strict()
const connectorSchema = z
  .object({ ...connectorBase, from: endpointRecord, to: endpointRecord })
  .strict()
const failoverSchema = z
  .object({ equipment_key: id, trigger_keys: z.array(id), parent_key: id.nullable() })
  .strict()
const groupSchema = z.object({ id, equipment_keys: z.array(id).min(2) }).strict()
const documentSchema = z
  .object({
    ...header,
    equipment: z.array(equipmentSchema),
    connectors: z.array(connectorSchema),
    failovers: z.array(failoverSchema),
    groups: z.array(groupSchema),
    viewport,
  })
  .strict()
export const patchSchema = z
  .object({
    equipment: z.object({ put: z.array(equipmentSchema), remove: z.array(id) }).strict(),
    connectors: z.object({ put: z.array(connectorSchema), remove: z.array(id) }).strict(),
    failovers: z.array(failoverSchema).optional(),
    groups: z.array(groupSchema).optional(),
    header: z
      .object({
        model_name: header.model_name,
        model_revision: header.model_revision,
        model_date: header.model_date,
      })
      .strict()
      .optional(),
    viewport: viewport.optional(),
  })
  .strict()

function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`)
}
export function validateDocument(input: unknown, complete = false): DocumentRecord {
  const d = documentSchema.parse(input) as DocumentRecord
  unique(
    d.equipment.map((e) => e.id),
    'equipment ID',
  )
  unique(
    d.equipment.map((e) => e.key),
    'internal equipment key',
  )
  unique(
    d.connectors.map((c) => c.id),
    'connector ID',
  )
  unique(
    d.groups.map((g) => g.id),
    'group ID',
  )
  unique(
    d.failovers.map((f) => f.equipment_key),
    'failover owner',
  )
  const equipment = new Map(d.equipment.map((e) => [e.key, e]))
  const used = new Set<string>()
  const membership = new Set<string>()
  for (const e of d.equipment) {
    if (e.equipment_type === 'bus' && e.bus_length === undefined)
      throw new Error(`Bus ${e.id} needs a length`)
    if (e.equipment_type !== 'bus' && e.bus_length !== undefined)
      throw new Error('Only buses have a bus length')
  }
  for (const c of d.connectors) {
    let shortenedDisconnect = false
    if (c.from.equipment_key === c.to.equipment_key)
      throw new Error(`Connector ${c.id} cannot connect equipment to itself`)
    for (const [ep, position] of [
      [c.from, c.points[0]],
      [c.to, c.points.at(-1)!],
    ] as const) {
      const e = equipment.get(ep.equipment_key)
      if (!e) throw new Error(`Connector ${c.id} references missing equipment`)
      if (e.equipment_type === 'bus') {
        if (
          ep.port_id !== 'bar' ||
          ep.tap_offset === undefined ||
          Math.abs(ep.tap_offset) > (e.bus_length ?? 200) / 2 + 0.001
        )
          throw new Error(`Invalid bus tap on ${c.id}`)
      } else {
        if (
          !CATALOG[e.equipment_type].ports.some((p) => p.id === ep.port_id) ||
          ep.tap_offset !== undefined
        )
          throw new Error(`Invalid terminal on ${c.id}`)
        const key = `${e.key}/${ep.port_id}`
        if (used.has(key))
          throw new Error(`Terminal ${e.id}.${ep.port_id} has more than one connector`)
        used.add(key)
      }
      if (distance(endpointPosition(e, ep), position) > 0.01) {
        // Earlier disconnects had terminals at +/-40. Accept only those exact
        // former endpoints, then rebuild the derived route for the shorter icon.
        const oldTerminal = worldPoint(e, { x: 0, y: ep.port_id === 'in' ? -40 : 40 })
        if (e.equipment_type === 'disconnect_switch' && distance(oldTerminal, position) <= 0.01)
          shortenedDisconnect = true
        else throw new Error(`Connector ${c.id} endpoint coordinates do not match its equipment`)
      }
    }
    for (let i = 1; i < c.points.length; i++) {
      const a = c.points[i - 1],
        b = c.points[i]
      if (Math.abs(a.x - b.x) > 0.01 && Math.abs(a.y - b.y) > 0.01)
        throw new Error(`Connector ${c.id} must have orthogonal segments`)
    }
    if (shortenedDisconnect) c.points = routeConnector(c, equipment)
  }
  for (const f of d.failovers) {
    if (!equipment.has(f.equipment_key)) throw new Error('Failover references missing equipment')
    unique(f.trigger_keys, 'failover trigger')
    if (f.trigger_keys.some((k) => !equipment.has(k)))
      throw new Error('Failover references a missing trigger')
    if (f.parent_key !== null && (!equipment.has(f.parent_key) || f.parent_key === f.equipment_key))
      throw new Error('Failover Target must be another existing equipment item')
    if (complete && (!f.parent_key || !f.trigger_keys.length))
      throw new Error(
        `Complete or remove the failover for ${equipment.get(f.equipment_key)!.id} before exporting`,
      )
  }
  for (const g of d.groups) {
    unique(g.equipment_keys, 'group member')
    for (const key of g.equipment_keys) {
      if (!equipment.has(key) || membership.has(key))
        throw new Error('Groups must contain existing equipment with no overlapping memberships')
      membership.add(key)
    }
  }
  return d
}
export function exportModel(input: DocumentRecord): ModelFile {
  const d = validateDocument(input, true)
  d.equipment.sort((a, b) => a.id.localeCompare(b.id))
  d.connectors.sort((a, b) => a.id.localeCompare(b.id))
  const ids = new Map(d.equipment.map((e) => [e.key, e.id]))
  const refs = new Map<string, ConnectionRef[]>(d.equipment.map((e) => [e.key, []]))
  for (const c of d.connectors) {
    refs.get(c.from.equipment_key)!.push({
      connector_id: c.id,
      port_id: c.from.port_id,
      connected_equipment_id: ids.get(c.to.equipment_key)!,
      connected_port_id: c.to.port_id,
    })
    refs.get(c.to.equipment_key)!.push({
      connector_id: c.id,
      port_id: c.to.port_id,
      connected_equipment_id: ids.get(c.from.equipment_key)!,
      connected_port_id: c.from.port_id,
    })
  }
  return {
    schema_version: 1,
    model_name: d.model_name,
    model_revision: d.model_revision,
    model_date: d.model_date,
    equipment: d.equipment.map(({ key, ...e }) => ({ ...e, connections: refs.get(key)! })),
    connectors: d.connectors.map((c) => ({
      ...c,
      from: {
        equipment_id: ids.get(c.from.equipment_key)!,
        port_id: c.from.port_id,
        ...(c.from.tap_offset === undefined ? {} : { tap_offset: c.from.tap_offset }),
      },
      to: {
        equipment_id: ids.get(c.to.equipment_key)!,
        port_id: c.to.port_id,
        ...(c.to.tap_offset === undefined ? {} : { tap_offset: c.to.tap_offset }),
      },
    })),
    failovers: d.failovers.map((f) => ({
      equipment_id: ids.get(f.equipment_key)!,
      failover_trigger_ids: f.trigger_keys.map((k) => ids.get(k)!),
      failover_parent: ids.get(f.parent_key!)!,
    })),
    groups: d.groups.map((g) => ({
      id: g.id,
      equipment_ids: g.equipment_keys.map((k) => ids.get(k)!),
    })),
    viewport: d.viewport,
  }
}
export function importModel(input: unknown): DocumentRecord {
  const f = publicSchema.parse(input) as ModelFile
  unique(
    f.equipment.map((e) => e.id),
    'equipment ID',
  )
  const keys = new Map(f.equipment.map((e) => [e.id, uid()]))
  const key = (id: string) => {
    const k = keys.get(id)
    if (!k) throw new Error(`Missing equipment ${id}`)
    return k
  }
  const d: DocumentRecord = {
    ...f,
    equipment: f.equipment.map(({ connections: _, ...e }) => ({ ...e, key: key(e.id) })),
    connectors: f.connectors.map((c) => ({
      ...c,
      from: {
        equipment_key: key(c.from.equipment_id),
        port_id: c.from.port_id,
        ...(c.from.tap_offset === undefined ? {} : { tap_offset: c.from.tap_offset }),
      },
      to: {
        equipment_key: key(c.to.equipment_id),
        port_id: c.to.port_id,
        ...(c.to.tap_offset === undefined ? {} : { tap_offset: c.to.tap_offset }),
      },
    })),
    failovers: f.failovers.map((v) => ({
      equipment_key: key(v.equipment_id),
      trigger_keys: v.failover_trigger_ids.map(key),
      parent_key: v.failover_parent ? key(v.failover_parent) : null,
    })),
    groups: f.groups.map((g) => ({ id: g.id, equipment_keys: g.equipment_ids.map(key) })),
  }
  const validated = validateDocument(d, true)
  const expected = exportModel(validated)
  const normalize = (r: ConnectionRef[]) =>
    JSON.stringify(
      [...r]
        .sort((a, b) => a.connector_id.localeCompare(b.connector_id))
        .map((v) => [v.connector_id, v.port_id, v.connected_equipment_id, v.connected_port_id]),
    )
  const expectedById = new Map(expected.equipment.map((e) => [e.id, e]))
  for (const equipment of f.equipment)
    if (normalize(equipment.connections) !== normalize(expectedById.get(equipment.id)!.connections))
      throw new Error(`Connection references disagree for ${equipment.id}`)
  return validated
}
export function applyPatch(document: DocumentRecord, patch: Patch): DocumentRecord {
  const p = patchSchema.parse(patch)
  const equipment = new Map(document.equipment.map((e) => [e.key, e]))
  const connectors = new Map(document.connectors.map((c) => [c.id, c]))
  for (const k of p.equipment.remove) equipment.delete(k)
  for (const e of p.equipment.put) equipment.set(e.key, e)
  for (const k of p.connectors.remove) connectors.delete(k)
  for (const c of p.connectors.put) connectors.set(c.id, c)
  return validateDocument({
    ...document,
    ...p.header,
    viewport: p.viewport ?? document.viewport,
    equipment: [...equipment.values()],
    connectors: [...connectors.values()],
    failovers: p.failovers ?? document.failovers,
    groups: p.groups ?? document.groups,
  })
}
export function diffDocuments(before: DocumentRecord, after: DocumentRecord): Patch {
  function changed<T>(a: T[], b: T[], get: (v: T) => string) {
    const old = new Map(a.map((v) => [get(v), v]))
    const next = new Set(b.map(get))
    return {
      put: b.filter((v) => JSON.stringify(old.get(get(v))) !== JSON.stringify(v)),
      remove: a.filter((v) => !next.has(get(v))).map(get),
    }
  }
  return {
    equipment: changed(before.equipment, after.equipment, (e) => e.key),
    connectors: changed(before.connectors, after.connectors, (c) => c.id),
    ...(JSON.stringify(before.failovers) === JSON.stringify(after.failovers)
      ? {}
      : { failovers: after.failovers }),
    ...(JSON.stringify(before.groups) === JSON.stringify(after.groups)
      ? {}
      : { groups: after.groups }),
    ...(['model_name', 'model_revision', 'model_date'].some(
      (k) => before[k as keyof DocumentRecord] !== after[k as keyof DocumentRecord],
    )
      ? {
          header: {
            model_name: after.model_name,
            model_revision: after.model_revision,
            model_date: after.model_date,
          },
        }
      : {}),
    ...(JSON.stringify(before.viewport) === JSON.stringify(after.viewport)
      ? {}
      : { viewport: after.viewport }),
  }
}
export function errorMessage(e: unknown): string {
  return e instanceof z.ZodError
    ? e.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')
    : e instanceof Error
      ? e.message
      : String(e)
}
