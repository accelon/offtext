package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testTSV = "{id:\"a\",name:\"A\",group:\"文科\"}\n_\t首頁\n甲\t甲條目\n"

func newTestService(t *testing.T) (*DataService, string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.tsv"), []byte(testTSV), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.tsv"), []byte("{id:\"b\",name:\"B\"}\n_\tB\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	data, err := loadDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	return &DataService{data: data}, dir
}

func TestSaveTSVWritesFileAndUpdatesSnapshot(t *testing.T) {
	svc, dir := newTestService(t)
	bTSV := "{id:\"b\",name:\"B\"}\n_\tB\n"
	updated := "{id:\"a\",name:\"A\",group:\"文科\"}\n_\t首頁\n甲\t甲條目\n乙\t新增條目\n"

	req := httptest.NewRequest(http.MethodPost, "/api/tsv/a.tsv", strings.NewReader(updated))
	rec := httptest.NewRecorder()
	svc.assetHandler(http.NotFoundHandler()).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}

	onDisk, err := os.ReadFile(filepath.Join(dir, "a.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != updated {
		t.Fatalf("file not updated:\n%s", onDisk)
	}
	if got, _ := svc.data.ByName["a.tsv"]; string(got) != updated {
		t.Fatalf("snapshot not updated")
	}
	if got := svc.Status().TotalBytes; got != len(updated)+len(bTSV) {
		t.Fatalf("totalBytes=%d", got)
	}
	if _, err := os.Stat(filepath.Join(dir, ".a.tsv.tmp")); !os.IsNotExist(err) {
		t.Fatalf("temp file left behind")
	}
}

func TestSaveTSVRejectsInvalidInput(t *testing.T) {
	svc, dir := newTestService(t)
	cases := []struct {
		name string
		text string
	}{
		{"../a.tsv", testTSV},
		{"missing.tsv", testTSV},
		{"a.tsv", ""},
		{"a.tsv", "{id:\"wrong\",name:\"A\"}\n_ x\n"},
		{"a.tsv", "not a meta\n"},
	}
	for _, tc := range cases {
		if _, err := svc.SaveTSV(tc.name, tc.text); err == nil {
			t.Errorf("SaveTSV(%q) should fail", tc.name)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "a.tsv")); err != nil {
		t.Fatal("original file should remain")
	}
}

func TestDataHandlerServesSavedContent(t *testing.T) {
	svc, _ := newTestService(t)
	updated := "{id:\"a\",name:\"A\"}\n_\t新首頁\n"
	if _, err := svc.SaveTSV("a.tsv", updated); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(svc.assetHandler(http.NotFoundHandler()))
	defer server.Close()

	resp, err := http.Get(server.URL + "/data/a.tsv")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if string(body) != updated {
		t.Fatalf("GET after save returned old content:\n%s", body)
	}
}
