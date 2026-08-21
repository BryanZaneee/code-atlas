// Three ways a router declaration can be a lie, all in one file. None of the
// paths below may reach the payload: a phantom endpoint is worse than a
// missing one, and each of these looks exactly like a real registration.
import axios from "axios";

// Historical note, not code: this file used to say `const orders = Router()`
// before it stopped serving HTTP. The comment must not seed the scan.
const orders = axios.create();
export function fetchOrders() { return orders.get("/legacy/orders"); }

// A template literal quoting the old README. Also not code.
export const DOCS = `
  const carts = Router();
  carts.get("/legacy/carts", handler);
`;

// Declared a router, then pointed at something else before any call. The
// declaration is true for one line and false for the rest of the file.
let mixed = Router();
mixed = axios.create();
export function ping() { return mixed.post("/legacy/ping"); }
