import assert from "node:assert/strict";
import {
  classifyOperationalQuery,
  normalizeOperationalQueryText,
  OPERATIONAL_QUERY_CATEGORIES,
  type OperationalQueryCategory,
} from "../../packages/knowledge/src/operational-query.js";

interface Case {
  query: string;
  category: OperationalQueryCategory;
  live: boolean;
  intent?: string;
}

const cases: Case[] = [
  {
    query: "Do you have any appointments available today?",
    category: OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY,
    live: true,
  },
  {
    query: "Is my booking confirmed?",
    category: OPERATIONAL_QUERY_CATEGORIES.BOOKING_STATE,
    live: true,
  },
  {
    query: "How many units are remaining in stock?",
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
    live: true,
  },
  { query: "Is the X200 in stock?", category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY, live: true },
  { query: "Do you have the X200?", category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY, live: true },
  { query: "Do you have shampoo?", category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY, live: true },
  {
    query: "Where is my order right now?",
    category: OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE,
    live: true,
  },
  { query: "Where is order 123?", category: OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE, live: true },
  {
    query: "When will order 123 arrive?",
    category: OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE,
    live: true,
  },
  {
    query: "Is order 123 cancelled?",
    category: OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE,
    live: true,
  },
  {
    query: "What is my current account balance?",
    category: OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE,
    live: true,
  },
  {
    query: "How much credit do I have?",
    category: OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE,
    live: true,
  },
  { query: "What's my credit?", category: OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE, live: true },
  {
    query: "Is my subscription active?",
    category: OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE,
    live: true,
  },
  {
    query: "Book me for Friday.",
    category: OPERATIONAL_QUERY_CATEGORIES.BOOKING_STATE,
    live: true,
  },
  {
    query: "Есть ли свободные окна сегодня?",
    category: OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY,
    live: true,
  },
  {
    query: "Моя запись подтверждена?",
    category: OPERATIONAL_QUERY_CATEGORIES.BOOKING_STATE,
    live: true,
  },
  {
    query: "Сколько товара осталось на складе?",
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
    live: true,
  },
  {
    query: "Какой статус моего заказа?",
    category: OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE,
    live: true,
  },
  {
    query: "Какой сейчас баланс моего аккаунта?",
    category: OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE,
    live: true,
  },
  {
    query: "Есть ли товар в наличии сейчас?",
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
    live: true,
  },
  {
    query: "¿Hay citas disponibles hoy?",
    category: OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY,
    live: true,
  },
  {
    query: "¿Está confirmada mi reserva?",
    category: OPERATIONAL_QUERY_CATEGORIES.BOOKING_STATE,
    live: true,
  },
  {
    query: "¿Cuántas unidades quedan en inventario?",
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
    live: true,
  },
  {
    query: "¿Hay artículos en inventario ahora?",
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
    live: true,
  },
  {
    query: "¿Cuál es el estado de mi pedido?",
    category: OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE,
    live: true,
  },
  {
    query: "¿Cuál es el saldo actual de mi cuenta?",
    category: OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE,
    live: true,
  },
  {
    query: "Y a-t-il des créneaux disponibles aujourd'hui ?",
    category: OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY,
    live: true,
  },
  {
    query: "Mon rendez-vous est-il confirmé ?",
    category: OPERATIONAL_QUERY_CATEGORIES.BOOKING_STATE,
    live: true,
  },
  {
    query: "Combien d'articles restent en stock ?",
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
    live: true,
  },
  {
    query: "Quel est le statut de ma commande ?",
    category: OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE,
    live: true,
  },
  {
    query: "Quel est le solde actuel de mon compte ?",
    category: OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE,
    live: true,
  },
  {
    query: "Gibt es heute freie Termine?",
    category: OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY,
    live: true,
  },
  {
    query: "Ist meine Buchung bestätigt?",
    category: OPERATIONAL_QUERY_CATEGORIES.BOOKING_STATE,
    live: true,
  },
  {
    query: "Wie viele Artikel sind noch im Bestand?",
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
    live: true,
  },
  {
    query: "Sind Artikel jetzt auf Lager?",
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
    live: true,
  },
  {
    query: "Wie ist der Status meiner Bestellung?",
    category: OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE,
    live: true,
  },
  {
    query: "Wie hoch ist mein aktuelles Kontoguthaben?",
    category: OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE,
    live: true,
  },
  {
    query: "Há horários disponíveis hoje?",
    category: OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY,
    live: true,
  },
  {
    query: "Meu agendamento está confirmado?",
    category: OPERATIONAL_QUERY_CATEGORIES.BOOKING_STATE,
    live: true,
  },
  {
    query: "Quantas unidades restam no estoque?",
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
    live: true,
  },
  {
    query: "Há produtos no estoque agora?",
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
    live: true,
  },
  {
    query: "Qual é o status do meu pedido?",
    category: OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE,
    live: true,
  },
  {
    query: "Qual é o saldo atual da minha conta?",
    category: OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE,
    live: true,
  },
  {
    query: "What are your business hours?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "What are your opening hours?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "When do you open?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "Do you offer appointments?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "Do you offer appointments today?",
    category: OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY,
    live: true,
  },
  {
    query: "How does booking work?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "What services do you offer?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "What is the cancellation policy?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "How much does it cost?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "What products do you carry?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "How do I place an order?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "How do accounts work?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "Как работает запись?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "Какие у вас часы работы?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "¿Cómo funciona la reserva?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "¿Ofrecen citas?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "Comment fonctionne la réservation ?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "Quels services proposez-vous ?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "Wie funktioniert die Buchung?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "Welche Richtlinien gelten für Stornierungen?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "Como funciona o agendamento?",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  { query: "Quanto custa?", category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE, live: false },
  {
    query: "Explain your current cancellation policy.",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: false,
  },
  {
    query: "",
    intent: "booking",
    category: OPERATIONAL_QUERY_CATEGORIES.BOOKING_STATE,
    live: true,
  },
  {
    query: "",
    intent: "availability",
    category: OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY,
    live: true,
  },
  {
    query: "",
    intent: "booking_availability",
    category: OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY,
    live: true,
  },
  { query: "", intent: "inventory", category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY, live: true },
  {
    query: "",
    intent: "inventory_status",
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
    live: true,
  },
  {
    query: "",
    intent: "stock_status",
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
    live: true,
  },
  {
    query: "",
    intent: "account_status",
    category: OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE,
    live: true,
  },
  {
    query: "",
    intent: "balance",
    category: OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE,
    live: true,
  },
  {
    query: "",
    intent: "order_status",
    category: OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE,
    live: true,
  },
  {
    query: "",
    intent: "shipment_status",
    category: OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE,
    live: true,
  },
  {
    query: "Give me live information.",
    category: OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE,
    live: true,
  },
];

for (const testCase of cases) {
  const result = classifyOperationalQuery(testCase.query, testCase.intent);
  assert.equal(
    result.category,
    testCase.category,
    `category: ${testCase.query || testCase.intent}`,
  );
  assert.equal(
    result.requiresLiveEvidence,
    testCase.live,
    `live evidence: ${testCase.query || testCase.intent}`,
  );
}

assert.equal(normalizeOperationalQueryText("  RÉSERVATION—ACTUELLE  "), "reservation actuelle");
assert.equal(
  classifyOperationalQuery("How does booking work?", "booking").requiresLiveEvidence,
  false,
);

console.log(`Knowledge operational query smoke passed (${cases.length + 2} checks).`);
