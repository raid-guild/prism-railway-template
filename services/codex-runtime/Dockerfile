FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

RUN npm ci

# Install Playwright's pinned Chromium build and its Debian runtime libraries so
# Codex jobs can run reliable browser automation without mutating a live deploy.
RUN npx playwright install --with-deps chromium \
  && node -e "const { chromium } = require('playwright'); const fs = require('node:fs'); if (!fs.existsSync(chromium.executablePath())) process.exit(1)"

RUN npm install -g @railway/cli

COPY . .

RUN npm run build \
  && npm prune --omit=dev

EXPOSE 3030

CMD ["npm", "run", "start"]
