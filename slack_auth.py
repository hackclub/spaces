import os
import requests
from flask import Blueprint, request, redirect, url_for, flash, session, current_app
from flask_login import login_user, current_user
from models import db, User, UserActivity

slack_auth_bp = Blueprint('slack_auth', __name__)

@slack_auth_bp.route('/slack/login')
def slack_login():
    """Redirect to Slack OAuth"""
    client_id = os.environ.get('SLACK_CLIENT_ID')
    redirect_uri = os.environ.get('SLACK_REDIRECT_URI')

    if not client_id or not redirect_uri:
        current_app.logger.error("Slack credentials not configured")
        flash('Slack authentication is not properly configured', 'error')
        return redirect(url_for('login'))

    # State parameter helps prevent CSRF attacks
    state = os.urandom(16).hex()
    session['slack_oauth_state'] = state

    # Define the scopes - use recommended non-deprecated scopes
    SLACK_OAUTH_SCOPES = 'openid,email,profile'

    # Use the current request host for dynamic redirect URI creation if not set
    if not redirect_uri:
        protocol = 'https' if request.is_secure else 'http'
        host = request.headers.get('Host', '')
        redirect_uri = f"{protocol}://{host}/slack/callback"
        current_app.logger.info(f"Generated redirect URI: {redirect_uri}")

    # Set redirect URI in session to verify it's the same on callback
    session['slack_redirect_uri'] = redirect_uri

    auth_url = (
        f"https://slack.com/oauth/v2/authorize?"
        f"client_id={client_id}&"
        f"user_scope={SLACK_OAUTH_SCOPES}&"
        f"redirect_uri={redirect_uri}&"
        f"state={state}"
    )

    return redirect(auth_url)

@slack_auth_bp.route('/slack/callback')
def slack_callback():
    """Handle Slack OAuth callback"""
    code = request.args.get('code')
    state = request.args.get('state')
    error = request.args.get('error')

    # Verify state to prevent CSRF
    expected_state = session.pop('slack_oauth_state', None)
    if not expected_state or state != expected_state:
        flash('Invalid OAuth state', 'error')
        return redirect(url_for('login'))

    if error:
        flash(f'Slack authentication failed: {error}', 'error')
        return redirect(url_for('login'))

    # Exchange authorization code for access token
    client_id = os.environ.get('SLACK_CLIENT_ID')
    client_secret = os.environ.get('SLACK_CLIENT_SECRET')
    redirect_uri = session.pop('slack_redirect_uri', os.environ.get('SLACK_REDIRECT_URI'))

    current_app.logger.info(f"Using redirect URI for token exchange: {redirect_uri}")

    token_response = requests.post(
        'https://slack.com/api/oauth.v2.access',
        data={
            'client_id': client_id,
            'client_secret': client_secret,
            'code': code,
            'redirect_uri': redirect_uri
        }
    )

    token_data = token_response.json()
    current_app.logger.info(f"Token response: {token_data}")

    if not token_data.get('ok', False):
        current_app.logger.error(f"Slack token exchange failed: {token_data.get('error')}")
        flash('Failed to authenticate with Slack', 'error')
        return redirect(url_for('login'))

    # Get user info from token response - use the authed_user token instead of the main access token
    access_token = token_data.get('authed_user', {}).get('access_token')
    if not access_token:
        access_token = token_data.get('access_token')  # Fallback to main token
    
    slack_user_id = token_data.get('authed_user', {}).get('id')

    # Get user email from the OpenID userinfo endpoint
    # Initialize variables to avoid reference errors
    slack_email = None
    slack_username = None
    slack_real_name = None

    try:
        current_app.logger.info(f"Getting user info for Slack user ID: {slack_user_id}")

        # Try OpenID userinfo endpoint first (for 'openid', 'email', 'profile' scopes)
        userinfo_response = requests.get(
            'https://slack.com/api/openid.connect.userInfo',
            headers={'Authorization': f'Bearer {access_token}'},
            timeout=10
        )

        userinfo_data = userinfo_response.json()
        current_app.logger.info(f"Slack OpenID userinfo response: {userinfo_response.status_code}, data: {userinfo_data}")

        if userinfo_data.get('ok', False):
            slack_email = userinfo_data.get('email')
            slack_username = userinfo_data.get('name', slack_user_id)
            slack_real_name = userinfo_data.get('name', slack_username)

            if slack_email:
                current_app.logger.info(f"Successfully got user email from OpenID userinfo: {slack_email}")
            else:
                current_app.logger.warning("No email found in OpenID userinfo response")
        else:
            current_app.logger.warning(f"OpenID userinfo failed: {userinfo_data.get('error', 'Unknown error')}")

        # If no email from OpenID, try users.info as backup
        if not slack_email:
            current_app.logger.info("Trying users.info API as backup")
            
            # Get user token specifically from the authed_user section
            user_token = token_data.get('authed_user', {}).get('access_token', access_token)
            current_app.logger.info(f"Using user token for users.info: {user_token[:5]}...")
            
            user_info_response = requests.get(
                'https://slack.com/api/users.info',
                params={'user': slack_user_id},
                headers={'Authorization': f'Bearer {user_token}'},
                timeout=10
            )

            user_info = user_info_response.json()
            current_app.logger.info(f"Slack users.info API response: {user_info_response.status_code}, data: {user_info}")

            if user_info.get('ok', False) and 'user' in user_info:
                slack_user = user_info.get('user', {})
                slack_email = slack_user.get('profile', {}).get('email')
                slack_username = slack_user.get('name', slack_user_id)
                slack_real_name = slack_user.get('real_name') or slack_username

                if slack_email:
                    current_app.logger.info(f"Successfully got user email from users.info API: {slack_email}")
                else:
                    current_app.logger.warning("No email found in users.info response")

        # If still no email, try identity API (though it may be deprecated)
        if not slack_email:
            try:
                current_app.logger.info("Trying identity API as last resort")
                identity_response = requests.get(
                    'https://slack.com/api/users.identity',
                    headers={'Authorization': f'Bearer {access_token}'},
                    timeout=10
                )

                identity_data = identity_response.json()
                if identity_data.get('ok', False):
                    slack_email = identity_data.get('user', {}).get('email')
                    slack_username = identity_data.get('user', {}).get('name', slack_user_id)
                    slack_real_name = identity_data.get('user', {}).get('real_name', slack_username)

                    if slack_email:
                        current_app.logger.info(f"Successfully got user email from identity API: {slack_email}")
                    else:
                        current_app.logger.warning(f"Identity API failed: {identity_data.get('error', 'Unknown error')}")
            except Exception as identity_error:
                current_app.logger.error(f"Error calling identity API: {str(identity_error)}")

        # Fallback to token data if all API calls failed
        if not slack_email:
            slack_email = token_data.get('authed_user', {}).get('email')
            slack_username = token_data.get('authed_user', {}).get('name', slack_user_id or 'slack_user')
            slack_real_name = token_data.get('authed_user', {}).get('real_name', slack_username)
            current_app.logger.info(f"Using fallback email from token response: {slack_email}")

    except Exception as e:
        current_app.logger.error(f"Exception getting Slack user info: {str(e)}")
        flash('Error connecting to Slack API', 'error')
        return redirect(url_for('login'))

    if not slack_email:
        current_app.logger.error("No email available from any Slack API endpoint")
        flash('Email information not available from Slack. Please check your Slack app permissions and ensure email access is granted.', 'error')
        return redirect(url_for('login'))

    current_app.logger.info(f"Successfully retrieved Slack user: {slack_username}, email: {slack_email}")

    # Add thorough logging of the token response data for debugging
    current_app.logger.info(f"Token response details - scopes: {token_data.get('scope')}")
    current_app.logger.info(f"Authed user details: {token_data.get('authed_user', {})}")

    # Log email status before checking database
    current_app.logger.info(f"Retrieved email: {slack_email}")
    
    if not slack_email:
        flash('Email information not available from Slack. Please check your Slack app permissions and ensure email access is granted.', 'error')
        return redirect(url_for('login'))
        
    # Check if user exists with this email
    existing_user = User.query.filter_by(email=slack_email).first()

    if existing_user:
        # User exists, log them in
        login_user(existing_user)
        existing_user.last_login = db.func.now()
        existing_user.slack_id = slack_user_id

        # Record login activity
        activity = UserActivity(
            activity_type="user_login",
            message="User {username} logged in via Slack",
            username=existing_user.username,
            user_id=existing_user.id
        )
        db.session.add(activity)
        db.session.commit()

        flash(f'Welcome back, {existing_user.username}!', 'success')
        return redirect(url_for('welcome'))
    else:
        # Create new user
        # Generate a username based on Slack name
        import re
        base_username = re.sub(r'[^a-zA-Z0-9]', '', slack_username.lower())

        # If username is too short, use part of email
        if len(base_username) < 3:
            base_username = slack_email.split('@')[0].lower()
            base_username = re.sub(r'[^a-zA-Z0-9]', '', base_username)

        # Ensure username is unique
        username = base_username
        counter = 1
        while User.query.filter_by(username=username).first():
            username = f"{base_username}{counter}"
            counter += 1

        new_user = User(
            username=username,
            email=slack_email,
            slack_id=slack_user_id,
            preview_code_verified=True
        )

        # Set random password since login will be via Slack
        import secrets
        random_password = secrets.token_urlsafe(16)
        new_user.set_password(random_password)

        db.session.add(new_user)
        db.session.flush()  # Get user ID without committing

        # Record registration activity
        activity = UserActivity(
            activity_type="user_registration",
            message="New user registered via Slack: {username}",
            username=username,
            user_id=new_user.id
        )
        db.session.add(activity)
        db.session.commit()

        login_user(new_user)
        flash(f'Welcome to Hack Club Spaces, {username}!', 'success')
        return redirect(url_for('welcome'))