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

    // popup-dev/popup-dev.js → метод runStep()
    async runStep() {
        const stepId = this.stepSelect.value;
        const scenarioId = this.scenarioSelect.value;

        if (stepId === 'step-scroll') {
            this.log(`⏭️ Запуск этапа: Скролл страницы`);
            try {
                const response = await chrome.runtime.sendMessage({
                    action: "runScrollStep",
                    params: {
                        count: 10,      // количество скроллов
                        delayMs: 500, // задержка между скроллами
                        step: 1000     // пикселей за раз
                    }
                });
                if (response?.status === 'success') {
                    this.log(`✅ Скролл завершён`);
                } else {
                    throw new Error(response?.message || 'Неизвестная ошибка');
                }
            } catch (err) {
                this.log(`❌ Ошибка скролла: ${err.message}`, 'error');
            }
            return;
        }

        if (stepId === 'step-parse-videos') {
            this.log(`⏭️ Запуск этапа: Парсинг всех видео...`);
            try {
                const response = await chrome.runtime.sendMessage({
                    action: "runParseVideosStep" // ← Обновлённый action
                });
                if (response?.status === 'success') {
                    const count = response.data.length;
                    this.log(`✅ Успешно спарсено ${count} видео.`, 'success');
                    console.table(response.data); // Вывод в консоль для удобства
                } else {
                    throw new Error(response?.message || 'Неизвестная ошибка');
                }
            } catch (err) {
                this.log(`❌ Ошибка парсинга: ${err.message}`, 'error');
            }
            return;
        }

        if (stepId === 'step-gpt-get-top10-by-title') {
            const userQuery = document.getElementById('userQueryInput').value.trim();
            if (!userQuery) {
                this.log(`❌ Пустой запрос пользователя.`, 'error');
                return;
            }

            this.log(`⏭️ Запуск этапа: GPT — получить топ-10 видео по названию...`, 'info');
            this.log(`📝 Запрос пользователя: "${userQuery}"`, 'info');

            try {
                const response = await chrome.runtime.sendMessage({
                    action: "runGPTGetTop10ByTitleStep", // 👈 Изменено имя
                    params: { userQuery }
                });

                if (response?.status === 'success') {
                    this.log(`✅ Топ-10 видео от GPT:`, 'success');
                    console.table(response.data); // Вывод в консоль как таблицу
                    for (const item of response.data) {
                        this.log(`${item.title};${item.videoId};${item.relevanceScore10}`, 'info');
                    }
                } else {
                    throw new Error(response?.message || 'Неизвестная ошибка');
                }
            } catch (err) {
                this.log(`❌ Ошибка получения топ-10: ${err.message}`, 'error');
            }
            return;
        }

        if (stepId === 'step-transcription') {
            const top10Json = document.getElementById('top10JsonInput').value.trim();
            if (!top10Json) {
                this.log(`❌ Пустой JSON с топ-10 видео.`, 'error');
                return;
            }

            this.log(`⏭️ Запуск этапа: Формирование транскрибации...`, 'info');

            try {
                const response = await chrome.runtime.sendMessage({
                    action: "runTranscriptionStep",
                    params: { top10Json }
                });

                if (response?.status === 'success') {
                    this.log(`✅ Результаты транскрипции:`, 'success');

                    // --- Новый формат вывода ---
                    const output = response.results.map(item => {
                        const transcript = item.chunks.map((chunkText, index) => ({
                            chunk: index + 1,
                            chunk_text: chunkText
                        }));

                        return {
                            title: item.title,
                            videoID: item.videoId, // Используем videoId из top10Json
                            transcript
                        };
                    });

                    console.group('📋 Результат транскрипции (скопируйте ниже):');
                    console.table(output); // Вывод в виде таблицы
                    console.groupEnd();

                    // Для удобства копирования — выводим как объект
                    console.log('📋 Полный объект (для копирования):');
                    console.log(JSON.stringify(output, null, 2));

                    // Выводим в журнал popup
                    this.log(`Всего обработано видео: ${output.length}`, 'info');
                } else {
                    throw new Error(response?.message || 'Неизвестная ошибка');
                }
            } catch (err) {
                this.log(`❌ Ошибка транскрипции: ${err.message}`, 'error');
            }
            return;
        }
        // ... остальные этапы
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