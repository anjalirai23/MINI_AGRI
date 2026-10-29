"""One command to (re)build every model:  python train_all.py

Runs the recommender, demand and price trainers in order and prints honest back-test accuracy.
Expect roughly 5-15 minutes on a laptop CPU (the LSTMs are the slow part).
Restart the ML service afterwards: uvicorn app:app --host 0.0.0.0 --port 8000
"""
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STEPS = ["training/train_recommend.py", "training/train_demand.py", "training/train_price.py"]

if __name__ == "__main__":
    start = time.time()
    for step in STEPS:
        print(f"\n##### {step}")
        code = subprocess.call([sys.executable, str(ROOT / step)], cwd=ROOT)
        if code != 0:
            sys.exit(f"{step} failed (exit code {code}). Fix the error above, then run train_all.py again.")
    print(f"\nAll models trained in {(time.time() - start) / 60:.1f} min. Now restart the ML service.")
