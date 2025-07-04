# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=20.11.0
FROM node:${NODE_VERSION}-slim as base

LABEL fly_launch_runtime="Remix"

# Remix app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"

# Throw-away build stage to reduce size of final image
FROM base as build

# Set NODE_ENV to development during build to ensure dev dependencies are installed
ENV NODE_ENV="development"

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

# Set environment variables to fix rollup issues
ENV ROLLUP_DISABLE_FSEVENTS=true
ENV npm_config_target_platform=linux
ENV npm_config_target_arch=x64
ENV npm_config_cache=/tmp/.npm

# Install node modules
COPY package-lock.json package.json ./

# Clean install with proper platform settings
RUN npm cache clean --force && \
    npm ci --no-audit --no-fund --force && \
    npm rebuild --force && \
    npm install @rollup/rollup-linux-x64-gnu --force || true

# Verify remix is installed
RUN ls -la node_modules/.bin/ | grep remix || echo "Remix not found in .bin"
RUN npm list @remix-run/dev || echo "Remix dev not found"

# Copy application code
COPY . .

# Set NODE_ENV back to production for build
ENV NODE_ENV="production"

# Build application using npx to ensure we find the binary
RUN npx --yes remix vite:build

# Remove development dependencies
RUN npm prune --omit=dev --force

# Final stage for app image
FROM base

# Set production environment
ENV NODE_ENV="production"

# Copy built application
COPY --from=build /app /app

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
CMD [ "npm", "run", "start" ]