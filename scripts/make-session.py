"""Recreate the three original instrumental studies. Requires numpy and soundfile."""
from pathlib import Path

import numpy as np
import soundfile as sf


RATE = 44100
ASSETS = Path(__file__).resolve().parents[1] / "src" / "assets"
STUDIES = [
    ("mist", 76, [50, 55, 52, 57], [7, 14, 11, 9, 7, 4, 2, 7]),
    ("creek", 92, [53, 48, 50, 46], [12, 7, 4, 2, 9, 7, 5, 4]),
    ("dusk", 68, [48, 45, 53, 55], [16, 14, 12, 7, 9, 7, 4, 2]),
]


def render(name, tempo, roots, melody):
    beat = 60 / tempo
    mix = np.zeros((round((32 * beat + 3) * RATE), 2))

    def note(start, midi, duration, level, pan, pad=False):
        at = round(start * RATE)
        length = min(round(duration * RATE), len(mix) - at)
        t = np.arange(length) / RATE
        phase = 2 * np.pi * 440 * 2 ** ((midi - 69) / 12) * t
        attack = np.minimum(1, t / (0.18 if pad else 0.012))
        env = attack * np.exp(-t / (1.6 if pad else 0.7))
        env *= np.clip((duration - t) / 0.22, 0, 1)
        tone = np.sin(phase + 0.65 * np.sin(2 * phase) * np.exp(-t * 5))
        tone += 0.25 * np.sin(2.003 * phase) + 0.09 * np.sin(3 * phase)
        mix[at:at + length] += (level * tone * env)[:, None] * [np.sqrt(1-pan), np.sqrt(pan)]

    for bar in range(8):
        root = roots[bar % len(roots)]
        start = bar * 4 * beat
        note(start, root - 12, 3.5 * beat, 0.31, 0.48, True)
        # Open fifths and added ninths leave space around the lead melody.
        for step, interval in enumerate([0, 7, 14, 19]):
            note(start + 0.045 * step, root + interval, 3.8 * beat, 0.08, 0.20 + step * 0.18, True)
        for step in range(4):
            pitch = root + 12 + melody[(bar * 2 + step) % len(melody)]
            offset = [0, 1.5, 2.5, 3.25][step] * beat
            note(start + offset, pitch, 1.7, [0.21, 0.14, 0.18, 0.12][step], 0.55 + 0.17 * (-1)**step)

    dry = mix.copy()
    for lag, reflection in [(0.17, 0.13), (0.31, 0.08), (0.47, 0.05)]:
        frames = round(lag * RATE)
        mix[frames:] += dry[:-frames, ::-1] * reflection
    mix[-RATE:] *= np.linspace(1, 0, RATE)[:, None]
    sf.write(ASSETS / (name + ".flac"), 0.72 * mix / np.abs(mix).max(), RATE, subtype="PCM_16")
    print(name, round(len(mix)/RATE, 2))


if __name__ == "__main__":
    for study in STUDIES:
        render(*study)
