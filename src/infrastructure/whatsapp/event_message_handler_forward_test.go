package whatsapp

import (
	"testing"

	"github.com/aldinokemal/go-whatsapp-web-multidevice/config"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

func TestShouldForwardMessageEventWhenOnlyDingTalkEnabled(t *testing.T) {
	originalWebhooks := config.WhatsappWebhook
	originalChatwootEnabled := config.ChatwootEnabled
	originalDingTalkEnabled := config.DingTalkEnabled
	t.Cleanup(func() {
		config.WhatsappWebhook = originalWebhooks
		config.ChatwootEnabled = originalChatwootEnabled
		config.DingTalkEnabled = originalDingTalkEnabled
	})

	config.WhatsappWebhook = nil
	config.ChatwootEnabled = false
	config.DingTalkEnabled = true

	evt := &events.Message{
		Info: types.MessageInfo{
			MessageSource: types.MessageSource{
				Chat: types.NewJID("120363426091989971", types.GroupServer),
			},
		},
	}

	if !shouldForwardMessageEvent(evt) {
		t.Fatal("expected message forwarding to start when only DingTalk is enabled")
	}
}

func TestShouldForwardMessageEventSkipsBroadcast(t *testing.T) {
	originalDingTalkEnabled := config.DingTalkEnabled
	t.Cleanup(func() {
		config.DingTalkEnabled = originalDingTalkEnabled
	})

	config.DingTalkEnabled = true

	evt := &events.Message{
		Info: types.MessageInfo{
			MessageSource: types.MessageSource{
				Chat: types.NewJID("status", "broadcast"),
			},
		},
	}

	if shouldForwardMessageEvent(evt) {
		t.Fatal("expected broadcast messages to be skipped")
	}
}
