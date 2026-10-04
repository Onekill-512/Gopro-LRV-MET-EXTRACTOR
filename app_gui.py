import os
import platform
import shutil
import stat
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import filedialog, ttk

# Fix pour macOS : rediriger stdout/stderr si lancés sans console
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

dossier_actuel = None


def get_resource_path(relative_path):
    """Obtient le chemin absolu des ressources (.js, node_modules, etc.)"""
    if hasattr(sys, "_MEIPASS"):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath("."), relative_path)


def trouver_executable_node():
    """Trouve le binaire node sur le système macOS ou Windows"""
    node_path = shutil.which("node")
    if node_path:
        return node_path

    if platform.system() != "Windows":
        chemins_possibles = [
            os.path.expanduser("~/n/bin/node"),  # Installation via 'n'
            "/opt/homebrew/bin/node",  # Homebrew Apple Silicon
            "/usr/local/bin/node",  # Intallateur Mac standard (.pkg)
            os.path.expanduser("~/.nvm/versions/node"),
        ]

        for chemin in chemins_possibles:
            if os.path.isfile(chemin) and os.access(chemin, os.X_OK):
                return chemin
            elif os.path.isdir(chemin):
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


def choisir_dossier():
    global dossier_actuel
    dossier_actuel = filedialog.askdirectory(
        title="Sélectionnez le dossier contenant vos fichiers .LRV"
    )

    if dossier_actuel:
        label_dossier.config(
            text=f"Dossier sélectionné :\n{dossier_actuel}", fg="black"
        )
        bouton_gpx.config(state=tk.NORMAL)
        bouton_csv.config(state=tk.NORMAL)


def lancer_extraction(script_node):
    bouton_gpx.config(state=tk.DISABLED)
    bouton_csv.config(state=tk.DISABLED)
    bouton_parcourir.config(state=tk.DISABLED)
    progress_bar["value"] = 0
    status_label.config(text="Démarrage du traitement...", fg="blue")

    threading.Thread(
        target=traiter_extraction, args=(script_node,), daemon=True
    ).start()


def traiter_extraction(script_node):
    try:
        chemin_script = get_resource_path(script_node)
        cmd_node = trouver_executable_node()

        process = subprocess.Popen(
            [cmd_node, chemin_script, dossier_actuel],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            shell=False,
        )

        for line in process.stdout:
            line_str = line.strip()
            if not line_str:
                continue

            if line_str.startswith("PROGRESS:"):
                valeur = float(line_str.split(":")[1])
                fenetre.after(0, update_progress, valeur)
            elif line_str.startswith("STATUS:"):
                texte = line_str.split(":", 1)[1]
                fenetre.after(0, update_status, texte, "blue")

        process.wait()

        if process.returncode == 0:
            fenetre.after(
                0, update_status, "Traitement terminé avec succès !", "green"
            )
            fenetre.after(0, update_progress, 100)
        else:
            err = process.stderr.read()
            fenetre.after(
                0, update_status, "Erreur dans le script Node.js", "red"
            )

    except Exception as e:
        fenetre.after(0, update_status, f"Erreur : {str(e)}", "red")

    finally:
        fenetre.after(0, reset_boutons)


def update_progress(value):
    progress_bar["value"] = value


def update_status(text, color):
    status_label.config(text=text, fg=color)


def reset_boutons():
    bouton_gpx.config(state=tk.NORMAL)
    bouton_csv.config(state=tk.NORMAL)
    bouton_parcourir.config(state=tk.NORMAL)


# --- Initialisation Interface Tkinter ---
fenetre = tk.Tk()
fenetre.title("GoPro Telemetry Extractor")
fenetre.geometry("520x290")
fenetre.resizable(False, False)

# Activer le focus et passer la fenêtre au premier plan sur macOS
if platform.system() == "Darwin":
    os.system(
        '''/usr/bin/osascript -e 'tell app "Finder" to set frontmost of process "Python" to true' 2>/dev/null || true'''
    )

label_titre = tk.Label(
    fenetre, text="Extracteur de télémétrie GoPro", font=("Helvetica", 14, "bold")
)
label_titre.pack(pady=10)

bouton_parcourir = tk.Button(
    fenetre,
    text="Choisir le dossier des fichiers .LRV",
    command=choisir_dossier,
    padx=10,
    pady=5,
)
bouton_parcourir.pack(pady=5)

label_dossier = tk.Label(
    fenetre, text="Aucun dossier sélectionné", fg="gray", wraplength=480
)
label_dossier.pack(pady=5)

frame_boutons = tk.Frame(fenetre)
frame_boutons.pack(pady=10)

bouton_gpx = tk.Button(
    frame_boutons,
    text="Exporter en GPX",
    state=tk.DISABLED,
    padx=10,
    pady=5,
    command=lambda: lancer_extraction("index_gpx.js"),
)
bouton_gpx.grid(row=0, column=0, padx=10)

bouton_csv = tk.Button(
    frame_boutons,
    text="Exporter en CSV (OVRLEY)",
    state=tk.DISABLED,
    padx=10,
    pady=5,
    command=lambda: lancer_extraction("index_csv.js"),
)
bouton_csv.grid(row=0, column=1, padx=10)

progress_bar = ttk.Progressbar(
    fenetre, orient="horizontal", length=440, mode="determinate"
)
progress_bar.pack(pady=5)

status_label = tk.Label(fenetre, text="", font=("Helvetica", 9, "italic"))
status_label.pack(pady=2)

if __name__ == "__main__":
    fenetre.mainloop()
