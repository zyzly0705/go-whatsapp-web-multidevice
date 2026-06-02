package whatsapp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aldinokemal/go-whatsapp-web-multidevice/config"
)

func TestDingTalkShouldForwardOnlyMatchingGroupMessages(t *testing.T) {
	withDingTalkConfig(t, func() {
		config.DingTalkEnabled = true
		config.DingTalkWebhook = "https://oapi.dingtalk.com/robot/send?access_token=test"
		config.DingTalkOnlyGroups = true
		config.DingTalkKeywords = []string{"重要业务提醒"}
		config.DingTalkGroups = []string{"120363@test@g.us"}

		if !shouldForwardToDingTalk("message", webhookPayload("120363@test@g.us", "这个是重要业务提醒，请处理")) {
			t.Fatal("expected matching group message to be forwarded")
		}

		if shouldForwardToDingTalk("message", webhookPayload("120363@test@g.us", "普通聊天")) {
			t.Fatal("expected non-matching keyword to be filtered")
		}

		if shouldForwardToDingTalk("message", webhookPayload("628123@s.whatsapp.net", "重要业务提醒")) {
			t.Fatal("expected private chat to be filtered when only groups are enabled")
		}

		if shouldForwardToDingTalk("message.reaction", webhookPayload("120363@test@g.us", "重要业务提醒")) {
			t.Fatal("expected non-message event to be filtered")
		}
	})
}

func TestDingTalkAllowsDirectMessagesWhenEnabledWithGroupAllowlist(t *testing.T) {
	withDingTalkConfig(t, func() {
		config.DingTalkEnabled = true
		config.DingTalkWebhook = "https://oapi.dingtalk.com/robot/send?access_token=test"
		config.DingTalkOnlyGroups = false
		config.DingTalkKeywords = []string{"重要业务提醒"}
		config.DingTalkGroups = []string{"120363@allowed@g.us"}

		if !shouldForwardToDingTalk("message", webhookPayload("628123@s.whatsapp.net", "重要业务提醒：请处理")) {
			t.Fatal("expected matching direct message to be forwarded when direct monitoring is enabled")
		}

		if shouldForwardToDingTalk("message", webhookPayload("628123@s.whatsapp.net", "普通聊天")) {
			t.Fatal("expected direct message without matching keyword to be filtered")
		}

		if shouldForwardToDingTalk("message", webhookPayload("120363@other@g.us", "重要业务提醒：请处理")) {
			t.Fatal("expected group allowlist to still filter unmatched groups")
		}
	})
}

func TestDingTalkBuildSignedWebhookURL(t *testing.T) {
	rawURL := "https://oapi.dingtalk.com/robot/send?access_token=abc"
	got, err := buildDingTalkWebhookURL(rawURL, "SEC-test", 1700000000000)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if !strings.Contains(got, "access_token=abc") {
		t.Fatalf("expected access token to be preserved, got %s", got)
	}
	if !strings.Contains(got, "timestamp=1700000000000") {
		t.Fatalf("expected timestamp query, got %s", got)
	}
	if !strings.Contains(got, "sign=") {
		t.Fatalf("expected sign query, got %s", got)
	}
}

func TestSubmitDingTalkSendsMarkdownPayload(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	withDingTalkConfig(t, func() {
		config.DingTalkWebhook = server.URL
		config.DingTalkTitle = "WA 预警提醒"

		err := submitDingTalk(context.Background(), "message", webhookPayload("120363@test@g.us", "重要业务提醒：订单异常"))
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
	})

	if received["msgtype"] != "markdown" {
		t.Fatalf("expected markdown msgtype, got %#v", received["msgtype"])
	}
	markdown, ok := received["markdown"].(map[string]any)
	if !ok {
		t.Fatalf("expected markdown object, got %#v", received["markdown"])
	}
	if markdown["title"] != "WA 预警提醒" {
		t.Fatalf("expected title, got %#v", markdown["title"])
	}
	if !strings.Contains(markdown["text"].(string), "重要业务提醒：订单异常") {
		t.Fatalf("expected message body in markdown text, got %s", markdown["text"])
	}
}

func TestBuildDingTalkPayloadUsesBusinessReadableFields(t *testing.T) {
	withDingTalkConfig(t, func() {
		config.DingTalkTitle = "WA 预警提醒"
		payload := buildDingTalkPayload(map[string]any{
			"chat_id":   "120363@test@g.us",
			"chat_name": "测试预警群",
			"from_name": "John",
			"timestamp": "2026-06-02T03:25:02Z",
			"body":      "你可以沟通吗？",
			"id":        "MSG-1",
		})

		text := payload.Markdown.Text
		for _, want := range []string{"群名：", "测试预警群", "发送人：", "John", "时间：", "消息内容：", "你可以沟通吗？"} {
			if !strings.Contains(text, want) {
				t.Fatalf("expected markdown to contain %q, got %s", want, text)
			}
		}
		if strings.Contains(text, "消息ID") || strings.Contains(text, "MSG-1") || strings.Contains(text, "120363@test@g.us") {
			t.Fatalf("expected technical identifiers to be hidden, got %s", text)
		}
	})
}

func TestBuildDingTalkPayloadHidesUnnamedGroupJID(t *testing.T) {
	withDingTalkConfig(t, func() {
		payload := buildDingTalkPayload(map[string]any{
			"chat_id":   "120363@test@g.us",
			"from_name": "John",
			"timestamp": "2026-06-02T03:31:00Z",
			"body":      "这个是新的消息",
		})

		text := payload.Markdown.Text
		if !strings.Contains(text, "未命名群组") {
			t.Fatalf("expected unnamed group fallback, got %s", text)
		}
		if strings.Contains(text, "120363@test@g.us") {
			t.Fatalf("expected group JID to be hidden, got %s", text)
		}
	})
}

func TestBuildDingTalkPayloadIdentifiesImageMessages(t *testing.T) {
	withDingTalkConfig(t, func() {
		plainImage := buildDingTalkPayload(map[string]any{
			"chat_id":   "120363@test@g.us",
			"from_name": "John",
			"timestamp": "2026-06-02T03:31:00Z",
			"image":     "statics/media/photo.jpg",
		})
		if !strings.Contains(plainImage.Markdown.Text, "图片消息") {
			t.Fatalf("expected image summary, got %s", plainImage.Markdown.Text)
		}
		if strings.Contains(plainImage.Markdown.Text, "unsupported") {
			t.Fatalf("expected image message not unsupported, got %s", plainImage.Markdown.Text)
		}

		captionedImage := buildDingTalkPayload(map[string]any{
			"chat_id":   "120363@test@g.us",
			"from_name": "John",
			"timestamp": "2026-06-02T03:31:00Z",
			"image": map[string]any{
				"path":    "statics/media/photo.jpg",
				"caption": "这是一张付款凭证",
			},
		})
		if !strings.Contains(captionedImage.Markdown.Text, "图片消息：这是一张付款凭证") {
			t.Fatalf("expected image caption summary, got %s", captionedImage.Markdown.Text)
		}
	})
}

func TestUnnamedGroupLabelIncludesMemberCount(t *testing.T) {
	if got := unnamedGroupLabel(2); got != "未命名群组（2 位成员）" {
		t.Fatalf("unexpected label: %s", got)
	}
	if got := unnamedGroupLabel(0); got != "未命名群组" {
		t.Fatalf("unexpected label: %s", got)
	}
}

func TestDingTalkTimeWindows(t *testing.T) {
	now := time.Date(2026, 6, 2, 10, 30, 0, 0, time.Local)
	if !isDingTalkWithinTimeWindows(now, nil) {
		t.Fatal("expected empty windows to allow notifications")
	}
	if !isDingTalkWithinTimeWindows(now, []string{"09:00-18:00"}) {
		t.Fatal("expected current time inside daytime window")
	}
	if isDingTalkWithinTimeWindows(now, []string{"11:00-18:00"}) {
		t.Fatal("expected current time outside window")
	}
	if !isDingTalkWithinTimeWindows(time.Date(2026, 6, 2, 23, 30, 0, 0, time.Local), []string{"22:00-08:00"}) {
		t.Fatal("expected cross-midnight window to include late night")
	}
	if !isDingTalkWithinTimeWindows(time.Date(2026, 6, 2, 7, 30, 0, 0, time.Local), []string{"22:00-08:00"}) {
		t.Fatal("expected cross-midnight window to include early morning")
	}
	if isDingTalkWithinTimeWindows(now, []string{"bad-window"}) {
		t.Fatal("expected invalid-only windows to block notifications")
	}
}

func webhookPayload(chatID, body string) map[string]any {
	return map[string]any{
		"event":     "message",
		"device_id": "628000@s.whatsapp.net",
		"payload": map[string]any{
			"id":        "MSG-1",
			"chat_id":   chatID,
			"from":      "628111@s.whatsapp.net",
			"from_name": "Alice",
			"timestamp": "2026-06-01T12:00:00Z",
			"body":      body,
		},
	}
}

func withDingTalkConfig(t *testing.T, fn func()) {
	t.Helper()

	originalEnabled := config.DingTalkEnabled
	originalWebhook := config.DingTalkWebhook
	originalSecret := config.DingTalkSecret
	originalKeywords := config.DingTalkKeywords
	originalGroups := config.DingTalkGroups
	originalOnlyGroups := config.DingTalkOnlyGroups
	originalTitle := config.DingTalkTitle
	originalAtMobiles := config.DingTalkAtMobiles
	originalAtAll := config.DingTalkAtAll
	originalTimeWindows := config.DingTalkTimeWindows

	defer func() {
		config.DingTalkEnabled = originalEnabled
		config.DingTalkWebhook = originalWebhook
		config.DingTalkSecret = originalSecret
		config.DingTalkKeywords = originalKeywords
		config.DingTalkGroups = originalGroups
		config.DingTalkOnlyGroups = originalOnlyGroups
		config.DingTalkTitle = originalTitle
		config.DingTalkAtMobiles = originalAtMobiles
		config.DingTalkAtAll = originalAtAll
		config.DingTalkTimeWindows = originalTimeWindows
	}()

	config.DingTalkEnabled = false
	config.DingTalkWebhook = ""
	config.DingTalkSecret = ""
	config.DingTalkKeywords = nil
	config.DingTalkGroups = nil
	config.DingTalkOnlyGroups = true
	config.DingTalkTitle = "WA 预警提醒"
	config.DingTalkAtMobiles = nil
	config.DingTalkAtAll = false
	config.DingTalkTimeWindows = nil

	fn()
}
