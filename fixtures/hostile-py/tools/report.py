import json

import pkg.engine
from pkg import slugify

TEXT = """
from pkg import NotAnImport
"""


def main():
    print(json.dumps({"engine": str(pkg.engine.Engine), "slug": slugify("a b")}), TEXT)
