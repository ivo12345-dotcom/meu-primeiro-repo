// =====================================================================
//  Cartucho multi-BB para revólver de airsoft a CO2  (paramétrico)
// ---------------------------------------------------------------------
//  Leva N BBs de 6 mm em fila dentro do cartucho. Ao disparar, o gás
//  empurra a BB de trás, que empurra as da frente: saem todas seguidas
//  pelo cano (o cano é de 6 mm, por isso não cabem lado a lado).
//
//  >>> AS MEDIDAS POR DEFEITO SÃO EXEMPLOS. MEDE UM CARTUCHO ORIGINAL
//  >>> DO TEU REVÓLVER COM UM PAQUÍMETRO E SUBSTITUI OS VALORES.
//
//  Abrir no OpenSCAD -> F6 (render) -> F7 (exportar STL).
//  Todas as medidas em milímetros.
// =====================================================================

/* [Cartucho (mede o original)] */
comprimento_total  = 30.0;  // da base do aro até à ponta
diametro_corpo     = 9.0;   // diâmetro exterior do corpo
diametro_aro       = 10.5;  // diâmetro do aro (rim) na base
espessura_aro      = 1.2;   // espessura do aro
chanfro_ponta      = 0.5;   // chanfro exterior na ponta (ajuda a entrar no tambor)

/* [Entrada de gás (mede o original)] */
diametro_canal_gas = 2.5;   // furo central por onde entra o CO2
// Rebaixo traseiro para um O-ring de vedação (0 = sem rebaixo)
diametro_rebaixo   = 0;     // ex.: 5.0
profundidade_rebaixo = 0;   // ex.: 1.0

/* [BBs] */
numero_bbs         = 3;     // quantas BBs por cartucho
diametro_bb        = 5.95;  // BBs de 6 mm medem normalmente 5.93-5.97
folga_camara       = 0.10;  // folga diametral da câmara (resina: 0.05-0.10, FDM: 0.15-0.25)
folga_comprimento  = 0.30;  // folga extra no comprimento da fila de BBs

/* [Retenção das BBs na ponta] */
diametro_labio     = 5.70;  // diâmetro do lábio que segura as BBs (< diametro_bb)
comprimento_labio  = 0.8;   // comprimento do lábio
numero_fendas      = 4;     // fendas para a ponta "abrir" ao meter as BBs (0 = sem fendas)
largura_fenda      = 0.6;
comprimento_fenda  = 4.0;

/* [Qualidade] */
$fn = 96;

// ------------------------------- cálculos ------------------------------
diametro_camara    = diametro_bb + folga_camara;
comprimento_camara = numero_bbs * diametro_bb + folga_comprimento;
// a câmara começa aqui (medido a partir da base)
z_camara  = comprimento_total - comprimento_labio - comprimento_camara;
parede    = (diametro_corpo - diametro_camara) / 2;

echo(str("Câmara: Ø", diametro_camara, " x ", comprimento_camara, " mm"));
echo(str("Parede lateral na câmara: ", parede, " mm"));
echo(str("Material por baixo da câmara: ", z_camara, " mm"));

assert(diametro_labio < diametro_bb,
       "O lábio tem de ser mais estreito que a BB, senão a BB cai.");
assert(parede >= 0.8,
       "Parede demasiado fina (< 0.8 mm): aumenta o diâmetro do corpo ou reduz a folga.");
assert(z_camara >= espessura_aro + 1.0,
       "Não cabem tantas BBs neste comprimento: reduz numero_bbs ou aumenta o comprimento.");

// ------------------------------- modelo --------------------------------
module exterior() {
    // aro
    cylinder(d = diametro_aro, h = espessura_aro);
    // corpo com chanfro na ponta
    translate([0, 0, espessura_aro])
        cylinder(d = diametro_corpo, h = comprimento_total - espessura_aro - chanfro_ponta);
    translate([0, 0, comprimento_total - chanfro_ponta])
        cylinder(d1 = diametro_corpo, d2 = diametro_corpo - 2 * chanfro_ponta, h = chanfro_ponta);
}

module interior() {
    e = 0.01;
    // canal de gás desde a base até à câmara
    translate([0, 0, -e])
        cylinder(d = diametro_canal_gas, h = z_camara + 2 * e);
    // rebaixo opcional para O-ring traseiro
    if (diametro_rebaixo > 0 && profundidade_rebaixo > 0)
        translate([0, 0, -e])
            cylinder(d = diametro_rebaixo, h = profundidade_rebaixo + e);
    // cone de transição (centra a BB de trás e evita overhang)
    cone_h = (diametro_camara - diametro_canal_gas) / 2;
    translate([0, 0, z_camara - cone_h])
        cylinder(d1 = diametro_canal_gas, d2 = diametro_camara, h = cone_h + e);
    // câmara das BBs
    translate([0, 0, z_camara])
        cylinder(d = diametro_camara, h = comprimento_camara + e);
    // lábio de retenção com chanfro de entrada
    translate([0, 0, comprimento_total - comprimento_labio])
        cylinder(d1 = diametro_labio, d2 = diametro_camara, h = comprimento_labio + e);
}

module fendas() {
    if (numero_fendas > 0)
        for (i = [0 : numero_fendas - 1])
            rotate([0, 0, i * 360 / numero_fendas])
                translate([0, -largura_fenda / 2, comprimento_total - comprimento_fenda])
                    cube([diametro_aro, largura_fenda, comprimento_fenda + 1]);
}

difference() {
    exterior();
    interior();
    fendas();
}
