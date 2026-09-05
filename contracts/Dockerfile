# Build stage: compile the keeper to plain JS so the runtime image is lean
# (ts-node + typescript never ship, keeping runtime RAM well under 256MB).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund \
 && npx tsc scripts/keeper.ts --outDir dist --rootDir scripts \
      --module commonjs --target es2022 --moduleResolution node \
      --esModuleInterop --skipLibCheck

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/keeper.js"]
