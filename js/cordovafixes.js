// 1. ANDROID GBOARD GIF FIX
window.addEventListener('message', async function(e) {
    if (e.data && e.data.type === 'gboard-gif') {
        try {
            // ANDROID FIX: Use native fetch() to convert the data URI to a Blob instantly.
            // This bypasses atob() completely, preventing WebView memory crashes that were 
            // causing the base64 string to be pasted as inline text.
            const res = await fetch(e.data.base64);
            const blob = await res.blob();
            const file = new File([blob], "gboard-media.gif", { type: blob.type || 'image/gif' });

            // Find the active target with absolute certainty
            let target = null;
            if (!document.getElementById('superchat-overlay').classList.contains('hidden')) {
                target = document.getElementById('sc-message');
            } else if (document.getElementById('chat-popup').style.display !== 'none') {
                target = document.getElementById('chat-input');
            } else if (document.getElementById('emoji-popup').style.display !== 'none') {
                target = document.getElementById('custom-emoji-input');
            } else if (document.getElementById('chat-sidebar').classList.contains('active')) {
                target = document.getElementById('sidebar-chat-input');
            } else {
                const active = document.activeElement;
                if (active && active.hasAttribute('contenteditable')) target = active;
            }
            
            // Push directly to the server, bypassing the DOM
            if (target) {
                let msgType = 'chat_msg';
                if (target.id === 'custom-emoji-input') msgType = 'reaction';
                else if (target.id === 'sc-message') msgType = 'superchat';
                
                if (msgType === 'superchat' && window.SuperChat) {
                    window.SuperChat.setMedia(file);
                } else if (window.ChatHandler && window.ChatHandler.uploadAndSendMedia) {
                    target.innerHTML = ''; 
                    window.ChatHandler.uploadAndSendMedia(file, msgType);
                }
            }
        } catch (err) {
            console.error("Gboard GIF processing failed:", err);
        }
    }
});

// 2. WINDOWS EMOJI PICKER & DRAG/DROP FIX
// By capturing drops and pastes in the capture phase, we extract the file natively 
// and stop the browser from attempting to navigate to it (which causes the New Tab bug).
function handleGlobalMediaInjection(e, items) {
    if (!items || items.length === 0) return false;
    
    const fileList = Array.from(items);
    const file = fileList.find(f => f.type.startsWith('image/') || f.type.startsWith('video/') || f.name.endsWith('.gif'));
    
    if (file) {
        e.preventDefault();
        e.stopPropagation(); // Stops MediaHelper from crashing on it
        
        let target = e.target;
        if (!target || !target.hasAttribute('contenteditable')) {
            const active = document.activeElement;
            if (active && active.hasAttribute('contenteditable')) target = active;
        }

        if (!target) {
            if (!document.getElementById('superchat-overlay').classList.contains('hidden')) {
                target = document.getElementById('sc-message');
            } else if (document.getElementById('chat-popup').style.display !== 'none') {
                target = document.getElementById('chat-input');
            } else if (document.getElementById('emoji-popup').style.display !== 'none') {
                target = document.getElementById('custom-emoji-input');
            } else if (document.getElementById('chat-sidebar').classList.contains('active')) {
                target = document.getElementById('sidebar-chat-input');
            }
        }
        
        if (target) {
            let msgType = 'chat_msg';
            if (target.id === 'custom-emoji-input') msgType = 'reaction';
            else if (target.id === 'sc-message') msgType = 'superchat';
            
            if (msgType === 'superchat' && window.SuperChat) {
                window.SuperChat.setMedia(file);
            } else if (window.ChatHandler && window.ChatHandler.uploadAndSendMedia) {
                target.innerHTML = ''; 
                window.ChatHandler.uploadAndSendMedia(file, msgType);
            }
        }
        return true;
    }
    return false;
}

// Intercept Pastes (Capture Phase)
window.addEventListener('paste', function(e) {
    const files = (e.clipboardData || window.clipboardData).files;
    handleGlobalMediaInjection(e, files);
}, true);

// Intercept Drops (Capture Phase) - Hard stops the "Opens in New Tab" browser default!
window.addEventListener('drop', function(e) {
    const files = (e.dataTransfer).files;
    handleGlobalMediaInjection(e, files);
    e.preventDefault(); // NEVER let the browser open dropped files
}, true);

window.addEventListener('dragover', function(e) { 
    e.preventDefault(); 
}, true);

// Clean up any rogue HTML injected by Windows Emoji Picker
document.addEventListener('input', function(e) {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('contenteditable')) {
        // Strip <a> tags instantly
        const links = e.target.querySelectorAll('a');
        links.forEach(l => {
            const img = l.querySelector('img');
            if (img) l.replaceWith(img); 
            else l.replaceWith(document.createTextNode(l.innerText || l.href));
        });
        
        // Remove inaccessible file:/// paths injected natively by the OS
        const imgs = e.target.querySelectorAll('img');
        imgs.forEach(img => {
            if (img.src && (img.src.startsWith('file://') || img.src.startsWith('http'))) {
                 img.remove(); 
            }
        });
    }
}, true);

// Stop Enter key from accidentally triggering leftover links
document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target && e.target.hasAttribute('contenteditable')) {
        const links = e.target.querySelectorAll('a');
        links.forEach(l => l.removeAttribute('href')); 
    }
}, true);

// 3. FAKE FULLSCREEN INJECTION
(function setupFakeFullscreen() {
    // Check if we are running inside the Cordova app via URL parameter
    if (!window.location.search.includes('client=cordova')) {
        return; // Exit early, use native fullscreen for normal web browsers
    }

    // Inject the CSS needed to make the element fill the screen over everything
    const style = document.createElement('style');
    style.innerHTML = `
        .fake-fullscreen-mode {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            max-width: none !important;
            z-index: 999999 !important;
            border-radius: 0 !important;
            border: none !important;
            margin: 0 !important;
            background: #000 !important;
        }
        .fake-fullscreen-mode video {
            width: 100% !important;
            height: 100% !important;
            object-fit: contain !important;
        }
        /* Ensure overlay UI stays visible in fake fullscreen */
        .fake-fullscreen-mode .chat-expand-btn, 
        .fake-fullscreen-mode #live-chat-overlay, 
        .fake-fullscreen-mode .action-dock { 
            display: flex !important; 
        }
    `;
    document.head.appendChild(style);

    let currentFullscreenElement = null;

    // Hijack requestFullscreen
    const origReqFullscreen = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function(options) {
        if (this.id === 'video-wrapper' || this.classList.contains('video-container')) {
            this.classList.add('fake-fullscreen-mode');
            currentFullscreenElement = this;
            
            // Tell the Cordova parent shell to handle rotation and immersive mode
            window.parent.postMessage('fake-fs-enter', '*');
            
            // Fool the app into thinking it's actually in fullscreen
            Object.defineProperty(document, 'fullscreenElement', { get: () => currentFullscreenElement, configurable: true });
            setTimeout(() => document.dispatchEvent(new Event('fullscreenchange')), 150);
            
            return Promise.resolve();
        }
        return origReqFullscreen ? origReqFullscreen.call(this, options) : Promise.resolve();
    };

    // Hijack exitFullscreen
    const origExitFullscreen = document.exitFullscreen;
    document.exitFullscreen = function() {
        if (currentFullscreenElement) {
            currentFullscreenElement.classList.remove('fake-fullscreen-mode');
            currentFullscreenElement = null;
            
            // Tell the Cordova parent shell to restore rotation
            window.parent.postMessage('fake-fs-exit', '*');
            
            // Reset app state
            Object.defineProperty(document, 'fullscreenElement', { get: () => null, configurable: true });
            setTimeout(() => document.dispatchEvent(new Event('fullscreenchange')), 150);
            
            return Promise.resolve();
        }
        return origExitFullscreen ? origExitFullscreen.call(this) : Promise.resolve();
    };
})();