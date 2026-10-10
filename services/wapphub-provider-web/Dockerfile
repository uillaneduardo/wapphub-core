FROM node:22.23.3-bookworm-slim AS build
WORKDIR /workspace/services/wapphub-provider-web
COPY services/wapphub-provider-web/package*.json ./
RUN npm ci
COPY contracts /workspace/contracts
COPY package.json /workspace/package.json
COPY services/wapphub-provider-web/tsconfig.json ./
COPY services/wapphub-provider-web/src ./src
COPY services/wapphub-provider-web/scripts ./scripts
RUN ln -s services/wapphub-provider-web/node_modules /workspace/node_modules && npm run build && npm prune --omit=dev

FROM node:22.23.3-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends util-linux && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /workspace/services/wapphub-provider-web/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/services/wapphub-provider-web/dist ./dist
COPY --chown=node:node services/wapphub-provider-web/package.json ./package.json
COPY --chown=node:node services/wapphub-provider-web/scripts/entrypoint.sh ./entrypoint.sh
RUN chmod 0555 entrypoint.sh && mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production ALLOW_SESSION_CONNECT=false PROVIDER_DATA_DIR=/data
ENTRYPOINT ["/app/entrypoint.sh"]
