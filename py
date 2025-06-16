# app.py
from flask import Flask, jsonify, request, url_for, session
from flask_cors import CORS
import os
from dotenv import load_dotenv
from datetime import datetime, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
import requests  # 外部API呼び出し用

# Firebase Admin SDKの初期化
import firebase_admin
from firebase_admin import credentials, firestore, db

# Authlib
from authlib.integrations.flask_client import OAuth

load_dotenv()  # .env ファイルから環境変数をロード

app = Flask(__name__)
CORS(app)  # フロントエンドからのCORSリクエストを許可

# 設定（環境変数から取得）
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY')  # セッション管理などに必要
if not app.config['SECRET_KEY']:
    raise ValueError("SECRET_KEY 環境変数が設定されていません。")

# Firebase初期化
service_account_key_path = os.getenv('FIREBASE_SERVICE_ACCOUNT_KEY_PATH')
if not service_account_key_path or not os.path.exists(service_account_key_path):
    raise ValueError(
        "FIREBASE_SERVICE_ACCOUNT_KEY_PATH 環境変数が設定されていないか、ファイルが見つかりません。")

cred = credentials.Certificate(service_account_key_path)
firebase_admin.initialize_app(cred, {
    # Realtime Database URL
    'databaseURL': os.getenv('FIREBASE_DATABASE_URL')
})
firestore_db = firestore.client()

# OAuth設定
oauth = OAuth(app)

# Fitbit OAuth設定
oauth.register(
    name='fitbit',
    client_id=os.getenv('FITBIT_CLIENT_ID'),
    client_secret=os.getenv('FITBIT_CLIENT_SECRET'),
    api_base_url='https://api.fitbit.com/',
    request_token_url=None,
    access_token_url='https://api.fitbit.com/oauth2/token',
    authorize_url='https://www.fitbit.com/oauth2/authorize',
    client_kwargs={'scope': 'sleep profile'}, # 'sleep' と 'profile' スコープが必要
    redirect_uri=os.getenv('FITBIT_REDIRECT_URI')
)

# Google OAuth設定
oauth.register(
    name='google',
    client_id=os.getenv('GOOGLE_CLIENT_ID'),
    client_secret=os.getenv('GOOGLE_CLIENT_SECRET'),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile https://www.googleapis.com/auth/calendar.events'},
    redirect_uri=os.getenv('GOOGLE_REDIRECT_URI')
)

# APSchedulerの初期化 (睡眠段階に応じてアラーム音を調整するスケジューラ)
scheduler = BackgroundScheduler()
# デモのためすぐに開始、本番ではアラーム設定時にジョブを追加・削除
# scheduler.start()

# --- 認証ルート ---

@app.route('/api/fitbit/auth')
def fitbit_auth():
    redirect_uri = url_for('fitbit_authorize', _external=True)
    return oauth.fitbit.authorize_redirect(redirect_uri)

@app.route('/api/fitbit/authorize')
def fitbit_authorize():
    token = oauth.fitbit.authorize_access_token()
    userinfo = oauth.fitbit.parse_id_token(token) # FitbitはIDトークンを提供しない場合が多い
    session['fitbit_token'] = token
    # session['user_id'] = userinfo['user_id'] # FitbitのユーザーID
    # user_idをセッションに保存（またはFirebaseなどに保存）
    # デモ目的で仮のユーザーIDを設定
    session['user_id'] = 'demo_fitbit_user' # 仮のユーザーID
    
    # Firestoreにトークンを保存 (ユーザーIDに関連付けて)
    firestore_db.collection('users').document(session['user_id']).set({
        'fitbit_token': token,
        'last_login': firestore.SERVER_TIMESTAMP
    }, merge=True) # merge=True で既存のフィールドは上書きせず追加・更新

    return jsonify({"message": "Fitbit認証が成功しました！", "token": token})

@app.route('/api/google/auth')
def google_auth():
    redirect_uri = url_for('google_authorize', _external=True)
    return oauth.google.authorize_redirect(redirect_uri)

@app.route('/api/google/authorize')
def google_authorize():
    token = oauth.google.authorize_access_token()
    userinfo = oauth.google.parse_id_token(token) # GoogleはIDトークンを提供
    session['google_token'] = token
    session['user_id'] = userinfo['sub'] # GoogleのユーザーID (subクレーム)

    # Firestoreにトークンを保存 (ユーザーIDに関連付けて)
    firestore_db.collection('users').document(session['user_id']).set({
        'google_token': token,
        'last_login': firestore.SERVER_TIMESTAMP
    }, merge=True)

    return jsonify({"message": "Google認証が成功しました！", "user": userinfo})

# --- 睡眠データ関連 ---

@app.route('/api/sleep/today')
def get_today_sleep():
    user_id = session.get('user_id', 'demo_fitbit_user') # デモユーザーを想定
    user_doc = firestore_db.collection('users').document(user_id).get()
    
    if not user_doc.exists or 'fitbit_token' not in user_doc.to_dict():
        return jsonify({"message": "Fitbitアカウントが連携されていません。", "error_code": 401}), 401

    fitbit_token = user_doc.to_dict()['fitbit_token']
    access_token = fitbit_token.get('access_token')
    
    # Fitbit APIから睡眠データを取得
    today = datetime.now().strftime('%Y-%m-%d')
    headers = {'Authorization': f'Bearer {access_token}'}
    
    # リフレッシュトークンを自動的に使用するロジックが必要だが、ここでは簡略化
    # 実際には oauth.fitbit.fetch_access_token(fitbit_token['refresh_token']) などを使う
    
    try:
        sleep_response = requests.get(f'https://api.fitbit.com/1.2/user/-/sleep/date/{today}.json', headers=headers)
        sleep_response.raise_for_status() # HTTPエラーがあれば例外を発生
        sleep_data = sleep_response.json()

        total_minutes = 0
        if sleep_data and 'sleep' in sleep_data and len(sleep_data['sleep']) > 0:
            for sleep_entry in sleep_data['sleep']:
                total_minutes += sleep_entry.get('duration', 0) / 60000 # ミリ秒から分へ
        
        hours = int(total_minutes // 60)
        minutes = int(total_minutes % 60)
        
        return jsonify({'today_sleep': f'{hours:02}:{minutes:02}'}), 200

    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 401: # トークン切れなど
            return jsonify({"message": "Fitbitトークンが無効または期限切れです。再認証してください。", "error_code": 401}), 401
        print(f"Fitbit APIエラー: {e.response.text}")
        return jsonify({'message': 'Fitbitから睡眠データを取得できませんでした。', 'error': str(e)}), 500
    except Exception as e:
        print(f"今日の睡眠時間取得エラー: {e}")
        return jsonify({'message': 'サーバーエラーが発生しました。', 'error': str(e)}), 500

@app.route('/api/sleep/history')
def get_sleep_history():
    user_id = session.get('user_id', 'demo_fitbit_user') # デモユーザーを想定
    user_doc = firestore_db.collection('users').document(user_id).get()
    
    if not user_doc.exists or 'fitbit_token' not in user_doc.to_dict():
        return jsonify({"message": "Fitbitアカウントが連携されていません。", "error_code": 401}), 401

    fitbit_token = user_doc.to_dict()['fitbit_token']
    access_token = fitbit_token.get('access_token')

    end_date = datetime.now()
    
    # 週間データ (過去7日間)
    weekly_labels = []
    weekly_data = []
    for i in range(7):
        date = end_date - timedelta(days=i)
        weekly_labels.append(date.strftime('%m/%d'))
        # ここでは固定値だが、実際にはFirestoreから取得するかFitbit APIを複数回呼び出す
        weekly_data.append(round(8 + (i % 3) * 0.5, 1)) # 例: 8.0, 8.5, 9.0, 8.0...
    weekly_labels.reverse()
    weekly_data.reverse()

    # 月間データ (過去30日間)
    monthly_labels = []
    monthly_data = []
    for i in range(30):
        date = end_date - timedelta(days=i)
        if i % 5 == 0: # 例: 5日おきに表示
            monthly_labels.append(date.strftime('%m/%d'))
        else:
            monthly_labels.append('') # 空白にして表示を間引く
        monthly_data.append(round(7 + (i % 5) * 0.3, 1)) # 例: 7.0, 7.3, 7.6...
    monthly_labels.reverse()
    monthly_data.reverse()


    # 実際のデータ取得ロジック（Fitbit APIを複数回呼び出すか、Firestoreにキャッシュされた履歴を使う）
    # 例：Fitbit APIから特定の期間の睡眠履歴を取得
    # sleep_history_response = requests.get(f'https://api.fitbit.com/1.2/user/-/sleep/date/{start_date.strftime('%Y-%m-%d')}/{end_date.strftime('%Y-%m-%d')}.json', headers=headers)
    # sleep_history_response.raise_for_status()
    # sleep_history_data = sleep_history_response.json()
    # ...データを処理してグラフ用に整形

    return jsonify({
        'weekly_sleep': {'labels': weekly_labels, 'data': weekly_data},
        'monthly_sleep': {'labels': monthly_labels, 'data': monthly_data}
    }), 200


# --- アラーム関連 ---

# アラーム調整ロジック（仮の関数）
def adjust_alarm_based_on_sleep_stage():
    print("アラーム調整ロジックが実行されました (デモ用)。")
    # 実際にはここでFitbitからリアルタイムの睡眠段階データを取得し、
    # アラーム音を調整する処理を実装
    # 例: 睡眠データ取得 -> 睡眠段階判定 -> アラーム音の変更API呼び出し


@app.route('/api/alarm/set', methods=['POST'])
def set_alarm():
    data = request.json
    if not data:
        return jsonify({'message': 'リクエストボディが空です。', 'error_code': 400}), 400

    hour = data.get('hour')
    minute = data.get('minute')
    is_on = data.get('is_on', True)
    # フロントエンドから送られてくる sound_nonrem と sound_rem を取得
    sound_nonrem = data.get('sound_nonrem')
    sound_rem = data.get('sound_rem')

    # 必須フィールドのバリデーションを強化
    if hour is None or minute is None or sound_nonrem is None or sound_rem is None:
        # どの情報が不足しているかを具体的に伝えるメッセージ
        missing_info = []
        if hour is None: missing_info.append('hour')
        if minute is None: missing_info.append('minute')
        if sound_nonrem is None: missing_info.append('sound_nonrem')
        if sound_rem is None: missing_info.append('sound_rem')
        return jsonify({'message': f'必要な情報が不足しています: {", ".join(missing_info)}', 'error_code': 400}), 400

    try:
        # ユーザーIDの取得 (現在認証がないため固定ユーザーを使用、本番では変更)
        # 認証実装後は session.get('user_id') を使用
        # user_id = session.get('user_id', 'test_user_id') 
        user_id = 'test_user_id' # デモ用固定ユーザーID

        user_ref = firestore_db.collection('users').document(user_id)
        if not user_ref.get().exists:
            user_ref.set({'created_at': firestore.SERVER_TIMESTAMP})

        # 新しいアラームドキュメントを作成
        alarm_ref = user_ref.collection('alarms').document()
        alarm_data = {
            'hour': hour,
            'minute': minute,
            'is_on': is_on,
            'sound_nonrem': sound_nonrem, # ここでFirestoreに保存
            'sound_rem': sound_rem,       # ここでFirestoreに保存
            'created_at': firestore.SERVER_TIMESTAMP
        }
        alarm_ref.set(alarm_data)

        # APSchedulerでアラーム調整ジョブをスケジュール (オプション)
        # scheduler.add_job(
        #     func=adjust_alarm_based_on_sleep_stage,
        #     trigger='date',
        #     run_date=datetime(2025, 6, 2, hour, minute, 0) # 例: 2025年6月2日の指定時刻
        # )

        return jsonify({'message': 'アラーム設定が完了しました！', 'alarm_id': alarm_ref.id}), 201

    except Exception as e:
        print(f"アラーム設定中にエラーが発生しました: {e}")
        return jsonify({'message': 'サーバーエラーが発生しました。', 'error_code': 500}), 500

@app.route('/api/alarms')
def get_alarms():
    # ユーザーIDの取得 (現在認証がないため固定ユーザーを使用、本番では変更)
    # user_id = session.get('user_id', 'test_user_id') 
    user_id = 'test_user_id' # デモ用固定ユーザーID

    alarms_ref = firestore_db.collection('users').document(user_id).collection('alarms')
    docs = alarms_ref.stream()

    alarms_list = []
    for doc in docs:
        alarm = doc.to_dict()
        alarm['id'] = doc.id # ドキュメントIDをフロントエンドに渡す
        alarms_list.append(alarm)
    
    # 時刻でソート (昇順)
    alarms_list.sort(key=lambda x: (x['hour'], x['minute']))

    return jsonify({'alarms': alarms_list}), 200


@app.route('/api/alarm/<alarm_id>/toggle', methods=['PUT'])
def toggle_alarm(alarm_id):
    # user_id = session.get('user_id', 'test_user_id') 
    user_id = 'test_user_id' # デモ用固定ユーザーID

    alarm_ref = firestore_db.collection('users').document(user_id).collection('alarms').document(alarm_id)
    alarm_doc = alarm_ref.get()

    if not alarm_doc.exists:
        return jsonify({'message': 'アラームが見つかりません。', 'error_code': 404}), 404

    current_state = alarm_doc.to_dict().get('is_on', False)
    new_state = not current_state
    
    alarm_ref.update({'is_on': new_state})

    return jsonify({'message': f'アラームを{"オン" if new_state else "オフ"}にしました。', 'is_on': new_state}), 200


@app.route('/api/alarm/<alarm_id>', methods=['DELETE'])
def delete_alarm(alarm_id):
    # user_id = session.get('user_id', 'test_user_id') 
    user_id = 'test_user_id' # デモ用固定ユーザーID

    alarm_ref = firestore_db.collection('users').document(user_id).collection('alarms').document(alarm_id)
    alarm_doc = alarm_ref.get()

    if not alarm_doc.exists:
        return jsonify({'message': 'アラームが見つかりません。', 'error_code': 404}), 404
    
    alarm_ref.delete()

    return jsonify({'message': 'アラームが削除されました。'}), 200


# --- Googleカレンダー同期 ---
@app.route('/api/google_calendar/sync_sleep', methods=['POST'])
def sync_sleep_to_google_calendar():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({"message": "Googleアカウントが連携されていません。", "error_code": 401}), 401

    user_doc = firestore_db.collection('users').document(user_id).get()
    if not user_doc.exists or 'google_token' not in user_doc.to_dict():
        return jsonify({"message": "Googleアカウントが連携されていません。", "error_code": 401}), 401

    google_token_info = user_doc.to_dict()['google_token']

    # 最新の睡眠時間データを取得 (Fitbit APIまたはFirestoreから)
    # ここでは仮のデータを使用
    sleep_duration_minutes = 8 * 60 + 30 # 例: 8時間30分

    today_date_str = datetime.now().strftime('%Y-%m-%d')
    # Fitbit APIから今日の睡眠データを取得し、durationを計算
    # (get_today_sleep()関数からdurationを取得するロジックを再利用または修正)
    
    # 睡眠イベントの開始時刻と終了時刻を計算
    sleep_end_time = datetime.now() # 現在時刻を仮の起床時間とする
    sleep_start_time = sleep_end_time - timedelta(minutes=sleep_duration_minutes)

    try:
        event = {
            'summary': '睡眠記録',
            'description': f'今日の睡眠時間: {sleep_duration_minutes // 60}時間{sleep_duration_minutes % 60}分',
            'start': {'dateTime': sleep_start_time.isoformat(), 'timeZone': 'Asia/Tokyo'},
            'end': {'dateTime': sleep_end_time.isoformat(), 'timeZone': 'Asia/Tokyo'},
        }

        google_headers = {
            'Authorization': f'Bearer {google_token_info["access_token"]}',
            'Content-Type': 'application/json'
        }
        calendar_response = requests.post(
            'https://www.googleapis.com/calendar/v3/calendars/primary/events',
            headers=google_headers,
            json=event
        )
        calendar_response.raise_for_status()

        event_id = calendar_response.json().get('id')

        # 必要であれば、FirestoreにGoogle Calendar Event IDを保存
        # firestore_db.collection('users').document(user_id).collection('sleep_data').document(today_date).update({'google_calendar_event_id': event_id})\

        return jsonify({"message": "睡眠時間をGoogleカレンダーに書き込みました", "event_id": event_id}), 200

    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 401:
            return jsonify({"message": "Googleトークンが無効または期限切れです。再認証してください。", "error_code": 401}), 401
        print(f"API連携エラー: {e.response.text}")
        return jsonify({"message": "カレンダーへの書き込みに失敗しました", "error": str(e)}), 500
    except Exception as e:
        print(f"Googleカレンダー同期エラー: {e}")
        return jsonify({"message": "サーバーエラーが発生しました", "error": str(e)}), 500


if __name__ == '__main__':
    # スケジューラの開始をアプリケーション実行時に変更
    # if not scheduler.running:
    #    scheduler.start()
    app.run(debug=True)
