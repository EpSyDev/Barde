"""Registre des modules configurables de La Fripouille.

Chaque module = deux moitiés : **config** (schéma + valeurs par défaut, éditées
depuis le dashboard, persistées, lues par le bot) et **runtime** (le comportement
Discord, rendu par le bot). Le dashboard n'exécute jamais l'action Discord : il
écrit la config, et `apply()` la répercute à chaud (pas de restart).

Ajouter une feature = déclarer un `Module` ici (schéma + défauts), coder son
runtime, et — côté dashboard — une page de formulaire. L'API `/api/config/{module}`
est générique : rien à écrire par module côté transport.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Awaitable, Callable, Optional

if TYPE_CHECKING:
    from .bot import FripouilleBot

ApplyFn = Callable[["FripouilleBot", dict], Awaitable[None]]
# Action : reçoit le bot + le corps JSON de la requête, renvoie un dict de résultat.
ActionFn = Callable[["FripouilleBot", dict], Awaitable[dict]]


@dataclass
class Module:
    key: str                          # identifiant URL : /api/config/{key}
    label: str                        # libellé affiché dans le dashboard
    defaults: dict                    # schéma + valeurs par défaut
    apply: Optional[ApplyFn] = None   # répercussion à chaud ; None si config lue à la volée
    actions: dict = field(default_factory=dict)  # actions ponctuelles : nom → ActionFn


_MODULES: dict[str, Module] = {}


def register(module: Module) -> Module:
    """Enregistre un module (appelé au chargement de chaque fichier de modules/)."""
    _MODULES[module.key] = module
    return module


def get(key: str) -> Optional[Module]:
    return _MODULES.get(key)


def all_modules() -> dict[str, Module]:
    return dict(_MODULES)
