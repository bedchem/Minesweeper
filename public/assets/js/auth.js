document.addEventListener('DOMContentLoaded', function () {
  const auth = firebase.auth();
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(console.error);

  const loginEmailInput = document.getElementById('loginUsername');
  const loginPasswordInput = document.getElementById('loginPassword');
  const registerEmailInput = document.getElementById('registerEmail');
  const registerPasswordInput = document.getElementById('registerPassword');
  const registerUsernameInput = document.getElementById('registerUsername');
  const sendResetEmailBtn = document.getElementById('sendResetEmailBtn');
  const form = document.querySelector('.form_main');

  const resetPasswordModal = document.getElementById('resetPasswordModal');
  const resetEmailInput = document.getElementById('resetEmail');
  const submitResetEmailBtn = document.getElementById('submitResetEmail');
  const closeModal = document.querySelector('.close');

  const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,12}$/;
  let authFlowInProgress = false;

  async function apiPost(url, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }

  function resetCaptcha() {
    if (typeof grecaptcha !== 'undefined') grecaptcha.reset();
  }

  function captchaToken() {
    if (typeof grecaptcha === 'undefined') {
      showCustomAlert('Captcha konnte nicht geladen werden', 'error');
      return null;
    }
    const token = grecaptcha.getResponse();
    if (!token) showCustomAlert('Bitte löse das Captcha', 'error');
    return token || null;
  }

  async function verifyCaptcha(action) {
    const token = captchaToken();
    if (!token) return false;
    const { ok, data } = await apiPost('/recaptcha', { token, action });
    if (!ok || !data.success) {
      resetCaptcha();
      showCustomAlert('Captcha ungültig, bitte erneut versuchen', 'error');
      return false;
    }
    return true;
  }

  function redirectToProfile() {
    setTimeout(() => { window.location.href = '/profile'; }, 1500);
  }

  const toggle = document.getElementById('toggleLoginPassword');
  const passwordInput = loginPasswordInput || registerPasswordInput;
  if (toggle && passwordInput) {
    toggle.addEventListener('click', () => {
      passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
      toggle.classList.toggle('fa-eye');
      toggle.classList.toggle('fa-eye-slash');
    });
  }

  if (sendResetEmailBtn && resetPasswordModal) {
    sendResetEmailBtn.addEventListener('click', function () {
      if (loginEmailInput && loginEmailInput.value) resetEmailInput.value = loginEmailInput.value;
      resetPasswordModal.style.display = 'flex';
    });
  }

  if (closeModal && resetPasswordModal) {
    closeModal.addEventListener('click', function () {
      resetPasswordModal.style.display = 'none';
    });
  }

  if (resetPasswordModal) {
    window.addEventListener('click', function (event) {
      if (event.target === resetPasswordModal) resetPasswordModal.style.display = 'none';
    });
  }

  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  if (submitResetEmailBtn) {
    submitResetEmailBtn.addEventListener('click', async function () {
      const email = resetEmailInput.value.trim();
      if (!email) return showCustomAlert('Bitte gib deine E-Mail Adresse ein', 'error');
      if (!validateEmail(email)) return showCustomAlert('Bitte gib eine gültige E-Mail Adresse ein', 'error');

      try {
        await auth.sendPasswordResetEmail(email);
        showCustomAlert('Falls ein Konto existiert, wurde ein Reset-Link an ' + email + ' gesendet', 'success');
        resetPasswordModal.style.display = 'none';
        resetEmailInput.value = '';
      } catch (error) {
        console.error('Password reset error:', error);
        let errorMessage = 'Fehler beim Senden des Reset-Links';
        if (error.code === 'auth/user-not-found') {
          showCustomAlert('Falls ein Konto existiert, wurde ein Reset-Link an ' + email + ' gesendet', 'success');
          resetPasswordModal.style.display = 'none';
          return;
        }
        if (error.code === 'auth/invalid-email') errorMessage = 'Ungültige E-Mail Adresse';
        else if (error.code === 'auth/too-many-requests') errorMessage = 'Zu viele Versuche. Bitte warte einen Moment';
        showCustomAlert(errorMessage, 'error');
      }
    });
  }

  auth.onAuthStateChanged(async (user) => {
    if (!user || authFlowInProgress) return;
    try {
      const { ok, data } = await apiPost('/api/getUser', {}, await user.getIdToken());
      if (ok && data.username && user.displayName !== data.username) {
        await user.updateProfile({ displayName: data.username });
      }
    } catch (err) {
      console.error('Error fetching user data:', err);
    }
  });

  async function login() {
    const email = loginEmailInput.value.trim();
    const password = loginPasswordInput.value.trim();
    if (!email || !password) return showCustomAlert('Bitte fülle alle Felder aus', 'error');
    if (!(await verifyCaptcha('login'))) return;

    try {
      await auth.signInWithEmailAndPassword(email, password);
      showCustomAlert('Login erfolgreich!', 'success');
      redirectToProfile();
    } catch (error) {
      resetCaptcha();
      let errorMessage = 'Login fehlgeschlagen!';
      if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(error.code)) {
        errorMessage = 'E-Mail oder Passwort ist falsch!';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Ungültige E-Mail Adresse!';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Zu viele fehlgeschlagene Versuche. Bitte versuche es später erneut';
      }
      showCustomAlert(errorMessage, 'error');
    }
  }

  async function register() {
    const email = registerEmailInput.value.trim();
    const password = registerPasswordInput.value.trim();
    const username = registerUsernameInput.value.trim();

    if (!email || !password || !username) return showCustomAlert('Bitte fülle alle Felder aus', 'error');
    if (username.length < 3 || username.length > 12) return showCustomAlert('Benutzername muss 3-12 Zeichen lang sein', 'error');
    if (!USERNAME_PATTERN.test(username)) return showCustomAlert('Benutzername darf nur Buchstaben, Zahlen und Unterstriche enthalten', 'error');
    if (password.length < 6) return showCustomAlert('Passwort muss mindestens 6 Zeichen lang sein', 'error');

    const check = await apiPost('/api/checkUsername', { username });
    if (check.data.exists) return showCustomAlert('Benutzername ist bereits vergeben', 'error');
    // the token is single use, the server checks it when the account is created
    const captcha = captchaToken();
    if (!captcha) return;

    let user;
    try {
      ({ user } = await auth.createUserWithEmailAndPassword(email, password));
    } catch (error) {
      resetCaptcha();
      console.error('Registration error:', error);
      let errorMessage = 'Registrierung fehlgeschlagen!';
      if (error.code === 'auth/email-already-in-use') errorMessage = 'E-Mail Adresse wird bereits verwendet!';
      else if (error.code === 'auth/weak-password') errorMessage = 'Passwort ist zu schwach!';
      else if (error.code === 'auth/invalid-email') errorMessage = 'Ungültige E-Mail Adresse!';
      return showCustomAlert(errorMessage, 'error');
    }

    const created = await apiPost('/api/createUser', { username, captchaToken: captcha }, await user.getIdToken());
    if (!created.ok) {
      // don't leave an account without data behind
      await user.delete().catch(console.error);
      resetCaptcha();
      if (created.data.code === 'captcha') return showCustomAlert('Captcha ungültig, bitte erneut versuchen', 'error');
      return showCustomAlert(created.status === 409 ? 'Benutzername ist bereits vergeben' : 'Registrierung fehlgeschlagen!', 'error');
    }
    await user.updateProfile({ displayName: created.data.username });
    showCustomAlert('Registrierung erfolgreich!', 'success');
    redirectToProfile();
  }

  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (authFlowInProgress) return;
      authFlowInProgress = true;
      try {
        if (registerUsernameInput) await register();
        else if (loginEmailInput && loginPasswordInput) await login();
      } catch (error) {
        console.error('Auth error:', error);
        showCustomAlert('Etwas ist schiefgelaufen, bitte versuche es erneut', 'error');
      } finally {
        authFlowInProgress = false;
      }
    });
  }

  const providers = {
    google: () => new firebase.auth.GoogleAuthProvider(),
    twitter: () => new firebase.auth.TwitterAuthProvider(),
    github: () => new firebase.auth.GithubAuthProvider(),
    discord: () => new firebase.auth.OAuthProvider('oidc.discord')
  };

  document.querySelectorAll('.signin').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.preventDefault();
      if (authFlowInProgress) return;
      const icon = btn.querySelector('i');
      const brand = Object.keys(providers).find((name) => icon?.classList.contains(`fa-${name}`));
      if (!brand) return;

      authFlowInProgress = true;
      showCustomAlert(`${brand} Login wird vorbereitet...`, 'info');
      try {
        const { user } = await auth.signInWithPopup(providers[brand]());
        const token = await user.getIdToken();

        let { ok, data } = await apiPost('/api/getUser', {}, token);
        if (!ok) {
          const wanted = user.displayName || (user.email ? user.email.split('@')[0] : '');
          ({ ok, data } = await apiPost('/api/createUser', { username: wanted }, token));
          if (!ok) throw new Error(data.message || 'Could not create user');
        }
        if (data.username && user.displayName !== data.username) {
          await user.updateProfile({ displayName: data.username });
        }

        showCustomAlert(`${brand} Login erfolgreich!`, 'success');
        redirectToProfile();
      } catch (error) {
        console.error('OAuth error:', error);
        let errorMessage = `${brand} Login fehlgeschlagen!`;
        if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
          errorMessage = 'Login wurde abgebrochen';
        } else if (error.code === 'auth/popup-blocked') {
          errorMessage = 'Popup wurde blockiert. Bitte erlaube Popups für diese Seite';
        } else if (error.code === 'auth/account-exists-with-different-credential') {
          errorMessage = 'Diese E-Mail ist bereits mit einer anderen Anmeldemethode verknüpft';
        }
        showCustomAlert(errorMessage, 'error');
      } finally {
        authFlowInProgress = false;
      }
    });
  });
});
