// A router the file names something other than `router`, alongside an HTTP
// CLIENT call in the same file. The first must be found, the second must not:
// widening the receiver by name rather than by declaration would make
// `client.post("/hooks/order")` a phantom endpoint.
import { Router } from "express";
import axios from "axios";

export const orders = Router();

orders.get("/orders", (req, res) => res.json([]));
orders.post("/orders", (req, res) => res.json(req.body));

const client = axios.create();
export function notify(o) { return client.post("/hooks/order", o); }
