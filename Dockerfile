FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@10.11.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321 DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/scripts/start.mjs ./scripts/start.mjs
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4321
CMD ["node", "scripts/start.mjs"]
