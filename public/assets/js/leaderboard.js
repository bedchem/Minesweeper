document.addEventListener('DOMContentLoaded', function () {
    const modeButtons = document.querySelectorAll('.mode-btn');
    const timeRangeSelect = document.getElementById('timeRange');
    const leaderboardContainer = document.getElementById('leaderboardContainer');

    let currentMode = 'multiplayer';
    let currentTimeRange = 'all';

    function message(className, text) {
        const div = document.createElement('div');
        div.className = className;
        div.textContent = text;
        leaderboardContainer.replaceChildren(div);
    }

    function cell(className, ...content) {
        const div = document.createElement('div');
        div.className = `leaderboard-cell ${className}`;
        div.append(...content);
        return div;
    }

    async function fetchAndRenderLeaderboard() {
        message('leaderboard-loading', 'Loading Leaderboard...');
        try {
            const params = new URLSearchParams({ type: currentMode, timeRange: currentTimeRange });
            const response = await fetch(`/api/getLeaderboard?${params}`);
            if (!response.ok) throw new Error('Failed to fetch leaderboard data');
            renderLeaderboard(await response.json());
        } catch (error) {
            console.error('Leaderboard error:', error);
            message('leaderboard-empty', 'Could not load leaderboard.');
        }
    }

    function renderLeaderboard(data) {
        if (!data || data.length === 0) {
            message('leaderboard-empty', 'No players on the leaderboard for this filter.');
            return;
        }

        const table = document.createElement('div');
        table.className = 'leaderboard-table';
        const header = document.createElement('div');
        header.className = 'leaderboard-header';
        header.append(
            cell('rank', '#'),
            cell('username', 'Player'),
            cell('value', currentMode === 'multiplayer' ? 'Wins' : 'Best Time')
        );
        table.append(header);

        for (const player of data) {
            const avatar = document.createElement('img');
            avatar.className = 'leaderboard-avatar';
            avatar.alt = 'avatar';
            avatar.src = player.uid ? `/avatar/${encodeURIComponent(player.uid)}` : '/assets/images/icon.png';

            const row = document.createElement('a');
            row.className = 'leaderboard-row';
            row.href = `/stats/${encodeURIComponent(player.username)}`;
            row.append(
                cell('rank', String(player.rank)),
                cell('username', avatar, player.username),
                cell('value', currentMode === 'multiplayer' ? String(player.value) : `${player.value}s`)
            );
            table.append(row);
        }
        leaderboardContainer.replaceChildren(table);
    }

    modeButtons.forEach(button => {
        button.addEventListener('click', () => {
            modeButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            currentMode = button.dataset.mode;
            fetchAndRenderLeaderboard();
        });
    });

    timeRangeSelect.addEventListener('change', () => {
        currentTimeRange = timeRangeSelect.value;
        fetchAndRenderLeaderboard();
    });

    fetchAndRenderLeaderboard();
});
