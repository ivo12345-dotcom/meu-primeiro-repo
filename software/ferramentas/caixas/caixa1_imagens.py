# Tira as imagens da caixa 1 a partir das peças soltas que o caixa1_base.py escreve.
#
#   python caixa1_imagens.py <pasta das peças soltas> <pasta de saída>
#
# Precisa do vtk. As placas e as fichas aparecem só para se ver o conjunto; não se imprimem.
import json
import math
import os
import sys

import vtk

sys.stdout.reconfigure(encoding='utf-8')

CORES = {
    'base': (0.80, 0.82, 0.85), 'ensaio': (0.80, 0.82, 0.85),
    'estacas': (0.95, 0.52, 0.10), 'estaca_esp': (0.95, 0.52, 0.10), 'estaca_sen': (0.95, 0.52, 0.10),
    'esp_pcb': (0.10, 0.13, 0.15), 'esp_cima': (0.62, 0.64, 0.66), 'esp_reguas': (0.18, 0.18, 0.20),
    'esp_fichas': (0.25, 0.25, 0.28), 'esp_usb': (0.45, 0.47, 0.50),
    'sen_pcb': (0.12, 0.25, 0.55), 'sen_cima': (0.20, 0.20, 0.22),
}
CORES_FIO = {'vermelho': (0.85, 0.10, 0.10), 'preto': (0.07, 0.07, 0.07), 'azul': (0.10, 0.32, 0.90),
             'amarelo': (0.96, 0.80, 0.08)}


def ator(pasta, nome, desloca=(0, 0, 0), opacidade=1.0):
    leitor = vtk.vtkSTLReader()
    leitor.SetFileName(os.path.join(pasta, nome + '.stl'))
    normais = vtk.vtkPolyDataNormals()
    normais.SetInputConnection(leitor.GetOutputPort())
    normais.SetFeatureAngle(35)
    normais.SplittingOn()
    m = vtk.vtkPolyDataMapper()
    m.SetInputConnection(normais.GetOutputPort())
    a = vtk.vtkActor()
    a.SetMapper(m)
    p = a.GetProperty()
    p.SetColor(*CORES[nome])
    p.SetOpacity(opacidade)
    p.SetAmbient(0.25)
    p.SetDiffuse(0.75)
    p.SetSpecular(0.10)
    p.SetSpecularPower(20)
    a.SetPosition(*desloca)
    return a


def pinta(fonte, cor):
    m = vtk.vtkPolyDataMapper()
    m.SetInputConnection(fonte.GetOutputPort())
    a = vtk.vtkActor()
    a.SetMapper(m)
    a.GetProperty().SetColor(*cor)
    a.GetProperty().SetAmbient(0.25)
    a.GetProperty().SetDiffuse(0.75)
    return a


def tubo(caminho, raio, cor):
    """Um fio ou cabo: uma curva suave pelos pontos dados (com pontos a meio, para não fugir do caminho)."""
    pontos = vtk.vtkPoints()
    for a, b in zip(caminho, caminho[1:]):
        n = max(1, int(math.dist(a, b) / 4.0))
        for k in range(n):
            pontos.InsertNextPoint(*[a[i] + (b[i] - a[i]) * k / n for i in range(3)])
    pontos.InsertNextPoint(*caminho[-1])
    curva = vtk.vtkParametricSpline()
    curva.SetPoints(pontos)
    fonte = vtk.vtkParametricFunctionSource()
    fonte.SetParametricFunction(curva)
    fonte.SetUResolution(400)
    t = vtk.vtkTubeFilter()
    t.SetInputConnection(fonte.GetOutputPort())
    t.SetRadius(raio)
    t.SetNumberOfSides(16)
    t.CappingOn()
    return pinta(t, cor)


def fios(pasta):
    """Os quatro fios do cabo do sensor e as suas fichas, nas cores do cabo."""
    with open(os.path.join(pasta, 'fios.json'), encoding='utf-8') as f:
        lista = json.load(f)
    atores = []
    for fio in lista:
        atores.append(tubo(fio['pontos'], 0.65, CORES_FIO[fio['cor']]))
        cubo = vtk.vtkCubeSource()
        cubo.SetBounds(*fio['ficha'])
        atores.append(pinta(cubo, (0.16, 0.16, 0.18)))
    # o cabo USB: sai da ficha, passa por cima do apoio e segue para fora da caixa
    usb = lista[0]['usb']
    atores.append(tubo(usb, 2.2, (0.30, 0.31, 0.33)))
    return atores


def imagem(ficheiro, atores, olho, alvo, largura=1600, altura=1000, angulo=24.0, cima=(0, 0, 1)):
    ren = vtk.vtkRenderer()
    ren.SetBackground(1, 1, 1)
    for a in atores:
        ren.AddActor(a)
    luzes = vtk.vtkLightKit()
    luzes.SetKeyLightIntensity(0.95)
    luzes.SetKeyToFillRatio(2.2)
    luzes.SetKeyToHeadRatio(4.0)
    luzes.AddLightsToRenderer(ren)
    janela = vtk.vtkRenderWindow()
    janela.SetOffScreenRendering(1)
    janela.SetMultiSamples(8)
    janela.SetSize(largura, altura)
    janela.AddRenderer(ren)
    # sombra suave nos cantos, para se perceber o relevo
    passos = vtk.vtkRenderStepsPass()
    sombra = vtk.vtkSSAOPass()
    sombra.SetRadius(6.0)
    sombra.SetBias(0.2)
    sombra.SetKernelSize(96)
    sombra.BlurOn()
    sombra.SetDelegatePass(passos)
    ren.SetPass(sombra)
    cam = ren.GetActiveCamera()
    cam.SetPosition(*olho)
    cam.SetFocalPoint(*alvo)
    cam.SetViewUp(*cima)
    cam.SetViewAngle(angulo)
    ren.ResetCameraClippingRange()
    janela.Render()
    filtro = vtk.vtkWindowToImageFilter()
    filtro.SetInput(janela)
    filtro.Update()
    escritor = vtk.vtkPNGWriter()
    escritor.SetFileName(ficheiro)
    escritor.SetInputConnection(filtro.GetOutputPort())
    escritor.Write()
    print('escrita', ficheiro)


def main():
    pecas, saida = sys.argv[1], sys.argv[2]
    os.makedirs(saida, exist_ok=True)
    placas = ['esp_pcb', 'esp_cima', 'esp_reguas', 'esp_usb', 'sen_pcb', 'sen_cima']

    def conjunto():
        return [ator(pecas, n) for n in ['base', 'estacas'] + placas] + fios(pecas)

    # 1. o conjunto montado
    imagem(os.path.join(saida, 'caixa1-conjunto.png'), conjunto(), olho=(40, -270, 185), alvo=(125, 2, 6), altura=800)
    # 2. só a base, como sai da impressora
    imagem(os.path.join(saida, 'caixa1-base.png'), [ator(pecas, 'base')], olho=(40, -270, 185), alvo=(125, 2, 6), altura=800)
    # 3. a ponta do ESP32, de perto, vista do lado do USB
    imagem(os.path.join(saida, 'caixa1-esp32.png'), conjunto(), olho=(292, -118, 92), alvo=(178, 0, 15), angulo=26)
    # 4. o ESP32 visto de baixo e de lado: os fios encaixam por baixo e passam pelo túnel
    imagem(os.path.join(saida, 'caixa1-fios.png'), conjunto(), olho=(108, -112, 30), alvo=(168, 4, 14), angulo=26)
    # 5. a ponta do sensor, de perto
    imagem(os.path.join(saida, 'caixa1-sensor.png'), conjunto(), olho=(-22, -62, 56), alvo=(30, 0, 7), angulo=26)
    # 6. como se monta: placas e estacas levantadas
    explodido = [ator(pecas, 'base')] + [ator(pecas, n, (0, 0, 14)) for n in placas if n != 'esp_usb'] + [ator(pecas, 'estacas', (0, 0, 30))]
    imagem(os.path.join(saida, 'caixa1-montagem.png'), explodido, olho=(30, -290, 180), alvo=(125, 2, 18), altura=860)
    # 7. a peça de ensaio com as suas estacas
    imagem(os.path.join(saida, 'caixa1-ensaio.png'), [ator(pecas, 'ensaio')], olho=(20, -105, 95), alvo=(44, 24, 2), angulo=26, altura=900)


if __name__ == '__main__':
    main()
