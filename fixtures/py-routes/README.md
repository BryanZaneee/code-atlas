# py-routes

A FastAPI app whose routes must survive comment blanking, and whose
commented-out routes must not.

Python files were being blanked with the TypeScript blanker, which does not
recognise `#`. A commented-out route was therefore extracted as a live
endpoint -- a phantom endpoint, the one thing the extractor may never emit.
The docstring case is the mirror: a route path inside `"""..."""` is prose,
not a registration.
