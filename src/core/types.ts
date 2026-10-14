export type ParameterValue = string | number | boolean | string[]

export type FieldType = 'select' | 'segments' | 'toggle' | 'range' | 'number' | 'multi' | 'text'

export interface FieldOption {
  value: string
  label: string
}

export interface FieldDef {
  key: string
  label: string
  description?: string
  section?: string
  type: FieldType
  default: ParameterValue
  options?: FieldOption[]
  min?: number
  max?: number
  step?: number
  unit?: string
  /** Показывать поле, только когда другое поле имеет конкретное значение. */
  requires?: { key: string; value: ParameterValue }
}

/**
 * Перекрёстные правила внутри одной категории: «A меньше B», «поле обязательно при X»,
 * «при X значение поля равно Y» и «при X >= min включи Y».
 */
export type CrossRule =
  | { id: string; type: 'ordered'; message: string; smaller: string; larger: string }
  | { id: string; type: 'nonEmpty'; message: string; field: string; when: { key: string; value: ParameterValue } }
  | { id: string; type: 'requiresValue'; message: string; field: string; equals: ParameterValue; when: { key: string; value: ParameterValue } }
  /** Когда числовое поле >= min, другое поле обязано иметь конкретное значение. */
  | { id: string; type: 'implies'; message: string; when: { key: string; min: number }; then: { key: string; equals: ParameterValue } }

export interface KindDef {
  id: string
  label: string
  /** Рекомендованный интервал между запусками, сек. */
  delay?: number
  fields: FieldDef[]
  rules?: CrossRule[]
}

export interface Catalog {
  version: 1
  title: string
  kinds: KindDef[]
}

export interface ExecutionSettings {
  startDelay: number
  intervalMode: 'fixed' | 'variable'
  variation: number
  breakEvery: number
  breakSeconds: number
  maxMinutes: number
  notifications: 'silent' | 'finish' | 'all'
}

export interface SafetySettings {
  confidence: number
  cycleTimeout: number
  onError: 'retry' | 'skip' | 'stop'
  retryLimit: number
  retryDelay: number
  pauseWhenHidden: boolean
  logLevel: 'errors' | 'normal' | 'verbose'
}

export interface MacroAutomation {
  version: 1
  parameters: Record<string, ParameterValue>
  execution: ExecutionSettings
  safety: SafetySettings
}

export interface Macro {
  id: string
  name: string
  description: string
  kind: string
  enabled: boolean
  cycles: number
  delay: number
  repeats: number
  automation: MacroAutomation
}

export interface MacroGroup {
  id: string
  name: string
  description: string
  color: string
  macroIds: string[]
}

export interface ConfigSettings {
  notifications: boolean
  compact: boolean
  animations: boolean
  stopOnError: boolean
  shortcut: 'F6' | 'F8' | 'F9'
}

export interface WorkspaceConfig {
  version: 1
  name: string
  description: string
  exportedAt: string
  macros: Macro[]
  groups: MacroGroup[]
  settings: ConfigSettings
}

export interface Issue {
  path: string
  message: string
  level: 'error' | 'warning'
}

export interface ValidationResult {
  ok: boolean
  issues: Issue[]
  config?: WorkspaceConfig
}
