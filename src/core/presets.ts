import { defaultAutomation } from './catalog.js'
import type { Macro } from './types.js'

export type PresetId = 'careful' | 'balanced' | 'fast'

export const PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { id: 'careful', label: 'Осторожный', hint: 'Редкие перерывы, высокий порог, запас по времени' },
  { id: 'balanced', label: 'Баланс', hint: 'Дефолты интервала и защиты' },
  { id: 'fast', label: 'Быстрый', hint: 'Без перерывов, минимальная задержка старта' },
]

function clampDelay(value: number): number {
  return Math.min(60, Math.max(1, Math.round(value)))
}

// Пресеты меняют только ритм и защиту: параметры категории — это логика конкретного макроса.
export function applyPreset(macro: Macro, preset: PresetId): Macro {
  const base = defaultAutomation()
  if (preset === 'careful') {
    return {
      ...macro,
      delay: clampDelay(macro.delay + 3),
      automation: {
        ...macro.automation,
        execution: { ...base.execution, startDelay: 5, intervalMode: 'variable', variation: 25, breakEvery: 10, breakSeconds: 30, maxMinutes: 60, notifications: 'all' },
        safety: { ...macro.automation.safety, confidence: 90, retryLimit: 3, retryDelay: 5 },
      },
    }
  }
  if (preset === 'fast') {
    return {
      ...macro,
      delay: clampDelay(macro.delay - 2),
      automation: {
        ...macro.automation,
        execution: { ...base.execution, startDelay: 0, notifications: 'silent' },
        safety: { ...macro.automation.safety, confidence: 75, retryLimit: 1, onError: 'skip' },
      },
    }
  }
  return { ...macro, automation: { ...macro.automation, execution: { ...base.execution }, safety: { ...base.safety } } }
}
