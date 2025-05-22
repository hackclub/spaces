document.addEventListener('DOMContentLoaded', function() {
    const fileInput = document.getElementById('fileInput');
    const uploadForm = document.getElementById('uploadForm');
    const selectedFiles = document.getElementById('selected-files');
    const uploadProgress = document.getElementById('uploadProgress');
    const progressBarFill = document.getElementById('progressBarFill');
    const progressText = document.getElementById('progressText');
    const filesList = document.getElementById('filesList');
    const copyModal = document.getElementById('copyModal');
    const copyUrlInput = document.getElementById('copyUrlInput');
    const copyUrlBtn = document.getElementById('copyUrlBtn');
    const htmlUsage = document.getElementById('htmlUsage');
    const uploadBtn = document.querySelector('.upload-btn');

    // Disable upload button initially
    uploadBtn.disabled = true;

    // File input change handler
    fileInput.addEventListener('change', function(e) {
        selectedFiles.innerHTML = '';
        if (this.files.length > 0) {
            // Enable upload button when files are selected
            uploadBtn.disabled = false;

            Array.from(this.files).forEach((file, index) => {
                const fileElement = document.createElement('div');
                fileElement.className = 'selected-file';
                fileElement.innerHTML = `
                    <i class="fas fa-file"></i>
                    <span>${file.name}</span>
                    <span class="file-size">(${formatFileSize(file.size)})</span>
                    <i class="fas fa-times remove-file" data-index="${index}"></i>
                `;
                selectedFiles.appendChild(fileElement);
            });

            // Add click handler for remove buttons
            document.querySelectorAll('.remove-file').forEach(btn => {
                btn.addEventListener('click', function() {
                    // This is a bit of a hack since we can't modify FileList directly
                    const dataTransfer = new DataTransfer();
                    const files = fileInput.files;
                    const index = parseInt(this.getAttribute('data-index'));

                    for (let i = 0; i < files.length; i++) {
                        if (i !== index) {
                            dataTransfer.items.add(files[i]);
                        }
                    }

                    fileInput.files = dataTransfer.files;
                    this.closest('.selected-file').remove();

                    // Disable upload button if no files left
                    if (fileInput.files.length === 0) {
                        uploadBtn.disabled = true;
                    }

                    // Update indices after removal
                    document.querySelectorAll('.remove-file').forEach((btn, i) => {
                        btn.setAttribute('data-index', i);
                    });
                });
            });
        } else {
            // Disable upload button when no files are selected
            uploadBtn.disabled = true;
        }
    });

    // Upload form submit handler
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();

        if (!fileInput.files.length) {
            showToast('Please select files to upload', 'error');
            return;
        }

        uploadFiles(fileInput.files);
    });

    // Drag and drop handlers
    const dropZone = document.querySelector('.file-input-container');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });

    function highlight() {
        dropZone.style.borderColor = '#ec3750';
        dropZone.style.backgroundColor = 'rgba(236, 55, 80, 0.05)';
    }

    function unhighlight() {
        dropZone.style.borderColor = 'var(--border-color)';
        dropZone.style.backgroundColor = '';
    }

    dropZone.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        fileInput.files = files;

        // Trigger change event to update UI
        const event = new Event('change');
        fileInput.dispatchEvent(event);
    }

    // File upload function
    function uploadFiles(files) {
        // Check if files is undefined or empty
        if (!files || files.length === 0) {
            showToast('Please select files to upload', 'error');
            return;
        }

        const formData = new FormData();

        // Append files to FormData
        for (let i = 0; i < files.length; i++) {
            formData.append('files', files[i]);
        }

        // Show progress bar
        uploadProgress.style.display = 'block';
        progressBarFill.style.width = '0%';
        progressText.textContent = 'Preparing upload...';

        // Send the request
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', function(e) {
            if (e.lengthComputable) {
                const percentComplete = Math.round((e.loaded / e.total) * 100);
                progressBarFill.style.width = percentComplete + '%';
                progressText.textContent = `Uploading... ${percentComplete}%`;
            }
        });

        xhr.addEventListener('load', function() {
            if (xhr.status >= 200 && xhr.status < 300) {
                const response = JSON.parse(xhr.responseText);

                if (response.success) {
                    progressText.textContent = 'Upload complete!';
                    showToast('Files uploaded successfully', 'success');

                    // Clear file input
                    fileInput.value = '';
                    selectedFiles.innerHTML = '';

                    // Refresh file list
                    setTimeout(() => {
                        uploadProgress.style.display = 'none';
                        loadUserFiles();
                    }, 2000);
                } else {
                    progressText.textContent = 'Upload failed: ' + response.message;
                    showToast(response.message, 'error');
                }
            } else {
                progressText.textContent = 'Upload failed!';
                showToast('Failed to upload files', 'error');
            }
        });

        xhr.addEventListener('error', function() {
            progressText.textContent = 'Network error occurred!';
            showToast('Network error occurred. Check console for details.', 'error');
            console.error('CDN upload failed. The Hack Club CDN API requires publicly accessible URLs to files.');
        });

        xhr.addEventListener('readystatechange', function() {
            if (xhr.readyState === 4) {
                console.log('CDN Upload Response Status:', xhr.status);
                console.log('CDN Upload Response Headers:', xhr.getAllResponseHeaders());
                console.log('CDN Upload Response Body:', xhr.responseText);

                if (xhr.status >= 400) {
                    try {
                        const errorResponse = JSON.parse(xhr.responseText);
                        console.error('CDN Upload Error Details:', errorResponse);
                        if (errorResponse.error_details) {
                            console.error('Error Type:', errorResponse.error_details.type);
                            console.error('Error Traceback:', errorResponse.error_details.traceback);
                        }
                    } catch (e) {
                        console.error('Could not parse error response', e);
                    }
                }
            }
        });

        xhr.addEventListener('abort', function() {
            progressText.textContent = 'Upload aborted!';
            showToast('Upload aborted', 'warning');
        });

        xhr.open('POST', '/cdn/upload');

        // Get the CSRF token
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
        xhr.setRequestHeader('X-CSRFToken', csrfToken);

        // Log the raw request details to console
        console.log('CDN Upload Request:');
        console.log('URL:', '/cdn/upload');
        console.log('Method:', 'POST');
        console.log('Headers:', {
            'X-CSRFToken': csrfToken,
            'Content-Type': 'application/json'
        });

        // Check what the server is actually sending to the Hack Club CDN
        // Create a second XHR to inspect the actual request sent to the CDN
        const inspectXhr = new XMLHttpRequest();
        inspectXhr.open('GET', '/cdn/debug-last-request');
        inspectXhr.responseType = 'json';
        inspectXhr.onload = function() {
            if (inspectXhr.status === 200) {
                console.log('FULL REQUEST SENT TO HACK CLUB CDN:');
                console.log(JSON.stringify(inspectXhr.response, null, 2));
            }
        };
        inspectXhr.send();

        // Still log the file info for reference
        console.log('Files being uploaded (client side):');
        let fileCount = 0;
        for (const pair of formData.entries()) {
            if (pair[0] === 'files') {
                fileCount++;
                const file = pair[1];
                console.log('File:', {
                    name: file.name,
                    type: file.type,
                    size: file.size + ' bytes (' + formatFileSize(file.size) + ')',
                    lastModified: new Date(file.lastModified).toISOString()
                });
            }
        }

        // Only send if we haven't already processed these files
        if (fileCount > 0) {
            xhr.send(formData);
        }
    }

    // Load user's files
    function loadUserFiles() {
        filesList.innerHTML = `
            <div class="loading-files">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Loading your files...</span>
            </div>
        `;

        fetch('/cdn/files')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    if (data.files.length === 0) {
                        filesList.innerHTML = `
                            <div class="no-files">
                                <p>You haven't uploaded any files yet.</p>
                            </div>
                        `;
                        return;
                    }

                    filesList.innerHTML = '';

                    data.files.forEach(file => {
                        const fileElement = document.createElement('div');
                        fileElement.className = 'file-item';

                        // Determine file icon based on file type
                        let fileIcon = 'fa-file';
                        if (file.file_type) {
                            if (file.file_type.includes('image')) {
                                fileIcon = 'fa-file-image';
                            } else if (file.file_type.includes('video')) {
                                fileIcon = 'fa-file-video';
                            } else if (file.file_type.includes('audio')) {
                                fileIcon = 'fa-file-audio';
                            } else if (file.file_type.includes('pdf')) {
                                fileIcon = 'fa-file-pdf';
                            } else if (file.file_type.includes('word') || file.file_type.includes('document')) {
                                fileIcon = 'fa-file-word';
                            } else if (file.file_type.includes('excel') || file.file_type.includes('spreadsheet')) {
                                fileIcon = 'fa-file-excel';
                            } else if (file.file_type.includes('zip') || file.file_type.includes('archive')) {
                                fileIcon = 'fa-file-archive';
                            } else if (file.file_type.includes('text')) {
                                fileIcon = 'fa-file-alt';
                            } else if (file.file_type.includes('html')) {
                                fileIcon = 'fa-file-code';
                            }
                        }

                        fileElement.innerHTML = `
                            <div class="file-name">
                                <i class="fas ${fileIcon} file-icon"></i>
                                <span class="file-original-name" title="${file.original_filename}">${file.original_filename}</span>
                            </div>
                            <div class="file-size">${formatFileSize(file.file_size)}</div>
                            <div class="file-date">${formatDate(file.uploaded_at)}</div>
                            <div class="file-actions">
                                <button class="file-action-btn copy-url" title="Copy URL" data-url="${file.cdn_url}" data-filename="${file.original_filename}">
                                    <i class="fas fa-link"></i>
                                </button>
                                <button class="file-action-btn open-file" title="Open file" data-url="${file.cdn_url}">
                                    <i class="fas fa-external-link-alt"></i>
                                </button>
                                <button class="file-action-btn delete-file" title="Delete file" data-id="${file.id}">
                                    <i class="fas fa-trash-alt"></i>
                                </button>
                            </div>
                        `;

                        filesList.appendChild(fileElement);
                    });

                    // Add event listeners for file actions
                    attachFileActionHandlers();
                } else {
                    filesList.innerHTML = `
                        <div class="no-files">
                            <p>Error loading files: ${data.message}</p>
                        </div>
                    `;
                }
            })
            .catch(error => {
                console.error('Error loading files:', error);
                filesList.innerHTML = `
                    <div class="no-files">
                        <p>Failed to load files. Please try again later.</p>
                    </div>
                `;
            });
    }

    // Attach event handlers for file actions
    function attachFileActionHandlers() {
        // Copy URL button
        document.querySelectorAll('.copy-url').forEach(btn => {
            btn.addEventListener('click', function() {
                const url = this.getAttribute('data-url');
                const filename = this.getAttribute('data-filename');

                // Set input value
                copyUrlInput.value = url;

                // Set HTML usage example
                let htmlExample = '';
                if (url.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
                    htmlExample = `<img src="${url}" alt="${filename}">`;
                } else if (url.match(/\.(mp4|webm|ogg)$/i)) {
                    htmlExample = `<video controls>
  <source src="${url}" type="video/${url.split('.').pop().toLowerCase()}">
  Your browser does not support the video tag.
</video>`;
                } else if (url.match(/\.(mp3|wav)$/i)) {
                    htmlExample = `<audio controls>
  <source src="${url}" type="audio/${url.split('.').pop().toLowerCase()}">
  Your browser does not support the audio tag.
</audio>`;
                } else {
                    htmlExample = `<a href="${url}" target="_blank">${filename}</a>`;
                }

                htmlUsage.textContent = htmlExample;

                // Show modal
                copyModal.style.display = 'flex';
            });
        });

        // Open file button
        document.querySelectorAll('.open-file').forEach(btn => {
            btn.addEventListener('click', function() {
                window.open(this.getAttribute('data-url'), '_blank');
            });
        });

        // Delete file button
        document.querySelectorAll('.delete-file').forEach(btn => {
            btn.addEventListener('click', function() {
                const fileId = this.getAttribute('data-id');
                const fileElement = this.closest('.file-item');
                const fileName = fileElement.querySelector('.file-original-name').textContent;

                // Show delete confirmation modal
                const deleteModal = document.getElementById('deleteModal');
                const fileToDelete = document.getElementById('fileToDelete');
                const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

                fileToDelete.textContent = fileName;
                deleteModal.style.display = 'flex';

                // Confirm delete button
                confirmDeleteBtn.onclick = function() {
                    deleteFile(fileId, fileElement);
                    deleteModal.style.display = 'none';
                };

                // Cancel delete button
                document.getElementById('cancelDeleteBtn').onclick = function() {
                    deleteModal.style.display = 'none';
                };

                // Close when clicking outside
                window.onclick = function(e) {
                    if (e.target === deleteModal) {
                        deleteModal.style.display = 'none';
                    }
                };
            });
        });
    }

    // Delete file function
    function deleteFile(fileId, fileElement) {
        // Get the CSRF token
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

        fetch(`/cdn/files/${fileId}/delete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Remove the file element from the list
                fileElement.remove();
                showToast('File deleted successfully', 'success');

                // If no files left, show no files message
                if (filesList.children.length === 0) {
                    filesList.innerHTML = `
                        <div class="no-files">
                            <p>You haven't uploaded any files yet.</p>
                        </div>
                    `;
                }
            } else {
                showToast(data.message, 'error');
            }
        })
        .catch(error => {
            console.error('Error deleting file:', error);
            showToast('Failed to delete file', 'error');
        });
    }

    // Copy URL button in modal
    copyUrlBtn.addEventListener('click', function() {
        copyUrlInput.select();
        navigator.clipboard.writeText(copyUrlInput.value)
            .then(() => {
                showToast('URL copied to clipboard', 'success');
            })
            .catch(err => {
                console.error('Could not copy text: ', err);
                // Fallback to older method
                copyUrlInput.select();
                document.execCommand('copy');
                showToast('URL copied to clipboard', 'success');
            });
    });

    // Close modals
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) {
                modal.style.display = 'none';
            }
        });
    });

    // Close modals when clicking outside
    window.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
    });

    // Helper functions
    function formatFileSize(bytes) {
        if (!bytes) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    // Toast notification function
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        let icon = 'info-circle';
        if (type === 'success') icon = 'check-circle';
        if (type === 'error') icon = 'exclamation-circle';
        if (type === 'warning') icon = 'exclamation-triangle';

        toast.innerHTML = `
            <div class="toast-icon">
                <i class="fas fa-${icon}"></i>
            </div>
            <div class="toast-content">${message}</div>
            <button class="toast-close">
                <i class="fas fa-times"></i>
            </button>
        `;

        document.getElementById('toast-container').appendChild(toast);

        // Add event listener to close button
        toast.querySelector('.toast-close').addEventListener('click', function() {
            toast.remove();
        });

        // Auto-remove toast after 5 seconds
        setTimeout(() => {
            toast.classList.add('toast-fade-out');
            setTimeout(() => {
                toast.remove();
            }, 500);
        }, 5000);
    }

    // Load files on page load
    loadUserFiles();

// Make the upload button work
document.getElementById('uploadForm').addEventListener('submit', function(e) {
    e.preventDefault();
    // Pass the fileInput.files to the uploadFiles function
    uploadFiles(fileInput.files);
});

// The fileInput and uploadBtn variables are already declared above
// Just add the event listener without redeclaring
fileInput.addEventListener('change', function() {
    if (this.files.length > 0) {
        uploadBtn.removeAttribute('disabled');
        uploadBtn.style.opacity = '1';
        uploadBtn.style.cursor = 'pointer';
    } else {
        uploadBtn.setAttribute('disabled', true);
        uploadBtn.style.opacity = '0.5';
        uploadBtn.style.cursor = 'not-allowed';
    }
});
});