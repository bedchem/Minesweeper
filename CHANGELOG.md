## Documentation start 15.06.2025 ##

# 15.06.2025
- Rewrote most of the code structure
- ALOT of bug fixes.

# 16.06.2025
- Bugfixes
- i added the Podiums
- also added more logic to win and lose

# 17.06.2025
- Bugfixes
- Added the Intermediate Podium and also Spectator Logic
- changed the win and lose logic again a bit
- started working on the reconnect logic

# 04.07.2025
- FINALLY Finished everything i planed but now are even more bugs
- Bugfixes
- added Solo Modal to see win

# 16.07.2025
- Finally started doing the backend a little bit
- Started Login Forum

# 17.07.2025
- Fixed some Bugs
- added cookies
- multiplayer only for logged in users
- profile dashboard
- userdata saved!
- designed login
- WE DO NOT HAVE ANY 'alert("");' ANYMOOORRE!!!!!!

# 21.07.2025
- Fixed some Bugs
- added reCHAPTCHA
- made stats.html
- made solo.html a little bit better

# 23.07.2025 
- made the backend more reliable by reworking it.
- fixed, by reworking the backend, the username bug with social logins should get saved now. 
- worked on the stats-page and a bit on the stats logic overall

# 28.07.2025
- redone our Hosting Server

# 29.07.2025
- we now use the username from login to play multiplayer instead of an input

# 21.08.2025
- FINISHED BACKEND (STATS SHOULD WORK NOW)
- bugfix with the reconnect Button
- added a Leaderboard Page
- other small fixes

# 22.08.2025
- Worked on Design
- bugfixes
- removed the .html ending
- added 404 page
- saved login

# 23.09.2025
- had to disable difficulties due to a bug.

# 04.10.2025
- User limit is now fixed and there aer min 2 Players, and max 4 Players
- Added profile Pictures

# 06.10.2025
- Maxi feature (like Goolge Minesweeper) Added
- Settings Limit
- Chat (emotes)
- Pictures are now cropped!!!

# 07.10.2025
- fixed solo
- Add profile picture to stats (so everyone can see the profile Picture)
- Added Maxi feature to Multiplayer
- can send pictures per chat (only add url)
- fixed login (and slight rework)

# 09.10.2025
- Small Bug fixes
- fixed Maxi feature on multiplayer
- reworked Flexbox (mobile)

# 20.10.2025
- Fixed some Bugs
- added Admin Panel, to Control everything
- BUG FIX | added logic to handle dead Players in the Reconnect logic, Fixed that you need to be in the correct lobby
 
# 28.10.2026
- BIG SECURITY UPDATE: every account action (delete, rename, profile picture, solo results) now needs a valid login, before anyone could delete or rename any user
- fixed XSS in chat, player list, podium, leaderboard and admin panel
- the mine field isn't sent to the players anymore (no more cheating with devtools)
- reconnect works over the account now and not the socket id, you can't take over someone elses game anymore
- leaving a game counts as a loss now
- fixed server crash when someone joins during the countdown
- fixed the solo win screen not showing up on a new best time
- fixed solo freezing with too many mines
- lobby error messages are finally shown
- solo leaderboard only counts the normal 10x10 board with 15 mines
- admin panel uses real data now (no demo data), with users, lobbies, sessions and an activity log
- reCAPTCHA gets checked on the server (set RECAPTCHA_SECRET_LOGIN / RECAPTCHA_SECRET_REGISTER)
- security headers, rate limits, chat spam protection
- updated everything (express 5.3, socket.io 4.8.4, firebase-admin 14, firebase 13)
- split the server into src/

# TODO

    1. Quality of Life (refresh button [Lobby Browse])
    2. Multiplayer when one died there should be the name red for everyone and when you made 100% there is you won instead of spectate (button below to spctate)
    3. BUG: difficulties doesn't Work
    4. Optimize for Mobile 
    5. Tags (admin)
    6. Add sound
    7. Admin Page (dashboard for admin tags, change stats and have access to everything databank[Verification per E-Mail])
    8. BUG: Bug with Reconnect Time (only CLient who rejoins)
    9. Add that even when the lobby is full people can spectate and chat its like MINECRAFT!!!!!
    10. Add a Live Updating Journey (Changelog.MD) with pictures and so on!!
    11. Add a log file (everything is safed in log.json)
    12. MAKE THE OVERLAY LIKE THE DISCORD OONE (admin)
    13. Bann the whole account (or just chat bann)
