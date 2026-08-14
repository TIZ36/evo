import z from '@deepseek-ai/schemastery'

export interface Config {
  dataDir?: string
  databasePath?: string
}

export const Config: z<Config> = z.object({
  dataDir: z.string().description('Directory containing the default memory.db'),
  databasePath: z.string().description('Explicit SQLite database path; overrides dataDir'),
})
