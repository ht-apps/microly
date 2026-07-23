import { z } from 'zod'

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
})

export interface ApiConfig {
  databaseUrl: string
  port: number
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = ConfigSchema.parse(environment)
  return { databaseUrl: parsed.DATABASE_URL, port: parsed.API_PORT }
}
