// =====================================================================
// Capa de proteção para Owlset HEIM ES X-NANO XPD
// com encaixe frontal para o anel "honeycomb" (titânio) de 41 mm
// ---------------------------------------------------------------------
// Como funciona:
//   - A capa é uma "manga" que envolve o corpo do aparelho.
//   - A traseira fica aberta (ocular / ecrã) para o aparelho entrar.
//   - Na frente há uma caixa (pocket) de 41 mm onde o anel de titânio
//     assenta. O anel é colocado por DENTRO da capa, antes do aparelho,
//     e fica preso entre o rebordo frontal da capa e a frente do aparelho.
//
// !!! As medidas do aparelho abaixo são PROVISÓRIAS. Meça com um
//     paquímetro e substitua antes de imprimir. !!!
// =====================================================================

/* [Aparelho - MEDIR] */
dev_w = 41;     // largura do corpo (mm) - medido
dev_h = 42;     // altura do corpo (mm) - medido
dev_l = 60;     // comprimento total do corpo (mm) - medido
dev_r = 6;      // raio dos cantos do corpo (mm)
lens_dx = 0;    // desvio horizontal do centro da lente vs centro do corpo (mm)
lens_dz = 0;    // desvio vertical do centro da lente vs centro do corpo (mm)

/* [Anel honeycomb de titânio] */
ring_d      = 41;   // diâmetro exterior do anel (mm)
ring_t      = 4;    // espessura do anel (mm) - MEDIR
ring_open_d = 27;   // diâmetro da abertura interior do anel (mm) - MEDIR

/* [Capa] */
wall      = 2.4;  // espessura das paredes (mm)
front_t   = 2.0;  // espessura do rebordo frontal que segura o anel (mm)
clear     = 0.4;  // folga entre aparelho e capa (mm)
ring_clear= 0.3;  // folga do anel no pocket (mm)
lip       = 3.0;  // quanto o rebordo frontal sobrepõe o anel (mm, por lado)
cover_len = 60.5; // até onde a capa cobre o corpo, a partir da frente (mm)
                  // (o rebordo traseiro só é feito se cobrir o corpo todo)
back_lip  = 1.2;  // pequeno rebordo de retenção na traseira (0 = sem)

/* [Abertura em baixo - rail] */
bottom_open   = true;  // abre a base de ponta a ponta (para o rail/montagem)
bottom_slot_w = 30;    // largura da abertura em baixo (mm) - MEDIR a base/montagem do aparelho
                       // (o que sobra de cada lado fica como aba que segura o aparelho)

/* [Abertura dos botões] */
// "left"/"right" = vistos por trás do aparelho (do lado do olho)
buttons_side = "left"; // onde estão os botões: "top", "left", "right"
btn_y1       = 18.1;   // início, a partir da frente do aparelho (mm) - medido
btn_y2       = 35.5;   // fim, a partir da frente do aparelho (mm) - medido
btn_z1       = 9.5;    // (lado) início, a partir do topo do aparelho (mm) - medido
btn_z2       = 33.8;   // (lado) fim, a partir do topo do aparelho (mm) - medido
btn_w        = 30;     // (só para "top") largura da abertura (mm)
btn_margin   = 1.0;    // folga extra à volta da abertura (mm)

/* [Recortes extra - opcional] */
// Lista de recortes no TOPO: [posição a partir da frente, largura, comprimento]
top_cutouts  = [ /* [30, 12, 20] */ ];
// Lista de recortes no LADO DIREITO: [posição a partir da frente, altura, comprimento]
side_cutouts = [ /* [30, 10, 15] */ ];

$fn = 96;

// ----------------- derivados -----------------
in_w = dev_w + 2*clear;
in_h = dev_h + 2*clear;
out_w = max(in_w, ring_d + 2*ring_clear) + 2*wall;
out_h = max(in_h, ring_d + 2*ring_clear) + 2*wall;
in_r  = dev_r + clear;
out_r = in_r + wall;
body_len = cover_len + ring_t + front_t;   // comprimento total da capa (eixo Y)

module rbox(w, h, l, r) {
    // caixa com cantos arredondados; eixo do comprimento = Y, começa em y=0
    r2 = min(r, w/2 - 0.01, h/2 - 0.01);
    hull() for (x = [-w/2 + r2, w/2 - r2], z = [-h/2 + r2, h/2 - r2])
        translate([x, 0, z]) rotate([-90, 0, 0]) cylinder(r = r2, h = l);
}

module capa() {
    difference() {
        rbox(out_w, out_h, body_len, out_r);

        // cavidade do aparelho (aberta atrás)
        translate([0, front_t + ring_t, 0])
            rbox(in_w, in_h, body_len, in_r);

        // pocket do anel de titânio
        translate([lens_dx, front_t - 0.01, lens_dz]) rotate([-90, 0, 0])
            cylinder(d = ring_d + 2*ring_clear, h = ring_t + 0.02);

        // janela frontal (o rebordo segura o anel por "lip" mm)
        translate([lens_dx, -1, lens_dz]) rotate([-90, 0, 0])
            cylinder(d = max(ring_d - 2*lip, ring_open_d), h = front_t + 2);

        // chanfro na janela frontal (menos reflexos / visual limpo)
        translate([lens_dx, -0.01, lens_dz]) rotate([-90, 0, 0])
            cylinder(d1 = max(ring_d - 2*lip, ring_open_d) + 2*front_t,
                     d2 = max(ring_d - 2*lip, ring_open_d), h = front_t);

        // abertura em baixo para o rail (de ponta a ponta, inclui a frente até ao anel)
        if (bottom_open)
            translate([-bottom_slot_w/2, front_t + ring_t, -out_h])
                cube([bottom_slot_w, body_len, out_h]);

        // abertura dos botões
        y0 = front_t + ring_t + btn_y1 - btn_margin;
        bl = btn_y2 - btn_y1 + 2*btn_margin;
        zt = dev_h/2 - btn_z1 + btn_margin;   // z do topo da abertura
        zb = dev_h/2 - btn_z2 - btn_margin;   // z do fundo da abertura
        if (buttons_side == "top")
            translate([-btn_w/2, y0, 0]) cube([btn_w, bl, out_h]);
        if (buttons_side == "left")    // visto por trás = +X
            translate([0, y0, zb]) cube([out_w, bl, zt - zb]);
        if (buttons_side == "right")   // visto por trás = -X
            translate([-out_w, y0, zb]) cube([out_w, bl, zt - zb]);

        // recortes extra no topo
        for (c = top_cutouts)
            translate([-c[1]/2, front_t + ring_t + c[0], 0])
                cube([c[1], c[2], out_h]);

        // recortes no lado direito
        for (c = side_cutouts)
            translate([0, front_t + ring_t + c[0], -c[1]/2])
                cube([out_w, c[2], c[1]]);
    }

    // rebordo traseiro de retenção (pequena aba que "abraça" o aparelho)
    if (back_lip > 0 && cover_len >= dev_l)
        difference() {
            translate([0, body_len - 1.2, 0]) rbox(in_w, in_h, 1.2, in_r);
            translate([0, body_len - 1.3, 0])
                rbox(in_w - 2*back_lip, in_h - 2*back_lip, 1.4, max(in_r - back_lip, 0.5));
            if (bottom_open)
                translate([-bottom_slot_w/2, body_len - 2, -out_h]) cube([bottom_slot_w, 3, out_h]);
        }
}

// Imprimir com a frente virada para a mesa (sem suportes)
rotate([90, 0, 0]) mirror([0, 1, 0]) capa();
