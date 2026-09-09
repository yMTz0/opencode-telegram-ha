FROM node:22-bookworm-slim

# OpenCode binário + bot Telegram
RUN apt-get update && apt-get install -y curl git bash procps && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://opencode.ai/install | bash \
  && ln -sf /root/.opencode/bin/opencode /usr/local/bin/opencode \
  && npm install -g @grinev/opencode-telegram-bot \
  && opencode --version && opencode-telegram --help | head -5

WORKDIR /app
COPY package.json server.js monitor-vps.js start.sh ./
COPY workspace /app/workspace
RUN chmod +x start.sh && mkdir -p /app/data
ENV ROLE=vps \
    OPENCODE_API_URL=http://localhost:4096 \
    OPENCODE_TELEGRAM_HOME=/app/data \
    OPEN_BROWSER_ROOTS=/app/workspace \
    HEALTH_PORT=10000 \
    CHECK_INTERVAL_SEC=15 \
    TAKEOVER_AFTER_SEC=90 \
    STEPDOWN_STABLE_SEC=90

# Render define $PORT; usamos HEALTH_PORT=10000 e mapeamos via render.yaml healthCheck
EXPOSE 10000
CMD ["bash", "start.sh"]
