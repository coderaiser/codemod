import { resolve } from "node:path";
import {
  type Output,
  array,
  boolean,
  minValue,
  number,
  object,
  optional,
  parse,
  string,
} from "valibot";

export const DEFAULT_EXCLUDE_PATTERNS = ["**/node_modules/**/*.*", "**/*.d.ts"];
export const DEFAULT_INPUT_DIRECTORY_PATH = process.cwd();
export const DEFAULT_ENABLE_PRETTIER = true;
export const DEFAULT_CACHE = true;
export const DEFAULT_INSTALL = true;
export const DEFAULT_USE_JSON = false;
export const DEFAULT_THREAD_COUNT = 4;
export const DEFAULT_DRY_RUN = false;

export const flowSettingsSchema = object({
  include: optional(array(string())),
  exclude: optional(array(string())),
  target: optional(string(), DEFAULT_INPUT_DIRECTORY_PATH),
  files: optional(array(string())),
  format: optional(boolean(), DEFAULT_ENABLE_PRETTIER),
  cache: optional(boolean(), DEFAULT_CACHE),
  install: optional(boolean(), DEFAULT_INSTALL),
  json: optional(boolean(), DEFAULT_USE_JSON),
  threads: optional(number([minValue(0)]), DEFAULT_THREAD_COUNT),
});

export type FlowSettings = Omit<
  Output<typeof flowSettingsSchema>,
  "exclude"
> & {
  exclude: string[];
};

export const parseFlowSettings = (input: unknown): FlowSettings => {
  const flowSettings = parse(flowSettingsSchema, input);

  return {
    ...flowSettings,
    target: resolve(flowSettings.target),
    exclude: (flowSettings.exclude ?? []).concat(DEFAULT_EXCLUDE_PATTERNS),
  };
};
