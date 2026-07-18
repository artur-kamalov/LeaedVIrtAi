import { AuthFlow } from "../AuthFlow";

interface SignupPageProps {
  searchParams?: Promise<{ plan?: string | string[]; returnTo?: string | string[] }>;
}

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  return (
    <AuthFlow
      mode="signup"
      intent={{ plan: first(params?.plan), returnTo: first(params?.returnTo) }}
    />
  );
}
