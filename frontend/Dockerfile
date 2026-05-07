# Node.js build stage
FROM node:18-alpine as builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

# Nginx runtime stage
FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
RUN echo 'server {\n\
  listen 3000;\n\
  location / {\n\
    root /usr/share/nginx/html;\n\
    try_files $uri /index.html;\n\
  }\n\
  location /api {\n\
    proxy_pass http://backend:8000;\n\
  }\n\
}' > /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
