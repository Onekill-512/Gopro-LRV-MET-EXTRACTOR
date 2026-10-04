import os
import platform
import shutil
import subprocess
import sys


def trouver_executable_node():
    """Trouve l'exécutable node embarqué dans le bundle PyInstaller ou sur le système"""
    est_windows = platform.system() == "Windows"
    nom_binaire = "node.exe" if est_windows else "node"

    # 1. Recherche du binaire embarqué dans le bundle PyInstaller (_MEIPASS)
    if hasattr(sys, "_MEIPASS"):
        binaire_embarque = os.path.join(sys._MEIPASS, nom_binaire)
        if os.path.exists(binaire_embarque):
            # Assure les droits d'exécution sur Mac/Linux
            if not est_windows:
                os.chmod(binaire_embarque, 0o755)
            return binaire_embarque

    # 2. Recherche dans le dossier local du projet (dev)
    binaire_local = os.path.join(os.path.abspath("."), nom_binaire)
    if os.path.exists(binaire_local):
        return binaire_local

    # 3. Fallback : recherche dans le PATH du système
    node_path = shutil.which("node")
    if node_path:
        return node_path

    # 4. Fallback dossiers standards Mac
    if not est_windows:
        chemins_mac = [
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
        ]
        for chemin in chemins_mac:
            chemin_abs = os.path.expanduser(chemin)
            if os.path.exists(chemin_abs):
                return chemin_abs

    return "node"
