import { createHash, randomBytes } from "node:crypto";

const supportedLocales = ["en", "ru", "es", "fr", "de", "pt"] as const;

export const telegramActivationWelcomeTtlMs = 30 * 60_000;

export function telegramActivationStartParameterHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function issueTelegramActivationStartParameter() {
  const parameter = `lv_${randomBytes(18).toString("base64url")}`;
  return {
    parameter,
    hash: telegramActivationStartParameterHash(parameter),
  };
}

export type TelegramWelcomeLocale = (typeof supportedLocales)[number];
export type TelegramActivationWelcomeMode = "SETUP_START" | "FIRST_MESSAGE";

function localeFrom(value?: string | null): TelegramWelcomeLocale | null {
  const base = value?.trim().toLowerCase().split(/[-_]/u)[0];
  return supportedLocales.find((locale) => locale === base) ?? null;
}

function displayName(value: string | null | undefined, fallback: string) {
  const normalized = value?.replace(/\s+/gu, " ").trim().slice(0, 80);
  return normalized || fallback;
}

const welcomeCopy = {
  en: (person: string, business: string) =>
    `Hello, ${person}! This is the AI administrator for “${business}”, powered by LeadVirt.ai.\n\nTelegram is connected: I received your message, and the conversation is already in Inbox. Automatic customer replies are still off. Add your business details, review the test answers, and enable automatic replies when you are ready.`,
  ru: (person: string, business: string) =>
    `Здравствуйте, ${person}! Вас приветствует AI-администратор компании «${business}» на платформе LeadVirt.ai.\n\nTelegram успешно подключён: я получил ваше сообщение, а диалог уже появился во «Входящих». Автоматические ответы клиентам пока выключены. Заполните информацию о бизнесе, проверьте тестовые ответы и включите автоответы, когда будете готовы.`,
  es: (person: string, business: string) =>
    `¡Hola, ${person}! Soy el administrador con IA de «${business}», creado con LeadVirt.ai.\n\nTelegram está conectado: he recibido tu mensaje y la conversación ya está en la Bandeja de entrada. Las respuestas automáticas a clientes siguen desactivadas. Añade la información de tu negocio, revisa las respuestas de prueba y actívalas cuando todo esté listo.`,
  fr: (person: string, business: string) =>
    `Bonjour, ${person} ! Je suis l’administrateur IA de « ${business} », propulsé par LeadVirt.ai.\n\nTelegram est connecté : j’ai bien reçu votre message et la conversation est déjà dans la boîte de réception. Les réponses automatiques aux clients sont encore désactivées. Ajoutez les informations de votre entreprise, vérifiez les réponses de test, puis activez-les lorsque vous êtes prêt.`,
  de: (person: string, business: string) =>
    `Hallo, ${person}! Ich bin der KI-Administrator von „${business}“, unterstützt von LeadVirt.ai.\n\nTelegram ist verbunden: Ihre Nachricht ist angekommen und die Unterhaltung befindet sich bereits im Posteingang. Automatische Kundenantworten sind noch ausgeschaltet. Ergänzen Sie Ihre Unternehmensdaten, prüfen Sie die Testantworten und aktivieren Sie automatische Antworten, sobald alles bereit ist.`,
  pt: (person: string, business: string) =>
    `Olá, ${person}! Sou o administrador de IA da «${business}», com tecnologia LeadVirt.ai.\n\nO Telegram está conectado: recebi a sua mensagem e a conversa já está na Caixa de entrada. As respostas automáticas aos clientes ainda estão desativadas. Adicione as informações da empresa, reveja as respostas de teste e ative as respostas automáticas quando estiver tudo pronto.`,
} satisfies Record<TelegramWelcomeLocale, (person: string, business: string) => string>;

const firstMessageCopy = {
  en: (person: string, business: string) =>
    `Hello, ${person}! I’m the AI administrator for “${business}” on LeadVirt.ai. Thank you for your message. The assistant is still being prepared, so a team member will reply as soon as possible.`,
  ru: (person: string, business: string) =>
    `Здравствуйте, ${person}! Вас приветствует AI-администратор компании «${business}» на платформе LeadVirt.ai. Спасибо за сообщение. Сейчас помощник ещё настраивается, поэтому сотрудник компании ответит вам в ближайшее время.`,
  es: (person: string, business: string) =>
    `¡Hola, ${person}! Soy el administrador con IA de «${business}» en LeadVirt.ai. Gracias por tu mensaje. El asistente todavía se está preparando, así que una persona del equipo responderá lo antes posible.`,
  fr: (person: string, business: string) =>
    `Bonjour, ${person} ! Je suis l’administrateur IA de « ${business} » sur LeadVirt.ai. Merci pour votre message. L’assistant est encore en cours de préparation ; un membre de l’équipe vous répondra dès que possible.`,
  de: (person: string, business: string) =>
    `Hallo, ${person}! Ich bin der KI-Administrator von „${business}“ auf LeadVirt.ai. Vielen Dank für Ihre Nachricht. Der Assistent wird noch vorbereitet; ein Teammitglied antwortet Ihnen so bald wie möglich.`,
  pt: (person: string, business: string) =>
    `Olá, ${person}! Sou o administrador de IA da «${business}» no LeadVirt.ai. Agradeço a sua mensagem. O assistente ainda está sendo preparado, então uma pessoa da equipe responderá assim que possível.`,
} satisfies Record<TelegramWelcomeLocale, (person: string, business: string) => string>;

export function buildTelegramActivationWelcome(input: {
  customerName?: string | null;
  businessName?: string | null;
  customerLocale?: string | null;
  accountLocale?: string | null;
  mode?: TelegramActivationWelcomeMode;
}) {
  const locale = localeFrom(input.customerLocale) ?? localeFrom(input.accountLocale) ?? "en";
  const businessName = displayName(input.businessName, "LeadVirt");
  const customerName = displayName(input.customerName, businessName);
  return {
    locale,
    text:
      input.mode === "FIRST_MESSAGE"
        ? firstMessageCopy[locale](customerName, businessName)
        : welcomeCopy[locale](customerName, businessName),
  };
}
