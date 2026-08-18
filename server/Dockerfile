FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
WORKDIR /app

# Premium trip-blog video processing invokes ffmpeg. Keep it in the runtime
# image (not the build stage) and remove apt metadata to limit image bloat.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Runtime reads server/config from process.cwd() and serves server/public.
# Keep the service-account key excluded by .dockerignore; Cloud Run uses ADC.
COPY --from=build /app/config ./config
COPY --from=build /app/public ./public
# itineraryInstructionService.ts / itineraryPromptPlanService.ts read the bundled
# prompt markdown and JSON schemas from here at runtime (relative to process.cwd()).
COPY --from=build /app/prompts ./prompts
# locationServices.ts falls back to these local CSVs (via resolveRuntimeDataPath,
# which looks for dist/data/**) when the GCS-hosted location JSONs are
# unavailable. Without this, that fallback silently returns an empty dataset
# in production instead of degrading gracefully.
COPY --from=build /app/data ./dist/data

EXPOSE 8080
CMD ["node", "dist/index.js"]
