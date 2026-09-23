export const EQUIPMENT_TYPES = [
  'utility_source',
  'indoor_drawout_breaker',
  'outdoor_mv_hv_breaker',
  'disconnect_switch',
  'oil_filled_transformer',
  'dry_type_transformer',
  'load',
  'bus',
  'ring_main_unit',
  'cable',
  'generator',
] as const
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number]
export type Point = { x: number; y: number }
export type Viewport = Point & { zoom: number }
export type ConnectionRef = {
  connector_id: string
  port_id: string
  connected_equipment_id: string
  connected_port_id: string
}
export type Equipment = Point & {
  id: string
  equipment_type: EquipmentType
  rotation: number
  kv_rating: number | null
  amp_rating: number | null
  derating_multiplier: number
  connections: ConnectionRef[]
  bus_length?: number
}
export type Endpoint = { equipment_id: string; port_id: string; tap_offset?: number }
export type Connector = {
  id: string
  from: Endpoint
  to: Endpoint
  points: Point[]
  routing: 'auto' | 'manual'
  bends: Point[]
}
export type Failover = {
  equipment_id: string
  failover_trigger_ids: string[]
  failover_parent: string | null
}
export type ModelFile = {
  schema_version: 1
  model_name: string
  model_revision: string
  model_date: string
  equipment: Equipment[]
  connectors: Connector[]
  failovers: Failover[]
  viewport: Viewport
}
// Stable keys are private to the editor and cloud document. Public IDs remain human editable.
export type EquipmentRecord = Omit<Equipment, 'connections'> & { key: string }
export type EndpointRecord = Omit<Endpoint, 'equipment_id'> & { equipment_key: string }
export type ConnectorRecord = Omit<Connector, 'from' | 'to'> & {
  from: EndpointRecord
  to: EndpointRecord
}
export type FailoverRecord = {
  equipment_key: string
  trigger_keys: string[]
  parent_key: string | null
}
export type GroupRecord = { id: string; equipment_keys: string[] }
export type DocumentRecord = {
  schema_version: 1
  model_name: string
  model_revision: string
  model_date: string
  equipment: EquipmentRecord[]
  connectors: ConnectorRecord[]
  failovers: FailoverRecord[]
  groups: GroupRecord[]
  viewport: Viewport
}
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
export type Port = { id: string; x: number; y: number; dx: number; dy: number }
export type Patch = {
  equipment: { put: EquipmentRecord[]; remove: string[] }
  connectors: { put: ConnectorRecord[]; remove: string[] }
  failovers?: FailoverRecord[]
  groups?: GroupRecord[]
  header?: Pick<DocumentRecord, 'model_name' | 'model_revision' | 'model_date'>
  viewport?: Viewport
}
export type ProjectSummary = {
  id: string
  name: string
  created_at: string
  updated_at: string
  equipment_count: number
}
export type CloudDocument = {
  label_offsets?: import('./labels').LabelOffsets
  document: DocumentRecord
  revision: number
}
export const localDate = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const uid = () => crypto.randomUUID()
export function emptyDocument(name = 'Untitled model'): DocumentRecord {
  return {
    schema_version: 1,
    model_name: name,
    model_revision: '1',
    model_date: localDate(),
    equipment: [],
    connectors: [],
    failovers: [],
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}
