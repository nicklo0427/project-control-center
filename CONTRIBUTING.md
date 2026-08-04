# Contributing

感謝你協助改善 Project Control Center。

## 開發環境

- macOS 12+
- Node.js 22.12+
- npm

```bash
npm ci
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

Pull Request 應維持 Renderer 的 `nodeIntegration: false`，所有檔案、程序與系統操作必須留在主程序，並透過最小且可驗證的 IPC 介面提供。不要加入任意 shell 指令入口；程序停止政策的放寬必須附安全理由與測試。

PR 請包含目的、使用者可見變更、測試方式及必要畫面。新增行為需補測試。不要提交 DMG、`node_modules`、build artifacts、Apple `.p12`、API Key、token 或個人路徑。

## Maintainer release setup

正式 Release workflow 需要 repository secrets：

- `MAC_CSC_LINK`：Developer ID Application `.p12` 的 base64 內容。
- `MAC_CSC_KEY_PASSWORD`：`.p12` 密碼。
- `APPLE_API_KEY_BASE64`：App Store Connect API Key `.p8` 的 base64 內容。
- `APPLE_API_KEY_ID`：API Key ID。
- `APPLE_API_ISSUER`：API Issuer ID。

憑證與 API Key 只能放在 GitHub Actions Secrets，不可提交、貼入 Issue 或輸出到 log。確認 Apple Developer Program 會員、Developer ID Application 憑證及 App Store Connect API Key 可用後，建立並推送符合 Semantic Versioning 的 tag，例如：

```bash
git tag v1.0.0
git push origin v1.0.0
```

workflow 會建立 `Project-Control-Center-1.0.0-universal.dmg`、`SHA256SUMS.txt` 與 GitHub Release。發布前需更新 [CHANGELOG.md](CHANGELOG.md)。
