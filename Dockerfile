# Use the official Node image as a base
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY tsconfig*.json ./

# Copy packages and apps
COPY packages/ ./packages/
COPY apps/server/ ./apps/server/
COPY apps/game/ ./apps/game/
COPY content/ ./content/

# Install dependencies and build
RUN npm install
RUN npm run build --workspace @helm/server
RUN npm run build --workspace @helm/game

# --- Production Image ---
FROM node:22-alpine AS runner

WORKDIR /app

# Copy only the necessary files for production
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/content ./content
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/game/dist ./apps/game/dist

# The Express server serves the compiled Vite game from apps/game/dist.

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start:built", "--workspace", "@helm/server"]
