'use client';

/**
 * Последняя граница ошибок.
 *
 * Отрисовывает собственный документ: корневой макет в этот момент недоступен.
 * Наружу выводится понятная причина и идентификатор для поддержки — без
 * стека вызовов, путей файлов и любых данных организации.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#f7f5f0',
          color: '#242821',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          padding: '16px',
        }}
      >
        <main
          style={{
            maxWidth: '520px',
            background: '#ffffff',
            border: '1px solid #dddcd3',
            borderRadius: '24px',
            padding: '24px',
          }}
        >
          <h1 style={{ fontSize: '24px', margin: 0 }}>Что-то пошло не так</h1>
          <p style={{ marginTop: '12px', color: '#596255' }}>
            Страница не открылась из-за технической ошибки. Данные не потеряны: попробуйте повторить
            или обновите страницу.
          </p>
          {error.digest ? (
            <p style={{ marginTop: '12px', fontSize: '12px', color: '#596255' }}>
              Код для поддержки: <code>{error.digest}</code>
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '20px',
              minHeight: '44px',
              padding: '0 20px',
              borderRadius: '12px',
              border: 'none',
              background: '#35594a',
              color: '#ffffff',
              fontSize: '16px',
              cursor: 'pointer',
            }}
          >
            Повторить
          </button>
        </main>
      </body>
    </html>
  );
}
