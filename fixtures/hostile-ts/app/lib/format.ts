import { LABEL_PREFIX } from "./strings";
// Circular on purpose: button.tsx imports this module by its alias, and this
// module imports button.tsx back by the same alias, side-effect only.
import "@/widgets/button";

export function formatLabel(label: string) {
  return LABEL_PREFIX + label;
}
