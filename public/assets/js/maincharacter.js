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

  function showName(name) {
    dropdownEmail.textContent = name || '';
    const myStatsBtn = document.getElementById('myStatsBtn');
    if (myStatsBtn && name) {
      myStatsBtn.style.display = 'inline-block';
      myStatsBtn.onclick = () => {
        window.location.href = `/stats/${encodeURIComponent(name)}`;
      };
    }
  }

  function showAvatar(user) {
    for (const img of [headerAvatar, dropdownAvatar]) {
      if (!img) continue;
      Avatars.bind(img, user.uid);
      img.style.display = 'inline-block';
    }
  }

  // the server knows the current picture version and username (it may have been renamed, e.g. by an admin)
  async function syncAccount(user) {
    try {
      const response = await fetch('/api/getUser', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}` }
      });
      if (!response.ok) return;
      const data = await response.json();
      Avatars.setOwn(user.uid, data.avatarVersion);
      if (data.username && data.username !== user.displayName) {
        await user.updateProfile({ displayName: data.username });
        showName(data.username);
      }
    } catch (err) {
      console.error('Could not load account data:', err);
    }
  }

  firebase.auth().onAuthStateChanged(function (user) {
    if (!user) return showSignedOut();

    userIcon.style.display = 'flex';
    signInBtn.style.display = 'none';
    showName(user.displayName);

    // with a known version the picture comes straight from the cache; otherwise wait for it, so it loads once
    if (Avatars.known(user.uid)) {
      showAvatar(user);
      syncAccount(user);
    } else {
      syncAccount(user).finally(() => showAvatar(user));
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
