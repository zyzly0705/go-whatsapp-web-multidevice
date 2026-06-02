package whatsapp

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aldinokemal/go-whatsapp-web-multidevice/config"
	"github.com/aldinokemal/go-whatsapp-web-multidevice/pkg/utils"
	"go.mau.fi/whatsmeow/types"
)

type dingTalkPayload struct {
	MsgType  string              `json:"msgtype"`
	Markdown dingTalkMarkdown    `json:"markdown"`
	At       dingTalkAtRecipient `json:"at,omitempty"`
}

type dingTalkMarkdown struct {
	Title string `json:"title"`
	Text  string `json:"text"`
}

type dingTalkAtRecipient struct {
	AtMobiles []string `json:"atMobiles,omitempty"`
	IsAtAll   bool     `json:"isAtAll,omitempty"`
}

func shouldForwardToDingTalk(eventName string, payload map[string]any) bool {
	if !config.DingTalkEnabled || config.DingTalkWebhook == "" || eventName != EventTypeMessage {
		return false
	}

	message := dingTalkMessagePayload(payload)
	chatID := stringFromPayload(message, "chat_id")
	isGroupChat := utils.IsGroupJID(chatID)
	if config.DingTalkOnlyGroups && !isGroupChat {
		return false
	}
	if isGroupChat && !matchesAnyConfiguredValue(chatID, config.DingTalkGroups) {
		return false
	}

	body := stringFromPayload(message, "body")
	if body == "" {
		body = extractStructuredMessageContent(message)
	}
	if !containsAnyKeyword(body, config.DingTalkKeywords) {
		return false
	}
	if !isDingTalkWithinTimeWindows(time.Now(), config.DingTalkTimeWindows) {
		return false
	}

	return true
}

func submitDingTalk(ctx context.Context, eventName string, payload map[string]any) error {
	message := dingTalkMessagePayload(payload)
	message = enrichDingTalkMessage(ctx, message)
	return sendDingTalkPayload(ctx, eventName, buildDingTalkPayload(message))
}

func SendDingTalkTest(ctx context.Context) error {
	title := strings.TrimSpace(config.DingTalkTitle)
	if title == "" {
		title = "WA 预警提醒"
	}

	payload := dingTalkPayload{
		MsgType: "markdown",
		Markdown: dingTalkMarkdown{
			Title: title,
			Text: fmt.Sprintf("### %s\n\nGOWA DingTalk test message.\n\n- 时间: %s\n- 来源: GOWA runtime config",
				title,
				time.Now().Format(time.RFC3339),
			),
		},
		At: dingTalkAtRecipient{
			AtMobiles: cleanStringSlice(config.DingTalkAtMobiles),
			IsAtAll:   config.DingTalkAtAll,
		},
	}

	return sendDingTalkPayload(ctx, "dingtalk.test", payload)
}

func sendDingTalkPayload(ctx context.Context, eventName string, payload dingTalkPayload) error {
	if strings.TrimSpace(config.DingTalkWebhook) == "" {
		return fmt.Errorf("dingtalk webhook is not configured")
	}

	postBody, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal dingtalk payload: %w", err)
	}

	requestURL, err := buildDingTalkWebhookURL(config.DingTalkWebhook, config.DingTalkSecret, time.Now().UnixMilli())
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewBuffer(postBody))
	if err != nil {
		return fmt.Errorf("create dingtalk request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("submit dingtalk %s: %w", eventName, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("dingtalk returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	return nil
}

func buildDingTalkWebhookURL(rawURL, secret string, timestamp int64) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("parse dingtalk webhook url: %w", err)
	}
	if strings.TrimSpace(secret) == "" {
		return parsed.String(), nil
	}

	stringToSign := fmt.Sprintf("%d\n%s", timestamp, secret)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(stringToSign))
	sign := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	query := parsed.Query()
	query.Set("timestamp", fmt.Sprintf("%d", timestamp))
	query.Set("sign", sign)
	parsed.RawQuery = query.Encode()

	return parsed.String(), nil
}

func buildDingTalkPayload(message map[string]any) dingTalkPayload {
	title := strings.TrimSpace(config.DingTalkTitle)
	if title == "" {
		title = "WA 预警提醒"
	}

	body := stringFromPayload(message, "body")
	if body == "" {
		body = extractStructuredMessageContent(message)
	}
	if body == "" {
		body = "(unsupported message type)"
	}
	body = truncateRunes(body, config.DingTalkMaxBodyLength)

	text := fmt.Sprintf("### %s\n\n**群名：** %s\n\n**发送人：** %s\n\n**时间：** %s\n\n**消息内容：**\n\n> %s",
		title,
		escapeMarkdownText(dingTalkChatLabel(message)),
		escapeMarkdownText(firstNonEmpty(stringFromPayload(message, "from_name"), stringFromPayload(message, "from"))),
		escapeMarkdownText(formatDingTalkTimestamp(stringFromPayload(message, "timestamp"))),
		escapeMarkdownText(body),
	)

	return dingTalkPayload{
		MsgType: "markdown",
		Markdown: dingTalkMarkdown{
			Title: title,
			Text:  text,
		},
		At: dingTalkAtRecipient{
			AtMobiles: cleanStringSlice(config.DingTalkAtMobiles),
			IsAtAll:   config.DingTalkAtAll,
		},
	}
}

func dingTalkMessagePayload(payload map[string]any) map[string]any {
	if nested, ok := payload["payload"].(map[string]any); ok {
		return nested
	}
	return payload
}

func enrichDingTalkMessage(ctx context.Context, message map[string]any) map[string]any {
	chatID := stringFromPayload(message, "chat_id")
	if chatID == "" || stringFromPayload(message, "chat_name") != "" || stringFromPayload(message, "group_name") != "" {
		return message
	}
	if !utils.IsGroupJID(chatID) {
		return message
	}

	if groupName := getDingTalkGroupDisplayName(ctx, chatID); strings.TrimSpace(groupName) != "" {
		message["chat_name"] = groupName
	}
	return message
}

func dingTalkChatLabel(message map[string]any) string {
	if label := firstNonEmpty(stringFromPayload(message, "chat_name"), stringFromPayload(message, "group_name")); label != "-" {
		return label
	}
	chatID := stringFromPayload(message, "chat_id")
	if utils.IsGroupJID(chatID) {
		return unnamedGroupLabel(0)
	}
	return firstNonEmpty(chatID)
}

func getDingTalkGroupDisplayName(ctx context.Context, groupJID string) string {
	if name, ok := getCachedGroupName(groupJID); ok && strings.TrimSpace(name) != "" {
		return name
	}

	client := ClientFromContext(ctx)
	if client == nil {
		client = GetClient()
	}
	if client == nil {
		return unnamedGroupLabel(0)
	}

	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return unnamedGroupLabel(0)
	}

	freshCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	groupInfo, err := client.GetGroupInfo(freshCtx, jid)
	if err != nil || groupInfo == nil {
		return unnamedGroupLabel(0)
	}

	if strings.TrimSpace(groupInfo.Name) != "" {
		setCachedGroupName(groupJID, groupInfo.Name)
		return groupInfo.Name
	}

	label := unnamedGroupLabel(len(groupInfo.Participants))
	setCachedGroupName(groupJID, label)
	return label
}

func stringFromPayload(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return strings.TrimSpace(value)
}

func containsAnyKeyword(body string, keywords []string) bool {
	cleaned := cleanStringSlice(keywords)
	if len(cleaned) == 0 {
		return true
	}

	lowerBody := strings.ToLower(body)
	for _, keyword := range cleaned {
		if strings.Contains(lowerBody, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

func matchesAnyConfiguredValue(value string, allowed []string) bool {
	cleaned := cleanStringSlice(allowed)
	if len(cleaned) == 0 {
		return true
	}
	for _, candidate := range cleaned {
		if strings.EqualFold(value, candidate) {
			return true
		}
	}
	return false
}

func cleanStringSlice(values []string) []string {
	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			cleaned = append(cleaned, value)
		}
	}
	return cleaned
}

func truncateRunes(value string, max int) string {
	if max <= 0 || utf8.RuneCountInString(value) <= max {
		return value
	}

	runes := []rune(value)
	return string(runes[:max]) + "..."
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return "-"
}

func unnamedGroupLabel(memberCount int) string {
	if memberCount > 0 {
		return fmt.Sprintf("未命名群组（%d 位成员）", memberCount)
	}
	return "未命名群组"
}

func isDingTalkWithinTimeWindows(now time.Time, windows []string) bool {
	cleaned := cleanStringSlice(windows)
	if len(cleaned) == 0 {
		return true
	}

	currentMinute := now.Local().Hour()*60 + now.Local().Minute()
	for _, window := range cleaned {
		start, end, ok := parseDingTalkTimeWindow(window)
		if !ok {
			continue
		}
		if start == end {
			return true
		}
		if end > start && currentMinute >= start && currentMinute < end {
			return true
		}
		if end < start && (currentMinute >= start || currentMinute < end) {
			return true
		}
	}
	return false
}

func parseDingTalkTimeWindow(value string) (int, int, bool) {
	parts := strings.Split(strings.TrimSpace(value), "-")
	if len(parts) != 2 {
		return 0, 0, false
	}

	start, ok := parseDingTalkClock(parts[0])
	if !ok {
		return 0, 0, false
	}
	end, ok := parseDingTalkClock(parts[1])
	if !ok {
		return 0, 0, false
	}
	return start, end, true
}

func parseDingTalkClock(value string) (int, bool) {
	parsed, err := time.Parse("15:04", strings.TrimSpace(value))
	if err != nil {
		return 0, false
	}
	return parsed.Hour()*60 + parsed.Minute(), true
}

func formatDingTalkTimestamp(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "-"
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return value
	}
	return parsed.Local().Format("2006-01-02 15:04:05")
}

func escapeMarkdownText(value string) string {
	return strings.ReplaceAll(value, "\n", "\n> ")
}

func escapeMarkdownInline(value string) string {
	return strings.ReplaceAll(value, "`", "'")
}
