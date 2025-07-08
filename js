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
}

/** ── アラーム保存 ── */
async function saveAlarm() {
    // 上限チェック
    if (alarms.length >= 6) {
        alert("設定できるアラームは最大6件までです。");
        return;
    }

    const hour = parseInt(hourInput.value);
    const minute = parseInt(minuteInput.value);

    if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        alert("有効な時刻を入力してください。");
        return;
    }

    const selectedNonrem = Array.from(nonremCheckboxes).find(cb => cb.checked);
    const selectedRem = Array.from(remCheckboxes).find(cb => cb.checked);

    if (!selectedNonrem || !selectedRem) {
        alert("ノンレム睡眠用とレム睡眠用のサウンドをそれぞれ1つずつ選択してください。");
        return;
    }

    const newAlarm = {
        hour: hour,
        minute: minute,
        is_on: true, // デフォルトでオン
        sound_nonrem: selectedNonrem.dataset.soundId,
        sound_rem: selectedRem.dataset.soundId
    };

    try {
        const response = await fetch(`${API_BASE_URL}/alarm/set`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newAlarm)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'アラーム設定に失敗しました。');
        }

        const result = await response.json();
        alert(result.message);
        closeModal(alarmModal);
        await fetchAlarms(); // アラームリストを再読み込み
    } catch (error) {
        console.error("アラーム設定エラー:", error);
        alert(`アラーム設定に失敗しました: ${error.message}`);
    }
}


/** ── アラームリスト表示 ── */
function renderAlarms() {
    alarmList.innerHTML = ''; // リストをクリア

    if (alarms.length === 0) {
        alarmList.innerHTML = '<p>アラームはまだ設定されていません。</p>';
        return;
    }

    alarms.sort((a, b) => {
        const timeA = a.hour * 60 + a.minute;
        const timeB = b.hour * 60 + b.minute;
        return timeA - timeB;
    });

    alarms.forEach(alarm => {
        const alarmItem = document.createElement('div');
        alarmItem.classList.add('alarm-item');

        const displayHour = String(alarm.hour).padStart(2, '0');
        const displayMinute = String(alarm.minute).padStart(2, '0');

        const soundText = `サウンド: ${alarm.sound_nonrem} (ノンレム) / ${alarm.sound_rem} (レム)`;

        alarmItem.innerHTML = `
            <span class="alarm-time">${displayHour}:${displayMinute}</span>
            <span class="alarm-sounds">${soundText}</span>
            <button class="alarm-toggle" data-id="${alarm.id}">${alarm.is_on ? 'オン' : 'オフ'}</button>
            <button class="delete-alarm" data-id="${alarm.id}">削除</button>
        `;

        alarmList.appendChild(alarmItem);
    });

    // トグルボタンと削除ボタンにイベントリスナーを再設定
    document.querySelectorAll('.alarm-toggle').forEach(button => {
        button.addEventListener('click', toggleAlarm);
    });
    document.querySelectorAll('.delete-alarm').forEach(button => {
        button.addEventListener('click', deleteAlarm);
    });
}

/** ── アラーム取得 ── */
async function fetchAlarms() {
    try {
        const response = await fetch(`${API_BASE_URL}/alarms`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'アラームリストの取得に失敗しました。');
        }
        const data = await response.json();
        alarms = data.alarms;
        renderAlarms();
    } catch (error) {
        console.error("アラームリスト取得エラー:", error);
        alert(`アラームリストの取得に失敗しました: ${error.message}`);
        alarms = []; // エラー時はアラームをクリア
        renderAlarms(); // エラーメッセージを表示
    }
}

/** ── アラームのオン/オフ切り替え ── */
async function toggleAlarm(event) {
    const alarmId = event.target.dataset.id;
    try {
        const response = await fetch(`${API_BASE_URL}/alarm/${alarmId}/toggle`, {
            method: 'PUT'
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'アラームの状態更新に失敗しました。');
        }
        const result = await response.json();
        alert(result.message);
        await fetchAlarms(); // リストを再読み込み
    } catch (error) {
        console.error("アラームトグルエラー:", error);
        alert(`アラームの状態更新に失敗しました: ${error.message}`);
    }
}

/** ── アラーム削除 ── */
async function deleteAlarm(event) {
    const alarmId = event.target.dataset.id;
    if (!confirm('本当にこのアラームを削除しますか？')) {
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/alarm/${alarmId}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'アラームの削除に失敗しました。');
        }
        const result = await response.json();
        alert(result.message);
        await fetchAlarms(); // リストを再読み込み
    } catch (error) {
        console.error("アラーム削除エラー:", error);
        alert(`アラームの削除に失敗しました: ${error.message}`);
    }
}

/** ── 今日の睡眠時間を取得 ── */
async function fetchTodaySleep() {
    try {
        const response = await fetch(`${API_BASE_URL}/sleep/today`);
        if (!response.ok) {
            const errorData = await response.json();
            // Fitbit連携前であればエラーを表示しない
            if (response.status === 401 && errorData.message === "Fitbitトークンがありません。Fitbitと連携してください。") {
                todaySleep.textContent = "Fitbit未連携";
                return;
            }
            throw new Error(errorData.message || '今日の睡眠時間の取得に失敗しました。');
        }
        const data = await response.json();
        const minutes = data.today_sleep;
        if (typeof minutes === 'number') {
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
            todaySleep.textContent = `${String(hours).padStart(2, '0')}:${String(remainingMinutes).padStart(2, '0')}`;
        } else {
            todaySleep.textContent = "--:--"; // データが数字でない場合
        }
    } catch (error) {
        console.error("今日の睡眠時間取得エラー:", error);
        todaySleep.textContent = "--:--"; // エラー時も表示をリセット
        // alert(`今日の睡眠時間の取得に失敗しました: ${error.message}`); // デバッグ目的で一時的にコメントアウト
    }
}

/** ── 睡眠履歴を取得してグラフ表示 ── */
async function fetchSleepHistory() {
    try {
        const response = await fetch(`${API_BASE_URL}/sleep/history`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || '睡眠履歴の取得に失敗しました。');
        }
        const data = await response.json();
        displaySleepCharts(data.weekly_sleep, data.monthly_sleep);
    } catch (error) {
        console.error("睡眠履歴取得エラー:", error);
        alert(`睡眠履歴の取得に失敗しました: ${error.message}`);
    }
}

/** ── 睡眠履歴グラフ描画 ── */
function displaySleepCharts(weeklyData, monthlyData) {
    const weeklyCtx = document.getElementById('weekly-sleep-chart').getContext('2d');
    const monthlyCtx = document.getElementById('monthly-sleep-chart').getContext('2d');

    // 既存のChartインスタンスがあれば破棄
    if (window.weeklyChart instanceof Chart) {
        window.weeklyChart.destroy();
    }
    if (window.monthlyChart instanceof Chart) {
        window.monthlyChart.destroy();
    }

    // Chart.js データを準備
    const weeklyChartData = {
        labels: weeklyData.labels, // 例: ['Mon', 'Tue', ...]
        datasets: [{
            label: '週間睡眠時間 (分)',
            data: weeklyData.data,
            borderColor: '#007bff',
            backgroundColor: 'rgba(0, 123, 255, 0.2)',
            fill: true
        }]
    };

    const monthlyChartData = {
        labels: monthlyData.labels, // 例: ['Week 1', 'Week 2', ...]
        datasets: [{
            label: '月間睡眠時間 (分)',
            data: monthlyData.data,
            borderColor: '#28a745',
            backgroundColor: 'rgba(40, 167, 69, 0.2)',
            fill: true
        }]
    };

    // 新しいChartインスタンスを作成
    window.weeklyChart = new Chart(weeklyCtx, {
        type: 'bar', // 週次を棒グラフに
        data: weeklyChartData,
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const minutes = context.raw;
                            const hours = Math.floor(minutes / 60);
                            const remainingMinutes = minutes % 60;
                            return `${hours}時間${remainingMinutes}分`;
                        }
                    }
                }
            }
        }
    });

    window.monthlyChart = new Chart(monthlyCtx, {
        type: 'line', // 月次を折れ線グラフに
        data: monthlyChartData,
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const minutes = context.raw;
                            const hours = Math.floor(minutes / 60);
                            const remainingMinutes = minutes % 60;
                            return `${hours}時間${remainingMinutes}分`;
                        }
                    }
                }
            }
        }
    });
}


/** ── Fitbit認証 ── */
async function authenticateFitbit() {
    try {
        const response = await fetch(`${API_BASE_URL}/fitbit/auth`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Fitbit認証開始に失敗しました。');
        }
        const data = await response.json();
        // Flaskから返された認証URLにリダイレクト
        window.location.href = data.auth_url;
    } catch (error) {
        console.error("Fitbit認証エラー:", error);
        alert(`Fitbit認証エラー: ${error.message}`);
    }
}

/** ── Google認証 ── */
async function authenticateGoogle() {
    try {
        const response = await fetch(`${API_BASE_URL}/google/auth`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Google認証開始に失敗しました。');
        }
        const data = await response.json();
        // Flaskから返された認証URLにリダイレクト
        window.location.href = data.auth_url;
    } catch (error) {
        console.error("Google認証エラー:", error);
        alert(`Google認証エラー: ${error.message}`);
    }
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
                'Content-Type': 'application/json'
            }
            // 必要であればbodyに睡眠時間などのデータを追加
            // body: JSON.stringify({ /* data if needed */ })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || 'Googleカレンダー同期に失敗しました。');
        }
        alert(result.message);
    } catch (error) {
        console.error("Googleカレンダー同期エラー:", error);
        alert(`Googleカレンダーへの同期に失敗しました: ${error.message}`);
    }
}


/** ── 初期化 ── */
function init() {
    // 今日睡眠時間の初期表示 (APIから取得するまで)
    todaySleep.textContent = "--:--"; 
    
    // チェックボックス取得
    nonremCheckboxes = document.querySelectorAll('input[id$=\"nonrem\"]');
    remCheckboxes = document.querySelectorAll('input[id$=\"-rem\"]');

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
    moreInfoButton.addEventListener('click', () => {
        openModal(sleepHistoryModal);
        fetchSleepHistory(); // モーダル開くときに履歴取得
    });
    setAlarmButton.addEventListener('click', openAlarmModal);
    closeModalButtons.forEach(btn =>
        btn.addEventListener('click', () => closeModal(btn.closest('.modal')))
    );
    saveAlarmButton.addEventListener('click', saveAlarm);

    // 新しい認証ボタンにイベントリスナーを追加
    fitbitAuthButton.addEventListener('click', authenticateFitbit);
    googleAuthButton.addEventListener('click', authenticateGoogle);
    syncCalendarButton.addEventListener('click', syncSleepToGoogleCalendar);

    // アプリ起動時に今日の睡眠時間とアラームリストを取得
    fetchTodaySleep();
    fetchAlarms();
}

// ページ読み込み完了後にスプラッシュスクリーンを非表示にし、メインコンテンツを表示
document.addEventListener('DOMContentLoaded', () => {
    const splashScreen = document.getElementById('splash-screen');
    const mainContent = document.getElementById('main-content');

    // 1秒後にスプラッシュスクリーンを非表示にし、メインコンテンツを表示
    setTimeout(() => {
        splashScreen.style.display = 'none'; // スプラッシュスクリーンを非表示
        mainContent.classList.remove('hidden'); // メインコンテンツを表示
        
        // メインコンテンツが表示された後にアプリの初期化処理を実行
        init(); 
    }, 1000); // 1000ミリ秒 = 1秒
});
