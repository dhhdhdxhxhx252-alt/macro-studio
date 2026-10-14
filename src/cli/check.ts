#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { Catalog, Issue } from '../core/types.js'
import { validateConfig } from '../core/config.js'

const USAGE = `macro-check — проверка и нормализация конфигурации автоматизации

Использование:
  macro-check <config.json> [опции]

Опции:
  --catalog <path>   каталог категорий (по умолчанию встроенный nte-automation)
  --fix              записать нормализованный конфиг
  --out <file>       файл для --fix (по умолчанию перезаписать входной)
  --json             вывод в JSON вместо текста
  --warnings         считать предупреждения ошибками
  --quiet            печатать только итог
  --help             эта справка

Коды выхода: 0 — ок, 1 — есть ошибки, 2 — неверный запуск или битый JSON.`

interface Options {
  input: string
  catalog: string
  fix: boolean
  out: string
  json: boolean
  failOnWarnings: boolean
  quiet: boolean
  help: boolean
}

const DEFAULT_CATALOG = new URL('../../catalogs/nte-automation.json', import.meta.url)

/** Ошибки запуска: текст идёт в stderr, код выхода — 2. */
export class CliError extends Error {}

function fail(message: string): never {
  throw new CliError(message)
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { input: '', catalog: '', fix: false, out: '', json: false, failOnWarnings: false, quiet: false, help: false }
  const flags = new Set(['--fix', '--json', '--warnings', '--quiet', '--help'])
  const valued = new Map<string, 'catalog' | 'out'>([
    ['--catalog', 'catalog'],
    ['--out', 'out'],
  ])
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      opts.help = true
      continue
    }
    const name = valued.get(arg)
    if (name) {
      const value = argv[++i]
      if (!value || value.startsWith('-')) fail(`После ${arg} нужен путь к файлу.\n\n${USAGE}`)
      opts[name] = value
      continue
    }
    if (flags.has(arg)) {
      if (arg === '--fix') opts.fix = true
      else if (arg === '--json') opts.json = true
      else if (arg === '--warnings') opts.failOnWarnings = true
      else if (arg === '--quiet') opts.quiet = true
      continue
    }
    if (arg.startsWith('-')) fail(`Неизвестная опция «${arg}».\n\n${USAGE}`)
    if (opts.input) fail('Ожидается ровно один файл конфигурации.\n\n' + USAGE)
    opts.input = arg
  }
  return opts
}

function readCatalog(path: string): Catalog {
  const target: string | URL = path || DEFAULT_CATALOG
  let raw: string
  try {
    raw = readFileSync(target, 'utf8')
  } catch {
    fail(`Каталог не найден: ${String(target)}\nПередайте путь через --catalog.`)
  }
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, '')) as Catalog
  } catch {
    fail(`Каталог не является корректным JSON: ${String(target)}`)
  }
}

function readJson(path: string): unknown {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    fail(`Файл не найден: ${path}`)
  }
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    fail(`${path}: файл не является корректным JSON.`)
  }
}

function format(issue: Issue): string {
  const level = issue.level === 'error' ? 'ОШИБКА' : 'ВНИМАНИЕ'
  return `${level}  ${issue.path || 'конфиг'}  ${issue.message}`
}

export function run(argv: string[]): number {
  const opts = parseArgs(argv)
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  if (!opts.input) {
    fail(`Не указан файл конфигурации.\n\n${USAGE}`)
  }

  const catalog = readCatalog(opts.catalog)
  const result = validateConfig(readJson(opts.input), catalog)
  const errors = result.issues.filter((issue) => issue.level === 'error')
  const warnings = result.issues.filter((issue) => issue.level === 'warning')

  if (opts.fix && result.config) {
    const target = opts.out || opts.input
    writeFileSync(target, `${JSON.stringify(result.config, null, 2)}\n`, 'utf8')
    if (!opts.quiet && !opts.json) process.stdout.write(`Нормализованный конфиг записан: ${target}\n`)
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ ok: result.ok, errors: errors.length, warnings: warnings.length, issues: result.issues }, null, 2)}\n`)
  } else if (!opts.quiet) {
    for (const issue of result.issues) process.stdout.write(`${format(issue)}\n`)
    process.stdout.write(`\n${result.issues.length ? '' : 'Конфиг валиден. '}${errors.length} ошибок, ${warnings.length} предупреждений.\n`)
  }

  if (errors.length) return 1
  return opts.failOnWarnings && warnings.length ? 1 : 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exit(run(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(error instanceof CliError ? `${error.message}\n` : `Сбой проверки: ${String(error)}\n`)
    process.exit(2)
  }
}
