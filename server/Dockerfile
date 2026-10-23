# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder
WORKDIR /app

# better-sqlite3 may need to compile when an Alpine prebuild is unavailable.
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000 \
    SQLITE_DB_PATH=/app/data/crm_agent.db

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 5000
CMD ["node", "dist/index.js"]
