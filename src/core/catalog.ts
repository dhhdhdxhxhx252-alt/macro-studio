import type { Catalog, FieldDef, Issue, KindDef, MacroAutomation, ParameterValue } from './types.js'

/** Границы execution/safety берются отсюда — они одинаковы для всех категорий. */
export const EXECUTION_BOUNDS = {
  startDelay: { min: 0, max: 300, step: 1, unit: 'сек.' },
  variation: { min: 0, max: 50, step: 5, unit: '%' },
  breakEvery: { min: 0, max: 1000, step: 1, unit: 'циклов' },
  breakSeconds: { min: 5, max: 600, step: 5, unit: 'сек.' },
  maxMinutes: { min: 0, max: 480, step: 1, unit: 'мин.' },
} as const

export const SAFETY_BOUNDS = {
  confidence: { min: 50, max: 99, step: 1, unit: '%' },
  cycleTimeout: { min: 10, max: 600, step: 5, unit: 'сек.' },
  retryLimit: { min: 0, max: 5, step: 1, unit: 'раз' },
  retryDelay: { min: 1, max: 60, step: 1, unit: 'сек.' },
} as const

export const INTERVAL_MODES = ['fixed', 'variable'] as const
export const NOTIFICATION_MODES = ['silent', 'finish', 'all'] as const
export const ON_ERROR_MODES = ['retry', 'skip', 'stop'] as const
export const LOG_LEVELS = ['errors', 'normal', 'verbose'] as const

export const FIELD_TYPES = ['select', 'segments', 'toggle', 'range', 'number', 'multi', 'text'] as const

export function defaultAutomation(): MacroAutomation {
  return {
    version: 1,
    parameters: {},
    execution: {
      startDelay: 2,
      intervalMode: 'fixed',
      variation: 15,
      breakEvery: 0,
      breakSeconds: 15,
      maxMinutes: 0,
      notifications: 'finish',
    },
    safety: {
      confidence: 80,
      cycleTimeout: 120,
      onError: 'retry',
      retryLimit: 2,
      retryDelay: 3,
      pauseWhenHidden: true,
      logLevel: 'normal',
    },
  }
}

function sameValue(a: ParameterValue | undefined, b: ParameterValue): boolean {
  if (Array.isArray(b)) return Array.isArray(a) && b.length === a.length && b.every((item, i) => item === a[i])
  return a === b
}

export function isFieldVisible(field: FieldDef, parameters: Record<string, ParameterValue>): boolean {
  if (!field.requires) return true
  return sameValue(parameters[field.requires.key], field.requires.value)
}

export function parametersFromCatalog(kind: KindDef): Record<string, ParameterValue> {
  const out: Record<string, ParameterValue> = {}
  for (const field of kind.fields) {
    out[field.key] = Array.isArray(field.default) ? [...field.default] : field.default
  }
  return out
}

/**
 * Каталог — это данные, а не код: кривой каталог должен падать сразу и в UI, и в CLI.
 * Возвращает список проблем; пустой список означает «каталог пригоден к работе».
 */
export function validateCatalog(catalog: Catalog): Issue[] {
  const issues: Issue[] = []
  const push = (path: string, message: string) => issues.push({ path, message, level: 'error' })

  if (catalog.version !== 1) push('version', `Поддерживается только версия 1, получено ${String(catalog.version)}.`)
  if (!Array.isArray(catalog.kinds) || !catalog.kinds.length) push('kinds', 'В каталоге должна быть хотя бы одна категория.')

  const kindIds = new Set<string>()
  catalog.kinds.forEach((kind, kindIndex) => {
    const base = `kinds[${kindIndex}]`
    if (!/^[a-z][a-z0-9_-]{1,31}$/.test(kind.id)) push(`${base}.id`, 'id категории: маленькая латинская буква, затем буквы/цифры/_-_ , длина 2..32.')
    if (kindIds.has(kind.id)) push(`${base}.id`, `id категории «${kind.id}» повторяется.`)
    kindIds.add(kind.id)
    if (!kind.label?.trim()) push(`${base}.label`, 'Название категории не может быть пустым.')
    if (!Array.isArray(kind.fields) || !kind.fields.length) push(`${base}.fields`, 'У категории должно быть хотя бы одно поле.')

    const keys = new Set<string>()
    kind.fields?.forEach((field, fieldIndex) => {
      const at = `${base}.fields[${fieldIndex}]`
      if (!/^[a-z][A-Za-z0-9]{1,40}$/.test(field.key)) push(`${at}.key`, 'key поля: camelCase, начинается со строчной буквы, 2..41 символ.')
      if (keys.has(field.key)) push(`${at}.key`, `key «${field.key}» повторяется в категории ${kind.id}.`)
      keys.add(field.key)
      if (!field.label?.trim()) push(`${at}.label`, 'Метка поля не может быть пустой.')
      if (!FIELD_TYPES.includes(field.type)) push(`${at}.type`, `Неизвестный тип поля «${field.type}».`)

      const needsOptions = field.type === 'select' || field.type === 'segments' || field.type === 'multi'
      if (needsOptions) {
        if (!Array.isArray(field.options) || !field.options.length) push(`${at}.options`, `Для типа «${field.type}» нужен непустой список options.`)
        const values = new Set((field.options ?? []).map((option) => option.value))
        if (field.type !== 'multi' && !values.has(field.default as string)) push(`${at}.default`, 'Значение default должно быть одним из options.value.')
        if (field.type === 'multi' && (!Array.isArray(field.default) || (field.default as string[]).some((v) => !values.has(v)))) {
          push(`${at}.default`, 'Для multi default — список значений из options.')
        }
      }
      if (field.type === 'toggle' && typeof field.default !== 'boolean') push(`${at}.default`, 'Для toggle default должен быть true или false.')
      if (field.type === 'text' && typeof field.default !== 'string') push(`${at}.default`, 'Для text default должен быть строкой.')
      if (field.type === 'number' || field.type === 'range') {
        if (typeof field.default !== 'number') push(`${at}.default`, 'Для number/range default должен быть числом.')
        if (field.min === undefined || field.max === undefined) push(`${at}`, 'Для number/range нужны min и max.')
        else if (field.min > field.max) push(`${at}`, 'min не может быть больше max.')
        else if (typeof field.default === 'number' && (field.default < field.min || field.default > field.max)) push(`${at}.default`, 'default вне диапазона min..max.')
        if (field.step !== undefined && field.step <= 0) push(`${at}.step`, 'step должен быть больше нуля.')
      }
      const requires = field.requires
      if (requires && !keys.has(requires.key) && !kind.fields.some((other) => other.key === requires.key)) {
        push(`${at}.requires`, `Поле ссылается на неизвестный key «${requires.key}».`)
      }
    })

    kind.rules?.forEach((rule, ruleIndex) => {
      const at = `${base}.rules[${ruleIndex}]`
      const known = (key: string) => kind.fields.some((field) => field.key === key)
      if (rule.type === 'ordered') {
        if (!known(rule.smaller) || !known(rule.larger)) push(`${at}`, 'Правило ordered ссылается на неизвестные поля.')
      } else if (rule.type === 'nonEmpty') {
        if (!known(rule.field) || !known(rule.when.key)) push(`${at}`, 'Правило nonEmpty ссылается на неизвестные поля.')
      } else if (rule.type === 'requiresValue') {
        if (!known(rule.field) || !known(rule.when.key)) push(`${at}`, 'Правило requiresValue ссылается на неизвестные поля.')
      } else if (rule.type === 'implies') {
        if (!known(rule.when.key) || !known(rule.then.key)) push(`${at}`, 'Правило implies ссылается на неизвестные поля.')
        if (!Number.isFinite(rule.when.min)) push(`${at}`, 'Для implies нужен числовой when.min.')
      } else {
        push(`${at}`, `Неизвестный тип правила «${(rule as { type: string }).type}».`)
      }
    })
  })

  return issues
}
