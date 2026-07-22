import { createServer } from 'node:http'

import { createApp } from './create-app.js'

const port = Number.parseInt(process.env['PORT'] ?? '3001', 10)
const host = process.env['HOST'] ?? '127.0.0.1'
const testResetToken = process.env['LAB_TEST_RESET_TOKEN']
const server = createServer(createApp({ testResetToken }))

server.listen(port, host, () => {
  process.stdout.write(`Fault API listening on http://${host}:${port}\n`)
})

function shutdown(signal: NodeJS.Signals): void {
  server.close((error) => {
    if (error) {
      process.stderr.write(`${signal} shutdown failed: ${error.message}\n`)
      process.exitCode = 1
    }
  })
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
