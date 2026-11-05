// Profile pictures: links carry a version (?v=) that changes with every upload, so the browser can keep
// them cached for good. When someone uploads a new picture, every <img> bound to that uid is swapped live
// (server push on pages with a game socket, BroadcastChannel between tabs of the same browser).
(function () {
  const DEFAULT_AVATAR = '/assets/images/icon.png';
  const OWN_KEY = 'ownAvatar';
  const versions = new Map();

  let channel = null;
  try {
    channel = new BroadcastChannel('avatars');
  } catch {
    channel = null;
  }

  // versions only ever go up, an older payload must not bring back an old picture
  function remember(uid, v) {
    const version = Number(v);
    if (!uid || !Number.isFinite(version) || version < 0) return;
    if (!(versions.get(uid) >= version)) versions.set(uid, version);
  }

  function url(uid, v) {
    if (!uid) return DEFAULT_AVATAR;
    remember(uid, v);
    const known = versions.get(uid);
    // without a known version the link is revalidated on every load, so it can't show a stale picture
    return `/avatar/${encodeURIComponent(uid)}${known === undefined ? '' : `?v=${known}`}`;
  }

  function bind(img, uid, v) {
    if (!img) return img;
    if (uid) img.dataset.avatarUid = uid;
    else delete img.dataset.avatarUid;
    img.src = url(uid, v);
    return img;
  }

  function loadOwn() {
    try {
      const own = JSON.parse(localStorage.getItem(OWN_KEY));
      return own && typeof own.uid === 'string' ? own : null;
    } catch {
      return null;
    }
  }

  function saveOwn(uid) {
    try {
      localStorage.setItem(OWN_KEY, JSON.stringify({ uid, v: versions.get(uid) ?? 0 }));
    } catch {
      // storage blocked (private mode): the header just loads the picture a bit later
    }
  }

  function update(uid, v, { broadcast = false } = {}) {
    if (!uid) return;
    const before = versions.get(uid);
    remember(uid, v);
    const now = versions.get(uid);
    if (now === before) return;
    if (loadOwn()?.uid === uid) saveOwn(uid);
    const src = url(uid);
    document.querySelectorAll(`img[data-avatar-uid="${CSS.escape(uid)}"]`).forEach((img) => {
      if (img.getAttribute('src') !== src) img.src = src;
    });
    if (broadcast) channel?.postMessage({ uid, v: now });
  }

  channel?.addEventListener('message', (event) => update(event.data?.uid, event.data?.v));

  // the signed-in user's own picture: known before the login state is, so the header shows it from cache
  const own = loadOwn();
  if (own) remember(own.uid, own.v);

  window.Avatars = {
    DEFAULT_AVATAR,
    url,
    bind,
    update,
    known: (uid) => versions.has(uid),
    setOwn(uid, v) {
      update(uid, v);
      saveOwn(uid);
    },
    listen(socket) {
      socket.on('avatarUpdated', (data) => update(data?.uid, data?.v));
    }
  };
})();
