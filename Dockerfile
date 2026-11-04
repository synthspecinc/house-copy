FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3210 HOUSE_COPY_DB=/data/house-copy.sqlite
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY public ./public
COPY config ./config
COPY fixtures ./fixtures
COPY scripts ./scripts
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md ./
COPY third_party ./third_party
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3210
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 CMD ["node", "-e", "fetch('http://127.0.0.1:3210/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/server.js"]
