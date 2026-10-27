package com.example.zeca.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.zeca.CartaBlackjack
import com.example.zeca.EstadoBlackjack
import com.example.zeca.ui.theme.Cores
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

@Composable
fun BlackjackJogo(
    apostaValida: Boolean,
    carregando: Boolean,
    estado: EstadoBlackjack?,
    mensagem: String,
    onIniciar: () -> Unit,
    onAcao: (String) -> Unit,
) {
    if (estado == null) {
        Mesa {
            Text(
                "Receba duas cartas e escolha pedir, parar ou dobrar.",
                color = Color.White.copy(alpha = 0.75f),
                fontSize = 12.sp,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.height(92.dp)) {
                CartaMesa(null, 0L, 62.dp)
                CartaMesa(null, 150L, 62.dp)
            }
        }
        BotaoJogo(
            texto = if (carregando) "Abrindo mesa..." else "Distribuir cartas",
            onClick = onIniciar,
            enabled = apostaValida && !carregando,
            modifier = Modifier.fillMaxWidth(),
        )
        StatusText(mensagem)
        return
    }
    key(estado.gameId) {
        MesaJogo(estado, carregando, apostaValida, mensagem, onIniciar, onAcao)
    }
}

@Composable
private fun MesaJogo(
    estado: EstadoBlackjack,
    carregando: Boolean,
    apostaValida: Boolean,
    mensagem: String,
    onIniciar: () -> Unit,
    onAcao: (String) -> Unit,
) {
    val liquidada = estado.status != "active"
    var revelado by remember { mutableStateOf(false) }
    var festa by remember { mutableStateOf(0) }
    val tremor = remember { Animatable(0f) }
    val vibrar = rememberVibrar()

    LaunchedEffect(liquidada) {
        if (liquidada) {
            delay(if (estado.cartasDealer.size > 2) 1000L else 800L)
            revelado = true
            when (estado.resultado) {
                "blackjack", "win" -> {
                    festa += 1
                    vibrar(true)
                }
                "bust", "dealer_blackjack", "lose" -> {
                    vibrar(true)
                    repeat(6) { i -> tremor.animateTo(if (i % 2 == 0) 10f else -10f, tween(45)) }
                    tremor.animateTo(0f, tween(70))
                }
            }
        }
    }

    val dealer: List<CartaBlackjack?> =
        if (estado.cartaOculta) estado.cartasDealer + listOf<CartaBlackjack?>(null) else estado.cartasDealer
    val (titulo, corTitulo) = when (estado.resultado) {
        "blackjack" -> "BLACKJACK!" to Color(0xFFFFD86B)
        "win" -> "VOCÊ VENCEU" to Cores.Verde
        "push" -> "EMPATE" to Color.White
        "bust" -> "ESTOUROU" to Color(0xFFFF6879)
        "dealer_blackjack" -> "DEALER: BLACKJACK" to Color(0xFFFF6879)
        else -> "DEALER VENCEU" to Color(0xFFFF6879)
    }

    Box(
        Modifier
            .fillMaxWidth()
            .graphicsLayer { translationX = tremor.value },
    ) {
        Mesa {
            PlacarMao("Dealer", if (estado.cartaOculta) null else pontuacaoCartas(estado.cartasDealer))
            MaoCartas(dealer, 300L)
            PlacarMao("Você", pontuacaoCartas(estado.cartasJogador))
            MaoCartas(estado.cartasJogador, 0L)
            Text(
                "Aposta ${formatarReais(estado.apostaCentavos)}",
                color = Color.White.copy(alpha = 0.7f),
                fontSize = 12.sp,
            )
            TituloResultado(titulo, corTitulo, revelado)
            BannerPremio(estado.lucroCentavos, festa, revelado)
        }
        ExplosaoMoedas(festa, Modifier.matchParentSize())
    }

    if (!liquidada) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BotaoJogo("Pedir", { onAcao("hit") }, Modifier.weight(1f), enabled = !carregando)
            BotaoJogo(
                "Parar",
                { onAcao("stand") },
                Modifier.weight(1f),
                enabled = !carregando,
                cor = Color.White.copy(alpha = 0.92f),
                corTexto = Color(0xFF111418),
            )
            BotaoJogo(
                "Dobrar",
                { onAcao("double") },
                Modifier.weight(1f),
                enabled = !carregando && estado.cartasJogador.size == 2,
                cor = Cores.Turquesa,
            )
        }
    } else {
        BotaoJogo(
            texto = if (carregando) "Abrindo..." else "Nova mão",
            onClick = onIniciar,
            enabled = apostaValida && !carregando && revelado,
            modifier = Modifier.fillMaxWidth(),
        )
    }
    StatusText(if (liquidada && !revelado) "" else mensagem)
}

@Composable
private fun Mesa(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(listOf(Color(0xFF14523B), Color(0xFF0C2E22))),
                RoundedCornerShape(20.dp),
            )
            .border(1.dp, Color(0xFF2E7B5C), RoundedCornerShape(20.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}

@Composable
private fun PlacarMao(titulo: String, pontos: Int?) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(titulo, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Box(
            modifier = Modifier
                .size(30.dp)
                .clip(CircleShape)
                .background(
                    when {
                        pontos == null -> Color.White.copy(alpha = 0.16f)
                        pontos > 21 -> Color(0xFFFF4D6A)
                        pontos == 21 -> Color(0xFFFFD86B)
                        else -> Color.White.copy(alpha = 0.9f)
                    },
                ),
            contentAlignment = Alignment.Center,
        ) {
            AnimatedContent(
                targetState = pontos,
                transitionSpec = {
                    (slideInVertically { it } + fadeIn()) togetherWith (slideOutVertically { -it } + fadeOut())
                },
                label = "placar",
            ) { p ->
                Text(p?.toString() ?: "?", color = Color(0xFF111418), fontSize = 14.sp, fontWeight = FontWeight.Black)
            }
        }
    }
}

@Composable
private fun MaoCartas(cartas: List<CartaBlackjack?>, atrasoBase: Long) {
    val largura = if (cartas.size > 4) 50.dp else 62.dp
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.height(92.dp)) {
        cartas.forEachIndexed { i, carta ->
            key(i) { CartaMesa(carta, atrasoBase + i * 180L, largura) }
        }
    }
}

@Composable
private fun CartaMesa(carta: CartaBlackjack?, atraso: Long, largura: Dp) {
    val entrada = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(atraso)
        entrada.animateTo(1f, spring(dampingRatio = 0.72f, stiffness = Spring.StiffnessLow))
    }
    val virar by animateFloatAsState(
        targetValue = if (carta == null) 180f else 0f,
        animationSpec = tween(550, easing = FastOutSlowInEasing),
        label = "virar-carta",
    )
    val densidade = LocalDensity.current.density
    Box(
        modifier = Modifier
            .size(width = largura, height = largura * 1.42f)
            .graphicsLayer {
                val e = entrada.value
                translationX = (1f - e) * 420f
                translationY = (1f - e) * -260f
                rotationZ = (1f - e) * 35f
                rotationY = virar
                cameraDistance = 14f * densidade
                alpha = e.coerceIn(0f, 1f)
            },
    ) {
        if (virar <= 90f && carta != null) {
            FaceCarta(carta)
        } else {
            VersoCarta(Modifier.graphicsLayer { rotationY = 180f })
        }
    }
}

@Composable
private fun FaceCarta(carta: CartaBlackjack) {
    val cor = if (carta.suit == "♥" || carta.suit == "♦") Color(0xFFC62F4D) else Color(0xFF151A1D)
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color.White, Color(0xFFE6EBEE))), RoundedCornerShape(10.dp))
            .border(1.dp, Color(0xFFD0D6DA), RoundedCornerShape(10.dp))
            .padding(5.dp),
    ) {
        Column(Modifier.align(Alignment.TopStart)) {
            Text(carta.rank, color = cor, fontSize = 15.sp, fontWeight = FontWeight.Black, lineHeight = 15.sp)
            Text(carta.suit, color = cor, fontSize = 13.sp, lineHeight = 13.sp)
        }
        Text(carta.suit, modifier = Modifier.align(Alignment.Center), color = cor.copy(alpha = 0.9f), fontSize = 30.sp)
    }
}

@Composable
private fun VersoCarta(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(listOf(Color(0xFF1B7A55), Color(0xFF0E3B2B))),
                RoundedCornerShape(10.dp),
            )
            .border(2.dp, Color.White.copy(alpha = 0.85f), RoundedCornerShape(10.dp))
            .padding(5.dp),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.fillMaxSize().border(1.dp, Color.White.copy(alpha = 0.35f), RoundedCornerShape(6.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text("Z", color = Color.White.copy(alpha = 0.8f), fontSize = 22.sp, fontWeight = FontWeight.Black)
        }
    }
}

@Composable
private fun TituloResultado(titulo: String, cor: Color, visivel: Boolean) {
    Box(Modifier.fillMaxWidth().height(36.dp), contentAlignment = Alignment.Center) {
        AnimatedVisibility(
            visible = visivel,
            enter = scaleIn(
                spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow),
                0.4f,
            ) + fadeIn(),
        ) {
            Text(titulo, color = cor, fontSize = 22.sp, fontWeight = FontWeight.Black)
        }
    }
}

@Composable
internal fun BotaoJogo(
    texto: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    cor: Color = Cores.Verde,
    corTexto: Color = Color(0xFF07130F),
) {
    Button(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(
            containerColor = cor,
            contentColor = corTexto,
            disabledContainerColor = Color.White.copy(alpha = 0.12f),
            disabledContentColor = Color.White.copy(alpha = 0.4f),
        ),
    ) {
        Text(texto, fontWeight = FontWeight.Bold, fontSize = 14.sp, maxLines = 1)
    }
}

@Composable
internal fun rememberVibrar(): (Boolean) -> Unit {
    val haptic = LocalHapticFeedback.current
    return remember(haptic) {
        { forte: Boolean ->
            haptic.performHapticFeedback(
                if (forte) HapticFeedbackType.LongPress else HapticFeedbackType.TextHandleMove,
            )
        }
    }
}

@Composable
internal fun BannerPremio(lucroCentavos: Long, festa: Int, visivel: Boolean) {
    AnimatedVisibility(
        visible = visivel && lucroCentavos > 0L,
        enter = scaleIn(
            spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow),
            0.6f,
        ) + fadeIn(),
    ) {
        key(festa) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFFFFD86B).copy(alpha = 0.16f), RoundedCornerShape(14.dp))
                    .border(1.dp, Color(0xFFFFD86B).copy(alpha = 0.6f), RoundedCornerShape(14.dp))
                    .padding(vertical = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "+${formatarReais(lucroCentavos)}",
                    color = Color(0xFFFFD86B),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Black,
                )
            }
        }
    }
}

internal val CORES_MOEDAS = listOf(Color(0xFFFFD86B))

internal val CORES_EXPLOSAO = listOf(
    Color(0xFFFF4D6A),
    Color(0xFFFF9F43),
    Color(0xFFFFD86B),
)

@Composable
internal fun ExplosaoMoedas(
    disparo: Int,
    modifier: Modifier = Modifier,
    cores: List<Color> = CORES_MOEDAS,
) {
    if (disparo == 0) return
    key(disparo) {
        val progresso = remember { Animatable(0f) }
        val densidade = LocalDensity.current.density
        LaunchedEffect(Unit) {
            progresso.animateTo(1f, tween(1400, easing = FastOutSlowInEasing))
        }
        Box(modifier, contentAlignment = Alignment.Center) {
            repeat(14) { i ->
                val angulo = (2 * PI * i / 14).toFloat()
                val corParticula = cores[i % cores.size]
                Box(
                    Modifier
                        .size(12.dp)
                        .graphicsLayer {
                            val p = progresso.value
                            val distancia = 170f * densidade * p
                            translationX = cos(angulo) * distancia
                            translationY = sin(angulo) * distancia - 60f * densidade * p
                            alpha = (1f - p).coerceIn(0f, 1f)
                        }
                        .background(corParticula, CircleShape)
                        .border(1.dp, Color.Black.copy(alpha = 0.3f), CircleShape),
                )
            }
        }
    }
}