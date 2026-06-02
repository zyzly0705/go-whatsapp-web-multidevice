export default {
    name: 'DingTalkConfig',
    props: {
        language: {
            type: String,
            default: 'zh'
        }
    },
    data() {
        return {
            isLoading: false,
            isSaving: false,
            isTesting: false,
            isClearingWebhook: false,
            isClearingSecret: false,
            form: {
                enabled: false,
                webhook: '',
                secret: '',
                keywordsText: '',
                groupsText: '',
                only_groups: true,
                title: 'WA 预警提醒',
                atMobilesText: '',
                at_all: false,
                max_body_length: 500,
            },
            status: {
                webhook_configured: false,
                webhook_preview: '',
                secret_configured: false,
            }
        }
    },
    computed: {
        copy() {
            const zh = {
                header: '钉钉预警',
                subHeader: '把匹配到的 WhatsApp 消息转发到钉钉机器人。',
                language: '语言',
                status: '状态',
                enabled: '已启用',
                disabled: '已停用',
                onlyGroups: '只转群消息',
                groupMessagesOnly: '仅 WhatsApp 群消息',
                groupsAndDirectChats: '群消息和私聊',
                maxBodyLength: '消息最大长度',
                webhook: 'Webhook',
                webhookPlaceholder: '粘贴钉钉机器人 Webhook 来更新',
                clear: '清空',
                webhookConfigured: 'Webhook 已配置',
                noWebhook: '未配置 Webhook',
                signingSecret: '加签密钥',
                secretPlaceholder: '粘贴 SEC... 来更新',
                secretConfigured: '密钥已配置',
                noSecret: '未配置密钥',
                keywords: '关键词',
                allowedGroups: '允许的群',
                groupsPlaceholder: '留空 = 所有群，或填写 120363xxx@g.us',
                title: '标题',
                atMobiles: '@ 手机号',
                atAll: '@ 所有人',
                atAllMembers: '@ 所有人',
                refresh: '刷新',
                sendTest: '发送测试',
                save: '保存钉钉配置',
                loadError: '加载钉钉配置失败',
                saveSuccess: '钉钉配置已保存',
                saveError: '保存钉钉配置失败',
                testSuccess: '钉钉测试已发送',
                testError: '发送钉钉测试失败',
            };
            const en = {
                header: 'DingTalk alert',
                subHeader: 'Forward matched WhatsApp messages to a DingTalk robot.',
                language: 'Language',
                status: 'Status',
                enabled: 'Enabled',
                disabled: 'Disabled',
                onlyGroups: 'Only groups',
                groupMessagesOnly: 'Group messages only',
                groupsAndDirectChats: 'Groups and direct chats',
                maxBodyLength: 'Max body length',
                webhook: 'Webhook',
                webhookPlaceholder: 'Paste DingTalk robot webhook to update',
                clear: 'Clear',
                webhookConfigured: 'Webhook configured',
                noWebhook: 'No webhook',
                signingSecret: 'Signing secret',
                secretPlaceholder: 'Paste SEC... to update',
                secretConfigured: 'Secret configured',
                noSecret: 'No secret',
                keywords: 'Keywords',
                allowedGroups: 'Allowed groups',
                groupsPlaceholder: 'empty = all groups, or 120363xxx@g.us',
                title: 'Title',
                atMobiles: '@ mobiles',
                atAll: '@ all',
                atAllMembers: 'At all members',
                refresh: 'Refresh',
                sendTest: 'Send test',
                save: 'Save DingTalk config',
                loadError: 'Failed to load DingTalk config',
                saveSuccess: 'DingTalk config saved',
                saveError: 'Failed to save DingTalk config',
                testSuccess: 'DingTalk test sent',
                testError: 'Failed to send DingTalk test',
            };
            return this.language === 'zh' ? zh : en;
        }
    },
    methods: {
        async fetchConfig() {
            try {
                this.isLoading = true;
                const res = await window.http.get('/dingtalk/config');
                this.applyConfig(res.data?.results || {});
            } catch (err) {
                const msg = err.response?.data?.message || err.message || this.copy.loadError;
                showErrorInfo(msg);
            } finally {
                this.isLoading = false;
            }
        },
        applyConfig(config) {
            this.form.enabled = !!config.enabled;
            this.form.webhook = '';
            this.form.secret = '';
            this.form.keywordsText = (config.keywords || []).join(', ');
            this.form.groupsText = (config.groups || []).join(', ');
            this.form.only_groups = config.only_groups !== false;
            this.form.title = config.title || 'WA 预警提醒';
            this.form.atMobilesText = (config.at_mobiles || []).join(', ');
            this.form.at_all = !!config.at_all;
            this.form.max_body_length = Number.isInteger(config.max_body_length) ? config.max_body_length : 500;
            this.status.webhook_configured = !!config.webhook_configured;
            this.status.webhook_preview = config.webhook_preview || '';
            this.status.secret_configured = !!config.secret_configured;
        },
        commaList(value) {
            if (!value) return [];
            return value.split(',').map(item => item.trim()).filter(Boolean);
        },
        buildPayload(extra = {}) {
            const payload = {
                enabled: this.form.enabled,
                keywords: this.commaList(this.form.keywordsText),
                groups: this.commaList(this.form.groupsText),
                only_groups: this.form.only_groups,
                title: this.form.title,
                at_mobiles: this.commaList(this.form.atMobilesText),
                at_all: this.form.at_all,
                max_body_length: Number(this.form.max_body_length) || 0,
                ...extra
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
                this.isSaving = true;
                const res = await window.http.post('/dingtalk/config', this.buildPayload(extra));
                this.applyConfig(res.data?.results || {});
                showSuccessInfo(this.copy.saveSuccess);
            } catch (err) {
                const msg = err.response?.data?.message || err.message || this.copy.saveError;
                showErrorInfo(msg);
            } finally {
                this.isSaving = false;
            }
        },
        async clearWebhook() {
            this.form.webhook = '';
            await this.saveConfig({ clear_webhook: true, enabled: false });
        },
        async clearSecret() {
            this.form.secret = '';
            await this.saveConfig({ clear_secret: true });
        },
        async sendTest() {
            try {
                this.isTesting = true;
                await window.http.post('/dingtalk/test');
                showSuccessInfo(this.copy.testSuccess);
            } catch (err) {
                const msg = err.response?.data?.message || err.message || this.copy.testError;
                showErrorInfo(msg);
            } finally {
                this.isTesting = false;
            }
        }
    },
    mounted() {
        this.fetchConfig();
    },
    template: `
    <div class="ui segment" :class="{loading: isLoading}">
        <h3 class="ui header">
            <i class="bell icon"></i>
            <div class="content">
                {{ copy.header }}
                <div class="sub header">{{ copy.subHeader }}</div>
            </div>
        </h3>

        <div class="ui form">
            <div class="three fields">
                <div class="field">
                    <label>{{ copy.status }}</label>
                    <div class="ui toggle checkbox">
                        <input type="checkbox" v-model="form.enabled">
                        <label>{{ form.enabled ? copy.enabled : copy.disabled }}</label>
                    </div>
                </div>
                <div class="field">
                    <label>{{ copy.onlyGroups }}</label>
                    <div class="ui toggle checkbox">
                        <input type="checkbox" v-model="form.only_groups">
                        <label>{{ form.only_groups ? copy.groupMessagesOnly : copy.groupsAndDirectChats }}</label>
                    </div>
                </div>
                <div class="field">
                    <label>{{ copy.maxBodyLength }}</label>
                    <input type="number" min="0" v-model.number="form.max_body_length">
                </div>
            </div>

            <div class="field">
                <label>{{ copy.webhook }}</label>
                <div class="ui action input">
                    <input type="password" v-model="form.webhook" :placeholder="copy.webhookPlaceholder">
                    <button class="ui button" type="button" @click="clearWebhook" :disabled="!status.webhook_configured || isSaving">
                        {{ copy.clear }}
                    </button>
                </div>
                <div class="ui basic label" v-if="status.webhook_configured">
                    {{ status.webhook_preview || copy.webhookConfigured }}
                </div>
                <div class="ui basic label" v-else>{{ copy.noWebhook }}</div>
            </div>

            <div class="field">
                <label>{{ copy.signingSecret }}</label>
                <div class="ui action input">
                    <input type="password" v-model="form.secret" :placeholder="copy.secretPlaceholder">
                    <button class="ui button" type="button" @click="clearSecret" :disabled="!status.secret_configured || isSaving">
                        {{ copy.clear }}
                    </button>
                </div>
                <div class="ui basic label" v-if="status.secret_configured">{{ copy.secretConfigured }}</div>
                <div class="ui basic label" v-else>{{ copy.noSecret }}</div>
            </div>

            <div class="two fields">
                <div class="field">
                    <label>{{ copy.keywords }}</label>
                    <input type="text" v-model="form.keywordsText" placeholder="重要业务提醒, 告警">
                </div>
                <div class="field">
                    <label>{{ copy.allowedGroups }}</label>
                    <input type="text" v-model="form.groupsText" :placeholder="copy.groupsPlaceholder">
                </div>
            </div>

            <div class="three fields">
                <div class="field">
                    <label>{{ copy.title }}</label>
                    <input type="text" v-model="form.title" placeholder="WA 预警提醒">
                </div>
                <div class="field">
                    <label>{{ copy.atMobiles }}</label>
                    <input type="text" v-model="form.atMobilesText" placeholder="13800000000, 13900000000">
                </div>
                <div class="field">
                    <label>{{ copy.atAll }}</label>
                    <div class="ui checkbox">
                        <input type="checkbox" v-model="form.at_all">
                        <label>{{ copy.atAllMembers }}</label>
                    </div>
                </div>
            </div>

            <div class="ui right aligned basic segment" style="padding-right: 0;">
                <button class="ui button" type="button" @click="fetchConfig" :disabled="isSaving">{{ copy.refresh }}</button>
                <button class="ui button" type="button" :class="{loading: isTesting}" @click="sendTest" :disabled="isSaving || !status.webhook_configured">
                    {{ copy.sendTest }}
                </button>
                <button class="ui primary button" type="button" :class="{loading: isSaving}" @click="saveConfig()">
                    {{ copy.save }}
                </button>
            </div>
        </div>
    </div>
    `
}
