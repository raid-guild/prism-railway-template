FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-dev \
    python-is-python3 \
    build-essential \
    pkg-config \
    libopus-dev \
    ca-certificates \
    curl \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

ARG BUZZ_CLI_VERSION=0.5.0
ARG BUZZ_CLI_SHA256=9674cf098eca88333e8d895ec9d0a5c56c796fbc358fe1087b645890b8e2faca
RUN curl -fsSL \
      "https://github.com/block/buzz/releases/download/v${BUZZ_CLI_VERSION}/Buzz_${BUZZ_CLI_VERSION}_amd64.deb" \
      -o /tmp/buzz.deb \
  && echo "${BUZZ_CLI_SHA256}  /tmp/buzz.deb" | sha256sum -c - \
  && dpkg-deb -x /tmp/buzz.deb /tmp/buzz-package \
  && install -m 0755 /tmp/buzz-package/usr/bin/buzz /usr/local/bin/buzz \
  && rm -rf /tmp/buzz.deb /tmp/buzz-package

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src

RUN npm run build

CMD ["sh", "-c", "node dist/index.js"]
