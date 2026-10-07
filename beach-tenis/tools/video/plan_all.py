import json, numpy as np
from seg import *; import swings
plan = []
for seg in range(14):
    a, b, v, pk, dirs, s_, dmp, ex = swings.find_swings(seg, prom=0.5)
    ok = [(i, p) for i, p in enumerate(pk) if p >= 20 and (b - a) - p >= 15]
    ok.sort(key=lambda ip: -v[ip[1]])
    for n, (i, p) in enumerate(ok[:1 if KEYS[seg] == 'saque' else 2]):   # saque: só a repetição completa (a outra termina antes do contato)
        plan.append([seg, int(i), f'v_{KEYS[seg]}_{n + 1}'])
    print(LABELS[seg].ljust(20), [(f'{(a + p) / FPS:.2f}s', round(float(v[p]), 1)) for i, p in ok[:2]])
json.dump(plan, open('plan.json', 'w')); print(len(plan), 'clipes')
