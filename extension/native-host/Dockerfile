FROM node:22-alpine

WORKDIR /app/extension/native-host

COPY extension/native-host/package.json ./package.json
RUN npm install --omit=dev

COPY extension/ /app/extension/

EXPOSE 27183

ENV NODE_ENV=production \
    HTTP_PORT=27183 \
    OLLAMA_URL=http://host.docker.internal:11434 \
    OLLAMA_MODEL=llama3.2:3b \
    OLLAMA_TIMEOUT_MS=120000

CMD ["node", "host.js"]
