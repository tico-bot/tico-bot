package com.example.zeca.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

object Cores {
    var EscalaTexto by mutableFloatStateOf(1f)
        private set
    var AltoContraste by mutableStateOf(false)
        private set
    var ReduzirMovimento by mutableStateOf(false)
        private set
    private var temaAtual = "dark"
    var Fundo by mutableStateOf(Color(0xFF090D10))
        private set
    var Cartao by mutableStateOf(Color(0xFF171C20))
        private set
    var Barra by mutableStateOf(Color(0xD9272D32))
        private set
    var Borda by mutableStateOf(Color(0x45FFFFFF))
        private set
    var Verde by mutableStateOf(Color(0xFF2BD576))
        private set
    var Laranja by mutableStateOf(Color(0xFFFF7A2F))
        private set
    var Turquesa by mutableStateOf(Color(0xFF22C7C1))
        private set
    var Roxo by mutableStateOf(Color(0xFF8B5CF6))
        private set
    var Cinza by mutableStateOf(Color(0xFF8E8E93))
        private set

    fun aplicarTema(theme: String) {
        temaAtual = theme
        when (theme) {
            "amoled" -> {
                Fundo = Color.Black
                Cartao = Color(0xFF101010)
                Barra = Color(0xE6000000)
                Borda = Color(0x55FFFFFF)
                Verde = Color(0xFF47F28A)
                Laranja = Color(0xFFFF9A62)
                Turquesa = Color(0xFF56E8E2)
                Roxo = Color(0xFFB39AFF)
                Cinza = Color(0xFFB0B0B0)
            }
            "blue" -> {
                Fundo = Color(0xFF08111F)
                Cartao = Color(0xFF13243A)
                Barra = Color(0xE61A2C45)
                Borda = Color(0x557BB7FF)
                Verde = Color(0xFF70E6A5)
                Laranja = Color(0xFFFFA46B)
                Turquesa = Color(0xFF73C9FF)
                Roxo = Color(0xFFB59AFF)
                Cinza = Color(0xFFAFBED0)
            }
            else -> {
                Fundo = Color(0xFF090D10)
                Cartao = Color(0xFF171C20)
                Barra = Color(0xD9272D32)
                Borda = Color(0x45FFFFFF)
                Verde = Color(0xFF2BD576)
                Laranja = Color(0xFFFF7A2F)
                Turquesa = Color(0xFF22C7C1)
                Roxo = Color(0xFF8B5CF6)
                Cinza = Color(0xFF8E8E93)
            }
        }
        if (AltoContraste) aplicarContraste()
    }

    fun aplicarAcessibilidade(escalaTexto: Float, altoContraste: Boolean, reduzirMovimento: Boolean = false) {
        EscalaTexto = escalaTexto.coerceIn(1f, 1.5f)
        AltoContraste = altoContraste
        ReduzirMovimento = reduzirMovimento
        aplicarTema(temaAtual)
    }

    private fun aplicarContraste() {
        Borda = Color.White.copy(alpha = 0.78f)
        Verde = Color(0xFF8CFFB6)
        Turquesa = Color(0xFF75FFF8)
        Cinza = Color(0xFFE0E0E0)
    }
}

private val Tipografia = Typography(
    headlineLarge = TextStyle(fontSize = 40.sp, fontWeight = FontWeight.Black),
    headlineMedium = TextStyle(fontSize = 28.sp, fontWeight = FontWeight.Bold),
    titleLarge = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Bold),
    bodyLarge = TextStyle(fontSize = 16.sp),
    bodyMedium = TextStyle(fontSize = 14.sp),
)

@Composable
fun CassinoTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            background = Cores.Fundo,
            surface = Cores.Cartao,
            primary = Cores.Verde,
            onPrimary = Color.Black,
            onBackground = Color.White,
            onSurface = Color.White,
        ),
        typography = Tipografia,
        content = content,
    )
}