// Check if the current page is club_dashboard before attaching error handlers
const isClubDashboard = window.location.pathname.includes('club-dashboard');

// Skip error handling for club dashboard page
if (!isClubDashboard) {
    window.onerror = function(msg, url, lineNo, columnNo, error) {
        handleError({
            type: 'JavaScript Error',
            message: msg,
            file: url,
            line: lineNo,
            column: columnNo,
            stack: error ? error.stack : null
        });
        return false;
    };

    window.addEventListener('error', function(event) {
        // Only log errors if they exist and aren't null
        if (event.error) {
            console.error('Caught error:', event.error);
            
            event.preventDefault();
            
            if (typeof showToast === 'function') {
                showToast('error', 'An error occurred: ' + (event.error.message || 'Unknown error'));
            }
        }
        
        return true;
    });

    window.addEventListener('unhandledrejection', function(event) {
        handleError({
            type: 'Promise Error',
            message: event.reason.message || 'Unhandled Promise Rejection',
            stack: event.reason.stack
        });
    });
}

$(document).ajaxError(function(event, jqXHR, settings, error) {
    handleError({
        type: 'AJAX Error',
        message: error || 'Network Error',
        status: jqXHR.status,
        responseText: jqXHR.responseText,
        url: settings.url
    });
});

function handleError(errorInfo) {
    let modal = document.getElementById('errorModal');
    if (!modal) {
        modal = createErrorModal();
    }

    updateErrorModal(modal, errorInfo);
    
    // Log to BetterStack if available
    if (window.betterStackLogger) {
        window.betterStackLogger.error(`Client Error: ${errorInfo.message}`, {
            error_type: errorInfo.type,
            file: errorInfo.file,
            line: errorInfo.line,
            column: errorInfo.column,
            stack: errorInfo.stack
        });
    }

    modal.style.display = 'block';
}

function createErrorModal() {
    const modal = document.createElement('div');
    modal.id = 'errorModal';
    modal.className = 'error-modal';
    
    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'error-modal-content';
    
    // Create modal header
    const header = document.createElement('div');
    header.className = 'error-modal-header';
    
    const headerTitle = document.createElement('h2');
    
    const icon = document.createElement('i');
    icon.className = 'fas fa-exclamation-circle';
    
    const errorType = document.createElement('span');
    errorType.id = 'errorType';
    errorType.textContent = 'Error';
    
    const closeButton = document.createElement('button');
    closeButton.className = 'close-button';
    closeButton.innerHTML = '&times;';
    closeButton.addEventListener('click', closeErrorModal);
    
    headerTitle.appendChild(icon);
    headerTitle.appendChild(document.createTextNode(' '));
    headerTitle.appendChild(errorType);
    header.appendChild(headerTitle);
    header.appendChild(closeButton);
    
    // Create modal body
    const body = document.createElement('div');
    body.className = 'error-modal-body';
    
    const errorMessage = document.createElement('div');
    errorMessage.id = 'errorMessage';
    errorMessage.className = 'error-message';
    
    const errorDetails = document.createElement('div');
    errorDetails.id = 'errorDetails';
    errorDetails.className = 'error-details';
    
    const errorLocation = document.createElement('div');
    errorLocation.id = 'errorLocation';
    errorLocation.className = 'error-location';
    
    const errorStack = document.createElement('pre');
    errorStack.id = 'errorStack';
    errorStack.className = 'error-stack';
    
    errorDetails.appendChild(errorLocation);
    errorDetails.appendChild(errorStack);
    body.appendChild(errorMessage);
    body.appendChild(errorDetails);
    
    // Create modal footer
    const footer = document.createElement('div');
    footer.className = 'error-modal-footer';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'error-btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', closeErrorModal);
    
    const reportBtn = document.createElement('button');
    reportBtn.className = 'error-btn error-btn-primary';
    reportBtn.addEventListener('click', reportError);
    
    const bugIcon = document.createElement('i');
    bugIcon.className = 'fas fa-bug';
    reportBtn.appendChild(bugIcon);
    reportBtn.appendChild(document.createTextNode(' Report Issue'));
    
    footer.appendChild(closeBtn);
    footer.appendChild(reportBtn);
    
    // Assemble modal
    modalContent.appendChild(header);
    modalContent.appendChild(body);
    modalContent.appendChild(footer);
    modal.appendChild(modalContent);

    const style = document.createElement('style');
    style.textContent = `
        .error-modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10000;
            animation: fadeIn 0.3s ease-out;
        }

        .error-modal-content {
            position: relative;
            background: white;
            margin: 5% auto;
            padding: 0;
            width: 90%;
            max-width: 600px;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            animation: slideIn 0.3s ease-out;
        }

        .error-modal-header {
            padding: 1rem;
            background: #ff4757;
            color: white;
            border-radius: 8px 8px 0 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .error-modal-header h2 {
            margin: 0;
            font-size: 1.2rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .close-button {
            background: none;
            border: none;
            color: white;
            font-size: 1.5rem;
            cursor: pointer;
            padding: 0;
            line-height: 1;
        }

        .error-modal-body {
            padding: 1.5rem;
            max-height: 70vh;
            overflow-y: auto;
        }

        .error-message {
            font-size: 1.1rem;
            margin-bottom: 1rem;
            color: #2d3436;
        }

        .error-location {
            font-family: monospace;
            background: #f1f2f6;
            padding: 0.5rem;
            border-radius: 4px;
            margin-bottom: 1rem;
            font-size: 0.9rem;
        }

        .error-stack {
            background: #2d3436;
            color: #dfe6e9;
            padding: 1rem;
            border-radius: 4px;
            overflow-x: auto;
            margin: 0;
            font-size: 0.9rem;
            white-space: pre-wrap;
        }

        .error-modal-footer {
            padding: 1rem;
            border-top: 1px solid #eee;
            display: flex;
            justify-content: flex-end;
            gap: 1rem;
        }

        .error-btn {
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9rem;
            transition: all 0.2s;
        }

        .error-btn-primary {
            background: #ff4757;
            color: white;
        }

        .error-btn:hover {
            opacity: 0.9;
            transform: translateY(-1px);
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        @keyframes slideIn {
            from {
                transform: translateY(-20px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }
    `;

    document.head.appendChild(style);
    document.body.appendChild(modal);
    return modal;
}

function updateErrorModal(modal, errorInfo) {
    modal.querySelector('#errorType').textContent = errorInfo.type;
    modal.querySelector('#errorMessage').textContent = errorInfo.message;

    const locationEl = document.createElement('div');
    locationEl.className = 'error-location';
    
    const fileLabel = SafeHTML.createElement('strong', {}, 'File:');
    const fileValue = document.createTextNode(` ${errorInfo.file || 'Unknown'}`);
    locationEl.appendChild(fileLabel);
    locationEl.appendChild(fileValue);
    
    if (errorInfo.line) {
        const lineBreak = document.createElement('br');
        const lineLabel = SafeHTML.createElement('strong', {}, 'Line:');
        const lineValue = document.createTextNode(` ${errorInfo.line}`);
        locationEl.appendChild(lineBreak);
        locationEl.appendChild(lineLabel);
        locationEl.appendChild(lineValue);
    }
    
    if (errorInfo.column) {
        const columnLabel = SafeHTML.createElement('strong', {}, 'Column:');
        const columnValue = document.createTextNode(` ${errorInfo.column}`);
        locationEl.appendChild(document.createTextNode(' '));
        locationEl.appendChild(columnLabel);
        locationEl.appendChild(columnValue);
    }
    
    modal.querySelector('#errorLocation').replaceWith(locationEl);
    
    const stackEl = modal.querySelector('#errorStack');
    if (errorInfo.stack) {
        stackEl.textContent = errorInfo.stack;
        stackEl.style.display = 'block';
    } else {
        stackEl.style.display = 'none';
    }
}

function closeErrorModal() {
    const modal = document.getElementById('errorModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function reportError() {
    const errorDetails = {
        type: document.getElementById('errorType').textContent,
        message: document.getElementById('errorMessage').textContent,
        location: document.getElementById('errorLocation').textContent,
        stack: document.getElementById('errorStack').textContent,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString()
    };

    // First log the error to our server
    fetch('/api/report-error', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(errorDetails)
    }).then(async response => {
        const data = await response.json();
        console.log('Report submission response:', data);
        showToast('success', 'Error report sent successfully. Thank you for helping us improve!');
        
        // Prepare GitHub issue URL with error details
        const title = encodeURIComponent(`Error Report: ${errorDetails.type}`);
        const body = encodeURIComponent(
            `## Error Details\n\n` +
            `**Type:** ${errorDetails.type}\n` +
            `**Message:** ${errorDetails.message}\n` +
            `**Location:** ${errorDetails.location}\n\n` +
            `**User Agent:** ${errorDetails.userAgent}\n` +
            `**Timestamp:** ${errorDetails.timestamp}\n\n` +
            `## Stack Trace\n\`\`\`\n${errorDetails.stack || 'No stack trace available'}\n\`\`\``
        );
        
        // Open GitHub new issue page with prefilled details
        window.open(`https://github.com/hackclub/spaces/issues/new?title=${title}&body=${body}`, '_blank');
        
        closeErrorModal();
    }).catch(err => {
        console.error('Failed to send error report:', err);
        showToast('error', 'Failed to send error report. Please try again later.');
        
        // Try to open GitHub issue anyway as a fallback
        const title = encodeURIComponent(`Error Report: ${errorDetails.type}`);
        const body = encodeURIComponent(`Error occurred but failed to submit to server.\n\n${errorDetails.message}`);
        window.open(`https://github.com/hackclub/spaces/issues/new?title=${title}&body=${body}`, '_blank');
    });
}

function testError(type) {
    switch(type) {
        case 'syntax':
            eval('this is not valid javascript');
            break;
        case 'reference':
            nonExistentFunction();
            break;
        case 'type':
            null.foo();
            break;
        case 'promise':
            Promise.reject(new Error('Test Promise Error'));
            break;
        case 'async':
            setTimeout(() => { throw new Error('Test Async Error'); }, 0);
            break;
    }
}
// Global error handler - skip for club dashboard page
if (!isClubDashboard) {
    window.addEventListener('error', function(event) {
        // Skip if the error is null or undefined
        if (!event.error && !event.message) return;
        
        // Handle cross-origin errors (which show up as "Script error." with no details)
        if (event.message === 'Script error.' && !event.filename) {
            // This is a cross-origin error, we can't get details due to browser security
            console.log('Cross-origin script error detected - this is normal and can be ignored');
            return; // Ignore these errors as they're usually from third-party scripts
        }
        
        const errorInfo = {
            type: event.error ? event.error.name : 'Error',
            message: event.error ? event.error.message : event.message,
            file: event.filename || 'Unknown',
            line: event.lineno || 0,
            column: event.colno || 0,
            stack: event.error ? event.error.stack : null
        };
        
        // Only log if we have a meaningful message
        if (errorInfo.message && errorInfo.message !== 'Script error.') {
            console.error('Caught error:', errorInfo);
            
            // Send error to BetterStack if available
            if (window.betterStackLogger) {
                window.betterStackLogger.error(`JavaScript Error: ${errorInfo.message}`, {
                    error_type: errorInfo.type,
                    file: errorInfo.file,
                    line: errorInfo.line,
                    column: errorInfo.column,
                    stack: errorInfo.stack,
                    url: window.location.href
                });
            }
            
            // Send error to server
            fetch('/api/log-error', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(errorInfo)
            }).catch(err => {
                console.error('Failed to log error:', err);
            });
            
            // Show error toast only for non-cross-origin errors
            if (typeof showToast === 'function') {
                showToast('error', `JavaScript error: ${errorInfo.message}`);
            }
        }
    });

    // Promise rejection handler
    window.addEventListener('unhandledrejection', function(event) {
        // Skip if the reason is null or undefined
        if (!event.reason) return;
        
        const errorInfo = {
            type: 'Promise Rejection',
            message: event.reason ? (event.reason.message || String(event.reason)) : 'Unknown rejection reason',
            stack: event.reason && event.reason.stack ? event.reason.stack : null
        };
        
        // Only log if we have a meaningful message
        if (errorInfo.message) {
            console.error('Unhandled promise rejection:', errorInfo);
            
            // Send error to BetterStack if available
            if (window.betterStackLogger) {
                window.betterStackLogger.error(`Promise Rejection: ${errorInfo.message}`, {
                    error_type: errorInfo.type,
                    stack: errorInfo.stack,
                    url: window.location.href
                });
            }
            
            // Send error to server
            fetch('/api/log-error', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(errorInfo)
            }).catch(err => {
                console.error('Failed to log error:', err);
            });
            
            // Show error toast
            if (typeof showToast === 'function') {
                showToast('error', `Promise error: ${errorInfo.message}`);
            }
        }
    });
}
