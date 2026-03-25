# Build stage
FROM node:22-alpine AS builder

WORKDIR /build

# Copy dependency files first for better layer caching
COPY package*.json ./

# Install ALL dependencies (including devDependencies for TypeScript build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript to JavaScript
RUN npm run build

# Production stage
FROM node:22-alpine AS production

# Install dumb-init for proper signal handling (SIGINT, SIGTERM)
# This ensures signals are properly forwarded to Node.js process
RUN apk add --no-cache dumb-init

# Security: Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S sre-agent -u 1001 -G nodejs

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies
# Uses npm ci for deterministic installs based on package-lock.json
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /build/dist ./dist

# Change ownership to non-root user
RUN chown -R sre-agent:nodejs /app

# Switch to non-root user
USER sre-agent

# Set environment
ENV NODE_ENV=production
ENV LOG_LEVEL=info

# Use dumb-init as PID 1 to properly handle signals
# dumb-init forwards signals to the node process and reaps zombie processes
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
