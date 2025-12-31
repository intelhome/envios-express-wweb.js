FROM node:18-bullseye-slim

# Variables de entorno para Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Instalar dependencias base
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    --no-install-recommends

# Instalar Google Chrome
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    --no-install-recommends

# Instalar librerías necesarias
RUN apt-get install -y \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copiar package files
COPY package*.json ./

# Instalar dependencias
RUN npm ci --only=production

# Copiar código fuente
COPY . .

# ⭐ APLICAR PATCH CRÍTICO
RUN node patch-whatsapp.js

# Crear directorios
RUN mkdir -p .wwebjs_auth .wwebjs_cache logs && \
    chmod -R 777 .wwebjs_auth .wwebjs_cache logs

# Usuario no-root
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && chown -R pptruser:pptruser /usr/src/app

USER pptruser

EXPOSE 4010

CMD ["npm", "start"]