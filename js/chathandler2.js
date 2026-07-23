window.ChatHandler = (() => {
    let socket;
    let getState;
    let ui = {};
    
    let chatHistory = [];
    const floaters = [];
    let physicsRunning = false;
    let lastPhysicsTime = 0;
    let isDockOpen = false;

    // Listens for 'avatar-updated' event from avatar-cache.js and instantly replaces images
    window.addEventListener('avatar-updated', (e) => {
        const { username, url } = e.detail;
        if (!username || !url) return;
        
        const safeUserName = username.replace(/"/g, '\\"');
        const query = `img[data-avatar-user="${safeUserName}"]`;
        const imgs = document.querySelectorAll(query);
        
        imgs.forEach(img => {
            img.src = url;
            img.removeAttribute('data-r2'); // Clean up R2 triggers to stop loops
            img.dataset.resolved = "true";
            img.style.display = 'block';
            
            // Hide the colored-letter fallback element behind it
            if (img.nextElementSibling && img.nextElementSibling.classList.contains('fallback-avatar')) {
                img.nextElementSibling.style.display = 'none';
            }
        });
        
        // Live update the Home chat notification popup if active
        const notifName = document.getElementById('notif-name');
        if (notifName && notifName.innerText === username) {
            const notifAvatar = document.getElementById('notif-avatar');
            if (notifAvatar) notifAvatar.src = url;
        }
    });

    function getAvatarMarkup(userName, customClass = "sidebar-avatar", msgIcon = null) {
        if(!userName) return '';
        const firstLetter = userName.charAt(0).toUpperCase();

        let hash = 0;
        for (let i = 0; i < userName.length; i++) hash = userName.charCodeAt(i) + ((hash << 5) - hash);
        const colors = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
        const color = colors[Math.abs(hash) % colors.length];

        const size = customClass === 'float-avatar' ? '28px' : '32px';
        const fontSize = customClass === 'float-avatar' ? '12px' : '14px';

        const safeUserName = userName.replace(/"/g, '&quot;');
        const cachedUrl = window.AvatarCache ? window.AvatarCache.getAvatarUrl(userName) : null;
        
        let imgSrc = '';
        let r2Markup = '';
        
        // 1. Try AvatarCache first
        if (cachedUrl) {
            imgSrc = cachedUrl;
        } 
        // 2. Fall back to raw msgIcon string processing
        else if (msgIcon) {
            if (msgIcon.startsWith('r2://')) {
                imgSrc = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
                r2Markup = `data-r2="${msgIcon}" onload="window.resolveR2Image(this)"`;
            } else {
                imgSrc = msgIcon.startsWith('/') ? localStorage.getItem('samsuServerUrl') + msgIcon : msgIcon;
            }
        }
        
        const showImg = imgSrc ? 'block' : 'none';
        const showFallback = imgSrc ? 'none' : 'flex';
        
        // We ALWAYS render an <img> tag with data-avatar-user so it can be targeted by hot-swap
        return `
            <div class="${customClass}-wrapper" style="position:relative; display:inline-block; width:${size}; height:${size}; flex-shrink:0; border-radius:50%; overflow:hidden; vertical-align:middle;">
                <img src="${imgSrc}" ${r2Markup} data-avatar-user="${safeUserName}" style="width:100%; height:100%; object-fit:cover; display:${showImg};" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div class="fallback-avatar" style="display:${showFallback}; width:100%; height:100%; background:${color}; color:white; align-items:center; justify-content:center; font-weight:bold; font-size:${fontSize}; line-height:1; font-family:sans-serif;">${firstLetter}</div>
            </div>
        `;
    }

    function createSeededRNG(seed) {
        return function() {
            let t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function checkCollision(a, b) {
        if(a.vanishing || b.vanishing) return false;
        const dx = (a.x + a.w / 2) - (b.x + b.w / 2);
        const dy = (a.y + a.h / 2) - (b.y + b.h / 2);
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDist = (a.w + b.w) / 4 + (a.h + b.h) / 4;
        return distance < minDist;
    }

    function resolveCollision(a, b) {
        const dx = (b.x + b.w / 2) - (a.x + a.w / 2);
        const dy = (b.y + b.h / 2) - (a.y + a.h / 2);
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDist = (a.w + b.w) / 4 + (a.h + b.h) / 4;
        const overlap = minDist - distance;

        if (overlap > 0) {
            const pushX = (dx / distance) * overlap;
            const pushY = (dy / distance) * overlap;

            a.x -= pushX * 0.5; a.y -= pushY * 0.5;
            b.x += pushX * 0.5; b.y += pushY * 0.5;

            const kx = a.vx - b.vx, ky = a.vy - b.vy;
            a.vx -= kx * 0.4; a.vy -= ky * 0.4;
            b.vx += kx * 0.4; b.vy += ky * 0.4;
        }
    }

    function physicsLoop(timestamp) {
        if (floaters.length === 0) {
            physicsRunning = false;
            return;
        }

        if (!timestamp) timestamp = performance.now();
        let dt = timestamp - lastPhysicsTime;
        if (dt > 100) dt = 16.666; 
        lastPhysicsTime = timestamp;
        
        const timeScale = dt / 16.666; 

        const containerW = ui.floatingArea.clientWidth || 300;
        const leftBoundaryLimit = containerW * 0.35; 

        for (let i = 0; i < floaters.length; i++) {
            let f = floaters[i];
            if(f.vanishing) continue;
            
            const heightScale = f.spawnH / 600; 
            const journey = Math.max(0, Math.min(1, 1 - (f.y / f.spawnH)));
            
            if (journey < 0.7) {
                f.vy = -3.0 * heightScale; 
            } else {
                f.vy = -1.0 * heightScale; 
            }

            f.x += f.vx * timeScale;
            f.y += f.vy * timeScale;

            if (f.x < 10) { f.x = 10; f.vx *= -0.6; }
            if (f.x + f.w > leftBoundaryLimit) { f.x = leftBoundaryLimit - f.w; f.vx *= -0.6; }

            if (f.y <= 0) {
                f.y = 0;
                f.vy = 0;
                f.vx *= 0.5; 
                if (!f.vanishing) {
                    f.vanishing = true;
                    f.el.style.transition = 'opacity 0.1s ease-out, transform 0.1s ease-out';
                    f.el.style.opacity = '0';
                    f.el.style.transform = `translate3d(${f.x}px, -10px, 0) scale(${f.baseScale * 0.8})`;
                    setTimeout(() => { f.dead = true; }, 100); 
                }
            }

            f.vx *= Math.pow(0.97, timeScale);

            if (!f.vanishing) {
                f.life -= dt; 
                if (f.life < 1000) f.el.style.opacity = Math.max(0, f.life / 1000);
            }
        }

        for (let i = 0; i < floaters.length; i++) {
            for (let j = i + 1; j < floaters.length; j++) {
                if (checkCollision(floaters[i], floaters[j])) resolveCollision(floaters[i], floaters[j]);
            }
        }

        for (let i = floaters.length - 1; i >= 0; i--) {
            let f = floaters[i];
            if (f.dead || f.life <= 0) {
                f.el.remove();
                floaters.splice(i, 1);
            } else if (!f.vanishing) {
                let currentScale = 1;
                let age = (f.maxLife - f.life);
                if (age < 300) { 
                    let progress = age / 300; 
                    if (progress < 0.6) {
                        currentScale = progress / 0.6 * 1.2;
                    } else {
                        let p = (progress - 0.6) / 0.4; 
                        currentScale = 1.2 - (0.2 * p);
                    }
                }
                
                const finalScale = currentScale * f.baseScale;
                f.el.style.transform = `translate3d(${f.x}px, ${f.y}px, 0) scale(${finalScale})`;
            }
        }
        requestAnimationFrame(physicsLoop);
    }

    function formatSidebarTime(ts) {
        const d = new Date(ts);
        const hrs = d.getHours().toString().padStart(2, '0');
        const mins = d.getMinutes().toString().padStart(2, '0');
        return `${hrs}:${mins}`;
    }

    function renderToSidebar(msg, isHistoryLoad = false) {
        let lastMsg = chatHistory[chatHistory.length - 1];

        if (!isHistoryLoad && lastMsg && lastMsg.type === 'reaction' && msg.type === 'reaction' && 
            lastMsg.user === msg.user && lastMsg.emoji === msg.emoji && 
            (msg.timestamp - lastMsg.timestamp < 15000) && !msg.mediaUrl) {
            
            lastMsg.count = (lastMsg.count || 1) + 1;
            lastMsg.timestamp = msg.timestamp;
            
            const elements = ui.sidebarMessages.querySelectorAll('.sidebar-msg');
            const lastDom = elements[elements.length - 1];
            if (lastDom) {
                let badge = lastDom.querySelector('.stack-badge');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'stack-badge';
                    lastDom.querySelector('.sidebar-content').appendChild(badge);
                }
                badge.innerText = `x${lastMsg.count}`;
            }
            return;
        }

        msg.count = msg.count || 1;
        if (!isHistoryLoad) {
            chatHistory.push(msg);
        }

        const el = document.createElement('div');
        el.className = 'sidebar-msg';
        const timeStr = formatSidebarTime(msg.timestamp);

        if (msg.type === 'chat') {
            let contentHtml = msg.mediaUrl 
                ? (msg.mediaUrl.startsWith('r2://') ? `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" data-r2="${msg.mediaUrl}" onload="window.resolveR2Image(this)" style="max-width: 100%; max-height: 150px; border-radius: 8px; margin-top: 4px; display: block; object-fit: contain;">` : `<img src="${window.getR2Url(msg.mediaUrl)}" style="max-width: 100%; max-height: 150px; border-radius: 8px; margin-top: 4px; display: block; object-fit: contain;">`)
                : `<div class="sidebar-text">${msg.text}</div>`;
            el.innerHTML = `
                ${getAvatarMarkup(msg.user, 'sidebar-avatar', msg.icon)}
                <div class="sidebar-content">
                    <div class="sidebar-meta"><b>${msg.user}</b> <span class="sidebar-time">${timeStr}</span></div>
                    ${contentHtml}
                </div>
            `;
        } else if (msg.type === 'reaction') {
            let contentHtml = msg.mediaUrl 
                ? (msg.mediaUrl.startsWith('r2://') ? `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" data-r2="${msg.mediaUrl}" onload="window.resolveR2Image(this)" style="max-width: 100%; max-height: 100px; border-radius: 8px; margin-top: 4px; display: block; object-fit: contain;">` : `<img src="${window.getR2Url(msg.mediaUrl)}" style="max-width: 100%; max-height: 100px; border-radius: 8px; margin-top: 4px; display: block; object-fit: contain;">`)
                : `<div class="sidebar-emoji">${msg.emoji} ${msg.count > 1 ? `<span class="stack-badge">x${msg.count}</span>` : ''}</div>`;
            el.innerHTML = `
                ${getAvatarMarkup(msg.user, 'sidebar-avatar', msg.icon)}
                <div class="sidebar-content">
                    <div class="sidebar-meta"><b>${msg.user}</b> <span class="sidebar-time">${timeStr}</span></div>
                    ${contentHtml}
                </div>
            `;
        } else if (msg.type === 'system_msg') {
            el.innerHTML = `<div class="sidebar-content" style="width: 100%; text-align: center; color: #a1a1aa; font-size: 0.85em; font-style: italic;">${msg.text}</div>`;
        } else if (msg.type === 'superchat') {
            const dollars = Math.floor(msg.amount || 0);
            const cents = Math.round(((msg.amount || 0) - dollars) * 100);
            let amountStr = '';
            if (dollars > 0) amountStr += `${dollars}$ `;
            if (cents > 0) amountStr += `${cents}cents `;
            if (amountStr === '') amountStr = '0$ ';

            let contentHtml = msg.mediaUrl 
                ? (msg.mediaUrl.startsWith('r2://') ? `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" data-r2="${msg.mediaUrl}" onload="window.resolveR2Image(this)" style="max-width: 100%; max-height: 150px; border-radius: 8px; margin-top: 10px; display: block; object-fit: contain;">` : `<img src="${window.getR2Url(msg.mediaUrl)}" style="max-width: 100%; max-height: 150px; border-radius: 8px; margin-top: 10px; display: block; object-fit: contain;">`)
                : (msg.text ? `<div style="color: white; font-size: 16px; font-weight: 500; word-break: break-word; text-align: center;">${msg.text}</div>` : '');

            el.innerHTML = `
                <div class="sidebar-content" style="width: 100%; padding: 12px 15px; background: rgb(0 0 0 / 61%); border: 1px solid #ffeb3b; backdrop-filter: blur(6px); border-radius: 10px; margin: 5px 0; box-shadow: 0 8px 25px rgba(0,0,0,0.5); overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <div style="color: rgb(199, 199, 199); font-size: 14px; font-weight: bold; margin-bottom: 8px; text-align: center;">
                        <b style="color:white;">${msg.user}</b> Donated <b style="color:rgb(255, 94, 94);">${amountStr}</b>through super chat
                    </div>
                    ${contentHtml}
                </div>
            `;
        }

        ui.sidebarMessages.appendChild(el);
        
        // FIX: Manually trigger R2 resolution since inline Data URI onload events are bypassed by innerHTML
        if (window.resolveR2Image) {
            el.querySelectorAll('img[data-r2]:not([data-resolved])').forEach(img => window.resolveR2Image(img));
        }

        ui.sidebarMessages.scrollTop = ui.sidebarMessages.scrollHeight;
        
        if (!isHistoryLoad && !isDockOpen) {
            const setupScreen = document.getElementById('setup-screen');
            if (setupScreen && !setupScreen.classList.contains('hidden')) {
                const notif = document.getElementById('home-chat-notification');
                if (notif) {
                    const notifAvatar = document.getElementById('notif-avatar');
                    // Try AvatarCache first
                    const cachedNotifUrl = window.AvatarCache ? window.AvatarCache.getAvatarUrl(msg.user) : null;
                    if (cachedNotifUrl) {
                        notifAvatar.src = cachedNotifUrl;
                    } else if (msg.icon && msg.icon.startsWith('r2://')) {
                        notifAvatar.setAttribute("data-r2", msg.icon);
                        notifAvatar.onload = function() { window.resolveR2Image(this); };
                        notifAvatar.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
                        // FIX: Manual trigger for the notification popup
                        if (window.resolveR2Image) window.resolveR2Image(notifAvatar);
                    } else if (msg.icon && msg.icon.startsWith('/')) {
                        notifAvatar.src = localStorage.getItem('samsuServerUrl') + msg.icon;
                    } else if (msg.icon) {
                        notifAvatar.src = msg.icon;
                    } else {
                        const safeName = msg.user.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
                        notifAvatar.src = localStorage.getItem('samsuServerUrl') + '/avatars/' + safeName + '.png';
                    }
                    document.getElementById('notif-name').innerText = msg.user;
                    document.getElementById('notif-msg').innerText = msg.type === 'chat' ? (msg.mediaUrl ? 'Sent media' : msg.text) : msg.emoji;
                    notif.classList.remove('hidden');
                    notif.style.opacity = '1';
                    
                    if (notif.timeoutId) clearTimeout(notif.timeoutId);
                    notif.timeoutId = setTimeout(() => {
                        notif.style.opacity = '0';
                        setTimeout(() => notif.classList.add('hidden'), 300);
                    }, 5000);
                }
            }
        }
    }

    let isFetchingHistory = false;
    let allHistoryLoaded = false;

    return {
        init: (cfg) => {
            socket = cfg.socket;
            getState = cfg.getState;
            ui = cfg.ui || {};
            
            // Map missing DOM elements if they weren't explicitly passed in the UI object
            if (!ui.sidebarMessages) ui.sidebarMessages = document.getElementById('chat-sidebar-messages');
            if (!ui.floatingArea) ui.floatingArea = document.getElementById('floating-area');
            if (!ui.chatPopup) ui.chatPopup = document.getElementById('chat-popup');
            if (!ui.emojiPopup) ui.emojiPopup = document.getElementById('emoji-popup');
            if (!ui.chatInput) ui.chatInput = document.getElementById('chat-input');
            if (!ui.emojiInput) ui.emojiInput = document.getElementById('custom-emoji-input');
            if (!ui.sidebarChatInput) ui.sidebarChatInput = document.getElementById('sidebar-chat-input');
            
            ui.sidebarMessages.addEventListener('scroll', () => {
                if (ui.sidebarMessages.scrollTop === 0 && !isFetchingHistory && !allHistoryLoaded) {
                    isFetchingHistory = true;
                    socket.emit('request_chat_history', chatHistory.length);
                }
            });

            socket.on('chat-history-batch', (batch) => {
                if (!batch || batch.length === 0) {
                    allHistoryLoaded = true;
                    isFetchingHistory = false;
                    return;
                }
                
                const oldHeight = ui.sidebarMessages.scrollHeight;
                
                for (let i = batch.length - 1; i >= 0; i--) {
                    const msg = batch[i];
                    if (msg.type === 'chat_msg') msg.type = 'chat';
                    msg.count = msg.spammed ? parseInt(msg.spammed, 10) : (msg.count || 1);
                    
                    const el = document.createElement('div');
                    el.className = 'sidebar-msg';
                    const timeStr = formatSidebarTime(msg.timestamp);
            
                    if (msg.type === 'chat') {
                        let contentHtml = msg.mediaUrl 
                            ? (msg.mediaUrl.startsWith('r2://') ? `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" data-r2="${msg.mediaUrl}" onload="window.resolveR2Image(this)" style="max-width: 100%; max-height: 150px; border-radius: 8px; margin-top: 4px; display: block; object-fit: contain;">` : `<img src="${window.getR2Url(msg.mediaUrl)}" style="max-width: 100%; max-height: 150px; border-radius: 8px; margin-top: 4px; display: block; object-fit: contain;">`)
                            : `<div class="sidebar-text">${msg.text}</div>`;
                        el.innerHTML = `
                            ${getAvatarMarkup(msg.user, 'sidebar-avatar', msg.icon)}
                            <div class="sidebar-content">
                                <div class="sidebar-name">${msg.user} <span class="sidebar-time">${timeStr}</span></div>
                                ${contentHtml}
                            </div>
                        `;
                    } else if (msg.type === 'reaction') {
                        el.innerHTML = `
                            ${getAvatarMarkup(msg.user, 'sidebar-avatar', msg.icon)}
                            <div class="sidebar-content">
                                <div class="sidebar-name">${msg.user} <span class="sidebar-time">${timeStr}</span></div>
                                <div class="sidebar-text" style="font-size: 24px;">${msg.emoji}</div>
                            </div>
                        `;
                    } else if (msg.type === 'system_msg') {
                        el.innerHTML = `<div class="sidebar-content" style="width: 100%; text-align: center; color: #a1a1aa; font-size: 0.85em; font-style: italic;">${msg.text}</div>`;
                    } else if (msg.type === 'superchat') {
                        const dollars = Math.floor(msg.amount || 0);
                        const cents = Math.round(((msg.amount || 0) - dollars) * 100);
                        let amountStr = '';
                        if (dollars > 0) amountStr += `${dollars}$ `;
                        if (cents > 0) amountStr += `${cents}cents `;
                        if (amountStr === '') amountStr = '0$ ';

                        let contentHtml = msg.mediaUrl 
                            ? (msg.mediaUrl.startsWith('r2://') ? `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" data-r2="${msg.mediaUrl}" onload="window.resolveR2Image(this)" style="max-width: 100%; max-height: 150px; border-radius: 8px; margin-top: 10px; display: block; object-fit: contain;">` : `<img src="${window.getR2Url(msg.mediaUrl)}" style="max-width: 100%; max-height: 150px; border-radius: 8px; margin-top: 10px; display: block; object-fit: contain;">`)
                            : (msg.text ? `<div style="color: white; font-size: 16px; font-weight: 500; word-break: break-word; text-align: center;">${msg.text}</div>` : '');

                        el.innerHTML = `
                            <div class="sidebar-content" style="width: 100%; padding: 12px 15px; background: rgb(0 0 0 / 61%); border: 1px solid #ffeb3b; backdrop-filter: blur(6px); border-radius: 10px; margin: 5px 0; box-shadow: 0 8px 25px rgba(0,0,0,0.5); overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                                <div style="color: rgb(199, 199, 199); font-size: 14px; font-weight: bold; margin-bottom: 8px; text-align: center;">
                                    <b style="color:white;">${msg.user}</b> Donated <b style="color:rgb(255, 94, 94);">${amountStr}</b>through super chat
                                </div>
                                ${contentHtml}
                            </div>
                        `;
                    }
                    
                    if (el.innerHTML) {
                        ui.sidebarMessages.insertBefore(el, ui.sidebarMessages.firstChild);
                        
                        // FIX: Manual trigger for historical messages
                        if (window.resolveR2Image) {
                            el.querySelectorAll('img[data-r2]:not([data-resolved])').forEach(img => window.resolveR2Image(img));
                        }
                        
                        chatHistory.unshift(msg);
                    }
                }
                
                const newHeight = ui.sidebarMessages.scrollHeight;
                ui.sidebarMessages.scrollTop = newHeight - oldHeight;
                isFetchingHistory = false;
            });

            if (window.MediaHelper) {
                window.MediaHelper.attach('chat-input', (file) => {
                    if (file) {
                        ChatHandler.uploadAndSendMedia(file, 'chat_msg');
                    } else {
                        ChatHandler.sendChat();
                    }
                });
                
                window.MediaHelper.attach('custom-emoji-input', (file) => {
                    if (file) {
                        ChatHandler.uploadAndSendMedia(file, 'reaction');
                    } else {
                        ChatHandler.sendCustomEmoji();
                    }
                });
                
                window.MediaHelper.attach('sidebar-chat-input', (file) => {
                    if (file) {
                        ChatHandler.uploadAndSendMedia(file, 'chat_msg');
                    } else {
                        ChatHandler.sendSidebarChat();
                    }
                });
            }
        },

        uploadAndSendMedia: (file, type) => {
            const state = getState();
            
            window.uploadToR2(file, file.name).then(r2Url => {
                const evtObj = { type: type, user: state.userName, icon: state.userIcon, uuid: state.userUUID, timestamp: Date.now(), mediaUrl: r2Url };
                socket.emit('addon-event', evtObj);
            }).catch(err => {
                alert("Upload failed: " + err);
            });
            
            if (type === 'chat_msg') ui.chatPopup.style.display = 'none';
            if (type === 'reaction') ui.emojiPopup.style.display = 'none';
        },

        loadHistory: (historyArray) => {
            chatHistory = [];
            ui.sidebarMessages.innerHTML = '';
            
            const recentHistory = historyArray.slice(-20);
            
            recentHistory.forEach(msg => {
                if (msg.type === 'chat_msg') msg.type = 'chat'; 
                msg.count = msg.spammed ? parseInt(msg.spammed, 10) : (msg.count || 1); 
                chatHistory.push(msg);
                renderToSidebar(msg, true);
            });
            
            setTimeout(() => {
                if(ui.sidebarMessages) ui.sidebarMessages.scrollTop = ui.sidebarMessages.scrollHeight;
            }, 100);
        },

        handleNetworkEvent: (data) => {
            if (data.type === 'chat_msg') {
                data.type = 'chat'; 
                renderToSidebar(data);
                // Sender will also spawn since we rely on server bounce-back
                if (!isDockOpen) ChatHandler.spawnFloat('chat', data);
            }
            if (data.type === 'reaction') {
                renderToSidebar(data);
                if (!isDockOpen) ChatHandler.spawnFloat('reaction', data);
            }
            if (data.type === 'system_msg') {
                renderToSidebar(data);
            }
        },

        setDockOpen: (isOpen) => {
            isDockOpen = isOpen;
            if (isOpen) {
                while (floaters.length > 0) {
                    const f = floaters.pop();
                    f.el.remove();
                }
                setTimeout(() => {
                    if(ui.sidebarMessages) ui.sidebarMessages.scrollTop = ui.sidebarMessages.scrollHeight;
                }, 150);
            }
        },

        getDockOpen: () => isDockOpen,

        toggleChatPopup: () => {
            ui.emojiPopup.style.display = 'none';
            if (ui.chatPopup.style.display === 'none') {
                ui.chatPopup.style.display = 'flex';
                ui.chatInput.focus();
            } else { ui.chatPopup.style.display = 'none'; }
        },

        toggleEmojiPopup: () => {
            ui.chatPopup.style.display = 'none';
            if (ui.emojiPopup.style.display === 'none') {
                ui.emojiPopup.style.display = 'flex';
                ui.emojiInput.focus();
            } else { ui.emojiPopup.style.display = 'none'; }
        },

        sendChat: () => {
            const text = ui.chatInput.innerText.trim();
            if (!text) return;
            const state = getState();
            
            const evt = { type: 'chat_msg', text: text, user: state.userName, icon: state.userIcon, uuid: state.userUUID, timestamp: Date.now() };
            socket.emit('addon-event', evt);
            
            ui.chatInput.innerText = '';
            ui.chatPopup.style.display = 'none';
        },

        sendSidebarChat: () => {
            if (!ui.sidebarChatInput) return;
            const text = ui.sidebarChatInput.innerText.trim();
            if (!text) return;
            const state = getState();
            
            const evt = { type: 'chat_msg', text: text, user: state.userName, icon: state.userIcon, uuid: state.userUUID, timestamp: Date.now() };
            socket.emit('addon-event', evt);
            
            ui.sidebarChatInput.innerText = '';
        },

        sendReaction: (emoji) => {
            const state = getState();
            const evt = { type: 'reaction', emoji: emoji, user: state.userName, icon: state.userIcon, uuid: state.userUUID, timestamp: Date.now() };
            socket.emit('addon-event', evt);
            
            // Removed local optimstic render. We wait for network bounce-back.
            ui.emojiPopup.style.display = 'none';
        },

        sendCustomEmoji: () => {
            const emoji = ui.emojiInput.innerText.trim();
            if (emoji) { ChatHandler.sendReaction(emoji); ui.emojiInput.innerText = ''; }
        },

        spawnFloat: (type, data) => {
            if (isDockOpen) return;

            const seed = data.timestamp || Date.now();
            const rng = createSeededRNG(seed);
            
            const el = document.createElement('div');
            el.style.zIndex = type === 'chat' ? '60' : '50';
            
            if (type === 'chat') {
                el.className = 'phys-float float-item';
                let inner = data.mediaUrl ? (data.mediaUrl.startsWith('r2://') ? `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" data-r2="${data.mediaUrl}" onload="window.resolveR2Image(this)" style="height: 150px; border-radius: 8px; margin-left: 8px; object-fit: contain;">` : `<img src="${window.getR2Url(data.mediaUrl)}" style="height: 150px; border-radius: 8px; margin-left: 8px; object-fit: contain;">`) : `<span class="chat-text"><b>${data.user}:</b> ${data.text}</span>`;
                el.innerHTML = `${getAvatarMarkup(data.user, 'float-avatar', data.icon)}${inner}`;
            } else {
                el.className = 'phys-float float-reaction';
                let inner = data.mediaUrl ? (data.mediaUrl.startsWith('r2://') ? `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" data-r2="${data.mediaUrl}" onload="window.resolveR2Image(this)" style="height: 150px; border-radius: 8px; object-fit: contain;">` : `<img src="${window.getR2Url(data.mediaUrl)}" style="height: 150px; border-radius: 8px; object-fit: contain;">`) : `<span class="reaction-emoji">${data.emoji}</span>`;
                el.innerHTML = `${getAvatarMarkup(data.user, 'float-avatar', data.icon)}${inner}`;
            }
            
            el.style.transformOrigin = 'top left'; 
            ui.floatingArea.appendChild(el);
            
            // FIX: Manual trigger for floating bubble messages
            if (window.resolveR2Image) {
                el.querySelectorAll('img[data-r2]:not([data-resolved])').forEach(img => window.resolveR2Image(img));
            }
            
            const containerW = ui.floatingArea.clientWidth || 300;
            const maxSpawnW = Math.max(10, containerW * 0.35 - 100); 
            const areaH = ui.floatingArea.clientHeight || 400;
            
            const baseScale = Math.max(0.6, Math.min(1.5, (containerW + areaH) / 1200));
            
            const startX = 15 + Math.floor(rng() * maxSpawnW);
            const vx = (rng() - 0.5) * 1.0; 
            const vy = -3.8; 
            const life = 24000; 
            
            const rawW = el.offsetWidth || (type === 'chat' ? (data.mediaUrl ? 110 : 160) : 54);
            const rawH = el.offsetHeight || (data.mediaUrl ? 64 : 32);

            const f = {
                id: seed + rng(),
                el: el,
                type: type,
                x: startX,
                y: areaH - 80, 
                vx: vx,
                vy: vy,
                w: rawW * baseScale, 
                h: rawH * baseScale, 
                life: life,
                maxLife: life,
                spawnH: areaH,
                baseScale: baseScale, 
                vanishing: false,
                dead: false
            };
            
            floaters.push(f);
            
            if (!physicsRunning) {
                physicsRunning = true;
                lastPhysicsTime = performance.now();
                requestAnimationFrame(physicsLoop);
            }
        }
    };
})();
