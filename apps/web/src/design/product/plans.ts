export interface Plan {
  id: string;
  name: string;
  price: string;
  priceNote: string;
  tagline: string;
  popular?: boolean;
  features: string[];
  cta: string;
}

export const plans: Plan[] = [
  {
    id: "start",
    name: "Start",
    price: "9 900 ₽",
    priceNote: "в месяц",
    tagline: "Для малого бизнеса и теста одного AI-сценария",
    cta: "Начать со Start",
    features: [
      "500 AI-диалогов",
      "2 канала подключения",
      "3 пользователя",
      "3 сценария",
      "Базовая аналитика",
      "Передача лидов в CRM",
    ],
  },
  {
    id: "pro",
    name: "Professional",
    price: "24 900 ₽",
    priceNote: "в месяц",
    tagline: "Оптимальный выбор для большинства команд",
    popular: true,
    cta: "Выбрать Professional",
    features: [
      "2 500 AI-диалогов",
      "5 каналов подключения",
      "10 пользователей",
      "15 сценариев",
      "Расширенная аналитика и отчёты",
      "Конструктор автоматизаций",
      "Приоритетная поддержка",
    ],
  },
  {
    id: "business",
    name: "Business",
    price: "59 900 ₽",
    priceNote: "в месяц",
    tagline: "Для активных отделов продаж и нескольких направлений",
    cta: "Выбрать Business",
    features: [
      "10 000 AI-диалогов",
      "10 каналов подключения",
      "25 пользователей",
      "50 сценариев",
      "AI-рекомендации и инсайты",
      "A/B-тесты сценариев",
      "Менеджер аккаунта",
    ],
  },
  {
    id: "corporate",
    name: "Corporate",
    price: "от 120 000 ₽",
    priceNote: "в месяц",
    tagline: "Для сетей, клиник, e-commerce и холдингов",
    cta: "Связаться с нами",
    features: [
      "Индивидуальные лимиты",
      "SLA и гарантии доступности",
      "Кастомные интеграции",
      "Выделенная инфраструктура",
      "Обучение команды",
      "Персональный менеджер 24/7",
    ],
  },
];
