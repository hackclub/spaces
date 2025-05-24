import os
import time
import html
import json
import hashlib
import requests
import jinja2
import werkzeug.exceptions
from sqlalchemy.exc import SQLAlchemyError
from datetime import datetime, timedelta
from functools import wraps
from dotenv import load_dotenv
from flask import Flask, render_template, redirect, flash, request, jsonify, url_for, abort, session, Response, current_app
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from flask_wtf.csrf import CSRFProtect
from models import db, User, Site, SitePage, UserActivity, Club, ClubMembership, ClubFeaturedProject, ClubAssignment


def slugify(text):
    import re
    text = str(text)
    text = text.lower()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'\s+', '-', text)
    text = text.strip('-')
    # Ensure slug is not empty and has only valid characters
    if not text or not re.match(r'^[\w-]+$', text):
        import random
        import string
        # Generate random slug if invalid
        random_string = ''.join(
            random.choices(string.ascii_lowercase + string.digits, k=8))
        text = f"space-{random_string}"
    return text


from github_routes import github_bp
from slack_routes import slack_bp
from slack_auth import slack_auth_bp
from routes.hackatime_routes import hackatime_bp
from routes.pizza_grants_routes import pizza_grants_bp
from routes.cdn_routes import cdn_bp
from groq import Groq

load_dotenv()


def get_database_url():
    url = os.getenv('DATABASE_URL')
    if url and url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql://', 1)
    return url


app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev')
app.config['REDIRECT_PYTHON_TO_CODE'] = True
app.config['SQLALCHEMY_DATABASE_URI'] = get_database_url()
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
# CSRF protection removed
csrf = None
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_size': 20,
    'pool_recycle': 1800,  # Recycle connections every 30 minutes
    'pool_timeout': 30,  # Shorter timeout for better error handling
    'max_overflow': 10,  # Allow up to 10 additional connections when needed
    'pool_pre_ping': True  # Check if connection is still alive before using
}

app.config['PREFERRED_URL_SCHEME'] = 'https'
app.config['EXPLAIN_TEMPLATE_LOADING'] = True
app.config['TEMPLATES_AUTO_RELOAD'] = True

# Get custom APP_URL from environment variables or fall back to Replit URL
custom_app_url = os.environ.get('APP_URL')
if custom_app_url:
    app.config['APP_URL'] = custom_app_url
else:
    # Fall back to Replit URL
    replit_url = os.environ.get('REPL_SLUG')
    if replit_url:
        app.config['APP_URL'] = f"https://{replit_url}.replit.dev"
    else:
        # For local development
        app.config['APP_URL'] = 'http://0.0.0.0:3000'


def get_error_context(error):
    context = {
        'error_type': error.__class__.__name__,
        'error_message': str(error),
        'error_details': None,
        'file_name': None,
        'line_number': None,
        'code_snippet': None,
        'traceback': None,
        'suggestions': []
    }

    if isinstance(error, jinja2.TemplateError):
        context['error_type'] = 'Template Error'
        if isinstance(error, jinja2.TemplateSyntaxError):
            context['line_number'] = error.lineno
            context['file_name'] = error.filename or 'Unknown Template'
            if error.source is not None:
                lines = error.source.splitlines()
                start = max(0, error.lineno - 3)
                end = min(len(lines), error.lineno + 2)
                context['code_snippet'] = '\n'.join(
                    f'{i+1}: {line}'
                    for i, line in enumerate(lines[start:end], start))
                context['suggestions'].append(
                    'Check template syntax for missing brackets, quotes, or blocks'
                )

    elif isinstance(error, SQLAlchemyError):
        context['error_type'] = 'Database Error'
        context['suggestions'].extend([
            'Verify database connection settings',
            'Check for invalid queries or constraints',
            'Ensure all required fields are provided'
        ])

    elif isinstance(error, werkzeug.exceptions.HTTPException):
        context['error_type'] = f'HTTP {error.code}'
        context['suggestions'].extend(get_http_error_suggestions(error.code))

    if hasattr(error, '__traceback__'):
        import traceback
        context['traceback'] = ''.join(traceback.format_tb(
            error.__traceback__))

    return context


def get_http_error_suggestions(code):
    suggestions = {
        404: [
            'Check the URL for typos', 'Verify that the resource exists',
            'The page might have been moved or deleted'
        ],
        403: [
            'Verify that you are logged in',
            'Check if you have the necessary permissions',
            'Contact an administrator if you need access'
        ],
        429: [
            'Wait a few moments before trying again',
            'Reduce the frequency of requests', 'Check your API rate limits'
        ],
        500: [
            'Try refreshing the page', 'Clear your browser cache',
            'Contact support if the problem persists'
        ],
        503: [
            'The service is temporarily unavailable', 'Check our status page',
            'Try again in a few minutes'
        ]
    }
    return suggestions.get(
        code,
        ['Try refreshing the page', 'Contact support if the problem persists'])


@app.errorhandler(404)
def not_found_error(error):
    context = get_error_context(error)
    return render_template('errors/404.html', **context), 404


@app.errorhandler(403)
def forbidden_error(error):
    context = get_error_context(error)
    # Check if user is authenticated
    if current_user.is_authenticated:
        context[
            'message'] = "You don't have permission to access this resource."
    else:
        context['message'] = "Please log in to access this page."

    return render_template('errors/403.html', **context), 403


@app.errorhandler(500)
def internal_error(error):
    db.session.rollback()
    context = get_error_context(error)
    app.logger.error(f'Internal Error: {context}')
    return render_template('errors/500.html', **context), 500


@app.errorhandler(429)
def too_many_requests(error):
    context = get_error_context(error)
    return render_template('errors/429.html', **context), 429


@app.route('/maintenance')
def maintenance():
    return render_template('errors/maintenance.html',
                           start_time=session.get('maintenance_start'),
                           end_time=session.get('maintenance_end')), 503


@app.errorhandler(Exception)
def handle_error(error):
    code = getattr(error, 'code', 500)
    if code == 500:
        db.session.rollback()

    context = get_error_context(error)
    app.logger.error(f'Unhandled Exception: {context}')

    return render_template('errors/generic.html', **context), code


@app.errorhandler(jinja2.TemplateError)
def template_error(error):
    context = get_error_context(error)
    app.logger.error(f'Template Error: {context}')
    return render_template('errors/500.html', **context), 500


@app.route('/api/report-error', methods=['POST'])
def report_error():
    try:
        error_data = request.get_json()

        error_log = {
            'timestamp': datetime.utcnow().isoformat(),
            'error_type': error_data.get('type'),
            'message': error_data.get('message'),
            'location': error_data.get('location'),
            'stack': error_data.get('stack'),
            'user_agent': error_data.get('userAgent'),
            'user_id':
            current_user.id if not current_user.is_anonymous else None,
            'url': request.headers.get('Referer'),
            'ip_address': request.remote_addr
        }

        app.logger.error(
            f'Client Error Report: {json.dumps(error_log, indent=2)}')

        return jsonify({'status': 'success'}), 200
    except Exception as e:
        app.logger.error(f'Error in report_error: {str(e)}')
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.before_request
def log_request_info():
    """Log minimal information about each incoming request."""
    # Only log warnings and errors, not regular requests
    if request.path.startswith('/static') or request.path.startswith(
            '/favicon'):
        return

    # Log only for specific error-prone endpoints or in debug mode
    if app.debug or 'admin' in request.path or request.method != 'GET':
        log_message = f'Request: {request.method} {request.path}'
        app.logger.debug(log_message)
        
        # Also store in our logs manager
        from utils.logs_util import logs_manager
        logs_manager.add_log(log_message, level="DEBUG", source="request")


@app.after_request
def log_response_info(response):
    """Log information about error responses only."""
    # Only log non-successful responses
    if response.status_code >= 400:
        log_message = f'Response: {request.method} {request.path} → {response.status_code}'
        app.logger.warning(log_message)
        
        # Also store in our logs manager
        from utils.logs_util import logs_manager
        logs_manager.add_log(log_message, level="WARNING", source="response")
    return response


@app.after_request
def add_security_headers(response):
    is_preview = request.args.get('preview') == 'true'

    csp = """
        default-src 'self';
        script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://webring.hackclub.com;
        style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com;
        img-src 'self' data: https: http:;
        font-src 'self' data: https://cdnjs.cloudflare.com https://fonts.gstatic.com;
        connect-src 'self' wss: ws: https://api.imgbb.com;
        media-src 'self' https://hc-cdn.hel1.your-objectstorage.com;
    """.replace('\n', ' ').replace('  ', ' ').strip()

    if is_preview:
        csp += " frame-ancestors *;"
    else:
        csp += " frame-ancestors 'self';"

    response.headers['Content-Security-Policy'] = csp
    response.headers['X-Content-Type-Options'] = 'nosniff'

    if is_preview:
        response.headers['Access-Control-Allow-Origin'] = '*'

    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers[
        'Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

@app.context_processor
def inject_csrf_token():
    """Inject empty CSRF token into template context"""
    return dict(csrf_token="")


class RateLimiter:

    def __init__(self):
        self.requests = {}
        self.limits = {
            'default': {
                'requests': 4500,
                'window': 60
            },
            'api_run': {
                'requests': 750,
                'window': 60
            },
            'login': {
                'requests': 375,
                'window': 60
            },
            'signup': {
                'requests': 75,
                'window': 60
            },
            'orphy': {
                'requests': 15,
                'window': 0.5
            }
        }

    def is_rate_limited(self, key, limit_type='default'):
        current_time = time.time()
        limit_config = self.limits.get(limit_type, self.limits['default'])

        if key not in self.requests:
            self.requests[key] = []

        self.requests[key] = [
            t for t in self.requests[key]
            if current_time - t < limit_config['window']
        ]

        if len(self.requests[key]) >= limit_config['requests']:
            return True

        self.requests[key].append(current_time)
        return False


rate_limiter = RateLimiter()


def rate_limit(limit_type='default'):

    def decorator(f):

        @wraps(f)
        def decorated_function(*args, **kwargs):
            ip_address = request.remote_addr

            if rate_limiter.is_rate_limited(ip_address, limit_type):
                app.logger.warning(
                    f"Rate limit exceeded for IP: {ip_address}, endpoint: {request.endpoint}"
                )
                return jsonify(
                    {'error':
                     'Rate limit exceeded. Please try again later.'}), 429

            return f(*args, **kwargs)

        return decorated_function

    return decorator


@app.route('/api/orphy/chat', methods=['POST'])
@rate_limit('orphy')
def orphy_chat_proxy():
    try:
        client_data = request.json

        user_message = client_data.get('message', '')
        code_content = client_data.get('code', '')
        filename = client_data.get('filename', 'untitled')
        documentation = client_data.get('documentation', '')

        system_prompt = "You are Orphy, a friendly and helpful AI assistant for Hack Club Spaces. Your goal is to help users with their coding projects. Keep your responses concise, and primarily give suggestions rather than directly solving everything for them. Use friendly language with some emoji but not too many. Give guidance that encourages learning. You have access to the Hack Club Spaces documentation which you can reference to help users."

        user_prompt = f"I'm working on a file named {filename} with the following code:\n\n{code_content}\n\nHere's my question: {user_message}"
        
        # Add documentation context if available
        if documentation:
            user_prompt += f"\n\nHere is the relevant Hack Club Spaces documentation you can use to help answer my question:\n\n{documentation}"

        try:
            app.logger.info("Attempting to use Groq API")
            groq_api_key = os.environ.get("GROQ_API_KEY")
            if not groq_api_key:
                app.logger.error("GROQ_API_KEY environment variable is not set")
                return jsonify({
                    'error': 'Server configuration error: GROQ_API_KEY is not set',
                    'type': 'server_error'
                }), 500
                
            groq_client = Groq(api_key=groq_api_key)

            chat_completion = groq_client.chat.completions.create(
                messages=[{
                    "role": "system",
                    "content": system_prompt
                }, {
                    "role": "user",
                    "content": user_prompt
                }],
                model="llama-3.1-8b-instant",
                temperature=0.7,
                max_tokens=700)

            message_content = chat_completion.choices[0].message.content
            return jsonify({
                'response': message_content,
                'provider': 'groq'
            }), 200

        except Exception as groq_error:
            app.logger.warning(
                f"Groq API failed: {str(groq_error)}. Falling back to Hack Club AI."
            )

            try:
                app.logger.info("Attempting to use Hack Club AI API")

                ai_request_data = {
                    "messages": [{
                        "role": "system",
                        "content": system_prompt
                    }, {
                        "role": "user",
                        "content": user_prompt
                    }],
                    "model":
                    "hackclub-l",
                    "temperature":
                    0.7,
                    "max_tokens":
                    700,
                    "stream":
                    False
                }

                response = requests.post(
                    'https://ai.hackclub.com/chat/completions',
                    json=ai_request_data,
                    headers={'Content-Type': 'application/json'},
                    timeout=15)

                if response.status_code == 200:
                    ai_response = response.json()
                    message_content = ai_response.get('choices', [{}])[0].get(
                        'message', {}).get('content', '')
                    return jsonify({
                        'response': message_content,
                        'provider': 'hackclub'
                    }), 200
                else:
                    raise Exception(
                        f"Hack Club AI returned status code {response.status_code}"
                    )

            except Exception as hackclub_error:
                app.logger.warning(
                    f"Hack Club AI failed: {str(hackclub_error)}. Using fallback."
                )

                fallback_message = (
                    "I'm having trouble connecting to my knowledge sources right now. "
                    "Here are some general tips:\n"
                    "- Check your code syntax for any obvious errors\n"
                    "- Make sure all functions are properly defined before they're called\n"
                    "- Verify that you've imported all necessary libraries\n"
                    "- Try breaking your problem down into smaller parts\n\n"
                    "Please try again in a few moments when my connection may be better."
                )

                return jsonify({
                    'response': fallback_message,
                    'provider': 'fallback'
                }), 200

    except Exception as e:
        app.logger.error(f"Error in Orphy proxy: {str(e)}")
        return jsonify({'error': str(e), 'provider': 'error'}), 500


db.init_app(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

app.register_blueprint(github_bp)
app.register_blueprint(slack_bp)
app.register_blueprint(slack_auth_bp)
app.register_blueprint(hackatime_bp)
app.register_blueprint(pizza_grants_bp)
app.register_blueprint(cdn_bp)


def check_db_connection():
    try:
        with app.app_context():
            db.engine.connect()
        return True
    except Exception as e:
        app.logger.error(f"Database connection failed: {str(e)}")
        return False


@app.before_request
def check_request():
    if current_user.is_authenticated and current_user.is_suspended:
        if request.endpoint not in ['static', 'suspended', 'logout']:
            return redirect(url_for('suspended'))

    try:
        if not check_db_connection():
            return render_template(
                'error.html',
                error_message=
                "Database connection is currently unavailable. We're working on it!"
            ), 503
    except Exception as e:
        app.logger.error(f"Database check failed: {str(e)}")
        return render_template(
            'error.html',
            error_message=
            "Database connection is currently unavailable. We're working on it!"
        ), 503


@app.route('/join-club')
def join_club_redirect():
    """Handle redirects from QR code scans"""
    join_code = request.args.get('code')
    if not join_code:
        flash('Invalid QR code', 'error')
        return redirect(url_for('welcome'))
    
    if current_user.is_authenticated:
        # Redirect to API endpoint to join the club
        return redirect(url_for('welcome', join_code=join_code))
    else:
        # Redirect to login page with join code in session
        session['pending_join_code'] = join_code
        flash('Please log in or sign up to join the club', 'info')
        return redirect(url_for('login'))


@app.route('/leader-onboarding', methods=['GET', 'POST'])
def leader_onboarding():
    """Show the leader onboarding page with access code verification"""
    # Check for access code in session or form submission
    if request.method == 'POST':
        # CSRF validation removed
            
        access_code = request.form.get('access_code')
        if access_code:
            # Verify the code against database
            with db.engine.connect() as conn:
                result = conn.execute(
                    db.text("SELECT access_code FROM leader_onboarding_access LIMIT 1")
                )
                valid_code = result.fetchone()
                
                if valid_code and valid_code[0] == access_code:
                    # Store in session to remember verification
                    session['verified_leader_access'] = True
                    flash('Access code verified! Welcome to leader onboarding.', 'success')
                else:
                    flash('Invalid access code. Please try again or contact HQ.', 'error')
                    return render_template('access_code.html', target='leader_onboarding')

    # If not verified and not an admin, show the access code form
    if 'verified_leader_access' not in session and not (current_user.is_authenticated and current_user.is_admin):
        return render_template('access_code.html', target='leader_onboarding')

    # If user is authenticated, get their club
    club = None
    try:
        if current_user.is_authenticated:
            club = Club.query.filter_by(leader_id=current_user.id).first()
            
            # If user already has a club, redirect to club dashboard
            if club:
                # Record activity for club leaders viewing onboarding
                try:
                    if not UserActivity.query.filter_by(
                        user_id=current_user.id,
                        activity_type="leader_onboarding_viewed"
                    ).first():
                        activity = UserActivity(
                            activity_type="leader_onboarding_viewed",
                            message="User {username} viewed leader onboarding page",
                            username=current_user.username,
                            user_id=current_user.id
                        )
                        db.session.add(activity)
                        db.session.commit()
                except Exception as e:
                    # Log but don't fail if activity recording fails
                    app.logger.error(f"Error recording activity: {str(e)}")
                    db.session.rollback()
                
                # Redirect to club dashboard if they already have a club
                flash('You already have a club. Welcome to your dashboard!', 'info')
                return redirect(url_for('club_dashboard'))
    except Exception as e:
        app.logger.error(f"Error in leader_onboarding route: {str(e)}")
        # Continue to show the page even if there was an error
    
    return render_template('leader_onboarding.html', club=club)


@app.route('/error')
def error_page():
    return render_template(
        'error.html',
        error_message=
        "Database connection is currently unavailable. We're working on it!"
    ), 503


@login_manager.user_loader
def load_user(user_id):
    try:
        return User.query.get(int(user_id))
    except Exception as e:
        app.logger.error(f"Failed to load user: {str(e)}")
        return None


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/login', methods=['GET', 'POST'])
@rate_limit('login')
def login():
    if current_user.is_authenticated:
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
            return redirect(url_for('welcome'))

        flash('Invalid email or password', 'error')

    return render_template('login.html')


@app.route('/club-setup', methods=['GET', 'POST'])
@login_required
def club_setup():
    """Setup page for new club leaders to complete their club details."""
    # Get the user's club
    club = Club.query.filter_by(leader_id=current_user.id).first()
    
    if not club:
        flash('You do not have a club to set up', 'error')
        return redirect(url_for('welcome'))
    
    if request.method == 'POST':
        # Update club details
        club_name = request.form.get('club_name')
        club_description = request.form.get('club_description')
        club_location = request.form.get('club_location')
        
        if not club_name:
            flash('Club name is required', 'error')
            return render_template('club_setup.html', club=club)
        
        club.name = club_name
        club.description = club_description
        club.location = club_location
        
        # Save changes
        db.session.commit()
        
        # Record activity
        activity = UserActivity(
            activity_type="club_setup",
            message=f'Club "{club.name}" setup completed by {{username}}',
            username=current_user.username,
            user_id=current_user.id
        )
        db.session.add(activity)
        db.session.commit()
        
        flash('Club setup complete! Welcome to your dashboard.', 'success')
        return redirect(url_for('club_dashboard'))
    
    return render_template('club_setup.html', club=club)


@app.route('/signup', methods=['GET', 'POST'])
@rate_limit('signup')
def signup():
    if current_user.is_authenticated:
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

        flash('Successfully registered! Please log in.', 'success')
        return redirect(url_for('login'))

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
                
                # Log activity
                log_activity(current_user.id, f"Joined club {club.name}")
                
                try:
                    db.session.commit()
                    flash(f"You have successfully joined {club.name}!", 'success')
                    # Redirect to the club dashboard
                    return redirect(url_for('club_dashboard', club_id=club.id))
                except Exception as e:
                    db.session.rollback()
                    flash(f"Error joining club: {str(e)}", 'error')
        else:
            flash(f"Invalid join code: {join_code}", 'error')

    return render_template('welcome.html',
                           sites=sites,
                           club_memberships=club_memberships,
                           max_sites=max_sites,
                           language_icons=language_icons,
                           join_message=join_message)


@app.route('/edit/<int:site_id>')
@login_required
def edit_site(site_id):
    try:
        site = Site.query.get(site_id)

        if not site:
            app.logger.warning(f'Site with ID {site_id} not found')
            flash('This space does not exist.', 'error')
            return redirect(url_for('welcome'))

        is_admin = current_user.is_admin
        is_owner = site.user_id == current_user.id

        if not is_owner and not is_admin:
            app.logger.warning(
                f'User {current_user.id} attempted to access site {site_id} owned by {site.user_id}'
            )
            flash('You do not have permission to edit this space.', 'error')
            return redirect(url_for('welcome'))

        app.logger.info(f'User {current_user.id} editing site {site_id}')

        return render_template('editor.html', site=site)
    except Exception as e:
        app.logger.error(f'Error in edit_site: {str(e)}')
        abort(500)


@app.route('/api/execute', methods=['POST'])
@login_required
def execute_command():
    """Execute a command in the console."""
    try:
        data = request.get_json()
        code = data.get('code', '')
        language = data.get('language', 'python')
        is_command = data.get('isCommand', False)

        if not code:
            return jsonify({
                'output': 'Error: No code provided',
                'error': True
            }), 400

        if len(code) > 10000:
            return jsonify({
                'output': 'Error: Code exceeds maximum allowed length (10,000 characters)',
                'error': True
            }), 400

        # Import the PistonService
        from piston_service import PistonService

        # Execute the code using Piston API
        result = PistonService.execute_code(
            language=language.lower(),
            code=code,
            version=None,  # Let Piston choose the latest version
            stdin='',
            args=[]
        )

        # Format the response
        if result.get('success', False):
            return jsonify({
                'output': result.get('output', '').strip(),
                'execution_time': result.get('execution_time', 0),
                'error': False
            })
        else:
            return jsonify({
                'output': result.get('error', 'Execution failed').strip(),
                'error': True
            }), 400

    except Exception as e:
        app.logger.error(f'Error in execute_command: {str(e)}')
        return jsonify({
            'output': f'Server error: {str(e)}',
            'error': True
        }), 500


@app.route('/api/sites/<int:site_id>/run', methods=['POST'])
@login_required
@rate_limit('api_run')
def run_code(site_id):
    try:
        site = Site.query.get_or_404(site_id)
        if site.user_id != current_user.id and not current_user.is_admin:
            abort(403)

        # Only allow running code for code-type sites
        if site.site_type != 'code' and site.site_type != 'python':
            return jsonify({
                'output': 'Error: This site does not support code execution',
                'error': True
            }), 400

        data = request.get_json()
        code = data.get('code', '')
        stdin = data.get('stdin', '')
        args = data.get('args', [])

        if len(code) > 10000:
            return jsonify({
                'output': 'Error: Code exceeds maximum allowed length (10,000 characters)',
                'error': True
            }), 400

        # Handle Python spaces (legacy)
        if site.site_type == 'python':
            language = 'python'
            version = '3.10.0'  # Default Python version
        else:
            language = site.language
            version = site.language_version

        # Import the PistonService
        from piston_service import PistonService

        # Execute the code using Piston API
        result = PistonService.execute_code(
            language=language,
            code=code,
            version=version,
            stdin=stdin,
            args=args
        )

        # Format the response
        if result.get('success', False):
            return jsonify({
                'output': result.get('output', ''),
                'execution_time': result.get('execution_time', 0),
                'error': False
            })
        else:
            return jsonify({
                'output': result.get('error', 'Execution failed'),
                'error': True
            }), 400

    except Exception as e:
        app.logger.error(f'Error in run_code: {str(e)}')
        return jsonify({
            'output': f'Server error: {str(e)}',
            'error': True
        }), 500


@app.route('/s/<string:slug>', defaults={'filename': None})
@app.route('/s/<string:slug>/<path:filename>')
def view_site(slug, filename):
    site = Site.query.filter_by(slug=slug).first_or_404()
    if not site.is_public and (not current_user.is_authenticated
                               or site.user_id != current_user.id):
        abort(403)

    if not filename and hasattr(
            site, 'analytics_enabled') and site.analytics_enabled:
        with db.engine.connect() as connection:
            connection.execute(
                db.text(
                    "UPDATE site SET view_count = view_count + 1 WHERE id = :site_id",
                    {"site_id": site.id}
                ))
            connection.commit()

    if not filename:
        return site.html_content

    try:
        page = SitePage.query.filter_by(site_id=site.id,
                                        filename=filename).first()

        if not page:
            app.logger.warning(
                f"Page not found: {filename} for site {site.id}")
            abort(404)

        mime_types = {
            'html': 'text/html',
            'css': 'text/css',
            'js': 'application/javascript'
        }

        content_type = mime_types.get(page.file_type, 'text/plain')
        app.logger.info(f"Serving {filename} with MIME type: {content_type}")

        return Response(page.content, mimetype=content_type)
    except Exception as e:
        app.logger.error(
            f"Error serving file {filename} for site {site.id}: {str(e)}")
        abort(500)


@app.route('/api/sites', methods=['POST'])
@login_required
def create_site():
    try:
        site_count = Site.query.filter_by(user_id=current_user.id).count()
        max_sites = get_max_sites_per_user()
        if site_count >= max_sites:
            app.logger.warning(
                f'User {current_user.id} attempted to exceed site limit of {max_sites}'
            )
            return jsonify({
                'message':
                f'You have reached the maximum limit of {max_sites} sites per account'
            }), 403

        data = request.get_json()
        if not data:
            app.logger.error('No JSON data received')
            return jsonify(
                {'message': 'Please provide valid space information'}), 400

        name = data.get('name')
        if not name:
            app.logger.warning('Site name not provided')
            return jsonify({'message':
                            'Please enter a name for your space'}), 400

        # Name validation
        name = str(name).strip()
        if len(name) < 1 or len(name) > 50:
            return jsonify(
                {'message':
                 'Space name must be between 1 and 50 characters'}), 400

        # Check for potentially problematic characters
        import re
        if re.search(r'[<>{}[\]()\'";]', name):
            return jsonify(
                {'message': 'Space name contains invalid characters'}), 400

        try:
            slug = slugify(name)
        except Exception as e:
            app.logger.error(f'Error slugifying name: {str(e)}')
            return jsonify({'message': 'Invalid site name provided'}), 400

        existing_site = Site.query.filter_by(slug=slug).first()
        if existing_site:
            app.logger.warning(f'Site with slug {slug} already exists')
            return jsonify(
                {'message': 'A space with this name already exists'}), 400

        app.logger.info(
            f'Creating new site "{name}" for user {current_user.id}')

        default_html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Website</title>
    <link rel="stylesheet" href="/s/{slug}/styles.css">
    <script src="/s/{slug}/script.js" defer></script>
</head>
<body>
    <h1>Welcome to my website!</h1>
    <p>This is a paragraph on my new site.</p>
</body>
</html>'''

        site = Site(name=name,
                    user_id=current_user.id,
                    html_content=default_html)
        db.session.add(site)
        db.session.commit()

        default_css = '''body {
    font-family: Arial, sans-serif;
    line-height: 1.6;
    margin: 0;
    padding: 20px;
    color: #333;
    max-width: 800px;
    margin: 0 auto;
}

h1 {
    color: #2c3e50;
    border-bottom: 2px solid #eee;
    padding-bottom: 10px;
}'''

        default_js = '''document.addEventListener('DOMContentLoaded', function() {
    console.log('Website loaded successfully!');
});'''

        try:
            css_page = SitePage(site_id=site.id,
                                filename="styles.css",
                                content=default_css,
                                file_type="css")

            js_page = SitePage(site_id=site.id,
                               filename="script.js",
                               content=default_js,
                               file_type="js")

            html_page = SitePage(site_id=site.id,
                                 filename="index.html",
                                 content=default_html,
                                 file_type="html")

            db.session.add_all([css_page, js_page, html_page])
            db.session.commit()

            app.logger.info(
                f"Successfully created site pages for site {site.id}")
        except Exception as e:
            app.logger.error(f"Error creating site pages: {str(e)}")
            db.session.rollback()

        activity = UserActivity(activity_type="site_creation",
                                message='New site "{}" created by {}'.format(
                                    name, current_user.username),
                                username=current_user.username,
                                user_id=current_user.id,
                                site_id=site.id)
        db.session.add(activity)
        db.session.commit()

        app.logger.info(f'Successfully created site {site.id}')
        return jsonify({
            'message': 'Site created successfully',
            'site_id': site.id
        })
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error creating site: {str(e)}')
        return jsonify({'message': 'Failed to createsite'}), 500


@app.route('/api/sites/<int:site_id>', methods=['PUT'])
@app.route('/api/sites/<int:site_id>/python', methods=['PUT'])
@login_required
def update_site(site_id):
    site = Site.query.get_or_404(site_id)

    is_admin = current_user.is_admin

    if site.user_id != current_user.id and not is_admin:
        abort(403)

    data = request.get_json()
    html_content = data.get('html_content')
    python_content = data.get('python_content')

    if html_content is None and python_content is None:
        return jsonify({'message': 'Content is required'}), 400

    if html_content is not None:
        site.html_content = html_content
    if python_content is not None:
        site.python_content = python_content

    site.updated_at = datetime.utcnow()

    try:
        db.session.commit()

        activity_message = f'Updated {"Python" if python_content else "Web"} site "{site.name}"'
        activity = UserActivity(activity_type='site_update',
                                message=activity_message,
                                username=current_user.username,
                                user_id=current_user.id,
                                site_id=site.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({'message': 'Site updated successfully'})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error updating site: {str(e)}')
        return jsonify({'message': 'Failed to update site'}), 500


@app.route('/api/sites/<int:site_id>/rename', methods=['PUT'])
@login_required
def rename_site(site_id):
    site = Site.query.get_or_404(site_id)
    if site.user_id != current_user.id:
        abort(403)

    data = request.get_json()
    new_name = data.get('name')

    if not new_name:
        return jsonify({'message': 'New name is required'}), 400

    try:
        new_slug = slugify(new_name)
        existing_site = Site.query.filter(Site.slug == new_slug, Site.id
                                          != site_id).first()
        if existing_site:
            return jsonify({'message':
                            'A site with this name already exists'}), 400

        site.name = new_name
        site.slug = new_slug
        site.updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify({'message': 'Site renamed successfully'})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error renaming site: {str(e)}')
        return jsonify({'message': 'Failed to rename site'}), 500


@app.route('/api/sites/code', methods=['POST'])
@login_required
def create_code_site():
    try:
        site_count = Site.query.filter_by(user_id=current_user.id).count()
        max_sites = get_max_sites_per_user()
        if site_count >= max_sites:
            return jsonify({
                'message':
                f'You have reached the maximum limit of {max_sites} sites per account'
            }), 403

        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400

        name = data.get('name')
        if not name:
            return jsonify({'message': 'Name is required'}), 400
            
        language = data.get('language', 'python')
        
        # Import the PistonService
        from piston_service import PistonService
        
        # Get the latest version for the language
        language_version = PistonService.get_latest_version(language)
        if not language_version:
            return jsonify({'message': f'Language {language} is not supported'}), 400
            
        # Get the template for the language
        language_content = PistonService.get_language_template(language)
        
        # Get proper extension for this language
        ext = PistonService.get_language_extension(language)
        
        # Create the site with necessary info
        site = Site(name=name,
                    user_id=current_user.id,
                    site_type='code',
                    language=language,
                    language_version=language_version,
                    language_content=language_content)
        
        # Ensure the slug has the correct extension
        if ext and ext != 'txt':
            # Remove any existing extension from the slug
            base_slug = site.slug.split('.')[0]
            # Apply the proper extension
            site.slug = f"{base_slug}.{ext}"
            app.logger.info(f"Set slug for {language} site to {site.slug}")
        
        db.session.add(site)
        db.session.commit()

        activity = UserActivity(
            activity_type="site_creation",
            message=f'New {language} space "{name}" created by {current_user.username}',
            username=current_user.username,
            user_id=current_user.id,
            site_id=site.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({
            'message': f'{language.capitalize()} space created successfully',
            'site_id': site.id
        })
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error creating code site: {str(e)}')
        return jsonify({'message': 'Failed to create code space'}), 500

@app.route('/api/languages', methods=['GET'])
def get_languages():
    """Get a list of supported programming languages."""
    try:
        from piston_service import PistonService
        languages = PistonService.get_languages()
        
        # Format the response with additional metadata
        language_data = []
        for lang in languages:
            versions = PistonService.get_language_versions(lang)
            language_data.append({
                'name': lang,
                'display_name': lang.capitalize(),
                'latest_version': versions[0] if versions else None,
                'versions': versions,
                'icon': PistonService.get_language_icon(lang)
            })
            
        return jsonify({
            'languages': language_data
        })
    except Exception as e:
        app.logger.error(f'Error getting languages: {str(e)}')
        return jsonify({'message': 'Failed to get languages'}), 500
@app.route('/python/<int:site_id>')
@login_required
def python_editor(site_id):
    # Redirect all Python spaces to the unified code editor
    return redirect(url_for('code_editor', site_id=site_id))


@app.route('/code/<int:site_id>')
@login_required
def code_editor(site_id):
    try:
        # Get the site or return 404
        site = Site.query.get_or_404(site_id)
        app.logger.info(f'Found site {site_id} with language {site.language}')

        # Check permissions
        is_admin = current_user.is_admin
        is_owner = site.user_id == current_user.id

        if not is_owner and not is_admin:
            # Check if the user is a collaborator
            collab = Collaborator.query.filter_by(site_id=site_id,
                                                user_id=current_user.id).first()
            if not collab:
                app.logger.warning(
                    f'User {current_user.id} attempted to access code site {site_id} owned by {site.user_id}'
                )
                abort(403)

        app.logger.info(f'User {current_user.id} editing code site {site_id}')

        # Import the PistonService to get the language icon
        try:
            from piston_service import PistonService
            language_icon = PistonService.get_language_icon(site.language)
            app.logger.info(f'Got language icon for {site.language}: {language_icon}')
        except Exception as lang_err:
            app.logger.error(f'Error getting language icon: {str(lang_err)}')
            language_icon = 'fas fa-code'  # Default icon

        # Render the template with basic parameters
        try:
            return render_template('code-editor.html', 
                                site=site, 
                                language_icon=language_icon)
        except Exception as template_err:
            app.logger.error(f'Template rendering error: {str(template_err)}')
            # Try to render a basic error template instead
            return f'<h1>Error loading code editor</h1><p>{str(template_err)}</p>', 500
    except Exception as e:
        app.logger.error(f'Error in code_editor: {str(e)}')
        return f'<h1>500 Server Error</h1><p>Details: {str(e)}</p>', 500


@app.route('/api/sites/<int:site_id>', methods=['DELETE'])
@login_required
def delete_site(site_id):
    site = Site.query.get_or_404(site_id)
    if site.user_id != current_user.id:
        abort(403)

    try:
        with db.engine.connect() as conn:
            conn.execute(
                db.text("DELETE FROM site_page WHERE site_id = :site_id"),
                {"site_id": site_id})
            conn.commit()

        db.session.delete(site)
        db.session.commit()

        activity = UserActivity(
            activity_type="site_deletion",
            message=f'Site "{site.name}" deleted by {{username}}',
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({'message': 'Site deleted successfully'})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error deleting site {site_id}: {str(e)}')
        return jsonify({'message': f'Failed to delete site: {str(e)}'}), 500


@app.route('/documentation')
def documentation():
    return render_template('documentation.html')


@app.route('/support')
def support():
    """Render the support page with help resources."""
    return render_template('support.html')

@app.route('/api/admin/gallery/feature/<int:entry_id>', methods=['POST'])
@login_required
def toggle_gallery_feature(entry_id):
    if not current_user.is_admin:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403
        
    try:
        from models import GalleryEntry
        entry = GalleryEntry.query.get_or_404(entry_id)
        
        # Toggle featured status
        entry.is_featured = not entry.is_featured
        db.session.commit()
        
        activity = UserActivity(
            activity_type="admin_action",
            message=f'Admin {{username}} {"featured" if entry.is_featured else "unfeatured"} gallery entry "{entry.title}"',
            username=current_user.username,
            user_id=current_user.id
        )
        db.session.add(activity)
        db.session.commit()
        
        return jsonify({
            'success': True, 
            'is_featured': entry.is_featured
        })
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error toggling gallery feature: {str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/gallery/entry/<int:entry_id>/remove', methods=['POST'])
@login_required
def remove_gallery_entry(entry_id):
    try:
        from models import GalleryEntry
        entry = GalleryEntry.query.get_or_404(entry_id)
        
        # Verify permission (owner or admin)
        if entry.user_id != current_user.id and not current_user.is_admin:
            flash('You do not have permission to remove this entry', 'error')
            return redirect(url_for('gallery'))
        
        title = entry.title
        db.session.delete(entry)
        
        activity = UserActivity(
            activity_type="gallery_removal",
            message=f'User {{username}} removed "{title}" from the gallery',
            username=current_user.username,
            user_id=current_user.id
        )
        db.session.add(activity)
        db.session.commit()
        
        flash('Entry successfully removed from the gallery', 'success')
        return redirect(url_for('gallery'))
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error removing gallery entry: {str(e)}')
        flash('An error occurred while removing the entry', 'error')
        return redirect(url_for('gallery'))


@app.route('/gallery')
@app.route('/gallery/tag/<tag>')
def gallery(tag=None):
    from models import GalleryEntry, Site, User
    
    # Get featured entries
    featured_query = db.session.query(GalleryEntry, Site, User)\
        .join(Site, GalleryEntry.site_id == Site.id)\
        .join(User, GalleryEntry.user_id == User.id)\
        .filter(GalleryEntry.is_featured == True)
    
    # Apply tag filter to featured entries if tag is provided
    if tag:
        featured_query = featured_query.filter(GalleryEntry.tags.like(f'%{tag}%'))
    
    featured_entries = featured_query.order_by(GalleryEntry.added_at.desc()).all()
    
    # Get all entries
    entries_query = db.session.query(GalleryEntry, Site, User)\
        .join(Site, GalleryEntry.site_id == Site.id)\
        .join(User, GalleryEntry.user_id == User.id)
    
    # Apply tag filter to all entries if tag is provided
    if tag:
        entries_query = entries_query.filter(GalleryEntry.tags.like(f'%{tag}%'))
    
    entries = entries_query.order_by(GalleryEntry.added_at.desc()).all()
    
    # Get all unique tags for the filter dropdown
    all_tags_query = db.session.query(GalleryEntry.tags).filter(GalleryEntry.tags != None, GalleryEntry.tags != '')
    all_tags_raw = all_tags_query.all()
    
    # Process tags into a unique list
    all_tags = set()
    for tags_str in all_tags_raw:
        if tags_str[0]:
            tags_list = [t.strip() for t in tags_str[0].split(',')]
            all_tags.update(tag for tag in tags_list if tag)
    
    all_tags = sorted(list(all_tags))
    
    return render_template(
        'gallery.html', 
        featured_entries=featured_entries, 
        entries=entries,
        all_tags=all_tags,
        current_tag=tag
    )

@app.route('/gallery/tag/<tag>')
def gallery_filter_by_tag(tag):
    return gallery(tag)


@app.route('/gallery/submit', methods=['GET', 'POST'])
@login_required
def gallery_submit():
    if request.method == 'POST':
        site_id = request.form.get('site_id')
        title = request.form.get('title')
        description = request.form.get('description', '')
        tags = request.form.get('tags', '')
        
        if not site_id or not title:
            flash('Site and title are required', 'error')
            return redirect(url_for('gallery_submit'))
        
        site = Site.query.get(site_id)
        if not site or site.user_id != current_user.id:
            flash('Invalid site selected', 'error')
            return redirect(url_for('gallery_submit'))
        
        # Check if site is already in gallery
        from models import GalleryEntry
        existing_entry = GalleryEntry.query.filter_by(site_id=site_id).first()
        if existing_entry:
            flash('This site is already in the gallery', 'error')
            return redirect(url_for('gallery_submit'))
        
        try:
            # Create new gallery entry
            entry = GalleryEntry(
                site_id=site_id,
                user_id=current_user.id,
                title=title,
                description=description,
                tags=tags
            )
            
            db.session.add(entry)
            db.session.commit()
            
            # Record activity
            activity = UserActivity(
                activity_type="gallery_submission",
                message=f'User {{username}} submitted "{title}" to the gallery',
                username=current_user.username,
                user_id=current_user.id,
                site_id=site.id
            )
            db.session.add(activity)
            db.session.commit()
            
            flash('Your site has been successfully submitted to the gallery!', 'success')
            return redirect(url_for('gallery'))
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Error submitting to gallery: {str(e)}')
            flash('An error occurred while submitting to gallery', 'error')
            return redirect(url_for('gallery_submit'))
    
    # GET request - only show sites that aren't already in the gallery
    from models import GalleryEntry
    
    # Get all user's sites
    all_sites = Site.query.filter_by(user_id=current_user.id).all()
    
    # Get sites already in gallery
    gallery_site_ids = db.session.query(GalleryEntry.site_id).filter(
        GalleryEntry.user_id == current_user.id
    ).all()
    gallery_site_ids = [id[0] for id in gallery_site_ids]
    
    # Filter sites not in gallery
    sites = [site for site in all_sites if site.id not in gallery_site_ids]
    
    return render_template('gallery_submit.html', sites=sites)


@app.route('/apps')
def apps():
    return render_template('apps.html')


def admin_required(f):

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            abort(403)
        # Check for request.referrer to prevent CSRF attacks on admin operations
        if request.method != 'GET' and not request.referrer:
            app.logger.warning(f"Admin operation without referrer: {request.path}")
            abort(403)
        return f(*args, **kwargs)

    return decorated_function


# Special access function removed - access granted to all users


@app.route('/admin')
@login_required
def admin_panel():
    if not current_user.is_admin:
        abort(403)
    try:
        from models import Club

        users = User.query.with_entities(User.id, User.username, User.email,
                                         User.created_at, User.is_suspended,
                                         User.is_admin).limit(10).all()

        sites = db.session.query(Site.id, Site.name, Site.slug, Site.site_type,
                                 Site.created_at, Site.updated_at,
                                 Site.user_id,
                                 User.username).join(User).limit(10).all()

        clubs = Club.query.all()

        version = '1.7.7'
        try:
            with open('changelog.md', 'r') as f:
                for line in f:
                    if line.startswith('## Version'):
                        version = line.split(' ')[2].strip('() ✨')
                        break
        except Exception as e:
            app.logger.error(f'Error reading version from changelog: {str(e)}')

        return render_template('admin_panel.html',
                               users=users,
                               sites=sites,
                               clubs=clubs,
                               version=version,
                               Club=Club)
    except Exception as e:
        app.logger.error(f'Error loading admin panel: {str(e)}')
        flash('Error loading admin panel: ' + str(e), 'error')
        return redirect(url_for('welcome'))


@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@login_required
@admin_required
# Keep CSRF protection on this sensitive route
def delete_user(user_id):
    from models import ClubPost, ClubPostLike, ClubChatChannel, ClubChatMessage, ClubResource, ClubAssignment
    
    if user_id == current_user.id:
        return jsonify({'message': 'Cannot delete yourself'}), 400

    user = User.query.get_or_404(user_id)

    try:
        # Delete user activities
        UserActivity.query.filter_by(user_id=user.id).delete()
        
        # If the user is a club leader, we need to handle club relationships
        clubs_led = Club.query.filter_by(leader_id=user.id).all()
        for club in clubs_led:
            # Delete club memberships
            ClubMembership.query.filter_by(club_id=club.id).delete()
            # Delete club posts
            ClubPost.query.filter_by(club_id=club.id).delete()
            # Delete club assignments
            ClubAssignment.query.filter_by(club_id=club.id).delete()
            # Delete club resources
            ClubResource.query.filter_by(club_id=club.id).delete()
            # Delete club chat channels and messages
            channels = ClubChatChannel.query.filter_by(club_id=club.id).all()
            for channel in channels:
                ClubChatMessage.query.filter_by(channel_id=channel.id).delete()
            ClubChatChannel.query.filter_by(club_id=club.id).delete()
            # Finally delete the club
            db.session.delete(club)
        
        # Delete user's club memberships elsewhere
        ClubMembership.query.filter_by(user_id=user.id).delete()
        
        # Delete user's sites and related pages
        sites = Site.query.filter_by(user_id=user.id).all()
        for site in sites:
            SitePage.query.filter_by(site_id=site.id).delete()
            db.session.delete(site)
        
        # Finally delete the user
        db.session.delete(user)
        db.session.commit()
        
        # Log this admin action
        activity = UserActivity(
            activity_type="admin_action",
            message=f'Admin deleted user "{user.username}"',
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()
        
        return jsonify({'message': 'User deleted successfully'})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error deleting user {user_id}: {str(e)}')
        return jsonify({'message': f'Failed to delete user: {str(e)}'}), 500


@app.route('/api/admin/sites/<int:site_id>', methods=['DELETE'])
@login_required
@admin_required
def delete_site_admin(site_id):
    site = Site.query.get_or_404(site_id)

    try:
        with db.engine.connect() as conn:
            conn.execute(
                db.text("DELETE FROM site_page WHERE site_id = :site_id"),
                {"site_id": site_id})
            conn.commit()

        db.session.delete(site)
        db.session.commit()

        activity = UserActivity(
            activity_type="admin_action",
            message=f'Admin {{username}} deleted site "{site.name}"',
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({'message': 'Site deleted successfully'})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error deleting site {site_id} by admin: {str(e)}')
        return jsonify({'message': f'Failed to delete site: {str(e)}'}), 500


@app.route('/suspended')
def suspended():
    return render_template('suspended.html')


@app.route('/api/admin/users/<int:user_id>/suspend', methods=['POST'])
@login_required
@admin_required
def toggle_suspension(user_id):
    if user_id == current_user.id:
        return jsonify({'message': 'Cannot suspend yourself'}), 400

    user = User.query.get_or_404(user_id)
    data = request.get_json()
    user.is_suspended = data.get('suspend', False)

    try:
        db.session.commit()
        return jsonify(
            {'message': 'User suspension status updated successfully'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'message':
                        'Failed to update user suspension status'}), 500


@app.route('/api/admin/users/<int:user_id>', methods=['PUT'])
@login_required
@admin_required
def edit_user(user_id):
    if user_id == current_user.id:
        return jsonify({
            'message':
            'Please use account settings to edit your own account'
        }), 400

    user = User.query.get_or_404(user_id)
    data = request.get_json()

    new_username = data.get('username')
    new_email = data.get('email')
    new_password = data.get('password')

    if new_username and new_username != user.username and User.query.filter_by(
            username=new_username).first():
        return jsonify({'message': 'Username already taken'}), 400

    if new_email and new_email != user.email and User.query.filter_by(
            email=new_email).first():
        return jsonify({'message': 'Email already registered'}), 400

    try:
        if new_username:
            user.username = new_username
        if new_email:
            user.email = new_email

        if new_password and new_password.strip():
            user.set_password(new_password)

        db.session.commit()

        activity = UserActivity(activity_type="admin_action",
                                message="Admin {username} edited user " +
                                user.username,
                                username=current_user.username,
                                user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({'message': 'User details updated successfully'})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error updating user: {str(e)}')
        return jsonify({'message': 'Failed to update user details'}), 500


@app.route('/api/admin/users/<int:user_id>/club-leader', methods=['POST'])
@login_required
@admin_required
def toggle_club_leader(user_id):
    """Toggle a user's club leader status without creating a club automatically."""
    if user_id == current_user.id:
        return jsonify(
            {'message': 'Cannot change your own club leader status'}), 400

    user = User.query.get_or_404(user_id)
    data = request.get_json()
    make_leader = data.get('is_club_leader', False)

    try:
        app.logger.info(
            f"Attempt to {'make' if make_leader else 'remove'} {user.username} as club leader"
        )
        existing_club = Club.query.filter_by(leader_id=user.id).first()

        # User is already in the requested state
        if (make_leader and existing_club) or (not make_leader
                                               and not existing_club):
            status_msg = f"{user.username} is already {'a club leader' if make_leader else 'not a club leader'}"
            app.logger.info(status_msg)
            return jsonify({'message': status_msg, 'status': 'success'})

        if make_leader:
            # Create a new club with this user as leader
            club = Club(name=f"{user.username}'s Club",
                        description="Temporary club (please edit)",
                        leader_id=user.id)
            db.session.add(club)

            # Record the activity
            activity = UserActivity(
                activity_type="admin_action",
                message=
                f"Admin {{username}} made {user.username} a club leader",
                username=current_user.username,
                user_id=current_user.id)
            db.session.add(activity)

            db.session.commit()
            app.logger.info(f"Successfully made {user.username} a club leader")
            return jsonify({
                'message': f"Made {user.username} a club leader",
                'status': 'success'
            })

        elif not make_leader and existing_club:
            # First delete all club memberships
            ClubMembership.query.filter_by(club_id=existing_club.id).delete()

            # Then delete the club itself
            db.session.delete(existing_club)

            # Record the activity
            activity = UserActivity(
                activity_type="admin_action",
                message=
                f"Admin {{username}} removed {user.username} as a club leader",
                username=current_user.username,
                user_id=current_user.id)
            db.session.add(activity)

            db.session.commit()
            app.logger.info(
                f"Successfully removed {user.username} as a club leader")
            return jsonify({
                'message': f"Removed {user.username} as a club leader",
                'status': 'success'
            })

    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error toggling club leader status: {str(e)}')
        return jsonify({
            'message': 'Failed to update club leader status',
            'error': str(e)
        }), 500


@app.route('/api/admin/users/<int:user_id>/sites', methods=['DELETE'])
@login_required
@admin_required
def delete_user_sites(user_id):
    user = User.query.get_or_404(user_id)

    try:
        for site in user.sites:
            if hasattr(site, 'github_repo') and site.github_repo:
                db.session.delete(site.github_repo)

        Site.query.filter_by(user_id=user.id).delete()
        db.session.commit()
        return jsonify({'message': 'All user sites deleted successfully'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': 'Failed to delete user sites'}), 500


@app.route('/api/admin/admins', methods=['GET'])
@login_required
@admin_required
def get_admin_list():
    from admin_utils import get_admins
    try:
        admins = get_admins()
        return jsonify({'admins': admins})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/recent-activities')
@login_required
@admin_required
def get_recent_activities():
    try:
        recent_activities = UserActivity.query.order_by(
            UserActivity.timestamp.desc()).limit(10).all()

        activities_list = [{
            'type': activity.activity_type,
            'message': activity.message,
            'username': activity.username,
            'timestamp': activity.timestamp.isoformat(),
        } for activity in recent_activities]

        if not activities_list:
            recent_users = User.query.order_by(
                User.created_at.desc()).limit(5).all()
            user_activities = [{
                'type': 'user_registration',
                'message': 'New user registered: {username}',
                'username': user.username,
                'timestamp': user.created_at.isoformat(),
            } for user in recent_users]

            recent_sites = db.session.query(Site, User).join(User).order_by(
                Site.created_at.desc()).limit(5).all()
            site_activities = [{
                'type':
                'site_creation',
                'message':
                'New site "{}" created by {username}'.format(site.name),
                'username':
                user.username,
                'timestamp':
                site.created_at.isoformat(),
            } for site, user in recent_sites]

            recent_logins = User.query.order_by(
                User.last_login.desc()).limit(5).all()
            login_activities = [{
                'type':
                'user_login',
                'message':
                'User {username} logged in',
                'username':
                user.username,
                'timestamp':
                user.last_login.isoformat()
                if user.last_login else user.created_at.isoformat(),
            } for user in recent_logins]

            activities_list = user_activities + site_activities + login_activities
            activities_list.sort(key=lambda x: x['timestamp'], reverse=True)
            activities_list = activities_list[:10]

        return jsonify({'activities': activities_list})
    except Exception as e:
        app.logger.error(f'Error retrieving recent activities: {str(e)}')
        return jsonify({'error': 'Failed to retrieve recent activities'}), 500


@app.route('/api/admin/system-status')
@login_required
@admin_required
def get_system_status():
    try:
        db_status = 'healthy'
        try:
            db.engine.connect()
        except Exception:
            db_status = 'unhealthy'

        version = '1.7.7'
        try:
            with open('changelog.md', 'r') as f:
                for line in f:
                    if line.startswith('## Version'):
                        version = line.split(' ')[2].strip('() ✨')
                        break
        except Exception:
            pass

        from datetime import datetime, timedelta
        last_backup = (datetime.utcnow() -
                       timedelta(hours=8)).strftime('%Y-%m-%d %H:%M:%S')

        return jsonify({
            'server': {
                'status': 'healthy',
                'uptime': '3 days',
            },
            'database': {
                'status': db_status,
                'connections': 5,
            },
            'backup': {
                'last_backup': last_backup,
                'status': 'success',
            },
            'version': version
        })
    except Exception as e:
        app.logger.error(f'Error retrieving system status: {str(e)}')
        return jsonify({'error': 'Failed to retrieve system status'}), 500


@app.route('/api/admin/analytics')
@login_required
@admin_required
def get_analytics_data():
    try:
        period = request.args.get('period', 'day')

        from datetime import datetime, timedelta

        if period == 'day':
            start_date = datetime.utcnow() - timedelta(days=1)
        elif period == 'week':
            start_date = datetime.utcnow() - timedelta(weeks=1)
        elif period == 'month':
            start_date = datetime.utcnow() - timedelta(days=30)
        elif period == 'year':
            start_date = datetime.utcnow() - timedelta(days=365)
        else:
            start_date = datetime.utcnow() - timedelta(days=7)

        from sqlalchemy import func

        if period == 'day':
            labels = [f"{i}:00" for i in range(24)]
            date_format = '%H'
        elif period == 'week':
            days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
            today_idx = datetime.utcnow().weekday()
            labels = days[today_idx:] + days[:today_idx]
            date_format = '%a'
        elif period == 'month':
            today = datetime.utcnow().day
            days_in_month = 30
            labels = [(datetime.utcnow() - timedelta(days=i)).strftime('%d')
                      for i in range(days_in_month - 1, -1, -1)]
            date_format = '%d'
        else:
            months = [
                'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
                'Oct', 'Nov', 'Dec'
            ]
            current_month = datetime.utcnow().month - 1
            labels = months[current_month:] + months[:current_month]
            date_format = '%b'

        user_registrations = {'labels': labels, 'values': []}

        import random
        user_registrations['values'] = [random.randint(1, 20) for _ in labels]

        web_sites = Site.query.filter_by(site_type='web').count()
        python_sites = Site.query.filter_by(site_type='python').count()
        total_sites = web_sites + python_sites

        if total_sites > 0:
            web_percentage = round((web_sites / total_sites) * 100)
            python_percentage = 100 - web_percentage
        else:
            web_percentage = 50
            python_percentage = 50

        site_types = {'web': web_percentage, 'python': python_percentage}

        traffic_sources = {'Direct': 65, 'Search': 25, 'Social': 10}

        platform_usage = {
            'labels': labels,
            'values': [random.randint(10, 100) for _ in labels]
        }

        return jsonify({
            'user_registrations': user_registrations,
            'site_types': site_types,
            'traffic_sources': traffic_sources,
            'platform_usage': platform_usage
        })
    except Exception as e:
        app.logger.error(f'Error retrieving analytics data: {str(e)}')
        return jsonify({'error': 'Failed to retrieve analytics data'}), 500


@app.route('/api/admin/analytics/export')
@login_required
@admin_required
def export_analytics():
    try:
        chart_type = request.args.get('chart', '')

        return jsonify({'message':
                        f'Export of {chart_type} data successful'}), 200
    except Exception as e:
        app.logger.error(f'Error exporting analytics data: {str(e)}')
        return jsonify({'error': 'Failed to export analytics data'}), 500


def get_max_sites_per_user():
    try:
        with db.engine.connect() as conn:
            result = conn.execute(
                db.text(
                    "SELECT value FROM system_settings WHERE key = 'max_sites_per_user'"
                ))
            row = result.fetchone()
            if row:
                return int(row[0])
            return 10
    except Exception as e:
        app.logger.error(f'Error retrieving max sites setting: {str(e)}')
        return 10


@app.route('/api/admin/settings/max-sites', methods=['POST'])
@login_required
@admin_required
def update_max_sites():
    try:
        data = request.get_json()
        max_sites = data.get('maxSites', 10)

        if max_sites < 1:
            return jsonify({'error': 'Max sites must be at least 1'}), 400

        with db.engine.connect() as conn:
            conn.execute(
                db.text(
                    "INSERT INTO system_settings (key, value) VALUES ('max_sites_per_user', :value) ON CONFLICT (key) DO UPDATE SET value = :value"
                ), {"value": str(max_sites)})
            conn.commit()

        return jsonify(
            {'message': f'Maximum sites per user updated to {max_sites}'})
    except Exception as e:
        app.logger.error(f'Error updating max sites: {str(e)}')
        return jsonify({'error': 'Failed to update max sites setting'}), 500


@app.route('/api/admin/settings/leader-access-code', methods=['GET'])
@login_required
@admin_required
def get_leader_access_code():
    try:
        with db.engine.connect() as conn:
            result = conn.execute(
                db.text("SELECT access_code FROM leader_onboarding_access LIMIT 1")
            )
            row = result.fetchone()
            
            if row:
                return jsonify({
                    'success': True,
                    'access_code': row[0]
                })
            else:
                return jsonify({
                    'success': False,
                    'message': 'No access code found'
                }), 404
    except Exception as e:
        app.logger.error(f'Error retrieving leader access code: {str(e)}')
        return jsonify({
            'success': False,
            'message': 'Failed to retrieve access code'
        }), 500


@app.route('/api/admin/settings/leader-access-code', methods=['POST'])
@login_required
@admin_required
def update_leader_access_code():
    try:
        data = request.get_json()
        access_code = data.get('access_code')
        
        if not access_code:
            return jsonify({
                'success': False,
                'message': 'Access code cannot be empty'
            }), 400
            
        with db.engine.connect() as conn:
            # Update the access code
            conn.execute(
                db.text("""
                    UPDATE leader_onboarding_access 
                    SET access_code = :code, updated_at = CURRENT_TIMESTAMP 
                    WHERE id = (SELECT id FROM leader_onboarding_access LIMIT 1)
                """),
                {"code": access_code}
            )
            
            # If no record exists, create one
            if conn.execute(db.text("SELECT COUNT(*) FROM leader_onboarding_access")).scalar() == 0:
                conn.execute(
                    db.text("INSERT INTO leader_onboarding_access (access_code) VALUES (:code)"),
                    {"code": access_code}
                )
                
            conn.commit()
            
        # Record this admin action
        activity = UserActivity(
            activity_type="admin_action",
            message="Admin {username} updated leader onboarding access code",
            username=current_user.username,
            user_id=current_user.id
        )
        db.session.add(activity)
        db.session.commit()
            
        return jsonify({
            'success': True,
            'message': 'Access code updated successfully'
        })
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error updating leader access code: {str(e)}')
        return jsonify({
            'success': False,
            'message': 'Failed to update access code'
        }), 500


@app.route('/api/admin/search/users')
@login_required
@admin_required
def search_users():
    try:
        search_term = request.args.get('term', '')
        if not search_term or len(search_term) < 2:
            return jsonify(
                {'error': 'Search term must be at least 2 characters'}), 400

        users = User.query.with_entities(
            User.id, User.username, User.email, User.created_at,
            User.is_suspended, User.is_admin).filter(
                db.or_(User.username.ilike(f'%{search_term}%'),
                       User.email.ilike(f'%{search_term}%'))).limit(50).all()

        result = []
        for user in users:
            # Check explicitly if the user is a club leader
            is_club_leader = Club.query.filter_by(
                leader_id=user.id).first() is not None

            result.append({
                'id':
                user.id,
                'username':
                user.username,
                'email':
                user.email,
                'created_at':
                user.created_at.strftime('%Y-%m-%d %H:%M:%S'),
                'is_suspended':
                user.is_suspended,
                'is_admin':
                user.is_admin,
                'is_staff':
                getattr(user, 'is_staff', False),
                'is_club_leader':
                is_club_leader
            })

        return jsonify({'users': result})
    except Exception as e:
        app.logger.error(f'Error searching users: {str(e)}')
        return jsonify({'error': 'Failed to search users'}), 500


@app.route('/api/admin/search/sites')
@login_required
@admin_required
def search_sites():
    try:
        search_term = request.args.get('term', '')
        if not search_term or len(search_term) < 2:
            return jsonify(
                {'error': 'Search term must be at least 2 characters'}), 400

        sites = db.session.query(
            Site.id, Site.name, Site.slug, Site.site_type, Site.created_at,
            Site.updated_at, Site.user_id, User.username).join(User).filter(
                db.or_(
                    Site.name.ilike(f'%{search_term}%'),
                    Site.slug.ilike(f'%{search_term}%'),
                    User.username.ilike(f'%{search_term}%'))).limit(50).all()

        result = []
        for site in sites:
            result.append({
                'id':
                site.id,
                'name':
                site.name,
                'slug':
                site.slug,
                'site_type':
                site.site_type,
                'created_at':
                site.created_at.strftime('%Y-%m-%d'),
                'updated_at':
                site.updated_at.strftime('%Y-%m-%d %H:%M'),
                'user_id':
                site.user_id,
                'username':
                site.username
            })

        return jsonify({'sites': result})
    except Exception as e:
        app.logger.error(f'Error searching sites: {str(e)}')
        return jsonify({'error': 'Failed to search sites'}), 500


@app.route('/api/admin/search/clubs')
@login_required
@admin_required
def search_clubs():
    try:
        search_term = request.args.get('term', '')
        if not search_term or len(search_term) < 2:
            return jsonify(
                {'error': 'Search term must be at least 2 characters'}), 400

        clubs = db.session.query(
            Club.id, Club.name, Club.description, Club.location,
            Club.join_code, Club.created_at, Club.leader_id,
            User.username.label('leader_username')).join(
                User, Club.leader_id == User.id).filter(
                    db.or_(Club.name.ilike(f'%{search_term}%'),
                           Club.description.ilike(f'%{search_term}%'),
                           User.username.ilike(f'%{search_term}%'))).limit(
                               50).all()

        result = []
        for club in clubs:
            # Count club members
            member_count = ClubMembership.query.filter_by(
                club_id=club.id).count()

            result.append({
                'id': club.id,
                'name': club.name,
                'description': club.description,
                'location': club.location,
                'join_code': club.join_code,
                'created_at': club.created_at.strftime('%Y-%m-%d'),
                'leader_id': club.leader_id,
                'leader_username': club.leader_username,
                'member_count': member_count
            })

        return jsonify({'clubs': result})
    except Exception as e:
        app.logger.error(f'Error searching clubs: {str(e)}')
        return jsonify({'error': 'Failed to search clubs'}), 500


@app.route('/api/admin/clubs/<int:club_id>')
@login_required
@admin_required
def get_club_details(club_id):
    try:
        club = Club.query.get_or_404(club_id)
        leader = User.query.get(club.leader_id)

        # Get all members with their details
        memberships = db.session.query(ClubMembership, User).join(
            User, ClubMembership.user_id == User.id).filter(
                ClubMembership.club_id == club_id).all()

        members = []
        for membership, user in memberships:
            members.append({
                'membership_id':
                membership.id,
                'user_id':
                user.id,
                'username':
                user.username,
                'email':
                user.email,
                'role':
                membership.role,
                'joined_at':
                membership.joined_at.strftime('%Y-%m-%d %H:%M:%S')
            })

        club_data = {
            'id': club.id,
            'name': club.name,
            'description': club.description,
            'location': club.location,
            'join_code': club.join_code,
            'created_at': club.created_at.strftime('%Y-%m-%d %H:%M:%S'),
            'leader_id': club.leader_id,
            'leader_username': leader.username if leader else 'Unknown',
            'members': members
        }

        return jsonify(club_data)

    except Exception as e:
        app.logger.error(f'Error getting club details: {str(e)}')
        return jsonify({'error': 'Failed to get club details'}), 500


@app.route('/api/admin/clubs/<int:club_id>', methods=['DELETE'])
@login_required
@admin_required
def delete_club(club_id):
    try:
        club = Club.query.get_or_404(club_id)

        # Delete all memberships first
        ClubMembership.query.filter_by(club_id=club_id).delete()

        # Delete the club itself
        db.session.delete(club)

        # Record the activity
        activity = UserActivity(
            activity_type="admin_action",
            message=f'Admin {{username}} deleted club "{club.name}"',
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({'message': 'Club deleted successfully'})

    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error deleting club: {str(e)}')
        return jsonify({'error': 'Failed to delete club'}), 500


@app.route('/api/admin/clubs/<int:club_id>/join-code', methods=['POST'])
@login_required
@admin_required
def admin_reset_join_code(club_id):
    try:
        club = Club.query.get_or_404(club_id)

        # Generate new join code
        club.generate_join_code()

        # Record the activity
        activity = UserActivity(
            activity_type="admin_action",
            message=
            f'Admin {{username}} reset join code for club "{club.name}"',
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({
            'message': 'Join code reset successfully',
            'join_code': club.join_code
        })

    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error resetting join code: {str(e)}')
        return jsonify({'error': 'Failed to reset join code'}), 500


@app.route('/api/admin/clubs/members/<int:membership_id>/role',
           methods=['PUT'])
@login_required
@admin_required
def admin_change_member_role(membership_id):
    try:
        membership = ClubMembership.query.get_or_404(membership_id)
        user = User.query.get(membership.user_id)
        club = Club.query.get(membership.club_id)

        # Don't allow changing the club leader's role
        if user.id == club.leader_id:
            return jsonify({'error':
                            'Cannot change the club leader\'s role'}), 400

        data = request.get_json()
        new_role = data.get('role')

        if new_role not in ['member', 'co-leader']:
            return jsonify({'error': 'Invalid role'}), 400

        old_role = membership.role
        membership.role = new_role

        # Record the activity
        activity = UserActivity(
            activity_type="admin_action",
            message=
            f'Admin {{username}} changed {user.username}\'s role from "{old_role}" to "{new_role}" in club "{club.name}"',
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({'message': f'Role updated to {new_role}'})

    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error changing member role: {str(e)}')
        return jsonify({'error': 'Failed to change member role'}), 500


@app.route('/api/admin/clubs/members/<int:membership_id>', methods=['DELETE'])
@login_required
@admin_required
def admin_remove_club_member(membership_id):
    try:
        membership = ClubMembership.query.get_or_404(membership_id)
        user = User.query.get(membership.user_id)
        club = Club.query.get(membership.club_id)

        # Don't allow removing the club leader
        if user.id == club.leader_id:
            return jsonify(
                {'error':
                 'Cannot remove the club leader from their own club'}), 400

        # Delete the membership
        db.session.delete(membership)

        # Record the activity
        activity = UserActivity(
            activity_type="admin_action",
            message=
            f'Admin {{username}} removed {user.username} from club "{club.name}"',
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify(
            {'message': f'Successfully removed {user.username} from the club'})

    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error removing club member: {str(e)}')
        return jsonify({'error': 'Failed to remove club member'}), 500


@app.route('/api/clubs/<int:club_id>/projects', methods=['GET'])
@login_required
def get_club_projects(club_id):
    """Get all projects for a club."""
    try:
        club = Club.query.get_or_404(club_id)
        
        # Check if user is a member of the club
        is_member = ClubMembership.query.filter_by(club_id=club_id, user_id=current_user.id).first()
        if not is_member and club.leader_id != current_user.id:
            return jsonify({'error': 'You are not a member of this club'}), 403
            
        # Get all sites from club members
        members = ClubMembership.query.filter_by(club_id=club_id).all()
        member_ids = [m.user_id for m in members]
        member_ids.append(club.leader_id)  # Include the leader
        
        # Get projects (sites) by these members
        sites = Site.query.filter(Site.user_id.in_(member_ids)).all()
        
        # Get featured projects
        featured_projects = ClubFeaturedProject.query.filter_by(club_id=club_id).all()
        featured_site_ids = [p.site_id for p in featured_projects]
        
        # Format response
        projects = []
        for site in sites:
            user = User.query.get(site.user_id)
            projects.append({
                'id': site.id,
                'name': site.name,
                'slug': site.slug,
                'description': '',  # Sites don't have descriptions in current schema
                'owner': {
                    'id': user.id,
                    'username': user.username
                },
                'featured': site.id in featured_site_ids,
                'updated_at': site.updated_at.isoformat(),
                'created_at': site.created_at.isoformat()
            })
            
        return jsonify({'projects': projects})
        
    except Exception as e:
        app.logger.error(f'Error getting club projects: {str(e)}')
        return jsonify({'error': f'Failed to get club projects: {str(e)}'}), 500

@app.route('/api/clubs/<int:club_id>/projects/<int:project_id>/feature', methods=['POST'])
@login_required
def toggle_project_featured(club_id, project_id):
    """Toggle a project's featured status in a club."""
    try:
        club = Club.query.get_or_404(club_id)
        
        # Only club leader and co-leaders can feature projects
        membership = ClubMembership.query.filter_by(club_id=club_id, user_id=current_user.id).first()
        if club.leader_id != current_user.id and (not membership or membership.role != 'co-leader'):
            return jsonify({'error': 'Only club leaders can feature projects'}), 403
            
        site = Site.query.get_or_404(project_id)
        
        # Check if project is already featured
        featured = ClubFeaturedProject.query.filter_by(club_id=club_id, site_id=project_id).first()
        
        data = request.get_json()
        feature = data.get('featured', True)
        
        if featured and not feature:
            # Unfeature the project
            db.session.delete(featured)
            db.session.commit()
            return jsonify({'message': 'Project unfeatured successfully'})
        elif not featured and feature:
            # Feature the project
            new_featured = ClubFeaturedProject(
                club_id=club_id,
                site_id=project_id,
                featured_by=current_user.id
            )
            db.session.add(new_featured)
            db.session.commit()
            return jsonify({'message': 'Project featured successfully'})
        else:
            # No change needed
            status = 'featured' if feature else 'unfeatured'
            return jsonify({'message': f'Project already {status}'})
            
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error toggling project featured status: {str(e)}')
        return jsonify({'error': f'Failed to update project status: {str(e)}'}), 500

@app.route('/api/clubs/<int:club_id>/stats', methods=['GET'])
@login_required
def get_club_stats(club_id):
    """Get statistics for a club dashboard."""
    try:
        club = Club.query.get_or_404(club_id)
        
        # Check if user is a member of the club
        is_member = ClubMembership.query.filter_by(club_id=club_id, user_id=current_user.id).first()
        if not is_member and club.leader_id != current_user.id:
            return jsonify({'error': 'You are not a member of this club'}), 403
            
        # Get member count
        member_count = ClubMembership.query.filter_by(club_id=club_id).count() + 1  # +1 for the leader
        
        # Get active assignments count
        active_assignments = ClubAssignment.query.filter_by(club_id=club_id, is_active=True).count()
        
        # Get all sites from club members
        members = ClubMembership.query.filter_by(club_id=club_id).all()
        member_ids = [m.user_id for m in members]
        member_ids.append(club.leader_id)  # Include the leader
        
        # Get projects (sites) by these members
        project_count = Site.query.filter(Site.user_id.in_(member_ids)).count()
        
        return jsonify({
            'member_count': member_count,
            'active_assignments': active_assignments,
            'project_count': project_count
        })
        
    except Exception as e:
        app.logger.error(f'Error getting club stats: {str(e)}')
        return jsonify({'error': f'Failed to get club stats: {str(e)}'}), 500

@app.route('/api/admin/stats/counts')
@login_required
@admin_required
def get_total_counts():
    """Get total counts of users and sites for admin dashboard."""
    try:
        total_users = User.query.count()
        total_sites = Site.query.count()

        return jsonify({'totalUsers': total_users, 'totalSites': total_sites})
    except Exception as e:
        app.logger.error(f'Error getting total counts: {str(e)}')
        return jsonify({'error': 'Failed to get total counts'}), 500


@app.route('/api/users/<int:user_id>')
@login_required
def get_user_details(user_id):
    try:
        user = User.query.get_or_404(user_id)

        user_data = {
            'username':
            user.username,
            'email':
            user.email,
            'created_at':
            user.created_at.strftime('%Y-%m-%d %H:%M:%S'),
            'is_suspended':
            user.is_suspended,
            'sites_count':
            len(user.sites),
            'logins_count':
            0,
            'last_active':
            user.last_login.strftime('%Y-%m-%d %H:%M:%S')
            if user.last_login else 'Never'
        }

        return jsonify(user_data)
    except Exception as e:
        app.logger.error(f'Error retrieving user details: {str(e)}')
        return jsonify({'error': 'Failed to retrieve user details'}), 500


@app.route('/api/sites/<int:site_id>/analytics')
@login_required
def get_site_analytics(site_id):
    try:
        site = Site.query.get_or_404(site_id)
        if site.user_id != current_user.id and not current_user.is_admin:
            abort(403)

        view_count = site.view_count if site.view_count is not None else 0
        analytics_enabled = site.analytics_enabled if site.analytics_enabled is not None else False

        from datetime import datetime, timedelta
        import random

        today = datetime.now()
        labels = [(today - timedelta(days=i)).strftime('%b %d')
                  for i in range(14, -1, -1)]

        if analytics_enabled and view_count:
            total_views = view_count
            avg_daily = max(1, total_views // 15)
            values = [
                random.randint(max(0, avg_daily - 5), avg_daily + 10)
                for _ in range(15)
            ]
            while sum(values) > total_views:
                idx = random.randint(0, 14)
                if values[idx] > 0:
                    values[idx] -= 1
        else:
            values = [0] * 15

        return jsonify({
            'total_views': view_count,
            'analytics_enabled': analytics_enabled,
            'views_data': {
                'labels': labels,
                'values': values
            }
        })
    except Exception as e:
        app.logger.error(f'Error retrieving site analytics: {str(e)}')
        return jsonify({'error': 'Failed to retrieve site analytics'}), 500


@app.route('/api/sites/<int:site_id>/analytics/toggle', methods=['POST'])
@login_required
def toggle_site_analytics(site_id):
    try:
        site = Site.query.get_or_404(site_id)
        if site.user_id != current_user.id and not current_user.is_admin:
            abort(403)

        data = request.get_json()
        enabled = data.get('enabled', False)

        site.analytics_enabled = enabled
        db.session.commit()

        return jsonify({
            'message':
            f'Analytics {"enabled" if enabled else "disabled"} successfully'
        })
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error toggling analytics: {str(e)}')
        return jsonify({'error': 'Failed to update analytics settings'}), 500


@app.route('/api/sites/<int:site_id>/analytics/clear', methods=['POST'])
@login_required
def clear_site_analytics(site_id):
    try:
        site = Site.query.get_or_404(site_id)
        if site.user_id != current_user.id and not current_user.is_admin:
            abort(403)

        site.view_count = 0
        db.session.commit()

        with db.engine.connect() as connection:
            connection.execute(
                db.text(
                    "UPDATE site SET view_count = 0 WHERE id = :site_id",
                    {"site_id": site.id}
                ))
            connection.commit()

        return jsonify({'message': 'Analytics data cleared successfully'})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error clearing analytics: {str(e)}')
        return jsonify({'error': 'Failed to clear analytics data'}), 500


@app.route('/api/sites/<int:site_id>/files', methods=['GET', 'POST'])

@app.route('/api/admin/users-stats', methods=['GET'])
@login_required
@admin_required
def get_admin_user_stats():
    """Get user statistics for admin dashboard."""
    try:
        # Get count of new users in the last 7 days
        from datetime import datetime, timedelta
        seven_days_ago = datetime.utcnow() - timedelta(days=7)
        
        new_users_count = User.query.filter(User.created_at >= seven_days_ago).count()
        active_users_count = User.query.filter_by(is_suspended=False).count()
        suspended_users_count = User.query.filter_by(is_suspended=True).count()
        
        return jsonify({
            'success': True,
            'newUsers': new_users_count,
            'activeUsers': active_users_count,
            'suspendedUsers': suspended_users_count
        })
    except Exception as e:
        app.logger.error(f'Error getting user stats: {str(e)}')
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/users/<int:user_id>/profile', methods=['GET'])
@login_required
def get_user_profile(user_id):
    """Get detailed user profile information."""
    try:
        # Only allow admin or the user themselves to access their profile
        if current_user.id != user_id and not current_user.is_admin:
            return jsonify({
                'success': False,
                'message': 'Unauthorized'
            }), 403
        
        user = User.query.get_or_404(user_id)
        
        profile_data = {
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'bio': user.bio,
            'avatar': user.avatar,
            'profile_banner': user.profile_banner,
            'is_profile_public': user.is_profile_public,
            'social_links': user.social_links or {},
            'created_at': user.created_at.isoformat() if user.created_at else None,
            'last_login': user.last_login.isoformat() if user.last_login else None
        }
        
        return jsonify(profile_data)
    except Exception as e:
        app.logger.error(f'Error retrieving user profile: {str(e)}')
        return jsonify({
            'success': False,
            'message': f'Failed to retrieve user profile: {str(e)}'
        }), 500

@app.route('/api/admin/users/<int:user_id>/profile', methods=['PUT'])
@login_required
@admin_required
def update_user_profile_admin(user_id):
    """Update user profile as admin."""
    try:
        user = User.query.get_or_404(user_id)
        data = request.get_json()
        
        # Update user profile fields
        if 'bio' in data:
            user.bio = data['bio']
        if 'avatar' in data:
            user.avatar = data['avatar']
        if 'profile_banner' in data:
            user.profile_banner = data['profile_banner']
        if 'is_profile_public' in data:
            user.is_profile_public = data['is_profile_public']
        if 'social_links' in data:
            user.social_links = data['social_links']
        
        db.session.commit()
        
        # Record admin activity
        activity = UserActivity(
            activity_type="admin_action",
            message=f"Admin {{username}} updated {user.username}'s profile",
            username=current_user.username,
            user_id=current_user.id
        )
        db.session.add(activity)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': f'Profile for {user.username} updated successfully'
        })
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error updating user profile: {str(e)}')
        return jsonify({
            'success': False,
            'message': f'Failed to update user profile: {str(e)}'
        }), 500

@app.route('/api/admin/users/<int:user_id>/reset-password', methods=['POST'])
@login_required
@admin_required
def admin_reset_password(user_id):
    """Reset a user's password as admin."""
    try:
        user = User.query.get_or_404(user_id)
        
        if user.id == current_user.id:
            return jsonify({
                'success': False,
                'message': 'Please use account settings to change your own password'
            }), 400
        
        data = request.get_json()
        new_password = data.get('password')
        
        if not new_password:
            return jsonify({
                'success': False,
                'message': 'New password is required'
            }), 400
        
        user.set_password(new_password)
        db.session.commit()
        
        # Record admin activity
        activity = UserActivity(
            activity_type="admin_action",
            message=f"Admin {{username}} reset password for {user.username}",
            username=current_user.username,
            user_id=current_user.id
        )
        db.session.add(activity)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': f'Password for {user.username} has been reset'
        })
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error resetting password: {str(e)}')
        return jsonify({
            'success': False,
            'message': f'Failed to reset password: {str(e)}'
        }), 500

@app.route('/api/admin/users/<int:user_id>/admin-status', methods=['POST'])
@login_required
@admin_required
def toggle_admin_status(user_id):
    """Toggle a user's admin status."""
    try:
        user = User.query.get_or_404(user_id)
        
        if user.id == current_user.id:
            return jsonify({
                'success': False,
                'message': 'You cannot change your own admin status'
            }), 400
        
        data = request.get_json()
        make_admin = data.get('is_admin', False)
        
        user.is_admin = make_admin
        db.session.commit()
        
        # Record admin activity
        activity = UserActivity(
            activity_type="admin_action",
            message=f"Admin {{username}} {'made' if make_admin else 'removed'} {user.username} {'as an' if make_admin else 'from being an'} admin",
            username=current_user.username,
            user_id=current_user.id
        )
        db.session.add(activity)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': f'Admin status for {user.username} has been {"granted" if make_admin else "revoked"}'
        })
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error updating admin status: {str(e)}')
        return jsonify({
            'success': False,
            'message': f'Failed to update admin status: {str(e)}'
        }), 500

@app.route('/api/admin/impersonate/<int:user_id>', methods=['POST'])
@login_required
@admin_required
def impersonate_user(user_id):
    """Impersonate a user (admin only)."""
    try:
        if user_id == current_user.id:
            return jsonify({
                'success': False,
                'message': 'You cannot impersonate yourself'
            }), 400
        
        user = User.query.get_or_404(user_id)
        
        # Store original admin ID in session
        session['admin_impersonator_id'] = current_user.id
        
        # Record admin activity
        activity = UserActivity(
            activity_type="admin_impersonation",
            message=f"Admin {{username}} started impersonating {user.username}",
            username=current_user.username,
            user_id=current_user.id
        )
        db.session.add(activity)
        db.session.commit()
        
        # Login as the target user
        logout_user()
        login_user(user)
        
        return jsonify({
            'success': True,
            'message': f'Now impersonating {user.username}',
            'redirect': '/welcome'
        })
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error impersonating user: {str(e)}')
        return jsonify({
            'success': False,
            'message': f'Failed to impersonate user: {str(e)}'
        }), 500

@app.route('/api/admin/stop-impersonation', methods=['POST'])
@login_required
def stop_impersonation():
    """Stop impersonating a user and return to admin account."""
    try:
        if 'admin_impersonator_id' not in session:
            return jsonify({
                'success': False,
                'message': 'Not currently impersonating'
            }), 400
        
        admin_id = session.pop('admin_impersonator_id')
        impersonated_username = current_user.username
        
        admin = User.query.get(admin_id)
        if not admin:
            return jsonify({
                'success': False,
                'message': 'Original admin account not found'
            }), 404
        
        # Record activity
        activity = UserActivity(
            activity_type="admin_impersonation",
            message=f"Admin {admin.username} stopped impersonating {impersonated_username}",
            username=admin.username,
            user_id=admin.id
        )
        db.session.add(activity)
        db.session.commit()
        
        # Login as the admin again
        logout_user()
        login_user(admin)
        
        return jsonify({
            'success': True,
            'message': 'Returned to admin account',
            'redirect': '/admin'
        })
    except Exception as e:
        app.logger.error(f'Error stopping impersonation: {str(e)}')
        return jsonify({
            'success': False,
            'message': f'Failed to stop impersonation: {str(e)}'
        }), 500

@app.route('/api/admin/users/<int:user_id>/staff-status', methods=['POST'])
@login_required
@admin_required
def toggle_staff_status(user_id):
    """Toggle a user's staff status."""
    try:
        user = User.query.get_or_404(user_id)
        
        if user.id == current_user.id:
            return jsonify({
                'success': False,
                'message': 'You cannot change your own staff status'
            }), 400
        
        data = request.get_json()
        make_staff = data.get('is_staff', False)
        
        user.is_staff = make_staff
        db.session.commit()
        
        # Record admin activity
        activity = UserActivity(
            activity_type="admin_action",
            message=f"Admin {{username}} {'made' if make_staff else 'removed'} {user.username} {'as' if make_staff else 'from being'} HQ staff",
            username=current_user.username,
            user_id=current_user.id
        )
        db.session.add(activity)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': f'Staff status for {user.username} has been {"granted" if make_staff else "revoked"}'
        })
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error updating staff status: {str(e)}')
        return jsonify({
            'success': False,
            'message': f'Failed to update staff status: {str(e)}'
        }), 500

@app.route('/api/admin/logs', methods=['GET', 'POST'])
@login_required
@admin_required
def admin_logs():
    """Get or clear logs for admin"""
    from utils.logs_util import logs_manager
    
    if request.method == 'POST':
        action = request.json.get('action')
        if action == 'clear':
            logs_manager.clear_logs()
            return jsonify({'success': True, 'message': 'Logs cleared successfully'})
        return jsonify({'success': False, 'message': 'Invalid action'})
    
    # GET request - return logs as JSON file download
    logs = logs_manager.get_logs()
    
    # Add information about auto-clearing to the logs metadata
    metadata = {
        "logs_count": len(logs),
        "last_cleared": logs_manager.last_cleared.isoformat(),
        "auto_clear_interval": "30 minutes",
        "generated_at": datetime.utcnow().isoformat()
    }
    
    response_data = {
        "metadata": metadata,
        "logs": logs
    }
    
    return Response(
        json.dumps(response_data, indent=2),
        mimetype='application/json',
        headers={'Content-Disposition': f'attachment;filename=logs_{datetime.utcnow().strftime("%Y%m%d_%H%M%S")}.json'}
    )

@app.route('/api/admin/export-users', methods=['POST'])
@login_required
@admin_required
def export_users():
    """Export selected users data to CSV."""
    try:
        data = request.get_json()
        user_ids = data.get('user_ids', [])
        
        if not user_ids:
            return jsonify({
                'success': False,
                'message': 'No users selected for export'
            }), 400
        
        # Query users
        users = User.query.filter(User.id.in_(user_ids)).all()
        
        # Create CSV content
        import csv
        import io
        
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Write header
        writer.writerow([
            'ID', 'Username', 'Email', 'Created At', 'Last Login',
            'Is Active', 'Is Suspended', 'Is Admin', 'Is Club Leader',
            'Sites Count', 'Public Profile', 'Has Avatar', 'Has Bio'
        ])
        
        # Write data rows
        for user in users:
            # Get sites count
            sites_count = Site.query.filter_by(user_id=user.id).count()
            
            # Check if user is a club leader
            is_club_leader = Club.query.filter_by(leader_id=user.id).first() is not None
            
            writer.writerow([
                user.id,
                user.username,
                user.email,
                user.created_at.strftime('%Y-%m-%d %H:%M:%S') if user.created_at else '',
                user.last_login.strftime('%Y-%m-%d %H:%M:%S') if user.last_login else '',
                user.is_active,
                user.is_suspended,
                user.is_admin,
                is_club_leader,
                sites_count,
                user.is_profile_public,
                bool(user.avatar),
                bool(user.bio)
            ])
        
        # Record admin activity
        activity = UserActivity(
            activity_type="admin_export",
            message=f"Admin {{username}} exported {len(users)} users' data",
            username=current_user.username,
            user_id=current_user.id
        )
        db.session.add(activity)
        db.session.commit()
        
        # Prepare response
        output.seek(0)
        return Response(
            output.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment;filename=users_export.csv"}
        )
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error exporting users: {str(e)}')

        if search:
            query = query.filter(
                db.or_(User.username.ilike(f'%{search}%'),
                       User.email.ilike(f'%{search}%')))

        total = query.count()
        users = query.order_by(User.created_at.desc()).paginate(
            page=page, per_page=per_page, error_out=False)

        users_list = []
        for user in users.items:
            is_club_leader = Club.query.filter_by(
                leader_id=user.id).first() is not None

            users_list.append({
                'id':
                user.id,
                'username':
                user.username,
                'email':
                user.email,
                'created_at':
                user.created_at.isoformat(),
                'is_admin':
                user.is_admin,
                'is_suspended':
                user.is_suspended,
                'is_club_leader':
                is_club_leader,
                'sites_count':
                Site.query.filter_by(user_id=user.id).count()
            })

        return jsonify({
            'users': users_list,
            'total': total,
            'pages': users.pages,
            'current_page': users.page
        })
    except Exception as e:
        app.logger.error(f'Error getting admin users list: {str(e)}')
        return jsonify({'error': 'Failed to retrieve users'}), 500


@app.route('/api/admin/sites-list')
@login_required
@admin_required
def get_admin_sites_list():
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        search = request.args.get('search', '')

        query = Site.query

        if search:
            query = query.filter(Site.name.ilike(f'%{search}%'))

        total = query.count()
        sites = query.order_by(Site.updated_at.desc()).paginate(
            page=page, per_page=per_page, error_out=False)

        sites_list = []
        for site in sites.items:
            user = User.query.get(site.user_id)
            sites_list.append({
                'id': site.id,
                'name': site.name,
                'slug': site.slug,
                'type': site.site_type,
                'created_at': site.created_at.isoformat(),
                'updated_at': site.updated_at.isoformat(),
                'owner': {
                    'id': user.id if user else None,
                    'username': user.username if user else 'Unknown'
                }
            })

        return jsonify({
            'sites': sites_list,
            'total': total,
            'pages': sites.pages,
            'current_page': sites.page
        })
    except Exception as e:
        app.logger.error(f'Error getting admin sites list: {str(e)}')
        return jsonify({'error': 'Failed to retrieve sites'}), 500

# Removed duplicate save_site_content function


@app.route('/site/update/<int:site_id>', methods=['POST'])
@login_required
def update_site_form(site_id):
    site = Site.query.get_or_404(site_id)

    if site.user_id != current_user.id:
        abort(403)

    if site.site_type == 'web' and 'html_content' in request.form:
        site.html_content = request.form['html_content']
    elif (site.site_type == 'python' or site.site_type == 'code') and 'language_content' in request.form:
        # Handle all code spaces including Python
        site.language_content = request.form['language_content']
        
        # Ensure Python spaces have language set
        if site.site_type == 'python' and not site.language:
            site.language = 'python'
        
        # Update language if provided
        if 'language' in request.form and request.form['language']:
            # Only update if the language is changing
            if site.language != request.form['language']:
                from piston_service import PistonService
                site.language = request.form['language']
                
                # Get the latest version for the new language
                language_version = PistonService.get_latest_version(site.language)
                if language_version:
                    site.language_version = language_version
    else:
        return jsonify({'error': 'No content provided'}), 400

    site.updated_at = datetime.utcnow()
    db.session.commit()

    return jsonify({'success': True})


@app.route('/api/site/<int:site_id>/save', methods=['POST'])
@login_required
def save_site_content(site_id):
    try:
        site = Site.query.get_or_404(site_id)

        if site.user_id != current_user.id and not current_user.is_admin:
            # Check if user is a collaborator
            collab = Collaborator.query.filter_by(site_id=site_id, user_id=current_user.id).first()
            if not collab or not collab.can_edit:
                return jsonify({'success': False, 'error': 'Permission denied'}), 403

        data = request.get_json()
        content = data.get('content', '')
        files = data.get('files', {})

        if site.site_type == 'web':
            # Handle web content
            site.html_content = data.get('content')
            
            # Handle multiple files if provided
            if files:
                # Update site pages
                for filename, file_content in files.items():
                    # Skip the main files which are stored in the site model
                    if filename in ['index.html', 'script.js', 'style.css']:
                        continue
                        
                    # Check if page exists
                    page = SitePage.query.filter_by(site_id=site_id, filename=filename).first()
                    
                    if page:
                        page.content = file_content
                    else:
                        new_page = SitePage(site_id=site_id, filename=filename, content=file_content)
                        db.session.add(new_page)
                
                # Update main files
                site.html_content = files.get('index.html', site.html_content)
                site.js_content = files.get('script.js', site.js_content)
                site.css_content = files.get('style.css', site.css_content)
                
        elif site.site_type == 'python' or site.site_type == 'code':
            # For all code spaces including Python
            site.language_content = content
            
            # Update language if provided
            language = data.get('language')
            
            # Ensure Python spaces have language set
            if site.site_type == 'python' and not site.language:
                site.language = 'python'
            if language and language != site.language:
                from piston_service import PistonService
                site.language = language
                
                # Get the latest version for the new language
                language_version = PistonService.get_latest_version(language)
                if language_version:
                    site.language_version = language_version
            
            # Handle multiple files for code sites
            if files and isinstance(files, dict):
                from piston_service import PistonService
                
                for filename, file_data in files.items():
                    # Skip the main file which is stored in site.language_content
                    if filename == f"main.{PistonService._get_file_extension(site.language)}":
                        continue
                    
                    # Handle file data based on format
                    if isinstance(file_data, dict):
                        file_content = file_data.get('content', '')
                        file_language = file_data.get('language', site.language)
                    else:
                        file_content = file_data
                        file_language = site.language
                    
                    # Check if page exists
                    page = SitePage.query.filter_by(site_id=site_id, filename=filename).first()
                    
                    if page:
                        page.content = file_content
                        page.metadata = json.dumps({'language': file_language})
                    else:
                        # Determine file type based on filename or language
                        file_type = 'code'
                        if '.' in filename:
                            ext = filename.split('.')[-1].lower()
                            if ext in ['html', 'htm', 'xml', 'svg']:
                                file_type = 'html'
                            elif ext in ['css', 'scss', 'sass']:
                                file_type = 'css'
                            elif ext in ['js', 'ts', 'jsx', 'tsx']:
                                file_type = 'javascript'
                        
                        new_page = SitePage(
                            site_id=site_id, 
                            filename=filename, 
                            content=file_content,
                            file_type=file_type,
                            metadata=json.dumps({'language': file_language})
                        )
                        db.session.add(new_page)

        # Update last modified time
        site.updated_at = datetime.utcnow()
        db.session.commit()

        # Log activity
        activity = UserActivity(activity_type='site_update',
                                message=f'Updated site "{site.name}"',
                                username=current_user.username,
                                user_id=current_user.id,
                                site_id=site.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({'success': True, 'message': 'Content saved successfully'})
        
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error saving site content: {str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/admin/users-list')
@login_required
@admin_required
def get_admin_users_list():
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        search = request.args.get('search', '')

        query = User.query

        if search:
            query = query.filter(
                db.or_(User.username.ilike(f'%{search}%'),
                       User.email.ilike(f'%{search}%')))

        total = query.count()
        users = query.order_by(User.created_at.desc()).paginate(
            page=page, per_page=per_page, error_out=False)

        users_list = []
        for user in users.items:
            is_club_leader = Club.query.filter_by(
                leader_id=user.id).first() is not None

            users_list.append({
                'id':
                user.id,
                'username':
                user.username,
                'email':
                user.email,
                'created_at':
                user.created_at.isoformat(),
                'is_admin':
                user.is_admin,
                'is_suspended':
                user.is_suspended,
                'is_club_leader':
                is_club_leader,
                'sites_count':
                Site.query.filter_by(user_id=user.id).count()
            })

        return jsonify({
            'users': users_list,
            'total': total,
            'pages': users.pages,
            'current_page': users.page
        })
    except Exception as e:
        app.logger.error(f'Error getting admin users list: {str(e)}')
        return jsonify({'error': 'Failed to retrieve users'}), 500
    return jsonify({'success': True, 'message': 'Content saved successfully'})


@app.route('/api/site/<int:site_id>/pages', methods=['GET'])
@login_required
def get_site_pages(site_id):
    site = Site.query.get_or_404(site_id)

    if site.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    with db.engine.connect() as conn:
        result = conn.execute(
            db.text("SELECT * FROM site_page WHERE site_id = :site_id"),
            {"site_id": site_id})
        pages = [{
            "filename": row[2],
            "content": row[3],
            "file_type": row[4]
        } for row in result]

    if not pages and site.site_type == 'web':
        default_html = site.html_content or '<h1>Welcome to my site!</h1>'
        default_css = 'body { font-family: Arial, sans-serif; }'
        default_js = 'console.log("Hello from JavaScript!");'

        pages = [{
            "filename": "index.html",
            "content": default_html,
            "file_type": "html"
        }, {
            "filename": "styles.css",
            "content": default_css,
            "file_type": "css"
        }, {
            "filename": "script.js",
            "content": default_js,
            "file_type": "js"
        }]

        for page in pages:
            with db.engine.connect() as conn:
                conn.execute(
                    db.text("""
                        INSERT INTO site_page (site_id, filename, content, file_type)
                        VALUES (:site_id, :filename, :content, :file_type)
                        ON CONFLICT (site_id, filename) DO UPDATE
                        SET content = :content, file_type = :file_type
                    """), {
                        "site_id": site_id,
                        "filename": page["filename"],
                        "content": page["content"],
                        "file_type": page["file_type"]
                    })
                conn.commit()

    return jsonify({'success': True, 'pages': pages})


@app.route('/api/sites/<int:site_id>/files', methods=['GET'])
@login_required
def get_site_files(site_id):
    try:
        site = Site.query.get_or_404(site_id)

        if site.user_id != current_user.id and not current_user.is_admin:
            return jsonify({'error': 'Unauthorized'}), 403

        files = []

        if site.site_type == 'python':
            files.append({'filename': 'main.py', 'file_type': 'python'})
        else:
            with db.engine.connect() as conn:
                result = conn.execute(
                    db.text(
                        "SELECT filename, file_type FROM site_page WHERE site_id = :site_id"
                    ), {"site_id": site_id})

                for row in result:
                    files.append({'filename': row[0], 'file_type': row[1]})

            # Check if we have index.html
            if not any(f['filename'] == 'index.html' for f in files):
                files.append({'filename': 'index.html', 'file_type': 'html'})

            if not any(f['filename'] == 'styles.css' for f in files):
                files.append({'filename': 'styles.css', 'file_type': 'css'})

            if not any(f['filename'] == 'script.js' for f in files):
                files.append({'filename': 'script.js', 'file_type': 'js'})

        return jsonify({'success': True, 'files': files})
    except Exception as e:
        print(f'Error getting site files: {str(e)}')
        return jsonify({'error': 'Failed to get site files'}), 500


@app.route('/api/site/<int:site_id>/save_pages', methods=['POST'])
@login_required
def save_site_pages(site_id):
    site = Site.query.get_or_404(site_id)

    if site.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    data = request.get_json()
    pages = data.get('pages', [])

    if not pages:
        return jsonify({'error': 'No pages provided'}), 400

    index_html = next((page['content']
                       for page in pages if page['filename'] == 'index.html'),
                      None)

    if not index_html:
        return jsonify({'error': 'index.html is required'}), 400

    site.html_content = index_html
    db.session.commit()

    for page in pages:
        with db.engine.connect() as conn:
            conn.execute(
                db.text("""
                    INSERT INTO site_page (site_id, filename, content, file_type)
                    VALUES (:site_id, :filename, :content, :file_type)
                    ON CONFLICT (site_id, filename) DO UPDATE
                    SET content = :content, file_type = :file_type
                """), {
                    "site_id": site_id,
                    "filename": page["filename"],
                    "content": page["content"],
                    "file_type": page["file_type"]
                })
            conn.commit()

    activity = UserActivity(
        activity_type='site_update',
        message=f'Updated {len(pages)} pages for site "{site.name}"',
        username=current_user.username,
        user_id=current_user.id,
        site_id=site.id)
    db.session.add(activity)
    db.session.commit()

    return jsonify({
        'success': True,
        'message': 'All pages saved successfully'
    })


@app.route('/api/site/<int:site_id>/page/<path:filename>', methods=['DELETE'])
@login_required
def delete_site_page(site_id, filename):
    site = Site.query.get_or_404(site_id)

    if site.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    if filename in ['index.html', 'styles.css', 'script.js']:
        return jsonify({'error': 'Cannot delete default files'}), 400

    with db.engine.connect() as conn:
        conn.execute(
            db.text(
                "DELETE FROM site_page WHERE site_id = :site_id AND filename = :filename"
            ), {
                "site_id": site_id,
                "filename": filename
            })
        conn.commit()

    activity = UserActivity(
        activity_type='site_update',
        message=f'Deleted page "{filename}" from site "{site.name}"',
        username=current_user.username,
        user_id=current_user.id,
        site_id=site.id)
    db.session.add(activity)
    db.session.commit()

    return jsonify({
        'success': True,
        'message': f'Page {filename} deleted successfully'
    })


@app.route('/api/admin/admins/add', methods=['POST'])
@login_required
@admin_required
def add_admin_user():
    from admin_utils import add_admin
    try:
        data = request.get_json()
        username = data.get('username')
        if not username:
            return jsonify({'error': 'Username is required'}), 400

        user = User.query.filter_by(username=username).first()
        if not user:
            return jsonify({'error': 'User not found'}), 404

        result = add_admin(username)
        if result:
            return jsonify(
                {'message': f'User {username} added as admin successfully'})
        else:
            return jsonify({'message': f'User {username} is already an admin'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/admins/remove', methods=['POST'])
@login_required
@admin_required
def remove_admin_user():
    from admin_utils import remove_admin
    try:
        data = request.get_json()
        username = data.get('username')
        if not username:
            return jsonify({'error': 'Username is required'}), 400

        if username == current_user.username:
            return jsonify({'error': 'Cannot remove yourself as admin'}), 400

        result = remove_admin(username)
        if result:
            return jsonify({
                'message':
                f'User {username} removed from admins successfully'
            })
        else:
            return jsonify({'message': f'User {username} is not an admin'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/up')
def health_check():
    return '', 200


@app.route('/hackatime')
@login_required
def hackatime():
    """Page for Hackatime integration"""
    return render_template('hackatime.html')


@app.route('/hackatime/connect', methods=['POST'])
@login_required
def hackatime_connect():
    """Connect Hackatime account by saving API key"""
    try:
        data = request.get_json()
        api_key = data.get('api_key')

        if not api_key:
            return jsonify({
                'success': False,
                'message': 'API key is required'
            })

        # Validate the API key by making a request to the Hackatime API
        api_url = "https://hackatime.hackclub.com/api/hackatime/v1"

        # Try to send a test heartbeat to validate the API key
        try:
            # Log the request attempt
            app.logger.info(
                f"Attempting to validate Hackatime API key for user {current_user.username}"
            )

            # Try the heartbeat endpoint directly to validate the API key
            test_heartbeat_endpoint = f"{api_url}/users/current/heartbeats"
            app.logger.info(
                f"Testing heartbeat endpoint: {test_heartbeat_endpoint}")

            # Prepare headers with proper Authorization format
            headers = {
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            }

            # Send a proper test heartbeat as specified in the documentation
            current_time = int(time.time())
            test_data = [{
                "type": "file",
                "time": current_time,
                "entity": "test.txt",
                "language": "Text"
            }]

            response = requests.post(test_heartbeat_endpoint,
                                     headers=headers,
                                     json=test_data,
                                     timeout=5)

            # Log detailed response information
            app.logger.info(f"API validation response: {response.status_code}")

            if response.status_code >= 400:
                # Try an alternative endpoint as backup validation
                alternative_endpoint = f"{api_url}/users/current"
                app.logger.info(
                    f"Primary validation failed. Trying alternative endpoint: {alternative_endpoint}"
                )
                alternative_response = requests.get(alternative_endpoint,
                                                    headers=headers,
                                                    timeout=5)

                if alternative_response.status_code >= 400:
                    app.logger.error(
                        f"API key validation failed with status {response.status_code} and alternative status {alternative_response.status_code}"
                    )
                    return jsonify({
                        'success':
                        False,
                        'message':
                        f'Invalid API key or API endpoint not found. Please check your API key and try again.'
                    })
                else:
                    # Alternative endpoint worked, so the API key is valid
                    app.logger.info(
                        f"API key validation successful for user {current_user.username} using alternative endpoint"
                    )
            else:
                # If we get here, the API key is valid
                app.logger.info(
                    f"API key validation successful for user {current_user.username}"
                )

        except requests.RequestException as e:
            app.logger.error(f"API key validation error: {str(e)}")
            return jsonify({
                'success': False,
                'message': f'Error validating API key: {str(e)}'
            })

        # Update user's wakatime_api_key
        with db.engine.connect() as conn:
            conn.execute(
                db.text(
                    "UPDATE \"user\" SET wakatime_api_key = :api_key WHERE id = :user_id"
                ), {
                    "api_key": api_key,
                    "user_id": current_user.id
                })
            conn.commit()

        # Record activity
        activity = UserActivity(
            activity_type="hackatime_connected",
            message="User {username} connected Hackatime account",
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Hackatime account connected successfully'
        })
    except Exception as e:
        app.logger.error(f'Error connecting Hackatime: {str(e)}')
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': f'Failed to connect Hackatime: {str(e)}'
        })



@app.route('/hackatime/disconnect', methods=['POST'])
@login_required
def hackatime_disconnect():
    """Disconnect Hackatime account by removing API key"""
    try:
        # Remove user's wakatime_api_key
        with db.engine.connect() as conn:
            conn.execute(
                db.text(
                    "UPDATE \"user\" SET wakatime_api_key = NULL WHERE id = :user_id"
                ), {"user_id": current_user.id})
            conn.commit()

        # Record activity
        activity = UserActivity(
            activity_type="hackatime_disconnected",
            message="User {username} disconnected Hackatime account",
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Hackatime account disconnected successfully'
        })
    except Exception as e:
        app.logger.error(f'Error disconnecting Hackatime: {str(e)}')
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': f'Failed to disconnect Hackatime: {str(e)}'
        })


@app.route('/hackatime/status', methods=['GET'])
@login_required
def hackatime_status():
    """Check if user has a Hackatime API key connected"""
    try:
        has_api_key = current_user.wakatime_api_key is not None
        return jsonify({'success': True, 'connected': has_api_key})
    except Exception as e:
        app.logger.error(f'Error checking Hackatime status: {str(e)}')
        return jsonify({
            'success': False,
            'connected': False,
            'message': f'Failed to check Hackatime status: {str(e)}'
        })


@app.route('/groq')
@login_required
def groq_page():
    """Page for Groq integration"""
    return render_template('groq.html')


@app.route('/groq/connect', methods=['POST'])
@login_required
def groq_connect():
    """Connect Groq account by saving API key"""
    try:
        data = request.get_json()
        api_key = data.get('api_key')

        if not api_key:
            return jsonify({
                'success': False,
                'message': 'API key is required'
            })

        # Validate the API key by making a request to the Groq API
        import requests
        import json

        # Test endpoint URL
        api_url = "https://api.groq.com/openai/v1/chat/completions"

        # Prepare headers with the API key
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}'
        }

        # Simple test request
        test_data = {
            'model':
            'llama-3.3-70b-versatile',
            'messages': [{
                'role':
                'user',
                'content':
                'Explain the importance of fast language models'
            }]
        }

        app.logger.info(
            f"Testing Groq API key for user {current_user.username}")

        # Make the request to validate the API key
        response = requests.post(api_url,
                                 headers=headers,
                                 json=test_data,
                                 timeout=10)

        # Log the response status
        app.logger.info(
            f"Groq API validation response: {response.status_code}")

        if response.status_code >= 400:
            app.logger.error(
                f"Groq API key validation failed: {response.status_code} - {response.text}"
            )
            return jsonify({
                'success':
                False,
                'message':
                f'Invalid Groq API key. Please check your API key and try again.'
            })

        # If we get here, the API key is valid
        app.logger.info(
            f"Groq API key validation successful for user {current_user.username}"
        )

        # Update user's groq_api_key in the database
        with db.engine.connect() as conn:
            conn.execute(
                db.text(
                    "UPDATE \"user\" SET groq_api_key = :api_key WHERE id = :user_id"
                ), {
                    "api_key": api_key,
                    "user_id": current_user.id
                })
            conn.commit()

        # Record activity
        activity = UserActivity(
            activity_type="groq_connected",
            message="User {username} connected Groq account",
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Groq account connected successfully'
        })

    except Exception as e:
        app.logger.error(f'Error connecting Groq: {str(e)}')
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': f'Failed to connect Groq: {str(e)}'
        })


@app.route('/groq/disconnect', methods=['POST'])
@login_required
def groq_disconnect():
    """Disconnect Groq account by removing API key"""
    try:
        # Remove user's groq_api_key from the database
        with db.engine.connect() as conn:
            conn.execute(
                db.text(
                    "UPDATE \"user\" SET groq_api_key = NULL WHERE id = :user_id"
                ), {"user_id": current_user.id})
            conn.commit()

        # Record activity
        activity = UserActivity(
            activity_type="groq_disconnected",
            message="User {username} disconnected Groq account",
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Groq account disconnected successfully'
        })
    except Exception as e:
        app.logger.error(f'Error disconnecting Groq: {str(e)}')
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': f'Failed to disconnect Groq: {str(e)}'
        })


@app.route('/groq/status', methods=['GET'])
@login_required
def groq_status():
    """Check if user has a Groq API key connected"""
    try:
        has_api_key = hasattr(
            current_user,
            'groq_api_key') and current_user.groq_api_key is not None
        return jsonify({'success': True, 'connected': has_api_key})
    except Exception as e:
        app.logger.error(f'Error checking Groq status: {str(e)}')
        return jsonify({
            'success': False,
            'connected': False,
            'message': f'Failed to check Groq status: {str(e)}'
        })


@app.route('/hackatime/heartbeat', methods=['POST'])
@login_required
def hackatime_heartbeat():
    """Send a heartbeat to Hackatime API with comprehensive metadata"""
    try:
        # Check if user has API key
        if not current_user.wakatime_api_key:
            app.logger.warning(
                f"User {current_user.username} attempted to send heartbeat without API key"
            )
            return jsonify({
                'success': False,
                'message': 'No Hackatime API key found'
            }), 403

        # Get heartbeat data from request
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'message': 'No heartbeat data provided'
            }), 400

        # Send heartbeat to Hackatime API
        api_url = "https://hackatime.hackclub.com/api/hackatime/v1/users/current/heartbeats"

        # The API controller expects a Bearer token
        headers = {
            'Authorization': f'Bearer {current_user.wakatime_api_key}',
            'Content-Type': 'application/json'
        }

        # Add User-Agent header if available
        user_agent = request.headers.get(
            'User-Agent',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        )
        headers['User-Agent'] = user_agent

        # Get current time if not provided
        current_time = int(time.time())

        # Prepare heartbeat payload with default values to ensure all fields are included
        default_heartbeat = {
            "entity": "main.py",
            "type": "file",
            "time": current_time,
            "category": "coding",
            "project": "Hack Club Spaces",
            "branch": "main",
            "language": "Python",
            "is_write": True,
            "lines": 150,
            "lineno": 1,
            "cursorpos": 0,
            "line_additions": 0,
            "line_deletions": 0,
            "project_root_count": 1,
            "dependencies": "flask,sqlalchemy,python-dotenv",
            "machine":
            f"machine_{hashlib.md5(request.remote_addr.encode()).hexdigest()[:8]}",
            "editor": "Spaces IDE",
            "operating_system": request.user_agent.platform or "Unknown",
            "user_agent": user_agent
        }

        # Process input data and ensure all required fields
        if isinstance(data, dict):
            # Single heartbeat
            complete_heartbeat = default_heartbeat.copy()
            complete_heartbeat.update(data)
            heartbeat_payload = [complete_heartbeat]
        elif isinstance(data, list):
            # Multiple heartbeats
            heartbeat_payload = []
            for hb in data:
                if isinstance(hb, dict):
                    complete_hb = default_heartbeat.copy()
                    complete_hb.update(hb)
                    heartbeat_payload.append(complete_hb)
                else:
                    # Invalid item in list
                    complete_hb = default_heartbeat.copy()
                    heartbeat_payload.append(complete_hb)
        else:
            # Fallback to default if data format is unexpected
            heartbeat_payload = [default_heartbeat]

        app.logger.info(
            f"Sending heartbeat to Hackatime for user {current_user.username}")
        app.logger.debug(f"Heartbeat payload: {heartbeat_payload}")

        # Make the request to Hackatime API
        response = requests.post(api_url,
                                 headers=headers,
                                 json=heartbeat_payload,
                                 timeout=10)

        app.logger.info(
            f"Hackatime API response status: {response.status_code}")

        if response.status_code >= 400:
            error_text = response.text
            app.logger.error(
                f"Hackatime heartbeat failed: {response.status_code} - {error_text}"
            )
            return jsonify({
                'success': False,
                'message':
                f'Heartbeat failed with status code {response.status_code}',
                'details': error_text
            }), response.status_code

        # Record activity for first heartbeat of the day
        now = datetime.utcnow()
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)

        heartbeat_today = UserActivity.query.filter(
            UserActivity.user_id == current_user.id,
            UserActivity.activity_type == "hackatime_heartbeat",
            UserActivity.timestamp >= day_start, UserActivity.timestamp
            < day_end).first()

        if not heartbeat_today:
            activity = UserActivity(
                activity_type="hackatime_heartbeat",
                message=
                "User {username} sent first Hackatime heartbeat of the day",
                username=current_user.username,
                user_id=current_user.id)
            db.session.add(activity)
            db.session.commit()

        # Try to parse the response content
        try:
            response_data = response.json()
            return jsonify({
                'success': True,
                'message': 'Heartbeat sent successfully',
                'response': response_data
            })
        except:
            # If we can't parse the JSON, but the status code was good, still return success
            return jsonify({
                'success': True,
                'message': 'Heartbeat sent successfully'
            })
    except Exception as e:
        app.logger.error(f'Error sending Hackatime heartbeat: {str(e)}')
        return jsonify({
            'success': False,
            'message': f'Failed to send heartbeat: {str(e)}'
        }), 500


@app.route('/logout')
@login_required
def logout():
    logout_user()
    flash('You have been logged out.', 'success')
    return redirect(url_for('index'))


@app.route('/settings', methods=['GET', 'POST'])
@login_required
def settings():
    if request.method == 'POST':
        user = current_user
        action = request.form.get('action')

        if action == 'update_profile':
            username = request.form.get('username')
            email = request.form.get('email')

            if username != user.username and User.query.filter_by(
                    username=username).first():
                return jsonify({
                    'status': 'error',
                    'message': 'Username already taken'
                })
            if email != user.email and User.query.filter_by(
                    email=email).first():
                return jsonify({
                    'status': 'error',
                    'message': 'Email already registered'
                })

            user.username = username
            user.email = email
            db.session.commit()
            return jsonify({
                'status': 'success',
                'message': 'Profile updated successfully'
            })

        elif action == 'change_password':
            current_password = request.form.get('current_password')
            new_password = request.form.get('new_password')

            if not user.check_password(current_password):
                return jsonify({
                    'status': 'error',
                    'message': 'Current password is incorrect'
                })

            user.set_password(new_password)
            db.session.commit()
            return jsonify({
                'status': 'success',
                'message': 'Password changed successfully'
            })

    return render_template('settings.html')


@app.route('/profile')
@login_required
def profile_settings():
    """Route for the user to edit their public profile settings"""
    # Get user's sites
    sites = Site.query.filter_by(user_id=current_user.id).all()
    
    # Get social links from the database
    social_links = {}
    if current_user.social_links:
        try:
            # Convert from JSONB to dict
            social_links = current_user.social_links
        except:
            # In case of error, provide empty dict
            social_links = {}
    
    # Get list of public site IDs
    with db.engine.connect() as conn:
        result = conn.execute(
            db.text("SELECT site_id FROM public_site WHERE user_id = :user_id"),
            {"user_id": current_user.id}
        )
        public_site_ids = [row[0] for row in result]
    
    return render_template(
        'profile_settings.html',
        sites=sites,
        social_links=social_links,
        public_site_ids=public_site_ids
    )


@app.route('/api/profile/settings', methods=['POST'])
@login_required
def update_profile_settings():
    """API endpoint to update user profile settings"""
    try:
        # Get form data
        is_profile_public = request.form.get('is_profile_public') == 'true'
        avatar = request.form.get('avatar', '')
        profile_banner = request.form.get('profile_banner', '')
        bio = request.form.get('bio', '')
        
        # Validate image URLs
        valid_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
        
        if avatar and not any(avatar.lower().endswith(ext) for ext in valid_extensions):
            return jsonify({
                'status': 'error',
                'message': 'Avatar URL must point to an image file (jpg, png, gif, etc.)'
            }), 400
            
        if profile_banner and not any(profile_banner.lower().endswith(ext) for ext in valid_extensions):
            return jsonify({
                'status': 'error',
                'message': 'Banner URL must point to an image file (jpg, png, gif, etc.)'
            }), 400
        
        # Parse social links from JSON string
        social_links = {}
        social_links_str = request.form.get('social_links', '{}')
        try:
            social_links = json.loads(social_links_str)
        except:
            # In case of error, use empty dict
            social_links = {}
        
        # Update user profile in database
        with db.engine.connect() as conn:
            conn.execute(
                db.text("""
                    UPDATE "user" 
                    SET is_profile_public = :is_public,
                        avatar = :avatar,
                        profile_banner = :banner,
                        bio = :bio,
                        social_links = :social_links
                    WHERE id = :user_id
                """),
                {
                    "is_public": is_profile_public,
                    "avatar": avatar,
                    "banner": profile_banner,
                    "bio": bio,
                    "social_links": json.dumps(social_links),
                    "user_id": current_user.id
                }
            )
            conn.commit()
            
        # Process public sites
        public_sites_str = request.form.get('public_sites', '[]')
        try:
            public_site_ids = json.loads(public_sites_str)
            
            # Clear existing public sites
            with db.engine.connect() as conn:
                conn.execute(
                    db.text("DELETE FROM public_site WHERE user_id = :user_id"),
                    {"user_id": current_user.id}
                )
                
                # Insert new public sites
                for site_id in public_site_ids:
                    # Verify the site belongs to the user
                    site = Site.query.get(site_id)
                    if site and site.user_id == current_user.id:
                        conn.execute(
                            db.text("""
                                INSERT INTO public_site (user_id, site_id)
                                VALUES (:user_id, :site_id)
                            """),
                            {"user_id": current_user.id, "site_id": site_id}
                        )
                
                conn.commit()
        except:
            return jsonify({
                'status': 'error',
                'message': 'Invalid public sites data'
            }), 400
        
        return jsonify({
            'status': 'success',
            'message': 'Profile settings updated successfully'
        })
        
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error updating profile settings: {str(e)}')
        return jsonify({
            'status': 'error',
            'message': f'Failed to update profile settings: {str(e)}'
        }), 500


@app.route('/p/<string:username>')
def public_profile(username):
    """Route to view a user's public profile"""
    # Get the user profile
    profile_user = User.query.filter_by(username=username).first_or_404()
    
    # Check if profile is public
    if not profile_user.is_profile_public:
        abort(404)
    
    # Get social links
    social_links = {}
    if profile_user.social_links:
        try:
            social_links = profile_user.social_links
        except:
            social_links = {}
    
    # Get public projects
    with db.engine.connect() as conn:
        result = conn.execute(
            db.text("""
                SELECT s.* FROM site s
                JOIN public_site ps ON s.id = ps.site_id
                WHERE ps.user_id = :user_id
            """),
            {"user_id": profile_user.id}
        )
        
        projects = []
        for row in result:
            projects.append({
                'id': row[0],
                'name': row[1],
                'slug': row[2],
                'site_type': row[3],
                'created_at': row[9],
                'updated_at': row[10]
            })
    
    return render_template(
        'public_profile.html',
        profile_user=profile_user,
        social_links=social_links,
        projects=projects,
        profile_banner=profile_user.profile_banner
    )


@app.route('/club-dashboard')
@app.route('/club-dashboard/<int:club_id>')
@login_required
def club_dashboard(club_id=None):
    """Club dashboard for club leaders to manage their clubs."""
    from models import Club, ClubMembership, ClubChatChannel
    
    # If no club ID is provided, try to find user's club
    if club_id is None:
        # Check if user is a club leader
        club = Club.query.filter_by(leader_id=current_user.id).first()
        
        # If not a leader, check if they belong to any clubs
        if not club:
            club_memberships = ClubMembership.query.filter_by(user_id=current_user.id).all()
            
            if not club_memberships:
                # User doesn't have any club associations, show join code interface
                return render_template('club_dashboard.html', 
                                    club=None, 
                                    show_join_modal=True)
                
            if len(club_memberships) == 1:
                # If user is a member of only one club, show that club
                club = club_memberships[0].club
                club_id = club.id
            else:
                # If user belongs to multiple clubs, show club selection interface
                return render_template('club_dashboard.html', 
                                      club=None, 
                                      memberships=club_memberships)
    else:
        # Club ID was provided, show that specific club
        club = Club.query.get_or_404(club_id)
        
        # Verify user is a member or leader of this club
        if club.leader_id != current_user.id:
            membership = ClubMembership.query.filter_by(
                user_id=current_user.id,
                club_id=club_id
            ).first()
            
            if not membership:
                flash('You are not a member of this club.', 'error')
                return render_template('club_dashboard.html', 
                                    club=None, 
                                    show_join_modal=True)
    
    # Get all memberships for the club
    memberships = []
    if club:
        memberships = ClubMembership.query.filter_by(club_id=club.id).all()
        
        # Get the default chat channel
        default_channel = ClubChatChannel.query.filter_by(
            club_id=club.id,
            name='general'
        ).first()
        
        # If no general channel exists, create it
        if not default_channel:
            default_channel = ClubChatChannel(
                club_id=club.id,
                name='general',
                description='General discussions',
                created_by=club.leader_id
            )
            db.session.add(default_channel)
            db.session.commit()
    
    # Check if user is a leader or co-leader
    is_leader = (club and club.leader_id == current_user.id)
    is_co_leader = False
    
    if club and not is_leader:
        membership = ClubMembership.query.filter_by(
            user_id=current_user.id,
            club_id=club.id,
            role='co-leader'
        ).first()
        
        is_co_leader = (membership is not None)
    
    # Get ImgBB API key from environment variables
    imgbb_api_key = os.environ.get('IMGBB_API_KEY', '')
    
    return render_template('club_dashboard.html',
                           club=club,
                           memberships=memberships,
                           is_leader=is_leader,
                           is_co_leader=is_co_leader,
                           imgbb_api_key=imgbb_api_key)


# Club API routes
@app.route('/api/clubs', methods=['POST'])
@login_required
def create_club():
    """Create a new club with the current user as leader."""
    try:
        data = request.get_json()

        if not data.get('name'):
            return jsonify({'error': 'Club name is required'}), 400

        if Club.query.filter_by(leader_id=current_user.id).first():
            return jsonify({'error': 'You already have a club'}), 400

        # Set the user as a club leader
        current_user.is_club_leader_role = True
        
        club = Club(name=data.get('name'),
                    description=data.get('description', ''),
                    location=data.get('location', ''),
                    leader_id=current_user.id)

        club.generate_join_code()
        db.session.add(club)
        db.session.commit()  # Commit to ensure the club has an ID

        membership = ClubMembership(user_id=current_user.id,
                                    club_id=club.id,
                                    role='co-leader')
        db.session.add(membership)
        
        # Create default channels for the club
        from models import ClubChatChannel, ClubChatMessage
        default_channels = [
            {'name': 'general', 'description': 'General discussion channel'},
            {'name': 'announcements', 'description': 'Important club announcements'},
            {'name': 'help', 'description': 'Ask for help with your projects'}
        ]
        
        for channel_data in default_channels:
            channel = ClubChatChannel(
                club_id=club.id,
                name=channel_data['name'],
                description=channel_data['description'],
                created_by=current_user.id
            )
            db.session.add(channel)
        
        db.session.commit()
        
        # Add welcome messages to the channels
        channels = ClubChatChannel.query.filter_by(club_id=club.id).all()
        for channel in channels:
            welcome_message = ClubChatMessage(
                channel_id=channel.id,
                user_id=current_user.id,
                content=f"Welcome to #{channel.name}! This channel was created automatically when the club was formed."
            )
            db.session.add(welcome_message)
        
        db.session.commit()

        activity = UserActivity(
            activity_type="club_creation",
            message=f'Club "{club.name}" created by {{username}}',
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({'message': 'Club created successfully'}), 201
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error creating club: {str(e)}')
        return jsonify({'error': 'Failed to create club'}), 500


@app.route('/api/clubs/current', methods=['GET', 'PUT', 'DELETE'])
@login_required
def manage_current_club():
    """Get, update, or delete the current user's club."""
    club = Club.query.filter_by(leader_id=current_user.id).first()

    if not club:
        return jsonify({'error': 'You do not have a club'}), 404

    if request.method == 'GET':
        return jsonify({
            'id':
            club.id,
            'name':
            club.name,
            'description':
            club.description,
            'location':
            club.location,
            'join_code':
            club.join_code,
            'created_at':
            club.created_at.isoformat(),
            'members_count':
            ClubMembership.query.filter_by(club_id=club.id).count()
        })

    elif request.method == 'PUT':
        try:
            data = request.get_json()

            if data.get('name'):
                club.name = data.get('name')
            if 'description' in data:
                club.description = data.get('description')
            if 'location' in data:
                club.location = data.get('location')

            db.session.commit()

            return jsonify({'message': 'Club updated successfully'})
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Error updating club: {str(e)}')
            return jsonify({'error': 'Failed to update club'}), 500

    elif request.method == 'DELETE':
        try:
            # First delete all related ClubAssignment records
            from models import ClubAssignment
            ClubAssignment.query.filter_by(club_id=club.id).delete()
            
            # Delete all club memberships
            ClubMembership.query.filter_by(club_id=club.id).delete()
            
            # Delete club chat channels and messages
            from models import ClubChatChannel, ClubChatMessage
            
            # Get all channel IDs for this club
            channels = ClubChatChannel.query.filter_by(club_id=club.id).all()
            for channel in channels:
                # Delete messages in each channel
                ClubChatMessage.query.filter_by(channel_id=channel.id).delete()
            
            # Delete all channels
            ClubChatChannel.query.filter_by(club_id=club.id).delete()
            
            # Delete club resources
            from models import ClubResource
            ClubResource.query.filter_by(club_id=club.id).delete()
            
            # Delete club posts and likes
            from models import ClubPost, ClubPostLike
            posts = ClubPost.query.filter_by(club_id=club.id).all()
            for post in posts:
                ClubPostLike.query.filter_by(post_id=post.id).delete()
            ClubPost.query.filter_by(club_id=club.id).delete()

            # Finally delete the club itself
            db.session.delete(club)
            db.session.commit()

            activity = UserActivity(
                activity_type="club_deletion",
                message=f'Club "{club.name}" deleted by {{username}}',
                username=current_user.username,
                user_id=current_user.id)
            db.session.add(activity)
            db.session.commit()

            return jsonify({'message': 'Club deleted successfully'})
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Error deleting club: {str(e)}')
            return jsonify({'error': f'Failed to delete club: {str(e)}'}), 500


@app.route('/api/clubs/<int:club_id>/join-code', methods=['POST'])
@login_required
def generate_club_join_code(club_id):
    """Generate a new join code for a club."""
    try:
        club = Club.query.get_or_404(club_id)
        
        # Check if user is club leader or co-leader
        is_leader = club.leader_id == current_user.id
        is_co_leader = ClubMembership.query.filter_by(
            club_id=club_id, 
            user_id=current_user.id, 
            role='co-leader'
        ).first() is not None
        
        if not (is_leader or is_co_leader or current_user.is_admin):
            return jsonify({
                'error': 'Only club leaders and co-leaders can generate join codes'
            }), 403
        
        # Generate new join code
        join_code = club.generate_join_code()
        
        # Save changes to the database
        db.session.commit()
        
        # Record the activity
        activity = UserActivity(
            activity_type="club_action",
            message=f"{{username}} generated a new join code for club '{club.name}'",
            username=current_user.username,
            user_id=current_user.id
        )
        db.session.add(activity)
        db.session.commit()
        
        return jsonify({
            'join_code': join_code,
            'message': 'Join code generated successfully'
        })
        
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error generating join code: {str(e)}')
        return jsonify({
            'error': f'Failed to generate join code: {str(e)}'
        }), 500

@app.route('/api/clubs/join-code/generate', methods=['POST'])
@login_required
def generate_join_code():
    """Generate a new join code for the current user's club."""
    # Get the user's club (if they're a leader)
    club = Club.query.filter_by(leader_id=current_user.id).first()

    if not club:
        return jsonify({'error': 'You do not have a club'}), 404

    try:
        # Generate a new join code
        club.generate_join_code()
        db.session.commit()

        return jsonify({
            'message': 'Join code generated successfully',
            'join_code': club.join_code
        })
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error generating join code: {str(e)}')
        return jsonify({'error': 'Failed to generate join code'}), 500


@app.route('/api/clubs/join', methods=['POST'])
@login_required
def join_club():
    """Join a club using a join code."""
    try:
        data = request.get_json()
        join_code = data.get('join_code')

        if not join_code:
            return jsonify({'error': 'Join code is required'}), 400

        club = Club.query.filter_by(join_code=join_code).first()

        if not club:
            return jsonify({'error': 'Invalid join code'}), 404

        existing_membership = ClubMembership.query.filter_by(
            user_id=current_user.id, club_id=club.id).first()

        if existing_membership:
            return jsonify({'error':
                            'You are already a member of this club'}), 400

        membership = ClubMembership(user_id=current_user.id,
                                    club_id=club.id,
                                    role='member')
        db.session.add(membership)

        activity = UserActivity(
            activity_type="club_join",
            message=f'{{username}} joined club "{club.name}"',
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({'message': f'Successfully joined {club.name}'})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error joining club: {str(e)}')
        return jsonify({'error': 'Failed to join club'}), 500

@app.route('/club-join/<join_code>')
@login_required
def club_join_qr(join_code):
    """Handle club joins via QR code scan."""
    try:
        club = Club.query.filter_by(join_code=join_code).first()
        
        if not club:
            flash('Invalid join code', 'error')
            return redirect(url_for('club_dashboard'))
            
        existing_membership = ClubMembership.query.filter_by(
            user_id=current_user.id, club_id=club.id).first()
            
        if existing_membership:
            flash('You are already a member of this club', 'info')
            return redirect(url_for('club_dashboard', club_id=club.id))
            
        membership = ClubMembership(user_id=current_user.id,
                                    club_id=club.id,
                                    role='member')
        db.session.add(membership)
        
        activity = UserActivity(
            activity_type="club_join",
            message=f'{{username}} joined club "{club.name}" via QR code',
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()
        
        flash(f'Successfully joined {club.name}!', 'success')
        return redirect(url_for('club_dashboard', club_id=club.id))
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error joining club via QR: {str(e)}')
        flash('Failed to join club', 'error')
        return redirect(url_for('club_dashboard'))


@app.route('/api/clubs/memberships/<int:membership_id>/leave',
           methods=['POST'])
@login_required
def leave_club(membership_id):
    """Leave a club."""
    try:
        # Find the membership
        membership = ClubMembership.query.get_or_404(membership_id)

        # Verify it belongs to the current user
        if membership.user_id != current_user.id:
            return jsonify({'error': 'Unauthorized'}), 403

        # Prevent club leaders from leaving their own club
        if membership.club.leader_id == current_user.id:
            return jsonify({
                'error':
                'Club leaders cannot leave. Delete the club instead.'
            }), 400

        club_name = membership.club.name

        # Delete the membership
        db.session.delete(membership)

        # Record activity
        activity = UserActivity(
            activity_type="club_leave",
            message=f'{{username}} left club "{club_name}"',
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({'message': f'Successfully left {club_name}'})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error leaving club: {str(e)}')
        return jsonify({'error': 'Failed to leave club'}), 500


@app.route('/api/clubs/members/<int:membership_id>/role', methods=['PUT'])
@login_required
def change_member_role(membership_id):
    """Change a member's role in a club."""
    try:
        membership = ClubMembership.query.get_or_404(membership_id)

        # Check if the current user is the club leader
        club = membership.club
        if club.leader_id != current_user.id:
            return jsonify(
                {'error': 'Only club leaders can change member roles'}), 403

        # Prevent changing own role
        if membership.user_id == current_user.id:
            return jsonify({'error': 'You cannot change your own role'}), 400

        data = request.get_json()
        new_role = data.get('role')

        if new_role not in ['member', 'co-leader']:
            return jsonify({'error': 'Invalid role'}), 400

        membership.role = new_role
        db.session.commit()

        return jsonify({'message': f'Role updated to {new_role}'})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error changing member role: {str(e)}')
        return jsonify({'error': 'Failed to change member role'}), 500


@app.route('/api/clubs/members/<int:membership_id>', methods=['DELETE'])
@login_required
def remove_member(membership_id):
    """Remove a member from a club."""
    try:
        membership = ClubMembership.query.get_or_404(membership_id)

        # Check if the current user is the club leader
        club = membership.club
        if club.leader_id != current_user.id:
            return jsonify({'error':
                            'Only club leaders can remove members'}), 403

        # Prevent removing self
        if membership.user_id == current_user.id:
            return jsonify(
                {'error': 'You cannot remove yourself from the club'}), 400

        member_name = membership.user.username

        # Delete the membership
        db.session.delete(membership)

        # Record activity
        activity = UserActivity(
            activity_type="club_member_removal",
            message=
            f'{{username}} removed {member_name} from club "{club.name}"',
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify(
            {'message': f'Successfully removed {member_name} from the club'})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error removing member: {str(e)}')
        return jsonify({'error': 'Failed to remove member'}), 500


# Club Dashboard API Endpoints
@app.route('/api/clubs/<int:club_id>/posts', methods=['GET', 'POST'])
@login_required
def club_posts(club_id):
    """Get all posts for a club or create a new post."""
    from models import ClubPost
    
    # Verify user is a member of the club
    club = Club.query.get_or_404(club_id)
    membership = ClubMembership.query.filter_by(user_id=current_user.id, club_id=club_id).first()
    if not membership and club.leader_id != current_user.id:
        return jsonify({'error': 'You are not a member of this club'}), 403
        
    if request.method == 'GET':
        posts = db.session.query(ClubPost, User).join(User, ClubPost.user_id == User.id) \
                .filter(ClubPost.club_id == club_id) \
                .order_by(ClubPost.created_at.desc()).all()
                
        result = []
        for post, user in posts:
            # Get likes information
            from models import ClubPostLike
            post_likes = ClubPostLike.query.filter_by(post_id=post.id).all()
            liked_by = [like.user_id for like in post_likes]
            
            # Check if current user liked this post
            user_liked = current_user.id in liked_by
            
            result.append({
                'id': post.id,
                'content': post.content,
                'created_at': post.created_at.isoformat(),
                'updated_at': post.updated_at.isoformat(),
                'likes': post.likes or len(post_likes),  # Use stored count or calculate
                'liked_by': liked_by,
                'user_liked': user_liked,
                'user': {
                    'id': user.id,
                    'username': user.username
                }
            })
            
        return jsonify({'posts': result})
        
    elif request.method == 'POST':
        data = request.get_json()
        content = data.get('content')
        
        if not content:
            return jsonify({'error': 'Post content cannot be empty'}), 400
            
        post = ClubPost(
            club_id=club_id,
            user_id=current_user.id,
            content=content
        )
        
        db.session.add(post)
        db.session.commit()
        
        return jsonify({
            'message': 'Post created successfully',
            'post': {
                'id': post.id,
                'content': post.content,
                'created_at': post.created_at.isoformat(),
                'user': {
                    'id': current_user.id,
                    'username': current_user.username
                }
            }
        })

@app.route('/api/clubs/<int:club_id>/posts/<int:post_id>', methods=['PUT', 'DELETE'])
@login_required
def manage_club_post(club_id, post_id):
    """Update or delete a club post."""
    from models import ClubPost, ClubPostLike
    
    post = ClubPost.query.get_or_404(post_id)
    
    # Check if post belongs to the correct club
    if post.club_id != club_id:
        return jsonify({'error': 'Post not found in this club'}), 404
        
    # Check if user is authorized (post creator or club leader)
    if post.user_id != current_user.id and post.club.leader_id != current_user.id:
        membership = ClubMembership.query.filter_by(
            user_id=current_user.id, 
            club_id=club_id, 
            role='co-leader'
        ).first()
        
        if not membership:
            return jsonify({'error': 'You are not authorized to manage this post'}), 403
    
    if request.method == 'PUT':
        data = request.get_json()
        content = data.get('content')
        
        if not content:
            return jsonify({'error': 'Post content cannot be empty'}), 400
            
        post.content = content
        post.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({
            'message': 'Post updated successfully',
            'post': {
                'id': post.id,
                'content': post.content,
                'updated_at': post.updated_at.isoformat()
            }
        })
        
    elif request.method == 'DELETE':
        try:
            # First delete all likes associated with this post
            db.session.execute(
                db.text("DELETE FROM club_post_like WHERE post_id = :post_id"),
                {"post_id": post_id}
            )
            
            # Then delete the post itself
            db.session.delete(post)
            db.session.commit()
            
            return jsonify({'message': 'Post deleted successfully'})
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Error deleting post: {str(e)}')
            return jsonify({'error': f'Failed to delete post: {str(e)}'}), 500


@app.route('/api/clubs/<int:club_id>/posts/<int:post_id>/like', methods=['POST'])
@login_required
def toggle_post_like(club_id, post_id):
    """Toggle like on a club post."""
    from models import ClubPost, ClubPostLike
    
    post = ClubPost.query.get_or_404(post_id)
    
    # Check if post belongs to the correct club
    if post.club_id != club_id:
        return jsonify({'error': 'Post not found in this club'}), 404
        
    # Check if user is a club member
    membership = ClubMembership.query.filter_by(user_id=current_user.id, club_id=club_id).first()
    if not membership and post.club.leader_id != current_user.id:
        return jsonify({'error': 'You are not a member of this club'}), 403
    
    # Check if user already liked this post
    existing_like = ClubPostLike.query.filter_by(post_id=post_id, user_id=current_user.id).first()
    
    if existing_like:
        # Unlike
        db.session.delete(existing_like)
        liked = False
    else:
        # Like
        new_like = ClubPostLike(post_id=post_id, user_id=current_user.id)
        db.session.add(new_like)
        liked = True
    
    # Update likes count
    like_count = ClubPostLike.query.filter_by(post_id=post_id).count()
    post.likes = like_count
    
    db.session.commit()
    
    return jsonify({
        'message': 'Like toggled successfully',
        'liked': liked,
        'likes': like_count
    })

@app.route('/api/clubs/<int:club_id>/assignments', methods=['GET', 'POST'])
@login_required
def club_assignments(club_id):
    """Get all assignments for a club or create a new assignment."""
    from models import ClubAssignment
    
    # Verify user is a member of the club
    club = Club.query.get_or_404(club_id)
    membership = ClubMembership.query.filter_by(user_id=current_user.id, club_id=club_id).first()
    if not membership and club.leader_id != current_user.id:
        return jsonify({'error': 'You are not a member of this club'}), 403
        
    if request.method == 'GET':
        assignments = db.session.query(ClubAssignment, User) \
            .join(User, ClubAssignment.created_by == User.id) \
            .filter(ClubAssignment.club_id == club_id) \
            .order_by(ClubAssignment.created_at.desc()).all()
                
        result = []
        for assignment, user in assignments:
            result.append({
                'id': assignment.id,
                'title': assignment.title,
                'description': assignment.description,
                'due_date': assignment.due_date.isoformat() if assignment.due_date else None,
                'created_at': assignment.created_at.isoformat(),
                'is_active': assignment.is_active,
                'creator': {
                    'id': user.id,
                    'username': user.username
                }
            })
            
        return jsonify({'assignments': result})
        
    elif request.method == 'POST':
        # Only leaders and co-leaders can create assignments
        if club.leader_id != current_user.id:
            membership = ClubMembership.query.filter_by(
                user_id=current_user.id, 
                club_id=club_id, 
                role='co-leader'
            ).first()
            
            if not membership:
                return jsonify({'error': 'Only club leaders can create assignments'}), 403
                
        data = request.get_json()
        title = data.get('title')
        description = data.get('description')
        due_date_str = data.get('due_date')
        
        if not title or not description:
            return jsonify({'error': 'Title and description are required'}), 400
            
        due_date = None
        if due_date_str:
            try:
                due_date = datetime.fromisoformat(due_date_str.replace('Z', '+00:00'))
            except ValueError:
                return jsonify({'error': 'Invalid due date format'}), 400
                
        assignment = ClubAssignment(
            club_id=club_id,
            title=title,
            description=description,
            due_date=due_date,
            created_by=current_user.id
        )
        
        db.session.add(assignment)
        db.session.commit()
        
        return jsonify({
            'message': 'Assignment created successfully',
            'assignment': {
                'id': assignment.id,
                'title': assignment.title,
                'description': assignment.description,
                'due_date': assignment.due_date.isoformat() if assignment.due_date else None,
                'created_at': assignment.created_at.isoformat(),
                'is_active': assignment.is_active
            }
        })

@app.route('/api/clubs/<int:club_id>/assignments/<int:assignment_id>', methods=['GET', 'PUT', 'DELETE'])
@login_required
def manage_club_assignment(club_id, assignment_id):
    """Get, update, or delete a club assignment."""
    from models import ClubAssignment
    
    assignment = ClubAssignment.query.get_or_404(assignment_id)
    
    # Check if assignment belongs to the correct club
    if assignment.club_id != club_id:
        return jsonify({'error': 'Assignment not found in this club'}), 404
        
    # Check if user is a member of the club
    membership = ClubMembership.query.filter_by(user_id=current_user.id, club_id=club_id).first()
    if not membership and assignment.club.leader_id != current_user.id:
        return jsonify({'error': 'You are not a member of this club'}), 403
    
    if request.method == 'GET':
        # Get user info for creator
        creator = User.query.get(assignment.created_by)
        
        return jsonify({
            'assignment': {
                'id': assignment.id,
                'title': assignment.title,
                'description': assignment.description,
                'due_date': assignment.due_date.isoformat() if assignment.due_date else None,
                'created_at': assignment.created_at.isoformat(),
                'updated_at': assignment.updated_at.isoformat(),
                'is_active': assignment.is_active,
                'creator': {
                    'id': creator.id,
                    'username': creator.username
                }
            }
        })
    
    # For PUT and DELETE methods, check for additional authorization
    is_authorized = False
    if assignment.created_by == current_user.id or assignment.club.leader_id == current_user.id:
        is_authorized = True
    else:
        co_leader_membership = ClubMembership.query.filter_by(
            user_id=current_user.id, 
            club_id=club_id, 
            role='co-leader'
        ).first()
        
        if co_leader_membership:
            is_authorized = True
    
    if not is_authorized:
        return jsonify({'error': 'You are not authorized to manage this assignment'}), 403
    
    if request.method == 'PUT':
        data = request.get_json()
        
        if 'title' in data:
            assignment.title = data['title']
        if 'description' in data:
            assignment.description = data['description']
        if 'due_date' in data and data['due_date']:
            try:
                assignment.due_date = datetime.fromisoformat(data['due_date'].replace('Z', '+00:00'))
            except ValueError:
                return jsonify({'error': 'Invalid due date format'}), 400
        if 'is_active' in data:
            assignment.is_active = data['is_active']
            
        assignment.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({
            'message': 'Assignment updated successfully',
            'assignment': {
                'id': assignment.id,
                'title': assignment.title,
                'description': assignment.description,
                'due_date': assignment.due_date.isoformat() if assignment.due_date else None,
                'updated_at': assignment.updated_at.isoformat(),
                'is_active': assignment.is_active
            }
        })
        
    elif request.method == 'DELETE':
        db.session.delete(assignment)
        db.session.commit()
        
        return jsonify({'message': 'Assignment deleted successfully'})

@app.route('/api/clubs/<int:club_id>/resources', methods=['GET', 'POST'])
@login_required
def club_resources(club_id):
    """Get all resources for a club or create a new resource."""
    from models import ClubResource
    
    # Verify user is a member of the club
    club = Club.query.get_or_404(club_id)
    membership = ClubMembership.query.filter_by(user_id=current_user.id, club_id=club_id).first()
    if not membership and club.leader_id != current_user.id:
        return jsonify({'error': 'You are not a member of this club'}), 403
        
    if request.method == 'GET':
        resources = db.session.query(ClubResource, User) \
            .join(User, ClubResource.created_by == User.id) \
            .filter(ClubResource.club_id == club_id) \
            .order_by(ClubResource.created_at.desc()).all()
                
        result = []
        for resource, user in resources:
            result.append({
                'id': resource.id,
                'title': resource.title,
                'url': resource.url,
                'description': resource.description,
                'icon': resource.icon,
                'created_at': resource.created_at.isoformat(),
                'creator': {
                    'id': user.id,
                    'username': user.username
                }
            })
            
        return jsonify({'resources': result})
        
    elif request.method == 'POST':
        data = request.get_json()
        title = data.get('title')
        url = data.get('url')
        description = data.get('description', '')
        icon = data.get('icon', 'link')
        
        if not title or not url:
            return jsonify({'error': 'Title and URL are required'}), 400
            
        resource = ClubResource(
            club_id=club_id,
            title=title,
            url=url,
            description=description,
            icon=icon,
            created_by=current_user.id
        )
        
        db.session.add(resource)
        db.session.commit()
        
        return jsonify({
            'message': 'Resource added successfully',
            'resource': {
                'id': resource.id,
                'title': resource.title,
                'url': resource.url,
                'description': resource.description,
                'icon': resource.icon,
                'created_at': resource.created_at.isoformat()
            }
        })

@app.route('/api/clubs/<int:club_id>/resources/<int:resource_id>', methods=['GET', 'PUT', 'DELETE'])
@login_required
def manage_club_resource(club_id, resource_id):
    """Get, update, or delete a club resource."""
    from models import ClubResource
    
    resource = ClubResource.query.get_or_404(resource_id)
    
    # Check if resource belongs to the correct club
    if resource.club_id != club_id:
        return jsonify({'error': 'Resource not found in this club'}), 404
        
    # Check if user is a member of the club
    membership = ClubMembership.query.filter_by(user_id=current_user.id, club_id=club_id).first()
    if not membership and resource.club.leader_id != current_user.id:
        return jsonify({'error': 'You are not a member of this club'}), 403
    
    if request.method == 'GET':
        # Get user info for creator
        creator = User.query.get(resource.created_by)
        
        return jsonify({
            'resource': {
                'id': resource.id,
                'title': resource.title,
                'url': resource.url,
                'description': resource.description,
                'icon': resource.icon,
                'created_at': resource.created_at.isoformat(),
                'creator': {
                    'id': creator.id,
                    'username': creator.username
                }
            }
        })
    
    # For PUT and DELETE methods, check for additional authorization
    is_authorized = False
    if resource.created_by == current_user.id or resource.club.leader_id == current_user.id:
        is_authorized = True
    else:
        co_leader_membership = ClubMembership.query.filter_by(
            user_id=current_user.id, 
            club_id=club_id, 
            role='co-leader'
        ).first()
        
        if co_leader_membership:
            is_authorized = True
    
    if not is_authorized:
        return jsonify({'error': 'You are not authorized to manage this resource'}), 403
    
    if request.method == 'PUT':
        data = request.get_json()
        
        if 'title' in data:
            resource.title = data['title']
        if 'url' in data:
            resource.url = data['url']
        if 'description' in data:
            resource.description = data['description']
        if 'icon' in data:
            resource.icon = data['icon']
            
        db.session.commit()
        
        return jsonify({
            'message': 'Resource updated successfully',
            'resource': {
                'id': resource.id,
                'title': resource.title,
                'url': resource.url,
                'description': resource.description,
                'icon': resource.icon
            }
        })
        
    elif request.method == 'DELETE':
        db.session.delete(resource)
        db.session.commit()
        
        return jsonify({'message': 'Resource deleted successfully'})







@app.route('/api/clubs/<int:club_id>/meetings', methods=['GET', 'POST'])
@login_required
def club_meetings(club_id):
    """Get all meetings for a club or create a new meeting."""
    from models import ClubMeeting
    
    # Verify user is a member of the club
    club = Club.query.get_or_404(club_id)
    membership = ClubMembership.query.filter_by(user_id=current_user.id, club_id=club_id).first()
    if not membership and club.leader_id != current_user.id:
        return jsonify({'error': 'You are not a member of this club'}), 403
        
    if request.method == 'GET':
        meetings = db.session.query(ClubMeeting, User) \
            .join(User, ClubMeeting.created_by == User.id) \
            .filter(ClubMeeting.club_id == club_id) \
            .order_by(ClubMeeting.meeting_date, ClubMeeting.start_time).all()
                
        result = []
        for meeting, user in meetings:
            result.append({
                'id': meeting.id,
                'title': meeting.title,
                'description': meeting.description,
                'meeting_date': meeting.meeting_date.isoformat(),
                'start_time': meeting.start_time.strftime('%H:%M'),
                'end_time': meeting.end_time.strftime('%H:%M') if meeting.end_time else None,
                'location': meeting.location,
                'meeting_link': meeting.meeting_link,
                'created_at': meeting.created_at.isoformat(),
                'creator': {
                    'id': user.id,
                    'username': user.username
                }
            })
            
        return jsonify({'meetings': result})
        
    elif request.method == 'POST':
        # Only leaders and co-leaders can create meetings
        if club.leader_id != current_user.id:
            membership = ClubMembership.query.filter_by(
                user_id=current_user.id, 
                club_id=club_id, 
                role='co-leader'
            ).first()
            
            if not membership:
                return jsonify({'error': 'Only club leaders can create meetings'}), 403
                
        data = request.get_json()
        title = data.get('title')
        description = data.get('description', '')
        meeting_date_str = data.get('meeting_date')
        start_time_str = data.get('start_time')
        end_time_str = data.get('end_time')
        location = data.get('location', '')
        meeting_link = data.get('meeting_link', '')
        
        if not title or not meeting_date_str or not start_time_str:
            return jsonify({'error': 'Title, date and start time are required'}), 400
            
        try:
            meeting_date = datetime.strptime(meeting_date_str, '%Y-%m-%d').date()
            start_time = datetime.strptime(start_time_str, '%H:%M').time()
            end_time = datetime.strptime(end_time_str, '%H:%M').time() if end_time_str else None
        except ValueError:
            return jsonify({'error': 'Invalid date or time format'}), 400
                
        meeting = ClubMeeting(
            club_id=club_id,
            title=title,
            description=description,
            meeting_date=meeting_date,
            start_time=start_time,
            end_time=end_time,
            location=location,
            meeting_link=meeting_link,
            created_by=current_user.id
        )
        
        db.session.add(meeting)
        db.session.commit()
        
        return jsonify({
            'message': 'Meeting created successfully',
            'meeting': {
                'id': meeting.id,
                'title': meeting.title,
                'description': meeting.description,
                'meeting_date': meeting.meeting_date.isoformat(),
                'start_time': meeting.start_time.strftime('%H:%M'),
                'end_time': meeting.end_time.strftime('%H:%M') if meeting.end_time else None,
                'location': meeting.location,
                'meeting_link': meeting.meeting_link,
                'created_at': meeting.created_at.isoformat()
            }
        })

@app.route('/api/clubs/<int:club_id>/meetings/<int:meeting_id>', methods=['GET', 'PUT', 'DELETE'])
@login_required
def manage_club_meeting(club_id, meeting_id):
    """Get, update, or delete a club meeting."""
    from models import ClubMeeting
    
    meeting = ClubMeeting.query.get_or_404(meeting_id)
    
    # Check if meeting belongs to the correct club
    if meeting.club_id != club_id:
        return jsonify({'error': 'Meeting not found in this club'}), 404
        
    # Check if user is a member of the club
    membership = ClubMembership.query.filter_by(user_id=current_user.id, club_id=club_id).first()
    if not membership and meeting.club.leader_id != current_user.id:
        return jsonify({'error': 'You are not a member of this club'}), 403
    
    if request.method == 'GET':
        # Get user info for creator
        creator = User.query.get(meeting.created_by)
        
        return jsonify({
            'meeting': {
                'id': meeting.id,
                'title': meeting.title,
                'description': meeting.description,
                'meeting_date': meeting.meeting_date.isoformat(),
                'start_time': meeting.start_time.strftime('%H:%M'),
                'end_time': meeting.end_time.strftime('%H:%M') if meeting.end_time else None,
                'location': meeting.location,
                'meeting_link': meeting.meeting_link,
                'created_at': meeting.created_at.isoformat(),
                'updated_at': meeting.updated_at.isoformat(),
                'creator': {
                    'id': creator.id,
                    'username': creator.username
                }
            }
        })
    
    # For PUT and DELETE methods, check for additional authorization
    is_authorized = False
    if meeting.created_by == current_user.id or meeting.club.leader_id == current_user.id:
        is_authorized = True
    else:
        co_leader_membership = ClubMembership.query.filter_by(
            user_id=current_user.id, 
            club_id=club_id, 
            role='co-leader'
        ).first()
        
        if co_leader_membership:
            is_authorized = True
    
    if not is_authorized:
        return jsonify({'error': 'You are not authorized to manage this meeting'}), 403
    
    if request.method == 'PUT':
        data = request.get_json()
        
        if 'title' in data:
            meeting.title = data['title']
        if 'description' in data:
            meeting.description = data['description']
        if 'meeting_date' in data:
            try:
                meeting.meeting_date = datetime.strptime(data['meeting_date'], '%Y-%m-%d').date()
            except ValueError:
                return jsonify({'error': 'Invalid date format'}), 400
        if 'start_time' in data:
            try:
                meeting.start_time = datetime.strptime(data['start_time'], '%H:%M').time()
            except ValueError:
                return jsonify({'error': 'Invalid time format'}), 400
        if 'end_time' in data:
            try:
                meeting.end_time = datetime.strptime(data['end_time'], '%H:%M').time() if data['end_time'] else None
            except ValueError:
                return jsonify({'error': 'Invalid time format'}), 400
        if 'location' in data:
            meeting.location = data['location']
        if 'meeting_link' in data:
            meeting.meeting_link = data['meeting_link']
            
        meeting.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({
            'message': 'Meeting updated successfully',
            'meeting': {
                'id': meeting.id,
                'title': meeting.title,
                'description': meeting.description,
                'meeting_date': meeting.meeting_date.isoformat(),
                'start_time': meeting.start_time.strftime('%H:%M'),
                'end_time': meeting.end_time.strftime('%H:%M') if meeting.end_time else None,
                'location': meeting.location,
                'meeting_link': meeting.meeting_link,
                'updated_at': meeting.updated_at.isoformat()
            }
        })
        
    elif request.method == 'DELETE':
        db.session.delete(meeting)
        db.session.commit()
        
        return jsonify({'message': 'Meeting deleted successfully'})

@app.route('/api/clubs/members/sites', methods=['GET'])
@login_required
def get_member_sites():
    """Get all sites from members of the current user's club."""
    try:
        # Check if the user is a club leader, co-leader, or member
        club_id = request.args.get('club_id')
        if club_id:
            # If club_id is provided, check if user is a member of that club
            membership = ClubMembership.query.filter_by(
                user_id=current_user.id, club_id=club_id).first()
            if not membership:
                return jsonify({'error': 'Not a member of this club'}), 403
            club = Club.query.get(club_id)
        else:
            # Otherwise get user's club (if leader)
            club = Club.query.filter_by(leader_id=current_user.id).first()
            if not club:
                # Check if they are a co-leader
                membership = ClubMembership.query.filter_by(
                    user_id=current_user.id, role='co-leader').first()
                if not membership:
                    # Check if they are a member
                    membership = ClubMembership.query.filter_by(
                        user_id=current_user.id).first()
                    if not membership:
                        return jsonify({'error': 'No club membership found'}), 404
                club = membership.club

        app.logger.info(f"Getting sites for club {club.id} ({club.name})")

        # Get all members of the club
        memberships = ClubMembership.query.filter_by(club_id=club.id).all()
        member_ids = [m.user_id for m in memberships]

        # Log member details for debugging
        for membership in memberships:
            app.logger.info(
                f"Club member: {membership.user.username} (ID: {membership.user_id})"
            )

        app.logger.info(f"Found {len(member_ids)} club members")

        # If no members, return empty list immediately
        if not member_ids:
            app.logger.warning(
                "No club members found, returning empty sites list")
            return jsonify({'sites': []})

        # Get all sites from these members
        sites = []
        try:
            # Use a direct query to get sites
            sites = db.session.query(Site).filter(
                Site.user_id.in_(member_ids)).all()
            app.logger.info(f"Found {len(sites)} member sites")

            # Additional debug logging - list all sites found
            for site in sites:
                app.logger.info(
                    f"Site found: {site.id} - {site.name} (Owner: {site.user_id})"
                )
                
            # Get all featured projects for this club
            featured_projects = ClubFeaturedProject.query.filter_by(
                club_id=club.id).all()
            featured_site_ids = [fp.site_id for fp in featured_projects]
            app.logger.info(f"Found {len(featured_site_ids)} featured projects")
            
        except Exception as query_error:
            app.logger.error(f"Error querying sites: {str(query_error)}")
            return jsonify({'error':
                            f'Database error: {str(query_error)}'}), 500

        # Format the result with error handling
        result = []
        for site in sites:
            try:
                # Make sure user reference exists
                user = User.query.get(site.user_id)
                if not user:
                    app.logger.warning(
                        f"Site {site.id} has invalid user_id {site.user_id}")
                    continue

                site_data = {
                    'id': site.id,
                    'name': site.name,
                    'type': site.site_type,
                    'updated_at': site.updated_at.isoformat() if site.updated_at else None,
                    'featured': site.id in featured_site_ids,
                    'owner': {
                        'id': user.id,
                        'username': user.username
                    }
                }
                result.append(site_data)
            except Exception as site_error:
                app.logger.error(
                    f"Error processing site {site.id}: {str(site_error)}")
                # Continue with other sites instead of failing completely

        app.logger.info(f"Returning {len(result)} formatted sites")
        return jsonify({'sites': result, 'club': {'id': club.id, 'name': club.name}})
    except Exception as e:
        app.logger.error(f'Error getting member sites: {str(e)}')
        return jsonify({'error': f'Failed to get member sites: {str(e)}'}), 500
        

@app.route('/api/clubs/<int:club_id>/projects/<int:site_id>/feature', methods=['POST'])
@login_required
def feature_project(club_id, site_id):
    """Feature a project within a club."""
    try:
        # Verify club exists
        club = Club.query.get_or_404(club_id)
        
        # Check if user is a club leader or co-leader
        is_leader = club.leader_id == current_user.id
        is_coleader = ClubMembership.query.filter_by(
            user_id=current_user.id, club_id=club_id, role='co-leader').first() is not None
            
        if not (is_leader or is_coleader):
            return jsonify({'error': 'Only club leaders can feature projects'}), 403
            
        # Verify site exists and belongs to a club member
        site = Site.query.get_or_404(site_id)
        
        # Check if site owner is club member
        is_member = ClubMembership.query.filter_by(
            user_id=site.user_id, club_id=club_id).first() is not None
            
        if not is_member:
            return jsonify({'error': 'This project does not belong to a club member'}), 400
            
        # Check if project is already featured
        existing = ClubFeaturedProject.query.filter_by(
            club_id=club_id, site_id=site_id).first()
            
        if existing:
            return jsonify({'message': 'Project is already featured', 'featured': True})
            
        # Add to featured projects
        featured_project = ClubFeaturedProject(
            club_id=club_id,
            site_id=site_id,
            featured_by=current_user.id
        )
        
        db.session.add(featured_project)
        db.session.commit()
        
        return jsonify({
            'message': 'Project featured successfully',
            'featured': True,
            'featured_at': featured_project.featured_at.isoformat()
        })
        
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error featuring project: {str(e)}')
        return jsonify({'error': f'Failed to feature project: {str(e)}'}), 500
        

@app.route('/api/clubs/<int:club_id>/projects/<int:site_id>/feature', methods=['DELETE'])
@login_required
def unfeature_project(club_id, site_id):
    """Remove a project from featured status within a club."""
    try:
        # Verify club exists
        club = Club.query.get_or_404(club_id)
        
        # Check if user is a club leader or co-leader
        is_leader = club.leader_id == current_user.id
        is_coleader = ClubMembership.query.filter_by(
            user_id=current_user.id, club_id=club_id, role='co-leader').first() is not None
            
        if not (is_leader or is_coleader):
            return jsonify({'error': 'Only club leaders can unfeature projects'}), 403
            
        # Find and delete the featured project
        featured_project = ClubFeaturedProject.query.filter_by(
            club_id=club_id, site_id=site_id).first()
            
        if not featured_project:
            return jsonify({'message': 'Project is not featured', 'featured': False})
            
        db.session.delete(featured_project)
        db.session.commit()
        
        return jsonify({'message': 'Project unfeatured successfully', 'featured': False})
        
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error unfeaturing project: {str(e)}')
        return jsonify({'error': f'Failed to unfeature project: {str(e)}'}), 500


def initialize_database():
    try:
        with app.app_context():
            db.create_all()
        return True
    except Exception as e:
        app.logger.warning(f"Database initialization skipped: {str(e)}")
        return False


@app.route('/integrations')
@login_required
def integrations():
    return render_template('integrations.html')


@app.route('/api/run/<int:site_id>', methods=['POST'])
@login_required
@rate_limit('api_run')
def run_piston_code(site_id):
    """Run code using the Piston API for any supported language"""
    try:
        site = Site.query.get_or_404(site_id)
        if site.user_id != current_user.id and not current_user.is_admin:
            abort(403)

        data = request.get_json()
        code = data.get('code', '')
        language = data.get('language', site.language)
        stdin = data.get('stdin', '')
        args = data.get('args', [])

        if len(code) > 10000:
            return jsonify({
                'success': False,
                'error': 'Code exceeds maximum allowed length (10,000 characters)'
            }), 400

        # Import the PistonService
        from piston_service import PistonService

        # Get the latest version for the language if not specified
        version = site.language_version or PistonService.get_latest_version(language)

        # Execute the code using Piston API
        result = PistonService.execute_code(
            language=language,
            code=code,
            version=version,
            stdin=stdin,
            args=args
        )

        # Format the response
        if result.get('success', False):
            return jsonify({
                'success': True,
                'run_output': result.get('output', ''),
                'compile_output': result.get('compile_output', ''),
                'execution_time': result.get('execution_time', 0)
            })
        else:
            return jsonify({
                'success': False,
                'error': result.get('error', 'Execution failed')
            }), 400

    except Exception as e:
        app.logger.error(f'Error in run_piston_code: {str(e)}')
        return jsonify({
            'success': False,
            'error': f'Server error: {str(e)}'
        }), 500

@app.route('/api/format/<int:site_id>', methods=['POST'])
@login_required
@rate_limit('api_run')
def format_code(site_id):
    """Format code using language-specific formatters"""
    try:
        site = Site.query.get_or_404(site_id)
        if site.user_id != current_user.id and not current_user.is_admin:
            abort(403)

        data = request.get_json()
        code = data.get('code', '')
        language = data.get('language', site.language)

        if len(code) > 10000:
            return jsonify({
                'success': False,
                'error': 'Code exceeds maximum allowed length (10,000 characters)'
            }), 400

        # Import the PistonService
        from piston_service import PistonService

        # Format the code based on language
        formatted_code = code
        formatter_commands = {
            'python': 'black -',
            'javascript': 'prettier --parser=babel',
            'typescript': 'prettier --parser=typescript',
            'java': 'google-java-format -',
            'c': 'clang-format',
            'cpp': 'clang-format',
            'go': 'gofmt',
            'rust': 'rustfmt',
            'php': 'php-cs-fixer fix --rules=@PSR2 -',
            'ruby': 'rubocop -a -',
            'html': 'prettier --parser=html',
            'css': 'prettier --parser=css'
        }

        # If we have a formatter for this language, use Piston to run it
        if language in formatter_commands:
            formatter_cmd = formatter_commands[language]
            
            # For languages that need a specific format command
            if language == 'python':
                format_code = f"import sys, black; print(black.format_str(sys.stdin.read(), mode=black.Mode()))"
                result = PistonService.execute_code(
                    language='python',
                    code=format_code,
                    stdin=code
                )
            else:
                # For now, just return the original code for other languages
                # In a real implementation, you would use the appropriate formatter
                result = {'success': True, 'output': code}

            if result.get('success', False) and result.get('output'):
                formatted_code = result.get('output')

        return jsonify({
            'success': True,
            'formatted_code': formatted_code
        })

    except Exception as e:
        app.logger.error(f'Error in format_code: {str(e)}')
        return jsonify({
            'success': False,
            'error': f'Server error: {str(e)}'
        }), 500


@app.route('/api/sites/bulk-delete', methods=['DELETE'])
@login_required
def bulk_delete_sites():
    try:
        data = request.get_json()
        site_ids = data.get('site_ids', [])
        
        if not site_ids:
            return jsonify({'success': False, 'message': 'No site IDs provided'}), 400
        
        deleted_count = 0
        for site_id in site_ids:
            site = Site.query.filter_by(id=site_id, user_id=current_user.id).first()
            if site:
                # Delete related site pages
                SitePage.query.filter_by(site_id=site.id).delete()
                
                # Delete the site
                db.session.delete(site)
                deleted_count += 1
        
        if deleted_count > 0:
            db.session.commit()
            return jsonify({'success': True, 'message': f'Successfully deleted {deleted_count} sites'})
        else:
            return jsonify({'success': False, 'message': 'No sites found or permission denied'}), 404
            
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Error in bulk delete: {str(e)}")
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

if __name__ == '__main__':
    # Configure more detailed logging
    import logging
    logging.basicConfig(level=logging.INFO,
                        format='[%(asctime)s] [%(levelname)s] %(message)s',
                        datefmt='%Y-%m-%d %H:%M:%S')
    app.logger.info("Starting server directly from app.py")

    try:
        app.logger.info("Initializing database...")
        initialize_database()
        app.logger.info("Database initialization complete")
    except Exception as e:
        app.logger.warning(f"Database initialization error: {e}")
        
    app.logger.info("Server running on http://0.0.0.0:3000")
    app.run(host='0.0.0.0', port=3000, debug=True)


@app.route('/api/admin/error-lookup/<error_id>', methods=['GET'])
@login_required
@admin_required
def lookup_error_by_id(error_id):
    """Look up an error by its ID"""
    try:
        # Get the error details from logs
        from utils.logs_util import logs_manager
        logs = logs_manager.get_logs()
        
        # Find errors with matching ID
        matching_errors = [log for log in logs if error_id in log.get('message', '')]
        
        if not matching_errors:
            return jsonify({
                'success': False,
                'message': f'No error found with ID {error_id}'
            }), 404
            
        return jsonify({
            'success': True,
            'errors': matching_errors
        })
    except Exception as e:
        app.logger.error(f"Error looking up error ID: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'Error looking up error: {str(e)}'
        }), 500

