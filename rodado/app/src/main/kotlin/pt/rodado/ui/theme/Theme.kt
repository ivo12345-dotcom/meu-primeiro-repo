package pt.rodado.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val VerdeEscuro = Color(0xFF0F3D2E)
private val VerdeClaro = Color(0xFF4CAF87)
private val Areia = Color(0xFFF6F4EF)

private val Claro = lightColorScheme(
    primary = VerdeEscuro,
    onPrimary = Color.White,
    secondary = VerdeClaro,
    background = Areia,
    surface = Color.White
)

private val Escuro = darkColorScheme(
    primary = VerdeClaro,
    onPrimary = Color(0xFF04241A),
    secondary = VerdeClaro,
    background = Color(0xFF101512),
    surface = Color(0xFF181E1A)
)

@Composable
fun RodadoTheme(escuro: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (escuro) Escuro else Claro, content = content)
}

/** Verde para bom, vermelho para mau — usado nos valores de €/hora e no líquido. */
@Composable
fun corDoValor(cents: Long): Color = when {
    cents > 0 -> if (isSystemInDarkTheme()) Color(0xFF6FD3A6) else Color(0xFF1B7A54)
    cents < 0 -> if (isSystemInDarkTheme()) Color(0xFFFF8A80) else Color(0xFFB3261E)
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}
