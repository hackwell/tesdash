# Stage 1 — build the static page
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun --bun run build

# Stage 2 — runtime: Bun serves the page and the state API
FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 STATE_FILE=/data/state.json
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=builder /app/dist ./dist
COPY server ./server
COPY src/lib/state.ts ./src/lib/state.ts
COPY src/data/config.yml ./src/data/config.yml
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD bun -e "fetch('http://127.0.0.1:3000/api/state').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "server/index.ts"]
