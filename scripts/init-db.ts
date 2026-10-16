import { initializeSurreal } from '@canonical/integrations/surrealdb';
import { readConfig } from '../apps/api/src/config.ts';

await initializeSurreal(readConfig().surreal);
console.log('SurrealDB namespace and database are ready.');
