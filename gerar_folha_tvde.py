# -*- coding: utf-8 -*-
"""Gera a folha de calculo de controlo TVDE (Uber/Bolt) para Lisboa."""
from datetime import date, time

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.comments import Comment

OUT = "Controlo_TVDE_Lisboa.xlsx"

FONT = "Arial"
BLUE = "0000FF"       # inputs
BLACK = "000000"      # formulas
GREEN = "008000"      # links entre folhas
YELLOW = "FFFF00"     # celulas a preencher / pressupostos
HDR_FILL = PatternFill("solid", fgColor="1F3864")
SUB_FILL = PatternFill("solid", fgColor="D9E2F3")
IN_FILL = PatternFill("solid", fgColor="FFF2CC")
CALC_FILL = PatternFill("solid", fgColor="EDEDED")
TITLE_FILL = PatternFill("solid", fgColor="F2F2F2")

thin = Side(style="thin", color="BFBFBF")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)

EUR = '#,##0.00\\ "€"'
EUR0 = '#,##0\\ "€"'
PCT = '0.0%'
NUM1 = '#,##0.0'
NUM0 = '#,##0'

FIRST = 4          # primeira linha de dados (linha 3 = exemplo)
EXAMPLE = 3
LAST = 403         # ultima linha com formulas
REG = "'Registo Diário'"

wb = Workbook()

# ---------------------------------------------------------------- helpers
def style(ws, ref, *, font_color=BLACK, bold=False, size=10, fill=None,
          fmt=None, align=None, wrap=False, border=True, italic=False):
    cells = ws[ref] if ":" in ref else [[ws[ref]]]
    for row in cells:
        for c in row:
            c.font = Font(name=FONT, size=size, bold=bold, color=font_color, italic=italic)
            if fill is not None:
                c.fill = fill
            if fmt:
                c.number_format = fmt
            if align or wrap:
                c.alignment = Alignment(horizontal=align, vertical="center", wrap_text=wrap)
            if border:
                c.border = BORDER

def widths(ws, mapping):
    for col, w in mapping.items():
        ws.column_dimensions[col].width = w

# ================================================================ GUIA
guia = wb.active
guia.title = "Guia"
guia.sheet_view.showGridLines = False
widths(guia, {"A": 3, "B": 34, "C": 92})

GUIA_ROWS = [
    ("T", "Controlo TVDE — Lisboa", ""),
    ("S", "", "Folha de registo e análise de turnos. Preenche o separador «Registo Diário» ao fim de cada turno; os resumos calculam-se sozinhos."),
    ("B", "COMO USAR", ""),
    ("L", "1. Config", "Começa aqui. Define a comissão da plataforma, o custo por km e os teus custos fixos mensais. Sem isto, os líquidos saem errados."),
    ("L", "2. Registo Diário", "Uma linha por turno. Preenche só as colunas com fundo amarelo. As colunas cinzentas são fórmulas — não escrevas lá."),
    ("L", "3. Resumos", "Ao fim de 2-3 semanas os separadores de resumo mostram-te que blocos horários e que zonas rendem mais €/hora líquido. Trabalha esses; corta os outros."),
    ("L", "Regra de ouro", "O que interessa é o €/hora LÍQUIDO, não a faturação. Um turno de 200 € com 11 horas e 250 km rende menos que um de 120 € com 5 horas e 80 km."),
    ("B", "HORÁRIOS — PONTO DE PARTIDA", ""),
    ("L", "Sexta e sábado, 23h-04h", "O melhor bloco da semana. Surge alto, corridas curtas encadeadas, pouco trânsito. A madrugada de domingo (saída de sábado à noite) também é forte."),
    ("L", "Manhã cedo, 05h30-08h30", "Voos de partida + primeiro pico de escritórios, com trânsito ainda leve. Ótima relação €/hora e pouca concorrência."),
    ("L", "Pico da tarde, 17h30-20h30", "Muita procura, mas a 2ª Circular, o Eixo Norte-Sul e o Marquês destroem o €/hora. Prefere corridas curtas dentro da cidade a corridas longas presas no trânsito."),
    ("L", "Dias de chuva", "Sobe tudo. Chuva + hora de ponta a meio da semana é dos melhores momentos possíveis."),
    ("L", "Blocos fracos", "Segunda a quinta das 10h às 16h, e domingo à tarde. Se puderes, descansa aí."),
    ("B", "ZONAS — PONTO DE PARTIDA", ""),
    ("L", "Aeroporto", "A fila TVDE pode ser 30-60 min; só compensa se sair corrida longa. Melhor das 5h às 8h (partidas) e das 19h às 23h (chegadas tardias)."),
    ("L", "Cais do Sodré / Bairro Alto / Santos / Docas", "O núcleo da noite. Não entres no meio do caos: espera em ruas adjacentes (Ribeira das Naus, Boavista, Av. 24 de Julho) e deixa o cliente vir ter contigo."),
    ("L", "Parque das Nações", "Escritórios de manhã, Altice Arena em dias de espetáculo, hotéis. Fácil de circular, o que puxa o €/hora para cima."),
    ("L", "Saldanha / Avenidas Novas / Av. Liberdade", "Corporate na hora de ponta e hotéis. Corridas curtas e frequentes."),
    ("L", "Alcântara / LX Factory", "Escritórios de tecnologia de dia, restaurantes à noite."),
    ("L", "Baixa / Chiado / Alfama", "Turistas, mas ruas estreitas e zonas pedonais. Escolhe pontos de recolha onde consegues mesmo parar."),
    ("B", "OS DIAS QUE VALEM O MÊS", ""),
    ("L", "Web Summit (novembro)", "A melhor semana do ano, de longe. Parque das Nações e hotéis por toda a cidade."),
    ("L", "Jogos e concertos", "Estádio da Luz, Alvalade, Altice Arena, Campo Pequeno. Marca as datas no calendário e planeia a semana à volta delas."),
    ("L", "Festivais de verão", "NOS Alive (Algés), Rock in Rio (Parque Tejo) e afins."),
    ("L", "Cruzeiros", "Manhãs de desembarque no terminal de Santa Apolónia / Jardim do Tabaco."),
    ("B", "CUIDADOS", ""),
    ("L", "Corridas para fora", "Sintra, Cascais, Setúbal à hora de ponta: cuidado com o regresso vazio. 40 € com 50 min de volta a zero rende menos que três corridas urbanas."),
    ("L", "Multi-app", "Uber + Bolt + FREENOW em simultâneo reduz o tempo parado — desde que aceites com critério e não andes a cancelar."),
    ("L", "Portagens", "A 2ª Circular é grátis. Ponte 25 de Abril, Ponte Vasco da Gama e A5 não. Regista-as na coluna própria."),
    ("L", "Legal", "Precisas de certificado de motorista TVDE, veículo licenciado com dístico e estar coletado nas Finanças."),
    ("N", "", "Os horários e zonas acima são padrões gerais para orientar as primeiras semanas. Os teus próprios números, ao fim de 2-3 semanas de registo, valem mais do que qualquer regra geral — é para isso que serve esta folha."),
]

r = 1
for kind, label, text in GUIA_ROWS:
    if kind == "T":
        guia.cell(r, 2, label)
        style(guia, f"B{r}", bold=True, size=16, font_color="1F3864", border=False)
        r += 1
    elif kind == "S":
        guia.cell(r, 3, text)
        style(guia, f"C{r}", size=10, italic=True, font_color="595959", wrap=True, align="left", border=False)
        guia.row_dimensions[r].height = 28
        r += 2
    elif kind == "B":
        guia.cell(r, 2, label)
        style(guia, f"B{r}:C{r}", bold=True, size=11, font_color="FFFFFF", fill=HDR_FILL, border=False)
        r += 1
    elif kind == "N":
        guia.cell(r, 2, "Nota")
        guia.cell(r, 3, text)
        style(guia, f"B{r}", bold=True, size=10, italic=True, border=False)
        style(guia, f"C{r}", size=10, italic=True, wrap=True, align="left", border=False)
        guia.row_dimensions[r].height = 30
        r += 1
    else:
        guia.cell(r, 2, label)
        guia.cell(r, 3, text)
        style(guia, f"B{r}", bold=True, size=10, wrap=True, align="left", border=False)
        style(guia, f"C{r}", size=10, wrap=True, align="left", border=False)
        guia.row_dimensions[r].height = 26
        r += 1

# ================================================================ CONFIG
cfg = wb.create_sheet("Config")
cfg.sheet_view.showGridLines = False
widths(cfg, {"A": 38, "B": 14, "C": 58, "D": 24, "E": 32, "F": 14})

cfg["A1"] = "Config — pressupostos e custos"
style(cfg, "A1", bold=True, size=14, font_color="1F3864", border=False)
cfg["A2"] = "Preenche as células amarelas. Tudo o resto na folha depende destes valores."
style(cfg, "A2", size=10, italic=True, font_color="595959", border=False)

cfg["A4"] = "Custos variáveis"
style(cfg, "A4:C4", bold=True, size=11, font_color="FFFFFF", fill=HDR_FILL)

var_rows = [
    ("Comissão da plataforma (%)", 0.25, PCT,
     "Percentagem que a app retém sobre a faturação. Se a tua app já te mostra os ganhos JÁ líquidos de comissão, põe 0% aqui e regista esse valor na coluna Faturação."),
    ("Custo de energia por km (€/km)", 0.11, EUR,
     "Combustível ou eletricidade. Cálculo: preço do litro ÷ km por litro. Ex.: 1,75 €/L ÷ 16 km/L = 0,11 €/km. Elétrico em casa fica ~0,04 €/km."),
    ("Desgaste e manutenção por km (€/km)", 0.06, EUR,
     "Pneus, revisões, travões, óleo e depreciação do carro. 0,05-0,08 €/km é uma estimativa realista para um carro a fazer TVDE. Valor a ajustar quando tiveres histórico."),
]
r = 5
for label, val, fmt, note in var_rows:
    cfg.cell(r, 1, label)
    cfg.cell(r, 2, val)
    cfg.cell(r, 3, note)
    style(cfg, f"A{r}", size=10, align="left")
    style(cfg, f"B{r}", size=10, font_color=BLUE, bold=True, fill=IN_FILL, fmt=fmt, align="center")
    style(cfg, f"C{r}", size=9, italic=True, font_color="595959", wrap=True, align="left")
    cfg.row_dimensions[r].height = 30
    r += 1

cfg["A9"] = "Custos fixos mensais"
style(cfg, "A9:C9", bold=True, size=11, font_color="FFFFFF", fill=HDR_FILL)
cfg["C9"] = "Custos que pagas mesmo que não trabalhes. Entram no separador «Resumo Mensal»."
style(cfg, "C9", bold=True, size=9, font_color="FFFFFF", fill=HDR_FILL, wrap=True, align="left")

fix_rows = [
    ("Seguro TVDE", 90, "Seguro com cobertura de atividade TVDE (mais caro que um seguro particular)."),
    ("Aluguer ou prestação da viatura", 0, "Se o carro é teu e está pago, deixa a 0 — mas considera pôr aqui uma verba para o substituir."),
    ("Contabilidade", 60, "Contabilista certificado. Obrigatório se estiveres em contabilidade organizada."),
    ("Licenças e certificados (mensalizado)", 15, "Certificado de motorista TVDE e dístico do veículo: divide o custo anual por 12."),
    ("Telemóvel e dados", 20, "Plano de dados — precisas de rede estável o turno inteiro."),
    ("Inspeção, IUC e outros anuais (mensalizado)", 25, "Soma os custos anuais do carro e divide por 12."),
    ("Outros custos fixos", 0, "Parque, lavagens por avença, o que mais tiveres."),
]
r = 10
for label, val, note in fix_rows:
    cfg.cell(r, 1, label)
    cfg.cell(r, 2, val)
    cfg.cell(r, 3, note)
    style(cfg, f"A{r}", size=10, align="left")
    style(cfg, f"B{r}", size=10, font_color=BLUE, bold=True, fill=IN_FILL, fmt=EUR, align="center")
    style(cfg, f"C{r}", size=9, italic=True, font_color="595959", wrap=True, align="left")
    r += 1

cfg["A17"] = "TOTAL de custos fixos mensais"
cfg["B17"] = "=SUM(B10:B16)"
style(cfg, "A17", bold=True, size=10, fill=SUB_FILL, align="left")
style(cfg, "B17", bold=True, size=10, fill=SUB_FILL, fmt=EUR, align="center")

cfg["A19"] = "Primeiro mês de atividade"
cfg["B19"] = date(2026, 9, 1)
cfg["C19"] = "Define o primeiro mês listado no separador «Resumo Mensal». Ajusta se começares noutra data."
style(cfg, "A19", size=10, align="left")
style(cfg, "B19", size=10, font_color=BLUE, bold=True, fill=IN_FILL, fmt="mmm/yyyy", align="center")
style(cfg, "C19", size=9, italic=True, font_color="595959", wrap=True, align="left")

cfg["A21"] = "Legenda de cores"
style(cfg, "A21:C21", bold=True, size=11, font_color="FFFFFF", fill=HDR_FILL)
legend = [
    ("Azul sobre amarelo", BLUE, IN_FILL, "Célula que preenches tu."),
    ("Preto sobre cinzento", BLACK, CALC_FILL, "Fórmula. Não escrevas por cima — perdes o cálculo."),
    ("Verde", GREEN, None, "Valor que vem de outro separador."),
]
r = 22
for label, fc, fl, note in legend:
    cfg.cell(r, 1, label)
    cfg.cell(r, 3, note)
    style(cfg, f"A{r}", size=10, bold=True, font_color=fc, fill=fl, align="left")
    style(cfg, f"C{r}", size=9, italic=True, font_color="595959", align="left")
    r += 1

# listas para as validações
BLOCOS = [
    "Madrugada (00h-05h)", "Manhã cedo (05h-08h)", "Manhã (08h-12h)",
    "Almoço (12h-15h)", "Tarde (15h-17h)", "Pico tarde (17h-21h)",
    "Noite (21h-00h)", "Turno longo / misto",
]
ZONAS = [
    "Aeroporto", "Parque das Nações", "Baixa / Chiado",
    "Cais do Sodré / Bairro Alto", "Avenidas Novas / Saldanha",
    "Marquês / Av. Liberdade", "Alcântara / LX Factory", "Belém / Restelo",
    "Campo de Ourique / Estrela", "Benfica / Luz", "Alvalade / Areeiro",
    "Lumiar / Telheiras", "Oeiras / Algés", "Sintra / Cascais",
    "Margem Sul", "Cidade / misto",
]
DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]

cfg["D1"] = "Blocos horários"
cfg["E1"] = "Zonas"
cfg["F1"] = "Dias"
style(cfg, "D1:F1", bold=True, size=10, font_color="FFFFFF", fill=HDR_FILL, align="center")
for i, v in enumerate(BLOCOS):
    cfg.cell(2 + i, 4, v)
    style(cfg, f"D{2+i}", size=9, align="left")
for i, v in enumerate(ZONAS):
    cfg.cell(2 + i, 5, v)
    style(cfg, f"E{2+i}", size=9, align="left")
for i, v in enumerate(DIAS):
    cfg.cell(2 + i, 6, v)
    style(cfg, f"F{2+i}", size=9, align="left")

cfg["D19"] = "Podes editar ou acrescentar zonas nesta lista — as caixas de seleção do registo acompanham."
style(cfg, "D19:F19", size=9, italic=True, font_color="595959", wrap=True, align="left", border=False)
cfg.merge_cells("D19:F21")

# ================================================================ REGISTO DIÁRIO
reg = wb.create_sheet("Registo Diário", 1)
reg.sheet_view.showGridLines = False

COLS = [
    # (letra, cabeçalho, tipo, largura, formato)
    ("A", "Data", "in", 11, "dd/mm/yyyy"),
    ("B", "Dia", "calc", 10, None),
    ("C", "Mês", "calc", 10, "mmm/yyyy"),
    ("D", "Bloco horário", "in", 21, None),
    ("E", "Zona principal", "in", 26, None),
    ("F", "Início", "in", 8, "hh:mm"),
    ("G", "Fim", "in", 8, "hh:mm"),
    ("H", "Horas online", "calc", 10, NUM1),
    ("I", "Nº corridas", "in", 9, NUM0),
    ("J", "Faturação (€)", "in", 12, EUR),
    ("K", "Comissão (€)", "calc", 12, EUR),
    ("L", "Gorjetas (€)", "in", 11, EUR),
    ("M", "Km", "in", 8, NUM0),
    ("N", "Energia (€)", "calc", 11, EUR),
    ("O", "Desgaste (€)", "calc", 11, EUR),
    ("P", "Portagens (€)", "in", 11, EUR),
    ("Q", "Outros (€)", "in", 10, EUR),
    ("R", "LÍQUIDO (€)", "calc", 13, EUR),
    ("S", "€/hora", "calc", 10, EUR),
    ("T", "€/km", "calc", 9, EUR),
    ("U", "Corridas/h", "calc", 10, NUM1),
    ("V", "Notas", "in", 34, None),
]

reg["A1"] = ("REGISTO DIÁRIO  —  preenche só as colunas de cabeçalho AMARELO, uma linha por turno.  "
             "As colunas de cabeçalho CINZENTO são fórmulas: não escrevas nelas.  "
             "A linha 3 é um exemplo — apaga-a quando começares.")
reg.merge_cells("A1:V1")
style(reg, "A1", size=10, bold=True, font_color="1F3864", fill=TITLE_FILL, wrap=True, align="left", border=False)
reg.row_dimensions[1].height = 30

for letter, header, kind, w, fmt in COLS:
    reg.column_dimensions[letter].width = w
    c = reg[f"{letter}2"]
    c.value = header
    c.font = Font(name=FONT, size=9, bold=True, color="FFFFFF")
    c.fill = HDR_FILL if kind == "in" else PatternFill("solid", fgColor="7F7F7F")
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = BORDER
reg.row_dimensions[2].height = 30

# marcador visual: cabeçalhos de input com barra amarela por baixo (via fill das celulas)
notes = {
    "J": "Valor total das corridas ANTES da comissão da plataforma. Se a app já te mostra o valor líquido de comissão, põe a comissão a 0% na Config e regista aqui esse valor.",
    "L": "Gorjetas não pagam comissão, por isso entram à parte.",
    "M": "Km TOTAIS do turno, incluindo os que fazes vazio à procura de corrida. É esse o custo real.",
    "P": "Só as portagens que pagaste do teu bolso e não foram reembolsadas na corrida.",
    "Q": "Lavagens, estacionamento, parque do aeroporto, café. Tudo o que gastaste por causa do turno.",
    "H": "Horas com a app ligada. Se o turno passar da meia-noite, a fórmula trata disso sozinha.",
}
for col, txt in notes.items():
    reg[f"{col}2"].comment = Comment(txt, "Controlo TVDE", width=320, height=110)

FORMULAS = {
    "B": '=IF($A{r}="","",INDEX(Config!$F$2:$F$8,WEEKDAY($A{r},2)))',
    "C": '=IF($A{r}="","",EOMONTH($A{r},0))',
    "H": '=IF(OR($F{r}="",$G{r}=""),"",($G{r}-$F{r}+IF($G{r}<$F{r},1,0))*24)',
    "K": '=IF($J{r}="","",$J{r}*Config!$B$5)',
    "N": '=IF($M{r}="","",$M{r}*Config!$B$6)',
    "O": '=IF($M{r}="","",$M{r}*Config!$B$7)',
    "R": '=IF($J{r}="","",$J{r}-$K{r}+SUM($L{r})-SUM($N{r}:$Q{r}))',
    "S": '=IF(OR($R{r}="",$H{r}="",$H{r}=0),"",$R{r}/$H{r})',
    "T": '=IF(OR($R{r}="",$M{r}="",$M{r}=0),"",$R{r}/$M{r})',
    "U": '=IF(OR($H{r}="",$H{r}=0,$I{r}=""),"",$I{r}/$H{r})',
}

for row in range(EXAMPLE, LAST + 1):
    for letter, header, kind, w, fmt in COLS:
        c = reg[f"{letter}{row}"]
        if kind == "calc":
            c.value = FORMULAS[letter].format(r=row)
            c.font = Font(name=FONT, size=10, color=BLACK,
                          bold=(letter in ("R", "S")))
            c.fill = CALC_FILL
        else:
            c.font = Font(name=FONT, size=10, color=BLUE)
            c.fill = IN_FILL
        if fmt:
            c.number_format = fmt
        c.alignment = Alignment(horizontal="left" if letter in ("D", "E", "V") else "center",
                                vertical="center")
        c.border = BORDER

# linha de exemplo
example = {"A": date(2026, 9, 5), "D": "Noite (21h-00h)", "E": "Cais do Sodré / Bairro Alto",
           "F": time(21, 30), "G": time(4, 0), "I": 14, "J": 168.40, "L": 6.50,
           "M": 122, "P": 3.20, "Q": 2.00, "V": "EXEMPLO — apaga esta linha. Muito movimento depois das 2h."}
for k, v in example.items():
    reg[f"{k}{EXAMPLE}"] = v
style(reg, f"A{EXAMPLE}:V{EXAMPLE}", size=10, italic=True)
for letter, header, kind, w, fmt in COLS:
    c = reg[f"{letter}{EXAMPLE}"]
    c.font = Font(name=FONT, size=10, italic=True,
                  color=BLACK if kind == "calc" else BLUE,
                  bold=(letter in ("R", "S")))
    c.fill = CALC_FILL if kind == "calc" else IN_FILL
    if fmt:
        c.number_format = fmt
    c.alignment = Alignment(horizontal="left" if letter in ("D", "E", "V") else "center",
                            vertical="center")

# validações
dv_bloco = DataValidation(type="list", formula1="=Config!$D$2:$D$9", allow_blank=True)
dv_zona = DataValidation(type="list", formula1="=Config!$E$2:$E$17", allow_blank=True)
reg.add_data_validation(dv_bloco)
reg.add_data_validation(dv_zona)
dv_bloco.add(f"D{EXAMPLE}:D{LAST}")
dv_zona.add(f"E{EXAMPLE}:E{LAST}")

# escala de cor no €/hora
reg.conditional_formatting.add(
    f"S{EXAMPLE}:S{LAST}",
    ColorScaleRule(start_type="percentile", start_value=10, start_color="F8696B",
                   mid_type="percentile", mid_value=50, mid_color="FFEB84",
                   end_type="percentile", end_value=90, end_color="63BE7B"))

reg.freeze_panes = "F3"
reg.auto_filter.ref = f"A2:V{LAST}"

# ================================================================ RESUMO TEMPO
def summary_sheet(name, items, key_col, title, subtitle, pos):
    ws = wb.create_sheet(name, pos)
    ws.sheet_view.showGridLines = False
    widths(ws, {"A": 28, "B": 11, "C": 12, "D": 14, "E": 13, "F": 12, "G": 11, "H": 12, "I": 12})
    ws["A1"] = title
    style(ws, "A1", bold=True, size=14, font_color="1F3864", border=False)
    ws["A2"] = subtitle
    style(ws, "A2", size=10, italic=True, font_color="595959", border=False)

    heads = ["", "Turnos", "Horas", "Faturação (€)", "Líquido (€)",
             "€/HORA", "€/km", "Corridas/h", "Km"]
    for i, h in enumerate(heads, start=1):
        ws.cell(4, i, h)
    style(ws, "A4:I4", bold=True, size=9, font_color="FFFFFF", fill=HDR_FILL, align="center", wrap=True)
    ws.row_dimensions[4].height = 26

    r = 5
    for item in items:
        ws.cell(r, 1, item)
        ws.cell(r, 2, f'=COUNTIFS({REG}!${key_col}${EXAMPLE}:${key_col}${LAST},$A{r})')
        ws.cell(r, 3, f'=SUMIFS({REG}!$H${EXAMPLE}:$H${LAST},{REG}!${key_col}${EXAMPLE}:${key_col}${LAST},$A{r})')
        ws.cell(r, 4, f'=SUMIFS({REG}!$J${EXAMPLE}:$J${LAST},{REG}!${key_col}${EXAMPLE}:${key_col}${LAST},$A{r})')
        ws.cell(r, 5, f'=SUMIFS({REG}!$R${EXAMPLE}:$R${LAST},{REG}!${key_col}${EXAMPLE}:${key_col}${LAST},$A{r})')
        ws.cell(r, 6, f'=IF($C{r}=0,"",$E{r}/$C{r})')
        ws.cell(r, 7, f'=IF($I{r}=0,"",$E{r}/$I{r})')
        ws.cell(r, 8, f'=IF($C{r}=0,"",SUMIFS({REG}!$I${EXAMPLE}:$I${LAST},{REG}!${key_col}${EXAMPLE}:${key_col}${LAST},$A{r})/$C{r})')
        ws.cell(r, 9, f'=SUMIFS({REG}!$M${EXAMPLE}:$M${LAST},{REG}!${key_col}${EXAMPLE}:${key_col}${LAST},$A{r})')
        style(ws, f"A{r}", size=10, align="left")
        style(ws, f"B{r}", size=10, fmt=NUM0, align="center")
        style(ws, f"C{r}", size=10, fmt=NUM1, align="center")
        style(ws, f"D{r}", size=10, fmt=EUR, align="center")
        style(ws, f"E{r}", size=10, fmt=EUR, align="center")
        style(ws, f"F{r}", size=10, fmt=EUR, align="center", bold=True)
        style(ws, f"G{r}", size=10, fmt=EUR, align="center")
        style(ws, f"H{r}", size=10, fmt=NUM1, align="center")
        style(ws, f"I{r}", size=10, fmt=NUM0, align="center")
        r += 1

    tot = r
    ws.cell(tot, 1, "TOTAL")
    for col in ("B", "C", "D", "E", "I"):
        ws.cell(tot, {"B": 2, "C": 3, "D": 4, "E": 5, "I": 9}[col],
                f"=SUM({col}5:{col}{tot-1})")
    ws.cell(tot, 6, f'=IF($C{tot}=0,"",$E{tot}/$C{tot})')
    ws.cell(tot, 7, f'=IF($I{tot}=0,"",$E{tot}/$I{tot})')
    ws.cell(tot, 8, f'=IF($C{tot}=0,"",SUMPRODUCT($H5:$H{tot-1},$C5:$C{tot-1})/$C{tot})')
    style(ws, f"A{tot}:I{tot}", bold=True, size=10, fill=SUB_FILL, align="center")
    style(ws, f"A{tot}", bold=True, size=10, fill=SUB_FILL, align="left")
    for col, fmt in (("B", NUM0), ("C", NUM1), ("D", EUR), ("E", EUR),
                     ("F", EUR), ("G", EUR), ("H", NUM1), ("I", NUM0)):
        ws[f"{col}{tot}"].number_format = fmt

    ws.conditional_formatting.add(
        f"F5:F{tot-1}",
        ColorScaleRule(start_type="min", start_color="F8696B",
                       mid_type="percentile", mid_value=50, mid_color="FFEB84",
                       end_type="max", end_color="63BE7B"))
    return ws, tot

ws_bloco, tot_b = summary_sheet(
    "Resumo Blocos", BLOCOS, "D",
    "Resumo por bloco horário",
    "Ordena mentalmente pela coluna €/HORA. O verde é onde deves trabalhar; o vermelho é onde estás a perder tempo.", 2)

ws_zona, tot_z = summary_sheet(
    "Resumo Zonas", ZONAS, "E",
    "Resumo por zona",
    "Zona onde passaste a maior parte do turno. Compara o €/hora e o €/km: uma zona com bom €/hora mas mau €/km está a queimar-te o carro.", 3)

ws_dia, tot_d = summary_sheet(
    "Resumo Dias", DIAS, "B",
    "Resumo por dia da semana",
    "Ao fim de um mês vês quais os dias que compensam mesmo. Descansar num dia mau vale mais do que trabalhá-lo.", 4)

# ================================================================ RESUMO MENSAL
mes = wb.create_sheet("Resumo Mensal", 5)
mes.sheet_view.showGridLines = False
widths(mes, {"A": 14, "B": 10, "C": 11, "D": 15, "E": 15, "F": 16, "G": 16,
             "H": 16, "I": 15, "J": 13})

mes["A1"] = "Resumo mensal — o que sobra mesmo"
style(mes, "A1", bold=True, size=14, font_color="1F3864", border=False)
mes["A2"] = ("O «Líquido dos turnos» já desconta comissão, energia, desgaste, portagens e extras. "
             "Falta abater os custos fixos do mês (Config) para chegar ao RESULTADO — é esse o teu rendimento antes de impostos.")
mes.merge_cells("A2:J2")
style(mes, "A2", size=10, italic=True, font_color="595959", wrap=True, align="left", border=False)
mes.row_dimensions[2].height = 28

heads = ["Mês", "Turnos", "Horas", "Faturação (€)", "Líquido dos turnos (€)",
         "Custos fixos (€)", "RESULTADO (€)", "€/hora final", "Km", "Corridas"]
for i, h in enumerate(heads, start=1):
    mes.cell(4, i, h)
style(mes, "A4:J4", bold=True, size=9, font_color="FFFFFF", fill=HDR_FILL, align="center", wrap=True)
mes.row_dimensions[4].height = 30

MONTHS = 18
r = 5
for i in range(MONTHS):
    if i == 0:
        mes.cell(r, 1, "=EOMONTH(Config!$B$19,0)")
    else:
        mes.cell(r, 1, f"=EOMONTH(A{r-1},1)")
    mes.cell(r, 2, f'=COUNTIFS({REG}!$C${EXAMPLE}:$C${LAST},$A{r})')
    mes.cell(r, 3, f'=SUMIFS({REG}!$H${EXAMPLE}:$H${LAST},{REG}!$C${EXAMPLE}:$C${LAST},$A{r})')
    mes.cell(r, 4, f'=SUMIFS({REG}!$J${EXAMPLE}:$J${LAST},{REG}!$C${EXAMPLE}:$C${LAST},$A{r})')
    mes.cell(r, 5, f'=SUMIFS({REG}!$R${EXAMPLE}:$R${LAST},{REG}!$C${EXAMPLE}:$C${LAST},$A{r})')
    mes.cell(r, 6, f'=IF($B{r}=0,0,Config!$B$17)')
    mes.cell(r, 7, f'=$E{r}-$F{r}')
    mes.cell(r, 8, f'=IF($C{r}=0,"",$G{r}/$C{r})')
    mes.cell(r, 9, f'=SUMIFS({REG}!$M${EXAMPLE}:$M${LAST},{REG}!$C${EXAMPLE}:$C${LAST},$A{r})')
    mes.cell(r, 10, f'=SUMIFS({REG}!$I${EXAMPLE}:$I${LAST},{REG}!$C${EXAMPLE}:$C${LAST},$A{r})')
    style(ws=mes, ref=f"A{r}", size=10, fmt="mmm/yyyy", align="center")
    style(mes, f"B{r}", size=10, fmt=NUM0, align="center")
    style(mes, f"C{r}", size=10, fmt=NUM1, align="center")
    style(mes, f"D{r}", size=10, fmt=EUR, align="center")
    style(mes, f"E{r}", size=10, fmt=EUR, align="center")
    style(mes, f"F{r}", size=10, fmt=EUR, align="center", font_color=GREEN)
    style(mes, f"G{r}", size=10, fmt=EUR, align="center", bold=True)
    style(mes, f"H{r}", size=10, fmt=EUR, align="center", bold=True)
    style(mes, f"I{r}", size=10, fmt=NUM0, align="center")
    style(mes, f"J{r}", size=10, fmt=NUM0, align="center")
    r += 1

tot = r
mes.cell(tot, 1, "TOTAL")
for idx, col in ((2, "B"), (3, "C"), (4, "D"), (5, "E"), (6, "F"), (7, "G"), (9, "I"), (10, "J")):
    mes.cell(tot, idx, f"=SUM({col}5:{col}{tot-1})")
mes.cell(tot, 8, f'=IF($C{tot}=0,"",$G{tot}/$C{tot})')
style(mes, f"A{tot}:J{tot}", bold=True, size=10, fill=SUB_FILL, align="center")
style(mes, f"A{tot}", bold=True, size=10, fill=SUB_FILL, align="left")
for col, fmt in (("B", NUM0), ("C", NUM1), ("D", EUR), ("E", EUR), ("F", EUR),
                 ("G", EUR), ("H", EUR), ("I", NUM0), ("J", NUM0)):
    mes[f"{col}{tot}"].number_format = fmt

nr = tot + 2
mes.cell(nr, 1, "Nota")
mes.cell(nr, 2, ("Os custos fixos só são debitados nos meses em que registaste turnos. "
                 "O RESULTADO é antes de IRS e Segurança Social — reserva uma parte para isso. "
                 "Se o «€/hora final» ficar abaixo do que ganharias noutro trabalho, os números estão a dizer-te alguma coisa."))
mes.merge_cells(f"B{nr}:J{nr}")
style(mes, f"A{nr}", bold=True, size=9, italic=True, border=False)
style(mes, f"B{nr}", size=9, italic=True, font_color="595959", wrap=True, align="left", border=False)
mes.row_dimensions[nr].height = 30

mes.freeze_panes = "B5"

wb.active = 0
wb.save(OUT)
print("gravado:", OUT)
