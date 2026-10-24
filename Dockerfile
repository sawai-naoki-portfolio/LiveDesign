# LiveDesign を1つのコンテナで動かす。データ（データベース・素材）は /app/data に置くので、
# ボリュームをつないで消えないようにする（docker run -v livedesign-data:/app/data ...）。
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY index.js ./
COPY server ./server
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "index.js"]
