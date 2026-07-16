export const OPERATIONAL_QUERY_CATEGORIES = {
  STATIC_KNOWLEDGE: "STATIC_KNOWLEDGE",
  AVAILABILITY: "AVAILABILITY",
  BOOKING_STATE: "BOOKING_STATE",
  INVENTORY: "INVENTORY",
  ORDER_STATE: "ORDER_STATE",
  ACCOUNT_STATE: "ACCOUNT_STATE",
} as const;

export type OperationalQueryCategory =
  (typeof OPERATIONAL_QUERY_CATEGORIES)[keyof typeof OPERATIONAL_QUERY_CATEGORIES];

export interface OperationalQueryClassification {
  category: OperationalQueryCategory;
  requiresLiveEvidence: boolean;
  normalizedQuery: string;
  normalizedIntent: string | null;
  matchedSignals: readonly string[];
}

interface IntentPolicy {
  category: Exclude<OperationalQueryCategory, "STATIC_KNOWLEDGE">;
  requiresLiveEvidence: boolean;
}

const INTENT_POLICIES: Readonly<Record<string, IntentPolicy>> = {
  booking: {
    category: OPERATIONAL_QUERY_CATEGORIES.BOOKING_STATE,
    requiresLiveEvidence: true,
  },
  availability: {
    category: OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY,
    requiresLiveEvidence: true,
  },
  "booking availability": {
    category: OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY,
    requiresLiveEvidence: true,
  },
  inventory: {
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
    requiresLiveEvidence: true,
  },
  "inventory status": {
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
    requiresLiveEvidence: true,
  },
  "stock status": {
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
    requiresLiveEvidence: true,
  },
  "account status": {
    category: OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE,
    requiresLiveEvidence: true,
  },
  balance: {
    category: OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE,
    requiresLiveEvidence: true,
  },
  "order status": {
    category: OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE,
    requiresLiveEvidence: true,
  },
  "shipment status": {
    category: OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE,
    requiresLiveEvidence: true,
  },
};

const STATIC_EXPLANATION_PHRASES = [
  "business hours",
  "opening hours",
  "working hours",
  "hours of operation",
  "what are your hours",
  "when do you open",
  "часы работы",
  "график работы",
  "режим работы",
  "когда вы открываетесь",
  "horario de apertura",
  "horario comercial",
  "cual es su horario",
  "cuando abren",
  "horaires d ouverture",
  "heures d ouverture",
  "quels sont vos horaires",
  "quand ouvrez vous",
  "offnungszeiten",
  "geschaftszeiten",
  "wann offnen sie",
  "horario de funcionamento",
  "horario comercial",
  "qual e o horario",
  "quando voces abrem",
  "do you offer appointments",
  "do you provide appointments",
  "do you take appointments",
  "можно у вас записываться",
  "вы предлагаете запись",
  "у вас есть услуга записи",
  "ofrecen citas",
  "se puede reservar con ustedes",
  "proposez vous des rendez vous",
  "peut on prendre rendez vous chez vous",
  "bieten sie termine an",
  "kann man bei ihnen termine buchen",
  "voces oferecem agendamentos",
  "e possivel marcar com voces",
  "how does booking work",
  "how do bookings work",
  "how can bookings be made",
  "booking process",
  "как работает запись",
  "как происходит бронирование",
  "процесс записи",
  "como funciona la reserva",
  "como se hacen las reservas",
  "processo de reserva",
  "comment fonctionne la reservation",
  "comment prendre rendez vous",
  "processus de reservation",
  "wie funktioniert die buchung",
  "wie buche ich einen termin",
  "buchungsprozess",
  "como funciona a reserva",
  "como funciona o agendamento",
  "processo de agendamento",
];

const POLICY_PHRASES = [
  "policy",
  "policies",
  "terms and conditions",
  "правила",
  "политика",
  "условия",
  "politica",
  "politicas",
  "terminos y condiciones",
  "politique",
  "conditions generales",
  "richtlinie",
  "richtlinien",
  "bedingungen",
  "politica",
  "politicas",
  "termos e condicoes",
];

const SERVICE_DESCRIPTION_PHRASES = [
  "what services do you offer",
  "which services do you offer",
  "tell me about your services",
  "describe your services",
  "какие услуги вы предлагаете",
  "расскажите об услугах",
  "опишите ваши услуги",
  "que servicios ofrecen",
  "cuentame sobre sus servicios",
  "quels services proposez vous",
  "parlez moi de vos services",
  "welche dienstleistungen bieten sie an",
  "beschreiben sie ihre dienstleistungen",
  "quais servicos voces oferecem",
  "fale me sobre seus servicos",
  "what products do you sell",
  "what products do you offer",
  "what products do you carry",
  "what inventory do you carry",
  "tell me about your products",
  "product catalog",
  "какие товары вы продаете",
  "расскажите о товарах",
  "каталог товаров",
  "que productos venden",
  "cuentame sobre sus productos",
  "catalogo de productos",
  "quels produits vendez vous",
  "parlez moi de vos produits",
  "catalogue de produits",
  "welche produkte verkaufen sie",
  "beschreiben sie ihre produkte",
  "produktkatalog",
  "quais produtos voces vendem",
  "fale me sobre seus produtos",
  "catalogo de produtos",
  "how does ordering work",
  "how do i place an order",
  "order process",
  "как оформить заказ",
  "как работает оформление заказа",
  "como hago un pedido",
  "como funciona el pedido",
  "comment passer une commande",
  "comment fonctionne la commande",
  "wie gebe ich eine bestellung auf",
  "wie funktioniert die bestellung",
  "como faco um pedido",
  "como funciona o pedido",
  "how do accounts work",
  "what account plans do you offer",
  "как работает аккаунт",
  "какие тарифы аккаунта",
  "como funciona la cuenta",
  "que planes de cuenta ofrecen",
  "comment fonctionne le compte",
  "quels forfaits de compte proposez vous",
  "wie funktioniert das konto",
  "welche kontomodelle bieten sie an",
  "como funciona a conta",
  "quais planos de conta voces oferecem",
];

const PRICING_PHRASES = [
  "what is the price",
  "what are the prices",
  "how much does it cost",
  "pricing information",
  "сколько это стоит",
  "какая цена",
  "какие цены",
  "cuanto cuesta",
  "cual es el precio",
  "combien ca coute",
  "quel est le prix",
  "wie viel kostet",
  "was kostet",
  "quanto custa",
  "qual e o preco",
];

const CURRENT_PHRASES = [
  "right now",
  "at the moment",
  "currently",
  "current",
  "live",
  "real time",
  "up to date",
  "now",
  "today",
  "tomorrow",
  "tonight",
  "сейчас",
  "в данный момент",
  "текущ",
  "актуальн",
  "сегодня",
  "завтра",
  "ahora mismo",
  "ahora",
  "en este momento",
  "actual",
  "en vivo",
  "tiempo real",
  "hoy",
  "manana",
  "maintenant",
  "en ce moment",
  "actuel",
  "en direct",
  "temps reel",
  "aujourd hui",
  "demain",
  "gerade jetzt",
  "jetzt",
  "im moment",
  "aktuell",
  "echtzeit",
  "heute",
  "morgen",
  "agora mesmo",
  "agora",
  "neste momento",
  "atual",
  "ao vivo",
  "tempo real",
  "hoje",
  "amanha",
];

const CURRENT_STEMS = ["current", "актуальн", "текущ", "actual", "actuel", "aktuell", "atual"];

const STATUS_STEMS = [
  "status",
  "state",
  "track",
  "shipped",
  "delivered",
  "статус",
  "состояни",
  "отслеж",
  "доставл",
  "отправл",
  "estado",
  "seguim",
  "enviado",
  "entregado",
  "statut",
  "etat",
  "suivi",
  "expedie",
  "livre",
  "stand",
  "sendungsverfolg",
  "versandt",
  "geliefert",
  "rastream",
  "enviad",
  "entreg",
  "arriv",
  "cancel",
  "return",
  "processing",
  "active",
  "inactive",
  "suspend",
  "blocked",
  "expired",
  "прибуд",
  "приед",
  "отмен",
  "возврат",
  "обработ",
  "актив",
  "заблок",
  "истек",
  "lleg",
  "cancel",
  "devuelt",
  "proces",
  "activ",
  "suspend",
  "bloque",
  "expir",
  "arriv",
  "annul",
  "retour",
  "traitement",
  "actif",
  "inactif",
  "suspend",
  "bloqu",
  "expir",
  "ankomm",
  "stornier",
  "zuruck",
  "bearbeit",
  "aktiv",
  "inaktiv",
  "gesperrt",
  "abgelaufen",
  "cheg",
  "cancel",
  "devolv",
  "process",
  "ativ",
  "inativ",
  "suspens",
  "bloque",
  "expir",
];

const REMAINING_STEMS = [
  "remaining",
  "remainder",
  "left",
  "remain",
  "still",
  "остат",
  "остал",
  "осталось",
  "еще",
  "quedan",
  "queda",
  "restante",
  "todavia",
  "aun",
  "reste",
  "restent",
  "encore",
  "ubrig",
  "verbleib",
  "noch",
  "restam",
  "resta",
  "ainda",
];

const CONFIRMATION_STEMS = [
  "confirm",
  "approved",
  "подтвержд",
  "одобрен",
  "confirmad",
  "aprob",
  "confirme",
  "approuve",
  "bestatig",
  "genehmig",
  "confirmad",
  "aprova",
];

const INVENTORY_STATE_PHRASES = [
  "in stock",
  "out of stock",
  "on hand",
  "в наличии",
  "на складе",
  "нет в наличии",
  "en stock",
  "en existencia",
  "agotado",
  "en rupture",
  "auf lager",
  "nicht auf lager",
  "vorratig",
  "em estoque",
  "fora de estoque",
  "esgotado",
];

const BOOKING_ACTION_PHRASES = [
  "book me",
  "make a booking",
  "schedule me",
  "reserve for me",
  "i want to book",
  "can i book",
  "запишите меня",
  "хочу записаться",
  "забронируйте",
  "можно записаться",
  "quiero reservar",
  "haz una reserva",
  "puedo reservar",
  "reservame",
  "reservez moi",
  "je veux reserver",
  "prendre rendez vous",
  "puis je reserver",
  "buchen sie mich",
  "ich mochte buchen",
  "termin buchen",
  "kann ich buchen",
  "reserve para mim",
  "quero reservar",
  "marque para mim",
  "posso reservar",
];

const ACCOUNT_STATE_STEMS = [
  "balance",
  "credit",
  "баланс",
  "кредит",
  "saldo",
  "credito",
  "solde",
  "guthaben",
  "kontostand",
  "active",
  "inactive",
  "suspend",
  "blocked",
  "expired",
  "актив",
  "заблок",
  "истек",
  "activ",
  "suspend",
  "bloque",
  "expir",
  "actif",
  "inactif",
  "bloqu",
  "aktiv",
  "inaktiv",
  "gesperrt",
  "abgelaufen",
  "ativ",
  "inativ",
  "suspens",
];

const AVAILABILITY_STEMS = [
  "availability",
  "available",
  "slot",
  "free",
  "open",
  "доступн",
  "свободн",
  "слот",
  "окн",
  "открыт",
  "disponibilidad",
  "disponible",
  "hueco",
  "libre",
  "abiert",
  "disponibilite",
  "creneau",
  "ouvert",
  "verfugbar",
  "verfugbarkeit",
  "frei",
  "geoffnet",
  "disponibilidade",
  "disponivel",
  "vaga",
  "abert",
];

const AVAILABILITY_TOPIC_STEMS = [
  ...AVAILABILITY_STEMS,
  "appointment",
  "schedule",
  "запис",
  "прием",
  "cita",
  "turno",
  "rendez",
  "termin",
  "horario",
];

const BOOKING_TOPIC_STEMS = [
  "book",
  "booking",
  "reservation",
  "appointment",
  "брон",
  "запис",
  "reserva",
  "cita",
  "reservation",
  "rendez",
  "buchung",
  "reservierung",
  "termin",
  "agendamento",
  "marcacao",
];

const INVENTORY_TOPIC_STEMS = [
  "inventory",
  "stock",
  "product",
  "unit",
  "item",
  "остаток",
  "склад",
  "товар",
  "наличи",
  "inventario",
  "existencia",
  "unidade",
  "articulo",
  "inventaire",
  "stock",
  "article",
  "bestand",
  "lager",
  "vorrat",
  "inventario",
  "estoque",
  "unidade",
  "produto",
];

const ORDER_TOPIC_STEMS = [
  "order",
  "shipment",
  "delivery",
  "package",
  "заказ",
  "посыл",
  "доставк",
  "отправлени",
  "pedido",
  "envio",
  "entrega",
  "paquete",
  "commande",
  "expedition",
  "livraison",
  "colis",
  "bestellung",
  "sendung",
  "lieferung",
  "paket",
  "pedido",
  "remessa",
  "entrega",
  "pacote",
];

const ACCOUNT_TOPIC_STEMS = [
  "account",
  "balance",
  "credit",
  "subscription",
  "аккаунт",
  "счет",
  "баланс",
  "подписк",
  "cuenta",
  "saldo",
  "credito",
  "suscripcion",
  "compte",
  "solde",
  "credit",
  "abonnement",
  "konto",
  "kontostand",
  "guthaben",
  "abonnement",
  "conta",
  "saldo",
  "credito",
  "assinatura",
];

const POSSESSIVE_STEMS = [
  "my",
  "mine",
  "мой",
  "моя",
  "мое",
  "мои",
  "mi",
  "mis",
  "mon",
  "ma",
  "mes",
  "mein",
  "meine",
  "meiner",
  "meu",
  "minha",
  "meus",
  "minhas",
];

const OPERATIONAL_INQUIRY_PHRASES = [
  "do you have",
  "do i have",
  "are there",
  "is there",
  "is my",
  "is order",
  "can i book",
  "where is",
  "when will",
  "where is my",
  "what is my",
  "has my",
  "есть ли",
  "могу ли я записаться",
  "можно ли записаться",
  "где мой",
  "где моя",
  "где заказ",
  "когда придет",
  "когда прибудет",
  "какой статус",
  "hay alguna",
  "hay disponibilidad",
  "puedo reservar",
  "donde esta mi",
  "donde esta",
  "cuando llegara",
  "cual es el estado",
  "y a t il",
  "puis je reserver",
  "ou est mon",
  "ou est",
  "quand arrivera",
  "quel est le statut",
  "gibt es",
  "kann ich buchen",
  "wo ist mein",
  "wo ist",
  "wann kommt",
  "wie ist der status",
  "ha alguma",
  "tem disponibilidade",
  "posso reservar",
  "onde esta meu",
  "onde esta",
  "quando chegara",
  "qual e o status",
];

const INVENTORY_INQUIRY_PHRASES = [
  "do you have",
  "do you still have",
  "есть ли у вас",
  "у вас есть",
  "tienen",
  "tiene usted",
  "avez vous",
  "est ce que vous avez",
  "haben sie",
  "voces tem",
  "voce tem",
];

function padded(value: string): string {
  return ` ${value} `;
}

const normalizedMatcherCache = new Map<string, string>();

function normalizedMatcher(value: string): string {
  const cached = normalizedMatcherCache.get(value);
  if (cached !== undefined) return cached;
  const normalized = normalizeOperationalQueryText(value);
  normalizedMatcherCache.set(value, normalized);
  return normalized;
}

function includesPhrase(value: string, phrase: string): boolean {
  return padded(value).includes(padded(normalizedMatcher(phrase)));
}

function includesAnyPhrase(value: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => includesPhrase(value, phrase));
}

function includesAnyStem(tokens: readonly string[], stems: readonly string[]): boolean {
  return tokens.some((token) =>
    stems.some((stem) => {
      const normalizedStem = normalizedMatcher(stem);
      return token === normalizedStem || token.startsWith(normalizedStem);
    }),
  );
}

export function normalizeOperationalQueryText(value: string): string {
  return value
    .normalize("NFKC")
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function queryCategory(
  tokens: readonly string[],
  hasConfirmation: boolean,
  hasStatus: boolean,
  hasPossessive: boolean,
): OperationalQueryCategory {
  if (includesAnyStem(tokens, ORDER_TOPIC_STEMS)) {
    return OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE;
  }
  if (includesAnyStem(tokens, INVENTORY_TOPIC_STEMS)) {
    return OPERATIONAL_QUERY_CATEGORIES.INVENTORY;
  }
  if (includesAnyStem(tokens, ACCOUNT_TOPIC_STEMS)) {
    return OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE;
  }

  const hasBookingTopic = includesAnyStem(tokens, BOOKING_TOPIC_STEMS);
  const hasAvailabilityTopic = includesAnyStem(tokens, AVAILABILITY_TOPIC_STEMS);
  if (hasBookingTopic && (hasConfirmation || hasStatus || hasPossessive)) {
    return OPERATIONAL_QUERY_CATEGORIES.BOOKING_STATE;
  }
  if (hasAvailabilityTopic) {
    return OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY;
  }
  if (hasBookingTopic) {
    return OPERATIONAL_QUERY_CATEGORIES.BOOKING_STATE;
  }
  return OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE;
}

export function classifyOperationalQuery(
  query: string,
  intent?: string,
): OperationalQueryClassification {
  const normalizedQuery = normalizeOperationalQueryText(query);
  const normalizedIntent = intent ? normalizeOperationalQueryText(intent) : null;
  const intentPolicy = normalizedIntent ? INTENT_POLICIES[normalizedIntent] : undefined;
  const tokens = normalizedQuery ? normalizedQuery.split(" ") : [];
  const hasCurrent =
    includesAnyPhrase(normalizedQuery, CURRENT_PHRASES) || includesAnyStem(tokens, CURRENT_STEMS);
  const hasStatus = includesAnyStem(tokens, STATUS_STEMS);
  const hasRemaining = includesAnyStem(tokens, REMAINING_STEMS);
  const hasConfirmation = includesAnyStem(tokens, CONFIRMATION_STEMS);
  const hasAvailabilityState = includesAnyStem(tokens, AVAILABILITY_STEMS);
  const hasInventoryState = includesAnyPhrase(normalizedQuery, INVENTORY_STATE_PHRASES);
  const hasBookingAction = includesAnyPhrase(normalizedQuery, BOOKING_ACTION_PHRASES);
  const hasAccountState = includesAnyStem(tokens, ACCOUNT_STATE_STEMS);
  const hasPossessive = includesAnyStem(tokens, POSSESSIVE_STEMS);
  const hasOperationalInquiry = includesAnyPhrase(normalizedQuery, OPERATIONAL_INQUIRY_PHRASES);
  const hasInventoryInquiry = includesAnyPhrase(normalizedQuery, INVENTORY_INQUIRY_PHRASES);
  const detectedCategory = queryCategory(tokens, hasConfirmation, hasStatus, hasPossessive);
  const hasProductCode = tokens.some(
    (token) => /\p{Letter}/u.test(token) && /\p{Number}/u.test(token),
  );
  const category =
    intentPolicy?.category ??
    (detectedCategory === OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE && hasInventoryInquiry
      ? OPERATIONAL_QUERY_CATEGORIES.INVENTORY
      : detectedCategory);
  const hasDirectStaticExplanation = includesAnyPhrase(normalizedQuery, STATIC_EXPLANATION_PHRASES);
  const hasOtherStaticExplanation =
    includesAnyPhrase(normalizedQuery, POLICY_PHRASES) ||
    includesAnyPhrase(normalizedQuery, SERVICE_DESCRIPTION_PHRASES) ||
    includesAnyPhrase(normalizedQuery, PRICING_PHRASES);
  const hasUnambiguousOperationalState =
    hasStatus ||
    hasRemaining ||
    hasConfirmation ||
    hasInventoryState ||
    hasBookingAction ||
    (category === OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE && hasAccountState) ||
    (category === OPERATIONAL_QUERY_CATEGORIES.INVENTORY &&
      (hasInventoryState || hasInventoryInquiry || (hasOperationalInquiry && hasProductCode))) ||
    (category === OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE && hasOperationalInquiry) ||
    (category === OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY &&
      (hasAvailabilityState || hasCurrent || hasOperationalInquiry)) ||
    ((category === OPERATIONAL_QUERY_CATEGORIES.BOOKING_STATE ||
      category === OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE ||
      category === OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE) &&
      hasPossessive &&
      (hasCurrent || hasOperationalInquiry));

  if (
    (hasDirectStaticExplanation &&
      !hasCurrent &&
      !hasStatus &&
      !hasRemaining &&
      !hasConfirmation) ||
    (hasOtherStaticExplanation &&
      (category === OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE ||
        !hasUnambiguousOperationalState))
  ) {
    return {
      category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
      requiresLiveEvidence: false,
      normalizedQuery,
      normalizedIntent,
      matchedSignals: ["static_explanation"],
    };
  }

  const matchedSignals: string[] = [];
  if (intentPolicy) matchedSignals.push(`intent:${normalizedIntent}`);
  if (hasCurrent) matchedSignals.push("current");
  if (hasStatus) matchedSignals.push("status");
  if (hasRemaining) matchedSignals.push("remaining");
  if (hasConfirmation) matchedSignals.push("confirmation");
  if (hasAvailabilityState) matchedSignals.push("availability_state");
  if (hasInventoryState) matchedSignals.push("inventory_state");
  if (hasBookingAction) matchedSignals.push("booking_action");
  if (hasAccountState) matchedSignals.push("account_state");
  if (hasOperationalInquiry) matchedSignals.push("operational_inquiry");
  if (hasInventoryInquiry) matchedSignals.push("inventory_inquiry");
  if (hasPossessive) matchedSignals.push("possessive");

  const explicitLiveSemantics =
    hasCurrent || hasStatus || hasRemaining || hasConfirmation || hasUnambiguousOperationalState;
  const defaultsToLiveEvidence =
    category === OPERATIONAL_QUERY_CATEGORIES.INVENTORY ||
    category === OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE ||
    category === OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE;
  const requiresLiveEvidence =
    intentPolicy?.requiresLiveEvidence === true || defaultsToLiveEvidence || explicitLiveSemantics;

  return {
    category,
    requiresLiveEvidence,
    normalizedQuery,
    normalizedIntent,
    matchedSignals,
  };
}
