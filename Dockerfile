FROM node:24-bookworm-slim AS node-runtime

FROM python:3.12-slim-bookworm AS application

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules

RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates ffmpeg fontconfig fonts-noto-cjk tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json pyproject.toml ./
RUN npm ci

COPY . .

RUN python -m pip install --no-cache-dir ".[zai]" \
    && npm run build \
    && npm prune --omit=dev \
    && ffmpeg -hide_banner -filters 2>/dev/null | grep -q subtitles \
    && fc-match "Noto Sans CJK SC" | grep -qi noto \
    && apt-get purge -y build-essential \
    && apt-get autoremove -y \
    && rm -rf /root/.cache /tmp/*

RUN groupadd --gid 10001 storyvideogen \
    && useradd --uid 10001 --gid storyvideogen --home-dir /app --shell /usr/sbin/nologin storyvideogen \
    && mkdir -p /app/output \
    && chown -R storyvideogen:storyvideogen /app/output

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    STORYVIDEOGEN_PYTHON=/usr/local/bin/python3.12

USER storyvideogen

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/dist/index.js"]
