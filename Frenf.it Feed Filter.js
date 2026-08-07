// ==UserScript==
// @name         Frenf.it Feed Filter
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Block users/keywords, draggable icon, scramble blocked comments, auto-apply toggle, double-click toggle
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
        if (filterEnabled && (blockedUsers.length > 0 || blockedKeywords.length > 0)) {
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

        <label style="font-size:12px; margin-bottom:5px;">Blocked Users (one per line, e.g., @sba)</label>
        <textarea id="blockedUsersInput" rows="5" style="width:100%; margin-bottom:15px; box-sizing:border-box; border-radius:4px; border:1px solid #ccc; padding:5px;">${blockedUsers.map(u => '@' + u).join('\n')}</textarea>

        <label style="font-size:12px; margin-bottom:5px;">Blocked Keywords in Posts (one per line)</label>
        <textarea id="blockedKeywordsInput" rows="5" style="width:100%; margin-bottom:15px; box-sizing:border-box; border-radius:4px; border:1px solid #ccc; padding:5px;">${blockedKeywords.join('\n')}</textarea>

        <button id="saveFiltersBtn" style="background-color:#5cb85c; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer; font-weight:bold;">Save & Apply</button>
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
        const keywordsInput = document.getElementById('blockedKeywordsInput').value;

        blockedUsers = usersInput.split(/\r?\n/)
            .map(s => s.trim().replace(/^@/, '').toLowerCase())
            .filter(s => s.length > 0);

        blockedKeywords = keywordsInput.split(/\r?\n/)
            .map(s => s.trim().toLowerCase())
            .filter(s => s.length > 0);

        localStorage.setItem('frenfFilterEnabled', JSON.stringify(filterEnabled));
        localStorage.setItem('frenfBlockedUsers', JSON.stringify(blockedUsers));
        localStorage.setItem('frenfBlockedKeywords', JSON.stringify(blockedKeywords));

        configBox.style.display = 'none';
        updateIconState();

        // Always reset everything to default state before applying new logic
        resetFilters();

        if (filterEnabled) {
            applyFilters();
        }
    });

    // --- Filtering Logic ---
    function getHandleFromLink(linkElement) {
        if (!linkElement || !linkElement.href) return "";
        const parts = linkElement.href.split('/');
        return parts[parts.length - 1].toLowerCase();
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
        if (blockedUsers.length === 0 && blockedKeywords.length === 0) return;

        // 1. Filter Main Posts (.entry) - Still hidden entirely
        const entries = document.querySelectorAll('.entry');
        entries.forEach(entry => {
            const authorLink = entry.querySelector('.entry-body.public strong.media-heading a.user');
            const handle = getHandleFromLink(authorLink);
            const textElement = entry.querySelector('.entry-text');
            const postText = textElement ? textElement.innerText.toLowerCase() : "";

            let shouldBlock = false;

            if (blockedUsers.includes(handle)) {
                shouldBlock = true;
            }

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
            const handle = getHandleFromLink(authorLink);

            if (blockedUsers.includes(handle)) {
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