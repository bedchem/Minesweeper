document.addEventListener('DOMContentLoaded', function () {
  const userIcon = document.getElementById('userIcon');
  const userDropdown = document.getElementById('userDropdown');
  const dropdownEmail = document.getElementById('dropdownEmail');
  const signInBtn = document.getElementById('signInBtn');
  const logoutBtn = document.getElementById('dropdownLogout');
  const statsBtn = document.getElementById('dropdownStats');
  const headerAvatar = document.getElementById('headerAvatar');
  const dropdownAvatar = document.getElementById('dropdownAvatar');

  function showSignedOut() {
    userIcon.style.display = 'none';
    userDropdown.classList.remove('active');
    signInBtn.style.display = 'inline-block';
    dropdownEmail.textContent = '';
  }

  if (statsBtn) {
    statsBtn.href = '/stats';
    statsBtn.addEventListener('click', function (e) {
      if (firebase.auth().currentUser?.displayName) return;
      e.preventDefault();
      if (typeof showCustomAlert === 'function') showCustomAlert('No username set... weird... report it.', 'error');
    });
  }

  firebase.auth().onAuthStateChanged(function (user) {
    if (!user) return showSignedOut();

    userIcon.style.display = 'flex';
    signInBtn.style.display = 'none';
    dropdownEmail.textContent = user.displayName || '';

    const myStatsBtn = document.getElementById('myStatsBtn');
    if (myStatsBtn && user.displayName) {
      myStatsBtn.style.display = 'inline-block';
      myStatsBtn.onclick = () => {
        window.location.href = `/stats/${encodeURIComponent(user.displayName)}`;
      };
    }

    const avatar = `/avatar/${encodeURIComponent(user.uid)}`;
    for (const img of [headerAvatar, dropdownAvatar]) {
      if (!img) continue;
      img.src = avatar;
      img.style.display = 'inline-block';
    }
  });

  userIcon.addEventListener('click', function (e) {
    userDropdown.classList.toggle('active');
    e.stopPropagation();
  });

  document.addEventListener('click', function (e) {
    if (!userDropdown.contains(e.target) && !userIcon.contains(e.target)) userDropdown.classList.remove('active');
  });

  logoutBtn.addEventListener('click', function (e) {
    e.preventDefault();
    firebase.auth().signOut().then(function () {
      userDropdown.classList.remove('active');
      location.reload();
    });
  });

  const backButtonIndex = document.getElementById('backButtonIndex');
  if (backButtonIndex) {
    backButtonIndex.onclick = () => { window.location.href = '/'; };
  }

  const backButton = document.getElementById('backButton');
  if (backButton && !backButton.onclick) {
    backButton.addEventListener('click', () => {
      let referrer = null;
      try {
        referrer = document.referrer ? new URL(document.referrer) : null;
      } catch {
        referrer = null;
      }
      const section = referrer ? referrer.pathname.split('/')[1].replace(/\.html$/, '') : '';
      const forbidden = ['lobby', 'register', 'login'];
      if (referrer && referrer.origin === window.location.origin && !forbidden.includes(section)) {
        window.history.back();
      } else {
        window.location.href = '/';
      }
    });
  }
});
