// ai/ai-service.js

/**
 * Отправляет промпт в GPT API и возвращает результат.
 * @param {string} prompt - Промпт для модели.
 * @returns {Promise<string>} Ответ от модели.
 */
export async function askGPT(prompt) {
    const response = await fetch('https://qwen-model-xrkk.onrender.com/ask', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer #O6m4W#$sana*rXqs&owLGU03VVg&HIDOHPH8UbYL%@iu02qmoS*9cu!%C@qZAZk'  // 👈 Изменено
        },
        body: JSON.stringify({ prompt })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ошибка API (${response.status}): ${errorText}`);
    }

    const result = await response.text();
    return result;
}