import { IsIn } from "class-validator";

export class UpdateLocalePreferenceDto {
  @IsIn(["en", "es", "fr", "de", "pt", "ru"])
  locale!: "en" | "es" | "fr" | "de" | "pt" | "ru";
}
