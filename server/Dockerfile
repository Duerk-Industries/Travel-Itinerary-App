FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Runtime reads server/config from process.cwd() and serves server/public.
# Keep the service-account key excluded by .dockerignore; Cloud Run uses ADC.
COPY --from=build /app/config ./config
COPY --from=build /app/public ./public

EXPOSE 8080
CMD ["node", "dist/index.js"]
