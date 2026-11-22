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
    'esp_pcb': (0.10, 0.13, 0.15), 'esp_baixo': (0.62, 0.64, 0.66), 'esp_reguas': (0.18, 0.18, 0.20),
    'esp_usb': (0.45, 0.47, 0.50),
    'sen_pcb': (0.12, 0.25, 0.55), 'sen_cima': (0.20, 0.20, 0.22),
}
CORES_FIO = {'vermelho': (0.85, 0.10, 0.10), 'preto': (0.07, 0.07, 0.07), 'castanho': (0.50, 0.30, 0.12),
             'laranja': (0.98, 0.52, 0.05)}


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
    """Os quatro fios do sensor, com uma ficha em cada ponta, nas cores que o Ivo usou."""
    with open(os.path.join(pasta, 'fios.json'), encoding='utf-8') as f:
        lista = json.load(f)
    atores = []
    for fio in lista:
        atores.append(tubo(fio['pontos'], 0.65, CORES_FIO[fio['cor']]))
        for limites in fio['fichas']:
            cubo = vtk.vtkCubeSource()
            cubo.SetBounds(*limites)
            atores.append(pinta(cubo, (0.16, 0.16, 0.18)))
    # o cabo USB: sai da ficha, passa pelo berço e segue para fora da caixa
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
    placas = ['esp_pcb', 'esp_baixo', 'esp_reguas', 'esp_usb', 'sen_pcb', 'sen_cima']

    def conjunto():
        return [ator(pecas, n) for n in ['base'] + placas] + fios(pecas)

    # 1. o conjunto montado
    imagem(os.path.join(saida, 'caixa1-conjunto.png'), conjunto(), olho=(45, -300, 205), alvo=(140, 2, 6), altura=800)
    # 2. só a base, como sai da impressora
    imagem(os.path.join(saida, 'caixa1-base.png'), [ator(pecas, 'base')], olho=(45, -300, 205), alvo=(140, 2, 6), altura=800)
    # 3. a ponta do ESP32, de perto, vista do lado do USB
    imagem(os.path.join(saida, 'caixa1-esp32.png'), conjunto(), olho=(318, -112, 82), alvo=(208, 0, 10), angulo=26)
    # 4. as torres do ESP32 sem a placa: os espigões, os quartos de anel e os batentes
    imagem(os.path.join(saida, 'caixa1-torres.png'), [ator(pecas, 'base')], olho=(262, -88, 58), alvo=(202, 0, 5), angulo=26)
    # 5. a ponta do sensor, de perto
    imagem(os.path.join(saida, 'caixa1-sensor.png'), conjunto(), olho=(-22, -62, 56), alvo=(30, 0, 7), angulo=26)
    # 6. como se monta: as placas levantadas por cima dos espigões
    explodido = [ator(pecas, 'base')] + [ator(pecas, n, (0, 0, 16)) for n in placas if n != 'esp_usb']
    imagem(os.path.join(saida, 'caixa1-montagem.png'), explodido, olho=(35, -320, 200), alvo=(140, 2, 14), altura=860)
    # 7. a peça de ensaio
    imagem(os.path.join(saida, 'caixa1-ensaio.png'), [ator(pecas, 'ensaio')], olho=(10, -95, 80), alvo=(48, 17, 3), angulo=26, altura=900)


if __name__ == '__main__':
    main()
