import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'
import { run } from '../src/cli/check.js'
import { validateConfig } from '../src/core/config.js'
import type { Catalog, WorkspaceConfig } from '../src/core/types.js'

const root = new URL('../../', import.meta.url)
const CATALOG = fileURLToPath(new URL('catalogs/nte-automation.json', root))
const WEEKEND = fileURLToPath(new URL('samples/weekend.json', root))
const BROKEN = fileURLToPath(new URL('samples/broken.json', root))
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')) as Catalog

function capture(argv: string[]): { code: number; out: string } {
  const chunks: string[] = []
  const original = process.stdout.write
  process.stdout.write = ((text: string) => {
    chunks.push(String(text))
    return true
  }) as typeof process.stdout.write
  try {
    return { code: run(argv), out: chunks.join('') }
  } finally {
    process.stdout.write = original
  }
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'macro-check-'))
}

it('справка печатается и не ломает запуск', () => {
  const { code, out } = capture(['--help'])
  assert.equal(code, 0)
  assert.match(out, /macro-check/)
  assert.match(out, /--fix/)
})

it('валидный образец даёт код 0', () => {
  const { code, out } = capture([WEEKEND, '--catalog', CATALOG])
  assert.equal(code, 0)
  assert.match(out, /0 ошибок, 0 предупреждений/)
})

it('сломанный образец даёт код 1 и разбор по уровням', () => {
  const { code, out } = capture([BROKEN, '--catalog', CATALOG])
  assert.equal(code, 1)
  assert.match(out, /ОШИБКА\s+macros\[0\]\.name/)
  assert.match(out, /ВНИМАНИЕ\s+macros\[0\]\.automation\.parameters\.unknownSwitch/)
})

it('--json печатает машиночитаемый отчёт', () => {
  const { code, out } = capture([BROKEN, '--catalog', CATALOG, '--json'])
  assert.equal(code, 1)
  const report = JSON.parse(out) as { ok: boolean; errors: number; warnings: number; issues: unknown[] }
  assert.equal(report.ok, false)
  assert.ok(report.errors > 5)
  assert.equal(report.issues.length, report.errors + report.warnings)
})

it('предупреждения не валят CI, пока не попросить', () => {
  const dir = tempDir()
  const file = join(dir, 'warn-only.json')
  const config = JSON.parse(readFileSync(WEEKEND, 'utf8')) as WorkspaceConfig
  config.macros[0].automation.parameters.extraSwitch = 1
  writeFileSync(file, JSON.stringify(config, null, 2))

  assert.equal(capture([file, '--catalog', CATALOG, '--quiet']).code, 0)
  assert.equal(capture([file, '--catalog', CATALOG, '--quiet', '--warnings']).code, 1)
})

it('--fix пишет нормализованный конфиг, который проходит проверку', () => {
  const dir = tempDir()
  const input = join(dir, 'dirty.json')
  const output = join(dir, 'clean.json')
  const config = JSON.parse(readFileSync(WEEKEND, 'utf8')) as WorkspaceConfig
  config.macros[0].delay = 90
  config.macros[0].automation.parameters.unknownSwitch = true
  writeFileSync(input, JSON.stringify(config, null, 2))

  assert.equal(capture([input, '--catalog', CATALOG, '--fix', '--out', output, '--quiet']).code, 1)

  const fixed = JSON.parse(readFileSync(output, 'utf8'))
  const result = validateConfig(fixed, catalog)
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  assert.equal(result.config?.macros[0].delay, 4, 'должен вернуться интервал категории')
  assert.equal('unknownSwitch' in (result.config?.macros[0].automation.parameters ?? {}), false)
})

it('--fix без --out перезаписывает входной файл', () => {
  const dir = tempDir()
  const file = join(dir, 'in-place.json')
  const { exportedAt, ...config } = JSON.parse(readFileSync(WEEKEND, 'utf8')) as WorkspaceConfig
  assert.ok(exportedAt)
  writeFileSync(file, JSON.stringify(config))

  capture([file, '--catalog', CATALOG, '--fix', '--quiet'])
  const after = JSON.parse(readFileSync(file, 'utf8')) as WorkspaceConfig
  assert.match(after.exportedAt, /Z$/)
})

it('битый аргументов путь и неизвестная опция — код 2 через исключение', () => {
  assert.throws(() => run(['нет-такого.json', '--catalog', CATALOG]), /Файл не найден/)
  assert.throws(() => run([WEEKEND, '--catalog', 'нет-каталога.json']), /Каталог не найден/)
  assert.throws(() => run([WEEKEND, '--turbo']), /Неизвестная опция/)
  assert.throws(() => run([]), /Не указан файл конфигурации/)
})

it('битый JSON — внятная ошибка, а не стек', () => {
  const dir = tempDir()
  const file = join(dir, 'bad.json')
  writeFileSync(file, '{oops')
  assert.throws(() => run([file, '--catalog', CATALOG]), /не является корректным JSON/)
})
