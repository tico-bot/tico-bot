package com.example.zeca.ui

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin

private val ORDEM_RODA = listOf(
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20,
    14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
)
private val VERMELHOS = setOf(1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36)

private fun corDoNumero(n: Int): Color = when {
    n == 0 -> Color(0xFF1FA971)
    n in VERMELHOS -> Color(0xFFD7475E)
    else -> Color(0xFF1B2126)
}

@Composable
fun RoletaJogo(
    tipo: String,
    selecao: String,
    numero: String,
    resultado: String,
    mensagem: String,
    carregando: Boolean,
    apostaValida: Boolean,
    rodada: Int,
    lucroCentavos: Long,
    historico: List<Int>,
    onTipoChange: (String) -> Unit,
    onSelecaoChange: (String) -> Unit,
    onNumeroChange: (String) -> Unit,
    onJogar: () -> Unit,
) {
    val numeroSaido = resultado.substringBefore("·").trim().toIntOrNull()
    var vitoria by remember { mutableStateOf(false) }
    var disparo by remember { mutableStateOf(0) }
    var rodadaPousada by remember { mutableStateOf(rodada) }
    val lucroAtual by rememberUpdatedState(lucroCentavos)
    val vibrar = rememberVibrar()

    LaunchedEffect(carregando) {
        if (carregando) vitoria = false
    }

    SeletorJogos(listOf("Cor", "Paridade", "Faixa", "Dúzia", "Número"), tipo, onTipoChange)
    when (tipo) {
        "Cor" -> SeletorJogos(listOf("Vermelho", "Preto"), selecao, onSelecaoChange)
        "Paridade" -> SeletorJogos(listOf("Par", "Ímpar"), selecao, onSelecaoChange)
        "Faixa" -> SeletorJogos(listOf("1–18", "19–36"), selecao, onSelecaoChange)
        "Dúzia" -> SeletorJogos(listOf("1ª", "2ª", "3ª"), selecao, onSelecaoChange)
        else -> OutlinedTextField(
            value = numero,
            onValueChange = onNumeroChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Número (0–36)") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
    }
    Text(
        "Cor/paridade/faixa pagam 2× · dúzia 3× · número 36×. Zero perde em todos, exceto aposta no 0.",
        color = Color.White.copy(alpha = 0.62f),
        fontSize = 11.sp,
    )

    val aguardandoPouso = rodada != rodadaPousada
    HistoricoRoleta(if (aguardandoPouso) historico.drop(1) else historico)

    Box(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            RodaRoleta(
                numeroSaido = numeroSaido,
                carregando = carregando,
                rodada = rodada,
                onPousou = {
                    rodadaPousada = rodada
                    if (lucroAtual > 0L) {
                        vitoria = true
                        disparo += 1
                        vibrar(true)
                    }
                },
            )
            BannerPremio(lucroCentavos, rodada, vitoria)
        }
        ExplosaoMoedas(disparo, Modifier.matchParentSize())
    }

    BotaoJogo(
        texto = if (carregando) "Girando..." else "Girar roleta",
        onClick = onJogar,
        enabled = apostaValida && !carregando && (tipo != "Número" || numero.toIntOrNull() in 0..36),
        modifier = Modifier.fillMaxWidth(),
    )
    StatusText(if (aguardandoPouso) "" else mensagem)
}

@Composable
private fun HistoricoRoleta(historico: List<Int>) {
    if (historico.isEmpty()) return
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()).animateContentSize(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Últimos", color = Color.White.copy(alpha = 0.55f), fontSize = 11.sp)
        historico.take(12).forEach { n ->
            Box(
                Modifier.size(26.dp).clip(CircleShape).background(corDoNumero(n)),
                contentAlignment = Alignment.Center,
            ) {
                Text(n.toString(), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun RodaRoleta(
    numeroSaido: Int?,
    carregando: Boolean,
    rodada: Int,
    onPousou: () -> Unit,
) {
    val roda = remember { Animatable(0f) }
    val bola = remember { Animatable(0f) }
    val raioBola = remember { Animatable(0.92f) }
    val badge = remember { Animatable(if (numeroSaido != null) 1f else 0f) }
    var pousou by remember { mutableStateOf(numeroSaido != null) }
    var ultimaRodada by remember { mutableStateOf(rodada) }
    val numeroAtual by rememberUpdatedState(numeroSaido)
    val aoPousar by rememberUpdatedState(onPousou)
    val vibrar = rememberVibrar()
    val tinta = remember {
        android.graphics.Paint().apply {
            isAntiAlias = true
            color = android.graphics.Color.WHITE
            textAlign = android.graphics.Paint.Align.CENTER
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }
    }

    LaunchedEffect(carregando, rodada) {
        val numero = numeroAtual
        if (carregando) {
            pousou = false
            badge.snapTo(0f)
            raioBola.snapTo(0.92f)
            coroutineScope {
                launch {
                    while (true) roda.animateTo(roda.value + 360f, tween(2200, easing = LinearEasing))
                }
                launch {
                    while (true) bola.animateTo(bola.value - 360f, tween(850, easing = LinearEasing))
                }
            }
        } else if (numero != null && rodada != ultimaRodada) {
            ultimaRodada = rodada
            val duracao = 3300
            val bolso = (ORDEM_RODA.indexOf(numero) + 0.5f) * (360f / 37f)
            val alvoMod = ((-bolso) % 360f + 360f) % 360f
            val atualMod = ((roda.value % 360f) + 360f) % 360f
            val delta = (alvoMod - atualMod + 360f) % 360f
            val alvoBola = (floor(bola.value / 360f) - 3f) * 360f
            coroutineScope {
                launch { roda.animateTo(roda.value + 720f + delta, tween(duracao, easing = FastOutSlowInEasing)) }
                launch { bola.animateTo(alvoBola, tween(duracao, easing = FastOutSlowInEasing)) }
                launch {
                    delay((duracao * 0.6f).toLong())
                    raioBola.animateTo(
                        0.76f,
                        spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow),
                    )
                }
            }
            pousou = true
            vibrar(false)
            aoPousar()
            badge.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessLow))
        } else if (numero == null) {
            while (true) roda.animateTo(roda.value + 360f, tween(40_000, easing = LinearEasing))
        }
    }

    Box(Modifier.size(250.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val c = center
            val raio = size.minDimension / 2f
            val passo = 360f / 37f
            drawCircle(Color(0xFF2B1D10), radius = raio)
            rotate(roda.value, c) {
                val lado = raio * 0.92f * 2f
                ORDEM_RODA.forEachIndexed { i, n ->
                    drawArc(
                        color = corDoNumero(n),
                        startAngle = -90f + i * passo,
                        sweepAngle = passo - 0.5f,
                        useCenter = true,
                        topLeft = Offset(c.x - lado / 2f, c.y - lado / 2f),
                        size = Size(lado, lado),
                    )
                }
                drawCircle(Color(0xFF12181C), radius = raio * 0.62f)
                drawCircle(Color(0xFFD5B66B), radius = raio * 0.62f, style = Stroke(2.dp.toPx()))
                tinta.textSize = raio * 0.085f
                drawIntoCanvas { canvas ->
                    ORDEM_RODA.forEachIndexed { i, n ->
                        val ang = Math.toRadians((-90f + (i + 0.5f) * passo).toDouble())
                        val r = raio * 0.80f
                        val x = c.x + (cos(ang) * r).toFloat()
                        val y = c.y + (sin(ang) * r).toFloat()
                        canvas.nativeCanvas.save()
                        canvas.nativeCanvas.rotate((i + 0.5f) * passo, x, y)
                        canvas.nativeCanvas.drawText(n.toString(), x, y + tinta.textSize / 3f, tinta)
                        canvas.nativeCanvas.restore()
                    }
                }
                repeat(4) { k ->
                    val a = Math.toRadians((k * 90f + 45f).toDouble())
                    drawLine(
                        color = Color(0xFFD5B66B),
                        start = Offset(c.x + (cos(a) * raio * 0.10f).toFloat(), c.y + (sin(a) * raio * 0.10f).toFloat()),
                        end = Offset(c.x + (cos(a) * raio * 0.38f).toFloat(), c.y + (sin(a) * raio * 0.38f).toFloat()),
                        strokeWidth = 3.dp.toPx(),
                    )
                }
                drawCircle(Color(0xFF0C1114), radius = raio * 0.40f)
                drawCircle(Color(0xFFD5B66B), radius = raio * 0.40f, style = Stroke(2.dp.toPx()))
            }
            drawCircle(Color(0xFFD5B66B), radius = raio * 0.995f, style = Stroke(5.dp.toPx()))
            val seta = Path().apply {
                moveTo(c.x - 9.dp.toPx(), 0f)
                lineTo(c.x + 9.dp.toPx(), 0f)
                lineTo(c.x, 16.dp.toPx())
                close()
            }
            drawPath(seta, Color(0xFFFFD86B))
            if (carregando || pousou) {
                val rad = Math.toRadians(bola.value.toDouble())
                val rb = raio * raioBola.value
                val centroBola = Offset(c.x + (sin(rad) * rb).toFloat(), c.y - (cos(rad) * rb).toFloat())
                drawCircle(Color.White.copy(alpha = 0.28f), radius = 11.dp.toPx(), center = centroBola)
                drawCircle(Color.White, radius = 6.dp.toPx(), center = centroBola)
            }
        }
        val fundo = if (pousou && numeroSaido != null) corDoNumero(numeroSaido) else Color(0xFF0C1114)
        Box(
            modifier = Modifier
                .size(78.dp)
                .clip(CircleShape)
                .background(fundo)
                .border(2.dp, Color(0xFFD5B66B), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (pousou && numeroSaido != null) {
                Text(
                    numeroSaido.toString(),
                    color = Color.White,
                    fontSize = 30.sp,
                    fontWeight = FontWeight.Black,
                    modifier = Modifier.graphicsLayer {
                        scaleX = badge.value
                        scaleY = badge.value
                    },
                )
            } else {
                Text("ZECA", color = Color(0xFF5BE4E0), fontSize = 13.sp, fontWeight = FontWeight.Black)
            }
        }
    }
}