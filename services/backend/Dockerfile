# Build context: repository root. Parent-owned railway.json should select this path.
FROM node:24.22.2-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY services/backend/package.json services/backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# Copy the whole source tree: an explicit file list silently drops every module
# added after the list was written, and the container then fails at import time.
COPY services/backend/src ./src
USER node
EXPOSE 8080
CMD ["node", "src/server.ts"]
