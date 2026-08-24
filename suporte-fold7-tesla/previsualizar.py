#!/usr/bin/env python3
"""Desenha o conjunto montado (braco + berco + telemovel) num PNG."""
import numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
from trimesh.transformations import rotation_matrix
from trimesh.creation import box
import gerar

t = np.radians(gerar.ARM_TILT)
n = np.array([0.0, np.cos(t), np.sin(t)])
ORG = np.array([0.0, 0.0, gerar.ARM_TOP]) + gerar.JOINT_OFF * n


def assemble(mesh, roll=0.0):
    m = mesh.copy()
    m.apply_translation([0, -gerar.JOINT_Y, 0])
    m.apply_transform(rotation_matrix(np.pi + np.radians(roll), [0, 0, 1]))
    m.apply_transform(rotation_matrix(t - np.pi / 2, [1, 0, 0]))
    m.apply_translation(ORG)
    return m


arm = gerar.clean(gerar.base_arm())
cra = assemble(gerar.clean(gerar.cradle(gerar.PHONE_W + 5.0, 8.5, "")))
pho = box(extents=[gerar.PHONE_W, gerar.PHONE_H, gerar.PHONE_T])
pho.apply_translation([0, gerar.SHELF_Y + gerar.PHONE_H / 2, gerar.BACK_T + gerar.PHONE_T / 2])
pho = assemble(pho)

fig = plt.figure(figsize=(11, 5.5))
for i, (elev, azim, titulo) in enumerate(
        [(18, -62, "vista 3/4"), (6, -90, "de frente"), (6, 0, "de lado")]):
    ax = fig.add_subplot(1, 3, i + 1, projection="3d")
    for mesh, col, alp in ((arm, "#3d5a80", .95), (cra, "#ee6c4d", .95), (pho, "#111827", .35)):
        ax.add_collection3d(Poly3DCollection(
            mesh.vertices[mesh.faces], facecolor=col, edgecolor="none", alpha=alp))
    ax.set_xlim(-110, 110); ax.set_ylim(-110, 110); ax.set_zlim(0, 310)
    ax.set_box_aspect((1, 1, 1.45)); ax.view_init(elev=elev, azim=azim)
    ax.set_title(titulo, fontsize=10); ax.set_axis_off()
fig.suptitle("Suporte Fold 7 para porta-copos do Tesla Model 3 (pre-facelift)\n"
             "azul = base+braco   laranja = berco   cinza = Galaxy Z Fold 7 aberto",
             fontsize=10)
fig.tight_layout()
fig.savefig("previsualizacao.png", dpi=115, facecolor="white")
print("previsualizacao.png escrito")
