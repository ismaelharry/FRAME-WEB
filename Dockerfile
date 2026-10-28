# Imagen de producción de FRAME (Node 22 con SQLite integrado).
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY public ./public
COPY src ./src
# Los datos y las fotos subidas viven en un volumen persistente.
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app/data /app/uploads
USER node
ENV DATABASE_FILE=/app/data/frame.db UPLOADS_DIR=/app/data/uploads PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
