class PopupApp {
    constructor() {
        this.initElements();
        this.bindEvents();
        this.loadHistory();
        this.listenToBackground();
    }

    initElements() {
        this.introSection = document.getElementById('introSection');
        this.chatHistoryEl = document.getElementById('chatHistory');
        this.progressIndicator = document.getElementById('progressIndicator');
        this.progressText = document.getElementById('progressText');
        this.userInput = document.getElementById('userInput');
        this.sendButton = document.getElementById('sendButton');
        this.clearHistoryBtn = document.getElementById('clearHistoryBtn');

        this.isProcessing = false;
        this.lastLogElement = null;
    }

    bindEvents() {
        this.sendButton.addEventListener('click', () => this.submitQuery());
        this.userInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.submitQuery();
        });
        this.clearHistoryBtn.addEventListener('click', () => this.clearHistory());
    }

    listenToBackground() {
        chrome.runtime.onMessage.addListener((request) => {
            // Обработка логов от сценария
            if (request.type === 'newLog' && request.log) {
                const { message, module } = request.log;
                // Показываем только логи от сценария
                if (module && module.startsWith('Scenario:')) {
                    this.showTemporaryLog(message);
                }
            }

            // Обработка статуса сценария
            if (request.type === 'scenarioStatus') {
                if (request.status === 'started') {
                    this.setProcessing(true);
                } else if (request.status === 'finished') {
                    this.setProcessing(false);
                    // Ждём немного, чтобы storage успел обновиться
                    setTimeout(() => this.loadAndDisplayResult(), 300);
                } else if (request.status === 'stopped') {
                    this.setProcessing(false);
                    this.addMessage('❌ Сценарий остановлен.', 'system');
                }
            }
        });
    }

    async loadHistory() {
        const res = await chrome.storage.local.get(['chatHistory']);
        this.chatHistory = res.chatHistory || [];
        this.renderHistory();
    }

    renderHistory() {
        this.chatHistoryEl.innerHTML = '';
        for (const item of this.chatHistory) {
            this.addMessage(item.query, 'user', false);
            if (item.log) this.addMessage(item.log, 'system', false);
            if (item.result) this.addResult(item.result, false);
        }
        this.updateIntro();
    }

    async submitQuery() {
        if (this.isProcessing) return;
        const query = this.userInput.value.trim();
        if (!query) return;

        this.addMessage(query, 'user');
        this.userInput.value = '';
        this.setProcessing(true);

        try {
            const response = await chrome.runtime.sendMessage({
                action: "runScenario",
                scenarioId: "ai-video-recommendation",
                params: { userQuery: query }
            });

            if (!response?.instanceId) {
                throw new Error('Не удалось запустить сценарий');
            }
        } catch (err) {
            this.addMessage(`❌ Ошибка: ${err.message}`, 'system');
            this.setProcessing(false);
        }
    }

    showTemporaryLog(message) {
        // Удаляем предыдущий временный лог
        if (this.lastLogElement && this.lastLogElement.parentNode) {
            this.lastLogElement.remove();
        }

        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble response-bubble';
        bubble.textContent = message;
        this.chatHistoryEl.appendChild(bubble);
        this.lastLogElement = bubble;
        this.chatHistoryEl.scrollTop = this.chatHistoryEl.scrollHeight;
    }

    addMessage(text, sender, save = true) {
        // Удаляем временный лог
        if (this.lastLogElement && this.lastLogElement.parentNode) {
            this.lastLogElement.remove();
            this.lastLogElement = null;
        }

        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${sender === 'user' ? '' : 'response-bubble'}`;
        bubble.textContent = text;
        this.chatHistoryEl.appendChild(bubble);
        this.chatHistoryEl.scrollTop = this.chatHistoryEl.scrollHeight;

        if (save) {
            if (sender === 'user') {
                this.chatHistory.push({ query: text });
            } else {
                const last = this.chatHistory[this.chatHistory.length - 1];
                if (last) last.log = text;
            }
            chrome.storage.local.set({ chatHistory: this.chatHistory });
        }
        this.updateIntro();
    }

    addResult(result, save = true) {
        const container = document.createElement('div');
        container.className = 'result-container';

        for (const video of result) {
            const block = document.createElement('div');
            block.className = 'video-result-block';

            const link = document.createElement('a');
            link.href = `https://www.youtube.com/watch?v=${video.videoId}`;
            link.target = '_blank';
            link.textContent = `${video.title} (Оценка: ${video.score})`;
            link.className = 'video-title-link';
            block.appendChild(link);

            const clipsContainer = document.createElement('div');
            clipsContainer.className = 'clips-container';

            if (video.clips?.length) {
                for (const clip of video.clips) {
                    const clipBlock = document.createElement('div');
                    clipBlock.className = 'clip-block';

                    const startSec = this.timeToSeconds(clip.start);
                    const endSec = this.timeToSeconds(clip.end);

                    const iframe = document.createElement('iframe');
                    iframe.width = '320';
                    iframe.height = '180';
                    iframe.src = `https://www.youtube.com/embed/${video.videoId}?start=${startSec}&end=${endSec}`;
                    iframe.frameBorder = '0';
                    iframe.allowFullscreen = true;
                    clipBlock.appendChild(iframe);

                    const info = document.createElement('div');
                    info.className = 'clip-info';
                    info.textContent = `${clip.title} (${clip.start} – ${clip.end})`;
                    clipBlock.appendChild(info);

                    clipsContainer.appendChild(clipBlock);
                }
            } else {
                const noClips = document.createElement('div');
                noClips.className = 'no-clips';
                noClips.textContent = 'Нарезки не найдены.';
                clipsContainer.appendChild(noClips);
            }

            block.appendChild(clipsContainer);
            container.appendChild(block);
        }

        this.chatHistoryEl.appendChild(container);
        this.chatHistoryEl.scrollTop = this.chatHistoryEl.scrollHeight;

        if (save) {
            const last = this.chatHistory[this.chatHistory.length - 1];
            if (last) last.result = result;
            chrome.storage.local.set({ chatHistory: this.chatHistory });
        }
    }

    timeToSeconds(timeStr) {
        if (!timeStr) return 0;
        const parts = timeStr.split(':').map(Number);
        if (parts.length === 2) {
            // MM:SS
            const [m, s] = parts;
            return m * 60 + s;
        } else if (parts.length === 3) {
            // HH:MM:SS
            const [h, m, s] = parts;
            return h * 3600 + m * 60 + s;
        }
        // fallback: попытка распарсить как число
        const num = Number(timeStr);
        return isNaN(num) ? 0 : num;
    }

    setProcessing(isProcessing) {
        this.isProcessing = isProcessing;
        this.userInput.disabled = isProcessing;
        this.sendButton.disabled = isProcessing;
        this.progressIndicator.classList.toggle('hidden', !isProcessing);
        if (isProcessing) {
            this.progressText.textContent = 'Обработка...';
        }
    }

    async loadAndDisplayResult() {
        try {
            // Повторяем попытку чтения, если результат ещё не записан
            let attempts = 0;
            let results;
            while (attempts < 5) {
                const data = await chrome.storage.local.get(['aiScenarioResults']);
                results = data.aiScenarioResults;
                if (Array.isArray(results) && results.length > 0) break;
                await new Promise(r => setTimeout(r, 200));
                attempts++;
            }

            if (!results || results.length === 0) {
                this.addMessage('⚠️ Результаты не найдены.', 'system');
                return;
            }

            this.addResult(results);
        } catch (err) {
            this.addMessage(`❌ Ошибка загрузки результата: ${err.message}`, 'system');
        }
    }

    updateIntro() {
        this.introSection.classList.toggle('hidden', this.chatHistory.length > 0);
    }

    async clearHistory() {
        if (!confirm('Очистить историю?')) return;
        this.chatHistory = [];
        this.chatHistoryEl.innerHTML = '';
        this.lastLogElement = null;
        await chrome.storage.local.set({ chatHistory: [], aiScenarioResults: null });
        this.updateIntro();
    }
}

document.addEventListener('DOMContentLoaded', () => new PopupApp());