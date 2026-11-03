# LOCAL PREPARATION ONLY: do not publish during the diagnostic performance run.
# Repository-root context; railway.json selects services/backend/Dockerfile.
FROM node:24.22.2-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY services/backend/package.json services/backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# Copy the whole source tree: a hardcoded file whitelist silently shipped an image
# missing modules imported by app.ts (oauth/apple/register/admin/chat/...), which
# fails only at container start.
COPY services/backend/src ./src/
USER node
EXPOSE 8080
CMD ["node", "src/server.ts"]
