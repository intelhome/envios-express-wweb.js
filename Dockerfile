FROM node:18-slim

# Instalar dependencias de Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Variables de entorno para Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Crear directorio de trabajo
WORKDIR /usr/src/app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de Node.js
RUN npm i --force

# Copiar código de la aplicación
COPY . .

# Crear directorios necesarios con permisos correctos
RUN mkdir -p .wwebjs_auth .wwebjs_cache logs && \
    chmod -R 777 .wwebjs_auth .wwebjs_cache logs

# Exponer puerto
EXPOSE 4010

# Comando de inicio
CMD ["node", "index.js"]