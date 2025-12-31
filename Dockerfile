FROM node:18-slim

# -------------------------------------------------------
# INSTALAR GOOGLE CHROME STABLE (más estable que Chromium)
# -------------------------------------------------------
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates --no-install-recommends && \
    wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    echo "deb [arch=amd64] https://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && apt-get install -y \
    google-chrome-stable \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# LIBRERÍAS NECESARIAS PARA PUPPETEER
RUN apt-get update && apt-get install -y \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxrender1 \
    libxext6 \
    libxi6 \
    libxtst6 \
    libglib2.0-0 \
    libdrm2 \
    libgbm1 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libcups2 \
    libasound2 \
    libxkbcommon0 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# -------------------------------------------------------
# EVITAR DESCARGA DE CHROMIUM (usaremos Google Chrome)
# -------------------------------------------------------
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/google-chrome-stable"
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# -------------------------------------------------------
# ARCHIVOS DE LA APP
# -------------------------------------------------------
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --force
COPY . .

RUN mkdir -p .wwebjs_auth .wwebjs_cache logs && \
    chmod -R 777 .wwebjs_auth .wwebjs_cache logs

EXPOSE 4010
CMD ["npm", "start"]
