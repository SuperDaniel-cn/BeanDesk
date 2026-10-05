import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const docs = dirname(fileURLToPath(import.meta.url))
const root = dirname(docs)
const out = join(docs, 'out')
const dest = join(root, 'web/public/docs')
const stamp = join(out, 'index.html')

const WATCH = ['content', 'app', 'lib', 'components', 'images', 'next.config.mjs', 'package.json']

function newerThan(path, time) {
  if (!existsSync(path)) return false
  const st = statSync(path)
  if (st.mtimeMs > time) return true
  if (!st.isDirectory()) return false
  return readdirSync(path).some((name) => {
    if (name === 'node_modules' || name === '.next' || name === 'out' || name === '.source') {
      return false
    }
    return newerThan(join(path, name), time)
  })
}

function needsBuild() {
  if (!existsSync(stamp)) return true
  const time = statSync(stamp).mtimeMs
  return WATCH.some((rel) => newerThan(join(docs, rel), time))
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: docs, stdio: 'inherit' })
  if (result.status) process.exit(result.status)
}

if (!existsSync(join(docs, 'node_modules'))) run('bun', ['install'])
if (needsBuild()) run('bun', ['run', 'build'])
if (!existsSync(stamp)) {
  console.error('docs/out/index.html missing after build')
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(join(root, 'web/public'), { recursive: true })
cpSync(out, dest, { recursive: true })
console.log('handbook export synced to web/public/docs')
