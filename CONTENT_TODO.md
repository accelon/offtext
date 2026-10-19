# 待辦：內容 DAG（進行中）

## 已定方向

- 線上版只提供閱讀：桌面與手機，不提供編輯。
- 編輯功能移到單機 EXE 版，之後再做。
- 先把程式拆分、建置、部署流程整理好；內容 DAG 等閱讀版穩定後再處理。

## 內容 DAG 的範圍

優先順序：

1. 數學（87 條，0 環）— 拆環與補鏈完成（2026-10-19）；見 `knowledge-pilot-math.md`。
2. 物理（82 條，0 環）— 收尾成完整 A 版，約半天到一天。
3. 公民與法治、財商（0 環）— 拆環完成（2026-10-19）；尚未補鏈。
4. 其他科目再依 `knowledge-audit` 的環數與最大 SCC 排。
5. 編輯指南：`editorial-guide.md`（2026-10-19）。

## Token 估算

以中文約 1.5 字／token：

| 類型 | 科目 | 內容 token | Agent 總 token |
| --- | --- | ---: | ---: |
| 簡單 | 數學、物理 | 1.4k–1.5k | 40k–80k |
| 中等 | 公民、財商、經濟、生物、藝術、地球 | 2.1k–5.6k | 80k–160k |
| 較大 | 國語、中國古代史、世界史、中國近代史、現代化 | 2.1k–4.4k | 120k–260k |
| 最重 | 化學、資訊科技、AI 術語 | 2.5k–8.8k | 250k–500k |

全部 16 科約 2M–4M tokens。這是 agent 流程的粗估，不是單次 prompt 直出。

## 本機成本

- `knowledge-audit` 約 0.1 秒；`build` 約 0.1 秒；`test-core` 約 0.1 秒。
- 單一 Edge 測試約 20–90 秒；全套約 5–10 分鐘。
- 模型推論不在本機；本機只跑 Node／Edge。

## 資料注意

- `data/` 被 `.gitignore` 忽略；物理與數學 pilot 的編輯只存在本機。
- 改任何一科前先備份 `data/<科目>.tsv`。
- 每次改完跑：

```powershell
node src/tools/knowledge-audit.mjs --domain=<科目> --top=20 --layers
node src/tools/audit.mjs
```
