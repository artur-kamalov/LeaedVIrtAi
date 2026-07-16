import { defaultLocale, supportedLocales, type Locale } from "./config";

const en = {
  "widget.status.failed": "Failed",
  "widget.status.sent": "Sent",
  "widget.error.load": "Chat is temporarily unavailable. Please try again.",
  "widget.error.send": "The message was not sent. Please try again.",
  "widget.fallback.subtitle": "AI assistant",
  "widget.fallback.reply.booking": "I want to book",
  "widget.fallback.reply.price": "How much does it cost?",
  "widget.fallback.reply.manager": "Talk to a person",
  "widget.chat.label": "LeadVirt.ai chat widget",
  "widget.chat.close": "Close chat",
  "widget.chat.loading": "Loading chat",
  "widget.chat.placeholder": "Write a message...",
  "widget.chat.send": "Send message",
  "widget.chat.secure": "Secure session",
  "widget.chat.open": "Open chat",
  "widget.chat.typing": "Assistant is typing",
  "widget.frame.missing.title": "LeadVirt widget key is required",
  "widget.frame.missing.detail":
    "Add `data-leadvirt-key` to the embed script or pass `?key=...` to the frame URL.",
  "widget.demo.badge": "Live widget demo",
  "widget.demo.title": "LeadVirt.ai website widget",
  "widget.demo.description":
    "The customer chat is connected to the demo workspace, lead pipeline, inbox, and LeadVirt.ai assistant.",
  "widget.demo.stat.session": "Session",
  "widget.demo.stat.sessionValue": "Stored in this browser",
  "widget.demo.stat.channel": "Channel",
  "widget.demo.stat.channelValue": "Website",
  "widget.demo.stat.ai": "AI",
  "widget.demo.stat.aiValue": "Demo assistant",
  "widget.demo.preview.eyebrow": "Book an appointment",
  "widget.demo.preview.title": "Bookings, prices, and lead capture in one chat",
  "widget.demo.preview.description":
    "This preview looks like a business website while the chat uses the local demo flow without writing to the database.",
  "widget.demo.service.coloring": "Hair coloring",
  "widget.demo.service.detailing": "Car detailing",
  "widget.demo.service.consultation": "Consultation",
  "widget.demo.service.order": "Product order",
} as const;

type WidgetMessageKey = keyof typeof en;
type WidgetCatalog = Record<WidgetMessageKey, string>;

const es: WidgetCatalog = {
  "widget.status.failed": "Error",
  "widget.status.sent": "Enviado",
  "widget.error.load": "El chat no está disponible temporalmente. Inténtalo de nuevo.",
  "widget.error.send": "El mensaje no se ha enviado. Inténtalo de nuevo.",
  "widget.fallback.subtitle": "Asistente de IA",
  "widget.fallback.reply.booking": "Quiero reservar",
  "widget.fallback.reply.price": "¿Cuánto cuesta?",
  "widget.fallback.reply.manager": "Hablar con una persona",
  "widget.chat.label": "Widget de chat de LeadVirt.ai",
  "widget.chat.close": "Cerrar chat",
  "widget.chat.loading": "Cargando el chat",
  "widget.chat.placeholder": "Escribe un mensaje...",
  "widget.chat.send": "Enviar mensaje",
  "widget.chat.secure": "Sesión segura",
  "widget.chat.open": "Abrir chat",
  "widget.chat.typing": "El asistente está escribiendo",
  "widget.frame.missing.title": "Se necesita la clave del widget de LeadVirt",
  "widget.frame.missing.detail":
    "Añade `data-leadvirt-key` al script de inserción o pasa `?key=...` en la URL del marco.",
  "widget.demo.badge": "Demo del widget en vivo",
  "widget.demo.title": "Widget de LeadVirt.ai para sitios web",
  "widget.demo.description":
    "El chat del cliente está conectado al espacio demo, al embudo de leads, a la bandeja de entrada y al asistente de LeadVirt.ai.",
  "widget.demo.stat.session": "Sesión",
  "widget.demo.stat.sessionValue": "Guardada en este navegador",
  "widget.demo.stat.channel": "Canal",
  "widget.demo.stat.channelValue": "Sitio web",
  "widget.demo.stat.ai": "IA",
  "widget.demo.stat.aiValue": "Asistente demo",
  "widget.demo.preview.eyebrow": "Reservar una cita",
  "widget.demo.preview.title": "Reservas, precios y captación de leads en un solo chat",
  "widget.demo.preview.description":
    "La vista previa parece un sitio web de empresa, mientras el chat usa el flujo demo local sin escribir en la base de datos.",
  "widget.demo.service.coloring": "Coloración",
  "widget.demo.service.detailing": "Detallado de vehículos",
  "widget.demo.service.consultation": "Consulta",
  "widget.demo.service.order": "Pedido de producto",
};

const fr: WidgetCatalog = {
  "widget.status.failed": "Échec",
  "widget.status.sent": "Envoyé",
  "widget.error.load": "Le chat est temporairement indisponible. Réessayez.",
  "widget.error.send": "Le message n'a pas été envoyé. Réessayez.",
  "widget.fallback.subtitle": "Assistant IA",
  "widget.fallback.reply.booking": "Je veux réserver",
  "widget.fallback.reply.price": "Combien cela coûte ?",
  "widget.fallback.reply.manager": "Parler à une personne",
  "widget.chat.label": "Widget de chat LeadVirt.ai",
  "widget.chat.close": "Fermer le chat",
  "widget.chat.loading": "Chargement du chat",
  "widget.chat.placeholder": "Écrivez un message...",
  "widget.chat.send": "Envoyer le message",
  "widget.chat.secure": "Session sécurisée",
  "widget.chat.open": "Ouvrir le chat",
  "widget.chat.typing": "L'assistant écrit",
  "widget.frame.missing.title": "La clé du widget LeadVirt est requise",
  "widget.frame.missing.detail":
    "Ajoutez `data-leadvirt-key` au script d'intégration ou passez `?key=...` dans l'URL du cadre.",
  "widget.demo.badge": "Démo du widget en direct",
  "widget.demo.title": "Widget LeadVirt.ai pour site web",
  "widget.demo.description":
    "Le chat client est connecté à l'espace de démonstration, au pipeline de prospects, à la boîte de réception et à l'assistant LeadVirt.ai.",
  "widget.demo.stat.session": "Session",
  "widget.demo.stat.sessionValue": "Conservée dans ce navigateur",
  "widget.demo.stat.channel": "Canal",
  "widget.demo.stat.channelValue": "Site web",
  "widget.demo.stat.ai": "IA",
  "widget.demo.stat.aiValue": "Assistant de démonstration",
  "widget.demo.preview.eyebrow": "Prendre rendez-vous",
  "widget.demo.preview.title": "Réservations, tarifs et collecte de prospects dans un seul chat",
  "widget.demo.preview.description":
    "Cet aperçu ressemble au site d'une entreprise, tandis que le chat utilise le parcours de démonstration local sans écrire dans la base de données.",
  "widget.demo.service.coloring": "Coloration",
  "widget.demo.service.detailing": "Esthétique automobile",
  "widget.demo.service.consultation": "Consultation",
  "widget.demo.service.order": "Commande de produit",
};

const de: WidgetCatalog = {
  "widget.status.failed": "Fehlgeschlagen",
  "widget.status.sent": "Gesendet",
  "widget.error.load": "Der Chat ist vorübergehend nicht verfügbar. Versuchen Sie es erneut.",
  "widget.error.send": "Die Nachricht wurde nicht gesendet. Versuchen Sie es erneut.",
  "widget.fallback.subtitle": "KI-Assistent",
  "widget.fallback.reply.booking": "Ich möchte buchen",
  "widget.fallback.reply.price": "Wie viel kostet es?",
  "widget.fallback.reply.manager": "Mit einer Person sprechen",
  "widget.chat.label": "LeadVirt.ai Chat-Widget",
  "widget.chat.close": "Chat schließen",
  "widget.chat.loading": "Chat wird geladen",
  "widget.chat.placeholder": "Nachricht schreiben...",
  "widget.chat.send": "Nachricht senden",
  "widget.chat.secure": "Sichere Sitzung",
  "widget.chat.open": "Chat öffnen",
  "widget.chat.typing": "Der Assistent schreibt",
  "widget.frame.missing.title": "Der LeadVirt-Widget-Schlüssel ist erforderlich",
  "widget.frame.missing.detail":
    "Fügen Sie `data-leadvirt-key` zum Einbettungsskript hinzu oder übergeben Sie `?key=...` in der Frame-URL.",
  "widget.demo.badge": "Live-Widget-Demo",
  "widget.demo.title": "LeadVirt.ai Website-Widget",
  "widget.demo.description":
    "Der Kundenchat ist mit dem Demo-Arbeitsbereich, der Lead-Pipeline, dem Posteingang und dem LeadVirt.ai-Assistenten verbunden.",
  "widget.demo.stat.session": "Sitzung",
  "widget.demo.stat.sessionValue": "In diesem Browser gespeichert",
  "widget.demo.stat.channel": "Kanal",
  "widget.demo.stat.channelValue": "Website",
  "widget.demo.stat.ai": "KI",
  "widget.demo.stat.aiValue": "Demo-Assistent",
  "widget.demo.preview.eyebrow": "Termin buchen",
  "widget.demo.preview.title": "Buchungen, Preise und Lead-Erfassung in einem Chat",
  "widget.demo.preview.description":
    "Die Vorschau wirkt wie eine Unternehmenswebsite, während der Chat den lokalen Demo-Ablauf ohne Datenbankeinträge verwendet.",
  "widget.demo.service.coloring": "Haarfärbung",
  "widget.demo.service.detailing": "Fahrzeugaufbereitung",
  "widget.demo.service.consultation": "Beratung",
  "widget.demo.service.order": "Produktbestellung",
};

const pt: WidgetCatalog = {
  "widget.status.failed": "Falhou",
  "widget.status.sent": "Enviado",
  "widget.error.load": "O chat está temporariamente indisponível. Tente novamente.",
  "widget.error.send": "A mensagem não foi enviada. Tente novamente.",
  "widget.fallback.subtitle": "Assistente de IA",
  "widget.fallback.reply.booking": "Quero agendar",
  "widget.fallback.reply.price": "Quanto custa?",
  "widget.fallback.reply.manager": "Falar com uma pessoa",
  "widget.chat.label": "Widget de chat da LeadVirt.ai",
  "widget.chat.close": "Fechar chat",
  "widget.chat.loading": "Carregando o chat",
  "widget.chat.placeholder": "Escreva uma mensagem...",
  "widget.chat.send": "Enviar mensagem",
  "widget.chat.secure": "Sessão segura",
  "widget.chat.open": "Abrir chat",
  "widget.chat.typing": "O assistente está digitando",
  "widget.frame.missing.title": "A chave do widget LeadVirt é obrigatória",
  "widget.frame.missing.detail":
    "Adicione `data-leadvirt-key` ao script de incorporação ou passe `?key=...` na URL do frame.",
  "widget.demo.badge": "Demonstração ao vivo do widget",
  "widget.demo.title": "Widget da LeadVirt.ai para sites",
  "widget.demo.description":
    "O chat do cliente está conectado ao espaço de demonstração, ao funil de leads, à caixa de entrada e ao assistente da LeadVirt.ai.",
  "widget.demo.stat.session": "Sessão",
  "widget.demo.stat.sessionValue": "Armazenada neste navegador",
  "widget.demo.stat.channel": "Canal",
  "widget.demo.stat.channelValue": "Site",
  "widget.demo.stat.ai": "IA",
  "widget.demo.stat.aiValue": "Assistente de demonstração",
  "widget.demo.preview.eyebrow": "Agendar atendimento",
  "widget.demo.preview.title": "Agendamentos, preços e captação de leads em um único chat",
  "widget.demo.preview.description":
    "A prévia parece um site empresarial, enquanto o chat usa o fluxo de demonstração local sem gravar no banco de dados.",
  "widget.demo.service.coloring": "Coloração",
  "widget.demo.service.detailing": "Detalhamento automotivo",
  "widget.demo.service.consultation": "Consulta",
  "widget.demo.service.order": "Pedido de produto",
};

const ru: WidgetCatalog = {
  "widget.status.failed": "Ошибка",
  "widget.status.sent": "Отправлено",
  "widget.error.load": "Чат временно недоступен. Попробуйте ещё раз.",
  "widget.error.send": "Сообщение не отправлено. Попробуйте ещё раз.",
  "widget.fallback.subtitle": "AI-ассистент",
  "widget.fallback.reply.booking": "Хочу записаться",
  "widget.fallback.reply.price": "Сколько стоит?",
  "widget.fallback.reply.manager": "Позовите менеджера",
  "widget.chat.label": "Чат-виджет LeadVirt.ai",
  "widget.chat.close": "Закрыть чат",
  "widget.chat.loading": "Загрузка чата",
  "widget.chat.placeholder": "Напишите сообщение...",
  "widget.chat.send": "Отправить сообщение",
  "widget.chat.secure": "Защищённая сессия",
  "widget.chat.open": "Открыть чат",
  "widget.chat.typing": "Ассистент печатает",
  "widget.frame.missing.title": "Требуется ключ виджета LeadVirt",
  "widget.frame.missing.detail":
    "Добавьте `data-leadvirt-key` в скрипт встраивания или передайте `?key=...` в URL фрейма.",
  "widget.demo.badge": "Живое демо виджета",
  "widget.demo.title": "Виджет LeadVirt.ai для сайта",
  "widget.demo.description":
    "Клиентский чат подключён к демо-пространству, воронке лидов, входящим сообщениям и ассистенту LeadVirt.ai.",
  "widget.demo.stat.session": "Сессия",
  "widget.demo.stat.sessionValue": "Сохраняется в браузере",
  "widget.demo.stat.channel": "Канал",
  "widget.demo.stat.channelValue": "Сайт",
  "widget.demo.stat.ai": "AI",
  "widget.demo.stat.aiValue": "Демо-ассистент",
  "widget.demo.preview.eyebrow": "Запись в студию",
  "widget.demo.preview.title": "Запись, цены и сбор лида в одном чате",
  "widget.demo.preview.description":
    "Страница выглядит как сайт бизнеса, а чат проходит локальный демо-сценарий без записи в базу.",
  "widget.demo.service.coloring": "Окрашивание",
  "widget.demo.service.detailing": "Детейлинг",
  "widget.demo.service.consultation": "Консультация",
  "widget.demo.service.order": "Заказ товара",
};

export const widgetMessages: Record<Locale, WidgetCatalog> = { en, es, fr, de, pt, ru };

export function normalizeWidgetLocale(value: string | null | undefined): Locale {
  const language = value?.trim().toLowerCase().split(/[-_]/u)[0];
  return supportedLocales.includes(language as Locale) ? (language as Locale) : defaultLocale;
}

export function widgetMessage(locale: Locale, key: WidgetMessageKey) {
  return widgetMessages[locale][key];
}

export type { WidgetMessageKey };
