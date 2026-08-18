const app = {
  get: (p: string) => p,
};

// Two frameworks, one param: Flask/FastAPI write `{id}`, Express writes `:id`.
// The same route declared both ways must collapse to one node, not two.
app.get("/items/{id}");
app.get("/items/:id");
app.get("/users/:id");
