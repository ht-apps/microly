import type { FastifyReply, FastifyRequest } from 'fastify'

type Sample = { at: number; statusCode: number; durationMs: number }

export class RuntimeMetrics {
  private readonly starts = new WeakMap<FastifyRequest, number>()
  private samples: Sample[] = []

  start(request: FastifyRequest) {
    this.starts.set(request, performance.now())
  }

  finish(request: FastifyRequest, reply: FastifyReply) {
    const start = this.starts.get(request)
    if (start === undefined) return
    const now = Date.now()
    this.samples.push({ at: now, statusCode: reply.statusCode, durationMs: Math.max(0, performance.now() - start) })
    const cutoff = now - 7 * 24 * 60 * 60 * 1000
    if (this.samples.length > 5_000) this.samples = this.samples.filter((sample) => sample.at >= cutoff).slice(-5_000)
  }

  snapshot(windowMs: number) {
    const cutoff = Date.now() - windowMs
    const samples = this.samples.filter((sample) => sample.at >= cutoff)
    const latencies = samples.map((sample) => sample.durationMs).sort((a, b) => a - b)
    const percentile = (value: number) => latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * value) - 1)]! : null
    const failures = samples.filter((sample) => sample.statusCode >= 500).length
    return {
      requests: samples.length,
      errorRate: samples.length ? failures / samples.length : 0,
      latencyP50: percentile(0.5),
      latencyP95: percentile(0.95),
    }
  }

  clear() { this.samples = [] }
}
