package usecase

import (
	"testing"
	"time"
)

func TestQRVisibleSecondsKeepsFullWhatsAppTimeout(t *testing.T) {
	got := qrVisibleSeconds(60 * time.Second)
	if got != 60 {
		t.Fatalf("qrVisibleSeconds() = %d, want 60", got)
	}
}

func TestQRVisibleSecondsFallsBackWhenTimeoutMissing(t *testing.T) {
	got := qrVisibleSeconds(0)
	if got != 60 {
		t.Fatalf("qrVisibleSeconds() = %d, want 60", got)
	}
}
