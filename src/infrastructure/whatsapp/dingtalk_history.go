package whatsapp

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/aldinokemal/go-whatsapp-web-multidevice/config"
	"github.com/aldinokemal/go-whatsapp-web-multidevice/pkg/utils"
)

const (
	dingTalkHistoryStatusSuccess = "success"
	dingTalkHistoryStatusFailed  = "failed"
	dingTalkForwardHistoryMax    = 200
)

type DingTalkForwardHistoryEntry struct {
	ID          string `json:"id"`
	ForwardedAt string `json:"forwarded_at"`
	ChatName    string `json:"chat_name"`
	Sender      string `json:"sender"`
	Message     string `json:"message"`
	Status      string `json:"status"`
	Error       string `json:"error,omitempty"`
}

var (
	dingTalkForwardHistoryMu           sync.Mutex
	dingTalkForwardHistoryPathOverride string
)

func ListDingTalkForwardHistory(limit int) []DingTalkForwardHistoryEntry {
	dingTalkForwardHistoryMu.Lock()
	defer dingTalkForwardHistoryMu.Unlock()

	entries, err := readDingTalkForwardHistoryLocked()
	if err != nil {
		return nil
	}
	if limit <= 0 || limit > dingTalkForwardHistoryMax {
		limit = 50
	}
	if len(entries) > limit {
		return entries[:limit]
	}
	return entries
}

func recordDingTalkForwardHistory(entry DingTalkForwardHistoryEntry) error {
	dingTalkForwardHistoryMu.Lock()
	defer dingTalkForwardHistoryMu.Unlock()

	if strings.TrimSpace(entry.ID) == "" {
		entry.ID = newDingTalkForwardHistoryID()
	}
	if strings.TrimSpace(entry.ForwardedAt) == "" {
		entry.ForwardedAt = time.Now().Format(time.RFC3339)
	}

	entries, err := readDingTalkForwardHistoryLocked()
	if err != nil {
		entries = nil
	}
	entries = append([]DingTalkForwardHistoryEntry{entry}, entries...)
	if len(entries) > dingTalkForwardHistoryMax {
		entries = entries[:dingTalkForwardHistoryMax]
	}

	path := dingTalkForwardHistoryPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create dingtalk history folder: %w", err)
	}

	body, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal dingtalk history: %w", err)
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		return fmt.Errorf("write dingtalk history: %w", err)
	}

	return nil
}

func buildDingTalkHistoryEntry(message map[string]any, status, errorText string) DingTalkForwardHistoryEntry {
	body := stringFromPayload(message, "body")
	if body == "" {
		body = extractStructuredMessageContent(message)
	}
	if body == "" {
		body = "(无法识别的消息类型)"
	}

	return DingTalkForwardHistoryEntry{
		ID:          newDingTalkForwardHistoryID(),
		ForwardedAt: time.Now().Format(time.RFC3339),
		ChatName:    dingTalkHistoryChatLabel(message),
		Sender:      firstNonEmpty(stringFromPayload(message, "from_name"), stringFromPayload(message, "from")),
		Message:     truncateRunes(body, config.DingTalkMaxBodyLength),
		Status:      status,
		Error:       truncateRunes(strings.TrimSpace(errorText), 300),
	}
}

func dingTalkHistoryChatLabel(message map[string]any) string {
	chatID := stringFromPayload(message, "chat_id")
	if utils.IsGroupJID(chatID) {
		return dingTalkChatLabel(message)
	}
	return firstNonEmpty(stringFromPayload(message, "chat_name"), stringFromPayload(message, "from_name"), "个人消息")
}

func readDingTalkForwardHistoryLocked() ([]DingTalkForwardHistoryEntry, error) {
	body, err := os.ReadFile(dingTalkForwardHistoryPath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	if len(body) == 0 {
		return nil, nil
	}

	var entries []DingTalkForwardHistoryEntry
	if err := json.Unmarshal(body, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

func dingTalkForwardHistoryPath() string {
	if strings.TrimSpace(dingTalkForwardHistoryPathOverride) != "" {
		return dingTalkForwardHistoryPathOverride
	}
	return filepath.Join(config.PathStorages, "dingtalk-forward-history.json")
}

func newDingTalkForwardHistoryID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("%d-%s", time.Now().UnixNano(), hex.EncodeToString(buf))
}
