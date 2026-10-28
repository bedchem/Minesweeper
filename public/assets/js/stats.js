document.addEventListener('DOMContentLoaded', function () {
    const pathSegments = window.location.pathname.split('/');
    const profileUsername = pathSegments.length >= 3 && pathSegments[1] === 'stats' && pathSegments[2]
        ? decodeURIComponent(pathSegments[2])
        : null;

    document.getElementById('landingPage').style.display = profileUsername ? 'none' : 'flex';
    document.getElementById('statsView').style.display = profileUsername ? 'block' : 'none';

    async function fetchGlobalStats() {
        try {
            const response = await fetch('/api/getGlobalStats');
            if (!response.ok) return;
            const stats = await response.json();
            document.getElementById('globalPlayers').textContent = `${stats.totalPlayers} registered Players`;
            document.getElementById('globalGames').textContent = `${stats.totalGamesPlayed} Games Played`;
            document.getElementById('globalAvgTime').textContent = `${stats.averageTime}s Average Time`;
        } catch (error) {
            console.error('Error fetching global stats:', error);
        }
    }

    async function fetchUserStats(username) {
        const timeRangeSelect = document.getElementById('timeRange');
        const timeRange = timeRangeSelect.value;
        const timeFilterDisplay = document.getElementById('timeFilterDisplay');
        timeFilterDisplay.textContent = timeRange !== 'all'
            ? `(${timeRangeSelect.options[timeRangeSelect.selectedIndex].text})`
            : '';

        try {
            const response = await fetch(`/api/getStats/${encodeURIComponent(username)}?timeRange=${encodeURIComponent(timeRange)}`);
            if (!response.ok) {
                window.location.href = '/namenotfound';
                return;
            }
            populateStats(await response.json());
        } catch (error) {
            console.error('Error fetching stats:', error);
            showErrorAlert('User stats not found');
            window.location.href = '/namenotfound';
        }
    }

    function populateStats(stats) {
        document.getElementById('profileUsername').textContent = stats.username || profileUsername;
        document.getElementById('profileAvatar').src = stats.uid
            ? `/avatar/${encodeURIComponent(stats.uid)}`
            : '/assets/images/icon.png';

        const fill = (sectionId, data, keys) => {
            document.querySelectorAll(`#${sectionId} .info-value`).forEach((el, index) => {
                el.textContent = data?.[keys[index]] ?? 'N/A';
            });
        };
        fill('multiplayer-stats', stats.multiplayer, ['leaderboardPosition', 'winRate', 'currentWinStreak', 'bestWinStreak', 'averageTime', 'gamesPlayed', 'wins', 'losses']);
        fill('singleplayer-stats', stats.singleplayer, ['leaderboardPosition', 'fastestTime', 'averageTime', 'gamesPlayed', 'completedGames', 'failedGames', 'minesHit']);
        fill('combined-stats', stats.combined, ['overallWinRate', 'bestTimeAnyMode', 'averageTime', 'totalGamesPlayed', 'totalWins', 'totalMinesHit', 'daysPlayed']);
    }

    if (profileUsername) {
        document.getElementById('profileUsername').textContent = profileUsername;
        fetchUserStats(profileUsername);
    } else {
        fetchGlobalStats();
    }

    const modeButtons = document.querySelectorAll('.mode-btn');
    const timeRangeSelect = document.getElementById('timeRange');
    const statsSections = {
        'multiplayer': document.getElementById('multiplayer-stats'),
        'singleplayer': document.getElementById('singleplayer-stats'),
        'combined': document.getElementById('combined-stats')
    };

    function initStatsView() {
        setActiveMode('multiplayer');
    }

    function setActiveMode(mode) {
        modeButtons.forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.mode === mode) {
                btn.classList.add('active');
            }
        });
        Object.values(statsSections).forEach(section => section.style.display = 'none');
        if (statsSections[mode]) {
            statsSections[mode].style.display = 'block';
        }
    }

    modeButtons.forEach(button => {
        button.addEventListener('click', () => {
            setActiveMode(button.dataset.mode);
        });
    });

    timeRangeSelect.addEventListener('change', function () {
        if (profileUsername) {
            fetchUserStats(profileUsername);
        }
    });

    initStatsView();

    function showErrorAlert(msg) {
        showAlert(msg, 'error-notification');
    }

    function showAlert(msg, type) {
        const existing = document.querySelector(`.${type}`);
        if (existing) existing.remove();

        const div = document.createElement('div');
        div.className = `${type} animate-in`;
        div.textContent = msg;
        document.body.appendChild(div);

        setTimeout(() => {
            div.classList.replace('animate-in', 'animate-out');
            setTimeout(() => div.remove(), 300);
        }, 3000);
    }

    const searchWrapper = document.querySelector('.search-wrapper');
    const searchContainer = document.querySelector('.search-container');
    const searchBar = document.querySelector('.search-bar');
    const searchInput = document.querySelector('.search-input');
    const searchBtn = document.querySelector('.search-btn');
    const searchOverlay = document.querySelector('.search-overlay');

    const autocompleteList = document.createElement('ul');
    autocompleteList.className = 'autocomplete-list';
    searchContainer.appendChild(autocompleteList);

    let allUsernames = [];
    let selectedSuggestionIndex = -1;

    async function fetchUsernames() {
        if (allUsernames.length > 0) return; 
        try {
            const res = await fetch('/api/getAllUsernames');
            if (!res.ok) throw new Error('Failed to fetch usernames');
            allUsernames = await res.json(); 
        } catch (err) {
            console.error('Error fetching usernames for autocomplete:', err);
        }
    }

    function filterSuggestions(query) {
        if (!query) return [];
        return allUsernames
            .filter(name => name.toLowerCase().startsWith(query.toLowerCase()))
            .slice(0, 10); 
    }

    function clearSuggestions() {
        autocompleteList.innerHTML = '';
        autocompleteList.style.display = 'none';
        selectedSuggestionIndex = -1;
    }

    function showSuggestions(suggestions) {
        autocompleteList.innerHTML = '';
        if (suggestions.length === 0) {
            clearSuggestions();
            return;
        }

        suggestions.forEach((suggestion, index) => {
            const li = document.createElement('li');
            li.textContent = suggestion;
            li.tabIndex = 0;

            li.addEventListener('click', () => {
                searchInput.value = suggestion;
                clearSuggestions();
                performSearch(suggestion);
            });

            autocompleteList.appendChild(li);
        });

        autocompleteList.style.display = 'block';
    }

    function updateActiveSuggestion(items) {
        items.forEach((item, i) => {
            if (i === selectedSuggestionIndex) {
                item.classList.add('active');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    }

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        if (!query) {
            clearSuggestions();
            return;
        }
        const suggestions = filterSuggestions(query);
        showSuggestions(suggestions);
    });

    searchInput.addEventListener('keydown', (e) => {
        const items = autocompleteList.querySelectorAll('li');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedSuggestionIndex = (selectedSuggestionIndex + 1) % items.length;
            updateActiveSuggestion(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedSuggestionIndex = (selectedSuggestionIndex - 1 + items.length) % items.length;
            updateActiveSuggestion(items);
        } else if (e.key === 'Enter') {
            if (selectedSuggestionIndex > -1) {
                e.preventDefault();
                items[selectedSuggestionIndex].click();
            } else if (searchInput.value.trim() !== '') {
                e.preventDefault();
                performSearch(searchInput.value.trim());
                clearSuggestions();
            }
        } else if (e.key === 'Escape') {
            clearSuggestions();
        }
    });

    document.addEventListener('click', (e) => {
        if (!searchWrapper.contains(e.target)) {
            clearSuggestions();
        }
    });

    searchInput.addEventListener('click', () => {
        if (!searchWrapper.classList.contains('expanded')) toggleSearch();
    });
    searchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSearch();
    });
    searchOverlay.addEventListener('click', toggleSearch);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && searchWrapper.classList.contains('expanded')) {
            toggleSearch();
        }
    });
    searchBar.addEventListener('click', (e) => e.stopPropagation());
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && searchInput.value.trim() !== '') {
            e.preventDefault();
            performSearch(searchInput.value.trim());
        }
    });

    async function performSearch(query) {
        try {
            const res = await fetch('/api/checkUsername', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: query })
            });
            if (!res.ok) throw new Error('Server error');
            const data = await res.json();

            if (data.exists) {
                window.location.href = `/stats/${encodeURIComponent(query)}`;
            } else {
                window.location.href = '/namenotfound';
            }
        } catch (err) {
            console.error('Search error:', err);
            showErrorAlert('An error occurred while searching. Please try again.');
        }
        toggleSearch();
    }

    function toggleSearch() {
        searchWrapper.classList.toggle('expanded');

        if (searchWrapper.classList.contains('expanded')) {
            fetchUsernames();
            searchInput.focus();
            searchBtn.innerHTML = '<i class="fas fa-times"></i>';
            searchBtn.classList.add('close-btn');
            document.body.style.overflow = 'hidden';
        } else {
            searchBtn.innerHTML = '<i class="fas fa-search"></i>';
            searchBtn.classList.remove('close-btn');
            searchInput.value = '';
            document.body.style.overflow = '';
            clearSuggestions();
        }
    }

    const style = document.createElement('style');
    style.textContent = `
        /* Search system */
        .search-wrapper {
            position: relative;
            margin-right: 20px;
            z-index: 100;
        }
        .search-container {
            transition: all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1);
        }
        .search-bar {
            display: flex;
            align-items: center;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 30px;
            padding: 8px 15px;
            transition: all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            will-change: transform, opacity;
            position: relative;
            z-index: 101;
        }
        .search-input {
            background: transparent;
            border: none;
            color: white;
            width: 180px;
            padding: 5px 10px;
            outline: none;
            font-size: 14px;
            transition: all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1);
        }
        .search-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            z-index: 99;
            opacity: 0;
            visibility: hidden;
            transition: all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1);
            backdrop-filter: blur(5px);
            will-change: opacity;
        }
        /* Expanded state */
        .search-wrapper.expanded .search-container {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 1000;
            width: min(90%, 600px);
        }
        .search-wrapper.expanded .search-bar {
            padding: 20px 25px;
            background: rgba(30, 30, 30, 0.98);
            box-shadow: 0 15px 30px rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .search-wrapper.expanded .search-input {
            width: 100%;
            font-size: 1.25rem;
        }
        .search-wrapper.expanded .search-overlay {
            opacity: 1;
            visibility: visible;
        }
        .autocomplete-list {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: #1e1e1e;
            border: 1px solid rgba(255, 255, 255, 0.2);
            max-height: 200px;
            overflow-y: auto;
            border-radius: 0 0 10px 10px;
            z-index: 1100;
            list-style: none;
            margin: 0;
            padding: 0;
            color: white;
            font-size: 1rem;
            display: none;
        }
        .autocomplete-list li {
            padding: 10px 15px;
            cursor: pointer;
            transition: background 0.2s;
        }
        .autocomplete-list li:hover,
        .autocomplete-list li.active {
            background: #333;
        }

        /* Notifications */
        .error-notification, .custom-notification {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 25px;
            border-radius: 8px;
            font-weight: bold;
            z-index: 1500;
            color: white;
            user-select: none;
            opacity: 0;
            animation-fill-mode: forwards;
        }
        .error-notification {
            background-color: #e74c3c;
        }
        .custom-notification {
            background-color: #3498db;
        }
        .animate-in {
            animation: fadeIn 0.3s forwards;
        }
        .animate-out {
            animation: fadeOut 0.3s forwards;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeOut {
            from { opacity: 1; transform: translateY(0); }
            to { opacity: 0; transform: translateY(-10px); }
        }
    `;
    document.head.appendChild(style);
});
