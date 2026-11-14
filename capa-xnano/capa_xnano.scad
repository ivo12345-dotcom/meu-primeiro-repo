// =====================================================================
// Capa de proteção para Owlset HEIM ES X-NANO XPD
// com encaixe frontal para o anel "honeycomb" (titânio) de 41 mm
// ---------------------------------------------------------------------
// Corte da frente (da face da capa para trás):
//
//   face | aba de retenção | encaixe do anel | espaçador 4 mm | aparelho ...
//        |   (snap_t)      |    (ring_t)     |  (spacer_t)    |
//
//   - O anel entra PELA FRENTE e fica preso por uma pequena aba
//     (em TPU a aba cede e o anel "clica"); assenta contra o espaçador.
//   - O espaçador de 4 mm afasta o honeycomb da lente/sensor.
//   - O aparelho entra por trás e encosta ao espaçador.
//   - Base aberta de ponta a ponta (rail) e janela dos botões.
// =====================================================================

/* [Aparelho - medido] */
case_len_meas = 60;   // comprimento medido a partir da face da capa (mm)
meas_front    = 5;    // quanto da frente já estava incluído nessas medidas (mm)
dev_w = 41;           // largura do corpo (mm)
dev_h = 42;           // altura do corpo (mm)
dev_l = case_len_meas - meas_front;  // comprimento do próprio aparelho (= 55 mm)
dev_r = 6;            // raio dos cantos do corpo (mm) - confirmar
lens_dx = 0;          // desvio horizontal do centro da lente (mm)
lens_dz = 0;          // desvio vertical do centro da lente (mm)

/* [Anel honeycomb de titânio] */
ring_d      = 41;   // diâmetro exterior (mm)
ring_t      = 4;    // espessura (mm) - CONFIRMAR
ring_clear  = 0.2;  // folga no encaixe (mm)

/* [Frente] */
snap_t    = 1.0;  // espessura da aba que segura o anel pela frente (mm)
snap_lip  = 0.8;  // quanto a aba sobrepõe o anel, por lado (mm)
spacer_t  = 4.0;  // espaço entre o anel e o aparelho (mm)
spacer_d  = 35;   // abertura do espaçador (tem de ser > lente; < anel) (mm)

/* [Capa] */
wall      = 2.4;  // paredes (mm)
clear     = 0.4;  // folga aparelho-capa (mm)
back_lip  = 1.2;  // rebordo de retenção atrás (0 = sem)

/* [Abertura em baixo - rail] */
bottom_open   = true;
bottom_slot_w = 30;   // largura da abertura em baixo (mm) - confirmar

/* [Botões - medidos a partir da FACE da capa] */
// "left"/"right" = vistos por trás do aparelho (do lado do olho)
buttons_side = "left";
btn_y1     = 18.1;  // início, a partir da face da capa (mm)
btn_y2     = 35.5;  // fim, a partir da face da capa (mm)
btn_z1     = 9.5;   // a partir do topo (mm)
btn_z2     = 33.8;  // a partir do topo (mm)
btn_w      = 30;    // (só "top") largura (mm)
btn_margin = 1.0;   // folga extra à volta (mm)

$fn = 96;

// ----------------- derivados -----------------
front_total = snap_t + ring_t + spacer_t;   // onde começa o aparelho
in_w = dev_w + 2*clear;
in_h = dev_h + 2*clear;
out_w = max(in_w, ring_d + 2*ring_clear) + 2*wall;
out_h = max(in_h, ring_d + 2*ring_clear) + 2*wall;
in_r  = dev_r + clear;
out_r = in_r + wall;
body_len = front_total + dev_l + clear;
// posições dos botões relativas à frente do aparelho
btn_dev_y1 = btn_y1 - meas_front;
btn_dev_y2 = btn_y2 - meas_front;

echo(str("Capa por fora: ", out_w, " x ", out_h, " x ", body_len, " mm"));

module rbox(w, h, l, r) {
    r2 = min(r, w/2 - 0.01, h/2 - 0.01);
    hull() for (x = [-w/2 + r2, w/2 - r2], z = [-h/2 + r2, h/2 - r2])
        translate([x, 0, z]) rotate([-90, 0, 0]) cylinder(r = r2, h = l);
}

module ycyl(d, y, l, d2 = undef) {
    translate([lens_dx, y, lens_dz]) rotate([-90, 0, 0])
        cylinder(d1 = d, d2 = (d2 == undef ? d : d2), h = l);
}

module capa() {
    difference() {
        rbox(out_w, out_h, body_len, out_r);

        // cavidade do aparelho (aberta atrás)
        translate([0, front_total, 0]) rbox(in_w, in_h, body_len, in_r);

        // abertura frontal com chanfro de entrada (o anel "clica" para dentro)
        ycyl(ring_d - 2*snap_lip + 1.2, -0.01, snap_t + 0.02, ring_d - 2*snap_lip);
        // encaixe do anel
        ycyl(ring_d + 2*ring_clear, snap_t, ring_t);
        // abertura do espaçador (até à lente)
        ycyl(spacer_d, snap_t + ring_t - 0.01, spacer_t + 0.02);

        // base aberta para o rail (só na zona do aparelho)
        if (bottom_open)
            translate([-bottom_slot_w/2, front_total, -out_h])
                cube([bottom_slot_w, body_len, out_h]);

        // janela dos botões
        y0 = front_total + btn_dev_y1 - btn_margin;
        bl = btn_dev_y2 - btn_dev_y1 + 2*btn_margin;
        zt = dev_h/2 - btn_z1 + btn_margin;
        zb = dev_h/2 - btn_z2 - btn_margin;
        if (buttons_side == "top")
            translate([-btn_w/2, y0, 0]) cube([btn_w, bl, out_h]);
        if (buttons_side == "left")    // visto por trás = +X
            translate([0, y0, zb]) cube([out_w, bl, zt - zb]);
        if (buttons_side == "right")   // visto por trás = -X
            translate([-out_w, y0, zb]) cube([out_w, bl, zt - zb]);
    }

    // rebordo traseiro de retenção
    if (back_lip > 0)
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
