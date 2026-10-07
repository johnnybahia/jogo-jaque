import sys, subprocess, numpy as np, time
import mediapipe as mp
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision

SRC, MODEL, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
W, H, FPS = 720, 1280, 30
opts = vision.PoseLandmarkerOptions(
    base_options=mpp.BaseOptions(model_asset_path=MODEL),
    running_mode=vision.RunningMode.VIDEO, num_poses=1,
    min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5, min_tracking_confidence=0.5)
det = vision.PoseLandmarker.create_from_options(opts)
proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", SRC, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=W * H * 3 * 4)
world, img, vis, ok = [], [], [], []
t0 = time.time(); i = 0
while True:
    buf = proc.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    frame = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    res = det.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=frame), int(i * 1000 / FPS))
    if res.pose_world_landmarks:
        wl, il = res.pose_world_landmarks[0], res.pose_landmarks[0]
        world.append([[p.x, p.y, p.z] for p in wl]); img.append([[p.x, p.y, p.z] for p in il]); vis.append([p.visibility for p in il]); ok.append(1)
    else:
        world.append(np.full((33, 3), np.nan).tolist()); img.append(np.full((33, 3), np.nan).tolist()); vis.append([0] * 33); ok.append(0)
    i += 1
    if i % 100 == 0: print(f"{i} frames, {time.time() - t0:.0f}s", flush=True)
np.savez_compressed(OUT, world=np.array(world, np.float32), img=np.array(img, np.float32), vis=np.array(vis, np.float32), ok=np.array(ok, np.int8), fps=FPS, W=W, H=H)
print("done", i, "frames; detected", int(sum(ok)), f"{time.time() - t0:.0f}s", flush=True)
