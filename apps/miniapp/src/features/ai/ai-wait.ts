export const AI_FOREGROUND_WAIT_MS = 8000

export function remainingAiWaitSeconds(waitUntil: number | null, now = Date.now()) {
  if (waitUntil === null) return 0
  return Math.max(0, Math.ceil((waitUntil - now) / 1000))
}
