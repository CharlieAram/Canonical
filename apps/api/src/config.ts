import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  CANONICAL_STORE: z.enum(['memory', 'surreal']).default('memory'),
  SURREAL_URL: z.string().default('ws://127.0.0.1:8000/rpc'),
  SURREAL_NAMESPACE: z.string().default('canonical'),
  SURREAL_DATABASE: z.string().default('development'),
  SURREAL_USERNAME: z.string().default('root'),
  SURREAL_PASSWORD: z.string().default('canonical-local-only'),
  SURREAL_AUTH_LEVEL: z.enum(['root', 'namespace', 'database']).default('root'),
  DAYTONA_API_KEY: z.string().optional(),
  DAYTONA_API_URL: z.string().url().optional(),
  DAYTONA_SNAPSHOT: z.string().optional(),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Report variable names, never their values.
    throw new Error(`Invalid configuration: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  }
  const config = parsed.data;
  return {
    port: config.PORT,
    host: config.HOST,
    storage: config.CANONICAL_STORE,
    surreal: {
      url: config.SURREAL_URL,
      namespace: config.SURREAL_NAMESPACE,
      database: config.SURREAL_DATABASE,
      username: config.SURREAL_USERNAME,
      password: config.SURREAL_PASSWORD,
      authLevel: config.SURREAL_AUTH_LEVEL,
    },
    daytona: config.DAYTONA_API_KEY ? {
      apiKey: config.DAYTONA_API_KEY,
      apiUrl: config.DAYTONA_API_URL,
      snapshot: config.DAYTONA_SNAPSHOT || undefined,
    } : undefined,
  };
}
