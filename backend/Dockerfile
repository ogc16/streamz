# Multi-stage build for all services.
#
# Services are npm workspaces: `@streamz/shared` resolves to the workspace at
# compile time (symlink) and `main` points at its TypeScript sources, which only
# tsx/ts-node can run. Containers run plain `node dist/index.js`, so the build
# compiles shared to JS and replaces the symlink in the image with a
# self-contained npm package whose main is the compiled entry point.
#
# Native bcrypt requires a full toolchain (python3/make/g++) on Alpine.

FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++ linux-headers
COPY package.json tsconfig.base.json ./
COPY shared ./shared
COPY services ./services
COPY api-gateway ./api-gateway
RUN npm install -w shared -w services/auth -w services/video -w services/purchase -w services/streaming -w services/webhook -w api-gateway --no-audit --no-fund \
  && npx tsc -p shared && npm run build \
  && rm -rf node_modules/@streamz/shared \
  && mkdir -p node_modules/@streamz/shared/dist \
  && cp -r shared/dist/* node_modules/@streamz/shared/dist/ \
  && cp shared/package.json node_modules/@streamz/shared/package.json \
  && node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('node_modules/@streamz/shared/package.json','utf8'));p.main='dist/index.js';p.types='dist/index.d.ts';fs.writeFileSync('node_modules/@streamz/shared/package.json',JSON.stringify(p,null,2));console.log('shared ->',p.main)"

FROM node:20-alpine AS auth
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/auth/dist ./dist
EXPOSE 4001
CMD ["node", "dist/index.js"]

FROM node:20-alpine AS video
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/video/dist ./dist
EXPOSE 4002
CMD ["node", "dist/index.js"]

FROM node:20-alpine AS purchase
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/purchase/dist ./dist
EXPOSE 4003
CMD ["node", "dist/index.js"]

FROM node:20-alpine AS streaming
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/streaming/dist ./dist
EXPOSE 4004
CMD ["node", "dist/index.js"]

FROM node:20-alpine AS webhook
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/webhook/dist ./dist
EXPOSE 4005
CMD ["node", "dist/index.js"]

FROM node:20-alpine AS gateway
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/api-gateway/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]