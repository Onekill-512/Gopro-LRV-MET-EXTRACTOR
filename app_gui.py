import os
import platform
import shutil
import sys


def trouver_executable_node():
    """Trouve l'exécutable Node.js présent sur le système (Windows ou macOS)"""
    # 1. Si disponible dans le PATH actif
    node_path = shutil.which("node")
    if node_path:
        return node_path

    # 2. Chemins spécifiques sous macOS
    if platform.system() != "Windows":
        chemins_possibles = [
            os.path.expanduser(
                "~/n/bin/node"
            ),  # Installation via le gestionnaire 'n'
            "/opt/homebrew/bin/node",  # Homebrew Apple Silicon
            "/usr/local/bin/node",  # Installer .pkg classique
            os.path.expanduser("~/.nvm/versions/node"),  # NVM
        ]

        for chemin in chemins_possibles:
            if os.path.isfile(chemin) and os.access(chemin, os.X_OK):
                return chemin
            elif os.path.isdir(chemin):
                # NVM : chercher dans la version la plus récente
                try:
                    versions = sorted(os.listdir(chemin))
                    if versions:
                        node_nvm = os.path.join(
                            chemin, versions[-1], "bin", "node"
                        )
                        if os.path.isfile(node_nvm) and os.access(
                            node_nvm, os.X_OK
                        ):
                            return node_nvm
                except Exception:
                    pass

    return "node"
