document.addEventListener('DOMContentLoaded', () => {
  if (typeof socket === 'undefined') return;

  const match = window.location.pathname.match(/\/lobby\/([A-Z0-9]{4})$/i);
  const lobbyCode = match ? match[1].toUpperCase() : null;
  if (!lobbyCode) return;

  const messagesContainer = document.getElementById('messages-container');
  const loadingMessage = document.getElementById('loading-message');
  const messageInput = document.getElementById('message-input');
  const sendButton = document.getElementById('send-button');
  const connectionStatus = document.getElementById('connection-status');
  const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
  const HAS_URL = /https?:\/\/[^\s]+/;
  const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif'];
  const imageCheckCache = new Map();

  messageInput.disabled = true;
  sendButton.disabled = true;

  function setStatus(text, state) {
    connectionStatus.textContent = text;
    connectionStatus.className = `connection-status ${state}`;
  }

  function parseUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch {
      return null;
    }
  }

  function isImageUrl(value) {
    if (imageCheckCache.has(value)) return imageCheckCache.get(value);
    const url = parseUrl(value);
    const check = !url
      ? Promise.resolve(false)
      : IMAGE_EXTENSIONS.some((ext) => url.pathname.toLowerCase().endsWith(ext))
        ? Promise.resolve(true)
        : new Promise((resolve) => {
          const img = new Image();
          img.referrerPolicy = 'no-referrer';
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          setTimeout(() => resolve(false), 2000);
          img.src = url.href;
        });
    imageCheckCache.set(value, check);
    return check;
  }

  async function validateMessage(message) {
    for (const url of message.match(URL_PATTERN) || []) {
      if (!parseUrl(url)) return { valid: false, error: 'Invalid URL format' };
      if (!(await isImageUrl(url))) return { valid: false, error: 'Only image URLs are allowed' };
    }
    return { valid: true };
  }

  function fillMessage(bubble, message) {
    for (const part of message.split(URL_PATTERN)) {
      if (!part) continue;
      if (!HAS_URL.test(part)) {
        bubble.append(part);
        continue;
      }
      const placeholder = document.createElement('span');
      placeholder.textContent = part;
      bubble.append(placeholder);
      isImageUrl(part).then((isImage) => {
        if (!isImage) return;
        const img = document.createElement('img');
        img.src = parseUrl(part).href;
        img.alt = 'User Image';
        img.className = 'chat-image';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.style.cssText = 'max-width:200px;max-height:200px;border-radius:8px;margin:5px 0;';
        placeholder.replaceWith(img);
      });
    }
  }

  function renderMessage(data) {
    const element = document.createElement('div');
    if (data.type === 'system') {
      element.className = 'system-message';
      element.textContent = data.message;
      return element;
    }

    const ownUid = myId || firebase.auth().currentUser?.uid;
    const isOwn = Boolean(data.uid) && data.uid === ownUid;
    element.className = `message ${isOwn ? 'own' : 'other'}`;

    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:flex-start;${isOwn ? 'justify-content:flex-end;' : ''}`;
    const avatar = document.createElement('img');
    avatar.className = 'chat-avatar';
    avatar.src = data.uid ? `/avatar/${encodeURIComponent(data.uid)}` : '/assets/images/icon.png';
    avatar.alt = 'avatar';
    avatar.style.cssText = 'width:32px;height:32px;border-radius:50%;object-fit:cover;margin-right:8px;';

    const body = document.createElement('div');
    body.style.cssText = 'flex:1;max-width: calc(100% - 40px);';
    const sender = document.createElement('div');
    sender.className = 'message-sender';
    sender.textContent = isOwn ? 'You' : data.username;
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    fillMessage(bubble, String(data.message ?? ''));
    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = new Date(data.timestamp).toLocaleTimeString();
    body.append(sender, bubble, time);

    if (isOwn) row.append(body, avatar);
    else row.append(avatar, body);
    element.append(row);
    return element;
  }

  function showError(message) {
    document.querySelector('.message-error')?.remove();
    messageInput.style.opacity = '0';
    messageInput.style.transform = 'translateY(10px)';
    sendButton.style.opacity = '0';
    sendButton.style.transform = 'translateY(10px)';

    setTimeout(() => {
      const errorElement = document.createElement('div');
      errorElement.className = 'message-error';
      errorElement.textContent = message;
      errorElement.style.cssText = `
        color: #ff4444;
        background: #841022ff;
        border: 1px solid #3f0006ff;
        border-radius: 8px;
        padding: 8px 12px;
        margin: 5px 0;
        font-size: 14px;
        text-align: center;
        animation: fadeIn 0.3s ease-in;
      `;
      messageInput.parentNode.insertBefore(errorElement, messageInput.nextSibling);
      setTimeout(() => {
        errorElement.remove();
        messageInput.style.opacity = '1';
        messageInput.style.transform = 'translateY(0)';
        sendButton.style.opacity = '1';
        sendButton.style.transform = 'translateY(0)';
      }, 2000);
    }, 300);
  }

  async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;
    const validation = await validateMessage(message);
    if (!validation.valid) return showError(validation.error);
    socket.emit('lobbyChatMessage', { lobby: lobbyCode, message });
    messageInput.value = '';
    document.dispatchEvent(new CustomEvent('messageSent', { detail: { message } }));
  }

  if (!document.getElementById('chat-styles')) {
    const style = document.createElement('style');
    style.id = 'chat-styles';
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .chat-image { transition: transform 0.2s ease; }
      .chat-image:hover { transform: scale(1.02); }
      .message-error { animation: fadeIn 0.3s ease-in !important; }
      #message-input, #send-button { transition: all 0.3s ease-in-out; }
    `;
    document.head.append(style);
  }

  firebase.auth().onAuthStateChanged((user) => {
    if (!user) setStatus('Not signed in', 'disconnected');
  });

  function joinChat() {
    setStatus('Connected', 'connected');
    messagesContainer.replaceChildren(loadingMessage);
    loadingMessage.style.display = '';
    socket.emit('lobbyChatJoin', { lobby: lobbyCode });
  }

  socket.on('connect', joinChat);
  if (socket.connected) joinChat();

  socket.on('lobbyChatJoined', () => {
    messageInput.disabled = false;
    sendButton.disabled = false;
    messageInput.focus();
    loadingMessage.style.display = 'none';
  });

  socket.on('lobbyChatMessage', (data) => {
    messagesContainer.append(renderMessage(data));
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });

  socket.on('lobbyChatError', showError);

  socket.on('disconnect', () => {
    setStatus('Disconnected', 'disconnected');
    messageInput.disabled = true;
    sendButton.disabled = true;
  });

  sendButton.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) sendMessage();
  });

  messageInput.addEventListener('input', async () => {
    const message = messageInput.value.trim();
    const valid = !HAS_URL.test(message) || (await validateMessage(message)).valid;
    messageInput.style.borderColor = valid ? '' : '#ff4444';
    sendButton.disabled = !valid;
    sendButton.style.opacity = valid ? '1' : '0.5';
  });
});
