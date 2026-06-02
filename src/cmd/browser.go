package cmd

import (
	"fmt"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/aldinokemal/go-whatsapp-web-multidevice/config"
	"github.com/sirupsen/logrus"
)

func localWorkbenchURL() string {
	host := strings.TrimSpace(config.AppHost)
	if host == "" || host == "0.0.0.0" || host == "::" || host == "[::]" {
		host = "127.0.0.1"
	}
	basePath := strings.TrimRight(config.AppBasePath, "/")
	return fmt.Sprintf("http://%s:%s%s/", host, config.AppPort, basePath)
}

func openWorkbenchInBrowser() {
	if !config.AppOpenBrowser {
		return
	}

	url := localWorkbenchURL()
	for i := 0; i < 30; i++ {
		resp, err := http.Get(url)
		if err == nil {
			_ = resp.Body.Close()
			break
		}
		time.Sleep(200 * time.Millisecond)
	}

	if err := openBrowser(url); err != nil {
		logrus.Warnf("Failed to open browser for %s: %v", url, err)
		return
	}
	logrus.Infof("Opened local workbench: %s", url)
}

func openBrowser(url string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", url).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}
