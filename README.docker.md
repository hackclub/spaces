
# Running the Application with Docker

This guide explains how to run the Spaces application using Docker.

## Requirements

- Docker
- Docker Compose (included with Docker Desktop for Windows/Mac)

## Quick Start

1. Clone the repository
2. Navigate to the project directory
3. Run the application with Docker Compose:

```bash
docker-compose up
```

The application will be available at http://localhost:3000

## Configuration

You can modify environment variables in the `docker-compose.yml` file:

- Database credentials
- Application secret key
- API keys for integrations

## First-time Setup

When running for the first time, you need to initialize the database:

```bash
# In a new terminal while the containers are running
docker-compose exec app python setup_db.py
```

## Troubleshooting

- If the app fails to connect to the database, ensure the database container is running:
  ```bash
  docker-compose ps
  ```

- To view logs:
  ```bash
  docker-compose logs -f app
  ```

- To restart the application:
  ```bash
  docker-compose restart app
  ```

## For Production

For production deployment, make these changes:

1. Use a stronger SECRET_KEY
2. Configure all required API keys
3. Set up proper database volumes and backups
4. Consider using a reverse proxy like Nginx
