# LOCAL PREPARATION ONLY: do not publish during the diagnostic performance run.
# Repository-root context; railway.json selects services/backend/Dockerfile.
FROM node:24.22.2-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY services/backend/package.json services/backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY services/backend/src/app.ts services/backend/src/auth.ts services/backend/src/database.ts services/backend/src/policy.ts services/backend/src/providers.ts services/backend/src/security.ts services/backend/src/server.ts ./src/
USER node
EXPOSE 8080
CMD ["node", "src/server.ts"]
