export default {
    name: 'AlertWorkbench',
    data() {
        return {
            devices: [],
            selectedDeviceId: '',
            selectedDevice: null,
            groups: [],
            selectedGroups: [],
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
            saving: false,
            savingAlias: false,
            testing: false,
            forwardHistory: [],
            form: {
                enabled: false,
                webhook: '',
                webhookAlias: '',
                secret: '',
                keywordsText: '',
                title: 'WA 预警提醒',
                timeStart: '',
                timeEnd: '',
                maxBodyLength: 500,
                monitorDirect: false,
            },
            status: {
                webhookConfigured: false,
                webhookPreview: '',
                secretConfigured: false,
            }
        }
    },
    computed: {
        isLoggedIn() {
            return this.selectedDevice?.state === 'logged_in';
        },
        isConfirmingLoginState() {
            return !this.isLoggedIn && !!this.deviceStatusTimer && this.deviceStatusPolls < 5;
        },
        selectedGroupCount() {
            return this.selectedGroups.length;
        },
        monitorScopeLabel() {
            const groupScope = this.selectedGroupCount > 0 ? `监控 ${this.selectedGroupCount} 个群` : '监控全部群';
            return this.form.monitorDirect ? `${groupScope} + 个人消息` : groupScope;
        },
        keywordLabel() {
            const keywords = this.commaList(this.form.keywordsText);
            return keywords.length > 0 ? keywords.join('、') : '不过滤关键词';
        },
        timeWindowLabel() {
            if (this.form.timeStart && this.form.timeEnd) {
                return `${this.form.timeStart} - ${this.form.timeEnd}`;
            }
            return '全天通知';
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
        webhookStatusLabel() {
            if (this.status.webhookConfigured) {
                if (this.form.webhookAlias) {
                    return `已保存：${this.form.webhookAlias}`;
                }
                return this.status.webhookPreview ? `已保存：${this.status.webhookPreview}` : 'Webhook 已保存';
            }
            return '未配置 Webhook';
        },
        secretStatusLabel() {
            return this.status.secretConfigured ? '加签密钥已保存' : '未配置密钥';
        },
        accountRows() {
            return [
                { label: '账号名称', value: this.selectedDevice?.display_name || '未获取' },
                { label: 'WhatsApp 账号', value: this.selectedDevice?.jid || '未登录' },
                { label: '设备 ID', value: this.selectedDeviceId || '未初始化' },
                { label: '连接状态', value: this.selectedDevice?.state || 'unknown' },
            ];
        }
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
            this.selectedDevice = device;
            this.setDeviceHeader(id);
            if (this.selectedDevice?.state === 'logged_in') {
                this.qrLink = '';
                this.qrSeconds = 0;
                this.loginError = '';
                this.stopDeviceStatusPolling();
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
            this.deviceStatusTimer = setInterval(async () => {
                this.deviceStatusPolls += 1;
                await this.fetchDevices({ silent: true });
                if (this.isLoggedIn || this.deviceStatusPolls >= 30) {
                    this.stopDeviceStatusPolling();
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
                this.toastSuccess('当前设备已经登录');
                return;
            }
            try {
                this.loggingIn = true;
                this.loginError = '';
                const response = await window.http.get('/app/login', { timeout: 45000 });
                const result = response.data?.results || {};
                this.qrLink = result.qr_link || '';
                this.qrSeconds = result.qr_duration || 0;
                if (!this.qrLink) {
                    this.loginError = '没有生成二维码。请确认网络可以访问 WhatsApp Web，然后重新获取。';
                    this.toastError(null, this.loginError);
                    return;
                }
                this.startQrTimer();
            } catch (error) {
                this.loginError = this.loginErrorMessage(error);
                this.toastError(null, this.loginError);
            } finally {
                this.loggingIn = false;
            }
        },
        async reconnect() {
            if (!this.selectedDeviceId) return;
            try {
                await window.http.get('/app/reconnect');
                await this.fetchDevices();
                this.toastSuccess('已请求重连');
            } catch (error) {
                this.toastError(error, '重连失败');
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
        toggleGroup(group) {
            const jid = group?.JID;
            if (!jid) return;
            if (this.selectedGroups.includes(jid)) {
                this.selectedGroups = this.selectedGroups.filter(item => item !== jid);
            } else {
                this.selectedGroups = [...this.selectedGroups, jid];
            }
        },
        selectAllGroups() {
            this.selectedGroups = this.groups.map(group => group.JID).filter(Boolean);
        },
        clearGroupLimit() {
            this.selectedGroups = [];
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
            const firstWindow = (config.time_windows || [])[0] || '';
            const [timeStart, timeEnd] = this.parseTimeWindow(firstWindow);
            this.form.enabled = !!config.enabled;
            this.form.webhook = '';
            this.form.webhookAlias = config.webhook_alias || '';
            this.form.secret = '';
            this.form.keywordsText = (config.keywords || []).join(', ');
            this.form.title = config.title || 'WA 预警提醒';
            this.form.timeStart = timeStart;
            this.form.timeEnd = timeEnd;
            this.form.maxBodyLength = Number.isInteger(config.max_body_length) ? config.max_body_length : 500;
            this.form.monitorDirect = config.only_groups === false;
            this.selectedGroups = config.groups || [];
            this.status.webhookConfigured = !!config.webhook_configured;
            this.status.webhookPreview = config.webhook_preview || '';
            this.status.secretConfigured = !!config.secret_configured;
        },
        parseTimeWindow(value) {
            const match = String(value || '').match(/^\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s*$/);
            return match ? [match[1], match[2]] : ['', ''];
        },
        setTimeWindow(start, end) {
            this.form.timeStart = start;
            this.form.timeEnd = end;
        },
        timeWindowsPayload() {
            if (!this.form.timeStart || !this.form.timeEnd) {
                return [];
            }
            return [`${this.form.timeStart}-${this.form.timeEnd}`];
        },
        buildConfigPayload(extra = {}) {
            const payload = {
                enabled: this.form.enabled,
                webhook_alias: this.form.webhookAlias.trim(),
                groups: this.selectedGroups,
                keywords: this.commaList(this.form.keywordsText),
                only_groups: !this.form.monitorDirect,
                title: this.form.title || 'WA 预警提醒',
                time_windows: this.timeWindowsPayload(),
                max_body_length: Number(this.form.maxBodyLength) || 500,
                ...extra,
            };
            if (this.form.webhook.trim()) {
                payload.webhook = this.form.webhook.trim();
            }
            if (this.form.secret.trim()) {
                payload.secret = this.form.secret.trim();
            }
            return payload;
        },
        async saveConfig(extra = {}) {
            try {
                this.saving = true;
                const response = await window.http.post('/dingtalk/config', this.buildConfigPayload(extra));
                this.applyConfig(response.data?.results || {});
                this.toastSuccess('监控配置已保存');
            } catch (error) {
                this.toastError(error, '保存监控配置失败');
            } finally {
                this.saving = false;
            }
        },
        async saveWebhookAlias() {
            try {
                this.savingAlias = true;
                const response = await window.http.post('/dingtalk/config', {
                    webhook_alias: this.form.webhookAlias.trim(),
                });
                this.applyConfig(response.data?.results || {});
                this.toastSuccess('机器人别名已保存');
            } catch (error) {
                this.toastError(error, '保存机器人别名失败');
            } finally {
                this.savingAlias = false;
            }
        },
        async testDingTalk() {
            try {
                this.testing = true;
                await window.http.post('/dingtalk/test');
                this.toastSuccess('钉钉测试已发送');
                await this.fetchForwardHistory();
            } catch (error) {
                this.toastError(error, '钉钉测试发送失败');
            } finally {
                this.testing = false;
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
    <div class="alert-workbench">
        <section class="status-band">
            <div>
                <div class="eyebrow">本地 WhatsApp 群预警</div>
                <h2>登录 WhatsApp，选择群和关键词，转发到钉钉</h2>
            </div>
            <div class="status-pills">
                <span class="status-pill" :class="{active: isLoggedIn}">{{ isLoggedIn ? 'WhatsApp 已登录' : 'WhatsApp 未登录' }}</span>
                <span class="status-pill" :class="{active: form.enabled}">{{ form.enabled ? '钉钉已启用' : '钉钉未启用' }}</span>
            </div>
        </section>

        <div class="workbench-grid overview-grid">
            <section class="tool-panel">
                <h3><i class="mobile alternate icon"></i> WhatsApp 状态</h3>
                <div class="account-status" :class="{loading: loadingDevices}">
                    <strong>{{ isLoggedIn ? '已登录' : '未登录' }}</strong>
                    <span>{{ isLoggedIn ? '当前账号已连接，可以接收群消息。' : '程序会自动使用默认设备。' }}</span>
                </div>
                <div class="account-details">
                    <div class="account-detail-row" v-for="row in accountRows" :key="row.label">
                        <span>{{ row.label }}</span>
                        <strong>{{ row.value }}</strong>
                    </div>
                </div>
                <div class="button-row" v-if="!isLoggedIn">
                    <button class="ui button" v-if="isConfirmingLoginState" disabled>正在确认登录状态</button>
                    <button class="ui green button" v-else :class="{loading: loggingIn}" @click="startLogin">获取二维码</button>
                    <button class="ui button" @click="fetchDevices">刷新状态</button>
                </div>
                <div class="button-row" v-else>
                    <button class="ui button" @click="fetchDevices">刷新状态</button>
                    <button class="ui red button" :class="{loading: loggingOut}" @click="logoutWhatsapp">退出登录</button>
                </div>
                <div class="qr-box" v-if="!isLoggedIn && qrLink">
                    <img :src="qrLink" alt="WhatsApp 登录二维码">
                    <div>
                        <strong>打开 WhatsApp：设置 > 已连接设备 > 连接设备</strong>
                        <p v-if="qrSeconds > 0">二维码剩余 {{ qrSeconds }} 秒。</p>
                        <p v-else>二维码已过期，请重新获取。</p>
                    </div>
                </div>
                <div class="notice-panel error" v-if="!isLoggedIn && loginError">
                    <strong>二维码生成失败</strong>
                    <span>{{ loginError }}</span>
                </div>
            </section>

            <section class="tool-panel">
                <h3><i class="filter icon"></i> 监控规则</h3>
                <div class="ui form">
                    <div class="field">
                        <label>关键词</label>
                        <input v-model="form.keywordsText" placeholder="留空 = 所有消息；多个用英文逗号分隔">
                        <small>当前：{{ keywordLabel }}</small>
                    </div>
                    <div class="field">
                        <label>通知时段</label>
                        <div class="time-range-row">
                            <select v-model="form.timeStart" aria-label="通知开始时间">
                                <option value="">开始时间</option>
                                <option v-for="time in timeOptions" :key="'start-' + time" :value="time">{{ time }}</option>
                            </select>
                            <span>至</span>
                            <select v-model="form.timeEnd" aria-label="通知结束时间">
                                <option value="">结束时间</option>
                                <option v-for="time in timeOptions" :key="'end-' + time" :value="time">{{ time }}</option>
                            </select>
                        </div>
                        <div class="time-preset-row">
                            <button type="button" class="preset-chip" @click="setTimeWindow('', '')">全天</button>
                            <button type="button" class="preset-chip" @click="setTimeWindow('09:00', '18:00')">工作时间</button>
                            <button type="button" class="preset-chip" @click="setTimeWindow('18:00', '23:00')">晚间</button>
                        </div>
                        <small>当前：{{ timeWindowLabel }}</small>
                    </div>
                    <div class="field">
                        <label>监控范围</label>
                        <div class="summary-card">
                            <strong>{{ monitorScopeLabel }}</strong>
                            <span>群消息、个人消息（开启后）、文字、图片、视频、文件等都会被识别；关键词只匹配文本和媒体说明。</span>
                        </div>
                    </div>
                    <div class="field">
                        <label>个人消息</label>
                        <div class="ui toggle checkbox">
                            <input type="checkbox" v-model="form.monitorDirect">
                            <label>{{ form.monitorDirect ? '同时监控个人消息' : '只监控群消息' }}</label>
                        </div>
                        <small>开启后，个人消息按关键词和通知时段转发；群选择只限制群消息。</small>
                    </div>
                </div>
                <div class="button-row">
                    <button class="ui primary button" :class="{loading: saving}" @click="saveConfig">保存配置</button>
                    <button class="ui button" :class="{loading: testing}" @click="testDingTalk">测试钉钉</button>
                </div>
            </section>

            <section class="tool-panel">
                <h3><i class="bell icon"></i> 钉钉机器人</h3>
                <div class="help-panel">
                    <strong>如何获取钉钉机器人</strong>
                    <span>PC 钉钉打开目标群，进入 群设置 > 智能群助手 > 添加机器人 > 自定义机器人。</span>
                    <span>安全设置建议选择“加签”，完成后复制 Webhook，并把 SEC 开头的加签密钥填到下面。</span>
                </div>
                <div class="ui form">
                    <div class="two fields">
                        <div class="field">
                            <label>启用监控</label>
                            <div class="ui toggle checkbox">
                                <input type="checkbox" v-model="form.enabled">
                                <label>{{ form.enabled ? '已启用' : '未启用' }}</label>
                            </div>
                        </div>
                        <div class="field">
                            <label>消息最大长度</label>
                            <input type="number" min="1" v-model.number="form.maxBodyLength">
                        </div>
                    </div>
                    <div class="field">
                        <label>Webhook</label>
                        <input type="password" v-model="form.webhook" :placeholder="status.webhookConfigured ? '已保存，留空表示不修改' : '粘贴钉钉机器人 Webhook'">
                        <small class="config-status" :class="{ok: status.webhookConfigured}">{{ webhookStatusLabel }}；输入新地址才会覆盖。</small>
                    </div>
                    <div class="field">
                        <label>机器人别名</label>
                        <div class="inline-save-row">
                            <input v-model="form.webhookAlias" placeholder="例如：业务预警机器人">
                            <button class="ui button" type="button" :class="{loading: savingAlias}" @click="saveWebhookAlias">保存别名</button>
                        </div>
                        <small>用于页面展示，会写入本地配置。</small>
                    </div>
                    <div class="field">
                        <label>加签密钥</label>
                        <input type="password" v-model="form.secret" :placeholder="status.secretConfigured ? '已保存，留空表示不修改' : '粘贴 SEC 开头的加签密钥'">
                        <small class="config-status" :class="{ok: status.secretConfigured}">{{ secretStatusLabel }}；不会在页面回显明文。</small>
                    </div>
                    <div class="field">
                        <label>通知标题</label>
                        <input v-model="form.title">
                    </div>
                </div>
            </section>
        </div>

        <section class="tool-panel">
            <div class="section-title-row">
                <h3><i class="history icon"></i> 转发历史</h3>
                <button class="ui button" :class="{loading: loadingHistory}" @click="fetchForwardHistory">刷新历史</button>
            </div>
            <div class="summary-line">最近 50 条钉钉转发记录，只保存消息摘要和转发结果。</div>
            <div class="forward-history-list" :class="{loading: loadingHistory}">
                <div class="forward-history-row" v-for="item in forwardHistory" :key="item.id">
                    <div class="forward-history-head">
                        <span class="history-status" :class="item.status">
                            <i :class="historyStatusIcon(item.status)"></i>
                            {{ historyStatusLabel(item.status) }}
                        </span>
                        <span>{{ formatHistoryTime(item.forwarded_at) }}</span>
                    </div>
                    <div class="forward-history-meta">
                        <span><strong>群/会话</strong>{{ item.chat_name || '-' }}</span>
                        <span><strong>发送人</strong>{{ item.sender || '-' }}</span>
                    </div>
                    <p>{{ item.message || '-' }}</p>
                    <div class="forward-history-error" v-if="item.error">{{ item.error }}</div>
                </div>
                <div class="empty-state" v-if="!forwardHistory.length && !loadingHistory">还没有转发记录。命中关键词并发送到钉钉后会显示在这里。</div>
            </div>
        </section>

        <section class="tool-panel">
            <div class="section-title-row">
                <h3><i class="users icon"></i> 群监控范围</h3>
                <div class="button-row compact">
                    <button class="ui button" @click="fetchGroups" :disabled="!selectedDeviceId">刷新群列表</button>
                    <button class="ui button" @click="selectAllGroups" :disabled="!groups.length">全选</button>
                    <button class="ui button" @click="clearGroupLimit">监控全部群</button>
                </div>
            </div>
            <div class="summary-line">{{ monitorScopeLabel }}</div>
            <div class="group-table" :class="{loading: loadingGroups}">
                <button v-for="group in groups" :key="group.JID"
                        class="group-row"
                        :class="{selected: selectedGroups.includes(group.JID)}"
                        @click="toggleGroup(group)">
                    <span class="check-box"><i class="check icon" v-if="selectedGroups.includes(group.JID)"></i></span>
                    <span>
                        <strong>{{ groupName(group) }}</strong>
                        <small>{{ groupMemberCount(group) }} 位成员</small>
                    </span>
                </button>
                <div class="empty-state" v-if="!groups.length && !loadingGroups">登录后点击“刷新群列表”。</div>
            </div>
        </section>

    </div>
    `
}
