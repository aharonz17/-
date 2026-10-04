# better-sqlite3 הוא מודול נייטיב ודורש הידור.
# שלב build נפרד מוודא שכלי ההידור לא נגררים לתמונה הסופית.
FROM node:22-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Jerusalem

COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY bin ./bin

# הדיסק ב-Cloud Run זמני. התיקייה משמשת כשלב ביניים לפני ההעלאה ל-Drive.
RUN mkdir -p data && chown -R node:node /app

USER node

EXPOSE 8080
CMD ["node", "src/main.js"]
