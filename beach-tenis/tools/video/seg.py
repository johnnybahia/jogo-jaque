import numpy as np
CUTS = [0, 4.5333, 8.8667, 13.6333, 17.9667, 22.0667, 26.4667, 31.3333, 35.3667, 39.3667, 43.6333, 48.3, 52.0333, 55.6333, 60.07]
LABELS = ["Forehand Dinâmico", "Forehand Estático", "Backhand Dinâmico", "Backhand Estático", "Anômalo", "Smash", "Gancho", "Rainbow/Ventaglio", "Bandeja Forehand", "Bandeja Backhand", "Verônica", "Espeto", "Arco inferior/Leque", "Saque/Serviço"]
KEYS = ["fh_din", "fh_est", "bh_din", "bh_est", "anomalo", "smash", "gancho", "rainbow", "band_fh", "band_bh", "veronica", "espeto", "arco", "saque"]
FPS = 30
SEGS = [(int(round(CUTS[i] * FPS)), int(round(CUTS[i + 1] * FPS))) for i in range(14)]
