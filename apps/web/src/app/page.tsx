import { redirect } from 'next/navigation';

/**
 * Корень приложения.
 *
 * Публичной витрины здесь нет: платформа — рабочий инструмент, вход начинается
 * со страницы авторизации. Маркетинговый сайт вне объёма продукта.
 */
export default function RootPage(): never {
  redirect('/login');
}
