
# Hack Club Spaces & Club Dashboard

A simple web platform that allows users to create, test and host static websites and Python scripts. Built with Python Flask and PostgreSQL. Made by Ethan Canterbury, and Hack Club

## Features

- User authentication and management
- Create and host static websites
- Python script editor and execution
- Real-time code editing
- Automatic deployments
- Custom domain support
- HCB Integration
- Hackatime Integration

## Setup (Selfhosting Spaces!!)

1. Clone this project and create a new `.env` file:
   ```bash
   cp .env.example .env
   ```

2. Create a `.env` file with the following configuration:
   ```bash
   # Database configuration
   DATABASE_URL=postgresql://username:password@localhost:5432/your_database
   
   # Application secret key (generate a secure random string)
   SECRET_KEY=your-secret-key-here
   
   # ImgBB API key for image uploads (get from https://api.imgbb.com/)
   IMGBB_API_KEY=your-imgbb-api-key-here
   
   # WakaTime API key for Hackatime integration (optional)
   WAKATIME_API_KEY=your-wakatime-api-key-here
   
   # Groq API key for AI chat functionality (required for Orphy chat)
   GROQ_API_KEY=your-groq-api-key-here

   # Pison API URL (Will default to public piston server is left empty)
   PISTON_API_BASE=your-piston-api-url
   ```
   
   **Important**: Never commit your `.env` file to version control. It's already included in `.gitignore`.

3. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Initialize the database:
   ```bash
   python setup_db.py
   ```

5. Run the application:
   ```bash
   python main.py
   ```

The application will be available at `http://0.0.0.0:3000`.

## Database Schema

- **Users**: Stores user information and authentication details
- **Sites**: Stores website/script content and metadata

## VERY IMPORTANT!!!

You MUST have a db created with the correct tables or it will NOT work!! If even the tiniest table is formatted wrong, it will not start!
## License

This project is part of HackClub and follows HackClub's licensing terms. Contributing and socializing on this project is subject to the Hack Club Code of Conduct

For support, create an issue or go to #spaces on slack! Need private help? @Charmunk. Club help? @jps.

## Management 

This project is managed by Ivie Fonner.
