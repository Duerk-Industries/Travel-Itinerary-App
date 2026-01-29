
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { hasRunLocalFlag } from './env';

export const loadEnv = () => {
    const envPaths = [
        path.resolve(__dirname, '../../.env'), // root .env
        path.resolve(__dirname, '../.env'), // server/.env
        path.resolve(__dirname, '../../.secrets'), // root .secrets
        path.resolve(__dirname, '../.secrets'), // server/.secrets
    ];

    const localEnvPaths = [
        path.resolve(__dirname, '../../.local_env'), // root .local_env
        path.resolve(__dirname, '../.local_env'), // server/.local_env
    ];

    const loadedEnvPaths: string[] = [];
    const shouldOverride = !process.env.JEST_WORKER_ID;

    for (const envPath of envPaths) {
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath, override: shouldOverride });
            loadedEnvPaths.push(envPath);
        }
    }

    for (const envPath of localEnvPaths) {
        if (hasRunLocalFlag(envPath)) {
            dotenv.config({ path: envPath, override: shouldOverride });
            loadedEnvPaths.push(envPath);
        }
    }

    if (loadedEnvPaths.length === 0) {
        dotenv.config(); // default search (process.cwd())
        return 'process.env/default';
    } else {
        return loadedEnvPaths.join(', ');
    }
}
