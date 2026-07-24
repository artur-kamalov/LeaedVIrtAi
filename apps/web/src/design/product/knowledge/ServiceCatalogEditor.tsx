"use client";

import * as React from "react";
import type { BusinessProfileServiceItem } from "@leadvirt/types";
import { ChevronLeft, ChevronRight, ChevronUp, Pencil, Search, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { Select } from "../ui";

const PAGE_SIZE = 20;

type ServiceField = keyof BusinessProfileServiceItem;
type SortValue = "ORIGINAL" | "NAME_ASC" | "NAME_DESC";

const inputClassName =
  "h-10 w-full min-w-0 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-rose-500/60";

export function ServiceCatalogEditor({
  services,
  disabled,
  fieldErrors,
  onChange,
  onRemove,
}: {
  services: BusinessProfileServiceItem[];
  disabled: boolean;
  fieldErrors: Record<string, string>;
  onChange: (index: number, field: ServiceField, value: string) => void;
  onRemove: (index: number) => void;
}) {
  const { formatNumber, t } = useI18n();
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState<SortValue>("ORIGINAL");
  const [page, setPage] = React.useState(1);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [lockedOrder, setLockedOrder] = React.useState<string[] | null>(null);
  const previousLength = React.useRef(services.length);
  const previousErrorSignature = React.useRef("");

  React.useEffect(() => {
    if (services.length > previousLength.current) {
      const added = services.at(-1);
      if (added) {
        setSearch("");
        setSort("ORIGINAL");
        setPage(Math.max(1, Math.ceil(services.length / PAGE_SIZE)));
        setExpandedId(added.id);
        setLockedOrder(services.map((service) => service.id));
        window.requestAnimationFrame(() => {
          document
            .querySelector<HTMLInputElement>(
              `[data-service-id="${CSS.escape(added.id)}"][data-service-field="name"]`,
            )
            ?.focus();
        });
      }
    }
    previousLength.current = services.length;
  }, [services]);

  React.useEffect(() => {
    if (expandedId && !services.some((service) => service.id === expandedId)) {
      setExpandedId(null);
      setLockedOrder(null);
    }
  }, [expandedId, services]);

  React.useEffect(() => {
    const serviceErrorKeys = Object.keys(fieldErrors)
      .filter((key) => key.startsWith("services."))
      .sort();
    const signature = serviceErrorKeys.join("|");
    const shouldFocus = signature.length > 0 && signature !== previousErrorSignature.current;
    previousErrorSignature.current = signature;
    if (!shouldFocus) return;
    const firstError = serviceErrorKeys
      .map((key) => {
        const match = /^services\.(\d+)\.(name|price|duration|description)$/.exec(key);
        return match ? { index: Number(match[1]), field: match[2] as ServiceField } : null;
      })
      .filter((value): value is { index: number; field: ServiceField } => value !== null)
      .sort((left, right) => left.index - right.index)[0];
    const service = firstError ? services[firstError.index] : null;
    if (!firstError || !service) return;
    setSearch("");
    setSort("ORIGINAL");
    setPage(Math.floor(firstError.index / PAGE_SIZE) + 1);
    setExpandedId(service.id);
    setLockedOrder(services.map((item) => item.id));
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-service-id="${CSS.escape(service.id)}"][data-service-field="${firstError.field}"]`,
        )
        ?.focus();
    });
  }, [fieldErrors, services]);

  const rows = React.useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = services
      .map((service, index) => ({ service, index }))
      .filter(({ service }) =>
        query && service.id !== expandedId
          ? [service.name, service.description, service.price, service.duration]
              .join(" ")
              .toLocaleLowerCase()
              .includes(query)
          : true,
      );
    if (lockedOrder) {
      const positions = new Map(lockedOrder.map((id, index) => [id, index]));
      return [...filtered].sort(
        (left, right) =>
          (positions.get(left.service.id) ?? Number.MAX_SAFE_INTEGER) -
          (positions.get(right.service.id) ?? Number.MAX_SAFE_INTEGER),
      );
    }
    if (sort === "ORIGINAL") return filtered;
    return [...filtered].sort((left, right) => {
      const result = left.service.name.localeCompare(right.service.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      return sort === "NAME_ASC" ? result : -result;
    });
  }, [expandedId, lockedOrder, search, services, sort]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  React.useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return (
    <div className="min-w-0" data-testid="business-profile-services">
      <div className="mb-3 grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_220px_auto]">
        <label className="relative min-w-0">
          <span className="sr-only">{t("businessProfile.services.searchAria")}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
          <input
            type="search"
            value={search}
            placeholder={t("businessProfile.services.searchPlaceholder")}
            aria-label={t("businessProfile.services.searchAria")}
            className={cn(inputClassName, "pl-9")}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
              if (!expandedId) setLockedOrder(null);
            }}
            data-testid="business-profile-services-search"
          />
        </label>
        <Select
          value={sort}
          options={[
            { value: "ORIGINAL", label: t("businessProfile.services.sortOriginal") },
            { value: "NAME_ASC", label: t("businessProfile.services.sortNameAsc") },
            { value: "NAME_DESC", label: t("businessProfile.services.sortNameDesc") },
          ]}
          ariaLabel={t("businessProfile.services.sortAria")}
          onValueChange={(value) => {
            setSort(value as SortValue);
            setPage(1);
            if (!expandedId) setLockedOrder(null);
          }}
          className="h-10 rounded-md px-3"
          testId="business-profile-services-sort"
        />
        <div className="flex h-10 items-center justify-end text-xs text-zinc-500">
          {t("businessProfile.services.resultCount", {
            count: formatNumber(rows.length),
            total: formatNumber(services.length),
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-600">
          {services.length === 0
            ? t("businessProfile.services.empty")
            : t("businessProfile.services.noResults")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-white/10">
          <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(120px,0.45fr)_minmax(120px,0.45fr)_88px] gap-3 border-b border-white/10 bg-white/[0.025] px-3 py-2 text-xs font-medium text-zinc-600 md:grid">
            <span>{t("businessProfile.services.name")}</span>
            <span>{t("businessProfile.services.price")}</span>
            <span>{t("businessProfile.services.duration")}</span>
            <span className="text-right">{t("businessProfile.services.actions")}</span>
          </div>
          {visibleRows.map(({ service, index }) => {
            const expanded = expandedId === service.id;
            return (
              <div
                key={service.id}
                className="border-b border-white/[0.07] last:border-b-0"
                data-testid={`business-profile-service-${index}`}
              >
                <div className="grid min-h-[52px] min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-2 py-1 md:grid-cols-[minmax(0,1.5fr)_minmax(120px,0.45fr)_minmax(120px,0.45fr)_80px] md:gap-3 md:px-3 md:py-1.5">
                  <div className="col-start-1 row-start-1 min-w-0 md:col-auto md:row-auto">
                    <p className="truncate text-sm font-medium text-zinc-200" title={service.name}>
                      {service.name || t("businessProfile.services.untitled")}
                    </p>
                  </div>
                  <div className="col-start-1 row-start-2 flex min-w-0 items-center gap-1.5 overflow-hidden md:contents">
                    <p
                      className="min-w-0 truncate text-xs text-zinc-500 md:text-sm md:text-zinc-400"
                      title={service.price}
                    >
                      {service.price || "-"}
                    </p>
                    <span className="shrink-0 text-xs text-zinc-700 md:hidden">|</span>
                    <p
                      className="min-w-0 truncate text-xs text-zinc-500 md:text-sm md:text-zinc-400"
                      title={service.duration}
                    >
                      {service.duration || "-"}
                    </p>
                  </div>
                  <div className="col-start-2 row-span-2 row-start-1 flex items-center justify-end gap-0.5 md:col-auto md:row-auto md:gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-expanded={expanded}
                      aria-label={t(
                        expanded
                          ? "businessProfile.services.collapse"
                          : "businessProfile.services.edit",
                        { name: service.name || formatNumber(index + 1) },
                      )}
                      disabled={disabled}
                      onClick={() => {
                        if (expanded) {
                          setExpandedId(null);
                          setLockedOrder(null);
                          return;
                        }
                        setExpandedId(service.id);
                        setLockedOrder(rows.map((row) => row.service.id));
                      }}
                      data-testid={`business-profile-edit-service-${index}`}
                    >
                      {expanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <Pencil className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-zinc-500 hover:text-rose-400"
                      disabled={disabled}
                      aria-label={t("businessProfile.services.remove", { count: index + 1 })}
                      onClick={() => onRemove(index)}
                      data-testid={`business-profile-remove-service-${index}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {expanded ? (
                  <div
                    className="grid min-w-0 gap-3 border-t border-white/[0.07] bg-white/[0.018] px-3 py-3 md:grid-cols-2 lg:grid-cols-12"
                    data-testid={`business-profile-service-${index}-editor`}
                  >
                    <ServiceField
                      label={t("businessProfile.services.name")}
                      id={`business-profile-service-${index}-name`}
                      error={fieldErrors[`services.${index}.name`]}
                      className="lg:col-span-5"
                    >
                      <input
                        id={`business-profile-service-${index}-name`}
                        data-testid={`business-profile-service-${index}-name`}
                        data-service-id={service.id}
                        data-service-field="name"
                        value={service.name}
                        maxLength={160}
                        disabled={disabled}
                        aria-invalid={Boolean(fieldErrors[`services.${index}.name`])}
                        className={inputClassName}
                        onChange={(event) => onChange(index, "name", event.target.value)}
                      />
                    </ServiceField>
                    <ServiceField
                      label={t("businessProfile.services.price")}
                      id={`business-profile-service-${index}-price`}
                      error={fieldErrors[`services.${index}.price`]}
                      className="lg:col-span-3"
                    >
                      <input
                        id={`business-profile-service-${index}-price`}
                        data-testid={`business-profile-service-${index}-price`}
                        data-service-id={service.id}
                        data-service-field="price"
                        value={service.price}
                        maxLength={160}
                        disabled={disabled}
                        aria-invalid={Boolean(fieldErrors[`services.${index}.price`])}
                        placeholder={t("businessProfile.services.pricePlaceholder")}
                        className={inputClassName}
                        onChange={(event) => onChange(index, "price", event.target.value)}
                      />
                    </ServiceField>
                    <ServiceField
                      label={t("businessProfile.services.duration")}
                      id={`business-profile-service-${index}-duration`}
                      error={fieldErrors[`services.${index}.duration`]}
                      className="lg:col-span-4"
                    >
                      <input
                        id={`business-profile-service-${index}-duration`}
                        data-testid={`business-profile-service-${index}-duration`}
                        data-service-id={service.id}
                        data-service-field="duration"
                        value={service.duration}
                        maxLength={160}
                        disabled={disabled}
                        aria-invalid={Boolean(fieldErrors[`services.${index}.duration`])}
                        placeholder={t("businessProfile.services.durationPlaceholder")}
                        className={inputClassName}
                        onChange={(event) => onChange(index, "duration", event.target.value)}
                      />
                    </ServiceField>
                    <ServiceField
                      label={t("businessProfile.services.descriptionLabel")}
                      id={`business-profile-service-${index}-description`}
                      error={fieldErrors[`services.${index}.description`]}
                      className="md:col-span-2 lg:col-span-12"
                    >
                      <textarea
                        id={`business-profile-service-${index}-description`}
                        data-testid={`business-profile-service-${index}-description`}
                        data-service-id={service.id}
                        data-service-field="description"
                        value={service.description}
                        maxLength={2_000}
                        disabled={disabled}
                        aria-invalid={Boolean(fieldErrors[`services.${index}.description`])}
                        placeholder={t("businessProfile.services.descriptionPlaceholder")}
                        className={cn(inputClassName, "h-auto min-h-20 resize-y py-2.5")}
                        onChange={(event) => onChange(index, "description", event.target.value)}
                      />
                    </ServiceField>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {pageCount > 1 ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-600">
            {t("businessProfile.services.page", {
              page: formatNumber(currentPage),
              pages: formatNumber(pageCount),
            })}
          </p>
          <div className="flex gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              disabled={currentPage <= 1}
              aria-label={t("businessProfile.services.previousPage")}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              disabled={currentPage >= pageCount}
              aria-label={t("businessProfile.services.nextPage")}
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ServiceField({
  label,
  id,
  error,
  className,
  children,
}: {
  label: string;
  id: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-zinc-400">
        {label}
      </label>
      {children}
      {error ? <p className="mt-1.5 text-xs text-rose-400">{error}</p> : null}
    </div>
  );
}
