package rest

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aldinokemal/go-whatsapp-web-multidevice/config"
	"github.com/gofiber/fiber/v2"
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

func TestDingTalkRulesPersistedToJSONConfigFile(t *testing.T) {
	originalPath := waSentinelConfigPathOverride
	originalRules := config.DingTalkRules
	defer func() {
		waSentinelConfigPathOverride = originalPath
		config.DingTalkRules = originalRules
	}()

	configPath := filepath.Join(t.TempDir(), "wa-sentinel-config.json")
	waSentinelConfigPathOverride = configPath
	config.DingTalkRules = []config.DingTalkRule{
		{
			ID:            "finance",
			Name:          "财务群付款提醒",
			Enabled:       true,
			Webhook:       "https://oapi.dingtalk.com/robot/send?access_token=finance",
			WebhookAlias:  "财务机器人",
			Secret:        "SEC-finance",
			Keywords:      []string{"付款"},
			Groups:        []string{"120363@finance@g.us"},
			OnlyGroups:    true,
			Title:         "财务提醒",
			MaxBodyLength: 500,
			TimeWindows:   []string{"09:00-18:00"},
		},
	}

	if err := persistWaSentinelConfig(); err != nil {
		t.Fatalf("persist wa sentinel config: %v", err)
	}

	content, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config file: %v", err)
	}
	text := string(content)
	for _, want := range []string{
		`"dingtalk_rules"`,
		`"name": "财务群付款提醒"`,
		`"webhook_alias": "财务机器人"`,
		`"keywords": [`,
		`"groups": [`,
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected config file to contain %q, got %s", want, text)
		}
	}
}

func TestMergeDingTalkRulesWithSavedSecretsPreservesBlankSensitiveFields(t *testing.T) {
	originalRules := config.DingTalkRules
	defer func() {
		config.DingTalkRules = originalRules
	}()

	config.DingTalkRules = []config.DingTalkRule{
		{
			ID:           "finance",
			Name:         "财务提醒",
			Enabled:      true,
			Webhook:      "https://oapi.dingtalk.com/robot/send?access_token=saved",
			WebhookAlias: "财务机器人",
			Secret:       "SEC-saved",
		},
	}

	merged := mergeDingTalkRulesWithSavedSecrets([]config.DingTalkRule{
		{
			ID:           "finance",
			Name:         "财务付款提醒",
			Enabled:      true,
			WebhookAlias: "财务机器人新名",
			Keywords:     []string{"付款"},
		},
	})

	if len(merged) != 1 {
		t.Fatalf("expected 1 merged rule, got %d", len(merged))
	}
	if merged[0].Webhook != "https://oapi.dingtalk.com/robot/send?access_token=saved" {
		t.Fatalf("expected saved webhook to be preserved, got %q", merged[0].Webhook)
	}
	if merged[0].Secret != "SEC-saved" {
		t.Fatalf("expected saved secret to be preserved, got %q", merged[0].Secret)
	}
	if merged[0].Name != "财务付款提醒" || !strings.Contains(strings.Join(merged[0].Keywords, ","), "付款") {
		t.Fatalf("expected editable fields to be updated, got %#v", merged[0])
	}
}

func TestSendTestUsesDraftRuleWithoutPersisting(t *testing.T) {
	var hits int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	originalRules := config.DingTalkRules
	originalWebhook := config.DingTalkWebhook
	originalSecret := config.DingTalkSecret
	defer func() {
		config.DingTalkRules = originalRules
		config.DingTalkWebhook = originalWebhook
		config.DingTalkSecret = originalSecret
	}()

	config.DingTalkRules = []config.DingTalkRule{
		{
			ID:      "saved",
			Name:    "已保存规则",
			Enabled: true,
			Webhook: "https://oapi.dingtalk.com/robot/send?access_token=saved",
			Secret:  "SEC-saved",
		},
	}

	body, err := json.Marshal(map[string]any{
		"rule": config.DingTalkRule{
			ID:            "draft",
			Name:          "草稿规则",
			Enabled:       true,
			Webhook:       server.URL,
			WebhookAlias:  "草稿机器人",
			Title:         "保存前校验",
			MaxBodyLength: 500,
		},
	})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	app := fiber.New()
	handler := DingTalkConfig{}
	app.Post("/dingtalk/test", handler.SendTest)
	req := httptest.NewRequest(http.MethodPost, "/dingtalk/test", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("send request: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if hits != 1 {
		t.Fatalf("expected draft webhook to receive test, got %d hits", hits)
	}
	if config.DingTalkRules[0].Webhook != "https://oapi.dingtalk.com/robot/send?access_token=saved" {
		t.Fatalf("expected saved config not to be overwritten, got %#v", config.DingTalkRules[0])
	}
}
