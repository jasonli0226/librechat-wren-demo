"""Uvicorn entry point: `uvicorn gallery.main:app --workers 1`."""

import logging
import os

from .app import create_app
from .config import Settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
app = create_app(Settings.from_env(os.environ))
