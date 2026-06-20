import type { SignificantChange } from "@/lib/signals/types";

export function collisionChipText(c: SignificantChange): string {
  return `Our sources put ${c.label} at ${c.current_value}. Your filed ${c.previous_value} is ${c.delta_description} off — your number stays.`;
}
