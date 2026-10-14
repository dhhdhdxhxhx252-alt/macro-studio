import {
  EXECUTION_BOUNDS,
  INTERVAL_MODES,
  LOG_LEVELS,
  NOTIFICATION_MODES,
  ON_ERROR_MODES,
  SAFETY_BOUNDS,
  defaultAutomation,
  parametersFromCatalog,
  validateCatalog,
} from './catalog.js'
import type { Catalog, ConfigSettings, CrossRule, FieldDef, Issue, KindDef, Macro, MacroAutomation, ParameterValue, WorkspaceConfig } from './types.js'

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/
const RESERVED = ['constructor', 'prototype', '__proto__']
const COLOR = /^#[0-9a-f]{6}$/i

export function newMacroId(kind: string, taken: Set<string>): string {
  let candidate = `${kind}-1`
  let n = 2
  while (taken.has(candidate)) candidate = `${kind}-${n++}`
  return candidate
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sameValue(a: ParameterValue | undefined, b: ParameterValue): boolean {
  if (Array.isArray(b)) return Array.isArray(a) && b.length === a.length && b.every((item, i) => item === a[i])
  return a === b
}

function checkNumber(issues: Issue[], path: string, label: string, value: unknown, min: number, max: number, step = 1, fallback = min): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({ path, level: 'error', message: `${label}: ожидалось число.` })
    return fallback
  }
  if (value < min || value > max) {
    issues.push({ path, level: 'error', message: `${label}: допустимо ${min}..${max}, получено ${value}.` })
    return Math.min(max, Math.max(min, value))
  }
  const steps = (value - min) / step
  if (Math.abs(steps - Math.round(steps)) > 1e-6) {
    issues.push({ path, level: 'warning', message: `${label}: значение ${value} не лежит на шаге ${step}.` })
  }
  return value
}

function checkChoice<T extends string>(issues: Issue[], path: string, label: string, value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  issues.push({ path, level: 'error', message: `${label}: неизвестное значение «${String(value)}». Ожидается одно из: ${allowed.join(', ')}.` })
  return fallback
}

function checkBoolean(issues: Issue[], path: string, label: string, value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  issues.push({ path, level: 'error', message: `${label}: ожидался переключатель true / false.` })
  return fallback
}

function checkField(issues: Issue[], path: string, field: FieldDef, value: unknown): ParameterValue {
  const label = field.label
  if (field.type === 'toggle') return checkBoolean(issues, path, label, value, field.default as boolean)

  if (field.type === 'number' || field.type === 'range') {
    return checkNumber(issues, path, label, value, field.min ?? 0, field.max ?? 9999, field.step ?? 1, field.default as number)
  }

  if (field.type === 'text') {
    if (typeof value !== 'string') {
      issues.push({ path, level: 'error', message: `${label}: ожидался текст.` })
      return field.default
    }
    const limit = field.max ?? 60
    if (value.length > limit) {
      issues.push({ path, level: 'error', message: `${label}: максимум ${limit} символов, сейчас ${value.length}.` })
    }
    return value.trim()
  }

  const allowed = (field.options ?? []).map((option) => option.value)

  if (field.type === 'multi') {
    if (!Array.isArray(value) || !value.length) {
      issues.push({ path, level: 'error', message: `${label}: выберите хотя бы один вариант.` })
      return field.default
    }
    const seen = new Set<string>()
    const kept: string[] = []
    for (const item of value) {
      if (!allowed.includes(item as string)) {
        issues.push({ path, level: 'error', message: `${label}: неизвестный вариант «${String(item)}».` })
        continue
      }
      if (seen.has(item as string)) continue
      seen.add(item as string)
      kept.push(item as string)
    }
    return kept.length ? kept : field.default
  }

  if (typeof value === 'string' && allowed.includes(value)) return value
  issues.push({ path, level: 'error', message: `${label}: неизвестное значение «${String(value)}».` })
  return field.default
}

function applyRule(issues: Issue[], rule: CrossRule, parameters: Record<string, ParameterValue>): void {
  const at = (key: string) => `automation.parameters.${key}`
  if (rule.type === 'ordered') {
    const a = Number(parameters[rule.smaller])
    const b = Number(parameters[rule.larger])
    if (Number.isFinite(a) && Number.isFinite(b) && a >= b) issues.push({ path: at(rule.larger), level: 'error', message: rule.message })
    return
  }
  if (rule.type === 'nonEmpty') {
    if (!sameValue(parameters[rule.when.key], rule.when.value)) return
    if (!String(parameters[rule.field] ?? '').trim()) issues.push({ path: at(rule.field), level: 'error', message: rule.message })
    return
  }
  if (rule.type === 'requiresValue') {
    if (!sameValue(parameters[rule.when.key], rule.when.value)) return
    if (!sameValue(parameters[rule.field], rule.equals)) issues.push({ path: at(rule.field), level: 'error', message: rule.message })
    return
  }
  const current = Number(parameters[rule.when.key])
  if (!Number.isFinite(current) || current < rule.when.min) return
  if (!sameValue(parameters[rule.then.key], rule.then.equals)) issues.push({ path: at(rule.then.key), level: 'error', message: rule.message })
}

/**
 * Приводит automation к каталогу: неизвестные поля отбрасываются, отсутствующие берутся из default,
 * ошибки собираются в список, а не выбрасываются — редактору нужно показывать все проблемы сразу.
 */
export function normalizeAutomation(kind: KindDef, raw: unknown): { automation: MacroAutomation; issues: Issue[] } {
  const issues: Issue[] = []
  const base = defaultAutomation()
  const automation: MacroAutomation = { ...base, parameters: parametersFromCatalog(kind), execution: { ...base.execution }, safety: { ...base.safety } }

  if (raw === undefined || raw === null) return { automation, issues }
  if (!isPlainObject(raw)) {
    issues.push({ path: 'automation', level: 'error', message: 'automation должен быть объектом.' })
    return { automation, issues }
  }
  if (raw.version !== 1) issues.push({ path: 'automation.version', level: 'error', message: 'Неизвестная версия automation: нужен 1.' })

  const rawParameters = raw.parameters
  if (rawParameters !== undefined && !isPlainObject(rawParameters)) {
    issues.push({ path: 'automation.parameters', level: 'error', message: 'parameters должен быть объектом.' })
  }
  const given = isPlainObject(rawParameters) ? rawParameters : {}
  for (const key of Object.keys(given)) {
    if (!kind.fields.some((field) => field.key === key)) {
      issues.push({ path: `automation.parameters.${key}`, level: 'warning', message: 'Поля нет в каталоге — оно будет отброшено при импорте.' })
    }
  }
  for (const field of kind.fields) {
    const value = given[field.key] === undefined ? automation.parameters[field.key] : given[field.key]
    automation.parameters[field.key] = checkField(issues, `automation.parameters.${field.key}`, field, value)
  }

  const e = { ...base.execution, ...(isPlainObject(raw.execution) ? raw.execution : {}) }
  const eb = EXECUTION_BOUNDS
  automation.execution = {
    startDelay: checkNumber(issues, 'automation.execution.startDelay', 'Задержка старта', e.startDelay, eb.startDelay.min, eb.startDelay.max),
    intervalMode: checkChoice(issues, 'automation.execution.intervalMode', 'Тип интервала', e.intervalMode, INTERVAL_MODES, 'fixed'),
    variation: checkNumber(issues, 'automation.execution.variation', 'Разброс интервала', e.variation, eb.variation.min, eb.variation.max, eb.variation.step),
    breakEvery: checkNumber(issues, 'automation.execution.breakEvery', 'Частота перерыва', e.breakEvery, eb.breakEvery.min, eb.breakEvery.max),
    breakSeconds: checkNumber(issues, 'automation.execution.breakSeconds', 'Длительность перерыва', e.breakSeconds, eb.breakSeconds.min, eb.breakSeconds.max, eb.breakSeconds.step),
    maxMinutes: checkNumber(issues, 'automation.execution.maxMinutes', 'Лимит времени', e.maxMinutes, eb.maxMinutes.min, eb.maxMinutes.max),
    notifications: checkChoice(issues, 'automation.execution.notifications', 'Уведомления', e.notifications, NOTIFICATION_MODES, 'finish'),
  }

  const s = { ...base.safety, ...(isPlainObject(raw.safety) ? raw.safety : {}) }
  const sb = SAFETY_BOUNDS
  automation.safety = {
    confidence: checkNumber(issues, 'automation.safety.confidence', 'Порог распознавания', s.confidence, sb.confidence.min, sb.confidence.max),
    cycleTimeout: checkNumber(issues, 'automation.safety.cycleTimeout', 'Тайм-аут цикла', s.cycleTimeout, sb.cycleTimeout.min, sb.cycleTimeout.max, sb.cycleTimeout.step),
    onError: checkChoice(issues, 'automation.safety.onError', 'При ошибке', s.onError, ON_ERROR_MODES, 'retry'),
    retryLimit: checkNumber(issues, 'automation.safety.retryLimit', 'Число повторных попыток', s.retryLimit, sb.retryLimit.min, sb.retryLimit.max),
    retryDelay: checkNumber(issues, 'automation.safety.retryDelay', 'Пауза перед повтором', s.retryDelay, sb.retryDelay.min, sb.retryDelay.max),
    pauseWhenHidden: checkBoolean(issues, 'automation.safety.pauseWhenHidden', 'Пауза в фоновом окне', s.pauseWhenHidden, true),
    logLevel: checkChoice(issues, 'automation.safety.logLevel', 'Подробность журнала', s.logLevel, LOG_LEVELS, 'normal'),
  }

  for (const rule of kind.rules ?? []) applyRule(issues, rule, automation.parameters)

  return { automation, issues }
}

function checkId(issues: Issue[], path: string, label: string, value: unknown, taken: Set<string>): string {
  if (typeof value !== 'string' || !ID.test(value) || RESERVED.includes(value)) {
    issues.push({ path, level: 'error', message: `${label}: некорректный идентификатор «${String(value)}».` })
    return ''
  }
  if (taken.has(value)) {
    issues.push({ path, level: 'error', message: `${label}: идентификатор «${value}» повторяется.` })
    return value
  }
  taken.add(value)
  return value
}

function checkText(issues: Issue[], path: string, label: string, value: unknown, max: number, allowEmpty: boolean, fallback = ''): string {
  if (typeof value !== 'string') {
    issues.push({ path, level: 'error', message: `${label}: ожидался текст.` })
    return fallback
  }
  if (!allowEmpty && !value.trim()) {
    issues.push({ path, level: 'error', message: `${label}: не может быть пустым.` })
    return fallback
  }
  if (value.length > max) issues.push({ path, level: 'error', message: `${label}: максимум ${max} символов, сейчас ${value.length}.` })
  return value.trim()
}

function checkInt(issues: Issue[], path: string, label: string, value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    issues.push({ path, level: 'error', message: `${label}: допустимо целое ${min}..${max}.` })
    return fallback
  }
  return value
}

export function checkSettings(value: unknown): { settings: ConfigSettings; issues: Issue[] } {
  const issues: Issue[] = []
  const source = isPlainObject(value) ? value : {}
  if (!isPlainObject(value)) issues.push({ path: 'settings', level: 'error', message: 'settings должен быть объектом.' })
  const shortcut = source.shortcut
  if (shortcut !== 'F6' && shortcut !== 'F8' && shortcut !== 'F9') {
    issues.push({ path: 'settings.shortcut', level: 'error', message: `Горячая клавиша должна быть F6, F8 или F9, получено «${String(shortcut)}».` })
  }
  if (source.stopOnError !== undefined && source.stopOnError !== true) {
    issues.push({ path: 'settings.stopOnError', level: 'warning', message: 'Формат всегда фиксирует stopOnError = true — значение будет переписано.' })
  }
  return {
    settings: {
      notifications: typeof source.notifications === 'boolean' ? source.notifications : true,
      compact: typeof source.compact === 'boolean' ? source.compact : false,
      animations: typeof source.animations === 'boolean' ? source.animations : true,
      stopOnError: true,
      shortcut: (shortcut === 'F6' || shortcut === 'F8' || shortcut === 'F9' ? shortcut : 'F8') as ConfigSettings['shortcut'],
    },
    issues,
  }
}

/** Полный разбор конфигурации: валидация + нормализация в один проход. */
export function validateConfig(raw: unknown, catalog: Catalog): { ok: boolean; issues: Issue[]; config?: WorkspaceConfig } {
  const catalogIssues = validateCatalog(catalog)
  if (catalogIssues.length) return { ok: false, issues: catalogIssues.map((i) => ({ ...i, path: `catalog.${i.path}` })) }

  const issues: Issue[] = []
  const kinds = new Map(catalog.kinds.map((kind) => [kind.id, kind]))

  if (!isPlainObject(raw)) {
    return { ok: false, issues: [{ path: '', level: 'error', message: 'Конфигурация должна быть JSON-объектом.' }] }
  }
  if (raw.version !== 1) {
    issues.push({ path: 'version', level: 'error', message: `Версия ${String(raw.version)} не поддерживается: нужен 1.` })
  }
  const name = checkText(issues, 'name', 'Название конфига', raw.name, 60, false, 'Без имени')
  const description = checkText(issues, 'description', 'Описание конфига', raw.description ?? '', 160, true)

  if (!Array.isArray(raw.macros) || raw.macros.length > 200) {
    issues.push({ path: 'macros', level: 'error', message: 'macros должен быть массивом не длиннее 200 элементов.' })
  }
  const macroIds = new Set<string>()
  const macros: Macro[] = (Array.isArray(raw.macros) ? raw.macros : []).map((value, index) => {
    const at = `macros[${index}]`
    if (!isPlainObject(value)) {
      issues.push({ path: at, level: 'error', message: 'Макрос должен быть объектом.' })
      return { id: '', name: '', description: '', kind: catalog.kinds[0].id, enabled: false, cycles: 0, delay: 1, repeats: 0, automation: defaultAutomation() }
    }
    const id = checkId(issues, `${at}.id`, 'ID макроса', value.id, macroIds)
    const kindId = typeof value.kind === 'string' ? value.kind : ''
    const kind = kinds.get(kindId)
    if (!kind) issues.push({ path: `${at}.kind`, level: 'error', message: `Неизвестная категория «${kindId || '—'}». Есть: ${catalog.kinds.map((k) => k.id).join(', ')}.` })
    const resolved: KindDef = kind ?? catalog.kinds[0]
    const normalized = normalizeAutomation(resolved, value.automation)
    issues.push(...normalized.issues.map((i) => ({ ...i, path: `${at}.${i.path}` })))
    const automation = normalized.automation

    const delay = checkInt(issues, `${at}.delay`, 'Интервал', value.delay, 1, 60, resolved.delay ?? 5)
    return {
      id,
      kind: resolved.id,
      name: checkText(issues, `${at}.name`, 'Название макроса', value.name, 40, false),
      description: checkText(issues, `${at}.description`, 'Описание макроса', value.description ?? '', 90, true),
      enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
      cycles: checkInt(issues, `${at}.cycles`, 'Количество циклов', value.cycles ?? 0, 0, Number.MAX_SAFE_INTEGER, 0),
      delay,
      repeats: checkInt(issues, `${at}.repeats`, 'Повторения', value.repeats ?? 0, 0, 9999, 0),
      automation,
    }
  })

  if (!Array.isArray(raw.groups) || raw.groups.length > 100) {
    issues.push({ path: 'groups', level: 'error', message: 'groups должен быть массивом не длиннее 100 элементов.' })
  }
  const groupIds = new Set<string>()
  const groups = (Array.isArray(raw.groups) ? raw.groups : []).map((value, index) => {
    const at = `groups[${index}]`
    if (!isPlainObject(value)) {
      issues.push({ path: at, level: 'error', message: 'Группа должна быть объектом.' })
      return { id: '', name: '', description: '', color: '#a578ff', macroIds: [] }
    }
    const id = checkId(issues, `${at}.id`, 'ID группы', value.id, groupIds)
    const color = typeof value.color === 'string' && COLOR.test(value.color) ? value.color : (() => {
      issues.push({ path: `${at}.color`, level: 'error', message: 'Цвет группы должен быть в формате #RRGGBB.' })
      return '#a578ff'
    })()
    const refs = Array.isArray(value.macroIds) ? value.macroIds : []
    if (!Array.isArray(value.macroIds)) issues.push({ path: `${at}.macroIds`, level: 'error', message: 'macroIds должен быть массивом.' })
    const ids: string[] = []
    for (const ref of refs) {
      if (typeof ref !== 'string' || !macroIds.has(ref)) {
        issues.push({ path: `${at}.macroIds`, level: 'error', message: `Группа ссылается на отсутствующий макрос «${String(ref)}».` })
        continue
      }
      if (!ids.includes(ref)) ids.push(ref)
    }
    return {
      id,
      name: checkText(issues, `${at}.name`, 'Название группы', value.name, 40, false),
      description: checkText(issues, `${at}.description`, 'Описание группы', value.description ?? '', 90, true),
      color,
      macroIds: ids,
    }
  })

  const settingsCheck = checkSettings(raw.settings)
  issues.push(...settingsCheck.issues)

  const exportedAt = typeof raw.exportedAt === 'string' && Number.isFinite(Date.parse(raw.exportedAt)) ? new Date(raw.exportedAt).toISOString() : new Date().toISOString()

  const config: WorkspaceConfig = {
    version: 1,
    name,
    description,
    exportedAt,
    macros: macros.filter((macro) => macro.id),
    groups: groups.filter((group) => group.id),
    settings: settingsCheck.settings,
  }

  const hasErrors = issues.some((issue) => issue.level === 'error')
  return { ok: !hasErrors, issues, config }
}

export function emptyConfig(name = 'Новый конфиг'): WorkspaceConfig {
  return {
    version: 1,
    name,
    description: '',
    exportedAt: new Date().toISOString(),
    macros: [],
    groups: [],
    settings: { notifications: true, compact: false, animations: true, stopOnError: true, shortcut: 'F8' },
  }
}

export function makeMacro(kind: KindDef, taken: Set<string>, index: number): Macro {
  const { automation } = normalizeAutomation(kind, undefined)
  return {
    id: newMacroId(kind.id, taken),
    kind: kind.id,
    name: `${kind.label} #${index + 1}`,
    description: '',
    enabled: true,
    cycles: 0,
    delay: kind.delay ?? 5,
    repeats: 0,
    automation,
  }
}
