import { createApp } from './app.js'
import { readConfig } from './config.js'

const config = readConfig()
const app = createApp({ databaseUrl: config.databaseUrl, logger: true, wechat: config.wechat, admin: config.admin })
let isClosing = false

async function close(signal: NodeJS.Signals) {
  if (isClosing) return
  isClosing = true
  app.log.info({ signal }, 'Shutting down API server')
  await app.close()
}

process.once('SIGINT', () => void close('SIGINT'))
process.once('SIGTERM', () => void close('SIGTERM'))

try {
  await app.listen({ host: '0.0.0.0', port: config.port })
} catch (cause) {
  app.log.error(cause)
  process.exitCode = 1
}
