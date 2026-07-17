window.SuperChat = (() => {
    let socket;
    let getState;
    
    let activeCards = [];
    let lastFrameTime = performance.now();
    let isOverlayMoved = false;

    const colors = [
        { bg: 'rgb(0 0 0 / 61%)', border: '#4caf50' }, 
        { bg: 'rgb(0 0 0 / 61%)', border: '#f44336' }, 
        { bg: 'rgb(0 0 0 / 61%)', border: '#ffeb3b' }  
    ];

    function animationLoop(time) {
        let dt = (time - lastFrameTime) / 1000;
        lastFrameTime = time;
        
        for (let i = activeCards.length - 1; i >= 0; i--) {
            let card = activeCards[i];
            
            card.timeLeft -= (dt * card.drainMultiplier);
            
            if (card.timeLeft <= 0) {
                card.el.style.animation = 'fadeOut 0.4s var(--smooth) forwards';
                setTimeout(() => { if (card.el.parentNode) card.el.remove(); }, 400);
                activeCards.splice(i, 1);
            } else {
                card.progressBar.style.width = (card.timeLeft / card.maxTime * 100) + '%';
            }
        }
        
        const controls = document.getElementById('custom-controls');
        const overlay = document.getElementById('live-chat-overlay');
        
        if (controls && overlay) {
            const controlsHidden = controls.classList.contains('hidden-controls');
            
            if (controlsHidden && !isOverlayMoved) {
                overlay.style.transition = 'top 0.4s var(--smooth), left 0.4s var(--smooth), transform 0.4s var(--smooth)';
                overlay.style.top = '10px';
                overlay.style.left = '10px';
                overlay.style.transform = 'scale(0.7)';
                overlay.style.transformOrigin = 'top left';
                isOverlayMoved = true;
            } else if (!controlsHidden && isOverlayMoved) {
                overlay.style.top = '70px';
                overlay.style.left = '20px';
                overlay.style.transform = 'scale(1)';
                isOverlayMoved = false;
            }
        }
        
        requestAnimationFrame(animationLoop);
    }

    return {
        init: (cfg) => {
            socket = cfg.socket;
            getState = cfg.getState;
            
            if (!document.getElementById('superchat-styles')) {
                const style = document.createElement('style');
                style.id = 'superchat-styles';
                style.innerHTML = `
                    @keyframes scGradientShift { 0% { background-position: 100% 0%; } 100% { background-position: -100% 0%; } }
                `;
                document.head.appendChild(style);
            }

            // Hook up MediaHelper for Superchat inputs
            if (window.MediaHelper) {
                window.MediaHelper.attach('sc-message', (file) => {
                    if (file) {
                        SuperChat.setMedia(file);
                    } else {
                        // Allow enter-to-pay for text
                        SuperChat.pay();
                    }
                });
            }

            requestAnimationFrame(animationLoop);
        },
        
        setMedia: (file) => {
            SuperChat.pendingMedia = file;
            const reader = new FileReader();
            reader.onload = function(e) {
                const previewContainer = document.getElementById('sc-media-preview');
                const img = document.getElementById('sc-preview-img');
                if(previewContainer && img) {
                    img.src = e.target.result;
                    previewContainer.style.display = 'block';
                }
            };
            reader.readAsDataURL(file);
            document.getElementById('sc-message').focus();
        },
        
        removeMedia: () => {
            SuperChat.pendingMedia = null;
            const previewContainer = document.getElementById('sc-media-preview');
            const img = document.getElementById('sc-preview-img');
            if(previewContainer && img) {
                previewContainer.style.display = 'none';
                img.src = '';
            }
            document.getElementById('sc-message').focus();
        },

        openPopup: () => {
            SuperChat.pendingMedia = null;
            const previewContainer = document.getElementById('sc-media-preview');
            if (previewContainer) previewContainer.style.display = 'none';
            const previewImg = document.getElementById('sc-preview-img');
            if (previewImg) previewImg.src = '';
            
            document.getElementById('superchat-overlay').classList.remove('hidden');
            document.getElementById('sc-wallet').innerText = window.CurrencyManager.getMoney().toFixed(2);
            document.getElementById('sc-amount').value = '';
            document.getElementById('sc-message').innerHTML = '';
            ChatHandler.toggleEmojiPopup(); 
        },
        
        closePopup: () => {
            document.getElementById('superchat-overlay').classList.add('hidden');
        },
        
        payWithMedia: (file) => {
            try {
                const amountInput = parseFloat(document.getElementById('sc-amount').value);
                const msgText = document.getElementById('sc-message').innerText.trim();
                const currentWallet = window.CurrencyManager.getMoney();
                
                if (isNaN(amountInput) || amountInput <= 0) return alert("Please enter a valid amount greater than $0.");
                if (amountInput > currentWallet) {
                    const errorOverlay = document.getElementById('insufficient-funds-overlay');
                    if (errorOverlay) errorOverlay.classList.remove('hidden');
                    return;
                }
                
                if (window.CurrencyManager.reduceMoney(amountInput)) {
                    const state = getState();
                    const reader = new FileReader();
                    // We don't strictly need FileReader if we pass the File object directly to R2.
                    try {
                        const superchatBtn = Array.from(document.querySelectorAll('#superchat-overlay button')).find(b => b.innerText.includes('Pay') || b.innerHTML.includes('Uploading'));
                        let originalText = 'Pay';
                        if (superchatBtn) {
                            originalText = superchatBtn.innerHTML;
                            superchatBtn.innerHTML = 'Uploading...';
                            superchatBtn.disabled = true;
                        }
                        
                        window.uploadToR2(file, file.name).then(r2Url => {
                            const evtObj = {
                                type: 'superchat',
                                user: state.userName,
                                amount: amountInput,
                                text: msgText,
                                mediaUrl: r2Url,
                                timestamp: Date.now()
                            };
                            socket.emit('addon-event', evtObj);
                            
                            if (superchatBtn) {
                                superchatBtn.innerHTML = originalText;
                                superchatBtn.disabled = false;
                            }
                            
                            // Reset everything
                            document.getElementById('sc-message').innerHTML = '';
                            document.getElementById('sc-amount').value = '';
                            SuperChat.removeMedia();
                            SuperChat.closePopup();
                            
                        }).catch(err => {
                            alert("R2 Upload failed: " + err);
                            if (superchatBtn) {
                                superchatBtn.innerHTML = originalText;
                                superchatBtn.disabled = false;
                            }
                        });
                    } catch (err) {
                        alert("Upload error: " + err);
                    }
                    SuperChat.pendingMedia = null;
                    SuperChat.closePopup();
                } else {
                    alert("Transaction failed. Syncing balance...");
                }
            } catch (err) {
                alert("payWithMedia error: " + err);
            }
        },

        pay: async () => {
            if (SuperChat.pendingMedia) {
                SuperChat.payWithMedia(SuperChat.pendingMedia);
                return;
            }
            
            // Fallback: If MediaHelper didn't fire (e.g. Android Gboard commitContent bug), check for inline image manually
            const scMsg = document.getElementById('sc-message');
            const inlineImg = scMsg.querySelector('img');
            if (inlineImg) {
                const src = inlineImg.src;
                try {
                    let blob;
                    try {
                        const res = await fetch(src);
                        blob = await res.blob();
                    } catch (fetchErr) {
                        if (src.startsWith('data:')) {
                            const splitIndex = src.indexOf(',');
                            const type = src.substring(0, splitIndex).split(';')[0].split(':')[1];
                            const byteString = atob(src.substring(splitIndex + 1));
                            const ab = new ArrayBuffer(byteString.length);
                            const ia = new Uint8Array(ab);
                            for (let i = 0; i < byteString.length; i++) {
                                ia[i] = byteString.charCodeAt(i);
                            }
                            blob = new Blob([ab], { type: type });
                        } else {
                            throw fetchErr;
                        }
                    }
                    const ext = blob.type.split('/')[1] || 'gif';
                    let file;
                    try { file = new File([blob], `media.${ext}`, { type: blob.type }); }
                    catch (err) { file = blob; file.name = `media.${ext}`; }
                    SuperChat.payWithMedia(file);
                    return;
                } catch (err) {
                    console.error("Manual fallback inline image extraction failed:", err);
                }
            }
            
            const amountInput = parseFloat(document.getElementById('sc-amount').value);
            const msg = document.getElementById('sc-message').innerText.trim();
            const currentWallet = window.CurrencyManager.getMoney();
            
            if (isNaN(amountInput) || amountInput <= 0) return alert("Please enter a valid amount greater than $0.");
            if (amountInput > currentWallet) {
                const errorOverlay = document.getElementById('insufficient-funds-overlay');
                if (errorOverlay) errorOverlay.classList.remove('hidden');
                return;
            }
            
            if (window.CurrencyManager.reduceMoney(amountInput)) {
                const state = getState();
                const evt = {
                    type: 'superchat',
                    user: state.userName,
                    amount: amountInput,
                    text: msg,
                    timestamp: Date.now()
                };
                
                socket.emit('addon-event', evt);
                // Removing local optimistic render: Wait for bounce back from Server io.emit
                SuperChat.pendingMedia = null;
                SuperChat.closePopup();
            } else {
                alert("Transaction failed. Syncing balance...");
            }
        },
        
        render: (data) => {
            const liveOverlay = document.getElementById('live-chat-overlay');
            if (!liveOverlay) return;
            
            // Fix invalid amounts which ruin the drain logic
            if (typeof data.amount !== 'number' || isNaN(data.amount) || data.amount <= 0) {
                data.amount = 1;
            }
            
            const maxDuration = 60;
            const calculatedTime = data.amount * 10;
            const displayTime = Math.min(maxDuration, Math.max(2, calculatedTime)); 
            
            activeCards.forEach(card => {
                card.drainMultiplier += (data.amount / 5); 
            });
            
            const theme = colors[Math.floor(Math.random() * colors.length)];
            
            const card = document.createElement('div');
            card.className = 'superchat-card'; 
            card.style.background = theme.bg;
            card.style.border = `1px solid ${theme.border}`;
            card.style.backdropFilter = 'blur(6px)';
            card.style.borderRadius = '10px';
            card.style.padding = '12px 15px';
            card.style.width = '100%';
            card.style.minWidth = '280px';
            card.style.maxWidth = '350px';
            card.style.boxShadow = '0 8px 25px rgba(0,0,0,0.5)';
            card.style.position = 'relative';
            card.style.overflow = 'hidden';
            card.style.animation = 'slideInBounce 0.5s var(--bounce) forwards';
            card.style.marginBottom = '5px';
            
            const dollars = Math.floor(data.amount);
            const cents = Math.round((data.amount - dollars) * 100);
            let amountStr = '';
            if (dollars > 0) amountStr += `${dollars}$ `;
            if (cents > 0) amountStr += `${cents}cents `;
            if (amountStr === '') amountStr = '0$ ';

            const header = document.createElement('div');
            header.style.color = 'rgb(199 199 199)';
            header.style.fontSize = '14px';
            header.style.fontWeight = 'bold';
            header.style.marginBottom = '8px';
            header.innerHTML = `<b style="color:white;">${data.user}</b> Donated <b style="color:rgb(255, 94, 94);">${amountStr}</b>through super chat`;
            
            const progressContainer = document.createElement('div');
            progressContainer.style.position = 'absolute';
            progressContainer.style.bottom = '0';
            progressContainer.style.left = '0';
            progressContainer.style.width = '100%';
            progressContainer.style.height = '6px';
            progressContainer.style.background = 'rgba(0,0,0,0.1)';
            
            const progressBar = document.createElement('div');
            progressBar.style.height = '100%';
            progressBar.style.width = '100%'; 
            progressBar.style.background = 'linear-gradient(90deg, #ff8a00, #e52e71, #9c27b0, #00bcd4)';
            progressBar.style.backgroundSize = '200% 100%';
            progressBar.style.animation = `scGradientShift 1000ms linear infinite`;
            progressBar.style.transformOrigin = 'left center';
            
            progressContainer.appendChild(progressBar);
            card.appendChild(header);
            
            if (data.mediaUrl) {
                const img = document.createElement('img');
                img.src = data.mediaUrl.startsWith('r2://') ? window.getR2Url(data.mediaUrl) : (localStorage.getItem('samsuServerUrl') + data.mediaUrl);
                img.style.maxWidth = '100%';
                img.style.maxHeight = '150px';
                img.style.borderRadius = '8px';
                img.style.marginTop = '10px';
                img.style.objectFit = 'contain';
                card.appendChild(img);
            } else if (data.text) {
                const body = document.createElement('div');
                body.style.color = "white";
                body.style.fontSize = '16px';
                body.style.fontWeight = '500';
                body.style.wordBreak = 'break-word';
                body.innerText = data.text;
                card.appendChild(body);
            }
            
            card.appendChild(progressContainer);
            liveOverlay.appendChild(card);
            
            activeCards.push({
                el: card,
                progressBar: progressBar,
                maxTime: displayTime,
                timeLeft: displayTime,
                drainMultiplier: 1.0 
            });
        }
    };
})();