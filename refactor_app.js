const fs = require('fs');
let content = fs.readFileSync('js/app.js', 'utf8');

const sysMsgHandler = `socket.on('system-message', (msg) => {
    if (typeof msg === 'object' && msg.type === 'gift') {
        const isMe = (msg.targetName === CoreApp.username);
        let chatText = '';
        let floatHtml = '';
        if (isMe) {
            chatText = \`You received \${msg.amount}$ from God<br>\${msg.htmlMessage}\`;
            floatHtml = \`<div style="font-size:1.2rem; margin-bottom:10px;"><strong>You received \${msg.amount}$ from God</strong></div><div>\${msg.htmlMessage}</div>\`;
        } else {
            chatText = \`\${msg.targetName} was gifted \${msg.amount}$<br>\${msg.htmlMessage}\`;
            floatHtml = \`<div style="font-size:1.2rem; margin-bottom:10px;"><strong>\${msg.targetName} was gifted \${msg.amount}$</strong></div><div>\${msg.htmlMessage}</div>\`;
        }
        
        // Log to chat
        logMsg(chatText, true);

        // Show floating message at bottom left
        const floatDiv = document.createElement('div');
        floatDiv.innerHTML = floatHtml;
        floatDiv.style.position = 'absolute';
        floatDiv.style.bottom = '120px';
        floatDiv.style.left = '30px';
        floatDiv.style.background = 'rgba(255, 215, 0, 0.2)';
        floatDiv.style.backdropFilter = 'blur(10px)';
        floatDiv.style.border = '2px solid gold';
        floatDiv.style.borderRadius = '16px';
        floatDiv.style.padding = '20px';
        floatDiv.style.color = '#fff';
        floatDiv.style.boxShadow = '0 0 30px rgba(255, 215, 0, 0.5)';
        floatDiv.style.zIndex = '9999';
        floatDiv.style.animation = 'slideUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
        floatDiv.style.maxWidth = '400px';
        
        const videoWrapper = document.getElementById('video-wrapper');
        if(videoWrapper) videoWrapper.appendChild(floatDiv);
        
        setTimeout(() => {
            floatDiv.style.animation = 'fadeOut 0.5s ease-out forwards';
            setTimeout(() => floatDiv.remove(), 500);
        }, 8000);
        
        return;
    }
    
    if (typeof msg === 'string' && (msg.includes('started playing') || msg.includes('paused at') || msg.includes('seeked to'))) return;
    logMsg(msg);
});`;

content = content.replace("socket.on('system-message', (msg) => {\n                if (msg.includes('started playing') || msg.includes('paused at') || msg.includes('seeked to')) \nreturn;\n                logMsg(msg); \n            });", sysMsgHandler);
content = content.replace("socket.on('system-message', (msg) => {\n                if (msg.includes('started playing') || msg.includes('paused at') || msg.includes('seeked to')) return;\n                logMsg(msg); \n            });", sysMsgHandler);

fs.writeFileSync('js/app_new.js', content);
