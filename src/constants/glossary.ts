export interface GlossaryItem {
  term: string
  description: string
  category: '頁面' | '欄位' | '狀態'
}

export const glossaryItems: GlossaryItem[] = [
  {
    term: '掃描中...',
    description: '表示系統正在執行連接埠掃描，這段期間會暫時停用重複觸發。',
    category: '頁面',
  },
  {
    term: '最後更新',
    description: '顯示最近一次成功取得掃描結果的時間。',
    category: '頁面',
  },
  {
    term: '空狀態',
    description: '當目前找不到符合條件的監聽中 TCP 連接埠時顯示的提示。',
    category: '頁面',
  },
  {
    term: 'Port',
    description: '連接埠號碼，用來識別服務對外提供連線的通道。',
    category: '欄位',
  },
  {
    term: 'Process',
    description: '佔用該連接埠的程式名稱。',
    category: '欄位',
  },
  {
    term: 'PID',
    description: 'Process ID，作業系統給該程序的唯一識別碼。',
    category: '欄位',
  },
  {
    term: 'Protocol',
    description: '網路協定類型，目前主要顯示 TCP。',
    category: '欄位',
  },
  {
    term: 'Address',
    description: '程序監聽的網路位址，例如 127.0.0.1、0.0.0.0 或 ::1。',
    category: '欄位',
  },
  {
    term: 'State',
    description: '連接埠目前狀態，表示此程序對該連接埠的連線狀況。',
    category: '欄位',
  },
  {
    term: 'LISTEN',
    description: '表示該程序正在等待外部連線進入，是服務可被連接的狀態。',
    category: '狀態',
  },
]
