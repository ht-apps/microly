import { readConfig } from '../config.js'

const config = readConfig()
process.stdout.write(`生产配置有效：${config.runtime.environment} ${config.runtime.appVersion}\n`)
