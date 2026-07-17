# Multi-stage build for all services
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json ./
COPY tsconfig.base.json ./

# Auth Service
FROM base AS auth-build
COPY services/auth services/auth
COPY shared shared
RUN cd services/auth && npm install && npx tsc

FROM node:20-alpine AS auth
WORKDIR /app
COPY --from=auth-build /app/services/auth/dist ./dist
COPY --from=auth-build /app/services/auth/node_modules ./node_modules
EXPOSE 4001
CMD ["node", "dist/index.js"]

# Video Service
FROM base AS video-build
COPY services/video services/video
COPY shared shared
RUN cd services/video && npm install && npx tsc

FROM node:20-alpine AS video
WORKDIR /app
COPY --from=video-build /app/services/video/dist ./dist
COPY --from=video-build /app/services/video/node_modules ./node_modules
EXPOSE 4002
CMD ["node", "dist/index.js"]

# Purchase Service
FROM base AS purchase-build
COPY services/purchase services/purchase
COPY shared shared
RUN cd services/purchase && npm install && npx tsc

FROM node:20-alpine AS purchase
WORKDIR /app
COPY --from=purchase-build /app/services/purchase/dist ./dist
COPY --from=purchase-build /app/services/purchase/node_modules ./node_modules
EXPOSE 4003
CMD ["node", "dist/index.js"]

# Streaming Service
FROM base AS streaming-build
COPY services/streaming services/streaming
COPY shared shared
RUN cd services/streaming && npm install && npx tsc

FROM node:20-alpine AS streaming
WORKDIR /app
COPY --from=streaming-build /app/services/streaming/dist ./dist
COPY --from=streaming-build /app/services/streaming/node_modules ./node_modules
EXPOSE 4004
CMD ["node", "dist/index.js"]

# Webhook Service
FROM base AS webhook-build
COPY services/webhook services/webhook
COPY shared shared
RUN cd services/webhook && npm install && npx tsc

FROM node:20-alpine AS webhook
WORKDIR /app
COPY --from=webhook-build /app/services/webhook/dist ./dist
COPY --from=webhook-build /app/services/webhook/node_modules ./node_modules
EXPOSE 4005
CMD ["node", "dist/index.js"]

# API Gateway
FROM base AS gateway-build
COPY api-gateway api-gateway
COPY shared shared
RUN cd api-gateway && npm install && npx tsc

FROM node:20-alpine AS gateway
WORKDIR /app
COPY --from=gateway-build /app/api-gateway/dist ./dist
COPY --from=gateway-build /app/api-gateway/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/index.js"]
