import type { ComponentProps } from "react";
import { Button as ShadcnButton } from "./button-shadcn";

type DesignVariant = "primary" | "secondary" | "outline" | "ghost" | "default";
type DesignSize = "sm" | "md" | "lg" | "default" | "icon";

type ButtonProps = Omit<ComponentProps<typeof ShadcnButton>, "variant" | "size"> & {
  variant?: DesignVariant;
  size?: DesignSize;
};

const variantMap: Record<DesignVariant, ComponentProps<typeof ShadcnButton>["variant"]> = {
  primary: "default",
  default: "default",
  secondary: "secondary",
  outline: "outline",
  ghost: "ghost"
};

const sizeMap: Record<DesignSize, ComponentProps<typeof ShadcnButton>["size"]> = {
  sm: "sm",
  md: "default",
  default: "default",
  lg: "lg",
  icon: "icon"
};

export function Button({ variant = "primary", size = "md", ...props }: ButtonProps) {
  return <ShadcnButton variant={variantMap[variant]} size={sizeMap[size]} {...props} />;
}
