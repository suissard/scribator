# Contexte de build : racine du dépôt
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --include-workspace-root=false
COPY server server
RUN npm run build -w server

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --include-workspace-root=false --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist server/dist
WORKDIR /app/server
RUN mkdir -p logs && chown node:node logs
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
