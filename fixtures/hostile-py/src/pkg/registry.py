# Circular on purpose: engine imports this module, and this module imports
# engine back. Neither may drop out of the graph because of it.
from .engine import Engine

KNOWN = {}


def lookup(key):
    return KNOWN.get(key, Engine)
