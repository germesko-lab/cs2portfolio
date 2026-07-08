# CS2 Portfolio Tracker — production image.
# Build:  docker build -t cs2portfolio .
# Run:    docker run -p 3000:3000 -v cs2data:/app/data cs2portfolio
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Standalone server + static assets + SQL migrations (read at runtime from cwd).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/db ./db
# Runs as root: platform-mounted volumes (Railway "Attach Volume", etc.) are
# root-owned, and a non-root USER here can't write the SQLite file into them.
# Acceptable for a single-user app; revisit with an entrypoint chown+drop if
# hardening is needed.
RUN mkdir -p /app/data
EXPOSE 3000
# No VOLUME instruction: Railway rejects it (attach a volume at /app/data in
# the dashboard); docker-compose declares its own volume mapping anyway.
CMD ["node", "server.js"]
