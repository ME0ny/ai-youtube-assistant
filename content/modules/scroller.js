// content/modules/scroller.js

/**
 * Выполняет один шаг скроллинга страницы.
 * @param {number} step - На сколько пикселей скроллить.
 * @returns {Promise<void>}
 */
function performSingleScroll(step = 1000) {
    return new Promise((resolve) => {
        // Выполняем скролл
        window.scrollBy(0, step);
        // Небольшая задержка, чтобы дать странице немного отреагировать
        // Это может помочь, если YouTube подгружает контент лениво
        setTimeout(() => {
            console.log(`[Content Module Scroller] Выполнен один скролл на ${step}px.`);
            resolve();
        }, 50); // Небольшая задержка 50мс
    });
}

// Экспортируем функцию в глобальную область видимости
// Теперь она будет доступна как window.performSingleScroll
window.performSingleScroll = performSingleScroll;

console.log("[Content Module Scroller] Модуль загружен и готов.");