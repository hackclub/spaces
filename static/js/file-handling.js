function getFileTypeFromName(filename) {
  if (typeof filename !== 'string') {
    return 'text'; 
  }

  const extension = filename.split('.').pop().toLowerCase();

  if (extension === 'html' || extension === 'htm') {
    return 'html';
  } else if (extension === 'css') {
    return 'css';
  } else if (extension === 'js') {
    return 'javascript';
  } else {
    return 'text';
  }
}

document.addEventListener('DOMContentLoaded', function() {
  const createNewFileBtn = document.getElementById('createNewFile');
  if (createNewFileBtn) {
    createNewFileBtn.addEventListener('click', function() {
      const filenameInput = document.getElementById('newFilename');
      if (!filenameInput) {
        showToast('Filename input not found', 'error');
        return;
      }

      const filename = filenameInput.value.trim();

      if (!filename) {
        showToast('Please enter a filename with extension', 'error');
        return;
      }

      if (!filename.includes('.')) {
        showToast('Please include a file extension (e.g., .html, .css, .js)', 'error');
        return;
      }

      const fileType = getFileTypeFromName(filename);
      createNewFile(filename, fileType);

      closeModal('new-file-modal');
    });
  }
});

function createNewFile(filename, fileType) {
  const siteId = document.getElementById('site-id').value;

  if (typeof filename !== 'string') {
    showToast('Invalid filename', 'error');
    return;
  }

  const extension = filename.split('.').pop().toLowerCase();

  let defaultContent = '';
  if (extension === 'html') {
    defaultContent = '<!DOCTYPE html>\n<html>\n<head>\n    <meta charset="UTF-8">\n    <title>New Page</title>\n    <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n    <h1>New Page</h1>\n    <script src="script.js"></script>\n</body>\n</html>';
  } else if (extension === 'css') {
    defaultContent = '/* Styles for ' + filename + ' */\n\n';
  } else if (extension === 'js') {
    defaultContent = '// JavaScript for ' + filename + '\n\ndocument.addEventListener("DOMContentLoaded", function() {\n    console.log("' + filename + ' loaded");\n});';
  }

  fetch('/api/sites/' + siteId + '/files', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      filename: filename,
      content: defaultContent,
      file_type: extension
    })
  })
  .then(response => {
    if (!response.ok) {
      throw new Error('Error creating file');
    }
    return response.json();
  })
  .then(data => {
    // Update the fileContents object used by editor-core.js
    if (typeof fileContents !== 'undefined') {
      fileContents[filename] = defaultContent;
    }
    
    // Add the file tab using the same logic as editor-core.js
    if (!document.querySelector(`.file-tab[data-filename="${filename}"]`)) {
      addFileTab(filename, extension);
    }
    
    showToast('File created successfully', 'success');

    // Switch to the new file if switchToFile function is available
    if (typeof switchToFile === 'function') {
      switchToFile(filename);
    }

    // Fallback: if editor-core.js has fetchSitePages, call it to refresh the file list
    if (typeof fetchSitePages === 'function') {
      setTimeout(() => {
        fetchSitePages();
      }, 100);
    }

    // Setup context menu for the new tab
    const tab = document.querySelector(`.file-tab[data-filename="${filename}"]`);
    if (tab) {
      // Add context menu listener
      tab.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        showTabContextMenu(filename, e.clientX, e.clientY);
      });
      
      // Add close button functionality if it exists
      const closeBtn = tab.querySelector('.file-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteFile(filename);
        });
      }
    }
  })
  .catch(error => {
    console.error('Error:', error);
    showToast('error', 'Failed to create file: ' + error.message);
  });
}

// Update save message to show "Changes Saved" instead of "success"
function saveMessage(message) {
  return message || "Changes Saved";
}

// Add a small delay before updating preview to ensure the server has processed the changes
function delayedUpdatePreview() {
  setTimeout(() => {
    updatePreview();
  }, 500);
}

function addFileTab(filename, filetype) {
  const fileTabsContainer = document.querySelector('.file-tabs');
  const addButton = document.querySelector('.file-tab-add');

  const newTab = document.createElement('button');
  newTab.className = 'file-tab';
  newTab.setAttribute('data-filename', filename);
  newTab.setAttribute('data-filetype', filetype || getFileTypeFromName(filename));

  // Create icon similar to editor-core.js
  const icon = document.createElement('span');
  icon.className = `file-extension-icon ${filetype || getFileTypeFromName(filename)}-icon`;
  newTab.appendChild(icon);
  
  // Add filename as text node
  newTab.appendChild(document.createTextNode(filename));
  
  // Add close button like in editor-core.js
  const closeBtn = document.createElement('span');
  closeBtn.className = 'file-close';
  closeBtn.textContent = '×';
  newTab.appendChild(closeBtn);

  newTab.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    showTabContextMenu(filename, e.clientX, e.clientY);
  });

  fileTabsContainer.insertBefore(newTab, addButton);

  newTab.addEventListener('click', function() {
    if (typeof switchToFile === 'function') {
      switchToFile(this.getAttribute('data-filename'));
    }
  });

  // Add close button functionality
  closeBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (typeof removeFile === 'function') {
      removeFile(filename);
    } else {
      deleteFile(filename);
    }
  });
}

function deleteFile(filename) {
  const siteId = document.getElementById('site-id').value;

  if (filename === 'index.html') {
    showToast('error', 'Cannot delete index.html');
    return;
  }

  if (!confirm(`Are you sure you want to delete ${filename}?`)) {
    return;
  }

  fetch(`/api/site/${siteId}/page/${filename}`, {
    method: 'DELETE'
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      const tab = document.querySelector(`.file-tab[data-filename="${filename}"]`);
      if (tab) {
        tab.remove();
      }

      if (currentFilename === filename) {
        switchToFile('index.html');
      }

      showToast('success', `File ${filename} deleted successfully`);
    } else {
      showToast('error', data.message || 'Error deleting file');
    }
  })
  .catch(error => {
    console.error('Error deleting file:', error);
    showToast('error', 'Error deleting file');
  });
}


function renameFile(oldFilename, newFilename) {
  const siteId = document.getElementById('site-id').value;
  
  if (!newFilename || newFilename.trim() === '') {
    showToast('error', 'Filename cannot be empty');
    return;
  }
  
  if (oldFilename === 'index.html' && newFilename !== 'index.html') {
    showToast('error', 'Cannot rename index.html');
    return;
  }
  
  fetch(`/api/site/${siteId}/rename`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      old_filename: oldFilename,
      new_filename: newFilename
    })
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      showToast('success', `File renamed from ${oldFilename} to ${newFilename}`);
      
      // Update tab
      const tab = document.querySelector(`.file-tab[data-filename="${oldFilename}"]`);
      if (tab) {
        tab.setAttribute('data-filename', newFilename);
        tab.textContent = newFilename;
      }
      
      // If this was the current file, reload it
      if (currentFilename === oldFilename) {
        currentFilename = newFilename;
        switchToFile(newFilename);
      }
    } else {
      showToast('error', data.message || 'Error renaming file');
    }
  })
  .catch(error => {
    console.error('Error renaming file:', error);
    showToast('error', 'Error renaming file');
  });
}

let contextMenu = null;
let renameDialog = null;

function setupTabContextMenu() {
  if (!contextMenu) {
    contextMenu = document.createElement('div');
    contextMenu.className = 'tab-context-menu';
    document.body.appendChild(contextMenu);
  }

  if (!renameDialog) {
    renameDialog = document.createElement('div');
    renameDialog.className = 'file-rename-dialog';
    renameDialog.innerHTML = `
      <input type="text" id="newFilenameInput">
      <div class="file-rename-dialog-actions">
        <button class="btn-secondary" id="cancelRename">Cancel</button>
        <button class="btn-primary" id="confirmRename">Rename</button>
      </div>
    `;
    document.body.appendChild(renameDialog);

    document.getElementById('cancelRename').addEventListener('click', () => {
      renameDialog.classList.remove('visible');
    });

    document.getElementById('confirmRename').addEventListener('click', () => {
      const oldFilename = renameDialog.getAttribute('data-filename');
      const newFilename = document.getElementById('newFilenameInput').value.trim();
      renameFile(oldFilename, newFilename);
      renameDialog.classList.remove('visible');
    });
  }

  document.querySelectorAll('.file-tab').forEach(tab => {
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const filename = tab.getAttribute('data-filename');
      showTabContextMenu(filename, e.clientX, e.clientY);
    });
  });

  document.addEventListener('click', () => {
    if (contextMenu) {
      contextMenu.classList.remove('visible');
    }
  });
}

function showTabContextMenu(filename, x, y) {
  // Close any existing context menu
  if (contextMenu) {
    contextMenu.remove();
  }

  // Create context menu
  contextMenu = document.createElement('div');
  contextMenu.className = 'tab-context-menu';
  contextMenu.style.position = 'fixed';
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.style.zIndex = '1000';
  contextMenu.style.minWidth = '160px';
  contextMenu.style.padding = '5px 0';
  contextMenu.style.backgroundColor = '#2d2d2d';
  contextMenu.style.borderRadius = '4px';
  contextMenu.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.5)';
  contextMenu.style.overflow = 'hidden';
  contextMenu.style.display = 'flex';
  contextMenu.style.flexDirection = 'column';
  contextMenu.style.gap = '2px';

  // Create rename button
  const renameBtn = document.createElement('button');
  renameBtn.className = 'context-menu-item';
  renameBtn.dataset.action = 'rename';
  renameBtn.style.cssText = 'display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 8px 16px; background: transparent; border: none; color: #e0e0e0; cursor: pointer; font-size: 13px; transition: background-color 0.2s; border-radius: 0;';
  
  renameBtn.onmouseover = function() { this.style.backgroundColor = '#3a3a3a'; };
  renameBtn.onmouseout = function() { this.style.backgroundColor = 'transparent'; };
  
  const renameIcon = document.createElement('i');
  renameIcon.className = 'fas fa-edit';
  renameIcon.style.width = '16px';
  renameIcon.style.textAlign = 'center';
  
  const renameText = document.createTextNode('Rename');
  
  renameBtn.appendChild(renameIcon);
  renameBtn.appendChild(document.createTextNode(' '));
  renameBtn.appendChild(renameText);
  
  // Create delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'context-menu-item';
  deleteBtn.dataset.action = 'delete';
  deleteBtn.style.cssText = 'display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 8px 16px; background: transparent; border: none; color: #ff6b6b; cursor: pointer; font-size: 13px; transition: background-color 0.2s; border-radius: 0;';
  
  deleteBtn.onmouseover = function() { this.style.backgroundColor = '#3a3a3a'; };
  deleteBtn.onmouseout = function() { this.style.backgroundColor = 'transparent'; };
  
  const deleteIcon = document.createElement('i');
  deleteIcon.className = 'fas fa-trash-alt';
  deleteIcon.style.width = '16px';
  deleteIcon.style.textAlign = 'center';
  
  const deleteText = document.createTextNode('Delete');
  
  deleteBtn.appendChild(deleteIcon);
  deleteBtn.appendChild(document.createTextNode(' '));
  deleteBtn.appendChild(deleteText);
  
  // Add buttons to context menu
  contextMenu.appendChild(renameBtn);
  contextMenu.appendChild(deleteBtn);
  
  // Add event listeners
  renameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showRenameDialog(filename, x, y);
  });
  
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteFile(filename);
  });
  
  // Add to document
  document.body.appendChild(contextMenu);
  
  // Make sure menu stays within viewport
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = `${window.innerWidth - rect.width - 10}px`;
  }
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = `${window.innerHeight - rect.height - 10}px`;
  }
  
  // Close menu when clicking elsewhere
  const closeMenu = function(e) {
    if (!contextMenu.contains(e.target)) {
      contextMenu.classList.remove('visible');
      document.removeEventListener('click', closeMenu);
    }
  };
  
  // Add the event listener with a slight delay to prevent immediate closing
  setTimeout(() => {
    document.addEventListener('click', closeMenu);
  }, 10);
}

function showRenameDialog(filename, x, y) {
  // Create rename dialog if it doesn't exist
  if (!renameDialog) {
    renameDialog = document.createElement('div');
    renameDialog.className = 'file-rename-dialog';
    renameDialog.innerHTML = `
      <input type="text" id="newFilenameInput">
      <div class="file-rename-dialog-actions">
        <button class="btn-secondary" id="cancelRename">Cancel</button>
        <button class="btn-primary" id="confirmRename">Rename</button>
      </div>
    `;
    document.body.appendChild(renameDialog);

    document.getElementById('cancelRename').addEventListener('click', () => {
      renameDialog.classList.remove('visible');
    });

    document.getElementById('confirmRename').addEventListener('click', () => {
      const oldFilename = renameDialog.getAttribute('data-filename');
      const newFilename = document.getElementById('newFilenameInput').value.trim();
      
      if (newFilename && newFilename !== oldFilename) {
        renameFile(oldFilename, newFilename);
      }
      
      renameDialog.classList.remove('visible');
    });
  }

  // Hide context menu
  if (contextMenu) {
    contextMenu.classList.remove('visible');
  }

  // Set up the rename dialog
  renameDialog.setAttribute('data-filename', filename);
  document.getElementById('newFilenameInput').value = filename;

  // Position dialog
  renameDialog.style.left = `${x}px`;
  renameDialog.style.top = `${y}px`;
  
  // Make sure dialog stays within viewport
  const rect = renameDialog.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    renameDialog.style.left = `${window.innerWidth - rect.width - 10}px`;
  }
  if (rect.bottom > window.innerHeight) {
    renameDialog.style.top = `${window.innerHeight - rect.height - 10}px`;
  }
  
  // Show the dialog
  renameDialog.classList.add('visible');

  // Focus and select the input
  document.getElementById('newFilenameInput').focus();
  document.getElementById('newFilenameInput').select();
  
  // Handle Escape key to close dialog
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      renameDialog.classList.remove('visible');
      document.removeEventListener('keydown', escHandler);
    }
  };
  
  document.addEventListener('keydown', escHandler);
}

document.addEventListener('DOMContentLoaded', function() {
  setupTabContextMenu();
});
function renameFile(oldFilename, newFilename) {
  const siteId = document.getElementById('site-id').value;

  if (!newFilename || newFilename.trim() === '') {
    showToast('Filename cannot be empty', 'error');
    return;
  }

  if (oldFilename === 'index.html' && newFilename !== 'index.html') {
    showToast('Cannot rename index.html', 'error');
    return;
  }

  if (oldFilename === newFilename) {
    return;
  }

  const existingTab = document.querySelector(`.file-tab[data-filename="${newFilename}"]`);
  if (existingTab) {
    showToast(`File ${newFilename} already exists`, 'error');
    return;
  }

  const content = fileContents[oldFilename] || '';

  fetch(`/api/site/${siteId}/page/${newFilename}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: content
    })
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      fetch(`/api/site/${siteId}/page/${oldFilename}`, {
        method: 'DELETE'
      })
      .then(response => response.json())
      .then(deleteData => {
        if (deleteData.success) {
          const tab = document.querySelector(`.file-tab[data-filename="${oldFilename}"]`);
          if (tab) {
            tab.setAttribute('data-filename', newFilename);
            tab.textContent = newFilename;

            const fileType = getFileType(newFilename);
            tab.setAttribute('data-filetype', fileType);
          }

          fileContents[newFilename] = content;
          delete fileContents[oldFilename];

          if (currentFilename === oldFilename) {
            currentFilename = newFilename;
            switchToFile(newFilename);
          }

          showToast(`File renamed to ${newFilename}`, 'success');
        } else {
          showToast('Error deleting original file', 'error');
        }
      });
    } else {
      showToast(data.message || 'Error renaming file', 'error');
    }
  })
  .catch(error => {
    console.error('Error renaming file:', error);
    showToast('Error renaming file', 'error');
  });
}