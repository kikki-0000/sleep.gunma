// App.js

const API_BASE_URL = 'http://127.0.0.1:5000/api'; // FlaskバックエンドのURL

const todaySleep = document.querySelector('.sleep-time');
const moreInfoButton = document.getElementById('more-info');
const alarmList = document.getElementById('alarm-list');
const setAlarmButton = document.getElementById('set-alarm');
const alarmModal = document.getElementById('alarm-modal');
const sleepHistoryModal = document.getElementById('sleep-history-modal');
const closeModalButtons = document.querySelectorAll('.close');
const saveAlarmButton = document.getElementById('save-alarm');
const hourInput = document.getElementById('hour');
const minuteInput = document.getElementById('minute');

// 新しく追加した認証ボタン
const fitbitAuthButton = document.getElementById('fitbit-auth-button');
const googleAuthButton = document.getElementById('google-auth-button');
const syncCalendarButton = document.getElementById('sync-calendar-button');


// サウンド用チェックボックスをまとめて取得
let nonremCheckboxes, remCheckboxes;

let alarms = []; // ローカルの状態管理（Firestoreと同期）

/** ── モーダルを開く ── */
function openAlarmModal() {
    // 前回の選択をクリア
    nonremCheckboxes.forEach(cb => cb.checked = false);
    remCheckboxes.forEach(cb => cb.checked = false);

    // 時刻の初期値：現在時刻
    const now = new Date();
    hourInput.value = String(now.getHours()).padStart(2, '0');
    minuteInput.value = String(now.getMinutes()).padStart(2, '0');

    alarmModal.style.display = 'block';
}
function closeModal(modal) {
    modal.style.display = 'none';
}
function openModal(modal) {
    modal.style.display = 'block';
    // 睡眠履歴モーダルが開かれた時にグラフを再描画
    if (modal.id === 'sleep-history-modal') {
        fetchAndRenderSleepCharts();
    }
}

/** ── アラーム保存 (API連携) ── */
async function saveAlarm() {
    // 上限チェックはバックエンドで行うこともできるが、フロントエンドでも警告
    if (alarms.length >= 6) {
        alert("アラームは最大6件まで設定できます。");
        return;
    }

    const hour = parseInt(hourInput.value, 10);
    const minute = parseInt(minuteInput.value, 10);

    // 時刻の数値チェック
    if (
        !Number.isInteger(hour) || !Number.isInteger(minute) ||
        hour < 0 || hour > 23 ||
        minute < 0 || minute > 59
    ) {
        alert("有効な時間を入力してください。");
        return;
    }

    // サウンド選択を取得 (data-sound-idを使用)
    const selectedNonremElement = Array.from(nonremCheckboxes).find(cb => cb.checked);
    const selectedRemElement = Array.from(remCheckboxes).find(cb => cb.checked);

    const soundNonrem = selectedNonremElement ? selectedNonremElement.dataset.soundId : null;
    const soundRem = selectedRemElement ? selectedRemElement.dataset.soundId : null;

    // ノンレム・レムそれぞれ必須
    if (!soundNonrem || !soundRem) {
        alert("ノンレムとレム、それぞれ1つずつ選択してください。");
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/alarm/set`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // 必要であれば認証トークンなどを追加
            },
            body: JSON.stringify({
                hour,
                minute,
                is_on: true, // 新規作成時は常にオン
                sound_nonrem: soundNonrem,
                sound_rem: soundRem
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'アラーム設定に失敗しました。');
        }

        const result = await response.json();
        alert(result.message);

        // アラームリストを再取得して表示を更新
        await fetchAlarms();
        closeModal(alarmModal);
        hourInput.value = "";
        minuteInput.value = "";

    } catch (error) {
        console.error("アラーム設定エラー:", error);
        alert(`アラーム設定に失敗しました: ${error.message}`);
    }
}

/** ── アラーム一覧描画 (Firestoreから取得したデータを使用) ── */
function renderAlarms() {
    alarmList.innerHTML = ''; // 一旦クリア

    if (alarms.length === 0) {
        alarmList.innerHTML = '<p>アラームはまだ設定されていません。</p>';
        return;
    }

    alarms.forEach(alarm => {
        const div = document.createElement('div');
        div.classList.add('alarm-item');

        // サウンドのIDからラベルを取得（例: 'A (ノンレム)' の 'A'）
        const nonremSoundName = alarm.sound_nonrem;
        const remSoundName = alarm.sound_rem;

        div.innerHTML = `
            <div>
                <span class="alarm-time">
                ${String(alarm.hour).padStart(2, '0')}
                :
                ${String(alarm.minute).padStart(2, '0')}
                </span>
                <small>サウンド: ${nonremSoundName} (ノンレム) / ${remSoundName} (レム)</small>
            </div>
            <button class="alarm-toggle" data-id="${alarm.id}">
                ${alarm.is_on ? 'オン' : 'オフ'}
            </button>
            <button class="delete-alarm" data-id="${alarm.id}">
                削除
            </button>
        `;
        alarmList.appendChild(div);
        div.querySelector('.alarm-toggle')
            .addEventListener('click', toggleAlarm);
        div.querySelector('.delete-alarm')
            .addEventListener('click', deleteAlarm);
    });
}

/** ── アラームリストの取得 (API連携) ── */
async function fetchAlarms() {
    try {
        const response = await fetch(`${API_BASE_URL}/alarms`);
        if (!response.ok) {
            throw new Error('アラームリストの取得に失敗しました。');
        }
        const data = await response.json();
        alarms = data.alarms; // 取得したアラームでローカルの状態を更新
        renderAlarms(); // アラームを再描画
    } catch (error) {
        console.error("アラームリスト取得エラー:", error);
        alert(`アラームリストの取得に失敗しました: ${error.message}`);
        alarmList.innerHTML = '<p>アラームの読み込み中にエラーが発生しました。</p>';
    }
}

/** ── アラームトグル (API連携) ── */
async function toggleAlarm(e) {
    const alarmId = e.target.dataset.id;
    try {
        const response = await fetch(`${API_BASE_URL}/alarm/${alarmId}/toggle`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'アラーム状態の更新に失敗しました。');
        }

        const result = await response.json();
        alert(`アラームが ${result.is_on ? 'オン' : 'オフ'} になりました。`);
        await fetchAlarms(); // 状態更新後に再描画
    } catch (error) {
        console.error("アラームトグルエラー:", error);
        alert(`アラームの状態更新に失敗しました: ${error.message}`);
    }
}

/** ── アラーム削除 (API連携) ── */
async function deleteAlarm(e) {
    const alarmId = e.target.dataset.id;
    if (!confirm('本当にこのアラームを削除しますか？')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/alarm/${alarmId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'アラームの削除に失敗しました。');
        }

        const result = await response.json();
        alert(result.message);
        await fetchAlarms(); // 状態更新後に再描画
    } catch (error) {
        console.error("アラーム削除エラー:", error);
        alert(`アラームの削除に失敗しました: ${error.message}`);
    }
}

/** ── 今日の睡眠時間取得 (API連携) ── */
async function fetchTodaySleep() {
    try {
        const response = await fetch(`${API_BASE_URL}/sleep/today`);
        if (!response.ok) {
            const errorData = await response.json();
            // Fitbit未認証の場合、ユーザーに認証を促す
            if (errorData.error_code === 401) {
                todaySleep.textContent = "Fitbit未連携";
                // alert("Fitbitアカウントが連携されていません。Fitbit連携ボタンから認証してください。");
                return;
            }
            throw new Error(errorData.message || '今日の睡眠時間の取得に失敗しました。');
        }
        const data = await response.json();
        todaySleep.textContent = data.today_sleep; // 取得した時間を表示
    } catch (error) {
        console.error("今日の睡眠時間取得エラー:", error);
        todaySleep.textContent = "取得失敗";
        alert(`今日の睡眠時間の取得に失敗しました: ${error.message}`);
    }
}

/** ── 睡眠グラフ描画 (API連携) ── */
let weeklySleepChart = null;
let monthlySleepChart = null;

async function fetchAndRenderSleepCharts() {
    try {
        const response = await fetch(`${API_BASE_URL}/sleep/history`);
        if (!response.ok) {
            const errorData = await response.json();
            if (errorData.error_code === 401) {
                alert("Fitbitアカウントが連携されていません。Fitbit連携ボタンから認証してください。");
                return;
            }
            throw new Error(errorData.message || '睡眠履歴の取得に失敗しました。');
        }
        const data = await response.json();

        const weeklyData = {
            labels: data.weekly_sleep.labels,
            datasets: [{
                label: '睡眠時間(h)',
                data: data.weekly_sleep.data,
                borderColor: '#007bff',
                fill: false
            }]
        };

        const monthlyData = {
            labels: data.monthly_sleep.labels,
            datasets: [{
                label: '睡眠時間(h)',
                data: data.monthly_sleep.data,
                borderColor: '#007bff',
                fill: false
            }]
        };

        const weeklyCtx = document.getElementById('weekly-sleep-chart').getContext('2d');
        const monthlyCtx = document.getElementById('monthly-sleep-chart').getContext('2d');

        // 既存のチャートがあれば破棄して再描画
        if (weeklySleepChart) weeklySleepChart.destroy();
        if (monthlySleepChart) monthlySleepChart.destroy();

        weeklySleepChart = new Chart(weeklyCtx, { type: 'line', data: weeklyData, options: { responsive: true, scales: { y: { beginAtZero: true } } } });
        monthlySleepChart = new Chart(monthlyCtx, { type: 'line', data: monthlyData, options: { responsive: true, scales: { y: { beginAtZero: true } } } });

    } catch (error) {
        console.error("睡眠履歴取得エラー:", error);
        alert(`睡眠履歴の取得に失敗しました: ${error.message}`);
    }
}

/** ── Fitbit認証 ── */
function authenticateFitbit() {
    // 新しいウィンドウでFitbit認証ページを開く
    window.open(`${API_BASE_URL}/fitbit/auth`, '_blank', 'width=600,height=700');
}

/** ── Google認証 ── */
function authenticateGoogle() {
    // 新しいウィンドウでGoogle認証ページを開く
    window.open(`${API_BASE_URL}/google/auth`, '_blank', 'width=600,height=700');
}

/** ── Googleカレンダー同期 ── */
async function syncSleepToGoogleCalendar() {
    if (!confirm('今日の睡眠時間をGoogleカレンダーに同期しますか？')) {
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/google_calendar/sync_sleep`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Googleカレンダーへの同期に失敗しました。');
        }

        const result = await response.json();
        alert(result.message);
    } catch (error) {
        console.error("Googleカレンダー同期エラー:", error);
        alert(`Googleカレンダーへの同期に失敗しました: ${error.message}`);
    }
}


/** ── 初期化 ── */
function init() {
    // チェックボックス取得
    nonremCheckboxes = document.querySelectorAll('input[id$="nonrem"]');
    remCheckboxes = document.querySelectorAll('input[id$="-rem"]');

    // 各グループで一つだけチェック許可
    nonremCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) nonremCheckboxes.forEach(o => o !== cb && (o.checked = false));
        });
    });
    remCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) remCheckboxes.forEach(o => o !== cb && (o.checked = false));
        });
    });

    // ボタン＆モーダル設定
    moreInfoButton.addEventListener('click', () => openModal(sleepHistoryModal));
    setAlarmButton.addEventListener('click', openAlarmModal);
    closeModalButtons.forEach(btn =>
        btn.addEventListener('click', () => closeModal(btn.closest('.modal')))
    );
    saveAlarmButton.addEventListener('click', saveAlarm);

    // 新しい認証ボタンにイベントリスナーを追加
    fitbitAuthButton.addEventListener('click', authenticateFitbit);
    googleAuthButton.addEventListener('click', authenticateGoogle);
    syncCalendarButton.addEventListener('click', syncSleepToGoogleCalendar);

    // アプリ起動時に今日の睡眠時間とアラームリスト、睡眠履歴グラフをロード
    fetchTodaySleep();
    fetchAlarms();
    // fetchAndRenderSleepChartsはopenModal経由で呼び出す
}

init();
