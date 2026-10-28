document.addEventListener('DOMContentLoaded', function () {
  function showLoginPopup() {

    const overlay = document.createElement('div');
    overlay.className = 'custom-login-overlay';

    const popup = document.createElement('div');
    popup.className = 'custom-login-popup';
    popup.style.padding = '32px 24px';
    popup.style.borderRadius = '10px';
    popup.style.boxShadow = '0 4px 24px rgba(0,0,0,0.2)';
    popup.style.textAlign = 'center';
    popup.innerHTML = `
      <h2>You need to be logged in!</h2>
      <p>If you want to join a Lobby or create one you need to be logged in!</p>
      <button id="popupLogin" style="margin:12px 8px 0 0;padding:8px 20px;">Yes, Login</button>
      <button id="popupCancel" style="margin:12px 0 0 8px;padding:8px 20px;">No, Bring me back Home</button>
    `;

    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    document.getElementById('popupLogin').onclick = function () {
      window.location.href = '/login';
    };
    document.getElementById('popupCancel').onclick = function () {
      window.location.href = '/';
    };
  }

  function checkAuth() {
    try {
      if (typeof firebase === 'undefined' || !firebase.auth) {
        showLoginPopup();
        return;
      }
      firebase.auth().onAuthStateChanged(function(user) {
        if (!user) showLoginPopup();
      }, showLoginPopup);
    } catch (e) {
      showLoginPopup();
    }
  }

  if (typeof firebase === 'undefined' || !firebase.auth) {
    setTimeout(checkAuth, 200);
  } else {
    checkAuth();
  }
});