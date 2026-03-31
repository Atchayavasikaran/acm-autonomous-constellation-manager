FROM ubuntu:22.04

WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y \
    nodejs \
    npm \
    curl

# Copy project files
COPY . .

# Move to backend
WORKDIR /app/backend

# Install backend dependencies
RUN npm install

# Expose required port
EXPOSE 8000

# Start server
CMD ["node", "server.js"]