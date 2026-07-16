import type { Locale } from "./config";

const activityLabels: Record<Locale, Record<string, string>> = {
  en: {
    "seed.completed": "Demo data prepared",
    "lead.sent_to_crm": "Lead sent to CRM",
    "booking.created": "Booking created",
    "task.created": "Task created",
    "integration.connected": "Integration connected",
    "integration.sample_inbound": "Integration sample received",
    "integration.test_connection": "Integration connection tested",
    "workflow.published": "Workflow published",
    "onboarding.step_completed": "Onboarding step completed",
    "widget.message.received": "Widget message received",
  },
  es: {
    "seed.completed": "Datos de demostración preparados",
    "lead.sent_to_crm": "Lead enviado al CRM",
    "booking.created": "Reserva creada",
    "task.created": "Tarea creada",
    "integration.connected": "Integración conectada",
    "integration.sample_inbound": "Muestra de integración recibida",
    "integration.test_connection": "Conexión de integración comprobada",
    "workflow.published": "Flujo publicado",
    "onboarding.step_completed": "Paso de incorporación completado",
    "widget.message.received": "Mensaje del widget recibido",
  },
  fr: {
    "seed.completed": "Données de démonstration préparées",
    "lead.sent_to_crm": "Prospect envoyé au CRM",
    "booking.created": "Réservation créée",
    "task.created": "Tâche créée",
    "integration.connected": "Intégration connectée",
    "integration.sample_inbound": "Exemple d'intégration reçu",
    "integration.test_connection": "Connexion de l'intégration testée",
    "workflow.published": "Scénario publié",
    "onboarding.step_completed": "Étape d'intégration terminée",
    "widget.message.received": "Message du widget reçu",
  },
  de: {
    "seed.completed": "Demodaten vorbereitet",
    "lead.sent_to_crm": "Lead an CRM gesendet",
    "booking.created": "Buchung erstellt",
    "task.created": "Aufgabe erstellt",
    "integration.connected": "Integration verbunden",
    "integration.sample_inbound": "Integrationsbeispiel empfangen",
    "integration.test_connection": "Integrationsverbindung getestet",
    "workflow.published": "Workflow veröffentlicht",
    "onboarding.step_completed": "Onboarding-Schritt abgeschlossen",
    "widget.message.received": "Widget-Nachricht empfangen",
  },
  pt: {
    "seed.completed": "Dados de demonstração preparados",
    "lead.sent_to_crm": "Lead enviado ao CRM",
    "booking.created": "Reserva criada",
    "task.created": "Tarefa criada",
    "integration.connected": "Integração conectada",
    "integration.sample_inbound": "Amostra da integração recebida",
    "integration.test_connection": "Conexão da integração testada",
    "workflow.published": "Fluxo publicado",
    "onboarding.step_completed": "Etapa de integração concluída",
    "widget.message.received": "Mensagem do widget recebida",
  },
  ru: {
    "seed.completed": "Демо-данные подготовлены",
    "lead.sent_to_crm": "Лид отправлен в CRM",
    "booking.created": "Запись создана",
    "task.created": "Задача создана",
    "integration.connected": "Интеграция подключена",
    "integration.sample_inbound": "Входящий тест интеграции получен",
    "integration.test_connection": "Подключение интеграции проверено",
    "workflow.published": "Сценарий опубликован",
    "onboarding.step_completed": "Шаг онбординга завершён",
    "widget.message.received": "Сообщение из виджета получено",
  },
};

export function dashboardActivityLabel(
  activity: { action: string; title?: string },
  locale: Locale,
) {
  return activityLabels[locale][activity.action] || activity.title || activity.action.replaceAll(".", " ");
}

const analyticsInsightLabels: Record<Locale, Record<string, string>> = {
  en: {
    CHANNEL_VALUE: "Website and Instagram generated the highest-value qualified leads this week.",
    HIGH_RISK_HANDOFF: "Route medical and legal questions to a manager before the AI answers.",
    EARLY_BOOKING_TIME: "Booking workflows convert better when the AI asks for a preferred time earlier.",
    PRICE_FOLLOWUP: "Follow-up recovers warm leads who disengaged after a pricing question.",
  },
  es: {
    CHANNEL_VALUE: "El sitio web e Instagram generaron los leads cualificados de mayor valor esta semana.",
    HIGH_RISK_HANDOFF: "Deriva las consultas médicas y legales a un gestor antes de que responda la IA.",
    EARLY_BOOKING_TIME: "Los flujos de reserva convierten mejor cuando la IA pregunta antes por la hora preferida.",
    PRICE_FOLLOWUP: "El seguimiento recupera leads interesados que se desconectaron tras una pregunta de precio.",
  },
  fr: {
    CHANNEL_VALUE: "Le site et Instagram ont généré les prospects qualifiés les plus précieux cette semaine.",
    HIGH_RISK_HANDOFF: "Transférez les questions médicales et juridiques à un responsable avant la réponse de l'IA.",
    EARLY_BOOKING_TIME: "Les parcours de réservation convertissent mieux quand l'IA demande plus tôt l'horaire souhaité.",
    PRICE_FOLLOWUP: "La relance récupère les prospects intéressés partis après une question sur le prix.",
  },
  de: {
    CHANNEL_VALUE: "Website und Instagram lieferten diese Woche die wertvollsten qualifizierten Leads.",
    HIGH_RISK_HANDOFF: "Leiten Sie medizinische und rechtliche Fragen vor der KI-Antwort an einen Manager weiter.",
    EARLY_BOOKING_TIME: "Buchungsabläufe konvertieren besser, wenn die KI früher nach der Wunschzeit fragt.",
    PRICE_FOLLOWUP: "Nachfassaktionen gewinnen warme Leads zurück, die nach einer Preisfrage abgesprungen sind.",
  },
  pt: {
    CHANNEL_VALUE: "O site e o Instagram geraram os leads qualificados de maior valor nesta semana.",
    HIGH_RISK_HANDOFF: "Encaminhe dúvidas médicas e jurídicas a um gestor antes da resposta da IA.",
    EARLY_BOOKING_TIME: "Fluxos de reserva convertem melhor quando a IA pergunta o horário preferido mais cedo.",
    PRICE_FOLLOWUP: "O acompanhamento recupera leads interessados que saíram após uma pergunta de preço.",
  },
  ru: {
    CHANNEL_VALUE: "Сайт и Instagram дали самые дорогие квалифицированные лиды на этой неделе.",
    HIGH_RISK_HANDOFF: "Медицинские и юридические вопросы лучше передавать менеджеру до ответа AI.",
    EARLY_BOOKING_TIME: "Сценарии записи работают лучше, когда AI раньше спрашивает удобное время.",
    PRICE_FOLLOWUP: "Follow-up возвращает тёплых лидов, которые ушли после вопроса о цене.",
  },
};

export function analyticsInsightLabel(code: string, locale: Locale) {
  return analyticsInsightLabels[locale][code] || code.replaceAll("_", " ").toLowerCase();
}
