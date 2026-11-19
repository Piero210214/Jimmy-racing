# Fly.io / Railway / any Docker host. No npm install needed (zero dependencies).
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY src ./src
COPY tools ./tools
COPY dist ./dist
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server/server.js"]
