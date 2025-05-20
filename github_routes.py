from flask import Blueprint, jsonify, request, redirect, url_for, session, flash
from flask_login import current_user, login_required, login_user
from github import Github, GithubException
from dotenv import load_dotenv
from models import db, GitHubRepo, Site, User, SitePage, UserActivity
from github_routes_helper import get_file_extension
import os
import requests
import time

load_dotenv()

github_bp = Blueprint('github', __name__)

GITHUB_CLIENT_ID = os.getenv('GITHUB_CLIENT_ID')
GITHUB_CLIENT_SECRET = os.getenv('GITHUB_CLIENT_SECRET')
GITHUB_CALLBACK_URL = os.getenv('GITHUB_CALLBACK_URL')

# Debug logging for GitHub auth
print(f"GitHub Auth Config - Client ID: {'Set' if GITHUB_CLIENT_ID else 'MISSING'}")
print(f"GitHub Auth Config - Client Secret: {'Set' if GITHUB_CLIENT_SECRET else 'MISSING'}")
print(f"GitHub Auth Config - Callback URL: {GITHUB_CALLBACK_URL or 'MISSING'}")


@github_bp.route('/api/github/status')
@login_required
def github_status():
    """Check GitHub connection status and related repository information"""
    # First check if user has a token in the database
    if current_user.github_token:
        access_token = current_user.github_token
        # Sync token to session
        session['github_token'] = access_token
    else:
        # Fallback to session token if database token doesn't exist
        access_token = session.get('github_token')

    if not access_token:
        return jsonify({'connected': False, 'repo_connected': False})

    try:
        g = Github(access_token)
        user = g.get_user()

        site_id = request.args.get('site_id') or session.get('current_site_id')
        if site_id and site_id not in ['null', 'undefined']:
            try:
                site_id = int(site_id)
                site = Site.query.get(site_id)
                if not site:
                    return jsonify({'error': 'Site not found'}), 404
            except (ValueError, TypeError):
                # Invalid site_id format (not an integer)
                return jsonify({
                    'connected': True,
                    'repo_connected': False,
                    'username': user.login
                })

            repo = GitHubRepo.query.filter_by(site_id=site.id).first()
            if site and repo:
                # Validate that repo still exists on GitHub
                try:
                    gh_repo = g.get_repo(repo.repo_name)
                    return jsonify({
                        'connected':
                        True,
                        'repo_connected':
                        True,
                        'username':
                        user.login,
                        'repo_name':
                        repo.repo_name,
                        'repo_url':
                        repo.repo_url,
                        'is_private':
                        repo.is_private,
                        'created_at':
                        repo.created_at.isoformat()
                        if repo.created_at else None
                    })
                except GithubException as e:
                    if e.status == 404:
                        # Repository no longer exists on GitHub
                        db.session.delete(repo)
                        db.session.commit()
                        return jsonify({
                            'connected':
                            True,
                            'repo_connected':
                            False,
                            'username':
                            user.login,
                            'error':
                            'Repository no longer exists on GitHub'
                        })
                    raise

        # Ensure token is synchronized between session and database
        if not current_user.github_token and access_token:
            current_user.github_token = access_token
            current_user.github_username = user.login
            db.session.commit()
        elif not session.get('github_token') and access_token:
            session['github_token'] = access_token

        return jsonify({
            'connected': True,
            'repo_connected': False,
            'username': user.login
        })
    except GithubException as e:
        if e.status == 401:
            if current_user.github_token:
                current_user.github_token = None
                db.session.commit()
            if session.get('github_token'):
                session.pop('github_token', None)
            return jsonify({
                'connected': False,
                'repo_connected': False,
                'error': 'Invalid GitHub token'
            })
        return jsonify({
            'connected': False,
            'repo_connected': False,
            'error': str(e)
        })
    except Exception as e:
        print(f'GitHub status error: {str(e)}')
        return jsonify({
            'connected': False,
            'repo_connected': False,
            'error': str(e)
        })


@github_bp.route('/api/github/login')
def github_login():
    """Redirect to GitHub OAuth login"""
    next_url = request.args.get('next')
    if next_url:
        session['next_url'] = next_url

    return redirect(f'https://github.com/login/oauth/authorize?'
                    f'client_id={GITHUB_CLIENT_ID}&'
                    f'redirect_uri={GITHUB_CALLBACK_URL}&'
                    f'scope=repo delete_repo user:email')


@github_bp.route('/api/github/callback')
def github_callback():
    """Handle GitHub OAuth callback"""
    code = request.args.get('code')
    error = request.args.get('error')

    if error:
        flash('GitHub authentication failed', 'error')
        return redirect(url_for('login'))

    try:
        response = requests.post('https://github.com/login/oauth/access_token',
                                headers={'Accept': 'application/json'},
                                data={
                                    'client_id': GITHUB_CLIENT_ID,
                                    'client_secret': GITHUB_CLIENT_SECRET,
                                    'code': code,
                                    'redirect_uri': GITHUB_CALLBACK_URL
                                })

        data = response.json()
        print(f"GitHub OAuth response status: {response.status_code}")
        print(f"GitHub OAuth response (sanitized): {str(data)[:100]}...")

        from utils.logs_util import logs_manager
        logs_manager.add_log(f"GitHub OAuth response status: {response.status_code}", level="INFO", source="github")

        if 'error' in data:
            logs_manager.add_log(f"GitHub OAuth error: {data.get('error_description', data.get('error'))}", 
                                level="ERROR", source="github")
            print(f"GitHub OAuth error: {data.get('error_description', data.get('error'))}")

        if 'access_token' in data:
            access_token = data['access_token']
            session['github_token'] = access_token

            g = Github(access_token)
            gh_user = g.get_user()

            user = None
            if current_user.is_authenticated:
                user = current_user
                user.github_token = access_token
                user.github_username = gh_user.login
                db.session.commit()
                activity = UserActivity(
                    activity_type="github_connected",
                    message=
                    f'User {user.username} connected GitHub account @{gh_user.login}',
                    username=user.username,
                    user_id=user.id)
                db.session.add(activity)
                db.session.commit()
            else:
                try:
                    primary_email = gh_user.email

                    if not primary_email:
                        emails = gh_user.get_emails()
                        for email in emails:
                            if email.primary:
                                primary_email = email.email
                                break

                    if not primary_email:
                        flash('Could not get email from GitHub account', 'error')
                        return redirect(url_for('login'))

                except Exception as e:
                    print(f'Error getting GitHub email: {str(e)}')
                    flash('Could not get email from GitHub account', 'error')
                    return redirect(url_for('login'))

                if primary_email:
                    user = User.query.filter_by(email=primary_email).first()
                    if user:
                        user.github_token = access_token
                        user.github_username = gh_user.login
                        db.session.commit()
                        login_user(user)

                        # Record activity
                        activity = UserActivity(
                            activity_type="github_connected",
                            message=
                            f'User {user.username} connected GitHub account @{gh_user.login}',
                            username=user.username,
                            user_id=user.id)
                        db.session.add(activity)
                        db.session.commit()
                    else:
                        user = User(username=gh_user.login,
                                    email=primary_email,
                                    github_token=access_token,
                                    github_username=gh_user.login,
                                    preview_code_verified=True)
                        import secrets
                        random_password = secrets.token_urlsafe(32)
                        user.set_password(random_password)
                        db.session.add(user)
                        db.session.commit()
                        login_user(user)

                        # Record activity
                        activity = UserActivity(
                            activity_type="github_connected",
                            message=
                            f'User {user.username} connected GitHub account @{gh_user.login}',
                            username=user.username,
                            user_id=user.id)
                        db.session.add(activity)
                        db.session.commit()

        next_url = session.pop('next_url', None)
        return redirect(next_url or url_for('welcome'))

    except Exception as e:
        print(f"GitHub OAuth exception: {str(e)}")
        flash('Failed to authenticate with GitHub', 'error')
        return redirect(url_for('login'))


@github_bp.route('/api/github/create-repo', methods=['POST'])
@login_required
def create_repo():
    """Create a new GitHub repository for the current site"""
    try:
        access_token = session.get('github_token')
        if not access_token:
            if current_user.github_token:
                session['github_token'] = current_user.github_token
                access_token = current_user.github_token
            else:
                return jsonify({
                    'error':
                    'No GitHub account connected. Please link your GitHub account.'
                }), 401

        site_id = request.args.get('site_id') or session.get('current_site_id')
        if not site_id:
            return jsonify(
                {'error': 'No site ID provided. Please select a site.'}), 400

        site = Site.query.get(site_id)
        if not site:
            return jsonify({'error': 'Site not found'}), 404
        if site.user_id != current_user.id:
            return jsonify(
                {'error':
                 'You do not have permission to access this site'}), 403

        # Check if site already has a GitHub repository
        existing_repo = GitHubRepo.query.filter_by(site_id=site.id).first()
        if existing_repo:
            return jsonify({
                'error': 'This site already has a GitHub repository connected',
                'repo_name': existing_repo.repo_name,
                'repo_url': existing_repo.repo_url
            }), 400

        data = request.json
        if not data:
            return jsonify({'error': 'No repository data provided'}), 400

        name = data.get('name')
        if not name:
            return jsonify({'error': 'Repository name is required'}), 400

        description = data.get(
            'description', f'Site created with Hack Club Spaces - {site.name}')
        private = data.get('private', True)
        has_issues = data.get('has_issues', True)
        has_projects = data.get('has_projects', True)
        has_wiki = data.get('has_wiki', True)

        g = Github(access_token)
        user = g.get_user()

        # Check if repo with this name already exists
        try:
            existing = user.get_repo(name)
            if existing:
                return jsonify(
                    {'error':
                     f'You already have a repository named "{name}"'}), 400
        except GithubException:
            pass  # Repo doesn't exist, which is what we want

        # Create the repo
        repo = user.create_repo(name=name,
                                description=description,
                                private=private,
                                has_issues=has_issues,
                                has_projects=has_projects,
                                has_wiki=has_wiki,
                                auto_init=True)

        # Add attribution text to README.md
        try:
            readme_content = f"# {name}\n\n{description}\n\nMade with Hack Club Spaces 💖"
            readme = repo.get_contents("README.md")
            repo.update_file("README.md", "Update README with attribution",
                             readme_content, readme.sha)
        except Exception as e:
            print(f"Error updating README: {str(e)}")

        github_repo = GitHubRepo(repo_name=repo.full_name,
                                 repo_url=repo.html_url,
                                 is_private=private,
                                 site_id=site_id)

        db.session.add(github_repo)

        # Record activity
        activity = UserActivity(
            activity_type="github_repo_creation",
            message=
            f'User {current_user.username} created GitHub repository "{repo.full_name}"',
            username=current_user.username,
            user_id=current_user.id,
            site_id=site_id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({
            'message': 'Repository created successfully',
            'repo_name': repo.full_name,
            'repo_url': repo.html_url,
            'is_private': private
        })

    except GithubException as e:
        error_message = f"GitHub Error: {e.data.get('message', str(e))}"
        return jsonify({'error': error_message}), e.status
    except Exception as e:
        print(f'Error creating repository: {str(e)}')
        db.session.rollback()
        return jsonify({'error':
                        'Failed to create repository: ' + str(e)}), 500


@github_bp.route('/api/github/repo-info')
@login_required
def repo_info():
    """Get detailed information about the connected repository"""
    try:
        site_id = request.args.get('site_id') or session.get('current_site_id')
        if not site_id:
            return jsonify({'error': 'No site ID provided'}), 400

        site = Site.query.get(site_id)
        if not site:
            return jsonify({'error': 'Site not found'}), 404
        if site.user_id != current_user.id:
            return jsonify(
                {'error':
                 'You do not have permission to access this site'}), 403

        github_repo = GitHubRepo.query.filter_by(site_id=site.id).first()
        if not github_repo:
            return jsonify({
                'error': 'No repository connected to this site',
                'needs_repo': True
            }), 404

        access_token = session.get('github_token') or current_user.github_token
        if not access_token:
            return jsonify({
                'error': 'No GitHub token found',
                'needs_auth': True
            }), 401

        try:
            g = Github(access_token)
            repo = g.get_repo(github_repo.repo_name)

            # Update repo URL if it changed
            if repo.html_url != github_repo.repo_url:
                github_repo.repo_url = repo.html_url
                db.session.commit()

            # Get contributor stats
            contributors = None
            try:
                contributors = list(repo.get_contributors())
                contributor_count = len(contributors)
            except:
                contributor_count = 1  # Default to 1 if we can't get contributors

            # Get commit stats
            commits = None
            try:
                commits = list(repo.get_commits())
                commit_count = len(commits)
                last_commit_date = commits[0].commit.author.date.isoformat(
                ) if commits else None
            except:
                commit_count = 0
                last_commit_date = None

            return jsonify({
                'repo_name':
                github_repo.repo_name,
                'repo_url':
                github_repo.repo_url,
                'is_private':
                github_repo.is_private,
                'created_at':
                github_repo.created_at.isoformat()
                if github_repo.created_at else None,
                'updated_at':
                github_repo.updated_at.isoformat()
                if github_repo.updated_at else None,
                'contributors':
                contributor_count,
                'commits':
                commit_count,
                'last_commit':
                last_commit_date,
                'has_issues':
                repo.has_issues,
                'has_wiki':
                repo.has_wiki,
                'default_branch':
                repo.default_branch
            })

        except GithubException as e:
            if e.status == 404:
                db.session.delete(github_repo)
                db.session.commit()
                return jsonify({
                    'error': 'Repository no longer exists on GitHub',
                    'needs_repo': True
                }), 404
            elif e.status == 401:
                # Clear invalid token
                if current_user.github_token:
                    current_user.github_token = None
                    db.session.commit()
                if session.get('github_token'):
                    session.pop('github_token', None)
                return jsonify({
                    'error': 'GitHub token is invalid',
                    'needs_auth': True
                }), 401
            else:
                raise

    except Exception as e:
        print(f'Error getting repo info: {str(e)}')
        return jsonify(
            {'error': 'Failed to get repository information: ' + str(e)}), 500


@github_bp.route('/api/github/push', methods=['POST'])
@login_required
def push_changes():
    """Push all site changes to GitHub repository"""
    try:
        access_token = session.get('github_token')
        if not access_token:
            if current_user.github_token:
                session['github_token'] = current_user.github_token
                access_token = current_user.github_token
            else:
                return jsonify({'error': 'No GitHub account connected'}), 401

        site_id = request.args.get('site_id') or session.get('current_site_id')
        if not site_id:
            return jsonify({'error': 'No site ID provided'}), 400

        site = Site.query.get_or_404(site_id)
        if site.user_id != current_user.id:
            return jsonify(
                {'error':
                 'You do not have permission to access this site'}), 403

        github_repo = GitHubRepo.query.filter_by(site_id=site.id).first()
        if not github_repo:
            return jsonify({'error':
                            'No repository connected to this site'}), 404

        data = request.json
        commit_message = data.get('message', 'Update from Hack Club Spaces')

        g = Github(access_token)
        repo = g.get_repo(github_repo.repo_name)

        # Get all site files
        files_to_update = {}

        if site.site_type == 'python' or site.site_type == 'code':
            # For all code spaces including Python
            extension = '.py' if site.site_type == 'python' or site.language == 'python' else get_file_extension(site.language)
            files_to_update[f'main{extension}'] = site.language_content or ''

            # Add requirements.txt for Python projects
            if site.site_type == 'python' or site.language == 'python':
                try:
                    req_file = repo.get_contents("requirements.txt")
                    files_to_update['requirements.txt'] = "# Python dependencies\n" + \
                                                      "flask\n" + \
                                                      "requests\n" + \
                                                    "python-dotenv\n"
                except:
                    # Create requirements.txt
                    files_to_update['requirements.txt'] = "# Python dependencies\n" + \
                                                        "flask\n" + \
                                                        "requests\n" + \
                                                        "PyGithub\n" + \
                                                    "python-dotenv\n"
        else:
            # For web sites, get all pages
            site_pages = SitePage.query.filter_by(site_id=site.id).all()

            # Always include main HTML content
            files_to_update['index.html'] = site.html_content or ''

            # Add all site pages
            for page in site_pages:
                if page.filename != 'index.html':  # Avoid duplicate
                    files_to_update[page.filename] = page.content or ''

        # Collect success and errors
        results = {
            'updated': [],
            'created': [],
            'errors': [],
            'summary': 'Changes pushed successfully'
        }

        for file_path, content in files_to_update.items():
            try:
                try:
                    file = repo.get_contents(file_path)
                    repo.update_file(file_path, commit_message, content,
                                     file.sha)
                    results['updated'].append(file_path)
                except GithubException as e:
                    if e.status == 404:
                        repo.create_file(file_path, commit_message, content)
                        results['created'].append(file_path)
                    else:
                        results['errors'].append({
                            'file': file_path,
                            'error': str(e)
                        })
            except Exception as file_error:
                print(f'Error updating file {file_path}: {str(file_error)}')
                results['errors'].append({
                    'file': file_path,
                    'error': str(file_error)
                })

        # Record activity
        activity = UserActivity(
            activity_type="github_push",
            message=
            f'User {current_user.username} pushed {len(results["updated"])} updates and {len(results["created"])} new files to "{github_repo.repo_name}"',
            username=current_user.username,
            user_id=current_user.id,
            site_id=site_id)
        db.session.add(activity)
        db.session.commit()

        # Generate a summary
        if not results['errors']:
            if results['updated'] and results['created']:
                results[
                    'summary'] = f"Updated {len(results['updated'])} files and created {len(results['created'])} new files"
            elif results['updated']:
                results['summary'] = f"Updated {len(results['updated'])} files"
            elif results['created']:
                results[
                    'summary'] = f"Created {len(results['created'])} new files"
        else:
            results[
                'summary'] = f"Completed with {len(results['errors'])} errors"

        return jsonify({
            'message': 'Changes pushed successfully',
            'repo_url': github_repo.repo_url,
            'results': results,
            'timestamp': time.time()
        })

    except GithubException as e:
        print(f'GitHub error: {str(e)}')
        error_message = f"GitHub Error: {e.data.get('message', str(e))}"
        return jsonify({'error': error_message}), e.status
    except Exception as e:
        print(f'Error pushing changes: {str(e)}')
        return jsonify({'error': 'Failed to push changes: ' + str(e)}), 500


@github_bp.route('/api/github/delete-repo', methods=['POST'])
@login_required
def delete_repo():
    """Delete a GitHub repository"""
    try:
        access_token = session.get('github_token')
        if not access_token:
            if current_user.github_token:
                session['github_token'] = current_user.github_token
                access_token = current_user.github_token
            else:
                return jsonify({'error': 'No GitHub account connected'}), 401

        site_id = request.args.get('site_id') or session.get('current_site_id')
        if not site_id:
            return jsonify({'error': 'No site ID provided'}), 400

        site = Site.query.get(site_id)
        if not site:
            return jsonify({'error': 'Site not found'}), 404
        if site.user_id != current_user.id:
            return jsonify({'error': 'Permission denied'}), 403

        github_repo = GitHubRepo.query.filter_by(site_id=site.id).first()
        if not github_repo:
            return jsonify({'error': 'No repository connected'}), 404

        repo_name = github_repo.repo_name

        # Verify with confirmation code
        data = request.json
        confirmation = data.get('confirmation')
        if not confirmation or confirmation.lower() != 'delete':
            return jsonify({
                'error':
                'Please type "delete" to confirm repository deletion'
            }), 400

        g = Github(access_token)
        try:
            repo = g.get_repo(github_repo.repo_name)
            repo.delete()
        except GithubException as e:
            if e.status != 404:  # If it's not a 404 (already deleted), re-raise
                raise

        # Always remove from our database regardless of GitHub status
        db.session.delete(github_repo)

        # Record activity
        activity = UserActivity(
            activity_type="github_repo_deletion",
            message=
            f'User {current_user.username} deleted GitHub repository "{repo_name}"',
            username=current_user.username,
            user_id=current_user.id,
            site_id=site.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({
            'message': 'Repository deleted successfully',
            'repo_name': repo_name
        })

    except GithubException as e:
        print(f'GitHub error: {str(e)}')
        error_message = f"GitHub Error: {e.data.get('message', str(e))}"
        return jsonify({'error': error_message}), e.status
    except Exception as e:
        db.session.rollback()
        print('Delete repo error:', str(e))
        return jsonify({'error':
                        'Failed to delete repository: ' + str(e)}), 500


@github_bp.route('/api/github/disconnect-repo', methods=['POST'])
@login_required
def disconnect_repo():
    """Disconnect the GitHub repository from the site without deleting it"""
    try:
        site_id = request.args.get('site_id') or session.get('current_site_id')
        if not site_id:
            return jsonify({'error': 'No site ID provided'}), 400

        site = Site.query.get(site_id)
        if not site:
            return jsonify({'error': 'Site not found'}), 404
        if site.user_id != current_user.id:
            return jsonify({'error': 'Permission denied'}), 403

        github_repo = GitHubRepo.query.filter_by(site_id=site.id).first()
        if not github_repo:
            return jsonify({'error': 'No repository connected'}), 404

        repo_name = github_repo.repo_name
        repo_url = github_repo.repo_url

        db.session.delete(github_repo)

        # Record activity
        activity = UserActivity(
            activity_type="github_repo_disconnect",
            message=
            f'User {current_user.username} disconnected GitHub repository "{repo_name}"',
            username=current_user.username,
            user_id=current_user.id,
            site_id=site.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({
            'message': 'Repository disconnected successfully',
            'repo_name': repo_name,
            'repo_url': repo_url
        })

    except Exception as e:
        db.session.rollback()
        print('Disconnect error:', str(e))
        return jsonify({'error':
                        'Failed to disconnect repository: ' + str(e)}), 500


@github_bp.route('/api/github/disconnect-account', methods=['POST'])
@login_required
def disconnect_account():
    """Disconnect GitHub account from user profile"""
    try:
        if not current_user.github_token:
            return jsonify({'error': 'No GitHub account connected'}), 400

        current_user.github_token = None
        current_user.github_username = None

        if session.get('github_token'):
            session.pop('github_token', None)

        db.session.commit()

        # Record activity
        activity = UserActivity(
            activity_type="github_disconnected",
            message=f'User {current_user.username} disconnected GitHub account',
            username=current_user.username,
            user_id=current_user.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({'message': 'GitHub account disconnected successfully'})

    except Exception as e:
        db.session.rollback()
        print('Disconnect account error:', str(e))
        return jsonify(
            {'error': 'Failed to disconnect GitHub account: ' + str(e)}), 500

@github_bp.route('/api/github/pull', methods=['POST'])
@login_required
def pull_changes():
    """Pull latest changes from GitHub repository"""
    try:
        from datetime import datetime

        access_token = session.get('github_token')
        if not access_token:
            if current_user.github_token:
                session['github_token'] = current_user.github_token
                access_token = current_user.github_token
            else:
                return jsonify({'error': 'No GitHub account connected'}), 401

        site_id = request.args.get('site_id') or session.get('current_site_id')
        if not site_id:
            return jsonify({'error': 'No site ID provided'}), 400

        site = Site.query.get_or_404(site_id)
        if site.user_id != current_user.id:
            return jsonify(
                {'error':
                 'You do not have permission to access this site'}), 403

        github_repo = GitHubRepo.query.filter_by(site_id=site.id).first()
        if not github_repo:
            return jsonify({'error': 'No repository connected to this site'}), 404

        g = Github(access_token)
        repo = g.get_repo(github_repo.repo_name)

        # Get all site files from GitHub
        files_pulled = []
        files_updated = []
        errors = []

        try:
            # First, get the list of files from the repository
            contents = repo.get_contents("")

            for content in contents:
                if content.type == "file":
                    try:
                        file_content = content.decoded_content.decode('utf-8')
                        file_path = content.path

                        # Update site content based on file type
                        if site.site_type == 'python':
                            # Always update the content and mark it as updated
                            site.python_content = file_content
                            files_updated.append(file_path)
                        elif site.site_type == 'web':
                            # For other files, check if they exist
                            page = SitePage.query.filter_by(site_id=site.id, filename=file_path).first()
                            if page:
                                # Always update the content and mark it as updated
                                page.content = file_content
                                page.updated_at = datetime.utcnow()
                                files_updated.append(file_path)
                            else:
                                # Determine file_type based on extension
                                file_ext = file_path.split('.')[-1].lower() if '.' in file_path else ''
                                file_type = 'html' if file_ext == 'html' else \
                                           'css' if file_ext == 'css' else \
                                           'js' if file_ext in ['js', 'jsx'] else \
                                           'txt'
                                new_page = SitePage(site_id=site.id, filename=file_path, content=file_content, file_type=file_type)
                                db.session.add(new_page)
                                files_pulled.append(file_path)
                    except Exception as e:
                        errors.append({"file": content.path, "error": str(e)})
                elif content.type == "dir":
                    try:
                        # Handle nested directories
                        dir_contents = repo.get_contents(content.path)
                        for dir_content in dir_contents:
                            if dir_content.type == "file":
                                try:
                                    file_content = dir_content.decoded_content.decode('utf-8')
                                    file_path = dir_content.path

                                    # Check if file exists
                                    page = SitePage.query.filter_by(site_id=site.id, filename=file_path).first()
                                    if page:
                                        # Always update the content and mark it as updated
                                        page.content = file_content
                                        page.updated_at = datetime.utcnow()
                                        files_updated.append(file_path)
                                    else:
                                        # Determine file_type based on extension
                                        file_ext = file_path.split('.')[-1].lower() if '.' in file_path else ''
                                        file_type = 'html' if file_ext == 'html' else \
                                                'css' if file_ext == 'css' else \
                                                'js' if file_ext in ['js', 'jsx'] else \
                                                'txt'
                                        new_page = SitePage(site_id=site.id, filename=file_path, content=file_content, file_type=file_type)
                                        db.session.add(new_page)
                                        files_pulled.append(file_path)
                                except Exception as e:
                                    errors.append({"file": dir_content.path, "error": str(e)})
                    except Exception as e:
                        errors.append({"dir": content.path, "error": str(e)})

        except Exception as e:
            return jsonify({'error': 'Failed to fetch repository contents: ' + str(e)}), 500

        # Commit all changes
        db.session.commit()

        # Record activity
        total_files = len(files_pulled) + len(files_updated)
        activity = UserActivity(
            activity_type="github_pull",
            message=f'User {current_user.username} pulled {len(files_pulled)} new files and updated {len(files_updated)} existing files from "{github_repo.repo_name}"',
            username=current_user.username,
            user_id=current_user.id,
            site_id=site.id)
        db.session.add(activity)
        db.session.commit()

        return jsonify({
            'message': 'Changes pulled successfully',
            'files_pulled': files_pulled,
            'files_updated': files_updated,
            'errors': errors,
            'files_count': total_files
        })

    except Exception as e:
        print(f'Error pulling changes: {str(e)}')
        return jsonify({'error': 'Failed to pull changes: ' + str(e)}), 500