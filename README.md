#  Multiplayer Minesweeper <3
    by Ryhox and Nexor 

A sleek, real-time **Multiplayer Minesweeper** game built for the web — featuring **PvP lobbies**, **persistent stats**, and a competitive edge. Challenge your friends, race against time, and climb the leaderboard!

---

## 🎮 Features

- 🧑‍🤝‍🧑 **up to 4 Player Multiplayer**
  - Live socket-based gameplay (no refresh required)
  - Invite friends with a sharable link or Code.
  - Real-time settings sync

- 🧠 **Fairness**
  - All Player have the same guaranteed safe opening
  - Dynamic mine generation

- 📊 **Stats & Leaderboards**
  - **Multiplayer**: winstreaks, win rate, avg. time, leaderboard rank, Games Played, Wins, Losses
  - **Solo**: fastest time, avg. time, leaderboard rank, games played, Mines Hit, Best Level, Completed Games, Failed Games
  - **Combined**: Total Games Played, Overall Win Rate, Best Time, Average Time, Total Mines Hit, Total Wins, Days Played

- ✍️ **Account System**
  - Firebase auth with **Google**, **Discord**, **GitHub** or **Twitter(X)** or Normal **E-Mail and Password Login**
  - Unique usernames

- 📱 **Responsive UI**
  - Soft design, hover effects and old Minesweeper Themed

---

## 🚀 Try it now

👉 [Play Online](https://minesweeper.plattnericus.dev/)

Or run it locally:

```bash
git clone https://github.com/Ryhox/minesweeper.ryhox.dev.git
cd minesweeper.ryhox.dev
npm install
npm start
```

You need **Node.js 22+** and a Firebase project:

- `.env` with your Firebase Admin credentials: `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` (in double quotes, with `\n` line breaks), from the service account JSON (or a `firebaseServiceAccount.json` in the root folder)
- `.env` with your Firebase web config: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`, `FIREBASE_MEASUREMENT_ID` (or a static `public/assets/js/firebase-auth.js` with `firebase.initializeApp({...})`)
- optional `.env`: `PORT`, `ADMIN_UIDS`, `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY` (reCAPTCHA v2 checkbox, used for login and register; captcha is skipped when empty), `TRUST_PROXY`, `CSP_EXTRA_FRAME_SRC`

Admin: put your uid in `ADMIN_UIDS` or set `"role": "admin"` in your file in `userDATA/`.
