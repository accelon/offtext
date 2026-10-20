package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const maxTSVBytes = 8 << 20 // 與 serve.mjs 的 8 MiB 上限一致

// DataFile 是啟動時實際讀入的單一 TSV。
type DataFile struct {
	Name    string `json:"name"`
	ID      string `json:"id"`
	Title   string `json:"title"`
	Group   string `json:"group"`
	Hidden  bool   `json:"hidden"`
	Bytes   int    `json:"bytes"`
	Entries int    `json:"entries"`
}

// DataSet 是 data/ 的記憶體快照。所有 TSV 在啟動時一次讀完；前端只透過
// 同一個來源的 HTTP 路徑取得，避免逐檔 IPC，也避免瀏覽器模式下載不到。
// 存檔時由 DataService 更新這份快照，讓後續 GET 立即看到新內容。
type DataSet struct {
	Dir       string
	Files     []DataFile
	ByName    map[string][]byte
	IndexText []byte
	Problems  []string
	LoadedAt  time.Time

	totalBytes int
}

func (d *DataSet) TotalBytes() int {
	if d == nil {
		return 0
	}
	return d.totalBytes
}

// DataStatus 回傳給前端／診斷用；不含 TSV 內容。
type DataStatus struct {
	Dir        string     `json:"dir"`
	Files      []DataFile `json:"files"`
	LoadedAt   string     `json:"loadedAt"`
	TotalBytes int        `json:"totalBytes"`
	Problems   []string   `json:"problems,omitempty"`
}

type DataService struct {
	mu   sync.RWMutex
	data *DataSet
}

// SaveResult 是 POST /api/tsv/<file> 的回應；欄位與 serve.mjs 一致。
type SaveResult struct {
	OK    bool   `json:"ok"`
	File  string `json:"file"`
	Bytes int    `json:"bytes"`
}

func (s *DataService) Status() DataStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return statusOf(s.data)
}

// assetHandler 讓桌面版的存檔路徑與本機 serve.mjs 一致：
//
//	GET  /data/...         讀啟動時載入的記憶體快照
//	POST /api/tsv/<file>   寫回 data/<file>，並更新記憶體快照
//
// 其餘路徑（含 /wails/runtime.js 與前端 assets）交給 BundledAssetFileServer。
// 不匯出，避免被 Wails 的 service 反射誤認為可綁定方法。
func (s *DataService) assetHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/tsv/") {
			s.handleSave(w, r)
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/data/") {
			next.ServeHTTP(w, r)
			return
		}
		s.mu.RLock()
		defer s.mu.RUnlock()
		if s.data == nil {
			http.NotFound(w, r)
			return
		}
		s.data.readHandler(next).ServeHTTP(w, r)
	})
}

func (s *DataService) handleSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "only POST"})
		return
	}
	if r.ContentLength > maxTSVBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"ok": false, "error": "檔案太大"})
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxTSVBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "讀取內容失敗"})
		return
	}
	if len(body) > maxTSVBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"ok": false, "error": "檔案太大"})
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/api/tsv/")
	result, err := s.SaveTSV(name, string(body))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// SaveTSV 只允許寫回啟動時已載入的檔名；寫入是原子替換，失敗時舊檔不動。
func (s *DataService) SaveTSV(name, text string) (SaveResult, error) {
	if name == "" || strings.ContainsAny(name, `/\`) || strings.HasPrefix(name, ".") {
		return SaveResult{}, fmt.Errorf("檔名不合法")
	}
	if !strings.EqualFold(filepath.Ext(name), ".tsv") {
		return SaveResult{}, fmt.Errorf("只允許 .tsv")
	}
	body := []byte(text)
	if len(body) == 0 {
		return SaveResult{}, fmt.Errorf("檔案是空的")
	}
	if len(body) > maxTSVBytes {
		return SaveResult{}, fmt.Errorf("檔案太大")
	}
	if !utf8.Valid(body) {
		return SaveResult{}, fmt.Errorf("內容不是有效的 UTF-8")
	}
	meta := parseTSVMeta(body)
	stem := strings.TrimSuffix(name, filepath.Ext(name))
	if meta.id == "" {
		return SaveResult{}, fmt.Errorf("TSV 第一行必須是 {id:\"…\",name:\"…\"} 的 meta")
	}
	if meta.id != stem {
		return SaveResult{}, fmt.Errorf("id「%s」與檔名「%s.tsv」不一致", meta.id, stem)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	d := s.data
	if d == nil {
		return SaveResult{}, fmt.Errorf("資料尚未載入")
	}
	if _, ok := d.ByName[name]; !ok {
		return SaveResult{}, fmt.Errorf("不是啟動時載入的檔案：%s", name)
	}

	full := filepath.Join(d.Dir, name)
	mode := os.FileMode(0o644)
	if st, err := os.Stat(full); err == nil {
		mode = st.Mode().Perm()
	}
	tmp := filepath.Join(d.Dir, "."+name+".tmp")
	if err := os.WriteFile(tmp, body, mode); err != nil {
		_ = os.Remove(tmp)
		return SaveResult{}, fmt.Errorf("寫入暫存檔失敗：%w", err)
	}
	if err := os.Rename(tmp, full); err != nil {
		_ = os.Remove(tmp)
		return SaveResult{}, fmt.Errorf("替換檔案失敗：%w", err)
	}

	oldBytes := 0
	for i := range d.Files {
		if d.Files[i].Name != name {
			continue
		}
		oldBytes = d.Files[i].Bytes
		d.Files[i].Bytes = len(body)
		d.Files[i].Entries = countEntries(body)
		d.Files[i].ID = meta.id
		if meta.name != "" {
			d.Files[i].Title = meta.name
		}
		if meta.group != "" {
			d.Files[i].Group = meta.group
		}
		d.Files[i].Hidden = meta.hidden
		break
	}
	d.ByName[name] = body
	d.totalBytes += len(body) - oldBytes
	d.LoadedAt = time.Now()
	return SaveResult{OK: true, File: name, Bytes: len(body)}, nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	body, err := json.Marshal(value)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(append(body, '\n'))
}

func statusOf(d *DataSet) DataStatus {
	if d == nil {
		return DataStatus{}
	}
	return DataStatus{
		Dir: d.Dir, Files: d.Files, TotalBytes: d.totalBytes,
		LoadedAt: d.LoadedAt.Format(time.RFC3339), Problems: append([]string{}, d.Problems...),
	}
}

var (
	metaID     = regexp.MustCompile(`id\s*:\s*"([^"]*)"`)
	metaName   = regexp.MustCompile(`name\s*:\s*"([^"]*)"`)
	metaGroup  = regexp.MustCompile(`group\s*:\s*"([^"]*)"`)
	metaHidden = regexp.MustCompile(`hidden\s*:\s*"?([a-z]+)"?`)
)

func loadDataDir(dir string) (*DataSet, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, fmt.Errorf("讀取資料目錄失敗：%w", err)
	}

	// data-index.txt 存在時決定科目順序；未列出的新 TSV 接在後面，
	// 所以「放在 data/ 的所有 tsv」都會被載入。
	preferred := readIndexOrder(filepath.Join(abs, "data-index.txt"))
	seen := map[string]bool{}
	names := make([]string, 0, len(entries))
	add := func(name string) {
		if seen[strings.ToLower(name)] {
			return
		}
		seen[strings.ToLower(name)] = true
		names = append(names, name)
	}
	for _, name := range preferred {
		add(name)
	}
	var rest []string
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".tsv") {
			continue
		}
		rest = append(rest, e.Name())
	}
	sort.Slice(rest, func(i, j int) bool { return strings.ToLower(rest[i]) < strings.ToLower(rest[j]) })
	for _, name := range rest {
		add(name)
	}

	data := &DataSet{Dir: abs, ByName: map[string][]byte{}, LoadedAt: time.Now()}
	for _, name := range names {
		if !strings.EqualFold(filepath.Ext(name), ".tsv") {
			continue
		}
		full := filepath.Join(abs, name)
		raw, err := os.ReadFile(full)
		if err != nil {
			data.Problems = append(data.Problems, name+"："+err.Error())
			continue
		}
		raw = bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
		if len(raw) == 0 {
			data.Problems = append(data.Problems, name+"：檔案是空的")
		} else if !utf8.Valid(raw) {
			data.Problems = append(data.Problems, name+"：不是有效的 UTF-8")
			continue
		}
		meta := parseTSVMeta(raw)
		info := DataFile{
			Name: name, ID: meta.id, Title: meta.name, Group: meta.group,
			Hidden: meta.hidden, Bytes: len(raw), Entries: countEntries(raw),
		}
		if info.ID == "" {
			info.ID = strings.TrimSuffix(name, filepath.Ext(name))
		}
		if info.Title == "" {
			info.Title = info.ID
		}
		data.Files = append(data.Files, info)
		data.ByName[name] = raw
		data.totalBytes += len(raw)
	}
	if len(data.Files) == 0 {
		return nil, fmt.Errorf("資料目錄沒有任何可讀的 .tsv：%s", abs)
	}

	var index strings.Builder
	index.WriteString("# 由 Offtext 桌面版啟動時掃描 data/ 產生；一行一個 TSV。\n")
	index.WriteString("# 修改檔案後重新啟動即可載入；data-index.txt 只用來決定順序。\n")
	for _, f := range data.Files {
		index.WriteString(f.Name)
		index.WriteByte('\n')
	}
	data.IndexText = []byte(index.String())
	return data, nil
}

func readIndexOrder(path string) []string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var out []string
	for _, line := range strings.Split(strings.TrimPrefix(string(raw), "\uFEFF"), "\n") {
		if cut := strings.IndexByte(line, '#'); cut >= 0 {
			line = line[:cut]
		}
		for _, token := range strings.FieldsFunc(line, func(r rune) bool {
			return r == ' ' || r == '\t' || r == ',' || r == '\r'
		}) {
			token = strings.TrimPrefix(strings.TrimSpace(token), "./")
			if token == "" {
				continue
			}
			if !strings.EqualFold(filepath.Ext(token), ".tsv") {
				token += ".tsv"
			}
			if strings.ContainsAny(token, `/\`) || strings.HasPrefix(token, ".") {
				continue
			}
			out = append(out, token)
		}
	}
	return out
}

type tsvMeta struct {
	id, name, group string
	hidden          bool
}

func parseTSVMeta(raw []byte) tsvMeta {
	var meta tsvMeta
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if !strings.HasPrefix(line, "{") {
			break
		}
		if m := metaID.FindStringSubmatch(line); m != nil {
			meta.id = m[1]
		}
		if m := metaName.FindStringSubmatch(line); m != nil {
			meta.name = m[1]
		}
		if m := metaGroup.FindStringSubmatch(line); m != nil {
			meta.group = m[1]
		}
		if m := metaHidden.FindStringSubmatch(line); m != nil {
			meta.hidden = m[1] == "true"
		}
		break
	}
	return meta
}

func countEntries(raw []byte) int {
	n := 0
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSuffix(line, "\r")
		if strings.TrimSpace(line) == "" || strings.HasPrefix(strings.TrimSpace(line), "{") {
			continue
		}
		tab := strings.IndexByte(line, '\t')
		key := strings.TrimSpace(line)
		value := ""
		if tab >= 0 {
			key = strings.TrimSpace(line[:tab])
			value = strings.TrimSpace(line[tab+1:])
		}
		if key == "" || key == "_" || strings.HasPrefix(key, "@") || strings.HasPrefix(value, "@") {
			continue
		}
		n++
	}
	return n
}

// Handler 先處理 /data/（來自主機啟動時載入的記憶體快照），其餘交給
// BundledAssetFileServer。前端因此不必改動既有的 fetch('data/...') 流程。
func (d *DataSet) readHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/data/") {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/data/")
		switch name {
		case "data-index.txt":
			serveBytes(w, r, "text/plain; charset=utf-8", d.IndexText)
			return
		case "status.json":
			body, _ := json.MarshalIndent(statusOf(d), "", "  ")
			serveBytes(w, r, "application/json; charset=utf-8", append(body, '\n'))
			return
		}
		// 只接受啟動時實際載入的檔名；不做任何路徑拼接，避免 traversal。
		body, ok := d.ByName[name]
		if !ok || strings.ContainsAny(name, `/\`) || strings.HasPrefix(name, ".") {
			http.NotFound(w, r)
			return
		}
		serveBytes(w, r, "text/tab-separated-values; charset=utf-8", body)
	})
}

func serveBytes(w http.ResponseWriter, r *http.Request, contentType string, body []byte) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(body)
}
