import os
import logging
import subprocess
import signal
import atexit
from flask import render_template, request, redirect, url_for, flash, session
from flask_login import login_required, current_user, login_user
from datetime import datetime
from app import app, db
from models import User, Site, Club, ClubMembership, UserActivity
from utils.rate_limit import rate_limit
from utils.logs_util import logs_manager  # Import logs_manager
from utils.site_utils import get_max_sites_per_user

# Configure logging - reduced verbosity
logging.basicConfig(
    level=logging.WARNING,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

# Create console handler with a higher log level
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.WARNING)
formatter = logging.Formatter('[%(asctime)s] [%(levelname)s] %(message)s')
console_handler.setFormatter(formatter)

# Add the handlers to the logger
app.logger.addHandler(console_handler)
app.logger.setLevel(logging.WARNING)

# Global variable to store the Hackatime service process
hackatime_process = None

def initialize_database():
    """Initialize the database and create all tables."""
    try:
        app.logger.info("Initializing database...")
        with app.app_context():
            db.create_all()
        app.logger.info("Database initialized successfully.")
        return True
    except Exception as e:
        app.logger.warning(f"Database initialization error: {e}")
        return False

def start_hackatime_service():
    """Start the Hackatime service as a subprocess."""
    global hackatime_process
    try:
        app.logger.info("Starting Hackatime service...")
        hackatime_process = subprocess.Popen(
            ['python', 'hackatime_service.py'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        app.logger.info(f"Hackatime service started with PID {hackatime_process.pid}")
    except Exception as e:
        app.logger.error(f"Error starting Hackatime service: {str(e)}")

def stop_hackatime_service():
    """Stop the Hackatime service when the main app exits."""
    global hackatime_process
    if hackatime_process and hackatime_process.poll() is None:
        app.logger.info(f"Stopping Hackatime service (PID {hackatime_process.pid})...")
        try:
            hackatime_process.send_signal(signal.SIGTERM)
            hackatime_process.wait(timeout=5)
            app.logger.info("Hackatime service stopped gracefully")
        except subprocess.TimeoutExpired:
            app.logger.warning("Timeout waiting for service to stop, forcing termination")
            hackatime_process.kill()
        except Exception as e:
            app.logger.error(f"Error stopping service: {str(e)}")
            hackatime_process.kill()

@app.route('/join-club')
def join_club_redirect():
    """Handle redirects from QR code scans"""
    join_code = request.args.get('code')
    if not join_code:
        flash('Invalid QR code', 'error')
        return redirect(url_for('welcome'))

    if current_user.is_authenticated:
        # Process join directly instead of just passing the code via redirect
        try:
            club = Club.query.filter_by(join_code=join_code).first()
            if not club:
                flash('Invalid join code', 'error')
                return redirect(url_for('welcome'))

            # Check if user is already a member
            existing_membership = ClubMembership.query.filter_by(
                user_id=current_user.id, club_id=club.id).first()

            if existing_membership:
                flash(f"You are already a member of {club.name}", 'info')
                return redirect(url_for('club_dashboard', club_id=club.id))

            # Add user to the club
            new_membership = ClubMembership(
                user_id=current_user.id,
                club_id=club.id,
                role='member'
            )
            db.session.add(new_membership)

            activity = UserActivity(
                activity_type="club_join",
                message=f"User {{username}} joined club {club.name}",
                username=current_user.username,
                user_id=current_user.id
            )
            db.session.add(activity)
            db.session.commit()

            flash(f"You have successfully joined {club.name}!", 'success')
            return redirect(url_for('club_dashboard', club_id=club.id))
        except Exception as e:
            db.session.rollback()
            app.logger.error(f"Error joining club: {str(e)}")
            flash(f"Error joining club: {str(e)}", 'error')
            return redirect(url_for('welcome'))
    else:
        # Redirect to login page with join code in session
        session['pending_join_code'] = join_code
        flash('Please log in or sign up to join the club', 'info')
        return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
@rate_limit('login')
def login():
    if current_user.is_authenticated:
        # Check if there's a pending join code in session
        pending_join_code = session.get('pending_join_code')
        if pending_join_code:
            session.pop('pending_join_code', None)
            return redirect(url_for('join_club_redirect', code=pending_join_code))
        return redirect(url_for('welcome'))

    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')

        # Validate email format
        import re
        if not email or not re.match(
                r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email):
            flash('Please enter a valid email address', 'error')
            return render_template('login.html')

        user = User.query.filter_by(email=email).first()
        if user and user.check_password(password):
            # If the password hash starts with 'scrypt', rehash it with pbkdf2
            if user.password_hash.startswith('scrypt:'):
                app.logger.info(f"Rehashing password for user {user.id}")
                user.set_password(password)  # This will use the new pbkdf2 method

            login_user(user)
            user.last_login = datetime.utcnow()

            activity = UserActivity(activity_type="user_login",
                                    message="User {username} logged in",
                                    username=user.username,
                                    user_id=user.id)
            db.session.add(activity)
            db.session.commit()

            flash(f'Welcome back, {user.username}!', 'success')

            # Check if there's a pending join code in session
            pending_join_code = session.get('pending_join_code')
            if pending_join_code:
                session.pop('pending_join_code', None)
                return redirect(url_for('join_club_redirect', code=pending_join_code))

            return redirect(url_for('welcome'))

        flash('Invalid email or password', 'error')

    return render_template('login.html')

@app.route('/signup', methods=['GET', 'POST'])
@rate_limit('signup')
def signup():
    if current_user.is_authenticated:
        # Check if there's a pending join code in session
        pending_join_code = session.get('pending_join_code')
        if pending_join_code:
            session.pop('pending_join_code', None)
            return redirect(url_for('join_club_redirect', code=pending_join_code))
        return redirect(url_for('welcome'))

    # Check if user is coming from leader onboarding
    from_leader_onboarding = request.args.get('from_leader_onboarding') == 'true'

    if request.method == 'POST':
        # CSRF validation removed

        username = request.form.get('username')
        email = request.form.get('email')
        password = request.form.get('password')
        is_leader = request.form.get('is_leader') == 'true'

        # Additional validation
        if not username or not email or not password:
            flash('All fields are required', 'error')
            return render_template('signup.html', from_leader_onboarding=from_leader_onboarding), 400

        # Simple username validation
        if len(username) < 3 or len(username) > 30:
            flash('Username must be between 3 and 30 characters', 'error')
            return render_template('signup.html', from_leader_onboarding=from_leader_onboarding), 400

        # Email validation
        import re
        if not re.match(r'^[\w\.-]+@[\w\.-]+\.\w+$', email):
            flash('Please enter a valid email address', 'error')
            return render_template('signup.html', from_leader_onboarding=from_leader_onboarding), 400

        # Password validation
        if len(password) < 6:
            flash('Password must be at least 6 characters long', 'error')
            return render_template('signup.html', from_leader_onboarding=from_leader_onboarding), 400

        if User.query.filter_by(email=email).first():
            flash('Email already registered', 'error')
            return render_template('signup.html', from_leader_onboarding=from_leader_onboarding)

        if User.query.filter_by(username=username).first():
            flash('Username already taken', 'error')
            return render_template('signup.html', from_leader_onboarding=from_leader_onboarding)

        # Create user with automatic access
        user = User(username=username, email=email, preview_code_verified=True)
        user.set_password(password)

        db.session.add(user)
        db.session.flush()  # Flush to get the user ID without committing

        activity = UserActivity(activity_type="user_registration",
                                message="New user registered: {username}",
                                username=username,
                                user_id=user.id)
        db.session.add(activity)

        # Store the pending join code
        pending_join_code = session.get('pending_join_code')

        # If user is registering from leader onboarding, make them a club leader
        if is_leader or from_leader_onboarding:
            # First commit the user to get a valid user ID
            db.session.commit()

            # Create a new club with this user as leader
            from models import Club
            club = Club(
                name=f"{username}'s Club",
                description="A new Hack Club - edit your club details in the dashboard",
                leader_id=user.id
            )
            club.generate_join_code()
            db.session.add(club)
            # Commit to get the club ID
            db.session.commit()

            # Add a club membership for the leader too
            from models import ClubMembership
            membership = ClubMembership(
                user_id=user.id,
                club_id=club.id,
                role='co-leader'
            )
            db.session.add(membership)

            # Record the activity
            club_activity = UserActivity(
                activity_type="club_creation",
                message=f'Club "{club.name}" created by {{username}}',
                username=username,
                user_id=user.id
            )
            db.session.add(club_activity)

            # Login the user automatically
            db.session.commit()
            user.last_login = datetime.utcnow()
            db.session.commit()

            login_user(user)

            # Redirect to club setup instead of dashboard
            flash(f'Welcome, {username}! Let\'s set up your club.', 'success')
            return redirect(url_for('club_setup'))

        db.session.commit()

        # Login the user automatically
        login_user(user)
        user.last_login = datetime.utcnow()
        db.session.commit()

        flash(f'Welcome, {username}! Your account has been created.', 'success')

        # If there's a pending join code, redirect to join club
        if pending_join_code:
            session.pop('pending_join_code', None)
            return redirect(url_for('join_club_redirect', code=pending_join_code))

        return redirect(url_for('welcome'))

    return render_template('signup.html', from_leader_onboarding=from_leader_onboarding)

@app.route('/welcome')
@login_required
def welcome():
    sites = Site.query.filter_by(user_id=current_user.id).all()
    max_sites = get_max_sites_per_user()

    # Get club memberships
    club_memberships = db.session.query(ClubMembership).filter_by(
        user_id=current_user.id).all()

    # Get language icons for code spaces
    from piston_service import PistonService
    language_icons = {}
    for lang in PistonService.get_languages():
        language_icons[lang] = PistonService.get_language_icon(lang)

    # Check for join_code in request args
    join_code = request.args.get('join_code')
    join_message = None

    if join_code:
        # Try to join the club with the provided code
        club = Club.query.filter_by(join_code=join_code).first()
        if club:
            # Check if user is already a member
            existing_membership = ClubMembership.query.filter_by(
                user_id=current_user.id, club_id=club.id).first()

            if existing_membership:
                # If already a member, redirect directly to the club dashboard
                flash(f"Welcome back to {club.name}!", 'info')
                return redirect(url_for('club_dashboard', club_id=club.id))
            else:
                # Add user to the club
                new_membership = ClubMembership(
                    user_id=current_user.id,
                    club_id=club.id,
                    role='member'
                )
                db.session.add(new_membership)

                # Add activity record
                activity = UserActivity(
                    activity_type="club_join",
                    message=f"User {{username}} joined club {club.name}",
                    username=current_user.username,
                    user_id=current_user.id
                )
                db.session.add(activity)

                try:
                    db.session.commit()
                    flash(f"You have successfully joined {club.name}!", 'success')
                    # Redirect to the club dashboard
                    return redirect(url_for('club_dashboard', club_id=club.id))
                except Exception as e:
                    db.session.rollback()
                    app.logger.error(f"Error joining club: {str(e)}")
                    flash(f"Error joining club: {str(e)}", 'error')
        else:
            app.logger.warning(f"Invalid join code attempted: {join_code}")
            flash(f"Invalid join code: {join_code}", 'error')

    return render_template('welcome.html',
                           sites=sites,
                           club_memberships=club_memberships,
                           max_sites=max_sites,
                           language_icons=language_icons,
                           join_message=join_message)

@app.route('/support')
def support():
    return render_template('support.html')

if __name__ == '__main__':
    app.logger.info("Starting Hack Club Spaces application")

    # Clear and initialize logs
    try:
        logs_manager.clear_logs()
        logs_manager.add_log("Application started", level="INFO", source="system")
        app.logger.info("Logs system initialized")
    except Exception as e:
        app.logger.warning(f"Logs initialization error: {e}")

    # Initialize database
    try:
        initialize_database()
    except Exception as e:
        app.logger.warning(f"Database initialization error: {e}")

    # Start Hackatime service
    start_hackatime_service()

    # Register the cleanup function to stop Hackatime service on exit
    atexit.register(stop_hackatime_service)

    # Start the main Flask application
    port = int(os.environ.get('PORT', 3000))
    app.logger.info(f"Server running on http://0.0.0.0:{port}")
    app.run(host='0.0.0.0', port=port, debug=True)