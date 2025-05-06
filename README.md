# sleep.gunma
群馬プログラミングアワード
//
//  SwiftUIView2.swift
//  Sleep.gunmaPG
//
//  Created by K H on 2025/05/06.
//

import UIKit
import UserNotifications

class ViewController: UIViewController {
    
    // UIコンポーネント
    private let titleLabel: UILabel = {
        let label = UILabel()
        label.text = "アラームを設定してください"
        label.textAlignment = .center
        label.font = UIFont.systemFont(ofSize: 20, weight: .bold)
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private let datePicker: UIDatePicker = {
        let picker = UIDatePicker()
        picker.datePickerMode = .time
        picker.preferredDatePickerStyle = .wheels
        picker.translatesAutoresizingMaskIntoConstraints = false
        return picker
    }()
    
    private let setAlarmButton: UIButton = {
        let button = UIButton(type: .system)
        button.setTitle("アラームを設定", for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 18, weight: .bold)
        button.backgroundColor = .systemBlue
        button.setTitleColor(.white, for: .normal)
        button.layer.cornerRadius = 10
        button.translatesAutoresizingMaskIntoConstraints = false
        return button
    }()
    
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        setupUI()
        
        // 通知の許可をリクエスト
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
            if granted {
                print("通知が許可されました")
            } else {
                print("通知が拒否されました")
            }
        }
        
        setAlarmButton.addTarget(self, action: #selector(setAlarm), for: .touchUpInside)
    }
    
    private func setupUI() {
        // 各コンポーネントをビューに追加
        view.addSubview(titleLabel)
        view.addSubview(datePicker)
        view.addSubview(setAlarmButton)
        
        // レイアウト設定
        NSLayoutConstraint.activate([
            titleLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 20),
            titleLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            
            datePicker.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            datePicker.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            
            setAlarmButton.topAnchor.constraint(equalTo: datePicker.bottomAnchor, constant: 20),
            setAlarmButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            setAlarmButton.widthAnchor.constraint(equalToConstant: 200),
            setAlarmButton.heightAnchor.constraint(equalToConstant: 50)
        ])
    }
    
    @objc private func setAlarm() {
        let selectedDate = datePicker.date
        scheduleNotification(for: selectedDate)
        
        let alert = UIAlertController(title: "アラーム設定", message: "アラームが設定されました！", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default, handler: nil))
        present(alert, animated: true, completion: nil)
    }
    
    private func scheduleNotification(for date: Date) {
        let content = UNMutableNotificationContent()
        content.title = "アラーム"
        content.body = "起きる時間です！"
        content.sound = .default
        
        // 通知が発火する時間を設定
        let triggerDate = Calendar.current.dateComponents([.hour, .minute], from: date)
        let trigger = UNCalendarNotificationTrigger(dateMatching: triggerDate, repeats: false)
        
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                print("通知のスケジュールでエラー: \(error.localizedDescription)")
            }
        }
    }
}

#Preview {
    ViewController()
}
