# Testnet demo only. No wallets, secrets, or mainnet credentials are copied.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 --shell /usr/sbin/nologin app

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev=false

COPY tsconfig.json ./
COPY src ./src
COPY demo ./demo
COPY LICENSE ./

RUN npm run build && chown -R app:app /app

USER app
ENV NODE_ENV=production
ENV NETWORK=xrpl-testnet
ENV HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "demo/hosted-server.mjs"]
