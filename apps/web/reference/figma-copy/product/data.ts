import type { ChannelId, StageId, Temp } from "./shared";

export interface Lead {
  id: string;
  name: string;
  channel: ChannelId;
  stage: StageId;
  temp: Temp;
  source: string;
  value: number;
  manager: string;
  service: string;
  lastMessage: string;
  time: string;
  unread: number;
  ai: boolean;
}

export const leads: Lead[] = [
  { id: "l1", name: "Анна Соколова", channel: "instagram", stage: "qualified", temp: "hot", source: "Реклама Instagram", value: 6500, manager: "Мария К.", service: "Окрашивание + стрижка", lastMessage: "Отлично, записывайте меня на пятницу!", time: "2 мин", unread: 2, ai: true },
  { id: "l2", name: "Дмитрий Орлов", channel: "whatsapp", stage: "new", temp: "warm", source: "Сайт", value: 12000, manager: "—", service: "Детейлинг авто", lastMessage: "Сколько стоит химчистка салона?", time: "8 мин", unread: 1, ai: true },
  { id: "l3", name: "Елена Васнецова", channel: "telegram", stage: "booked", temp: "hot", source: "Telegram-канал", value: 4200, manager: "Игорь П.", service: "Консультация врача", lastMessage: "Спасибо, буду в 15:00", time: "24 мин", unread: 0, ai: false },
  { id: "l4", name: "Игорь Лебедев", channel: "website", stage: "progress", temp: "warm", source: "Органика", value: 28000, manager: "Мария К.", service: "Курс английского", lastMessage: "А есть рассрочка на обучение?", time: "41 мин", unread: 0, ai: true },
  { id: "l5", name: "Ольга Кравцова", channel: "vk", stage: "new", temp: "cold", source: "VK группа", value: 3500, manager: "—", service: "Маникюр", lastMessage: "Здравствуйте, работаете в воскресенье?", time: "1 ч", unread: 3, ai: true },
  { id: "l6", name: "Павел Громов", channel: "email", stage: "crm", temp: "warm", source: "Email рассылка", value: 54000, manager: "Игорь П.", service: "Оптовый заказ", lastMessage: "Договор получил, согласовываю.", time: "2 ч", unread: 0, ai: false },
  { id: "l7", name: "Светлана Зайцева", channel: "call", stage: "closed", temp: "cold", source: "Звонок", value: 0, manager: "Мария К.", service: "Запись на ТО", lastMessage: "Передумала, спасибо.", time: "3 ч", unread: 0, ai: false },
  { id: "l8", name: "Артём Носов", channel: "instagram", stage: "qualified", temp: "hot", source: "Reels", value: 9800, manager: "—", service: "Татуировка", lastMessage: "Можно эскиз обсудить?", time: "4 ч", unread: 1, ai: true },
  { id: "l9", name: "Наталья Белова", channel: "whatsapp", stage: "booked", temp: "warm", source: "Рекомендация", value: 7300, manager: "Игорь П.", service: "SPA-программа", lastMessage: "Подтверждаю запись на субботу", time: "5 ч", unread: 0, ai: true },
  { id: "l10", name: "Кирилл Фомин", channel: "telegram", stage: "progress", temp: "warm", source: "Бот", value: 15500, manager: "Мария К.", service: "Ремонт техники", lastMessage: "Когда мастер сможет приехать?", time: "6 ч", unread: 0, ai: true },
];

export interface ChatMessage {
  id: string;
  from: "client" | "ai" | "manager";
  text: string;
  time: string;
}

export const conversation: ChatMessage[] = [
  { id: "m1", from: "client", text: "Здравствуйте! Хочу записаться на окрашивание, есть ли места на этой неделе?", time: "10:02" },
  { id: "m2", from: "ai", text: "Здравствуйте, Анна! 👋 Конечно, помогу с записью. Подскажите, окрашивание в один тон или сложное (мелирование, балаяж)?", time: "10:02" },
  { id: "m3", from: "client", text: "Хочу балаяж и потом подровнять длину", time: "10:05" },
  { id: "m4", from: "ai", text: "Отличный выбор! Балаяж + стрижка займёт около 3 часов, стоимость от 6 500 ₽. На этой неделе свободно: четверг 12:00, пятница 11:00 и 16:00. Какое время удобно?", time: "10:05" },
  { id: "m5", from: "client", text: "Пятница в 16:00 подойдёт", time: "10:08" },
  { id: "m6", from: "ai", text: "Записала вас на пятницу, 20 июня, 16:00 к мастеру Марии. За день пришлю напоминание. Уточните, пожалуйста, ваше имя и телефон для записи 🙌", time: "10:08" },
  { id: "m7", from: "client", text: "Анна Соколова, +7 999 123-45-67", time: "10:09" },
  { id: "m8", from: "ai", text: "Готово! ✅ Анна, ждём вас в пятницу в 16:00. Адрес: ул. Тверская, 12. Если планы изменятся — просто напишите.", time: "10:09" },
  { id: "m9", from: "client", text: "Отлично, записывайте меня на пятницу!", time: "10:10" },
];

export const quickReplies = [
  "Уточнить услугу",
  "Предложить время",
  "Отправить прайс",
  "Подтвердить запись",
  "Передать менеджеру",
];

export interface Activity {
  id: string;
  type: "lead" | "booking" | "crm" | "ai";
  text: string;
  time: string;
}

export const activity: Activity[] = [
  { id: "a1", type: "lead", text: "Новый лид от Анна Соколова через Instagram", time: "2 мин назад" },
  { id: "a2", type: "ai", text: "AI квалифицировал 4 обращения за последний час", time: "12 мин назад" },
  { id: "a3", type: "booking", text: "Создана запись: Балаяж + стрижка, пт 16:00", time: "18 мин назад" },
  { id: "a4", type: "crm", text: "Лид Павел Громов отправлен в amoCRM", time: "34 мин назад" },
  { id: "a5", type: "booking", text: "Оформлен заказ №2841 на сумму 12 400 ₽", time: "1 ч назад" },
  { id: "a6", type: "ai", text: "AI отправил 8 напоминаний о записи на завтра", time: "2 ч назад" },
];

export const channelPerformance: { channel: ChannelId; leads: number; conv: number }[] = [
  { channel: "instagram", leads: 412, conv: 31 },
  { channel: "whatsapp", leads: 388, conv: 38 },
  { channel: "telegram", leads: 256, conv: 34 },
  { channel: "website", leads: 198, conv: 27 },
  { channel: "vk", leads: 121, conv: 22 },
  { channel: "email", leads: 64, conv: 19 },
];

export const leadsByDay = [
  { day: "Пн", leads: 42, booked: 18 },
  { day: "Вт", leads: 51, booked: 24 },
  { day: "Ср", leads: 48, booked: 21 },
  { day: "Чт", leads: 63, booked: 29 },
  { day: "Пт", leads: 72, booked: 35 },
  { day: "Сб", leads: 58, booked: 27 },
  { day: "Вс", leads: 39, booked: 16 },
];

export const responseTrend = [
  { t: "00:00", sec: 16 }, { t: "04:00", sec: 14 }, { t: "08:00", sec: 22 },
  { t: "12:00", sec: 28 }, { t: "16:00", sec: 19 }, { t: "20:00", sec: 17 }, { t: "23:59", sec: 15 },
];

export const scenarioConv = [
  { name: "Запись на услугу", value: 38 },
  { name: "Консультация по прайсу", value: 31 },
  { name: "Оформление заказа", value: 27 },
  { name: "Повторное касание", value: 22 },
];
