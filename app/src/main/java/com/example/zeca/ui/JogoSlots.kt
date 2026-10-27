package com.example.zeca.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.zeca.ui.theme.Cores
import kotlinx.coroutines.delay

private val SIMBOLOS_SLOTS = listOf("7", "BAR", "STAR", "DIAMOND", "CHERRY", "LEMON", "BELL", "CLOVER")

@Composable
fun SlotsJogo(
    resultado: String,
    carregando: Boolean,
    habilitado: Boolean,
    rodada: Int,
    lucroCentavos: Long,
    mensagem: String,
    onJogar: () -> Unit,
) {
    val alvo = remember(resultado) {
        val faces = resultado.trim().split(Regex("\\s+")).filter { it in SIMBOLOS_SLOTS }
        if (faces.size == 3) faces else listOf("7", "STAR", "DIAMOND")
    }
    val girando = remember { mutableStateListOf(false, false, false) }
    var vitoria by remember { mutableStateOf(false) }
    var disparo by remember { mutableStateOf(0) }
    val lucroAtual by rememberUpdatedState(lucroCentavos)
    val vibrar = rememberVibrar()

    LaunchedEffect(carregando) {
        if (carregando) {
            vitoria = false
            for (i in 0..2) girando[i] = true
        } else if (girando.any { it }) {
            for (i in 0..2) {
                delay(if (i == 0) 300L else 450L)
                girando[i] = false
                vibrar(false)
            }
            if (lucroAtual > 0L) {
                vitoria = true
                disparo += 1
                vibrar(true)
            }
        }
    }

    Text("Trinca paga 20× · par paga 2×", color = Color.White.copy(alpha = 0.64f), fontSize = 12.sp)
    Box(Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    Brush.verticalGradient(listOf(Color(0xFF2A1F3D), Color(0xFF130E1F))),
                    RoundedCornerShape(22.dp),
                )
                .border(
                    2.dp,
                    Color(0xFFFFD86B).copy(alpha = if (vitoria) 0.95f else 0.45f),
                    RoundedCornerShape(22.dp),
                )
                .padding(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            LuzesSlot(carregando || vitoria)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (i in 0..2) {
                    Rolo(alvo[i], girando[i], vitoria && !girando[i], i)
                }
            }
            BannerPremio(lucroCentavos, rodada, vitoria)
        }
        ExplosaoMoedas(disparo, Modifier.matchParentSize())
    }
    BotaoJogo(
        texto = if (carregando) "Girando..." else "Girar rolos",
        onClick = onJogar,
        enabled = habilitado,
        modifier = Modifier.fillMaxWidth(),
    )
    StatusText(if (carregando || girando.none { it }) mensagem else "")
}

@Composable
private fun Rolo(alvo: String, girando: Boolean, brilhando: Boolean, indice: Int) {
    val alvoAtual by rememberUpdatedState(alvo)
    var face by remember { mutableStateOf(alvo) }
    LaunchedEffect(girando) {
        if (girando) {
            while (true) {
                face = SIMBOLOS_SLOTS.random()
                delay(80)
            }
        } else {
            face = alvoAtual
        }
    }
    val pulso by rememberInfiniteTransition(label = "slot-pulso-$indice").animateFloat(
        initialValue = 1f,
        targetValue = 1.07f,
        animationSpec = infiniteRepeatable(tween(420), RepeatMode.Reverse),
        label = "pulso",
    )
    val escala = if (brilhando) pulso else 1f
    val borda = when {
        brilhando -> Color(0xFFFFD86B)
        girando -> Cores.Verde.copy(alpha = 0.7f)
        else -> Color.White.copy(alpha = 0.22f)
    }
    Box(
        modifier = Modifier
            .size(width = 88.dp, height = 108.dp)
            .graphicsLayer { scaleX = escala; scaleY = escala }
            .clip(RoundedCornerShape(16.dp))
            .background(Brush.verticalGradient(listOf(Color(0xFF232B31), Color(0xFF0D1114), Color(0xFF232B31))))
            .border(2.dp, borda, RoundedCornerShape(16.dp)),
        contentAlignment = Alignment.Center,
    ) {
        AnimatedContent(
            targetState = face,
            transitionSpec = {
                if (girando) {
                    (slideInVertically(tween(80)) { -it } + fadeIn(tween(80))) togetherWith
                        (slideOutVertically(tween(80)) { it } + fadeOut(tween(80)))
                } else {
                    slideInVertically(
                        spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow),
                    ) { -it } togetherWith
                        (slideOutVertically(tween(160)) { it } + fadeOut(tween(160)))
                }
            },
            label = "rolo-$indice",
        ) { simbolo ->
            SimboloSlot(simbolo)
        }
    }
}

@Composable
private fun SimboloSlot(simbolo: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        when (simbolo) {
            "7" -> Text("7", color = Color(0xFFFF4D6A), fontSize = 54.sp, fontWeight = FontWeight.Black)
            "BAR" -> Box(
                Modifier
                    .background(Color(0xFFFF9F43), RoundedCornerShape(6.dp))
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            ) {
                Text("BAR", color = Color(0xFF1B1206), fontSize = 20.sp, fontWeight = FontWeight.Black)
            }
            else -> Text(emojiSlot(simbolo), fontSize = 44.sp)
        }
    }
}

private fun emojiSlot(simbolo: String): String = when (simbolo) {
    "STAR" -> "⭐"
    "DIAMOND" -> "💎"
    "CHERRY" -> "🍒"
    "LEMON" -> "🍋"
    "BELL" -> "🔔"
    else -> "🍀"
}

@Composable
private fun LuzesSlot(ativa: Boolean) {
    val transicao = rememberInfiniteTransition(label = "luzes")
    val fase by transicao.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(700, easing = LinearEasing), RepeatMode.Restart),
        label = "fase",
    )
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
        repeat(9) { i ->
            val acesa = ativa && ((i + (fase * 2f).toInt()) % 2 == 0)
            Box(
                Modifier
                    .size(8.dp)
                    .background(if (acesa) Color(0xFFFFD86B) else Color.White.copy(alpha = 0.14f), CircleShape),
            )
        }
    }
}