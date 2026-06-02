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
	"github.com/sirupsen/logrus"
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
	return len(matchingDingTalkRules(eventName, payload, time.Now())) > 0
}

func submitDingTalk(ctx context.Context, eventName string, payload map[string]any) error {
	message := dingTalkMessagePayload(payload)
	message = enrichDingTalkMessage(ctx, message)

	var firstErr error
	for _, rule := range matchingDingTalkRulesForMessage(eventName, message, time.Now()) {
		err := sendDingTalkPayload(ctx, eventName, buildDingTalkPayloadForRule(message, rule), rule.Webhook, rule.Secret)

		status := dingTalkHistoryStatusSuccess
		errorText := ""
		if err != nil {
			status = dingTalkHistoryStatusFailed
			errorText = err.Error()
			if firstErr == nil {
				firstErr = err
			}
		}
		if recordErr := recordDingTalkForwardHistory(buildDingTalkHistoryEntryForRule(message, rule, status, errorText)); recordErr != nil {
			logrus.Warnf("record dingtalk forward history failed: %v", recordErr)
		}
	}

	return firstErr
}

func matchingDingTalkRules(eventName string, payload map[string]any, now time.Time) []config.DingTalkRule {
	return matchingDingTalkRulesForMessage(eventName, dingTalkMessagePayload(payload), now)
}

func matchingDingTalkRulesForMessage(eventName string, message map[string]any, now time.Time) []config.DingTalkRule {
	if !config.DingTalkEnabled || eventName != EventTypeMessage {
		return nil
	}

	matches := []config.DingTalkRule{}
	for _, rule := range effectiveDingTalkRules() {
		if !rule.Enabled || strings.TrimSpace(rule.Webhook) == "" {
			continue
		}
		if dingTalkRuleMatchesMessage(rule, message, now) {
			matches = append(matches, rule)
		}
	}
	return matches
}

func dingTalkRuleMatchesMessage(rule config.DingTalkRule, message map[string]any, now time.Time) bool {
	chatID := stringFromPayload(message, "chat_id")
	isGroupChat := utils.IsGroupJID(chatID)
	if rule.OnlyGroups && !isGroupChat {
		return false
	}
	if isGroupChat && !matchesAnyConfiguredValue(chatID, rule.Groups) {
		return false
	}

	body := stringFromPayload(message, "body")
	if body == "" {
		body = extractStructuredMessageContent(message)
	}
	if !containsAnyKeyword(body, rule.Keywords) {
		return false
	}
	if !isDingTalkWithinTimeWindows(now, rule.TimeWindows) {
		return false
	}

	return true
}

func effectiveDingTalkRules() []config.DingTalkRule {
	if len(config.DingTalkRules) > 0 {
		rules := make([]config.DingTalkRule, 0, len(config.DingTalkRules))
		for _, rule := range config.DingTalkRules {
			rules = append(rules, normalizeDingTalkRule(rule))
		}
		return rules
	}

	if strings.TrimSpace(config.DingTalkWebhook) == "" {
		return nil
	}
	return []config.DingTalkRule{normalizeDingTalkRule(config.DingTalkRule{
		ID:            "default",
		Name:          "默认规则",
		Enabled:       true,
		Webhook:       config.DingTalkWebhook,
		WebhookAlias:  config.DingTalkWebhookAlias,
		Secret:        config.DingTalkSecret,
		Keywords:      config.DingTalkKeywords,
		Groups:        config.DingTalkGroups,
		OnlyGroups:    config.DingTalkOnlyGroups,
		Title:         config.DingTalkTitle,
		AtMobiles:     config.DingTalkAtMobiles,
		AtAll:         config.DingTalkAtAll,
		MaxBodyLength: config.DingTalkMaxBodyLength,
		TimeWindows:   config.DingTalkTimeWindows,
	})}
}

func normalizeDingTalkRule(rule config.DingTalkRule) config.DingTalkRule {
	if strings.TrimSpace(rule.ID) == "" {
		rule.ID = fmt.Sprintf("rule-%d", time.Now().UnixNano())
	}
	if strings.TrimSpace(rule.Name) == "" {
		rule.Name = "未命名规则"
	}
	if strings.TrimSpace(rule.Title) == "" {
		rule.Title = "WA 预警提醒"
	}
	if rule.MaxBodyLength <= 0 {
		rule.MaxBodyLength = 500
	}
	return rule
}

func SendDingTalkTest(ctx context.Context) error {
	for _, rule := range effectiveDingTalkRules() {
		if strings.TrimSpace(rule.Webhook) != "" {
			return SendDingTalkTestForRule(ctx, rule)
		}
	}
	return SendDingTalkTestForRule(ctx, config.DingTalkRule{
		Title:         config.DingTalkTitle,
		Webhook:       config.DingTalkWebhook,
		Secret:        config.DingTalkSecret,
		AtMobiles:     config.DingTalkAtMobiles,
		AtAll:         config.DingTalkAtAll,
		MaxBodyLength: config.DingTalkMaxBodyLength,
	})
}

func SendDingTalkTestForRule(ctx context.Context, rule config.DingTalkRule) error {
	rule = normalizeDingTalkRule(rule)
	title := strings.TrimSpace(rule.Title)
	if title == "" {
		title = "WA 预警提醒"
	}

	payload := dingTalkPayload{
		MsgType: "markdown",
		Markdown: dingTalkMarkdown{
			Title: title,
			Text: fmt.Sprintf("### %s\n\n保存前校验消息已发送成功。\n\n- 规则: %s\n- 机器人: %s\n- 时间: %s",
				title,
				escapeMarkdownInline(rule.Name),
				escapeMarkdownInline(firstNonEmpty(rule.WebhookAlias, "未命名机器人")),
				time.Now().Format(time.RFC3339),
			),
		},
		At: dingTalkAtRecipient{
			AtMobiles: cleanStringSlice(rule.AtMobiles),
			IsAtAll:   rule.AtAll,
		},
	}

	return sendDingTalkPayload(ctx, "dingtalk.test", payload, rule.Webhook, rule.Secret)
}

func sendDingTalkPayload(ctx context.Context, eventName string, payload dingTalkPayload, webhook, secret string) error {
	if strings.TrimSpace(webhook) == "" {
		return fmt.Errorf("dingtalk webhook is not configured")
	}

	postBody, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal dingtalk payload: %w", err)
	}

	requestURL, err := buildDingTalkWebhookURL(webhook, secret, time.Now().UnixMilli())
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
	return buildDingTalkPayloadForRule(message, normalizeDingTalkRule(config.DingTalkRule{
		Title:         config.DingTalkTitle,
		AtMobiles:     config.DingTalkAtMobiles,
		AtAll:         config.DingTalkAtAll,
		MaxBodyLength: config.DingTalkMaxBodyLength,
	}))
}

func buildDingTalkPayloadForRule(message map[string]any, rule config.DingTalkRule) dingTalkPayload {
	title := strings.TrimSpace(rule.Title)
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
	body = truncateRunes(body, rule.MaxBodyLength)

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
			AtMobiles: cleanStringSlice(rule.AtMobiles),
			IsAtAll:   rule.AtAll,
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
