# ---- build the UI (Vue + Tailwind via Vite) ----
FROM node:26.12.1-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./web
RUN npm run build

# ---- runtime: plain Node, no node_modules ----
FROM node:26.12.1-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8088 \
    BIND=127.0.0.1 \
    HUB_CONFIG=/app/config.json
COPY server.js ./
COPY --from=build /src/dist ./dist
USER node
EXPOSE 8088
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
CMD ["node", "server.js"]
