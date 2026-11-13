# "Run it live" server image. Build from the repo root:  docker build -f server/Dockerfile -t corvuszk-live .
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY midnight/package.json midnight/package-lock.json ./midnight/
RUN npm ci --no-audit --no-fund && cd midnight && npm ci --no-audit --no-fund
COPY . .
RUN npm run build --if-present && chown -R node:node /app
USER node
ENV NODE_ENV=production PORT=8790 TRUST_PROXY=1 MIDNIGHT_NETWORK=preview MN_WALLET_DIR=/wallet
EXPOSE 8790
CMD ["node", "server/index.mjs"]
