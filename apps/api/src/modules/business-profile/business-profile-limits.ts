import type { ValidationOptions } from "class-validator";
import { ValidateBy, buildMessage } from "class-validator";

export const BUSINESS_PROFILE_MAX_SERIALIZED_BYTES = 224 * 1024;

export function businessProfileSerializedBytes(value: unknown) {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? Number.POSITIVE_INFINITY
      : Buffer.byteLength(serialized, "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function IsBusinessProfilePayloadSize(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: "isBusinessProfilePayloadSize",
      validator: {
        validate: (value) =>
          businessProfileSerializedBytes(value) <= BUSINESS_PROFILE_MAX_SERIALIZED_BYTES,
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must be at most ${BUSINESS_PROFILE_MAX_SERIALIZED_BYTES} UTF-8 bytes`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
