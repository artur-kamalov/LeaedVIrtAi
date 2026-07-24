import type {
  BusinessProfileDay,
  BusinessProfilePatch,
  BusinessProfilePatchRequest,
  BusinessProfileScheduleDay,
  BusinessProfileServiceItem,
} from "@leadvirt/types";
import { BUSINESS_IMPORT_SERVICE_LIMIT } from "@leadvirt/business-import";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { IsKnowledgeV2TimeZone } from "../../knowledge/dto/knowledge-v2-validation.js";
import { IsBusinessProfilePayloadSize } from "../business-profile-limits.js";

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const CLOCK_TIME_OR_EMPTY = /^(?:|(?:[01]\d|2[0-3]):[0-5]\d)$/;
const DAYS: readonly BusinessProfileDay[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export class BusinessProfileServiceItemDto implements BusinessProfileServiceItem {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(OPAQUE_ID)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Matches(/\S/)
  name!: string;

  @IsString()
  @MaxLength(2_000)
  description!: string;

  @IsString()
  @MaxLength(160)
  price!: string;

  @IsString()
  @MaxLength(160)
  duration!: string;
}

export class BusinessProfileScheduleDayDto implements BusinessProfileScheduleDay {
  @IsIn(DAYS)
  day!: BusinessProfileDay;

  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @MaxLength(5)
  @Matches(CLOCK_TIME_OR_EMPTY)
  opensAt!: string;

  @IsString()
  @MaxLength(5)
  @Matches(CLOCK_TIME_OR_EMPTY)
  closesAt!: string;
}

export class BusinessProfilePatchDto implements BusinessProfilePatch {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Matches(/\S/)
  businessType?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Matches(/\S/)
  name?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(4_000)
  description?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(500)
  avgCheck?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(20_000)
  servicesCatalog?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(BUSINESS_IMPORT_SERVICE_LIMIT)
  @ArrayUnique((service: BusinessProfileServiceItemDto) => service.id)
  @ValidateNested({ each: true })
  @Type(() => BusinessProfileServiceItemDto)
  services?: BusinessProfileServiceItemDto[];

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(4_000)
  hours?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique((entry: BusinessProfileScheduleDayDto) => entry.day)
  @ValidateNested({ each: true })
  @Type(() => BusinessProfileScheduleDayDto)
  weeklySchedule?: BusinessProfileScheduleDayDto[];

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(10_000)
  availability?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(20_000)
  faq?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(20_000)
  policies?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(20_000)
  escalationRules?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(64)
  @IsKnowledgeV2TimeZone()
  timezone?: string;
}

export class BusinessProfilePatchRequestDto implements BusinessProfilePatchRequest {
  @IsDefined()
  @IsBusinessProfilePayloadSize()
  @ValidateNested()
  @Type(() => BusinessProfilePatchDto)
  profile!: BusinessProfilePatchDto;
}
