export default {
    name: 'AlertWorkbench',
    data() {
        return {
            devices: [],
            selectedDeviceId: '',
            selectedDevice: null,
            groups: [],
            qrLink: '',
            qrSeconds: 0,
            qrTimer: null,
            deviceStatusTimer: null,
            deviceStatusPolls: 0,
            loadingDevices: false,
            loadingGroups: false,
            loadingHistory: false,
            loggingIn: false,
            loggingOut: false,
            loginError: '',
            loginStatusMessage: '',
            testing: false,
            savingCurrent: false,
            configEnabled: false,
            configPath: '',
            rules: [],
            selectedRuleId: '',
            savedRulePayloads: [],
            dirtyRuleIds: [],
            savingRuleId: '',
            groupSearch: '',
            lastSavedSummary: '',
            forwardHistory: [],
        }
    },
    computed: {
        isLoggedIn() {
            return this.selectedDevice?.state === 'logged_in';
        },
        isConfirmingLoginState() {
            return !this.isLoggedIn && !!this.deviceStatusTimer && this.deviceStatusPolls < 30;
        },
        selectedRule() {
            return this.rules.find(rule => rule.id === this.selectedRuleId) || this.rules[0] || null;
        },
        selectedRuleIndex() {
            return this.rules.findIndex(rule => rule.id === this.selectedRuleId);
        },
        selectedGroupCount() {
            return this.selectedRule?.groups?.length || 0;
        },
        monitorScopeLabel() {
            const groupScope = this.selectedGroupCount > 0 ? `监控 ${this.selectedGroupCount} 个群` : '监控全部群';
            return this.selectedRule?.monitorDirect ? `${groupScope} + 个人消息` : groupScope;
        },
        keywordLabel() {
            const keywords = this.commaList(this.selectedRule?.keywordsText || '');
            return keywords.length > 0 ? keywords.join('、') : '不过滤关键词';
        },
        timeWindowLabel() {
            return this.ruleTimeWindowLabel(this.selectedRule);
        },
        timeOptions() {
            const options = [];
            for (let hour = 0; hour < 24; hour += 1) {
                for (const minute of [0, 15, 30, 45]) {
                    options.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
                }
            }
            return options;
        },
        selectedWebhookStatusLabel() {
            const rule = this.selectedRule;
            if (!rule) return '未配置 Webhook';
            if (rule.webhookConfigured) {
                if (rule.webhookAlias) {
                    return `已保存：${rule.webhookAlias}`;
                }
                return rule.webhookPreview ? `已保存：${rule.webhookPreview}` : 'Webhook 已保存';
            }
            return '未配置 Webhook';
        },
        selectedSecretStatusLabel() {
            return this.selectedRule?.secretConfigured ? '加签密钥已保存' : '未配置密钥';
        },
        accountRows() {
            return [
                { label: '账号名称', value: this.selectedDevice?.display_name || '未获取' },
                { label: 'WhatsApp 账号', value: this.selectedDevice?.jid || '未登录' },
                { label: '设备 ID', value: this.selectedDeviceId || '未初始化' },
                { label: '连接状态', value: this.selectedDevice?.state || 'unknown' },
            ];
        },
        loginStateLabel() {
            if (this.isLoggedIn) return '登录成功';
            if (this.isConfirmingLoginState) return '登录中';
            return '未登录';
        },
        loginStateDescription() {
            if (this.isLoggedIn) return '当前账号已连接，可以接收群消息。';
            if (this.isConfirmingLoginState) return this.loginStatusMessage || '等待手机扫码并确认登录。';
            return '程序会自动使用默认设备。';
        },
        visibleGroups() {
            const keyword = this.groupSearch.trim().toLowerCase();
            if (!keyword) return this.groups;
            return this.groups.filter(group => {
                const name = this.groupName(group).toLowerCase();
                const jid = String(group?.JID || '').toLowerCase();
                return name.includes(keyword) || jid.includes(keyword);
            });
        },
    },
    methods: {
        toastSuccess(message) {
            window.showSuccessInfo(message);
        },
        toastError(error, fallback) {
            const message = error?.response?.data?.message || error?.message || fallback;
            window.showErrorInfo(message);
        },
        commaList(value) {
            if (!value) return [];
            return value.split(',').map(item => item.trim()).filter(Boolean);
        },
        safeArray(value) {
            return Array.isArray(value) ? value.filter(Boolean) : [];
        },
        groupName(group) {
            const name = (group?.Name || '').trim();
            if (name) return name;
            const count = group?.Participants?.length || group?.ParticipantCount || 0;
            return count > 0 ? `未命名群组（${count} 位成员）` : '未命名群组';
        },
        groupMemberCount(group) {
            return group?.Participants?.length || group?.ParticipantCount || 0;
        },
        historyStatusLabel(status) {
            return status === 'success' ? '已转发' : '转发失败';
        },
        historyStatusIcon(status) {
            return status === 'success' ? 'check circle icon' : 'exclamation circle icon';
        },
        formatHistoryTime(value) {
            if (!value) return '-';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return value;
            return date.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
            });
        },
        parseTimeWindow(value) {
            const match = String(value || '').match(/^\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s*$/);
            return match ? [match[1], match[2]] : ['00:00', '00:00'];
        },
        setDeviceHeader(deviceId) {
            this.selectedDeviceId = deviceId || '';
            if (this.selectedDeviceId) {
                window.http.defaults.headers.common[window.DEVICE_ID_HEADER] = encodeURIComponent(this.selectedDeviceId);
            } else {
                delete window.http.defaults.headers.common[window.DEVICE_ID_HEADER];
            }
        },
        selectDevice(device) {
            const id = device?.id || device?.device || '';
            if (!id) return;
            const wasLoggedIn = this.isLoggedIn;
            this.selectedDevice = device;
            this.setDeviceHeader(id);
            if (this.selectedDevice?.state === 'logged_in') {
                this.qrLink = '';
                this.qrSeconds = 0;
                this.loginError = '';
                this.loginStatusMessage = '登录成功';
                this.stopDeviceStatusPolling();
                if (!wasLoggedIn) {
                    this.toastSuccess('WhatsApp 登录成功');
                }
                this.fetchGroups();
            }
        },
        async fetchDevices({ silent = false } = {}) {
            try {
                if (!silent) {
                    this.loadingDevices = true;
                }
                const response = await window.http.get('/devices');
                this.devices = response.data?.results || [];
                if (this.devices.length === 0) {
                    await this.createDevice();
                    return;
                }
                if (!this.selectedDeviceId && this.devices.length > 0) {
                    this.selectDevice(this.devices[0]);
                } else if (this.selectedDeviceId) {
                    const device = this.devices.find(device => (device.id || device.device) === this.selectedDeviceId);
                    if (device) {
                        this.selectDevice(device);
                    }
                }
            } catch (error) {
                if (!silent) {
                    this.toastError(error, '加载设备失败');
                }
            } finally {
                if (!silent) {
                    this.loadingDevices = false;
                }
            }
        },
        startDeviceStatusPolling() {
            this.stopDeviceStatusPolling();
            this.deviceStatusPolls = 0;
            this.loginStatusMessage = '登录中，等待手机扫码并确认。';
            this.deviceStatusTimer = setInterval(async () => {
                this.deviceStatusPolls += 1;
                await this.fetchDevices({ silent: true });
                if (this.isLoggedIn || this.deviceStatusPolls >= 30) {
                    this.stopDeviceStatusPolling();
                    if (!this.isLoggedIn && !this.loginError) {
                        this.loginStatusMessage = '还未登录，请重新获取二维码。';
                    }
                }
            }, 2000);
        },
        stopDeviceStatusPolling() {
            if (this.deviceStatusTimer) {
                clearInterval(this.deviceStatusTimer);
                this.deviceStatusTimer = null;
            }
        },
        async createDevice() {
            try {
                const response = await window.http.post('/devices', {});
                const result = response.data?.results || {};
                const listResponse = await window.http.get('/devices');
                this.devices = listResponse.data?.results || [];
                const id = result.id || result.device_id || result.device;
                const device = this.devices.find(item => (item.id || item.device) === id) || result;
                this.selectDevice(device);
            } catch (error) {
                this.toastError(error, '初始化设备失败');
            }
        },
        stopQrTimer() {
            if (this.qrTimer) {
                clearInterval(this.qrTimer);
                this.qrTimer = null;
            }
        },
        startQrTimer() {
            this.stopQrTimer();
            this.qrTimer = setInterval(() => {
                if (this.qrSeconds > 0) {
                    this.qrSeconds -= 1;
                    return;
                }
                this.stopQrTimer();
            }, 1000);
        },
        loginErrorMessage(error) {
            const serverMessage = error?.response?.data?.message || error?.message || '';
            if (error?.code === 'ECONNABORTED' || /timeout/i.test(serverMessage)) {
                return '生成二维码超时，可能是当前网络无法连接 WhatsApp Web。请检查网络后重新获取。';
            }
            if (/network|fetch|socket|connect/i.test(serverMessage)) {
                return '网络连接异常，暂时无法生成 WhatsApp 二维码。请确认网络可访问 WhatsApp Web。';
            }
            return serverMessage ? `生成二维码失败：${serverMessage}` : '生成二维码失败，请检查网络后重试。';
        },
        async startLogin() {
            await this.fetchDevices({ silent: true });
            if (!this.selectedDeviceId) {
                this.toastError(null, '请先创建或选择设备');
                return;
            }
            if (this.isLoggedIn) {
                this.loginStatusMessage = '登录成功';
                this.toastSuccess('当前设备已经登录');
                return;
            }
            try {
                this.loggingIn = true;
                this.loginError = '';
                this.loginStatusMessage = '正在生成二维码。';
                const response = await window.http.get('/app/login', { timeout: 45000 });
                const result = response.data?.results || {};
                this.qrLink = result.qr_link || '';
                this.qrSeconds = result.qr_duration || 0;
                if (!this.qrLink) {
                    this.loginError = '没有生成二维码。请确认网络可以访问 WhatsApp Web，然后重新获取。';
                    this.loginStatusMessage = '';
                    this.toastError(null, this.loginError);
                    return;
                }
                this.loginStatusMessage = '登录中，等待手机扫码。';
                this.startQrTimer();
                this.startDeviceStatusPolling();
            } catch (error) {
                this.loginError = this.loginErrorMessage(error);
                this.loginStatusMessage = '';
                this.toastError(null, this.loginError);
            } finally {
                this.loggingIn = false;
            }
        },
        async logoutWhatsapp() {
            if (!this.selectedDeviceId || !this.isLoggedIn) return;
            if (!window.confirm('确认退出当前 WhatsApp 账号？退出后需要重新扫码登录。')) {
                return;
            }
            try {
                this.loggingOut = true;
                await window.http.get('/app/logout');
                this.groups = [];
                this.loginStatusMessage = '已退出登录';
                await this.fetchDevices();
                this.toastSuccess('WhatsApp 已退出登录');
            } catch (error) {
                this.toastError(error, 'WhatsApp 退出失败');
            } finally {
                this.loggingOut = false;
            }
        },
        async fetchGroups() {
            if (!this.selectedDeviceId) return;
            try {
                this.loadingGroups = true;
                const response = await window.http.get('/user/my/groups');
                this.groups = response.data?.results?.data || [];
            } catch (error) {
                this.toastError(error, '加载群列表失败。请确认 WhatsApp 已登录。');
            } finally {
                this.loadingGroups = false;
            }
        },
        blankRule(index = 1) {
            return {
                id: `rule-${Date.now()}-${index}`,
                name: `规则 ${index}`,
                enabled: true,
                webhook: '',
                webhookAlias: '',
                webhookConfigured: false,
                webhookPreview: '',
                secret: '',
                secretConfigured: false,
                keywordsText: '',
                groups: [],
                monitorDirect: false,
                title: 'WA 预警提醒',
                atMobilesText: '',
                atAll: false,
                maxBodyLength: 500,
                timeStart: '00:00',
                timeEnd: '00:00',
            };
        },
        ruleFromResponse(rule, index) {
            const [timeStart, timeEnd] = this.parseTimeWindow((rule.time_windows || [])[0] || '00:00-00:00');
            return {
                id: rule.id || `rule-${index + 1}`,
                name: rule.name || `规则 ${index + 1}`,
                enabled: rule.enabled !== false,
                webhook: '',
                webhookAlias: rule.webhook_alias || '',
                webhookConfigured: !!rule.webhook_configured,
                webhookPreview: rule.webhook_preview || '',
                secret: '',
                secretConfigured: !!rule.secret_configured,
                keywordsText: this.safeArray(rule.keywords).join(', '),
                groups: this.safeArray(rule.groups),
                monitorDirect: rule.only_groups === false,
                title: rule.title || 'WA 预警提醒',
                atMobilesText: this.safeArray(rule.at_mobiles).join(', '),
                atAll: !!rule.at_all,
                maxBodyLength: Number.isInteger(rule.max_body_length) ? rule.max_body_length : 500,
                timeStart,
                timeEnd,
            };
        },
        ruleToPayload(rule) {
            const payload = {
                id: rule.id,
                name: (rule.name || '').trim() || '未命名规则',
                enabled: !!rule.enabled,
                webhook_alias: (rule.webhookAlias || '').trim(),
                keywords: this.commaList(rule.keywordsText),
                groups: this.safeArray(rule.groups),
                only_groups: !rule.monitorDirect,
                title: (rule.title || '').trim() || 'WA 预警提醒',
                at_mobiles: this.commaList(rule.atMobilesText),
                at_all: !!rule.atAll,
                max_body_length: Number(rule.maxBodyLength) || 500,
                time_windows: [`${rule.timeStart || '00:00'}-${rule.timeEnd || '00:00'}`],
            };
            if ((rule.webhook || '').trim()) {
                payload.webhook = rule.webhook.trim();
            }
            if ((rule.secret || '').trim()) {
                payload.secret = rule.secret.trim();
            }
            return payload;
        },
        ruleTimeWindowLabel(rule) {
            if (!rule) return '全天通知（00:00 - 00:00）';
            if (rule.timeStart === '00:00' && rule.timeEnd === '00:00') {
                return '全天通知（00:00 - 00:00）';
            }
            return `${rule.timeStart || '00:00'} - ${rule.timeEnd || '00:00'}`;
        },
        ruleKeywordLabel(rule) {
            const keywords = this.commaList(rule?.keywordsText || '');
            return keywords.length > 0 ? keywords.join('、') : '不过滤关键词';
        },
        ruleRobotLabel(rule) {
            if (!rule) return '未配置机器人';
            if (rule.webhookAlias) return rule.webhookAlias;
            if (rule.webhookConfigured) return rule.webhookPreview || 'Webhook 已保存';
            return '未配置机器人';
        },
        markRuleDirty(rule) {
            if (!rule?.id || this.dirtyRuleIds.includes(rule.id)) return;
            this.dirtyRuleIds = [...this.dirtyRuleIds, rule.id];
        },
        isRuleDirty(rule) {
            return !!rule?.id && this.dirtyRuleIds.includes(rule.id);
        },
        clearRuleDirty(ruleID) {
            this.dirtyRuleIds = this.dirtyRuleIds.filter(id => id !== ruleID);
        },
        selectRule(ruleId) {
            this.selectedRuleId = ruleId;
            this.groupSearch = '';
        },
        addRule() {
            const rule = this.blankRule(this.rules.length + 1);
            this.rules.push(rule);
            this.selectedRuleId = rule.id;
            this.lastSavedSummary = '';
            this.markRuleDirty(rule);
        },
        removeSelectedRule() {
            if (!this.selectedRule || this.rules.length <= 1) return;
            if (!window.confirm(`确认删除规则「${this.selectedRule.name}」？保存当前规则后才会写入配置文件。`)) {
                return;
            }
            const removeIndex = this.selectedRuleIndex;
            this.rules = this.rules.filter(rule => rule.id !== this.selectedRuleId);
            const next = this.rules[Math.max(0, removeIndex - 1)] || this.rules[0];
            this.selectedRuleId = next?.id || '';
            this.lastSavedSummary = '规则已从页面移除，点击“校验并保存当前规则”后写入配置文件。';
        },
        setTimeWindow(start, end) {
            if (!this.selectedRule) return;
            this.selectedRule.timeStart = start;
            this.selectedRule.timeEnd = end;
            this.markRuleDirty(this.selectedRule);
        },
        toggleGroup(group) {
            const rule = this.selectedRule;
            const jid = group?.JID;
            if (!rule || !jid) return;
            if (rule.groups.includes(jid)) {
                rule.groups = rule.groups.filter(item => item !== jid);
            } else {
                rule.groups = [...rule.groups, jid];
            }
            this.markRuleDirty(rule);
        },
        selectAllGroups() {
            if (!this.selectedRule) return;
            this.selectedRule.groups = this.groups.map(group => group.JID).filter(Boolean);
            this.markRuleDirty(this.selectedRule);
        },
        clearGroupLimit() {
            if (!this.selectedRule) return;
            this.selectedRule.groups = [];
            this.markRuleDirty(this.selectedRule);
        },
        async fetchConfig() {
            try {
                const response = await window.http.get('/dingtalk/config');
                this.applyConfig(response.data?.results || {});
            } catch (error) {
                this.toastError(error, '加载钉钉配置失败');
            }
        },
        async fetchForwardHistory() {
            try {
                this.loadingHistory = true;
                const response = await window.http.get('/dingtalk/history?limit=50');
                this.forwardHistory = response.data?.results || [];
            } catch (error) {
                this.toastError(error, '加载转发历史失败');
            } finally {
                this.loadingHistory = false;
            }
        },
        applyConfig(config) {
            const previousSelected = this.selectedRuleId;
            this.configEnabled = !!config.enabled;
            this.configPath = config.config_path || '';
            const responseRules = this.safeArray(config.rules);
            this.rules = responseRules.length > 0
                ? responseRules.map((rule, index) => this.ruleFromResponse(rule, index))
                : [this.blankRule(1)];
            this.savedRulePayloads = this.rules.map(rule => this.ruleToPayload(rule));
            this.dirtyRuleIds = [];
            const selectedStillExists = this.rules.some(rule => rule.id === previousSelected);
            this.selectedRuleId = selectedStillExists ? previousSelected : this.rules[0]?.id || '';
        },
        validateRuleForSave(rule) {
            if (!rule) return '请先选择规则';
            if (!rule.name.trim()) return '请填写规则名称';
            if (!rule.webhook.trim() && !rule.webhookConfigured) return '请填写钉钉 Webhook';
            if (!rule.title.trim()) return '请填写通知标题';
            if (!rule.timeStart || !rule.timeEnd) return '请选择完整通知时段';
            return '';
        },
        async testCurrentRule({ silent = false } = {}) {
            const rule = this.selectedRule;
            const error = this.validateRuleForSave(rule);
            if (error) {
                this.toastError(null, error);
                throw new Error(error);
            }
            try {
                this.testing = true;
                await window.http.post('/dingtalk/test', {
                    rule: this.ruleToPayload(rule),
                });
                if (!silent) {
                    this.toastSuccess(`规则「${rule.name}」校验通过，钉钉测试已发送`);
                    await this.fetchForwardHistory();
                }
            } catch (error) {
                this.toastError(error, `规则「${rule.name}」校验失败，配置未保存`);
                throw error;
            } finally {
                this.testing = false;
            }
        },
        async saveCurrentRule() {
            const rule = this.selectedRule;
            if (!rule) return;
            const selectedRuleID = rule.id;
            this.savingCurrent = true;
            this.savingRuleId = selectedRuleID;
            try {
                await this.testCurrentRule({ silent: true });
            } catch (error) {
                this.savingCurrent = false;
                this.savingRuleId = '';
                return;
            }
            try {
                const dirtyDrafts = this.rules
                    .filter(item => item.id !== selectedRuleID && this.isRuleDirty(item))
                    .map(item => ({ ...item, groups: [...item.groups] }));
                const remainingDirtyRuleIds = this.dirtyRuleIds.filter(id => id !== selectedRuleID);
                const selectedPayload = this.ruleToPayload(rule);
                const payloads = [...this.savedRulePayloads];
                const savedIndex = payloads.findIndex(item => item.id === selectedRuleID);
                if (savedIndex >= 0) {
                    payloads.splice(savedIndex, 1, selectedPayload);
                } else {
                    payloads.push(selectedPayload);
                }
                const response = await window.http.post('/dingtalk/config', {
                    enabled: this.configEnabled,
                    rules: payloads,
                });
                const savedPath = response.data?.results?.config_path || this.configPath;
                this.applyConfig(response.data?.results || {});
                for (const draft of dirtyDrafts) {
                    const draftIndex = this.rules.findIndex(item => item.id === draft.id);
                    if (draftIndex >= 0) {
                        this.rules.splice(draftIndex, 1, draft);
                    } else {
                        this.rules.push(draft);
                    }
                }
                this.dirtyRuleIds = remainingDirtyRuleIds;
                this.lastSavedSummary = `已保存当前规则「${rule.name}」${savedPath ? ` 到 ${savedPath}` : ''}`;
                this.clearRuleDirty(selectedRuleID);
                this.toastSuccess(`规则「${rule.name}」已校验并保存`);
                await this.fetchForwardHistory();
            } catch (error) {
                this.toastError(error, '保存当前规则失败');
            } finally {
                this.savingCurrent = false;
                this.savingRuleId = '';
            }
        },
    },
    mounted() {
        Promise.all([this.fetchDevices(), this.fetchConfig(), this.fetchForwardHistory()]).finally(() => {
            document.getElementById('app').style.display = 'block';
            document.getElementById('splash-screen').classList.add('fade-out');
            if (!this.isLoggedIn) {
                this.startDeviceStatusPolling();
            }
        });
    },
    beforeUnmount() {
        this.stopQrTimer();
        this.stopDeviceStatusPolling();
    },
    template: `
    <div class="alert-workbench sentinel-workbench">
        <section class="sentinel-topbar">
            <div>
                <div class="eyebrow">本地 WhatsApp 预警</div>
                <h2>WA Sentinel</h2>
            </div>
            <div class="status-pills">
                <span class="status-pill" :class="{active: isLoggedIn}">{{ isLoggedIn ? 'WhatsApp 已登录' : 'WhatsApp 未登录' }}</span>
                <span class="status-pill" :class="{active: configEnabled}">{{ configEnabled ? '钉钉转发已启用' : '钉钉转发未启用' }}</span>
                <span class="status-pill active">{{ rules.length }} 条规则</span>
            </div>
        </section>

        <div class="sentinel-shell">
            <aside class="sentinel-rail">
                <section class="sentinel-rail-card account-card">
                    <div class="rail-card-header">
                        <span>WhatsApp</span>
                        <strong>{{ loginStateLabel }}</strong>
                    </div>
                    <p>{{ loginStateDescription }}</p>
                    <div class="account-compact-list">
                        <div v-for="row in accountRows" :key="row.label">
                            <span>{{ row.label }}</span>
                            <strong>{{ row.value }}</strong>
                        </div>
                    </div>
                    <div class="button-row" v-if="!isLoggedIn">
                        <button class="ui button" v-if="isConfirmingLoginState" disabled>登录中</button>
                        <button class="ui green button" v-else :class="{loading: loggingIn}" @click="startLogin">获取二维码</button>
                        <button class="ui button" @click="fetchDevices">刷新</button>
                    </div>
                    <div class="button-row" v-else>
                        <button class="ui button" @click="fetchDevices">刷新</button>
                        <button class="ui red button" :class="{loading: loggingOut}" @click="logoutWhatsapp">退出登录</button>
                    </div>
                    <div class="qr-box compact-qr" v-if="!isLoggedIn && qrLink">
                        <img :src="qrLink" alt="WhatsApp 登录二维码">
                        <div>
                            <strong>手机扫码登录</strong>
                            <p>{{ loginStatusMessage || '登录中，等待扫码。' }}</p>
                            <p v-if="qrSeconds > 0">剩余 {{ qrSeconds }} 秒</p>
                            <p v-else>二维码已过期</p>
                        </div>
                    </div>
                    <div class="notice-panel error" v-if="!isLoggedIn && loginError">
                        <strong>二维码生成失败</strong>
                        <span>{{ loginError }}</span>
                    </div>
                </section>

                <section class="sentinel-rail-card">
                    <div class="rail-card-header">
                        <span>转发总开关</span>
                        <strong>{{ configEnabled ? '启用' : '停用' }}</strong>
                    </div>
                    <div class="ui toggle checkbox global-toggle">
                        <input type="checkbox" v-model="configEnabled">
                        <label>{{ configEnabled ? '命中规则后会转发' : '所有规则暂不转发' }}</label>
                    </div>
                    <small>{{ configPath || '首次保存后创建本地配置文件' }}</small>
                </section>

                <section class="sentinel-rail-card rule-rail-card">
                    <div class="rail-card-header">
                        <span>规则</span>
                        <button class="mini-action" @click="addRule">新增</button>
                    </div>
                    <div class="sentinel-rule-list">
                        <button v-for="rule in rules" :key="rule.id"
                                class="sentinel-rule-item"
                                :class="{selected: rule.id === selectedRuleId, disabled: !rule.enabled, dirty: isRuleDirty(rule)}"
                                @click="selectRule(rule.id)">
                            <span class="rule-title-line">
                                <strong>{{ rule.name || '未命名规则' }}</strong>
                                <em v-if="isRuleDirty(rule)">未保存</em>
                                <em v-else>{{ rule.enabled ? '启用' : '停用' }}</em>
                            </span>
                            <span>{{ ruleRobotLabel(rule) }}</span>
                            <small>{{ ruleKeywordLabel(rule) }} · {{ ruleTimeWindowLabel(rule) }}</small>
                        </button>
                    </div>
                </section>
            </aside>

            <main class="sentinel-main" v-if="selectedRule">
                <section class="sentinel-editor-header">
                    <div>
                        <div class="eyebrow">当前规则</div>
                        <h2>{{ selectedRule.name || '未命名规则' }}</h2>
                        <p>{{ monitorScopeLabel }} · {{ keywordLabel }} · {{ timeWindowLabel }}</p>
                    </div>
                    <div class="editor-actions">
                        <button class="ui button" :class="{loading: testing}" @click="testCurrentRule">只测试</button>
                        <button class="ui primary button"
                                :class="{loading: savingRuleId === selectedRule.id}"
                                @click="saveCurrentRule">
                            校验并保存当前规则
                        </button>
                    </div>
                </section>

                <div class="sentinel-main-grid">
                    <section class="sentinel-section">
                        <div class="sentinel-section-title">
                            <h3>触发条件</h3>
                            <span>{{ selectedRule.enabled ? '规则启用中' : '规则已停用' }}</span>
                        </div>
                        <div class="ui form">
                            <div class="two fields">
                                <div class="field">
                                    <label>规则名称</label>
                                    <input v-model="selectedRule.name" @input="markRuleDirty(selectedRule)" placeholder="例如：财务群付款提醒">
                                </div>
                                <div class="field">
                                    <label>规则状态</label>
                                    <div class="ui toggle checkbox">
                                        <input type="checkbox" v-model="selectedRule.enabled" @change="markRuleDirty(selectedRule)">
                                        <label>{{ selectedRule.enabled ? '启用本规则' : '停用本规则' }}</label>
                                    </div>
                                </div>
                            </div>
                            <div class="field">
                                <label>关键词</label>
                                <input v-model="selectedRule.keywordsText" @input="markRuleDirty(selectedRule)" placeholder="留空 = 所有消息；多个用英文逗号分隔">
                                <small>当前：{{ keywordLabel }}</small>
                            </div>
                            <div class="field">
                                <label>通知时段</label>
                                <div class="time-range-row">
                                    <select v-model="selectedRule.timeStart" @change="markRuleDirty(selectedRule)" aria-label="通知开始时间">
                                        <option v-for="time in timeOptions" :key="'start-' + time" :value="time">{{ time }}</option>
                                    </select>
                                    <span>至</span>
                                    <select v-model="selectedRule.timeEnd" @change="markRuleDirty(selectedRule)" aria-label="通知结束时间">
                                        <option v-for="time in timeOptions" :key="'end-' + time" :value="time">{{ time }}</option>
                                    </select>
                                </div>
                                <div class="time-preset-row">
                                    <button type="button" class="preset-chip" @click="setTimeWindow('00:00', '00:00')">全天</button>
                                    <button type="button" class="preset-chip" @click="setTimeWindow('09:00', '18:00')">工作时间</button>
                                    <button type="button" class="preset-chip" @click="setTimeWindow('18:00', '23:00')">晚间</button>
                                </div>
                                <small>当前：{{ timeWindowLabel }}</small>
                            </div>
                            <div class="field">
                                <label>个人消息</label>
                                <div class="ui toggle checkbox">
                                    <input type="checkbox" v-model="selectedRule.monitorDirect" @change="markRuleDirty(selectedRule)">
                                    <label>{{ selectedRule.monitorDirect ? '群消息和个人消息都监控' : '只监控群消息' }}</label>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section class="sentinel-section">
                        <div class="sentinel-section-title">
                            <h3>钉钉机器人</h3>
                            <span>{{ selectedWebhookStatusLabel }} · 钉钉群设置 > 智能群助手 > 自定义机器人</span>
                        </div>
                        <div class="ui form">
                            <div class="field">
                                <label>机器人别名</label>
                                <input v-model="selectedRule.webhookAlias" @input="markRuleDirty(selectedRule)" placeholder="例如：财务预警机器人">
                            </div>
                            <div class="field">
                                <label>Webhook</label>
                                <input type="password" v-model="selectedRule.webhook" @input="markRuleDirty(selectedRule)" :placeholder="selectedRule.webhookConfigured ? '已保存，留空表示不修改' : '粘贴钉钉机器人 Webhook'">
                                <small class="config-status" :class="{ok: selectedRule.webhookConfigured}">{{ selectedWebhookStatusLabel }}；输入新地址才会覆盖。</small>
                            </div>
                            <div class="field">
                                <label>加签密钥</label>
                                <input type="password" v-model="selectedRule.secret" @input="markRuleDirty(selectedRule)" :placeholder="selectedRule.secretConfigured ? '已保存，留空表示不修改' : '粘贴 SEC 开头的加签密钥'">
                                <small class="config-status" :class="{ok: selectedRule.secretConfigured}">{{ selectedSecretStatusLabel }}；不会在页面回显明文。</small>
                            </div>
                            <div class="two fields">
                                <div class="field">
                                    <label>通知标题</label>
                                    <input v-model="selectedRule.title" @input="markRuleDirty(selectedRule)">
                                </div>
                                <div class="field">
                                    <label>最大长度</label>
                                    <input type="number" min="1" v-model.number="selectedRule.maxBodyLength" @input="markRuleDirty(selectedRule)">
                                </div>
                            </div>
                            <div class="two fields">
                                <div class="field">
                                    <label>At 手机号</label>
                                    <input v-model="selectedRule.atMobilesText" @input="markRuleDirty(selectedRule)" placeholder="可选，多个用英文逗号分隔">
                                </div>
                                <div class="field">
                                    <label>@ 所有人</label>
                                    <div class="ui toggle checkbox">
                                        <input type="checkbox" v-model="selectedRule.atAll" @change="markRuleDirty(selectedRule)">
                                        <label>{{ selectedRule.atAll ? '会 @ 所有人' : '不 @ 所有人' }}</label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                <section class="sentinel-section sentinel-scope-section">
                    <div class="sentinel-section-title">
                        <div>
                            <h3>监控范围</h3>
                            <span>{{ selectedRule.name }}：{{ monitorScopeLabel }}</span>
                        </div>
                        <div class="button-row compact">
                            <button class="ui button" @click="selectAllGroups" :disabled="!groups.length">全选</button>
                            <button class="ui button" @click="clearGroupLimit">监控全部群</button>
                        </div>
                    </div>
                    <div class="scope-toolbar">
                        <input class="scope-search" v-model="groupSearch" placeholder="搜索群名">
                        <span>{{ selectedGroupCount > 0 ? '只监控已选群' : '未选择群时监控全部群' }}</span>
                    </div>
                    <div class="sentinel-group-list" :class="{loading: loadingGroups}">
                        <button v-for="group in visibleGroups" :key="group.JID"
                                class="group-row"
                                :class="{selected: selectedRule?.groups?.includes(group.JID)}"
                                @click="toggleGroup(group)">
                            <span class="check-box"><i class="check icon" v-if="selectedRule?.groups?.includes(group.JID)"></i></span>
                            <span>
                                <strong>{{ groupName(group) }}</strong>
                                <small>{{ groupMemberCount(group) }} 位成员</small>
                            </span>
                        </button>
                        <div class="empty-state" v-if="!groups.length && !loadingGroups">WhatsApp 登录后会自动加载群列表。</div>
                        <div class="empty-state" v-if="groups.length && !visibleGroups.length && !loadingGroups">没有匹配的群。</div>
                    </div>
                </section>

                <section class="sentinel-history">
                    <div class="sentinel-section-title">
                        <h3>转发历史</h3>
                        <button class="ui button" :class="{loading: loadingHistory}" @click="fetchForwardHistory">刷新历史</button>
                    </div>
                    <div class="sentinel-history-list" :class="{loading: loadingHistory}">
                        <div class="sentinel-history-row" v-for="item in forwardHistory" :key="item.id">
                            <div class="history-main-line">
                                <span class="history-status" :class="item.status">
                                    <i :class="historyStatusIcon(item.status)"></i>
                                    {{ historyStatusLabel(item.status) }}
                                </span>
                                <strong>{{ item.chat_name || '-' }}</strong>
                                <span>{{ formatHistoryTime(item.forwarded_at) }}</span>
                            </div>
                            <div class="history-sub-line">
                                <span>{{ item.sender || '-' }}</span>
                                <span>{{ item.rule_name || '-' }}</span>
                                <span>{{ item.robot_alias || '-' }}</span>
                            </div>
                            <p>{{ item.message || '-' }}</p>
                            <div class="forward-history-error" v-if="item.error">{{ item.error }}</div>
                        </div>
                        <div class="empty-state" v-if="!forwardHistory.length && !loadingHistory">还没有转发记录。命中关键词并发送到钉钉后会显示在这里。</div>
                    </div>
                </section>

                <div class="notice-panel save-feedback" v-if="lastSavedSummary">
                    <strong>保存回显</strong>
                    <span>{{ lastSavedSummary }}</span>
                </div>
            </main>
        </div>
    </div>
    `
}
