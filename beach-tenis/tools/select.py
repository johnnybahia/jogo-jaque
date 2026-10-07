import json, sys, collections, numpy as np
C = json.load(open(sys.argv[1]))
pl = lambda x: x["file"].split("_")[0]
vote = collections.defaultdict(collections.Counter)
for x in C:
    if x["kind"] in ("serve", "smash", "forehand"): vote[pl(x)][x["side"]] += 1
hand = {p: v.most_common(1)[0][0] for p, v in vote.items()}
print("jogadores:", len(hand), "canhotos:", [p for p, h in hand.items() if h == "Left"])
sel = []
for k in ("forehand", "backhand", "serve", "smash", "fvolley", "bvolley"):
    L = [x for x in C if x["kind"] == k and hand.get(pl(x)) == "Right"]
    rmed = np.median([x["rough"] for x in L]); pk = np.percentile([x["peak"] for x in L], 90)
    L = [x for x in L if x["rough"] <= rmed and abs(x["dx"]) < 80 and abs(x["dz"]) < 80 and x["peak"] <= pk * 1.02]
    L.sort(key=lambda x: (-x["hp"], -x["peak"]))
    used = set(); n = 0
    for x in L:
        if pl(x) in used: continue
        used.add(pl(x)); x = dict(x); x["name"] = f"{k}_{n+1}"; sel.append(x); n += 1
        print(x["name"], x["file"], f'{x["start"]}-{x["end"]} contato@{x["contact"]} peak {x["peak"]:.0f} hp {x["hp"]} rough {x["rough"]:.1f} dx {x["dx"]:.0f} dz {x["dz"]:.0f}')
        if n == 2: break
json.dump(sel, open(sys.argv[2], "w"), indent=1)
