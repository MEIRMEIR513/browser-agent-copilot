FROM mcr.microsoft.com/playwright:v1.52.0-noble
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx playwright install chromium && npm run build
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
CMD ["npm", "start"]
