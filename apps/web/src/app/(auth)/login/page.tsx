import { AuthFlow } from "../AuthFlow";

interface LoginPageProps {
  searchParams?: Promise<{ plan?: string | string[]; returnTo?: string | string[] }>;
}

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  return (
    <AuthFlow
      mode="login"
      intent={{ plan: first(params?.plan), returnTo: first(params?.returnTo) }}
    />
  );
}
