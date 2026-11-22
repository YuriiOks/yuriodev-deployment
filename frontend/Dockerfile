# ---- deps: shared dependency install ----
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS deps

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
FROM nginx:stable-alpine@sha256:caf4e1e032a20f9c3c5e28fc7f25ffd768ad8677b4975c54193075997b3a97e3 AS runtime

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
