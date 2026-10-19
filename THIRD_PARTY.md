# 第三方元件

`src/offtext-cm.js` 是 `src/editor/` 的建置產物，內含以下套件（皆為 MIT License）：

| 套件 | 用途 |
| --- | --- |
| `@codemirror/state` | EditorState、transaction、facet |
| `@codemirror/view` | EditorView、decoration、widget、theme |
| `@codemirror/commands` | history、預設 keymap |
| `@codemirror/autocomplete` | 補全、closeBrackets |
| `@codemirror/language` | bracketMatching |
| `@lezer/common`、`@lezer/highlight`、`@lezer/lr` | CM6 相依 |
| `style-mod`、`w3c-keyname`、`crelt` | CM6 相依 |

建置工具：`esbuild`（MIT）。

套件版本記錄在 `package-lock.json`。要重新產生 bundle：

```powershell
npm install
npm run build:editor
```
