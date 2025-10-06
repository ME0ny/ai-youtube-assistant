// ai/transcription-service.js

const API_KEY = '68e161946f29331019306dcd'; // Ваш API-ключ
const API_URL = 'https://api.scrapingdog.com/youtube/transcripts';

/**
 * Получает транскрипцию видео по ID.
 * @param {string} videoId - ID видео.
 * @returns {Promise<Object>} Ответ API.
 */
async function getTranscript(videoId) {
    const response = await fetch(`${API_URL}?v=${videoId}&api_key=${API_KEY}`);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ошибка API (${response.status}): ${errorText}`);
    }
    return await response.json();
}

// --- Копируем логику из скрипта ---
function isSentenceEnd(text) {
    if (!text) return true;
    const trimmed = text.trim();
    if (trimmed === '') return true;
    const lastChar = trimmed.slice(-1);
    return '.!?'.includes(lastChar);
}

function findFirstSentenceEnd(text) {
    const match = /[.!?]/.exec(text);
    return match ? match.index + 1 : -1;
}

function secondsToHMS(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

function mergeBySentenceBoundaries(transcripts) {
    if (transcripts.length === 0) return [];

    const blocks = [];
    let currentText = transcripts[0].text;
    let currentStart = transcripts[0].start;

    for (let i = 1; i < transcripts.length; i++) {
        const next = transcripts[i];

        if (!isSentenceEnd(currentText)) {
            const pos = findFirstSentenceEnd(next.text);

            if (pos === -1) {
                currentText += ' ' + next.text;
            } else {
                const toAppend = next.text.slice(0, pos);
                const remainder = next.text.slice(pos).trim();

                currentText += ' ' + toAppend;
                blocks.push({ start: currentStart, text: currentText.trim() });

                currentText = remainder;
                currentStart = next.start;
            }
        } else {
            blocks.push({ start: currentStart, text: currentText.trim() });
            currentText = next.text;
            currentStart = next.start;
        }
    }

    if (currentText.trim() !== '') {
        blocks.push({ start: currentStart, text: currentText.trim() });
    }

    return blocks;
}

function estimateTokens(text) {
    return Math.ceil((text?.length || 0) / 2.7);
}

function splitIntoChunks(lines, maxTokens = 3000) { // 3000 как в примере
    const chunks = [];
    let current = [];
    let currentText = '';

    for (const line of lines) {
        const candidate = currentText === '' ? line : currentText + '\n' + line;
        if (estimateTokens(candidate) <= maxTokens) {
            currentText = candidate;
            current.push(line);
        } else {
            if (current.length === 0) {
                chunks.push([line]);
                currentText = '';
            } else {
                chunks.push([...current]);
                current = [line];
                currentText = line;
            }
        }
    }

    if (current.length > 0) chunks.push(current);
    return chunks;
}

/**
 * Обрабатывает транскрипцию и возвращает массив чанков.
 * @param {Array} transcripts - Массив транскрипций.
 * @returns {Array<string>} Массив строк (чанки).
 */
function processTranscript(transcripts) {
    const blocks = mergeBySentenceBoundaries(transcripts);
    const lines = blocks.map(item => {
        const timeStr = secondsToHMS(item.start);
        return `${timeStr}: ${item.text}`;
    });
    const chunks = splitIntoChunks(lines);
    return chunks.map(chunk => chunk.join('\n'));
}

/**
 * Получает и обрабатывает транскрипцию для видео.
 * @param {string} videoId - ID видео.
 * @returns {Promise<Array<string>>} Массив чанков.
 */
export async function getProcessedTranscript(videoId) {
    const data = await getTranscript(videoId);
    if (!data.transcripts || !Array.isArray(data.transcripts)) {
        throw new Error(`Транскрипция отсутствует или неверный формат для видео ${videoId}`);
    }
    return processTranscript(data.transcripts);
}