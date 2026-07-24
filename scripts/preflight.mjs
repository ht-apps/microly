import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function run(args) {
  process.stdout.write(`\n> pnpm ${args.join(' ')}\n`)
  execFileSync('pnpm', args, { stdio: 'inherit', env: process.env })
}

function files(root) {
  try {
    return readdirSync(root).flatMap((name) => {
      const path = join(root, name)
      return statSync(path).isDirectory() ? files(path) : [path]
    })
  } catch { return [] }
}

run(['test'])
run(['typecheck'])
run(['build:api'])
run(['build:admin'])
run(['build:miniapp'])

if (process.env.DATABASE_URL) run(['--filter', '@microly/api', 'db:status'])
else process.stdout.write('\n- 未提供 DATABASE_URL，跳过迁移状态检查。封测发布时必须配置后重跑。\n')

const artifacts = [...files('apps/admin/dist'), ...files('apps/miniapp/dist')]
const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /WECHAT_APP_SECRET\s*[:=]\s*["'][^"']+/,
  /ADMIN_API_TOKEN\s*[:=]\s*["'][^"']+/,
]
const leaked = artifacts.filter((file) => {
  const value = readFileSync(file)
  if (value.includes(0)) return false
  const text = value.toString('utf8')
  return secretPatterns.some((pattern) => pattern.test(text))
})
if (leaked.length) throw new Error(`前端产物疑似包含敏感配置：${leaked.join(', ')}`)

const privacy = readFileSync('apps/miniapp/src/pages/privacy/index.tsx', 'utf8')
const aiInfo = readFileSync('apps/miniapp/src/pages/ai-info/index.tsx', 'utf8')
if (!privacy.includes('测试版') || !aiInfo.includes('DeepSeek')) throw new Error('隐私政策或 AI 功能说明缺少封测标记。')
process.stdout.write('\n发布前检查通过。\n')
