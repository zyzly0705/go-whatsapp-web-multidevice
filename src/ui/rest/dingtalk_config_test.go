package rest

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aldinokemal/go-whatsapp-web-multidevice/config"
)

func TestDingTalkWebhookAliasPersistedAndReturned(t *testing.T) {
	originalWebhook := config.DingTalkWebhook
	originalWebhookAlias := config.DingTalkWebhookAlias
	defer func() {
		config.DingTalkWebhook = originalWebhook
		config.DingTalkWebhookAlias = originalWebhookAlias
	}()

	config.DingTalkWebhook = "https://oapi.dingtalk.com/robot/send?access_token=test"
	config.DingTalkWebhookAlias = "业务预警机器人"

	snapshot := dingTalkConfigSnapshot()
	if snapshot.WebhookAlias != "业务预警机器人" {
		t.Fatalf("expected webhook alias in snapshot, got %q", snapshot.WebhookAlias)
	}

	envPath := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(envPath, []byte("DINGTALK_WEBHOOK_ALIAS=旧机器人\n"), 0600); err != nil {
		t.Fatalf("write temp env: %v", err)
	}

	if err := persistDingTalkEnv(envPath); err != nil {
		t.Fatalf("persist dingtalk env: %v", err)
	}

	content, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("read temp env: %v", err)
	}
	if !strings.Contains(string(content), "DINGTALK_WEBHOOK_ALIAS=业务预警机器人") {
		t.Fatalf("expected alias to be persisted, got %s", string(content))
	}
}
