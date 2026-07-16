import type { KnowledgeCapabilityTypeV1 } from "./capability-snapshot-v1.js";
import {
  classifyOperationalQuery,
  normalizeOperationalQueryText,
  OPERATIONAL_QUERY_CATEGORIES,
  type OperationalQueryClassification,
} from "./operational-query.js";

export type KnowledgeCapabilityRuntimeIntentV1 =
  | "human_handoff"
  | "regulated_topic"
  | "order_status"
  | "account_status"
  | "booking"
  | "availability"
  | "pricing"
  | "inventory_status"
  | "commerce_recommendation"
  | "lead_qualification"
  | "general_faq";

export interface KnowledgeCapabilityIntentClassificationV1 {
  schemaVersion: 1;
  route: "CAPABILITY" | "HUMAN_HANDOFF";
  capabilityType: KnowledgeCapabilityTypeV1 | null;
  intent: KnowledgeCapabilityRuntimeIntentV1;
  normalizedQuery: string;
  normalizedIntent: string | null;
  matchedSignals: readonly string[];
  operational: OperationalQueryClassification;
}

interface TextSignals {
  phrases?: readonly string[];
  stems?: readonly string[];
}

const HUMAN_HANDOFF: TextSignals = {
  phrases: [
    "talk to a human",
    "speak to a human",
    "need a human",
    "want a human",
    "real person",
    "human agent",
    "customer service agent",
    "transfer me to an agent",
    "let me speak to a manager",
    "позовите оператора",
    "соедините с оператором",
    "хочу поговорить с человеком",
    "живой специалист",
    "позовите менеджера",
    "hablar con una persona",
    "agente humano",
    "representante humano",
    "pasame con un agente",
    "quiero hablar con un gerente",
    "parler a un humain",
    "conseiller humain",
    "mettez moi en relation avec un agent",
    "je veux parler a un responsable",
    "mit einem menschen sprechen",
    "menschlicher mitarbeiter",
    "mit einem berater sprechen",
    "verbinden sie mich mit einem vorgesetzten",
    "falar com uma pessoa",
    "atendente humano",
    "falar com um agente",
    "quero falar com um gerente",
  ],
  stems: ["оператор", "operator", "conseiller", "atendente"],
};

const REGULATED_TOPIC: TextSignals = {
  phrases: [
    "medical advice",
    "legal advice",
    "financial advice",
    "what dose",
    "should i take",
    "is this medicine safe",
    "diagnose this",
    "tax advice",
    "медицинский совет",
    "юридический совет",
    "финансовый совет",
    "какую дозу",
    "можно ли принимать",
    "поставьте диагноз",
    "налоговая консультация",
    "consejo medico",
    "asesoria legal",
    "asesoria financiera",
    "que dosis",
    "debo tomar",
    "es seguro este medicamento",
    "conseil medical",
    "conseil juridique",
    "conseil financier",
    "quelle dose",
    "dois je prendre",
    "ce medicament est il sur",
    "medizinischer rat",
    "rechtliche beratung",
    "finanzberatung",
    "welche dosis",
    "soll ich einnehmen",
    "ist dieses medikament sicher",
    "aconselhamento medico",
    "aconselhamento juridico",
    "aconselhamento financeiro",
    "qual dose",
    "devo tomar",
    "este medicamento e seguro",
  ],
  stems: [
    "diagnos",
    "symptom",
    "dosage",
    "prescription",
    "lawsuit",
    "attorney",
    "диагноз",
    "симптом",
    "дозиров",
    "рецепт",
    "юридич",
    "diagnostico",
    "sintom",
    "medicament",
    "abogad",
    "juridic",
    "diagnostic",
    "symptome",
    "medicament",
    "ordonnance",
    "avocat",
    "diagnose",
    "medikament",
    "dosierung",
    "anwalt",
    "rechtlich",
    "diagnostico",
    "sintom",
    "medicamento",
    "advogad",
    "juridic",
  ],
};

const ORDER_SUPPORT: TextSignals = {
  phrases: [
    "track my order",
    "where is my order",
    "return my order",
    "refund my order",
    "delivery problem",
    "отследить заказ",
    "где мой заказ",
    "вернуть заказ",
    "возврат денег",
    "проблема с доставкой",
    "rastrear mi pedido",
    "donde esta mi pedido",
    "devolver mi pedido",
    "reembolso de mi pedido",
    "problema de entrega",
    "suivre ma commande",
    "ou est ma commande",
    "retourner ma commande",
    "remboursement de ma commande",
    "probleme de livraison",
    "bestellung verfolgen",
    "wo ist meine bestellung",
    "bestellung zuruckgeben",
    "ruckerstattung meiner bestellung",
    "lieferproblem",
    "rastrear meu pedido",
    "onde esta meu pedido",
    "devolver meu pedido",
    "reembolso do meu pedido",
    "problema de entrega",
  ],
  stems: [
    "refund",
    "chargeback",
    "shipment",
    "возврат",
    "доставк",
    "reembols",
    "envio",
    "rembours",
    "livraison",
    "ruckerstatt",
    "liefer",
    "reembolso",
    "entrega",
  ],
};

const ACCOUNT_SUPPORT: TextSignals = {
  phrases: [
    "cannot access my account",
    "forgot my password",
    "reset my password",
    "my subscription",
    "не могу войти в аккаунт",
    "забыл пароль",
    "сбросить пароль",
    "моя подписка",
    "no puedo entrar en mi cuenta",
    "olvide mi contrasena",
    "restablecer mi contrasena",
    "mi suscripcion",
    "je ne peux pas acceder a mon compte",
    "mot de passe oublie",
    "reinitialiser mon mot de passe",
    "mon abonnement",
    "ich kann nicht auf mein konto zugreifen",
    "passwort vergessen",
    "passwort zurucksetzen",
    "mein abonnement",
    "nao consigo acessar minha conta",
    "esqueci minha senha",
    "redefinir minha senha",
    "minha assinatura",
  ],
  stems: [
    "password",
    "login",
    "subscription",
    "парол",
    "аккаунт",
    "подписк",
    "contrasena",
    "suscripcion",
    "compte",
    "abonnement",
    "passwort",
    "konto",
    "senha",
    "assinatura",
  ],
};

const APPOINTMENT_BOOKING: TextSignals = {
  phrases: [
    "book an appointment",
    "please book",
    "schedule an appointment",
    "make an appointment",
    "reschedule my appointment",
    "cancel my appointment",
    "how does booking work",
    "запишите меня",
    "хочу записаться",
    "перенести запись",
    "отменить запись",
    "как работает запись",
    "reservar una cita",
    "pedir una cita",
    "cambiar mi cita",
    "cancelar mi cita",
    "como funciona la reserva",
    "prendre rendez vous",
    "reserver un rendez vous",
    "deplacer mon rendez vous",
    "annuler mon rendez vous",
    "comment fonctionne la reservation",
    "termin buchen",
    "termin vereinbaren",
    "meinen termin verschieben",
    "meinen termin absagen",
    "wie funktioniert die buchung",
    "marcar um horario",
    "agendar uma consulta",
    "remarcar meu horario",
    "cancelar meu agendamento",
    "como funciona o agendamento",
  ],
  stems: [
    "reschedul",
    "перенест",
    "reservar",
    "reprogram",
    "deplacer",
    "annuler",
    "verschieb",
    "absagen",
    "remarcar",
    "agendar",
  ],
};

const APPOINTMENT_DISCOVERY: TextSignals = {
  phrases: [
    "available appointment",
    "next available appointment",
    "open appointment slots",
    "what times are available",
    "свободное время для записи",
    "ближайшая свободная запись",
    "какие окна доступны",
    "cuando hay citas disponibles",
    "proxima cita disponible",
    "que horarios estan libres",
    "prochain rendez vous disponible",
    "quels creneaux sont disponibles",
    "rendez vous libre",
    "nachster freier termin",
    "welche termine sind verfugbar",
    "freie termine",
    "proximo horario disponivel",
    "quais horarios estao livres",
    "vaga para agendamento",
  ],
  stems: [
    "availability",
    "available",
    "slot",
    "свободн",
    "окн",
    "disponib",
    "hueco",
    "creneau",
    "verfugbar",
    "vaga",
  ],
};

const PRICING: TextSignals = {
  phrases: [
    "how much does it cost",
    "what is the price",
    "price list",
    "request a quote",
    "сколько стоит",
    "какая цена",
    "прайс лист",
    "рассчитать стоимость",
    "cuanto cuesta",
    "cual es el precio",
    "lista de precios",
    "solicitar presupuesto",
    "combien ca coute",
    "quel est le prix",
    "liste de prix",
    "demander un devis",
    "wie viel kostet",
    "was ist der preis",
    "preisliste",
    "angebot anfordern",
    "quanto custa",
    "qual e o preco",
    "lista de precos",
    "solicitar orcamento",
  ],
  stems: [
    "price",
    "pricing",
    "cost",
    "quote",
    "discount",
    "цен",
    "стоим",
    "стоит",
    "тариф",
    "скидк",
    "precio",
    "cuesta",
    "presupuesto",
    "descuento",
    "prix",
    "cout",
    "devis",
    "remise",
    "preis",
    "kost",
    "angebot",
    "rabatt",
    "preco",
    "custa",
    "orcamento",
    "desconto",
  ],
};

const COMMERCE_RECOMMENDATION: TextSignals = {
  phrases: [
    "recommend a product",
    "which product should i choose",
    "best product for me",
    "is this product compatible",
    "порекомендуйте товар",
    "какой товар выбрать",
    "лучший товар для меня",
    "этот товар совместим",
    "recomiendame un producto",
    "que producto debo elegir",
    "mejor producto para mi",
    "este producto es compatible",
    "recommandez moi un produit",
    "quel produit choisir",
    "meilleur produit pour moi",
    "ce produit est compatible",
    "empfehlen sie ein produkt",
    "welches produkt soll ich wahlen",
    "bestes produkt fur mich",
    "ist dieses produkt kompatibel",
    "recomende um produto",
    "qual produto devo escolher",
    "melhor produto para mim",
    "este produto e compativel",
  ],
  stems: [
    "recommend",
    "compatib",
    "порекоменд",
    "совместим",
    "recomiend",
    "compatible",
    "recommand",
    "choisir",
    "kompatib",
    "empfehl",
    "recomend",
    "compativ",
  ],
};

const LEAD_QUALIFICATION: TextSignals = {
  phrases: [
    "do i qualify",
    "am i eligible",
    "eligibility requirements",
    "is this suitable for me",
    "подхожу ли я",
    "имею ли я право",
    "требования для участия",
    "подходит ли это мне",
    "cumplo los requisitos",
    "soy elegible",
    "requisitos de elegibilidad",
    "es adecuado para mi",
    "suis je eligible",
    "conditions d admissibilite",
    "est ce adapte pour moi",
    "bin ich berechtigt",
    "erfulle ich die voraussetzungen",
    "ist das fur mich geeignet",
    "sou elegivel",
    "cumpro os requisitos",
    "requisitos de elegibilidade",
    "isso e adequado para mim",
  ],
  stems: [
    "eligible",
    "eligibility",
    "qualify",
    "подхож",
    "elegible",
    "admisibil",
    "eligible",
    "admissibilite",
    "berechtigt",
    "voraussetzung",
    "elegivel",
    "elegibilidade",
  ],
};

const normalizedValueCache = new Map<string, string>();

function normalized(value: string) {
  const cached = normalizedValueCache.get(value);
  if (cached !== undefined) return cached;
  const result = normalizeOperationalQueryText(value);
  normalizedValueCache.set(value, result);
  return result;
}

function includesPhrase(text: string, phrase: string) {
  return ` ${text} `.includes(` ${normalized(phrase)} `);
}

function includesStem(tokens: readonly string[], stem: string) {
  const value = normalized(stem);
  return tokens.some((token) => token === value || (value.length >= 4 && token.startsWith(value)));
}

function matches(text: string, tokens: readonly string[], signals: TextSignals) {
  return (
    signals.phrases?.some((phrase) => includesPhrase(text, phrase)) === true ||
    signals.stems?.some((stem) => includesStem(tokens, stem)) === true
  );
}

function intentMatches(normalizedIntent: string, ...aliases: readonly string[]) {
  return aliases.some((alias) => normalizedIntent === normalized(alias));
}

function capabilityResult(
  capabilityType: KnowledgeCapabilityTypeV1,
  intent: KnowledgeCapabilityRuntimeIntentV1,
  signal: string,
  operational: OperationalQueryClassification,
): KnowledgeCapabilityIntentClassificationV1 {
  return {
    schemaVersion: 1,
    route: "CAPABILITY",
    capabilityType,
    intent,
    normalizedQuery: operational.normalizedQuery,
    normalizedIntent: operational.normalizedIntent,
    matchedSignals: [signal, ...operational.matchedSignals],
    operational,
  };
}

export function classifyKnowledgeCapabilityIntentV1(
  query: string,
  intent?: string,
): KnowledgeCapabilityIntentClassificationV1 {
  const operational = classifyOperationalQuery(query, intent);
  const normalizedIntent = intent ? normalizeOperationalQueryText(intent) : "";
  const combinedText = [operational.normalizedQuery, normalizedIntent].filter(Boolean).join(" ");
  const tokens = combinedText ? combinedText.split(" ") : [];

  if (
    intentMatches(normalizedIntent, "human_handoff") ||
    matches(combinedText, tokens, HUMAN_HANDOFF)
  ) {
    return {
      schemaVersion: 1,
      route: "HUMAN_HANDOFF",
      capabilityType: null,
      intent: "human_handoff",
      normalizedQuery: operational.normalizedQuery,
      normalizedIntent: operational.normalizedIntent,
      matchedSignals: ["human_handoff", ...operational.matchedSignals],
      operational,
    };
  }

  if (
    intentMatches(normalizedIntent, "regulated_topic") ||
    matches(combinedText, tokens, REGULATED_TOPIC)
  ) {
    return capabilityResult("REGULATED_TOPIC", "regulated_topic", "regulated_topic", operational);
  }

  if (
    operational.category === OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE ||
    intentMatches(normalizedIntent, "order_status", "order_support", "order_account_support") ||
    matches(combinedText, tokens, ORDER_SUPPORT)
  ) {
    return capabilityResult("ORDER_ACCOUNT_SUPPORT", "order_status", "order_support", operational);
  }

  if (
    operational.category === OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE ||
    intentMatches(normalizedIntent, "account_status", "account_support") ||
    matches(combinedText, tokens, ACCOUNT_SUPPORT)
  ) {
    return capabilityResult(
      "ORDER_ACCOUNT_SUPPORT",
      "account_status",
      "account_support",
      operational,
    );
  }

  if (
    operational.category === OPERATIONAL_QUERY_CATEGORIES.BOOKING_STATE ||
    intentMatches(normalizedIntent, "appointment_booking") ||
    matches(combinedText, tokens, APPOINTMENT_BOOKING)
  ) {
    return capabilityResult("APPOINTMENT_BOOKING", "booking", "appointment_booking", operational);
  }

  if (
    operational.category === OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY ||
    intentMatches(normalizedIntent, "appointment_discovery") ||
    matches(combinedText, tokens, APPOINTMENT_DISCOVERY)
  ) {
    return capabilityResult(
      "APPOINTMENT_DISCOVERY",
      "availability",
      "appointment_discovery",
      operational,
    );
  }

  if (intentMatches(normalizedIntent, "pricing") || matches(combinedText, tokens, PRICING)) {
    return capabilityResult("PRICING", "pricing", "pricing", operational);
  }

  if (
    operational.category === OPERATIONAL_QUERY_CATEGORIES.INVENTORY ||
    intentMatches(normalizedIntent, "commerce_recommendation") ||
    matches(combinedText, tokens, COMMERCE_RECOMMENDATION)
  ) {
    return capabilityResult(
      "COMMERCE_RECOMMENDATION",
      operational.category === OPERATIONAL_QUERY_CATEGORIES.INVENTORY
        ? "inventory_status"
        : "commerce_recommendation",
      "commerce_recommendation",
      operational,
    );
  }

  if (
    intentMatches(normalizedIntent, "lead_qualification") ||
    matches(combinedText, tokens, LEAD_QUALIFICATION)
  ) {
    return capabilityResult(
      "LEAD_QUALIFICATION",
      "lead_qualification",
      "lead_qualification",
      operational,
    );
  }

  return capabilityResult("GENERAL_FAQ", "general_faq", "general_faq", operational);
}
