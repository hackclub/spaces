# Hack Club Spaces Frontend

A modern web interface for managing development spaces with Code Server, Blender, and KiCad.

## Features

- 🔐 **Authentication**: Secure email-based login with verification codes
- 🚀 **Space Management**: Create, start, stop, and monitor development environments
- 🎨 **Clean UI**: Modern dark-themed interface built with Svelte
- 📱 **Responsive**: Works on desktop and mobile devices

## Available Space Types

- **Code Server**: Web-based VS Code editor
- **Blender**: 3D modeling and animation software
- **KiCad**: PCB design and schematic editor

## Getting Started

### Development

1. Install dependencies:
```bash
cd client
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Open your browser to `http://localhost:5173`

### Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

### Environment Configuration

You can configure the API base URL using environment variables:

Create a `.env` file in the `client` directory:
```
VITE_API_BASE=http://your-api-url/api/v1
```

If not specified, it defaults to `http://localhost:5678/api/v1`

## Demo Mode

To preview the UI without a backend, open `demo.html`:
```
http://localhost:5173/demo.html
```

This shows the dashboard with mock data.

## Project Structure

```
client/
├── src/
│   ├── lib/
│   │   ├── Auth.svelte       # Authentication component
│   │   └── Dashboard.svelte   # Main dashboard component
│   ├── App.svelte            # Main application
│   ├── config.js             # Configuration and constants
│   ├── main.js               # Application entry point
│   └── app.css               # Global styles
├── demo.html                 # Demo page
├── index.html                # Main HTML file
└── package.json              # Dependencies
```

## Usage

### Authentication Flow

1. **Sign Up**: New users enter email and username, receive a verification code
2. **Login**: Existing users enter email, receive a verification code
3. **Verify**: Enter the code from email to complete authentication

### Managing Spaces

1. Click **"+ Create New Space"** to create a new environment
2. Select the space type (Code Server, Blender, or KiCad)
3. Set a password for the space
4. Use **Start/Stop** buttons to control your spaces
5. Click **Open** to access running spaces
6. Use **Refresh** to update status

## API Integration

The frontend communicates with the backend API at these endpoints:

- `POST /api/v1/users/send` - Send verification code
- `POST /api/v1/users/signup` - Create new account
- `POST /api/v1/users/login` - Login existing user
- `POST /api/v1/users/signout` - Sign out
- `GET /api/v1/spaces/list` - List user's spaces
- `POST /api/v1/spaces/create` - Create new space
- `POST /api/v1/spaces/start/:id` - Start a space
- `POST /api/v1/spaces/stop/:id` - Stop a space
- `GET /api/v1/spaces/status/:id` - Get space status

## Technologies

- **Svelte** - Reactive UI framework
- **Vite** - Build tool and dev server
- **JavaScript (ES6+)** - Programming language

## Contributing

When contributing to the frontend:

1. Follow the existing code style
2. Keep components focused and reusable
3. Test on different screen sizes
4. Ensure the build passes: `npm run build`
