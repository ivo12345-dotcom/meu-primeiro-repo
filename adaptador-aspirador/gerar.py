"""Gera o adaptador do aspirador (STL + desenho SVG). Só usa Python padrão.
Edita os parâmetros abaixo e corre: python3 gerar.py"""
import math, struct

# ---- Parâmetros (mm) ----
D_BOCA   = 35.8   # diâmetro interior na boca (parte mais larga)
D_FUNDO  = 34.6   # diâmetro interior no fundo do encaixe
PAREDE   = 2.5    # espessura da parede
L_ENC    = 40.0   # comprimento do encaixe cónico
T_TAMPA  = 3.0    # espessura do fundo (ponta quase fechada)
D_MANG   = 10.0   # furo para a mangueira de 10 mm
PAREDE_C = 2.0    # parede do colarinho da mangueira
L_COLAR  = 12.0   # comprimento do colarinho
SEG      = 160    # resolução

R1, R0, RO = D_BOCA/2, D_FUNDO/2, D_BOCA/2 + PAREDE
rh, rc = D_MANG/2, D_MANG/2 + PAREDE_C
zt, zc = L_ENC + T_TAMPA, L_ENC + T_TAMPA + L_COLAR
perfil = [(R1,0),(RO,0),(RO,zt),(rc,zt),(rc,zc),(rh,zc),(rh,L_ENC),(R0,L_ENC)]

def stl(nome):
    tris = []
    n = len(perfil)
    for i in range(n):
        (ra,za),(rb,zb) = perfil[i], perfil[(i+1)%n]
        for k in range(SEG):
            a0, a1 = 2*math.pi*k/SEG, 2*math.pi*(k+1)/SEG
            P = lambda r,z,a: (r*math.cos(a), r*math.sin(a), z)
            p00,p01,p10,p11 = P(ra,za,a0),P(ra,za,a1),P(rb,zb,a0),P(rb,zb,a1)
            tris += [(p00,p10,p11),(p00,p11,p01)]
    vol = sum(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]) for a,b,c in tris)/6
    if vol < 0: tris = [(a,c,b) for a,b,c in tris]
    with open(nome,'wb') as f:
        f.write(b'adaptador aspirador'.ljust(80,b' ')); f.write(struct.pack('<I',len(tris)))
        for a,b,c in tris:
            u=[b[i]-a[i] for i in range(3)]; v=[c[i]-a[i] for i in range(3)]
            nx,ny,nz=u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]
            m=math.sqrt(nx*nx+ny*ny+nz*nz) or 1
            f.write(struct.pack('<12fH',nx/m,ny/m,nz/m,*a,*b,*c,0))
    return abs(vol)

def svg(nome):
    s, ox, oy = 6, 260, 40          # escala px/mm, eixo, topo
    X = lambda r: ox + r*s
    Y = lambda z: oy + z*s
    meia = lambda sg: " ".join(f"{X(sg*r):.1f},{Y(z):.1f}" for r,z in perfil)
    W, H = 2*ox, Y(zc)+120
    t = []
    a = t.append
    a(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}" viewBox="0 0 {W:.0f} {H:.0f}" font-family="sans-serif" font-size="13">')
    a('<rect width="100%" height="100%" fill="white"/><defs><pattern id="h" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#555" stroke-width="1.2"/></pattern>'
      '<marker id="m" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse"><path d="M0,1 L8,4 L0,7z" fill="#c00"/></marker></defs>')
    for sg in (1,-1): a(f'<polygon points="{meia(sg)}" fill="url(#h)" stroke="black" stroke-width="2"/>')
    a(f'<line x1="{ox}" y1="{oy-20}" x2="{ox}" y2="{Y(zc)+20}" stroke="#888" stroke-dasharray="10,4,2,4"/>')
    def cota(x1,y1,x2,y2,txt,tx,ty):
        a(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#c00" marker-start="url(#m)" marker-end="url(#m)"/>')
        a(f'<text x="{tx:.1f}" y="{ty:.1f}" fill="#c00" text-anchor="middle">{txt}</text>')
    cota(X(-R1),Y(4),X(R1),Y(4),f"Ø{D_BOCA} interior (boca)",ox,Y(4)-6)
    cota(X(-R0),Y(L_ENC-4),X(R0),Y(L_ENC-4),f"Ø{D_FUNDO} interior (fundo)",ox,Y(L_ENC-4)-6)
    cota(X(-rh),Y(zc+8),X(rh),Y(zc+8),f"Ø{D_MANG} mangueira",ox,Y(zc+8)+20)
    cota(X(-RO),Y(-3),X(RO),Y(-3),f"Ø{2*RO:.1f} exterior",ox,Y(-3)-8)
    cota(X(RO)+25,Y(0),X(RO)+25,Y(L_ENC),f"{L_ENC:g}",X(RO)+45,Y(L_ENC/2))
    cota(X(RO)+60,Y(0),X(RO)+60,Y(zc),f"{zc:g} total",X(RO)+60,Y(zc)+18)
    a(f'<text x="12" y="{H-12:.0f}" fill="#333">Corte — medidas em mm · parede {PAREDE} · fundo {T_TAMPA}</text></svg>')
    open(nome,'w').write("\n".join(t))

v = stl("adaptador_aspirador.stl"); svg("desenho.svg")
print(f"OK — volume {v/1000:.1f} cm³, altura total {zc} mm")
