import { trainingContentBundle } from '@microly/training-content'

import { createDeepseekProvider } from '../ai.js'
import { AI_EVAL_SAMPLES } from '../eval/fixtures.js'

const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) throw new Error('请先设置 DEEPSEEK_API_KEY，再运行真机评测。')
const limit = Math.min(AI_EVAL_SAMPLES.length, Math.max(1, Number(process.env.AI_EVAL_LIMIT ?? 20)))
const provider = createDeepseekProvider(apiKey)
const started = Date.now()
let passed = 0
let blocked = 0
let promptTokens = 0
let completionTokens = 0

for (const sample of AI_EVAL_SAMPLES.slice(0, limit)) {
  const session = trainingContentBundle.sessions[sample.sessionId]
  const card = session?.cards.find((item) => item.type === 'practice')
  if (!session || !card) continue
  try {
    const response = await provider.evaluate({
      text: sample.text,
      session,
      card,
      config: {
        modelId: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash', revision: 1,
        thinkingEnabled: false, maxTokens: 800, temperature: 0.2, timeoutMs: 30000,
        dailyQuota: 5, inputCacheHitPrice: 0, inputCacheMissPrice: 0, outputPrice: 0,
      },
      signal: AbortSignal.timeout(30000),
    })
    const value = response.value as { safety?: { allowed?: boolean } }
    passed += 1
    if (value.safety?.allowed === false) blocked += 1
    promptTokens += response.usage.promptTokens
    completionTokens += response.usage.completionTokens
  } catch { /* Counted as a failed sample in the final summary. */ }
}

process.stdout.write(`${JSON.stringify({
  model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
  samples: limit,
  passed,
  formatPassRate: passed / limit,
  blocked,
  durationMs: Date.now() - started,
  promptTokens,
  completionTokens,
}, null, 2)}\n`)
