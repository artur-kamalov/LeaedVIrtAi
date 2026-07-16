export function isApiDeploymentPreflight(
  environment: Record<string, string | undefined> = process.env,
) {
  const value = environment.API_DEPLOYMENT_PREFLIGHT?.trim().toLowerCase();
  if (!value || ["0", "false", "no", "off"].includes(value)) return false;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  throw new Error("API_DEPLOYMENT_PREFLIGHT must be a boolean value.");
}
