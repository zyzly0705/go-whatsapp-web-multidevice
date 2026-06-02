export default {
    name: 'DeviceManager',
    props: {
        wsBasePath: {
            type: String,
            default: ''
        },
        language: {
            type: String,
            default: 'zh'
        }
    },
    data() {
        return {
            deviceList: [],
            selectedDeviceId: '',
            deviceIdInput: '',
            isCreatingDevice: false,
            deviceToDelete: { id: '', jid: '', state: '' },
            isDeleting: false
        }
    },
    computed: {
        selectedDevice() {
            if (!this.selectedDeviceId) return null;
            return this.deviceList.find(d => (d.id || d.device) === this.selectedDeviceId) || null;
        },
        isSelectedDeviceLoggedIn() {
            return this.selectedDevice?.state === 'logged_in';
        },
        copy() {
            const zh = {
                setup: '设备设置',
                setupHint: '创建或选择 device_id，然后打开登录。',
                deviceId: 'Device ID（可选）',
                devicePlaceholder: '留空自动生成',
                actions: '操作',
                createDevice: '创建设备',
                useThisDevice: '使用此设备',
                state: '状态',
                unknown: '未知',
                selected: '已选择',
                use: '使用',
                noDevices: '还没有设备。先创建一个开始。',
                howToLogin: '如何登录',
                step1: '步骤 1：创建设备，拿到',
                step2: '步骤 2：REST 调用时携带',
                step3: '步骤 3：打开 Login 卡片扫码或使用验证码配对。',
                wsUrl: 'WebSocket 地址：',
                confirmDelete: '确认删除设备',
                deleteQuestion: '确定要删除这个设备吗？',
                warning: '警告',
                deleteWarning: '此操作会永久删除设备，以及关联的聊天和消息数据，无法撤销。',
                cancel: '取消',
                deleteDevice: '删除设备',
                deviceRequired: '需要 Device ID',
                usingDevice: '正在使用设备',
                createFailed: '创建设备失败',
                inputRequired: '请输入 device_id，或先创建一个设备。',
                noDeviceSelected: '没有选择要删除的设备',
                deleteSuccess: '设备删除成功',
                deleteFailed: '删除设备失败',
            };
            const en = {
                setup: 'Device setup',
                setupHint: 'Create or select a device_id, then open login.',
                deviceId: 'Device ID (optional)',
                devicePlaceholder: 'Leave empty to auto-generate',
                actions: 'Actions',
                createDevice: 'Create device',
                useThisDevice: 'Use this device',
                state: 'State',
                unknown: 'unknown',
                selected: 'Selected',
                use: 'Use',
                noDevices: 'No devices yet. Create one to begin.',
                howToLogin: 'How to log in',
                step1: 'Step 1: Create a device to get',
                step2: 'Step 2: Send',
                step3: 'Step 3: Open Login card to pair (QR or code).',
                wsUrl: 'WebSocket URL:',
                confirmDelete: 'Confirm Delete Device',
                deleteQuestion: 'Are you sure you want to delete this device?',
                warning: 'Warning',
                deleteWarning: 'This action will permanently delete the device and all associated data including chats and messages. This cannot be undone.',
                cancel: 'Cancel',
                deleteDevice: 'Delete Device',
                deviceRequired: 'Device ID is required',
                usingDevice: 'Using device',
                createFailed: 'Failed to create device',
                inputRequired: 'Enter a device_id or create one first.',
                noDeviceSelected: 'No device selected for deletion',
                deleteSuccess: 'Device deleted successfully',
                deleteFailed: 'Failed to delete device',
            };
            return this.language === 'zh' ? zh : en;
        }
    },
    methods: {
        async fetchDevices() {
            try {
                const res = await window.http.get(`/devices`);
                this.deviceList = res.data.results || [];
                if (!this.selectedDeviceId && this.deviceList.length > 0) {
                    const first = this.deviceList[0].id || this.deviceList[0].device;
                    this.setDeviceContext(first);
                }
                // Emit devices to parent for other components
                this.$emit('devices-updated', this.deviceList);
            } catch (err) {
                console.error(err);
            }
        },
        setDeviceContext(id) {
            if (!id) {
                showErrorInfo(this.copy.deviceRequired);
                return;
            }
            this.selectedDeviceId = id;
            this.$emit('device-selected', id);
            showSuccessInfo(`${this.copy.usingDevice} ${id}`);
        },
        async createDevice() {
            try {
                this.isCreatingDevice = true;
                const payload = this.deviceIdInput ? {device_id: this.deviceIdInput} : {};
                const res = await window.http.post('/devices', payload);
                const deviceID = res.data?.results?.id || res.data?.results?.device_id || this.deviceIdInput;
                this.setDeviceContext(deviceID);
                this.deviceIdInput = '';
            } catch (err) {
                const msg = err.response?.data?.message || err.message || this.copy.createFailed;
                showErrorInfo(msg);
            } finally {
                this.isCreatingDevice = false;
            }
        },
        useDeviceFromInput() {
            if (!this.deviceIdInput) {
                showErrorInfo(this.copy.inputRequired);
                return;
            }
            this.setDeviceContext(this.deviceIdInput);
        },
        openDeleteModal(deviceId, jid) {
            const device = this.deviceList.find(d => (d.id || d.device) === deviceId);
            this.deviceToDelete = { id: deviceId, jid: jid || '', state: device?.state || '' };
            $('#deleteDeviceModal').modal({
                closable: false,
                onApprove: () => {
                    this.executeDelete();
                    return false;
                },
                onDeny: () => {
                    this.resetDeleteState();
                }
            }).modal('show');
        },
        resetDeleteState() {
            this.deviceToDelete = { id: '', jid: '', state: '' };
            this.isDeleting = false;
        },
        async executeDelete() {
            const deviceId = this.deviceToDelete.id;
            if (!deviceId) {
                showErrorInfo(this.copy.noDeviceSelected);
                return;
            }
            try {
                this.isDeleting = true;
                
                // Logout first (fire and forget), then delete
                window.http.get(`/app/logout`, {
                    headers: { 'X-Device-Id': encodeURIComponent(deviceId) }
                }).catch(() => {});
                
                await window.http.delete(`/devices/${encodeURIComponent(deviceId)}`);
                showSuccessInfo(`${deviceId} ${this.copy.deleteSuccess}`);
                $('#deleteDeviceModal').modal('hide');
                
                if (this.selectedDeviceId === deviceId) {
                    this.selectedDeviceId = '';
                    this.$emit('device-selected', '');
                }
                
                await this.fetchDevices();
                this.resetDeleteState();
            } catch (err) {
                const msg = err.response?.data?.message || err.message || this.copy.deleteFailed;
                showErrorInfo(msg);
                this.isDeleting = false;
            }
        },
        // Called by parent to refresh devices
        refresh() {
            this.fetchDevices();
        },
        // Called by parent to update device list from websocket
        updateDeviceList(devices) {
            if (Array.isArray(devices)) {
                this.deviceList = devices;
                this.$emit('devices-updated', devices);
            }
        }
    },
    mounted() {
        this.fetchDevices();
    },
    template: `
    <div class="ui stackable grid">
        <div class="ten wide column">
            <div class="ui segment">
                <h3 class="ui header">
                    <i class="play icon"></i>
                    <div class="content">
                        {{ copy.setup }}
                        <div class="sub header">{{ copy.setupHint }}</div>
                    </div>
                </h3>
                <div class="ui form">
                    <div class="two fields">
                        <div class="field">
                            <label>{{ copy.deviceId }}</label>
                            <input type="text" v-model="deviceIdInput" :placeholder="copy.devicePlaceholder">
                        </div>
                        <div class="field">
                            <label>{{ copy.actions }}</label>
                            <div class="ui buttons">
                                <button class="ui primary button" :class="{loading: isCreatingDevice}" @click="createDevice">
                                    {{ copy.createDevice }}
                                </button>
                                <div class="or"></div>
                                <button class="ui button" @click="useDeviceFromInput">{{ copy.useThisDevice }}</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="ui divider"></div>
                
                <!-- Device List -->
                <div class="ui relaxed list" v-if="deviceList.length">
                    <div class="item" v-for="dev in deviceList" :key="dev.id || dev.device">
                        <i class="mobile alternate icon"></i>
                        <div class="content">
                            <div class="header">{{ dev.id || dev.device }}</div>
                            <div class="description">
                                <span>{{ copy.state }}: {{ dev.state || copy.unknown }}</span>
                                <span v-if="dev.jid"> · JID: {{ dev.jid }}</span>
                            </div>
                        </div>
                        <div class="right floated content">
                            <button class="ui mini button" 
                                    :class="{active: selectedDeviceId === (dev.id || dev.device)}"
                                    @click="setDeviceContext(dev.id || dev.device)">
                                {{ selectedDeviceId === (dev.id || dev.device) ? copy.selected : copy.use }}
                            </button>
                            <button class="ui mini red icon button" 
                                    @click="openDeleteModal(dev.id || dev.device, dev.jid)" 
                                    :class="{loading: isDeleting && deviceToDelete.id === (dev.id || dev.device)}">
                                <i class="trash icon" style="margin: 0;"></i>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="ui message" v-else>
                    {{ copy.noDevices }}
                </div>
            </div>
        </div>
        <div class="six wide column">
            <div class="ui warning message">
                <div class="header">{{ copy.howToLogin }}</div>
                <ul class="list">
                    <li>{{ copy.step1 }} <code>device_id</code>.</li>
                    <li>{{ copy.step2 }} <code>X-Device-Id: device_id</code>.</li>
                    <li>{{ copy.step3 }}</li>
                    <li>{{ copy.wsUrl }} <code>{{ wsBasePath }}/ws?device_id=&lt;device_id&gt;</code></li>
                </ul>
            </div>
        </div>

        <!-- Delete Device Confirmation Modal -->
        <div class="ui small modal" id="deleteDeviceModal">
            <div class="header">
                <i class="trash alternate icon"></i>
                {{ copy.confirmDelete }}
            </div>
            <div class="content">
                <p>{{ copy.deleteQuestion }}</p>
                <div class="ui segment">
                    <p><strong>Device ID:</strong> <code>{{ deviceToDelete.id }}</code></p>
                    <p v-if="deviceToDelete.jid"><strong>JID:</strong> <code>{{ deviceToDelete.jid }}</code></p>
                </div>
                <div class="ui warning message">
                    <div class="header">{{ copy.warning }}</div>
                    <p>{{ copy.deleteWarning }}</p>
                </div>
            </div>
            <div class="actions">
                <button class="ui cancel button">{{ copy.cancel }}</button>
                <button class="ui red approve button" :class="{loading: isDeleting}">
                    <i class="trash icon"></i>
                    {{ copy.deleteDevice }}
                </button>
            </div>
        </div>
    </div>
    `
}
