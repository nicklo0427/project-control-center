# Security Policy

## Supported versions

安全修正以最新 GitHub Release 為主。第一個公開版本為 1.0.x，舊版可能不再收到修正。

## Reporting a vulnerability

請使用 GitHub repository 的 **Security → Report a vulnerability** 私密回報功能，不要在公開 Issue 貼出 exploit、憑證、token、個人路徑或完整程序命令。請附上受影響版本、macOS 版本、重現步驟與影響範圍。維護者確認後會透過 GitHub Security Advisory 協作並安排修正與揭露。

## Process safety policy

Project Control Center 不提供任意 shell 輸入，也不允許從 Port 清單任意終止程序。受管理任務停止時先對程序群組送出 `SIGTERM`，逾時才對同一受管理群組使用 `SIGKILL`。工作區內但不是由 App 啟動的 Node.js 程序只允許 `SIGTERM`，不強制終止。系統服務、其他應用程式、其他使用者程序、工作區外程序及無法確認來源的程序不提供停止功能。

停止前會重新掃描並核對 Port、PID、目前使用者與專案歸屬，以降低過期資料與 PID 重用風險。命令列在送往 Renderer 前會遮蔽常見的 `token`、`password`、`secret` 與 `api-key` 參數。

公開 Release 必須通過 Developer ID 簽章、Apple Notarization、stapling 與 Gatekeeper 驗證。發布 workflow 缺少簽章資訊時會失敗，不應產生或上傳未簽章的正式 DMG。
