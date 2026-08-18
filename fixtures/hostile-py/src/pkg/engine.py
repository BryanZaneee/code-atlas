"""Docstring trap.

Nothing below this line is an import, though a naive line-anchored regex reads
import os: the colon makes it prose, and prose is what this paragraph is.
"""

from .lib.util import slugify
from . import registry
from .missing_module import nothing


class Engine:
    def run(self, name):
        return registry.lookup(slugify(name))
