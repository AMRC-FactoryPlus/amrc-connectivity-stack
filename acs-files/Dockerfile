# Use an official Node.js runtime as a parent image
FROM node:18

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000


# Set the working directory inside the container
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json package-lock.json ./
RUN npm install --production

# Copy the rest of the application files
COPY . .

# Expose the application port
EXPOSE 3000

# Command to run the app
CMD ["npm", "start"]
