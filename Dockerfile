# Repository-root build context is required for the shared contracts directory.
FROM node:24.22.0-bookworm-slim AS build
WORKDIR /app/services/backend
COPY services/backend/package.json services/backend/package-lock.json ./
RUN npm ci --include=dev
COPY services/backend/tsconfig.json ./
COPY services/backend/src ./src
COPY contracts /app/contracts
RUN npm run typecheck && npm run build

FROM node:24.22.0-bookworm-slim AS runtime
LABEL ai.mintech.kimgosu.deployment-probe="dev-validation-02"
ENV NODE_ENV=production
ENV KIMGOSU_RUNTIME=cloud
WORKDIR /app/services/backend
COPY services/backend/package.json services/backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/services/backend/dist ./dist
COPY --from=build /app/contracts /app/contracts
USER node
# Railway supplies PORT. Intentionally fail closed when it is absent/invalid.
CMD ["node", "dist/cloud-server.js"]
