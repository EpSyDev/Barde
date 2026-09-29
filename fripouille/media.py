"""Étiquettes des fichiers média (nom d'origine associé au nom de stockage haché).

Partagé entre l'API web (upload/renommage/liste) et le module ``messages`` (nom de la
pièce jointe envoyée sur Discord), pour que le titre choisi par Nico soit celui qui
apparaît partout — pas le hash du nom de stockage.
"""
import json

from . import config

LABELS_PATH = config.DATA_DIR / "media_labels.json"


def load_labels():
    try:
        return json.loads(LABELS_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}


def save_labels(labels):
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    LABELS_PATH.write_text(json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8")


def label_for(name):
    return load_labels().get(name, name)
