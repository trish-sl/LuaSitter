#!/usr/bin/env node
// Runs the LuaSitter test suite and prints a summary.
//
//   node test/run-tests.mjs            run every test
//   node test/run-tests.mjs sit        only test files whose path contains "sit"
//   node test/run-tests.mjs --install  (re)install the test dependencies first
//   node test/run-tests.mjs --coverage which lines of the scripts ran: a table,
//                                      and test/coverage/html/index.html
//
// Installs the dependencies (rezless, vitest) on the first run. Results are also
// written to test/results.json.

import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Vitest fails on Windows when the drive letter case of the working directory
// differs from the real path ("d:" vs "D:"), so use the real path.
const here = realpathSync.native(path.dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const install = args.includes('--install')
const coverage = args.includes('--coverage')
const filters = args.filter((a) => a !== '--install' && a !== '--coverage')
const isWindows = process.platform === 'win32'
const npm = isWindows ? 'npm.cmd' : 'npm'
const npx = isWindows ? 'npx.cmd' : 'npx'

function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { cwd: here, stdio: 'inherit', shell: isWindows })
  return r.status ?? 1
}

if (install || !existsSync(path.join(here, 'node_modules', '@rezless', 'vitest'))) {
  console.log('Installing test dependencies (rezless, vitest)...')
  const lock = existsSync(path.join(here, 'package-lock.json'))
  if (run(npm, [lock ? 'ci' : 'install', '--no-fund', '--no-audit']) !== 0) {
    console.error('npm install failed')
    process.exit(1)
  }
}

if (coverage) {
  process.env.LSL_COVERAGE = '1'
  process.env.LSL_COVERAGE_DIR = path.join(here, '.rezless-coverage')
}

const status = run(npx, ['vitest', 'run', '--reporter=default', '--reporter=json', '--outputFile.json=results.json', ...filters])

try {
  const results = JSON.parse(readFileSync(path.join(here, 'results.json'), 'utf8'))
  console.log('')
  console.log('LuaSitter test results')
  console.log('======================')
  for (const file of results.testResults) {
    const name = path.relative(here, file.name).replace(/\\/g, '/')
    const passed = file.assertionResults.filter((t) => t.status === 'passed').length
    const total = file.assertionResults.length
    console.log(`${passed === total && file.status === 'passed' ? 'PASS' : 'FAIL'}  ${name}  (${passed}/${total})`)
    for (const t of file.assertionResults) {
      if (t.status !== 'passed') console.log(`      x ${t.ancestorTitles.join(' > ')} > ${t.title}`)
    }
  }
  console.log('')
  console.log(`Tests: ${results.numPassedTests} passed, ${results.numFailedTests} failed, ${results.numTotalTests} total`)
  console.log('Note: these tests run the scripts in rezless, an offline simulator. They do not replace testing in-world.')
} catch {
  // vitest already printed what went wrong
}

if (coverage) {
  console.log('')
  console.log('Script coverage (statements, branches, functions)')
  run(npx, ['rezless-coverage', '--slua-output', 'coverage'])
  console.log('Line by line: test/coverage/html/index.html')
}
process.exit(status)
