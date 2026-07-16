const en = {
  "resource.loading": "Loading current data...",
  "resource.loadFailed.title": "Data could not be loaded",
  "resource.loadFailed.description":
    "LeadVirt could not load the current data. Your existing data has not been changed.",
  "resource.retry": "Try again",
} as const;

export type ResourceTranslationKey = keyof typeof en;

function locale(overrides: Record<ResourceTranslationKey, string>) {
  return overrides;
}

const ru = locale({
  "resource.loading": "Загружаем актуальные данные...",
  "resource.loadFailed.title": "Не удалось загрузить данные",
  "resource.loadFailed.description":
    "LeadVirt не смог загрузить актуальные данные. Сохранённые данные не изменились.",
  "resource.retry": "Повторить",
});

const es = locale({
  "resource.loading": "Cargando los datos actuales...",
  "resource.loadFailed.title": "No se pudieron cargar los datos",
  "resource.loadFailed.description":
    "LeadVirt no pudo cargar los datos actuales. Los datos guardados no se modificaron.",
  "resource.retry": "Reintentar",
});

const fr = locale({
  "resource.loading": "Chargement des données actuelles...",
  "resource.loadFailed.title": "Impossible de charger les données",
  "resource.loadFailed.description":
    "LeadVirt n’a pas pu charger les données actuelles. Les données enregistrées n’ont pas été modifiées.",
  "resource.retry": "Réessayer",
});

const de = locale({
  "resource.loading": "Aktuelle Daten werden geladen...",
  "resource.loadFailed.title": "Daten konnten nicht geladen werden",
  "resource.loadFailed.description":
    "LeadVirt konnte die aktuellen Daten nicht laden. Gespeicherte Daten wurden nicht geändert.",
  "resource.retry": "Erneut versuchen",
});

const pt = locale({
  "resource.loading": "Carregando os dados atuais...",
  "resource.loadFailed.title": "Não foi possível carregar os dados",
  "resource.loadFailed.description":
    "O LeadVirt não conseguiu carregar os dados atuais. Os dados salvos não foram alterados.",
  "resource.retry": "Tentar novamente",
});

export const resourceMessages = { en, es, fr, de, pt, ru } as const;
