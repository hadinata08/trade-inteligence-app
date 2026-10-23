FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/database/prisma packages/database/prisma
COPY packages/comtrade/package.json packages/comtrade/
COPY packages/analytics/package.json packages/analytics/
COPY packages/excel/package.json packages/excel/
COPY workers/ingestion/package.json workers/ingestion/
COPY workers/scheduler/package.json workers/scheduler/
COPY workers/exports/package.json workers/exports/
RUN npm ci

FROM deps AS build
COPY . .
RUN npx prisma generate --schema packages/database/prisma/schema.prisma
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @iti/web

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl tini \
  && mkdir -p /var/lib/iti/exports \
  && chown -R node:node /var/lib/iti
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "start", "-w", "@iti/web"]
