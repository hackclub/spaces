# Spaces
Spaces is a web app that allows access to visual studio code, kicad, and blender, inside of a web browser. It achieves this using container streaming. Spaces was developed by [Ivie Fonner](https://github.com/charmunks/) and [Hack Club](https://github.com/hackclub/)

## Setup:
### Manual Setup:
#### Prerequisites: 
Before installing, you must have:
- Docker installed and the daemon running
- Node.js (v18.x or higher) and npm installed
- PostgreSQL database set up and accessible
- Airtable account with API key and base ID for email verification

#### Installation: 
```bash
git clone https://github.com/hackclub/spaces-new.git

cp example.env .env # fill out the .env

npm install

npm run client-install

# run both client and server
npm run dev

# run only backend
npm run serve:server

# run only client 
npm run serve:client
```

### Docker Setup:

#### Prerequisites: 
Before installing, you must have:
- Docker and docker-compose installed and the daemon running
- PostgreSQL database set up and accessible
- Airtable account with API key and base ID for email verification

#### Installation:
```bash
git clone https://github.com/hackclub/spaces-new.git

cp example.env .env # make sure to set DOCKER=true

docker compose up --build
# server is now live at localhost:2593
```

### .env setup:

```bash
# postgres database connection 
PG_CONNECTION_STRING=your-postgres-db-url
# airtable credentials for email otps
AIRTABLE_API_KEY=your-airtable-pat
AIRTABLE_BASE_ID=your-airtable-base-id

# Server configuration
PORT=3000
NODE_ENV=development

# Frontend configuration
FRONTEND_URL=http://localhost:5173

# Server URL for container access URLs
SERVER_URL=http://localhost

# Set to 'true' if running in Docker, 'false' for manual setup
DOCKER=false
```

**Required Environment Variables:**
- `PG_CONNECTION_STRING` - PostgreSQL database connection URL
- `AIRTABLE_API_KEY` - Airtable API key for email verification
- `AIRTABLE_BASE_ID` - Airtable base ID for storing verification codes
- `PORT` - Backend server port (default: 3000)
- `DOCKER` - Must be 'true' for Docker setup, 'false' for manual setup
- `SERVER_URL` - Base URL for container access (e.g., http://localhost or your domain)
- `FRONTEND_URL` - Frontend URL for CORS (default: http://localhost:5173)
- `NODE_ENV` - Environment mode: 'development' or 'production'

## API Documentation:

By default the API will be accessible at `/api/v1`

### Authentication

All API endpoints that require authentication expect an `authorization` token in the request headers or body. This token is obtained during login/signup and must be included in subsequent requests.

### Users API (`/api/v1/users`)

#### Send Verification Code
- **POST** `/api/v1/users/send`
- **Description**: Send a verification code to the provided email address
- **Body**:
  ```json
  {
    "email": "user@example.com"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "message": "Verification code sent successfully",
    "data": {
      "email": "user@example.com"
    }
  }
  ```

#### Sign Up
- **POST** `/api/v1/users/signup`
- **Description**: Create a new user account with email verification
- **Body**:
  ```json
  {
    "email": "user@example.com",
    "username": "myusername",
    "verificationCode": "123456"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "message": "User created successfully",
    "data": {
      "id": 1,
      "email": "user@example.com",
      "username": "myusername",
      "authorization": "auth_token_here"
    }
  }
  ```

#### Login
- **POST** `/api/v1/users/login`
- **Description**: Login with email and verification code
- **Body**:
  ```json
  {
    "email": "user@example.com",
    "code": "123456"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "message": "Login successful",
    "data": {
      "email": "user@example.com",
      "username": "myusername",
      "authorization": "new_auth_token_here"
    }
  }
  ```

#### Sign Out
- **POST** `/api/v1/users/signout`
- **Description**: Sign out and invalidate the current authorization token
- **Body**:
  ```json
  {
    "authorization": "current_auth_token"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "message": "Sign out successful",
    "data": {
      "email": "user@example.com"
    }
  }
  ```

### Spaces API (`/api/v1/spaces`)

#### Create Container
- **POST** `/api/v1/spaces/create`
- **Description**: Create a new containerized workspace
- **Headers**: 
  - `authorization: your_auth_token`
- **Body**:
  ```json
  {
    "password": "container_password",
    "type": "code-server"
  }
  ```
- **Valid Types**: `code-server`, `blender`, `kicad`
- **Response**:
  ```json
  {
    "message": "Container created successfully",
    "spaceId": 1,
    "containerId": "docker_container_id",
    "type": "code-server",
    "description": "VS Code Server",
    "image": "linuxserver/code-server",
    "port": 8080,
    "accessUrl": "http://localhost:8080"
  }
  ```

#### Start Container
- **POST** `/api/v1/spaces/start/:spaceId`
- **Description**: Start an existing container
- **Headers**: 
  - `authorization: your_auth_token`
- **Parameters**:
  - `spaceId`: The ID of the space to start
- **Response**:
  ```json
  {
    "message": "Container started successfully",
    "spaceId": 1,
    "containerId": "docker_container_id"
  }
  ```

#### Stop Container
- **POST** `/api/v1/spaces/stop/:spaceId`
- **Description**: Stop a running container
- **Headers**: 
  - `authorization: your_auth_token`
- **Parameters**:
  - `spaceId`: The ID of the space to stop
- **Response**:
  ```json
  {
    "message": "Container stopped successfully",
    "spaceId": 1,
    "containerId": "docker_container_id"
  }
  ```

#### Get Container Status
- **GET** `/api/v1/spaces/status/:spaceId`
- **Description**: Get the current status of a container
- **Headers**: 
  - `authorization: your_auth_token`
- **Parameters**:
  - `spaceId`: The ID of the space to check
- **Response**:
  ```json
  {
    "spaceId": 1,
    "containerId": "docker_container_id",
    "type": "code-server",
    "description": "VS Code Server",
    "accessUrl": "http://localhost:8080",
    "status": "running",
    "running": true,
    "startedAt": "2023-01-01T00:00:00.000Z",
    "finishedAt": "0001-01-01T00:00:00Z"
  }
  ```

#### List User Spaces
- **GET** `/api/v1/spaces/list`
- **Description**: Get all spaces owned by the authenticated user
- **Headers**: 
  - `authorization: your_auth_token`
- **Response**:
  ```json
  {
    "message": "Spaces retrieved successfully",
    "spaces": [
      {
        "id": 1,
        "type": "code-server",
        "description": "VS Code Server",
        "image": "linuxserver/code-server",
        "port": 8080,
        "access_url": "http://localhost:8080",
        "created_at": "2023-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

### Container Types

| Type | Description | Image | 
|------|-------------|-------|
| `code-server` | VS Code Server | `linuxserver/code-server` | 
| `blender` | Blender 3D | `linuxserver/blender` | 
| `kicad` | KiCad PCB Design | `linuxserver/kicad` | 

### Error Responses

All endpoints return consistent error responses:

```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error (development only)"
}
```

Common HTTP status codes:
- `400`: Bad Request (missing/invalid parameters)
- `401`: Unauthorized (invalid/missing auth token)
- `404`: Not Found (resource doesn't exist)
- `409`: Conflict (duplicate email/username)
- `500`: Internal Server Error

