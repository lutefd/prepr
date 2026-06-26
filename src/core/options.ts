import type { FindingCategory } from "../shared/types.js";
import { categories } from "./schema.js";
import { PreprError } from "./errors.js";

export function parseCategories(value?: string): FindingCategory[] | undefined {
  if (!value) return undefined;
  const parsed = value.split(",").map((item) => item.trim()).filter(Boolean);
  const invalid = parsed.filter((item) => !(categories as readonly string[]).includes(item));
  if (invalid.length) {
    throw new PreprError(`Invalid --only categories: ${invalid.join(", ")}. Allowed: ${categories.join(", ")}`, "INVALID_OPTION");
  }
  return parsed as FindingCategory[];
}

export function parseRisk(value = "medium"): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new PreprError("--risk must be low, medium, or high.", "INVALID_OPTION");
}
