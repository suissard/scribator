# Contexte de build : racine du dépôt. Le client est compilé puis servi par Caddy.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace client --include-workspace-root=false
COPY client client
ENV VITE_POCKETBASE_URL=/pb VITE_API_SERVER_URL=/api
RUN npm run build -w client

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/client/dist /srv
