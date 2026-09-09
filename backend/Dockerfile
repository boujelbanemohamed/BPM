# syntax=docker/dockerfile:1

# ---------- Stage 1: install deps + compile TypeScript ----------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- Stage 2: production runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Compatible RHEL/OpenShift : l'image peut être lancée avec un UID arbitraire
# appartenant au groupe root (contrainte SCC "restricted"). On crée un
# utilisateur nommé pour l'exécution Docker/Podman classique, et on rend
# les répertoires nécessaires accessibles en écriture au groupe 0.
RUN addgroup -g 1001 bpm && \
    adduser -u 1001 -G bpm -s /bin/sh -D bpm && \
    mkdir -p /app/uploads /var/log/bpm && \
    chgrp -R 0 /app /var/log/bpm && \
    chmod -R g=u /app /var/log/bpm

USER 1001

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
