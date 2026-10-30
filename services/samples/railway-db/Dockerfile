FROM node:24.22.2-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src/app.ts src/store.ts src/server.ts ./src/
COPY release.json ./release.json
USER node
CMD ["node", "src/server.ts"]
