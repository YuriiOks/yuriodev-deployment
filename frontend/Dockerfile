# ---- deps: shared dependency install ----
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS deps

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci

# ---- dev: Vite dev server with HMR (local compose only) ----
FROM deps AS dev

# Copy the rest of the application source code
COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

# ---- builder: production build ----
FROM deps AS builder

# Copy the rest of the application source code
COPY . .

# Build the application for production
RUN npm run build

# ---- runtime: lightweight Nginx image serving the built files ----
FROM nginx:stable-alpine@sha256:985220252f3863977e468f611ef118ebd01421289dd86ee1ae99cb068c3bce2b AS runtime

# Pick up any security fixes released for the base image's packages
RUN apk upgrade --no-cache

# Copy the built static files from the 'builder' stage to the Nginx html directory
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy our custom Nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/ || exit 1

# Command to run Nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]
