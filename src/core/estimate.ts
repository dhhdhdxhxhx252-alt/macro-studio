import type { ExecutionSettings, Macro } from './types.js'

export interface Estimate {
  /** Средний цикл без перерывов, сек. */
  cycleSeconds: number
  /** Сколько циклов реально влезет в лимит времени. */
  cycles: number
  /** Перерывов за прогон. */
  breaks: number
  /** Полная длительность с задержкой старта и перерывами, сек. */
  totalSeconds: number
  /** Что первым остановит прогон. */
  limiter: 'cycles' | 'maxMinutes' | 'none'
}

const MAX_CYCLES = 100000

/**
 * Оценка долго живёт в секундах и округляется вниз: пользователю важно,
 * сколько циклов успеет, а не дробные хвосты.
 */
export function estimateMacro(macro: Macro): Estimate {
  const e: ExecutionSettings = macro.automation.execution
  const variation = e.intervalMode === 'variable' ? e.variation / 100 : 0
  const cycleSeconds = macro.delay * (1 + variation / 2)

  const requested = macro.cycles > 0 ? macro.cycles : MAX_CYCLES
  const byTime = e.maxMinutes > 0 ? Math.floor((e.maxMinutes * 60 - e.startDelay) / cycleSeconds) : requested
  const cycles = Math.max(0, Math.min(requested, byTime, MAX_CYCLES))

  const breaks = e.breakEvery > 0 ? Math.floor(cycles / e.breakEvery) : 0
  const totalSeconds = cycles ? e.startDelay + cycles * cycleSeconds + breaks * e.breakSeconds : 0
  const limiter: Estimate['limiter'] = e.maxMinutes > 0 && byTime < requested ? 'maxMinutes' : macro.cycles > 0 ? 'cycles' : 'none'

  return { cycleSeconds, cycles, breaks, totalSeconds, limiter }
}

export function estimateGroup(macros: Macro[]): Estimate {
  return macros.reduce<Estimate>(
    (acc, macro) => {
      const next = estimateMacro(macro)
      return {
        cycleSeconds: acc.cycleSeconds + next.cycleSeconds,
        cycles: acc.cycles + next.cycles,
        breaks: acc.breaks + next.breaks,
        totalSeconds: acc.totalSeconds + next.totalSeconds,
        limiter: acc.limiter === 'none' ? next.limiter : acc.limiter,
      }
    },
    { cycleSeconds: 0, cycles: 0, breaks: 0, totalSeconds: 0, limiter: 'none' }
  )
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  if (!total) return '—'
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return `${h} ч ${m} мин`
  if (m) return `${m} мин ${s} с`
  return `${s} с`
}
