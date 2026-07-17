 window.EventBus = new EventTarget();

        const CoreApp = (() => {
            const userStr = localStorage.getItem('samsuUser');
            if (!userStr) {
                window.location.href = 'userc.html';
                return;
            }
            const userData = JSON.parse(userStr);
            const SERVER_URL = localStorage.getItem('samsuServerUrl');
            const socket = io(SERVER_URL, { transports: ['websocket'] });
            
            window.r2Ready = false;
            let cloudflareEndpoint = "";
            fetch(SERVER_URL + '/api/r2-creds')
                .then(res => res.json())
                .then(creds => {
                    window.R2Bucket = creds.bucketName;
                    cloudflareEndpoint = creds.endpoint;
                    window.r2Ready = true;
                }).catch(err => console.error("Failed to load R2 credentials", err));

            window.uploadToR2 = async (file, fileName) => {
                if(!window.r2Ready) throw new Error("R2 not ready");
                const ext = fileName.split('.').pop();
                const uniqueName = Date.now() + '-' + Math.random().toString(36).substring(2, 9) + '.' + ext;
                
                const contentType = file.type || 'image/png';
                
                // Get presigned upload URL from server
                const res = await fetch(`${SERVER_URL}/api/presign-upload?filename=${encodeURIComponent(uniqueName)}&contentType=${encodeURIComponent(contentType)}`);
                const { url, key } = await res.json();
                
                // Upload directly to R2 using the presigned URL
                await fetch(url, {
                    method: 'PUT',
                    body: file,
                    headers: {
                        'Content-Type': contentType
                    }
                });
                
                return 'r2://' + uniqueName;
            };

            window.getR2Url = (key) => {
                if(!window.r2Ready || !key.startsWith('r2://')) return key;
                const actualKey = key.replace('r2://', '');
                // Since the bucket doesn't have public access, we must get a presigned GET URL from the server.
                // But wait, the user's R2 bucket is public read according to them.
                // Let's use the public URL format for now.
                return `${cloudflareEndpoint}/${window.R2Bucket}/${actualKey}`;
            };

            const ui = {
                setup: document.getElementById('setup-screen'),
                player: document.getElementById('player-screen'),
                videoWrapper: document.getElementById('video-wrapper'),
                video: document.getElementById('main-video'),
                chat: document.getElementById('sys-chatbox'),
                liveChat: document.getElementById('live-chat-overlay'),
                customControls: document.getElementById('custom-controls'),
                actionDock: document.getElementById('action-dock'),
                chatPopup: document.getElementById('chat-popup'),
                emojiPopup: document.getElementById('emoji-popup'),
                floatingArea: document.getElementById('floating-area'),
                chatSidebar: document.getElementById('chat-sidebar'),
                chatExpandBtn: document.getElementById('chat-expand-btn'),
                homeChatBtn: document.getElementById('home-chat-btn'),
                homeChatNotif: document.getElementById('home-chat-notification'),
                profileModal: document.getElementById('profile-modal'),
                editFullname: document.getElementById('edit-fullname'),
                editPassword: document.getElementById('edit-password'),
                editAvatarPreview: document.getElementById('edit-avatar-preview'),
                
                playPauseBtn: document.getElementById('play-pause-btn'),
                timeDisplay: document.getElementById('time-display'),
                progressBar: document.getElementById('progress-bar'),
                progressFilled: document.getElementById('progress-filled'),
                fullscreenBtn: document.getElementById('fullscreen-btn'),
                
                seekOverlay: document.getElementById('seek-approval-overlay'),
                seekMsg: document.getElementById('seek-msg'),
                seekVotes: document.getElementById('seek-votes'),
                voteApproveBtn: document.getElementById('vote-approve-btn'),
                voteRejectBtn: document.getElementById('vote-reject-btn'),
                voteTimerBar: document.getElementById('vote-timer-bar'),
                
                pauseOverlay: document.getElementById('pause-overlay'),
                pauseMsg: document.getElementById('pause-msg'),
                pauseVotes: document.getElementById('pause-votes'),
                voteResumeBtn: document.getElementById('vote-resume-btn'),

                desyncOverlay: document.getElementById('desync-overlay'),
                readyOverlay: document.getElementById('ready-overlay'),
                readyMsg: document.getElementById('ready-msg'),
                readyBtn: document.getElementById('ready-btn'),
                
                ccUploadBtn: document.getElementById('cc-upload-btn'),
                ccBtn: document.getElementById('cc-btn'),
                subFile: document.getElementById('sub-file'),
                subTrack: document.getElementById('sub-track'),
                subOverlay: document.getElementById('sub-overlay'),
                subMsg: document.getElementById('sub-msg'),
                
                chatInput: document.getElementById('chat-input'),
                emojiInput: document.getElementById('custom-emoji-input')
            };

            let state = {
                isHost: false,
                userName: userData.fullname,
                userUUID: userData.uuid + '_' + Math.random().toString(36).substring(2, 9),
                userIcon: userData.profileIcon,
                hostVideoInfo: null,
                pendingVideoUrl: null,
                pendingVideoName: null,
                
                lastHostTime: 0,
                lastHostTimestamp: 0,
                wasPlaying: false,
                isBuffering: false,
                pendingSeekTime: 0,
                localBufferTimer: null,
                isGlobalBufferingOrigin: false,
                autoPlayPending: false,
                activeSubtitle: null
            };

            ChatHandler.init({
                socket: socket,
                getState: () => state,
                ui: ui
            });

            CurrencyManager.init({
                socket: socket,
                getState: () => state
            });

            SuperChat.init({
                socket: socket,
                getState: () => state
            });

            let hostState = { activePeers: {}, peerNames: {}, validVoters: new Set(), seekVotes: new Set(), readyPeers: new Set(), resumeVotes: new Set(), currentVoteType: null, voteTimeout: null, preparingPlay: false, preparingPlayReason: null, autoPlayTimer: null, seekInitiator: null };
            
            const getAvatarHTML = (iconUrl, name, size = 40) => {
                if (iconUrl) {
                    let finalUrl = iconUrl;
                    if (iconUrl.startsWith('r2://')) {
                        finalUrl = window.getR2Url(iconUrl);
                    } else if (iconUrl.startsWith('/')) {
                        finalUrl = SERVER_URL + iconUrl;
                    }
                    return `<img src="${finalUrl}" style="width: ${size}px; height: ${size}px; border-radius: 50%; object-fit: cover; border: 2px solid var(--primary); flex-shrink: 0;">`;
                }
                const firstLetter = (name || '?').charAt(0).toUpperCase();
                return `<div class="avatar-fallback" style="width: ${size}px; height: ${size}px; font-size: ${size * 0.5}px;">${firstLetter}</div>`;
            };
            
            const updateHeaderAvatar = (icon, name) => {
                const headerAvatarContainer = document.getElementById('user-profile-header');
                const existingAvatar = document.getElementById('header-avatar') || headerAvatarContainer.querySelector('.avatar-fallback');
                if (existingAvatar) existingAvatar.remove();
                
                const wrapper = document.createElement('div');
                wrapper.innerHTML = getAvatarHTML(icon, name, 40);
                const newAvatar = wrapper.firstChild;
                if (newAvatar.tagName === 'IMG') newAvatar.id = 'header-avatar';
                headerAvatarContainer.insertBefore(newAvatar, headerAvatarContainer.firstChild);
            };

            updateHeaderAvatar(state.userIcon, state.userName);
            document.getElementById('header-name').innerText = state.userName;

            socket.emit('request_lobby_info');

            socket.on('join_rejected', (data) => {
                if (data.reason === 'already_active') {
                    document.body.innerHTML = `
                        <div style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: #0f0f0f url('assets/bg.jpg') no-repeat center center fixed; background-size: cover; z-index: 9999999; display: flex; align-items: center; justify-content: center; color: white; font-family: 'Pfont', sans-serif; flex-direction: column; animation: fadeIn 0.5s ease-out;">
                            <style>
                                @font-face {font-family: 'Pfont';src: url('assets/fonts/pfont.ttf') format('truetype');}
                                @keyframes slideUp { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                            </style>
                            <div style="background: rgba(20, 20, 28, 0.65); backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); border: 1px solid rgba(255, 255, 255, 0.15); padding: 40px; border-radius: 24px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.5); animation: slideUp 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);">
                                <h2 style="font-size: 1.8rem; margin-top: 0; margin-bottom: 15px; font-weight: 600;">Session Active</h2>
                                <p style="color: #cbd5e1; margin-bottom: 30px;">You are already active on another device.</p>
                                <button onclick="localStorage.removeItem('samsuUser'); location.href='userc.html'" style="padding: 14px 30px; font-size: 1.1rem; font-family: 'Pfont', sans-serif; border-radius: 16px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.05); color: #f2f2f2; cursor: pointer; transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);" onmouseover="this.style.background='rgba(255,255,255,0.15)'; this.style.transform='scale(1.02) translateY(-2px)'; this.style.borderColor='rgba(255,255,255,0.2)';" onmouseout="this.style.background='rgba(255,255,255,0.04)'; this.style.transform='none'; this.style.borderColor='rgba(255,255,255,0.05)';">Log Out & Reconnect</button>
                            </div>
                        </div>
                    `;
                    socket.disconnect();
                }
            });

            const logMsg = (msg, shortMsg = null) => {
                const p = document.createElement('div');
                p.className = 'sys-msg';
                p.textContent = msg;
                ui.chat.appendChild(p);
                ui.chat.scrollTop = ui.chat.scrollHeight;
                
                if (shortMsg) {
                    const liveMsg = document.createElement('div');
                    liveMsg.className = 'live-msg';
                    liveMsg.textContent = shortMsg;
                    ui.liveChat.appendChild(liveMsg);
                    
                    const allLiveMsgs = ui.liveChat.querySelectorAll('.live-msg');
                    if(allLiveMsgs.length > 4) {
                        allLiveMsgs[0].remove();
                    }
                    
                    setTimeout(() => { if (liveMsg.parentNode) liveMsg.remove(); }, 4000);
                }
            };

            const formatTime = (seconds) => {
                if (isNaN(seconds)) return "0:00";
                const h = Math.floor(seconds / 3600);
                const m = Math.floor((seconds % 3600) / 60);
                const s = Math.floor(seconds % 60);
                if (h > 0) return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
                return `${m}:${s < 10 ? '0' : ''}${s}`;
            };
            
            const srt2vtt = (srt) => { return 'WEBVTT\n\n' + srt.replace(/\r\n|\r|\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'); };

            document.addEventListener('fullscreenchange', () => {
                const sidebar = document.getElementById('chat-sidebar');
                const superchatBtn = document.getElementById('superchat-btn');
                if (!document.fullscreenElement) {
                    ui.chatPopup.style.display = 'none';
                    ui.emojiPopup.style.display = 'none';
                    SuperChat.closePopup();
                    if (superchatBtn) superchatBtn.classList.add('hidden');
                    CoreApp.closeChatSidebar();
                    document.body.classList.remove('is-fullscreen');
                    if (sidebar) document.body.appendChild(sidebar);
                } else {
                    document.body.classList.add('is-fullscreen');
                    if (superchatBtn) superchatBtn.classList.remove('hidden');
                    if (sidebar) ui.videoWrapper.appendChild(sidebar);
                }
            });

            let hideControlsTimeout;
            let hideExpandBtnTimeout;
            let lastWakeTime = 0;
            const autoHideEls = [ui.customControls, ui.actionDock, ui.chatPopup, ui.emojiPopup, ui.chatSidebar];
            
            let isInteractingWithSidebar = false;
            let isInputFocused = false;

            const sidebarEvents = ['mouseenter', 'touchstart', 'scroll'];
            sidebarEvents.forEach(evt => {
                ui.chatSidebar.addEventListener(evt, () => {
                    isInteractingWithSidebar = true;
                    wakeControls();
                }, { passive: true });
            });
            ui.chatSidebar.addEventListener('mouseleave', () => {
                isInteractingWithSidebar = false;
            });
            ui.chatSidebar.addEventListener('touchend', () => {
                isInteractingWithSidebar = false;
            });

            const textInputs = [
                document.getElementById('chat-input'), 
                document.getElementById('custom-emoji-input'), 
                document.getElementById('username'),
                document.getElementById('sc-amount'),
                document.getElementById('sc-message')
            ];
            textInputs.forEach(inp => {
                if (inp) {
                    inp.addEventListener('focus', () => {
                        isInputFocused = true;
                        wakeControls();
                    });
                    inp.addEventListener('blur', () => {
                        isInputFocused = false;
                    });
                }
            });

            const wakeControls = () => {
                if (ui.customControls.classList.contains('hidden-controls')) {
                    lastWakeTime = Date.now();
                }
                
                autoHideEls.forEach(el => el && el.classList.remove('hidden-controls'));
                ui.chatExpandBtn.classList.remove('hidden-controls');
                
                ui.videoWrapper.style.cursor = 'default';
                clearTimeout(hideControlsTimeout);
                clearTimeout(hideExpandBtnTimeout);
                
                if (!ui.video.paused) {
                    hideControlsTimeout = setTimeout(() => {
                        if (isInteractingWithSidebar || isInputFocused || !document.getElementById('superchat-overlay').classList.contains('hidden')) {
                            wakeControls();
                            return;
                        }
                        autoHideEls.forEach(el => el && el.classList.add('hidden-controls'));
                        
                        if (ChatHandler.getDockOpen()) {
                            ChatHandler.setDockOpen(false);
                            ui.chatSidebar.classList.remove('dock-active');
                            
                            clearTimeout(hideExpandBtnTimeout);
                            hideExpandBtnTimeout = setTimeout(() => {
                                ui.chatExpandBtn.classList.add('hidden-controls');
                            }, 2000);
                        }
                        
                        if (document.fullscreenElement) {
                            ui.videoWrapper.style.cursor = 'none';
                        }
                    }, 2000);
                    
                    if (!ChatHandler.getDockOpen()) {
                        hideExpandBtnTimeout = setTimeout(() => {
                            ui.chatExpandBtn.classList.add('hidden-controls');
                        }, 2000);
                    }
                }
            };
            
            ui.videoWrapper.addEventListener('mousemove', wakeControls);
            ui.videoWrapper.addEventListener('touchstart', wakeControls, {passive: true});
            ui.video.addEventListener('play', wakeControls);
            ui.video.addEventListener('pause', () => {
                clearTimeout(hideControlsTimeout);
                clearTimeout(hideExpandBtnTimeout);
                autoHideEls.forEach(el => el && el.classList.remove('hidden-controls'));
                ui.chatExpandBtn.classList.remove('hidden-controls');
                ui.videoWrapper.style.cursor = 'default';
            });
            
            ui.videoWrapper.addEventListener('click', (e) => {
                if (e.target === ui.video || e.target.classList.contains('touch-zone')) {
                    if (ui.customControls.classList.contains('hidden-controls')) {
                        wakeControls();
                    } else {
                        if (Date.now() - lastWakeTime > 300) {
                            if (isInteractingWithSidebar || isInputFocused || !document.getElementById('superchat-overlay').classList.contains('hidden')) return;
                            
                            clearTimeout(hideControlsTimeout);
                            clearTimeout(hideExpandBtnTimeout);
                            
                            autoHideEls.forEach(el => el && el.classList.add('hidden-controls'));
                            ui.chatExpandBtn.classList.add('hidden-controls');
                            
                            if (ChatHandler.getDockOpen()) {
                                ChatHandler.setDockOpen(false);
                                ui.chatSidebar.classList.remove('dock-active');
                            }
                            if (document.fullscreenElement) ui.videoWrapper.style.cursor = 'none';
                        }
                    }
                }
            });

            let pendingSeekAmount = 0;
            let seekDebounceTimeout = null;
            let lastTapTime = 0;

            const handleTouchZone = (direction) => {
                const now = Date.now();
                wakeControls();
                if (now - lastTapTime > 400 && pendingSeekAmount === 0) { lastTapTime = now; return; }
                lastTapTime = now;

                pendingSeekAmount += (direction * 10);
                
                const ripple = direction === 1 ? document.getElementById('ripple-right') : document.getElementById('ripple-left');
                const val = direction === 1 ? document.getElementById('seek-val-right') : document.getElementById('seek-val-left');
                val.innerText = `${pendingSeekAmount > 0 ? '+' : ''}${pendingSeekAmount}s`;
                
                ripple.classList.remove('active');
                void ripple.offsetWidth; 
                ripple.classList.add('active');

                clearTimeout(seekDebounceTimeout);
                seekDebounceTimeout = setTimeout(() => {
                    let targetTime = ui.video.currentTime + pendingSeekAmount;
                    targetTime = Math.max(0, Math.min(targetTime, ui.video.duration));
                    
                    const eventData = { type: 'seek_request', user: state.userName, time: targetTime };
                    socket.emit('addon-event', eventData);
                    if (state.isHost) handleAddonEvent(eventData);
                    
                    pendingSeekAmount = 0;
                    document.getElementById('ripple-right').classList.remove('active');
                    document.getElementById('ripple-left').classList.remove('active');
                }, 2000);
            };

            document.getElementById('touch-left').addEventListener('click', () => handleTouchZone(-1));
            document.getElementById('touch-right').addEventListener('click', () => handleTouchZone(1));
            
            ui.ccUploadBtn.addEventListener('click', () => { if (state.isHost) ui.subFile.click(); });
            ui.ccBtn.addEventListener('click', () => {
                const tracks = ui.video.textTracks;
                if (!tracks || tracks.length === 0) return;
                let isShowing = false;
                for (let i = 0; i < tracks.length; i++) {
                    if (tracks[i].label === 'English' && tracks[i].mode === 'showing') {
                        isShowing = true;
                        tracks[i].mode = 'hidden';
                    }
                }
                if (isShowing) {
                    ui.ccBtn.style.opacity = '0.4';
                } else {
                    for (let i = 0; i < tracks.length; i++) {
                        if (tracks[i].label === 'English') tracks[i].mode = 'showing';
                    }
                    ui.ccBtn.style.opacity = '1';
                }
            });

            ui.subFile.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                    let content = event.target.result;
                    if(file.name.toLowerCase().endsWith('.srt')) { content = srt2vtt(content); }
                    
                    state.activeSubtitle = null; 
                    
                    const evt = { type: 'subtitle_sync', name: file.name, content: content };
                    socket.emit('addon-event', evt);
                    if (state.isHost) handleAddonEvent(evt);
                };
                reader.readAsText(file);
                e.target.value = ''; 
            });

            ui.video.addEventListener('timeupdate', () => {
                if (!ui.video.duration) return;
                const percent = (ui.video.currentTime / ui.video.duration) * 100;
                ui.progressFilled.style.width = `${percent}%`;
                ui.timeDisplay.innerText = `${formatTime(ui.video.currentTime)} / ${formatTime(ui.video.duration)}`;
            });

            ui.video.addEventListener('play', () => ui.playPauseBtn.innerText = '⏸');
            ui.video.addEventListener('pause', () => ui.playPauseBtn.innerHTML = '<img src="assets/play.png" style="height: 40px;width: 40px;display: inline-block;">');
            ui.fullscreenBtn.addEventListener('click', () => {
                if (!document.fullscreenElement) { ui.videoWrapper.requestFullscreen().catch(err => console.log(err)); } 
                else { document.exitFullscreen(); }
            });

            ui.video.addEventListener('waiting', () => {
                if (state.isBuffering || ui.video.paused) return; 
                state.localBufferTimer = setTimeout(() => {
                    state.isGlobalBufferingOrigin = true;
                    const eventData = { type: 'buffer_warning', user: state.userName };
                    socket.emit('addon-event', eventData);
                    if (state.isHost) handleAddonEvent(eventData);
                }, 1000); 
            });

            const onBufferRecover = () => {
                clearTimeout(state.localBufferTimer);
                if (state.isGlobalBufferingOrigin) {
                    state.isGlobalBufferingOrigin = false;
                    const eventData = { type: 'buffer_recovered' };
                    socket.emit('addon-event', eventData);
                    if (state.isHost) handleAddonEvent(eventData);
                }
            };

            ui.video.addEventListener('playing', onBufferRecover);
            ui.video.addEventListener('canplay', onBufferRecover);

            ui.progressBar.addEventListener('click', (e) => {
                const rect = ui.progressBar.getBoundingClientRect();
                const pos = (e.clientX - rect.left) / rect.width;
                const targetTime = pos * ui.video.duration;
                const eventData = { type: 'seek_request', user: state.userName, time: targetTime };
                socket.emit('addon-event', eventData);
                if (state.isHost) handleAddonEvent(eventData);
            });

            ui.playPauseBtn.addEventListener('click', () => {
                const type = ui.video.paused ? 'play_request' : 'pause_request';
                const eventData = { type, user: state.userName };
                socket.emit('addon-event', eventData);
                if (state.isHost) handleAddonEvent(eventData);
            });

            setInterval(() => {
                if (state.isHost) {
                    const now = Date.now();
                    let peerDropped = false;
                    Object.keys(hostState.activePeers).forEach(uuid => {
                        if (now - hostState.activePeers[uuid] > 10000) {
                            delete hostState.activePeers[uuid];
                            hostState.validVoters.delete(uuid);
                            peerDropped = true;
                        }
                    });
                    
                    if (peerDropped && hostState.preparingPlay) {
                        const totalPeers = Math.max(1, hostState.validVoters.size);
                        if (hostState.readyPeers.size >= totalPeers) {
                            hostState.preparingPlay = false;
                            const evtReady = { type: 'all_ready', reason: hostState.preparingPlayReason };
                            socket.emit('addon-event', evtReady);
                            handleAddonEvent(evtReady);
                            
                            if (hostState.preparingPlayReason === 'seek') {
                                clearTimeout(hostState.autoPlayTimer);
                                hostState.autoPlayTimer = setTimeout(() => {
                                    const validArr = Array.from(hostState.validVoters).filter(u => u !== state.userUUID);
                                    let randUser = 'System (Auto Play)';
                                    if (validArr.length > 0) {
                                        const randUUID = validArr[Math.floor(Math.random() * validArr.length)];
                                        if (hostState.peerNames[randUUID]) randUser = hostState.peerNames[randUUID];
                                    } else {
                                        randUser = state.userName;
                                    }
                                    const evtPass = { type: 'execute_play_request', user: randUser };
                                    socket.emit('addon-event', evtPass);
                                    handleAddonEvent(evtPass);
                                }, 100);
                            }
                        }
                    }
                    
                    const eventData = { type: 'ping', time: ui.video.currentTime };
                    socket.emit('addon-event', eventData);
                    handleAddonEvent(eventData); 
                }
            }, 3000);

            socket.on('server-ping', () => socket.emit('server-pong'));
            socket.on('system-message', (msg) => {
                if (msg.includes('started playing') || msg.includes('paused at') || msg.includes('seeked to')) return;
                logMsg(msg); 
            });

            socket.on('lobby_info', (info) => {
                const title = document.getElementById('lobby-title');
                const miniText = document.getElementById('lobby-mini-text');
                const actionBtn = document.getElementById('lobby-action-btn');


                const viewerHostAvatar = document.getElementById('viewer-host-avatar');
                const viewerHostDetails = document.getElementById('viewer-host-details');
                const viewerReelectBtn = document.getElementById('viewer-reelect-btn');

                actionBtn.classList.remove('hidden');

                if (!info.hostName) {
                    title.innerText = "Become the host";
                    miniText.innerText = "no one is hosting";
                    actionBtn.innerText = "Host";

                    if (viewerHostDetails) viewerHostDetails.innerText = "No one is hosting.";
                    if (viewerHostAvatar) viewerHostAvatar.innerHTML = '';
                    if (viewerReelectBtn) viewerReelectBtn.classList.add('hidden');
                } else {
                    title.innerText = info.movieName ? info.movieName : "No movie selected yet";
                    miniText.innerText = `${info.hostName} hosted, ${info.usersCount} people joined`;
                    actionBtn.innerText = "Join";

                    
                    if (viewerHostAvatar) {
                        if (state.isHost) {
                            viewerHostAvatar.innerHTML = '';
                            viewerHostDetails.innerHTML = `${info.usersCount} people joined`;
                            viewerReelectBtn.classList.add('hidden');
                        } else {
                            viewerHostAvatar.innerHTML = getAvatarHTML(info.hostIcon, info.hostName, 26);
                            viewerHostDetails.innerHTML = `<strong style="color:#e2e8f0;">${info.hostName}</strong> hosted, ${info.usersCount} people joined`;
                            viewerReelectBtn.classList.remove('hidden');
                        }
                    }
                }
            });

            socket.on('chat-history', (historyData) => {
                ChatHandler.loadHistory(historyData);
            });

            socket.on('joined', (data) => {
                state.isHost = data.isHost;
                state.hostVideoInfo = data.videoData;
                ui.setup.classList.remove('hidden');
                if (state.isHost) {
                    document.getElementById('role-title').innerText = "👑 You are the Host";
                    document.getElementById('host-instruction').classList.remove('hidden');
                    document.getElementById('file-picker-wrapper').classList.remove('hidden');
                    ui.ccUploadBtn.classList.remove('hidden'); 
                } else {
                    document.getElementById('role-title').innerText = "🍿 You are a Viewer";
                    document.getElementById('client-instruction').classList.remove('hidden');
                    if (state.hostVideoInfo) showClientFilePicker();
                }
            });

            socket.on('host-video-selected', (data) => {
                state.hostVideoInfo = data;
                if (!state.isHost) showClientFilePicker();
            });

            socket.on('host-disconnected', () => setTimeout(() => location.reload(), 3000));
            let reelectionTimerInterval = null;
            socket.on('start_reelection', (data) => {
                const overlay = document.getElementById('reelection-overlay');
                const subtitle = document.getElementById('reelection-subtitle');
                const candidatesContainer = document.getElementById('reelection-candidates');
                const timerBar = document.getElementById('reelection-timer-bar');
                overlay.classList.remove('hidden');
                
                if (timerBar) {
                    timerBar.style.transition = 'none';
                    timerBar.style.width = '100%';
                    setTimeout(() => {
                        timerBar.style.transition = 'width 20s linear';
                        timerBar.style.width = '0%';
                    }, 50);
                }
                
                if (state.isHost) {
                    subtitle.innerText = "People are voting to kick you as a host.";
                    subtitle.style.color = '#ff9999';
                    candidatesContainer.style.display = 'none';
                } else {
                    candidatesContainer.style.display = 'flex';
                    subtitle.style.color = '#cbd5e1';
                    if (data.tie) {
                        subtitle.innerText = "Tie! Choose between these tied candidates carefully.";
                    } else {
                        subtitle.innerText = "Select a user to become the new host.";
                    }
                    
                    candidatesContainer.innerHTML = '';
                    data.candidates.forEach(c => {
                        const btn = document.createElement('button');
                        btn.id = 'vote-btn-' + c.socketId;
                        btn.className = 'glass-btn vote-candidate-btn';
                        btn.style.width = '100%';
                        
                        btn.innerHTML = `
                            <div class="vote-check" id="vote-check-${c.socketId}">✓</div>
                            <div class="vote-candidate-info">
                                ${getAvatarHTML(c.icon, c.name, 32)}
                                <span style="font-size: 1.1rem;">${c.name} ${c.socketId === socket.id ? "(You)" : ""}</span>
                            </div>
                            <div class="vote-stack-container" id="vote-stack-${c.socketId}"></div>
                        `;
                        
                        btn.onclick = () => {
                            socket.emit('cast_reelection_vote', c.socketId);
                        };
                        candidatesContainer.appendChild(btn);
                    });

                    // Add Cancel Vote button
                    const cancelBtn = document.createElement('button');
                    cancelBtn.id = 'vote-btn-CANCEL_VOTE';
                    cancelBtn.className = 'glass-btn vote-candidate-btn';
                    cancelBtn.style.width = '100%';
                    cancelBtn.style.marginTop = '10px';
                    cancelBtn.style.background = 'rgba(239, 68, 68, 0.1)';
                    cancelBtn.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                    
                    cancelBtn.innerHTML = `
                        <div class="vote-check" id="vote-check-CANCEL_VOTE">✓</div>
                        <div class="vote-candidate-info">
                            <span style="font-size: 1.1rem; color: #fca5a5;">Cancel Vote (Retry)</span>
                        </div>
                        <div class="vote-stack-container" id="vote-stack-CANCEL_VOTE"></div>
                    `;
                    cancelBtn.onclick = () => {
                        socket.emit('cast_reelection_vote', 'CANCEL_VOTE');
                    };
                    candidatesContainer.appendChild(cancelBtn);
                }
            });

            socket.on('reelection_vote_update', (votesData) => {
                // Clear all checks and stacks
                document.querySelectorAll('.vote-check').forEach(el => el.classList.remove('active'));
                document.querySelectorAll('.vote-stack-container').forEach(el => el.innerHTML = '');
                
                // Rebuild live UI
                for (const [candidateId, voters] of Object.entries(votesData)) {
                    const stackContainer = document.getElementById('vote-stack-' + candidateId);
                    if (stackContainer) {
                        voters.forEach(voter => {
                            const avatarHtml = getAvatarHTML(voter.icon, voter.name, 28);
                            // Convert string HTML to DOM node to append and add the animation class
                            const tempDiv = document.createElement('div');
                            tempDiv.innerHTML = avatarHtml;
                            const img = tempDiv.firstElementChild;
                            if (img) {
                                img.className = (img.className || '') + ' vote-avatar';
                                stackContainer.appendChild(img);
                            }
                            
                            // Check if this voter is me
                            if (voter.socketId === socket.id) {
                                const check = document.getElementById('vote-check-' + candidateId);
                                if (check) check.classList.add('active');
                            }
                        });
                    }
                }
            });

            socket.on('reelection_result', (winnerName) => {
                const overlay = document.getElementById('reelection-overlay');
                const subtitle = document.getElementById('reelection-subtitle');
                const candidatesContainer = document.getElementById('reelection-candidates');
                const timerBar = document.getElementById('reelection-timer-bar');
                if (timerBar) timerBar.style.transition = 'none';
                candidatesContainer.innerHTML = '';
                if (winnerName) {
                    subtitle.innerText = `Election finished! ${winnerName} is the new host.`;
                    subtitle.style.color = '#4ade80';
                } else {
                    subtitle.innerText = `Host not changed.`;
                    subtitle.style.color = '#ef4444';
                }
                setTimeout(() => {
                    overlay.classList.add('hidden');
                    subtitle.style.color = '#aaa';
                }, 3000);
            });
            
            socket.on('host_changed', (data) => {
                if (data.hostSocketId === socket.id && !state.isHost) {
                    state.isHost = true;
                    document.getElementById('role-title').innerText = "👑 You are the Host";
                    document.getElementById('host-instruction').classList.remove('hidden');
                    document.getElementById('file-picker-wrapper').classList.remove('hidden');
                    document.getElementById('client-instruction').classList.add('hidden');
                    ui.ccUploadBtn.classList.remove('hidden');
                    hostState = { activePeers: {}, peerNames: {}, validVoters: new Set(), seekVotes: new Set(), readyPeers: new Set(), resumeVotes: new Set(), currentVoteType: null, voteTimeout: null, preparingPlay: false, preparingPlayReason: null, autoPlayTimer: null, seekInitiator: null };
                } else if (data.hostSocketId !== socket.id && state.isHost) {
                    state.isHost = false;
                    document.getElementById('role-title').innerText = "🍿 You are a Viewer";
                    document.getElementById('host-instruction').classList.add('hidden');
                    document.getElementById('file-picker-wrapper').classList.add('hidden');
                    document.getElementById('client-instruction').classList.remove('hidden');
                    ui.ccUploadBtn.classList.add('hidden');
                }
            });

            const handleAddonEvent = (data) => {
                if (data.type === 'chat_msg' || data.type === 'reaction') {
                    ChatHandler.handleNetworkEvent(data);
                }
                
                if (data.type === 'superchat') {
                    SuperChat.render(data);
                }
                
                if (data.type === 'request_subtitle' && state.isHost) {
                    if (state.activeSubtitle) {
                        const evt = { type: 'subtitle_sync', name: state.activeSubtitle.name, content: state.activeSubtitle.content };
                        socket.emit('addon-event', evt);
                    }
                }
                
                if (data.type === 'subtitle_sync') {
                    if (state.activeSubtitle && state.activeSubtitle.name === data.name) return;
                    state.activeSubtitle = { name: data.name, content: data.content };
                    
                    if (!state.isHost) {
                        ui.subOverlay.classList.remove('hidden');
                        ui.subMsg.innerText = `Downloading subtitle: ${data.name}`;
                    }
                    const oldTracks = ui.video.querySelectorAll('track');
                    oldTracks.forEach(t => t.remove());
                    if (ui.video.textTracks) {
                        for (let i = 0; i < ui.video.textTracks.length; i++) { ui.video.textTracks[i].mode = 'hidden'; }
                    }
                    const encodedVTT = btoa(unescape(encodeURIComponent(data.content)));
                    const dataUrl = `data:text/vtt;base64,${encodedVTT}`;
                    const newTrack = document.createElement('track');
                    newTrack.id = `sub-track-${Date.now()}`;
                    newTrack.kind = 'subtitles';
                    newTrack.srclang = 'en';
                    newTrack.label = 'English';
                    newTrack.src = dataUrl;
                    newTrack.default = true;
                    ui.video.appendChild(newTrack);
                    ui.subTrack = newTrack;
                    
                    const forceShow = () => {
                        if (ui.video.textTracks) {
                            for (let i = 0; i < ui.video.textTracks.length; i++) {
                                if (ui.video.textTracks[i].label === 'English') ui.video.textTracks[i].mode = 'showing';
                            }
                        }
                        ui.ccBtn.classList.remove('hidden');
                        ui.ccBtn.style.opacity = '1';
                    };
                    newTrack.onload = forceShow;
                    forceShow(); 
                    
                    logMsg(`💬 Subtitles loaded: ${data.name}`);
                    if (!state.isHost) setTimeout(() => ui.subOverlay.classList.add('hidden'), 2000);
                }

                if (state.isHost) {
                    const totalPeers = Math.max(1, hostState.validVoters.size); 
                    if (data.type === 'pong') {
                        hostState.activePeers[data.uuid] = Date.now();
                        if (data.user) hostState.peerNames[data.uuid] = data.user;
                    }
                    if (data.type === 'client_video_active') {
                        hostState.validVoters.add(data.uuid);
                    }

                    if (data.type === 'seek_request') {
                        hostState.seekVotes.clear();
                        hostState.currentVoteType = 'seek';
                        hostState.seekInitiator = data.user;
                        clearTimeout(hostState.voteTimeout);
                        const evt = { type: 'vote_seek_start', time: data.time, user: data.user, isReplay: data.isReplay };
                        socket.emit('addon-event', evt);
                        handleAddonEvent(evt);
                        hostState.voteTimeout = setTimeout(() => {
                            if (hostState.currentVoteType === 'seek') {
                                hostState.currentVoteType = null;
                                const timeoutEvt = { type: 'vote_seek_rejected', user: 'System (Timeout)' };
                                socket.emit('addon-event', timeoutEvt);
                                handleAddonEvent(timeoutEvt);
                            }
                        }, 10000);
                    }

                    if (data.type === 'vote_seek_cast' && hostState.currentVoteType === 'seek') {
                        if (!data.approve) {
                            hostState.currentVoteType = null;
                            clearTimeout(hostState.voteTimeout);
                            const evt = { type: 'vote_seek_rejected', user: data.user };
                            socket.emit('addon-event', evt);
                            handleAddonEvent(evt);
                        } else {
                            hostState.seekVotes.add(data.uuid);
                            const evtUpdate = { type: 'vote_seek_update', votes: hostState.seekVotes.size, total: totalPeers };
                            socket.emit('addon-event', evtUpdate);
                            handleAddonEvent(evtUpdate);
                            
                            if (hostState.seekVotes.size >= totalPeers) {
                                hostState.currentVoteType = null;
                                clearTimeout(hostState.voteTimeout);
                                const evtPass = { type: 'vote_seek_passed', time: state.pendingSeekTime };
                                socket.emit('addon-event', evtPass);
                                handleAddonEvent(evtPass);
                            }
                        }
                    }

                    if (data.type === 'buffer_warning') {
                        const evt = { type: 'global_buffer_pause', user: data.user };
                        socket.emit('addon-event', evt);
                        handleAddonEvent(evt);
                    }
                    if (data.type === 'buffer_recovered') {
                        if (hostState.preparingPlay) return;
                        hostState.preparingPlay = true;
                        hostState.preparingPlayReason = 'seek'; // Assume seek unless play_request
                        hostState.readyPeers.clear();
                        const evt = { type: 'prepare_play', autoPlay: true };
                        socket.emit('addon-event', evt);
                        handleAddonEvent(evt);
                    }
                    if (data.type === 'play_request') {
                        if (hostState.preparingPlay) return;
                        hostState.preparingPlay = true;
                        hostState.preparingPlayReason = data.reason || 'resume';
                        hostState.readyPeers.clear();
                        const evt = { type: 'prepare_play', autoPlay: false };
                        socket.emit('addon-event', evt);
                        handleAddonEvent(evt);
                    }

                    if (data.type === 'ready_to_play') {
                        hostState.readyPeers.add(data.uuid);
                        const evtUpdate = { type: 'ready_update', ready: hostState.readyPeers.size, total: totalPeers };
                        socket.emit('addon-event', evtUpdate);
                        handleAddonEvent(evtUpdate);
                        if (hostState.readyPeers.size >= totalPeers) {
                            if (!hostState.preparingPlay) return; // Prevent duplicate execution
                            hostState.preparingPlay = false;
                            const evtReady = { type: 'all_ready', reason: hostState.preparingPlayReason };
                            socket.emit('addon-event', evtReady);
                            handleAddonEvent(evtReady);
                            
                            if (hostState.preparingPlayReason === 'seek') {
                                clearTimeout(hostState.autoPlayTimer);
                                hostState.autoPlayTimer = setTimeout(() => {
                                    const validArr = Array.from(hostState.validVoters).filter(u => u !== state.userUUID);
                                    let randUser = 'System (Auto Play)';
                                    if (validArr.length > 0) {
                                        const randUUID = validArr[Math.floor(Math.random() * validArr.length)];
                                        if (hostState.peerNames[randUUID]) randUser = hostState.peerNames[randUUID];
                                    } else {
                                        randUser = state.userName;
                                    }
                                    const evtPass = { type: 'execute_play_request', user: randUser };
                                    socket.emit('addon-event', evtPass);
                                    handleAddonEvent(evtPass);
                                }, 100);
                            }
                        }
                    }
                    if (data.type === 'execute_play_request') {
                        clearTimeout(hostState.autoPlayTimer);
                        let finalUser = data.user;
                        if (hostState.seekInitiator) {
                            finalUser = hostState.seekInitiator;
                        }
                        hostState.seekInitiator = null; // Clear it for next time
                        const evt = { type: 'execute_play', user: finalUser };
                        socket.emit('addon-event', evt);
                        handleAddonEvent(evt);
                        socket.emit('sync-action', { action: 'play', time: ui.video.currentTime });
                    }
                    if (data.type === 'pause_request') {
                        hostState.preparingPlay = false;
                        hostState.resumeVotes.clear(); 
                        const evt = { type: 'manual_pause', user: data.user };
                        socket.emit('addon-event', evt);
                        handleAddonEvent(evt);
                        socket.emit('sync-action', { action: 'pause', time: ui.video.currentTime });
                    }
                    if (data.type === 'vote_resume_cast') {
                        hostState.resumeVotes.add(data.uuid);
                        const evtUpdate = { type: 'vote_resume_update', votes: hostState.resumeVotes.size, total: totalPeers };
                        socket.emit('addon-event', evtUpdate);
                        handleAddonEvent(evtUpdate);
                        if (hostState.resumeVotes.size >= totalPeers) {
                            const evtPass = { type: 'play_request', user: 'System' };
                            socket.emit('addon-event', evtPass);
                            handleAddonEvent(evtPass);
                        }
                    }
                }

                if (data.type === 'ping') {
                    socket.emit('addon-event', { type: 'pong', uuid: state.userUUID, user: state.userName });
                    if (!state.isHost) {
                        state.lastHostTime = data.time;
                        state.lastHostTimestamp = Date.now();
                        const myTime = ui.video.currentTime;
                        if (data.time - myTime > 5 && !ui.video.paused && !state.isBuffering) {
                            ui.desyncOverlay.classList.remove('hidden');
                        }
                    }
                }

                if (data.type === 'vote_seek_start') {
                    state.wasPlaying = !ui.video.paused;
                    ui.video.pause();
                    state.pendingSeekTime = data.time;
                    if (data.isReplay) { ui.seekMsg.innerText = `⏪ ${data.user} is far behind and requested replay to ${formatTime(data.time)}`; } 
                    else { ui.seekMsg.innerText = `⏭️ ${data.user} requested seek to ${formatTime(data.time)}`; }
                    
                    logMsg(`⏭️ ${data.user} requested seek to ${formatTime(data.time)}`);
                    ui.seekVotes.innerText = `Votes: 0 / ?`;
                    ui.voteApproveBtn.disabled = false;
                    ui.voteRejectBtn.disabled = false;
                    ui.voteApproveBtn.innerText = "Approve";
                    ui.voteRejectBtn.innerText = "Shut up";
                    ui.seekOverlay.classList.remove('hidden');
                    
                    const autoVoteCb = document.getElementById('auto-vote-yes');
                    if (autoVoteCb && autoVoteCb.checked && data.user !== state.userName) {
                        setTimeout(() => CoreApp.voteSeek(true), 100);
                    }
                    
                    ui.voteTimerBar.style.transition = 'none';
                    ui.voteTimerBar.style.width = '100%';
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            ui.voteTimerBar.style.transition = 'width 10s linear';
                            ui.voteTimerBar.style.width = '0%';
                        });
                    });
                    ui.seekOverlay.classList.remove('hidden');
                    wakeControls();
                }

                if (data.type === 'vote_seek_update') { ui.seekVotes.innerText = `Votes: ${data.votes} / ${data.total}`; }
                if (data.type === 'vote_seek_rejected') {
                    ui.seekOverlay.classList.add('hidden');
                    logMsg(`❌ Seek rejected by ${data.user}`, `${data.user} : Rejected`);
                    if (state.wasPlaying && state.isHost) handleAddonEvent({ type: 'play_request' });
                }

                if (data.type === 'vote_seek_passed') {
                    ui.seekOverlay.classList.add('hidden');
                    ui.video.currentTime = data.time;
                    logMsg(`🕒 Seek approved! Buffering...`, `Seek Approved`);
                    if (state.isHost) {
                        socket.emit('sync-action', { action: 'seek', time: data.time }); 
                        handleAddonEvent({ type: 'play_request', reason: 'seek' }); 
                    }
                }

                if (data.type === 'global_buffer_pause') {
                    ui.video.pause();
                    ui.readyOverlay.classList.remove('hidden');
                    ui.readyMsg.innerText = `⏳ ${data.user} is buffering...`;
                    ui.readyBtn.classList.add('hidden');
                    logMsg(`⏳ ${data.user} is buffering...`, `${data.user} : Buffering`);
                    wakeControls();
                }

                if (data.type === 'prepare_play') {
                    state.isBuffering = true;
                    state.autoPlayPending = data.autoPlay || false;
                    ui.video.pause();
                    ui.pauseOverlay.classList.add('hidden'); 
                    ui.readyOverlay.classList.remove('hidden');
                    ui.readyMsg.innerText = "Waiting for everyone to buffer...";
                    ui.readyBtn.classList.add('hidden');
                    wakeControls();

                    const checkReady = () => {
                        if (ui.video.readyState >= 3) {
                            const evt = { type: 'ready_to_play', uuid: state.userUUID, reason: hostState.preparingPlayReason };
                            socket.emit('addon-event', evt);
                            if (state.isHost) handleAddonEvent(evt);
                        } else {
                            let fallbackTimer;
                            const onReady = () => {
                                if (ui.video.readyState >= 3) {
                                    clearTimeout(fallbackTimer);
                                    const evt = { type: 'ready_to_play', uuid: state.userUUID, reason: hostState.preparingPlayReason };
                                    socket.emit('addon-event', evt);
                                    if (state.isHost) handleAddonEvent(evt);
                                    ui.video.removeEventListener('canplay', onReady);
                                    ui.video.removeEventListener('loadeddata', onReady);
                                    ui.video.removeEventListener('playing', onReady);
                                }
                            };
                            ui.video.addEventListener('canplay', onReady);
                            ui.video.addEventListener('loadeddata', onReady);
                            ui.video.addEventListener('playing', onReady);
                            
                            fallbackTimer = setTimeout(() => {
                                ui.video.removeEventListener('canplay', onReady);
                                ui.video.removeEventListener('loadeddata', onReady);
                                ui.video.removeEventListener('playing', onReady);
                                const evt = { type: 'ready_to_play', uuid: state.userUUID, reason: hostState.preparingPlayReason };
                                socket.emit('addon-event', evt);
                                if (state.isHost) handleAddonEvent(evt);
                            }, 1500);

                            ui.video.play().then(() => { ui.video.pause(); }).catch(() => {});
                        }
                    };
                    checkReady();
                }

                if (data.type === 'ready_update' && state.isBuffering) { ui.readyMsg.innerText = `Waiting for everyone to buffer... (${data.ready}/${data.total} ready)`; }
                if (data.type === 'all_ready') {
                    state.isBuffering = false;
                    if (state.autoPlayPending) {
                        if (state.isHost && data.reason !== 'seek') handleAddonEvent({ type: 'execute_play_request', user: 'System' });
                    } else {
                        ui.readyMsg.innerText = "Everyone is loaded! Ready to play?";
                        ui.readyBtn.classList.remove('hidden'); 
                    }
                }

                if (data.type === 'execute_play') {
                    ui.readyOverlay.classList.add('hidden');
                    ui.pauseOverlay.classList.add('hidden');
                    ui.video.play().catch(e => console.log(e));
                    const actor = data.user || 'System';
                    logMsg(`▶️ ${actor} played video`, `${actor} : ${formatTime(ui.video.currentTime)}`);
                    wakeControls(); 
                }

                if (data.type === 'manual_pause') {
                    ui.video.pause();
                    ui.readyOverlay.classList.remove('hidden');
                    ui.pauseMsg.innerText = `⏸️ ${data.user} paused the playback. Vote to resume.`;
                    ui.pauseVotes.innerText = `Votes: 0 / ?`;
                    ui.voteResumeBtn.disabled = false;
                    ui.voteResumeBtn.innerText = "Resume";
                    ui.pauseOverlay.classList.remove('hidden');
                    logMsg(`⏸️ ${data.user} paused video`, `${data.user} : Paused`);
                    wakeControls(); 
                }
                if (data.type === 'vote_resume_update') { ui.pauseVotes.innerText = `Votes: ${data.votes} / ${data.total}`; }
            };

            socket.on('addon-event', handleAddonEvent);

            const showClientFilePicker = () => {
                document.getElementById('client-instruction').querySelector('p').innerText = "Select matching file to start:";
                const exp = document.getElementById('expected-file');
                exp.innerText = `${state.hostVideoInfo.name}`;
                exp.classList.remove('hidden');
                document.getElementById('viewer-movie-selection').classList.remove('hidden');
                document.getElementById('file-picker-wrapper').classList.add('hidden');
            };

            document.getElementById('video-file').addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const url = URL.createObjectURL(file);
                const tempVid = document.createElement('video');
                tempVid.src = url;
                tempVid.onloadedmetadata = () => {
                    const duration = tempVid.duration;
                    const videoId = `${file.name}-${duration}-${file.size}`;

                    if (state.isHost) {
                        socket.emit('file-selected', { id: videoId, name: file.name, duration, size: file.size });
                        activatePlayer(url, file.name);
                    } else {
                        validateClientFile(url, file.name, duration, file.size);
                    }
                };
            });

            const validateClientFile = (url, name, duration, size) => {
                if (Math.abs(duration - state.hostVideoInfo.duration) > 1.5) {
                    alert(`❌ Duration mismatch! Select the exact file.`);
                    document.getElementById('video-file').value = "";
                    return;
                }
                if (name !== state.hostVideoInfo.name || size !== state.hostVideoInfo.size) {
                    state.pendingVideoUrl = url;
                    state.pendingVideoName = name;
                    document.getElementById('warning-box').classList.remove('hidden');
                } else {
                    activatePlayer(url, name);
                }
            };

            const activatePlayer = (url, name) => {
                ui.setup.classList.add('hidden');
                ui.player.classList.remove('hidden');
                document.body.classList.add('video-active');
                document.getElementById('now-playing').innerText = `Now Playing: ${name}`;
                ui.video.src = url;
                wakeControls();
                
                const activeEvt = { type: 'client_video_active', uuid: state.userUUID };
                socket.emit('addon-event', activeEvt);
                if (state.isHost) handleAddonEvent(activeEvt);
                
                if (!state.isHost) {
                    socket.emit('addon-event', { type: 'request_subtitle', uuid: state.userUUID });
                } else {
                    socket.emit('set_movie_name', name);
                    socket.emit('addon-event', { type: 'system_msg', text: `[${name}] started by ${state.userName}`, timestamp: Date.now() });
                }
            };

            return {
                socket,
                getState: () => state,
                joinRoom: () => {
                    document.getElementById('lobby-screen').classList.add('hidden');
                    socket.emit('join', { name: state.userName, uuid: state.userUUID, accountUUID: userData.uuid, icon: state.userIcon });
                },
                requestReElection: () => {
                    socket.emit('request_reelection');
                },
                castReElectionVote: (candidateId) => {
                    socket.emit('cast_reelection_vote', candidateId);
                },
                
                openChatSidebar: () => {
                    ChatHandler.setDockOpen(true);
                    ui.chatSidebar.classList.add('active');
                    if (ui.homeChatBtn) ui.homeChatBtn.classList.add('hidden');
                    if (ui.chatExpandBtn) ui.chatExpandBtn.classList.add('hidden');
                    if (ui.homeChatNotif) ui.homeChatNotif.classList.add('hidden');
                    wakeControls();
                },

                closeChatSidebar: () => {
                    ChatHandler.setDockOpen(false);
                    ui.chatSidebar.classList.remove('active');
                    if (ui.homeChatBtn) ui.homeChatBtn.classList.remove('hidden');
                    if (ui.chatExpandBtn) ui.chatExpandBtn.classList.remove('hidden');
                },

                openProfileModal: () => {
                    ui.profileModal.classList.remove('hidden');
                    ui.editFullname.value = state.userFullname || '';
                    ui.editPassword.value = '';
                    const confirmPass = document.getElementById('edit-password-confirm');
                    if (confirmPass) confirmPass.value = '';
                    
                    const btnContainer = document.getElementById('edit-password-btn-container');
                    const inputsContainer = document.getElementById('edit-password-inputs');
                    if (btnContainer && inputsContainer) {
                        btnContainer.classList.remove('hidden');
                        inputsContainer.classList.add('hidden');
                    }
                    
                    if (state.userIcon) {
                        ui.editAvatarPreview.src = state.userIcon.startsWith('/') ? SERVER_URL + state.userIcon : state.userIcon;
                    } else {
                        ui.editAvatarPreview.src = userData.profileIcon ? SERVER_URL + userData.profileIcon : 'default_avatar.png';
                    }
                },
                closeProfileModal: () => {
                    ui.profileModal.classList.add('hidden');
                },
                showPasswordChange: () => {
                    document.getElementById('edit-password-btn-container').classList.add('hidden');
                    document.getElementById('edit-password-inputs').classList.remove('hidden');
                },
                handleEditIconSelect: (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        ui.editAvatarPreview.src = event.target.result;
                        ui.editAvatarPreview.dataset.base64 = event.target.result;
                    };
                    reader.readAsDataURL(file);
                },
                saveProfileModal: async () => {
                    const fullname = ui.editFullname.value.trim();
                    const password = ui.editPassword.value;
                    const confirmPassword = document.getElementById('edit-password-confirm') ? document.getElementById('edit-password-confirm').value : '';
                    
                    if (password && password !== confirmPassword) {
                        alert("Passwords do not match");
                        return;
                    }
                    
                    const icon = ui.editAvatarPreview.dataset.base64;
                    
                    try {
                        const res = await fetch(`${SERVER_URL}/api/user/update`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ uuid: userData.uuid, fullname, newPassword: password, icon })
                        });
                        const data = await res.json();
                        if (data.success) {
                            state.userFullname = data.user.fullname;
                            if (data.user.profileIcon) {
                                state.userIcon = null; // force reload from URL
                                userData.profileIcon = data.user.profileIcon;
                            }
                            localStorage.setItem('samsuUser', JSON.stringify(data.user));
                            document.getElementById('header-name').innerText = state.userFullname;
                            updateHeaderAvatar(icon || data.user.profileIcon, state.userName);
                            ui.profileModal.classList.add('hidden');
                        } else {
                            alert(data.error || 'Failed to update profile');
                        }
                    } catch (e) {
                        alert('Error connecting to server');
                    }
                },

                handleIconSelect: (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const base64 = event.target.result;
                        state.userIcon = base64;
                        localStorage.setItem('lanPlayerIcon', base64);
                        document.getElementById('avatar-preview').src = base64;
                        
                        if (state.userName) {
                            socket.emit('save-user-icon', { name: state.userName, icon: base64 });
                        }
                    };
                    reader.readAsDataURL(file);
                },

                ignoreWarning: () => {
                    document.getElementById('warning-box').classList.add('hidden');
                    activatePlayer(state.pendingVideoUrl, state.pendingVideoName);
                },
                voteSeek: (approve) => {
                    ui.voteApproveBtn.disabled = true;
                    ui.voteRejectBtn.disabled = true;
                    ui.voteApproveBtn.innerText = approve ? "Voted ✓" : "Approve";
                    ui.voteRejectBtn.innerText = !approve ? "Voted ✓" : "Shut up";
                    const evt = { type: 'vote_seek_cast', approve, uuid: state.userUUID, user: state.userName };
                    socket.emit('addon-event', evt);
                    if (state.isHost) handleAddonEvent(evt);
                },
                triggerExecutePlay: () => {
                    const evt = { type: 'execute_play_request', user: state.userName };
                    socket.emit('addon-event', evt);
                    if (state.isHost) handleAddonEvent(evt);
                },
                syncWithHost: () => {
                    ui.desyncOverlay.classList.add('hidden');
                    const delay = (Date.now() - state.lastHostTimestamp) / 1000;
                    ui.video.currentTime = state.lastHostTime + delay;
                    const evt = { type: 'play_request' };
                    socket.emit('addon-event', evt);
                    if (state.isHost) handleAddonEvent(evt);
                },
                requestReplay: () => {
                    ui.desyncOverlay.classList.add('hidden');
                    const evt = { type: 'seek_request', time: ui.video.currentTime, user: state.userName, isReplay: true };
                    socket.emit('addon-event', evt);
                    if (state.isHost) handleAddonEvent(evt);
                },
                voteResume: (resume) => {
                    if (resume) {
                        ui.voteResumeBtn.disabled = true;
                        ui.voteResumeBtn.innerText = "Voted ✓";
                        const evt = { type: 'vote_resume_cast', uuid: state.userUUID };
                        socket.emit('addon-event', evt);
                        if (state.isHost) handleAddonEvent(evt);
                    } else {
                        ui.pauseVotes.classList.remove('bounce-anim');
                        void ui.pauseVotes.offsetWidth; 
                        ui.pauseVotes.classList.add('bounce-anim');
                    }
                }
            };
        })();