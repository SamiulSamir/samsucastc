window.CurrencyManager = (() => {
    let socket;
    let getState;
    let currentBalance = 1.00;
    
    // Blast UI State
    let activeBlasts = {}; // Keyed by amount to stack same-amount earners
    let blastQueue = [];
    let blastCount = 0; // Track how many different amounts are currently showing

    function getSafeName(name) {
        return name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    }

    // Avatar generator specifically for the tiny overlapping blast icons
    function getBlastAvatar(userName, userUUID) {
        if(!userName) return '';
        const safeName = getSafeName(userName);
        const avatarUrl = localStorage.getItem('samsuServerUrl') + '/avatars/' + safeName + '.png';
        const firstLetter = userName.charAt(0).toUpperCase();

        let hash = 0;
        for (let i = 0; i < userName.length; i++) hash = userName.charCodeAt(i) + ((hash << 5) - hash);
        const colors = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
        const color = colors[Math.abs(hash) % colors.length];

        const isMe = userUUID === getState().userUUID;
        const zIndex = isMe ? 999 : Math.floor(Math.random() * 10);
        const scale = isMe ? 'scale(1.1)' : 'scale(1)';
        const border = isMe ? '2px solid #ffd700' : '2px solid rgba(255,255,255,0.4)';

        return `
            <div style="position:relative; display:inline-flex; width:28px; height:28px; flex-shrink:0; border-radius:50%; overflow:hidden; vertical-align:middle; margin-left:-10px; z-index:${zIndex}; transform:${scale}; border:${border}; box-shadow: 0 2px 5px rgba(0,0,0,0.5); transition: transform 0.2s var(--bounce);">
                <img src="${avatarUrl}" style="width:100%; height:100%; object-fit:cover; display:block;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div style="display:none; width:100%; height:100%; background:${color}; color:white; align-items:center; justify-content:center; font-weight:bold; font-size:12px; line-height:1; font-family:sans-serif;">${firstLetter}</div>
            </div>
        `;
    }

    function processBlastQueue() {
        if (blastQueue.length === 0 || blastCount >= 2) return;
        
        const nextBlast = blastQueue.shift();
        showBlast(nextBlast.users, nextBlast.amount);
    }

    function showBlast(users, amount) {
        const container = document.getElementById('money-blast-container');
        if (!container) return;

        // If a blast for this amount is already on screen, just append the users to it!
        if (activeBlasts[amount]) {
            const avatarBox = activeBlasts[amount].querySelector('.blast-avatars');
            users.forEach(u => {
                avatarBox.insertAdjacentHTML('beforeend', getBlastAvatar(u.name, u.uuid));
            });
            
            // Give it a tiny bounce to show it stacked
            activeBlasts[amount].style.transform = 'scale(1.1)';
            setTimeout(() => {
                if (activeBlasts[amount]) activeBlasts[amount].style.transform = 'scale(1)';
            }, 150);
            return;
        }

        // Enforce max 2 unique amounts at once
        if (blastCount >= 2) {
            blastQueue.push({ users, amount });
            return;
        }

        blastCount++;
        
        const el = document.createElement('div');
        el.className = 'money-blast-pill';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.background = 'rgba(20,20,28,0.85)';
        el.style.backdropFilter = 'blur(10px)';
        el.style.border = '1px solid rgba(255, 215, 0, 0.4)';
        el.style.padding = '6px 14px 6px 20px';
        el.style.borderRadius = '30px';
        el.style.boxShadow = '0 5px 15px rgba(0,0,0,0.5), inset 0 0 10px rgba(255,215,0,0.1)';
        el.style.animation = 'slideInBounce 0.5s var(--bounce) forwards';
        el.style.transition = 'transform 0.2s var(--bounce)';
        el.style.gap = '8px';

        let avatarsHtml = users.map(u => getBlastAvatar(u.name, u.uuid)).join('');

        el.innerHTML = `
            <div class="blast-avatars" style="display:flex; padding-left:10px;">
                ${avatarsHtml}
            </div>
            <span style="color: #ffd700; font-weight: 800; font-size: 17px; text-shadow: 0 2px 5px rgba(0,0,0,0.8);">
                +$${amount.toFixed(2)}
            </span>
        `;

        container.appendChild(el);
        activeBlasts[amount] = el;

        // Animate out and cleanup after 4 seconds
        setTimeout(() => {
            el.style.animation = 'fadeOut 0.4s var(--smooth) forwards';
            setTimeout(() => {
                if (el.parentNode) el.remove();
                delete activeBlasts[amount];
                blastCount--;
                processBlastQueue(); // Pull next item from queue if any
            }, 400);
        }, 4000);
    }

    return {
        init: (cfg) => {
            socket = cfg.socket;
            getState = cfg.getState;

            // Fetch initial balance on load
            socket.emit('get_money', getState().accountUUID);

            socket.on('money_sync', (newBalance) => {
                currentBalance = newBalance;
                
                // Keep the superchat UI updated instantly if it's open
                const scWallet = document.getElementById('sc-wallet');
                if (scWallet && !document.getElementById('superchat-overlay').classList.contains('hidden')) {
                    scWallet.innerText = currentBalance.toFixed(2);
                }
            });

            socket.on('special_money_blast', (data) => {
                // Expecting data: { users: [{uuid, name}, ...], amount: 2.0 }
                showBlast(data.users, data.amount);
            });

            // Idle earning tick every 10 seconds (Only if watching the video)
            setInterval(() => {
                const video = document.getElementById('main-video');
                // Ensure video exists, is playing, and isn't buffering endlessly
                if (video && !video.paused && video.readyState >= 2) {
                    socket.emit('idle_earn', getState().accountUUID);
                }
            }, 10000);
        },

        getMoney: () => currentBalance,

        reduceMoney: (amount) => {
            if (currentBalance >= amount) {
                socket.emit('reduce_money', { uuid: getState().accountUUID, amount: amount });
                return true;
            }
            return false;
        }
    };
})();