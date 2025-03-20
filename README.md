
# HackClub Spaces (Notice: We are working on getting this publicly avalible for Github!!!)

A simple web platform that allows users to create and host static websites and Python scripts. Built with Flask and PostgreSQL. Made by Ethan Canterbury and Hack Club ❤️

# To contribute, please create a fork and open a PR.

## Features

- User authentication and management
- Create and host static websites
- Python script editor and execution
- Real-time code editing
- Automatic deployments
- Custom domain support

## Setup

1. Clone this project and create a new `.env` file:
   ```bash
   cp .env.example .env
   ```

2. Update the `.env` file with your database credentials and secret key.

3. Install dependencies:
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

## Preview Code

Currently using 'iloveboba' as the preview code for new signups.

## License

This project is part of HackClub and follows HackClub's licensing terms.
