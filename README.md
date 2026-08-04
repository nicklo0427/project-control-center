# Project Control Center

Project Control Center 是一套給 macOS 使用的本機 npm 專案控制台。它會掃描你選擇的工作區，集中執行 npm scripts、顯示即時日誌，並說明目前被占用的 Port 正在執行什麼程序。

[下載最新版 Universal DMG](https://github.com/nicklo0427/project-control-center/releases/latest) · [回報問題](https://github.com/nicklo0427/project-control-center/issues) · [版本紀錄](CHANGELOG.md)

## 主要功能

- 遞迴掃描工作區中的 `package.json`，自動列出 npm scripts。
- 執行 `npm run dev`、`npm run build` 及其他已掃描到的 scripts。
- 自動辨識品牌目錄與品牌參數，例如 `npm run dev -- ot888`。
- 顯示 stdout、stderr、PID、exit code、狀態及可開啟的本機開發網址。
- 掃描監聽中的 TCP Port，顯示程序說明、命令、工作目錄及關聯專案。
- 依「專案、Node、系統、其他」分類 Port，並安全停止符合政策的開發程序。
- 顯示 macOS、Node、npm、PATH、`lsof` 與 `ps` 的環境診斷及修復提示。
- 所有專案路徑、命令與程序資料只在本機處理，沒有遙測。

## 系統需求與安裝

- macOS 12 Monterey 或更新版本。
- Apple Silicon 或 Intel Mac；Release 提供 Universal DMG。
- 執行專案需自行安裝 Node.js LTS 與 npm。

從 [GitHub Releases](https://github.com/nicklo0427/project-control-center/releases) 下載 `Project-Control-Center-<version>-universal.dmg`，開啟 DMG 後將 App 拖入 Applications。正式 Release 會經 Developer ID 簽章、Apple Notarization 與 stapling，正常情況下不需要以右鍵繞過 Gatekeeper。若 macOS 阻擋已驗證的正式版本，請保留畫面與版本號並[建立 Bug 回報](https://github.com/nicklo0427/project-control-center/issues/new/choose)。

首次啟動會直接要求選擇工作區。取消時 App 會安全停留在空白狀態；之後可用「選擇工作區」或「更換資料夾」繼續。選擇結果只保存在 Electron userData，不會寫入專案。

第一版不包含自動更新。請從 App 的「環境診斷」頁或 GitHub Releases 手動下載新版本。

## 安全模型

Renderer 未啟用 Node integration。檔案系統、程序與系統操作都留在 Electron 主程序，Renderer 只能使用有限且經驗證的 preload API。命令執行只接受掃描後登記的專案、script 與品牌，不提供任意 shell 輸入。

Port 頁面的「停用」不是任意 Process Killer。控制台只允許停止：

1. 由控制台啟動及管理的任務。
2. 目前使用者擁有，且工作目錄位於已掃描專案內的 Node.js 程序。

macOS 系統服務、一般應用程式、其他使用者程序、工作區外程序及來源不明程序都不允許停止。外部工作區程序只會收到 `SIGTERM`，不會升級為 `SIGKILL`。停止前會重新驗證 Port、PID、使用者及專案。顯示命令時會遮蔽 `token`、`password`、`secret`、`api-key` 等敏感參數。完整政策見 [SECURITY.md](SECURITY.md)。

## 本機開發

需要 Node.js 22.12 或更新版本。

```bash
git clone https://github.com/nicklo0427/project-control-center.git
cd project-control-center
npm ci
npm run dev
```

常用指令：

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 啟動 Vite 與 Electron 開發環境 |
| `npm test` | 執行 Vitest 測試 |
| `npm run typecheck` | 執行 Vue／TypeScript 型別檢查 |
| `npm run build` | 型別檢查並建置 production 程式碼，不產生 DMG |
| `npm run package:local` | 產生目前架構的未簽章本機測試 DMG，不可公開發布 |
| `npm run release:mac` | 產生簽章及 notarized 的 Universal 公開 DMG；缺少憑證時會失敗 |

正式發版由 GitHub Actions 在 `v*` tag 上執行。CI 會測試、型別檢查、production audit、Universal build、簽章、notarization、stapling，並以 `codesign`、`spctl`、`stapler`、`hdiutil` 與 `lipo` 驗證後才建立 GitHub Release。所需 secrets 與流程見 [CONTRIBUTING.md](CONTRIBUTING.md)。DMG、憑證、API Key、`node_modules` 與 build artifacts 一律不提交到 Git。

## 專案掃描與限制

- 忽略 `node_modules`、隱藏目錄、Git 資料及常見建置產物。
- 不將 Project Control Center 自身列為可啟動專案。
- 無效的 `package.json` 會顯示警告，不中止整次掃描。
- 系統權限不足時，Port 頁面退回顯示可取得的 Process、PID 與 Port，不要求管理員權限。
- 第一版只支援 npm，不含 pnpm、Yarn、自訂 shell、環境變數編輯或自動更新。

## 授權與隱私

本專案採 [MIT License](LICENSE)。隱私說明見 [PRIVACY.md](PRIVACY.md)，漏洞回報方式見 [SECURITY.md](SECURITY.md)，參與開發請見 [CONTRIBUTING.md](CONTRIBUTING.md)。
