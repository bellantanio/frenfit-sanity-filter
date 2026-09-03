// ==UserScript==
// @name         Frenf.it Feed Filter
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Block users/rooms/keywords, wildcards for users/rooms, draggable icon, export/import
// @match        *://*.frenf.it/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration & UI Setup ---

    // Load saved settings from localStorage
    let filterEnabled = JSON.parse(localStorage.getItem('frenfFilterEnabled'));
    if (filterEnabled === null) filterEnabled = true; // Default to true if not set

    let blockedUsers = JSON.parse(localStorage.getItem('frenfBlockedUsers')) || [];
    let blockedRooms = JSON.parse(localStorage.getItem('frenfBlockedRooms')) || [];
    let blockedKeywords = JSON.parse(localStorage.getItem('frenfBlockedKeywords')) || [];

    // Load saved icon position
    let iconPos = JSON.parse(localStorage.getItem('frenfFilterIconPos')) || { bottom: '20px', right: '20px', top: 'auto', left: 'auto' };

    // Create the icon (semi-transparent, no label)
    const filterIcon = document.createElement('div');
    filterIcon.innerHTML = '&#9881;'; // Gear icon
    Object.assign(filterIcon.style, {
        position: 'fixed',
        bottom: iconPos.bottom,
        right: iconPos.right,
        top: iconPos.top,
        left: iconPos.left,
        fontSize: '32px',
        cursor: 'move', // Indicate it is draggable
        zIndex: '10000',
        opacity: '0.5',
        color: '#555',
        textShadow: '0 0 3px rgba(255,255,255,0.8)',
        userSelect: 'none'
    });

    // Update icon color based on active and enabled filters
    function updateIconState() {
        if (filterEnabled && (blockedUsers.length > 0 || blockedRooms.length > 0 || blockedKeywords.length > 0)) {
            filterIcon.style.color = 'red';
            filterIcon.style.opacity = '0.8'; // slightly more visible when active
        } else {
            filterIcon.style.color = '#555';
            filterIcon.style.opacity = '0.5';
        }
    }

    // Create the configuration box
    const configBox = document.createElement('div');
    Object.assign(configBox.style, {
        position: 'fixed',
        bottom: '60px',
        right: '20px',
        backgroundColor: '#ffffff',
        border: '1px solid #ccc',
        padding: '20px',
        borderRadius: '8px',
        zIndex: '10000',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        display: 'none',
        flexDirection: 'column',
        width: '300px',
        fontFamily: 'sans-serif',
        color: '#333'
    });

    configBox.innerHTML = `
        <h4 style="margin-top:0;">Feed Filters</h4>

        <label style="display:flex; align-items:center; margin-bottom:15px; font-weight:bold; cursor:pointer;">
            <input type="checkbox" id="filterEnableCheckbox" ${filterEnabled ? 'checked' : ''} style="margin-right:8px; cursor:pointer;">
            Enable Filters
        </label>

        <label style="font-size:12px; margin-bottom:5px;">Blocked Users (* and ? wildcards supported)</label>
        <textarea id="blockedUsersInput" rows="3" style="width:100%; margin-bottom:10px; box-sizing:border-box; border-radius:4px; border:1px solid #ccc; padding:5px;">${blockedUsers.map(u => (u.includes('*') || u.includes('?')) ? u : '@' + u).join('\n')}</textarea>

        <label style="font-size:12px; margin-bottom:5px;">Blocked Rooms (* and ? wildcards supported)</label>
        <textarea id="blockedRoomsInput" rows="3" style="width:100%; margin-bottom:10px; box-sizing:border-box; border-radius:4px; border:1px solid #ccc; padding:5px;">${blockedRooms.join('\n')}</textarea>

        <label style="font-size:12px; margin-bottom:5px;">Blocked Keywords in Posts (NO wildcards)</label>
        <textarea id="blockedKeywordsInput" rows="3" style="width:100%; margin-bottom:15px; box-sizing:border-box; border-radius:4px; border:1px solid #ccc; padding:5px;">${blockedKeywords.join('\n')}</textarea>

        <button id="saveFiltersBtn" style="background-color:#5cb85c; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer; font-weight:bold; margin-bottom: 10px;">Save & Apply</button>
        
        <div style="display: flex; gap: 10px;">
            <button id="exportFiltersBtn" style="background-color:#0275d8; color:white; border:none; padding:6px; border-radius:4px; cursor:pointer; flex: 1; font-size: 12px; font-weight:bold;">Export</button>
            <button id="importFiltersBtn" style="background-color:#f0ad4e; color:white; border:none; padding:6px; border-radius:4px; cursor:pointer; flex: 1; font-size: 12px; font-weight:bold;">Import</button>
        </div>
    `;

    document.body.appendChild(filterIcon);
    document.body.appendChild(configBox);

    // --- Fix Enter Key in Textareas ---
    const preventGlobalSubmit = (e) => {
        if (e.key === 'Enter' || e.keyCode === 13) {
            e.stopPropagation();
        }
    };
    document.getElementById('blockedUsersInput').addEventListener('keydown', preventGlobalSubmit);
    document.getElementById('blockedRoomsInput').addEventListener('keydown', preventGlobalSubmit);
    document.getElementById('blockedKeywordsInput').addEventListener('keydown', preventGlobalSubmit);

    // --- Immediate Toggle Logic for Checkbox ---
    document.getElementById('filterEnableCheckbox').addEventListener('change', (e) => {
        filterEnabled = e.target.checked;
        localStorage.setItem('frenfFilterEnabled', JSON.stringify(filterEnabled));
        
        updateIconState();
        resetFilters();
        
        if (filterEnabled) {
            applyFilters();
        }
    });

    // --- Drag, Click, and Double-Click Logic ---
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    let clickTimeout; // Used to differentiate between single and double clicks

    filterIcon.addEventListener('mousedown', (e) => {
        isDragging = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = filterIcon.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        function onMouseMove(moveEvent) {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;

            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                isDragging = true;
            }

            if (isDragging) {
                filterIcon.style.bottom = 'auto';
                filterIcon.style.right = 'auto';
                filterIcon.style.left = (initialLeft + dx) + 'px';
                filterIcon.style.top = (initialTop + dy) + 'px';
            }
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (isDragging) {
                localStorage.setItem('frenfFilterIconPos', JSON.stringify({
                    top: filterIcon.style.top,
                    left: filterIcon.style.left,
                    bottom: 'auto',
                    right: 'auto'
                }));
            }
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // Single Click: Open Settings (delayed slightly to wait for a double-click)
    filterIcon.addEventListener('click', () => {
        if (isDragging) return;
        
        clearTimeout(clickTimeout);
        clickTimeout = setTimeout(() => {
            configBox.style.display = configBox.style.display === 'none' ? 'flex' : 'none';
        }, 250); // 250ms delay
    });

    // Double Click: Instantly Toggle Filters
    filterIcon.addEventListener('dblclick', () => {
        clearTimeout(clickTimeout); // Cancel the single-click menu toggle
        
        filterEnabled = !filterEnabled; // Toggle state
        document.getElementById('filterEnableCheckbox').checked = filterEnabled; // Sync checkbox UI
        localStorage.setItem('frenfFilterEnabled', JSON.stringify(filterEnabled)); // Save
        
        updateIconState();
        resetFilters();
        
        if (filterEnabled) {
            applyFilters();
        }
    });

    // Save configuration button
    document.getElementById('saveFiltersBtn').addEventListener('click', () => {
        filterEnabled = document.getElementById('filterEnableCheckbox').checked;
        const usersInput = document.getElementById('blockedUsersInput').value;
        const roomsInput = document.getElementById('blockedRoomsInput').value;
        const keywordsInput = document.getElementById('blockedKeywordsInput').value;

        blockedUsers = usersInput.split(/\r?\n/)
            .map(s => s.trim().replace(/^@/, '').toLowerCase())
            .filter(s => s.length > 0);
            
        blockedRooms = roomsInput.split(/\r?\n/)
            .map(s => s.trim().replace(/^[@\/]/, '').toLowerCase()) // handle trailing slashes just in case
            .filter(s => s.length > 0);

        blockedKeywords = keywordsInput.split(/\r?\n/)
            .map(s => s.trim().toLowerCase())
            .filter(s => s.length > 0);

        localStorage.setItem('frenfFilterEnabled', JSON.stringify(filterEnabled));
        localStorage.setItem('frenfBlockedUsers', JSON.stringify(blockedUsers));
        localStorage.setItem('frenfBlockedRooms', JSON.stringify(blockedRooms));
        localStorage.setItem('frenfBlockedKeywords', JSON.stringify(blockedKeywords));

        configBox.style.display = 'none';
        updateIconState();

        resetFilters();
        if (filterEnabled) {
            applyFilters();
        }
    });

    // --- Export Settings Logic ---
    document.getElementById('exportFiltersBtn').addEventListener('click', () => {
        const exportData = {
            filterEnabled: filterEnabled,
            blockedUsers: blockedUsers,
            blockedRooms: blockedRooms,
            blockedKeywords: blockedKeywords,
            iconPos: iconPos
        };
        
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "frenfit_filters.json");
        document.body.appendChild(downloadAnchorNode); // required for firefox
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    });

    // --- Import Settings Logic ---
    document.getElementById('importFiltersBtn').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = event => {
                try {
                    const imported = JSON.parse(event.target.result);
                    
                    if (imported.blockedUsers) {
                        document.getElementById('blockedUsersInput').value = imported.blockedUsers.map(u => (u.includes('*') || u.includes('?')) ? u : '@' + u).join('\n');
                    }
                    if (imported.blockedRooms) {
                        document.getElementById('blockedRoomsInput').value = imported.blockedRooms.join('\n');
                    }
                    if (imported.blockedKeywords) {
                        document.getElementById('blockedKeywordsInput').value = imported.blockedKeywords.join('\n');
                    }
                    if (typeof imported.filterEnabled === 'boolean') {
                        document.getElementById('filterEnableCheckbox').checked = imported.filterEnabled;
                    }
                    
                    alert("Settings imported successfully! Click 'Save & Apply' to confirm your changes.");
                } catch (err) {
                    alert("Error: Invalid settings file.");
                }
            };
            reader.readAsText(file);
        };
        input.click();
    });

    // --- Helper Functions ---
    function getHandleFromLink(linkElement) {
        if (!linkElement || !linkElement.href) return "";
        const parts = linkElement.href.split('/');
        return parts[parts.length - 1].toLowerCase();
    }
    
    // Check if handle matches a pattern string (supporting * and ?)
    function isMatch(handle, list) {
        if (!handle) return false;
        return list.some(pattern => {
            if (pattern.includes('*') || pattern.includes('?')) {
                // Escape characters regex uses naturally, except * and ?
                let regexPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
                return new RegExp('^' + regexPattern + '$', 'i').test(handle);
            }
            return handle === pattern; // Exact match fallback
        });
    }

    // Function to completely restore the DOM back to its original state
    function resetFilters() {
        // 1. Unhide main posts
        document.querySelectorAll('.entry').forEach(el => el.style.display = '');

        // 2. Restore scrambled comments
        document.querySelectorAll('.comment-body[data-scrambled="true"]').forEach(comment => {
            // Restore Author Name
            const authorLink = comment.querySelector('.commentLinks a.user');
            if (authorLink && authorLink.dataset.origText) {
                authorLink.textContent = authorLink.dataset.origText;
                delete authorLink.dataset.origText;
            }

            // Restore Comment Text
            comment.querySelectorAll('.frenf-scrambled-text').forEach(span => {
                const textNode = document.createTextNode(span.dataset.origText);
                span.parentNode.replaceChild(textNode, span);
            });

            delete comment.dataset.scrambled;
        });
    }

    // Function to scramble a single comment
    function scrambleComment(comment) {
        if (comment.dataset.scrambled) return; // Prevent double scrambling

        // 1. Replace Author Name
        const authorLink = comment.querySelector('.commentLinks a.user');
        if (authorLink) {
            authorLink.dataset.origText = authorLink.textContent;
            authorLink.textContent = "ON VACATION";
        }

        // 2. Find all pure text nodes within the comment
        const walk = document.createTreeWalker(comment, NodeFilter.SHOW_TEXT, null, false);
        let nodesToReplace = [];
        let n;
        while(n = walk.nextNode()) {
            // Skip text inside the header (date, buttons, links) to not break the UI
            if (n.parentNode.closest('.commentLinks')) continue;

            // Only process text nodes that actually contain text
            if (n.nodeValue.trim().length > 0) {
                nodesToReplace.push(n);
            }
        }

        // 3. Replace text node content with special characters
        const chars = '!@#$%^&*()_+-=[]{}|;:,.<>?~';
        nodesToReplace.forEach(node => {
            const span = document.createElement('span');
            span.className = 'frenf-scrambled-text';
            span.dataset.origText = node.nodeValue; // Save original text

            let scrambled = '';
            for (let i = 0; i < node.nodeValue.length; i++) {
                const char = node.nodeValue[i];
                // Preserve whitespaces and linebreaks to keep the visual shape exactly the same
                if (char.match(/\s/)) {
                    scrambled += char;
                } else {
                    scrambled += chars.charAt(Math.floor(Math.random() * chars.length));
                }
            }
            span.textContent = scrambled;
            node.parentNode.replaceChild(span, node);
        });

        // Mark as scrambled so we can find it to undo it later
        comment.dataset.scrambled = "true";
    }

    function applyFilters() {
        if (!filterEnabled) return;
        if (blockedUsers.length === 0 && blockedRooms.length === 0 && blockedKeywords.length === 0) return;

        // 1. Filter Main Posts (.entry) - Still hidden entirely
        const entries = document.querySelectorAll('.entry');
        entries.forEach(entry => {
            // Target the specific user anchor to grab author
            const authorLink = entry.querySelector('.entry-body.public strong.media-heading a.user') || entry.querySelector('.media-heading a.user');
            const authorHandle = getHandleFromLink(authorLink);
            
            // Get all other room anchors (a.user inside .entry-body that are not the author in strong)
            const roomLinks = entry.querySelectorAll('.entry-body a.user:not(strong.media-heading a.user)');
            const roomHandles = Array.from(roomLinks).map(getHandleFromLink);

            const textElement = entry.querySelector('.entry-text');
            const postText = textElement ? textElement.innerText.toLowerCase() : "";

            let shouldBlock = false;

            // Check if Author is blocked (with wildcards)
            if (isMatch(authorHandle, blockedUsers)) {
                shouldBlock = true;
            }

            // Check if any listed Room is blocked (with wildcards)
            if (!shouldBlock && blockedRooms.length > 0) {
                if (roomHandles.some(room => isMatch(room, blockedRooms))) {
                    shouldBlock = true;
                }
            }

            // Check Keywords (exact match within text, NO wildcards)
            if (!shouldBlock && blockedKeywords.length > 0) {
                for (let keyword of blockedKeywords) {
                    if (postText.includes(keyword)) {
                        shouldBlock = true;
                        break;
                    }
                }
            }

            if (shouldBlock) {
                entry.style.display = 'none';
            }
        });

        // 2. Filter Single Comments (.comment-body) - Scrambled instead of hidden
        const comments = document.querySelectorAll('.comment-body');
        comments.forEach(comment => {
            const authorLink = comment.querySelector('.commentLinks a.user');
            const authorHandle = getHandleFromLink(authorLink);

            // Comments typically don't have multiple rooms, so just check author here
            if (isMatch(authorHandle, blockedUsers)) {
                scrambleComment(comment);
            }
        });
    }

    // Initial run
    updateIconState();
    if (filterEnabled) {
        applyFilters();
    }

    // Set up a MutationObserver to catch dynamically loaded posts and comments
    const feedContainer = document.getElementById('feed');
    if (feedContainer) {
        const observer = new MutationObserver((mutations) => {
            let shouldRun = false;
            mutations.forEach(mutation => {
                if (mutation.addedNodes.length > 0) {
                    shouldRun = true;
                }
            });
            if (shouldRun && filterEnabled) {
                applyFilters();
            }
        });

        observer.observe(feedContainer, { childList: true, subtree: true });
    }

})();
