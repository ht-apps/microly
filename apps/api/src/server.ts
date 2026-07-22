import Fastify from 'fastify'

const app = Fastify({
  logger: true,
})

app.get('/', async () => ({
  message: 'Hello World',
}))

let isClosing = false

async function close(signal: NodeJS.Signals) {
  if (isClosing) {
    return
  }

  isClosing = true
  app.log.info({ signal }, 'Shutting down API server')
  await app.close()
}

process.once('SIGINT', () => {
  void close('SIGINT')
})

process.once('SIGTERM', () => {
  void close('SIGTERM')
})

try {
  await app.listen({
    host: '0.0.0.0',
    port: 3000,
  })
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}
