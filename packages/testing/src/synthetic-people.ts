/**
 * Синтетические участники и учётные записи.
 *
 * Все имена, коды и адреса вымышлены и не относятся к реальным людям.
 * Реальные персональные данные в репозитории, seed, логах и скриншотах запрещены.
 * Изображения из каталога референсов не используются как аватары сотрудников.
 */

export interface SyntheticEmployee {
  readonly externalCode: string;
  readonly displayName: string;
  readonly jobTitle: string;
  readonly department: string;
}

/** Организация А: основной демонстрационный набор. */
export const SYNTHETIC_EMPLOYEES_A: readonly SyntheticEmployee[] = [
  {
    externalCode: 'A-001',
    displayName: 'Авдеева Мария Синтетическая',
    jobTitle: 'Специалист поддержки',
    department: 'Клиентский сервис',
  },
  {
    externalCode: 'A-002',
    displayName: 'Бельский Тимур Синтетический',
    jobTitle: 'Аналитик',
    department: 'Операции',
  },
  {
    externalCode: 'A-003',
    displayName: 'Ворохова Лидия Синтетическая',
    jobTitle: 'Старший специалист',
    department: 'Клиентский сервис',
  },
  {
    externalCode: 'A-004',
    displayName: 'Гнездилов Пётр Синтетический',
    jobTitle: 'Менеджер проектов',
    department: 'Операции',
  },
  {
    externalCode: 'A-005',
    displayName: 'Дорохина Ксения Синтетическая',
    jobTitle: 'Специалист по закупкам',
    department: 'Снабжение',
  },
  {
    externalCode: 'A-006',
    displayName: 'Ершов Аркадий Синтетический',
    jobTitle: 'Аналитик',
    department: 'Операции',
  },
  {
    externalCode: 'A-007',
    displayName: 'Жиганова Нина Синтетическая',
    jobTitle: 'Координатор',
    department: 'Клиентский сервис',
  },
  {
    externalCode: 'A-008',
    displayName: 'Заславский Игорь Синтетический',
    jobTitle: 'Специалист по закупкам',
    department: 'Снабжение',
  },
  {
    externalCode: 'A-009',
    displayName: 'Ильчук Вероника Синтетическая',
    jobTitle: 'Специалист поддержки',
    department: 'Клиентский сервис',
  },
  {
    externalCode: 'A-010',
    displayName: 'Кубрак Даниил Синтетический',
    jobTitle: 'Стажёр',
    department: 'Операции',
  },
];

/** Организация Б: нужна для проверки изоляции, наполнение минимальное. */
export const SYNTHETIC_EMPLOYEES_B: readonly SyntheticEmployee[] = [
  {
    externalCode: 'B-001',
    displayName: 'Лаврова Ольга Синтетическая',
    jobTitle: 'Технолог',
    department: 'Производство',
  },
  {
    externalCode: 'B-002',
    displayName: 'Мацкевич Роман Синтетический',
    jobTitle: 'Мастер участка',
    department: 'Производство',
  },
  {
    externalCode: 'B-003',
    displayName: 'Нурмухаметова Алия Синтетическая',
    jobTitle: 'Инженер',
    department: 'Производство',
  },
];

export interface SyntheticAccount {
  readonly key: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: 'platform_admin' | 'manager';
  readonly organizationCode?: string;
  readonly permissions?: readonly string[];
}

/**
 * Учётные записи demo-среды. Пароли не хранятся в коде: их генерирует seed
 * и выводит только в локальном запуске.
 */
export const SYNTHETIC_ACCOUNTS: readonly SyntheticAccount[] = [
  {
    key: 'admin',
    email: 'admin@synthetic.context.invalid',
    displayName: 'Администратор Платформы (синтетический)',
    role: 'platform_admin',
  },
  {
    key: 'manager_a',
    email: 'manager.a@synthetic.context.invalid',
    displayName: 'Руководитель Организации А (синтетический)',
    role: 'manager',
    organizationCode: 'demo_alpha',
    permissions: [
      'org.manage',
      'employees.manage',
      'assessments.manage',
      'reports.read',
      'study.manage',
    ],
  },
  {
    key: 'reviewer_a',
    email: 'reviewer.a@synthetic.context.invalid',
    displayName: 'Рецензент Организации А (синтетический)',
    role: 'manager',
    organizationCode: 'demo_alpha',
    permissions: ['reports.read', 'reports.review'],
  },
  {
    key: 'manager_b',
    email: 'manager.b@synthetic.context.invalid',
    displayName: 'Руководитель Организации Б (синтетический)',
    role: 'manager',
    organizationCode: 'demo_beta',
    permissions: ['org.manage', 'employees.manage', 'assessments.manage', 'reports.read'],
  },
];

export const SYNTHETIC_ORGANIZATIONS = [
  { code: 'demo_alpha', name: 'ООО «Альфа Синтетика»', timezone: 'Europe/Moscow' },
  { code: 'demo_beta', name: 'ООО «Бета Синтетика»', timezone: 'Asia/Yekaterinburg' },
] as const;
