import {
  BarChart3,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Database,
  Globe,
  Inbox,
  Instagram,
  Mail,
  MessageCircle,
  Send,
  Sparkles,
  Users,
  Workflow
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ChannelId = "instagram" | "whatsapp" | "telegram" | "website" | "email" | "webhook";
export type LeadStage = "new" | "progress" | "qualified" | "booked" | "crm" | "closed" | "lost";

export const channels: Record<ChannelId, { label: string; icon: LucideIcon; color: string; bg: string }> = {
  instagram: { label: "Instagram", icon: Instagram, color: "text-pink-300", bg: "bg-pink-500/10" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: "text-emerald-300", bg: "bg-emerald-500/10" },
  telegram: { label: "Telegram", icon: Send, color: "text-sky-300", bg: "bg-sky-500/10" },
  website: { label: "Сайт", icon: Globe, color: "text-indigo-300", bg: "bg-indigo-500/10" },
  email: { label: "Почта", icon: Mail, color: "text-amber-300", bg: "bg-amber-500/10" },
  webhook: { label: "Webhook", icon: Database, color: "text-teal-300", bg: "bg-teal-500/10" }
};

export const stageLabels: Record<LeadStage, string> = {
  new: "Новый",
  progress: "В работе",
  qualified: "Квалифицирован",
  booked: "Записан / Заказ",
  crm: "Отправлен в CRM",
  closed: "Закрыт",
  lost: "Потерян"
};

export interface DemoLead {
  id: string;
  name: string;
  channel: ChannelId;
  stage: LeadStage;
  source: string;
  value: number;
  manager: string;
  interest: string;
  lastMessage: string;
  time: string;
  unread: number;
  ai: boolean;
  temperature: "Hot" | "Warm" | "Cold";
}

export const leads: DemoLead[] = [
  {
    id: "lead-anna",
    name: "Анна Соколова",
    channel: "instagram",
    stage: "booked",
    source: "Реклама Instagram",
    value: 6500,
    manager: "Мария К.",
    interest: "Балаяж и стрижка",
    lastMessage: "Пятница в 16:00 подходит. Запишите меня, пожалуйста.",
    time: "2 мин",
    unread: 2,
    ai: true,
    temperature: "Hot"
  },
  {
    id: "lead-dmitry",
    name: "Дмитрий Орлов",
    channel: "website",
    stage: "progress",
    source: "Виджет сайта",
    value: 12000,
    manager: "Не назначен",
    interest: "Детейлинг авто",
    lastMessage: "Сколько стоит химчистка салона?",
    time: "8 мин",
    unread: 1,
    ai: true,
    temperature: "Warm"
  },
  {
    id: "lead-elena",
    name: "Елена Васнецова",
    channel: "telegram",
    stage: "qualified",
    source: "Telegram-бот",
    value: 4200,
    manager: "Игорь П.",
    interest: "Запись в клинику",
    lastMessage: "Спасибо, 15:00 подходит.",
    time: "24 мин",
    unread: 0,
    ai: false,
    temperature: "Hot"
  },
  {
    id: "lead-igor",
    name: "Игорь Лебедев",
    channel: "email",
    stage: "crm",
    source: "Email-кампания",
    value: 54000,
    manager: "Мария К.",
    interest: "B2B-заказ",
    lastMessage: "Договор получили, проверяем с финансами.",
    time: "2 ч",
    unread: 0,
    ai: false,
    temperature: "Warm"
  },
  {
    id: "lead-olga",
    name: "Ольга Кравцова",
    channel: "whatsapp",
    stage: "new",
    source: "Рекомендация",
    value: 3500,
    manager: "Не назначен",
    interest: "Маникюр",
    lastMessage: "Вы работаете в воскресенье?",
    time: "1 ч",
    unread: 3,
    ai: true,
    temperature: "Cold"
  }
];

export const messages = [
  { id: "m1", sender: "customer" as const, text: "Здравствуйте! Есть окно на балаяж на этой неделе?", time: "10:02" },
  { id: "m2", sender: "ai" as const, text: "Да, помогу. Нужен балаяж вместе со стрижкой?", time: "10:02" },
  { id: "m3", sender: "customer" as const, text: "Да, балаяж и подровнять концы.", time: "10:05" },
  { id: "m4", sender: "ai" as const, text: "Отлично. Есть пятница 11:00 или 16:00. Какое время удобнее?", time: "10:05" },
  { id: "m5", sender: "customer" as const, text: "Пятница в 16:00 подходит. Запишите меня, пожалуйста.", time: "10:08" },
  { id: "m6", sender: "ai" as const, text: "Готово. Я подготовил запись и сохранил детали лида для команды.", time: "10:08" }
];

export const dashboardMetrics = [
  { icon: Inbox, label: "Новые лиды", value: "128", delta: "+18%" },
  { icon: Bot, label: "AI-диалоги", value: "2 481", delta: "+31%" },
  { icon: CalendarCheck, label: "Записи/заказы", value: "342", delta: "+12%" },
  { icon: Database, label: "Отправлено в CRM", value: "219", delta: "+24%" },
  { icon: Sparkles, label: "Среднее время ответа", value: "18 сек", delta: "-43%" },
  { icon: CheckCircle2, label: "Конверсия", value: "31,4%", delta: "+4,8%" }
];

export const activity = [
  "AI квалифицировал Анну Соколову из Instagram",
  "Черновик записи создан на пятницу, 16:00",
  "Дмитрий Орлов спросил стоимость детейлинга",
  "Лид Игорь Лебедев синхронизирован с amoCRM",
  "Follow-up вернул 8 неактивных диалогов"
];

export const chartData = [
  { name: "Пн", leads: 42, booked: 18 },
  { name: "Вт", leads: 51, booked: 24 },
  { name: "Ср", leads: 48, booked: 21 },
  { name: "Чт", leads: 63, booked: 29 },
  { name: "Пт", leads: 72, booked: 35 },
  { name: "Сб", leads: 58, booked: 27 },
  { name: "Вс", leads: 39, booked: 16 }
];

export const workflows = [
  { icon: Workflow, title: "Запись клиента", status: "Active", steps: 7 },
  { icon: MessageCircle, title: "Квалификация лида", status: "Draft", steps: 5 },
  { icon: Users, title: "Передача менеджеру", status: "Paused", steps: 4 },
  { icon: BarChart3, title: "Возврат follow-up", status: "Active", steps: 6 }
];

export const pricingPlans = [
  {
    name: "Старт",
    price: "9 900 ₽",
    note: "/ месяц",
    bestFor: "малый бизнес и тест одного AI-сценария",
    features: ["500 AI-диалогов", "2 канала", "3 пользователя", "3 сценария", "Базовый inbox"]
  },
  {
    name: "Профессиональный",
    price: "24 900 ₽",
    note: "/ месяц",
    bestFor: "основной рекомендуемый план",
    popular: true,
    features: ["2 500 AI-диалогов", "5 каналов", "10 пользователей", "15 сценариев", "CRM + календарь"]
  },
  {
    name: "Бизнес",
    price: "59 900 ₽",
    note: "/ месяц",
    bestFor: "активные отделы продаж и несколько направлений",
    features: ["10 000 AI-диалогов", "10 каналов", "25 пользователей", "50 сценариев", "Расширенная аналитика"]
  },
  {
    name: "Корпоративный",
    price: "от 120 000 ₽",
    note: "/ месяц",
    bestFor: "сети, клиники, e-commerce и холдинги",
    features: ["Индивидуальные лимиты", "SLA", "Кастомные интеграции", "Персональный менеджер внедрения"]
  }
];
