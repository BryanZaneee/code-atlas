import re

from ..constants import SEPARATOR


def slugify(name):
    return re.sub(r"\W+", SEPARATOR, name).strip(SEPARATOR)
