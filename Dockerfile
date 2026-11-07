FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
