# Rail Gun API - Production Dockerfile
# =====================================
# 
# Security features:
# - Multi-stage build (minimal final image)
# - Non-root user
# - Minimal base image (Alpine)
# - No dev dependencies in production
# - Health check included

# ===========================================
# Stage 1: Build
# ===========================================
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8 --activate

WORKDIR /app

# Copy package files first for better caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY services/api/package.json ./services/api/

# Install dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared ./packages/shared
COPY services/api ./services/api
COPY tsconfig.base.json ./

# Build the application
RUN pnpm --filter @railgun/shared build
RUN pnpm --filter @railgun/api build

# Prune dev dependencies
RUN pnpm prune --prod

# ===========================================
# Stage 2: Production
# ===========================================
FROM node:20-alpine AS production

# Security: Don't run as root
RUN addgroup -g 1001 -S railgun && \
    adduser -S -D -H -u 1001 -G railgun railgun

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy only necessary files from builder
COPY --from=builder --chown=railgun:railgun /app/node_modules ./node_modules
COPY --from=builder --chown=railgun:railgun /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=railgun:railgun /app/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=railgun:railgun /app/services/api/dist ./services/api/dist
COPY --from=builder --chown=railgun:railgun /app/services/api/package.json ./services/api/
COPY --from=builder --chown=railgun:railgun /app/package.json ./

# Security: Remove unnecessary files
RUN rm -rf /app/node_modules/.cache

# Switch to non-root user
USER railgun

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "services/api/dist/main.js"]
