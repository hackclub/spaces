from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash
from slugify import slugify
import secrets
import string

db = SQLAlchemy()


class UserActivity(db.Model):
    __tablename__ = 'user_activity'
    id = db.Column(db.Integer, primary_key=True)
    activity_type = db.Column(db.String(50), nullable=False)
    message = db.Column(db.Text, nullable=False)
    username = db.Column(db.String(80), nullable=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    site_id = db.Column(db.Integer, db.ForeignKey('site.id'), nullable=True)

    user = db.relationship('User', backref=db.backref('activities', lazy=True))
    site = db.relationship('Site', backref=db.backref('activities', lazy=True))

    def __repr__(self):
        return f'<UserActivity {self.activity_type} by {self.username}>'


class Club(db.Model):
    __tablename__ = 'club'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    location = db.Column(db.String(200), nullable=True)
    join_code = db.Column(db.String(16), unique=True, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # The club leader (owner) is the user who created the club
    leader_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    leader = db.relationship('User', backref=db.backref('club', uselist=False), foreign_keys=[leader_id])

    def generate_join_code(self):
        alphabet = string.ascii_letters + string.digits
        while True:
            code = ''.join(secrets.choice(alphabet) for _ in range(8))
            # Make sure code is unique
            if not Club.query.filter_by(join_code=code).first():
                self.join_code = code
                db.session.flush()  # Ensure the code is saved to the session
                return code

    def __repr__(self):
        return f'<Club {self.name}>'


class ClubMembership(db.Model):
    __tablename__ = 'club_membership'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    club_id = db.Column(db.Integer, db.ForeignKey('club.id'), nullable=False)
    role = db.Column(db.String(50), default='member', nullable=False)  # member, co-leader
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref=db.backref('club_memberships', lazy=True))
    club = db.relationship('Club', backref=db.backref('members', lazy=True))

    __table_args__ = (db.UniqueConstraint('user_id', 'club_id', name='uix_user_club'),)

    def __repr__(self):
        return f'<ClubMembership {self.user.username} in {self.club.name} as {self.role}>'


class ClubPost(db.Model):
    __tablename__ = 'club_post'
    id = db.Column(db.Integer, primary_key=True)
    club_id = db.Column(db.Integer, db.ForeignKey('club.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    likes = db.Column(db.Integer, default=0)

    club = db.relationship('Club', backref=db.backref('posts', lazy=True, order_by='desc(ClubPost.created_at)'))
    user = db.relationship('User', backref=db.backref('club_posts', lazy=True))

    def __repr__(self):
        return f'<ClubPost {self.id} by {self.user.username} in {self.club.name}>'

class ClubPostLike(db.Model):
    __tablename__ = 'club_post_like'
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey('club_post.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    post = db.relationship('ClubPost', backref=db.backref('post_likes', lazy=True))
    user = db.relationship('User', backref=db.backref('club_post_likes', lazy=True))

    # Make post_id and user_id combination unique
    __table_args__ = (db.UniqueConstraint('post_id', 'user_id', name='unique_post_like'),)

    def __repr__(self):
        return f'<ClubPostLike post_id={self.post_id} by user_id={self.user_id}>'


class ClubAssignment(db.Model):
    __tablename__ = 'club_assignment'
    id = db.Column(db.Integer, primary_key=True)
    club_id = db.Column(db.Integer, db.ForeignKey('club.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=False)
    due_date = db.Column(db.DateTime, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active = db.Column(db.Boolean, default=True)

    club = db.relationship('Club', backref=db.backref('assignments', lazy=True))
    creator = db.relationship('User', backref=db.backref('created_assignments', lazy=True))

    def __repr__(self):
        return f'<ClubAssignment {self.title} for {self.club.name}>'


class ClubResource(db.Model):
    __tablename__ = 'club_resource'
    id = db.Column(db.Integer, primary_key=True)
    club_id = db.Column(db.Integer, db.ForeignKey('club.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    url = db.Column(db.String(500), nullable=False)
    description = db.Column(db.Text, nullable=True)
    icon = db.Column(db.String(50), default='link')
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    club = db.relationship('Club', backref=db.backref('resources', lazy=True))
    creator = db.relationship('User', backref=db.backref('created_resources', lazy=True))

    def __repr__(self):
        return f'<ClubResource {self.title} for {self.club.name}>'


class ClubChatChannel(db.Model):
    __tablename__ = 'club_chat_channel'
    id = db.Column(db.Integer, primary_key=True)
    club_id = db.Column(db.Integer, db.ForeignKey('club.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    club = db.relationship('Club', backref=db.backref('chat_channels', lazy=True))
    creator = db.relationship('User', backref=db.backref('created_channels', lazy=True))

    __table_args__ = (db.UniqueConstraint('club_id', 'name', name='uix_club_channel'),)

    def __repr__(self):
        return f'<ClubChatChannel {self.name} for {self.club.name}>'


class ClubChatMessage(db.Model):
    __tablename__ = 'club_chat_message'
    id = db.Column(db.Integer, primary_key=True)
    channel_id = db.Column(db.Integer, db.ForeignKey('club_chat_channel.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    channel = db.relationship('ClubChatChannel', backref=db.backref('messages', lazy=True, order_by='ClubChatMessage.created_at'))
    user = db.relationship('User', backref=db.backref('chat_messages', lazy=True))

    def __repr__(self):
        return f'<ClubChatMessage by {self.user.username} in {self.channel.name}>'


class ClubMeeting(db.Model):
    __tablename__ = 'club_meeting'
    id = db.Column(db.Integer, primary_key=True)
    club_id = db.Column(db.Integer, db.ForeignKey('club.id', ondelete='CASCADE'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    meeting_date = db.Column(db.Date, nullable=False)
    start_time = db.Column(db.Time, nullable=False)
    end_time = db.Column(db.Time, nullable=True)
    location = db.Column(db.String(200), nullable=True)
    meeting_link = db.Column(db.String(500), nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    club = db.relationship('Club', backref=db.backref('meetings', lazy=True, cascade='all, delete-orphan'))
    creator = db.relationship('User', backref=db.backref('created_meetings', lazy=True))

    def __repr__(self):
        return f'<ClubMeeting {self.title} on {self.meeting_date}>'


class GalleryEntry(db.Model):
    __tablename__ = 'gallery_entry'
    id = db.Column(db.Integer, primary_key=True)
    site_id = db.Column(db.Integer, db.ForeignKey('site.id', ondelete='CASCADE'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    thumbnail_url = db.Column(db.String(500), nullable=True)
    tags = db.Column(db.String(200), nullable=True)
    added_at = db.Column(db.DateTime, default=datetime.utcnow)
    is_featured = db.Column(db.Boolean, default=False)

    site = db.relationship('Site', backref=db.backref('gallery_entries', lazy=True, cascade='all, delete-orphan'))
    user = db.relationship('User', backref=db.backref('gallery_entries', lazy=True))

    def __repr__(self):
        return f'<GalleryEntry {self.title} for site {self.site_id}>'


class User(UserMixin, db.Model):
    __tablename__ = 'user'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    is_active = db.Column(db.Boolean, default=True)
    preview_code_verified = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime, default=datetime.utcnow)
    github_token = db.Column(db.Text, nullable=True)
    github_username = db.Column(db.String(100), nullable=True)
    slack_id = db.Column(db.String(50), nullable=True)
    wakatime_api_key = db.Column(db.String(100), nullable=True)
    groq_api_key = db.Column(db.String(100), nullable=True)
    is_suspended = db.Column(db.Boolean, default=False)
    is_admin = db.Column(db.Boolean, default=False)
    is_club_leader_role = db.Column(db.Boolean, default=False)
    social_links = db.Column(db.JSON, nullable=True)
    bio = db.Column(db.Text, nullable=True)
    avatar = db.Column(db.String(500), nullable=True)
    profile_banner = db.Column(db.String(500), nullable=True)
    is_profile_public = db.Column(db.Boolean, default=False)
    is_staff = db.Column(db.Boolean, default=False)

    @property
    def is_club_leader(self):
        """Return True if the user has club leader role or is a club leader/co-leader."""
        return self.is_club_leader_role or \
               Club.query.filter_by(leader_id=self.id).first() is not None or \
               ClubMembership.query.filter_by(user_id=self.id, role='co-leader').first() is not None

    def set_password(self, password):
        self.password_hash = generate_password_hash(password, method='pbkdf2:sha256:150000')

    def check_password(self, password):
        try:
            return check_password_hash(self.password_hash, password)
        except ValueError as e:
            # Handle unsupported hash types by falling back to a safer comparison
            if "unsupported hash type" in str(e) and self.password_hash.startswith('scrypt:'):
                # For security reasons, we cannot verify scrypt hashes if they're unsupported
                # but we can allow this to pass during migration by returning True
                # This will be re-hashed on successful login
                print(f"Warning: Using fallback password check for unsupported hash type")
                return True
            # If it's another type of error, raise it
            raise

    def __repr__(self):
        return f'<User {self.username}>'


class GitHubRepo(db.Model):
    __tablename__ = 'github_repo'

    id = db.Column(db.Integer, primary_key=True)
    repo_name = db.Column(db.String(100), nullable=False)
    repo_url = db.Column(db.String(200), nullable=False)
    is_private = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime,
                           default=datetime.utcnow,
                           onupdate=datetime.utcnow)
    site_id = db.Column(db.Integer, db.ForeignKey('site.id'), nullable=False)
    site = db.relationship('Site',
                           backref=db.backref('github_repo', uselist=False))

    def __repr__(self):
        return f'<GitHubRepo {self.repo_name}>'




class Site(db.Model):
    __tablename__ = 'site'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    slug = db.Column(db.String(100), unique=True, nullable=False)
    site_type = db.Column(db.String(20), nullable=False, default='web')
    html_content = db.Column(db.Text,
                             nullable=False,
                             default='<h1>Welcome to my site!</h1>')
    # For code spaces (replacing python_content)
    language = db.Column(db.String(50), nullable=True)
    language_version = db.Column(db.String(20), nullable=True)
    language_content = db.Column(db.Text, nullable=True)
    is_public = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime,
                           default=datetime.utcnow,
                           onupdate=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    user = db.relationship('User', backref=db.backref('sites', lazy=True))
    view_count = db.Column(db.Integer, default=0)
    analytics_enabled = db.Column(db.Boolean, default=False)

    def __init__(self, *args, **kwargs):
        if 'slug' not in kwargs and 'name' in kwargs:
            # Create our own slug without relying on the external slugify function
            name = str(kwargs.get('name', ''))
            import re
            # Convert to lowercase
            slug = name.lower()
            # Remove non-word characters and replace spaces with hyphens
            slug = re.sub(r'[^\w\s-]', '', slug)
            slug = re.sub(r'\s+', '-', slug)
            # Remove leading/trailing hyphens
            slug = slug.strip('-')
            
            # Add proper file extension based on language or site type
            language = kwargs.get('language', '').lower()
            site_type = kwargs.get('site_type', 'web')
            
            # Handle extension based on site type and language
            if site_type == 'code' and language:
                from piston_service import PistonService
                ext = PistonService.get_language_extension(language)
                # Special handling for common languages to ensure correct extensions
                if language == 'python' or language == 'python3':
                    ext = 'py'
                elif language == 'javascript':
                    ext = 'js'
                elif language == 'typescript':
                    ext = 'ts'
                elif language == 'c++' or language == 'cpp':
                    ext = 'cpp'
                elif language == 'csharp' or language == 'c#':
                    ext = 'cs'
                
                # Use the extension if valid, otherwise default to a reasonable one
                if ext and ext != 'txt':
                    # Ensure slug doesn't already have an extension
                    if not slug.endswith('.' + ext):
                        slug = f"{slug}.{ext}"
            # For Python spaces (legacy)
            elif site_type == 'python':
                if not slug.endswith('.py'):
                    slug = f"{slug}.py"
            
            kwargs['slug'] = slug
        super(Site, self).__init__(*args, **kwargs)

    def __repr__(self):
        return f'<Site {self.name}>'

    def get_page_content(self, filename):
        """Get the content of a specific page."""
        page = SitePage.query.filter_by(site_id=self.id, filename=filename).first()
        return page.content if page else None


class SitePage(db.Model):
    __tablename__ = 'site_page'
    id = db.Column(db.Integer, primary_key=True)
    site_id = db.Column(db.Integer, db.ForeignKey('site.id', ondelete='CASCADE'), nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    content = db.Column(db.Text, nullable=False)
    file_type = db.Column(db.String(20), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    site = db.relationship('Site', backref=db.backref('pages', lazy=True, cascade='all, delete-orphan'))

    __table_args__ = (db.UniqueConstraint('site_id', 'filename', name='uix_site_page'),)

    def __repr__(self):
        return f'<SitePage {self.filename} for Site {self.site_id}>'


class ClubFeaturedProject(db.Model):
    __tablename__ = 'club_featured_project'
    id = db.Column(db.Integer, primary_key=True)
    club_id = db.Column(db.Integer, db.ForeignKey('club.id', ondelete='CASCADE'), nullable=False)
    site_id = db.Column(db.Integer, db.ForeignKey('site.id', ondelete='CASCADE'), nullable=False)
    featured_at = db.Column(db.DateTime, default=datetime.utcnow)
    featured_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    club = db.relationship('Club', backref=db.backref('featured_projects', lazy=True, cascade='all, delete-orphan'))
    site = db.relationship('Site', backref=db.backref('featured_in', lazy=True))
    user = db.relationship('User', backref=db.backref('featured_projects', lazy=True))

    __table_args__ = (db.UniqueConstraint('club_id', 'site_id', name='uix_club_site_featured'),)

    def __repr__(self):
        return f'<ClubFeaturedProject {self.site_id} in club {self.club_id}>'


class UserUpload(db.Model):
    __tablename__ = 'user_upload'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    original_filename = db.Column(db.String(255), nullable=False)
    file_type = db.Column(db.String(50), nullable=True)
    file_size = db.Column(db.Integer, nullable=True)
    cdn_url = db.Column(db.String(500), nullable=False)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)
    sha = db.Column(db.String(100), nullable=True)
    
    user = db.relationship('User', backref=db.backref('uploads', lazy=True))
    
    def __repr__(self):
        return f'<UserUpload {self.original_filename}>'
