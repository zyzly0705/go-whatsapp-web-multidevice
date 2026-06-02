package rest

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/aldinokemal/go-whatsapp-web-multidevice/config"
	"github.com/aldinokemal/go-whatsapp-web-multidevice/infrastructure/whatsapp"
	"github.com/aldinokemal/go-whatsapp-web-multidevice/pkg/utils"
	"github.com/gofiber/fiber/v2"
)

type DingTalkConfig struct{}

type dingTalkConfigResponse struct {
	Enabled           bool                   `json:"enabled"`
	ConfigPath        string                 `json:"config_path"`
	WebhookConfigured bool                   `json:"webhook_configured"`
	WebhookAlias      string                 `json:"webhook_alias"`
	WebhookPreview    string                 `json:"webhook_preview"`
	SecretConfigured  bool                   `json:"secret_configured"`
	Keywords          []string               `json:"keywords"`
	Groups            []string               `json:"groups"`
	OnlyGroups        bool                   `json:"only_groups"`
	Title             string                 `json:"title"`
	AtMobiles         []string               `json:"at_mobiles"`
	AtAll             bool                   `json:"at_all"`
	MaxBodyLength     int                    `json:"max_body_length"`
	TimeWindows       []string               `json:"time_windows"`
	Rules             []dingTalkRuleResponse `json:"rules"`
}

type dingTalkRuleResponse struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Enabled           bool     `json:"enabled"`
	WebhookConfigured bool     `json:"webhook_configured"`
	WebhookAlias      string   `json:"webhook_alias"`
	WebhookPreview    string   `json:"webhook_preview"`
	SecretConfigured  bool     `json:"secret_configured"`
	Keywords          []string `json:"keywords"`
	Groups            []string `json:"groups"`
	OnlyGroups        bool     `json:"only_groups"`
	Title             string   `json:"title"`
	AtMobiles         []string `json:"at_mobiles"`
	AtAll             bool     `json:"at_all"`
	MaxBodyLength     int      `json:"max_body_length"`
	TimeWindows       []string `json:"time_windows"`
}

type waSentinelConfigFile struct {
	Version        int                   `json:"version"`
	DingTalkOn     bool                  `json:"dingtalk_enabled"`
	DingTalkRules  []config.DingTalkRule `json:"dingtalk_rules"`
	UpdatedMessage string                `json:"updated_message,omitempty"`
}

func InitRestDingTalkConfig(app fiber.Router) DingTalkConfig {
	rest := DingTalkConfig{}
	_ = loadWaSentinelConfig()
	app.Get("/dingtalk/config", rest.GetConfig)
	app.Post("/dingtalk/config", rest.UpdateConfig)
	app.Post("/dingtalk/test", rest.SendTest)
	app.Get("/dingtalk/history", rest.GetHistory)
	return rest
}

func (handler DingTalkConfig) GetConfig(c *fiber.Ctx) error {
	return c.JSON(utils.ResponseData{
		Status:  200,
		Code:    "SUCCESS",
		Message: "DingTalk config",
		Results: dingTalkConfigSnapshot(),
	})
}

func (handler DingTalkConfig) UpdateConfig(c *fiber.Ctx) error {
	var body map[string]json.RawMessage
	if err := json.Unmarshal(c.Body(), &body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ResponseData{
			Status:  400,
			Code:    "BAD_REQUEST",
			Message: "Invalid request body",
			Results: nil,
		})
	}

	if value, ok := rawBool(body, "enabled"); ok {
		config.DingTalkEnabled = value
	}
	if value, ok := rawString(body, "webhook"); ok && value != "" {
		config.DingTalkWebhook = value
	}
	if value, ok := rawString(body, "webhook_alias"); ok {
		config.DingTalkWebhookAlias = value
	}
	if value, ok := rawBool(body, "clear_webhook"); ok && value {
		config.DingTalkWebhook = ""
		config.DingTalkWebhookAlias = ""
	}
	if value, ok := rawString(body, "secret"); ok && value != "" {
		config.DingTalkSecret = value
	}
	if value, ok := rawBool(body, "clear_secret"); ok && value {
		config.DingTalkSecret = ""
	}
	if value, ok := rawStringSlice(body, "keywords"); ok {
		config.DingTalkKeywords = value
	}
	if value, ok := rawStringSlice(body, "groups"); ok {
		config.DingTalkGroups = value
	}
	if value, ok := rawBool(body, "only_groups"); ok {
		config.DingTalkOnlyGroups = value
	}
	if value, ok := rawString(body, "title"); ok {
		config.DingTalkTitle = value
	}
	if value, ok := rawStringSlice(body, "at_mobiles"); ok {
		config.DingTalkAtMobiles = value
	}
	if value, ok := rawBool(body, "at_all"); ok {
		config.DingTalkAtAll = value
	}
	if value, ok := rawInt(body, "max_body_length"); ok && value >= 0 {
		config.DingTalkMaxBodyLength = value
	}
	if value, ok := rawStringSlice(body, "time_windows"); ok {
		config.DingTalkTimeWindows = value
	}
	if value, ok := rawDingTalkRules(body, "rules"); ok {
		config.DingTalkRules = normalizeDingTalkRules(mergeDingTalkRulesWithSavedSecrets(value))
		syncLegacyDingTalkGlobalsFromRules()
	} else if len(config.DingTalkRules) == 0 && touchedLegacyDingTalkConfig(body) {
		config.DingTalkRules = normalizeDingTalkRules([]config.DingTalkRule{legacyDingTalkRuleFromGlobals()})
	}

	if err := persistWaSentinelConfig(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ResponseData{
			Status:  500,
			Code:    "DINGTALK_CONFIG_SAVE_FAILED",
			Message: err.Error(),
			Results: dingTalkConfigSnapshot(),
		})
	}

	return c.JSON(utils.ResponseData{
		Status:  200,
		Code:    "SUCCESS",
		Message: "DingTalk config updated",
		Results: dingTalkConfigSnapshot(),
	})
}

func (handler DingTalkConfig) SendTest(c *fiber.Ctx) error {
	var body struct {
		Rule   *config.DingTalkRule `json:"rule"`
		RuleID string               `json:"rule_id"`
	}
	if len(c.Body()) > 0 {
		_ = json.Unmarshal(c.Body(), &body)
	}

	var err error
	if body.Rule != nil {
		rule := normalizeDingTalkRules(mergeDingTalkRulesWithSavedSecrets([]config.DingTalkRule{*body.Rule}))[0]
		err = whatsapp.SendDingTalkTestForRule(c.UserContext(), rule)
	} else if strings.TrimSpace(body.RuleID) != "" {
		err = whatsapp.SendDingTalkTestForRule(c.UserContext(), findDingTalkRuleForTest(body.RuleID))
	} else {
		err = whatsapp.SendDingTalkTest(c.UserContext())
	}

	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(utils.ResponseData{
			Status:  502,
			Code:    "DINGTALK_TEST_FAILED",
			Message: err.Error(),
			Results: dingTalkConfigSnapshot(),
		})
	}

	return c.JSON(utils.ResponseData{
		Status:  200,
		Code:    "SUCCESS",
		Message: "DingTalk test sent",
		Results: dingTalkConfigSnapshot(),
	})
}

func (handler DingTalkConfig) GetHistory(c *fiber.Ctx) error {
	limit := c.QueryInt("limit", 50)
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	return c.JSON(utils.ResponseData{
		Status:  200,
		Code:    "SUCCESS",
		Message: "DingTalk forward history",
		Results: whatsapp.ListDingTalkForwardHistory(limit),
	})
}

func dingTalkConfigSnapshot() dingTalkConfigResponse {
	rules := dingTalkRuleResponses()
	return dingTalkConfigResponse{
		Enabled:           config.DingTalkEnabled,
		ConfigPath:        waSentinelConfigPath(),
		WebhookConfigured: strings.TrimSpace(config.DingTalkWebhook) != "",
		WebhookAlias:      config.DingTalkWebhookAlias,
		WebhookPreview:    maskDingTalkWebhook(config.DingTalkWebhook),
		SecretConfigured:  strings.TrimSpace(config.DingTalkSecret) != "",
		Keywords:          cleanConfigStrings(config.DingTalkKeywords),
		Groups:            cleanConfigStrings(config.DingTalkGroups),
		OnlyGroups:        config.DingTalkOnlyGroups,
		Title:             config.DingTalkTitle,
		AtMobiles:         cleanConfigStrings(config.DingTalkAtMobiles),
		AtAll:             config.DingTalkAtAll,
		MaxBodyLength:     config.DingTalkMaxBodyLength,
		TimeWindows:       cleanConfigStrings(config.DingTalkTimeWindows),
		Rules:             rules,
	}
}

func rawString(body map[string]json.RawMessage, key string) (string, bool) {
	raw, ok := body[key]
	if !ok {
		return "", false
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return strings.TrimSpace(value), true
}

func rawStringSlice(body map[string]json.RawMessage, key string) ([]string, bool) {
	raw, ok := body[key]
	if !ok {
		return nil, false
	}

	var values []string
	if err := json.Unmarshal(raw, &values); err == nil {
		return cleanConfigStrings(values), true
	}

	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, false
	}
	return splitConfigString(value), true
}

func rawBool(body map[string]json.RawMessage, key string) (bool, bool) {
	raw, ok := body[key]
	if !ok {
		return false, false
	}
	var value bool
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, false
	}
	return value, true
}

func rawInt(body map[string]json.RawMessage, key string) (int, bool) {
	raw, ok := body[key]
	if !ok {
		return 0, false
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, false
	}
	return value, true
}

func rawDingTalkRules(body map[string]json.RawMessage, key string) ([]config.DingTalkRule, bool) {
	raw, ok := body[key]
	if !ok {
		return nil, false
	}
	var value []config.DingTalkRule
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, false
	}
	return value, true
}

func splitConfigString(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return cleanConfigStrings(strings.Split(value, ","))
}

func cleanConfigStrings(values []string) []string {
	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			cleaned = append(cleaned, value)
		}
	}
	return cleaned
}

var waSentinelConfigPathOverride string

func waSentinelConfigPath() string {
	if strings.TrimSpace(waSentinelConfigPathOverride) != "" {
		return waSentinelConfigPathOverride
	}
	return filepath.Join(config.PathStorages, "wa-sentinel-config.json")
}

func loadWaSentinelConfig() error {
	content, err := os.ReadFile(waSentinelConfigPath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read wa sentinel config: %w", err)
	}

	var saved waSentinelConfigFile
	if err := json.Unmarshal(content, &saved); err != nil {
		return fmt.Errorf("parse wa sentinel config: %w", err)
	}

	config.DingTalkEnabled = saved.DingTalkOn
	config.DingTalkRules = normalizeDingTalkRules(saved.DingTalkRules)
	syncLegacyDingTalkGlobalsFromRules()
	return nil
}

func persistWaSentinelConfig() error {
	path := waSentinelConfigPath()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("create config folder: %w", err)
	}

	rules := normalizeDingTalkRules(config.DingTalkRules)
	if len(rules) == 0 && touchedAnyLegacyDingTalkConfig() {
		rules = normalizeDingTalkRules([]config.DingTalkRule{legacyDingTalkRuleFromGlobals()})
	}
	config.DingTalkRules = rules

	body, err := json.MarshalIndent(waSentinelConfigFile{
		Version:       1,
		DingTalkOn:    config.DingTalkEnabled,
		DingTalkRules: rules,
	}, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal wa sentinel config: %w", err)
	}
	if err := os.WriteFile(path, body, 0600); err != nil {
		return fmt.Errorf("write wa sentinel config: %w", err)
	}
	return nil
}

func normalizeDingTalkRules(rules []config.DingTalkRule) []config.DingTalkRule {
	cleaned := make([]config.DingTalkRule, 0, len(rules))
	for index, rule := range rules {
		rule.ID = strings.TrimSpace(rule.ID)
		if rule.ID == "" {
			rule.ID = fmt.Sprintf("rule-%d", index+1)
		}
		rule.Name = strings.TrimSpace(rule.Name)
		if rule.Name == "" {
			rule.Name = fmt.Sprintf("规则 %d", index+1)
		}
		rule.Webhook = strings.TrimSpace(rule.Webhook)
		rule.WebhookAlias = strings.TrimSpace(rule.WebhookAlias)
		rule.Secret = strings.TrimSpace(rule.Secret)
		rule.Keywords = cleanConfigStrings(rule.Keywords)
		rule.Groups = cleanConfigStrings(rule.Groups)
		rule.Title = strings.TrimSpace(rule.Title)
		if rule.Title == "" {
			rule.Title = "WA 预警提醒"
		}
		rule.AtMobiles = cleanConfigStrings(rule.AtMobiles)
		if rule.MaxBodyLength <= 0 {
			rule.MaxBodyLength = 500
		}
		rule.TimeWindows = cleanConfigStrings(rule.TimeWindows)
		cleaned = append(cleaned, rule)
	}
	return cleaned
}

func mergeDingTalkRulesWithSavedSecrets(incoming []config.DingTalkRule) []config.DingTalkRule {
	savedByID := make(map[string]config.DingTalkRule, len(config.DingTalkRules))
	for _, saved := range config.DingTalkRules {
		id := strings.TrimSpace(saved.ID)
		if id != "" {
			savedByID[id] = saved
		}
	}

	merged := make([]config.DingTalkRule, 0, len(incoming))
	for _, rule := range incoming {
		if saved, ok := savedByID[strings.TrimSpace(rule.ID)]; ok {
			if strings.TrimSpace(rule.Webhook) == "" {
				rule.Webhook = saved.Webhook
			}
			if strings.TrimSpace(rule.Secret) == "" {
				rule.Secret = saved.Secret
			}
		}
		merged = append(merged, rule)
	}
	return merged
}

func findDingTalkRuleForTest(ruleID string) config.DingTalkRule {
	for _, rule := range normalizeDingTalkRules(config.DingTalkRules) {
		if rule.ID == strings.TrimSpace(ruleID) {
			return rule
		}
	}
	return legacyDingTalkRuleFromGlobals()
}

func dingTalkRuleResponses() []dingTalkRuleResponse {
	rules := normalizeDingTalkRules(config.DingTalkRules)
	if len(rules) == 0 && strings.TrimSpace(config.DingTalkWebhook) != "" {
		rules = normalizeDingTalkRules([]config.DingTalkRule{legacyDingTalkRuleFromGlobals()})
	}

	responses := make([]dingTalkRuleResponse, 0, len(rules))
	for _, rule := range rules {
		responses = append(responses, dingTalkRuleResponse{
			ID:                rule.ID,
			Name:              rule.Name,
			Enabled:           rule.Enabled,
			WebhookConfigured: strings.TrimSpace(rule.Webhook) != "",
			WebhookAlias:      rule.WebhookAlias,
			WebhookPreview:    maskDingTalkWebhook(rule.Webhook),
			SecretConfigured:  strings.TrimSpace(rule.Secret) != "",
			Keywords:          cleanConfigStrings(rule.Keywords),
			Groups:            cleanConfigStrings(rule.Groups),
			OnlyGroups:        rule.OnlyGroups,
			Title:             rule.Title,
			AtMobiles:         cleanConfigStrings(rule.AtMobiles),
			AtAll:             rule.AtAll,
			MaxBodyLength:     rule.MaxBodyLength,
			TimeWindows:       cleanConfigStrings(rule.TimeWindows),
		})
	}
	return responses
}

func legacyDingTalkRuleFromGlobals() config.DingTalkRule {
	return config.DingTalkRule{
		ID:            "default",
		Name:          firstNonEmptyConfig(config.DingTalkWebhookAlias, "默认钉钉规则"),
		Enabled:       true,
		Webhook:       config.DingTalkWebhook,
		WebhookAlias:  config.DingTalkWebhookAlias,
		Secret:        config.DingTalkSecret,
		Keywords:      cleanConfigStrings(config.DingTalkKeywords),
		Groups:        cleanConfigStrings(config.DingTalkGroups),
		OnlyGroups:    config.DingTalkOnlyGroups,
		Title:         config.DingTalkTitle,
		AtMobiles:     cleanConfigStrings(config.DingTalkAtMobiles),
		AtAll:         config.DingTalkAtAll,
		MaxBodyLength: config.DingTalkMaxBodyLength,
		TimeWindows:   cleanConfigStrings(config.DingTalkTimeWindows),
	}
}

func syncLegacyDingTalkGlobalsFromRules() {
	if len(config.DingTalkRules) == 0 {
		return
	}
	rule := normalizeDingTalkRules(config.DingTalkRules)[0]
	config.DingTalkWebhook = rule.Webhook
	config.DingTalkWebhookAlias = rule.WebhookAlias
	config.DingTalkSecret = rule.Secret
	config.DingTalkKeywords = rule.Keywords
	config.DingTalkGroups = rule.Groups
	config.DingTalkOnlyGroups = rule.OnlyGroups
	config.DingTalkTitle = rule.Title
	config.DingTalkAtMobiles = rule.AtMobiles
	config.DingTalkAtAll = rule.AtAll
	config.DingTalkMaxBodyLength = rule.MaxBodyLength
	config.DingTalkTimeWindows = rule.TimeWindows
}

func touchedLegacyDingTalkConfig(body map[string]json.RawMessage) bool {
	for _, key := range []string{"webhook", "webhook_alias", "secret", "keywords", "groups", "only_groups", "title", "at_mobiles", "at_all", "max_body_length", "time_windows"} {
		if _, ok := body[key]; ok {
			return true
		}
	}
	return false
}

func touchedAnyLegacyDingTalkConfig() bool {
	return strings.TrimSpace(config.DingTalkWebhook) != "" ||
		strings.TrimSpace(config.DingTalkWebhookAlias) != "" ||
		strings.TrimSpace(config.DingTalkSecret) != "" ||
		len(config.DingTalkKeywords) > 0 ||
		len(config.DingTalkGroups) > 0
}

func firstNonEmptyConfig(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func persistDingTalkEnv(path string) error {
	values := map[string]string{
		"DINGTALK_ENABLED":         strconv.FormatBool(config.DingTalkEnabled),
		"DINGTALK_WEBHOOK":         config.DingTalkWebhook,
		"DINGTALK_WEBHOOK_ALIAS":   config.DingTalkWebhookAlias,
		"DINGTALK_SECRET":          config.DingTalkSecret,
		"DINGTALK_KEYWORDS":        strings.Join(cleanConfigStrings(config.DingTalkKeywords), ","),
		"DINGTALK_GROUPS":          strings.Join(cleanConfigStrings(config.DingTalkGroups), ","),
		"DINGTALK_ONLY_GROUPS":     strconv.FormatBool(config.DingTalkOnlyGroups),
		"DINGTALK_TITLE":           config.DingTalkTitle,
		"DINGTALK_AT_MOBILES":      strings.Join(cleanConfigStrings(config.DingTalkAtMobiles), ","),
		"DINGTALK_AT_ALL":          strconv.FormatBool(config.DingTalkAtAll),
		"DINGTALK_MAX_BODY_LENGTH": strconv.Itoa(config.DingTalkMaxBodyLength),
		"DINGTALK_TIME_WINDOWS":    strings.Join(cleanConfigStrings(config.DingTalkTimeWindows), ","),
	}

	content, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read .env: %w", err)
	}

	lines := []string{}
	if len(content) > 0 {
		lines = strings.Split(strings.ReplaceAll(string(content), "\r\n", "\n"), "\n")
	}

	seen := make(map[string]bool, len(values))
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || !strings.Contains(trimmed, "=") {
			continue
		}
		key := strings.TrimSpace(strings.SplitN(trimmed, "=", 2)[0])
		if value, ok := values[key]; ok {
			lines[i] = key + "=" + value
			seen[key] = true
		}
	}

	if len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) != "" {
		lines = append(lines, "")
	}
	for _, key := range []string{
		"DINGTALK_ENABLED",
		"DINGTALK_WEBHOOK",
		"DINGTALK_WEBHOOK_ALIAS",
		"DINGTALK_SECRET",
		"DINGTALK_KEYWORDS",
		"DINGTALK_GROUPS",
		"DINGTALK_ONLY_GROUPS",
		"DINGTALK_TITLE",
		"DINGTALK_AT_MOBILES",
		"DINGTALK_AT_ALL",
		"DINGTALK_MAX_BODY_LENGTH",
		"DINGTALK_TIME_WINDOWS",
	} {
		if !seen[key] {
			lines = append(lines, key+"="+values[key])
		}
	}

	next := strings.Join(lines, "\n")
	if !strings.HasSuffix(next, "\n") {
		next += "\n"
	}
	if err := os.WriteFile(path, []byte(next), 0600); err != nil {
		return fmt.Errorf("write .env: %w", err)
	}
	return nil
}

func maskDingTalkWebhook(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return ""
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return maskSecretLike(rawURL)
	}

	query := parsed.Query()
	if token := query.Get("access_token"); token != "" {
		query.Set("access_token", maskSecretLike(token))
		parsed.RawQuery = query.Encode()
		return parsed.String()
	}

	return parsed.Scheme + "://" + parsed.Host + parsed.Path
}

func maskSecretLike(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 8 {
		return "********"
	}
	return value[:4] + "..." + value[len(value)-4:]
}
