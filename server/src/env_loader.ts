
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { hasRunLocalFlag } from './env';

type LoadEnvOptions = {
    serverOnly?: boolean;
};

export const loadEnv = (options: LoadEnvOptions = {}) => {
    // Local development is explicitly marked with RUN_LOCAL=1 in a .local_env
    // file (or the shell). Keep local API keys in .env only; .secrets is for
    // production/legacy fallback loading and must not override local values.
    const localEnvMarkerPaths = [
        path.resolve(__dirname, '../../.local_env'), // root .local_env
        path.resolve(__dirname, '../.local_env'), // server/.local_env
    ];
    const isLocalRuntime = !process.env.K_SERVICE && (
        process.env.RUN_LOCAL === '1' || localEnvMarkerPaths.some(hasRunLocalFlag)
    );

    const envPaths = options.serverOnly || isLocalRuntime
        ? options.serverOnly
            ? [path.resolve(__dirname, '../.env')] // server/.env
            : [
                  path.resolve(__dirname, '../../.env'), // root .env
                  path.resolve(__dirname, '../.env'), // server/.env
              ]
        : [
              path.resolve(__dirname, '../../.env'), // root .env
              path.resolve(__dirname, '../.env'), // server/.env
              path.resolve(__dirname, '../../.secrets'), // root .secrets fallback
              path.resolve(__dirname, '../.secrets'), // server/.secrets fallback
          ];

    const localEnvPaths = options.serverOnly
        ? []
        : [
              path.resolve(__dirname, '../../.local_env'), // root .local_env
              path.resolve(__dirname, '../.local_env'), // server/.local_env
          ];

    const loadedEnvPaths: string[] = [];
    const shouldOverride =
        !process.env.JEST_WORKER_ID &&
        !process.env.K_SERVICE &&
        !process.env.CLOUD_RUN_JOB &&
        !process.env.E2E_MODE;

    for (const envPath of envPaths) {
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath, override: shouldOverride });
            loadedEnvPaths.push(envPath);
        }
    }

    if (options.serverOnly && !isLocalRuntime) {
        const secretsPath = path.resolve(__dirname, '../.secrets');
        if (fs.existsSync(secretsPath)) {
            // Keep server/.secrets as a backwards-compatible fallback for local tooling.
            dotenv.config({ path: secretsPath, override: false });
            loadedEnvPaths.push(secretsPath);
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
