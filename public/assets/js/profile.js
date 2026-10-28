document.addEventListener('DOMContentLoaded', function () {
  const auth = firebase.auth();
  const statusText = document.getElementById('status');
  const logoutBtn = document.getElementById('logoutprofileBtn');
  const deleteBtn = document.getElementById('deleteBtn');
  const saveNameBtn = document.getElementById('saveNameBtnProfile');
  const usernameInput = document.getElementById('usernameInput');
  const emailElem = document.getElementById('email');
  const toggleEmailBtn = document.getElementById('toggleEmail');
  const sendResetEmailBtn = document.getElementById('sendResetEmailBtn');
  const usernameSpan = document.getElementById('username');
  const avatarInput = document.getElementById('avatarInput');
  const profileAvatarPreview = document.getElementById('profileAvatarPreview');
  const headerAvatar = document.getElementById('headerAvatar');
  const dropdownAvatar = document.getElementById('dropdownAvatar');

  const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,12}$/;
  let emailVisible = false;

  async function apiPost(url, body = {}) {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }

  function setAvatar(url) {
    if (profileAvatarPreview) profileAvatarPreview.src = url;
    if (headerAvatar) { headerAvatar.src = url; headerAvatar.style.display = 'inline-block'; }
    if (dropdownAvatar) { dropdownAvatar.src = url; dropdownAvatar.style.display = 'inline-block'; }
  }

  function maskEmail(email) {
    if (!email) return '';
    const [name, domain] = email.split('@');
    if (name.length <= 2) return email;
    return `${name.slice(0, 2)}****@${domain}`;
  }

  auth.onAuthStateChanged((user) => {
    if (!user) {
      window.location.href = '/login';
      return;
    }
    const displayName = user.displayName || '(no username)';
    const memberSince = user.metadata.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString() : '';
    statusText.textContent = `Member since: ${memberSince}`;
    usernameSpan.textContent = displayName;
    usernameInput.value = displayName;
    setAvatar(`/avatar/${encodeURIComponent(user.uid)}?v=${Date.now()}`);
    emailElem.textContent = maskEmail(user.email);
    logoutBtn.style.display = 'inline-block';
    deleteBtn.style.display = 'inline-block';

    const hasPasswordProvider = user.providerData.some((provider) => provider.providerId === 'password');
    const passwordCard = document.querySelector('.password-card');
    if (passwordCard) passwordCard.style.display = hasPasswordProvider ? 'flex' : 'none';
  });

  toggleEmailBtn.addEventListener('click', () => {
    const user = auth.currentUser;
    if (!user) return;
    emailVisible = !emailVisible;
    emailElem.textContent = emailVisible ? user.email : maskEmail(user.email);
    toggleEmailBtn.textContent = emailVisible ? 'Hide' : 'Show';
  });

  sendResetEmailBtn.addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user || !user.email) return showErrorAlert('No email found. Please re-login.');
    try {
      await auth.sendPasswordResetEmail(user.email);
      showSuccessAlert('Password reset email sent to: ' + user.email);
    } catch (error) {
      showErrorAlert('Error sending reset email: ' + error.message);
    }
  });

  logoutBtn.addEventListener('click', () => {
    auth.signOut().then(() => location.reload());
  });

  deleteBtn.addEventListener('click', async () => {
    if (!auth.currentUser || !confirm('Permanently delete your account?')) return;
    try {
      const { ok, data } = await apiPost('/api/deleteUser');
      if (!ok) {
        if (data.code === 'requires-recent-login') {
          showErrorAlert('For security reasons please log in again, then delete your account.');
          setTimeout(() => auth.signOut().then(() => { window.location.href = '/login'; }), 2500);
          return;
        }
        return showErrorAlert(data.message || 'Error deleting account');
      }
      await auth.signOut();
      window.location.href = '/login';
    } catch (err) {
      showErrorAlert('Error deleting account: ' + err.message);
    }
  });

  saveNameBtn.addEventListener('click', async () => {
    const user = auth.currentUser;
    const newName = usernameInput.value.trim();
    if (!user) return showErrorAlert('User not authenticated');
    if (!newName) return showErrorAlert('Please enter a name');
    if (newName === user.displayName) return showErrorAlert('That is already your username');
    if (!USERNAME_PATTERN.test(newName)) {
      return showErrorAlert('Username must be 3-12 characters (letters, numbers, underscore)');
    }

    try {
      const { ok, data } = await apiPost('/api/updateUser', { newUsername: newName });
      if (!ok) return showErrorAlert(data.message || 'Error updating user');
      await user.updateProfile({ displayName: newName });
      usernameSpan.textContent = newName;
      const dropdownEmail = document.getElementById('dropdownEmail');
      if (dropdownEmail) dropdownEmail.textContent = newName;
      showSuccessAlert('Username updated successfully');
    } catch (err) {
      showErrorAlert('Error updating: ' + err.message);
    }
  });

  function showNotification(msg, className) {
    document.querySelectorAll('.error-notification, .custom-notification').forEach((n) => n.remove());
    const div = document.createElement('div');
    div.className = className;
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => {
      div.classList.add('fade-out');
      setTimeout(() => div.remove(), 300);
    }, 3000);
  }

  function showErrorAlert(msg) {
    showNotification(msg, 'error-notification');
  }

  function showSuccessAlert(msg) {
    showNotification(msg, 'custom-notification');
  }

  let cropper = null;
  const cropModal = document.getElementById('cropModal');
  const cropImage = document.getElementById('cropImage');
  const cropConfirmBtn = document.getElementById('cropConfirmBtn');
  const cropCancelBtn = document.getElementById('cropCancelBtn');
  const cropResetBtn = document.getElementById('cropResetBtn');
  const zoomRange = document.getElementById('zoomRange');

  function closeCropper() {
    cropModal.style.display = 'none';
    if (cropper) { cropper.destroy(); cropper = null; }
    zoomRange.value = 1;
    avatarInput.value = '';
  }

  if (profileAvatarPreview) {
    profileAvatarPreview.style.cursor = 'pointer';
    profileAvatarPreview.addEventListener('click', () => avatarInput.click());
  }

  avatarInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return showErrorAlert('Please select a PNG or JPEG image');
    if (file.size > 15 * 1024 * 1024) return showErrorAlert('Image is too large (max. 15 MB)');

    const reader = new FileReader();
    reader.onload = (ev) => {
      cropImage.src = ev.target.result;
      cropModal.style.display = 'flex';
      if (cropper) cropper.destroy();
      cropper = new Cropper(cropImage, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 1,
        movable: true,
        zoomable: true,
        rotatable: true,
        scalable: false,
        cropBoxMovable: false,
        cropBoxResizable: false,
        background: false,
        guides: false,
        highlight: false
      });
      zoomRange.value = 1;
    };
    reader.readAsDataURL(file);
  });

  zoomRange.addEventListener('input', () => {
    if (cropper) cropper.zoomTo(parseFloat(zoomRange.value));
  });

  cropResetBtn.addEventListener('click', () => {
    if (cropper) cropper.reset();
    zoomRange.value = 1;
  });

  cropConfirmBtn.addEventListener('click', async () => {
    if (!cropper) return;
    const dataUrl = cropper.getCroppedCanvas({ width: 400, height: 400, imageSmoothingQuality: 'high' }).toDataURL('image/png');
    closeCropper();
    if (profileAvatarPreview) profileAvatarPreview.src = dataUrl;

    try {
      const { ok, data } = await apiPost('/api/uploadProfilePic', { image: dataUrl });
      if (!ok) return showErrorAlert(data.error || 'Upload failed');
      setAvatar(`${data.url}?v=${Date.now()}`);
      showSuccessAlert('Profile picture updated');
    } catch (err) {
      showErrorAlert('Upload failed: ' + err.message);
    }
  });

  cropCancelBtn.addEventListener('click', closeCropper);

  const style = document.createElement('style');
  style.textContent = `
    .error-notification, .custom-notification {
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 16px 28px;
      border-radius: 8px;
      color: white;
      font-size: 1.1em;
      z-index: 100000;
      animation: slideIn 0.3s ease-out;
      background: #ff4444;
      border-left: 6px solid #cc0000;
    }
    .custom-notification {
      background: #00cc00;
      border-left: 6px solid #008800;
    }
    .fade-out {
      animation: fadeOut 0.3s ease-out forwards;
    }
    @keyframes slideIn {
      from { transform: translateY(100px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes fadeOut {
      to { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
});
