from flask import Blueprint, jsonify, request, render_template, current_app, send_from_directory
from flask_login import login_required, current_user
import requests
import json
import os
import tempfile
import os
import time
from datetime import datetime
from models import db, UserUpload, User
from sqlalchemy import desc
import mimetypes

cdn_bp = Blueprint('cdn', __name__, url_prefix='/cdn')

# Store the last request sent to the CDN for debugging
last_cdn_request = {
    "headers": {},
    "data": None,
    "url": "",
    "method": ""
}

@cdn_bp.route('/')
@login_required
def cdn_page():
    """Render the CDN file management page"""
    return render_template('cdn.html')

@cdn_bp.route('/upload', methods=['POST'])
@login_required
def upload_files():
    """Handle file uploads to the Hack Club CDN"""
    current_app.logger.info("CDN upload request received")
    current_app.logger.info(f"Request files: {request.files}")
    current_app.logger.info(f"Request form: {request.form}")
    current_app.logger.info(f"Request data: {request.data}")

    if 'files' not in request.files:
        current_app.logger.error("No files found in request")
        return jsonify({'success': False, 'message': 'No files provided'})

    files = request.files.getlist('files')
    current_app.logger.info(f"Files count: {len(files)}")

    for file in files:
        current_app.logger.info(f"File: {file.filename}, Content-Type: {file.content_type}, Size: {file.content_length}")

    if len(files) == 0:
        current_app.logger.error("Empty files list")
        return jsonify({'success': False, 'message': 'No files provided'})

    # Hardcoded API token
    api_token = "beans"
    current_app.logger.info(f"Using API token: {api_token}")

    # Prepare URLs for the CDN API
    file_urls = []

    # Create a temporary directory for storing uploaded files
    import tempfile
    import os
    import uuid
    from werkzeug.utils import secure_filename

    # Create temp directory if it doesn't exist
    temp_dir = os.path.join(tempfile.gettempdir(), 'hc_cdn_temp')
    os.makedirs(temp_dir, exist_ok=True)

    # Clean up old files (older than 5 minutes)
    current_time = time.time()
    for temp_file in os.listdir(temp_dir):
        file_path = os.path.join(temp_dir, temp_file)
        if os.path.isfile(file_path) and (current_time - os.path.getmtime(file_path)) > 300:  # 300 seconds = 5 minutes
            try:
                os.remove(file_path)
                current_app.logger.info(f"Removed old temp file: {file_path}")
            except Exception as e:
                current_app.logger.error(f"Error removing old temp file {file_path}: {str(e)}")

    for file in files:
        if file.filename == '':
            continue

        try:
            # 1. Save file to temporary storage
            secure_name = secure_filename(file.filename)
            unique_filename = f"{uuid.uuid4()}_{secure_name}"
            temp_file_path = os.path.join(temp_dir, unique_filename)
            file.save(temp_file_path)
            current_app.logger.info(f"Saved file to temporary location: {temp_file_path}")

            # 2. Get a URL that can be accessed by the CDN API
            # Construct the temporary URL using the app's URL
            app_url = current_app.config.get('APP_URL')
            if not app_url:
                # Try to get the URL from request
                host = request.host_url.rstrip('/')
                app_url = host
                current_app.logger.info(f"Using host from request: {app_url}")
            
            file_url = f"{app_url}/cdn/temp/{unique_filename}"
            file_urls.append(file_url)
            current_app.logger.info(f"Added URL for file: {file_url}")
        except Exception as e:
            current_app.logger.error(f"Error processing file {file.filename}: {str(e)}")
            return jsonify({'success': False, 'message': f'Error processing file {file.filename}'})

    if len(file_urls) == 0:
        return jsonify({'success': False, 'message': 'No valid files to upload'})

    try:
        # Make request to the Hack Club CDN API
        current_app.logger.info(f"Sending CDN API request with URLs: {file_urls}")

        # Store the actual request data for debugging
        global last_cdn_request
        headers = {
            'Authorization': f'Bearer {api_token}',
            'Content-Type': 'application/json'
        }

        # Save the full request details
        last_cdn_request = {
            "headers": dict(headers),  # Convert to dict to make it JSON serializable
            "data": file_urls,  # This is the actual payload we're sending
            "url": 'https://cdn.hackclub.com/api/v3/new',
            "method": "POST"
        }

        current_app.logger.info(f"Request data: {json.dumps(file_urls)}")
        current_app.logger.info(f"Request headers: {headers}")

        response = requests.post(
            'https://cdn.hackclub.com/api/v3/new',
            headers=headers,
            json=file_urls,  # This should be an array, not an object
            timeout=60  # Longer timeout for large files
        )

        current_app.logger.info(f"CDN API response status: {response.status_code}")
        current_app.logger.info(f"CDN API response headers: {response.headers}")
        current_app.logger.info(f"CDN API response body: {response.text}")

        if response.status_code != 200:
            current_app.logger.error(f"CDN API error: {response.status_code} - {response.text}")
            return jsonify({'success': False, 'message': f'CDN API error: {response.status_code}'})

        # Process the CDN response
        cdn_response = response.json()

        # Save the uploaded files information to database
        for i, file in enumerate(files):
            if file.filename == '':
                continue

            if i >= len(cdn_response['files']):
                break

            file_info = cdn_response['files'][i]
            file_size = file.content_length
            file_type = file.content_type or mimetypes.guess_type(file.filename)[0]

            # Check if this file (by sha) was already uploaded by this user in the last minute
            # This prevents duplicate entries if the same file is uploaded twice
            recent_upload = UserUpload.query.filter_by(
                user_id=current_user.id,
                sha=file_info['sha']
            ).order_by(desc(UserUpload.uploaded_at)).first()
            
            if recent_upload and (datetime.utcnow() - recent_upload.uploaded_at).total_seconds() < 60:
                current_app.logger.info(f"Skipping duplicate upload for {file.filename} with SHA {file_info['sha']}")
                continue

            # Create database record
            upload = UserUpload(
                user_id=current_user.id,
                filename=file_info['file'],
                original_filename=file.filename,
                file_type=file_type,
                file_size=file_size,
                cdn_url=file_info['deployedUrl'],
                sha=file_info['sha']
            )

            db.session.add(upload)

        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Files uploaded successfully',
            'files': cdn_response['files']
        })

    except Exception as e:
        import traceback
        error_traceback = traceback.format_exc()
        current_app.logger.error(f"Error in CDN upload: {str(e)}")
        current_app.logger.error(f"Traceback: {error_traceback}")
        db.session.rollback()

        # Include more detailed error information for debugging
        return jsonify({
            'success': False, 
            'message': f'Error uploading to CDN: {str(e)}',
            'error_details': {
                'type': type(e).__name__,
                'traceback': error_traceback
            }
        }), 500
        
@cdn_bp.route('/temp/<filename>')
def serve_temp_file(filename):
    """Serve temporary files from the hc_cdn_temp directory."""
    temp_dir = os.path.join(tempfile.gettempdir(), 'hc_cdn_temp')
    return send_from_directory(temp_dir, filename)

@cdn_bp.route('/files')
@login_required
def get_user_files():
    """Get all files uploaded by the current user"""
    try:
        uploads = UserUpload.query.filter_by(user_id=current_user.id)\
            .order_by(desc(UserUpload.uploaded_at))\
            .all()

        files = []
        for upload in uploads:
            files.append({
                'id': upload.id,
                'filename': upload.filename,
                'original_filename': upload.original_filename,
                'file_type': upload.file_type,
                'file_size': upload.file_size,
                'cdn_url': upload.cdn_url,
                'uploaded_at': upload.uploaded_at.isoformat(),
                'sha': upload.sha
            })

        return jsonify({
            'success': True,
            'files': files
        })
    except Exception as e:
        current_app.logger.error(f"Error getting user files: {str(e)}")
        return jsonify({'success': False, 'message': f'Error getting files: {str(e)}'})

@cdn_bp.route('/debug-last-request')
@login_required
def debug_last_request():
    """Return the last request sent to the CDN for debugging purposes"""
    global last_cdn_request
    return jsonify(last_cdn_request)

@cdn_bp.route('/files/<int:file_id>/delete', methods=['POST'])
@login_required
def delete_file(file_id):
    """Delete a file from the user's uploads"""
    try:
        upload = UserUpload.query.get_or_404(file_id)

        # Check if the file belongs to the current user
        if upload.user_id != current_user.id:
            return jsonify({'success': False, 'message': 'You do not have permission to delete this file'}), 403

        # Delete the file record from the database
        db.session.delete(upload)
        db.session.commit()

        # Note: The actual file on the CDN cannot be deleted through the API
        # It would remain on the CDN, but the reference to it is removed from our database

        return jsonify({
            'success': True,
            'message': 'File deleted successfully'
        })
    except Exception as e:
        current_app.logger.error(f"Error deleting file {file_id}: {str(e)}")
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Error deleting file: {str(e)}'})