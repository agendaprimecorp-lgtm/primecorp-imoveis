FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY services/capture-worker/package*.json ./services/capture-worker/

# Install dependencies
RUN npm ci --omit=dev

# Copy source
COPY services/capture-worker ./services/capture-worker
COPY packages ./packages

# Build (if needed)
RUN npm run build --workspace=@propto/capture-worker || true

# Copy entrypoint
COPY scripts/docker-entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
