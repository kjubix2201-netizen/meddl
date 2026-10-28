import { version as appVersion } from '@package';

export const AppConfig = {
    production: true,
    environment: 'PROD',
    version: appVersion,
    // Same-origin backend (Docker image / reverse proxy). Self-hosted
    // deployments override it at runtime via assets/app-config.js.
    BACKEND_URL: '/api',
};
