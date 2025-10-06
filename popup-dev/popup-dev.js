class DevPopup {
    constructor() {
        this.isRunning = false;
        this.initElements();
        this.bindEvents();
        this.listenToBackground();
    }

    initElements() {
        this.scenarioSelect = document.getElementById('scenarioSelect');
        this.stepSelect = document.getElementById('stepSelect');
        this.runScenarioBtn = document.getElementById('runScenarioBtn');
        this.stopScenarioBtn = document.getElementById('stopScenarioBtn');
        this.runStepBtn = document.getElementById('runStepBtn');
        this.clearLogBtn = document.getElementById('clearLogBtn');
        this.logContainer = document.getElementById('logContainer');
    }

    bindEvents() {
        this.runScenarioBtn.addEventListener('click', () => this.runScenario());
        this.stopScenarioBtn.addEventListener('click', () => this.stopScenario());
        this.runStepBtn.addEventListener('click', () => this.runStep());
        this.clearLogBtn.addEventListener('click', () => this.clearLog());
    }

    async runScenario() {
        const scenarioId = this.scenarioSelect.value;
        this.log(`📤 Запуск сценария: ${scenarioId}`);
        this.setRunning(true);
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'runScenario',
                scenarioId,
                params: { devMode: true }
            });
            if (response?.status === 'started') {
                this.log(`✅ Сценарий запущен (ID: ${response.instanceId})`);
            } else {
                throw new Error(response?.message || 'Неизвестная ошибка');
            }
        } catch (err) {
            this.log(`❌ Ошибка запуска: ${err.message}`, 'error');
            this.setRunning(false);
        }
    }

    async stopScenario() {
        this.log('📤 Остановка всех сценариев...');
        try {
            const response = await chrome.runtime.sendMessage({ action: 'stopAllScenarios' });
            if (response?.status === 'success') {
                this.log('✅ Сценарии остановлены', 'warn');
            }
        } catch (err) {
            this.log(`❌ Ошибка остановки: ${err.message}`, 'error');
        } finally {
            this.setRunning(false);
        }
    }

    async runStep() {
        const stepId = this.stepSelect.value;
        const scenarioId = this.scenarioSelect.value;
        this.log(`⏭️ Запуск этапа "${stepId}" для сценария "${scenarioId}"`);
        try {
            // В будущем можно добавить специальный action: "runStep"
            // Пока просто эмулируем через лог
            await chrome.runtime.sendMessage({
                action: 'runStep',
                scenarioId,
                stepId
            });
            this.log(`✅ Этап "${stepId}" завершён`);
        } catch (err) {
            this.log(`❌ Ошибка этапа: ${err.message}`, 'error');
        }
    }

    clearLog() {
        this.logContainer.innerHTML = '<div class="log-placeholder">Журнал пуст</div>';
    }

    log(message, level = 'info') {
        const placeholder = this.logContainer.querySelector('.log-placeholder');
        if (placeholder) placeholder.remove();

        const entry = document.createElement('div');
        entry.className = `log-entry log-${level}`;
        const time = new Date().toLocaleTimeString();
        entry.textContent = `[${time}] ${message}`;
        this.logContainer.appendChild(entry);
        this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }

    setRunning(isRunning) {
        this.isRunning = isRunning;
        this.runScenarioBtn.disabled = isRunning;
        this.stopScenarioBtn.disabled = !isRunning;
        this.runStepBtn.disabled = isRunning; // блокируем шаги во время сценария
    }

    listenToBackground() {
        chrome.runtime.onMessage.addListener((request) => {
            if (request.type === 'newLog' && request.log) {
                this.log(request.log.message, request.log.level || 'info');
            }
            if (request.type === 'scenarioStatus') {
                if (request.status === 'stopped' || request.status === 'finished') {
                    this.setRunning(false);
                }
            }
            if (request.type === 'logsCleared') {
                this.clearLog();
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => new DevPopup());