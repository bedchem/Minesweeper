
class AlertManager {
    constructor() {
        this.container = document.getElementById('alert-container');
    }

    show(title, message, type = 'info', duration = 5000) {
        const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
        const alert = document.createElement('div');
        alert.className = `custom-alert ${type}`;

        const icon = document.createElement('div');
        icon.className = 'alert-icon';
        icon.textContent = icons[type] || icons.info;
        const content = document.createElement('div');
        content.className = 'alert-content';
        const titleEl = document.createElement('div');
        titleEl.className = 'alert-title';
        titleEl.textContent = title;
        const messageEl = document.createElement('div');
        messageEl.className = 'alert-message';
        messageEl.textContent = message;
        content.append(titleEl, messageEl);
        const close = document.createElement('button');
        close.className = 'alert-close';
        close.textContent = '×';
        close.addEventListener('click', () => this.close(alert));
        alert.append(icon, content, close);

        this.container.appendChild(alert);
        setTimeout(() => alert.classList.add('show'), 10);
        if (duration > 0) setTimeout(() => this.close(alert), duration);
        return alert;
    }

    close(alert) {
        alert.classList.remove('show');
        setTimeout(() => alert.remove(), 300);
    }

    success(title, message, duration) { return this.show(title, message, 'success', duration); }
    error(title, message, duration) { return this.show(title, message, 'error', duration); }
    warning(title, message, duration) { return this.show(title, message, 'warning', duration); }
    info(title, message, duration) { return this.show(title, message, 'info', duration); }
}

const alertManager = new AlertManager();

let currentUser = null;
let refreshTimer = null;
let clockTimer = null;
let allUsers = [];
let socket = null;

const $ = (id) => document.getElementById(id);
const loginScreen = $('login-screen');
const adminDashboard = $('admin-dashboard');
const loginEmail = $('login-email');
const loginPassword = $('login-password');
const loginBtn = $('login-btn');
const loginText = $('login-text');
const loginSpinner = $('login-spinner');
const loginError = $('login-error');
const tabLinks = document.querySelectorAll('.sidebar-menu a[data-tab]');
const tabContents = document.querySelectorAll('.tab-content');
const addUserModal = $('add-user-modal');
const editUserModal = $('edit-user-modal');

const SETTINGS_KEY = 'minesweeperAdminSettings';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function formatDate(value, withTime = false) {
    if (!value) return 'Unbekannt';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unbekannt';
    return withTime ? date.toLocaleString('de-DE') : date.toLocaleDateString('de-DE');
}

function loadSettings() {
    try {
        return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch {
        return {};
    }
}

async function adminApi(path, { method = 'GET', body } = {}) {
    const token = await currentUser.getIdToken();
    const response = await fetch(`/api/admin${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
    return data;
}

function setLoading(loading) {
    loginText.style.display = loading ? 'none' : 'inline-block';
    loginSpinner.style.display = loading ? 'inline-block' : 'none';
    loginBtn.disabled = loading;
}

function showLoginError(message) {
    loginError.textContent = message;
    loginError.style.display = 'block';
}

function showLoginScreen() {
    loginScreen.style.display = 'flex';
    adminDashboard.style.display = 'none';
    clearInterval(refreshTimer);
    refreshTimer = null;
    if (socket) {
        socket.disconnect();
        socket = null;
    }
}

function showAdminDashboard() {
    loginScreen.style.display = 'none';
    adminDashboard.style.display = 'flex';
    const userInfo = $('user-info');
    userInfo.textContent = `${currentUser.email || currentUser.displayName || ''} `;
    const tag = document.createElement('span');
    tag.className = 'tag tag-admin';
    tag.textContent = 'Admin';
    userInfo.append(tag);

    startAutoRefresh();
    loadTabData(document.querySelector('.tab-content.active').id, true);
    connectToSocket();
    alertManager.success('Erfolgreich angemeldet', `Willkommen, ${currentUser.email || currentUser.displayName}!`);
}

async function checkAdminAccess(user) {
    try {
        const response = await fetch('/api/getUser', {
            method: 'POST',
            headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
            body: '{}'
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.isAdmin) {
            loginError.style.display = 'none';
            showAdminDashboard();
            return;
        }
        showLoginError('Sie haben keine Administratorberechtigungen.');
        alertManager.error('Zugriff verweigert', 'Sie haben keine Administratorberechtigungen.');
    } catch (error) {
        console.error('Fehler beim Überprüfen der Admin-Berechtigung:', error);
        showLoginError('Fehler beim Überprüfen der Berechtigungen.');
    } finally {
        setLoading(false);
    }
    firebase.auth().signOut();
}

async function handleLogin() {
    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    if (!email || !password) return showLoginError('Bitte geben Sie E-Mail und Passwort ein.');
    setLoading(true);
    try {
        await firebase.auth().signInWithEmailAndPassword(email, password);
        loginError.style.display = 'none';
    } catch (error) {
        showLoginError('Anmeldung fehlgeschlagen: ' + error.message);
        alertManager.error('Anmeldung fehlgeschlagen', error.message);
        setLoading(false);
    }
}

function handleLogout(event) {
    event.preventDefault();
    if (!confirm('Möchten Sie sich wirklich abmelden?')) return;
    alertManager.info('Abmeldung', 'Sie werden abgemeldet...');
    setTimeout(() => firebase.auth().signOut(), 1000);
}

function updateTime() {
    $('current-time').textContent = new Date().toLocaleString('de-DE');
}

function startAutoRefresh() {
    const seconds = Math.max(10, Number($('refresh-interval').value) || 30);
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
        loadTabData(document.querySelector('.tab-content.active').id, true);
    }, seconds * 1000);
}

function connectToSocket() {
    if (socket) socket.disconnect();
    socket = io({
        auth: (cb) => {
            if (!currentUser) return cb({});
            currentUser.getIdToken().then((token) => cb({ token }), () => cb({}));
        }
    });
    const status = $('connection-status');
    socket.on('connect', () => {
        status.textContent = '● Verbunden';
        status.className = 'status-online';
    });
    socket.on('disconnect', () => {
        status.textContent = '● Getrennt';
        status.className = 'status-offline';
    });
    socket.on('connect_error', () => {
        status.textContent = '● Getrennt';
        status.className = 'status-offline';
    });
}

function loadTabData(tabId, silent = false) {
    switch (tabId) {
        case 'dashboard': return loadDashboardData();
        case 'users': return loadUsers(silent);
        case 'lobbies': return loadLobbies(silent);
        case 'sessions': return loadSessions(silent);
        case 'leaderboard': {
            const type = document.querySelector('.tab[data-leaderboard-type].active').getAttribute('data-leaderboard-type');
            return loadLeaderboard(type, silent);
        }
        default: return undefined;
    }
}

async function loadDashboardData() {
    try {
        const data = await adminApi('/overview');
        $('total-players').textContent = data.totalPlayers;
        $('active-lobbies').textContent = data.activeLobbies;
        $('active-sessions').textContent = data.activeSessions;
        $('avg-game-time').textContent = `${data.averageTime}s`;
        $('server-load').style.width = `${data.serverLoad}%`;
        $('memory-usage').style.width = `${data.memoryUsage}%`;
        $('system-status').textContent = 'Online';
        $('system-status').className = 'status-online';

        const log = $('activity-log');
        log.innerHTML = data.activity.length === 0
            ? '<tr><td colspan="3">Noch keine Aktivität seit dem Serverstart</td></tr>'
            : data.activity.map((entry) => `
                <tr>
                    <td>${escapeHtml(new Date(entry.time).toLocaleTimeString('de-DE'))}</td>
                    <td>${escapeHtml(entry.user)}</td>
                    <td>${escapeHtml(entry.action)}</td>
                </tr>
            `).join('');
    } catch (err) {
        console.error('Fehler beim Laden der Dashboard-Daten:', err);
        $('system-status').textContent = 'Fehler';
        $('system-status').className = 'status-offline';
        alertManager.error('Fehler', `Dashboard konnte nicht geladen werden: ${err.message}`);
    }
}

async function loadUsers(silent = false) {
    try {
        allUsers = await adminApi('/users');
        filterUsers();
        if (!silent) alertManager.success('Benutzer geladen', `${allUsers.length} Benutzer wurden geladen.`);
    } catch (err) {
        console.error('Fehler beim Laden der Benutzer:', err);
        alertManager.error('Fehler', `Benutzer konnten nicht geladen werden: ${err.message}`);
    }
}

function renderUsersTable(users) {
    const usersTable = $('users-table');
    usersTable.innerHTML = users.map((user) => {
        const roleTag = user.role === 'admin' ? 'tag-admin' : user.role === 'moderator' ? 'tag-moderator' : 'tag-user';
        return `
            <tr>
                <td>${escapeHtml(user.uid)}</td>
                <td>${escapeHtml(user.username)}</td>
                <td>${escapeHtml(user.email || 'Nicht verfügbar')}</td>
                <td><span class="tag ${roleTag}">${escapeHtml(user.role)}</span></td>
                <td>${escapeHtml(formatDate(user.createdAt))}</td>
                <td>${Number(user.gamesPlayed) || 0}</td>
                <td>
                    <button class="btn btn-sm btn-warning edit-user" data-uid="${escapeHtml(user.uid)}">Bearbeiten</button>
                    <button class="btn btn-sm btn-danger delete-user" data-uid="${escapeHtml(user.uid)}">Löschen</button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterUsers() {
    const term = $('user-search').value.toLowerCase();
    renderUsersTable(allUsers.filter((user) =>
        user.username.toLowerCase().includes(term) || (user.email || '').toLowerCase().includes(term)
    ));
}

function showAddUserModal() {
    addUserModal.style.display = 'flex';
}

function hideAddUserModal() {
    addUserModal.style.display = 'none';
    $('new-username').value = '';
    $('new-email').value = '';
    $('new-password').value = '';
    $('new-role').value = 'user';
}

async function addNewUser() {
    const body = {
        username: $('new-username').value.trim(),
        email: $('new-email').value.trim(),
        password: $('new-password').value,
        role: $('new-role').value
    };
    if (!body.username || !body.email || !body.password) {
        return alertManager.error('Fehlende Daten', 'Bitte füllen Sie alle Felder aus.');
    }
    try {
        await adminApi('/users', { method: 'POST', body });
        alertManager.success('Benutzer erstellt', `Benutzer "${body.username}" wurde erfolgreich erstellt.`);
        hideAddUserModal();
        loadUsers(true);
    } catch (err) {
        alertManager.error('Fehler', `Benutzer konnte nicht erstellt werden: ${err.message}`);
    }
}

function editUser(uid) {
    const user = allUsers.find((u) => u.uid === uid);
    if (!user) return;
    $('edit-user-id').value = user.uid;
    $('edit-username').value = user.username;
    $('edit-email').value = user.email || '';
    $('edit-role').value = user.role;
    editUserModal.style.display = 'flex';
}

async function saveUserChanges() {
    const uid = $('edit-user-id').value;
    const body = {
        username: $('edit-username').value.trim(),
        email: $('edit-email').value.trim(),
        role: $('edit-role').value
    };
    try {
        await adminApi(`/users/${encodeURIComponent(uid)}`, { method: 'PATCH', body });
        alertManager.success('Benutzer aktualisiert', 'Die Benutzerdaten wurden erfolgreich gespeichert.');
        editUserModal.style.display = 'none';
        loadUsers(true);
    } catch (err) {
        alertManager.error('Fehler', `Fehler beim Aktualisieren des Benutzers: ${err.message}`);
    }
}

async function deleteUser(uid) {
    const user = allUsers.find((u) => u.uid === uid);
    if (!user || !confirm(`Möchten Sie den Benutzer "${user.username}" wirklich löschen?`)) return;
    try {
        await adminApi(`/users/${encodeURIComponent(uid)}`, { method: 'DELETE' });
        alertManager.success('Benutzer gelöscht', `Benutzer "${user.username}" wurde erfolgreich gelöscht.`);
        loadUsers(true);
    } catch (err) {
        alertManager.error('Fehler', `Fehler beim Löschen des Benutzers: ${err.message}`);
    }
}

const STATUS_LABELS = { waiting: 'Wartend', starting: 'Startet', playing: 'Aktiv', completed: 'Beendet' };
let allLobbies = [];

async function loadLobbies(silent = false) {
    try {
        allLobbies = await adminApi('/lobbies');
        $('lobbies-table').innerHTML = allLobbies.map((lobby) => `
            <tr>
                <td>${escapeHtml(lobby.code)}</td>
                <td>${escapeHtml(lobby.difficulty)}</td>
                <td>${Number(lobby.players)}/${Number(lobby.maxPlayers)}</td>
                <td>${escapeHtml(STATUS_LABELS[lobby.status] || lobby.status)}</td>
                <td>${escapeHtml(lobby.host || 'Unbekannt')}</td>
                <td>
                    <button class="btn btn-sm btn-warning view-lobby" data-code="${escapeHtml(lobby.code)}">Anzeigen</button>
                    <button class="btn btn-sm btn-danger close-lobby" data-code="${escapeHtml(lobby.code)}">Schließen</button>
                </td>
            </tr>
        `).join('');
        if (!silent) alertManager.success('Lobbies geladen', `${allLobbies.length} aktive Lobbies wurden geladen.`);
    } catch (err) {
        console.error('Fehler beim Laden der Lobbies:', err);
        alertManager.error('Fehler', `Lobbies konnten nicht geladen werden: ${err.message}`);
    }
}

function viewLobby(code) {
    const lobby = allLobbies.find((l) => l.code === code);
    if (!lobby) return;
    alertManager.info(`Lobby ${lobby.code}`,
        `Host: ${lobby.host || 'Unbekannt'} · Spieler: ${lobby.players}/${lobby.maxPlayers} · ` +
        `Schwierigkeit: ${lobby.difficulty} · Status: ${STATUS_LABELS[lobby.status] || lobby.status}`, 8000);
}

async function closeLobby(code) {
    if (!confirm(`Möchten Sie die Lobby "${code}" wirklich schließen?`)) return;
    try {
        await adminApi(`/lobbies/${encodeURIComponent(code)}`, { method: 'DELETE' });
        alertManager.success('Lobby geschlossen', `Lobby "${code}" wurde erfolgreich geschlossen.`);
        loadLobbies(true);
    } catch (err) {
        alertManager.error('Fehler', `Lobby konnte nicht geschlossen werden: ${err.message}`);
    }
}

async function loadSessions(silent = false) {
    try {
        const sessions = await adminApi('/sessions');
        $('sessions-table').innerHTML = sessions.map((session) => `
            <tr>
                <td>${escapeHtml(session.username)}</td>
                <td><span class="tag tag-online"><span class="live-indicator"></span>online</span></td>
                <td>${escapeHtml(session.lobby || 'Keine')}</td>
                <td>${escapeHtml(formatDate(session.connectedAt, true))}</td>
                <td>${escapeHtml(formatDate(session.lastActivity, true))}</td>
                <td>
                    <button class="btn btn-sm btn-danger disconnect-session" data-id="${escapeHtml(session.id)}" data-name="${escapeHtml(session.username)}">Trennen</button>
                </td>
            </tr>
        `).join('');
        const uniqueUsers = new Set(sessions.map((s) => s.uid)).size;
        $('online-users').textContent = uniqueUsers;
        $('connected-clients').textContent = sessions.length;
        $('active-sessions').textContent = sessions.length;
        if (!silent) alertManager.success('Sessions geladen', `${sessions.length} aktive Sessions wurden geladen.`);
    } catch (err) {
        console.error('Fehler beim Laden der Sessions:', err);
        alertManager.error('Fehler', `Sessions konnten nicht geladen werden: ${err.message}`);
    }
}

async function disconnectSession(id, name) {
    if (!confirm(`Möchten Sie die Session von "${name}" wirklich trennen?`)) return;
    try {
        await adminApi(`/sessions/${encodeURIComponent(id)}/disconnect`, { method: 'POST' });
        alertManager.success('Session getrennt', `Session von "${name}" wurde getrennt.`);
        loadSessions(true);
    } catch (err) {
        alertManager.error('Fehler', `Session konnte nicht getrennt werden: ${err.message}`);
    }
}

async function loadLeaderboard(type, silent = false) {
    $('leaderboard-value-header').textContent = type === 'multiplayer' ? 'Siege' : 'Beste Zeit';
    try {
        const response = await fetch(`/api/getLeaderboard?type=${encodeURIComponent(type)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        $('leaderboard-table').innerHTML = data.map((player) => `
            <tr>
                <td>${Number(player.rank)}</td>
                <td>${escapeHtml(player.username)}</td>
                <td>${type === 'multiplayer' ? Number(player.value) : `${Number(player.value)}s`}</td>
            </tr>
        `).join('');
        if (!silent) alertManager.success('Leaderboard geladen', `${type === 'multiplayer' ? 'Multiplayer' : 'Singleplayer'} Leaderboard wurde geladen.`);
    } catch (err) {
        console.error('Fehler beim Laden des Leaderboards:', err);
        alertManager.error('Fehler', `Leaderboard konnte nicht geladen werden: ${err.message}`);
    }
}

function saveSettings() {
    const settings = {
        serverUrl: $('server-url').value.trim(),
        refreshInterval: Math.max(10, Number($('refresh-interval').value) || 30)
    };
    $('refresh-interval').value = settings.refreshInterval;
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
    }
    alertManager.success('Einstellungen gespeichert', 'Die Einstellungen wurden erfolgreich gespeichert.');
    startAutoRefresh();
}

document.addEventListener('DOMContentLoaded', () => {
    const settings = loadSettings();
    if (settings.serverUrl) $('server-url').value = settings.serverUrl;
    if (settings.refreshInterval) $('refresh-interval').value = settings.refreshInterval;

    firebase.auth().onAuthStateChanged((user) => {
        currentUser = user;
        if (user) checkAdminAccess(user);
        else showLoginScreen();
    });

    tabLinks.forEach((link) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = link.getAttribute('data-tab');
            tabLinks.forEach((l) => l.classList.toggle('active', l === link));
            tabContents.forEach((content) => content.classList.toggle('active', content.id === tabId));
            loadTabData(tabId, true);
        });
    });

    loginBtn.addEventListener('click', handleLogin);
    loginPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
    $('logout-btn').addEventListener('click', handleLogout);

    document.querySelectorAll('.tab[data-leaderboard-type]').forEach((tab) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab[data-leaderboard-type]').forEach((t) => t.classList.toggle('active', t === tab));
            loadLeaderboard(tab.getAttribute('data-leaderboard-type'), true);
        });
    });

    $('refresh-users').addEventListener('click', () => loadUsers());
    $('add-user-btn').addEventListener('click', showAddUserModal);
    $('cancel-add-user').addEventListener('click', hideAddUserModal);
    $('confirm-add-user').addEventListener('click', addNewUser);
    $('cancel-edit-user').addEventListener('click', () => { editUserModal.style.display = 'none'; });
    $('confirm-edit-user').addEventListener('click', saveUserChanges);
    $('user-search').addEventListener('input', filterUsers);
    $('refresh-lobbies').addEventListener('click', () => loadLobbies());
    $('refresh-sessions').addEventListener('click', () => loadSessions());
    $('refresh-leaderboard').addEventListener('click', () => {
        const active = document.querySelector('.tab[data-leaderboard-type].active');
        loadLeaderboard(active.getAttribute('data-leaderboard-type'));
    });
    $('save-settings').addEventListener('click', saveSettings);

    $('users-table').addEventListener('click', (e) => {
        const button = e.target.closest('button[data-uid]');
        if (!button) return;
        if (button.classList.contains('edit-user')) editUser(button.dataset.uid);
        if (button.classList.contains('delete-user')) deleteUser(button.dataset.uid);
    });
    $('lobbies-table').addEventListener('click', (e) => {
        const button = e.target.closest('button[data-code]');
        if (!button) return;
        if (button.classList.contains('view-lobby')) viewLobby(button.dataset.code);
        if (button.classList.contains('close-lobby')) closeLobby(button.dataset.code);
    });
    $('sessions-table').addEventListener('click', (e) => {
        const button = e.target.closest('button.disconnect-session');
        if (button) disconnectSession(button.dataset.id, button.dataset.name);
    });

    document.querySelectorAll('.modal-close').forEach((btn) => {
        btn.addEventListener('click', () => { btn.closest('.modal').style.display = 'none'; });
    });
    document.querySelectorAll('.modal').forEach((modal) => {
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
    });

    updateTime();
    clearInterval(clockTimer);
    clockTimer = setInterval(updateTime, 1000);
});
