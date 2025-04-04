let editor;
let currentFile = "index.html";
let fileContents = {};
let siteId = null;
let siteType = null;
let lastCursorPosition = { line: 0, ch: 0 };
let isDirty = false;

let currentFilename = 'index.html';

function initEditor(initialContent, type) {
    siteType = type;
    siteId = document.getElementById('site-id').value;

    editor = CodeMirror.fromTextArea(document.getElementById("editor"), {
        lineNumbers: true,
        theme: "eclipse",
        indentUnit: 4,
        autoCloseBrackets: true,
        matchBrackets: true,
        autoCloseTags: true,
        lineWrapping: true,
        foldGutter: true,
        gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
        extraKeys: {
            "Ctrl-S": saveContent,
            "Cmd-S": saveContent,
            "Ctrl-Space": "autocomplete",
            "Alt-F": cm => cm.foldCode(cm.getCursor()),
            "Ctrl-Enter": runCode
        }
    });

    if (siteType === 'web') {
        initMultiFileSupport(initialContent);
        setTimeout(() => {
            updatePreview();
        }, 500);
    } else {
        editor.setValue(initialContent || "print('Hello, World!')");
    }

    setupEventListeners();

    setTimeout(() => {
        updateCursorPosition();
        updateFileSize();
    }, 100);

    updateUndoRedoStatus();
}

function initMultiFileSupport(initialHtmlContent) {
    const defaultHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Website</title>
    <link rel="stylesheet" href="styles.css">
    <script src="script.js" defer></script>
</head>
<body>
    <h1>Welcome to my website!</h1>
    <p>This is a paragraph on my new site.</p>
</body>
</html>`;

    const defaultCss = `body {
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
}`;

    const defaultJs = `document.addEventListener('DOMContentLoaded', function() {
    console.log('Website loaded successfully!');
});`;

    fileContents = {
        "index.html": initialHtmlContent || defaultHtml,
        "styles.css": defaultCss,
        "script.js": defaultJs
    };

    editor.setValue(fileContents["index.html"]);

    fetchSitePages();

    setupFileTabListeners();
}

function fetchSitePages() {
    fetch(`/api/site/${siteId}/pages`)
        .then(response => response.json())
        .then(data => {
            if (data.success && data.pages) {
                data.pages.forEach(page => {
                    fileContents[page.filename] = page.content;

                    if (!document.querySelector(`.file-tab[data-filename="${page.filename}"]`) && 
                        !["index.html", "styles.css", "script.js"].includes(page.filename)) {
                        addFileTab(page.filename, page.file_type);
                    }
                });

                if (fileContents[currentFile]) {
                    editor.setValue(fileContents[currentFile]);
                }

                if (siteType === 'web') {
                    updatePreview();
                }
            }
        })
        .catch(error => console.error("Error fetching site pages:", error));
}

function setupFileTabListeners() {
    document.querySelectorAll('.file-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            switchToFile(this.dataset.filename);
        });
    });

    document.getElementById('addFileBtn').addEventListener('click', function() {
        openModal('new-file-modal');
    });

    document.getElementById('createNewFile').addEventListener('click', createNewFile);

    document.getElementById('cancelNewFile').addEventListener('click', function() {
        closeModal('new-file-modal');
    });

    document.querySelectorAll('.modal .close-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            closeModal(modal.id);
        });
    });
}

function switchToFile(filename) {
    if (currentFile) {
        fileContents[currentFile] = editor.getValue();
    }

    currentFile = filename;
    currentFilename = filename;

    document.querySelectorAll('.file-tab').forEach(tab => {
        if (tab.dataset.filename === filename) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    editor.setValue(fileContents[filename] || "");

    setEditorMode(filename);

    updateFileSize();
}

function setEditorMode(filename) {
    const extension = filename.split('.').pop().toLowerCase();

    switch (extension) {
        case 'html':
            editor.setOption('mode', 'htmlmixed');
            break;
        case 'css':
            editor.setOption('mode', 'css');
            break;
        case 'js':
            editor.setOption('mode', 'javascript');
            break;
        default:
            editor.setOption('mode', 'text/plain');
    }
}

function createNewFile() {
    const filename = document.getElementById('newFilename').value.trim();

    if (!filename) {
        showToast("Please enter a filename", "error");
        return;
    }

    const fileType = filename.split('.').pop().toLowerCase();
    let finalFilename = filename;

    if (fileContents[finalFilename]) {
        showToast(`File ${finalFilename} already exists`, "error");
        return;
    }

    addFileTab(finalFilename, fileType);

    let defaultContent = "";
    if (fileType === 'html') {
        defaultContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${finalFilename}</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <h1>${finalFilename}</h1>
    <p>This is a new page.</p>
</body>
</html>`;
    } else if (fileType === 'css') {
        defaultContent = `/* ${finalFilename} styles */
body {
    font-family: Arial, sans-serif;
}`;
    } else if (fileType === 'js') {
        defaultContent = `// ${finalFilename}
console.log('${finalFilename} loaded');`;
    } else {
        defaultContent = ""; 
    }

    fileContents[finalFilename] = defaultContent;

    switchToFile(finalFilename);

    closeModal('new-file-modal');
    showToast(`File ${finalFilename} created`, "success");

    isDirty = true;
}

function addFileTab(filename, fileType) {
    const fileTabsContainer = document.querySelector('.file-tabs');
    const addButton = document.querySelector('.file-tab-add');

    const tab = document.createElement('button');
    tab.className = 'file-tab';
    tab.dataset.filename = filename;
    tab.dataset.filetype = fileType;

    const extensionClass = `${fileType}-file`;
    const iconHtml = `<span class="file-extension-icon ${fileType}-icon"></span>`;

    tab.innerHTML = `${iconHtml}${filename}<span class="file-close">&times;</span>`;

    fileTabsContainer.insertBefore(tab, addButton);

    tab.addEventListener('click', function() {
        switchToFile(filename);
    });

    const closeBtn = tab.querySelector('.file-close');
    closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        removeFile(filename);
    });
}

function removeFile(filename) {
    if (['index.html', 'styles.css', 'script.js'].includes(filename)) {
        showToast("Cannot remove default files", "error");
        return;
    }

    if (confirm(`Are you sure you want to delete ${filename}?`)) {
        const tab = document.querySelector(`.file-tab[data-filename="${filename}"]`);
        tab.remove();

        delete fileContents[filename];

        fetch(`/api/site/${siteId}/page/${filename}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToast(`File ${filename} deleted`, "success");
            } else {
                showToast("Error deleting file", "error");
            }
        })
        .catch(error => {
            console.error("Error deleting file:", error);
            showToast("Error deleting file", "error");
        });

        if (currentFile === filename) {
            switchToFile('index.html');
        }
    }
}

function setupEventListeners() {
    editor.on('cursorActivity', updateCursorPosition);

    editor.on('change', function() {
        updateUndoRedoStatus();
        updateFileSize();
        isDirty = true;
    });

    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveContent();
        }
    });

    document.getElementById('themeSelector').addEventListener('change', function() {
        changeEditorTheme(this.value);
    });

    document.getElementById('fontSizeSelector').addEventListener('change', function() {
        changeEditorFontSize(this.value);
    });

    document.getElementById('wordWrapToggle').addEventListener('change', function() {
        toggleWordWrap(this.checked);
    });

    setInterval(function() {
        if (isDirty) {
            saveContent(true);
        }
    }, 30000);
}

function updateCursorPosition() {
    const cursor = editor.getCursor();
    lastCursorPosition = cursor;
    document.getElementById('cursorPosition').innerHTML = 
        `<i class="fas fa-map-marker-alt"></i> Line ${cursor.line + 1}, Column ${cursor.ch + 1}`;
}

function updateFileSize() {
    const content = editor.getValue();
    const bytes = new Blob([content]).size;
    document.getElementById('fileSize').textContent = bytes;
}

function updateUndoRedoStatus() {
    const history = editor.getDoc().historySize();
    document.getElementById('undoBtn').disabled = history.undo === 0;
    document.getElementById('redoBtn').disabled = history.redo === 0;
}

function changeEditorTheme(theme) {
    editor.setOption('theme', theme);
}

function changeEditorFontSize(size) {
    document.querySelector('.CodeMirror').style.fontSize = size;
}

function toggleWordWrap(enabled) {
    editor.setOption('lineWrapping', enabled);
}

function toggleLinting(enabled) {
    if (enabled) {
        showToast("Linting enabled", "info");
    } else {
        showToast("Linting disabled", "info");
    }
}

function focusSearch() {
    CodeMirror.commands.find(editor);
}

function saveContent(silent = false) {
    fileContents[currentFile] = editor.getValue();

    if (siteType === 'web') {
        if (!fileContents['index.html'] || fileContents['index.html'].trim() === '') {
            showToast("Cannot save with empty index.html", "error");
            return;
        }

        const pages = Object.keys(fileContents).map(filename => {
            const extension = filename.split('.').pop().toLowerCase();
            return {
                filename: filename,
                content: fileContents[filename],
                file_type: extension
            };
        });

        const saveBtn = document.getElementById('saveBtn');
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        saveBtn.disabled = true;

        fetch(`/api/site/${siteId}/save_pages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ pages: pages })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                isDirty = false;
                if (!silent) {
                    showToast("Changes Saved!", "Changes Saved!");
                }
                updatePreview();
            } else {
                showToast("Error saving files", "error");
            }
        })
        .catch(error => {
            console.error("Error saving files:", error);
            showToast("Error saving files", "error");
        })
        .finally(() => {
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
            saveBtn.disabled = false;
        });
    } else {
        const saveBtn = document.getElementById('saveBtn');
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        saveBtn.disabled = true;

        fetch(`/api/site/${siteId}/save`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content: editor.getValue() })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                isDirty = false;
                if (!silent) {
                    showToast("Changes Saved!", "Changes Saved!");
                }
            } else {
                showToast("Error saving content", "error");
            }
        })
        .catch(error => {
            console.error("Error saving content:", error);
            showToast("Error saving content", "error");
        })
        .finally(() => {
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
            saveBtn.disabled = false;
        });
    }
}

function updatePreview() {
    if (siteType !== 'web') return;

    const previewFrame = document.getElementById('preview');
    if (!previewFrame) return;
    
    const siteSlug = document.getElementById('site-slug').value;
    if (!siteSlug) return;
    
    // Use current domain instead of hardcoded domain
    const currentDomain = window.location.hostname;
    const timestamp = new Date().getTime();
    const publicUrl = `https://${currentDomain}/s/${siteSlug}?preview=true&t=${timestamp}`;
    
    // Always set the src attribute to force a refresh
    previewFrame.src = publicUrl;
}

function runCode() {
    if (siteType === 'python') {
        const outputElement = document.getElementById('output');
        outputElement.textContent = "Running...";

        const runBtn = document.getElementById('runBtn');
        runBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running...';
        runBtn.disabled = true;

        fetch(`/api/site/${siteId}/run`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code: editor.getValue() })
        })
        .then(response => response.json())
        .then(data => {
            outputElement.textContent = data.output || "No output";
        })
        .catch(error => {
            console.error("Error running code:", error);
            outputElement.textContent = "Error: " + error.message;
        })
        .finally(() => {
            runBtn.innerHTML = '<i class="fas fa-play"></i> Run';
            runBtn.disabled = false;
        });
    } else {
        saveContent();
    }
}

function formatCode() {
    if (siteType !== 'python') return;

    fetch(`/api/site/${siteId}/format`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code: editor.getValue() })
    })
    .then(response => response.json())
    .then(data => {
        if (data.formatted) {
            editor.setValue(data.formatted);
            showToast("Code formatted successfully", "success");
        } else {
            showToast("Error formatting code", "error");
        }
    })
    .catch(error => {
        console.error("Error formatting code:", error);
        showToast("Error formatting code", "error");
    });
}

function toggleSplitView() {
    const container = document.querySelector('.editor-container');
    container.classList.toggle('split-layout');
    container.classList.toggle('stacked-layout');
}

function deploySite() {
    const siteId = document.getElementById('site-id').value;

    const deployBtn = document.getElementById('deployBtn');
    deployBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deploying...';
    deployBtn.disabled = true;

    saveContent();

    fetch('/api/site/' + siteId + '/deploy', {
        method: 'POST',
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            document.getElementById('deployModal').classList.add('show');
        } else {
            showToast('Error: ' + data.message, 'error');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showToast('Error deploying site', 'error');
    })
    .finally(() => {
        deployBtn.innerHTML = '<i class="fas fa-rocket" style="color: white;"></i> Deploy';
        deployBtn.disabled = false;
    });
}

function openDeployedSite() {
    const siteSlug = document.getElementById('site-slug').value;
    window.open(`https://hackclub.space/s/${siteSlug}`, '_blank');
}

function showKeyboardShortcutsModal() {
    openModal('keyboardShortcutsModal');
}

function closeKeyboardShortcutsModal() {
    closeModal('keyboardShortcutsModal');
}

function closeDeployModal() {
    closeModal('deployModal');
}

function showToast(message, type = "info") {
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toastContainer.removeChild(toast);
        }, 300);
    }, 3000);
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'flex';
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
}

function handleGitAction() {
    openModal('githubModal');
}

function disconnectRepo() {
    if (confirm("Are you sure you want to disconnect this repository?")) {
        fetch(`/api/github/disconnect/${siteId}`, {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToast("Repository disconnected", "success");
                closeModal('githubModal');
            } else {
                showToast("Error disconnecting repository", "error");
            }
        })
        .catch(error => {
            console.error("Error disconnecting repository:", error);
            showToast("Error disconnecting repository", "error");
        });
    }
}

function deleteRepo() {
    if (confirm("Are you sure you want to delete this repository? This action cannot be undone.")) {
        fetch(`/api/github/delete/${siteId}`, {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToast("Repository deleted", "success");
                closeModal('githubModal');
            } else {
                showToast("Error deleting repository", "error");
            }
        })
        .catch(error => {
            console.error("Error deleting repository:", error);
            showToast("Error deleting repository", "error");
        });
    }
}

function initializeTabs() {
    if (document.querySelectorAll('.file-tab').length > 0) {
        document.querySelectorAll('.file-tab').forEach(tab => {
            const filename = tab.getAttribute('data-filename');

            if (!tab.hasAttribute('data-context-menu-added')) {
                tab.addEventListener('contextmenu', function(e) {
                    e.preventDefault();
                    showTabContextMenu(filename, e.clientX, e.clientY);
                });
                tab.setAttribute('data-context-menu-added', 'true');
            }

            tab.addEventListener('click', function() {
                const filename = this.getAttribute('data-filename');
                const filetype = this.getAttribute('data-filetype');
                switchToFile(filename, filetype);
            });
        });

        const addFileBtn = document.getElementById('addFileBtn');
        if (addFileBtn) {
            addFileBtn.addEventListener('click', function() {
                openNewFileModal();
            });
        }
    }

    if (typeof setupTabContextMenu === 'function') {
        setupTabContextMenu();
    }
}


document.addEventListener('DOMContentLoaded', function() {
    const siteContent = document.getElementById('editor').value;
    const siteType = document.getElementById('site-type').value;
    initEditor(siteContent, siteType);

    const addFileBtn = document.getElementById('addFileBtn');
    const newFileModal = document.getElementById('new-file-modal');
    const closeBtn = newFileModal.querySelector('.close-btn');
    const cancelBtn = document.getElementById('cancelNewFile');

    if (addFileBtn) {
        addFileBtn.addEventListener('click', function() {
            newFileModal.style.display = 'flex';
            document.getElementById('newFilename').focus();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            newFileModal.style.display = 'none';
        });
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
            newFileModal.style.display = 'none';
        });
    }

    window.addEventListener('click', function(event) {
        if (event.target === newFileModal) {
            newFileModal.style.display = 'none';
        }
    });
    if (document.getElementById('particles-js')) {
        particlesJS('particles-js', {
            "particles": {
                "number": {
                    "value": 80,
                    "density": {
                        "enable": true,
                        "value_area": 800
                    }
                },
                "color": {
                    "value": "#ed6663"
                },
                "shape": {
                    "type": "circle",
                    "stroke": {
                        "width": 0,
                        "color": "#000000"
                    },
                    "polygon": {
                        "nb_sides": 5
                    }
                },
                "opacity": {
                    "value": 0.5,
                    "random": true,
                    "anim": {
                        "enable": true,
                        "speed": 1,
                        "opacity_min": 0.1,
                        "sync": false
                    }
                },
                "size": {
                    "value": 5,
                    "random": true,
                    "anim": {
                        "enable": true,
                        "speed": 4,
                        "size_min": 0.3,
                        "sync": false
                    }
                },
                "line_linked": {
                    "enable": true,
                    "distance": 150,
                    "color": "#ed6663",
                    "opacity": 0.6,
                    "width": 1
                },
                "move": {
                    "enable": true,
                    "speed": 2,
                    "direction": "none",
                    "random": true,
                    "straight": false,
                    "out_mode": "out",
                    "bounce": false,
                    "attract": {
                        "enable": true,
                        "rotateX": 600,
                        "rotateY": 1200
                    }
                }
            },
            "interactivity": {
                "detect_on": "canvas",
                "events": {
                    "onhover": {
                        "enable": true,
                        "mode": "grab"
                    },
                    "onclick": {
                        "enable": true,
                        "mode": "push"
                    },
                    "resize": true
                },
                "modes": {
                    "grab": {
                        "distance": 140,
                        "line_linked": {
                            "opacity": 1
                        }
                    },
                    "bubble": {
                        "distance": 400,
                        "size": 40,
                        "duration": 2,
                        "opacity": 8,
                        "speed": 3
                    },
                    "repulse": {
                        "distance": 200,
                        "duration": 0.4
                    },
                    "push": {
                        "particles_nb": 4
                    },
                    "remove": {
                        "particles_nb": 2
                    }
                }
            },
            "retina_detect": true
        });
    }

    const loadingFacts = [
        "Building your digital canvas...",
        "Preparing your creative space...",
        "Loading coding environment...",
        "Initializing web tools...",
        "Setting up your workspace...",
        "Connecting to the code universe...",
        "Gathering design elements...",
        "Preparing your digital playground..."
    ];

    let factIndex = 0;
    const factAnimation = setInterval(() => {
        if (document.querySelector('.loading-fact')) {
            document.querySelector('.loading-fact').textContent = loadingFacts[factIndex];
            factIndex = (factIndex + 1) % loadingFacts.length;
        }
    }, 2000);

    setTimeout(() => {
        if (document.querySelector('.loading-progress-fill')) {
            document.querySelector('.loading-progress-fill').style.width = '100%';
        }
    }, 100);

    setTimeout(function() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            clearInterval(factAnimation);
            loadingOverlay.style.opacity = '0';
            setTimeout(() => {
                loadingOverlay.style.display = 'none';
            }, 500);
        }
    }, 3000);
    initializeTabs();
});

function openNewFileModal() {
  openModal('new-file-modal');
}