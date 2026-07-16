import { AlertTriangle, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "../components/ui/Button";
import { EmptyState } from "./ui";

export function ResourceErrorState({
  onRetry,
  testId = "resource-load-error",
  title,
  description,
}: {
  onRetry?: () => void;
  testId?: string;
  title?: string;
  description?: string;
}) {
  const { t } = useI18n();

  return (
    <div data-testid={testId} role="alert">
      <EmptyState
        icon={AlertTriangle}
        title={title ?? t("resource.loadFailed.title")}
        description={description ?? t("resource.loadFailed.description")}
        action={
          onRetry ? (
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={onRetry}>
              <RefreshCw className="h-4 w-4" />
              {t("resource.retry")}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
