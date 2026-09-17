'use client';

import { motion, useReducedMotion, type Variants } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Обёртки движения. Все учитывают prefers-reduced-motion: при включённой
 * настройке контент появляется сразу, без смещения и прозрачности.
 *
 * Дерево элементов одинаково в обоих режимах: переключение настройки не
 * пересоздаёт дочерние компоненты и не сбрасывает их состояние.
 *
 * Анимация начинается только после монтирования: серверная разметка приходит
 * видимой (opacity 1), поэтому при ошибке или задержке JS страница читается,
 * а не остаётся пустой.
 */

const EASE = [0.2, 0, 0.1, 1] as const;

/**
 * Признак того, что первая (серверная) разметка уже гидратирована.
 * Флаг модульный: он переживает размонтирование страниц при переходах.
 */
let hydrated = false;

/**
 * Можно ли проигрывать появление.
 *
 * При первой загрузке — нет: разметка пришла с сервера видимой, и «пряталась»
 * бы уже показанная страница. При переходах внутри приложения — да:
 * элемент создаётся на клиенте и появляется плавно.
 */
function useEntrance(): boolean {
  const [animate] = useState(() => hydrated);
  useEffect(() => {
    hydrated = true;
  }, []);
  return animate;
}

export function FadeIn({
  children,
  delay = 0,
  y = 6,
  className,
}: {
  children: ReactNode;
  /** Задержка в секундах. */
  delay?: number;
  /** Начальное смещение по вертикали, px (не больше 8 по ТЗ). */
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const entrance = useEntrance();
  const animated = entrance && !reduce;

  return (
    <motion.div
      className={className}
      initial={animated ? { opacity: 0, y } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={animated ? { duration: 0.2, ease: EASE, delay } : { duration: 0 }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Контейнер поочерёдного появления. Задержку задаёт StaggerItem по индексу
 * и не дальше восьмого элемента: длинный список не «проявляется» секундами.
 */
export function Stagger({
  children,
  className,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'ul' | 'ol';
}) {
  const reduce = useReducedMotion();
  const entrance = useEntrance();
  const Component = as === 'ul' ? motion.ul : as === 'ol' ? motion.ol : motion.div;

  return (
    <Component
      className={className}
      initial={reduce || !entrance ? false : 'hidden'}
      animate="show"
      variants={{ hidden: {}, show: {} }}
    >
      {children}
    </Component>
  );
}

export function StaggerItem({
  children,
  className,
  as = 'div',
  index = 0,
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'li';
  /** Индекс в списке: задержка 30 мс × индекс, не дальше восьмого элемента. */
  index?: number;
}) {
  const reduce = useReducedMotion();
  const entrance = useEntrance();
  const animated = entrance && !reduce;
  const Component = as === 'li' ? motion.li : motion.div;
  const delay = Math.min(index, 7) * 0.03;
  const variants: Variants = {
    hidden: animated ? { opacity: 0, y: 6 } : { opacity: 1, y: 0 },
    show: {
      opacity: 1,
      y: 0,
      transition: animated ? { duration: 0.2, ease: EASE, delay } : { duration: 0 },
    },
  };

  return (
    <Component className={className} variants={variants}>
      {children}
    </Component>
  );
}

/** Мягкое появление страницы в template.tsx. */
export function PageTransition({ children }: { children: ReactNode }) {
  return <FadeIn className="min-w-0">{children}</FadeIn>;
}
