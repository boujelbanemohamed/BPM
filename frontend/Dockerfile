# syntax=docker/dockerfile:1

# ---------- Stage 1: build the Vite/React app ----------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- Stage 2: serve with Nginx (non-root, RHEL/OpenShift friendly) ----------
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

# L'image peut être lancée avec un UID arbitraire du groupe root (contrainte
# SCC "restricted" RHEL/OpenShift) : tous les répertoires que nginx doit
# écrire (pid, caches temporaires, logs) sont rendus accessibles en écriture
# au groupe 0, et l'utilisateur nginx (101) sert de valeur par défaut pour
# les exécutions Docker/Podman classiques.
RUN mkdir -p /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp && \
    chgrp -R 0 /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx /tmp && \
    chmod -R g=u /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx /tmp

USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
