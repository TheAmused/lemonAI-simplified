FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY index.html postcss.config.js tailwind.config.js tsconfig.json tsconfig.node.json vite.config.ts ./
COPY public ./public
COPY src ./src

ARG VITE_HUB_API_URL=http://127.0.0.1:5000
ARG VITE_DEMO_ACCOUNTS=true
ENV VITE_HUB_API_URL=${VITE_HUB_API_URL} \
    VITE_DEMO_ACCOUNTS=${VITE_DEMO_ACCOUNTS}
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
