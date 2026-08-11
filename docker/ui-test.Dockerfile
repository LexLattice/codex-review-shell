FROM node:24.14.0-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    dbus-x11 \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    xauth \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

RUN chown node:node /workspace

COPY --chown=node:node package.json package-lock.json ./

USER node

RUN npm ci --no-audit --no-fund

COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node docker ./docker
COPY --chown=node:node docs/direct-codex/profile-v0 ./docs/direct-codex/profile-v0

RUN chmod 0755 /workspace/docker/ui-test-entrypoint.sh

ENV HOME=/tmp/codex-test-home \
    XDG_CONFIG_HOME=/tmp/codex-test-home/.config \
    XDG_CACHE_HOME=/tmp/codex-test-home/.cache \
    TMPDIR=/tmp \
    CODEX_TEST_REPO_ROOT=/workspace \
    CODEX_TEST_ARTIFACT_DIR=/artifacts \
    CODEX_TEST_NETWORK_MODE=none

ENTRYPOINT ["/workspace/docker/ui-test-entrypoint.sh"]
